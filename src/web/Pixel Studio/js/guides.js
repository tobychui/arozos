/*
    Pixel Studio - rulers, guides and snapping
    Rulers run along the top and left edges of the workspace. Dragging out
    from a ruler drops a light-blue guide line (horizontal from the top ruler,
    vertical from the left ruler). Tools snap their input to nearby guides.
    Existing guides can be repositioned (or removed by dragging off-canvas)
    with the Move tool. Guides live in document space on PS.doc.guides.
*/
"use strict";

PS.RULER_SIZE = 20;
PS.GUIDE_COLOR = "#5cc8ff";
PS.SNAP_PX = 6;          // snap distance in screen pixels

PS.rulersOn = false;
PS.snapToGuides = true;

PS._guideDrag = null;    // {orient:'h'|'v', pos} dragging a NEW guide from a ruler
PS._guideMove = null;    // {orient, index, before} moving an existing guide

PS.ensureGuides = function () {
    if (PS.doc && !PS.doc.guides) { PS.doc.guides = { h: [], v: [] }; }
};

/* ---------- toggles ---------- */

PS.setRulers = function (on) {
    PS.rulersOn = !!on;
    PS.el("workspace-holder").classList.toggle("rulers-on", PS.rulersOn);
    PS.savePrefsDebounced();
};

PS.toggleRulers = function () { PS.setRulers(!PS.rulersOn); };

PS.toggleSnap = function () {
    PS.snapToGuides = !PS.snapToGuides;
    PS.savePrefsDebounced();
};

PS.hasGuides = function () {
    return !!(PS.doc && PS.doc.guides &&
        (PS.doc.guides.h.length || PS.doc.guides.v.length));
};

PS.clearGuides = function () {
    PS.ensureGuides();
    if (!PS.hasGuides()) { return; }
    var g = PS.doc.guides;
    var before = { h: g.h.slice(), v: g.v.slice() };
    PS.doc.guides = { h: [], v: [] };
    PS.pushHistory("Clear Guides",
        function () { PS.doc.guides = { h: before.h.slice(), v: before.v.slice() }; },
        function () { PS.doc.guides = { h: [], v: [] }; });
};

PS.addGuide = function (orient, pos) {
    PS.ensureGuides();
    var key = (orient === "h") ? "h" : "v";
    var arr = PS.doc.guides[key];
    var before = arr.slice();
    var after = arr.slice();
    after.push(Math.round(pos));
    PS.doc.guides[key] = after;
    PS.pushHistory("Add Guide",
        function () { PS.doc.guides[key] = before.slice(); },
        function () { PS.doc.guides[key] = after.slice(); });
};

/* ---------- snapping ---------- */

// Snap a document point to nearby guides (within SNAP_PX screen pixels).
PS.snapDocPoint = function (pt) {
    if (!PS.snapToGuides || !PS.doc || !PS.doc.guides) { return pt; }
    var g = PS.doc.guides;
    var thr = PS.SNAP_PX / PS.zoom;
    var x = pt.x, y = pt.y, best, bd, i;

    best = null; bd = thr;
    for (i = 0; i < g.v.length; i++) {
        var dv = Math.abs(pt.x - g.v[i]);
        if (dv <= bd) { bd = dv; best = g.v[i]; }
    }
    if (best !== null) { x = best; }

    best = null; bd = thr;
    for (i = 0; i < g.h.length; i++) {
        var dh = Math.abs(pt.y - g.h[i]);
        if (dh <= bd) { bd = dh; best = g.h[i]; }
    }
    if (best !== null) { y = best; }

    return { x: x, y: y };
};

/* ---------- existing-guide drag (Move tool only) ---------- */

PS.guideHitTest = function (rawPt) {
    if (PS.tool !== "move" || !PS.hasGuides()) { return null; }
    var thr = (PS.SNAP_PX - 1) / PS.zoom;
    var g = PS.doc.guides, i;
    for (i = 0; i < g.v.length; i++) {
        if (Math.abs(rawPt.x - g.v[i]) <= thr) { return { orient: "v", index: i }; }
    }
    for (i = 0; i < g.h.length; i++) {
        if (Math.abs(rawPt.y - g.h[i]) <= thr) { return { orient: "h", index: i }; }
    }
    return null;
};

PS.guidesDragging = function () { return !!PS._guideMove; };

PS.guideDragStart = function (rawPt) {
    var hit = PS.guideHitTest(rawPt);
    if (!hit) { return false; }
    PS._guideMove = {
        orient: hit.orient,
        index: hit.index,
        before: PS.doc.guides[hit.orient].slice()
    };
    return true;
};

PS.guideDragMove = function (rawPt) {
    if (!PS._guideMove) { return; }
    var gm = PS._guideMove;
    PS.doc.guides[gm.orient][gm.index] =
        Math.round(gm.orient === "h" ? rawPt.y : rawPt.x);
};

PS.guideDragEnd = function (rawPt) {
    if (!PS._guideMove) { return false; }
    var gm = PS._guideMove;
    PS._guideMove = null;
    var key = gm.orient;
    var arr = PS.doc.guides[key];
    var pos = Math.round(key === "h" ? rawPt.y : rawPt.x);
    var max = (key === "h") ? PS.doc.height : PS.doc.width;
    var before = gm.before;

    if (pos < 0 || pos > max) {
        arr.splice(gm.index, 1);   // dragged off the canvas -> remove
    } else {
        arr[gm.index] = pos;
    }
    var after = arr.slice();
    PS.pushHistory("Move Guide",
        function () { PS.doc.guides[key] = before.slice(); },
        function () { PS.doc.guides[key] = after.slice(); });
    return true;
};

/* ---------- ruler drag (create new guides) ---------- */

