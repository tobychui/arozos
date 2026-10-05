/*
    Pixel Studio - text layers

    The text of a layer is kept in the PSD's own structure (ag-psd's
    LayerTextData) as layer.text.psd:
        text                    the characters ("\n" between paragraphs)
        transform               [xx, xy, yx, yy, tx, ty] text space -> document
        style / styleRuns       character styles (runs override the base style)
        paragraphStyle / paragraphStyleRuns
        shapeType "point" | "box" with boxBounds [left, top, right, bottom]
        warp, antiAlias, orientation ...
    so a text layer opened from a PSD saves back as live, editable text.

    Text opened from a file shows the rendering stored in it (the layer
    pixels stored in the file) until it is edited; from then on the layer is
    drawn by the layout engine below (runs, paragraphs, alignment, wrapping in
    text boxes, tracking, leading, faux bold / italic, caps, super- and
    subscript, underline, strikethrough, vertical type, the full transform)
    and the warp styles (typetools.js).

    Layout space: lines run along +x and stack along +y. Horizontal text
    maps it to text space unchanged; vertical text turns it a quarter turn
    (columns run down and stack right to left). PS.textMatrix maps layout
    space all the way to the document.

    Custom fonts are enumerated by backend/listFonts.js from the webapp's
    ./fonts/ folder and loaded through the FontFace API.
*/
"use strict";

PS.builtinFonts = [
    "Arial", "Helvetica", "Times New Roman", "Georgia", "Courier New",
    "Verdana", "Tahoma", "Trebuchet MS", "Impact", "Comic Sans MS"
];

PS.loadFonts = function (done) {
    PS.fonts = PS.builtinFonts.map(function (f) {
        return { name: f, css: f, builtin: true };
    });

    if (!PS.inArozOS()) { if (done) { done(); } return; }

    try {
        ao_module_agirun("Pixel Studio/backend/listFonts.js", {}, function (list) {
            if (typeof list === "string") {
                try { list = JSON.parse(list); } catch (e) { list = []; }
            }
            if (!Array.isArray(list)) { list = []; }

            var pending = list.length;
            if (pending === 0) { if (done) { done(); } return; }

            list.forEach(function (f) {
                var url = "url(\"../" + encodeURI(f.file) + "\")";
                var face = new FontFace(f.name, url);
                face.load().then(function (loaded) {
                    document.fonts.add(loaded);
                    PS.fonts.push({ name: f.name, css: f.name, builtin: false });
                    if (--pending === 0 && done) { done(); }
                }).catch(function () {
                    if (--pending === 0 && done) { done(); }
                });
            });
        }, function () {
            if (done) { done(); }
        });
    } catch (e) {
        if (done) { done(); }
    }
};

PS.fontOptions = function (extra) {
    var opts = PS.fonts.map(function (f) {
        return { v: f.css, l: f.name + (f.builtin ? "" : " (custom)") };
    });
    if (extra && !opts.some(function (o) { return o.v === extra; })) {
        opts.unshift({ v: extra, l: extra + " (missing)" });
    }
    return opts;
};

/* ============================================================
   FONT NAMES (PostScript names <-> CSS families)
   ============================================================ */

PS.POSTSCRIPT_FONTS = {
    "Arial": "ArialMT", "Helvetica": "Helvetica", "Times New Roman": "TimesNewRomanPSMT",
    "Georgia": "Georgia", "Courier New": "CourierNewPSMT", "Verdana": "Verdana", "Tahoma": "Tahoma",
    "Trebuchet MS": "TrebuchetMS", "Impact": "Impact", "Comic Sans MS": "ComicSansMS"
};

// "Arial-BoldItalicMT" -> {family: "Arial", bold: true, italic: true}
PS.parsePostScriptName = function (ps) {
    if (!ps) { return { family: "Arial", bold: false, italic: false }; }
    var known = Object.keys(PS.POSTSCRIPT_FONTS);
    for (var i = 0; i < known.length; i++) {
        if (PS.POSTSCRIPT_FONTS[known[i]] === ps) { return { family: known[i], bold: false, italic: false }; }
    }
    var parts = ps.split("-");
    var base = parts[0].replace(/(PSMT|PS|MT)$/, "");
    var style = (parts[1] || "").replace(/(PSMT|PS|MT)$/, "").toLowerCase();
    // CamelCase -> words ("MyriadPro" -> "Myriad Pro", "TimesNewRoman" -> "Times New Roman")
    var family = base.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
    return {
        family: family,
        bold: /bold|black|heavy|semibold|demi/.test(style),
        italic: /italic|oblique/.test(style)
    };
};

PS.postScriptNameFor = function (family) {
    return PS.POSTSCRIPT_FONTS[family] || String(family || "Arial").replace(/\s+/g, "");
};

// CSS family to draw a PSD font with: the font itself when the
// browser has it, otherwise a close generic fallback
PS.cssFontFamily = function (psName) {
    var p = PS.parsePostScriptName(psName);
    var fam = p.family;
    var fallback = /courier|mono|consol/i.test(fam) ? "monospace"
        : (/times|georgia|garamond|minion|serif/i.test(fam) && !/sans/i.test(fam) ? "serif" : "sans-serif");
    return "\"" + fam + "\", " + fallback;
};

/* ============================================================
   STYLES AND RUNS
   ============================================================ */

PS.TEXT_DEFAULT_STYLE = {
    font: { name: "ArialMT" }, fontSize: 12, fillColor: { r: 0, g: 0, b: 0 },
    fauxBold: false, fauxItalic: false, autoLeading: true, leading: 0, tracking: 0,
    horizontalScale: 1, verticalScale: 1, baselineShift: 0, fontCaps: 0,
    underline: false, strikethrough: false
};

// Text is laid out in text space, where sizes are points; the
// layer's transform maps text space to document pixels (the file stores
// the resolution scale, res / 72, in that transform). So the layout itself
// never scales.
PS.textPtScale = function () { return 1; };

