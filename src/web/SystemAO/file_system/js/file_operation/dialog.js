/*
    dialog.js

    The unified ArozOS file operation dialog.

    There is only one of these open at a time. New operations are handed over
    to the running dialog through window.addFileOperation() instead of opening
    another float window, and the status of every operation of this user is
    streamed over a single WebSocket connection. When that socket cannot be
    opened the dialog falls back to polling the ongoing task listing endpoint.

    Launch config, passed either in the URL hash or to addFileOperation():
    {
        opr: {move / copy / zip / unzip / unzipAndOpen},
        src: [filelist],
        dest: filepath,

        //Optional
        overwriteMode: {skip / overwrite / keep / ask},
        callbackWindowID: {floatWindow ID},
        callbackFunction: {target window function name as a string}
    }
*/

//Control signals returned by the backend, see mod/filesystem/static.go
var FSOPR_CONTINUE = 0;
var FSOPR_PAUSE = 1;
var FSOPR_CANCEL = 2;

var POLLING_INTERVAL = 2000; //Status polling interval when the WebSocket is unusable, in ms
var WS_RETRY_INTERVAL = 30000; //How often a failed WebSocket connection is retried, in ms
var AUTOCLOSE_DELAY = 1000; //How long the dialog stays up after everything succeeded, in ms
var MAX_SENSIBLE_ETA = 86400; //Remaining times above this are not shown at all, in seconds
var STACKED_ROW_THRESHOLD = 8; //Operations with more files than this are drawn as one stacked row

var operationConfigs = {}; //Launch config of the operations started by this dialog, keyed by oprid
var pendingOperations = []; //Operations still waiting for the user to pick an overwrite mode
var latestTasks = []; //Latest task listing reported by the backend
var rateSamples = {}; //Transfer rate estimation state, keyed by oprid
var completedHandled = {}; //Operations whose completion callback has already fired
var statusSocket = null;
var pollingTimer = null;
var wsRetryTimer = null;
var autoCloseTimer = null;
var userIsInteracting = false;
var collapsed = false;
var everHadOperation = false;
var lastWindowHeight = 0; //Last height this dialog asked its float window to take
var lastContentHeight = 0; //Height of the rendered rows at the last resize
var windowChromeHeight = 30; //Float window title bar and borders, measured at runtime
var renderedStructure = ""; //Signature of the markup currently on screen
var dynamicRows = []; //Cached nodes carrying a moving value, one per file row
var pausedOverride = {}; //Locally applied pause state, until the backend confirms it

/* ---------------------------------------------------------------
    Startup
--------------------------------------------------------------- */

if (applocale) {
    applocale.init("../locale/file_operation.json", function() {
        applocale.translate();
        init();
    });
} else {
    //Applocale not found. Is this a trim down version of ArozOS?
    applocale = {
        getString: function(key, original) {
            return original;
        }
    }
    init();
}

function init() {
    initTheme();
    lastWindowHeight = 430;
    ao_module_setWindowSize(480, 430);

    //A narrow dialog drops these labels and keeps only the icons, so the button
    //has to be able to say what it is on its own
    $("#collapseBtn").attr("title", applocale.getString("button/collapse", "Collapse"));
    $("#clearCompletedBtn").attr("title", applocale.getString("footer/clearCompleted", "Clear completed"));
    $("#cancelAllBtn").attr("title", applocale.getString("footer/cancelAll", "Cancel all"));

    //Keep the dialog up while the pointer is inside it
    $(document).on("mouseenter", function() {
        userIsInteracting = true;
        cancelAutoClose();
    });
    $(document).on("mouseleave", function() {
        userIsInteracting = false;
        //The pointer left, the dialog may close itself again
        render();
    });

    //Start streaming the status of all the operations of this user
    startStatusStream();

    //Queue the operation this dialog was launched with, if any
    if (window.location.hash.length > 1) {
        try {
            var launchConfig = JSON.parse(decodeURIComponent(window.location.hash.substring(1)));
            addFileOperation(launchConfig);
        } catch (ex) {
            console.log("[File Operation] Launch argument parse error", ex);
        }
    }

    render();
}

function initTheme() {
    var applyTheme = function(theme) {
        document.documentElement.setAttribute("data-theme", theme == "dark" ? "dark" : "light");
    };

    //Follow the system theme, both under Virtual Desktop and as a standalone tab
    ao_module_onThemeChanged(applyTheme);
    $.get("../../system/file_system/preference?key=file_explorer/theme", function(data) {
        applyTheme(data == "darkTheme" ? "dark" : "light");
    }).fail(function() {
        applyTheme("light");
    });
}

/* ---------------------------------------------------------------
    Public entry point: queue a new file operation into this dialog
--------------------------------------------------------------- */

