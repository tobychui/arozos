/*
    Pixel Studio - tool framework and built-in tools
    Left toolbar, options bar, pointer event pipeline, brush engine,
    shape drawing, selection tools, move / zoom / hand.
*/
"use strict";

/* ---------- default tool options (persisted in prefs) ---------- */

PS.toolOpts = {
    brush: { size: 24, hardness: 0.8, opacity: 1, flow: 0.7, type: "round" },
    pencil: { size: 3, opacity: 1 },
    eraser: { size: 30, opacity: 1, type: "round" },
    fill: { tolerance: 32, contiguous: true },
    wand: { tolerance: 32, contiguous: true, smart: true, edgeThreshold: 60 },
    marquee: { feather: 0 },
    shape: { kind: "rect", mode: "both", strokeWidth: 6, radius: 12, points: 5 },
    text: { font: "Arial", size: 48, bold: false, italic: false },
    zoom: {}
};

/* ---------- toolbar grouping (fly-out submenus) ---------- */

// Toolbar entries: single tools, tool groups (one button + right-click
// fly-out), and the shape picker (fly-out chooses the shape kind visually).
PS.toolbarLayout = [
    { kind: "single", tool: "move" },
    { kind: "group", id: "select", tools: ["marquee-rect", "marquee-ellipse", "lasso", "lasso-poly"] },
    { kind: "single", tool: "wand" },
    { kind: "group", id: "paint", tools: ["brush", "pencil"] },
    { kind: "single", tool: "eraser" },
    { kind: "single", tool: "fill" },
    { kind: "single", tool: "eyedropper" },
    { kind: "single", tool: "text" },
    { kind: "shape" },
    { kind: "single", tool: "hand" },
    { kind: "single", tool: "zoom" }
];

// Last-selected member shown on each group's toolbar button.
PS.groupRep = { select: "marquee-rect", paint: "brush" };

// Per-shape-kind icons for the shape fly-out and toolbar button.
PS.shapeIcons = {
    rect: '<svg viewBox="0 0 24 24" stroke-width="1.6"><rect x="4" y="6" width="16" height="12"/></svg>',
    rounded: '<svg viewBox="0 0 24 24" stroke-width="1.6"><rect x="4" y="6" width="16" height="12" rx="3.5"/></svg>',
    ellipse: '<svg viewBox="0 0 24 24" stroke-width="1.6"><ellipse cx="12" cy="12" rx="8" ry="6"/></svg>',
    line: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M5 19 19 5"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M4 20 20 4M20 4h-6M20 4v6"/></svg>',
    triangle: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M12 5 20 19H4z"/></svg>',
    star: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M12 3.5l2.5 5.6 6.1.6-4.6 4 1.4 6-5.4-3.2L6.1 19.7l1.4-6L2.9 9.7l6.1-.6z"/></svg>'
};

/* ---------- framework ---------- */

PS.registerTool = function (id, def) {
    def.id = id;
    PS.tools[id] = def;
};

PS.setTool = function (id) {
    if (!PS.tools[id]) { return; }
    if (PS.commitTextEdit) { PS.commitTextEdit(); }
    PS.closeToolFlyout();
    var old = PS.tools[PS.tool];
    if (old && old.deactivate) { old.deactivate(); }
    PS.tool = id;
    // remember this tool as its toolbar group's representative
    PS.toolbarLayout.forEach(function (entry) {
        if (entry.kind === "group" && entry.tools.indexOf(id) >= 0) {
            PS.groupRep[entry.id] = id;
        }
    });
    PS.renderToolbar();
    PS.renderOptionsBar();
    var ws = PS.el("workspace");
    ws.style.cursor = PS.tools[id].cursor || "crosshair";
    PS.savePrefsDebounced();
};

PS.renderToolbar = function () {
    var host = PS.el("toolbar-buttons");
    host.innerHTML = "";
    PS.toolbarLayout.forEach(function (entry) {
        if (entry.kind === "single") {
            host.appendChild(PS._singleToolBtn(entry.tool));
        } else if (entry.kind === "group") {
            host.appendChild(PS._groupToolBtn(entry));
        } else if (entry.kind === "shape") {
            host.appendChild(PS._shapeToolBtn());
        }
    });
};

// build the base toolbar button (icon, active state, optional fly-out triangle)
PS._toolBtn = function (icon, title, active, hasFlyout) {
    var btn = document.createElement("button");
    btn.className = "tool-btn" + (active ? " active" : "");
    btn.title = title;
    btn.innerHTML = icon;
    if (hasFlyout) {
        var tri = document.createElement("span");
        tri.className = "flyout-tri";
        btn.appendChild(tri);
    }
    return btn;
};

PS._singleToolBtn = function (id) {
    var def = PS.tools[id];
    var btn = PS._toolBtn(def.icon,
        def.name + (def.key ? " (" + def.key.toUpperCase() + ")" : ""),
        PS.tool === id, false);
    btn.addEventListener("click", function () { PS.setTool(id); });
    return btn;
};

PS._groupToolBtn = function (entry) {
    var inGroup = entry.tools.indexOf(PS.tool) >= 0;
    var rep = inGroup ? PS.tool : PS.groupRep[entry.id];
    if (entry.tools.indexOf(rep) < 0) { rep = entry.tools[0]; }
    var def = PS.tools[rep];
    var btn = PS._toolBtn(def.icon,
        def.name + " — right-click for more", inGroup, true);
    btn.addEventListener("click", function () { PS.setTool(rep); });
    btn.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        PS.openToolFlyout(btn, entry.tools.map(function (t) {
            var d = PS.tools[t];
            return {
                icon: d.icon, label: d.name, active: PS.tool === t,
                onSelect: function () { PS.setTool(t); }
            };
        }));
    });
    return btn;
};

PS._shapeToolBtn = function () {
    var kind = PS.toolOpts.shape.kind;
    var icon = PS.shapeIcons[kind] || PS.tools.shape.icon;
    var btn = PS._toolBtn(icon, "Shape — right-click to pick a shape",
        PS.tool === "shape", true);
    btn.addEventListener("click", function () { PS.setTool("shape"); });
    btn.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        PS.openToolFlyout(btn, PS.shapeKinds.map(function (k) {
            return {
                icon: PS.shapeIcons[k.v] || PS.tools.shape.icon,
                label: k.l,
                active: PS.tool === "shape" && PS.toolOpts.shape.kind === k.v,
                onSelect: function () {
                    PS.toolOpts.shape.kind = k.v;
                    PS.setTool("shape");
                    PS.savePrefsDebounced();
                }
            };
        }));
    });
    return btn;
};

/* ---------- tool fly-out submenu ---------- */

PS._toolFlyout = null;

