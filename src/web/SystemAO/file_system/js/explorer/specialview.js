/*
    specialview.js

    Registry for views that occupy the file area but are not directory
    listings - the trash bin is the first, and anything else that wants a
    sentinel path plus its own renderer registers here rather than adding
    another branch to listDirectory().

    A view registers itself at load time:

        registerSpecialView("%trashbin%", {
            icon: "trash",                  //FSIcons key drawn in the path bar
            labelKey: "trash/title",        //applocale key for the root label
            labelFallback: "Trash Bin",
            hideViewModes: true,            //grid/list/details make no sense here
            hidePropertiesPane: true,       //neither does the properties pane
            sidebar: true,                  //optional, give it a sidebar entry
            desktopIcon: "...",             //optional, see below
            toolbar: ["refresh", "delete"], //which file operations work here
            toolbarHandlers: {              //optional, how it performs them
                delete: function(){ ... }
            },
            render: function(callback){ ... },
            search: function(keyword, caseSensitive){ ... },  //optional
            drop: function(filepaths){ ... },  //optional, files dragged onto it
            open: function(){ ... },        //optional, how the sidebar opens it
            leave: function(){ ... }        //optional, navigating away
        });

    A view that leaves out "search" simply keeps whatever it last drew when the
    user presses Enter in the search box, since handleSearch() has nothing to
    hand the keyword to and the server-side search cannot see these rows.

    A view with a "drop" handler accepts files dragged onto its sidebar entry,
    and onto its icon on the desktop. It is given the vpaths of what was
    dropped and decides what that means - the trash bin recycles them. A view
    without one ignores drops rather than attempting a move into a path that
    does not exist.

    A view with a "sidebar" entry can also be put on the desktop, through the
    right click menu on that entry. The shortcut it writes is an ordinary
    .shortcut file of type "folder" whose path is the sentinel, so the desktop
    opens it by launching the File Manager there - the same way it opens a
    shortcut to any other folder. "desktopIcon" is the image written into that
    file; leave it out and the icon registered for the path in
    shared/specialpaths.js is used, which is what both the desktop and the file
    listing draw anyway.

    "toolbar" lists the data-opr names from the file operation bar that mean
    something in this view. Everything else is greyed out and made unclickable,
    in both the bar and the overflow menu - a view is not a directory, and the
    bar would otherwise happily offer to upload a file into the trash bin or
    paste a clipboard into it. Omit it (or pass false) to disable the bar
    entirely; a view that omits it gets nothing rather than everything, since
    the operations all assume a real directory underneath.

    Listing an operation is a promise that it works. Ones that are really
    navigation work as they always did. The rest need an entry in
    "toolbarHandlers", which runSpecialViewOperation() dispatches to from the
    host function.

    The full set of keys, which are the data-opr values in file_explorer.html.
    Both "toolbar" and "toolbarHandlers" use these names:

        Key           Toolbar label   Host function      Defined in
        ------------  --------------  -----------------  --------------
        open          Open            openViaButton()    open.js
        openwith      Open with...    openWith()         openwith.js
        copy          Copy            copy()             clipboard.js
        cut           Cut             cut()              clipboard.js
        paste         Paste           paste()            clipboard.js
        rename        Rename          rename()           rename.js
        delete        Delete          deleteFile()       delete.js        *
        upload        Upload          upload()           upload.js
        download      Download        downloadFile()     download.js
        share         Share           shareFile()        share.js
        newfile       New File        newfile()          create.js
        newfolder     New Folder      newFolder()        create.js
        zip           Create Zip      zipFile()          archive.js
        unzip         Unzip Here      unzipHere()        archive.js
        refresh       Refresh         refreshList()      listing.js       +
        home          Home            openHomeDir()      pathbar.js       +
        fileinfo      File Info       showFileProperties() properties.js  *

        * already has a runSpecialViewOperation() hand-off, so a handler under
          this key is called instead of the normal behaviour
        + navigation, works in any view without a handler - refreshList() comes
          back through listDirectory() and so through this view's render()

    Wiring up a key that is not yet marked * takes two lines at the top of its
    host function, the same shape delete.js and properties.js already use:

        function copy(){
            if (runSpecialViewOperation("copy")){
                return;
            }
            ...

    Then add the key to "toolbar" and its implementation to "toolbarHandlers".
    Listing a key WITHOUT doing that leaves the button live but running the
    normal directory code against rows that are not .fileObject elements, which
    is the failure this whole mechanism exists to prevent - so only list what
    is genuinely wired.

    listDirectory() then does the lookup and hands over, and updatePathDisplay()
    uses the icon and label instead of showing the raw sentinel.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

let fmSpecialViews = {};

/*
    The view currently on screen, so the one being left can be told to stop
    whatever it had running - the trash bin uses this to drop a scan that is
    still walking the file system.
*/
let activeSpecialView = null;

