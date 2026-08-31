/*
    app.js - shell for the Compare tool

    Owns the toolbar, the path bar, the log pane, the status bar and the
    routing between the home screen and the four comparison views.
*/

var CmpApp = (function () {

    var RECENT_KEY = "codestudio_compare_recent_v1";
    var MAX_RECENT = 12;

    var app = {
        view: "home",              // home | folder | text | hex | picture
        sessionType: "folder",     // folder | sync | text | hex | picture
        settings: null,
        left: "",
        right: ""
    };

    /* -------------------------- open comparisons ------------------------ */

    /*
        One tab per open comparison. The folder session is the first tab and
        stays put; every file pair opened from its grid becomes a tab beside
        it, so moving between the folder view and a file is a single click.

        A tab that is switched away from keeps its whole session object, so
        coming back is instant and any unsaved edit is still there.
    */
    var tabs = [];
    var activeTabId = null;
    var nextTabId = 1;

    function tabById(id) {
        for (var i = 0; i < tabs.length; i++) {
            if (tabs[i].id === id) {
                return tabs[i];
            }
        }
        return null;
    }

    function activeTab() {
        return tabById(activeTabId);
    }

    function findFileTab(kind, left, right) {
        for (var i = 0; i < tabs.length; i++) {
            if (tabs[i].kind === kind && tabs[i].left === left && tabs[i].right === right) {
                return tabs[i];
            }
        }
        return null;
    }

    function tabIsDirty(tab) {
        if (tab.kind !== "text") {
            return false;
        }
        if (tab.id === activeTabId) {
            return CmpText.isDirty();
        }
        return CmpText.sessionIsDirty(tab.session);
    }

    function anyTabDirty() {
        for (var i = 0; i < tabs.length; i++) {
            if (tabIsDirty(tabs[i])) {
                return true;
            }
        }
        return false;
    }

    //Park the live session of whichever tab is leaving the screen
    function stashActiveTab() {
        var tab = activeTab();
        if (!tab) {
            return;
        }
        if (tab.kind === "text") {
            tab.session = CmpText.captureSession();
        } else if (tab.kind === "hex") {
            tab.session = CmpHex.captureSession();
        } else if (tab.kind === "picture") {
            tab.session = CmpPicture.captureSession();
        }
        //The folder session is never displaced, only one exists at a time
    }

    function iconForTab(tab) {
        if (tab.kind === "folder") {
            return tab.sessionType === "sync" ? "sync" : "folder open";
        }
        if (tab.kind === "hex") {
            return "hdd outline";
        }
        if (tab.kind === "picture") {
            return "image outline";
        }
        return "file alternate outline";
    }

    function renderTabs() {
        var bar = document.getElementById("tabbar");
        if (!bar) {
            return;
        }

        bar.classList.toggle("on", tabs.length > 0);

        var html = "";
        for (var i = 0; i < tabs.length; i++) {
            var tab = tabs[i];
            var active = (tab.id === activeTabId && app.view !== "home");
            html += '<div class="cmptab' + (active ? " active" : "") + '" data-tab="' + tab.id + '" ' +
                'title="' + CmpUtil.escapeHtml(tab.left + "  <->  " + tab.right) + '">' +
                '<i class="' + iconForTab(tab) + ' icon"></i>' +
                '<span class="tablabel">' + CmpUtil.escapeHtml(tab.title) + '</span>' +
                (tabIsDirty(tab) ? '<span class="tabdirty" title="unsaved changes"></span>' : "") +
                (tab.closeable ? '<span class="tabclose" data-close="' + tab.id + '">&times;</span>' : "") +
                '</div>';
        }
        bar.innerHTML = html;
    }

    function activateTab(id) {
        var tab = tabById(id);
        if (!tab) {
            return;
        }
        if (tab.id === activeTabId && app.view !== "home") {
            return;
        }

        stashActiveTab();
        activeTabId = tab.id;
        app.left = tab.left;
        app.right = tab.right;
        setPathBar(tab.left, tab.right);

        if (tab.kind === "folder") {
            app.sessionType = tab.sessionType;
            showView("folder");
            CmpFolder.render();
        } else if (tab.kind === "text") {
            app.sessionType = "text";
            showView("text");
            if (tab.session) {
                CmpText.restoreSession(tab.session);
            } else {
                CmpText.open(tab.left, tab.right, app.settings);
            }
        } else if (tab.kind === "hex") {
            app.sessionType = "hex";
            showView("hex");
            if (tab.session) {
                CmpHex.restoreSession(tab.session);
            } else {
                CmpHex.open(tab.left, tab.right);
            }
        } else if (tab.kind === "picture") {
            app.sessionType = "picture";
            showView("picture");
            if (tab.session) {
                CmpPicture.restoreSession(tab.session);
            } else {
                CmpPicture.open(tab.left, tab.right);
            }
        }

        renderTabs();
    }

    function closeTab(id) {
        var tab = tabById(id);
        if (!tab || !tab.closeable) {
            return;
        }

        if (tabIsDirty(tab) &&
            !window.confirm(tab.title + " has unsaved changes. Close it anyway?")) {
            return;
        }

        var index = tabs.indexOf(tab);
        tabs.splice(index, 1);

        if (activeTabId === id) {
            //Fall back to the tab on the left, which is the folder session for
            //the first file tab closed
            activeTabId = null;
            var next = tabs[Math.max(0, index - 1)];
            if (next) {
                activateTab(next.id);
                return;
            }
            showView("home");
        }
        renderTabs();
    }

    function resetTabs() {
        tabs = [];
        activeTabId = null;
        renderTabs();
    }

    function addTab(spec) {
        spec.id = nextTabId++;
        tabs.push(spec);
        return spec;
    }

    /* ------------------------------ logging ----------------------------- */

    function log(message, level) {
        var lines = document.getElementById("logLines");
        if (!lines) {
            return;
        }
        var entry = document.createElement("div");
        entry.className = "logline" + (level ? " " + level : "");
        entry.textContent = CmpUtil.formatClock() + "  " + message;
        lines.appendChild(entry);
        lines.scrollTop = lines.scrollHeight;
    }

    function busy(on, message, percent) {
        var overlay = document.getElementById("busyOverlay");
        if (!overlay) {
            return;
        }
        overlay.classList.toggle("on", !!on);
        if (on) {
            document.getElementById("busyText").textContent = message || "Working";
            document.getElementById("busyFill").style.width = (percent || 0) + "%";
        }
    }

    /* --------------------------- status bar ----------------------------- */

    function setStatusCells(cells) {
        var bar = document.getElementById("statusbar");
        if (!bar) {
            return;
        }
        var html = "";
        for (var i = 0; i < cells.length; i++) {
            html += '<div class="sbcell' + (cells[i].grow ? " grow" : "") + '">' +
                cells[i].html + '</div>';
        }
        bar.innerHTML = html;
    }

    function legendHTML() {
        return '<span class="legend"><span class="marker m-diff"></span>different</span>' +
            '<span class="legend"><span class="marker m-newer"></span>newer</span>' +
            '<span class="legend"><span class="marker m-orphan"></span>orphan</span>' +
            '<span class="legend"><span class="marker m-minor"></span>minor</span>';
    }

    function folderStatus(info) {
        setStatusCells([
            { html: info.leftFiles + " file(s), " + CmpUtil.formatSizeShort(info.leftBytes) },
            { html: info.rightFiles + " file(s), " + CmpUtil.formatSizeShort(info.rightBytes) },
            { html: info.differences + " difference(s), " + info.orphans + " orphan(s), " + info.same + " same" },
            { html: info.selected + " selected" },
            { html: legendHTML(), grow: true }
        ]);
    }

    function textStatus(info) {
        var dirty = [];
        if (info.leftDirty) { dirty.push("left modified"); }
        if (info.rightDirty) { dirty.push("right modified"); }
        setStatusCells([
            { html: info.important + " important difference(s)" },
            { html: info.minor + " minor" },
            { html: info.sections + " section(s)" +
                (info.currentSection ? ", at " + info.currentSection : "") },
            { html: info.leftLines + " / " + info.rightLines + " lines" },
            { html: dirty.length ? '<b>' + dirty.join(", ") + '</b>' : "no unsaved changes", grow: true }
        ]);
    }

    function hexStatus(info) {
        setStatusCells([
            { html: CmpUtil.formatSizeShort(info.leftSize) + " / " + CmpUtil.formatSizeShort(info.rightSize) },
            { html: info.diffBytes + " differing byte(s)" },
            { html: info.diffRows + " differing row(s)" },
            { html: info.shown + " row(s) shown", grow: true }
        ]);
    }

    function pictureStatus(info) {
        var pixels = info.changedPixels === null ? "pixel comparison unavailable" :
            info.changedPixels + " of " + info.totalPixels + " pixel(s) differ";
        setStatusCells([
            { html: "Left " + (info.leftSize || "-") },
            { html: "Right " + (info.rightSize || "-") },
            { html: info.sameDimensions === false ? "<b>dimensions differ</b>" : "same dimensions" },
            { html: pixels, grow: true }
        ]);
    }

    /* ------------------------------ toolbar ----------------------------- */

    function button(id, icon, label, options) {
        var opts = options || {};
        return '<div class="tbtn' + (opts.active ? " active" : "") +
            (opts.disabled ? " disabled" : "") + (opts.danger ? " danger" : "") +
            '" data-action="' + id + '"' +
            (opts.title ? ' title="' + CmpUtil.escapeHtml(opts.title) + '"' : "") + '>' +
            '<i class="' + icon + ' icon"></i><span>' + CmpUtil.escapeHtml(label) + '</span></div>';
    }

    function separator() {
        return '<div class="tbsep"></div>';
    }

    function renderToolbar() {
        var bar = document.getElementById("toolbar");
        if (!bar) {
            return;
        }
        var html = "";

        html += button("home", "home", "Home", { title: "Back to the session picker" });
        html += button("sessions", "list", "Sessions", { title: "Recently compared pairs" });
        html += separator();

        if (app.view === "folder") {
            var filters = CmpFolder.getFilters();
            html += button("show-all", "th list", "All", { active: filters.show === "all" });
            html += button("show-diffs", "exchange", "Diffs", { active: filters.show === "diffs" });
            html += button("show-same", "clone outline", "Same", { active: filters.show === "same" });
            html += separator();
            html += button("toggle-structure", "sitemap", "Structure",
                { active: filters.structure, title: "Show folders that contain no differences" });
            html += button("toggle-minor", "adjust", "Minor",
                { active: filters.minor, title: "Show differences the comparison rules call unimportant" });
            html += button("toggle-files", "file outline", "Files",
                { active: filters.files, title: "Show files as well as folders" });
            html += separator();
            html += button("rules", "cogs", "Rules", { title: "Session settings and comparison rules" });
            html += separator();
            html += button("copy-right", "arrow right", "Copy >", { title: "Copy the selection to the right side" });
            html += button("copy-left", "arrow left", "Copy <", { title: "Copy the selection to the left side" });
            html += button("delete-left", "trash", "Del L", { danger: true, title: "Delete the selection from the left side" });
            html += button("delete-right", "trash", "Del R", { danger: true, title: "Delete the selection from the right side" });
            html += separator();

            if (app.sessionType === "sync") {
                html += button("sync-right", "sync", "Sync >", { title: "Mirror the left side onto the right side" });
                html += button("sync-left", "sync", "Sync <", { title: "Mirror the right side onto the left side" });
                html += button("sync-both", "sync", "Sync <>", { title: "Update both sides, newest file wins" });
                html += separator();
            }

            html += button("expand", "expand", "Expand");
            html += button("collapse", "compress", "Collapse");
            html += button("select", "check square", "Select");
            html += separator();
            html += button("refresh", "refresh", "Refresh");
            html += button("swap", "exchange", "Swap");
            html += button("stop", "stop", "Stop", { disabled: !CmpFolder.getState().running });

        } else if (app.view === "text") {
            var textFilters = CmpText.getFilters();
            html += button("text-all", "th list", "All", { active: textFilters.show === "all" });
            html += button("text-diffs", "exchange", "Diffs", { active: textFilters.show === "diffs" });
            html += button("text-context", "align left", "Context", { active: textFilters.show === "context" });
            html += separator();
            html += button("toggle-minor", "adjust", "Minor", { active: textFilters.minor });
            html += button("rules", "cogs", "Rules");
            html += separator();
            html += button("section-right", "arrow right", "Sect >", { title: "Copy the current section to the right" });
            html += button("section-left", "arrow left", "Sect <", { title: "Copy the current section to the left" });
            html += button("all-right", "angle double right", "All >", { title: "Replace the right side with the left" });
            html += button("all-left", "angle double left", "All <", { title: "Replace the left side with the right" });
            html += separator();
            html += button("prev-section", "chevron up", "Prev");
            html += button("next-section", "chevron down", "Next");
            html += separator();
            html += button("centre-split", "columns", "Centre",
                { title: "Put the divider back in the middle" });
            html += separator();
            html += button("swap", "exchange", "Swap");
            html += button("reload", "undo", "Reload");
            html += button("save", "save", "Save", { title: "Write both sides back to disk" });

        } else if (app.view === "hex") {
            var hexFilters = CmpHex.getFilters();
            html += button("hex-all", "th list", "All", { active: hexFilters.show === "all" });
            html += button("hex-diffs", "exchange", "Diffs", { active: hexFilters.show === "diffs" });
            html += button("hex-same", "clone outline", "Same", { active: hexFilters.show === "same" });
            html += separator();
            html += button("next-section", "chevron down", "Next");
            html += separator();
            html += button("swap", "exchange", "Swap");
            html += button("refresh", "refresh", "Refresh");

        } else if (app.view === "picture") {
            var mode = CmpPicture.getState().mode;
            html += button("pic-side", "columns", "Side by side", { active: mode === "side" });
            html += button("pic-diff", "eye", "Difference", { active: mode === "difference" });
            html += button("pic-onion", "adjust", "Blend", { active: mode === "onion" });
            html += separator();
            html += '<div class="tbtn" style="min-width:130px;">' +
                '<input type="range" id="picBlend" min="0" max="100" value="' +
                CmpPicture.getState().blend + '" style="width:118px;">' +
                '<span>blend</span></div>';
            html += separator();
            html += button("swap", "exchange", "Swap");
            html += button("refresh", "refresh", "Refresh");

        } else {
            html += button("rules", "cogs", "Rules", { title: "Session settings and comparison rules" });
        }

        html += '<div class="tbspacer"></div>';
        html += button("toggle-log", "info circle", "Log", { title: "Show or hide the activity log" });

        bar.innerHTML = html;

        var blendSlider = document.getElementById("picBlend");
        if (blendSlider) {
            blendSlider.addEventListener("input", function () {
                CmpPicture.setBlend(parseInt(this.value, 10));
            });
        }
    }

    /* ------------------------------ routing ----------------------------- */

    function showView(name) {
        app.view = name;
        var views = document.querySelectorAll("#viewhost .view");
        for (var i = 0; i < views.length; i++) {
            views[i].classList.toggle("visible", views[i].id === name + "View");
        }

        var showPathBar = (name !== "home");
        document.getElementById("pathbar").style.display = showPathBar ? "flex" : "none";
        document.getElementById("filterbar").style.display = (name === "folder") ? "flex" : "none";
        document.getElementById("folderHead").style.display = (name === "folder") ? "flex" : "none";

        renderToolbar();
        renderTabs();
        updateWindowTitle();
    }

    function updateWindowTitle() {
        var titles = {
            home: "Compare",
            folder: (app.sessionType === "sync" ? "Folder Sync" : "Folder Compare"),
            text: "Text Compare",
            hex: "Hex Compare",
            picture: "Picture Compare"
        };
        var title = titles[app.view] || "Compare";
        if (app.view !== "home" && app.left && app.right) {
            title += " - " + CmpUtil.baseName(app.left) + " <-> " + CmpUtil.baseName(app.right);
        }
        document.title = title;
        if (typeof ao_module_setWindowTitle === "function") {
            ao_module_setWindowTitle(title);
        }
    }

    function setPathBar(left, right) {
        document.getElementById("leftPath").value = left || "";
        document.getElementById("rightPath").value = right || "";
    }

    /* --------------------------- session start -------------------------- */

    function rememberSession(type, left, right) {
        var recent = [];
        try {
            recent = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
        } catch (e) {
            recent = [];
        }
        recent = recent.filter(function (entry) {
            return !(entry.left === left && entry.right === right && entry.type === type);
        });
        recent.unshift({ type: type, left: left, right: right, at: Date.now() });
        recent = recent.slice(0, MAX_RECENT);
        try {
            localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
        } catch (e) {
            //Recent list is a convenience, ignore storage failures
        }
        renderRecent();
    }

    function loadRecent() {
        try {
            return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
        } catch (e) {
            return [];
        }
    }

    function renderRecent() {
        var host = document.getElementById("recentList");
        if (!host) {
            return;
        }
        var recent = loadRecent();
        if (recent.length === 0) {
            host.innerHTML = "";
            return;
        }
        var html = '<div style="margin-bottom:4px;font-weight:600;">Recent comparisons</div>';
        for (var i = 0; i < recent.length; i++) {
            var entry = recent[i];
            html += '<div class="recentitem" data-recent="' + i + '">' +
                '<i class="' + iconForType(entry.type) + ' icon"></i>' +
                '<span class="rpath">' + CmpUtil.escapeHtml(entry.left) + '  &lt;-&gt;  ' +
                CmpUtil.escapeHtml(entry.right) + '</span></div>';
        }
        host.innerHTML = html;
    }

    function iconForType(type) {
        if (type === "text") { return "file alternate outline"; }
        if (type === "hex") { return "hdd outline"; }
        if (type === "picture") { return "image outline"; }
        if (type === "sync") { return "sync"; }
        return "folder open";
    }

    function startSession(type, left, right) {
        if (anyTabDirty() &&
            !window.confirm("There are unsaved changes in this session. Start a new one anyway?")) {
            return Promise.resolve();
        }

        app.sessionType = type;
        app.left = CmpUtil.trimSlash(left);
        app.right = CmpUtil.trimSlash(right);
        setPathBar(app.left, app.right);
        rememberSession(type, app.left, app.right);

        //A new session replaces whatever was open
        resetTabs();

        if (type === "folder" || type === "sync") {
            activeTabId = addTab({
                kind: "folder",
                sessionType: type,
                title: CmpUtil.baseName(app.left) + " <-> " + CmpUtil.baseName(app.right),
                left: app.left,
                right: app.right,
                closeable: false,
                session: null
            }).id;
            showView("folder");
            renderTabs();
            return CmpFolder.run(app.left, app.right, app.settings).then(function () {
                renderTabs();
            }).catch(function () {
                //The failure is already in the log
            });
        }

        activeTabId = addTab({
            kind: type,
            title: CmpUtil.baseName(app.left) || CmpUtil.baseName(app.right),
            left: app.left,
            right: app.right,
            closeable: false,
            session: null
        }).id;
        showView(type);
        renderTabs();

        if (type === "text") {
            return CmpText.open(app.left, app.right, app.settings);
        }
        if (type === "hex") {
            return CmpHex.open(app.left, app.right);
        }
        if (type === "picture") {
            return CmpPicture.open(app.left, app.right);
        }
        return Promise.resolve();
    }

    //Decide which viewer suits a pair of files opened from the folder grid
    function sessionTypeForFile(name) {
        if (CmpUtil.isImageFile(name)) {
            return "picture";
        }
        if (CmpUtil.isTextFile(name)) {
            return "text";
        }
        return "hex";
    }

    function openPair(node) {
        openPairAs(node, sessionTypeForFile(node.name));
    }

    //Open a file pair in its own tab, or bring an already open one forward
    function openPairAs(node, type) {
        var paths = CmpFolder.pathsOf(node);
        if (!paths.left && !paths.right) {
            return;
        }

        var left = paths.left || "";
        var right = paths.right || "";
        var existing = findFileTab(type, left, right);
        if (existing) {
            activateTab(existing.id);
            return;
        }

        var tab = addTab({
            kind: type,
            title: node.name,
            left: left,
            right: right,
            closeable: true,
            session: null
        });

        stashActiveTab();
        activeTabId = tab.id;
        app.sessionType = type;
        app.left = left;
        app.right = right;
        setPathBar(left, right);
        showView(type);
        renderTabs();

        if (type === "text") {
            CmpText.open(left, right, app.settings).then(renderTabs);
        } else if (type === "picture") {
            CmpPicture.open(left, right);
        } else {
            CmpHex.open(left, right);
        }
    }

    //The tab strip is what moves between open comparisons now, so Home simply
    //shows the session picker. The open tabs stay put and are one click away.
    function goHome() {
        stashActiveTab();
        showView("home");
        renderRecent();
        renderTabs();
    }

    /* ------------------------------ actions ----------------------------- */

    var actions = {
        "home": goHome,
        "sessions": function (element) {
            showSessionsMenu(element);
        },
        "rules": function () {
            CmpSettings.open(app.settings, { left: app.left, right: app.right }, "comparison",
                function (settings, paths) {
                    app.settings = settings;
                    CmpText.setSettings(settings);
                    var pathsChanged = (paths.left !== app.left || paths.right !== app.right);
                    app.left = CmpUtil.trimSlash(paths.left);
                    app.right = CmpUtil.trimSlash(paths.right);
                    setPathBar(app.left, app.right);
                    log("Session settings updated");

                    if (app.view === "folder") {
                        if (pathsChanged) {
                            startSession(app.sessionType, app.left, app.right);
                        } else {
                            CmpFolder.run(app.left, app.right, app.settings);
                        }
                    } else if (app.view === "text") {
                        CmpText.recompare(false);
                    }
                });
        },
        "toggle-log": function () {
            document.getElementById("logpane").classList.toggle("collapsed");
        },

        "show-all": function () { CmpFolder.setFilter("show", "all"); renderToolbar(); },
        "show-diffs": function () { CmpFolder.setFilter("show", "diffs"); renderToolbar(); },
        "show-same": function () { CmpFolder.setFilter("show", "same"); renderToolbar(); },
        "toggle-structure": function () {
            CmpFolder.setFilter("structure", !CmpFolder.getFilters().structure);
            renderToolbar();
        },
        "toggle-files": function () {
            CmpFolder.setFilter("files", !CmpFolder.getFilters().files);
            renderToolbar();
        },
        "toggle-minor": function () {
            if (app.view === "text") {
                CmpText.setFilter("minor", !CmpText.getFilters().minor);
            } else {
                CmpFolder.setFilter("minor", !CmpFolder.getFilters().minor);
            }
            renderToolbar();
        },

        "copy-right": function () { CmpFolder.copySelection("toRight"); },
        "copy-left": function () { CmpFolder.copySelection("toLeft"); },
        "delete-left": function () { CmpFolder.deleteSelection("left"); },
        "delete-right": function () { CmpFolder.deleteSelection("right"); },
        "sync-right": function () { CmpFolder.runSync("toRight"); },
        "sync-left": function () { CmpFolder.runSync("toLeft"); },
        "sync-both": function () { CmpFolder.runSync("both"); },

        "expand": function () { CmpFolder.expandAll(); },
        "collapse": function () { CmpFolder.collapseAll(); },
        "select": function (element) { showSelectMenu(element); },
        "refresh": function () {
            if (app.view === "folder") {
                CmpFolder.refresh();
            } else if (app.view === "text") {
                CmpText.reload();
            } else if (app.view === "hex") {
                CmpHex.open(app.left, app.right);
            } else if (app.view === "picture") {
                CmpPicture.open(app.left, app.right);
            }
        },
        "swap": function () {
            var oldLeft = app.left;
            app.left = app.right;
            app.right = oldLeft;
            setPathBar(app.left, app.right);
            if (app.view === "folder") {
                CmpFolder.swap();
            } else if (app.view === "text") {
                CmpText.swap();
            } else if (app.view === "hex") {
                CmpHex.swap();
            } else if (app.view === "picture") {
                CmpPicture.swap();
            }
        },
        "stop": function () {
            CmpFolder.abort();
            log("Stop requested", "err");
        },

        "text-all": function () { CmpText.setFilter("show", "all"); renderToolbar(); },
        "text-diffs": function () { CmpText.setFilter("show", "diffs"); renderToolbar(); },
        "text-context": function () { CmpText.setFilter("show", "context"); renderToolbar(); },
        "section-right": function () { CmpText.copySection("toRight"); },
        "section-left": function () { CmpText.copySection("toLeft"); },
        "all-right": function () { CmpText.copyAllSections("toRight"); },
        "all-left": function () { CmpText.copyAllSections("toLeft"); },
        "prev-section": function () { CmpText.previousSection(); },
        "next-section": function () {
            if (app.view === "hex") {
                CmpHex.nextDifference();
            } else {
                CmpText.nextSection();
            }
        },
        "centre-split": function () { CmpText.centreSplit(); },
        "reload": function () { CmpText.reload(); },
        "save": function () { CmpText.saveAll(); },

        "hex-all": function () { CmpHex.setFilter("show", "all"); renderToolbar(); },
        "hex-diffs": function () { CmpHex.setFilter("show", "diffs"); renderToolbar(); },
        "hex-same": function () { CmpHex.setFilter("show", "same"); renderToolbar(); },

        "pic-side": function () { CmpPicture.setMode("side"); renderToolbar(); },
        "pic-diff": function () { CmpPicture.setMode("difference"); renderToolbar(); },
        "pic-onion": function () { CmpPicture.setMode("onion"); renderToolbar(); }
    };

    /* ---------------------------- popup menus --------------------------- */

    //`where` is either an element to hang the menu under, or a {x, y} point
    function showMenu(where, items) {
        var menu = document.getElementById("popMenu");
        var html = "";

        for (var i = 0; i < items.length; i++) {
            if (items[i].divider) {
                html += '<div class="pdiv"></div>';
            } else if (items[i].header) {
                html += '<div class="phead">' + CmpUtil.escapeHtml(items[i].header) + '</div>';
            } else {
                html += '<div class="pitem' + (items[i].disabled ? " disabled" : "") +
                    '" data-menu="' + i + '">' +
                    (items[i].icon ? '<i class="' + items[i].icon + ' icon"></i>' : "") +
                    CmpUtil.escapeHtml(items[i].label) + '</div>';
            }
        }

        menu.innerHTML = html;
        menu.classList.add("on");

        var x;
        var y;
        if (where && where.nodeType === 1) {
            var rect = where.getBoundingClientRect();
            x = rect.left;
            y = rect.bottom;
        } else {
            x = where.x;
            y = where.y;
        }

        //Keep the menu inside the window even when opened near an edge
        menu.style.left = Math.max(4, Math.min(x, window.innerWidth - menu.offsetWidth - 8)) + "px";
        menu.style.top = Math.max(4, Math.min(y, window.innerHeight - menu.offsetHeight - 8)) + "px";

        menu.onclick = function (event) {
            var target = event.target.closest(".pitem");
            if (!target || target.classList.contains("disabled")) {
                return;
            }
            var index = parseInt(target.getAttribute("data-menu"), 10);
            menu.classList.remove("on");
            if (items[index] && items[index].run) {
                items[index].run();
            }
        };
    }

    function hideMenu() {
        var menu = document.getElementById("popMenu");
        if (menu) {
            menu.classList.remove("on");
        }
    }

    function showSessionsMenu(anchor) {
        var recent = loadRecent();
        var items = [];
        if (recent.length === 0) {
            items.push({ label: "No recent comparisons", icon: "info circle", run: null });
        }
        for (var i = 0; i < recent.length && i < MAX_RECENT; i++) {
            (function (entry) {
                items.push({
                    icon: iconForType(entry.type),
                    label: CmpUtil.baseName(entry.left) + "  <->  " + CmpUtil.baseName(entry.right),
                    run: function () {
                        startSession(entry.type, entry.left, entry.right);
                    }
                });
            })(recent[i]);
        }
        items.push({ divider: true });
        items.push({
            icon: "trash", label: "Clear the list", run: function () {
                try {
                    localStorage.removeItem(RECENT_KEY);
                } catch (e) {
                    //ignore
                }
                renderRecent();
            }
        });
        showMenu(anchor, items);
    }

    /*
        Right click menu for a folder compare row.

        Commands act on the whole selection when the clicked row is part of a
        multiple selection, and on just that row otherwise, which is what every
        file manager does and what makes bulk tree syncing practical.
    */
    function showRowContextMenu(node, point) {
        var selection = CmpFolder.getState().selection;
        var targets = (selection[node.key] && Object.keys(selection).length > 1) ?
            CmpFolder.selectedNodes() : [node];
        var many = targets.length > 1;
        var subject = many ? targets.length + " selected items" : '"' + node.name + '"';

        //The branch a scoped rescan should cover after the operation
        var branchKey = node.isDir ? node.key : node.parentKey;
        var scopedRefresh = (!many && branchKey) ? branchKey : null;

        var anyLeft = targets.some(function (n) { return !!n.left; });
        var anyRight = targets.some(function (n) { return !!n.right; });
        var leftLocked = app.settings.specs.leftReadOnly;
        var rightLocked = app.settings.specs.rightReadOnly;

        var items = [];
        items.push({ header: many ? targets.length + " items selected" : node.rel });

        if (!node.isDir) {
            items.push({
                icon: "columns", label: "Compare Contents", disabled: many,
                run: function () { openPair(node); }
            });
            items.push({
                icon: "file alternate outline", label: "Compare as Text", disabled: many,
                run: function () { openPairAs(node, "text"); }
            });
            items.push({
                icon: "hdd outline", label: "Compare as Hex", disabled: many,
                run: function () { openPairAs(node, "hex"); }
            });
            if (CmpUtil.isImageFile(node.name)) {
                items.push({
                    icon: "image outline", label: "Compare as Picture", disabled: many,
                    run: function () { openPairAs(node, "picture"); }
                });
            }
        } else {
            items.push({
                icon: "expand", label: "Expand Everything Below",
                run: function () { CmpFolder.expandSubtree(node.key, true); }
            });
            items.push({
                icon: "compress", label: "Collapse Everything Below",
                run: function () { CmpFolder.expandSubtree(node.key, false); }
            });
            items.push({
                icon: "check square", label: "Select Differing Files Below",
                run: function () { CmpFolder.selectDifferencesBelow(node.key); }
            });
        }

        items.push({ divider: true });

        items.push({
            icon: "arrow right", label: "Copy " + subject + " to the Right",
            disabled: !anyLeft || rightLocked,
            run: function () { CmpFolder.copyNodes(targets, "toRight", scopedRefresh); }
        });
        items.push({
            icon: "arrow left", label: "Copy " + subject + " to the Left",
            disabled: !anyRight || leftLocked,
            run: function () { CmpFolder.copyNodes(targets, "toLeft", scopedRefresh); }
        });
        items.push({
            icon: "clock outline", label: "Copy the Newer Side Over the Older",
            disabled: (leftLocked && rightLocked),
            run: function () { CmpFolder.copyNewerOf(targets); }
        });

        if (node.isDir && !many) {
            items.push({ divider: true });
            items.push({
                icon: "sync", label: "Sync This Folder to the Right",
                disabled: rightLocked,
                run: function () { CmpFolder.runSync("toRight", node.key); }
            });
            items.push({
                icon: "sync", label: "Sync This Folder to the Left",
                disabled: leftLocked,
                run: function () { CmpFolder.runSync("toLeft", node.key); }
            });
            items.push({
                icon: "sync", label: "Sync This Folder Both Ways",
                disabled: leftLocked && rightLocked,
                run: function () { CmpFolder.runSync("both", node.key); }
            });
        }

        items.push({ divider: true });
        items.push({
            icon: "trash", label: "Delete " + subject + " from the Left",
            disabled: !anyLeft || leftLocked,
            run: function () { CmpFolder.deleteNodes(targets, "left", scopedRefresh); }
        });
        items.push({
            icon: "trash", label: "Delete " + subject + " from the Right",
            disabled: !anyRight || rightLocked,
            run: function () { CmpFolder.deleteNodes(targets, "right", scopedRefresh); }
        });

        items.push({ divider: true });
        items.push({
            icon: "refresh", label: "Rescan This " + (node.isDir ? "Folder" : "Folder Pair"),
            run: function () { CmpFolder.refreshSubtree(node.key); }
        });
        items.push({
            icon: "filter", label: 'Exclude "' + node.name + '" from This Session',
            run: function () { excludeFromSession(node); }
        });

        items.push({ divider: true });
        var paths = CmpFolder.pathsOf(node);
        items.push({
            icon: "folder open", label: "Reveal the Left Side in File Manager",
            disabled: !paths.left,
            run: function () { revealPath(paths.left, node.isDir); }
        });
        items.push({
            icon: "folder open", label: "Reveal the Right Side in File Manager",
            disabled: !paths.right,
            run: function () { revealPath(paths.right, node.isDir); }
        });
        items.push({
            icon: "copy", label: "Copy the Left Path", disabled: !paths.left,
            run: function () { copyTextToClipboard(paths.left); }
        });
        items.push({
            icon: "copy", label: "Copy the Right Path", disabled: !paths.right,
            run: function () { copyTextToClipboard(paths.right); }
        });

        showMenu(point, items);
    }

    //Add the clicked name to the session's exclude list and rescan
    function excludeFromSession(node) {
        var field = node.isDir ? "excludeFolders" : "excludeFiles";
        var current = app.settings.nameFilters[field];
        var addition = node.name;

        if (current && current.split(";").indexOf(addition) >= 0) {
            log('"' + addition + '" is already excluded');
            return;
        }

        app.settings.nameFilters[field] = current ? current + ";" + addition : addition;
        log('Excluded "' + addition + '" from this session');
        CmpFolder.run(app.left, app.right, app.settings);
    }

    function revealPath(vpath, isDir) {
        if (typeof ao_module_openPath !== "function") {
            return;
        }
        if (isDir) {
            ao_module_openPath(vpath);
        } else {
            ao_module_openPath(CmpUtil.dirName(vpath), CmpUtil.baseName(vpath));
        }
    }

    function copyTextToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                log("Copied to clipboard: " + text);
            }).catch(function () {
                log("Could not write to the clipboard", "err");
            });
            return;
        }

        //Fallback for contexts where the async clipboard API is unavailable
        var scratch = document.createElement("textarea");
        scratch.value = text;
        scratch.style.position = "fixed";
        scratch.style.opacity = "0";
        document.body.appendChild(scratch);
        scratch.select();
        try {
            document.execCommand("copy");
            log("Copied to clipboard: " + text);
        } catch (e) {
            log("Could not write to the clipboard", "err");
        }
        document.body.removeChild(scratch);
    }

    function showSelectMenu(anchor) {
        showMenu(anchor, [
            { icon: "check square", label: "Select everything shown", run: function () { CmpFolder.selectPreset("all"); } },
            { icon: "exchange", label: "Select files that differ", run: function () { CmpFolder.selectPreset("diffs"); } },
            { icon: "dot circle outline", label: "Select orphans", run: function () { CmpFolder.selectPreset("orphans"); } },
            { divider: true },
            { icon: "arrow left", label: "Select where the left side is newer", run: function () { CmpFolder.selectPreset("leftnewer"); } },
            { icon: "arrow right", label: "Select where the right side is newer", run: function () { CmpFolder.selectPreset("rightnewer"); } },
            { divider: true },
            { icon: "square outline", label: "Select nothing", run: function () { CmpFolder.selectPreset("none"); } }
        ]);
    }

    /* --------------------------- event binding -------------------------- */

    function bindTabBar() {
        var bar = document.getElementById("tabbar");
        if (!bar) {
            return;
        }

        bar.addEventListener("click", function (event) {
            var closer = event.target.closest(".tabclose");
            if (closer) {
                event.stopPropagation();
                closeTab(parseInt(closer.getAttribute("data-close"), 10));
                return;
            }
            var tab = event.target.closest(".cmptab");
            if (tab) {
                activateTab(parseInt(tab.getAttribute("data-tab"), 10));
            }
        });

        //Middle click closes, the way browser tabs do
        bar.addEventListener("auxclick", function (event) {
            if (event.button !== 1) {
                return;
            }
            var tab = event.target.closest(".cmptab");
            if (tab) {
                event.preventDefault();
                closeTab(parseInt(tab.getAttribute("data-tab"), 10));
            }
        });
    }

    function bindToolbar() {
        document.getElementById("toolbar").addEventListener("click", function (event) {
            var target = event.target.closest(".tbtn");
            if (!target || target.classList.contains("disabled")) {
                return;
            }
            var action = target.getAttribute("data-action");
            if (actions[action]) {
                actions[action](target);
            }
        });
    }

    function bindFolderGrid() {
        var body = document.getElementById("folderBody");

        body.addEventListener("click", function (event) {
            var twisty = event.target.closest(".twisty[data-twisty]");
            if (twisty) {
                event.stopPropagation();
                CmpFolder.toggleExpand(twisty.getAttribute("data-twisty"));
                return;
            }
            var row = event.target.closest(".grow");
            if (!row) {
                return;
            }
            CmpFolder.selectKey(row.getAttribute("data-key"), event.ctrlKey || event.metaKey, event.shiftKey);
        });

        body.addEventListener("dblclick", function (event) {
            var row = event.target.closest(".grow");
            if (!row) {
                return;
            }
            var node = CmpFolder.getNode(row.getAttribute("data-key"));
            if (!node) {
                return;
            }
            if (node.isDir) {
                CmpFolder.toggleExpand(node.key);
            } else {
                openPair(node);
            }
        });

        body.addEventListener("contextmenu", function (event) {
            var row = event.target.closest(".grow");
            if (!row) {
                return;
            }
            event.preventDefault();

            var node = CmpFolder.getNode(row.getAttribute("data-key"));
            if (!node) {
                return;
            }

            //Right clicking outside the current selection moves the selection
            //to the clicked row first, the way a file manager behaves
            if (!CmpFolder.getState().selection[node.key]) {
                CmpFolder.selectKey(node.key, false, false);
            }

            showRowContextMenu(node, { x: event.clientX, y: event.clientY });
        });

        //Header click sorts nothing yet, but keeps the columns aligned when the
        //window is resized
        window.addEventListener("resize", function () {
            if (app.view === "folder") {
                CmpFolder.renderWindow();
            }
        });
    }

    function bindTextEditor() {
        //Each side is its own scroller now, so the editing handlers are bound
        //to both row containers
        ["textLeftRows", "textRightRows"].forEach(function (id) {
            bindTextEditorPane(document.getElementById(id));
        });

        document.getElementById("textMap").addEventListener("click", CmpText.mapClick);
    }

    function bindTextEditorPane(container) {
        if (!container) {
            return;
        }

        container.addEventListener("input", function (event) {
            var cell = event.target.closest(".ttext");
            if (cell) {
                CmpText.handleInput(cell);
            }
        });

        container.addEventListener("keydown", function (event) {
            var cell = event.target.closest(".ttext");
            if (!cell) {
                return;
            }

            if (event.key === "Enter") {
                event.preventDefault();
                CmpText.splitLineAtCaret(cell);
                return;
            }
            if (event.key === "Backspace" && CmpText.caretOffsetWithin(cell) === 0) {
                if (CmpText.mergeWithPrevious(cell)) {
                    event.preventDefault();
                }
                return;
            }
            if (event.key === "Delete" && CmpText.caretOffsetWithin(cell) === cell.textContent.length) {
                if (CmpText.mergeWithNext(cell)) {
                    event.preventDefault();
                }
                return;
            }
            if (event.key === "Tab") {
                event.preventDefault();
                CmpText.insertTextAtCaret(cell, "\t");
            }
        });

        container.addEventListener("paste", function (event) {
            var cell = event.target.closest(".ttext");
            if (!cell) {
                return;
            }
            event.preventDefault();
            var text = (event.clipboardData || window.clipboardData).getData("text");
            CmpText.insertTextAtCaret(cell, text);
        });

        container.addEventListener("focusin", function (event) {
            var cell = event.target.closest(".ttext");
            if (!cell) {
                return;
            }
            var state = CmpText.getState();
            state.cursor.side = cell.getAttribute("data-side");
            state.cursor.line = parseInt(cell.getAttribute("data-line"), 10);
            var row = cell.closest(".trow");
            if (row && row.getAttribute("data-hunk") !== null) {
                state.currentHunk = parseInt(row.getAttribute("data-hunk"), 10);
            }
        });
    }

    function bindPathBar() {
        document.getElementById("leftBrowse").addEventListener("click", function () {
            browseFor("left");
        });
        document.getElementById("rightBrowse").addEventListener("click", function () {
            browseFor("right");
        });
        document.getElementById("pathGo").addEventListener("click", function () {
            var left = document.getElementById("leftPath").value.trim();
            var right = document.getElementById("rightPath").value.trim();
            if (!left || !right) {
                log("Both sides need a path", "err");
                return;
            }
            startSession(app.sessionType, left, right);
        });

        ["leftPath", "rightPath"].forEach(function (id) {
            document.getElementById(id).addEventListener("keydown", function (event) {
                if (event.key === "Enter") {
                    document.getElementById("pathGo").click();
                }
            });
        });
    }

    function browseFor(side, targetInputId) {
        var wantFolder = (app.sessionType === "folder" || app.sessionType === "sync");
        var inputId = targetInputId || (side === "left" ? "leftPath" : "rightPath");

        ao_module_openFileSelector(function (files) {
            if (!files || files.length === 0) {
                return;
            }

            var picked = files[0];
            var value = picked.filepath;

            //The selector runs in folder mode here, and its reply carries only
            //filename and filepath - never an isDir flag. Folder mode refuses
            //to select a file in the first place, so the path that comes back
            //is already the folder we want and must not be trimmed to its
            //parent. Only step up when a reply explicitly says it is a file.
            if (wantFolder && picked.isDir === false && value) {
                value = CmpUtil.dirName(value);
            }

            document.getElementById(inputId).value = CmpUtil.trimSlash(value);
        }, "user:/", wantFolder ? "folder" : "file", false, {
            path_memory_key: "compare_" + side
        });
    }

    function bindFilterBar() {
        var input = document.getElementById("nameFilterInput");
        input.addEventListener("input", CmpUtil.debounce(function () {
            CmpFolder.setFilter("nameFilter", input.value.trim());
        }, 250));
    }

    function bindHome() {
        document.getElementById("sessionSidebar").addEventListener("click", function (event) {
            var item = event.target.closest(".sessiontype");
            if (!item) {
                return;
            }
            selectSessionType(item.getAttribute("data-type"));
        });

        document.getElementById("homeTiles").addEventListener("click", function (event) {
            var tile = event.target.closest(".hometile");
            if (!tile) {
                return;
            }
            selectSessionType(tile.getAttribute("data-type"));
        });

        document.getElementById("homeLeftBrowse").addEventListener("click", function () {
            browseFor("left", "homeLeftPath");
        });
        document.getElementById("homeRightBrowse").addEventListener("click", function () {
            browseFor("right", "homeRightPath");
        });
        document.getElementById("homeStart").addEventListener("click", function () {
            var left = document.getElementById("homeLeftPath").value.trim();
            var right = document.getElementById("homeRightPath").value.trim();
            if (!left || !right) {
                log("Pick a path for both sides first", "err");
                return;
            }
            startSession(app.sessionType, left, right);
        });
        document.getElementById("homeSettings").addEventListener("click", function () {
            actions.rules();
        });

        document.getElementById("recentList").addEventListener("click", function (event) {
            var item = event.target.closest(".recentitem");
            if (!item) {
                return;
            }
            var entry = loadRecent()[parseInt(item.getAttribute("data-recent"), 10)];
            if (entry) {
                startSession(entry.type, entry.left, entry.right);
            }
        });
    }

    function selectSessionType(type) {
        app.sessionType = type;
        var items = document.querySelectorAll("#sessionSidebar .sessiontype");
        for (var i = 0; i < items.length; i++) {
            items[i].classList.toggle("selected", items[i].getAttribute("data-type") === type);
        }
        var tiles = document.querySelectorAll("#homeTiles .hometile");
        for (var t = 0; t < tiles.length; t++) {
            tiles[t].classList.toggle("selected", tiles[t].getAttribute("data-type") === type);
        }

        var isFolder = (type === "folder" || type === "sync");
        document.getElementById("homeFormTitle").textContent =
            isFolder ? "Choose two folders to compare" : "Choose two files to compare";
        document.getElementById("homeLeftPath").placeholder = isFolder ? "user:/Desktop/site-old" : "user:/Desktop/a.txt";
        document.getElementById("homeRightPath").placeholder = isFolder ? "user:/Desktop/site-new" : "user:/Desktop/b.txt";
    }

    function bindKeyboard() {
        document.addEventListener("keydown", function (event) {
            var inEditor = event.target && event.target.classList &&
                event.target.classList.contains("ttext");
            var inInput = event.target && (event.target.tagName === "INPUT" ||
                event.target.tagName === "TEXTAREA");

            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                event.preventDefault();
                if (app.view === "text") {
                    CmpText.saveAll();
                }
                return;
            }
            if (event.key === "F5") {
                event.preventDefault();
                actions.refresh();
                return;
            }
            if ((event.ctrlKey || event.metaKey) && event.key >= "1" && event.key <= "9") {
                var wanted = tabs[parseInt(event.key, 10) - 1];
                if (wanted) {
                    event.preventDefault();
                    activateTab(wanted.id);
                }
                return;
            }
            if (event.ctrlKey && event.key === "Tab" && tabs.length > 1) {
                event.preventDefault();
                var at = tabs.indexOf(activeTab());
                var step = event.shiftKey ? -1 : 1;
                var target = tabs[(at + step + tabs.length) % tabs.length];
                activateTab(target.id);
                return;
            }
            if (inInput) {
                return;
            }
            if (event.key === "F6" && app.view === "text") {
                event.preventDefault();
                event.shiftKey ? CmpText.previousSection() : CmpText.nextSection();
                return;
            }
            if (inEditor) {
                return;
            }
            if (event.key === "Escape") {
                hideMenu();
                return;
            }
            if (app.view === "folder") {
                if (event.key === "Delete") {
                    event.preventDefault();
                    CmpFolder.deleteSelection(event.shiftKey ? "right" : "left");
                }
            }
        });

        document.addEventListener("click", function (event) {
            if (!event.target.closest("#popMenu") && !event.target.closest('[data-action="sessions"]') &&
                !event.target.closest('[data-action="select"]')) {
                hideMenu();
            }
        });
    }

    /* ------------------------------- theme ------------------------------ */

    function applyTheme(theme) {
        document.body.classList.toggle("dark", theme === "dark");
    }

    function initTheme() {
        if (typeof ao_module_onThemeChanged === "function") {
            ao_module_onThemeChanged(function (theme) {
                applyTheme(theme);
            });
        }
        try {
            var stored = window.localStorage.getItem("ao/theme");
            if (stored) {
                applyTheme(stored.indexOf("dark") >= 0 ? "dark" : "light");
            }
        } catch (e) {
            //Theme detection is best effort
        }
    }

    /* ------------------------------- launch ----------------------------- */

    function readLaunchRequest() {
        //Code Studio launches the tool with a JSON payload in the hash
        if (window.location.hash.length > 1) {
            try {
                var payload = JSON.parse(decodeURIComponent(window.location.hash.substring(1)));
                if (payload && (payload.left || payload.right)) {
                    return payload;
                }
            } catch (e) {
                //Not a launch payload, fall through to the file selector API
            }
        }

        if (typeof ao_module_loadInputFiles === "function") {
            var files = ao_module_loadInputFiles();
            if (files && files.length >= 2) {
                return { type: "text", left: files[0].filepath, right: files[1].filepath };
            }
            if (files && files.length === 1) {
                return { type: "pick", left: files[0].filepath, right: "" };
            }
        }
        return null;
    }

    function init() {
        app.settings = CmpSettings.loadDefaults();

        CmpFolder.setHooks({
            onLog: log,
            onBusy: busy,
            onStatus: folderStatus,
            onOpenPair: openPair
        });
        CmpText.setHooks({
            onLog: log,
            onBusy: busy,
            onStatus: textStatus,
            onDirtyChange: function () {
                renderToolbar();
                renderTabs();
            }
        });
        CmpHex.setHooks({ onLog: log, onBusy: busy, onStatus: hexStatus });
        CmpPicture.setHooks({ onLog: log, onBusy: busy, onStatus: pictureStatus });

        bindTabBar();
        bindToolbar();
        bindFolderGrid();
        bindTextEditor();
        bindPathBar();
        bindFilterBar();
        bindHome();
        bindKeyboard();
        initTheme();

        selectSessionType("folder");
        renderRecent();
        showView("home");
        log("Compare tool ready");

        var request = readLaunchRequest();
        if (request) {
            if (request.type === "pick" || !request.right) {
                document.getElementById("homeLeftPath").value = request.left || "";
                selectSessionType(request.type === "pick" ? guessTypeForPath(request.left) : "folder");
                log("Pick the second side to start the comparison");
            } else {
                selectSessionType(request.type || "folder");
                startSession(request.type || "folder", request.left, request.right);
            }
        }

        window.addEventListener("beforeunload", function (event) {
            if (anyTabDirty()) {
                event.preventDefault();
                event.returnValue = "";
            }
        });
    }

    function guessTypeForPath(path) {
        if (!path) {
            return "folder";
        }
        if (CmpUtil.extName(path) === "") {
            return "folder";
        }
        return sessionTypeForFile(path);
    }

    return {
        init: init,
        log: log,
        startSession: startSession,
        getApp: function () {
            return app;
        }
    };
})();

document.addEventListener("DOMContentLoaded", function () {
    CmpApp.init();
});
