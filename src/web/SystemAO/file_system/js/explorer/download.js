/*
    download.js

    Download selected files, zipping folders and multi-selections first.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

//Download the selected files.
function downloadFile(){
    var fileList = [];
    if ($(".fileObject.selected").length == 1 && $(".fileObject.selected").attr("type") == "file"){
        //One file. Download directly.
        var downloadURL = "../../media/download?file=" + encodeURIComponent($(".fileObject.selected").attr("filepath"));
        var filename = $(".fileObject.selected").attr("filename");
        generateDownloadFromURL(downloadURL,escape(filename));
    }else if ($(".fileObject.selected").length > 1 || ($(".fileObject.selected").length == 1 && $(".fileObject.selected").attr("type") == "folder")){
        //Do zip and download for multiple files
        $(".fileObject.selected").each(function(){
            fileList.push($(this).attr("filepath"));
        });
        console.log("Zipping: ", fileList);

        //Add a display for file compression
        var fileCount = $(".fileObject.selected").length;
        
        var displayString = applocale.getString("opr/zip/zipping", "Zipping ") + fileCount + applocale.getString("opr/zip/files", " files");
        if (fileCount == 1){
            //Use the filename as task name
            displayString = applocale.getString("opr/zip/zipping", "Zipping ") + $(".fileObject.selected").attr("filename");
        }

        var taskUUID = appendUploadFileItem(displayString, -1);
        $("#uploadTab").show();

        //Set the progress bar to intermediate mode
        let targetTaskDisplayObject =  getUploadTaskByID(taskUUID);
        targetTaskDisplayObject.find(".progress").addClass("preparing");

        //Zip the file or folder
        $.ajax({
            url: "../../system/file_system/zipHandler",
            data: {opr: "tmpzip", src: JSON.stringify(fileList), dest: ""},
            method: "POST",
            success: function(data){
                if (data.error !== undefined){
                    //Error
                    targetTaskDisplayObject.find(".progress").removeClass("preparing").removeClass("primary").addClass("error");
                    msgbox("red remove",applocale.getString("message/" + data.error,data.error));
                }else{
                    //Zip completed.
                    targetTaskDisplayObject.find(".progress").removeClass("preparing").removeClass("primary").addClass("positive");

                    //Open the zip file
                    window.open("../../media/download?file=" + data);
                }

                
                targetTaskDisplayObject.find(".bar").css("width", "100%");

                //Hide the taskbar after 5 secs
                setTimeout(function(){
                    //Fade out this task
                    $(targetTaskDisplayObject).fadeOut('fast',
                        function(){
                            $(this).remove();
                            if ($(".uploadTask").length == 0){
                                $("#uploadTab").hide();
                            }
                        }
                    );
                    
                }, 3000);
                
            }, 
            error: function(){
                targetTaskDisplayObject.find(".progress").removeClass("preparing").removeClass("primary").addClass("error");
                targetTaskDisplayObject.find(".bar").css("width", "100%");
                msgbox("red remove",applocale.getString("message/zip/fail", "Zipping failed due to unknown reason"));

                setTimeout(function(){
                    if ($(".uploadTask").length == 0){
                        $("#uploadTab").hide();
                    }
                }, 3000);
            }
        });
        
    }else{
        msgbox("red remove",applocale.getString("message/No file selected", "No file selected"));
        //alert("No file selected!")
    }
    
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.downloadFile = downloadFile;
