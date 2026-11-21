/*
    ArozOS Desktop - Desktop icons

    Loading the desktop folder, drawing the launch icons with their file
    descriptions and share indicators, thumbnails, refresh and the
    background watch that refreshes the desktop when its files change.

    Part of desktop.html, see README.md in this folder for the load order.
*/

function initDesktopIconPreference() {
    getStorage("iconsize", function(catergory) {
        if (["small", "medium", "big"].includes(catergory)) {
            desktopIconSize = catergory;
        }
        refresh();
        hideAllContextMenus();
    });
}

//Remove icons duplication due to sync issue to server
function removeDesktopIconDuplicates(){
    var duplicates = {};
    $(".launchIcon").each(function(){
        //Check if there are duplicates. If yes, remove it
        let thisIconFilename = $(this).attr("filename");
        let identicalIcons = $(`.launchIcon[filename=\"${thisIconFilename}\"]`);
        if (identicalIcons.length > 1 && typeof(duplicates[thisIconFilename]) == "undefined"){
            duplicates[thisIconFilename] = identicalIcons;
        }
    });

    for (const [key, value] of Object.entries(duplicates)) {
        for (var i = 0; i < value.length-1; i++){
            value[i].remove();
        }
    }
}

//================== DESKTOP FILE LOCATION FUNCTIONS ====================
function initDesktopFiles(optionObject = {}, callback = undefined) {
    $.get("system/desktop/listDesktop", function(data) {
        if (data.error !== undefined){
            console.log("[Desktop] Unable to list desktop files: ", data.error);
            if (callback !== undefined) {
                callback(false);
            }
            return;
        }
        //Prase optionObject
        var noflash = false;
        if (typeof optionObject.noflash !== "undefined"){
            noflash = optionObject.noflash;
        }
        if (noflash){
            //Only clean out those object that not exists in the new filelist
            var existsingFilepaths = [];
            if (data != null){
                for (var i =0; i < data.length; i++){
                    existsingFilepaths.push(data[i].Filepath);
                }
            }else{
                //Nothing on desktop
            }

            //console.log(existsingFilepaths);
            //If the launchIcon path is not in the latest list, remove it from desktop
            $(".launchIcon").each(function(){
                if (existsingFilepaths.includes($(this).attr("filepath")) == false){
                   $(this).remove();
                }
            });

            //Duplicate removal function
            setTimeout(function(){
                //removeDesktopIconDuplicates();
            }, 300);
        }else{
            //Cleanup all previous icons
            $("#iconwrapper").children().each(function(){
                if ($(this).hasClass("launchIcon") && $(this).attr("type") == "dummy"){
                    //Special kind of launchIcon. Skip this
                    return;
                }
                $(this).remove();
            });
        }
        //Allocate new items location
        var iheight = 106;
        var iwidth = 70;
        var padding = 16;
        if (desktopIconSize == "small") {
            iheight = 82;
            iwidth = 50;
        } else if (desktopIconSize == "medium") {
            iheight = 106;
            iwidth = 70;
        } else if (desktopIconSize == "big") {
            iheight = 124;
            iwidth = 84;
        }

        iconSize = [iwidth, iheight];
        var screenHeight = window.innerHeight;
        var screenWidth = window.innerWidth;

        var vc = Math.floor((screenHeight - 20 - padding) / iheight);
        var hc = Math.floor((screenWidth - padding) / iwidth);

        var slots = []; //A 2D array for storing relative to absolute locations
        for (var j = 0; j < hc; j++) {
            var thisLocationList = [];
            for (var i = 0; i < vc; i++) {
                var thisLocation = [j * iwidth + padding, i * iheight + padding];
                thisLocationList.push(thisLocation);
            }
            slots.push(thisLocationList);
        }
        //Store the root position (0,0) in rootPosition
        let rootPosition = JSON.parse(JSON.stringify(slots[0][0]));
        desktopGrids = JSON.parse(JSON.stringify(slots));

        //Assign items to desktop
        var unallocatedFiles = [];
        let remainingSlots = JSON.parse(JSON.stringify(slots));
        desktopFileList = [];
        if (data === null){
            //No files on desktop
            return;
        }
        for (var i = 0; i < data.length; i++) {
            var thisFile = data[i];
            desktopFileList.push(JSON.parse(JSON.stringify(thisFile.Filename)));
            //Get icon from the icon list
            var location = [thisFile.IconX, thisFile.IconY];
            if (location[0] == -1 && location[1] == -1) {
                //This file is not located. Push it into unallocatedFileList
                unallocatedFiles.push(thisFile);
            } else if (location[0] >= slots.length || location[1] >= slots[0].length) {
                //This file is outside of the screen area. Set to be be unallocatedFiles as well
                unallocatedFiles.push(thisFile);
            } else {
                //This file is already located. Push it location into occupiedSlots
                //var screenX = location[0] * iwidth + padding/2;
                //var screenY = location[1] * iheight + padding/2;
                var screenLocation = slots[location[0]][location[1]];

                //Remove this object from remaining slots
                remainingSlots[location[0]][location[1]] = undefined;
                //console.log(thisFile, screenLocation[0], screenLocation[1], iheight, iwidth);
                appendIconAtLocation(thisFile, screenLocation[0], screenLocation[1], iheight, iwidth, noflash);
            }
        }

        //Foreach remaining files, assign a location for it.
        var walk = [slots.length, slots[0].length];
        var current = [0, 0];
        for (var i = 0; i < unallocatedFiles.length; i++) {
            var thisFile = unallocatedFiles[i];
            try{
                while (typeof(remainingSlots[current[0]][current[1]]) == "undefined") {
                    //This slot is not usabled. Next slot.
                    current[1] += 1;
                    if (current[1] >= walk[1]) {
                        current[1] = 0;
                        current[0] += 1;
                    }

                    if (typeof(remainingSlots[current[0]]) == "undefined"){
                        //Not enough space to fit the item. Move it to 0 0 instead
                        current = [-1,-1];
                        console.log(current);
                        break;
                    }

                }
            }catch{
                //Something went wrong while assigning positions. Set at root location
                current = [-1,-1];
            }

            //Append the icon to screen
            if (current[0] == -1 && current[1] == -1){
                //Screen overflow. Stack the file at (0,0)
                screenLocation = [rootPosition[0], rootPosition[1]];
                console.log(screenLocation);
            }else{
                screenLocation = remainingSlots[current[0]][current[1]];
                remainingSlots[current[0]][current[1]] = undefined;
            }

            appendIconAtLocation(thisFile, screenLocation[0], screenLocation[1], iheight, iwidth, noflash);

            //Save the icon location to server
            setIconDesktopLocation(thisFile.Filename, current[0], current[1], function(){
                if (data.error !== undefined) {
                    console.log(data.error);
                }
            });
        }

        //Update the desktop hash to prevent the auto refresh by hash
        getDesktopHash(function(hash){
            desktopFileHash = hash;
        });

        if (callback !== undefined) {
            //console.log(callback);
            callback(true);
        }
    });
}

