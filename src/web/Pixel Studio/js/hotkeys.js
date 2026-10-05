/*
    Pixel Studio - keyboard shortcuts
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
    g: ["gradient", "fill"],
    j: ["spotheal", "heal"],
    e: ["eraser", "magic-eraser"],
    o: ["dodge", "burn", "sponge"],
    i: ["eyedropper", "ruler", "note"]
};

PS._toolKeys = {
    v: "move", m: "marquee-rect", l: "lasso", w: "wand", c: "crop", b: "brush",
    j: "spotheal", s: "clone", e: "eraser", g: "gradient", o: "dodge", i: "eyedropper",
    t: "text", u: "shape", h: "hand", z: "zoom"
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
        PS.el("workspace").style.cursor = PS.toolCursor();
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
    // layout independent names for keys that Shift / Alt change
    var code = e.code || "";
    if (code === "BracketRight") { key = "]"; }
    else if (code === "BracketLeft") { key = "["; }
    else if (code === "Semicolon") { key = ";"; }
    else if (code === "Quote") { key = "'"; }
    else if (ctrl && e.altKey && /^Key[A-Z]$/.test(code)) { key = code.charAt(3).toLowerCase(); }

    // an open Free Transform: Enter commits, Esc / Ctrl+Z cancel
    if (PS.transform && PS.transform.active) {
        if (e.key === "Enter") { PS.transform.commit(); e.preventDefault(); return; }
        if (e.key === "Escape" || (ctrl && key === "z")) { PS.transform.cancel(); e.preventDefault(); return; }
        if (e.key.indexOf("Arrow") === 0) {
            // nudge the box
            var nd = e.shiftKey ? 10 : 1;
            var tdx = e.key === "ArrowLeft" ? -nd : (e.key === "ArrowRight" ? nd : 0);
            var tdy = e.key === "ArrowUp" ? -nd : (e.key === "ArrowDown" ? nd : 0);
            PS.transform.nudge(tdx, tdy);
            e.preventDefault();
            return;
        }
    }

    // give the active tool first dibs (poly lasso Enter/Esc...)
    var def = PS.tools[PS.tool];
    if (!ctrl && def && def.onKey && def.onKey(e)) {
        e.preventDefault();
        return;
    }

    /* ---- Ctrl/Cmd shortcuts ---- */
    if (ctrl) {
        var handled = true;
        if (key === "z" && e.altKey && !e.shiftKey) { PS.stepBackward(); }
        else if (key === "z" && !e.shiftKey) { PS.toggleUndo(); }
        else if ((key === "z" && e.shiftKey) || key === "y") { PS.stepForward(); }
        else if (key === "s") { if (e.shiftKey) { PS.fileSaveAs(); } else { PS.fileSave(); } }
        else if (key === "o") { PS.fileOpenDialog(); }
        else if (key === "n" && e.shiftKey) { PS.addLayer(); }
        else if (key === "n") { PS.fileNewDialog(); }
        else if (key === "a" && e.altKey) { PS.selectAllLayers(); }
        else if (key === "a") { PS.selectAll(); }
        else if (key === "d" && e.shiftKey) { PS.reselect(); }
        else if (key === "d") { PS.deselect(); }
        else if (key === "i" && e.shiftKey) { PS.invertSelection(); }
        else if (key === "j" && e.shiftKey) { PS.layerViaCopy(true); }
        else if (key === "j") { if (PS.doc.selection) { PS.layerViaCopy(false); } else { PS.duplicateLayer(); } }
        else if (key === "i" && e.altKey) { PS.resizeImageDialog(); }
        else if (key === "c" && e.altKey) { PS.resizeCanvasDialog(); }
        else if (key === "l" && e.shiftKey && e.altKey) { PS.autoAdjust("contrast"); }
        else if (key === "l" && e.shiftKey) { PS.autoAdjust("tone"); }
        else if (key === "b" && e.shiftKey && e.altKey) { PS.imageAdjustment("black & white"); }
        else if (key === "b" && e.shiftKey) { PS.autoAdjust("color"); }
        else if (key === "e" && e.shiftKey && e.altKey) { PS.stampVisible(); }
        else if (key === "f" && e.altKey) { PS.repeatLastFilter(true); }
        else if (key === "f") { PS.repeatLastFilter(false); }
        else if (key === ";" && e.shiftKey) { PS.toggleSnap(); PS.toast(PS.snapToGuides ? "Snap on" : "Snap off"); }
        else if (key === "t" && e.shiftKey && e.altKey) { PS.transform.again(true); }
        else if (key === "t" && e.shiftKey) { PS.transform.again(); }
        else if (key === "t") { PS.transform.begin({ kind: "auto" }); }
        else if (key === "]" && e.shiftKey) { PS.arrangeLayer("front"); }
        else if (key === "[" && e.shiftKey) { PS.arrangeLayer("back"); }
        else if (key === "]") { PS.moveLayer(1); }
        else if (key === "[") { PS.moveLayer(-1); }
        else if (key === "'") { PS.toggleGrid(); }
        else if (key === ";") { PS.toggleGuidesVisible(); }
        else if (key === "h") { PS.toggleExtras(); }
        else if (key === "2") { PS.setViewChannel(null); }
        else if (key === "3") { PS.setViewChannel("r"); }
        else if (key === "4") { PS.setViewChannel("g"); }
        else if (key === "5") { PS.setViewChannel("b"); }
        else if (key === "i" && !e.shiftKey) { PS.invertPixels(); }
        else if (key === "u" && e.shiftKey) { PS.desaturatePixels(); }
        else if (key === "u") { PS.imageAdjustment("hue/saturation"); }
        else if (key === "l") { PS.imageAdjustment("levels"); }
        else if (key === "m") { PS.imageAdjustment("curves"); }
        else if (key === "b") { PS.imageAdjustment("color balance"); }
        else if (key === "g" && e.altKey) { PS.toggleClipping(); }
        else if (key === "g" && e.shiftKey) { PS.ungroupLayers(); }
        else if (key === "g") { PS.groupSelectedLayers(); }
        else if (key === "e" && e.shiftKey) { PS.mergeVisible(); }
        else if (key === "e") { PS.mergeSelectedOrDown(); }
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
        } else if (key === "]" || key === "[") {
            // select the layer above / below (Shift adds it)
            PS.selectAdjacentLayer(key === "]" ? 1 : -1, e.shiftKey);
            e.preventDefault();
        }
        return;
    }
    if (e.key === "F5" && e.shiftKey) { PS.fillDialog(); e.preventDefault(); return; }
    if (e.key === "F6" && e.shiftKey) { PS.featherDialog(); e.preventDefault(); return; }
    if (e.key === "F7" && e.shiftKey) { PS.invertSelection(); e.preventDefault(); return; }

    /* ---- number keys: layer opacity (Shift: fill), tool opacity on paint tools ---- */
    var digit = /^(Digit|Numpad)[0-9]$/.test(code) ? parseInt(code.slice(-1), 10) : (/^[0-9]$/.test(e.key) ? parseInt(e.key, 10) : -1);
    if (digit >= 0) {
        PS.numberKeyOpacity(digit, e.shiftKey);
        e.preventDefault();
        return;
    }
    if (e.key === "F5") { PS.toggleBrushPanel(); e.preventDefault(); return; }
    if (e.key === "F6") { PS.ws.showPanel("color"); e.preventDefault(); return; }
    if (e.key === "F7") { PS.ws.showPanel("layers"); e.preventDefault(); return; }
    if (e.key === "F8") { PS.ws.showPanel("info"); e.preventDefault(); return; }
    if (key === "q" && !e.shiftKey) { PS.toggleQuickMask(); e.preventDefault(); return; }
    if (key === "f" && !e.shiftKey) { PS.cycleScreenMode(); e.preventDefault(); return; }
    if (e.key === "Tab") { PS.toggleUiPanels(e.shiftKey); e.preventDefault(); return; }

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

    // brush size with [ and ], hardness with Shift+[ and ]
    if (key === "[" || key === "]") {
        if ((PS.BRUSH_SIZE_TOOLS || ["brush", "pencil", "eraser"]).indexOf(PS.tool) >= 0) {
            var o = PS.toolOpts[PS.tool];
            if (e.shiftKey) {
                if (o.hardness !== undefined) {
                    o.hardness = PS.clamp(Math.round((o.hardness + (key === "]" ? 0.25 : -0.25)) * 4) / 4, 0, 1);
                }
            } else {
                var step = o.size < 10 ? 1 : (o.size < 50 ? 5 : (o.size < 200 ? 10 : 25));
                o.size = PS.clamp(o.size + (key === "]" ? step : -step), 1, 2500);
            }
            PS.renderOptionsBar();
            if (PS.ws) { PS.ws.refresh(); }
            PS.savePrefsDebounced();
        }
        e.preventDefault();
        return;
    }

    // , and . step through the brush presets
    if ((e.key === "," || e.key === ".") && PS.BRUSH_TOOLS && PS.BRUSH_TOOLS.indexOf(PS.tool) >= 0) {
        PS.stepBrushPreset(e.key === "." ? 1 : -1);
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
