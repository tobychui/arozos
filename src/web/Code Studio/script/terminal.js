/*
    Code Studio — integrated terminal

    Each session is an independent WebSocket to the Terminal web app's
    REPL backend (Terminal/backend/session.agi), so a session keeps one
    persistent Otto VM: variables defined in one command survive into the
    next, requirelib() works, and typing "bash()" drops into the virtual
    file system shell — exactly like the standalone Terminal app.

    Protocol (see Terminal/backend/session.agi)
      client → server : {type:"exec", code}  {type:"ping"}  {type:"complete", line}
      server → client : ready | result | shellmode | clear | pong | complete
*/

var csTerminals = [];           //All live sessions
var csActiveTerminal = null;    //id of the focused session
var csTerminalCounter = 0;

function terminalEndpoint(){
    var scheme = (location.protocol === "https:") ? "wss://" : "ws://";
    return scheme + location.host + "/system/ajgi/interface?script=Terminal/backend/session.agi";
}

function getTerminal(id){
    for (var i = 0; i < csTerminals.length; i++){
        if (csTerminals[i].id == id) return csTerminals[i];
    }
    return null;
}

function getActiveTerminal(){ return getTerminal(csActiveTerminal); }

/* ═══════════════════════════════════════════════════════════════════
   Session lifecycle
   ═══════════════════════════════════════════════════════════════════ */

function newTerminalSession(){
    csTerminalCounter++;

    var session = {
        id: "term" + csTerminalCounter,
        index: csTerminalCounter,
        name: "agi",
        ready: false,
        everReady: false,       //true once the backend has sent its ready frame
        shellMode: false,
        prompt: ">",
        history: [],
        historyIndex: -1,
        lastTabLine: null,
        suppressResults: 0,     //replies to editor-issued commands still to swallow
        ws: null
    };

    $("#terminalStack").append(
        '<div class="terminstance" data-term="' + session.id + '">' +
            '<div class="termout" id="' + session.id + '-out" onclick="focusTerminalInput(\'' + session.id + '\');"></div>' +
            '<div class="terminputrow">' +
                '<span class="prompt" id="' + session.id + '-prompt">&gt;</span>' +
                '<input type="text" id="' + session.id + '-in" autocomplete="off" autocorrect="off" ' +
                       'spellcheck="false" placeholder="JavaScript / AGI…" ' +
                       'onkeydown="handleTerminalKey(event, \'' + session.id + '\');">' +
            '</div>' +
            '<div class="termstatus">' +
                '<span class="conndot connecting" id="' + session.id + '-dot"></span>' +
                '<span id="' + session.id + '-status">Connecting…</span>' +
                '<span style="flex:1;"></span>' +
                '<span class="iconbtn" title="Reconnect" onclick="reconnectTerminal(\'' + session.id + '\');">' +
                    '<i class="refresh icon"></i></span>' +
            '</div>' +
        '</div>');

    csTerminals.push(session);
    connectTerminal(session);
    renderTerminalSessionList();
    selectTerminal(session.id);
    togglePanel(true);
    showPanelView("terminal");
    return session;
}

function connectTerminal(session){
    setTerminalConnection(session, "connecting", "Connecting…");

    try {
        session.ws = new WebSocket(terminalEndpoint());
    } catch(e){
        setTerminalConnection(session, "error", "Cannot open a session");
        return;
    }

    session.ws.onmessage = function(event){
        var message;
        try { message = JSON.parse(event.data); } catch(e){ return; }
        handleTerminalMessage(session, message);
    };

    session.ws.onclose = function(){
        var neverStarted = !session.everReady;
        session.ready = false;
        setTerminalConnection(session, "error", "Disconnected");

        if (neverStarted){
            //The gateway authorises an AGI script by the module it belongs to,
            //so the session backend needs the Terminal module permission.
            termLine(session, "err", "✕ Could not start a session.");
            termLine(session, "sys", "# The terminal runs the Terminal module's AGI session backend, so your");
            termLine(session, "sys", "# account needs access to the Terminal module. Ask an administrator to");
            termLine(session, "sys", "# grant it, then press the refresh button below.");
        } else {
            termLine(session, "sys", "# Session closed. Use the refresh button to start a new one.");
        }
    };

    session.ws.onerror = function(){
        setTerminalConnection(session, "error", "Connection error");
    };
}

