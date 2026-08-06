/*
    rename.js

    Rename, inline and via the rename dialog.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

let renameFileObjects = [];
function rename(){
    hideAllPopupWindows();
    renameFileObjects = [];
    var filenames = [];
    $(".fileObject.selected").each(function(){
        var fileObjectType = $(this).attr("type");
        let fileObject = {
            filename: $(this).attr('filename'),
            filepath: $(this).attr("filepath"),
            filetype: fileObjectType
        }
        renameFileObjects.push(JSON.parse(JSON.stringify(fileObject)));
        filenames.push($(this).attr('filename'));
    });
    var oldname = "unknown file.txt";
    if (renameFileObjects.length == 0){
        return;
    }else if (renameFileObjects.length > 0){
        $("#renameBox").find(".multifileWarning").hide();
        oldname = filenames[0];
    }   

    //Override with rename input box
    renameMode = true;

    if (isMobile){
        //Mobile rename using sidebar dialog
        $("#renameBox").find(".orgfn").val(oldname);
        $("#renameBox").find(".newfn").val(oldname);
        showPopupWrapper();
        $("#renameBox").transition('slide left in');
    }else{
        //Desktop rename
        let rootObject = $($(".fileObject.selected")[0]);
        $(rootObject).addClass("renaming");
        let targetDOM = $(rootObject).find(".filename");
        rootObject.attr("draggable", "false");
        if (viewMode == "list"){
            $(targetDOM).html(`<div class="renameinput" oldname="${encodeURIComponent(oldname)}" onkeydown="handleInputConfirmRename(this, event);" style="width: calc(100% - 5em); display: inline-block;">
                <input type="text" value="${oldname}">
            </div>`);
            $(rootObject).find(".sharebtn").remove();
        }else if (viewMode == "grid"){
            $(targetDOM).html(`<div class="renameinput" oldname="${encodeURIComponent(oldname)}" onkeydown="handleInputConfirmRename(this, event);" style="width: 100%; display: inline-block;">
                <input type="text" value="${oldname}">
            </div>`);
        }else if (viewMode == "details"){
            $(targetDOM).html(`<div class="renameinput" oldname="${encodeURIComponent(oldname)}" onkeydown="handleInputConfirmRename(this, event);" style="width: calc(100% - 5em); display: inline-block;">
                <input type="text" value="${oldname}">
            </div>`);
        }
        
        let targetInputField = $(".renameinput").find("input")[0];
        $(targetInputField).focus();
        targetInputField.selectionStart = 0;
        targetInputField.selectionEnd = targetInputField.value.lastIndexOf(".");
    }
}

//Exit rename mode with current name in filename as new filename
//Activate from clicking elsewhere
function exitRenameModeWithConfirm(applyChange = true){
    let renamingObject = $($(".renameinput")[0]);
    $(".fileObject.renaming").removeClass("renaming");
    let newname = renamingObject.find("input").val();
    let oldname = renamingObject.attr("oldname");
    oldname = decodeURIComponent(oldname);
    if (oldname == newname || !applyChange){
        //Cancel Rename, in cases where old name = new name or applyChange set to false
        let filenameField = $(renamingObject).parent();
        $(filenameField).html(oldname);
        renameMode = false;
        return;
    }
    confirmRename(oldname, newname);
}

//Handle enter press on rename input box
function handleInputConfirmRename(object, evt){
    let filenameForbiddenCharKey = [
        '/',
        '<',
        '>',
        ':',
        '"',
        '\\',
        '*'
    ];
    if (evt.keyCode == 13){
        evt.preventDefault();
        evt.stopImmediatePropagation();
        let oldname = $(object).attr("oldname").trim();
        let newname = $(object).find("input").val().trim();
        $(".fileObject.selected.renaming").removeClass("renaming");
        if (oldname == newname){
            //Cancel Rename
            let filenameField = $(object).parent();
            $(filenameField).html(oldname);
            renameMode = false;
            return;
        }
        confirmRename(oldname, newname);
    }else if (evt.keyCode == 27){
        //ESC key, restore to origin
        //Exit rename mode but not apply change
        exitRenameModeWithConfirm(false);
    }else if (filenameForbiddenCharKey.includes(evt.key)){
        //Show now allow popup
        evt.preventDefault();
    }
}


//Check if filename contains web-unsafe characters
function filenameContainsIllegalCharacters(filename){
    var illegalChars = ['/', '\\', '?', '%', '*', ':', '|', '"', '<', '>'];
    for (var i = 0; i < illegalChars.length; i++){
        if (filename.includes(illegalChars[i])){
            return true;
        }
    }
    return false;
}

function confirmRename(oldName=undefined, newName=undefined){
    renameMode = false;
    if (oldName == undefined){
        oldName = $("#renameBox").find(".orgfn").val().trim();
    }

    if (newName == undefined){
        newName = $("#renameBox").find(".newfn").val().trim();
    }

    //Check for illegal characters
    if (filenameContainsIllegalCharacters(newName)){
        msgbox("red remove", applocale.getString("message/illegalCharacters", "Filename contains illegal characters"));
        return;
    }

    if (newName == oldName){
        msgbox("red remove",applocale.getString("message/newFilenameIdentical", "New filename is identical to the original filename."));
        hideAllPopupWindows();
        return;
    }
    var newNameWithoutExt = newName;
    var newnameExt = "";
    if (newName.includes(".")){
        tmp = newName.split(".");
        newnameExt = tmp.pop();
        newNameWithoutExt = tmp.join(".");
    }

    var counter = 0;
    var srclist = [];
    var newnamelist = [];

    for (var i =0; i < renameFileObjects.length; i++){
        var thisFilepath = renameFileObjects[i].filepath;
        var thisFiletype = renameFileObjects[i].filetype;
        var thisFilename = renameFileObjects[i].filename;
        
        var newFilename = newName;
        if ( i > 0){
            if (thisFiletype == "file"){
                var thisFileExt = thisFilename.split(".").pop();
                newFilename = newNameWithoutExt + "(" + i + ")." + thisFileExt;
            }else if (thisFiletype == "folder"){
                newFilename = newNameWithoutExt + "(" + i + ")";
            }
        }
        srclist.push(thisFilepath);
        newnamelist.push(newFilename);
        
    }
    //Send the request to serverside
    requestCSRFToken(function(token){
        $.ajax({
            url: "../../system/file_system/fileOpr",
            method: "POST",
            data: {opr: "rename", src: JSON.stringify(srclist), new: JSON.stringify(newnamelist), csrft: token},
            success: function(data){
                if (data.error !== undefined){
                    msgbox("red remove",applocale.getString("message/" + data.error, data.error));
                }else{
                    refreshList(function(){
                        focusFileObject(newName);
                    });
                    msgbox("checkmark",applocale.getString("message/rename/success", "Rename suceed"));
                }
                hideAllPopupWindows();
            },
            error: function(){
                hideAllPopupWindows();
            }
        });
        renameFileObjects = [];
    });

}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.confirmRename = confirmRename;
window.handleInputConfirmRename = handleInputConfirmRename;
window.rename = rename;
