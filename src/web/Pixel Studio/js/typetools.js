/*
    Pixel Studio - type tools

        warp            the 15 Warp Text styles with bend and
                        horizontal / vertical distortion, drawn through a
                        mesh rasteriser (no seams, any transform)
        panels          the Character and Paragraph panels
        options bar     orientation, family, style, size, anti-aliasing,
                        alignment, colour, warp, panels, cancel / commit
        tools           Horizontal and Vertical Type tools share one tool
                        definition; paragraph boxes have resize handles
        commands        Type menu: orientation, point / paragraph text,
                        Warp Text

    Everything edits ag-psd's text structure (layer.text.psd), so the saved
    file keeps the result as live type.

    What the panels and options act on: the selected characters while
    editing (the whole text when nothing is selected), else the whole
    active type layer, else the settings for the next new text.
*/
"use strict";

/* ============================================================
   WARP TEXT
   ============================================================ */

PS.TEXT_WARPS = [
    ["none", "None"], ["arc", "Arc"], ["arcLower", "Arc Lower"], ["arcUpper", "Arc Upper"], ["arch", "Arch"],
    ["bulge", "Bulge"], ["shellLower", "Shell Lower"], ["shellUpper", "Shell Upper"], ["flag", "Flag"],
    ["wave", "Wave"], ["fish", "Fish"], ["rise", "Rise"], ["fisheye", "Fisheye"], ["inflate", "Inflate"],
    ["squeeze", "Squeeze"], ["twist", "Twist"]
];

// One style on the unit envelope: u, v in 0..1 (left to right, top to
// bottom), W x H its size, b the bend (-1..1). Returns the bent point
// relative to the envelope's top-left corner.
function warpStyled(style, b, u, v, W, H) {
    var x = u * W, y = v * H;
    var dx = 2 * u - 1, dy = 2 * v - 1;
    // An edge bends into a circular arc through its two corners;
    // a bend of 50 % spans about 80 degrees (fitted to reference
    // renderings). sag(u): how far the arc stands off the straight edge.
    var ab = Math.abs(b), sign = b < 0 ? -1 : 1;
    var A = Math.max(1e-4, ab * Math.PI * 0.89);
    var R = (W / 2) / Math.sin(A / 2);
    var sagMax = R * (1 - Math.cos(A / 2));
    function sag(uu) {
        var ox = (uu - 0.5) * W;
        return Math.sqrt(Math.max(0, R * R - ox * ox)) - R * Math.cos(A / 2);
    }
    switch (style) {
        case "arc": {
            if (ab < 1e-4) { break; }
            // the inner edge arcs through its fixed corners, the other edge
            // is the concentric arc H further out
            var phi = (u - 0.5) * A;
            if (b > 0) {
                var cy = H + R * Math.cos(A / 2);
                var r = R + (1 - v) * H;
                x = W / 2 + r * Math.sin(phi);
                y = cy - r * Math.cos(phi);
            } else {
                var cy2 = -R * Math.cos(A / 2);
                var r2 = R + v * H;
                x = W / 2 + r2 * Math.sin(phi);
                y = cy2 + r2 * Math.cos(phi);
            }
            break;
        }
        case "arcLower": y = v * H + sign * v * sag(u); break;
        case "arcUpper": y = v * H - sign * (1 - v) * sag(u); break;
        case "arch": y = v * H - sign * sag(u); break;
        case "bulge": y = v * H - sign * (1 - v) * sag(u) + sign * v * sag(u); break;
        case "shellLower":
            y = v * H + sign * v * sag(u);
            x = W / 2 + (x - W / 2) * (1 - 0.5 * ab * (1 - v) * sagMax / Math.max(1, H));
            break;
        case "shellUpper":
            y = v * H - sign * (1 - v) * sag(u);
            x = W / 2 + (x - W / 2) * (1 - 0.5 * ab * v * sagMax / Math.max(1, H));
            break;
        case "flag": y = v * H - b * H * 0.5 * Math.sin(2 * Math.PI * u); break;
        case "wave": y = v * H - b * H * 0.5 * Math.sin(2 * Math.PI * u + v * Math.PI * 0.5); break;
        case "fish": y = H / 2 + (v - 0.5) * H * (1 + b * Math.sin(Math.PI * u) * (1.3 - 0.8 * u)); break;
        case "rise": y = v * H - b * H * 0.5 * Math.sin((u - 0.5) * Math.PI); break;
        case "fisheye": {
            var f = 1 + b * 0.6 * Math.max(0, 1 - (dx * dx + dy * dy) / 2);
            x = W / 2 + (x - W / 2) * f;
            y = H / 2 + (y - H / 2) * f;
            break;
        }
        case "inflate":
            x = W / 2 + (x - W / 2) * (1 + b * 0.35 * (1 - dy * dy));
            y = H / 2 + (y - H / 2) * (1 + b * 0.9 * (1 - dx * dx));
            break;
        case "squeeze":
            x = W / 2 + (x - W / 2) * (1 - b * 0.5 * (1 - dy * dy));
            y = H / 2 + (y - H / 2) * (1 + b * 0.35 * (1 - dx * dx));
            break;
        case "twist": {
            var th = b * Math.PI / 2 * dx;
            var oy = y - H / 2;
            y = H / 2 + oy * Math.cos(th);
            x = x + oy * Math.sin(th) * 0.5;
            break;
        }
    }
    return { x: x, y: y };
}

// The full warp of a text: style, bend, distortion and orientation
function warpEnvelope(w, u, v, W, H) {
    var b = PS.clamp((w.value || 0) / 100, -1, 1);
    var p;
    if (w.rotate === "vertical") {
        var q = warpStyled(w.style, b, v, u, H, W);
        p = { x: q.y, y: q.x };
    } else {
        p = warpStyled(w.style, b, u, v, W, H);
    }
    // horizontal distortion: one side taller; vertical: one end wider
    var ph = PS.clamp((w.perspective || 0) / 100, -1, 1), pv = PS.clamp((w.perspectiveOther || 0) / 100, -1, 1);
    if (ph) { p.y = H / 2 + (p.y - H / 2) * (1 + ph * (2 * u - 1) * 0.8); }
    if (pv) { p.x = W / 2 + (p.x - W / 2) * (1 + pv * (2 * v - 1) * 0.8); }
    return p;
}

// A layout-space point of a warped text, bent
PS.warpTextPoint = function (t, layout, x, y) {
    var r = PS.textLayoutRect(layout);
    var p = warpEnvelope(t.warp, (x - r.x) / r.w, (y - r.y) / r.h, r.w, r.h);
    return { x: r.x + p.x, y: r.y + p.y };
};

