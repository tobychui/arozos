/*
    ArozOS Desktop - Drag and drop

    Dragging icons around the desktop and dropping files, folders, list
    menu entries and uploads onto the desktop, folders and the trash.

    Part of desktop.html, see README.md in this folder for the load order.
*/

// ========================== LAUNCH ICON OPERATIONS ================

//This function start all the launchicon related events
function drag(ev) {
    //If rename mode, disable drag drop
    if (renameMode){
        return false;
    }
    var target = ev.target;
    if (!($(ev.target).is("div") || $(ev.target).is("a"))) {
        target = $(target).parent();
    }

    //Parse the standard filename / filepath data
    var filename = $(target).attr("filename");
    var filepath = $(target).attr('filepath');
    ev.dataTransfer.setData("filename", filename);
    ev.dataTransfer.setData("filepath", filepath);

    //Parse multifile selection filedata
    var filelist = [];
    if ($(".launchIconWrapper.selected").length > 0){
        if (ctrlHold || $(".launchIconWrapper.selected").length > 1){
            //Include all objects selected
            $(".launchIconWrapper.selected").each(function(){
                var fd = $(this).parent().attr("filedata");
                fd = JSON.parse(decodeURIComponent(fd));
                filelist.push({
                    filename: fd.Filename,
                    filepath: fd.Filepath,
                    hostUUID: hostInfo.DeviceUUID
                });
            });
        }else{
            //Only push the one selected
            filelist.push({
                filename: filename,
                filepath: filepath,
                hostUUID: hostInfo.DeviceUUID
            });
        }
    }else{
        //There is no selected item on desktop. Use the drag drop one
        filelist.push({
            filename: filename,
            filepath: filepath
        });
    }

    //console.log(filelist);
    ev.dataTransfer.setData("filedata", JSON.stringify(filelist));
    console.log(filelist);
    //Set a flag on the drag events that these files are from Desktop GUI
    ev.dataTransfer.setData("desktopflag", "true");

    //Record the start drop relative position of the icon object
    var dx = ev.pageX - $(target).offset().left;
    var dy = ev.pageY - $(target).offset().top;
    startDragRelatuve = [dx, dy];
    ev.stopPropagation();
}

