/*
    viewmode.js

    View mode + sort preference handling.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

    //Change the current view mode
    function changeViewMode(object){
        var targetMode = $(object).attr("mode");
        viewMode = targetMode;
        lastUsedViewMode = targetMode;
        refreshList(undefined, true);
        updateViewmodeButtons();
        setPreference("file_explorer/listmode",targetMode)
        if (startViewMode == "folder"){
            //Kept for this folder, the way its sort order is
            viewModeFolder = currentPath;
            $.ajax({
                url: "../../system/file_system/viewMode",
                method: "POST",
                data: {opr: "set", folder: currentPath, mode: targetMode}
            });
        }
    }

    //Toggle properties view
    //Setting will be save to this browser only
    function togglePropertiesView(object){
        propertiesView = !propertiesView;
        if (propertiesView){
            $("#propertiesView").show();
            $(object).addClass('active');
            localStorage.setItem("file_explorer/viewProperties", "true");

            if ($(".fileObject.selected").length >= 1){
                //Load the file properties
                let targetFile = getFileObjectFromFID(lastClickedFileID);
                if (targetFile == null){
                    targetFile = $(".fileObject.selected")[0];
                }
                let filepath = $(targetFile).attr("filepath");
                loadFileProperties(filepath);
            }
        }else{
            $("#propertiesView").hide();
            $(object).removeClass('active');
            localStorage.setItem("file_explorer/viewProperties", "false");
        }
        //The handle only belongs there while the pane it resizes is on screen
        updateSplitterVisibility();
    }

    //The tile size slider only applies to the thumbnail grid
function updateZoomControlVisibility(){
    /*
        Explicit display, not .toggle(): jQuery writes an inline "display:block"
        whenever the stylesheet has the element hidden, which the phone media
        query does with !important. That inline value survives a rotation, and
        once the media query stops matching it beats the flex layout this
        control needs - the icon then has no flex context to size it and the
        bare <svg> falls back to its 300px intrinsic size.
    */
    /*
        A special view has no tiles to resize whatever view mode it was entered
        from, and the resize handler and updateViewmodeButtons() both come
        through here - so the test lives here rather than in the one-shot hide
        applySpecialViewChrome() used to do, which either of them undid.
    */
    let specialView = (typeof getSpecialView === "function") ? getSpecialView(currentPath) : null;
    let hidden = (specialView != null && specialView.hideViewModes === true) || viewMode != "grid";
    $("#fmZoom").css("display", hidden ? "none" : "flex");
    initWindowSizes(false);
}

function updateViewmodeButtons(){
    updateZoomControlVisibility();
    /*
        The details view pins its column header to the top of the file area.
        A sticky box cannot rise above its containing block's content edge, so
        the file area's top padding would hold the header that far down and let
        rows scroll through the gap above it. Details view drops the padding -
        the header is the top chrome there anyway.
    */
    $("#folderView").toggleClass("fmDetailsView", viewMode == "details");
        $(".videmode").removeClass('disabled');
        $(".videmode").each(function(){
            if ($(this).attr("mode") == viewMode){
                $(this).addClass("disabled");
            }
        });
    }

    /*
        Pick the view mode the File Manager opens in, from the opening view
        setting (startViewMode in state.js) and the view used last. Both are
        asked for at once; the listing waits for the two answers.
    */
    function loadListModeFromDB(callback = undefined){
        let startView = null;
        let listMode = null;
        let pending = 2;
        let done = function(){
            pending--;
            if (pending > 0){
                return;
            }
            startViewMode = FM_START_VIEW_MODES.includes(startView) ? startView : "last";
            if (FM_VIEW_MODES.includes(listMode)){
                lastUsedViewMode = listMode;
            }
            if (FM_VIEW_MODES.includes(startViewMode)){
                viewMode = startViewMode;
            }else if (FM_VIEW_MODES.includes(listMode)){
                //"last", and the fallback of "folder" before a folder is listed
                viewMode = listMode;
            }
            updateViewmodeButtons();

            if (callback !== undefined){
                callback();
            }
        };
        loadPreference("file_explorer/startView", function(data){
            startView = (typeof data == "string") ? data : null;
            done();
        });
        loadPreference("file_explorer/listmode", function(data){
            listMode = (typeof data == "string") ? data : null;
            done();
        });
    }

    /*
        "Per folder" opening view: a folder opens in the view last used in it,
        or in the view picked last when it has none of its own. Only fetched
        when the folder changes, so refreshing a folder keeps the view on
        screen, and not during a search, which always lists.
    */
    function folderViewModePending(path){
        return startViewMode == "folder" && !searchMode && path != viewModeFolder;
    }

    function loadFolderViewMode(path, callback){
        viewModeFolder = path;
        $.ajax({
            url: "../../system/file_system/viewMode",
            method: "POST",
            data: {opr: "get", folder: path},
            success: function(data){
                if (currentPath != path){
                    return;
                }
                let mode = FM_VIEW_MODES.includes(data) ? data : lastUsedViewMode;
                if (mode != viewMode){
                    viewMode = mode;
                    updateViewmodeButtons();
                }
            },
            complete: function(){
                //Another folder was opened meanwhile; its own listing takes over
                if (currentPath == path){
                    callback();
                }
            }
        });
    }

    /*
        System Settings > File Manager announces every preference it writes
        under file_explorer/settingsChanged. A File Manager reads these on
        start only, so an open one applies them here.
    */
    function applyChangedSetting(key, value){
        if (key == "file_explorer/oprbar"){
            showOprBar = (value !== "false");
            applyOprBarVisibility();
        }else if (key == "file_explorer/showHidden"){
            showHiddenFiles = (value === "true");
            updateHiddenFilesToggle();
            refreshList(undefined, true);
        }else if (key == "file_explorer/startView"){
            startViewMode = FM_START_VIEW_MODES.includes(value) ? value : "last";
            //The view on screen stays until another folder is opened
            viewModeFolder = currentPath;
        }else if (key == "file_explorer/uploadAutoClose"){
            uploadAutoClose = (value === "true");
            scheduleUploadAutoClose();
        }
    }

    window.addEventListener("storage", function(event){
        if (event.key != "file_explorer/settingsChanged" || event.newValue == null){
            return;
        }
        try {
            let change = JSON.parse(event.newValue);
            applyChangedSetting(change.key, change.value);
        } catch (e) {}
    });

