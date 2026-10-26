/*
    listing.js

    Directory listing, refresh and folder content hashing.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

// ============================== FOLDER LISTING FUNCTIONS ====================
function listDirectory(path, callback=undefined, recordUndo=true){
    path = resolvePathShortcut(path);
    enableAutoRefresh = false;
    //Stop thumbnails still streaming for the directory we are leaving, otherwise
    //a late frame paints onto the new listing
    cancelThumbnailLoader();

    if (recordUndo == true){
        //Navigating anywhere except via Back/Forward discards the forward stack
        forwardHistory = [];
    }
    var recordPreviousPage = true;
    if (recordUndo == false){
        recordPreviousPage = false;
    }

    if (searchMode){
        hideSearchBar(true);
    }

    if (pathInputMode){
        hideManualOpenPathInput();
    }

    if (isMobile && ctrlHold){
        exitMultiSelectMode();
    }

    //Backup the current selected files if it is an refresh operation
    let selectedFiles = [];
    let currentScrollTop = JSON.parse(JSON.stringify($("#folderView").scrollTop()));
    if (path == currentPath){
        $(".fileObject.item.selected").each(function(){
            selectedFiles.push($(this).attr("filename"));
        });

        //Set record histroy to false on refresh
        recordPreviousPage = false;
    }
    
    //Always pad slash to the end of path
    if (path.substring(path.length - 1) != "/"){
        path = path + "/";
    }

    //Clean the path if there are any malformat
    if (path.indexOf("//") != -1){
        path = path.split("//").join("/");
    }

    if (recordPreviousPage){
        viewHistory.push(currentPath);
    }
    
    if (!ao_module_virtualDesktop){
        //Update the window hash
        window.location.hash = encodeURIComponent(path);
    }
    
    updatePathDisplay(path);
    currentPath = path;

    //Update floatWindow title if exists
    if (ao_module_virtualDesktop){
        var tmp = path.split("/");
        tmp.pop();
        var titleName = tmp.pop();
        var titleDrive = getDriveView(path);
        if (titleDrive != null && tmp.length == 0){
            //The root of a drive view ("share:") goes by the view's name
            titleName = applocale.getString(titleDrive.labelKey, titleDrive.labelFallback);
        }
        ao_module_setWindowTitle(applocale.getString("title/title", "File Manager") + " - " + titleName);
    }

    //Check if there are parent path for curret path
    if (checkIfParentDirExists(currentPath)){
        $("#ppbtn").removeClass("disabled");
    }else{
        $("#ppbtn").addClass("disabled");
    }
    if (viewHistory.length < 1){
        $("#backbtn").addClass("disabled");
    }else{
        $("#backbtn").removeClass("disabled");
    }
    if (forwardHistory.length < 1){
        $("#fwdbtn").addClass("disabled");
    }else{
        $("#fwdbtn").removeClass("disabled");
    }

    //Add loading screen to the folderlists and fileList
    $("#fileList").html("");
    let loaderClass = "inverted";
    if (currentTheme == "darkTheme"){
        loaderClass = "";
    }
    $("#folderList").html(`<div style="height: 100px;">
        <div class="ui active ${loaderClass} dimmer" style="z-index: 95;">
            <div class="ui text loader">${applocale.getString("message/loading", "Loading")}</div>
        </div>
    </div>`);
    
    $(".userroot.active").removeClass('active');
    
    //Highlight new path coot
    highlightCurrentRoot();
    
    /*
        Special views (the trash bin, and anything registered alongside it) are
        not directories the server can list. Everything above still applies to
        them - history, path bar, nav button states - so the hand off happens
        here rather than at the top of the function.
    */
    let specialView = getSpecialView(currentPath);
    applySpecialViewChrome(specialView);
    if (specialView != null){
        if (ao_module_virtualDesktop){
            ao_module_setWindowTitle(applocale.getString("title/title", "File Manager") +
                " - " + applocale.getString(specialView.labelKey, specialView.labelFallback));
        }
        /*
            The sidebar and file area event handlers are normally bound by
            finaliseRender(), at the end of a directory listing. A special view
            never goes through that, so opening the File Manager straight into
            one - which a desktop shortcut to %trashbin% now does - left the
            sidebar right click, among others, unbound until the user happened
            to visit a real folder. Bind them here too; every binding in there
            detaches itself first, so doing it twice is harmless.
        */
        bindFileObjectEvents();
        specialView.render(callback);
        return;
    }

    /*
        A drive view (share:/) is listed like any directory, but only offers
        the file operations its files allow, and may have to look something up
        before the listing goes out - see js/explorer/shared.js.
    */
    let driveView = getDriveView(currentPath);
    applyDriveViewToolbar();
    if (driveView != null && typeof driveView.prepare === "function"){
        driveView.prepare(currentPath, function(){
            requestDirectoryListing(path, callback, selectedFiles, currentScrollTop);
        });
        return;
    }
    requestDirectoryListing(path, callback, selectedFiles, currentScrollTop);
}