function reconnectTerminal(id){
    var session = getTerminal(id);
    if (!session) return;
    if (session.ws){
        try { session.ws.close(); } catch(e){ /* already closed */ }
    }
    connectTerminal(session);
}

function killActiveTerminal(){
    if (!csActiveTerminal) return;
    killTerminal(csActiveTerminal);
}

function killTerminal(id){
    var session = getTerminal(id);
    if (!session) return;

    if (session.ws){
        try { session.ws.close(); } catch(e){ /* already closed */ }
    }
    $('.terminstance[data-term="' + id + '"]').remove();
    csTerminals = csTerminals.filter(function(entry){ return entry.id != id; });

    if (csTerminals.length > 0){
        selectTerminal(csTerminals[csTerminals.length - 1].id);
    } else {
        csActiveTerminal = null;
    }
    renderTerminalSessionList();
}

function selectTerminal(id){
    csActiveTerminal = id;
    $(".terminstance").removeClass("active");
    $('.terminstance[data-term="' + id + '"]').addClass("active");
    $("#terminalSessions .row").removeClass("selected");
    $('#terminalSessions .row[data-term="' + id + '"]').addClass("selected");
    focusTerminalInput(id);
}

function renderTerminalSessionList(){
    var html = "";
    csTerminals.forEach(function(session){
        html += '<div class="row' + (session.id == csActiveTerminal ? " selected" : "") + '" ' +
                     'data-term="' + session.id + '" onclick="selectTerminal(\'' + session.id + '\');">' +
                    '<i class="terminal icon"></i>' +
                    '<span class="name">' + session.index + ': ' + escapeHTMLText(session.name) + '</span>' +
                    '<span class="rowbtn" title="Kill" onclick="event.stopPropagation(); killTerminal(\'' + session.id + '\');">' +
                        '<i class="trash alternate outline icon"></i></span>' +
                '</div>';
    });

    if (html == ""){
        html = '<div class="emptyhint" style="padding:10px 12px;">No sessions</div>';
    }
    $("#terminalSessions").html(html);
}

function focusTerminalInput(id){
    setTimeout(function(){ $("#" + id + "-in").focus(); }, 0);
}

function focusActiveTerminal(){
    if (csActiveTerminal) focusTerminalInput(csActiveTerminal);
}

/* ═══════════════════════════════════════════════════════════════════
   Output
   ═══════════════════════════════════════════════════════════════════ */

function termLine(session, type, text){
    var out = document.getElementById(session.id + "-out");
    if (!out) return;
    var line = document.createElement("div");
    line.className = "tl tl-" + type;
    line.textContent = text;
    out.appendChild(line);
    out.scrollTop = out.scrollHeight;
}

function clearActiveTerminal(){
    var session = getActiveTerminal();
    if (!session) return;
    $("#" + session.id + "-out").html("");
}

function setTerminalConnection(session, state, text){
    $("#" + session.id + "-dot").attr("class", "conndot " + state);
    $("#" + session.id + "-status").text(text);
}

function setTerminalPrompt(session, prompt, placeholder){
    session.prompt = prompt;
    $("#" + session.id + "-prompt").text(prompt);
    $("#" + session.id + "-in").attr("placeholder", placeholder);
}

/* ═══════════════════════════════════════════════════════════════════
   Server messages
   ═══════════════════════════════════════════════════════════════════ */

