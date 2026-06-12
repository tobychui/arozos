/*
    Pixel Studio - top menu bar (Photoshop-style)
*/
"use strict";

PS.menus = function () {
    return [
        {
            label: "File",
            items: [
                { label: "New...", shortcut: "Ctrl+N", action: PS.fileNewDialog },
                { label: "Open...", shortcut: "Ctrl+O", action: PS.fileOpenDialog },
                { sep: true },
                { label: "Save", shortcut: "Ctrl+S", action: PS.fileSave },
                { label: "Save As...", shortcut: "Ctrl+Shift+S", action: PS.fileSaveAs },
                { sep: true },
                { label: "Export PNG...", action: function () { PS.exportImage("png"); } },
                { label: "Export JPEG...", action: function () { PS.exportImage("jpg"); } },
                { sep: true },
                {
                    label: "Close", action: function () {
                        PS.confirmDiscard(function () {
                            try { ao_module_close(); }
                            catch (e) { PS.toast("Close the browser tab to exit"); }
                        });
                    }
                }
            ]
        },
        {
            label: "Edit",
            items: [
                {
                    label: "Undo", shortcut: "Ctrl+Z", action: PS.undo,
                    enabled: PS.canUndo
                },
                {
                    label: "Redo", shortcut: "Ctrl+Shift+Z", action: PS.redo,
                    enabled: PS.canRedo
                },
                { sep: true },
                { label: "Cut", shortcut: "Ctrl+X", action: function () { PS.copySelection(true, false); } },
                { label: "Copy", shortcut: "Ctrl+C", action: function () { PS.copySelection(false, false); } },
                { label: "Copy Merged", shortcut: "Ctrl+Shift+C", action: function () { PS.copySelection(false, true); } },
                {
                    label: "Paste", shortcut: "Ctrl+V", action: PS.pasteClipboard,
                    enabled: function () { return !!PS.clipboard; }
                },
                { sep: true },
                { label: "Fill with Foreground", shortcut: "Alt+Backspace", action: function () { PS.fillWithColor(PS.fg, "Fill Foreground"); } },
                { label: "Fill with Background", shortcut: "Ctrl+Backspace", action: function () { PS.fillWithColor(PS.bg, "Fill Background"); } },
                { label: "Clear", shortcut: "Delete", action: PS.clearSelected }
            ]
        },
        {
            label: "Image",
            items: [
                { label: "Resize Image...", action: PS.resizeImageDialog },
                { label: "Canvas Size...", action: PS.resizeCanvasDialog },
                {
                    label: "Crop to Selection", action: PS.cropToSelection,
                    enabled: function () { return !!PS.doc.selection; }
                },
                { sep: true },
                { label: "Flip Horizontal", action: function () { PS.flipImage(true); } },
                { label: "Flip Vertical", action: function () { PS.flipImage(false); } },
                { label: "Rotate 90° CW", action: function () { PS.rotateImage(90); } },
                { label: "Rotate 90° CCW", action: function () { PS.rotateImage(270); } },
                { label: "Rotate 180°", action: function () { PS.rotateImage(180); } }
            ]
        },
        {
            label: "Layer",
            items: [
                { label: "New Layer", shortcut: "Ctrl+Shift+N", action: function () { PS.addLayer(); } },
                { label: "Duplicate Layer", shortcut: "Ctrl+J", action: PS.duplicateLayer },
                { label: "Delete Layer", action: PS.deleteLayer },
                { sep: true },
                {
                    label: "Merge Down", shortcut: "Ctrl+E", action: PS.mergeDown,
                    enabled: function () { return PS.doc.activeLayer > 0; }
                },
                { label: "Flatten Image", shortcut: "Ctrl+Shift+E", action: PS.flattenImage },
                { sep: true },
                {
                    label: "Rasterize Text Layer", action: function () { PS.rasterizeLayer(); },
                    enabled: function () { return PS.activeLayer() && PS.activeLayer().type === "text"; }
                }
            ]
        },
        {
            label: "Select",
            items: [
                { label: "All", shortcut: "Ctrl+A", action: PS.selectAll },
                {
                    label: "Deselect", shortcut: "Ctrl+D", action: PS.deselect,
                    enabled: function () { return !!PS.doc.selection; }
                },
                { label: "Inverse", shortcut: "Ctrl+Shift+I", action: PS.invertSelection },
                { sep: true },
                {
                    label: "Feather...",
                    enabled: function () { return !!PS.doc.selection; },
                    action: function () {
                        var rIn;
                        PS.dialog({
                            title: "Feather Selection",
                            build: function (body) {
                                rIn = PS.dialogRow(body, "Radius (px)", PS.numberInput(4, 1, 100));
                            },
                            buttons: [
                                { label: "Cancel" },
                                {
                                    label: "Apply", primary: true,
                                    action: function () {
                                        PS.featherSelection(PS.clamp(parseInt(rIn.value, 10) || 4, 1, 100));
                                    }
                                }
                            ]
                        });
                    }
                }
            ]
        },
        {
            label: "Filter",
            items: PS.filters.map(function (f) {
                if (f.sep) { return { sep: true }; }
                return { label: f.label, action: function () { PS.runFilter(f); } };
            })
        },
        {
            label: "View",
            items: [
                { label: "Zoom In", shortcut: "Ctrl++", action: function () { PS.zoomBy(1.25); } },
                { label: "Zoom Out", shortcut: "Ctrl+-", action: function () { PS.zoomBy(1 / 1.25); } },
                { label: "Fit on Screen", shortcut: "Ctrl+0", action: PS.zoomFit },
                { label: "Actual Pixels", shortcut: "Ctrl+1", action: PS.zoomActual }
            ]
        },
        {
            label: "Help",
            items: [
                { label: "Keyboard Shortcuts...", action: PS.showShortcutsDialog },
                { label: "About Pixel Studio...", action: PS.showAboutDialog }
            ]
        }
    ];
};