// Draw warped type: glyphs rendered flat at the target resolution, then
// resampled through a fine triangle mesh of the warp (each pixel belongs to
// one triangle, so there are no seams)
PS.drawWarpedText = function (canvas, t, layout) {
    var m = PS.textMatrix(t);
    var det = Math.abs(m[0] * m[3] - m[1] * m[2]) || 1;
    var scale = Math.sqrt(det);
    var r = PS.textLayoutRect(layout);
    var pad = Math.max(2, r.h * 0.05);
    var rx = r.x - pad, ry = r.y - pad, rw = r.w + pad * 2, rh = r.h + pad * 2;
    var sc = Math.min(scale * 1.5, 4096 / rw, 4096 / rh);
    var sw = Math.max(1, Math.ceil(rw * sc)), sh = Math.max(1, Math.ceil(rh * sc));
    var src = PS.createCanvas(sw, sh);
    PS.drawTextLayout(src.getContext("2d"), t, layout, [sc, 0, 0, sc, -rx * sc, -ry * sc]);
    var sp = src.getContext("2d").getImageData(0, 0, sw, sh).data;
    var pm = new Float32Array(sp.length);
    for (var i = 0; i < sp.length; i += 4) {
        var a = sp[i + 3] / 255;
        pm[i] = sp[i] * a; pm[i + 1] = sp[i + 1] * a; pm[i + 2] = sp[i + 2] * a; pm[i + 3] = sp[i + 3];
    }

    // mesh over the padded envelope
    var nu = PS.clamp(Math.round(rw * scale / 8), 8, 160), nv = PS.clamp(Math.round(rh * scale / 8), 4, 80);
    var cols = nu + 1;
    var dX = new Float64Array(cols * (nv + 1)), dY = new Float64Array(cols * (nv + 1));
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var j = 0; j <= nv; j++) {
        for (var k = 0; k <= nu; k++) {
            var wp = PS.warpTextPoint(t, layout, rx + rw * k / nu, ry + rh * j / nv);
            var dp = PS.applyAffine(m, wp.x, wp.y);
            dX[j * cols + k] = dp.x; dY[j * cols + k] = dp.y;
            if (dp.x < minX) { minX = dp.x; } if (dp.x > maxX) { maxX = dp.x; }
            if (dp.y < minY) { minY = dp.y; } if (dp.y > maxY) { maxY = dp.y; }
        }
    }
    var W = canvas.width, H = canvas.height;
    var x0 = Math.max(0, Math.floor(minX)), y0 = Math.max(0, Math.floor(minY));
    var x1 = Math.min(W, Math.ceil(maxX) + 1), y1 = Math.min(H, Math.ceil(maxY) + 1);
    if (x1 <= x0 || y1 <= y0) { return; }
    var ow = x1 - x0, oh = y1 - y0;
    var ctx = canvas.getContext("2d");
    var outImg = ctx.createImageData(ow, oh);
    var out = outImg.data;
    var stepU = sw / nu, stepV = sh / nv;

    function tri(ia, ib, ic, sa, sb, sc2) {
        var ax = dX[ia], ay = dY[ia], bx = dX[ib], by = dY[ib], cx = dX[ic], cy = dY[ic];
        var area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
        if (Math.abs(area) < 1e-9) { return; }
        var tx0 = Math.max(x0, Math.floor(Math.min(ax, bx, cx))), tx1 = Math.min(x1 - 1, Math.ceil(Math.max(ax, bx, cx)));
        var ty0 = Math.max(y0, Math.floor(Math.min(ay, by, cy))), ty1 = Math.min(y1 - 1, Math.ceil(Math.max(ay, by, cy)));
        var inv = 1 / area;
        for (var py = ty0; py <= ty1; py++) {
            var fy = py + 0.5;
            for (var px = tx0; px <= tx1; px++) {
                var fx = px + 0.5;
                var w0 = ((bx - fx) * (cy - fy) - (cx - fx) * (by - fy)) * inv;
                var w1 = ((cx - fx) * (ay - fy) - (ax - fx) * (cy - fy)) * inv;
                var w2 = 1 - w0 - w1;
                if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) { continue; }
                var sx = w0 * sa[0] + w1 * sb[0] + w2 * sc2[0] - 0.5;
                var sy = w0 * sa[1] + w1 * sb[1] + w2 * sc2[1] - 0.5;
                if (sx < -1 || sy < -1 || sx > sw || sy > sh) { continue; }
                // bilinear, premultiplied
                var ix = Math.floor(sx), iy = Math.floor(sy);
                var fx2 = sx - ix, fy2 = sy - iy;
                var r0 = 0, g0 = 0, b0 = 0, a0 = 0;
                for (var q = 0; q < 4; q++) {
                    var qx = ix + (q & 1), qy = iy + (q >> 1);
                    if (qx < 0 || qy < 0 || qx >= sw || qy >= sh) { continue; }
                    var wq = ((q & 1) ? fx2 : 1 - fx2) * ((q >> 1) ? fy2 : 1 - fy2);
                    var si = (qy * sw + qx) * 4;
                    r0 += pm[si] * wq; g0 += pm[si + 1] * wq; b0 += pm[si + 2] * wq; a0 += pm[si + 3] * wq;
                }
                var oi = ((py - y0) * ow + (px - x0)) * 4;
                if (a0 < 0.5) { out[oi + 3] = 0; continue; }
                var ka = 255 / a0;
                out[oi] = r0 * ka; out[oi + 1] = g0 * ka; out[oi + 2] = b0 * ka; out[oi + 3] = a0;
            }
        }
    }

    for (var jj = 0; jj < nv; jj++) {
        for (var kk = 0; kk < nu; kk++) {
            var i00 = jj * cols + kk, i10 = i00 + 1, i01 = i00 + cols, i11 = i01 + 1;
            var s00 = [kk * stepU, jj * stepV], s10 = [(kk + 1) * stepU, jj * stepV];
            var s01 = [kk * stepU, (jj + 1) * stepV], s11 = [(kk + 1) * stepU, (jj + 1) * stepV];
            tri(i00, i10, i11, s00, s10, s11);
            tri(i00, i11, i01, s00, s11, s01);
        }
    }
    ctx.putImageData(outImg, x0, y0);
};

// Anti-aliasing "None": hard edged type
PS.applyTextAntiAlias = function (canvas, t) {
    if (t.antiAlias !== "none") { return; }
    var ctx = canvas.getContext("2d");
    var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var d = img.data;
    for (var i = 3; i < d.length; i += 4) { d[i] = d[i] >= 128 ? 255 : 0; }
    ctx.putImageData(img, 0, 0);
};

/* ============================================================
   FONT FAMILIES AND STYLES
   ============================================================ */

PS.FONT_STYLES = ["Regular", "Italic", "Bold", "Bold Italic"];

PS.KNOWN_FONT_FACES = {
    "Arial": { "Regular": "ArialMT", "Italic": "Arial-ItalicMT", "Bold": "Arial-BoldMT", "Bold Italic": "Arial-BoldItalicMT" },
    "Times New Roman": { "Regular": "TimesNewRomanPSMT", "Italic": "TimesNewRomanPS-ItalicMT", "Bold": "TimesNewRomanPS-BoldMT", "Bold Italic": "TimesNewRomanPS-BoldItalicMT" },
    "Courier New": { "Regular": "CourierNewPSMT", "Italic": "CourierNewPS-ItalicMT", "Bold": "CourierNewPS-BoldMT", "Bold Italic": "CourierNewPS-BoldItalicMT" },
    "Georgia": { "Regular": "Georgia", "Italic": "Georgia-Italic", "Bold": "Georgia-Bold", "Bold Italic": "Georgia-BoldItalic" },
    "Verdana": { "Regular": "Verdana", "Italic": "Verdana-Italic", "Bold": "Verdana-Bold", "Bold Italic": "Verdana-BoldItalic" },
    "Tahoma": { "Regular": "Tahoma", "Bold": "Tahoma-Bold" },
    "Trebuchet MS": { "Regular": "TrebuchetMS", "Italic": "TrebuchetMS-Italic", "Bold": "TrebuchetMS-Bold", "Bold Italic": "Trebuchet-BoldItalic" },
    "Impact": { "Regular": "Impact" },
    "Comic Sans MS": { "Regular": "ComicSansMS", "Bold": "ComicSansMS-Bold" }
};

