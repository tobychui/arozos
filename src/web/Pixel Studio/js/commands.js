/*
    Pixel Studio - menu and keyboard commands

    Menu and keyboard commands that are not tied to one tool:
        layers      Reselect, All Layers, adjacent layer (Alt+[ ]), Arrange,
                    Layer via Copy / Cut, number keys set opacity
        view        Grid, guide visibility, Extras, screen modes (F), hiding
                    the panels (Tab), Quick Mask mode (Q)
        image       Image > Adjustments applied to pixels with the same
                    editors as the adjustment layers, Auto Tone / Contrast /
                    Color, Invert, Desaturate, Equalize
        edit        Fill and Stroke dialogs
        select      Modify (Border, Smooth, Expand, Contract), Grow, Similar,
                    Color Range
*/
"use strict";

/* ============================================================
   LAYERS
   ============================================================ */

// Ctrl+Shift+D: bring back the selection the last Deselect dropped
PS.reselect = function () {
    var d = PS.doc;
    var last = d && d.lastSelection;
    if (!last || last.mask.width !== d.width || last.mask.height !== d.height) {
        PS.toast("Nothing to reselect", true);
        return;
    }
    PS.setSelection(last.mask, "replace", "Reselect");
};

// Ctrl+Alt+A
PS.selectAllLayers = function () {
    if (!PS.doc) { return; }
    var all = PS.doc.root.children.slice();
    if (!all.length) { return; }
    PS.setLayerSelection(all);
    if (all.indexOf(PS.doc.active) < 0) { PS.doc.active = all[all.length - 1]; }
    PS.renderLayersPanel();
};

PS.deselectLayers = function () {
    PS.clearLayerSelection();
    PS.renderLayersPanel();
};

// Alt+] / Alt+[: the layer above / below in the panel (Shift adds it to the
// layer selection)
PS.selectAdjacentLayer = function (dir, extend) {
    var rows = PS.layerDisplayList();
    var a = PS.activeLayer();
    var i = -1;
    for (var k = 0; k < rows.length; k++) { if (rows[k].layer === a) { i = k; break; } }
    var j = i - dir;   // rows run top first
    if (i < 0 || j < 0 || j >= rows.length) { return; }
    var next = rows[j].layer;
    if (extend) {
        var sel = PS.selectedLayers();
        if (sel.indexOf(next) < 0) { sel.push(next); }
        PS.setLayerSelection(sel);
    } else {
        PS.clearLayerSelection();
    }
    PS.setActiveLayer(next, false);
};

// Layer > Arrange > Bring to Front / Send to Back (Ctrl+Shift+] / [)
PS.arrangeLayer = function (where) {
    var d = PS.doc;
    var layers = PS.topLevelSelected();
    if (!layers.length) { return; }
    if (where === "forward" || where === "backward") { PS.moveLayer(where === "forward" ? 1 : -1); return; }
    var keep = layers.slice();
    PS.layerStructure(where === "front" ? "Bring to Front" : "Send to Back", function () {
        // bottom first to the top (or top first to the bottom) keeps their order
        var list = where === "front" ? layers.slice() : layers.slice().reverse();
        list.forEach(function (l) {
            var loc = PS.locateLayer(l);
            if (!loc) { return; }
            loc.parent.children.splice(loc.index, 1);
            if (where === "front") { loc.parent.children.push(l); }
            else { loc.parent.children.unshift(l); }
        });
    });
    if (keep.length > 1) { PS.setLayerSelection(keep); PS.renderLayersPanel(); }
    void d;
};

// Ctrl+J with a selection / Ctrl+Shift+J: the selected pixels on a new layer
// right above (one undo step; the selection is dropped)
PS.layerViaCopy = function (cut) {
    var d = PS.doc;
    var layer = PS.activeLayer();
    if (!layer) { return; }
    if (!d.selection) {
        if (cut) { PS.toast("Make a selection first", true); return; }
        PS.duplicateLayer();
        return;
    }
    var target = cut ? PS.requirePaintableLayer() : PS.paintTarget();
    if (!target) { return; }
    if (!target.canvas) { PS.toast("This layer has no pixels to copy", true); return; }
    var grab = PS.getSelectedPixels(target.canvas).canvas;
    var label = cut ? "Layer via Cut" : "Layer via Copy";
    var nl = PS.makeLayer("Layer " + PS._layerIdSeq, d.width, d.height);
    nl.canvas.getContext("2d").drawImage(grab, 0, 0);

    var selBefore = d.selection;
    var structBefore = PS.captureStructure();
    var pxBefore = cut ? PS.snapshotLayer(target) : null;
    if (cut) {
        PS.clearSelectedOnLayer(target);
        PS.touchLayer(target);
    }
    var slot = PS.newLayerSlot();
    if (target.isMaskTarget) {
        var loc = PS.locateLayer(target.owner);
        slot = { parent: loc.parent, index: loc.index + 1 };
    }
    PS.insertLayer(nl, slot.parent, slot.index);
    d.active = nl;
    d.editMask = false;
    d.selection = null;
    var structAfter = PS.captureStructure();
    var pxAfter = cut ? PS.snapshotLayer(target) : null;
    PS.pushHistory(label,
        function () {
            PS.applyStructure(structBefore);
            if (cut) { PS.restoreLayerCanvas(target, pxBefore); }
            PS.doc.selection = selBefore;
        },
        function () {
            PS.applyStructure(structAfter);
            if (cut) { PS.restoreLayerCanvas(target, pxAfter); }
            PS.doc.selection = null;
        });
    PS.clearLayerSelection();
    PS.requestRender();
    PS.renderLayersPanel();
};

// Ctrl+Shift+Alt+E: everything visible merged onto a new layer on top
PS.stampVisible = function () {
    var d = PS.doc;
    if (!d) { return; }
    var layer = PS.rasterizeNodes(d.root.children, "Layer " + PS._layerIdSeq);
    PS.addLayerObject(layer, "Stamp Visible", { parent: d.root, index: d.root.children.length });
    PS.requestRender();
};

/* ---------- number keys: opacity ---------- */

PS.OPACITY_TOOLS = ["brush", "pencil", "eraser", "gradient", "clone", "magic-eraser", "blur", "sharpen", "smudge", "dodge", "burn", "sponge"];
PS._numKey = null;

// 1..9 = 10..90 %, 0 = 100 %, two quick digits = that value ("0","5" = 5 %).
// Paint tools take it as their opacity (Shift: flow); otherwise the selected
// layers get it as opacity (Shift: fill).
PS.numberKeyOpacity = function (n, shift) {
    var now = Date.now();
    var nk = PS._numKey;
    var v;
    if (nk && now - nk.t < 600 && nk.shift === shift) {
        v = nk.n * 10 + n;
        PS._numKey = null;
    } else {
        v = n === 0 ? 100 : n * 10;
        PS._numKey = { n: n, t: now, shift: shift };
    }
    v = PS.clamp(v, 1, 100) / 100;

    if (PS.OPACITY_TOOLS.indexOf(PS.tool) >= 0 && PS.toolOpts[PS.tool]) {
        var o = PS.toolOpts[PS.tool];
        if (shift && o.flow !== undefined) { o.flow = v; }
        else if (o.opacity !== undefined) { o.opacity = v; }
        else if (o.strength !== undefined) { o.strength = v; }
        else if (o.exposure !== undefined) { o.exposure = v; }
        else if (o.flow !== undefined) { o.flow = v; }
        PS.renderOptionsBar();
        PS.savePrefsDebounced();
        return;
    }
    var layers = PS.selectedLayers();
    if (!layers.length) { return; }
    var prop = shift ? "fillOpacity" : "opacity";
    var pending = PS._numOpacity;
    if (!pending || pending.prop !== prop || pending.layers.length !== layers.length ||
        pending.layers.some(function (l, i) { return l !== layers[i]; })) {
        if (pending) { pending.flush(); }
        pending = PS._numOpacity = {
            prop: prop, layers: layers,
            before: layers.map(function (l) { return l[prop]; }),
            timer: null,
            flush: function () {
                var p = this;
                if (p.timer) { clearTimeout(p.timer); p.timer = null; }
                if (PS._numOpacity === p) { PS._numOpacity = null; }
                var after = p.layers.map(function (l) { return l[p.prop]; });
                if (after.every(function (x, i) { return x === p.before[i]; })) { return; }
                var b = p.before;
                PS.pushHistory(p.prop === "opacity" ? "Opacity Change" : "Fill Opacity Change",
                    function () { p.layers.forEach(function (l, i) { l[p.prop] = b[i]; }); PS.requestRender(); },
                    function () { p.layers.forEach(function (l, i) { l[p.prop] = after[i]; }); PS.requestRender(); });
            }
        };
    }
    layers.forEach(function (l) { l[prop] = v; });
    if (pending.timer) { clearTimeout(pending.timer); }
    pending.timer = setTimeout(function () { pending.flush(); }, 700);
    PS.requestRender();
    PS.renderLayersPanel();
};

