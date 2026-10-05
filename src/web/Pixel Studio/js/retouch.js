/*
    Pixel Studio - crop and retouching tools

        Crop (C)                    a box with handles over the canvas: drag
                                    a handle to resize, inside to move, just
                                    outside to rotate; ratio presets, rule of
                                    thirds / grid overlay, Delete Cropped
                                    Pixels (off: the pixels stay beyond the
                                    canvas edge, Image > Reveal All brings
                                    them back); Enter commits, Esc cancels
        Spot Healing Brush (J)      paint over a blemish: texture from a
                                    nearby patch, blended to the surrounding
                                    tone when the stroke ends
        Healing Brush (J)           the same with an Alt-clicked source
        Clone Stamp (S)             Alt-click sets the source; Aligned keeps
                                    the offset between strokes
        Magic Eraser (E)            erases similar colours where clicked
        Blur, Sharpen, Smudge
        Dodge, Burn, Sponge (O)     tone and saturation by brush

    The brush-like tools paint a soft round mask (PS.MaskStroke) and turn it
    into pixels; while the stroke runs the compositor shows the result
    through PS.strokePreview.bake.
*/
"use strict";

PS.toolOpts.crop = { ratio: "free", rw: 1, rh: 1, overlay: "thirds", deleteCropped: true };
PS.toolOpts.clone = { size: 40, hardness: 0.5, opacity: 1, flow: 1, aligned: true, sample: "current" };
PS.toolOpts.heal = { size: 30, hardness: 0.7, aligned: true, sample: "current" };
PS.toolOpts.spotheal = { size: 24, hardness: 0.7 };
PS.toolOpts["magic-eraser"] = { tolerance: 32, contiguous: true, opacity: 1 };
PS.toolOpts.dodge = { size: 60, hardness: 0.3, range: "midtones", exposure: 0.5 };
PS.toolOpts.burn = { size: 60, hardness: 0.3, range: "midtones", exposure: 0.5 };
PS.toolOpts.sponge = { size: 60, hardness: 0.3, mode: "desaturate", flow: 0.5 };
PS.toolOpts.blur = { size: 40, hardness: 0.3, strength: 0.5 };
PS.toolOpts.sharpen = { size: 40, hardness: 0.3, strength: 0.5 };
PS.toolOpts.smudge = { size: 30, hardness: 0.3, strength: 0.5 };

// tools whose brush size [ and ] change
PS.BRUSH_SIZE_TOOLS = ["brush", "pencil", "eraser", "clone", "heal", "spotheal", "dodge", "burn", "sponge", "blur", "sharpen", "smudge"];

/* ============================================================
   SHARED: SOFT ROUND MASK STROKE
   ============================================================ */

PS.MaskStroke = function (opts) {
    var d = PS.doc;
    this.size = Math.max(1, opts.size);
    this.hardness = opts.hardness === undefined ? 0.5 : opts.hardness;
    this.flow = opts.flow === undefined ? 1 : opts.flow;
    this.mask = PS.createCanvas(d.width, d.height);
    this.ctx = this.mask.getContext("2d");
    this.box = null;        // everything painted so far
    this.pending = null;    // painted since the last take()
    this.last = null;
    this.rest = 0;
    this.rev = 0;
};

