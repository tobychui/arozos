/*
    share.js

    File sharing dialog (embeds file_share.html in an iframe).

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.

    Opening the dialog does not create a share: file_share.html reads the
    share state of the file and only creates or changes shares when the user
    asks it to. It reports every change back through onShareStateChanged().
*/

function handleShareFilebuttonClick(event, object){
    event.preventDefault();
    event.stopImmediatePropagation();
    $(".fileObject.selected").removeClass("selected");
    $(object).closest(".fileObject").addClass("selected");

    shareFile();
}

function shareFile(){
    var selectedFileObjects = [];
    $(".fileObject.selected").each(function(){
        selectedFileObjects.push({
            "filepath": $(this).attr("filepath"),
            "filename": $(this).attr("filename")
        });
    });

    if (selectedFileObjects.length == 0){
        msgbox("question", applocale.getString("message/No file selected", "No file selected"));
        return;
    }else if (selectedFileObjects.length > 1){
        //Try to share more than 1 files, which is not supported
        msgbox("yellow exclamation", applocale.getString("message/Multiple files share is currently not supported", "Multiple files share is currently not supported"));
        return
    }

    //Close whatever is open first: hideAllPopupWindows() blanks the share
    //iframe if the share dialog was the one showing
    hideAllPopupWindows();

    var selectedFileObject = selectedFileObjects[0];
    selectedFileObject["Embedded"] = true;
    var payload = encodeURIComponent(JSON.stringify([selectedFileObject]));
    $("#shareFileEmbedded").attr("src", "file_share.html#" + payload);

    showPopupWrapper();
    $("#shareFile").transition('fade in');
}

function hideShare(){
    hideAllPopupWindows();
    $("#shareFileEmbedded").attr("src", "");
}

/*
    Remove every share of the selected file. The dialog has its own per-link
    controls; this is kept for callers that want a one shot "stop sharing".
*/
function removeSharing(){
    var selected = $(".fileObject.selected").first();
    if (selected.length == 0){
        return;
    }
    $.ajax({
        url: "../../system/file_system/share/delete",
        method: "POST",
        data: {vpath: selected.attr("filepath")},
        success: function(data){
            if (data.error !== undefined){
                msgbox("red remove", applocale.getString("message/" + data.error, data.error), 5000);
                return;
            }
            onShareStateChanged(selected.attr("filepath"), false);
            msgbox("checkmark", applocale.getString("message/share/removed", "File share removed"));
        }
    });
}

/*
    Called by the embedded file_share.html whenever it learns the share state
    of its file (on load and after every change). Re-list only when the badge
    in our listing is out of date, and keep the desktop icon in step.
*/
let shareRelistTimer = null;
function onShareStateChanged(filepath, isShared){
    var fileObject = $(".fileObject").filter(function(){
        return $(this).attr("filepath") == filepath;
    });
    var badgeShown = fileObject.find(".sharebtn").length > 0;
    if (fileObject.length > 0 && badgeShown != isShared){
        clearTimeout(shareRelistTimer);
        shareRelistTimer = setTimeout(function(){
            listDirectory(currentPath);
        }, 300);
    }

    var parts = filepath.split("/");
    var filename = parts.pop();
    if (parts.join("/") == "user:/Desktop"){
        forwardShareIndicatorToDesktop(isShared ? "setFileShareIndicator" : "removeFileShareIndicator", filename);
    }
}

/*
    Cross frame hooks kept for pages that still call parent.setFileShareIndicator
    / parent.removeFileShareIndicator directly. When the File Manager runs inside
    the desktop, the desktop draws the share badge on its own icons, so forward
    the call there.
*/
function setFileShareIndicator(filename){
    forwardShareIndicatorToDesktop("setFileShareIndicator", filename);
}

function removeFileShareIndicator(filename){
    forwardShareIndicatorToDesktop("removeFileShareIndicator", filename);
}

function forwardShareIndicatorToDesktop(fname, filename){
    if (!ao_module_virtualDesktop){
        return;
    }
    try{
        if (typeof parent[fname] === "function"){
            parent[fname](filename);
        }
    }catch(ex){
        //Parent is cross origin or already gone - not fatal.
        console.log("[File Manager] Unable to forward " + fname, ex);
    }
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.handleShareFilebuttonClick = handleShareFilebuttonClick;
window.hideShare = hideShare;                       // file_share.html calls parent.hideShare() to close
window.onShareStateChanged = onShareStateChanged;   // file_share.html reports share changes here
window.removeFileShareIndicator = removeFileShareIndicator;
window.removeSharing = removeSharing;
window.setFileShareIndicator = setFileShareIndicator;
window.shareFile = shareFile;
