/*
    Pixel Studio - layer styles (GPU)

    Renders the PSD layer effects - Drop Shadow, Inner Shadow, Outer /
    Inner Glow, Bevel & Emboss, Satin, Color / Gradient / Pattern Overlay and
    Stroke - including several instances of the same effect. The effect data
    stays in ag-psd's LayerEffectsInfo shape (layer.effects), so whatever is
    loaded from a PSD is saved back unchanged.

    Per layer the pipeline is:
        A        content coverage (pixel alpha x masks x clip), r8
        D        distance field of A (jump flooding) when an effect needs
                 exact distances (spread, choke, strokes, precise glows,
                 chisel bevels), packed in rgba8
        maps     one coverage map per effect (blurred / shifted / contoured)
    The maps are cached until the layer content or the style changes; every
    frame only re-blends them onto the backdrop:
        drop shadows, outer glow, content, pattern / gradient / color
        overlays, satin, inner glow, inner shadows, strokes, bevel
    and the result is mixed with the backdrop by the layer opacity.

    Calibration against reference renders: spread / choke dilate by
    size x spread, and the soft edge is a Gaussian whose full width at half
    maximum is the remaining size (sigma = size x (1 - spread) / 2.355).
*/
"use strict";

/* ============================================================
   SHARED HELPERS (also used by fill layers and adjustments)
   ============================================================ */

// PSD colour (any of ag-psd's colour models) -> [r, g, b] 0..255
PS.psdColorToRgb = function (c) {
    if (!c) { return [0, 0, 0]; }
    if (c.r !== undefined) { return [c.r, c.g, c.b]; }
    if (c.fr !== undefined) { return [c.fr * 255, c.fg * 255, c.fb * 255]; }
    if (c.h !== undefined) {
        // HSB: hue in degrees, saturation / brightness 0..1 or 0..100
        var s = c.s > 1 ? c.s / 100 : c.s, v = c.b > 1 ? c.b / 100 : c.b;
        var rgb = PS.hsvToRgb(c.h, s, v);
        return [rgb.r, rgb.g, rgb.b];
    }
    if (c.c !== undefined) {
        var f = (c.c > 1 || c.m > 1 || c.y > 1 || c.k > 1) ? 100 : 1;
        var r2 = PS.cmykToRgb(c.c / f * 100, c.m / f * 100, c.y / f * 100, c.k / f * 100);
        return [r2.r, r2.g, r2.b];
    }
    if (c.l !== undefined) { return PS.labToRgb(c.l, c.a, c.b); }
    if (c.k !== undefined) { var g = 255 * (1 - (c.k > 1 ? c.k / 100 : c.k)); return [g, g, g]; }
    return [0, 0, 0];
};

PS.rgbToPsdColor = function (rgb) { return { r: rgb[0], g: rgb[1], b: rgb[2] }; };

PS.psdColorToHex = function (c) {
    var rgb = PS.psdColorToRgb(c);
    return PS.rgbToHex(rgb[0], rgb[1], rgb[2]);
};

PS.hexToPsdColor = function (hex) {
    var c = PS.hexToRgb(hex) || { r: 0, g: 0, b: 0 };
    return { r: c.r, g: c.g, b: c.b };
};

// CIE L*a*b* (D50) -> sRGB 0..255
PS.labToRgb = function (L, a, b) {
    var fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    function inv(t) { return t > 6 / 29 ? t * t * t : 3 * (6 / 29) * (6 / 29) * (t - 4 / 29); }
    var X = 0.9642 * inv(fx), Y = inv(fy), Z = 0.8249 * inv(fz);
    // D50 -> sRGB (Bradford adapted)
    var r = 3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z;
    var g = -0.9787684 * X + 1.9161415 * Y + 0.0334540 * Z;
    var bl = 0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z;
    function gam(v) { v = Math.max(0, Math.min(1, v)); return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); }
    return [gam(r), gam(g), gam(bl)];
};

PS.unitPx = function (u, fallback) {
    if (u === undefined || u === null) { return fallback || 0; }
    if (typeof u === "number") { return u; }
    return typeof u.value === "number" ? u.value : (fallback || 0);
};

// Remap t through a gradient midpoint (0..1, 0.5 = linear)
function midRemap(t, mid) {
    if (mid === undefined || Math.abs(mid - 0.5) < 1e-3) { return t; }
    mid = Math.max(0.01, Math.min(0.99, mid));
    return Math.pow(t, Math.log(0.5) / Math.log(mid));
}

// Seeded pseudo random generator (noise gradients)
function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
        s ^= s << 13; s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5; s >>>= 0;
        return (s >>> 0) / 4294967296;
    };
}

// 256-entry RGBA lookup table of an ag-psd gradient (solid or noise)
PS.gradientLut = function (g, reverse) {
    var lut = new Uint8Array(256 * 4);
    if (!g) { for (var z = 0; z < 256; z++) { lut[z * 4] = lut[z * 4 + 1] = lut[z * 4 + 2] = z; lut[z * 4 + 3] = 255; } return lut; }
    var colorStops, opacityStops;
    if (g.type === "noise") {
        // approximate a noise gradient with seeded random stops inside its ranges
        var rand = rng(g.randomSeed || 1);
        colorStops = [];
        var n = 6 + Math.round((g.roughness === undefined ? 0.5 : g.roughness) * 10);
        var min = g.min || [0, 0, 0, 0], max = g.max || [1, 1, 1, 1];
        for (var i = 0; i <= n; i++) {
            var ch = [0, 1, 2].map(function (k) { return min[k] + (max[k] - min[k]) * rand(); });
            var rgb;
            if (g.colorModel === "hsb") {
                var h = PS.hsvToRgb(ch[0] * 360, ch[1], ch[2]);
                rgb = [h.r, h.g, h.b];
            } else if (g.colorModel === "lab") {
                rgb = PS.labToRgb(ch[0] * 100, ch[1] * 255 - 128, ch[2] * 255 - 128);
            } else {
                rgb = [ch[0] * 255, ch[1] * 255, ch[2] * 255];
            }
            colorStops.push({ color: { r: rgb[0], g: rgb[1], b: rgb[2] }, location: i / n, midpoint: 0.5 });
        }
        opacityStops = [{ opacity: 1, location: 0, midpoint: 0.5 }, { opacity: 1, location: 1, midpoint: 0.5 }];
    } else {
        colorStops = (g.colorStops || []).slice().sort(function (a, b) { return a.location - b.location; });
        opacityStops = (g.opacityStops || []).slice().sort(function (a, b) { return a.location - b.location; });
    }
    if (!colorStops.length) { colorStops = [{ color: { r: 0, g: 0, b: 0 }, location: 0 }, { color: { r: 255, g: 255, b: 255 }, location: 1 }]; }
    if (!opacityStops.length) { opacityStops = [{ opacity: 1, location: 0 }, { opacity: 1, location: 1 }]; }
    var rgbs = colorStops.map(function (s) { return PS.psdColorToRgb(s.color); });

    function sample(stops, vals, t) {
        if (t <= stops[0].location) { return vals[0]; }
        var last = stops.length - 1;
        if (t >= stops[last].location) { return vals[last]; }
        for (var j = 0; j < last; j++) {
            var a = stops[j], b = stops[j + 1];
            if (t >= a.location && t <= b.location) {
                var u = (t - a.location) / Math.max(1e-6, b.location - a.location);
                u = midRemap(u, a.midpoint);
                var va = vals[j], vb = vals[j + 1];
                if (Array.isArray(va)) { return [va[0] + (vb[0] - va[0]) * u, va[1] + (vb[1] - va[1]) * u, va[2] + (vb[2] - va[2]) * u]; }
                return va + (vb - va) * u;
            }
        }
        return vals[last];
    }
    var opac = opacityStops.map(function (s) { return s.opacity === undefined ? 1 : s.opacity; });
    for (var k = 0; k < 256; k++) {
        var t = k / 255;
        if (reverse) { t = 1 - t; }
        var c = sample(colorStops, rgbs, t);
        var o = sample(opacityStops, opac, t);
        lut[k * 4] = Math.round(c[0]);
        lut[k * 4 + 1] = Math.round(c[1]);
        lut[k * 4 + 2] = Math.round(c[2]);
        lut[k * 4 + 3] = Math.round(o * 255);
    }
    return lut;
};