function redrawDesktopGrids() {
    var iheight = 106;
    var iwidth = 70;
    var padding = 16;
    if (desktopIconSize == "small") {
        iheight = 82;
        iwidth = 50;
    } else if (desktopIconSize == "medium") {
        iheight = 106;
        iwidth = 70;
    } else if (desktopIconSize == "big") {
        iheight = 124;
        iwidth = 84;
    }

    iconSize = [iwidth, iheight];
    var screenHeight = window.innerHeight;
    var screenWidth = window.innerWidth;

    var vc = Math.floor((screenHeight - 20 - padding) / iheight);
    var hc = Math.floor((screenWidth - padding) / iwidth);

    var slots = []; //A 2D array for storing relative to absolute locations
    for (var j = 0; j < hc; j++) {
        var thisLocationList = [];
        for (var i = 0; i < vc; i++) {
            var thisLocation = [j * iwidth + padding, i * iheight + padding];
            thisLocationList.push(thisLocation);
        }
        slots.push(thisLocationList);
    }

    desktopGrids = JSON.parse(JSON.stringify(slots));
}

function getTextPixelWidth(measureText){
    let canvas = document.getElementById('textWidthCanvas');
    let ctx = canvas.getContext('2d');
    let text = ctx.measureText(measureText);
    let estimatedFilenameSize = text.width;
    if (desktopIconSize == "small"){
        estimatedFilenameSize = estimatedFilenameSize * 0.8679245283018868;
    }else if (desktopIconSize == "big"){
        estimatedFilenameSize = estimatedFilenameSize * 1.509433962264151;
    }else{
        estimatedFilenameSize = estimatedFilenameSize * 1.2452830188679245;
    }
    return estimatedFilenameSize;
}

