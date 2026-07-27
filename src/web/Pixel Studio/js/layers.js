/*
    Pixel Studio - layer model and layers panel (bottom-right)
    Layers are offscreen canvases composited bottom-up. Text layers keep
    their text data and are re-rendered procedurally (see text.js).
*/
"use strict";

PS._layerIdSeq = 1;

PS.makeLayer = function (name, w, h) {
    return {
        id: PS._layerIdSeq++,
        name: name,
        canvas: PS.createCanvas(w, h),
        visible: true,
        opacity: 1,
        blend: "source-over",
        type: "raster",   // "raster" | "text"
        text: null        // {content, font, size, color, bold, italic, x, y}
    };
};

PS.blendModes = [
    { v: "source-over", l: "Normal" },
    { v: "multiply", l: "Multiply" },
    { v: "screen", l: "Screen" },
    { v: "overlay", l: "Overlay" },
    { v: "darken", l: "Darken" },
    { v: "lighten", l: "Lighten" },
    { v: "color-dodge", l: "Color Dodge" },
    { v: "color-burn", l: "Color Burn" },
    { v: "hard-light", l: "Hard Light" },
    { v: "soft-light", l: "Soft Light" },
    { v: "difference", l: "Difference" },
    { v: "exclusion", l: "Exclusion" },
    { v: "hue", l: "Hue" },
    { v: "saturation", l: "Saturation" },
    { v: "color", l: "Color" },
    { v: "luminosity", l: "Luminosity" }
];

/* ---------- layer operations ---------- */

PS.addLayer = function (name, opts) {
    opts = opts || {};
    var d = PS.doc;
    var layer = PS.makeLayer(name || ("Layer " + PS._layerIdSeq), d.width, d.height);
    if (opts.canvas) {
        layer.canvas.getContext("2d").drawImage(opts.canvas, 0, 0);
    }
    if (opts.type) { layer.type = opts.type; }
    if (opts.text) { layer.text = opts.text; }

    PS.layerStructure("New Layer", function () {
        var at = (opts.index !== undefined) ? opts.index : d.activeLayer + 1;
        d.layers.splice(at, 0, layer);
        d.activeLayer = at;
    });
    return layer;
};

// doc-space {x,y,w,h} of a layer's actual content (trimmed to opaque pixels
// for raster layers, font metrics for text layers), or null if empty
PS.layerContentBounds = function (layer) {
    if (!layer) { return null; }
    if (layer.type === "text") { return PS.textLayerBounds(layer); }
    return PS.maskBounds(layer.canvas);
};

PS.deleteLayer = function () {
    var d = PS.doc;
    if (d.layers.length <= 1) { PS.toast("Cannot delete the last layer", true); return; }
    PS.layerStructure("Delete Layer", function () {
        d.layers.splice(d.activeLayer, 1);
        d.activeLayer = PS.clamp(d.activeLayer, 0, d.layers.length - 1);
    });
};

// Delete every layer selected in the panel (or just the active one when there
// is no multi-selection).
PS.deleteSelectedLayers = function () {
    var d = PS.doc;
    var sel = PS.selectedLayerIndices();
    if (sel.length < 2) { PS.deleteLayer(); return; }
    if (sel.length >= d.layers.length) { PS.toast("Cannot delete every layer", true); return; }
    PS.layerStructure("Delete Layers", function () {
        // top down, so the indices below stay valid while splicing
        for (var k = sel.length - 1; k >= 0; k--) { d.layers.splice(sel[k], 1); }
        d.activeLayer = PS.clamp(sel[0], 0, d.layers.length - 1);
    });
};

PS.duplicateLayer = function () {
    var d = PS.doc;
    var src = PS.activeLayer();
    var copy = PS.makeLayer(src.name + " copy", d.width, d.height);
    copy.canvas.getContext("2d").drawImage(src.canvas, 0, 0);
    copy.visible = src.visible;
    copy.opacity = src.opacity;
    copy.blend = src.blend;
    copy.type = src.type;
    copy.text = src.text ? JSON.parse(JSON.stringify(src.text)) : null;
    PS.layerStructure("Duplicate Layer", function () {
        d.layers.splice(d.activeLayer + 1, 0, copy);
        d.activeLayer++;
    });
};

