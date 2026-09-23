/*
    ArOZ Online Module Javascript Wrapper

    This is a wrapper for module developers to access system API easier and need not to dig through the source code.
    Basically: Write less do more (?)
    WARNING! SOME FUNCTION ARE NOT COMPATIBILE WITH PREVIOUS VERSION OF AO_MODULE.JS.
    PLEASE REFER TO THE SYSTEM DOCUMENTATION FOR MORE INFORMATION.

    *** Please include this javascript file with relative path instead of absolute path.
    E.g. ../script/ao_module.js (OK)
           /script/ao_module.js (NOT OK)
*/
var ao_module_virtualDesktop = false;
try{
    ao_module_virtualDesktop = !(!parent.isDesktopMode);
}catch(ex){
    //Running ArozOS inside iframe for some reason
    console.log("CORS Access Error. Entering compatibility mode with virtual desktop mode disabled.");
}

var ao_root = null;
//Get the current windowID if in Virtual Desktop Mode, return false if VDI is not detected
var ao_module_windowID = false;
var ao_module_parentID = false;
var ao_module_callback = false;
var ao_module_ime = false;
if (ao_module_virtualDesktop)ao_module_windowID = $(window.frameElement).parent().parent().attr("windowId");
if (ao_module_virtualDesktop)ao_module_parentID = $(window.frameElement).parent().parent().attr("parent");
if (ao_module_virtualDesktop)ao_module_callback = $(window.frameElement).parent().parent().attr("callback");
if (ao_module_virtualDesktop)ao_module_parentURL = $(window.frameElement).parent().find("iframe").attr("src");
ao_root = ao_module_getAORootFromScriptPath();

/*
    Event bindings
    The following events are required for ao_module to operate normally 
    under Web Desktop Mode. 
*/

document.addEventListener("DOMContentLoaded", function() {
    if (ao_module_virtualDesktop){
        if (parent.window.ime == null){
            return;
        }
        //Add window focus handler
        document.addEventListener("mousedown", function(event) {
            //When click on this document, focus this
            ao_module_focus();

            if (event.target.tagName == "INPUT" || event.target.tagName == "TEXTAREA"){

            }else{
                if (parent.window.ime.focus != null){
                    if (ao_module_ime){
                        //This is clicking on ime windows. Do not change focus
                    }else{
                        parent.window.ime.focus = null;
                    }
                }
            }
        }, true);
    
        //Add IME registration handler
        var inputFields = document.querySelectorAll("input,textarea");
        for (var i = 0; i < inputFields.length; i++){
            if ($(inputFields[i]).attr("type") != undefined){
                var thisType = $(inputFields[i]).attr("type");
                if ((thisType == "text" || thisType =="search" || thisType =="url")){
                    //Supported types of input
                    ao_module_bindCustomIMEEvents(inputFields[i]);
                }else{
                    //Not supported type of inputs

                }
            }else{
                //text area
                ao_module_bindCustomIMEEvents(inputFields[i]);
            }
        }
    }
    /*
     //Load html2canvas
     if ($){
        $.getScript(ao_root + "script/html2canvas.min.js", function() {
            console.log("Html2canvas loaded")
        });
    }
    */
});

/*
    Startup Section Script
    
    These functions handle the startup of an ao_module and adapt them into the
    standard arozos desktop eco-system api
*/

//Function handle to bind custom IME events
function ao_module_bindCustomIMEEvents(object){
    parent.bindObjectToIMEEvents(object);
}

function ao_module_screenshot(callback){
    html2canvas(document.querySelector("body")).then(screenshot => {
        return callback(screenshot);
    });
}

//Get the ao_root from script includsion path
function ao_module_getAORootFromScriptPath(){
    var possibleRoot = "";
    $("script").each(function(){
        if (this.hasAttribute("src") && $(this).attr("src").includes("ao_module.js")){
            var tmp = $(this).attr("src");
            tmp = tmp.split("script/ao_module.js");
            possibleRoot = tmp[0];
        }
    });
    return possibleRoot;
}

//Get the input filename and filepath from the window hash paramter
function ao_module_loadInputFiles(){
    try{
        if (window.location.hash.length == 0){
            return null;
        }
        var inputFileInfo = window.location.hash.substring(1,window.location.hash.length);
        inputFileInfo = JSON.parse(decodeURIComponent(inputFileInfo));

        if (inputFileInfo.length == 0){
            return null;
        }
        return inputFileInfo
    }catch{
        return null;
    }
}

//Set the ao_module window to fixed size (not allowing resize)
function ao_module_setFixedWindowSize(){
    if (!ao_module_virtualDesktop){
        return;
    }
    parent.setFloatWindowResizePolicy(ao_module_windowID, false);
}

//Restore a float window to be resizble
function ao_module_setResizableWindowSize(){
    if (!ao_module_virtualDesktop){
        return;
    }
    parent.setFloatWindowResizePolicy(ao_module_windowID, true);
}

//Update the window size of the given float window object
function ao_module_setWindowSize(width, height){
    if (!ao_module_virtualDesktop){
        return;
    }
    parent.setFloatWindowSize(ao_module_windowID, width, height)
}

//Update the floatWindow title
function ao_module_setWindowTitle(newTitle){
    if (!ao_module_virtualDesktop){
        document.title = newTitle;
        return;
    }
    parent.setFloatWindowTitle(ao_module_windowID, newTitle);
}   

//Set new window theme, default dark, support {dark/white}
function ao_module_setWindowTheme(newtheme="dark"){
    if (!ao_module_virtualDesktop){
        return;
    }
    parent.setFloatWindowTheme(ao_module_windowID, newtheme);
}

// ao_module_getSystemThemeColor(callback) => Get the global theme color of current system, and return the color value in callback function.
function ao_module_getSystemThemeColor(callback){
    $.get("../../system/file_system/preference?key=file_explorer/theme",function(data){
            callback(data);
    });
}

// ao_module_setSystemThemeColor(color, callback) => Set the global theme color of current system, and return the result in callback function if provided.
function ao_module_setSystemThemeColor(color, callback=undefined){
    $.ajax({
        url:"../../system/file_system/preference?key=file_explorer/theme&value=" + color,
        success: function(data){
            if (data.error !== undefined){
                console.log(data);
            }
            if (callback !== undefined){
                callback(data);
            }
        }
    });
}

//Check if there are any windows with the same path. 
//If yes, replace its hash content and reload to the new one and close the current floatWindow
function ao_module_makeSingleInstance(){
    $(window.parent.document).find(".floatWindow").each(function(){
        if ($(this).attr("windowid") == ao_module_windowID){
            return
        }
        var currentPath = window.location.pathname;
        if ("/" + $(this).find("iframe").attr('src').split("#").shift() == currentPath){
            //Another instance already running. Replace it with the current path
            $(this).find("iframe").attr('src', window.location.pathname.substring(1) + window.location.hash);
            $(this).find("iframe")[0].contentWindow.location.reload();
            //Move the other instant to top
            var targetfw = parent.getFloatWindowByID($(this).attr("windowid"))
            parent.MoveFloatWindowToTop(targetfw);
            //Close the instance
            ao_module_close();
            return true
        }
    });
    return false
}

