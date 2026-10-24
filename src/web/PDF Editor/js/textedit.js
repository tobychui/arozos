/*
    PDF Editor - Edit PDF (changing the text that is already on a page)

    How it works
    1. pdf.js's operator list of the page gives every text drawing
       operation with its glyphs, widths, font, colour and the text state,
       from which each run's position on the page is computed.
    2. The page's own content stream is tokenised here, which finds the
       same operations (Tj, TJ, ', ") as byte ranges. pdf.js emits exactly
       one showText per operation of the page itself (forms are skipped),
       so the n-th of each list is the same operation; when the counts
       differ the page is "imprecise" (see below).
    3. Runs on one baseline make lines, lines of one paragraph make
       blocks. Clicking a block hides its runs and puts an editable text
       object with the same text, size, colour and font style in its place.
    4. Saving replaces each hidden operation with a TJ that only moves the
       text position by the same amount ("[-1234.5] TJ"), so the glyphs are
       gone (also from copy / search) and everything after them on the line
       stays exactly where it was.

    An imprecise page (unusual content, an encrypted file) still lets the
    user edit: the old text is then covered with the colour around it
    instead of being taken out of the file.

    The screen shows a removal by painting the block's area of the
    rendered page with the colour around it (patchCanvas).
*/
window.PE = window.PE || {};

