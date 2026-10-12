/*
    ArozOS Office - Slides shape catalogue
    ======================================
    Every shape the editor can draw, as geometry rather than as a picture.

    The names are the ones PresentationML uses for its preset geometries
    (`<a:prstGeom prst="rightBrace"/>`), so an imported deck keeps its own
    vocabulary and the converters on the Go side are a lookup rather than a
    translation. A handful of older editor names (`round`, `arrow`, `star`,
    ...) are kept as aliases, because documents already written carry them.

    Each shape produces an SVG path, and deliberately only ever uses M, L, C
    and Z:

      - `clip-path: path(...)` takes it, which is how a picture is cropped
        to a shape,
      - the PDF exporter turns it into path operators with a translator of
        about thirty lines (slides_pdf.js), and
      - there is nothing to get wrong in an arc flag.

    Circles and arcs therefore arrive as cubic curves; `arc()` below does
    that conversion once so no shape has to think about it.

    Some shapes have a second path - the divider bars of a predefined
    process, the cross of a summing junction. Those are *drawn*, not filled:
    they are the shape's markings, not its outline, so they come back
    separately from `detail()` and the renderer strokes them.

    Usage:
        SlidesShapes.path(kind, w, h, adj)   // "M0 0L100 0..." ("" if unknown)
        SlidesShapes.detail(kind, w, h, adj) // markings to stroke, or ""
        SlidesShapes.points(kind, w, h, adj) // polygon corners, or null
        SlidesShapes.handles(kind, w, h, adj)          // [[x, y], ...] adjustment handles
        SlidesShapes.dragHandle(kind, i, w, h, x, y, adj) // adj with handle i at (x, y)
        SlidesShapes.evenOdd(kind)      // does the path need even-odd fill
        SlidesShapes.canonical(kind)    // legacy name -> catalogue name
        SlidesShapes.has(kind)
        SlidesShapes.label(kind)
        SlidesShapes.CATEGORIES         // [{ id, label, kinds: [...] }]
*/