window.addFileOperation = function(config) {
    if (config == undefined || config.opr == undefined || config.src == undefined || config.dest == undefined) {
        console.log("[File Operation] Invalid file operation config. See dialog.js for the expected config object.");
        return false;
    }

    if (!Array.isArray(config.src)) {
        config.src = [config.src];
    }
    if (config.src.length == 0) {
        return false;
    }

    cancelAutoClose();
    everHadOperation = true;

    if (config.overwriteMode == "ask") {
        //Ask the user what to do before starting, but only if it actually matters
        checkForDuplication(config, function(duplicateCount) {
            if (duplicateCount > 0) {
                config.duplicateCount = duplicateCount;
                config.pendingId = "pending_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
                pendingOperations.push(config);
                render();
            } else {
                config.overwriteMode = "skip";
                startOperation(config);
            }
        });
    } else {
        startOperation(config);
    }
    return true;
}

//Ask the backend how many of the source files already exist at the destination
function checkForDuplication(config, callback) {
    $.ajax({
        type: "POST",
        url: "../../system/file_system/validateFileOpr",
        data: { src: JSON.stringify(config.src), dest: config.dest },
        success: function(duplicateList) {
            if (Array.isArray(duplicateList)) {
                callback(duplicateList.length);
            } else {
                callback(0);
            }
        },
        error: function() {
            callback(0);
        }
    });
}

//The user picked an overwrite mode for one of the pending operations
window.resolveDuplication = function(pendingId, overwriteMode) {
    for (var i = 0; i < pendingOperations.length; i++) {
        if (pendingOperations[i].pendingId == pendingId) {
            var config = pendingOperations.splice(i, 1)[0];
            config.overwriteMode = overwriteMode;
            startOperation(config);
            render();
            return;
        }
    }
}

//Send the operation to the backend and let it run there in the background
function startOperation(config) {
    //unzipAndOpen is an unzip that opens the destination folder afterwards
    var backendOpr = (config.opr == "unzipAndOpen") ? "unzip" : config.opr;

    requestCSRFToken(function(token) {
        $.ajax({
            type: "POST",
            url: "../../system/file_system/fileOprAsync",
            data: {
                opr: backendOpr,
                src: JSON.stringify(config.src),
                dest: config.dest,
                existsresp: config.overwriteMode || "skip",
                csrft: token
            },
            success: function(data) {
                if (data.error !== undefined) {
                    console.log("[File Operation] " + data.error);
                    showStartupError(config, data.error);
                    return;
                }
                operationConfigs[data.oprid] = config;
                requestStatusUpdate();
            },
            error: function() {
                showStartupError(config, "Unable to start file operation");
            }
        });
    });
}

//An operation that never made it to the backend still deserves to be shown
function showStartupError(config, errmsg) {
    var files = [];
    config.src.forEach(function(src) {
        files.push({
            Filename: basename(src),
            Src: src,
            Size: 0,
            Done: 0,
            Progress: 0,
            Status: "error",
            Error: errmsg
        });
    });

    latestTasks.push({
        ID: "local_" + Date.now() + "_" + Math.floor(Math.random() * 100000),
        Operation: config.opr,
        Src: config.src[0],
        Dest: config.dest,
        Progress: 0,
        Files: files,
        TotalSize: 0,
        DoneSize: 0,
        Status: "error",
        Error: errmsg,
        LocalOnly: true
    });
    render();
}

function requestCSRFToken(callback) {
    $.ajax({
        url: "../../system/csrf/new",
        success: function(token) {
            callback(token);
        },
        error: function() {
            callback("");
        }
    });
}

/* ---------------------------------------------------------------
    Status stream: one WebSocket for every operation of this user,
    falling back to polling when the socket cannot be opened
--------------------------------------------------------------- */

function startStatusStream() {
    if (!("WebSocket" in window || "MozWebSocket" in window)) {
        console.log("[File Operation] WebSocket unsupported. Using status polling instead.");
        startPolling();
        return;
    }

    try {
        statusSocket = new WebSocket(getStatusWSEndpoint());
    } catch (ex) {
        console.log("[File Operation] WebSocket creation failed. Using status polling instead.", ex);
        startPolling();
        return;
    }

    statusSocket.onopen = function() {
        //The socket is alive, no need for the polling fallback anymore
        stopPolling();
    };

    statusSocket.onmessage = function(evt) {
        try {
            handleTaskListUpdate(JSON.parse(evt.data));
        } catch (ex) {
            console.log("[File Operation] Malformed status update", ex);
        }
    };

    statusSocket.onerror = function(event) {
        console.log("[File Operation] Status WebSocket error. Falling back to status polling.", event);
    };

    statusSocket.onclose = function() {
        statusSocket = null;
        //The connection is gone, keep the dialog alive on polling and retry later
        startPolling();
        if (wsRetryTimer == null) {
            wsRetryTimer = setTimeout(function() {
                wsRetryTimer = null;
                if (statusSocket == null) {
                    startStatusStream();
                }
            }, WS_RETRY_INTERVAL);
        }
    };
}

function getStatusWSEndpoint() {
    var protocol = (location.protocol === "https:") ? "wss://" : "ws://";
    var port = window.location.port;
    if (port == "") {
        port = (location.protocol === "https:") ? "443" : "80";
    }
    return protocol + window.location.hostname + ":" + port + "/system/file_system/ws/fileOprStatus";
}

