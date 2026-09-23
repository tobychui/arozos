/*
    ArozOS Office - Docs layout engine
    ==================================
    Everything about how a document is laid out that CSS cannot decide on
    its own, so that the page the editor shows is the page a word processor
    would print - and, because the PDF exporter draws this very DOM, the
    page the PDF gets.

    Four passes over a rendered subtree (the editor, a header/footer copy,
    a footnote area):

      lineHeights  Word and Google Docs size a line from the font's own
                   ascent and descent, rounded to whole pixels one side at
                   a time: ceil(ascent x size x spacing) + ceil(descent x
                   size x spacing). CSS line-height is size x number and
                   drifts by a pixel or two a line, which over a page is a
                   different page break. Every block that holds text gets
                   that exact line height in px, and inline elements get
                   line-height 0 (docs.css) so a run in another font cannot
                   make its line taller than the rule says; a run in a
                   bigger size gets its own px height and grows its line.
      numbering    list markers ("1.", "b)", bullets) are computed here into
                   li[data-marker] and drawn by li::before - a real value
                   the PDF exporter can read, formats CSS counters do not
                   have ("%1.%2."), and numbering that carries on across a
                   list interrupted by a paragraph (same data-num).
      tabs         span.doc-tab is sized to reach the next tab stop: the
                   paragraph's own stops (data-tabs, right/center/left, with
                   leaders) or the default 36pt grid.
      footnotes    references are numbered in document order.

    And pagination (paginate): the document is one contenteditable flow,
    and page boundaries are made real in it. What crosses a boundary is
    split into two elements - a paragraph at a line, the list or quote
    around it, a table row cell by cell - and a spacer element between the
    halves pushes the second one to the top of the next sheet, so long
    paragraphs, lists and tables break where a word processor breaks them
    and every half is a box of its own (borders and shading end at the
    page). Spacers carry .doc-autobreak; splits are undone, and spacers
    removed, on everything that is saved (docs.js cleanedHtml). Headings keep with the paragraph after
    them, data-keep-lines paragraphs do not split, data-widow paragraphs
    keep two lines on each side, footnotes take their space at the bottom of
    the page that references them.

    Coordinates are layout px relative to #page's padding box (offsetTop
    space, unaffected by the framework's CSS zoom).
*/

