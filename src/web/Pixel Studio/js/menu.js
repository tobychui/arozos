/*
    Pixel Studio - top menu bar
*/
"use strict";

PS.menus = function () {
    function hasDoc() { return !!PS.doc; }
    function hasSel() { return !!(PS.doc && PS.doc.selection); }
    function transformItems() {
        return [
            { label: "Again", shortcut: "Shift+Ctrl+T", action: function () { PS.transform.again(); } },
            { sep: true },
            { label: "Scale", action: function () { PS.beginTransformMode("scale"); } },
            { label: "Rotate", action: function () { PS.beginTransformMode("rotate"); } },
            { label: "Skew", action: function () { PS.beginTransformMode("skew"); } },
            { label: "Distort", action: function () { PS.beginTransformMode("distort"); } },
            { label: "Perspective", action: function () { PS.beginTransformMode("perspective"); } },
            { sep: true },
            { label: "Rotate 180°", action: function () { PS.transform.quick(180); } },
            { label: "Rotate 90° CW", action: function () { PS.transform.quick(90); } },
            { label: "Rotate 90° CCW", action: function () { PS.transform.quick(-90); } },
            { sep: true },
            { label: "Flip Horizontal", action: function () { PS.transform.quick("flipH"); } },
            { label: "Flip Vertical", action: function () { PS.transform.quick("flipV"); } }
        ];
    }
    return [
        {
            label: "File",
            items: [
                { label: "New...", shortcut: "Ctrl+N", action: PS.fileNewDialog },
                { label: "Open...", shortcut: "Ctrl+O", action: PS.fileOpenDialog },
                { label: "Open in Raw Editor...", action: function () { PS.openInRawEditor(); } },
                { sep: true },
                { label: "Save", shortcut: "Ctrl+S", action: PS.fileSave },
                { label: "Save As...", shortcut: "Shift+Ctrl+S", action: PS.fileSaveAs },
                {
                    label: "Autosave", action: function () {
                        var s = PS.saveManager.settings();
                        PS.saveManager.setSettings(!s.enabled, s.minutes);
                    },
                    checked: function () { return PS.saveManager.settings().enabled; }
                },
                { label: "Save Status...", action: function () { PS.saveManager.openPanel(); } },
                { sep: true },
                {
                    label: "Export", submenu: function () {
                        return [
                            { label: "PNG...", action: function () { PS.exportImage("png"); } },
                            { label: "JPEG...", action: function () { PS.exportImage("jpg"); } },
                            { label: "WebP...", action: function () { PS.exportImage("webp"); } }
                        ];
                    }
                },
                { sep: true },
                { label: "Close", action: function () { PS.requestClose(); } }
            ]
        },
        {
            label: "Edit",
            items: [
                {
                    // Ctrl+Z toggles between undoing and redoing the last step
                    label: function () {
                        var u = PS.toggleUndoInfo();
                        return u ? (u.redo ? "Redo " : "Undo ") + u.label : "Undo";
                    },
                    shortcut: "Ctrl+Z", action: PS.toggleUndo, enabled: function () { return !!PS.toggleUndoInfo(); }
                },
                { label: "Step Forward", shortcut: "Shift+Ctrl+Z", action: PS.stepForward, enabled: PS.canRedo },
                { label: "Step Backward", shortcut: "Alt+Ctrl+Z", action: PS.stepBackward, enabled: PS.canUndo },
                { sep: true },
                { label: "Cut", shortcut: "Ctrl+X", action: function () { PS.copySelection(true, false); } },
                { label: "Copy", shortcut: "Ctrl+C", action: function () { PS.copySelection(false, false); } },
                { label: "Copy Merged", shortcut: "Shift+Ctrl+C", action: function () { PS.copySelection(false, true); } },
                { label: "Paste", shortcut: "Ctrl+V", action: function () { PS.pasteFromClipboard(); } },
                { label: "Clear", shortcut: "Delete", action: PS.clearSelected },
                { sep: true },
                { label: "Fill...", shortcut: "Shift+F5", action: function () { PS.fillDialog(); }, enabled: hasDoc },
                { label: "Stroke...", action: function () { PS.strokeDialog(); }, enabled: hasDoc },
                { label: "Fill with Foreground", shortcut: "Alt+Backspace", action: function () { PS.fillWithColor(PS.fg, "Fill Foreground"); } },
                { label: "Fill with Background", shortcut: "Ctrl+Backspace", action: function () { PS.fillWithColor(PS.bg, "Fill Background"); } },
                { sep: true },
                { label: "Free Transform", shortcut: "Ctrl+T", action: function () { PS.transform.begin({ kind: "auto" }); }, enabled: hasDoc },
                { label: "Transform", submenu: transformItems },
                { sep: true },
                { label: "Define Brush Preset...", action: function () { PS.defineBrushPreset(); }, enabled: hasDoc },
                { sep: true },
                {
                    label: "Preferences", submenu: function () {
                        return [
                            { label: "Grid...", action: function () { PS.gridPrefsDialog(); } }
                        ];
                    }
                }
            ]
        },
        {
            label: "Image",
            items: [
                {
                    label: "Mode", submenu: function () {
                        return [
                            { label: "RGB Color", checked: function () { return true; }, action: function () { } },
                            { sep: true },
                            { label: "8 Bits/Channel", checked: function () { return true; }, action: function () { } }
                        ];
                    }
                },
                { sep: true },
                { label: "Adjustments", submenu: function () { return PS.imageAdjustmentMenuItems(); } },
                { sep: true },
                { label: "Auto Tone", shortcut: "Shift+Ctrl+L", action: function () { PS.autoAdjust("tone"); } },
                { label: "Auto Contrast", shortcut: "Alt+Shift+Ctrl+L", action: function () { PS.autoAdjust("contrast"); } },
                { label: "Auto Color", shortcut: "Shift+Ctrl+B", action: function () { PS.autoAdjust("color"); } },
                { sep: true },
                { label: "Image Size...", shortcut: "Alt+Ctrl+I", action: PS.resizeImageDialog },
                { label: "Canvas Size...", shortcut: "Alt+Ctrl+C", action: PS.resizeCanvasDialog },
                {
                    label: "Image Rotation", submenu: function () {
                        return [
                            { label: "180°", action: function () { PS.rotateImage(180); } },
                            { label: "90° CW", action: function () { PS.rotateImage(90); } },
                            { label: "90° CCW", action: function () { PS.rotateImage(270); } },
                            { label: "Arbitrary...", action: function () { PS.rotateArbitraryDialog(); } },
                            { sep: true },
                            { label: "Flip Canvas Horizontal", action: function () { PS.flipImage(true); } },
                            { label: "Flip Canvas Vertical", action: function () { PS.flipImage(false); } }
                        ];
                    }
                },
                { label: "Crop", action: PS.cropToSelection, enabled: hasSel },
                { label: "Trim...", action: function () { PS.trimDialog(); }, enabled: hasDoc },
                { label: "Reveal All", action: function () { PS.revealAll(); }, enabled: hasDoc }
            ]
        },
        {
            label: "Layer",
            items: [
                {
                    label: "New", submenu: function () {
                        return [
                            { label: "Layer...", shortcut: "Shift+Ctrl+N", action: function () { PS.addLayer(); } },
                            { label: "Group", action: PS.newGroup },
                            { sep: true },
                            { label: "Layer via Copy", shortcut: "Ctrl+J", action: function () { PS.layerViaCopy(false); } },
                            { label: "Layer via Cut", shortcut: "Shift+Ctrl+J", action: function () { PS.layerViaCopy(true); }, enabled: hasSel }
                        ];
                    }
                },
                { label: "Duplicate Layer", action: PS.duplicateLayer },
                { label: "Delete Layer", action: PS.deleteSelectedLayers },
                { sep: true },
                { label: "Layer Style", submenu: function () { return PS.layerStyleMenuItems(); } },
                { sep: true },
                { label: "New Fill Layer", submenu: function () { return PS.fillLayerMenuItems ? PS.fillLayerMenuItems() : []; } },
                { label: "New Adjustment Layer", submenu: function () { return PS.adjustmentMenuItems ? PS.adjustmentMenuItems() : []; } },
                { sep: true },
                {
                    label: "Layer Mask", submenu: function () {
                        var l = PS.activeLayer();
                        return [
                            { label: "Reveal All", action: function () { PS.addLayerMask(); }, enabled: function () { return !!(l && !l.mask); } },
                            { label: "Delete", action: function () { PS.deleteLayerMask(); }, enabled: function () { return !!(l && l.mask); } },
                            { label: "Apply", action: function () { PS.applyLayerMask(); }, enabled: function () { return !!(l && l.mask); } },
                            { sep: true },
                            { label: "Enable / Disable", action: function () { PS.toggleMaskEnabled(l); }, enabled: function () { return !!(l && l.mask); } },
                            { label: "Link / Unlink", action: function () { PS.toggleMaskLinked(l); }, enabled: function () { return !!(l && l.mask); } }
                        ];
                    }
                },
                { label: "Create Clipping Mask", shortcut: "Alt+Ctrl+G", action: function () { PS.toggleClipping(); } },
                { sep: true },
                { label: "Group Layers", shortcut: "Ctrl+G", action: PS.groupSelectedLayers },
                {
                    label: "Ungroup Layers", shortcut: "Shift+Ctrl+G", action: PS.ungroupLayers,
                    enabled: function () { return !!(PS.activeLayer() && PS.activeLayer().kind === "group"); }
                },
                {
                    label: "Arrange", submenu: function () {
                        return [
                            { label: "Bring to Front", shortcut: "Shift+Ctrl+]", action: function () { PS.arrangeLayer("front"); } },
                            { label: "Bring Forward", shortcut: "Ctrl+]", action: function () { PS.arrangeLayer("forward"); } },
                            { label: "Send Backward", shortcut: "Ctrl+[", action: function () { PS.arrangeLayer("backward"); } },
                            { label: "Send to Back", shortcut: "Shift+Ctrl+[", action: function () { PS.arrangeLayer("back"); } }
                        ];
                    }
                },
                {
                    label: "Align", submenu: function () {
                        return [["top", "Top Edges"], ["vcenter", "Vertical Centers"], ["bottom", "Bottom Edges"],
                            ["left", "Left Edges"], ["hcenter", "Horizontal Centers"], ["right", "Right Edges"]].map(function (a) {
                            return { label: a[1], action: function () { PS.alignLayers(a[0]); } };
                        });
                    }
                },
                {
                    label: "Distribute", submenu: function () {
                        return [["dtop", "Top Edges"], ["dvcenter", "Vertical Centers"], ["dleft", "Left Edges"], ["dhcenter", "Horizontal Centers"]].map(function (a) {
                            return { label: a[1], action: function () { PS.distributeLayers(a[0]); } };
                        });
                    }
                },
                { sep: true },
                { label: "Link Layers", action: function () { PS.linkSelectedLayers(); } },
                { sep: true },
                {
                    label: "Merge Down", shortcut: "Ctrl+E", action: PS.mergeSelectedOrDown,
                    enabled: function () {
                        var loc = PS.doc && PS.locateLayer(PS.activeLayer());
                        return PS.selectedLayers().length > 1 || !!(loc && loc.index > 0);
                    }
                },
                { label: "Merge Visible", shortcut: "Shift+Ctrl+E", action: PS.mergeVisible },
                { label: "Stamp Visible", shortcut: "Alt+Shift+Ctrl+E", action: function () { PS.stampVisible(); } },
                { label: "Flatten Image", action: PS.flattenImage },
                { sep: true },
                {
                    label: "Rasterize Layer", action: function () { PS.rasterizeLayer(); },
                    enabled: function () {
                        var l = PS.activeLayer();
                        return !!(l && l.canvas && l.kind !== "raster");
                    }
                }
            ]
        },
        {
            label: "Type",
            items: [
                { label: "Panels", submenu: function () {
                    return [
                        { label: "Character Panel", action: function () { PS.ws.showPanel("character"); } },
                        { label: "Paragraph Panel", action: function () { PS.ws.showPanel("paragraph"); } }
                    ];
                } },
                { sep: true },
                {
                    label: "Orientation", submenu: function () {
                        return [
                            { label: "Horizontal", action: function () { PS.setTextOrientation("horizontal"); } },
                            { label: "Vertical", action: function () { PS.setTextOrientation("vertical"); } }
                        ];
                    }
                },
                { label: "Warp Text...", action: function () { PS.warpTextDialog(); } },
                {
                    label: "Convert to Paragraph Text / Point Text", action: function () { PS.toggleTextBoxType(); },
                    enabled: function () { var l = PS.activeLayer(); return !!(l && l.kind === "text"); }
                },
                { sep: true },
                { label: "Rasterize Type Layer", action: function () { PS.rasterizeLayer(); },
                    enabled: function () { var l = PS.activeLayer(); return !!(l && l.kind === "text"); } }
            ]
        },
        {
            label: "Select",
            items: [
                { label: "All", shortcut: "Ctrl+A", action: PS.selectAll },
                { label: "Deselect", shortcut: "Ctrl+D", action: PS.deselect, enabled: hasSel },
                { label: "Reselect", shortcut: "Shift+Ctrl+D", action: function () { PS.reselect(); }, enabled: function () { return !!(PS.doc && PS.doc.lastSelection); } },
                { label: "Inverse", shortcut: "Shift+Ctrl+I", action: PS.invertSelection },
                { sep: true },
                { label: "All Layers", shortcut: "Alt+Ctrl+A", action: function () { PS.selectAllLayers(); } },
                { label: "Deselect Layers", action: function () { PS.deselectLayers(); } },
                { sep: true },
                { label: "Color Range...", action: function () { PS.colorRangeDialog(); }, enabled: hasDoc },
                { sep: true },
                {
                    label: "Modify", submenu: function () {
                        return [
                            { label: "Border...", action: function () { PS.modifySelectionDialog("border"); }, enabled: hasSel },
                            { label: "Smooth...", action: function () { PS.modifySelectionDialog("smooth"); }, enabled: hasSel },
                            { label: "Expand...", action: function () { PS.modifySelectionDialog("expand"); }, enabled: hasSel },
                            { label: "Contract...", action: function () { PS.modifySelectionDialog("contract"); }, enabled: hasSel },
                            { label: "Feather...", shortcut: "Shift+F6", action: function () { PS.featherDialog(); }, enabled: hasSel }
                        ];
                    }
                },
                { label: "Grow", action: function () { PS.growSelection(false); }, enabled: hasSel },
                { label: "Similar", action: function () { PS.growSelection(true); }, enabled: hasSel },
                { sep: true },
                { label: "Transform Selection", action: function () { PS.transform.begin({ kind: "selection" }); }, enabled: hasSel },
                { sep: true },
                {
                    label: "Edit in Quick Mask Mode", shortcut: "Q", action: function () { PS.toggleQuickMask(); },
                    checked: function () { return !!(PS.doc && PS.doc.quickMask); }
                }
            ]
        },
        {
            label: "Filter",
            items: [
                { label: "Last Filter", shortcut: "Ctrl+F", action: function () { PS.repeatLastFilter(); }, enabled: function () { return !!PS._lastFilter; } },
                { sep: true }
            ].concat(PS.filterMenuItems())
        },
        {
            label: "View",
            items: [
                { label: "Zoom In", shortcut: "Ctrl++", action: function () { PS.zoomBy(1.25); } },
                { label: "Zoom Out", shortcut: "Ctrl+-", action: function () { PS.zoomBy(1 / 1.25); } },
                { label: "Fit on Screen", shortcut: "Ctrl+0", action: PS.zoomFit },
                { label: "100%", shortcut: "Ctrl+1", action: PS.zoomActual },
                { sep: true },
                {
                    label: "Screen Mode", submenu: function () {
                        return PS.SCREEN_MODES.map(function (label, i) {
                            return { label: label, checked: function () { return PS.screenMode === i; }, action: function () { PS.setScreenMode(i); } };
                        });
                    }
                },
                { sep: true },
                { label: "Extras", shortcut: "Ctrl+H", action: function () { PS.toggleExtras(); }, checked: function () { return PS.extrasVisible; } },
                {
                    label: "Show", submenu: function () {
                        return [
                            { label: "Grid", shortcut: "Ctrl+'", action: function () { PS.toggleGrid(); }, checked: function () { return PS.gridOn; } },
                            { label: "Guides", shortcut: "Ctrl+;", action: function () { PS.toggleGuidesVisible(); }, checked: function () { return PS.guidesVisible; } }
                        ];
                    }
                },
                { label: "Rulers", shortcut: "Ctrl+R", action: PS.toggleRulers, checked: function () { return PS.rulersOn; } },
                { sep: true },
                { label: "Snap", shortcut: "Shift+Ctrl+;", action: PS.toggleSnap, checked: function () { return PS.snapToGuides; } },
                { sep: true },
                { label: "New Guide...", action: function () { PS.newGuideDialog(); }, enabled: hasDoc },
                { label: "Clear Guides", action: PS.clearGuides, enabled: function () { return PS.hasGuides(); } }
            ]
        },
        {
            label: "Window",
            items: [
                {
                    label: "Workspace", submenu: function () {
                        return [
                            { label: "Reset Essentials", action: function () { PS.ws.reset(); } }
                        ];
                    }
                },
                { sep: true }
            ].concat(PS.ws.windowMenuItems())
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

// Edit > Transform > Scale / Rotate / ...: Free Transform with that handle mode
PS.beginTransformMode = function (mode) {
    if (!PS.transform.active && !PS.transform.begin({ kind: "auto" })) { return; }
    PS.transform.setMode(mode);
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
    PS.fillMenu(dd, menu.items, PS.closeMenus);
    root.appendChild(dd);
    // a narrow window: pull the menu back in from the right edge
    var over = dd.getBoundingClientRect().right - (window.innerWidth - 2);
    if (over > 0) { dd.style.left = -Math.min(over, root.getBoundingClientRect().left) + "px"; }
};

// Render menu item definitions - {label, shortcut, enabled, checked, action} or
// {sep:true} - into a dropdown element. Shared by the menu bar and context menus.
// Close the open submenus of one menu level (all but keep)
function closeSubmenus(dd, keep) {
    Array.prototype.forEach.call(dd.querySelectorAll(":scope > .menu-item.has-submenu"), function (it) {
        if (it === keep) { return; }
        it.classList.remove("open");
        var s = it.querySelector(":scope > .submenu");
        if (s) { s.remove(); }
    });
}

// Submenus are fixed to the viewport (a scrolling menu never clips them):
// beside their item, flipped to the left at the window edge, and moved up
// to fit
PS.placeSubmenu = function (sub, item) {
    var r = item.getBoundingClientRect();
    var sr = sub.getBoundingClientRect();
    var x = r.right - 2;
    if (x + sr.width > window.innerWidth - 4) { x = Math.max(4, r.left - sr.width + 2); }
    var y = r.top - 5;
    if (y + sr.height > window.innerHeight - 4) { y = Math.max(4, window.innerHeight - sr.height - 4); }
    sub.style.left = Math.round(x) + "px";
    sub.style.top = Math.round(y) + "px";
};

PS.fillMenu = function (dd, items, close) {
    // scrolling a long menu drops its submenus, which would no longer line up
    dd.addEventListener("scroll", function () { closeSubmenus(dd, null); });
    items.forEach(function (item) {
        if (item.sep) {
            var sep = document.createElement("div");
            sep.className = "menu-sep";
            dd.appendChild(sep);
            return;
        }
        var div = document.createElement("div");
        div.className = "menu-item";
        if (item.enabled && !item.enabled()) { div.className += " disabled"; }
        if (item.submenu) {
            // nested menu opening to the side on hover
            div.className += " has-submenu";
            var lab0 = document.createElement("span");
            lab0.textContent = item.label;
            div.appendChild(lab0);
            var arrow = document.createElement("span");
            arrow.className = "shortcut";
            arrow.textContent = "\u25b8";
            div.appendChild(arrow);
            div.addEventListener("mouseenter", function () {
                if (div.querySelector(":scope > .submenu")) { return; }
                closeSubmenus(dd, div);
                var sub = document.createElement("div");
                sub.className = "menu-dropdown submenu";
                PS.fillMenu(sub, item.submenu(), close);
                div.appendChild(sub);
                div.classList.add("open");
                PS.placeSubmenu(sub, div);
            });
            div.addEventListener("click", function (e) { e.stopPropagation(); });
            dd.appendChild(div);
            return;
        }
        div.addEventListener("mouseenter", function () { closeSubmenus(dd, null); });
        var lab = document.createElement("span");
        var isChecked = item.checked && item.checked();
        // a label may be computed when the menu opens
        lab.textContent = (isChecked ? "✓ " : "") + (typeof item.label === "function" ? item.label() : item.label);
        div.appendChild(lab);
        if (item.shortcut) {
            var sc = document.createElement("span");
            sc.className = "shortcut";
            sc.textContent = item.shortcut;
            div.appendChild(sc);
        }
        div.addEventListener("click", function (e) {
            e.stopPropagation();
            close();
            if (item.action) { item.action(); }
        });
        dd.appendChild(div);
    });
};

PS.closeMenus = function () {
    if (!PS._openMenu) { return; }
    PS._openMenu.classList.remove("open");
    var dd = PS._openMenu.querySelector(".menu-dropdown");
    if (dd) { dd.remove(); }
    PS._openMenu = null;
};

/* ---------- context menu ---------- */

PS._ctxMenu = null;

// Popup menu at viewport coordinates, built from the same item definitions the
// menu bar uses. Closes on pick, on a click outside, or on Escape.
PS.contextMenu = function (x, y, items, opts) {
    opts = opts || {};
    PS.closeContextMenu();
    PS.closeMenus();

    var dd = document.createElement("div");
    dd.className = "menu-dropdown context-menu";
    PS.fillMenu(dd, items, PS.closeContextMenu);
    document.body.appendChild(dd);

    // keep the menu inside the window: flip it back over the click point when
    // it would hang off the right or bottom edge (opts.alignRight: x is the
    // menu's right edge, as for a panel's menu button)
    var r = dd.getBoundingClientRect();
    var left = opts.alignRight ? x - r.width : ((x + r.width > window.innerWidth) ? x - r.width : x);
    left = PS.clamp(left, 0, Math.max(0, window.innerWidth - r.width));
    var top = (y + r.height > window.innerHeight) ? y - r.height : y;
    top = PS.clamp(top, 0, Math.max(0, window.innerHeight - r.height));
    dd.style.left = Math.round(left) + "px";
    dd.style.top = Math.round(top) + "px";

    PS._ctxMenu = dd;
    // bound on the next tick so the click that opened the menu does not close it
    setTimeout(function () {
        document.addEventListener("pointerdown", PS._ctxOutside, true);
        document.addEventListener("keydown", PS._ctxKey, true);
        window.addEventListener("blur", PS.closeContextMenu);
    }, 0);
    return dd;
};

PS.closeContextMenu = function () {
    if (!PS._ctxMenu) { return; }
    PS._ctxMenu.remove();
    PS._ctxMenu = null;
    document.removeEventListener("pointerdown", PS._ctxOutside, true);
    document.removeEventListener("keydown", PS._ctxKey, true);
    window.removeEventListener("blur", PS.closeContextMenu);
};

PS._ctxOutside = function (e) {
    if (PS._ctxMenu && !PS._ctxMenu.contains(e.target)) { PS.closeContextMenu(); }
};

PS._ctxKey = function (e) {
    if (e.key === "Escape") { e.stopPropagation(); PS.closeContextMenu(); }
};

/* ---------- help dialogs ---------- */

PS.showShortcutsDialog = function () {
    var groups = [
        ["Tools", [
            ["V", "Move (Ctrl with any tool: Move while held; Alt-drag moves a copy; right-click picks a layer)"],
            ["M / Shift+M", "Rectangular / Elliptical Marquee"],
            ["L / Shift+L", "Lasso / Polygonal Lasso"],
            ["W", "Magic Wand"],
            ["C", "Crop (Enter commits, Esc cancels)"],
            ["I / Shift+I", "Eyedropper / Ruler / Note"],
            ["J / Shift+J", "Spot Healing / Healing Brush (Alt-click: source)"],
            ["B / Shift+B", "Brush / Pencil"],
            ["S", "Clone Stamp (Alt-click: source)"],
            ["E / Shift+E", "Eraser / Magic Eraser"],
            ["G / Shift+G", "Gradient / Paint Bucket"],
            ["O / Shift+O", "Dodge / Burn / Sponge"],
            ["T / Shift+T", "Horizontal / Vertical Type"],
            ["U", "Shape"],
            ["H / Space", "Hand"],
            ["Z", "Zoom"],
            ["[ / ]", "Brush size (Shift: hardness)"],
            [", / .", "Previous / next brush preset"],
            ["F5", "Brush panel"],
            ["0-9", "Opacity (layer, or the paint tool's); Shift: fill / flow"],
            ["X / D", "Swap / default colors"],
            ["Q", "Quick Mask"],
            ["F / Tab / Shift+Tab", "Screen mode / hide panels / hide the dock"]
        ]],
        ["Edit", [
            ["Ctrl+Z", "Undo the last step; press again to redo it"],
            ["Ctrl+Alt+Z / Ctrl+Shift+Z", "Step backward / step forward (keeps undoing / redoing)"],
            ["Ctrl+X / C / V", "Cut / Copy / Paste (Ctrl+Shift+C: copy merged)"],
            ["Shift+F5", "Fill"],
            ["Alt+Backspace / Ctrl+Backspace", "Fill with foreground / background"],
            ["Delete", "Clear the selection"],
            ["Ctrl+T", "Free Transform (Shift: proportions, Alt: from center, Ctrl: distort)"],
            ["Ctrl+Shift+T / +Alt", "Transform Again / again on a copy"],
            ["Enter / Esc", "Commit / cancel a transform, crop or text"]
        ]],
        ["Image", [
            ["Ctrl+L / M / U / B", "Levels / Curves / Hue/Saturation / Color Balance"],
            ["Ctrl+I / Ctrl+Shift+U", "Invert / Desaturate"],
            ["Ctrl+Shift+L / +Alt", "Auto Tone / Auto Contrast"],
            ["Ctrl+Shift+B", "Auto Color"],
            ["Ctrl+Alt+I / Ctrl+Alt+C", "Image Size / Canvas Size"],
            ["Ctrl+F / Ctrl+Alt+F", "Last filter / last filter with its settings"]
        ]],
        ["Layers", [
            ["Ctrl+Shift+N", "New layer"],
            ["Ctrl+J / Ctrl+Shift+J", "Layer via Copy / Cut (duplicate without a selection)"],
            ["Ctrl+G / Ctrl+Shift+G", "Group / ungroup"],
            ["Ctrl+Alt+G", "Create / release clipping mask"],
            ["Ctrl+] / [ (+Shift)", "Bring forward / send backward (to front / back)"],
            ["Alt+] / Alt+[", "Select the layer above / below (Shift adds)"],
            ["Ctrl+Alt+A", "Select all layers"],
            ["Ctrl+E / Ctrl+Shift+E", "Merge down / merge visible"],
            ["Ctrl+Alt+Shift+E", "Stamp visible"],
            ["Ctrl+click thumbnail", "Load the layer as a selection"],
            ["Alt+click eye", "Show only this layer"],
            ["Double-click layer", "Layer Style"]
        ]],
        ["Select", [
            ["Ctrl+A / Ctrl+D", "Select all / deselect"],
            ["Ctrl+Shift+D", "Reselect"],
            ["Ctrl+Shift+I", "Inverse"],
            ["Shift+F6", "Feather"],
            ["Shift / Alt / Shift+Alt", "Add / subtract / intersect while selecting"]
        ]],
        ["View", [
            ["Ctrl++ / Ctrl+-", "Zoom in / out (Ctrl or Alt + wheel at the pointer)"],
            ["Ctrl+0 / Ctrl+1", "Fit on screen / 100%"],
            ["Ctrl+R", "Rulers"],
            ["Ctrl+' / Ctrl+;", "Grid / guides"],
            ["Ctrl+Shift+;", "Snap"],
            ["Ctrl+H", "Extras"],
            ["Ctrl+2 / 3 / 4 / 5", "Composite / red / green / blue channel"],
            ["F6 / F7 / F8", "Color / Layers / Info panel"]
        ]],
        ["File", [
            ["Ctrl+N / Ctrl+O", "New / open"],
            ["Ctrl+S / Ctrl+Shift+S", "Save / Save As (in the background)"],
            ["Drag a file in", "Open it, or place it as a new layer"]
        ]]
    ];

    PS.dialog({
        title: "Keyboard Shortcuts",
        build: function (body) {
            groups.forEach(function (g) {
                var h = document.createElement("div");
                h.className = "dialog-section-title";
                h.textContent = g[0];
                body.appendChild(h);
                var table = document.createElement("table");
                table.className = "shortcuts";
                g[1].forEach(function (r) {
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
            });
        },
        buttons: [{ label: "Close", primary: true }]
    });
};

PS.showAboutDialog = function () {
    PS.dialog({
        title: "About Pixel Studio",
        build: function (body) {
            body.innerHTML =
                "<p><b>Pixel Studio " + PS.VERSION.replace(/\.0$/, "") + "</b></p>" +
                "<p>A layered image editor for ArozOS.</p>" +
                "<p>Opens and saves layered documents (<code>.psd</code>, <code>.psb</code>) " +
                "with groups, layer and vector masks, clipping masks, every " +
                "blend mode, layer styles, adjustment and fill layers, shape layers, editable " +
                "text and smart objects, rendered on the GPU. OpenRaster (<code>.ora</code>) " +
                "is supported as an open alternative.</p>" +
                "<p>Tools and commands: Free Transform with distort and " +
                "perspective, Crop with rotation, healing, clone, dodge / burn / sponge, " +
                "blur / sharpen / smudge, Quick Mask, Color Range, Image &gt; Adjustments, " +
                "filters, Character and Paragraph panels, vertical type and Warp Text.</p>" +
                "<p>Saving runs in the background, and autosave keeps your work safe " +
                "(File &gt; Save Status). Custom fonts: drop .ttf/.otf/.woff into the app's " +
                "<code>fonts/</code> folder.</p>" +
                "<p>Uses ag-psd and fflate (MIT licensed).</p>";
        },
        buttons: [{ label: "Close", primary: true }]
    });
};