// PostScript font name of a family in a style
PS.fontPsName = function (family, style) {
    var known = PS.KNOWN_FONT_FACES[family];
    if (known && known[style || "Regular"]) { return known[style || "Regular"]; }
    var base = PS.postScriptNameFor(family);
    if (!style || style === "Regular") { return base; }
    return base.replace(/(PSMT|MT)$/, "") + "-" + style.replace(/\s+/g, "");
};

PS.fontStyleOf = function (psName) {
    var p = PS.parsePostScriptName(psName);
    return p.bold ? (p.italic ? "Bold Italic" : "Bold") : (p.italic ? "Italic" : "Regular");
};

PS.fontStylesFor = function (family) {
    var known = PS.KNOWN_FONT_FACES[family];
    return known ? Object.keys(known) : PS.FONT_STYLES.slice();
};

/* ============================================================
   WHAT THE TYPE SETTINGS ACT ON
   ============================================================ */

PS.typeTarget = function () {
    if (PS.textEdit) {
        var ed = PS.textEdit.editorEl;
        return {
            mode: "edit", layer: PS.textEdit.layer,
            a: Math.min(ed.selectionStart, ed.selectionEnd), b: Math.max(ed.selectionStart, ed.selectionEnd)
        };
    }
    var l = PS.doc && PS.activeLayer();
    if (l && l.kind === "text" && l.text && l.text.psd) { return { mode: "layer", layer: l }; }
    return { mode: "defaults" };
};

// settings of the next new text
PS.typeDefaults = function () {
    var o = PS.toolOpts.text;
    o.charDefaults = o.charDefaults || {};
    o.paraDefaults = o.paraDefaults || {};
    return o;
};

PS.defaultCharStyle = function () {
    var o = PS.typeDefaults();
    return Object.assign({}, PS.TEXT_DEFAULT_STYLE, {
        font: { name: PS.fontPsName(o.font, o.fontStyle || "Regular") },
        fontSize: o.size,
        fillColor: PS.hexToPsdColor(PS.fg)
    }, o.charDefaults);
};

PS.defaultParaStyle = function () {
    var o = PS.typeDefaults();
    return Object.assign({ justification: o.align || "left", startIndent: 0, endIndent: 0, firstLineIndent: 0, spaceBefore: 0, spaceAfter: 0, autoLeading: 1.2 }, o.paraDefaults);
};

PS.currentCharStyle = function () {
    var tt = PS.typeTarget();
    if (tt.mode === "defaults") { return PS.defaultCharStyle(); }
    var t = tt.layer.text.psd;
    var cs = PS.textCharStyles(t);
    var i = tt.mode === "edit" ? Math.min(tt.a, cs.length - 1) : 0;
    return cs[Math.max(0, i)] || Object.assign({}, PS.TEXT_DEFAULT_STYLE, t.style || {});
};

PS.currentParaStyle = function () {
    var tt = PS.typeTarget();
    if (tt.mode === "defaults") { return PS.defaultParaStyle(); }
    var t = tt.layer.text.psd;
    var ps = PS.textParaStyles(t);
    var i = tt.mode === "edit" ? Math.min(tt.a, ps.length - 1) : 0;
    return ps[Math.max(0, i)] || Object.assign({ justification: "left" }, t.paragraphStyle || {});
};

PS.currentTextData = function () {
    var tt = PS.typeTarget();
    return tt.mode === "defaults" ? null : tt.layer.text.psd;
};

// Whole-layer changes are recorded once a burst of edits settles
PS._typeHistory = null;

function typeLayerBegin(layer, label) {
    var p = PS._typeHistory;
    // a burst of the same setting is one step; another setting starts a new one
    if (p && (p.layer !== layer || p.label !== label)) { typeLayerFlush(); p = null; }
    if (!p) {
        p = PS._typeHistory = { layer: layer, label: label, before: PS.deepCopy(layer.text), beforeCanvas: PS.cloneCanvas(layer.canvas), timer: null };
    }
    if (p.timer) { clearTimeout(p.timer); }
    p.timer = setTimeout(typeLayerFlush, 700);
}

function typeLayerFlush() {
    var p = PS._typeHistory;
    if (!p) { return; }
    PS._typeHistory = null;
    if (p.timer) { clearTimeout(p.timer); }
    var layer = p.layer;
    var after = PS.deepCopy(layer.text), afterCanvas = PS.cloneCanvas(layer.canvas);
    if (JSON.stringify(after.psd) === JSON.stringify(p.before.psd)) { return; }
    var before = p.before, beforeCanvas = p.beforeCanvas;
    PS.pushHistory(p.label,
        function () { layer.text = PS.deepCopy(before); PS.restoreLayerCanvas(layer, beforeCanvas); PS.refreshTypeUI(); },
        function () { layer.text = PS.deepCopy(after); PS.restoreLayerCanvas(layer, afterCanvas); PS.refreshTypeUI(); });
}
PS.flushTypeHistory = typeLayerFlush;

function typeChanged(layer) {
    PS.renderTextLayer(layer);
    if (PS.textEdit) { PS.positionTextEditor(); }
    PS.requestRender();
    PS.updateLayerThumbsThrottled();
    PS.refreshTypeUI();
}

// Character settings (ag-psd style keys)
PS.applyCharStyle = function (patch, label) {
    var tt = PS.typeTarget();
    if (tt.mode === "edit") {
        PS.textApplyStyle(tt.layer.text.psd, tt.a, tt.b, patch);
        typeChanged(tt.layer);
        PS.textEdit.editorEl.focus();
    } else if (tt.mode === "layer") {
        typeLayerBegin(tt.layer, label || "Character Style");
        PS.textApplyStyle(tt.layer.text.psd, 0, 0, patch);
        typeChanged(tt.layer);
    } else {
        var o = PS.typeDefaults();
        Object.keys(patch).forEach(function (k) {
            if (k === "font") {
                var p = PS.parsePostScriptName(patch.font.name);
                o.font = p.family;
                o.fontStyle = PS.fontStyleOf(patch.font.name);
            } else if (k === "fontSize") {
                o.size = patch.fontSize;
            } else if (k === "fillColor") {
                var rgb = PS.psdColorToRgb(patch.fillColor);
                PS.setFg(PS.rgbToHex(rgb[0], rgb[1], rgb[2]));
            } else {
                o.charDefaults[k] = patch[k];
            }
        });
        PS.savePrefsDebounced();
        PS.refreshTypeUI();
    }
};

