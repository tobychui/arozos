/*
    ArozOS Desktop - Background tasks

    The background task panel of the tray: every file operation of this user
    that is still running, with its progress, pause / resume and cancel. A
    row or "Show details" opens the file operation dialog, which reads every
    operation of the user from the server, so it also brings the dialog back
    after the desktop was reloaded while a copy was still running
    (SystemAO/file_system/js/file_operation/dialog.js).

    Also startFileOperation, which hands every move, copy, zip and unzip
    request to that single dialog.

    Kept for other code: updateBackgroundgTaskList (sic), showBackgroundTaskPanel,
    hideBackgroundTaskPanel, startFileOperation, openFileOperationDialog and
    fileOperationWindowUID.

    Part of desktop.html, see README.md in this folder for the load order.
*/

/*
    System wide file operation dialog

    Only one file operation dialog is opened at a time. Every move, copy,
    zip and unzip request is handed over to the running dialog so the
    desktop never ends up with a stack of windows each holding their own
    status connection. See SystemAO/file_system/file_operation.html
*/
var fileOperationWindowUID = "arozFileOperationDialog";
var FILE_OPERATION_DIALOG_URL = "SystemAO/file_system/file_operation.html";

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
            backgroundTaskSoon();
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
        url: FILE_OPERATION_DIALOG_URL + "#" + encodeURIComponent(JSON.stringify(oprConfig)),
        width: 480,
        height: 430,
        appicon: "SystemAO/file_system/img/selector.png",
        title: applocale.getString("fileOperation/title", "File Operation")
    });
    backgroundTaskSoon();
}

//Show the file operation dialog with every running operation of this user:
//the open one comes to the front, otherwise a new one starts with no launch
//config and picks the operations up from the server
function openFileOperationDialog(){
    hideBackgroundTaskPanel();
    var fw = getFloatWindowByID(fileOperationWindowUID);
    if (fw != undefined && $(fw).length > 0){
        $(fw).fadeIn(100);
        MoveFloatWindowToTop(fw);
        if (typeof dockUpdateFocus == "function"){
            dockUpdateFocus();
        }
        return;
    }
    newFloatWindow({
        uid: fileOperationWindowUID,
        url: FILE_OPERATION_DIALOG_URL,
        width: 480,
        height: 430,
        appicon: "SystemAO/file_system/img/selector.png",
        title: applocale.getString("fileOperation/title", "File Operation")
    });
}

/*
    Task listing

    While something runs the list is fetched every second, which also keeps
    the tray icon spinning; with nothing running it is fetched when the panel
    opens and shortly after a new operation starts.
*/
var rapidIntervalTaskListing = undefined;
var backgroundTaskBusy = {}; //oprid -> true while a pause / resume / cancel is on its way

var BACKGROUND_TASK_ICONS = {
    "copy": "copy outline",
    "move": "cut",
    "zip": "file archive outline",
    "unzip": "folder open outline"
};

var BACKGROUND_TASK_VERBS = {
    "copy": ["backgroundTasks/op/copy", "Copying"],
    "move": ["backgroundTasks/op/move", "Moving"],
    "zip": ["backgroundTasks/op/zip", "Compressing"],
    "unzip": ["backgroundTasks/op/unzip", "Extracting"]
};

function updateBackgroundgTaskList(){
    $.get("system/file_system/ongoing", function(tasks){
        if (!Array.isArray(tasks)){
            //Signed out or an error message: show nothing running
            tasks = [];
        }
        tasks.sort(function(a, b){
            var byStart = (a.StartTime || 0) - (b.StartTime || 0);
            if (byStart != 0){
                return byStart;
            }
            return a.ID < b.ID ? -1 : (a.ID > b.ID ? 1 : 0);
        });
        renderBackgroundTasks(tasks);

        if (rapidIntervalTaskListing != undefined){
            clearTimeout(rapidIntervalTaskListing);
            rapidIntervalTaskListing = undefined;
        }
        if (tasks.length > 0){
            rapidIntervalTaskListing = setTimeout(function(){
                updateBackgroundgTaskList();
            }, 1000);
            //Spinning while something moves, a pause sign when all of it waits
            var moving = tasks.some(function(task){
                return backgroundTaskState(task) != "paused";
            });
            $("#backgroundtaskBtn").addClass("running").find("i").attr("class", moving ? "loading circle notch icon" : "pause circle outline icon");
        }else{
            $("#backgroundtaskBtn").removeClass("running").find("i").attr("class", "tasks icon");
        }
    });
}

