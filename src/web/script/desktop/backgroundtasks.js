/*
    ArozOS Desktop - Background tasks

    The background task panel on the taskbar (pause, resume, cancel of
    file operations) and startFileOperation, which hands every move, copy,
    zip and unzip request to the single file operation dialog.

    Part of desktop.html, see README.md in this folder for the load order.
*/

function handleBackgroundTaskPauseToggle(oprid, btn=undefined, currentlyPaused=false){
    console.log(oprid, currentlyPaused);
    if (btn != undefined){
        $(btn).addClass("disabled");
        $(btn).html(`<i class="ui spinner loading icon"></i>`);
    }
    if (currentlyPaused){
        //Resume
        $.ajax({
            url: "system/file_system/ongoing",
            method: "POST",
            data: {"oprid": oprid, "flag": "continue"},
            success: function(data){
                if (data.error != undefined){
                    console.log(data.error);
                }
                updateBackgroundgTaskList();
            }
        });
    }else{
        //Pause
        $.ajax({
            url: "system/file_system/ongoing",
            method: "POST",
            data: {"oprid": oprid, "flag": "pause"},
            success: function(data){
                if (data.error != undefined){
                    console.log(data.error);
                }
                updateBackgroundgTaskList();
            }
        });
    }
}

function handleBackgroundTaskCancel(oprid, btn=undefined){
    $.ajax({
        url: "system/file_system/ongoing",
        method: "POST",
        data: {"oprid": oprid, "flag": "cancel"},
        success: function(data){
            if (data.error != undefined){
                console.log(data.error);
            }else{
                //Disable further operation untill task cancelled
                if (btn != undefined){
                    $(btn).addClass("disabled");
                    $(btn).html(`<i class="ui spinner loading icon"></i>`);
                }

            }
            updateBackgroundgTaskList();
        }
    });
}

/*
    System wide file operation dialog

    Only one file operation dialog is opened at a time. Every move, copy,
    zip and unzip request is handed over to the running dialog so the
    desktop never ends up with a stack of windows each holding their own
    status connection. See SystemAO/file_system/file_operation.html
*/
var fileOperationWindowUID = "arozFileOperationDialog";
function startFileOperation(oprConfig, retryCount=0){
    var fw = getFloatWindowByID(fileOperationWindowUID);
    if (fw != undefined && $(fw).length > 0){
        var dialogFrame = $(fw).find("iframe")[0];
        if (dialogFrame != undefined && dialogFrame.contentWindow != null &&
            typeof dialogFrame.contentWindow.addFileOperation == "function"){
            dialogFrame.contentWindow.addFileOperation(oprConfig);

            //Bring the dialog back into view in case it was minimized
            $(fw).fadeIn(100);
            MoveFloatWindowToTop(fw);
            return;
        }

        //The dialog window exists but its page is still loading. Wait for it.
        if (retryCount < 40){
            setTimeout(function(){
                startFileOperation(oprConfig, retryCount + 1);
            }, 250);
            return;
        }
    }

    newFloatWindow({
        uid: fileOperationWindowUID,
        url: "SystemAO/file_system/file_operation.html#" + encodeURIComponent(JSON.stringify(oprConfig)),
        width: 480,
        height: 430,
        appicon: "SystemAO/file_system/img/selector.png",
        title: applocale.getString("fileOperation/title", "File Operation")
    });
}

//The background task checking function will ping server side at a more
//frequent interval if there is a background task running
var rapidIntervalTaskListing = undefined;
function updateBackgroundgTaskList(){
    //Update background tasks
    $.get("system/file_system/ongoing", function(tasks){

        tasks.sort(function(a, b) { 
            return a.ID > b.ID;
        });

        //console.log(tasks);
        $("#backgroundTaskPanel").html("");
        tasks.forEach(function(task){
            console.log(task);
            var pausedClass = "";
            var pauseIcon = "pause";
            var cancelBtnDisabled = "";
            if (task.FileOperationSignal == 1){
                pausedClass = "paused";
                pauseIcon = "play";
            }else if (task.FileOperationSignal == 2){
                pausedClass = "stopping";
                cancelBtnDisabled = "disabled";
            }
            $("#backgroundTaskPanel").append(`<div class="backgroundtaskObject ${pausedClass}">
                <small>${centerTruncat(task.Src, 22, "...")} <i class="angle right icon"></i> ${centerTruncat(task.Dest, 22, "...")} (${centerTruncat(task.LatestFile, 30, "...")})</small>
                <div class="ui grid">
                    <div class="twelve wide column" style="padding-right: 0.4em; padding-bottom: 0.4em;">
                        <div class="ui mini active progress">
                            <div class="bar" style="width: ${task.Progress}%;">
                                <div class="progress">${task.Progress}%</div>
                            </div>
                        </div>
                    </div>
                    <div class="four wide column"  style="padding-top: 0.4em; padding-left: 0;  padding-bottom: 0.4em;" align="right">
                        <button class="circular ui mini basic icon ${cancelBtnDisabled} button" oprid="${task.ID}" onclick="handleBackgroundTaskPauseToggle('${task.ID}', this, ${task.FileOperationSignal==1});">
                            <i class="${pauseIcon} icon"></i>
                        </button>
                        <button class="circular ui mini basic red icon ${cancelBtnDisabled} button" oprid="${task.ID}" onclick="handleBackgroundTaskCancel('${task.ID}', this);">
                            <i class="remove icon" style="color: red !important;"></i>
                        </button>
                    </div>
                </div>
            </div>`);
        });

        if (tasks.length > 0){
            if (rapidIntervalTaskListing != undefined){
                clearTimeout(rapidIntervalTaskListing);
                rapidIntervalTaskListing = undefined;
            }
            rapidIntervalTaskListing = setTimeout(function(){
                updateBackgroundgTaskList();
            }, 1000);
            $("#backgroundtaskBtn").find("i").attr("class", "loading circle notch icon");
        }else{
            $("#backgroundTaskPanel").append(`<div class="ui basic segment" style="width: 100%;">
                <i class="ui checkmark icon"></i> ${applocale.getString("backgroundTasks/noTasks", "No running background tasks")}
                <a style="cursor: pointer; float: right; margin-top: 0.2em;" onclick="updateBackgroundgTaskList();">${applocale.getString("backgroundTasks/refresh", "Refresh")}</a>
            </div>`);
            $("#backgroundtaskBtn").find("i").attr("class", "circle notch icon");
        }

    });
}

function showBackgroundTaskPanel(){
    $("#backgroundTaskPanel").slideToggle("fast");
}