/* ============================================================
   VIEW: grid, guides, extras, screen modes
   ============================================================ */

PS.gridOn = false;
PS.guidesVisible = true;
PS.extrasVisible = true;
PS.screenMode = 0;

PS.gridSettings = function () {
    var g = (PS.prefs && PS.prefs.grid) || {};
    return {
        every: g.every > 0 ? g.every : 100,
        sub: g.sub > 0 ? Math.round(g.sub) : 4,
        color: g.color || "#8c8c8c",
        style: g.style || "lines"
    };
};

PS.toggleGrid = function () {
    PS.gridOn = !PS.gridOn;
    if (PS.gridOn) { PS.extrasVisible = true; }
    PS.prefs = PS.prefs || {};
    PS.prefs.gridOn = PS.gridOn;
    PS.savePrefsDebounced();
};

PS.toggleGuidesVisible = function () {
    PS.guidesVisible = !PS.guidesVisible;
    if (PS.guidesVisible) { PS.extrasVisible = true; }
};

// Ctrl+H: hide / show selection edges, guides and the grid together
PS.toggleExtras = function () {
    PS.extrasVisible = !PS.extrasVisible;
    if (!PS.extrasVisible) { PS.toast("Extras hidden (Ctrl+H shows them again)"); }
};

// The grid over the document area of the overlay
PS.drawGrid = function (ctx) {
    if (!PS.gridOn || !PS.extrasVisible || !PS.doc) { return; }
    var g = PS.gridSettings();
    var d = PS.doc, z = PS.zoom;
    var o = PS.docToOverlay(0, 0);
    var step = g.every / g.sub;
    var showMinor = step * z >= 5;
    var majorEvery = g.every;
    if (majorEvery * z < 5) { return; }
    var x0 = Math.max(0, Math.floor(-o.x / z)), x1 = Math.min(d.width, Math.ceil((ctx.canvas.width - o.x) / z));
    var y0 = Math.max(0, Math.floor(-o.y / z)), y1 = Math.min(d.height, Math.ceil((ctx.canvas.height - o.y) / z));
    var top = Math.round(o.y + y0 * z), bottom = Math.round(o.y + y1 * z);
    var left = Math.round(o.x + x0 * z), right = Math.round(o.x + x1 * z);
    var minor = new Path2D(), major = new Path2D();
    var unit = showMinor ? step : majorEvery;
    var i, v, sx, sy, isMajor;
    for (i = Math.ceil(x0 / unit); (v = i * unit) <= x1; i++) {
        isMajor = Math.abs(v / majorEvery - Math.round(v / majorEvery)) < 1e-6;
        sx = Math.round(o.x + v * z) + 0.5;
        (isMajor ? major : minor).moveTo(sx, top);
        (isMajor ? major : minor).lineTo(sx, bottom);
    }
    for (i = Math.ceil(y0 / unit); (v = i * unit) <= y1; i++) {
        isMajor = Math.abs(v / majorEvery - Math.round(v / majorEvery)) < 1e-6;
        sy = Math.round(o.y + v * z) + 0.5;
        (isMajor ? major : minor).moveTo(left, sy);
        (isMajor ? major : minor).lineTo(right, sy);
    }
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = g.color;
    if (g.style === "dashed") { ctx.setLineDash([4, 3]); }
    ctx.globalAlpha = 0.45;
    ctx.stroke(minor);
    ctx.globalAlpha = 0.85;
    ctx.stroke(major);
    ctx.restore();
};

// Edit > Preferences > Guides, Grid & Slices (the grid part)
PS.gridPrefsDialog = function () {
    var g = PS.gridSettings();
    var everyIn, subIn, colorIn, styleIn;
    PS.dialog({
        title: "Grid",
        build: function (body) {
            everyIn = PS.dialogRow(body, "Gridline every (px)", PS.numberInput(g.every, 2, 10000));
            subIn = PS.dialogRow(body, "Subdivisions", PS.numberInput(g.sub, 1, 100));
            styleIn = PS.dialogRow(body, "Style", PS.selectInput([{ v: "lines", l: "Lines" }, { v: "dashed", l: "Dashed Lines" }], g.style));
            colorIn = document.createElement("input");
            colorIn.type = "color";
            colorIn.value = g.color;
            PS.dialogRow(body, "Color", colorIn);
        },
        buttons: [
            { label: "Cancel" },
            {
                label: "OK", primary: true, action: function () {
                    PS.prefs = PS.prefs || {};
                    PS.prefs.grid = {
                        every: PS.clamp(parseFloat(everyIn.value) || 100, 2, 10000),
                        sub: PS.clamp(parseInt(subIn.value, 10) || 4, 1, 100),
                        color: colorIn.value, style: styleIn.value
                    };
                    PS.gridOn = true;
                    PS.savePrefsDebounced();
                }
            }
        ]
    });
};

// View > New Guide...
PS.newGuideDialog = function () {
    var orientIn, posIn;
    PS.dialog({
        title: "New Guide",
        build: function (body) {
            orientIn = PS.dialogRow(body, "Orientation", PS.selectInput([{ v: "h", l: "Horizontal" }, { v: "v", l: "Vertical" }], "h"));
            posIn = PS.dialogRow(body, "Position (px)", PS.numberInput(0, -100000, 100000));
        },
        buttons: [
            { label: "Cancel" },
            {
                label: "OK", primary: true, action: function () {
                    PS.guidesVisible = true;
                    PS.addGuide(orientIn.value, parseFloat(posIn.value) || 0);
                }
            }
        ]
    });
};

PS.SCREEN_MODES = ["Standard Screen Mode", "Full Screen Mode With Menu Bar", "Full Screen Mode"];

PS.setScreenMode = function (m) {
    PS.screenMode = m;
    document.body.classList.toggle("screen-full-menu", m === 1);
    document.body.classList.toggle("screen-full", m === 2);
    if (m === 2) { PS.toast("Full Screen Mode - F switches modes, Tab shows the panels"); }
    PS.updateScreenModeButton();
    PS.relayout();
};

PS.cycleScreenMode = function () { PS.setScreenMode((PS.screenMode + 1) % 3); };

// Tab: hide / show the toolbar, options bar and panels (Shift+Tab: panels only)
PS.toggleUiPanels = function (dockOnly) {
    var b = document.body;
    if (b.classList.contains("screen-full")) {
        b.classList.toggle("screen-full-ui");
    } else if (dockOnly) {
        b.classList.toggle("dock-hidden");
    } else {
        var hide = !(b.classList.contains("ui-hidden"));
        b.classList.toggle("ui-hidden", hide);
        b.classList.remove("dock-hidden");
    }
    PS.relayout();
};

