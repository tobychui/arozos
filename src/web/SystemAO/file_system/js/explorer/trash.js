/*
    trash.js

    The trash bin, rendered inside the File Manager instead of as its own app.

    There is no ".trash" directory the server will list, so this is not a real
    path: %trashbin% is a sentinel that listDirectory() recognises and hands to
    renderTrashView() rather than to listDir. Everything here comes from the
    same trash API the standalone Trash Bin app used:

        GET  /system/file_system/listTrash      -> [trashedFile]
        POST /system/file_system/restoreTrash   {src}
        GET  /system/file_system/clearTrash
        POST /system/file_system/fileOpr        {opr:"delete"} to purge entries

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

//The sentinel the path bar shows and the %trashbin% shortcut resolves to
const TRASH_VPATH = "%trashbin%";

/*
    Retention and quota now come from the server, set per user under
    System Settings -> Disk and Storage -> File Manager. Zero means "no limit"
    for both, which is what an account that never touched those settings reads
    back - so the default is the unlimited, never-expiring behaviour the trash
    bin had before they existed.

    These are seeded with the defaults and replaced by loadTrashSettings()
    before the view draws, so a slow settings request cannot leave the header
    blank.
*/
let trashRetentionDays = 30;    //0 = never auto remove
let trashQuotaBytes = 0;        //0 = unlimited

let trashItems = [];            //Last listing, what the row actions act on
let trashSelection = {};        //Encoded filepath -> true for the checked rows
let trashSortKey = "deleted";   //name | origin | deleted | size | remaining
let trashSortAsc = false;       //Newest deletions first, as the old app did
let trashSearchKeyword = "";    //"" = no filter, the whole bin is on show
let trashKindFilter = "all";    //all | file | folder, set by the card layout chips

/*
    Scan state

    A bin on a large NAS takes a while to list: the server walks every folder
    of every mounted root looking for .trash directories. Rather than hold a
    blank screen for all of it, the scan is streamed and each file is drawn as
    the server finds it - see the loading section below.
*/
let trashScanning = false;      //A scan is in flight
let trashScanGeneration = 0;    //Bumped per scan, so a stale one draws nothing
let trashScanSocket = null;     //The live scan, dropped when another starts

/*
    Which layout was drawn last, so a resize only redraws when it actually
    crosses the threshold rather than on every pixel of a window drag.
*/
let trashLayoutWasCard = null;

function refreshTrashLayoutOnResize(){
    if (!isTrashPath(currentPath)){
        trashLayoutWasCard = null;
        return;
    }
    let cardLayout = useTrashCardLayout();
    if (trashLayoutWasCard === cardLayout){
        return;
    }
    trashLayoutWasCard = cardLayout;
    drawTrashView();
}

function isTrashPath(path){
    if (path == undefined || path == null){
        return false;
    }
    //listDirectory pads a trailing slash onto everything it navigates to
    let cleaned = String(path).trim().replace(/\/+$/, "").toLowerCase();
    return cleaned == TRASH_VPATH;
}

//The sidebar entry and the path shortcut both come through here
function openTrashBin(){
    listDirectory(TRASH_VPATH);
}

/*
    Listing
*/
function renderTrashView(callback){
    //The column header belongs to the details view, not to this one
    $("#fmListHeader").hide();
    $("#fileList").html("");
    /*
        Painted before the settings request goes out rather than after it comes
        back, so clicking through to the bin puts something on screen straight
        away - on a phone the sidebar is dismissed at that same moment and this
        is what replaces it.
    */
    $("#folderList").show().html('<div class="fmTrashLoading">' +
        applocale.getString("message/loading", "Loading") + '</div>');

    trashSelection = {};
    //Navigating in is a fresh look at the whole bin, not a continuation of
    //whatever was last searched or filtered for
    trashSearchKeyword = "";
    trashKindFilter = "all";

    //Settings first, so the header renders with the real limits rather than
    //flashing the defaults and correcting itself a moment later
    $.get("../../system/file_system/trashSettings", function(settings){
        if (settings != null && settings.error === undefined){
            trashRetentionDays = settings.RetentionDays || 0;
            trashQuotaBytes = settings.QuotaBytes || 0;
        }
    }).always(function(){
        loadTrashListing(callback);
    });
}

/*
    Loading

    /system/file_system/ws/listTrash streams one JSON trashedFile per discovery
    and closes when the walk is done, so rows can be drawn as they arrive
    instead of after the whole tree has been visited. If the socket cannot be
    opened - an old reverse proxy, a blocked upgrade - the flat
    /system/file_system/listTrash request stands in, which answers with
    everything at once after the same walk.

    @param callback  run once the scan finishes, however it finished
    @param silent    keep the rows already on screen and swap them for the new
                     set in one go at the end, instead of clearing to a loading
                     message first. Used after a restore or a delete so someone
                     working through the bin is not interrupted by the list
                     they are working on disappearing.
*/
function loadTrashListing(callback, silent = false){
    trashScanGeneration++;
    let generation = trashScanGeneration;
    closeTrashScanSocket();
    trashScanning = true;

    //Only the silent path needs somewhere to stage results, since the visible
    //list has to stay untouched until the scan is done
    let collected = [];

    if (!silent){
        trashItems = [];
        drawTrashView();
    }

    function finish(items){
        if (generation != trashScanGeneration){
            //A newer scan, or a navigation away, has taken over
            return;
        }
        trashScanning = false;
        trashScanSocket = null;
        if (items != null){
            trashItems = items;
        }
        applyTrashSort();
        drawTrashView();
        if (callback !== undefined){
            callback();
        }
    }

    let socket = null;
    try {
        socket = new WebSocket(trashWebSocketEndpoint() + "/system/file_system/ws/listTrash");
    } catch (e){
        loadTrashListingFallback(generation, silent, callback);
        return;
    }
    trashScanSocket = socket;

    let opened = false;
    socket.onopen = function(){
        opened = true;
    };

    socket.onmessage = function(evt){
        if (generation != trashScanGeneration){
            return;
        }
        let item = null;
        try {
            item = JSON.parse(evt.data);
        } catch (e){
            return;
        }
        if (item == null || item.error !== undefined){
            return;
        }

        if (silent){
            collected.push(item);
            return;
        }

        trashItems.push(item);
        if (appendTrashRowLive(item)){
            updateTrashLiveCounters();
        }else{
            //Nothing to append to yet, so draw the whole thing once
            drawTrashView();
        }
    };

    socket.onclose = function(){
        if (generation != trashScanGeneration){
            return;
        }
        if (!opened){
            /*
                Closed without ever connecting - the upgrade was refused. The
                error handler leaves this to onclose so the fallback is only
                started once.
            */
            loadTrashListingFallback(generation, silent, callback);
            return;
        }
        finish(silent ? collected : null);
    };

    socket.onerror = function(){
        //onclose always follows and decides what to do
    };
}