//A new operation takes a moment to show up on the server
function backgroundTaskSoon(){
    setTimeout(updateBackgroundgTaskList, 1200);
}

function backgroundTaskName(path){
    path = String(path || "").replace(/\/+$/, "");
    var name = path.substring(path.lastIndexOf("/") + 1);
    if (name == ""){
        //A drive root such as "user:"
        return path;
    }
    return name;
}

//"running", "paused" or "stopping"
function backgroundTaskState(task){
    if (task.FileOperationSignal == 2){
        return "stopping";
    }
    if (task.FileOperationSignal == 1){
        return "paused";
    }
    return "running";
}

function renderBackgroundTasks(tasks){
    var list = $("#btList");
    $("#btShowDetails").toggle(tasks.length > 0);

    if (tasks.length == 0){
        backgroundTaskBusy = {};
        if (list.children(".btEmpty").length == 0){
            var empty = $('<div class="btEmpty"><i class="check circle outline icon"></i><span class="btEmptyText"></span><a class="btRefresh"></a></div>');
            empty.find(".btEmptyText").text(applocale.getString("backgroundTasks/noTasks", "No running background tasks"));
            empty.find(".btRefresh").text(applocale.getString("backgroundTasks/refresh", "Refresh"));
            list.empty().append(empty);
        }
        return;
    }

    list.children(".btEmpty").remove();
    var shown = {};
    tasks.forEach(function(task){
        var oprid = String(task.ID);
        shown[oprid] = true;
        var row = list.children(".btRow").filter(function(){
            return $(this).attr("data-oprid") == oprid;
        });
        if (row.length == 0){
            row = createBackgroundTaskRow(oprid);
            list.append(row);
        }
        updateBackgroundTaskRow(row, task);
    });
    //Operations that finished leave the list
    list.children(".btRow").each(function(){
        var oprid = $(this).attr("data-oprid");
        if (!shown[oprid]){
            delete backgroundTaskBusy[oprid];
            $(this).remove();
        }
    });
}

function createBackgroundTaskRow(oprid){
    var row = $('<div class="btRow" role="button">' +
        '<div class="btIcon"><i class="icon"></i></div>' +
        '<div class="btBody">' +
            '<div class="btHead"><span class="btName"></span><span class="btState"></span></div>' +
            '<div class="btPath"></div>' +
            '<div class="btBar"><div class="btFill"></div></div>' +
        '</div>' +
        '<div class="btActions">' +
            '<div class="btAction btPause" role="button"><i class="pause icon"></i></div>' +
            '<div class="btAction btCancel" role="button"><i class="close icon"></i></div>' +
        '</div>' +
    '</div>');
    row.attr("data-oprid", oprid);
    row.find(".btCancel").attr("title", applocale.getString("backgroundTasks/cancel", "Cancel"));
    return row;
}