function handleTerminalMessage(session, message){
    if (message.type === "ready"){
        session.ready = true;
        session.everReady = true;
        setTerminalConnection(session, "connected", "Connected — " + message.user);
        termLine(session, "sys", "# ArozOS terminal " + (message.build || "") + "  |  user: " + message.user);
        termLine(session, "sys", "# Type 'exit' to drop into the AGI runtime, where variables persist.");
        termLine(session, "dim", "");
        enterShellMode(session);
        return;
    }

    if (message.type === "shellmode"){
        session.shellMode = message.active;
        if (message.active){
            session.name = "shell";
            setTerminalPrompt(session, message.prompt || "$ ", "shell command…");
            //The greeting already explains shell mode when the editor opened it
            if (session.autoShell){
                session.autoShell = false;
            } else {
                termLine(session, "sys", "# Shell mode — virtual file system. Type 'exit' to return to the AGI runtime.");
            }
        } else {
            session.name = "agi";
            setTerminalPrompt(session, ">", "JavaScript / AGI…");
            termLine(session, "sys", "# Returned to the AGI runtime.");
        }
        renderTerminalSessionList();
        return;
    }

    if (message.type === "clear"){
        $("#" + session.id + "-out").html("");
        return;
    }

    if (message.type === "complete"){
        applyTerminalCompletion(session, message.candidates || [], message.partial || "");
        return;
    }

    if (message.type === "result"){
        if (message.shellPrompt) setTerminalPrompt(session, message.shellPrompt, "shell command…");

        //Replies to commands the editor issued itself — only errors are worth showing
        if (session.suppressResults > 0){
            session.suppressResults--;
            if (message.error && message.output){
                termLine(session, "err", String(message.output));
            }
            return;
        }

        if (message.logs && message.logs.length){
            message.logs.forEach(function(entry){ termLine(session, "log", "· " + entry); });
        }

        if (session.shellMode){
            if (message.output){
                String(message.output).split("\n").forEach(function(line){
                    termLine(session, message.error ? "err" : "ok", line);
                });
            }
            return;
        }

        if (message.error){
            termLine(session, "err", "✕ " + message.output);
        } else if (message.output !== "" && message.output !== undefined){
            String(message.output).split("\n").forEach(function(line, index){
                termLine(session, "ok", (index === 0 ? "← " : "  ") + line);
            });
        } else {
            termLine(session, "dim", "← undefined");
        }
    }
}

/*
    A terminal is more useful as a shell than as a bare REPL, so a fresh session
    is dropped into the virtual file system shell straight away and moved to the
    open project folder. Both commands are queued in order — the backend runs
    them sequentially — and their (empty) replies are swallowed so the session
    starts on a clean prompt.
*/
function enterShellMode(session){
    session.autoShell = true;
    session.suppressResults = 1;
    terminalSend(session, { type: "exec", code: "bash()" });

    if (currentProjectFolder){
        session.suppressResults++;
        terminalSend(session, { type: "exec", code: 'cd "' + currentProjectFolder + '"' });
    }
}

function terminalSend(session, payload){
    if (session.ws && session.ws.readyState === WebSocket.OPEN){
        session.ws.send(JSON.stringify(payload));
        return true;
    }
    return false;
}

//Keep every session alive through the AGI gateway's idle timeout
setInterval(function(){
    csTerminals.forEach(function(session){ terminalSend(session, { type: "ping" }); });
}, 30000);

/* ═══════════════════════════════════════════════════════════════════
   Input handling
   ═══════════════════════════════════════════════════════════════════ */

function handleTerminalKey(event, id){
    var session = getTerminal(id);
    if (!session) return;
    var input = document.getElementById(id + "-in");

    if (event.key === "Enter"){
        event.preventDefault();
        submitTerminalInput(session);
        return;
    }

    if (event.key === "ArrowUp"){
        event.preventDefault();
        if (session.history.length == 0) return;
        if (session.historyIndex == -1) session.historyIndex = session.history.length;
        session.historyIndex = Math.max(0, session.historyIndex - 1);
        input.value = session.history[session.historyIndex];
        return;
    }

    if (event.key === "ArrowDown"){
        event.preventDefault();
        if (session.historyIndex == -1) return;
        session.historyIndex++;
        if (session.historyIndex >= session.history.length){
            session.historyIndex = -1;
            input.value = "";
        } else {
            input.value = session.history[session.historyIndex];
        }
        return;
    }

    if (event.key === "Tab"){
        event.preventDefault();
        if (!session.shellMode) return;         //completion is a shell-mode feature
        session.lastTabLine = input.value;
        terminalSend(session, { type: "complete", line: input.value });
        return;
    }

    if (event.key === "l" && (event.ctrlKey || event.metaKey)){
        event.preventDefault();
        $("#" + id + "-out").html("");
        return;
    }
}

