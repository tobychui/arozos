/*
    Pixel Studio - undo/redo history
    Command-based: every undoable action pushes {label, undo, redo} closures.
    Pixel edits snapshot only the affected layer canvas to keep memory bounded.
*/
"use strict";

PS.history = {
    stack: [],   // [{label, undo, redo}]
    index: -1,   // points at the last applied entry
    limit: 40
};

PS.pushHistory = function (label, undoFn, redoFn) {
    var h = PS.history;
    // drop any redo branch
    h.stack.length = h.index + 1;
    h.stack.push({ label: label, undo: undoFn, redo: redoFn });
    if (h.stack.length > h.limit) {
        h.stack.shift();
    }
    h.index = h.stack.length - 1;
    if (undoFn) { PS.markDirty(); }
    PS.renderHistoryPanel();
};

PS.canUndo = function () {
    return PS.history.index > 0 && !!PS.history.stack[PS.history.index].undo;
};

PS.canRedo = function () {
    return PS.history.index < PS.history.stack.length - 1;
};

PS.undo = function () {
    if (!PS.canUndo()) { return; }
    var entry = PS.history.stack[PS.history.index];
    entry.undo();
    PS.history.index--;
    PS.afterHistoryJump();
};

PS.redo = function () {
    if (!PS.canRedo()) { return; }
    PS.history.index++;
    var entry = PS.history.stack[PS.history.index];
    if (entry.redo) { entry.redo(); }
    PS.afterHistoryJump();
};

PS.afterHistoryJump = function () {
    PS.markDirty();
    PS.requestRender();
    PS.renderLayersPanel();
    PS.renderHistoryPanel();
    PS.selectionViewChanged();
};

// jump to an absolute history index (history panel click)
PS.jumpHistory = function (target) {
    var guard = 200;
    while (PS.history.index > target && PS.canUndo() && guard-- > 0) { PS.undo(); }
    while (PS.history.index < target && PS.canRedo() && guard-- > 0) { PS.redo(); }
};

/* ---- helpers for layer pixel edits ---- */

// call before painting: returns snapshot
PS.snapshotLayer = function (layer) {
    return PS.cloneCanvas(layer.canvas);
};

// call after painting finished
PS.commitLayerCanvas = function (label, layer, beforeCanvas) {
    var afterCanvas = PS.cloneCanvas(layer.canvas);
    PS.pushHistory(label,
        function () { PS.restoreLayerCanvas(layer, beforeCanvas); },
        function () { PS.restoreLayerCanvas(layer, afterCanvas); });
};

PS.restoreLayerCanvas = function (layer, snapshot) {
    layer.canvas.width = snapshot.width;
    layer.canvas.height = snapshot.height;
    var ctx = layer.canvas.getContext("2d");
    ctx.clearRect(0, 0, snapshot.width, snapshot.height);
    ctx.drawImage(snapshot, 0, 0);
};

/* ---- helper for structural layer-stack changes ---- */

// Wraps fn() that mutates PS.doc.layers / activeLayer. Layer objects must be
// treated as immutable by fn (replace, don't repaint, when contents change).
PS.layerStructure = function (label, fn) {
    var before = { layers: PS.doc.layers.slice(), active: PS.doc.activeLayer };
    fn();
    var after = { layers: PS.doc.layers.slice(), active: PS.doc.activeLayer };
    PS.pushHistory(label,
        function () {
            PS.doc.layers = before.layers.slice();
            PS.doc.activeLayer = before.active;
        },
        function () {
            PS.doc.layers = after.layers.slice();
            PS.doc.activeLayer = after.active;
        });
    PS.requestRender();
    PS.renderLayersPanel();
};

/* ---- history panel ---- */

PS.renderHistoryPanel = function () {
    var body = PS.el("panel-history-body");
    if (!body) { return; }
    body.innerHTML = "";
    PS.history.stack.forEach(function (entry, i) {
        var div = document.createElement("div");
        div.className = "history-entry" +
            (i === PS.history.index ? " current" : "") +
            (i > PS.history.index ? " future" : "");
        div.textContent = entry.label;
        div.addEventListener("click", function () { PS.jumpHistory(i); });
        body.appendChild(div);
    });
    body.scrollTop = body.scrollHeight;
};
