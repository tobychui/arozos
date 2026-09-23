/*
    Code Studio — workbench

    Owns everything around the editor: colour schemes, the menu bar, the
    activity bar and its side views, the bottom panel, the docked tool
    panel (aux bar), splitters, the status bar and the keyboard shortcuts.

    The editor itself lives in editor.js; the file tree in explorer.js.
*/

/* ═══════════════════════════════════════════════════════════════════
   Preferences
   ═══════════════════════════════════════════════════════════════════ */

var CS_PREF = {
    theme: "dark",              //dark | blue | light
    toolMode: "dock",           //dock | float — where a tool opens by default
    fontSize: 14,
    wordWrap: false,
    minimap: true,
    lineNumbers: true,
    sidebarWidth: 250,
    auxWidth: 380,
    panelHeight: 240,
    sidebarVisible: true,
    activeView: "explorer"
};

var CS_PREF_KEY = "workbench";
var csPrefLoaded = false;

function savePreferences(){
    if (!csPrefLoaded) return;      //never overwrite stored prefs before they load
    setStorage(CS_PREF_KEY, JSON.stringify(CS_PREF));
}

function loadPreferences(callback){
    getStorage(CS_PREF_KEY, function(data){
        if (typeof data === "string"){
            try {
                var stored = JSON.parse(data);
                for (var key in stored){
                    if (CS_PREF.hasOwnProperty(key)) CS_PREF[key] = stored[key];
                }
            } catch(e){ /* corrupted preference blob — fall back to defaults */ }
        }
        csPrefLoaded = true;
        if (callback) callback();
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Colour schemes
   ═══════════════════════════════════════════════════════════════════ */

var CS_THEMES = {
    dark:  { name: "Dark",  monaco: "vs-dark",     meta: "#1e1e1e", fw: "dark"  },
    blue:  { name: "Blue",  monaco: "arozos-blue", meta: "#0d1b2e", fw: "dark"  },
    light: { name: "Light", monaco: "vs",          meta: "#ffffff", fw: "white" }
};

//Register the custom navy theme once Monaco is available
function defineMonacoThemes(){
    if (typeof monaco === "undefined") return;
    monaco.editor.defineTheme("arozos-blue", {
        base: "vs-dark",
        inherit: true,
        rules: [
            { token: "comment", foreground: "5f7793", fontStyle: "italic" },
            { token: "keyword", foreground: "7aa7ff" },
            { token: "string",  foreground: "9ad1a5" },
            { token: "number",  foreground: "e0a678" }
        ],
        colors: {
            "editor.background":                 "#0d1b2e",
            "editor.foreground":                 "#c8d6e8",
            "editorLineNumber.foreground":       "#3f5570",
            "editorCursor.foreground":           "#3b82f6",
            "editor.lineHighlightBackground":    "#12253c",
            "editor.selectionBackground":        "#1d4270",
            "editorIndentGuide.background":      "#1c2f47",
            "editorWidget.background":           "#15263d",
            "editorSuggestWidget.background":    "#15263d",
            "editorGutter.background":           "#0d1b2e",
            "minimap.background":                "#0b1727",
            "scrollbarSlider.background":        "#1c2f4788"
        }
    });
}

function applyTheme(themeName, persist){
    if (!CS_THEMES[themeName]) themeName = "blue";
    CS_PREF.theme = themeName;

    $("body").removeClass("theme-blue theme-dark theme-light").addClass("theme-" + themeName);
    $("meta[name=theme-color]").attr("content", CS_THEMES[themeName].meta);
    $("#sbThemeName").text(CS_THEMES[themeName].name);

    if (typeof monaco !== "undefined"){
        monaco.editor.setTheme(CS_THEMES[themeName].monaco);
    }

    //Match the floatWindow chrome to the scheme when running on the web desktop
    if (typeof ao_module_setWindowTheme === "function" && ao_module_virtualDesktop){
        try { ao_module_setWindowTheme(CS_THEMES[themeName].fw); } catch(e){ /* older host */ }
    }

    //Docked tools live in iframes — let them restyle themselves if they can
    $("#auxBody iframe").each(function(){
        try {
            if (this.contentWindow && typeof this.contentWindow.csSetTheme === "function"){
                this.contentWindow.csSetTheme(themeName);
            }
        } catch(e){ /* cross document access refused */ }
    });

    if (persist !== false) savePreferences();
}

/* ═══════════════════════════════════════════════════════════════════
   Menus
   ═══════════════════════════════════════════════════════════════════ */

var csOpenMenuName = null;

function menuDivider(){ return { divider: true }; }
function menuGroup(label){ return { group: label }; }

//Build the item list for a named menu
function buildMenuItems(name){
    var hasFile = (typeof getCurrentFocusedFileData === "function" && getCurrentFocusedFileData() != null);
    var items = [];

    if (name == "file"){
        items = [
            { label: "New File",    tip: "Ctrl+N",       action: "newUntitledFile()" },
            { label: "New Window",  action: "newEditor()" },
            menuDivider(),
            { label: "Open File",   tip: "Ctrl+O",       action: "openFileWithSelector()" },
            { label: "Open Folder", tip: "Ctrl+Shift+O", action: "openFolderWithSelector()" },
            { label: "Close Folder", action: "closeProjectFolder()", disabled: !currentProjectFolder }
        ];

        //Recently opened project folders, newest first
        var recentFolders = getRecentFolders();
        if (recentFolders.length > 0){
            items.push(menuDivider());
            items.push(menuGroup("Open Recent"));
            recentFolders.forEach(function(entry, index){
                items.push({
                    label: entry.name,
                    tip: shortenVirtualPath(entry.path),
                    action: "openRecentFolder(" + index + ")"
                });
            });
            items.push({ label: "Clear Recently Opened", action: "clearRecentFolders()" });
        }

        items = items.concat([
            menuDivider(),
            { label: "Save",     tip: "Ctrl+S", action: "saveCurrentFile()",   disabled: !hasFile },
            { label: "Save As",  action: "saveCurrentFileAs()", disabled: !hasFile },
            { label: "Save All", action: "saveAllFiles()",      disabled: !hasFile },
            menuDivider(),
            { label: "Close Editor",      action: "closeFileCurrentlyFocused()", disabled: !hasFile },
            { label: "Close All Editors", action: "closeAllFiles()",             disabled: !hasFile },
            { label: "Close to the Right", action: "closeTabsRight()",           disabled: !hasFile },
            { label: "Close to the Left",  action: "closeTabsLeft()",            disabled: !hasFile }
        ]);
        if (ao_module_virtualDesktop){
            items.push(menuDivider());
            items.push({ label: "Exit", action: "hanleUserExit()" });
        }

    } else if (name == "edit"){
        items = [
            { label: "Undo", tip: "Ctrl+Z", action: "undo()" },
            { label: "Redo", tip: "Ctrl+Y", action: "redo()" },
            menuDivider(),
            { label: "Cut",   tip: "Ctrl+X", action: "showClipboardReminders(1)" },
            { label: "Copy",  tip: "Ctrl+C", action: "showClipboardReminders(2)" },
            { label: "Paste", tip: "Ctrl+V", action: "showClipboardReminders(3)" },
            menuDivider(),
            { label: "Find",    tip: "Ctrl+F", action: "showClipboardReminders(4)" },
            { label: "Replace", tip: "Ctrl+H", action: "showClipboardReminders(5)" },
            menuDivider(),
            { label: "Toggle Line Comment", tip: "Ctrl+/", action: "runEditorAction('editor.action.commentLine')" },
            { label: "Format Document",     action: "runEditorAction('editor.action.formatDocument')" }
        ];

    } else if (name == "selection"){
        items = [
            { label: "Select All", tip: "Ctrl+A", action: "runEditorAction('editor.action.selectAll')" },
            menuDivider(),
            { label: "Copy Line Up",   action: "runEditorAction('editor.action.copyLinesUpAction')" },
            { label: "Copy Line Down", action: "runEditorAction('editor.action.copyLinesDownAction')" },
            { label: "Move Line Up",   action: "runEditorAction('editor.action.moveLinesUpAction')" },
            { label: "Move Line Down", action: "runEditorAction('editor.action.moveLinesDownAction')" },
            menuDivider(),
            { label: "Add Cursor Above", action: "runEditorAction('editor.action.insertCursorAbove')" },
            { label: "Add Cursor Below", action: "runEditorAction('editor.action.insertCursorBelow')" },
            { label: "Select All Occurrences", action: "runEditorAction('editor.action.selectHighlights')" }
        ];

    } else if (name == "view"){
        items = [
            { label: "Command Palette", tip: "F1", action: "runEditorAction('editor.action.quickCommand')" },
            menuDivider(),
            { label: "Explorer",       tip: "Ctrl+Shift+E", action: "showSideView('explorer')", check: CS_PREF.sidebarVisible && CS_PREF.activeView == "explorer" },
            { label: "Search",         tip: "Ctrl+Shift+F", action: "showSideView('search')",   check: CS_PREF.sidebarVisible && CS_PREF.activeView == "search" },
            { label: "Source Control", tip: "Ctrl+Shift+G", action: "showSideView('scm')",      check: CS_PREF.sidebarVisible && CS_PREF.activeView == "scm" },
            { label: "Run",            action: "showSideView('run')",   check: CS_PREF.sidebarVisible && CS_PREF.activeView == "run" },
            { label: "Tools",          action: "showSideView('tools')", check: CS_PREF.sidebarVisible && CS_PREF.activeView == "tools" },
            menuDivider(),
            { label: "Side Bar",   tip: "Ctrl+B", action: "toggleSidebar()", check: CS_PREF.sidebarVisible },
            { label: "Panel",      tip: "Ctrl+`", action: "togglePanel()",   check: $("#bottomPanel").hasClass("open") },
            { label: "Tool Panel", action: "toggleAuxBar()", check: $("#auxbar").hasClass("open") },
            menuDivider(),
            { label: "Word Wrap",    action: "toggleWordWrap()",   check: CS_PREF.wordWrap },
            { label: "Minimap",      action: "toggleMinimap()",    check: CS_PREF.minimap },
            { label: "Line Numbers", action: "toggleLineNumbers()",check: CS_PREF.lineNumbers },
            menuDivider(),
            { label: "Zoom In",        tip: "Ctrl++", action: "changeFontSize(1)" },
            { label: "Zoom Out",       tip: "Ctrl+-", action: "changeFontSize(-1)" },
            { label: "Reset Zoom",     action: "setFontSize(14)" },
            menuDivider(),
            { label: "New Editor Group",   action: "splitEditor()" },
            { label: "Open in New Tab",    action: "openInNewTab()",         disabled: !hasFile },
            { label: "Open in floatWindow",action: "openInNewFloatWindow()", disabled: !hasFile }
        ];

    } else if (name == "go"){
        items = [
            { label: "Go to File",   tip: "Ctrl+O", action: "openFileWithSelector()" },
            { label: "Go to Line",   tip: "Ctrl+G", action: "gotoLine()",  disabled: !hasFile },
            { label: "Go to Symbol", action: "runEditorAction('editor.action.quickOutline')", disabled: !hasFile },
            menuDivider(),
            { label: "Next Problem",     action: "runEditorAction('editor.action.marker.next')",  disabled: !hasFile },
            { label: "Previous Problem", action: "runEditorAction('editor.action.marker.prev')",  disabled: !hasFile },
            menuDivider(),
            { label: "Reveal in File Manager", action: "openFileInFileManager()", disabled: !hasFile },
            { label: "Download Active File",   action: "downloadFile()",          disabled: !hasFile }
        ];

    } else if (name == "run"){
        items = [
            { label: "Run Active File in Terminal", tip: "Ctrl+R", action: "runCurrentFileInTerminal()", disabled: !hasFile },
            { label: "Preview Active File",         action: "openLivePreview()",  disabled: !hasFile },
            menuDivider(),
            { label: "Responsive Design Viewer", action: "openTool('mobipreview')", disabled: !hasFile },
            menuDivider(),
            { label: "New Terminal Session", action: "newTerminalSession()" }
        ];

    } else if (name == "terminal"){
        items = [
            { label: "New Terminal",  tip: "Ctrl+Shift+`", action: "newTerminalSession()" },
            { label: "Kill Active Terminal", action: "killActiveTerminal()" },
            menuDivider(),
            { label: "Clear Terminal", action: "clearActiveTerminal()" },
            { label: "Run Active File", action: "runCurrentFileInTerminal()", disabled: !hasFile },
            menuDivider(),
            { label: "Toggle Panel", tip: "Ctrl+`", action: "togglePanel()", check: $("#bottomPanel").hasClass("open") }
        ];

    } else if (name == "tools"){
        items = [ menuGroup("Open tools in"),
            { label: "Side Panel",   action: "setToolMode('dock')",  check: CS_PREF.toolMode == "dock" },
            { label: "Float Window", action: "setToolMode('float')", check: CS_PREF.toolMode == "float" },
            menuDivider(),
            menuGroup("Tool windows") ];

        for (var toolName in CS_TOOLS){
            var tool = CS_TOOLS[toolName];
            items.push({
                label: tool.full || tool.title,
                tip: '<i class="' + tool.icon + ' icon"></i>',
                tipIsHTML: true,
                action: "toggleTool('" + toolName + "')",
                check: isToolDocked(toolName)
            });
        }

        items.push(menuDivider());
        items.push({ label: "Compare This Project Folder", action: "compareCurrentProjectFolder()", disabled: !currentProjectFolder });
        items.push({ label: "Compare Active File",         action: "compareCurrentFile()",          disabled: !hasFile });
        items.push(menuDivider());
        items.push({ label: "Close All Docked Tools", action: "closeAllTools()", disabled: csDockedTools.length == 0 });

    } else if (name == "theme"){
        items = [ menuGroup("Colour scheme") ];
        for (var t in CS_THEMES){
            items.push({
                label: CS_THEMES[t].name,
                action: "applyTheme('" + t + "')",
                check: CS_PREF.theme == t
            });
        }

    } else if (name == "settings"){
        items = [
            { label: "Colour Scheme", action: "openMenu('theme', document.querySelector('#sbTheme'))" },
            menuDivider(),
            menuGroup("Editor font size") ];
        [12, 13, 14, 16, 18, 20].forEach(function(size){
            items.push({ label: size + " px", action: "setFontSize(" + size + ")", check: CS_PREF.fontSize == size });
        });
        items.push(menuDivider());
        items.push({ label: "Word Wrap",    action: "toggleWordWrap()",    check: CS_PREF.wordWrap });
        items.push({ label: "Minimap",      action: "toggleMinimap()",     check: CS_PREF.minimap });
        items.push({ label: "Line Numbers", action: "toggleLineNumbers()", check: CS_PREF.lineNumbers });
        items.push(menuDivider());
        items.push({ label: "Open tools in the side panel", action: "setToolMode('dock')",  check: CS_PREF.toolMode == "dock" });
        items.push({ label: "Open tools in a float window", action: "setToolMode('float')", check: CS_PREF.toolMode == "float" });

    } else if (name == "help"){
        items = [
            { label: "AGI API Reference", action: "window.open('../Terminal/index.html')" },
            { label: "About Monaco Editor", action: "window.open('https://microsoft.github.io/monaco-editor/')" },
            menuDivider(),
            { label: "License", action: "showLicense()" },
            { label: "About Code Studio", action: "showAboutCodeStudio()" }
        ];

    } else if (name == "indent"){
        items = [ menuGroup("Indentation") ];
        [2, 4, 8].forEach(function(size){
            items.push({ label: "Spaces: " + size, action: "setIndentation(" + size + ", true)" });
        });
        items.push({ label: "Tab size: 4", action: "setIndentation(4, false)" });

    } else if (name == "eol"){
        items = [
            { label: "LF",   action: "setEndOfLine('LF')" },
            { label: "CRLF", action: "setEndOfLine('CRLF')" }
        ];

    } else if (name == "language"){
        items = [ menuGroup("Language mode") ];
        var langs = (typeof monaco !== "undefined") ? monaco.languages.getLanguages() : [];
        langs.sort(function(a, b){
            var an = (a.aliases && a.aliases[0]) ? a.aliases[0] : a.id;
            var bn = (b.aliases && b.aliases[0]) ? b.aliases[0] : b.id;
            return an.toLowerCase() < bn.toLowerCase() ? -1 : 1;
        });
        langs.forEach(function(lang){
            var display = (lang.aliases && lang.aliases[0]) ? lang.aliases[0] : lang.id;
            items.push({ label: display, action: "setEditorLanguage('" + lang.id + "')" });
        });
    }

    return items;
}

function renderMenu(items){
    var html = "";
    items.forEach(function(item){
        if (item.divider){
            html += '<div class="divider"></div>';
            return;
        }
        if (item.group){
            html += '<div class="grouplabel">' + item.group + '</div>';
            return;
        }
        var tip = "";
        if (item.tip) tip = '<span class="tips">' + (item.tipIsHTML ? item.tip : escapeHTMLText(item.tip)) + '</span>';
        var check = item.check ? '<span class="check"><i class="check icon"></i></span>' : '';
        var click = item.disabled ? "" : ' onclick="dismissAllMenus(); ' + item.action + ';"';
        html += '<div class="item' + (item.disabled ? " disabled" : "") + '"' + click + '>' +
                    check +
                    '<span class="label">' + escapeHTMLText(item.label) + '</span>' + tip +
                '</div>';
    });
    return html;
}

function openMenu(name, anchor){
    //Clicking the open menu again closes it
    if (csOpenMenuName == name && $("#mainMenu").is(":visible")){
        closeMenu();
        return;
    }

    var menu = $("#mainMenu");
    menu.html(renderMenu(buildMenuItems(name)));
    csOpenMenuName = name;

    $("#menubar .menuitem").removeClass("open");
    $('#menubar .menuitem[data-menu="' + name + '"]').addClass("open");

    //Show first so the rendered size is measurable, then place it on screen
    menu.css({ left: 0, top: 0, maxHeight: (window.innerHeight - 80) + "px", overflowY: "auto" }).show();

    var rect = anchor ? anchor.getBoundingClientRect() : { left: 10, bottom: 60, top: 60 };
    var left = rect.left;
    var top = rect.bottom + 2;

    if (left + menu.outerWidth() > window.innerWidth - 6){
        left = Math.max(6, window.innerWidth - menu.outerWidth() - 6);
    }
    if (top + menu.outerHeight() > window.innerHeight - 6){
        top = Math.max(6, rect.top - menu.outerHeight() - 2);
    }

    menu.css({ left: left + "px", top: top + "px" });
}

function closeMenu(){
    $("#mainMenu").hide();
    $("#menubar .menuitem").removeClass("open");
    csOpenMenuName = null;
}

/*
    Close every menu, including the two right-click ones. Called from each menu
    item before its action runs, so it must not clear the selection the action
    works on (selectedFolderItem / selectedTabInfo).
*/
function dismissAllMenus(){
    closeMenu();
    $("#folderContextMenu, #tabContextMenu").hide();
    $(document).off("mousedown.csmenu");
}

//Legacy entry point kept so old callers (and the embedded launcher) keep working
function initContextMenu(target, object){ openMenu(target, object); }
function hideContextMenu(){ closeMenu(); }

function escapeHTMLText(text){
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;")
                       .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ═══════════════════════════════════════════════════════════════════
   Layout — activity bar, sidebar, panel, aux bar
   ═══════════════════════════════════════════════════════════════════ */

function showSideView(viewName){
    //Clicking the active view icon collapses the sidebar, like VS Code
    if (CS_PREF.activeView == viewName && CS_PREF.sidebarVisible){
        toggleSidebar(false);
        return;
    }
    setSideView(viewName);
}

//Switch the sidebar to a view without the collapse-on-repeat behaviour
function setSideView(viewName){
    CS_PREF.activeView = viewName;
    $("#activitybar .actitem").removeClass("active");
    $('#activitybar .actitem[data-view="' + viewName + '"]').addClass("active");
    $(".sideview").removeClass("active");
    $('.sideview[data-view="' + viewName + '"]').addClass("active");

    toggleSidebar(true);

    if (viewName == "scm") refreshGitStatus();
    if (viewName == "search") $("#searchKeyword").focus();
    savePreferences();
}

function toggleSidebar(forceState){
    var visible = (forceState === undefined) ? !CS_PREF.sidebarVisible : forceState;
    CS_PREF.sidebarVisible = visible;
    $("#sidebar").toggleClass("collapsed", !visible);
    $("#split-sidebar").toggle(visible);
    $("#btnToggleSidebar").toggleClass("active", visible);
    $("#activitybar .actitem").removeClass("active");
    if (visible){
        $('#activitybar .actitem[data-view="' + CS_PREF.activeView + '"]').addClass("active");
    }
    relayoutEditors();
    savePreferences();
}

function togglePanel(forceState){
    var open = (forceState === undefined) ? !$("#bottomPanel").hasClass("open") : forceState;
    $("#bottomPanel").toggleClass("open", open);
    $("#split-panel").toggleClass("open", open);
    $("#btnTogglePanel").toggleClass("active", open);

    if (open && csTerminals.length == 0 && $("#terminalView").hasClass("active")){
        newTerminalSession();
    }
    relayoutEditors();
}

function showPanelView(viewName, forceOpen){
    if (forceOpen) togglePanel(true);
    $(".paneltabs .ptab").removeClass("active");
    $('.paneltabs .ptab[data-panel="' + viewName + '"]').addClass("active");
    $(".panelview").removeClass("active");
    if (viewName == "terminal"){
        $("#terminalView").addClass("active");
        if (csTerminals.length == 0) newTerminalSession();
        focusActiveTerminal();
    } else if (viewName == "problems"){
        $("#problemsView").addClass("active");
    } else if (viewName == "output"){
        $("#outputView").addClass("active");
    }
}

function clearActivePanelView(){
    if ($("#terminalView").hasClass("active")) clearActiveTerminal();
    else if ($("#outputView").hasClass("active")) $("#outputList").html("");
}

function toggleAuxBar(forceState){
    var open = (forceState === undefined) ? !$("#auxbar").hasClass("open") : forceState;
    if (open && csDockedTools.length == 0){
        setStatusMessage("info circle", "Enable a tool from the Tools menu first");
        return;
    }
    $("#auxbar").toggleClass("open", open);
    $("#split-aux").toggleClass("open", open);
    $("#btnToggleAux").toggleClass("active", open);
    relayoutEditors();
}

function toggleSection(head){
    $(head).parent().toggleClass("collapsed");
    var caret = $(head).find(".caret i");
    caret.attr("class", $(head).parent().hasClass("collapsed") ? "caret right icon" : "caret down icon");
}

function relayoutEditors(){
    if (typeof editors === "undefined") return;
    editors.forEach(function(entry){
        try { entry.editor.layout(); } catch(e){ /* editor disposed */ }
    });
}

/* ── Splitters ─────────────────────────────────────────────────── */

function initSplitters(){
    bindVerticalSplitter("#split-sidebar", "#sidebar", 160, 620, function(width){
        CS_PREF.sidebarWidth = width;
    });
    bindVerticalSplitter("#split-aux", "#auxbar", 220, 760, function(width){
        CS_PREF.auxWidth = width;
    }, true);
    bindHorizontalSplitter("#split-panel", "#bottomPanel", 90, function(height){
        CS_PREF.panelHeight = height;
    });
}

function bindVerticalSplitter(splitterSel, targetSel, minWidth, maxWidth, onResize, fromRight){
    var dragging = false;

    $(splitterSel).on("mousedown", function(event){
        dragging = true;
        $(splitterSel).addClass("dragging");
        $("body").css("cursor", "col-resize");
        event.preventDefault();
    });

    $(document).on("mousemove", function(event){
        if (!dragging) return;
        var width = fromRight ? (window.innerWidth - event.clientX) : event.clientX - $("#activitybar").outerWidth();
        width = Math.max(minWidth, Math.min(maxWidth, width));
        $(targetSel).css("width", width + "px");
        relayoutEditors();
    });

    $(document).on("mouseup", function(){
        if (!dragging) return;
        dragging = false;
        $(splitterSel).removeClass("dragging");
        $("body").css("cursor", "");
        onResize(parseInt($(targetSel).css("width"), 10));
        savePreferences();
    });
}

function bindHorizontalSplitter(splitterSel, targetSel, minHeight, onResize){
    var dragging = false;

    $(splitterSel).on("mousedown", function(event){
        dragging = true;
        $(splitterSel).addClass("dragging");
        $("body").css("cursor", "row-resize");
        event.preventDefault();
    });

    $(document).on("mousemove", function(event){
        if (!dragging) return;
        var bounds = document.getElementById("center").getBoundingClientRect();
        var height = bounds.bottom - event.clientY;
        height = Math.max(minHeight, Math.min(bounds.height - 80, height));
        $(targetSel).css("height", height + "px");
        relayoutEditors();
    });

    $(document).on("mouseup", function(){
        if (!dragging) return;
        dragging = false;
        $(splitterSel).removeClass("dragging");
        $("body").css("cursor", "");
        onResize(parseInt($(targetSel).css("height"), 10));
        savePreferences();
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Tool windows

   A tool is a small web app under ./tools/. It can be shown docked in
   the aux bar or, exactly like before, as its own floatWindow. Nothing
   opens by itself — the user enables it from the Tools menu or the
   Tools side view.
   ═══════════════════════════════════════════════════════════════════ */

var CS_TOOLS = {
    mobipreview: {
        title: "Preview",
        full: "Responsive Design Viewer",
        icon: "mobile alternate",
        url: "tools/mobipreview/index.html",
        fw: { width: 350, height: 625 },
        needsFile: true
    },
    colorpicker: {
        title: "Colours",
        full: "Colour Picker",
        icon: "eyedropper",
        url: "tools/colorpicker/index.html",
        fw: { width: 365, height: 200 }
    },
    compare: {
        title: "Compare",
        full: "Folder & File Compare",
        icon: "columns",
        url: "tools/compare/index.html",
        fw: { width: 1024, height: 660 }
    }
};

var csDockedTools = [];         //names of tools currently docked in the aux bar

function isToolDocked(toolName){ return csDockedTools.indexOf(toolName) !== -1; }

function setToolMode(mode){
    CS_PREF.toolMode = (mode == "float") ? "float" : "dock";
    savePreferences();
    renderToolList();
    setStatusMessage("check", "Tools now open in " + (CS_PREF.toolMode == "dock" ? "the side panel" : "a float window"));
}

//Build the launch URL of a tool, including any payload it needs
function buildToolURL(toolName, payload){
    var tool = CS_TOOLS[toolName];
    var url = tool.url;

    if (toolName == "mobipreview"){
        var fileData = (typeof getCurrentFocusedFileData === "function") ? getCurrentFocusedFileData() : null;
        if (fileData == null) return null;
        url += "#" + encodeURIComponent(JSON.stringify([fileData]));
    } else if (toolName == "compare" && payload){
        url += "#" + encodeURIComponent(JSON.stringify(payload));
    }

    return url;
}

function openTool(toolName, mode, payload){
    var tool = CS_TOOLS[toolName];
    if (!tool) return;

    var url = buildToolURL(toolName, payload);
    if (url == null){
        alert("Open a file first — this tool works on the file you are editing.");
        return;
    }

    var useMode = mode || CS_PREF.toolMode;
    if (useMode == "float"){
        ao_module_newfw({
            url: "Code Studio/" + url,
            width: tool.fw.width,
            height: tool.fw.height,
            appicon: "Code Studio/img/module_icon.png",
            title: tool.full || tool.title
        });
        return;
    }

    dockTool(toolName, url);
}

function dockTool(toolName, url){
    var tool = CS_TOOLS[toolName];

    if (isToolDocked(toolName)){
        //Already docked — refresh its payload and bring it to the front
        $('#auxBody .auxpane[data-tool="' + toolName + '"] iframe').attr("src", url);
        showToolTab(toolName);
        toggleAuxBar(true);
        return;
    }

    $("#auxTabs .spacer").before(
        '<div class="atab" data-tool="' + toolName + '" onclick="showToolTab(\'' + toolName + '\');">' +
            '<i class="' + tool.icon + ' icon"></i>' + escapeHTMLText(tool.title) +
            '<span class="closebtn" onclick="event.stopPropagation(); closeTool(\'' + toolName + '\');"><i class="times icon"></i></span>' +
        '</div>');

    $("#auxBody").append(
        '<div class="auxpane" data-tool="' + toolName + '">' +
            '<div class="toolbar">' +
                '<span style="flex:1;">' + escapeHTMLText(tool.full || tool.title) + '</span>' +
                '<span class="iconbtn" title="Reload" onclick="reloadTool(\'' + toolName + '\');"><i class="refresh icon"></i></span>' +
                '<span class="iconbtn" title="Open in floatWindow" onclick="popOutTool(\'' + toolName + '\');"><i class="window restore outline icon"></i></span>' +
                '<span class="iconbtn" title="Close" onclick="closeTool(\'' + toolName + '\');"><i class="times icon"></i></span>' +
            '</div>' +
            '<iframe src="' + url + '" frameborder="0"></iframe>' +
        '</div>');

    csDockedTools.push(toolName);
    showToolTab(toolName);
    toggleAuxBar(true);
    renderToolList();
}

function showToolTab(toolName){
    $("#auxTabs .atab").removeClass("active");
    $('#auxTabs .atab[data-tool="' + toolName + '"]').addClass("active");
    $("#auxBody .auxpane").removeClass("active");
    $('#auxBody .auxpane[data-tool="' + toolName + '"]').addClass("active");
}

function closeTool(toolName){
    $('#auxTabs .atab[data-tool="' + toolName + '"]').remove();
    $('#auxBody .auxpane[data-tool="' + toolName + '"]').remove();
    csDockedTools = csDockedTools.filter(function(name){ return name != toolName; });

    if (csDockedTools.length == 0){
        toggleAuxBar(false);
    } else if ($("#auxBody .auxpane.active").length == 0){
        showToolTab(csDockedTools[csDockedTools.length - 1]);
    }
    renderToolList();
}

function closeAllTools(){
    csDockedTools.slice().forEach(function(name){ closeTool(name); });
}

function toggleTool(toolName){
    if (isToolDocked(toolName)) closeTool(toolName);
    else openTool(toolName);
}

function reloadTool(toolName){
    var frame = $('#auxBody .auxpane[data-tool="' + toolName + '"] iframe');
    var url = buildToolURL(toolName);
    frame.attr("src", url || frame.attr("src"));
}

function popOutTool(toolName){
    closeTool(toolName);
    openTool(toolName, "float");
}

//The Tools side view — one row per tool with both launch modes
function renderToolList(){
    var html = "";
    for (var toolName in CS_TOOLS){
        var tool = CS_TOOLS[toolName];
        html += '<div class="row' + (isToolDocked(toolName) ? " selected" : "") + '" ' +
                     'onclick="openTool(\'' + toolName + '\', \'dock\');" title="' + escapeHTMLText(tool.full || tool.title) + '">' +
                    '<i class="' + tool.icon + ' icon"></i>' +
                    '<span class="name">' + escapeHTMLText(tool.full || tool.title) + '</span>' +
                    '<span class="rowbtn" title="Open in floatWindow" ' +
                          'onclick="event.stopPropagation(); openTool(\'' + toolName + '\', \'float\');">' +
                        '<i class="window restore outline icon"></i></span>' +
                '</div>';
    }
    $("#toolList").html(html);
}

/* Live preview — opens the active file through the ArozOS media endpoint */
function openLivePreview(){
    var fileData = (typeof getCurrentFocusedFileData === "function") ? getCurrentFocusedFileData() : null;
    if (fileData == null){
        alert("No file is open.");
        return;
    }
    openTool("mobipreview");
}

/* ═══════════════════════════════════════════════════════════════════
   Status bar and output log
   ═══════════════════════════════════════════════════════════════════ */

var csStatusTimer = null;

function setStatusMessage(icon, message){
    $("#sbMessage").html('<i class="' + icon + ' icon"></i>' + escapeHTMLText(message))
                   .addClass("flash").show();
    if (csStatusTimer) clearTimeout(csStatusTimer);
    csStatusTimer = setTimeout(function(){
        $("#sbMessage").removeClass("flash").fadeOut("fast");
    }, 4000);
}

//Kept for backwards compatibility with the old inline calls
function msgbox(icon, message){ setStatusMessage(icon, message); }

function csLog(type, message){
    var stamp = new Date().toLocaleTimeString();
    $("#outputList").append(
        '<div class="logrow ' + type + '"><span class="ts">' + stamp + '</span>' +
        '<span>' + escapeHTMLText(message) + '</span></div>');
    var list = document.getElementById("outputList");
    list.parentElement.scrollTop = list.parentElement.scrollHeight;
}

function updateCursorStatus(position){
    if (!position) return;
    $("#sbCursor").text("Ln " + position.lineNumber + ", Col " + position.column);
}

function updateLanguageStatus(model){
    if (!model){
        $("#sbLanguage").text("Plain Text");
        $("#sbEol").text("LF");
        return;
    }
    var languageId = model.getLanguageId ? model.getLanguageId() : model.getModeId();
    var langs = monaco.languages.getLanguages().filter(function(lang){ return lang.id == languageId; });
    var display = languageId;
    if (langs.length > 0 && langs[0].aliases && langs[0].aliases[0]) display = langs[0].aliases[0];
    $("#sbLanguage").text(display);
    $("#sbEol").text(model.getEOL() == "\n" ? "LF" : "CRLF");
}

//Mirror Monaco's diagnostics into the Problems panel and the status bar
function refreshProblems(){
    if (typeof monaco === "undefined") return;
    var markers = monaco.editor.getModelMarkers({});
    var errors = 0, warnings = 0;
    var html = "";

    markers.forEach(function(marker){
        var severity = "info";
        if (marker.severity == monaco.MarkerSeverity.Error){ severity = "err"; errors++; }
        else if (marker.severity == monaco.MarkerSeverity.Warning){ severity = "warn"; warnings++; }

        var filename = "";
        try { filename = decodeURIComponent(marker.resource.path.split("/").pop()); } catch(e){ filename = "editor"; }

        html += '<div class="logrow ' + severity + '"><span class="ts">' +
                escapeHTMLText(filename) + ':' + marker.startLineNumber + '</span>' +
                '<span>' + escapeHTMLText(marker.message) + '</span></div>';
    });

    $("#sbErrors").text(errors);
    $("#sbWarnings").text(warnings);
    $("#problemCount").text(errors + warnings);
    $("#problemsList").html(html);
    $("#problemsEmpty").toggle(markers.length == 0);
}

/* ═══════════════════════════════════════════════════════════════════
   Editor option helpers driven by the menus and the status bar
   ═══════════════════════════════════════════════════════════════════ */

function eachEditor(callback){
    if (typeof editors === "undefined") return;
    editors.forEach(function(entry){ callback(entry.editor, entry); });
}

function runEditorAction(actionId){
    var editorObject = getFocusedEditorObject();
    if (!editorObject) return;
    editorObject.editor.focus();
    editorObject.editor.trigger("codestudio", actionId, null);
}

function changeFontSize(delta){
    setFontSize(Math.max(8, Math.min(40, CS_PREF.fontSize + delta)));
}

function setFontSize(fontsize){
    fontsize = parseInt(fontsize, 10);
    if (isNaN(fontsize)) return;
    CS_PREF.fontSize = fontsize;
    eachEditor(function(editor){ editor.updateOptions({ fontSize: fontsize }); });
    savePreferences();
}

function toggleWordWrap(){
    CS_PREF.wordWrap = !CS_PREF.wordWrap;
    eachEditor(function(editor){ editor.updateOptions({ wordWrap: CS_PREF.wordWrap ? "on" : "off" }); });
    savePreferences();
}

function toggleMinimap(){
    CS_PREF.minimap = !CS_PREF.minimap;
    eachEditor(function(editor){ editor.updateOptions({ minimap: { enabled: CS_PREF.minimap } }); });
    savePreferences();
}

function toggleLineNumbers(){
    CS_PREF.lineNumbers = !CS_PREF.lineNumbers;
    eachEditor(function(editor){ editor.updateOptions({ lineNumbers: CS_PREF.lineNumbers ? "on" : "off" }); });
    savePreferences();
}

function applyEditorPreferences(editor){
    editor.updateOptions({
        fontSize: CS_PREF.fontSize,
        wordWrap: CS_PREF.wordWrap ? "on" : "off",
        minimap: { enabled: CS_PREF.minimap },
        lineNumbers: CS_PREF.lineNumbers ? "on" : "off"
    });
}

function setIndentation(size, useSpaces){
    var editorObject = getFocusedEditorObject();
    if (!editorObject) return;
    var model = editorObject.editor.getModel();
    if (!model) return;
    model.updateOptions({ tabSize: size, insertSpaces: useSpaces });
    $("#sbIndent").text((useSpaces ? "Spaces: " : "Tab size: ") + size);
}

function setEndOfLine(mode){
    var editorObject = getFocusedEditorObject();
    if (!editorObject) return;
    var model = editorObject.editor.getModel();
    if (!model) return;
    model.pushEOL(mode == "CRLF" ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF);
    $("#sbEol").text(mode);
}

function setEditorLanguage(languageId){
    var editorObject = getFocusedEditorObject();
    if (!editorObject) return;
    var model = editorObject.editor.getModel();
    if (!model) return;
    monaco.editor.setModelLanguage(model, languageId);
    updateLanguageStatus(model);
}

function gotoLine(){
    runEditorAction("editor.action.gotoLine");
}

/* ═══════════════════════════════════════════════════════════════════
   Keyboard shortcuts (outside Monaco's own key bindings)
   ═══════════════════════════════════════════════════════════════════ */

function bindWorkbenchShortcuts(){
    $(document).on("keydown", function(event){
        var ctrl = event.ctrlKey || event.metaKey;

        if (ctrl && event.shiftKey && event.key === "~"){ // Ctrl+Shift+`
            event.preventDefault(); togglePanel(true); newTerminalSession(); return;
        }
        if (ctrl && event.key === "`"){
            event.preventDefault(); togglePanel(); showPanelView("terminal"); return;
        }
        if (ctrl && event.shiftKey && (event.key === "E" || event.key === "e")){
            event.preventDefault(); showSideView("explorer"); return;
        }
        if (ctrl && event.shiftKey && (event.key === "F" || event.key === "f")){
            event.preventDefault(); showSideView("search"); return;
        }
        if (ctrl && event.shiftKey && (event.key === "G" || event.key === "g")){
            event.preventDefault(); showSideView("scm"); return;
        }
        if (ctrl && !event.shiftKey && (event.key === "b" || event.key === "B")){
            event.preventDefault(); toggleSidebar(); return;
        }
        if (ctrl && !event.shiftKey && (event.key === "n" || event.key === "N")){
            event.preventDefault(); newUntitledFile(); return;
        }
        if (ctrl && !event.shiftKey && (event.key === "o" || event.key === "O")){
            event.preventDefault(); openFileWithSelector(); return;
        }
        if (ctrl && event.shiftKey && (event.key === "O")){
            event.preventDefault(); openFolderWithSelector(); return;
        }
        if (ctrl && !event.shiftKey && (event.key === "r" || event.key === "R")){
            event.preventDefault(); runCurrentFileInTerminal(); return;
        }
        if (event.key === "Escape"){
            closeMenu();
        }
    });

    //Any click outside a menu closes it
    $(document).on("mousedown", function(event){
        if ($(event.target).closest("#mainMenu, #menubar, #activitybar, #statusbar").length == 0){
            closeMenu();
        }
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Boot
   ═══════════════════════════════════════════════════════════════════ */

function bootCodeStudio(){
    applyTheme(CS_PREF.theme, false);
    adaptChromeToHost();
    renderToolList();
    initSplitters();
    bindWorkbenchShortcuts();
    renderWelcomeScreen();
    //The list arrives from the module database — redraw the welcome screen with it
    loadRecentFolders(function(){
        if ($("#ca1 .editorcover").is(":visible")) renderWelcomeScreen();
    });

    //Preferences arrive from the system database — re-apply once they land
    loadPreferences(function(){
        applyTheme(CS_PREF.theme, false);
        $("#sidebar").css("width", CS_PREF.sidebarWidth + "px");
        $("#auxbar").css("width", CS_PREF.auxWidth + "px");
        $("#bottomPanel").css("height", CS_PREF.panelHeight + "px");
        $("#sbIndent").text("Spaces: 4");
        var restoreSidebar = CS_PREF.sidebarVisible;
        setSideView(CS_PREF.activeView);
        toggleSidebar(restoreSidebar);
        eachEditor(function(editor){ applyEditorPreferences(editor); });
    });

    //Boot the editor itself
    initEditor($("#ca1").find(".editor")[0], "mainEditor", ao_module_loadInputFiles(), restoreEditorState);

    //Keep the login session warm and mirror it on the status bar
    startSessionHeartbeat();

    //The bundled Monaco build predates onDidChangeMarkers, so poll the
    //diagnostics instead. The poll stops itself if the event is available.
    var markerPoll = setInterval(function(){
        if (window.csMarkerListenerBound){
            clearInterval(markerPoll);
            return;
        }
        if (typeof monaco !== "undefined" && monaco.editor && monaco.editor.getModelMarkers){
            refreshProblems();
        }
    }, 3000);

    $(window).on("resize", relayoutEditors);
}

/*
    On the web desktop the floatWindow already draws a title bar with the app
    icon and title, so the in-page one is redundant: hide it, hand the context
    text to the host title bar (see refreshWindowTitle) and move the layout
    controls down into the menu bar row.
*/
function adaptChromeToHost(){
    if (!ao_module_virtualDesktop) return;
    $("#titlebar").hide();
    $("#menubar .spacer").after($("#titlebar .titleactions").children());
}

/*
    Keep the login session warm during a long editing sitting. The web desktop
    already does this for its own windows, so the ping only runs standalone, and
    it stays silent unless the session has actually gone away — in which case the
    user needs to know before their next save fails.
*/
function startSessionHeartbeat(){
    if (ao_module_virtualDesktop) return;

    function ping(){
        $.get("../system/auth/checkLogin", function(data){
            if (data && data.error !== undefined){
                setStatusMessage("exclamation triangle", "Session: " + data.error);
                csLog("err", "Session check failed: " + data.error);
            }
        });
    }

    ping();
    setInterval(ping, 30000);
}

function renderWelcomeScreen(){
    //Recently opened projects, so a folder is one click away from a cold start
    var recentColumn = "";
    var recentFolders = (typeof getRecentFolders === "function") ? getRecentFolders() : [];

    if (recentFolders.length > 0){
        recentColumn = '<div class="col"><h4>Recent</h4>';
        recentFolders.slice(0, 6).forEach(function(entry, index){
            recentColumn += '<a onclick="openRecentFolder(' + index + ');" title="' + escapeHTMLText(entry.path) + '">' +
                                escapeHTMLText(entry.name) +
                                '<span class="recentpath">' + escapeHTMLText(shortenVirtualPath(entry.path)) + '</span>' +
                            '</a>';
        });
        recentColumn += '</div>';
    }

    var html =
        '<div class="welcome">' +
            '<h1>Code Studio</h1>' +
            '<div class="tagline">The code editor built into ArozOS</div>' +
            '<div class="cols">' +
                '<div class="col">' +
                    '<h4>Start</h4>' +
                    '<a onclick="newUntitledFile();">New file</a>' +
                    '<a onclick="openFileWithSelector();">Open file&hellip;</a>' +
                    '<a onclick="openFolderWithSelector();">Open folder&hellip;</a>' +
                '</div>' +
                recentColumn +
                '<div class="col">' +
                    '<h4>Tools</h4>' +
                    '<a onclick="togglePanel(true); showPanelView(\'terminal\');">Open a terminal</a>' +
                    '<a onclick="showSideView(\'scm\');">Source control</a>' +
                    '<a onclick="showSideView(\'tools\');">Browse tools</a>' +
                '</div>' +
                '<div class="col">' +
                    '<h4>Shortcuts</h4>' +
                    '<div class="keyhint"><kbd>Ctrl</kbd> + <kbd>B</kbd> &nbsp;Side bar</div>' +
                    '<div class="keyhint"><kbd>Ctrl</kbd> + <kbd>`</kbd> &nbsp;Terminal</div>' +
                    '<div class="keyhint"><kbd>Ctrl</kbd> + <kbd>S</kbd> &nbsp;Save</div>' +
                    '<div class="keyhint"><kbd>Ctrl</kbd> + <kbd>R</kbd> &nbsp;Run active file</div>' +
                '</div>' +
            '</div>' +
        '</div>';
    $(".editorcover").html(html);
}
