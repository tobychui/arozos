/*
    Pixel Studio - Free Transform (Ctrl+T) and Transform Selection

    One engine transforms
        selected pixels        (a selection on a pixel layer or a mask)
        whole layers           (every selected / linked layer, groups with
                               their contents; text and shape layers stay
                               editable, smart objects keep their placement)
        the selection itself   (Select > Transform Selection)
    with handles:
        drag inside            move
        drag a handle          scale (Shift keeps proportions, Alt scales
                               around the reference point)
        drag outside the box   rotate around the reference point (Shift
                               snaps to 15 degrees)
        Ctrl + side handle     skew
        Ctrl + corner          distort (free corner)
        Ctrl+Alt+Shift+corner  perspective
        drag the centre point  move the reference point
    Enter or a double-click inside commits, Esc cancels. The options bar shows
    X / Y / W / H / angle / skew for typing exact values.

    The transform is a 4-corner quad (the source rectangle's destination).
    While it is an affine map (move, scale, rotate, skew, flip) it is also
    kept as a 2x3 matrix and drawn with Canvas 2D; distort and perspective
    make it projective and pixels are resampled on the GPU.
*/
"use strict";

PS.layerPreviews = new Map();
PS.maskPreviews = new Map();
PS.vmaskPreviews = new Map();