//Long-poll stand-in for when the socket is unavailable
function loadTrashListingFallback(generation, silent, callback){
    $.get("../../system/file_system/listTrash", function(data){
        if (generation != trashScanGeneration){
            return;
        }
        trashScanning = false;
        trashItems = (data == null || data.error !== undefined) ? [] : data;
        applyTrashSort();
        drawTrashView();
        if (callback !== undefined){
            callback();
        }
    }).fail(function(){
        if (generation != trashScanGeneration){
            return;
        }
        trashScanning = false;
        if (!silent){
            //A silent reload that fails leaves the list it was refreshing alone
            trashItems = [];
        }
        applyTrashSort();
        drawTrashView();
        if (callback !== undefined){
            callback();
        }
    });
}

function trashWebSocketEndpoint(){
    let protocol = (location.protocol === "https:") ? "wss://" : "ws://";
    let port = window.location.port;
    if (port == ""){
        port = (location.protocol === "https:") ? "443" : "80";
    }
    return protocol + window.location.hostname + ":" + port;
}

/*
    Drops a scan that is still running. The generation counter already stops a
    stale socket from drawing anything, but the server keeps walking the tree
    until the connection goes - which is the expensive part on a big NAS.
*/
function closeTrashScanSocket(){
    if (trashScanSocket == null){
        return;
    }
    let socket = trashScanSocket;
    trashScanSocket = null;
    //Detached first, so closing it does not read as a finished scan
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try {
        socket.close();
    } catch (e){}
}

//Refresh without disturbing what is on screen - see the silent flag above
function reloadTrashListingSilently(){
    loadTrashListing(undefined, true);
}

/*
    Appends one freshly discovered row to whichever layout is on screen.
    Returns false when there is nothing to append to yet, leaving the caller to
    draw the whole view instead.
*/
function appendTrashRowLive(item){
    let cardLayout = useTrashCardLayout();
    let container = cardLayout ? $(".fmTrashCards") : $(".fmTrashTable tbody");
    if (container.length == 0){
        return false;
    }

    let name = String(item.OriginalFilename == undefined ? "" : item.OriginalFilename);
    if (trashSearchKeyword != "" &&
        !trashSearchMatcher(trashSearchKeyword, searchCaseSensitive)(name)){
        //Held back by the active filter, though it still counts towards the bin
        return true;
    }
    if ((trashKindFilter == "file" && item.IsDir) ||
        (trashKindFilter == "folder" && !item.IsDir)){
        return true;
    }

    container.find(".fmTrashEmptyRow").remove();
    /*
        Rows are appended in the order the server walks the tree; the sort is
        applied once the scan finishes rather than reshuffling the list on
        every arrival.
    */
    let markup = cardLayout ? renderTrashCard(item) : renderTrashRow(item);
    let scanRow = container.find(".fmTrashScanRow");
    if (scanRow.length > 0){
        scanRow.before(markup);
    }else{
        container.append(markup);
    }
    return true;
}

//The counters that would otherwise only be right after a full redraw
function updateTrashLiveCounters(){
    let usedBytes = currentTrashUsedBytes();
    $(".fmTrashUsageValue").text(bytesToSize(usedBytes));
    if (trashQuotaBytes > 0){
        $(".fmTrashUsageFill").css("width",
            Math.min(100, (usedBytes / trashQuotaBytes) * 100).toFixed(1) + "%");
    }
    $("#selectInfo").text(applocale.getString("message/itemCount", "%d items")
        .replace("%d", visibleTrashItems().length));
    //The chip counts describe the whole bin, so they move as it is discovered
    let chips = $(".fmTrashChips");
    if (chips.length > 0){
        chips.replaceWith(renderTrashChips());
    }
}

function currentTrashUsedBytes(){
    let usedBytes = 0;
    for (let i = 0; i < trashItems.length; i++){
        if (!trashItems[i].IsDir){
            usedBytes += trashItems[i].Filesize;
        }
    }
    return usedBytes;
}

/*
    Sits at the end of the list while the server is still walking the tree.

    The flex box is an inner element rather than the cell itself: display:flex
    on a <td> takes it out of the table's formatting context, which drops the
    colspan and squeezes the row into the width of the first column.
*/
function trashScanRow(){
    return '<tr class="fmTrashScanRow"><td colspan="8" class="fmTrashScanning">' +
        '<span class="fmTrashScanInner">' +
            '<span class="fmTrashSpinner"></span><span>' +
            applocale.getString("trash/scanning", "Scanning for deleted files") +
            '</span>' +
        '</span></td></tr>';
}

function trashScanCard(){
    return '<div class="fmTrashScanRow fmTrashScanning">' +
        '<span class="fmTrashScanInner">' +
            '<span class="fmTrashSpinner"></span><span>' +
            applocale.getString("trash/scanning", "Scanning for deleted files") +
            '</span>' +
        '</span></div>';
}