//Use for cross frame communication, example: 
//let targetOpeningInstances = ao_module_getInstanceByPath("NotepadA/index.html")
function ao_module_getInstanceByPath(matchingPath){
    let targetInstance = "";
    $(window.parent.document).find(".floatWindow").each(function(){
        if ($(this).attr("windowid") == ao_module_windowID){
            return
        }
        let thisfwPath = $(this).find("iframe").attr('src').split("#").shift();
        if (thisfwPath == matchingPath){
            targetInstance = $(this).attr("windowid");
        }
    });

    if (targetInstance == ""){
        return null;
    }
        
    return parent.getFloatWindowByID(targetInstance);
}


//Close the current window
function ao_module_close(){
    ao_module_closeHandler();
}

//Close handler for WebApp special handling of ao_module_close()
function ao_module_closeHandler(){
    if (!ao_module_virtualDesktop){
        window.close('','_parent','');
        window.location.href = ao_root + "SystemAO/closeTabInsturction.html";
        return;
    }
    parent.closeFwProcess(ao_module_windowID);
}

//Focus this floatWindow
function ao_module_focus(){
    parent.MoveFloatWindowToTop(parent.getFloatWindowByID(ao_module_windowID));
}

//Set the floatWindow to top most mode
function ao_module_setTopMost(){
    parent.PinFloatWindowToTopMostMode(parent.getFloatWindowByID(ao_module_windowID));
}

//Unset the floatWindow top most mode
function ao_module_unsetTopMost(){
    parent.UnpinFloatWindowFromTopMostMode(parent.getFloatWindowByID(ao_module_windowID));
}

//Popup a file selection window for upload
//callback(files) must be a window scoped global function of the calling window.
//do not use inline callback function like ao_module_selectFiles(function(files){...}) as it will not work, 
//instead, define a global function first and then pass the function name as string to the callback parameter, e.g. ao_module_selectFiles("myCallbackFunction", "file", "*", true);
function ao_module_selectFiles(callback, fileType="file", accept="*", allowMultiple=false){
    var input = document.createElement('input');
    input.type = fileType;
    input.multiple = allowMultiple;
    input.accept = accept;
    input.onchange = e => { 
        var files = e.target.files; 
        callback(files);
    }
    input.click();
}

//Open a path with File Manager, optional highligh filename
function ao_module_openPath(path, filename=undefined){
    //Trim away the last / if exists
    if (path.substr(path.length - 1, 1) == "/"){
        path = path.substr(0, path.length - 1);
    }

    if (filename == undefined){
        if (ao_module_virtualDesktop){
            parent.newFloatWindow({
                url: "SystemAO/file_system/file_explorer.html#" + encodeURIComponent(path),
                appicon: "SystemAO/file_system/img/small_icon.png",
                width:1080,
                height:580,
                title: "File Manager"
            });
        }else{
            window.open(ao_root + "SystemAO/file_system/file_explorer.html#" + encodeURIComponent(path))
        }
    }else{
        var fileObject = [{
            filepath: path + "/" + filename,
            filename: filename,
        }];
        if (ao_module_virtualDesktop){
            parent.newFloatWindow({
                url: "SystemAO/file_system/file_explorer.html#" + encodeURIComponent(JSON.stringify(fileObject)),
                appicon: "SystemAO/file_system/img/small_icon.png",
                width:1080,
                height:580,
                title: "File Manager"
            });
        }else{
            window.open(ao_root + "SystemAO/file_system/file_explorer.html#" + encodeURIComponent(JSON.stringify(fileObject)))
        }
    }

   
}

/*
    ao_module_requestSchedulerPermission(options, callback)

    Show a permission dialog asking the user to allow the calling app to register
    a background scheduled task on their behalf.

    options = {
        appName:     "My App",           // Display name of the requesting app
        appIcon:     "MyApp/img/icon.png", // Optional icon path (relative to web root)
        taskName:    "MyApp_DailySync",  // Unique task identifier (max 32 chars)
        scriptName:  "cron.agi",         // Filename inside the app folder (next to init.agi); defaults to "cron.agi"
        interval:    86400,              // Execution interval in seconds
        base:        0,                  // Base unix timestamp (0 = now)
        description: "Daily sync task"   // Optional description shown in popup
    }

    callback(result):
        result.allowed  => true if the user approved and the scheduler was registered
        result.taskName => the task name that was registered
*/
function ao_module_requestSchedulerPermission(options, callback) {
    if (!options || !options.taskName) {
        console.error("[ao_module] requestSchedulerPermission: missing required options (taskName)");
        if (typeof callback === 'function') callback({allowed: false, error: "invalid options"});
        return;
    }
    if (!options.scriptName) options.scriptName = "cron.agi";
    if (!options.appName)    options.appName    = document.title || "Application";
    if (!options.interval)   options.interval   = 86400;
    if (!options.base)       options.base       = Math.floor(Date.now() / 1000);
    if (!options.description) options.description = "";

    var callbackFnName = "_spCallback_" + Date.now();
    window[callbackFnName] = function(result) {
        delete window[callbackFnName];
        if (typeof callback === 'function') callback(result);
    };

    var encoded = encodeURIComponent(JSON.stringify(options));
    var url = "SystemAO/arsm/scheduler_permission.html#" + encoded;

    if (ao_module_virtualDesktop) {
        ao_module_newfw({
            url: url,
            width: 400,
            height: 480,
            appicon: "SystemAO/arsm/img/scheduler.png",
            title: "Scheduler Permission",
            parent: ao_module_windowID,
            callback: callbackFnName
        });
    } else {
        // Non-desktop mode: open popup window and poll localStorage
        var listenerKey = "spResult_" + Date.now();
        var popupWin = window.open(ao_root + url, "_blank", "width=400,height=480");
        var pollInterval = setInterval(function() {
            var stored = localStorage.getItem(listenerKey);
            if (stored !== null && stored !== undefined) {
                clearInterval(pollInterval);
                localStorage.removeItem(listenerKey);
                try {
                    var result = JSON.parse(stored);
                    if (typeof callback === 'function') callback(result);
                } catch(e) {
                    if (typeof callback === 'function') callback({allowed: false});
                }
            }
            if (popupWin && popupWin.closed) {
                clearInterval(pollInterval);
                if (typeof callback === 'function') callback({allowed: false});
            }
        }, 300);
    }
}

