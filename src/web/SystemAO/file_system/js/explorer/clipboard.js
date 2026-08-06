/*
    clipboard.js

    Copy / cut / paste and the overwrite-conflict dialog.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

function changeOverwriteRule(mode, doPasteAgain=false){
    switch (mode){
        case 0:
            overwriteMode = "overwrite";
            break;
        case 1:
            overwriteMode = "skip";
            break;
        case 2:
            overwriteMode = "keep";
            break;
        default:
        overwriteMode = "keep";
    }

    if (doPasteAgain){
        //Initiate paste without checking and close the overwritemode selector
        paste(undefined, true);
    }
}


function copy(){
    cutMode = false;
    clipboard = [];
    if ($(".fileObject.selected").length == 0){
        return;
    }

    $(".fileObject.selected").each(function(){
        var thisFilepath = $(this).attr("filepath");
        clipboard.push(thisFilepath);
    });
    if (useLocalstorage){
        localStorage.setItem("ao/file_system/clipboard",JSON.stringify(clipboard));
        localStorage.setItem("ao/file_system/cutmode","false");
    }
    msgbox("copy",clipboard.length + applocale.getString("message/copy/success", " objects copied."))
}

function cut(){
    cutMode = true;
    clipboard = [];
    if ($(".fileObject.selected").length == 0){
        return;
    }
    $(".fileObject.selected").each(function(){
        var thisFilepath = $(this).attr("filepath");
        clipboard.push(thisFilepath);
    });
    if (useLocalstorage){
        localStorage.setItem("ao/file_system/clipboard",JSON.stringify(clipboard));
        localStorage.setItem("ao/file_system/cutmode","true");
    }
    msgbox("cut",clipboard.length + applocale.getString("message/move/success", " objects ready to be moved."))
}

function paste(redirectPasteTarget="", nocheck=false){
    let thisOprCutMode = cutMode;
    let fileList = clipboard;
    let targetDir = currentPath;
    if (redirectPasteTarget != ""){
        //Allow redirection of paste target if necessary
        targetDir = redirectPasteTarget;
    }
    if (useLocalstorage){
        //There are localStorage. Always use localStorage if exists.
        var crossFrameClipboard = localStorage.getItem("ao/file_system/clipboard");
        var useCutMode = localStorage.getItem("ao/file_system/cutmode");
        if (crossFrameClipboard !== "" && crossFrameClipboard !== undefined && crossFrameClipboard !== null){
            fileList = JSON.parse(crossFrameClipboard);
        }
        if (useCutMode !== "" && useCutMode !== undefined && useCutMode !== null){
            thisOprCutMode = (useCutMode == "true");
        }
    }
    if (fileList.length == 0){
        //There are nothing to paste
        msgbox("question",applocale.getString("message/paste/nothing", "There are nothing to paste."))
        return;
    }
    if (thisOprCutMode == true){
        //Cut and paste
        $.ajax({
            type: 'POST',
            url: `../../system/file_system/validateFileOpr`,
            data: {src: JSON.stringify(fileList), dest: targetDir},
            success: function(data){
                if (!nocheck && data.length > 0){
                    //There are problem with the copy target. Pop up overwrite rule selector
                    showDuplicateHandler(data);
                }else{
                    //OK!
                    //Clear clipboard settings
                    localStorage.setItem("ao/file_system/clipboard", "");
                    clipboard = "";

                    //Stsart operations
                    if (!ao_module_virtualDesktop){
                        //Not under desktop mode. Use direct copy API
                        requestCSRFToken(function(token){
                            $.ajax({
                                type: 'POST',
                                url: `../../system/file_system/fileOpr`,
                                data: {opr: "move" ,src: JSON.stringify(fileList), dest: targetDir,existsresp: overwriteMode, csrft: token},
                                success: function(data){
                                    if (data.error !== undefined){
                                        msgbox("red remove",applocale.getString("message/" + data.error, data.error));
                                    }else{
                                        //OK
                                        msgbox("checkmark",fileList.length + applocale.getString("message/move/success", " objects moved."))
                                        refreshList();
                                    }
                                    hideAllPopupWindows();
                                }
                            });
                        });
                        
                    }else{
                        //Pass the request to operation handler
                        var oprConfig = {
                            opr: "move",
                            src: fileList,
                            dest: targetDir,
                            overwriteMode: overwriteMode,
                            callbackWindowID: ao_module_windowID,
                            callbackFunction: `callRefresh("${targetDir}")`
                        }
                        var configHash = encodeURIComponent(JSON.stringify(oprConfig));
                        var title = "Moving " + fileList.length;
                        if (fileList.length > 1){
                            title += " files";
                        }else{
                            title += " file";
                        }
                        parent.newFloatWindow({
                            url: "SystemAO/file_system/file_operation.html#" + configHash,
                            width: 400,
                            height: 220,
                            appicon: "SystemAO/file_system/img/selector.png",
                            title: title
                        });
                        hideAllPopupWindows();
                    }
                }
            }
        });
    }else{
        //Copy and paste
        //Check if the file list is OK for continue without the need for overwrite
        $.ajax({
            type: 'POST',
            url: `../../system/file_system/validateFileOpr`,
            data: {src: JSON.stringify(fileList), dest: targetDir},
            success: function(data){
                if (!nocheck && data.length > 0){
                    //There are problem with the copy target. Pop up overwrite rule selector
                    showDuplicateHandler(data);
                }else{
                    //OK!
                    if (!ao_module_virtualDesktop){
                        requestCSRFToken(function(token){
                            $.ajax({
                                type: 'POST',
                                url: `../../system/file_system/fileOpr`,
                                data: {opr: "copy" ,src: JSON.stringify(fileList), dest: targetDir,existsresp: overwriteMode, csrft: token},
                                success: function(data){
                                    if (data.error !== undefined){
                                        msgbox("red remove",applocale.getString("message/" + data.error,data.error));
                                    }else{
                                        //OK
                                        msgbox("checkmark",fileList.length + applocale.getString("message/copy/success", " objects copied."))
                                        refreshList();
                                    }
                                    hideAllPopupWindows();
                                }
                            });
                        });
                        
                    }else{
                        //Pass the request to operation handler
                            var oprConfig = {
                            opr: "copy",
                            src: fileList,
                            dest: targetDir,
                            overwriteMode: overwriteMode,
                            callbackWindowID: ao_module_windowID,
                            callbackFunction: `callRefresh("${targetDir}")`
                        }
                        var configHash = encodeURIComponent(JSON.stringify(oprConfig));
                        var title = "Copying " + fileList.length;
                        if (fileList.length > 1){
                            title += " files";
                        }else{
                            title += " file";
                        }
                        parent.newFloatWindow({
                            url: "SystemAO/file_system/file_operation.html#" + configHash,
                            width: 400,
                            height: 220,
                            appicon: "SystemAO/file_system/img/selector.png",
                            title: title
                        });
                        hideAllPopupWindows();
                    }
                    
                }
            }
        });
    }
}

//Callback function for file operation display
window.callRefresh = function(targetdir){
    if (currentPath == targetdir){
        refreshList();
    }
}

//This action may duplicate files. Show handler
function showDuplicateHandler(duplicateFileList){
    $(".popup").fadeOut(100);
    var duplicatedFileCounts = duplicateFileList.length;
    showPopupWrapper();
    $("#overwriteModeSelection").transition("slide left in");
    $("#overwriteModeSelection").find(".owm-fc").text(duplicatedFileCounts);
    var srcpath = duplicateFileList[0];
    srcpath = srcpath.split("/");
    srcpath.pop();
    srcpath = srcpath.join("/");
    $("#overwriteModeSelection").find(".owm-srcdir").text(srcpath);
    $("#overwriteModeSelection").find(".owm-destdir").text(currentPath);
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.changeOverwriteRule = changeOverwriteRule;
window.copy = copy;
window.cut = cut;
window.paste = paste;