/*
    Which of the two layouts to draw.

    The table needs six columns to make sense; below that it turns into a
    horizontally scrolling strip that is unusable on a phone, so the same rows
    are drawn as a stack of cards with the actions moved to a bar along the
    bottom. Measured on the file area, not the viewport - see the constants in
    state.js.
*/
function isTrashCardWidth(width){
    return width > 0 && width < FM_TRASH_CARD_MAX_WIDTH;
}

function useTrashCardLayout(){
    return isMobile || isTrashCardWidth($("#folderView").width());
}

function drawTrashView(){
    let usedBytes = currentTrashUsedBytes();

    if (useTrashCardLayout()){
        drawTrashCardView(usedBytes);
        return;
    }

    /*
        The quota header always describes the whole bin - a search narrows what
        is listed, not what is stored - so only the table works off the filter.
    */
    let visibleItems = visibleTrashItems();
    let rows = visibleItems.map(renderTrashRow).join("");
    if (visibleItems.length == 0 && !trashScanning){
        /*
            Only once the scan is done does an empty table mean an empty bin -
            during one it just means nothing has turned up yet.
        */
        rows = '<tr class="fmTrashEmptyRow"><td colspan="8" class="fmTrashEmpty">' +
            (trashSearchKeyword == "" && trashKindFilter == "all"
                ? applocale.getString("trash/empty", "The trash bin is empty")
                : applocale.getString("trash/noMatch", "No items match your search")) + '</td></tr>';
    }
    if (trashScanning){
        //Kept last, so rows found from here on are inserted above it
        rows += trashScanRow();
    }

    $("#folderList").html(
        renderTrashHeader(usedBytes) +
        '<table class="fmTrashTable"><thead><tr>' +
            '<th class="fmTrashColCheck"><span class="fmTrashCheck" id="fmTrashSelectAll" onclick="toggleTrashSelectAll();"></span></th>' +
            trashHeaderCell("name",      applocale.getString("trash/col/name", "Name")) +
            trashHeaderCell("origin",    applocale.getString("trash/col/origin", "Original Location"),
                                         "fmTrashColOrigin") +
            trashHeaderCell("deleted",   applocale.getString("trash/col/deleted", "Deleted")) +
            trashHeaderCell("size",      applocale.getString("trash/col/size", "Size")) +
            trashHeaderCell("remaining", applocale.getString("trash/col/remaining", "Time Left")) +
            '<th colspan="2"></th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>' +
        '<div class="fmTrashFootnote"><span class="fmTrashFootIcon">' + FSIcons.info + '</span><span>' +
            trashFootnoteText() +
        '</span></div>');

    updateTrashSelectionState();
    $("#selectInfo").text(applocale.getString("message/itemCount", "%d items")
        .replace("%d", visibleItems.length));
}

/*
    Wording shared by both layouts, so the table and the cards cannot drift
    apart when the retention setting changes what there is to say.
*/
function trashDescText(){
    return trashRetentionDays > 0
        ? applocale.getString("trash/desc",
            "These files have been deleted and will be removed permanently after %d days.")
            .replace("%d", trashRetentionDays)
        : applocale.getString("trash/descNoExpiry",
            "These files have been deleted. They are kept until you empty the trash bin.");
}

function trashFootnoteText(){
    return trashRetentionDays > 0
        ? applocale.getString("trash/footnote",
            "Files are permanently removed after %d days. You can also empty the bin yourself.")
            .replace("%d", trashRetentionDays)
        : applocale.getString("trash/footnoteNoExpiry",
            "Files are kept until you empty the trash bin. Automatic removal can be turned on in System Settings.");
}

/*
    Card layout

    The phone rendering of the same list. Everything it shows comes from the
    same state the table uses, so sorting, searching, selection and the row
    menu all keep working - only the markup differs.
*/
function drawTrashCardView(usedBytes){
    let visibleItems = visibleTrashItems();

    let rows = visibleItems.map(renderTrashCard).join("");
    if (visibleItems.length == 0 && !trashScanning){
        rows = '<div class="fmTrashEmptyRow fmTrashEmpty">' +
            (trashSearchKeyword == "" && trashKindFilter == "all"
                ? applocale.getString("trash/empty", "The trash bin is empty")
                : applocale.getString("trash/noMatch", "No items match your search")) + '</div>';
    }
    if (trashScanning){
        rows += trashScanCard();
    }

    $("#folderList").html(
        renderTrashCardHeader(usedBytes) +
        renderTrashChips() +
        '<div class="fmTrashCards">' + rows + '</div>' +
        '<div class="fmTrashFootnote"><span class="fmTrashFootIcon">' + FSIcons.info + '</span><span>' +
            trashFootnoteText() + '</span></div>' +
        renderTrashActionBar());

    updateTrashSelectionState();
    $("#selectInfo").text(applocale.getString("message/itemCount", "%d items")
        .replace("%d", visibleItems.length));
}

function renderTrashCardHeader(usedBytes){
    let hasQuota = trashQuotaBytes > 0;
    let percent = hasQuota ? Math.min(100, (usedBytes / trashQuotaBytes) * 100) : 0;
    return '<div class="fmTrashCardHead">' +
        '<div class="fmTrashCardTop">' +
            '<div class="fmTrashIcon">' + FSIcons.trashBig + '</div>' +
            '<div class="fmTrashHeadText">' +
                '<div class="fmTrashTitle">' + applocale.getString("trash/title", "Trash Bin") + '</div>' +
                '<div class="fmTrashDesc">' + trashDescText() + '</div>' +
            '</div>' +
        '</div>' +
        '<div class="fmTrashCardUsage">' +
            '<div class="fmTrashUsageLabel">' + applocale.getString("trash/used", "Space Used") + '</div>' +
            '<div class="fmTrashUsageRow">' +
                '<span class="fmTrashUsageValue">' + bytesToSize(usedBytes) + '</span>' +
                '<span class="fmTrashUsageTotal">' + (hasQuota
                    ? applocale.getString("trash/total", "Total %s").replace("%s", bytesToSize(trashQuotaBytes))
                    : applocale.getString("trash/nolimit", "No size limit")) + '</span>' +
            '</div>' +
            (hasQuota ? '<div class="fmTrashUsageBar"><div class="fmTrashUsageFill" style="width: ' +
                percent.toFixed(1) + '%;"></div></div>' : '') +
        '</div>' +
        '<button class="fmTrashCardEmptyBtn" onclick="confirmEmptyTrashBin();">' +
            '<span class="fmTrashBtnIcon">' + FSIcons.trash + '</span>' +
            '<span>' + applocale.getString("trash/emptybtn", "Empty Trash Bin") + '</span>' +
        '</button>' +
    '</div>';
}

