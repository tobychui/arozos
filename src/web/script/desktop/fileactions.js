/*
    ArozOS Desktop - File actions

    The actions behind the desktop context menu: open, open with, download,
    zip, properties, new folder / file / shortcut, rename, delete and the
    copy / cut / paste clipboard.

    Part of desktop.html, see README.md in this folder for the load order.
*/

function newshortcut(){
    //Show the new shortcut creation tool
    newFloatWindow({
        url: "SystemAO/desktop/shortcutCreator.html",
        appicon: "img/desktop/system_icon/shortcut.png",
        width:815,
        height:485,
        title: "New Shortcut"
    });
    hideAllContextMenus();
}

function openIconViaMenu(target, event){
    $(".launchIconWrapper.selected").each(function(){
        iconObject = $(this).parent();
        //Emulate a doubleclick on icon
        iconDoubleClicked(iconObject, event);
    });
    hideAllContextMenus();
}

//Opening a shortcut module from desktop to new tab
function openWebAppInNewTab(target, event){
    $(".launchIconWrapper.selected").each(function(){
        var fd = JSON.parse(decodeURIComponent($(this).parent().attr("filedata")));
        $.get("system/modules/getLaunchPara?module=" + fd.ShortcutPath, function(data) {
            if (data.error !== undefined) {
                console.log(data.error);
            }else{
                //Open in new tab
                window.open(data.StartDir)
            }
        });
    });

    hideAllContextMenus();
}

//Edit the name, target, icon and launch options of the selected shortcut
function openShortcutEditor(target, event){
    var selected = $(".launchIconWrapper.selected").first();
    if (selected.length == 0){
        hideAllContextMenus();
        return;
    }
    var fd = JSON.parse(decodeURIComponent(selected.parent().attr("filedata")));
    //Standard input file list, read back with ao_module_loadInputFiles()
    var inputFiles = encodeURIComponent(JSON.stringify([{filepath: fd.Filepath, filename: fd.Filename}]));
    newFloatWindow({
        url: "SystemAO/desktop/shortcutEditor.html#" + inputFiles,
        appicon: "img/desktop/system_icon/shortcut.png",
        width: 400,
        height: 560,
        title: "Edit Shortcut"
    });
    hideAllContextMenus();
}

function openURLShortcutInNewTab(target, event){
    $(".launchIconWrapper.selected").each(function(){
        var fd = JSON.parse(decodeURIComponent($(this).parent().attr("filedata")));
        if (fd.ShortcutType == "url" && fd.ShortcutPath) {
            window.open(fd.ShortcutPath);
        }else if (fd.ShortcutType == "app" && fd.ShortcutPath) {
            openContainerAppShortcut(fd, true);
        }
    });

    hideAllContextMenus();
}

function downloadFile(target, event){
    if ( $(".launchIconWrapper.selected").length == 1){
        //Download this file directly
        var rawfiledata = $(".launchIconWrapper.selected").parent().attr("filedata");
        var filedata = JSON.parse(decodeURIComponent(rawfiledata));
        var filepath = filedata.Filepath;
        //Resolve the link to media download link
        var downloadLink = "media/download?file=" + filepath;
        window.open(downloadLink)

    }else if ($(".launchIconWrapper.selected").length > 1){
        //Create a zip file using the fs api
        var filelist = [];
        $(".launchIconWrapper.selected").each(function(){
            var filedata = JSON.parse(decodeURIComponent($(this).parent().attr("filedata")));
            var filepath = filedata.Filepath;
            filelist.push(filepath);
        });

        $.ajax({
            url: "system/file_system/zipHandler",
            data: {opr: "tmpzip", src: JSON.stringify(filelist), dest: ""},
            method: "POST",
            success: function(data){
                if (data.error !== undefined){
                    alert(data.error);
                }else{
                    //Zip completed.
                    window.open("media/download?file=" + data);
                }
            }
        });
    }

    hideAllContextMenus();
}

