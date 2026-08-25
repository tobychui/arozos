/*
    app.js

    Boots the builder and wires everything together: the icon rail, the top bar,
    the status bar, keyboard shortcuts, node level commands (insert, duplicate,
    wrap, delete), autosave, and the ArozOS integration (input files, window
    title, desktop theme).

    Module load order matters and is fixed in index.html:
        icons - schema - model - render - ui - canvas - panels - fileio -
        publish - settings - app
*/

var WBApp = (function () {

    var activePanel = "add";
    var dockCollapsed = false;
    var autosave = true;
    var autosaveTimer = null;
    var styleClipboard = null;
    var suppressPanelRefresh = false;

    /* ------------------------------------------------------------ boot -- */

    function init() {
        applyTheme();

        WBModel.newProject("My Website");

        WBCanvas.init({
            onSelect: function (id) { selectNode(id, { fromCanvas: true }); },
            onHover: function (id) { WBLayers.setHover(id); },
            onChange: onCanvasChange,
            onEditStateChange: onEditStateChange,
            onRequestMenu: function (id, pos) { showElementMenu(id, pos); }
        });

        WBInspector.init();
        WBPalette.init();
        WBPages.init();
        WBLayers.init();
        WBDesign.init();
        WBSettings.init();

        bindRail();
        bindTopbar();
        bindStatusbar();
        bindTextToolbar();
        bindShortcuts();
        bindHelp();

        WBModel.on("change", onModelChange);
        WBModel.on("restore", onModelRestore);
        WBModel.on("clean", updateSaveState);

        WBCanvas.setDevice("base");
        WBCanvas.render();
        setTimeout(function () { WBCanvas.zoomToFit(); updateZoomLabel(); }, 120);

        selectNode(null);
        refreshTitles();
        updateSaveState();
        loadInputFile();
    }

    /* Open the file the desktop launched us with, when there is one. */
    function loadInputFile() {
        var inputFiles = null;
        try { inputFiles = ao_module_loadInputFiles(); } catch (e) { inputFiles = null; }
        if (!inputFiles || !inputFiles.length) { return; }
        var f = inputFiles[0];
        WBFileIO.openPath(f.filepath, function (ok) {
            if (!ok) { return; }
            afterProjectLoaded();
        });
    }

    function afterProjectLoaded() {
        WBCanvas.render();
        selectNode(null);
        WBPages.render();
        WBLayers.render();
        WBDesign.render();
        WBSettings.render();
        refreshTitles();
        updateSaveState();
        setTimeout(function () { WBCanvas.zoomToFit(); updateZoomLabel(); }, 100);
    }

    /* ------------------------------------------------------------ rail -- */

    function bindRail() {
        var btns = document.querySelectorAll("#wb-rail .wb-rail-btn");
        for (var i = 0; i < btns.length; i++) {
            (function (btn) {
                btn.addEventListener("click", function () {
                    var panel = btn.getAttribute("data-panel");
                    if (panel === activePanel && !dockCollapsed) {
                        dockCollapsed = true;
                        document.getElementById("wb-leftdock").classList.add("collapsed");
                    } else {
                        dockCollapsed = false;
                        document.getElementById("wb-leftdock").classList.remove("collapsed");
                        showPanel(panel);
                    }
                    setTimeout(function () { WBCanvas.scheduleOverlayUpdate(); }, 30);
                });
            })(btns[i]);
        }
    }

    function showPanel(name) {
        activePanel = name;
        var panels = document.querySelectorAll(".wb-panel");
        for (var i = 0; i < panels.length; i++) {
            panels[i].classList.toggle("active", panels[i].id === "wb-panel-" + name);
        }
        var btns = document.querySelectorAll("#wb-rail .wb-rail-btn");
        for (var j = 0; j < btns.length; j++) {
            btns[j].classList.toggle("active", btns[j].getAttribute("data-panel") === name);
        }
        if (name === "layers") { WBLayers.render(); WBLayers.revealSelected(); }
        if (name === "pages") { WBPages.render(); }
        if (name === "design") { WBDesign.render(); }
        if (name === "settings") { WBSettings.render(); }
    }

    /* ---------------------------------------------------------- topbar -- */

    function bindTopbar() {
        document.getElementById("wb-project-btn").addEventListener("click", function (e) {
            WBUI.menu(e.currentTarget, [
                { header: "Project" },
                { label: "New Site", icon: "new-file", action: newSite },
                { label: "Open...", icon: "open", key: "Ctrl+O", action: openSite },
                { label: "Save", icon: "save", key: "Ctrl+S", action: save },
                { label: "Save As...", icon: "duplicate", action: saveAs },
                { separator: true },
                { label: "Rename Site", icon: "pencil", action: renameSite },
                { label: "Import HTML As Page", icon: "download", action: function () {
                    WBFileIO.importHtmlAsPage();
                } }
            ]);
        });

        var devBtns = document.querySelectorAll("[data-device]");
        for (var i = 0; i < devBtns.length; i++) {
            (function (b) {
                b.addEventListener("click", function () { setDevice(b.getAttribute("data-device")); });
            })(devBtns[i]);
        }

        document.getElementById("wb-undo").addEventListener("click", undo);
        document.getElementById("wb-redo").addEventListener("click", redo);

        document.getElementById("wb-preview-btn").addEventListener("click", function () {
            WBPublish.togglePreview();
        });
        document.getElementById("wb-exit-preview").addEventListener("click", function () {
            WBPublish.togglePreview(false);
        });
        document.getElementById("wb-publish-btn").addEventListener("click", function () {
            WBPublish.publish();
        });

        document.getElementById("wb-more-btn").addEventListener("click", function (e) {
            WBUI.menu(e.currentTarget, [
                { label: "Preview In New Tab", icon: "external", action: WBPublish.openInNewTab },
                { label: "Publish...", icon: "publish", action: WBPublish.publish },
                { label: "Export To Folder...", icon: "download", action: WBPublish.exportToFolder },
                { separator: true },
                { label: "Site Settings", icon: "gear", action: function () { showPanel("settings"); openDock(); } },
                { label: "Personal Site Settings", icon: "globe", action: function () {
                    try { ao_module_openSetting("Network", "Personal Page"); }
                    catch (err) { WBUI.toast("Open ArozOS Settings > Network > Personal Page", "err"); }
                } },
                { separator: true },
                { label: "Zoom To Fit", icon: "resize", key: "Ctrl+0", action: function () {
                    WBCanvas.zoomToFit(); updateZoomLabel();
                } },
                { label: "Keyboard Shortcuts", icon: "help", action: showShortcuts },
                { label: "About Site Builder", icon: "info", action: showAbout }
            ], { alignRight: true });
        });
    }

    function openDock() {
        dockCollapsed = false;
        document.getElementById("wb-leftdock").classList.remove("collapsed");
    }

    function setDevice(key) {
        WBCanvas.setDevice(key);
        var all = document.querySelectorAll("[data-device]");
        for (var i = 0; i < all.length; i++) {
            all[i].classList.toggle("active", all[i].getAttribute("data-device") === key);
        }
        updateZoomLabel();
        WBInspector.render();
    }

    /* ------------------------------------------------------- status bar -- */

    function bindStatusbar() {
        document.getElementById("wb-zoom-out").addEventListener("click", function () {
            WBCanvas.setZoom(WBCanvas.getZoom() - 0.1);
            updateZoomLabel();
        });
        document.getElementById("wb-zoom-in").addEventListener("click", function () {
            WBCanvas.setZoom(WBCanvas.getZoom() + 0.1);
            updateZoomLabel();
        });
        document.getElementById("wb-zoom-label").addEventListener("click", function () {
            WBCanvas.setZoom(1);
            updateZoomLabel();
        });
    }

    function updateZoomLabel() {
        document.getElementById("wb-zoom-label").textContent =
            Math.round(WBCanvas.getZoom() * 100) + "%";
    }

    function renderBreadcrumb() {
        var el = document.getElementById("wb-breadcrumb");
        WBUI.clear(el);
        var id = WBCanvas.getSelection();
        var chain = id ? (WBModel.pathTo(id) || []) : [];
        if (!chain.length) {
            el.appendChild(WBUI.el("span", { class: "wb-crumb", text: WBModel.activePage().name }));
            return;
        }
        chain.forEach(function (n, i) {
            if (i) { el.appendChild(WBUI.el("span", { class: "wb-crumb-sep", html: WBIcon("caret-right", 9) })); }
            el.appendChild(WBUI.el("button", {
                class: "wb-crumb" + (i === chain.length - 1 ? " current" : ""),
                type: "button",
                text: WBModel.displayName(n),
                onclick: function () { selectNode(n.id); }
            }));
        });
    }

    /* ------------------------------------------------- canvas callbacks -- */

    function onCanvasChange(evt) {
        switch (evt.action) {
        case "insert":
            insertElement(evt.type, evt.parentId, evt.index);
            break;
        case "move":
            if (WBModel.moveNode(evt.id, evt.parentId, evt.index)) {
                WBModel.commit("Move element");
                rerenderCanvas();
                selectNode(evt.id);
            }
            break;
        case "delete":
            deleteNode(evt.id);
            break;
        case "text":
        case "resize":
            WBLayers.render();
            WBInspector.render();
            updateSaveState();
            break;
        default:
            break;
        }
    }

    function onEditStateChange(editing) {
        var bar = document.getElementById("wb-text-toolbar");
        bar.classList.toggle("editing", editing);
        updateTextToolbarState();
    }

    function onModelChange() {
        updateSaveState();
        updateHistoryButtons();
        scheduleAutosave();
    }

    function onModelRestore() {
        rerenderCanvas();
        var id = WBCanvas.getSelection();
        if (id && !WBModel.findNode(id)) { id = null; }
        selectNode(id, { silentCanvas: false });
        WBPages.render();
        WBDesign.render();
        refreshTitles();
        updateSaveState();
        updateHistoryButtons();
    }

    /* --------------------------------------------------- node commands -- */

    /*
        Insert a new element. When no explicit parent is given the element goes
        into the current selection if it can hold children, otherwise right
        after the selection, otherwise at the end of the page.
    */
    function insertElement(type, parentId, index) {
        var node = WBModel.createNode(type);

        if (parentId === undefined || parentId === null) {
            var selId = WBCanvas.getSelection();
            var sel = selId ? WBModel.findNode(selId) : null;
            if (sel && (wbIsContainer(sel.type) || sel.type === "body")) {
                parentId = sel.id;
                index = sel.children.length;
            } else if (sel) {
                var parent = WBModel.findParent(sel.id);
                parentId = parent ? parent.id : WBModel.activePage().root.id;
                index = WBModel.indexOfNode(sel.id) + 1;
            } else {
                parentId = WBModel.activePage().root.id;
                index = null;
            }
        }

        if (!WBModel.insertNode(parentId, node, index)) {
            WBUI.toast("That element cannot hold other elements", "err");
            return;
        }
        WBModel.commit("Add " + wbDef(type).name);
        rerenderCanvas();
        selectNode(node.id);
        WBCanvas.scrollToNode(node.id);
        if (wbIsTextEditable(type)) {
            setTimeout(function () { WBCanvas.startTextEdit(node.id); }, 120);
        }
    }

    function deleteNode(id) {
        var node = WBModel.findNode(id);
        if (!node || node.type === "body") { return; }
        var parent = WBModel.findParent(id);
        var idx = WBModel.indexOfNode(id);
        WBCanvas.stopTextEdit();
        WBModel.removeNode(id);
        WBModel.commit("Delete " + WBModel.displayName(node));
        rerenderCanvas();
        var next = null;
        if (parent) {
            next = parent.children[Math.min(idx, parent.children.length - 1)];
        }
        selectNode(next ? next.id : (parent ? parent.id : null));
    }

    function duplicateNode(id) {
        var copy = WBModel.duplicateNode(id);
        if (!copy) { return; }
        WBModel.commit("Duplicate element");
        rerenderCanvas();
        selectNode(copy.id);
    }

    function wrapInContainer(id) {
        var node = WBModel.findNode(id);
        var parent = WBModel.findParent(id);
        if (!node || !parent) { return; }
        var idx = WBModel.indexOfNode(id);
        var box = WBModel.createNode("container");
        box.styles.base = { maxWidth: "none", marginLeft: "0", marginRight: "0", width: "100%" };
        parent.children.splice(idx, 1, box);
        box.children.push(node);
        WBModel.commit("Wrap in container");
        rerenderCanvas();
        selectNode(box.id);
    }

    function unwrapNode(id) {
        var node = WBModel.findNode(id);
        var parent = WBModel.findParent(id);
        if (!node || !parent || node.type === "body") { return; }
        var idx = WBModel.indexOfNode(id);
        var args = [idx, 1].concat(node.children);
        Array.prototype.splice.apply(parent.children, args);
        WBModel.commit("Unwrap element");
        rerenderCanvas();
        selectNode(node.children.length ? node.children[0].id : parent.id);
    }

    function copyStyles(id) {
        var node = WBModel.findNode(id);
        if (!node) { return; }
        styleClipboard = WBModel.clone(node.styles);
        WBUI.toast("Styles copied - select another element and press Ctrl+Shift+V");
    }

    function pasteStyles(id) {
        if (!styleClipboard) { WBUI.toast("No styles copied yet", "err"); return; }
        var node = WBModel.findNode(id);
        if (!node) { return; }
        node.styles = WBModel.clone(styleClipboard);
        WBModel.commit("Paste styles");
        WBCanvas.refreshStyles();
        WBInspector.render();
    }

    function showElementMenu(id, pos) {
        var node = WBModel.findNode(id);
        if (!node) { return; }
        var parent = WBModel.findParent(id);
        WBUI.menu(pos || { x: 200, y: 200 }, [
            { label: "Duplicate", icon: "duplicate", key: "Ctrl+D", action: function () { duplicateNode(id); } },
            { label: "Copy Styles", icon: "copy", action: function () { copyStyles(id); } },
            { label: "Paste Styles", icon: "palette", disabled: !styleClipboard,
              action: function () { pasteStyles(id); } },
            { separator: true },
            { label: "Select Parent", icon: "caret-up", disabled: !parent,
              action: function () { selectNode(parent.id); } },
            { label: "Wrap In Container", icon: "container", action: function () { wrapInContainer(id); } },
            { separator: true },
            { label: "Delete", icon: "trash", danger: true, key: "Del",
              disabled: node.type === "body", action: function () { deleteNode(id); } }
        ]);
    }

    /* ------------------------------------------------------- selection -- */

    function selectNode(id, opts) {
        opts = opts || {};
        if (!opts.fromCanvas) { WBCanvas.select(id, { silent: true }); }
        WBInspector.setTarget(id);
        renderBreadcrumb();
        if (!suppressPanelRefresh) {
            WBLayers.render();
            if (!opts.fromLayers) { WBLayers.revealSelected(); }
        }
    }

    function highlightNode(id) {
        WBLayers.setHover(id);
    }

    /* ---------------------------------------------------------- canvas -- */

    function rerenderCanvas(opts) {
        opts = opts || {};
        if (opts.soft) { WBCanvas.refreshStyles(); }
        else { WBCanvas.render(); }
        WBCanvas.select(WBCanvas.getSelection(), { silent: true, force: true });
        suppressPanelRefresh = true;
        WBLayers.render();
        suppressPanelRefresh = false;
        renderBreadcrumb();
    }

    function refreshInspector() { WBInspector.render(); }

    /* ----------------------------------------------------------- pages -- */

    function switchPage(id) {
        WBCanvas.stopTextEdit();
        WBModel.setActivePage(id);
        WBCanvas.render();
        selectNode(null);
        WBPages.render();
        WBLayers.render();
        WBDesign.render();
        refreshTitles();
        setTimeout(function () { WBCanvas.syncFrameHeight(); WBCanvas.updateOverlay(); }, 120);
    }

    /* ------------------------------------------------------ file state -- */

    function refreshTitles() {
        var project = WBModel.get();
        document.getElementById("wb-project-name").textContent = project.name;
        var page = WBModel.activePage();
        try {
            ao_module_setWindowTitle(project.name + " - " + page.name + " - Site Builder");
        } catch (e) { /* not running inside the ArozOS desktop */ }
        document.title = project.name + " - Site Builder";
        WBPages.renderSettings();
    }

    function updateSaveState() {
        var dirty = WBModel.isDirty();
        var st = document.getElementById("wb-save-state");
        st.classList.toggle("dirty", dirty);
        st.querySelector(".wb-save-icon").innerHTML = WBIcon(dirty ? "cloud-off" : "cloud-check", 15);
        st.querySelector(".wb-save-text").textContent = dirty ? "Unsaved" : "Saved";

        document.getElementById("wb-status-dot").classList.toggle("dirty", dirty);
        document.getElementById("wb-status-saved").textContent =
            dirty ? "Unsaved changes" : (WBFileIO.currentPath() ? "Saved to " + WBFileIO.fileName() : "Not saved yet");
    }

    function updateHistoryButtons() {
        document.getElementById("wb-undo").disabled = !WBModel.canUndo();
        document.getElementById("wb-redo").disabled = !WBModel.canRedo();
    }

    function scheduleAutosave() {
        if (!autosave || !WBFileIO.currentPath()) { return; }
        if (autosaveTimer) { clearTimeout(autosaveTimer); }
        autosaveTimer = setTimeout(function () {
            if (!WBModel.isDirty()) { return; }
            WBFileIO.save(function (ok) {
                if (ok) { updateSaveState(); }
            });
        }, 4000);
    }

    function getAutosave() { return autosave; }
    function setAutosave(v) { autosave = v; }

    function save() {
        WBFileIO.save(function (ok) {
            if (ok) {
                WBUI.toast("Saved", "ok");
                updateSaveState();
                WBSettings.render();
            }
        });
    }

    function saveAs() {
        WBFileIO.saveAs(function (ok) {
            if (ok) {
                WBUI.toast("Saved as " + WBFileIO.fileName(), "ok");
                updateSaveState();
                WBSettings.render();
            }
        });
    }

    function openSite() {
        confirmDiscard(function () {
            WBFileIO.openDialog();
            /* openDialog resolves asynchronously through openPath */
            var poll = setInterval(function () {
                if (WBModel.get() && !WBModel.isDirty() && WBFileIO.currentPath()) {
                    clearInterval(poll);
                    afterProjectLoaded();
                }
            }, 250);
            setTimeout(function () { clearInterval(poll); }, 60000);
        });
    }

    /*
        New Site opens the template gallery rather than dropping the user
        straight into the default starter page: a template arrives with every
        page written and its navigation already linked up.
    */
    function newSite() {
        confirmDiscard(function () {
            WBGallery.open("My Website").then(function (choice) {
                if (!choice) { return; }
                var tpl = choice.templateId ? WBTemplates.get(choice.templateId) : null;
                try {
                    if (tpl) {
                        WBModel.loadProject(WBTemplates.buildProject(tpl, choice.name));
                    } else {
                        WBModel.newProject(choice.name, { blank: true });
                    }
                } catch (e) {
                    console.error("[wb] could not build the template", e);
                    WBUI.toast("That template could not be loaded", "err");
                    return;
                }
                WBFileIO.setPath("");
                afterProjectLoaded();
                showPanel("pages");
                openDock();
                WBUI.toast(tpl ? "Created from the " + tpl.name + " template" : "Blank site created", "ok");
            });
        });
    }

    function renameSite() {
        WBUI.prompt("Rename Site", "Site name", WBModel.get().name).then(function (name) {
            if (!name) { return; }
            WBModel.get().name = name;
            WBModel.commit("Rename site");
            refreshTitles();
            WBSettings.render();
        });
    }

    function confirmDiscard(next) {
        if (!WBModel.isDirty()) { next(); return; }
        WBUI.modal({
            title: "Unsaved Changes",
            body: WBUI.el("div", { text: "This site has changes that have not been saved to a file yet." }),
            buttons: [
                { label: "Cancel", value: null },
                { label: "Discard", value: "discard", danger: true },
                { label: "Save First", value: "save", primary: true }
            ]
        }).then(function (v) {
            if (v === "discard") { next(); }
            else if (v === "save") { WBFileIO.save(function (ok) { if (ok) { next(); } }); }
        });
    }

    /* ------------------------------------------------------ text tools -- */

    function bindTextToolbar() {
        var bar = document.getElementById("wb-text-toolbar");

        bar.querySelector("[data-tt='edit']").addEventListener("click", function () {
            var id = WBCanvas.getSelection();
            if (id) { WBCanvas.startTextEdit(id); }
        });

        ["left", "center", "right"].forEach(function (a) {
            bar.querySelector("[data-tt='align-" + a + "']").addEventListener("click", function () {
                var id = WBCanvas.getSelection();
                if (!id) { return; }
                WBModel.setStyle(id, "textAlign", a, WBCanvas.getDevice());
                WBModel.commit("Align text");
                WBCanvas.refreshStyles();
                WBInspector.render();
                updateTextToolbarState();
            });
        });

        bar.querySelector("[data-tt='bold']").addEventListener("click", function () {
            requireEditing(function () { WBCanvas.execTextCommand("bold"); updateTextToolbarState(); });
        });
        bar.querySelector("[data-tt='italic']").addEventListener("click", function () {
            requireEditing(function () { WBCanvas.execTextCommand("italic"); updateTextToolbarState(); });
        });
        bar.querySelector("[data-tt='link']").addEventListener("click", function () {
            requireEditing(function () {
                WBUI.prompt("Insert Link", "Link address", "", "https:// or about.html").then(function (v) {
                    if (!v) { return; }
                    WBCanvas.execTextCommand("createLink", v);
                });
            });
        });
        bar.querySelector("[data-tt='more']").addEventListener("click", function (e) {
            var id = WBCanvas.getSelection();
            var node = id ? WBModel.findNode(id) : null;
            var items = [
                { label: "Underline", icon: "underline", action: function () {
                    requireEditing(function () { WBCanvas.execTextCommand("underline"); });
                } },
                { label: "Remove Link", icon: "unlink", action: function () {
                    requireEditing(function () { WBCanvas.execTextCommand("unlink"); });
                } },
                { label: "Clear Formatting", icon: "close", action: function () {
                    requireEditing(function () { WBCanvas.execTextCommand("removeFormat"); });
                } },
                { separator: true }
            ];
            if (node && node.type === "heading") {
                items.push({ header: "Heading level" });
                ["h1", "h2", "h3", "h4", "h5", "h6"].forEach(function (h) {
                    items.push({
                        label: h.toUpperCase(),
                        checked: node.tag === h,
                        action: function () {
                            WBModel.setTag(node.id, h);
                            WBModel.commit("Change heading level");
                            rerenderCanvas();
                            WBInspector.render();
                        }
                    });
                });
            } else {
                items.push({ label: "Open in inspector", icon: "gear", action: function () {
                    WBInspector.render();
                } });
            }
            WBUI.menu(e.currentTarget, items, { alignRight: true });
        });
    }

    function requireEditing(fn) {
        if (!WBCanvas.isEditingText()) {
            var id = WBCanvas.getSelection();
            if (!id) { return; }
            WBCanvas.startTextEdit(id);
            setTimeout(fn, 60);
            return;
        }
        fn();
    }

    function updateTextToolbarState() {
        var bar = document.getElementById("wb-text-toolbar");
        var id = WBCanvas.getSelection();
        var node = id ? WBModel.findNode(id) : null;
        if (!node) { return; }
        var align = WBModel.effectiveStyle(node, "textAlign", WBCanvas.getDevice()) || "left";
        ["left", "center", "right"].forEach(function (a) {
            bar.querySelector("[data-tt='align-" + a + "']").classList.toggle("active", align === a);
        });
        bar.querySelector("[data-tt='bold']").classList.toggle("active", WBCanvas.queryTextState("bold"));
        bar.querySelector("[data-tt='italic']").classList.toggle("active", WBCanvas.queryTextState("italic"));
    }

    /* ------------------------------------------------------- shortcuts -- */

    function bindShortcuts() {
        document.addEventListener("keydown", function (e) {
            var mod = e.ctrlKey || e.metaKey;
            var tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
            var typing = tag === "input" || tag === "textarea" || e.target.isContentEditable;

            if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
            if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); openSite(); return; }
            if (mod && e.key === "0") { e.preventDefault(); WBCanvas.zoomToFit(); updateZoomLabel(); return; }

            if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
            if (mod && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
                e.preventDefault(); redo(); return;
            }

            if (typing && !WBCanvas.isEditingText()) { return; }

            if (mod && e.shiftKey && e.key.toLowerCase() === "v") {
                e.preventDefault();
                var sel = WBCanvas.getSelection();
                if (sel) { pasteStyles(sel); }
                return;
            }
            if (mod && e.key.toLowerCase() === "d") {
                e.preventDefault();
                var d = WBCanvas.getSelection();
                if (d) { duplicateNode(d); }
                return;
            }
            if (e.key === "Escape") {
                if (WBCanvas.isEditingText()) { WBCanvas.stopTextEdit(); }
                else if (WBPublish.isPreview()) { WBPublish.togglePreview(false); }
                else { selectNode(null); }
                return;
            }
            if ((e.key === "Delete" || e.key === "Backspace") && !WBCanvas.isEditingText()) {
                var id = WBCanvas.getSelection();
                if (id) { e.preventDefault(); deleteNode(id); }
                return;
            }
            if (e.key === "Enter" && !WBCanvas.isEditingText()) {
                var s2 = WBCanvas.getSelection();
                var n2 = s2 ? WBModel.findNode(s2) : null;
                if (n2 && wbIsTextEditable(n2.type)) { e.preventDefault(); WBCanvas.startTextEdit(s2); }
                return;
            }
        });

        window.addEventListener("beforeunload", function (e) {
            if (WBModel.isDirty()) {
                e.preventDefault();
                e.returnValue = "";
                return "";
            }
        });
    }

    function undo() {
        if (WBModel.undo()) { WBUI.toast("Undo"); }
    }

    function redo() {
        if (WBModel.redo()) { WBUI.toast("Redo"); }
    }

    /* ------------------------------------------------------------ help -- */

    function bindHelp() {
        var body = document.querySelector("#wb-panel-help .wb-panel-bd");
        var items = [
            ["Add elements", "Drag a card from the Add panel onto the canvas, or click it to drop it inside whatever is selected."],
            ["Edit text", "Double-click any text on the canvas, or press Enter with it selected. The floating bar handles bold, italic and links."],
            ["Layers", "The Layers panel is the element tree of this page. Drag rows to reorder or re-parent; drop on the middle of a container to move inside it."],
            ["Responsive design", "Switch to Tablet or Mobile in the top bar, then edit. Those changes only apply at that width and narrower."],
            ["Publish", "Publish writes a static site into a folder of its own inside your ArozOS Personal Site web root, then serves it at /www/&lt;user&gt;/&lt;folder&gt;/."],
            ["Project files", "Sites are saved as .wbsite files anywhere in your file system. Publishing is a separate step and never overwrites your project file."]
        ];
        items.forEach(function (it) {
            body.appendChild(WBUI.el("div", { class: "wb-help-item" }, [
                WBUI.el("h4", { text: it[0] }),
                WBUI.el("p", { html: it[1] })
            ]));
        });
        body.appendChild(WBUI.el("button", {
            class: "wb-btn wb-btn-block wb-btn-sm",
            style: "margin-top:14px",
            type: "button",
            html: WBIcon("help", 13) + "<span>Keyboard shortcuts</span>",
            onclick: showShortcuts
        }));
    }

    function showShortcuts() {
        var rows = [
            ["Ctrl + S", "Save project"],
            ["Ctrl + O", "Open project"],
            ["Ctrl + Z", "Undo"],
            ["Ctrl + Shift + Z", "Redo"],
            ["Ctrl + D", "Duplicate selection"],
            ["Ctrl + Shift + V", "Paste copied styles"],
            ["Ctrl + 0", "Zoom to fit"],
            ["Enter", "Edit the selected text"],
            ["Delete", "Delete selection"],
            ["Escape", "Stop editing / deselect / leave preview"]
        ];
        var list = WBUI.el("div");
        rows.forEach(function (r) {
            list.appendChild(WBUI.el("div", {
                style: "display:flex;gap:12px;padding:6px 0;border-bottom:1px solid var(--wb-border)"
            }, [
                WBUI.el("span", { class: "wb-kbd", text: r[0] }),
                WBUI.el("span", { text: r[1], style: "color:var(--wb-text-dim)" })
            ]));
        });
        WBUI.modal({ title: "Keyboard Shortcuts", body: list });
    }

    function showAbout() {
        WBUI.modal({
            title: "ArozOS Site Builder",
            body: WBUI.el("div", {
                html: "<p>A visual website builder for ArozOS. Sites are saved as <code>.wbsite</code> " +
                      "project files and published as plain static HTML into your Personal Site web root " +
                      "- no runtime, no database, nothing to keep running.</p>" +
                      "<p style='margin-top:10px;color:var(--wb-text-dim)'>Part of the ArozOS web desktop. " +
                      "Licensed under GPLv3.</p>"
            })
        });
    }

    /* ----------------------------------------------------------- theme -- */

    function applyTheme() {
        function setDark(dark) { document.body.classList.toggle("dark", !!dark); }
        try {
            if (typeof ao_module_getSystemThemeColor === "function") {
                ao_module_getSystemThemeColor(function (c) { setDark(c !== "whiteTheme"); });
            }
        } catch (e) { /* standalone - keep the light theme */ }

        window.desktopThemeChanged = function (theme) { setDark(theme === "dark" || theme === "darkTheme"); };
        try {
            if (typeof ao_module_onThemeChanged === "function") {
                ao_module_onThemeChanged(function (dark) { setDark(dark); });
            }
        } catch (e) { /* older ao_module - the global above still works */ }
    }

    function renderPreviewState(on) {
        document.getElementById("wb-preview-btn").classList.toggle("active", on);
    }

    return {
        init: init,
        showPanel: showPanel,
        insertElement: insertElement,
        deleteNode: deleteNode,
        duplicateNode: duplicateNode,
        wrapInContainer: wrapInContainer,
        unwrapNode: unwrapNode,
        copyStyles: copyStyles,
        pasteStyles: pasteStyles,
        selectNode: selectNode,
        highlightNode: highlightNode,
        rerenderCanvas: rerenderCanvas,
        refreshInspector: refreshInspector,
        refreshTitles: refreshTitles,
        switchPage: switchPage,
        save: save,
        saveAs: saveAs,
        getAutosave: getAutosave,
        setAutosave: setAutosave,
        renderPreviewState: renderPreviewState,
        updateSaveState: updateSaveState
    };
})();

document.addEventListener("DOMContentLoaded", function () { WBApp.init(); });
