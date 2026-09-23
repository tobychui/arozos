/*
    render.js

    Renders a directory listing into the three view modes.

    Structure: every entry is first normalised into a descriptor by
    buildItemDescriptor(), then handed to one of three small template functions
    (renderListItem / renderGridItem / renderDetailsRow). Previously the folder
    loop and the file loop each carried their own copy of all three templates -
    six near-identical branches - so any change had to be made six times.

    Icon resolution order for a file, highest priority first:
      1. a real thumbnail, painted in later by thumbnail.js
      2. the shortcut's own icon, for .shortcut files
      3. a module-registered icon from extIconRegistry
      4. the bundled PNG icon set for known extensions
      5. FileThumb's drawn glyph, for extensions nothing else recognises

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

//Render filelist --> Convert a file list object into the visable form of file list
function renderDirectory(filelist, callback=undefined){
    prepareViewContainers();

    let folders = [];
    let files = [];
    for (let i = 0; i < filelist.length; i++){
        if (filelist[i].IsDir == true){
            folders.push(filelist[i]);
        }else{
            files.push(filelist[i]);
        }
        currentFilelist.push(JSON.parse(JSON.stringify(filelist[i].Filename)));
    }

    let gridSize = computeGridSize();

    /*
        fileID is a dense index across the whole listing: folders first, then
        files. The shift-range selection loop and getFileObjectFromFID() both
        rely on it being contiguous, so files continue the folder numbering.
    */
    let folderMarkup = [];
    let folderDesc = [];
    for (let i = 0; i < folders.length; i++){
        let d = buildItemDescriptor(folders[i], i, gridSize);
        folderDesc.push(d);
        folderMarkup.push(renderItem(d));
    }

    let fl = folders.length;
    let fileMarkup = [];
    let fileDesc = [];
    for (let i = 0; i < files.length; i++){
        let d = buildItemDescriptor(files[i], fl + i, gridSize);
        fileDesc.push(d);
        fileMarkup.push(renderItem(d));
    }

    appendMarkup("#folderList", folderMarkup);
    appendMarkup("#fileList", applyDateGrouping(fileDesc, fileMarkup));

    $("#folderList").toggle(folders.length > 0);
    $("#fileList").toggle(files.length > 0);

    finaliseRender(folders.length, files.length, callback);
}

/* ---------------------------------------------------------------------- */
/*  Descriptor                                                             */
/* ---------------------------------------------------------------------- */
/*
    Normalises one listDir entry into everything the templates need, so the
    templates stay pure markup and the awkward cases (shortcuts, shared files,
    icon fallbacks) are resolved exactly once.
*/
function buildItemDescriptor(entry, fileID, gridSize){
    let isDir = entry.IsDir == true;
    let ext = getExtFromPath(entry.Filepath);
    let isShortcut = (!isDir && ext == "shortcut");
    let modDate = new Date(entry.ModTime * 1000);

    let d = {
        fileID: fileID,
        filename: entry.Filename,
        filepath: entry.Filepath,
        displayName: entry.Filename,
        isDir: isDir,
        isShortcut: isShortcut,
        isShared: entry.IsShared == true,
        filesize: entry.Filesize,
        displaysize: entry.Displaysize,
        ext: ext,
        gridSize: gridSize,
        type: isDir ? "folder" : (isShortcut ? "shortcut" : "file"),
        modTime: entry.ModTime,
        modTimeText: modDate.toLocaleDateString("default") + " " + modDate.toLocaleTimeString("default"),
        //Grid meta line: folders show nothing, files show their extension
        extLabel: isDir ? "" : ("." + ext)
    };

    //Semantic icon used by the list and details rows
    d.icon = isDir ? "folder" : (ext == "" ? "file outline" : ao_module_utils.getIconFromExt(ext));
    d.iconColour = isDir ? "color:#eab54e;" : "";

    //Grid tile image
    if (isDir){
        d.imagePath = "../../img/desktop/files_icon/" + filesIconTheme + "/folder.png";
    }else{
        d.imagePath = "../../img/desktop/files_icon/" + filesIconTheme + "/" + d.icon + ".png";
        if (d.icon === "file outline" && extIconRegistry[ext]){
            //A module registered itself as the handler for this extension
            d.imagePath = "../../" + extIconRegistry[ext];
        }else if (d.icon === "file outline"){
            //Nothing recognises this extension - draw it rather than showing a
            //blank sheet. Same glyph the File Selector uses.
            d.imagePath = FileThumb.glyphDataURL(entry.Filename, false);
        }
    }

    if (isShortcut && entry.Shortcut != undefined && entry.Shortcut != null){
        applyShortcutOverrides(d, entry.Shortcut);
    }

    d.shareIcon = d.isShared ? `<button class="sharebtn" onclick='handleShareFilebuttonClick(event, this);' style="margin-left: 0; height: 16px;">
                <i class='share alternate icon'></i>
            </button>` : "";

    return d;
}

