/*
    Pixel Studio - editor core
    Document model, viewport (zoom/pan), compositing renderer,
    shared UI helpers (dialogs, toasts, option bar widgets).
*/
"use strict";

window.PS = {
    doc: null,              // current document
    zoom: 1,
    fg: "#1a1a1a",
    bg: "#ffffff",
    tool: null,             // active tool id
    tools: {},              // id -> tool definition
    toolOrder: [],          // toolbar display order
    toolOpts: {},           // per-tool option state (persisted)
    clipboard: null,        // {canvas, bounds} internal clipboard
    strokePreview: null,    // {layer, canvas, opacity, erase} live brush stroke
    layerOverride: null,    // {layer, canvas} preview replacement (move/filters)
    fonts: [],              // available fonts [{name, css, builtin}]
    prefs: {},
    recentColors: [],
    spacePan: false,
    cursorPos: null         // last pointer position in doc coords
};

/* ---------- tiny helpers ---------- */

PS.el = function (id) { return document.getElementById(id); };

PS.createCanvas = function (w, h) {
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
};

PS.cloneCanvas = function (src) {
    var c = PS.createCanvas(src.width, src.height);
    c.getContext("2d").drawImage(src, 0, 0);
    return c;
};

PS.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };

// Accepts #rgb, #rrggbb, or #rrggbbaa. Always returns {r,g,b,a} (a 0-255).
PS.hexToRgb = function (hex) {
    hex = String(hex).trim();
    var m6 = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (m6) {
        var n = parseInt(m6[1], 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 255 };
    }
    var m8 = /^#?([0-9a-f]{8})$/i.exec(hex);
    if (m8) {
        return {
            r: parseInt(m8[1].slice(0, 2), 16),
            g: parseInt(m8[1].slice(2, 4), 16),
            b: parseInt(m8[1].slice(4, 6), 16),
            a: parseInt(m8[1].slice(6, 8), 16)
        };
    }
    var m3 = /^#?([0-9a-f]{3})$/i.exec(hex);
    if (m3) {
        var s = m3[1];
        return {
            r: parseInt(s[0] + s[0], 16),
            g: parseInt(s[1] + s[1], 16),
            b: parseInt(s[2] + s[2], 16),
            a: 255
        };
    }
    return null;
};

// Emits #rrggbb, or #rrggbbaa when an alpha < 255 is supplied.
PS.rgbToHex = function (r, g, b, a) {
    function h2(x) { x = PS.clamp(Math.round(x), 0, 255); return (x < 16 ? "0" : "") + x.toString(16); }
    var hex = "#" + h2(r) + h2(g) + h2(b);
    if (a !== undefined && a !== null && Math.round(a) < 255) { hex += h2(a); }
    return hex;
};

PS.inArozOS = function () {
    return typeof ao_module_agirun !== "undefined" && window.location.protocol !== "file:";
};

/* ---------- document ---------- */

PS.newDocument = function (opts) {
    opts = opts || {};
    var w = PS.clamp(Math.round(opts.width || 1000), 1, 8192);
    var h = PS.clamp(Math.round(opts.height || 700), 1, 8192);

    PS.doc = {
        width: w,
        height: h,
        layers: [],
        activeLayer: 0,
        selection: null,
        filePath: opts.filePath || "",
        fileName: opts.name || "Untitled",
        format: opts.format || "pxs",
        guides: { h: [], v: [] },
        dirty: false
    };

    var bgLayer = PS.makeLayer("Background", w, h);
    if (opts.background !== "transparent") {
        var ctx = bgLayer.canvas.getContext("2d");
        ctx.fillStyle = (opts.background === "bgcolor") ? PS.bg : "#ffffff";
        ctx.fillRect(0, 0, w, h);
    }
    PS.doc.layers.push(bgLayer);

    PS.history.stack = [];
    PS.history.index = -1;
    PS.pushHistory(opts.historyLabel || "New Document", null, null);

    PS.strokePreview = null;
    PS.layerOverride = null;
    PS.updateCanvasSize();
    PS.zoomFit();
    PS.refreshUI();
    PS.requestRender();
};

PS.activeLayer = function () {
    if (!PS.doc) { return null; }
    return PS.doc.layers[PS.doc.activeLayer] || null;
};