/*
    Whether the properties pane was open before a special view hid it, so
    leaving the view can put it back rather than silently turning off something
    the user had switched on.
*/
let propertiesPaneHiddenBySpecialView = false;

function registerSpecialView(sentinelPath, config){
    fmSpecialViews[String(sentinelPath).toLowerCase()] = config;
}

/*
    Look up the view for a path. listDirectory pads a trailing slash onto
    everything it navigates to, so that is stripped before matching.
*/
function getSpecialView(path){
    if (path == undefined || path == null){
        return null;
    }
    let cleaned = String(path).trim().replace(/\/+$/, "").toLowerCase();
    let view = fmSpecialViews[cleaned];
    return view == undefined ? null : view;
}

function isSpecialViewPath(path){
    return getSpecialView(path) != null;
}

/*
    Chrome that only makes sense over a real directory listing. Called on every
    navigation, so entering and leaving are both handled from one place.
*/
function applySpecialViewChrome(view){
    if (activeSpecialView != null && activeSpecialView !== view &&
        typeof activeSpecialView.leave === "function"){
        activeSpecialView.leave();
    }
    activeSpecialView = view;

    let hideViewModes = view != null && view.hideViewModes === true;
    $(".fsViewToggle.fmStatusToggle").toggle(!hideViewModes);
    $("#fmSortBtn").toggle(!hideViewModes);

    //The tile size slider belongs to the grid view, which is gone too.
    //updateZoomControlVisibility() checks the special view itself, so it stays
    //hidden when the resize handler or a view mode change calls back into it.
    updateZoomControlVisibility();

    let hideProperties = view != null && view.hidePropertiesPane === true;
    $("#togglePropertiesViewBtn").toggle(!hideProperties);

    if (hideProperties){
        if (propertiesView){
            //Remember that this was the user's setting, not ours, so it can be
            //restored when they navigate back out
            propertiesPaneHiddenBySpecialView = true;
            togglePropertiesView($("#togglePropertiesViewBtn"));
        }
    }else if (propertiesPaneHiddenBySpecialView){
        propertiesPaneHiddenBySpecialView = false;
        if (!propertiesView){
            togglePropertiesView($("#togglePropertiesViewBtn"));
        }
    }

    applySpecialViewToolbar(view);
    updateSplitterVisibility();
    initWindowSizes(false);
}

/*
    Grey out the file operations a view does not support.

    Both the toolbar and the overflow menu key off the same data-opr names, so
    one pass covers them. A null view (an ordinary directory) clears the state
    rather than leaving the last view's restrictions behind.
*/
function applySpecialViewToolbar(view){
    let allowed = null;
    if (view != null){
        allowed = {};
        let ops = Array.isArray(view.toolbar) ? view.toolbar : [];
        ops.forEach(function(opr){
            allowed[opr] = true;
        });
    }

    $("#fileOprBar [data-opr], #fmMoreMenu [data-opr]").each(function(){
        let blocked = allowed != null && allowed[$(this).attr("data-opr")] !== true;
        $(this).toggleClass("fmOprBlocked", blocked);
        /*
            The class handles the look and swallows pointer events, but a real
            disabled attribute is what stops a keyboard activation reaching the
            handler - the menu entries are divs, so they only get the class.
        */
        if (this.tagName == "BUTTON"){
            this.disabled = blocked;
        }
    });

    //Blocked entries are dropped from the overflow menu, not merely dimmed
    if (typeof updateOprMenuRelevance === "function"){
        updateOprMenuRelevance();
    }
}