//A .shortcut file describes its own name, icon and target type
function applyShortcutOverrides(d, shortcut){
    d.displayName = shortcut.Name;

    switch (shortcut.Type){
        case "folder":
            d.icon = "blue folder";
            break;
        case "module":
            d.icon = "blue play circle";
            break;
        default:
            d.icon = "blue external";
    }

    /*
        A shortcut pointing at a sentinel path shows that view's icon, matching
        what the desktop draws for the same file.
    */
    let specialIcon = specialPathIconFrom(shortcut.Path, "../../");
    if (specialIcon != null){
        d.imagePath = specialIcon;
    }else if (shortcut.Icon != undefined && shortcut.Icon != ""){
        d.imagePath = (shortcut.Icon.includes("http://") || shortcut.Icon.includes("https://"))
            ? shortcut.Icon
            : "../../" + shortcut.Icon;
    }

    let typeName = shortcut.Type || "";
    d.extLabel = typeName.charAt(0).toUpperCase() + typeName.slice(1);
}

/* ---------------------------------------------------------------------- */
/*  Templates                                                              */
/* ---------------------------------------------------------------------- */
function renderItem(d){
    if (viewMode == "grid"){
        return renderGridItem(d);
    }else if (viewMode == "details"){
        return renderDetailsRow(d);
    }
    return renderListItem(d);
}

/*
    Attributes every file object carries. Folders additionally accept a drop so
    files can be moved into them; files do not.
*/
function fileObjectAttributes(d){
    let sizeAttrs = d.isDir ? "" : ` filesize="${d.filesize}" displaysize="${d.displaysize}"`;
    let modAttr = ` modtime="${d.modTime}"`;
    //dragstart / drop / dragover / dblclick are delegated on #folderView by
    //bindFileListDelegates(), so rows carry no inline handlers.
    /*
        Dotfiles are dimmed so they read as "shown because you asked", not as
        ordinary content. Decided from the name rather than a server flag: the
        listing carries no hidden field, and a leading dot is the same rule the
        server filters on.

        A data attribute rather than a class: every caller below already writes
        its own class attribute, and a second one on the same element is
        discarded by the parser rather than merged.
    */
    let hiddenAttr = d.filename.charAt(0) == "." ? ` data-hidden="true"` : "";
    return `draggable="true" fileID="${d.fileID}" filename="${d.filename}"` +
           ` filepath="${d.filepath}" type="${d.type}"${sizeAttrs}${modAttr}${hiddenAttr}`;
}

function renderListItem(d){
    return `<div class="fileObject item" ${fileObjectAttributes(d)}>
                <span class="fmRowIcon">${FileThumb.smallGlyph(d.filename, d.isDir)}</span>
                <span class="filename">${d.displayName}</span>
                ${d.shareIcon}
            </div>`;
}

function renderGridItem(d){
    //Grid tiles are fixed width, so long names are clipped rather than wrapped
    let shown = d.displayName.length > 20 ? d.displayName.substring(0, 20) + "..." : d.displayName;
    let meta = d.isDir ? "" : `<div class="description">${d.displaysize}</div>`;

    return `<div class="fileObject card" ${fileObjectAttributes(d)}>
                <div class="image">
                    <img draggable="false" src="${d.imagePath}">
                    <div class="shareOverlay ${d.isShared ? "visible" : ""}">${d.shareIcon}</div>
                </div>
                <div class="content">
                    <div class="header normal object" title="${d.filename}"><span class="filename">${shown}</span></div>
                    ${meta}
                </div>
            </div>`;
}