var DocsLayout = (function () {
    "use strict";

    var PT = 96 / 72;           // css px per point
    var MM = 96 / 25.4;         // css px per millimetre
    var DEFAULT_TAB_PT = 36;

    /* ---------------- font metrics ---------------- */

    /* ascent/descent per em of the font a family list actually resolves to.
       A canvas at 2048px reports the font's own units exactly (ArialMT:
       1854/434), and it resolves a font stack the same way the text did. */
    var ratioCache = {};
    var ratioCtx = null;
    /* Fonts a browser reports taller metrics for than the word processor
       lays their lines out with. Consolas is the one that matters: in
       Google Docs a Consolas code line is exactly as tall as an Arial line,
       while its OS/2 win metrics would overshoot that by a pixel a line. */
    var LINE_METRICS = {
        "consolas": { asc: 1854 / 2048, desc: 434 / 2048 }
    };
    function fontRatios(family) {
        var key = family || "";
        if (ratioCache[key]) return ratioCache[key];
        var out = { asc: 0.905, desc: 0.212 };
        try {
            if (!ratioCtx) ratioCtx = document.createElement("canvas").getContext("2d");
            ratioCtx.font = "2048px " + (family || "sans-serif");
            var m = ratioCtx.measureText("Hxg");
            if (m && m.fontBoundingBoxAscent > 0) {
                out = { asc: m.fontBoundingBoxAscent / 2048, desc: m.fontBoundingBoxDescent / 2048 };
            }
            var first = String(family || "").split(",")[0].trim().replace(/^["']|["']$/g, "").toLowerCase();
            if (LINE_METRICS[first] && Math.abs(m.fontBoundingBoxAscent - 1884) < 2) out = LINE_METRICS[first];
        } catch (e) { /* estimate */ }
        ratioCache[key] = out;
        return out;
    }

    // the word-processor line height rule, in px
    function lineHeightPx(sizePx, family, mult) {
        var r = fontRatios(family);
        var s = sizePx * (mult > 0 ? mult : 1);
        return Math.ceil(r.asc * s - 1e-6) + Math.ceil(r.desc * s - 1e-6);
    }

    /* ---------------- helpers ---------------- */

    var INLINE_TAGS = {
        A: 1, ABBR: 1, B: 1, BDI: 1, BDO: 1, BR: 1, CITE: 1, CODE: 1, DATA: 1, DEL: 1,
        DFN: 1, EM: 1, FONT: 1, I: 1, IMG: 1, INS: 1, KBD: 1, MARK: 1, Q: 1, S: 1,
        SAMP: 1, SMALL: 1, SPAN: 1, STRIKE: 1, STRONG: 1, SUB: 1, SUP: 1, TIME: 1,
        TT: 1, U: 1, VAR: 1, WBR: 1
    };
    function isInlineEl(el) {
        if (!INLINE_TAGS[el.tagName]) return false;
        // an anchored picture or a line spacer is display:block
        if (el.classList.contains("doc-anchor") || el.classList.contains("doc-autobreak")) return false;
        return true;
    }
    function isSpacer(el) {
        return el.nodeType === 1 && el.classList.contains("doc-autobreak");
    }

    // does this element hold inline content of its own (a "line block")?
    function holdsInline(el) {
        for (var c = el.firstChild; c; c = c.nextSibling) {
            if (c.nodeType === 3) {
                if (c.nodeValue && c.nodeValue.length) return true;
            } else if (c.nodeType === 1 && isInlineEl(c)) {
                return true;
            }
        }
        return false;
    }
    function hasBlockChild(el) {
        for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
            if (!isInlineEl(c) && !isSpacer(c)) return true;
        }
        return false;
    }

    // multiple of single spacing stated on a block, or the legacy
    // unitless line-height an older document carries
    function blockSpacing(el, defLS) {
        var ls = parseFloat(el.getAttribute("data-ls"));
        if (ls > 0) return ls;
        // documents from before data-ls said it as a unitless line-height
        var inline = el.style.lineHeight;
        if (inline && /^[\d.]+$/.test(inline) && parseFloat(inline) > 0) {
            el.setAttribute("data-ls", inline);
            return parseFloat(inline);
        }
        return defLS;
    }

    function cssLenPx(v) {
        v = String(v || "").trim();
        var n = parseFloat(v);
        if (isNaN(n)) return 0;
        if (/pt$/.test(v)) return n * PT;
        if (/mm$/.test(v)) return n * MM;
        if (/in$/.test(v)) return n * 96;
        return n;
    }

    /* ---------------- line heights ---------------- */

    /* lineHeights sets the px line height of every block in root that
       holds text, and the own height of any run that is bigger than its
       block's smallest run. */
    function applyLineHeights(root, defLS) {
        if (!root) return;
        defLS = defLS > 0 ? defLS : 1.15;
        var blocks = [];
        if (holdsInline(root) || !root.firstElementChild) blocks.push(root);
        var all = root.getElementsByTagName("*");
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (isInlineEl(el) || isSpacer(el)) continue;
            if (el.tagName === "TABLE" || el.tagName === "TBODY" || el.tagName === "TR" ||
                el.tagName === "COLGROUP" || el.tagName === "COL") continue;
            if (holdsInline(el) || !el.firstElementChild) blocks.push(el);
        }
        blocks.forEach(function (b) { lineHeightFor(b, defLS); });
    }

    function lineHeightFor(block, defLS) {
        var bcs = window.getComputedStyle(block);
        if (bcs.display === "none") return;
        var exact = block.getAttribute("data-lsexact");
        if (exact) {
            block.style.lineHeight = cssLenPx(exact) + "px";
            return;
        }
        var mult = blockSpacing(block, defLS);
        var minPx = cssLenPx(block.getAttribute("data-lsmin"));

        // the runs directly in this block: their sizes decide the lines
        var runs = [];
        var walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
            acceptNode: function (n) {
                // text of a nested block belongs to that block
                for (var p = n.parentNode; p && p !== block; p = p.parentNode) {
                    if (p.nodeType === 1 && !isInlineEl(p)) return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        var preWs = bcs.whiteSpace.indexOf("pre") === 0 || bcs.whiteSpace === "break-spaces";
        var node;
        while ((node = walker.nextNode())) {
            var txt = node.nodeValue;
            if (!txt || (!preWs && !/\S/.test(txt))) continue;
            var host = node.parentNode;
            // superscript / subscript never make a line taller
            var inScript = false;
            for (var q = host; q && q !== block; q = q.parentNode) {
                if (q.tagName === "SUP" || q.tagName === "SUB") { inScript = true; break; }
            }
            if (inScript) continue;
            var cs = window.getComputedStyle(host);
            runs.push({ el: host, size: parseFloat(cs.fontSize) || 14.67, family: cs.fontFamily });
        }
        var baseSize = parseFloat(bcs.fontSize) || 14.67;
        var baseFamily = bcs.fontFamily;
        var strut;
        if (!runs.length) {
            strut = lineHeightPx(baseSize, baseFamily, mult);
        } else {
            var min = runs[0];
            runs.forEach(function (r) { if (r.size < min.size) min = r; });
            // the paragraph's own font (its mark) takes part in every line
            strut = Math.max(lineHeightPx(min.size, min.family, mult),
                baseSize <= min.size + 0.01 ? lineHeightPx(baseSize, baseFamily, mult) : 0);
            // bigger runs carry their own height so only their lines grow
            runs.forEach(function (r) {
                if (r.el === block) return;
                if (r.size > min.size + 0.01) {
                    var own = Math.max(lineHeightPx(r.size, r.family, mult), minPx);
                    if (r.el.style.lineHeight !== own + "px") r.el.style.lineHeight = own + "px";
                } else if (r.el.style.lineHeight) {
                    r.el.style.lineHeight = "";
                }
            });
        }
        if (minPx > strut) strut = minPx;
        var v = strut + "px";
        if (block.style.lineHeight !== v) block.style.lineHeight = v;
        if (!runs.length) pictureLines(block, strut, baseSize, baseFamily, mult);
    }

    /* A line holding pictures is as tall as the tallest picture, plus 1.75pt
       above it and the part of a text line that hangs below the baseline
       under it - the pictures sit on the baseline. In a paragraph that holds
       only pictures that is set exactly: each picture is aligned to the
       bottom of its line and carries those two amounts as margins, so the
       line comes out the word processor's height to the fraction of a pixel
       (baseline alignment would round the picture's top to a whole pixel,
       which over a page of screenshots is a paragraph's worth of drift).
       Where the text baseline sits is the one thing CSS and a word
       processor disagree on: CSS splits the leading evenly around the
       glyphs, Word and Google Docs put nearly all the leading that 1.15
       spacing adds below them. The marks are undone before saving
       (data-picline). */
    var PICTURE_TOP_PX = 1.75 * PT;
    function pictureLines(block, strut, sizePx, family, mult) {
        var imgs = block.getElementsByTagName("img");
        if (!imgs.length) return;
        var r = fontRatios(family);
        var single = lineHeightPx(sizePx, family, 1);
        var baseline = Math.ceil(r.asc * sizePx - 1e-6) + 0.2 * (strut - single);
        var below = Math.max(0, strut - baseline);
        for (var i = 0; i < imgs.length; i++) {
            var im = imgs[i];
            if (im.classList.contains("doc-anchor")) continue;
            if (im.parentNode !== block && !isInlineEl(im.parentNode)) continue;
            im.setAttribute("data-picline", "1");
            im.style.verticalAlign = "bottom";
            im.style.marginTop = PICTURE_TOP_PX + "px";
            im.style.marginBottom = below + "px";
        }
    }
    function restorePictureLines(root) {
        var imgs = root.querySelectorAll("img[data-picline]");
        for (var i = 0; i < imgs.length; i++) {
            imgs[i].style.verticalAlign = "";
            imgs[i].style.marginTop = "";
            imgs[i].style.marginBottom = "";
            imgs[i].removeAttribute("data-picline");
            if (!imgs[i].getAttribute("style")) imgs[i].removeAttribute("style");
        }
    }

    /* ---------------- table borders ----------------
       A browser draws a border in whole device pixels, so a 1pt (1.33px)
       table rule takes 1px of layout - and a table of 40 rows comes out 13px
       shorter than on paper. The difference goes back in as cell padding,
       which is invisible and keeps the rows exactly as tall as the document
       says. The padding the document states is kept in data-pad0 and put
       back before anything is saved. */
    function applyTableBorders(root) {
        if (!root) return;
        var tables = root.getElementsByTagName("table");
        for (var t = 0; t < tables.length; t++) {
            var tbl = tables[t];
            // a table whose size has not moved since it was last fixed up
            // needs nothing (the signature is a property, never saved)
            if (tbl.__docsSig && tbl.__docsSig === tableSignature(tbl)) continue;
            fixTable(tbl);
            if (tbl.hasAttribute("data-docx")) roundRows(tbl);
            tbl.__docsSig = tableSignature(tbl);
        }
    }
    function tableSignature(tbl) {
        return tbl.rows.length + ":" + tbl.offsetHeight + ":" + tbl.offsetWidth + ":" + (scaleOf(tbl) || 1).toFixed(3);
    }
    function fixTable(tbl) {
        var rows = tbl.rows;
        var cells = [];
        // put back the stated padding first (writes only) ...
        for (var r = 0; r < rows.length; r++) {
            if (rows[r].classList.contains("doc-autobreak") || rows[r].closest("table") !== tbl) continue;
            for (var c = 0; c < rows[r].cells.length; c++) {
                var td = rows[r].cells[c];
                var orig = td.getAttribute("data-pad0");
                if (orig === null) {
                    orig = td.style.padding || "";
                    td.setAttribute("data-pad0", orig);
                } else if (td.style.padding !== orig) {
                    td.style.padding = orig;
                }
                cells.push({ td: td, last: r + td.rowSpan >= rows.length });
            }
        }
        // ... then measure everything once ...
        cells.forEach(function (it) {
            var wantTop = declaredBorder(it.td, "Top");
            var wantBottom = declaredBorder(it.td, "Bottom");
            if (!(wantTop > 0) && !(wantBottom > 0)) return;
            var cs = window.getComputedStyle(it.td);
            it.padTop = parseFloat(cs.paddingTop) || 0;
            it.padBottom = parseFloat(cs.paddingBottom) || 0;
            it.dTop = wantTop > 0 ? wantTop - (parseFloat(cs.borderTopWidth) || 0) : 0;
            it.dBottom = it.last && wantBottom > 0 ? wantBottom - (parseFloat(cs.borderBottomWidth) || 0) : 0;
        });
        // ... and write the differences
        cells.forEach(function (it) {
            if (it.dTop > 0.01) it.td.style.paddingTop = (it.padTop + it.dTop) + "px";
            if (it.dBottom > 0.01) it.td.style.paddingBottom = (it.padBottom + it.dBottom) + "px";
        });
    }

    /* Google Docs makes every table row a whole number of pixels tall
       (rounding up), so a row of one 10pt line is 31px, not 30.67. Read all
       the rows first and write after, so this costs one layout, not one
       per row. */
    function roundRows(tbl) {
        var scale = scaleOf(tbl) || 1;
        var rows = [];
        for (var r = 0; r < tbl.rows.length; r++) {
            var row = tbl.rows[r];
            if (row.classList.contains("doc-autobreak") || row.closest("table") !== tbl) continue;
            rows.push({ row: row, h: row.getBoundingClientRect().height / scale });
        }
        var writes = [];
        rows.forEach(function (it) {
            var extra = Math.ceil(it.h - 0.05) - it.h;
            if (extra <= 0.01) return;
            for (var c = 0; c < it.row.cells.length; c++) {
                var td = it.row.cells[c];
                if (td.rowSpan > 1) continue;
                writes.push({ td: td, pb: (parseFloat(window.getComputedStyle(td).paddingBottom) || 0) + extra });
            }
        });
        writes.forEach(function (w) { w.td.style.paddingBottom = w.pb + "px"; });
    }
    // the border width the document states (the specified value, before the
    // browser rounds it to device pixels)
    function declaredBorder(td, side) {
        var st = td.style["border" + side + "Style"];
        if (!st || st === "none" || st === "hidden") return 0;
        return cssLenPx(td.style["border" + side + "Width"]);
    }
    function restoreTablePadding(root) {
        var cells = root.querySelectorAll("[data-pad0]");
        for (var i = 0; i < cells.length; i++) {
            cells[i].style.padding = cells[i].getAttribute("data-pad0");
            cells[i].removeAttribute("data-pad0");
        }
    }

    /* ---------------- list numbering ---------------- */

    var BULLETS = [String.fromCharCode(0x25CF), String.fromCharCode(0x25CB), String.fromCharCode(0x25A0)];
    var ORDERED = ["decimal", "lowerLetter", "lowerRoman"];

    function roman(n) {
        if (n < 1 || n > 3999) return String(n);
        var v = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
        var s = ["m", "cm", "d", "cd", "c", "xc", "l", "xl", "x", "ix", "v", "iv", "i"];
        var out = "";
        for (var i = 0; i < v.length; i++) while (n >= v[i]) { out += s[i]; n -= v[i]; }
        return out;
    }
    function formatNumber(n, fmt) {
        switch (fmt) {
            case "lowerLetter":
            case "upperLetter":
                if (n < 1) return String(n);
                var ch = String.fromCharCode(97 + (n - 1) % 26);
                var s = new Array(Math.floor((n - 1) / 26) + 2).join(ch);
                return fmt === "upperLetter" ? s.toUpperCase() : s;
            case "lowerRoman": return roman(n);
            case "upperRoman": return roman(n).toUpperCase();
            case "decimalZero": return n < 10 ? "0" + n : String(n);
            case "none":
            case "bullet": return "";
        }
        return String(n);
    }

    function isList(el) { return el && (el.tagName === "OL" || el.tagName === "UL"); }

    /* depth of a list among its list ancestors (0 = outermost) */
    function listDepth(list, root) {
        var d = 0;
        for (var p = list.parentNode; p && p !== root; p = p.parentNode) {
            if (isList(p)) d++;
        }
        return d;
    }

    function applyNumbering(root) {
        if (!root) return;
        var lists = root.querySelectorAll("ol, ul");
        // continuation state per list instance and level
        var carried = {};
        // a list split across a page carries on in its tail, and the tail
        // of a split item is the same item (no marker, no count)
        var splitEnd = {}, splitItem = {};
        for (var i = 0; i < lists.length; i++) {
            var list = lists[i];
            if (list.classList.contains("of-checklist")) continue;
            var depth = listDepth(list, root);
            var ordered = list.tagName === "OL";
            var fmt = list.getAttribute("data-fmt") ||
                (ordered ? ORDERED[depth % ORDERED.length] : "bullet");
            var text = list.getAttribute("data-lvltext");
            if (text === null) {
                text = fmt === "bullet" ? BULLETS[depth % BULLETS.length] : "%" + (depth + 1) + ".";
            }
            var num = list.getAttribute("data-num");
            var key = num ? num + ":" + depth : null;
            var start = parseInt(list.getAttribute("start"), 10);
            var counter;
            var listOf = list.getAttribute("data-split-of");
            if (key && carried[key] !== undefined) counter = carried[key];
            else if (listOf && splitEnd[listOf] !== undefined) counter = splitEnd[listOf];
            else counter = (isNaN(start) ? 1 : start) - 1;

            for (var c = list.firstElementChild; c; c = c.nextElementSibling) {
                if (c.tagName !== "LI") continue;
                var itemOf = c.getAttribute("data-split-of");
                if (itemOf) {
                    var headItem = splitItem[itemOf];
                    c.setAttribute("data-n", headItem ? headItem.getAttribute("data-n") : counter);
                    if (c.getAttribute("data-marker") !== "") c.setAttribute("data-marker", "");
                    if (c.hasAttribute("data-split")) splitItem[c.getAttribute("data-split")] = headItem || c;
                    continue;
                }
                if (c.hasAttribute("data-split")) splitItem[c.getAttribute("data-split")] = c;
                var v = parseInt(c.getAttribute("value"), 10);
                counter = isNaN(v) ? counter + 1 : v;
                c.setAttribute("data-n", counter);
                var marker = text.replace(/%(\d)/g, function (m, lvl) {
                    var want = parseInt(lvl, 10) - 1;
                    if (want === depth) return formatNumber(counter, fmt);
                    var anc = ancestorItem(c, want, root);
                    if (!anc) return "";
                    var ancList = anc.parentNode;
                    var ancFmt = ancList.getAttribute("data-fmt") ||
                        (ancList.tagName === "OL" ? ORDERED[want % ORDERED.length] : "bullet");
                    return formatNumber(parseInt(anc.getAttribute("data-n"), 10) || 1, ancFmt);
                });
                if (fmt === "none") marker = text.replace(/%\d/g, "");
                if (c.getAttribute("data-marker") !== marker) c.setAttribute("data-marker", marker);
            }
            if (key) carried[key] = counter;
            if (list.hasAttribute("data-split")) splitEnd[list.getAttribute("data-split")] = counter;
            // a deeper level restarts once a shallower item of the same list
            // comes along
            if (key) {
                for (var k in carried) {
                    var parts = k.split(":");
                    if (parts[0] === num && parseInt(parts[1], 10) > depth) delete carried[k];
                }
            }
        }
    }

    // the list item at a given depth that a nested list item hangs off
    function ancestorItem(li, depth, root) {
        var list = li.parentNode;
        while (list && list !== root) {
            var parent = list.parentNode;
            var d = listDepth(list, root);
            if (d === depth + 1 || (d > depth && isList(parent) && listDepth(parent, root) === depth)) {
                // nested directly in a list: the item before it
                if (isList(parent)) {
                    for (var p = list.previousElementSibling; p; p = p.previousElementSibling) {
                        if (p.tagName === "LI") return p;
                    }
                    return null;
                }
                if (parent && parent.tagName === "LI") return parent;
            }
            list = parent;
        }
        return null;
    }

    /* ---------------- tabs ---------------- */

    // the edge tab stops are measured from: a table cell's content box, or
    // the text column
    function tabOrigin(span, rootEl) {
        for (var p = span.parentNode; p && p !== rootEl; p = p.parentNode) {
            if (p.tagName === "TD" || p.tagName === "TH") {
                var r = p.getBoundingClientRect();
                var cs = window.getComputedStyle(p);
                return r.left + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0) * scaleOf(p);
            }
        }
        var rr = rootEl.getBoundingClientRect();
        var rcs = window.getComputedStyle(rootEl);
        return rr.left + (parseFloat(rcs.paddingLeft) || 0) * scaleOf(rootEl);
    }
    function scaleOf(el) {
        var h = el.offsetWidth;
        var r = el.getBoundingClientRect().width;
        return h > 0 && r > 0 ? r / h : 1;
    }
    function parseTabs(block) {
        var out = [];
        for (var b = block; b; b = b.parentElement) {
            var raw = b.getAttribute && b.getAttribute("data-tabs");
            if (raw) {
                raw.split(";").forEach(function (t) {
                    var p = t.split(":");
                    var pos = parseFloat(p[1]);
                    if (!isNaN(pos)) out.push({ align: p[0] || "left", pos: pos * PT, leader: p[2] || "none" });
                });
                break;
            }
            if (!isInlineEl(b) && !holdsInline(b)) break;
        }
        out.sort(function (a, b) { return a.pos - b.pos; });
        return out;
    }
    function lineBlockOf(el, rootEl) {
        for (var p = el.parentNode; p && p !== rootEl; p = p.parentNode) {
            if (p.nodeType === 1 && !isInlineEl(p)) return p;
        }
        return rootEl;
    }

    function applyTabs(root) {
        if (!root) return;
        // a tab's position only depends on what comes before it, and the
        // ones before it are sized first - so each tab can be measured as
        // it stands and written only when its width really changes, which
        // on an unchanged document means no layout work at all
        var spans = root.querySelectorAll("span.doc-tab");
        for (var i = 0; i < spans.length; i++) sizeTab(spans[i], root);
    }

    function sizeTab(span, root) {
        var block = lineBlockOf(span, root);
        var scale = scaleOf(root) || 1;
        if (span.style.display !== "inline-block") span.style.display = "inline-block";
        var origin = tabOrigin(span, root);
        var x = (span.getBoundingClientRect().left - origin) / scale;
        var stops = parseTabs(block);
        var stop = null;
        for (var i = 0; i < stops.length; i++) {
            if (stops[i].pos > x + 0.5) { stop = stops[i]; break; }
        }
        var w;
        if (!stop) {
            var grid = DEFAULT_TAB_PT * PT;
            w = (Math.floor(x / grid + 1e-6) + 1) * grid - x;
            if (w < 1) w += grid;
        } else if (stop.align === "right" || stop.align === "center" || stop.align === "decimal") {
            // the text after the tab, up to the next tab or the end of the line
            var follow = followingWidth(span, block) / scale;
            // a right stop sits on the margin more often than not; a hair of
            // slack keeps the number from wrapping to a line of its own
            w = stop.pos - x - (stop.align === "center" ? follow / 2 : follow) - 1;
            if (w < 0) w = 0;
        } else {
            w = stop.pos - x;
        }
        w = Math.max(0, w);
        if (Math.abs((parseFloat(span.style.width) || -1) - w) > 0.25) span.style.width = w + "px";
        var leader = stop && stop.leader && stop.leader !== "none" ? stop.leader : null;
        if (span.getAttribute("data-leader") !== leader) {
            if (leader) span.setAttribute("data-leader", leader);
            else span.removeAttribute("data-leader");
        }
    }

    function followingWidth(span, block) {
        var range = document.createRange();
        range.setStartAfter(span);
        var end = null;
        var walker = document.createTreeWalker(block, NodeFilter.SHOW_ELEMENT, null);
        walker.currentNode = span;
        var n;
        while ((n = walker.nextNode())) {
            if (n.classList && n.classList.contains("doc-tab")) { end = n; break; }
            if (n.tagName === "BR") { end = n; break; }
        }
        if (end) range.setEndBefore(end);
        else range.setEnd(block, block.childNodes.length);
        var rects = range.getClientRects();
        if (!rects.length) return 0;
        // only what stays on the tab's own line counts
        var top = span.getBoundingClientRect().top;
        var left = Infinity, right = -Infinity;
        for (var i = 0; i < rects.length; i++) {
            if (Math.abs(rects[i].top - top) > rects[i].height) continue;
            left = Math.min(left, rects[i].left);
            right = Math.max(right, rects[i].right);
        }
        return right > left ? right - left : 0;
    }

    /* ---------------- footnote references ---------------- */

    function numberFootnotes(root) {
        var order = [];
        if (!root) return order;
        var refs = root.querySelectorAll("sup.doc-fnref");
        for (var i = 0; i < refs.length; i++) {
            var id = refs[i].getAttribute("data-fn");
            var n = order.indexOf(id);
            if (n < 0) { order.push(id); n = order.length - 1; }
            var label = String(n + 1);
            if (refs[i].textContent !== label) refs[i].textContent = label;
            refs[i].setAttribute("contenteditable", "false");
        }
        return order;
    }

    /* ---------------- pagination ---------------- */

    function Paginator(o) {
        this.o = o;
        this.editor = o.editor;
        this.pageEl = o.pageEl;
        this.sheetH = o.sheetH;
        this.gap = o.gap;
        this.mTop = o.mTop;
        this.mBot = o.mBot;
    }

    // y of an element's border-box top in #page padding-box coordinates
    Paginator.prototype.top = function (el) {
        var y = 0;
        var n = el;
        while (n && n !== this.pageEl) {
            y += n.offsetTop;
            n = n.offsetParent;
            if (n === document.body || !n) {
                // #page is not the offset parent chain root: measure
                return this.rectTop(el.getBoundingClientRect());
            }
        }
        return y;
    };
    Paginator.prototype.bottom = function (el) {
        return this.top(el) + el.offsetHeight;
    };
    Paginator.prototype.scale = function () {
        var h = this.pageEl.offsetHeight;
        var r = this.pageEl.getBoundingClientRect().height;
        return h > 0 && r > 0 ? r / h : 1;
    };
    Paginator.prototype.rectTop = function (rect) {
        var pr = this.pageEl.getBoundingClientRect();
        return (rect.top - pr.top) / this._scale - this.pageEl.clientTop;
    };
    Paginator.prototype.rectBottom = function (rect) {
        var pr = this.pageEl.getBoundingClientRect();
        return (rect.bottom - pr.top) / this._scale - this.pageEl.clientTop;
    };
    Paginator.prototype.sheetTop = function (i) { return i * (this.sheetH + this.gap); };
    Paginator.prototype.contentTop = function (i) { return this.sheetTop(i) + this.mTop; };
    Paginator.prototype.contentBottom = function (i) { return this.sheetTop(i) + this.sheetH - this.mBot; };

    /* ---- splitting what crosses a page ----

       A page boundary is real in the DOM. Whatever runs across it - a
       paragraph, the list or quote around it, a table row and the cells of
       that row - is cut into two elements: the head keeps what fits on the
       page, a shallow copy (the tail) receives the rest, and a spacer
       between them pushes the tail to the top of the next sheet. A border,
       a shading or a cell rule therefore ends at the bottom of its page and
       starts again on the next one, and nothing is left painted across the
       gap between the sheets.

       The two halves are paired with a token: data-split on the head,
       data-split-of on the tail, data-pair on the spacer. Undoing a split
       (before a relayout, and on everything that is saved) moves the tail's
       content back into its head - an inner pair (a span or a cell cut in
       the same place) is joined along the way - and the text node that was
       divided is joined again. The caret is followed through all of it. */

    var splitSeq = 0;
    var splitBase = Math.floor(Math.random() * 46656).toString(36) + "-";
    function newToken() {
        splitSeq++;
        return splitBase + splitSeq.toString(36);
    }

    // the selection, followed through the node moves a split makes
    var track = null;
    function beginTrack(root) {
        var outer = track;
        var sel = window.getSelection ? window.getSelection() : null;
        if (!outer && sel && sel.rangeCount && sel.anchorNode && root.contains(sel.anchorNode)) {
            track = {
                sel: sel, a: sel.anchorNode, ao: sel.anchorOffset,
                f: sel.focusNode, fo: sel.focusOffset, moved: false
            };
        }
        return { outer: outer, mine: !outer && !!track };
    }
    function endTrack(t) {
        if (!t.mine) return;
        var tr = track;
        track = null;
        if (!tr || !tr.moved) return;
        if (!tr.a.isConnected || !tr.f.isConnected) return;
        var len = function (n) { return n.nodeType === 3 ? n.nodeValue.length : n.childNodes.length; };
        try {
            tr.sel.setBaseAndExtent(tr.a, Math.min(tr.ao, len(tr.a)), tr.f, Math.min(tr.fo, len(tr.f)));
        } catch (e) { /* a selection the browser will not take back: leave it */ }
    }
    function noteMoved() {
        if (track) track.moved = true;
    }
    function splitText(node, offset) {
        var tail = node.splitText(offset);
        if (track) {
            if (track.a === node && track.ao > offset) { track.a = tail; track.ao -= offset; }
            if (track.f === node && track.fo > offset) { track.f = tail; track.fo -= offset; }
            track.moved = true;
        }
        return tail;
    }
    function joinText(prev, next) {
        var n = prev.nodeValue.length;
        if (track) {
            if (track.a === next) { track.a = prev; track.ao += n; }
            if (track.f === next) { track.f = prev; track.fo += n; }
            track.moved = true;
        }
        prev.nodeValue += next.nodeValue;
        next.parentNode.removeChild(next);
    }

    var SPLIT_BOX = { TR: 1, TD: 1, TH: 1, TBODY: 1, THEAD: 1, TFOOT: 1 };
    function cloneShell(el) {
        var c = el.cloneNode(false);
        c.removeAttribute("id");
        c.removeAttribute("data-split");
        c.removeAttribute("data-split-of");
        c.removeAttribute("data-marker");
        c.classList.remove("doc-split-head", "doc-split-tail");
        if (!c.getAttribute("class")) c.removeAttribute("class");
        if (el.tagName === "OL") c.removeAttribute("start");
        if (el.classList.contains("doc-colsec")) {
            // the rest of a column section is laid out afresh on its page
            c.style.height = "";
            c.classList.remove("doc-colsec-fill");
            if (!c.getAttribute("style")) c.removeAttribute("style");
        }
        if (el.tagName === "TR") {
            c.style.height = "";
            c.removeAttribute("height");
            if (!c.getAttribute("style")) c.removeAttribute("style");
        }
        if (el.tagName === "TABLE") {
            // the tail of a table needs the column widths too
            for (var k = el.firstElementChild; k; k = k.nextElementSibling) {
                if (k.tagName !== "COLGROUP") continue;
                var cg = k.cloneNode(true);
                cg.setAttribute("data-split-copy", "1");
                c.appendChild(cg);
            }
        }
        return c;
    }
    function pairUp(head, tail) {
        var k = newToken();
        head.setAttribute("data-split", k);
        tail.setAttribute("data-split-of", k);
        if (!SPLIT_BOX[head.tagName] && !isInlineEl(head)) {
            head.classList.add("doc-split-head");
            tail.classList.add("doc-split-tail");
        }
        return k;
    }
    /* unmark drops one role from an element - "head" or "tail" - or both.
       An element can be both at once (the middle of a row that spans three
       pages), so undoing one split must leave the other alone. deep strips
       everything below it too (a split that is being given up). */
    function unmark(el, role, deep) {
        var list = deep ? [el].concat(Array.prototype.slice.call(el.querySelectorAll("[data-split],[data-split-of]"))) : [el];
        list.forEach(function (n, i) {
            var r = i === 0 ? role : "both";
            if (r !== "tail") {
                n.removeAttribute("data-split");
                n.classList.remove("doc-split-head");
            }
            if (r !== "head") {
                n.removeAttribute("data-split-of");
                n.classList.remove("doc-split-tail");
            }
            if (!n.getAttribute("class")) n.removeAttribute("class");
        });
    }
    function meaningful(n) {
        if (n.nodeType === 3) return /\S/.test(n.nodeValue);
        return n.nodeType === 1 && !isSpacer(n) && !n.hasAttribute("data-split-copy");
    }
    function prevMeaningful(n) {
        for (var p = n.previousSibling; p; p = p.previousSibling) if (meaningful(p)) return p;
        return null;
    }
    function nextMeaningful(n) {
        for (var p = n.nextSibling; p; p = p.nextSibling) if (meaningful(p)) return p;
        return null;
    }
    function nextInOrder(node, stop) {
        for (var n = node; n && n !== stop; n = n.parentNode) {
            if (n.nextSibling) return n.nextSibling;
        }
        return null;
    }

    /* splitTree moves `start` and everything after it, up to the end of
       `boundary`, into shallow copies of the ancestors in between. Returns
       the node directly inside boundary that the moved content begins with.
       An ancestor whose content all moves is taken along whole instead of
       being copied, so no half is ever left empty. */
    function splitTree(start, boundary) {
        var cur = start;
        if (!cur || cur === boundary || !boundary.contains(cur)) return null;
        while (cur && cur.parentNode && cur.parentNode !== boundary) {
            var parent = cur.parentNode;
            if (!prevMeaningful(cur)) {
                cur = parent;
                continue;
            }
            var clone = cloneShell(parent);
            pairUp(parent, clone);
            parent.parentNode.insertBefore(clone, parent.nextSibling);
            var n = cur;
            while (n) {
                var nx = n.nextSibling;
                clone.appendChild(n);
                n = nx;
            }
            noteMoved();
            cur = clone;
        }
        return cur;
    }

    // the node a line cut starts the moved content with (text divided there)
    function lineStartNode(cut) {
        if (cut.beforeEl) return cut.beforeEl;
        var node = cut.node;
        var len = node.nodeValue.length;
        var at = cut.offset;
        // the space a line wrapped at stays at the end of the line above,
        // where it collapses; at the start of the next page it would not
        var ws = node.parentNode ? window.getComputedStyle(node.parentNode).whiteSpace : "normal";
        if (ws.indexOf("pre") !== 0 && ws !== "break-spaces") {
            while (at > 0 && at < len && /\s/.test(node.nodeValue.charAt(at))) at++;
        }
        cut = { el: cut.el, node: node, offset: at };
        if (cut.offset > 0 && cut.offset < len) return splitText(node, cut.offset);
        if (cut.offset >= len) return nextInOrder(node, cut.el);
        return node;
    }

    /* mergePair undoes one split: the tail's content goes back to the end
       of its head (for a table row, cell by cell) and the tail goes away */
    function mergePair(head, tail) {
        if (!head || !tail || !tail.parentNode) return;
        noteMoved();
        if (head.tagName === "TR" && tail.tagName === "TR") {
            var tcells = Array.prototype.slice.call(tail.cells);
            for (var i = 0; i < tcells.length; i++) {
                var hc = head.cells[i];
                if (hc) {
                    mergeChildren(hc, tcells[i]);
                    unmark(hc, "head");
                } else {
                    unmark(tcells[i], "tail");
                    head.appendChild(tcells[i]);
                }
            }
        } else {
            mergeChildren(head, tail);
        }
        if (tail.parentNode) tail.parentNode.removeChild(tail);
        unmark(head, "head");
        if (head.classList.contains("doc-colsec")) resetColumns(head);
    }
    function mergeChildren(head, tail) {
        var c, nx;
        for (c = tail.firstChild; c; c = nx) {
            nx = c.nextSibling;
            if (c.nodeType === 1 && c.hasAttribute("data-split-copy")) tail.removeChild(c);
        }
        // an inner pair cut at the same place (a span, a list, a nested
        // table) joins first, so the content meets inside it
        var last = head.lastChild;
        while (last && !meaningful(last)) last = last.previousSibling;
        var first = tail.firstChild;
        while (first && !meaningful(first)) first = first.nextSibling;
        if (last && first && last.nodeType === 1 && first.nodeType === 1) {
            var k = first.getAttribute("data-split-of");
            if (k && last.getAttribute("data-split") === k) mergePair(last, first);
        }
        var seam = head.lastChild;
        while (tail.firstChild) head.appendChild(tail.firstChild);
        if (seam && seam.nodeType === 3 && seam.nextSibling && seam.nextSibling.nodeType === 3) {
            joinText(seam, seam.nextSibling);
        }
    }

    // undo the split a spacer stands for (the spacer is already gone)
    function mergeAround(root, k, prev, next) {
        if (!k) return;
        var head = prev && prev.nodeType === 1 && prev.getAttribute("data-split") === k ? prev : null;
        var tail = next && next.nodeType === 1 && next.getAttribute("data-split-of") === k ? next : null;
        if (!head) {
            var hs = root.querySelectorAll('[data-split="' + k + '"]');
            head = hs.length ? hs[hs.length - 1] : null;
        }
        if (!tail) tail = root.querySelector('[data-split-of="' + k + '"]');
        if (head && tail) mergePair(head, tail);
        else {
            if (head) unmark(head, "head");
            if (tail) unmark(tail, "tail");
        }
    }

    function removeSpacerList(list, root) {
        for (var i = list.length - 1; i >= 0; i--) {
            var el = list[i];
            var parent = el.parentNode;
            if (!parent) continue;
            var k = el.getAttribute("data-pair");
            var prev = el.previousSibling, next = el.nextSibling;
            while (prev && !meaningful(prev) && !isSpacer(prev)) prev = prev.previousSibling;
            while (next && !meaningful(next) && !isSpacer(next)) next = next.nextSibling;
            parent.removeChild(el);
            noteMoved();
            if (k) {
                mergeAround(root, k, prev, next);
            } else if (prev && next && prev.nodeType === 3 && next.nodeType === 3 &&
                    prev.nextSibling === next) {
                // a line spacer from an older layout divided this text
                joinText(prev, next);
            }
        }
    }

    function isInner(el) {
        var p = el.parentNode;
        return !!(p && p.nodeType === 1 && (p.hasAttribute("data-split") || p.hasAttribute("data-split-of")));
    }
    /* repairSplits puts right what editing did to a split: a tail whose
       spacer was deleted joins its head again, and a marker left without
       its partner (the tail typed away, a copy made by Enter) is dropped.
       With all, every remaining pair is undone - what is saved has none. */
    function repairSplits(root, all) {
        var tails = root.querySelectorAll("[data-split-of]");
        var i;
        for (i = tails.length - 1; i >= 0; i--) {
            var tl = tails[i];
            if (!tl.parentNode || !root.contains(tl) || isInner(tl)) continue;
            var k = tl.getAttribute("data-split-of");
            var prev = tl.previousSibling;
            while (prev && !meaningful(prev) && !isSpacer(prev)) prev = prev.previousSibling;
            if (!all && prev && isSpacer(prev) && prev.getAttribute("data-pair") === k) continue;
            var head = prev && prev.nodeType === 1 && prev.getAttribute("data-split") === k ? prev : null;
            if (head) mergePair(head, tl);
            else unmark(tl, "tail", true);
        }
        var heads = root.querySelectorAll("[data-split]");
        for (i = 0; i < heads.length; i++) {
            var h = heads[i];
            if (!h.isConnected || !h.hasAttribute("data-split") || isInner(h)) continue;
            var nx = h.nextSibling;
            while (nx && !meaningful(nx) && !isSpacer(nx)) nx = nx.nextSibling;
            if (!all && nx && isSpacer(nx) && nx.getAttribute("data-pair") === h.getAttribute("data-split")) continue;
            unmark(h, "head", true);
        }
    }

    function removeSpacers(root) {
        var t = beginTrack(root);
        try {
            removeSpacerList(root.querySelectorAll(".doc-autobreak"), root);
            repairSplits(root, true);
            unwrapColumns(root);
            var breaks = root.querySelectorAll(".doc-pagebreak");
            for (var i = 0; i < breaks.length; i++) breaks[i].style.height = "0px";
        } finally {
            endTrack(t);
        }
    }

    /* unsplitWithin undoes the splits inside an element (a table about to
       gain or lose a row or column) */
    function unsplitWithin(root, el) {
        if (!root || !el) return false;
        var list = el.querySelectorAll(".doc-autobreak");
        if (!list.length) return false;
        var t = beginTrack(root);
        try {
            removeSpacerList(list, root);
            repairSplits(root, false);
        } finally {
            endTrack(t);
        }
        return true;
    }

    /* unsplitAtCaret is called before a key edits the document. A
       Backspace at the start of what a page break moved, a Delete at the
       end of what it left behind, or any key over a selection that spans a
       page boundary would otherwise act on the spacer rather than on the
       text; the split in the way is undone first, and the edit then does
       what it would do in one continuous paragraph. */
    function edgeEmpty(el, caretNode, caretOffset, atStart) {
        var r = document.createRange();
        try {
            if (atStart) {
                r.setStart(el, 0);
                r.setEnd(caretNode, caretOffset);
            } else {
                r.setStart(caretNode, caretOffset);
                r.setEnd(el, el.childNodes.length);
            }
        } catch (e) { return false; }
        if (r.toString().replace(/\s/g, "").split(String.fromCharCode(0x200B)).join("") !== "") return false;
        var frag = r.cloneContents();
        return !frag.querySelector || !frag.querySelector("img,table,hr");
    }
    function unsplitAtCaret(root, backward) {
        var sel = window.getSelection ? window.getSelection() : null;
        if (!sel || !sel.rangeCount) return false;
        var r = sel.getRangeAt(0);
        if (!root.contains(r.commonAncestorContainer)) return false;
        var spacers = [];
        var all, i;
        if (!r.collapsed) {
            all = root.querySelectorAll(".doc-autobreak");
            for (i = 0; i < all.length; i++) {
                if (r.intersectsNode(all[i])) spacers.push(all[i]);
            }
        } else {
            var node = backward ? r.startContainer : r.endContainer;
            var off = backward ? r.startOffset : r.endOffset;
            var el = node.nodeType === 1 ? node : node.parentNode;
            while (el && el !== root) {
                if (el.tagName !== "TR" && !edgeEmpty(el, node, off, backward) &&
                        !((el.tagName === "TD" || el.tagName === "TH") && el.hasAttribute(backward ? "data-split-of" : "data-split"))) {
                    break;
                }
                var sib = backward ? el.previousSibling : el.nextSibling;
                while (sib && !meaningful(sib) && !isSpacer(sib)) sib = backward ? sib.previousSibling : sib.nextSibling;
                if (sib && isSpacer(sib)) {
                    spacers.push(sib);
                    break;
                }
                if (el.tagName === "TD" || el.tagName === "TH") {
                    el = el.parentNode;
                    continue;
                }
                if (sib) break;
                el = el.parentNode;
            }
        }
        if (!spacers.length) return false;
        var t = beginTrack(root);
        try {
            removeSpacerList(spacers, root);
            repairSplits(root, false);
        } finally {
            endTrack(t);
        }
        return true;
    }

    /* ---- columns ----

       A multi-column page is laid out in column sections: every run of
       text that flows in columns (everything between two full-width blocks,
       .col-span-all) is wrapped in a div.doc-colsec with CSS columns, and a
       full-width block stays outside, across the page. A section that fits
       on its page balances its columns; one that runs past the page bottom
       is given the height that is left and filled column by column, and it
       splits - like any other block - at the first content that spilled
       into a column past the last one. The copy of the section carries the
       rest to the next page, where it is laid out the same way.

       Sections are layout only, like spacers: made before every layout of a
       columned document and taken out again on everything that is saved. */
    function isSpanning(el) {
        return el.classList.contains("col-span-all") || el.classList.contains("doc-pagebreak") ||
            el.getAttribute("data-page-break-before") === "1";
    }
    function resetColumns(sec) {
        sec.classList.remove("doc-colsec-fill");
        sec.style.height = "";
        if (!sec.getAttribute("style")) sec.removeAttribute("style");
    }
    function unwrapColumns(root) {
        var secs = root.querySelectorAll(".doc-colsec");
        for (var i = secs.length - 1; i >= 0; i--) {
            var sec = secs[i];
            var parent = sec.parentNode;
            if (!parent) continue;
            while (sec.firstChild) parent.insertBefore(sec.firstChild, sec);
            parent.removeChild(sec);
            noteMoved();
        }
    }
    function wrapColumns(root) {
        var sec = null;
        for (var n = root.firstChild; n; ) {
            var next = n.nextSibling;
            var breaks = n.nodeType === 1 && (isSpacer(n) || isSpanning(n) || n.classList.contains("doc-colsec"));
            if (breaks) {
                sec = null;
            } else if (n.nodeType === 1 || (n.nodeType === 3 && /\S/.test(n.nodeValue))) {
                if (!sec) {
                    sec = document.createElement("div");
                    sec.className = "doc-colsec";
                    root.insertBefore(sec, n);
                }
                sec.appendChild(n);
                noteMoved();
            } else if (sec) {
                sec.appendChild(n);
            }
            n = next;
        }
    }

    /* the first content of a column section that sits in a column past the
       last one the page has: { before: el } or { block, node, offset } /
       { block, beforeEl } for a line inside a paragraph */
    Paginator.prototype.columnOverflow = function (sec) {
        var n = Math.max(1, this.o.columns || 1);
        var cs = window.getComputedStyle(sec);
        var gap = parseFloat(cs.columnGap) || 0;
        var colW = (sec.clientWidth - gap * (n - 1)) / n;
        var scale = this._scale || 1;
        var limit = sec.getBoundingClientRect().left + (n * colW + (n - 0.5) * gap) * scale;
        function past(rect) { return rect.left >= limit - 0.5; }
        function anyPast(rects) {
            for (var i = 0; i < rects.length; i++) if (past(rects[i])) return true;
            return false;
        }
        var range = document.createRange();
        function charRect(node, i, len) {
            for (; i < len; i++) {
                range.setStart(node, i);
                range.setEnd(node, i + 1);
                var rr = range.getClientRects();
                if (rr.length && rr[0].height > 0) return { rect: rr[rr.length - 1], at: i };
            }
            return null;
        }
        function inLine(block) {
            var walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
            var node;
            while ((node = walker.nextNode())) {
                if (node.nodeType === 1) {
                    if (node.tagName === "IMG" && anyPast(node.getClientRects())) return { block: block, beforeEl: node };
                    continue;
                }
                if (!node.nodeValue) continue;
                range.selectNodeContents(node);
                if (!anyPast(range.getClientRects())) continue;
                var len = node.nodeValue.length;
                var lo = 0, hi = len - 1, ans = len;
                while (lo <= hi) {
                    var mid = (lo + hi) >> 1;
                    var cr = charRect(node, mid, len);
                    if (!cr) { hi = mid - 1; continue; }
                    if (past(cr.rect)) { ans = Math.min(ans, cr.at); hi = mid - 1; }
                    else lo = cr.at + 1;
                }
                return { block: block, node: node, offset: Math.min(ans, len) };
            }
            return null;
        }
        function find(container) {
            for (var c = container.firstElementChild; c; c = c.nextElementSibling) {
                if (isSpacer(c)) continue;
                var rects = c.getClientRects();
                if (!rects.length) continue;
                if (past(rects[0])) return { before: c };
                if (!anyPast(rects)) continue;
                if (c.tagName === "TABLE") {
                    var rows = rowsOf(c);
                    for (var r = 0; r < rows.length; r++) {
                        if (anyPast(rows[r].getClientRects())) return { before: r === 0 ? c : rows[r] };
                    }
                    return { before: c };
                }
                if (c.tagName === "IMG" || c.tagName === "HR" || c.tagName === "VIDEO" || c.tagName === "IFRAME") {
                    return { before: c };
                }
                if (hasBlockChild(c)) {
                    var inner = find(c);
                    if (inner) return inner;
                    return { before: c };
                }
                return inLine(c) || { before: c };
            }
            return null;
        };
        return find(sec);
    };

    Paginator.prototype.splitColumns = function (sec, B, C, boundary) {
        var top = this.top(sec);
        var avail = B - top;
        if (avail < 2) return top > C + 1 ? this.beforeCut(sec, C, boundary) : { kind: "overflow", y: top };
        sec.classList.add("doc-colsec-fill");
        sec.style.height = avail + "px";
        var hit = this.columnOverflow(sec);
        if (!hit) return { kind: "fit" };
        // nothing of the section fits: it moves whole, or spills when it
        // already starts the page
        var startNode = hit.before ? hit.before.parentNode : (hit.beforeEl ? hit.beforeEl.parentNode : hit.node);
        var startOffset = hit.before ? Array.prototype.indexOf.call(hit.before.parentNode.childNodes, hit.before) :
            (hit.beforeEl ? Array.prototype.indexOf.call(hit.beforeEl.parentNode.childNodes, hit.beforeEl) : hit.offset);
        if (edgeEmpty(sec, startNode, startOffset, true)) {
            resetColumns(sec);
            return top > C + 1 ? this.beforeCut(sec, C, boundary) : { kind: "overflow", y: top };
        }
        // the page is full: its footnotes are the references above B in the
        // columns that stay
        if (hit.before) return { kind: "before", el: hit.before, col: true, y: B + 0.5, boundary: boundary };
        return {
            kind: "line", el: hit.block, node: hit.node, offset: hit.offset, beforeEl: hit.beforeEl,
            y: B + 0.5, boundary: boundary
        };
    };

    function blockKids(container) {
        var out = [];
        for (var c = container.firstElementChild; c; c = c.nextElementSibling) {
            if (isSpacer(c)) continue;
            if (c.tagName === "COLGROUP" || c.tagName === "COL") continue;
            out.push(c);
        }
        return out;
    }

    function keepsWithNext(el) {
        if (el.getAttribute("data-keep-next") === "1") return true;
        // headings written in the editor keep with what follows, like the
        // Heading styles of every word processor
        return /^H[1-6]$/.test(el.tagName) && !el.hasAttribute("data-keep-next");
    }

    /* A cut says where page content stops:
         { kind: "before", el }        content from el moves (a block, li, row)
         { kind: "line", el, node, offset | beforeEl }  a block splits at a line
         { kind: "row", tr, cells: [cut|null per cell] }
         { kind: "explicit", el }      a manual page break
         { kind: "overflow" }          nothing movable: content spills over
       with y = where the moved content currently starts, and boundary = the
       element the split reaches up to (the editor, or a table cell). */

    Paginator.prototype.findCut = function (container, B, C, boundary) {
        var kids = blockKids(container);
        if (!kids.length) return null;
        // explicit breaks and page-break-before on this level
        for (var e = 0; e < kids.length; e++) {
            var k = kids[e];
            if (k.classList.contains("doc-pagebreak")) {
                var ty = this.top(k);
                if (ty >= C - 1 && ty <= B + 0.5) return { kind: "explicit", el: k, y: ty, boundary: boundary };
            } else if (k.getAttribute("data-page-break-before") === "1") {
                var py = this.top(k);
                if (py > C + 1 && py <= B + 0.5) return this.beforeCut(k, C, boundary);
            }
        }
        // first child whose bottom crosses B (children are in flow order)
        var lo = 0, hi = kids.length - 1, idx = -1;
        while (lo <= hi) {
            var mid = (lo + hi) >> 1;
            if (this.bottom(kids[mid]) > B + 0.5) { idx = mid; hi = mid - 1; }
            else lo = mid + 1;
        }
        if (idx < 0) return null;
        // a float or a negative margin can leave an earlier child lower;
        // walk back over anything that also crosses
        while (idx > 0 && this.bottom(kids[idx - 1]) > B + 0.5) idx--;
        // a child that only hangs its spacing-after over the edge still
        // fits - the cut belongs to whatever comes after it
        for (; idx < kids.length; idx++) {
            if (idx > 0 && this.bottom(kids[idx]) <= B + 0.5) continue;
            var cut = this.splitChild(kids[idx], B, C, boundary);
            if (cut && cut.kind !== "fit") return cut;
        }
        return null;
    };

    Paginator.prototype.splitChild = function (el, B, C, boundary) {
        var top = this.top(el);
        if (top >= B - 0.5) return this.beforeCut(el, C, boundary);
        var tag = el.tagName;
        if (tag === "TABLE") return this.splitTable(el, B, C, boundary);
        if (tag === "IMG" || tag === "HR" || tag === "VIDEO" || tag === "IFRAME") {
            return this.beforeCut(el, C, boundary);
        }
        if (el.classList.contains("doc-pagebreak")) return null;
        if (el.classList.contains("doc-colsec")) return this.splitColumns(el, B, C, boundary);
        if (isList(el) || tag === "TBODY") {
            var inner = this.findCut(el, B, C, boundary);
            return this.hoist(inner, el, C, boundary);
        }
        if (hasBlockChild(el)) {
            if (el.getAttribute("data-keep-lines") === "1" && top > C + 1) return this.beforeCut(el, C, boundary);
            var sub = this.findCut(el, B, C, boundary);
            return this.hoist(sub, el, C, boundary);
        }
        return this.splitLines(el, B, C, boundary);
    };

    // a cut before the first child of a container is a cut before the
    // container (so keep-with-next and page-top checks see the real block)
    Paginator.prototype.hoist = function (cut, container, C, boundary) {
        if (!cut) return { kind: "fit" };
        if (cut.kind === "before" && container !== boundary) {
            var kids = blockKids(container);
            if (kids.length && kids[0] === cut.el && this.top(container) > C + 1) {
                return this.beforeCut(container, C, boundary);
            }
        }
        return cut;
    };

    Paginator.prototype.beforeCut = function (el, C, boundary) {
        var target = el;
        // keep-with-next: pull the blocks that must stay with el along
        for (var guard = 0; guard < 20; guard++) {
            var prev = target.previousElementSibling;
            while (prev && isSpacer(prev)) prev = prev.previousElementSibling;
            if (!prev || prev.classList.contains("doc-pagebreak")) break;
            if (!keepsWithNext(prev)) break;
            if (this.top(prev) <= C + 1) break;
            target = prev;
        }
        var y = this.top(target);
        if (y <= C + 1) {
            if (target !== el) {
                target = el;
                y = this.top(el);
            }
            if (y <= C + 1) return { kind: "overflow", y: y };
        }
        // a cut before the first row of a table is a cut before the table
        if (target.tagName === "TR") {
            var tbl = target.closest("table");
            var rows = rowsOf(tbl);
            if (rows[0] === target && tbl !== boundary) return this.beforeCut(tbl, C, boundary);
        }
        return { kind: "before", el: target, y: y, boundary: boundary };
    };

    function rowsOf(tbl) {
        var out = [];
        for (var i = 0; i < tbl.rows.length; i++) {
            if (!tbl.rows[i].classList.contains("doc-autobreak") &&
                tbl.rows[i].closest("table") === tbl) out.push(tbl.rows[i]);
        }
        return out;
    }

    Paginator.prototype.splitTable = function (tbl, B, C, boundary) {
        var rows = rowsOf(tbl);
        var idx = -1;
        for (var i = 0; i < rows.length; i++) {
            if (this.bottom(rows[i]) > B + 0.5) { idx = i; break; }
        }
        if (idx < 0) return { kind: "fit" };
        var row = rows[idx];
        var rowTop = this.top(row);
        if (rowTop >= B - 1) return this.beforeCut(idx === 0 ? tbl : row, C, boundary);
        // a row that cannot split, or one a merged cell reaches into from
        // above, moves whole - unless it already starts the page
        var spanned = rowspanCrosses(tbl, rows, idx);
        var cant = row.getAttribute("data-cant-split") === "1" || spanned || hasRowspan(row);
        if (cant && rowTop > C + 1) {
            var bc = this.beforeCut(idx === 0 ? tbl : row, C, boundary);
            if (bc.kind !== "overflow") return bc;
        }
        if (spanned || hasRowspan(row)) return { kind: "overflow", y: rowTop };
        var cells = [];
        var any = false, allNothing = true;
        for (var c = 0; c < row.cells.length; c++) {
            var td = row.cells[c];
            var cs = window.getComputedStyle(td);
            var padB = (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
            var cut = hasBlockChild(td) ? this.findCut(td, B - padB, C, td)
                : this.splitLines(td, B - padB, C, td);
            if (cut && cut.kind === "fit") cut = null;
            if (cut && (cut.kind === "overflow" || (cut.kind === "before" && cut.el === td))) {
                // this cell cannot give anything up (or all of it moves):
                // move the row if we can
                cut = { kind: "cellstart", td: td, y: rowTop };
            }
            if (cut) {
                any = true;
                if (cut.kind !== "cellstart" && !(cut.kind === "before" && cut.el === blockKids(td)[0])) {
                    allNothing = false;
                }
            } else {
                allNothing = false;
            }
            cells.push(cut);
        }
        if (!any) return { kind: "fit" };
        if (allNothing && rowTop > C + 1) return this.beforeCut(idx === 0 ? tbl : row, C, boundary);
        var y = Infinity;
        cells.forEach(function (ct) { if (ct && ct.y < y) y = ct.y; });
        return { kind: "row", tr: row, cells: cells, y: y, boundary: boundary };
    };

    function hasRowspan(row) {
        for (var i = 0; i < row.cells.length; i++) {
            if (row.cells[i].rowSpan > 1) return true;
        }
        return false;
    }
    function rowspanCrosses(tbl, rows, idx) {
        for (var r = 0; r < idx; r++) {
            for (var c = 0; c < rows[r].cells.length; c++) {
                if (r + rows[r].cells[c].rowSpan > idx) return true;
            }
        }
        return false;
    }

    /* the visual lines of a block that holds only inline content */
    Paginator.prototype.lines = function (block) {
        var frags = [];
        var self = this;
        var range = document.createRange();
        function visit(parent) {
            for (var n = parent.firstChild; n; n = n.nextSibling) {
                if (n.nodeType === 3) {
                    if (!n.nodeValue) continue;
                    range.selectNodeContents(n);
                    var rects = range.getClientRects();
                    for (var i = 0; i < rects.length; i++) {
                        if (rects[i].height <= 0) continue;
                        frags.push({ node: n, index: i, top: self.rectTop(rects[i]), bottom: self.rectBottom(rects[i]) });
                    }
                } else if (n.nodeType === 1) {
                    if (isSpacer(n)) continue;
                    var disp = n.tagName === "IMG" ? "inline" : window.getComputedStyle(n).display;
                    if (n.tagName === "IMG" || (disp === "inline-block" && !n.classList.contains("doc-tab"))) {
                        // a picture or an inline-block is one unbreakable box
                        var r = n.getBoundingClientRect();
                        if (r.height > 0) frags.push({ el: n, top: self.rectTop(r), bottom: self.rectBottom(r) });
                    } else if (disp !== "none") {
                        visit(n);
                    }
                }
            }
        }
        visit(block);
        var lines = [];
        frags.forEach(function (f) {
            var cur = lines[lines.length - 1];
            if (!cur || f.top >= cur.bottom - 1.5) {
                lines.push({ top: f.top, bottom: f.bottom, first: f, text: !f.el });
            } else {
                cur.top = Math.min(cur.top, f.top);
                cur.bottom = Math.max(cur.bottom, f.bottom);
                if (!f.el) cur.text = true;
            }
        });
        // a text rect is the glyphs, not the line: the line box reaches half
        // the leading further down, and that is what has to fit the page
        var lh = parseFloat(window.getComputedStyle(block).lineHeight) || 0;
        lines.forEach(function (ln) {
            var glyphs = ln.bottom - ln.top;
            ln.boxBottom = ln.bottom + (ln.text && lh > glyphs ? (lh - glyphs) / 2 : 0);
        });
        return lines;
    };

    Paginator.prototype.splitLines = function (block, B, C, boundary) {
        var lines = this.lines(block);
        if (!lines.length) {
            return this.bottom(block) > B + 0.5 && this.top(block) > C + 1 ?
                this.beforeCut(block, C, boundary) : { kind: "fit" };
        }
        var k = -1;
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].boxBottom > B + 0.5) { k = i; break; }
        }
        // only the spacing after the last line hangs over: that is allowed
        if (k < 0) return { kind: "fit" };
        var atTop = this.top(block) <= C + 1;
        if (block.getAttribute("data-keep-lines") === "1" && !atTop) k = 0;
        // widow/orphan control is on unless the paragraph turns it off
        if (block.getAttribute("data-widow") !== "0" && lines.length > 1) {
            // a widow (last line alone on the next page) pulls one more line
            // over; an orphan (first line alone on this page) moves the
            // whole paragraph
            if (k > 0 && lines.length - k === 1) k = k - 1;
            if (k === 1 && !atTop) k = 0;
        }
        if (k === 0) {
            if (!atTop) return this.beforeCut(block, C, boundary);
            if (lines.length === 1) return { kind: "overflow", y: lines[0].top };
            k = 1;
        }
        var f = lines[k].first;
        var cut = { kind: "line", el: block, y: lines[k].top, boundary: boundary };
        if (f.el) {
            cut.beforeEl = f.el;
        } else {
            cut.node = f.node;
            cut.offset = f.index === 0 ? 0 : this.lineStartOffset(f.node, lines[k].top);
        }
        return cut;
    };

    // first character of a text node that sits on the line starting at y
    Paginator.prototype.lineStartOffset = function (node, lineTop) {
        var len = node.nodeValue.length;
        var range = document.createRange();
        var self = this;
        function topAt(o) {
            for (var i = o; i < len; i++) {
                range.setStart(node, i);
                range.setEnd(node, i + 1);
                var rr = range.getClientRects();
                if (rr.length && rr[0].height > 0) return { top: self.rectTop(rr[rr.length - 1]), at: i };
            }
            return null;
        }
        var lo = 0, hi = len - 1, ans = len;
        while (lo <= hi) {
            var mid = (lo + hi) >> 1;
            var t = topAt(mid);
            if (!t) { hi = mid - 1; continue; }
            if (t.top >= lineTop - 1.5) { ans = Math.min(ans, t.at); hi = mid - 1; }
            else lo = t.at + 1;
        }
        return Math.min(ans, len);
    };

    /* ---- applying a cut ---- */

    function makeSpacer(kind, cols) {
        var el;
        if (kind === "row") {
            el = document.createElement("tr");
            var td = document.createElement("td");
            td.colSpan = Math.max(1, cols);
            td.className = "doc-autobreak-cell";
            el.appendChild(td);
        } else {
            el = document.createElement("div");
        }
        el.className = "doc-autobreak";
        el.setAttribute("contenteditable", "false");
        el.setAttribute("aria-hidden", "true");
        return el;
    }

    function marginTopOf(el) {
        return parseFloat(window.getComputedStyle(el).marginTop) || 0;
    }

    // stretch a spacer so that the content after it starts at targetY
    Paginator.prototype.land = function (spacer, targetY, probe) {
        var box = spacer.tagName === "TR" ? spacer.firstChild : spacer;
        box.style.height = "0px";
        for (var i = 0; i < 3; i++) {
            var at = probe ? probe() : this.bottom(spacer);
            var cur = parseFloat(box.style.height) || 0;
            var want = Math.max(0, cur + (targetY - at));
            if (Math.abs(want - cur) < 0.05) break;
            box.style.height = want + "px";
        }
    };

    Paginator.prototype.apply = function (cut, nextC) {
        var self = this;
        var boundary = cut.boundary || this.editor;
        var top, dv;
        switch (cut.kind) {
            case "explicit":
                cut.el.style.height = "0px";
                this.land(cut.el, nextC);
                return;
            case "before":
                var el = cut.el;
                if (el.tagName === "TR" && !cut.col) {
                    var cols = 0;
                    for (var c = 0; c < el.cells.length; c++) cols += el.cells[c].colSpan;
                    var sp = makeSpacer("row", cols);
                    el.parentNode.insertBefore(sp, el);
                    var bw = parseFloat(window.getComputedStyle(el.cells[0] || el).borderTopWidth) || 0;
                    this.land(sp, nextC + bw / 2, function () { return self.top(el); });
                    return;
                }
                // what holds el (a list, a quote) splits with it, so the
                // spacer sits between two whole boxes
                top = el.parentNode === boundary ? el : splitTree(el, boundary);
                dv = makeSpacer("block");
                if (top !== el && top.getAttribute("data-split-of")) dv.setAttribute("data-pair", top.getAttribute("data-split-of"));
                top.parentNode.insertBefore(dv, top);
                // spacing-before still applies at the top of a page
                this.land(dv, nextC + marginTopOf(el), function () { return self.top(el); });
                return;
            case "line":
                top = splitTree(lineStartNode(cut), boundary);
                if (!top) return;
                dv = makeSpacer("block");
                if (top.getAttribute && top.getAttribute("data-split-of")) dv.setAttribute("data-pair", top.getAttribute("data-split-of"));
                top.parentNode.insertBefore(dv, top);
                this.land(dv, nextC, function () { return self.top(top); });
                return;
            case "row":
                this.splitRow(cut, nextC, true);
                return;
        }
    };

    /* A row that breaks across the page becomes two rows: the head keeps
       what fits in every cell, a copy of the row takes the rest of each
       cell, and a spacer row between them carries the copy to the next
       sheet. Each half has its own cell borders and shading. */
    Paginator.prototype.splitRow = function (cut, nextC, withSpacer) {
        var self = this;
        var tr = cut.tr;
        var tailTr = cloneShell(tr);
        var k = pairUp(tr, tailTr);
        tr.parentNode.insertBefore(tailTr, tr.nextSibling);
        noteMoved();
        var cells = Array.prototype.slice.call(tr.cells);
        cells.forEach(function (td, i) {
            var tailTd = cloneShell(td);
            pairUp(td, tailTd);
            tailTr.appendChild(tailTd);
            var ct = cut.cells[i];
            if (!ct) return;
            var start = null;
            if (ct.kind === "cellstart") {
                start = td.firstChild;
            } else if (ct.kind === "line") {
                start = lineStartNode(ct);
            } else if (ct.kind === "before" || ct.kind === "explicit") {
                start = ct.el;
            } else if (ct.kind === "row") {
                // a nested table splits in the same place; its tail rows go
                // with the rest of this cell
                start = self.splitRow(ct, nextC, false);
            }
            if (!start) return;
            var from = start.parentNode === td ? start : splitTree(start, td);
            while (from) {
                var nx = from.nextSibling;
                tailTd.appendChild(from);
                from = nx;
            }
        });
        if (withSpacer) {
            var cols = 0;
            for (var c = 0; c < cells.length; c++) cols += cells[c].colSpan;
            var sp = makeSpacer("row", cols);
            sp.setAttribute("data-pair", k);
            tr.parentNode.insertBefore(sp, tailTr);
            var bw = parseFloat(window.getComputedStyle(tailTr.cells[0] || tailTr).borderTopWidth) || 0;
            this.land(sp, nextC + bw / 2, function () { return self.top(tailTr); });
        }
        return tailTr;
    };

    /* ---- footnotes ---- */

    Paginator.prototype.refsBetween = function (y0, y1) {
        var out = [];
        var refs = this.o.fnRefs || [];
        for (var i = 0; i < refs.length; i++) {
            var r = refs[i];
            var rect = r.getBoundingClientRect();
            if (!rect.height) continue;
            // a reference in a column past the page's last one is not here
            if (this.o.columns > 1 && rect.left > this.editor.getBoundingClientRect().right + 1) continue;
            var y = this.rectTop(rect);
            if (y >= y0 - 1 && y < y1) {
                var id = r.getAttribute("data-fn");
                if (out.indexOf(id) < 0) out.push(id);
            }
        }
        return out;
    };

    /* ---- the page loop ---- */

    /* Where to start. An edit cannot move a page break that comes before
       it, so when the caller says where the change is (fromY) and hands in
       the previous page records, the pages up to the one before the change
       are kept as they are - with their spacers and splits - and only the
       rest is laid out again. Starting one page early leaves room for a
       widow or a keep-with-next that pulls a line back across the page
       above. */
    Paginator.prototype.resume = function () {
        var o = this.o;
        var prev = o.prevPages;
        if (!(o.fromY >= 0) || !prev || prev.length < 3) return 0;
        var p = 0;
        for (var k = 0; k < prev.length; k++) {
            if (prev[k].sheetTop <= o.fromY) p = k;
        }
        var start = p - 1;
        if (start < 1) return 0;
        var threshold = this.contentTop(start);
        var self = this;
        var stale = [];
        var spacers = this.editor.querySelectorAll(".doc-autobreak");
        for (var i = 0; i < spacers.length; i++) {
            if (self.top(spacers[i]) >= threshold - 0.5) stale.push(spacers[i]);
        }
        var breaks = this.editor.querySelectorAll(".doc-pagebreak");
        var staleBreaks = [];
        for (i = 0; i < breaks.length; i++) {
            if (self.top(breaks[i]) >= threshold - 0.5) staleBreaks.push(breaks[i]);
        }
        removeSpacerList(stale, this.editor);
        repairSplits(this.editor, false);
        staleBreaks.forEach(function (b) { b.style.height = "0px"; });
        return start;
    };

    Paginator.prototype.run = function () {
        var o = this.o;
        this._scale = this.scale();
        var i = this.resume();
        var pages;
        if (i > 0) {
            pages = o.prevPages.slice(0, i).map(function (pg) {
                var copy = {};
                for (var k in pg) copy[k] = pg[k];
                return copy;
            });
        } else {
            removeSpacers(this.editor);
            if (o.columns > 1) wrapColumns(this.editor);
            pages = [];
        }
        var contentEnd = function (self) { return self.bottom(self.editor); };
        for (var guard = 0; guard < 3000; guard++) {
            this._scale = this.scale();
            var C = this.contentTop(i);
            var Bfull = this.contentBottom(i);
            var B = Bfull;
            var ids = [];
            var fnH = 0;
            var cut = null;
            for (var iter = 0; iter < 4; iter++) {
                cut = this.findCut(this.editor, B, C, this.editor);
                if (cut && cut.kind === "fit") cut = null;
                var endY = cut ? cut.y : contentEnd(this);
                var got = o.measureFootnotes ? this.refsBetween(C, Math.min(endY, B + 0.5)) : [];
                var h = got.length ? o.measureFootnotes(got) : 0;
                if (got.join(",") === ids.join(",") && Math.abs(h - fnH) < 0.5) break;
                ids = got;
                fnH = h;
                B = Bfull - fnH;
            }
            var page = {
                index: i, sheetTop: this.sheetTop(i), contentTop: C, contentBottom: B,
                footnotes: ids, footnoteTop: Bfull - fnH
            };
            pages.push(page);
            if (!cut) break;
            var nextC = this.contentTop(i + 1);
            if (cut.kind !== "overflow") this.apply(cut, nextC);
            i++;
        }
        return pages;
    };

    function paginate(opts) {
        var t = beginTrack(opts.editor);
        try {
            return new Paginator(opts).run();
        } finally {
            endTrack(t);
        }
    }

    return {
        PT: PT,
        MM: MM,
        fontRatios: fontRatios,
        lineHeightPx: lineHeightPx,
        applyLineHeights: applyLineHeights,
        applyTableBorders: applyTableBorders,
        restoreTablePadding: restoreTablePadding,
        restorePictureLines: restorePictureLines,
        applyNumbering: applyNumbering,
        applyTabs: applyTabs,
        numberFootnotes: numberFootnotes,
        removeSpacers: removeSpacers,
        unsplitWithin: unsplitWithin,
        unsplitAtCaret: unsplitAtCaret,
        paginate: paginate,
        formatNumber: formatNumber
    };
})();