PS.markDirty = function () {
    if (PS.doc && !PS.doc.dirty) {
        PS.doc.dirty = true;
        PS.updateTitle();
    }
};

PS.confirmDiscard = function (then) {
    if (!PS.doc || !PS.doc.dirty) { then(); return; }
    PS.dialog({
        title: "Unsaved Changes",
        build: function (body) {
            body.textContent = "\"" + PS.doc.fileName + "\" has unsaved changes. Discard them?";
        },
        buttons: [
            { label: "Cancel" },
            { label: "Discard", primary: true, action: function () { then(); } }
        ]
    });
};

/* ---------- compositing ---------- */

PS._renderQueued = false;

PS.requestRender = function () {
    if (PS._renderQueued) { return; }
    PS._renderQueued = true;
    requestAnimationFrame(function () {
        PS._renderQueued = false;
        PS.renderNow();
    });
};

// Draw the full layer stack onto ctx (size = doc size).
// skipPreviews=true gives the committed document only (export, flatten).
PS.drawComposite = function (ctx, skipPreviews) {
    var d = PS.doc;
    ctx.clearRect(0, 0, d.width, d.height);

    for (var i = 0; i < d.layers.length; i++) {
        var layer = d.layers[i];
        if (!layer.visible) { continue; }

        var src = layer.canvas;

        if (!skipPreviews && PS.layerOverride && PS.layerOverride.layer === layer) {
            src = PS.layerOverride.canvas;
        }

        if (!skipPreviews && PS.strokePreview && PS.strokePreview.layer === layer) {
            src = PS._bakeStrokePreview(layer);
        }

        ctx.globalAlpha = layer.opacity;
        ctx.globalCompositeOperation = layer.blend;
        ctx.drawImage(src, 0, 0);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
};

// Compose layer + in-progress stroke (respecting selection mask) into a scratch canvas
PS._bakeStrokePreview = function (layer) {
    var d = PS.doc;
    var sp = PS.strokePreview;

    if (!PS._previewTmp || PS._previewTmp.width !== d.width || PS._previewTmp.height !== d.height) {
        PS._previewTmp = PS.createCanvas(d.width, d.height);
        PS._previewTmp2 = PS.createCanvas(d.width, d.height);
    }

    // masked copy of the stroke buffer
    var m = PS._previewTmp2.getContext("2d");
    m.clearRect(0, 0, d.width, d.height);
    m.drawImage(sp.canvas, 0, 0);
    if (d.selection) {
        m.globalCompositeOperation = "destination-in";
        m.drawImage(d.selection.mask, 0, 0);
        m.globalCompositeOperation = "source-over";
    }

    var t = PS._previewTmp.getContext("2d");
    t.clearRect(0, 0, d.width, d.height);
    t.drawImage(layer.canvas, 0, 0);
    t.globalAlpha = sp.opacity;
    t.globalCompositeOperation = sp.erase ? "destination-out" : "source-over";
    t.drawImage(PS._previewTmp2, 0, 0);
    t.globalAlpha = 1;
    t.globalCompositeOperation = "source-over";
    return PS._previewTmp;
};

PS.renderNow = function () {
    if (!PS.doc) { return; }
    var canvas = PS.el("doc-canvas");
    PS.drawComposite(canvas.getContext("2d"), false);
    PS.updateLayerThumbsThrottled();
};

// Committed flat image (for export / copy merged / flatten)
PS.compositeToCanvas = function () {
    var c = PS.createCanvas(PS.doc.width, PS.doc.height);
    PS.drawComposite(c.getContext("2d"), true);
    return c;
};

/* ---------- viewport: zoom & coordinates ---------- */

PS.updateCanvasSize = function () {
    var d = PS.doc;
    var canvas = PS.el("doc-canvas");
    if (canvas.width !== d.width || canvas.height !== d.height) {
        canvas.width = d.width;
        canvas.height = d.height;
    }
    PS.el("workspace-holder").classList.add("has-doc");
    PS.applyZoomCss();
};

PS.applyZoomCss = function () {
    var d = PS.doc;
    var pos = PS.el("canvas-positioner");
    pos.style.width = Math.max(1, Math.round(d.width * PS.zoom)) + "px";
    pos.style.height = Math.max(1, Math.round(d.height * PS.zoom)) + "px";
    pos.classList.toggle("pixelated", PS.zoom >= 3);
    PS.updateStatusBar();
};

PS.setZoom = function (z, focusDocPt) {
    if (!PS.doc) { return; }
    z = PS.clamp(z, 0.05, 32);
    var ws = PS.el("workspace");

    // keep the focused document point stationary on screen
    var anchor = null;
    if (focusDocPt) {
        var rect = PS.el("canvas-positioner").getBoundingClientRect();
        anchor = {
            sx: rect.left + focusDocPt.x * PS.zoom,
            sy: rect.top + focusDocPt.y * PS.zoom
        };
    }

    PS.zoom = z;
    PS.applyZoomCss();

    if (focusDocPt && anchor) {
        var rect2 = PS.el("canvas-positioner").getBoundingClientRect();
        ws.scrollLeft += (rect2.left + focusDocPt.x * z) - anchor.sx;
        ws.scrollTop += (rect2.top + focusDocPt.y * z) - anchor.sy;
    }

    PS.selectionViewChanged();
};

PS.zoomBy = function (factor, focusDocPt) {
    PS.setZoom(PS.zoom * factor, focusDocPt || PS.viewportCenterDocPt());
};

PS.zoomFit = function () {
    if (!PS.doc) { return; }
    var holder = PS.el("workspace-holder");
    // leave room for #canvas-wrap padding so "fit" shows no scrollbars
    var availW = holder.clientWidth - 100;
    var availH = holder.clientHeight - 100;
    if (availW < 50) { availW = 50; }
    if (availH < 50) { availH = 50; }
    var z = Math.min(availW / PS.doc.width, availH / PS.doc.height);
    PS.setZoom(Math.min(z, 1) || 1);
};

PS.zoomActual = function () { PS.setZoom(1, PS.viewportCenterDocPt()); };

PS.viewportCenterDocPt = function () {
    var ws = PS.el("workspace");
    var rect = PS.el("canvas-positioner").getBoundingClientRect();
    var wrect = ws.getBoundingClientRect();
    return {
        x: (wrect.left + wrect.width / 2 - rect.left) / PS.zoom,
        y: (wrect.top + wrect.height / 2 - rect.top) / PS.zoom
    };
};

PS.eventToDoc = function (e) {
    var rect = PS.el("canvas-positioner").getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) / PS.zoom,
        y: (e.clientY - rect.top) / PS.zoom
    };
};