var SlidesShapes = (function () {
    "use strict";

    function r2(v) { return Math.round(v * 1000) / 1000; }

    /* ---------------- the path builder ---------------- */

    // the path remembers where its pen is (px, py), which is what arcTo
    // continues from
    function Path() { this.s = ""; this.px = 0; this.py = 0; }
    Path.prototype.M = function (x, y) {
        this.s += "M" + r2(x) + " " + r2(y); this.px = x; this.py = y; return this;
    };
    Path.prototype.L = function (x, y) {
        this.s += "L" + r2(x) + " " + r2(y); this.px = x; this.py = y; return this;
    };
    Path.prototype.C = function (x1, y1, x2, y2, x, y) {
        this.s += "C" + r2(x1) + " " + r2(y1) + " " + r2(x2) + " " + r2(y2) +
            " " + r2(x) + " " + r2(y);
        this.px = x; this.py = y;
        return this;
    };
    Path.prototype.Z = function () { this.s += "Z"; return this; };
    Path.prototype.poly = function (pts) {
        for (var i = 0; i < pts.length; i++) {
            if (i === 0) this.M(pts[i][0], pts[i][1]);
            else this.L(pts[i][0], pts[i][1]);
        }
        return this.Z();
    };
    /* arc appends an elliptical arc from a0 to a1 (radians, y down). It
       moves to the start when the path is empty or `move` is asked for,
       and otherwise draws a line to it first, which is what every shape
       below wants. Cut into quarter turns, each a cubic - the standard
       approximation, exact to about one part in ten thousand. */
    Path.prototype.arc = function (cx, cy, rx, ry, a0, a1, move) {
        var span = a1 - a0;
        var steps = Math.max(1, Math.ceil(Math.abs(span) / (Math.PI / 2)));
        var step = span / steps;
        var k = 4 / 3 * Math.tan(step / 4);
        var a = a0;
        var x0 = cx + rx * Math.cos(a), y0 = cy + ry * Math.sin(a);
        if (move || this.s === "") this.M(x0, y0);
        else this.L(x0, y0);
        for (var i = 0; i < steps; i++) {
            var b = a + step;
            var cosA = Math.cos(a), sinA = Math.sin(a);
            var cosB = Math.cos(b), sinB = Math.sin(b);
            var p0x = cx + rx * cosA, p0y = cy + ry * sinA;
            var p3x = cx + rx * cosB, p3y = cy + ry * sinB;
            this.C(p0x - k * rx * sinA, p0y + k * ry * cosA,
                p3x + k * rx * sinB, p3y - k * ry * cosB, p3x, p3y);
            a = b;
        }
        return this;
    };
    /* arcTo is PresentationML's own arc: from the pen, which lies on an
       ellipse of radii wR x hR at the angle stAng, round by swAng
       (radians, clockwise on screen, negative goes back). The angles are
       *visual* ones - the direction of the point as seen from the centre,
       not the ellipse's parameter - which is what presetShapeDefinitions
       means by them; on a circle the two are the same. */
    function ellParam(a, rx, ry) { return Math.atan2(rx * Math.sin(a), ry * Math.cos(a)); }
    Path.prototype.arcTo = function (wR, hR, stAng, swAng) {
        if (!swAng || !isFinite(wR) || !isFinite(hR)) return this;
        // a radius of nothing still has to end where PowerPoint ends it:
        // a flattened ellipse is a straight line along the other axis
        wR = Math.max(wR, 1e-6); hR = Math.max(hR, 1e-6);
        var t0 = ellParam(stAng, wR, hR);
        var cx = this.px - wR * Math.cos(t0), cy = this.py - hR * Math.sin(t0);
        var dt;
        if (Math.abs(swAng) >= 2 * Math.PI - 1e-9) dt = swAng > 0 ? 2 * Math.PI : -2 * Math.PI;
        else {
            // the parameter turns the same way as the angle and less than a
            // full turn, because one maps onto the other one to one
            dt = ellParam(stAng + swAng, wR, hR) - t0;
            while (swAng > 0 && dt <= 0) dt += 2 * Math.PI;
            while (swAng < 0 && dt >= 0) dt -= 2 * Math.PI;
            while (dt > 2 * Math.PI) dt -= 2 * Math.PI;
            while (dt < -2 * Math.PI) dt += 2 * Math.PI;
        }
        // arc() opens with a line to where the pen already is - harmless
        return this.arc(cx, cy, wR, hR, t0, t0 + dt);
    };
    // a quadratic curve, as the cubic it is
    Path.prototype.Q = function (qx, qy, x, y) {
        var x0 = this.px, y0 = this.py;
        return this.C(x0 + 2 / 3 * (qx - x0), y0 + 2 / 3 * (qy - y0),
            x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), x, y);
    };
    Path.prototype.circle = function (cx, cy, rx, ry) {
        return this.arc(cx, cy, rx, ry, 0, 2 * Math.PI, true).Z();
    };
    Path.prototype.toString = function () { return this.s; };

    function P() { return new Path(); }

    // regular polygon inscribed in the box, first corner at the top
    function ngon(w, h, n, rotate) {
        var pts = [];
        var cx = w / 2, cy = h / 2;
        var off = (rotate || 0) - Math.PI / 2;
        for (var i = 0; i < n; i++) {
            var a = off + i * 2 * Math.PI / n;
            pts.push([cx + cx * Math.cos(a), cy + cy * Math.sin(a)]);
        }
        return pts;
    }

    // a star with n points; inner is the inner radius as a fraction
    function starPts(w, h, n, inner) {
        var pts = [];
        var cx = w / 2, cy = h / 2;
        for (var i = 0; i < n * 2; i++) {
            var a = -Math.PI / 2 + i * Math.PI / n;
            var f = (i % 2 === 0) ? 1 : inner;
            pts.push([cx + cx * f * Math.cos(a), cy + cy * f * Math.sin(a)]);
        }
        return pts;
    }

    // rounded rectangle, with a radius per corner (tl, tr, br, bl)
    function roundRectPath(w, h, tl, tr, br, bl) {
        var p = P();
        p.M(tl, 0).L(w - tr, 0);
        if (tr) p.arc(w - tr, tr, tr, tr, -Math.PI / 2, 0);
        p.L(w, h - br);
        if (br) p.arc(w - br, h - br, br, br, 0, Math.PI / 2);
        p.L(bl, h);
        if (bl) p.arc(bl, h - bl, bl, bl, Math.PI / 2, Math.PI);
        p.L(0, tl);
        if (tl) p.arc(tl, tl, tl, tl, Math.PI, Math.PI * 1.5);
        return p.Z().toString();
    }

    // the straight-sided arrow every four directions share, drawn right
    // and then mapped onto the direction asked for
    function arrowPts(w, h, headLen, shaft) {
        var hx = w * (1 - headLen);
        var t = h * (1 - shaft) / 2;
        return [[0, t], [hx, t], [hx, 0], [w, h / 2], [hx, h], [hx, h - t], [0, h - t]];
    }
    function mapPts(pts, fn) { return pts.map(fn); }

    /* av reads one of a preset's adjustments (PresentationML's own name and
       scale, 1/100000), its default when the shape states none. Presets
       that follow PowerPoint's formulas size their features from ss, the
       shorter side, as presetShapeDefinitions.xml does - so a long, flat
       chevron keeps a shallow point instead of one a quarter of its width. */
    function av(adj, name, def) {
        var v = adj ? Number(adj[name]) : NaN;
        return isFinite(v) ? v : def;
    }
    function pin(lo, v, hi) { return Math.max(lo, Math.min(hi, v)); }
    // a block arrow pointing along +u, in a box len long and thick across
    function arrowGeo(len, thick, ss, adj) {
        var a1 = pin(0, av(adj, "adj1", 50000), 100000);
        var a2 = pin(0, av(adj, "adj2", 50000), 100000 * len / ss);
        var dy = thick * a1 / 200000, v1 = thick / 2 - dy, v2 = thick / 2 + dy;
        var u1 = len - ss * a2 / 100000;
        return [[0, v1], [u1, v1], [u1, 0], [len, thick / 2], [u1, thick], [u1, v2], [0, v2]];
    }
    /* ---------------- adjustment handles ----------------
       An entry with `adj` can be reshaped on the canvas: `adj.defaults`
       are PresentationML's defaults for its guides (the values its drawing
       uses when the shape states none), and each of `adj.handles` is one
       yellow diamond - pos(w, h, a) puts it in the frame for the resolved
       adjustments a, set(w, h, x, y) turns the point it was dragged to back
       into the guide it controls. The guides keep PowerPoint's names and
       scale, so a reshaped shape is written to .pptx as exactly that.

       Most presets measure a feature in ss, the shorter side: ssLen is the
       handle for one such length. `at` places the handle for a length d,
       `from` reads d back off a dragged point, and `max` caps the guide
       (a number, or a function of w, h and ss). */
    function capOf(max, w, h, ss, a) { return typeof max === "function" ? max(w, h, ss, a || {}) : max; }
    function ssLen(name, max, at, from) {
        return {
            pos: function (w, h, a) {
                var ss = Math.min(w, h);
                return at(w, h, ss * pin(0, a[name], capOf(max, w, h, ss, a)) / 100000);
            },
            set: function (w, h, x, y, a) {
                var ss = Math.min(w, h), out = {};
                out[name] = Math.round(pin(0, from(w, h, x, y) / Math.max(1e-6, ss) * 100000,
                    capOf(max, w, h, ss, a)));
                return out;
            }
        };
    }
    /* fit is the handle for a guide whose effect on the handle has no
       simple inverse (a curved arrow, a brace, an arrow callout): pos(w, h,
       a) places it, and a drag sets `name` to the value in [lo, hi] whose
       point lies nearest the pointer, every other guide held. lo and hi
       are numbers or functions of (w, h, ss, a), like a cap. The handle's
       path is assumed to be one stroke without loops, which every preset's
       is: a coarse scan finds the stretch, a golden-section search the
       value. */
    function fit(name, lo, hi, pos) {
        return {
            pos: pos,
            set: function (w, h, x, y, a) {
                var ss = Math.min(w, h), out = {};
                var l = capOf(lo, w, h, ss, a), u = capOf(hi, w, h, ss, a);
                if (!(u > l)) { out[name] = Math.round(l); return out; }
                var trial = {};
                Object.keys(a).forEach(function (k) { trial[k] = a[k]; });
                function dist(v) {
                    trial[name] = v;
                    var pt = pos(w, h, trial);
                    return (pt[0] - x) * (pt[0] - x) + (pt[1] - y) * (pt[1] - y);
                }
                var N = 64, best = 0, bd = Infinity;
                for (var i = 0; i <= N; i++) {
                    var d = dist(l + (u - l) * i / N);
                    if (d < bd) { bd = d; best = i; }
                }
                var lo2 = l + (u - l) * Math.max(0, best - 1) / N;
                var hi2 = l + (u - l) * Math.min(N, best + 1) / N;
                var g = (Math.sqrt(5) - 1) / 2;
                for (var k = 0; k < 40; k++) {
                    var m1 = hi2 - g * (hi2 - lo2), m2 = lo2 + g * (hi2 - lo2);
                    if (dist(m1) <= dist(m2)) hi2 = m2; else lo2 = m1;
                }
                out[name] = Math.round(pin(l, (lo2 + hi2) / 2, u));
                return out;
            }
        };
    }

    /* Angles. PresentationML states them in 60000ths of a degree, clockwise
       from three o'clock; they are visual angles (see arcTo). */
    var DEG = 60000;
    function angleOf(v) { return v / DEG * Math.PI / 180; }
    function angleGuide(x, y, cx, cy) {
        var d = Math.atan2(y - cy, x - cx) * 180 / Math.PI;
        if (d < 0) d += 360;
        return Math.round(d * DEG) % (360 * DEG);
    }
    // the sweep from one angle to the next, clockwise; equal angles are a
    // full turn, as PowerPoint draws them
    function sweepOf(st, en) {
        var sw = en - st;
        while (sw <= 0) sw += 2 * Math.PI;
        while (sw > 2 * Math.PI) sw -= 2 * Math.PI;
        return sw;
    }
    // the point of an ellipse in the direction a, seen from its centre
    function onEllipse(cx, cy, rx, ry, a) {
        var c = Math.cos(a), s = Math.sin(a);
        if (!(rx > 0) || !(ry > 0)) return [cx, cy];
        var r = 1 / Math.sqrt(c * c / (rx * rx) + s * s / (ry * ry));
        return [cx + r * c, cy + r * s];
    }
    // the inset t (0..tMax) whose ellipse (rx - t) x (ry - t) passes at
    // distance d from the centre in the direction a: a ring's thickness
    // read off a dragged point
    function insetAt(rx, ry, a, d, tMax) {
        var lo = 0, hi = tMax;
        for (var i = 0; i < 40; i++) {
            var t = (lo + hi) / 2;
            var pt = onEllipse(0, 0, Math.max(0, rx - t), Math.max(0, ry - t), a);
            if (Math.sqrt(pt[0] * pt[0] + pt[1] * pt[1]) > d) lo = t; else hi = t;
        }
        return (lo + hi) / 2;
    }
    // a handle on the frame's ellipse that sets one angle guide
    function polar(name, rx, ry) {
        return {
            pos: function (w, h, a) {
                return onEllipse(w / 2, h / 2, rx ? rx(w, h, a) : w / 2, ry ? ry(w, h, a) : h / 2,
                    angleOf(pin(0, a[name], 21599999)));
            },
            set: function (w, h, x, y) {
                var out = {};
                out[name] = angleGuide(x, y, w / 2, h / 2);
                return out;
            }
        };
    }

    /* mapPath moves every point of a finished path through fn - a mirror
       or a transposition, which is how one geometry serves the four ways
       a curved arrow or an arrow callout can face. Only M / L / C carry
       points, so mapping each pair is exact. */
    function mapPath(d, fn) {
        return d.replace(/([MLC])([^MLCZ]*)/g, function (all, cmd, nums) {
            var v = nums.trim().split(/[\s,]+/).map(Number), out = [];
            for (var k = 0; k + 1 < v.length; k += 2) {
                var q = fn(v[k], v[k + 1]);
                out.push(r2(q[0]), r2(q[1]));
            }
            return cmd + out.join(" ");
        });
    }
    // the common caps: so much of the frame's width / height, in ss terms
    function wCap(k) { return function (w, h, ss) { return k * w / Math.max(1e-6, ss); }; }
    function hCap(k) { return function (w, h, ss) { return k * h / Math.max(1e-6, ss); }; }
    // a guide that is a share of one side rather than of ss
    function share(name, side, max, at, from) {
        return {
            pos: function (w, h, a) {
                var len = side === "w" ? w : h;
                return at(w, h, len * pin(0, a[name], max) / 100000);
            },
            set: function (w, h, x, y) {
                var len = side === "w" ? w : h, out = {};
                out[name] = Math.round(pin(0, from(w, h, x, y) / Math.max(1e-6, len) * 100000, max));
                return out;
            }
        };
    }
    /* The four block arrows share one geometry drawn pointing right (u
       along the arrow, v across it) and differ only in how (u, v) lands in
       the frame. Their handles do too: the shaft's thickness at the tail,
       the head's length where it meets the shaft. */
    var ARROW_DIRS = {
        right: { to: function (w, h, u, v) { return [u, v]; }, back: function (w, h, x, y) { return [x, y]; }, len: "w" },
        left: { to: function (w, h, u, v) { return [w - u, v]; }, back: function (w, h, x, y) { return [w - x, y]; }, len: "w" },
        up: { to: function (w, h, u, v) { return [v, h - u]; }, back: function (w, h, x, y) { return [h - y, x]; }, len: "h" },
        down: { to: function (w, h, u, v) { return [v, u]; }, back: function (w, h, x, y) { return [y, x]; }, len: "h" }
    };
    function arrowAdj(dir) {
        var D = ARROW_DIRS[dir];
        function dims(w, h) { return D.len === "w" ? [w, h] : [h, w]; }
        return {
            defaults: { adj1: 50000, adj2: 50000 },
            handles: [{
                // the shaft's thickness, at the tail
                pos: function (w, h, a) {
                    var lt = dims(w, h);
                    return D.to(w, h, 0, lt[1] / 2 - lt[1] * pin(0, a.adj1, 100000) / 200000);
                },
                set: function (w, h, x, y) {
                    var lt = dims(w, h), uv = D.back(w, h, x, y);
                    return { adj1: Math.round(pin(0, (lt[1] / 2 - uv[1]) * 200000 / Math.max(1e-6, lt[1]), 100000)) };
                }
            }, {
                // the head's length, where it meets the shaft's edge
                pos: function (w, h, a) {
                    var lt = dims(w, h), ss = Math.min(w, h);
                    var hl = ss * pin(0, a.adj2, 100000 * lt[0] / ss) / 100000;
                    return D.to(w, h, lt[0] - hl, 0);
                },
                set: function (w, h, x, y) {
                    var lt = dims(w, h), ss = Math.min(w, h), uv = D.back(w, h, x, y);
                    return { adj2: Math.round(pin(0, (lt[0] - uv[0]) / Math.max(1e-6, ss) * 100000, 100000 * lt[0] / ss)) };
                }
            }]
        };
    }
    // a star's inner radius as a share of the outer, PresentationML's
    // adj (inner = adj / 50000); the handle sits on the vertical axis
    function starAdj(inner) {
        return {
            defaults: { adj: Math.round(inner * 50000) },
            handles: [{
                pos: function (w, h, a) { return [w / 2, h / 2 - h / 2 * pin(0, a.adj, 50000) / 50000]; },
                set: function (w, h, x, y) {
                    return { adj: Math.round(pin(0, (h / 2 - y) / Math.max(1e-6, h / 2) * 50000, 50000)) };
                }
            }]
        };
    }
    function starDef(n, label, inner) {
        return {
            cat: "callout", label: label, adj: starAdj(inner),
            pts: function (w, h, adj) {
                return starPts(w, h, n, pin(0, av(adj, "adj", inner * 50000), 50000) / 50000);
            }
        };
    }

    function rotPts(pts, w, h, quarter) {
        // quarter turns clockwise about the centre of a w x h box, with the
        // box itself turning too - so an arrow drawn right becomes one
        // drawn down in the same box
        return mapPts(pts, function (p) {
            var x = p[0] / w, y = p[1] / h;
            if (quarter === 1) return [(1 - y) * w, x * h];
            if (quarter === 2) return [(1 - x) * w, (1 - y) * h];
            if (quarter === 3) return [y * w, (1 - x) * h];
            return [x * w, y * h];
        });
    }

    /* ---------------- geometry shared by several presets ---------------- */

    // the frame's ellipse from adj1 round to adj2, clockwise: an arc, and
    // the start of a chord and a pie
    function arcOutline(w, h, adj, d1, d2) {
        var st = angleOf(pin(0, av(adj, "adj1", d1), 21599999));
        var sw = sweepOf(st, angleOf(pin(0, av(adj, "adj2", d2), 21599999)));
        var o = onEllipse(w / 2, h / 2, w / 2, h / 2, st);
        return P().M(o[0], o[1]).arcTo(w / 2, h / 2, st, sw);
    }

    /* The circular arrow: a band round the frame's ellipse from adj4 to
       its point at adj3 (clockwise). adj1 is the band's thickness, adj5 how
       far the head reaches either side of the band's centre line (so the
       head touches the frame), adj2 the angle the head takes up. */
    function circGeo(w, h, adj) {
        var ss = Math.min(w, h);
        var a5 = pin(0, av(adj, "adj5", 12500), 25000);
        var a1 = pin(0, av(adj, "adj1", 12500), a5 * 2);
        var thh = ss * a5 / 100000, th = ss * a1 / 100000;
        var crx = Math.max(0, w / 2 - thh), cry = Math.max(0, h / 2 - thh);
        var st = angleOf(pin(0, av(adj, "adj4", 10800000), 21599999));
        var en = angleOf(pin(0, av(adj, "adj3", 20457681), 21599999));
        var full = sweepOf(st, en);
        var ha = Math.min(angleOf(pin(0, av(adj, "adj2", 1142319), 21599999)), full);
        return { ss: ss, a5: a5, thh: thh, th: th, crx: crx, cry: cry, st: st, en: en,
            full: full, hb: en - ha, body: full - ha };
    }
    function circPath(w, h, adj) {
        var g = circGeo(w, h, adj), cx = w / 2, cy = h / 2;
        var orx = g.crx + g.th / 2, ory = g.cry + g.th / 2;
        var irx = Math.max(0, g.crx - g.th / 2), iry = Math.max(0, g.cry - g.th / 2);
        var s0 = onEllipse(cx, cy, orx, ory, g.st);
        var p = P().M(s0[0], s0[1]);
        if (g.body > 0) p.arcTo(orx, ory, g.st, g.body);
        [onEllipse(cx, cy, g.crx + g.thh, g.cry + g.thh, g.hb),
            onEllipse(cx, cy, g.crx, g.cry, g.en),
            onEllipse(cx, cy, Math.max(0, g.crx - g.thh), Math.max(0, g.cry - g.thh), g.hb),
            onEllipse(cx, cy, irx, iry, g.hb)].forEach(function (q) { p.L(q[0], q[1]); });
        if (g.body > 0) p.arcTo(irx, iry, g.hb, -g.body);
        return p.Z().toString();
    }

    /* The curved arrows, as presetShapeDefinitions draws curvedRightArrow
       in a W x H box: a band sweeping round the left of the box - quarter
       ellipses of radii W x hR, the inner one th lower - that turns into a
       head at the bottom right. adj1 is the band's thickness, adj2 the
       head's width, adj3 its length. The other three are the same drawing
       mirrored, or in a box turned on its side (CURVE_DIRS). */
    function curvedGeo(W, H, adj) {
        var ss = Math.min(W, H);
        var a2 = pin(0, av(adj, "adj2", 50000), 50000 * H / ss);
        var a1 = pin(0, av(adj, "adj1", 25000), a2);
        var th = ss * a1 / 100000, aw = ss * a2 / 100000;
        var hR = H / 2 - (th + aw) / 4;
        var q7 = hR * 2;
        var idx = q7 > 0 ? Math.sqrt(Math.max(0, q7 * q7 - th * th)) * W / q7 : 0;
        var max3 = 100000 * idx / ss;
        var a3 = pin(0, av(adj, "adj3", 25000), max3);
        var ah = ss * a3 / 100000;
        var dy = W > 0 ? Math.sqrt(Math.max(0, W * W - ah * ah)) * hR / W : 0;
        var dh = (aw - th) / 2, y3 = hR + th;
        return { a2: a2, max3: max3, th: th, hR: hR, y3: y3, x1: W - ah,
            y4: hR + dy - dh, y6: H - aw / 2, y7: y3 + dy, y8: y3 + dy + dh,
            sw: Math.atan2(dy, ah) };
    }
    function curvedPath(W, H, adj) {
        var g = curvedGeo(W, H, adj);
        return P().M(W, 0).arcTo(W, g.hR, Math.PI * 1.5, -Math.PI / 2 - g.sw)
            .L(g.x1, g.y4).L(W, g.y6).L(g.x1, g.y8).L(g.x1, g.y7)
            .arcTo(W, g.hR, Math.PI - g.sw, g.sw + Math.PI / 2).Z().toString();
    }
    var CURVE_DIRS = {
        right: { side: false, f: function (w, h, x, y) { return [x, y]; } },
        left: { side: false, f: function (w, h, x, y) { return [w - x, y]; } },
        down: { side: true, f: function (w, h, x, y) { return [y, x]; } },
        up: { side: true, f: function (w, h, x, y) { return [y, h - x]; } }
    };
    function curvedDef(dir, label) {
        var D = CURVE_DIRS[dir];
        function box(w, h) { return D.side ? [h, w] : [w, h]; }
        // a handle placed in the drawing's own box
        function at(fn) {
            return function (w, h, a) {
                var b = box(w, h), q = fn(curvedGeo(b[0], b[1], a));
                return D.f(w, h, q[0], q[1]);
            };
        }
        return {
            cat: "arrow", label: label,
            adj: {
                defaults: { adj1: 25000, adj2: 50000, adj3: 25000 },
                handles: [
                    // the band's thickness, where it turns
                    fit("adj1", 0, function (w, h, ss, a) { var b = box(w, h); return curvedGeo(b[0], b[1], a).a2; },
                        at(function (g) { return [0, g.y3]; })),
                    // the head's width, at its outer corner
                    fit("adj2", 0, function (w, h, ss) { return 50000 * box(w, h)[1] / ss; },
                        at(function (g) { return [g.x1, g.y8]; })),
                    // the head's length, at its inner corner
                    fit("adj3", 0, function (w, h, ss, a) { var b = box(w, h); return curvedGeo(b[0], b[1], a).max3; },
                        at(function (g) { return [g.x1, g.y4]; }))
                ]
            },
            path: function (w, h, adj) {
                var b = box(w, h);
                return mapPath(curvedPath(b[0], b[1], adj), function (x, y) { return D.f(w, h, x, y); });
            }
        };
    }

    /* The bent arrow: up from the bottom left, round a corner of radius
       bd, and right into a head. adj1 the shaft, adj2 the head's half
       width, adj3 its length, adj4 the corner. */
    function bentGeo(w, h, adj) {
        var ss = Math.min(w, h);
        var a2 = pin(0, av(adj, "adj2", 25000), 50000);
        var a1 = pin(0, av(adj, "adj1", 25000), a2 * 2);
        var a3 = pin(0, av(adj, "adj3", 25000), 50000);
        var th = ss * a1 / 100000, aw2 = ss * a2 / 100000;
        var dh2 = aw2 - th / 2, ah = ss * a3 / 100000;
        var max4 = 100000 * Math.max(0, Math.min(w - ah, h - dh2)) / ss;
        var bd = ss * pin(0, av(adj, "adj4", 43750), max4) / 100000;
        var bd2 = Math.max(bd - th, 0);
        return { a2: a2, max4: max4, th: th, aw2: aw2, dh2: dh2, bd: bd, bd2: bd2,
            x3: th + bd2, x4: w - ah, y3: dh2 + th, y4: dh2 * 2 + th, y5: dh2 + bd };
    }

    /* The U-turn arrow: up the left, over the top round two corners of
       radius bd, and down into a head at adj5 of the height. adj1 the
       shaft, adj2 the head's half width, adj3 its length, adj4 the corners. */
    function uturnGeo(w, h, adj) {
        var ss = Math.min(w, h);
        var a2 = pin(0, av(adj, "adj2", 25000), 25000);
        var a1 = pin(0, av(adj, "adj1", 25000), a2 * 2);
        var max3 = (100000 - a1 * ss / h) * h / ss;
        var a3 = pin(0, av(adj, "adj3", 25000), max3);
        var min5 = (a3 + a1) * ss / h;
        var a5 = pin(min5, av(adj, "adj5", 75000), 100000);
        var th = ss * a1 / 100000, aw2 = ss * a2 / 100000;
        var dh2 = aw2 - th / 2;
        var y5 = h * a5 / 100000, y4 = y5 - ss * a3 / 100000;
        var x9 = w - dh2;
        var max4 = Math.max(0, Math.min(x9 / 2, y4)) * 100000 / ss;
        var bd = ss * pin(0, av(adj, "adj4", 43750), max4) / 100000;
        var bd2 = Math.max(bd - th, 0);
        var x6 = w - aw2 * 2, x7 = x6 + dh2;
        return { a2: a2, max3: max3, min5: min5, max4: max4, th: th, bd: bd, bd2: bd2,
            y4: y4, y5: y5, x3: th + bd2, x4: x9 - bd, x6: x6, x7: x7, x8: w - aw2, x9: x9 };
    }

    /* The left-up, left-right-up and quad arrows share their guides: adj1
       the shafts, adj2 the heads' half width, adj3 the heads' length. */
    function multiGeo(w, h, adj, def, max2) {
        var ss = Math.min(w, h);
        var a2 = pin(0, av(adj, "adj2", def), max2);
        var a1 = pin(0, av(adj, "adj1", def), a2 * 2);
        return { ss: ss, a1: a1, a2: a2 };
    }
    function leftUpGeo(w, h, adj) {
        var m = multiGeo(w, h, adj, 25000, 50000), ss = m.ss;
        var max3 = 100000 - m.a2 * 2;
        var x1 = ss * pin(0, av(adj, "adj3", 25000), max3) / 100000;
        var dx2 = ss * m.a2 / 50000, dx4 = ss * m.a2 / 100000, dx3 = ss * m.a1 / 200000;
        var x4 = w - dx4, y4 = h - dx4;
        return { a2: m.a2, max3: max3, x1: x1, x2: w - dx2, y2: h - dx2, x3: x4 - dx3, x4: x4,
            x5: x4 + dx3, y3: y4 - dx3, y4: y4, y5: y4 + dx3 };
    }
    function crossGeo(w, h, adj, def) {
        var m = multiGeo(w, h, adj, def, 50000), ss = m.ss;
        var max3 = (100000 - m.a2 * 2) / 2;
        var x1 = ss * pin(0, av(adj, "adj3", def), max3) / 100000;
        var dx2 = ss * m.a2 / 100000, dx3 = ss * m.a1 / 200000;
        return { a2: m.a2, max3: max3, x1: x1, dx2: dx2, dx3: dx3,
            x2: w / 2 - dx2, x3: w / 2 - dx3, x4: w / 2 + dx3, x5: w / 2 + dx2, x6: w - x1 };
    }
    function bentUpGeo(w, h, adj) {
        var ss = Math.min(w, h);
        var a1 = pin(0, av(adj, "adj1", 25000), 50000);
        var a2 = pin(0, av(adj, "adj2", 25000), 50000);
        var y1 = ss * pin(0, av(adj, "adj3", 25000), 50000) / 100000;
        var x3 = w - ss * a2 / 100000, dx2 = ss * a1 / 200000;
        return { y1: y1, x1: w - ss * a2 / 50000, x2: x3 - dx2, x3: x3, x4: x3 + dx2,
            y2: h - ss * a1 / 100000 };
    }

    /* The arrow callouts: a box with an arrow out of one side, drawn along
       u (towards the point, len long) and v (across, thick wide) and then
       turned to face its way (ARROW_DIRS). adj1 the shaft, adj2 the head's
       width, adj3 its length, adj4 how much of the length the box takes. */
    function arrowCalloutGeo(len, thick, ss, adj) {
        var a2 = pin(0, av(adj, "adj2", 25000), 50000 * thick / ss);
        var a1 = pin(0, av(adj, "adj1", 25000), a2 * 2);
        var a3 = pin(0, av(adj, "adj3", 25000), 100000 * len / ss);
        var max4 = 100000 - a3 * ss / len;
        var a4 = pin(0, av(adj, "adj4", 64977), max4);
        var dy1 = ss * a2 / 100000, dy2 = ss * a1 / 200000;
        return { a2: a2, max4: max4, v1: thick / 2 - dy1, v2: thick / 2 - dy2, v3: thick / 2 + dy2,
            v4: thick / 2 + dy1, x2: len * a4 / 100000, x3: len - ss * a3 / 100000 };
    }
    function arrowCalloutDef(dir, label) {
        var D = ARROW_DIRS[dir];
        function lt(w, h) { return D.len === "w" ? [w, h] : [h, w]; }
        function geo(w, h, a) { var b = lt(w, h); return arrowCalloutGeo(b[0], b[1], Math.min(w, h), a); }
        function at(fn) {
            return function (w, h, a) {
                var b = lt(w, h), q = fn(geo(w, h, a), b[0], b[1]);
                return D.to(w, h, q[0], q[1]);
            };
        }
        return {
            cat: "arrow", label: label,
            adj: {
                defaults: { adj1: 25000, adj2: 25000, adj3: 25000, adj4: 64977 },
                handles: [
                    fit("adj1", 0, function (w, h, ss, a) { return geo(w, h, a).a2 * 2; },
                        at(function (g) { return [g.x3, g.v2]; })),
                    fit("adj2", 0, function (w, h, ss) { return 50000 * lt(w, h)[1] / ss; },
                        at(function (g, L) { return [L, g.v1]; })),
                    fit("adj3", 0, function (w, h, ss) { return 100000 * lt(w, h)[0] / ss; },
                        at(function (g) { return [g.x3, 0]; })),
                    fit("adj4", 0, function (w, h, ss, a) { return geo(w, h, a).max4; },
                        at(function (g, L, T) { return [g.x2, T]; }))
                ]
            },
            pts: function (w, h, adj) {
                var b = lt(w, h), L = b[0], T = b[1], g = geo(w, h, adj);
                return [[0, 0], [g.x2, 0], [g.x2, g.v2], [g.x3, g.v2], [g.x3, g.v1], [L, T / 2],
                    [g.x3, g.v4], [g.x3, g.v3], [g.x2, g.v3], [g.x2, T], [0, T]].map(function (q) {
                    return D.to(w, h, q[0], q[1]);
                });
            }
        };
    }
    function lrCalloutGeo(w, h, adj) {
        var ss = Math.min(w, h);
        var a2 = pin(0, av(adj, "adj2", 25000), 50000 * h / ss);
        var a1 = pin(0, av(adj, "adj1", 25000), a2 * 2);
        var a3 = pin(0, av(adj, "adj3", 25000), 50000 * w / ss);
        var max4 = 100000 - a3 * ss / (w / 2);
        var a4 = pin(0, av(adj, "adj4", 48123), max4);
        var dy1 = ss * a2 / 100000, dy2 = ss * a1 / 200000;
        var x1 = ss * a3 / 100000, dx2 = w * a4 / 200000;
        return { a2: a2, max4: max4, x1: x1, x2: w / 2 - dx2, x3: w / 2 + dx2, x4: w - x1,
            y1: h / 2 - dy1, y2: h / 2 - dy2, y3: h / 2 + dy2, y4: h / 2 + dy1 };
    }

    /* A brace in a w x h box, open side on the right, as PowerPoint draws
       leftBrace: quarter ellipses of radii w/2 x y1 out to the point at
       adj2 of the height. adj1 is how far the curls run, in ss. */
    function braceGeo(w, h, adj) {
        var ss = Math.min(w, h);
        var a2 = pin(0, av(adj, "adj2", 50000), 100000);
        var max1 = Math.min(100000 - a2, a2) / 2 * h / ss;
        var y1 = ss * pin(0, av(adj, "adj1", 8333), max1) / 100000;
        return { max1: max1, y1: y1, y3: h * a2 / 100000 };
    }
    function bracePath(w, h, adj) {
        var g = braceGeo(w, h, adj), y1 = g.y1;
        return P().M(w, h).arcTo(w / 2, y1, Math.PI / 2, Math.PI / 2)
            .L(w / 2, g.y3 + y1).arcTo(w / 2, y1, 0, -Math.PI / 2)
            .arcTo(w / 2, y1, Math.PI / 2, -Math.PI / 2)
            .L(w / 2, y1).arcTo(w / 2, y1, Math.PI, Math.PI / 2).toString();
    }

    // where a teardrop's point is: adj 100000 puts it in the top right corner
    function teardropTip(w, h, adj) {
        var a = pin(0, av(adj, "adj", 100000), 200000) / 100000;
        return [w / 2 * (1 + a), h / 2 * (1 - a)];
    }
    function halfFrameGeo(w, h, adj) {
        var ss = Math.min(w, h);
        var x1 = ss * pin(0, av(adj, "adj2", 33333), 100000 * w / ss) / 100000;
        var max1 = 100000 * (h - h * x1 / w) / ss;
        var y1 = ss * pin(0, av(adj, "adj1", 33333), max1) / 100000;
        return { max1: max1, x1: x1, y1: y1, x2: w - y1 * w / h, y2: h - x1 * h / w };
    }

    // the equation shapes' bars run across 73490 / 100000 of the width
    function mathX(w) { return w * 73490 / 200000; }
    function mathMulGeo(w, h, adj) {
        var ss = Math.min(w, h);
        var th = ss * pin(0, av(adj, "adj1", 23520), 51965) / 100000;
        var a = Math.atan2(h, w), sa = Math.sin(a), ca = Math.cos(a), ta = Math.tan(a);
        var dl = Math.sqrt(w * w + h * h), lM = dl - dl * 51965 / 100000;
        var xM = ca * lM / 2, yM = sa * lM / 2;
        var xA = xM - sa * th / 2, yA = yM + ca * th / 2;
        var xB = xM + sa * th / 2, yB = yM - ca * th / 2;
        var yC = (w / 2 - xB) * ta + yB;
        var xFE = (h / 2 - yA) / ta;
        return { xA: xA, yA: yA, xB: xB, yB: yB, yC: yC, xD: w - xB, xE: w - xA,
            xF: w - xA - xFE, xL: xA + xFE };
    }
    function mathDivGeo(w, h, adj) {
        var a1 = pin(1000, av(adj, "adj1", 23520), 36745);
        var max3 = Math.min((73490 - a1) / 4, 36745 * w / h);
        var a3 = pin(1000, av(adj, "adj3", 11760), max3);
        var max2 = 73490 - 4 * a3 - a1;
        var a2 = pin(0, av(adj, "adj2", 5880), max2);
        var dy1 = h * a1 / 200000, rad = h * a3 / 100000;
        var y3 = h / 2 - dy1, y2 = y3 - (h * a2 / 100000 + rad);
        return { max2: max2, max3: max3, rad: rad, x1: w / 2 - mathX(w), x3: w / 2 + mathX(w),
            y1: y2 - rad, y2: y2, y3: y3, y4: h / 2 + dy1 };
    }
    // two bars, adj1 thick and adj2 apart (mathEqual; mathNotEqual's are
    // the same with its gap in adj3)
    function mathEqGeo(w, h, adj, gap) {
        var a1 = pin(0, av(adj, "adj1", 23520), gap === "adj3" ? 50000 : 36745);
        var max2 = 100000 - a1 * 2;
        var a2 = pin(0, av(adj, gap, 11760), max2);
        var dy1 = h * a1 / 100000, dy2 = h * a2 / 200000;
        return { max2: max2, dy1: dy1, x1: w / 2 - mathX(w), x2: w / 2 + mathX(w),
            y1: h / 2 - dy2 - dy1, y2: h / 2 - dy2, y3: h / 2 + dy2, y4: h / 2 + dy2 + dy1 };
    }
    // the stroke of "not equal": adj2 is its angle from the horizontal
    function notEqSlash(w, h, adj, dy1) {
        var cr = angleOf(pin(4200000, av(adj, "adj2", 6600000), 6600000)) - Math.PI / 2;
        var xadj = h / 2 * Math.tan(cr);
        var bhw = dy1 / Math.cos(cr);
        return { top: w / 2 + xadj, bhw: bhw };
    }

    /* The waves: adj1 is how far each edge swings (a share of the
       height), adj2 shifts the swing sideways (negative to the left). A
       shifted wave is narrower at one end, as PowerPoint draws it. */
    function waveGeo(w, h, adj, def1, max1) {
        var a1 = pin(0, av(adj, "adj1", def1), max1);
        var a2 = pin(-10000, av(adj, "adj2", 0), 10000);
        var y1 = h * a1 / 100000, dy2 = y1 * 10 / 3;
        var of2 = w * a2 / 50000;
        var dx2 = of2 > 0 ? 0 : of2, dx5 = of2 > 0 ? of2 : 0;
        return { y1: y1, y2: y1 - dy2, y3: y1 + dy2, y4: h - y1, y5: h - y1 - dy2, y6: h - y1 + dy2,
            xl: -dx2, xr: w - dx5, bl: dx5, br: w + dx2 };
    }
    // one wave from x0 to x1 along y (up first), as its cubic
    function waveTo(p, x0, x1, yUp, yDown, y) {
        var d = (x1 - x0) / 3;
        return p.C(x0 + d, yUp, x0 + 2 * d, yDown, x1, y);
    }
    function wavePath(w, h, adj, def1, max1, n) {
        var g = waveGeo(w, h, adj, def1, max1);
        var p = P().M(g.xl, g.y1), i, span = (g.xr - g.xl) / n, bspan = (g.br - g.bl) / n;
        for (i = 0; i < n; i++) waveTo(p, g.xl + span * i, g.xl + span * (i + 1), g.y2, g.y3, g.y1);
        p.L(g.br, g.y4);
        // back along the bottom: the same swing, run the other way
        for (i = n; i > 0; i--) waveTo(p, g.bl + bspan * i, g.bl + bspan * (i - 1), g.y6, g.y5, g.y4);
        return p.Z().toString();
    }
    function waveAdj(def1, max1) {
        return {
            defaults: { adj1: def1, adj2: 0 },
            handles: [share("adj1", "h", max1, function (w, h, d) { return [0, d]; },
                function (w, h, x, y) { return y; }),
            {
                pos: function (w, h, a) { return [w / 2 + w * pin(-10000, a.adj2, 10000) / 100000, h]; },
                set: function (w, h, x) {
                    return { adj2: Math.round(pin(-10000, (x - w / 2) / Math.max(1e-6, w) * 100000, 10000)) };
                }
            }]
        };
    }

    /* ---------------- the catalogue ---------------- */
    /* Each entry is either `pts` (a polygon, which also answers points())
       or `path`. `detail` is stroked rather than filled; `evenOdd` says the
       path has holes in it. */

    var DEFS = {

        /* ---------- basic shapes ---------- */

        rect: {
            cat: "shape", label: "Rectangle",
            pts: function (w, h) { return [[0, 0], [w, 0], [w, h], [0, h]]; }
        },
        roundRect: {
            cat: "shape", label: "Rounded rectangle",
            path: function (w, h) {
                var r = Math.min(w, h) * 0.15;
                return roundRectPath(w, h, r, r, r, r);
            }
        },
        /* The snipped and rounded corners follow presetShapeDefinitions:
           each guide is a corner size in ss, at most half of it, and the
           "same side" / "diagonal" pairs leave their second pair of corners
           square until it is dragged. */
        snip1Rect: {
            cat: "shape", label: "Snip single corner",
            adj: {
                defaults: { adj: 16667 },
                handles: [ssLen("adj", 50000, function (w, h, d) { return [w - d, 0]; },
                    function (w, h, x) { return w - x; })]
            },
            pts: function (w, h, adj) {
                var s = Math.min(w, h) * pin(0, av(adj, "adj", 16667), 50000) / 100000;
                return [[0, 0], [w - s, 0], [w, s], [w, h], [0, h]];
            }
        },
        snip2SameRect: {
            cat: "shape", label: "Snip same side corners",
            adj: {
                defaults: { adj1: 16667, adj2: 0 },
                handles: [ssLen("adj1", 50000, function (w, h, d) { return [w - d, 0]; },
                    function (w, h, x) { return w - x; }),
                ssLen("adj2", 50000, function (w, h, d) { return [d, h]; },
                    function (w, h, x) { return x; })]
            },
            pts: function (w, h, adj) {
                var ss = Math.min(w, h);
                var s = ss * pin(0, av(adj, "adj1", 16667), 50000) / 100000;
                var b = ss * pin(0, av(adj, "adj2", 0), 50000) / 100000;
                return [[s, 0], [w - s, 0], [w, s], [w, h - b], [w - b, h], [b, h], [0, h - b], [0, s]];
            }
        },
        snip2DiagRect: {
            cat: "shape", label: "Snip diagonal corners",
            adj: {
                defaults: { adj1: 0, adj2: 16667 },
                handles: [ssLen("adj1", 50000, function (w, h, d) { return [d, 0]; },
                    function (w, h, x) { return x; }),
                ssLen("adj2", 50000, function (w, h, d) { return [w - d, 0]; },
                    function (w, h, x) { return w - x; })]
            },
            // adj1 snips the top left and bottom right, adj2 the other two
            pts: function (w, h, adj) {
                var ss = Math.min(w, h);
                var a = ss * pin(0, av(adj, "adj1", 0), 50000) / 100000;
                var b = ss * pin(0, av(adj, "adj2", 16667), 50000) / 100000;
                return [[a, 0], [w - b, 0], [w, b], [w, h - a], [w - a, h], [b, h], [0, h - b], [0, a]];
            }
        },
        round1Rect: {
            cat: "shape", label: "Round single corner",
            adj: {
                defaults: { adj: 16667 },
                handles: [ssLen("adj", 50000, function (w, h, d) { return [w - d, 0]; },
                    function (w, h, x) { return w - x; })]
            },
            path: function (w, h, adj) {
                var r = Math.min(w, h) * pin(0, av(adj, "adj", 16667), 50000) / 100000;
                return roundRectPath(w, h, 0, r, 0, 0);
            }
        },
        round2SameRect: {
            cat: "shape", label: "Round same side corners",
            adj: {
                defaults: { adj1: 16667, adj2: 0 },
                handles: [ssLen("adj1", 50000, function (w, h, d) { return [w - d, 0]; },
                    function (w, h, x) { return w - x; }),
                ssLen("adj2", 50000, function (w, h, d) { return [d, h]; },
                    function (w, h, x) { return x; })]
            },
            path: function (w, h, adj) {
                var ss = Math.min(w, h);
                var r = ss * pin(0, av(adj, "adj1", 16667), 50000) / 100000;
                var b = ss * pin(0, av(adj, "adj2", 0), 50000) / 100000;
                return roundRectPath(w, h, r, r, b, b);
            }
        },
        round2DiagRect: {
            cat: "shape", label: "Round diagonal corners",
            adj: {
                defaults: { adj1: 16667, adj2: 0 },
                handles: [ssLen("adj1", 50000, function (w, h, d) { return [d, 0]; },
                    function (w, h, x) { return x; }),
                ssLen("adj2", 50000, function (w, h, d) { return [w - d, 0]; },
                    function (w, h, x) { return w - x; })]
            },
            // adj1 rounds the top left and bottom right, adj2 the other two
            path: function (w, h, adj) {
                var ss = Math.min(w, h);
                var r = ss * pin(0, av(adj, "adj1", 16667), 50000) / 100000;
                var b = ss * pin(0, av(adj, "adj2", 0), 50000) / 100000;
                return roundRectPath(w, h, r, b, r, b);
            }
        },
        ellipse: {
            cat: "shape", label: "Ellipse",
            path: function (w, h) { return P().circle(w / 2, h / 2, w / 2, h / 2).toString(); }
        },
        triangle: {
            cat: "shape", label: "Triangle",
            adj: {
                defaults: { adj: 50000 },
                handles: [share("adj", "w", 100000, function (w, h, d) { return [d, 0]; },
                    function (w, h, x) { return x; })]
            },
            pts: function (w, h, adj) { return [[w * pin(0, av(adj, "adj", 50000), 100000) / 100000, 0], [w, h], [0, h]]; }
        },
        rtTriangle: {
            cat: "shape", label: "Right triangle",
            pts: function (w, h) { return [[0, 0], [w, h], [0, h]]; }
        },
        parallelogram: {
            cat: "shape", label: "Parallelogram",
            adj: {
                defaults: { adj: 25000 },
                handles: [ssLen("adj", wCap(100000), function (w, h, d) { return [d, 0]; },
                    function (w, h, x) { return x; })]
            },
            pts: function (w, h, adj) {
                var ss = Math.min(w, h);
                var x2 = ss * pin(0, av(adj, "adj", 25000), 100000 * w / ss) / 100000;
                return [[x2, 0], [w, 0], [w - x2, h], [0, h]];
            }
        },
        trapezoid: {
            cat: "shape", label: "Trapezoid",
            adj: {
                defaults: { adj: 25000 },
                handles: [ssLen("adj", wCap(50000), function (w, h, d) { return [d, 0]; },
                    function (w, h, x) { return x; })]
            },
            pts: function (w, h, adj) {
                var ss = Math.min(w, h);
                var x2 = ss * pin(0, av(adj, "adj", 25000), 50000 * w / ss) / 100000;
                return [[x2, 0], [w - x2, 0], [w, h], [0, h]];
            }
        },
        diamond: {
            cat: "shape", label: "Diamond",
            pts: function (w, h) { return [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]; }
        },
        pentagon: {
            cat: "shape", label: "Pentagon",
            pts: function (w, h) { return ngon(w, h, 5); }
        },
        hexagon: {
            cat: "shape", label: "Hexagon",
            adj: {
                defaults: { adj: 25000 },
                handles: [ssLen("adj", wCap(50000), function (w, h, d) { return [d, 0]; },
                    function (w, h, x) { return x; })]
            },
            pts: function (w, h, adj) {
                var ss = Math.min(w, h);
                var x1 = ss * pin(0, av(adj, "adj", 25000), 50000 * w / ss) / 100000;
                return [[x1, 0], [w - x1, 0], [w, h / 2], [w - x1, h], [x1, h], [0, h / 2]];
            }
        },
        heptagon: {
            cat: "shape", label: "Heptagon",
            pts: function (w, h) { return ngon(w, h, 7); }
        },
        octagon: {
            cat: "shape", label: "Octagon",
            adj: {
                defaults: { adj: 29289 },
                handles: [ssLen("adj", 50000, function (w, h, d) { return [d, 0]; },
                    function (w, h, x) { return x; })]
            },
            pts: function (w, h, adj) {
                var s = Math.min(w, h) * pin(0, av(adj, "adj", 29289), 50000) / 100000;
                return [[s, 0], [w - s, 0], [w, s], [w, h - s],
                    [w - s, h], [s, h], [0, h - s], [0, s]];
            }
        },
        decagon: {
            cat: "shape", label: "Decagon",
            pts: function (w, h) { return ngon(w, h, 10); }
        },
        dodecagon: {
            cat: "shape", label: "Dodecagon",
            pts: function (w, h) { return ngon(w, h, 12); }
        },
        plus: {
            cat: "shape", label: "Cross",
            adj: {
                defaults: { adj: 25000 },
                handles: [ssLen("adj", 50000, function (w, h, d) { return [0, d]; },
                    function (w, h, x, y) { return y; })]
            },
            pts: function (w, h, adj) {
                var x1 = Math.min(w, h) * pin(0, av(adj, "adj", 25000), 50000) / 100000;
                var x2 = w - x1, y2 = h - x1;
                return [[x1, 0], [x2, 0], [x2, x1], [w, x1], [w, y2], [x2, y2], [x2, h], [x1, h],
                    [x1, y2], [0, y2], [0, x1], [x1, x1]];
            }
        },
        teardrop: {
            cat: "shape", label: "Teardrop",
            /* three quarters of an ellipse, the last quarter pulled out
               towards the top right corner - as far as adj says (100000
               reaches the corner, 200000 twice as far) */
            adj: {
                defaults: { adj: 100000 },
                handles: [fit("adj", 0, 200000, function (w, h, a) { return teardropTip(w, h, a); })]
            },
            path: function (w, h, adj) {
                var t = teardropTip(w, h, adj);
                var x2 = (w / 2 + t[0]) / 2, y2 = (h / 2 + t[1]) / 2;
                return P().M(0, h / 2).arcTo(w / 2, h / 2, Math.PI, Math.PI / 2)
                    .Q(x2, 0, t[0], t[1]).Q(w, y2, w, h / 2)
                    .arcTo(w / 2, h / 2, 0, Math.PI).Z().toString();
            }
        },
        frame: {
            cat: "shape", label: "Frame",
            evenOdd: true,
            adj: {
                defaults: { adj1: 12500 },
                handles: [ssLen("adj1", 50000, function (w, h, d) { return [d, 0]; },
                    function (w, h, x) { return x; })]
            },
            path: function (w, h, adj) {
                var t = Math.min(w, h) * pin(0, av(adj, "adj1", 12500), 50000) / 100000;
                return P().poly([[0, 0], [w, 0], [w, h], [0, h]]).toString() +
                    P().poly([[t, t], [t, h - t], [w - t, h - t], [w - t, t]]).toString();
            }
        },
        halfFrame: {
            cat: "shape", label: "Half frame",
            // adj1 the top bar, adj2 the side bar, both in ss; the ends are
            // cut along the frame's diagonal
            adj: {
                defaults: { adj1: 33333, adj2: 33333 },
                handles: [fit("adj1", 0, function (w, h, ss, a) { return halfFrameGeo(w, h, a).max1; },
                    function (w, h, a) { var g = halfFrameGeo(w, h, a); return [g.x2, g.y1]; }),
                fit("adj2", 0, function (w, h, ss) { return 100000 * w / ss; },
                    function (w, h, a) { var g = halfFrameGeo(w, h, a); return [g.x1, g.y2]; })]
            },
            pts: function (w, h, adj) {
                var g = halfFrameGeo(w, h, adj);
                return [[0, 0], [w, 0], [g.x2, g.y1], [g.x1, g.y1], [g.x1, g.y2], [0, h]];
            }
        },
        corner: {
            cat: "shape", label: "L shape",
            // adj1 is the foot's height, adj2 the upright's width, in ss
            adj: {
                defaults: { adj1: 50000, adj2: 50000 },
                handles: [ssLen("adj1", hCap(100000), function (w, h, d) { return [w, h - d]; },
                    function (w, h, x, y) { return h - y; }),
                ssLen("adj2", wCap(100000), function (w, h, d) { return [d, 0]; },
                    function (w, h, x) { return x; })]
            },
            pts: function (w, h, adj) {
                var ss = Math.min(w, h);
                var x1 = ss * pin(0, av(adj, "adj2", 50000), 100000 * w / ss) / 100000;
                var y1 = h - ss * pin(0, av(adj, "adj1", 50000), 100000 * h / ss) / 100000;
                return [[0, 0], [x1, 0], [x1, y1], [w, y1], [w, h], [0, h]];
            }
        },
        diagStripe: {
            cat: "shape", label: "Diagonal stripe",
            adj: {
                defaults: { adj: 50000 },
                handles: [share("adj", "h", 100000, function (w, h, d) { return [0, d]; },
                    function (w, h, x, y) { return y; })]
            },
            pts: function (w, h, adj) {
                var a = pin(0, av(adj, "adj", 50000), 100000) / 100000;
                return [[0, h * a], [w * a, 0], [w, 0], [0, h]];
            }
        },
        plaque: {
            cat: "shape", label: "Plaque",
            adj: {
                defaults: { adj: 16667 },
                handles: [ssLen("adj", 50000, function (w, h, d) { return [d, 0]; },
                    function (w, h, x) { return x; })]
            },
            path: function (w, h, adj) {
                var r = Math.min(w, h) * pin(0, av(adj, "adj", 16667), 50000) / 100000;
                var p = P();
                p.M(r, 0).L(w - r, 0);
                p.arc(w, 0, r, r, Math.PI * 0.5, Math.PI);
                p.L(w, h - r);
                p.arc(w, h, r, r, Math.PI, Math.PI * 1.5);
                p.L(r, h);
                p.arc(0, h, r, r, Math.PI * 1.5, Math.PI * 2);
                p.L(0, r);
                p.arc(0, 0, r, r, 0, Math.PI * 0.5);
                return p.Z().toString();
            }
        },
        can: {
            cat: "shape", label: "Cylinder",
            // the handle sits at the bottom of the lid
            adj: {
                defaults: { adj: 25000 },
                handles: [ssLen("adj", hCap(50000), function (w, h, d) { return [w / 2, d]; },
                    function (w, h, x, y) { return y; })]
            },
            path: function (w, h, adj) {
                var ss = Math.min(w, h);
                var ry = ss * pin(0, av(adj, "adj", 25000), 50000 * h / ss) / 200000;
                var p = P();
                p.M(0, ry).arc(w / 2, ry, w / 2, ry, Math.PI, Math.PI * 2)
                    .L(w, h - ry)
                    .arc(w / 2, h - ry, w / 2, ry, 0, Math.PI)
                    .Z();
                return p.toString();
            },
            detail: function (w, h, adj) {
                var ss = Math.min(w, h);
                var ry = ss * pin(0, av(adj, "adj", 25000), 50000 * h / ss) / 200000;
                return P().arc(w / 2, ry, w / 2, ry, 0, Math.PI, true).toString();
            }
        },
        cube: {
            cat: "shape", label: "Cube",
            adj: {
                defaults: { adj: 25000 },
                handles: [ssLen("adj", 100000, function (w, h, d) { return [0, d]; },
                    function (w, h, x, y) { return y; })]
            },
            path: function (w, h, adj) {
                var d = Math.min(w, h) * pin(0, av(adj, "adj", 25000), 100000) / 100000;
                return P().poly([[0, d], [d, 0], [w, 0], [w, h - d], [w - d, h], [0, h]]).toString();
            },
            detail: function (w, h, adj) {
                var d = Math.min(w, h) * pin(0, av(adj, "adj", 25000), 100000) / 100000;
                return P().M(0, d).L(w - d, d).L(w, 0).toString() +
                    P().M(w - d, d).L(w - d, h).toString();
            }
        },
        bevel: {
            cat: "shape", label: "Bevel",
            evenOdd: true,
            adj: {
                defaults: { adj: 12500 },
                handles: [ssLen("adj", 50000, function (w, h, d) { return [d, 0]; },
                    function (w, h, x) { return x; })]
            },
            path: function (w, h, adj) {
                var t = Math.min(w, h) * pin(0, av(adj, "adj", 12500), 50000) / 100000;
                return P().poly([[0, 0], [w, 0], [w, h], [0, h]]).toString() +
                    P().poly([[t, t], [w - t, t], [w - t, h - t], [t, h - t]]).toString();
            },
            detail: function (w, h, adj) {
                var t = Math.min(w, h) * pin(0, av(adj, "adj", 12500), 50000) / 100000;
                return P().M(0, 0).L(t, t).toString() +
                    P().M(w, 0).L(w - t, t).toString() +
                    P().M(w, h).L(w - t, h - t).toString() +
                    P().M(0, h).L(t, h - t).toString();
            }
        },
        donut: {
            cat: "shape", label: "Donut",
            evenOdd: true,
            // adj is the ring's thickness, in ss
            adj: {
                defaults: { adj: 25000 },
                handles: [ssLen("adj", 50000, function (w, h, d) { return [d, h / 2]; },
                    function (w, h, x) { return x; })]
            },
            path: function (w, h, adj) {
                var t = Math.min(w, h) * pin(0, av(adj, "adj", 25000), 50000) / 100000;
                return P().circle(w / 2, h / 2, w / 2, h / 2).toString() +
                    P().circle(w / 2, h / 2, Math.max(0, w / 2 - t), Math.max(0, h / 2 - t)).toString();
            }
        },
        noSmoking: {
            cat: "shape", label: "\"No\" symbol",
            /* Not even-odd: the ring's hole comes from winding the inner
               ellipse the other way, which leaves the bar free to fill right
               across it. Even-odd would punch the bar out again wherever it
               crosses the ring. The ring and the bar are adj thick, in ss,
               and the bar runs from the top left to the bottom right. */
            adj: {
                defaults: { adj: 18750 },
                handles: [ssLen("adj", 50000, function (w, h, d) { return [d, h / 2]; },
                    function (w, h, x) { return x; })]
            },
            path: function (w, h, adj) {
                var t = Math.min(w, h) * pin(0, av(adj, "adj", 18750), 50000) / 100000;
                var ang = Math.atan2(h, w);
                var mid = onEllipse(0, 0, Math.max(0, w / 2 - t / 2), Math.max(0, h / 2 - t / 2), ang);
                var len = Math.sqrt(mid[0] * mid[0] + mid[1] * mid[1]);
                var ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy * t / 2, ny = ux * t / 2;
                var cx = w / 2, cy = h / 2;
                var p = P().circle(cx, cy, w / 2, h / 2);
                if (w / 2 - t > 0 && h / 2 - t > 0) {
                    p.arc(cx, cy, w / 2 - t, h / 2 - t, 2 * Math.PI, 0, true).Z();
                    p.poly([[cx - ux * len - nx, cy - uy * len - ny], [cx + ux * len - nx, cy + uy * len - ny],
                        [cx + ux * len + nx, cy + uy * len + ny], [cx - ux * len + nx, cy - uy * len + ny]]);
                }
                return p.toString();
            }
        },
        blockArc: {
            cat: "shape", label: "Block arc",
            // adj1 / adj2 are where the band starts and ends (clockwise),
            // adj3 its thickness in ss
            adj: {
                defaults: { adj1: 10800000, adj2: 0, adj3: 25000 },
                handles: [{
                    // the start, on the inside edge: its angle and the thickness
                    pos: function (w, h, a) {
                        var dr = Math.min(w, h) * pin(0, a.adj3, 50000) / 100000;
                        return onEllipse(w / 2, h / 2, Math.max(0, w / 2 - dr), Math.max(0, h / 2 - dr),
                            angleOf(pin(0, a.adj1, 21599999)));
                    },
                    set: function (w, h, x, y) {
                        var ang = Math.atan2(y - h / 2, x - w / 2), ss = Math.min(w, h);
                        var dr = insetAt(w / 2, h / 2, ang, Math.sqrt((x - w / 2) * (x - w / 2) +
                            (y - h / 2) * (y - h / 2)), ss / 2);
                        return { adj1: angleGuide(x, y, w / 2, h / 2),
                            adj3: Math.round(pin(0, dr / Math.max(1e-6, ss) * 100000, 50000)) };
                    }
                }, polar("adj2")]
            },
            path: function (w, h, adj) {
                var st = angleOf(pin(0, av(adj, "adj1", 10800000), 21599999));
                var sw = sweepOf(st, angleOf(pin(0, av(adj, "adj2", 0), 21599999)));
                var dr = Math.min(w, h) * pin(0, av(adj, "adj3", 25000), 50000) / 100000;
                var iw = w / 2 - dr, ih = h / 2 - dr;
                var o = onEllipse(w / 2, h / 2, w / 2, h / 2, st);
                var p = P().M(o[0], o[1]).arcTo(w / 2, h / 2, st, sw);
                if (iw > 0 && ih > 0) {
                    var q = onEllipse(w / 2, h / 2, iw, ih, st + sw);
                    p.L(q[0], q[1]).arcTo(iw, ih, st + sw, -sw);
                } else p.L(w / 2, h / 2);
                return p.Z().toString();
            }
        },
        foldedCorner: {
            cat: "shape", label: "Folded corner",
            adj: {
                defaults: { adj: 16667 },
                handles: [ssLen("adj", 50000, function (w, h, d) { return [w - d, h]; },
                    function (w, h, x) { return w - x; })]
            },
            path: function (w, h, adj) {
                var f = Math.min(w, h) * pin(0, av(adj, "adj", 16667), 50000) / 100000;
                return P().poly([[0, 0], [w, 0], [w, h - f], [w - f, h], [0, h]]).toString();
            },
            detail: function (w, h, adj) {
                var f = Math.min(w, h) * pin(0, av(adj, "adj", 16667), 50000) / 100000;
                return P().M(w, h - f).L(w - f, h - f).L(w - f, h).toString();
            }
        },
        smileyFace: {
            cat: "shape", label: "Smiley face",
            evenOdd: true,
            // adj bends the mouth: up to 4653 a smile, down to -4653 a frown
            adj: {
                defaults: { adj: 4653 },
                handles: [fit("adj", -4653, 4653, function (w, h, a) {
                    return [w / 2, h * 16515 / 21600 + h * pin(-4653, a.adj, 4653) / 100000];
                })]
            },
            path: function (w, h, adj) {
                var a = pin(-4653, av(adj, "adj", 4653), 4653);
                var eyeW = w * 1125 / 21600, eyeH = h * 1125 / 21600, eyeY = h * 7570 / 21600;
                var x1 = w * 4969 / 21699, x4 = w * 16640 / 21600;
                var dy2 = h * a / 100000, y2 = h * 16515 / 21600 - dy2;
                var y5 = h * 16515 / 21600 + dy2 + h * a / 50000;
                // the mouth is a thin crescent, so it reads without a stroke
                var lip = h * 0.12 * (a >= 0 ? 1 : -1);
                return P().circle(w / 2, h / 2, w / 2, h / 2).toString() +
                    P().circle(w * 6215 / 21600 + eyeW, eyeY, eyeW, eyeH).toString() +
                    P().circle(w * 13135 / 21600 + eyeW, eyeY, eyeW, eyeH).toString() +
                    P().M(x1, y2).Q(w / 2, y5, x4, y2).Q(w / 2, y5 - lip, x1, y2).Z().toString();
            }
        },
        heart: {
            cat: "shape", label: "Heart",
            path: function (w, h) {
                return P().M(w / 2, h)
                    .C(w * -0.06, h * 0.6, w * 0.08, h * -0.1, w / 2, h * 0.24)
                    .C(w * 0.92, h * -0.1, w * 1.06, h * 0.6, w / 2, h)
                    .Z().toString();
            }
        },
        lightningBolt: {
            cat: "shape", label: "Lightning bolt",
            pts: function (w, h) {
                return [[w * 0.44, 0], [w * 0.84, h * 0.40], [w * 0.60, h * 0.44],
                    [w * 0.93, h * 0.75], [w * 0.68, h * 0.74], [w * 0.83, h],
                    [w * 0.30, h * 0.56], [w * 0.53, h * 0.52], [w * 0.19, h * 0.24],
                    [w * 0.42, h * 0.26], [w * 0.16, h * 0.03]];
            }
        },
        sun: {
            cat: "shape", label: "Sun",
            /* eight rays off a disc: the ring of "mid" points is the disc.
               adj is the gap from the frame to the disc, a share of the
               width (and height) - 12500 a small sun, 46875 almost no rays */
            adj: {
                defaults: { adj: 25000 },
                handles: [fit("adj", 12500, 46875, function (w, h, a) {
                    return [w * pin(12500, a.adj, 46875) / 100000, h / 2];
                })]
            },
            pts: function (w, h, adj) {
                var cx = w / 2, cy = h / 2;
                var mid = 1 - 2 * pin(12500, av(adj, "adj", 25000), 46875) / 100000;
                var pts = [];
                for (var i = 0; i < 8; i++) {
                    var a = -Math.PI / 2 + i * Math.PI / 4;
                    var a1 = a - Math.PI / 10, a2 = a + Math.PI / 10;
                    pts.push([cx + cx * mid * Math.cos(a1), cy + cy * mid * Math.sin(a1)]);
                    pts.push([cx + cx * Math.cos(a), cy + cy * Math.sin(a)]);
                    pts.push([cx + cx * mid * Math.cos(a2), cy + cy * mid * Math.sin(a2)]);
                }
                return pts;
            }
        },
        moon: {
            cat: "shape", label: "Crescent moon",
            // adj is how thick the crescent is at its middle, in ss
            adj: {
                defaults: { adj: 50000 },
                handles: [ssLen("adj", 87500, function (w, h, d) { return [d * w / Math.min(w, h), h / 2]; },
                    function (w, h, x) { return x * Math.min(w, h) / w; })]
            },
            path: function (w, h, adj) {
                var g0w = w * pin(0, av(adj, "adj", 50000), 87500) / 100000;
                return P().M(w, h).arcTo(w, h / 2, Math.PI / 2, Math.PI)
                    .arcTo(w - g0w, h / 2, Math.PI * 1.5, -Math.PI).Z().toString();
            }
        },
        cloud: {
            cat: "shape", label: "Cloud",
            path: function (w, h) {
                var p = P();
                p.M(w * 0.22, h * 0.92)
                    .C(w * 0.02, h * 0.92, w * -0.05, h * 0.58, w * 0.13, h * 0.5)
                    .C(w * 0.06, h * 0.28, w * 0.26, h * 0.1, w * 0.42, h * 0.2)
                    .C(w * 0.5, h * -0.03, w * 0.8, h * -0.03, w * 0.86, h * 0.22)
                    .C(w * 1.04, h * 0.26, w * 1.04, h * 0.6, w * 0.87, h * 0.66)
                    .C(w * 0.93, h * 0.88, w * 0.7, h * 1.02, w * 0.57, h * 0.9)
                    .C(w * 0.48, h * 1.0, w * 0.3, h * 1.0, w * 0.22, h * 0.92)
                    .Z();
                return p.toString();
            }
        },
        arc: {
            cat: "shape", label: "Arc",
            open: true,
            // adj1 / adj2: where it starts and ends, clockwise
            adj: { defaults: { adj1: 16200000, adj2: 0 }, handles: [polar("adj1"), polar("adj2")] },
            path: function (w, h, adj) { return arcOutline(w, h, adj, 16200000, 0).toString(); }
        },
        chord: {
            cat: "shape", label: "Chord",
            adj: { defaults: { adj1: 2700000, adj2: 16200000 }, handles: [polar("adj1"), polar("adj2")] },
            path: function (w, h, adj) { return arcOutline(w, h, adj, 2700000, 16200000).Z().toString(); }
        },
        pie: {
            cat: "shape", label: "Pie",
            adj: { defaults: { adj1: 0, adj2: 16200000 }, handles: [polar("adj1"), polar("adj2")] },
            path: function (w, h, adj) {
                return arcOutline(w, h, adj, 0, 16200000).L(w / 2, h / 2).Z().toString();
            }
        },

        /* ---------- flow chart ---------- */

        flowChartProcess: {
            cat: "shape", label: "Flowchart: process",
            pts: function (w, h) { return [[0, 0], [w, 0], [w, h], [0, h]]; }
        },
        flowChartAlternateProcess: {
            cat: "shape", label: "Flowchart: alternate process",
            path: function (w, h) {
                var r = Math.min(w, h) * 0.17;
                return roundRectPath(w, h, r, r, r, r);
            }
        },
        flowChartDecision: {
            cat: "shape", label: "Flowchart: decision",
            pts: function (w, h) { return [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]; }
        },
        flowChartInputOutput: {
            cat: "shape", label: "Flowchart: data",
            pts: function (w, h) { return [[w * 0.2, 0], [w, 0], [w * 0.8, h], [0, h]]; }
        },
        flowChartPredefinedProcess: {
            cat: "shape", label: "Flowchart: predefined process",
            pts: function (w, h) { return [[0, 0], [w, 0], [w, h], [0, h]]; },
            detail: function (w, h) {
                return P().M(w * 0.12, 0).L(w * 0.12, h).toString() +
                    P().M(w * 0.88, 0).L(w * 0.88, h).toString();
            }
        },
        flowChartInternalStorage: {
            cat: "shape", label: "Flowchart: internal storage",
            pts: function (w, h) { return [[0, 0], [w, 0], [w, h], [0, h]]; },
            detail: function (w, h) {
                return P().M(w * 0.14, 0).L(w * 0.14, h).toString() +
                    P().M(0, h * 0.14).L(w, h * 0.14).toString();
            }
        },
        flowChartDocument: {
            cat: "shape", label: "Flowchart: document",
            path: function (w, h) {
                return P().M(0, 0).L(w, 0).L(w, h * 0.83)
                    .C(w * 0.72, h * 1.07, w * 0.28, h * 0.6, 0, h * 0.86)
                    .Z().toString();
            }
        },
        flowChartMultidocument: {
            cat: "shape", label: "Flowchart: multidocument",
            path: function (w, h) {
                return P().M(0, h * 0.13).L(w * 0.9, h * 0.13).L(w * 0.9, h * 0.9)
                    .C(w * 0.65, h * 1.1, w * 0.25, h * 0.68, 0, h * 0.92).Z().toString() +
                    P().M(w * 0.05, h * 0.07).L(w * 0.95, h * 0.07).L(w * 0.95, h * 0.8)
                    .L(w * 0.9, h * 0.8).L(w * 0.9, h * 0.13).L(w * 0.05, h * 0.13).Z().toString() +
                    P().M(w * 0.1, 0).L(w, 0).L(w, h * 0.72).L(w * 0.95, h * 0.72)
                    .L(w * 0.95, h * 0.07).L(w * 0.1, h * 0.07).Z().toString();
            }
        },
        flowChartTerminator: {
            cat: "shape", label: "Flowchart: terminator",
            path: function (w, h) {
                var r = Math.min(w / 2, h / 2);
                return roundRectPath(w, h, r, r, r, r);
            }
        },
        flowChartPreparation: {
            cat: "shape", label: "Flowchart: preparation",
            pts: function (w, h) {
                return [[w * 0.2, 0], [w * 0.8, 0], [w, h / 2],
                    [w * 0.8, h], [w * 0.2, h], [0, h / 2]];
            }
        },
        flowChartManualInput: {
            cat: "shape", label: "Flowchart: manual input",
            pts: function (w, h) { return [[0, h * 0.25], [w, 0], [w, h], [0, h]]; }
        },
        flowChartManualOperation: {
            cat: "shape", label: "Flowchart: manual operation",
            pts: function (w, h) { return [[0, 0], [w, 0], [w * 0.8, h], [w * 0.2, h]]; }
        },
        flowChartConnector: {
            cat: "shape", label: "Flowchart: connector",
            path: function (w, h) { return P().circle(w / 2, h / 2, w / 2, h / 2).toString(); }
        },
        flowChartOffpageConnector: {
            cat: "shape", label: "Flowchart: off-page connector",
            pts: function (w, h) {
                return [[0, 0], [w, 0], [w, h * 0.8], [w / 2, h], [0, h * 0.8]];
            }
        },
        flowChartPunchedCard: {
            cat: "shape", label: "Flowchart: card",
            pts: function (w, h) {
                var s = Math.min(w, h) * 0.22;
                return [[s, 0], [w, 0], [w, h], [0, h], [0, s]];
            }
        },
        flowChartPunchedTape: {
            cat: "shape", label: "Flowchart: punched tape",
            path: function (w, h) {
                return P().M(0, h * 0.12)
                    .C(w * 0.25, h * -0.1, w * 0.75, h * 0.34, w, h * 0.12)
                    .L(w, h * 0.88)
                    .C(w * 0.75, h * 1.1, w * 0.25, h * 0.66, 0, h * 0.88)
                    .Z().toString();
            }
        },
        flowChartSummingJunction: {
            cat: "shape", label: "Flowchart: summing junction",
            path: function (w, h) { return P().circle(w / 2, h / 2, w / 2, h / 2).toString(); },
            detail: function (w, h) {
                var k = 0.1464;   // where the diagonal meets the circle
                return P().M(w * k, h * k).L(w * (1 - k), h * (1 - k)).toString() +
                    P().M(w * (1 - k), h * k).L(w * k, h * (1 - k)).toString();
            }
        },
        flowChartOr: {
            cat: "shape", label: "Flowchart: or",
            path: function (w, h) { return P().circle(w / 2, h / 2, w / 2, h / 2).toString(); },
            detail: function (w, h) {
                return P().M(w / 2, 0).L(w / 2, h).toString() +
                    P().M(0, h / 2).L(w, h / 2).toString();
            }
        },
        flowChartCollate: {
            cat: "shape", label: "Flowchart: collate",
            pts: function (w, h) { return [[0, 0], [w, 0], [0, h], [w, h]]; }
        },
        flowChartSort: {
            cat: "shape", label: "Flowchart: sort",
            pts: function (w, h) { return [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]; },
            detail: function (w, h) { return P().M(0, h / 2).L(w, h / 2).toString(); }
        },
        flowChartExtract: {
            cat: "shape", label: "Flowchart: extract",
            pts: function (w, h) { return [[w / 2, 0], [w, h], [0, h]]; }
        },
        flowChartMerge: {
            cat: "shape", label: "Flowchart: merge",
            pts: function (w, h) { return [[0, 0], [w, 0], [w / 2, h]]; }
        },
        flowChartDelay: {
            cat: "shape", label: "Flowchart: delay",
            path: function (w, h) {
                var r = Math.min(w / 2, h / 2);
                return roundRectPath(w, h, 0, r, r, 0);
            }
        },
        flowChartMagneticDisk: {
            cat: "shape", label: "Flowchart: stored data",
            path: function (w, h) {
                var ry = Math.min(h * 0.18, w * 0.5);
                return P().M(0, ry).arc(w / 2, ry, w / 2, ry, Math.PI, Math.PI * 2)
                    .L(w, h - ry).arc(w / 2, h - ry, w / 2, ry, 0, Math.PI).Z().toString();
            },
            detail: function (w, h) {
                var ry = Math.min(h * 0.18, w * 0.5);
                return P().arc(w / 2, ry, w / 2, ry, 0, Math.PI, true).toString();
            }
        },
        flowChartDisplay: {
            cat: "shape", label: "Flowchart: display",
            path: function (w, h) {
                return P().M(0, h / 2).L(w * 0.17, 0).L(w * 0.83, 0)
                    .arc(w * 0.83, h / 2, w * 0.17, h / 2, -Math.PI / 2, Math.PI / 2)
                    .L(w * 0.17, h).Z().toString();
            }
        },

        /* ---------- arrows ---------- */

        rightArrow: {
            cat: "arrow", label: "Arrow: right", adj: arrowAdj("right"),
            pts: function (w, h, adj) { return arrowGeo(w, h, Math.min(w, h), adj); }
        },
        leftArrow: {
            cat: "arrow", label: "Arrow: left", adj: arrowAdj("left"),
            pts: function (w, h, adj) {
                return arrowGeo(w, h, Math.min(w, h), adj).map(function (p) { return [w - p[0], p[1]]; });
            }
        },
        upArrow: {
            cat: "arrow", label: "Arrow: up", adj: arrowAdj("up"),
            pts: function (w, h, adj) {
                return arrowGeo(h, w, Math.min(w, h), adj).map(function (p) { return [p[1], h - p[0]]; });
            }
        },
        downArrow: {
            cat: "arrow", label: "Arrow: down", adj: arrowAdj("down"),
            pts: function (w, h, adj) {
                return arrowGeo(h, w, Math.min(w, h), adj).map(function (p) { return [p[1], p[0]]; });
            }
        },
        leftRightArrow: {
            cat: "arrow", label: "Arrow: left-right",
            // the shaft's thickness at the right head, the heads' length at the left
            adj: {
                defaults: { adj1: 50000, adj2: 50000 },
                handles: [{
                    pos: function (w, h, a) {
                        var ss = Math.min(w, h);
                        var hl = ss * pin(0, a.adj2, 50000 * w / ss) / 100000;
                        return [w - hl, h / 2 - h * pin(0, a.adj1, 100000) / 200000];
                    },
                    set: function (w, h, x, y) {
                        return { adj1: Math.round(pin(0, (h / 2 - y) * 200000 / Math.max(1e-6, h), 100000)) };
                    }
                }, ssLen("adj2", wCap(50000), function (w, h, d) { return [d, 0]; },
                    function (w, h, x) { return x; })]
            },
            pts: function (w, h, adj) {
                var ss = Math.min(w, h);
                var t = h / 2 - h * pin(0, av(adj, "adj1", 50000), 100000) / 200000;
                var a = ss * pin(0, av(adj, "adj2", 50000), 50000 * w / ss) / 100000;
                return [[0, h / 2], [a, 0], [a, t], [w - a, t], [w - a, 0], [w, h / 2],
                    [w - a, h], [w - a, h - t], [a, h - t], [a, h]];
            }
        },
        upDownArrow: {
            cat: "arrow", label: "Arrow: up-down",
            // adj1 is the shaft's width (a share of the frame's), adj2 the
            // heads' length in ss
            adj: {
                defaults: { adj1: 50000, adj2: 50000 },
                handles: [{
                    pos: function (w, h, a) {
                        var ss = Math.min(w, h);
                        var hl = ss * pin(0, a.adj2, 50000 * h / ss) / 100000;
                        return [w / 2 - w * pin(0, a.adj1, 100000) / 200000, h - hl];
                    },
                    set: function (w, h, x) {
                        return { adj1: Math.round(pin(0, (w / 2 - x) * 200000 / Math.max(1e-6, w), 100000)) };
                    }
                }, ssLen("adj2", hCap(50000), function (w, h, d) { return [0, d]; },
                    function (w, h, x, y) { return y; })]
            },
            pts: function (w, h, adj) {
                var ss = Math.min(w, h);
                var t = w / 2 - w * pin(0, av(adj, "adj1", 50000), 100000) / 200000;
                var a = ss * pin(0, av(adj, "adj2", 50000), 50000 * h / ss) / 100000;
                return [[w / 2, 0], [w, a], [w - t, a], [w - t, h - a], [w, h - a], [w / 2, h],
                    [0, h - a], [t, h - a], [t, a], [0, a]];
            }
        },
        quadArrow: {
            cat: "arrow", label: "Arrow: quad",
            adj: {
                defaults: { adj1: 22500, adj2: 22500, adj3: 22500 },
                handles: [fit("adj1", 0, function (w, h, ss, a) { return crossGeo(w, h, a, 22500).a2 * 2; },
                    function (w, h, a) { var g = crossGeo(w, h, a, 22500); return [g.x3, g.x1]; }),
                fit("adj2", 0, 50000, function (w, h, a) { var g = crossGeo(w, h, a, 22500); return [g.x2, 0]; }),
                fit("adj3", 0, function (w, h, ss, a) { return crossGeo(w, h, a, 22500).max3; },
                    function (w, h, a) { var g = crossGeo(w, h, a, 22500); return [g.x1, h / 2 - g.dx2]; })]
            },
            pts: function (w, h, adj) {
                var g = crossGeo(w, h, adj, 22500), hc = w / 2, vc = h / 2;
                var y2 = vc - g.dx2, y5 = vc + g.dx2, y3 = vc - g.dx3, y4 = vc + g.dx3, y6 = h - g.x1;
                return [[0, vc], [g.x1, y2], [g.x1, y3], [g.x3, y3], [g.x3, g.x1], [g.x2, g.x1], [hc, 0],
                    [g.x5, g.x1], [g.x4, g.x1], [g.x4, y3], [g.x6, y3], [g.x6, y2], [w, vc], [g.x6, y5],
                    [g.x6, y4], [g.x4, y4], [g.x4, y6], [g.x5, y6], [hc, h], [g.x2, y6], [g.x3, y6],
                    [g.x3, y4], [g.x1, y4], [g.x1, y5]];
            }
        },
        leftRightUpArrow: {
            cat: "arrow", label: "Arrow: left-right-up",
            adj: {
                defaults: { adj1: 25000, adj2: 25000, adj3: 25000 },
                handles: [fit("adj1", 0, function (w, h, ss, a) { return crossGeo(w, h, a, 25000).a2 * 2; },
                    function (w, h, a) { var g = crossGeo(w, h, a, 25000); return [g.x3, h - g.dx2 - g.dx3]; }),
                fit("adj2", 0, 50000, function (w, h, a) { var g = crossGeo(w, h, a, 25000); return [g.x2, 0]; }),
                fit("adj3", 0, function (w, h, ss, a) { return crossGeo(w, h, a, 25000).max3; },
                    function (w, h, a) { var g = crossGeo(w, h, a, 25000); return [g.x1, h - g.dx2 * 2]; })]
            },
            pts: function (w, h, adj) {
                var g = crossGeo(w, h, adj, 25000), hc = w / 2;
                var y2 = h - g.dx2 * 2, y4 = h - g.dx2, y3 = y4 - g.dx3, y5 = y4 + g.dx3;
                return [[0, y4], [g.x1, y2], [g.x1, y3], [g.x3, y3], [g.x3, g.x1], [g.x2, g.x1], [hc, 0],
                    [g.x5, g.x1], [g.x4, g.x1], [g.x4, y3], [g.x6, y3], [g.x6, y2], [w, y4], [g.x6, h],
                    [g.x6, y5], [g.x1, y5], [g.x1, h]];
            }
        },
        bentArrow: {
            cat: "arrow", label: "Arrow: bent",
            adj: {
                defaults: { adj1: 25000, adj2: 25000, adj3: 25000, adj4: 43750 },
                handles: [fit("adj1", 0, function (w, h, ss, a) { return bentGeo(w, h, a).a2 * 2; },
                    function (w, h, a) { return [bentGeo(w, h, a).th, h]; }),
                fit("adj2", 0, 50000, function (w, h, a) { return [w, bentGeo(w, h, a).y4]; }),
                fit("adj3", 0, 50000, function (w, h, a) { return [bentGeo(w, h, a).x4, 0]; }),
                fit("adj4", 0, function (w, h, ss, a) { return bentGeo(w, h, a).max4; },
                    function (w, h, a) { return [bentGeo(w, h, a).bd, 0]; })]
            },
            path: function (w, h, adj) {
                var g = bentGeo(w, h, adj);
                return P().M(0, h).L(0, g.y5).arcTo(g.bd, g.bd, Math.PI, Math.PI / 2)
                    .L(g.x4, g.dh2).L(g.x4, 0).L(w, g.aw2).L(g.x4, g.y4).L(g.x4, g.y3).L(g.x3, g.y3)
                    .arcTo(g.bd2, g.bd2, Math.PI * 1.5, -Math.PI / 2).L(g.th, h).Z().toString();
            }
        },
        uturnArrow: {
            cat: "arrow", label: "Arrow: U-turn",
            adj: {
                defaults: { adj1: 25000, adj2: 25000, adj3: 25000, adj4: 43750, adj5: 75000 },
                handles: [fit("adj1", 0, function (w, h, ss, a) { return uturnGeo(w, h, a).a2 * 2; },
                    function (w, h, a) { return [uturnGeo(w, h, a).th, h]; }),
                fit("adj2", 0, 25000, function (w, h, a) { var g = uturnGeo(w, h, a); return [g.x6, g.y4]; }),
                fit("adj3", 0, function (w, h, ss, a) { return uturnGeo(w, h, a).max3; },
                    function (w, h, a) { return [w, uturnGeo(w, h, a).y4]; }),
                fit("adj4", 0, function (w, h, ss, a) { return uturnGeo(w, h, a).max4; },
                    function (w, h, a) { return [uturnGeo(w, h, a).bd, 0]; }),
                fit("adj5", function (w, h, ss, a) { return uturnGeo(w, h, a).min5; }, 100000,
                    function (w, h, a) { var g = uturnGeo(w, h, a); return [g.x8, g.y5]; })]
            },
            path: function (w, h, adj) {
                var g = uturnGeo(w, h, adj), H = Math.PI / 2;
                return P().M(0, h).L(0, g.bd).arcTo(g.bd, g.bd, Math.PI, H).L(g.x4, 0)
                    .arcTo(g.bd, g.bd, Math.PI * 1.5, H).L(g.x9, g.y4).L(w, g.y4).L(g.x8, g.y5)
                    .L(g.x6, g.y4).L(g.x7, g.y4).L(g.x7, g.x3).arcTo(g.bd2, g.bd2, 0, -H)
                    .L(g.x3, g.th).arcTo(g.bd2, g.bd2, Math.PI * 1.5, -H).L(g.th, h).Z().toString();
            }
        },
        leftUpArrow: {
            cat: "arrow", label: "Arrow: left-up",
            // an L with a head on each end: one points up, one points left
            adj: {
                defaults: { adj1: 25000, adj2: 25000, adj3: 25000 },
                handles: [fit("adj1", 0, function (w, h, ss, a) { return leftUpGeo(w, h, a).a2 * 2; },
                    function (w, h, a) { var g = leftUpGeo(w, h, a); return [g.x3, g.x1]; }),
                fit("adj2", 0, 50000, function (w, h, a) { return [leftUpGeo(w, h, a).x2, 0]; }),
                fit("adj3", 0, function (w, h, ss, a) { return leftUpGeo(w, h, a).max3; },
                    function (w, h, a) { var g = leftUpGeo(w, h, a); return [g.x1, g.y2]; })]
            },
            pts: function (w, h, adj) {
                var g = leftUpGeo(w, h, adj);
                return [[0, g.y4], [g.x1, g.y2], [g.x1, g.y3], [g.x3, g.y3], [g.x3, g.x1], [g.x2, g.x1],
                    [g.x4, 0], [w, g.x1], [g.x5, g.x1], [g.x5, g.y5], [g.x1, g.y5], [g.x1, h]];
            }
        },
        bentUpArrow: {
            cat: "arrow", label: "Arrow: bent up",
            adj: {
                defaults: { adj1: 25000, adj2: 25000, adj3: 25000 },
                handles: [fit("adj1", 0, 50000, function (w, h, a) { return [0, bentUpGeo(w, h, a).y2]; }),
                fit("adj2", 0, 50000, function (w, h, a) { return [bentUpGeo(w, h, a).x1, 0]; }),
                fit("adj3", 0, 50000, function (w, h, a) { return [w, bentUpGeo(w, h, a).y1]; })]
            },
            pts: function (w, h, adj) {
                var g = bentUpGeo(w, h, adj);
                return [[0, g.y2], [g.x2, g.y2], [g.x2, g.y1], [g.x1, g.y1], [g.x3, 0], [w, g.y1],
                    [g.x4, g.y1], [g.x4, h], [0, h]];
            }
        },
        stripedRightArrow: {
            cat: "arrow", label: "Arrow: striped right",
            adj: {
                defaults: { adj1: 50000, adj2: 50000 },
                handles: [share("adj1", "h", 100000, function (w, h, d) { return [0, h / 2 - d / 2]; },
                    function (w, h, x, y) { return (h / 2 - y) * 2; }),
                ssLen("adj2", wCap(84375), function (w, h, d) { return [w - d, 0]; },
                    function (w, h, x) { return w - x; })]
            },
            // two stripes and the arrow, side by side
            path: function (w, h, adj) {
                var ss = Math.min(w, h);
                var dy1 = h * pin(0, av(adj, "adj1", 50000), 100000) / 200000;
                var x5 = w - ss * pin(0, av(adj, "adj2", 50000), 84375 * w / ss) / 100000;
                var y1 = h / 2 - dy1, y2 = h / 2 + dy1;
                function bar(x0, x1) { return P().poly([[x0, y1], [x1, y1], [x1, y2], [x0, y2]]).toString(); }
                return bar(0, ss / 32) + bar(ss / 16, ss / 8) +
                    P().poly([[ss * 5 / 32, y1], [x5, y1], [x5, 0], [w, h / 2], [x5, h], [x5, y2],
                        [ss * 5 / 32, y2]]).toString();
            }
        },
        notchedRightArrow: {
            cat: "arrow", label: "Arrow: notched right", adj: arrowAdj("right"),
            pts: function (w, h, adj) {
                var ss = Math.min(w, h);
                var dx2 = ss * pin(0, av(adj, "adj2", 50000), 100000 * w / ss) / 100000;
                var dy1 = h * pin(0, av(adj, "adj1", 50000), 100000) / 200000;
                var hx = w - dx2, t = h / 2 - dy1;
                return [[0, t], [hx, t], [hx, 0], [w, h / 2], [hx, h], [hx, h - t],
                    [0, h - t], [dy1 * dx2 / (h / 2), h / 2]];
            }
        },
        chevron: {
            cat: "arrow", label: "Chevron",
            adj: {
                defaults: { adj: 50000 },
                handles: [ssLen("adj", wCap(100000), function (w, h, d) { return [w - d, 0]; },
                    function (w, h, x) { return w - x; })]
            },
            pts: function (w, h, adj) {
                var ss = Math.min(w, h);
                var x1 = ss * pin(0, av(adj, "adj", 50000), 100000 * w / ss) / 100000;
                return [[0, 0], [w - x1, 0], [w, h / 2], [w - x1, h], [0, h], [x1, h / 2]];
            }
        },
        homePlate: {
            cat: "arrow", label: "Pentagon arrow",
            adj: {
                defaults: { adj: 50000 },
                handles: [ssLen("adj", wCap(100000), function (w, h, d) { return [w - d, 0]; },
                    function (w, h, x) { return w - x; })]
            },
            pts: function (w, h, adj) {
                var ss = Math.min(w, h);
                var x1 = w - ss * pin(0, av(adj, "adj", 50000), 100000 * w / ss) / 100000;
                return [[0, 0], [x1, 0], [w, h / 2], [x1, h], [0, h]];
            }
        },
        curvedRightArrow: curvedDef("right", "Arrow: curved right"),
        curvedLeftArrow: curvedDef("left", "Arrow: curved left"),
        curvedUpArrow: curvedDef("up", "Arrow: curved up"),
        curvedDownArrow: curvedDef("down", "Arrow: curved down"),
        circularArrow: {
            cat: "arrow", label: "Arrow: circular",
            adj: {
                defaults: { adj1: 12500, adj2: 1142319, adj3: 20457681, adj4: 10800000, adj5: 12500 },
                handles: [{
                    // the start, on the inside edge: its angle and the thickness
                    pos: function (w, h, a) {
                        var g = circGeo(w, h, a);
                        return onEllipse(w / 2, h / 2, Math.max(0, g.crx - g.th / 2), Math.max(0, g.cry - g.th / 2), g.st);
                    },
                    set: function (w, h, x, y, a) {
                        var g = circGeo(w, h, a);
                        var ang = Math.atan2(y - h / 2, x - w / 2);
                        var t = insetAt(g.crx, g.cry, ang, Math.sqrt((x - w / 2) * (x - w / 2) +
                            (y - h / 2) * (y - h / 2)), Math.min(g.crx, g.cry));
                        return { adj4: angleGuide(x, y, w / 2, h / 2),
                            adj1: Math.round(pin(0, 2 * t / Math.max(1e-6, g.ss) * 100000, g.a5 * 2)) };
                    }
                }, {
                    // the point
                    pos: function (w, h, a) {
                        var g = circGeo(w, h, a);
                        return onEllipse(w / 2, h / 2, g.crx, g.cry, g.en);
                    },
                    set: function (w, h, x, y) { return { adj3: angleGuide(x, y, w / 2, h / 2) }; }
                }, {
                    // the head's inner corner: how long the head is and how wide
                    pos: function (w, h, a) {
                        var g = circGeo(w, h, a);
                        return onEllipse(w / 2, h / 2, Math.max(0, g.crx - g.thh), Math.max(0, g.cry - g.thh), g.hb);
                    },
                    set: function (w, h, x, y, a) {
                        var g = circGeo(w, h, a);
                        var ang = Math.atan2(y - h / 2, x - w / 2);
                        var span = sweepOf(ang, g.en);
                        // dragged past the point: no head at all
                        if (span > Math.PI * 1.5) span = 0;
                        var t = insetAt(w / 2, h / 2, ang, Math.sqrt((x - w / 2) * (x - w / 2) +
                            (y - h / 2) * (y - h / 2)), g.ss / 2);
                        return { adj2: Math.round(Math.min(span, g.full) * 180 / Math.PI * DEG),
                            adj5: Math.round(pin(0, t / 2 / Math.max(1e-6, g.ss) * 100000, 25000)) };
                    }
                }]
            },
            path: function (w, h, adj) { return circPath(w, h, adj); }
        },
        rightArrowCallout: arrowCalloutDef("right", "Callout: right arrow"),
        leftArrowCallout: arrowCalloutDef("left", "Callout: left arrow"),
        upArrowCallout: arrowCalloutDef("up", "Callout: up arrow"),
        downArrowCallout: arrowCalloutDef("down", "Callout: down arrow"),
        leftRightArrowCallout: {
            cat: "arrow", label: "Callout: left-right arrow",
            adj: {
                defaults: { adj1: 25000, adj2: 25000, adj3: 25000, adj4: 48123 },
                handles: [fit("adj1", 0, function (w, h, ss, a) { return lrCalloutGeo(w, h, a).a2 * 2; },
                    function (w, h, a) { var g = lrCalloutGeo(w, h, a); return [g.x1, g.y2]; }),
                fit("adj2", 0, function (w, h, ss) { return 50000 * h / ss; },
                    function (w, h, a) { return [0, lrCalloutGeo(w, h, a).y1]; }),
                fit("adj3", 0, function (w, h, ss) { return 50000 * w / ss; },
                    function (w, h, a) { return [lrCalloutGeo(w, h, a).x1, 0]; }),
                fit("adj4", 0, function (w, h, ss, a) { return lrCalloutGeo(w, h, a).max4; },
                    function (w, h, a) { return [lrCalloutGeo(w, h, a).x2, h]; })]
            },
            pts: function (w, h, adj) {
                var g = lrCalloutGeo(w, h, adj), vc = h / 2;
                return [[0, vc], [g.x1, g.y1], [g.x1, g.y2], [g.x2, g.y2], [g.x2, 0], [g.x3, 0],
                    [g.x3, g.y2], [g.x4, g.y2], [g.x4, g.y1], [w, vc], [g.x4, g.y4], [g.x4, g.y3],
                    [g.x3, g.y3], [g.x3, h], [g.x2, h], [g.x2, g.y3], [g.x1, g.y3], [g.x1, g.y4]];
            }
        },

        /* ---------- call outs: stars, banners, bubbles ---------- */

        star4: starDef(4, "4-point star", 0.3),
        star5: starDef(5, "5-point star", 0.42),
        star6: starDef(6, "6-point star", 0.5),
        star7: starDef(7, "7-point star", 0.55),
        star8: starDef(8, "8-point star", 0.6),
        star10: starDef(10, "10-point star", 0.68),
        star12: starDef(12, "12-point star", 0.72),
        star16: starDef(16, "16-point star", 0.78),
        star24: starDef(24, "24-point star", 0.84),
        star32: starDef(32, "32-point star", 0.88),
        irregularSeal1: {
            cat: "callout", label: "Explosion",
            pts: function (w, h) {
                var f = [[0.22, 0.14], [0.35, 0.30], [0.28, 0.0], [0.47, 0.24], [0.55, 0.06],
                    [0.60, 0.28], [0.79, 0.10], [0.74, 0.32], [1.0, 0.28], [0.83, 0.46],
                    [0.98, 0.56], [0.79, 0.60], [0.90, 0.83], [0.66, 0.70], [0.64, 1.0],
                    [0.50, 0.74], [0.36, 0.94], [0.34, 0.70], [0.12, 0.82], [0.22, 0.60],
                    [0.0, 0.56], [0.16, 0.44], [0.04, 0.30]];
                return f.map(function (p) { return [p[0] * w, p[1] * h]; });
            }
        },
        irregularSeal2: {
            cat: "callout", label: "Explosion 2",
            pts: function (w, h) {
                var f = [[0.12, 0.26], [0.28, 0.18], [0.22, 0.02], [0.42, 0.14], [0.50, 0.0],
                    [0.58, 0.16], [0.74, 0.06], [0.74, 0.24], [0.94, 0.18], [0.86, 0.36],
                    [1.0, 0.44], [0.84, 0.54], [0.96, 0.70], [0.76, 0.68], [0.80, 0.88],
                    [0.62, 0.76], [0.54, 1.0], [0.44, 0.80], [0.28, 0.92], [0.30, 0.72],
                    [0.10, 0.76], [0.20, 0.58], [0.0, 0.50], [0.18, 0.40]];
                return f.map(function (p) { return [p[0] * w, p[1] * h]; });
            }
        },
        ribbon: {
            cat: "callout", label: "Ribbon",
            pts: function (w, h) {
                var e = w * 0.14, t = h * 0.28;
                return [[0, 0], [e, h * 0.2], [0, h * 0.2], [w * 0.18, h * 0.5],
                    [0, h * 0.8], [e, h], [w * 0.18, h * 0.8],
                    [w * 0.82, h * 0.8], [w - e, h], [w, h * 0.8],
                    [w * 0.82, h * 0.5], [w, h * 0.2], [w - e, h * 0.2], [w, 0],
                    [w * 0.82, h * 0.2], [w * 0.18, h * 0.2]];
            }
        },
        ribbon2: {
            cat: "callout", label: "Banner",
            pts: function (w, h) {
                var e = w * 0.14;
                return [[0, h * 0.16], [w * 0.18, 0], [w * 0.82, 0], [w, h * 0.16],
                    [w - e, h * 0.16], [w, h * 0.4], [w * 0.82, h * 0.34],
                    [w * 0.82, h], [w * 0.5, h * 0.78], [w * 0.18, h],
                    [w * 0.18, h * 0.34], [0, h * 0.4], [e, h * 0.16]];
            }
        },
        wave: {
            cat: "callout", label: "Wave",
            adj: waveAdj(12500, 20000),
            path: function (w, h, adj) { return wavePath(w, h, adj, 12500, 20000, 1); }
        },
        doubleWave: {
            cat: "callout", label: "Double wave",
            adj: waveAdj(6250, 12500),
            path: function (w, h, adj) { return wavePath(w, h, adj, 6250, 12500, 2); }
        },
        verticalScroll: {
            cat: "callout", label: "Vertical scroll",
            path: function (w, h) {
                var t = Math.min(w, h) * 0.16;
                return P().M(t, 0).L(w - t / 2, 0)
                    .arc(w - t / 2, t / 2, t / 2, t / 2, -Math.PI / 2, Math.PI / 2)
                    .L(w - t, t).L(w - t, h).L(t / 2, h)
                    .arc(t / 2, h - t / 2, t / 2, t / 2, Math.PI / 2, Math.PI * 1.5)
                    .L(t, h - t).Z().toString();
            }
        },
        horizontalScroll: {
            cat: "callout", label: "Horizontal scroll",
            path: function (w, h) {
                var t = Math.min(w, h) * 0.16;
                return P().M(0, t).L(0, h - t / 2)
                    .arc(t / 2, h - t / 2, t / 2, t / 2, Math.PI, Math.PI * 2)
                    .L(t, h - t).L(w, h - t).L(w, t / 2)
                    .arc(w - t / 2, t / 2, t / 2, t / 2, 0, Math.PI)
                    .L(w - t, t).Z().toString();
            }
        },
        wedgeRectCallout: {
            cat: "callout", label: "Speech bubble: rectangle",
            pts: function (w, h) {
                var b = h * 0.72;
                return [[0, 0], [w, 0], [w, b], [w * 0.42, b], [w * 0.2, h],
                    [w * 0.28, b], [0, b]];
            }
        },
        wedgeRoundRectCallout: {
            cat: "callout", label: "Speech bubble: rounded",
            path: function (w, h) {
                var b = h * 0.72;
                var r = Math.min(w, b) * 0.18;
                var p = P();
                p.M(r, 0).L(w - r, 0).arc(w - r, r, r, r, -Math.PI / 2, 0)
                    .L(w, b - r).arc(w - r, b - r, r, r, 0, Math.PI / 2)
                    .L(w * 0.42, b).L(w * 0.2, h).L(w * 0.28, b)
                    .L(r, b).arc(r, b - r, r, r, Math.PI / 2, Math.PI)
                    .L(0, r).arc(r, r, r, r, Math.PI, Math.PI * 1.5);
                return p.Z().toString();
            }
        },
        wedgeEllipseCallout: {
            cat: "callout", label: "Speech bubble: oval",
            path: function (w, h) {
                // all the way round from one side of the tail's base to the
                // other, then out to the tip and back
                var cy = h * 0.36, ry = h * 0.36;
                var a1 = Math.PI * 0.60, a2 = Math.PI * 0.80;
                return P().arc(w / 2, cy, w / 2, ry, a2, a1 + Math.PI * 2, true)
                    .L(w * 0.16, h).Z().toString();
            }
        },
        cloudCallout: {
            cat: "callout", label: "Speech bubble: cloud",
            path: function (w, h) {
                var bw = w, bh = h * 0.74;
                var p = P();
                p.M(bw * 0.22, bh * 0.92)
                    .C(bw * 0.02, bh * 0.92, bw * -0.05, bh * 0.58, bw * 0.13, bh * 0.5)
                    .C(bw * 0.06, bh * 0.28, bw * 0.26, bh * 0.1, bw * 0.42, bh * 0.2)
                    .C(bw * 0.5, bh * -0.03, bw * 0.8, bh * -0.03, bw * 0.86, bh * 0.22)
                    .C(bw * 1.04, bh * 0.26, bw * 1.04, bh * 0.6, bw * 0.87, bh * 0.66)
                    .C(bw * 0.93, bh * 0.88, bw * 0.7, bh * 1.02, bw * 0.57, bh * 0.9)
                    .C(bw * 0.48, bh * 1.0, bw * 0.3, bh * 1.0, bw * 0.22, bh * 0.92)
                    .Z();
                p.circle(w * 0.22, h * 0.85, w * 0.07, h * 0.07);
                p.circle(w * 0.13, h * 0.96, w * 0.045, h * 0.045);
                return p.toString();
            }
        },

        /* ---------- equation ---------- */

        mathPlus: {
            cat: "equation", label: "Plus",
            // adj1 is the bars' thickness, in ss
            adj: {
                defaults: { adj1: 23520 },
                handles: [ssLen("adj1", 73490, function (w, h, d) { return [w / 2 - mathX(w), h / 2 - d / 2]; },
                    function (w, h, x, y) { return (h / 2 - y) * 2; })]
            },
            pts: function (w, h, adj) {
                var dx2 = Math.min(w, h) * pin(0, av(adj, "adj1", 23520), 73490) / 200000;
                var dy1 = h * 73490 / 200000, hc = w / 2, vc = h / 2;
                var x1 = hc - mathX(w), x2 = hc - dx2, x3 = hc + dx2, x4 = hc + mathX(w);
                var y1 = vc - dy1, y2 = vc - dx2, y3 = vc + dx2, y4 = vc + dy1;
                return [[x1, y2], [x2, y2], [x2, y1], [x3, y1], [x3, y2], [x4, y2], [x4, y3], [x3, y3],
                    [x3, y4], [x2, y4], [x2, y3], [x1, y3]];
            }
        },
        mathMinus: {
            cat: "equation", label: "Minus",
            adj: {
                defaults: { adj1: 23520 },
                handles: [share("adj1", "h", 100000, function (w, h, d) { return [w / 2 - mathX(w), h / 2 - d / 2]; },
                    function (w, h, x, y) { return (h / 2 - y) * 2; })]
            },
            pts: function (w, h, adj) {
                var dy1 = h * pin(0, av(adj, "adj1", 23520), 100000) / 200000;
                var x1 = w / 2 - mathX(w), x2 = w / 2 + mathX(w);
                return [[x1, h / 2 - dy1], [x2, h / 2 - dy1], [x2, h / 2 + dy1], [x1, h / 2 + dy1]];
            }
        },
        mathMultiply: {
            cat: "equation", label: "Multiply",
            // adj1 is the arms' thickness, in ss; they run along the diagonals
            adj: {
                defaults: { adj1: 23520 },
                handles: [fit("adj1", 0, 51965, function (w, h, a) { var g = mathMulGeo(w, h, a); return [g.xB, g.yB]; })]
            },
            pts: function (w, h, adj) {
                var g = mathMulGeo(w, h, adj), hc = w / 2, vc = h / 2;
                return [[g.xA, g.yA], [g.xB, g.yB], [hc, g.yC], [g.xD, g.yB], [g.xE, g.yA], [g.xF, vc],
                    [g.xE, h - g.yA], [g.xD, h - g.yB], [hc, h - g.yC], [g.xB, h - g.yB], [g.xA, h - g.yA],
                    [g.xL, vc]];
            }
        },
        mathDivide: {
            cat: "equation", label: "Divide",
            // adj1 the bar, adj2 the gap to the dots, adj3 the dots' radius
            adj: {
                defaults: { adj1: 23520, adj2: 5880, adj3: 11760 },
                handles: [fit("adj1", 1000, 36745, function (w, h, a) { var g = mathDivGeo(w, h, a); return [g.x1, g.y3]; }),
                fit("adj2", 0, function (w, h, ss, a) { return mathDivGeo(w, h, a).max2; },
                    function (w, h, a) { return [w / 2, mathDivGeo(w, h, a).y2]; }),
                fit("adj3", 1000, function (w, h, ss, a) { return mathDivGeo(w, h, a).max3; },
                    function (w, h, a) { var g = mathDivGeo(w, h, a); return [w / 2 - g.rad, g.y1 + g.rad]; })]
            },
            path: function (w, h, adj) {
                var g = mathDivGeo(w, h, adj), hc = w / 2;
                return P().circle(hc, g.y1 + g.rad, g.rad, g.rad).toString() +
                    P().circle(hc, h - g.y1 - g.rad, g.rad, g.rad).toString() +
                    P().poly([[g.x1, g.y3], [g.x3, g.y3], [g.x3, g.y4], [g.x1, g.y4]]).toString();
            }
        },
        mathEqual: {
            cat: "equation", label: "Equal",
            adj: {
                defaults: { adj1: 23520, adj2: 11760 },
                handles: [fit("adj1", 0, 36745, function (w, h, a) { var g = mathEqGeo(w, h, a, "adj2"); return [g.x2, g.y1]; }),
                fit("adj2", 0, function (w, h, ss, a) { return mathEqGeo(w, h, a, "adj2").max2; },
                    function (w, h, a) { var g = mathEqGeo(w, h, a, "adj2"); return [g.x1, g.y2]; })]
            },
            path: function (w, h, adj) {
                var g = mathEqGeo(w, h, adj, "adj2");
                return P().poly([[g.x1, g.y1], [g.x2, g.y1], [g.x2, g.y2], [g.x1, g.y2]]).toString() +
                    P().poly([[g.x1, g.y3], [g.x2, g.y3], [g.x2, g.y4], [g.x1, g.y4]]).toString();
            }
        },
        mathNotEqual: {
            cat: "equation", label: "Not equal",
            /* The bars and the stroke are wound the same way and filled
               non-zero, so where they cross is filled rather than punched
               out. adj1 the bars, adj3 their gap, adj2 the stroke's angle. */
            adj: {
                defaults: { adj1: 23520, adj2: 6600000, adj3: 11760 },
                handles: [fit("adj1", 0, 50000, function (w, h, a) { var g = mathEqGeo(w, h, a, "adj3"); return [g.x2, g.y1]; }),
                fit("adj2", 4200000, 6600000, function (w, h, a) {
                    return [notEqSlash(w, h, a, mathEqGeo(w, h, a, "adj3").dy1).top, 0];
                }),
                fit("adj3", 0, function (w, h, ss, a) { return mathEqGeo(w, h, a, "adj3").max2; },
                    function (w, h, a) { var g = mathEqGeo(w, h, a, "adj3"); return [g.x1, g.y2]; })]
            },
            path: function (w, h, adj) {
                var g = mathEqGeo(w, h, adj, "adj3");
                var sl = notEqSlash(w, h, adj, g.dy1), bot = w - sl.top, b2 = sl.bhw / 2;
                return P().poly([[g.x1, g.y1], [g.x2, g.y1], [g.x2, g.y2], [g.x1, g.y2]]).toString() +
                    P().poly([[g.x1, g.y3], [g.x2, g.y3], [g.x2, g.y4], [g.x1, g.y4]]).toString() +
                    P().poly([[sl.top - b2, 0], [sl.top + b2, 0], [bot + b2, h], [bot - b2, h]]).toString();
            }
        },
        leftBracket: {
            cat: "equation", size: [70, 220], label: "Left bracket",
            open: true,
            // adj is how far the curls run, in ss
            adj: {
                defaults: { adj: 8333 },
                handles: [ssLen("adj", hCap(50000), function (w, h, d) { return [0, d]; },
                    function (w, h, x, y) { return y; })]
            },
            path: function (w, h, adj) {
                var ss = Math.min(w, h), y1 = ss * pin(0, av(adj, "adj", 8333), 50000 * h / ss) / 100000;
                return P().M(w, h).arcTo(w, y1, Math.PI / 2, Math.PI / 2).L(0, y1)
                    .arcTo(w, y1, Math.PI, Math.PI / 2).toString();
            }
        },
        rightBracket: {
            cat: "equation", size: [70, 220], label: "Right bracket",
            open: true,
            adj: {
                defaults: { adj: 8333 },
                handles: [ssLen("adj", hCap(50000), function (w, h, d) { return [w, d]; },
                    function (w, h, x, y) { return y; })]
            },
            path: function (w, h, adj) {
                var ss = Math.min(w, h), y1 = ss * pin(0, av(adj, "adj", 8333), 50000 * h / ss) / 100000;
                return P().M(0, 0).arcTo(w, y1, Math.PI * 1.5, Math.PI / 2).L(w, h - y1)
                    .arcTo(w, y1, 0, Math.PI / 2).toString();
            }
        },
        bracketPair: {
            cat: "equation", size: [70, 220], label: "Bracket pair",
            open: true,
            // the two sides of a rounded rectangle; adj is its corner, in ss
            adj: {
                defaults: { adj: 16667 },
                handles: [ssLen("adj", 50000, function (w, h, d) { return [0, d]; },
                    function (w, h, x, y) { return y; })]
            },
            path: function (w, h, adj) {
                var r = Math.min(w, h) * pin(0, av(adj, "adj", 16667), 50000) / 100000, H = Math.PI / 2;
                return P().M(r, h).arcTo(r, r, H, H).L(0, r).arcTo(r, r, Math.PI, H).toString() +
                    P().M(w - r, 0).arcTo(r, r, Math.PI * 1.5, H).L(w, h - r).arcTo(r, r, 0, H).toString();
            }
        },
        rightBrace: {
            cat: "equation", size: [70, 220], label: "Right brace",
            open: true,
            // adj1 how far the curls run (in ss), adj2 where the point is
            adj: {
                defaults: { adj1: 8333, adj2: 50000 },
                handles: [fit("adj1", 0, function (w, h, ss, a) { return braceGeo(w, h, a).max1; },
                    function (w, h, a) { return [w / 2, braceGeo(w, h, a).y1]; }),
                share("adj2", "h", 100000, function (w, h, d) { return [w, d]; },
                    function (w, h, x, y) { return y; })]
            },
            path: function (w, h, adj) {
                return mapPath(bracePath(w, h, adj), function (x, y) { return [w - x, y]; });
            }
        },
        leftBrace: {
            cat: "equation", size: [70, 220], label: "Left brace",
            open: true,
            adj: {
                defaults: { adj1: 8333, adj2: 50000 },
                handles: [fit("adj1", 0, function (w, h, ss, a) { return braceGeo(w, h, a).max1; },
                    function (w, h, a) { return [w / 2, braceGeo(w, h, a).y1]; }),
                share("adj2", "h", 100000, function (w, h, d) { return [0, d]; },
                    function (w, h, x, y) { return y; })]
            },
            path: function (w, h, adj) { return bracePath(w, h, adj); }
        },
        bracePair: {
            cat: "equation", size: [70, 220], label: "Brace pair",
            open: true,
            // adj is how far the curls run, in ss
            adj: {
                defaults: { adj: 8333 },
                handles: [ssLen("adj", 25000, function (w, h, d) { return [0, d]; },
                    function (w, h, x, y) { return y; })]
            },
            path: function (w, h, adj) {
                var r = Math.min(w, h) * pin(0, av(adj, "adj", 8333), 25000) / 100000, H = Math.PI / 2;
                var vc = h / 2;
                return P().M(2 * r, h).arcTo(r, r, H, H).L(r, vc + r).arcTo(r, r, 0, -H)
                    .arcTo(r, r, H, -H).L(r, r).arcTo(r, r, Math.PI, H).toString() +
                    P().M(w - 2 * r, 0).arcTo(r, r, Math.PI * 1.5, H).L(w - r, vc - r)
                    .arcTo(r, r, Math.PI, -H).arcTo(r, r, Math.PI * 1.5, -H).L(w - r, h - r)
                    .arcTo(r, r, 0, H).toString();
            }
        }
    };

    /* ---------------- names documents may still carry ---------------- */

    /* Three shapes had editor-invented names before the catalogue existed.
       They are gone; these are what a deck written back then says, and the
       only place that still knows. normalizeBody() in slides.js runs every
       kind through canonical() as a document loads, so a deck is rewritten
       to the catalogue's names the first time it is opened and these never
       have to be thought about again. */
    var ALIASES = {
        round: "roundRect",
        arrow: "rightArrow",
        star: "star5"
    };

    function canonical(kind) {
        var k = String(kind || "").trim();
        if (!k) return "rect";
        if (DEFS[k]) return k;
        if (ALIASES[k]) return ALIASES[k];
        return k;
    }

    function def(kind) { return DEFS[canonical(kind)] || null; }

    function points(kind, w, h, adj) {
        var d = def(kind);
        return d && d.pts ? d.pts(w, h, adj) : null;
    }

    /* A preset's own adjustment handles (see ssLen): where each sits in a
       w x h frame, and the adjustments that result from dragging one of
       them to (x, y). The result always states every guide the preset has,
       so what is written to .pptx never leans on a default. The callouts'
       tips and a rounded rectangle's radius are not in here: those are
       older and slides.js handles them itself (adjustable()). */
    function resolvedAdj(d, adj) {
        var out = {};
        Object.keys(d.adj.defaults).forEach(function (k) {
            var v = adj ? Number(adj[k]) : NaN;
            out[k] = isFinite(v) ? v : d.adj.defaults[k];
        });
        return out;
    }
    function handles(kind, w, h, adj) {
        var d = def(kind);
        if (!d || !d.adj || !(w > 0) || !(h > 0)) return [];
        var a = resolvedAdj(d, adj);
        return d.adj.handles.map(function (hd) { return hd.pos(w, h, a); });
    }
    function dragHandle(kind, i, w, h, x, y, adj) {
        var d = def(kind);
        if (!d || !d.adj || !d.adj.handles[i]) return adj || null;
        var out = resolvedAdj(d, adj);
        var set = d.adj.handles[i].set(w, h, x, y, out);
        Object.keys(set).forEach(function (k) { if (isFinite(set[k])) out[k] = set[k]; });
        return out;
    }

    /* ---------------- adjustments ----------------
       A preset's adjustments, named and scaled as PresentationML's (adj1,
       adj2, ... in 1/100000 of the frame). The speech-bubble callouts are
       drawn the way PowerPoint defines them whenever the object carries
       props.adj: the body fills the frame and the tail runs out to the tip
       at (centre + adj1 * w, centre + adj2 * h), which may well lie outside
       the frame. A callout with no adj was made before adjustments existed
       and keeps the shape it was drawn with (body in the top ~72%, tip at
       the bottom) until its handle is first dragged - see legacyTip. */
    var TIP_DEFAULTS = {
        wedgeRectCallout: { adj1: -20833, adj2: 62500 },
        wedgeRoundRectCallout: { adj1: -20833, adj2: 62500, adj3: 16667 },
        wedgeEllipseCallout: { adj1: -20833, adj2: 62500 },
        cloudCallout: { adj1: -20833, adj2: 62500 }
    };
    // where the old, unadjusted drawings put the tip and how much of the
    // frame their body took
    var LEGACY_TIP = {
        wedgeRectCallout: { tip: [0.2, 1], body: 0.72, round: 0 },
        wedgeRoundRectCallout: { tip: [0.2, 1], body: 0.72, round: 0.18 },
        wedgeEllipseCallout: { tip: [0.16, 1], body: 0.72, round: 0 },
        cloudCallout: { tip: [0.13, 0.96], body: 0.74, round: 0 }
    };
    function adjOf(kind, adj) {
        var out = {}, d = TIP_DEFAULTS[kind] || {};
        Object.keys(d).forEach(function (k) { out[k] = d[k]; });
        Object.keys(adj || {}).forEach(function (k) {
            var v = Number(adj[k]);
            if (isFinite(v)) out[k] = v;
        });
        return out;
    }
    function tipPoint(kind, w, h, adj) {
        var a = adjOf(kind, adj);
        return [w / 2 + a.adj1 * w / 100000, h / 2 + a.adj2 * h / 100000];
    }
    /* The tail of a rectangular callout, as presetShapeDefinitions puts it:
       it leaves the side the tip is furthest beyond (measured in the
       frame's own proportions) between 2/12 and 5/12 of that side, or 7/12
       and 10/12 when the tip is past the middle. Every side gets a tail
       vertex; on the three that do not carry the tail it lies on the side
       itself. */
    function wedgeSides(w, h, a) {
        var dxPos = w * a.adj1 / 100000, dyPos = h * a.adj2 / 100000;
        var xPos = w / 2 + dxPos, yPos = h / 2 + dyPos;
        var dq = dxPos * h / w;
        var dz = Math.abs(dyPos) - Math.abs(dq);   // > 0: the tip is above or below
        var x1 = w * (dxPos > 0 ? 7 : 2) / 12, x2 = w * (dxPos > 0 ? 10 : 5) / 12;
        var y1 = h * (dyPos > 0 ? 7 : 2) / 12, y2 = h * (dyPos > 0 ? 10 : 5) / 12;
        var q = function (c, a1, b1) { return c > 0 ? a1 : b1; };
        return {
            x1: x1, x2: x2, y1: y1, y2: y2,
            xt: q(dz, q(dyPos, x1, xPos), x1), yt: q(dz, q(dyPos, 0, yPos), 0),
            xr: q(dz, w, q(dxPos, xPos, w)), yr: q(dz, y1, q(dxPos, yPos, y1)),
            xb: q(dz, q(dyPos, xPos, x1), x1), yb: q(dz, q(dyPos, yPos, h), h),
            xl: q(dz, 0, q(dxPos, 0, xPos)), yl: q(dz, y1, q(dxPos, y1, yPos))
        };
    }
    function adjustedPath(kind, w, h, adj) {
        var a = adjOf(kind, adj);
        var e, t;
        if (kind === "wedgeRectCallout") {
            e = wedgeSides(w, h, a);
            return P().poly([[0, 0], [e.x1, 0], [e.xt, e.yt], [e.x2, 0], [w, 0], [w, e.y1],
                [e.xr, e.yr], [w, e.y2], [w, h], [e.x2, h], [e.xb, e.yb], [e.x1, h], [0, h],
                [0, e.y2], [e.xl, e.yl], [0, e.y1]]).toString();
        }
        if (kind === "wedgeRoundRectCallout") {
            e = wedgeSides(w, h, a);
            var u = Math.min(w, h) * Math.max(0, Math.min(50000, a.adj3)) / 100000;
            var p = P();
            p.M(u, 0).L(e.x1, 0).L(e.xt, e.yt).L(e.x2, 0).L(w - u, 0)
                .arc(w - u, u, u, u, -Math.PI / 2, 0)
                .L(w, e.y1).L(e.xr, e.yr).L(w, e.y2).L(w, h - u)
                .arc(w - u, h - u, u, u, 0, Math.PI / 2)
                .L(e.x2, h).L(e.xb, e.yb).L(e.x1, h).L(u, h)
                .arc(u, h - u, u, u, Math.PI / 2, Math.PI)
                .L(0, e.y2).L(e.xl, e.yl).L(0, e.y1).L(0, u)
                .arc(u, u, u, u, Math.PI, Math.PI * 1.5);
            return p.Z().toString();
        }
        if (kind === "wedgeEllipseCallout") {
            // the tail leaves the ellipse 11 degrees either side of the
            // direction of the tip, and the outline goes the long way round
            t = tipPoint(kind, w, h, a);
            var pang = Math.atan2((t[1] - h / 2) * w, (t[0] - w / 2) * h);
            var gap = 11 * Math.PI / 180;
            return P().arc(w / 2, h / 2, w / 2, h / 2, pang + gap, pang - gap + Math.PI * 2, true)
                .L(t[0], t[1]).Z().toString();
        }
        if (kind === "cloudCallout") {
            var c = P();
            c.M(w * 0.22, h * 0.92)
                .C(w * 0.02, h * 0.92, w * -0.05, h * 0.58, w * 0.13, h * 0.5)
                .C(w * 0.06, h * 0.28, w * 0.26, h * 0.1, w * 0.42, h * 0.2)
                .C(w * 0.5, h * -0.03, w * 0.8, h * -0.03, w * 0.86, h * 0.22)
                .C(w * 1.04, h * 0.26, w * 1.04, h * 0.6, w * 0.87, h * 0.66)
                .C(w * 0.93, h * 0.88, w * 0.7, h * 1.02, w * 0.57, h * 0.9)
                .C(w * 0.48, h * 1.0, w * 0.3, h * 1.0, w * 0.22, h * 0.92)
                .Z();
            // three bubbles from the edge of the cloud out to the tip
            t = tipPoint(kind, w, h, a);
            var dx = t[0] - w / 2, dy = t[1] - h / 2;
            var reach = Math.sqrt(Math.pow(dx / (w / 2), 2) + Math.pow(dy / (h / 2), 2));
            if (reach > 1) {
                var ex = w / 2 + dx / reach, ey = h / 2 + dy / reach;
                var ss = Math.min(w, h);
                [[0.3, 0.09], [0.65, 0.06], [1, 0.035]].forEach(function (b) {
                    c.circle(ex + (t[0] - ex) * b[0], ey + (t[1] - ey) * b[0], ss * b[1], ss * b[1]);
                });
            }
            return c.toString();
        }
        return "";
    }

    function path(kind, w, h, adj) {
        var d = def(kind);
        if (!d) return "";
        if (adj && TIP_DEFAULTS[kind]) return adjustedPath(kind, w, h, adj);
        // presets that follow PowerPoint's formulas take the adjustments a
        // deck states for them; the rest ignore the extra argument
        if (d.pts) return P().poly(d.pts(w, h, adj)).toString();
        return d.path(w, h, adj);
    }

    /* customPath draws a "custom" shape (an imported freeform, props.geom):
       each path is stored in its own w x h space as M / L / C / Z, the same
       vocabulary as the catalogue, and is stretched over the frame here. */
    function customPath(geom, w, h, which) {
        if (!geom || !Array.isArray(geom.paths)) return "";
        var out = "";
        geom.paths.forEach(function (gp) {
            if (which === "fill" && gp.noFill) return;
            if (which === "stroke" && gp.noStroke) return;
            var kx = w / (Number(gp.w) || 1), ky = h / (Number(gp.h) || 1);
            var re = /([MLCZ])([^MLCZ]*)/g, m;
            while ((m = re.exec(String(gp.d || "")))) {
                var nums = m[2].trim() ? m[2].trim().split(/[\s,]+/).map(Number) : [];
                out += m[1];
                for (var i = 0; i + 1 < nums.length; i += 2) {
                    out += (i ? " " : "") + (nums[i] * kx).toFixed(2) + " " + (nums[i + 1] * ky).toFixed(2);
                }
            }
        });
        return out;
    }

    function detail(kind, w, h, adj) {
        var d = def(kind);
        return d && d.detail ? d.detail(w, h, adj) : "";
    }

    /* defaultSize is the box a shape is inserted at. Most want the editor's
       usual one; a brace or a bracket only reads as itself when it is tall
       and narrow, so those say so. */
    function defaultSize(kind) {
        var d = def(kind);
        return (d && d.size) ? d.size.slice() : null;
    }

    /* icon draws a shape as a small outline for a picker, from the very
       same geometry the canvas uses - so an icon cannot come to disagree
       with what choosing it actually inserts. */
    function icon(kind, size) {
        var s = size || 22, pad = 2;
        var w = s - pad * 2, h = s - pad * 2;
        var k = canonical(kind);
        var body = '<path d="' + path(k, w, h) + '"' +
            (evenOdd(k) ? ' fill-rule="evenodd"' : "") + "/>";
        var det = detail(k, w, h);
        if (det) body += '<path d="' + det + '"/>';
        return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 ' + s + " " + s + '" ' +
            'fill="none" stroke="currentColor" stroke-width="1.3" ' +
            'stroke-linejoin="round"><g transform="translate(' + pad + "," + pad + ')">' +
            body + "</g></svg>";
    }

    // a freeform fills its inner subpaths as holes, as PowerPoint does
    function evenOdd(kind) { if (kind === "custom") return true; var d = def(kind); return !!(d && d.evenOdd); }

    var CATEGORIES = [
        { id: "shape", label: "Shapes", icon: "square outline" },
        { id: "arrow", label: "Arrows", icon: "long arrow alternate right" },
        { id: "callout", label: "Call outs", icon: "comment outline" },
        { id: "equation", label: "Equation", icon: "plus" }
    ];
    CATEGORIES.forEach(function (c) {
        c.kinds = Object.keys(DEFS).filter(function (k) { return DEFS[k].cat === c.id; });
    });

    return {
        CATEGORIES: CATEGORIES,
        canonical: canonical,
        has: function (kind) { return !!def(kind); },
        label: function (kind) { var d = def(kind); return d ? d.label : "Shape"; },
        category: function (kind) { var d = def(kind); return d ? d.cat : ""; },
        evenOdd: evenOdd,
        icon: icon,
        isOpen: function (kind) { var d = def(kind); return !!(d && d.open); },
        customPath: customPath,
        points: points,
        path: path,
        // adjustments (see TIP_DEFAULTS): "tip" for the speech-bubble
        // callouts, "radius" for a rounded rectangle, "" for the rest
        adjustable: function (kind) {
            kind = canonical(kind);
            return TIP_DEFAULTS[kind] ? "tip" : (kind === "roundRect" ? "radius" : "");
        },
        tipDefaults: function (kind) { return adjOf(canonical(kind), null); },
        handles: handles,
        dragHandle: dragHandle,
        tipPoint: function (kind, w, h, adj) { return tipPoint(canonical(kind), w, h, adj); },
        legacyTip: function (kind) { return LEGACY_TIP[canonical(kind)] || null; },
        detail: detail,
        defaultSize: defaultSize
    };
})();
