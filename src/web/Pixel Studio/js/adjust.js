/*
    Pixel Studio - adjustment layers (GPU)

    Every adjustment layer type of the PSD format renders live on the GPU:
    Brightness/Contrast, Levels, Curves, Exposure, Vibrance, Hue/Saturation,
    Color Balance, Black & White, Photo Filter, Channel Mixer, Color Lookup,
    Invert, Posterize, Threshold, Gradient Map and Selective Color.

    The settings stay in ag-psd's AdjustmentLayer shape (layer.adjustment)
    so they are saved back to the PSD exactly as edited. Per-channel tone
    adjustments are baked into a 256-entry lookup table on the CPU; the rest
    are evaluated per pixel in the "adjust" shader.

    An adjustment changes the composite of everything below it (or, when
    clipped, of its clipping group) and is blended back with the layer's
    blend mode, opacity and masks.
*/
"use strict";

PS.ADJUSTMENTS = [
    ["brightness/contrast", "Brightness/Contrast"],
    ["levels", "Levels"],
    ["curves", "Curves"],
    ["exposure", "Exposure"],
    null,
    ["vibrance", "Vibrance"],
    ["hue/saturation", "Hue/Saturation"],
    ["color balance", "Color Balance"],
    ["black & white", "Black & White"],
    ["photo filter", "Photo Filter"],
    ["channel mixer", "Channel Mixer"],
    ["color lookup", "Color Lookup"],
    null,
    ["invert", "Invert"],
    ["posterize", "Posterize"],
    ["threshold", "Threshold"],
    ["gradient map", "Gradient Map"],
    ["selective color", "Selective Color"]
];

PS.adjustmentLabel = function (type) {
    for (var i = 0; i < PS.ADJUSTMENTS.length; i++) {
        if (PS.ADJUSTMENTS[i] && PS.ADJUSTMENTS[i][0] === type) { return PS.ADJUSTMENTS[i][1]; }
    }
    return "Adjustment";
};

PS.adjustmentIcon = function (adj) {
    var t = adj && adj.type;
    if (t === "curves") { return '<svg viewBox="0 0 24 24" stroke-width="1.6"><rect x="3" y="3" width="18" height="18"/><path d="M4 20C10 20 12 4 20 4"/></svg>'; }
    if (t === "levels") { return '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M3 20h18M5 20V12M9 20V6M13 20V9M17 20V14"/></svg>'; }
    if (t === "hue/saturation" || t === "vibrance" || t === "color balance" || t === "selective color") {
        return '<svg viewBox="0 0 24 24" stroke-width="1.6"><circle cx="9" cy="10" r="5"/><circle cx="15" cy="10" r="5"/><circle cx="12" cy="15" r="5"/></svg>';
    }
    if (t === "gradient map") { return '<svg viewBox="0 0 24 24" stroke-width="1.6"><rect x="3" y="7" width="18" height="10"/><path d="M8 7v10M13 7v10M18 7v10"/></svg>'; }
    if (t === "invert" || t === "threshold" || t === "posterize" || t === "black & white") {
        return '<svg viewBox="0 0 24 24" stroke-width="1.6"><rect x="3" y="3" width="18" height="18"/><path d="M3 21 21 3v18z" fill="currentColor"/></svg>';
    }
    return null;
};

/* ---------- defaults for new adjustment layers ---------- */

