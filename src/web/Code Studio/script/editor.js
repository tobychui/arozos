/*
    Code Studio — editor core

    Monaco instances, editor groups, tabs and file IO. The workbench
    chrome around it lives in workbench.js.
*/

/* ═══════════════════════════════════════════════════════════════════
   Environment
   ═══════════════════════════════════════════════════════════════════ */

let editors = [];                       //All editor groups currently on screen
let focusedEditor = "mainEditor";       //uuid of the focused editor group
let loadedModels = [];                  //filepath -> monaco model, avoids duplicates
let focusedFileInfo = [];

let currentProjectFolder = null;        //Virtual path of the opened project folder
let selectedFolderItem = null;          //Item the folder context menu acts on
let selectedTabInfo = null;             //Tab the tab context menu acts on

let untitledCounter = 0;
let editorGroupCounter = 1;

//Hashcode used to tell a modified buffer from a saved one
String.prototype.hashCode = function() {
    var hash = 0;
    if (this.length == 0) return hash;
    for (var i = 0; i < this.length; i++) {
        hash = ((hash << 5) - hash) + this.charCodeAt(i);
        hash = hash & hash;
    }
    return hash;
}

/* ═══════════════════════════════════════════════════════════════════
   Editor group lifecycle
   ═══════════════════════════════════════════════════════════════════ */

function getEditor(uuid){
    for (var i = 0; i < editors.length; i++){
        if (editors[i].uuid == uuid) return editors[i];
    }
    return undefined;
}

function getFocusedEditorObject(){
    var editorObject = getEditor(focusedEditor);
    if (editorObject === undefined && editors.length > 0) editorObject = editors[0];
    return editorObject;
}

/*
    The AMD loader turns a module id into a relative URL and lets the browser
    resolve it against the document URL. Anchoring it to the loader <script>
    tag's own (already absolute) URL instead keeps Monaco's lazy language loads
    working regardless of what the page URL looks like later on.
*/
function monacoRootPath(){
    var loaderScript = document.querySelector('script[src*="monaco/vs/loader.js"]');
    if (loaderScript && loaderScript.src){
        return loaderScript.src.substring(0, loaderScript.src.lastIndexOf("/"));
    }
    return "script/monaco/vs";
}

function initEditor(targetDOM, editorUUID, loadPendingFiles = [], callback = undefined){
    //One loader configuration is enough, even when more editor groups are added
    if (!window.csMonacoConfigured){
        window.csMonacoConfigured = true;
        require.config({ paths: { 'vs': monacoRootPath() }});
    }
    window.GlobalEnvironment = { getWorkerUrl: () => proxy };

    let proxy = URL.createObjectURL(new Blob([`
        self.GlobalEnvironment = {
            baseUrl: 'script/monaco/'
        };

        importScripts('script/monaco/vs/base/worker/workerMain.js');
    `], { type: 'text/javascript' }));

    require(["vs/editor/editor.main"], function () {
        defineMonacoThemes();

        let editor = monaco.editor.create(targetDOM, {
            value: "",
            language: 'javascript',
            automaticLayout: true,
            theme: CS_THEMES[CS_PREF.theme].monaco,
            fontSize: CS_PREF.fontSize,
            minimap: { enabled: CS_PREF.minimap },
            wordWrap: CS_PREF.wordWrap ? "on" : "off",
            lineNumbers: CS_PREF.lineNumbers ? "on" : "off",
            scrollBeyondLastLine: false,
            renderLineHighlight: "all",
            smoothScrolling: true
        });

        editors.push({
            uuid: editorUUID,
            tabsMenu: $(targetDOM).parent().find(".tabs"),
            editor: editor,
            currentTabUUID: "default",
            model: [],
            state: [],
            tabs: []
        });

        bindEditorEvents(editor, editorUUID);

        //Load any file passed in from the file manager
        if (loadPendingFiles !== null && loadPendingFiles.length > 0){
            for (var i = 0; i < loadPendingFiles.length; i++){
                openFile(loadPendingFiles[i].filepath);
            }
        }

        if (callback !== undefined) callback(editor);
    });
}

function bindEditorEvents(editor, editorUUID){
    //Mark the tab dirty as soon as the buffer differs from the saved content
    editor.onDidChangeModelContent(function(){
        var editorObject = getEditor(editorUUID);
        if (!editorObject) return;
        var currentTab = editorObject.tabs.find(function(tab){
            return tab.tabUUID == editorObject.currentTabUUID;
        });
        if (!currentTab) return;
        markTabUnsaved(currentTab.tabUUID, editor.getValue().hashCode() !== currentTab.saveHash);
    });

    editor.onDidChangeCursorPosition(function(event){
        if (focusedEditor == editorUUID) updateCursorStatus(event.position);
    });

    editor.onDidFocusEditorText(function(){
        focusedEditor = editorUUID;
        updateLanguageStatus(editor.getModel());
    });

    //Ctrl+S — save the file behind the focused tab
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KEY_S, function(){
        focusedEditor = editorUUID;
        saveCurrentFile();
    });

    //Diagnostics are global to Monaco, so only ever subscribe once
    if (!window.csMarkerListenerBound && monaco.editor.onDidChangeMarkers){
        window.csMarkerListenerBound = true;
        monaco.editor.onDidChangeMarkers(function(){ refreshProblems(); });
    }
}