// App gradient stops [{pos, color hex(+alpha)}] <-> ag-psd gradient
PS.stopsToPsdGradient = function (stops, name) {
    var sorted = stops.slice().sort(function (a, b) { return a.pos - b.pos; });
    return {
        name: name || "Custom",
        type: "solid",
        smoothness: 1,
        colorStops: sorted.map(function (s) {
            return { color: PS.hexToPsdColor(s.color), location: s.pos, midpoint: 0.5 };
        }),
        opacityStops: sorted.map(function (s) {
            var c = PS.hexToRgb(s.color) || { a: 255 };
            return { opacity: (c.a === undefined ? 255 : c.a) / 255, location: s.pos, midpoint: 0.5 };
        })
    };
};

PS.psdGradientToStops = function (g) {
    var lut = PS.gradientLut(g, false);
    // sample the gradient at its stop locations (and a few in between) so
    // both colour and opacity stops survive a round trip through the editor
    var locs = {};
    ((g && g.colorStops) || []).forEach(function (s) { locs[s.location] = 1; });
    ((g && g.opacityStops) || []).forEach(function (s) { locs[s.location] = 1; });
    var keys = Object.keys(locs).map(parseFloat).sort(function (a, b) { return a - b; });
    if (keys.length < 2) { keys = [0, 1]; }
    return keys.map(function (t) {
        var k = Math.round(t * 255) * 4;
        return { pos: t, color: PS.rgbToHex(lut[k], lut[k + 1], lut[k + 2], lut[k + 3]) };
    });
};

// Monotone cubic through contour points (0..255 both axes) -> 256 LUT in R
PS.contourLut = function (contour) {
    var lut = new Uint8Array(256 * 4);
    var pts = (contour && contour.curve && contour.curve.length >= 2)
        ? contour.curve.slice().sort(function (a, b) { return a.x - b.x; })
        : [{ x: 0, y: 0 }, { x: 255, y: 255 }];
    var vals = PS.monotoneCurve(pts.map(function (p) { return [p.x, p.y]; }), 256);
    for (var i = 0; i < 256; i++) {
        lut[i * 4] = PS.clamp(Math.round(vals[i]), 0, 255);
        lut[i * 4 + 3] = 255;
    }
    return lut;
};

PS.isLinearContour = function (contour) {
    if (!contour || !contour.curve || contour.curve.length < 2) { return true; }
    return contour.curve.every(function (p) { return Math.abs(p.x - p.y) < 1; });
};

// Fritsch-Carlson monotone cubic interpolation of [x, y] points sampled at
// n evenly spaced x values over [0, n-1]
PS.monotoneCurve = function (pts, n) {
    var m = pts.length;
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    var d = [], t = [];
    for (var i = 0; i < m - 1; i++) { d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i])); }
    t[0] = d[0];
    t[m - 1] = d[m - 2];
    for (i = 1; i < m - 1; i++) {
        t[i] = (d[i - 1] * d[i] <= 0) ? 0 : (d[i - 1] + d[i]) / 2;
    }
    for (i = 0; i < m - 1; i++) {
        if (d[i] === 0) { t[i] = t[i + 1] = 0; continue; }
        var a = t[i] / d[i], b = t[i + 1] / d[i];
        var s = a * a + b * b;
        if (s > 9) { var k = 3 / Math.sqrt(s); t[i] = k * a * d[i]; t[i + 1] = k * b * d[i]; }
    }
    var out = new Float32Array(n);
    var seg = 0;
    for (var xi = 0; xi < n; xi++) {
        var x = xi * (255 / (n - 1));
        if (x <= xs[0]) { out[xi] = ys[0]; continue; }
        if (x >= xs[m - 1]) { out[xi] = ys[m - 1]; continue; }
        while (seg < m - 2 && x > xs[seg + 1]) { seg++; }
        var h = xs[seg + 1] - xs[seg];
        var u = (x - xs[seg]) / h;
        var h00 = 2 * u * u * u - 3 * u * u + 1, h10 = u * u * u - 2 * u * u + u;
        var h01 = -2 * u * u * u + 3 * u * u, h11 = u * u * u - u * u;
        out[xi] = h00 * ys[seg] + h10 * h * t[seg] + h01 * ys[seg + 1] + h11 * h * t[seg + 1];
    }
    return out;
};

// Built-in contour presets
PS.contourPresets = [
    { name: "Linear", curve: [[0, 0], [255, 255]] },
    { name: "Cone", curve: [[0, 0], [128, 255], [255, 0]] },
    { name: "Cone - Inverted", curve: [[0, 255], [128, 0], [255, 255]] },
    { name: "Gaussian", curve: [[0, 0], [32, 7], [64, 38], [96, 101], [128, 166], [159, 209], [191, 235], [223, 248], [255, 255]] },
    { name: "Half Round", curve: [[0, 0], [34, 112], [74, 172], [128, 223], [180, 248], [255, 255]] },
    { name: "Ring", curve: [[0, 0], [65, 255], [128, 0], [190, 255], [255, 0]] },
    { name: "Ring - Double", curve: [[0, 0], [43, 255], [85, 0], [128, 255], [170, 0], [213, 255], [255, 0]] },
    { name: "Rolling Slope - Descending", curve: [[0, 255], [64, 200], [128, 128], [191, 60], [255, 0]] },
    { name: "Rounded Steps", curve: [[0, 0], [60, 60], [80, 128], [140, 128], [160, 200], [255, 255]] },
    { name: "Sawtooth 1", curve: [[0, 0], [64, 255], [65, 0], [128, 255], [129, 0], [191, 255], [192, 0], [255, 255]] }
];

PS.contourFromPreset = function (name) {
    var p = PS.contourPresets.filter(function (c) { return c.name === name; })[0] || PS.contourPresets[0];
    return { name: p.name, curve: p.curve.map(function (c) { return { x: c[0], y: c[1] }; }) };
};

// Content bounds of a layer for gradient / pattern placement, cached by rev
PS.fxBounds = function (layer) {
    var key = layer.rev + ":" + (layer.mask ? layer.mask.rev : 0);
    if (layer._fxBounds && layer._fxBounds.key === key && layer.kind !== "group") { return layer._fxBounds.box; }
    var b = PS.layerContentBounds(layer) || { x: 0, y: 0, w: PS.doc.width, h: PS.doc.height };
    layer._fxBounds = { key: key, box: b };
    return b;
};