// document coords -> overlay canvas coords
PS.docToOverlay = function (x, y) {
    var rect = PS.el("canvas-positioner").getBoundingClientRect();
    var orect = PS.el("overlay-canvas").getBoundingClientRect();
    return {
        x: rect.left - orect.left + x * PS.zoom,
        y: rect.top - orect.top + y * PS.zoom
    };
};

/* ---------- overlay render loop ---------- */

PS.startOverlayLoop = function () {
    var overlay = PS.el("overlay-canvas");

    function frame(t) {
        var holder = PS.el("workspace-holder");
        if (overlay.width !== holder.clientWidth || overlay.height !== holder.clientHeight) {
            overlay.width = Math.max(1, holder.clientWidth);
            overlay.height = Math.max(1, holder.clientHeight);
        }
        var ctx = overlay.getContext("2d");
        ctx.clearRect(0, 0, overlay.width, overlay.height);

        if (PS.doc) {
            // guides sit beneath the interactive overlays
            PS.drawGuides(ctx);
            // selection marching ants
            if (PS.doc.selection) {
                PS.drawSelectionOverlay(ctx, t);
            }
            // selection transform handles (visible when a selection tool is active)
            PS.selTransform.drawOverlay(ctx);
            // active tool overlay (shape previews, lasso paths, brush cursor...)
            var tool = PS.tools[PS.tool];
            if (tool && tool.overlay) {
                tool.overlay(ctx, t);
            }
            // top/left rulers (own canvases; drawn only when enabled)
            PS.drawRulers();
        }
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
};

/* ---------- status bar / title ---------- */

PS.updateStatusBar = function () {
    if (!PS.doc) { return; }
    PS.el("status-doc").textContent =
        PS.doc.fileName + "  |  " + PS.doc.width + " x " + PS.doc.height + " px";
    var zoomSel = PS.el("status-zoom");
    var pct = Math.round(PS.zoom * 1000) / 10;
    var matched = false;
    for (var i = 0; i < zoomSel.options.length; i++) {
        if (parseFloat(zoomSel.options[i].value) === PS.zoom) { matched = true; break; }
    }
    if (matched) {
        zoomSel.value = String(PS.zoom);
    } else {
        zoomSel.selectedIndex = -1;
    }
    PS.el("status-hint").textContent = pct + "%";
};

PS.updateCursorStatus = function () {
    var p = PS.cursorPos;
    PS.el("status-pos").textContent = p ? (Math.floor(p.x) + ", " + Math.floor(p.y)) : "";
};

PS.updateTitle = function () {
    if (!PS.doc) { return; }
    var title = PS.doc.fileName + (PS.doc.dirty ? " *" : "") + " - Pixel Studio";
    document.title = title;
    try {
        if (typeof ao_module_setWindowTitle !== "undefined") {
            ao_module_setWindowTitle(title);
        }
    } catch (e) { /* not running inside ArozOS desktop */ }
};

PS.refreshUI = function () {
    PS.renderLayersPanel();
    PS.renderHistoryPanel();
    PS.updateStatusBar();
    PS.updateTitle();
};

/* ---------- toast & dialogs ---------- */

PS.toast = function (msg, isError) {
    var host = PS.el("toast-host");
    var t = document.createElement("div");
    t.className = "toast" + (isError ? " error" : "");
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(function () {
        t.style.transition = "opacity 0.3s";
        t.style.opacity = "0";
        setTimeout(function () { t.remove(); }, 320);
    }, 2400);
};

// PS.dialog({title, build(bodyEl, dlg), buttons:[{label, primary, action(dlg)->false to keep open}]})
PS.dialog = function (opts) {
    var host = PS.el("dialog-host");
    var overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    var box = document.createElement("div");
    box.className = "dialog";

    var dlg = {
        root: box,
        close: function () {
            overlay.remove();
            document.removeEventListener("keydown", onKey, true);
            if (opts.onClose) { opts.onClose(); }
        }
    };

    var title = document.createElement("div");
    title.className = "dialog-title";
    title.textContent = opts.title || "";
    box.appendChild(title);

    var body = document.createElement("div");
    body.className = "dialog-body";
    box.appendChild(body);
    if (opts.build) { opts.build(body, dlg); }

    var btnBar = document.createElement("div");
    btnBar.className = "dialog-buttons";
    var primaryAction = null;
    (opts.buttons || [{ label: "OK", primary: true }]).forEach(function (b) {
        var btn = document.createElement("button");
        btn.textContent = b.label;
        if (b.primary) { btn.className = "primary"; primaryAction = b; }
        btn.addEventListener("click", function () {
            var keep = b.action ? b.action(dlg) : undefined;
            if (keep !== false) { dlg.close(); }
        });
        btnBar.appendChild(btn);
    });
    box.appendChild(btnBar);

    function onKey(e) {
        if (e.key === "Escape") {
            e.stopPropagation();
            e.preventDefault();
            dlg.close();
        } else if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") {
            e.stopPropagation();
            if (primaryAction) {
                e.preventDefault();
                var keep = primaryAction.action ? primaryAction.action(dlg) : undefined;
                if (keep !== false) { dlg.close(); }
            }
        }
    }
    document.addEventListener("keydown", onKey, true);

    overlay.appendChild(box);
    host.appendChild(overlay);

    var firstInput = body.querySelector("input, select");
    if (firstInput) { firstInput.focus(); if (firstInput.select) { firstInput.select(); } }
    return dlg;
};