/*
    All / Files / Folders, with a live count on each. The counts ignore the
    chip filter itself but honour an active search, so they describe what
    tapping that chip would actually show.
*/
function renderTrashChips(){
    let searched = trashSearchKeyword == ""
        ? trashItems
        : trashItems.filter(function(item){
            return trashSearchMatcher(trashSearchKeyword, searchCaseSensitive)(
                String(item.OriginalFilename == undefined ? "" : item.OriginalFilename));
        });
    let folders = searched.filter(function(item){ return item.IsDir; }).length;

    function chip(kind, label, count){
        return '<button class="fmTrashChip' + (trashKindFilter == kind ? " active" : "") +
            '" onclick="setTrashKindFilter(&quot;' + kind + '&quot;);">' +
            label + ' (' + count + ')</button>';
    }

    return '<div class="fmTrashChips">' +
        chip("all",    applocale.getString("trash/kind/all", "All"), searched.length) +
        chip("file",   applocale.getString("trash/kind/files", "Files"), searched.length - folders) +
        chip("folder", applocale.getString("trash/kind/folders", "Folders"), folders) +
        '<span class="fmTrashChipSpacer"></span>' +
        '<button class="fmTrashChipMore" title="Sort" onclick="toggleTrashBulkMenu(event);">' +
            FSIcons.sort + '</button>' +
        '<div class="fsMenu fmTrashBulkMenu" id="fmTrashBulkMenu">' +
            trashSortMenuItems() +
        '</div>' +
    '</div>';
}

//The column headers have nowhere to live in this layout, so sorting moves here
function trashSortMenuItems(){
    let fields = [
        ["name",      applocale.getString("trash/col/name", "Name")],
        ["deleted",   applocale.getString("trash/col/deleted", "Deleted")],
        ["size",      applocale.getString("trash/col/size", "Size")],
        ["remaining", applocale.getString("trash/col/remaining", "Time Left")]
    ];
    return fields.map(function(f){
        let mark = trashSortKey == f[0] ? (trashSortAsc ? " \u2191" : " \u2193") : "";
        return '<div class="fsMenuItem" onclick="sortTrashBy(&quot;' + f[0] + '&quot;);">' +
            '<span>' + f[1] + mark + '</span></div>';
    }).join("");
}

function renderTrashCard(item){
    let displayName = item.OriginalFilename;
    //smallGlyph draws the same yellow folder and generated file glyphs the
    //file list uses, so a trashed item looks like it did before it was deleted
    let icon = FileThumb.smallGlyph(displayName, item.IsDir);
    let key = encodeURIComponent(item.Filepath);
    /*
        Folders report no meaningful size, so they say what they are instead -
        the "--" the table shows would read as missing information here.
    */
    let meta = item.IsDir
        ? applocale.getString("trash/typeFolder", "Folder")
        : bytesToSize(item.Filesize) + '  &middot;  ' + escapeTrashText(item.RemoveDate);

    return '<div class="fmTrashRow fmTrashCardRow" data-key="' + key + '">' +
        '<span class="fmTrashCheck" onclick="toggleTrashRow(&quot;' + key + '&quot;);"></span>' +
        '<span class="fmTrashCardIcon">' + icon + '</span>' +
        '<div class="fmTrashCardText">' +
            '<div class="fmTrashCardName">' + escapeTrashText(displayName) + '</div>' +
            '<div class="fmTrashCardMeta">' + meta + '</div>' +
        '</div>' +
        '<span class="fmTrashCardDays">' + formatTrashRemaining(item.RemoveTimestamp) + '</span>' +
        '<button class="fmTrashRowMore" title="More" onclick="toggleTrashRowMenu(event, &quot;' + key + '&quot;);">' +
            FSIcons.more + '</button>' +
    '</div>';
}

/*
    Restore and delete move out of each row and into a bar along the bottom,
    where they act on the selection - there is no room for a button per row at
    this width, and the row menu still covers the single item case.
*/
function renderTrashActionBar(){
    return '<div class="fmTrashActionBar">' +
        '<span class="fmTrashCheck" id="fmTrashSelectAll" onclick="toggleTrashSelectAll();"></span>' +
        '<span class="fmTrashBarCount" id="fmTrashBarCount"></span>' +
        '<button class="fmTrashBarBtn" onclick="restoreSelectedTrash();">' +
            '<span class="fmTrashBtnIcon">' + FSIcons.restore + '</span>' +
            '<span>' + applocale.getString("trash/restore", "Restore") + '</span></button>' +
        '<button class="fmTrashBarBtn danger" onclick="deleteSelectedTrash();">' +
            '<span class="fmTrashBtnIcon">' + FSIcons.trash + '</span>' +
            '<span>' + applocale.getString("trash/deletePermanently", "Delete Permanently") + '</span></button>' +
    '</div>';
}