/*
    The server half of listDirectory(): fetch the sort mode and the listing of
    path, and render whichever comes back - the files, or why there are none.
*/
function requestDirectoryListing(path, callback, selectedFiles, currentScrollTop){
    //Get sort mode from server side
    let loadStartPath = currentPath;
    $.ajax({
        url: "../../system/file_system/sortMode",
        metod: "POST",
        data: {opr: "get", folder: currentPath},
        success: function(data){
            if (data.error == undefined){
                sortMode = data;
            }
            updateSortMenuState();
            //Start listdir event
            $.ajax({
                url: "../../system/file_system/listDir",
                method: "POST",
                data: {dir: safeDecodePath(path), sort: sortMode,
                       showHidden: showHiddenFiles ? "true" : "false"},
                success: function(data){
                    //Parse the filelist into global variable
                    currentFilelist = [];
                    if (data === null){
                        //There is nothing in this folder.
                        $("#folderList").hide();
                        $("#fileList").hide();
                        if (callback !== undefined){
                            callback();
                        }
                        return;
                    }

                    if (currentPath != loadStartPath){
                        //Use switch to another path before the load finish. Do not render
                        return;
                    }

                    if (data.error !== undefined){
                        //Parse path error. Try to refresh the page
                        if (data.error.length >= "Redirect:".length && data.error.substr(0,9) == "Redirect:"){
                            var redirectAction = data.error.substr(9).trim();
                            if (redirectAction == "parent"){
                                var pdir = currentPath.split("/");
                                pdir.pop(); pdir.pop();
                                pdir = pdir.join("/");
                                currentPath = pdir;
                                listDirectory(currentPath);
                            }else if (redirectAction == "root"){
                                var currentRoot = currentPath.split("/").shift();
                                listDirectory(currentRoot);
                            }else if (redirectAction == "userroot"){
                                listDirectory("user:/")
                            }else{
                                //Try to breakdown the redirection path
                                listDirectory(redirectAction, undefined, false);
                            }
                            return
                        }

                        
                        //Check if it is already rooted and no more parent ahead
                        if (currentPath == ""){
                            currentPath = "user:/";
                        }

                        renderListingError(path, data.error);
                        enableAutoRefresh = false;
                        return;
                    }else{
                        enableAutoRefresh = true;
                        //Filelist returned. Render it
                        renderDirectory(data,function(){
                            //A drive view may say something about having nothing in it
                            let emptyDrive = getDriveView(path);
                            if (data.length == 0 && emptyDrive != null && typeof emptyDrive.empty === "function"){
                                emptyDrive.empty(path);
                            }

                            //Restore the selected file list
                            $(".fileObject.item").each(function(){
                                for (var i = 0; i < selectedFiles.length; i++){
                                    var thisFilename = selectedFiles[i];
                                    if (thisFilename == $(this).attr("filename")){
                                        $(this).addClass("selected");
                                    }
                                }
                            });

                            //Restore the previous scroll position
                            $("#folderView").scrollTop(currentScrollTop);
                            
                            //Perform the callback
                            if (callback !== undefined){
                                callback();
                            }

                            enableAutoRefresh = true;
                        });
                    }
                },
                error: function(){
                    enableAutoRefresh = true;
                }
            });
        },
        error: function(){
            enableAutoRefresh = true;
        }
    });
}