//Add a second (or third …) editor group beside the current one
function splitEditor(){
    editorGroupCounter++;
    var groupUUID = "editor" + editorGroupCounter;
    var groupID = "ca" + editorGroupCounter;

    $("#codeArea").append(
        '<div id="' + groupID + '" class="codeBoard">' +
            '<div class="tabs" editorUID="' + groupUUID + '" ondrop="TabDrop(event)" ondragover="allowDrop(event)"></div>' +
            '<div class="editor" editorUID="' + groupUUID + '" onclick="focusThisEditor(this);"></div>' +
            '<div class="editorcover" editorUID="' + groupUUID + '" onclick="focusThisEditor(this);"></div>' +
        '</div>');

    initEditor($("#" + groupID).find(".editor")[0], groupUUID, [], function(){
        focusedEditor = groupUUID;
        $("#" + groupID).find(".editorcover").html(
            '<div class="welcome"><h1>Editor group ' + editorGroupCounter + '</h1>' +
            '<div class="tagline">Drag a tab here, or open a file from the explorer.</div></div>');
        relayoutEditors();
    });
}

function closeEditorGroup(editorUUID){
    if (editors.length <= 1) return;             //never close the last group
    var editorObject = getEditor(editorUUID);
    if (!editorObject) return;

    editorObject.tabs.slice().forEach(function(tab){
        closeTabWithUUIDAndEditorID(tab.tabUUID, editorUUID);
    });

    try { editorObject.editor.dispose(); } catch(e){ /* already disposed */ }
    $(editorObject.tabsMenu).parent().remove();
    editors = editors.filter(function(entry){ return entry.uuid != editorUUID; });
    focusedEditor = editors[0].uuid;
    relayoutEditors();
}

/* ═══════════════════════════════════════════════════════════════════
   Session state (window hash)
   ═══════════════════════════════════════════════════════════════════ */

/*
    The opened folder and files are mirrored into the window hash so a browser
    reload restores the session.

    Under the web desktop the app runs inside a floatWindow whose URL belongs to
    the desktop: writing to location.hash there makes the host re-navigate the
    frame, which reloads the editor and aborts whatever Monaco was lazily
    loading at that moment (the "[object Event]" loader error). So in that mode
    the state is only kept in memory — the desktop restores windows itself.
*/
let csSessionState = null;      //In-memory mirror of the session state

function getHashObject(){
    if (csSessionState !== null) return csSessionState;

    csSessionState = {};
    if (window.location.hash.length > 1){
        try {
            var parsed = JSON.parse(decodeURIComponent(window.location.hash.substr(1)));
            //An array is a launch payload (the files to open), not a state object
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)){
                csSessionState = parsed;
            }
        } catch(e){ /* not a state object — start from an empty one */ }
    }
    return csSessionState;
}

function writeHashObject(newStateObject){
    csSessionState = newStateObject;
    if (ao_module_virtualDesktop) return;
    window.location.hash = JSON.stringify(newStateObject);
}

function updateStatusHash(key, value){
    var currentState = getHashObject();
    currentState[key] = value;
    writeHashObject(currentState);
}

function getOpenedFiles(){
    var openedFilepaths = [];
    editors.forEach(function(entry){
        entry.tabs.forEach(function(tab){
            if (tab.filepath && openedFilepaths.indexOf(tab.filepath) === -1){
                openedFilepaths.push(tab.filepath);
            }
        });
    });
    return openedFilepaths;
}

function restoreEditorState(editor){
    var oldState = getHashObject();

    if (oldState.folder !== undefined){
        var predictedName = oldState.folder.split("/").pop();
        if (oldState.folder.substr(oldState.folder.length - 1) == "/"){
            var parts = oldState.folder.split("/");
            parts.pop();
            predictedName = parts.pop();
        }
        //The hash already carries the tabs of this session, so the stored
        //workspace state must not open a second, older set on top of them
        var hashHasFiles = (oldState.files !== undefined && oldState.files.length > 0);
        openProjectFolder([{ filename: predictedName, filepath: oldState.folder }], false, !hashHasFiles);
    }

    if (oldState.files !== undefined){
        oldState.files.forEach(function(filepath){ openFile(filepath, false); });
    }
}

/* ═══════════════════════════════════════════════════════════════════
   Tabs
   ═══════════════════════════════════════════════════════════════════ */

function fileIconMarkup(filename, isError){
    if (isError) return '<i class="times circle icon" style="color:var(--err);"></i>';
    var ext = filename.split(".").pop().toLowerCase();
    var icon = ao_module_utils.getIconFromExt(ext);
    return '<i class="' + icon + ' icon ' + getFileIconClass(ext) + '"></i>';
}

function appendTabToDOM(editorObject, tab, isError){
    var editorUUID = editorObject.uuid;
    var icon = fileIconMarkup(tab.filename, isError);
    var pathAttr = tab.filepath ? tab.filepath : "";

    $(editorObject.tabsMenu).find(".item.selected").removeClass("selected");
    $(editorObject.tabsMenu).append(
        '<div class="item selected fileTab" title="' + escapeHTMLText(pathAttr || tab.filename) + '" draggable="true" ' +
             'ondragstart="fileTabDrag(event)" uuid="' + tab.tabUUID + '" editorUUID="' + editorUUID + '" ' +
             'filepath="' + escapeHTMLText(pathAttr) + '">' +
            icon +
            '<span class="tabFilename">' + escapeHTMLText(tab.filename) + '</span>' +
            '<div class="closebtn"><i class="times icon"></i></div>' +
        '</div>');

    $("#openeditors .row").removeClass("selected");
    $("#openeditors").append(
        '<div class="row selected" uuid="' + tab.tabUUID + '" editorUUID="' + editorUUID + '" ' +
             'title="' + escapeHTMLText(pathAttr || tab.filename) + '">' +
            '<span class="rowbtn closebtn"><i class="times icon"></i></span>' +
            icon +
            '<span class="name tabFilename">' + escapeHTMLText(tab.filename) + '</span>' +
        '</div>');

    editorObject.currentTabUUID = tab.tabUUID;
    editorObject.tabs.push(tab);
}