// the workspace changed size: keep the canvas positioned
PS.relayout = function () {
    setTimeout(function () {
        if (PS.doc) { PS.setZoom(PS.zoom); }
        // the options bar may have come back at a different width
        PS.renderOptionsBar();
    }, 0);
};

PS.updateScreenModeButton = function () {
    var b = PS.el("screenmode-btn");
    if (b) { b.title = PS.SCREEN_MODES[PS.screenMode] + " (F)"; }
};

/* ============================================================
   QUICK MASK (Q)
   ============================================================ */

// Quick Mask paints the selection: white selects, black masks. The mask is
// a grey canvas shown as a red tint over the unselected area.
PS.quickMaskTarget = function () {
    var q = PS.doc && PS.doc.quickMask;
    return q ? q.target : null;
};

PS.toggleQuickMask = function () {
    var d = PS.doc;
    if (!d) { return; }
    if (PS.transform && PS.transform.active) { PS.transform.commit(); }
    if (d.quickMask) { PS.exitQuickMask(); } else { PS.enterQuickMask(); }
};

PS.enterQuickMask = function () {
    var d = PS.doc;
    var c = PS.createMaskCanvas(d.width, d.height, 0);
    if (d.selection) {
        var white = PS.createCanvas(d.width, d.height);
        var wctx = white.getContext("2d");
        wctx.fillStyle = "#ffffff";
        wctx.fillRect(0, 0, d.width, d.height);
        wctx.globalCompositeOperation = "destination-in";
        wctx.drawImage(d.selection.mask, 0, 0);
        c.getContext("2d").drawImage(white, 0, 0);
    }
    var q = {
        target: {
            isQuickMask: true, id: "quickmask", name: "Quick Mask", kind: "raster",
            canvas: c, rev: 1, visible: true, opacity: 1,
            locks: { transparency: false, pixels: false, position: false }
        },
        tint: null, tintRev: null, tintTime: 0
    };
    var selBefore = d.selection;
    function on() { PS.doc.quickMask = q; PS.doc.selection = null; PS.quickMaskChanged(); }
    function off() { PS.doc.quickMask = null; PS.doc.selection = selBefore; PS.quickMaskChanged(); }
    on();
    PS.pushHistory("Enter Quick Mask", off, on);
};

PS.exitQuickMask = function () {
    var d = PS.doc;
    var q = d.quickMask;
    if (!q) { return; }
    var src = q.target.canvas;
    var w = src.width, h = src.height;
    var px = src.getContext("2d").getImageData(0, 0, w, h).data;
    var out = new ImageData(w, h);
    var o = out.data;
    var any = false;
    for (var i = 0; i < px.length; i += 4) {
        var v = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) * px[i + 3] / 255;
        o[i] = 255; o[i + 1] = 255; o[i + 2] = 255; o[i + 3] = v;
        if (v >= 128) { any = true; }
    }
    var mask = PS.createCanvas(w, h);
    mask.getContext("2d").putImageData(out, 0, 0);
    var selAfter = any ? PS.buildSelectionObject(mask) : null;
    function on() { PS.doc.quickMask = q; PS.doc.selection = null; PS.quickMaskChanged(); }
    function off() { PS.doc.quickMask = null; PS.doc.selection = selAfter; PS.quickMaskChanged(); }
    off();
    PS.pushHistory("Exit Quick Mask", on, off);
};

PS.quickMaskChanged = function () {
    var on = !!(PS.doc && PS.doc.quickMask);
    var b = PS.el("quickmask-btn");
    if (b) {
        b.classList.toggle("active", on);
        b.title = on ? "Edit in Standard Mode (Q)" : "Edit in Quick Mask Mode (Q)";
    }
    document.body.classList.toggle("quickmask-on", on);
    PS.renderLayersPanel();
    PS.updateTitle();
    PS.requestRender();
};

// the red tint, rebuilt when the mask changes (throttled while painting)
PS.drawQuickMask = function (ctx) {
    var q = PS.doc && PS.doc.quickMask;
    if (!q) { return; }
    var t = q.target;
    var live = PS.strokePreview && PS.strokePreview.layer === t;
    var now = performance.now();
    var key = live ? "live" : t.rev;
    if (!q.tint || (q.tintRev !== key && (!live || now - q.tintTime > 90))) {
        var src = live ? PS._bakeStrokePreview(t) : t.canvas;
        var w = src.width, h = src.height;
        var px = src.getContext("2d").getImageData(0, 0, w, h).data;
        var img = new ImageData(w, h);
        var o = img.data;
        for (var i = 0; i < px.length; i += 4) {
            var v = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) * px[i + 3] / 255;
            o[i] = 255; o[i + 1] = 0; o[i + 2] = 0; o[i + 3] = (255 - v) * 0.5;
        }
        if (!q.tint || q.tint.width !== w || q.tint.height !== h) { q.tint = PS.createCanvas(w, h); }
        q.tint.getContext("2d").putImageData(img, 0, 0);
        q.tintRev = key;
        q.tintTime = now;
    }
    var o2 = PS.docToOverlay(0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = PS.zoom < 1;
    ctx.drawImage(q.tint, o2.x, o2.y, q.tint.width * PS.zoom, q.tint.height * PS.zoom);
    ctx.restore();
};

/* ============================================================
   IMAGE > ADJUSTMENTS (destructive)
   ============================================================ */

PS._tempLayerSeq = 0;

// A layer object the renderer can draw but that never enters the document
PS.tempLayer = function (kind, name) {
    var d = PS.doc;
    var l = PS.makeLayer(name || "temp", d.width, d.height, kind);
    PS._layerIdSeq--;
    l.id = -(++PS._tempLayerSeq);
    l._noHistory = true;
    return l;
};

// src canvas run through an adjustment (inside the selection only when one
// is given); null when the GPU path is missing
PS.adjustCanvas = function (src, adj, selMask) {
    if (!PS.renderer.usesGL) { return null; }
    var d = PS.doc;
    var base = PS.tempLayer("raster", "adjust source");
    base.canvas.getContext("2d").drawImage(src, 0, 0);
    var a = PS.tempLayer("adjustment", "adjust");
    a.adjustment = adj;
    if (selMask) {
        a.mask = PS.makeMask(d.width, d.height, 0);
        var tint = PS.createCanvas(d.width, d.height);
        var tctx = tint.getContext("2d");
        tctx.fillStyle = "#ffffff";
        tctx.fillRect(0, 0, d.width, d.height);
        tctx.globalCompositeOperation = "destination-in";
        tctx.drawImage(selMask, 0, 0);
        a.mask.canvas.getContext("2d").drawImage(tint, 0, 0);
    }
    return PS.renderer.compositeCanvas([base, a]);
};

// apply an adjustment to the paint target's pixels, one undo step
PS.applyAdjustmentToTarget = function (target, adj, label) {
    var d = PS.doc;
    var out = PS.adjustCanvas(target.canvas, adj, d.selection ? d.selection.mask : null);
    if (!out) { PS.toast("Adjustments need WebGL2", true); return; }
    var before = PS.snapshotLayer(target);
    var ctx = target.canvas.getContext("2d");
    ctx.clearRect(0, 0, target.canvas.width, target.canvas.height);
    ctx.drawImage(out, 0, 0);
    PS.commitLayerCanvas(label, target, before);
    PS.requestRender();
    PS.updateLayerThumbsThrottled();
};

