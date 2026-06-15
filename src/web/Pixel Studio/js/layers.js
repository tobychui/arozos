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

PS.deleteLayer = function () {
    var d = PS.doc;
    if (d.layers.length <= 1) { PS.toast("Cannot delete the last layer", true); return; }
    PS.layerStructure("Delete Layer", function () {
        d.layers.splice(d.activeLayer, 1);
        d.activeLayer = PS.clamp(d.activeLayer, 0, d.layers.length - 1);
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

    var opSlider = document.createElement("input");
    opSlider.type = "range";
    opSlider.min = 0; opSlider.max = 100;
    opSlider.value = Math.round(active.opacity * 100);
    opSlider.title = "Layer opacity";
    var opNum = document.createElement("span");
    opNum.className = "layers-opacity-num";
    opNum.textContent = Math.round(active.opacity * 100) + "%";
    var opBefore = null;
    opSlider.addEventListener("input", function () {
        var layer = PS.activeLayer();
        if (opBefore === null) { opBefore = layer.opacity; }
        layer.opacity = parseInt(opSlider.value, 10) / 100;
        opNum.textContent = opSlider.value + "%";
        PS.requestRender();
    });
    opSlider.addEventListener("change", function () {
        var layer = PS.activeLayer();
        var oldV = opBefore === null ? layer.opacity : opBefore;
        var newV = layer.opacity;
        opBefore = null;
        if (oldV !== newV) {
            PS.pushHistory("Layer Opacity",
                function () { layer.opacity = oldV; },
                function () { layer.opacity = newV; });
        }
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
        ["⇊", "Merge down (Ctrl+E)", function () { PS.mergeDown(); }],
        ["🗑", "Delete layer", function () { PS.deleteLayer(); }]
    ].forEach(function (def) {
        var btn = document.createElement("button");
        btn.textContent = def[0];
        btn.title = def[1];
        btn.addEventListener("click", def[2]);
        footer.appendChild(btn);
    });
    body.appendChild(footer);

    PS.updateLayerThumbs();
};

PS._buildLayerRow = function (layer, index) {
    var d = PS.doc;
    var row = document.createElement("div");
    row.className = "layer-row" + (index === d.activeLayer ? " active" : "");
    row.dataset.index = index;
    row.draggable = true;

    var eye = document.createElement("div");
    eye.className = "layer-eye";
    eye.textContent = layer.visible ? "👁" : "—";
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

    row.addEventListener("click", function () { PS.setActiveLayer(index); });

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
