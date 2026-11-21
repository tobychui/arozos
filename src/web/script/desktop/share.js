/*
    ArozOS Desktop - Sharing

    Creating, copying and opening share links of desktop files.

    Part of desktop.html, see README.md in this folder for the load order.
*/

function handleFileShare(target, object){
    $("#subcontextmenu").html("");
    //Get the selected file
    var targetFile = $(".launchIconWrapper.selected")[0];
    var fileData = $(targetFile).parent().attr("filedata");
    if (fileData != undefined){
        fileData = JSON.parse(decodeURIComponent(fileData));
         //Check if the target file is shared
         $.ajax({
             url: "system/file_system/share/checkShared",
             data: {path: fileData.Filepath},
             success: function(data){
                if (data.IsShared == true){
                    addContextMenuItem($("#subcontextmenu"), lcontex("Open Shared Link"), undefined, "openSharedLink", false, {
                        payload: {
                            uuid: data.ShareUUID.UUID
                        }
                    });
                    addContextMenuItem($("#subcontextmenu"),  lcontex("Copy Link"), undefined, "copySharedLink", false, {
                        payload: {
                            uuid: data.ShareUUID.UUID
                        }
                    });
                    addContextMenuSeperator($("#subcontextmenu"));
                    addContextMenuTitle($("#subcontextmenu"), lcontex("Change Share Settings"));
                }else{
                    addContextMenuTitle($("#subcontextmenu"), lcontex("Share this File"));
                }

                //The current permission carries a check mark
                var permission = data.IsShared ? data.ShareUUID.Permission : "";
                var simplePermission = ["anyone", "signedin", "samegroup"].includes(permission);

                addContextMenuItem($("#subcontextmenu"), applocale.getString("contextmenu/share/link","Anyone with Link"), undefined, "shareWithThisPermission", false, {
                    payload: {
                        type: "anyone"
                    },
                    checked: permission == "anyone"
                });
                addContextMenuItem($("#subcontextmenu"), applocale.getString( "contextmenu/share/signedin","Anyone Signed In"), undefined, "shareWithThisPermission", false, {
                    payload: {
                        type: "signedin"
                    },
                    checked: permission == "signedin"
                });
                addContextMenuItem($("#subcontextmenu"), applocale.getString("contextmenu/share/samegroup","Same user group"), undefined, "shareWithThisPermission", false,{
                    payload: {
                        type: "samegroup"
                    },
                    checked: permission == "samegroup"
                });
                addContextMenuItem($("#subcontextmenu"), applocale.getString("contextmenu/share/openshare","Advance Share Settings"), undefined, "shareWithThisPermission", false,{
                    payload: {
                        action: "openshare"
                    },
                    //None of the simple permissions: an advanced share
                    checked: data.IsShared && !simplePermission
                });
                if (data.IsShared){
                    //This file is shared.
                    addContextMenuSeperator($("#subcontextmenu"));
                    addContextMenuItem($("#subcontextmenu"), lcontex("Remove Share"), undefined, "shareWithThisPermission", false,{
                        payload: {
                            type: "remove"
                        },
                        danger: true
                    });
                }
             }
         });
    }

    showSubContextMenu(target);
}

//Copy the shared link
function copySharedLink(target, event){
    var payload = getContextMenuPayload(target);
    if (payload == null){
        //Something wrong
        return;
    }

    //Generate the share link
    let protocol = "https://";
    if (location.protocol !== 'https:') {
        protocol = "http://";
    }
    var shareURL = protocol + window.location.hostname + ":" + window.location.port + "/share/" + payload.uuid;

    //Copy the text to clipboard
    const area = document.createElement('textarea');
    document.body.appendChild(area);

    area.value = shareURL;
    area.select();
    document.execCommand('copy');

    document.body.removeChild(area);

    //Update status so it show the user it has been coped
    $(target).find(".label").text(lcontex("Copied"));
    $(target).addClass("checked").find(".menuCheck").remove();
    $(target).append(`<i class="menuCheck check icon"></i>`);
    setTimeout(function(){
        if ($(target).length > 0){
            $(target).find(".label").text(lcontex("Copy Link"));
            $(target).removeClass("checked").find(".menuCheck").remove();
        }
    }, 3000);
}

//Open the shared file link
function openSharedLink(target, event){
    var payload = getContextMenuPayload(target);
    if (payload == null){
        //Something wrong
        return;
    }

    var targetURL = "share/" + payload.uuid;
    window.open(targetURL);

    hideAllContextMenus();
}

function shareWithThisPermission(target, event){
    var payload = getContextMenuPayload(target);
    if (payload == null){
        //Something wrong
        return;
    }


    //Get the selected file
    var selectedFileObjects = $(".launchIconWrapper.selected");
    if (selectedFileObjects.length == 0){
        //Not found
        return
    }else if (selectedFileObjects.length > 1){
        //This should not happens. If it did happens, use the first one
        selectedFileObjects = selectedFileObjects[0];
    }

    //Extract file information
    var fileData = $(selectedFileObjects).parent().attr("filedata");
    fileData = JSON.parse(decodeURIComponent(fileData));

    //Convert the desktop file data to ArozOS generic filedata
    var afd = {
        "filename": fileData.Filename,
        "filepath": fileData.Filepath,
        "shareMode": payload.type
    };

    if (payload.action != undefined && payload.action == "openshare"){
        //Advance setting. Open share interface
        delete afd.shareMode;
        afd.ActionButtons = false;

        //Open share manager in another floatWindow
        let targetURL = "SystemAO/file_system/file_share.html#" + encodeURIComponent(JSON.stringify([afd]));
        newFloatWindow({
            url: targetURL,
            width: 760,
            height: 600,
            appicon: "SystemAO/file_system/img/share.svg",
            title: "Share File"
        });

        hideAllContextMenus();
        return;
    }

    //Create a new share for this
    var targetURL = "SystemAO/file_system/file_share.html#" + encodeURIComponent(JSON.stringify([afd]));


    //Calculate the window spawn position
    var shareWindowWidth = 760;
    var shareWindowHeight = 600;
    var basePosition = $(selectedFileObjects).offset();
    var left = basePosition.left + 100;
    if (left + shareWindowWidth > window.innerWidth){
        left = Math.max(0, window.innerWidth - shareWindowWidth - 20);
    }

    var top = basePosition.top;
    if (top + shareWindowHeight > window.innerHeight){
        top = Math.max(0, window.innerHeight - shareWindowHeight);
    }

    newFloatWindow({
        url: targetURL,
        width: shareWindowWidth,
        height: shareWindowHeight,
        left: left,
        top: top,
        appicon: "SystemAO/file_system/img/share.svg",
        title: "Share File"
    });

    hideAllContextMenus();
}
