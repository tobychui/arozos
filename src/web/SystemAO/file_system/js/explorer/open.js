/*
    open.js

    Opening files and folders with the registered default opener.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

function openViaButton(){
    let fileOpenList = [];
    let foldersToBeOpened=[];
    $(".fileObject.selected").each(function(){
        let type = $(this).attr("type");
        let filepath = $(this).attr("filepath");
        if (type == "file"){
            fileOpenList.push(filepath);
        }else if (type == "folder"){
            foldersToBeOpened.push(filepath);
        }
    });
    //Open files
    openPathWithDefaultOpener(fileOpenList);

    //Open folders
    openFolderInNewWindow(foldersToBeOpened);
}

function openthis(object,evt=null, isDoubleClick=false){
    if (evt !== null){
        evt.preventDefault();
    }

    if (isDoubleClick && isMobile && ctrlHold){
        //User is clicking too fast or touch screen is too sensitive! ignore this double click
        return;
    }

    if (renameMode && $(object).find(".renameinput").length > 0){
        //This object is currently under rename. Ignore input
        return;
    }else if (renameMode){
        //Opening another stuffs. Exit renameMode
        exitRenameModeWithConfirm();
    }
    
    var objType = $(object).attr("type");
    if ( objType == "file"){
        //Open this file. Generate the access path from filepath
        var filepath = $(object).attr("filepath");
        //Only one path to be opened. Pass in as a single object array
        openPathWithDefaultOpener([filepath]);
    }else if (objType == "folder"){
        //Open this folder
        var folderPath = $(object).attr('filepath');
        listDirectory(folderPath, function(){
            //Scroll to top of the list
            $("#folderView").stop().finish().animate({
                scrollTop: 0
            }, 300);

            if ($(object).hasClass('dir') && isMobile){
                toggleSidebar();
            }
        });
    }else if (objType == "shortcut"){
        //Load the shortcut information
        
        getShortcutInfo($(object).attr('filepath'), function(shortcutInfo){
            /*
                Shortcut Info format
                0: Shortcut type
                1: Shortcut Name
                2: Shortcut target 
                3: Shortcut icon image
            */
            if (shortcutInfo[0] == "module"){
                //This is a module
                if (ao_module_virtualDesktop){
                    //Open Module with VDI API
                    parent.openModule(shortcutInfo[2]);
                }else{
                    //Open module in new tab
                    $.get("../../system/modules/getLaunchPara?module=" + shortcutInfo[2], function(data) {
                        window.open("../../" + data.StartDir);
                    });
                }
            }else if (shortcutInfo[0] == "folder"){
                //This is a folder
                listDirectory(shortcutInfo[2]);
            }else if (shortcutInfo[0] == "url"){
                //This is a url shortcut
                //Update 2020_02-03: Open with floatWindow instead
                parent.newFloatWindow({
                    url: shortcutInfo[2],
                    appicon: shortcutInfo[3],
                    title: shortcutInfo[1],
                    parent: shortcutInfo[2]
                })
            }
        });
        
        
    }

    //Check if this opened in sidebar and in mobile mode. Close sidebar if yes
    
}

/*
    Shortcut Info format
    0: Shortcut type
    1: Shortcut Name
    2: Shortcut target 
    3: Shortcut icon image
*/
function getShortcutInfo(filepath, callback){
    $.get("../../media?file=" + filepath, function(data){
        //This return the shortcut information. Split it and see what shortcut is this
        data = data.split("\r\n").join("\n");
        var shortcutInfo = data.trim().split("\n");
        callback(shortcutInfo);
    });
}

//Open File Location
function openFileLocation(){
    var folders = [];
    $(".selected.fileObject").each(function(){
        var thisFilepath = $(this).attr('filepath');
        var thisFilename = $(this).attr('filename');
        openPathInNewWindow(encodeURIComponent(JSON.stringify([{
            filename: thisFilename,
            filepath: thisFilepath
        }])))
    });
    
}

