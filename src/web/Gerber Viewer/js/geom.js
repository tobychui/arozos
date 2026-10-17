/*
    Gerber Viewer - geometry helpers

    Shared by the parsers, the board builder, the renderers and the exporters.

    Every parsed layer is a list of polarity groups, each holding "items" in
    board space (millimetres, Y pointing up):

        {t:'c', x, y, r}                         filled disc
        {t:'l', x1, y1, x2, y2, w}               stroke with round caps
        {t:'a', cx, cy, r, a0, sw, w}            arc stroke with round caps,
                                                 a0 = start angle, sw = signed
                                                 sweep (positive = counter
                                                 clockwise in board space)
        {t:'p', c:[contour, ...], clip}          filled contours, each a flat
                                                 [x0, y0, x1, y1, ...] array.
                                                 Outer contours are counter
                                                 clockwise and holes clockwise,
                                                 so a nonzero fill is correct.
                                                 clip (optional) limits the
                                                 fill to those contours.

    Every item also carries b = [minX, minY, maxX, maxY] and o, a shared object
    describing what produced it (flash, trace, region, hole, ...).
*/
(function (GV) {
    'use strict';

    var TAU = Math.PI * 2;
    var ARC_TOL = 0.002;   //mm of chord error allowed when an arc is flattened

    function arcSegments(r, sweep) {
        var a = Math.abs(sweep);
        if (!(r > 0) || !(a > 0)) {
            return 1;
        }
        var step = 2 * Math.acos(Math.max(-1, 1 - ARC_TOL / r));
        if (!(step > 0)) {
            step = 0.25;
        }
        var n = Math.ceil(a / step);
        n = Math.max(n, Math.ceil(16 * a / TAU), 2);
        return Math.min(n, 720);
    }

    //Append the points of an arc to pts, excluding the start point
    function flattenArc(pts, cx, cy, r, a0, sweep) {
        var n = arcSegments(r, sweep);
        for (var i = 1; i <= n; i++) {
            var a = a0 + sweep * i / n;
            pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
        }
        return pts;
    }

    function circleContour(cx, cy, r, ccw) {
        var n = arcSegments(r, TAU);
        var pts = [];
        for (var i = 0; i < n; i++) {
            var a = (ccw === false ? -1 : 1) * TAU * i / n;
            pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
        }
        return pts;
    }

    function signedArea(c) {
        var a = 0;
        var n = c.length;
        if (n < 6) {
            return 0;
        }
        var px = c[n - 2], py = c[n - 1];
        for (var i = 0; i < n; i += 2) {
            a += px * c[i + 1] - c[i] * py;
            px = c[i];
            py = c[i + 1];
        }
        return a / 2;
    }

    function reverseContour(c) {
        var out = new Array(c.length);
        var n = c.length / 2;
        for (var i = 0; i < n; i++) {
            out[2 * i] = c[2 * (n - 1 - i)];
            out[2 * i + 1] = c[2 * (n - 1 - i) + 1];
        }
        return out;
    }

    //Make a contour counter clockwise (positive) or clockwise (hole)
    function orient(c, positive) {
        var a = signedArea(c);
        if ((a >= 0) !== positive) {
            return reverseContour(c);
        }
        return c;
    }

    //Drop a closing point that repeats the first one
    function dropClosingPoint(c) {
        var n = c.length;
        if (n >= 4 && Math.abs(c[0] - c[n - 2]) < 1e-9 && Math.abs(c[1] - c[n - 1]) < 1e-9) {
            c.length = n - 2;
        }
        return c;
    }

    //Andrew's monotone chain, returns a counter clockwise contour
    function convexHull(pts) {
        var p = [];
        for (var i = 0; i < pts.length; i += 2) {
            p.push([pts[i], pts[i + 1]]);
        }
        p.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
        if (p.length < 3) {
            return pts.slice();
        }
        function cross(o, a, b) {
            return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        }
        var lower = [], upper = [];
        for (var j = 0; j < p.length; j++) {
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p[j]) <= 0) {
                lower.pop();
            }
            lower.push(p[j]);
        }
        for (var k = p.length - 1; k >= 0; k--) {
            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p[k]) <= 0) {
                upper.pop();
            }
            upper.push(p[k]);
        }
        upper.pop();
        lower.pop();
        var hull = lower.concat(upper);
        var out = [];
        for (var h = 0; h < hull.length; h++) {
            out.push(hull[h][0], hull[h][1]);
        }
        return out;
    }

    //Expand the bounding box of an arc stroke
    function arcBounds(cx, cy, r, a0, sweep, pad) {
        var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
        var x1 = cx + r * Math.cos(a0 + sweep), y1 = cy + r * Math.sin(a0 + sweep);
        var b = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
        if (Math.abs(sweep) >= TAU - 1e-9) {
            b = [cx - r, cy - r, cx + r, cy + r];
        } else {
            var lo = Math.min(a0, a0 + sweep), hi = Math.max(a0, a0 + sweep);
            var k = Math.ceil(lo / (Math.PI / 2));
            for (var a = k * Math.PI / 2; a <= hi; a += Math.PI / 2) {
                var px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
                if (px < b[0]) b[0] = px;
                if (py < b[1]) b[1] = py;
                if (px > b[2]) b[2] = px;
                if (py > b[3]) b[3] = py;
            }
        }
        b[0] -= pad; b[1] -= pad; b[2] += pad; b[3] += pad;
        return b;
    }

    function itemBounds(it) {
        switch (it.t) {
            case 'c':
                return [it.x - it.r, it.y - it.r, it.x + it.r, it.y + it.r];
            case 'l':
                var h = it.w / 2;
                return [Math.min(it.x1, it.x2) - h, Math.min(it.y1, it.y2) - h,
                    Math.max(it.x1, it.x2) + h, Math.max(it.y1, it.y2) + h];
            case 'a':
                return arcBounds(it.cx, it.cy, it.r, it.a0, it.sw, it.w / 2);
            case 'p':
                var b = [Infinity, Infinity, -Infinity, -Infinity];
                for (var i = 0; i < it.c.length; i++) {
                    var c = it.c[i];
                    for (var j = 0; j < c.length; j += 2) {
                        if (c[j] < b[0]) b[0] = c[j];
                        if (c[j + 1] < b[1]) b[1] = c[j + 1];
                        if (c[j] > b[2]) b[2] = c[j];
                        if (c[j + 1] > b[3]) b[3] = c[j + 1];
                    }
                }
                return b;
        }
        return [0, 0, 0, 0];
    }

    function emptyBounds() {
        return [Infinity, Infinity, -Infinity, -Infinity];
    }

    function unionBounds(a, b) {
        if (b[0] < a[0]) a[0] = b[0];
        if (b[1] < a[1]) a[1] = b[1];
        if (b[2] > a[2]) a[2] = b[2];
        if (b[3] > a[3]) a[3] = b[3];
        return a;
    }

    function boundsValid(b) {
        return b && isFinite(b[0]) && isFinite(b[1]) && isFinite(b[2]) && isFinite(b[3]) && b[2] >= b[0] && b[3] >= b[1];
    }

    //Affine 2x3 transform [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f
    function applyToItem(it, m) {
        var a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5];
        var det = a * d - b * c;
        var s = Math.sqrt(Math.abs(det));
        var out;
        switch (it.t) {
            case 'c':
                out = { t: 'c', x: a * it.x + c * it.y + e, y: b * it.x + d * it.y + f, r: it.r * s };
                break;
            case 'l':
                out = {
                    t: 'l',
                    x1: a * it.x1 + c * it.y1 + e, y1: b * it.x1 + d * it.y1 + f,
                    x2: a * it.x2 + c * it.y2 + e, y2: b * it.x2 + d * it.y2 + f,
                    w: it.w * s
                };
                break;
            case 'a':
                //Rotate the start direction; a mirror reverses the sweep
                var ux = Math.cos(it.a0), uy = Math.sin(it.a0);
                out = {
                    t: 'a',
                    cx: a * it.cx + c * it.cy + e, cy: b * it.cx + d * it.cy + f,
                    r: it.r * s,
                    a0: Math.atan2(b * ux + d * uy, a * ux + c * uy),
                    sw: det < 0 ? -it.sw : it.sw,
                    w: it.w * s
                };
                break;
            case 'p':
                var cs = [];
                for (var i = 0; i < it.c.length; i++) {
                    cs.push(transformContour(it.c[i], m, det < 0));
                }
                out = { t: 'p', c: cs };
                if (it.clip) {
                    out.clip = [];
                    for (var k = 0; k < it.clip.length; k++) {
                        out.clip.push(transformContour(it.clip[k], m, det < 0));
                    }
                }
                break;
        }
        out.o = it.o;
        out.b = itemBounds(out);
        return out;
    }

    function transformContour(c, m, flip) {
        var out = new Array(c.length);
        for (var j = 0; j < c.length; j += 2) {
            out[j] = m[0] * c[j] + m[2] * c[j + 1] + m[4];
            out[j + 1] = m[1] * c[j] + m[3] * c[j + 1] + m[5];
        }
        return flip ? reverseContour(out) : out;
    }

    function translateItem(it, dx, dy) {
        var out;
        switch (it.t) {
            case 'c':
                out = { t: 'c', x: it.x + dx, y: it.y + dy, r: it.r };
                break;
            case 'l':
                out = { t: 'l', x1: it.x1 + dx, y1: it.y1 + dy, x2: it.x2 + dx, y2: it.y2 + dy, w: it.w };
                break;
            case 'a':
                out = { t: 'a', cx: it.cx + dx, cy: it.cy + dy, r: it.r, a0: it.a0, sw: it.sw, w: it.w };
                break;
            case 'p':
                out = { t: 'p', c: it.c.map(function (c) { return shiftContour(c, dx, dy); }) };
                if (it.clip) {
                    out.clip = it.clip.map(function (c) { return shiftContour(c, dx, dy); });
                }
                break;
        }
        out.o = it.o;
        out.b = [it.b[0] + dx, it.b[1] + dy, it.b[2] + dx, it.b[3] + dy];
        return out;
    }

    function shiftContour(c, dx, dy) {
        var out = new Array(c.length);
        for (var j = 0; j < c.length; j += 2) {
            out[j] = c[j] + dx;
            out[j + 1] = c[j + 1] + dy;
        }
        return out;
    }

    //Arc end points
    function arcStart(it) {
        return [it.cx + it.r * Math.cos(it.a0), it.cy + it.r * Math.sin(it.a0)];
    }

    function arcEnd(it) {
        return [it.cx + it.r * Math.cos(it.a0 + it.sw), it.cy + it.r * Math.sin(it.a0 + it.sw)];
    }

    /*
        Path sinks: geometry is written through a tiny canvas-like interface so
        the same code feeds Path2D (screen), SVG path data (export) and point
        lists (3D / board outline).
    */
    function emitCircle(sink, x, y, r, ccw) {
        sink.moveTo(x + r, y);
        sink.arc(x, y, r, 0, TAU, ccw === false);
        sink.closePath();
    }

    function emitContour(sink, c) {
        if (c.length < 4) {
            return;
        }
        sink.moveTo(c[0], c[1]);
        for (var i = 2; i < c.length; i += 2) {
            sink.lineTo(c[i], c[i + 1]);
        }
        sink.closePath();
    }

    //Item outline used for filled drawing (strokes are handled by the caller)
    function emitFill(sink, it) {
        if (it.t === 'c') {
            emitCircle(sink, it.x, it.y, it.r, true);
        } else if (it.t === 'p') {
            for (var i = 0; i < it.c.length; i++) {
                emitContour(sink, it.c[i]);
            }
        }
    }

    function emitStroke(sink, it) {
        if (it.t === 'l') {
            sink.moveTo(it.x1, it.y1);
            sink.lineTo(it.x2, it.y2);
        } else if (it.t === 'a') {
            var s = arcStart(it);
            sink.moveTo(s[0], s[1]);
            //Canvas arcs run in increasing angle when anticlockwise is false.
            //With the Y-up board transform that is counter clockwise on screen
            sink.arc(it.cx, it.cy, it.r, it.a0, it.a0 + it.sw, it.sw < 0);
        }
    }

    //SVG path data sink
    function SvgPath(precision) {
        this.d = [];
        this.p = precision || 4;
        this.cx = 0;
        this.cy = 0;
    }
    SvgPath.prototype.n = function (v) {
        var s = v.toFixed(this.p);
        if (s.indexOf('.') >= 0) {
            s = s.replace(/0+$/, '').replace(/\.$/, '');
        }
        return s === '-0' ? '0' : s;
    };
    SvgPath.prototype.moveTo = function (x, y) {
        this.d.push('M' + this.n(x) + ' ' + this.n(y));
        this.cx = x;
        this.cy = y;
    };
    SvgPath.prototype.lineTo = function (x, y) {
        this.d.push('L' + this.n(x) + ' ' + this.n(y));
        this.cx = x;
        this.cy = y;
    };
    SvgPath.prototype.closePath = function () {
        this.d.push('Z');
    };
    SvgPath.prototype.arc = function (cx, cy, r, a0, a1, anticlockwise) {
        var sweep = a1 - a0;
        if (anticlockwise && sweep > 0) {
            sweep -= TAU;
        }
        if (!anticlockwise && sweep < 0) {
            sweep += TAU;
        }
        if (Math.abs(sweep) >= TAU - 1e-9) {
            sweep = anticlockwise ? -TAU : TAU;
        }
        var sx = cx + r * Math.cos(a0), sy = cy + r * Math.sin(a0);
        if (Math.abs(sx - this.cx) > 1e-9 || Math.abs(sy - this.cy) > 1e-9) {
            this.lineTo(sx, sy);
        }
        //Split into pieces below 180 degrees so the large-arc flag stays simple
        var pieces = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI * 0.99)));
        var flag = sweep > 0 ? 1 : 0;
        for (var i = 1; i <= pieces; i++) {
            var a = a0 + sweep * i / pieces;
            var x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
            this.d.push('A' + this.n(r) + ' ' + this.n(r) + ' 0 0 ' + flag + ' ' + this.n(x) + ' ' + this.n(y));
            this.cx = x;
            this.cy = y;
        }
    };
    SvgPath.prototype.toString = function () {
        return this.d.join('');
    };

    //Distance from point to segment
    function distToSegment(px, py, x1, y1, x2, y2) {
        var dx = x2 - x1, dy = y2 - y1;
        var l2 = dx * dx + dy * dy;
        var t = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        var qx = x1 + t * dx - px, qy = y1 + t * dy - py;
        return Math.sqrt(qx * qx + qy * qy);
    }

    function windingNumber(c, px, py) {
        var wn = 0;
        var n = c.length;
        for (var i = 0; i < n; i += 2) {
            var x1 = c[i], y1 = c[i + 1];
            var x2 = c[(i + 2) % n], y2 = c[(i + 3) % n];
            if (y1 <= py) {
                if (y2 > py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) > 0) {
                    wn++;
                }
            } else if (y2 <= py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) < 0) {
                wn--;
            }
        }
        return wn;
    }

    function angleInSweep(a, a0, sw) {
        var d = a - a0;
        if (sw >= 0) {
            d = ((d % TAU) + TAU) % TAU;
            return d <= sw + 1e-9;
        }
        d = ((-d % TAU) + TAU) % TAU;
        return d <= -sw + 1e-9;
    }

    //Does the item cover (px, py)? tol widens thin features
    function hitItem(it, px, py, tol) {
        var b = it.b;
        if (px < b[0] - tol || px > b[2] + tol || py < b[1] - tol || py > b[3] + tol) {
            return false;
        }
        switch (it.t) {
            case 'c':
                return Math.hypot(px - it.x, py - it.y) <= it.r + tol;
            case 'l':
                return distToSegment(px, py, it.x1, it.y1, it.x2, it.y2) <= it.w / 2 + tol;
            case 'a':
                var d = Math.hypot(px - it.cx, py - it.cy);
                if (Math.abs(d - it.r) <= it.w / 2 + tol && angleInSweep(Math.atan2(py - it.cy, px - it.cx), it.a0, it.sw)) {
                    return true;
                }
                var s = arcStart(it), e = arcEnd(it);
                return Math.hypot(px - s[0], py - s[1]) <= it.w / 2 + tol || Math.hypot(px - e[0], py - e[1]) <= it.w / 2 + tol;
            case 'p':
                var wn = 0;
                for (var i = 0; i < it.c.length; i++) {
                    wn += windingNumber(it.c[i], px, py);
                }
                if (wn !== 0) {
                    return true;
                }
                if (tol > 0) {
                    for (var k = 0; k < it.c.length; k++) {
                        var c = it.c[k];
                        for (var j = 0; j < c.length; j += 2) {
                            if (distToSegment(px, py, c[j], c[j + 1], c[(j + 2) % c.length], c[(j + 3) % c.length]) <= tol) {
                                return true;
                            }
                        }
                    }
                }
                return false;
        }
        return false;
    }

    function polygonArea(it) {
        var a = 0;
        for (var i = 0; i < it.c.length; i++) {
            a += signedArea(it.c[i]);
        }
        return Math.abs(a);
    }

    GV.geom = {
        TAU: TAU,
        arcSegments: arcSegments,
        flattenArc: flattenArc,
        circleContour: circleContour,
        signedArea: signedArea,
        reverseContour: reverseContour,
        orient: orient,
        dropClosingPoint: dropClosingPoint,
        convexHull: convexHull,
        arcBounds: arcBounds,
        itemBounds: itemBounds,
        emptyBounds: emptyBounds,
        unionBounds: unionBounds,
        boundsValid: boundsValid,
        applyToItem: applyToItem,
        translateItem: translateItem,
        arcStart: arcStart,
        arcEnd: arcEnd,
        emitCircle: emitCircle,
        emitContour: emitContour,
        emitFill: emitFill,
        emitStroke: emitStroke,
        SvgPath: SvgPath,
        distToSegment: distToSegment,
        windingNumber: windingNumber,
        hitItem: hitItem,
        polygonArea: polygonArea
    };
})(typeof window !== 'undefined' ? (window.GV = window.GV || {}) : (global.GV = global.GV || {}));