function startPolling() {
    if (pollingTimer != null) {
        return;
    }
    requestStatusUpdate();
    pollingTimer = setInterval(requestStatusUpdate, POLLING_INTERVAL);
}

function stopPolling() {
    if (pollingTimer != null) {
        clearInterval(pollingTimer);
        pollingTimer = null;
    }
}

//Pull the whole task listing in one go. Used by the polling fallback and
//right after starting an operation so the new row shows up without waiting.
function requestStatusUpdate() {
    $.get("../../system/file_system/ongoing?all=true", function(tasks) {
        if (Array.isArray(tasks)) {
            handleTaskListUpdate(tasks);
        }
    });
}

function handleTaskListUpdate(tasks) {
    //Keep the operations that only exist on this client, e.g. failed startups
    var localOnly = latestTasks.filter(function(task) {
        return task.LocalOnly === true;
    });

    latestTasks = tasks.concat(localOnly);
    clearConfirmedPauseOverrides();
    latestTasks.forEach(updateRateSample);
    latestTasks.forEach(handleTaskCompletion);
    render();
}

/* ---------------------------------------------------------------
    Transfer rate and time estimation
--------------------------------------------------------------- */

function updateRateSample(task) {
    var now = Date.now();
    var sample = rateSamples[task.ID];
    if (sample == undefined) {
        rateSamples[task.ID] = { time: now, done: task.DoneSize, rate: 0 };
        return;
    }

    if (operationIsPaused(task) || taskIsFinished(task)) {
        //No bytes move while the operation is paused. Counting that time would
        //drag the measured rate to zero and blow the remaining time up to
        //nonsense, so rebase the sample and measure again once it resumes.
        sample.time = now;
        sample.done = task.DoneSize;
        return;
    }

    var elapsed = (now - sample.time) / 1000;
    if (elapsed < 0.75) {
        //Too soon for a meaningful reading
        return;
    }

    var delta = task.DoneSize - sample.done;
    if (delta < 0) {
        delta = 0;
    }
    var instantRate = delta / elapsed;
    //Smooth the reading so the remaining time does not jump around
    sample.rate = (sample.rate == 0) ? instantRate : (sample.rate * 0.7 + instantRate * 0.3);
    sample.time = now;
    sample.done = task.DoneSize;
}

function getRemainingSeconds(task, remainingBytes) {
    var sample = rateSamples[task.ID];
    if (sample == undefined || sample.rate <= 0 || remainingBytes <= 0) {
        return -1;
    }

    var remainingSeconds = remainingBytes / sample.rate;
    if (remainingSeconds > MAX_SENSIBLE_ETA) {
        //The transfer is barely moving. Showing a number here would only be
        //misleading, so say nothing until the rate settles.
        return -1;
    }
    return remainingSeconds;
}

/* ---------------------------------------------------------------
    Rendering
--------------------------------------------------------------- */

/*
    The status stream ticks twice a second. Rebuilding the whole list on every
    tick burns GPU time on mobile and keeps destroying the buttons the user is
    trying to press, so the markup is only rebuilt when the shape of the list
    actually changes. In between, only the values that moved are written back.
*/
function render() {
    var ongoingCount = 0;
    var totalSize = 0;
    var doneSize = 0;
    var hasFinished = false;

    latestTasks.forEach(function(task) {
        if (!taskIsFinished(task)) {
            ongoingCount++;
        } else {
            hasFinished = true;
        }
        totalSize += (task.TotalSize || 0);
        doneSize += (task.DoneSize || 0);
    });
    ongoingCount += pendingOperations.length;

    var structure = buildStructureSignature();
    if (structure != renderedStructure) {
        renderedStructure = structure;
        rebuildOperationList();
    }

    updateDynamicValues();
    setTextIfChanged($("#dialogTitle"), buildTitleText(ongoingCount));
    setTextIfChanged($("#totalSizeText"), totalSize > 0 ?
        applocale.getString("footer/total", "Total: {done} / {total}")
            .replace("{done}", formatBytes(doneSize))
            .replace("{total}", formatBytes(totalSize)) : "");
    setDisabledIfChanged($("#clearCompletedBtn"), !hasFinished);
    setDisabledIfChanged($("#cancelAllBtn"), ongoingCount == 0);
    updateCollapsedSummary(totalSize, doneSize);

    resizeToContent();
    scheduleAutoCloseIfDone(ongoingCount);
}

/*
    A signature of everything that changes the markup rather than just a value
    inside it: which operations are listed, their state and the state of each of
    their files. Progress numbers are deliberately left out of it.
*/
function buildStructureSignature() {
    var parts = [];
    pendingOperations.forEach(function(config) {
        parts.push("p:" + config.pendingId + ":" + config.src.length + ":" + config.duplicateCount);
    });
    latestTasks.forEach(function(task) {
        var signal = operationIsPaused(task) ? FSOPR_PAUSE : FSOPR_CONTINUE;
        var states;
        if (operationIsStacked(task)) {
            //Only the file count is on screen, the individual states are not
            states = "stacked:" + (task.Files || []).length;
        } else {
            states = (task.Files || []).map(function(file) {
                return file.Status + "|" + file.Filename;
            }).join(",");
        }
        parts.push("t:" + task.ID + ":" + task.Status + ":" + signal + ":" + (task.Error || "") + ":" + states);
    });
    return parts.join(";");
}

