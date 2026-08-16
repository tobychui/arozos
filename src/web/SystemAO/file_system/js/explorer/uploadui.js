/*
    uploadui.js

    The transfer panel (#uploadTab): one row per upload task, a running total
    and the panel level controls.

    upload.js and download.js drive this file through a small API rather than
    reaching into the row markup themselves:

        appendUploadFileItem(name, size)   -> taskUUID, adds a pending row
        registerUploadTransfer(uuid, h)    -> hand over {abort, pause, resume}
        setUploadTaskProgress(uuid, l, t)  -> bytes moved, drives bar/ETA/total
        setUploadTaskState(uuid, state)    -> pending|uploading|processing|
                                              paused|done|failed
        setUploadTaskStatusText(uuid, s)   -> override the right hand label

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

/*
    Row creation
*/

function appendUploadFileItem(filename, filesize){
    var newuuid = uuidv4();

    //A negative size means the total is not known up front (zip preparation,
    //where the server streams without announcing a length)
    var knownSize = !(filesize < 0 || isNaN(filesize));

    uploadTaskInfo.set(newuuid, {
        name: filename,
        size: knownSize ? filesize : -1,
        loaded: 0,
        state: "pending",
        speed: 0,
        lastLoaded: 0,
        lastTime: Date.now(),
        statusOverride: null
    });

    $("#uploadProgressList").append(`<div class="uploadTask pending" taskID="${newuuid}">
        <div class="uploadTaskName"></div>
        <div class="uploadTaskMeta">
            <span class="uploadTaskSize"></span>
            <span class="uploadTaskStatus"></span>
        </div>
        <div class="uploadTaskAction" onclick="onUploadTaskButton('${newuuid}');"></div>
        <div class="uploadTaskBar"><div class="uploadTaskBarFill"></div></div>
    </div>`);

    //Set as text, not html: a filename may legitimately contain angle brackets
    let row = getUploadTaskByID(newuuid);
    row.find(".uploadTaskName").text(filename).attr("title", filename);

    //A new task always brings the panel back, even if it was collapsed
    uploadPanelCollapsed = false;
    renderUploadTask(newuuid);
    updateUploadFileCount();
    return newuuid;
}

/*
    Transfer handles

    A handle is {abort, pause, resume, pausable}. pause/resume are optional -
    the plain POST upload mode cannot suspend an in-flight XHR, so its rows
    offer cancel instead of pause.
*/

function registerUploadTransfer(taskUUID, handle){
    uploadTransferMap.set(taskUUID, handle);
    renderUploadTask(taskUUID);
}

function unregisterUploadTransfer(taskUUID){
    uploadTransferMap.delete(taskUUID);
}

/*
    Progress and state
*/

function setUploadTaskProgress(taskUUID, loaded, total){
    let info = uploadTaskInfo.get(taskUUID);
    if (info === undefined){
        return;
    }

    if (total !== undefined && total > 0){
        info.size = total;
    }
    info.loaded = loaded;

    //Exponentially smoothed throughput. A raw delta jumps around far too much
    //for a "time left" label that is meant to be readable.
    let now = Date.now();
    let dt = (now - info.lastTime) / 1000;
    if (dt >= 0.4){
        let instant = (loaded - info.lastLoaded) / dt;
        if (instant < 0){
            instant = 0;
        }
        info.speed = info.speed > 0 ? (info.speed * 0.7 + instant * 0.3) : instant;
        info.lastLoaded = loaded;
        info.lastTime = now;
    }

    if (info.state == "pending"){
        info.state = "uploading";
    }

    renderUploadTask(taskUUID);
    updateUploadSummary();
}

function setUploadTaskState(taskUUID, state){
    let info = uploadTaskInfo.get(taskUUID);
    if (info === undefined){
        return;
    }
    info.state = state;
    if (state == "done" && info.size > 0){
        info.loaded = info.size;
    }
    if (state != "processing"){
        info.statusOverride = null;
    }
    renderUploadTask(taskUUID);
    updateUploadFileCount();
}

function setUploadTaskStatusText(taskUUID, text){
    let info = uploadTaskInfo.get(taskUUID);
    if (info === undefined){
        return;
    }
    info.statusOverride = text;
    renderUploadTask(taskUUID);
}

/*
    Rendering
*/

/*
    The shared bytesToSize() drops trailing zeros, so a panel showing several
    transfers ends up mixing "2 MB", "121.2 MB" and "52.32 MB". Every number in
    this panel is fixed at one decimal place instead so the columns line up.

    Units are the short forms ("MB", not "Megabytes") because each one is boxed
    at a fixed width below and a five character "Bytes" would reserve a visible
    gap on every row.
*/
function splitUploadBytes(bytes){
    var sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
    if (!(bytes > 0)){
        return {value: "0.0", unit: sizes[0]};
    }
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    if (i >= sizes.length){
        i = sizes.length - 1;
    }
    return {value: (bytes / Math.pow(1024, i)).toFixed(1), unit: sizes[i]};
}