function renderTrashHeader(usedBytes){
    /*
        With no quota set there is nothing to fill, so the bar is dropped rather
        than shown permanently empty - the used figure still tells the whole
        story on its own.
    */
    let hasQuota = trashQuotaBytes > 0;
    let percent = hasQuota ? Math.min(100, (usedBytes / trashQuotaBytes) * 100) : 0;
    return '<div class="fmTrashHeader">' +
        '<div class="fmTrashIcon">' + FSIcons.trashBig + '</div>' +
        '<div class="fmTrashHeadText">' +
            '<div class="fmTrashTitle">' + applocale.getString("trash/title", "Trash Bin") + '</div>' +
            '<div class="fmTrashDesc">' + trashDescText() + '</div>' +
        '</div>' +
        '<div class="fmTrashUsage">' +
            '<div class="fmTrashUsageLabel">' + applocale.getString("trash/used", "Space Used") + '</div>' +
            '<div class="fmTrashUsageValue">' + bytesToSize(usedBytes) + '</div>' +
            (hasQuota ? '<div class="fmTrashUsageBar"><div class="fmTrashUsageFill" style="width: ' +
                percent.toFixed(1) + '%;"></div></div>' : '') +
            '<div class="fmTrashUsageTotal">' + (hasQuota
                ? applocale.getString("trash/quota", "of %s").replace("%s", bytesToSize(trashQuotaBytes))
                : applocale.getString("trash/nolimit", "No size limit")) + '</div>' +
        '</div>' +
        '<button class="fmTrashEmptyBtn" onclick="confirmEmptyTrashBin();">' +
            '<span class="fmTrashBtnIcon">' + FSIcons.trash + '</span>' +
            '<span>' + applocale.getString("trash/emptybtn", "Empty Trash Bin") + '</span>' +
        '</button>' +
        '<button class="fmTrashMoreBtn" title="More" onclick="toggleTrashBulkMenu(event);">' + FSIcons.more + '</button>' +
        '<div class="fsMenu fmTrashBulkMenu" id="fmTrashBulkMenu">' +
            '<div class="fsMenuItem" onclick="restoreSelectedTrash();">' +
                '<span class="fsMenuIcon">' + FSIcons.restore + '</span><span>' +
                applocale.getString("trash/restoreSelected", "Restore Selected") + '</span></div>' +
            '<div class="fsMenuItem" onclick="deleteSelectedTrash();">' +
                '<span class="fsMenuIcon">' + FSIcons.trash + '</span><span>' +
                applocale.getString("trash/deleteSelected", "Delete Selected Permanently") + '</span></div>' +
        '</div>' +
    '</div>';
}

function renderTrashRow(item){
    /*
        The stored filename carries the removal timestamp as its extension, so
        the readable name is the one the listing reports separately.
    */
    let displayName = item.OriginalFilename;
    let icon = item.IsDir ? FSIcons.folder : FileThumb.smallGlyph(displayName, false);
    let size = item.IsDir ? "--" : bytesToSize(item.Filesize);
    let key = encodeURIComponent(item.Filepath);

    return '<tr class="fmTrashRow" data-key="' + key + '">' +
        '<td class="fmTrashColCheck"><span class="fmTrashCheck" onclick="toggleTrashRow(&quot;' + key + '&quot;);"></span></td>' +
        '<td><span class="fmTrashName"><span class="fmTrashRowIcon">' + icon +
            '</span><span class="fmTrashNameText">' + escapeTrashText(displayName) + '</span></span></td>' +
        '<td class="fmTrashDim fmTrashColOrigin">' + escapeTrashText(item.OriginalPath) + '</td>' +
        '<td class="fmTrashDim">' + escapeTrashText(item.RemoveDate) + '</td>' +
        '<td class="fmTrashDim">' + size + '</td>' +
        '<td class="fmTrashDim">' + formatTrashRemaining(item.RemoveTimestamp) + '</td>' +
        '<td class="fmTrashActionCell"><button class="fmTrashRestoreBtn" onclick="restoreTrashItem(&quot;' + key + '&quot;);">' +
            applocale.getString("trash/restore", "Restore") + '</button></td>' +
        '<td class="fmTrashActionCell"><button class="fmTrashRowMore" title="More" onclick="toggleTrashRowMenu(event, &quot;' + key + '&quot;);">' +
            FSIcons.more + '</button></td>' +
    '</tr>';
}

/*
    Remaining time is derived here rather than read from the server, because
    nothing expires trashed files yet - it is the retention constant counting
    down from the removal timestamp, and becomes real once the server enforces
    a retention policy.
*/
function formatTrashRemaining(removeTimestamp){
    if (trashRetentionDays <= 0){
        //Nothing expires, so there is no countdown to show
        return applocale.getString("trash/keptForever", "Kept");
    }
    let elapsedDays = (Date.now() / 1000 - removeTimestamp) / 86400;
    let left = Math.ceil(trashRetentionDays - elapsedDays);
    if (left <= 0){
        return applocale.getString("trash/expiring", "Today");
    }
    return applocale.getString("trash/daysLeft", "%d days").replace("%d", left);
}

//Names and paths come from the file system, so escape before they go into html
function escapeTrashText(text){
    return String(text == undefined ? "" : text)
        .split("&").join("&amp;")
        .split("<").join("&lt;")
        .split(">").join("&gt;");
}

/*
    Search

    The bin's rows come from the trash API, not from a directory listing, so
    the server side search cannot see them. The File Manager hands the keyword
    over here instead (see the "search" entry in the registration at the bottom
    of this file) and the filtering is done against the listing already held in
    trashItems - no second request, and the quota header stays accurate.

    The two keyword shapes match what the normal search accepts, so the box
    behaves the same wherever the user happens to be:

        report          plain substring of the original file name
        /*.mp3          wildcard pattern, * and ? supported
*/
function trashSearchMatcher(keyword, caseSensitive){
    let pattern = String(keyword);
    let isWildcard = pattern.substr(0, 1) == "/";
    if (isWildcard){
        pattern = pattern.substr(1);
    }
    if (!caseSensitive){
        pattern = pattern.toLowerCase();
    }

    if (!isWildcard){
        return function(name){
            return (caseSensitive ? name : name.toLowerCase()).indexOf(pattern) != -1;
        };
    }

    /*
        Everything the regex engine treats specially is escaped except * and ?,
        which are then translated - so a name with brackets or a dot in it
        cannot turn into a pattern of its own.
    */
    let expanded = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
                          .replace(/\*/g, ".*")
                          .replace(/\?/g, ".");
    let matcher = new RegExp("^" + expanded + "$");
    return function(name){
        return matcher.test(caseSensitive ? name : name.toLowerCase());
    };
}