function bindTabItemEvents(){
    $(".tabs .item").off("click").on("click", function(){
        if ($(this).hasClass("selected")) return;
        var editorUUID = $(this).attr("editorUUID");
        var targetEditor = getEditor(editorUUID);
        if (targetEditor === undefined) return;
        focusedEditor = editorUUID;
        changeTab(targetEditor, $(this).attr("uuid"));
    });

    $("#openeditors .row").off("click").on("click", function(){
        var tabUUID = $(this).attr("uuid");
        var editorUUID = $(this).attr("editorUUID");
        var targetEditor = getEditor(editorUUID);
        if (targetEditor === undefined) return;
        focusedEditor = editorUUID;
        changeTab(targetEditor, tabUUID);
    });

    $(".tabs .item .closebtn, #openeditors .row .closebtn").off("click").on("click", function(event){
        event.preventDefault();
        event.stopImmediatePropagation();
        var holder = $(this).closest(".item, .row");
        closeTabWithUUIDAndEditorID(holder.attr("uuid"), holder.attr("editorUUID"));
    });

    //A dirty tab shows a dot; hovering it turns the dot back into a close cross
    $(".tabs .item.dirty").off("mouseenter mouseleave").on("mouseenter", function(){
        $(this).find(".closebtn i").attr("class", "times icon");
    }).on("mouseleave", function(){
        if ($(this).hasClass("dirty")) $(this).find(".closebtn i").attr("class", "circle icon");
    });

    bindTabContextMenu();
}

function focusTabWithUUID(tabUUID){
    $(".tabs .item").removeClass("selected");
    $('.tabs .item[uuid="' + tabUUID + '"]').addClass("selected");
    $("#openeditors .row").removeClass("selected");
    $('#openeditors .row[uuid="' + tabUUID + '"]').addClass("selected");
}

//Kept for API compatibility with the previous version
function focusTab(uuid){ focusTabWithUUID(uuid); }

function removeTabFromDOMWithUUID(tabUUID){
    $('.tabs .item[uuid="' + tabUUID + '"]').remove();
    $('#openeditors .row[uuid="' + tabUUID + '"]').remove();
}

function getFocusedTabInfo(){
    var editorObject = getFocusedEditorObject();
    if (!editorObject) return undefined;
    for (var i = 0; i < editorObject.tabs.length; i++){
        if (editorObject.tabs[i].tabUUID == editorObject.currentTabUUID){
            focusedFileInfo = editorObject.tabs[i];
            return editorObject.tabs[i];
        }
    }
    return undefined;
}

function getCodeAreaFromEditorUUID(editorUUID){
    var editorObject = getEditor(editorUUID);
    if (!editorObject) return $();
    return $(editorObject.tabsMenu).parent();
}

function focusThisEditor(object){
    focusedEditor = $(object).attr("editorUID");
    var tabInfo = getFocusedTabInfo();
    if (tabInfo !== undefined){
        updateFileStatusDisplay(tabInfo.filepath || tabInfo.filename);
        focusTabWithUUID(tabInfo.tabUUID);
    }
}

function changeTab(editorObject, targettabUUID){
    focusedEditor = editorObject.uuid;

    var editor = editorObject.editor;
    var models = editorObject.model;
    var states = editorObject.state;

    //Stash the outgoing tab's view state
    states[editorObject.currentTabUUID] = editor.saveViewState();
    models[editorObject.currentTabUUID] = editor.getModel();

    editorObject.currentTabUUID = targettabUUID;

    var targetTab = editorObject.tabs.find(function(tab){ return tab.tabUUID == targettabUUID; });
    var codeArea = getCodeAreaFromEditorUUID(editorObject.uuid);

    if (targetTab && targetTab.error){
        $(codeArea).find(".editorcover")
                   .html(buildErrorCoverHTML(targetTab.filepath, targettabUUID, editorObject.uuid)).show();
    } else {
        $(codeArea).find(".editorcover").hide();
        if (models[targettabUUID]) editor.setModel(models[targettabUUID]);
        if (states[targettabUUID]) editor.restoreViewState(states[targettabUUID]);
        editor.focus();
        updateLanguageStatus(editor.getModel());
        updateCursorStatus(editor.getPosition());
    }

    var tabInfo = getFocusedTabInfo();
    if (tabInfo){
        updateFileStatusDisplay(tabInfo.filepath || tabInfo.filename);
        refreshWindowTitle();
    }

    focusTabWithUUID(targettabUUID);
    scheduleProjectSessionSave();
}

function closeTabWithUUIDAndEditorID(tabUUID, editorUUID){
    var editorObject = getEditor(editorUUID);
    if (editorObject === undefined) return;

    delete editorObject.state[tabUUID];
    delete editorObject.model[tabUUID];

    editorObject.tabs = editorObject.tabs.filter(function(tab){ return tab.tabUUID != tabUUID; });
    removeTabFromDOMWithUUID(tabUUID);

    var currentState = getHashObject();
    currentState["files"] = getOpenedFiles();
    writeHashObject(currentState);
    scheduleProjectSessionSave();

    if (editorObject.tabs.length > 0){
        var newFocusedTabUUID = editorObject.tabs[editorObject.tabs.length - 1].tabUUID;
        changeTab(editorObject, newFocusedTabUUID);
    } else {
        var codeArea = getCodeAreaFromEditorUUID(editorUUID);
        $(codeArea).find(".editorcover").show();
        if (editors.length > 1){
            closeEditorGroup(editorUUID);
        } else {
            renderWelcomeScreen();
            updateFileStatusDisplay(null);
            refreshWindowTitle();
        }
    }
}