// Document resolution in pixels per inch (72 when the file does not say)
PS.docResolution = function () {
    var d = PS.doc;
    var ri = d && d.psd && d.psd.imageResources && d.psd.imageResources.resolutionInfo;
    if (!ri || !ri.horizontalResolution) { return 72; }
    return ri.horizontalResolution * (ri.horizontalResolutionUnit === "PPCM" ? 2.54 : 1);
};

// Pixels per point in this document
PS.docPtScale = function () { return PS.docResolution() / 72; };

// Per-character merged styles of a text
PS.textCharStyles = function (t) {
    var base = Object.assign({}, PS.TEXT_DEFAULT_STYLE, t.style || {});
    var n = (t.text || "").length;
    var out = new Array(n);
    var i = 0;
    (t.styleRuns || []).forEach(function (r) {
        var s = Object.assign({}, base, r.style || {});
        for (var k = 0; k < r.length && i < n; k++) { out[i++] = s; }
    });
    for (; i < n; i++) { out[i] = base; }
    return out;
};

PS.textParaStyles = function (t) {
    var base = Object.assign({ justification: "left", startIndent: 0, endIndent: 0, firstLineIndent: 0, spaceBefore: 0, spaceAfter: 0, autoLeading: 1.2 },
        t.paragraphStyle || {});
    var n = (t.text || "").length;
    var out = new Array(n);
    var i = 0;
    (t.paragraphStyleRuns || []).forEach(function (r) {
        var s = Object.assign({}, base, r.style || {});
        for (var k = 0; k < r.length && i < n; k++) { out[i++] = s; }
    });
    for (; i < n; i++) { out[i] = base; }
    return out;
};

// Compress per-character styles back into runs (only keys differing from base)
PS.textCompressRuns = function (styles, base) {
    var runs = [];
    var lastKey = null;
    styles.forEach(function (s) {
        var own = {};
        Object.keys(s).forEach(function (k) {
            if (JSON.stringify(s[k]) !== JSON.stringify(base[k])) { own[k] = s[k]; }
        });
        var key = JSON.stringify(own);
        if (key === lastKey) { runs[runs.length - 1].length++; }
        else { runs.push({ length: 1, style: own }); lastKey = key; }
    });
    return runs;
};

// Replace text[start, end) with str, keeping run styles aligned
PS.textSplice = function (t, start, end, str) {
    var chars = PS.textCharStyles(t), paras = PS.textParaStyles(t);
    var cs = chars[start > 0 ? start - 1 : start] || chars[0] || Object.assign({}, PS.TEXT_DEFAULT_STYLE, t.style || {});
    var ps = paras[start > 0 ? start - 1 : start] || paras[0] || Object.assign({ justification: "left" }, t.paragraphStyle || {});
    var ins = [], insP = [];
    for (var i = 0; i < str.length; i++) { ins.push(cs); insP.push(ps); }
    chars.splice.apply(chars, [start, end - start].concat(ins));
    paras.splice.apply(paras, [start, end - start].concat(insP));
    t.text = (t.text || "").slice(0, start) + str + (t.text || "").slice(end);
    PS.textStoreStyles(t, chars, paras);
};

PS.textStoreStyles = function (t, chars, paras) {
    var base = Object.assign({}, PS.TEXT_DEFAULT_STYLE, t.style || {});
    t.styleRuns = PS.textCompressRuns(chars, base);
    if (paras) {
        var pbase = Object.assign({ justification: "left" }, t.paragraphStyle || {});
        t.paragraphStyleRuns = PS.textCompressRuns(paras, pbase);
    }
};

// Apply style keys to characters [start, end) (the whole text when equal)
PS.textApplyStyle = function (t, start, end, patch) {
    var chars = PS.textCharStyles(t);
    if (start === end) { start = 0; end = chars.length; }
    if (start === 0 && end >= chars.length) {
        // whole text: change the base style so new text inherits it too
        t.style = Object.assign({}, t.style || {}, patch);
        chars = chars.map(function (s) { return Object.assign({}, s, patch); });
    } else {
        for (var i = start; i < end; i++) { chars[i] = Object.assign({}, chars[i], patch); }
    }
    PS.textStoreStyles(t, chars, null);
};

PS.textApplyParagraph = function (t, start, end, patch) {
    var paras = PS.textParaStyles(t);
    var text = t.text || "";
    // extend to whole paragraphs
    while (start > 0 && text.charAt(start - 1) !== "\n") { start--; }
    while (end < text.length && text.charAt(end) !== "\n") { end++; }
    if (start === 0 && end >= text.length) {
        t.paragraphStyle = Object.assign({}, t.paragraphStyle || {}, patch);
    }
    for (var i = start; i < Math.max(end, start + 1) && i < paras.length; i++) {
        paras[i] = Object.assign({}, paras[i], patch);
    }
    var pbase = Object.assign({ justification: "left" }, t.paragraphStyle || {});
    t.paragraphStyleRuns = PS.textCompressRuns(paras, pbase);
};

/* ============================================================
   LAYOUT
   ============================================================ */

PS._measureCtx = null;
PS.measureCtx = function () {
    if (!PS._measureCtx) { PS._measureCtx = PS.createCanvas(4, 4).getContext("2d"); }
    return PS._measureCtx;
};

// CSS font string of a merged style at a pixel size
PS.textCssFont = function (s, sizePx) {
    var p = PS.parsePostScriptName(s.font && s.font.name);
    var bold = p.bold || s.fauxBold, italic = p.italic || s.fauxItalic;
    return (italic ? "italic " : "") + (bold ? "bold " : "") + sizePx.toFixed(2) + "px " + PS.cssFontFamily(s.font && s.font.name);
};

function capsChar(ch, s) {
    return s.fontCaps === 2 ? ch.toUpperCase() : ch;
}