/*
    A counter that reflows on every progress tick is unreadable, and a single
    fixed width box around the whole "121.2 MB" string does not fix it: the
    number still moves inside the box as it grows, and it drags the unit with
    it. So the number, the unit and the "/" each get their own fixed width cell
    - the number right aligned so its ones column never moves, the unit left
    aligned so it starts at the same x whatever the number did. Combined with
    tabular figures (in a proportional font "1" is narrower than "8"), every
    glyph position is then stable across updates.
*/
function formatUploadBytesHTML(bytes){
    let parts = splitUploadBytes(bytes);
    return '<span class="uploadNum">' + parts.value + '</span>' +
           '<span class="uploadUnit">' + parts.unit + '</span>';
}

function formatUploadEta(seconds){
    if (!isFinite(seconds) || seconds <= 0){
        return "";
    }
    if (seconds < 60){
        return applocale.getString("upload/eta/seconds", "%d sec left").replace("%d", Math.max(1, Math.round(seconds)));
    }
    if (seconds < 3600){
        return applocale.getString("upload/eta/minutes", "%d min left").replace("%d", Math.round(seconds / 60));
    }
    return applocale.getString("upload/eta/hours", "%d hr left").replace("%d", Math.round(seconds / 3600));
}

function renderUploadTask(taskUUID){
    let info = uploadTaskInfo.get(taskUUID);
    let row = getUploadTaskByID(taskUUID);
    if (info === undefined || row === undefined){
        return;
    }

    let knownSize = info.size > 0;
    let percentage = 0;
    if (info.state == "done"){
        percentage = 100;
    }else if (knownSize){
        percentage = Math.min(100, info.loaded / info.size * 100);
    }

    //A task with no announced total (zip preparation) has no percentage to
    //show, so its bar sweeps instead of filling
    let indeterminate = !knownSize && info.state != "done" && info.state != "failed";
    row.attr("class", "uploadTask " + info.state + (indeterminate ? " indeterminate" : ""));
    row.find(".uploadTaskBarFill").css("width", indeterminate ? "" : percentage + "%");

    //Byte counter. Without a known total there is nothing meaningful to divide by.
    let sizeHTML = "";
    if (knownSize){
        sizeHTML = formatUploadBytesHTML(info.loaded) +
                   '<span class="uploadSep">/</span>' +
                   formatUploadBytesHTML(info.size);
    }else if (info.loaded > 0){
        sizeHTML = formatUploadBytesHTML(info.loaded);
    }
    row.find(".uploadTaskSize").html(sizeHTML);

    //Right hand label
    let statusText = "";
    if (info.statusOverride){
        statusText = info.statusOverride;
    }else if (info.state == "done"){
        statusText = applocale.getString("upload/completed", "Completed");
    }else if (info.state == "failed"){
        statusText = applocale.getString("upload/failed", "Failed");
    }else if (info.state == "paused"){
        statusText = applocale.getString("upload/paused", "Paused");
    }else if (info.state == "pending"){
        statusText = applocale.getString("upload/waiting", "Waiting");
    }else if (info.state == "processing"){
        statusText = applocale.getString("upload/processing", "Processing");
    }else if (knownSize && info.speed > 0){
        statusText = formatUploadEta((info.size - info.loaded) / info.speed);
    }
    row.find(".uploadTaskStatus").text(statusText);

    //Round button on the right. Completed rows show a status glyph instead of
    //a control, which is why the icon is chosen from the state, not the handle.
    let handle = uploadTransferMap.get(taskUUID);
    let iconName = "closeCircle";
    let btnTitle = applocale.getString("upload/cancel", "Cancel");
    if (info.state == "done"){
        iconName = "checkCircle";
        btnTitle = applocale.getString("upload/completed", "Completed");
    }else if (info.state == "failed"){
        iconName = "refresh";
        btnTitle = applocale.getString("upload/retry", "Retry");
    }else if (info.state == "paused"){
        iconName = "playCircle";
        btnTitle = applocale.getString("upload/resume", "Resume");
    }else if (handle && handle.pausable){
        iconName = "pauseCircle";
        btnTitle = applocale.getString("upload/pause", "Pause");
    }
    row.find(".uploadTaskAction").html(FSIcons[iconName]).attr("title", btnTitle);
}

/*
    Panel level chrome
*/