/*
    Show or hide dotfiles.

    The filtering itself is the server's: listDir only returns hidden entries
    when asked, so this re-lists rather than showing or hiding rows that were
    never sent. Persisted server side like the toolbar preference, so it follows
    the user between browsers.
*/
function toggleHiddenFiles(){
    showHiddenFiles = !showHiddenFiles;
    updateHiddenFilesToggle();
    setPreference("file_explorer/showHidden", showHiddenFiles);
    closeFileOprMenu();
    refreshList();
}

function updateHiddenFilesToggle(){
    $("#fmHiddenToggle").toggleClass("checked", showHiddenFiles);
}

//Update sorting method for file listing
/*
    Apply a sort mode, persist it for this folder and re-list.

    The nav row's sort menu replaced the old <select>, but the stored vocabulary
    is unchanged (default / reverse / smallToLarge / largeToSmall / mostRecent /
    leastRecent / fileTypeAsce / fileTypeDesc / smart) so an older client reading
    the same preference still understands it.
*/
function setSortMode(mode){
    sortMode = mode;
    updateSortMenuState();
    closeSortMenu();

    $.ajax({
        url: "../../system/file_system/sortMode",
        method: "POST",
        data: {opr: "set", folder: currentPath, mode: sortMode},
        success: function(){
            refreshList();
        }
    });
}

//Tick the active mode in the sort menu
function updateSortMenuState(){
    $("#fmSortMenu .fmSortOption").each(function(){
        $(this).toggleClass("active", $(this).attr("data-sort") == sortMode);
    });
}

function toggleSortMenu(event){
    if (event != undefined){
        event.stopPropagation();
    }
    if ($("#fmSortMenu").hasClass("open")){
        closeSortMenu();
    }else{
        closeFileOprMenu();
        updateSortMenuState();
        $("#fmSortMenu").addClass("open");
        $("#fmSortBtn").addClass("active");
    }
}

function closeSortMenu(){
    $("#fmSortMenu").removeClass("open");
    $("#fmSortBtn").removeClass("active");
}

$(document).on("click", function(event){
    if ($(event.target).closest("#fmSortMenu, #fmSortBtn").length == 0){
        closeSortMenu();
    }
});

//Toggle preview windows size from small to large mode,
//set restoreDefault to true for force small interface
function togglePreviewWindowSize(restoreDefault = false){
    if ($("#propertiesView").hasClass("small") && restoreDefault == false){
        //Set it to big. Routed through the splitter setter so this button and a
        //drag cannot end up disagreeing about the pane's bounds.
        setPropertiesWidth(500);
        $("#propertiesView").removeClass("small").addClass("big");
        $("#propertiesView").find(".sizeToggle").html(`<i class="compress icon"></i>`);
        $("#propertiesView").find(".sizeToggle").attr("title", applocale.getString("sidebar/properties/shrink", "Shrink Properties Sidebar"));
    }else{
        //Set it to small
        setPropertiesWidth(FM_PROPS_DEFAULT_WIDTH);
        $("#propertiesView").removeClass("big").addClass("small");
        $("#propertiesView").find(".sizeToggle").html(`<i class="expand icon"></i>`);
        $("#propertiesView").find(".sizeToggle").attr("title", applocale.getString("sidebar/properties/expand", "Expand Properties Sidebar"));
    }
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.changeViewMode = changeViewMode;
window.togglePreviewWindowSize = togglePreviewWindowSize;
window.togglePropertiesView = togglePropertiesView;
window.setSortMode = setSortMode;
window.toggleHiddenFiles = toggleHiddenFiles;
            window.toggleSortMenu = toggleSortMenu;
            window.updateSortMenuState = updateSortMenuState;
