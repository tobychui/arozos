/*
    Pixel Studio - text tool and font management
    Text lives on editable text layers (re-rendered from their text data).
    Custom fonts are enumerated by backend/listFonts.js from the webapp's
    ./fonts/ folder and loaded through the FontFace API.
*/
"use strict";

PS.builtinFonts = [
    "Arial", "Helvetica", "Times New Roman", "Georgia", "Courier New",
    "Verdana", "Tahoma", "Trebuchet MS", "Impact", "Comic Sans MS"
];

PS.loadFonts = function (done) {
    PS.fonts = PS.builtinFonts.map(function (f) {
        return { name: f, css: f, builtin: true };
    });

    if (!PS.inArozOS()) { if (done) { done(); } return; }

    try {
        ao_module_agirun("Pixel Studio/backend/listFonts.js", {}, function (list) {
            if (typeof list === "string") {
                try { list = JSON.parse(list); } catch (e) { list = []; }
            }
            if (!Array.isArray(list)) { list = []; }

            var pending = list.length;
            if (pending === 0) { if (done) { done(); } return; }

            list.forEach(function (f) {
                var url = "url(\"../" + encodeURI(f.file) + "\")";
                var face = new FontFace(f.name, url);
                face.load().then(function (loaded) {
                    document.fonts.add(loaded);
                    PS.fonts.push({ name: f.name, css: f.name, builtin: false });
                    if (--pending === 0 && done) { done(); }
                }).catch(function () {
                    if (--pending === 0 && done) { done(); }
                });
            });
        }, function () {
            if (done) { done(); }
        });
    } catch (e) {
        if (done) { done(); }
    }
};

PS.fontOptions = function () {
    return PS.fonts.map(function (f) {
        return { v: f.css, l: f.name + (f.builtin ? "" : " (custom)") };
    });
};

/* ---------- text layer rendering ---------- */

PS.textFontString = function (t) {
    return (t.italic ? "italic " : "") + (t.bold ? "bold " : "") +
        t.size + "px \"" + t.font + "\"";
};

PS.renderTextLayer = function (layer) {
    if (layer.type !== "text" || !layer.text) { return; }
    var t = layer.text;
    var ctx = layer.canvas.getContext("2d");
    ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    ctx.font = PS.textFontString(t);
    ctx.fillStyle = t.color;
    ctx.textBaseline = "top";
    var lineHeight = Math.round(t.size * 1.25);
    var lines = (t.content || "").split("\n");
    for (var i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], t.x, t.y + i * lineHeight);
    }
};

PS.textLayerBounds = function (layer) {
    var t = layer.text;
    var ctx = layer.canvas.getContext("2d");
    ctx.font = PS.textFontString(t);
    var lines = (t.content || "").split("\n");
    var w = 0;
    lines.forEach(function (line) {
        w = Math.max(w, ctx.measureText(line).width);
    });
    var lineHeight = Math.round(t.size * 1.25);
    return { x: t.x, y: t.y, w: w, h: lines.length * lineHeight };
};

/* ---------- inline text editing session ---------- */

PS.textEdit = null; // {layer, isNew, beforeText, editorEl}

PS.textEditActive = function () { return !!PS.textEdit; };

PS.startTextEditOnLayer = function (layer) {
    if (PS.textEdit) { PS.commitTextEdit(); }
    var t = layer.text;
    var host = PS.el("text-edit-host");

    var ed = document.createElement("textarea");
    ed.className = "text-editor";
    ed.value = t.content;
    ed.spellcheck = false;
    host.appendChild(ed);

    PS.textEdit = {
        layer: layer,
        isNew: false,
        beforeText: JSON.parse(JSON.stringify(t)),
        editorEl: ed
    };

    // hide the layer's own rendering while editing
    layer.canvas.getContext("2d").clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    PS.requestRender();

    PS.positionTextEditor();
    ed.focus();
    ed.select();

    ed.addEventListener("input", function () {
        PS.autoSizeTextEditor();
    });
    ed.addEventListener("keydown", function (e) {
        e.stopPropagation();
        if (e.key === "Escape") {
            e.preventDefault();
            PS.cancelTextEdit();
        } else if (e.key === "Enter" && e.ctrlKey) {
            e.preventDefault();
            PS.commitTextEdit();
        }
    });
    PS.autoSizeTextEditor();
};

PS.positionTextEditor = function () {
    var te = PS.textEdit;
    if (!te) { return; }
    var t = te.layer.text;
    var p = PS.docToOverlay(t.x, t.y);
    var ed = te.editorEl;
    ed.style.left = p.x + "px";
    ed.style.top = p.y + "px";
    ed.style.font = (t.italic ? "italic " : "") + (t.bold ? "bold " : "") +
        (t.size * PS.zoom) + "px \"" + t.font + "\"";
    ed.style.lineHeight = Math.round(t.size * 1.25 * PS.zoom) + "px";
    ed.style.color = t.color;
    ed.style.caretColor = t.color;
    PS.autoSizeTextEditor();
};

PS.autoSizeTextEditor = function () {
    var te = PS.textEdit;
    if (!te) { return; }
    var ed = te.editorEl;
    ed.style.width = "10px";
    ed.style.height = "10px";
    ed.style.width = Math.max(30, ed.scrollWidth + 12) + "px";
    ed.style.height = Math.max(20, ed.scrollHeight + 4) + "px";
};