//The rows the current keyword leaves on screen
function visibleTrashItems(){
    let matches = trashSearchKeyword == ""
        ? null
        : trashSearchMatcher(trashSearchKeyword, searchCaseSensitive);
    if (matches == null && trashKindFilter == "all"){
        return trashItems;
    }
    return trashItems.filter(function(item){
        if (trashKindFilter == "file" && item.IsDir){
            return false;
        }
        if (trashKindFilter == "folder" && !item.IsDir){
            return false;
        }
        if (matches == null){
            return true;
        }
        return matches(String(item.OriginalFilename == undefined ? "" : item.OriginalFilename));
    });
}

//Chips in the card layout; the table has sortable columns instead
function setTrashKindFilter(kind){
    trashKindFilter = kind;
    //Rows the filter hides must not stay selected behind it
    trashSelection = {};
    drawTrashView();
}

/*
    Entry point registered on the special view. An empty keyword drops the
    filter rather than matching nothing, which is what leaving the search box
    empty means everywhere else.
*/
function searchTrashBin(keyword){
    trashSearchKeyword = String(keyword == undefined ? "" : keyword).trim();
    //A row the filter hides must not stay selected behind it, or Restore and
    //Delete would act on something the user can no longer see
    trashSelection = {};

    if (trashItems.length == 0){
        //Searching before the listing arrived - fetch it, the filter is applied
        //when it draws
        loadTrashListing();
        return;
    }
    drawTrashView();
}

/*
    Selection
*/
function toggleTrashRow(key){
    if (trashSelection[key]){
        delete trashSelection[key];
    }else{
        trashSelection[key] = true;
    }
    updateTrashSelectionState();
}

function toggleTrashSelectAll(){
    //Only the rows a search leaves on screen - selecting hidden ones would be
    //acting on files the user cannot see
    let visibleItems = visibleTrashItems();
    let allSelected = visibleItems.length > 0 &&
                      Object.keys(trashSelection).length == visibleItems.length;
    trashSelection = {};
    if (!allSelected){
        visibleItems.forEach(function(item){
            trashSelection[encodeURIComponent(item.Filepath)] = true;
        });
    }
    updateTrashSelectionState();
}

function updateTrashSelectionState(){
    $(".fmTrashRow").each(function(){
        let on = trashSelection[$(this).attr("data-key")] === true;
        $(this).toggleClass("selected", on);
        $(this).find(".fmTrashCheck").toggleClass("checked", on);
    });
    let count = Object.keys(trashSelection).length;
    $("#fmTrashSelectAll").toggleClass("checked", count > 0 && count == visibleTrashItems().length);
    let label = applocale.getString("message/selectedCount", "%d selected").replace("%d", count);
    $("#fmSelectionSize").text(count > 0 ? label : "");
    /*
        The card layout's bar always shows the count, including zero: it is the
        only thing explaining what its two buttons will act on.
    */
    $("#fmTrashBarCount").text(label);
    $(".fmTrashActionBar").toggleClass("hasSelection", count > 0);
}

function selectedTrashPaths(){
    return Object.keys(trashSelection).map(decodeURIComponent);
}

/*
    Actions
*/
function restoreTrashItem(key){
    restoreTrashPaths([decodeURIComponent(key)]);
}

/*
    Restores run one after another rather than in parallel: each moves a file
    back into the tree, and the listing is only correct once they have all
    finished. A single failure is reported but does not stop the rest.
*/
function restoreTrashPaths(paths){
    if (paths.length == 0){
        return;
    }
    let remaining = paths.slice();
    function next(){
        if (remaining.length == 0){
            msgbox("checkmark", applocale.getString("trash/restored", "Restored"));
            /*
                Silent: the list is rescanned in the background and swapped in
                when it is ready, so someone working through the bin keeps the
                rows they were about to act on instead of being dropped back to
                a loading message after every restore.
            */
            reloadTrashListingSilently();
            return;
        }
        $.ajax({
            url: "../../system/file_system/restoreTrash",
            method: "POST",
            data: {src: remaining.shift()},
            success: function(data){
                if (data.error !== undefined){
                    msgbox("red remove", data.error);
                }
                next();
            },
            error: function(){
                msgbox("red remove", applocale.getString("trash/restoreFailed", "Restore failed"));
                next();
            }
        });
    }
    next();
}

function restoreSelectedTrash(){
    closeTrashMenus();
    let paths = selectedTrashPaths();
    if (paths.length == 0){
        msgbox("question", applocale.getString("message/No file selected", "No file selected"));
        return;
    }
    restoreTrashPaths(paths);
}

/*
    Permanent delete confirmation

    Everything else in the File Manager can be walked back - a delete goes to
    the bin, and the bin can restore it. These two cannot, so they are the ones
    that ask first. The pending work is held here rather than on the dialog, so
    a stale dialog cannot act on a selection the user has moved on from.
*/
let trashDeletePendingPaths = [];
let trashDeleteEmptiesBin = false;

function showTrashDeleteConfirm(description){
    $("#trashDeleteConfirmBox").find(".trashConfirmDesc").text(description);
    showPopupWrapper();
    $("#trashDeleteConfirmBox").transition("slide left in");
}