function appendIconAtLocation(filedata, screenX, screenY, iheight, iwidth, updateMode=false) {
    //Get the icon from extension
    var icon = ao_module_utils.getIconFromExt(filedata.Ext.substring(1, filedata.Ext.length));
    var imagePath = "img/desktop/files_icon/" + desktopIconPack + "/" + icon + ".png";
    //Use module-registered icon for proprietary/unrecognised extensions
    if (icon === "file outline" && extIconRegistry[filedata.Ext.substring(1).toLowerCase()]) {
        imagePath = extIconRegistry[filedata.Ext.substring(1).toLowerCase()];
    }
    //Handle special icon types here
    var size = desktopIconSize;
    var filename = JSON.parse(JSON.stringify(filedata.Filename));
    var filepath = JSON.parse(JSON.stringify(filedata.Filepath));
    var isDir = JSON.parse(JSON.stringify(filedata.IsDir));
    var isEmptyDir = JSON.parse(JSON.stringify(filedata.IsEmptyDir));
    var isShared = JSON.parse(JSON.stringify(filedata.IsShared));
    var maxlength = 12;
    var type = "file";
    let shortenedName = filename;
    screenX += iconOffsetXY[0];
    screenY += iconOffsetXY[1];

    if (isDir) {
        //Folder objects
        icon = "folder outline";
        if (isEmptyDir){
            imagePath = "img/desktop/system_icon/folder.png";
        }else{
            imagePath = "img/desktop/system_icon/folder-with-content.png";
        }

        type = "folder";
    } else if (isDir == false && icon == "folder outline") {
        icon = "file outline";
        imagePath = "img/desktop/files_icon/" + desktopIconPack + "/file outline.png";
        type = "file";
    } else if (filedata.Ext == ".exe" || filedata.Ext == ".elf") {
        //Executable objects
        imagePath = "img/desktop/system_icon/script.png";
        type = "executable";
    } else if (filedata.Ext == ".shortcut") {
        //Shortcut
        var shortcutImage = filedata.ShortcutImage;
        shortenedName = JSON.parse(JSON.stringify(filedata.ShortcutName));
        /*
            A shortcut to a sentinel path (%trashbin% and friends) is
            drawn with that view's own icon rather than whatever is
            written in the file - shortcuts made by an older build, or
            by hand, then still look right.
        */
        var specialIcon = specialPathIconFrom(filedata.ShortcutPath, "");
        imagePath = (specialIcon != null) ? specialIcon : shortcutImage;
        type = "shortcut";
    }
    //Check if it is under small text mode
    if (size == "small"){
        maxlength = 46;
    }else if (size == "big"){
        maxlength = 80;
    }else{
        maxlength = 66;
    }


    var estimatedFilenameSize = 0;
    if (type == "shortcut"){
        estimatedFilenameSize = getTextPixelWidth(shortenedName);
    }else{
        estimatedFilenameSize = getTextPixelWidth(filename);
        shortenedName = filename;
        if (estimatedFilenameSize > (maxlength * 2 - 10)) {
            //This name is too long to fit inside two lines
            var newFilenameLength = getTextPixelWidth(shortenedName + "...");
            while (newFilenameLength >= (maxlength * 2 - 10)){
                shortenedName = shortenedName.substr(0, shortenedName.length - 1);
                newFilenameLength = getTextPixelWidth(shortenedName + "...");
            }

            shortenedName = shortenedName + "...";
        }
    }

    if (estimatedFilenameSize < (maxlength * 2 - 10)  && estimatedFilenameSize > (maxlength - 5) && shortenedName.indexOf(" ") > 0){
        //This is short enough to fit inside two lines and it contains space
        //Try to see if there is a combination of splitting that fit inside two lines
        var filenameSegments = shortenedName.split(" ");
        var segEnd = 1;
        var currentSegmentText = filenameSegments[0];
        var currentSegmentWidth = getTextPixelWidth(currentSegmentText);
        var spaceWidth = getTextPixelWidth(" ");
        while(segEnd < filenameSegments.length && (currentSegmentWidth + spaceWidth)  < (maxlength - 5)){
            //When it is not the last segment && can still fit more segment into current line
            currentSegmentText = currentSegmentText + " " + filenameSegments[segEnd];
            currentSegmentWidth = getTextPixelWidth(currentSegmentText);
            segEnd++;
        }
        //Back trace one segment
        segEnd--;

        //Build the filename segmentation
        var line1 = "";
        var line2 = "";
        for (var i = 0; i < segEnd; i++){
            line1 += filenameSegments[i] + " ";
        }
        for (var i = segEnd; i < filenameSegments.length; i++){
            line2 += filenameSegments[i] + " ";
        }

        line1 = line1.trim();
        line2 = line2.trim();
        if (line1 != "" && line1 != ""){
            shortenedName = line1 + `<br>` + line2;
        }else if (line1 == ""){
            shortenedName = line2;
        }else if (line2 == ""){
            shortenedName = line1;
        }
    }

    var compressedFiledata = ao_module_utils.objectToAttr(filedata);
    if (updateMode){
        //Update the content that already exists for the same filepath object
        var updateObject = undefined;
        $(".launchIcon").each(function(){
            if ($(this).attr("filedata") == compressedFiledata){
                updateObject = $(this);
            }
        });

        if (updateObject !== undefined){
            //Check if content identical. If yes, skip rewrite
            if (updateObject.attr("filedata") == compressedFiledata){
                //Identical. Skipping
            }else{
                //Update its contents
                updateObject.attr("type", type);
                updateObject.attr("filename", filename);
                updateObject.attr("filepath", filepath);
                updateObject.attr("filedata", compressedFiledata);
                updateObject.css("width", iwidth + "px");
                updateObject.css("height", iheight + "px");
                updateObject.css("left", screenX + "px");
                updateObject.css("top", screenY + "px");
            }
        }else{
            //No exists. Append to wrapper
            appendDesktopIcon($("#iconwrapper"),{
                type: type,
                filename: filename,
                filepath: filepath,
                compressedFiledata: compressedFiledata,
                iwidth: iwidth,
                iheight: iheight,
                screenX: screenX,
                screenY: screenY,
                size: size,
                imagePath: imagePath,
                shortenedName: shortenedName,
                isShared: isShared,
            });
        }

    }else{
        //Append into the desktop
        appendDesktopIcon($("#iconwrapper"),{
            type: type,
            filename: filename,
            filepath: filepath,
            compressedFiledata: compressedFiledata,
            iwidth: iwidth,
            iheight: iheight,
            screenX: screenX,
            screenY: screenY,
            size: size,
            imagePath: imagePath,
            shortenedName: shortenedName,
            isShared: isShared,
        });
    }

}