/*
    Hand a file operation to the view currently on screen. Returns true when the
    view dealt with it, leaving the caller to do nothing more.
*/
/*
    Put a special view on the desktop.

    Written as a type "folder" shortcut pointing at the sentinel path: the
    desktop already knows how to open one of those (it launches the File
    Manager at the path), and specialpaths.js gives both ends the icon, so
    nothing on the desktop needs to learn what a trash bin is.
*/
function createSpecialViewShortcut(sentinelPath){
    let target = (sentinelPath == undefined || sentinelPath == "")
        ? contextMenuSpecialView : sentinelPath;
    let view = getSpecialView(target);
    if (view == null){
        return;
    }

    let label = applocale.getString(view.labelKey, view.labelFallback);
    let icon = view.desktopIcon;
    if (icon == undefined || icon == ""){
        let info = getSpecialPathInfo(target);
        icon = (info == null) ? "" : info.icon;
    }

    requestDesktopShortcut(label, target, icon);
}

/*
    Hand files dropped on a view over to it. Returns true when the view took
    them, so a caller can tell the difference between "handled" and "this view
    does not accept drops".
*/
function runSpecialViewDrop(sentinelPath, filepaths){
    let view = getSpecialView(sentinelPath);
    if (view == null || typeof view.drop !== "function"){
        return false;
    }
    if (filepaths == undefined || filepaths.length == 0){
        return false;
    }
    view.drop(filepaths);
    return true;
}

function runSpecialViewOperation(opr){
    let view = getSpecialView(currentPath);
    if (view == null || view.toolbarHandlers == undefined){
        return false;
    }
    let handler = view.toolbarHandlers[opr];
    if (typeof handler !== "function"){
        return false;
    }
    handler();
    return true;
}


/*
    Sidebar entries

    A view that asks for one is drawn from what it already registered, so a
    second special view costs a registration and nothing else in sidebar.js.
    The block is preceded by a divider: these are views rather than mounted
    storage, and without something between them the column reads as one
    undifferentiated list of drives.
*/
function renderSpecialViewSidebarEntries(){
    let html = "";
    Object.keys(fmSpecialViews).forEach(function(sentinel){
        let view = fmSpecialViews[sentinel];
        if (view.sidebar !== true){
            return;
        }
        let icon = (view.icon != undefined && FSIcons[view.icon] != undefined) ? FSIcons[view.icon] : "";
        html += '<div class="dir item vroot fsSideItem fmSpecialSideItem" filepath="' + sentinel +
            '" type="specialview" onclick="openSpecialView(&quot;' + sentinel + '&quot;);">' +
            '<span class="fsSideIcon">' + icon + '</span>' +
            '<span class="fsSideLabel">' +
            applocale.getString(view.labelKey, view.labelFallback) + '</span></div>';
    });

    return html == "" ? "" : '<div class="fsSideDivider"></div>' + html;
}

function openSpecialView(sentinelPath){
    /*
        On a phone the sidebar covers the window, so it is dismissed here rather
        than in the navigation callback the way folders do it - a view that
        takes a while to load would otherwise leave the user looking at the menu
        instead of at the loading screen underneath it.
    */
    if (isMobile && sideBarShown){
        toggleSidebar();
    }

    let view = getSpecialView(sentinelPath);
    if (view != null && typeof view.open === "function"){
        view.open();
        return;
    }
    listDirectory(sentinelPath);
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.registerSpecialView = registerSpecialView;
window.getSpecialView = getSpecialView;
window.isSpecialViewPath = isSpecialViewPath;
window.applySpecialViewChrome = applySpecialViewChrome;
window.renderSpecialViewSidebarEntries = renderSpecialViewSidebarEntries;
window.openSpecialView = openSpecialView;
window.applySpecialViewToolbar = applySpecialViewToolbar;
window.runSpecialViewOperation = runSpecialViewOperation;
window.createSpecialViewShortcut = createSpecialViewShortcut;
window.runSpecialViewDrop = runSpecialViewDrop;