function updateBackgroundTaskRow(row, task){
    var oprid = String(task.ID);
    var state = backgroundTaskState(task);
    var busy = backgroundTaskBusy[oprid] === true;
    var progress = Math.max(0, Math.min(100, Math.floor(parseFloat(task.Progress) || 0)));
    var opr = String(task.Operation || "").toLowerCase();

    var iconClass = (BACKGROUND_TASK_ICONS[opr] || "tasks") + " icon";
    var icon = row.find(".btIcon i");
    if (icon.attr("class") != iconClass){
        icon.attr("class", iconClass);
    }

    var verb = BACKGROUND_TASK_VERBS[opr];
    verb = verb ? applocale.getString(verb[0], verb[1]) : "";
    var file = task.LatestFile ? backgroundTaskName(task.LatestFile) : backgroundTaskName(task.Src);
    var name = (verb + " " + file).trim();
    var path = backgroundTaskName(task.Src) + "  →  " + backgroundTaskName(task.Dest);
    setBackgroundTaskText(row.find(".btName"), name);
    row.find(".btName").attr("title", name);
    setBackgroundTaskText(row.find(".btPath"), path);
    row.find(".btPath").attr("title", String(task.Src || "") + "  →  " + String(task.Dest || ""));

    var stateText = progress + "%";
    if (state == "paused"){
        stateText = applocale.getString("backgroundTasks/paused", "Paused");
    }else if (state == "stopping"){
        stateText = applocale.getString("backgroundTasks/stopping", "Stopping");
    }
    setBackgroundTaskText(row.find(".btState"), stateText);
    row.find(".btFill").css("width", progress + "%");

    row.toggleClass("paused", state == "paused");
    row.toggleClass("stopping", state == "stopping");
    row.toggleClass("busy", busy);

    var pauseBtn = row.find(".btPause");
    var pauseIcon = busy ? "circle notch loading icon" : (state == "paused" ? "play icon" : "pause icon");
    if (pauseBtn.find("i").attr("class") != pauseIcon){
        pauseBtn.find("i").attr("class", pauseIcon);
    }
    pauseBtn.attr("title", state == "paused" ?
        applocale.getString("backgroundTasks/resume", "Resume") :
        applocale.getString("backgroundTasks/pause", "Pause"));
    pauseBtn.attr("data-paused", state == "paused" ? "true" : "false");
    pauseBtn.toggleClass("disabled", busy || state == "stopping");
    row.find(".btCancel").toggleClass("disabled", busy || state == "stopping");
}

//Text that changes every second: only touch the DOM when it did
function setBackgroundTaskText(element, text){
    if (element.text() != text){
        element.text(text);
    }
}

//Send pause, continue or cancel to one operation, then list again
function sendBackgroundTaskControl(oprid, flag){
    backgroundTaskBusy[oprid] = true;
    var row = $("#btList .btRow").filter(function(){
        return $(this).attr("data-oprid") == oprid;
    });
    row.addClass("busy");
    row.find(".btPause, .btCancel").addClass("disabled");
    row.find(".btPause i").attr("class", "circle notch loading icon");
    $.ajax({
        url: "system/file_system/ongoing",
        method: "POST",
        data: {"oprid": oprid, "flag": flag},
        success: function(data){
            if (data && data.error != undefined){
                console.log("[Background tasks]", data.error);
            }
        },
        complete: function(){
            delete backgroundTaskBusy[oprid];
            updateBackgroundgTaskList();
        }
    });
}

function handleBackgroundTaskPauseToggle(oprid, btn=undefined, currentlyPaused=false){
    sendBackgroundTaskControl(oprid, currentlyPaused ? "continue" : "pause");
}

function handleBackgroundTaskCancel(oprid, btn=undefined){
    sendBackgroundTaskControl(oprid, "cancel");
}

/*
    The panel
*/
function showBackgroundTaskPanel(){
    var panel = $("#backgroundTaskPanel");
    if (typeof trayToggleAllowed == "function" && !trayToggleAllowed("tasks")){
        return;
    }
    if (panel.is(":visible")){
        hideBackgroundTaskPanel();
        return;
    }
    if (typeof trayClosePanels == "function"){
        trayClosePanels("#backgroundTaskPanel");
    }
    updateBackgroundgTaskList();
    panel.stop(true, true).fadeIn(120);
}

function hideBackgroundTaskPanel(){
    $("#backgroundTaskPanel").stop(true, true).fadeOut(120);
}

$("#btList").on("click", ".btPause", function(event){
    event.stopPropagation();
    if ($(this).hasClass("disabled")){
        return;
    }
    var oprid = $(this).closest(".btRow").attr("data-oprid");
    handleBackgroundTaskPauseToggle(oprid, this, $(this).attr("data-paused") == "true");
});

$("#btList").on("click", ".btCancel", function(event){
    event.stopPropagation();
    if ($(this).hasClass("disabled")){
        return;
    }
    handleBackgroundTaskCancel($(this).closest(".btRow").attr("data-oprid"), this);
});

$("#btList").on("click", ".btRow", function(){
    openFileOperationDialog();
});

$("#btList").on("click", ".btRefresh", function(){
    updateBackgroundgTaskList();
});

$("#btShowDetails").on("click", function(){
    openFileOperationDialog();
});