PS.defaultAdjustment = function (type) {
    var lv = function () { return { shadowInput: 0, highlightInput: 255, shadowOutput: 0, highlightOutput: 255, midtoneInput: 1 }; };
    var hs = function (a, b, c, d) { return { a: a, b: b, c: c, d: d, hue: 0, saturation: 0, lightness: 0 }; };
    var cmyk = function () { return { c: 0, m: 0, y: 0, k: 0 }; };
    switch (type) {
        case "brightness/contrast": return { type: type, brightness: 0, contrast: 0, meanValue: 127, useLegacy: false, labColorOnly: false, auto: false };
        case "levels": return { type: type, rgb: lv(), red: lv(), green: lv(), blue: lv() };
        case "curves": return { type: type, rgb: [{ input: 0, output: 0 }, { input: 255, output: 255 }] };
        case "exposure": return { type: type, exposure: 0, offset: 0, gamma: 1 };
        case "vibrance": return { type: type, vibrance: 0, saturation: 0 };
        case "hue/saturation": return {
            type: type, master: hs(0, 0, 0, 0),
            reds: hs(315, 345, 15, 45), yellows: hs(15, 45, 75, 105), greens: hs(75, 105, 135, 165),
            cyans: hs(135, 165, 195, 225), blues: hs(195, 225, 255, 285), magentas: hs(255, 285, 315, 345)
        };
        case "color balance": return {
            type: type, preserveLuminosity: true,
            shadows: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
            midtones: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
            highlights: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 }
        };
        case "black & white": return { type: type, reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80, useTint: false, tintColor: { r: 225, g: 211, b: 179 } };
        case "photo filter": return { type: type, color: { r: 236, g: 138, b: 0 }, density: 0.25, preserveLuminosity: true };
        case "channel mixer": return {
            type: type, monochrome: false,
            red: { red: 100, green: 0, blue: 0, constant: 0 },
            green: { red: 0, green: 100, blue: 0, constant: 0 },
            blue: { red: 0, green: 0, blue: 100, constant: 0 },
            gray: { red: 40, green: 40, blue: 20, constant: 0 }
        };
        case "color lookup": return { type: type, lookupType: "3dlut", name: "", dither: false };
        case "invert": return { type: type };
        case "posterize": return { type: type, levels: 4 };
        case "threshold": return { type: type, level: 128 };
        case "gradient map": return {
            type: type, gradientType: "solid", name: "Foreground to Background", reverse: false, dither: false,
            colorStops: [
                { location: 0, midpoint: 0.5, color: PS.hexToPsdColor(PS.fg) },
                { location: 1, midpoint: 0.5, color: PS.hexToPsdColor(PS.bg) }
            ],
            opacityStops: [{ location: 0, midpoint: 0.5, opacity: 1 }, { location: 1, midpoint: 0.5, opacity: 1 }]
        };
        case "selective color": return {
            type: type, mode: "relative",
            reds: cmyk(), yellows: cmyk(), greens: cmyk(), cyans: cmyk(), blues: cmyk(), magentas: cmyk(),
            whites: cmyk(), neutrals: cmyk(), blacks: cmyk()
        };
    }
    return { type: type };
};

PS.newAdjustmentLayer = function (type) {
    if (!PS.doc) { return; }
    var layer = PS.makeLayer(PS.adjustmentLabel(type) + " 1", 1, 1, "adjustment");
    layer.adjustment = PS.defaultAdjustment(type);
    // an adjustment starts with a white mask (from the selection when there is one)
    var d = PS.doc;
    layer.mask = PS.makeMask(d.width, d.height, d.selection ? 0 : 255);
    if (d.selection) {
        var tint = PS.createCanvas(d.width, d.height);
        var tctx = tint.getContext("2d");
        tctx.fillStyle = "#fff";
        tctx.fillRect(0, 0, d.width, d.height);
        tctx.globalCompositeOperation = "destination-in";
        tctx.drawImage(d.selection.mask, 0, 0);
        layer.mask.canvas.getContext("2d").drawImage(tint, 0, 0);
    }
    PS.addLayerObject(layer, "New " + PS.adjustmentLabel(type) + " Layer");
    PS.showLayerProperties(layer);
};

PS.adjustmentMenuItems = function () {
    return PS.ADJUSTMENTS.map(function (a) {
        if (!a) { return { sep: true }; }
        return { label: a[1] + "...", action: function () { PS.newAdjustmentLayer(a[0]); } };
    });
};

/* ============================================================
   CPU side: lookup tables
   ============================================================ */

// Natural cubic spline through Curves points (0..255) -> 256 values
PS.curveSpline = function (points) {
    var pts = (points || []).slice().sort(function (a, b) { return a.input - b.input; });
    if (pts.length < 2) { pts = [{ input: 0, output: 0 }, { input: 255, output: 255 }]; }
    var n = pts.length;
    var x = pts.map(function (p) { return p.input; }), y = pts.map(function (p) { return p.output; });
    var out = new Float32Array(256);
    if (n === 2) {
        for (var i = 0; i < 256; i++) {
            var t = (i - x[0]) / Math.max(1e-6, x[1] - x[0]);
            out[i] = i <= x[0] ? y[0] : (i >= x[1] ? y[1] : y[0] + (y[1] - y[0]) * t);
        }
        return out;
    }
    // second derivatives (natural spline)
    var u = new Float64Array(n), y2 = new Float64Array(n);
    for (i = 1; i < n - 1; i++) {
        var sig = (x[i] - x[i - 1]) / (x[i + 1] - x[i - 1]);
        var p = sig * y2[i - 1] + 2;
        y2[i] = (sig - 1) / p;
        u[i] = (y[i + 1] - y[i]) / (x[i + 1] - x[i]) - (y[i] - y[i - 1]) / (x[i] - x[i - 1]);
        u[i] = (6 * u[i] / (x[i + 1] - x[i - 1]) - sig * u[i - 1]) / p;
    }
    for (i = n - 2; i >= 0; i--) { y2[i] = y2[i] * y2[i + 1] + u[i]; }
    var k = 0;
    for (i = 0; i < 256; i++) {
        if (i <= x[0]) { out[i] = y[0]; continue; }
        if (i >= x[n - 1]) { out[i] = y[n - 1]; continue; }
        while (k < n - 2 && i > x[k + 1]) { k++; }
        var h = x[k + 1] - x[k];
        var a = (x[k + 1] - i) / h, b = (i - x[k]) / h;
        out[i] = a * y[k] + b * y[k + 1] + ((a * a * a - a) * y2[k] + (b * b * b - b) * y2[k + 1]) * h * h / 6;
    }
    return out;
};

