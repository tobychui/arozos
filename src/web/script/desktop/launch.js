/*
    ArozOS Desktop - Launching modules, files and shortcuts

    Opening modules (openModule), files with a module, desktop icons,
    folders, URL and container app shortcuts, the File Manager and System
    Settings, plus the read only account check.

    Part of desktop.html, see README.md in this folder for the load order.
*/

//Module names that are now a place in the File Manager. Desktop shortcuts
//made for the old Trash Bin app still name it.
var LEGACY_MODULE_FOLDERS = {
    "Trash Bin": "%trashbin%"
};

function openModule(moduleName, callback=undefined) {
    if (LEGACY_MODULE_FOLDERS[moduleName] !== undefined) {
        openFolder(LEGACY_MODULE_FOLDERS[moduleName]);
        if (callback !== undefined){
            callback();
        }
        hideListMenu();
        return;
    }
    $.get("system/modules/getLaunchPara?module=" + moduleName, function(data) {
        if (data.error !== undefined) {
            //Something went wrong.
            console.log("Unable to open module " + moduleName);
            if (data.error == "Not logged in."){
                //Session expired
                window.location.href = "login.html";
            }
        } else {
            //Launch the given module
            var url = data["StartDir"];
            var size = [undefined, undefined];
            var icon = "img/system/favicon.png";
            if (data["IconPath"] != "") {
                icon = data["IconPath"];
            }
            var title = data["Name"];
            //Check if the module support fw mode. If yes, launch with fwmode url. IF not, launch to index
            if (data["SupportFW"] == true) {
                console.log(data["LaunchFWDir"]);
                if (data["LaunchFWDir"] != null && data["LaunchFWDir"] != "") {
                    url = data["LaunchFWDir"];
                }

                if (data["InitFWSize"] != null) {
                    size = data["InitFWSize"];
                }
            }

            //Launch the given module
            var uuid = newFloatWindow({
                url: url,
                width: size[0],
                height: size[1],
                appicon: icon,
                title: title
            });

            if (callback !== undefined){
                callback();
            }
            hideListMenu();
        }
    });
}

function openViaTouch(object, event){
    iconDoubleClicked(object,event);
}

function openFileWithModule(moduleLaunchInfo, openFileList) {
    var url = moduleLaunchInfo["StartDir"];
    var size = [undefined, undefined];
    var title = moduleLaunchInfo["Name"];
    var icon = "img/system/favicon.png";
    if (moduleLaunchInfo["IconPath"] != "") {
        icon = moduleLaunchInfo["IconPath"];
    }
    //Use floatWindow if exists
    if (moduleLaunchInfo["SupportFW"] == true && moduleLaunchInfo["LaunchFWDir"] != "") {
        url = moduleLaunchInfo["LaunchFWDir"];
        if (moduleLaunchInfo["InitFWSize"] !== null) {
            size = moduleLaunchInfo["InitFWSize"]
        }
    }
    //Use embedded mode if exists
    if (moduleLaunchInfo["SupportEmb"] == true && moduleLaunchInfo["LaunchEmb"] != "") {
        url = moduleLaunchInfo["LaunchEmb"];
        if (moduleLaunchInfo["InitEmbSize"] !== null) {
            size = moduleLaunchInfo["InitEmbSize"]
        }
    }

    var openParamter = encodeURIComponent(JSON.stringify(openFileList));

    //Add launch files info and launch floatWindow
    parent.newFloatWindow({
        url: url + "#" + openParamter,
        width: size[0],
        height: size[1],
        appicon: icon,
        title: title
    });
}

function getModuleFromShortcutInfo(shortcutInfo) {
    var ShortcutPath = shortcutInfo["ShortcutPath"];
    if (ShortcutPath.includes("/") == false) {
        //Legacy defination. Append /index.html at the back.
        ShortcutPath = ShortcutPath + "/index.html";
    }

    //Try to match it with the module installed
    for (var i = 0; i < moduleInstalled.length; i++) {
        if (moduleInstalled[i]["StartDir"] == ShortcutPath || moduleInstalled[i]["Name"] == shortcutInfo["ShortcutName"]) {
            //This is the correct module to be loaded
            return moduleInstalled[i];
        }
    }
}

