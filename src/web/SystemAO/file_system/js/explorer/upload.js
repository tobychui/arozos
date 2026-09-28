/*
    upload.js

    File upload: chunked low-memory WebSocket mode and standard XHR POST mode.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

function upload(){
    var input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = e => { 
        var files = e.target.files; 
        msgbox("upload",applocale.getString("message/upload/started", "Upload Started"));
        for (var i = 0; i < files.length; i++){
            uploadFile(files[i]);
        }
    }
    input.click();
}

function initUploadMode(){
    //Get the avaible space on tmp disk and decide the cutoff file size that need to directly write to disk
    $.ajax({
        url: "../../system/disk/space/tmp",
        method: "POST",
        data: {},
        success: function(data){
            if (data.error !== undefined){
                console.log("[File Explorer] Unable to auto-detect huge file cutoff size: " + data.error);
            }else{
                if (!isNaN(data.Available) && data.Available > 0){
                    largeFileCutoffSize = data.Available/16 - 4096;
                    console.log("[File Explorer] Setting huge file cutoff size at: " + ao_module_utils.formatBytes(data.Available/16));
                }else if (isNaN(data.Available)){
                    console.log("[File Explorer] Unable to read available tmp disk size. Using default huge file cutoff size.");
                }
                
            }
        },
        error: function(){
            //Hardware mode disabled. Use default value.
        }
    });
}

function uploadFile(file, uuid=undefined, targetDir=undefined) {
    if (file.size > postUploadModeCutoff && lowMemoryMode){
        /*
            Low Memory Upload Mode
        */
        var filename = encodeURIComponent(file.name);

        //Generate a new file item
        let taskUUID = uuid;    //For queueing objects
        if (taskUUID == undefined){
            //If this is a new file to be uploaded
            taskUUID = appendUploadFileItem(file.name, file.size);
            setTimeout(function(){
                updateUploadFileCount();
            }, 100);
        }

        //Push to upload pending list if the max concurrent upload is reached
        if (uploadingFileCount >= maxConcurrentUpload){
            let uploadDir = currentPath;
            if (targetDir !== undefined){
                uploadDir = targetDir;
            }else if (isFirefox && uploadDir == currentPath && file.webkitRelativePath != ""){
                uploadDir = targetDir;
            }
            uploadPendingList.push({
                File: file,
                UUID: taskUUID,
                TargetDir: JSON.parse(JSON.stringify(uploadDir)),
            });
            return
        }

        //Open the websocket
        let path = currentPath;
        let protocol = "wss://";
        if (location.protocol !== 'https:') {
            protocol = "ws://";
        }

        var port = window.location.port;
        if (window.location.port == ""){
            if (location.protocol !== 'https:') {
                port = "80";
            }else{
                port = "443";
            }
        }

        let uploadDir = currentPath;
        if (targetDir !== undefined){
            //Not uploading to current directory. Change upload path to target
            uploadDir = targetDir;
        }

        //Fixing Firefox path issues on or above FF48.0
        if (isFirefox && file.webkitRelativePath != ""){
            //Use the webkitRelativePath instead of the name, this is a folder upload
            let pathinfo = file.webkitRelativePath.split("/");
            pathinfo.pop();
            let subpath = pathinfo.join("/");
            uploadDir = uploadDir + subpath;
        }

        let hugeFileMode = "";
        if (file.size > largeFileCutoffSize){
            //Filesize over cutoff line. Use huge file mode
            hugeFileMode = "&hugefile=true";
        }

        // Store file reference in retry map so the user can retry on failure
        uploadRetryMap.set(taskUUID, {file: file, targetDir: JSON.parse(JSON.stringify(uploadDir))});

        let aborted = false;
        let completed = false;

        // Mark an upload task as failed and reveal the retry button
        function markUploadFailed(tUUID) {
            if (aborted) {
                return;
            }
            unregisterUploadTransfer(tUUID);
            setUploadTaskState(tUUID, "failed");
        }

        /*
            The chunking, pipelining, checksums, retries and the pause
            keep-alive all live in script/chunkupload.js, shared with the
            desktop. This side only maps its events onto the transfer panel.
        */
        let transfer = ChunkUpload.start({
            url: protocol + window.location.hostname + ":" + port + "/system/file_system/lowmemUpload?filename=" + encodeURIComponent(filename) + "&path=" + encodeURIComponent(uploadDir) + hugeFileMode,
            file: file,
            chunkSize: uploadFileChunkSize,
            windowSize: uploadWindowSize,
            ackTimeout: CHUNK_TIMEOUT_MS,
            maxRetries: MAX_CHUNK_RETRIES,
            pingInterval: UPLOAD_PAUSE_PING_MS,
            onProgress: function(loaded, total){
                setUploadTaskProgress(taskUUID, loaded, total);
            },
            onProcessing: function(){
                setUploadTaskState(taskUUID, "processing");
            },
            onMove: function(status){
                //File move from tmp to archive – show progress
                setUploadTaskState(taskUUID, "processing");
                setUploadTaskStatusText(taskUUID, status);
            },
            onDone: function(){
                //Merge completed successfully
                uploadRetryMap.delete(taskUUID);
                unregisterUploadTransfer(taskUUID);
                completed = true;
                setUploadTaskState(taskUUID, "done");
            },
            onError: function(message, fromServer){
                if (fromServer){
                    msgbox("red remove", message);
                }
                markUploadFailed(taskUUID);
            },
            onClose: function(event){
                unregisterUploadTransfer(taskUUID);

                /*
                    Any close that is not the end of a finished upload and not the
                    user cancelling leaves the task stranded mid-transfer, so offer
                    retry rather than a row frozen at whatever percentage it reached.
                    The server closes with uploadPauseCloseCode when a pause has been
                    left running for too long, which is the case worth naming.
                */
                if (!completed && !aborted){
                    if (event.code == UPLOAD_PAUSE_TIMEOUT_CLOSE_CODE){
                        msgbox("caution", applocale.getString("upload/pauseExpired",
                            "Upload cancelled: paused for too long"));
                    }
                    setUploadTaskState(taskUUID, "failed");
                }

                uploadingFileCount--;
                updateUploadFileCount();
                //After the previous file has uploaded / errored, check if there are another file needed to be uploaded
                setTimeout(function(){
                    if (uploadPendingList.length > 0){
                        let nextFile = uploadPendingList.shift();
                        uploadFile(nextFile.File, nextFile.UUID, nextFile.TargetDir);
                    }
                }, 100)
            },
            onSocketError: function(error){
                console.error("[Upload] WebSocket error:", error);
                // Mark the task as failed and show the retry button
                markUploadFailed(taskUUID);
            }
        });

        registerUploadTransfer(taskUUID, {
            pausable: true,
            pause: function(){
                transfer.pause();
            },
            resume: function(){
                transfer.resume();
            },
            abort: function(){
                aborted = true;
                transfer.abort();
            }
        });

        //Update all UI elements
        updateUploadFileCount();
        uploadingFileCount++;

    }else{
        /*
            Standard Upload Mode
        */

        //Create the task progress Object
        let taskUUID = uuid;    //For queueing objects
        if (taskUUID == undefined){
            //If this is a new file to be uploaded
            taskUUID = appendUploadFileItem(file.name, file.size);
            setTimeout(function(){
                updateUploadFileCount();
            }, 100);
        }

        //TODO: Make the upload management interface a bit better
        //return;
        
        //Updates 22-10-2020
        //Added file upload queuing system to prevent too many request on-the-fly at the same time
        if (uploadingFileCount >= maxConcurrentUpload){
            //Push to upload pending list
            //Sometime files will be recursively uploaded (aka retry multiple time), hence the targetDir needed to be copied as well
            let uploadDir = currentPath;
            if (targetDir !== undefined){
                uploadDir = targetDir;
            }
            uploadPendingList.push({
                File: file,
                UUID: taskUUID,
                TargetDir: JSON.parse(JSON.stringify(uploadDir)),
            });
            return
        }

        //Prase upload Form
        let uploadCurrentPath = JSON.parse(JSON.stringify(currentPath));
        if (targetDir !== undefined){
            //The upload paramter supplied targetDir
            uploadCurrentPath = targetDir;
        }
        let url = '../../system/file_system/upload?path=' + encodeURIComponent(uploadCurrentPath)
        let formData = new FormData()
        let xhr = new XMLHttpRequest()
        formData.append('file', file);
        formData.append('path', uploadCurrentPath);

        //Let the user retry this task if it fails
        uploadRetryMap.set(taskUUID, {file: file, targetDir: JSON.parse(JSON.stringify(uploadCurrentPath))});

        /*
            A POST body cannot be suspended once it is in flight, so this mode
            offers cancel rather than pause. pausable:false is what makes the
            row draw a cancel button instead of a pause button.
        */
        let xhrAborted = false;
        registerUploadTransfer(taskUUID, {
            pausable: false,
            abort: function(){
                xhrAborted = true;
                xhr.abort();
            }
        });

        xhr.open('POST', url, true)
        xhr.upload.addEventListener("progress", function(e) {
            setUploadTaskProgress(taskUUID, e.loaded, e.total);
            if (e.total > 0 && e.loaded >= e.total){
                //Bytes are all sent but the server has not answered yet - it is
                //still writing the file out
                setUploadTaskState(taskUUID, "processing");
            }
        })

        xhr.addEventListener('readystatechange', function(e) {
            if (xhr.readyState == 4 && xhr.status == 200) {
                //Upload process ended
                unregisterUploadTransfer(taskUUID);
                setUploadTaskState(taskUUID, "done");

                var resp = JSON.parse(e.target.response);
                if (resp.error !== undefined){
                    msgbox("caution",resp.error);
                    //Something went wrong. Set the color to red
                    setUploadTaskState(taskUUID, "failed");
                }else{
                    uploadRetryMap.delete(taskUUID);
                }
                uploadingFileCount--;

                //After the previous file has uploaded / errored, check if there are another file needed to be uploaded
                setTimeout(function(){
                    if (uploadPendingList.length > 0){
                        let nextFile = uploadPendingList.shift();
                        uploadFile(nextFile.File, nextFile.UUID, nextFile.TargetDir);
                    }
                }, 100)
                
            }else if (xhr.readyState == 4 && xhr.status != 200) {
                unregisterUploadTransfer(taskUUID);
                if (!xhrAborted){
                    //An abort is the user's own doing - the row is already gone
                    msgbox("red remove",applocale.getString( "message/uploadFailed", "File too big or the target disk is fulled"));
                    console.log(xhr);
                    setUploadTaskState(taskUUID, "failed");
                }
                uploadingFileCount--;

                //After the previous file has uploaded / errored, check if there are another file needed to be uploaded
                setTimeout(function(){
                    if (uploadPendingList.length > 0){
                        let nextFile = uploadPendingList.shift();
                        uploadFile(nextFile.File, nextFile.UUID, nextFile.TargetDir);
                    }
                }, 100)
            }

        

            updateUploadFileCount();
        })

        xhr.send(formData);
        uploadingFileCount++;
        updateUploadFileCount();
    }
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.upload = upload;
