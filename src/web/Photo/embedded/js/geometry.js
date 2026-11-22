/*
    Photo editor geometry

    The picture goes through these spaces, each in pixels of the source:

      source  the file as decoded (W x H)
      O       oriented: flipped, then turned in 90 degree steps (ow x oh)
      K       keystoned: a perspective warp about the centre of O, that
              corrects converging verticals / horizontals
      S       straightened: K turned by the straighten angle about the centre

    The crop is an axis aligned rectangle in S. It must stay inside the
    picture, that is its corners mapped back to K must lie in the quad that
    the warped picture covers.

    Pure math, no DOM: shared by the editor and tests/geometry.test.js.
*/
(function (root) {
    "use strict";

    var MAX_KEYSTONE = 0.4;   //warp factor of a full dial turn
    var DIAL_KEYSTONE = 45;   //dial units of a full turn

    function newGeometry(W, H) {
        return {
            W: W, H: H,
            rot: 0,        //quarter turns counter clockwise, applied after flip
            flip: false,   //mirror of the source, applied first
            angle: 0,      //straighten, degrees, positive turns clockwise
            vertical: 0,   //keystone dials, -45..45
            horizontal: 0,
            crop: { cx: W / 2, cy: H / 2, w: W, h: H }
        };
    }

    function clone(g) {
        return JSON.parse(JSON.stringify(g));
    }

    function orientedSize(g) {
        return (g.rot % 2 === 0) ? { w: g.W, h: g.H } : { w: g.H, h: g.W };
    }

    //Keystone factors: n' = n / (1 + a*ny + b*nx) in normalised coordinates
    function keystone(g) {
        return {
            a: g.vertical / DIAL_KEYSTONE * MAX_KEYSTONE,
            b: g.horizontal / DIAL_KEYSTONE * MAX_KEYSTONE
        };
    }

    function isIdentity(g) {
        var o = orientedSize(g);
        var c = g.crop;
        return g.rot === 0 && !g.flip && g.angle === 0 && g.vertical === 0 && g.horizontal === 0 &&
            Math.abs(c.cx - o.w / 2) < 0.5 && Math.abs(c.cy - o.h / 2) < 0.5 &&
            Math.abs(c.w - o.w) < 0.5 && Math.abs(c.h - o.h) < 0.5;
    }

    /* ---------- point mappings ---------- */

    //O pixel -> source pixel
    function oToSource(g, x, y) {
        var dims = [];
        var w = g.W, h = g.H;
        for (var i = 0; i <= g.rot; i++) {
            dims.push({ w: w, h: h });
            var t = w; w = h; h = t;
        }
        for (var k = g.rot; k > 0; k--) {
            //forward quarter turn: (x, y) -> (y, prevW - x)
            var prevW = dims[k - 1].w;
            var nx = prevW - y, ny = x;
            x = nx; y = ny;
        }
        if (g.flip) {
            x = g.W - x;
        }
        return { x: x, y: y };
    }

    //K pixel -> O pixel (inverse keystone)
    function kToO(g, x, y) {
        var o = orientedSize(g);
        var ks = keystone(g);
        var hx = o.w / 2, hy = o.h / 2;
        var kx = (x - hx) / hx, ky = (y - hy) / hy;
        var d = 1 - ks.a * ky - ks.b * kx;
        return { x: hx + kx / d * hx, y: hy + ky / d * hy };
    }

    //O pixel -> K pixel (forward keystone)
    function oToK(g, x, y) {
        var o = orientedSize(g);
        var ks = keystone(g);
        var hx = o.w / 2, hy = o.h / 2;
        var nx = (x - hx) / hx, ny = (y - hy) / hy;
        var d = 1 + ks.a * ny + ks.b * nx;
        return { x: hx + nx / d * hx, y: hy + ny / d * hy };
    }

    //S pixel -> K pixel (undo straighten)
    function sToK(g, x, y) {
        var o = orientedSize(g);
        var cx = o.w / 2, cy = o.h / 2;
        var r = -g.angle * Math.PI / 180;
        var dx = x - cx, dy = y - cy;
        return {
            x: cx + dx * Math.cos(r) - dy * Math.sin(r),
            y: cy + dx * Math.sin(r) + dy * Math.cos(r)
        };
    }

    //K pixel -> S pixel
    function kToS(g, x, y) {
        var o = orientedSize(g);
        var cx = o.w / 2, cy = o.h / 2;
        var r = g.angle * Math.PI / 180;
        var dx = x - cx, dy = y - cy;
        return {
            x: cx + dx * Math.cos(r) - dy * Math.sin(r),
            y: cy + dx * Math.sin(r) + dy * Math.cos(r)
        };
    }

    //The quad the picture covers in K, clockwise from top left
    function pictureQuad(g) {
        var o = orientedSize(g);
        return [oToK(g, 0, 0), oToK(g, o.w, 0), oToK(g, o.w, o.h), oToK(g, 0, o.h)];
    }

    //The picture outline in S, for drawing
    function pictureOutline(g) {
        return pictureQuad(g).map(function (p) { return kToS(g, p.x, p.y); });
    }

    /* ---------- fitting the crop ---------- */

    function cropCorners(c) {
        var hw = c.w / 2, hh = c.h / 2;
        return [
            { x: c.cx - hw, y: c.cy - hh }, { x: c.cx + hw, y: c.cy - hh },
            { x: c.cx + hw, y: c.cy + hh }, { x: c.cx - hw, y: c.cy + hh }
        ];
    }

    function insideQuad(q, p, eps) {
        for (var i = 0; i < 4; i++) {
            var a = q[i], b = q[(i + 1) % 4];
            var cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
            if (cross < -eps) {
                return false;
            }
        }
        return true;
    }

    function feasible(g, c) {
        if (!(c.w > 0 && c.h > 0)) {
            return false;
        }
        var q = pictureQuad(g);
        var o = orientedSize(g);
        var eps = Math.max(o.w, o.h) * 1e-4 * Math.max(o.w, o.h);
        var corners = cropCorners(c);
        for (var i = 0; i < 4; i++) {
            var k = sToK(g, corners[i].x, corners[i].y);
            if (!insideQuad(q, k, eps)) {
                return false;
            }
        }
        return true;
    }

    function scaled(c, s) {
        return { cx: c.cx, cy: c.cy, w: c.w * s, h: c.h * s };
    }

    function lerpCrop(a, b, t) {
        return {
            cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t,
            w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t
        };
    }

    //Largest t in [0, 1] for which test(t) holds, given test(0) holds
    function searchLargest(test) {
        if (test(1)) {
            return 1;
        }
        var lo = 0, hi = 1;
        for (var i = 0; i < 30; i++) {
            var mid = (lo + hi) / 2;
            if (test(mid)) { lo = mid; } else { hi = mid; }
        }
        return lo;
    }

    //Shrink a crop about its centre until it fits. When its centre is off
    //the picture it moves to the middle first.
    function shrinkToFit(g, c) {
        if (feasible(g, c)) {
            return c;
        }
        var o = orientedSize(g);
        var best = null;
        [c, { cx: o.w / 2, cy: o.h / 2, w: c.w, h: c.h }].forEach(function (cand) {
            if (!feasible(g, scaled(cand, 1e-4))) {
                return;
            }
            var s = searchLargest(function (t) { return feasible(g, scaled(cand, Math.max(t, 1e-4))); });
            var r = scaled(cand, Math.max(s, 1e-4));
            if (best === null || r.w > best.w * 1.02) {
                best = r;
            }
        });
        return best || scaled({ cx: o.w / 2, cy: o.h / 2, w: c.w, h: c.h }, 0.01);
    }

    //Move from a fitting crop towards a wanted one as far as it still fits
    function towards(g, from, to) {
        if (feasible(g, to)) {
            return to;
        }
        var t = searchLargest(function (t) { return feasible(g, lerpCrop(from, to, t)); });
        return lerpCrop(from, to, t);
    }

    //Pan: move the crop centre but keep its size. Each axis is tried on its
    //own as well, so the crop slides along an edge instead of sticking.
    function pan(g, from, dx, dy) {
        var to = { cx: from.cx + dx, cy: from.cy + dy, w: from.w, h: from.h };
        if (feasible(g, to)) {
            return to;
        }
        var a = towards(g, from, { cx: from.cx + dx, cy: from.cy, w: from.w, h: from.h });
        return towards(g, a, { cx: a.cx, cy: a.cy + dy, w: a.w, h: a.h });
    }

    //Largest crop of the given ratio (w / h) around the centre of c
    function cropForRatio(g, c, ratio) {
        var o = orientedSize(g);
        var w = o.w, h = o.w / ratio;
        if (h > o.h) {
            h = o.h; w = o.h * ratio;
        }
        var a = shrinkToFit(g, { cx: c.cx, cy: c.cy, w: w, h: h });
        var b = shrinkToFit(g, { cx: o.w / 2, cy: o.h / 2, w: w, h: h });
        return (b.w > a.w * 1.05) ? b : a;
    }

    /* ---------- whole picture operations ---------- */

    //Quarter turn counter clockwise of everything
    function rotateLeft(g) {
        var o = orientedSize(g);
        var dx = g.crop.cx - o.w / 2, dy = g.crop.cy - o.h / 2;
        g.rot = (g.rot + 1) % 4;
        var n = orientedSize(g);
        g.crop = { cx: n.w / 2 + dy, cy: n.h / 2 - dx, w: g.crop.h, h: g.crop.w };
        var v = g.vertical;
        g.vertical = -g.horizontal;
        g.horizontal = v;
        return g;
    }

    //Mirror left to right of everything
    function flipHorizontal(g) {
        var o = orientedSize(g);
        g.flip = !g.flip;
        g.rot = (4 - g.rot) % 4;
        g.crop.cx = o.w - g.crop.cx;
        g.angle = -g.angle;
        g.horizontal = -g.horizontal;
        return g;
    }

    /* ---------- matrices for the renderer ---------- */

    //3x3 affine as [a, b, c, d, e, f]: x' = a x + b y + c, y' = d x + e y + f
    function affineFrom3(fn) {
        var p0 = fn(0, 0), px = fn(1, 0), py = fn(0, 1);
        return [px.x - p0.x, py.x - p0.x, p0.x, px.y - p0.y, py.y - p0.y, p0.y];
    }

    function mulAffine(m, n) {
        //m after n
        return [
            m[0] * n[0] + m[1] * n[3], m[0] * n[1] + m[1] * n[4], m[0] * n[2] + m[1] * n[5] + m[2],
            m[3] * n[0] + m[4] * n[3], m[3] * n[1] + m[4] * n[4], m[3] * n[2] + m[4] * n[5] + m[5]
        ];
    }

    /*
        Uniforms for a view, which places S on a canvas:
        canvas pixel = S * view.scale + (view.tx, view.ty)

        nFromCanvas  canvas pixel -> normalised K (centre 0, edges +-1)
        uvFromN      normalised O -> source UV (0..1)
    */
    function shaderMatrices(g, view) {
        var o = orientedSize(g);
        var hx = o.w / 2, hy = o.h / 2;
        var sFromCanvas = [1 / view.scale, 0, -view.tx / view.scale, 0, 1 / view.scale, -view.ty / view.scale];
        var kFromS = affineFrom3(function (x, y) { return sToK(g, x, y); });
        var nFromK = [1 / hx, 0, -1, 0, 1 / hy, -1];
        var nFromCanvas = mulAffine(nFromK, mulAffine(kFromS, sFromCanvas));
        var uvFromN = affineFrom3(function (x, y) {
            var s = oToSource(g, hx + x * hx, hy + y * hy);
            return { x: s.x / g.W, y: s.y / g.H };
        });
        var ks = keystone(g);
        return { nFromCanvas: nFromCanvas, uvFromN: uvFromN, a: ks.a, b: ks.b };
    }

    //A view that shows the crop centred in a box, with padding
    function fitView(c, boxW, boxH, pad) {
        var scale = Math.min((boxW - 2 * pad) / c.w, (boxH - 2 * pad) / c.h);
        scale = Math.max(scale, 1e-6);
        return { scale: scale, tx: boxW / 2 - c.cx * scale, ty: boxH / 2 - c.cy * scale };
    }

    var api = {
        newGeometry: newGeometry,
        clone: clone,
        orientedSize: orientedSize,
        isIdentity: isIdentity,
        oToSource: oToSource,
        oToK: oToK,
        kToO: kToO,
        sToK: sToK,
        kToS: kToS,
        pictureOutline: pictureOutline,
        feasible: feasible,
        shrinkToFit: shrinkToFit,
        towards: towards,
        pan: pan,
        cropForRatio: cropForRatio,
        rotateLeft: rotateLeft,
        flipHorizontal: flipHorizontal,
        shaderMatrices: shaderMatrices,
        fitView: fitView,
        DIAL_KEYSTONE: DIAL_KEYSTONE
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    } else {
        root.PhotoGeo = api;
    }
})(this);
