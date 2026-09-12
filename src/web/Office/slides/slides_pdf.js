/*
    ArozOS Office - Slides PDF export
    =================================
    Builds the PDF in the browser, out of real PDF objects, from the very
    DOM the editor is showing. That is the only place the truth lives: how
    a line of text wrapped, where each line landed, which font the browser
    actually resolved. A server-side renderer has to guess all of it, and
    the guesses drift.

    What each element becomes:

      text      real PDF text (Tj), one show-text per line fragment, placed
                at the baseline the browser laid it out on - when the glyphs
                and the font allow it (see canDrawAsText). Otherwise that
                one text box is rasterized, nothing else.
      image     the original JPEG/PNG bytes, embedded once and re-used;
                crops, shaped crops and rounded corners are real PDF clip
                paths, flips are a negative scale in the matrix, and
                transparency is an ExtGState. A re-coloured picture is
                re-encoded through a canvas first, which is a pixel
                operation either way.
      shape     a real vector path, filled and stroked
      line      a real vector polyline, with arrow heads as filled triangles
      table     real vector cell fills and rules, text through the rules above
      chart     the chart's own SVG, translated element by element into PDF
                vectors - not a picture of it
      video     the captured poster frame, as an image
      /audio

    Rasterizing is the documented last resort, never the first move, and it
    is always scoped to the one element that needs it.

    The font rule. A PDF can only show text in a font it embeds, and the
    browser will not hand over the bytes of a system font. So real text is
    possible exactly when the resolved family is metric-compatible with one
    of the 14 standard PDF fonts (Helvetica / Times / Courier and their
    aliases) and every character is WinAnsi-encodable. A deck set in Open
    Sans or in Chinese falls back to a per-object raster, which is at least
    pixel-exact. Embedding arbitrary fonts would need fontkit and the font
    files themselves; see the README's known gaps.

    Usage:
        SlidesPdf.build(body, { onProgress: fn(done, total) })
            -> Promise<Uint8Array>
*/

