/*
    Gerber Viewer - Excellon drill file parser

    GV.excellon.parse(text, hint) -> layer image with an extra "tools" table.
    hint.plated (true / false / null) comes from the file name when the file
    itself does not say whether its holes are plated.

    Handles METRIC / INCH with LZ / TZ zero suppression, explicit decimal
    coordinates, FILE_FORMAT comments, tool definitions in the header or the
    body, G85 slots, routed slots (G00 + M15 / G01 / G02 / G03 / M16) and
    absolute / incremental coordinates.
*/
(function (GV) {
    'use strict';

    var G = GV.geom;
    var TAU = G.TAU;

    function parse(text, hint) {
        hint = hint || {};
        var units = null;
        var zeros = null;       //'LZ' keeps leading zeros, 'TZ' keeps trailing zeros
        var intDigits = null, decDigits = null;
        var absolute = true;
        var inHeader = false;
        var tools = {};
        var tool = null;
        var x = 0, y = 0;
        var mode = 'drill';     //drill | rout
        var routMove = 0;       //0 rapid, 1 linear, 2 cw, 3 ccw
        var toolDown = false;
        var items = [];
        var comments = [];
        var warnings = [];
        var notes = [];
        var attrs = {};
        var filePlated = null;
        var pendingPlated = null;
        var stats = { holes: 0, slots: 0 };
        var bounds = G.emptyBounds();
        var ended = false;

        function unitFactor() {
            return units === 'in' ? 25.4 : 1;
        }

        function digits() {
            var i = intDigits, d = decDigits;
            if (i === null || d === null) {
                if (units === 'in') {
                    i = 2; d = 4;
                } else {
                    i = 3; d = 3;
                }
            }
            return [i, d];
        }

        function coord(str) {
            if (str === undefined || str === '') {
                return null;
            }
            if (str.indexOf('.') >= 0) {
                return parseFloat(str) * unitFactor();
            }
            var neg = false;
            if (str.charAt(0) === '+' || str.charAt(0) === '-') {
                neg = str.charAt(0) === '-';
                str = str.slice(1);
            }
            var dd = digits();
            var v;
            if (zeros === 'LZ') {
                //Leading zeros kept, so trailing zeros may be missing
                while (str.length < dd[0] + dd[1]) {
                    str += '0';
                }
                v = parseInt(str, 10) / Math.pow(10, str.length - dd[0]);
            } else {
                v = parseInt(str, 10) / Math.pow(10, dd[1]);
            }
            if (!isFinite(v)) {
                v = 0;
            }
            return (neg ? -v : v) * unitFactor();
        }

        function defineTool(name, rest) {
            var m = /C([\d.]+)/.exec(rest);
            if (!m) {
                return false;
            }
            var dia = parseFloat(m[1]);
            if (m[1].indexOf('.') < 0) {
                //Tool sizes without a decimal point use the coordinate format
                dia = coord(m[1]) / unitFactor();
            }
            var key = normTool(name);
            tools[key] = {
                name: key,
                dia: dia * unitFactor(),
                plated: pendingPlated !== null ? pendingPlated : null,
                hits: 0,
                slots: 0
            };
            pendingPlated = null;
            return true;
        }

        function normTool(name) {
            var n = parseInt(name.replace(/^T/i, ''), 10);
            if (!isFinite(n)) {
                return name;
            }
            return 'T' + (n < 10 ? '0' + n : '' + n);
        }

        function meta(kind) {
            var t = tools[tool] || { name: tool || 'T?', dia: 0, plated: null };
            return { k: kind, tool: t.name, dia: t.dia, plated: t.plated };
        }

        function radius() {
            var t = tools[tool];
            return t ? t.dia / 2 : 0;
        }

        function addItem(it) {
            it.b = G.itemBounds(it);
            G.unionBounds(bounds, it.b);
            items.push(it);
        }

        function hole(px, py) {
            if (!tool) {
                warnOnce('notool', 'A hole was drilled before any tool was selected.');
            }
            var it = { t: 'c', x: px, y: py, r: radius() };
            it.o = meta('hole');
            it.o.x = px;
            it.o.y = py;
            if (tools[tool]) {
                tools[tool].hits++;
            }
            stats.holes++;
            addItem(it);
        }

        function slot(x1, y1, x2, y2) {
            var it = { t: 'l', x1: x1, y1: y1, x2: x2, y2: y2, w: radius() * 2 };
            it.o = meta('slot');
            if (tools[tool]) {
                tools[tool].slots++;
            }
            stats.slots++;
            addItem(it);
        }

        function routArc(x1, y1, x2, y2, cw, r, i, j) {
            var cx, cy;
            if (i !== null || j !== null) {
                cx = x1 + (i || 0);
                cy = y1 + (j || 0);
            } else if (r) {
                //Center from radius: pick the side that matches the direction
                var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
                var dx = x2 - x1, dy = y2 - y1;
                var q = Math.hypot(dx, dy);
                if (q === 0 || q > 2 * r) {
                    slot(x1, y1, x2, y2);
                    return;
                }
                var h = Math.sqrt(r * r - q * q / 4);
                var sgn = cw ? -1 : 1;
                cx = mx - sgn * h * dy / q;
                cy = my + sgn * h * dx / q;
            } else {
                slot(x1, y1, x2, y2);
                return;
            }
            var a0 = Math.atan2(y1 - cy, x1 - cx), a1 = Math.atan2(y2 - cy, x2 - cx);
            var sw = a1 - a0;
            if (cw && sw >= 0) {
                sw -= TAU;
            }
            if (!cw && sw <= 0) {
                sw += TAU;
            }
            var it = { t: 'a', cx: cx, cy: cy, r: Math.hypot(x1 - cx, y1 - cy), a0: a0, sw: sw, w: radius() * 2 };
            it.o = meta('slot');
            if (tools[tool]) {
                tools[tool].slots++;
            }
            stats.slots++;
            addItem(it);
        }

        var warned = {};
        function warnOnce(k, msg, code, vars) {
            if (!warned[k]) {
                warned[k] = true;
                warnings.push(msg);
                notes.push({ code: code || k, vars: vars || {} });
            }
        }

        function platedFromText(s) {
            if (/non[_\s-]?plated|npth|\bnp\b/i.test(s)) {
                return false;
            }
            if (/plated|\bpth\b|via/i.test(s)) {
                return true;
            }
            return null;
        }

        function handleComment(c) {
            c = c.trim();
            var m;
            if ((m = /FILE_FORMAT\s*=\s*(\d+):(\d+)/i.exec(c))) {
                intDigits = +m[1];
                decDigits = +m[2];
            }
            if ((m = /^TYPE\s*=\s*(.+)$/i.exec(c))) {
                filePlated = platedFromText(m[1]);
            }
            if ((m = /#@!\s*TF\.(\w+),(.*)$/.exec(c))) {
                attrs[m[1]] = m[2];
                if (m[1] === 'FileFunction') {
                    filePlated = /^NonPlated/i.test(m[2]) ? false : (/^Plated/i.test(m[2]) ? true : filePlated);
                }
            }
            if ((m = /#@!\s*TA\.AperFunction,(.*)$/.exec(c))) {
                pendingPlated = /^NonPlated/i.test(m[1]) ? false : (/^Plated/i.test(m[1]) ? true : null);
            }
            if (/FORMAT\s*=\s*\{[^}]*decimal/i.test(c)) {
                //KiCad style: coordinates carry a decimal point anyway
            }
            if (comments.length < 40 && c !== '') {
                comments.push(c);
            }
        }

        var lines = text.split(/\r\n|\r|\n/);
        for (var li = 0; li < lines.length && !ended; li++) {
            var raw = lines[li];
            var semi = raw.indexOf(';');
            if (semi >= 0) {
                handleComment(raw.slice(semi + 1));
                raw = raw.slice(0, semi);
            }
            var line = raw.replace(/\s+/g, '').toUpperCase();
            if (line === '') {
                continue;
            }
            if (line === 'M48') {
                inHeader = true;
                continue;
            }
            if (line === '%' || line === 'M95') {
                inHeader = false;
                continue;
            }
            var m;
            //Unit and zero format lines (header, but tolerate them anywhere)
            if ((m = /^(METRIC|INCH)(?:,(LZ|TZ))?(?:,(0*)\.(0*))?/.exec(line))) {
                units = m[1] === 'INCH' ? 'in' : 'mm';
                if (m[2]) {
                    zeros = m[2];
                }
                if (m[3] !== undefined && m[4] !== undefined && (m[3].length || m[4].length)) {
                    intDigits = m[3].length;
                    decDigits = m[4].length;
                }
                continue;
            }
            if (line === 'M71') {
                units = 'mm';
                continue;
            }
            if (line === 'M72') {
                units = 'in';
                continue;
            }
            if (/^(FMAT|VER|ICI,OFF|DETECT|ATC|BLKD|SBK|SG|TCST|OSTOP|AFS|RUNTIME|M47|G93)/.test(line)) {
                if (line === 'ICI,ON') {
                    absolute = false;
                }
                continue;
            }
            if (line === 'ICI,ON') {
                absolute = false;
                continue;
            }
            //Tool definition or selection
            if ((m = /^T(\d+)(.*)$/.exec(line))) {
                if (/C[\d.]/.test(m[2])) {
                    defineTool('T' + m[1], m[2]);
                    if (inHeader) {
                        continue;
                    }
                }
                var tn = normTool('T' + m[1]);
                tool = parseInt(m[1], 10) === 0 ? null : tn;
                if (tool && !tools[tool]) {
                    warnOnce('tool' + tool, 'Tool ' + tool + ' is used without a size.', 'toolsize', { tool: tool });
                    tools[tool] = { name: tool, dia: 0, plated: null, hits: 0, slots: 0 };
                }
                continue;
            }
            if (inHeader) {
                continue;
            }
            if (line === 'M30' || line === 'M00') {
                ended = true;
                continue;
            }
            if (line === 'G90') {
                absolute = true;
                continue;
            }
            if (line === 'G91') {
                absolute = false;
                continue;
            }
            if (line === 'G05' || line === 'G81') {
                mode = 'drill';
                toolDown = false;
                continue;
            }
            if (line === 'M15') {
                toolDown = true;
                continue;
            }
            if (line === 'M16' || line === 'M17') {
                toolDown = false;
                continue;
            }

            //Coordinates (with optional G code prefix and G85 slot)
            var g85 = line.indexOf('G85');
            if (g85 > 0) {
                var p1 = readXY(line.slice(0, g85));
                var p2 = readXY(line.slice(g85 + 3));
                var sx = p1.x !== null ? p1.x : x, sy = p1.y !== null ? p1.y : y;
                var ex = p2.x !== null ? p2.x : sx, ey = p2.y !== null ? p2.y : sy;
                if (!absolute) {
                    sx = x + (p1.x || 0); sy = y + (p1.y || 0);
                    ex = sx + (p2.x || 0); ey = sy + (p2.y || 0);
                }
                slot(sx, sy, ex, ey);
                x = ex;
                y = ey;
                continue;
            }
            var gm = /^G0?([0-3])(.*)$/.exec(line);
            var rest = line;
            if (gm) {
                routMove = +gm[1];
                rest = gm[2];
                mode = 'rout';
                if (routMove === 0) {
                    toolDown = false;
                }
            }
            if (/^[XY]/.test(rest)) {
                var p = readXY(rest);
                var nx = p.x === null ? x : (absolute ? p.x : x + p.x);
                var ny = p.y === null ? y : (absolute ? p.y : y + p.y);
                if (mode === 'rout') {
                    if (routMove === 0 || !toolDown) {
                        //Rapid move or tool up: just reposition
                    } else if (routMove === 1) {
                        slot(x, y, nx, ny);
                    } else {
                        routArc(x, y, nx, ny, routMove === 2, p.a, p.i, p.j);
                    }
                } else {
                    hole(nx, ny);
                    //Repeat command (Rn) after a hole
                }
                x = nx;
                y = ny;
                continue;
            }
            if ((m = /^R(\d+)(.*)$/.exec(line))) {
                var rp = readXY(m[2]);
                for (var k = 0; k < +m[1]; k++) {
                    x += rp.x || 0;
                    y += rp.y || 0;
                    hole(x, y);
                }
                continue;
            }
        }

        function readXY(s) {
            var mx = /X([+-]?[\d.]+)/.exec(s), my = /Y([+-]?[\d.]+)/.exec(s);
            var ma = /A([+-]?[\d.]+)/.exec(s), mi = /I([+-]?[\d.]+)/.exec(s), mj = /J([+-]?[\d.]+)/.exec(s);
            return {
                x: mx ? coord(mx[1]) : null,
                y: my ? coord(my[1]) : null,
                a: ma ? coord(ma[1]) : null,
                i: mi ? coord(mi[1]) : null,
                j: mj ? coord(mj[1]) : null
            };
        }

        if (units === null) {
            units = 'in';
            warnOnce('units', 'No METRIC / INCH statement; assuming inches.');
        }

        //Plating: per tool attribute, then file attribute, then the file name hint
        var plated = filePlated !== null ? filePlated : (hint.plated !== undefined ? hint.plated : null);
        Object.keys(tools).forEach(function (k) {
            if (tools[k].plated === null) {
                tools[k].plated = plated;
            }
        });
        items.forEach(function (it) {
            if (it.o && it.o.plated === null) {
                it.o.plated = tools[it.o.tool] ? tools[it.o.tool].plated : plated;
            }
        });

        var toolList = Object.keys(tools).sort().map(function (k) { return tools[k]; });

        return {
            kind: 'drill',
            units: units,
            formatInfo: { zeros: zeros, int: digits()[0], dec: digits()[1], abs: absolute },
            format: (zeros === 'TZ' ? 'Trailing zeros' : (zeros === 'LZ' ? 'Leading zeros' : 'Decimal / default')) + ', ' +
                digits()[0] + ':' + digits()[1] + (absolute ? ', absolute' : ', incremental'),
            x2: Object.keys(attrs).length > 0,
            tools: toolList,
            apertures: [],
            groups: items.length ? [{ dark: true, items: items }] : [],
            bounds: bounds,
            hasClear: false,
            plated: plated,
            stats: stats,
            attrs: attrs,
            layerName: '',
            comments: comments,
            generator: detectGenerator(comments),
            created: detectDate(comments),
            warnings: warnings,
            notes: notes
        };
    }

    function detectGenerator(comments) {
        var names = ['EasyEDA', 'KiCad', 'Altium', 'EAGLE', 'Fusion', 'DipTrace', 'Proteus', 'OrCAD', 'Allegro', 'PADS', 'gEDA', 'Fritzing', 'Horizon', 'LibrePCB', 'CircuitMaker', 'DesignSpark'];
        for (var i = 0; i < comments.length; i++) {
            for (var j = 0; j < names.length; j++) {
                var idx = comments[i].toLowerCase().indexOf(names[j].toLowerCase());
                if (idx >= 0) {
                    return comments[i].slice(idx).split(/[,;]/)[0].trim().slice(0, 60);
                }
            }
        }
        return '';
    }

    function detectDate(comments) {
        var re = /(\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2})(?:[ T,]+(\d{1,2}:\d{2}(?::\d{2})?))?/;
        for (var i = 0; i < comments.length; i++) {
            var m = re.exec(comments[i]);
            if (m) {
                return m[1] + (m[2] ? ' ' + m[2] : '');
            }
        }
        return '';
    }

    function looksLikeExcellon(text) {
        var head = text.slice(0, 4096);
        if (/^\s*M48\b/m.test(head)) {
            return true;
        }
        return /^T\d+C[\d.]+/m.test(head) && /^X[+-]?[\d.]+Y?/m.test(text.slice(0, 65536)) && !/%FS/.test(head);
    }

    GV.excellon = {
        parse: parse,
        looksLikeExcellon: looksLikeExcellon
    };
})(typeof window !== 'undefined' ? (window.GV = window.GV || {}) : (global.GV = global.GV || {}));