function submitTerminalInput(session){
    var input = document.getElementById(session.id + "-in");
    var code = input.value;
    input.value = "";
    session.historyIndex = -1;

    if (code.trim() !== ""){
        session.history.push(code);
        if (session.history.length > 200) session.history.shift();
    }

    termLine(session, "in", session.prompt + " " + code);

    //Local convenience commands, handled without a round trip
    if (code.trim() === ".clear"){
        $("#" + session.id + "-out").html("");
        return;
    }
    if (code.trim() === ".help"){
        termLine(session, "sys", "# .clear            clear this terminal");
        termLine(session, "sys", "# .run              run the file in the active editor");
        termLine(session, "sys", "# bash()            enter the virtual file system shell");
        termLine(session, "sys", "# help              (in shell mode) list shell commands");
        return;
    }
    if (code.trim() === ".run"){
        runCurrentFileInTerminal();
        return;
    }

    if (!session.ready){
        termLine(session, "err", "✕ Session is not connected.");
        return;
    }

    terminalSend(session, { type: "exec", code: code });
}

function applyTerminalCompletion(session, candidates, partial){
    if (candidates.length == 0) return;
    var input = document.getElementById(session.id + "-in");

    if (candidates.length == 1){
        var line = input.value;
        input.value = line.substring(0, line.length - partial.length) + candidates[0];
        return;
    }

    //Multiple matches — complete the shared prefix and list the options
    var prefix = candidates[0];
    candidates.forEach(function(candidate){
        while (candidate.indexOf(prefix) !== 0 && prefix.length > 0){
            prefix = prefix.substring(0, prefix.length - 1);
        }
    });

    if (prefix.length > partial.length){
        var current = input.value;
        input.value = current.substring(0, current.length - partial.length) + prefix;
    }

    termLine(session, "dim", candidates.join("   "));
}

/* ═══════════════════════════════════════════════════════════════════
   Editor integration
   ═══════════════════════════════════════════════════════════════════ */

//Evaluate the buffer of the active editor inside the focused terminal
function runCurrentFileInTerminal(){
    var editorObject = getFocusedEditorObject();
    var tabInfo = getFocusedTabInfo();
    if (!editorObject || !tabInfo){
        setStatusMessage("info circle", "Open a file before running it");
        return;
    }

    var ext = tabInfo.filename.split(".").pop().toLowerCase();
    if (ext != "agi" && ext != "js"){
        if (!confirm("Only .agi and .js files run inside the AGI runtime.\nRun " + tabInfo.filename + " anyway?")) return;
    }

    togglePanel(true);
    showPanelView("terminal");

    var session = getActiveTerminal();
    if (!session){
        session = newTerminalSession();
        //The socket needs a moment before the first exec can be sent
        setTimeout(function(){ runCurrentFileInTerminal(); }, 900);
        return;
    }

    //Sessions start in shell mode, but a script has to run in the AGI runtime
    if (session.shellMode){
        session.suppressResults++;
        terminalSend(session, { type: "exec", code: "exit" });
    }

    var code = editorObject.editor.getValue();
    termLine(session, "sys", "# Running " + (tabInfo.filepath || tabInfo.filename));
    csLog("info", "Running " + (tabInfo.filepath || tabInfo.filename) + " in terminal " + session.index);

    if (!terminalSend(session, { type: "exec", code: code })){
        termLine(session, "err", "✕ Session is not connected.");
    }
}