/*
    Main function to append desktop icon to desktop
    Usage: Pass in the target (as jquery object, usually $("#iconwrapper")) and properties with the following object
    properties = {
        type: "",
        filename: "",
        filepath: "",
        compressedFiledata: "",
        iwidth: "",
        iheight: "",
        screenX: "",
        screenY: "",
        size: "",
        imagePath: "",
        shortenedName: "",
    }

    Where the enmty string is the value that require filling in
*/

function appendDesktopIcon(target, properties){
    var htmlType = "div";
    if (properties.type == "file" && isChrome){
        htmlType = "a";
    }

    var imageStyleOverride = "";
    //Special type of override for files
    if (properties.type == "shortcut"){
        var fd = JSON.parse(decodeURIComponent(properties.compressedFiledata));
        //Pad raw site favicons only. Icons made in the shortcut editor
        //(crops, presets) are already drawn at desktop icon size.
        if (fd.ShortcutType == "url" && /^https?:\/\//i.test(fd.ShortcutImage || "")){
            imageStyleOverride = `padding: 8px;`;
        }
    }

    var iconTextReadjustment = "";
    if (isChrome){
        iconTextReadjustment = "font-size: 92%;"
    }

    var thisIcon = $(`<${htmlType} href="javascript:void(0);" class="launchIcon" 
            type="${properties.type}" 
            draggable="true" 
            ondragover="allowDrop(event)" 
            ondrop="drop(event)" 
            ondragstart="drag(event)" 
            onmousedown="iconClicked(this,event);" 
            ondblclick="iconDoubleClicked(this,event);" 
            ontouchstart="iconClicked(this,event); doubleTouchHandler(this, event,openViaTouch);"
            filename="${properties.filename}" 
            filepath="${properties.filepath}" 
            filedata="${properties.compressedFiledata}" 
            style="width:${properties.iwidth}px; height:${properties.iheight}px;left:${properties.screenX}px; top:${properties.screenY}px;">
            <span class="launchIconWrapper">
                <img class="launchIconImage ${properties.size}" src="${properties.imagePath}" style="${imageStyleOverride}" draggable="false"></img>
                <p class="launchIconText ${properties.size}" style="${iconTextReadjustment}">${properties.shortenedName}</p>
            </span>
            </${htmlType}>`);

    $(target).append(thisIcon);

    //Updates 20 May 2021: Check if this file is shared. If yes, append the share icon
    if (typeof(properties.isShared) != "undefined" && properties.isShared == true){
        setFileShareIndicator(properties.filename);
    }

    if (properties.type == "file" && isChrome){
        console.log(isChrome);
        let thisFilepath = properties.filepath;
        $(thisIcon)[0].addEventListener("dragstart",function(evt){
        //var filecontent = toDataUrl("media/?file=" + thisFilepath);
        //var fileBase64 = window.btoa(filecontent);
        var targetMime = "plain/text";
            $.ajax({
                url: "media/getMime/?file=" + encodeURIComponent(properties.filepath),
                success: function(data){
                    if (data.error !== undefined){
                        targetMime = "text/directory";
                    }else{
                        targetMime = data;
                    }
                },
                async: false
            });
        evt.dataTransfer.setData("DownloadURL",targetMime+":"+ properties.filename +":"+ location.protocol + "//" + location.hostname + ":" + location.port + "/media/?file=" + encodeURIComponent(properties.filepath));
        //evt.dataTransfer.setData("DownloadURL","video/mp4"+":"+"test.mp4"+":"+"data:"+"video/mp4"+";base64,"+fileBase64);
        },false);
    }
}