// Non-modal, draggable panel. Unlike PS.dialog there is no backdrop, so the
// canvas behind it stays visible and editable — used for live filter
// adjustment. opts: {title, build(body, panel), buttons:[{label, primary,
// action(panel)->false to keep open}], onCancel, onClose, x, y}
PS.floatingPanel = function (opts) {
    var box = document.createElement("div");
    box.className = "float-panel";

    var panel = {
        root: box,
        closed: false,
        close: function () {
            if (panel.closed) { return; }
            panel.closed = true;
            box.remove();
            if (opts.onClose) { opts.onClose(); }
        }
    };

    var title = document.createElement("div");
    title.className = "float-panel-title";
    var titleText = document.createElement("span");
    titleText.textContent = opts.title || "";
    title.appendChild(titleText);

    var closeBtn = document.createElement("button");
    closeBtn.className = "float-panel-close";
    closeBtn.type = "button";
    closeBtn.innerHTML = "&times;";
    closeBtn.addEventListener("click", function () {
        if (opts.onCancel) { opts.onCancel(); }
        panel.close();
    });
    title.appendChild(closeBtn);
    box.appendChild(title);

    var body = document.createElement("div");
    body.className = "float-panel-body";
    box.appendChild(body);
    if (opts.build) { opts.build(body, panel); }

    if (opts.buttons) {
        var btnBar = document.createElement("div");
        btnBar.className = "float-panel-buttons";
        opts.buttons.forEach(function (b) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = b.label;
            if (b.primary) { btn.className = "primary"; }
            btn.addEventListener("click", function () {
                var keep = b.action ? b.action(panel) : undefined;
                if (keep !== false) { panel.close(); }
            });
            btnBar.appendChild(btn);
        });
        box.appendChild(btnBar);
    }

    document.body.appendChild(box);

    // initial position (default: upper-left of the workspace, clear of center)
    var rect = box.getBoundingClientRect();
    var px = (opts.x !== undefined) ? opts.x : 80;
    var py = (opts.y !== undefined) ? opts.y : 96;
    px = PS.clamp(px, 4, Math.max(4, window.innerWidth - rect.width - 4));
    py = PS.clamp(py, 4, Math.max(4, window.innerHeight - rect.height - 4));
    box.style.left = px + "px";
    box.style.top = py + "px";

    // drag by the title bar
    var drag = null;
    title.addEventListener("pointerdown", function (e) {
        if (e.target === closeBtn ||
            (e.target.closest && e.target.closest(".float-panel-close"))) { return; }
        var r = box.getBoundingClientRect();
        drag = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top };
        title.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    title.addEventListener("pointermove", function (e) {
        if (!drag) { return; }
        var nx = PS.clamp(drag.ox + (e.clientX - drag.sx), 0, window.innerWidth - 40);
        var ny = PS.clamp(drag.oy + (e.clientY - drag.sy), 0, window.innerHeight - 30);
        box.style.left = nx + "px";
        box.style.top = ny + "px";
    });
    function endDrag() { drag = null; }
    title.addEventListener("pointerup", endDrag);
    title.addEventListener("pointercancel", endDrag);

    return panel;
};