PS.openToolFlyout = function (btn, items) {
    PS.closeToolFlyout();
    var fly = document.createElement("div");
    fly.className = "tool-flyout";
    items.forEach(function (it) {
        var row = document.createElement("div");
        row.className = "tool-flyout-item" + (it.active ? " active" : "");
        var ic = document.createElement("span");
        ic.className = "tfi-icon";
        ic.innerHTML = it.icon;
        var lb = document.createElement("span");
        lb.className = "tfi-label";
        lb.textContent = it.label;
        row.appendChild(ic);
        row.appendChild(lb);
        row.addEventListener("click", function (e) {
            e.stopPropagation();
            PS.closeToolFlyout();
            it.onSelect();
        });
        fly.appendChild(row);
    });
    document.body.appendChild(fly);

    // open to the right of the button, top edge aligned with the button top
    var r = btn.getBoundingClientRect();
    fly.style.left = Math.round(r.right + 2) + "px";
    fly.style.top = Math.round(r.top) + "px";
    var fr = fly.getBoundingClientRect();
    if (fr.bottom > window.innerHeight - 4) {
        fly.style.top = Math.max(4, window.innerHeight - fr.height - 4) + "px";
    }

    PS._toolFlyout = fly;
    setTimeout(function () {
        document.addEventListener("pointerdown", PS._flyoutOutside, true);
        document.addEventListener("keydown", PS._flyoutKey, true);
    }, 0);
};

PS.closeToolFlyout = function () {
    if (PS._toolFlyout) { PS._toolFlyout.remove(); PS._toolFlyout = null; }
    document.removeEventListener("pointerdown", PS._flyoutOutside, true);
    document.removeEventListener("keydown", PS._flyoutKey, true);
};

PS._flyoutOutside = function (e) {
    if (PS._toolFlyout && !PS._toolFlyout.contains(e.target)) { PS.closeToolFlyout(); }
};

PS._flyoutKey = function (e) {
    if (e.key === "Escape") { PS.closeToolFlyout(); }
};

PS.renderOptionsBar = function () {
    var host = PS.el("optionsbar");
    host.innerHTML = "";
    var def = PS.tools[PS.tool];
    if (!def) { return; }
    var name = document.createElement("span");
    name.className = "tool-name";
    name.textContent = def.name;
    host.appendChild(name);
    if (def.options) { def.options(host); }
};

/* ---------- pointer event pipeline ---------- */

PS._pointer = { down: false, panning: false, panStart: null };

PS.bindWorkspaceEvents = function () {
    var ws = PS.el("workspace");

    ws.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    ws.addEventListener("pointerdown", function (e) {
        if (!PS.doc) { return; }
        if (e.button === 2) { return; }
        // ignore presses on the workspace scrollbars
        var wsRect = ws.getBoundingClientRect();
        if (e.clientX - wsRect.left > ws.clientWidth ||
            e.clientY - wsRect.top > ws.clientHeight) {
            return;
        }
        ws.setPointerCapture(e.pointerId);
        PS._pointer.down = true;

        if (e.button === 1 || PS.spacePan || PS.tool === "hand") {
            PS._pointer.panning = true;
            PS._pointer.panStart = {
                x: e.clientX, y: e.clientY,
                sl: ws.scrollLeft, st: ws.scrollTop
            };
            ws.style.cursor = "grabbing";
            e.preventDefault();
            return;
        }

        var raw = PS.eventToDoc(e);
        var pt = PS.snapDocPoint(raw);
        if (PS.selTransform.onDown(pt, e)) {
            e.preventDefault();
            return;
        }
        // grab an existing guide (Move tool) before handing off to the tool
        if (PS.guideDragStart(raw)) {
            e.preventDefault();
            return;
        }
        var def = PS.tools[PS.tool];
        if (def && def.onDown) { def.onDown(pt, e); }
        e.preventDefault();
    });

    ws.addEventListener("pointermove", function (e) {
        if (!PS.doc) { return; }
        var raw = PS.eventToDoc(e);
        PS.cursorPos = PS.snapDocPoint(raw);
        PS.updateCursorStatus();

        if (PS._pointer.panning) {
            var p = PS._pointer.panStart;
            ws.scrollLeft = p.sl - (e.clientX - p.x);
            ws.scrollTop = p.st - (e.clientY - p.y);
            return;
        }

        if (PS.guidesDragging()) {
            PS.guideDragMove(raw);
            return;
        }

        if (PS.selTransform.dragging) {
            PS.selTransform.onMove(PS.cursorPos);
            return;
        }

        // Update cursor for handle / guide hover (only when not mid-stroke/drag)
        if (!PS._pointer.down) {
            var tCursor = PS.selTransform.getCursor(PS.cursorPos);
            if (!tCursor) {
                var gh = PS.guideHitTest(raw);
                if (gh) { tCursor = (gh.orient === "h") ? "row-resize" : "col-resize"; }
            }
            ws.style.cursor = tCursor || (PS.tools[PS.tool] || {}).cursor || "crosshair";
        }

        var def = PS.tools[PS.tool];
        if (def && def.onMove) { def.onMove(PS.cursorPos, e); }
    });

    function finish(e) {
        if (!PS.doc) { return; }
        if (PS._pointer.panning) {
            PS._pointer.panning = false;
            ws.style.cursor = (PS.tools[PS.tool] || {}).cursor || "crosshair";
        } else if (PS.guidesDragging()) {
            PS.guideDragEnd(PS.eventToDoc(e));
            ws.style.cursor = (PS.tools[PS.tool] || {}).cursor || "crosshair";
        } else if (PS.selTransform.dragging) {
            PS.selTransform.onUp();
            ws.style.cursor = (PS.tools[PS.tool] || {}).cursor || "crosshair";
        } else if (PS._pointer.down) {
            var def = PS.tools[PS.tool];
            if (def && def.onUp) { def.onUp(PS.snapDocPoint(PS.eventToDoc(e)), e); }
        }
        PS._pointer.down = false;
    }

    ws.addEventListener("pointerup", finish);
    ws.addEventListener("pointercancel", finish);

    ws.addEventListener("dblclick", function (e) {
        var def = PS.tools[PS.tool];
        if (def && def.onDblClick) { def.onDblClick(PS.eventToDoc(e), e); }
    });

    // Ctrl+wheel zoom at pointer, plain wheel scrolls (default)
    ws.addEventListener("wheel", function (e) {
        if (!PS.doc) { return; }
        if (e.ctrlKey) {
            e.preventDefault();
            var pt = PS.eventToDoc(e);
            PS.setZoom(PS.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), pt);
        }
    }, { passive: false });

    ws.addEventListener("pointerleave", function () {
        PS.cursorPos = null;
        PS.updateCursorStatus();
    });
};

/* ---------- shared helpers ---------- */

// selection combine mode from modifier keys
PS.selModeFromEvent = function (e) {
    if (e.shiftKey && e.altKey) { return "intersect"; }
    if (e.shiftKey) { return "add"; }
    if (e.altKey) { return "subtract"; }
    return "replace";
};

