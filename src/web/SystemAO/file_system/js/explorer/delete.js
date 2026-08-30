/*
    delete.js

    Move to trash (recycle) and permanent delete.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

//Force delete. Use normal delete fucntion if you want to move things to recycle bin instead.
let forceDeleteList = [];
function forceDelete(confirmed=false){
    if (!confirmed){
        //Show confirm box
        let deletePendingList = [];
        var listObject = $("#forceDeleteConfirmBox").find(".deleteFilelist")[0];
        $(listObject).html("");
        $(".selected.fileObject").each(function(data){
            var thispath = $(this).attr("filepath");
            var thisfilename = $(this).attr("filename");
            var ext = thisfilename.split(".").pop();
            var icon = ao_module_utils.getIconFromExt(ext);
            deletePendingList.push(thispath);
            $(listObject).append(`<div class="item" ><span style="display:inline-block;">${thisfilename}</span></div>`);
        });
        showPopupWrapper();
        $("#forceDeleteConfirmBox").transition("slide left in");
        forceDeleteList = deletePendingList;
    }else{
        //Start force delete function
        let fdlistLength = forceDeleteList.length;
        requestCSRFToken(function(token){
            $.ajax({
                url: "../../system/file_system/fileOpr",
                method:"POST",
                data: {opr: "delete", src: JSON.stringify(forceDeleteList), csrft: token},
                success: function(data){
                    if (data.error !== undefined){
                        msgbox("red remove",applocale.getString("message/" + data.error,data.error));
                    }else{
                        refreshList();
                        msgbox("checkmark",fdlistLength + applocale.getString("message/remove/success", " objects removed."))
                    }
                }
            });
            //Finishing up delete sequence
            forceDeleteList = [];
            hideAllPopupWindows();
        });
        
    }
}

let deleteFileList = [];
function deleteFile(confirmed = false){
    if (!confirmed){
        //Show the confirm dialog
        $("#deleteConfirmBox").find(".deleteFilelist").html("");
        $(".fileObject.selected").each(function(data){
            var thisfilename = $(this).attr('filename');
            var thisFilepath = $(this).attr('filepath');
            deleteFileList.push(thisFilepath);
            $("#deleteConfirmBox").find(".deleteFilelist").append(`<div class="item" ><span style="display:inline-block;">${thisfilename}</span></div>`);
        });
        if (deleteFileList.length == 0){
            //No files selected
            return;
        }else{
            //File selected. Continue to delete
            showPopupWrapper();
            $("#deleteConfirmBox").transition("slide left in");
        }
    }else{
        //Continue to delete files
        let fdlistLength = deleteFileList.length;
        /*
            Kept aside before the list is cleared below, so the trash full
            dialog still knows what the user was trying to delete.
        */
        let pendingRecycleList = deleteFileList.slice();
        requestCSRFToken(function(token){
            $.ajax({
                url: "../../system/file_system/fileOpr",
                method:"POST",
                data: {opr: "recycle", src: JSON.stringify(deleteFileList), csrft: token},
                success: function(data){
                    if (data.error == "TRASH_QUOTA_EXCEEDED"){
                        /*
                            The bin is at its size limit. The server refused
                            before moving anything, so the files are untouched
                            and the user gets to choose what happens next.
                        */
                        showTrashFullDialog(pendingRecycleList);
                    }else if (data.error !== undefined){
                        msgbox("red remove",applocale.getString("message/" + data.error,data.error));
                    }else{
                        refreshList();
                        msgbox("checkmark",fdlistLength + applocale.getString("message/recycle/success", " objects moved to trash bin."))
                    }

                    if (currentPath == "user:/"){
                        //Reload the User root folder list
                        initRootDirs();
                    }
                }
            });
            deleteFileList = [];
            hideAllPopupWindows();
        });
        
    }
}

function cancelDelete(){
    deleteFileList=[];
    hideAllPopupWindows();
}            

function cancelForceDelete(){
    forceDeleteList = [];
    hideAllPopupWindows();
}


/*
    Trash bin full

    Offered when the server refuses a recycle because the user's trash size
    limit would be exceeded. Nothing has moved at this point, so all three
    outcomes are still open:

        1. empty the bin, then move these files into it
        2. delete them outright, skipping the bin
        3. do nothing

    The pending list is held here rather than on the dialog, so a stale dialog
    cannot act on a previous selection.
*/
let trashFullPendingList = [];

function showTrashFullDialog(filepaths){
    trashFullPendingList = (filepaths == undefined) ? [] : filepaths.slice();
    $("#trashFullBox").find(".trashFullCount").text(trashFullPendingList.length);
    showPopupWrapper();
    $("#trashFullBox").transition("slide left in");
}

//Option 1: make room by emptying the bin, then retry the move
function trashFullClearAndRecycle(){
    hideAllPopupWindows();
    let retryList = trashFullPendingList.slice();
    if (retryList.length == 0){
        return;
    }
    $.get("../../system/file_system/clearTrash", function(data){
        if (data !== null && data !== undefined && data.error !== undefined){
            msgbox("red remove", data.error);
            return;
        }
        requestCSRFToken(function(token){
            $.ajax({
                url: "../../system/file_system/fileOpr",
                method: "POST",
                data: {opr: "recycle", src: JSON.stringify(retryList), csrft: token},
                success: function(data){
                    if (data.error !== undefined){
                        msgbox("red remove", applocale.getString("message/" + data.error, data.error));
                    }else{
                        refreshList();
                        msgbox("checkmark", retryList.length +
                            applocale.getString("message/recycle/success", " objects moved to trash bin."));
                    }
                }
            });
        });
    });
}

//Option 2: skip the bin entirely
function trashFullDeleteDirectly(){
    hideAllPopupWindows();
    let targets = trashFullPendingList.slice();
    if (targets.length == 0){
        return;
    }
    requestCSRFToken(function(token){
        $.ajax({
            url: "../../system/file_system/fileOpr",
            method: "POST",
            data: {opr: "delete", src: JSON.stringify(targets), csrft: token},
            success: function(data){
                if (data.error !== undefined){
                    msgbox("red remove", applocale.getString("message/" + data.error, data.error));
                }else{
                    refreshList();
                    msgbox("checkmark", applocale.getString("trash/deleted", "Deleted permanently"));
                }
            }
        });
    });
}

//Option 3 needs no handler beyond closing the dialog


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.cancelDelete = cancelDelete;
window.cancelForceDelete = cancelForceDelete;
window.deleteFile = deleteFile;
window.showTrashFullDialog = showTrashFullDialog;
window.trashFullClearAndRecycle = trashFullClearAndRecycle;
window.trashFullDeleteDirectly = trashFullDeleteDirectly;
window.forceDelete = forceDelete;