//Open a particular tab using System Setting module. Require
//1) Setting Group
//2) Setting Name
function ao_module_openSetting(group, name){
    var requestObject = {
        group: group,
        name: name
    }

    requestObject = encodeURIComponent(JSON.stringify(requestObject));
    var openURL = "SystemAO/system_setting/index.html#" + requestObject;
    if (ao_module_virtualDesktop){
        ao_module_newfw({
            url: openURL,
            width: 1080,
            height: 580,
            appicon: "SystemAO/system_setting/img/small_icon.png",
            title: "System Setting"
        });
    }else{
        window.open(ao_root + openURL)
    }
}


/*
    ao_module_newfw(launchConfig) => Create a new floatWindow object from the given paramters

    Most basic usage: (With auto assign UID, size and location)
    ao_module_newfw({
        url: "Dummy/index.html",
        title: "Dummy Module",
        appicon: "Dummy/img/icon.png"
    });

    Example usage that involve all configs:
    ao_module_newfw({
        url: "Dummy/index.html",
        uid: "CustomUUID",
        width: 1024,
        height: 768,
        appicon: "Dummy/img/icon.png",
        title: "Dummy Module",
        left: 100,
        top: 100,
        parent: ao_module_windowID,
        callback: "childCallbackHandler"
    });
*/
function ao_module_newfw(launchConfig){
    if (launchConfig["parent"] == undefined){
        launchConfig["parent"] = ao_module_windowID;
    }
    if (ao_module_virtualDesktop){
        parent.newFloatWindow(launchConfig);
    }else{
        window.open(ao_root + launchConfig.url);
    }
}

/*
    ao_module_startFileOperation(oprConfig)

    Start a move / copy / zip / unzip operation and show it in the system wide
    file operation dialog. There is only ever one of those dialogs open: when it
    is already running the operation is handed over to it instead of opening
    another window with another status connection.

    Example:
        ao_module_startFileOperation({
            opr: "copy",                            //move / copy / zip / unzip / unzipAndOpen
            src: ["user:/Desktop/test.txt"],        //Source file list
            dest: "user:/Documents/",               //Destination folder
            overwriteMode: "ask",                   //skip / overwrite / keep / ask (optional)
            callbackWindowID: ao_module_windowID,   //Window to notify when done (optional)
            callbackFunction: "refreshList()"       //Function to call on that window (optional)
        });
*/
function ao_module_startFileOperation(oprConfig){
    if (ao_module_virtualDesktop){
        parent.startFileOperation(oprConfig);
        return;
    }

    //Standalone mode. Reuse the named window opened by the previous operation.
    var dialogURL = ao_root + "SystemAO/file_system/file_operation.html#" + encodeURIComponent(JSON.stringify(oprConfig));
    var existingDialog = null;
    try {
        existingDialog = window.open("", "arozFileOperationDialog");
    } catch(ex) {
        existingDialog = null;
    }

    if (existingDialog != null && typeof existingDialog.addFileOperation == "function"){
        existingDialog.addFileOperation(oprConfig);
        existingDialog.focus();
        return;
    }

    window.open(dialogURL, "arozFileOperationDialog", "width=500,height=470");
}

/*
    File Selector Path Memory

    Remembers the directory the user last worked in for each web app, so the file
    selector re-opens where the user left off instead of at the hardcoded path the
    app was written with. Everything lives in ONE localStorage entry
    (ao_module_fs_pathmemory) shaped like:

    {
        "version": 1,
        "scopes": {
            "Cine Studio": {
                "last": "user:/Desktop/myworkspace/",       //Last dir used anywhere in this app
                "actions": {"export": "user:/Desktop/out/"},//Last dir used per action
                "ts": 1700000000000                         //For LRU eviction
            }
        }
    }

    The scope name defaults to the web app folder name (e.g. "Cine Studio") and can
    be overridden with ao_module_setPathMemoryScope() for apps that want to share or
    split their memory.
*/
var ao_module_pathMemoryStorageKey = "ao_module_fs_pathmemory";
var ao_module_pathMemoryDefaultAction = "default";
var ao_module_pathMemoryMaxScopes = 64;     //Evict least recently used scopes past this
var ao_module_pathMemoryScopeOverride = null;

//Override the auto-derived path memory scope of this window, e.g. "Office"
function ao_module_setPathMemoryScope(scopeName){
    if (typeof(scopeName) == "string" && scopeName.trim() != ""){
        ao_module_pathMemoryScopeOverride = scopeName.trim();
    }else{
        ao_module_pathMemoryScopeOverride = null;
    }
}