function renderDetailsRow(d){
    let sharedMark = d.isShared ? d.shareIcon : "";
    let typeName = FileThumb.getTypeName(d.filename, d.isDir, function(k, f){
        return applocale.getString(k, f);
    });
    let size = d.isDir ? "--" : d.displaysize;

    return `<tr class="fileObject details" ${fileObjectAttributes(d)}>
                <td class="fmColName"><span class="fmNameCell"><span class="fmRowIcon">${FileThumb.smallGlyph(d.filename, d.isDir)}</span><span class="filename">${d.displayName}</span>${sharedMark}</span></td>
                <td class="fmColDate light-text">${d.modTimeText}</td>
                <td class="fmColType light-text">${typeName}</td>
                <td class="fmColSize light-text">${size}</td>
            </tr>`;
}

/*
    Column widths live in file_explorer.css keyed on the .fmCol* classes rather
    than in a <colgroup>. With table-layout:fixed the first row defines the
    columns, so CSS widths apply to the header table and the row tables alike,
    and a column can be hidden outright when the file area gets narrow - which a
    <colgroup> cannot do.
*/

/*
    Sortable header. The existing sortMode vocabulary already covers every
    column, so clicking a header just picks the matching mode and reuses the
    normal sort path - the preference the server stores stays compatible.
*/
var FM_SORT_COLUMNS = [
    {key: "name", asc: "default",      desc: "reverse",       label: "list/name", fallback: "Name",          cls: "fmColName"},
    {key: "date", asc: "leastRecent",  desc: "mostRecent",    label: "list/date", fallback: "Date Modified", cls: "fmColDate"},
    {key: "type", asc: "fileTypeAsce", desc: "fileTypeDesc",  label: "list/type", fallback: "Type",          cls: "fmColType"},
    {key: "size", asc: "smallToLarge", desc: "largeToSmall",  label: "list/size", fallback: "Size",          cls: "fmColSize"}
];

function renderDetailsHeader(){
    let cells = FM_SORT_COLUMNS.map(function(col){
        let active = (sortMode == col.asc) ? "asc" : ((sortMode == col.desc) ? "desc" : "");
        let mark = active == "asc" ? "&#8593;" : (active == "desc" ? "&#8595;" : "");
        return `<th class="${col.cls} fmSortable ${active ? "sorted" : ""}" data-sortkey="${col.key}">` +
               `${applocale.getString(col.label, col.fallback)}<span class="fmSortMark">${mark}</span></th>`;
    }).join("");

    return `<table class="ui very basic unstackable table detailstable fmHeaderTable">
                <thead><tr>${cells}</tr></thead>
            </table>`;
}

//Clicking a header sorts by that column, or flips direction if already sorted
function sortByColumn(key){
    let col = FM_SORT_COLUMNS.filter(function(c){ return c.key == key; })[0];
    if (col == undefined){
        return;
    }
    sortMode = (sortMode == col.asc) ? col.desc : col.asc;
    updateSortMenuState();
    $.ajax({
        url: "../../system/file_system/sortMode",
        method: "POST",
        data: {opr: "set", folder: currentPath, mode: sortMode},
        success: function(){
            refreshList();
        }
    });
}

/* ---------------------------------------------------------------------- */
/*  Container setup and teardown                                           */
/* ---------------------------------------------------------------------- */
function prepareViewContainers(){
    $("#fileList").html("");
    $("#folderList").html("");
    $("#fmListHeader").hide().html("");

    if (viewMode != "details"){
        return;
    }

    //Details mode renders into tables. The header is a separate table above them
    //so it stays visible when either list is empty; identical colgroups plus
    //table-layout:fixed keep all three in the same column geometry.
    $("#fmListHeader").html(renderDetailsHeader()).show();
    let shell = `<table class="ui very basic unstackable table detailstable"><tbody class="detailTableContent"></tbody></table>`;
    $("#folderList").append(shell.replace("detailTableContent", "folderDetailList detailTableContent"));
    $("#fileList").append(shell.replace("detailTableContent", "fileDetailList detailTableContent"));
}

//One append per listing instead of one per row
function appendMarkup(container, markup){
    if (markup.length == 0){
        return;
    }
    if (viewMode == "details"){
        $(container).find("tbody.detailTableContent").append(markup.join(""));
    }else{
        $(container).append(markup.join(""));
    }
}