// Paragraph settings
PS.applyParaStyle = function (patch, label) {
    var tt = PS.typeTarget();
    if (tt.mode === "edit") {
        PS.textApplyParagraph(tt.layer.text.psd, tt.a, tt.b, patch);
        typeChanged(tt.layer);
        PS.textEdit.editorEl.focus();
    } else if (tt.mode === "layer") {
        typeLayerBegin(tt.layer, label || "Paragraph Style");
        var t = tt.layer.text.psd;
        PS.textApplyParagraph(t, 0, (t.text || "").length, patch);
        typeChanged(tt.layer);
    } else {
        var o = PS.typeDefaults();
        Object.keys(patch).forEach(function (k) {
            if (k === "justification") { o.align = patch[k]; } else { o.paraDefaults[k] = patch[k]; }
        });
        PS.savePrefsDebounced();
        PS.refreshTypeUI();
    }
};

// Layer-level text settings (anti-aliasing, orientation, warp)
PS.applyTextProp = function (key, value, label) {
    var tt = PS.typeTarget();
    if (tt.mode === "defaults") {
        if (key === "antiAlias") { PS.typeDefaults().antiAlias = value; PS.savePrefsDebounced(); }
        PS.refreshTypeUI();
        return;
    }
    if (tt.mode === "layer") { typeLayerBegin(tt.layer, label || "Text"); }
    tt.layer.text.psd[key] = value;
    typeChanged(tt.layer);
};

/* ---------- keeping the UI in step ---------- */

var typeUiQueued = false;
PS.refreshTypeUI = function () {
    if (typeUiQueued) { return; }
    typeUiQueued = true;
    requestAnimationFrame(function () {
        typeUiQueued = false;
        if ((PS.tool === "text" || PS.tool === "text-vertical") && !(PS.transform && PS.transform.active)) {
            // keep a field that is being typed in
            var ae = document.activeElement;
            if (!(ae && PS.el("optionsbar").contains(ae) && ae.tagName === "INPUT")) { PS.renderOptionsBar(); }
        }
        PS.renderCharacterPanel();
        PS.renderParagraphPanel();
    });
};

// the old option-bar sync points now refresh the whole type UI
PS.syncTextOptions = function () { PS.refreshTypeUI(); };
PS.syncOptionsFromCaret = function () { PS.refreshTypeUI(); };

/* ============================================================
   SHARED WIDGETS
   ============================================================ */

PS.TYPE_ICONS = {
    size: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M3 5h10M8 5v14M14 11h7M17.5 11v8"/></svg>',
    leading: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M4 11 7.5 3l3.5 8M5.3 8h4.4M13 21l3.5-8 3.5 8M14.3 18h4.4"/></svg>',
    kerning: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M3 4l3 9 3-9M10 13l3-9 3 9M11 10h4M5 18h14M5 18l2-2M5 18l2 2M19 18l-2-2M19 18l-2 2"/></svg>',
    tracking: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M4 4l3 9 3-9M14 13l3-9 3 9M15 10h4M3 18h18M3 18l2-2M3 18l2 2M21 18l-2-2M21 18l-2 2"/></svg>',
    vscale: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M3 5h10M8 5v14M18 4v16M16 6l2-2 2 2M16 18l2 2 2-2"/></svg>',
    hscale: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M5 3h12M11 3v11M3 19h18M5 17l-2 2 2 2M19 17l2 2-2 2"/></svg>',
    baseline: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M3 18 7 6l4 12M4.5 14h5M17 20V8M14 11l3-3 3 3"/></svg>',
    indentL: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M11 5h10M11 9h10M11 13h10M11 17h10M3 8l4 3-4 3"/></svg>',
    indentR: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M3 5h10M3 9h10M3 13h10M3 17h10M21 8l-4 3 4 3"/></svg>',
    indentFirst: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M9 5h12M3 9h18M3 13h18M3 17h18M3 3l3 2-3 2"/></svg>',
    spaceBefore: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M3 11h18M3 15h18M3 19h18M12 2v6M10 6l2 2 2-2"/></svg>',
    spaceAfter: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M3 4h18M3 8h18M3 12h18M12 15v6M10 19l2 2 2-2"/></svg>',
    orient: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M3 5h9M7.5 5v9M15 9v11M13 18l2 2 2-2M16 4h5M18.5 4v5"/></svg>',
    warp: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M4 8c3-4 13-4 16 0M7 7.5V18M4 18c3 2 13 2 16 0M12 6v13"/></svg>',
    panels: '<svg viewBox="0 0 24 24" stroke-width="1.6"><rect x="3" y="4" width="18" height="16"/><path d="M3 9h18M8 13h8M8 16h5"/></svg>',
    cancel: '<svg viewBox="0 0 24 24" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="M6.5 17.5 17.5 6.5"/></svg>',
    commit: '<svg viewBox="0 0 24 24" stroke-width="2"><path d="M4 12.5 9.5 18 20 6"/></svg>',
    vtype: '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M4 4h10M9 4v12M19 6v12M16.5 15.5 19 18l2.5-2.5"/></svg>'
};

PS.ALIGN_TEXT_ICONS = {
    "left": '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M4 6h16M4 10h10M4 14h16M4 18h10"/></svg>',
    "center": '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M4 6h16M7 10h10M4 14h16M7 18h10"/></svg>',
    "right": '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M4 6h16M10 10h10M4 14h16M10 18h10"/></svg>',
    "justify-left": '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M4 6h16M4 10h16M4 14h16M4 18h9"/></svg>',
    "justify-center": '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M4 6h16M4 10h16M4 14h16M8 18h8"/></svg>',
    "justify-right": '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M4 6h16M4 10h16M4 14h16M11 18h9"/></svg>',
    "justify-all": '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>'
};

function iconButton(host, icon, title, active, onclick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "opt-icon-btn" + (active ? " active" : "");
    b.title = title;
    b.innerHTML = icon;
    b.addEventListener("click", function (e) { e.preventDefault(); onclick(e); });
    // keep the text editor's selection while clicking
    b.addEventListener("mousedown", function (e) { e.preventDefault(); });
    host.appendChild(b);
    return b;
}

function psdColorHex(c) {
    var rgb = PS.psdColorToRgb(c || { r: 0, g: 0, b: 0 });
    return PS.rgbToHex(Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2]));
}

// colour well that edits the type colour
function colorWell(host, cs) {
    var w = document.createElement("button");
    w.type = "button";
    w.className = "type-color-well";
    w.title = "Set the text color";
    var hex = psdColorHex(cs.fillColor);
    w.style.background = hex;
    var inp = document.createElement("input");
    inp.type = "color";
    inp.value = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#000000";
    inp.className = "type-color-input";
    w.addEventListener("mousedown", function (e) { e.preventDefault(); });
    w.addEventListener("click", function () { inp.click(); });
    inp.addEventListener("input", function () {
        w.style.background = inp.value;
        PS.applyCharStyle({ fillColor: PS.hexToPsdColor(inp.value) }, "Text Color");
    });
    host.appendChild(w);
    host.appendChild(inp);
    return w;
}