function unionBox(a, b) {
    if (!a) { return b; }
    return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

PS.MaskStroke.prototype.dab = function (x, y) {
    var r = this.size / 2;
    var ctx = this.ctx;
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    var hard = PS.clamp(this.hardness, 0, 0.99);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(hard, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalAlpha = this.flow;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    var b = { x0: Math.floor(x - r - 1), y0: Math.floor(y - r - 1), x1: Math.ceil(x + r + 1), y1: Math.ceil(y + r + 1) };
    this.box = unionBox(this.box, b);
    this.pending = unionBox(this.pending, b);
    this.rev++;
};

// extend the stroke to pt (spaced dabs)
PS.MaskStroke.prototype.to = function (pt) {
    if (!this.last) { this.dab(pt.x, pt.y); this.last = { x: pt.x, y: pt.y }; return; }
    var dx = pt.x - this.last.x, dy = pt.y - this.last.y;
    var dist = Math.hypot(dx, dy);
    var spacing = Math.max(1, this.size * 0.12);
    var t = spacing - this.rest;
    while (t <= dist) {
        this.dab(this.last.x + dx * t / dist, this.last.y + dy * t / dist);
        t += spacing;
    }
    this.rest = dist - (t - spacing);
    this.last = { x: pt.x, y: pt.y };
};

// a box clamped to the document, or null
function clampBox(b) {
    if (!b) { return null; }
    var d = PS.doc;
    var x0 = Math.max(0, b.x0), y0 = Math.max(0, b.y0), x1 = Math.min(d.width, b.x1), y1 = Math.min(d.height, b.y1);
    if (x1 <= x0 || y1 <= y0) { return null; }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// the painted area since the last call (document clamped)
PS.MaskStroke.prototype.take = function () {
    var p = clampBox(this.pending);
    this.pending = null;
    return p;
};

// the mask limited to the selection
PS.MaskStroke.prototype.effectiveMask = function () {
    var sel = PS.doc.selection;
    if (!sel) { return this.mask; }
    var m = PS.cloneCanvas(this.mask);
    var c = m.getContext("2d");
    c.globalCompositeOperation = "destination-in";
    c.drawImage(sel.mask, 0, 0);
    return m;
};

// brush size / hardness of the retouching tools: the brush picker, round tips only
function brushFields(host, o) {
    void o;
    PS.brushPickerButton(host, PS.tool, { roundOnly: true });
}

function percentSlider(host, label, o, key) {
    PS.ui.slider(host, label, Math.round(o[key] * 100), 1, 100, 1, function (v) { o[key] = v / 100; PS.savePrefsDebounced(); }, "%");
}

// "Current Layer" / "Current & Below" / "All Layers" source pixels
function sampleCanvas(mode, layer) {
    if (mode === "all") { return PS.compositeToCanvas(); }
    if (mode === "below" && !layer.isMaskTarget && !layer.isQuickMask) {
        var d = PS.doc;
        var anc = PS.ancestorsOf(layer);
        var top = anc.length ? anc[anc.length - 1] : layer;
        var idx = d.root.children.indexOf(top);
        if (idx >= 0) { return PS.renderer.compositeCanvas(d.root.children.slice(0, idx + 1)); }
    }
    return PS.cloneCanvas(layer.canvas);
}

/* ============================================================
   CLONE STAMP AND HEALING
   ============================================================ */

PS.CLONE_SAMPLE = [{ v: "current", l: "Current Layer" }, { v: "below", l: "Current & Below" }, { v: "all", l: "All Layers" }];

// the source shifted onto the stroke, drawn over the original
function cloneComposite(s, out) {
    var d = PS.doc;
    if (!out) { out = PS.createCanvas(d.width, d.height); }
    var ctx = out.getContext("2d");
    ctx.clearRect(0, 0, d.width, d.height);
    ctx.drawImage(s.before, 0, 0);
    var tmp = s.tmp || (s.tmp = PS.createCanvas(d.width, d.height));
    var t = tmp.getContext("2d");
    t.globalCompositeOperation = "source-over";
    t.clearRect(0, 0, d.width, d.height);
    t.drawImage(s.src, -s.off.x, -s.off.y);
    t.globalCompositeOperation = "destination-in";
    t.drawImage(s.stroke.effectiveMask(), 0, 0);
    t.globalCompositeOperation = "source-over";
    ctx.globalAlpha = s.opacity;
    ctx.globalCompositeOperation = s.layer.locks && s.layer.locks.transparency ? "source-atop" : "source-over";
    ctx.drawImage(tmp, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    return out;
}

/* ---------- Poisson healing ---------- */

// Blend the source texture into the target: inside the mask the result is
// source + D, where D smoothly interpolates (target - source) from the edge
// of the masked area (Laplace's equation, solved by over-relaxation).
// Works on the box r (document coordinates); returns ImageData for it.
PS.healRegion = function (target, source, off, mask, r) {
    var w = r.w, h = r.h, n = w * h;
    var T = target.getContext("2d").getImageData(r.x, r.y, w, h).data;
    var sc = PS.createCanvas(w, h);
    sc.getContext("2d").drawImage(source, -(r.x + off.x), -(r.y + off.y));
    var S = sc.getContext("2d").getImageData(0, 0, w, h).data;
    var M = mask.getContext("2d").getImageData(r.x, r.y, w, h).data;
    var inside = new Uint8Array(n);
    var D = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    var c, i, x, y;
    var sum = [0, 0, 0], cnt = 0;
    for (i = 0; i < n; i++) {
        var m = M[i * 4 + 3];
        // the box border is always boundary
        x = i % w; y = (i - x) / w;
        inside[i] = (m > 2 && x > 0 && y > 0 && x < w - 1 && y < h - 1) ? 1 : 0;
        for (c = 0; c < 3; c++) {
            D[c][i] = T[i * 4 + c] - S[i * 4 + c];
        }
        if (!inside[i]) { cnt++; for (c = 0; c < 3; c++) { sum[c] += D[c][i]; } }
    }
    // start the interior at the mean edge difference: fast convergence
    for (i = 0; i < n; i++) {
        if (inside[i]) { for (c = 0; c < 3; c++) { D[c][i] = cnt ? sum[c] / cnt : 0; } }
    }
    var omega = 1.9;
    var maxIter = Math.min(2000, Math.max(60, Math.round(Math.max(w, h) * 2.5)));
    for (var it = 0; it < maxIter; it++) {
        var change = 0;
        for (y = 1; y < h - 1; y++) {
            var row = y * w;
            for (x = 1; x < w - 1; x++) {
                i = row + x;
                if (!inside[i]) { continue; }
                for (c = 0; c < 3; c++) {
                    var Dc = D[c];
                    var v = (Dc[i - 1] + Dc[i + 1] + Dc[i - w] + Dc[i + w]) * 0.25;
                    var dv = (v - Dc[i]) * omega;
                    Dc[i] += dv;
                    if (dv > change) { change = dv; } else if (-dv > change) { change = -dv; }
                }
            }
        }
        if (change < 0.05) { break; }
    }
    var out = new ImageData(w, h);
    var o = out.data;
    for (i = 0; i < n; i++) {
        var a = M[i * 4 + 3] / 255;
        var p = i * 4;
        if (a <= 0 || !inside[i]) {
            o[p] = T[p]; o[p + 1] = T[p + 1]; o[p + 2] = T[p + 2]; o[p + 3] = T[p + 3];
            continue;
        }
        for (c = 0; c < 3; c++) {
            var healed = S[p + c] + D[c][i];
            o[p + c] = T[p + c] + (healed - T[p + c]) * a;
        }
        // transparency comes from the target where it has some, else the source
        o[p + 3] = T[p + 3] + ((S[p + 3] || T[p + 3]) - T[p + 3]) * a;
    }
    return out;
};

// Spot Healing: the nearby offset whose surroundings match best
PS.findHealSource = function (target, mask, r) {
    var d = PS.doc;
    var w = r.w, h = r.h;
    var M = mask.getContext("2d").getImageData(r.x, r.y, w, h).data;
    // compare a ring around the painted area
    var ring = [];
    for (var y = 0; y < h; y += 2) {
        for (var x = 0; x < w; x += 2) {
            var a = M[(y * w + x) * 4 + 3];
            if (a > 2) { continue; }
            // near the paint: within 3 px of a painted pixel
            var near = false;
            for (var k = -3; k <= 3 && !near; k += 3) {
                for (var l = -3; l <= 3 && !near; l += 3) {
                    var xx = x + k, yy = y + l;
                    if (xx >= 0 && yy >= 0 && xx < w && yy < h && M[(yy * w + xx) * 4 + 3] > 2) { near = true; }
                }
            }
            if (near) { ring.push(x, y); }
        }
    }
    var ext = { x: Math.max(0, r.x - r.w * 2), y: Math.max(0, r.y - r.h * 2) };
    ext.w = Math.min(d.width, r.x + r.w * 3) - ext.x;
    ext.h = Math.min(d.height, r.y + r.h * 3) - ext.y;
    var big = target.getContext("2d").getImageData(ext.x, ext.y, ext.w, ext.h).data;
    function px(gx, gy, c) {
        var lx = gx - ext.x, ly = gy - ext.y;
        if (lx < 0 || ly < 0 || lx >= ext.w || ly >= ext.h) { return -1; }
        return big[(ly * ext.w + lx) * 4 + c];
    }
    var best = null, bestScore = Infinity;
    var span = Math.max(r.w, r.h);
    [0.8, 1.15, 1.6, 2.1].forEach(function (f) {
        for (var ang = 0; ang < 360; ang += 22.5) {
            var ox = Math.round(Math.cos(ang * Math.PI / 180) * span * f);
            var oy = Math.round(Math.sin(ang * Math.PI / 180) * span * f);
            if (r.x + ox < 0 || r.y + oy < 0 || r.x + r.w + ox > d.width || r.y + r.h + oy > d.height) { continue; }
            var score = 0, used = 0;
            for (var q = 0; q < ring.length; q += 2) {
                var gx = r.x + ring[q], gy = r.y + ring[q + 1];
                var t0 = px(gx, gy, 0);
                var s0 = px(gx + ox, gy + oy, 0);
                if (t0 < 0 || s0 < 0) { continue; }
                for (var c = 0; c < 3; c++) {
                    var dv = px(gx, gy, c) - px(gx + ox, gy + oy, c);
                    score += dv * dv;
                }
                used++;
            }
            if (!used) { continue; }
            score = score / used * (1 + f * 0.08);
            if (score < bestScore) { bestScore = score; best = { x: ox, y: oy }; }
        }
    });
    return best || { x: span, y: 0 };
};

(function () {
    var source = { clone: null, heal: null };      // Alt-clicked points
    var aligned = { clone: null, heal: null };     // kept offsets
    var st = null;

    var ICONS = {
        clone: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M9 4h6v5l3 2v3H6v-3l3-2zM5 17h14v3H5z"/></svg>',
        heal: '<svg viewBox="0 0 24 24" stroke-width="1.6"><rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-45 12 12)"/><path d="M10.5 10.5h.01M13.5 13.5h.01M13.5 10.5h.01M10.5 13.5h.01"/></svg>',
        spotheal: '<svg viewBox="0 0 24 24" stroke-width="1.6"><rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-45 12 12)"/><circle cx="18.5" cy="5.5" r="2"/></svg>'
    };

    function startStroke(kind, pt, e) {
        var o = PS.toolOpts[kind];
        var layer = PS.requirePaintableLayer();
        if (!layer) { return; }
        var off;
        if (kind === "spotheal") {
            off = { x: 0, y: 0 };
        } else {
            if (!source[kind]) { PS.toast("Alt-click to define a source point first", true); return; }
            if (!o.aligned || !aligned[kind]) { aligned[kind] = { x: source[kind].x - pt.x, y: source[kind].y - pt.y }; }
            off = { x: aligned[kind].x, y: aligned[kind].y };
        }
        st = {
            kind: kind, layer: layer, before: PS.snapshotLayer(layer),
            src: kind === "spotheal" ? null : sampleCanvas(o.sample, layer),
            stroke: new PS.MaskStroke({ size: o.size, hardness: o.hardness, flow: o.flow === undefined ? 1 : o.flow }),
            off: off, opacity: o.opacity === undefined ? 1 : o.opacity, out: null
        };
        st.stroke.to(pt);
        var s = st;
        PS.strokePreview = {
            layer: layer, canvas: st.stroke.mask, opacity: 1,
            bake: function () {
                if (s.kind === "spotheal") {
                    // the area to heal shows as a light tint until release
                    var out = s.out || (s.out = PS.createCanvas(PS.doc.width, PS.doc.height));
                    var c = out.getContext("2d");
                    c.clearRect(0, 0, out.width, out.height);
                    c.drawImage(s.before, 0, 0);
                    c.globalAlpha = 0.35;
                    c.drawImage(s.stroke.mask, 0, 0);
                    c.globalAlpha = 1;
                    return out;
                }
                return (s.out = cloneComposite(s, s.out));
            }
        };
        void e;
        PS.requestRender();
    }

    function endStroke() {
        if (!st) { return; }
        var s = st;
        st = null;
        PS.strokePreview = null;
        var layer = s.layer;
        var ctx = layer.canvas.getContext("2d");
        if (s.kind === "clone") {
            var res = cloneComposite(s, null);
            ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
            ctx.drawImage(res, 0, 0);
            PS.commitLayerCanvas("Clone Stamp", layer, s.before);
        } else {
            var box = clampBox(s.stroke.box);
            if (!box) { PS.requestRender(); return; }
            // a margin of untouched pixels around the painted area
            var m = 3;
            var r = clampBox({ x0: box.x - m, y0: box.y - m, x1: box.x + box.w + m, y1: box.y + box.h + m });
            var mask = s.stroke.effectiveMask();
            var off = s.off, src = s.src;
            if (s.kind === "spotheal") {
                src = s.before;
                off = PS.findHealSource(s.before, mask, r);
            }
            PS.showBusy("Healing...");
            setTimeout(function () {
                try {
                    var img = PS.healRegion(s.before, src, off, mask, r);
                    ctx.putImageData(img, r.x, r.y);
                    PS.commitLayerCanvas(s.kind === "spotheal" ? "Spot Healing Brush" : "Healing Brush", layer, s.before);
                } finally {
                    PS.hideBusy();
                    PS.requestRender();
                }
            }, 10);
            return;
        }
        PS.requestRender();
    }

    function sourceOverlay(kind) {
        var cursor = PS.paintCursorOverlay(function () { return PS.toolOpts[kind].size; }, false);
        return function (ctx) {
            cursor(ctx);
            // where the source is sampled from
            var src = null;
            if (st && st.kind === kind && st.stroke.last && kind !== "spotheal") {
                src = { x: st.stroke.last.x + st.off.x, y: st.stroke.last.y + st.off.y };
            } else if (source[kind] && !st) {
                src = source[kind];
            }
            if (!src) { return; }
            var p = PS.docToOverlay(src.x, src.y);
            ctx.save();
            ctx.lineWidth = 1;
            [["#000000", 1], ["#ffffff", 0]].forEach(function (s) {
                ctx.strokeStyle = s[0];
                ctx.beginPath();
                ctx.moveTo(p.x - 8 + s[1], p.y); ctx.lineTo(p.x + 8 + s[1], p.y);
                ctx.moveTo(p.x, p.y - 8 + s[1]); ctx.lineTo(p.x, p.y + 8 + s[1]);
                ctx.stroke();
            });
            ctx.restore();
        };
    }

    function register(kind, name, key) {
        PS.registerTool(kind, {
            name: name,
            key: key,
            hint: kind === "spotheal" ? "Paint over blemishes; texture comes from nearby" : "Alt-click sets the source",
            cursor: "crosshair",
            icon: ICONS[kind],
            options: function (host) {
                var o = PS.toolOpts[kind];
                brushFields(host, o);
                if (kind === "clone") {
                    PS.ui.sep(host);
                    percentSlider(host, "Opacity:", o, "opacity");
                    percentSlider(host, "Flow:", o, "flow");
                }
                if (kind !== "spotheal") {
                    PS.ui.sep(host);
                    PS.ui.checkbox(host, "Aligned", o.aligned, function (v) { o.aligned = v; aligned[kind] = null; PS.savePrefsDebounced(); });
                    PS.ui.select(host, "Sample:", PS.CLONE_SAMPLE, o.sample, function (v) { o.sample = v; PS.savePrefsDebounced(); });
                }
            },
            onDown: function (pt, e) {
                if (e.altKey && kind !== "spotheal") {
                    source[kind] = { x: pt.x, y: pt.y };
                    aligned[kind] = null;
                    PS.renderOptionsBar();
                    return;
                }
                startStroke(kind, pt, e);
            },
            onMove: function (pt) {
                if (!st) { return; }
                st.stroke.to(pt);
                PS.requestRender();
            },
            onUp: function () { endStroke(); },
            overlay: sourceOverlay(kind)
        });
    }

    register("spotheal", "Spot Healing Brush", "j");
    register("heal", "Healing Brush", "j");
    register("clone", "Clone Stamp", "s");
})();

/* ============================================================
   MAGIC ERASER
   ============================================================ */

PS.registerTool("magic-eraser", {
    name: "Magic Eraser",
    key: "e",
    cursor: "crosshair",
    icon: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M9 19 4 14a2 2 0 0 1 0-2.8l7.2-7.2a2 2 0 0 1 2.8 0L20 10a2 2 0 0 1 0 2.8L13.8 19zM9 19h11"/><path d="M18 2v3M16.5 3.5h3"/></svg>',
    options: function (host) {
        var o = PS.toolOpts["magic-eraser"];
        PS.ui.numeric(host, "Tolerance:", o.tolerance, 0, 255, 1, function (v) { o.tolerance = v; PS.savePrefsDebounced(); });
        PS.ui.checkbox(host, "Contiguous", o.contiguous, function (v) { o.contiguous = v; PS.savePrefsDebounced(); });
        percentSlider(host, "Opacity:", o, "opacity");
    },
    onDown: function (pt) {
        var layer = PS.requirePaintableLayer();
        if (!layer) { return; }
        var o = PS.toolOpts["magic-eraser"];
        var mask = PS.magicWandMask(pt.x, pt.y, { tolerance: o.tolerance, contiguous: o.contiguous, smart: false, source: layer.canvas });
        if (!mask) { return; }
        if (PS.doc.selection) {
            var mc = mask.getContext("2d");
            mc.globalCompositeOperation = "destination-in";
            mc.drawImage(PS.doc.selection.mask, 0, 0);
            mc.globalCompositeOperation = "source-over";
        }
        var before = PS.snapshotLayer(layer);
        var ctx = layer.canvas.getContext("2d");
        ctx.globalAlpha = o.opacity;
        ctx.globalCompositeOperation = "destination-out";
        ctx.drawImage(mask, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        PS.commitLayerCanvas("Magic Eraser", layer, before);
        PS.requestRender();
    }
});

/* ============================================================
   BLUR, SHARPEN, SMUDGE / DODGE, BURN, SPONGE
   ============================================================ */

(function () {
    var st = null;

    // per-pixel tone / colour changes of dodge, burn and sponge
    function toneFn(kind, o) {
        var range = o.range || "midtones";
        return function (r, g, b, m) {
            if (kind === "sponge") {
                var l = r * 0.299 + g * 0.587 + b * 0.114;
                var k = o.mode === "saturate" ? 1 + m : 1 - m;
                return [l + (r - l) * k, l + (g - l) * k, l + (b - l) * k];
            }
            var out = [r, g, b];
            for (var c = 0; c < 3; c++) {
                var v = out[c] / 255, nv;
                if (kind === "dodge") {
                    if (range === "shadows") { nv = v + m * (1 - v) * (1 - v) * 0.8; }
                    else if (range === "highlights") { nv = v + m * v * v * 0.8; }
                    else { nv = Math.pow(v, 1 / (1 + m)); }
                } else {
                    if (range === "shadows") { nv = v - m * (1 - v) * v * 0.8; }
                    else if (range === "highlights") { nv = v - m * v * v * 0.6; }
                    else { nv = Math.pow(v, 1 + m); }
                }
                out[c] = nv * 255;
            }
            return out;
        };
    }

    // recompute the result in a box from the original and the mask
    function applyBox(s, r) {
        if (!r) { return; }
        var M = s.stroke.effectiveMask().getContext("2d").getImageData(r.x, r.y, r.w, r.h).data;
        var B = s.beforeData;
        var W = PS.doc.width;
        var img = s.outCtx.createImageData(r.w, r.h);
        var o = img.data;
        var F = s.filteredData;
        var amt = s.amount;
        for (var y = 0; y < r.h; y++) {
            for (var x = 0; x < r.w; x++) {
                var i = (y * r.w + x) * 4;
                var gi = ((r.y + y) * W + (r.x + x)) * 4;
                var m = M[i + 3] / 255 * amt;
                var cr = B[gi], cg = B[gi + 1], cb = B[gi + 2];
                o[i + 3] = B[gi + 3];
                if (m <= 0) { o[i] = cr; o[i + 1] = cg; o[i + 2] = cb; continue; }
                if (F) {
                    o[i] = cr + (F[gi] - cr) * m; o[i + 1] = cg + (F[gi + 1] - cg) * m; o[i + 2] = cb + (F[gi + 2] - cb) * m;
                    if (s.kind === "blur") { o[i + 3] = B[gi + 3] + (F[gi + 3] - B[gi + 3]) * m; }
                } else {
                    var v = s.fn(cr, cg, cb, m);
                    o[i] = v[0]; o[i + 1] = v[1]; o[i + 2] = v[2];
                }
            }
        }
        s.outCtx.putImageData(img, r.x, r.y);
    }

    function filtered(kind, before) {
        var d = PS.doc;
        var B = before.getContext("2d").getImageData(0, 0, d.width, d.height).data;
        if (kind === "blur") {
            return PS.gaussianBlurCanvas(before, 3).getContext("2d").getImageData(0, 0, d.width, d.height).data;
        }
        // sharpen: an unsharp mask of the whole layer
        var bl = PS.gaussianBlurCanvas(before, 1.5).getContext("2d").getImageData(0, 0, d.width, d.height).data;
        var out = new Uint8ClampedArray(B.length);
        for (var i = 0; i < B.length; i += 4) {
            out[i] = B[i] + (B[i] - bl[i]) * 1.5;
            out[i + 1] = B[i + 1] + (B[i + 1] - bl[i + 1]) * 1.5;
            out[i + 2] = B[i + 2] + (B[i + 2] - bl[i + 2]) * 1.5;
            out[i + 3] = B[i + 3];
        }
        return out;
    }

    // smudge: drag the colour under the brush along the stroke
    function smudgeTo(s, pt) {
        var r = s.size / 2;
        var size = Math.max(2, Math.round(s.size));
        var lctx = s.layer.canvas.getContext("2d");
        function dab(x, y) {
            var t = s.tmp.getContext("2d");
            t.globalCompositeOperation = "source-over";
            t.clearRect(0, 0, size, size);
            t.drawImage(s.carry, 0, 0);
            t.globalCompositeOperation = "destination-in";
            var g = t.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
            g.addColorStop(0, "rgba(0,0,0," + s.strength + ")");
            g.addColorStop(PS.clamp(s.hardness, 0, 0.99), "rgba(0,0,0," + s.strength + ")");
            g.addColorStop(1, "rgba(0,0,0,0)");
            t.fillStyle = g;
            t.fillRect(0, 0, size, size);
            t.globalCompositeOperation = "source-over";
            lctx.globalCompositeOperation = s.layer.locks && s.layer.locks.transparency ? "source-atop" : "source-over";
            lctx.drawImage(s.tmp, Math.round(x - r), Math.round(y - r));
            lctx.globalCompositeOperation = "source-over";
            // pick up some of what is under the brush now
            var c = s.carry.getContext("2d");
            c.globalAlpha = 1 - s.strength;
            c.drawImage(s.layer.canvas, Math.round(x - r), Math.round(y - r), size, size, 0, 0, size, size);
            c.globalAlpha = 1;
        }
        if (!s.last) { s.last = pt; return; }
        var dx = pt.x - s.last.x, dy = pt.y - s.last.y;
        var dist = Math.hypot(dx, dy);
        var spacing = Math.max(1, s.size * 0.1);
        for (var t = spacing; t <= dist; t += spacing) { dab(s.last.x + dx * t / dist, s.last.y + dy * t / dist); }
        if (dist >= spacing) { s.last = pt; }
        PS.touchLayer(s.layer);
    }

    var ICONS = {
        blur: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M12 3c3 4.5 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-6.5 6-11z"/></svg>',
        sharpen: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M12 3 17 20H7z"/></svg>',
        smudge: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M8 21v-7l-2-3V6a1.5 1.5 0 0 1 3 0v4M9 10V4.5a1.5 1.5 0 0 1 3 0V10M12 10V5.5a1.5 1.5 0 0 1 3 0V11M15 11V8a1.5 1.5 0 0 1 3 0v6l-2 7"/></svg>',
        dodge: '<svg viewBox="0 0 24 24" stroke-width="1.6"><circle cx="9" cy="9" r="5"/><path d="M12.5 12.5 20 20"/></svg>',
        burn: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M7 20c-1.5-5 .5-8 3-10 2.5-2 3-4.5 2-7 5 2 7.5 7 6.5 11-.8 3.2-3 5.5-6.5 6"/><path d="M12 20c-2-2-1.5-4.5 1-6.5"/></svg>',
        sponge: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M5 8c0-2 2-3 7-3s7 1 7 3v9c0 2-2 3-7 3s-7-1-7-3z"/><path d="M8.5 9.5h.01M12 12h.01M15.5 9.5h.01M9.5 15h.01M14.5 15h.01"/></svg>'
    };
    var NAMES = { blur: "Blur", sharpen: "Sharpen", smudge: "Smudge", dodge: "Dodge", burn: "Burn", sponge: "Sponge" };

    function register(kind, key) {
        PS.registerTool(kind, {
            name: NAMES[kind],
            key: key,
            cursor: "crosshair",
            icon: ICONS[kind],
            options: function (host) {
                var o = PS.toolOpts[kind];
                brushFields(host, o);
                PS.ui.sep(host);
                if (kind === "dodge" || kind === "burn") {
                    PS.ui.select(host, "Range:", [{ v: "shadows", l: "Shadows" }, { v: "midtones", l: "Midtones" }, { v: "highlights", l: "Highlights" }],
                        o.range, function (v) { o.range = v; PS.savePrefsDebounced(); });
                    percentSlider(host, "Exposure:", o, "exposure");
                } else if (kind === "sponge") {
                    PS.ui.select(host, "Mode:", [{ v: "desaturate", l: "Desaturate" }, { v: "saturate", l: "Saturate" }],
                        o.mode, function (v) { o.mode = v; PS.savePrefsDebounced(); });
                    percentSlider(host, "Flow:", o, "flow");
                } else {
                    percentSlider(host, "Strength:", o, "strength");
                }
            },
            onDown: function (pt) {
                var layer = PS.requirePaintableLayer();
                if (!layer) { return; }
                var o = PS.toolOpts[kind];
                var d = PS.doc;
                var before = PS.snapshotLayer(layer);
                if (kind === "smudge") {
                    var size = Math.max(2, Math.round(o.size));
                    var carry = PS.createCanvas(size, size);
                    carry.getContext("2d").drawImage(layer.canvas, Math.round(pt.x - o.size / 2), Math.round(pt.y - o.size / 2), size, size, 0, 0, size, size);
                    st = { kind: kind, layer: layer, before: before, carry: carry, tmp: PS.createCanvas(size, size), size: o.size, hardness: o.hardness, strength: o.strength, last: null };
                    smudgeTo(st, pt);
                    return;
                }
                var out = PS.cloneCanvas(before);
                st = {
                    kind: kind, layer: layer, before: before,
                    beforeData: before.getContext("2d").getImageData(0, 0, d.width, d.height).data,
                    filteredData: (kind === "blur" || kind === "sharpen") ? filtered(kind, before) : null,
                    fn: toneFn(kind, o),
                    amount: kind === "sponge" ? o.flow : (kind === "dodge" || kind === "burn" ? o.exposure : o.strength),
                    stroke: new PS.MaskStroke({ size: o.size, hardness: o.hardness, flow: 1 }),
                    out: out, outCtx: out.getContext("2d")
                };
                st.stroke.to(pt);
                var s = st;
                PS.strokePreview = {
                    layer: layer, canvas: s.stroke.mask, opacity: 1,
                    bake: function () { applyBox(s, s.stroke.take()); return s.out; }
                };
                PS.requestRender();
            },
            onMove: function (pt) {
                if (!st) { return; }
                if (st.kind === "smudge") { smudgeTo(st, pt); PS.requestRender(); return; }
                st.stroke.to(pt);
                PS.requestRender();
            },
            onUp: function () {
                if (!st) { return; }
                var s = st;
                st = null;
                var layer = s.layer;
                if (s.kind === "smudge") {
                    if (PS.doc.selection) {
                        var keep = PS.filterResultWithSelection(s.before, PS.cloneCanvas(layer.canvas));
                        var c0 = layer.canvas.getContext("2d");
                        c0.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
                        c0.drawImage(keep, 0, 0);
                    }
                    PS.commitLayerCanvas("Smudge", layer, s.before);
                    PS.requestRender();
                    return;
                }
                PS.strokePreview = null;
                applyBox(s, s.stroke.take());
                var ctx = layer.canvas.getContext("2d");
                ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
                ctx.drawImage(s.out, 0, 0);
                PS.commitLayerCanvas(NAMES[kind] + " Tool", layer, s.before);
                PS.requestRender();
            },
            overlay: PS.paintCursorOverlay(function () { return PS.toolOpts[kind].size; }, false)
        });
    }

    register("blur");
    register("sharpen");
    register("smudge");
    register("dodge", "o");
    register("burn", "o");
    register("sponge", "o");
})();

/* ============================================================
   CROP (C)
   ============================================================ */

PS.CROP_RATIOS = [
    { v: "free", l: "Unconstrained" }, { v: "original", l: "Original Ratio" },
    { v: "1:1", l: "1 x 1 (Square)" }, { v: "4:5", l: "4 x 5 (8 x 10)" }, { v: "8.5:11", l: "8.5 x 11" },
    { v: "4:3", l: "4 x 3" }, { v: "5:7", l: "5 x 7" }, { v: "2:3", l: "2 x 3 (4 x 6)" },
    { v: "16:9", l: "16 x 9" }, { v: "16:10", l: "16 x 10" }, { v: "custom", l: "Custom ratio" }
];

(function () {
    var C = null;          // {cx, cy, w, h, a}: box centre, size and angle (radians)
    var drag = null;
    var HANDLES = ["tl", "t", "tr", "r", "br", "b", "bl", "l"];
    var HL = { tl: [-1, -1], t: [0, -1], tr: [1, -1], r: [1, 0], br: [1, 1], b: [0, 1], bl: [-1, 1], l: [-1, 0] };

    function reset() {
        var d = PS.doc;
        C = d ? { cx: d.width / 2, cy: d.height / 2, w: d.width, h: d.height, a: 0, fresh: true } : null;
    }
    function ensure() {
        var d = PS.doc;
        if (!d) { C = null; return null; }
        if (!C || C.doc !== d) { reset(); C.doc = d; }
        return C;
    }
    function ratio() {
        var o = PS.toolOpts.crop;
        if (o.ratio === "free") { return 0; }
        if (o.ratio === "original") { return PS.doc.width / PS.doc.height; }
        if (o.ratio === "custom") { return o.rw > 0 && o.rh > 0 ? o.rw / o.rh : 0; }
        var p = o.ratio.split(":");
        return parseFloat(p[0]) / parseFloat(p[1]);
    }
    // doc point <-> box frame (origin at the centre, axes along the box)
    function toLocal(p) {
        var c = Math.cos(-C.a), s = Math.sin(-C.a);
        var dx = p.x - C.cx, dy = p.y - C.cy;
        return { x: c * dx - s * dy, y: s * dx + c * dy };
    }
    function toDoc(l) {
        var c = Math.cos(C.a), s = Math.sin(C.a);
        return { x: C.cx + c * l.x - s * l.y, y: C.cy + s * l.x + c * l.y };
    }
    function handlePos(id) { return toDoc({ x: HL[id][0] * C.w / 2, y: HL[id][1] * C.h / 2 }); }

    function hit(pt) {
        var tol = 7 / PS.zoom;
        for (var i = 0; i < HANDLES.length; i++) {
            var h = handlePos(HANDLES[i]);
            if (Math.abs(h.x - pt.x) <= tol && Math.abs(h.y - pt.y) <= tol) { return { type: "handle", id: HANDLES[i] }; }
        }
        // the untouched full-canvas box: any drag draws a new one
        if (C.fresh) { return { type: "new" }; }
        var l = toLocal(pt);
        if (Math.abs(l.x) <= C.w / 2 && Math.abs(l.y) <= C.h / 2) { return { type: "move" }; }
        return { type: "rotate" };
    }

    function commit() {
        var d = PS.doc;
        if (!d || !C) { return; }
        var o = PS.toolOpts.crop;
        var w = Math.max(1, Math.round(C.w)), h = Math.max(1, Math.round(C.h));
        var a = C.a, cx = C.cx, cy = C.cy;
        var untouched = Math.abs(a) < 1e-9 && w === d.width && h === d.height && Math.abs(cx - d.width / 2) < 0.5 && Math.abs(cy - d.height / 2) < 0.5;
        if (untouched) { reset(); return; }
        var c = Math.cos(-a), s = Math.sin(-a);
        var m = [c, s, -s, c, w / 2 - (c * cx - s * cy), h / 2 - (s * cx + c * cy)];
        if (Math.abs(a) < 1e-9) { m = [1, 0, 0, 1, Math.round(w / 2 - cx), Math.round(h / 2 - cy)]; }
        PS.docGeometryOp("Crop", function () {
            PS.transformTree(m, w, h, { smooth: Math.abs(a) > 1e-9, keepOutside: !o.deleteCropped });
            d.width = w;
            d.height = h;
            d.selection = null;
            PS.renderPendingProcedural();
        });
        C = null;
        ensure();
        PS.zoomFit();
        PS.renderOptionsBar();
    }

    function cancel() {
        reset();
        if (C) { C.doc = PS.doc; }
        PS.renderOptionsBar();
        PS.requestRender();
    }

    PS.cropCommit = commit;
    PS.cropCancel = cancel;

    PS.registerTool("crop", {
        name: "Crop",
        key: "c",
        cursor: "default",
        icon: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M6 2v16h16M2 6h16v16"/></svg>',
        options: function (host) {
            var o = PS.toolOpts.crop;
            ensure();
            var sel = PS.ui.select(host, "", PS.CROP_RATIOS, o.ratio, function (v) {
                o.ratio = v;
                PS.savePrefsDebounced();
                if (C && ratio()) { var r = ratio(); C.h = C.w / r; C.fresh = false; }
                PS.renderOptionsBar();
                PS.requestRender();
            });
            sel.title = "Crop ratio";
            if (o.ratio === "custom") {
                PS.ui.numeric(host, "", o.rw, 0.001, 100000, 0.1, function (v) { o.rw = v; PS.savePrefsDebounced(); });
                PS.ui.label(host, "x");
                PS.ui.numeric(host, "", o.rh, 0.001, 100000, 0.1, function (v) { o.rh = v; PS.savePrefsDebounced(); });
            }
            var swap = document.createElement("button");
            swap.type = "button";
            swap.className = "opt-icon-btn";
            swap.title = "Swap height and width (portrait / landscape)";
            swap.innerHTML = '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M4 9h14l-4-4M20 15H6l4 4"/></svg>';
            swap.addEventListener("click", function () {
                if (!C) { return; }
                var t = C.w; C.w = C.h; C.h = t; C.fresh = false;
                if (o.ratio === "custom") { t = o.rw; o.rw = o.rh; o.rh = t; }
                PS.renderOptionsBar();
                PS.requestRender();
            });
            host.appendChild(swap);
            if (C) {
                PS.ui.label(host, Math.round(C.w) + " x " + Math.round(C.h) + " px" + (C.a ? "  " + (Math.round(C.a * 1800 / Math.PI) / 10) + "\u00b0" : ""));
            }
            PS.ui.sep(host);
            PS.ui.select(host, "View:", [{ v: "thirds", l: "Rule of Thirds" }, { v: "grid", l: "Grid" }, { v: "none", l: "None" }], o.overlay,
                function (v) { o.overlay = v; PS.savePrefsDebounced(); PS.requestRender(); });
            PS.ui.checkbox(host, "Delete Cropped Pixels", o.deleteCropped, function (v) { o.deleteCropped = v; PS.savePrefsDebounced(); });
            PS.ui.sep(host);
            var cb = document.createElement("button");
            cb.type = "button";
            cb.className = "opt-icon-btn opt-pin";
            cb.title = "Cancel the current crop operation (Esc)";
            cb.innerHTML = PS.TYPE_ICONS ? PS.TYPE_ICONS.cancel : "x";
            cb.addEventListener("click", cancel);
            host.appendChild(cb);
            var ok = document.createElement("button");
            ok.type = "button";
            ok.className = "opt-icon-btn tp-commit opt-pin";
            ok.title = "Commit the current crop operation (Enter)";
            ok.innerHTML = PS.TYPE_ICONS ? PS.TYPE_ICONS.commit : "ok";
            ok.addEventListener("click", commit);
            host.appendChild(ok);
        },
        onKey: function (e) {
            if (!ensure()) { return false; }
            if (e.key === "Enter") { commit(); return true; }
            if (e.key === "Escape") { cancel(); return true; }
            return false;
        },
        deactivate: function () { C = null; drag = null; },
        onDown: function (pt, e) {
            if (!ensure()) { return; }
            var h = hit(pt);
            drag = { h: h, start: pt, box: { cx: C.cx, cy: C.cy, w: C.w, h: C.h, a: C.a }, shift: e.shiftKey };
            if (h.type === "new") { drag.anchor = { x: pt.x, y: pt.y }; }
        },
        onMove: function (pt, e) {
            if (!ensure()) { return; }
            var ws = PS.el("workspace");
            if (!drag) {
                var h0 = hit(pt), hp0;
                if (h0.type === "handle") {
                    hp0 = handlePos(h0.id);
                    ws.style.cursor = PS.cursors.resize(Math.atan2(hp0.y - C.cy, hp0.x - C.cx));
                } else if (h0.type === "rotate") {
                    ws.style.cursor = PS.cursors.rotate(Math.atan2(pt.y - C.cy, pt.x - C.cx));
                } else {
                    ws.style.cursor = h0.type === "move" ? "move" : "crosshair";
                }
                return;
            }
            var b0 = drag.box;
            var r = ratio() || (e.shiftKey ? b0.w / b0.h : 0);
            if (drag.h.type === "new") {
                var x0 = Math.min(drag.anchor.x, pt.x), y0 = Math.min(drag.anchor.y, pt.y);
                var w = Math.abs(pt.x - drag.anchor.x), hh = Math.abs(pt.y - drag.anchor.y);
                if (r) { if (w / Math.max(1, hh) > r) { hh = w / r; } else { w = hh * r; } }
                if (pt.x < drag.anchor.x) { x0 = drag.anchor.x - w; }
                if (pt.y < drag.anchor.y) { y0 = drag.anchor.y - hh; }
                if (w > 2 && hh > 2) { C.cx = x0 + w / 2; C.cy = y0 + hh / 2; C.w = w; C.h = hh; C.a = 0; C.fresh = false; }
            } else if (drag.h.type === "move") {
                C.cx = b0.cx + pt.x - drag.start.x;
                C.cy = b0.cy + pt.y - drag.start.y;
                C.fresh = false;
            } else if (drag.h.type === "rotate") {
                var a0 = Math.atan2(drag.start.y - b0.cy, drag.start.x - b0.cx);
                var a1 = Math.atan2(pt.y - b0.cy, pt.x - b0.cx);
                var ang = b0.a + a1 - a0;
                if (e.shiftKey) { ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12); }
                C.a = ang;
                C.fresh = false;
            } else {
                // resize: the opposite side stays where it is
                var id = drag.h.id, sx = HL[id][0], sy = HL[id][1];
                var saved = { cx: C.cx, cy: C.cy, a: C.a, w: C.w, h: C.h };
                C.cx = b0.cx; C.cy = b0.cy; C.a = b0.a; C.w = b0.w; C.h = b0.h;
                var l = toLocal(pt);
                var L = -b0.w / 2, R = b0.w / 2, T = -b0.h / 2, B = b0.h / 2;
                if (sx < 0) { L = Math.min(l.x, R - 1); } else if (sx > 0) { R = Math.max(l.x, L + 1); }
                if (sy < 0) { T = Math.min(l.y, B - 1); } else if (sy > 0) { B = Math.max(l.y, T + 1); }
                var nw = R - L, nh = B - T;
                if (r) {
                    if (sx && sy) { if (nw / nh > r) { nh = nw / r; } else { nw = nh * r; } }
                    else if (sx) { nh = nw / r; } else { nw = nh * r; }
                    if (sx < 0) { L = R - nw; } else if (sx > 0) { R = L + nw; } else { L = -nw / 2; R = nw / 2; }
                    if (sy < 0) { T = B - nh; } else if (sy > 0) { B = T + nh; } else { T = -nh / 2; B = nh / 2; }
                }
                var nc = toDoc({ x: (L + R) / 2, y: (T + B) / 2 });
                C.cx = nc.x; C.cy = nc.y; C.w = R - L; C.h = B - T; C.fresh = false;
                void saved;
            }
            PS.renderOptionsBar();
            PS.requestRender();
        },
        onUp: function () { drag = null; },
        onDblClick: function (pt) {
            if (!ensure()) { return; }
            if (hit(pt).type === "move") { commit(); }
        },
        overlay: function (ctx) {
            if (!ensure()) { return; }
            var d = PS.doc;
            var corners = ["tl", "tr", "br", "bl"].map(function (id) { var p = handlePos(id); return PS.docToOverlay(p.x, p.y); });
            var o0 = PS.docToOverlay(0, 0), o1 = PS.docToOverlay(d.width, d.height);
            ctx.save();
            // shield over what is cropped away
            ctx.beginPath();
            ctx.rect(o0.x, o0.y, o1.x - o0.x, o1.y - o0.y);
            ctx.moveTo(corners[0].x, corners[0].y);
            for (var i = 3; i >= 1; i--) { ctx.lineTo(corners[i].x, corners[i].y); }
            ctx.closePath();
            ctx.fillStyle = "rgba(0,0,0,0.55)";
            ctx.fill("evenodd");
            // the box
            ctx.beginPath();
            corners.forEach(function (p, k) { if (k === 0) { ctx.moveTo(p.x, p.y); } else { ctx.lineTo(p.x, p.y); } });
            ctx.closePath();
            ctx.strokeStyle = "rgba(255,255,255,0.9)";
            ctx.lineWidth = 1;
            ctx.stroke();
            // overlay lines
            var ov = PS.toolOpts.crop.overlay;
            if (ov !== "none") {
                var n = ov === "grid" ? 8 : 3;
                ctx.beginPath();
                for (var k = 1; k < n; k++) {
                    var f = k / n - 0.5;
                    var a1 = toDoc({ x: f * C.w, y: -C.h / 2 }), a2 = toDoc({ x: f * C.w, y: C.h / 2 });
                    var b1 = toDoc({ x: -C.w / 2, y: f * C.h }), b2 = toDoc({ x: C.w / 2, y: f * C.h });
                    [[a1, a2], [b1, b2]].forEach(function (seg) {
                        var p1 = PS.docToOverlay(seg[0].x, seg[0].y), p2 = PS.docToOverlay(seg[1].x, seg[1].y);
                        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
                    });
                }
                ctx.strokeStyle = "rgba(255,255,255,0.45)";
                ctx.stroke();
            }
            // handles
            HANDLES.forEach(function (id) {
                var hp = handlePos(id), p = PS.docToOverlay(hp.x, hp.y);
                ctx.fillStyle = "#202020";
                ctx.fillRect(Math.round(p.x) - 4, Math.round(p.y) - 4, 9, 9);
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(Math.round(p.x) - 3, Math.round(p.y) - 3, 7, 7);
            });
            ctx.restore();
        }
    });
})();
