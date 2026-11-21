/*
    ArozOS Desktop - Upload

    Uploading files from the local computer to the desktop: POST, chunked
    WebSocket and large file modes.

    Part of desktop.html, see README.md in this folder for the load order.
*/

function initUploadCuttoffValues(){
     //Get the avaible space on tmp disk and decide the cutoff file size that need to directly write to disk
    $.ajax({
        url: "system/disk/space/tmp",
        method: "POST",
        data: {},
        success: function(data){
            if (data.error !== undefined){
                console.log("%c[Desktop] Unable to auto-detect huge file cutoff size: " + data.error, 'color: #e64747');
            }else{
                if (!isNaN(data.Available) && data.Available > 0){
                    largeFileCutoffSize = data.Available/16 - 4096;
                    console.log("%c[Desktop] Setting huge file cutoff size at: " + ao_module_utils.formatBytes(data.Available/16), 'color: #036ffc');
                }else if (isNaN(data.Available)){
                    console.log("%c[Desktop] Unable to read available tmp disk size. Using default huge file cutoff size.", 'color: #e64747');
                }

            }
        },
        error: function(){
            //Hardware mode disabled. Use default value.
        }
    });
}

//Check if this server is a low memory one
function initUploadMode(){
    $.ajax({
        url: "system/info/getRAMinfo",
        success: function(data){
            if (data.error !== undefined){
                //Permission denied or other reasons that cannot access harwdare info. Use default mode
                lowMemoryMode = true;
            }else{
                //Check if ramsize > 3.8 GB (4GB). If yes, switch to large memory upload mode
                var memsize = JSON.parse(data);
                if (parseFloat(memsize)/ 1024 / 1024 / 1024 >= 3.8){
                    console.log("%c[Desktop] Setting upload mode to large memory mode", 'color: #036ffc');
                    lowMemoryMode = false;
                }
            }
        },
        error: function(){
            //Hardware mode disabled. Always use low memory upload mode instead
            lowMemoryMode = true;
        }
    });
}

//Generate a loading icon for this upload task
function generateUploadingIcon(filename, position){
    //Get position for appending
    var onScreenLocation = getLocationFromGridIndex(position[0], position[1]);
    //Append to UI
    var uploadIconUUID = Date.now();
    $("#iconwrapper").append(`<div href="javascript:void(0);" class="${uploadIconUUID} launchIcon" type="dummy" filename="${filename}" filepath="user:/Desktop/${filename}"  style="width:70px; height:106px;left:${onScreenLocation[0]}px; top:${onScreenLocation[1]}px;">
        <span class="launchIconWrapper">
            <img class="launchIconImage medium" src="img/desktop/files_icon/${desktopIconPack}/file upload.png" draggable="false">
            <p class="launchIconText ${desktopIconSize}" >${applocale.getString( "upload/message/uploading", "Uploading")}</p>
            <div class="ui tiny primary progress" style="margin-top: -4px;">
                <div class="bar" style="min-width: 0px !important; width: 0%;"></div>
            </div>
        </span>
    </div>`);
    return uploadIconUUID;
}

function upload(){
    var input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = e => { 
        var files = e.target.files; 
        for (var i = 0; i < files.length; i++){
            uploadFile(files[i], function(){
                refresh(undefined, true);
            });
        }
    }
    input.click();
    hideAllContextMenus();
}

function uploadFile(file, callback=undefined, uploadingIconUUID = undefined) {
    if (file.size > postUploadModeCutoff && lowMemoryMode){
        /*
            Low Memory Upload Mode
        */
        var filename = encodeURIComponent(file.name);
        var filesize = file.size;

        //Open the websocket
        let path = "user:/Desktop";
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

        let uploadDir = "user:/Desktop";

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


        //Chunking, pipelining, checksums and retries live in
        //script/chunkupload.js, shared with the File Manager
        let uploadIcon = function(){
            return $("." + uploadingIconUUID + ".launchIcon");
        };
        let showUploadFailed = function(){
            uploadIcon().find(".progress").removeClass("primary").addClass("error");
            uploadIcon().find(".launchIconText").text(applocale.getString("upload/message/failed", "Failed!"));
            setTimeout(function(){
                uploadIcon().fadeOut(3000, function() { $(this).remove(); });
            }, 2000);
        };

        ChunkUpload.start({
            url: protocol + window.location.hostname + ":" + port + "/system/file_system/lowmemUpload?filename=" + filename + "&path=" + encodeURIComponent(uploadDir) + hugeFileMode,
            file: file,
            chunkSize: uploadFileChunkSize,
            windowSize: uploadWindowSize,
            ackTimeout: CHUNK_TIMEOUT_MS,
            maxRetries: MAX_CHUNK_RETRIES,
            onProgress: function(loaded, total){
                //Cap at 95% to reserve room for the server side merge
                if (uploadingIconUUID == undefined){
                    return;
                }
                let progress = Math.min(95, loaded / total * 95.0);
                uploadIcon().find(".bar").css("width", progress + "%");
                if (progress >= 95){
                    uploadIcon().find(".progress").addClass("indeterminate");
                }
            },
            onMove: function(){
                // Server is moving file from tmp to destination
                if (uploadingIconUUID != undefined){
                    uploadIcon().find(".bar").css("width", "100%");
                }
            },
            onError: function(message, fromServer){
                if (fromServer){
                    sendNotification("Upload Failed", message, "remove");
                    showUploadFailed();
                }
            },
            onClose: function(){
                //Merge completed or failed - either way the icon goes
                $("." + uploadingIconUUID).remove();
                if (callback != undefined){
                    callback();
                }
            },
            onSocketError: function(error){
                console.error("[Desktop Upload] WebSocket error:", error);
                showUploadFailed();
            }
        });
    }else{
        let url = 'system/file_system/upload'
        let uploadCurrentPath = "user:/Desktop/";
        let formData = new FormData();
        let xhr = new XMLHttpRequest();
        formData.append('file', file);
        formData.append('path', uploadCurrentPath);

        xhr.open('POST', url, true)
        xhr.upload.addEventListener("progress", function(e) {
            console.log((e.loaded * 100.0 / e.total) || 100)
            var progress = (e.loaded * 100.0 / e.total) || 100;
            if (uploadingIconUUID != undefined){
                //Update the progress on the object
                $("." + uploadingIconUUID + ".launchIcon").find(".bar").css("width", progress + "%");
                if (progress == 100){
                    $("." + uploadingIconUUID + ".launchIcon").find(".progress").addClass("indeterminate");
                }
            }
        })

        xhr.addEventListener('readystatechange', function(e) {
            if (xhr.readyState == 4 && xhr.status == 200) {
                //Upload Succ
                $("." + uploadingIconUUID).remove();
                if (callback !== undefined){
                    callback(e.target.response);
                }
            }
            else if (xhr.readyState == 4 && xhr.status != 200) {
                console.log("Upload failed :" + xhr.status);
                //Set upload progress bar to error
                $("." + uploadingIconUUID + ".launchIcon").find(".progress").removeClass("primary").addClass("error");
                $("." + uploadingIconUUID + ".launchIcon").find(".launchIconText").text(applocale.getString("upload/message/failed", "Failed!"));
                setTimeout(function(){
                    $("." + uploadingIconUUID + ".launchIcon").fadeOut(3000,function() { $(this).remove(); });
                }, 2000);
            }
        })
        xhr.send(formData);
    }
}