function drop(ev) {
    ev.preventDefault();
    ev.stopImmediatePropagation();
    var target = $(ev.target);
    if (!(target.is("div") || target.is("a"))) {
        target = $(target).parent();
    }
    if (target.hasClass("launchIconWrapper")) {
        target = target.parent();
    }
    var thisFilepath = $(target).attr("filepath");
    if (thisFilepath == ev.dataTransfer.getData("filepath")) {
        //Drag and drop on the same item. Ignore it
        return;
    }
    var sourceFilename = ev.dataTransfer.getData("filename");
    var sourceFilepath = ev.dataTransfer.getData("filepath");

    // ── List-menu app drag → create shortcut at drop location ──────────────
    var _dragType = ev.dataTransfer.getData("moduledragtype");
    if ((_dragType === "module" || _dragType === "app") && target.attr("id") === "bgwrapper") {
        var _mName = ev.dataTransfer.getData("modulename");
        var _mIcon = ev.dataTransfer.getData("moduleicon");
        //Container apps are opened by slug, modules by name
        var _mPath = _dragType === "app" ? ev.dataTransfer.getData("moduleslug") : _mName;
        var _locs  = gridPositionAllocate(ev.clientX, ev.clientY, 1);
        var _gx = _locs[0][0], _gy = _locs[0][1];
        $.ajax({
            url:    "system/desktop/createShortcut",
            method: "POST",
            data:   { stype: _dragType, stext: _mName, spath: _mPath, sicon: _mIcon },
            success: function(data) {
                if (data.error) { console.log(data.error); return; }
                // Set position then refresh; filename is <name>.shortcut
                setIconDesktopLocation(_mName + ".shortcut", _gx, _gy, function() {
                    refresh(undefined, false);
                });
            }
        });
        // Close list menu after a successful drop
        hideListMenu();
        return;
    }
    // ────────────────────────────────────────────────────────────────────────

    //To handle multiple file transfer from file explorer
    var sourceFilelist = ev.dataTransfer.getData("filedata");

    //To handle drag dropping URLs onto desktop
    var linkObject = ev.dataTransfer.getData('text/html');
    var remoteLink = ($(linkObject).find("a").length>0 || $(linkObject).is("a"))? ($(linkObject).find("a").attr("href")|| $(linkObject).attr("href")):($(linkObject).find("img").length>0?$(linkObject).find('img').attr("src"):($(linkObject).attr('src')!=""?$(linkObject).attr('src'):undefined));
    //var remoteSrc = $(linkObject).find("img").length>0?$(linkObject).find('img').attr("src"):undefined; //If dragging in media (e.g. img / audio)
    console.log(target)
    console.log(sourceFilename);
    console.log(sourceFilepath);
    console.log(remoteLink);

    if (sourceFilelist !== ""){
        sourceFilelist = JSON.parse(sourceFilelist);
    }

    //Drop opererations
    if (target.attr("id") == "bgwrapper") {
        if (sourceFilename == "" && sourceFilepath == "" && ev.dataTransfer.files.length > 0){
            //Drag drop from external source. Upload to desktop
            //Assign the locations for the objects
            var files = ev.dataTransfer.files;
            var gridMaxX = desktopGrids.length;
            var gridMaxY = desktopGrids[0].length;
            var targetLocation = findClosestGrid((ev.clientX), (ev.clientY), false);
            var targetGridLocation = targetLocation[1];
            var locations = [];

            //Rewrite of the upload file target location, 2022-02-02
            //Back step the y location of drag point by 1
            targetGridLocation[1] = targetGridLocation[1] - 1;
            var nextLocation = JSON.parse(JSON.stringify(targetGridLocation));
            for (var k =0; k < files.length; k++){
                //Add 1 to the file y position
                nextLocation[1] += 1;
                if (nextLocation[1] >= gridMaxY){
                    //If y overflow, move to next x lane
                    nextLocation[0] += 1;
                    nextLocation[1] = 0;
                }

                if (nextLocation[0] >= desktopGrids.length){
                    //Desktop full. Force put to 0 0 
                    nextLocation[0] = 0;
                    nextLocation[1] = 0;
                    locations.push(JSON.parse(JSON.stringify(nextLocation)));
                    continue;
                }


                //Check if this position is occupied, update next placement location if true
                console.log("Grid Location:", nextLocation[0], nextLocation[1]);
                while (getObjectFromGridLocation(nextLocation[0], nextLocation[1]) !== undefined){
                    let gridLocation = getLocationFromGridIndex(nextLocation[0], nextLocation[1]);
                    let newAssignmentLocation = findClostestEmptyGridLocation(gridLocation[0],gridLocation[1]);
                    nextLocation = newAssignmentLocation[1];
                    console.log("Not empty. Updating")
                }

                locations.push(JSON.parse(JSON.stringify(nextLocation)));
            }

            console.log(locations, ev.dataTransfer.files);

            //Register file locations
            for (var j =0; j < locations.length; j++){
                let thisFile = files[j];
                let thisFilename = files[j].name;
                let x = parseInt(locations[j][0]);
                let y = parseInt(locations[j][1]);
                let uploadIconUUID = generateUploadingIcon(thisFile.name, [x,y]);
                var refreshTimer;
                uploadFile(thisFile,function(){
                    console.log("Uploader callback");
                    setIconDesktopLocation(thisFilename, x, y, function(){
                        //Refresh the desktop
                        clearTimeout(refreshTimer);
                        refreshTimer = setTimeout(function(){
                            refresh(undefined, false);
                        }, 500)
                    });
                }, uploadIconUUID);

            }
        }else if (sourceFilelist.length > 0 && Array.isArray(sourceFilelist)){
            //Drag drop multiple files from desktop or file explorer to desktop
            var desktopFlag = ev.dataTransfer.getData("desktopflag"); 
            if (desktopFlag == "" || desktopFlag === undefined || desktopFlag == null){
                //This is a file drag drop from not desktop to desktop
                var filelist = ev.dataTransfer.getData("filedata");
                if (filelist != ""){
                    filelist = JSON.parse(filelist);
                    if (filelist.length == 0){
                        return
                    }

                    //Get the position for this drop events and arrange grid locations
                    var gridPosition = gridPositionAllocate(ev.clientX, ev.clientY, filelist.length);
                    console.log(gridPosition)

                    //Check if source is also from user:/
                    var srcVroot = filelist[0].filepath.split(":/").shift();
                    var mode = "copy"
                    if (srcVroot == "user"){
                        //Move
                        mode = "move"
                    }

                    var filepathList = [];
                    filelist.forEach(file => {
                        filepathList.push(file.filepath)
                    });

                    //Start the file operation dialog
                    startFileOperation({
                        opr: mode,
                        src: filepathList,
                        dest: "user:/Desktop/",
                        overwriteMode: "ask"
                    });
                }


            }else{
                //This is a file drag event from desktop, but more than one files.
                //Pin the final location for the drag drop object
                var sourceObject = getObjectFromPath(sourceFilepath);
                var dx = startDragRelatuve[0];
                var dy = startDragRelatuve[1];
                var targetLocation = findClosestGrid((ev.clientX - dx), (ev.clientY - dy));
                var closestLocation = targetLocation[0];
                var duplicateObject = getObjectFromLocation(closestLocation[0]  + iconOffsetXY[0], closestLocation[1]  + iconOffsetXY[1]);
                if (duplicateObject !== undefined) {
                    //There are already object there. Do nothing
                    console.log("Drop location duplicated!")
                    return;
                }

                //Get other objects that is not the one drag dropped
                var iconOffset = {};
                for (var i =0; i < sourceFilelist.length; i++){
                    var thisFile = sourceFilelist[i];
                    if (thisFile.filepath != sourceFilepath){
                        //Calculate the x y offset of this icon to the drag drop one
                        var thisIconObject = getObjectFromPath(thisFile.filepath);
                        iconOffset[thisFile.filepath] = {
                            dx: $(sourceObject).offset().left - $(thisIconObject).offset().left,
                            dy: $(sourceObject).offset().top - $(thisIconObject).offset().top
                        }
                        //console.log(thisFile.filename, iconOffset[thisFile.filepath]);
                    }
                }

                //Move the drag drop object to the desiged location
                $(sourceObject).css({
                    left: closestLocation[0] + iconOffsetXY[0],
                    top: closestLocation[1] + iconOffsetXY[1]
                });

                //Save the drag item location
                setIconDesktopLocation(sourceFilename, targetLocation[1][0], targetLocation[1][1], function(){
                    //console.log(data);
                });

                //Move all the relative files to the main object
                var relocatePendingObjects = [];
                for (const [filepath, offset] of Object.entries(iconOffset)) {
                    let thisIconObject = getObjectFromPath(filepath);
                    let caluclatedLocation = [$(sourceObject).offset().left - offset.dx, $(sourceObject).offset().top - offset.dy];
                    let finalIconLocation = findClosestGrid(caluclatedLocation[0], caluclatedLocation[1]);

                    //Move this icon to designed location
                    $(thisIconObject).css({
                        left: finalIconLocation[0][0] + iconOffsetXY[0],
                        top: finalIconLocation[0][1] + iconOffsetXY[1]
                    });

                    let thisIconFileData = JSON.parse(decodeURIComponent($(thisIconObject).attr("filedata")));

                    //Record this in database
                    setIconDesktopLocation(thisIconFileData.Filename, finalIconLocation[1][0], finalIconLocation[1][1], function(){

                    });
                }

                //Get duplication objects
                for (const [filepath, offset] of Object.entries(iconOffset)) {
                    let thisIconObject = getObjectFromPath(filepath);
                    //Check for duplication
                    var iconLocation = [$(thisIconObject).offset().left, $(thisIconObject).offset().top];
                    $(".launchIcon").each(function(){
                        if ($(this).offset().left == iconLocation[0] && $(this).offset().top == iconLocation[1]){
                            //This icon is at the target icon location
                            if ($(this).attr("filepath") != filepath){
                                relocatePendingObjects.push($(this));
                            }
                        }
                    });
                }


                //Relocate objects that is in the way of moving
                for (var i = 0; i < relocatePendingObjects.length; i++){
                    var thisObject = relocatePendingObjects[i];
                    console.log(thisObject);
                    var thisX = $(thisObject).offset().left;
                    var thisY = $(thisObject).offset().top;
                    var nextEmptyGrid = findClostestEmptyGridLocation(thisX, thisY);

                    //Move this file to the next empty grid location
                    $(thisObject).css({
                        left: nextEmptyGrid[0][0] + iconOffsetXY[0],
                        top: nextEmptyGrid[0][1] + iconOffsetXY[1]
                    });

                    //Save move record to db
                    let thisIconFileData = JSON.parse(decodeURIComponent($(thisObject).attr("filedata")));
                    setIconDesktopLocation(thisIconFileData.Filename, nextEmptyGrid[1][0], nextEmptyGrid[1][1], function(){
                        removeDesktopIconDuplicates();
                    });
                }
            }

        }else{
            //Dropping a file onto other place on desktop
            var sourceObject = getObjectFromPath(sourceFilepath);
            var dx = startDragRelatuve[0];
            var dy = startDragRelatuve[1];
            var targetLocation = findClosestGrid((ev.clientX - dx), (ev.clientY - dy));
            var closestLocation = targetLocation[0];
            //Check if there are objects already at that location
            var duplicateObject = getObjectFromLocation(closestLocation[0], closestLocation[1]);
            if (duplicateObject !== undefined) {
                //There are already object there. Do nothing
                console.log("Drop location duplicated!")
                return;
            }
            var closestGridIndex = targetLocation[1];
            $(sourceObject).css({
                left: closestLocation[0] + iconOffsetXY[0],
                top: closestLocation[1] + iconOffsetXY[1]
            });
            setIconDesktopLocation(sourceFilename, closestGridIndex[0], closestGridIndex[1], function(){

            });
        }
    } else if (target.attr("type") == "folder") {
        //Move this file or folder into the target folder
        var moveSources = [sourceFilepath];
        if ($(".launchIconWrapper.selected").length > 1){
            //Multi move operations
            moveSources = [];
            $(".launchIconWrapper.selected").each(function(){
                var thisFileData = $(this).parent().attr("filedata");
                thisFileData = JSON.parse(decodeURIComponent(thisFileData));
                moveSources.push(thisFileData.Filepath);
            });
        }

        //Get the move target location
        var targetFd = $(target).attr("filedata");
        targetFd = JSON.parse(decodeURIComponent(targetFd));

        //Move it
        moveSourceFilesToTarget(moveSources, targetFd.Filepath)

    } else if (target.attr("type") == "shortcut") {
        //Opening with the shortcut
        //Check shortcut type
        let shortcutData = JSON.parse(decodeURIComponent($(target).attr("filedata")));
        var shortcutType = shortcutData["ShortcutType"];
        if (shortcutType == "module") {
            //Open the source file with this module
            let openFileList = [];
            if ($(".launchiconwrapper.selected").length > 0 && !Array.isArray(sourceFilelist)) {
                $(".launchiconwrapper.selected").each(function() {
                    let thisFileData = JSON.parse(decodeURIComponent($(this).parent().attr("filedata")));
                    openFileList.push({
                        filename: thisFileData["Filename"],
                        filepath: thisFileData["Filepath"]
                    });
                });
            }else if (sourceFilelist.length > 0 && Array.isArray(sourceFilelist)){
                //Open file that is transfered from file explorer.
                openFileList = sourceFilelist;
                console.log(openFileList);
            } else {
                //Only pass in the current selected file.
                openFileList.push({
                    filename: sourceFilename,
                    filepath: sourceFilepath
                });
            }

            var shortcutModule = getModuleFromShortcutInfo(shortcutData);
            //console.log(openFileList);
            if (shortcutModule === undefined){
                //This shortcut module is not found on this server
                return;
            }
            openFileWithModule(shortcutModule, openFileList);
        } else if (shortcutType == "folder") {
            /*
                A sentinel path is a view, not a directory: there is
                nowhere on disk to move anything to. The trash bin is
                the one that means something anyway - dropping onto it
                recycles, the same as dragging onto the sidebar entry
                inside the File Manager.
            */
            if (isSpecialPath(shortcutData.ShortcutPath)) {
                if (getSpecialPathInfo(shortcutData.ShortcutPath).recycleOnDrop === true) {
                    recycleDroppedFiles(collectDropSources(sourceFilepath));
                }
                return;
            }
            //Move the source file into this folder
            var moveSources = [sourceFilepath];
            if ($(".launchIconWrapper.selected").length > 1){
                //Multi move operations
                moveSources = [];
                $(".launchIconWrapper.selected").each(function(){
                    var thisFileData = $(this).parent().attr("filedata");
                    thisFileData = JSON.parse(decodeURIComponent(thisFileData));
                    moveSources.push(thisFileData.Filepath);
                });
            }

            //Extract shortcut info from the target
            var targetPath = shortcutData.ShortcutPath;
            moveSourceFilesToTarget(moveSources, targetPath);
        }

    } else {
        console.log("Unknown action type: ", target.attr("type"));
    }
}