function levelsCurve(c) {
    var out = new Float32Array(256);
    if (!c) { for (var j = 0; j < 256; j++) { out[j] = j; } return out; }
    var lo = c.shadowInput || 0, hi = c.highlightInput === undefined ? 255 : c.highlightInput;
    var olo = c.shadowOutput || 0, ohi = c.highlightOutput === undefined ? 255 : c.highlightOutput;
    var g = c.midtoneInput || 1;
    for (var i = 0; i < 256; i++) {
        var v = PS.clamp((i - lo) / Math.max(1, hi - lo), 0, 1);
        v = Math.pow(v, 1 / g);
        out[i] = olo + v * (ohi - olo);
    }
    return out;
}

function compose(inner, outer) {
    var out = new Float32Array(256);
    for (var i = 0; i < 256; i++) {
        var v = PS.clamp(inner[i], 0, 255);
        var i0 = Math.floor(v), f = v - i0;
        out[i] = outer[i0] * (1 - f) + outer[Math.min(255, i0 + 1)] * f;
    }
    return out;
}

function identity() {
    var out = new Float32Array(256);
    for (var i = 0; i < 256; i++) { out[i] = i; }
    return out;
}

// Per-channel tables [r, g, b] of a tone adjustment (null when it is not one)
PS.adjustmentCurves = function (adj) {
    var r, g, b, i, v;
    switch (adj.type) {
        case "levels": {
            var m = levelsCurve(adj.rgb);
            return [compose(levelsCurve(adj.red), m), compose(levelsCurve(adj.green), m), compose(levelsCurve(adj.blue), m)];
        }
        case "curves": {
            var mc = adj.rgb ? PS.curveSpline(adj.rgb) : identity();
            return [compose(adj.red ? PS.curveSpline(adj.red) : identity(), mc),
                compose(adj.green ? PS.curveSpline(adj.green) : identity(), mc),
                compose(adj.blue ? PS.curveSpline(adj.blue) : identity(), mc)];
        }
        case "brightness/contrast": {
            var bc = new Float32Array(256);
            var br = (adj.brightness || 0), ct = (adj.contrast || 0);
            var mean = adj.meanValue === undefined ? 127 : adj.meanValue;
            for (i = 0; i < 256; i++) {
                v = i / 255;
                if (adj.useLegacy) {
                    v = v + br / 255;
                    v = (v - 0.5) * (1 + ct / 100) + 0.5;
                } else {
                    // brightness bends the midtones (blacks and whites stay put),
                    // contrast is an S-curve around the image mean
                    v = Math.pow(v, 1 / (1 + br / 100 * (br >= 0 ? 1 : 0.67)));
                    var mv = mean / 255;
                    var k = ct / 100;
                    if (k >= 0) {
                        var s = v < mv ? mv * Math.pow(v / Math.max(mv, 1e-6), 1 + k)
                            : 1 - (1 - mv) * Math.pow((1 - v) / Math.max(1 - mv, 1e-6), 1 + k);
                        v = s;
                    } else {
                        v = mv + (v - mv) * (1 + k);
                    }
                }
                bc[i] = PS.clamp(v, 0, 1) * 255;
            }
            return [bc, bc, bc];
        }
        case "exposure": {
            var ex = new Float32Array(256);
            var e = Math.pow(2, adj.exposure || 0), off = adj.offset || 0, gm = adj.gamma || 1;
            for (i = 0; i < 256; i++) {
                v = i / 255;
                var lin = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
                lin = Math.max(0, lin * e + off);
                lin = Math.pow(lin, 1 / gm);
                v = lin <= 0.0031308 ? 12.92 * lin : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
                ex[i] = PS.clamp(v, 0, 1) * 255;
            }
            return [ex, ex, ex];
        }
        case "posterize": {
            var n = PS.clamp(adj.levels || 4, 2, 255);
            var po = new Float32Array(256);
            for (i = 0; i < 256; i++) { po[i] = Math.min(n - 1, Math.floor(i / 256 * n)) / (n - 1) * 255; }
            return [po, po, po];
        }
        case "invert": {
            var iv = new Float32Array(256);
            for (i = 0; i < 256; i++) { iv[i] = 255 - i; }
            return [iv, iv, iv];
        }
        case "color balance": {
            r = new Float32Array(256); g = new Float32Array(256); b = new Float32Array(256);
            var tones = ["shadows", "midtones", "highlights"];
            var A = 0.25, B = 0.333, SC = 0.7;
            for (i = 0; i < 256; i++) {
                v = i / 255;
                var w = [
                    PS.clamp((v - B) / -A + 0.5, 0, 1) * SC,
                    PS.clamp((v - B) / A + 0.5, 0, 1) * PS.clamp((v + B - 1) / -A + 0.5, 0, 1) * SC,
                    PS.clamp((v + B - 1) / A + 0.5, 0, 1) * SC
                ];
                var dr = 0, dg = 0, db = 0;
                tones.forEach(function (t, ti) {
                    var tv = adj[t] || {};
                    dr += (tv.cyanRed || 0) / 100 * w[ti];
                    dg += (tv.magentaGreen || 0) / 100 * w[ti];
                    db += (tv.yellowBlue || 0) / 100 * w[ti];
                });
                r[i] = PS.clamp(v + dr, 0, 1) * 255;
                g[i] = PS.clamp(v + dg, 0, 1) * 255;
                b[i] = PS.clamp(v + db, 0, 1) * 255;
            }
            return [r, g, b];
        }
    }
    return null;
};