PS.requirePaintableLayer = function () {
    var layer = PS.activeLayer();
    if (!layer) { return null; }
    if (layer.type === "text") {
        PS.toast("Text layer: rasterize it first (Layer menu) to paint on it", true);
        return null;
    }
    if (!layer.visible) {
        PS.toast("Layer is hidden", true);
        return null;
    }
    return layer;
};

PS.sampleColorAt = function (pt, comp, toBg) {
    var x = Math.floor(pt.x), y = Math.floor(pt.y);
    if (x < 0 || y < 0 || x >= PS.doc.width || y >= PS.doc.height) { return; }
    var d = comp.getContext("2d").getImageData(x, y, 1, 1).data;
    if (d[3] === 0) { return; }
    var hex = PS.rgbToHex(d[0], d[1], d[2], d[3]);
    if (toBg) { PS.setBg(hex); } else { PS.setFg(hex); }
};

// draw helper used by tool overlays: transform overlay ctx into doc space
PS.overlayDocSpace = function (ctx, fn) {
    var origin = PS.docToOverlay(0, 0);
    ctx.save();
    ctx.translate(origin.x, origin.y);
    ctx.scale(PS.zoom, PS.zoom);
    fn(1 / PS.zoom); // pass screen-pixel size in doc units
    ctx.restore();
};

/* ============================================================
   BRUSH ENGINE (brush / pencil / eraser)
   Stamps are accumulated at full opacity into a stroke buffer which
   is composited onto the layer with the stroke opacity on release,
   clipped by the selection. This gives Photoshop-style opacity
   semantics (self-overlapping strokes do not darken).
   ============================================================ */

PS.strokeTypes = [
    { v: "round", l: "Round" },
    { v: "soft", l: "Soft Round" },
    { v: "calligraphy", l: "Calligraphy" },
    { v: "marker", l: "Marker" },
    { v: "spray", l: "Airbrush / Spray" }
];

PS._stroke = null;

PS.beginStroke = function (kind, pt, e) {
    if (e.altKey && kind !== "eraser") {
        PS.sampleColorAt(pt, PS.compositeToCanvas(), false);
        return;
    }
    var layer = PS.requirePaintableLayer();
    if (!layer) { return; }
    var opts = PS.toolOpts[kind];

    // Stamps are drawn opaque into the buffer; the foreground color's alpha is
    // applied (with the stroke opacity) at composite time so self-overlap
    // within a stroke does not darken.
    var rgb = PS.hexToRgb(PS.fg) || { r: 0, g: 0, b: 0, a: 255 };
    var colorAlpha = (kind === "eraser") ? 1 : (rgb.a === undefined ? 1 : rgb.a / 255);

    PS._stroke = {
        kind: kind,
        layer: layer,
        opts: opts,
        color: (kind === "eraser") ? "#000000" : PS.rgbToHex(rgb.r, rgb.g, rgb.b),
        colorAlpha: colorAlpha,
        before: PS.snapshotLayer(layer),
        canvas: PS.createCanvas(PS.doc.width, PS.doc.height),
        last: pt,
        rest: 0
    };
    PS._stroke.ctx = PS._stroke.canvas.getContext("2d");

    PS.strokePreview = {
        layer: layer,
        canvas: PS._stroke.canvas,
        opacity: opts.opacity * colorAlpha,
        erase: kind === "eraser"
    };

    PS.stampSegment(pt, pt);
    PS.requestRender();
};

PS.continueStroke = function (pt) {
    if (!PS._stroke) { return; }
    PS.stampSegment(PS._stroke.last, pt);
    PS._stroke.last = pt;
    PS.requestRender();
};

