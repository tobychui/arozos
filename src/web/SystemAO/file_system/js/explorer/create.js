/*
    create.js

    New file, new folder and desktop shortcut creation.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

function createDesktopShortcut(){
    let folders = [];
    let filenames = [];
    if ($(".fileObject.selected").length == 0){
        return;
    }
    $(".fileObject.selected").each(function(){
        var thisFilepath = $(this).attr("filepath");
        var thisFilename = $(this).attr("filename");
        if($(this).attr("type") == "folder"){
            folders.push(thisFilepath);
            filenames.push(thisFilename);
        }
    });

    let targetFolder = folders[0];
    let targetFilename = filenames[0];
    $.ajax({
        url: "../../system/desktop/createShortcut",
        method: "POST",
        data: {
            stype: "folder",
            stext: targetFilename,
            spath: targetFolder,
            sicon: "img/system/folder-shortcut.png",
            sdest: "user:/Desktop/",
        },
        success: function(data){
            if (data.error !== undefined){
                console.log("[File Manager] Shortcut creation failed: ", data.error)
                msgbox("red remove",applocale.getString("opr/shortcut/error", "Shortcut creation failed. See console for more information.") , 3000);
            }else{
                msgbox("checkmark", applocale.getString("opr/shortcut/ok", "Shortcut created successfully"),  3000);
                if (ao_module_virtualDesktop){
                    parent.refresh();
                }
            }
        }
    })
}

//Create a new file
function newfile(){
    $(".popup:visible ").transition('slide left out');
    showPopupWrapper();
    $("#newFile").transition('slide left in');
    $("#newFile").find(".duplicateWarning").hide();
    $("#createNewFileName").parent().removeClass("error");
    //Update the newfile list
    $("#newFile").find(".newfilelist").html("");
    requestCSRFToken(function(token){
        $.ajax({
            url: "../../system/file_system/newItem",
            data: {csrft: token},
            success: function(data){
                if (data.error !== undefined){
                    return;
                }
                for (var i =0; i < data.length; i++){
                    var desc = data[i].Desc;
                    var ext = data[i].Ext;
                    var icon = ao_module_utils.getIconFromExt(ext);
                    $("#newFile").find(".newfilelist").append(`<div class="item newFileFormat" ext="${ext}"><i class="${icon} icon" style="margin-right:12px;"></i> ${desc}</div>`);
                }
                //Initialize the new file as txt
                var filename = "newfile";
                var finalFilename = filename; 
                var i = 0;
                while (currentFilelist.includes(finalFilename)){
                    finalFilename = finalFilename + "(" + i + ")";
                    i++;
                }  
                $("#createNewFileName").val(finalFilename + ".txt");

                //Hook events for on click
                $(".newFileFormat").off("click").on("click",function(data){
                    $(".newFileFormat").removeClass("selected");
                    $(this).addClass("selected");

                    //Parse the newfilename
                    var selectedExt = $(this).attr("ext");
                    var filename = "newfile";
                    var finalFilename = filename; 
                    var i = 0;
                    while (currentFilelist.includes(finalFilename)){
                        finalFilename = finalFilename + "(" + i + ")";
                        i++;
                    }  
                    $("#createNewFileName").val(filename + "." + selectedExt);
                });
            }
        });
    });
}

function newFolder(confirmed = false){
    if (confirmed == false){
        //Launch the dialog for newFolder
        hideAllPopupWindows();
        $("#createNewFolder").val("");
        $("#createNewFolder").parent().removeClass("error").removeClass("success");
        $("#newFolder").find(".duplicateWarning").hide();
        showPopupWrapper();
        $("#newFolder").transition("slide left in");
    }else{
        //Create new folder
        var newFoldername = $("#createNewFolder").val().trim();
        if (newFoldername == ""){
            $("#createNewFolder").parent().addClass("error");
            return;
        }

        //Check for invalid characters
        if (filenameContainsIllegalCharacters(newFoldername)){
            $("#createNewFolder").parent().addClass("error");
            msgbox("red remove", applocale.getString("message/illegalCharacters", "Folder name contains illegal characters"));
            return;
        }

        if (currentFilelist.includes(newFoldername)){
            //Current filelist already contain a folder with the same name
            $("#createNewFolder").parent().addClass("error");
            $("#newFolder").find(".duplicateWarning").show();
            return;
        }
        //OK to proceed.
        $("#createNewFolder").parent().removeClass("error").addClass("success");
        $("#newFolder").find(".duplicateWarning").hide();
        requestCSRFToken(function(token){
            $.ajax({
                url: "../../system/file_system/newItem",
                data: {type: "folder", src: currentPath, filename: newFoldername, csrft: token},
                success: function(data){
                    if (data.error !== undefined){
                        msgbox("red remove",applocale.getString("message/" + data.error,data.error));
                    }else{
                        msgbox("checkmark",applocale.getString("message/newfolder/success", "New folder created."));
                        refreshList();
                    }
                    $("#newFolder").fadeOut('fast');
                    hideAllPopupWindows();
                    if (currentPath == "user:/"){
                        //Reload the User root folder list
                        initRootDirs();
                    }
                }
            });
        });
        
    }
}


function confirmNewFile(){
    var filename = $("#createNewFileName").val();
    if (filename == ""){
        //Filename not set
        $("#createNewFileName").parent().addClass("error");
        return;
    }
    
    //Check for illegal characters
    if (filenameContainsIllegalCharacters(filename)){
        $("#createNewFileName").parent().addClass("error");
        msgbox("red remove", applocale.getString("message/illegalCharacters", "Filename contains illegal characters"));
        return;
    }
    
    if(currentFilelist.includes(filename)){
        //File with this name already exists
        $("#createNewFileName").parent().addClass("error");
        $("#newFile").find(".duplicateWarning").show();
        return;
    }
    $("#createNewFileName").parent().removeClass("error");
    //Ok to proceed
    requestCSRFToken(function(token){
        $.ajax({
            url: "../../system/file_system/newItem",
            data: {type: "file", src: currentPath, filename:filename,csrft: token},
            success: function(data){
                if (data.error !== undefined){
                    msgbox("red remove",applocale.getString("message/" + data.error,data.error));
                }else{
                    msgbox("checkmark",filename + applocale.getString("message/newItem/success", " created."));
                    refreshList();
                }
            }
        });
    });
    
    hideAllPopupWindows();
    $("#newFile").fadeOut('fast');
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.confirmNewFile = confirmNewFile;
window.createDesktopShortcut = createDesktopShortcut;
window.newFolder = newFolder;
window.newfile = newfile;
