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

        //The zip size is not known until the server has built it, so this task
        //rides the transfer panel in its indeterminate state
        var taskUUID = appendUploadFileItem(displayString, -1);
        setUploadTaskState(taskUUID, "processing");

        //Zip the file or folder
        $.ajax({
            url: "../../system/file_system/zipHandler",
            data: {opr: "tmpzip", src: JSON.stringify(fileList), dest: ""},
            method: "POST",
            success: function(data){
                if (data.error !== undefined){
                    //Error
                    setUploadTaskState(taskUUID, "failed");
                    msgbox("red remove",applocale.getString("message/" + data.error,data.error));
                }else{
                    //Zip completed.
                    setUploadTaskState(taskUUID, "done");

                    //Open the zip file
                    window.open("../../media/download?file=" + data);
                }
            },
            error: function(){
                setUploadTaskState(taskUUID, "failed");
                msgbox("red remove",applocale.getString("message/zip/fail", "Zipping failed due to unknown reason"));
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