function handleZipFolder(){
    var filelist = [];
    var filename = "desktop_" + new Date().getTime() + ".zip"
    if ($(".launchIconWrapper.selected").length == 1){
        filename = $(".launchIconWrapper.selected").parent().attr('filename') + ".zip";
    }

    $(".launchIconWrapper.selected").each(function(){
        var filedata = JSON.parse(decodeURIComponent($(this).parent().attr("filedata")));
        var filepath = filedata.Filepath;
        if (filedata.IsDir == true){
            filelist.push(filepath);
        }
    });
    $.ajax({
            url: "system/file_system/zipHandler",
            data: {opr: "zip", src: JSON.stringify(filelist), dest: "user:/Desktop/" + filename},
            method: "POST",
            success: function(data){
                if (data.error !== undefined){
                    alert(data.error);
                }else{
                    //Zip completed.
                    console.log(data);
                }
            }
        });
    //console.log(filelist);
    hideAllContextMenus();
}

function handleOpenWith(target, event){
    $("#subcontextmenu").html("");
    //Updates 19 May 2021: Added support for better parsing Open With List
    var exts = [];
    //Get all exts from the selected files
    $(".launchIconWrapper.selected").each(function(){
        var filename = $(this).parent().attr("filename");
        var ext = "." + filename.split(".").pop();
        exts.push(ext);
    });

    $.get("system/modules/list",function(data){
        if (data.error !== undefined){
            alert(data.error);
        }else{
            var supportedModuleCount = 0;
            var openWithTargets = [];
            for (var i =0; i < data.length; i++){
                var thisModule = data[i];

                //If this module support this ext, add it to list
                var thisModuleSupportExt = thisModule.SupportedExt;
                if (thisModule.Name == "File Manager"){
                    //Exceptional case
                    addContextMenuItem($("#subcontextmenu"), escapeNotificationText(thisModule.Name), undefined, "openSelectedWith", false, {image: thisModule.IconPath || "img/system/service.png"});
                }
                if (thisModuleSupportExt == null || thisModuleSupportExt.length == 0){
                    //Not supporting anything
                    continue;
                }
                thisModuleSupportExt.forEach(supportedExt => {
                    if (exts.includes(supportedExt)){
                        //Add this to the menu
                        addContextMenuItem($("#subcontextmenu"), escapeNotificationText(thisModule.Name), undefined, "openSelectedWith", false, {image: thisModule.IconPath || "img/system/service.png"});
                    }
                })


                //if (thisModule.SupportEmb == true){
                //    addContextMenuItem($("#subcontextmenu"), thisModule.Name, "", "openSelectedWith", false);
                //}
            }

            //Add select more opener option
            addContextMenuSeperator($("#subcontextmenu"));
            addContextMenuItem($("#subcontextmenu"), lcontex("Select Other WebApps"), undefined, "openOpenSelector", false);
        }
        showSubContextMenu(target);
    });
}

function openObjectProperty(target, object){
   var filelist = [];
   $(".launchIconWrapper.selected").each(function(){
       var filepath = $(this).parent().attr("filepath");
       filelist.push(filepath);
   });

   var hashPassthrough = encodeURIComponent(JSON.stringify(filelist));
    newFloatWindow({
        url: "SystemAO/file_system/file_properties.html#" + hashPassthrough,
        width: 440,
        height: 560,
        appicon: "SystemAO/file_system/img/properties.png",
        title: "File Properties",
    });

    hideAllContextMenus();
}

//Open the file extension selector
function openOpenSelector(target, event){
    var filedata = $($(".launchIconWrapper.selected")[0]).parent().attr("filedata")
    filedata = JSON.parse(decodeURIComponent(filedata));

    var fileDescriptor = {
        filepath: filedata.Filepath,
        filename: filedata.Filename
    }

    newFloatWindow({
        url: "SystemAO/file_system/defaultOpener.html#" + encodeURIComponent(JSON.stringify(fileDescriptor)),
        width: 380,
        height: 560,
        appicon: "SystemAO/file_system/img/opener.png",
        title: "Select WebApp to Open File",
    });

    hideAllContextMenus();
}