PS.endStroke = function () {
    var s = PS._stroke;
    if (!s) { return; }

    var buf = s.canvas;
    if (PS.doc.selection) {
        var masked = PS.cloneCanvas(buf);
        var mctx = masked.getContext("2d");
        mctx.globalCompositeOperation = "destination-in";
        mctx.drawImage(PS.doc.selection.mask, 0, 0);
        buf = masked;
    }

    var ctx = s.layer.canvas.getContext("2d");
    ctx.globalAlpha = s.opts.opacity * (s.colorAlpha === undefined ? 1 : s.colorAlpha);
    ctx.globalCompositeOperation = (s.kind === "eraser") ? "destination-out" : "source-over";
    ctx.drawImage(buf, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    PS.strokePreview = null;
    PS._stroke = null;

    var labels = { brush: "Brush Stroke", pencil: "Pencil", eraser: "Eraser" };
    PS.commitLayerCanvas(labels[s.kind], s.layer, s.before);
    PS.requestRender();
};

PS.stampSegment = function (from, to) {
    var s = PS._stroke;
    var opts = s.opts;
    var ctx = s.ctx;
    var size = opts.size;
    var color = s.color;

    if (s.kind === "pencil") {
        // crisp pixel stamps along the line
        ctx.fillStyle = color;
        var dist = Math.hypot(to.x - from.x, to.y - from.y);
        var steps = Math.max(1, Math.ceil(dist));
        for (var i = 0; i <= steps; i++) {
            var t = i / steps;
            var x = from.x + (to.x - from.x) * t;
            var y = from.y + (to.y - from.y) * t;
            ctx.fillRect(Math.round(x - size / 2), Math.round(y - size / 2), size, size);
        }
        return;
    }

    var type = (s.kind === "eraser") ? opts.type : opts.type;

    if (type === "round") {
        // continuous segments give the smoothest hard-round result
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = size;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        if (from.x === to.x && from.y === to.y) {
            ctx.beginPath();
            ctx.arc(to.x, to.y, size / 2, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.stroke();
        }
        return;
    }

    // spaced stamps for textured stroke types
    var spacingByType = { soft: 0.15, calligraphy: 0.08, marker: 0.25, spray: 0.3 };
    var spacing = Math.max(1, size * (spacingByType[type] || 0.2));
    var dx = to.x - from.x, dy = to.y - from.y;
    var dist2 = Math.hypot(dx, dy);

    if (dist2 === 0) {
        PS.stampAt(ctx, to.x, to.y, type, size, color, opts);
        return;
    }

    var travelled = s.rest;
    while (travelled <= dist2) {
        var tt = travelled / dist2;
        PS.stampAt(ctx, from.x + dx * tt, from.y + dy * tt, type, size, color, opts);
        travelled += spacing;
    }
    s.rest = travelled - dist2;
};

PS.stampAt = function (ctx, x, y, type, size, color, opts) {
    var r = size / 2;
    var rgb = PS.hexToRgb(color) || { r: 0, g: 0, b: 0 };

    if (type === "soft") {
        var g = ctx.createRadialGradient(x, y, 0, x, y, r);
        var solid = "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + ",1)";
        var clear = "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + ",0)";
        var hard = PS.clamp(opts.hardness !== undefined ? opts.hardness : 0.5, 0, 0.99);
        g.addColorStop(0, solid);
        g.addColorStop(hard, solid);
        g.addColorStop(1, clear);
        ctx.globalAlpha = opts.flow !== undefined ? opts.flow : 0.6;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    } else if (type === "calligraphy") {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-Math.PI / 4);
        ctx.scale(1, 0.3);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    } else if (type === "marker") {
        ctx.globalAlpha = (opts.flow !== undefined ? opts.flow : 0.6) * 0.6;
        ctx.fillStyle = color;
        ctx.fillRect(x - r, y - r, size, size);
        ctx.globalAlpha = 1;
    } else if (type === "spray") {
        ctx.fillStyle = color;
        var dots = Math.max(6, Math.round(size * 0.8));
        for (var i = 0; i < dots; i++) {
            var ang = Math.random() * Math.PI * 2;
            var rad = Math.sqrt(Math.random()) * r;
            var dr = 0.5 + Math.random();
            ctx.globalAlpha = 0.25;
            ctx.beginPath();
            ctx.arc(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad, dr, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
};

// circular size cursor for paint tools
PS.paintCursorOverlay = function (size, square) {
    return function (ctx) {
        if (!PS.cursorPos || PS._pointer.panning) { return; }
        var p = PS.docToOverlay(PS.cursorPos.x, PS.cursorPos.y);
        var r = (typeof size === "function" ? size() : size) * PS.zoom / 2;
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (square) {
            ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
        } else {
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        }
        ctx.stroke();
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.beginPath();
        if (square) {
            ctx.rect(p.x - r - 1, p.y - r - 1, r * 2 + 2, r * 2 + 2);
        } else {
            ctx.arc(p.x, p.y, r + 1, 0, Math.PI * 2);
        }
        ctx.stroke();
    };
};

/* ============================================================
   TOOL DEFINITIONS
   ============================================================ */

/* ----- Move (V) ----- */
(function () {
    var drag = null;

    PS.registerTool("move", {
        name: "Move",
        key: "v",
        cursor: "move",
        icon: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/></svg>',
        options: function (host) {
            PS.ui.label(host, "Drag to move the active layer; with a selection, drags the selected pixels. Arrow keys nudge.");
        },
        onDown: function (pt, e) {
            var layer = PS.activeLayer();
            if (!layer) { return; }

            if (layer.type === "text") {
                drag = { mode: "text", layer: layer, start: pt, ox: layer.text.x, oy: layer.text.y };
                return;
            }

            var sel = PS.doc.selection;
            var inSel = sel && PS.pointInSelection(pt);

            var base = PS.cloneCanvas(layer.canvas);
            var float;
            if (inSel) {
                float = PS.getSelectedPixels(layer.canvas).canvas;
                var bctx = base.getContext("2d");
                bctx.globalCompositeOperation = "destination-out";
                bctx.drawImage(sel.mask, 0, 0);
            } else {
                float = PS.cloneCanvas(layer.canvas);
                base.getContext("2d").clearRect(0, 0, base.width, base.height);
            }

            drag = {
                mode: "raster",
                layer: layer,
                start: pt,
                before: PS.snapshotLayer(layer),
                beforeSel: sel,
                base: base,
                float: float,
                withSel: !!inSel,
                preview: PS.createCanvas(PS.doc.width, PS.doc.height),
                dx: 0, dy: 0
            };
        },
        onMove: function (pt) {
            if (!drag) { return; }
            if (drag.mode === "text") {
                drag.layer.text.x = drag.ox + (pt.x - drag.start.x);
                drag.layer.text.y = drag.oy + (pt.y - drag.start.y);
                PS.renderTextLayer(drag.layer);
                PS.requestRender();
                return;
            }
            drag.dx = Math.round(pt.x - drag.start.x);
            drag.dy = Math.round(pt.y - drag.start.y);
            var pctx = drag.preview.getContext("2d");
            pctx.clearRect(0, 0, drag.preview.width, drag.preview.height);
            pctx.drawImage(drag.base, 0, 0);
            pctx.drawImage(drag.float, drag.dx, drag.dy);
            PS.layerOverride = { layer: drag.layer, canvas: drag.preview };
            PS.requestRender();
        },
        onUp: function () {
            if (!drag) { return; }
            if (drag.mode === "text") {
                var layer = drag.layer, ox = drag.ox, oy = drag.oy;
                var nx = layer.text.x, ny = layer.text.y;
                if (nx !== ox || ny !== oy) {
                    PS.pushHistory("Move Text",
                        function () { layer.text.x = ox; layer.text.y = oy; PS.renderTextLayer(layer); },
                        function () { layer.text.x = nx; layer.text.y = ny; PS.renderTextLayer(layer); });
                }
                drag = null;
                return;
            }

            PS.layerOverride = null;
            if (drag.dx !== 0 || drag.dy !== 0) {
                var lyr = drag.layer;
                var ctx = lyr.canvas.getContext("2d");
                ctx.clearRect(0, 0, lyr.canvas.width, lyr.canvas.height);
                ctx.drawImage(drag.base, 0, 0);
                ctx.drawImage(drag.float, drag.dx, drag.dy);

                var beforeCanvas = drag.before;
                var afterCanvas = PS.cloneCanvas(lyr.canvas);
                var beforeSel = drag.beforeSel;
                var afterSel = beforeSel;
                if (drag.withSel) {
                    PS.translateSelection(drag.dx, drag.dy);
                    afterSel = PS.doc.selection;
                }
                PS.pushHistory("Move",
                    function () {
                        PS.restoreLayerCanvas(lyr, beforeCanvas);
                        PS.doc.selection = beforeSel;
                    },
                    function () {
                        PS.restoreLayerCanvas(lyr, afterCanvas);
                        PS.doc.selection = afterSel;
                    });
            }
            drag = null;
            PS.requestRender();
        }
    });

    // arrow-key nudge (called from hotkeys)
    PS.nudgeMove = function (dx, dy) {
        var layer = PS.activeLayer();
        if (!layer) { return; }
        if (layer.type === "text") {
            layer.text.x += dx; layer.text.y += dy;
            PS.renderTextLayer(layer);
            PS.requestRender();
            PS.markDirty();
            return;
        }
        var before = PS.snapshotLayer(layer);
        var moved = PS.createCanvas(PS.doc.width, PS.doc.height);
        moved.getContext("2d").drawImage(layer.canvas, dx, dy);
        var ctx = layer.canvas.getContext("2d");
        ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        ctx.drawImage(moved, 0, 0);
        if (PS.doc.selection) { PS.translateSelection(dx, dy); }
        PS.commitLayerCanvas("Nudge", layer, before);
        PS.requestRender();
    };

    PS.pointInSelection = function (pt) {
        var sel = PS.doc.selection;
        if (!sel) { return false; }
        var x = Math.floor(pt.x), y = Math.floor(pt.y);
        if (x < 0 || y < 0 || x >= PS.doc.width || y >= PS.doc.height) { return false; }
        var a = sel.mask.getContext("2d").getImageData(x, y, 1, 1).data[3];
        return a >= 128;
    };
})();

/* ----- Marquee selections (M) ----- */
(function () {
    function makeMarquee(id, name, ellipse, icon) {
        var drag = null;
        PS.registerTool(id, {
            name: name,
            key: "m",
            group: "marquee",
            cursor: "crosshair",
            icon: icon,
            options: function (host) {
                PS.ui.slider(host, "Feather", PS.toolOpts.marquee.feather, 0, 50, 1, function (v) {
                    PS.toolOpts.marquee.feather = v;
                    PS.savePrefsDebounced();
                }, function (v) { return v + "px"; });
                PS.ui.label(host, "Shift adds, Alt subtracts from a selection");
            },
            onDown: function (pt, e) {
                drag = { start: pt, cur: pt, mode: PS.selModeFromEvent(e), constrain: false };
            },
            onMove: function (pt, e) {
                if (!drag) { return; }
                drag.cur = pt;
                drag.constrain = e.shiftKey && drag.mode === "replace";
            },
            onUp: function (pt) {
                if (!drag) { return; }
                var r = normRect(drag.start, drag.cur, drag.constrain);
                var mode = drag.mode;
                drag = null;
                if (r.w < 2 && r.h < 2) {
                    if (mode === "replace") { PS.deselect(); }
                    return;
                }
                var mask = PS.maskFromRect(r.x, r.y, r.w, r.h, ellipse);
                var feather = PS.toolOpts.marquee.feather;
                if (feather > 0) {
                    var soft = PS.makeMaskCanvas();
                    var sctx = soft.getContext("2d");
                    sctx.filter = "blur(" + feather + "px)";
                    sctx.drawImage(mask, 0, 0);
                    sctx.filter = "none";
                    mask = soft;
                }
                PS.setSelection(mask, mode, name);
            },
            overlay: function (ctx) {
                if (!drag) { return; }
                var r = normRect(drag.start, drag.cur, drag.constrain);
                PS.overlayDocSpace(ctx, function (px) {
                    ctx.lineWidth = px;
                    ctx.setLineDash([4 * px, 4 * px]);
                    ctx.strokeStyle = "#fff";
                    ctx.beginPath();
                    if (ellipse) {
                        ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
                    } else {
                        ctx.rect(r.x, r.y, r.w, r.h);
                    }
                    ctx.stroke();
                    ctx.strokeStyle = "#000";
                    ctx.lineDashOffset = 4 * px;
                    ctx.stroke();
                });
            }
        });
    }

    function normRect(a, b, constrain) {
        var w = b.x - a.x, h = b.y - a.y;
        if (constrain) {
            var m = Math.max(Math.abs(w), Math.abs(h));
            w = (w < 0 ? -m : m);
            h = (h < 0 ? -m : m);
        }
        return {
            x: Math.min(a.x, a.x + w),
            y: Math.min(a.y, a.y + h),
            w: Math.abs(w),
            h: Math.abs(h)
        };
    }

    makeMarquee("marquee-rect", "Rectangular Marquee", false,
        '<svg viewBox="0 0 24 24" stroke-width="1.6"><rect x="4" y="6" width="16" height="12" stroke-dasharray="3 2.5"/></svg>');
    makeMarquee("marquee-ellipse", "Elliptical Marquee", true,
        '<svg viewBox="0 0 24 24" stroke-width="1.6"><ellipse cx="12" cy="12" rx="8" ry="6" stroke-dasharray="3 2.5"/></svg>');
})();

/* ----- Lasso tools (L) ----- */
(function () {
    // freehand lasso
    var path = null;
    PS.registerTool("lasso", {
        name: "Lasso",
        key: "l",
        group: "lasso",
        cursor: "crosshair",
        icon: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M5 10c0-3.5 3.5-6 7.5-6S20 6.5 20 10s-3.5 6-7.5 6c-1.2 0-2.4-.2-3.4-.6M8 14.5c-1 2.5-2.5 4-4.5 4.5M8 14.5c.6 1.4.2 2.8-1 3.4"/></svg>',
        options: function (host) {
            PS.ui.label(host, "Drag a freehand selection. Shift adds, Alt subtracts.");
        },
        onDown: function (pt, e) {
            path = { points: [pt], mode: PS.selModeFromEvent(e) };
        },
        onMove: function (pt) {
            if (!path) { return; }
            var last = path.points[path.points.length - 1];
            if (Math.hypot(pt.x - last.x, pt.y - last.y) >= 1.5) {
                path.points.push(pt);
            }
        },
        onUp: function () {
            if (!path) { return; }
            var pts = path.points, mode = path.mode;
            path = null;
            if (pts.length < 3) {
                if (mode === "replace") { PS.deselect(); }
                return;
            }
            PS.setSelection(PS.maskFromPolygon(pts), mode, "Lasso");
        },
        overlay: function (ctx) {
            if (!path || path.points.length < 2) { return; }
            drawPolyOverlay(ctx, path.points, false);
        }
    });

    // polygonal lasso
    var poly = null;
    PS.registerTool("lasso-poly", {
        name: "Polygonal Lasso",
        key: "l",
        group: "lasso",
        cursor: "crosshair",
        icon: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M4 16 9 5l7 2 4 7-6 5z" stroke-dasharray="3 2"/></svg>',
        options: function (host) {
            PS.ui.label(host, "Click to add points; double-click, Enter, or click the first point to close. Esc cancels.");
        },
        onDown: function (pt, e) {
            if (!poly) {
                poly = { points: [pt], mode: PS.selModeFromEvent(e) };
                return;
            }
            // close if clicking near the starting point
            var first = poly.points[0];
            if (Math.hypot(pt.x - first.x, pt.y - first.y) * PS.zoom < 9 && poly.points.length >= 3) {
                PS.finishPolyLasso();
                return;
            }
            poly.points.push(pt);
        },
        onDblClick: function () { PS.finishPolyLasso(); },
        onKey: function (e) {
            if (e.key === "Enter") { PS.finishPolyLasso(); return true; }
            if (e.key === "Escape") { poly = null; return true; }
            return false;
        },
        deactivate: function () { poly = null; },
        overlay: function (ctx) {
            if (!poly) { return; }
            var pts = poly.points.slice();
            if (PS.cursorPos) { pts.push(PS.cursorPos); }
            drawPolyOverlay(ctx, pts, true);
        }
    });

    PS.finishPolyLasso = function () {
        if (!poly || poly.points.length < 3) { poly = null; return; }
        var pts = poly.points, mode = poly.mode;
        poly = null;
        PS.setSelection(PS.maskFromPolygon(pts), mode, "Polygonal Lasso");
    };

    function drawPolyOverlay(ctx, pts, markStart) {
        PS.overlayDocSpace(ctx, function (px) {
            ctx.lineWidth = px;
            ctx.strokeStyle = "#fff";
            ctx.setLineDash([4 * px, 4 * px]);
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (var i = 1; i < pts.length; i++) { ctx.lineTo(pts[i].x, pts[i].y); }
            ctx.stroke();
            ctx.strokeStyle = "#000";
            ctx.lineDashOffset = 4 * px;
            ctx.stroke();
            if (markStart) {
                ctx.setLineDash([]);
                ctx.fillStyle = "#fff";
                ctx.fillRect(pts[0].x - 3 * px, pts[0].y - 3 * px, 6 * px, 6 * px);
            }
        });
    }
})();

/* ----- Magic wand / smart select (W) ----- */
PS.registerTool("wand", {
    name: "Magic Wand",
    key: "w",
    cursor: "crosshair",
    icon: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M6 18 15 9M13 4l.7 2.2M19.8 10.3 22 11M14.5 13.5l2 2M18.5 4.5l-2 2"/></svg>',
    options: function (host) {
        var o = PS.toolOpts.wand;
        PS.ui.slider(host, "Tolerance", o.tolerance, 0, 150, 1, function (v) {
            o.tolerance = v; PS.savePrefsDebounced();
        });
        PS.ui.checkbox(host, "Contiguous", o.contiguous, function (v) {
            o.contiguous = v; PS.savePrefsDebounced();
        });
        PS.ui.sep(host);
        PS.ui.checkbox(host, "Smart edges (edge detection)", o.smart, function (v) {
            o.smart = v; PS.savePrefsDebounced();
        });
        PS.ui.slider(host, "Edge sensitivity", o.edgeThreshold, 10, 200, 1, function (v) {
            o.edgeThreshold = v; PS.savePrefsDebounced();
        });
    },
    onDown: function (pt, e) {
        var o = PS.toolOpts.wand;
        var mask = PS.magicWandMask(pt.x, pt.y, {
            tolerance: o.tolerance,
            contiguous: o.contiguous,
            smart: o.smart,
            edgeThreshold: o.edgeThreshold
        });
        if (!mask) { return; }
        PS.setSelection(mask, PS.selModeFromEvent(e), o.smart ? "Smart Select" : "Magic Wand");
    }
});

/* ----- Brush (B), Pencil, Eraser (E) ----- */
(function () {
    function paintToolOptions(kind, host) {
        var o = PS.toolOpts[kind];
        PS.ui.slider(host, "Size", o.size, 1, 300, 1, function (v) {
            o.size = v; PS.savePrefsDebounced();
        }, function (v) { return v + "px"; });
        PS.ui.slider(host, "Opacity", Math.round(o.opacity * 100), 1, 100, 1, function (v) {
            o.opacity = v / 100; PS.savePrefsDebounced();
        }, function (v) { return v + "%"; });
        if (kind === "brush") {
            PS.ui.select(host, "Stroke", PS.strokeTypes, o.type, function (v) {
                o.type = v; PS.savePrefsDebounced();
            });
            PS.ui.slider(host, "Hardness", Math.round((o.hardness || 0.8) * 100), 0, 99, 1, function (v) {
                o.hardness = v / 100; PS.savePrefsDebounced();
            }, function (v) { return v + "%"; });
            PS.ui.slider(host, "Flow", Math.round((o.flow || 0.7) * 100), 5, 100, 1, function (v) {
                o.flow = v / 100; PS.savePrefsDebounced();
            }, function (v) { return v + "%"; });
        }
        if (kind === "eraser") {
            PS.ui.select(host, "Type", [
                { v: "round", l: "Hard Round" },
                { v: "soft", l: "Soft Round" }
            ], o.type, function (v) { o.type = v; PS.savePrefsDebounced(); });
        }
        PS.ui.label(host, "[ and ] change size" + (kind !== "eraser" ? ", Alt-click samples color" : ""));
    }

    function registerPaintTool(id, name, key, icon) {
        PS.registerTool(id, {
            name: name,
            key: key,
            group: (id === "eraser") ? undefined : "paint",
            cursor: "crosshair",
            icon: icon,
            options: function (host) { paintToolOptions(id, host); },
            onDown: function (pt, e) { PS.beginStroke(id, pt, e); },
            onMove: function (pt) { PS.continueStroke(pt); },
            onUp: function () { PS.endStroke(); },
            overlay: PS.paintCursorOverlay(function () { return PS.toolOpts[id].size; }, id === "pencil")
        });
    }

    registerPaintTool("brush", "Brush", "b",
        '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M20 4c-4 1-9 5.5-11 9l2 2c3.5-2 8-7 9-11zM9 13c-2 .3-3.4 1.6-3.8 4.2-.1.8-.8 1.4-1.7 1.6 1.3 1.4 4.6 1.6 6.3-.1 1.2-1.2 1.4-2.7.7-4.2z"/></svg>');
    registerPaintTool("pencil", "Pencil", "b",
        '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3M4 20l4-1"/></svg>');
    registerPaintTool("eraser", "Eraser", "e",
        '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M9 19 4 14a2 2 0 0 1 0-2.8l7.2-7.2a2 2 0 0 1 2.8 0L20 10a2 2 0 0 1 0 2.8L13.8 19zM9 19h11M7 9l7 7"/></svg>');
})();

/* ----- Paint bucket / fill (G) ----- */
PS.registerTool("fill", {
    name: "Paint Bucket",
    key: "g",
    cursor: "crosshair",
    icon: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M10 3 5 8l7 7 7-5.5L10 3zM5 8l-1.5 1.5M19 15c.8 1.3 1.5 2.6 1.5 3.5a1.7 1.7 0 0 1-3.4 0c0-.9.9-2.2 1.9-3.5z"/></svg>',
    options: function (host) {
        var o = PS.toolOpts.fill;
        PS.ui.slider(host, "Tolerance", o.tolerance, 0, 150, 1, function (v) {
            o.tolerance = v; PS.savePrefsDebounced();
        });
        PS.ui.checkbox(host, "Contiguous", o.contiguous, function (v) {
            o.contiguous = v; PS.savePrefsDebounced();
        });
        PS.ui.label(host, "Alt-click samples color");
    },
    onDown: function (pt, e) {
        if (e.altKey) {
            PS.sampleColorAt(pt, PS.compositeToCanvas(), false);
            return;
        }
        var layer = PS.requirePaintableLayer();
        if (!layer) { return; }
        var before = PS.snapshotLayer(layer);
        if (PS.floodFillLayer(layer, pt, PS.fg, PS.toolOpts.fill)) {
            PS.commitLayerCanvas("Paint Bucket", layer, before);
            PS.requestRender();
        }
    }
});

// flood fill on the layer's own pixels, honoring the selection mask
PS.floodFillLayer = function (layer, pt, hex, opts) {
    var d = PS.doc;
    var w = d.width, h = d.height;
    var x = Math.floor(pt.x), y = Math.floor(pt.y);
    if (x < 0 || y < 0 || x >= w || y >= h) { return false; }

    var ctx = layer.canvas.getContext("2d");
    var img = ctx.getImageData(0, 0, w, h);
    var px = img.data;

    var maskData = null;
    if (d.selection) {
        maskData = d.selection.mask.getContext("2d").getImageData(0, 0, w, h).data;
        if (maskData[(y * w + x) * 4 + 3] < 128) { return false; }
    }

    var rgb = PS.hexToRgb(hex);
    var i0 = (y * w + x) * 4;
    var sr = px[i0], sg = px[i0 + 1], sb = px[i0 + 2], sa = px[i0 + 3];
    var tol = opts.tolerance;

    if (sr === rgb.r && sg === rgb.g && sb === rgb.b && sa === 255 && tol < 255) {
        return false; // already that color
    }

    function matches(i) {
        if (maskData && maskData[i + 3] < 128) { return false; }
        return Math.abs(px[i] - sr) <= tol && Math.abs(px[i + 1] - sg) <= tol &&
            Math.abs(px[i + 2] - sb) <= tol && Math.abs(px[i + 3] - sa) <= tol;
    }

    var fillA = (rgb.a === undefined) ? 255 : rgb.a;
    function paint(i) {
        px[i] = rgb.r; px[i + 1] = rgb.g; px[i + 2] = rgb.b; px[i + 3] = fillA;
    }

    var visited = new Uint8Array(w * h);

    if (!opts.contiguous) {
        for (var p = 0; p < w * h; p++) {
            if (matches(p * 4)) { paint(p * 4); }
        }
    } else {
        var stack = [[x, y]];
        visited[y * w + x] = 1;
        while (stack.length) {
            var cur = stack.pop();
            var cx = cur[0], cy = cur[1];
            var left = cx;
            while (left > 0 && !visited[cy * w + left - 1] && matches((cy * w + left - 1) * 4)) {
                left--; visited[cy * w + left] = 1;
            }
            var right = cx;
            while (right < w - 1 && !visited[cy * w + right + 1] && matches((cy * w + right + 1) * 4)) {
                right++; visited[cy * w + right] = 1;
            }
            for (var sx = left; sx <= right; sx++) {
                paint((cy * w + sx) * 4);
                if (cy > 0 && !visited[(cy - 1) * w + sx] && matches(((cy - 1) * w + sx) * 4)) {
                    visited[(cy - 1) * w + sx] = 1;
                    stack.push([sx, cy - 1]);
                }
                if (cy < h - 1 && !visited[(cy + 1) * w + sx] && matches(((cy + 1) * w + sx) * 4)) {
                    visited[(cy + 1) * w + sx] = 1;
                    stack.push([sx, cy + 1]);
                }
            }
        }
    }

    ctx.putImageData(img, 0, 0);
    return true;
};

/* ----- Eyedropper (I) ----- */
(function () {
    var sampling = null;
    PS.registerTool("eyedropper", {
        name: "Eyedropper",
        key: "i",
        cursor: "crosshair",
        icon: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="m13 8 3 3-7.5 7.5c-.6.6-1.4 1-2.2 1.1l-2.3.4.4-2.3c.1-.8.5-1.6 1.1-2.2zM13 8l2-2M16 11l2-2M14 3.5 20.5 10M17.5 3.5c1.5-1 3.5 1 2.5 2.5"/></svg>',
        options: function (host) {
            PS.ui.label(host, "Click to set foreground color, Alt-click to set background color");
        },
        onDown: function (pt, e) {
            sampling = { comp: PS.compositeToCanvas(), toBg: e.altKey };
            PS.sampleColorAt(pt, sampling.comp, sampling.toBg);
        },
        onMove: function (pt) {
            if (sampling) { PS.sampleColorAt(pt, sampling.comp, sampling.toBg); }
        },
        onUp: function () { sampling = null; }
    });
})();

/* ----- Shape tool (U) ----- */
(function () {
    var drag = null;

    PS.shapeKinds = [
        { v: "rect", l: "Rectangle" },
        { v: "rounded", l: "Rounded Rectangle" },
        { v: "ellipse", l: "Ellipse" },
        { v: "line", l: "Line" },
        { v: "arrow", l: "Arrow" },
        { v: "triangle", l: "Triangle" },
        { v: "star", l: "Star" }
    ];

    PS.buildShapePath = function (ctx, kind, r, opts) {
        ctx.beginPath();
        if (kind === "rect") {
            ctx.rect(r.x, r.y, r.w, r.h);
        } else if (kind === "rounded") {
            var rad = Math.min(opts.radius, r.w / 2, r.h / 2);
            ctx.moveTo(r.x + rad, r.y);
            ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rad);
            ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rad);
            ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rad);
            ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rad);
            ctx.closePath();
        } else if (kind === "ellipse") {
            ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
        } else if (kind === "line") {
            ctx.moveTo(r.x0, r.y0);
            ctx.lineTo(r.x1, r.y1);
        } else if (kind === "arrow") {
            var ang = Math.atan2(r.y1 - r.y0, r.x1 - r.x0);
            var len = Math.hypot(r.x1 - r.x0, r.y1 - r.y0);
            var head = Math.min(len * 0.35, Math.max(12, opts.strokeWidth * 3));
            ctx.moveTo(r.x0, r.y0);
            ctx.lineTo(r.x1, r.y1);
            ctx.moveTo(r.x1, r.y1);
            ctx.lineTo(r.x1 - head * Math.cos(ang - 0.45), r.y1 - head * Math.sin(ang - 0.45));
            ctx.moveTo(r.x1, r.y1);
            ctx.lineTo(r.x1 - head * Math.cos(ang + 0.45), r.y1 - head * Math.sin(ang + 0.45));
        } else if (kind === "triangle") {
            ctx.moveTo(r.x + r.w / 2, r.y);
            ctx.lineTo(r.x + r.w, r.y + r.h);
            ctx.lineTo(r.x, r.y + r.h);
            ctx.closePath();
        } else if (kind === "star") {
            var n = PS.clamp(opts.points || 5, 3, 12);
            var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
            var R = Math.min(r.w, r.h) / 2;
            var rr = R * 0.45;
            for (var i = 0; i < n * 2; i++) {
                var rad2 = (i % 2 === 0) ? R : rr;
                var a = -Math.PI / 2 + i * Math.PI / n;
                var X = cx + rad2 * Math.cos(a), Y = cy + rad2 * Math.sin(a);
                if (i === 0) { ctx.moveTo(X, Y); } else { ctx.lineTo(X, Y); }
            }
            ctx.closePath();
        }
    };

    function geom(drag) {
        var a = drag.start, b = drag.cur;
        var w = b.x - a.x, h = b.y - a.y;
        if (drag.constrain) {
            var kind = PS.toolOpts.shape.kind;
            if (kind === "line" || kind === "arrow") {
                // snap to 45 degree increments
                var ang = Math.atan2(h, w);
                var len = Math.hypot(w, h);
                var snap = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
                w = len * Math.cos(snap);
                h = len * Math.sin(snap);
            } else {
                var m = Math.max(Math.abs(w), Math.abs(h));
                w = w < 0 ? -m : m;
                h = h < 0 ? -m : m;
            }
        }
        return {
            x: Math.min(a.x, a.x + w), y: Math.min(a.y, a.y + h),
            w: Math.abs(w), h: Math.abs(h),
            x0: a.x, y0: a.y, x1: a.x + w, y1: a.y + h
        };
    }

    function renderShape(ctx, r) {
        var o = PS.toolOpts.shape;
        PS.buildShapePath(ctx, o.kind, r, o);
        var lineOnly = (o.kind === "line" || o.kind === "arrow");
        if (!lineOnly && (o.mode === "fill" || o.mode === "both")) {
            ctx.fillStyle = PS.fg;
            ctx.fill();
        }
        if (lineOnly || o.mode === "stroke" || o.mode === "both") {
            ctx.strokeStyle = lineOnly ? PS.fg : (o.mode === "both" ? PS.bg : PS.fg);
            ctx.lineWidth = o.strokeWidth;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.stroke();
        }
    }

    PS.registerTool("shape", {
        name: "Shape",
        key: "u",
        cursor: "crosshair",
        icon: '<svg viewBox="0 0 24 24" stroke-width="1.6"><rect x="3" y="3" width="12" height="12" rx="1"/><circle cx="16" cy="16" r="5.5"/></svg>',
        options: function (host) {
            var o = PS.toolOpts.shape;
            var kindLabel = o.kind;
            PS.shapeKinds.forEach(function (k) { if (k.v === o.kind) { kindLabel = k.l; } });
            PS.ui.label(host, "Shape: " + kindLabel + " (right-click the Shape tool to change)");
            if (o.kind !== "line" && o.kind !== "arrow") {
                PS.ui.select(host, "Mode", [
                    { v: "fill", l: "Fill (FG)" },
                    { v: "stroke", l: "Stroke (FG)" },
                    { v: "both", l: "Fill FG + Stroke BG" }
                ], o.mode, function (v) { o.mode = v; PS.savePrefsDebounced(); });
            }
            PS.ui.slider(host, "Stroke width", o.strokeWidth, 1, 60, 1, function (v) {
                o.strokeWidth = v; PS.savePrefsDebounced();
            }, function (v) { return v + "px"; });
            if (o.kind === "rounded") {
                PS.ui.slider(host, "Corner radius", o.radius, 1, 100, 1, function (v) {
                    o.radius = v; PS.savePrefsDebounced();
                });
            }
            if (o.kind === "star") {
                PS.ui.slider(host, "Points", o.points, 3, 12, 1, function (v) {
                    o.points = v; PS.savePrefsDebounced();
                });
            }
            PS.ui.label(host, "Shift constrains proportions");
        },
        onDown: function (pt, e) {
            if (!PS.requirePaintableLayer()) { return; }
            drag = { start: pt, cur: pt, constrain: e.shiftKey };
        },
        onMove: function (pt, e) {
            if (!drag) { return; }
            drag.cur = pt;
            drag.constrain = e.shiftKey;
        },
        onUp: function () {
            if (!drag) { return; }
            var r = geom(drag);
            drag = null;
            if (r.w < 2 && r.h < 2) { return; }
            var layer = PS.requirePaintableLayer();
            if (!layer) { return; }
            var before = PS.snapshotLayer(layer);
            PS.maskedDraw(layer, function (ctx) { renderShape(ctx, r); });
            PS.commitLayerCanvas("Shape: " + PS.toolOpts.shape.kind, layer, before);
            PS.requestRender();
        },
        overlay: function (ctx) {
            if (!drag) { return; }
            var r = geom(drag);
            PS.overlayDocSpace(ctx, function () {
                ctx.globalAlpha = 0.8;
                renderShape(ctx, r);
                ctx.globalAlpha = 1;
            });
        }
    });
})();