function markTabUnsaved(tabUUID, unsaved){
    var tab = $('.tabs .item[uuid="' + tabUUID + '"]');
    tab.toggleClass("dirty", unsaved);
    tab.find(".closebtn i").attr("class", unsaved ? "circle icon" : "times icon");
    $('#openeditors .row[uuid="' + tabUUID + '"]').toggleClass("unsaved", unsaved);
}

function getAllOpenedTabs(){
    var results = [];
    editors.forEach(function(entry){
        entry.tabs.forEach(function(tab){ results.push({ editor: entry, tab: tab }); });
    });
    return results;
}

/* ═══════════════════════════════════════════════════════════════════
   Opening files
   ═══════════════════════════════════════════════════════════════════ */

function buildErrorCoverHTML(filepath, tabUUID, editorUUID){
    return '<div class="errorcover">' +
                '<i class="times circle icon" style="font-size:3em;color:var(--err);"></i>' +
                '<div class="headline">File or folder no longer exists</div>' +
                '<div class="path">' + escapeHTMLText(filepath) + '</div>' +
                '<button class="btn" onclick="closeTabWithUUIDAndEditorID(\'' + tabUUID + '\',\'' + editorUUID + '\')">Close File</button>' +
            '</div>';
}

function openFile(filepath, updateHashStatus = true, overrideEditor = undefined){
    var targetEditorGroup = overrideEditor || getFocusedEditorObject();
    if (targetEditorGroup === undefined){
        alert("Unable to load editor.");
        return;
    }

    //Already open in this group? Just focus it
    for (var i = 0; i < targetEditorGroup.tabs.length; i++){
        if (targetEditorGroup.tabs[i].filepath == filepath){
            changeTab(targetEditorGroup, targetEditorGroup.tabs[i].tabUUID);
            return;
        }
    }

    ao_module_agirun("Code Studio/backend/read.agi", { file: filepath }, function(filecontent){
        var filename = filepath.split("/").pop();

        //Missing file — show a placeholder tab instead of a broken model
        if (typeof filecontent === "object" && filecontent.error){
            var errorTab = { filename: filename, filepath: filepath, tabUUID: newTabUUID(), saveHash: 0, error: true };
            appendTabToDOM(targetEditorGroup, errorTab, true);
            $(getCodeAreaFromEditorUUID(targetEditorGroup.uuid)).find(".editorcover")
                .html(buildErrorCoverHTML(filepath, errorTab.tabUUID, targetEditorGroup.uuid)).show();
            bindTabItemEvents();
            focusTabWithUUID(errorTab.tabUUID);
            csLog("err", "Cannot open " + filepath);
            return;
        }

        var editor = targetEditorGroup.editor;

        //Stash the outgoing view state before swapping models
        targetEditorGroup.state[targetEditorGroup.currentTabUUID] = editor.saveViewState();
        targetEditorGroup.model[targetEditorGroup.currentTabUUID] = editor.getModel();

        var tab = { filename: filename, filepath: filepath, tabUUID: newTabUUID(), saveHash: filecontent.hashCode() };
        appendTabToDOM(targetEditorGroup, tab, false);

        var model = loadedModels[filepath];
        if (model === undefined || model.isDisposed()){
            model = monaco.editor.createModel(
                filecontent,
                languageForFilename(filename),
                monaco.Uri.file("../media?file=" + encodeURIComponent(filepath))
            );
            loadedModels[filepath] = model;
        }

        targetEditorGroup.model[tab.tabUUID] = model;
        editor.setModel(model);
        $(getCodeAreaFromEditorUUID(targetEditorGroup.uuid)).find(".editorcover").hide();

        bindTabItemEvents();
        focusTabWithUUID(tab.tabUUID);
        updateFileStatusDisplay(filepath);
        updateLanguageStatus(model);
        refreshWindowTitle();

        if (updateHashStatus){
            var currentState = getHashObject();
            currentState["files"] = getOpenedFiles();
            writeHashObject(currentState);
        }

        scheduleProjectSessionSave();
        refreshGitDecorations();
    });
}

//Resolve the Monaco language from the file name, so the mode never depends on
//how the model URI happens to be spelled. Returns undefined for unknown types,
//which leaves the model as plain text.
function languageForFilename(filename){
    var ext = "." + filename.split(".").pop().toLowerCase();
    if (ext == ".agi") return "javascript";      //AGI scripts are JavaScript

    var languages = monaco.languages.getLanguages();
    for (var i = 0; i < languages.length; i++){
        var extensions = languages[i].extensions || [];
        if (extensions.indexOf(ext) !== -1) return languages[i].id;
    }
    return undefined;
}

function newTabUUID(){
    //Timestamp based, with a counter so two tabs opened in the same millisecond differ
    untitledCounter++;
    return String(new Date().getTime()) + untitledCounter;
}