// a compact numeric field with an icon (Character / Paragraph panels)
function typeField(host, icon, title, value, min, max, step, unit, onSet, opts) {
    opts = opts || {};
    var cell = document.createElement("div");
    cell.className = "tp-field";
    cell.title = title;
    var ic = document.createElement("span");
    ic.className = "tp-icon";
    ic.innerHTML = icon;
    cell.appendChild(ic);
    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "tp-input";
    inp.value = value;
    if (opts.list) {
        var listId = "tpl-" + Math.random().toString(36).slice(2);
        var dl = document.createElement("datalist");
        dl.id = listId;
        opts.list.forEach(function (v) { var o = document.createElement("option"); o.value = v; dl.appendChild(o); });
        cell.appendChild(dl);
        inp.setAttribute("list", listId);
    }
    function commit() {
        var raw = String(inp.value).trim();
        if (opts.allowAuto && /^auto$/i.test(raw)) { onSet("auto"); return; }
        var v = parseFloat(raw);
        if (isNaN(v)) { return; }
        v = PS.clamp(v, min, max);
        inp.value = (opts.format ? opts.format(v) : v);
        onSet(v);
    }
    inp.addEventListener("change", commit);
    inp.addEventListener("keydown", function (e) {
        e.stopPropagation();
        if (e.key === "Enter") { commit(); inp.blur(); }
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            var v = parseFloat(inp.value);
            if (isNaN(v)) { v = 0; }
            v = PS.clamp(v + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1), min, max);
            inp.value = Math.round(v * 100) / 100;
            onSet(v);
        }
    });
    PS.ui.wheelStep(inp, min, max, step, function (v) { onSet(v); });
    cell.appendChild(inp);
    if (unit) {
        var u = document.createElement("span");
        u.className = "tp-unit";
        u.textContent = unit;
        cell.appendChild(u);
    }
    host.appendChild(cell);
    return inp;
}

function fmt(v) { return Math.round(v * 100) / 100; }

/* ============================================================
   CHARACTER PANEL
   ============================================================ */

PS.renderCharacterPanel = function () {
    var body = PS.el("panel-character-body");
    if (!body || !body.isConnected) { return; }
    var cs = PS.currentCharStyle();
    var t = PS.currentTextData();
    var p = PS.parsePostScriptName(cs.font && cs.font.name);
    body.innerHTML = "";
    body.className = "panel-body type-panel";

    // family and style
    var row1 = document.createElement("div");
    row1.className = "tp-row";
    var fam = PS.selectInput(PS.fontOptions(p.family), p.family);
    fam.className = "tp-family";
    fam.title = "Set the font family";
    fam.addEventListener("change", function () {
        var style = PS.fontStyleOf(cs.font && cs.font.name);
        if (PS.fontStylesFor(fam.value).indexOf(style) < 0) { style = "Regular"; }
        PS.applyCharStyle({ font: { name: PS.fontPsName(fam.value, style) } }, "Font");
    });
    row1.appendChild(fam);
    body.appendChild(row1);
    var row2 = document.createElement("div");
    row2.className = "tp-row";
    var sty = PS.selectInput(PS.fontStylesFor(p.family).map(function (s) { return { v: s, l: s }; }), PS.fontStyleOf(cs.font && cs.font.name));
    sty.className = "tp-style";
    sty.title = "Set the font style";
    sty.addEventListener("change", function () {
        PS.applyCharStyle({ font: { name: PS.fontPsName(p.family, sty.value) } }, "Font Style");
    });
    row2.appendChild(sty);
    body.appendChild(row2);

    var grid = document.createElement("div");
    grid.className = "tp-grid";
    body.appendChild(grid);
    typeField(grid, PS.TYPE_ICONS.size, "Set the font size", fmt(cs.fontSize || 12), 0.01, 1296, 1, "pt",
        function (v) { PS.applyCharStyle({ fontSize: v }, "Font Size"); }, { list: [6, 7, 8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72] });
    var auto = cs.autoLeading !== false || !cs.leading;
    typeField(grid, PS.TYPE_ICONS.leading, "Set the leading (Auto or points)", auto ? "(Auto)" : fmt(cs.leading), 0.01, 5000, 1, "pt",
        function (v) {
            if (v === "auto") { PS.applyCharStyle({ autoLeading: true }, "Leading"); }
            else { PS.applyCharStyle({ autoLeading: false, leading: v }, "Leading"); }
        }, { allowAuto: true, list: ["Auto", 6, 8, 10, 12, 14, 18, 24, 30, 36, 48, 60, 72] });
    var kernAuto = cs.autoKerning !== false;
    typeField(grid, PS.TYPE_ICONS.kerning, "Set the kerning between two characters (Metrics or 1/1000 em)", kernAuto ? "Metrics" : fmt(cs.kerning || 0), -1000, 10000, 10, "",
        function (v) {
            if (v === "auto") { PS.applyCharStyle({ autoKerning: true, kerning: 0 }, "Kerning"); }
            else { PS.applyCharStyle({ autoKerning: false, kerning: v }, "Kerning"); }
        }, { allowAuto: true, list: ["Metrics", "0", "-50", "-25", "25", "50", "100"] });
    typeField(grid, PS.TYPE_ICONS.tracking, "Set the tracking for the selected characters (1/1000 em)", fmt(cs.tracking || 0), -1000, 10000, 10, "",
        function (v) { PS.applyCharStyle({ tracking: v }, "Tracking"); }, { list: [-100, -75, -50, -25, -10, -5, 0, 5, 10, 25, 50, 75, 100, 200] });
    typeField(grid, PS.TYPE_ICONS.vscale, "Vertically scale", fmt((cs.verticalScale || 1) * 100), 0, 1000, 1, "%",
        function (v) { PS.applyCharStyle({ verticalScale: v / 100 }, "Vertical Scale"); });
    typeField(grid, PS.TYPE_ICONS.hscale, "Horizontally scale", fmt((cs.horizontalScale || 1) * 100), 0, 1000, 1, "%",
        function (v) { PS.applyCharStyle({ horizontalScale: v / 100 }, "Horizontal Scale"); });
    typeField(grid, PS.TYPE_ICONS.baseline, "Set the baseline shift", fmt(cs.baselineShift || 0), -5000, 5000, 1, "pt",
        function (v) { PS.applyCharStyle({ baselineShift: v }, "Baseline Shift"); });
    var colorCell = document.createElement("div");
    colorCell.className = "tp-field";
    var cl = document.createElement("span");
    cl.className = "tp-label";
    cl.textContent = "Color:";
    colorCell.appendChild(cl);
    colorWell(colorCell, cs);
    grid.appendChild(colorCell);

    // T T TT Tt T1 T1 T T
    var row3 = document.createElement("div");
    row3.className = "tp-row tp-styles";
    [
        ["fauxBold", "Faux Bold", '<b>T</b>', !!cs.fauxBold, function () { return { fauxBold: !cs.fauxBold }; }],
        ["fauxItalic", "Faux Italic", '<i>T</i>', !!cs.fauxItalic, function () { return { fauxItalic: !cs.fauxItalic }; }],
        ["caps", "All Caps", "TT", cs.fontCaps === 2, function () { return { fontCaps: cs.fontCaps === 2 ? 0 : 2 }; }],
        ["small", "Small Caps", 'T<span style="font-size:0.7em">T</span>', cs.fontCaps === 1, function () { return { fontCaps: cs.fontCaps === 1 ? 0 : 1 }; }],
        ["sup", "Superscript", 'T<sup style="font-size:0.6em">1</sup>', cs.fontBaseline === 1, function () { return { fontBaseline: cs.fontBaseline === 1 ? 0 : 1 }; }],
        ["sub", "Subscript", 'T<sub style="font-size:0.6em">1</sub>', cs.fontBaseline === 2, function () { return { fontBaseline: cs.fontBaseline === 2 ? 0 : 2 }; }],
        ["underline", "Underline", '<u>T</u>', !!cs.underline, function () { return { underline: !cs.underline }; }],
        ["strike", "Strikethrough", '<s>T</s>', !!cs.strikethrough, function () { return { strikethrough: !cs.strikethrough }; }]
    ].forEach(function (b) {
        var btn = iconButton(row3, '<span class="tp-glyph">' + b[2] + "</span>", b[1], b[3], function () {
            PS.applyCharStyle(b[4](), b[1]);
        });
        btn.classList.add("tp-style-btn");
    });
    body.appendChild(row3);

    // anti-aliasing
    var row4 = document.createElement("div");
    row4.className = "tp-row";
    var aal = document.createElement("span");
    aal.className = "tp-aa";
    aal.textContent = "aɑ";
    row4.appendChild(aal);
    var aa = PS.selectInput(PS.ANTI_ALIAS, (t && t.antiAlias) || PS.typeDefaults().antiAlias || "smooth");
    aa.title = "Set the anti-aliasing method";
    aa.addEventListener("change", function () { PS.applyTextProp("antiAlias", aa.value, "Anti-alias"); });
    row4.appendChild(aa);
    body.appendChild(row4);
};