// Lay the text out in text space (origin = the transform's origin).
// Returns {lines: [{baseline, height, glyphs: [{i, ch, x, w, s, size}]}], box}
PS.layoutText = function (t) {
    var ctx = PS.measureCtx();
    var text = t.text || "";
    var chars = PS.textCharStyles(t), paras = PS.textParaStyles(t);
    var k = PS.textPtScale();
    var isBox = t.shapeType === "box" && t.boxBounds;
    var bb = isBox ? PS.textLayoutBox(t) : null;
    var boxW = isBox ? bb[2] - bb[0] : Infinity;

    // split into paragraphs of glyphs
    var paragraphs = [];
    var cur = [];
    for (var i = 0; i <= text.length; i++) {
        if (i === text.length || text.charAt(i) === "\n") {
            paragraphs.push({ glyphs: cur, start: i - cur.length, para: paras[i] || paras[i - 1] || paras[0] || { justification: "left" } });
            cur = [];
            continue;
        }
        var s = chars[i];
        var size = (s.fontSize || 12) * k;
        var effSize = s.fontCaps === 1 && /[a-z]/.test(text.charAt(i)) ? size * 0.7 : size;
        // superscript / subscript: smaller glyphs, raised or lowered at draw time
        if (s.fontBaseline === 1 || s.fontBaseline === 2) { effSize *= 0.583; }
        ctx.font = PS.textCssFont(s, effSize);
        var ch = capsChar(text.charAt(i), s);
        var upright = t.orientation === "vertical" && PS.isUprightGlyph(ch);
        var w = upright ? size : ctx.measureText(ch).width * (s.horizontalScale || 1);
        w += (s.tracking || 0) / 1000 * size;
        // manual kerning (thousandths of an em) applies after the character
        if (s.kerning && s.autoKerning === false) { w += s.kerning / 1000 * size; }
        cur.push({ i: i, ch: ch, w: w, s: s, size: effSize, lineSize: size });
    }

    var lines = [];
    paragraphs.forEach(function (p) {
        var ps = p.para || {};
        var indentL = (ps.startIndent || 0) * k, indentR = (ps.endIndent || 0) * k, first = (ps.firstLineIndent || 0) * k;
        var avail = boxW - indentL - indentR;
        var glyphs = p.glyphs;
        var lineStart = 0;
        var paraLines = [];
        if (!glyphs.length) {
            paraLines.push({ glyphs: [], para: ps, first: true, emptyIndex: p.start });
        }
        while (lineStart < glyphs.length) {
            var width = 0, lastBreak = -1, j = lineStart;
            var firstLine = !paraLines.length;
            var limit = avail - (firstLine ? first : 0);
            for (; j < glyphs.length; j++) {
                if (/\s/.test(glyphs[j].ch)) { lastBreak = j; }
                if (isBox && width + glyphs[j].w > limit && j > lineStart) { break; }
                width += glyphs[j].w;
            }
            var end = j;
            if (j < glyphs.length && lastBreak >= lineStart) { end = lastBreak + 1; }
            paraLines.push({ glyphs: glyphs.slice(lineStart, end), para: ps, first: firstLine, wrapped: end < glyphs.length });
            lineStart = end;
        }
        paraLines.forEach(function (l, li) {
            l.indent = indentL + (l.first ? first : 0);
            l.indentR = indentR;
            l.avail = avail - (l.first ? first : 0);
            l.spaceBefore = li === 0 ? (ps.spaceBefore || 0) * k : 0;
            l.spaceAfter = li === paraLines.length - 1 ? (ps.spaceAfter || 0) * k : 0;
            l.lastOfPara = li === paraLines.length - 1;
            lines.push(l);
        });
    });

    // vertical metrics and alignment
    var y = 0;
    var firstBaseline = null;
    lines.forEach(function (l, li) {
        var maxSize = 0, lead = 0;
        var gl = l.glyphs.length ? l.glyphs : null;
        var refStyle = gl ? gl[0].s : (chars[l.emptyIndex - 1] || chars[0] || Object.assign({}, PS.TEXT_DEFAULT_STYLE, t.style || {}));
        (gl || [{ lineSize: (refStyle.fontSize || 12) * k, s: refStyle }]).forEach(function (g) {
            maxSize = Math.max(maxSize, g.lineSize);
            var auto = g.s.autoLeading !== false || !g.s.leading;
            var ld = auto ? g.lineSize * ((l.para && l.para.autoLeading) || 1.2) : g.s.leading * k;
            lead = Math.max(lead, ld);
        });
        if (t.orientation === "vertical") {
            // columns: upright glyphs centre on the column, the em box sets the pitch
            lead = Math.max(lead, maxSize * ((l.para && l.para.autoLeading) || 1.2));
        }
        l.height = lead;
        l.size = maxSize;
        y += l.spaceBefore;
        if (li === 0) {
            // point text: the origin is the first baseline; box text: the
            // first baseline sits one ascent below the top of the box
            y = isBox ? bb[1] + maxSize * 0.9 + l.spaceBefore : 0;
            firstBaseline = y;
        } else {
            y += lead;
        }
        l.baseline = y;
        y += l.spaceAfter;

        // horizontal placement
        var just = (l.para && l.para.justification) || "left";
        var width = 0;
        l.glyphs.forEach(function (g) { width += g.w; });
        // trailing spaces do not count for alignment
        var trail = 0;
        for (var q = l.glyphs.length - 1; q >= 0 && /\s/.test(l.glyphs[q].ch); q--) { trail += l.glyphs[q].w; }
        var visW = width - trail;
        var x0;
        var gap = 0;
        if (isBox) {
            var left = bb[0] + l.indent;
            var slack = l.avail - visW;
            var justifyAll = just === "justify-all" || (just.indexOf("justify") === 0 && !l.lastOfPara && l.wrapped);
            if (justifyAll) {
                var spaces = l.glyphs.filter(function (g, gi) { return gi < l.glyphs.length - 1 && /\s/.test(g.ch); }).length;
                gap = spaces ? slack / spaces : 0;
                x0 = left;
            } else {
                var base = just.replace("justify-", "");
                x0 = base === "center" ? left + slack / 2 : (base === "right" ? left + slack : left);
            }
        } else {
            // point text: the line sits between its left and right indents
            var b2 = just.replace("justify-", "");
            // (centred: measured against reference renderings of indented
            // centred point text, the left indent counts fully and half of
            // the right one)
            if (b2 === "center") { x0 = -visW / 2 + l.indent - (l.indentR || 0) / 2; }
            else if (b2 === "right") { x0 = -visW - (l.indentR || 0); }
            else { x0 = l.indent; }
        }
        var x = x0;
        l.glyphs.forEach(function (g, gi) {
            g.x = x;
            x += g.w;
            if (gap && gi < l.glyphs.length - 1 && /\s/.test(g.ch)) { x += gap; g.w += gap; }
        });
        l.x0 = x0;
        l.x1 = x;
    });
    return { lines: lines, firstBaseline: firstBaseline };
};