function newUntitledFile(){
    var editorObject = getFocusedEditorObject();
    if (!editorObject){
        alert("The editor is still starting up, please try again in a moment.");
        return;
    }

    var filename = "Untitled-" + (editorObject.tabs.filter(function(t){ return t.untitled; }).length + 1);
    var tab = { filename: filename, filepath: null, tabUUID: newTabUUID(), saveHash: "".hashCode(), untitled: true };

    editorObject.state[editorObject.currentTabUUID] = editorObject.editor.saveViewState();
    editorObject.model[editorObject.currentTabUUID] = editorObject.editor.getModel();

    appendTabToDOM(editorObject, tab, false);

    var model = monaco.editor.createModel("", "plaintext");
    editorObject.model[tab.tabUUID] = model;
    editorObject.editor.setModel(model);

    $(getCodeAreaFromEditorUUID(editorObject.uuid)).find(".editorcover").hide();
    bindTabItemEvents();
    focusTabWithUUID(tab.tabUUID);
    updateFileStatusDisplay(null);
    updateLanguageStatus(model);
    editorObject.editor.focus();
}

//Open a read-only, in-memory document — used for diffs and generated reports
function openVirtualDocument(title, content, language){
    var editorObject = getFocusedEditorObject();
    if (!editorObject) return;

    var tab = { filename: title, filepath: null, tabUUID: newTabUUID(), saveHash: content.hashCode(), virtual: true };

    editorObject.state[editorObject.currentTabUUID] = editorObject.editor.saveViewState();
    editorObject.model[editorObject.currentTabUUID] = editorObject.editor.getModel();

    appendTabToDOM(editorObject, tab, false);

    var model = monaco.editor.createModel(content, language || "plaintext");
    editorObject.model[tab.tabUUID] = model;
    editorObject.editor.setModel(model);

    $(getCodeAreaFromEditorUUID(editorObject.uuid)).find(".editorcover").hide();
    bindTabItemEvents();
    focusTabWithUUID(tab.tabUUID);
    updateLanguageStatus(model);
    updateFileStatusDisplay(null);
}

function openFileWithSelector(){
    ao_module_openFileSelector(externalFileLoader, "user:/Desktop", "file", true);
}

function openFolderWithSelector(){
    ao_module_openFileSelector(openProjectFolder, "user:/Desktop", "folder");
}

function externalFileLoader(filedata){
    for (var i = 0; i < filedata.length; i++){
        openFile(filedata[i].filepath);
    }
}

/* ═══════════════════════════════════════════════════════════════════
   Saving
   ═══════════════════════════════════════════════════════════════════ */

function saveCurrentFile(){
    var tabInfo = getFocusedTabInfo();
    if (!tabInfo){
        setStatusMessage("info circle", "Nothing to save");
        return;
    }
    if (tabInfo.untitled || !tabInfo.filepath){
        saveCurrentFileAs();
        return;
    }

    var content = getFocusedEditorObject().editor.getValue();
    saveContentToFile(tabInfo.tabUUID, tabInfo.filepath, content, function(data){
        if (data && data.error !== undefined){
            alert(data.error);
            csLog("err", "Save failed: " + data.error);
        } else {
            setStatusMessage("save", "Saved " + tabInfo.filename);
            csLog("ok", "Saved " + tabInfo.filepath);
            refreshGitDecorations();
        }
    });
}

function saveCurrentFileAs(){
    var tabInfo = getFocusedTabInfo();
    if (!tabInfo) return;

    var dirname = currentProjectFolder || "user:/Desktop/";
    var filename = tabInfo.filename;
    if (tabInfo.filepath){
        var parts = tabInfo.filepath.split("/");
        filename = parts.pop();
        dirname = parts.join("/") + "/";
    }

    ao_module_openFileSelector(writeToSaveAsFile, dirname, "new", false, { defaultName: filename });
}

function writeToSaveAsFile(filedata){
    if (!filedata || filedata.length == 0) return;

    var filepath = filedata[0].filepath;
    var filename = filedata[0].filename || filepath.split("/").pop();
    var tabInfo = getFocusedTabInfo();
    var content = getFocusedEditorObject().editor.getValue();

    syscall("writeFile", { filepath: filepath, content: content }, function(data){
        if (data && data.error !== undefined){
            alert(data.error);
            return;
        }

        //Re-point the tab at its new home
        if (tabInfo){
            tabInfo.filepath = filepath;
            tabInfo.filename = filename;
            tabInfo.untitled = false;
            tabInfo.saveHash = content.hashCode();
            $('.tabs .item[uuid="' + tabInfo.tabUUID + '"]').attr("filepath", filepath).attr("title", filepath);
            $('.tabs .item[uuid="' + tabInfo.tabUUID + '"] .tabFilename, #openeditors .row[uuid="' + tabInfo.tabUUID + '"] .tabFilename').text(filename);
            markTabUnsaved(tabInfo.tabUUID, false);
            updateFileStatusDisplay(filepath);
        }

        setStatusMessage("save", "Saved " + filename);
        csLog("ok", "Saved as " + filepath);
        refreshFolderTree();
    });
}

function saveAllFiles(){
    var beforeEditor = getFocusedEditorObject();
    var beforeTabInfo = getFocusedTabInfo();

    editors.forEach(function(entry){
        entry.tabs.forEach(function(tab){
            if (!tab.filepath || tab.error) return;
            var model = (entry.currentTabUUID == tab.tabUUID) ?
                        entry.editor.getModel() : entry.model[tab.tabUUID];
            if (!model) return;
            var content = model.getValue();
            if (content.hashCode() === tab.saveHash) return;    //unchanged
            saveContentToFile(tab.tabUUID, tab.filepath, content);
        });
    });

    if (beforeEditor && beforeTabInfo) changeTab(beforeEditor, beforeTabInfo.tabUUID);
    setStatusMessage("save", "All files saved");
}