//Confirm before purging the given entries
function confirmTrashDelete(paths){
    if (paths == undefined || paths.length == 0){
        return;
    }
    trashDeletePendingPaths = paths.slice();
    trashDeleteEmptiesBin = false;
    showTrashDeleteConfirm(applocale.getString("trash/confirm/descItems",
        "%d item(s) will be permanently deleted. This cannot be undone.")
        .replace("%d", paths.length));
}

//Confirm before emptying the bin, which is the same thing to everything in it
function confirmEmptyTrashBin(){
    closeTrashMenus();
    if (trashItems.length == 0){
        return;
    }
    trashDeletePendingPaths = [];
    trashDeleteEmptiesBin = true;
    showTrashDeleteConfirm(applocale.getString("trash/confirm/descEmpty",
        "Everything in the trash bin will be permanently deleted. This cannot be undone."));
}

function trashDeleteConfirmed(){
    hideAllPopupWindows();
    if (trashDeleteEmptiesBin){
        emptyTrashBin();
        return;
    }
    if (trashDeletePendingPaths.length > 0){
        deleteTrashPaths(trashDeletePendingPaths.slice());
    }
}

function deleteTrashPaths(paths){
    if (paths.length == 0){
        return;
    }
    requestCSRFToken(function(token){
        $.ajax({
            url: "../../system/file_system/fileOpr",
            method: "POST",
            data: {opr: "delete", src: JSON.stringify(paths), csrft: token},
            success: function(data){
                if (data.error !== undefined){
                    msgbox("red remove", data.error);
                }else{
                    msgbox("checkmark", applocale.getString("trash/deleted", "Deleted permanently"));
                }
                //Rescanned in the background - see the note in restoreTrashPaths
                reloadTrashListingSilently();
            },
            error: function(){
                msgbox("red remove", applocale.getString("trash/deleteFailed", "Delete failed"));
                reloadTrashListingSilently();
            }
        });
    });
}

function deleteSelectedTrash(){
    closeTrashMenus();
    let paths = selectedTrashPaths();
    if (paths.length == 0){
        msgbox("question", applocale.getString("message/No file selected", "No file selected"));
        return;
    }
    confirmTrashDelete(paths);
}

function emptyTrashBin(){
    if (trashItems.length == 0){
        return;
    }
    $.get("../../system/file_system/clearTrash", function(data){
        if (data !== null && data !== undefined && data.error !== undefined){
            msgbox("red remove", data.error);
        }else{
            msgbox("checkmark", applocale.getString("trash/emptied", "Trash bin emptied"));
        }
        reloadTrashListingSilently();
    });
}

/*
    Row and bulk menus
*/
function toggleTrashRowMenu(event, key){
    event.stopPropagation();
    closeTrashMenus();
    let menu = $('<div class="fsMenu fmTrashRowMenu open">' +
        '<div class="fsMenuItem" onclick="restoreTrashItem(&quot;' + key + '&quot;); closeTrashMenus();">' +
            '<span class="fsMenuIcon">' + FSIcons.restore + '</span><span>' +
            applocale.getString("trash/restore", "Restore") + '</span></div>' +
        '<div class="fsMenuItem" onclick="showTrashItemDetails(&quot;' + key + '&quot;);">' +
            '<span class="fsMenuIcon">' + FSIcons.info + '</span><span>' +
            applocale.getString("trash/details", "Details") + '</span></div>' +
        '<div class="fsMenuSep"></div>' +
        '<div class="fsMenuItem" onclick="closeTrashMenus(); confirmTrashDelete([decodeURIComponent(&quot;' + key + '&quot;)]);">' +
            '<span class="fsMenuIcon">' + FSIcons.trash + '</span><span>' +
            applocale.getString("trash/deleteOne", "Delete Permanently") + '</span></div>' +
    '</div>');
    $("body").append(menu);

    //Clamp to the viewport, the same rule the file context menu uses
    let width = menu.outerWidth();
    let height = menu.outerHeight();
    let left = Math.min(event.clientX, window.innerWidth - width - 6);
    let top = Math.min(event.clientY, window.innerHeight - height - 6);
    menu.css({left: Math.max(6, left) + "px", top: Math.max(6, top) + "px"});
}

function toggleTrashBulkMenu(event){
    event.stopPropagation();
    let menu = $("#fmTrashBulkMenu");
    let wasOpen = menu.hasClass("open");
    closeTrashMenus();
    if (!wasOpen){
        menu.addClass("open");
    }
}

function closeTrashMenus(){
    $("#fmTrashBulkMenu").removeClass("open");
    $(".fmTrashRowMenu").remove();
}

$(document).on("click", function(event){
    if ($(event.target).closest("#fmTrashBulkMenu, .fmTrashRowMenu, .fmTrashMoreBtn, .fmTrashRowMore").length == 0){
        closeTrashMenus();
    }
});


/*
    Column sorting

    Sorted here rather than server side: the listing arrives whole and is small,
    and the sort mode the nav bar stores is per folder, which this view has none
    of.
*/
function trashHeaderCell(key, label, extraClass = ""){
    let active = trashSortKey == key;
    let mark = active ? (trashSortAsc ? "&#8593;" : "&#8595;") : "";
    return '<th class="fmTrashSortable' + (active ? " sorted" : "") +
        (extraClass == "" ? "" : " " + extraClass) +
        '" onclick="sortTrashBy(&quot;' + key + '&quot;);">' + label +
        '<span class="fmTrashSortMark">' + mark + '</span></th>';
}

function sortTrashBy(key){
    if (trashSortKey == key){
        trashSortAsc = !trashSortAsc;
    }else{
        trashSortKey = key;
        //Names read best A-Z, but times and sizes are most useful largest first
        trashSortAsc = (key == "name" || key == "origin");
    }
    applyTrashSort();
    drawTrashView();
}