PS.commitTextEdit = function () {
    var te = PS.textEdit;
    if (!te) { return; }
    PS.textEdit = null;

    var layer = te.layer;
    layer.text.content = te.editorEl.value;
    te.editorEl.remove();

    if (!layer.text.content.trim()) {
        // empty text: remove a fresh layer / restore an edited one
        if (te.isNew) {
            var d = PS.doc;
            var idx = d.layers.indexOf(layer);
            if (idx >= 0) {
                d.layers.splice(idx, 1);
                d.activeLayer = PS.clamp(d.activeLayer, 0, d.layers.length - 1);
                // also drop the "New Layer" history entry for the empty layer
                if (PS.canUndo()) { PS.undo(); PS.history.stack.length = PS.history.index + 1; }
            }
            PS.renderLayersPanel();
            PS.requestRender();
            return;
        }
        layer.text = te.beforeText;
    }

    // friendly layer name from content
    if (layer.text.content.trim()) {
        var label = layer.text.content.trim().split("\n")[0];
        layer.name = label.length > 18 ? label.slice(0, 18) + "..." : label;
    }

    PS.renderTextLayer(layer);
    PS.requestRender();
    PS.renderLayersPanel();

    var before = te.beforeText;
    var after = JSON.parse(JSON.stringify(layer.text));
    if (te.isNew) {
        // creation history was already pushed by addLayer; just refresh label
        PS.markDirty();
    } else if (JSON.stringify(before) !== JSON.stringify(after)) {
        PS.pushHistory("Edit Text",
            function () { layer.text = before; PS.renderTextLayer(layer); },
            function () { layer.text = after; PS.renderTextLayer(layer); });
    }
};

PS.cancelTextEdit = function () {
    var te = PS.textEdit;
    if (!te) { return; }
    PS.textEdit = null;
    te.editorEl.remove();

    var layer = te.layer;
    if (te.isNew) {
        var d = PS.doc;
        var idx = d.layers.indexOf(layer);
        if (idx >= 0) {
            d.layers.splice(idx, 1);
            d.activeLayer = PS.clamp(d.activeLayer, 0, d.layers.length - 1);
            if (PS.canUndo()) { PS.undo(); PS.history.stack.length = PS.history.index + 1; }
        }
    } else {
        layer.text = te.beforeText;
        PS.renderTextLayer(layer);
    }
    PS.renderLayersPanel();
    PS.requestRender();
};

/* ---------- the text tool (T) ---------- */

PS.registerTool("text", {
    name: "Text",
    key: "t",
    cursor: "text",
    icon: '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg>',
    options: function (host) {
        var o = PS.toolOpts.text;
        var fontSel = PS.ui.select(host, "Font", PS.fontOptions(), o.font, function (v) {
            o.font = v;
            PS.savePrefsDebounced();
            PS.applyTextOptionToEdit();
        });
        if (!PS.fonts.some(function (f) { return f.css === o.font; })) {
            fontSel.value = PS.fonts[0] ? PS.fonts[0].css : "Arial";
        }
        PS.ui.number(host, "Size", o.size, 6, 600, function (v) {
            o.size = v;
            PS.savePrefsDebounced();
            PS.applyTextOptionToEdit();
        });
        PS.ui.checkbox(host, "Bold", o.bold, function (v) {
            o.bold = v; PS.savePrefsDebounced(); PS.applyTextOptionToEdit();
        });
        PS.ui.checkbox(host, "Italic", o.italic, function (v) {
            o.italic = v; PS.savePrefsDebounced(); PS.applyTextOptionToEdit();
        });
        PS.ui.label(host, "Click canvas to add text. Ctrl+Enter commits, Esc cancels. Color = foreground.");
    },
    onDown: function (pt) {
        if (PS.textEdit) {
            PS.commitTextEdit();
            return;
        }

        // clicking an existing text layer edits it
        var d = PS.doc;
        for (var i = d.layers.length - 1; i >= 0; i--) {
            var layer = d.layers[i];
            if (layer.type !== "text" || !layer.visible) { continue; }
            var b = PS.textLayerBounds(layer);
            if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) {
                PS.setActiveLayer(i);
                PS.startTextEditOnLayer(layer);
                return;
            }
        }

        // create a new text layer at the click position
        var o = PS.toolOpts.text;
        var newLayer = PS.addLayer("Text", { type: "text" });
        newLayer.text = {
            content: "",
            font: o.font,
            size: o.size,
            color: PS.fg,
            bold: o.bold,
            italic: o.italic,
            x: Math.round(pt.x),
            y: Math.round(pt.y - o.size / 2)
        };
        PS.startTextEditOnLayer(newLayer);
        PS.textEdit.isNew = true;
    }
});

// live-apply option changes to the open text editing session
PS.applyTextOptionToEdit = function () {
    var te = PS.textEdit;
    if (!te) { return; }
    var o = PS.toolOpts.text;
    te.layer.text.font = o.font;
    te.layer.text.size = o.size;
    te.layer.text.bold = o.bold;
    te.layer.text.italic = o.italic;
    PS.positionTextEditor();
};
