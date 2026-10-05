/*
    Pixel Studio - undo/redo history
    Command-based: every undoable action pushes {label, undo, redo} closures.
    Pixel edits snapshot only the affected layer canvas to keep memory bounded.
*/
"use strict";

PS.history = {
    stack: [],   // [{label, undo, redo}]
    index: -1,   // points at the last applied entry
    limit: 40,
    lastStep: null  // "back" / "forward": the last keyboard step (what Ctrl+Z toggles)
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
    h.lastStep = null;
    if (undoFn) { PS.markDirty(); PS.historyChanged(); }
    PS.renderHistoryPanel();
};

// Every applied, undone or redone edit bumps the document revision; the save
// manager uses it to tell whether the document changed since the last save.
PS.historyChanged = function () {
    if (PS.doc) { PS.doc.revision = (PS.doc.revision || 0) + 1; }
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
    PS.historyChanged();
    PS.afterHistoryJump();
};

PS.redo = function () {
    if (!PS.canRedo()) { return; }
    PS.history.index++;
    var entry = PS.history.stack[PS.history.index];
    if (entry.redo) { entry.redo(); }
    PS.historyChanged();
    PS.afterHistoryJump();
};

PS.afterHistoryJump = function () {
    PS.markDirty();
    PS.requestRender();
    PS.renderLayersPanel();
    if (PS.renderPropertiesPanel) { PS.renderPropertiesPanel(); }
    PS.renderHistoryPanel();
    PS.selectionViewChanged();
};

// Ctrl+Z toggles the last step: it undoes, and pressed again it redoes what
// it undid. Ctrl+Alt+Z (Step Backward) keeps undoing, Ctrl+Shift+Z (Step
// Forward) keeps redoing; after Step Backward, Ctrl+Z redoes one step.
PS.stepBackward = function () {
    if (!PS.canUndo()) { return; }
    PS.undo();
    PS.history.lastStep = "back";
};

PS.stepForward = function () {
    if (!PS.canRedo()) { return; }
    PS.redo();
    PS.history.lastStep = "forward";
};

PS.toggleUndo = function () {
    if (PS.history.lastStep === "back" && PS.canRedo()) { PS.stepForward(); }
    else { PS.stepBackward(); }
};

// what Ctrl+Z does next: {redo: bool, label} (the Edit menu shows it)
PS.toggleUndoInfo = function () {
    var h = PS.history;
    if (h.lastStep === "back" && PS.canRedo()) { return { redo: true, label: h.stack[h.index + 1].label }; }
    if (PS.canUndo()) { return { redo: false, label: h.stack[h.index].label }; }
    return null;
};

// jump to an absolute history index (history panel click)
PS.jumpHistory = function (target) {
    var guard = 200;
    while (PS.history.index > target && PS.canUndo() && guard-- > 0) { PS.undo(); }
    while (PS.history.index < target && PS.canRedo() && guard-- > 0) { PS.redo(); }
    PS.history.lastStep = null;
};

/* ---- helpers for layer pixel edits ---- */

// call before painting: returns snapshot
PS.snapshotLayer = function (layer) {
    return PS.cloneCanvas(layer.canvas);
};

// call after painting finished
PS.commitLayerCanvas = function (label, layer, beforeCanvas) {
    PS.touchLayer(layer);
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
    PS.touchLayer(layer);
};

/* ---- helper for structural layer-stack changes ---- */

// Wraps fn() that rearranges the layer tree (add / delete / reorder / group)
// or changes the active layer. Layer objects must be treated as immutable by
// fn (replace, don't repaint, when contents change): the snapshot shares them.
PS.layerStructure = function (label, fn) {
    var before = PS.captureStructure();
    fn();
    var after = PS.captureStructure();
    // the stack changed under it, so a panel multi-selection is no longer
    // meaningful - fall back to "just the active layer"
    if (PS.clearLayerSelection) { PS.clearLayerSelection(); }
    PS.pushHistory(label,
        function () { PS.applyStructure(before); },
        function () { PS.applyStructure(after); });
    PS.requestRender();
    PS.renderLayersPanel();
};

// Undoable change of plain layer properties. apply(layer, value) sets them;
// before / after are the values to restore and re-apply.
PS.layerPropChange = function (label, layer, before, after, apply) {
    apply(layer, after);
    PS.pushHistory(label,
        function () { apply(layer, before); },
        function () { apply(layer, after); });
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