// the adjustments of Image > Adjustments with their shortcuts
PS.IMAGE_ADJUSTMENTS = [
    ["brightness/contrast", "Brightness/Contrast..."],
    ["levels", "Levels...", "Ctrl+L"],
    ["curves", "Curves...", "Ctrl+M"],
    ["exposure", "Exposure..."],
    null,
    ["vibrance", "Vibrance..."],
    ["hue/saturation", "Hue/Saturation...", "Ctrl+U"],
    ["color balance", "Color Balance...", "Ctrl+B"],
    ["black & white", "Black & White...", "Alt+Shift+Ctrl+B"],
    ["photo filter", "Photo Filter..."],
    ["channel mixer", "Channel Mixer..."],
    ["color lookup", "Color Lookup..."],
    null,
    ["invert", "Invert", "Ctrl+I"],
    ["posterize", "Posterize..."],
    ["threshold", "Threshold..."],
    ["gradient map", "Gradient Map..."],
    ["selective color", "Selective Color..."],
    null,
    ["desaturate", "Desaturate", "Shift+Ctrl+U"],
    ["equalize", "Equalize"]
];

PS.imageAdjustmentMenuItems = function () {
    return PS.IMAGE_ADJUSTMENTS.map(function (a) {
        if (!a) { return { sep: true }; }
        return { label: a[1], shortcut: a[2], action: function () { PS.imageAdjustment(a[0]); } };
    });
};

// Image > Adjustments > (type): settings window with live preview, then the
// result is written into the pixels
PS.imageAdjustment = function (type) {
    if (!PS.doc) { return; }
    if (PS.transform && PS.transform.active) { PS.transform.commit(); }
    var target = PS.requirePaintableLayer();
    if (!target) { return; }
    if (type === "invert") { PS.invertPixels(); return; }
    if (type === "desaturate") { PS.desaturatePixels(); return; }
    if (type === "equalize") { PS.equalizePixels(); return; }
    if (!PS.renderer.usesGL) { PS.toast("Adjustments need WebGL2", true); return; }
    if (PS._adjustPanel) { PS._adjustPanel.close(); }

    var d = PS.doc;
    var holder = PS.tempLayer("adjustment", PS.adjustmentLabel(type));
    holder.adjustment = PS.defaultAdjustment(type);
    var preview = true;
    var queued = false;
    var applied = false;
    var selMask = d.selection ? d.selection.mask : null;

    function refresh() {
        if (queued) { return; }
        queued = true;
        requestAnimationFrame(function () {
            queued = false;
            if (applied || !PS._adjustPanel) { return; }
            if (!preview) { PS.layerOverride = null; PS.requestRender(); return; }
            var out = PS.adjustCanvas(target.canvas, holder.adjustment, selMask);
            PS.layerOverride = out ? { layer: target, canvas: out } : null;
            PS.requestRender();
        });
    }
    holder._onPropChange = refresh;

    function drop() {
        if (PS.layerOverride && PS.layerOverride.layer === target) { PS.layerOverride = null; }
        PS.requestRender();
    }

    var panel = PS.floatingPanel({
        title: PS.adjustmentLabel(type),
        x: Math.max(80, window.innerWidth - 640), y: 110,
        resizable: true,
        build: function (body) {
            body.classList.add("adjust-dialog");
            var props = document.createElement("div");
            props.className = "prop-body";
            body.appendChild(props);
            PS.adjustmentProperties(props, holder);
            var row = document.createElement("label");
            row.className = "adjust-preview";
            var cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = true;
            cb.addEventListener("change", function () { preview = cb.checked; refresh(); });
            row.appendChild(cb);
            row.appendChild(document.createTextNode(" Preview"));
            body.appendChild(row);
        },
        buttons: [
            { label: "Cancel" },
            {
                label: "OK", primary: true, action: function () {
                    applied = true;
                    drop();
                    PS.applyAdjustmentToTarget(target, holder.adjustment, PS.adjustmentLabel(type));
                }
            }
        ],
        onClose: function () {
            PS._adjustPanel = null;
            if (!applied) { drop(); }
        }
    });
    PS._adjustPanel = panel;
    refresh();
};

PS.invertPixels = function () {
    var target = PS.requirePaintableLayer();
    if (!target) { return; }
    var d = PS.doc;
    var before = PS.snapshotLayer(target);
    var c = target.canvas;
    var inv = PS.createCanvas(c.width, c.height);
    var ictx = inv.getContext("2d");
    // white difference inverts the colour, the alpha is put back after
    ictx.drawImage(c, 0, 0);
    ictx.globalCompositeOperation = "difference";
    ictx.fillStyle = "#ffffff";
    ictx.fillRect(0, 0, c.width, c.height);
    ictx.globalCompositeOperation = "destination-in";
    ictx.drawImage(c, 0, 0);
    var ctx = c.getContext("2d");
    if (d.selection) {
        ictx.globalCompositeOperation = "destination-in";
        ictx.drawImage(d.selection.mask, 0, 0);
        ctx.globalCompositeOperation = "destination-out";
        ctx.drawImage(d.selection.mask, 0, 0);
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(inv, 0, 0);
    } else {
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(inv, 0, 0);
    }
    PS.commitLayerCanvas("Invert", target, before);
    PS.requestRender();
    PS.updateLayerThumbsThrottled();
};

PS.desaturatePixels = function () {
    var target = PS.requirePaintableLayer();
    if (!target) { return; }
    var adj = PS.defaultAdjustment("hue/saturation");
    adj.master.saturation = -100;
    PS.applyAdjustmentToTarget(target, adj, "Desaturate");
};

// Pixels of the target inside the selection (or all), sampled for statistics
function adjustSamples(target, maxSamples) {
    var d = PS.doc;
    var w = target.canvas.width, h = target.canvas.height;
    var px = target.canvas.getContext("2d").getImageData(0, 0, w, h).data;
    var sel = d.selection ? d.selection.mask.getContext("2d").getImageData(0, 0, w, h).data : null;
    var stride = Math.max(1, Math.floor(Math.sqrt(w * h / (maxSamples || 1500000))));
    return { px: px, sel: sel, w: w, h: h, stride: stride };
}

function channelHistograms(s) {
    var hr = new Float64Array(256), hg = new Float64Array(256), hb = new Float64Array(256), hl = new Float64Array(256);
    var n = 0;
    for (var y = 0; y < s.h; y += s.stride) {
        for (var x = 0; x < s.w; x += s.stride) {
            var i = (y * s.w + x) * 4;
            var a = s.px[i + 3];
            if (a < 8) { continue; }
            if (s.sel && s.sel[i + 3] < 128) { continue; }
            hr[s.px[i]]++; hg[s.px[i + 1]]++; hb[s.px[i + 2]]++;
            hl[Math.round(s.px[i] * 0.299 + s.px[i + 1] * 0.587 + s.px[i + 2] * 0.114)]++;
            n++;
        }
    }
    return { r: hr, g: hg, b: hb, l: hl, n: n };
}

// the input levels clipping `clip` (fraction) at each end of a histogram
function clipPoints(hist, n, clip) {
    var lim = n * clip, acc = 0, lo = 0, hi = 255;
    for (lo = 0; lo < 255; lo++) { acc += hist[lo]; if (acc > lim) { break; } }
    acc = 0;
    for (hi = 255; hi > 0; hi--) { acc += hist[hi]; if (acc > lim) { break; } }
    if (hi - lo < 2) { return { lo: 0, hi: 255 }; }
    return { lo: lo, hi: hi };
}