/*
    Why a path could not be listed.

    A path the server cannot resolve - a typing mistake in the address bar, a
    mistyped sentinel such as %shre%, a drive that is not mounted, a folder
    that is gone - gets a "Path Not Found" page with a way back. Anything
    else the server refuses keeps the generic page with its message.
*/
function isPathNotFoundError(message){
    let msg = String(message);
    return msg.indexOf("Unable to resolve requested path") == 0 ||
        msg == "Folder not exists" || msg == "Invalid dir given.";
}

function renderListingError(path, message){
    $("#fileList").hide();
    //Nothing is listed, so the status bar should not count the last folder
    $("#fileList").html("");
    updateSelectedObjectsCount();
    if (isPathNotFoundError(message)){
        renderPathNotFound(path);
        return;
    }
    $("#folderList").show();
    $("#folderList").html(`<div class="ui basic segment">
        <div class="ui header themed">
            <i class="remove icon"></i> <span>${applocale.getString("message/folderCannotOpen","This Folder Cannot Be Opened")}</span>
            <div class="sub header" style="margin-top:12px;">${applocale.getString("message/folderCannotOpen/codedesc","The server return the following error message:")} <br><code>${escapeHTMLText(String(message).toUpperCase())}</code><br>
                ${new Date().toLocaleString(undefined, {year: 'numeric', month: '2-digit', day: '2-digit', weekday:"long", hour: '2-digit', hour12: false, minute:'2-digit', second:'2-digit'})}</div>
        </div>
    </div>`);
}

function renderPathNotFound(path){
    let shown = String(path);
    if (shown.length > 1 && shown.endsWith("/") && !shown.endsWith(":/")){
        shown = shown.substring(0, shown.length - 1);
    }
    let html = '<div class="fmPathError">' +
        '<div class="fmPathErrorIcon">' + FSIcons.search + '</div>' +
        '<div class="fmPathErrorTitle">' + escapeHTMLText(applocale.getString("message/pathNotFound", "Path Not Found")) + '</div>' +
        '<div class="fmPathErrorDesc">' + escapeHTMLText(applocale.getString("message/pathNotFound/desc",
            "Nothing exists at this location, or it is not available to you. Check the path for typing mistakes and try again.")) + '</div>' +
        '<div class="fmPathErrorPath"><code>' + escapeHTMLText(shown) + '</code></div>' +
        '<div class="fmPathErrorActions">';
    if (viewHistory.length > 0){
        html += '<button class="fmPathErrorBtn" onclick="previosPath();">' +
            escapeHTMLText(applocale.getString("message/pathNotFound/back", "Go Back")) + '</button>';
    }
    html += '<button class="fmPathErrorBtn primary" onclick="openHomeDir();">' +
        escapeHTMLText(applocale.getString("message/pathNotFound/home", "Go to Home")) + '</button>' +
        '</div></div>';
    $("#folderList").show().html(html);
}

function listDirectoryAndHighlight(path, filenameToHighlight = ""){
    listDirectory(path, function(){
        if (filenameToHighlight != ""){
            //Timeout to give the DOM time to render
            setTimeout(function(){
                focusFileObject(filenameToHighlight);
            }, 100);
            
        }
    })
}

//Move the page focus to the given fileobject
//alias: Highlight file object / filename
function focusFileObject(targetFileName){
    $(".fileObject").each(function(){
        if ($(this).attr("filename") == targetFileName){
            scrollToFileLocation(this);
            $(this).addClass("selected");
        }
    });
}