// form-row helper for dialogs: returns the input element
PS.dialogRow = function (body, labelText, input) {
    var row = document.createElement("div");
    row.className = "form-row";
    var label = document.createElement("label");
    label.textContent = labelText;
    row.appendChild(label);
    row.appendChild(input);
    body.appendChild(row);
    return input;
};

PS.numberInput = function (value, min, max) {
    var inp = document.createElement("input");
    inp.type = "number";
    inp.value = value;
    if (min !== undefined) { inp.min = min; }
    if (max !== undefined) { inp.max = max; }
    return inp;
};

PS.selectInput = function (options, value) {
    var sel = document.createElement("select");
    options.forEach(function (o) {
        var opt = document.createElement("option");
        opt.value = o.v;
        opt.textContent = o.l;
        sel.appendChild(opt);
    });
    sel.value = value;
    return sel;
};

/* ---------- options-bar widget builders ---------- */

PS.ui = {
    group: function (host) {
        var g = document.createElement("div");
        g.className = "opt-group";
        host.appendChild(g);
        return g;
    },
    label: function (host, text) {
        var l = document.createElement("span");
        l.className = "opt-label";
        l.textContent = text;
        host.appendChild(l);
        return l;
    },
    sep: function (host) {
        var s = document.createElement("div");
        s.className = "opt-sep";
        host.appendChild(s);
    },
    slider: function (host, labelText, value, min, max, step, onchange, format) {
        var g = PS.ui.group(host);
        PS.ui.label(g, labelText);
        var inp = document.createElement("input");
        inp.type = "range";
        inp.min = min; inp.max = max; inp.step = step || 1;
        inp.value = value;
        var val = document.createElement("span");
        val.className = "opt-label";
        var fmt = format || function (v) { return v; };
        val.textContent = fmt(value);
        inp.addEventListener("input", function () {
            var v = parseFloat(inp.value);
            val.textContent = fmt(v);
            onchange(v);
        });
        g.appendChild(inp);
        g.appendChild(val);
        return inp;
    },
    number: function (host, labelText, value, min, max, onchange) {
        var g = PS.ui.group(host);
        PS.ui.label(g, labelText);
        var inp = PS.numberInput(value, min, max);
        inp.addEventListener("change", function () {
            var v = parseFloat(inp.value);
            if (!isNaN(v)) { onchange(PS.clamp(v, min, max)); }
        });
        g.appendChild(inp);
        return inp;
    },
    select: function (host, labelText, options, value, onchange) {
        var g = PS.ui.group(host);
        if (labelText) { PS.ui.label(g, labelText); }
        var sel = PS.selectInput(options, value);
        sel.addEventListener("change", function () { onchange(sel.value); });
        g.appendChild(sel);
        return sel;
    },
    checkbox: function (host, labelText, value, onchange) {
        var g = PS.ui.group(host);
        var lab = document.createElement("label");
        lab.className = "opt-label";
        lab.style.display = "flex";
        lab.style.alignItems = "center";
        lab.style.gap = "4px";
        var inp = document.createElement("input");
        inp.type = "checkbox";
        inp.checked = !!value;
        inp.addEventListener("change", function () { onchange(inp.checked); });
        lab.appendChild(inp);
        lab.appendChild(document.createTextNode(labelText));
        g.appendChild(lab);
        return inp;
    },
    button: function (host, labelText, onclick) {
        var g = PS.ui.group(host);
        var btn = document.createElement("button");
        btn.textContent = labelText;
        btn.style.cssText =
            "background:var(--bg-input);border:1px solid var(--border);" +
            "border-radius:3px;padding:3px 10px;cursor:pointer";
        btn.addEventListener("click", onclick);
        g.appendChild(btn);
        return btn;
    }
};

