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
        SlidesShapes.path(kind, w, h)   // "M0 0L100 0..." ("" if unknown)
        SlidesShapes.detail(kind, w, h) // markings to stroke, or ""
        SlidesShapes.points(kind, w, h) // polygon corners, or null
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

    function Path() { this.s = ""; }
    Path.prototype.M = function (x, y) { this.s += "M" + r2(x) + " " + r2(y); return this; };
    Path.prototype.L = function (x, y) { this.s += "L" + r2(x) + " " + r2(y); return this; };
    Path.prototype.C = function (x1, y1, x2, y2, x, y) {
        this.s += "C" + r2(x1) + " " + r2(y1) + " " + r2(x2) + " " + r2(y2) +
            " " + r2(x) + " " + r2(y);
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
        snip1Rect: {
            cat: "shape", label: "Snip single corner",
            pts: function (w, h) {
                var s = Math.min(w, h) * 0.18;
                return [[0, 0], [w - s, 0], [w, s], [w, h], [0, h]];
            }
        },
        snip2SameRect: {
            cat: "shape", label: "Snip same side corners",
            pts: function (w, h) {
                var s = Math.min(w, h) * 0.18;
                return [[s, 0], [w - s, 0], [w, s], [w, h], [0, h], [0, s]];
            }
        },
        snip2DiagRect: {
            cat: "shape", label: "Snip diagonal corners",
            pts: function (w, h) {
                var s = Math.min(w, h) * 0.18;
                return [[s, 0], [w, 0], [w, h - s], [w - s, h], [0, h], [0, s]];
            }
        },
        round1Rect: {
            cat: "shape", label: "Round single corner",
            path: function (w, h) {
                var r = Math.min(w, h) * 0.28;
                return roundRectPath(w, h, 0, r, 0, 0);
            }
        },
        round2SameRect: {
            cat: "shape", label: "Round same side corners",
            path: function (w, h) {
                var r = Math.min(w, h) * 0.28;
                return roundRectPath(w, h, r, r, 0, 0);
            }
        },
        round2DiagRect: {
            cat: "shape", label: "Round diagonal corners",
            path: function (w, h) {
                var r = Math.min(w, h) * 0.28;
                return roundRectPath(w, h, r, 0, r, 0);
            }
        },
        ellipse: {
            cat: "shape", label: "Ellipse",
            path: function (w, h) { return P().circle(w / 2, h / 2, w / 2, h / 2).toString(); }
        },
        triangle: {
            cat: "shape", label: "Triangle",
            pts: function (w, h) { return [[w / 2, 0], [w, h], [0, h]]; }
        },
        rtTriangle: {
            cat: "shape", label: "Right triangle",
            pts: function (w, h) { return [[0, 0], [w, h], [0, h]]; }
        },
        parallelogram: {
            cat: "shape", label: "Parallelogram",
            pts: function (w, h) { return [[w * 0.25, 0], [w, 0], [w * 0.75, h], [0, h]]; }
        },
        trapezoid: {
            cat: "shape", label: "Trapezoid",
            pts: function (w, h) { return [[w * 0.25, 0], [w * 0.75, 0], [w, h], [0, h]]; }
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
            pts: function (w, h) {
                return [[w * 0.25, 0], [w * 0.75, 0], [w, h / 2],
                    [w * 0.75, h], [w * 0.25, h], [0, h / 2]];
            }
        },
        heptagon: {
            cat: "shape", label: "Heptagon",
            pts: function (w, h) { return ngon(w, h, 7); }
        },
        octagon: {
            cat: "shape", label: "Octagon",
            pts: function (w, h) {
                var s = Math.min(w, h) * 0.29;
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
            pts: function (w, h) {
                return [[w * 0.35, 0], [w * 0.65, 0], [w * 0.65, h * 0.35], [w, h * 0.35],
                    [w, h * 0.65], [w * 0.65, h * 0.65], [w * 0.65, h], [w * 0.35, h],
                    [w * 0.35, h * 0.65], [0, h * 0.65], [0, h * 0.35], [w * 0.35, h * 0.35]];
            }
        },
        teardrop: {
            cat: "shape", label: "Teardrop",
            // three quarters of a circle, the last quarter pulled out to the
            // corner it points at
            path: function (w, h) {
                return P().arc(w / 2, h / 2, w / 2, h / 2, 0, Math.PI * 1.5, true)
                    .L(w, 0).Z().toString();
            }
        },
        frame: {
            cat: "shape", label: "Frame",
            evenOdd: true,
            path: function (w, h) {
                var t = Math.min(w, h) * 0.14;
                return P().poly([[0, 0], [w, 0], [w, h], [0, h]]).toString() +
                    P().poly([[t, t], [t, h - t], [w - t, h - t], [w - t, t]]).toString();
            }
        },
        halfFrame: {
            cat: "shape", label: "Half frame",
            pts: function (w, h) {
                var t = Math.min(w, h) * 0.16;
                return [[0, 0], [w, 0], [w - t, t], [t, t], [t, h - t], [0, h]];
            }
        },
        corner: {
            cat: "shape", label: "L shape",
            pts: function (w, h) {
                var t = Math.min(w, h) * 0.33;
                return [[0, 0], [t, 0], [t, h - t], [w, h - t], [w, h], [0, h]];
            }
        },
        diagStripe: {
            cat: "shape", label: "Diagonal stripe",
            pts: function (w, h) { return [[0, h * 0.5], [w * 0.5, 0], [w, 0], [0, h]]; }
        },
        plaque: {
            cat: "shape", label: "Plaque",
            path: function (w, h) {
                var r = Math.min(w, h) * 0.16;
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
            path: function (w, h) {
                var ry = Math.min(h * 0.18, w * 0.5);
                var p = P();
                p.M(0, ry).arc(w / 2, ry, w / 2, ry, Math.PI, Math.PI * 2)
                    .L(w, h - ry)
                    .arc(w / 2, h - ry, w / 2, ry, 0, Math.PI)
                    .Z();
                return p.toString();
            },
            detail: function (w, h) {
                var ry = Math.min(h * 0.18, w * 0.5);
                return P().arc(w / 2, ry, w / 2, ry, 0, Math.PI, true).toString();
            }
        },
        cube: {
            cat: "shape", label: "Cube",
            path: function (w, h) {
                var d = Math.min(w, h) * 0.25;
                return P().poly([[0, d], [d, 0], [w, 0], [w, h - d], [w - d, h], [0, h]]).toString();
            },
            detail: function (w, h) {
                var d = Math.min(w, h) * 0.25;
                return P().M(0, d).L(w - d, d).L(w, 0).toString() +
                    P().M(w - d, d).L(w - d, h).toString();
            }
        },
        bevel: {
            cat: "shape", label: "Bevel",
            evenOdd: true,
            path: function (w, h) {
                var t = Math.min(w, h) * 0.14;
                return P().poly([[0, 0], [w, 0], [w, h], [0, h]]).toString() +
                    P().poly([[t, t], [w - t, t], [w - t, h - t], [t, h - t]]).toString();
            },
            detail: function (w, h) {
                var t = Math.min(w, h) * 0.14;
                return P().M(0, 0).L(t, t).toString() +
                    P().M(w, 0).L(w - t, t).toString() +
                    P().M(w, h).L(w - t, h - t).toString() +
                    P().M(0, h).L(t, h - t).toString();
            }
        },
        donut: {
            cat: "shape", label: "Donut",
            evenOdd: true,
            path: function (w, h) {
                return P().circle(w / 2, h / 2, w / 2, h / 2).toString() +
                    P().circle(w / 2, h / 2, w * 0.3, h * 0.3).toString();
            }
        },
        noSmoking: {
            cat: "shape", label: "\"No\" symbol",
            /* Not even-odd: the ring's hole comes from winding the inner
               circle the other way, which leaves the bar free to fill right
               across it. Even-odd would punch the bar out again wherever it
               crosses the ring. */
            path: function (w, h) {
                var t = Math.min(w, h) * 0.09;
                var a = Math.PI / 4;
                var dx = t * Math.sin(a), dy = t * Math.cos(a);
                var rx = w * 0.36, ry = h * 0.36;
                var x0 = w / 2 - rx * Math.cos(a), y0 = h / 2 + ry * Math.sin(a);
                var x1 = w / 2 + rx * Math.cos(a), y1 = h / 2 - ry * Math.sin(a);
                return P().circle(w / 2, h / 2, w / 2, h / 2).toString() +
                    P().arc(w / 2, h / 2, rx, ry, 2 * Math.PI, 0, true).Z().toString() +
                    P().poly([[x0 - dx, y0 - dy], [x1 - dx, y1 - dy],
                        [x1 + dx, y1 + dy], [x0 + dx, y0 + dy]]).toString();
            }
        },
        blockArc: {
            cat: "shape", label: "Block arc",
            path: function (w, h) {
                var a0 = Math.PI, a1 = 2 * Math.PI;
                var p = P();
                p.arc(w / 2, h / 2, w / 2, h / 2, a0, a1, true);
                p.arc(w / 2, h / 2, w * 0.3, h * 0.3, a1, a0);
                return p.Z().toString();
            }
        },
        foldedCorner: {
            cat: "shape", label: "Folded corner",
            path: function (w, h) {
                var f = Math.min(w, h) * 0.22;
                return P().poly([[0, 0], [w, 0], [w, h - f], [w - f, h], [0, h]]).toString();
            },
            detail: function (w, h) {
                var f = Math.min(w, h) * 0.22;
                return P().M(w, h - f).L(w - f, h - f).L(w - f, h).toString();
            }
        },
        smileyFace: {
            cat: "shape", label: "Smiley face",
            evenOdd: true,
            path: function (w, h) {
                var eyeR = Math.min(w, h) * 0.055;
                var mouth = P();
                mouth.arc(w / 2, h * 0.44, w * 0.29, h * 0.29, Math.PI * 0.22, Math.PI * 0.78, true);
                mouth.arc(w / 2, h * 0.40, w * 0.29, h * 0.29, Math.PI * 0.78, Math.PI * 0.22);
                return P().circle(w / 2, h / 2, w / 2, h / 2).toString() +
                    P().circle(w * 0.33, h * 0.36, eyeR, eyeR).toString() +
                    P().circle(w * 0.67, h * 0.36, eyeR, eyeR).toString() +
                    mouth.Z().toString();
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
            // eight rays off a disc: the ring of "mid" points is the disc
            pts: function (w, h) {
                var cx = w / 2, cy = h / 2, mid = 0.62;
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
            path: function (w, h) {
                return P().M(w, 0)
                    .C(w * 0.2, h * 0.1, w * 0.2, h * 0.9, w, h)
                    .C(w * 0.55, h * 0.78, w * 0.55, h * 0.22, w, 0)
                    .Z().toString();
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
            path: function (w, h) {
                return P().arc(w / 2, h / 2, w / 2, h / 2, Math.PI * 1.5, Math.PI * 2, true).toString();
            }
        },
        chord: {
            cat: "shape", label: "Chord",
            path: function (w, h) {
                return P().arc(w / 2, h / 2, w / 2, h / 2, Math.PI * 1.25, Math.PI * 2.25, true)
                    .Z().toString();
            }
        },
        pie: {
            cat: "shape", label: "Pie",
            path: function (w, h) {
                return P().M(w / 2, h / 2)
                    .arc(w / 2, h / 2, w / 2, h / 2, Math.PI * 1.5, Math.PI * 3)
                    .Z().toString();
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
            cat: "arrow", label: "Arrow: right",
            pts: function (w, h) { return arrowPts(w, h, 0.38, 0.4); }
        },
        leftArrow: {
            cat: "arrow", label: "Arrow: left",
            pts: function (w, h) { return rotPts(arrowPts(w, h, 0.38, 0.4), w, h, 2); }
        },
        upArrow: {
            cat: "arrow", label: "Arrow: up",
            pts: function (w, h) { return rotPts(arrowPts(w, h, 0.38, 0.4), w, h, 3); }
        },
        downArrow: {
            cat: "arrow", label: "Arrow: down",
            pts: function (w, h) { return rotPts(arrowPts(w, h, 0.38, 0.4), w, h, 1); }
        },
        leftRightArrow: {
            cat: "arrow", label: "Arrow: left-right",
            pts: function (w, h) {
                var t = h * 0.3, a = w * 0.25;
                return [[0, h / 2], [a, 0], [a, t], [w - a, t], [w - a, 0], [w, h / 2],
                    [w - a, h], [w - a, h - t], [a, h - t], [a, h]];
            }
        },
        upDownArrow: {
            cat: "arrow", label: "Arrow: up-down",
            pts: function (w, h) {
                var t = w * 0.3, a = h * 0.25;
                return [[w / 2, 0], [w, a], [w - t, a], [w - t, h - a], [w, h - a], [w / 2, h],
                    [0, h - a], [t, h - a], [t, a], [0, a]];
            }
        },
        quadArrow: {
            cat: "arrow", label: "Arrow: quad",
            pts: function (w, h) {
                var m = Math.min(w, h);
                var t = m * 0.13, hw = m * 0.26, hl = m * 0.26;
                var cx = w / 2, cy = h / 2;
                return [[cx, 0], [cx + hw, hl], [cx + t, hl], [cx + t, cy - t],
                    [w - hl, cy - t], [w - hl, cy - hw], [w, cy], [w - hl, cy + hw],
                    [w - hl, cy + t], [cx + t, cy + t], [cx + t, h - hl], [cx + hw, h - hl],
                    [cx, h], [cx - hw, h - hl], [cx - t, h - hl], [cx - t, cy + t],
                    [hl, cy + t], [hl, cy + hw], [0, cy], [hl, cy - hw],
                    [hl, cy - t], [cx - t, cy - t], [cx - t, hl], [cx - hw, hl]];
            }
        },
        leftRightUpArrow: {
            cat: "arrow", label: "Arrow: left-right-up",
            pts: function (w, h) {
                var cy = h * 0.78, t = h * 0.2, hh = h * 0.22, hl = w * 0.14;
                var t2 = w * 0.12, vh = h * 0.3, vhw = w * 0.18;
                return [[w / 2, 0], [w / 2 + vhw, vh], [w / 2 + t2 / 2, vh],
                    [w / 2 + t2 / 2, cy - t / 2], [w - hl, cy - t / 2], [w - hl, cy - hh],
                    [w, cy], [w - hl, cy + hh], [w - hl, cy + t / 2],
                    [hl, cy + t / 2], [hl, cy + hh], [0, cy], [hl, cy - hh],
                    [hl, cy - t / 2], [w / 2 - t2 / 2, cy - t / 2],
                    [w / 2 - t2 / 2, vh], [w / 2 - vhw, vh]];
            }
        },
        bentArrow: {
            cat: "arrow", label: "Arrow: bent",
            // runs right along the bottom, turns up, head at the top
            pts: function (w, h) {
                var cx = w * 0.7, hw = w * 0.3, t = h * 0.26, hh = h * 0.32;
                return [[0, h], [0, h - t], [cx - t / 2, h - t], [cx - t / 2, hh],
                    [cx - hw, hh], [cx, 0], [cx + hw, hh], [cx + t / 2, hh],
                    [cx + t / 2, h]];
            }
        },
        uturnArrow: {
            cat: "arrow", label: "Arrow: U-turn",
            path: function (w, h) {
                var t = Math.min(w, h) * 0.22;
                var cx = w * 0.62, r = w * 0.38;
                return P().M(0, h)
                    .L(0, h * 0.55)
                    .C(0, h * 0.2, cx - r * 0.1, h * 0.05, cx, h * 0.28)
                    .L(cx, h * 0.1).L(w, h * 0.34).L(cx, h * 0.58).L(cx, h * 0.42)
                    .C(cx - r * 0.1, h * 0.32, t, h * 0.35, t, h * 0.62)
                    .L(t, h).Z().toString();
            }
        },
        leftUpArrow: {
            cat: "arrow", label: "Arrow: left-up",
            // an L with a head on each end: one points up, one points left
            pts: function (w, h) {
                var m = Math.min(w, h);
                var hw = m * 0.22, t = hw * 0.9, hh = m * 0.32;
                var vx = w - hw, hy = h - hw;
                return [[vx, 0], [w, hh], [vx + t / 2, hh], [vx + t / 2, hy + t / 2],
                    [hh, hy + t / 2], [hh, h], [0, hy], [hh, hy - hw * 2 + hw],
                    [hh, hy - t / 2], [vx - t / 2, hy - t / 2], [vx - t / 2, hh],
                    [vx - hw, hh]];
            }
        },
        bentUpArrow: {
            cat: "arrow", label: "Arrow: bent up",
            pts: function (w, h) {
                var t = h * 0.28;
                return [[0, h - t], [w * 0.62, h - t], [w * 0.62, h * 0.3],
                    [w * 0.45, h * 0.3], [w * 0.72, 0], [w, h * 0.3],
                    [w * 0.83, h * 0.3], [w * 0.83, h], [0, h]];
            }
        },
        stripedRightArrow: {
            cat: "arrow", label: "Arrow: striped right",
            evenOdd: true,
            path: function (w, h) {
                var pts = arrowPts(w, h, 0.38, 0.4);
                var t = h * 0.3;
                return P().poly(pts).toString() +
                    P().poly([[w * 0.05, t], [w * 0.09, t], [w * 0.09, h - t], [w * 0.05, h - t]]).toString() +
                    P().poly([[w * 0.13, t], [w * 0.2, t], [w * 0.2, h - t], [w * 0.13, h - t]]).toString();
            }
        },
        notchedRightArrow: {
            cat: "arrow", label: "Arrow: notched right",
            pts: function (w, h) {
                var hx = w * 0.62, t = h * 0.3;
                return [[0, t], [hx, t], [hx, 0], [w, h / 2], [hx, h], [hx, h - t],
                    [0, h - t], [t * 0.6, h / 2]];
            }
        },
        chevron: {
            cat: "arrow", label: "Chevron",
            pts: function (w, h) {
                return [[0, 0], [w * 0.72, 0], [w, h / 2], [w * 0.72, h], [0, h], [w * 0.28, h / 2]];
            }
        },
        homePlate: {
            cat: "arrow", label: "Pentagon arrow",
            pts: function (w, h) {
                return [[0, 0], [w * 0.72, 0], [w, h / 2], [w * 0.72, h], [0, h]];
            }
        },
        curvedRightArrow: {
            cat: "arrow", label: "Arrow: curved right",
            path: function (w, h) {
                var t = h * 0.2;
                return P().M(0, h * 0.08)
                    .C(w * 0.6, h * 0.0, w * 0.86, h * 0.28, w * 0.78, h * 0.56)
                    .L(w, h * 0.56).L(w * 0.7, h).L(w * 0.42, h * 0.56).L(w * 0.62, h * 0.56)
                    .C(w * 0.68, h * 0.36, w * 0.5, h * 0.22, 0, h * 0.08 + t)
                    .Z().toString();
            }
        },
        curvedLeftArrow: {
            cat: "arrow", label: "Arrow: curved left",
            path: function (w, h) {
                var t = h * 0.2;
                return P().M(w, h * 0.08)
                    .C(w * 0.4, h * 0.0, w * 0.14, h * 0.28, w * 0.22, h * 0.56)
                    .L(0, h * 0.56).L(w * 0.3, h).L(w * 0.58, h * 0.56).L(w * 0.38, h * 0.56)
                    .C(w * 0.32, h * 0.36, w * 0.5, h * 0.22, w, h * 0.08 + t)
                    .Z().toString();
            }
        },
        curvedUpArrow: {
            cat: "arrow", label: "Arrow: curved up",
            path: function (w, h) {
                var t = w * 0.2;
                return P().M(w * 0.08, h)
                    .C(w * 0.0, h * 0.4, w * 0.28, h * 0.14, w * 0.56, h * 0.22)
                    .L(w * 0.56, 0).L(w, h * 0.3).L(w * 0.56, h * 0.58).L(w * 0.56, h * 0.38)
                    .C(w * 0.36, h * 0.32, w * 0.22, h * 0.5, w * 0.08 + t, h)
                    .Z().toString();
            }
        },
        curvedDownArrow: {
            cat: "arrow", label: "Arrow: curved down",
            path: function (w, h) {
                var t = w * 0.2;
                return P().M(w * 0.08, 0)
                    .C(w * 0.0, h * 0.6, w * 0.28, h * 0.86, w * 0.56, h * 0.78)
                    .L(w * 0.56, h).L(w, h * 0.7).L(w * 0.56, h * 0.42).L(w * 0.56, h * 0.62)
                    .C(w * 0.36, h * 0.68, w * 0.22, h * 0.5, w * 0.08 + t, 0)
                    .Z().toString();
            }
        },
        circularArrow: {
            cat: "arrow", label: "Arrow: circular",
            path: function (w, h) {
                var cx = w / 2, cy = h / 2;
                var ro = Math.min(w, h) * 0.46, ri = Math.min(w, h) * 0.28;
                var a0 = Math.PI * 0.75, a1 = Math.PI * 2.15;
                var p = P();
                p.arc(cx, cy, ro, ro, a0, a1, true);
                var ax = cx + ((ro + ri) / 2) * Math.cos(a1);
                var ay = cy + ((ro + ri) / 2) * Math.sin(a1);
                var hx = Math.cos(a1 + Math.PI / 2), hy = Math.sin(a1 + Math.PI / 2);
                var hl = Math.min(w, h) * 0.2;
                p.L(cx + (ro + hl * 0.5) * Math.cos(a1), cy + (ro + hl * 0.5) * Math.sin(a1));
                p.L(ax + hx * hl, ay + hy * hl);
                p.L(cx + (ri - hl * 0.5) * Math.cos(a1), cy + (ri - hl * 0.5) * Math.sin(a1));
                p.L(cx + ri * Math.cos(a1), cy + ri * Math.sin(a1));
                p.arc(cx, cy, ri, ri, a1, a0);
                return p.Z().toString();
            }
        },
        rightArrowCallout: {
            cat: "arrow", label: "Callout: right arrow",
            pts: function (w, h) {
                var bx = w * 0.6, t = h * 0.22;
                return [[0, 0], [bx, 0], [bx, t], [w * 0.78, t], [w * 0.78, 0],
                    [w, h / 2], [w * 0.78, h], [w * 0.78, h - t], [bx, h - t], [bx, h], [0, h]];
            }
        },
        leftArrowCallout: {
            cat: "arrow", label: "Callout: left arrow",
            pts: function (w, h) {
                var bx = w * 0.4, t = h * 0.22;
                return [[w, 0], [bx, 0], [bx, t], [w * 0.22, t], [w * 0.22, 0],
                    [0, h / 2], [w * 0.22, h], [w * 0.22, h - t], [bx, h - t], [bx, h], [w, h]];
            }
        },
        upArrowCallout: {
            cat: "arrow", label: "Callout: up arrow",
            pts: function (w, h) {
                var by = h * 0.4, t = w * 0.22;
                return [[0, h], [0, by], [t, by], [t, h * 0.22], [0, h * 0.22],
                    [w / 2, 0], [w, h * 0.22], [w - t, h * 0.22], [w - t, by], [w, by], [w, h]];
            }
        },
        downArrowCallout: {
            cat: "arrow", label: "Callout: down arrow",
            pts: function (w, h) {
                var by = h * 0.6, t = w * 0.22;
                return [[0, 0], [0, by], [t, by], [t, h * 0.78], [0, h * 0.78],
                    [w / 2, h], [w, h * 0.78], [w - t, h * 0.78], [w - t, by], [w, by], [w, 0]];
            }
        },
        leftRightArrowCallout: {
            cat: "arrow", label: "Callout: left-right arrow",
            pts: function (w, h) {
                var t = h * 0.22, a = w * 0.2, b = w * 0.28;
                return [[b, 0], [w - b, 0], [w - b, t], [w - a, t], [w - a, 0],
                    [w, h / 2], [w - a, h], [w - a, h - t], [w - b, h - t], [w - b, h],
                    [b, h], [b, h - t], [a, h - t], [a, h], [0, h / 2], [a, 0], [a, t], [b, t]];
            }
        },

        /* ---------- call outs: stars, banners, bubbles ---------- */

        star4: { cat: "callout", label: "4-point star", pts: function (w, h) { return starPts(w, h, 4, 0.3); } },
        star5: { cat: "callout", label: "5-point star", pts: function (w, h) { return starPts(w, h, 5, 0.42); } },
        star6: { cat: "callout", label: "6-point star", pts: function (w, h) { return starPts(w, h, 6, 0.5); } },
        star7: { cat: "callout", label: "7-point star", pts: function (w, h) { return starPts(w, h, 7, 0.55); } },
        star8: { cat: "callout", label: "8-point star", pts: function (w, h) { return starPts(w, h, 8, 0.6); } },
        star10: { cat: "callout", label: "10-point star", pts: function (w, h) { return starPts(w, h, 10, 0.68); } },
        star12: { cat: "callout", label: "12-point star", pts: function (w, h) { return starPts(w, h, 12, 0.72); } },
        star16: { cat: "callout", label: "16-point star", pts: function (w, h) { return starPts(w, h, 16, 0.78); } },
        star24: { cat: "callout", label: "24-point star", pts: function (w, h) { return starPts(w, h, 24, 0.84); } },
        star32: { cat: "callout", label: "32-point star", pts: function (w, h) { return starPts(w, h, 32, 0.88); } },
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
            path: function (w, h) {
                return P().M(0, h * 0.18)
                    .C(w * 0.25, h * -0.08, w * 0.75, h * 0.44, w, h * 0.18)
                    .L(w, h * 0.82)
                    .C(w * 0.75, h * 1.08, w * 0.25, h * 0.56, 0, h * 0.82)
                    .Z().toString();
            }
        },
        doubleWave: {
            cat: "callout", label: "Double wave",
            path: function (w, h) {
                return P().M(0, h * 0.2)
                    .C(w * 0.12, h * -0.06, w * 0.38, h * 0.4, w * 0.5, h * 0.2)
                    .C(w * 0.62, h * 0.0, w * 0.88, h * 0.4, w, h * 0.2)
                    .L(w, h * 0.8)
                    .C(w * 0.88, h * 1.06, w * 0.62, h * 0.6, w * 0.5, h * 0.8)
                    .C(w * 0.38, h * 1.0, w * 0.12, h * 0.6, 0, h * 0.8)
                    .Z().toString();
            }
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
            pts: function (w, h) {
                var t = Math.min(w, h) * 0.18, m = w * 0.11, n = h * 0.11;
                var cx = w / 2, cy = h / 2;
                return [[cx - t / 2, n], [cx + t / 2, n], [cx + t / 2, cy - t / 2],
                    [w - m, cy - t / 2], [w - m, cy + t / 2], [cx + t / 2, cy + t / 2],
                    [cx + t / 2, h - n], [cx - t / 2, h - n], [cx - t / 2, cy + t / 2],
                    [m, cy + t / 2], [m, cy - t / 2], [cx - t / 2, cy - t / 2]];
            }
        },
        mathMinus: {
            cat: "equation", label: "Minus",
            pts: function (w, h) {
                var t = Math.min(w, h) * 0.18, m = w * 0.11, cy = h / 2;
                return [[m, cy - t / 2], [w - m, cy - t / 2], [w - m, cy + t / 2], [m, cy + t / 2]];
            }
        },
        mathMultiply: {
            cat: "equation", label: "Multiply",
            path: function (w, h) {
                var t = Math.min(w, h) * 0.16;
                var cx = w / 2, cy = h / 2;
                var ax = w * 0.36, ay = h * 0.36;
                var d = t / Math.SQRT2;
                return P().poly([
                    [cx - ax, cy - ay + d], [cx - ax + d, cy - ay], [cx, cy - d * 1.4],
                    [cx + ax - d, cy - ay], [cx + ax, cy - ay + d], [cx + d * 1.4, cy],
                    [cx + ax, cy + ay - d], [cx + ax - d, cy + ay], [cx, cy + d * 1.4],
                    [cx - ax + d, cy + ay], [cx - ax, cy + ay - d], [cx - d * 1.4, cy]
                ]).toString();
            }
        },
        mathDivide: {
            cat: "equation", label: "Divide",
            evenOdd: true,
            path: function (w, h) {
                var t = Math.min(w, h) * 0.14, m = w * 0.11, cy = h / 2;
                var r = Math.min(w, h) * 0.09;
                return P().poly([[m, cy - t / 2], [w - m, cy - t / 2],
                    [w - m, cy + t / 2], [m, cy + t / 2]]).toString() +
                    P().circle(w / 2, h * 0.22, r, r).toString() +
                    P().circle(w / 2, h * 0.78, r, r).toString();
            }
        },
        mathEqual: {
            cat: "equation", label: "Equal",
            evenOdd: true,
            path: function (w, h) {
                var t = Math.min(w, h) * 0.14, m = w * 0.11;
                var y1 = h * 0.36, y2 = h * 0.64;
                return P().poly([[m, y1 - t / 2], [w - m, y1 - t / 2],
                    [w - m, y1 + t / 2], [m, y1 + t / 2]]).toString() +
                    P().poly([[m, y2 - t / 2], [w - m, y2 - t / 2],
                        [w - m, y2 + t / 2], [m, y2 + t / 2]]).toString();
            }
        },
        mathNotEqual: {
            cat: "equation", label: "Not equal",
            evenOdd: true,
            path: function (w, h) {
                var t = Math.min(w, h) * 0.14, m = w * 0.11;
                var y1 = h * 0.36, y2 = h * 0.64;
                var sw = Math.min(w, h) * 0.12;
                return P().poly([[m, y1 - t / 2], [w - m, y1 - t / 2],
                    [w - m, y1 + t / 2], [m, y1 + t / 2]]).toString() +
                    P().poly([[m, y2 - t / 2], [w - m, y2 - t / 2],
                        [w - m, y2 + t / 2], [m, y2 + t / 2]]).toString() +
                    P().poly([[w * 0.56, h * 0.08], [w * 0.56 + sw, h * 0.08],
                        [w * 0.44 + sw, h * 0.92], [w * 0.44, h * 0.92]]).toString();
            }
        },
        leftBracket: {
            cat: "equation", size: [70, 220], label: "Left bracket",
            open: true,
            path: function (w, h) {
                var r = Math.min(w, h * 0.5) * 0.9;
                return P().M(w, 0)
                    .C(w - r * 0.55, 0, 0, r * 0.45, 0, r)
                    .L(0, h - r)
                    .C(0, h - r * 0.45, w - r * 0.55, h, w, h).toString();
            }
        },
        rightBracket: {
            cat: "equation", size: [70, 220], label: "Right bracket",
            open: true,
            path: function (w, h) {
                var r = Math.min(w, h * 0.5) * 0.9;
                return P().M(0, 0)
                    .C(r * 0.55, 0, w, r * 0.45, w, r)
                    .L(w, h - r)
                    .C(w, h - r * 0.45, r * 0.55, h, 0, h).toString();
            }
        },
        bracketPair: {
            cat: "equation", size: [70, 220], label: "Bracket pair",
            open: true,
            path: function (w, h) {
                var bw = Math.min(w * 0.25, h * 0.3);
                var r = Math.min(bw, h * 0.5) * 0.9;
                return P().M(bw, 0).C(bw - r * 0.55, 0, 0, r * 0.45, 0, r)
                    .L(0, h - r).C(0, h - r * 0.45, bw - r * 0.55, h, bw, h).toString() +
                    P().M(w - bw, 0).C(w - bw + r * 0.55, 0, w, r * 0.45, w, r)
                    .L(w, h - r).C(w, h - r * 0.45, w - bw + r * 0.55, h, w - bw, h).toString();
            }
        },
        rightBrace: {
            cat: "equation", size: [70, 220], label: "Right brace",
            open: true,
            path: function (w, h) { return bracePath(w, h, false); }
        },
        leftBrace: {
            cat: "equation", size: [70, 220], label: "Left brace",
            open: true,
            path: function (w, h) { return bracePath(w, h, true); }
        },
        bracePair: {
            cat: "equation", size: [70, 220], label: "Brace pair",
            open: true,
            path: function (w, h) {
                var bw = Math.min(w * 0.3, h * 0.3);
                return shiftPath(bracePath(bw, h, true), 0, 0) +
                    shiftPath(bracePath(bw, h, false), w - bw, 0);
            }
        }
    };

    /* A brace is two quarter turns out to the middle and two back, which is
       exactly what PresentationML's rightBrace draws and what a text-set
       "}" looks like. `left` mirrors it. */
    function bracePath(w, h, left) {
        var r = Math.min(w * 0.5, h * 0.24);
        var x0 = left ? w : 0;          // the open side
        var x1 = left ? 0 : w;          // the point
        var dir = left ? -1 : 1;
        var p = P();
        p.M(x0, 0);
        p.C(x0 + dir * r * 0.55, 0, x0 + dir * r, r * 0.45, x0 + dir * r, r);
        p.L(x0 + dir * r, h / 2 - r);
        p.C(x0 + dir * r, h / 2 - r * 0.45, x1 - dir * r * 0.45, h / 2, x1, h / 2);
        p.C(x1 - dir * r * 0.45, h / 2, x0 + dir * r, h / 2 + r * 0.45, x0 + dir * r, h / 2 + r);
        p.L(x0 + dir * r, h - r);
        p.C(x0 + dir * r, h - r * 0.45, x0 + dir * r * 0.55, h, x0, h);
        return p.toString();
    }

    // shiftPath translates a finished path; only M/L/C coordinates exist in
    // what this file produces, so a straight number walk is enough
    function shiftPath(d, dx, dy) {
        var i = 0;
        return d.replace(/([MLC])([^MLCZ]*)/g, function (all, cmd, nums) {
            var v = nums.trim().split(/[\s,]+/).map(Number);
            for (var k = 0; k < v.length; k += 2) {
                v[k] = r2(v[k] + dx);
                v[k + 1] = r2(v[k + 1] + dy);
            }
            return cmd + v.join(" ");
        });
    }

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

    function points(kind, w, h) {
        var d = def(kind);
        return d && d.pts ? d.pts(w, h) : null;
    }

    function path(kind, w, h) {
        var d = def(kind);
        if (!d) return "";
        if (d.pts) return P().poly(d.pts(w, h)).toString();
        return d.path(w, h);
    }

    function detail(kind, w, h) {
        var d = def(kind);
        return d && d.detail ? d.detail(w, h) : "";
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

    function evenOdd(kind) { var d = def(kind); return !!(d && d.evenOdd); }

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
        points: points,
        path: path,
        detail: detail,
        defaultSize: defaultSize
    };
})();