/* ============================================================
   GPU PROGRAMS
   ============================================================ */

(function () {
    var G = PS.gpu;

    // content coverage: alpha x masks x clip
    G.defineProgram("fxAlpha", [
        "uniform sampler2D uSrc; uniform ivec2 uSrcOff;",
        "uniform sampler2D uClip; uniform int uHasClip;",
        "void main() {",
        "    ivec2 p = px(); ivec2 q = p - uSrcOff;",
        "    float a = inside(uSrc, q) ? texelFetch(uSrc, q, 0).a : 0.0;",
        "    a *= maskAt(p);",
        "    if (uHasClip == 1) a *= texelFetch(uClip, p, 0).a;",
        "    outColor = vec4(a, 0.0, 0.0, 1.0);",
        "}"
    ].join("\n"), { mask: true });

    var DIST = [
        "float decode16(float hi, float lo) { return (floor(hi * 255.0 + 0.5) * 256.0 + floor(lo * 255.0 + 0.5)) / 64.0; }",
        "bool inTex(sampler2D t, ivec2 q) { ivec2 s = textureSize(t, 0); return q.x >= 0 && q.y >= 0 && q.x < s.x && q.y < s.y; }",
        "float aAt(sampler2D t, ivec2 q) { return inTex(t, q) ? texelFetch(t, q, 0).r : 0.0; }",
        // distance to the shape (outside) / to the outside (inside); beyond the
        // canvas everything is outside
        "float dOutAt(sampler2D d, ivec2 q) { if (!inTex(d, q)) return 1024.0; vec4 t = texelFetch(d, q, 0); return decode16(t.r, t.g); }",
        "float dInAt(sampler2D d, ivec2 q) { if (!inTex(d, q)) return 0.0; vec4 t = texelFetch(d, q, 0); return decode16(t.b, t.a); }",
        ""
    ].join("\n");

    // pre-blur map for shadows / glows: optionally inverted, shifted and
    // dilated by the spread (choke for inner effects)
    G.defineProgram("fxBase", DIST + [
        "uniform sampler2D uA; uniform sampler2D uDist; uniform int uHasDist;",
        "uniform ivec2 uOff; uniform int uInvert; uniform float uSpread;",
        "void main() {",
        "    ivec2 q = px() - uOff;",
        "    float v;",
        "    if (uInvert == 0) {",
        "        v = aAt(uA, q);",
        "        if (uHasDist == 1 && uSpread > 0.0) v = max(v, clamp(uSpread - dOutAt(uDist, q) + 0.5, 0.0, 1.0));",
        "    } else {",
        "        v = 1.0 - aAt(uA, q);",
        "        if (uHasDist == 1 && uSpread > 0.0) v = max(v, clamp(uSpread - dInAt(uDist, q) + 0.5, 0.0, 1.0));",
        "    }",
        "    outColor = vec4(v, 0.0, 0.0, 1.0);",
        "}"
    ].join("\n"));

    // separable Gaussian (sigma <= ~8 after downsampling)
    G.defineProgram("fxBlur", [
        "uniform sampler2D uSrc; uniform ivec2 uDir; uniform float uSigma; uniform int uRad;",
        "float at(ivec2 q) { ivec2 s = textureSize(uSrc, 0); if (q.x < 0 || q.y < 0 || q.x >= s.x || q.y >= s.y) return 0.0; return texelFetch(uSrc, q, 0).r; }",
        "void main() {",
        "    ivec2 p = px();",
        "    float k = -0.5 / (uSigma * uSigma);",
        "    float sum = at(p); float norm = 1.0;",
        "    for (int i = 1; i <= 64; i++) {",
        "        if (i > uRad) break;",
        "        float w = exp(float(i * i) * k);",
        "        sum += w * (at(p + uDir * i) + at(p - uDir * i));",
        "        norm += 2.0 * w;",
        "    }",
        "    outColor = vec4(sum / norm, 0.0, 0.0, 1.0);",
        "}"
    ].join("\n"));

    // 2x box downsample / bilinear upsample (manual, so no filtering state)
    G.defineProgram("fxDown", [
        "uniform sampler2D uSrc;",
        "float at(ivec2 q) { ivec2 s = textureSize(uSrc, 0); if (q.x >= s.x || q.y >= s.y) return 0.0; return texelFetch(uSrc, q, 0).r; }",
        "void main() {",
        "    ivec2 p = px() * 2;",
        "    float v = at(p) + at(p + ivec2(1, 0)) + at(p + ivec2(0, 1)) + at(p + ivec2(1, 1));",
        "    outColor = vec4(v * 0.25, 0.0, 0.0, 1.0);",
        "}"
    ].join("\n"));

    G.defineProgram("fxUp", [
        "uniform sampler2D uSrc; uniform float uScale;",
        "float at(ivec2 q) { ivec2 s = textureSize(uSrc, 0); q = clamp(q, ivec2(0), s - 1); return texelFetch(uSrc, q, 0).r; }",
        "void main() {",
        "    vec2 sp = (gl_FragCoord.xy) / uScale - 0.5;",
        "    vec2 f = fract(sp); ivec2 b = ivec2(floor(sp));",
        "    float v = mix(mix(at(b), at(b + ivec2(1, 0)), f.x), mix(at(b + ivec2(0, 1)), at(b + ivec2(1, 1)), f.x), f.y);",
        "    outColor = vec4(v, 0.0, 0.0, 1.0);",
        "}"
    ].join("\n"));

    // per-pixel remap: range, contour LUT, invert, noise, multiply by a map
    G.defineProgram("fxRemap", [
        "uniform sampler2D uSrc; uniform sampler2D uLut; uniform int uUseLut; uniform int uInvert;",
        "uniform sampler2D uMul; uniform int uMulMode; uniform float uNoise; uniform float uLo; uniform float uHi; uniform float uGain;",
        "void main() {",
        "    ivec2 p = px();",
        "    float v = texelFetch(uSrc, p, 0).r;",
        "    if (uInvert == 1) v = 1.0 - v;",
        "    v = clamp((v - uLo) / max(uHi - uLo, 1e-4), 0.0, 1.0);",
        "    if (uUseLut == 1) {",
        "        float x = v * 255.0; int i0 = int(floor(x)); int i1 = min(i0 + 1, 255);",
        "        v = mix(texelFetch(uLut, ivec2(i0, 0), 0).r, texelFetch(uLut, ivec2(i1, 0), 0).r, fract(x));",
        "    }",
        "    v *= uGain;",
        "    if (uNoise > 0.0) v *= 1.0 - uNoise * hash12(vec2(p));",
        "    if (uMulMode == 1) v *= texelFetch(uMul, p, 0).r;",
        "    else if (uMulMode == 2) v *= 1.0 - texelFetch(uMul, p, 0).r;",
        "    outColor = vec4(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0);",
        "}"
    ].join("\n"));

    // satin: difference of the blurred shape shifted both ways
    G.defineProgram("fxSatin", [
        "uniform sampler2D uSrc; uniform ivec2 uOff;",
        "float at(ivec2 q) { ivec2 s = textureSize(uSrc, 0); if (q.x < 0 || q.y < 0 || q.x >= s.x || q.y >= s.y) return 0.0; return texelFetch(uSrc, q, 0).r; }",
        "void main() {",
        "    ivec2 p = px();",
        "    outColor = vec4(abs(at(p - uOff) - at(p + uOff)), 0.0, 0.0, 1.0);",
        "}"
    ].join("\n"));

    // jump flooding: seeds are pixels inside (uInside = 1) or outside the shape
    G.defineProgram("jfaInit", [
        "uniform sampler2D uA; uniform int uInside;",
        "vec4 enc(ivec2 q) { return vec4(float(q.x >> 8), float(q.x & 255), float(q.y >> 8), float(q.y & 255)) / 255.0; }",
        "void main() {",
        "    ivec2 p = px();",
        "    float a = texelFetch(uA, p, 0).r;",
        "    bool seed = (uInside == 1) ? (a >= 0.5) : (a < 0.5);",
        "    outColor = seed ? enc(p) : vec4(1.0);",
        "}"
    ].join("\n"));

    G.defineProgram("jfaStep", [
        "uniform sampler2D uSrc; uniform int uStep;",
        "ivec2 dec(vec4 t) { ivec4 b = ivec4(floor(t * 255.0 + 0.5)); return ivec2(b.x * 256 + b.y, b.z * 256 + b.w); }",
        "vec4 enc(ivec2 q) { return vec4(float(q.x >> 8), float(q.x & 255), float(q.y >> 8), float(q.y & 255)) / 255.0; }",
        "void main() {",
        "    ivec2 p = px(); ivec2 s = textureSize(uSrc, 0);",
        "    float best = 1e20; ivec2 bestSeed = ivec2(65535);",
        "    for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {",
        "        ivec2 q = p + ivec2(dx, dy) * uStep;",
        "        if (q.x < 0 || q.y < 0 || q.x >= s.x || q.y >= s.y) continue;",
        "        ivec2 sd = dec(texelFetch(uSrc, q, 0));",
        "        if (sd.x == 65535) continue;",
        "        vec2 dd = vec2(sd - p); float d = dot(dd, dd);",
        "        if (d < best) { best = d; bestSeed = sd; }",
        "    }",
        "    outColor = bestSeed.x == 65535 ? vec4(1.0) : enc(bestSeed);",
        "}"
    ].join("\n"));

    // pack both distances (outside: to the shape, inside: to the outside)
    G.defineProgram("jfaPack", [
        "uniform sampler2D uOut; uniform sampler2D uIn;",
        "ivec2 dec(vec4 t) { ivec4 b = ivec4(floor(t * 255.0 + 0.5)); return ivec2(b.x * 256 + b.y, b.z * 256 + b.w); }",
        "float dist(sampler2D t, ivec2 p) { ivec2 sd = dec(texelFetch(t, p, 0)); if (sd.x == 65535) return 1023.0; return min(length(vec2(sd - p)), 1023.0); }",
        "vec2 enc16(float d) { float v = floor(clamp(d, 0.0, 1023.0) * 64.0 + 0.5); return vec2(floor(v / 256.0), mod(v, 256.0)) / 255.0; }",
        "void main() {",
        "    ivec2 p = px();",
        "    outColor = vec4(enc16(dist(uOut, p)), enc16(dist(uIn, p)));",
        "}"
    ].join("\n"));

    // exact maps from the distance field: strokes, precise glows, bevel heights
    G.defineProgram("fxDist", DIST + [
        "uniform sampler2D uA; uniform sampler2D uDist; uniform int uKind; uniform float uP1; uniform float uP2;",
        "void main() {",
        "    ivec2 p = px();",
        "    float a = aAt(uA, p);",
        "    float dO = dOutAt(uDist, p), dI = dInAt(uDist, p);",
        "    float v = 0.0;",
        "    if (uKind == 0) v = clamp(uP1 - dO + 0.5, 0.0, 1.0) * (1.0 - a);",
        "    else if (uKind == 1) v = clamp(uP1 - dI + 0.5, 0.0, 1.0) * a;",
        "    else if (uKind == 2) v = clamp(uP1 * 0.5 - dO + 0.5, 0.0, 1.0) * (1.0 - a) + clamp(uP1 * 0.5 - dI + 0.5, 0.0, 1.0) * a;",
        "    else if (uKind == 3) v = (dO <= uP1 ? 1.0 : 1.0 - clamp((dO - uP1) / max(uP2 - uP1, 1.0), 0.0, 1.0)) * (1.0 - a);",
        "    else if (uKind == 4) v = (1.0 - clamp((dI - uP1) / max(uP2 - uP1, 1.0), 0.0, 1.0)) * a;",
        "    else if (uKind == 5) v = clamp((dI - uP1) / max(uP2 - uP1, 1.0), 0.0, 1.0) * a;",
        // bevel heights (signed distance, edge at 0.5 coverage)
        "    else {",
        "        float sd = (a >= 0.5) ? (dI - 0.5) : -(dO - 0.5);",
        "        if (uKind == 6) v = clamp(sd / uP1, 0.0, 1.0);",
        "        else if (uKind == 7) v = clamp(1.0 + sd / uP1, 0.0, 1.0);",
        "        else if (uKind == 8) v = clamp(0.5 + sd / uP1, 0.0, 1.0);",
        "        else v = clamp(abs(sd) / (uP1 * 0.5), 0.0, 1.0);",
        "    }",
        "    outColor = vec4(v, 0.0, 0.0, 1.0);",
        "}"
    ].join("\n"));

    // bevel shading from a height map: r = highlight, g = shadow
    G.defineProgram("fxBevel", [
        "uniform sampler2D uH; uniform vec3 uLight; uniform float uDepth; uniform int uDown;",
        "uniform sampler2D uLut; uniform int uUseLut;",
        "float h(ivec2 q) { ivec2 s = textureSize(uH, 0); q = clamp(q, ivec2(0), s - 1); return texelFetch(uH, q, 0).r; }",
        "void main() {",
        "    ivec2 p = px();",
        "    float gx = (h(p + ivec2(1, 0)) - h(p - ivec2(1, 0))) * 0.5 * uDepth;",
        "    float gy = (h(p + ivec2(0, 1)) - h(p - ivec2(0, 1))) * 0.5 * uDepth;",
        "    if (uDown == 1) { gx = -gx; gy = -gy; }",
        "    vec3 n = normalize(vec3(-gx, -gy, 1.0));",
        "    float s = dot(n, uLight);",
        "    if (uUseLut == 1) {",
        "        float x = clamp(s, 0.0, 1.0) * 255.0; int i0 = int(floor(x)); int i1 = min(i0 + 1, 255);",
        "        s = mix(texelFetch(uLut, ivec2(i0, 0), 0).r, texelFetch(uLut, ivec2(i1, 0), 0).r, fract(x));",
        "    }",
        "    float flat0 = uLight.z;",
        "    float hi = max(0.0, s - flat0) / max(1.0 - flat0, 1e-3);",
        "    float sh = max(0.0, flat0 - s) / max(flat0, 1e-3);",
        "    outColor = vec4(clamp(hi, 0.0, 1.0), clamp(sh, 0.0, 1.0), 0.0, 1.0);",
        "}"
    ].join("\n"));

    // blend an effect's colour onto the backdrop through a coverage map
    G.defineProgram("fxApply", [
        "uniform sampler2D uDst; uniform sampler2D uCov; uniform int uCovChan;",
        "uniform sampler2D uA; uniform int uCovMul;",
        "uniform int uColorMode; uniform vec3 uColor; uniform sampler2D uLut;",
        "uniform int uGStyle; uniform vec2 uGCenter; uniform vec2 uGDir; uniform float uGLen;",
        "uniform sampler2D uPat; uniform vec2 uPatSize; uniform float uPatScale; uniform vec2 uPatPhase;",
        "uniform int uMode; uniform float uOpacity; uniform int uDissolve; uniform int uDither;",
        "vec4 lut(float t) { float x = clamp(t, 0.0, 1.0) * 255.0; int i0 = int(floor(x)); int i1 = min(i0 + 1, 255);",
        "    return mix(texelFetch(uLut, ivec2(i0, 0), 0), texelFetch(uLut, ivec2(i1, 0), 0), fract(x)); }",
        "float gradT(vec2 q) {",
        "    vec2 d = q - uGCenter;",
        "    if (uGStyle == 1) return length(d) / uGLen;",
        "    if (uGStyle == 2) { float a = atan(-(d.x * uGDir.y - d.y * uGDir.x), d.x * uGDir.x + d.y * uGDir.y); return fract(a / 6.2831853); }",
        "    float along = dot(d, uGDir);",
        "    if (uGStyle == 3) return abs(along) / uGLen;",
        "    if (uGStyle == 4) { float across = d.x * uGDir.y - d.y * uGDir.x; return (abs(along) + abs(across)) / uGLen; }",
        "    return along / (2.0 * uGLen) + 0.5;",
        "}",
        "void main() {",
        "    ivec2 p = px();",
        "    vec4 dst = texelFetch(uDst, p, 0);",
        "    vec4 cv = texelFetch(uCov, p, 0);",
        "    float raw = uCovChan == 1 ? cv.g : cv.r;",
        "    float cov = raw;",
        "    if (uCovMul == 1) cov *= texelFetch(uA, p, 0).r;",
        "    else if (uCovMul == 2) cov *= 1.0 - texelFetch(uA, p, 0).r;",
        "    vec3 col = uColor; float ca = 1.0;",
        "    if (uColorMode == 1) { vec4 g = lut(raw); col = g.rgb; ca = g.a; }",
        "    else if (uColorMode == 2) { float t = gradT(vec2(p) + 0.5); if (uDither == 1) t += (hash12(vec2(p)) - 0.5) / 255.0; vec4 g = lut(t); col = g.rgb; ca = g.a; }",
        "    else if (uColorMode == 3) {",
        "        vec2 q = (vec2(p) + 0.5 - uPatPhase) / max(uPatScale, 1e-3);",
        "        ivec2 iq = ivec2(mod(floor(q), uPatSize));",
        "        vec4 g = texelFetch(uPat, iq, 0); col = g.rgb; ca = g.a;",
        "    }",
        "    float sa = clamp(cov * ca * uOpacity, 0.0, 1.0);",
        "    if (uDissolve == 1) sa = (hash12(vec2(p) + 17.0) < sa) ? 1.0 : 0.0;",
        "    outColor = compose(uMode, dst, col, sa);",
        "}"
    ].join("\n"), { blend: true });
})();

