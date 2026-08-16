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
        requestCSRFToken(function(token){
            $.ajax({
                url: "../../system/file_system/fileOpr",
                method:"POST",
                data: {opr: "recycle", src: JSON.stringify(deleteFileList), csrft: token},
                success: function(data){
                    if (data.error !== undefined){
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
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.cancelDelete = cancelDelete;
window.cancelForceDelete = cancelForceDelete;
window.deleteFile = deleteFile;
window.forceDelete = forceDelete;
