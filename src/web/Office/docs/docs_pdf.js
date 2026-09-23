/*
    ArozOS Office - Docs PDF export
    ===============================
    The PDF is drawn from the editor's own pages. docs_layout.js has already
    decided where every line, row and page break goes, and the sheet the
    editor shows is the sheet that gets written: each element in the page
    becomes the PDF object it is, at the position the browser gave it.

      text        real PDF text, one show-text per line fragment at the
                  browser's baseline (OfficePdfCore.drawRuns - the font rules
                  are the ones Slides uses: standard PDF fonts for families
                  metric-identical to them, the shipped Noto faces embedded
                  and subset for everything else, a picture of the run only
                  when nothing can show a character)
      background  a filled rectangle - per line fragment for highlighted text
      borders     filled strips; a collapsed table rule is centred on the
                  cell edge the way the browser draws it, at the width the
                  document states rather than the pixel it was rounded to
      pictures    the original bytes embedded once, cropped with a clip path
      markers     list numbers and bullets (li[data-marker]), tab leaders and
                  the footnote rule, which the editor draws with CSS
                  generated content and therefore have no text node

    Nothing is re-laid out, so the export cannot paginate differently from
    the editor. The page is only held while it is measured: what to draw is
    written down as a display list, and common/pdfworker.js (pdfdraw.js)
    assembles the file in a Web Worker while the document stays editable.

    Usage:
        DocsPdf.build({ pageEl, pages, sheetW, sheetH, title,
                        enter, leave, onProgress }) -> Promise<Uint8Array>
*/