function updateUploadSummary(){
    let loaded = 0;
    let total = 0;
    let hasUnknown = false;
    uploadTaskInfo.forEach(function(info){
        loaded += info.loaded;
        if (info.size > 0){
            total += info.size;
        }else{
            hasUnknown = true;
        }
    });

    //The %s slots get the same boxed number markup as the rows. The literal
    //text around them comes from the locale file and never changes width.
    let html = "";
    if (total > 0 && !hasUnknown){
        html = applocale.getString("upload/total", "Total: %s / %s")
                .replace("%s", formatUploadBytesHTML(loaded))
                .replace("%s", formatUploadBytesHTML(total));
    }else if (loaded > 0){
        html = formatUploadBytesHTML(loaded);
    }
    $("#uploadSummaryText").html(html);
}

function updateUploadFileCount(){
    let active = 0;
    uploadTaskInfo.forEach(function(info){
        if (info.state != "done" && info.state != "failed"){
            active++;
        }
    });

    let title = "";
    if (active > 0){
        title = applocale.getString("upload/title", "Uploading %d items").replace("%d", active);
    }else{
        title = applocale.getString("upload/titleDone", "%d items completed").replace("%d", $(".uploadTask").length);
    }
    $("#uploadHeaderTitle").text(title);

    updateUploadSummary();
    trimFinishedUploadRows();
    applyUploadPanelVisibility();

    //Fired from here rather than from setUploadTaskProgress: this runs when a
    //task is added or changes state, which is exactly when the active row moves
    scrollActiveUploadIntoView();
}

/*
    Panel and its collapsed stand-in

    The panel and #fmUploadListBtn are two views of one thing, so both are
    resolved here from the task list rather than toggled at each call site.
    The button exists whenever there is anything to show - collapsing does not
    throw the list away, it just parks it in the status bar - and it pulses
    while a transfer is still moving so background progress stays noticeable.
*/
function applyUploadPanelVisibility(){
    let taskCount = $(".uploadTask").length;
    let transferring = false;
    uploadTaskInfo.forEach(function(info){
        if (info.state == "uploading" || info.state == "processing" || info.state == "pending"){
            transferring = true;
        }
    });

    if (taskCount == 0){
        //Nothing left to show: the panel and its button both go away
        $("#uploadTab").hide();
        $("#fmUploadListBtn").hide();
        uploadPanelCollapsed = false;
        return;
    }

    let expanded = !uploadPanelCollapsed;
    $("#uploadTab").toggle(expanded);
    $("#fmUploadListBtn").css("display", "");
    $("#fmUploadListBtn").toggleClass("active", expanded);
    $("#fmUploadListBtn").toggleClass("transferring", transferring);
}

/*
    A few thousand queued files used to be handled by fading each row out one
    second after it completed. The panel now keeps completed rows so they can
    be reviewed, so cap how many of them accumulate instead.
*/
function trimFinishedUploadRows(){
    let finished = $("#uploadProgressList").find(".uploadTask.done");
    let excess = finished.length - MAX_FINISHED_UPLOAD_ROWS;
    for (var i = 0; i < excess; i++){
        let row = $(finished[i]);
        uploadTaskInfo.delete(row.attr("taskid"));
        row.remove();
    }
}

function onUploadTaskButton(taskUUID){
    let info = uploadTaskInfo.get(taskUUID);
    if (info === undefined){
        return;
    }
    let handle = uploadTransferMap.get(taskUUID);

    if (info.state == "done"){
        //The glyph is a status indicator, not a button
        return;
    }else if (info.state == "failed"){
        retryUploadFile(taskUUID);
    }else if (info.state == "paused"){
        if (handle && handle.resume){
            handle.resume();
            setUploadTaskState(taskUUID, "uploading");
        }
    }else if (handle && handle.pausable && handle.pause){
        handle.pause();
        setUploadTaskState(taskUUID, "paused");
    }else{
        cancelUploadTask(taskUUID);
    }
}

function cancelUploadTask(taskUUID){
    let handle = uploadTransferMap.get(taskUUID);
    if (handle && handle.abort){
        handle.abort();
    }
    uploadTransferMap.delete(taskUUID);

    //Drop it from the pending queue if it never started
    for (var i = 0; i < uploadPendingList.length; i++){
        if (uploadPendingList[i].UUID == taskUUID){
            uploadPendingList.splice(i, 1);
            break;
        }
    }

    uploadRetryMap.delete(taskUUID);
    uploadTaskInfo.delete(taskUUID);
    let row = getUploadTaskByID(taskUUID);
    if (row !== undefined){
        row.fadeOut("fast", function(){
            $(this).remove();
            updateUploadFileCount();
        });
    }else{
        updateUploadFileCount();
    }
}

