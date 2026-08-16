/*
    share.js

    File sharing dialog (embeds file_share.html in an iframe).

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

function handleShareFilebuttonClick(event, object){
    event.preventDefault(); 
    event.stopImmediatePropagation();
    $(".fileObject.selected").removeClass("selected");
    if (viewMode == "list"){
        $(object).parent().parent().addClass("selected");
    }else if (viewMode == "grid"){
        $(object).parent().parent().parent().addClass("selected");
    }else if (viewMode == "details"){
        $(object).parent().parent().addClass("selected");
    }
    
    shareFile();
}

function resizeShareIframe(){
    $("#shareFileEmbedded").css("height", $("#shareFile").height() - 126 + "px");
}

function shareFile(){
    var selectedFiles = [];
    var selectedFileObjects = [];
    $(".fileObject.selected").each(function(){
        var thisFilepath = $(this).attr("filepath");
        var thisFilename = $(this).attr("filename");
        selectedFiles.push(thisFilepath);
        selectedFileObjects.push({"filepath": thisFilepath, "filename": thisFilename});
    });

    if (selectedFiles.length == 0){
        msgbox("question", applocale.getString("message/No file selected", "No file selected"));
        console.log("No file is selected for sharing");
        return;
    }else if (selectedFiles.length > 1){
        //Try to share more than 1 files, which is not supported
        msgbox("yellow exclamation", applocale.getString("message/Multiple files share is currently not supported", "Multiple files share is currently not supported"));
        console.log("Multi share is current not supported");
        return
    }

    //OK! Continue to generate link
    var selectedFile = selectedFiles[0];
    var selectedFileObject = selectedFileObjects[0];
    shareEditingObject = selectedFile;
    $.ajax({
        url: "../../system/file_system/share/new",
        data: {path: selectedFile},
        success: function(data){
            if (data.error !== undefined){
                msgbox("red remove",applocale.getString("message/" + data.error,data.error), 5000);
            }else{
                //Build the predicted share endpoint
                selectedFileObject["QRCode"] = true;
                selectedFileObject["ActionButtons"] = false;
                var payload = encodeURIComponent(JSON.stringify([selectedFileObject]));
                var requestURL = "file_share.html#" + payload;
                $("#shareFileEmbedded").attr("src", requestURL);
                resizeShareIframe();

                //Show the share file interface
                hideAllPopupWindows();
                showPopupWrapper();
                $("#shareFile").transition('slide left');

                //Reload the list
                listDirectory(currentPath);
            }
            
        }
    });
    
}

function removeSharing(){
    if (shareEditingObject == ""){
        return
    }

    //The target file to remove
    var selectedFile = shareEditingObject;
    $("#shareFileEmbedded").attr("src", "");
    $.ajax({
        url: "../../system/file_system/share/delete",
        data: {vpath: selectedFile},
        success: function(data){
            $("#qrcode").html(`<img src="img/private.png">`);
            $(".shareoption").parent().addClass("disabled");
            $("#sharelink").text("(Sharing Removed)");
            $("#sharelink").removeAttr("href");
            //Reload the current filelist and hide the share interface
            listDirectory(currentPath);

            //Reset sharing file settings
            shareEditingObject = ""
        }
    });

    hideAllPopupWindows();
    msgbox("checkmark", applocale.getString("message/share/removed", "File share removed"))
}

function hideShare(){
    hideAllPopupWindows();
    $("#shareFileEmbedded").attr("src", "");
}

/*
    Cross frame hooks called by the embedded file_share.html iframe.

    file_share.html calls parent.setFileShareIndicator(filename) after a
    share is created and parent.removeFileShareIndicator(filename) after
    one is revoked. When that page runs as a float window its parent is
    desktop.html, which defines both. When the File Manager embeds it in
    #shareFileEmbedded the parent is this document instead, so without
    these the call threw and the share flow broke for anything under
    user:/Desktop.

    Here we update our own listing's share badge and forward to the
    desktop so its icon stays in step too.
*/
function setFileShareIndicator(filename){
    forwardShareIndicatorToDesktop("setFileShareIndicator", filename);
}

function removeFileShareIndicator(filename){
    forwardShareIndicatorToDesktop("removeFileShareIndicator", filename);
}

/*
    The share badge in our own listing comes from the IsShared flag on
    each listDir entry, and both shareFile() and removeSharing() already
    re-list the directory afterwards, so there is nothing to repaint here.
    Only the desktop needs telling.
*/
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
window.hideShare = hideShare;
window.removeFileShareIndicator = removeFileShareIndicator;   // the embedded file_share.html iframe calls parent.*
window.removeSharing = removeSharing;
window.setFileShareIndicator = setFileShareIndicator;   // the embedded file_share.html iframe calls parent.*
window.shareFile = shareFile;