var SlidesPdf = (function () {
    "use strict";

    // the slide is 960x540 css px; a PDF point is 1/72", a css px 1/96",
    // so the page is 720x405 pt - the 10" x 5.625" of the pptx slide size
    var PX_TO_PT = 0.75;
    var SLIDE_W = 960, SLIDE_H = 540;
    var RASTER_SCALE = 3;      // device pixels per css px for a fallback raster

    /* ---------------- fonts ---------------- */

    /* Families that are metric-compatible with a standard PDF font, so
       text set in them lands in exactly the same place as on screen. */
    var STD_FAMILIES = {
        "helvetica": "Helvetica", "arial": "Helvetica", "liberation sans": "Helvetica",
        "arimo": "Helvetica", "sans-serif": "Helvetica", "nimbus sans": "Helvetica",
        "times": "TimesRoman", "times new roman": "TimesRoman", "serif": "TimesRoman",
        "liberation serif": "TimesRoman", "tinos": "TimesRoman", "nimbus roman": "TimesRoman",
        "courier": "Courier", "courier new": "Courier", "monospace": "Courier",
        "liberation mono": "Courier", "cousine": "Courier", "nimbus mono": "Courier"
    };
    var STD_VARIANTS = {
        Helvetica: ["Helvetica", "HelveticaBold", "HelveticaOblique", "HelveticaBoldOblique"],
        TimesRoman: ["TimesRoman", "TimesRomanBold", "TimesRomanItalic", "TimesRomanBoldItalic"],
        Courier: ["Courier", "CourierBold", "CourierOblique", "CourierBoldOblique"]
    };

    // WinAnsi is what the standard fonts can encode; anything outside it
    // (CJK, most symbols, emoji) has no glyph to show
    function isWinAnsi(str) {
        for (var i = 0; i < str.length; i++) {
            var c = str.charCodeAt(i);
            if (c === 9 || c === 10 || c === 13) continue;
            if (c < 32) return false;
            if (c > 255) {
                // a handful above U+00FF are in WinAnsi; keeping to the
                // Latin-1 range is the safe, checkable rule
                return false;
            }
        }
        return true;
    }

    /* haveFamily reports whether a family is actually installed. It has to
       be measured: document.fonts.check() answers "is it loaded", and for a
       local family Chrome says yes whatever name you give it. The reliable
       test is the old one - render a probe string backed by two different
       generics; a family that exists overrides both and comes out a
       different width from each, one that does not falls through to the
       generic and matches it exactly.

       This matters because a deck may ask for a font the machine does not
       have: the browser laid the text out in the fallback, so the fallback
       is what the PDF must match - and that may well be one it can show. */
    var PROBE = "mmmmmmmmwwwwwwwwiiiiiiiil1I0Oo";
    var familyKnown = {};
    var probeCtx = null;
    var probeBase = null;
    function haveFamily(name) {
        if (familyKnown[name] !== undefined) return familyKnown[name];
        try {
            if (!probeCtx) {
                probeCtx = document.createElement("canvas").getContext("2d");
                probeBase = {};
                ["monospace", "serif"].forEach(function (g) {
                    probeCtx.font = '72px ' + g;
                    probeBase[g] = probeCtx.measureText(PROBE).width;
                });
            }
            var found = true;
            ["monospace", "serif"].forEach(function (g) {
                probeCtx.font = '72px "' + name.replace(/"/g, "") + '", ' + g;
                if (probeCtx.measureText(PROBE).width === probeBase[g]) found = false;
            });
            familyKnown[name] = found;
        } catch (e) {
            familyKnown[name] = true;
        }
        return familyKnown[name];
    }

    /* stdFamilyOf resolves a computed font-family list down to the standard
       font it is metric-compatible with, or "" when there is none. The
       first family the browser can actually use is the one that decides,
       because that is the one the text was measured in. */
    function stdFamilyOf(cssFamily) {
        var parts = String(cssFamily || "").split(",");
        for (var i = 0; i < parts.length; i++) {
            var name = parts[i].trim().replace(/^["']|["']$/g, "");
            if (!name) continue;
            var key = name.toLowerCase();
            var generic = (key === "sans-serif" || key === "serif" ||
                key === "monospace" || key === "cursive" || key === "fantasy");
            if (!generic && !haveFamily(name)) continue;   // the browser skipped it too
            return STD_FAMILIES[key] || "";
        }
        return "";
    }

    /* fontCache hands out the embedded standard fonts lazily, so a deck
       that never uses italics does not carry an italic font object */
    function makeFontCache(pdfDoc) {
        var cache = {};
        return function (family, bold, italic) {
            var names = STD_VARIANTS[family] || STD_VARIANTS.Helvetica;
            var key = names[(bold ? 1 : 0) + (italic ? 2 : 0)];
            if (!cache[key]) cache[key] = pdfDoc.embedStandardFont(PDFLib.StandardFonts[key]);
            return cache[key];
        };
    }

    /* ---------------- small helpers ---------------- */

    function px(v) { return v * PX_TO_PT; }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    /* parseFill returns both halves of a CSS colour: the colour itself and
       its alpha. The alpha matters - a table's header band is a translucent
       wash of the theme accent, and dropping it turns a tint into a slab. */
    function parseFill(css) {
        if (!css) return null;
        var m = /^rgba?\(([^)]+)\)$/i.exec(String(css).trim());
        if (m) {
            var p = m[1].split(",").map(function (x) { return parseFloat(x); });
            var a = p.length >= 4 ? clamp(p[3], 0, 1) : 1;
            if (a === 0) return null;
            return {
                c: PDFLib.rgb(clamp(p[0] / 255, 0, 1), clamp(p[1] / 255, 0, 1), clamp(p[2] / 255, 0, 1)),
                a: a
            };
        }
        var t = String(css).trim();
        var h = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(t);
        if (!h) return null;
        var v = h[1];
        var alpha = 1;
        if (v.length === 8) { alpha = parseInt(v.substring(6, 8), 16) / 255; v = v.substring(0, 6); }
        if (v.length === 3) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
        if (alpha === 0) return null;
        var n = parseInt(v, 16);
        return {
            c: PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255),
            a: alpha
        };
    }
    // parseColor is parseFill when only the colour is wanted
    function parseColor(css) {
        var f = parseFill(css);
        return f ? f.c : null;
    }

    function dataUrlBytes(src) {
        var comma = String(src || "").indexOf(",");
        if (comma < 0) return null;
        var head = src.substring(0, comma);
        if (head.indexOf(";base64") < 0) return null;
        var bin = atob(src.substring(comma + 1));
        var out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return { bytes: out, mime: (/^data:([^;]+)/.exec(head) || [])[1] || "" };
    }

    /* ---------------- the drawing context ---------------- */

    /* Page is a thin wrapper that flips the y axis once: the editor's
       coordinates run down from the top-left of the slide, a PDF page's run
       up from the bottom-left, and mixing the two up is the single easiest
       way to get an export subtly wrong. */
    function Page(page, pdfDoc, fontFor) {
        this.p = page;
        this.doc = pdfDoc;
        this.fontFor = fontFor;
        this.gsCache = {};
    }
    Page.prototype.y = function (topPx) { return px(SLIDE_H - topPx); };

    Page.prototype.rect = function (x, y, w, h, opts) {
        this.p.drawRectangle({
            x: px(x), y: this.y(y + h), width: px(w), height: px(h),
            color: opts.fill || undefined,
            borderColor: opts.stroke || undefined,
            borderWidth: opts.strokeW ? px(opts.strokeW) : undefined,
            borderDashArray: opts.dash ? [px(opts.strokeW * 3), px(opts.strokeW * 2)] : undefined,
            opacity: opts.fillOpacity !== undefined ? opts.fillOpacity : opts.opacity,
            borderOpacity: opts.strokeOpacity !== undefined ? opts.strokeOpacity : opts.opacity
        });
    };

    // ops pushes raw content-stream operators, which is how the clip paths
    // and the matrices below are expressed
    Page.prototype.ops = function (list) {
        this.p.pushOperators.apply(this.p, list);
    };
    Page.prototype.save = function () { this.ops([PDFLib.pushGraphicsState()]); };
    Page.prototype.restore = function () { this.ops([PDFLib.popGraphicsState()]); };

    // alpha returns the name of an ExtGState for a given opacity, making one
    // only the first time each distinct value is used on this page
    Page.prototype.alpha = function (a) {
        var key = "a" + Math.round(a * 1000);
        if (!this.gsCache[key]) {
            var ref = this.doc.context.register(this.doc.context.obj({
                Type: "ExtGState", ca: a, CA: a
            }));
            this.p.node.setExtGState(PDFLib.PDFName.of(key), ref);
            this.gsCache[key] = true;
        }
        return key;
    };

    /* ---------------- geometry -> PDF path operators ---------------- */

    // shapePathOps turns one of the editor's shape outlines into path
    // operators in page space. Used for both shape objects and the clip
    // path of a shaped crop, so the two cannot disagree.
    function shapePathOps(kind, x, y, w, h, radius) {
        var X = function (v) { return px(x + v); };
        var Y = function (v) { return px(SLIDE_H - (y + v)); };
        var ops = [];
        if (!kind || kind === "rect") {
            ops.push(PDFLib.moveTo(X(0), Y(0)), PDFLib.lineTo(X(w), Y(0)),
                PDFLib.lineTo(X(w), Y(h)), PDFLib.lineTo(X(0), Y(h)), PDFLib.closePath());
            return ops;
        }
        if (kind === "round") {
            var r = Math.min(radius > 0 ? radius : Math.min(w, h) * 0.15, Math.min(w, h) / 2);
            var k = r * 0.5523;
            ops.push(PDFLib.moveTo(X(r), Y(0)));
            ops.push(PDFLib.lineTo(X(w - r), Y(0)));
            ops.push(PDFLib.appendBezierCurve(X(w - r + k), Y(0), X(w), Y(r - k), X(w), Y(r)));
            ops.push(PDFLib.lineTo(X(w), Y(h - r)));
            ops.push(PDFLib.appendBezierCurve(X(w), Y(h - r + k), X(w - r + k), Y(h), X(w - r), Y(h)));
            ops.push(PDFLib.lineTo(X(r), Y(h)));
            ops.push(PDFLib.appendBezierCurve(X(r - k), Y(h), X(0), Y(h - r + k), X(0), Y(h - r)));
            ops.push(PDFLib.lineTo(X(0), Y(r)));
            ops.push(PDFLib.appendBezierCurve(X(0), Y(r - k), X(r - k), Y(0), X(r), Y(0)));
            ops.push(PDFLib.closePath());
            return ops;
        }
        if (kind === "ellipse") {
            var cx = w / 2, cy = h / 2, kx = cx * 0.5523, ky = cy * 0.5523;
            ops.push(PDFLib.moveTo(X(0), Y(cy)));
            ops.push(PDFLib.appendBezierCurve(X(0), Y(cy - ky), X(cx - kx), Y(0), X(cx), Y(0)));
            ops.push(PDFLib.appendBezierCurve(X(cx + kx), Y(0), X(w), Y(cy - ky), X(w), Y(cy)));
            ops.push(PDFLib.appendBezierCurve(X(w), Y(cy + ky), X(cx + kx), Y(h), X(cx), Y(h)));
            ops.push(PDFLib.appendBezierCurve(X(cx - kx), Y(h), X(0), Y(cy + ky), X(0), Y(cy)));
            ops.push(PDFLib.closePath());
            return ops;
        }
        var pts = (window.SlidesApp && SlidesApp.shapePoints)
            ? SlidesApp.shapePoints(kind, w, h) : null;
        if (!pts || !pts.length) {
            return shapePathOps("rect", x, y, w, h, 0);
        }
        pts.forEach(function (pt, i) {
            ops.push(i === 0 ? PDFLib.moveTo(X(pt[0]), Y(pt[1])) : PDFLib.lineTo(X(pt[0]), Y(pt[1])));
        });
        ops.push(PDFLib.closePath());
        return ops;
    }

    /* ---------------- text ---------------- */

    /* A run is one uniformly formatted fragment of a single line, measured
       off the live DOM: its box, its baseline and the style in force. */
    function collectRuns(rootEl, origin) {
        var runs = [];
        var walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
        var node;
        while ((node = walker.nextNode())) {
            var text = node.nodeValue;
            if (!text || !text.trim()) continue;
            var parent = node.parentElement;
            if (!parent) continue;
            var cs = window.getComputedStyle(parent);
            if (cs.visibility === "hidden" || cs.display === "none") continue;
            // one entry per line box the fragment occupies
            var range = document.createRange();
            range.selectNodeContents(node);
            var rects = Array.prototype.slice.call(range.getClientRects());
            if (!rects.length) continue;
            var perLine = splitByLine(node, text, rects);
            perLine.forEach(function (ln) {
                runs.push({
                    text: ln.text,
                    rect: ln.rect,
                    origin: origin,
                    family: cs.fontFamily,
                    size: parseFloat(cs.fontSize) || 12,
                    weight: parseInt(cs.fontWeight, 10) || (cs.fontWeight === "bold" ? 700 : 400),
                    italic: cs.fontStyle === "italic" || cs.fontStyle === "oblique",
                    underline: cs.textDecorationLine.indexOf("underline") >= 0,
                    strike: cs.textDecorationLine.indexOf("line-through") >= 0,
                    color: cs.color,
                    background: cs.backgroundColor
                });
            });
        }
        return runs;
    }

    /* splitByLine maps a text node's client rects back onto the substrings
       that produced them, so each line can be drawn at its own baseline.
       Character-by-character is the only reliable way: the browser decides
       where the break went, and only it knows. */
    function splitByLine(node, text, lineRects) {
        if (lineRects.length === 1) {
            return [{ text: text, rect: lineRects[0] }];
        }
        var range = document.createRange();
        var out = [];
        var cur = "";
        var curTop = null;
        var curRect = null;
        for (var i = 0; i < text.length; i++) {
            range.setStart(node, i);
            range.setEnd(node, i + 1);
            var r = range.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) { cur += text[i]; continue; }
            var top = Math.round(r.top * 10) / 10;
            if (curTop === null || Math.abs(top - curTop) < 0.6) {
                if (curTop === null) { curTop = top; curRect = { left: r.left, top: r.top, bottom: r.bottom, right: r.right }; }
                else { curRect.right = Math.max(curRect.right, r.right); }
                cur += text[i];
            } else {
                out.push({ text: cur, rect: curRect });
                cur = text[i];
                curTop = top;
                curRect = { left: r.left, top: r.top, bottom: r.bottom, right: r.right };
            }
        }
        if (cur !== "" && curRect) out.push({ text: cur, rect: curRect });
        return out.length ? out : [{ text: text, rect: lineRects[0] }];
    }

    // canDrawAsText is the whole fallback decision, in one place
    function canDrawAsText(runs) {
        for (var i = 0; i < runs.length; i++) {
            if (!stdFamilyOf(runs[i].family)) return false;
            if (!isWinAnsi(runs[i].text)) return false;
        }
        return true;
    }

    /* drawRuns puts every run on the page as real text, each at the
       baseline the browser gave it. The standard fonts are metrically the
       families they stand in for, so the glyphs land where they were. */
    function drawRuns(pg, runs) {
        runs.forEach(function (r) {
            var fam = stdFamilyOf(r.family) || "Helvetica";
            var font = pg.fontFor(fam, r.weight >= 600, r.italic);
            var sizePt = px(r.size);
            // the browser's rect is the line box; the baseline sits an
            // ascender below its top
            var ascent = font.heightAtSize(r.size, { descender: false });
            var lineH = r.rect.bottom - r.rect.top;
            var glyphH = font.heightAtSize(r.size, { descender: true });
            var baselineTop = r.rect.top - r.origin.top + (lineH - glyphH) / 2 + ascent;
            var x = r.rect.left - r.origin.left;
            var col = parseColor(r.color) || PDFLib.rgb(0, 0, 0);
            var bg = parseFill(r.background);
            var w = font.widthOfTextAtSize(r.text, r.size);
            if (bg) {
                pg.rect(r.origin.x + x, r.origin.y + (r.rect.top - r.origin.top),
                    w, lineH, { fill: bg.c, fillOpacity: bg.a });
            }
            pg.p.drawText(r.text, {
                x: px(r.origin.x + x),
                y: pg.y(r.origin.y + baselineTop),
                size: sizePt, font: font, color: col
            });
            if (r.underline || r.strike) {
                var yOff = r.underline ? baselineTop + r.size * 0.11 : baselineTop - r.size * 0.28;
                pg.rect(r.origin.x + x, r.origin.y + yOff, w, Math.max(0.7, r.size * 0.06),
                    { fill: col });
            }
        });
    }

    /* ---------------- rasterizing one element ---------------- */

    /* The documented last resort, and it has one rule: the pixels come out
       of a render of the whole slide, then get cropped to the element that
       needed them.

       Rasterizing an element on its own looks tempting and is wrong.
       html2canvas re-renders a *clone*, and a clone torn out of its
       absolutely positioned parent loses the width it was laid out in -
       so the text re-wraps and the export stops matching the editor,
       which is the one thing it must not do. Rendering the slide keeps
       every element in the context it was measured in.

       What lands in the PDF is still only that element's own box: one
       image, at its own position, with everything else on the page a real
       PDF object. */
    /* The picture is taken through an SVG <foreignObject>, which means the
       *browser* lays the element out and paints it - the same engine, the
       same fonts, the same line breaks as the editor.

       This is not the obvious choice, so: html2canvas was tried first and
       is wrong for this. It re-implements layout over a clone, and on
       mixed CJK/Latin text with pre-wrap it breaks lines somewhere else
       than the browser did, which is precisely the failure this whole
       rework exists to remove. A foreignObject cannot re-wrap anything,
       because it is not re-laying anything out.

       The cost is that computed styles have to be inlined onto the clone
       (an SVG image cannot reach the page's stylesheets) and every
       resource must already be a data URL - which, in a slide, it is. */
    function rasterizeElement(el, w, h) {
        try {
            var clone = el.cloneNode(true);
            inlineStyles(el, clone);
            // the foreignObject supplies the box, so the clone must not
            // carry the absolute placement it had on the slide
            clone.style.position = "static";
            clone.style.left = "auto";
            clone.style.top = "auto";
            clone.style.transform = "none";
            clone.style.margin = "0";
            clone.style.width = w + "px";
            clone.style.height = h + "px";

            var cw = Math.max(1, Math.ceil(w)), ch = Math.max(1, Math.ceil(h));
            /* The markup inside a foreignObject has to be well-formed XML,
               and innerHTML is not: it writes <br> unclosed, which makes the
               whole SVG fail to parse and the element vanish from the page.
               XMLSerializer writes real XHTML, so it cannot. */
            var wrap = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
            wrap.setAttribute("style", "width:" + cw + "px;height:" + ch + "px;");
            wrap.appendChild(clone);
            var xhtml = new XMLSerializer().serializeToString(wrap);
            var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + cw +
                '" height="' + ch + '"><foreignObject x="0" y="0" width="' + cw +
                '" height="' + ch + '">' + xhtml + "</foreignObject></svg>";
            var url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
            return new Promise(function (resolve) {
                var img = new Image();
                img.onload = function () {
                    try {
                        var c = document.createElement("canvas");
                        c.width = Math.max(1, Math.round(cw * RASTER_SCALE));
                        c.height = Math.max(1, Math.round(ch * RASTER_SCALE));
                        var g = c.getContext("2d");
                        g.drawImage(img, 0, 0, c.width, c.height);
                        resolve(c.toDataURL("image/png"));
                    } catch (e) { resolve(null); }
                };
                img.onerror = function () { resolve(null); };
                img.src = url;
            });
        } catch (e) {
            return Promise.resolve(null);
        }
    }

    /* rasterizeFallback is the very last resort, for the case where even
       the foreignObject route fails. html2canvas re-implements layout and
       can break mixed-script lines somewhere the browser did not, so it is
       only ever reached when the alternative is dropping the element
       from the page entirely - which would be worse. */
    function rasterizeFallback(el, w, h) {
        if (typeof html2canvas === "undefined") return Promise.resolve(null);
        return html2canvas(el, {
            scale: RASTER_SCALE, useCORS: true, backgroundColor: null, logging: false
        }).then(function (canvas) {
            return canvas.toDataURL("image/png");
        }).catch(function () { return null; });
    }

    /* inlineStyles copies the computed style of every node in the subtree
       onto the clone, because the SVG image has no access to the page's
       stylesheets. Slide markup is small - a few divs and spans - so
       walking the whole property list is affordable and leaves nothing out. */
    function inlineStyles(src, dst) {
        var cs = window.getComputedStyle(src);
        var out = "";
        for (var i = 0; i < cs.length; i++) {
            var prop = cs[i];
            out += prop + ":" + cs.getPropertyValue(prop) + ";";
        }
        dst.setAttribute("style", out);
        var a = src.children, b = dst.children;
        for (var j = 0; j < a.length && j < b.length; j++) inlineStyles(a[j], b[j]);
    }

    // boxOf returns an element's box in slide coordinates
    function boxOf(el, stageEl) {
        var r = el.getBoundingClientRect(), s = stageEl.getBoundingClientRect();
        return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height };
    }

    /* drawAsRaster puts one element in as an image of itself, at the box it
       occupies on the slide. A rotated object is drawn unrotated inside the
       rotation matrix its caller set up, so the picture stays crisp
       rather than being a picture of something already turned. */
    function drawAsRaster(pg, o, el, ctx) {
        var b = boxOf(el, ctx.stage);
        return rasterizeElement(el, b.w, b.h).then(function (src) {
            return src || rasterizeFallback(el, b.w, b.h);
        }).then(function (src) {
            if (!src) return;
            return ctx.embed(src).then(function (img) {
                if (!img) return;
                pg.p.drawImage(img, {
                    x: px(b.x), y: pg.y(b.y + b.h), width: px(b.w), height: px(b.h)
                });
            });
        });
    }

    /* ---------------- images ---------------- */

    /* filteredImageData re-encodes a picture through a canvas when it
       carries a colour treatment. Applying a filter is a pixel operation in
       any renderer, so this is the correct way to do it, not a fallback. */
    function filteredImageData(src, filter, naturalW, naturalH) {
        return new Promise(function (resolve) {
            var img = new Image();
            img.onload = function () {
                try {
                    var c = document.createElement("canvas");
                    c.width = naturalW || img.naturalWidth;
                    c.height = naturalH || img.naturalHeight;
                    var g = c.getContext("2d");
                    g.filter = filter;
                    g.drawImage(img, 0, 0, c.width, c.height);
                    resolve(c.toDataURL("image/png"));
                } catch (e) { resolve(null); }
            };
            img.onerror = function () { resolve(null); };
            img.src = src;
        });
    }

    /* sniffImage decides which embedder to use from the bytes themselves
       rather than from a mime string, which a fetched file may not carry */
    function sniffImage(bytes) {
        if (bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8) return "jpg";
        return "png";
    }

    /* embedImage caches by source string: a deck that uses one picture on
       twenty slides embeds its bytes once.

       A native .ppta keeps its large media out of the body as media?file=
       links, so a source that is not a data URL is fetched. Embedding the
       original bytes is the point - re-encoding through a canvas would
       turn a photo into a much larger lossless PNG. */
    function makeImageEmbedder(pdfDoc) {
        var cache = {};
        function embedBytes(bytes) {
            return sniffImage(bytes) === "jpg" ? pdfDoc.embedJpg(bytes) : pdfDoc.embedPng(bytes);
        }
        return function (src) {
            if (!src) return Promise.resolve(null);
            if (cache[src]) return cache[src];
            var p;
            var d = dataUrlBytes(src);
            if (d) {
                p = /jpe?g/i.test(d.mime) ? pdfDoc.embedJpg(d.bytes) : embedBytes(d.bytes);
            } else {
                p = fetch(src).then(function (r) {
                    if (!r.ok) throw new Error("cannot read " + src);
                    return r.arrayBuffer();
                }).then(function (buf) {
                    return embedBytes(new Uint8Array(buf));
                });
            }
            cache[src] = p.catch(function () { return null; });
            return cache[src];
        };
    }

    /* ---------------- SVG (charts) -> PDF vectors ---------------- */

    /* OfficeCharts draws with rect / line / polyline / polygon / path /
       circle / text, so a chart can be put in the PDF as the vectors it
       already is. Anything unexpected in the tree makes the caller fall
       back to a raster for that one object. */
    var SVG_KNOWN = { g: 1, rect: 1, line: 1, circle: 1, polyline: 1,
        polygon: 1, path: 1, text: 1, defs: 1, title: 1, desc: 1 };

    /* svgTranslatable asks whether drawSvg can express this tree, before
       anything is drawn - an element it does not know, or a label in a
       script the standard fonts cannot show, means the chart has to come
       in as a picture instead. */
    function svgTranslatable(el) {
        for (var i = 0; i < el.children.length; i++) {
            var c = el.children[i];
            var tag = c.tagName.toLowerCase();
            if (!SVG_KNOWN[tag]) return false;
            if (tag === "text") {
                var str = c.textContent || "";
                if (str.trim() && !isWinAnsi(str)) return false;
                if (!stdFamilyOf(window.getComputedStyle(c).fontFamily)) return false;
            }
            if (tag === "g" && !svgTranslatable(c)) return false;
        }
        return true;
    }

    function drawSvg(pg, svgEl, x, y, w, h) {
        var vb = (svgEl.getAttribute("viewBox") || "").split(/[\s,]+/).map(parseFloat);
        var vw = vb.length === 4 ? vb[2] : w, vh = vb.length === 4 ? vb[3] : h;
        var vx = vb.length === 4 ? vb[0] : 0, vy = vb.length === 4 ? vb[1] : 0;
        if (!(vw > 0) || !(vh > 0)) return false;
        var k = Math.min(w / vw, h / vh);
        var offX = x + (w - vw * k) / 2, offY = y + (h - vh * k) / 2;
        var X = function (v) { return offX + (v - vx) * k; };
        var Y = function (v) { return offY + (v - vy) * k; };

        var ok = true;
        var walk = function (el) {
            if (!ok) return;
            for (var i = 0; i < el.children.length; i++) {
                var c = el.children[i];
                var tag = c.tagName.toLowerCase();
                var cs = window.getComputedStyle(c);
                var fill = c.getAttribute("fill");
                var stroke = c.getAttribute("stroke");
                // charts inherit their text colour; resolve it the way the
                // browser did rather than guessing
                var fillF = (fill === "none") ? null
                    : parseFill(fill === "currentColor" || !fill ? cs.color : fill);
                var strokeF = (!stroke || stroke === "none") ? null
                    : parseFill(stroke === "currentColor" ? cs.color : stroke);
                var fillCol = fillF ? fillF.c : null, fillA = fillF ? fillF.a : 1;
                var strokeCol = strokeF ? strokeF.c : null, strokeA = strokeF ? strokeF.a : 1;
                var sw = parseFloat(c.getAttribute("stroke-width") || "1") * k;
                switch (tag) {
                    case "g": walk(c); break;
                    case "rect":
                        pg.rect(X(parseFloat(c.getAttribute("x") || 0)),
                            Y(parseFloat(c.getAttribute("y") || 0)),
                            parseFloat(c.getAttribute("width") || 0) * k,
                            parseFloat(c.getAttribute("height") || 0) * k,
                            { fill: fillCol, stroke: strokeCol, strokeW: strokeCol ? sw : 0,
                              fillOpacity: fillA, strokeOpacity: strokeA });
                        break;
                    case "line":
                        pg.p.drawLine({
                            start: { x: px(X(parseFloat(c.getAttribute("x1") || 0))), y: pg.y(Y(parseFloat(c.getAttribute("y1") || 0))) },
                            end: { x: px(X(parseFloat(c.getAttribute("x2") || 0))), y: pg.y(Y(parseFloat(c.getAttribute("y2") || 0))) },
                            thickness: px(sw), color: strokeCol || PDFLib.rgb(0, 0, 0)
                        });
                        break;
                    case "circle":
                        pg.p.drawCircle({
                            x: px(X(parseFloat(c.getAttribute("cx") || 0))),
                            y: pg.y(Y(parseFloat(c.getAttribute("cy") || 0))),
                            size: px(parseFloat(c.getAttribute("r") || 0) * k),
                            color: fillCol || undefined,
                            borderColor: strokeCol || undefined,
                            borderWidth: strokeCol ? px(sw) : undefined
                        });
                        break;
                    case "polyline":
                    case "polygon":
                        var pts = (c.getAttribute("points") || "").trim().split(/\s+/).map(function (p) {
                            var xy = p.split(",");
                            return [X(parseFloat(xy[0])), Y(parseFloat(xy[1]))];
                        }).filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); });
                        if (pts.length < 2) break;
                        var ops = [];
                        pts.forEach(function (p, i) {
                            ops.push(i === 0 ? PDFLib.moveTo(px(p[0]), pg.y(p[1]))
                                : PDFLib.lineTo(px(p[0]), pg.y(p[1])));
                        });
                        if (tag === "polygon") ops.push(PDFLib.closePath());
                        pg.save();
                        if (fillCol) ops.unshift(PDFLib.setFillingColor(fillCol));
                        if (strokeCol) {
                            ops.unshift(PDFLib.setStrokingColor(strokeCol));
                            ops.unshift(PDFLib.setLineWidth(px(sw)));
                        }
                        ops.push(fillCol && strokeCol ? PDFLib.fillAndStroke()
                            : (fillCol ? PDFLib.fill() : PDFLib.stroke()));
                        pg.ops(ops);
                        pg.restore();
                        break;
                    case "path":
                        var d = c.getAttribute("d");
                        if (!d) break;
                        pg.p.drawSvgPath(d, {
                            x: px(offX - vx * k), y: pg.y(offY - vy * k), scale: k * PX_TO_PT,
                            color: fillCol || undefined,
                            borderColor: strokeCol || undefined,
                            borderWidth: strokeCol ? px(sw) : undefined
                        });
                        break;
                    case "text":
                        var str = c.textContent || "";
                        if (!str.trim()) break;
                        if (!isWinAnsi(str)) { ok = false; return; }
                        // the svg is measured in px like the rest of the
                        // slide; only the final drawText call is in points
                        var sizePx = (parseFloat(cs.fontSize) || 12) * k;
                        var fam = stdFamilyOf(cs.fontFamily) || "Helvetica";
                        var font = pg.fontFor(fam, (parseInt(cs.fontWeight, 10) || 400) >= 600, false);
                        var twPx = font.widthOfTextAtSize(str, sizePx);
                        var anchor = c.getAttribute("text-anchor") || "start";
                        var tx = X(parseFloat(c.getAttribute("x") || 0));
                        if (anchor === "middle") tx -= twPx / 2;
                        else if (anchor === "end") tx -= twPx;
                        pg.p.drawText(str, {
                            x: px(tx), y: pg.y(Y(parseFloat(c.getAttribute("y") || 0))),
                            size: px(sizePx), font: font, color: fillCol || PDFLib.rgb(0, 0, 0)
                        });
                        break;
                    case "defs":
                    case "title":
                    case "desc":
                        break;
                    default:
                        ok = false;
                        return;
                }
            }
        };
        walk(svgEl);
        return ok;
    }

    /* ---------------- one object ---------------- */

    /* An object's rotation turns the whole object about its own centre.
       Rather than rotate every primitive, the drawing runs inside one
       matrix and the offscreen element is measured with its CSS rotation
       taken off - otherwise getBoundingClientRect would hand back the
       bounding box of the rotated result instead of the box itself. */
    function withRotation(pg, o, el, fn) {
        if (!o.rot) return fn();
        var prev = el ? el.style.transform : null;
        if (el) {
            el.style.transform = "none";
            void el.offsetWidth;                 // force the reflow
        }
        var rad = -o.rot * Math.PI / 180;        // css turns clockwise, pdf does not
        var cos = Math.cos(rad), sin = Math.sin(rad);
        var cx = px(o.x + o.w / 2), cy = pg.y(o.y + o.h / 2);
        pg.save();
        pg.ops([PDFLib.concatTransformationMatrix(cos, sin, -sin, cos,
            cx - (cos * cx - sin * cy), cy - (sin * cx + cos * cy))]);
        var restore = function () {
            pg.restore();
            if (el) el.style.transform = prev;
        };
        var out;
        try { out = fn(); } catch (e) { restore(); throw e; }
        return Promise.resolve(out).then(function (v) { restore(); return v; },
            function (e) { restore(); throw e; });
    }

    /* needsRaster answers the fallback question up front, before anything
       is drawn and before any transform is touched. It only inspects fonts
       and characters, so a rotated element can be asked safely. */
    function needsRaster(o, el) {
        if (!el) return false;
        if (o.type === "chart") {
            var svg = el.querySelector("svg");
            return !svg || !svgTranslatable(svg);
        }
        var root = null;
        if (o.type === "text") root = el.querySelector(".sl-text-in");
        else if (o.type === "shape") root = el.querySelector(".sl-shape-text");
        else if (o.type === "table") root = el;
        else return false;
        if (!root) return false;
        var runs = collectRuns(root, { left: 0, top: 0, x: 0, y: 0 });
        return runs.length > 0 && !canDrawAsText(runs);
    }

    function drawObject(pg, o, el, ctx) {
        var raster = !!(el && needsRaster(o, el));
        return withRotation(pg, o, el, function () {
            return raster ? drawAsRaster(pg, o, el, ctx)
                : drawObjectBody(pg, o, el, ctx);
        });
    }

    function drawObjectBody(pg, o, el, ctx) {
        var origin = null;
        if (el) {
            var r = el.getBoundingClientRect();
            origin = { left: r.left, top: r.top, x: o.x, y: o.y };
        }

        switch (o.type) {
            case "image":
            case "video":
            case "audio":
                return drawImageObject(pg, o, el, ctx);
            case "shape":
                return drawShapeObject(pg, o, el, origin, ctx);
            case "line":
                drawLineObject(pg, o);
                return Promise.resolve();
            case "table":
                return drawTableObject(pg, o, el, ctx);
            case "chart":
                return drawChartObject(pg, o, el, ctx);
            case "text":
                return drawTextObject(pg, o, el, origin, ctx);
        }
        return Promise.resolve();
    }

    /* ---- text object ---- */
    function drawTextObject(pg, o, el, origin, ctx) {
        var inner = el ? el.querySelector(".sl-text-in") : null;
        if (!inner) return Promise.resolve();
        var runs = collectRuns(inner, origin);
        if (runs.length) drawRuns(pg, runs);
        return Promise.resolve();
    }

    /* ---- image object ---- */
    function drawImageObject(pg, o, el, ctx) {
        var embedImage = ctx.embed;
        var p = o.props || {};
        var src = p.src;
        if (o.type === "video" || o.type === "audio") src = p.png || "";
        if (!src) return Promise.resolve();
        var filter = (window.SlidesImageTools ? SlidesImageTools.imageFilter(p) : "");
        var prep = filter ? filteredImageData(src, filter) : Promise.resolve(src);
        return prep.then(function (finalSrc) {
            return embedImage(finalSrc || src);
        }).then(function (img) {
            if (!img) return;
            var crop = p.crop;
            var kw = 1, kh = 1, cl = 0, ct = 0;
            if (crop && crop.length === 4) {
                cl = Number(crop[0]) || 0; ct = Number(crop[1]) || 0;
                kw = 1 - cl - (Number(crop[2]) || 0);
                kh = 1 - ct - (Number(crop[3]) || 0);
                if (!(kw > 0.001) || !(kh > 0.001)) { kw = kh = 1; cl = ct = 0; }
            }
            // the visible window is the object box; the whole picture is
            // that box scaled up by the crop, shifted so the kept part lines
            // up - the same identity the editor and the pptx reader use
            var fullW = o.w / kw, fullH = o.h / kh;
            var fullX = o.x - cl * fullW, fullY = o.y - ct * fullH;

            pg.save();
            // clip to the frame, in the shape the picture is masked to
            var clipOps = shapePathOps(p.mask || "rect", o.x, o.y, o.w, o.h, p.radius);
            clipOps.push(PDFLib.clip(), PDFLib.endPath());
            pg.ops(clipOps);
            if (p.opacity && p.opacity < 1) {
                pg.ops([PDFLib.setGraphicsState(pg.alpha(clamp(p.opacity, 0, 1)))]);
            }
            // flips are a negative scale about the picture's own centre
            var sx = p.flipH ? -1 : 1, sy = p.flipV ? -1 : 1;
            var drawX = fullX, drawY = fullY;
            if (sx < 0 || sy < 0) {
                var cx = px(fullX + fullW / 2), cy = pg.y(fullY + fullH / 2);
                pg.ops([PDFLib.concatTransformationMatrix(sx, 0, 0, sy,
                    cx - sx * cx, cy - sy * cy)]);
            }
            pg.p.drawImage(img, {
                x: px(drawX), y: pg.y(drawY + fullH),
                width: px(fullW), height: px(fullH)
            });
            pg.restore();
        });
    }

    /* ---- shape object ---- */
    function drawShapeObject(pg, o, el, origin, ctx) {
        var p = o.props || {};
        var fill = (p.fill && p.fill !== "none") ? parseColor(p.fill) : null;
        var stroke = (p.strokeW > 0 && p.stroke && p.stroke !== "none") ? parseColor(p.stroke) : null;
        if (fill || stroke) {
            var ops = shapePathOps(p.kind || "rect", o.x, o.y, o.w, o.h, p.radius);
            if (fill) ops.unshift(PDFLib.setFillingColor(fill));
            if (stroke) {
                ops.unshift(PDFLib.setStrokingColor(stroke));
                ops.unshift(PDFLib.setLineWidth(px(p.strokeW)));
                if (p.dash) ops.unshift(PDFLib.setDashPattern([px(p.strokeW * 3), px(p.strokeW * 2.4)], 0));
            }
            ops.push(fill && stroke ? PDFLib.fillAndStroke() : (fill ? PDFLib.fill() : PDFLib.stroke()));
            pg.save();
            pg.ops(ops);
            pg.restore();
        }
        // the caption rides on the same text rules as a text box
        var inner = el ? el.querySelector(".sl-shape-text") : null;
        if (!inner) return Promise.resolve();
        var runs = collectRuns(inner, origin || { left: 0, top: 0, x: o.x, y: o.y });
        if (runs.length) drawRuns(pg, runs);
        return Promise.resolve();
    }

    /* ---- line object ---- */
    function drawLineObject(pg, o) {
        var p = o.props || {};
        var pts = (p.points && p.points.length >= 2)
            ? p.points.map(function (pt) { return [o.x + pt[0], o.y + pt[1]]; })
            : [[o.x, o.y], [o.x + o.w, o.y + o.h]];
        var col = parseColor(p.stroke) || PDFLib.rgb(0.13, 0.13, 0.14);
        var sw = Number(p.strokeW) || 2;

        var trimmed = pts.slice();
        var heads = [];
        var arrow = function (tipIdx, fromIdx) {
            var tip = pts[tipIdx], from = pts[fromIdx];
            var ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
            var s = 6 + sw * 2.4;
            var bx = tip[0] - s * Math.cos(ang), by = tip[1] - s * Math.sin(ang);
            var ox = s * 0.45 * -Math.sin(ang), oy = s * 0.45 * Math.cos(ang);
            heads.push([tip, [bx + ox, by + oy], [bx - ox, by - oy]]);
            return [tip[0] - s * 0.6 * Math.cos(ang), tip[1] - s * 0.6 * Math.sin(ang)];
        };
        if (p.arrowEnd) trimmed[trimmed.length - 1] = arrow(pts.length - 1, pts.length - 2);
        if (p.arrowStart) trimmed[0] = arrow(0, 1);

        var ops = [PDFLib.setStrokingColor(col), PDFLib.setLineWidth(px(sw)),
            PDFLib.setLineCap(PDFLib.LineCapStyle.Round),
            PDFLib.setLineJoin(PDFLib.LineJoinStyle.Round)];
        if (p.dash) ops.push(PDFLib.setDashPattern([px(sw * 3), px(sw * 2.4)], 0));
        trimmed.forEach(function (pt, i) {
            ops.push(i === 0 ? PDFLib.moveTo(px(pt[0]), pg.y(pt[1])) : PDFLib.lineTo(px(pt[0]), pg.y(pt[1])));
        });
        ops.push(PDFLib.stroke());
        pg.save();
        pg.ops(ops);
        pg.restore();

        heads.forEach(function (tri) {
            var hops = [PDFLib.setFillingColor(col)];
            tri.forEach(function (pt, i) {
                hops.push(i === 0 ? PDFLib.moveTo(px(pt[0]), pg.y(pt[1])) : PDFLib.lineTo(px(pt[0]), pg.y(pt[1])));
            });
            hops.push(PDFLib.closePath(), PDFLib.fill());
            pg.save();
            pg.ops(hops);
            pg.restore();
        });
    }

    /* ---- table object ---- */
    function drawTableObject(pg, o, el, ctx) {
        if (!el) return Promise.resolve();
        var host = el.getBoundingClientRect();
        var origin = { left: host.left, top: host.top, x: o.x, y: o.y };
        var cells = el.querySelectorAll("td, th");
        var jobs = [];
        for (var i = 0; i < cells.length; i++) {
            (function (cell) {
                var cs = window.getComputedStyle(cell);
                var cr = cell.getBoundingClientRect();
                var cx = o.x + (cr.left - host.left), cy = o.y + (cr.top - host.top);
                var bg = parseFill(cs.backgroundColor);
                if (bg) pg.rect(cx, cy, cr.width, cr.height, { fill: bg.c, fillOpacity: bg.a });
                var bd = parseFill(cs.borderTopColor);
                var bw = parseFloat(cs.borderTopWidth) || 0;
                if (bd && bw > 0) {
                    pg.rect(cx, cy, cr.width, cr.height,
                        { stroke: bd.c, strokeW: bw, strokeOpacity: bd.a });
                }
                var runs = collectRuns(cell, origin);
                if (runs.length) drawRuns(pg, runs);
            })(cells[i]);
        }
        return Promise.all(jobs);
    }

    /* ---- chart object ---- */
    function drawChartObject(pg, o, el, ctx) {
        var svg = el ? el.querySelector("svg") : null;
        if (svg) drawSvg(pg, svg, o.x, o.y, o.w, o.h);
        return Promise.resolve();
    }

    /* ---------------- the build ---------------- */

    /* stage renders one slide offscreen at exactly 960x540 so every
       measurement below is taken at scale 1, whatever zoom the editor is at */
    function withStage(slide, fn) {
        var holder = document.createElement("div");
        holder.style.cssText = "position:fixed;left:-20000px;top:0;width:960px;height:540px;" +
            "overflow:hidden;contain:layout;";
        var el = document.createElement("div");
        el.className = "sl-slidebase";
        el.style.cssText = "width:960px;height:540px;position:relative;overflow:hidden;";
        holder.appendChild(el);
        document.body.appendChild(holder);
        SlidesApp.renderSlideContent(el, slide);
        return waitForImages(el).then(function () {
            return fn(el);
        }).then(function (r) {
            holder.remove();
            return r;
        }, function (e) {
            holder.remove();
            throw e;
        });
    }

    function waitForImages(root) {
        var imgs = Array.prototype.slice.call(root.querySelectorAll("img"));
        var pending = imgs.filter(function (im) { return !im.complete; });
        var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
        if (!pending.length) return fonts;
        return Promise.all([fonts].concat(pending.map(function (im) {
            return new Promise(function (res) {
                var done = function () { res(); };
                im.addEventListener("load", done);
                im.addEventListener("error", done);
                setTimeout(done, 6000);
            });
        })));
    }

    function build(body, opts) {
        opts = opts || {};
        if (typeof PDFLib === "undefined") {
            return Promise.reject(new Error("the PDF library failed to load"));
        }
        var slides = (body && body.slides) || [];
        if (!slides.length) return Promise.reject(new Error("the presentation has no slides"));

        return PDFLib.PDFDocument.create().then(function (pdfDoc) {
            var fontFor = makeFontCache(pdfDoc);
            var embedImage = makeImageEmbedder(pdfDoc);
            var theme = SlidesApp.themeOf();
            var chain = Promise.resolve();
            slides.forEach(function (slide, idx) {
                chain = chain.then(function () {
                    var page = pdfDoc.addPage([px(SLIDE_W), px(SLIDE_H)]);
                    var pg = new Page(page, pdfDoc, fontFor);
                    var bg = parseColor(slide.bg || theme.bg);
                    if (bg) pg.rect(0, 0, SLIDE_W, SLIDE_H, { fill: bg });
                    return withStage(slide, function (stageEl) {
                        var ctx = { stage: stageEl, embed: embedImage };
                        var objs = slide.objects || [];
                        var seq = Promise.resolve();
                        objs.forEach(function (o, i) {
                            seq = seq.then(function () {
                                return drawObject(pg, o, stageEl.children[i], ctx);
                            });
                        });
                        return seq;
                    });
                }).then(function () {
                    if (opts.onProgress) opts.onProgress(idx + 1, slides.length);
                });
            });
            return chain.then(function () { return pdfDoc.save(); });
        });
    }

    return {
        build: build,
        // exposed for the tests and for anyone reusing the SVG translator
        _stdFamilyOf: stdFamilyOf,
        _isWinAnsi: isWinAnsi
    };
})();
