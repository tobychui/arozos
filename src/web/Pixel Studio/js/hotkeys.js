/*
    Pixel Studio - Photoshop-style keyboard shortcuts
*/
"use strict";

PS.bindHotkeys = function () {
    document.addEventListener("keydown", PS.handleKeyDown);
    document.addEventListener("keyup", PS.handleKeyUp);
    // Ctrl+V is handled via the native paste event so we can read an image
    // out of the system clipboard (clipboardData is only populated here).
    document.addEventListener("paste", PS.handlePaste);
};

// Paste from the system clipboard: an image becomes a new layer; otherwise
// fall back to the in-app clipboard.
PS.handlePaste = function (e) {
    if (!PS.doc) { return; }
    if (PS.el("dialog-host").children.length > 0) { return; }
    if (PS.isTypingTarget(e)) { return; }

    var items = (e.clipboardData && e.clipboardData.items) || null;
    var imageItem = null;
    if (items) {
        for (var i = 0; i < items.length; i++) {
            if (items[i].type && items[i].type.indexOf("image") === 0) {
                imageItem = items[i];
                break;
            }
        }
    }

    e.preventDefault();
    if (imageItem) {
        var blob = imageItem.getAsFile();
        if (blob) { PS.loadImageBlobAsLayer(blob); return; }
    }
    // no system image: use the in-app clipboard
    PS.pasteClipboard();
};

PS._toolGroups = {
    m: ["marquee-rect", "marquee-ellipse"],
    l: ["lasso", "lasso-poly"],
    b: ["brush", "pencil"],
    g: ["fill", "gradient"]
};

PS._toolKeys = {
    v: "move", m: "marquee-rect", l: "lasso", w: "wand", b: "brush",
    e: "eraser", g: "fill", i: "eyedropper", t: "text", u: "shape",
    h: "hand", z: "zoom"
};

PS.isTypingTarget = function (e) {
    var t = e.target;
    if (!t) { return false; }
    var tag = t.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
};

PS.handleKeyUp = function (e) {
    if (e.key === " " || e.code === "Space") {
        PS.spacePan = false;
        var def = PS.tools[PS.tool];
        PS.el("workspace").style.cursor = (def && def.cursor) || "crosshair";
    }
};

PS.handleKeyDown = function (e) {
    if (!PS.doc) { return; }
    // a modal dialog is open: its own capture handler deals with keys
    if (PS.el("dialog-host").children.length > 0) { return; }
    // typing into a field (incl. the text tool editor): leave keys alone
    if (PS.isTypingTarget(e)) { return; }

    var ctrl = e.ctrlKey || e.metaKey;
    var key = e.key.toLowerCase();

    // give the active tool first dibs (poly lasso Enter/Esc...)
    var def = PS.tools[PS.tool];
    if (!ctrl && def && def.onKey && def.onKey(e)) {
        e.preventDefault();
        return;
    }

    /* ---- Ctrl/Cmd shortcuts ---- */
    if (ctrl) {
        var handled = true;
        if (key === "z" && !e.shiftKey) { PS.undo(); }
        else if ((key === "z" && e.shiftKey) || key === "y") { PS.redo(); }
        else if (key === "s") { if (e.shiftKey) { PS.fileSaveAs(); } else { PS.fileSave(); } }
        else if (key === "o") { PS.fileOpenDialog(); }
        else if (key === "n" && e.shiftKey) { PS.addLayer(); }
        else if (key === "n") { PS.fileNewDialog(); }
        else if (key === "a") { PS.selectAll(); }
        else if (key === "d") { PS.deselect(); }
        else if (key === "i" && e.shiftKey) { PS.invertSelection(); }
        else if (key === "j") { PS.duplicateLayer(); }
        else if (key === "e" && e.shiftKey) { PS.flattenImage(); }
        else if (key === "e") { PS.mergeDown(); }
        else if (key === "c" && e.shiftKey) { PS.copySelection(false, true); }
        else if (key === "c") { PS.copySelection(false, false); }
        else if (key === "x") { PS.copySelection(true, false); }
        // Ctrl+V intentionally falls through to the document "paste" handler
        // (PS.handlePaste) so the system clipboard image can be read.
        else if (key === "v") { return; }
        else if (key === "=" || key === "+") { PS.zoomBy(1.25); }
        else if (key === "-") { PS.zoomBy(1 / 1.25); }
        else if (key === "0") { PS.zoomFit(); }
        else if (key === "1") { PS.zoomActual(); }
        else if (key === "r") { PS.toggleRulers(); }
        else if (key === "backspace") { PS.fillWithColor(PS.bg, "Fill Background"); }
        else { handled = false; }
        if (handled) { e.preventDefault(); }
        return;
    }

    /* ---- Alt shortcuts ---- */
    if (e.altKey) {
        if (key === "backspace") {
            PS.fillWithColor(PS.fg, "Fill Foreground");
            e.preventDefault();
        }
        return;
    }

    /* ---- plain keys ---- */
    if (e.key === " " || e.code === "Space") {
        if (!PS.spacePan) {
            PS.spacePan = true;
            PS.el("workspace").style.cursor = "grab";
        }
        e.preventDefault();
        return;
    }

    // tool selection (Shift+key cycles within the group)
    if (PS._toolKeys[key]) {
        if (e.shiftKey && PS._toolGroups[key]) {
            var group = PS._toolGroups[key];
            var idx = group.indexOf(PS.tool);
            PS.setTool(group[(idx + 1) % group.length]);
        } else if (PS._toolGroups[key] && PS._toolGroups[key].indexOf(PS.tool) >= 0 && !e.shiftKey) {
            // pressing the key again on the same group cycles too
            var g2 = PS._toolGroups[key];
            PS.setTool(g2[(g2.indexOf(PS.tool) + 1) % g2.length]);
        } else {
            PS.setTool(PS._toolKeys[key]);
        }
        e.preventDefault();
        return;
    }

    // brush size with [ and ]
    if (key === "[" || key === "]") {
        var paintTools = { brush: 1, pencil: 1, eraser: 1 };
        if (paintTools[PS.tool]) {
            var o = PS.toolOpts[PS.tool];
            var step = o.size < 10 ? 1 : (o.size < 50 ? 5 : 10);
            o.size = PS.clamp(o.size + (key === "]" ? step : -step), 1, 300);
            PS.renderOptionsBar();
            PS.savePrefsDebounced();
        }
        e.preventDefault();
        return;
    }

    if (key === "x") { PS.swapColors(); e.preventDefault(); return; }
    if (key === "d") { PS.resetColors(); e.preventDefault(); return; }

    if (e.key === "Delete" || e.key === "Backspace") {
        if (PS.doc.selection) { PS.clearSelected(); }
        e.preventDefault();
        return;
    }

    // arrow-key nudge with the move tool
    if (PS.tool === "move" &&
        (e.key === "ArrowLeft" || e.key === "ArrowRight" ||
            e.key === "ArrowUp" || e.key === "ArrowDown")) {
        var dist = e.shiftKey ? 10 : 1;
        var dx = (e.key === "ArrowLeft" ? -dist : (e.key === "ArrowRight" ? dist : 0));
        var dy = (e.key === "ArrowUp" ? -dist : (e.key === "ArrowDown" ? dist : 0));
        PS.nudgeMove(dx, dy);
        e.preventDefault();
    }
};
