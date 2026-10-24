/*
    ArozOS Office - Docs: importing a PDF (DocsPdfImport)
    =====================================================
    File > Import > PDF turns a PDF into an editable document: real text
    in paragraphs that re-wrap, headings, lists, tables, pictures - never a
    picture of the page. A PDF stores none of that structure, only glyphs
    at positions, so it is rebuilt here from the geometry, the way Word's
    "PDF Reflow" does:

      1. common/pdfread.js reads every page into text runs (font, size,
         colour, position), pictures and vector shapes.
      2. Per page (analyzePage): the shapes are sorted into table rules,
         underlines, shading and drawings. A grid of rules is a table; a
         cluster of drawings with little text in it is a figure, kept as a
         picture of that region; vector bullets become bullet characters.
         What is left is cut into reading-order regions (columns are found
         as a vertical gutter that runs past several lines on both sides),
         and each region's runs into lines.
      3. Over the whole document (buildBody): running headers, footers and
         page numbers (lines that repeat on most pages) are taken out, the
         page size and margins are read from the text block, and lines are
         joined into paragraphs - a line continues the one above when the
         spacing and style match and the one above was full. Alignment,
         indents, spacing, line spacing, lists and heading levels follow
         from the same geometry.
      4. The result is a Docs body in the rich model (docs.js header,
         mod/office/docx/reader.go): inline CSS in points, data-ls line
         spacing, ul/ol.doc-list, table.of-table, span.doc-tab with
         data-tabs stops.

    Pictures and figures are stored through opts.storeImage (a link to the
    window's working copy in ArozOS, inline in the web edition), so a
    picture-heavy PDF does not become a huge body.

        DocsPdfImport.convert(bytes, {
            name,                         // the PDF's file name
            storeImage(blob, name) -> Promise<src>,
            progress(msg, done, total),
            password(retry, cb(pw|null))
        }) -> Promise<body>
*/
(function () {
    "use strict";

    var PT_PER_MM = 72 / 25.4;
    var PAGE_SIZES = { "A4": [210, 297], "Letter": [215.9, 279.4], "Legal": [215.9, 355.6] };

    /* ---------------- small helpers ---------------- */
    function median(a) {
        if (!a.length) return 0;
        var s = a.slice().sort(function (x, y) { return x - y; });
        var m = s.length >> 1;
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
    function pct(a, p) {
        if (!a.length) return 0;
        var s = a.slice().sort(function (x, y) { return x - y; });
        return s[Math.max(0, Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5)))];
    }
    function r1(v) { return Math.round(v * 10) / 10; }
    function r2(v) { return Math.round(v * 100) / 100; }
    function pt(v) { return r1(v) + "pt"; }
    function hex(c) {
        if (!c) return "#000000";
        var s = "#";
        for (var i = 0; i < 3; i++) {
            var v = Math.max(0, Math.min(255, Math.round(c[i])));
            s += (v < 16 ? "0" : "") + v.toString(16);
        }
        return s;
    }
    function isWhite(c) { return c && c !== "pattern" && c[0] >= 245 && c[1] >= 245 && c[2] >= 245; }
    function isLight(c) { return c && c[0] >= 225 && c[1] >= 225 && c[2] >= 225; }
    function cpOf(s, i) { return s.codePointAt ? s.codePointAt(i) : s.charCodeAt(i); }
    function isCJK(cp) {
        return (cp >= 0x2E80 && cp <= 0x9FFF) || (cp >= 0xAC00 && cp <= 0xD7AF) ||
            (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0xFE30 && cp <= 0xFE4F) ||
            (cp >= 0xFF00 && cp <= 0xFFEF) || (cp >= 0x20000 && cp <= 0x2FFFF);
    }
    function lastCp(s) {
        if (!s) return 0;
        var c = s.charCodeAt(s.length - 1);
        if (c >= 0xDC00 && c <= 0xDFFF && s.length > 1) return cpOf(s, s.length - 2);
        return c;
    }
    function inBox(x, y, b, tol) {
        tol = tol || 0;
        return x >= b.x0 - tol && x <= b.x1 + tol && y >= b.y0 - tol && y <= b.y1 + tol;
    }
    function runCx(r) { return (r.x0 + r.x1) / 2; }
    function runCy(r) { return r.base - r.size * 0.3; }
    // a turn of the event loop between pages (a message, not a timer: a
    // background tab runs timers once a second)
    function yield0() {
        return new Promise(function (res) {
            if (typeof MessageChannel !== "function") { setTimeout(res, 0); return; }
            var ch = new MessageChannel();
            ch.port1.onmessage = function () { res(); };
            ch.port2.postMessage(0);
        });
    }
    /* A canvas as a file. toDataURL rather than toBlob: toBlob's callback
       can take a second to come back (it waits on the browser's idle
       time), which is minutes over a document of pictures */
    function canvasBlob(canvas, type, quality) {
        try {
            var url = canvas.toDataURL(type, quality);
            var bin = atob(url.substring(url.indexOf(",") + 1));
            var arr = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            return new Blob([arr], { type: url.substring(5, url.indexOf(";")) || type });
        } catch (e) {
            return null;
        }
    }

    /* ---------------- runs ---------------- */
    // the same text drawn twice at (almost) the same place: an overprinted
    // fake bold, a drop shadow, or an OCR layer under visible text
    function dedupe(runs) {
        var buckets = {};
        var out = [];
        runs.forEach(function (r) {
            var key = Math.round(r.base);
            var dup = null;
            for (var k = key - 1; k <= key + 1 && !dup; k++) {
                var b = buckets[k];
                if (!b) continue;
                for (var i = 0; i < b.length; i++) {
                    var o = b[i];
                    // drawn over itself, not beside itself: "ll" is two letters
                    var w = Math.max(0.5, Math.min(o.x1 - o.x0, r.x1 - r.x0));
                    var overlap = Math.min(o.x1, r.x1) - Math.max(o.x0, r.x0);
                    if (o.text === r.text && overlap >= w * 0.7 && Math.abs(o.x0 - r.x0) < r.size * 0.25 &&
                        Math.abs(o.base - r.base) < r.size * 0.25 && Math.abs(o.size - r.size) < 0.5) {
                        dup = o;
                        break;
                    }
                }
            }
            if (dup) {
                if (Math.abs(dup.x0 - r.x0) > 0.05 || Math.abs(dup.base - r.base) > 0.05) dup.overprinted = true;
                // what was drawn last is what shows
                if (!r.invisible) { dup.color = r.color; dup.invisible = false; }
                return;
            }
            (buckets[key] = buckets[key] || []).push(r);
            out.push(r);
        });
        return out;
    }

    function prepareRuns(page) {
        var runs = page.runs.filter(function (r) {
            return r.text && Math.abs(r.angle) < 3 && r.size >= 2 && r.size < 500 &&
                r.x1 > -5 && r.x0 < page.width + 5 && r.bottom > -5 && r.top < page.height + 5;
        });
        var inv = 0, vis = 0;
        runs.forEach(function (r) {
            if (r.invisible) inv += r.text.length; else vis += r.text.length;
        });
        // a scanned page with a recognised text layer: the text is the page
        var ocr = inv > 20 && inv >= vis;
        runs = runs.filter(function (r) { return ocr || !r.invisible; });
        if (ocr) runs.forEach(function (r) { if (r.invisible) { r.color = [0, 0, 0]; r.invisible = false; } });
        runs = dedupe(runs);
        runs.forEach(function (r) {
            r.bold = !!(r.font.bold || r.fakeBold || r.overprinted);
            r.italic = !!r.font.italic;
        });
        return { runs: runs, ocr: ocr };
    }

    /* ---------------- shapes ---------------- */
    function classifyShapes(shapes, W, H) {
        var hl = [], vl = [], fills = [], draws = [];
        shapes.forEach(function (s) {
            if (s.alpha === 0) return;
            var w = s.x1 - s.x0, h = s.y1 - s.y0;
            if (s.x1 < 0 || s.y1 < 0 || s.x0 > W || s.y0 > H) return;
            var solidFill = s.fill && s.fill !== "pattern";
            // a page-sized background
            if (w * h > 0.6 * W * H && s.fill && !s.stroke) return;
            if (s.fill === "pattern") {
                draws.push({ x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1, n: 4, curve: true, pts: s.count, pattern: true });
            } else if (solidFill && !isWhite(s.fill)) {
                if (s.rect && h <= 2.5 && w > h * 2) {
                    hl.push({ a: s.x0, b: s.x1, pos: (s.y0 + s.y1) / 2, w: Math.max(0.5, h), color: s.fill });
                } else if (s.rect && w <= 2.5 && h > w * 2) {
                    vl.push({ a: s.y0, b: s.y1, pos: (s.x0 + s.x1) / 2, w: Math.max(0.5, w), color: s.fill });
                } else if (s.rect) {
                    fills.push({ x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1, color: s.fill });
                } else {
                    draws.push({ x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1, n: 1, curve: s.curve, pts: s.count, color: s.fill });
                }
            }
            if (s.stroke && !isWhite(s.stroke)) {
                var diag = false;
                if (s.segs) {
                    s.segs.forEach(function (g) {
                        var dx = Math.abs(g[2] - g[0]), dy = Math.abs(g[3] - g[1]);
                        if (dy <= 0.8 && dx >= 2) {
                            hl.push({ a: Math.min(g[0], g[2]), b: Math.max(g[0], g[2]), pos: (g[1] + g[3]) / 2, w: s.lw, color: s.stroke });
                        } else if (dx <= 0.8 && dy >= 2) {
                            vl.push({ a: Math.min(g[1], g[3]), b: Math.max(g[1], g[3]), pos: (g[0] + g[2]) / 2, w: s.lw, color: s.stroke });
                        } else if (dx > 0.8 || dy > 0.8) {
                            diag = true;
                        }
                    });
                }
                if (!s.segs || diag) {
                    draws.push({ x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1, n: 1, curve: s.curve, pts: s.count, color: s.stroke });
                }
            }
        });
        return { hl: mergeLines(hl), vl: mergeLines(vl), fills: fills, draws: draws };
    }

    // collinear pieces of one rule (a dashed line, a table border drawn
    // cell by cell) become one
    function mergeLines(lines) {
        lines.sort(function (p, q) { return p.pos - q.pos || p.a - q.a; });
        var groups = [];
        lines.forEach(function (l) {
            var g = groups.length ? groups[groups.length - 1] : null;
            if (g && Math.abs(l.pos - g.pos) <= 1.2) g.items.push(l);
            else groups.push({ pos: l.pos, items: [l] });
        });
        var out = [];
        groups.forEach(function (g) {
            g.items.sort(function (p, q) { return p.a - q.a; });
            var cur = null;
            g.items.forEach(function (l) {
                if (cur && l.a <= cur.b + 1.5) {
                    cur.b = Math.max(cur.b, l.b);
                    cur.w = Math.max(cur.w, l.w);
                } else {
                    cur = { a: l.a, b: l.b, pos: l.pos, w: l.w, color: l.color };
                    out.push(cur);
                }
            });
        });
        return out;
    }

    /* ---------------- tables ---------------- */
    function cluster(values, tol) {
        var s = values.slice().sort(function (a, b) { return a - b; });
        var out = [];
        var grp = [];
        s.forEach(function (v) {
            if (grp.length && v - grp[grp.length - 1] > tol) {
                out.push(median(grp));
                grp = [];
            }
            grp.push(v);
        });
        if (grp.length) out.push(median(grp));
        return out;
    }
    function coverage(lines, pos, a, b) {
        if (b <= a) return 0;
        var segs = [];
        lines.forEach(function (l) {
            if (Math.abs(l.pos - pos) > 2.5) return;
            var s = Math.max(a, l.a), e = Math.min(b, l.b);
            if (e > s) segs.push([s, e]);
        });
        segs.sort(function (p, q) { return p[0] - q[0]; });
        var tot = 0, end = a;
        segs.forEach(function (sg) {
            var s = Math.max(sg[0], end);
            if (sg[1] > s) { tot += sg[1] - s; end = sg[1]; }
        });
        return tot / (b - a);
    }
    function lineAt(lines, pos, a, b) {
        var best = null, bestCov = 0;
        lines.forEach(function (l) {
            if (Math.abs(l.pos - pos) > 2.5) return;
            var c = Math.min(b, l.b) - Math.max(a, l.a);
            if (c > bestCov) { bestCov = c; best = l; }
        });
        return best && bestCov >= (b - a) * 0.5 ? best : null;
    }

    function findTables(hl, vl, runs, W, H) {
        var n = hl.length + vl.length;
        if (hl.length < 2 || vl.length < 2 || hl.length * vl.length > 4000000) return [];
        var parent = [];
        for (var i = 0; i < n; i++) parent.push(i);
        function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
        var tol = 2.5;
        for (var h = 0; h < hl.length; h++) {
            var L = hl[h];
            for (var v = 0; v < vl.length; v++) {
                var V = vl[v];
                if (V.pos >= L.a - tol && V.pos <= L.b + tol && L.pos >= V.a - tol && L.pos <= V.b + tol) {
                    var ra = find(h), rb = find(hl.length + v);
                    if (ra !== rb) parent[ra] = rb;
                }
            }
        }
        var comps = {};
        for (i = 0; i < n; i++) {
            var root = find(i);
            var c = comps[root] = comps[root] || { h: [], v: [] };
            if (i < hl.length) c.h.push(hl[i]); else c.v.push(vl[i - hl.length]);
        }
        var tables = [];
        Object.keys(comps).forEach(function (k) {
            var c = comps[k];
            if (c.h.length < 2 || c.v.length < 2) return;
            var xs = cluster(c.v.map(function (l) { return l.pos; }), 2.5);
            var ys = cluster(c.h.map(function (l) { return l.pos; }), 2.5);
            if (xs.length < 2 || ys.length < 2) return;
            var box = { x0: xs[0], y0: ys[0], x1: xs[xs.length - 1], y1: ys[ys.length - 1] };
            var bw = box.x1 - box.x0, bh = box.y1 - box.y0;
            if (bw < 20 || bh < 8) return;
            var rows = ys.length - 1, cols = xs.length - 1;
            var inside = runs.filter(function (r) { return inBox(runCx(r), runCy(r), box, 1); });
            if (rows * cols === 1) {
                // a frame round the page or a figure, not a boxed paragraph
                if (bh > H * 0.4 || bw * bh > W * H * 0.5 || !inside.length) return;
            }
            if (!inside.length && rows * cols < 4) return;
            tables.push(buildGrid(c, xs, ys, box, inside));
        });
        return tables;
    }

    function buildGrid(comp, xs, ys, box, runs) {
        var rows = ys.length - 1, cols = xs.length - 1;
        var parent = [];
        var i;
        for (i = 0; i < rows * cols; i++) parent.push(i);
        function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
        function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); }
        function groupsOf() {
            var g = {};
            for (var q = 0; q < rows * cols; q++) {
                var rt = find(q);
                var e = g[rt] = g[rt] || { r0: 99999, r1: -1, c0: 99999, c1: -1, n: 0 };
                var rr = Math.floor(q / cols), cc = q % cols;
                e.r0 = Math.min(e.r0, rr); e.r1 = Math.max(e.r1, rr);
                e.c0 = Math.min(e.c0, cc); e.c1 = Math.max(e.c1, cc);
                e.n++;
            }
            return g;
        }
        function rectangular(g) {
            for (var key in g) {
                var e = g[key];
                if (e.n !== (e.r1 - e.r0 + 1) * (e.c1 - e.c0 + 1)) return false;
            }
            return true;
        }
        var merges = function (vertical) {
            for (var r = 0; r < rows; r++) {
                for (var c = 0; c < cols; c++) {
                    if (c + 1 < cols && coverage(comp.v, xs[c + 1], ys[r], ys[r + 1]) < 0.6) union(r * cols + c, r * cols + c + 1);
                    if (vertical && r + 1 < rows && coverage(comp.h, ys[r + 1], xs[c], xs[c + 1]) < 0.6) union(r * cols + c, (r + 1) * cols + c);
                }
            }
        };
        merges(true);
        var groups = groupsOf();
        if (!rectangular(groups)) {
            for (i = 0; i < rows * cols; i++) parent[i] = i;
            merges(false);
            groups = groupsOf();
            if (!rectangular(groups)) {
                for (i = 0; i < rows * cols; i++) parent[i] = i;
                groups = groupsOf();
            }
        }
        var cells = [];
        var anchorOf = {};
        Object.keys(groups).forEach(function (k) {
            var e = groups[k];
            var cell = {
                r: e.r0, c: e.c0, rs: e.r1 - e.r0 + 1, cs: e.c1 - e.c0 + 1,
                x0: xs[e.c0], x1: xs[e.c1 + 1], y0: ys[e.r0], y1: ys[e.r1 + 1],
                runs: [], images: []
            };
            cell.top = lineAt(comp.h, cell.y0, cell.x0, cell.x1);
            cell.bottom = lineAt(comp.h, cell.y1, cell.x0, cell.x1);
            cell.left = lineAt(comp.v, cell.x0, cell.y0, cell.y1);
            cell.right = lineAt(comp.v, cell.x1, cell.y0, cell.y1);
            cells.push(cell);
            for (var rr = e.r0; rr <= e.r1; rr++) {
                for (var cc = e.c0; cc <= e.c1; cc++) anchorOf[rr * cols + cc] = cell;
            }
        });
        var t = { kind: "table", x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1, xs: xs, ys: ys,
            rows: rows, cols: cols, cells: cells, cellAt: anchorOf, comp: comp };
        runs.forEach(function (r) {
            var cell = cellFor(t, runCx(r), runCy(r));
            if (cell) { cell.runs.push(r); r.used = true; }
        });
        return t;
    }
    function cellFor(t, x, y) {
        var c = -1, r = -1;
        for (var i = 0; i < t.cols; i++) if (x >= t.xs[i] - 1 && x <= t.xs[i + 1] + 1) { c = i; break; }
        for (var j = 0; j < t.rows; j++) if (y >= t.ys[j] - 1 && y <= t.ys[j + 1] + 1) { r = j; break; }
        if (c < 0 || r < 0) return null;
        return t.cellAt[r * t.cols + c];
    }

    /* ---------------- figures ---------------- */
    function clusterBoxes(items, gap) {
        var groups = [];
        items.sort(function (a, b) { return a.y0 - b.y0; });
        items.forEach(function (it) {
            var hit = null;
            for (var i = 0; i < groups.length; i++) {
                var g = groups[i];
                if (it.x0 <= g.x1 + gap && it.x1 >= g.x0 - gap && it.y0 <= g.y1 + gap && it.y1 >= g.y0 - gap) {
                    if (!hit) {
                        hit = g;
                        g.items.push(it);
                        g.x0 = Math.min(g.x0, it.x0); g.y0 = Math.min(g.y0, it.y0);
                        g.x1 = Math.max(g.x1, it.x1); g.y1 = Math.max(g.y1, it.y1);
                    } else {
                        // the item joins two groups: merge them
                        hit.items = hit.items.concat(g.items);
                        hit.x0 = Math.min(hit.x0, g.x0); hit.y0 = Math.min(hit.y0, g.y0);
                        hit.x1 = Math.max(hit.x1, g.x1); hit.y1 = Math.max(hit.y1, g.y1);
                        groups.splice(i, 1);
                        i--;
                    }
                }
            }
            if (!hit) groups.push({ x0: it.x0, y0: it.y0, x1: it.x1, y1: it.y1, items: [it] });
        });
        // a merge can make a group reach one it skipped: settle
        var changed = true;
        while (changed) {
            changed = false;
            for (var a = 0; a < groups.length && !changed; a++) {
                for (var b = a + 1; b < groups.length; b++) {
                    var p = groups[a], q = groups[b];
                    if (q.x0 <= p.x1 + gap && q.x1 >= p.x0 - gap && q.y0 <= p.y1 + gap && q.y1 >= p.y0 - gap) {
                        p.items = p.items.concat(q.items);
                        p.x0 = Math.min(p.x0, q.x0); p.y0 = Math.min(p.y0, q.y0);
                        p.x1 = Math.max(p.x1, q.x1); p.y1 = Math.max(p.y1, q.y1);
                        groups.splice(b, 1);
                        changed = true;
                        break;
                    }
                }
            }
        }
        return groups;
    }

    function findFigures(graphics, runs, images, W, H) {
        var items = graphics.filter(function (g) {
            var w = g.x1 - g.x0, h = g.y1 - g.y0;
            return w * h >= 1 || w >= 6 || h >= 6;
        });
        if (!items.length) return [];
        var groups = clusterBoxes(items, 4);
        var figs = [];
        groups.forEach(function (g) {
            var w = g.x1 - g.x0, h = g.y1 - g.y0;
            if (w < 18 || h < 18 || (w * h > W * H * 0.85)) return;
            var n = 0, curvePts = 0, pattern = false;
            g.items.forEach(function (it) {
                n += it.n || 1;
                if (it.curve) curvePts += it.pts || 0;
                if (it.pattern) pattern = true;
            });
            if (!(n >= 6 || curvePts >= 24 || pattern)) return;
            var box = { x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 };
            var inside = runs.filter(function (r) { return !r.used && inBox(runCx(r), runCy(r), box, 0.5); });
            var chars = 0, longRun = 0;
            inside.forEach(function (r) {
                chars += r.text.length;
                longRun = Math.max(longRun, r.text.length);
            });
            // text with lines of its own is a text box drawn round, not a picture
            if (n < 40 && (chars > 400 || longRun > 45)) return;
            // text that leaves the drawing's box stays text
            var pad = 1;
            box = { x0: box.x0 - pad, y0: box.y0 - pad, x1: box.x1 + pad, y1: box.y1 + pad };
            inside.forEach(function (r) {
                box.x0 = Math.min(box.x0, r.x0 - 0.5); box.x1 = Math.max(box.x1, r.x1 + 0.5);
                box.y0 = Math.min(box.y0, r.top - 0.5); box.y1 = Math.max(box.y1, r.bottom + 0.5);
                r.used = true;
            });
            images.forEach(function (im) {
                var cx = (im.x0 + im.x1) / 2, cy = (im.y0 + im.y1) / 2;
                if (inBox(cx, cy, box, 2)) {
                    im.used = true;
                    box.x0 = Math.min(box.x0, im.x0); box.x1 = Math.max(box.x1, im.x1);
                    box.y0 = Math.min(box.y0, im.y0); box.y1 = Math.max(box.y1, im.y1);
                }
            });
            box.x0 = Math.max(0, box.x0); box.y0 = Math.max(0, box.y0);
            box.x1 = Math.min(W, box.x1); box.y1 = Math.min(H, box.y1);
            g.items.forEach(function (it) { it.used = true; });
            figs.push({ kind: "figure", x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 });
        });
        return figs;
    }

    /* ---------------- one page ---------------- */
    function analyzePage(page) {
        var W = page.width, H = page.height;
        var prep = prepareRuns(page);
        var runs = prep.runs;
        var sh = classifyShapes(page.shapes, W, H);

        var tables = findTables(sh.hl, sh.vl, runs, W, H);
        var usedH = [], usedV = [];
        tables.forEach(function (t) {
            usedH = usedH.concat(t.comp.h);
            usedV = usedV.concat(t.comp.v);
        });
        var freeH = sh.hl.filter(function (l) { return usedH.indexOf(l) < 0; });
        var freeV = sh.vl.filter(function (l) { return usedV.indexOf(l) < 0; });

        // cell backgrounds
        sh.fills.forEach(function (f) {
            tables.forEach(function (t) {
                t.cells.forEach(function (c) {
                    var ix = Math.min(c.x1, f.x1) - Math.max(c.x0, f.x0);
                    var iy = Math.min(c.y1, f.y1) - Math.max(c.y0, f.y0);
                    if (ix > 0 && iy > 0 && ix * iy >= (c.x1 - c.x0) * (c.y1 - c.y0) * 0.75) {
                        c.bg = f.color;
                        f.used = true;
                    }
                });
            });
        });

        // underlines and strike-throughs
        var freeRuns = runs.filter(function (r) { return !r.used; });
        freeH.forEach(function (l) {
            if (l.b - l.a > W * 0.9) return;
            freeRuns.forEach(function (r) {
                var ov = Math.min(r.x1, l.b) - Math.max(r.x0, l.a);
                if (ov < (r.x1 - r.x0) * 0.6) return;
                var d = l.pos - r.base;
                if (d >= -r.size * 0.05 && d <= r.size * 0.3) { r.underline = true; l.used = true; }
                else if (d <= -r.size * 0.15 && d >= -r.size * 0.45 && l.w < r.size * 0.15) { r.strike = true; l.used = true; }
            });
        });
        freeH = freeH.filter(function (l) { return !l.used; });

        // what is left is drawing: figures, vector bullets, rules
        var graphics = sh.draws.slice();
        sh.fills.forEach(function (f) {
            if (f.used) return;
            var holds = freeRuns.some(function (r) { return inBox(runCx(r), runCy(r), f, 0.5); });
            if (!holds) graphics.push({ x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1, n: 1, color: f.color, fill: f });
        });
        freeH.concat(freeV).forEach(function (l) {
            var horiz = freeH.indexOf(l) >= 0;
            graphics.push(horiz ?
                { x0: l.a, x1: l.b, y0: l.pos - l.w / 2, y1: l.pos + l.w / 2, n: 1, rule: l, horiz: true } :
                { x0: l.pos - l.w / 2, x1: l.pos + l.w / 2, y0: l.a, y1: l.b, n: 1, rule: l });
        });

        var images = page.images.filter(function (im) {
            return (im.x1 - im.x0) >= 3 && (im.y1 - im.y0) >= 3;
        });
        // the same picture painted twice
        images = images.filter(function (im, i) {
            for (var j = i + 1; j < images.length; j++) {
                var o = images[j];
                if (Math.abs(o.x0 - im.x0) < 1 && Math.abs(o.y0 - im.y0) < 1 &&
                    Math.abs(o.x1 - im.x1) < 1 && Math.abs(o.y1 - im.y1) < 1) return false;
            }
            return true;
        });
        // a background picture or a scan under its own text layer
        images.forEach(function (im) {
            var area = (im.x1 - im.x0) * (im.y1 - im.y0);
            if (area < W * H * 0.45) return;
            var over = 0;
            freeRuns.forEach(function (r) { if (inBox(runCx(r), runCy(r), im)) over += r.text.length; });
            if (over >= 20 || prep.ocr) im.used = true;
        });

        var figures = findFigures(graphics, freeRuns, images.filter(function (im) { return !im.used; }), W, H);
        freeRuns = freeRuns.filter(function (r) { return !r.used; });

        // shading: a filled box behind text
        sh.fills.forEach(function (f) {
            if (f.used || isWhite(f.color)) return;
            freeRuns.forEach(function (r) {
                if (!inBox(runCx(r), runCy(r), f, 0.5)) return;
                var area = (f.x1 - f.x0) * (f.y1 - f.y0);
                if (!r.bgBox || area < r.bgArea) {
                    r.bg = f.color;
                    r.bgBox = f;
                    r.bgArea = area;
                }
            });
        });

        // vector bullets: a dot or a square just left of a line of text
        var synth = [];
        graphics.forEach(function (g) {
            if (g.used || g.rule) return;
            var w = g.x1 - g.x0, h = g.y1 - g.y0;
            if (w < 1.2 || h < 1.2 || w > 9 || h > 9 || w > h * 1.8 || h > w * 1.8) return;
            var cy = (g.y0 + g.y1) / 2;
            var next = null;
            freeRuns.forEach(function (r) {
                if (cy < r.top || cy > r.bottom) return;
                if (r.x0 < g.x1 - 0.5 || r.x0 > g.x1 + r.size * 3) return;
                if (!next || r.x0 < next.x0) next = r;
            });
            if (!next || w > next.size * 0.7) return;
            g.used = true;
            synth.push({
                text: g.curve ? "\u2022" : "\u25AA", x0: g.x0, x1: g.x1, base: next.base, size: next.size,
                top: next.top, bottom: next.bottom, font: next.font, color: g.color || [0, 0, 0],
                bold: false, italic: false, spaceBefore: false, letterSpacing: 0
            });
        });
        freeRuns = freeRuns.concat(synth);

        // white text that no longer has its dark box behind it
        freeRuns.forEach(function (r) {
            if (isLight(r.color) && (!r.bg || isLight(r.bg))) { r.color = [0, 0, 0]; r.bg = null; }
        });
        tables.forEach(function (t) {
            t.cells.forEach(function (c) {
                c.runs.forEach(function (r) {
                    if (isLight(r.color) && (!c.bg || isLight(c.bg))) r.color = [0, 0, 0];
                });
            });
        });

        // links
        page.links.forEach(function (lk) {
            runs.forEach(function (r) {
                if (inBox(runCx(r), runCy(r), lk, 1)) r.url = lk.url;
            });
        });

        /* pictures: inline - an icon in a line of text, or a character the
           PDF's writer could only draw as a picture of itself (a PDF made
           without a font for the script has one per character) - or blocks
           of their own */
        var blocks = [];
        var inlineImgs = [];
        var small = images.filter(function (im) {
            var h = im.y1 - im.y0;
            return !im.used && h <= 48 && (im.x1 - im.x0) <= h * 4;
        });
        small.forEach(function (im) {
            var h = im.y1 - im.y0;
            var near = freeRuns.filter(function (r) {
                return r.bottom > im.y0 && r.top < im.y1 &&
                    (Math.abs(r.x0 - im.x1) < r.size * 3 || Math.abs(im.x0 - r.x1) < r.size * 3);
            });
            var lineSize = near.length ? median(near.map(function (r) { return r.size; })) : 0;
            if (near.length && h <= lineSize * 2.2) {
                im.line = { base: median(near.map(function (r) { return r.base; })), size: lineSize, font: near[0].font };
            }
        });
        // a picture beside an inline one, as tall and on the same line, is
        // inline too: the rest of a run of character pictures
        var sameRow = function (a, b) {
            var ha = a.y1 - a.y0, hb = b.y1 - b.y0;
            return Math.abs(a.y1 - b.y1) <= ha * 0.25 && Math.abs(ha - hb) <= ha * 0.3 &&
                Math.min(Math.abs(a.x0 - b.x1), Math.abs(b.x0 - a.x1)) <= ha * 1.5;
        };
        var grew = true;
        while (grew) {
            grew = false;
            small.forEach(function (im) {
                if (im.line) return;
                for (var i = 0; i < small.length; i++) {
                    var o = small[i];
                    if (o === im || !o.line || !sameRow(im, o)) continue;
                    im.line = { base: o.line.base + (im.y1 - o.y1), size: o.line.size, font: o.line.font };
                    grew = true;
                    return;
                }
            });
        }
        // a line drawn only in character pictures: two or more in a row
        small.forEach(function (im) {
            if (im.line) return;
            var row = small.filter(function (o) { return o !== im && !o.line && sameRow(im, o); });
            if (!row.length) return;
            var h = im.y1 - im.y0;
            im.line = { base: im.y1 - h * 0.17, size: h / 1.2, font: null };
        });
        images.forEach(function (im) {
            if (im.used) return;
            if (im.line) {
                inlineImgs.push({
                    kind: "img", img: im, text: "", x0: im.x0, x1: im.x1, top: im.y0, bottom: im.y1,
                    base: im.line.base, size: im.line.size, font: im.line.font, color: [0, 0, 0], inline: true,
                    spaceBefore: !!im.spaceBefore
                });
            } else {
                blocks.push({ kind: "image", img: im, x0: im.x0, y0: im.y0, x1: im.x1, y1: im.y1 });
            }
        });
        tables.forEach(function (t) {
            blocks.push(t);
            // a picture inside a cell is that cell's
            blocks = blocks.filter(function (b) {
                if (b.kind !== "image") return true;
                var cell = cellFor(t, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
                if (!cell) return true;
                cell.images.push(b);
                return false;
            });
        });
        figures.forEach(function (f) { blocks.push(f); });
        // lines along a picture's edges are its border (Google Docs draws a
        // picture outline as four lines)
        blocks.forEach(function (b) {
            if (b.kind !== "image") return;
            var along = function (l, pos, a0, a1) {
                return !l.used && Math.abs(l.pos - pos) <= Math.max(2, l.w) &&
                    Math.min(l.b, a1) - Math.max(l.a, a0) >= (a1 - a0) * 0.8;
            };
            var edges = [];
            freeH.forEach(function (l) { if (along(l, b.y0, b.x0, b.x1) || along(l, b.y1, b.x0, b.x1)) edges.push(l); });
            freeV.forEach(function (l) { if (along(l, b.x0, b.y0, b.y1) || along(l, b.x1, b.y0, b.y1)) edges.push(l); });
            if (edges.length < 2) return;
            edges.forEach(function (l) {
                l.used = true;
                graphics.forEach(function (g) { if (g.rule === l) g.used = true; });
            });
            b.border = { w: edges[0].w, color: edges[0].color };
        });
        // a rule on its own line
        freeH.forEach(function (l) {
            if (l.used || l.b - l.a < W * 0.25) return;
            var g = graphics.filter(function (x) { return x.rule === l; })[0];
            if (g && g.used) return;
            var close = freeRuns.some(function (r) {
                return l.pos > r.top - 1.5 && l.pos < r.bottom + 1.5 && r.x1 > l.a && r.x0 < l.b;
            });
            if (!close) blocks.push({ kind: "hr", x0: l.a, x1: l.b, y0: l.pos - 0.5, y1: l.pos + 0.5, color: l.color, w: l.w });
        });

        var atoms = freeRuns.concat(inlineImgs);
        atoms.forEach(function (a) { a.kind = a.kind || "run"; a.y0 = a.top; a.y1 = a.bottom; });
        blocks.forEach(function (b) { b.top = b.y0; b.bottom = b.y1; });
        var regions = segment(atoms.concat(blocks), { left: null, right: null, col: -1 }, 0);
        regions.forEach(function (rg) { rg.items = linesOf(rg.atoms); });
        return {
            number: page.number, width: W, height: H, regions: regions,
            images: blocks.filter(function (b) { return b.kind === "image"; }).concat(inlineImgs),
            figures: figures, tables: tables
        };
    }

    /* ---------------- reading order ---------------- */
    function charsPerLine(atoms) {
        var byLine = {};
        atoms.forEach(function (a) {
            if (a.kind !== "run") return;
            var k = Math.round(a.base);
            byLine[k] = (byLine[k] || 0) + a.text.length;
        });
        var keys = Object.keys(byLine);
        if (!keys.length) return { lines: 0, avg: 0 };
        var tot = 0;
        keys.forEach(function (k) { tot += byLine[k]; });
        return { lines: keys.length, avg: tot / keys.length };
    }

    /* A column gutter: a vertical strip no atom crosses, running past at
       least three lines of real text (not a column of labels or numbers)
       on each side. The part of the region above and below the stretch it
       runs is cut off first, so a title across both columns does not hide
       the gutter under it. */
    function findGutter(atoms) {
        var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        var sizes = [];
        atoms.forEach(function (a) {
            x0 = Math.min(x0, a.x0); x1 = Math.max(x1, a.x1);
            y0 = Math.min(y0, a.y0); y1 = Math.max(y1, a.y1);
            if (a.kind === "run") sizes.push(a.size);
        });
        var w = x1 - x0;
        if (w < 100 || sizes.length < 6) return null;
        var size = median(sizes);
        var half = Math.max(2, size * 0.25);
        var best = null;
        for (var x = x0 + w * 0.15; x <= x1 - w * 0.15; x += 2) {
            var cross = atoms.filter(function (a) { return a.x0 < x + half && a.x1 > x - half; });
            cross.sort(function (a, b) { return a.y0 - b.y0; });
            var free = [];
            var at = y0;
            cross.forEach(function (a) {
                if (a.y0 > at) free.push([at, a.y0]);
                at = Math.max(at, a.y1);
            });
            if (y1 > at) free.push([at, y1]);
            free.forEach(function (iv) {
                if (iv[1] - iv[0] < size * 3) return;
                var left = [], right = [];
                atoms.forEach(function (a) {
                    var cy = (a.y0 + a.y1) / 2;
                    if (cy < iv[0] || cy > iv[1]) return;
                    if (a.x1 <= x + half) left.push(a);
                    else if (a.x0 >= x - half) right.push(a);
                });
                var L = charsPerLine(left), R = charsPerLine(right);
                var score = Math.min(L.lines, R.lines);
                if (score < 3 || L.avg < 12 || R.avg < 12) return;
                var lw = Math.max.apply(null, left.map(function (a) { return a.x1; })) - x0;
                var rw = x1 - Math.min.apply(null, right.map(function (a) { return a.x0; }));
                if (lw < w * 0.2 || rw < w * 0.2) return;
                var span = iv[1] - iv[0];
                if (!best || score > best.score || (score === best.score && span > best.span)) {
                    best = { x: x, y0: iv[0], y1: iv[1], score: score, span: span, half: half };
                }
            });
        }
        return best;
    }

    function bandsOf(atoms) {
        var sizes = atoms.filter(function (a) { return a.kind === "run"; }).map(function (a) { return a.size; });
        var gap = Math.max(4, (sizes.length ? median(sizes) : 10) * 0.9);
        var sorted = atoms.slice().sort(function (a, b) { return a.y0 - b.y0; });
        var bands = [];
        var cur = null, bottom = -Infinity;
        sorted.forEach(function (a) {
            if (cur && a.y0 - bottom >= gap) { bands.push(cur); cur = null; }
            if (!cur) { cur = []; bottom = -Infinity; }
            cur.push(a);
            bottom = Math.max(bottom, a.y1);
        });
        if (cur) bands.push(cur);
        return bands;
    }

    function segment(atoms, bounds, depth) {
        if (!atoms.length) return [];
        if (depth < 8) {
            var g = findGutter(atoms);
            if (g) {
                var above = [], below = [], left = [], right = [];
                atoms.forEach(function (a) {
                    var cy = (a.y0 + a.y1) / 2;
                    if (cy < g.y0) above.push(a);
                    else if (cy > g.y1) below.push(a);
                    else if (a.x1 <= g.x + g.half) left.push(a);
                    else right.push(a);
                });
                var lb = {
                    left: bounds.left, col: 0,
                    right: Math.max.apply(null, left.map(function (a) { return a.x1; }))
                };
                var rb = {
                    left: Math.min.apply(null, right.map(function (a) { return a.x0; })), col: 1,
                    right: bounds.right
                };
                return segment(above, bounds, depth + 1)
                    .concat(segment(left, lb, depth + 1))
                    .concat(segment(right, rb, depth + 1))
                    .concat(segment(below, bounds, depth + 1));
            }
            var bands = bandsOf(atoms);
            if (bands.length > 1) {
                var out = [];
                bands.forEach(function (b) { out = out.concat(segment(b, bounds, depth + 1)); });
                return out;
            }
        }
        return [{ atoms: atoms, bounds: bounds }];
    }

    /* ---------------- lines ---------------- */
    function isLeader(t) { return /^[.\u2026\u00B7\u2219_\-\s]{4,}$/.test(t) && /[.\u2026\u00B7_]{3}/.test(t); }

    /* "Introduction ........" drawn as one run: the dots become a run of
       their own, which finishLine turns into a dotted tab stop */
    function splitLeaders(atoms) {
        var out = [];
        atoms.forEach(function (a) {
            var m = a.kind === "run" && !isLeader(a.text) &&
                a.text.match(/^(.*?\S)?(\s*[.\u2026\u00B7]{4,}\s*)(\S.*)?$/);
            if (!m || (!m[1] && !m[3])) { out.push(a); return; }
            var parts = [m[1], m[2], m[3]].filter(function (p) { return p; });
            var tot = a.text.length;
            var x = a.x0, w = a.x1 - a.x0;
            parts.forEach(function (p, i) {
                var piece = {};
                for (var k in a) piece[k] = a[k];
                piece.text = i === 0 || !isLeader(p) ? p.replace(/^\s+|\s+$/g, "") || p : p;
                piece.x0 = x;
                piece.x1 = x + w * p.length / tot;
                piece.spaceBefore = i === 0 ? a.spaceBefore : false;
                x = piece.x1;
                out.push(piece);
            });
        });
        return out;
    }

    function linesOf(atoms) {
        var text = splitLeaders(atoms.filter(function (a) { return a.kind === "run" || a.kind === "img"; }));
        var blocks = atoms.filter(function (a) { return a.kind !== "run" && a.kind !== "img"; });
        text.sort(function (a, b) { return a.base - b.base || a.x0 - b.x0; });
        var lines = [];
        text.forEach(function (a) {
            var hit = null;
            for (var i = lines.length - 1; i >= 0 && i >= lines.length - 4; i--) {
                var L = lines[i];
                var tol = Math.min(L.size, a.size) * 0.35;
                if (Math.abs(L.base - a.base) <= tol) { hit = L; break; }
                var ov = Math.min(L.bottom, a.bottom) - Math.max(L.top, a.top);
                var hmin = Math.min(L.bottom - L.top, a.bottom - a.top);
                // a superscript or a smaller run sitting inside the line
                if (ov > hmin * 0.6 && (a.size < L.size * 0.85 || L.size < a.size * 0.85)) { hit = L; break; }
            }
            if (hit) {
                hit.atoms.push(a);
                hit.top = Math.min(hit.top, a.top);
                hit.bottom = Math.max(hit.bottom, a.bottom);
                if (a.kind === "run" && a.size > hit.size) { hit.size = a.size; hit.base = a.base; }
            } else {
                lines.push({ atoms: [a], base: a.base, size: a.size, top: a.top, bottom: a.bottom });
            }
        });
        lines.forEach(finishLine);
        var items = lines.filter(function (l) { return l.tokens.length; });
        items = items.concat(blocks);
        items.sort(function (a, b) { return (a.kind ? a.y0 : a.top) - (b.kind ? b.y0 : b.top); });
        return items;
    }

    /* A line's atoms in x order, as tokens: text with the spaces put back
       (a PDF often draws none, only a gap), and tab breaks where the gap is
       a column's worth. */
    function finishLine(L) {
        L.atoms.sort(function (a, b) { return a.x0 - b.x0; });
        var runs = L.atoms.filter(function (a) { return a.kind === "run"; });
        if (runs.length) {
            // the line's own size and baseline: its main text, not a raised note
            var bySize = {};
            runs.forEach(function (r) { var k = r1(r.size); bySize[k] = (bySize[k] || 0) + r.text.length; });
            var main = Object.keys(bySize).sort(function (a, b) { return bySize[b] - bySize[a]; })[0];
            L.size = parseFloat(main);
            var mainRuns = runs.filter(function (r) { return Math.abs(r.size - L.size) < 0.2; });
            L.base = median(mainRuns.map(function (r) { return r.base; }));
        }
        var gaps = [];
        for (var i = 1; i < L.atoms.length; i++) gaps.push(L.atoms[i].x0 - L.atoms[i - 1].x1);
        var mg = gaps.length ? median(gaps.filter(function (g) { return g > 0; })) : 0;
        var tabGap = Math.max(L.size * 1.8, mg * 3, 9);
        var tokens = [];
        var segs = [];
        var seg = null;
        var prev = null;
        L.atoms.forEach(function (a) {
            var gap = prev ? a.x0 - prev.x1 : 0;
            if (a.kind === "run" && isLeader(a.text)) {
                // a dotted leader is the look of a tab stop, not text
                if (seg) seg.leader = true;
                prev = a;
                return;
            }
            // code: in a fixed-pitch font a gap is so many spaces, never a tab
            var mono = prev && prev.kind === "run" && a.kind === "run" && prev.font && a.font &&
                prev.font.mono && a.font.mono && Math.abs(prev.size - a.size) < 0.5;
            if (mono && seg && !seg.leader) {
                var cw = (prev.x1 - prev.x0) / Math.max(1, Array.from ? Array.from(prev.text).length : prev.text.length);
                var n = cw > 0 ? Math.round(gap / cw) : 0;
                if (/\s$/.test(prev.text) || /^\s/.test(a.text)) n = Math.max(0, n - 1);
                if (n > 0) tokens.push({ space: true, next: a, n: n });
                tokens.push({ run: a });
                seg.x1 = Math.max(seg.x1, a.x1);
                prev = a;
                return;
            }
            if (!seg || gap > tabGap || (seg && seg.leader)) {
                if (seg) tokens.push({ tab: true, leader: !!seg.leader });
                seg = { x0: a.x0, x1: a.x1, leader: false };
                segs.push(seg);
            } else if (prev && a.kind === "run" && prev.kind === "run") {
                var pc = lastCp(prev.text), nc = cpOf(a.text, 0);
                var cjk = isCJK(pc) && isCJK(nc);
                var need = a.spaceBefore ? !cjk || gap > a.size * 0.5 :
                    (cjk ? gap > a.size * 0.8 : gap > Math.min(prev.size, a.size) * ((isCJK(pc) || isCJK(nc)) ? 0.25 : 0.13));
                if (need && !/\s$/.test(prev.text) && !/^\s/.test(a.text)) tokens.push({ space: true, next: a });
            } else if (prev && (gap > L.size * 0.2 || a.spaceBefore)) {
                tokens.push({ space: true, next: a });
            }
            tokens.push(a.kind === "img" ? { img: a } : { run: a });
            seg.x1 = Math.max(seg.x1, a.x1);
            prev = a;
        });
        // a tab still pending after the last text (a trailing leader) is dropped
        L.tokens = tokens;
        L.segs = segs;
        L.x0 = segs.length ? segs[0].x0 : 0;
        L.x1 = segs.length ? segs[segs.length - 1].x1 : 0;
        L.text = tokens.map(function (t) { return t.run ? t.run.text : t.space ? " " : t.tab ? "\t" : ""; }).join("");
        delete L.atoms;
    }

    /* ---------------- paragraphs ---------------- */
    var BULLET_RE = /^([\u2022\u25CF\u25CB\u25E6\u25AA\u25A0\u25A1\u25B8\u25BA\u25B6\u27A2\u27A4\u2713\u2714\u2756\u25C6\u25C7\u2043\u2219\u00B7\u2013\u2014\-*\u2023\u2794\u21E8])\s*/;
    var NUMBER_RE = /^(\(?)(\d{1,3}|[a-z]|[A-Z]|[ivxlc]{1,6}|[IVXLC]{1,6})([.)\u3001\uFF0E])(?=\s|$)/;
    var NUMBER_PAREN_RE = /^\((\d{1,3}|[a-z]|[ivx]{1,5})\)/;

    /* What a line starts with when it is a list item, and where its text
       starts. The marker is read off the line's first word, which may be
       several runs ("1" and "." drawn apart, a bullet glued to its text). */
    function listMarker(L) {
        var toks = L.tokens;
        var word = "", i;
        var starts = [];       // [token index, offset of that token in word]
        for (i = 0; i < toks.length; i++) {
            var t = toks[i];
            if (t.space || t.tab) break;
            if (!t.run) { if (!word) return null; break; }
            starts.push([i, word.length]);
            var ws = t.run.text.search(/\s/);
            if (ws === 0) break;
            if (ws > 0) { word += t.run.text.substring(0, ws); break; }
            word += t.run.text;
        }
        if (!word || !starts.length) return null;
        var info = null, mlen = 0;
        var m = word.match(BULLET_RE);
        if (m) {
            info = { kind: "bullet", marker: m[1] };
            mlen = m[1].length;
            // a dash or an asterisk only when it stands apart from the text,
            // the way a list draws it (a dash in a wrapped sentence does not)
            if (/[-*–—]/.test(m[1]) && word.length !== 1) return null;
        } else {
            var p = word.match(NUMBER_PAREN_RE);
            var n = word.match(NUMBER_RE);
            if (p && p[0].length === word.length) info = { kind: "number", raw: p[1], prefix: "(", suffix: ")" };
            else if (n && n[0].length === word.length) info = { kind: "number", raw: n[2], prefix: n[1] || "", suffix: n[3] };
            if (!info) return null;
            mlen = word.length;
            info.fmt = numberFormat(info.raw);
            info.value = numberValue(info.raw, info.fmt);
        }
        // the token and character the item's text starts at
        var markEnd = null, textX = null, markTok = starts[0][0];
        for (var k = starts.length - 1; k >= 0; k--) {
            if (starts[k][1] < mlen) {
                markTok = starts[k][0];
                var tk = toks[starts[k][0]].run;
                var within = mlen - starts[k][1];
                var frac = within / Math.max(1, tk.text.length);
                markEnd = tk.x0 + (tk.x1 - tk.x0) * Math.min(1, frac);
                if (within < tk.text.replace(/\s+$/, "").length) {
                    // the text goes on in the same run
                    info.splitTok = starts[k][0];
                    info.split = within;
                    textX = markEnd;
                }
                break;
            }
        }
        if (textX === null) {
            for (var q = markTok + 1; q < toks.length; q++) {
                var tq = toks[q];
                if (tq.run || tq.img) {
                    // a glued-on bullet's text is the next run, a spaced one's
                    // the one after the gap
                    textX = (tq.run || tq.img).x0;
                    info.skip = q;
                    break;
                }
            }
            if (mlen < word.length && info.skip === undefined) return null;
        }
        if (textX === null) return null;
        info.markerX = L.x0;
        info.textX = textX;
        info.gap = textX - markEnd;
        if (/[-*–—]/.test(info.marker || "") && info.gap < L.size * 0.4) return null;
        return info;
    }
    function numberFormat(raw) {
        if (/^\d+$/.test(raw)) return "decimal";
        if (/^[ivxlc]+$/.test(raw) && raw.length > 1 || raw === "i") return "lowerRoman";
        if (/^[IVXLC]+$/.test(raw) && raw.length > 1 || raw === "I") return "upperRoman";
        if (/^[a-z]$/.test(raw)) return "lowerLetter";
        return "upperLetter";
    }
    function numberValue(raw, fmt) {
        if (fmt === "decimal") return parseInt(raw, 10);
        if (fmt === "lowerLetter" || fmt === "upperLetter") return raw.toLowerCase().charCodeAt(0) - 96;
        var map = { i: 1, v: 5, x: 10, l: 50, c: 100 };
        var s = raw.toLowerCase(), v = 0;
        for (var i = 0; i < s.length; i++) {
            var a = map[s[i]], b = map[s[i + 1]] || 0;
            v += a < b ? -a : a;
        }
        return v;
    }

    function styleOf(r) {
        return [r.famKey, r1(r.size), r.bold ? 1 : 0, r.italic ? 1 : 0].join("|");
    }
    function lineStyle(L) {
        var n = {};
        L.tokens.forEach(function (t) {
            if (!t.run) return;
            var k = styleOf(t.run);
            n[k] = (n[k] || 0) + t.run.text.length;
        });
        var best = null;
        Object.keys(n).forEach(function (k) { if (!best || n[k] > n[best]) best = k; });
        return best || "";
    }
    function allBold(L) {
        var any = false;
        for (var i = 0; i < L.tokens.length; i++) {
            var t = L.tokens[i];
            if (!t.run || !/\S/.test(t.run.text)) continue;
            any = true;
            if (!t.run.bold) return false;
        }
        return any;
    }
    /* How wide the line's first word is - what would have had to fit at
       the end of the line above for the writer to leave it there. A word
       may be many runs (Google Docs draws every glyph by itself). */
    function firstWordWidth(L) {
        var x0 = null, x1 = null;
        for (var i = 0; i < L.tokens.length; i++) {
            var t = L.tokens[i];
            if (t.space || t.tab) { if (x0 !== null) break; continue; }
            if (t.img) {
                if (x0 === null) return t.img.x1 - t.img.x0;
                break;
            }
            var r = t.run;
            if (!r) continue;
            var txt = r.text;
            // a CJK line may break before any character
            if (isCJK(cpOf(txt, 0))) {
                var cw = (r.x1 - r.x0) / Math.max(1, txt.length);
                return x0 === null ? cw * 1.2 : (r.x0 - x0) + cw;
            }
            if (x0 === null) x0 = r.x0;
            var cut = txt.search(/\s/);
            if (cut >= 0) {
                x1 = r.x0 + (r.x1 - r.x0) * cut / Math.max(1, txt.length);
                break;
            }
            x1 = r.x1;
        }
        if (x0 === null) return L.size * 2;
        return x1 - x0;
    }
    var ENDS_SENTENCE = /[.!?:;\u3002\uFF01\uFF1F\uFF1A\uFF1B"\u201D\u300D\u300F)]$/;

    /* Lines of one region into paragraphs (and the blocks between them) */
    function paragraphsOf(region, colL, colR) {
        var items = region.items;
        var out = [];
        var para = null;
        var colW = colR - colL;
        function flush() { if (para) { out.push(para); para = null; } }
        function lineFull(A, B) {
            var room = colR - A.x1;
            return room < firstWordWidth(B) + A.size * 0.6;
        }
        function centered(L) {
            var c = (L.x0 + L.x1) / 2;
            return L.x0 > colL + L.size && Math.abs(c - (colL + colR) / 2) <= Math.max(3, colW * 0.025);
        }
        items.forEach(function (it) {
            if (it.kind) { flush(); out.push({ block: it }); return; }
            var L = it;
            L.marker = listMarker(L);
            if (L.marker && L.marker.kind === "number" && L.marker.gap < L.size * 0.25 && L.marker.skip === undefined) {
                // "1.5 litres" is a number, not an item - unless it hangs
                L.marker.weak = true;
            }
            L.style = lineStyle(L);
            L.bold = allBold(L);
            L.hasTab = L.tokens.some(function (t) { return t.tab; });
            if (para && continues(para, L)) {
                para.lines.push(L);
                return;
            }
            flush();
            para = { lines: [L] };
        });
        flush();

        function continues(P, L) {
            var A = P.lines[P.lines.length - 1];
            if (L.hasTab || A.hasTab) return false;
            if (L.marker && !L.marker.weak) return false;
            if (L.style !== A.style) {
                // the same size and family with a word in bold is still one
                // paragraph; a size or a whole-line weight change is not
                var as = A.style.split("|"), ls = L.style.split("|");
                if (as[0] !== ls[0] || Math.abs(parseFloat(as[1]) - parseFloat(ls[1])) > 0.6) return false;
                if (A.bold !== L.bold) return false;
            }
            var pitch = L.base - A.base;
            if (pitch <= A.size * 0.6) return false;
            if (P.lines.length >= 2) {
                var pp = P.lines[1].base - P.lines[0].base;
                if (Math.abs(pitch - pp) > Math.max(1.5, pp * 0.2)) return false;
            } else {
                // a line hanging under a list item's text may sit on a looser
                // pitch (a slide's) than a paragraph break would allow
                var hangs = P.lines[0].marker && !P.lines[0].marker.weak &&
                    Math.abs(L.x0 - P.lines[0].marker.textX) <= Math.max(1.5, L.size * 0.3);
                if (pitch > Math.max(A.size, L.size) * (hangs ? 2.2 : 1.75)) return false;
            }
            var bothCentered = centered(A) && centered(L) &&
                Math.abs((A.x0 + A.x1) / 2 - (L.x0 + L.x1) / 2) < L.size;
            if (bothCentered && P.lines.every(centered)) { P.breaks = true; return true; }
            var tol = Math.max(1.5, L.size * 0.3);
            var first = P.lines[0];
            if (!lineFull(A, L)) {
                /* a line in a box narrower than the column (a slide's text
                   box) never reaches its edge; it still carries on when it
                   hangs under a list item's text, or when the line above
                   did not end a sentence and this one starts in lower case */
                var cont = P.lines.length >= 2 ? P.lines[1].x0 : (first.marker ? first.marker.textX : A.x0);
                if (Math.abs(L.x0 - cont) > tol) return false;
                if (first.marker && !first.marker.weak) return true;
                var at = A.text.replace(/\s+$/, "");
                return !ENDS_SENTENCE.test(at) && /^[a-z]/.test(L.text.replace(/^\s+/, ""));
            }
            if (P.lines.length >= 2) return Math.abs(L.x0 - P.lines[1].x0) <= tol;
            if (Math.abs(L.x0 - A.x0) <= tol) return true;
            if (L.x0 < A.x0 && A.x0 - L.x0 <= L.size * 6) return true;      // first-line indent
            if (first.marker && Math.abs(L.x0 - first.marker.textX) <= tol) return true;  // hanging
            return false;
        }

        // the geometry of each paragraph
        out.forEach(function (P) {
            if (P.block) return;
            var Ls = P.lines;
            var first = Ls[0], last = Ls[Ls.length - 1];
            P.firstBase = first.base;
            P.lastBase = last.base;
            P.top = Math.min.apply(null, Ls.map(function (l) { return l.top; }));
            P.bottom = Math.max.apply(null, Ls.map(function (l) { return l.bottom; }));
            P.size = median(Ls.map(function (l) { return l.size; }));
            if (Ls.length > 1) P.pitch = median(Ls.slice(1).map(function (l, i) { return l.base - Ls[i].base; }));
            P.x0 = Math.min.apply(null, Ls.map(function (l) { return l.x0; }));
            P.x1 = Math.max.apply(null, Ls.map(function (l) { return l.x1; }));
            P.bold = Ls.every(function (l) { return l.bold; });
            P.chars = Ls.reduce(function (n, l) { return n + l.text.length; }, 0);
            P.marker = first.marker && !first.marker.weak ? first.marker : null;
            var cont = Ls.length > 1 ? Ls[1].x0 : first.x0;
            P.align = "left";
            var tolC = Math.max(3, colW * 0.025);
            if (Ls.every(centered) && (Ls.length > 1 || first.x1 < colR - first.size)) {
                P.align = "center";
            } else if (Ls.every(function (l) { return Math.abs(l.x1 - colR) <= 2; }) && first.x0 > colL + first.size * 2) {
                P.align = "right";
            } else if (Ls.length >= 3) {
                // ragged text never ends two lines on the same point
                var inner = Ls.slice(0, -1);
                var spread = Math.max.apply(null, inner.map(function (l) { return l.x1; })) -
                    Math.min.apply(null, inner.map(function (l) { return l.x1; }));
                if (spread <= 1.2 && inner[0].x1 > colR - colW * 0.1) P.align = "justify";
            } else if (Ls.length === 2 && Math.abs(first.x1 - colR) <= 1 && Math.abs(Ls[1].x0 - first.x0) <= tolC) {
                P.align = "justify";
            }
            if (P.align === "center" || P.align === "right") {
                P.marginLeft = 0;
                P.indent = 0;
                if (P.lines.length > 1) P.breaks = true;
            } else if (P.marker) {
                P.marginLeft = P.marker.textX - colL;
                P.hang = P.marker.textX - P.marker.markerX;
            } else {
                P.marginLeft = Math.max(0, cont - colL);
                P.indent = first.x0 - cont;
            }
        });
        return out;
    }

    /* ---------------- the document ---------------- */
    function lineZoneKey(L) {
        return L.text.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
    }
    var PAGE_NUM_RE = /^(page\s*|p\.\s*|\u7B2C\s*)?([\-\u2013\u2014]\s*)?(\d{1,4}|[ivxlc]{1,7})(\s*[\-\u2013\u2014])?(\s*(of|\/|\u9801|\u9875)\s*\d{1,4})?(\s*\u9801|\s*\u9875)?$/i;

    /* A picture in the top or bottom band at the same place on most pages
       is the page's letterhead or footer art */
    function blockZoneKey(b, pg) {
        if (b.kind !== "image" && b.kind !== "figure") return "";
        var zone = b.y1 < pg.height * 0.15 ? "h" : b.y0 > pg.height * 0.85 ? "f" : "";
        if (!zone) return "";
        return zone + ":pic:" + [b.x0, b.y0, b.x1, b.y1].map(function (v) { return Math.round(v / 3); }).join(",");
    }

    function stripRunning(pages) {
        var res = { header: "", footer: "", pageNumbers: false, headerTop: null, footerBottom: null,
            headerPic: null, footerPic: null };
        var count = {};
        var multi = pages.length >= 2;
        pages.forEach(function (pg) {
            var seen = {};
            pg.regions.forEach(function (rg) {
                rg.items.forEach(function (L) {
                    if (L.kind) {
                        var bk = blockZoneKey(L, pg);
                        if (bk && !seen[bk]) { seen[bk] = true; count[bk] = (count[bk] || 0) + 1; }
                        return;
                    }
                    var zone = L.bottom < pg.height * 0.1 ? "h" : L.top > pg.height * 0.9 ? "f" : "";
                    if (!zone) return;
                    var k = zone + ":" + lineZoneKey(L);
                    if (seen[k]) return;
                    seen[k] = true;
                    count[k] = (count[k] || 0) + 1;
                });
            });
        });
        var need = Math.max(2, Math.ceil(pages.length * 0.4));
        pages.forEach(function (pg) {
            pg.regions.forEach(function (rg) {
                rg.items = rg.items.filter(function (L) {
                    if (L.kind) {
                        var bk = blockZoneKey(L, pg);
                        if (!bk || !multi || count[bk] < need) return true;
                        if (bk.charAt(0) === "h") { if (!res.headerPic) res.headerPic = L; }
                        else if (!res.footerPic) res.footerPic = L;
                        return false;
                    }
                    var zone = L.bottom < pg.height * 0.1 ? "h" : L.top > pg.height * 0.9 ? "f" : "";
                    if (!zone) return true;
                    var text = L.text.trim();
                    var isNum = text.length <= 16 && PAGE_NUM_RE.test(text);
                    var repeated = multi && count[zone + ":" + lineZoneKey(L)] >= need;
                    if (isNum && (repeated || zone === "f" || multi)) {
                        res.pageNumbers = true;
                        if (zone === "f") res.footerBottom = res.footerBottom === null ? pg.height - L.bottom : Math.min(res.footerBottom, pg.height - L.bottom);
                        return false;
                    }
                    if (!repeated) return true;
                    var clean = text.replace(/\s*(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?\s*$/i, "").trim();
                    if (clean !== text) res.pageNumbers = true;
                    if (zone === "h") {
                        if (!res.header) res.header = clean;
                        res.headerTop = res.headerTop === null ? L.top : Math.min(res.headerTop, L.top);
                    } else {
                        if (!res.footer) res.footer = clean;
                        res.footerBottom = res.footerBottom === null ? pg.height - L.bottom : Math.min(res.footerBottom, pg.height - L.bottom);
                    }
                    return false;
                });
            });
            pg.regions = pg.regions.filter(function (rg) { return rg.items.length; });
        });
        return res;
    }

    /* The text block: the edges most lines reach, over every page at once
       (a page of short lines says nothing about where the margin is), and
       the top and bottom of the fuller pages */
    function textBounds(pages) {
        var xs0 = [], xs1 = [], tops = [], bots = [];
        pages.forEach(function (pg) {
            var top = Infinity, bottom = -Infinity;
            pg.regions.forEach(function (rg) {
                rg.items.forEach(function (it) {
                    if (it.kind === "hr") return;
                    // the margins are where text goes: a picture or a rule
                    // may run to the edge of the paper
                    if (it.kind) return;
                    xs0.push(it.x0);
                    xs1.push(it.x1);
                    top = Math.min(top, it.top);
                    bottom = Math.max(bottom, it.bottom);
                });
            });
            if (top < Infinity) { tops.push(top); bots.push(bottom); }
        });
        if (!xs0.length) return null;
        return {
            left: pct(xs0, 0.03),
            right: pct(xs1, 0.97),
            top: pct(tops, 0.25),
            bottom: pct(bots, 0.95),
            pages: tops.length
        };
    }

    function pickPaper(Wpt, Hpt) {
        var w = Wpt / PT_PER_MM, h = Hpt / PT_PER_MM;
        var land = w > h;
        var a = Math.min(w, h), b = Math.max(w, h);
        var best = "A4", bestD = Infinity;
        Object.keys(PAGE_SIZES).forEach(function (k) {
            var d = Math.abs(PAGE_SIZES[k][0] - a) + Math.abs(PAGE_SIZES[k][1] - b);
            if (d < bestD) { bestD = d; best = k; }
        });
        var s = PAGE_SIZES[best];
        return { size: best, orientation: land ? "landscape" : "portrait", w: land ? s[1] : s[0], h: land ? s[0] : s[1] };
    }

    /* ---------------- styles ---------------- */
    function familyOf(r) {
        var f = r.font || {};
        var fam = f.family;
        if (!fam) fam = f.mono ? "Courier New" : f.serif ? "Times New Roman" : "Arial";
        if (fam === "Helvetica") fam = "Arial";
        return fam;
    }
    function stackOf(fam, r) {
        var f = (r && r.font) || {};
        var generic = f.mono ? "monospace" : f.serif ? "serif" : "sans-serif";
        if (window.OfficeFonts && OfficeFonts.stack) return OfficeFonts.stack(fam, generic);
        return '"' + fam + '", ' + generic;
    }
    function sizeKey(v) { return Math.round(v * 2) / 2; }

    /* the editor's line height for a font stack, as a share of the size -
       what DocsLayout lays a line out with */
    var ratioCache = {};
    function ratioOf(stack) {
        if (ratioCache[stack]) return ratioCache[stack];
        var r = { asc: 0.905, desc: 0.212 };
        try {
            if (window.DocsLayout && DocsLayout.fontRatios) r = DocsLayout.fontRatios(stack);
        } catch (e) { }
        ratioCache[stack] = r;
        return r;
    }

    function loadFonts(stacks) {
        var list = Object.keys(stacks);
        var fams = list.map(function (s) { return stacks[s]; });
        var sub = (window.OfficeFonts && OfficeFonts.substitute) ? OfficeFonts.substitute(fams) : Promise.resolve();
        return Promise.resolve(sub).catch(function () { }).then(function () {
            if (!document.fonts || !document.fonts.load) return;
            return Promise.all(list.map(function (s) {
                return Promise.all([
                    document.fonts.load("16px " + s, "Hxg\u4E2D"),
                    document.fonts.load("bold 16px " + s, "Hxg\u4E2D")
                ]).catch(function () { });
            }));
        }).then(function () {
            return new Promise(function (res) { setTimeout(res, 30); });
        }).then(function () {
            if (window.DocsLayout && DocsLayout.clearMetrics) DocsLayout.clearMetrics();
            ratioCache = {};
        });
    }

    /* ---------------- HTML ---------------- */
    function el(tag, style, cls) {
        var e = document.createElement(tag);
        if (style) e.setAttribute("style", style);
        if (cls) e.className = cls;
        return e;
    }

    function Emitter(ctx) {
        this.ctx = ctx;
    }

    // the runs of a line range as spans, the paragraph's own look left off
    Emitter.prototype.inline = function (host, tokens, base, opts) {
        var ctx = this.ctx;
        var link = null, linkUrl = null;
        var target = host;
        function place(node, url) {
            if (url !== linkUrl) {
                linkUrl = url || null;
                if (url) {
                    link = el("a", "color:inherit;text-decoration:inherit;");
                    link.setAttribute("href", url);
                    host.appendChild(link);
                    target = link;
                } else {
                    link = null;
                    target = host;
                }
            }
            target.appendChild(node);
        }
        var buf = null;   // [styleKey, url, text, run]
        var pendingSpace = false;   // a space after a picture, for what follows
        function flushBuf() {
            if (!buf) return;
            var r = buf[3];
            var css = runCss(r, base, ctx);
            var node;
            var script = r.script;
            if (script) {
                node = document.createElement(script);
                if (css) node.setAttribute("style", css);
                node.appendChild(document.createTextNode(buf[2]));
            } else if (css) {
                node = el("span", css);
                node.appendChild(document.createTextNode(buf[2]));
            } else {
                node = document.createTextNode(buf[2]);
            }
            place(node, buf[1]);
            buf = null;
        }
        tokens.forEach(function (t) {
            if (t.tab) {
                flushBuf();
                var tab = el("span", null, "doc-tab");
                tab.appendChild(document.createTextNode("\t"));
                place(tab, null);
                return;
            }
            if (t.br) {
                flushBuf();
                place(document.createElement("br"), null);
                return;
            }
            if (t.img) {
                flushBuf();
                var im = t.img.img;
                if (!im.src) return;
                if (pendingSpace) {
                    place(document.createTextNode(" "), null);
                    pendingSpace = false;
                }
                var w = im.x1 - im.x0, h = im.y1 - im.y0;
                // as far below the baseline as it reaches in the PDF
                var drop = t.img.bottom - t.img.base;
                var img = el("img", "width:" + pt(w) + ";height:" + pt(h) + ";" +
                    (drop > 0.3 ? "vertical-align:" + pt(-drop) + ";" : ""));
                img.setAttribute("src", im.src);
                place(img, t.img.url || null);
                return;
            }
            if (t.space) {
                if (buf) buf[2] += t.n > 1 ? new Array(t.n + 1).join(" ") : " ";
                else pendingSpace = true;
                return;
            }
            var r = t.run;
            if (!r) return;
            var text = t.text !== undefined ? t.text : r.text;
            if (!text) return;
            var k = runKey(r);
            var url = r.url || null;
            if (buf && buf[0] === k && buf[1] === url) { buf[2] += text; return; }
            flushBuf();
            if (pendingSpace) {
                text = " " + text;
                pendingSpace = false;
            }
            buf = [k, url, text, r];
        });
        flushBuf();
    };

    function runKey(r) {
        return [r.famKey, sizeKey(r.size), r.bold ? 1 : 0, r.italic ? 1 : 0, hex(r.color), r.underline ? 1 : 0,
            r.strike ? 1 : 0, r.bg ? hex(r.bg) : "", r.script || "", r1(r.letterSpacing || 0)].join("|");
    }
    function runCss(r, base, ctx) {
        var css = "";
        if (r.famKey !== base.famKey) css += "font-family:" + ctx.stacks[r.famKey] + ";";
        if (!r.script && Math.abs(sizeKey(r.size) - base.size) > 0.01) css += "font-size:" + sizeKey(r.size) + "pt;";
        if (r.script) css += "font-size:" + sizeKey(r.size) + "pt;";
        if (!!r.bold !== !!base.bold) css += "font-weight:" + (r.bold ? "bold" : "normal") + ";";
        if (!!r.italic !== !!base.italic) css += "font-style:" + (r.italic ? "italic" : "normal") + ";";
        var c = hex(r.color);
        if (c !== base.color) css += "color:" + c + ";";
        var deco = [];
        if (r.underline) deco.push("underline");
        if (r.strike) deco.push("line-through");
        if (deco.length) css += "text-decoration:" + deco.join(" ") + ";";
        if (r.bg && r.bgSpan) css += "background-color:" + hex(r.bg) + ";";
        if (r.letterSpacing) css += "letter-spacing:" + pt(r.letterSpacing) + ";";
        return css;
    }

    // the look most of a paragraph's text has
    function dominant(tokens) {
        var n = {}, pick = {};
        tokens.forEach(function (t) {
            var r = t.run;
            if (!r || r.script || !r.text) return;
            var k = [r.famKey, sizeKey(r.size), r.bold ? 1 : 0, r.italic ? 1 : 0, hex(r.color)].join("|");
            n[k] = (n[k] || 0) + r.text.length;
            pick[k] = r;
        });
        var best = null;
        Object.keys(n).forEach(function (k) { if (!best || n[k] > n[best]) best = k; });
        if (!best) {
            // a line of pictures only: the size of the text they stand for
            var size = 11;
            for (var i = 0; i < tokens.length; i++) {
                if (tokens[i].img && tokens[i].img.size) { size = sizeKey(tokens[i].img.size); break; }
            }
            return { famKey: "", size: size, bold: false, italic: false, color: "#000000" };
        }
        var r = pick[best];
        return { famKey: r.famKey, size: sizeKey(r.size), bold: !!r.bold, italic: !!r.italic, color: hex(r.color) };
    }

    function blockCss(base, ctx, heading) {
        var css = "";
        if (base.famKey) css += "font-family:" + ctx.stacks[base.famKey] + ";";
        css += "font-size:" + base.size + "pt;";
        if (heading) {
            css += "font-weight:" + (base.bold ? "bold" : "normal") + ";";
            css += "font-style:" + (base.italic ? "italic" : "normal") + ";";
            css += "color:" + base.color + ";";
        } else {
            if (base.bold) css += "font-weight:bold;";
            if (base.italic) css += "font-style:italic;";
            if (base.color !== "#000000") css += "color:" + base.color + ";";
        }
        return css;
    }

    // a paragraph's lines as one stream of tokens: wrapped lines joined by a
    // space (or nothing between CJK, or a hyphen taken back), kept ones by <br>
    function paragraphTokens(P, skipMarker) {
        var out = [];
        P.lines.forEach(function (L, i) {
            var toks = L.tokens;
            if (i === 0 && skipMarker && P.marker) {
                var m = P.marker;
                if (m.skip !== undefined) {
                    toks = toks.slice(m.skip);
                } else {
                    var ti = m.splitTok || 0;
                    var t0 = toks[ti];
                    var rest = t0.run.text.substring(m.split).replace(/^\s+/, "");
                    toks = [{ run: t0.run, text: rest }].concat(toks.slice(ti + 1));
                }
                while (toks.length && (toks[0].space || toks[0].tab)) toks = toks.slice(1);
            }
            if (i > 0) {
                if (P.breaks) {
                    out.push({ br: true });
                } else {
                    var prev = out.length ? out[out.length - 1] : null;
                    var ptxt = prev && prev.run ? (prev.text !== undefined ? prev.text : prev.run.text) : "";
                    var first = null;
                    for (var k = 0; k < toks.length; k++) if (toks[k].run) { first = toks[k]; break; }
                    var ntxt = first ? (first.text !== undefined ? first.text : first.run.text) : "";
                    var pc = lastCp(ptxt), nc = ntxt ? cpOf(ntxt, 0) : 0;
                    if (/[A-Za-z]-$/.test(ptxt) && /^[a-z]/.test(ntxt)) {
                        // a word hyphenated at the line end
                        var keep = prev.text !== undefined ? prev.text : prev.run.text;
                        prev.text = keep.substring(0, keep.length - 1);
                    } else if (!(isCJK(pc) && isCJK(nc)) && !/\s$/.test(ptxt)) {
                        out.push({ space: true, next: first ? first.run : null });
                    }
                }
            }
            toks.forEach(function (t) {
                out.push(t.run ? { run: t.run, text: t.text } : t);
            });
        });
        return out;
    }

    Emitter.prototype.paragraph = function (P, spaceBefore) {
        var ctx = this.ctx;
        var toks = paragraphTokens(P, false);
        var base = dominant(toks);
        var tag = P.heading || "p";
        var e = el(tag);
        var css = blockCss(base, ctx, !!P.heading);
        if (P.heading) {
            css += "margin-top:" + pt(spaceBefore) + ";margin-bottom:0pt;";
        } else if (spaceBefore > 0.4) {
            css += "padding-top:" + pt(spaceBefore) + ";";
        }
        if (P.align !== "left") css += "text-align:" + P.align + ";";
        if (P.marginLeft > 1) css += "margin-left:" + pt(P.marginLeft) + ";";
        if (P.indent && Math.abs(P.indent) > 1) css += "text-indent:" + pt(P.indent) + ";";
        if (P.bg) css += "background-color:" + hex(P.bg) + ";";
        // spaces that line code up must not collapse
        if (toks.some(function (t) { return t.space && t.n > 1; })) css += "white-space:pre-wrap;";
        e.setAttribute("style", css);
        if (P.title) e.className = "doc-title";
        if (P.ls) e.setAttribute("data-ls", String(P.ls));
        if (P.tabs) e.setAttribute("data-tabs", P.tabs);
        if (P.pageBreak) e.setAttribute("data-page-break-before", "1");
        if (P.colSpan) e.classList.add("col-span-all");
        this.inline(e, toks, base);
        if (!e.firstChild) e.appendChild(document.createElement("br"));
        return e;
    };

    Emitter.prototype.listItem = function (P, spaceBefore) {
        var toks = paragraphTokens(P, true);
        var base = dominant(toks);
        var li = el("li");
        var css = blockCss(base, this.ctx, false);
        if (spaceBefore > 0.4) css += "padding-top:" + pt(spaceBefore) + ";";
        if (P.ls) li.setAttribute("data-ls", String(P.ls));
        li.setAttribute("style", css);
        this.inline(li, toks, base);
        if (!li.firstChild) li.appendChild(document.createElement("br"));
        return li;
    };

    /* ---------------- conversion ---------------- */
    function convert(bytes, opts) {
        opts = opts || {};
        var progress = opts.progress || function () { };
        var store = opts.storeImage || function (blob) {
            return new Promise(function (res) {
                var fr = new FileReader();
                fr.onload = function () { res(fr.result); };
                fr.onerror = function () { res(null); };
                fr.readAsDataURL(blob);
            });
        };
        var stem = String(opts.name || "document").replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_-]+/g, "_").substring(0, 40) || "pdf";
        var imgSeq = 0;
        var doc = null;

        // lineArt: a rendered figure - PNG keeps its thin lines sharp
        function encode(canvas, lineArt) {
            return new Promise(function (res) {
                if (!canvas) { res(null); return; }
                var opaque = true;
                var big = canvas.width * canvas.height > 90000;
                // the reader knows whether the picture it placed is opaque; a
                // rendered region (a figure) is on white
                if (canvas._opaque !== undefined) {
                    opaque = canvas._opaque;
                } else if (big) {
                    try {
                        var probe = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
                        for (var i = 3; i < probe.length; i += 4 * 7) if (probe[i] < 250) { opaque = false; break; }
                    } catch (e) { opaque = false; }
                }
                var jpeg = big && opaque && !lineArt;
                var blob = canvasBlob(canvas, jpeg ? "image/jpeg" : "image/png", 0.9);
                if (!blob) { res(null); return; }
                // the same picture on many pages (a letterhead, an icon) is
                // stored once
                blobKey(blob).then(function (key) {
                    if (!stored[key]) {
                        imgSeq++;
                        stored[key] = store(blob, stem + "-" + imgSeq + (jpeg ? ".jpg" : ".png"));
                    }
                    stored[key].then(res, function () { res(null); });
                });
            });
        }
        var stored = {};
        function blobKey(blob) {
            if (!blob.arrayBuffer) return Promise.resolve("n" + (++imgSeq));
            return blob.arrayBuffer().then(function (buf) {
                var a = new Uint8Array(buf);
                var h = 0x811c9dc5;
                for (var i = 0; i < a.length; i++) {
                    h ^= a[i];
                    h = Math.imul(h, 16777619) >>> 0;
                }
                return a.length + ":" + h;
            }, function () { return "n" + (++imgSeq); });
        }

        return OfficePdfRead.open(bytes, { password: opts.password }).then(function (d) {
            doc = d;
            var pages = [];
            var n = 0;
            function next() {
                n++;
                if (n > doc.numPages) return Promise.resolve(pages);
                progress("Reading page " + n + " of " + doc.numPages, n - 1, doc.numPages);
                return doc.page(n).then(function (page) {
                    var pg = analyzePage(page);
                    var jobs = [];
                    pg.images.forEach(function (it) {
                        var im = it.img;
                        jobs.push(im.canvas().then(encode).then(function (src) { im.src = src; }));
                    });
                    pg.tables.forEach(function (t) {
                        t.cells.forEach(function (c) {
                            c.images.forEach(function (b) {
                                jobs.push(b.img.canvas().then(encode).then(function (src) { b.img.src = src; }));
                            });
                        });
                    });
                    pg.figures.forEach(function (f) {
                        var w = f.x1 - f.x0, h = f.y1 - f.y0;
                        var scale = Math.max(1.5, Math.min(3, 1400 / Math.max(w, h)));
                        jobs.push(page.render([f.x0, f.y0, f.x1, f.y1], scale).then(function (c) {
                            return encode(c, true);
                        }).then(function (src) {
                            f.src = src;
                        }, function () { f.src = null; }));
                    });
                    return Promise.all(jobs).then(function () {
                        page.release();
                        pages.push(pg);
                        return yield0().then(next);
                    });
                });
            }
            return next();
        }).then(function (pages) {
            progress("Building the document", doc.numPages, doc.numPages);
            return buildBody(pages, opts);
        }).then(function (body) {
            if (doc) doc.close();
            return body;
        }, function (err) {
            if (doc) doc.close();
            throw err;
        });
    }

    function buildBody(pages, opts) {
        var running = stripRunning(pages);
        var first = pages[0] || { width: 595, height: 842 };
        var paper = pickPaper(first.width, first.height);
        var tb = textBounds(pages) || { left: 72, right: first.width - 72, top: 72, bottom: first.height - 72 };
        if (tb.right - tb.left < 50) { tb.left = 72; tb.right = first.width - 72; }

        // margins: the PDF's, with the text column kept as wide as it was
        var textW = tb.right - tb.left;
        var leftMm = Math.max(5, Math.min(60, tb.left / PT_PER_MM));
        var rightMm = paper.w - leftMm - textW / PT_PER_MM;
        if (rightMm < 5) {
            rightMm = Math.max(5, Math.min(60, (first.width - tb.right) / PT_PER_MM));
        }
        var topMm = Math.max(5, Math.min(60, tb.top / PT_PER_MM - 1));
        // where the fullest pages stop, with the page as tall as it was; a
        // single page that is not full says nothing, so it mirrors the top
        var textH = tb.bottom - tb.top;
        var bottomMm = paper.h - topMm - textH / PT_PER_MM - 2;
        if (bottomMm < 5 || bottomMm > 50) bottomMm = (first.height - tb.bottom) / PT_PER_MM - 2;
        if (tb.pages < 2 && bottomMm > topMm) bottomMm = topMm;
        bottomMm = Math.max(5, Math.min(50, bottomMm));
        var page = {
            size: paper.size, orientation: paper.orientation,
            margins: { top: r1(topMm), right: r1(rightMm), bottom: r1(bottomMm), left: r1(leftMm) },
            columns: 1, colGap: 8, headerDist: 12.7, footerDist: 12.7
        };
        if (running.headerTop !== null) page.headerDist = r1(Math.max(3, Math.min(40, running.headerTop / PT_PER_MM)));
        if (running.footerBottom !== null) page.footerDist = r1(Math.max(3, Math.min(40, running.footerBottom / PT_PER_MM)));

        // fonts: a family per run, and its CSS stack
        var stacks = {};
        var sizeChars = {};
        function prepRun(r) {
            var fam = familyOf(r);
            r.famKey = fam;
            if (!stacks[fam]) stacks[fam] = stackOf(fam, r);
            var k = sizeKey(r.size);
            sizeChars[k] = (sizeChars[k] || 0) + r.text.length;
        }
        pages.forEach(function (pg) {
            pg.regions.forEach(function (rg) {
                rg.items.forEach(function (it) {
                    if (it.tokens) it.tokens.forEach(function (t) { if (t.run && t.run.text !== undefined && t.run.font) prepRun(t.run); });
                });
            });
            pg.tables.forEach(function (t) {
                t.cells.forEach(function (c) { c.runs.forEach(prepRun); });
            });
        });
        var bodySize = 11;
        var bestN = -1;
        Object.keys(sizeChars).forEach(function (k) { if (sizeChars[k] > bestN) { bestN = sizeChars[k]; bodySize = parseFloat(k); } });

        var famList = {};
        Object.keys(stacks).forEach(function (f) { famList[stacks[f]] = f; });
        return loadFonts(famList).then(function () {
            return emit(pages, {
                page: page, tb: tb, stacks: stacks, bodySize: bodySize, running: running,
                sizeChars: sizeChars, totalChars: Object.keys(sizeChars).reduce(function (n, k) { return n + sizeChars[k]; }, 0),
                paperW: paper.w * PT_PER_MM
            });
        });
    }

    function emit(pages, ctx) {
        var root = document.createElement("div");
        var E = new Emitter(ctx);
        var tb = ctx.tb;
        var docMults = [];
        var all = [];    // {P | block, page, colLeft, colRight, region}

        pages.forEach(function (pg, pi) {
            pg.regions.forEach(function (rg) {
                var colL = rg.bounds.left !== null && rg.bounds.left !== undefined ? rg.bounds.left : tb.left;
                var colR = rg.bounds.right !== null && rg.bounds.right !== undefined ? rg.bounds.right : tb.right;
                if (colR - colL < 30) { colL = tb.left; colR = tb.right; }
                paragraphsOf(rg, colL, colR).forEach(function (P) {
                    all.push({ P: P.block ? null : P, block: P.block || null, page: pi, colL: colL, colR: colR });
                });
            });
        });

        // superscripts and subscripts: a smaller run off the line's baseline
        all.forEach(function (x) {
            if (!x.P) return;
            x.P.lines.forEach(function (L) {
                L.tokens.forEach(function (t) {
                    var r = t.run;
                    if (!r || !r.size) return;
                    if (r.size < L.size * 0.85) {
                        if (r.base < L.base - L.size * 0.15) r.script = "sup";
                        else if (r.base > L.base + L.size * 0.08) r.script = "sub";
                    }
                });
            });
        });

        // heading levels: sizes clearly above the body text
        var headSizes = {};
        all.forEach(function (x) {
            var P = x.P;
            // a numbered heading ("2. Design goals") is a heading, a bulleted
            // line is not
            if (!P || (P.marker && P.marker.kind !== "number") || P.lines.length > 3 || P.chars > 200) return;
            var s = sizeKey(P.size);
            if (s >= ctx.bodySize * 1.18 || (P.bold && s >= ctx.bodySize * 1.08 && P.lines.length <= 2)) {
                P.headCand = true;
                headSizes[s] = (headSizes[s] || 0) + 1;
            }
        });
        // headings are the rare sizes: a size that carries a good share of
        // the text is body text of its own (a manual's main text above its
        // small print), and only the three largest are levels
        Object.keys(headSizes).forEach(function (s) {
            if ((ctx.sizeChars[s] || 0) > ctx.totalChars * 0.12) delete headSizes[s];
        });
        var levels = Object.keys(headSizes).map(parseFloat).sort(function (a, b) { return b - a; }).slice(0, 3);
        all.forEach(function (x) {
            if (x.P && x.P.headCand && levels.indexOf(sizeKey(x.P.size)) < 0) x.P.headCand = false;
        });
        var firstPage = all.filter(function (x) { return x.page === 0 && x.P; });
        var titleSize = levels.length && headSizes[levels[0]] === 1 && levels[0] >= ctx.bodySize * 1.6 ? levels[0] : null;
        all.forEach(function (x) {
            var P = x.P;
            if (!P || !P.headCand) return;
            var s = sizeKey(P.size);
            if (titleSize !== null && s === titleSize && firstPage.indexOf(x) >= 0) {
                P.heading = "h1";
                P.title = true;
                return;
            }
            var idx = levels.indexOf(s) - (titleSize !== null ? 1 : 0);
            P.heading = "h" + Math.min(3, Math.max(1, idx + 1));
        });

        // line spacing: the document's own, and each paragraph's against it
        all.forEach(function (x) {
            var P = x.P;
            if (!P || !P.pitch) return;
            var base = dominant(paragraphTokens(P, false));
            var rt = ratioOf(ctx.stacks[base.famKey] || "Arial");
            var m = P.pitch / ((rt.asc + rt.desc) * base.size);
            if (m > 0.6 && m < 4) { P.mult = m; docMults.push(r2(m)); }
        });
        var docLS = docMults.length ? r2(median(docMults)) : 1.15;
        all.forEach(function (x) {
            var P = x.P;
            if (!P) return;
            if (P.mult && Math.abs(P.mult - docLS) > 0.03) P.ls = r2(P.mult);
            var lh = null;
            // how tall the editor will make one of its lines, and where in
            // that line the baseline sits (CSS centres the font's box in it)
            P.lineH = function () {
                if (lh) return lh;
                var base = dominant(paragraphTokens(P, false));
                var rt = ratioOf(ctx.stacks[base.famKey] || "Arial");
                var m = P.ls || docLS;
                lh = { h: (rt.asc + rt.desc) * base.size * m, asc: rt.asc * base.size, desc: rt.desc * base.size };
                return lh;
            };
        });

        // shading: a box behind every line of a paragraph colours the
        // paragraph; behind a few words, those words
        all.forEach(function (x) {
            var P = x.P;
            if (!P) return;
            var bgs = {};
            var total = 0, shaded = 0;
            P.lines.forEach(function (L) {
                L.tokens.forEach(function (t) {
                    if (!t.run || !t.run.text) return;
                    total += t.run.text.length;
                    if (t.run.bg) { shaded += t.run.text.length; bgs[hex(t.run.bg)] = t.run.bg; }
                });
            });
            var keys = Object.keys(bgs);
            if (keys.length === 1 && shaded >= total * 0.95) {
                var box = null;
                P.lines.forEach(function (L) { L.tokens.forEach(function (t) { if (t.run && t.run.bgBox) box = t.run.bgBox; }); });
                if (box && box.x1 - box.x0 > (x.colR - x.colL) * 0.6) {
                    P.bg = bgs[keys[0]];
                    return;
                }
            }
            P.lines.forEach(function (L) { L.tokens.forEach(function (t) { if (t.run && t.run.bg) t.run.bgSpan = true; }); });
        });

        // tab stops
        all.forEach(function (x) {
            var P = x.P;
            if (!P || P.lines.length !== 1 || !P.lines[0].hasTab) return;
            var L = P.lines[0];
            var stops = [];
            var segIdx = 0;
            L.tokens.forEach(function (t, i) {
                if (!t.tab) return;
                segIdx++;
                var sg = L.segs[segIdx];
                if (!sg) return;
                var lead = t.leader ? "dot" : "none";
                var rightAligned = Math.abs(sg.x1 - x.colR) <= 3 && segIdx === L.segs.length - 1;
                if (rightAligned) stops.push("right:" + r2(sg.x1 - x.colL) + ":" + lead);
                else stops.push("left:" + r2(sg.x0 - x.colL) + ":" + lead);
            });
            P.tabs = stops.join(";");
            P.align = "left";
            P.marginLeft = Math.max(0, L.x0 - x.colL);
            P.indent = 0;
        });

        // where a page of the PDF ends early, the next one starts a page
        var pageLast = {};
        all.forEach(function (x, i) { pageLast[x.page] = i; });
        var pageFirst = {};
        all.forEach(function (x, i) { if (pageFirst[x.page] === undefined) pageFirst[x.page] = i; });
        var textBottom = tb.bottom;
        Object.keys(pageFirst).forEach(function (p) {
            p = parseInt(p, 10);
            if (p === 0) return;
            var prevIdx = pageLast[p - 1];
            var prevPage = p - 1;
            while (prevIdx === undefined && prevPage > 0) { prevPage--; prevIdx = pageLast[prevPage]; }
            var cur = all[pageFirst[p]];
            if (prevIdx === undefined) return;
            var prev = all[prevIdx];
            var prevBottom = prev.P ? prev.P.bottom : prev.block.y1;
            var lineH = ctx.bodySize * 1.4;
            if (textBottom - prevBottom > Math.max(lineH * 4, (textBottom - tb.top) * 0.18) || prevPage < p - 1) {
                cur.pageBreak = true;
                return;
            }
            // a paragraph carried over to the next page is one paragraph
            var A = prev.P, B = cur.P;
            if (!A || !B || A.marker || B.marker || A.heading || B.heading || A.align === "center") return;
            var la = A.lines[A.lines.length - 1], lb = B.lines[0];
            if (la.style !== lb.style || la.hasTab || lb.hasTab) return;
            var full = prev.colR - la.x1 < firstWordWidth(lb) + la.size * 0.6;
            var contX = A.lines.length > 1 ? A.lines[1].x0 : A.lines[0].x0;
            var noIndent = Math.abs(lb.x0 - contX) <= Math.max(1.5, lb.size * 0.3);
            var ends = ENDS_SENTENCE.test(la.text.trim());
            if (full && noIndent && (!ends || /^[a-z]/.test(lb.text))) {
                B.lines.forEach(function (L) { A.lines.push(L); });
                A.lastBase = B.lastBase;
                A.bottom = B.bottom;
                if (!A.pitch && B.pitch) A.pitch = B.pitch;
                cur.merged = true;
            }
        });

        // lists: consecutive items, nested by where their markers stand
        var listRun = null;
        function closeList() { listRun = null; }

        var prevEntry = null;
        all.forEach(function (x) {
            if (x.merged) return;
            var spaceBefore = 0;
            var startsPage = prevEntry === null || prevEntry.page !== x.page;
            if (x.P) {
                var lh = x.P.lineH();
                var top = x.P.firstBase - (lh.h / 2 + (lh.asc - lh.desc) / 2);
                if (startsPage) {
                    spaceBefore = prevEntry === null ? Math.max(0, top - tb.top) : 0;
                } else if (prevEntry.P) {
                    var plh = prevEntry.P.lineH();
                    var pbottom = prevEntry.P.lastBase + plh.h / 2 - (plh.asc - plh.desc) / 2;
                    spaceBefore = top - pbottom;
                } else {
                    spaceBefore = top - prevEntry.block.y1;
                }
            } else if (prevEntry && !startsPage) {
                var pb = prevEntry.P ? prevEntry.P.bottom : prevEntry.block.y1;
                spaceBefore = x.block.y0 - pb;
            }
            spaceBefore = Math.max(0, Math.min(200, spaceBefore));
            if (spaceBefore < 0.75) spaceBefore = 0;

            if (x.pageBreak) {
                closeList();
                root.appendChild(el("div", null, "doc-pagebreak"));
                spaceBefore = 0;
            }
            if (x.P && x.P.marker && !x.P.heading) {
                addListItem(x, spaceBefore);
            } else {
                closeList();
                if (x.P) root.appendChild(E.paragraph(x.P, spaceBefore));
                else {
                    var b = emitBlock(x, spaceBefore);
                    if (b) root.appendChild(b);
                }
            }
            prevEntry = x;
        });

        function addListItem(x, spaceBefore) {
            var P = x.P, m = P.marker;
            var markerX = m.markerX - x.colL;
            if (!listRun) listRun = { stack: [] };
            var st = listRun.stack;
            // close deeper levels
            var textXr = m.textX - x.colL;
            // a level is where its markers or its text line up ("9." and
            // "10." right-aligned start apart, their text does not)
            var level = function (e) { return Math.abs(markerX - e.markerX) <= 2 || Math.abs(textXr - e.textX) <= 2; };
            while (st.length && !level(st[st.length - 1]) && markerX < st[st.length - 1].markerX - 2) st.pop();
            var top = st.length ? st[st.length - 1] : null;
            var ordered = m.kind === "number";
            var sameLevel = top && level(top);
            if (sameLevel && (top.ordered !== ordered || (ordered && top.fmt !== m.fmt) || (!ordered && top.marker !== m.marker))) {
                st.pop();
                top = st.length ? st[st.length - 1] : null;
                sameLevel = false;
            }
            if (!sameLevel) {
                var depth = st.length;
                var parentText = top ? top.textX : 0;
                var textX = m.textX - x.colL;
                var list = el(ordered ? "ol" : "ul", "padding-left:" + pt(Math.max(0, textX - parentText)) +
                    ";--doc-hang:" + pt(Math.max(4, m.textX - m.markerX)) + ";", "doc-list");
                if (ordered) {
                    list.setAttribute("data-fmt", m.fmt);
                    list.setAttribute("data-lvltext", m.prefix + "%" + (depth + 1) + m.suffix);
                    if (m.value !== 1 && m.value > 0) list.setAttribute("start", String(m.value));
                } else {
                    list.setAttribute("data-fmt", "bullet");
                    list.setAttribute("data-lvltext", m.marker);
                }
                if (P.colSpan) list.classList.add("col-span-all");
                (top ? top.el : root).appendChild(list);
                st.push({ el: list, markerX: markerX, textX: textX, ordered: ordered, fmt: m.fmt, marker: m.marker });
                top = st[st.length - 1];
            }
            top.el.appendChild(E.listItem(P, spaceBefore));
        }

        function emitBlock(x, spaceBefore) {
            var b = x.block;
            var colW = x.colR - x.colL;
            if (b.kind === "hr") return el("hr");
            if (b.kind === "image" || b.kind === "figure") {
                var src = b.kind === "image" ? b.img.src : b.src;
                if (!src) return null;
                var w = b.x1 - b.x0, h = b.y1 - b.y0;
                if (w > colW) { h = h * colW / w; w = colW; }
                var cx = (b.x0 + b.x1) / 2;
                var align = "left", ml = 0;
                if (Math.abs(cx - (x.colL + x.colR) / 2) < colW * 0.06 && b.x0 > x.colL + 4) align = "center";
                else if (Math.abs(b.x1 - x.colR) < colW * 0.06 && b.x0 > x.colL + colW * 0.3) align = "right";
                else ml = Math.max(0, b.x0 - x.colL);
                var css = "";
                if (spaceBefore > 0.4) css += "padding-top:" + pt(spaceBefore) + ";";
                if (align !== "left") css += "text-align:" + align + ";";
                if (ml > 2) css += "margin-left:" + pt(Math.min(ml, colW - w)) + ";";
                var p = el("p", css || null);
                // a border is drawn outside the picture's box, as the PDF did
                var bd = b.border ? Math.max(0.25, Math.min(6, b.border.w)) : 0;
                var img = el("img", "width:" + pt(w - bd) + ";height:" + pt(h - bd) + ";" +
                    (bd ? "border:" + pt(bd) + " solid " + hex(b.border.color) + ";" : ""));
                img.setAttribute("src", src);
                p.appendChild(img);
                return p;
            }
            if (b.kind === "table") return emitTable(b, x, spaceBefore);
            return null;
        }

        function borderCss(l) {
            if (!l) return "none";
            return pt(Math.max(0.25, Math.min(6, l.w))) + " solid " + hex(l.color);
        }

        function emitTable(t, x, spaceBefore) {
            var widths = [];
            for (var c = 0; c < t.cols; c++) widths.push(t.xs[c + 1] - t.xs[c]);
            var totalW = t.x1 - t.x0;
            var css = "width:" + pt(totalW) + ";table-layout:fixed;";
            var ml = t.x0 - x.colL;
            if (ml > 1) css += "margin-left:" + pt(ml) + ";";
            var table = el("table", css, "of-table");
            table.setAttribute("data-docx", "1");
            var cg = el("colgroup");
            widths.forEach(function (w) { cg.appendChild(el("col", "width:" + pt(w) + ";")); });
            table.appendChild(cg);
            var tbody = el("tbody");
            table.appendChild(tbody);
            var byRow = {};
            t.cells.forEach(function (cell) { (byRow[cell.r] = byRow[cell.r] || []).push(cell); });
            for (var r = 0; r < t.rows; r++) {
                var tr = el("tr", "height:" + pt(t.ys[r + 1] - t.ys[r]) + ";");
                (byRow[r] || []).sort(function (a, b) { return a.c - b.c; }).forEach(function (cell) {
                    tr.appendChild(emitCell(cell, t));
                });
                tbody.appendChild(tr);
            }
            return table;
        }

        function emitCell(cell, t) {
            var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            cell.runs.forEach(function (r) {
                minX = Math.min(minX, r.x0); maxX = Math.max(maxX, r.x1);
                minY = Math.min(minY, r.top); maxY = Math.max(maxY, r.bottom);
            });
            cell.images.forEach(function (b) {
                minX = Math.min(minX, b.x0); maxX = Math.max(maxX, b.x1);
                minY = Math.min(minY, b.y0); maxY = Math.max(maxY, b.y1);
            });
            var padL = 2, padR = 2;
            if (minX < Infinity) {
                padL = Math.max(1, Math.min(10, minX - cell.x0 - 0.5));
                padR = Math.max(1, Math.min(padL, cell.x1 - maxX));
            }
            var valign = "top";
            if (minY < Infinity) {
                var gt = minY - cell.y0, gb = cell.y1 - maxY;
                if (gt > 4 && Math.abs(gt - gb) < Math.max(2.5, (gt + gb) * 0.2)) valign = "middle";
                else if (gb < gt - 4 && gb < 5) valign = "bottom";
            }
            var css = "border-top:" + borderCss(cell.top) + ";border-right:" + borderCss(cell.right) +
                ";border-bottom:" + borderCss(cell.bottom) + ";border-left:" + borderCss(cell.left) +
                ";padding:1pt " + pt(padR) + " 1pt " + pt(padL) + ";vertical-align:" + valign + ";";
            if (cell.bg && !isWhite(cell.bg)) css += "background-color:" + hex(cell.bg) + ";";
            var td = el("td", css);
            if (cell.cs > 1) td.setAttribute("colspan", String(cell.cs));
            if (cell.rs > 1) td.setAttribute("rowspan", String(cell.rs));
            // the cell's text, reflowed like a little page of its own
            var atoms = cell.runs.map(function (r) {
                r.kind = "run";
                r.y0 = r.top;
                r.y1 = r.bottom;
                return r;
            });
            cell.images.forEach(function (b) { b.top = b.y0; b.bottom = b.y1; atoms.push(b); });
            var region = { items: linesOf(atoms), bounds: {} };
            var colL = cell.x0 + padL, colR = cell.x1 - padR;
            var paras = paragraphsOf(region, colL, colR);
            var prevP = null;
            paras.forEach(function (P) {
                if (P.block) {
                    var b = P.block;
                    if (b.kind === "image" && b.img.src) {
                        var p = el("p", "text-align:" + ((b.x0 + b.x1) / 2 > (colL + colR) / 2 + 4 ? "center" : "left") + ";");
                        var w = Math.min(b.x1 - b.x0, colR - colL), h = (b.y1 - b.y0) * w / Math.max(1, b.x1 - b.x0);
                        var img = el("img", "width:" + pt(w) + ";height:" + pt(h) + ";");
                        img.setAttribute("src", b.img.src);
                        p.appendChild(img);
                        td.appendChild(p);
                    }
                    return;
                }
                var sb = 0;
                if (prevP) sb = Math.max(0, P.top - prevP.bottom - P.size * 0.3);
                if (P.lines.length > 1 && P.pitch) {
                    var base = dominant(paragraphTokens(P, false));
                    var rt = ratioOf(ctx.stacks[base.famKey] || "Arial");
                    var m = P.pitch / ((rt.asc + rt.desc) * base.size);
                    if (m > 0.6 && m < 4 && Math.abs(m - docLS) > 0.03) P.ls = r2(m);
                }
                P.marginLeft = Math.max(0, P.marginLeft || 0);
                if (P.marker) { P.marker = null; P.marginLeft = 0; P.indent = 0; }
                td.appendChild(E.paragraph(P, sb));
                prevP = P;
            });
            if (!td.firstChild) td.appendChild(el("p")).appendChild(document.createElement("br"));
            return td;
        }

        var html = root.innerHTML || "<p><br></p>";
        var running = ctx.running;
        /* letterhead art goes into the header (footer) when it fits in the
           band between the paper's edge and the text; the text of the
           header follows it */
        function bandHtml(pic, text, roomMm) {
            var src = pic && (pic.kind === "image" ? pic.img.src : pic.src);
            if (!src) return undefined;
            var w = pic.x1 - pic.x0, h = pic.y1 - pic.y0;
            var room = roomMm * PT_PER_MM;
            if (room < 12) return undefined;
            if (h > room) { w = w * room / h; h = room; }
            var box = document.createElement("div");
            var p = el("p", pic.x0 > ctx.paperW * 0.3 ? "text-align:" + (pic.x1 > ctx.paperW * 0.7 ? "right" : "center") + ";" : null);
            var img = el("img", "width:" + pt(w) + ";height:" + pt(h) + ";");
            img.setAttribute("src", src);
            p.appendChild(img);
            box.appendChild(p);
            if (text) {
                var tp = el("p");
                tp.appendChild(document.createTextNode(text));
                box.appendChild(tp);
            }
            return box.innerHTML;
        }
        var pg = ctx.page;
        var headerHtml = bandHtml(running.headerPic, running.header, pg.margins.top - pg.headerDist - 2);
        var footerHtml = bandHtml(running.footerPic, running.footer, pg.margins.bottom - pg.footerDist - 2);
        return {
            html: html,
            page: ctx.page,
            header: running.header || "",
            footer: running.footer || "",
            headerHtml: headerHtml,
            footerHtml: footerHtml,
            pageNumbers: !!running.pageNumbers,
            lineSpacing: docLS,
            hfMode: "all"
        };
    }

    window.DocsPdfImport = {
        convert: convert,
        // exposed for tests
        _listMarker: listMarker,
        _pickPaper: pickPaper,
        _analyzePage: analyzePage,
        _paragraphsOf: paragraphsOf,
        _textBounds: textBounds,
        _stripRunning: stripRunning
    };
})();