function openSelectedWith(target, event){
    var targetModulename = $(target).text().trim();
    var openFileList = [];
    $(".selected.launchIconWrapper").each(function(){
        var thisFiledata = JSON.parse(decodeURIComponent($(this).parent().attr("filedata")));
       openFileList.push({
           filename: thisFiledata.Filename,
           filepath: thisFiledata.Filepath
       });
    });

    //Find the launch info of the module
    var targetModuleInfo = undefined;
    for (var i =0; i < moduleInstalled.length; i++){
        if (moduleInstalled[i].Name == targetModulename){
            targetModuleInfo = JSON.parse(JSON.stringify(moduleInstalled[i]));
        }
    }

   //Open the files with the given module
    openFileWithModule(targetModuleInfo, openFileList);
    hideAllContextMenus();
}

//New folder on the menu start location
function newfolder(object, event) {
    var closestLocation = findClosestGrid(menuStartLocation[0], menuStartLocation[1], false);
    let closestPixelLocation = closestLocation[0];
    let closestGridIndexLocation = closestLocation[1];
    //Generate new foldername
    var newFolderName = "New Folder";
    var counter = 1;
    while (desktopFileList.includes(newFolderName)) {
        newFolderName = `New Folder(${counter})`;
        counter++;
    }

    //Check if there are already another object at that locaton
    var duplicateObject = getObjectFromLocation(closestPixelLocation[0], closestPixelLocation[1]);
    var createObjectLocation = true;
    if (duplicateObject !== undefined) {
        //Ignore create position. Let it settle on next new slot.
        createObjectLocation = false;
    }

    //Create the folder
    requestCSRFToken(function(token){
        $.post("system/file_system/newItem", {
            type: "folder",
            src: "user:/Desktop/",
            filename: newFolderName,
            csrft: token
        }).done(function(data) {
            if (data.error !== undefined) {
                alert(data.error);
            } else {
                if (createObjectLocation) {
                    setIconDesktopLocation(newFolderName, closestGridIndexLocation[0], closestGridIndexLocation[1], function() {
                        //After set Desktop icon, refresh the page 
                        refresh(function() {
                            //After refresh the page, highlight the new folder and set it to rename mode
                            var targetFolderObject = getObjectFromGridLocation(closestGridIndexLocation[0], closestGridIndexLocation[1]);
                            console.log(targetFolderObject);
                            enableRenameOnLaunchIconObject(targetFolderObject);
                        });
                    });
                }
            }
        });
    });

    hideAllContextMenus();
}

function enableRenameOnLaunchIconObject(object) {
    renameMode = true;
    $(".launchIcon").attr("draggable", "false");
    var filedata = JSON.parse(decodeURIComponent($(object).attr("filedata")));
    var originalName = filedata.Filename;
    if (filedata.IsShortcut){
        //Shortcut. Use its display name instead
        originalName = filedata.ShortcutName;
    }
    $(object).find(".launchIconText").hide();
    $(object).append(`<textarea class="renameInput ${desktopIconSize}" type="text" onkeydown="handleRenameKeydown(event);" ondragstart="return false;" dblclick="event.stopImmediatePropagation(); event.stopImmediatePropagation();"maxlength="32">${originalName}</textarea>`);
    $(object).find(".renameInput")[0].select();
    var index = originalName.lastIndexOf(".");
    console.log(index);
    if( index >= 0){
        $(object).find(".renameInput")[0].setSelectionRange(0, index);
    }

    //Updates 4-5-2021: Added IME support on rename input
    $(object).find(".renameInput")[0].addEventListener("keydown", function(event){
        if (window.ime && window.ime.handler != null){
            window.ime.handler(event);
        }else{
            //No IME handler. Just continue the input
        }
    });
    window.ime.focus = $(object).find(".renameInput")[0];
}

//Handle enter keypress on the rename textarea
//Set when Enter ends a rename, so its keyup does not open the selected icons (input.js)
var renameEndedByEnter = false;
function handleRenameKeydown(e){
    if (e.keyCode == 13){
        //Enter pressed
        e.preventDefault();
        renameEndedByEnter = true;
        exitRenameMode();
    }
}