// Image > Auto Tone / Auto Contrast / Auto Color (defaults:
// 0.1 % clipping; Auto Color also neutralises the midtones)
PS.autoAdjust = function (mode) {
    var target = PS.requirePaintableLayer();
    if (!target) { return; }
    var s = adjustSamples(target);
    var H = channelHistograms(s);
    if (!H.n) { PS.toast("Nothing to adjust", true); return; }
    var clip = 0.001;
    var adj = PS.defaultAdjustment("levels");
    function setCh(name, p, gamma) {
        adj[name] = { shadowInput: p.lo, highlightInput: p.hi, shadowOutput: 0, highlightOutput: 255, midtoneInput: gamma || 1 };
    }
    if (mode === "contrast") {
        // one range for all channels keeps the colour balance
        var all = new Float64Array(256);
        for (var i = 0; i < 256; i++) { all[i] = H.r[i] + H.g[i] + H.b[i]; }
        setCh("rgb", clipPoints(all, H.n * 3, clip));
    } else {
        var pr = clipPoints(H.r, H.n, clip), pg = clipPoints(H.g, H.n, clip), pb = clipPoints(H.b, H.n, clip);
        if (mode === "color") {
            // gamma per channel so the stretched means meet in the middle
            var mean = function (hist, p) {
                var sum = 0, cnt = 0;
                for (var k = 0; k < 256; k++) {
                    var t = PS.clamp((k - p.lo) / (p.hi - p.lo), 0, 1);
                    sum += t * hist[k]; cnt += hist[k];
                }
                return cnt ? sum / cnt : 0.5;
            };
            var mr = mean(H.r, pr), mg = mean(H.g, pg), mb = mean(H.b, pb);
            var target2 = (mr + mg + mb) / 3;
            var gam = function (m) {
                if (m <= 0.01 || m >= 0.99 || target2 <= 0.01 || target2 >= 0.99) { return 1; }
                return PS.clamp(Math.log(target2) / Math.log(m), 0.5, 2);
            };
            // Levels midtone input is the inverse gamma
            setCh("red", pr, 1 / gam(mr)); setCh("green", pg, 1 / gam(mg)); setCh("blue", pb, 1 / gam(mb));
        } else {
            setCh("red", pr); setCh("green", pg); setCh("blue", pb);
        }
    }
    PS.applyAdjustmentToTarget(target, adj, { tone: "Auto Tone", contrast: "Auto Contrast", color: "Auto Color" }[mode]);
};

// Image > Adjustments > Equalize: brightness values spread evenly
PS.equalizePixels = function () {
    var target = PS.requirePaintableLayer();
    if (!target) { return; }
    var s = adjustSamples(target, 4000000);
    var H = channelHistograms(s);
    if (!H.n) { return; }
    var lut = new Uint8ClampedArray(256), acc = 0;
    for (var i = 0; i < 256; i++) { acc += H.l[i]; lut[i] = Math.round(acc / H.n * 255); }
    var c = target.canvas;
    var before = PS.snapshotLayer(target);
    var img = c.getContext("2d").getImageData(0, 0, c.width, c.height);
    var px = img.data;
    var sel = PS.doc.selection ? PS.doc.selection.mask.getContext("2d").getImageData(0, 0, c.width, c.height).data : null;
    for (var p = 0; p < px.length; p += 4) {
        var wgt = sel ? sel[p + 3] / 255 : 1;
        if (wgt <= 0) { continue; }
        for (var ch = 0; ch < 3; ch++) {
            var v = px[p + ch];
            px[p + ch] = v + (lut[v] - v) * wgt;
        }
    }
    c.getContext("2d").putImageData(img, 0, 0);
    PS.commitLayerCanvas("Equalize", target, before);
    PS.requestRender();
};

/* ============================================================
   IMAGE: rotation, trim, reveal all
   ============================================================ */

// Image > Image Rotation > Arbitrary: the canvas grows to fit
PS.rotateCanvasBy = function (deg) {
    var d = PS.doc;
    var W = d.width, H = d.height;
    var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    if (Math.abs(s) < 1e-9 && Math.abs(c - 1) < 1e-9) { return; }
    var nw = Math.max(1, Math.round(Math.abs(W * c) + Math.abs(H * s)));
    var nh = Math.max(1, Math.round(Math.abs(W * s) + Math.abs(H * c)));
    var m = [c, s, -s, c, nw / 2 - (c * W / 2 - s * H / 2), nh / 2 - (s * W / 2 + c * H / 2)];
    PS.docGeometryOp("Rotate Canvas", function () {
        PS.transformTree(m, nw, nh, { smooth: true });
        d.width = nw;
        d.height = nh;
        d.selection = null;
        PS.renderPendingProcedural();
    });
};

PS.rotateArbitraryDialog = function () {
    var angIn, dirIn;
    PS.dialog({
        title: "Rotate Canvas",
        build: function (body) {
            angIn = PS.dialogRow(body, "Angle (°)", PS.numberInput(0, -359.99, 359.99));
            angIn.step = 0.01;
            dirIn = PS.dialogRow(body, "", PS.selectInput([{ v: "cw", l: "°CW" }, { v: "ccw", l: "°CCW" }], "cw"));
        },
        buttons: [
            { label: "Cancel" },
            {
                label: "OK", primary: true, action: function () {
                    var a = parseFloat(angIn.value) || 0;
                    PS.rotateCanvasBy(dirIn.value === "ccw" ? -a : a);
                }
            }
        ]
    });
};

// crop the document to a rectangle (Trim, Crop tool)
PS.cropDocTo = function (r, label) {
    var d = PS.doc;
    if (r.w < 1 || r.h < 1) { return; }
    PS.docGeometryOp(label || "Crop", function () {
        PS.transformTree([1, 0, 0, 1, -r.x, -r.y], r.w, r.h, {});
        d.width = r.w;
        d.height = r.h;
        d.selection = null;
        PS.renderPendingProcedural();
    });
};