function saveContentToFile(tabUUID, filepath, content, callback = undefined){
    syscall("writeFile", { filepath: filepath, content: content }, function(data){
        if (callback !== undefined) callback(data);
        var contentHash = content.hashCode();
        editors.forEach(function(entry){
            entry.tabs.forEach(function(tab){
                if (tab.tabUUID == tabUUID){
                    tab.saveHash = contentHash;
                    markTabUnsaved(tabUUID, false);
                }
            });
        });
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Closing
   ═══════════════════════════════════════════════════════════════════ */

function closeFileCurrentlyFocused(){
    var editorObject = getFocusedEditorObject();
    if (!editorObject) return;
    closeTabWithUUIDAndEditorID(editorObject.currentTabUUID, editorObject.uuid);
}

function closeAllFiles(){
    editors.slice().forEach(function(entry){
        entry.tabs.slice().forEach(function(tab){
            closeTabWithUUIDAndEditorID(tab.tabUUID, entry.uuid);
        });
    });
}

function closeTabsRight(){
    var editorObject = getFocusedEditorObject();
    if (!editorObject) return;
    closeTabsRelativeTo(editorObject, editorObject.currentTabUUID, "right");
}

function closeTabsLeft(){
    var editorObject = getFocusedEditorObject();
    if (!editorObject) return;
    closeTabsRelativeTo(editorObject, editorObject.currentTabUUID, "left");
}

function closeTabsRelativeTo(editorObject, anchorTabUUID, direction){
    var reached = false;
    var toClose = [];

    editorObject.tabs.forEach(function(tab){
        if (tab.tabUUID == anchorTabUUID){ reached = true; return; }
        if (direction == "right" && reached) toClose.push(tab.tabUUID);
        if (direction == "left" && !reached) toClose.push(tab.tabUUID);
    });

    toClose.forEach(function(tabUUID){ closeTabWithUUIDAndEditorID(tabUUID, editorObject.uuid); });
    if (editorObject.tabs.length > 0) changeTab(editorObject, anchorTabUUID);
}

function closeAllFilesWithConfirm(){
    var hasUnsaved = false;
    editors.forEach(function(entry){
        entry.tabs.forEach(function(tab){
            var model = entry.model[tab.tabUUID];
            if (model && model.getValue().hashCode() !== tab.saveHash) hasUnsaved = true;
        });
    });
    if (hasUnsaved && !confirm("Some files have unsaved changes. Close anyway?")) return;
    closeAllFiles();
}

function hanleUserExit(){
    if (getAllOpenedTabs().length > 0){
        if (confirm("Some files might not be saved. Confirm exit?")) ao_module_close();
    } else {
        ao_module_close();
    }
}

/* ═══════════════════════════════════════════════════════════════════
   Editor actions bound to the menus
   ═══════════════════════════════════════════════════════════════════ */

function undo(){
    var editorObject = getFocusedEditorObject();
    if (!editorObject) return;
    editorObject.editor.trigger("codestudio", "undo", null);
    editorObject.editor.focus();
}

function redo(){
    var editorObject = getFocusedEditorObject();
    if (!editorObject) return;
    editorObject.editor.trigger("codestudio", "redo", null);
    editorObject.editor.focus();
}

//Clipboard actions still need a real user gesture in some browsers, so fall
//back to a reminder dialog when the browser refuses the programmatic call.
function showClipboardReminders(rt){
    var editorObject = getFocusedEditorObject();
    var monacoEditor = editorObject ? editorObject.editor : null;

    var actionMap = {
        1: { action: "editor.action.clipboardCutAction",     icon: "cut icon",            hint: "Use the keyboard shortcut Ctrl + X to cut text from the editor." },
        2: { action: "editor.action.clipboardCopyAction",    icon: "copy icon",           hint: "Use the keyboard shortcut Ctrl + C for copying text from the editor." },
        3: { action: "editor.action.clipboardPasteAction",   icon: "paste icon",          hint: "Use the keyboard shortcut Ctrl + V for pasting to editor." },
        4: { action: "actions.find",                         icon: "search icon",         hint: "Press Ctrl + F on the editor to start searching." },
        5: { action: "editor.action.startFindReplaceAction", icon: "sync alternate icon", hint: "Press Ctrl + H on the editor to start replacing text." }
    };

    var entry = actionMap[rt];
    if (!entry) return;

    function showFallback(){
        $("#clipboardReminderText").text(entry.hint);
        $("#clipboardReminderIcon").attr("class", entry.icon);
        $("#clipboardReminder").modal("show");
    }

    if (!monacoEditor){ showFallback(); return; }

    if (rt == 3 && navigator.clipboard && navigator.clipboard.readText){
        navigator.clipboard.readText().then(function(text){
            monacoEditor.focus();
            var selection = monacoEditor.getSelection();
            monacoEditor.executeEdits("paste", [{
                range: new monaco.Range(selection.startLineNumber, selection.startColumn,
                                        selection.endLineNumber, selection.endColumn),
                text: text,
                forceMoveMarkers: true
            }]);
        }).catch(showFallback);
        return;
    }

    try {
        monacoEditor.focus();
        monacoEditor.trigger("keyboard", entry.action, null);
    } catch(e){
        showFallback();
    }
}

/* ═══════════════════════════════════════════════════════════════════
   Status display helpers
   ═══════════════════════════════════════════════════════════════════ */

function updateFileStatusDisplay(filepath){
    $("#sbPath").text(filepath ? filepath : "No file opened");
    refreshWindowTitle();
}

//"about.html — my-website", or just the project name when nothing is open
function currentContextTitle(){
    var projectName = currentProjectFolder ?
        currentProjectFolder.split("/").filter(Boolean).pop() : null;
    var tabInfo = getFocusedTabInfo();
    var filename = tabInfo ? tabInfo.filename : null;

    if (filename && projectName) return filename + "  —  " + projectName;
    if (filename) return filename;
    if (projectName) return projectName;
    return "ArozOS Code Studio";
}

/*
    Where the context text goes depends on the host: the web desktop already
    draws a title bar for the floatWindow, so it is written there and the
    in-page title bar is hidden (see adaptChromeToHost).
*/
function refreshWindowTitle(){
    var context = currentContextTitle();
    $("#titleContext").text(context);

    if (ao_module_virtualDesktop){
        ao_module_setWindowTitle(context);
    } else {
        document.title = (context == "ArozOS Code Studio") ? "Code Studio" : ("Code Studio - " + context);
    }
}

//Kept so older call sites keep working — the title is derived from the state
function setWindowTitle(){ refreshWindowTitle(); }

/* ═══════════════════════════════════════════════════════════════════
   External integrations
   ═══════════════════════════════════════════════════════════════════ */

function getCurrentFocusedFileData(){
    var editorObject = getFocusedEditorObject();
    if (!editorObject) return null;
    for (var i = 0; i < editorObject.tabs.length; i++){
        var tab = editorObject.tabs[i];
        if (tab.tabUUID == editorObject.currentTabUUID && tab.filepath){
            return { filepath: tab.filepath, filename: tab.filename };
        }
    }
    return null;
}

function openFileInFileManager(){
    var fileData = getCurrentFocusedFileData();
    if (fileData == null) return;
    var parts = fileData.filepath.split("/");
    var filename = parts.pop();
    ao_module_openPath(parts.join("/"), filename);
}

function downloadFile(){
    var fileData = getCurrentFocusedFileData();
    if (fileData == null){
        alert("No file selected");
        return;
    }
    window.open("../../../media/download/?file=" + encodeURIComponent(fileData.filepath));
}

function openInNewTab(){
    var fileData = getCurrentFocusedFileData();
    if (fileData == null) return;
    window.open("./index.html#" + encodeURIComponent(JSON.stringify([fileData])));
}

function openInNewFloatWindow(){
    var fileData = getCurrentFocusedFileData();
    if (fileData == null) return;
    ao_module_newfw({
        url: "Code Studio/index.html#" + encodeURIComponent(JSON.stringify([fileData])),
        width: 1024,
        height: 720,
        appicon: "Code Studio/img/module_icon.png",
        title: "Code Studio"
    });
}

function newEditor(){
    ao_module_newfw({
        url: "Code Studio/index.html",
        width: 1024,
        height: 720,
        appicon: "Code Studio/img/module_icon.png",
        title: "Code Studio"
    });
}

//Legacy entry points — the tool system now handles both launch modes
function showColorPicker(){ openTool("colorpicker"); }
function showMobiPreview(){ openTool("mobipreview"); }
function showCompareTool(launchPayload = undefined){ openTool("compare", undefined, launchPayload); }

function compareCurrentProjectFolder(){
    if (!currentProjectFolder){
        alert("No project folder is open. Use File > Open Folder first.");
        return;
    }
    openTool("compare", undefined, { type: "folder", left: currentProjectFolder, right: "" });
}

function compareCurrentFile(){
    var fileData = getCurrentFocusedFileData();
    if (fileData == null){
        alert("No editing file found!");
        return;
    }
    openTool("compare", undefined, { type: "pick", left: fileData.filepath, right: "" });
}

function showLicense(){ $("#licenseInfo").modal("show"); }
function showAboutCodeStudio(){ $("#aboutnpa").modal("show"); }

/* ═══════════════════════════════════════════════════════════════════
   Backend plumbing
   ═══════════════════════════════════════════════════════════════════ */

function syscall(scriptName, data, callback = undefined){
    $.ajax({
        url: "../system/ajgi/interface?script=Code Studio/backend/" + scriptName + ".agi",
        method: "POST",
        data: data,
        success: function(response){
            if (callback !== undefined) callback(response);
        },
        error: function(){
            if (callback !== undefined) callback({ error: "Backend call failed: " + scriptName });
        }
    });
}

function setStorage(key, value){ syscall("store", { opr: "set", key: key, value: value }); }
function getStorage(key, callback){ syscall("store", { opr: "get", key: key }, callback); }

/* ═══════════════════════════════════════════════════════════════════
   Tab drag and drop
   ═══════════════════════════════════════════════════════════════════ */

function allowDrop(event){ event.preventDefault(); }

function fileTabDrag(event){
    var tab = $(event.target).closest(".item");
    event.dataTransfer.setData("uuid", tab.attr("uuid"));
    event.dataTransfer.setData("filename", tab.find(".tabFilename").text());
    event.dataTransfer.setData("filepath", tab.attr("filepath"));
    event.dataTransfer.setData("sourceEditorUUID", tab.attr("editorUUID"));
    event.dataTransfer.effectAllowed = "move";
}

function directoryFileDrag(event){
    var source = $(event.target).closest("[data-path]");
    event.dataTransfer.setData("uuid", new Date().getTime());
    event.dataTransfer.setData("filename", source.data("name"));
    event.dataTransfer.setData("filepath", source.data("path"));
    event.dataTransfer.effectAllowed = "move";
}

function TabDrop(event){
    if (!$(event.target).hasClass("tabs")) return;
    event.preventDefault();

    var tabUUID = event.dataTransfer.getData("uuid");
    var tabFilepath = event.dataTransfer.getData("filepath");
    var sourceEditorUUID = event.dataTransfer.getData("sourceEditorUUID");

    if (!tabFilepath) return;

    var targetEditor = getEditor($(event.target).attr("editoruid"));
    if (targetEditor == undefined) return;

    if (sourceEditorUUID && sourceEditorUUID !== targetEditor.uuid){
        closeTabWithUUIDAndEditorID(tabUUID, sourceEditorUUID);
    }

    openFile(tabFilepath, true, targetEditor);
}

/* ═══════════════════════════════════════════════════════════════════
   Tab context menu
   ═══════════════════════════════════════════════════════════════════ */

function bindTabContextMenu(){
    $(".tabs .item").off("contextmenu").on("contextmenu", function(event){
        event.preventDefault();
        event.stopPropagation();

        selectedTabInfo = {
            tabUUID: $(this).attr("uuid"),
            editorUUID: $(this).attr("editorUUID"),
            filepath: $(this).attr("filepath"),
            element: this
        };

        var items = [
            { label: "Close",              action: "closeCurrentTab()" },
            { label: "Close Others",       action: "closeOtherTabs()" },
            { label: "Close to the Right", action: "closeTabsToTheRight()" },
            { label: "Close to the Left",  action: "closeTabsToTheLeft()" },
            { divider: true },
            { label: "Close All",  action: "closeAllTabsInEditor()" },
            { divider: true },
            { label: "Split Editor Group",     action: "splitEditor()" },
            { label: "Copy Path",              action: "copyFilePathFromTab()" },
            { label: "Reveal in File Manager", action: "revealTabInFileManager()" }
        ];

        showFloatingMenu("#tabContextMenu", items, event.clientX, event.clientY);
    });
}

//Shared renderer for the two right-click menus
function showFloatingMenu(selector, items, x, y){
    var menu = $(selector);
    menu.html(renderMenu(items)).css({ left: 0, top: 0 }).show();

    var left = x, top = y;
    if (left + menu.outerWidth() > window.innerWidth - 6) left = window.innerWidth - menu.outerWidth() - 6;
    if (top + menu.outerHeight() > window.innerHeight - 6) top = Math.max(6, y - menu.outerHeight());
    menu.css({ left: left + "px", top: top + "px" });

    /*
        Dismiss on the next press *outside* the menu. A blanket mousedown
        handler would hide the menu between mousedown and mouseup, so the
        browser would never generate a click on the item under the cursor and
        the entry would silently do nothing.
    */
    setTimeout(function(){
        $(document).off("mousedown.csmenu").on("mousedown.csmenu", function(event){
            if ($(event.target).closest(".menupanel").length > 0) return;
            dismissAllMenus();
        });
    }, 0);
}

function hideTabContextMenu(){ $("#tabContextMenu").hide(); }

function closeCurrentTab(){
    if (!selectedTabInfo) return;
    closeTabWithUUIDAndEditorID(selectedTabInfo.tabUUID, selectedTabInfo.editorUUID);
}

function closeOtherTabs(){
    if (!selectedTabInfo) return;
    var editorObject = getEditor(selectedTabInfo.editorUUID);
    if (!editorObject) return;
    var anchor = selectedTabInfo.tabUUID;
    editorObject.tabs.slice().forEach(function(tab){
        if (tab.tabUUID != anchor) closeTabWithUUIDAndEditorID(tab.tabUUID, editorObject.uuid);
    });
    changeTab(editorObject, anchor);
}

function closeTabsToTheRight(){
    if (!selectedTabInfo) return;
    var editorObject = getEditor(selectedTabInfo.editorUUID);
    if (editorObject) closeTabsRelativeTo(editorObject, selectedTabInfo.tabUUID, "right");
}

function closeTabsToTheLeft(){
    if (!selectedTabInfo) return;
    var editorObject = getEditor(selectedTabInfo.editorUUID);
    if (editorObject) closeTabsRelativeTo(editorObject, selectedTabInfo.tabUUID, "left");
}

function closeAllTabsInEditor(){
    if (!selectedTabInfo) return;
    var editorObject = getEditor(selectedTabInfo.editorUUID);
    if (!editorObject) return;
    editorObject.tabs.slice().forEach(function(tab){
        closeTabWithUUIDAndEditorID(tab.tabUUID, editorObject.uuid);
    });
}

function copyFilePathFromTab(){
    if (!selectedTabInfo || !selectedTabInfo.filepath) return;
    var filepath = selectedTabInfo.filepath;
    copyToClipboard(filepath, function(copied){
        if (copied){
            setStatusMessage("copy", "Path copied to clipboard");
        } else {
            prompt("Copy the path below:", filepath);
        }
    });
}

function revealTabInFileManager(){
    if (!selectedTabInfo || !selectedTabInfo.filepath) return;
    var parts = selectedTabInfo.filepath.split("/");
    var filename = parts.pop();
    ao_module_openPath(parts.join("/"), filename);
}

/*
    navigator.clipboard only exists in a secure context (https or localhost), so
    an ArozOS host reached over plain http on the LAN always needs the textarea
    fallback. The async path can also reject when the document is not focused,
    which is why the fallback runs again on failure.
*/
function copyToClipboard(text, onDone){
    function fallback(){
        var textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();

        var copied = false;
        try { copied = document.execCommand("copy"); } catch(e){ copied = false; }
        document.body.removeChild(textarea);

        if (onDone) onDone(copied);
    }

    if (navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(function(){
            if (onDone) onDone(true);
        }).catch(fallback);
        return;
    }
    fallback();
}