PS.ANTI_ALIAS = [
    { v: "none", l: "None" }, { v: "sharp", l: "Sharp" }, { v: "crisp", l: "Crisp" },
    { v: "strong", l: "Strong" }, { v: "smooth", l: "Smooth" }
];

/* ============================================================
   PARAGRAPH PANEL
   ============================================================ */

PS.renderParagraphPanel = function () {
    var body = PS.el("panel-paragraph-body");
    if (!body || !body.isConnected) { return; }
    var ps = PS.currentParaStyle();
    body.innerHTML = "";
    body.className = "panel-body type-panel";

    var row = document.createElement("div");
    row.className = "tp-row tp-align";
    var just = ps.justification || "left";
    [["left", "Left align text"], ["center", "Center text"], ["right", "Right align text"],
        ["justify-left", "Justify last left"], ["justify-center", "Justify last centered"],
        ["justify-right", "Justify last right"], ["justify-all", "Justify all"]].forEach(function (a) {
        iconButton(row, PS.ALIGN_TEXT_ICONS[a[0]], a[1], just === a[0], function () {
            PS.applyParaStyle({ justification: a[0] }, "Alignment");
        });
    });
    body.appendChild(row);

    var grid = document.createElement("div");
    grid.className = "tp-grid";
    body.appendChild(grid);
    typeField(grid, PS.TYPE_ICONS.indentL, "Indent left margin", fmt(ps.startIndent || 0), -1296, 1296, 1, "pt",
        function (v) { PS.applyParaStyle({ startIndent: v }, "Indent"); });
    typeField(grid, PS.TYPE_ICONS.indentR, "Indent right margin", fmt(ps.endIndent || 0), -1296, 1296, 1, "pt",
        function (v) { PS.applyParaStyle({ endIndent: v }, "Indent"); });
    typeField(grid, PS.TYPE_ICONS.indentFirst, "Indent first line", fmt(ps.firstLineIndent || 0), -1296, 1296, 1, "pt",
        function (v) { PS.applyParaStyle({ firstLineIndent: v }, "First Line Indent"); });
    var spacer = document.createElement("div");
    grid.appendChild(spacer);
    typeField(grid, PS.TYPE_ICONS.spaceBefore, "Add space before paragraph", fmt(ps.spaceBefore || 0), 0, 1296, 1, "pt",
        function (v) { PS.applyParaStyle({ spaceBefore: v }, "Space Before"); });
    typeField(grid, PS.TYPE_ICONS.spaceAfter, "Add space after paragraph", fmt(ps.spaceAfter || 0), 0, 1296, 1, "pt",
        function (v) { PS.applyParaStyle({ spaceAfter: v }, "Space After"); });

    var hy = document.createElement("label");
    hy.className = "tp-check";
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = ps.autoHyphenate !== false && ps.autoHyphenate !== undefined ? true : !!ps.autoHyphenate;
    cb.addEventListener("change", function () { PS.applyParaStyle({ autoHyphenate: cb.checked }, "Hyphenate"); });
    hy.appendChild(cb);
    hy.appendChild(document.createTextNode(" Hyphenate"));
    body.appendChild(hy);
};

/* ============================================================
   TYPE OPTIONS BAR
   ============================================================ */

PS.typeOptionsBar = function (host) {
    var tool = PS.tools[PS.tool];
    var cs = PS.currentCharStyle();
    var ps = PS.currentParaStyle();
    var t = PS.currentTextData();
    var p = PS.parsePostScriptName(cs.font && cs.font.name);

    iconButton(host, PS.TYPE_ICONS.orient, "Toggle text orientation", false, function () {
        var tt = PS.typeTarget();
        if (tt.mode === "defaults") { PS.setTool(PS.tool === "text" ? "text-vertical" : "text"); return; }
        PS.setTextOrientation(t && t.orientation === "vertical" ? "horizontal" : "vertical");
    });
    var fam = PS.ui.select(host, "", PS.fontOptions(p.family), p.family, function (v) {
        var style = PS.fontStyleOf(cs.font && cs.font.name);
        if (PS.fontStylesFor(v).indexOf(style) < 0) { style = "Regular"; }
        PS.applyCharStyle({ font: { name: PS.fontPsName(v, style) } }, "Font");
    });
    fam.title = "Set the font family";
    fam.style.width = "150px";
    var sty = PS.ui.select(host, "", PS.fontStylesFor(p.family).map(function (s) { return { v: s, l: s }; }),
        PS.fontStyleOf(cs.font && cs.font.name), function (v) {
            PS.applyCharStyle({ font: { name: PS.fontPsName(p.family, v) } }, "Font Style");
        });
    sty.title = "Set the font style";
    sty.style.width = "92px";
    var g = PS.ui.group(host);
    var szIc = document.createElement("span");
    szIc.className = "tp-icon";
    szIc.innerHTML = PS.TYPE_ICONS.size;
    g.appendChild(szIc);
    typeField(g, "", "Set the font size", fmt(cs.fontSize || 12), 0.01, 1296, 1, "pt",
        function (v) { PS.applyCharStyle({ fontSize: v }, "Font Size"); },
        { list: [6, 7, 8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72] }).parentNode.classList.add("tp-inline");
    var aaWrap = PS.ui.group(host);
    var aal = document.createElement("span");
    aal.className = "tp-aa";
    aal.textContent = "aɑ";
    aaWrap.appendChild(aal);
    var aa = PS.selectInput(PS.ANTI_ALIAS, (t && t.antiAlias) || PS.typeDefaults().antiAlias || "smooth");
    aa.title = "Set the anti-aliasing method";
    aa.addEventListener("change", function () { PS.applyTextProp("antiAlias", aa.value, "Anti-alias"); });
    aaWrap.appendChild(aa);
    PS.ui.sep(host);
    var just = (ps.justification || "left").replace("justify-all", "justify-all");
    [["left", "Left align text"], ["center", "Center text"], ["right", "Right align text"]].forEach(function (a) {
        iconButton(host, PS.ALIGN_TEXT_ICONS[a[0]], a[1], just === a[0], function () {
            PS.applyParaStyle({ justification: a[0] }, "Alignment");
        });
    });
    PS.ui.sep(host);
    colorWell(host, cs);
    iconButton(host, PS.TYPE_ICONS.warp, "Create warped text", t && PS.textIsWarped(t), function () { PS.warpTextDialog(); });
    iconButton(host, PS.TYPE_ICONS.panels, "Toggle the Character and Paragraph panels", false, function () {
        if (PS.ws.isVisible("character")) { PS.ws.hidePanel("character"); } else { PS.ws.showPanel("character"); }
    });
    if (PS.textEdit) {
        PS.ui.sep(host);
        var no = iconButton(host, PS.TYPE_ICONS.cancel, "Cancel any current edits (Esc)", false, function () { PS.cancelTextEdit(); PS.refreshTypeUI(); });
        no.classList.add("opt-pin");
        var ok = iconButton(host, PS.TYPE_ICONS.commit, "Commit any current edits (Ctrl+Enter)", false, function () { PS.commitTextEdit(); PS.refreshTypeUI(); });
        ok.classList.add("tp-commit", "opt-pin");
    }
    void tool;
};

