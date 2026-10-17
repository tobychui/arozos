/*
    Gerber Viewer - RS-274X / Gerber X2 parser

    GV.gerber.parse(text) -> layer image (see geom.js for the item format)

    Supported: FS, MO, AD (C/R/O/P and macros), AM with every primitive and
    arithmetic, LP, LM/LR/LS, SR, AB block apertures, regions (G36/G37), linear
    and circular interpolation in single (G74) and multi (G75) quadrant mode,
    X2 file / aperture / object attributes, and the deprecated IP, OF, G70/G71,
    G90/G91 and modal D-code forms that older CAM software still writes.
*/
(function (GV) {
    'use strict';

    var G = GV.geom;
    var TAU = G.TAU;
    var DEG = Math.PI / 180;

    /* ------------------------------------------------------------------
        Aperture macro expressions
    ------------------------------------------------------------------ */
    function tokenizeExpr(src) {
        var re = /\s*(\$\d+|\d*\.\d+(?:[eE][+-]?\d+)?|\d+\.?(?:[eE][+-]?\d+)?|[+\-xX\/()])/g;
        var out = [];
        var m;
        var pos = 0;
        while ((m = re.exec(src)) !== null) {
            if (m.index !== pos && src.slice(pos, m.index).trim() !== '') {
                break;
            }
            out.push(m[1]);
            pos = re.lastIndex;
        }
        return out;
    }

    function evalExpr(src, vars) {
        var toks = tokenizeExpr(src);
        var i = 0;
        function peek() { return toks[i]; }
        function next() { return toks[i++]; }
        function primary() {
            var t = next();
            if (t === undefined) {
                return 0;
            }
            if (t === '(') {
                var v = sum();
                if (peek() === ')') {
                    next();
                }
                return v;
            }
            if (t === '-') {
                return -primary();
            }
            if (t === '+') {
                return primary();
            }
            if (t.charAt(0) === '$') {
                var val = vars[parseInt(t.slice(1), 10)];
                return typeof val === 'number' && isFinite(val) ? val : 0;
            }
            var n = parseFloat(t);
            return isFinite(n) ? n : 0;
        }
        function product() {
            var v = primary();
            while (peek() === 'x' || peek() === 'X' || peek() === '/') {
                var op = next();
                var r = primary();
                v = op === '/' ? (r === 0 ? 0 : v / r) : v * r;
            }
            return v;
        }
        function sum() {
            var v = product();
            while (peek() === '+' || peek() === '-') {
                var op = next();
                var r = product();
                v = op === '+' ? v + r : v - r;
            }
            return v;
        }
        return sum();
    }

    function parseMacro(name, blocks) {
        var body = [];
        for (var i = 0; i < blocks.length; i++) {
            var b = blocks[i].replace(/\s+/g, ' ').trim();
            if (b === '') {
                continue;
            }
            if (/^0(\s|$)/.test(b)) {
                continue;   //comment primitive
            }
            var vm = /^\$(\d+)\s*=\s*(.*)$/.exec(b);
            if (vm) {
                body.push({ v: parseInt(vm[1], 10), e: vm[2] });
                continue;
            }
            var parts = b.replace(/\s/g, '').split(',');
            body.push({ code: parseInt(parts[0], 10), args: parts.slice(1) });
        }
        return { name: name, body: body };
    }

    function rotatePts(pts, deg) {
        if (!deg) {
            return pts;
        }
        var c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
        for (var i = 0; i < pts.length; i += 2) {
            var x = pts[i], y = pts[i + 1];
            pts[i] = x * c - y * s;
            pts[i + 1] = x * s + y * c;
        }
        return pts;
    }

    function rectPts(x0, y0, x1, y1) {
        return [x0, y0, x1, y0, x1, y1, x0, y1];
    }

    //Evaluate an aperture macro into shapes [{on, item}] in file units
    function evalMacro(macro, params) {
        var vars = {};
        for (var p = 0; p < params.length; p++) {
            vars[p + 1] = params[p];
        }
        var shapes = [];
        function add(on, it) {
            shapes.push({ on: on, it: it });
        }
        function poly(on, pts) {
            G.dropClosingPoint(pts);
            if (pts.length >= 6) {
                add(on, { t: 'p', c: [G.orient(pts, true)] });
            }
        }
        for (var i = 0; i < macro.body.length; i++) {
            var st = macro.body[i];
            if (st.v !== undefined) {
                vars[st.v] = evalExpr(st.e, vars);
                continue;
            }
            var a = st.args.map(function (s) { return evalExpr(s, vars); });
            var on = a[0] !== 0;
            var rot, pts, cx, cy;
            switch (st.code) {
                case 1: //circle: exposure, diameter, x, y, rotation
                    cx = a[2] || 0;
                    cy = a[3] || 0;
                    pts = rotatePts([cx, cy], a[4] || 0);
                    if (a[1] > 0) {
                        add(on, { t: 'c', x: pts[0], y: pts[1], r: a[1] / 2 });
                    }
                    break;
                case 2:
                case 20: //vector line: exposure, width, x1, y1, x2, y2, rotation
                    var w = a[1], x1 = a[2], y1 = a[3], x2 = a[4], y2 = a[5];
                    var len = Math.hypot(x2 - x1, y2 - y1);
                    if (w > 0 && len > 0) {
                        var nx = -(y2 - y1) / len * w / 2, ny = (x2 - x1) / len * w / 2;
                        pts = [x1 + nx, y1 + ny, x2 + nx, y2 + ny, x2 - nx, y2 - ny, x1 - nx, y1 - ny];
                        poly(on, rotatePts(pts, a[6] || 0));
                    }
                    break;
                case 21: //center line: exposure, width, height, cx, cy, rotation
                    if (a[1] > 0 && a[2] > 0) {
                        cx = a[3] || 0;
                        cy = a[4] || 0;
                        pts = rectPts(cx - a[1] / 2, cy - a[2] / 2, cx + a[1] / 2, cy + a[2] / 2);
                        poly(on, rotatePts(pts, a[5] || 0));
                    }
                    break;
                case 22: //lower left line (deprecated): exposure, width, height, x, y, rotation
                    if (a[1] > 0 && a[2] > 0) {
                        pts = rectPts(a[3], a[4], a[3] + a[1], a[4] + a[2]);
                        poly(on, rotatePts(pts, a[5] || 0));
                    }
                    break;
                case 4: //outline: exposure, n, x0, y0 ... xn, yn, rotation
                    var n = Math.round(a[1]);
                    pts = [];
                    for (var k = 0; k <= n; k++) {
                        var px = a[2 + k * 2], py = a[3 + k * 2];
                        if (px === undefined || py === undefined) {
                            break;
                        }
                        pts.push(px, py);
                    }
                    rot = a[2 + (n + 1) * 2] || 0;
                    poly(on, rotatePts(pts, rot));
                    break;
                case 5: //polygon: exposure, vertices, cx, cy, diameter, rotation
                    var nv = Math.max(3, Math.round(a[1]));
                    cx = a[2] || 0;
                    cy = a[3] || 0;
                    pts = [];
                    for (var v = 0; v < nv; v++) {
                        var ang = TAU * v / nv;
                        pts.push(cx + a[4] / 2 * Math.cos(ang), cy + a[4] / 2 * Math.sin(ang));
                    }
                    poly(on, rotatePts(pts, a[5] || 0));
                    break;
                case 6: //moire (deprecated): cx, cy, outer dia, thickness, gap, rings, cross thickness, cross length, rotation
                    cx = a[0]; cy = a[1];
                    rot = a[8] || 0;
                    var od = a[2], th = a[3], gap = a[4], rings = Math.round(a[5]);
                    for (var ri = 0; ri < rings; ri++) {
                        var ro = od / 2 - ri * (th + gap);
                        if (ro <= 0) {
                            break;
                        }
                        var rin = ro - th;
                        var outer = G.circleContour(cx, cy, ro, true);
                        var cs = [rotatePts(outer, rot)];
                        if (rin > 0) {
                            cs.push(rotatePts(G.circleContour(cx, cy, rin, false), rot));
                        }
                        add(true, { t: 'p', c: cs });
                    }
                    if (a[6] > 0 && a[7] > 0) {
                        poly(true, rotatePts(rectPts(cx - a[7] / 2, cy - a[6] / 2, cx + a[7] / 2, cy + a[6] / 2), rot));
                        poly(true, rotatePts(rectPts(cx - a[6] / 2, cy - a[7] / 2, cx + a[6] / 2, cy + a[7] / 2), rot));
                    }
                    break;
                case 7: //thermal: cx, cy, outer dia, inner dia, gap, rotation
                    thermalPieces(a[0], a[1], a[2] / 2, a[3] / 2, a[4] / 2, a[5] || 0).forEach(function (pp) {
                        add(true, { t: 'p', c: [G.orient(pp, true)] });
                    });
                    break;
                default:
                    break;
            }
        }
        return shapes;
    }

    //Four quarter ring pieces of a thermal relief
    function thermalPieces(cx, cy, ro, ri, hg, rot) {
        var out = [];
        if (!(ro > 0) || ro <= ri || hg * Math.SQRT2 >= ro) {
            return out;
        }
        var ao1 = Math.asin(Math.min(1, hg / ro));
        for (var q = 0; q < 4; q++) {
            var pts = [];
            var start = q * Math.PI / 2;
            pts.push(ro * Math.cos(start + ao1), ro * Math.sin(start + ao1));
            G.flattenArc(pts, 0, 0, ro, start + ao1, Math.PI / 2 - 2 * ao1);
            if (ri > 0 && hg * Math.SQRT2 < ri) {
                var ai1 = Math.asin(hg / ri);
                pts.push(ri * Math.cos(start + Math.PI / 2 - ai1), ri * Math.sin(start + Math.PI / 2 - ai1));
                G.flattenArc(pts, 0, 0, ri, start + Math.PI / 2 - ai1, -(Math.PI / 2 - 2 * ai1));
            } else {
                //Gap wider than the hole: the inner edge collapses to a corner
                var corner = rotatePts([hg, hg], q * 90);
                pts.push(corner[0], corner[1]);
            }
            for (var i = 0; i < pts.length; i += 2) {
                pts[i] += cx;
                pts[i + 1] += cy;
            }
            out.push(rotatePts(pts, rot));
        }
        return out;
    }

    /* ------------------------------------------------------------------
        Aperture templates (local coordinates, millimetres)
    ------------------------------------------------------------------ */
    function holeContour(hole) {
        return hole > 0 ? G.circleContour(0, 0, hole / 2, false) : null;
    }

    function standardShapes(ap) {
        var p = ap.params;
        var items = [];
        var hole, outer;
        switch (ap.type) {
            case 'C':
                hole = p[1] || 0;
                if (hole > 0) {
                    items.push({ t: 'p', c: [G.circleContour(0, 0, p[0] / 2, true), holeContour(hole)] });
                } else if (p[0] > 0) {
                    items.push({ t: 'c', x: 0, y: 0, r: p[0] / 2 });
                }
                break;
            case 'R':
                hole = p[2] || 0;
                outer = rectPts(-p[0] / 2, -p[1] / 2, p[0] / 2, p[1] / 2);
                items.push({ t: 'p', c: hole > 0 ? [outer, holeContour(hole)] : [outer] });
                break;
            case 'O':
                var w = p[0], h = p[1];
                hole = p[2] || 0;
                if (hole > 0 || !(w > 0) || !(h > 0)) {
                    items.push({ t: 'p', c: hole > 0 ? [obroundPts(w, h), holeContour(hole)] : [obroundPts(w, h)] });
                } else if (Math.abs(w - h) < 1e-9) {
                    items.push({ t: 'c', x: 0, y: 0, r: w / 2 });
                } else if (w > h) {
                    items.push({ t: 'l', x1: -(w - h) / 2, y1: 0, x2: (w - h) / 2, y2: 0, w: h });
                } else {
                    items.push({ t: 'l', x1: 0, y1: -(h - w) / 2, x2: 0, y2: (h - w) / 2, w: w });
                }
                break;
            case 'P':
                var n = Math.max(3, Math.round(p[1] || 3));
                var r0 = (p[2] || 0) * DEG;
                hole = p[3] || 0;
                outer = [];
                for (var i = 0; i < n; i++) {
                    outer.push(p[0] / 2 * Math.cos(r0 + TAU * i / n), p[0] / 2 * Math.sin(r0 + TAU * i / n));
                }
                items.push({ t: 'p', c: hole > 0 ? [outer, holeContour(hole)] : [outer] });
                break;
        }
        return items;
    }

    function obroundPts(w, h) {
        var pts = [];
        if (w >= h) {
            var r = h / 2, dx = (w - h) / 2;
            pts.push(dx, -r);
            G.flattenArc(pts, dx, 0, r, -Math.PI / 2, Math.PI);
            pts.push(-dx, r);
            G.flattenArc(pts, -dx, 0, r, Math.PI / 2, Math.PI);
        } else {
            var r2 = w / 2, dy = (h - w) / 2;
            pts.push(r2, dy);
            G.flattenArc(pts, 0, dy, r2, 0, Math.PI);
            pts.push(-r2, -dy);
            G.flattenArc(pts, 0, -dy, r2, Math.PI, Math.PI);
        }
        G.dropClosingPoint(pts);
        return pts;
    }

    //Macro shapes, combined into items. Exposure-off shapes cut holes only
    //into the aperture itself, so they become a clipped compound item.
    function macroShapes(shapes, unit) {
        var scale = [unit, 0, 0, unit, 0, 0];
        var anyOff = shapes.some(function (s) { return !s.on; });
        if (!anyOff) {
            return shapes.map(function (s) { return G.applyToItem(withBounds(s.it), scale); });
        }
        var all = [], clip = [];
        shapes.forEach(function (s) {
            var it = G.applyToItem(withBounds(s.it), scale);
            var cs = it.t === 'c' ? [G.circleContour(it.x, it.y, it.r, true)] : (it.t === 'p' ? it.c : []);
            cs.forEach(function (c) {
                if (s.on) {
                    all.push(c);
                    clip.push(c);
                } else {
                    all.push(G.orient(c, false));
                }
            });
        });
        return all.length ? [withBounds({ t: 'p', c: all, clip: clip })] : [];
    }

    function withBounds(it) {
        it.b = G.itemBounds(it);
        return it;
    }

    function describeAperture(ap) {
        var p = ap.params;
        function f(v) {
            return (Math.round(v * 10000) / 10000).toString();
        }
        switch (ap.type) {
            case 'C':
                return 'Circle Ø' + f(p[0]) + (p[1] ? ' hole ' + f(p[1]) : '');
            case 'R':
                return 'Rectangle ' + f(p[0]) + ' × ' + f(p[1]);
            case 'O':
                return 'Obround ' + f(p[0]) + ' × ' + f(p[1]);
            case 'P':
                return 'Polygon Ø' + f(p[0]) + ', ' + Math.round(p[1]) + ' sides';
            case 'block':
                return 'Block aperture';
            default:
                return 'Macro ' + ap.type + (ap.rawParams && ap.rawParams.length ? ' (' + ap.rawParams.map(f).join(', ') + ')' : '');
        }
    }

    /* ------------------------------------------------------------------
        Header helpers
    ------------------------------------------------------------------ */
    var GENERATORS = ['EasyEDA', 'KiCad', 'Altium', 'CircuitMaker', 'EAGLE', 'Fusion', 'DipTrace', 'Proteus', 'OrCAD',
        'Allegro', 'PADS', 'Mentor', 'Xpedition', 'gEDA', 'pcb-rnd', 'Fritzing', 'Horizon', 'LibrePCB', 'TARGET', 'Sprint-Layout',
        'DesignSpark', 'Pulsonix', 'Zuken', 'CAM350', 'Ultiboard', 'P-CAD', 'Protel', 'Upverter', 'Flux', 'JLC'];

    function detectGenerator(comments, attrs) {
        if (attrs.GenerationSoftware) {
            return attrs.GenerationSoftware.split(',').filter(Boolean).join(' ');
        }
        for (var i = 0; i < comments.length; i++) {
            var c = comments[i];
            for (var j = 0; j < GENERATORS.length; j++) {
                var idx = c.toLowerCase().indexOf(GENERATORS[j].toLowerCase());
                if (idx >= 0) {
                    var s = c.slice(idx).split(/[,;*]/)[0].trim();
                    return s.length > 60 ? s.slice(0, 60) : s;
                }
            }
        }
        return '';
    }

    function detectDate(comments, attrs) {
        if (attrs.CreationDate) {
            return attrs.CreationDate;
        }
        var re = /(\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2})(?:[ T,]+(\d{1,2}:\d{2}(?::\d{2})?))?/;
        for (var i = 0; i < comments.length; i++) {
            var m = re.exec(comments[i]);
            if (m) {
                return m[1] + (m[2] ? ' ' + m[2] : '');
            }
        }
        return '';
    }

    /* ------------------------------------------------------------------
        Parser
    ------------------------------------------------------------------ */
    function parse(text) {
        var fmt = { zero: 'L', abs: true, xi: 2, xd: 4, yi: 2, yd: 4, set: false };
        var units = null;           //'mm' | 'in'
        var unitSeen = false;
        var apertures = {};
        var macros = {};
        var groups = [];
        var cur = null;
        var dark = true;
        var x = 0, y = 0;
        var interp = 1;             //1 linear, 2 CW, 3 CCW
        var multiQuadrant = true;
        var region = false;
        var contour = null;         //points of the open region contour
        var contourHasSeg = false;
        var ap = null;
        var lastOp = 1;
        var lm = '', lr = 0, ls = 1;
        var sr = null;
        var blockStack = [];
        var attrs = {};
        var aperAttrs = {};
        var objAttrs = null;
        var comments = [];
        var warnings = [];
        var notes = [];             //{code, vars} for each warning, used to translate them
        var warned = {};
        var stats = { flashes: 0, lines: 0, arcs: 0, regions: 0 };
        var imageNegative = false;
        var offA = 0, offB = 0;
        var layerName = '';
        var ended = false;

        function warn(key, msg, code, vars) {
            if (!warned[key]) {
                warned[key] = true;
                warnings.push(msg);
                notes.push({ code: code || key, vars: vars || {} });
            }
        }

        function unit() {
            if (units === null) {
                units = 'in';
                warn('mo', 'No unit (%MO) command; assuming inches.');
            }
            return units === 'in' ? 25.4 : 1;
        }

        function out() {
            if (!cur || cur.dark !== dark) {
                cur = { dark: dark, items: [] };
                groups.push(cur);
            }
            return cur.items;
        }

        function meta(k, extra) {
            var o = { k: k };
            if (ap) {
                o.d = ap.num;
            }
            if (objAttrs) {
                o.at = objAttrs;
            }
            if (extra) {
                for (var key in extra) {
                    o[key] = extra[key];
                }
            }
            return o;
        }

        function push(it, o) {
            it.o = o;
            it.b = G.itemBounds(it);
            out().push(it);
        }

        function num(str, axis) {
            if (str.indexOf('.') >= 0) {
                return parseFloat(str) * unit();
            }
            var neg = false;
            if (str.charAt(0) === '+' || str.charAt(0) === '-') {
                neg = str.charAt(0) === '-';
                str = str.slice(1);
            }
            var ni = axis === 'x' ? fmt.xi : fmt.yi;
            var nd = axis === 'x' ? fmt.xd : fmt.yd;
            if (fmt.zero === 'T') {
                while (str.length < ni + nd) {
                    str += '0';
                }
            }
            var v = parseInt(str, 10) / Math.pow(10, nd);
            if (!isFinite(v)) {
                v = 0;
            }
            return (neg ? -v : v) * unit();
        }

        /* ---------- aperture templates ---------- */
        function template(a) {
            var key = lm + '|' + lr + '|' + ls;
            a.cache = a.cache || {};
            if (a.cache[key]) {
                return a.cache[key];
            }
            var base = a.base;
            if (!base) {
                if (a.macro) {
                    base = macroShapes(evalMacro(a.macro, a.rawParams), a.unit);
                } else {
                    base = standardShapes(a).map(withBounds);
                }
                a.base = base;
            }
            var items = base;
            if (lm || lr || ls !== 1) {
                var mx = lm.indexOf('X') >= 0 ? -1 : 1;
                var my = lm.indexOf('Y') >= 0 ? -1 : 1;
                var c = Math.cos(lr * DEG) * ls, s = Math.sin(lr * DEG) * ls;
                var m = [c * mx, s * mx, -s * my, c * my, 0, 0];
                items = base.map(function (it) { return G.applyToItem(it, m); });
            }
            a.cache[key] = items;
            return items;
        }

        function flash(px, py) {
            if (!ap) {
                warn('noap', 'Flash without a selected aperture.', 'noapflash');
                return;
            }
            ap.uses++;
            stats.flashes++;
            if (ap.type === 'block') {
                flashBlock(ap, px, py);
                return;
            }
            var o = meta('flash', { x: px, y: py });
            var tpl = template(ap);
            var items = out();
            for (var i = 0; i < tpl.length; i++) {
                var it = G.translateItem(tpl[i], px, py);
                it.o = o;
                items.push(it);
            }
        }

        function flashBlock(a, px, py) {
            if (lm || lr || ls !== 1) {
                warn('blocktf', 'Mirroring, rotation and scaling of block apertures are not applied.');
            }
            for (var i = 0; i < a.groups.length; i++) {
                var g = a.groups[i];
                var items = g.items.map(function (it) { return G.translateItem(it, px, py); });
                groups.push({ dark: dark ? g.dark : !g.dark, items: items });
            }
            cur = null;
        }

        function strokeWidth() {
            if (!ap) {
                return 0;
            }
            if (ap.type === 'C') {
                return (ap.params[0] || 0) * ls;
            }
            if (ap.type === 'O' || ap.type === 'R') {
                return Math.min(ap.params[0], ap.params[1]) * ls;
            }
            if (ap.type === 'P') {
                return (ap.params[0] || 0) * ls;
            }
            return 0;
        }

        function line(x1, y1, x2, y2) {
            if (!ap) {
                warn('noap', 'Draw without a selected aperture.', 'noapdraw');
                return;
            }
            ap.uses++;
            stats.lines++;
            var o = meta('trace');
            if (ap.type === 'C') {
                var w = strokeWidth();
                if (x1 === x2 && y1 === y2) {
                    push({ t: 'c', x: x1, y: y1, r: w / 2 }, o);
                } else {
                    push({ t: 'l', x1: x1, y1: y1, x2: x2, y2: y2, w: w }, o);
                }
                return;
            }
            //Non circular aperture: sweep its outline (convex hull of both ends)
            var tpl = template(ap);
            var pts = [];
            tpl.forEach(function (it) {
                var cs = it.t === 'p' ? [it.c[0]] : (it.t === 'c' ? [G.circleContour(it.x, it.y, it.r, true)] :
                    (it.t === 'l' ? [lineHull(it)] : []));
                cs.forEach(function (c) {
                    for (var i = 0; i < c.length; i += 2) {
                        pts.push(c[i] + x1, c[i + 1] + y1, c[i] + x2, c[i + 1] + y2);
                    }
                });
            });
            if (pts.length >= 6) {
                push({ t: 'p', c: [G.convexHull(pts)] }, o);
            }
        }

        function lineHull(it) {
            var c = [];
            var ang = Math.atan2(it.y2 - it.y1, it.x2 - it.x1);
            c.push(it.x2 + it.w / 2 * Math.cos(ang - Math.PI / 2), it.y2 + it.w / 2 * Math.sin(ang - Math.PI / 2));
            G.flattenArc(c, it.x2, it.y2, it.w / 2, ang - Math.PI / 2, Math.PI);
            c.push(it.x1 + it.w / 2 * Math.cos(ang + Math.PI / 2), it.y1 + it.w / 2 * Math.sin(ang + Math.PI / 2));
            G.flattenArc(c, it.x1, it.y1, it.w / 2, ang + Math.PI / 2, Math.PI);
            return c;
        }

        //Center, radius, start angle and signed sweep of a circular segment
        function arcGeom(x1, y1, x2, y2, i, j, cw) {
            var full = Math.hypot(x2 - x1, y2 - y1) < 1e-7;
            function make(cx, cy) {
                var r0 = Math.hypot(x1 - cx, y1 - cy), r1 = Math.hypot(x2 - cx, y2 - cy);
                var a0 = Math.atan2(y1 - cy, x1 - cx), a1 = Math.atan2(y2 - cy, x2 - cx);
                var sw;
                if (full) {
                    sw = multiQuadrant ? (cw ? -TAU : TAU) : 0;
                } else if (cw) {
                    sw = a1 - a0;
                    if (sw >= 0) {
                        sw -= TAU;
                    }
                } else {
                    sw = a1 - a0;
                    if (sw <= 0) {
                        sw += TAU;
                    }
                }
                return { cx: cx, cy: cy, r: (r0 + r1) / 2, a0: a0, sw: sw, err: Math.abs(r0 - r1) };
            }
            if (multiQuadrant) {
                return make(x1 + i, y1 + j);
            }
            var best = null;
            [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (s) {
                var g = make(x1 + s[0] * Math.abs(i), y1 + s[1] * Math.abs(j));
                var ok = Math.abs(g.sw) <= Math.PI / 2 + 1e-4;
                var score = g.err + (ok ? 0 : 1e6);
                if (!best || score < best.score) {
                    g.score = score;
                    best = g;
                }
            });
            return best;
        }

        function arc(x1, y1, x2, y2, i, j, cw) {
            if (!ap) {
                warn('noap', 'Draw without a selected aperture.', 'noapdraw');
                return;
            }
            ap.uses++;
            stats.arcs++;
            var g = arcGeom(x1, y1, x2, y2, i, j, cw);
            if (ap.type !== 'C') {
                warn('arcap', 'Arcs drawn with a non circular aperture are approximated.');
            }
            var w = strokeWidth();
            if (g.sw === 0 || g.r === 0) {
                push({ t: 'c', x: x1, y: y1, r: w / 2 }, meta('arc'));
                return;
            }
            push({ t: 'a', cx: g.cx, cy: g.cy, r: g.r, a0: g.a0, sw: g.sw, w: w }, meta('arc'));
        }

        /* ---------- regions ---------- */
        function contourAdd(x1, y1, x2, y2, i, j) {
            if (!contour) {
                contour = [x1, y1];
                contourHasSeg = false;
            }
            if (interp === 1) {
                contour.push(x2, y2);
            } else {
                var g = arcGeom(x1, y1, x2, y2, i, j, interp === 2);
                if (g.sw === 0) {
                    contour.push(x2, y2);
                } else {
                    G.flattenArc(contour, g.cx, g.cy, g.r, g.a0, g.sw);
                    //Land exactly on the declared end point
                    contour[contour.length - 2] = x2;
                    contour[contour.length - 1] = y2;
                }
            }
            contourHasSeg = true;
        }

        function contourClose() {
            if (contour && contourHasSeg) {
                G.dropClosingPoint(contour);
                if (contour.length >= 6) {
                    stats.regions++;
                    var o = { k: 'region' };
                    if (objAttrs) {
                        o.at = objAttrs;
                    }
                    push({ t: 'p', c: [G.orient(contour, true)] }, o);
                }
            }
            contour = null;
            contourHasSeg = false;
        }

        /* ---------- step and repeat ---------- */
        function srClose() {
            if (!sr) {
                return;
            }
            var block = groups.slice(sr.start);
            for (var ix = 0; ix < sr.nx; ix++) {
                for (var iy = 0; iy < sr.ny; iy++) {
                    if (ix === 0 && iy === 0) {
                        continue;
                    }
                    var dx = ix * sr.dx, dy = iy * sr.dy;
                    for (var gi = 0; gi < block.length; gi++) {
                        groups.push({
                            dark: block[gi].dark,
                            items: block[gi].items.map(function (it) { return G.translateItem(it, dx, dy); })
                        });
                    }
                }
            }
            sr = null;
            cur = null;
        }

        /* ---------- extended (%) commands ---------- */
        function attrValue(body) {
            var idx = body.indexOf(',');
            return idx < 0 ? [body, ''] : [body.slice(0, idx), body.slice(idx + 1)];
        }

        function handleAttr(cmd, body) {
            var kv = attrValue(body);
            var name = kv[0].replace(/^\./, '');
            if (cmd === 'TF') {
                attrs[name] = kv[1];
            } else if (cmd === 'TA') {
                aperAttrs = Object.assign({}, aperAttrs);
                aperAttrs[name] = kv[1];
            } else if (cmd === 'TO') {
                objAttrs = Object.assign({}, objAttrs || {});
                objAttrs[name] = kv[1];
            } else if (cmd === 'TD') {
                if (name === '') {
                    objAttrs = null;
                    aperAttrs = {};
                } else {
                    if (objAttrs && objAttrs[name] !== undefined) {
                        objAttrs = Object.assign({}, objAttrs);
                        delete objAttrs[name];
                        if (Object.keys(objAttrs).length === 0) {
                            objAttrs = null;
                        }
                    }
                    if (aperAttrs[name] !== undefined) {
                        aperAttrs = Object.assign({}, aperAttrs);
                        delete aperAttrs[name];
                    }
                }
            }
        }

        function extended(content) {
            content = content.replace(/[\r\n]+/g, '');
            var parts = content.split('*');
            var first = parts[0].trim();
            if (first.slice(0, 2) === 'AM') {
                var name = first.slice(2);
                macros[name] = parseMacro(name, parts.slice(1));
                return;
            }
            for (var i = 0; i < parts.length; i++) {
                var p = parts[i].trim();
                if (p !== '') {
                    extendedOne(p);
                }
            }
        }

        function extendedOne(p) {
            var code = p.slice(0, 2);
            var rest = p.slice(2);
            var m;
            switch (code) {
                case 'FS':
                    m = /^([LTD]?)([AI]?)(?:N\d+)?(?:G\d+)?X(\d)(\d)Y(\d)(\d)/.exec(rest);
                    if (m) {
                        fmt.zero = m[1] === 'T' ? 'T' : 'L';
                        fmt.abs = m[2] !== 'I';
                        fmt.xi = +m[3]; fmt.xd = +m[4]; fmt.yi = +m[5]; fmt.yd = +m[6];
                        fmt.set = true;
                        if (!fmt.abs) {
                            warn('inc', 'Incremental coordinates (deprecated) are in use.');
                        }
                    }
                    break;
                case 'MO':
                    units = rest.indexOf('IN') === 0 ? 'in' : 'mm';
                    unitSeen = true;
                    break;
                case 'AD':
                    defineAperture(rest);
                    break;
                case 'LP':
                    dark = rest.charAt(0) !== 'C';
                    break;
                case 'LM':
                    lm = rest === 'N' ? '' : rest;
                    break;
                case 'LR':
                    lr = parseFloat(rest) || 0;
                    break;
                case 'LS':
                    ls = parseFloat(rest) || 1;
                    break;
                case 'SR':
                    srClose();
                    m = /X(\d+)Y(\d+)I([-+\d.]+)J([-+\d.]+)/.exec(rest);
                    if (m && (+m[1] > 1 || +m[2] > 1)) {
                        sr = { nx: +m[1], ny: +m[2], dx: parseFloat(m[3]) * unit(), dy: parseFloat(m[4]) * unit(), start: groups.length };
                        cur = null;
                    }
                    break;
                case 'AB':
                    if (rest === '') {
                        if (blockStack.length) {
                            var ctx = blockStack.pop();
                            var blockGroups = groups;
                            groups = ctx.groups;
                            cur = null;
                            apertures[ctx.num] = { num: ctx.num, type: 'block', params: [], groups: blockGroups, uses: 0, attrs: {} };
                        }
                    } else {
                        m = /^D(\d+)/.exec(rest);
                        if (m) {
                            blockStack.push({ num: +m[1], groups: groups });
                            groups = [];
                            cur = null;
                        }
                    }
                    break;
                case 'TF':
                case 'TA':
                case 'TO':
                case 'TD':
                    handleAttr(code, rest);
                    break;
                case 'IP':
                    imageNegative = rest.indexOf('NEG') === 0;
                    break;
                case 'OF':
                    m = /A([-+\d.]+)/.exec(rest);
                    offA = m ? parseFloat(m[1]) * unit() : 0;
                    m = /B([-+\d.]+)/.exec(rest);
                    offB = m ? parseFloat(m[1]) * unit() : 0;
                    break;
                case 'LN':
                    layerName = rest;
                    break;
                case 'IN':
                    if (!layerName) {
                        layerName = rest;
                    }
                    break;
                case 'SF':
                case 'MI':
                case 'IR':
                    if (!/^(A1(\.0*)?B1(\.0*)?|A0B0|0|A0B0C0)$/.test(rest)) {
                        warn(code, 'Deprecated %' + code + ' image transformation is ignored.', 'deprecated', { cmd: code });
                    }
                    break;
                default:
                    break;
            }
        }

        function defineAperture(rest) {
            var m = /^D(\d+)([^,]+?)(?:,(.*))?$/.exec(rest);
            if (!m) {
                return;
            }
            var numD = +m[1];
            var type = m[2].trim();
            var raw = m[3] !== undefined && m[3] !== '' ? m[3].split('X').map(function (v) { return parseFloat(v); }) : [];
            var u = unit();
            var a = { num: numD, type: type, rawParams: raw, uses: 0, attrs: aperAttrs, unit: u };
            if (type === 'C' || type === 'R' || type === 'O' || type === 'P') {
                a.params = raw.slice();
                if (type === 'P') {
                    a.params[0] = (raw[0] || 0) * u;
                    if (raw[3]) {
                        a.params[3] = raw[3] * u;
                    }
                } else {
                    a.params = raw.map(function (v) { return (v || 0) * u; });
                }
            } else if (macros[type]) {
                a.macro = macros[type];
                a.params = raw.slice();
            } else {
                warn('macro:' + type, 'Unknown aperture template "' + type + '".', 'macro', { name: type });
                a.params = [];
                a.type = 'C';
                a.unknown = type;
            }
            a.desc = describeAperture(a);
            apertures[numD] = a;
        }

        /* ---------- word commands ---------- */
        function comment(textC) {
            var c = textC.trim();
            var x2 = /^#@!\s*(T[FAOD])(.*)$/.exec(c);
            if (x2) {
                handleAttr(x2[1], x2[2].trim());
                return;
            }
            if (comments.length < 40) {
                comments.push(c);
            }
        }

        function word(w) {
            var trimmed = w.replace(/^[\s]+/, '');
            if (/^G0*4(?!\d)/.test(trimmed)) {
                comment(trimmed.replace(/^G0*4/, ''));
                return;
            }
            w = w.replace(/\s+/g, '');
            if (w === '') {
                return;
            }
            var re = /([GDMXYIJN])([+-]?[\d.]+)/g;
            var m;
            var nx = null, ny = null, ni = null, nj = null, op = null;
            while ((m = re.exec(w)) !== null) {
                var letter = m[1];
                var val = m[2];
                switch (letter) {
                    case 'G':
                        var g = parseInt(val, 10);
                        if (g === 1 || g === 10 || g === 11 || g === 12) {
                            interp = 1;
                        } else if (g === 2) {
                            interp = 2;
                        } else if (g === 3) {
                            interp = 3;
                        } else if (g === 36) {
                            region = true;
                            contour = null;
                        } else if (g === 37) {
                            contourClose();
                            region = false;
                        } else if (g === 74) {
                            multiQuadrant = false;
                        } else if (g === 75) {
                            multiQuadrant = true;
                        } else if (g === 70) {
                            units = 'in';
                        } else if (g === 71) {
                            units = 'mm';
                        } else if (g === 90) {
                            fmt.abs = true;
                        } else if (g === 91) {
                            fmt.abs = false;
                        }
                        break;
                    case 'X':
                        nx = num(val, 'x');
                        break;
                    case 'Y':
                        ny = num(val, 'y');
                        break;
                    case 'I':
                        ni = num(val, 'x');
                        break;
                    case 'J':
                        nj = num(val, 'y');
                        break;
                    case 'D':
                        var d = parseInt(val, 10);
                        if (d >= 10) {
                            ap = apertures[d] || null;
                            if (!ap) {
                                warn('und' + d, 'Aperture D' + d + ' is used but never defined.', 'undef', { d: d });
                            }
                        } else if (d >= 1 && d <= 3) {
                            op = d;
                        }
                        break;
                    case 'M':
                        if (parseInt(val, 10) === 2 || parseInt(val, 10) === 0) {
                            ended = true;
                        }
                        break;
                }
            }
            var hasCoord = nx !== null || ny !== null || ni !== null || nj !== null;
            if (op === null) {
                if (!hasCoord) {
                    return;
                }
                op = lastOp;
            }
            lastOp = op;
            var tx = x, ty = y;
            if (fmt.abs) {
                if (nx !== null) tx = nx;
                if (ny !== null) ty = ny;
            } else {
                if (nx !== null) tx = x + nx;
                if (ny !== null) ty = y + ny;
            }
            var ii = ni || 0, jj = nj || 0;
            if (op === 1) {
                if (region) {
                    contourAdd(x, y, tx, ty, ii, jj);
                } else if (interp === 1) {
                    line(x, y, tx, ty);
                } else {
                    arc(x, y, tx, ty, ii, jj, interp === 2);
                }
            } else if (op === 2) {
                if (region) {
                    contourClose();
                }
            } else if (op === 3) {
                if (region) {
                    warn('d3reg', 'Flash inside a region is not allowed and was skipped.');
                } else {
                    flash(tx, ty);
                }
            }
            x = tx;
            y = ty;
        }

        /* ---------- tokenizer ---------- */
        var i = 0;
        var len = text.length;
        var nextPct = -1;       //cached position of the next '%', -1 = unknown
        while (i < len && !ended) {
            var ch = text.charCodeAt(i);
            if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
                i++;
                continue;
            }
            if (ch === 37) { // %
                var end = text.indexOf('%', i + 1);
                if (end < 0) {
                    end = len;
                }
                extended(text.slice(i + 1, end));
                i = end + 1;
                continue;
            }
            var star = text.indexOf('*', i);
            if (nextPct !== len && nextPct < i) {
                nextPct = text.indexOf('%', i);
                if (nextPct < 0) {
                    nextPct = len;
                }
            }
            var pct = nextPct < len ? nextPct : -1;
            if (star < 0) {
                star = len;
            }
            //A word never spans into an extended block; tolerate a missing '*'
            if (pct >= 0 && pct < star && !/^\s*G0*4/.test(text.slice(i, i + 6))) {
                word(text.slice(i, pct));
                i = pct;
                continue;
            }
            word(text.slice(i, star));
            i = star + 1;
        }

        if (contour) {
            warn('openreg', 'A region was not closed with G37.');
            contourClose();
        }
        srClose();
        while (blockStack.length) {
            groups = blockStack.pop().groups;
        }
        if (!unitSeen && units === null) {
            units = 'in';
        }

        //Deprecated image offset
        if (offA || offB) {
            groups.forEach(function (g) {
                g.items = g.items.map(function (it) { return G.translateItem(it, offA, offB); });
            });
        }

        var bounds = G.emptyBounds();
        var hasClear = false;
        groups = groups.filter(function (g) { return g.items.length > 0; });
        groups.forEach(function (g) {
            if (!g.dark) {
                hasClear = true;
            }
            g.items.forEach(function (it) { G.unionBounds(bounds, it.b); });
        });

        if (imageNegative && G.boundsValid(bounds)) {
            var pad = Math.max(1, 0.05 * Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]));
            var rect = rectPts(bounds[0] - pad, bounds[1] - pad, bounds[2] + pad, bounds[3] + pad);
            var bg = { t: 'p', c: [rect], o: { k: 'image' } };
            bg.b = G.itemBounds(bg);
            groups.forEach(function (g) { g.dark = !g.dark; });
            groups.unshift({ dark: true, items: [bg] });
            bounds = G.unionBounds(bounds, bg.b);
            hasClear = true;
        }

        var apList = Object.keys(apertures).map(function (k) { return apertures[k]; });
        apList.forEach(function (a) {
            delete a.cache;
            delete a.base;
        });

        return {
            kind: 'gerber',
            units: units,
            formatInfo: { zero: fmt.zero, abs: fmt.abs, xi: fmt.xi, xd: fmt.xd, yi: fmt.yi, yd: fmt.yd },
            format: (fmt.zero === 'T' ? 'Trailing' : 'Leading') + ' zero omission, ' + (fmt.abs ? 'absolute' : 'incremental') +
                ', X ' + fmt.xi + '.' + fmt.xd + ' / Y ' + fmt.yi + '.' + fmt.yd,
            x2: Object.keys(attrs).length > 0,
            apertures: apList,
            groups: groups,
            bounds: bounds,
            hasClear: hasClear,
            stats: stats,
            attrs: attrs,
            layerName: layerName,
            comments: comments,
            generator: detectGenerator(comments, attrs),
            created: detectDate(comments, attrs),
            warnings: warnings,
            notes: notes
        };
    }

    //Cheap content sniffing used before a full parse
    function looksLikeGerber(text) {
        var head = text.slice(0, 4096);
        return /%FS[LTD]?[AI]?/.test(head) || /%MO(MM|IN)\*%/.test(head) || /%ADD\d+/.test(head) ||
            (/G0?4[^*]*\*/.test(head) && /D0?[123]\*/.test(text.slice(0, 65536)));
    }

    GV.gerber = {
        parse: parse,
        looksLikeGerber: looksLikeGerber,
        evalExpr: evalExpr
    };
})(typeof window !== 'undefined' ? (window.GV = window.GV || {}) : (global.GV = global.GV || {}));