//Open the filepaths in the given paramters
function openPathWithDefaultOpener(filepaths){
    function isSafari() {
        return this.window.navigator.userAgent.match(/iP(ad|od|hone)/i)
    }
    console.log("Opening: ", filepaths);
    for (var i =0; i < filepaths.length; i++){
        let filepath = JSON.parse(JSON.stringify(filepaths[i]));
        var ext = "." + filepath.split(".").pop();
        $.ajax({
            url: "../../system/modules/getDefault",
            method: "GET",
            data: {opr: "launch", ext: ext, mode: "launch"},
            success: function(data){
                if (data.error !== undefined){
                    //No default opener assigned. Launch it with opener selector
                    var url = "SystemAO/file_system/defaultOpener.html";
                    var icon = "SystemAO/file_system/img/opener.png";
                    var title = "Select an opener WebApp: "
                    var openFileList = [];
                    var openFileObject = {
                        filepath: filepath,
                        filename: filepath.split("/").pop()
                    }
                    openFileList.push(openFileObject);
                    var openParamter = encodeURIComponent(JSON.stringify(openFileObject));
                    var ao_module_virtualDesktop = !(!parent.isDesktopMode);
                    if (ao_module_virtualDesktop){
                        parent.newFloatWindow({
                            url: url + "#" + openParamter,
                            width: 320,
                            height: 510,
                            appicon: icon,
                            title: title
                        });
                    }else{
                        url = "defaultOpener.html";
                        let openURL = url + "#" + openParamter;
                        if (isSafari()) {
                            const a = document.createElement('a')
                            a.setAttribute('href', openURL)
                            a.setAttribute('target', '_blank')
                            setTimeout(() => a.click())
                        }else{
                            window.open(openURL);
                        }
                    }
                }else{
                    //Assigned. Launch with given paramter
                    var url = data["StartDir"];
                    var size = [undefined, undefined];
                    var title = data["Name"];
                    var icon = "img/system/favicon.png";
                    if (data["IconPath"] != ""){
                        icon = data["IconPath"];
                    }
                    //Use floatWindow if exists
                    if (data["SupportFW"] == true && data["LaunchFWDir"] != ""){
                        url = data["LaunchFWDir"];
                        if (data["InitFWSize"] !== null){
                            size = data["InitFWSize"]
                        }
                    }
                    //Use embedded mode if exists
                    if (data["SupportEmb"] == true && data["LaunchEmb"] != ""){
                        url = data["LaunchEmb"];
                        if (data["InitEmbSize"] !== null){
                            size = data["InitEmbSize"]
                        }
                    }

                    //Build open File Hash Data Format
                    var openFileList = [];
                    var openFileObject = {
                        filepath: filepath,
                        filename: filepath.split("/").pop()
                    }
                    openFileList.push(openFileObject);
                    var openParamter = encodeURIComponent(JSON.stringify(openFileList));
                    
                    //Add launch files info and launch floatWindow
                    var ao_module_virtualDesktop = !(!parent.isDesktopMode);
                    if (ao_module_virtualDesktop){
                        parent.newFloatWindow({
                            url: url + "#" + openParamter,
                            width: size[0],
                            height: size[1],
                            appicon: icon,
                            title: title
                        });
                    }else{
                        let openURL = "../../" + url + "#" + openParamter;
                        if (isSafari()) {
                            const a = document.createElement('a')
                            a.setAttribute('href', openURL)
                            a.setAttribute('target', '_blank')
                            setTimeout(() => a.click())
                        }else{
                            window.open(openURL);
                        }
                    }
                    
                }
            }
        });
    }
}

function openSelectedFolderInNewWindow(){
    $(".fileObject.selected").each(function(){
        if ($(this).attr("type") == "folder"){
            console.log($(this).attr('filepath'));
            openPathInNewWindow([$(this).attr('filepath')]);
        }
    })
}

function openSelectedVroot(){
    $("#storageroot").find(".dir.item").each(function(){
        if ($(this).hasClass("active")){
            var thisRootPath = $(this).attr('filepath');
            openPathInNewWindow([$(this).attr('filepath')]);
        }
    });
}

//Always open the first object locally, and open others in new floatWindows
function openFolderInNewWindow(paths){
    if (paths.length > 0){
        listDirectory(paths[0]);
        for (var i = 1; i < paths.length; i++){
            openPathInNewWindow(paths[i]);
        }
    }
}

function openPathInNewWindow(path){
    console.log("Opening in new File Maanger: ", window.location.pathname + "#" + path);
    ao_module_newfw({
        url: window.location.pathname + "#" + path,
        appicon: "SystemAO/file_system/img/small_icon.png",
        title: "File Manager",
        width: 1080,
        height: 580,
        parent: ao_module_windowID,
    });
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.openFileLocation = openFileLocation;
window.openSelectedFolderInNewWindow = openSelectedFolderInNewWindow;
window.openSelectedVroot = openSelectedVroot;
window.openViaButton = openViaButton;
window.openthis = openthis;