/* ============================================================
   TYPE MENU COMMANDS
   ============================================================ */

function activeTypeLayer(edit) {
    if (PS.textEdit) {
        if (!edit) { PS.commitTextEdit(); }
        else { return PS.textEdit.layer; }
    }
    var l = PS.doc && PS.activeLayer();
    if (l && l.kind === "text" && l.text && l.text.psd) { return l; }
    PS.toast("Select a type layer first", true);
    return null;
}

// change a whole type layer as one undo step
function editTypeLayer(layer, label, fn) {
    typeLayerFlush();
    var before = PS.deepCopy(layer.text), beforeCanvas = PS.cloneCanvas(layer.canvas);
    fn(layer.text.psd);
    PS.renderTextLayer(layer);
    var after = PS.deepCopy(layer.text), afterCanvas = PS.cloneCanvas(layer.canvas);
    PS.pushHistory(label,
        function () { layer.text = PS.deepCopy(before); PS.restoreLayerCanvas(layer, beforeCanvas); PS.refreshTypeUI(); },
        function () { layer.text = PS.deepCopy(after); PS.restoreLayerCanvas(layer, afterCanvas); PS.refreshTypeUI(); });
    PS.requestRender();
    PS.renderLayersPanel();
    PS.refreshTypeUI();
}

// Type > Orientation
PS.setTextOrientation = function (o) {
    var layer = activeTypeLayer(false);
    if (!layer) { return; }
    if ((layer.text.psd.orientation || "horizontal") === o) { return; }
    editTypeLayer(layer, o === "vertical" ? "Vertical Orientation" : "Horizontal Orientation", function (t) { t.orientation = o; });
};

// Type > Convert to Paragraph Text / Convert to Point Text
PS.toggleTextBoxType = function () {
    var layer = activeTypeLayer(false);
    if (!layer) { return; }
    var t = layer.text.psd;
    var lay = PS.textLayout(layer);
    if (t.shapeType === "box" && t.boxBounds) {
        editTypeLayer(layer, "Convert to Point Text", function (tt) {
            // soft line breaks become returns
            var breaks = [];
            lay.lines.forEach(function (l) {
                if (l.wrapped && l.glyphs.length) { breaks.push(l.glyphs[l.glyphs.length - 1].i + 1); }
            });
            breaks.sort(function (a, b) { return b - a; }).forEach(function (i) {
                var prev = tt.text.charAt(i - 1);
                if (prev === " ") { PS.textSplice(tt, i - 1, i, "\n"); } else { PS.textSplice(tt, i, i, "\n"); }
            });
            var first = lay.lines[0];
            var bb = tt.boxBounds;
            var just = ((PS.textParaStyles(tt)[0] || {}).justification || "left").replace("justify-", "");
            var ax = just === "center" ? (bb[0] + bb[2]) / 2 : (just === "right" ? bb[2] : bb[0]);
            var ay = first ? first.baseline : bb[1];
            if (tt.orientation !== "vertical") {
                var m = tt.transform || [1, 0, 0, 1, 0, 0];
                tt.transform = [m[0], m[1], m[2], m[3], m[0] * ax + m[2] * ay + m[4], m[1] * ax + m[3] * ay + m[5]];
            }
            tt.shapeType = "point";
            delete tt.boxBounds;
        });
    } else {
        var r = PS.textLayoutRect(lay);
        editTypeLayer(layer, "Convert to Paragraph Text", function (tt) {
            tt.shapeType = "box";
            if (tt.orientation === "vertical") {
                tt.boxBounds = [-r.y - r.h, r.x, -r.y + 2, r.x + r.w + 4];
            } else {
                tt.boxBounds = [r.x - 1, r.y, r.x + r.w + 4, r.y + r.h + 4];
            }
        });
    }
};