function curvesLut(curves) {
    var lut = new Uint8Array(256 * 4);
    for (var i = 0; i < 256; i++) {
        lut[i * 4] = PS.clamp(Math.round(curves[0][i]), 0, 255);
        lut[i * 4 + 1] = PS.clamp(Math.round(curves[1][i]), 0, 255);
        lut[i * 4 + 2] = PS.clamp(Math.round(curves[2][i]), 0, 255);
        lut[i * 4 + 3] = 255;
    }
    return lut;
}

/* ---------- 3D lookup tables (Color Lookup) ---------- */

// Parse .cube / .3dl text into {size, data: Uint8Array size^3 RGBA}, R fastest
PS.parseLut3D = function (text, format) {
    var lines = text.split(/\r?\n/);
    var size = 0, values = [];
    var min = [0, 0, 0], max = [1, 1, 1];
    if (format === "3dl" || (!/LUT_3D_SIZE/i.test(text) && /^\s*\d+(\s+\d+){5,}/m.test(text))) {
        // .3dl: an input ramp line, then integer triples with blue changing fastest
        var ints = [], ramp = null, maxv = 0;
        lines.forEach(function (l) {
            l = l.trim();
            if (!l || l.charAt(0) === "#" || /^[a-z]/i.test(l)) { return; }
            var parts = l.split(/\s+/).map(Number);
            if (parts.length > 3 && !ramp) { ramp = parts; return; }
            if (parts.length === 3) { ints.push(parts); parts.forEach(function (p) { if (p > maxv) { maxv = p; } }); }
        });
        size = Math.round(Math.cbrt(ints.length));
        if (size < 2) { return null; }
        var scale = maxv > 4095 ? 65535 : (maxv > 1023 ? 4095 : (maxv > 255 ? 1023 : 255));
        var data3 = new Uint8Array(size * size * size * 4);
        for (var ri = 0; ri < size; ri++) {
            for (var gi = 0; gi < size; gi++) {
                for (var bi = 0; bi < size; bi++) {
                    var src = ints[(ri * size + gi) * size + bi];
                    var dst = ((bi * size + gi) * size + ri) * 4;
                    data3[dst] = Math.round(src[0] / scale * 255);
                    data3[dst + 1] = Math.round(src[1] / scale * 255);
                    data3[dst + 2] = Math.round(src[2] / scale * 255);
                    data3[dst + 3] = 255;
                }
            }
        }
        return { size: size, data: data3 };
    }
    lines.forEach(function (l) {
        l = l.trim();
        if (!l || l.charAt(0) === "#") { return; }
        var m;
        if ((m = /^LUT_3D_SIZE\s+(\d+)/i.exec(l))) { size = parseInt(m[1], 10); return; }
        if ((m = /^DOMAIN_MIN\s+(\S+)\s+(\S+)\s+(\S+)/i.exec(l))) { min = [+m[1], +m[2], +m[3]]; return; }
        if ((m = /^DOMAIN_MAX\s+(\S+)\s+(\S+)\s+(\S+)/i.exec(l))) { max = [+m[1], +m[2], +m[3]]; return; }
        if (/^[a-z_]/i.test(l)) { return; }
        var p = l.split(/\s+/);
        if (p.length >= 3) { values.push(+p[0], +p[1], +p[2]); }
    });
    if (!size || values.length < size * size * size * 3) { return null; }
    var data = new Uint8Array(size * size * size * 4);
    for (var i = 0; i < size * size * size; i++) {
        for (var c = 0; c < 3; c++) {
            var v = (values[i * 3 + c] - min[c]) / Math.max(1e-6, max[c] - min[c]);
            data[i * 4 + c] = PS.clamp(Math.round(v * 255), 0, 255);
        }
        data[i * 4 + 3] = 255;
    }
    return { size: size, data: data };
};