//Get the path memory scope of this window. Derived from the web app folder name
//by trimming the ArozOS web root prefix off the current pathname using ao_root.
function ao_module_getPathMemoryScope(){
    if (ao_module_pathMemoryScopeOverride != null){
        return ao_module_pathMemoryScopeOverride;
    }
    try{
        var segments = (window.location.pathname || "").split("/").filter(function(s){
            return s.length > 0;
        });
        //Drop the trailing filename, if the URL carries one
        if (segments.length > 0 && segments[segments.length - 1].indexOf(".") > 0){
            segments.pop();
        }
        //ao_root ("../../") tells us how deep this page sits inside the web root,
        //so the app folder survives ArozOS being hosted under a sub-path
        var depth = ((ao_root || "").match(/\.\.\//g) || []).length;
        if (depth > 0 && segments.length >= depth){
            segments = segments.slice(segments.length - depth);
        }
        if (segments.length > 0){
            return decodeURIComponent(segments[0]);
        }
    }catch(ex){
        //Malformed URL. Fall through to the shared scope
    }
    return "default";
}

//Read the whole path memory object out of localStorage
function ao_module_readPathMemory(){
    try{
        var raw = localStorage.getItem(ao_module_pathMemoryStorageKey);
        if (raw == null || raw == ""){
            return {version: 1, scopes: {}};
        }
        var parsed = JSON.parse(raw);
        if (parsed == null || typeof(parsed) != "object" || typeof(parsed.scopes) != "object" || parsed.scopes == null){
            return {version: 1, scopes: {}};
        }
        return parsed;
    }catch(ex){
        //Corrupted entry. Start over rather than breaking the file selector
        return {version: 1, scopes: {}};
    }
}

//Write the whole path memory object back, evicting the oldest scopes if needed
function ao_module_writePathMemory(memory){
    try{
        var names = Object.keys(memory.scopes);
        if (names.length > ao_module_pathMemoryMaxScopes){
            names.sort(function(a, b){
                return (memory.scopes[a].ts || 0) - (memory.scopes[b].ts || 0);
            });
            var overflow = names.length - ao_module_pathMemoryMaxScopes;
            for (var i = 0; i < overflow; i++){
                delete memory.scopes[names[i]];
            }
        }
        localStorage.setItem(ao_module_pathMemoryStorageKey, JSON.stringify(memory));
    }catch(ex){
        //Storage full or blocked (private mode). Path memory is best effort only
        console.log("[ao_module] Unable to save file selector path memory: " + ex);
    }
}

/*
    ao_module_getLastUsedPath(actionKey, scopeName)

    Return the directory this app last used, or "" if nothing has been recorded yet.
    Passing an actionKey returns that action's directory and falls back to the app
    wide one; passing false as the actionKey returns the app wide one directly.
*/
function ao_module_getLastUsedPath(actionKey=ao_module_pathMemoryDefaultAction, scopeName=undefined){
    var scope = ao_module_readPathMemory().scopes[scopeName || ao_module_getPathMemoryScope()];
    if (scope == undefined){
        return "";
    }
    if (actionKey !== false && actionKey != undefined && scope.actions != undefined &&
        typeof(scope.actions[actionKey]) == "string"){
        return scope.actions[actionKey];
    }
    return (typeof(scope.last) == "string") ? scope.last : "";
}

/*
    ao_module_setLastUsedPath(path, actionKey, scopeName)

    Record a directory as the last used one for this app. The file selector calls
    this by itself, apps only need it when they open files through another route
    (e.g. a drag and drop or a hardcoded recent-file list) and want the selector to
    follow along.
*/
function ao_module_setLastUsedPath(path, actionKey=ao_module_pathMemoryDefaultAction, scopeName=undefined){
    if (typeof(path) != "string" || path.trim() == ""){
        return false;
    }
    path = path.trim();
    if (path.substr(path.length - 1, 1) != "/"){
        path = path + "/";
    }
    var memory = ao_module_readPathMemory();
    var name = scopeName || ao_module_getPathMemoryScope();
    if (memory.scopes[name] == undefined){
        memory.scopes[name] = {last: "", actions: {}};
    }
    if (memory.scopes[name].actions == undefined){
        memory.scopes[name].actions = {};
    }
    memory.scopes[name].last = path;
    memory.scopes[name].ts = new Date().getTime();
    if (actionKey !== false && actionKey != undefined && actionKey != ""){
        memory.scopes[name].actions[actionKey] = path;
    }
    ao_module_writePathMemory(memory);
    return true;
}

//Forget the last used path of one action, or of the whole app when actionKey is false
function ao_module_clearLastUsedPath(actionKey=false, scopeName=undefined){
    var memory = ao_module_readPathMemory();
    var name = scopeName || ao_module_getPathMemoryScope();
    if (memory.scopes[name] == undefined){
        return false;
    }
    if (actionKey === false || actionKey == undefined || actionKey == ""){
        delete memory.scopes[name];
    }else if (memory.scopes[name].actions != undefined){
        delete memory.scopes[name].actions[actionKey];
    }
    ao_module_writePathMemory(memory);
    return true;
}

//Strip the object name off a returned filepath to get the directory holding it.
//Folder selections are already a directory and are kept as-is, so re-opening the
//selector lands inside the folder the user picked last time.
function ao_module_pathMemoryDirOf(filepath, type){
    if (typeof(filepath) != "string" || filepath == ""){
        return "";
    }
    if (type == "folder"){
        return (filepath.substr(filepath.length - 1, 1) == "/") ? filepath : filepath + "/";
    }
    var cutpoint = filepath.lastIndexOf("/");
    if (cutpoint < 0){
        return "";
    }
    return filepath.substring(0, cutpoint + 1);
}

/*
    File Selector

    Open a file selector and return selected item back to the current window
    Tips: Unlike the beta version, you can use this function in both Virtual Desktop Mode and normal mode.

    Possible selection type:
    type => {file / folder / all / new}

    Example usage:
    ao_module_openFileSelector(fileSelected, "user:/Desktop", "file",true);

    function fileSelected(filedata){
        for (var i=0; i < filedata.length; i++){
            var filename = filedata[i].filename;
            var filepath = filedata[i].filepath;
            //Do something here
        }
    }

    If you want to create a new file or folder object, you can use the following options paramters
    option = {
        defaultName: "newfile.txt",            //Default filename used in new operation
        fnameOverride: "myfunction",           //For those defined with window.myfunction
        filter: ["mp3","aac","ogg","flac","wav"] //File extension filter
    }

    Path memory (see the File Selector Path Memory section above)

    The directory the user confirms is remembered per web app, and the next selector
    opened by the same app starts there instead of at the "root" argument. The root
    argument stays in effect as the fallback for the first ever call and for when the
    remembered directory no longer exists. Additional options controlling this:

    option = {
        force_path_overwrite: true,     //Ignore the per-action memory and always open at
                                        //the directory this app last used, whatever the
                                        //action was. Use it for context free entry points
                                        //("New Project", "New File"), not for Save As /
                                        //Export where the caller passes a meaningful root
        path_memory_key: "export",      //Bucket the memory per action instead of sharing
                                        //one per app. Defaults to "default"
        disable_path_memory: true       //Opt out completely: open exactly at "root" and
                                        //record nothing
    }
*/
var ao_module_fileSelectionListener;
var ao_module_fileSelectorWindow;
function ao_module_openFileSelector(callback,root="user:/", type="file",allowMultiple=false, options=undefined){
    if (options === null){
        options = undefined;
    }

    //Resolve where this selector should open, honoring the path memory of this app
    var actionKey = ao_module_pathMemoryDefaultAction;
    var forceOverwrite = false;
    var memoryDisabled = false;
    if (options != undefined){
        if (typeof(options.path_memory_key) == "string" && options.path_memory_key != ""){
            actionKey = options.path_memory_key;
        }
        forceOverwrite = (options.force_path_overwrite === true);
        memoryDisabled = (options.disable_path_memory === true);
    }

    var effectiveRoot = root;
    if (!memoryDisabled){
        //force_path_overwrite ignores what this action did last and jumps straight to
        //wherever the app was last used, as a new project has no relation to the
        //previous action. Otherwise the per-action memory wins, then the app wide one.
        var rememberedPath = forceOverwrite ?
            ao_module_getLastUsedPath(false) :
            ao_module_getLastUsedPath(actionKey);
        if (rememberedPath != ""){
            effectiveRoot = rememberedPath;
        }
    }

    var initInfo = {
        root: effectiveRoot,
        //Where the selector should land if the remembered directory has been
        //renamed or deleted since it was recorded
        fallbackRoot: root,
        type: type,
        allowMultiple: allowMultiple,
        listenerUUID: "",
        options: options
    }
    var initInfoEncoded = encodeURIComponent(JSON.stringify(initInfo))

    //Resolve the caller's callback into something we can invoke ourselves, so that the
    //confirmed directory can be recorded before the app gets to see the selection
    var invokeUserCallback;
    if (options != undefined && typeof(options.fnameOverride) != "undefined"){
        var overrideName = options.fnameOverride;
        invokeUserCallback = function(files){
            if (typeof(window[overrideName]) == "function"){
                window[overrideName](files);
            }else{
                console.log("[ao_module] File selector callback not found: " + overrideName);
            }
        };
    }else if (typeof callback === "string"){
        // Caller passed the function name as a string
        var callbackName = callback;
        invokeUserCallback = function(files){
            if (typeof(window[callbackName]) == "function"){
                window[callbackName](files);
            }else{
                console.log("[ao_module] File selector callback not found: " + callbackName);
            }
        };
    }else if (typeof callback === "function"){
        invokeUserCallback = callback;
    }else{
        invokeUserCallback = function(){};
    }

    //Wrap the callback so the confirmed directory becomes this app's last used path
    var handleSelection = function(files){
        if (!memoryDisabled && Array.isArray(files) && files.length > 0){
            try{
                var usedDir = ao_module_pathMemoryDirOf(files[0].filepath, type);
                if (usedDir != ""){
                    ao_module_setLastUsedPath(usedDir, actionKey);
                }
            }catch(ex){
                console.log("[ao_module] Unable to record file selector path: " + ex);
            }
        }
        invokeUserCallback(files);
    };

    if (ao_module_virtualDesktop){
        //The desktop evals the callback name inside this iframe after selection, so the
        //wrapper has to be reachable as a window scoped function of this window
        var callbackname = "_aoFs_" + new Date().getTime() + "_" + Math.floor(Math.random() * 100000);
        window[callbackname] = function(files){
            try{
                handleSelection(files);
            }finally{
                delete window[callbackname];
            }
        };
        parent.newFloatWindow({
            url: "SystemAO/file_system/file_selector.html#" + initInfoEncoded,
            //Sized so the sidebar, file list and details pane all fit without the
            //footer controls wrapping onto a second row
            width: 960,
            height: 620,
            appicon: "SystemAO/file_system/img/selector.png",
            title: "Open",
            parent: ao_module_windowID,
            callback: callbackname
        });
    }else{
        //Create a return listener base on localStorage
        let listenerUUID = "fileSelector_" + new Date().getTime();
        ao_module_fileSelectionListener = setInterval(function(){
            if (localStorage.getItem(listenerUUID) === undefined || localStorage.getItem(listenerUUID)=== null){
                //Not ready
            }else{
                //File ready!
                var selectedFiles = JSON.parse(localStorage.getItem(listenerUUID));
                localStorage.removeItem(listenerUUID);
                setTimeout(function(){
                    localStorage.removeItem(listenerUUID);
                },500);
                if(selectedFiles == "&&selection_canceled&&"){
                    //Selection canceled. Return empty array
                    handleSelection([]);
                }else{
                    //Files Selected
                    handleSelection(selectedFiles);
                }

                clearInterval(ao_module_fileSelectionListener);
                ao_module_fileSelectorWindow.close();
            }
        },1000);

        //Open the file selector in a new tab
        initInfo.listenerUUID = listenerUUID;
        initInfoEncoded = encodeURIComponent(JSON.stringify(initInfo))
        ao_module_fileSelectorWindow = window.open(ao_root + "SystemAO/file_system/file_selector.html#" + initInfoEncoded,);
    }
}

//Check if there is parent to callback
function ao_module_hasParentCallback(){
    if (ao_module_virtualDesktop){
        //Check if parent callback exists
        var thisFw;
        $(parent.window.document.body).find(".floatWindow").each(function(){
            if ($(this).attr('windowid') == ao_module_windowID){
                thisFw = $(this);
            }
        });
        var parentWindowID = thisFw.attr("parent");
        var parentCallback = thisFw.attr("callback");
        if (parentWindowID == "" || parentCallback == ""){
            //No parent window defined
            return false;
        }

        //Check if parent windows is alive
        var parentWindow = undefined;
        $(parent.window.document.body).find(".floatWindow").each(function(){
            if ($(this).attr('windowid') == parentWindowID){
                parentWindow = $(this);
            }
        });
        if (parentWindow == undefined){
            //parent window not exists
            return false;
        }

        //Parent callback is set and ready to callback
        return true;
    }else{
        return false
    }
}

//Callback to parent with results
function ao_module_parentCallback(data=""){
    if (ao_module_virtualDesktop){
        var thisFw;
        $(parent.window.document.body).find(".floatWindow").each(function(){
            if ($(this).attr('windowid') == ao_module_windowID){
                thisFw = $(this);
            }
        });
        var parentWindowID = thisFw.attr("parent");
        var parentCallback = thisFw.attr("callback");
        if (parentWindowID == "" || parentCallback == ""){
            //No parent window defined
            console.log("Undefined parent window ID or callback name");
            return false;
        }
        var parentWindow = undefined;
        $(parent.window.document.body).find(".floatWindow").each(function(){
            if ($(this).attr('windowid') == parentWindowID){
                parentWindow = $(this);
            }
        });
        if (parentWindow == undefined){
            //parent window not exists
            console.log("Parent Window not exists!")
            return false;
        }
        $(parentWindow).find('iframe')[0].contentWindow.eval(parentCallback + "(" + JSON.stringify(data) + ");")

        //Focus the parent windows
        parent.MoveFloatWindowToTop(parentWindow);
        return true;
    }else{
        console.log("[ao_module] WARNING! Invalid call to parentCallback under non-virtualDesktop mode");
        return false;
    }
}


function ao_module_agirun(scriptpath, data, callback, failedcallback = undefined, timeout=0){
    let devmode = (typeof AGI_DEV !== 'undefined' && AGI_DEV === true);
    let url = ao_root + "system/ajgi/interface?script=" + scriptpath;
    if (devmode) {
        url += "&agi_devmode=true";
    }
    $.ajax({
        url: url,
        method: "POST",
        data: data,
        success: function(data){
            if (typeof(callback) != "undefined"){
                callback(data);
            }
        },
        error: function(xhr){
            if (devmode) {
                try {
                    let errInfo = JSON.parse(xhr.responseText);
                    console.error("[AGI Dev] Error in script: " + scriptpath);
                    console.error("[AGI Dev] Message: " + errInfo.message);
                    if (errInfo.stacktrace && errInfo.stacktrace !== errInfo.message) {
                        console.error("[AGI Dev] Stack Trace:\n" + errInfo.stacktrace);
                    }
                } catch(e) {
                    console.error("[AGI Dev] Error in script: " + scriptpath + "\n" + xhr.responseText);
                }
            }
            if (typeof(failedcallback) != "undefined"){
                failedcallback(xhr);
            }
        },
        timeout: timeout
    });
}

function ao_module_uploadFile(file, targetPath, callback=undefined, progressCallback=undefined, failedcallback=undefined) {
    let url = ao_root + 'system/file_system/upload'
    let formData = new FormData()
    let xhr = new XMLHttpRequest()
    formData.append('file', file);
    formData.append('path', targetPath);

    xhr.open('POST', url, true);

    xhr.upload.addEventListener("progress", function(e) {
        if (progressCallback !== undefined){
            progressCallback((e.loaded * 100.0 / e.total) || 100);
        }
    });

    xhr.addEventListener('readystatechange', function(e) {
        if (xhr.readyState == 4 && xhr.status == 200) {
            if (callback !== undefined){
                callback(e.target.response);
            }
        }
        else if (xhr.readyState == 4 && xhr.status != 200) {
            if (failedcallback !== undefined){
                failedcallback(xhr.status);
            }
        }
    })

    xhr.send(formData);
}


/*
    ao_module_storage, allow key-value storage per module settings. 
    WARNING: NOT CROSS USER READ-WRITABLE
    
    ao_module_storage.setStorage(moduleName, configName,configValue);
    ao_module_storage.loadStorage(moduleName, configName);
*/
if (typeof window.ao_module_storage === 'undefined') {
    window.ao_module_storage = class {
        static setStorage(moduleName, configName,configValue){
            $.ajax({
            type: 'GET',
            url: ao_root + "system/file_system/preference",
            data: {key: moduleName + "/" + configName,value:configValue},
            success: function(data){},
            async:true
            });
            return true;
        }
        
        static loadStorage(moduleName, configName, callback=undefined){
            var result = "";
            if (callback == undefined){
                //Do not use async
                $.ajax({
                    type: 'GET',
                    url: ao_root + "system/file_system/preference",
                    data: {key: moduleName + "/" + configName},
                    success: function(data){
                            if (data.error !== undefined){
                                result = "";
                            }else{
                                result = data;
                            }
                        },
                    error: function(data){result = "";},
                    async:false,
                    timeout: 3000
                });
                return result;
            }else{
                //Use sync method
                $.ajax({
                    type: 'GET',
                    url: ao_root + "system/file_system/preference",
                    data: {key: moduleName + "/" + configName},
                    success: function(data){
                            if (data.error !== undefined){
                                callback("");
                            }else{
                                callback(data);
                            }
                        },
                    error: function(evt){
                        callback("");
                    },
                    timeout: 30000
                });
            }
            
            
        }
    }
}
/*
    ao_module_onThemeChanged(callback)

    Register a callback that fires whenever the ArozOS system theme changes.
    The callback receives one string argument: "dark" or "light".

    Works in two modes:
    - Virtual Desktop (float-window): the desktop calls window.desktopThemeChanged
      on every iframe after a theme switch.
    - Standalone tab: listens for a localStorage event written by desktop.html or
      file_explorer.html when the user toggles the theme.

    Example:
        ao_module_onThemeChanged(function(theme) {
            document.documentElement.setAttribute("data-theme", theme);
        });
*/
var _ao_theme_ls_key    = 'ao_system_theme';
var _ao_theme_ls_bound  = false;

function ao_module_onThemeChanged(callback) {
    // VDI broadcast path: desktop.html calls desktopThemeChanged on each iframe
    window.desktopThemeChanged = function(theme) {
        callback(theme);
    };

    // Standalone/cross-tab path: other windows write ao_system_theme to localStorage
    if (!_ao_theme_ls_bound) {
        _ao_theme_ls_bound = true;
        window.addEventListener('storage', function(e) {
            if (e.key !== _ao_theme_ls_key || !e.newValue) return;
            try {
                var evt = JSON.parse(e.newValue);
                if (evt && evt.theme && typeof window.desktopThemeChanged === 'function') {
                    window.desktopThemeChanged(evt.theme);
                }
            } catch(ex) {}
        });
    }
}

/*
    ao_module_toggleSystemTheme()

    Toggle the system-wide ArozOS theme between dark and light.
    All webapps that have called ao_module_onThemeChanged will be notified.

    In Virtual Desktop Mode this delegates to the desktop's own toggle, which
    also persists the preference.  In standalone mode it reads the saved preference,
    flips it, persists it, then broadcasts the change via localStorage.
*/
function ao_module_toggleSystemTheme() {
    if (ao_module_virtualDesktop) {
        try {
            parent.toggleDesktopTheme();
        } catch(e) {
            console.log("[ao_module] toggleSystemTheme: cannot reach parent desktop", e);
        }
        return;
    }
    // Standalone: read -> flip -> save -> broadcast
    $.get(ao_root + "system/file_system/preference?key=file_explorer/theme", function(data) {
        var isDark = (data === 'darkTheme');
        var newPref  = isDark ? 'whiteTheme' : 'darkTheme';
        var newTheme = isDark ? 'light'       : 'dark';
        $.get(ao_root + "system/file_system/preference?key=file_explorer/theme&value=" + newPref, function() {
            _ao_theme_broadcast(newTheme);
        });
    });
}

// Write the theme event to localStorage (notifies other tabs) and call the
// local callback if one has been registered via ao_module_onThemeChanged.
function _ao_theme_broadcast(theme) {
    try {
        localStorage.setItem(_ao_theme_ls_key, JSON.stringify({theme: theme, ts: Date.now()}));
    } catch(e) {}
    if (typeof window.desktopThemeChanged === 'function') {
        window.desktopThemeChanged(theme);
    }
}

if (typeof window.ao_module_codec === 'undefined') {
    window.ao_module_codec = class {
        //Decode umfilename into standard filename in utf-8, which umfilename usually start with "inith"
        //Example: ao_module_codec.decodeUmFilename(umfilename_here);
        static decodeUmFilename(umfilename){
            if (umfilename.includes("inith")){
                var data = umfilename.split(".");
                if (data.length == 1){
                    //This is a filename without extension
                    data = data[0].replace("inith","");
                    var decodedname = ao_module_codec.decode_utf8(ao_module_codec.hex2bin(data));
                    if (decodedname != "false"){
                        //This is a umfilename
                        return decodedname;
                    }else{
                        //This is not a umfilename
                        return umfilename;
                    }
                }else{
                    //This is a filename with extension
                    var extension = data.pop();
                    var filename = data[0];
                    filename = filename.replace("inith",""); //Javascript replace only remove the first instances (i.e. the first inith in filename)
                    var decodedname = ao_module_codec.decode_utf8(ao_module_codec.hex2bin(filename));
                    if (decodedname != "false"){
                        //This is a umfilename
                        return decodedname + "." + extension;
                    }else{
                        //This is not a umfilename
                        return umfilename;
                    }
                }
            }else{
                //This is not umfilename as it doesn't have the inith prefix
                return umfilename;
            }
        }
        
        //Encode filename to UMfilename
        //Example: ao_module_codec.encodeUMFilename("test.stl");
        static encodeUMFilename(filename){
            if (filename.substring(0,5) != "inith"){
                //Check if the filename include extension. 
                if (filename.includes(".")){
                    //Filename with extension. pop it out first.
                    var info = filename.split(".");
                    var ext = info.pop();
                    var filenameOnly = info.join(".");
                    var encodedFilename = "inith" + ao_module_codec.decode_utf8(ao_module_codec.bin2hex(filenameOnly)) + "." + ext;
                    return encodedFilename;
                }else{
                    //Filename with no extension. Convert the whole name into UMfilename
                    var encodedFilename = "inith" + ao_module_codec.decode_utf8(ao_module_codec.bin2hex(filename));
                    return encodedFilename;
                }
            }else{
                //This is already a UMfilename. return the raw filename.
                return filename;
            }
        }
        
        //Decode hexFoldername into standard foldername in utf-8, return the original name if it is not a hex foldername
        //Example: ao_module_codec.decodeHexFoldername(hexFolderName_here);
        static decodeHexFoldername(folderName, prefix=true){
            var decodedFoldername = ao_module_codec.decode_utf8(ao_module_codec.hex2bin(folderName));
            if (decodedFoldername == "false"){
                //This is not a hex encoded foldername
                decodedFoldername = folderName;
            }else{
                //This is a hex encoded foldername
                if (prefix){
                        decodedFoldername = "*" + decodedFoldername;
                }else{
                        decodedFoldername =decodedFoldername;
                }
            }
            return decodedFoldername;
        }
        
        //Encode foldername into hexfoldername
        //Example: ao_module_codec.encodeHexFoldername("test");
        static encodeHexFoldername(folderName){
            var encodedFilename = "";
            if (ao_module_codec.decodeHexFoldername(folderName) == folderName){
                //This is not hex foldername. Encode it
                encodedFilename = ao_module_codec.decode_utf8(ao_module_codec.bin2hex(folderName));
            }else{
                //This folder name already encoded. Return the original value
                encodedFilename = folderName;
            }
            
            return encodedFilename;
        }
        static hex2bin(s){
        var ret = []
        var i = 0
        var l
        s += ''
        for (l = s.length; i < l; i += 2) {
            var c = parseInt(s.substr(i, 1), 16)
            var k = parseInt(s.substr(i + 1, 1), 16)
            if (isNaN(c) || isNaN(k)) return false
            ret.push((c << 4) | k)
        }
        
        return String.fromCharCode.apply(String, ret)
        }
        
        static bin2hex(s){
            var i
            var l
            var o = ''
            var n
            s += ''
            for (i = 0, l = s.length; i < l; i++) {
                n = s.charCodeAt(i)
                .toString(16)
                o += n.length < 2 ? '0' + n : n
            }
            return o
        }
        
        static decode_utf8(s) {
        return decodeURIComponent(escape(s));
        }
    }
}



/**
    ArOZ Online Module Utils for quick deploy of ArOZ Online WebApps

    ao_module_utils.objectToAttr(object); //object to DOM attr
    ao_module_utils.attrToObject(attr); //DOM attr to Object
    ao_module_utils.getRandomUID(); //Get random UUID from timestamp
    ao_module_utils.getIconFromExt(ext); //Get icon tag from file extension
    ao_module_utils.stringToBlob(text, mimetype="text/plain") //Convert string to blob
    ao_module_utils.blobToFile(blob, filename, mimetype="text/plain") //Convert blob to file
    ao_module_utils.getDropFileInfo(dropEvent); //Get the filepath and filename list from file explorer drag drop
    ao_module_utils.readFileFromFileObject(fileObject, successCallback, failedCallback=undefined) //Read file object as text
    ao_module_utils.durationConverter(seconds) //Convert duration in seconds to Days / Hours / Minutes / Seconds
    ao_module_utils.formatBytes(byte, decimals); //Format file byte size to human readable size
    ao_module_utils.timeConverter(unix_timestamp); //Get human readable timestamp 
    ao_module_utils.getWebSocketEndpoint() //Build server websocket endpoint root, e.g. wss://192.168.1.100:8080/
    ao_module_utils.formatBytes(bytes, decimalPlace=2) //Convert and rounds bytes into KB, MB, GB or TB
**/

if (typeof window.ao_module_utils === 'undefined') {
    window.ao_module_utils = class {
        //Two simple functions for converting any Javascript object into string that can be put into the attr value of an DOM object
        static objectToAttr(object){
        return encodeURIComponent(JSON.stringify(object));
        }
        
        static attrToObject(attr){
            return JSON.parse(decodeURIComponent(attr));
        }
        
        //Get a random id for a new floatWindow, use with var uid = ao_module_utils.getRandomUID();
        static getRandomUID(){
            return new Date().getTime();
        }

        static stringToBlob(text, mimetype="text/plain"){
            var blob = new Blob([text], { type: mimetype });
            return blob
        }

        static blobToFile(blob, filename, mimetype="text/plain"){
            var file = new File([blob], filename, {type: mimetype});
            return file
        }
        
        //Get the icon of a file with given extension (ext), use with ao_module_utils.getIconFromExt("ext");
        static getIconFromExt(ext){
            var ext = ext.toLowerCase().trim();
            var iconList={
                md:"file text outline",
                txt:"file text outline",
                pdf:"file pdf outline",
                doc:"file word outline",
                docx:"file word outline",
                odt:"file word outline",
                xlsx:"file excel outline",
                ods:"file excel outline",
                ppt:"file powerpoint outline",
                pptx:"file powerpoint outline",
                odp:"file powerpoint outline",
                jpg:"file image outline",
                png:"file image outline",
                jpeg:"file image outline",
                gif:"file image outline",
                odg:"file image outline",
                psd:"file image outline",
                zip:"file archive outline",
                '7z':"file archive outline",
                rar:"file archive outline",
                tar:"file archive outline",
                mp3:"file audio outline",
                m4a:"file audio outline",
                flac:"file audio outline",
                wav:"file audio outline",
                aac:"file audio outline",
                mp4:"file video outline",
                webm:"file video outline",
                php:"file code outline",
                html:"file code outline",
                htm:"file code outline",
                js:"file code outline",
                css:"file code outline",
                xml:"file code outline",
                json:"file code outline",
                csv:"file code outline",
                odf:"file code outline",
                bmp:"file image outline",
                rtf:"file text outline",
                wmv:"file video outline",
                mkv:"file video outline",
                ogg:"file audio outline",
                stl:"cube",
                obj:"cube",
                "3ds":"cube",
                fbx:"cube",
                collada:"cube",
                step:"cube",
                iges:"cube",
                gcode:"cube",
                shortcut:"external square",
                opus:"file audio outline",
                agi: "file code outline",
                apscene:"cubes"
            };
            var icon = "";
            if (ext == ""){
                icon = "folder outline";
            }else{
                icon = iconList[ext];
                if (icon == undefined){
                    icon = "file outline"
                }
            }
            return icon;
        }
        
        //Get the drop file properties {filepath: xxx, filename: xxx} from file drop events from file exploere
        static getDropFileInfo(dropEvent){
            if (dropEvent.dataTransfer.getData("filedata") !== ""){
                var filelist = dropEvent.dataTransfer.getData("filedata");
                filelist = JSON.parse(filelist);
                return filelist;
            }
            return null;
        }

        static readFileFromFileObject(fileObject, successCallback, failedCallback=undefined){
            let reader = new FileReader();
            reader.readAsText(fileObject);
            reader.onload = function() {
                successCallback(reader.result);
            };
            reader.onerror = function() {
                if (failedCallback != undefined){
                    failedCallback(reader.error);
                }else{
                    console.log(reader.error);
                }
            };

        }

        static durationConverter(seconds){
            var days = Math.floor(seconds / 86400);
            seconds -= days * 86400;
            var hours = Math.floor(seconds / 3600) % 24;
            seconds -= hours * 3600;
            var minutes = Math.floor(seconds / 60) % 60;
            seconds -= minutes * 60;
            var seconds = seconds % 60;

            var resultDuration = "";
            if (days > 0){
                resultDuration += days + " Day";
                if (days > 1){
                    resultDuration+= "s"
                }
                resultDuration += " "
            }

            if (hours > 0){
                resultDuration += hours + " Hour"
                if (hours > 1){
                    resultDuration += "s"
                }
                resultDuration += " "
            }

            if (minutes > 0){
                resultDuration += minutes + " Minute"
                if (minutes > 1){
                    resultDuration += "s"
                }
                resultDuration += " "
            }

            if (seconds > 0){
                resultDuration += seconds + " Second"
                if (seconds > 1){
                    resultDuration += "s"
                }
                resultDuration += " "
            }
            
            return resultDuration;
        }

        static timeConverter(UNIX_timestamp){
            var a = new Date(UNIX_timestamp * 1000);
            var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            var year = a.getFullYear();
            var month = months[a.getMonth()];
            var date = a.getDate();
            var hour = a.getHours().toString().padStart(2, "0");
            var min = a.getMinutes().toString().padStart(2, "0");
            var sec = a.getSeconds().toString().padStart(2, "0");
            var time = date + ' ' + month + ' ' + year + ' ' + hour + ':' + min + ':' + sec ;
            return time;
        }

        static getWebSocketEndpoint(){
            let protocol = "wss://";
            if (location.protocol !== 'https:') {
                protocol = "ws://";
            }
            let port = window.location.port;
            if (window.location.port == ""){
                if (location.protocol !== 'https:') {
                    port = "80";
                }else{
                    port = "443";
                }
                
            }
            let wsept = (protocol + window.location.hostname + ":" + port);
            return wsept;
        }
        
        static formatBytes(a,b=2){if(0===a)return"0 Bytes";const c=0>b?0:b,d=Math.floor(Math.log(a)/Math.log(1024));return parseFloat((a/Math.pow(1024,d)).toFixed(c))+" "+["Bytes","KB","MB","GB","TB","PB","EB","ZB","YB"][d]}
    }
}


/*
    Backend Programming Logic

    These code are design to use with ao_backend.js for wrapping
    AGI programming gateway content
*/

function ao_module_backend(){
    return {
        timeout: 500,
        start: function(libraryPath){
            this.libpath = libraryPath;
    
            //Initialize the parent objects
            this.appdata.parent = this;
            this.file.parent = this;
            this.http.parent = this;
        },
        _agi_run: function(data, callback, failedcallback = undefined){
                    $.ajax({
                        url: ao_root + "system/ajgi/interface?script=" + this.libpath,
                        method: "POST",
                        data: data,
                        success: function(data){
                            if (typeof(callback) != "undefined"){
                                callback(data);
                            }
                        },
                        error: function(){
                            if (typeof(failedcallback) != "undefined"){
                                failedcallback();
                            }
                            console.log("Request failed");
                        },
                        timeout: this.timeout
                    })
                },
        appdata: {
            readFile: function(filepath, callback=undefined){
                this.parent._agi_run({
                    opr: "appdata.readFile",
                    filepath: filepath
                }, callback)
            },
            listDir: function(filepath, callback=undefined){
                this.parent._agi_run({
                    opr: "appdata.listDir",
                    filepath: filepath
                }, callback)
            },
        },
        file: {
            writeFile: function(filepath, content, callback=undefined){
                this.parent._agi_run({
                    opr: "file.writeFile",
                    filepath: filepath,
                    content: content,
                }, callback)
            },
            readFile: function(filepath, callback=undefined){
                this.parent._agi_run({
                    opr: "file.readFile",
                    filepath: filepath
                }, callback)
            },
            deleteFile: function(filepath, callback=undefined){
                this.parent._agi_run({
                    opr: "file.deleteFile",
                    filepath: filepath
                }, callback)
            },
            readdir: function(filepath, callback=undefined){
                this.parent._agi_run({
                    opr: "file.readdir",
                    filepath: filepath
                }, callback)
            },
            walk: function(filepath, mode="all", callback=undefined){
                this.parent._agi_run({
                    opr: "file.walk",
                    filepath: filepath,
                    mode: mode,
                }, callback)
            },
            glob: function(wildcard, sort="user", callback=undefined){
                this.parent._agi_run({
                    opr: "file.glob",
                    wildcard: wildcard,
                    sort: sort,
                }, callback)
            },
            aglob: function(wildcard, sort="user", callback=undefined){
                this.parent._agi_run({
                    opr: "file.aglob",
                    wildcard: wildcard,
                    sort: sort,
                }, callback)
            },
            filesize: function(filepath, callback=undefined){
                this.parent._agi_run({
                    opr: "file.filesize",
                    filepath: filepath
                }, callback)
            },
            fileExists: function(filepath, callback=undefined){
                this.parent._agi_run({
                    opr: "file.fileExists",
                    filepath: filepath
                }, callback)
            },
            isDir: function(filepath, callback=undefined){
                this.parent._agi_run({
                    opr: "file.isDir",
                    filepath: filepath
                }, callback)
            },
            mkdir: function(filepath, callback=undefined){
                this.parent._agi_run({
                    opr: "file.mkdir",
                    filepath: filepath
                }, callback)
            },
            mtime: function(filepath, callback=undefined){
                this.parent._agi_run({
                    opr: "file.mtime",
                    filepath: filepath
                }, callback)
            },
            rootName: function(filepath, callback=undefined){
                this.parent._agi_run({
                    opr: "file.rootName",
                    filepath: filepath
                }, callback)
            }
        },
        http: {
            get: function(targetURL, callback=undefined){
                this.parent._agi_run({
                    opr: "http.get",
                    targetURL: targetURL
                }, callback)
            },
            post: function(targetURL, postdata="", callback=undefined){
                this.parent._agi_run({
                    opr: "http.post",
                    targetURL: targetURL,
                    postdata: postdata
                }, callback)
            },
            head: function(targetURL, header="", callback=undefined){
                this.parent._agi_run({
                    opr: "http.head",
                    targetURL: targetURL,
                    header: header
                }, callback)
            },
            download: function(targetURL, saveDir="tmp:/", saveFilename="", callback=undefined){
                if (saveFilename == ""){
                    saveFilename = targetURL.split("/").pop();
                    saveFilename = decodeURIComponent(saveFilename);
                }

                this.parent._agi_run({
                    opr: "http.download",
                    targetURL: targetURL,
                    saveDir: saveDir,
                    saveFilename: saveFilename
                }, callback)
            },
        }
    }
}