PS.bindGuides = function () {
    bindRuler(PS.el("ruler-top"), "h");    // top ruler -> horizontal guides
    bindRuler(PS.el("ruler-left"), "v");   // left ruler -> vertical guides

    function bindRuler(el, orient) {
        if (!el) { return; }
        el.addEventListener("pointerdown", function (e) {
            if (!PS.doc) { return; }
            el.setPointerCapture(e.pointerId);
            var p = PS.eventToDoc(e);
            PS._guideDrag = { orient: orient, pos: (orient === "h") ? p.y : p.x };
            e.preventDefault();
        });
        el.addEventListener("pointermove", function (e) {
            if (!PS._guideDrag) { return; }
            var p = PS.eventToDoc(e);
            PS._guideDrag.pos = (orient === "h") ? p.y : p.x;
        });
        function end(e) {
            if (!PS._guideDrag) { return; }
            var p = PS.eventToDoc(e);
            var pos = (orient === "h") ? p.y : p.x;
            var max = (orient === "h") ? PS.doc.height : PS.doc.width;
            PS._guideDrag = null;
            if (pos >= 0 && pos <= max) { PS.addGuide(orient, pos); }
        }
        el.addEventListener("pointerup", end);
        el.addEventListener("pointercancel", function () { PS._guideDrag = null; });
    }
};

/* ---------- ruler rendering ---------- */

function niceStep(target) {
    var steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
    for (var i = 0; i < steps.length; i++) {
        if (steps[i] >= target) { return steps[i]; }
    }
    return steps[steps.length - 1];
}

PS.drawRulers = function () {
    if (!PS.rulersOn || !PS.doc || !(PS.zoom > 0)) { return; }
    var holder = PS.el("workspace-holder");
    var hrect = holder.getBoundingClientRect();
    var pos = PS.el("canvas-positioner").getBoundingClientRect();
    var rs = PS.RULER_SIZE;
    var z = PS.zoom;

    var top = PS.el("ruler-top");
    var left = PS.el("ruler-left");
    var tw = Math.max(1, holder.clientWidth - rs);
    var lh = Math.max(1, holder.clientHeight - rs);
    if (top.width !== tw || top.height !== rs) { top.width = tw; top.height = rs; }
    if (left.width !== rs || left.height !== lh) { left.width = rs; left.height = lh; }

    // screen position (in each ruler's own canvas coords) of document 0
    var originX = (pos.left - hrect.left) - rs;
    var originY = (pos.top - hrect.top) - rs;

    drawAxis(top.getContext("2d"), tw, rs, "x", originX, z);
    drawAxis(left.getContext("2d"), rs, lh, "y", originY, z);
};

function drawAxis(ctx, w, h, axis, origin, z) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#2b2b30";
    ctx.fillRect(0, 0, w, h);

    var len = (axis === "x") ? w : h;
    var step = niceStep(64 / z);          // major ticks ~64px apart
    var minor = step / 5;                 // 5 minor ticks per major

    ctx.strokeStyle = "#666";
    ctx.fillStyle = "#9a9a9a";
    ctx.font = "9px sans-serif";
    ctx.textBaseline = "top";
    ctx.lineWidth = 1;

    // integer minor-tick index of the first tick at or before the visible start
    var startK = Math.floor((-origin / z) / minor);
    var majorTickLen = Math.round(h * 0.6);
    var minorTickLen = Math.round(h * 0.3);

    ctx.beginPath();
    var guard = 100000;
    for (var k = startK; guard-- > 0; k++) {
        var val = k * minor;
        var s = origin + val * z;
        if (s > len + 1) { break; }
        if (s < -1) { continue; }
        var isMajor = (k % 5 === 0);
        var sp = Math.round(s) + 0.5;
        var tick = isMajor ? majorTickLen : minorTickLen;
        if (axis === "x") {
            ctx.moveTo(sp, h - tick);
            ctx.lineTo(sp, h);
        } else {
            ctx.moveTo(w - tick, sp);
            ctx.lineTo(w, sp);
        }
        if (isMajor) {
            var label = String(Math.round(val));
            if (axis === "x") {
                ctx.fillText(label, sp + 2, 1);
            } else {
                // rotate 90deg; translate so the glyphs land inside the
                // 20px-wide ruler (textBaseline "top" maps to decreasing x)
                ctx.save();
                ctx.translate(10, sp + 2);
                ctx.rotate(Math.PI / 2);
                ctx.fillText(label, 0, 0);
                ctx.restore();
            }
        }
    }
    ctx.stroke();
}

/* ---------- guide overlay (drawn on the main overlay canvas) ---------- */

PS.drawGuides = function (ctx) {
    if (!PS.doc) { return; }
    PS.ensureGuides();
    var g = PS.doc.guides;
    var o = PS.docToOverlay(0, 0);
    var z = PS.zoom;
    var H = ctx.canvas.height, W = ctx.canvas.width;
    var i;

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = PS.GUIDE_COLOR;

    for (i = 0; i < g.v.length; i++) {
        var sx = Math.round(o.x + g.v[i] * z) + 0.5;
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
    }
    for (i = 0; i < g.h.length; i++) {
        var sy = Math.round(o.y + g.h[i] * z) + 0.5;
        ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
    }

    // live preview while dragging a new guide out of a ruler
    if (PS._guideDrag) {
        ctx.setLineDash([4, 3]);
        if (PS._guideDrag.orient === "h") {
            var py = Math.round(o.y + PS._guideDrag.pos * z) + 0.5;
            ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
        } else {
            var px = Math.round(o.x + PS._guideDrag.pos * z) + 0.5;
            ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
        }
        ctx.setLineDash([]);
    }
    ctx.restore();
};