/* ============================================================
   EFFECT PIPELINE
   ============================================================ */

PS.gpuEffects = (function () {
    var G = PS.gpu;
    var cache = {};          // layer id -> {sig, targets: {}, frame}

    function present(e) { return e && e.present !== false && e.enabled !== false; }

    function list(v) { return v ? (Array.isArray(v) ? v : [v]) : []; }

    function anyEnabled(fx) {
        if (!fx || fx.disabled) { return false; }
        var keys = ["dropShadow", "innerShadow", "outerGlow", "innerGlow", "bevel", "satin",
            "solidFill", "gradientOverlay", "patternOverlay", "stroke"];
        for (var i = 0; i < keys.length; i++) {
            if (list(fx[keys[i]]).some(present)) { return true; }
        }
        return false;
    }

    function lightAngle(e) {
        return (e.useGlobalLight !== false && e.useGlobalLight !== undefined ? PS.doc.globalAngle : (e.angle === undefined ? PS.doc.globalAngle : e.angle));
    }

    function offsetFor(angleDeg, dist) {
        var a = angleDeg * Math.PI / 180;
        return [Math.round(-Math.cos(a) * dist), Math.round(Math.sin(a) * dist)];
    }

    /* ---- passes ---- */

    var W, H;

    function target(fmt) { return G.acquire(W, H, fmt ? { format: fmt } : null); }

    // Gaussian blur of the r channel; large sigmas run on a downsampled copy
    function blur(src, sigma) {
        if (sigma < 0.35) { return null; }
        var factor = 1;
        while (sigma / factor > 6 && factor < 32) { factor *= 2; }
        var chain = [];
        var cur = src, cw = src.w, ch = src.h;
        for (var f = 1; f < factor; f *= 2) {
            cw = Math.max(1, Math.ceil(cw / 2));
            ch = Math.max(1, Math.ceil(ch / 2));
            var t = G.acquire(cw, ch);
            G.pass("fxDown", t, { uSrc: cur });
            chain.push(t);
            cur = t;
        }
        var s = sigma / factor;
        var rad = Math.min(64, Math.ceil(s * 3));
        var h = G.acquire(cw, ch);
        G.pass("fxBlur", h, { uSrc: cur, uDir: [1, 0], uSigma: s, uRad: rad });
        var v = G.acquire(cw, ch);
        G.pass("fxBlur", v, { uSrc: h, uDir: [0, 1], uSigma: s, uRad: rad });
        G.release(h);
        chain.forEach(G.release);
        if (factor === 1) { return v; }
        var up = G.acquire(src.w, src.h);
        G.pass("fxUp", up, { uSrc: v, uScale: factor });
        G.release(v);
        return up;
    }

    // jump-flooding distance field of A (packed rgba8)
    function distanceField(A) {
        var steps = [];
        var n = 1;
        while (n < Math.max(W, H)) { n *= 2; }
        for (var s = n / 2; s >= 1; s /= 2) { steps.push(s); }
        steps.push(1);
        function flood(inside) {
            var a = target("rgba8"), b = target("rgba8");
            G.pass("jfaInit", a, { uA: A, uInside: inside ? 1 : 0 });
            steps.forEach(function (st) {
                G.pass("jfaStep", b, { uSrc: a, uStep: st });
                var t = a; a = b; b = t;
            });
            G.release(b);
            return a;
        }
        var fo = flood(true), fi = flood(false);
        var packed = target("rgba8");
        G.pass("jfaPack", packed, { uOut: fo, uIn: fi });
        G.release(fo);
        G.release(fi);
        return packed;
    }

    function lutTexture(key, data) {
        return G.dataTexture("lut:" + key, 256, 1, data, key);
    }

    function contourTex(contour) {
        if (PS.isLinearContour(contour)) { return null; }
        var key = "c:" + JSON.stringify(contour.curve);
        return lutTexture(key, PS.contourLut(contour));
    }

    function gradientTex(g, reverse) {
        var key = "g:" + JSON.stringify(g) + ":" + (reverse ? 1 : 0);
        return lutTexture(key, PS.gradientLut(g, reverse));
    }

    function patternTex(pat) {
        var pats = (PS.doc.psd && PS.doc.psd.patterns) || [];
        var p = pats.filter(function (x) { return pat && (x.id === pat.id || x.name === pat.name); })[0];
        if (!p || !p.data) { return null; }
        var w = p.bounds ? p.bounds.w : Math.round(Math.sqrt(p.data.length / 4));
        var h = p.bounds ? p.bounds.h : w;
        return { tex: G.dataTexture("pat:" + p.id, w, h, p.data, p.id), w: w, h: h };
    }

    // final coverage map for a shadow / glow: base -> blur -> contour/noise
    function softMap(A, D, opt) {
        var base = target();
        G.pass("fxBase", base, {
            uA: A, uDist: D, uHasDist: D ? 1 : 0, uOff: opt.off || [0, 0],
            uInvert: opt.invert ? 1 : 0, uSpread: opt.spread || 0
        });
        var b = blur(base, opt.sigma);
        if (b) { G.release(base); base = b; }
        var out = target("r8");
        var lt = opt.contour ? contourTex(opt.contour) : null;
        G.pass("fxRemap", out, {
            uSrc: base, uLut: lt, uUseLut: lt ? 1 : 0, uInvert: opt.invertAfter ? 1 : 0,
            uMul: opt.mul || null, uMulMode: opt.mulMode || 0, uNoise: opt.noise || 0,
            uLo: opt.lo || 0, uHi: opt.hi === undefined ? 1 : opt.hi, uGain: 1
        });
        G.release(base);
        return out;
    }

    /* ---- building every map of one layer ---- */

    function needsDistance(fx) {
        var need = false;
        list(fx.dropShadow).forEach(function (e) { if (present(e) && PS.unitPx(e.choke) > 0) { need = true; } });
        list(fx.innerShadow).forEach(function (e) { if (present(e) && PS.unitPx(e.choke) > 0) { need = true; } });
        [fx.outerGlow, fx.innerGlow].forEach(function (e) {
            if (present(e) && (PS.unitPx(e.choke) > 0 || e.technique === "precise")) { need = true; }
        });
        if (list(fx.stroke).some(present)) { need = true; }
        if (present(fx.bevel)) { need = true; }
        return need;
    }

    function buildMaps(layer, tex, opts, helpers) {
        var fx = layer.effects;
        var maps = {};
        // coverage of the content
        var A = target("r8");
        var u = Object.assign({}, helpers.maskUniforms);
        u.uSrc = tex;
        var off = (!opts.skipPreviews && layer.kind !== "group") ? PS.moveOffsetOf(layer) : null;
        u.uSrcOff = off ? [off.dx, off.dy] : [0, 0];
        if (helpers.clip) { u.uClip = helpers.clip.uClip; u.uHasClip = 1; }
        G.pass("fxAlpha", A, u);
        maps.A = A;
        var D = needsDistance(fx) ? distanceField(A) : null;
        if (D) { maps.D = D; }

        list(fx.dropShadow).forEach(function (e, i) {
            if (!present(e)) { return; }
            var size = PS.unitPx(e.size, 5), spread = PS.clamp(PS.unitPx(e.choke) / 100, 0, 1);
            maps["ds" + i] = softMap(A, D, {
                off: offsetFor(lightAngle(e), PS.unitPx(e.distance, 5)),
                spread: size * spread, sigma: size * (1 - spread) / 2.355,
                contour: e.contour, noise: e.noise || 0,
                mul: e.layerConceals !== false ? A : null, mulMode: e.layerConceals !== false ? 2 : 0
            });
        });
        if (present(fx.outerGlow)) {
            var og = fx.outerGlow;
            var gsize = PS.unitPx(og.size, 5), gspread = PS.clamp(PS.unitPx(og.choke) / 100, 0, 1);
            if (og.technique === "precise" && D) {
                var pm = target();
                G.pass("fxDist", pm, { uA: A, uDist: D, uKind: 3, uP1: gsize * gspread, uP2: gsize });
                maps.og = remapOnly(pm, og.contour, og.noise, rangeOf(og));
            } else {
                maps.og = softMap(A, D, {
                    spread: gsize * gspread, sigma: gsize * (1 - gspread) / 2.355,
                    contour: og.contour, noise: og.noise || 0, mul: A, mulMode: 2,
                    lo: rangeOf(og).lo, hi: rangeOf(og).hi
                });
            }
        }
        list(fx.innerShadow).forEach(function (e, i) {
            if (!present(e)) { return; }
            var size = PS.unitPx(e.size, 5), choke = PS.clamp(PS.unitPx(e.choke) / 100, 0, 1);
            maps["is" + i] = softMap(A, D, {
                off: offsetFor(lightAngle(e), PS.unitPx(e.distance, 5)), invert: true,
                spread: size * choke, sigma: size * (1 - choke) / 2.355,
                contour: e.contour, noise: e.noise || 0, mul: A, mulMode: 1
            });
        });
        if (present(fx.innerGlow)) {
            var ig = fx.innerGlow;
            var isize = PS.unitPx(ig.size, 5), ichoke = PS.clamp(PS.unitPx(ig.choke) / 100, 0, 1);
            var center = ig.source === "center";
            if (ig.technique === "precise" && D) {
                var pm2 = target();
                G.pass("fxDist", pm2, { uA: A, uDist: D, uKind: center ? 5 : 4, uP1: isize * ichoke, uP2: isize });
                maps.ig = remapOnly(pm2, ig.contour, ig.noise, rangeOf(ig));
            } else {
                // edge: the blurred outside reaching in; center: the opposite
                maps.ig = softMap(A, D, {
                    invert: true, spread: isize * ichoke, sigma: isize * (1 - ichoke) / 2.355,
                    contour: ig.contour, noise: ig.noise || 0, invertAfter: center,
                    mul: A, mulMode: 1, lo: rangeOf(ig).lo, hi: rangeOf(ig).hi
                });
            }
        }
        if (present(fx.satin)) {
            var st = fx.satin;
            var ssize = PS.unitPx(st.size, 14);
            var bl = blur(A, ssize / 2.355) || copyMap(A);
            var sat = target();
            G.pass("fxSatin", sat, { uSrc: bl, uOff: offsetFor(st.angle === undefined ? 19 : st.angle, PS.unitPx(st.distance, 11)) });
            G.release(bl);
            var lt = contourTex(st.contour);
            var sm = target("r8");
            G.pass("fxRemap", sm, {
                uSrc: sat, uLut: lt, uUseLut: lt ? 1 : 0, uInvert: st.invert ? 1 : 0,
                uMul: A, uMulMode: 1, uNoise: 0, uLo: 0, uHi: 1, uGain: 1
            });
            G.release(sat);
            maps.sat = sm;
        }
        list(fx.stroke).forEach(function (e, i) {
            if (!present(e) || !D) { return; }
            var kind = e.position === "inside" ? 1 : (e.position === "center" ? 2 : 0);
            var sm2 = target("r8");
            G.pass("fxDist", sm2, { uA: A, uDist: D, uKind: kind, uP1: PS.unitPx(e.size, 3), uP2: 0 });
            maps["st" + i] = sm2;
        });
        if (present(fx.bevel) && D) {
            maps.bv = bevelMap(A, D, fx.bevel);
        }
        return maps;
    }

    function rangeOf(e) {
        // Range narrows the part of the glow the contour is applied to
        var r = (e.range === undefined) ? 0.5 : e.range;
        if (Math.abs(r - 0.5) < 1e-3) { return { lo: 0, hi: 1 }; }
        return { lo: Math.max(0, 1 - 2 * r), hi: 1 };
    }

    function copyMap(src) {
        var t = target();
        G.pass("fxRemap", t, { uSrc: src, uUseLut: 0, uInvert: 0, uMulMode: 0, uNoise: 0, uLo: 0, uHi: 1, uGain: 1 });
        return t;
    }

    function remapOnly(src, contour, noise, range) {
        var out = target("r8");
        var lt = contourTex(contour);
        G.pass("fxRemap", out, {
            uSrc: src, uLut: lt, uUseLut: lt ? 1 : 0, uInvert: 0, uMulMode: 0,
            uNoise: noise || 0, uLo: range.lo, uHi: range.hi, uGain: 1
        });
        G.release(src);
        return out;
    }

    function bevelMap(A, D, bv) {
        var size = Math.max(1, PS.unitPx(bv.size, 5));
        var style = bv.style || "inner bevel";
        var kind = { "inner bevel": 6, "outer bevel": 7, "emboss": 8, "pillow emboss": 9, "stroke emboss": 8 }[style] || 6;
        var hgt = target();
        G.pass("fxDist", hgt, { uA: A, uDist: D, uKind: kind, uP1: style === "emboss" || style === "pillow emboss" ? size * 2 : size, uP2: 0 });
        // smooth technique rounds the profile; soften blurs the shading
        var soften = PS.unitPx(bv.soften, 0);
        var sigma = (bv.technique === "chisel hard" ? 0 : (bv.technique === "chisel soft" ? size * 0.08 : size * 0.18)) + soften / 2.355;
        if (sigma >= 0.35) {
            var bh = blur(hgt, sigma);
            if (bh) { G.release(hgt); hgt = bh; }
        }
        var angle = (bv.useGlobalLight !== false ? PS.doc.globalAngle : (bv.angle === undefined ? 120 : bv.angle)) * Math.PI / 180;
        var alt = (bv.useGlobalLight !== false ? PS.doc.globalAltitude : (bv.altitude === undefined ? 30 : bv.altitude)) * Math.PI / 180;
        var light = [Math.cos(alt) * Math.cos(angle), -Math.cos(alt) * Math.sin(angle), Math.sin(alt)];
        var depth = size * (bv.strength === undefined ? 1 : bv.strength);
        var lt = contourTex(bv.contour);
        var out = target("rgba8");
        G.pass("fxBevel", out, {
            uH: hgt, uLight: light, uDepth: depth, uDown: bv.direction === "down" ? 1 : 0,
            uLut: lt, uUseLut: lt ? 1 : 0
        });
        G.release(hgt);
        return out;
    }

    /* ---- compositing the effects ---- */

    function apply(layer, tex, cur, opts, helpers) {
        var d = PS.doc;
        W = d.width; H = d.height;
        var fx = layer.effects;

        // cache the maps while nothing they depend on changes
        var off = (!opts.skipPreviews) ? PS.moveOffsetOf(layer) : null;
        var srcRev = layer.kind === "group" ? null
            : (opts.skipPreviews ? layer.rev : PS.renderer.layerSource(layer, opts).rev);
        var sig = [srcRev, layer.mask ? layer.mask.rev + ":" + layer.mask.enabled + ":" + layer.mask.density : "",
            layer.vmask ? (layer.vmask.rev || 0) + ":" + layer.vmask.enabled : "",
            off ? off.dx + "," + off.dy : "", helpers.clip ? "clip" + (helpers.clipSig || Math.random()) : "",
            W + "x" + H, d.globalAngle, d.globalAltitude, JSON.stringify(fx)].join("|");
        var entry = cache[layer.id];
        var maps;
        if (entry && entry.sig === sig && srcRev !== null && String(srcRev).charAt(0) !== "s" && String(srcRev).charAt(0) !== "o") {
            maps = entry.maps;
        } else {
            if (entry) { releaseMaps(entry.maps); }
            maps = buildMaps(layer, tex, opts, helpers);
            entry = cache[layer.id] = { sig: sig, maps: maps };
        }
        entry.frame = G.frame();

        var A = maps.A;
        var base = cur;              // the untouched backdrop
        var R = G.acquire(W, H);     // effects and content accumulate on a copy
        G.copy(base, R);

        function swapPass(u) {
            var out = G.acquire(W, H);
            u.uDst = R;
            G.pass("fxApply", out, u);
            G.release(R);
            R = out;
        }
        function colorU(c) {
            var rgb = PS.psdColorToRgb(c);
            return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
        }
        function mode(m) { return helpers.modeIndex(m || "normal"); }
        var bounds = null;
        function gradU(e, gradient) {
            if (!bounds) { bounds = (e.align === false) ? { x: 0, y: 0, w: W, h: H } : PS.fxBounds(layer); }
            var b = (e.align === false) ? { x: 0, y: 0, w: W, h: H } : bounds;
            var ang = (e.angle === undefined ? 90 : e.angle) * Math.PI / 180;
            var dir = [Math.cos(ang), -Math.sin(ang)];
            var scale = e.scale === undefined ? 1 : e.scale;
            var offs = e.offset || { x: 0, y: 0 };
            var cx = b.x + b.w / 2 + (offs.x || 0) / 100 * b.w;
            var cy = b.y + b.h / 2 + (offs.y || 0) / 100 * b.h;
            var style = { linear: 0, radial: 1, angle: 2, reflected: 3, diamond: 4 }[e.type || e.style || "linear"] || 0;
            // every style spans the box along the gradient angle (radial and
            // diamond use it as their radius)
            var len = (Math.abs(b.w * dir[0]) + Math.abs(b.h * dir[1])) / 2 * scale;
            return {
                uColorMode: 2, uLut: gradientTex(gradient, e.reverse), uGStyle: style,
                uGCenter: [cx, cy], uGDir: dir, uGLen: Math.max(1, len), uDither: e.dither ? 1 : 0
            };
        }
        function fillU(e) {
            // stroke fill: colour, gradient or pattern
            if (e.fillType === "gradient" && e.gradient) { return gradU(e.gradient, e.gradient); }
            if (e.fillType === "pattern" && e.pattern) {
                var pt = patternTex(e.pattern);
                if (pt) { return { uColorMode: 3, uPat: pt.tex, uPatSize: [pt.w, pt.h], uPatScale: e.pattern.scale || 1, uPatPhase: [0, 0] }; }
            }
            return { uColorMode: 0, uColor: colorU(e.color) };
        }

        // 1. drop shadows (listed top first)
        list(fx.dropShadow).slice().reverse().forEach(function (e) {
            var i = list(fx.dropShadow).indexOf(e);
            if (!maps["ds" + i]) { return; }
            swapPass({ uCov: maps["ds" + i], uColorMode: 0, uColor: colorU(e.color), uMode: mode(e.blendMode || "multiply"), uOpacity: e.opacity === undefined ? 0.75 : e.opacity });
        });
        // 2. outer glow
        if (maps.og) {
            var og = fx.outerGlow;
            var ogu = { uCov: maps.og, uMode: mode(og.blendMode || "screen"), uOpacity: og.opacity === undefined ? 0.75 : og.opacity };
            if (og.gradient && !og.color) { ogu.uColorMode = 1; ogu.uLut = gradientTex(og.gradient, og.reverse); }
            else { ogu.uColorMode = 0; ogu.uColor = colorU(og.color); }
            swapPass(ogu);
        }
        // 3. content
        R = helpers.blendOnto(R, tex, layer, 1, opts, helpers.clip, layer.fillOpacity);
        // 4. overlays: pattern, gradient, colour
        if (present(fx.patternOverlay)) {
            var po = fx.patternOverlay;
            var pt2 = patternTex(po.pattern);
            if (pt2) {
                swapPass({
                    uCov: A, uColorMode: 3, uPat: pt2.tex, uPatSize: [pt2.w, pt2.h], uPatScale: po.scale || 1,
                    uPatPhase: [po.phase ? po.phase.x : 0, po.phase ? po.phase.y : 0],
                    uMode: mode(po.blendMode), uOpacity: po.opacity === undefined ? 1 : po.opacity
                });
            }
        }
        list(fx.gradientOverlay).slice().reverse().forEach(function (e) {
            if (!present(e)) { return; }
            var gu = gradU(e, e.gradient);
            gu.uCov = A;
            gu.uMode = mode(e.blendMode);
            gu.uOpacity = e.opacity === undefined ? 1 : e.opacity;
            swapPass(gu);
        });
        list(fx.solidFill).slice().reverse().forEach(function (e) {
            if (!present(e)) { return; }
            swapPass({ uCov: A, uColorMode: 0, uColor: colorU(e.color), uMode: mode(e.blendMode), uOpacity: e.opacity === undefined ? 1 : e.opacity });
        });
        // 5. satin, inner glow, inner shadows
        if (maps.sat) {
            var st = fx.satin;
            swapPass({ uCov: maps.sat, uColorMode: 0, uColor: colorU(st.color), uMode: mode(st.blendMode || "multiply"), uOpacity: st.opacity === undefined ? 0.5 : st.opacity });
        }
        if (maps.ig) {
            var ig = fx.innerGlow;
            var igu = { uCov: maps.ig, uMode: mode(ig.blendMode || "screen"), uOpacity: ig.opacity === undefined ? 0.75 : ig.opacity };
            if (ig.gradient && !ig.color) { igu.uColorMode = 1; igu.uLut = gradientTex(ig.gradient, ig.reverse); }
            else { igu.uColorMode = 0; igu.uColor = colorU(ig.color); }
            swapPass(igu);
        }
        list(fx.innerShadow).slice().reverse().forEach(function (e) {
            var i = list(fx.innerShadow).indexOf(e);
            if (!maps["is" + i]) { return; }
            swapPass({ uCov: maps["is" + i], uColorMode: 0, uColor: colorU(e.color), uMode: mode(e.blendMode || "multiply"), uOpacity: e.opacity === undefined ? 0.75 : e.opacity });
        });
        // 6. strokes
        list(fx.stroke).slice().reverse().forEach(function (e) {
            var i = list(fx.stroke).indexOf(e);
            if (!maps["st" + i]) { return; }
            var su = fillU(e);
            su.uCov = maps["st" + i];
            su.uMode = mode(e.blendMode);
            su.uOpacity = e.opacity === undefined ? 1 : e.opacity;
            swapPass(su);
        });
        // 7. bevel & emboss
        if (maps.bv) {
            var bv = fx.bevel;
            var style = bv.style || "inner bevel";
            var mul = style === "inner bevel" ? 1 : (style === "outer bevel" ? 2 : 0);
            swapPass({ uCov: maps.bv, uCovChan: 0, uA: A, uCovMul: mul, uColorMode: 0, uColor: colorU(bv.highlightColor || { r: 255, g: 255, b: 255 }), uMode: mode(bv.highlightBlendMode || "screen"), uOpacity: bv.highlightOpacity === undefined ? 0.75 : bv.highlightOpacity });
            swapPass({ uCov: maps.bv, uCovChan: 1, uA: A, uCovMul: mul, uColorMode: 0, uColor: colorU(bv.shadowColor || { r: 0, g: 0, b: 0 }), uMode: mode(bv.shadowBlendMode || "multiply"), uOpacity: bv.shadowOpacity === undefined ? 0.75 : bv.shadowOpacity });
        }

        // layer opacity scales content and effects together
        var out;
        if (layer.opacity >= 1) {
            out = R;
        } else {
            out = G.acquire(W, H);
            G.pass("mix", out, { uA: base, uB: R, uT: layer.opacity, uHasMask: 0, uHasVMask: 0 });
            G.release(R);
        }
        G.release(base);
        return out;
    }

    function releaseMaps(maps) {
        Object.keys(maps).forEach(function (k) { G.release(maps[k]); });
    }

    // drop maps of layers that stopped being rendered (deleted, hidden, style removed)
    function evict() {
        var f = G.frame();
        Object.keys(cache).forEach(function (id) {
            if (cache[id].frame < f - 2) {
                releaseMaps(cache[id].maps);
                delete cache[id];
            }
        });
    }

    PS.gpuBlurMap = blur;

    return { anyEnabled: anyEnabled, apply: apply, evict: evict };
})();