/* ----- Hand (H) and Zoom (Z) ----- */
PS.registerTool("hand", {
    name: "Hand",
    key: "h",
    cursor: "grab",
    icon: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M7 11V5.5a1.5 1.5 0 0 1 3 0V10m0-5.5v-1a1.5 1.5 0 0 1 3 0V10m0-5a1.5 1.5 0 0 1 3 0V11m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.8a6 6 0 0 1-4.6-2.2L4 15.6c-1.4-1.7.6-3.8 2.2-2.4L7 14z"/></svg>',
    options: function (host) {
        PS.ui.label(host, "Drag to pan. Hold Space with any tool for temporary pan.");
    }
    // panning handled by the pointer pipeline
});

(function () {
    var drag = null;
    PS.registerTool("zoom", {
        name: "Zoom",
        key: "z",
        cursor: "zoom-in",
        icon: '<svg viewBox="0 0 24 24" stroke-width="1.6"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M8 10.5h5M10.5 8v5"/></svg>',
        options: function (host) {
            PS.ui.label(host, "Click to zoom in, Alt-click to zoom out, drag a box to zoom to area");
            PS.ui.button(host, "Fit", function () { PS.zoomFit(); });
            PS.ui.button(host, "100%", function () { PS.zoomActual(); });
        },
        onDown: function (pt) { drag = { start: pt, cur: pt }; },
        onMove: function (pt) { if (drag) { drag.cur = pt; } },
        onUp: function (pt, e) {
            if (!drag) { return; }
            var r = {
                x: Math.min(drag.start.x, drag.cur.x),
                y: Math.min(drag.start.y, drag.cur.y),
                w: Math.abs(drag.cur.x - drag.start.x),
                h: Math.abs(drag.cur.y - drag.start.y)
            };
            drag = null;
            if (r.w * PS.zoom > 12 && r.h * PS.zoom > 12) {
                var holder = PS.el("workspace-holder");
                var z = Math.min((holder.clientWidth - 40) / r.w, (holder.clientHeight - 40) / r.h);
                PS.setZoom(z, { x: r.x + r.w / 2, y: r.y + r.h / 2 });
            } else {
                PS.setZoom(PS.zoom * (e.altKey ? 1 / 1.5 : 1.5), pt);
            }
        },
        overlay: function (ctx) {
            if (!drag) { return; }
            PS.overlayDocSpace(ctx, function (px) {
                ctx.lineWidth = px;
                ctx.strokeStyle = "#4a90d9";
                ctx.setLineDash([4 * px, 3 * px]);
                ctx.strokeRect(
                    Math.min(drag.start.x, drag.cur.x), Math.min(drag.start.y, drag.cur.y),
                    Math.abs(drag.cur.x - drag.start.x), Math.abs(drag.cur.y - drag.start.y));
            });
        }
    });
})();
