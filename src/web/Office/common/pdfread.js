/*
    ArozOS Office - reading a PDF (OfficePdfRead)
    =============================================
    The front half of every "Import PDF": it turns each page of a PDF into
    plain data an app can rebuild a document from - the text as runs of
    glyphs with their font, size, colour and place, the pictures as
    canvases, the vector drawing as shapes. It knows nothing about any app's
    document model; Docs reflows the result into paragraphs
    (docs/docs_pdfimport.js), and Slides could place it on slides.

    The parsing is pdf.js (common/lib/pdfjs, Apache-2.0), loaded on demand
    the first time a PDF is imported - it is several MB and nothing else in
    the suite needs it. Only the parser is used, not its renderer: the
    page's operator list (the content stream pdf.js has already decoded,
    fonts and colour spaces resolved) is walked here with the graphics and
    text state a PDF reader keeps (CTM, text matrix, Tc / Tw / Tz / Ts,
    fill and stroke colour, clip box), so every glyph comes out with its
    real position, size and colour. getTextContent() would be simpler but
    says nothing about colour, and its runs do not line up with the
    drawing operators that carry it.

    Coordinates are PDF points with the origin at the top-left of the page
    (pdf.js' viewport at scale 1), y growing downwards.

        OfficePdfRead.open(bytes, { password: fn(cb) }) -> Promise<doc>
        doc.numPages
        doc.page(n) -> Promise<page>         // n counts from 1
        doc.close()

        page = {
            width, height,                      // pt
            runs:   [{ text, x0, x1, top, bottom, base, size, font, color,
                       invisible, angle, spaceBefore, letterSpacing,
                       vertical }],
            images: [{ x0, y0, x1, y1, canvas() -> Promise<canvas|null>,
                       mask }],
            shapes: [{ x0, y0, x1, y1, fill, stroke, lw, rect, curve,
                       segs: [[x0, y0, x1, y1], ...], alpha }],
            links:  [{ x0, y0, x1, y1, url }],
            render(box, scale) -> Promise<canvas>   // a region, rasterized
            release()
        }

    A run's font is { family, bold, italic, mono, serif, symbol, raw }:
    family is a real family name (subset prefix and style suffix taken
    off, "TimesNewRomanPS-BoldMT" -> "Times New Roman"), or "" when the
    PDF only names it "F1".
*/
(function () {
    "use strict";

    var BASE = (function () {
        var s = document.currentScript && document.currentScript.src;
        return s ? s.replace(/[^\/]*$/, "") : "../common/";
    })();
    var LIB = BASE + "lib/pdfjs/";

    var libPromise = null;
    function loadLib() {
        if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
        if (libPromise) return libPromise;
        libPromise = new Promise(function (resolve, reject) {
            var s = document.createElement("script");
            s.src = LIB + "pdf.js";
            s.onload = function () {
                var lib = window.pdfjsLib;
                if (!lib) { reject(new Error("the PDF reader did not load")); return; }
                lib.GlobalWorkerOptions.workerSrc = LIB + "pdf.worker.js";
                resolve(lib);
            };
            s.onerror = function () {
                libPromise = null;
                reject(new Error("the PDF reader could not be loaded"));
            };
            document.head.appendChild(s);
        });
        return libPromise;
    }

    /* ---------------- matrices (pdf.js / canvas order) ---------------- */
    function mul(m1, m2) {
        return [
            m1[0] * m2[0] + m1[2] * m2[1],
            m1[1] * m2[0] + m1[3] * m2[1],
            m1[0] * m2[2] + m1[2] * m2[3],
            m1[1] * m2[2] + m1[3] * m2[3],
            m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
            m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
        ];
    }
    function apply(m, x, y) {
        return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    }
    function boxOf(pts) {
        var b = [Infinity, Infinity, -Infinity, -Infinity];
        for (var i = 0; i < pts.length; i++) {
            var p = pts[i];
            if (p[0] < b[0]) b[0] = p[0];
            if (p[1] < b[1]) b[1] = p[1];
            if (p[0] > b[2]) b[2] = p[0];
            if (p[1] > b[3]) b[3] = p[1];
        }
        return b;
    }
    function unitBox(m) {
        return boxOf([apply(m, 0, 0), apply(m, 1, 0), apply(m, 0, 1), apply(m, 1, 1)]);
    }
    function intersect(a, b) {
        if (!a) return b;
        if (!b) return a;
        return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
    }
    function emptyBox(b) { return !b || b[2] - b[0] <= 0.01 || b[3] - b[1] <= 0.01; }

    /* ---------------- fonts ---------------- */
    // the families a PDF names most, by their name with the spaces taken out
    var KNOWN = {};
    [
        "Arial", "Arial Narrow", "Arial Black", "Arial Rounded MT Bold", "Calibri", "Calibri Light",
        "Cambria", "Cambria Math", "Candara", "Consolas", "Constantia", "Corbel", "Courier New",
        "Georgia", "Garamond", "Helvetica", "Helvetica Neue", "Segoe UI", "Segoe UI Light",
        "Segoe UI Semibold", "Segoe UI Symbol", "Tahoma", "Times New Roman", "Trebuchet MS",
        "Verdana", "Book Antiqua", "Bookman Old Style", "Century Gothic", "Century Schoolbook",
        "Comic Sans MS", "Franklin Gothic Book", "Franklin Gothic Medium", "Gill Sans",
        "Gill Sans MT", "Lucida Console", "Lucida Sans", "Lucida Sans Unicode", "Palatino Linotype",
        "Palatino", "Impact", "Aptos", "Aptos Display",
        "Microsoft YaHei", "Microsoft JhengHei", "Microsoft JhengHei UI", "SimSun", "SimHei",
        "NSimSun", "KaiTi", "FangSong", "DengXian", "PMingLiU", "MingLiU", "DFKai-SB",
        "MS Gothic", "MS Mincho", "MS PGothic", "MS PMincho", "MS UI Gothic", "Meiryo", "Meiryo UI",
        "Yu Gothic", "Yu Mincho", "Malgun Gothic", "Gulim", "Batang", "Dotum", "Gungsuh",
        "PingFang TC", "PingFang SC", "PingFang HK", "Hiragino Sans", "Heiti TC", "Heiti SC",
        "Noto Sans", "Noto Serif", "Noto Sans Mono", "Noto Sans TC", "Noto Sans SC", "Noto Sans JP",
        "Noto Sans KR", "Noto Serif TC", "Noto Serif SC", "Noto Serif JP", "Noto Serif KR",
        "Roboto", "Roboto Mono", "Open Sans", "Lato", "Montserrat", "Raleway", "Poppins",
        "Source Sans Pro", "Source Serif Pro", "Source Code Pro", "Inter", "Ubuntu",
        "Liberation Sans", "Liberation Serif", "Liberation Mono", "DejaVu Sans", "DejaVu Serif",
        "DejaVu Sans Mono", "Carlito", "Caladea", "Symbol", "Wingdings", "Webdings"
    ].forEach(function (f) { KNOWN[f.toLowerCase().replace(/[^a-z0-9]/g, "")] = f; });
    // names a PDF uses for a family it is not called by
    var ALIAS = {
        "timesroman": "Times New Roman", "times": "Times New Roman", "timesnewromanps": "Times New Roman",
        "courier": "Courier New", "couriernewps": "Courier New", "arialunicodems": "Arial",
        "arialmt": "Arial", "helveticaneuelt": "Helvetica Neue",
        "notosanscjktc": "Noto Sans TC", "notosanscjksc": "Noto Sans SC", "notosanscjkjp": "Noto Sans JP",
        "notosanscjkkr": "Noto Sans KR", "notosanscjkhk": "Noto Sans TC",
        "notoserifcjktc": "Noto Serif TC", "notoserifcjksc": "Noto Serif SC",
        "notoserifcjkjp": "Noto Serif JP", "notoserifcjkkr": "Noto Serif KR",
        "sourcehansanstc": "Noto Sans TC", "sourcehansanssc": "Noto Sans SC",
        "sourcehansansjp": "Noto Sans JP", "sourcehansanskr": "Noto Sans KR",
        "sourcehansans": "Noto Sans JP", "sourcehanserif": "Noto Serif JP",
        "msgothic": "MS Gothic", "msmincho": "MS Mincho", "mspgothic": "MS PGothic",
        "mspmincho": "MS PMincho", "dfkaisb": "DFKai-SB", "dfkaishusbestdbf": "DFKai-SB",
        "stsong": "SimSun", "stheiti": "SimHei", "zapfdingbats": "ZapfDingbats",
        "zapfdingbatsitc": "ZapfDingbats"
    };
    var STYLE_WORD = /^(bold|italic|oblique|regular|roman|light|medium|semibold|semi|demibold|demi|black|heavy|thin|extralight|ultralight|extrabold|ultrabold|book|normal|condensed|cond|narrow|it|bd|bi|w\d|mt|psmt|ps|std|pro|lt)+$/i;

    // "ABCDEF+TimesNewRomanPS-BoldItalicMT" -> { base: "Times New Roman", style: "BoldItalic" }
    function splitFontName(raw) {
        var n = String(raw || "");
        // a name stated in UTF-8 reaches us as its bytes
        if (/[\u0080-\u00FF]/.test(n) && !/[\u0100-\uFFFF]/.test(n)) {
            try { n = decodeURIComponent(escape(n)); } catch (e) { /* keep it */ }
        }
        n = n.replace(/^[A-Z]{6}\+/, "");
        var style = "";
        var comma = n.indexOf(",");
        if (comma > 0) {
            style = n.substring(comma + 1);
            n = n.substring(0, comma);
        } else {
            var dash = n.lastIndexOf("-");
            if (dash > 0 && STYLE_WORD.test(n.substring(dash + 1))) {
                style = n.substring(dash + 1);
                n = n.substring(0, dash);
            }
        }
        // TrueType's PostScript decorations
        n = n.replace(/(PSMT|PS|MT)$/, "");
        // a style glued on without a dash ("ArialBold")
        var glued = n.match(/^(.*[a-z])((?:Bold|Italic|Oblique|Regular|Light|Medium|Semibold|SemiBold|Black)+)$/);
        if (glued) {
            n = glued[1];
            style = glued[2] + style;
        }
        return { base: n, style: style };
    }

    function familyOf(raw, info) {
        var parts = splitFontName(raw);
        var key = parts.base.toLowerCase().replace(/[^a-z0-9]/g, "");
        var fam = KNOWN[key] || ALIAS[key] || "";
        if (!fam && /^(notosanscjk|sourcehansans)/.test(key)) fam = "Noto Sans TC";
        if (!fam) {
            // a PDF that only says "F1" or "T1_0" names no family at all
            var junk = !parts.base || /^(cidfont\+)?(f|t|tt|c|font|ff)?[\d_]*$/i.test(parts.base) ||
                !/[A-Za-z]{3}/.test(parts.base);
            if (!junk) {
                fam = parts.base.replace(/[_-]+/g, " ")
                    .replace(/([a-z])([A-Z])/g, "$1 $2")
                    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
                    .replace(/\s+/g, " ").trim();
            }
        }
        // Word's own light families
        if (/light/i.test(parts.style) && (fam === "Calibri" || fam === "Segoe UI")) fam += " Light";
        return { family: fam, style: parts.style };
    }

    function fontInfo(f) {
        var raw = (f && f.name) || "";
        var fam = familyOf(raw);
        var all = raw + " " + fam.style;
        var bold = !!(f && (f.bold || f.black)) ||
            /bold|black|heavy|demi|semibold|extrabold|ultrabold|w[6-9](?![0-9])/i.test(fam.style || raw.replace(/^[A-Z]{6}\+/, ""));
        var italic = !!(f && f.italic) || /italic|oblique|kursiv/i.test(all) || /-It$|-BoldIt$/.test(raw);
        // fonts whose letters are pictures (Symbol itself is mapped to real
        // Greek and maths by pdf.js already)
        var symbol = /dingbat|wingding|webding|marlett/i.test(raw);
        var asc = f && typeof f.ascent === "number" ? f.ascent : 0.85;
        var desc = f && typeof f.descent === "number" ? -f.descent : 0.2;
        if (!(asc > 0.4 && asc < 1.4)) asc = 0.85;
        if (!(desc >= 0 && desc < 0.6)) desc = 0.2;
        return {
            family: fam.family,
            bold: bold,
            italic: italic,
            mono: !!(f && f.isMonospace) || /courier|consolas|mono|menlo|monaco|inconsolata|lucida ?console|code/i.test(raw),
            serif: !!(f && f.isSerifFont),
            symbol: symbol,
            raw: raw,
            asc: asc,
            desc: desc
        };
    }

    /* Symbol fonts (Wingdings, Symbol) put a bullet where a letter or a
       private-use code point would be; the reflowed text wants the bullet
       itself, in a character every font has. */
    var SYMBOL_CHARS = {
        0x6C: 0x25CF, 0x6E: 0x25A0, 0x6F: 0x25A1, 0x71: 0x2751, 0x75: 0x25C6, 0x76: 0x2756,
        0xA7: 0x25AA, 0xA8: 0x25A1, 0xB7: 0x2022, 0xD8: 0x27A2, 0xE0: 0x27A2, 0xE8: 0x2794,
        0xF0: 0x21E8, 0xFC: 0x2713, 0xFB: 0x2717, 0xFE: 0x2611, 0x9F: 0x2022
    };
    var BULLET = 0x2022;
    function cleanText(s, info) {
        if (!s) return "";
        var out = "";
        for (var i = 0; i < s.length; i++) {
            var c = s.charCodeAt(i);
            if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
                out += s.charAt(i) + s.charAt(i + 1);
                i++;
                continue;
            }
            // a symbol font's code points, moved into the private use area
            var pua = c >= 0xF000 && c <= 0xF0FF;
            if (pua) c -= 0xF000;
            if (info.symbol || pua) {
                if (c === 0x20) { out += " "; continue; }
                out += String.fromCharCode(SYMBOL_CHARS[c] || BULLET);
                continue;
            }
            if (c < 0x20 || (c >= 0x7F && c < 0xA0) || c === 0xAD) continue;
            if (c >= 0xE000 && c <= 0xF8FF) { out += String.fromCharCode(BULLET); continue; }
            if (c >= 0xFB00 && c <= 0xFB06) {
                var ch = String.fromCharCode(c);
                out += ch.normalize ? ch.normalize("NFKC") : ch;
                continue;
            }
            out += String.fromCharCode(c);
        }
        return out;
    }

    /* ---------------- images ---------------- */
    function imageDataCanvas(img, maskColor) {
        if (!img) return null;
        var w = img.width, h = img.height;
        if (!(w > 0 && h > 0) || w * h > 40000000) return null;
        var cv = document.createElement("canvas");
        cv.width = w;
        cv.height = h;
        var ctx = cv.getContext("2d");
        // a decoded bitmap (newer pdf.js) draws as it is
        if (!img.data || (typeof HTMLElement === "function" && img instanceof HTMLElement) ||
            (typeof ImageBitmap === "function" && img instanceof ImageBitmap)) {
            try { ctx.drawImage(img.bitmap || img, 0, 0); return cv; } catch (e) { return null; }
        }
        var out = ctx.createImageData(w, h);
        var d = out.data, src = img.data;
        var x, y, p, s;
        if (maskColor) {
            // a stencil: a clear bit is painted in the fill colour
            var rowBytes = (w + 7) >> 3;
            for (y = 0; y < h; y++) {
                for (x = 0; x < w; x++) {
                    var on = !(src[y * rowBytes + (x >> 3)] & (128 >> (x & 7)));
                    p = (y * w + x) * 4;
                    d[p] = maskColor[0]; d[p + 1] = maskColor[1]; d[p + 2] = maskColor[2];
                    d[p + 3] = on ? 255 : 0;
                }
            }
        } else if (img.kind === 1) {
            var rb = (w + 7) >> 3;
            for (y = 0; y < h; y++) {
                for (x = 0; x < w; x++) {
                    var v = (src[y * rb + (x >> 3)] & (128 >> (x & 7))) ? 255 : 0;
                    p = (y * w + x) * 4;
                    d[p] = d[p + 1] = d[p + 2] = v;
                    d[p + 3] = 255;
                }
            }
        } else if (img.kind === 2) {
            for (p = 0, s = 0; p < d.length; p += 4, s += 3) {
                d[p] = src[s]; d[p + 1] = src[s + 1]; d[p + 2] = src[s + 2]; d[p + 3] = 255;
            }
        } else {
            d.set(src.subarray ? src.subarray(0, d.length) : src);
        }
        ctx.putImageData(out, 0, 0);
        // whether the picture has any transparency, which decides how it is
        // stored: an opaque one can be a JPEG
        var opaque = !maskColor;
        if (opaque && img.kind !== 1 && img.kind !== 2) {
            for (p = 3; p < d.length; p += 4) if (d[p] < 255) { opaque = false; break; }
        }
        cv._opaque = opaque;
        return cv;
    }

    /* The picture as it shows on the page: drawn through its own matrix
       (so a rotated or mirrored image comes out as it looks) and cut to
       the clip box, at about its own resolution. */
    function placedCanvas(src, rec) {
        var vis = rec.vis;
        var M = rec.m;
        var w = rec.sub ? rec.sub[2] : src.width, h = rec.sub ? rec.sub[3] : src.height;
        var dx = Math.hypot(M[0], M[1]) || 1, dy = Math.hypot(M[2], M[3]) || 1;
        var density = Math.max(w / dx, h / dy);
        // never above the picture's own resolution, nor past 216 dpi
        density = Math.max(1, Math.min(3, density));
        var bw = vis[2] - vis[0], bh = vis[3] - vis[1];
        var maxSide = 4096;
        if (bw * density > maxSide) density = maxSide / bw;
        if (bh * density > maxSide) density = maxSide / bh;
        var cw = Math.max(1, Math.round(bw * density)), ch = Math.max(1, Math.round(bh * density));
        var cv = document.createElement("canvas");
        cv.width = cw;
        cv.height = ch;
        var ctx = cv.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        try { ctx.imageSmoothingQuality = "high"; } catch (e) { }
        // an opaque picture on white, so its resampled edge stays opaque too
        if (src._opaque) {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, cw, ch);
            cv._opaque = true;
        }
        ctx.setTransform(density, 0, 0, density, -vis[0] * density, -vis[1] * density);
        ctx.transform(M[0], M[1], M[2], M[3], M[4], M[5]);
        ctx.transform(1 / w, 0, 0, -1 / h, 0, 1);
        if (rec.sub) ctx.drawImage(src, rec.sub[0], rec.sub[1], w, h, 0, 0, w, h);
        else ctx.drawImage(src, 0, 0);
        return cv;
    }

    function objOf(page, id) {
        return new Promise(function (resolve) {
            var store = String(id).indexOf("g_") === 0 ? page.commonObjs : page.objs;
            var done = false;
            var t = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 8000);
            try {
                store.get(id, function (data) {
                    if (done) return;
                    done = true;
                    clearTimeout(t);
                    resolve(data);
                });
            } catch (e) {
                clearTimeout(t);
                resolve(null);
            }
        });
    }

    /* ---------------- the operator list ---------------- */
    function State() {
        this.ctm = [1, 0, 0, 1, 0, 0];
        this.fill = [0, 0, 0];
        this.stroke = [0, 0, 0];
        this.fillPattern = false;
        this.fillAlpha = 1;
        this.strokeAlpha = 1;
        this.lineWidth = 1;
        this.clip = null;
        this.font = null;
        this.fontRef = null;
        this.fontSize = 0;
        this.fontDirection = 1;
        this.charSpacing = 0;
        this.wordSpacing = 0;
        this.hScale = 1;
        this.leading = 0;
        this.rise = 0;
        this.render = 0;
        this.tm = [1, 0, 0, 1, 0, 0];
        this.x = 0; this.y = 0; this.lineX = 0; this.lineY = 0;
    }
    State.prototype.clone = function () {
        var s = new State();
        for (var k in this) {
            if (!Object.prototype.hasOwnProperty.call(this, k)) continue;
            var v = this[k];
            s[k] = Array.isArray(v) ? v.slice() : v;
        }
        return s;
    };

    var MAX_SHAPES = 30000;
    var MAX_RUNS = 60000;

    function interpret(lib, page, opList, viewport) {
        var OPS = lib.OPS;
        var st = new State();
        st.ctm = viewport.transform.slice();
        var stack = [];
        var runs = [], images = [], shapes = [];
        var fontCache = {};
        // where the last space glyph ended: a writer that draws each word
        // (or a picture of a character) by itself draws the space between
        // them as text of its own, and the next thing drawn is after a space
        var lastSpace = null;
        function afterSpace(x, y, size) {
            var s = lastSpace;
            if (!s) return false;
            lastSpace = null;
            return x - s.x > -s.size * 0.3 && x - s.x < s.size * 0.8 && Math.abs(y - s.y) < Math.max(s.size, size) * 0.6;
        }
        var path = [];         // [{pts, closed, rect, curve}]
        var pendingClip = false;
        var skipDepth = 0;     // inside an annotation's appearance

        // keyed by the font's own reference: pdf.js gives every font it draws
        // with one system face (Helvetica and Helvetica-Bold alike) the same
        // loadedName
        function info(f, ref) {
            if (!ref) return fontInfo(f);
            if (!fontCache[ref]) fontCache[ref] = fontInfo(f);
            return fontCache[ref];
        }
        function setFont(name, size) {
            var f = null;
            try { f = page.commonObjs.get(name); } catch (e) { f = null; }
            st.font = f;
            st.fontRef = name;
            if (size < 0) { size = -size; st.fontDirection = -1; } else st.fontDirection = 1;
            st.fontSize = size;
        }
        function moveText(x, y) {
            st.x = st.lineX += x;
            st.y = st.lineY += y;
        }

        function showText(glyphs) {
            var font = st.font;
            if (!font || !st.fontSize || !glyphs) return;
            var fi = info(font, st.fontRef);
            var size = st.fontSize;
            var fm = font.fontMatrix || [0.001, 0, 0, 0.001, 0, 0];
            var type3 = !!font.isType3Font;
            var vertical = !!font.vertical;
            var Th = st.hScale * st.fontDirection;
            var spacingDir = vertical ? 1 : -1;
            var M = mul(st.ctm, st.tm);
            var sizeDev = size * Math.hypot(M[2], M[3]);
            var xv = Math.hypot(M[0], M[1]) || 1;
            var angle = Math.atan2(M[1], M[0] * (st.fontDirection < 0 ? -1 : 1)) * 180 / Math.PI;
            var mode = st.render & 3;
            var invisible = mode === 3 || (mode !== 1 && st.fillAlpha === 0);
            var color = (mode === 1) ? st.stroke : (st.fillPattern ? [0, 0, 0] : st.fill);
            var em = size;   // text space units per em
            var x = 0;
            var cur = null;
            var breakPending = false, spaceSeen = false;

            function close() {
                if (!cur) return;
                var c = st.clip;
                // text a clip box hides is not on the page
                var hidden = c && (cur.x1 < c[0] - 1 || cur.x0 > c[2] + 1 || cur.bottom < c[1] - 1 || cur.top > c[3] + 1);
                if (cur.text && !hidden && runs.length < MAX_RUNS) runs.push(cur);
                cur = null;
            }
            for (var i = 0; i < glyphs.length; i++) {
                var g = glyphs[i];
                if (typeof g === "number") {
                    var adv = spacingDir * g * size / 1000;
                    x += adv;
                    // a kerning offset wider than a thin space is a word gap
                    if (adv > em * 0.18) breakPending = true;
                    else if (adv < -em * 0.5) breakPending = true;
                    continue;
                }
                if (!g) continue;
                var spacing = (g.isSpace ? st.wordSpacing : 0) + st.charSpacing;
                var w = g.width || 0;
                var gw;
                if (type3) gw = (w * fm[0] + 0 * fm[2]) * size;
                else gw = w * size * fm[0];
                if (vertical) {
                    var vm = g.vmetric || font.defaultVMetrics;
                    gw = vm ? -vm[0] * size * fm[0] : gw;
                }
                var tx = st.x + x * Th, ty = st.y + st.rise;
                var text = g.unicode || "";
                var isSpace = g.isSpace || text === " " || text === "\u00A0" || text === "\u3000";
                if (isSpace) {
                    breakPending = true;
                    spaceSeen = true;
                    if (!vertical) {
                        var se = apply(M, tx + gw * Th, ty);
                        lastSpace = { x: se[0], y: se[1], size: sizeDev };
                    }
                } else {
                    var t = cleanText(text, fi);
                    if (t) {
                        var o = vertical ? apply(M, tx, st.y - x) : apply(M, tx, ty);
                        var e = vertical ? o : apply(M, tx + gw * Th, ty);
                        if (cur && breakPending) close();
                        if (!cur) {
                            if (afterSpace(o[0], o[1], sizeDev)) spaceSeen = true;
                            cur = {
                                text: "", x0: o[0], x1: e[0], base: o[1], size: sizeDev,
                                top: o[1] - fi.asc * sizeDev, bottom: o[1] + fi.desc * sizeDev,
                                font: fi, color: color.slice(0, 3), invisible: invisible,
                                angle: angle, spaceBefore: spaceSeen, vertical: vertical,
                                letterSpacing: Math.abs(st.charSpacing * xv) > sizeDev * 0.08 ? st.charSpacing * xv : 0,
                                fakeBold: (st.render & 3) === 2
                            };
                        }
                        cur.text += t;
                        if (vertical) {
                            cur.x0 = Math.min(cur.x0, o[0] - sizeDev / 2);
                            cur.x1 = Math.max(cur.x1, o[0] + sizeDev / 2);
                            cur.bottom = Math.max(cur.bottom, o[1] + sizeDev);
                        } else {
                            cur.x0 = Math.min(cur.x0, o[0], e[0]);
                            cur.x1 = Math.max(cur.x1, o[0], e[0]);
                        }
                        breakPending = false;
                        spaceSeen = false;
                    }
                }
                var charW;
                if (type3) charW = gw + spacing;
                else if (vertical) charW = gw - spacing * st.fontDirection;
                else charW = gw + spacing * st.fontDirection;
                x += charW;
            }
            close();
            if (vertical) st.y -= x;
            else st.x += x * Th;
        }

        function addPath(ops, args) {
            var j = 0, sub = null;
            function point(px, py) { return apply(st.ctm, px, py); }
            for (var k = 0; k < ops.length; k++) {
                switch (ops[k]) {
                    case OPS.rectangle:
                        var rx = args[j++], ry = args[j++], rw = args[j++], rh = args[j++];
                        var axis = Math.abs(st.ctm[1]) < 1e-6 && Math.abs(st.ctm[2]) < 1e-6;
                        path.push({
                            pts: [point(rx, ry), point(rx + rw, ry), point(rx + rw, ry + rh), point(rx, ry + rh)],
                            closed: true, rect: axis, curve: false
                        });
                        sub = null;
                        break;
                    case OPS.moveTo:
                        sub = { pts: [point(args[j], args[j + 1])], closed: false, rect: false, curve: false };
                        path.push(sub);
                        j += 2;
                        break;
                    case OPS.lineTo:
                        if (!sub) { sub = { pts: [], closed: false, rect: false, curve: false }; path.push(sub); }
                        sub.pts.push(point(args[j], args[j + 1]));
                        j += 2;
                        break;
                    case OPS.curveTo:
                        if (!sub) { sub = { pts: [], closed: false, rect: false, curve: false }; path.push(sub); }
                        sub.pts.push(point(args[j], args[j + 1]), point(args[j + 2], args[j + 3]), point(args[j + 4], args[j + 5]));
                        sub.curve = true;
                        j += 6;
                        break;
                    case OPS.curveTo2:
                    case OPS.curveTo3:
                        if (!sub) { sub = { pts: [], closed: false, rect: false, curve: false }; path.push(sub); }
                        sub.pts.push(point(args[j], args[j + 1]), point(args[j + 2], args[j + 3]));
                        sub.curve = true;
                        j += 4;
                        break;
                    case OPS.closePath:
                        if (sub) sub.closed = true;
                        break;
                }
            }
        }

        // what a painted path looks like, for the importer's purposes
        function paint(kind) {
            var p = path;
            path = [];
            var all = [];
            var curve = false;
            p.forEach(function (s) {
                all = all.concat(s.pts);
                if (s.curve) curve = true;
            });
            if (pendingClip) {
                if (all.length) st.clip = intersect(st.clip, boxOf(all));
                pendingClip = false;
            }
            if (!kind || !all.length || skipDepth > 0 || shapes.length >= MAX_SHAPES) return;
            var b = boxOf(all);
            var vis = intersect(b, st.clip);
            // (a rule is a box with no height, which still shows)
            if (vis[2] < vis[0] || vis[3] < vis[1]) return;
            var scale = (Math.hypot(st.ctm[0], st.ctm[1]) + Math.hypot(st.ctm[2], st.ctm[3])) / 2;
            var lw = Math.max(0.25, st.lineWidth * scale);
            var segs = null;
            if (!curve && all.length <= 64) {
                segs = [];
                p.forEach(function (s) {
                    for (var i = 1; i < s.pts.length; i++) {
                        segs.push([s.pts[i - 1][0], s.pts[i - 1][1], s.pts[i][0], s.pts[i][1]]);
                    }
                    if (s.closed && s.pts.length > 2) {
                        segs.push([s.pts[s.pts.length - 1][0], s.pts[s.pts.length - 1][1], s.pts[0][0], s.pts[0][1]]);
                    }
                });
            }
            var oneRect = p.length === 1 && p[0].rect;
            if (!oneRect && p.length === 1 && !curve && p[0].pts.length >= 4 && p[0].pts.length <= 5) {
                // a rectangle drawn as four lines
                var q = p[0].pts;
                if (q.length === 5 && Math.abs(q[4][0] - q[0][0]) < 0.01 && Math.abs(q[4][1] - q[0][1]) < 0.01) q = q.slice(0, 4);
                if (q.length === 4) {
                    var ok = true;
                    for (var i = 0; i < 4; i++) {
                        var a = q[i], c = q[(i + 1) % 4];
                        if (Math.abs(a[0] - c[0]) > 0.05 && Math.abs(a[1] - c[1]) > 0.05) ok = false;
                    }
                    oneRect = ok;
                }
            }
            shapes.push({
                x0: vis[0], y0: vis[1], x1: vis[2], y1: vis[3],
                fill: (kind === "F" || kind === "B") ? (st.fillPattern ? "pattern" : st.fill.slice(0, 3)) : null,
                stroke: (kind === "S" || kind === "B") ? st.stroke.slice(0, 3) : null,
                lw: lw,
                alpha: kind === "S" ? st.strokeAlpha : st.fillAlpha,
                rect: !!oneRect,
                curve: curve,
                count: all.length,
                segs: segs
            });
        }

        function addImage(rec) {
            if (skipDepth > 0) return;
            var b = unitBox(rec.m);
            var vis = intersect(b, st.clip);
            if (emptyBox(vis)) return;
            rec.vis = vis;
            // a picture standing in for a character after a space (its
            // baseline is near its bottom)
            rec.spaceBefore = afterSpace(b[0], b[3], b[3] - b[1]);
            images.push(rec);
        }

        var fnArray = opList.fnArray, argsArray = opList.argsArray;
        for (var i = 0; i < fnArray.length; i++) {
            var fn = fnArray[i], args = argsArray[i];
            switch (fn) {
                case OPS.beginAnnotation: skipDepth++; break;
                case OPS.endAnnotation: if (skipDepth > 0) skipDepth--; break;
                case OPS.save: stack.push(st); st = st.clone(); break;
                case OPS.restore: if (stack.length) st = stack.pop(); break;
                case OPS.transform: st.ctm = mul(st.ctm, args); break;
                case OPS.setLineWidth: st.lineWidth = args[0]; break;
                case OPS.setGState:
                    (args[0] || []).forEach(function (kv) {
                        if (!kv) return;
                        if (kv[0] === "LW") st.lineWidth = kv[1];
                        else if (kv[0] === "Font" && kv[1]) setFont(kv[1][0], kv[1][1]);
                        else if (kv[0] === "ca") st.fillAlpha = kv[1];
                        else if (kv[0] === "CA") st.strokeAlpha = kv[1];
                    });
                    break;
                case OPS.setFillRGBColor: st.fill = [args[0], args[1], args[2]]; st.fillPattern = false; break;
                case OPS.setStrokeRGBColor: st.stroke = [args[0], args[1], args[2]]; break;
                case OPS.setFillColorN: st.fillPattern = true; break;
                case OPS.beginText:
                    st.tm = [1, 0, 0, 1, 0, 0];
                    st.x = st.y = st.lineX = st.lineY = 0;
                    break;
                case OPS.setCharSpacing: st.charSpacing = args[0]; break;
                case OPS.setWordSpacing: st.wordSpacing = args[0]; break;
                case OPS.setHScale: st.hScale = args[0] / 100; break;
                case OPS.setLeading: st.leading = -args[0]; break;
                case OPS.setFont: setFont(args[0], args[1]); break;
                case OPS.setTextRenderingMode: st.render = args[0]; break;
                case OPS.setTextRise: st.rise = args[0]; break;
                case OPS.moveText: moveText(args[0], args[1]); break;
                case OPS.setLeadingMoveText: st.leading = args[1]; moveText(args[0], args[1]); break;
                case OPS.setTextMatrix:
                    st.tm = [args[0], args[1], args[2], args[3], args[4], args[5]];
                    st.x = st.y = st.lineX = st.lineY = 0;
                    break;
                case OPS.nextLine: moveText(0, st.leading); break;
                case OPS.showText:
                case OPS.showSpacedText:
                    if (!skipDepth) showText(args[0]);
                    break;
                case OPS.nextLineShowText:
                    moveText(0, st.leading);
                    if (!skipDepth) showText(args[0]);
                    break;
                case OPS.nextLineSetSpacingShowText:
                    st.wordSpacing = args[0];
                    st.charSpacing = args[1];
                    moveText(0, st.leading);
                    if (!skipDepth) showText(args[2]);
                    break;
                case OPS.constructPath: addPath(args[0], args[1]); break;
                case OPS.clip:
                case OPS.eoClip: pendingClip = true; break;
                case OPS.stroke:
                case OPS.closeStroke: paint("S"); break;
                case OPS.fill:
                case OPS.eoFill: paint("F"); break;
                case OPS.fillStroke:
                case OPS.eoFillStroke:
                case OPS.closeFillStroke:
                case OPS.closeEOFillStroke: paint("B"); break;
                case OPS.endPath: paint(null); break;
                case OPS.shadingFill:
                    if (st.clip && !skipDepth && shapes.length < MAX_SHAPES) {
                        shapes.push({
                            x0: st.clip[0], y0: st.clip[1], x1: st.clip[2], y1: st.clip[3],
                            fill: "pattern", stroke: null, lw: 0, alpha: st.fillAlpha,
                            rect: false, curve: true, count: 8, segs: null
                        });
                    }
                    break;
                case OPS.paintFormXObjectBegin:
                    stack.push(st);
                    st = st.clone();
                    if (Array.isArray(args[0]) && args[0].length === 6) st.ctm = mul(st.ctm, args[0]);
                    if (Array.isArray(args[1]) && args[1].length === 4) {
                        var bb = args[1];
                        st.clip = intersect(st.clip, boxOf([apply(st.ctm, bb[0], bb[1]), apply(st.ctm, bb[2], bb[1]),
                            apply(st.ctm, bb[0], bb[3]), apply(st.ctm, bb[2], bb[3])]));
                    }
                    break;
                case OPS.paintFormXObjectEnd: if (stack.length) st = stack.pop(); break;
                case OPS.beginGroup: stack.push(st); st = st.clone(); break;
                case OPS.endGroup: if (stack.length) st = stack.pop(); break;
                case OPS.paintImageXObject:
                    addImage({ id: args[0], m: st.ctm.slice(), clip: st.clip });
                    break;
                case OPS.paintImageXObjectRepeat:
                    for (var r = 0; r + 1 < (args[3] || []).length; r += 2) {
                        addImage({ id: args[0], m: mul(st.ctm, [args[1], 0, 0, args[2], args[3][r], args[3][r + 1]]) });
                    }
                    break;
                case OPS.paintInlineImageXObject:
                    addImage({ data: args[0], m: st.ctm.slice() });
                    break;
                case OPS.paintInlineImageXObjectGroup:
                    (args[1] || []).forEach(function (en) {
                        addImage({ data: args[0], m: mul(st.ctm, en.transform), sub: [en.x, en.y, en.w, en.h] });
                    });
                    break;
                case OPS.paintImageMaskXObject:
                    addImage({ data: args[0], m: st.ctm.slice(), mask: st.fill.slice(0, 3) });
                    break;
                case OPS.paintImageMaskXObjectGroup:
                    (args[0] || []).forEach(function (im) {
                        addImage({ data: im, m: mul(st.ctm, im.transform), mask: st.fill.slice(0, 3) });
                    });
                    break;
                case OPS.paintImageMaskXObjectRepeat:
                    var pos = args[5] || [];
                    for (var q = 0; q + 1 < pos.length; q += 2) {
                        addImage({
                            data: args[0], mask: st.fill.slice(0, 3),
                            m: mul(st.ctm, [args[1], args[2] || 0, args[3] || 0, args[4], pos[q], pos[q + 1]])
                        });
                    }
                    break;
                case OPS.paintSolidColorImageMask:
                    path = [{
                        pts: [apply(st.ctm, 0, 0), apply(st.ctm, 1, 0), apply(st.ctm, 1, 1), apply(st.ctm, 0, 1)],
                        closed: true, rect: true, curve: false
                    }];
                    paint("F");
                    break;
            }
        }
        return { runs: runs, images: images, shapes: shapes };
    }

    /* ---------------- documents and pages ---------------- */
    /* pdf.js hands a font to the page only once the browser has loaded its
       face, which can be after the operator list has arrived; the walk
       needs every font the page sets, or their text would be lost */
    function fontsReady(lib, page, opList) {
        var OPS = lib.OPS;
        var names = {};
        var fnArray = opList.fnArray, argsArray = opList.argsArray;
        for (var i = 0; i < fnArray.length; i++) {
            if (fnArray[i] === OPS.setFont) {
                names[argsArray[i][0]] = true;
            } else if (fnArray[i] === OPS.setGState) {
                (argsArray[i][0] || []).forEach(function (kv) {
                    if (kv && kv[0] === "Font" && kv[1]) names[kv[1][0]] = true;
                });
            }
        }
        return Promise.all(Object.keys(names).map(function (id) {
            return new Promise(function (resolve) {
                var done = false;
                var t = setTimeout(function () { if (!done) { done = true; resolve(); } }, 10000);
                try {
                    page.commonObjs.get(id, function () {
                        if (done) return;
                        done = true;
                        clearTimeout(t);
                        resolve();
                    });
                } catch (e) {
                    clearTimeout(t);
                    resolve();
                }
            });
        }));
    }

    function readPage(lib, pdf, n) {
        return pdf.getPage(n).then(function (page) {
            var vp = page.getViewport({ scale: 1 });
            return Promise.all([
                page.getOperatorList(),
                page.getAnnotations().catch(function () { return []; })
            ]).then(function (res) {
                return fontsReady(lib, page, res[0]).then(function () { return res; });
            }).then(function (res) {
                var parsed = interpret(lib, page, res[0], vp);
                var links = [];
                (res[1] || []).forEach(function (a) {
                    if (!a || a.subtype !== "Link" || !a.rect || !/^(https?:|mailto:)/i.test(a.url || "")) return;
                    var r = vp.convertToViewportRectangle(a.rect);
                    links.push({
                        x0: Math.min(r[0], r[2]), y0: Math.min(r[1], r[3]),
                        x1: Math.max(r[0], r[2]), y1: Math.max(r[1], r[3]), url: a.url
                    });
                });
                var images = parsed.images.map(function (rec) {
                    return {
                        x0: rec.vis[0], y0: rec.vis[1], x1: rec.vis[2], y1: rec.vis[3],
                        mask: !!rec.mask,
                        spaceBefore: !!rec.spaceBefore,
                        canvas: function () {
                            var get = rec.data ? Promise.resolve(rec.data) : objOf(page, rec.id);
                            return get.then(function (img) {
                                var src = imageDataCanvas(img, rec.mask);
                                return src ? placedCanvas(src, rec) : null;
                            }).catch(function () { return null; });
                        }
                    };
                });
                return {
                    number: n,
                    width: vp.width,
                    height: vp.height,
                    runs: parsed.runs,
                    images: images,
                    shapes: parsed.shapes,
                    links: links,
                    // a region of the page as the PDF draws it
                    render: function (box, scale) {
                        scale = scale || 2;
                        var bw = Math.max(1, box[2] - box[0]), bh = Math.max(1, box[3] - box[1]);
                        var cv = document.createElement("canvas");
                        cv.width = Math.max(1, Math.round(bw * scale));
                        cv.height = Math.max(1, Math.round(bh * scale));
                        var ctx = cv.getContext("2d");
                        ctx.fillStyle = "#ffffff";
                        ctx.fillRect(0, 0, cv.width, cv.height);
                        var v = page.getViewport({ scale: scale, offsetX: -box[0] * scale, offsetY: -box[1] * scale });
                        // "print": the display intent paces itself on animation
                        // frames, which a hidden tab never gets
                        return page.render({ canvasContext: ctx, viewport: v, intent: "print" }).promise.then(function () { return cv; });
                    },
                    release: function () { try { page.cleanup(); } catch (e) { } }
                };
            });
        });
    }

    function open(bytes, opts) {
        opts = opts || {};
        return loadLib().then(function (lib) {
            var data = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
            var task = lib.getDocument({
                data: data,
                cMapUrl: LIB + "cmaps/",
                cMapPacked: true,
                isEvalSupported: false
            });
            var cancelled = false;
            if (opts.password) {
                task.onPassword = function (update, reason) {
                    opts.password(reason === lib.PasswordResponses.INCORRECT_PASSWORD, function (pw) {
                        if (pw === null || pw === undefined) {
                            cancelled = true;
                            task.destroy();
                            return;
                        }
                        update(pw);
                    });
                };
            }
            return task.promise.then(function (pdf) {
                return {
                    numPages: pdf.numPages,
                    page: function (n) { return readPage(lib, pdf, n); },
                    close: function () { try { pdf.destroy(); } catch (e) { } }
                };
            }, function (err) {
                var msg = (err && err.message) || String(err);
                if (err && err.name === "PasswordException") msg = "the PDF is password protected";
                if (cancelled || /destroyed/i.test(msg)) msg = "cancelled";
                if (err && err.name === "InvalidPDFException") msg = "this is not a valid PDF file";
                throw new Error(msg);
            });
        });
    }

    window.OfficePdfRead = {
        open: open,
        load: loadLib,
        familyOf: function (raw) { return familyOf(raw).family; },
        // exposed for tests
        _splitFontName: splitFontName,
        _cleanText: cleanText
    };
})();