// Characters set upright in vertical type (CJK and full width forms);
// everything else is turned with the column (the default)
PS.isUprightGlyph = function (ch) {
    var c = ch.charCodeAt(0);
    return (c >= 0x2E80 && c <= 0x9FFF) || (c >= 0xAC00 && c <= 0xD7AF) || (c >= 0xF900 && c <= 0xFAFF) ||
        (c >= 0xFE30 && c <= 0xFE4F) || (c >= 0xFF00 && c <= 0xFFEF) || (c >= 0x3000 && c <= 0x303F);
};

// The text box in layout space (vertical text lays its columns across it)
PS.textLayoutBox = function (t) {
    var bb = t.boxBounds;
    if (!bb) { return null; }
    if (t.orientation !== "vertical") { return bb; }
    return [0, 0, bb[3] - bb[1], bb[2] - bb[0]];
};

// layout space -> text space
PS.textLayoutMatrix = function (t) {
    if (t.orientation !== "vertical") { return [1, 0, 0, 1, 0, 0]; }
    var bb = t.shapeType === "box" && t.boxBounds;
    return [0, 1, -1, 0, bb ? bb[2] : 0, bb ? bb[1] : 0];
};

// Envelope of the laid out text in layout space (what a warp bends)
PS.textLayoutRect = function (layout) {
    if (layout._rect) { return layout._rect; }
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    layout.lines.forEach(function (l) {
        if (!l.glyphs.length) { return; }
        x0 = Math.min(x0, l.x0); x1 = Math.max(x1, l.x1);
        y0 = Math.min(y0, l.baseline - l.size * 0.92);
        y1 = Math.max(y1, l.baseline + l.size * 0.28);
    });
    if (x0 === Infinity) { x0 = 0; x1 = 1; y0 = -1; y1 = 0; }
    layout._rect = { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
    return layout._rect;
};

// layout point -> document point, through the warp when there is one
PS.textLayoutToDoc = function (t, layout, x, y) {
    var p = { x: x, y: y };
    if (PS.textIsWarped(t) && PS.warpTextPoint) { p = PS.warpTextPoint(t, layout, x, y); }
    return PS.applyAffine(PS.textMatrix(t), p.x, p.y);
};

PS.textIsWarped = function (t) {
    var w = t && t.warp;
    return !!(w && w.style && w.style !== "none" && w.style !== "custom" &&
        ((w.value || 0) !== 0 || (w.perspective || 0) !== 0 || (w.perspectiveOther || 0) !== 0));
};

/* ============================================================
   RENDERING
   ============================================================ */

// layout space -> document (the layer transform after the layout matrix)
PS.textMatrix = function (t) {
    var m = t.transform || [1, 0, 0, 1, 0, 0];
    var L = PS.textLayoutMatrix(t);
    return [
        m[0] * L[0] + m[2] * L[1], m[1] * L[0] + m[3] * L[1],
        m[0] * L[2] + m[2] * L[3], m[1] * L[2] + m[3] * L[3],
        m[0] * L[4] + m[2] * L[5] + m[4], m[1] * L[4] + m[3] * L[5] + m[5]
    ];
};

// Draw the glyphs; base (optional) replaces the layout -> document matrix
PS.drawTextLayout = function (ctx, t, layout, base) {
    var m = base || PS.textMatrix(t);
    ctx.save();
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.textBaseline = "alphabetic";
    var vertical = t.orientation === "vertical";
    layout.lines.forEach(function (l) {
        l.glyphs.forEach(function (g) {
            if (/\s/.test(g.ch)) { return; }
            var s = g.s;
            ctx.font = PS.textCssFont(s, g.size);
            var rgb = PS.psdColorToRgb(s.fillColor);
            ctx.fillStyle = PS.rgbToHex(rgb[0], rgb[1], rgb[2]);
            var by = l.baseline - (s.baselineShift || 0) * PS.textPtScale();
            if (s.fontBaseline === 1) { by -= g.lineSize * 0.33; }
            else if (s.fontBaseline === 2) { by += g.lineSize * 0.1; }
            ctx.save();
            ctx.translate(g.x, by);
            if (vertical && PS.isUprightGlyph(g.ch)) {
                // upright in the column: centred on the em box, turned back
                ctx.translate(g.w / 2, -g.lineSize * 0.38);
                ctx.rotate(-Math.PI / 2);
                ctx.translate(-g.size / 2, g.size * 0.38);
            }
            ctx.scale(s.horizontalScale || 1, s.verticalScale || 1);
            if (s.strokeFlag && s.strokeColor && s.fillFirst === false) {
                strokeGlyph(ctx, g, s);
            }
            if (s.fillFlag !== false) { ctx.fillText(g.ch, 0, 0); }
            if (s.strokeFlag && s.strokeColor && s.fillFirst !== false) { strokeGlyph(ctx, g, s); }
            ctx.restore();
        });
        // underline / strikethrough per run segment
        l.glyphs.forEach(function (g) {
            var s = g.s;
            if (!s.underline && !s.strikethrough) { return; }
            var rgb = PS.psdColorToRgb(s.fillColor);
            ctx.fillStyle = PS.rgbToHex(rgb[0], rgb[1], rgb[2]);
            var th = Math.max(1, g.size / 14);
            if (s.underline) { ctx.fillRect(g.x, l.baseline + g.size * 0.12, g.w, th); }
            if (s.strikethrough) { ctx.fillRect(g.x, l.baseline - g.size * 0.3, g.w, th); }
        });
    });
    ctx.restore();

    function strokeGlyph(c, g, s) {
        var rgb = PS.psdColorToRgb(s.strokeColor);
        c.strokeStyle = PS.rgbToHex(rgb[0], rgb[1], rgb[2]);
        c.lineWidth = (s.outlineWidth || 1) * PS.textPtScale();
        c.strokeText(g.ch, 0, 0);
    }
};

// Redraw a text layer from its text data (marks it as drawn by Pixel Studio)
PS.renderTextLayer = function (layer) {
    if (layer.kind !== "text" || !layer.text || !layer.text.psd) { return; }
    var t = layer.text.psd;
    layer.text.drawn = true;
    var ctx = layer.canvas.getContext("2d");
    ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    layer.offcanvas = null;
    var layout = PS.layoutText(t);
    layer.text._layout = layout;
    layer.text._layoutKey = PS.textLayoutKey(t);
    if (PS.textIsWarped(t) && PS.drawWarpedText) {
        PS.drawWarpedText(layer.canvas, t, layout);
    } else {
        PS.drawTextLayout(ctx, t, layout);
    }
    if (PS.applyTextAntiAlias) { PS.applyTextAntiAlias(layer.canvas, t); }
    layer.rev++;
};

PS.textLayoutKey = function (t) {
    return JSON.stringify([t.text, t.styleRuns, t.style, t.paragraphStyleRuns, t.paragraphStyle, t.boxBounds, t.shapeType, t.orientation]);
};

PS.textLayout = function (layer) {
    var t = layer.text.psd;
    var key = PS.textLayoutKey(t);
    if (!layer.text._layout || layer.text._layoutKey !== key) {
        layer.text._layout = PS.layoutText(t);
        layer.text._layoutKey = key;
    }
    return layer.text._layout;
};

// Document-space bounding box of the text (layout based)
PS.textLayerBounds = function (layer) {
    var t = layer.text.psd;
    var lay = PS.textLayout(layer);
    var m = PS.textMatrix(t);
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    function add(x, y) {
        var p = PS.applyAffine(m, x, y);
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
        y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    if (t.shapeType === "box" && t.boxBounds) {
        var b = PS.textLayoutBox(t);
        add(b[0], b[1]); add(b[2], b[1]); add(b[2], b[3]); add(b[0], b[3]);
    }
    if (PS.textIsWarped(t) && PS.warpTextPoint) {
        // the bent envelope
        var r = PS.textLayoutRect(lay);
        for (var i = 0; i <= 16; i++) {
            for (var j = 0; j <= 4; j++) {
                var wp = PS.warpTextPoint(t, lay, r.x + r.w * i / 16, r.y + r.h * j / 4);
                add(wp.x, wp.y);
            }
        }
        return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    lay.lines.forEach(function (l) {
        add(l.x0, l.baseline - l.size * 0.9);
        add(Math.max(l.x1, l.x0 + 2), l.baseline + l.size * 0.25);
    });
    if (x0 === Infinity) { return null; }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

PS.translateText = function (layer, dx, dy) {
    var t = layer.text.psd;
    if (!t.transform) { t.transform = [1, 0, 0, 1, 0, 0]; }
    t.transform[4] += dx;
    t.transform[5] += dy;
};

// Apply a document geometry change to the text's transform
PS.transformText = function (layer, m) {
    var t = layer.text.psd;
    var a = t.transform || [1, 0, 0, 1, 0, 0];
    t.transform = [
        m[0] * a[0] + m[2] * a[1], m[1] * a[0] + m[3] * a[1],
        m[0] * a[2] + m[2] * a[3], m[1] * a[2] + m[3] * a[3],
        m[0] * a[4] + m[2] * a[5] + m[4], m[1] * a[4] + m[3] * a[5] + m[5]
    ];
};

/* ---------- PSD import / export hooks (docio.js) ---------- */

PS.textFromPsd = function (agText) {
    return { psd: PS.deepCopy(agText), drawn: false };
};

PS.textToPsd = function (layer) {
    var t = PS.deepCopy(layer.text.psd);
    // layout boxes are recomputed by the reader of the file
    delete t.left; delete t.top; delete t.right; delete t.bottom;
    return t;
};

// A new text object at a document point (point text) or in a box, with
// the settings of the type options bar / Character / Paragraph panels
PS.newTextData = function (pt, box, orientation) {
    var o = PS.toolOpts.text;
    var k = PS.docPtScale();
    var vertical = orientation === "vertical";
    var x = box ? box.x : pt.x, y = box ? box.y : pt.y;
    // a vertical column is centred on the click
    if (vertical && !box) { x -= (o.size || 12) * k * 0.35; }
    var style = Object.assign({
        font: { name: PS.fontPsName ? PS.fontPsName(o.font, o.fontStyle || "Regular") : PS.postScriptNameFor(o.font) },
        fontSize: o.size,
        fillColor: PS.hexToPsdColor(PS.fg),
        autoLeading: true,
        tracking: 0
    }, o.charDefaults || {});
    var t = {
        text: "",
        transform: [k, 0, 0, k, Math.round(x), Math.round(y)],
        antiAlias: o.antiAlias || "smooth",
        orientation: vertical ? "vertical" : "horizontal",
        shapeType: box ? "box" : "point",
        style: style,
        styleRuns: [],
        paragraphStyle: Object.assign({ justification: o.align || "left", autoLeading: 1.2 }, o.paraDefaults || {}),
        paragraphStyleRuns: []
    };
    if (box) { t.boxBounds = [0, 0, Math.max(10, box.w / k), Math.max(10, box.h / k)]; }
    return t;
};

/* ============================================================
   INLINE EDITING
   ============================================================ */

PS.textEdit = null; // {layer, isNew, before (layer state), editorEl}

PS.textEditActive = function () { return !!PS.textEdit; };

// Character index nearest to a document point inside a text layer
PS.textHitIndex = function (layer, pt) {
    var t = layer.text.psd;
    if (PS.textIsWarped(t) && PS.warpTextPoint) { return PS.textHitIndexWarped(layer, pt); }
    var m = PS.textMatrix(t);
    var det = m[0] * m[3] - m[1] * m[2] || 1;
    var dx = pt.x - m[4], dy = pt.y - m[5];
    var lx = (m[3] * dx - m[2] * dy) / det, ly = (-m[1] * dx + m[0] * dy) / det;
    var lay = PS.textLayout(layer);
    if (!lay.lines.length) { return 0; }
    var best = lay.lines[0];
    lay.lines.forEach(function (l) {
        if (Math.abs(ly - (l.baseline - l.size * 0.35)) < Math.abs(best ? (ly - (best.baseline - best.size * 0.35)) : 1e9)) { best = l; }
    });
    if (!best.glyphs.length) { return best.emptyIndex !== undefined ? best.emptyIndex : 0; }
    for (var i = 0; i < best.glyphs.length; i++) {
        var g = best.glyphs[i];
        if (lx < g.x + g.w / 2) { return g.i; }
    }
    var lastG = best.glyphs[best.glyphs.length - 1];
    return lastG.i + (lastG.ch === "\n" ? 0 : 1);
};

// Warped text: the glyph whose bent centre is nearest, then its nearer side
PS.textHitIndexWarped = function (layer, pt) {
    var t = layer.text.psd;
    var lay = PS.textLayout(layer);
    var best = null, bd = Infinity;
    lay.lines.forEach(function (l) {
        l.glyphs.forEach(function (g) {
            var mid = l.baseline - l.size * 0.35;
            var c = PS.textLayoutToDoc(t, lay, g.x + g.w / 2, mid);
            var dd = Math.hypot(c.x - pt.x, c.y - pt.y);
            if (dd < bd) { bd = dd; best = { g: g, l: l, mid: mid }; }
        });
    });
    if (!best) { return 0; }
    var a = PS.textLayoutToDoc(t, lay, best.g.x, best.mid), b = PS.textLayoutToDoc(t, lay, best.g.x + best.g.w, best.mid);
    return Math.hypot(a.x - pt.x, a.y - pt.y) <= Math.hypot(b.x - pt.x, b.y - pt.y) ? best.g.i : best.g.i + 1;
};

PS.startTextEditOnLayer = function (layer, caretIndex) {
    if (PS.textEdit) { PS.commitTextEdit(); }
    if (!layer.text || !layer.text.psd) { return; }
    var t = layer.text.psd;
    var host = PS.el("text-edit-host");

    // the options bar shows the style at the start of the text
    var cs = PS.textCharStyles(t)[0] || Object.assign({}, PS.TEXT_DEFAULT_STYLE, t.style || {});
    PS.syncTextOptions(cs, (PS.textParaStyles(t)[0] || {}).justification);

    var ed = document.createElement("textarea");
    ed.className = "text-editor";
    ed.value = t.text || "";
    ed.spellcheck = false;
    host.appendChild(ed);

    PS.textEdit = {
        layer: layer,
        isNew: false,
        before: PS.deepCopy(layer.text),
        beforeCanvas: PS.cloneCanvas(layer.canvas),
        editorEl: ed,
        lastValue: ed.value
    };

    // drawn by Pixel Studio from now on, so edits show live
    if (!layer.text.drawn) { PS.renderTextLayer(layer); }

    ed.focus();
    if (caretIndex === undefined) { ed.select(); }
    else { ed.setSelectionRange(caretIndex, caretIndex); }
    PS.positionTextEditor();

    ed.addEventListener("input", function () {
        var te = PS.textEdit;
        if (!te) { return; }
        // splice the change into the runs: common prefix / suffix diff
        var a = te.lastValue, b = ed.value;
        var p = 0;
        while (p < a.length && p < b.length && a.charAt(p) === b.charAt(p)) { p++; }
        var s = 0;
        while (s < a.length - p && s < b.length - p && a.charAt(a.length - 1 - s) === b.charAt(b.length - 1 - s)) { s++; }
        PS.textSplice(layer.text.psd, p, a.length - s, b.slice(p, b.length - s));
        te.lastValue = b;
        PS.renderTextLayer(layer);
        PS.positionTextEditor();
        PS.requestRender();
    });
    ed.addEventListener("keydown", function (e) {
        e.stopPropagation();
        if (e.key === "Escape") {
            e.preventDefault();
            PS.cancelTextEdit();
        } else if (e.key === "Enter" && e.ctrlKey) {
            e.preventDefault();
            PS.commitTextEdit();
        }
    });
    ["keyup", "select", "click"].forEach(function (ev) {
        ed.addEventListener(ev, function () {
            PS.positionTextEditor();
            PS.syncOptionsFromCaret();
        });
    });
};

// Keep the (invisible) textarea at the caret so IME candidates appear there
PS.positionTextEditor = function () {
    var te = PS.textEdit;
    if (!te) { return; }
    var c = PS.textCaretGeometry(te.layer, te.editorEl.selectionEnd);
    var ed = te.editorEl;
    var p = PS.docToOverlay(c.x, c.y);
    ed.style.left = p.x + "px";
    ed.style.top = p.y + "px";
    ed.style.height = Math.max(12, c.h * PS.zoom) + "px";
    ed.style.fontSize = Math.max(8, c.h * PS.zoom * 0.8) + "px";
};

// Document-space caret: top point and height
PS.textCaretGeometry = function (layer, index) {
    var t = layer.text.psd;
    var lay = PS.textLayout(layer);
    var m = PS.textMatrix(t);
    var line = lay.lines[0], x = 0;
    for (var li = 0; li < lay.lines.length; li++) {
        var l = lay.lines[li];
        var gs = l.glyphs;
        var startI = gs.length ? gs[0].i : l.emptyIndex;
        var endI = gs.length ? gs[gs.length - 1].i + 1 : l.emptyIndex;
        if (startI === undefined) { continue; }
        if (index >= startI && index <= endI) {
            line = l;
            x = l.x0;
            for (var g = 0; g < gs.length; g++) {
                if (gs[g].i < index) { x = gs[g].x + gs[g].w; }
            }
            if (index < endI || !l.wrapped) { break; }
        }
    }
    if (!line) { var p0 = PS.applyAffine(m, 0, 0); return { x: p0.x, y: p0.y, h: 12, angle: 0 }; }
    var size = line.size || 12;
    var top = PS.textLayoutToDoc(t, lay, x, line.baseline - size * 0.85);
    var bottom = PS.textLayoutToDoc(t, lay, x, line.baseline + size * 0.2);
    return {
        x: top.x, y: top.y, x2: bottom.x, y2: bottom.y,
        h: Math.hypot(bottom.x - top.x, bottom.y - top.y)
    };
};

// Selection highlight + blinking caret, drawn on the overlay from the same
// layout that renders the glyphs
PS.drawTextEditSelection = function (ctx, time) {
    var te = PS.textEdit;
    if (!te) { return; }
    var layer = te.layer;
    var t = layer.text.psd;
    var ed = te.editorEl;
    var start = ed.selectionStart, end = ed.selectionEnd;
    var lay = PS.textLayout(layer);
    var m = PS.textMatrix(t);
    ctx.save();
    if (start !== end) {
        // highlight quads follow the transform (and the warp)
        var a = Math.min(start, end), b = Math.max(start, end);
        ctx.fillStyle = "rgba(74, 144, 217, 0.45)";
        ctx.beginPath();
        lay.lines.forEach(function (l) {
            l.glyphs.forEach(function (g) {
                if (g.i < a || g.i >= b) { return; }
                var y0 = l.baseline - l.size * 0.85, y1 = l.baseline + l.size * 0.2;
                [[g.x, y0], [g.x + g.w, y0], [g.x + g.w, y1], [g.x, y1]].forEach(function (q, qi) {
                    var dp = PS.textLayoutToDoc(t, lay, q[0], q[1]);
                    var sp = PS.docToOverlay(dp.x, dp.y);
                    if (qi === 0) { ctx.moveTo(sp.x, sp.y); } else { ctx.lineTo(sp.x, sp.y); }
                });
                ctx.closePath();
            });
        });
        ctx.fill();
    } else if (Math.floor((time || 0) / 530) % 2 === 0) {
        var c = PS.textCaretGeometry(layer, end);
        var p1 = PS.docToOverlay(c.x, c.y), p2 = PS.docToOverlay(c.x2, c.y2);
        ctx.strokeStyle = "#4a90d9";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
    }
    ctx.restore();
    // the text box outline, with handles that resize it
    if (t.shapeType === "box" && t.boxBounds) {
        var bb = PS.textLayoutBox(t);
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]].forEach(function (q, i) {
            var d = PS.applyAffine(m, q[0], q[1]);
            var s = PS.docToOverlay(d.x, d.y);
            if (i === 0) { ctx.moveTo(s.x, s.y); } else { ctx.lineTo(s.x, s.y); }
        });
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
        if (PS.textBoxHandles) {
            PS.textBoxHandles(layer).forEach(function (h) {
                var s2 = PS.docToOverlay(h.x, h.y);
                ctx.fillStyle = "#202020";
                ctx.fillRect(Math.round(s2.x) - 4, Math.round(s2.y) - 4, 8, 8);
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(Math.round(s2.x) - 3, Math.round(s2.y) - 3, 6, 6);
            });
        }
        ctx.restore();
    }
};

PS.commitTextEdit = function () {
    var te = PS.textEdit;
    if (!te) { return; }
    PS.textEdit = null;
    var layer = te.layer;
    te.editorEl.remove();
    var t = layer.text.psd;

    if (!(t.text || "").trim()) {
        if (te.isNew) {
            // drop the empty layer by undoing its "New Layer" history entry
            if (PS.locateLayer(layer) && PS.canUndo()) {
                PS.undo();
                PS.history.stack.length = PS.history.index + 1;
                PS.renderHistoryPanel();
            }
            PS.renderLayersPanel();
            PS.requestRender();
            return;
        }
        // emptied an existing text: put it back
        layer.text = te.before;
        PS.restoreLayerCanvas(layer, te.beforeCanvas);
        PS.renderLayersPanel();
        PS.requestRender();
        return;
    }

    // name the layer after its first line
    var label = t.text.trim().split("\n")[0];
    var oldName = layer.name;
    if (te.isNew || layer.psd === null || layer.name === "Text" || (te.before.psd && layer.name === firstLine(te.before.psd.text))) {
        layer.name = label.length > 30 ? label.slice(0, 30) : label;
    }
    PS.renderLayersPanel();
    PS.requestRender();

    var before = te.before, beforeCanvas = te.beforeCanvas, beforeName = oldName;
    var after = PS.deepCopy(layer.text), afterCanvas = PS.cloneCanvas(layer.canvas), afterName = layer.name;
    if (te.isNew) {
        PS.markDirty();
        PS.historyChanged();
    } else if (JSON.stringify(before.psd) !== JSON.stringify(after.psd) || before.drawn !== after.drawn) {
        PS.pushHistory("Edit Text",
            function () { layer.text = PS.deepCopy(before); layer.name = beforeName; PS.restoreLayerCanvas(layer, beforeCanvas); },
            function () { layer.text = PS.deepCopy(after); layer.name = afterName; PS.restoreLayerCanvas(layer, afterCanvas); });
    }
    if (PS.refreshTypeUI) { PS.refreshTypeUI(); }

    function firstLine(s) { return String(s || "").trim().split("\n")[0]; }
};

PS.cancelTextEdit = function () {
    var te = PS.textEdit;
    if (!te) { return; }
    PS.textEdit = null;
    te.editorEl.remove();
    var layer = te.layer;
    if (te.isNew) {
        if (PS.locateLayer(layer) && PS.canUndo()) {
            PS.undo();
            PS.history.stack.length = PS.history.index + 1;
            PS.renderHistoryPanel();
        }
    } else {
        layer.text = te.before;
        PS.restoreLayerCanvas(layer, te.beforeCanvas);
    }
    PS.renderLayersPanel();
    PS.requestRender();
    if (PS.refreshTypeUI) { PS.refreshTypeUI(); }
};

/* ---------- options bar <-> text styles ---------- */

// The type options bar and the Character / Paragraph panels (typetools.js)
// follow the caret; these hooks are replaced there
PS.syncTextOptions = function () { };
PS.syncOptionsFromCaret = function () { };

// Picking a colour while editing recolours the selection (or all text)
PS.applyTextColorFromSelection = function (hex) {
    var te = PS.textEdit;
    if (!te) { return; }
    var ed = te.editorEl;
    var a = Math.min(ed.selectionStart, ed.selectionEnd), b = Math.max(ed.selectionStart, ed.selectionEnd);
    PS.textApplyStyle(te.layer.text.psd, a, b, { fillColor: PS.hexToPsdColor(hex) });
    PS.renderTextLayer(te.layer);
    PS.requestRender();
};

/* ---------- the text tool (T) ---------- */

(function () {
    var drag = null;

    PS.registerTool("text", {
        name: "Text",
        key: "t",
        cursor: "text",
        icon: '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg>',
        // the type options bar (typetools.js)
        options: function (host) { if (PS.typeOptionsBar) { PS.typeOptionsBar(host); } },
        onDown: function (pt, e) {
            if (PS.textEdit) {
                var te = PS.textEdit;
                var b = PS.textLayerBounds(te.layer);
                if (b && pt.x >= b.x - 4 && pt.x <= b.x + b.w + 4 && pt.y >= b.y - 4 && pt.y <= b.y + b.h + 4) {
                    // move the caret inside the text being edited
                    var idx = PS.textHitIndex(te.layer, pt);
                    te.editorEl.focus();
                    if (e.shiftKey) { te.editorEl.setSelectionRange(Math.min(te.editorEl.selectionStart, idx), Math.max(te.editorEl.selectionEnd, idx)); }
                    else { te.editorEl.setSelectionRange(idx, idx); }
                    drag = { selecting: true, anchor: e.shiftKey ? te.editorEl.selectionStart : idx };
                    return;
                }
                PS.commitTextEdit();
                return;
            }
            // clicking an existing text layer edits it
            var all = PS.allLayers();
            for (var i = all.length - 1; i >= 0; i--) {
                var layer = all[i];
                if (layer.kind !== "text" || !PS.isEffectivelyVisible(layer)) { continue; }
                var bb = PS.textLayerBounds(layer);
                if (bb && pt.x >= bb.x && pt.x <= bb.x + bb.w && pt.y >= bb.y && pt.y <= bb.y + bb.h) {
                    if (layer.locks.pixels) { PS.toast("Layer is locked", true); return; }
                    PS.setActiveLayer(layer);
                    PS.startTextEditOnLayer(layer, PS.textHitIndex(layer, pt));
                    return;
                }
            }
            drag = { start: pt, cur: pt };
        },
        onMove: function (pt) {
            if (!drag) { return; }
            if (drag.selecting && PS.textEdit) {
                var idx = PS.textHitIndex(PS.textEdit.layer, pt);
                PS.textEdit.editorEl.setSelectionRange(Math.min(drag.anchor, idx), Math.max(drag.anchor, idx));
                return;
            }
            drag.cur = pt;
        },
        onUp: function () {
            if (!drag) { return; }
            var d0 = drag;
            drag = null;
            if (d0.selecting) {
                if (PS.textEdit) { PS.textEdit.editorEl.focus(); }
                return;
            }
            var w = Math.abs(d0.cur.x - d0.start.x), h = Math.abs(d0.cur.y - d0.start.y);
            var box = (w > 8 && h > 8) ? {
                x: Math.min(d0.start.x, d0.cur.x), y: Math.min(d0.start.y, d0.cur.y), w: w, h: h
            } : null;
            var layer = PS.makeLayer("Text", PS.doc.width, PS.doc.height, "text");
            layer.text = { psd: PS.newTextData(d0.start, box, PS.tool === "text-vertical" ? "vertical" : "horizontal"), drawn: true };
            PS.addLayerObject(layer, "New Text Layer");
            PS.startTextEditOnLayer(layer, 0);
            PS.textEdit.isNew = true;
        },
        overlay: function (ctx) {
            if (!drag || drag.selecting) { return; }
            var a = drag.start, b = drag.cur;
            if (Math.abs(b.x - a.x) < 4 && Math.abs(b.y - a.y) < 4) { return; }
            var p1 = PS.docToOverlay(Math.min(a.x, b.x), Math.min(a.y, b.y));
            var p2 = PS.docToOverlay(Math.max(a.x, b.x), Math.max(a.y, b.y));
            ctx.save();
            ctx.strokeStyle = "rgba(255,255,255,0.85)";
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(p1.x + 0.5, p1.y + 0.5, p2.x - p1.x, p2.y - p1.y);
            ctx.restore();
        }
    });
})();