(function (PE) {
    'use strict';

    var D = PE.doc;
    var V = PE.view;
    var F = PE.fonts;
    var TE = PE.textedit = {};

    var analyses = {};      //"s:i" -> Promise<analysis>
    var projections = {};  //page id + rotation -> blocks

    var IDENT = [1, 0, 0, 1, 0, 0];

    function mul(m1, m2) {
        return [
            m1[0] * m2[0] + m1[1] * m2[2],
            m1[0] * m2[1] + m1[1] * m2[3],
            m1[2] * m2[0] + m1[3] * m2[2],
            m1[2] * m2[1] + m1[3] * m2[3],
            m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
            m1[4] * m2[1] + m1[5] * m2[3] + m2[5]
        ];
    }

    function apply(m, x, y) {
        return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    }

    function fmt(v) {
        var s = (Math.round(v * 1000) / 1000).toString();
        return s === '-0' ? '0' : s;
    }

    /* ------------------------------------------------------------ tokenizer */
    var WS = { 32: 1, 10: 1, 13: 1, 9: 1, 12: 1, 0: 1 };
    var DELIM = '()<>[]{}/%';

    function isWs(c) {
        return WS[c] === 1;
    }

    function isDelimCh(ch) {
        return DELIM.indexOf(ch) >= 0;
    }

    function skipLiteral(s, i) {
        //s[i] === '('
        var depth = 0;
        var n = s.length;
        for (; i < n; i++) {
            var ch = s.charAt(i);
            if (ch === '\\') {
                i++;
            } else if (ch === '(') {
                depth++;
            } else if (ch === ')') {
                depth--;
                if (depth === 0) {
                    return i + 1;
                }
            }
        }
        return n;
    }

    function skipHex(s, i) {
        var j = s.indexOf('>', i + 1);
        return j < 0 ? s.length : j + 1;
    }

    function skipNested(s, i, open, close) {
        //arrays [..] and dictionaries <<..>> with strings inside
        var depth = 0;
        var n = s.length;
        while (i < n) {
            var ch = s.charAt(i);
            if (ch === '(') {
                i = skipLiteral(s, i);
                continue;
            }
            if (open === '<<') {
                if (s.substr(i, 2) === '<<') {
                    depth++;
                    i += 2;
                    continue;
                }
                if (s.substr(i, 2) === '>>') {
                    depth--;
                    i += 2;
                    if (depth === 0) {
                        return i;
                    }
                    continue;
                }
                if (ch === '<') {
                    i = skipHex(s, i);
                    continue;
                }
            } else {
                if (ch === '[') {
                    depth++;
                } else if (ch === ']') {
                    depth--;
                    if (depth === 0) {
                        return i + 1;
                    }
                } else if (ch === '<') {
                    if (s.substr(i, 2) === '<<') {
                        i = skipNested(s, i, '<<', '>>');
                        continue;
                    }
                    i = skipHex(s, i);
                    continue;
                }
            }
            if (ch === '%') {
                while (i < n && s.charCodeAt(i) !== 10 && s.charCodeAt(i) !== 13) {
                    i++;
                }
                continue;
            }
            i++;
        }
        return n;
    }

    /*
        Tokenise a content stream (latin1 string). Returns the operators as
        {op, start, end, operands:[raw string]} where start..end covers the
        operands and the operator.
    */
    TE.tokenize = function (s) {
        var ops = [];
        var n = s.length;
        var i = 0;
        var operands = [];
        var opStart = -1;
        while (i < n) {
            var c = s.charCodeAt(i);
            if (isWs(c)) {
                i++;
                continue;
            }
            var ch = s.charAt(i);
            if (ch === '%') {
                while (i < n && s.charCodeAt(i) !== 10 && s.charCodeAt(i) !== 13) {
                    i++;
                }
                continue;
            }
            var t0 = i;
            if (opStart < 0) {
                opStart = i;
            }
            if (ch === '(') {
                i = skipLiteral(s, i);
                operands.push(s.substring(t0, i));
            } else if (ch === '<') {
                i = s.charAt(i + 1) === '<' ? skipNested(s, i, '<<', '>>') : skipHex(s, i);
                operands.push(s.substring(t0, i));
            } else if (ch === '[') {
                i = skipNested(s, i, '[', ']');
                operands.push(s.substring(t0, i));
            } else if (ch === '/') {
                i++;
                while (i < n && !isWs(s.charCodeAt(i)) && !isDelimCh(s.charAt(i))) {
                    i++;
                }
                operands.push(s.substring(t0, i));
            } else if (ch === ')' || ch === ']' || ch === '>' || ch === '{' || ch === '}') {
                i++;
            } else {
                while (i < n && !isWs(s.charCodeAt(i)) && !isDelimCh(s.charAt(i))) {
                    i++;
                }
                var tok = s.substring(t0, i);
                if (/^[+\-]?(\d+\.?\d*|\.\d+)$/.test(tok) || tok === 'true' || tok === 'false' || tok === 'null') {
                    operands.push(tok);
                    continue;
                }
                if (tok === 'BI') {
                    //inline image: skip its binary data up to EI
                    var id = s.indexOf('ID', i);
                    var j = id < 0 ? n : id + 3;
                    var end = n;
                    while (j < n) {
                        var k = s.indexOf('EI', j);
                        if (k < 0) {
                            break;
                        }
                        var before = s.charCodeAt(k - 1), after = k + 2 < n ? s.charCodeAt(k + 2) : 32;
                        if (isWs(before) && (isWs(after) || k + 2 >= n)) {
                            end = k + 2;
                            break;
                        }
                        j = k + 2;
                    }
                    i = end;
                    ops.push({ op: 'BI', start: opStart, end: i, operands: [] });
                } else {
                    ops.push({ op: tok, start: opStart, end: i, operands: operands });
                }
                operands = [];
                opStart = -1;
            }
        }
        return ops;
    };

    function isShow(op) {
        return op === 'Tj' || op === 'TJ' || op === '\'' || op === '"';
    }

    function toLatin1(bytes) {
        var out = '';
        var CH = 0x8000;
        for (var i = 0; i < bytes.length; i += CH) {
            out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(bytes.length, i + CH)));
        }
        return out;
    }

    function fromLatin1(s) {
        var b = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++) {
            b[i] = s.charCodeAt(i) & 0xff;
        }
        return b;
    }

    /* The decoded content of a pdf-lib page, all its streams in order */
    TE.contentOf = function (libPage) {
        var L = PDFLib;
        var node = libPage.node;
        var ctx = node.context;
        var contents = node.Contents();
        if (!contents) {
            return '';
        }
        var streams = [];
        if (contents instanceof L.PDFArray) {
            for (var i = 0; i < contents.size(); i++) {
                streams.push(ctx.lookup(contents.get(i)));
            }
        } else {
            streams.push(contents);
        }
        var parts = streams.map(function (st) {
            if (!st) {
                return '';
            }
            if (st instanceof L.PDFRawStream) {
                return toLatin1(L.decodePDFRawStream(st).decode());
            }
            if (st.getUnencodedContents) {
                return toLatin1(st.getUnencodedContents());
            }
            return toLatin1(st.getContents());
        });
        return parts.join('\n');
    };

    /* ------------------------------------------------------------ analysis */
    function colorHex(a) {
        if (!a) {
            return '#000000';
        }
        if (typeof a === 'string') {
            return /^#[0-9a-f]{6}$/i.test(a) ? a : '#000000';
        }
        return PE.rgbToHex(a[0], a[1], a[2]);
    }

    function fontInfo(page, name) {
        var f = null;
        try {
            if (page.commonObjs.has(name)) {
                f = page.commonObjs.get(name);
            }
        } catch (e) {
            f = null;
        }
        return f;
    }

    TE.classifyFont = function (f) {
        var raw = (f && f.name) || '';
        var name = raw.replace(/^[A-Z]{6}\+/, '');
        var bold = !!(f && (f.bold || f.black)) || /bold|black|heavy|semibold|demi|-bd\b|\bbd$/i.test(name);
        var italic = !!(f && f.italic) || /italic|oblique|-it$|-ital|kursiv/i.test(name);
        var base = name.split(/[-,]/)[0].replace(/(MT|PS|Std|Pro|LT|PSMT)$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
        var key = 'helv';
        var libs = F.libFamilies();
        for (var i = 0; i < libs.length; i++) {
            var lf = libs[i].toLowerCase();
            if (lf === base || lf.replace(/\s+/g, '') === base.replace(/\s+/g, '')) {
                key = 'lib:' + libs[i];
                break;
            }
        }
        if (key === 'helv') {
            if (/courier|mono|consol|menlo|typewriter/i.test(name) || (f && f.fallbackName === 'monospace')) {
                key = 'cour';
            } else if ((/times|serif|roman|georgia|garamond|cambria|minion|palatino|book|baskerville|caslon|century|song|ming|mincho|batang|bodoni|didot/i.test(name) &&
                !/sans/i.test(name)) || (f && f.fallbackName === 'serif' && !/sans|arial|helvet/i.test(name))) {
                key = 'times';
            }
        }
        return { key: key, bold: bold, italic: italic, name: name, vertical: !!(f && f.vertical), type3: !!(f && f.isType3Font) };
    };

    function walk(page, opList) {
        var OPS = pdfjsLib.OPS;
        var fnA = opList.fnArray, argA = opList.argsArray;
        var gs = { ctm: IDENT, font: null, fs: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, mode: 0, color: '#000000' };
        var stack = [];
        var forms = [];
        var tm = IDENT, tlm = IDENT;
        var depth = 0;
        var runs = [];
        function copy(g) {
            return { ctm: g.ctm, font: g.font, fs: g.fs, tc: g.tc, tw: g.tw, th: g.th, tl: g.tl, rise: g.rise, mode: g.mode, color: g.color };
        }
        for (var i = 0; i < fnA.length; i++) {
            var fn = fnA[i], a = argA[i];
            switch (fn) {
                case OPS.save: stack.push(copy(gs)); break;
                case OPS.restore: if (stack.length) { gs = stack.pop(); } break;
                case OPS.transform: gs.ctm = mul(a, gs.ctm); break;
                case OPS.paintFormXObjectBegin:
                    forms.push({ gs: copy(gs), n: stack.length, tm: tm, tlm: tlm });
                    depth++;
                    break;
                case OPS.paintFormXObjectEnd:
                    if (forms.length) {
                        var fr = forms.pop();
                        gs = fr.gs;
                        stack.length = fr.n;
                        tm = fr.tm;
                        tlm = fr.tlm;
                    }
                    depth = Math.max(0, depth - 1);
                    break;
                case OPS.beginText: tm = IDENT; tlm = IDENT; break;
                case OPS.setTextMatrix: tm = tlm = [a[0], a[1], a[2], a[3], a[4], a[5]]; break;
                case OPS.moveText: tlm = mul([1, 0, 0, 1, a[0], a[1]], tlm); tm = tlm; break;
                case OPS.setLeadingMoveText: gs.tl = -a[1]; tlm = mul([1, 0, 0, 1, a[0], a[1]], tlm); tm = tlm; break;
                case OPS.nextLine: tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm; break;
                case OPS.setLeading: gs.tl = a[0]; break;
                case OPS.setCharSpacing: gs.tc = a[0]; break;
                case OPS.setWordSpacing: gs.tw = a[0]; break;
                case OPS.setHScale: gs.th = a[0] / 100; break;
                case OPS.setTextRise: gs.rise = a[0]; break;
                case OPS.setFont: gs.font = a[0]; gs.fs = a[1]; break;
                case OPS.setTextRenderingMode: gs.mode = a[0]; break;
                case OPS.setFillRGBColor: gs.color = colorHex(a); break;
                case OPS.setGState:
                    (a[0] || []).forEach(function (entry) {
                        if (entry && entry[0] === 'Font' && entry[1]) {
                            gs.font = entry[1][0];
                            gs.fs = entry[1][1];
                        }
                    });
                    break;
                case OPS.showText: {
                    var glyphs = a[0] || [];
                    var f = fontInfo(page, gs.font);
                    var fm = (f && f.fontMatrix) || [0.001, 0, 0, 0.001, 0, 0];
                    var x = 0;
                    var text = '';
                    for (var g = 0; g < glyphs.length; g++) {
                        var gl = glyphs[g];
                        if (typeof gl === 'number') {
                            x -= gl * gs.fs / 1000;
                            if (gl < -250 && text && !/\s$/.test(text)) {
                                text += ' ';
                            }
                            continue;
                        }
                        if (!gl) {
                            continue;
                        }
                        x += (gl.width || 0) * fm[0] * gs.fs + gs.tc + (gl.isSpace ? gs.tw : 0);
                        text += gl.unicode === undefined ? '' : gl.unicode;
                    }
                    var m = mul(tm, gs.ctm);
                    if (depth === 0) {
                        runs.push({
                            n: runs.length,
                            text: text,
                            start: apply(m, 0, gs.rise),
                            end: apply(m, x * gs.th, gs.rise),
                            upEnd: apply(m, 0, gs.rise + gs.fs),
                            adv: x,
                            fs: gs.fs,
                            th: gs.th,
                            mode: gs.mode,
                            color: gs.color,
                            font: TE.classifyFont(f)
                        });
                    }
                    tm = mul([1, 0, 0, 1, x * gs.th, 0], tm);
                    break;
                }
                default:
                    break;
            }
        }
        return runs;
    }

    function analyzeSource(s, i) {
        var key = s + ':' + i;
        if (analyses[key]) {
            return analyses[key];
        }
        analyses[key] = D.sources[s].pdf.getPage(i + 1).then(function (page) {
            return page.getOperatorList().then(function (ol) {
                var runs = walk(page, ol);
                var res = { runs: runs, precise: false, count: runs.length };
                if (D.sources[s].encrypted) {
                    return res;
                }
                return D.libDoc(s).then(function (doc) {
                    var content = TE.contentOf(doc.getPage(i));
                    var ops = TE.tokenize(content).filter(function (o) { return isShow(o.op); });
                    if (ops.length !== runs.length) {
                        return res;
                    }
                    runs.forEach(function (r, n) {
                        var op = ops[n];
                        var adv = -r.adv * 1000 / (r.fs || 1);
                        var tj = r.fs ? '[' + fmt(adv) + '] TJ' : '';
                        if (op.op === '\'') {
                            r.rep = 'T* ' + tj;
                        } else if (op.op === '"') {
                            r.rep = (op.operands[0] || '0') + ' Tw ' + (op.operands[1] || '0') + ' Tc T* ' + tj;
                        } else {
                            r.rep = tj;
                        }
                        r.op = op.op;
                    });
                    res.precise = true;
                    return res;
                }).catch(function (err) {
                    console.warn('[PDF Editor] content stream not readable, Edit PDF covers text instead', err);
                    return res;
                });
            });
        }).catch(function (err) {
            console.warn('[PDF Editor] text analysis failed', err);
            return { runs: [], precise: false, count: -1 };
        });
        return analyses[key];
    }

    /* ------------------------------------------------------------ lines and blocks */
    function median(a) {
        if (!a.length) {
            return 0;
        }
        var b = a.slice().sort(function (x, y) { return x - y; });
        return b[b.length >> 1];
    }

    function project(k, an) {
        var p = D.pages[k];
        var vp = D.viewport(k, 1);
        var runs = [];
        an.runs.forEach(function (r) {
            if (r.mode === 3 || r.mode === 7 || r.font.vertical || !r.fs || !r.text.replace(/\s/g, '')) {
                return;
            }
            var S = vp.toView(r.start[0], r.start[1]);
            var E = vp.toView(r.end[0], r.end[1]);
            var U = vp.toView(r.upEnd[0], r.upEnd[1]);
            var dx = E[0] - S[0], dy = E[1] - S[1];
            var len = Math.hypot(dx, dy);
            var ux = U[0] - S[0], uy = U[1] - S[1];
            var fsv = Math.hypot(ux, uy);
            if (fsv < 0.5) {
                return;
            }
            var dir;
            if (len < 0.01) {
                //zero advance: the baseline runs a quarter turn clockwise from "up"
                dir = [-uy / fsv, ux / fsv];
            } else {
                dir = [dx / len, dy / len];
            }
            var nrm = [-dir[1], dir[0]];
            var ang = Math.atan2(dir[1], dir[0]) * 180 / Math.PI;
            var snapAng = Math.round(ang / 90) * 90;
            if (Math.abs(ang - snapAng) < 1.5) {
                ang = snapAng;
            }
            runs.push({
                r: r, S: S, len: len, fs: fsv, dir: dir, nrm: nrm, ang: ((ang % 360) + 360) % 360,
                along: S[0] * dir[0] + S[1] * dir[1],
                perp: S[0] * nrm[0] + S[1] * nrm[1]
            });
        });
        //rows: same angle and baseline
        runs.sort(function (a, b) {
            return (a.ang - b.ang) || (a.perp - b.perp) || (a.along - b.along);
        });
        var lines = [];
        var row = [];
        function flushRow() {
            if (!row.length) {
                return;
            }
            row.sort(function (a, b) { return a.along - b.along; });
            var cur = null;
            row.forEach(function (u) {
                var end = u.along + u.len;
                if (cur && u.along - cur.end < Math.max(cur.fs, u.fs) * 1.6 && u.along > cur.start - 0.5 * u.fs) {
                    var gap = u.along - cur.end;
                    if (gap > 0.18 * u.fs && !/\s$/.test(cur.text) && !/^\s/.test(u.r.text)) {
                        cur.text += ' ';
                    }
                    cur.text += u.r.text;
                    cur.runs.push(u);
                    cur.end = Math.max(cur.end, end);
                    cur.fs = Math.max(cur.fs, u.fs);
                } else {
                    cur = { runs: [u], text: u.r.text, start: u.along, end: end, perp: u.perp, fs: u.fs, ang: u.ang, dir: u.dir, nrm: u.nrm };
                    lines.push(cur);
                }
            });
            row = [];
        }
        runs.forEach(function (u) {
            if (row.length) {
                var last = row[row.length - 1];
                if (last.ang !== u.ang || Math.abs(u.perp - last.perp) > 0.3 * Math.min(u.fs, last.fs)) {
                    flushRow();
                }
            }
            row.push(u);
        });
        flushRow();
        lines.forEach(function (L) {
            L.text = L.text.replace(/\s+$/, '').replace(/^\s+/, '');
            //the dominant run sets the style
            var best = L.runs[0];
            L.runs.forEach(function (u) {
                if (u.len > best.len) {
                    best = u;
                }
            });
            L.font = best.r.font;
            L.color = best.r.color;
            L.box = lineBox(L);
        });
        //blocks: lines of one paragraph
        lines.sort(function (a, b) {
            return (a.ang - b.ang) || (a.perp - b.perp) || (a.start - b.start);
        });
        var blocks = [];
        lines.forEach(function (L) {
            var target = null;
            for (var i = blocks.length - 1; i >= 0 && i >= blocks.length - 4; i--) {
                var B = blocks[i];
                var last = B.lines[B.lines.length - 1];
                if (B.ang !== L.ang || B.font.key !== L.font.key || B.font.bold !== L.font.bold || B.font.italic !== L.font.italic ||
                    B.color !== L.color || Math.abs(L.fs - B.fs) > 0.12 * B.fs) {
                    continue;
                }
                var gap = L.perp - last.perp;
                if (gap < 0.85 * B.fs || gap > 1.75 * B.fs) {
                    continue;
                }
                if (B.lines.length > 1) {
                    var prevGap = B.lines[B.lines.length - 1].perp - B.lines[B.lines.length - 2].perp;
                    if (Math.abs(gap - prevGap) > 0.25 * B.fs) {
                        continue;
                    }
                }
                var overlap = Math.min(L.end, B.end) - Math.max(L.start, B.start);
                if (overlap < 0.3 * Math.min(L.end - L.start, B.end - B.start)) {
                    continue;
                }
                if (Math.abs(L.start - B.start) > 2.5 * B.fs && Math.abs(L.end - B.end) > 2.5 * B.fs &&
                    Math.abs((L.start + L.end) / 2 - (B.start + B.end) / 2) > 2.5 * B.fs) {
                    continue;
                }
                target = B;
                break;
            }
            if (target) {
                target.lines.push(L);
                target.start = Math.min(target.start, L.start);
                target.end = Math.max(target.end, L.end);
            } else {
                blocks.push({ lines: [L], ang: L.ang, fs: L.fs, font: L.font, color: L.color, start: L.start, end: L.end, dir: L.dir, nrm: L.nrm });
            }
        });
        blocks.forEach(function (B, idx) {
            B.id = idx;
            B.ns = [];
            B.lines.forEach(function (L) {
                L.runs.forEach(function (u) {
                    B.ns.push(u.r.n);
                });
            });
            var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            B.lines.forEach(function (L) {
                x0 = Math.min(x0, L.box.x);
                y0 = Math.min(y0, L.box.y);
                x1 = Math.max(x1, L.box.x + L.box.w);
                y1 = Math.max(y1, L.box.y + L.box.h);
            });
            B.box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
            B.text = B.lines.map(function (L) { return L.text; }).join('\n');
            //alignment
            var lefts = B.lines.map(function (L) { return L.start; });
            var rights = B.lines.map(function (L) { return L.end; });
            var mids = B.lines.map(function (L) { return (L.start + L.end) / 2; });
            function spread(a) {
                return Math.max.apply(null, a) - Math.min.apply(null, a);
            }
            B.align = 'left';
            if (B.lines.length > 1 && spread(lefts) > 1.5) {
                if (spread(rights) < 1.5) {
                    B.align = 'right';
                } else if (spread(mids) < 1.5) {
                    B.align = 'center';
                }
            }
            var gaps = [];
            for (var i = 1; i < B.lines.length; i++) {
                gaps.push(B.lines[i].perp - B.lines[i - 1].perp);
            }
            B.lh = gaps.length ? median(gaps) / B.fs : 1.2;
        });
        return blocks;
    }

    function lineBox(L) {
        var pts = [];
        var asc = 0.82 * L.fs, desc = 0.24 * L.fs;
        [L.start, L.end].forEach(function (a) {
            [-asc, desc].forEach(function (b) {
                pts.push([L.dir[0] * a + L.nrm[0] * (L.perp + b), L.dir[1] * a + L.nrm[1] * (L.perp + b)]);
            });
        });
        var xs = pts.map(function (q) { return q[0]; }), ys = pts.map(function (q) { return q[1]; });
        var x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys);
        return { x: x0, y: y0, w: Math.max.apply(null, xs) - x0, h: Math.max.apply(null, ys) - y0 };
    }

    TE.blocks = function (k) {
        var p = D.pages[k];
        if (!p || p.s < 0) {
            return Promise.resolve({ blocks: [], precise: false });
        }
        return analyzeSource(p.s, p.i).then(function (an) {
            var pk = p.id + '|' + D.totalRot(p);
            if (!projections[pk]) {
                projections[pk] = project(k, an);
            }
            return { blocks: projections[pk], precise: an.precise, an: an };
        });
    };

    function removedSet(p) {
        var set = {};
        (p.edits || []).forEach(function (ed) {
            ed.ops.forEach(function (o) {
                set[o.n] = true;
            });
        });
        return set;
    }

    /* ------------------------------------------------------------ the layer */
    TE.paintRuns = function (k) {
        var el = V.pageEl(k);
        if (!el) {
            return;
        }
        var layer = el._pe.runs;
        if (V.tool !== 'editpdf') {
            layer.innerHTML = '';
            return;
        }
        var p = D.pages[k];
        var s = V.scale();
        TE.blocks(k).then(function (res) {
            if (V.tool !== 'editpdf' || D.pages[k] !== p) {
                return;
            }
            var gone = removedSet(p);
            layer.innerHTML = '';
            res.blocks.forEach(function (B) {
                if (B.ns.some(function (n) { return gone[n]; })) {
                    return;
                }
                var d = PE.el('div', 'pe-run' + (res.precise ? '' : ' weak'));
                d.style.left = (B.box.x - 1) * s + 'px';
                d.style.top = (B.box.y - 1) * s + 'px';
                d.style.width = (B.box.w + 2) * s + 'px';
                d.style.height = (B.box.h + 2) * s + 'px';
                d.title = res.precise ? PE.T('editpdf/click', 'Click to edit this text') :
                    PE.T('editpdf/weak', 'Click to edit. This page cannot be changed in place, so the old text will be covered.');
                d.addEventListener('pointerdown', function (e) {
                    if (e.button !== 0) {
                        return;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    PE.objs.commitEdit();
                    TE.editBlock(k, B, res, e);
                });
                layer.appendChild(d);
            });
        });
    };

    /* Sample the colour around a box of the rendered page */
    function sampleBg(canvas, x, y, w, h) {
        var ctx = canvas.getContext('2d');
        var cw = canvas.width, ch = canvas.height;
        var x0 = Math.max(0, Math.floor(x) - 2), y0 = Math.max(0, Math.floor(y) - 2);
        var x1 = Math.min(cw - 1, Math.ceil(x + w) + 2), y1 = Math.min(ch - 1, Math.ceil(y + h) + 2);
        if (x1 <= x0 || y1 <= y0) {
            return '#ffffff';
        }
        var data;
        try {
            data = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
        } catch (e) {
            return '#ffffff';
        }
        var W = data.width, H = data.height, px = data.data;
        var rs = [], gs = [], bs = [];
        function take(ix, iy) {
            var o = (iy * W + ix) * 4;
            if (px[o + 3] < 128) {
                rs.push(255);
                gs.push(255);
                bs.push(255);
            } else {
                rs.push(px[o]);
                gs.push(px[o + 1]);
                bs.push(px[o + 2]);
            }
        }
        for (var ix = 0; ix < W; ix += 2) {
            take(ix, 0);
            take(ix, H - 1);
        }
        for (var iy = 0; iy < H; iy += 2) {
            take(0, iy);
            take(W - 1, iy);
        }
        return PE.rgbToHex(median(rs), median(gs), median(bs));
    }

    TE.patchCanvas = function (canvas, k, rs) {
        var p = D.pages[k];
        if (!p || !p.edits || !p.edits.length) {
            return;
        }
        var ctx = canvas.getContext('2d');
        p.edits.forEach(function (ed) {
            ed.boxes.forEach(function (b) {
                var x = b.x * rs, y = b.y * rs, w = b.w * rs, h = b.h * rs;
                var c = sampleBg(canvas, x, y, w, h);
                ctx.fillStyle = c;
                ctx.fillRect(Math.floor(x) - 1, Math.floor(y) - 1, Math.ceil(w) + 3, Math.ceil(h) + 3);
            });
        });
    };

    /* The colour around a block, from the page as rendered now */
    function blockBg(k, box) {
        var el = V.pageEl(k);
        var c = el && el._pe.canvas;
        if (!c || !c.width) {
            return '#ffffff';
        }
        var d = D.dims(k);
        var rs = c.width / d.W;
        return sampleBg(c, box.x * rs, box.y * rs, box.w * rs, box.h * rs);
    }

    TE.editBlock = function (k, B, res, e) {
        var p = D.pages[k];
        var snap = D.snapshot();
        var size = Math.round(B.fs * 10) / 10;
        var bg = blockBg(k, B.box);
        p.edits.push({
            ops: B.ns.map(function (n) {
                return { n: n, rep: res.precise && res.an.runs[n].rep !== undefined ? res.an.runs[n].rep : null };
            }),
            boxes: B.lines.map(function (L) { return L.box; }),
            bg: bg,
            count: res.an.count,
            precise: !!res.precise
        });
        var o = {
            type: 'text', text: B.text, font: B.font.key, size: size, color: B.color, bold: B.font.bold, italic: B.font.italic,
            align: B.align, lh: Math.round(PE.clamp(B.lh, 0.8, 3) * 1000) / 1000, wrap: false, angle: 0, x: 0, y: 0, w: 10, h: 10
        };
        F.fit(o);
        var pad = F.padOf(o);
        var topPerp = B.lines[0].perp;
        var alongLeft;
        if (o.align === 'right') {
            alongLeft = B.end + pad - o.w;
        } else if (o.align === 'center') {
            alongLeft = (B.start + B.end) / 2 - o.w / 2;
        } else {
            alongLeft = B.start - pad;
        }
        var perpTop = topPerp - 0.8 * size - pad;
        var cx = B.dir[0] * (alongLeft + o.w / 2) + B.nrm[0] * (perpTop + o.h / 2);
        var cy = B.dir[1] * (alongLeft + o.w / 2) + B.nrm[1] * (perpTop + o.h / 2);
        o.x = cx - o.w / 2;
        o.y = cy - o.h / 2;
        o.angle = B.ang % 360;
        //hide the old text at once on the canvas already shown; the
        //re-render that follows paints the same patch at full quality
        var shown = V.pageEl(k) && V.pageEl(k)._pe.canvas;
        if (shown && shown.width) {
            TE.patchCanvas(shown, k, shown.width / D.dims(k).W);
        }
        V.refreshPage(k, { canvas: true });
        PE.objs.add(k, o, { noUndo: true });
        PE.objs.editText(o.id, { snap: snap, isNew: true, caret: e ? { x: e.clientX, y: e.clientY } : null });
    };

    /* ------------------------------------------------------------ saving */
    /*
        Take the edited text out of a pdf-lib page. Returns false when the
        page's content no longer matches the analysis (then save.js covers
        the boxes instead).
    */
    TE.rewrite = function (outDoc, libPage, p) {
        var reps = {};
        var count = -1;
        var any = false;
        (p.edits || []).forEach(function (ed) {
            if (!ed.precise) {
                return;
            }
            count = ed.count;
            ed.ops.forEach(function (o) {
                if (o.rep !== null && o.rep !== undefined) {
                    reps[o.n] = o.rep;
                    any = true;
                }
            });
        });
        if (!any) {
            return false;
        }
        var content;
        try {
            content = TE.contentOf(libPage);
        } catch (e) {
            return false;
        }
        var ops = TE.tokenize(content);
        var shows = ops.filter(function (o) { return isShow(o.op); });
        if (shows.length !== count) {
            return false;
        }
        var out = '';
        var pos = 0;
        shows.forEach(function (op, n) {
            if (reps[n] === undefined) {
                return;
            }
            out += content.substring(pos, op.start) + ' ' + reps[n] + ' ';
            pos = op.end;
        });
        out += content.substring(pos);
        var stream = outDoc.context.flateStream(fromLatin1(out));
        libPage.node.set(PDFLib.PDFName.of('Contents'), outDoc.context.register(stream));
        return true;
    };

    TE.reset = function () {
        analyses = {};
        projections = {};
    };

    D.on('load', TE.reset);
})(window.PE);
