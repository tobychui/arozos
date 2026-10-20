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

/*
    Server errors that another attempt cannot fix. Everything else - a dropped
    WebSocket, a stalled or reset connection, a checksum mismatch, a write
    that failed mid-way - is worth one silent retry before the task is shown
    as failed, because on a poor network that is usually all it takes.
*/
var UPLOAD_FATAL_ERRORS = ["too large", "quota exceeded"];

function isRetryableUploadError(message){
    let lower = String(message).toLowerCase();
    for (var i = 0; i < UPLOAD_FATAL_ERRORS.length; i++){
        if (lower.indexOf(UPLOAD_FATAL_ERRORS[i]) >= 0){
            return false;
        }
    }
    return true;
}

//An upload ended one way or another: free its slot and start the next queued file
function releaseUploadSlot(){
    uploadingFileCount--;
    updateUploadFileCount();
    setTimeout(function(){
        if (uploadPendingList.length > 0){
            let nextFile = uploadPendingList.shift();
            uploadFile(nextFile.File, nextFile.UUID, nextFile.TargetDir, nextFile.Attempt);
        }
    }, 100);
}

/*
    Run a dropped large-file upload again after a short pause.

    The task keeps its concurrency slot while it waits, so the retry is not
    sent to the back of a long queue, and the row reads as pending rather
    than failed - the red bar and the retry button are for when this second
    attempt fails too. Cancelling the row during the wait frees the slot.
*/
function scheduleUploadAutoRetry(taskUUID, file, targetDir, attempt){
    console.warn("[Upload] Connection lost, retrying " + file.name + " (attempt " + (attempt + 1) + ")");
    resetUploadTaskProgress(taskUUID);
    setUploadTaskState(taskUUID, "pending");

    let timer = setTimeout(function(){
        unregisterUploadTransfer(taskUUID);
        //Hand the slot straight to the retry
        uploadingFileCount--;
        uploadFile(file, taskUUID, targetDir, attempt);
    }, UPLOAD_AUTO_RETRY_DELAY_MS);

    registerUploadTransfer(taskUUID, {
        pausable: false,
        abort: function(){
            clearTimeout(timer);
            releaseUploadSlot();
        }
    });
}

/*
    attempt counts the automatic retries already made for this task; it only
    matters to the low memory (WebSocket) mode. A retry from the row's button
    starts again at 0, so it gets its own silent retry as well.
*/
function uploadFile(file, uuid=undefined, targetDir=undefined, attempt=0) {
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
            //Queue the base directory; the Firefox subpath is added when it runs
            let uploadDir = currentPath;
            if (targetDir !== undefined){
                uploadDir = targetDir;
            }
            uploadPendingList.push({
                File: file,
                UUID: taskUUID,
                TargetDir: JSON.parse(JSON.stringify(uploadDir)),
                Attempt: attempt,
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

        /*
            Retry calls back into uploadFile with this as targetDir, so it must be
            the directory before the Firefox subpath below is appended - storing
            the final one makes a retry append the subpath a second time and
            upload into "<folder><folder>".
        */
        let retryDir = JSON.parse(JSON.stringify(uploadDir));

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
        uploadRetryMap.set(taskUUID, {file: file, targetDir: retryDir});

        let aborted = false;
        let completed = false;

        /*
            Whether this ending is worth an automatic retry. Every way a
            transfer ends passes through onClose, so the error callbacks only
            record what went wrong and onClose decides.
        */
        let failMessage = null;
        let retryable = true;
        let reported = false;

        //Show the task as failed for good - red bar and the retry button
        function markUploadFailed(tUUID) {
            if (aborted || reported) {
                return;
            }
            reported = true;
            unregisterUploadTransfer(tUUID);
            if (failMessage != null){
                msgbox("red remove", failMessage);
            }
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
                    failMessage = message;
                }
                if (!isRetryableUploadError(message)){
                    //Another attempt hits the same limit; say so right away
                    retryable = false;
                    markUploadFailed(taskUUID);
                }
            },
            onClose: function(event){
                unregisterUploadTransfer(taskUUID);

                if (completed || aborted || reported){
                    releaseUploadSlot();
                    return;
                }

                /*
                    Any close that is not the end of a finished upload and not the
                    user cancelling leaves the task stranded mid-transfer. The server
                    closes with uploadPauseCloseCode when a pause has been left
                    running for too long - the user stopped it, so that one is not
                    retried behind their back, and neither is a dropped connection
                    while paused. Anything else gets one more attempt before the
                    row offers retry rather than freezing at whatever percentage it
                    reached.
                */
                if (event.code == UPLOAD_PAUSE_TIMEOUT_CLOSE_CODE){
                    msgbox("caution", applocale.getString("upload/pauseExpired",
                        "Upload cancelled: paused for too long"));
                    retryable = false;
                }else if (transfer.isPaused()){
                    retryable = false;
                }

                if (retryable && attempt < UPLOAD_AUTO_RETRY_LIMIT){
                    //Keeps the slot until the retry takes it over
                    scheduleUploadAutoRetry(taskUUID, file, retryDir, attempt + 1);
                    return;
                }

                markUploadFailed(taskUUID);
                releaseUploadSlot();
            },
            onSocketError: function(error){
                //Always followed by onClose, which decides between retry and failure
                console.error("[Upload] WebSocket error:", error);
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
                Attempt: attempt,
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
                //After the previous file has uploaded / errored, check if there are another file needed to be uploaded
                releaseUploadSlot();
                
            }else if (xhr.readyState == 4 && xhr.status != 200) {
                unregisterUploadTransfer(taskUUID);
                if (!xhrAborted){
                    //An abort is the user's own doing - the row is already gone
                    msgbox("red remove",applocale.getString( "message/uploadFailed", "File too big or the target disk is fulled"));
                    console.log(xhr);
                    setUploadTaskState(taskUUID, "failed");
                }
                //After the previous file has uploaded / errored, check if there are another file needed to be uploaded
                releaseUploadSlot();
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