// Image > Trim: cut away transparent (or corner coloured) borders
PS.trimDialog = function () {
    var basedIn, sides = {};
    PS.dialog({
        title: "Trim",
        build: function (body) {
            basedIn = PS.dialogRow(body, "Based On", PS.selectInput([
                { v: "transparent", l: "Transparent Pixels" }, { v: "tl", l: "Top Left Pixel Color" }, { v: "br", l: "Bottom Right Pixel Color" }
            ], "transparent"));
            ["Top", "Bottom", "Left", "Right"].forEach(function (s) {
                var cb = document.createElement("input");
                cb.type = "checkbox";
                cb.checked = true;
                sides[s.toLowerCase()] = cb;
                PS.dialogRow(body, "Trim Away " + s, cb);
            });
        },
        buttons: [
            { label: "Cancel" },
            {
                label: "OK", primary: true, action: function () {
                    var d = PS.doc;
                    var w = d.width, h = d.height;
                    var px = PS.compositeToCanvas().getContext("2d").getImageData(0, 0, w, h).data;
                    var mode = basedIn.value;
                    var ref = mode === "tl" ? 0 : (w * h - 1) * 4;
                    function keep(i) {
                        if (mode === "transparent") { return px[i + 3] > 0; }
                        return Math.abs(px[i] - px[ref]) + Math.abs(px[i + 1] - px[ref + 1]) +
                            Math.abs(px[i + 2] - px[ref + 2]) + Math.abs(px[i + 3] - px[ref + 3]) > 0;
                    }
                    var x0 = w, y0 = h, x1 = -1, y1 = -1;
                    for (var y = 0; y < h; y++) {
                        for (var x = 0; x < w; x++) {
                            if (keep((y * w + x) * 4)) {
                                if (x < x0) { x0 = x; }
                                if (x > x1) { x1 = x; }
                                if (y < y0) { y0 = y; }
                                if (y > y1) { y1 = y; }
                            }
                        }
                    }
                    if (x1 < 0) { PS.toast("Nothing would be left", true); return; }
                    if (!sides.left.checked) { x0 = 0; }
                    if (!sides.top.checked) { y0 = 0; }
                    if (!sides.right.checked) { x1 = w - 1; }
                    if (!sides.bottom.checked) { y1 = h - 1; }
                    if (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1) { PS.toast("Nothing to trim"); return; }
                    PS.cropDocTo({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, "Trim");
                }
            }
        ]
    });
};

// Image > Reveal All: grow the canvas over pixels kept beyond its edges
PS.revealAll = function () {
    var d = PS.doc;
    var x0 = 0, y0 = 0, x1 = d.width, y1 = d.height;
    PS.eachLayer(function (l) {
        var oc = l.offcanvas;
        if (!oc) { return; }
        var b = PS.maskBounds(oc.canvas);
        if (!b) { return; }
        x0 = Math.min(x0, oc.left + b.x); y0 = Math.min(y0, oc.top + b.y);
        x1 = Math.max(x1, oc.left + b.x + b.w); y1 = Math.max(y1, oc.top + b.y + b.h);
    });
    if (x0 === 0 && y0 === 0 && x1 === d.width && y1 === d.height) { PS.toast("Everything is already visible"); return; }
    PS.cropDocTo({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, "Reveal All");
};

/* ============================================================
   EDIT > FILL / STROKE
   ============================================================ */

PS.FILL_CONTENTS = [
    { v: "fg", l: "Foreground Color" }, { v: "bg", l: "Background Color" }, { v: "color", l: "Color..." },
    { v: "black", l: "Black" }, { v: "gray", l: "50% Gray" }, { v: "white", l: "White" }
];

function fillColorOf(v, custom) {
    if (v === "fg") { return PS.fg; }
    if (v === "bg") { return PS.bg; }
    if (v === "black") { return "#000000"; }
    if (v === "gray") { return "#808080"; }
    if (v === "white") { return "#ffffff"; }
    return custom;
}

// Draw `paint` (a doc-sized canvas) onto the target with a blend mode and
// opacity; preserve keeps the target's transparency
PS.paintOntoTarget = function (target, paint, blend, opacity, preserve, label) {
    var c = target.canvas;
    var before = PS.snapshotLayer(target);
    var out = PS.cloneCanvas(c);
    var octx = out.getContext("2d");
    octx.globalAlpha = opacity;
    octx.globalCompositeOperation = PS.canvasBlendOp(blend || "normal");
    octx.drawImage(paint, 0, 0);
    octx.globalAlpha = 1;
    if (preserve || (target.locks && target.locks.transparency)) {
        octx.globalCompositeOperation = "destination-in";
        octx.drawImage(c, 0, 0);
    }
    var ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(out, 0, 0);
    PS.commitLayerCanvas(label, target, before);
    PS.requestRender();
    PS.updateLayerThumbsThrottled();
};

// a dialog section with Mode / Opacity / Preserve Transparency
function blendingRows(body) {
    var modeIn = PS.dialogRow(body, "Mode", PS.selectInput(PS.blendModeOptions(false), "normal"));
    var opIn = PS.dialogRow(body, "Opacity (%)", PS.numberInput(100, 1, 100));
    var pres = document.createElement("input");
    pres.type = "checkbox";
    PS.dialogRow(body, "Preserve Transparency", pres);
    return {
        mode: function () { return modeIn.value; },
        opacity: function () { return PS.clamp(parseFloat(opIn.value) || 100, 1, 100) / 100; },
        preserve: function () { return pres.checked; }
    };
}

// Edit > Fill (Shift+F5)
PS.fillDialog = function () {
    var target = PS.requirePaintableLayer();
    if (!target) { return; }
    var useIn, colorIn, blend;
    PS.dialog({
        title: "Fill",
        build: function (body) {
            useIn = PS.dialogRow(body, "Use", PS.selectInput(PS.FILL_CONTENTS, "fg"));
            colorIn = document.createElement("input");
            colorIn.type = "color";
            colorIn.value = /^#[0-9a-f]{6}$/i.test(PS.fg) ? PS.fg : "#000000";
            var crow = PS.dialogRow(body, "Custom Color", colorIn).parentNode;
            crow.style.display = "none";
            useIn.addEventListener("change", function () { crow.style.display = useIn.value === "color" ? "" : "none"; });
            var h = document.createElement("div");
            h.className = "dialog-section-title";
            h.textContent = "Blending";
            body.appendChild(h);
            blend = blendingRows(body);
        },
        buttons: [
            { label: "Cancel" },
            {
                label: "OK", primary: true, action: function () {
                    var d = PS.doc;
                    var paint = PS.createCanvas(d.width, d.height);
                    var pctx = paint.getContext("2d");
                    pctx.fillStyle = fillColorOf(useIn.value, colorIn.value);
                    pctx.fillRect(0, 0, d.width, d.height);
                    if (d.selection) {
                        pctx.globalCompositeOperation = "destination-in";
                        pctx.drawImage(d.selection.mask, 0, 0);
                    }
                    PS.paintOntoTarget(target, paint, blend.mode(), blend.opacity(), blend.preserve(), "Fill");
                }
            }
        ]
    });
};

// Outline of `mask` (alpha) as a stroke of `width` px: GPU layer-style stroke
// when available (smooth and exact), traced path otherwise
PS.strokeMaskCanvas = function (mask, width, position, color) {
    var d = PS.doc;
    if (PS.renderer.usesGL) {
        var l = PS.tempLayer("raster", "stroke");
        l.canvas.getContext("2d").drawImage(mask, 0, 0);
        l.fillOpacity = 0;
        var rgb = PS.hexToRgb(color) || { r: 0, g: 0, b: 0 };
        l.effects = {
            stroke: [{
                enabled: true, present: true, position: position, size: { units: "Pixels", value: width },
                fillType: "color", color: { r: rgb.r, g: rgb.g, b: rgb.b }, opacity: 1, blendMode: "normal"
            }]
        };
        return PS.renderer.compositeCanvas([l]);
    }
    var sel = PS.buildSelectionObject(mask);
    var out = PS.createCanvas(d.width, d.height);
    if (!sel) { return out; }
    var ctx = out.getContext("2d");
    ctx.strokeStyle = color;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = position === "center" ? width : width * 2;
    ctx.stroke(sel.antPath);
    if (position === "inside") {
        ctx.globalCompositeOperation = "destination-in";
        ctx.drawImage(mask, 0, 0);
    } else if (position === "outside") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.drawImage(mask, 0, 0);
    }
    ctx.globalCompositeOperation = "source-over";
    return out;
};

// Edit > Stroke: around the selection, or the layer's content without one
PS.strokeDialog = function () {
    var target = PS.requirePaintableLayer();
    if (!target) { return; }
    var widthIn, colorIn, locIn, blend;
    PS.dialog({
        title: "Stroke",
        build: function (body) {
            var h0 = document.createElement("div");
            h0.className = "dialog-section-title";
            h0.textContent = "Stroke";
            body.appendChild(h0);
            widthIn = PS.dialogRow(body, "Width (px)", PS.numberInput(PS.prefs.strokeWidth || 1, 1, 250));
            colorIn = document.createElement("input");
            colorIn.type = "color";
            colorIn.value = /^#[0-9a-f]{6}$/i.test(PS.fg) ? PS.fg : "#000000";
            PS.dialogRow(body, "Color", colorIn);
            locIn = PS.dialogRow(body, "Location", PS.selectInput([
                { v: "inside", l: "Inside" }, { v: "center", l: "Center" }, { v: "outside", l: "Outside" }
            ], PS.prefs.strokeLocation || "center"));
            var h = document.createElement("div");
            h.className = "dialog-section-title";
            h.textContent = "Blending";
            body.appendChild(h);
            blend = blendingRows(body);
        },
        buttons: [
            { label: "Cancel" },
            {
                label: "OK", primary: true, action: function () {
                    var d = PS.doc;
                    var mask = d.selection ? d.selection.mask : target.canvas;
                    var wpx = PS.clamp(parseFloat(widthIn.value) || 1, 1, 250);
                    PS.prefs.strokeWidth = wpx;
                    PS.prefs.strokeLocation = locIn.value;
                    var paint = PS.strokeMaskCanvas(mask, wpx, locIn.value, colorIn.value);
                    PS.paintOntoTarget(target, paint, blend.mode(), blend.opacity(), blend.preserve(), "Stroke");
                }
            }
        ]
    });
};

/* ============================================================
   SELECT > MODIFY, GROW, SIMILAR, COLOR RANGE
   ============================================================ */

function selectionAlpha(canvas) {
    // a mask canvas whose alpha is the coverage of `canvas`
    var m = PS.makeMaskCanvas();
    var ctx = m.getContext("2d");
    ctx.drawImage(canvas, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, m.width, m.height);
    ctx.globalCompositeOperation = "source-over";
    return m;
}

function invertedMask(mask) {
    var m = PS.makeMaskCanvas();
    var ctx = m.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, m.width, m.height);
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    return m;
}

