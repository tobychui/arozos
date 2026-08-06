/*
    uploadui.js

    Upload task list rendering inside #uploadTab.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

function getUploadTaskByID(taskUUID){
    var task = undefined;
    $("#uploadTab").find(".uploadTask").each(function(){
        if ($(this).attr("taskid") == taskUUID){
            task = $(this);
        }
    });

    return task;
}

function appendUploadFileItem(filename, filesize){
    var newuuid = uuidv4();
    var humanReadableFilesize = 0;
    if (filesize < 0){
        humanReadableFilesize = applocale.getString("message/unknownSize", "Unknown Size")
    }else{
        humanReadableFilesize = bytesToSize(filesize);
    }
    
    $("#uploadProgressList").append(`<div class="uploadTask" taskID="${newuuid}">
        <p style="width: calc(100% - 15px);">${filename} (${humanReadableFilesize})</p>
        <div class="ui small themed progress" style="margin-top:-12px;">
            <div class="bar" style="width: 0%; min-width: 0px;">
                <div class="progress percentage"></div>
            </div>
        </div>
        <div class="uploadTaskRetryBtn" onclick="retryUploadFile('${newuuid}');" style="display:none; cursor:pointer; float:left; margin-right:4px;" title="Retry upload">
            <i class="redo icon"></i>
        </div>
        <div class="uploadTaskRemoveIcon" onclick="removeThisTask(this, '${newuuid}');" style="">
            <i class="remove icon"></i>
        </div>
    </div>`);
    return newuuid;
}

function retryUploadFile(taskUUID){
    let retryInfo = uploadRetryMap.get(taskUUID);
    if (!retryInfo){
        console.warn("[Upload] No retry info found for task " + taskUUID);
        return;
    }
    // Reset the task UI back to pending state
    $(".uploadTask").each(function(){
        if ($(this).attr("taskID") == taskUUID){
            $(this).removeClass("ended");
            $(this).find(".bar").css("width","0%");
            $(this).find(".progress:not(.percentage)").attr("class","ui small themed progress");
            $(this).find(".progress.percentage").text("").show();
            $(this).find(".uploadTaskRetryBtn").hide();
            $(this).find(".uploadTaskRemoveIcon").hide();
        }
    });
    // Re-queue the file for upload using the same task UUID
    uploadFile(retryInfo.file, taskUUID, retryInfo.targetDir);
}

function removeThisTask(object, taskUUID){
    //Remove item from uploadPendingList
    let removeId = -1;
    for (var i = 0; i < uploadPendingList.length; i++){
        if (uploadPendingList[i].UUID == taskUUID){
            removeId = i;
            break;
        }
    }

    if (removeId >= 0){
        uploadPendingList.splice(removeId, 1);
    }

    //Remove the DOM Element
    $(object).parent().fadeOut('fast',
        function(){
            $(this).remove();
            updateUploadFileCount();
        }
    );
    
}

function toggleUploadList(){
    $("#uploadProgressList").toggle();
    if ($("#uploadProgressList").is(":visible")){
        $(".hideUploadButton").html('<i class="caret down icon"></i>');
    }else{
        $(".hideUploadButton").html('<i class="caret up icon"></i>');
    }
}

function updateUploadFileCount(){
    $("#uploadCount").text(uploadingFileCount);
    $("#waitingCount").text(uploadPendingList.length);
    if (uploadingFileCount == 0 && $(".uploadTask").length == 0){
        $("#uploadTab").hide();
    }else{
        $("#uploadTab").show();
    }
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.removeThisTask = removeThisTask;
window.retryUploadFile = retryUploadFile;
window.toggleUploadList = toggleUploadList;