function rebuildOperationList() {
    var html = "";
    pendingOperations.forEach(function(config) {
        html += renderPendingOperation(config);
    });
    latestTasks.forEach(function(task) {
        html += renderOperation(task);
    });

    $("#operationList").html(html);
    $("#emptyState").toggle(html == "");

    //Cache the nodes that carry a moving value so the ticks do not have to search for them
    dynamicRows = [];
    $("#operationList").find(".forow[oprid]").each(function() {
        var row = $(this);
        dynamicRows.push({
            oprid: row.attr("oprid"),
            fileIndex: parseInt(row.attr("fileindex"), 10),
            meta: row.find(".forowmeta"),
            bar: row.find(".foprogress .bar")
        });
    });
}

//Write back the values that moved since the last tick, and nothing else
function updateDynamicValues() {
    var taskById = {};
    latestTasks.forEach(function(task) {
        taskById[task.ID] = task;
    });

    dynamicRows.forEach(function(row) {
        var task = taskById[row.oprid];
        if (task == undefined) {
            return;
        }
        //A stacked row stands in for every file of the operation at once
        var file = (row.fileIndex < 0) ? stackedPseudoFile(task) : (task.Files || [])[row.fileIndex];
        if (file == undefined) {
            return;
        }

        var state = file.Status || "pending";
        var paused = operationIsPaused(task) && state == "ongoing";
        setTextIfChanged(row.meta, describeFileState(task, file, state, paused));

        var progress = (state == "completed") ? 100 : Math.max(0, Math.min(100, file.Progress || 0));
        setBarWidthIfChanged(row.bar, progress);
    });
}

/*
    The one line shown in place of the list while the dialog is collapsed: the
    progress of every operation of this user added up into a single bar.
*/
function updateCollapsedSummary(totalSize, doneSize) {
    var progress = 0;
    if (totalSize > 0) {
        progress = doneSize / totalSize * 100;
    } else if (latestTasks.length > 0) {
        //Sizes are unknown for this batch, average the reported progress instead
        latestTasks.forEach(function(task) {
            progress += (task.Progress || 0);
        });
        progress = progress / latestTasks.length;
    }
    progress = Math.max(0, Math.min(100, progress));

    /*
        Colour the bar after the outcome, but only once there is nothing left
        running: one finished operation, cancelled or failed, must not repaint
        the bar of the transfers that are still going.
    */
    var stillRunning = pendingOperations.length > 0;
    var anyError = false;
    var anyCancelled = false;
    latestTasks.forEach(function(task) {
        if (!taskIsFinished(task)) {
            stillRunning = true;
        } else if (task.Status == "error") {
            anyError = true;
        } else if (task.Status == "cancelled") {
            anyCancelled = true;
        }
    });

    var barState = "";
    if (latestTasks.length == 0 && pendingOperations.length == 0) {
        //Nothing left in the list: there is no outstanding work to show
        progress = 100;
        barState = "done";
    } else if (!stillRunning && latestTasks.length > 0) {
        if (anyError) {
            barState = "error";
        } else if (anyCancelled) {
            barState = "paused";
        } else {
            barState = "done";
        }
    }

    setBarWidthIfChanged($("#summaryBar"), progress);
    setClassIfChanged($("#summaryBar"), "bar " + barState);
    setTextIfChanged($("#summaryPercent"), Math.round(progress) + "%");
}

function setClassIfChanged(element, className) {
    if (element.length == 0 || element.attr("class") === className) {
        return;
    }
    element.attr("class", className);
}

function setTextIfChanged(element, text) {
    if (element.length == 0 || element.data("fotext") === text) {
        return;
    }
    element.data("fotext", text);
    element.text(text);
}

function setDisabledIfChanged(element, disabled) {
    if (element.length == 0 || element.prop("disabled") === disabled) {
        return;
    }
    element.prop("disabled", disabled);
}

function setBarWidthIfChanged(element, progress) {
    if (element.length == 0) {
        return;
    }
    //Rounded to whole percents: sub pixel updates are not worth a repaint
    var rounded = Math.round(progress);
    if (element.data("fowidth") === rounded) {
        return;
    }
    element.data("fowidth", rounded);
    element.css("width", rounded + "%");
}