// Blurred layer mask for masks with a feather (cached per mask revision)
PS.gpuMaskTexture = (function () {
    var cache = {};
    return function (layer, ms) {
        var G = PS.gpu;
        var key = layer.id;
        var sig = ms.rev + ":" + layer.mask.feather;
        var e = cache[key];
        if (e && e.sig === sig) { e.frame = G.frame(); return e.tex.tex; }
        if (e) { G.release(e.tex); }
        var W = PS.doc.width, H = PS.doc.height;
        var src = G.sourceTexture(ms.canvas, ms.canvas, ms.rev);
        // luminance (erased = reveal) into r, then blur, then back to gray rgba
        var gray = G.acquire(W, H);
        G.pass("fxMaskGray", gray, { uSrc: src });
        var sigma = layer.mask.feather / 2.355;
        var blurred = PS.gpuBlurMap ? PS.gpuBlurMap(gray, sigma) : null;
        if (blurred) { G.release(gray); gray = blurred; }
        var out = G.acquire(W, H, { format: "rgba8" });
        G.pass("fxGrayOut", out, { uSrc: gray });
        G.release(gray);
        cache[key] = { sig: sig, tex: out, frame: G.frame() };
        return out.tex;
    };
})();

PS.gpu.defineProgram("fxMaskGray", [
    "uniform sampler2D uSrc;",
    "void main() { vec4 t = texelFetch(uSrc, px(), 0); outColor = vec4(mix(1.0, t.r, t.a), 0.0, 0.0, 1.0); }"
].join("\n"));

PS.gpu.defineProgram("fxGrayOut", [
    "uniform sampler2D uSrc;",
    "void main() { float v = texelFetch(uSrc, px(), 0).r; outColor = vec4(v, v, v, 1.0); }"
].join("\n"));