function scrollToFileLocation(DOMElement){
    if (DOMElement === undefined || $(DOMElement).offset() == undefined){
        //DOM Element no longer exists
        return;
    }
    //Trying to vertically align the directory from its parent list
    let topPos = $("#folderView").scrollTop() + $(DOMElement).offset().top - $("#folderView").height()/2 - $(DOMElement).height()/2 - 28;
    window.debug = $(DOMElement);
    $("#folderView").stop().animate({
        scrollTop: topPos
    }, 300);
}

function getDirHash(callback){
    $.ajax({
        url: "../../system/file_system/listDirHash",
        data: {dir: currentPath},
        success: function(data){
            if (data.error !== undefined){
                if (data.error == "Invalid dir given" || data.error == "Directory not found"){
                    //Folder removed (e.g. deleted in another window). Back to the nearest existing parent
                    returnToExistingParentDir(currentPath);
                }else if (data.error == "Unable to resolve target directory"){
                    //The whole root is gone (e.g. disk hot-swapped). Back to user:/
                    returnToExistingParentDir("user:/");
                }
            }
            callback(data);
        }
    })
}

//Walk up from the given path until a directory that still exists is found,
//then list it. Falls back to user:/ when even the root is gone.
var returningToParentDir = false;
function returnToExistingParentDir(path){
    if (returningToParentDir){
        return;
    }
    returningToParentDir = true;
    let startPath = currentPath;
    let rootGone = false;

    let finish = function(targetPath){
        returningToParentDir = false;
        if (currentPath != startPath){
            //User already navigated somewhere else
            return;
        }
        listDirectory(targetPath, function(){
            if (rootGone){
                //Reload the root list in the side bar
                initRootDirs();
            }
        });
    }

    let probe = function(dir){
        $.ajax({
            url: "../../system/file_system/listDirHash",
            data: {dir: dir},
            success: function(data){
                if (data.error === undefined){
                    finish(dir);
                    return;
                }
                if (data.error == "Unable to resolve target directory" || /^[^\/]+:\/$/.test(dir)){
                    //Root no longer mounted, or reached the root and it is still not readable
                    rootGone = true;
                    if (dir == "user:/"){
                        returningToParentDir = false;
                        return;
                    }
                    finish("user:/");
                    return;
                }
                probe(getParentDir(dir));
            },
            error: function(){
                //Network or server issue. Try again on next refresh tick
                returningToParentDir = false;
            }
        });
    }

    probe(getParentDir(path));
}

//Return the parent of a virtual path, e.g. user:/Document/Myfolder/ => user:/Document/
function getParentDir(path){
    if (/^[^\/]+:\/$/.test(path)){
        //Already a root
        return path;
    }
    let segments = path.replace(/\/+$/, "").split("/");
    segments.pop();
    let parent = segments.join("/") + "/";
    return parent;
}

//=================================== FILE OPERATIONS ========================

function refreshList(callback = undefined, keepSelectedItems = false){
    if (searchMode == true){
        //Refresh the search result
        if ($("#searchInput").val().length >  0){
            handleSearch();
        }
        return;
    }

    shiftHold = false;
    if (!isMobile){
        //Desktop mode only, to prevent focus out when ctrl Up
        ctrlHold = false;
    }

    let filenameBackups = [];
    if (keepSelectedItems){
        //Backup all the selected filenames
        $(".fileObject.selected").each(function(){
            filenameBackups.push($(this).attr("filename"));
        });
    }
    updateCtrlDisplay();
    listDirectory(currentPath, function(){
        if (keepSelectedItems){
            $(".fileObject").each(function(){
                if (filenameBackups.includes($(this).attr("filename"))){
                    $(this).addClass("selected");
                }
            });
        }
        if (callback != undefined){
            callback();
        }
    });
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.listDirectoryAndHighlight = listDirectoryAndHighlight;
window.refreshList = refreshList;