/*
    Grow and shrink the float window with the number of rows it has to show.

    The wanted height is measured from the rows themselves, never from the
    scroll box that holds them: measuring the box would feed the window height
    back into the next measurement and walk the window down a few pixels on
    every tick.
*/
function resizeToContent() {
    if (collapsed) {
        return;
    }

    var contentHeight = $(".foheader").outerHeight(true) + $(".fofooter").outerHeight(true) +
        ($(".fosummary").is(":visible") ? $(".fosummary").outerHeight(true) : 0) +
        parseFloat($("#dialogBody").css("padding-top")) +
        parseFloat($("#dialogBody").css("padding-bottom"));
    $("#dialogBody").children(":visible").each(function() {
        contentHeight += $(this).outerHeight(true);
    });
    contentHeight = Math.ceil(contentHeight);

    if (Math.abs(contentHeight - lastContentHeight) < 8) {
        //The rows did not move, leave the window alone so a window the user
        //resized by hand is not fought over on every tick
        return;
    }
    lastContentHeight = contentHeight;

    var wantedHeight = Math.max(200, Math.min(560, contentHeight + measureWindowChrome()));
    lastWindowHeight = wantedHeight;
    ao_module_setWindowSize(480, wantedHeight);
}

//How much taller the float window is than the page inside it (title bar and borders)
function measureWindowChrome() {
    if (lastWindowHeight > 0 && window.innerHeight > 0) {
        var chrome = lastWindowHeight - window.innerHeight;
        if (chrome >= 0 && chrome < 120) {
            windowChromeHeight = chrome;
        }
    }
    return windowChromeHeight;
}

function buildTitleText(ongoingCount) {
    if (ongoingCount == 0) {
        return applocale.getString("header/allDone", "All operations completed");
    }
    if (ongoingCount == 1) {
        return applocale.getString("header/oneOperation", "1 operation in progress");
    }
    return applocale.getString("header/nOperations", "{n} operations in progress").replace("{n}", ongoingCount);
}

//An operation that is waiting for the user to pick an overwrite mode
function renderPendingOperation(config) {
    var html = '<div class="fooperation">';
    html += '<div class="foopinfo">' + escapeHtml(describeOperation(config.opr, config.src.length, dirname(config.src[0]))) + '</div>';
    html += '<div class="fodupask">';
    html += '<span class="foduptext">' + escapeHtml(describeDuplication(config.duplicateCount)) + '</span>';
    html += '<div class="fodupbtns">';
    html += '<button class="fobtn outline" onclick="resolveDuplication(\'' + config.pendingId + '\', \'overwrite\');">' + escapeHtml(applocale.getString("dup/overwrite", "Overwrite")) + '</button>';
    html += '<button class="fobtn outline" onclick="resolveDuplication(\'' + config.pendingId + '\', \'skip\');">' + escapeHtml(applocale.getString("dup/skip", "Skip")) + '</button>';
    html += '<button class="fobtn primary" onclick="resolveDuplication(\'' + config.pendingId + '\', \'keep\');">' + escapeHtml(applocale.getString("dup/renameAndKeep", "Rename & Keep")) + '</button>';
    html += '</div></div>';

    if (config.src.length > STACKED_ROW_THRESHOLD) {
        html += renderFileRow(null, {
            Filename: describeFileCount(config.src.length),
            Src: "",
            Size: 0,
            Done: 0,
            Progress: 0,
            Status: "pending",
            Stacked: true
        }, -1);
    } else {
        config.src.forEach(function(src, fileIndex) {
            html += renderFileRow(null, {
                Filename: basename(src),
                Src: src,
                Size: 0,
                Done: 0,
                Progress: 0,
                Status: "pending"
            }, fileIndex);
        });
    }

    html += '</div>';
    return html;
}

function renderOperation(task) {
    var config = operationConfigs[task.ID];
    var html = '<div class="fooperation" oprid="' + escapeHtml(task.ID) + '">';
    html += '<div class="foopinfo">' + escapeHtml(describeOperation(task.Operation, (task.Files || []).length, task.Src));
    if (config != undefined && config.duplicateCount > 0) {
        //Remind the user that this operation was started on top of existing files
        html += '<span class="foopnote">' + escapeHtml(describeDuplication(config.duplicateCount)) + '</span>';
    }
    if (task.Error) {
        html += '<span class="foopnote" style="color: var(--fo-bar-error);">' + escapeHtml(applocale.getString("error/" + task.Error, task.Error)) + '</span>';
    }
    html += '</div>';

    if (operationIsStacked(task)) {
        //Too many files to draw one row each, show the pile as a single row
        html += renderFileRow(task, stackedPseudoFile(task), -1);
    } else {
        (task.Files || []).forEach(function(file, fileIndex) {
            html += renderFileRow(task, file, fileIndex);
        });
    }

    html += '</div>';
    return html;
}