//Folder description box
var timeoutId;
function attachDescriptionBoxEvents(){
    $(".launchIcon").off("hover").hover(function(event) {
        let modulePath = $(this).attr("filepath");
        let filename = $(this).attr("filename");
        let filedata = JSON.parse( decodeURIComponent($(this).attr("filedata")));

        if (!timeoutId) {
            if (renameMode == true){
                //Renaming. Do not show hover info tab
                return;
            }
            timeoutId = window.setTimeout(function() {
                let position = [currentMousePosition[0] + 10, currentMousePosition[1] + 10];
                timeoutId = null;
                console.log(filedata, position);
                $('#fileDescriptor').css('left',position[0] + "px");
                $('#fileDescriptor').css('top',position[1] + "px");
                if (filedata.IsShortcut){
                    $('#fileDescriptor').html(`<p><i class="linkify icon"></i> ${filedata.ShortcutName}<br><i class="folder icon"></i> ${filedata.ShortcutPath}</p>`);
                    $('#fileDescriptor').show();
                }else{
                    $.ajax({
                        url: "system/file_system/getProperties",
                        data: {path: filedata.Filepath},
                        success: function(data){
                            $('#fileDescriptor').html(`<p>${filedata.Filename}<br><i class="file outline icon"></i> ${formatBytes(data.Filesize)} (${data.MimeType})<br><i class="time icon"></i> ${data.LastModTime}</p>`);
                            if (!(data.MimeType == undefined)){
                                $('#fileDescriptor').show();
                            }

                        }
                    })

                }


            }, 1500);
        }
    },
    function () {
        if (timeoutId) {
            window.clearTimeout(timeoutId);
            timeoutId = null;
        }else {
            $('#fileDescriptor').hide();
        }
    });
}

/*
    Share indicator settings
    This append or remove share from a particular file

    Only require filename as all files here are on desktop
*/

function getFileObjectByFilename(filename){
    var result = null;
    $(".launchIcon").each(function(){
        var thisFilename = $(this).attr("filename");
        if (thisFilename == filename){
            result = $(this);
        }
    });

    return result;
}

function setFileShareIndicator(filename){
    var targetFileObject = getFileObjectByFilename(filename);
    if (targetFileObject == null){
        return;
    }
    var sharedIcon = `<div class="fileShareIndicator ${desktopIconSize}">
        <img src="img/desktop/system_icon/shared.png">
    </div>`;

    $(targetFileObject).find(".launchIconWrapper").append(sharedIcon);

}

function removeFileShareIndicator(filename){
    var targetFileObject = getFileObjectByFilename(filename);
    if (targetFileObject == null){
        return;
    }

    var indicator = $(targetFileObject).find(".fileShareIndicator");
    if (indicator.length > 0){
        indicator.remove();
    }
}

$(window).on("resize", function(event) {
    redrawDesktopGrids();
    resizeAllFloatWindowButtons();
})