/* ---------- rendering ---------- */

PS._openMenu = null;

PS.buildMenubar = function () {
    var bar = PS.el("menubar");
    bar.innerHTML = "";

    PS.menus().forEach(function (menu, idx) {
        var root = document.createElement("div");
        root.className = "menu-root";
        root.textContent = menu.label;
        root.dataset.index = idx;

        root.addEventListener("click", function (e) {
            e.stopPropagation();
            if (PS._openMenu === root) { PS.closeMenus(); }
            else { PS.openMenu(root, menu); }
        });
        root.addEventListener("mouseenter", function () {
            if (PS._openMenu && PS._openMenu !== root) { PS.openMenu(root, menu); }
        });
        bar.appendChild(root);
    });

    document.addEventListener("click", PS.closeMenus);
};

PS.openMenu = function (root, menu) {
    PS.closeMenus();
    PS._openMenu = root;
    root.classList.add("open");

    var dd = document.createElement("div");
    dd.className = "menu-dropdown";

    menu.items.forEach(function (item) {
        if (item.sep) {
            var sep = document.createElement("div");
            sep.className = "menu-sep";
            dd.appendChild(sep);
            return;
        }
        var div = document.createElement("div");
        div.className = "menu-item";
        if (item.enabled && !item.enabled()) { div.className += " disabled"; }
        var lab = document.createElement("span");
        lab.textContent = item.label;
        div.appendChild(lab);
        if (item.shortcut) {
            var sc = document.createElement("span");
            sc.className = "shortcut";
            sc.textContent = item.shortcut;
            div.appendChild(sc);
        }
        div.addEventListener("click", function (e) {
            e.stopPropagation();
            PS.closeMenus();
            if (item.action) { item.action(); }
        });
        dd.appendChild(div);
    });

    root.appendChild(dd);
};

PS.closeMenus = function () {
    if (!PS._openMenu) { return; }
    PS._openMenu.classList.remove("open");
    var dd = PS._openMenu.querySelector(".menu-dropdown");
    if (dd) { dd.remove(); }
    PS._openMenu = null;
};

/* ---------- help dialogs ---------- */

PS.showShortcutsDialog = function () {
    var rows = [
        ["V", "Move tool"],
        ["M / Shift+M", "Marquee (rect / ellipse)"],
        ["L / Shift+L", "Lasso (freehand / polygonal)"],
        ["W", "Magic wand / smart select"],
        ["B / Shift+B", "Brush / Pencil"],
        ["E", "Eraser"],
        ["G", "Paint bucket"],
        ["I", "Eyedropper"],
        ["T", "Text"],
        ["U", "Shape"],
        ["H", "Hand (pan)"],
        ["Z", "Zoom"],
        ["[ / ]", "Decrease / increase brush size"],
        ["X", "Swap foreground/background colors"],
        ["D", "Default colors (black/white)"],
        ["Space + drag", "Pan canvas"],
        ["Ctrl + wheel", "Zoom at cursor"],
        ["Ctrl+Z / Ctrl+Shift+Z", "Undo / Redo"],
        ["Ctrl+A / Ctrl+D", "Select all / Deselect"],
        ["Ctrl+Shift+I", "Invert selection"],
        ["Ctrl+J", "Duplicate layer"],
        ["Ctrl+Shift+N", "New layer"],
        ["Ctrl+E / Ctrl+Shift+E", "Merge down / Flatten"],
        ["Ctrl+X / C / V", "Cut / Copy / Paste"],
        ["Ctrl+Shift+C", "Copy merged"],
        ["Alt+Backspace / Ctrl+Backspace", "Fill with FG / BG color"],
        ["Delete", "Clear selection"],
        ["Ctrl+0 / Ctrl+1", "Fit on screen / 100%"],
        ["Ctrl+S / Ctrl+Shift+S", "Save / Save As"],
        ["Arrows (Move tool)", "Nudge layer 1px (Shift: 10px)"],
        ["Esc / Enter", "Cancel / close polygon lasso, text editing"]
    ];

    PS.dialog({
        title: "Keyboard Shortcuts",
        build: function (body) {
            var table = document.createElement("table");
            table.className = "shortcuts";
            rows.forEach(function (r) {
                var tr = document.createElement("tr");
                var k = document.createElement("td");
                k.className = "key";
                k.textContent = r[0];
                var d = document.createElement("td");
                d.textContent = r[1];
                tr.appendChild(k);
                tr.appendChild(d);
                table.appendChild(tr);
            });
            body.appendChild(table);
        },
        buttons: [{ label: "Close", primary: true }]
    });
};

PS.showAboutDialog = function () {
    PS.dialog({
        title: "About Pixel Studio",
        build: function (body) {
            body.innerHTML =
                "<p><b>Pixel Studio 1.0</b></p>" +
                "<p>A Photoshop-style layered image editor for ArozOS.</p>" +
                "<p>Features: layered editing with blend modes, brushes and pen " +
                "strokes, shapes, editable text layers with custom fonts " +
                "(drop .ttf/.otf/.woff into the app's <code>fonts/</code> folder), " +
                "marquee / lasso / magic-wand selections with edge-detection " +
                "smart select, filters, and full keyboard shortcuts.</p>" +
                "<p>Native project format: <code>.pxs</code> (keeps layers). " +
                "Export to PNG/JPEG for flat images.</p>";
        },
        buttons: [{ label: "Close", primary: true }]
    });
};