function renderFileRow(task, file, fileIndex) {
    var state = file.Status || "pending";
    var paused = (task != null && operationIsPaused(task) && state == "ongoing");
    var progress = Math.max(0, Math.min(100, file.Progress || 0));

    var barClass = "";
    if (state == "completed") {
        barClass = " done";
        progress = 100;
    } else if (state == "error") {
        barClass = " error";
    } else if (state == "cancelled" || paused) {
        barClass = " paused";
    }

    var badge = file.Stacked ?
        renderStackedBadge(state) :
        renderFileBadge(file.Filename, state, file.IsDir || isFolderPath(file.Src));

    //A stacked row names the pile, so point at the file it is on right now instead
    var nameHint = (file.Stacked && task != null && task.LatestFile) ? task.LatestFile : file.Filename;

    var html = '<div class="forow"' + (task != null ? ' oprid="' + escapeHtml(task.ID) + '" fileindex="' + fileIndex + '"' : '') + '>';
    html += '<div class="forowicon">' + badge + '</div>';
    html += '<div class="forowmain">';
    html += '<div class="forowname" title="' + escapeHtml(nameHint) + '">' + escapeHtml(file.Filename) + '</div>';
    html += '<div class="forowmeta' + (state == "error" ? " error" : "") + '">' + escapeHtml(describeFileState(task, file, state, paused)) + '</div>';
    html += '<div class="foprogress"><div class="bar' + barClass + '" style="width: ' + progress + '%;"></div></div>';
    html += '</div>';

    //Only rows that can still move carry the pause and cancel buttons
    html += '<div class="forowctrl">';
    if (task != null && taskIsFinished(task) && (task.Status == "cancelled" || task.Status == "error")) {
        //A stopped operation stays in the list until the user dismisses it
        html += '<button class="forowbtn cancel" title="' + escapeHtml(applocale.getString("button/remove", "Remove")) + '" onclick="removeOperation(\'' + escapeHtml(task.ID) + '\');">';
        html += '<i class="times icon"></i></button>';
    } else if (task != null && !taskIsFinished(task) && state != "completed" && state != "error") {
        var pauseIcon = paused ? "play" : "pause";
        var pauseTitle = paused ? applocale.getString("button/resume", "Resume") : applocale.getString("button/pause", "Pause");
        html += '<button class="forowbtn" title="' + escapeHtml(pauseTitle) + '" onclick="toggleOperationPause(\'' + escapeHtml(task.ID) + '\', ' + (paused ? "true" : "false") + ');">';
        html += '<i class="' + pauseIcon + ' icon"></i></button>';
        html += '<button class="forowbtn cancel" title="' + escapeHtml(applocale.getString("button/cancel", "Cancel")) + '" onclick="cancelOperation(\'' + escapeHtml(task.ID) + '\');">';
        html += '<i class="times icon"></i></button>';
    }
    html += '</div>';

    html += '</div>';
    return html;
}

/*
    An operation over a long list of files is drawn as one stacked row rather
    than one row each. A hundred rows is a hundred badges, progress bars and
    buttons to build and repaint, which is enough to make a low powered device
    stutter for a listing nobody can read at that length anyway.
*/
function operationIsStacked(task) {
    return (task.Files || []).length > STACKED_ROW_THRESHOLD;
}

// The single file record a stacked row is drawn from, made of the whole operation
function stackedPseudoFile(task) {
    var files = task.Files || [];
    var state = "ongoing";
    if (task.Status == "completed" || task.Status == "error" || task.Status == "cancelled") {
        state = task.Status;
    }

    return {
        Filename: describeFileCount(files.length),
        Src: "",
        Size: task.TotalSize || 0,
        Done: task.DoneSize || 0,
        Progress: task.Progress || 0,
        Status: state,
        Error: task.Error || "",
        Stacked: true
    };
}

function describeFileCount(fileCount) {
    if (fileCount == 1) {
        return applocale.getString("stack/oneFile", "1 file");
    }
    return applocale.getString("stack/files", "{n} files").replace("{n}", fileCount);
}

function describeOperation(opr, fileCount, src) {
    var text;
    switch (opr) {
        case "move":
            text = applocale.getString("op/moving", "Moving {n} file(s)");
            break;
        case "copy":
            text = applocale.getString("op/copying", "Copying {n} file(s)");
            break;
        case "zip":
            text = applocale.getString("op/zipping", "Compressing {n} file(s)");
            break;
        case "unzip":
        case "unzipAndOpen":
            text = applocale.getString("op/unzipping", "Extracting {n} file(s)");
            break;
        default:
            text = applocale.getString("op/processing", "Processing {n} file(s)");
    }

    text = text.replace("{n}", fileCount);
    if (src) {
        text += " " + applocale.getString("op/source", "· Source: {p}").replace("{p}", centerTruncate(src, 34));
    }
    return text;
}

function describeDuplication(duplicateCount) {
    if (duplicateCount == 1) {
        return applocale.getString("op/oneDuplicate", "1 file with the same name at the destination");
    }
    return applocale.getString("op/nDuplicates", "{n} files with the same name at the destination").replace("{n}", duplicateCount);
}

