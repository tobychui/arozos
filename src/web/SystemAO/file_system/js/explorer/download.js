/*
    download.js

    Download selected files, zipping folders and multi-selections first.

    The zipping runs server side as a background file operation task, so this
    file starts it, follows its progress into the transfer panel by polling
    /system/file_system/ongoing, and hands the finished archive to the browser.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

//How often a running zip task is asked how far it has got, in ms
const ZIP_PROGRESS_POLL_INTERVAL = 1000;

/*
    How many polls in a row may come back without the task record before it is
    taken as finished.

    The server keeps a task record for a few seconds after it ends and only
    drops it once it has finished without error (fileOprFinishedRecordTTL in
    file_system.go), so a record that has gone missing is a completed one.
*/
const ZIP_PROGRESS_MAX_MISSES = 3;

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

        //The zip has no byte total to count towards, so the panel follows it as
        //a percentage instead - see setUploadTaskPercentage in uploadui.js
        var taskUUID = appendUploadFileItem(displayString, -1);
        setUploadTaskState(taskUUID, "processing");
        setUploadTaskPercentage(taskUUID, 0);

        //The name the archive is saved under, which is nicer than the
        //timestamp the server names its temporary file with
        var zipFilename = "download.zip";
        if (fileCount == 1){
            zipFilename = $(".fileObject.selected").attr("filename").split("/").pop() + ".zip";
        }

        //Zip the file or folder in the background
        $.ajax({
            url: "../../system/file_system/zipHandler",
            data: {opr: "tmpzipAsync", src: JSON.stringify(fileList), dest: ""},
            method: "POST",
            success: function(data){
                if (data.error !== undefined){
                    //Error
                    setUploadTaskState(taskUUID, "failed");
                    msgbox("red remove",applocale.getString("message/" + data.error,data.error));
                }else{
                    followZipDownloadTask(taskUUID, data.oprid, data.dest, zipFilename);
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
    Follow a server side zip task until it ends.

    The task record carries the progress of the whole operation, so one poll a
    second is enough to keep the row moving; the row's cancel button stops the
    archive on the server rather than only hiding the row.
*/
function followZipDownloadTask(taskUUID, oprid, vzipPath, zipFilename){
    var misses = 0;
    var timer = setInterval(function(){
        $.ajax({
            url: "../../system/file_system/ongoing",
            data: {all: "true"},
            success: function(data){
                if (!Array.isArray(data)){
                    //Session lost, or the endpoint refused: there is nothing to
                    //read here, but the zip itself may still be running
                    return;
                }

                var task = null;
                for (var i = 0; i < data.length; i++){
                    if (data[i].ID == oprid){
                        task = data[i];
                        break;
                    }
                }

                if (task == null){
                    misses++;
                    if (misses >= ZIP_PROGRESS_MAX_MISSES){
                        stopFollowing();
                        completeZipDownloadTask(taskUUID, vzipPath, zipFilename);
                    }
                    return;
                }

                misses = 0;
                if (task.Status == "completed"){
                    stopFollowing();
                    completeZipDownloadTask(taskUUID, vzipPath, zipFilename);
                }else if (task.Status == "error"){
                    stopFollowing();
                    setUploadTaskState(taskUUID, "failed");
                    msgbox("red remove", task.Error != "" ? task.Error :
                        applocale.getString("message/zip/fail", "Zipping failed due to unknown reason"));
                }else if (task.Status == "cancelled"){
                    //Cancelled from elsewhere - the file operation dialog also
                    //lists this task and can stop it
                    stopFollowing();
                    cancelUploadTask(taskUUID);
                }else{
                    setUploadTaskPercentage(taskUUID, task.Progress);
                }
            }
            //A failed poll is deliberately not a failed zip: the next one runs
        });
    }, ZIP_PROGRESS_POLL_INTERVAL);

    function stopFollowing(){
        clearInterval(timer);
        unregisterUploadTransfer(taskUUID);
    }

    //Makes the row's cancel button stop the zipping instead of just dropping
    //the row while the server carries on packing
    registerUploadTransfer(taskUUID, {
        abort: function(){
            clearInterval(timer);
            $.get("../../system/file_system/ongoing", {flag: "cancel", oprid: oprid});
        }
    });
}

/*
    Hand the finished archive to the browser.

    The download is also left on the row as a link: this click is not one the
    user made, so a browser that blocks automatic downloads will drop it, and
    the link is then the way to get the file.
*/
function completeZipDownloadTask(taskUUID, vzipPath, zipFilename){
    var downloadURL = "../../media/download?file=" + encodeURIComponent(vzipPath);
    setUploadTaskState(taskUUID, "done");
    setUploadTaskDoneLink(taskUUID, applocale.getString("upload/downloadAgain", "Download again"),
        downloadURL, zipFilename);
    generateDownloadFromURL(downloadURL, zipFilename);
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.downloadFile = downloadFile;