/*
    Everything a drop is carrying: the whole desktop selection when the
    dragged icon is part of it, otherwise just the one that was dragged.
    Same rule moveSourceFilesToTarget's callers use.
*/
function collectDropSources(sourceFilepath){
    let sources = [];
    if ($(".launchIconWrapper.selected").length > 1){
        $(".launchIconWrapper.selected").each(function(){
            let thisFileData = JSON.parse(decodeURIComponent($(this).parent().attr("filedata")));
            sources.push(thisFileData.Filepath);
        });
    }
    if (sources.length == 0 && sourceFilepath != undefined && sourceFilepath != ""){
        sources.push(sourceFilepath);
    }
    return sources;
}

/*
    Move files into the trash bin. No confirmation, as on any other
    desktop: this is the undoable delete, and the files are one Restore
    away inside the File Manager's bin.
*/
function recycleDroppedFiles(filepaths){
    if (filepaths == undefined || filepaths.length == 0){
        return;
    }
    generateCSRFToken(function(csrftoken){
        $.ajax({
            url: "system/file_system/fileOpr",
            method: "POST",
            data: {opr: "recycle", src: JSON.stringify(filepaths), csrft: csrftoken},
            success: function(data){
                if (data.error !== undefined){
                    //TRASH_QUOTA_EXCEEDED lands here too - the desktop has
                    //no dialog for it, so it is reported as it comes back
                    alert(data.error);
                    return;
                }
                //Drop the desktop positions of whatever just left
                filepaths.forEach(function(fpath){
                    let filename = fpath.split("/").pop();
                    $.ajax({
                        url: "system/desktop/files",
                        data: {del: filename},
                        success: function(){
                            refresh(undefined, true);
                        }
                    });
                });
                refresh(undefined, true);
                dockRefreshTrash();
            }
        });
    });
}

//Use move if it is folder on desktop, use copy if it is a shortcut
function moveSourceFilesToTarget(sourceList, target, opr="move"){
    //Hand the operation over to the system wide file operation dialog
    startFileOperation({
        opr: opr,
        src: sourceList,
        dest: target,
        callbackWindowID: "desktop",
        callbackFunction: `refresh(undefined, true)`
    });

    //Delete the file location from db
    sourceList.forEach(file => {
        let filename = file.split("/").pop();
        $.ajax({
            url: "system/desktop/files",
            data: {del: filename},
            success: function(data){
                if (data.error !== undefined){
                    console.log(data.error);
                }
            }
        });
    });
}

//THIS FUNCTION IS NEEDED. DO NOT DELETE ALLOWDROP FUNCTION
function allowDrop(ev) {
    ev.preventDefault();
}