function describeFileState(task, file, state, paused) {
    if (state == "completed") {
        return applocale.getString("row/completed", "Completed");
    }
    if (state == "error") {
        return applocale.getString("error/" + file.Error, file.Error || applocale.getString("row/failed", "Failed"));
    }
    if (state == "cancelled") {
        return applocale.getString("row/cancelled", "Cancelled");
    }
    if (state == "pending") {
        return applocale.getString("row/waiting", "Waiting");
    }

    //Ongoing: show the transferred size and the estimated remaining time
    var meta = "";
    if (file.Size > 0) {
        meta = formatBytes(file.Done) + " / " + formatBytes(file.Size);
    } else {
        meta = Math.round(file.Progress || 0) + "%";
    }

    if (paused) {
        return meta + " · " + applocale.getString("row/paused", "Paused");
    }

    if (task != null) {
        var remainingSeconds = getRemainingSeconds(task, (task.TotalSize || 0) - (task.DoneSize || 0));
        if (remainingSeconds > 0) {
            meta += " · " + applocale.getString("row/remaining", "{t} remaining").replace("{t}", formatDuration(remainingSeconds));
        }
    }
    return meta;
}

/* ---------------------------------------------------------------
    Controls
--------------------------------------------------------------- */

window.toggleOperationPause = function(oprid, currentlyPaused) {
    //Flip the button straight away instead of waiting for the next status tick
    pausedOverride[oprid] = currentlyPaused ? FSOPR_CONTINUE : FSOPR_PAUSE;
    sendControl(currentlyPaused ? "continue" : "pause", oprid);
    render();
}

window.cancelOperation = function(oprid) {
    delete pausedOverride[oprid];
    sendControl("cancel", oprid);
}

//Dismiss a stopped operation from the listing
window.removeOperation = function(oprid) {
    delete pausedOverride[oprid];
    delete rateSamples[oprid];
    latestTasks = latestTasks.filter(function(task) {
        return task.ID != oprid;
    });
    sendControl("remove", oprid);
    render();
}

//The control signal of an operation, preferring the state the user just asked for
function operationIsPaused(task) {
    var override = pausedOverride[task.ID];
    if (override !== undefined) {
        return override == FSOPR_PAUSE;
    }
    return task.FileOperationSignal == FSOPR_PAUSE;
}

//Drop the local pause states the backend has caught up with
function clearConfirmedPauseOverrides() {
    latestTasks.forEach(function(task) {
        if (pausedOverride[task.ID] !== undefined &&
            (pausedOverride[task.ID] == task.FileOperationSignal || taskIsFinished(task))) {
            delete pausedOverride[task.ID];
        }
    });
}

window.clearCompleted = function() {
    //Drop the client side only records straight away
    latestTasks = latestTasks.filter(function(task) {
        return !(task.LocalOnly === true);
    });
    sendControl("clear");
    render();
}

window.cancelAll = function() {
    latestTasks.forEach(function(task) {
        if (!taskIsFinished(task)) {
            delete pausedOverride[task.ID];
            sendControl("cancel", task.ID);
        }
    });
    //Drop the operations that have not been started yet
    pendingOperations = [];
    render();
}

function sendControl(command, oprid) {
    if (statusSocket != null && statusSocket.readyState == 1) {
        statusSocket.send(JSON.stringify({ cmd: command, oprid: oprid || "" }));
        return;
    }

    //No usable socket. Use the control endpoint instead.
    $.ajax({
        url: "../../system/file_system/ongoing",
        method: "POST",
        data: { oprid: oprid || "", flag: command },
        success: function(data) {
            if (data.error != undefined) {
                console.log("[File Operation] " + data.error);
            }
            requestStatusUpdate();
        }
    });
}

window.toggleCollapse = function() {
    collapsed = !collapsed;
    $("#dialog").toggleClass("collapsed", collapsed);
    $("#collapseBtn").find("i").attr("class", (collapsed ? "chevron up icon" : "chevron down icon"));
    $("#collapseBtn").attr("title", collapsed ?
        applocale.getString("button/expand", "Expand") :
        applocale.getString("button/collapse", "Collapse"));

    if (collapsed) {
        lastWindowHeight = Math.ceil($(".foheader").outerHeight(true) + $(".fosummary").outerHeight(true) +
            $(".fofooter").outerHeight(true) + windowChromeHeight);
        ao_module_setWindowSize(480, lastWindowHeight);
    } else {
        lastContentHeight = 0;
        resizeToContent();
    }
}

window.closeDialog = function() {
    //The operations keep running on the server, the desktop background task
    //panel and this dialog will pick them up again when reopened
    ao_module_close();
    setTimeout(function() {
        //If ao_module_close is not working for some reason
        open(location, "_self").close();
    }, 500);
}

/* ---------------------------------------------------------------
    Completion handling
--------------------------------------------------------------- */