/* ---------- colors ---------- */

PS.setFg = function (hex, skipRecent) {
    PS.fg = hex;
    PS.el("fg-well").style.background = hex;
    var ni = PS.el("fg-input");
    if (ni && /^#[0-9a-f]{6}$/i.test(hex)) { ni.value = hex; }
    var hexInp = document.querySelector("#panel-color-body .color-hex");
    if (hexInp) { hexInp.value = hex; }
    if (!skipRecent) { PS.pushRecentColor(hex); }
    PS.savePrefsDebounced();
};

PS.setBg = function (hex) {
    PS.bg = hex;
    PS.el("bg-well").style.background = hex;
    var ni = PS.el("bg-input");
    if (ni && /^#[0-9a-f]{6}$/i.test(hex)) { ni.value = hex; }
    PS.savePrefsDebounced();
};

PS.swapColors = function () {
    var f = PS.fg;
    PS.setFg(PS.bg, true);
    PS.setBg(f);
};

PS.resetColors = function () {
    PS.setFg("#000000", true);
    PS.setBg("#ffffff");
};

PS.pushRecentColor = function (hex) {
    var i = PS.recentColors.indexOf(hex);
    if (i >= 0) { PS.recentColors.splice(i, 1); }
    PS.recentColors.unshift(hex);
    if (PS.recentColors.length > 10) { PS.recentColors.length = 10; }
    PS.renderColorPanel();
};

// Built-in palettes the user can switch between.
PS.palettes = {
    "Basic": [
        "#000000", "#ffffff", "#7f7f7f", "#c3c3c3", "#880015", "#ed1c24", "#ff7f27", "#fff200",
        "#22b14c", "#00a2e8", "#3f48cc", "#a349a4", "#b97a57", "#ffaec9", "#ffc90e", "#efe4b0",
        "#b5e61d", "#99d9ea", "#7092be", "#c8bfe7"
    ],
    "Grayscale": [
        "#000000", "#1a1a1a", "#333333", "#4d4d4d", "#666666", "#808080", "#999999", "#b3b3b3",
        "#cccccc", "#e6e6e6", "#ffffff", "#2b2b2b", "#3f3f3f", "#545454", "#6e6e6e", "#8a8a8a",
        "#a5a5a5", "#bfbfbf", "#d9d9d9", "#f2f2f2"
    ],
    "Material": [
        "#f44336", "#e91e63", "#9c27b0", "#673ab7", "#3f51b5", "#2196f3", "#03a9f4", "#00bcd4",
        "#009688", "#4caf50", "#8bc34a", "#cddc39", "#ffeb3b", "#ffc107", "#ff9800", "#ff5722",
        "#795548", "#9e9e9e", "#607d8b", "#000000"
    ],
    "Pastel": [
        "#ffd1dc", "#ffe0ac", "#fff5ba", "#d0f0c0", "#b5ead7", "#c7ceea", "#e2c2ff", "#ffc8a2",
        "#f1c0e8", "#cfbaf0", "#a3c4f3", "#90dbf4", "#8eecf5", "#98f5e1", "#b9fbc0", "#fbf8cc",
        "#fde4cf", "#ffcfd2", "#f8c8dc", "#e8e8e4"
    ],
    "Web Safe": [
        "#ffffff", "#cccccc", "#999999", "#666666", "#333333", "#000000", "#ff0000", "#ff9900",
        "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#9900ff", "#ff00ff", "#990000", "#996600",
        "#009900", "#006666", "#000099", "#660099"
    ]
};

// kept for backwards compatibility with anything referencing it
PS.defaultSwatches = PS.palettes.Basic;

PS.activePalette = "Basic";
PS.customColors = [];

PS.addCustomColor = function (hex) {
    if (!hex) { return; }
    if (PS.customColors.indexOf(hex) >= 0) { return; }
    PS.customColors.push(hex);
    if (PS.customColors.length > 40) { PS.customColors.shift(); }
    PS.markDirty();
    PS.renderColorPanel();
    PS.savePrefsDebounced();
};

PS.removeCustomColor = function (hex) {
    var i = PS.customColors.indexOf(hex);
    if (i < 0) { return; }
    PS.customColors.splice(i, 1);
    PS.markDirty();
    PS.renderColorPanel();
    PS.savePrefsDebounced();
};

PS.renderColorPanel = function () {
    var body = PS.el("panel-color-body");
    body.innerHTML = "";

    var row = document.createElement("div");
    row.className = "color-row";

    var hexInp = document.createElement("input");
    hexInp.className = "color-hex";
    hexInp.value = PS.fg;
    hexInp.addEventListener("change", function () {
        var rgb = PS.hexToRgb(hexInp.value);
        if (rgb) { PS.setFg(PS.rgbToHex(rgb.r, rgb.g, rgb.b, rgb.a)); }
        else { hexInp.value = PS.fg; }
    });
    row.appendChild(hexInp);

    var pick = document.createElement("button");
    pick.textContent = "Pick...";
    pick.className = "color-pick-btn";
    pick.addEventListener("click", function () { PS.openColorPicker("fg"); });
    row.appendChild(pick);
    body.appendChild(row);

    // swatch grid; onpick selects FG, onremove (optional) right-click removes
    function addGrid(colors, onRemove) {
        var grid = document.createElement("div");
        grid.className = "swatch-grid";
        colors.forEach(function (c) {
            var s = document.createElement("div");
            s.className = "swatch";
            s.style.background = c;
            s.title = c + (onRemove ? "  (right-click to remove)" : "");
            s.addEventListener("click", function () { PS.setFg(c, true); });
            if (onRemove) {
                s.addEventListener("contextmenu", function (e) {
                    e.preventDefault();
                    onRemove(c);
                });
            }
            grid.appendChild(s);
        });
        body.appendChild(grid);
        return grid;
    }

    // palette selector
    var palRow = document.createElement("div");
    palRow.className = "palette-row";
    var sel = document.createElement("select");
    sel.className = "palette-select";
    Object.keys(PS.palettes).forEach(function (name) {
        var opt = document.createElement("option");
        opt.value = name; opt.textContent = name;
        if (name === PS.activePalette) { opt.selected = true; }
        sel.appendChild(opt);
    });
    sel.addEventListener("change", function () {
        PS.activePalette = sel.value;
        PS.renderColorPanel();
        PS.savePrefsDebounced();
    });
    palRow.appendChild(sel);
    body.appendChild(palRow);

    addGrid(PS.palettes[PS.activePalette] || PS.palettes.Basic);

    // custom colors, with an "add current" button
    var customLab = document.createElement("div");
    customLab.className = "swatch-label custom-label";
    var labText = document.createElement("span");
    labText.textContent = "Custom";
    customLab.appendChild(labText);
    var addBtn = document.createElement("button");
    addBtn.className = "add-swatch-btn";
    addBtn.textContent = "+ Add";
    addBtn.title = "Add the current foreground color";
    addBtn.addEventListener("click", function () { PS.addCustomColor(PS.fg); });
    customLab.appendChild(addBtn);
    body.appendChild(customLab);

    if (PS.customColors.length) {
        addGrid(PS.customColors, PS.removeCustomColor);
    } else {
        var hint = document.createElement("div");
        hint.className = "swatch-hint";
        hint.textContent = "Click + Add to save the current color here.";
        body.appendChild(hint);
    }

    if (PS.recentColors.length) {
        var lab = document.createElement("div");
        lab.className = "swatch-label";
        lab.textContent = "Recent";
        body.appendChild(lab);
        addGrid(PS.recentColors);
    }
};

/* ---------- preferences (stored via backend/prefs.js AGI script) ---------- */

PS._prefsTimer = null;

PS.savePrefsDebounced = function () {
    if (PS._prefsTimer) { clearTimeout(PS._prefsTimer); }
    PS._prefsTimer = setTimeout(PS.savePrefsNow, 1500);
};

PS.savePrefsNow = function () {
    PS._prefsTimer = null;
    var data = {
        fg: PS.fg,
        bg: PS.bg,
        tool: PS.tool,
        toolOpts: PS.toolOpts,
        recentColors: PS.recentColors,
        customColors: PS.customColors,
        activePalette: PS.activePalette,
        rulersOn: PS.rulersOn,
        snapToGuides: PS.snapToGuides
    };
    try {
        localStorage.setItem("pixelstudio_prefs", JSON.stringify(data));
    } catch (e) { /* storage may be unavailable */ }
    if (PS.inArozOS()) {
        try {
            ao_module_agirun("Pixel Studio/backend/prefs.js",
                { action: "set", data: JSON.stringify(data) },
                function () { }, function () { });
        } catch (e) { /* offline / standalone */ }
    }
};

PS.loadPrefs = function (done) {
    function apply(data) {
        if (!data) { done(); return; }
        try {
            if (data.fg) { PS.setFg(data.fg, true); }
            if (data.bg) { PS.setBg(data.bg); }
            if (data.recentColors) { PS.recentColors = data.recentColors; }
            if (Array.isArray(data.customColors)) { PS.customColors = data.customColors; }
            if (data.activePalette && PS.palettes[data.activePalette]) {
                PS.activePalette = data.activePalette;
            }
            if (data.toolOpts) {
                Object.keys(data.toolOpts).forEach(function (k) {
                    if (PS.toolOpts[k]) {
                        Object.assign(PS.toolOpts[k], data.toolOpts[k]);
                    }
                });
            }
            PS.prefs = data;
        } catch (e) { /* corrupted prefs are non-fatal */ }
        done();
    }

    if (PS.inArozOS()) {
        try {
            ao_module_agirun("Pixel Studio/backend/prefs.js", { action: "get" },
                function (data) {
                    if (typeof data === "string") {
                        try { data = JSON.parse(data); } catch (e) { data = null; }
                    }
                    apply(data);
                },
                function () { apply(PS._localPrefs()); });
            return;
        } catch (e) { /* fall through */ }
    }
    apply(PS._localPrefs());
};

PS._localPrefs = function () {
    try {
        return JSON.parse(localStorage.getItem("pixelstudio_prefs") || "null");
    } catch (e) { return null; }
};
