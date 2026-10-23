/*
    dragdrop.js

    HTML5 drag and drop, both inside the file list and from the OS.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

    //Make an div not draggable
    function disableDrag(event){
        event.preventDefault();
        event.stopPropagation();
    }

    //Make fileObject draggable
    function onFileObjectDragStart(object, event){
        if ((ctrlHold || hasPrimaryModifier(event)) &&  $(object).hasClass("selected") == false){
            $(object).addClass("selected");
        }else if ($(object).hasClass("selected") == false){
            $(".fileObject.selected").removeClass("selected");
            $(object).addClass("selected");
        }

        var fileList = [];
        $(".selected.fileObject").each(function(){
            var filename = $(this).attr('filename');
            var filepath = $(this).attr('filepath');
            var sourceSystemUUID = systemUUID;
            //Extra information is passed in due to the need for cross cluster communication in the future
            fileList.push({
                filename: filename,
                filepath: filepath,
                hostUUID: sourceSystemUUID
            });
        });
        
        event.dataTransfer.setData("filedata", JSON.stringify(fileList));
        setDragSources(fileList.map(function(file){
            return file.filepath;
        }));
    }

    //Function for getting file objects in the same row
    //Handle drag drop upload
    function drop(event){
        event.preventDefault();
        hideDropIndicator();
        clearDragSources();

        /*
            A drop on a folder row belongs to dropToFolder(). That handler is
            delegated from #folderView - the same element this inline ondrop
            sits on, and the inline one is registered first - so stopping
            propagation there cannot keep this one from running too. Without
            this check a folder drop uploads into both the folder and the
            current directory.
        */
        if (!isSpecialViewPath(currentPath) &&
                $(event.target).closest(".fileObject[type='folder']").length > 0){
            return;
        }

        //Check if this is file upload or file move / copy function
        let dt = event.dataTransfer
        let files = dt.files

        /*
            A special view is open, so there is no directory under the cursor to
            copy or upload into - pasting would send the files at a sentinel
            path and come back as "target path error".

            An in-app drag is handed to the view instead, which is how dropping
            onto the trash bin recycles whether the drop lands on the sidebar
            entry, the desktop icon, or the open bin itself. Files dragged in
            from the operating system have nowhere to go either way.
        */
        if (isSpecialViewPath(currentPath)){
            if (files.length > 0){
                msgbox("red remove", applocale.getString("message/specialview/noUpload",
                    "Files cannot be uploaded here"));
                return;
            }
            let payload = dt.getData("filedata");
            let handled = false;
            if (payload != undefined && payload != ""){
                try {
                    let dropped = JSON.parse(payload);
                    handled = runSpecialViewDrop(currentPath, dropped.map(function(file){
                        return file.filepath;
                    }));
                } catch (ex){
                    console.log(ex);
                }
            }
            if (!handled){
                msgbox("red remove", applocale.getString("message/specialview/noDrop",
                    "This view does not accept dropped files"));
            }
            return;
        }

        if (files.length > 0){
            //Upload file via dragdrop
            msgbox("upload",applocale.getString("message/upload/started", "Upload Started"));
            let items = event.dataTransfer.items;
            for (let i=0; i<items.length; i++) {
                let item = items[i].webkitGetAsEntry();
                if (item) {
                    recursiveScanFilesUpload(item);
                }
            }
            
        }else{
            //File transfer within system
            let filedata = event.dataTransfer.getData("filedata");
            if (filedata != ""){
                try{
                    let fileList = JSON.parse(filedata);
                    //Check if the file objects are from the same host
                    let localFiles = [];
                    let remoteFiles = [];
                    fileList.forEach(file => {
                        if (file.hostUUID == systemUUID){
                            //Local file
                            localFiles.push(file);
                        }else{
                            //Remote files
                            remoteFiles.push(file);
                        }
                    });

                    //Start processing the local files
                    let currentVroot = currentPath.split(":/").shift();

                    //Assume all files are from the same directory
                    if (localFiles.length > 0){
                        let fileVroot = localFiles[0].filepath.split(":/").shift();
                        let isMove = (currentVroot == fileVroot);

                        /*
                            Caught here rather than left to the server: a drop
                            back where the files came from, or a folder into
                            itself, would otherwise open the file operation
                            dialog just to report an error.
                        */
                        let checked = checkDropSources(localFiles.map(function(file){
                            return file.filepath;
                        }), currentPath, isMove);
                        if (checked.error != null){
                            showRefusedDrop(checked.error);
                            return;
                        }

                        //Same device same root moves, a different root copies
                        cutMode = isMove;

                        //Move all localFiles into clipboard
                        clipboard = checked.paths.slice();

                        if (useLocalstorage){
                            localStorage.setItem("ao/file_system/clipboard",JSON.stringify(clipboard));
                            if (cutMode){
                                localStorage.setItem("ao/file_system/cutmode","true");
                            }else{
                                localStorage.setItem("ao/file_system/cutmode","false");
                            }
                            
                        }

                        //Paste all the files to the current path
                        paste();
                    }
                    
                    

                }catch(ex){
                    console.log(ex);
                    msgbox("red remove",applocale.getString("message/decodeFilelistFail", "File drop failed. Unable to decode filelist."));
                }
            }
            
            
        }
        
    }


    function recursiveScanFilesUpload(item, rootpath="", base=""){
        var filesInside = [];
        if (item.isDirectory) {
            //This is a directory
            let directoryReader = item.createReader();
                directoryReader.readEntries(function(entries) {
                entries.forEach(function(entry) {
                    recursiveScanFilesUpload(entry, rootpath + item.name + "/", base);
                });
            });
        }else{
            //This is a file. Upload it
            item.file(function(fileObject){
                if (isChrome || isSafari){
                    //WebKits
                    console.log("Upload Target", fileObject, rootpath);
                    uploadFile(fileObject, undefined, currentPath + rootpath);
                }else{
                    uploadFile(fileObject, undefined, currentPath + base);
                }
                
            });
        }
        return filesInside;
    }

