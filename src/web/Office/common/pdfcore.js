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

    /* Characters that draw nothing: zero-width spaces and joiners,
       direction marks, variation selectors, the byte order mark, a soft
       hyphen. The editors write a zero-width space into every empty line
       to give it its height, so these are everywhere - and offering one to
       the font stack found no face with a glyph for it, which used to send
       the whole text box or table to a picture. They are simply not drawn. */
    function ignorableCp(cp) {
        return cp === 0xAD || cp === 0x34F || cp === 0x61C ||
            (cp >= 0x180B && cp <= 0x180F) || (cp >= 0x200B && cp <= 0x200F) ||
            (cp >= 0x202A && cp <= 0x202E) || (cp >= 0x2060 && cp <= 0x206F) ||
            (cp >= 0xFE00 && cp <= 0xFE0F) || cp === 0xFEFF ||
            (cp >= 0xE0000 && cp <= 0xE0FFF);
    }
    // visibleText is the text with the characters that draw nothing removed
    function visibleText(text) {
        var out = "";
        for (var i = 0; i < text.length; i++) {
            var cp = text.codePointAt(i);
            if (cp > 0xFFFF) i++;
            if (!ignorableCp(cp)) out += String.fromCodePoint(cp);
        }
        return out;
    }

    /* text-transform is applied by the browser when it paints, so the text
       node still holds what was typed: an all-caps title says "Agenda" in
       the DOM and AGENDA on the slide. The PDF has to apply it the same way. */
    var capitalizeRe = null;
    try {
        // a word starts after anything that is not a letter, a digit or an
        // apostrophe ("don't" stays one word)
        capitalizeRe = new RegExp("(^|[^\\p{L}\\p{N}'\\u2019])(\\p{Ll})", "gu");
    } catch (e) { /* no Unicode property escapes: capitalize is left as typed */ }
    function transformText(text, tt) {
        if (tt === "uppercase") return text.toUpperCase();
        if (tt === "lowercase") return text.toLowerCase();
        if (tt === "capitalize" && capitalizeRe) {
            return text.replace(capitalizeRe, function (m, a, b) { return a + b.toUpperCase(); });
        }
        return text;
    }
    /* haveFamily reports whether a family is actually installed. It has to
       be measured: document.fonts.check() answers "is it loaded", and for a
       local family Chrome says yes whatever name you give it. The reliable
       test is the old one - render a probe string backed by two different
       generics; a family that does not exist falls through to the generic
       and matches both exactly, one that exists overrides them and comes
       out a different width from at least one. Only one: a family can be
       a generic's own default (Consolas is Chrome's monospace on Windows,
       Times New Roman its serif), and then it matches that generic.

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
            var found = false;
            ["monospace", "serif"].forEach(function (g) {
                probeCtx.font = '72px "' + name.replace(/"/g, "") + '", ' + g;
                if (probeCtx.measureText(PROBE).width !== probeBase[g]) found = true;
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
       fetched on the first export and not before. What comes back makes a
       variable font's bytes into the instance they were fetched for
       (OfficePdfDraw.variationKit). */
    var fontkitPromise = null;
    function wrapKit(kit) {
        return typeof OfficePdfDraw !== "undefined" ? OfficePdfDraw.variationKit(kit) : kit;
    }
    function loadFontkit() {
        if (fontkitPromise) return fontkitPromise;
        if (window.fontkit) {
            fontkitPromise = Promise.resolve(wrapKit(window.fontkit));
            return fontkitPromise;
        }
        fontkitPromise = new Promise(function (resolve, reject) {
            var el = document.createElement("script");
            el.src = FONTKIT_URL;
            el.onload = function () {
                if (window.fontkit) resolve(wrapKit(window.fontkit));
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
            if (!std[key]) {
                std[key] = pdfDoc.embedStandardFont(PDFLib.StandardFonts[key]);
                // what a recorded drawing names the font by (pdfdraw.js)
                std[key].__ref = "k:" + key;
            }
            return std[key];
        }

        // one download per file: two instances of a variable face differ
        // only in their url's fragment
        var downloads = {};
        function download(url) {
            var file = String(url).replace(/#.*$/, "");
            if (!downloads[file]) {
                downloads[file] = fetch(file).then(function (r) {
                    if (!r.ok) throw new Error("cannot read " + file);
                    return r.arrayBuffer();
                });
            }
            return downloads[file];
        }

        function want(family, bold, italic) {
            var face = OfficeFonts.faceFor(family, bold, italic);
            if (!face || asked[face.url]) return;
            asked[face.url] = download(face.url).then(function (buf) {
                var bytes = new Uint8Array(buf);
                // a variable library face: the instance its url names
                var v = typeof OfficePdfDraw !== "undefined" ? OfficePdfDraw.variationOf(face.url) : null;
                if (v) bytes.__ofVariation = v;
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
            // no standard ligatures, as on screen (the page CSS turns
            // them off: Office never joins "ti" or "fi")
            rec.embedding = pdfDoc.embedFont(rec.bytes, { subset: true, features: { liga: false } })
                .then(function (font) {
                    font.__ref = "f:" + absoluteUrl(face.url);
                    rec.font = font;
                });
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

    function absoluteUrl(u) {
        try { return new URL(u, document.baseURI).href; } catch (e) { return u; }
    }

    /* resolveChar walks a font stack the way the browser does and says what
       the PDF can put this one character in:

         { std }      one of the 14 standard fonts
         { shipped }  a face the suite ships, already embedded
         { need }     a shipped face that is named but not loaded yet, so
                      the answer is not known until it is
         null         nothing here can show this character

       bold: true on any of them means the face is bold whatever the run
       asks for: a weighted family name ("Open Sans SemiBold") that the
       screen draws from its base family's bold file (OfficeFonts.substitute).

       scale, when it is there, is how much larger than the run's size the
       face has to be drawn (standIn).

       A family that is neither - a system font - cannot be embedded, its
       bytes are unreadable; standIn says what is drawn in its place. */
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
            var res = standIn(cp, name, fonts, bold, italic);
            if (res) return res;
        }
        return null;
    }

    /* standIn answers for a system font, which the PDF cannot carry. What
       the screen drew it in decides, tried in this order:

         - a family this machine lacks was drawn in a stand-in of its own
           (OfficeFonts.substitute): a shipped metric twin is embedded as
           it is, a shipped face is that same face, an installed one is the
           standard font or shipped twin that matches it
         - an installed family is drawn in itself, and the nearest face of
           its kind takes its place: its metric twin when the suite ships
           one (Calibri -> Carlito), else Cousine for a monospace family and
           the standard font of its kind for the rest

       A monospace family needs a monospace face whatever the stack says
       next. The browser set every character of it on one fixed advance, a
       code listing lines its columns up on that, and a proportional face
       fitted to a whole fragment cannot put a single character back where
       it was - the gaps and drifting columns that used to come out of
       every syntax-coloured listing. So an installed monospace family the
       substitution never looked at (Docs only gives a face to a family
       the machine lacks) stands in too, and so does one with a shipped
       metric twin; any other is stepped over and the next family in the
       stack (the shipped face for the script) gets the character, as the
       browser would.

       The face is drawn at the size that gives it the original's advance
       (scale, from both families' measured widths): Cousine set at 0.917
       of the size is Consolas's width and nearly its x-height, which a
       squeeze to width alone (Tz) would leave 9% too tall. The fragment
       is still fitted to the browser's width after that. */
    var MONO_STAND_IN = "Cousine";
    // the measured families the standard fonts are metric-identical to
    var STD_METRIC = { Helvetica: "Arial", TimesRoman: "Times New Roman", Courier: "Courier New" };
    function standIn(cp, name, fonts, bold, italic) {
        var key = name.toLowerCase();
        var sub = OfficeFonts.substituteOf ? OfficeFonts.substituteOf(name) : null;
        if (!sub && (GENERICS[key] || (OfficeFonts.kindOf(name) !== "mono" && !OfficeFonts.twinOf(name)) ||
            !haveFamily(name))) return null;
        var sb = !!(sub && sub.heavy);
        var b = bold || sb;
        // the face the screen really drew the family in
        var base = sub && !sub.self ? sub.via : name;
        var kind = (sub && sub.kind) || OfficeFonts.kindOf(base);
        var tries = [];
        if (sub && sub.twin) {
            tries.push({ shipped: sub.via });
        } else {
            if (OfficeFonts.isShipped(base)) tries.push({ shipped: base });
            var std = STD_FAMILIES[String(base).toLowerCase()];
            if (std) tries.push({ std: std });
            var twin = OfficeFonts.twinOf(base);
            if (twin) tries.push({ shipped: twin });
            if (kind === "mono") tries.push({ shipped: MONO_STAND_IN });
        }
        tries.push({ std: { serif: "TimesRoman", mono: "Courier" }[kind] || "Helvetica" });
        for (var i = 0; i < tries.length; i++) {
            var t = tries[i];
            if (t.shipped) {
                var rec = fonts.shipped(t.shipped, b, italic);
                if (!rec) {
                    if (!fonts.tried(t.shipped, b, italic)) return { need: t.shipped, bold: sb };
                    continue;
                }
                if (rec.kit && rec.kit.hasGlyphForCodePoint && !rec.kit.hasGlyphForCodePoint(cp)) continue;
                return scaled({ shipped: t.shipped, bold: sb }, name, sub, t.shipped, b, italic);
            }
            if (winAnsiCp(cp)) return scaled({ std: t.std, bold: sb }, name, sub, STD_METRIC[t.std], b, italic);
        }
        return null;
    }

    // scaled adds the size a stand-in is drawn at to a resolved answer:
    // the width the browser set the family at over the stand-in's own
    var scaleCache = {};
    function scaled(res, name, sub, face, bold, italic) {
        var st = (bold ? 1 : 0) + (italic ? 2 : 0);
        var ck = name + "|" + face + "|" + st;
        if (scaleCache[ck] === undefined) {
            var k = 1;
            if (face) {
                var ratio = function (s) {
                    // the original's measurement; a family that was never
                    // measured was set at its stand-in's width, size-adjusted
                    var want = OfficeFonts.widthOf(name, s) || (sub && !sub.self ?
                        OfficeFonts.widthOf(sub.via, s) * ((sub.adjust && sub.adjust[s]) || 1) : 0);
                    var got = OfficeFonts.widthOf(face, s);
                    return want > 0 && got > 0 ? want / got : 0;
                };
                // a style one side never measured: the regulars' ratio
                k = clamp(ratio(st) || ratio(0) || 1, 0.6, 1.6);
                if (Math.abs(k - 1) < 0.002) k = 1;
            }
            scaleCache[ck] = Math.round(k * 10000) / 10000;
        }
        if (scaleCache[ck] !== 1) res.scale = scaleCache[ck];
        return res;
    }

    /* segmentText cuts a fragment into the pieces that share one font, the
       way a browser does per character. Returns null when any character has
       nowhere to go, which is the signal to rasterize instead; an empty list
       when nothing in it draws anything. */
    function segmentText(text, names, fonts, bold, italic) {
        var segs = [], cur = null;
        for (var i = 0; i < text.length; i++) {
            var cp = text.codePointAt(i);
            var ch = String.fromCodePoint(cp);
            if (ch.length > 1) i++;          // a surrogate pair
            if (ignorableCp(cp)) continue;
            var res = resolveChar(cp, names, fonts, bold, italic);
            if (!res || res.need) return null;
            var key = (res.std ? "s:" + res.std : "f:" + res.shipped) + (res.bold ? ":b" : "") +
                (res.scale ? ":" + res.scale : "");
            if (cur && cur.key === key) cur.text += ch;
            else { cur = { key: key, res: res, text: ch }; segs.push(cur); }
        }
        return segs;
    }

    // faceOf: the font a resolved piece is drawn in, what of its style has
    // to be synthesized (family is the name the page declared it under) and
    // the multiple of the run's size it is drawn at
    function faceOf(res, fonts, bold, italic) {
        bold = bold || !!res.bold;
        var scale = res.scale || 1;
        if (res.std) return { font: fonts.std(res.std, bold, italic), synthBold: false, synthItalic: false, scale: scale };
        var rec = fonts.shipped(res.shipped, bold, italic);
        if (!rec) return null;
        var face = OfficeFonts.faceFor(res.shipped, bold, italic);
        return {
            font: rec.font, synthBold: rec.synthBold, synthItalic: rec.synthItalic,
            family: face ? face.family : res.shipped, scale: scale
        };
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

    /* ---------------- synthetic bold and italic ----------------

       A face the suite ships without a bold (the CJK ones) or an italic is
       emboldened or slanted by the browser, and how much is the browser's
       business: Chrome strokes the outline by 1/24 to 1/32 of the size,
       Firefox smears it sideways, other engines differ again. A fixed
       stroke in the PDF was therefore heavier than the screen in one
       browser and lighter in the next, so the amount is measured rather
       than assumed.

       Bold: the run's text is drawn on a canvas in the weight it asked for
       (which the browser synthesizes exactly as it does on the page) and in
       regular weight filled and stroked with a growing pen - the very thing
       the PDF does with text rendering mode 2 - until the two carry the
       same ink. Both drawings go through the same rasterizer, so its
       anti-aliasing cancels out; in Chrome this lands on Skia's own figure
       to the hundredth of a pixel at every size.

       Italic: the slant moves every bit of ink sideways in proportion to
       its height above the baseline, so the shift of the ink's centre over
       the height of that centre is the slant. A browser that does not
       synthesize at all measures as no stroke and no slant, and the PDF
       follows it. */
    var SYNTH_K = 2;                 // device pixels per css px while measuring
    var synthCache = {};
    var synthCtx = null;
    function synthCanvas(w, h) {
        if (!synthCtx) {
            var c = document.createElement("canvas");
            synthCtx = c.getContext("2d", { willReadFrequently: true });
        }
        var cv = synthCtx.canvas;
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
        return synthCtx;
    }
    function quoteFamily(f) {
        return '"' + String(f).replace(/["\\]/g, "") + '"';
    }
    // skiaBold is Chrome's own figure, used when nothing can be measured
    function skiaBold(size) {
        var t = clamp((size - 9) / 27, 0, 1);
        return size * (1 / 24 + (1 / 32 - 1 / 24) * t);
    }
    function inkStats(g, w, h) {
        var d = g.getImageData(0, 0, w, h).data;
        var sum = 0, sx = 0, sy = 0;
        for (var i = 3, p = 0; i < d.length; i += 4, p++) {
            var a = d[i];
            if (!a) continue;
            sum += a;
            sx += a * (p % w);
            sy += a * ((p / w) | 0);
        }
        return { ink: sum / 255, cx: sum ? sx / sum : 0, cy: sum ? sy / sum : 0 };
    }

    /* synthStyle answers how much the browser emboldens (stroke width, css
       px) and slants (horizontal shift per unit of height) one face at one
       size, for the faces faceFor() says are synthesized. sample is text
       set in that face: what is measured is the same glyphs. */
    function synthStyle(family, weight, italic, sizePx, sample, wantBold, wantItalic) {
        var out = { bold: 0, skew: 0 };
        var text = visibleText(String(sample || "")).replace(/\s+/g, "").substring(0, 12);
        weight = parseInt(weight, 10) || (wantBold ? 700 : 400);
        if (wantBold) out.bold = measureBold(family, weight, italic, sizePx, text);
        if (wantItalic) out.skew = measureSkew(family, weight, text);
        return out;
    }
    function measureBold(family, weight, italic, size, text) {
        var key = "b|" + family + "|" + weight + "|" + (italic ? 1 : 0) + "|" + size.toFixed(2);
        if (synthCache[key] !== undefined) return synthCache[key];
        var w = skiaBold(size);
        try {
            if (!text) throw new Error("nothing to measure");
            var style = italic ? "italic " : "";
            var fam = quoteFamily(family);
            var g = synthCanvas(1, 1);
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.font = style + "400 " + size + "px " + fam;
            var tw = g.measureText(text).width;
            var W = Math.ceil((tw + size * 1.5) * SYNTH_K), H = Math.ceil(size * 2.2 * SYNTH_K);
            // a measurement this large is not worth its cost; Chrome's
            // figure is proportional above 36px, so measure smaller and scale
            var scale = 1;
            if (W * H > 1600000) {
                scale = Math.sqrt(1600000 / (W * H));
                W = Math.ceil(W * scale); H = Math.ceil(H * scale);
            }
            var k = SYNTH_K * scale;
            g = synthCanvas(W, H);
            var draw = function (wt, pen) {
                g.setTransform(1, 0, 0, 1, 0, 0);
                g.clearRect(0, 0, W, H);
                g.setTransform(k, 0, 0, k, 0, 0);
                g.font = style + wt + " " + size + "px " + fam;
                g.fillStyle = "#000";
                g.textBaseline = "alphabetic";
                g.fillText(text, size * 0.5, size * 1.5);
                if (pen > 0) {
                    g.strokeStyle = "#000";
                    g.lineWidth = pen;
                    g.lineJoin = "miter";
                    g.miterLimit = 10;
                    g.strokeText(text, size * 0.5, size * 1.5);
                }
                return inkStats(g, W, H).ink;
            };
            var base = draw(400, 0);
            var target = draw(weight, 0);
            if (!(base > 0)) throw new Error("no ink");
            if (target <= base * 1.002) {
                w = 0;                       // this browser does not embolden
            } else {
                var lo = 0, hi = size / 6;
                for (var it = 0; it < 14; it++) {
                    var mid = (lo + hi) / 2;
                    if (draw(400, mid) < target) lo = mid; else hi = mid;
                }
                w = (lo + hi) / 2;
            }
        } catch (e) { /* keep Chrome's figure */ }
        synthCache[key] = w;
        return w;
    }
    function measureSkew(family, weight, text) {
        var key = "i|" + family + "|" + weight;
        if (synthCache[key] !== undefined) return synthCache[key];
        var s = 0.25;                       // Chrome's and Safari's slant
        try {
            if (!text) throw new Error("nothing to measure");
            var size = 64;
            var fam = quoteFamily(family);
            var g = synthCanvas(1, 1);
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.font = weight + " " + size + "px " + fam;
            var W = Math.ceil(g.measureText(text).width + size * 2), H = Math.ceil(size * 2);
            var baseY = size * 1.4;
            g = synthCanvas(W, H);
            var draw = function (style) {
                g.setTransform(1, 0, 0, 1, 0, 0);
                g.clearRect(0, 0, W, H);
                g.font = style + weight + " " + size + "px " + fam;
                g.fillStyle = "#000";
                g.textBaseline = "alphabetic";
                g.fillText(text, size * 0.5, baseY);
                return inkStats(g, W, H);
            };
            var up = draw(""), it = draw("italic ");
            var rise = baseY - up.cy;
            if (!(up.ink > 0) || !(rise > 1)) throw new Error("no ink");
            s = clamp((it.cx - up.cx) / rise, 0, 0.5);
        } catch (e) { /* keep the usual slant */ }
        synthCache[key] = s;
        return s;
    }

    /* eachTextNode is the walk both the font pre-pass and the run collector
       make, kept in one place so they cannot disagree about what counts as
       text on the slide.

       painted: also hand over text that is only spaces when it sits in an
       inline element with a background - a highlight shows as a box over
       the spaces too (the indent of a highlighted code listing). Only the
       run collector asks for it: there is no character in it to find a
       font for. */
    function eachTextNode(rootEl, fn, painted) {
        var walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
        var node;
        while ((node = walker.nextNode())) {
            var text = node.nodeValue;
            if (!text) continue;
            var parent = node.parentElement;
            if (!parent) continue;
            var blank = !visibleText(text).trim();
            if (blank && !painted) continue;
            var cs = window.getComputedStyle(parent);
            if (blank && (cs.display !== "inline" || !parseFill(cs.backgroundColor))) continue;
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
        if (!this.gsCache[key] && this.p.recordAlpha) {
            // a recording page (pdfdraw.js) makes the state where it is replayed
            this.p.recordAlpha(key, a);
            this.gsCache[key] = true;
        } else if (!this.gsCache[key]) {
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
            // spaces the browser collapsed away paint no highlight either
            if (!visibleText(text).trim()) rects = rects.filter(function (rc) { return rc.width > 0.01; });
            if (!rects.length) return;
            var ls = parseFloat(cs.letterSpacing);
            var shared = {
                origin: origin,
                node: node,
                names: familyList(cs.fontFamily),
                family: cs.fontFamily,
                metrics: fontMetricsOf(cs),
                size: parseFloat(cs.fontSize) || 12,
                weight: parseInt(cs.fontWeight, 10) || (cs.fontWeight === "bold" ? 700 : 400),
                italic: cs.fontStyle === "italic" || cs.fontStyle === "oblique",
                underline: cs.textDecorationLine.indexOf("underline") >= 0,
                strike: cs.textDecorationLine.indexOf("line-through") >= 0,
                transform: cs.textTransform,
                letterSpacing: isFinite(ls) ? ls : 0,
                color: cs.color,
                background: cs.backgroundColor
            };
            splitByLine(node, text, rects).forEach(function (ln) {
                var r = Object.create(shared);
                r.text = ln.text;
                r.rect = ln.rect;
                r.start = ln.start;
                runs.push(r);
            });
        }, true);
        return runs;
    }

    /* splitByLine maps a text node's client rects back onto the substrings
       that produced them, so each line can be drawn at its own baseline.
       Character-by-character is the only reliable way: the browser decides
       where the break went, and only it knows. start is where each line's
       text begins in the node. */
    function splitByLine(node, text, lineRects) {
        if (lineRects.length === 1) {
            return [{ text: text, rect: lineRects[0], start: 0 }];
        }
        var range = document.createRange();
        var out = [];
        var cur = "";
        var curStart = 0;
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
                out.push({ text: cur, rect: curRect, start: curStart });
                cur = text[i];
                curStart = i;
                curTop = top;
                curRect = { left: r.left, top: r.top, bottom: r.bottom, right: r.right };
            }
        }
        if (cur !== "" && curRect) out.push({ text: cur, rect: curRect, start: curStart });
        return out.length ? out : [{ text: text, rect: lineRects[0], start: 0 }];
    }

    // canDrawAsText is the whole fallback decision, in one place: every
    // character of every run has to have a font that can show it
    function canDrawAsText(runs, fonts) {
        for (var i = 0; i < runs.length; i++) {
            var r = runs[i];
            if (!segmentText(transformText(r.text, r.transform), r.names, fonts, r.weight >= 600, r.italic)) return false;
        }
        return true;
    }

    /* planRun decides how one line fragment is drawn: as text wherever a
       font can show it, and as a picture only for the characters nothing
       can (an emoji, a script the suite does not ship). Each piece comes
       back with its place in the line, measured off the DOM, so a picture
       in the middle of a sentence lands between the words around it:
           [{ text, dx, w, fit, raster }]
       dx is from the run's left edge; fit is the width to fit text to.

       Spaces at either end of a piece are left out of it. They draw
       nothing, and the width the browser gave them is not the one a
       stand-in face gives them (Consolas sets a space at 0.55 em,
       Helvetica at 0.28) - so a fragment fitted with them would put its
       ink in the wrong place, and one left unfitted because of them
       ("x := " in a code listing) drifted off its neighbours. The piece is
       the ink alone, at the place and width the browser gave the ink. */
    var EDGE_SPACE = /^\s|\s$/;
    function planRun(r, fonts) {
        var bold = r.weight >= 600;
        var whole = r.rect.right - r.rect.left;
        // where the ink starts and ends in the run: nothing to draw without it
        var inkStart = r.text.search(/\S/);
        if (inkStart < 0) return [];
        var inkEnd = r.text.replace(/\s+$/, "").length;
        var shown = transformText(r.text, r.transform);
        var parts;
        if (segmentText(shown, r.names, fonts, bold, r.italic)) {
            if (!EDGE_SPACE.test(r.text)) return [{ text: shown, dx: 0, w: whole, fit: whole, raster: false }];
            parts = [{ ok: true, start: inkStart, end: inkEnd }];
        } else {
            // cut where drawability changes; a character that draws nothing
            // (a joiner inside an emoji) stays with what is around it
            var cur = null;
            parts = [];
            for (var i = 0; i < r.text.length;) {
                var cp = r.text.codePointAt(i), n = cp > 0xFFFF ? 2 : 1;
                var ok;
                if (ignorableCp(cp)) {
                    ok = cur ? cur.ok : true;
                } else {
                    var shownCp = transformText(String.fromCodePoint(cp), r.transform).codePointAt(0);
                    var res = resolveChar(shownCp, r.names, fonts, bold, r.italic);
                    ok = !!(res && !res.need);
                }
                if (cur && cur.ok === ok) cur.end = i + n;
                else { cur = { ok: ok, start: i, end: i + n }; parts.push(cur); }
                i += n;
            }
        }
        /* Each piece is measured against the whole line at the same moment,
           so the place comes out right even when the page is no longer at
           the zoom it was collected at (Docs hands the page back before it
           writes its display list). A line whose text node has changed
           since cannot be measured: it goes in whole - as text, unfitted,
           when a font can show all of it, else as a picture. */
        var range = document.createRange();
        var now = null;
        try {
            range.setStart(r.node, r.start);
            range.setEnd(r.node, r.start + r.text.length);
            now = range.getBoundingClientRect();
        } catch (e) { now = null; }
        var nodeText = String(r.node.nodeValue || "").substr(r.start, r.text.length)
            .replace(/[\u0000-\u001F\u007F]/g, " ");
        if (!now || !(now.width > 0) || nodeText !== r.text) {
            var drawable = parts.length === 1 && parts[0].ok;
            return [{ text: shown, dx: 0, w: whole, fit: 0, raster: !drawable }];
        }
        var k = whole / now.width;
        var out = [];
        parts.forEach(function (p) {
            var s = p.start, e = p.end;
            if (p.ok) {
                // a text piece is its ink alone (see above)
                while (s < e && /\s/.test(r.text[s])) s++;
                while (e > s && /\s/.test(r.text[e - 1])) e--;
                if (s === e) return;
            }
            var text = r.text.substring(s, e);
            range.setStart(r.node, r.start + s);
            range.setEnd(r.node, r.start + e);
            var b = range.getBoundingClientRect();
            var dx = (b.left - now.left) * k, w = b.width * k;
            if (!(w > 0) && !visibleText(text).trim()) return;
            out.push({ text: transformText(text, r.transform), dx: dx, w: w, fit: w, raster: !p.ok });
        });
        return out;
    }

    /* rasterText draws a piece of a run as a picture of itself, through
       the page's own canvas - which has the page's fonts, so the picture is
       set in the face the screen used, unlike an SVG image of the element.
       Returns { src, x, y, w, h } relative to the piece's left edge and the
       line's top, or null. */
    function rasterText(r, text, w, lineH, baseline) {
        try {
            var pad = Math.ceil(r.size * 0.3);
            var cw = Math.max(1, w) + pad * 2, ch = lineH + pad * 2;
            var k = RASTER_SCALE;
            var c = document.createElement("canvas");
            c.width = Math.ceil(cw * k);
            c.height = Math.ceil(ch * k);
            var g = c.getContext("2d");
            g.scale(k, k);
            g.font = (r.italic ? "italic " : "") + r.weight + " " + r.size + "px " + r.family;
            if (r.letterSpacing && "letterSpacing" in g) g.letterSpacing = r.letterSpacing + "px";
            g.fillStyle = r.color;
            g.textBaseline = "alphabetic";
            g.fillText(text, pad, pad + baseline);
            return { src: c.toDataURL("image/png"), x: -pad, y: -pad, w: cw, h: ch };
        } catch (e) {
            return null;
        }
    }

    /* drawFragment puts one line fragment on the page as real text, in as
       many pieces as it takes fonts to spell it.

       fitPx, when it is given, is the width the browser gave the fragment.
       The text is squeezed or stretched to exactly that with Tz, which
       costs nothing when the PDF font is the one the browser used (the
       ratio is 1) and is what keeps a substituted face - a system font we
       could not embed - from pushing the rest of the line out of place.
       Such a face is first drawn at its own multiple of the size (standIn),
       so what is left for Tz is the difference between two designs.

       Bold that a shipped face does not have is stroked rather than filled,
       and italic it does not have is slanted, both by as much as the
       browser does it (synthStyle). Neither moves the advance widths, so
       the two stay in step.

       letterSpacing (css px) goes in as character spacing, which is how
       CSS adds it too: after every character, the last one included. */
    function drawFragment(pg, spec) {
        var fonts = pg.fonts;
        var segs = segmentText(spec.text, spec.names, fonts, spec.bold, spec.italic);
        if (!segs || !segs.length) return 0;

        var ls = spec.letterSpacing || 0;
        var total = 0;
        for (var i = 0; i < segs.length; i++) {
            var face = faceOf(segs[i].res, fonts, spec.bold, spec.italic);
            if (!face) return 0;
            segs[i].face = face;
            segs[i].size = spec.sizePx * face.scale;
            segs[i].w = face.font.widthOfTextAtSize(segs[i].text, segs[i].size) +
                (ls ? ls * Array.from(segs[i].text).length : 0);
            if (face.synthBold || face.synthItalic) {
                segs[i].synth = synthStyle(face.family, spec.weight || (spec.bold ? 700 : 400), spec.italic,
                    segs[i].size, segs[i].text, face.synthBold, face.synthItalic);
            }
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
            var synth = seg.synth || { bold: 0, skew: 0 };
            if (scale !== 1) ops.push(PDFLib.setCharacterSqueeze(scale * 100));
            if (ls) ops.push(PDFLib.setCharacterSpacing(px(ls)));
            if (synth.bold > 0.01) {
                ops.push(PDFLib.setTextRenderingMode(PDFLib.TextRenderingMode.FillAndOutline));
                ops.push(PDFLib.setLineWidth(px(synth.bold)));
                ops.push(PDFLib.setStrokingColor(col));
            }
            if (ops.length) pg.ops(ops);
            var opt = {
                x: px(cursor), y: pg.y(spec.baselinePx),
                size: px(seg.size), font: seg.face.font, color: col
            };
            // the text matrix's horizontal shear by height (pdf-lib calls
            // that angle ySkew)
            if (synth.skew > 0.001) opt.ySkew = PDFLib.radians(Math.atan(synth.skew));
            pg.p.drawText(seg.text, opt);
            pg.restore();
            cursor += seg.w * scale;
        });
        return total * scale;
    }

    /* drawRuns puts every run on the page at the baseline the browser laid
       it out on, in the width the browser gave it. A character no font can
       show comes in as a picture of itself, in its own place in the line
       (planRun); drawImage(src, x, y, w, h) puts that picture on the page,
       and without it such characters are left out. */
    function drawRuns(pg, runs, drawImage) {
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
            planRun(r, pg.fonts).forEach(function (pc) {
                if (pc.raster) {
                    var pic = drawImage ? rasterText(r, pc.text, pc.w, lineH, baseline) : null;
                    if (pic) drawImage(pic.src, x + pc.dx + pic.x, top + pic.y, pic.w, pic.h);
                    return;
                }
                drawFragment(pg, {
                    text: pc.text, names: r.names,
                    bold: r.weight >= 600, weight: r.weight, italic: r.italic,
                    sizePx: r.size, xPx: x + pc.dx, baselinePx: top + baseline,
                    color: col, fitPx: pc.fit, letterSpacing: r.letterSpacing
                });
            });
            // the browser decorates the whole fragment, spaces included
            if (r.underline || r.strike) {
                var yOff = r.underline ? baseline + r.size * 0.11 : baseline - r.size * 0.28;
                pg.rect(x, top + yOff, domW, Math.max(0.7, r.size * 0.06), { fill: col });
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
    /* ext, when given, is the area to capture relative to the element's own
       box ({ x, y, w, h }, x and y usually <= 0): what overflows the box -
       a table whose rows grew past its frame, text running out of its box -
       is on the slide, so it belongs in the picture too. */
    function rasterizeElement(el, w, h, ext) {
        try {
            var clone = el.cloneNode(true);
            inlineStyles(el, clone);
            ext = ext || { x: 0, y: 0, w: w, h: h };
            // the foreignObject supplies the box, so the clone must not
            // carry the absolute placement it had on the slide
            clone.style.position = "absolute";
            clone.style.left = (-ext.x) + "px";
            clone.style.top = (-ext.y) + "px";
            clone.style.transform = "none";
            clone.style.margin = "0";
            clone.style.width = w + "px";
            clone.style.height = h + "px";

            var cw = Math.max(1, Math.ceil(ext.w)), ch = Math.max(1, Math.ceil(ext.h));
            /* The markup inside a foreignObject has to be well-formed XML,
               and innerHTML is not: it writes <br> unclosed, which makes the
               whole SVG fail to parse and the element vanish from the page.
               XMLSerializer writes real XHTML, so it cannot. */
            var wrap = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
            wrap.setAttribute("style", "position:relative;overflow:hidden;width:" + cw + "px;height:" + ch + "px;");
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

       A deck keeps its large media out of the body as media?file= links,
       so a source that is not a data URL is fetched. Embedding the
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
        ignorableCp: ignorableCp,
        visibleText: visibleText,
        transformText: transformText,
        synthStyle: synthStyle,
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
        planRun: planRun,
        rasterText: rasterText,
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
