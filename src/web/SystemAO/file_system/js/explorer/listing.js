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
        ao_module_setWindowTitle(applocale.getString("title/title", "File Manager") + " - " + tmp.pop());
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
                data: {dir: decodeURIComponent(path), sort: sortMode},
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
                        
                        //Print folder not found exception
                        $("#folderList").show();
                        $("#folderList").html(`<div class="ui basic segment">
                            <div class="ui header themed">
                                <i class="remove icon"></i> <span>${applocale.getString("message/folderCannotOpen","This Folder Cannot Be Opened")}</span>
                                <div class="sub header" style="margin-top:12px;">${applocale.getString("message/folderCannotOpen/codedesc","The server return the following error message:")} <br><code>${data.error.toUpperCase()}</code><br>
                                    ${new Date().toLocaleString(undefined, {year: 'numeric', month: '2-digit', day: '2-digit', weekday:"long", hour: '2-digit', hour12: false, minute:'2-digit', second:'2-digit'})}</div>
                            </div>
                        </div>`);
                        $("#fileList").hide();

                        enableAutoRefresh = false;
                        return;
                    }else{
                        enableAutoRefresh = true;
                        //Filelist returned. Render it
                        renderDirectory(data,function(){
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
                if (data.error == "Invalid dir given"){
                    //Storage has been unmounted. Back to parent
                    var pdir = currentPath.split("/");
                    pdir.pop();pdir.pop();
                    pdir = pdir.join("/");
                    currentPath = pdir;
                    listDirectory(currentPath, function(){
                        window.location.reload();
                    });
                    return;
                }else if (data.error == "Unable to resolve target directory"){
                    //Resolve failed. Back to user:/
                    var pdir = currentPath.split("/");
                    pdir = pdir.shift() + "/";
                    listDirectory(pdir, function(){
                        window.location.reload();
                    });
                }
            }
            callback(data);
        }
    })
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