function dropToFolder(event, folderObject=undefined){
    event.preventDefault();
    event.stopImmediatePropagation();
    hideDropIndicator();
    clearDragSources();
    console.log("Drop to folder detected");

    //A special view's rows are not directories to paste into; drop() has
    //already handed the drop to the view
    if (isSpecialViewPath(currentPath)){
        return;
    }

    /*
        Extract target folder path from the folder row. event.target is
        whatever was under the cursor - the icon, the name text, a details
        cell - and only the row itself carries filepath, so look it up from
        the row the delegate matched, or the nearest one around the target.
    */
    if (folderObject === undefined){
        folderObject = $(event.target).closest(".fileObject");
    }
    var targetPath = $(folderObject).attr("filepath");
    if (targetPath === undefined || targetPath == ""){
        return
    }
    
    //Check if this is upload or file move drag
    var files = event.dataTransfer.files;
    if (files.length > 0){
        //Upload mode. Extract the target folder basename from path
        if (targetPath.substr(targetPath.length -1,1) == "/"){
            targetPath = targetPath.substr(0, targetPath.length-1);
        }
        var folderBase = targetPath.split("/").pop() + "/";
        msgbox("upload",applocale.getString("message/upload/started", "Upload Started"));
        var items = event.dataTransfer.items;
        for (let i=0; i<items.length; i++) {
            let item = items[i].webkitGetAsEntry();
            if (item) {
                recursiveScanFilesUpload(item, folderBase, folderBase);
            }
        }
    }else if (event.dataTransfer.getData("filedata") != ""){
        var targetVroot = targetPath.split(":/").shift();
        //Get the source files
        var filelist = [];
        try {
            filelist = JSON.parse(event.dataTransfer.getData("filedata"));
        } catch (ex){
            msgbox("red remove",applocale.getString("message/decodeFilelistFail", "File drop failed. Unable to decode filelist."));
            return;
        }
        if (filelist.length > 0){
            var srcVroot = filelist[0].filepath.split(":/").shift();
            //Same root moves, a different root copies
            cutMode = (srcVroot == targetVroot);

            /*
                A folder dropped onto its own row - easy to do by accident
                with a short drag - is a move into itself. Stop it here
                instead of letting the server answer with an error dialog.
            */
            var checked = checkDropSources(filelist.map(function(file){
                return file.filepath;
            }), targetPath, cutMode);
            if (checked.error != null){
                showRefusedDrop(checked.error);
                return;
            }

            clipboard = checked.paths.slice();
            if (useLocalstorage){
                localStorage.setItem("ao/file_system/clipboard",JSON.stringify(clipboard));
                localStorage.setItem("ao/file_system/cutmode", cutMode ? "true" : "false");
            }
            
            //Perform operations
            paste(targetPath, false)
        }
    }
}

