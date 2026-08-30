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
    $("#folderList").show().html('<div class="fmTrashLoading">' +
        applocale.getString("message/loading", "Loading") + '</div>');

    trashSelection = {};
    //Navigating in is a fresh look at the whole bin, not a continuation of
    //whatever was last searched for
    trashSearchKeyword = "";

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

function loadTrashListing(callback){
    $.get("../../system/file_system/listTrash", function(data){
        trashItems = (data == null || data.error !== undefined) ? [] : data;
        applyTrashSort();
        drawTrashView();
        if (callback !== undefined){
            callback();
        }
    }).fail(function(){
        trashItems = [];
        drawTrashView();
        if (callback !== undefined){
            callback();
        }
    });
}

function drawTrashView(){
    let usedBytes = 0;
    for (let i = 0; i < trashItems.length; i++){
        if (!trashItems[i].IsDir){
            usedBytes += trashItems[i].Filesize;
        }
    }

    /*
        The quota header always describes the whole bin - a search narrows what
        is listed, not what is stored - so only the table works off the filter.
    */
    let visibleItems = visibleTrashItems();
    let rows = visibleItems.map(renderTrashRow).join("");
    if (visibleItems.length == 0){
        rows = '<tr><td colspan="8" class="fmTrashEmpty">' +
            (trashSearchKeyword == ""
                ? applocale.getString("trash/empty", "The trash bin is empty")
                : applocale.getString("trash/noMatch", "No items match your search")) + '</td></tr>';
    }

    $("#folderList").html(
        renderTrashHeader(usedBytes) +
        '<table class="fmTrashTable"><thead><tr>' +
            '<th class="fmTrashColCheck"><span class="fmTrashCheck" id="fmTrashSelectAll" onclick="toggleTrashSelectAll();"></span></th>' +
            trashHeaderCell("name",      applocale.getString("trash/col/name", "Name")) +
            trashHeaderCell("origin",    applocale.getString("trash/col/origin", "Original Location")) +
            trashHeaderCell("deleted",   applocale.getString("trash/col/deleted", "Deleted")) +
            trashHeaderCell("size",      applocale.getString("trash/col/size", "Size")) +
            trashHeaderCell("remaining", applocale.getString("trash/col/remaining", "Time Left")) +
            '<th colspan="2"></th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>' +
        '<div class="fmTrashFootnote"><span class="fmTrashFootIcon">' + FSIcons.info + '</span><span>' +
            (trashRetentionDays > 0
                ? applocale.getString("trash/footnote",
                    "Files are permanently removed after %d days. You can also empty the bin yourself.")
                    .replace("%d", trashRetentionDays)
                : applocale.getString("trash/footnoteNoExpiry",
                    "Files are kept until you empty the trash bin. Automatic removal can be turned on in System Settings.")) +
        '</span></div>');

    updateTrashSelectionState();
    $("#selectInfo").text(applocale.getString("message/itemCount", "%d items")
        .replace("%d", visibleItems.length));
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
            '<div class="fmTrashDesc">' + (trashRetentionDays > 0
                ? applocale.getString("trash/desc",
                    "These files have been deleted and will be removed permanently after %d days.")
                    .replace("%d", trashRetentionDays)
                : applocale.getString("trash/descNoExpiry",
                    "These files have been deleted. They are kept until you empty the trash bin.")) + '</div>' +
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
        '<button class="fmTrashEmptyBtn" onclick="emptyTrashBin();">' +
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
        '<td class="fmTrashDim">' + escapeTrashText(item.OriginalPath) + '</td>' +
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
    if (trashSearchKeyword == ""){
        return trashItems;
    }
    let matches = trashSearchMatcher(trashSearchKeyword, searchCaseSensitive);
    return trashItems.filter(function(item){
        return matches(String(item.OriginalFilename == undefined ? "" : item.OriginalFilename));
    });
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
    $("#fmSelectionSize").text(count > 0 ?
        applocale.getString("message/selectedCount", "%d selected").replace("%d", count) : "");
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
            renderTrashView();
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
                renderTrashView();
            },
            error: function(){
                msgbox("red remove", applocale.getString("trash/deleteFailed", "Delete failed"));
                renderTrashView();
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
    deleteTrashPaths(paths);
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
        renderTrashView();
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
        '<div class="fsMenuItem" onclick="deleteTrashPaths([decodeURIComponent(&quot;' + key + '&quot;)]); closeTrashMenus();">' +
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
function trashHeaderCell(key, label){
    let active = trashSortKey == key;
    let mark = active ? (trashSortAsc ? "&#8593;" : "&#8595;") : "";
    return '<th class="fmTrashSortable' + (active ? " sorted" : "") +
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
    render: function(callback){
        renderTrashView(callback);
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
window.restoreSelectedTrash = restoreSelectedTrash;
window.deleteSelectedTrash = deleteSelectedTrash;
window.toggleTrashRow = toggleTrashRow;
window.toggleTrashSelectAll = toggleTrashSelectAll;
window.toggleTrashRowMenu = toggleTrashRowMenu;
window.toggleTrashBulkMenu = toggleTrashBulkMenu;
window.closeTrashMenus = closeTrashMenus;
window.sortTrashBy = sortTrashBy;
window.showTrashItemDetails = showTrashItemDetails;
window.loadTrashListing = loadTrashListing;
window.searchTrashBin = searchTrashBin;
