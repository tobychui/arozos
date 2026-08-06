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
        var filesize = file.size;

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

        function updateProgressForWebSocketUpload(uuid, progress){
            $(".uploadTask").each(function(){
                if ($(this).attr("taskID") == uuid){
                    //Update this progress bar
                    $(this).find(".bar").css("width",progress + "%");
                    $(this).find(".progress.percentage").html(`<i class="ui upload icon"></i> ${progress.toFixed(1)}%`);
                    if (progress == 100){
                        //When progress = 100 and the server is not response with 200,
                        //That means the upload has finish and server is processing the upload
                        $(this).find(".progress").addClass("indicating");
                    }
                }
            });
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

        let socket = new WebSocket(protocol + window.location.hostname + ":" + port + "/system/file_system/lowmemUpload?filename=" + encodeURIComponent(filename) + "&path=" + encodeURIComponent(uploadDir) + hugeFileMode);
        let currentSendingIndex = 0;
        let chunks = Math.ceil(file.size/uploadFileChunkSize);

        // Per-chunk retry state
        let chunkRetryCount = 0;
        let chunkTimeoutTimer = null;

        // Running CRC32 state across all chunks for full-file checksum
        // Initialized to 0xFFFFFFFF (pre-conditioning), finalized with XOR at the end
        let runningCRC32State = 0xFFFFFFFF;
        // Track which chunk indices have already been factored into the running state
        // so that retries do not corrupt the full-file CRC32
        let chunkCRC32Committed = {};

        // Store file reference in retry map so the user can retry on failure
        uploadRetryMap.set(taskUUID, {file: file, targetDir: JSON.parse(JSON.stringify(uploadDir))});

        // Mark an upload task as failed and reveal the retry button
        function markUploadFailed(tUUID) {
            clearTimeout(chunkTimeoutTimer);
            $(".uploadTask").each(function(){
                if ($(this).attr("taskID") == tUUID){
                    $(this).find(".bar").css("width","100%");
                    $(this).find(".progress:not(.percentage)").attr("class","ui tiny error progress");
                    $(this).find(".uploadTaskRemoveIcon").show();
                    $(this).find(".uploadTaskRetryBtn").show();
                    $(this).addClass("ended");
                    $(this).find(".progress.percentage").hide();
                }
            });
        }

        // Send a specific chunk by index.
        // Reads the slice as ArrayBuffer, computes CRC32, sends metadata then binary.
        // Sets a CHUNK_TIMEOUT_MS timer; on expiry retries up to MAX_CHUNK_RETRIES times.
        async function sendChunk(id) {
            var offsetStart = id * uploadFileChunkSize;
            var offsetEnd   = id * uploadFileChunkSize + uploadFileChunkSize;
            var thisblob = file.slice(offsetStart, offsetEnd);

            let arrayBuffer;
            try {
                arrayBuffer = await thisblob.arrayBuffer();
            } catch(e) {
                console.error("[Upload] Failed to read chunk " + id + ": " + e);
                markUploadFailed(taskUUID);
                return;
            }

            let bytes = new Uint8Array(arrayBuffer);

            // Update the running full-file CRC32 only on the first attempt for each
            // chunk index so that retries do not double-count the bytes
            if (!chunkCRC32Committed[id]) {
                runningCRC32State = crc32UpdateState(runningCRC32State, bytes);
                chunkCRC32Committed[id] = true;
            }

            // Compute a standalone CRC32 for this chunk for transmission verification
            let chunkCRCHex = crc32Hex(bytes);

            // Protocol: text metadata frame, then binary data frame
            socket.send(JSON.stringify({index: id, checksum: chunkCRCHex}));
            socket.send(arrayBuffer);

            // Update progress (cap at 95% to leave room for the merge phase)
            var progress = chunks <= 1 ? 50 : (id / (chunks - 1) * 95.0);
            if (progress > 95) progress = 95;
            updateProgressForWebSocketUpload(taskUUID, progress);

            // (Re)start the per-chunk acknowledgement timeout
            clearTimeout(chunkTimeoutTimer);
            chunkTimeoutTimer = setTimeout(function() {
                if (chunkRetryCount < MAX_CHUNK_RETRIES) {
                    chunkRetryCount++;
                    console.warn("[Upload] Chunk " + id + " ACK timeout – retry " + chunkRetryCount + "/" + MAX_CHUNK_RETRIES);
                    sendChunk(id);
                } else {
                    console.error("[Upload] Chunk " + id + " failed after " + MAX_CHUNK_RETRIES + " retries");
                    markUploadFailed(taskUUID);
                    socket.close();
                }
            }, CHUNK_TIMEOUT_MS);
        }

        //Update all UI elements
        updateUploadFileCount();
        uploadingFileCount++;
        $(".uploadTask").each(function(){
            if ($(this).attr("taskID") == taskUUID){
                //This is the target upload task object. Hide its close button
                $(this).find(".uploadTaskRemoveIcon").hide();
                $(this).find(".uploadTaskRetryBtn").hide();
            }
        });

        //Start sending
        socket.onopen = async function(e) {
            if (filesize < uploadFileChunkSize){
                //This file is smaller than chunk size, set it to somewhere within 10% - 20% so it doesn't look like it is stuck
                updateProgressForWebSocketUpload(taskUUID, 10 + Math.floor(Math.random() * 10));
            }
            //Send the first chunk
            await sendChunk(0);
            currentSendingIndex = 1;
        };

        socket.onmessage = async function(event) {
            var incomingValue = event.data;

            if (incomingValue == "next"){
                // Server acknowledged the last chunk; clear timeout and reset retry counter
                clearTimeout(chunkTimeoutTimer);
                chunkRetryCount = 0;

                if (currentSendingIndex >= chunks){
                    // All chunks sent and acknowledged – send done + full-file checksum
                    let finalCRC32Hex = ((runningCRC32State ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0');
                    socket.send(JSON.stringify({done: true, totalChunks: chunks, fileChecksum: finalCRC32Hex}));
                }else{
                    //Send next chunk
                    await sendChunk(currentSendingIndex);
                    currentSendingIndex++;
                }

            }else if (incomingValue == "OK"){
                //Merge completed successfully
                uploadRetryMap.delete(taskUUID);
                $(".uploadTask").each(function(){
                    if ($(this).attr("taskID") == taskUUID){
                        //Update this progress bar to completed
                        $(this).find(".bar").css("width","100%");
                        $(this).find(".progress:not(.percentage)").attr("class", "ui tiny success progress");
                        $(this).find(".progress.percentage").hide();
                        $(this).find(".uploadTaskRemoveIcon").show();
                        $(this).find(".uploadTaskRetryBtn").hide();
                        $(this).addClass("ended");
                        $.when($(this).delay(1000).fadeOut("fast")).then(function(){
                            $(this).remove();
                            updateUploadFileCount();
                        });
                    }
                });
            }else{
                //Try to parse it as JSON
                try{
                    var resp = JSON.parse(incomingValue);
                    if (resp.error !== undefined){
                        //Server reported an error
                        msgbox("red remove", resp.error);
                        markUploadFailed(taskUUID);
                    }else if (resp.retryChunk !== undefined){
                        // Server detected a CRC32 mismatch and requests a chunk re-send
                        clearTimeout(chunkTimeoutTimer);
                        if (chunkRetryCount < MAX_CHUNK_RETRIES){
                            chunkRetryCount++;
                            console.warn("[Upload] Server requested retry for chunk " + resp.retryChunk + " (CRC32 mismatch) – retry " + chunkRetryCount + "/" + MAX_CHUNK_RETRIES);
                            await sendChunk(resp.retryChunk);
                        } else {
                            console.error("[Upload] Chunk " + resp.retryChunk + " CRC32 mismatch after max retries");
                            markUploadFailed(taskUUID);
                            socket.close();
                        }
                    }else if (resp.move !== undefined){
                        //File move from tmp to archive – show progress
                        $(".uploadTask").each(function(){
                            if ($(this).attr("taskID") == taskUUID){
                                $(this).find(".bar").css("width","100%");
                                $(this).find(".progress:not(.percentage)").attr("class","ui small indicating themed saving progress");
                                $(this).find(".progress.percentage").html(`<i class="ui save icon"></i> ${resp.move}`);
                            }
                        });
                    }
                }catch(ex){
                    //Something else
                    console.log(ex);
                }
            }

        };

        socket.onclose = function(event) {
            clearTimeout(chunkTimeoutTimer);
            uploadingFileCount--;
            updateUploadFileCount();
            //After the previous file has uploaded / errored, check if there are another file needed to be uploaded
            setTimeout(function(){
                if (uploadPendingList.length > 0){
                    let nextFile = uploadPendingList.shift();
                    uploadFile(nextFile.File, nextFile.UUID, nextFile.TargetDir);
                }
            }, 100)
        };

        socket.onerror = function(error) {
            console.error("[Upload] WebSocket error:", error);
            // Mark the task as failed and show the retry button
            markUploadFailed(taskUUID);
        };

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

        //Hide the cancel upload task button
        $(".uploadTask").each(function(){
            if ($(this).attr("taskID") == taskUUID){
                //This is the target upload task object. Hide its close button
                $(this).find(".uploadTaskRemoveIcon").hide();
            }
        });

        xhr.open('POST', url, true)
        xhr.upload.addEventListener("progress", function(e) {
            var progress = (e.loaded * 100.0 / e.total) || 100;
            $(".uploadTask").each(function(){
                if ($(this).attr("taskID") == taskUUID){
                    //Update this progress bar
                    $(this).find(".bar").css("width",progress + "%");
                    $(this).find(".progress.percentage").text(progress.toFixed(1) + "%");
                    if (progress == 100){
                        //When progress = 100 and the server is not response with 200,
                        //That means the upload has finish and server is processing the upload
                        $(this).find(".progress").addClass("active");
                        $(this).find(".progress.percentage").hide();

                    }
                }
            });
        })

        xhr.addEventListener('readystatechange', function(e) {
            if (xhr.readyState == 4 && xhr.status == 200) {
                //Upload process ended
                //Update task status
                $(".uploadTask").each(function(){
                    if ($(this).attr("taskID") == taskUUID){
                        //Update this progress bar to completed
                        $(this).find(".bar").css("width","100%");
                        $(this).find(".progress").attr("class", "ui tiny success progress");
                        $(this).find(".uploadTaskRemoveIcon").show();
                        $(this).addClass("ended");
                        //Update 15-11-2020
                        //Remove this taskbar after 1 second to prevent lags during > 2000 uploads
                        $.when($(this).delay(1000).fadeOut("fast")).then(function(){
                            $(this).remove();
                            updateUploadFileCount();
                        });
                        
                    }
                });

                var resp = JSON.parse(e.target.response);
                if (resp.error !== undefined){
                    msgbox("caution",resp.error);
                    //Something went wrong. Set the color to red
                    $(".uploadTask").each(function(){
                        if ($(this).attr("taskID") == taskUUID){
                            //Update this progress bar to completed
                            $(this).find(".bar").css("width","100%");
                            $(this).find(".progress").attr("class", "ui tiny error progress");
                            $(this).find(".uploadTaskRemoveIcon").show();
                            $(this).addClass("ended");
                        }
                    });
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
                msgbox("red remove",applocale.getString( "message/uploadFailed", "File too big or the target disk is fulled"));
                console.log(xhr);
                $(".uploadTask").each(function(){
                    if ($(this).attr("taskID") == taskUUID){
                        //Upload screwed up. Show error
                        $(this).find(".progress").attr("class","ui tiny error progress");
                        $(this).find(".uploadTaskRemoveIcon").show();
                        $(this).addClass("ended");
                    }
                });
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