/*
    A drop onto one of the sidebar's special views.

    Only files already inside ArozOS are accepted: an OS drag carries real
    files to upload, and there is nothing behind a sentinel path to upload
    them to. What the drop then means is the view's business - the trash bin
    recycles them.
*/
function dropToSpecialView(event, sentinelPath){
    event.preventDefault();
    event.stopImmediatePropagation();
    hideDropIndicator();
    clearDragSources();

    let payload = event.dataTransfer.getData("filedata");
    if (payload == undefined || payload == ""){
        return;
    }

    let filelist = [];
    try {
        filelist = JSON.parse(payload);
    } catch (e){
        return;
    }
    if (filelist.length == 0){
        return;
    }

    runSpecialViewDrop(sentinelPath, filelist.map(function(file){
        return file.filepath;
    }));
}

function allowDrop(event){
    event.preventDefault();
}


/* ---------------------------------------------------------------------- */
/*  Drop checks                                                            */
/* ---------------------------------------------------------------------- */
//Path without its trailing slash, keeping the one a root ("user:/") needs
function normaliseDropPath(path){
    path = String(path);
    while (path.length > 1 && path.endsWith("/") && !path.endsWith(":/")){
        path = path.substring(0, path.length - 1);
    }
    return path;
}

function parentDirOfPath(path){
    path = normaliseDropPath(path);
    let cut = path.lastIndexOf("/");
    if (cut < 0){
        return path;
    }
    let parent = path.substring(0, cut);
    return parent.endsWith(":") ? parent + "/" : parent;
}

/*
    Which of the dragged paths can go into targetDir. Returns
    {error, paths}: error is the message to show when the drop must not be
    sent at all, otherwise paths is what is left to move or copy.

    A folder into itself or one of its own subfolders is refused outright.
    Items already sitting in targetDir are skipped on a move, and only when
    that leaves nothing is the drop refused - so a drag of several files that
    happens to include one already there still moves the rest.
*/
function checkDropSources(sourcePaths, targetDir, isMove){
    let target = normaliseDropPath(targetDir);
    let remaining = [];
    for (let i = 0; i < sourcePaths.length; i++){
        let src = normaliseDropPath(sourcePaths[i]);
        if (src == target){
            return {error: applocale.getString("message/drop/intoItself", "A folder cannot be moved into itself"), paths: []};
        }
        if (target.indexOf(src + "/") == 0){
            return {error: applocale.getString("message/drop/intoSubfolder", "A folder cannot be moved into its own subfolder"), paths: []};
        }
        if (isMove && parentDirOfPath(src) == target){
            continue;
        }
        remaining.push(sourcePaths[i]);
    }
    if (remaining.length == 0){
        return {error: applocale.getString("message/drop/alreadyHere", "Already in this folder"), paths: []};
    }
    return {error: null, paths: remaining};
}


/* ---------------------------------------------------------------------- */
/*  Drop target indicator                                                  */
/* ---------------------------------------------------------------------- */
/*
    While something is dragged over the file area, the folder it would land
    in is highlighted - the row under the cursor when that is a folder, the
    whole file area otherwise - and a pill at the bottom names it. Dropping
    onto a neighbouring folder row instead of the empty space beside it was
    an easy way to upload into the wrong place without noticing.

    dragenter / dragleave fire for every child the cursor crosses, so they
    are not used. dragover repeats for as long as the cursor is over a drop
    zone, even standing still, so each one refreshes the indicator and
    re-arms a short timer that clears it once they stop.

    The paths being dragged are not readable from dataTransfer until the
    drop. Drags started in a File Manager window record them in localStorage
    (shared by every File Manager window on this origin, which is how a drag
    from another window still gets "cannot move into itself"); the drop
    itself always re-checks against the real payload.
*/
const DRAG_SOURCES_KEY = "ao/file_system/dragsources";
let dragSourcesFallback = [];
let dropIndicatorTimer = null;

function setDragSources(paths){
    dragSourcesFallback = paths;
    try {
        localStorage.setItem(DRAG_SOURCES_KEY, JSON.stringify(paths));
    } catch (ex){}
}

function clearDragSources(){
    dragSourcesFallback = [];
    try {
        localStorage.removeItem(DRAG_SOURCES_KEY);
    } catch (ex){}
}

function getDragSources(){
    try {
        let stored = localStorage.getItem(DRAG_SOURCES_KEY);
        if (stored){
            return JSON.parse(stored);
        }
    } catch (ex){}
    return dragSourcesFallback;
}

function dragTypes(event){
    let dt = event.dataTransfer;
    return (dt && dt.types) ? Array.prototype.slice.call(dt.types) : [];
}