PS.expandMask = function (mask, r) {
    // the distance field is measured from pixel centres: half a pixel more
    // makes Expand By 10 grow the edge by exactly ten pixels
    var band = PS.strokeMaskCanvas(mask, r + 0.5, "outside", "#ffffff");
    var out = selectionAlpha(band);
    out.getContext("2d").drawImage(mask, 0, 0);
    return out;
};

PS.contractMask = function (mask, r) {
    return invertedMask(PS.expandMask(invertedMask(mask), r));
};

PS.modifySelection = function (op, amount) {
    var d = PS.doc;
    if (!d.selection) { PS.toast("Make a selection first", true); return; }
    var mask = d.selection.mask, out;
    if (op === "expand") { out = PS.expandMask(mask, amount); }
    else if (op === "contract") { out = PS.contractMask(mask, amount); }
    else if (op === "border") { out = selectionAlpha(PS.strokeMaskCanvas(mask, amount, "center", "#ffffff")); }
    else if (op === "smooth") {
        // blur, then cut at half coverage
        var b = PS.makeMaskCanvas();
        var bctx = b.getContext("2d");
        bctx.filter = "blur(" + amount + "px)";
        bctx.drawImage(mask, 0, 0);
        bctx.filter = "none";
        var img = bctx.getImageData(0, 0, b.width, b.height);
        for (var i = 3; i < img.data.length; i += 4) { img.data[i] = img.data[i] >= 128 ? 255 : 0; }
        bctx.putImageData(img, 0, 0);
        out = b;
    }
    if (!out) { return; }
    PS.setSelection(out, "replace", { expand: "Expand", contract: "Contract", border: "Border", smooth: "Smooth" }[op]);
};

PS.modifySelectionDialog = function (op) {
    var labels = { expand: ["Expand Selection", "Expand By"], contract: ["Contract Selection", "Contract By"],
        border: ["Border Selection", "Width"], smooth: ["Smooth Selection", "Sample Radius"] };
    var inp;
    PS.dialog({
        title: labels[op][0],
        build: function (body) {
            inp = PS.dialogRow(body, labels[op][1] + " (px)", PS.numberInput(op === "border" ? 10 : 2, 1, op === "smooth" ? 100 : 500));
        },
        buttons: [
            { label: "Cancel" },
            { label: "OK", primary: true, action: function () { PS.modifySelection(op, PS.clamp(parseInt(inp.value, 10) || 1, 1, 500)); } }
        ]
    });
};

// Select > Grow (adjacent) / Similar (anywhere): colours within the Magic
// Wand tolerance of the selected ones
PS.growSelection = function (similar) {
    var d = PS.doc;
    if (!d.selection) { PS.toast("Make a selection first", true); return; }
    var w = d.width, h = d.height;
    var src = PS.compositeToCanvas().getContext("2d").getImageData(0, 0, w, h).data;
    var sel = d.selection.mask.getContext("2d").getImageData(0, 0, w, h).data;
    var tol = PS.toolOpts.wand.tolerance;
    var lo = [255, 255, 255], hi = [0, 0, 0];
    var i, c;
    for (i = 0; i < sel.length; i += 4) {
        if (sel[i + 3] < 128) { continue; }
        for (c = 0; c < 3; c++) {
            if (src[i + c] < lo[c]) { lo[c] = src[i + c]; }
            if (src[i + c] > hi[c]) { hi[c] = src[i + c]; }
        }
    }
    for (c = 0; c < 3; c++) { lo[c] -= tol; hi[c] += tol; }
    function ok(p) {
        var q = p * 4;
        return src[q] >= lo[0] && src[q] <= hi[0] && src[q + 1] >= lo[1] && src[q + 1] <= hi[1] &&
            src[q + 2] >= lo[2] && src[q + 2] <= hi[2];
    }
    var on = new Uint8Array(w * h);
    var p;
    if (similar) {
        for (p = 0; p < w * h; p++) { if (sel[p * 4 + 3] >= 128 || ok(p)) { on[p] = 1; } }
    } else {
        var stack = new Int32Array(w * h), sp = 0;
        for (p = 0; p < w * h; p++) { if (sel[p * 4 + 3] >= 128) { on[p] = 1; stack[sp++] = p; } }
        while (sp > 0) {
            p = stack[--sp];
            var x = p % w, y = (p - x) / w;
            if (x > 0 && !on[p - 1] && ok(p - 1)) { on[p - 1] = 1; stack[sp++] = p - 1; }
            if (x < w - 1 && !on[p + 1] && ok(p + 1)) { on[p + 1] = 1; stack[sp++] = p + 1; }
            if (y > 0 && !on[p - w] && ok(p - w)) { on[p - w] = 1; stack[sp++] = p - w; }
            if (y < h - 1 && !on[p + w] && ok(p + w)) { on[p + w] = 1; stack[sp++] = p + w; }
        }
    }
    var mask = PS.makeMaskCanvas();
    var mctx = mask.getContext("2d");
    var img = mctx.createImageData(w, h);
    for (p = 0; p < w * h; p++) {
        var a = on[p] ? 255 : 0;
        // keep the soft edge of the original selection
        if (sel[p * 4 + 3] > a) { a = sel[p * 4 + 3]; }
        img.data[p * 4] = 255; img.data[p * 4 + 1] = 255; img.data[p * 4 + 2] = 255; img.data[p * 4 + 3] = a;
    }
    mctx.putImageData(img, 0, 0);
    PS.setSelection(mask, "replace", similar ? "Similar" : "Grow");
};

// Select > Modify > Feather (Shift+F6)
PS.featherDialog = function () {
    if (!PS.doc || !PS.doc.selection) { PS.toast("Make a selection first", true); return; }
    var rIn;
    PS.dialog({
        title: "Feather Selection",
        build: function (body) {
            rIn = PS.dialogRow(body, "Feather Radius (px)", PS.numberInput(PS.prefs.featherRadius || 4, 1, 250));
        },
        buttons: [
            { label: "Cancel" },
            {
                label: "OK", primary: true, action: function () {
                    var r = PS.clamp(parseFloat(rIn.value) || 4, 0.2, 250);
                    PS.prefs.featherRadius = r;
                    PS.featherSelection(r);
                }
            }
        ]
    });
};

/* ---------- Color Range ---------- */

PS.COLOR_RANGE_SETS = [
    { v: "sampled", l: "Sampled Colors" }, { v: "reds", l: "Reds" }, { v: "yellows", l: "Yellows" },
    { v: "greens", l: "Greens" }, { v: "cyans", l: "Cyans" }, { v: "blues", l: "Blues" },
    { v: "magentas", l: "Magentas" }, { v: "highlights", l: "Highlights" }, { v: "midtones", l: "Midtones" },
    { v: "shadows", l: "Shadows" }
];