/*
    Grid view groups files under 今日 / 本週 / 上個月 headers, but only when the
    listing is actually sorted by date - "Today" under a name sort would be
    meaningless. Grouping is a pure presentation pass over the already ordered
    list, so fileID numbering is untouched and shift-range selection still works.
*/
function dateGroupOf(modTime){
    let now = new Date();
    let then = new Date(modTime * 1000);
    let startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    let ts = then.getTime();

    if (ts >= startOfToday){
        return ["today", applocale.getString("group/today", "Today")];
    }
    if (ts >= startOfToday - 6 * 86400000){
        return ["week", applocale.getString("group/thisweek", "This Week")];
    }
    if (ts >= startOfToday - 30 * 86400000){
        return ["month", applocale.getString("group/thismonth", "This Month")];
    }
    return ["older", applocale.getString("group/older", "Older")];
}

function groupingEnabled(){
    return viewMode == "grid" && (sortMode == "mostRecent" || sortMode == "leastRecent");
}

//Wraps already-rendered tiles into <div class="fmGroup"> sections by date
function applyDateGrouping(descriptors, markup){
    if (!groupingEnabled() || descriptors.length == 0){
        return markup;
    }
    let out = [];
    let currentKey = null;
    for (let i = 0; i < descriptors.length; i++){
        let g = dateGroupOf(descriptors[i].modTime);
        if (g[0] != currentKey){
            if (currentKey != null){
                out.push("</div>");
            }
            out.push(`<div class="fmGroupHeader">${g[1]}</div><div class="fmGroup">`);
            currentKey = g[0];
        }
        out.push(markup[i]);
    }
    out.push("</div>");
    return out;
}

function computeGridSize(){
    let gridSize = gridZoom;
    if (!isMobile){
        return gridSize;
    }

    //Align the tiles to the centre of the container and pick the width that
    //fits the most columns without a partial one at the edge
    $("#folderView").attr("align", "center");
    $("#folderList").attr("align", "left");
    $("#fileList").attr("align", "left");

    let bestCount = Math.floor(parseFloat($("#folderView").width()) / parseFloat(gridSize));
    let bestOffset = $("#folderView").width() % gridSize;
    if (bestCount > 0){
        gridSize = gridSize + (bestOffset / bestCount) - (window.innerWidth - $("#folderView").width()) / bestCount;
    }
    return gridSize;
}

function finaliseRender(folderCount, fileCount, callback){
    updateListDensity();
    //The nav row can wrap to a second line (mobile), so its height is only
    //settled once content has been laid out. Re-measure before sizing the panes.
    initWindowSizes(false);
    bindFileObjectEvents();
    currentFilelist.sort();

    //Update the filelist hash
    enableAutoRefresh = false;
    getDirHash(function(hash){
        currentPathHash = hash;
        enableAutoRefresh = true;
    });

    if (viewMode == "details"){
        $("#folderList").find(".foldercounter").text(folderCount);
        $("#fileList").find(".filecounter").text(fileCount);
    }else if (viewMode == "grid"){
        startThumbnailLoader();
    }

    updateSelectedObjectsCount();

    if (callback !== undefined){
        callback();
    }
}


/*
    Drop columns when the file area itself is narrow. A media query cannot do
    this: opening the properties pane or the sidebar steals width without
    changing the window size.
*/
function updateListDensity(){
    let width = $("#folderView").width();
    $("#folderView").toggleClass("fmNarrow", width < 620)
                    .toggleClass("fmVeryNarrow", width < 460);
    /*
        The trash bin's own thresholds. Its rows carry a full original path,
        which is the widest thing in the table and the first thing worth
        dropping - at the default window size the table already overflows with
        it, so it only earns its place once the pane is dragged wider.

        Narrower still and the table stops working at all, and the card layout
        in trash.js takes over.
    */
    $("#folderView").toggleClass("fmTrashHideOrigin", width < FM_TRASH_ORIGIN_MIN_WIDTH)
                    .toggleClass("fmTrashCardMode", isTrashCardWidth(width));

    //Crossing the card threshold changes the markup, not just which parts show
    refreshTrashLayoutOnResize();
}