function retryUploadFile(taskUUID){
    let retryInfo = uploadRetryMap.get(taskUUID);
    if (!retryInfo){
        console.warn("[Upload] No retry info found for task " + taskUUID);
        return;
    }

    let info = uploadTaskInfo.get(taskUUID);
    if (info !== undefined){
        info.loaded = 0;
        info.speed = 0;
        info.lastLoaded = 0;
        info.lastTime = Date.now();
    }
    setUploadTaskState(taskUUID, "pending");

    //Re-queue the file for upload using the same task UUID
    uploadFile(retryInfo.file, taskUUID, retryInfo.targetDir);
}

function clearCompletedUploads(){
    $("#uploadProgressList").find(".uploadTask.done, .uploadTask.failed").each(function(){
        uploadTaskInfo.delete($(this).attr("taskid"));
        $(this).remove();
    });
    updateUploadFileCount();
}

function cancelAllUploads(){
    //Snapshot first: cancelUploadTask mutates both the map and the queue
    let ids = [];
    uploadTaskInfo.forEach(function(info, uuid){
        if (info.state != "done"){
            ids.push(uuid);
        }
    });
    uploadPendingList = [];
    ids.forEach(function(uuid){
        cancelUploadTask(uuid);
    });
}

/*
    Keep the in-flight transfer on screen

    Completed rows stay in the list, so in a long queue the active row keeps
    drifting downwards out of view. Called on state changes rather than on every
    progress tick: the active row only moves when a task starts or finishes, and
    scrolling on each tick would fight the user constantly.
*/
function bindUploadListScroll(){
    let list = document.getElementById("uploadProgressList");
    if (list == null){
        return;
    }
    list.addEventListener("scroll", function(){
        if (Math.abs(list.scrollTop - uploadListAutoScrollTop) < 1){
            //Where this file just scrolled to, so this event is its own
            return;
        }
        uploadListUserScrolledAt = Date.now();
    });
}

function scrollActiveUploadIntoView(){
    let list = document.getElementById("uploadProgressList");
    let panel = document.getElementById("uploadTab");
    if (list == null || panel == null){
        return;
    }
    //Nothing to bring into view while the panel is collapsed to the status bar
    if (getComputedStyle(panel).display == "none" || getComputedStyle(list).display == "none"){
        return;
    }
    if (Date.now() - uploadListUserScrolledAt < UPLOAD_FOLLOW_PAUSE_MS){
        //The user is reading the list - leave it alone
        return;
    }

    //The first row that has not finished is the one worth watching
    let active = null;
    let rows = list.querySelectorAll(".uploadTask");
    for (var i = 0; i < rows.length; i++){
        if (!rows[i].classList.contains("done") && !rows[i].classList.contains("failed")){
            active = rows[i];
            break;
        }
    }
    if (active == null){
        return;
    }

    let listBox = list.getBoundingClientRect();
    let rowBox = active.getBoundingClientRect();
    let delta = 0;
    if (rowBox.top < listBox.top || rowBox.height > listBox.height){
        delta = rowBox.top - listBox.top;
    }else if (rowBox.bottom > listBox.bottom){
        delta = rowBox.bottom - listBox.bottom;
    }
    if (delta == 0){
        return;
    }

    /*
        scrollTop rather than scrollIntoView: the latter also scrolls every
        scrollable ancestor, which would drag the file list behind the panel.
    */
    list.scrollTop += delta;
    //Read back rather than reusing the requested value - the browser clamps it
    uploadListAutoScrollTop = list.scrollTop;
}

//Collapse the panel down to #fmUploadListBtn. The tasks keep running.
function toggleUploadMinimize(){
    uploadPanelCollapsed = true;
    applyUploadPanelVisibility();
}

//The status bar button: expands the parked panel, or collapses it again
function toggleUploadPanel(){
    uploadPanelCollapsed = !uploadPanelCollapsed;
    applyUploadPanelVisibility();
    if (!uploadPanelCollapsed){
        //Re-expanded from the status bar - put the in-flight row back in sight
        uploadListUserScrolledAt = 0;
        scrollActiveUploadIntoView();
    }
}

function closeUploadTab(){
    uploadPanelCollapsed = true;
    applyUploadPanelVisibility();
}

/*
    Kept for compatibility: older call sites remove a row by passing the clicked
    element. The task UUID is the part that actually matters.
*/
function removeThisTask(object, taskUUID){
    cancelUploadTask(taskUUID);
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.removeThisTask = removeThisTask;
window.retryUploadFile = retryUploadFile;
window.toggleUploadMinimize = toggleUploadMinimize;
window.toggleUploadPanel = toggleUploadPanel;   // the status bar button
window.closeUploadTab = closeUploadTab;
window.clearCompletedUploads = clearCompletedUploads;
window.cancelAllUploads = cancelAllUploads;
window.onUploadTaskButton = onUploadTaskButton;