PS.transform = (function () {
    var S = null;              // the active session
    var lastDelta = null;      // doc -> doc homography of the last commit (Transform Again)
    var sessionSerial = 0;
    var HANDLE_PX = 8;
    var ROTATE_CURSOR = PS.cursors.rotate(-Math.PI / 4);

    /* ---------- matrix helpers ---------- */

    function aff(p, m) { return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }; }
    function mul(A, B) {
        return [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
            A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
            A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
    }
    function inv(m) {
        var det = m[0] * m[3] - m[1] * m[2] || 1e-12;
        return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
            (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
    }
    function T(x, y) { return [1, 0, 0, 1, x, y]; }
    function Sc(x, y) { return [x, 0, 0, y, 0, 0]; }
    function R(a) { var c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, 0, 0]; }

    // 3x3 helpers (row major, maps [x, y, 1])
    function h3FromAff(m) { return [m[0], m[2], m[4], m[1], m[3], m[5], 0, 0, 1]; }
    function h3Mul(A, B) {
        var o = new Array(9);
        for (var r = 0; r < 3; r++) {
            for (var c = 0; c < 3; c++) {
                o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
            }
        }
        return o;
    }
    function h3Inv(m) {
        var a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
        var A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
        var det = a * A + b * B + c * C || 1e-12;
        return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
            B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
            C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
    }
    function h3Apply(m, p) {
        var w = m[6] * p.x + m[7] * p.y + m[8];
        return { x: (m[0] * p.x + m[1] * p.y + m[2]) / w, y: (m[3] * p.x + m[4] * p.y + m[5]) / w };
    }
    // unit square -> quad (tl, tr, br, bl)
    function squareToQuad(q) {
        var p0 = q[0], p1 = q[1], p2 = q[2], p3 = q[3];
        var sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y;
        if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
            return [p1.x - p0.x, p3.x - p0.x, p0.x, p1.y - p0.y, p3.y - p0.y, p0.y, 0, 0, 1];
        }
        var dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
        var den = dx1 * dy2 - dx2 * dy1 || 1e-12;
        var g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
        return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
            p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h, 1];
    }
    // doc -> doc homography taking the session source rectangle to the quad
    function homography(src, quad) {
        var N = [1 / src.w, 0, -src.x / src.w, 0, 1 / src.h, -src.y / src.h, 0, 0, 1];
        return h3Mul(squareToQuad(quad), N);
    }
    function isAffineH(H) { return Math.abs(H[6]) < 1e-10 && Math.abs(H[7]) < 1e-10; }
    function affFromH(H) { return [H[0] / H[8], H[3] / H[8], H[1] / H[8], H[4] / H[8], H[2] / H[8], H[5] / H[8]]; }

    function corners(r) {
        return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
    }

    /* ---------- resampling ---------- */

    // GPU program: draw a source texture through an inverse homography
    PS.gpu.defineProgram("warpQuad", [
        "uniform sampler2D uSrc; uniform vec2 uSrcOrigin; uniform vec2 uSrcSize;",
        "uniform mat3 uHinv; uniform vec2 uOutOrigin; uniform vec4 uFill; uniform int uUseFill;",
        "void main() {",
        "    vec2 q = gl_FragCoord.xy + uOutOrigin;",
        "    vec3 s = uHinv * vec3(q, 1.0);",
        "    vec2 sp = s.xy / s.z;",
        "    vec2 uv = (sp - uSrcOrigin) / uSrcSize;",
        "    vec4 c;",
        "    if (s.z <= 0.0 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {",
        "        c = uUseFill == 1 ? uFill : vec4(0.0);",
        "    } else {",
        "        vec4 pm = texture(uSrc, uv);",
        "        c = pm.a > 0.0 ? vec4(pm.rgb / pm.a, pm.a) : vec4(0.0);",
        "    }",
        "    outColor = c;",
        "}"
    ].join("\n"));

    var warpSerial = 0;
    var warpKeys = new WeakMap();   // source canvas -> texture cache keys

    // Warp src (a canvas whose top-left sits at doc point srcLeft/srcTop)
    // by the doc -> doc homography H into a new canvas covering out (a doc
    // rectangle). fill (css colour) paints what the source does not cover.
    // o.rev: a stable id while the source is unchanged (skips re-uploads
    // during a drag); o.interp: "nearest" | "bilinear" | "bicubic"
    function warp(src, srcLeft, srcTop, H, out, fill, o) {
        o = o || {};
        var nearest = o.interp === "nearest";
        var c = PS.createCanvas(out.w, out.h);
        var ctx = c.getContext("2d");
        if (isAffineH(H) || !PS.renderer.usesGL) {
            // masks: the fill shows wherever the (opaque) source does not land
            if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, out.w, out.h); }
            var m = affFromH(H);
            ctx.save();
            ctx.imageSmoothingEnabled = !nearest;
            ctx.imageSmoothingQuality = o.interp === "bilinear" ? "low" : "high";
            ctx.setTransform(m[0], m[1], m[2], m[3], m[4] - out.x, m[5] - out.y);
            ctx.drawImage(src, srcLeft, srcTop);
            ctx.restore();
            return c;
        }
        var G = PS.gpu;
        var gl = G.gl;
        var keys = warpKeys.get(src);
        if (!keys) { keys = { lin: {}, near: {} }; warpKeys.set(src, keys); }
        var tex = G.sourceTexture(nearest ? keys.near : keys.lin, src, o.rev || ("warp" + (++warpSerial)),
            { filtered: true, nearest: nearest });
        var Hi = h3Inv(H);
        var target = G.acquire(out.w, out.h, { format: "rgba8" });
        var rgb = fill ? (PS.hexToRgb(fill) || { r: 255, g: 255, b: 255 }) : null;
        G.pass("warpQuad", target, {
            uSrc: tex, uSrcOrigin: [srcLeft, srcTop], uSrcSize: [src.width, src.height],
            // GLSL mat3 is column major
            uHinv: [Hi[0], Hi[3], Hi[6], Hi[1], Hi[4], Hi[7], Hi[2], Hi[5], Hi[8]],
            uOutOrigin: [out.x, out.y],
            uFill: rgb ? [rgb.r / 255, rgb.g / 255, rgb.b / 255, 1] : [0, 0, 0, 0], uUseFill: rgb ? 1 : 0
        });
        var img = G.readTarget(target);
        G.release(target);
        ctx.putImageData(img, 0, 0);
        void gl;
        return c;
    }
    PS.warpCanvas = warp;

    function docRect() { return { x: 0, y: 0, w: PS.doc.width, h: PS.doc.height }; }

    function quadBounds(q) {
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        q.forEach(function (p) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
        x0 = Math.floor(x0); y0 = Math.floor(y0);
        return { x: x0, y: y0, w: Math.max(1, Math.ceil(x1) - x0), h: Math.max(1, Math.ceil(y1) - y0) };
    }

    /* ---------- building a session ---------- */

    function bounds(canvas) {
        var b = PS.maskBounds(canvas);
        return b;
    }

    function union(a, b) {
        if (!a) { return b; }
        if (!b) { return a; }
        var x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
        return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
    }

    // The box a layer contributes to a transform: its visible pixels (text
    // included, and whatever lies beyond the canvas edge) or its shape
    // paths. Cached until the layer changes.
    function layerBox(l) {
        if (l.canvas && (l.kind === "raster" || l.kind === "smart" || l.kind === "text")) {
            var oc = l.offcanvas;
            var key = l.rev + ":" + l.canvas.width + "x" + l.canvas.height +
                (oc ? ":" + oc.left + "," + oc.top + "," + oc.canvas.width + "x" + oc.canvas.height : "");
            if (l._tbox && l._tbox.key === key) { return l._tbox.box; }
            var full = oc ? PS.offcanvasMerged(l) : { canvas: l.canvas, left: 0, top: 0 };
            var b = bounds(full.canvas);
            var box = b ? { x: b.x + full.left, y: b.y + full.top, w: b.w, h: b.h } : null;
            l._tbox = { key: key, box: box };
            return box;
        }
        if (l.kind === "shape" && l.vmask) { return PS.pathsBounds(l.vmask.paths); }
        return null;
    }

    // The layers a layer transform works on: the selected ones (with their
    // linked layers) whose position is not locked
    function transformLayers() {
        var tops = PS.withLinkedLayers ? PS.withLinkedLayers(PS.topLevelSelected()) : PS.topLevelSelected();
        return tops.filter(function (l) { return !l.locks.position && !PS.ancestorsOf(l).some(function (a) { return a.locks.position; }); });
    }

    // Box of a layer transform of the current selection (what the Move
    // tool's transform controls show), or null
    function layersBox() {
        if (!PS.doc) { return null; }
        var src = null;
        PS.expandWithDescendants(transformLayers()).forEach(function (l) {
            if (l.visible === false && l.kind !== "group") { return; }
            src = union(src, layerBox(l));
        });
        return src;
    }

    // kind: "auto" (Ctrl+T), "pixels", "layers", "selection"; mode: free | scale |
    // rotate | skew | distort | perspective
    function begin(opts) {
        opts = opts || {};
        var d = PS.doc;
        if (!d) { return false; }
        if (S) { commit(); }
        if (PS.commitTextEdit) { PS.commitTextEdit(); }
        var kind = opts.kind || "auto";
        var target = PS.activeLayer() ? PS.paintTarget() : null;
        if (kind === "auto") {
            kind = (d.selection && target && PS.isPaintable(target)) ? "pixels" : "layers";
        }
        var s = {
            kind: kind, mode: opts.mode || "free", items: [], selBefore: d.selection,
            interp: PS.prefs.transformInterp || "bicubic", previewRev: 1, dirty: true,
            srcRev: "tsrc" + (++sessionSerial), keepRatio: false
        };
        var src = null;
        if (kind === "selection") {
            if (!d.selection) { PS.toast("Make a selection first", true); return false; }
            src = d.selection.bounds;
            s.selMask = d.selection.mask;
        } else if (kind === "pixels") {
            if (!d.selection || !target) { return false; }
            if (target.locks && (target.locks.pixels || target.locks.position)) { PS.toast("Layer is locked", true); return false; }
            src = d.selection.bounds;
            var base = PS.cloneCanvas(target.canvas);
            var bctx = base.getContext("2d");
            bctx.globalCompositeOperation = "destination-out";
            bctx.drawImage(d.selection.mask, 0, 0);
            var selPx = PS.getSelectedPixels(target.canvas).canvas;
            var fl = PS.createCanvas(src.w, src.h);
            fl.getContext("2d").drawImage(selPx, -src.x, -src.y);
            s.items.push({ type: "pixels", layer: target, base: base, float: fl, before: PS.snapshotLayer(target) });
            s.selMask = d.selection.mask;
        } else {
            var tops = transformLayers();
            if (!tops.length) { PS.toast("Layer position is locked", true); return false; }
            var all = PS.expandWithDescendants(tops);
            all.forEach(function (l) {
                var it = { type: l.kind, layer: l, state: PS.captureLayerState(l) };
                if (l.canvas && (l.kind === "raster" || l.kind === "smart" || l.kind === "text")) {
                    it.full = l.offcanvas ? PS.offcanvasMerged(l) : { canvas: l.canvas, left: 0, top: 0 };
                }
                // the box hugs the visible pixels, text included
                if (l.visible !== false || l.kind === "group") { src = union(src, layerBox(l)); }
                s.items.push(it);
            });
            if (!src) {
                // nothing but masks / fills: transform around the canvas
                src = docRect();
            }
        }
        if (!src || src.w < 1 || src.h < 1) { PS.toast("Nothing to transform", true); return false; }
        s.src = { x: src.x, y: src.y, w: src.w, h: src.h };
        s.M = [1, 0, 0, 1, 0, 0];
        s.quad = corners(s.src);
        s.ref = { x: s.src.x + s.src.w / 2, y: s.src.y + s.src.h / 2 };
        S = s;
        if (opts.matrix) { applyDeltaH(opts.matrix); }
        PS.renderOptionsBar();
        schedulePreview();
        return true;
    }

    function H() { return S.M ? h3FromAff(S.M) : homography(S.src, S.quad); }

    function syncQuad() { if (S.M) { S.quad = corners(S.src).map(function (p) { return aff(p, S.M); }); } }

    function applyDeltaH(Hd) {
        // compose an extra doc -> doc transform on top of the current one
        if (S.M && isAffineH(Hd)) {
            S.M = mul(affFromH(Hd), S.M);
        } else {
            var cur = H();
            S.quad = corners(S.src).map(function (p) { return h3Apply(h3Mul(Hd, cur), p); });
            S.M = null;
        }
        syncQuad();
        S.ref = isAffineH(Hd) ? aff(S.ref, affFromH(Hd)) : h3Apply(Hd, S.ref);
    }

    /* ---------- preview ---------- */

    var previewQueued = false;
    function schedulePreview() {
        if (previewQueued) { return; }
        previewQueued = true;
        requestAnimationFrame(function () {
            previewQueued = false;
            if (S) { renderPreview(); }
        });
    }

    function renderItem(s, it, Hm, final) {
        var d = PS.doc;
        var out = { canvas: null, mask: null, vmaskPaths: null, text: null };
        var wo = { rev: s.srcRev, interp: s.interp };
        if (it.type === "pixels") {
            var c = PS.cloneCanvas(it.base);
            var w = warp(it.float, s.src.x, s.src.y, Hm, docRect(), null, wo);
            c.getContext("2d").drawImage(w, 0, 0);
            out.canvas = c;
            return out;
        }
        var l = it.layer;
        if (l.kind === "text" && l.text && l.text.psd && isAffineH(Hm)) {
            // type stays live: only its transform changes
            var t = PS.deepCopy(l.text.psd);
            var a = t.transform || [1, 0, 0, 1, 0, 0];
            t.transform = mul(affFromH(Hm), [a[0], a[1], a[2], a[3], a[4], a[5]]);
            out.text = t;
            var tc = PS.createCanvas(d.width, d.height);
            PS.drawTextLayout(tc.getContext("2d"), t, PS.layoutText(t));
            out.canvas = tc;
        } else if (l.kind === "shape") {
            var paths = PS.deepCopy(l.vmask ? l.vmask.paths : []);
            transformPaths(paths, Hm);
            out.vmaskPaths = paths;
            var temp = { kind: "shape", canvas: PS.createCanvas(d.width, d.height), fill: l.fill, stroke: l.stroke,
                vmask: { paths: paths, psd: l.vmask && l.vmask.psd }, rev: 0 };
            PS.renderProceduralLayer(temp);
            out.canvas = temp.canvas;
        } else if (it.full && (l.kind === "raster" || l.kind === "smart" || l.kind === "text")) {
            if (final) {
                // the whole raster, including whatever lands beyond the canvas
                var bb = quadBounds(transformedFullBounds(it, Hm));
                out.full = { canvas: warp(it.full.canvas, it.full.left, it.full.top, Hm, bb, null, wo), left: bb.x, top: bb.y };
            } else {
                out.canvas = warp(it.full.canvas, it.full.left, it.full.top, Hm, docRect(), null, wo);
            }
        }
        if (l.mask && l.mask.linked !== false) {
            var v = l.mask.defaultColor === undefined ? 255 : l.mask.defaultColor;
            out.mask = warp(l.mask.canvas, 0, 0, Hm, docRect(), "rgb(" + v + "," + v + "," + v + ")", { rev: s.srcRev + "m", interp: s.interp });
        }
        if (l.vmask && l.kind !== "shape" && l.vmask.linked !== false) {
            var vp = PS.deepCopy(l.vmask.paths);
            transformPaths(vp, Hm);
            out.vmaskPaths = vp;
        }
        return out;
    }

    function transformedFullBounds(it, Hm) {
        var f = it.full;
        var q = corners({ x: f.left, y: f.top, w: f.canvas.width, h: f.canvas.height }).map(function (p) { return h3Apply(Hm, p); });
        return q;
    }

    function transformPaths(paths, Hm) {
        (paths || []).forEach(function (sp) {
            (sp.knots || []).forEach(function (k) {
                for (var i = 0; i < 6; i += 2) {
                    var p = h3Apply(Hm, { x: k.points[i], y: k.points[i + 1] });
                    k.points[i] = p.x; k.points[i + 1] = p.y;
                }
            });
        });
    }

    function renderPreview() {
        var Hm = H();
        S.previewRev++;
        S.items.forEach(function (it) {
            var r = renderItem(S, it, Hm, false);
            var key = it.layer;
            if (r.canvas) { PS.layerPreviews.set(key, { canvas: r.canvas, rev: S.previewRev }); }
            if (it.type === "pixels" && it.layer.isMaskTarget) {
                PS.maskPreviews.set(it.layer.owner, { canvas: r.canvas, rev: S.previewRev });
                PS.layerPreviews.delete(key);
            }
            if (r.mask) { PS.maskPreviews.set(it.layer, { canvas: r.mask, rev: S.previewRev }); }
            if (r.vmaskPaths && it.layer.kind !== "shape") {
                var d = PS.doc;
                PS.vmaskPreviews.set(it.layer, { canvas: PS.rasterizePaths(r.vmaskPaths, d.width, d.height), rev: S.previewRev });
            }
        });
        PS.requestRender();
    }

    function clearPreviews() {
        PS.layerPreviews.clear();
        PS.maskPreviews.clear();
        PS.vmaskPreviews.clear();
    }

    /* ---------- commit / cancel ---------- */

    function commit() {
        if (!S) { return; }
        var s = S;
        var Hm = H();
        S = null;
        clearPreviews();
        var d = PS.doc;
        var identity = isAffineH(Hm) && Math.abs(Hm[0] - 1) < 1e-9 && Math.abs(Hm[4] - 1) < 1e-9 &&
            Math.abs(Hm[1]) < 1e-9 && Math.abs(Hm[3]) < 1e-9 && Math.abs(Hm[2]) < 1e-9 && Math.abs(Hm[5]) < 1e-9;
        if (identity) { finish(); return; }
        lastDelta = Hm;

        var selBefore = s.selBefore, selAfter = selBefore;
        if (s.selMask) {
            var wm = warp(s.selMask, 0, 0, Hm, docRect(), null, { rev: s.srcRev + "s" });
            selAfter = PS.buildSelectionObject(wm);
        }

        if (s.kind === "selection") {
            d.selection = selBefore;
            PS.setSelection(selAfter ? selAfter.mask : null, "replace", "Transform Selection");
            finish();
            return;
        }

        if (s.kind === "pixels") {
            var it = s.items[0];
            var r = renderItem(s, it, Hm, true);
            PS.restoreLayerCanvas(it.layer, r.canvas);
            var layer = it.layer, before = it.before, after = PS.cloneCanvas(layer.canvas);
            d.selection = selAfter;
            PS.pushHistory("Free Transform",
                function () { PS.restoreLayerCanvas(layer, before); PS.doc.selection = selBefore; },
                function () { PS.restoreLayerCanvas(layer, after); PS.doc.selection = selAfter; });
            finish();
            return;
        }

        // whole layers
        var befores = s.items.map(function (x) {
            return { state: x.state, kind: x.layer.kind, text: x.layer.text ? PS.deepCopy(x.layer.text) : null };
        });
        s.items.forEach(function (x) {
            var l = x.layer;
            var r2 = renderItem(s, x, Hm, true);
            if (l.kind === "text" && r2.text) {
                l.text.psd = r2.text;
                PS.renderTextLayer(l);
            } else if (l.kind === "shape") {
                l.vmask.paths = r2.vmaskPaths;
                l.vmask.rev = (l.vmask.rev || 0) + 1;
                PS.renderProceduralLayer(l);
            } else if (r2.full) {
                PS.setOffcanvasRaster(l, r2.full);
                if (l.kind === "text") {
                    // a projective change cannot stay live text: it becomes pixels
                    l.kind = "raster";
                    l.text = null;
                }
                if (l.kind === "smart" && l.smart && l.smart.transform) {
                    var t = l.smart.transform;
                    for (var i = 0; i < t.length; i += 2) {
                        var p = h3Apply(Hm, { x: t[i], y: t[i + 1] });
                        t[i] = p.x; t[i + 1] = p.y;
                    }
                }
            }
            if (r2.mask) {
                var mc = l.mask.canvas.getContext("2d");
                mc.clearRect(0, 0, d.width, d.height);
                mc.drawImage(r2.mask, 0, 0);
                l.mask.rev++;
            }
            if (r2.vmaskPaths && l.kind !== "shape" && l.vmask) {
                l.vmask.paths = r2.vmaskPaths;
                l.vmask.rev = (l.vmask.rev || 0) + 1;
            }
        });
        var afters = s.items.map(function (x) {
            return { state: PS.captureLayerState(x.layer), kind: x.layer.kind, text: x.layer.text ? PS.deepCopy(x.layer.text) : null };
        });
        function put(list) {
            s.items.forEach(function (x, i) {
                x.layer.kind = list[i].kind;
                x.layer.text = list[i].text ? PS.deepCopy(list[i].text) : null;
                PS.restoreLayerState(x.layer, list[i].state);
            });
        }
        d.selection = selAfter;
        PS.pushHistory("Free Transform",
            function () { put(befores); PS.doc.selection = selBefore; },
            function () { put(afters); PS.doc.selection = selAfter; });
        finish();
    }

    function cancel() {
        if (!S) { return; }
        S = null;
        clearPreviews();
        finish();
    }

    function finish() {
        PS.renderOptionsBar();
        PS.requestRender();
        PS.renderLayersPanel();
        var ws = PS.el("workspace");
        if (ws) { ws.style.cursor = PS.toolCursor(); }
    }

    /* ---------- direct manipulation ---------- */

    var SRC_HANDLES = {
        tl: function (r) { return { x: r.x, y: r.y }; }, tr: function (r) { return { x: r.x + r.w, y: r.y }; },
        br: function (r) { return { x: r.x + r.w, y: r.y + r.h }; }, bl: function (r) { return { x: r.x, y: r.y + r.h }; },
        t: function (r) { return { x: r.x + r.w / 2, y: r.y }; }, r: function (r) { return { x: r.x + r.w, y: r.y + r.h / 2 }; },
        b: function (r) { return { x: r.x + r.w / 2, y: r.y + r.h }; }, l: function (r) { return { x: r.x, y: r.y + r.h / 2 }; }
    };
    var OPPOSITE = { tl: "br", tr: "bl", br: "tl", bl: "tr", t: "b", b: "t", l: "r", r: "l" };
    var QIDX = { tl: 0, tr: 1, br: 2, bl: 3 };

    function handlePoints() {
        var q = S.quad;
        function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
        return {
            tl: q[0], tr: q[1], br: q[2], bl: q[3],
            t: mid(q[0], q[1]), r: mid(q[1], q[2]), b: mid(q[2], q[3]), l: mid(q[3], q[0])
        };
    }

    function insideQuad(p) {
        var q = S.quad, c = false;
        for (var i = 0, j = 3; i < 4; j = i++) {
            if (((q[i].y > p.y) !== (q[j].y > p.y)) &&
                (p.x < (q[j].x - q[i].x) * (p.y - q[i].y) / ((q[j].y - q[i].y) || 1e-9) + q[i].x)) { c = !c; }
        }
        return c;
    }

    function hit(pt) {
        if (!S) { return null; }
        var tol = (HANDLE_PX / 2 + 3) / PS.zoom;
        if (Math.abs(pt.x - S.ref.x) <= tol && Math.abs(pt.y - S.ref.y) <= tol) { return { type: "ref" }; }
        var hp = handlePoints();
        var ids = ["tl", "tr", "br", "bl", "t", "r", "b", "l"];
        for (var i = 0; i < ids.length; i++) {
            var h = hp[ids[i]];
            if (Math.abs(pt.x - h.x) <= tol && Math.abs(pt.y - h.y) <= tol) { return { type: "handle", id: ids[i] }; }
        }
        if (insideQuad(pt)) { return { type: "move" }; }
        return { type: "rotate" };
    }

    function quadCentre() {
        var q = S.quad;
        return { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 };
    }

    function cursorFor(h, pt) {
        if (!h) { return null; }
        if (h.type === "ref") { return "crosshair"; }
        if (h.type === "move") { return PS.cursors.move; }
        var c = quadCentre();
        if (h.type === "rotate") {
            if (S.mode === "scale" || S.mode === "distort" || S.mode === "perspective" || S.mode === "skew") { return "default"; }
            // the curved arrow bends around the corner nearest the pointer
            return PS.cursors.rotate(pt ? Math.atan2(pt.y - c.y, pt.x - c.x) : -Math.PI / 4);
        }
        // a double arrow along the handle's direction from the centre
        var hp = handlePoints()[h.id];
        return PS.cursors.resize(Math.atan2(hp.y - c.y, hp.x - c.x));
    }

    var drag = null;

    // force: a handle id or "rotate" when the caller already knows what was grabbed
    function pointerDown(pt, e, force) {
        if (!S) { return false; }
        var h = force ? (force === "rotate" ? { type: "rotate" } : { type: "handle", id: force }) : hit(pt);
        drag = { h: h, start: pt, M0: S.M ? S.M.slice() : null, quad0: S.quad.map(function (p) { return { x: p.x, y: p.y }; }),
            ref0: { x: S.ref.x, y: S.ref.y } };
        if (h.type === "handle") {
            var ctrl = e.ctrlKey || e.metaKey;
            var corner = h.id.length === 2;
            if (S.mode === "perspective" || (ctrl && e.altKey && e.shiftKey && corner)) { drag.op = corner ? "perspective" : "edge"; }
            else if (S.mode === "distort" || (ctrl && corner)) { drag.op = corner ? "distort" : "edge"; }
            else if (S.mode === "skew" || (ctrl && !corner)) { drag.op = corner ? "distort" : "skew"; }
            else if (S.mode === "rotate") { drag.op = "rotate"; }
            else { drag.op = "scale"; }
            if ((drag.op === "scale" || drag.op === "skew") && !S.M) { drag.op = corner ? "distort" : "edge"; }
        } else if (h.type === "rotate") {
            drag.op = (S.mode === "free" || S.mode === "rotate") ? "rotate" : "none";
        } else if (h.type === "ref") {
            drag.op = "ref";
        } else {
            drag.op = S.mode === "rotate" ? "rotate" : "move";
        }
        return true;
    }

    function pointerMove(pt, e) {
        if (!S) { return; }
        if (!drag) {
            PS.el("workspace").style.cursor = cursorFor(hit(pt), pt) || "default";
            return;
        }
        var dx = pt.x - drag.start.x, dy = pt.y - drag.start.y;
        var op = drag.op;
        if (op === "none") { return; }
        if (op === "ref") {
            S.ref = { x: drag.ref0.x + dx, y: drag.ref0.y + dy };
            PS.renderOptionsBar();
            return;
        }
        if (op === "move") {
            if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) { dy = 0; } else { dx = 0; } }
            if (drag.M0) { S.M = mul(T(dx, dy), drag.M0); syncQuad(); }
            else { S.quad = drag.quad0.map(function (p) { return { x: p.x + dx, y: p.y + dy }; }); }
            S.ref = { x: drag.ref0.x + dx, y: drag.ref0.y + dy };
        } else if (op === "rotate") {
            var a0 = Math.atan2(drag.start.y - drag.ref0.y, drag.start.x - drag.ref0.x);
            var a1 = Math.atan2(pt.y - drag.ref0.y, pt.x - drag.ref0.x);
            var ang = a1 - a0;
            if (e.shiftKey) {
                var cur = drag.M0 ? Math.atan2(drag.M0[1], drag.M0[0]) : 0;
                var snap = Math.PI / 12;
                ang = Math.round((cur + ang) / snap) * snap - cur;
            }
            var Rm = mul(T(drag.ref0.x, drag.ref0.y), mul(R(ang), T(-drag.ref0.x, -drag.ref0.y)));
            if (drag.M0) { S.M = mul(Rm, drag.M0); syncQuad(); }
            else { S.quad = drag.quad0.map(function (p) { return aff(p, Rm); }); }
        } else if (op === "scale") {
            var id = drag.h.id;
            var M0i = inv(drag.M0);
            var local = aff(pt, M0i);
            var hsrc = SRC_HANDLES[id](S.src);
            var o = e.altKey ? aff(drag.ref0, M0i) : SRC_HANDLES[OPPOSITE[id]](S.src);
            var sx = 1, sy = 1;
            if (id.length === 2 || id === "l" || id === "r") { sx = (local.x - o.x) / ((hsrc.x - o.x) || 1e-9); }
            if (id.length === 2 || id === "t" || id === "b") { sy = (local.y - o.y) / ((hsrc.y - o.y) || 1e-9); }
            if (e.shiftKey) {
                if (id.length === 2) {
                    var u = Math.abs(sx) > Math.abs(sy) ? Math.abs(sx) : Math.abs(sy);
                    sx = (sx < 0 ? -1 : 1) * u; sy = (sy < 0 ? -1 : 1) * u;
                } else if (id === "l" || id === "r") { sy = Math.abs(sx); }
                else { sx = Math.abs(sy); }
            }
            S.M = mul(drag.M0, mul(T(o.x, o.y), mul(Sc(sx, sy), T(-o.x, -o.y))));
            syncQuad();
            if (!e.altKey) { S.ref = aff({ x: S.src.x + S.src.w / 2, y: S.src.y + S.src.h / 2 }, S.M); }
        } else if (op === "skew") {
            var id2 = drag.h.id;
            var Mi = inv(drag.M0);
            var loc = aff(pt, Mi);
            var hs = SRC_HANDLES[id2](S.src), os = SRC_HANDLES[OPPOSITE[id2]](S.src);
            var Sk;
            if (id2 === "t" || id2 === "b") {
                var kx = (loc.x - hs.x) / ((hs.y - os.y) || 1e-9);
                Sk = [1, 0, kx, 1, -kx * os.y, 0];
            } else {
                var ky = (loc.y - hs.y) / ((hs.x - os.x) || 1e-9);
                Sk = [1, ky, 0, 1, 0, -ky * os.x];
            }
            S.M = mul(drag.M0, Sk);
            syncQuad();
        } else if (op === "distort" || op === "perspective" || op === "edge") {
            S.M = null;
            var q = drag.quad0.map(function (p) { return { x: p.x, y: p.y }; });
            var id3 = drag.h.id;
            if (op === "edge") {
                var pair = { t: [0, 1], r: [1, 2], b: [2, 3], l: [3, 0] }[id3];
                q[pair[0]] = { x: q[pair[0]].x + dx, y: q[pair[0]].y + dy };
                q[pair[1]] = { x: q[pair[1]].x + dx, y: q[pair[1]].y + dy };
            } else {
                var i = QIDX[id3];
                q[i] = { x: drag.quad0[i].x + dx, y: drag.quad0[i].y + dy };
                if (op === "perspective") {
                    // the neighbouring corner along the drag direction mirrors it
                    var horizontal = Math.abs(dx) > Math.abs(dy);
                    var nb = horizontal ? { 0: 1, 1: 0, 2: 3, 3: 2 }[i] : { 0: 3, 3: 0, 1: 2, 2: 1 }[i];
                    if (horizontal) { q[i].y = drag.quad0[i].y; q[nb] = { x: drag.quad0[nb].x - dx, y: drag.quad0[nb].y }; }
                    else { q[i].x = drag.quad0[i].x; q[nb] = { x: drag.quad0[nb].x, y: drag.quad0[nb].y - dy }; }
                }
            }
            S.quad = q;
            // text cannot take a projective change
            if (!S.textWarned && S.items.some(function (x) { return x.layer.kind === "text"; })) {
                S.textWarned = true;
                PS.toast("Distort and Perspective turn type layers into pixels when committed");
            }
        }
        schedulePreview();
        PS.renderOptionsBar();
    }

    function pointerUp() {
        drag = null;
    }

    /* ---------- overlay ---------- */

    function drawOverlay(ctx) {
        if (!S) { return; }
        if (S.kind === "selection" && S.selBefore && S.selBefore.loops) {
            // Transform Selection: the marching ants follow the box
            var Hm = H();
            ctx.save();
            ctx.beginPath();
            S.selBefore.loops.forEach(function (loop) {
                for (var i = 0; i < loop.length; i += 2) {
                    var dp = h3Apply(Hm, { x: loop[i], y: loop[i + 1] });
                    var op = PS.docToOverlay(dp.x, dp.y);
                    if (i === 0) { ctx.moveTo(op.x, op.y); } else { ctx.lineTo(op.x, op.y); }
                }
                ctx.closePath();
            });
            ctx.lineWidth = 1;
            ctx.strokeStyle = "#000000";
            ctx.stroke();
            ctx.strokeStyle = "#ffffff";
            ctx.setLineDash([4, 4]);
            ctx.lineDashOffset = -Math.floor(performance.now() / 80) % 8;
            ctx.stroke();
            ctx.restore();
        }
        var sp = S.quad.map(function (p) { return PS.docToOverlay(p.x, p.y); });
        ctx.save();
        ctx.strokeStyle = "#202020";
        ctx.lineWidth = 1;
        ctx.beginPath();
        sp.forEach(function (p, i) { if (i === 0) { ctx.moveTo(p.x + 0.5, p.y + 0.5); } else { ctx.lineTo(p.x + 0.5, p.y + 0.5); } });
        ctx.closePath();
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        var hp = handlePoints();
        Object.keys(hp).forEach(function (k) {
            var p = PS.docToOverlay(hp[k].x, hp[k].y);
            ctx.fillStyle = "#202020";
            ctx.fillRect(Math.round(p.x) - 4, Math.round(p.y) - 4, 9, 9);
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(Math.round(p.x) - 3, Math.round(p.y) - 3, 7, 7);
        });
        // reference point
        var r = PS.docToOverlay(S.ref.x, S.ref.y);
        ctx.strokeStyle = "#202020";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 5, 0, Math.PI * 2);
        ctx.moveTo(r.x - 8, r.y); ctx.lineTo(r.x + 8, r.y);
        ctx.moveTo(r.x, r.y - 8); ctx.lineTo(r.x, r.y + 8);
        ctx.stroke();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
    }

    /* ---------- options bar ---------- */

    function decompose() {
        var M = S.M;
        if (!M) { return null; }
        var a = M[0], b = M[1], c = M[2], d = M[3];
        var sx = Math.hypot(a, b);
        var ang = Math.atan2(b, a);
        var m = (a * c + b * d) / (sx || 1e-9);
        var sy = (a * d - b * c) / (sx || 1e-9);
        return { sx: sx, sy: sy, angle: ang, skew: Math.atan2(m, sy) };
    }

    // rebuild the matrix from typed values, keeping the reference point fixed
    function compose(v) {
        var refSrc = aff(S.ref, inv(S.M));
        var U = [v.sx, 0, Math.tan(v.skew) * v.sy, v.sy, 0, 0];
        var L = mul(R(v.angle), U);
        S.M = mul(T(S.ref.x, S.ref.y), mul(L, T(-refSrc.x, -refSrc.y)));
        syncQuad();
        schedulePreview();
    }

    // the 3x3 reference point locator of the options bar
    function refLocator(host) {
        var g = PS.ui.group(host);
        var grid = document.createElement("div");
        grid.className = "ref-locator";
        grid.title = "Reference point location";
        var cur = refCell();
        for (var i = 0; i < 9; i++) {
            (function (i) {
                var b = document.createElement("button");
                b.type = "button";
                b.className = "ref-cell" + (i === cur ? " active" : "");
                b.addEventListener("click", function () {
                    var u = (i % 3) / 2, v = Math.floor(i / 3) / 2;
                    var p = { x: S.src.x + S.src.w * u, y: S.src.y + S.src.h * v };
                    S.ref = S.M ? aff(p, S.M) : h3Apply(H(), p);
                    PS.renderOptionsBar();
                    PS.requestRender();
                });
                grid.appendChild(b);
            })(i);
        }
        g.appendChild(grid);
    }

    // which locator cell the reference point sits on (-1: elsewhere)
    function refCell() {
        var Hi = h3Inv(H());
        var p = h3Apply(Hi, S.ref);
        var u = (p.x - S.src.x) / S.src.w, v = (p.y - S.src.y) / S.src.h;
        var cu = Math.round(u * 2), cv = Math.round(v * 2);
        if (cu < 0 || cu > 2 || cv < 0 || cv > 2) { return -1; }
        if (Math.abs(u * 2 - cu) > 0.02 || Math.abs(v * 2 - cv) > 0.02) { return -1; }
        return cv * 3 + cu;
    }

    function options(host) {
        var name = document.createElement("span");
        name.className = "tool-name";
        name.textContent = { selection: "Transform Selection", pixels: "Free Transform", layers: "Free Transform" }[S.kind];
        host.appendChild(name);
        refLocator(host);
        var v = decompose();
        function field(label, value, unit, onSet, step) {
            return PS.ui.numeric(host, label, Math.round(value * 100) / 100, -100000, 100000, step || 1, function (x) {
                onSet(x);
                PS.requestRender();
            }, unit);
        }
        field("X:", S.ref.x, "px", function (x) {
            var dx = x - S.ref.x;
            if (S.M) { S.M = mul(T(dx, 0), S.M); syncQuad(); } else { S.quad = S.quad.map(function (p) { return { x: p.x + dx, y: p.y }; }); }
            S.ref.x = x;
            schedulePreview();
        });
        field("Y:", S.ref.y, "px", function (y) {
            var dy = y - S.ref.y;
            if (S.M) { S.M = mul(T(0, dy), S.M); syncQuad(); } else { S.quad = S.quad.map(function (p) { return { x: p.x, y: p.y + dy }; }); }
            S.ref.y = y;
            schedulePreview();
        });
        if (v) {
            PS.ui.sep(host);
            var wIn, hIn;
            wIn = field("W:", v.sx * 100, "%", function (x) {
                v = decompose();
                if (S.keepRatio && v.sx) { v.sy = v.sy * (x / 100) / v.sx; if (hIn) { hIn.value = Math.round(v.sy * 10000) / 100; } }
                v.sx = x / 100;
                compose(v);
            }, 0.1);
            var link = document.createElement("button");
            link.type = "button";
            link.className = "opt-icon-btn" + (S.keepRatio ? " active" : "");
            link.title = "Maintain aspect ratio";
            link.innerHTML = '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/></svg>';
            link.addEventListener("click", function () {
                S.keepRatio = !S.keepRatio;
                link.classList.toggle("active", S.keepRatio);
            });
            host.appendChild(link);
            hIn = field("H:", v.sy * 100, "%", function (x) {
                v = decompose();
                if (S.keepRatio && v.sy) { v.sx = v.sx * (x / 100) / v.sy; if (wIn) { wIn.value = Math.round(v.sx * 10000) / 100; } }
                v.sy = x / 100;
                compose(v);
            }, 0.1);
            PS.ui.sep(host);
            field("\u2220", v.angle * 180 / Math.PI, "\u00b0", function (x) { v = decompose(); v.angle = x * Math.PI / 180; compose(v); }, 0.1)
                .title = "Rotate";
            field("H:", v.skew * 180 / Math.PI, "\u00b0", function (x) { v = decompose(); v.skew = PS.clamp(x, -89, 89) * Math.PI / 180; compose(v); }, 0.1)
                .title = "Set horizontal skew";
        }
        PS.ui.sep(host);
        if (S.kind !== "selection") {
            var interp = PS.ui.select(host, "Interpolation:", [
                { v: "nearest", l: "Nearest Neighbor" }, { v: "bilinear", l: "Bilinear" }, { v: "bicubic", l: "Bicubic" }
            ], S.interp, function (m) {
                S.interp = m;
                PS.prefs.transformInterp = m;
                PS.savePrefsDebounced();
                schedulePreview();
            });
            interp.title = "How pixels are resampled";
        }
        var modes = PS.ui.select(host, "Mode:", [
            { v: "free", l: "Free" }, { v: "scale", l: "Scale" }, { v: "rotate", l: "Rotate" },
            { v: "skew", l: "Skew" }, { v: "distort", l: "Distort" }, { v: "perspective", l: "Perspective" }
        ], S.mode, function (m) { S.mode = m; });
        modes.title = "What the handles do (Ctrl: distort / skew, Ctrl+Alt+Shift: perspective)";
        var cancelBtn = PS.ui.button(host, "Cancel", function () { cancel(); });
        cancelBtn.title = "Cancel transform (Esc)";
        cancelBtn.classList.add("opt-pin");
        var okBtn = PS.ui.button(host, "Commit", function () { commit(); });
        okBtn.title = "Commit transform (Enter)";
        okBtn.classList.add("primary-opt", "opt-pin");
    }

    /* ---------- one-shot transforms (Edit > Transform) ---------- */

    function quick(op) {
        var started = !!S;
        if (!S && !begin({ kind: "auto" })) { return; }
        var c = S.ref;
        var Hd;
        if (op === "flipH") { Hd = mul(T(c.x, c.y), mul(Sc(-1, 1), T(-c.x, -c.y))); }
        else if (op === "flipV") { Hd = mul(T(c.x, c.y), mul(Sc(1, -1), T(-c.x, -c.y))); }
        else { Hd = mul(T(c.x, c.y), mul(R(op * Math.PI / 180), T(-c.x, -c.y))); }
        applyDeltaH(h3FromAff(Hd));
        schedulePreview();
        if (!started) { commit(); } else { PS.renderOptionsBar(); }
    }

    // Transform Again (Ctrl+Shift+T); dup (Ctrl+Shift+Alt+T) transforms a copy
    function again(dup) {
        if (!lastDelta) { PS.toast("Nothing to repeat yet", true); return; }
        var Hd = lastDelta;
        if (dup) {
            if (PS.doc.selection && PS.activeLayer() && PS.isPaintable(PS.paintTarget())) {
                // the selected pixels go to a new layer first
                if (PS.layerViaCopy) { PS.layerViaCopy(); }
            } else {
                PS.duplicateLayer();
            }
        }
        if (!begin({ kind: "auto" })) { return; }
        applyDeltaH(Hd);
        commit();
    }

    // arrow keys while transforming move the box
    function nudge(dx, dy) {
        if (!S || (!dx && !dy)) { return; }
        if (S.M) { S.M = mul(T(dx, dy), S.M); syncQuad(); }
        else { S.quad = S.quad.map(function (p) { return { x: p.x + dx, y: p.y + dy }; }); }
        S.ref = { x: S.ref.x + dx, y: S.ref.y + dy };
        schedulePreview();
        PS.renderOptionsBar();
    }

    return {
        get session() { return S; },
        get active() { return !!S; },
        begin: begin,
        commit: commit,
        cancel: cancel,
        hit: hit,
        cursor: function (pt) { return S ? cursorFor(hit(pt), pt) : null; },
        layersBox: layersBox,
        pointerDown: pointerDown,
        pointerMove: pointerMove,
        pointerUp: pointerUp,
        drawOverlay: drawOverlay,
        options: options,
        quick: quick,
        again: again,
        nudge: nudge,
        setMode: function (m) { if (S) { S.mode = m; PS.renderOptionsBar(); } },
        ROTATE_CURSOR: ROTATE_CURSOR
    };
})();