function refresh(callback = undefined, noflash=false) {
    //Refresh desktop contents
    let launchOption = {};
    if (noflash){
        launchOption = {
            noflash: true
        };
    }

    if (callback == undefined) {
        initDesktopFiles(launchOption, function(){
            startThumbnailLoader();
            attachDescriptionBoxEvents();
        });
    } else {
        initDesktopFiles(launchOption, function(){
            startThumbnailLoader();
            attachDescriptionBoxEvents();
            callback()
        });
    }

    hideAllContextMenus();
}

function startThumbnailLoader(){
    let path = "user:/Desktop";
    let protocol = "wss://";
    if (location.protocol !== 'https:') {
        protocol = "ws://";
    }

    var port = window.location.port;
    if (window.location.port == ""){
        if (location.protocol !== 'https:') {
            port = "80";
        }else{
            port = "443";
        }
    }

    thumbRenderWebSocket = new WebSocket(protocol + window.location.hostname + ":" + port + "/system/file_system/handleCacheRender?folder=" + path);

    thumbRenderWebSocket.onopen = function(e) {

    };

    thumbRenderWebSocket.onmessage = function(event) {
        //Find the correct file in the current directory and place its image
        let thumbData = JSON.parse(event.data);
        $(".launchIcon").each(function(){
            if (thumbData[1].length > 0){
                if ($(this).attr("filename") == thumbData[0]){
                    let imageContainer = $(this).find(".launchIconImage");
                    imageContainer.attr("src","data:image/jpg;base64," + thumbData[1]);
                    imageContainer.css("padding", "0.6em");

                    //Load the application icon on this file
                    let filedata = $(this).attr("filedata");
                    if (filedata == undefined){
                        return;
                    }
                    filedata = JSON.parse(decodeURIComponent(filedata));
                    $.ajax({
                        url: "system/modules/getDefault",
                        data: {opr: "launch", ext: filedata.Ext},
                        method: "GET",
                        success: function(data){
                            if (data.error == undefined){
                                let iconSize = 20;
                                let topOffset = $(imageContainer).height() - iconSize/2 + 2;
                                $(imageContainer).parent().append(`<img src="${data.IconPath}" style="position: absolute; right: 0px; top: ${topOffset}px; width: ${iconSize}px; height: ${iconSize}px; pointer-events:none;"></img>`);
                            }
                        }
                    });
                }
            }
        });
    };

    thumbRenderWebSocket.onclose = function(event) {
        //Transfer ended
    };

    thumbRenderWebSocket.onerror = function(error) {
        console.log("Cannot connect to WebSocket cache renderer. Falling back to AJAX request");
        startFallbackThumbnailLoader();
    };
}

function startFallbackThumbnailLoader(){
        $(".launchIcon").each(function(){
            let fd = JSON.parse(decodeURIComponent($(this).attr("filedata"))) 
            let filepath = fd.Filepath;
            let targetDOM = $(this);
            $.ajax({
                url: "system/file_system/loadThumbnail",
                data: {vpath: filepath},
                success: function(data){
                    if (data.error == undefined && data != undefined && data != ""){
                        let imageContainer = $(targetDOM).find(".launchIconImage");
                        imageContainer.attr("src","data:image/jpg;base64," + data);
                        imageContainer.css("padding", "0.6em"); 

                        $.ajax({
                            url: "system/modules/getDefault",
                            data: {opr: "launch", ext: fd.Ext},
                            method: "GET",
                            success: function(data){
                                if (data.error == undefined){
                                    let iconSize = 20;
                                    let topOffset = $(imageContainer).height() - iconSize/2 + 2;
                                    $(imageContainer).parent().append(`<img src="${data.IconPath}" style="position: absolute; right: 0px; top: ${topOffset}px; width: ${iconSize}px; height: ${iconSize}px; pointer-events:none;"></img>`);
                                }
                            }
                        });
                    }      
                }
            })
        });
    }

/*
    Background services for keeping desktop files updated

    Same mechanism is used as file explorer
*/
let desktopFileHash = "";
setInterval(function(){
    getDesktopHash(function(hash){
        if (desktopFileHash == ""){
            //Initialization
            desktopFileHash = hash;
        }else if (desktopFileHash != hash){
            //Changed on desktop files. Refresh
            refresh(undefined, true);
            desktopFileHash = hash;
        }

        //Else, no file change on desktop
    });
}, 15000);

function getDesktopHash(callback){
    $.ajax({
        url: "system/file_system/listDirHash",
        data: {dir: "user:/Desktop/"},
        success: function(data){
            if (data.error !== undefined){

            }
            callback(data);
        }
    })
}