function exitRenameMode() {
    if (renameMode) {
        $(".launchIcon").attr("draggable", "true");
        $(".launchIcon").find(".launchIconText").show();

        //Update the folder to textarea content
        $(".renameInput").each(function() {
            if ($(this).val() == "") {
                //Ignore this update
                refresh(function() {
                    //Refresh the desktop
                });                   
                return;
            } else {
                var filedata = JSON.parse(decodeURIComponent($(this).parent().attr("filedata")));
                var filepath = filedata.Filepath;
                var newFilename = $(this).val();

                if (filedata.IsShortcut == true){
                    //Shortcut. Edit the shortcut content name
                    let currentInputTextArea = $(this);
                    $.ajax({
                        url: "/system/desktop/opr/renameShortcut",
                        data: {src: filepath, new: newFilename},
                        success: function(data){
                            if (data.error !== undefined){
                                //Cancel the operation
                                console.log("*ERROR* " + data.error);
                                currentInputTextArea.remove();
                            }else{
                                //No need to update the shortcut position (as its name not changed)
                                refresh(function() {
                                    //Refresh the desktop
                                });
                            }
                        }
                    })
                }else{
                    //Normal typed files / folder. Rename the object
                    let currentInputTextArea = $(this);

                    //Check if new filename is identaical to the old filename
                    var originalFilename = $(this).parent().attr("filename");
                    console.log("Launch Icon object", $(this).parent());

                    if (newFilename == originalFilename){
                        //Filename has no changes
                        currentInputTextArea.remove();
                        return;
                    }
                    generateCSRFToken(function(csrftoken){
                        $.ajax({
                            url: "./system/file_system/fileOpr",
                            method: "POST",
                            data: {opr: "rename", src: JSON.stringify([filepath]), new: JSON.stringify([newFilename]), csrft: csrftoken},
                            success: function(data){
                                if (data.error !== undefined){
                                    //Cancel the operation
                                    alert(data.error);
                                    console.log("*ERROR* " + data.error);
                                    currentInputTextArea.remove();
                                }else{
                                    //Update the new file position
                                    let closestLocation = findClosestGrid($(currentInputTextArea).parent().offset().left, $(currentInputTextArea).parent().offset().top);
                                    let closestGridIndexLocation = closestLocation[1];
                                    setIconDesktopLocation(newFilename, closestGridIndexLocation[0], closestGridIndexLocation[1], function(){
                                        //Callback after setting location
                                        refresh(function() {
                                            //Refresh the desktop
                                        });
                                    });
                                }
                            }
                        });
                    });
                }
            }
        });

        renameMode = false;
    }
}

//Handle opening shortcut folder location
function handleShortcutFolderOpen(object, event){
    var openPendingFolders = [];
    $(".launchIconWrapper.selected").each(function(){
        var filedata = JSON.parse(decodeURIComponent($(this).parent().attr("filedata")));
        console.log(filedata);
        if (filedata.IsShortcut == true){
            if (filedata.ShortcutType == "folder"){
                openPendingFolders.push(filedata.ShortcutPath);
            }else if (filedata.ShortcutType == "module"){
                openPendingFolders.push("web:/" + filedata.ShortcutPath);
            }

        }
    });

    //Open all folders
    openPendingFolders.forEach(folder => {
        newFloatWindow({
            url: "SystemAO/file_system/file_explorer.html#" + encodeURIComponent(folder),
            appicon: "SystemAO/file_system/img/small_icon.png",
            width:1080,
            height:580,
            title: "File Manager"
        });
    })

    hideAllContextMenus();
}

//Handle basic desktop file operations
function handleFileDelete(object, event){
    var deleteFileList = [];
    $(".launchIconWrapper.selected").each(function(){
        var filedata = JSON.parse(decodeURIComponent($(this).parent().attr("filedata")));
        deleteFileList.push(filedata.Filepath);
    });
    console.log(deleteFileList);
    generateCSRFToken(function(csrftoken){
        $.ajax({
            url: "system/file_system/fileOpr",
            method:"POST",
            data: {opr: "recycle", src: JSON.stringify(deleteFileList), csrft: csrftoken},
            success: function(data){
                if (data.error !== undefined){
                    alert(data.error);
                }else{
                refresh(undefined, true);
                dockRefreshTrash();
                }
            }
        });
        hideAllContextMenus();
    });

}