// Type > Warp Text: settings window with a live preview on the layer
PS.warpTextDialog = function () {
    var layer = activeTypeLayer(false);
    if (!layer) { return; }
    var t = layer.text.psd;
    typeLayerFlush();
    var before = PS.deepCopy(layer.text), beforeCanvas = PS.cloneCanvas(layer.canvas);
    var w = Object.assign({ style: "none", value: 0, perspective: 0, perspectiveOther: 0, rotate: "horizontal" }, PS.deepCopy(t.warp || {}));
    if (w.style === "none" || !w.style) { w.style = "none"; }
    var done = false;
    var queued = false;

    function preview() {
        if (queued) { return; }
        queued = true;
        requestAnimationFrame(function () {
            queued = false;
            if (done) { return; }
            layer.text.psd.warp = PS.deepCopy(w);
            PS.renderTextLayer(layer);
            PS.requestRender();
        });
    }

    var sliders = [];
    PS.floatingPanel({
        title: "Warp Text",
        x: Math.max(80, window.innerWidth - 640), y: 110,
        build: function (body) {
            body.classList.add("filter-dialog");
            var styleSel = PS.dialogRow(body, "Style", PS.selectInput(PS.TEXT_WARPS.map(function (s) { return { v: s[0], l: s[1] }; }), w.style));
            styleSel.addEventListener("change", function () {
                w.style = styleSel.value;
                if (w.style !== "none" && !w.value) { w.value = 50; sliders[0].set(50); }
                sliders.forEach(function (s) { s.enable(w.style !== "none"); });
                preview();
            });
            var orow = document.createElement("div");
            orow.className = "form-row";
            var ol = document.createElement("label");
            ol.textContent = "";
            orow.appendChild(ol);
            ["horizontal", "vertical"].forEach(function (o) {
                var lab = document.createElement("label");
                lab.className = "radio-label";
                var rb = document.createElement("input");
                rb.type = "radio";
                rb.name = "warp-orient";
                rb.checked = (w.rotate || "horizontal") === o;
                rb.addEventListener("change", function () { if (rb.checked) { w.rotate = o; preview(); } });
                lab.appendChild(rb);
                lab.appendChild(document.createTextNode(" " + o.charAt(0).toUpperCase() + o.slice(1)));
                orow.appendChild(lab);
            });
            body.appendChild(orow);
            [["value", "Bend"], ["perspective", "Horizontal Distortion"], ["perspectiveOther", "Vertical Distortion"]].forEach(function (f) {
                var row = document.createElement("div");
                row.className = "form-row";
                var lab = document.createElement("label");
                lab.textContent = f[1];
                row.appendChild(lab);
                var range = document.createElement("input");
                range.type = "range";
                range.min = -100; range.max = 100; range.step = 1;
                range.value = w[f[0]] || 0;
                var num = PS.ui.numberField(w[f[0]] || 0, -100, 100, 1, function (v) { w[f[0]] = v; range.value = v; preview(); });
                range.addEventListener("input", function () { w[f[0]] = parseFloat(range.value); num.value = range.value; preview(); });
                row.appendChild(range);
                row.appendChild(num);
                var unit = document.createElement("span");
                unit.className = "unit-label";
                unit.textContent = "%";
                row.appendChild(unit);
                body.appendChild(row);
                sliders.push({
                    set: function (v) { range.value = v; num.value = v; },
                    enable: function (on) { range.disabled = !on; num.disabled = !on; }
                });
            });
            sliders.forEach(function (s) { s.enable(w.style !== "none"); });
        },
        buttons: [
            { label: "Cancel" },
            {
                label: "OK", primary: true, action: function () {
                    done = true;
                    layer.text = PS.deepCopy(before);
                    PS.restoreLayerCanvas(layer, beforeCanvas);
                    editTypeLayer(layer, "Warp Text", function (tt) {
                        if (w.style === "none") { tt.warp = Object.assign({}, w, { style: "none", value: 0, perspective: 0, perspectiveOther: 0 }); }
                        else { tt.warp = PS.deepCopy(w); }
                    });
                }
            }
        ],
        onClose: function () {
            if (done) { return; }
            done = true;
            layer.text = PS.deepCopy(before);
            PS.restoreLayerCanvas(layer, beforeCanvas);
            PS.requestRender();
        }
    });
    preview();
};

/* ============================================================
   PARAGRAPH BOX HANDLES
   ============================================================ */

// handles of the text box being edited, in document space
PS.textBoxHandles = function (layer) {
    var t = layer.text.psd;
    if (t.shapeType !== "box" || !t.boxBounds) { return []; }
    var b = t.boxBounds;
    var m = t.transform || [1, 0, 0, 1, 0, 0];
    var mx = (b[0] + b[2]) / 2, my = (b[1] + b[3]) / 2;
    return [["tl", b[0], b[1]], ["t", mx, b[1]], ["tr", b[2], b[1]], ["r", b[2], my],
        ["br", b[2], b[3]], ["b", mx, b[3]], ["bl", b[0], b[3]], ["l", b[0], my]].map(function (h) {
        var p = PS.applyAffine(m, h[1], h[2]);
        return { id: h[0], x: p.x, y: p.y };
    });
};

PS.textBoxHandleAt = function (layer, pt) {
    var tol = 6 / PS.zoom;
    var hs = PS.textBoxHandles(layer);
    for (var i = 0; i < hs.length; i++) {
        if (Math.abs(hs[i].x - pt.x) <= tol && Math.abs(hs[i].y - pt.y) <= tol) { return hs[i].id; }
    }
    return null;
};

// drag a box handle: the box edges follow the pointer (in text space)
PS.textBoxDrag = function (layer, id, pt) {
    var t = layer.text.psd;
    var m = t.transform || [1, 0, 0, 1, 0, 0];
    var det = m[0] * m[3] - m[1] * m[2] || 1;
    var dx = pt.x - m[4], dy = pt.y - m[5];
    var lx = (m[3] * dx - m[2] * dy) / det, ly = (-m[1] * dx + m[0] * dy) / det;
    var b = t.boxBounds.slice();
    var min = 4;
    if (id.indexOf("l") >= 0) { b[0] = Math.min(lx, b[2] - min); }
    if (id.indexOf("r") >= 0) { b[2] = Math.max(lx, b[0] + min); }
    if (id.indexOf("t") >= 0) { b[1] = Math.min(ly, b[3] - min); }
    if (id.indexOf("b") >= 0) { b[3] = Math.max(ly, b[1] + min); }
    t.boxBounds = b;
    PS.renderTextLayer(layer);
    PS.positionTextEditor();
    PS.requestRender();
};

/* ============================================================
   TOOLS
   ============================================================ */

PS.installTypeTools = function () {
    var base = PS.tools.text;
    if (!base) { return; }
    base.name = "Horizontal Type";
    base.options = PS.typeOptionsBar;
    // box handles take the press before the tool's own logic
    var down = base.onDown, move = base.onMove, up = base.onUp;
    var boxDrag = null;
    base.onDown = function (pt, e) {
        if (PS.textEdit) {
            var id = PS.textBoxHandleAt(PS.textEdit.layer, pt);
            if (id) { boxDrag = id; return; }
        }
        down.call(this, pt, e);
    };
    base.onMove = function (pt, e) {
        if (boxDrag && PS.textEdit) { PS.textBoxDrag(PS.textEdit.layer, boxDrag, pt); return; }
        if (!PS._pointer.down && PS.textEdit) {
            var id = PS.textBoxHandleAt(PS.textEdit.layer, pt);
            if (id) {
                PS.el("workspace").style.cursor = { tl: "nwse-resize", br: "nwse-resize", tr: "nesw-resize", bl: "nesw-resize", t: "ns-resize", b: "ns-resize", l: "ew-resize", r: "ew-resize" }[id];
                return;
            }
        }
        move.call(this, pt, e);
    };
    base.onUp = function (pt, e) {
        if (boxDrag) {
            boxDrag = null;
            if (PS.textEdit) { PS.textEdit.editorEl.focus(); }
            return;
        }
        up.call(this, pt, e);
    };
    var vt = Object.assign({}, base, {
        name: "Vertical Type",
        icon: PS.TYPE_ICONS.vtype
    });
    PS.registerTool("text-vertical", vt);
    // the T key cycles both type tools
    PS._toolGroups.t = ["text", "text-vertical"];
    PS.toolbarLayout.forEach(function (entry, i) {
        if (entry.kind === "single" && entry.tool === "text") {
            PS.toolbarLayout[i] = { kind: "group", id: "type", tools: ["text", "text-vertical"] };
        }
    });
    PS.groupRep.type = PS.groupRep.type || "text";
};