function handleTaskCompletion(task) {
    if (!taskIsFinished(task) || completedHandled[task.ID]) {
        return;
    }
    completedHandled[task.ID] = true;

    var config = operationConfigs[task.ID];
    if (config == undefined) {
        //Started by another window. Still refresh the desktop if it is affected.
        refreshDesktopIfAffected(task.Src, task.Dest);
        return;
    }

    if (task.Status != "completed") {
        //Failed or cancelled operations do not fire their success callback
        return;
    }

    //Fire the callback of the window that requested this operation
    try {
        if (config.callbackWindowID == "desktop" && config.callbackFunction) {
            parent.eval(config.callbackFunction);
        } else if (ao_module_virtualDesktop && config.callbackWindowID !== undefined && config.callbackFunction !== undefined) {
            var callbackWindowObject = parent.getFloatWindowByID(config.callbackWindowID);
            var windowObject = $(callbackWindowObject).find("iframe")[0];
            if (windowObject != undefined && windowObject != null) {
                windowObject.contentWindow.eval(config.callbackFunction);
            }
        }
    } catch (ex) {
        console.log("[File Operation] Callback failed", ex);
    }

    refreshDesktopIfAffected(config.src[0], config.dest);

    if (config.opr == "unzipAndOpen") {
        ao_module_openPath(config.dest);
    }
}

function refreshDesktopIfAffected(src, dest) {
    if (!ao_module_virtualDesktop) {
        return;
    }
    if (pathIsOnDesktop(dest) || pathIsOnDesktop(src)) {
        try {
            parent.refresh(undefined, true);
        } catch (ex) {
            console.log("[File Operation] Desktop refresh failed", ex);
        }
    }
}

function pathIsOnDesktop(path) {
    if (typeof path != "string") {
        return false;
    }
    var filteredDest = path;
    if (filteredDest.substr(filteredDest.length - 1) == "/") {
        filteredDest = filteredDest.substr(0, filteredDest.length - 1);
    }
    var dirChunk = filteredDest.split("/");
    if (dirChunk.length == 2 || dirChunk.length == 3) {
        if (dirChunk[0].toLowerCase() == "user:" && dirChunk[1].toLowerCase() == "desktop") {
            return true;
        }
    }
    return false;
}

/* ---------------------------------------------------------------
    Auto close
--------------------------------------------------------------- */

//Close the dialog shortly after everything finished without problems, so a
//single quick copy does not leave a window behind on the desktop
function scheduleAutoCloseIfDone(ongoingCount) {
    if (!everHadOperation || ongoingCount > 0) {
        //Something is still running
        cancelAutoClose();
        return;
    }

    /*
        Nothing is running any more. The dialog closes itself when there is
        nothing left worth reading: every operation succeeded, or the user has
        already dismissed the ones that did not. An operation that failed or was
        stopped stays on screen until the user removes it or clears the list.
    */
    var needsAttention = latestTasks.some(function(task) {
        return task.Status != "completed";
    });

    if (needsAttention || userIsInteracting) {
        cancelAutoClose();
        return;
    }

    if (autoCloseTimer == null) {
        autoCloseTimer = setTimeout(function() {
            autoCloseTimer = null;
            if (!userIsInteracting) {
                closeDialog();
            }
        }, AUTOCLOSE_DELAY);
    }
}

function cancelAutoClose() {
    if (autoCloseTimer != null) {
        clearTimeout(autoCloseTimer);
        autoCloseTimer = null;
    }
}

/* ---------------------------------------------------------------
    Helpers
--------------------------------------------------------------- */

function taskIsFinished(task) {
    return task.Status != "ongoing" && task.Status != "pending";
}

function basename(path) {
    return String(path || "").replace(/\/+$/, "").split("/").pop();
}

function dirname(path) {
    var chunks = String(path || "").replace(/\/+$/, "").split("/");
    chunks.pop();
    return chunks.join("/") + "/";
}

function isFolderPath(path) {
    return typeof path == "string" && path.length > 0 && path.substr(path.length - 1) == "/";
}

function formatBytes(bytes) {
    if (typeof ao_module_utils != "undefined" && ao_module_utils.formatBytes) {
        return ao_module_utils.formatBytes(bytes);
    }
    if (!bytes || bytes < 0) {
        return "0 B";
    }
    var units = ["B", "KB", "MB", "GB", "TB"];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    if (i >= units.length) {
        i = units.length - 1;
    }
    return (bytes / Math.pow(1024, i)).toFixed(2) + " " + units[i];
}

function formatDuration(seconds) {
    seconds = Math.ceil(seconds);
    if (seconds >= 3600) {
        var hours = Math.round(seconds / 3600);
        return applocale.getString("time/hours", "{n} hour(s)").replace("{n}", hours);
    }
    if (seconds >= 60) {
        var minutes = Math.round(seconds / 60);
        return applocale.getString("time/minutes", "{n} minute(s)").replace("{n}", minutes);
    }
    return applocale.getString("time/seconds", "{n} second(s)").replace("{n}", seconds);
}

function centerTruncate(fullStr, strLen, separator) {
    fullStr = String(fullStr || "");
    if (fullStr.length <= strLen) {
        return fullStr;
    }
    separator = separator || "...";
    var charsToShow = strLen - separator.length;
    var frontChars = Math.ceil(charsToShow / 2);
    var backChars = Math.floor(charsToShow / 2);
    return fullStr.substr(0, frontChars) + separator + fullStr.substr(fullStr.length - backChars);
}

function escapeHtml(text) {
    return $("<div>").text(text == undefined ? "" : text).html();
}