//File Rename
let renamingItems = [];
function handleRename(object, event){
    if ($('.launchIconWrapper.selected').length > 0){
        //Enter rename mode
        renamingItems = $('.launchIconWrapper.selected');
        let renameTarget = $('.launchIconWrapper.selected')[0]
        let fileObject = $(renameTarget).parent();
        enableRenameOnLaunchIconObject(fileObject);
    }
    hideAllContextMenus();
}

function handleCopyOperation(){
    var clipboard = [];
    $(".launchIconWrapper.selected").each(function(){
        var object = $(this).parent();
        var fd = JSON.parse(decodeURIComponent($(object).attr("filedata")));
        clipboard.push(fd.Filepath);
    });

    localStorage.setItem("ao/file_system/clipboard",JSON.stringify(clipboard));
    localStorage.setItem("ao/file_system/cutmode","false");
    copyStringToClipboard(JSON.stringify(clipboard));
    hideAllContextMenus();
}

function handleCutOperation(){
    var clipboard = [];
    $(".launchIconWrapper.selected").each(function(){
        var object = $(this).parent();
        var fd = JSON.parse(decodeURIComponent($(object).attr("filedata")));
        clipboard.push(fd.Filepath);
    });

    localStorage.setItem("ao/file_system/clipboard",JSON.stringify(clipboard));
    localStorage.setItem("ao/file_system/cutmode","true");
    copyStringToClipboard(JSON.stringify(clipboard));
    hideAllContextMenus();
}

function checkFileInClipboard(){
    //Check if there are files in clipboard
    var crossFrameClipboard = localStorage.getItem("ao/file_system/clipboard");
    var useCutMode = localStorage.getItem("ao/file_system/cutmode");
    var fileList = [];
    if (crossFrameClipboard !== "" && crossFrameClipboard !== undefined && crossFrameClipboard !== null){
        fileList = JSON.parse(crossFrameClipboard);
    }

    return fileList.length > 0;
}

function handlePasteOperation(){
    //Check if there are files in clipboard
    var crossFrameClipboard = localStorage.getItem("ao/file_system/clipboard");
    var useCutMode = localStorage.getItem("ao/file_system/cutmode");
    var fileList = [];
    if (crossFrameClipboard !== "" && crossFrameClipboard !== undefined && crossFrameClipboard !== null){
        fileList = JSON.parse(crossFrameClipboard);
    }
    if (useCutMode !== "" && useCutMode !== undefined && useCutMode !== null){
        thisOprCutMode = (useCutMode == "true");
    }

    var mode = "copy";
    if (thisOprCutMode){
        mode = "move";
    }

    if (fileList.length > 0){
        //There are something to move. Start the file operation dialog
        startFileOperation({
            opr: mode,
            src: fileList,
            dest: "user:/Desktop/",
            overwriteMode: "ask"
        });
    }
    hideAllContextMenus();
}

//Create new file item with that filename
function newitem(object, event) {
    //The menu row carries the extension as its payload (older rows: an ext attribute)
    var extension = getContextMenuPayload(object) || $(object).find("i").attr("ext");

    //Generate a newfile name
    var newfn = "NewFile" + "." + extension;
    var counter = 1;
    while (desktopFileList.includes(newfn)){
        newfn = "NewFile (" + counter + ")." + extension;
        counter++;
    }

    //Get the location position
    let closestLocation = findClosestGrid(menuStartLocation[0], menuStartLocation[1], false);
    let closestGridIndexLocation = closestLocation[1];

    //Request backend to generate the new file
    generateCSRFToken(function(token){
        $.ajax({
            url: "system/file_system/newItem",
            data: {type: "file",src: "user:/Desktop/",filename: newfn, csrft: token},
            success: function(data){
                if (data.error !== undefined){
                    alert(data.error);
                }else{
                    //Set the icon location
                    setIconDesktopLocation(newfn, closestGridIndexLocation[0], closestGridIndexLocation[1], function(){
                        //Refresh the desktop
                        refresh(function(){
                            var targetNewFile = getObjectFromGridLocation(closestGridIndexLocation[0], closestGridIndexLocation[1]);
                            console.log("Renaming ", targetNewFile);
                            enableRenameOnLaunchIconObject(targetNewFile);
                        });
                    });
                }
            }
        });
    });
    hideAllContextMenus();
}