PS.adjustmentLut3D = function (adj) {
    if (adj._lut3d && adj._lut3dKey === (adj.lut3DFileName || adj.name)) { return adj._lut3d; }
    var lut = null;
    if (adj.lut3DFileData && adj.lut3DFileData.length) {
        var bytes = adj.lut3DFileData instanceof Uint8Array ? adj.lut3DFileData : new Uint8Array(Object.values(adj.lut3DFileData));
        var text = "";
        for (var i = 0; i < bytes.length; i += 8192) {
            text += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        }
        lut = PS.parseLut3D(text, adj.lutFormat);
    }
    Object.defineProperty(adj, "_lut3d", { value: lut, writable: true, configurable: true, enumerable: false });
    Object.defineProperty(adj, "_lut3dKey", { value: adj.lut3DFileName || adj.name, writable: true, configurable: true, enumerable: false });
    return lut;
};

/* ============================================================
   GPU
   ============================================================ */

PS.gpu.defineProgram("adjust", [
    "uniform sampler2D uDst; uniform int uType; uniform sampler2D uLut; uniform highp sampler3D uLut3D; uniform float uLut3DSize;",
    "uniform int uMode; uniform float uOpacity; uniform sampler2D uClip; uniform int uHasClip;",
    "uniform vec4 uP0; uniform vec4 uP1; uniform vec4 uP2; uniform vec4 uP3;",
    "uniform vec4 uHsRange[6]; uniform vec3 uHsAdj[7];",
    "uniform vec4 uSc[9];",
    "vec3 lutRGB(vec3 c) {",
    "    vec3 x = clamp(c, 0.0, 1.0) * 255.0; ivec3 i0 = ivec3(floor(x)); ivec3 i1 = min(i0 + 1, ivec3(255)); vec3 f = fract(x);",
    "    return vec3(mix(texelFetch(uLut, ivec2(i0.r, 0), 0).r, texelFetch(uLut, ivec2(i1.r, 0), 0).r, f.r),",
    "                mix(texelFetch(uLut, ivec2(i0.g, 0), 0).g, texelFetch(uLut, ivec2(i1.g, 0), 0).g, f.g),",
    "                mix(texelFetch(uLut, ivec2(i0.b, 0), 0).b, texelFetch(uLut, ivec2(i1.b, 0), 0).b, f.b));",
    "}",
    "vec4 lut1(float t) { float x = clamp(t, 0.0, 1.0) * 255.0; int i0 = int(floor(x)); int i1 = min(i0 + 1, 255);",
    "    return mix(texelFetch(uLut, ivec2(i0, 0), 0), texelFetch(uLut, ivec2(i1, 0), 0), fract(x)); }",
    "vec3 rgb2hsl(vec3 c) {",
    "    float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b); float l = (mx + mn) * 0.5;",
    "    if (mx - mn < 1e-6) return vec3(0.0, 0.0, l);",
    "    float d = mx - mn; float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);",
    "    float h; if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0); else if (mx == c.g) h = (c.b - c.r) / d + 2.0; else h = (c.r - c.g) / d + 4.0;",
    "    return vec3(h * 60.0, s, l);",
    "}",
    "float hue2(float p, float q, float t) { t = fract(t); if (t < 1.0/6.0) return p + (q - p) * 6.0 * t; if (t < 0.5) return q; if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0; return p; }",
    "vec3 hsl2rgb(vec3 h) {",
    "    if (h.y <= 0.0) return vec3(h.z);",
    "    float q = h.z < 0.5 ? h.z * (1.0 + h.y) : h.z + h.y - h.z * h.y; float p = 2.0 * h.z - q; float t = h.x / 360.0;",
    "    return vec3(hue2(p, q, t + 1.0/3.0), hue2(p, q, t), hue2(p, q, t - 1.0/3.0));",
    "}",
    "float rangeW(float h, vec4 r) {",
    // Hue/Saturation range: 0 outside a..d, ramps a->b and c->d (degrees, may wrap)
    "    float a = r.x, b = r.y, c = r.z, d = r.w;",
    "    float hh = h; if (b < a) b += 360.0; if (c < b) c += 360.0; if (d < c) d += 360.0;",
    "    if (hh < a) hh += 360.0;",
    "    if (hh < a || hh > d) return 0.0;",
    "    if (hh < b) return (hh - a) / max(b - a, 1e-3);",
    "    if (hh <= c) return 1.0;",
    "    return 1.0 - (hh - c) / max(d - c, 1e-3);",
    "}",
    "vec3 hsAdjust(vec3 hsl, vec3 adj, float w) {",
    "    hsl.x = mod(hsl.x + adj.x * w + 360.0, 360.0);",
    "    float s = adj.y * w / 100.0;",
    "    hsl.y = clamp(hsl.y * (1.0 + s), 0.0, 1.0);",
    "    float l = adj.z * w / 100.0;",
    "    hsl.z = l >= 0.0 ? hsl.z + (1.0 - hsl.z) * l : hsl.z * (1.0 + l);",
    "    return hsl;",
    "}",
    "float scChan(float v, float cmy, float k, bool rel) {",
    "    float d = (-1.0 - cmy) * k - cmy;",
    "    if (rel) d *= (1.0 - v);",
    "    return d;",
    "}",
    "vec3 adjustColor(vec3 c, ivec2 p) {",
    "    if (uType == 1) return lutRGB(c);",
    "    if (uType == 2) {",       // hue / saturation
    "        vec3 hsl = rgb2hsl(c);",
    "        vec3 res = hsl;",
    "        for (int i = 0; i < 6; i++) {",
    "            if (uHsAdj[i + 1] == vec3(0.0)) continue;",
    "            float w = rangeW(hsl.x, uHsRange[i]);",
    "            if (w > 0.0) res = hsAdjust(res, uHsAdj[i + 1], w);",
    "        }",
    "        res = hsAdjust(res, uHsAdj[0], 1.0);",
    "        return hsl2rgb(res);",
    "    }",
    "    if (uType == 3) {",       // vibrance + saturation
    "        float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b);",
    "        float l = lum(c); float s = mx - mn;",
    "        float vib = uP0.x * (1.0 - s) * (1.0 - abs(c.r - c.g) * 0.5);",
    "        vec3 r = mix(vec3(l), c, 1.0 + vib);",
    "        r = mix(vec3(lum(r)), r, 1.0 + uP0.y);",
    "        return clamp(r, 0.0, 1.0);",
    "    }",
    "    if (uType == 4) { vec3 r = lutRGB(c); return setLum(r, lum(c)); }",   // color balance + luminosity
    "    if (uType == 5) {",       // black & white: weights r, y, g, c, b, m in uP0 / uP1
    "        float r = c.r, g = c.g, b = c.b; float gray;",
    "        float wr = uP0.x, wy = uP0.y, wg = uP0.z, wc = uP0.w, wb = uP1.x, wm = uP1.y;",
    "        if (r >= g && g >= b) gray = b + (g - b) * wy + (r - g) * wr;",
    "        else if (r >= b && b >= g) gray = g + (b - g) * wm + (r - b) * wr;",
    "        else if (g >= r && r >= b) gray = b + (r - b) * wy + (g - r) * wg;",
    "        else if (g >= b && b >= r) gray = r + (b - r) * wc + (g - b) * wg;",
    "        else if (b >= g && g >= r) gray = r + (g - r) * wc + (b - g) * wb;",
    "        else gray = g + (r - g) * wm + (b - r) * wb;",
    "        gray = clamp(gray, 0.0, 1.0);",
    "        if (uP1.z > 0.5) return setLum(uP2.rgb, gray);",
    "        return vec3(gray);",
    "    }",
    "    if (uType == 6) {",       // photo filter: colour uP0.rgb, density uP0.w, preserve uP1.x
    "        vec3 f = mix(c, c * uP0.rgb, uP0.w);",
    "        if (uP1.x > 0.5) f = setLum(f, lum(c));",
    "        return clamp(f, 0.0, 1.0);",
    "    }",
    "    if (uType == 7) {",       // channel mixer rows in uP0..uP2 (rgb weights + constant)
    "        vec3 r = vec3(dot(c, uP0.rgb) + uP0.w, dot(c, uP1.rgb) + uP1.w, dot(c, uP2.rgb) + uP2.w);",
    "        return clamp(r, 0.0, 1.0);",
    "    }",
    "    if (uType == 8) {",       // 3D lookup
    "        vec3 q = clamp(c, 0.0, 1.0) * (uLut3DSize - 1.0) / uLut3DSize + 0.5 / uLut3DSize;",
    "        return texture(uLut3D, q).rgb;",
    "    }",
    "    if (uType == 9) { float l = dot(c, vec3(0.299, 0.587, 0.114)); return vec3(step(uP0.x, l + 1e-4)); }",
    "    if (uType == 10) {",      // gradient map
    "        float l = dot(c, vec3(0.299, 0.587, 0.114));",
    "        if (uP0.x > 0.5) l += (hash12(vec2(p)) - 0.5) / 255.0;",
    "        vec4 g = lut1(l); return mix(c, g.rgb, g.a);",
    "    }",
    "    if (uType == 11) {",      // selective colour: uSc[i] = (c, m, y, k) per range, uP0.x relative
    "        float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b);",
    "        float md = c.r + c.g + c.b - mx - mn;",
    "        float w[9];",
    "        w[0] = (mx == c.r) ? mx - md : 0.0;",
    "        w[1] = (mn == c.b) ? md - mn : 0.0;",
    "        w[2] = (mx == c.g) ? mx - md : 0.0;",
    "        w[3] = (mn == c.r) ? md - mn : 0.0;",
    "        w[4] = (mx == c.b) ? mx - md : 0.0;",
    "        w[5] = (mn == c.g) ? md - mn : 0.0;",
    "        w[6] = mn > 0.5 ? (mn - 0.5) * 2.0 : 0.0;",
    "        w[7] = (mx == mn) ? 1.0 : max(0.0, 1.0 - (abs(mx - 0.5) + abs(mn - 0.5)));",
    "        w[8] = mx < 0.5 ? (0.5 - mx) * 2.0 : 0.0;",
    "        bool rel = uP0.x > 0.5;",
    "        vec3 d = vec3(0.0);",
    "        for (int i = 0; i < 9; i++) {",
    "            if (w[i] <= 0.0) continue;",
    "            vec4 a = uSc[i];",
    "            d.r += scChan(c.r, a.x, a.w, rel) * w[i];",
    "            d.g += scChan(c.g, a.y, a.w, rel) * w[i];",
    "            d.b += scChan(c.b, a.z, a.w, rel) * w[i];",
    "        }",
    "        return clamp(c + d, 0.0, 1.0);",
    "    }",
    "    return c;",
    "}",
    "void main() {",
    "    ivec2 p = px();",
    "    vec4 dst = texelFetch(uDst, p, 0);",
    "    if (dst.a <= 0.0) { outColor = dst; return; }",
    "    vec3 a = adjustColor(dst.rgb, p);",
    "    float w = uOpacity * maskAt(p);",
    "    if (uHasClip == 1) w *= texelFetch(uClip, p, 0).a;",
    "    vec3 bl = clamp(blendRGB(uMode, dst.rgb, a), 0.0, 1.0);",
    "    if (uMode == 2) w = (hash12(vec2(p)) < w) ? 1.0 : 0.0;",
    "    outColor = vec4(mix(dst.rgb, bl, clamp(w, 0.0, 1.0)), dst.a);",
    "}"
].join("\n"), { blend: true, mask: true });