PS.mergeDown = function () {
    var d = PS.doc;
    var i = d.activeLayer;
    if (i <= 0) { PS.toast("No layer below to merge into", true); return; }
    var top = d.layers[i];
    var bottom = d.layers[i - 1];

    // merged replacement keeps the bottom layer's blend settings
    var merged = PS.makeLayer(bottom.name, d.width, d.height);
    merged.visible = bottom.visible;
    merged.opacity = 1;
    merged.blend = bottom.blend;
    var ctx = merged.canvas.getContext("2d");
    ctx.globalAlpha = bottom.opacity;
    ctx.drawImage(bottom.canvas, 0, 0);
    ctx.globalAlpha = top.opacity;
    ctx.globalCompositeOperation = top.blend;
    ctx.drawImage(top.canvas, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    PS.layerStructure("Merge Down", function () {
        d.layers.splice(i - 1, 2, merged);
        d.activeLayer = i - 1;
    });
};

// Merge every layer selected in the panel into one, in stacking order, landing
// at the position of the lowest of them. Like Merge Down, the result keeps the
// bottom layer's name / blend settings and is a plain raster layer.
PS.mergeSelectedLayers = function () {
    var d = PS.doc;
    var sel = PS.selectedLayerIndices();
    if (sel.length < 2) { PS.toast("Select two or more layers to merge", true); return; }

    var target = sel[0];
    var bottom = d.layers[target];
    var merged = PS.makeLayer(bottom.name, d.width, d.height);
    merged.visible = bottom.visible;
    merged.opacity = 1;
    merged.blend = bottom.blend;

    var ctx = merged.canvas.getContext("2d");
    sel.forEach(function (i, n) {
        var layer = d.layers[i];
        ctx.globalAlpha = layer.opacity;
        ctx.globalCompositeOperation = (n === 0) ? "source-over" : layer.blend;
        ctx.drawImage(layer.canvas, 0, 0);
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    PS.layerStructure("Merge Layers", function () {
        for (var k = sel.length - 1; k >= 0; k--) { d.layers.splice(sel[k], 1); }
        d.layers.splice(target, 0, merged);
        d.activeLayer = target;
    });
};

// Ctrl+E and the panel's merge button: merge the selection when there is one,
// otherwise fall back to the classic merge-down.
PS.mergeSelectedOrDown = function () {
    if (PS.selectedLayerIndices().length > 1) { PS.mergeSelectedLayers(); }
    else { PS.mergeDown(); }
};

PS.flattenImage = function () {
    var d = PS.doc;
    var flat = PS.makeLayer("Background", d.width, d.height);
    flat.canvas.getContext("2d").drawImage(PS.compositeToCanvas(), 0, 0);
    PS.layerStructure("Flatten Image", function () {
        d.layers = [flat];
        d.activeLayer = 0;
    });
};

PS.moveLayer = function (dir) {
    var d = PS.doc;
    var i = d.activeLayer;
    var j = i + dir;
    if (j < 0 || j >= d.layers.length) { return; }
    PS.layerStructure(dir > 0 ? "Move Layer Up" : "Move Layer Down", function () {
        var tmp = d.layers[i];
        d.layers[i] = d.layers[j];
        d.layers[j] = tmp;
        d.activeLayer = j;
    });
};

// drag-reorder: move layer at from-index to to-index
PS.reorderLayer = function (from, to) {
    var d = PS.doc;
    if (from === to || from < 0 || from >= d.layers.length) { return; }
    to = PS.clamp(to, 0, d.layers.length - 1);
    PS.layerStructure("Reorder Layer", function () {
        var layer = d.layers.splice(from, 1)[0];
        d.layers.splice(to, 0, layer);
        d.activeLayer = to;
    });
};

PS.setActiveLayer = function (i) {
    if (PS.commitTextEdit) { PS.commitTextEdit(); }
    PS.doc.activeLayer = PS.clamp(i, 0, PS.doc.layers.length - 1);
    PS.renderLayersPanel();
};

/* ---------- panel multi-selection (Ctrl / Shift click) ---------- */

// Layers picked in the panel on top of the active one, held as layer ids so a
// reorder cannot scramble them. The active layer always counts as selected, so
// an empty list simply means "just the active layer".
PS.layerSel = [];

// Selected layer indices, ascending, always including the active layer and
// never anything that has since left the stack.
PS.selectedLayerIndices = function () {
    var d = PS.doc;
    if (!d) { return []; }
    var out = [];
    d.layers.forEach(function (layer, i) {
        if (i === d.activeLayer || PS.layerSel.indexOf(layer.id) >= 0) { out.push(i); }
    });
    return out;
};

PS.setLayerSelection = function (indices) {
    var d = PS.doc;
    PS.layerSel = [];
    (indices || []).forEach(function (i) {
        if (d.layers[i]) { PS.layerSel.push(d.layers[i].id); }
    });
};

PS.clearLayerSelection = function () { PS.layerSel = []; };

// Panel row click: plain click selects one layer, Ctrl/Cmd toggles a layer in
// and out of the selection, Shift extends from the active layer.
PS.selectLayerFromClick = function (index, e) {
    var d = PS.doc;
    var sel = PS.selectedLayerIndices();

    if (e && (e.ctrlKey || e.metaKey)) {
        var at = sel.indexOf(index);
        if (at >= 0) {
            if (sel.length === 1) { return; }        // never deselect the last one
            sel.splice(at, 1);
            PS.setLayerSelection(sel);
            // gave up the active layer: anchor on the topmost one still selected
            if (index === d.activeLayer) { PS.setActiveLayer(sel[sel.length - 1]); }
            else { PS.renderLayersPanel(); }
            return;
        }
        sel.push(index);
        PS.setLayerSelection(sel);
        PS.setActiveLayer(index);
        return;
    }

    if (e && e.shiftKey) {
        var lo = Math.min(d.activeLayer, index);
        var hi = Math.max(d.activeLayer, index);
        var range = [];
        for (var i = lo; i <= hi; i++) { range.push(i); }
        PS.setLayerSelection(range);
        PS.setActiveLayer(index);
        return;
    }

    PS.clearLayerSelection();
    PS.setActiveLayer(index);
};

PS.toggleLayerVisible = function (layer) {
    layer.visible = !layer.visible;
    PS.pushHistory(layer.visible ? "Show Layer" : "Hide Layer",
        function () { layer.visible = !layer.visible; },
        function () { layer.visible = !layer.visible; });
    PS.requestRender();
    PS.renderLayersPanel();
};

PS.renameLayer = function (layer, newName) {
    var old = layer.name;
    if (!newName || newName === old) { return; }
    layer.name = newName;
    PS.pushHistory("Rename Layer",
        function () { layer.name = old; },
        function () { layer.name = newName; });
    PS.renderLayersPanel();
};

PS.rasterizeLayer = function (layer) {
    layer = layer || PS.activeLayer();
    if (layer.type !== "text") { PS.toast("Active layer is not a text layer", true); return; }
    var before = { type: layer.type, text: layer.text };
    layer.type = "raster";
    layer.text = null;
    PS.pushHistory("Rasterize Text",
        function () { layer.type = before.type; layer.text = before.text; },
        function () { layer.type = "raster"; layer.text = null; });
    PS.renderLayersPanel();
};

/* ---------- layers panel UI ---------- */

PS._thumbTimer = null;

PS.updateLayerThumbsThrottled = function () {
    if (PS._thumbTimer) { return; }
    PS._thumbTimer = setTimeout(function () {
        PS._thumbTimer = null;
        PS.updateLayerThumbs();
    }, 250);
};

PS.updateLayerThumbs = function () {
    if (!PS.doc) { return; }
    var rows = document.querySelectorAll("#layers-list .layer-row");
    rows.forEach(function (row) {
        var idx = parseInt(row.dataset.index, 10);
        var layer = PS.doc.layers[idx];
        if (!layer) { return; }
        var thumb = row.querySelector("canvas");
        if (!thumb) { return; }
        var tctx = thumb.getContext("2d");
        tctx.clearRect(0, 0, thumb.width, thumb.height);
        var scale = Math.min(thumb.width / PS.doc.width, thumb.height / PS.doc.height);
        var w = PS.doc.width * scale, h = PS.doc.height * scale;
        tctx.drawImage(layer.canvas,
            (thumb.width - w) / 2, (thumb.height - h) / 2, w, h);
    });
};

PS.renderLayersPanel = function () {
    var body = PS.el("panel-layers-body");
    if (!body || !PS.doc) { return; }
    var d = PS.doc;
    body.innerHTML = "";

    // -- blend / opacity controls
    var controls = document.createElement("div");
    controls.className = "layers-controls";
    var active = PS.activeLayer();

    var blendSel = PS.selectInput(PS.blendModes, active.blend);
    blendSel.title = "Blend mode";
    blendSel.addEventListener("change", function () {
        var layer = PS.activeLayer();
        var old = layer.blend;
        var val = blendSel.value;
        layer.blend = val;
        PS.pushHistory("Blend Mode",
            function () { layer.blend = old; },
            function () { layer.blend = val; });
        PS.requestRender();
    });
    controls.appendChild(blendSel);

    // Opacity keeps its slider and pairs it with a value field that can also be
    // typed into or scrolled with the mouse wheel.
    var opSlider = document.createElement("input");
    opSlider.type = "range";
    opSlider.min = 0; opSlider.max = 100;
    opSlider.value = Math.round(active.opacity * 100);
    opSlider.title = "Layer opacity";
    var opBefore = null;     // opacity this run of changes started from
    var opLayer = null;      // and the layer it applies to

    function setOpacity(percent) {
        var layer = PS.activeLayer();
        if (opBefore === null || opLayer !== layer) {
            opBefore = layer.opacity;
            opLayer = layer;
        }
        layer.opacity = percent / 100;
        PS.requestRender();
    }
    // fold the whole run - a drag, a burst of wheel steps, a typed value - into
    // one undo entry against the layer it started on
    function commitOpacity() {
        if (commitTimer) { clearTimeout(commitTimer); commitTimer = null; }
        var layer = opLayer;
        var oldV = opBefore;
        opBefore = null;
        opLayer = null;
        if (!layer || oldV === null || oldV === layer.opacity) { return; }
        var newV = layer.opacity;
        PS.pushHistory("Layer Opacity",
            function () { layer.opacity = oldV; },
            function () { layer.opacity = newV; });
    }
    // typing and wheel steps have no "release" to commit on, so they settle on
    // a short idle timer instead
    var commitTimer = null;
    function commitSoon() {
        if (commitTimer) { clearTimeout(commitTimer); }
        commitTimer = setTimeout(commitOpacity, 500);
    }

    var opNum = PS.ui.numberField(Math.round(active.opacity * 100), 0, 100, 1, function (v) {
        opSlider.value = v;
        setOpacity(v);
        commitSoon();
    });
    opNum.className = "layers-opacity-num";
    opNum.title = "Layer opacity - type a value or scroll the mouse wheel over it";

    opSlider.addEventListener("input", function () {
        var v = parseInt(opSlider.value, 10);
        opNum.value = v;
        setOpacity(v);
    });
    opSlider.addEventListener("change", commitOpacity);
    PS.ui.wheelStep(opSlider, 0, 100, 1, function (v) {
        opNum.value = v;
        setOpacity(v);
        commitSoon();
    });
    controls.appendChild(opSlider);
    controls.appendChild(opNum);
    body.appendChild(controls);

    // -- layer rows (top layer first)
    var list = document.createElement("div");
    list.id = "layers-list";
    for (var i = d.layers.length - 1; i >= 0; i--) {
        list.appendChild(PS._buildLayerRow(d.layers[i], i));
    }
    body.appendChild(list);

    // -- footer buttons
    var footer = document.createElement("div");
    footer.className = "layers-footer";
    [
        ["+", "New layer (Ctrl+Shift+N)", function () { PS.addLayer(); }],
        ["⧉", "Duplicate layer (Ctrl+J)", function () { PS.duplicateLayer(); }],
        ["▲", "Move layer up", function () { PS.moveLayer(1); }],
        ["▼", "Move layer down", function () { PS.moveLayer(-1); }],
        ["⇊", "Merge selected layers / merge down (Ctrl+E)", function () { PS.mergeSelectedOrDown(); }],
        ['<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></svg>',
            "Delete selected layer(s)", function () { PS.deleteSelectedLayers(); }]
    ].forEach(function (def) {
        var btn = document.createElement("button");
        btn.innerHTML = def[0];
        btn.title = def[1];
        btn.addEventListener("click", def[2]);
        footer.appendChild(btn);
    });
    body.appendChild(footer);

    PS.updateLayerThumbs();
};

// Right-click menu for the layers list. Merge only shows up once more than one
// layer is selected; everything else acts on the row that was clicked.
PS.showLayerContextMenu = function (x, y) {
    var d = PS.doc;
    var sel = PS.selectedLayerIndices();
    var multi = sel.length > 1;

    var items = [
        { label: "Duplicate Layer", shortcut: "Ctrl+J", action: PS.duplicateLayer },
        { sep: true },
        {
            label: "Move Up", action: function () { PS.moveLayer(1); },
            enabled: function () { return d.activeLayer < d.layers.length - 1; }
        },
        {
            label: "Move Down", action: function () { PS.moveLayer(-1); },
            enabled: function () { return d.activeLayer > 0; }
        }
    ];

    if (multi) {
        items.push({ sep: true });
        items.push({
            label: "Merge " + sel.length + " Layers", shortcut: "Ctrl+E",
            action: PS.mergeSelectedLayers
        });
    }

    items.push({ sep: true });
    items.push({
        label: multi ? "Delete " + sel.length + " Layers" : "Delete Layer",
        action: PS.deleteSelectedLayers,
        enabled: function () { return d.layers.length > sel.length; }
    });

    PS.contextMenu(x, y, items);
};

PS._buildLayerRow = function (layer, index) {
    var d = PS.doc;
    var multiSel = PS.selectedLayerIndices();
    var row = document.createElement("div");
    row.className = "layer-row"
        + (index === d.activeLayer ? " active" : "")
        + (multiSel.length > 1 && multiSel.indexOf(index) >= 0 ? " selected" : "");
    row.dataset.index = index;
    row.draggable = true;

    var eye = document.createElement("div");
    eye.className = "layer-eye";
    eye.innerHTML = layer.visible
        ? '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>'
        : "—";
    eye.title = "Toggle visibility";
    eye.addEventListener("click", function (e) {
        e.stopPropagation();
        PS.toggleLayerVisible(layer);
    });
    row.appendChild(eye);

    var thumbWrap = document.createElement("div");
    thumbWrap.className = "layer-thumb";
    var thumb = document.createElement("canvas");
    thumb.width = 42; thumb.height = 32;
    thumbWrap.appendChild(thumb);
    row.appendChild(thumbWrap);

    var name = document.createElement("div");
    name.className = "layer-name" + (layer.type === "text" ? " text-type" : "");
    name.textContent = (layer.type === "text" ? "T " : "") + layer.name;
    name.title = "Double-click to rename";
    row.appendChild(name);

    row.addEventListener("click", function (e) { PS.selectLayerFromClick(index, e); });

    row.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        // right-clicking outside the selection replaces it; inside it, the row
        // just becomes the anchor and the rest of the selection is kept
        if (PS.selectedLayerIndices().indexOf(index) < 0) { PS.clearLayerSelection(); }
        PS.setActiveLayer(index);
        PS.showLayerContextMenu(e.clientX, e.clientY);
    });

    row.addEventListener("dblclick", function () {
        if (layer.type === "text" && PS.startTextEditOnLayer) {
            PS.setActiveLayer(index);
            PS.startTextEditOnLayer(layer);
            return;
        }
        // inline rename
        name.innerHTML = "";
        var inp = document.createElement("input");
        inp.value = layer.name;
        name.appendChild(inp);
        inp.focus();
        inp.select();
        function done() { PS.renameLayer(layer, inp.value.trim()); PS.renderLayersPanel(); }
        inp.addEventListener("blur", done);
        inp.addEventListener("keydown", function (e) {
            e.stopPropagation();
            if (e.key === "Enter") { inp.blur(); }
            if (e.key === "Escape") { inp.removeEventListener("blur", done); PS.renderLayersPanel(); }
        });
    });

    // drag to reorder
    row.addEventListener("dragstart", function (e) {
        e.dataTransfer.setData("text/plain", String(index));
        e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragover", function (e) {
        e.preventDefault();
        var rect = row.getBoundingClientRect();
        var topHalf = e.clientY < rect.top + rect.height / 2;
        row.classList.toggle("drag-over-top", topHalf);
        row.classList.toggle("drag-over-bottom", !topHalf);
    });
    row.addEventListener("dragleave", function () {
        row.classList.remove("drag-over-top", "drag-over-bottom");
    });
    row.addEventListener("drop", function (e) {
        e.preventDefault();
        row.classList.remove("drag-over-top", "drag-over-bottom");
        var from = parseInt(e.dataTransfer.getData("text/plain"), 10);
        if (isNaN(from)) { return; }
        var rect = row.getBoundingClientRect();
        var topHalf = e.clientY < rect.top + rect.height / 2;
        // list is rendered top-first; dropping on the top half of a row means
        // "place above this row" = higher index in the layers array
        var to = topHalf ? index : index - 1;
        if (from < to) { /* removing shifts target down */ }
        else if (from > to) { to = to + 1; }
        else { return; }
        PS.reorderLayer(from, to);
    });

    return row;
};
