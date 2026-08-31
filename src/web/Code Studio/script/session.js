/*
    Code Studio — recent projects and per project workspace state

    Two kinds of memory:

      * the list of recently opened project folders, kept in the module
        database and shown under File > Open Recent
      * which tabs were open in a project and in what order, kept in
        <project>/.metadata/.codestudio.json so reopening the folder
        restores the workspace (see backend/session.agi)
*/

/* ═══════════════════════════════════════════════════════════════════
   Recently opened projects
   ═══════════════════════════════════════════════════════════════════ */

var CS_RECENT_KEY = "recentFolders";
var CS_RECENT_LIMIT = 8;

var csRecentFolders = [];       //[{path, name, time}], newest first

function loadRecentFolders(callback){
    getStorage(CS_RECENT_KEY, function(data){
        if (typeof data === "string"){
            try {
                var stored = JSON.parse(data);
                if (Array.isArray(stored)) csRecentFolders = stored;
            } catch(e){ /* corrupted list — start over */ }
        }
        if (callback) callback();
    });
}

function getRecentFolders(){ return csRecentFolders; }

function pushRecentFolder(path, name){
    if (!path) return;

    csRecentFolders = csRecentFolders.filter(function(entry){ return entry.path != path; });
    csRecentFolders.unshift({ path: path, name: name || path.split("/").filter(Boolean).pop(), time: Date.now() });
    if (csRecentFolders.length > CS_RECENT_LIMIT) csRecentFolders = csRecentFolders.slice(0, CS_RECENT_LIMIT);

    setStorage(CS_RECENT_KEY, JSON.stringify(csRecentFolders));
}

//The File menu addresses entries by index so paths never end up inside markup
function openRecentFolder(index){
    var entry = csRecentFolders[index];
    if (!entry) return;
    openProjectFolder([{ filename: entry.name, filepath: entry.path }]);
}

function clearRecentFolders(){
    csRecentFolders = [];
    setStorage(CS_RECENT_KEY, JSON.stringify(csRecentFolders));
    setStatusMessage("checkmark", "Recent project list cleared");
}

//"user:/Code/…/my-website" — keeps the menu narrow for deep paths
function shortenVirtualPath(path){
    if (!path) return "";
    if (path.length <= 34) return path;

    var parts = path.split("/").filter(Boolean);
    if (parts.length <= 2) return path;
    return parts[0] + "/…/" + parts[parts.length - 1];
}

/* ═══════════════════════════════════════════════════════════════════
   Per project workspace state
   ═══════════════════════════════════════════════════════════════════ */

var csSessionSaveTimer = null;
var csProjectSessionRestoring = false;

function projectSessionCall(payload, callback){
    $.ajax({
        url: "../system/ajgi/interface?script=Code Studio/backend/session.agi",
        method: "POST",
        dataType: "json",
        data: payload,
        success: function(response){ if (callback) callback(response); },
        error: function(){ if (callback) callback({ success: false, error: "workspace state backend unreachable" }); }
    });
}

//Tabs of files that live inside the open project, in the order they appear
function projectSessionSnapshot(){
    if (!currentProjectFolder) return null;

    var root = currentProjectFolder;
    if (!root.endsWith("/")) root += "/";

    var files = [];
    editors.forEach(function(entry){
        entry.tabs.forEach(function(tab){
            if (!tab.filepath || tab.error || tab.virtual) return;
            if (tab.filepath.indexOf(root) !== 0) return;
            if (files.indexOf(tab.filepath) === -1) files.push(tab.filepath);
        });
    });

    var focused = getFocusedTabInfo();
    var active = (focused && focused.filepath && focused.filepath.indexOf(root) === 0) ?
                 focused.filepath : null;

    return { version: 1, folder: currentProjectFolder, files: files, active: active };
}

//Coalesce the bursts of tab changes that opening or closing files produces
function scheduleProjectSessionSave(){
    if (!currentProjectFolder || csProjectSessionRestoring) return;
    if (csSessionSaveTimer) clearTimeout(csSessionSaveTimer);
    csSessionSaveTimer = setTimeout(saveProjectSession, 800);
}

function saveProjectSession(){
    var snapshot = projectSessionSnapshot();
    if (snapshot == null) return;

    projectSessionCall({
        opr: "save",
        folder: currentProjectFolder,
        data: JSON.stringify(snapshot)
    }, function(response){
        if (!response.success) csLog("warn", "Could not save the workspace state: " + response.error);
    });
}

function restoreProjectSession(folderpath){
    projectSessionCall({ opr: "load", folder: folderpath }, function(response){
        if (!response.success || !response.session) return;

        var session = response.session;
        if (!session.files || session.files.length == 0) return;

        //Opening files must not immediately write the state back out
        csProjectSessionRestoring = true;
        session.files.forEach(function(filepath){ openFile(filepath, true); });

        //Give the reads time to land, then focus the tab that was active
        setTimeout(function(){
            if (session.active) focusFileTab(session.active);
            csProjectSessionRestoring = false;
        }, 600 + session.files.length * 120);

        csLog("info", "Restored " + session.files.length + " tab(s) from the last session");
    });
}

function forgetProjectSession(){
    if (!currentProjectFolder) return;
    projectSessionCall({ opr: "clear", folder: currentProjectFolder }, function(response){
        if (response.success) setStatusMessage("checkmark", "Saved tabs of this project forgotten");
    });
}

//Focus the tab holding a given file, in whichever editor group has it
function focusFileTab(filepath){
    for (var i = 0; i < editors.length; i++){
        var entry = editors[i];
        for (var j = 0; j < entry.tabs.length; j++){
            if (entry.tabs[j].filepath == filepath){
                focusedEditor = entry.uuid;
                changeTab(entry, entry.tabs[j].tabUUID);
                return true;
            }
        }
    }
    return false;
}