PS.gpuAdjust = (function () {
    var G = PS.gpu;

    function uniformsFor(adj, layerId) {
        var u = { uType: 0 };
        var key;
        var curves = PS.adjustmentCurves(adj);
        if (curves) {
            key = "adj:" + layerId + ":" + JSON.stringify(adj);
            u.uLut = G.dataTexture(key, 256, 1, curvesLut(curves), key);
            u.uType = (adj.type === "color balance" && adj.preserveLuminosity) ? 4 : 1;
            return u;
        }
        switch (adj.type) {
            case "hue/saturation": {
                var names = ["reds", "yellows", "greens", "cyans", "blues", "magentas"];
                var ranges = [], adjs = [];
                var m = adj.master || {};
                adjs.push(m.hue || 0, m.saturation || 0, m.lightness || 0);
                names.forEach(function (n) {
                    var r = adj[n] || { a: 0, b: 0, c: 0, d: 0 };
                    ranges.push(r.a || 0, r.b || 0, r.c || 0, r.d || 0);
                    adjs.push(r.hue || 0, r.saturation || 0, r.lightness || 0);
                });
                u.uType = 2; u.uHsRange = ranges; u.uHsAdj = adjs;
                return u;
            }
            case "vibrance":
                u.uType = 3; u.uP0 = [(adj.vibrance || 0) / 100, (adj.saturation || 0) / 100, 0, 0];
                return u;
            case "black & white": {
                var tint = PS.psdColorToRgb(adj.tintColor || { r: 225, g: 211, b: 179 });
                u.uType = 5;
                u.uP0 = [(adj.reds === undefined ? 40 : adj.reds) / 100, (adj.yellows === undefined ? 60 : adj.yellows) / 100,
                    (adj.greens === undefined ? 40 : adj.greens) / 100, (adj.cyans === undefined ? 60 : adj.cyans) / 100];
                u.uP1 = [(adj.blues === undefined ? 20 : adj.blues) / 100, (adj.magentas === undefined ? 80 : adj.magentas) / 100, adj.useTint ? 1 : 0, 0];
                u.uP2 = [tint[0] / 255, tint[1] / 255, tint[2] / 255, 0];
                return u;
            }
            case "photo filter": {
                var fc = PS.photoFilterRgb(adj.color);
                u.uType = 6;
                u.uP0 = [fc[0] / 255, fc[1] / 255, fc[2] / 255, adj.density === undefined ? 0.25 : adj.density];
                u.uP1 = [adj.preserveLuminosity === false ? 0 : 1, 0, 0, 0];
                return u;
            }
            case "channel mixer": {
                var row = function (r) { r = r || {}; return [(r.red || 0) / 100, (r.green || 0) / 100, (r.blue || 0) / 100, (r.constant || 0) / 100]; };
                u.uType = 7;
                if (adj.monochrome) {
                    var gr = row(adj.gray);
                    u.uP0 = gr; u.uP1 = gr; u.uP2 = gr;
                } else {
                    u.uP0 = row(adj.red || { red: 100 }); u.uP1 = row(adj.green || { green: 100 }); u.uP2 = row(adj.blue || { blue: 100 });
                }
                return u;
            }
            case "color lookup": {
                var lut = PS.adjustmentLut3D(adj);
                if (!lut) { return null; }
                key = "lut3d:" + (adj.lut3DFileName || adj.name) + ":" + lut.size;
                u.uType = 8; u.uLut3D = G.texture3D(key, lut.size, lut.data, key); u.uLut3DSize = lut.size;
                return u;
            }
            case "threshold":
                u.uType = 9; u.uP0 = [(adj.level === undefined ? 128 : adj.level) / 255, 0, 0, 0];
                return u;
            case "gradient map": {
                key = "gmap:" + JSON.stringify([adj.colorStops, adj.opacityStops, adj.reverse, adj.gradientType, adj.randomSeed]);
                var g = adj.gradientType === "noise"
                    ? { type: "noise", roughness: adj.roughness, colorModel: adj.colorModel, randomSeed: adj.randomSeed, min: adj.min, max: adj.max }
                    : { type: "solid", colorStops: adj.colorStops, opacityStops: adj.opacityStops };
                u.uType = 10; u.uLut = G.dataTexture(key, 256, 1, PS.gradientLut(g, adj.reverse), key);
                u.uP0 = [adj.dither ? 1 : 0, 0, 0, 0];
                return u;
            }
            case "selective color": {
                var order = ["reds", "yellows", "greens", "cyans", "blues", "magentas", "whites", "neutrals", "blacks"];
                var sc = [];
                order.forEach(function (n) {
                    var v = adj[n] || {};
                    sc.push((v.c || 0) / 100, (v.m || 0) / 100, (v.y || 0) / 100, (v.k || 0) / 100);
                });
                u.uType = 11; u.uSc = sc; u.uP0 = [adj.mode === "absolute" ? 0 : 1, 0, 0, 0];
                return u;
            }
        }
        return null;
    }

    function apply(layer, cur, opts, clipInfo) {
        var adj = layer.adjustment;
        if (!adj) { return cur; }
        var u = uniformsFor(adj, layer.id);
        if (!u) { return cur; }
        var mu = PS.renderer.maskUniforms(layer, opts);
        Object.keys(mu).forEach(function (k) { u[k] = mu[k]; });
        u.uDst = cur;
        u.uMode = PS.blendModeIndex[layer.blend] === undefined ? 1 : PS.blendModeIndex[layer.blend];
        u.uOpacity = layer.opacity * layer.fillOpacity;
        if (clipInfo) { u.uClip = clipInfo.tex; u.uHasClip = 1; }
        var out = G.acquire(PS.doc.width, PS.doc.height);
        G.pass("adjust", out, u);
        G.release(cur);
        return out;
    }

    return { apply: apply };
})();

// Photo Filter colours are often stored as Lab, sometimes normalised to 0..1
PS.photoFilterRgb = function (c) {
    if (c && c.l !== undefined && Math.abs(c.l) <= 1 && Math.abs(c.a) <= 1 && Math.abs(c.b) <= 1) {
        return PS.labToRgb(c.l * 100, c.a * 127, c.b * 128);
    }
    return PS.psdColorToRgb(c);
};
