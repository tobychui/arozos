/*
    ArozOS Office - PDF core
    ========================
    The parts of a browser-side PDF exporter that do not care what kind of
    document is being drawn, shared by Slides (slides/slides_pdf.js) and
    Docs (docs/docs_pdf.js). Both draw the very DOM their editor shows, so
    both need the same answers to the same questions: which font a PDF can
    show a character in, where the browser put a line of text and its
    baseline, how a picture gets embedded once, and what to do with the one
    element nothing else can express.

    The notes on each part were written for Slides and still hold word for
    word for Docs; "slide" there reads as "page".

    Requires pdf-lib (PDFLib) and OfficeFonts (common/fonts.js); fontkit is
    fetched on the first export.
*/

var OfficePdfCore = (function () {
    "use strict";

    var PX_TO_PT = 0.75;
    var RASTER_SCALE = 3;      // device pixels per css px for a fallback raster

    /* ---------------- fonts ---------------- */

    // where fontkit lives; it is fetched only when an export runs
    var FONTKIT_URL = "../common/lib/fontkit.umd.min.js";

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
    var GENERICS = { "sans-serif": 1, "serif": 1, "monospace": 1, "cursive": 1, "fantasy": 1 };

    /* WinAnsi is what the standard fonts can encode. A handful of code
       points above U+00FF are in it too, but keeping to the Latin-1 range
       is the rule that can be checked without a table. */
    function winAnsiCp(cp) {
        return cp >= 32 && cp <= 255;
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

    /* familyList turns a computed font-family into the list the browser
       walks, with the shipped faces on the end. The tail matters for old
       content: a <font face="..."> names one family and nothing else, and
       without it a character that family has no glyph for would have
       nowhere to go. */
    function familyList(cssFamily) {
        var out = [], seen = {};
        function add(n) {
            n = String(n).trim().replace(/^["']|["']$/g, "");
            if (!n || seen[n.toLowerCase()]) return;
            seen[n.toLowerCase()] = true;
            out.push(n);
        }
        String(cssFamily || "").split(",").forEach(add);
        OfficeFonts.FALLBACK.forEach(add);
        return out;
    }

    /* fontkit is what lets pdf-lib embed a font file of our own. It is the
       largest script the app has and only an export needs it, so it is
       fetched on the first export and not before. */
    var fontkitPromise = null;
    function loadFontkit() {
        if (fontkitPromise) return fontkitPromise;
        if (window.fontkit) {
            fontkitPromise = Promise.resolve(window.fontkit);
            return fontkitPromise;
        }
        fontkitPromise = new Promise(function (resolve, reject) {
            var el = document.createElement("script");
            el.src = FONTKIT_URL;
            el.onload = function () {
                if (window.fontkit) resolve(window.fontkit);
                else reject(new Error("the font toolkit did not load"));
            };
            el.onerror = function () { reject(new Error("the font toolkit did not load")); };
            document.head.appendChild(el);
        });
        return fontkitPromise;
    }

    /* makeFonts is the document's font supply.

       A standard font is there for the asking. A shipped face goes through
       two stages, and the split matters:

         want()  fetches the file and parses it, which is what answers "does
                 this face have a glyph for this character". Asynchronous,
                 so a slide says what it needs, waits (ready), then draws.
         use()   puts it in the PDF. Only faces that really get drawn with
                 may be embedded: the embedder subsets a font down to the
                 glyphs that were asked of it, and a subset of nothing is
                 not a font any more - a CFF one fails outright on save.

       Drawing itself stays synchronous, which is what lets a fragment be
       measured and placed in one pass. */
    function makeFonts(pdfDoc, fontkit) {
        var std = {};
        var faces = {};        // url -> { kit, font? }, or null when it failed
        var asked = {};        // url -> Promise, set the moment it is wanted
        var wanted = [];

        function stdFont(family, bold, italic) {
            var names = STD_VARIANTS[family] || STD_VARIANTS.Helvetica;
            var key = names[(bold ? 1 : 0) + (italic ? 2 : 0)];
            if (!std[key]) std[key] = pdfDoc.embedStandardFont(PDFLib.StandardFonts[key]);
            return std[key];
        }

        function want(family, bold, italic) {
            var face = OfficeFonts.faceFor(family, bold, italic);
            if (!face || asked[face.url]) return;
            asked[face.url] = fetch(face.url).then(function (r) {
                if (!r.ok) throw new Error("cannot read " + face.url);
                return r.arrayBuffer();
            }).then(function (buf) {
                var bytes = new Uint8Array(buf);
                faces[face.url] = { bytes: bytes, kit: fontkit.create(bytes) };
            }, function () {
                // a font that will not load is not a reason to fail the
                // export: the next family in the stack gets the character
                faces[face.url] = null;
            });
            wanted.push(asked[face.url]);
        }

        function use(family, bold, italic) {
            var face = OfficeFonts.faceFor(family, bold, italic);
            if (!face) return;
            var rec = faces[face.url];
            if (!rec || rec.font || rec.embedding) return;
            rec.embedding = pdfDoc.embedFont(rec.bytes, { subset: true })
                .then(function (font) { rec.font = font; });
            wanted.push(rec.embedding);
        }

        function ready() {
            var all = wanted;
            wanted = [];
            if (!all.length) return Promise.resolve();
            return Promise.all(all).then(function () { });
        }

        // shipped hands back a loaded face, null while it is not there
        function shipped(family, bold, italic) {
            var face = OfficeFonts.faceFor(family, bold, italic);
            if (!face) return null;
            var rec = faces[face.url];
            if (!rec) return null;
            return {
                font: rec.font, kit: rec.kit,
                synthBold: face.synthBold, synthItalic: face.synthItalic
            };
        }

        // tried says whether asking again could still change the answer
        function tried(family, bold, italic) {
            var face = OfficeFonts.faceFor(family, bold, italic);
            return !face || !!asked[face.url];
        }

        return {
            std: stdFont, want: want, use: use,
            ready: ready, shipped: shipped, tried: tried
        };
    }

    /* resolveChar walks a font stack the way the browser does and says what
       the PDF can put this one character in:

         { std }      one of the 14 standard fonts
         { shipped }  a face the suite ships, already embedded
         { need }     a shipped face that is named but not loaded yet, so
                      the answer is not known until it is
         null         nothing here can show this character

       A family that is neither - a system font - is stepped over rather
       than used: its bytes are unreadable, so the character goes to the
       next entry, which is the shipped face for its script. */
    function resolveChar(cp, names, fonts, bold, italic) {
        for (var i = 0; i < names.length; i++) {
            var name = names[i];
            var key = name.toLowerCase();
            if (OfficeFonts.isShipped(name)) {
                var rec = fonts.shipped(name, bold, italic);
                if (!rec) {
                    if (!fonts.tried(name, bold, italic)) return { need: name };
                    continue;
                }
                if (rec.kit && rec.kit.hasGlyphForCodePoint &&
                    !rec.kit.hasGlyphForCodePoint(cp)) continue;
                return { shipped: name };
            }
            if (STD_FAMILIES[key] && (GENERICS[key] || haveFamily(name)) && winAnsiCp(cp)) {
                return { std: STD_FAMILIES[key] };
            }
        }
        return null;
    }

    /* segmentText cuts a fragment into the pieces that share one font, the
       way a browser does per character. Returns null when any character has
       nowhere to go, which is the signal to rasterize instead. */
    function segmentText(text, names, fonts, bold, italic) {
        var segs = [], cur = null;
        for (var i = 0; i < text.length; i++) {
            var cp = text.codePointAt(i);
            var ch = String.fromCodePoint(cp);
            if (ch.length > 1) i++;          // a surrogate pair
            var res = resolveChar(cp, names, fonts, bold, italic);
            if (!res || res.need) return null;
            var key = res.std ? "s:" + res.std : "f:" + res.shipped;
            if (cur && cur.key === key) cur.text += ch;
            else { cur = { key: key, res: res, text: ch }; segs.push(cur); }
        }
        return segs;
    }

    function faceOf(res, fonts, bold, italic) {
        if (res.std) return { font: fonts.std(res.std, bold, italic), synthBold: false };
        var rec = fonts.shipped(res.shipped, bold, italic);
        return rec ? { font: rec.font, synthBold: rec.synthBold } : null;
    }

    /* Where the baseline sits is the browser's decision, and the exporter
       has to ask rather than compute: a system font's metrics are not
       readable from the page, and even for a font that is, the numbers the
       file states are not always the ones the browser uses.

       A canvas answers it. measureText reports the ascent and descent the
       browser resolved for a font stack, which is exactly what it used to
       lay the text out - so the two cannot drift apart.

       This is also why the run's own rect is the reference: the rects a
       Range hands back for text are the content box, ascent plus descent
       tall, not the line box. The baseline is therefore an ascent below the
       top of the rect, with the halving below for the case where a browser
       hands back the taller box instead. */
    var metricsCache = {};
    var metricsCtx = null;
    function fontMetricsOf(cs) {
        var font = cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
        if (metricsCache[font]) return metricsCache[font];
        var size = parseFloat(cs.fontSize) || 12;
        var m = null;
        try {
            if (!metricsCtx) metricsCtx = document.createElement("canvas").getContext("2d");
            metricsCtx.font = font;
            var tm = metricsCtx.measureText("Hxg");
            if (tm && tm.fontBoundingBoxAscent !== undefined) {
                m = { ascent: tm.fontBoundingBoxAscent, descent: tm.fontBoundingBoxDescent };
            }
        } catch (e) { /* fall through to the estimate */ }
        // a browser without the font bounding box: the usual proportions
        if (!m) m = { ascent: size * 0.9, descent: size * 0.22 };
        metricsCache[font] = m;
        return m;
    }

    /* eachTextNode is the walk both the font pre-pass and the run collector
       make, kept in one place so they cannot disagree about what counts as
       text on the slide. */
    function eachTextNode(rootEl, fn) {
        var walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
        var node;
        while ((node = walker.nextNode())) {
            var text = node.nodeValue;
            if (!text || !text.trim()) continue;
            var parent = node.parentElement;
            if (!parent) continue;
            var cs = window.getComputedStyle(parent);
            if (cs.visibility === "hidden" || cs.display === "none") continue;
            // source newlines and tabs are whitespace the browser already
            // collapsed; they must not reach a font, but the string has to
            // keep its length - the line split indexes back into the node
            fn(node, text.replace(/[\u0000-\u001F\u007F]/g, " "), cs);
        }
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
    /* contrastOf answers "what colour shows up on this fill" - only used
       for a shape's markings when it has no stroke colour of its own */
    function contrastOf(css) {
        var f = parseFill(css);
        if (!f) return "#333333";
        var lum = 0.299 * f.c.red + 0.587 * f.c.green + 0.114 * f.c.blue;
        return lum > 0.6 ? "#333333" : "#ffffff";
    }

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
    function Page(page, pdfDoc, fonts, heightPx) {
        this.p = page;
        this.doc = pdfDoc;
        this.fonts = fonts;
        this.h = heightPx;
        this.gsCache = {};
    }
    Page.prototype.y = function (topPx) { return px(this.h - topPx); };

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

    /* ---------------- text ---------------- */

    /* A run is one uniformly formatted fragment of a single line, measured
       off the live DOM: its box, its baseline and the style in force. */
    function collectRuns(rootEl, origin) {
        var runs = [];
        eachTextNode(rootEl, function (node, text, cs) {
            // one entry per line box the fragment occupies
            var range = document.createRange();
            range.selectNodeContents(node);
            var rects = Array.prototype.slice.call(range.getClientRects());
            if (!rects.length) return;
            var shared = {
                origin: origin,
                names: familyList(cs.fontFamily),
                metrics: fontMetricsOf(cs),
                size: parseFloat(cs.fontSize) || 12,
                weight: parseInt(cs.fontWeight, 10) || (cs.fontWeight === "bold" ? 700 : 400),
                italic: cs.fontStyle === "italic" || cs.fontStyle === "oblique",
                underline: cs.textDecorationLine.indexOf("underline") >= 0,
                strike: cs.textDecorationLine.indexOf("line-through") >= 0,
                color: cs.color,
                background: cs.backgroundColor
            };
            splitByLine(node, text, rects).forEach(function (ln) {
                var r = Object.create(shared);
                r.text = ln.text;
                r.rect = ln.rect;
                runs.push(r);
            });
        });
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

    // canDrawAsText is the whole fallback decision, in one place: every
    // character of every run has to have a font that can show it
    function canDrawAsText(runs, fonts) {
        for (var i = 0; i < runs.length; i++) {
            var r = runs[i];
            if (!segmentText(r.text, r.names, fonts, r.weight >= 600, r.italic)) return false;
        }
        return true;
    }

    /* drawFragment puts one line fragment on the page as real text, in as
       many pieces as it takes fonts to spell it.

       fitPx, when it is given, is the width the browser gave the fragment.
       The text is squeezed or stretched to exactly that with Tz, which
       costs nothing when the PDF font is the one the browser used (the
       ratio is 1) and is what keeps a substituted face - a system font we
       could not embed - from pushing the rest of the line out of place.

       Bold that a shipped face does not have is stroked rather than filled,
       at the width the browser smears it by. Neither side moves the advance
       widths, so the two stay in step. */
    function drawFragment(pg, spec) {
        var fonts = pg.fonts;
        var segs = segmentText(spec.text, spec.names, fonts, spec.bold, spec.italic);
        if (!segs || !segs.length) return 0;

        var total = 0;
        for (var i = 0; i < segs.length; i++) {
            var face = faceOf(segs[i].res, fonts, spec.bold, spec.italic);
            if (!face) return 0;
            segs[i].face = face;
            segs[i].w = face.font.widthOfTextAtSize(segs[i].text, spec.sizePx);
            total += segs[i].w;
        }

        var scale = 1;
        if (spec.fitPx > 0 && total > 0) {
            var ratio = spec.fitPx / total;
            // a ratio far from 1 means the measurement, not the font, is
            // wrong (a collapsed space, a transform) - leave it alone
            if (ratio > 0.5 && ratio < 2 && Math.abs(ratio - 1) > 0.005) scale = ratio;
        }

        var col = spec.color || PDFLib.rgb(0, 0, 0);
        var cursor = spec.xPx;
        segs.forEach(function (seg) {
            pg.save();
            var ops = [];
            if (scale !== 1) ops.push(PDFLib.setCharacterSqueeze(scale * 100));
            if (seg.face.synthBold) {
                ops.push(PDFLib.setTextRenderingMode(PDFLib.TextRenderingMode.FillAndOutline));
                ops.push(PDFLib.setLineWidth(px(spec.sizePx / 28)));
                ops.push(PDFLib.setStrokingColor(col));
            }
            if (ops.length) pg.ops(ops);
            pg.p.drawText(seg.text, {
                x: px(cursor), y: pg.y(spec.baselinePx),
                size: px(spec.sizePx), font: seg.face.font, color: col
            });
            pg.restore();
            cursor += seg.w * scale;
        });
        return total * scale;
    }

    /* drawRuns puts every run on the page at the baseline the browser laid
       it out on, in the width the browser gave it. */
    function drawRuns(pg, runs) {
        runs.forEach(function (r) {
            var x = r.origin.x + (r.rect.left - r.origin.left);
            var top = r.origin.y + (r.rect.top - r.origin.top);
            var lineH = r.rect.bottom - r.rect.top;
            var domW = r.rect.right - r.rect.left;
            var glyphH = r.metrics.ascent + r.metrics.descent;
            var baseline = (lineH - glyphH) / 2 + r.metrics.ascent;
            var col = parseColor(r.color) || PDFLib.rgb(0, 0, 0);
            var bg = parseFill(r.background);
            if (bg) pg.rect(x, top, domW, lineH, { fill: bg.c, fillOpacity: bg.a });
            // a fragment that starts or ends on a space cannot be fitted to
            // its rect: the browser collapses those, the measurement does not
            var w = drawFragment(pg, {
                text: r.text, names: r.names,
                bold: r.weight >= 600, italic: r.italic,
                sizePx: r.size, xPx: x, baselinePx: top + baseline,
                color: col, fitPx: /^\s|\s$/.test(r.text) ? 0 : domW
            });
            if (r.underline || r.strike) {
                var yOff = r.underline ? baseline + r.size * 0.11 : baseline - r.size * 0.28;
                pg.rect(x, top + yOff, w || domW, Math.max(0.7, r.size * 0.06), { fill: col });
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

    return {
        PX_TO_PT: PX_TO_PT,
        RASTER_SCALE: RASTER_SCALE,
        STD_FAMILIES: STD_FAMILIES,
        winAnsiCp: winAnsiCp,
        haveFamily: haveFamily,
        familyList: familyList,
        loadFontkit: loadFontkit,
        makeFonts: makeFonts,
        resolveChar: resolveChar,
        segmentText: segmentText,
        faceOf: faceOf,
        fontMetricsOf: fontMetricsOf,
        eachTextNode: eachTextNode,
        px: px,
        clamp: clamp,
        parseFill: parseFill,
        parseColor: parseColor,
        contrastOf: contrastOf,
        dataUrlBytes: dataUrlBytes,
        Page: Page,
        collectRuns: collectRuns,
        splitByLine: splitByLine,
        canDrawAsText: canDrawAsText,
        drawFragment: drawFragment,
        drawRuns: drawRuns,
        rasterizeElement: rasterizeElement,
        rasterizeFallback: rasterizeFallback,
        inlineStyles: inlineStyles,
        filteredImageData: filteredImageData,
        sniffImage: sniffImage,
        makeImageEmbedder: makeImageEmbedder
    };
})();