var DocsPdf = (function () {
    "use strict";

    var C = OfficePdfCore;
    var parseFill = C.parseFill, parseColor = C.parseColor;
    var PT = 96 / 72;

    // subtrees that are editor chrome, not page content
    var SKIP_SELECTOR = "#pageSheets, .doc-fn-measure, .of-img-handle, .doc-autobreak";

    function skipped(el) {
        return !!(el && el.closest && el.closest(SKIP_SELECTOR));
    }

    /* ---------------- geometry ---------------- */

    function Frame(pageEl) {
        this.pageEl = pageEl;
        var r = pageEl.getBoundingClientRect();
        this.left = r.left + pageEl.clientLeft;
        this.top = r.top + pageEl.clientTop;
    }
    // a client rect in #page layout coordinates (px)
    Frame.prototype.box = function (rect) {
        return {
            x: rect.left - this.left, y: rect.top - this.top,
            w: rect.right - rect.left, h: rect.bottom - rect.top
        };
    };

    function pageIndexOf(pages, sheetH, y) {
        // pages are in order; the last sheet whose top is at or above y
        var lo = 0, hi = pages.length - 1, ans = 0;
        while (lo <= hi) {
            var mid = (lo + hi) >> 1;
            if (pages[mid].sheetTop <= y + 0.5) { ans = mid; lo = mid + 1; }
            else hi = mid - 1;
        }
        return ans;
    }
    // every page a vertical band [y, y+h] touches
    function pagesTouched(pages, sheetH, y, h) {
        var out = [];
        var i = pageIndexOf(pages, sheetH, y);
        for (; i < pages.length; i++) {
            var top = pages[i].sheetTop;
            if (top > y + h) break;
            if (top + sheetH > y) out.push(i);
        }
        return out;
    }

    /* ---------------- collecting what is on the pages ---------------- */

    function collect(o, frame) {
        var pages = o.pages, sheetH = o.sheetH;
        var perPage = pages.map(function () {
            return { fills: [], images: [], borders: [], texts: [], extras: [] };
        });
        var add = function (kind, y, h, item) {
            pagesTouched(pages, sheetH, y, h).forEach(function (i) { perPage[i][kind].push(item); });
        };

        var all = o.pageEl.getElementsByTagName("*");
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (skipped(el)) continue;
            var cs = window.getComputedStyle(el);
            if (cs.display === "none" || cs.visibility === "hidden") continue;
            if (el.closest("[hidden]")) continue;
            var rects;

            // backgrounds
            var bg = parseFill(cs.backgroundColor);
            if (bg && el !== o.pageEl) {
                rects = cs.display === "inline" ? el.getClientRects() : [el.getBoundingClientRect()];
                for (var r = 0; r < rects.length; r++) {
                    var b = frame.box(rects[r]);
                    if (b.w <= 0 || b.h <= 0) continue;
                    add("fills", b.y, b.h, { box: b, fill: bg });
                }
            }

            // borders
            if (cs.display !== "inline") {
                var bb = frame.box(el.getBoundingClientRect());
                var cell = (el.tagName === "TD" || el.tagName === "TH") && cs.borderCollapse === "collapse";
                ["Top", "Right", "Bottom", "Left"].forEach(function (side) {
                    var st = cs["border" + side + "Style"];
                    var w = parseFloat(cs["border" + side + "Width"]) || 0;
                    if (!w || st === "none" || st === "hidden") return;
                    var col = parseFill(cs["border" + side + "Color"]);
                    if (!col) return;
                    // the width the document states, before pixel rounding
                    var declared = el.style["border" + side + "Width"];
                    if (declared && /pt$/.test(declared)) w = parseFloat(declared) * PT;
                    add("borders", bb.y - w, bb.h + 2 * w, { box: bb, side: side, w: w, fill: col, centred: cell, dash: st });
                });
            }

            // pictures
            if (el.tagName === "IMG") {
                var ib = frame.box(el.getBoundingClientRect());
                var bl = parseFloat(cs.borderLeftWidth) || 0, bt = parseFloat(cs.borderTopWidth) || 0;
                var pl = parseFloat(cs.paddingLeft) || 0, ptp = parseFloat(cs.paddingTop) || 0;
                var content = {
                    x: ib.x + bl + pl, y: ib.y + bt + ptp,
                    w: el.clientWidth - pl - (parseFloat(cs.paddingRight) || 0),
                    h: el.clientHeight - ptp - (parseFloat(cs.paddingBottom) || 0)
                };
                if (content.w > 0 && content.h > 0) {
                    add("images", content.y, content.h, { box: content, img: el, viewBox: cs.objectViewBox || el.style.objectViewBox || "" });
                }
            }

            // list markers
            if (el.tagName === "LI" && el.hasAttribute("data-marker")) {
                var marker = el.getAttribute("data-marker");
                if (marker) {
                    var m = markerItem(el, marker, frame);
                    if (m) add("extras", m.baseline - m.size, m.size * 1.4, m);
                }
            }

            // tab leaders
            if (el.classList.contains("doc-tab") && el.getAttribute("data-leader")) {
                var lb = frame.box(el.getBoundingClientRect());
                var leader = el.getAttribute("data-leader");
                var met = C.fontMetricsOf(cs);
                // the tab's own line: its baseline is its box's, set by the text
                add("extras", lb.y, lb.h, {
                    kind: "leader", box: lb,
                    ch: leader === "hyphen" ? "-" : (leader === "underscore" ? "_" : "."),
                    names: C.familyList(cs.fontFamily),
                    size: parseFloat(cs.fontSize) || 14.67,
                    bold: (parseInt(cs.fontWeight, 10) || 400) >= 600,
                    color: parseColor(cs.color) || PDFLib.rgb(0, 0, 0),
                    baseline: lb.y + (lb.h - (met.ascent + met.descent)) / 2 + met.ascent
                });
            }

            // the footnote separator rule
            if (el.classList.contains("doc-fn-sep")) {
                var after = window.getComputedStyle(el, "::after");
                var sb = frame.box(el.getBoundingClientRect());
                var lw = parseFloat(after.borderTopWidth) || 1;
                add("extras", sb.y, sb.h, {
                    kind: "rule",
                    box: { x: sb.x, y: sb.y + (parseFloat(after.top) || 0), w: parseFloat(after.width) || 192, h: lw },
                    fill: parseFill(after.borderTopColor) || { c: PDFLib.rgb(0, 0, 0), a: 1 }
                });
            }
        }

        // text, as line fragments at their baselines
        var origin = { left: frame.left, top: frame.top, x: 0, y: 0 };
        var runs = C.collectRuns(o.pageEl, origin).filter(function (run) {
            return run.text.trim() !== "";
        });
        runs.forEach(function (run) {
            var top = run.rect.top - frame.top;
            var h = run.rect.bottom - run.rect.top;
            var idx = pageIndexOf(pages, sheetH, top + h / 2);
            perPage[idx].texts.push(run);
        });
        return { perPage: perPage, runs: runs };
    }

    /* A marker is the li's ::before: drawn in its font, hanging to the left
       of the item's text and sitting on the item's first baseline. */
    function markerItem(li, text, frame) {
        var before = window.getComputedStyle(li, "::before");
        var size = parseFloat(before.fontSize) || parseFloat(window.getComputedStyle(li).fontSize) || 14.67;
        var lr = li.getBoundingClientRect();
        var lcs = window.getComputedStyle(li);
        var left = lr.left - frame.left + (parseFloat(before.left) || 0);
        // the first line's baseline: from the first text in the item, else
        // from the item's own line box
        var baseline = null;
        var walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT, null);
        var n;
        while ((n = walker.nextNode())) {
            if (!n.nodeValue.trim()) continue;
            if (n.parentElement.closest("ol,ul") !== li.parentElement && n.parentElement.closest("li") !== li) continue;
            var range = document.createRange();
            range.selectNodeContents(n);
            var rects = range.getClientRects();
            if (!rects.length) continue;
            var pcs = window.getComputedStyle(n.parentElement);
            var met = C.fontMetricsOf(pcs);
            var rh = rects[0].bottom - rects[0].top;
            baseline = rects[0].top - frame.top + (rh - (met.ascent + met.descent)) / 2 + met.ascent;
            break;
        }
        if (baseline === null) {
            var lm = C.fontMetricsOf(lcs);
            var lh = parseFloat(lcs.lineHeight) || size * 1.2;
            baseline = lr.top - frame.top + (parseFloat(lcs.paddingTop) || 0) + (lh - (lm.ascent + lm.descent)) / 2 + lm.ascent;
        }
        return {
            kind: "marker", text: text, x: left, baseline: baseline, size: size,
            shape: bulletShape(text, before, size, left, baseline),
            names: C.familyList(before.fontFamily),
            bold: (parseInt(before.fontWeight, 10) || 400) >= 600,
            italic: before.fontStyle === "italic",
            color: parseColor(before.color) || PDFLib.rgb(0, 0, 0)
        };
    }

    /* A geometric bullet (a disc, a ring, a square) is drawn as the shape
       it is, at the ink box the browser gives the glyph. Written as text it
       would land in whichever shipped face has the character - for a disc
       that is a CJK face, whose full-width disc is twice the size of the
       one Arial draws on screen. */
    var SHAPES = {
        0x25CF: "disc", 0x2022: "disc", 0x25CB: "ring", 0x25E6: "ring",
        0x25A0: "square", 0x25AA: "square", 0x25A1: "box", 0x25AB: "box",
        0x25C6: "diamond", 0x25C7: "hollowDiamond"
    };
    var MEASURE_PX = 200;
    var shapeCtx = null;
    function bulletShape(text, cs, size, left, baseline) {
        var t = String(text || "");
        if (t.length !== 1 || !SHAPES[t.charCodeAt(0)]) return null;
        try {
            if (!shapeCtx) shapeCtx = document.createElement("canvas").getContext("2d");
            shapeCtx.font = (cs.fontStyle || "normal") + " " + (cs.fontWeight || "400") + " " +
                MEASURE_PX + "px " + cs.fontFamily;
            var m = shapeCtx.measureText(t);
            var k = size / MEASURE_PX;
            var l = left - m.actualBoundingBoxLeft * k;
            var r = left + m.actualBoundingBoxRight * k;
            var top = baseline - m.actualBoundingBoxAscent * k;
            var bottom = baseline + m.actualBoundingBoxDescent * k;
            if (!(r > l) || !(bottom > top)) return null;
            return { kind: SHAPES[t.charCodeAt(0)], x: l, y: top, w: r - l, h: bottom - top };
        } catch (e) {
            return null;
        }
    }

    /* ---------------- fonts ---------------- */

    /* Which shipped faces the characters need is found out here, in the
       page, before the display list is written: the list names the font of
       every piece of text, and a character no face can show is sent as a
       picture instead. Fetching and parsing a face is what answers "does it
       have this glyph" (a pass per round of discoveries, as Slides does);
       embedding it is left to the worker. */
    function loadCoverage(runs, markers, leaders, fonts) {
        var MAX_PASSES = OfficeFonts.FALLBACK.length + 2;
        function each(text, names, bold, italic, fn) {
            for (var i = 0; i < text.length; i++) {
                var cp = text.codePointAt(i);
                if (cp > 0xFFFF) i++;
                fn(C.resolveChar(cp, names, fonts, bold, italic), bold, italic);
            }
        }
        function eachChar(fn) {
            runs.forEach(function (r) { each(r.text, r.names, r.weight >= 600, r.italic, fn); });
            markers.forEach(function (m) { if (!m.shape) each(m.text, m.names, m.bold, m.italic, fn); });
            leaders.forEach(function (l) { each(l.ch, l.names, l.bold, false, fn); });
        }
        function pass(n) {
            var asked = false;
            eachChar(function (res, bold, italic) {
                if (res && res.need) { fonts.want(res.need, bold, italic); asked = true; }
            });
            if (!asked || n >= MAX_PASSES) return fonts.ready();
            return fonts.ready().then(function () { return pass(n + 1); });
        }
        return pass(0);
    }

    function absUrl(u) {
        try { return new URL(u, document.baseURI).href; } catch (e) { return u; }
    }

    // the pieces a line fragment is spelled in, as display-list fonts
    function segsFor(text, names, fonts, bold, italic) {
        var segs = C.segmentText(text, names, fonts, bold, italic);
        if (!segs || !segs.length) return null;
        var out = [];
        for (var i = 0; i < segs.length; i++) {
            var res = segs[i].res;
            if (res.std) {
                out.push([segs[i].text, "s:" + res.std + ":" + (bold ? 1 : 0) + ":" + (italic ? 1 : 0), false]);
            } else {
                var face = OfficeFonts.faceFor(res.shipped, bold, italic);
                if (!face) return null;
                out.push([segs[i].text, "f:" + absUrl(face.url), !!face.synthBold]);
            }
        }
        return out;
    }

    /* ---------------- the display list ---------------- */

    function rgbOf(c) {
        return c ? [c.red, c.green, c.blue] : [0, 0, 0];
    }

    // object-view-box: inset(t% r% b% l%) -> the kept fraction of the source
    function parseInset(v) {
        var m = /inset\(\s*([-\d.]+)%?\s*([-\d.]+)?%?\s*([-\d.]+)?%?\s*([-\d.]+)?%?\s*\)/.exec(v || "");
        if (!m) return null;
        var t = parseFloat(m[1]) || 0;
        var rr = m[2] !== undefined ? parseFloat(m[2]) : t;
        var bo = m[3] !== undefined ? parseFloat(m[3]) : t;
        var l = m[4] !== undefined ? parseFloat(m[4]) : rr;
        if (!(t || rr || bo || l)) return null;
        return { t: t / 100, r: rr / 100, b: bo / 100, l: l / 100 };
    }

    function borderRect(b) {
        var x = b.box.x, y = b.box.y, w = b.box.w, h = b.box.h, t = b.w;
        if (b.centred) {
            switch (b.side) {
                case "Top": return [x - t / 2, y - t / 2, w + t, t];
                case "Bottom": return [x - t / 2, y + h - t / 2, w + t, t];
                case "Left": return [x - t / 2, y - t / 2, t, h + t];
                default: return [x + w - t / 2, y - t / 2, t, h + t];
            }
        }
        switch (b.side) {
            case "Top": return [x, y, w, t];
            case "Bottom": return [x, y + h - t, w, t];
            case "Left": return [x, y, t, h];
            default: return [x + w - t, y, t, h];
        }
    }

    function shapeOps(s, color, dy) {
        var col = rgbOf(color);
        var cx = s.x + s.w / 2, cy = s.y - dy + s.h / 2, top = s.y - dy;
        // the stroke of a hollow glyph, about what Arial's ring has
        var stroke = Math.max(0.5, Math.min(s.w, s.h) * 0.1);
        switch (s.kind) {
            case "disc": return ["ellipse", cx, cy, s.w / 2, s.h / 2, col, 0];
            case "ring": return ["ellipse", cx, cy, (s.w - stroke) / 2, (s.h - stroke) / 2, col, stroke];
            case "square": return ["rect", s.x, top, s.w, s.h, col, 1];
            case "box": return ["frame", s.x + stroke / 2, top + stroke / 2, s.w - stroke, s.h - stroke, col, stroke];
            default:
                return ["poly", [cx, top, s.x + s.w, cy, cx, top + s.h, s.x, cy], col, s.kind === "diamond" ? 0 : stroke];
        }
    }

    function canvasBytes(canvas) {
        return new Promise(function (resolve) {
            try {
                canvas.toBlob(function (blob) {
                    if (!blob) { resolve(null); return; }
                    blob.arrayBuffer().then(function (b) { resolve(new Uint8Array(b)); }, function () { resolve(null); });
                }, "image/png");
            } catch (e) { resolve(null); }
        });
    }
    function sniff(bytes) {
        if (bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8) return "jpg";
        if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "png";
        return null;
    }
    // a picture pdf-lib cannot embed as it is (GIF, WebP, SVG, BMP) goes in
    // as a PNG of itself at its natural size
    function rasterPicture(img) {
        try {
            var c = document.createElement("canvas");
            c.width = Math.max(1, img.naturalWidth || img.width);
            c.height = Math.max(1, img.naturalHeight || img.height);
            c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
            return canvasBytes(c);
        } catch (e) {
            return Promise.resolve(null);
        }
    }
    function pictureSpec(img) {
        var src = img.currentSrc || img.src || "";
        var m = /^data:([^;,]+)/.exec(src);
        if (m) {
            if (/^image\/(jpe?g|png)$/i.test(m[1])) return Promise.resolve({ src: src });
            return rasterPicture(img).then(function (b) { return b ? { bytes: b } : null; });
        }
        return fetch(src).then(function (r) {
            if (!r.ok) throw new Error("cannot read " + src);
            return r.arrayBuffer();
        }).then(function (buf) {
            var bytes = new Uint8Array(buf);
            if (sniff(bytes)) return { bytes: bytes };
            return rasterPicture(img).then(function (b) { return b ? { bytes: b } : null; });
        }).catch(function () {
            return rasterPicture(img).then(function (b) { return b ? { bytes: b } : null; });
        });
    }

    /* a run no font here can show (emoji, a script not shipped) is drawn
       as a picture of its own text, by the browser's own text renderer */
    function rasterRun(run) {
        var w = run.rect.right - run.rect.left, h = run.rect.bottom - run.rect.top;
        if (w <= 0 || h <= 0) return Promise.resolve(null);
        var k = C.RASTER_SCALE;
        var c = document.createElement("canvas");
        c.width = Math.ceil(w * k);
        c.height = Math.ceil(h * k);
        var g = c.getContext("2d");
        g.scale(k, k);
        g.font = (run.italic ? "italic " : "") + run.weight + " " + run.size + "px " + run.names.map(function (n) {
            return /[\s"']/.test(n) ? '"' + n.replace(/"/g, "") + '"' : n;
        }).join(",");
        g.fillStyle = run.color;
        g.textBaseline = "alphabetic";
        var glyphH = run.metrics.ascent + run.metrics.descent;
        g.fillText(run.text, 0, (h - glyphH) / 2 + run.metrics.ascent);
        return canvasBytes(c);
    }

    function breathe() {
        return new Promise(function (res) { setTimeout(res, 0); });
    }

    /* displayList turns what collect() measured into the job pdfdraw.js
       draws: every coordinate relative to its own sheet, every colour a
       triple, every font a reference, every picture an entry of its own. */
    function displayList(o, data, fonts, frame) {
        var job = { title: o.title || "", sheetW: o.sheetW, sheetH: o.sheetH, images: {}, pages: [] };
        var imageIds = new Map();
        var pending = [];
        var nextId = 0;
        function pictureId(img) {
            var key = img.currentSrc || img.src || img;
            if (imageIds.has(key)) return imageIds.get(key);
            var id = "i" + (nextId++);
            imageIds.set(key, id);
            pending.push(pictureSpec(img).then(function (spec) { if (spec) job.images[id] = spec; }));
            return id;
        }
        var chain = Promise.resolve();
        o.pages.forEach(function (page, i) {
            chain = chain.then(function () {
                var items = data.perPage[i];
                var dy = page.sheetTop;
                var ops = [];
                job.pages.push(ops);
                items.fills.forEach(function (f) {
                    ops.push(["rect", f.box.x, f.box.y - dy, f.box.w, f.box.h, rgbOf(f.fill.c), f.fill.a]);
                });
                items.images.forEach(function (im) {
                    ops.push(["image", pictureId(im.img), im.box.x, im.box.y - dy, im.box.w, im.box.h, parseInset(im.viewBox)]);
                });
                items.borders.forEach(function (b) {
                    var r = borderRect(b);
                    ops.push(["rect", r[0], r[1] - dy, r[2], r[3], rgbOf(b.fill.c), b.fill.a]);
                });
                var rasters = [];
                items.texts.forEach(function (r) {
                    var x = r.origin.x + (r.rect.left - r.origin.left);
                    var top = r.origin.y + (r.rect.top - r.origin.top) - dy;
                    var lineH = r.rect.bottom - r.rect.top;
                    var domW = r.rect.right - r.rect.left;
                    var bg = C.parseFill(r.background);
                    if (bg) ops.push(["rect", x, top, domW, lineH, rgbOf(bg.c), bg.a]);
                    var segs = segsFor(r.text, r.names, fonts, r.weight >= 600, r.italic);
                    if (!segs) {
                        rasters.push({ run: r, at: ops.length, x: x, top: top, w: domW, h: lineH });
                        ops.push(null);
                        return;
                    }
                    var glyphH = r.metrics.ascent + r.metrics.descent;
                    var baseline = (lineH - glyphH) / 2 + r.metrics.ascent;
                    var deco = null;
                    if (r.underline || r.strike) {
                        var yOff = r.underline ? baseline + r.size * 0.11 : baseline - r.size * 0.28;
                        deco = [top + yOff, Math.max(0.7, r.size * 0.06), domW];
                    }
                    // a fragment that starts or ends on a space cannot be fitted
                    // to its rect: the browser collapses those, the measure does not
                    ops.push(["text", x, top + baseline, r.size, rgbOf(C.parseColor(r.color)),
                        /^\s|\s$/.test(r.text) ? 0 : domW, segs, deco]);
                });
                items.extras.forEach(function (x) {
                    if (x.kind === "marker") {
                        if (x.shape) {
                            ops.push(shapeOps(x.shape, x.color, dy));
                        } else {
                            var ms = segsFor(x.text, x.names, fonts, x.bold, x.italic);
                            if (ms) ops.push(["text", x.x, x.baseline - dy, x.size, rgbOf(x.color), 0, ms, null]);
                        }
                    } else if (x.kind === "leader") {
                        var ls = segsFor(x.ch, x.names, fonts, x.bold, false);
                        if (ls) ops.push(["leader", x.box.x, x.box.w, x.baseline - dy, x.size, rgbOf(x.color), x.ch, ls[0][1]]);
                    } else if (x.kind === "rule") {
                        ops.push(["rect", x.box.x, x.box.y - dy, x.box.w, x.box.h, rgbOf(x.fill.c), x.fill.a]);
                    }
                });
                // text no font can show becomes a picture of itself, in place
                var rs = rasters.map(function (it) {
                    return rasterRun(it.run).then(function (bytes) {
                        if (!bytes) return;
                        var id = "r" + (nextId++);
                        job.images[id] = { bytes: bytes };
                        ops[it.at] = ["image", id, it.x, it.top, it.w, it.h, null];
                    });
                });
                return Promise.all(rs).then(function () {
                    for (var k = ops.length - 1; k >= 0; k--) if (!ops[k]) ops.splice(k, 1);
                    return breathe();
                });
            });
        });
        return chain.then(function () {
            return Promise.all(pending);
        }).then(function () {
            return job;
        });
    }

    function waitForImages(root) {
        var imgs = Array.prototype.slice.call(root.querySelectorAll("img"));
        var pending = imgs.filter(function (im) { return !im.complete; });
        var fontsP = OfficeFonts.preload().then(function () {
            return document.fonts && document.fonts.ready ? document.fonts.ready : null;
        });
        return Promise.all([fontsP].concat(pending.map(function (im) {
            return new Promise(function (res) {
                im.addEventListener("load", function () { res(); });
                im.addEventListener("error", function () { res(); });
                setTimeout(res, 8000);
            });
        })));
    }

    /* build runs an export in three steps, and only the first holds the
       page, for as long as it takes to read the layout:

         1. snapshot  o.enter() puts the page in its export state, and what
                      is on each sheet is measured - boxes, text runs,
                      markers - then o.leave() gives the page back. From
                      here on the document may be edited: nothing below
                      looks at it again.
         2. prepare   fonts are checked for every character and the display
                      list is written (in steps, between which the page runs)
         3. render    a worker turns the list into the file

       o: { pageEl, pages() | pages, sheetW, sheetH, title,
            enter(), leave(), onProgress(done, total, stage) }
       stage is "measure", "prepare", "page" or "save". */
    function build(o) {
        if (typeof PDFLib === "undefined") return Promise.reject(new Error("the PDF library failed to load"));
        if (!o || !o.pageEl) return Promise.reject(new Error("nothing to export"));
        var progress = o.onProgress || function () { };
        var data, snap, fonts;
        progress(0, 1, "measure");
        return waitForImages(o.pageEl).then(function () {
            return C.loadFontkit();
        }).then(function (fontkit) {
            try {
                if (o.enter) o.enter();
                snap = {
                    pageEl: o.pageEl,
                    pages: (typeof o.pages === "function" ? o.pages() : o.pages).slice(),
                    sheetW: o.sheetW, sheetH: o.sheetH, title: o.title
                };
                if (!snap.pages.length) throw new Error("nothing to export");
                data = collect(snap, new Frame(o.pageEl));
            } finally {
                if (o.leave) o.leave();
            }
            fonts = C.makeFonts(null, fontkit);
            var markers = [], leaders = [];
            data.perPage.forEach(function (p) {
                p.extras.forEach(function (x) {
                    if (x.kind === "marker") markers.push(x);
                    else if (x.kind === "leader") leaders.push(x);
                });
            });
            progress(0, 1, "prepare");
            return loadCoverage(data.runs, markers, leaders, fonts);
        }).then(function () {
            return displayList(snap, data, fonts);
        }).then(function (job) {
            data = null;
            return OfficePdfDraw.run(job, { onProgress: progress, loadFontkit: C.loadFontkit });
        });
    }

    return { build: build };
})();