//Last segment of a path, or the root itself ("user:/") for a root
function displayNameOfPath(path){
    path = normaliseDropPath(path);
    if (path.endsWith(":/")){
        return path;
    }
    return path.split("/").pop();
}

/*
    dragover on #folderView. Works out what a drop at the cursor would do
    and shows it.
*/
function updateDropIndicator(event){
    let types = dragTypes(event);
    let isUpload = types.indexOf("Files") >= 0;
    let isInternal = types.indexOf("filedata") >= 0;
    if ((!isUpload && !isInternal) || isSpecialViewPath(currentPath)){
        hideDropIndicator();
        return;
    }

    let row = $(event.target).closest(".fileObject[type='folder']");
    let targetPath = row.length > 0 ? row.attr("filepath") : currentPath;
    let label;
    let valid = true;

    if (isUpload && !isInternal){
        label = applocale.getString("drop/uploadTo", "Upload to “{name}”");
    }else{
        let sources = getDragSources();
        let isMove = sources.length == 0 ||
            sources[0].split(":/").shift() == targetPath.split(":/").shift();
        let checked = checkDropSources(sources, targetPath, isMove);
        if (sources.length > 0 && checked.error != null){
            label = checked.error;
            valid = false;
        }else if (isMove){
            label = applocale.getString("drop/moveTo", "Move to “{name}”");
        }else{
            label = applocale.getString("drop/copyTo", "Copy to “{name}”");
        }
    }

    showDropIndicator(row.length > 0 ? row : $("#folderView"),
        label.replace("{name}", displayNameOfPath(targetPath)), valid);
}

/*
    dragover on a sidebar special view (the trash bin). Those only take
    files already inside ArozOS.
*/
function updateSpecialViewDropIndicator(event, item){
    if (dragTypes(event).indexOf("filedata") < 0){
        hideDropIndicator();
        return;
    }
    let name = $(item).text().trim();
    showDropIndicator($(item),
        applocale.getString("drop/moveTo", "Move to “{name}”").replace("{name}", name), true);
}

function showDropIndicator(target, label, valid){
    $(".fmDropTarget").not(target).removeClass("fmDropTarget");
    target.toggleClass("fmDropTarget", valid);

    showDropHint(label, valid);
    $("#fmDropHint").removeClass("refused");

    clearTimeout(dropIndicatorTimer);
    dropIndicatorTimer = setTimeout(hideDropIndicator, 160);
}

function showDropHint(label, valid){
    let hint = $("#fmDropHint");
    hint.toggleClass("invalid", !valid);
    hint.find(".fmDropHintText").text(label);

    //Pinned to the bottom of the file area, which scrolls, so it sits over
    //it rather than inside it
    let area = document.getElementById("folderView").getBoundingClientRect();
    hint.css({
        left: (area.left + area.width / 2) + "px",
        top: (area.bottom - 16) + "px",
        maxWidth: Math.max(160, area.width - 32) + "px"
    });
    hint.addClass("visible");
}

/*
    A drop the checks refused. The hint pill was already saying why while
    the drag hovered, so it stays up a moment longer with the same text
    rather than a second message appearing in the toast.
*/
function showRefusedDrop(label){
    $(".fmDropTarget").removeClass("fmDropTarget");
    showDropHint(label, false);
    $("#fmDropHint").addClass("refused");
    clearTimeout(dropIndicatorTimer);
    dropIndicatorTimer = setTimeout(hideDropIndicator, 1800);
}

function hideDropIndicator(){
    clearTimeout(dropIndicatorTimer);
    $(".fmDropTarget").removeClass("fmDropTarget");
    $("#fmDropHint").removeClass("visible refused");
}

//dragend on the dragged row, which fires after the drop has been handled
function onFileObjectDragEnd(){
    clearDragSources();
    //A refused drop's message is still meant to be read
    if (!$("#fmDropHint").hasClass("refused")){
        hideDropIndicator();
    }
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.allowDrop = allowDrop;
window.checkDropSources = checkDropSources;
window.clearDragSources = clearDragSources;
window.hideDropIndicator = hideDropIndicator;
window.onFileObjectDragEnd = onFileObjectDragEnd;
window.updateDropIndicator = updateDropIndicator;
window.updateSpecialViewDropIndicator = updateSpecialViewDropIndicator;
window.dropToSpecialView = dropToSpecialView;
window.disableDrag = disableDrag;
window.drop = drop;
window.dropToFolder = dropToFolder;
window.onFileObjectDragStart = onFileObjectDragStart;