function iconDoubleClicked(object, evt=undefined) {
    //Don't allow opening when renaming
    if (renameMode){
        return;
    }
    //Double click on a launch icon, tries to open it
    var filedata = ao_module_utils.attrToObject($(object).attr("filedata"));
    //console.log(filedata);
    if (filedata.IsDir) {
        //This is a directory. Open with file explorer
        newFloatWindow({
            url: "SystemAO/file_system/file_explorer.html#" + encodeURIComponent(filedata.Filepath),
            appicon: "SystemAO/file_system/img/small_icon.png",
            width: 1080,
            height: 580,
            title: "File Manager"
        });
    } else if (filedata.IsShortcut) {
        //This is a shortcut. Open the target endpoint
        var stype = filedata["ShortcutType"];
        if (stype == "module") {
            //Open the target module
            openModule(filedata.ShortcutPath);
        } else if (stype == "folder") {
            //Open the target folder
            openFolder(filedata.ShortcutPath)
        }else if (stype == "url"){
            openURLShortcut(filedata);
        }else if (stype == "app"){
            openContainerAppShortcut(filedata);
        }else{
            console.log(filedata);
        }
    } else {
        //This is a file. Open it with default opener
        $.ajax({
            url: "system/modules/getDefault",
            method: "GET",
            data: {
                opr: "launch",
                ext: filedata.Ext,
                mode: "launch"
            },
            success: function(data) {
                if (data.error !== undefined) {
                    //No default opener assigned 
                    var url = "SystemAO/file_system/defaultOpener.html";
                    var icon = "SystemAO/file_system/img/opener.png";
                    var title = "Select an opener WebApp: "
                    var openFileList = [];
                    var openFileObject = {
                        filepath: filedata.Filepath,
                        filename: filedata.Filename
                    }
                    openFileList.push(openFileObject);
                    var openParamter = encodeURIComponent(JSON.stringify(openFileObject));
                    newFloatWindow({
                        url: url + "#" + openParamter,
                        width: 380,
                        height: 560,
                        appicon: icon,
                        title: title
                    });
                } else {
                    //Assigned. Launch with given paramter
                    var url = data["StartDir"];
                    var size = [undefined, undefined];
                    var title = data["Name"];
                    var icon = "img/system/favicon.png";
                    if (data["IconPath"] != "") {
                        icon = data["IconPath"];
                    }
                    //Use floatWindow if exists
                    if (data["SupportFW"] == true && data["LaunchFWDir"] != "") {
                        url = data["LaunchFWDir"];
                        if (data["InitFWSize"] !== null) {
                            size = data["InitFWSize"]
                        }
                    }
                    //Use embedded mode if exists
                    if (data["SupportEmb"] == true && data["LaunchEmb"] != "") {
                        url = data["LaunchEmb"];
                        if (data["InitEmbSize"] !== null) {
                            size = data["InitEmbSize"]
                        }
                    }

                    //Build open File Hash Data Format
                    var openFileList = [];
                    var openFileObject = {
                        filepath: filedata.Filepath,
                        filename: filedata.Filename
                    }
                    openFileList.push(openFileObject);
                    var openParamter = encodeURIComponent(JSON.stringify(openFileList));

                    //Add launch files info and launch floatWindow
                    newFloatWindow({
                        url: url + "#" + openParamter,
                        width: size[0],
                        height: size[1],
                        appicon: icon,
                        title: title
                    });
                }
            }
        })
    }
}

function openFolder(virtualPath){
    newFloatWindow({
        url: "SystemAO/file_system/file_explorer.html#" + encodeURIComponent(virtualPath),
        appicon: "SystemAO/file_system/img/small_icon.png",
        width:1080,
        height:580,
        title: "File Manager"
    });
}

//Open a url shortcut using the launch options stored in the shortcut file
function openURLShortcut(fd){
    if (fd.ShortcutOpenIn == "tab"){
        window.open(fd.ShortcutPath);
        return;
    }
    var config = {
        url: fd.ShortcutPath,
        appicon: fd.ShortcutImage,
        title: (fd.ShortcutTitle != undefined && fd.ShortcutTitle != "") ? fd.ShortcutTitle : fd.ShortcutName,
        parent: fd.ShortcutPath
    };
    if (fd.ShortcutWidth > 0){
        config.width = fd.ShortcutWidth;
    }
    if (fd.ShortcutHeight > 0){
        config.height = fd.ShortcutHeight;
    }
    newFloatWindow(config);
}

//Open a container app shortcut. How it opens (window or tab, size) is
//decided by an administrator, so it is looked up on every launch
function openContainerAppShortcut(fd, forceNewTab){
    $.get("system/appproxy/launch?slug=" + encodeURIComponent(fd.ShortcutPath), function(app){
        if (app.error !== undefined){
            showNotificationToast(fd.ShortcutName, app.error, "medium");
            return;
        }
        if (forceNewTab || app.OpenIn == "tab"){
            window.open(app.URL);
            return;
        }
        var config = {
            url: app.URL,
            appicon: fd.ShortcutImage || app.Icon,
            title: app.Name,
            parent: "app:" + app.Slug,
            focuscover: true
        };
        if (app.Width > 0){
            config.width = app.Width;
        }
        if (app.Height > 0){
            config.height = app.Height;
        }
        newFloatWindow(config);
    });
}

function getModuleInfoFromName(moduleName){
    for (var i = 0; i < moduleInstalled.length; i++){
        if (moduleInstalled[i].Name == moduleName){
            return moduleInstalled[i];
        }
    }

    return false
}


function openfm() {
    //Open file explorer on desktop
    newFloatWindow({
        url: "SystemAO/file_system/file_explorer.html#" + encodeURIComponent("user:/Desktop"),
        appicon: "SystemAO/file_system/img/small_icon.png",
        width: 1080,
        height: 580,
        title: "File Manager"
    });
    hideAllContextMenus();
}

function showSystemSettings(){
    var hasAccessToSetting = false;
    moduleInstalled.forEach(thismod => {
        if (thismod.Name == "System Setting"){
            openModule("System Setting");
        }
    })
}

function checkFileSystemAccess(){
    var allowReadWrite = false;
    moduleInstalled.forEach(thisModule => {
        if (thisModule.Name == "File Manager"){
            //This user has read write access to file system
            allowReadWrite = true;
        }
    });

    if (!allowReadWrite){
        sendNotification(applocale.getString("error/connlost/readonly", "READ ONLY Account"), applocale.getString("error/connlost/readonl/infoy", "This account is read only. You cannot perform any file operations on this desktop."));
    }
}