function applyTrashSort(){
    let dir = trashSortAsc ? 1 : -1;
    trashItems.sort(function(a, b){
        let result = 0;
        if (trashSortKey == "name"){
            result = String(a.OriginalFilename).localeCompare(String(b.OriginalFilename));
        }else if (trashSortKey == "origin"){
            result = String(a.OriginalPath).localeCompare(String(b.OriginalPath));
        }else if (trashSortKey == "size"){
            //Folders report no size, so they sort as zero rather than drifting
            result = (a.IsDir ? 0 : a.Filesize) - (b.IsDir ? 0 : b.Filesize);
        }else{
            /*
                "deleted" and "remaining" are the same underlying number: time
                left is the retention window measured from the removal
                timestamp, so sorting either sorts both.
            */
            result = a.RemoveTimestamp - b.RemoveTimestamp;
        }
        if (result == 0){
            //Stable enough to stop equal timestamps shuffling between redraws
            result = String(a.OriginalFilename).localeCompare(String(b.OriginalFilename));
        }
        return result * dir;
    });
}

/*
    Per row details

    The narrow layout drops the origin and deleted columns, so this is how those
    stay reachable on a phone. It reuses the file operation dialog markup, which
    brings the card styling and the scrim close behaviour with it.
*/
/*
    The File Info button, answered for the row the user has ticked. The details
    dialog describes one entry, so a multiple selection has no single answer to
    give.
*/
function showSelectedTrashDetails(){
    closeTrashMenus();
    let keys = Object.keys(trashSelection);
    if (keys.length == 0){
        msgbox("question", applocale.getString("message/No file selected", "No file selected"));
        return;
    }
    if (keys.length > 1){
        msgbox("question", applocale.getString("trash/oneAtATime",
            "Select a single item to see its details"));
        return;
    }
    showTrashItemDetails(keys[0]);
}

function showTrashItemDetails(key){
    closeTrashMenus();
    let filepath = decodeURIComponent(key);
    let item = null;
    for (let i = 0; i < trashItems.length; i++){
        if (trashItems[i].Filepath == filepath){
            item = trashItems[i];
            break;
        }
    }
    if (item == null){
        return;
    }

    let rows = [
        [applocale.getString("trash/col/name", "Name"), escapeTrashText(item.OriginalFilename)],
        [applocale.getString("trash/col/origin", "Original Location"), escapeTrashText(item.OriginalPath)],
        [applocale.getString("trash/col/deleted", "Deleted"), escapeTrashText(item.RemoveDate)],
        [applocale.getString("trash/col/size", "Size"), item.IsDir ? "--" : bytesToSize(item.Filesize)],
        [applocale.getString("trash/col/remaining", "Time Left"), formatTrashRemaining(item.RemoveTimestamp)]
    ];
    let html = rows.map(function(r){
        return '<tr><td class="fmTrashDetailKey">' + r[0] + '</td><td>' + r[1] + '</td></tr>';
    }).join("");

    $("#trashDetailsBox").find(".fmTrashDetailTable").html(html);
    //Rebound per item rather than read from a global, so a stale dialog cannot
    //restore the wrong file
    $("#trashDetailsBox").find(".fmTrashDetailRestore").off("click").on("click", function(){
        hideAllPopupWindows();
        restoreTrashItem(key);
    });
    showPopupWrapper();
    $("#trashDetailsBox").transition("slide left in");
}

/*
    Registration

    Done at load time so listDirectory() and the path bar can find this view
    without either of them needing to know what a trash bin is.
*/
registerSpecialView(TRASH_VPATH, {
    icon: "trash",
    labelKey: "trash/title",
    labelFallback: "Trash Bin",
    hideViewModes: true,
    hidePropertiesPane: true,
    sidebar: true,                  //Gets its own entry under the storage devices
    /*
        Nothing in the bin can be opened, renamed, copied into or uploaded to -
        the entries are not where they claim to be, and the bin is not a
        directory. What is left is navigation, plus the two things the bin can
        genuinely do with a selection.
    */
    toolbar: ["home", "refresh", "delete", "fileinfo"],
    toolbarHandlers: {
        delete: function(){
            deleteSelectedTrash();
        },
        fileinfo: function(){
            showSelectedTrashDetails();
        }
    },
    render: function(callback){
        renderTrashView(callback);
    },
    open: function(){
        openTrashBin();
    },
    //Navigating away drops a scan that is still walking the tree
    leave: function(){
        trashScanning = false;
        closeTrashScanSocket();
    },
    //Searching the bin is this file's business, not the File Manager's
    search: function(keyword){
        searchTrashBin(keyword);
    }
});


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.openTrashBin = openTrashBin;
window.emptyTrashBin = emptyTrashBin;
window.restoreTrashItem = restoreTrashItem;
window.deleteTrashPaths = deleteTrashPaths;
window.confirmTrashDelete = confirmTrashDelete;
window.confirmEmptyTrashBin = confirmEmptyTrashBin;
window.trashDeleteConfirmed = trashDeleteConfirmed;
window.restoreSelectedTrash = restoreSelectedTrash;
window.deleteSelectedTrash = deleteSelectedTrash;
window.toggleTrashRow = toggleTrashRow;
window.toggleTrashSelectAll = toggleTrashSelectAll;
window.toggleTrashRowMenu = toggleTrashRowMenu;
window.toggleTrashBulkMenu = toggleTrashBulkMenu;
window.closeTrashMenus = closeTrashMenus;
window.sortTrashBy = sortTrashBy;
window.showTrashItemDetails = showTrashItemDetails;
window.showSelectedTrashDetails = showSelectedTrashDetails;
window.loadTrashListing = loadTrashListing;
window.searchTrashBin = searchTrashBin;
window.reloadTrashListingSilently = reloadTrashListingSilently;
window.setTrashKindFilter = setTrashKindFilter;
window.isTrashCardWidth = isTrashCardWidth;
window.refreshTrashLayoutOnResize = refreshTrashLayoutOnResize;