// coverage 0..1 of one pixel for a Color Range setting
function colorRangeWeight(r, g, b, st) {
    if (st.set === "sampled") {
        if (!st.samples.length) { return 0; }
        var best = 1e9;
        for (var i = 0; i < st.samples.length; i++) {
            var s = st.samples[i];
            var dr = r - s[0], dg = g - s[1], db = b - s[2];
            var dd = Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11) * 1.5;
            if (dd < best) { best = dd; }
        }
        var f = Math.max(1, st.fuzziness);
        return best <= f * 0.5 ? 1 : Math.max(0, 1 - (best - f * 0.5) / (f * 0.5));
    }
    var l = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    if (st.set === "highlights") { return PS.clamp((l - 0.6) / 0.15, 0, 1); }
    if (st.set === "shadows") { return PS.clamp((0.4 - l) / 0.15, 0, 1); }
    if (st.set === "midtones") { return PS.clamp(1 - Math.abs(l - 0.5) / 0.3, 0, 1); }
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn < 8) { return 0; }
    var hh;
    if (mx === r) { hh = ((g - b) / (mx - mn)) * 60; }
    else if (mx === g) { hh = (2 + (b - r) / (mx - mn)) * 60; }
    else { hh = (4 + (r - g) / (mx - mn)) * 60; }
    if (hh < 0) { hh += 360; }
    var centre = { reds: 0, yellows: 60, greens: 120, cyans: 180, blues: 240, magentas: 300 }[st.set];
    var dh = Math.abs(hh - centre);
    if (dh > 180) { dh = 360 - dh; }
    var sat = (mx - mn) / 255;
    return PS.clamp((1 - Math.max(0, dh - 15) / 30), 0, 1) * PS.clamp(sat * 3, 0, 1);
}

PS.colorRangeMask = function (st, px, w, h) {
    var img = new ImageData(w, h);
    var o = img.data;
    for (var i = 0; i < px.length; i += 4) {
        var v = colorRangeWeight(px[i], px[i + 1], px[i + 2], st);
        if (px[i + 3] < 8) { v = 0; }
        if (st.invert) { v = 1 - v; }
        o[i] = 255; o[i + 1] = 255; o[i + 2] = 255; o[i + 3] = Math.round(v * 255);
    }
    return img;
};

PS.colorRangeDialog = function () {
    var d = PS.doc;
    if (!d) { return; }
    var w = d.width, h = d.height;
    var px = PS.compositeToCanvas().getContext("2d").getImageData(0, 0, w, h).data;
    var st = { set: "sampled", fuzziness: 40, samples: [], invert: false };
    var c0 = PS.hexToRgb(PS.fg);
    if (c0) { st.samples.push([c0.r, c0.g, c0.b]); }
    var previewCanvas, fuzzRow, timer = null, pickMode = "set";

    // small preview: the mask in grey
    var pw = Math.min(220, w), ph = Math.round(pw * h / w);
    if (ph > 220) { ph = 220; pw = Math.round(ph * w / h); }
    var small = PS.createCanvas(pw, ph);
    small.getContext("2d").drawImage(PS.compositeToCanvas(), 0, 0, pw, ph);
    var spx = small.getContext("2d").getImageData(0, 0, pw, ph).data;

    function updatePreview() {
        if (timer) { return; }
        timer = setTimeout(function () {
            timer = null;
            var img = PS.colorRangeMask(st, spx, pw, ph);
            var o = img.data;
            for (var i = 0; i < o.length; i += 4) { var v = o[i + 3]; o[i] = v; o[i + 1] = v; o[i + 2] = v; o[i + 3] = 255; }
            previewCanvas.getContext("2d").putImageData(img, 0, 0);
            fuzzRow.style.display = st.set === "sampled" ? "" : "none";
        }, 30);
    }

    // clicks on the canvas sample colours while the window is open
    PS.colorRangePick = function (pt, e) {
        var x = Math.floor(pt.x), y = Math.floor(pt.y);
        if (x < 0 || y < 0 || x >= w || y >= h) { return; }
        var i = (y * w + x) * 4;
        var col = [px[i], px[i + 1], px[i + 2]];
        st.set = "sampled";
        if (setIn) { setIn.value = "sampled"; }
        var mode = e.shiftKey ? "add" : (e.altKey ? "subtract" : pickMode);
        if (mode === "add") { st.samples.push(col); }
        else if (mode === "subtract") {
            st.samples = st.samples.filter(function (s) {
                return Math.abs(s[0] - col[0]) + Math.abs(s[1] - col[1]) + Math.abs(s[2] - col[2]) > st.fuzziness;
            });
        } else { st.samples = [col]; }
        updatePreview();
    };

    var setIn = null;
    PS.floatingPanel({
        title: "Color Range",
        x: Math.max(80, window.innerWidth - 560), y: 110,
        build: function (body) {
            body.classList.add("color-range");
            setIn = PS.dialogRow(body, "Select", PS.selectInput(PS.COLOR_RANGE_SETS, st.set));
            setIn.addEventListener("change", function () { st.set = setIn.value; updatePreview(); });
            var fz = PS.numberInput(st.fuzziness, 0, 200);
            fz.addEventListener("input", function () { st.fuzziness = PS.clamp(parseFloat(fz.value) || 0, 0, 200); updatePreview(); });
            var range = document.createElement("input");
            range.type = "range"; range.min = 0; range.max = 200; range.value = st.fuzziness;
            range.addEventListener("input", function () { st.fuzziness = parseFloat(range.value); fz.value = range.value; updatePreview(); });
            fuzzRow = document.createElement("div");
            fuzzRow.className = "form-row";
            var fl = document.createElement("label");
            fl.textContent = "Fuzziness";
            fuzzRow.appendChild(fl);
            fuzzRow.appendChild(range);
            fuzzRow.appendChild(fz);
            body.appendChild(fuzzRow);
            var tools = document.createElement("div");
            tools.className = "cr-pickers";
            [["set", "Sample a color (click the image)"], ["add", "Add to sample (Shift+click)"], ["subtract", "Subtract from sample (Alt+click)"]].forEach(function (m) {
                var b = document.createElement("button");
                b.type = "button";
                b.className = "opt-icon-btn" + (m[0] === pickMode ? " active" : "");
                b.title = m[1];
                b.innerHTML = '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M14 4l6 6-2 2-6-6z"/><path d="M13 7 5 15l-1 5 5-1 8-8"/>' +
                    (m[0] === "add" ? '<path d="M3 4h6M6 1v6"/>' : (m[0] === "subtract" ? '<path d="M3 4h6"/>' : "")) + "</svg>";
                b.addEventListener("click", function () {
                    pickMode = m[0];
                    Array.prototype.forEach.call(tools.children, function (x) { x.classList.remove("active"); });
                    b.classList.add("active");
                });
                tools.appendChild(b);
            });
            body.appendChild(tools);
            previewCanvas = PS.createCanvas(pw, ph);
            previewCanvas.className = "cr-preview";
            body.appendChild(previewCanvas);
            var inv = document.createElement("label");
            inv.className = "adjust-preview";
            var ic = document.createElement("input");
            ic.type = "checkbox";
            ic.addEventListener("change", function () { st.invert = ic.checked; updatePreview(); });
            inv.appendChild(ic);
            inv.appendChild(document.createTextNode(" Invert"));
            body.appendChild(inv);
            updatePreview();
        },
        buttons: [
            { label: "Cancel" },
            {
                label: "OK", primary: true, action: function () {
                    var img = PS.colorRangeMask(st, px, w, h);
                    var m = PS.makeMaskCanvas();
                    m.getContext("2d").putImageData(img, 0, 0);
                    PS.setSelection(m, "replace", "Color Range");
                }
            }
        ],
        onClose: function () { PS.colorRangePick = null; }
    });
};
