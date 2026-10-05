/*
    Pixel Studio - brushes

    The brush engine of the Brush, Pencil and Eraser tools, their brush
    presets and the Brush / Brush Presets panels.

        tips        "round" (computed from size, hardness, roundness and
                    angle) or a sampled tip: a grey image whose alpha is the
                    paint. The built-in sampled tips are drawn procedurally
                    (seeded, so they never change); custom ones come from
                    Edit > Define Brush Preset or a loaded .abr brush file.
        dynamics    Shape Dynamics (size / angle / roundness jitter, pen
                    pressure, fade, stroke direction), Scattering (spread,
                    count), Transfer (opacity / flow jitter and pressure),
                    Color Dynamics (foreground / background, hue, saturation,
                    brightness jitter)
        stroke      dabs are laid along the pointer path at the tip spacing
                    into a stroke buffer with the tool's flow; the buffer is
                    composited onto the layer with the tool's opacity and
                    blend mode, clipped by the selection, so a stroke never
                    darkens where it overlaps itself (opacity caps, flow
                    builds up). Smoothing pulls the brush behind the pointer
                    on a string; Airbrush keeps adding paint while the
                    pointer rests; Shift-click draws a straight line from the
                    end of the last stroke.

    Tool options (PS.toolOpts.brush / pencil / eraser): size and hardness at
    the top level (the [ ] and Shift+[ ] keys change them), everything else
    of the tip in o.tip (see PS.TIP_DEFAULTS).
*/
"use strict";

PS.BRUSH_TOOLS = ["brush", "pencil", "eraser"];

PS.TIP_DEFAULTS = {
    shape: "round", spacing: 0.1, angle: 0, roundness: 1, flipX: false, flipY: false,
    shapeDyn: false, sizeJitter: 0, sizeControl: "off", fadeSteps: 25, minDiameter: 0,
    angleJitter: 0, angleControl: "off", roundJitter: 0, minRoundness: 0.25,
    scatterOn: false, scatter: 0, scatterBoth: false, count: 1, countJitter: 0,
    transferOn: false, opacityJitter: 0, opacityControl: "off", flowJitter: 0, flowControl: "off",
    colorOn: false, fgbgJitter: 0, fgbgControl: "off", hueJitter: 0, satJitter: 0, briJitter: 0, colorPerTip: true
};

PS.toolOpts.brush = { size: 24, hardness: 1, opacity: 1, flow: 1, mode: "normal", airbrush: false, smoothing: 0.1,
    pressureOpacity: false, pressureSize: false, preset: "hard-round", tip: {} };
PS.toolOpts.pencil = { size: 3, hardness: 1, opacity: 1, mode: "normal", pressureSize: false, preset: "hard-round", tip: {} };
PS.toolOpts.eraser = { size: 30, hardness: 1, opacity: 1, flow: 1, eraseMode: "brush", airbrush: false, smoothing: 0.1,
    pressureOpacity: false, pressureSize: false, preset: "hard-round", tip: {} };

// Blend modes a brush paints with (canvas composite names, plus Behind / Clear)
PS.BRUSH_MODES = [
    { v: "normal", l: "Normal" }, { v: "behind", l: "Behind" }, { v: "clear", l: "Clear" },
    { v: "darken", l: "Darken" }, { v: "multiply", l: "Multiply" }, { v: "color-burn", l: "Color Burn" },
    { v: "lighten", l: "Lighten" }, { v: "screen", l: "Screen" }, { v: "color-dodge", l: "Color Dodge" },
    { v: "overlay", l: "Overlay" }, { v: "soft-light", l: "Soft Light" }, { v: "hard-light", l: "Hard Light" },
    { v: "difference", l: "Difference" }, { v: "exclusion", l: "Exclusion" },
    { v: "hue", l: "Hue" }, { v: "saturation", l: "Saturation" }, { v: "color", l: "Color" }, { v: "luminosity", l: "Luminosity" }
];

/* ============================================================
   SMALL HELPERS
   ============================================================ */

function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        var t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function smoothstep(a, b, x) {
    var t = PS.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
}

// seeded 2D value noise with fractal sums
function makeNoise(seed) {
    var rand = mulberry32(seed);
    var perm = new Uint8Array(256), vals = new Float32Array(256), i;
    for (i = 0; i < 256; i++) { perm[i] = i; vals[i] = rand(); }
    for (i = 255; i > 0; i--) { var j = Math.floor(rand() * (i + 1)); var t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    function lat(ix, iy) { return vals[perm[(perm[ix & 255] + (iy & 255)) & 255]]; }
    function noise(x, y) {
        var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
        var u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
        var a = lat(ix, iy), b = lat(ix + 1, iy), c = lat(ix, iy + 1), d = lat(ix + 1, iy + 1);
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    function fbm(x, y, oct) {
        var s = 0, amp = 0.5, f = 1, n = 0;
        for (var o = 0; o < oct; o++) { s += amp * noise(x * f, y * f); n += amp; amp *= 0.5; f *= 2; }
        return s / n;
    }
    return { noise: noise, fbm: fbm, rand: rand };
}

function rgbToHsb(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d) {
        if (mx === r) { h = ((g - b) / d) % 6; } else if (mx === g) { h = (b - r) / d + 2; } else { h = (r - g) / d + 4; }
        h /= 6; if (h < 0) { h += 1; }
    }
    return { h: h, s: mx ? d / mx : 0, v: mx };
}

function hsbToRgb(h, s, v) {
    h = ((h % 1) + 1) % 1;
    var i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s), r, g, b;
    switch (i % 6) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        default: r = v; g = p; b = q;
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function cssRgb(c) { return "rgb(" + c.r + "," + c.g + "," + c.b + ")"; }

/* ============================================================
   TIP SHAPES
   ============================================================ */

var TIP_RES = 256;

// a TIP_RES square alpha tip from fn(nx, ny, x, y) -> 0..1 (nx, ny in -1..1)
function pixelTip(fn) {
    var c = PS.createCanvas(TIP_RES, TIP_RES);
    var ctx = c.getContext("2d");
    var img = ctx.createImageData(TIP_RES, TIP_RES), d = img.data;
    for (var y = 0; y < TIP_RES; y++) {
        for (var x = 0; x < TIP_RES; x++) {
            var nx = (x + 0.5) / TIP_RES * 2 - 1, ny = (y + 0.5) / TIP_RES * 2 - 1;
            var i = (y * TIP_RES + x) * 4;
            d[i] = d[i + 1] = d[i + 2] = 255;
            d[i + 3] = Math.round(PS.clamp(fn(nx, ny, x, y), 0, 1) * 255);
        }
    }
    ctx.putImageData(img, 0, 0);
    return c;
}

// a TIP_RES square tip painted with canvas calls (white)
function drawnTip(fn) {
    var c = PS.createCanvas(TIP_RES, TIP_RES);
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#ffffff";
    fn(ctx, TIP_RES);
    return c;
}

PS.TIP_SHAPES = {
    square: { name: "Square", gen: function () { return drawnTip(function (ctx, R) { ctx.fillRect(R * 0.06, R * 0.06, R * 0.88, R * 0.88); }); } },
    chalk: {
        name: "Chalk", gen: function () {
            var N = makeNoise(11), ph = [N.rand() * 6.3, N.rand() * 6.3, N.rand() * 6.3];
            return pixelTip(function (nx, ny, x, y) {
                var r = Math.hypot(nx, ny), th = Math.atan2(ny, nx);
                var edge = 0.8 + 0.07 * Math.sin(3 * th + ph[0]) + 0.05 * Math.sin(7 * th + ph[1]) + 0.04 * Math.sin(13 * th + ph[2]);
                var m = PS.clamp((edge - r) / 0.08, 0, 1);
                var t = N.fbm(x / 7, y / 7, 3) * 0.75 + N.noise(x / 2.2, y / 2.2) * 0.25;
                return m * smoothstep(0.36, 0.6, t);
            });
        }
    },
    charcoal: {
        name: "Charcoal", gen: function () {
            var N = makeNoise(23);
            return pixelTip(function (nx, ny, x, y) {
                var r = Math.hypot(nx, ny / 0.62);
                var m = PS.clamp((0.92 + 0.08 * N.noise(x / 9, y / 9) - r) / 0.1, 0, 1);
                var s = N.fbm(x / 70, y / 2.6, 3);
                return m * smoothstep(0.4, 0.62, s) * (0.6 + 0.4 * N.noise(x / 1.7, y / 1.7));
            });
        }
    },
    pastel: {
        name: "Pastel", gen: function () {
            var N = makeNoise(31);
            return pixelTip(function (nx, ny, x, y) {
                var r = Math.hypot(nx, ny);
                var m = PS.clamp((0.9 - r) / 0.16, 0, 1);
                return m * (0.2 + 0.8 * smoothstep(0.32, 0.68, N.fbm(x / 3, y / 3, 2)));
            });
        }
    },
    spatter: {
        name: "Spatter", gen: function () {
            var rand = mulberry32(41);
            return drawnTip(function (ctx, R) {
                for (var i = 0; i < 70; i++) {
                    var rr = Math.pow(rand(), 0.8) * 0.82 * R / 2, th = rand() * Math.PI * 2;
                    var rad = R / 256 * (1.5 + Math.pow(rand(), 3) * 16);
                    ctx.globalAlpha = 0.7 + 0.3 * rand();
                    ctx.beginPath();
                    ctx.arc(R / 2 + Math.cos(th) * rr, R / 2 + Math.sin(th) * rr, rad, 0, Math.PI * 2);
                    ctx.fill();
                }
            });
        }
    },
    bristle: {
        name: "Bristles", gen: function () {
            var rand = mulberry32(53);
            return drawnTip(function (ctx, R) {
                // a column of bristles: with the angle following the stroke
                // they draw parallel lines
                for (var i = 0; i < 18; i++) {
                    var y = R * (0.08 + 0.84 * (i + rand() * 0.8) / 18.4);
                    var x = R / 2 + (rand() - 0.5) * R * 0.12;
                    ctx.globalAlpha = 0.45 + 0.55 * rand();
                    ctx.beginPath();
                    ctx.ellipse(x, y, R * (0.05 + rand() * 0.05), R * (0.016 + rand() * 0.018), 0, 0, Math.PI * 2);
                    ctx.fill();
                }
            });
        }
    },
    sponge: {
        name: "Sponge", gen: function () {
            var N = makeNoise(67);
            return pixelTip(function (nx, ny, x, y) {
                var r = Math.hypot(nx, ny);
                var m = PS.clamp((0.92 - r) / 0.12, 0, 1);
                return m * smoothstep(0.44, 0.56, N.fbm(x / 9, y / 9, 3));
            });
        }
    },
    hatch: {
        name: "Hatching", gen: function () {
            return drawnTip(function (ctx, R) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(R / 2, R / 2, R * 0.47, 0, Math.PI * 2);
                ctx.clip();
                ctx.lineWidth = R * 0.035;
                ctx.lineCap = "round";
                for (var k = -4; k <= 4; k++) {
                    var o = k * R * 0.13;
                    ctx.beginPath();
                    ctx.moveTo(o, R);
                    ctx.lineTo(R + o, 0);
                    ctx.stroke();
                }
                ctx.restore();
            });
        }
    },
    star: {
        name: "Star", gen: function () {
            return drawnTip(function (ctx, R) {
                ctx.beginPath();
                for (var i = 0; i < 10; i++) {
                    var rad = (i % 2 ? 0.2 : 0.48) * R, a = -Math.PI / 2 + i * Math.PI / 5;
                    var px = R / 2 + Math.cos(a) * rad, py = R / 2 + 0.03 * R + Math.sin(a) * rad;
                    if (i) { ctx.lineTo(px, py); } else { ctx.moveTo(px, py); }
                }
                ctx.closePath();
                ctx.fill();
            });
        }
    },
    leaf: {
        name: "Leaf", gen: function () {
            return drawnTip(function (ctx, R) {
                var k = R / 256;
                ctx.beginPath();
                ctx.moveTo(128 * k, 8 * k);
                ctx.bezierCurveTo(214 * k, 70 * k, 214 * k, 180 * k, 128 * k, 232 * k);
                ctx.bezierCurveTo(42 * k, 180 * k, 42 * k, 70 * k, 128 * k, 8 * k);
                ctx.fill();
                ctx.fillRect(124 * k, 225 * k, 8 * k, 26 * k);
                // veins
                ctx.globalCompositeOperation = "destination-out";
                ctx.lineWidth = 5 * k;
                ctx.lineCap = "round";
                ctx.beginPath();
                ctx.moveTo(128 * k, 34 * k); ctx.lineTo(128 * k, 222 * k);
                for (var i = 0; i < 4; i++) {
                    var y = (82 + i * 36) * k;
                    ctx.moveTo(128 * k, y); ctx.lineTo(80 * k, y - 34 * k);
                    ctx.moveTo(128 * k, y); ctx.lineTo(176 * k, y - 34 * k);
                }
                ctx.stroke();
            });
        }
    },
    grass: {
        name: "Grass", gen: function () {
            var rand = mulberry32(71);
            return drawnTip(function (ctx, R) {
                var k = R / 256;
                for (var i = 0; i < 6; i++) {
                    var bx = (128 + (rand() - 0.5) * 110) * k, by = 252 * k;
                    var tx = bx + (rand() - 0.5) * 130 * k, ty = (8 + rand() * 90) * k;
                    var w = (8 + rand() * 10) * k;
                    var cx = (bx + tx) / 2 + (rand() - 0.5) * 40 * k, cy = (by + ty) / 2;
                    ctx.globalAlpha = 0.75 + 0.25 * rand();
                    ctx.beginPath();
                    ctx.moveTo(bx - w / 2, by);
                    ctx.quadraticCurveTo(cx - w / 3, cy, tx, ty);
                    ctx.quadraticCurveTo(cx + w / 3, cy, bx + w / 2, by);
                    ctx.closePath();
                    ctx.fill();
                }
            });
        }
    },
    cloud: {
        name: "Cloud", gen: function () {
            var rand = mulberry32(79);
            return drawnTip(function (ctx, R) {
                for (var i = 0; i < 9; i++) {
                    var a = rand() * Math.PI * 2, d = rand() * 0.22 * R;
                    var x = R / 2 + Math.cos(a) * d, y = R / 2 + Math.sin(a) * d * 0.7;
                    var r = R * (0.16 + rand() * 0.14);
                    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
                    g.addColorStop(0, "rgba(255,255,255,0.75)");
                    g.addColorStop(0.6, "rgba(255,255,255,0.45)");
                    g.addColorStop(1, "rgba(255,255,255,0)");
                    ctx.fillStyle = g;
                    ctx.fillRect(x - r, y - r, r * 2, r * 2);
                }
            });
        }
    }
};

PS.customTips = {};         // id -> {name, w, h, url, canvas}
var tipCache = {};

// The full-resolution image of a sampled tip (white, alpha = paint), or null
// for the computed round tip and unknown ids
PS.tipImage = function (shape) {
    if (!shape || shape === "round") { return null; }
    if (tipCache[shape]) { return tipCache[shape]; }
    var def = PS.TIP_SHAPES[shape];
    if (def) { tipCache[shape] = def.gen(); return tipCache[shape]; }
    var ct = PS.customTips[shape];
    if (ct && ct.canvas) { return ct.canvas; }
    return null;
};

PS.tipName = function (shape) {
    if (!shape || shape === "round") { return "Round"; }
    if (PS.TIP_SHAPES[shape]) { return PS.TIP_SHAPES[shape].name; }
    return (PS.customTips[shape] && PS.customTips[shape].name) || "Sampled";
};

// soft round tip: falls off with a cosine from the hard core to the edge
function roundTipCanvas(diam, hardness) {
    var n = Math.max(1, Math.ceil(diam) + 2);
    var c = PS.createCanvas(n, n);
    var ctx = c.getContext("2d");
    var r = diam / 2;
    var g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, Math.max(0.5, r));
    var h = PS.clamp(hardness, 0, 0.99);
    for (var i = 0; i <= 16; i++) {
        var t = i / 16;
        var a = t <= h ? 1 : 0.5 + 0.5 * Math.cos(Math.PI * (t - h) / (1 - h));
        g.addColorStop(t, "rgba(255,255,255," + a.toFixed(4) + ")");
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, n, n);
    return c;
}

// a tip image scaled so its larger side is diam (good quality downscaling)
function scaledTip(img, diam) {
    var k = diam / Math.max(img.width, img.height);
    var w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
    var src = img;
    // halve in steps first, so small tips keep their texture
    while (src.width / 2 >= w * 1.5 && src.height / 2 >= h * 1.5) {
        var half = PS.createCanvas(Math.round(src.width / 2), Math.round(src.height / 2));
        var hc = half.getContext("2d");
        hc.imageSmoothingQuality = "high";
        hc.drawImage(src, 0, 0, half.width, half.height);
        src = half;
    }
    var c = PS.createCanvas(w, h);
    var ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, w, h);
    return c;
}

function tinted(alphaCanvas, color) {
    var c = PS.createCanvas(alphaCanvas.width, alphaCanvas.height);
    var ctx = c.getContext("2d");
    ctx.fillStyle = cssRgb(color);
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(alphaCanvas, 0, 0);
    return c;
}

/* ============================================================
   PRESETS
   ============================================================ */

function preset(id, name, size, hardness, tip) {
    return { id: id, name: name, size: size, hardness: hardness, tip: tip || {} };
}

PS.BRUSH_PRESETS_BUILTIN = [
    preset("hard-round", "Hard Round", 30, 1),
    preset("soft-round", "Soft Round", 45, 0),
    preset("hard-round-psize", "Hard Round Pressure Size", 19, 1, { shapeDyn: true, sizeControl: "pressure" }),
    preset("soft-round-popacity", "Soft Round Pressure Opacity", 45, 0, { transferOn: true, opacityControl: "pressure" }),
    preset("hard-round-popacity", "Hard Round Pressure Opacity", 30, 1, { transferOn: true, opacityControl: "pressure", flowControl: "pressure" }),
    preset("calligraphy", "Flat Calligraphy", 25, 1, { roundness: 0.22, angle: 45, spacing: 0.04 }),
    preset("flat-direction", "Flat Follow Direction", 30, 0.9, { roundness: 0.28, angle: 90, spacing: 0.04, shapeDyn: true, angleControl: "direction" }),
    preset("square", "Square", 25, 1, { shape: "square", spacing: 0.1 }),
    preset("chalk", "Chalk", 36, 1, { shape: "chalk", spacing: 0.2, shapeDyn: true, angleJitter: 0.15 }),
    preset("charcoal", "Charcoal", 40, 1, { shape: "charcoal", spacing: 0.15, shapeDyn: true, angleControl: "direction", angleJitter: 0.04 }),
    preset("pastel", "Rough Pastel", 45, 1, { shape: "pastel", spacing: 0.15, shapeDyn: true, angleJitter: 1 }),
    preset("dry-brush", "Dry Brush", 40, 1, { shape: "bristle", spacing: 0.03, shapeDyn: true, angleControl: "direction" }),
    preset("spatter", "Spatter", 39, 1, { shape: "spatter", spacing: 0.4, shapeDyn: true, sizeJitter: 0.4, angleJitter: 1 }),
    preset("sponge", "Sponge", 50, 1, { shape: "sponge", spacing: 0.3, shapeDyn: true, angleJitter: 1, sizeJitter: 0.2 }),
    preset("hatching", "Hatching", 30, 1, { shape: "hatch", spacing: 0.55, shapeDyn: true, sizeJitter: 0.15 }),
    preset("stars", "Scattered Stars", 40, 1, { shape: "star", spacing: 1.2, shapeDyn: true, sizeJitter: 0.6, angleJitter: 1,
        scatterOn: true, scatter: 2, scatterBoth: true, count: 2 }),
    preset("leaves", "Scattered Leaves", 60, 1, { shape: "leaf", spacing: 1, shapeDyn: true, sizeJitter: 0.6, angleJitter: 1,
        scatterOn: true, scatter: 2.2, scatterBoth: true, count: 1, colorOn: true, fgbgJitter: 1, hueJitter: 0.08, briJitter: 0.15 }),
    preset("grass", "Grass", 70, 1, { shape: "grass", spacing: 0.3, shapeDyn: true, sizeJitter: 0.5, angleJitter: 0.08,
        scatterOn: true, scatter: 0.8, colorOn: true, fgbgJitter: 1, hueJitter: 0.05 }),
    preset("clouds", "Clouds", 90, 1, { shape: "cloud", spacing: 0.35, shapeDyn: true, sizeJitter: 0.45, angleJitter: 1,
        scatterOn: true, scatter: 0.6, scatterBoth: true, transferOn: true, opacityJitter: 0.5 }),
    preset("snow", "Scattered Dots", 14, 1, { spacing: 1, shapeDyn: true, sizeJitter: 0.8,
        scatterOn: true, scatter: 3, scatterBoth: true, count: 3, countJitter: 0.5 })
];

PS.brushPresets = function () {
    var list = PS.prefs && Array.isArray(PS.prefs.brushPresets) ? PS.prefs.brushPresets : null;
    return list || PS.BRUSH_PRESETS_BUILTIN;
};

PS.setBrushPresets = function (list) {
    PS.prefs = PS.prefs || {};
    PS.prefs.brushPresets = list;
    PS.savePrefsDebounced();
    PS.refreshBrushUI();
};

// editable copy of the list (the built-ins are never changed in place)
function presetsCopy() { return PS.deepCopy(PS.brushPresets()); }

// Older settings had a stroke "type"; turn it into a tip once
function migrate(o) {
    if (!o.tip || typeof o.tip !== "object") { o.tip = {}; }
    if (o.type) {
        if (o.type === "calligraphy") { o.tip = { roundness: 0.3, angle: 45, spacing: 0.06 }; }
        else if (o.type === "marker") { o.tip = { shape: "square", spacing: 0.15 }; }
        else if (o.type === "spray") { o.tip = { shape: "spatter", spacing: 0.4, shapeDyn: true, angleJitter: 1, sizeJitter: 0.4 }; }
        else if (o.type === "soft") { o.hardness = Math.min(o.hardness === undefined ? 0 : o.hardness, 0.5); }
        else if (o.type === "round") { o.hardness = 1; }
        delete o.type;
    }
    if (o.hardness === undefined) { o.hardness = 1; }
    return o;
}

// effective tip settings of a paint tool
PS.brushTip = function (kind) {
    var o = migrate(PS.toolOpts[kind]);
    return Object.assign({}, PS.TIP_DEFAULTS, o.tip);
};

// the paint tool whose brush the panels edit
PS.brushTool = function () {
    if (PS.BRUSH_TOOLS.indexOf(PS.tool) >= 0) { PS._lastBrushTool = PS.tool; return PS.tool; }
    return PS._lastBrushTool || "brush";
};

PS.applyBrushPreset = function (kind, p) {
    var o = migrate(PS.toolOpts[kind]);
    o.size = p.size;
    o.hardness = p.hardness === undefined ? 1 : p.hardness;
    o.tip = PS.deepCopy(p.tip || {});
    o.preset = p.id;
    PS.savePrefsDebounced();
    PS.refreshBrushUI();
};

// a preset of the tool's current settings
function presetFromTool(kind, name) {
    var o = migrate(PS.toolOpts[kind]);
    return { id: "p" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), name: name,
        size: o.size, hardness: o.hardness, tip: PS.deepCopy(o.tip) };
}

// , and . step through the presets
PS.stepBrushPreset = function (dir) {
    var kind = PS.brushTool();
    var list = PS.brushPresets();
    if (!list.length) { return; }
    var i = -1;
    list.forEach(function (p, k) { if (p.id === PS.toolOpts[kind].preset) { i = k; } });
    var n = list[((i + dir) % list.length + list.length) % list.length];
    PS.applyBrushPreset(kind, n);
    PS.toast(n.name);
};

PS.refreshBrushUI = function () {
    if (PS.BRUSH_TOOLS.indexOf(PS.tool) >= 0) { PS.renderOptionsBar(); }
    if (PS._brushPicker) { PS._brushPicker.refresh(); }
    if (PS.ws) { PS.ws.refresh(); }
};

/* ============================================================
   STROKE ENGINE
   ============================================================ */

// pressure of a pointer event: pens report it, mice and touch paint at full
function pressureOf(e) {
    if (e && e.pointerType === "pen" && typeof e.pressure === "number" && e.pressure > 0) { return e.pressure; }
    return 1;
}

// st: {ctx, o (size, hardness, flow, pressure toggles, smoothing), tip,
// pencil, color, bg, rand}
function prepare(st) {
    var tip = st.tip;
    st.baseSize = Math.max(1, st.o.size);
    st.rest = 0;
    st.dabs = 0;
    st.last = null;
    st.dir = null;
    st.firstDir = null;
    st.colorDyn = !!(tip.colorOn && (tip.fgbgJitter || tip.hueJitter || tip.satJitter || tip.briJitter));
    st.strokeColor = st.color;
    if (st.colorDyn && !tip.colorPerTip) { st.strokeColor = dynColor(st, 1); }
    st.aliasCache = {};
    var img = PS.tipImage(tip.shape);
    if (st.pencil) {
        st.tipData = null;
        if (img) {
            var small = scaledTip(img, Math.min(256, Math.max(32, st.baseSize)));
            st.tipData = { w: small.width, h: small.height, a: small.getContext("2d").getImageData(0, 0, small.width, small.height).data };
        }
        return;
    }
    if (!img && st.o.hardness >= 0.99) { st.vector = true; return; }
    st.vector = false;
    st.alpha = img ? scaledTip(img, st.baseSize) : roundTipCanvas(st.baseSize, st.o.hardness);
    st.tinted = st.colorDyn ? null : tinted(st.alpha, st.strokeColor);
    if (st.colorDyn) {
        st.scratch = PS.createCanvas(st.alpha.width, st.alpha.height);
    }
}

function dynColor(st, pr) {
    var tip = st.tip, r = st.rand;
    var c = st.color;
    if (tip.fgbgJitter || tip.fgbgControl !== "off") {
        var t = tip.fgbgJitter * r();
        if (tip.fgbgControl === "pressure") { t = Math.max(t, 1 - pr); }
        else if (tip.fgbgControl === "fade") { t = Math.max(t, Math.min(1, st.dabs / Math.max(1, tip.fadeSteps))); }
        c = { r: c.r + (st.bg.r - c.r) * t, g: c.g + (st.bg.g - c.g) * t, b: c.b + (st.bg.b - c.b) * t };
    }
    if (tip.hueJitter || tip.satJitter || tip.briJitter) {
        var h = rgbToHsb(c.r, c.g, c.b);
        h.h += (r() * 2 - 1) * tip.hueJitter * 0.5;
        h.s = PS.clamp(h.s + (r() * 2 - 1) * tip.satJitter, 0, 1);
        h.v = PS.clamp(h.v + (r() * 2 - 1) * tip.briJitter, 0, 1);
        return hsbToRgb(h.h, h.s, h.v);
    }
    return { r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) };
}

// spacing in pixels for the current size
function stepPx(st, sizeF) {
    var px = st.tip.spacing * st.baseSize * Math.max(0.1, sizeF);
    return st.pencil ? Math.max(1, px) : Math.max(0.5, px);
}

// one pencil dab: hard edged, no anti-aliasing
function pencilDab(st, x, y, d, angle, roundness, sx, sy, color) {
    var n = Math.max(1, Math.round(d));
    var aq = Math.round(angle * 36 / Math.PI) / 36 * Math.PI;   // 5 degree steps
    var rq = Math.round(roundness * 20) / 20;
    var key = n + "|" + aq.toFixed(3) + "|" + rq + "|" + sx + "|" + sy + "|" + color.r + "," + color.g + "," + color.b;
    var c = st.aliasCache[key];
    if (!c) {
        var keys = Object.keys(st.aliasCache);
        if (keys.length > 240) { st.aliasCache = {}; }
        var span = (rq === 1 && !st.tipData) ? n : Math.ceil(n * Math.SQRT2) + 1;
        c = PS.createCanvas(span, span);
        var ctx = c.getContext("2d");
        var img = ctx.createImageData(span, span), px = img.data;
        var cos = Math.cos(-aq), sin = Math.sin(-aq), half = span / 2, rad = n / 2;
        var td = st.tipData;
        for (var j = 0; j < span; j++) {
            for (var i = 0; i < span; i++) {
                var dx = i + 0.5 - half, dy = j + 0.5 - half;
                // into the tip's own frame (unrotated, unsquashed, unflipped)
                var lx = (dx * cos - dy * sin) * sx, ly = (dx * sin + dy * cos) / Math.max(0.01, rq) * sy;
                var on;
                if (td) {
                    var k = rad / (Math.max(td.w, td.h) / 2);
                    var tx = Math.floor(lx / k + td.w / 2), ty = Math.floor(ly / k + td.h / 2);
                    on = tx >= 0 && ty >= 0 && tx < td.w && ty < td.h && td.a[(ty * td.w + tx) * 4 + 3] >= 128;
                } else {
                    on = n <= 2 ? (Math.abs(lx) <= rad && Math.abs(ly) <= rad) : (lx * lx + ly * ly <= rad * rad + 0.25);
                }
                if (on) {
                    var o = (j * span + i) * 4;
                    px[o] = color.r; px[o + 1] = color.g; px[o + 2] = color.b; px[o + 3] = 255;
                }
            }
        }
        ctx.putImageData(img, 0, 0);
        st.aliasCache[key] = c;
    }
    st.ctx.drawImage(c, Math.round(x - c.width / 2), Math.round(y - c.height / 2));
}

function drawDab(st, x, y, sizeF, angle, roundness, alpha, color) {
    var d = st.baseSize * sizeF;
    if (d < 0.25 || alpha <= 0.002) { return; }
    var tip = st.tip, ctx = st.ctx;
    var sx = tip.flipX ? -1 : 1, sy = tip.flipY ? -1 : 1;
    if (st.pencil) {
        // pencils paint at full strength (flow does not apply)
        ctx.globalAlpha = 1;
        pencilDab(st, x, y, d, angle, roundness, sx, sy, color);
        return;
    }
    ctx.globalAlpha = Math.min(1, alpha);
    if (st.vector) {
        ctx.fillStyle = cssRgb(color);
        ctx.beginPath();
        ctx.ellipse(x, y, Math.max(0.25, d / 2), Math.max(0.25, d / 2 * roundness), angle, 0, Math.PI * 2);
        ctx.fill();
        return;
    }
    var img = st.tinted;
    if (!img) {
        // colour dynamics: tint the tip for this dab
        var s = st.scratch.getContext("2d");
        s.globalCompositeOperation = "copy";
        s.drawImage(st.alpha, 0, 0);
        s.globalCompositeOperation = "source-in";
        s.fillStyle = cssRgb(color);
        s.fillRect(0, 0, st.scratch.width, st.scratch.height);
        img = st.scratch;
    }
    var k = d / st.baseSize;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(k * sx, k * roundness * sy);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
}

// a dab at (x, y) with every dynamic applied
function dabAt(st, x, y, pr) {
    var tip = st.tip, o = st.o, r = st.rand;
    st.dabs++;
    var count = 1;
    if (tip.scatterOn) { count = Math.max(1, Math.round(tip.count * (1 - tip.countJitter * r()))); }
    var dir = st.dir === null ? 0 : st.dir;
    for (var n = 0; n < count; n++) {
        var sizeF = 1, ang = -tip.angle * Math.PI / 180, round = tip.roundness;
        var minD = tip.shapeDyn ? tip.minDiameter : 0;
        if (o.pressureSize || (tip.shapeDyn && tip.sizeControl === "pressure")) { sizeF *= Math.max(minD, pr); }
        if (tip.shapeDyn) {
            if (tip.sizeControl === "fade") { sizeF *= Math.max(minD, 1 - st.dabs / Math.max(1, tip.fadeSteps)); }
            if (tip.sizeJitter) { sizeF *= Math.max(minD, 1 - tip.sizeJitter * r()); }
            if (tip.angleControl === "direction") { ang += dir; }
            else if (tip.angleControl === "initial") { ang += st.firstDir === null ? dir : st.firstDir; }
            else if (tip.angleControl === "pressure") { ang += pr * Math.PI * 2; }
            if (tip.angleJitter) { ang += (r() * 2 - 1) * tip.angleJitter * Math.PI; }
            if (tip.roundJitter) { round *= Math.max(tip.minRoundness, 1 - tip.roundJitter * r()); }
        }
        var px = x, py = y;
        if (tip.scatterOn && tip.scatter) {
            var spread = tip.scatter * st.baseSize;
            if (tip.scatterBoth) {
                px += (r() * 2 - 1) * spread;
                py += (r() * 2 - 1) * spread;
            } else {
                var off = (r() * 2 - 1) * spread;
                px += -Math.sin(dir) * off;
                py += Math.cos(dir) * off;
            }
        }
        var a = o.flow === undefined ? 1 : o.flow;
        if (o.pressureOpacity) { a *= pr; }
        if (tip.transferOn) {
            var fade = 1 - st.dabs / Math.max(1, tip.fadeSteps);
            if (tip.opacityControl === "pressure") { a *= pr; } else if (tip.opacityControl === "fade") { a *= Math.max(0, fade); }
            if (tip.opacityJitter) { a *= 1 - tip.opacityJitter * r(); }
            if (tip.flowControl === "pressure") { a *= pr; } else if (tip.flowControl === "fade") { a *= Math.max(0, fade); }
            if (tip.flowJitter) { a *= 1 - tip.flowJitter * r(); }
        }
        var color = st.colorDyn && tip.colorPerTip ? dynColor(st, pr) : st.strokeColor;
        drawDab(st, px, py, sizeF, ang, round, a, color);
    }
}

function strokeDown(st, x, y, pr) {
    prepare(st);
    st.last = { x: x, y: y, p: pr };
    st.lazy = { x: x, y: y };
    dabAt(st, x, y, pr);
    st.rest = stepPx(st, pr);
}

// straight segment from st.last to (x, y)
function segmentTo(st, x, y, pr) {
    var l = st.last;
    var dx = x - l.x, dy = y - l.y, dist = Math.hypot(dx, dy);
    if (dist < 1e-6) { l.p = pr; return; }
    st.dir = Math.atan2(dy, dx);
    if (st.firstDir === null) { st.firstDir = st.dir; }
    var guard = 0;
    while (st.rest <= dist && guard++ < 100000) {
        var u = st.rest / dist;
        var p = l.p + (pr - l.p) * u;
        dabAt(st, l.x + dx * u, l.y + dy * u, p);
        st.rest += stepPx(st, p);
    }
    st.rest -= dist;
    st.last = { x: x, y: y, p: pr };
}

// follow the pointer, through the smoothing string when there is one
function strokeTo(st, x, y, pr, zoom) {
    var len = (st.o.smoothing || 0) * 40 / (zoom || 1);
    if (len <= 0.01) { segmentTo(st, x, y, pr); return; }
    var dx = x - st.lazy.x, dy = y - st.lazy.y, d = Math.hypot(dx, dy);
    if (d <= len) { st.last.p = pr; return; }
    var k = (d - len) / d;
    st.lazy = { x: st.lazy.x + dx * k, y: st.lazy.y + dy * k };
    segmentTo(st, st.lazy.x, st.lazy.y, pr);
}

// the brush catches up with the pointer when the stroke ends
function strokeEnd(st, x, y, pr) {
    if (st.o.smoothing > 0.01 && x !== undefined) { segmentTo(st, x, y, pr === undefined ? st.last.p : pr); }
}

// Composite a stroke buffer onto ctx (which holds the layer's pixels)
PS.compositeStroke = function (ctx, layerCanvas, buf, alpha, mode, lockAlpha) {
    var op = (mode === "erase" || mode === "clear") ? "destination-out" : (mode === "behind" ? "destination-over" : (mode === "normal" || !mode ? "source-over" : mode));
    if (lockAlpha) {
        if (op === "destination-over") { return; }
        if (op === "source-over") { op = "source-atop"; }
        else if (op !== "destination-out") {
            // blend, then keep the layer's own transparency
            var tmp = PS.cloneCanvas(ctx.canvas);
            var t = tmp.getContext("2d");
            t.globalAlpha = alpha;
            t.globalCompositeOperation = op;
            t.drawImage(buf, 0, 0);
            t.globalAlpha = 1;
            t.globalCompositeOperation = "destination-in";
            t.drawImage(layerCanvas, 0, 0);
            ctx.save();
            ctx.globalCompositeOperation = "copy";
            ctx.drawImage(tmp, 0, 0);
            ctx.restore();
            return;
        }
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = op;
    ctx.drawImage(buf, 0, 0);
    ctx.restore();
};

/* ---------- the tools' strokes ---------- */

PS._stroke = null;
PS._lastPaint = {};     // kind -> {x, y, doc}: where the last stroke ended (Shift-click lines)

PS.beginStroke = function (kind, pt, e) {
    if (e.altKey && kind !== "eraser") {
        PS.sampleColorAt(pt, PS.compositeToCanvas(), false);
        return;
    }
    var layer = PS.requirePaintableLayer();
    if (!layer) { return; }
    var o = migrate(PS.toolOpts[kind]);
    var rgb = PS.hexToRgb(PS.fg) || { r: 0, g: 0, b: 0, a: 255 };
    var bg = PS.hexToRgb(PS.bg) || { r: 255, g: 255, b: 255 };
    var colorAlpha = kind === "eraser" ? 1 : (rgb.a === undefined ? 1 : rgb.a / 255);
    var pencil = kind === "pencil" || (kind === "eraser" && o.eraseMode === "pencil");
    var canvas = PS.createCanvas(PS.doc.width, PS.doc.height);
    var st = {
        kind: kind, layer: layer, o: o, tip: PS.brushTip(kind), pencil: pencil,
        color: kind === "eraser" ? { r: 0, g: 0, b: 0 } : { r: rgb.r, g: rgb.g, b: rgb.b }, bg: bg,
        colorAlpha: colorAlpha, rand: Math.random,
        canvas: canvas, ctx: canvas.getContext("2d"),
        before: PS.snapshotLayer(layer),
        mode: kind === "eraser" ? "erase" : (o.mode || "normal")
    };
    PS._stroke = st;
    PS.strokePreview = {
        layer: layer, canvas: canvas, opacity: o.opacity * colorAlpha, erase: kind === "eraser", mode: st.mode
    };
    var pr = pressureOf(e);
    var last = PS._lastPaint[kind];
    if (e.shiftKey && last && last.doc === PS.doc) {
        // Shift-click: a straight line from where the last stroke ended
        strokeDown(st, last.x, last.y, pr);
        segmentTo(st, pt.x, pt.y, pr);
        st.lazy = { x: pt.x, y: pt.y };
    } else {
        strokeDown(st, pt.x, pt.y, pr);
    }
    st.input = { x: pt.x, y: pt.y, p: pr };
    if (o.airbrush && !pencil) {
        // the airbrush keeps spraying while the pointer rests
        st.air = setInterval(function () {
            if (PS._stroke !== st) { clearInterval(st.air); return; }
            dabAt(st, st.last.x, st.last.y, st.last.p);
            PS.requestRender();
        }, 45);
    }
    PS.requestRender();
};

PS.continueStroke = function (pt, e) {
    var st = PS._stroke;
    if (!st) { return; }
    // every pointer sample since the last event, for smooth curves
    var list = e && e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    if (list && list.length > 1) {
        list.forEach(function (ce) {
            var p = PS.eventToDoc(ce);
            st.input = { x: p.x, y: p.y, p: pressureOf(ce) };
            strokeTo(st, p.x, p.y, st.input.p, PS.zoom);
        });
    } else {
        st.input = { x: pt.x, y: pt.y, p: pressureOf(e) };
        strokeTo(st, pt.x, pt.y, st.input.p, PS.zoom);
    }
    PS.requestRender();
};

PS.endStroke = function () {
    var st = PS._stroke;
    if (!st) { return; }
    if (st.air) { clearInterval(st.air); }
    if (st.input) { strokeEnd(st, st.input.x, st.input.y, st.input.p); }

    var buf = st.canvas;
    if (PS.doc.selection) {
        var masked = PS.cloneCanvas(buf);
        var mctx = masked.getContext("2d");
        mctx.globalCompositeOperation = "destination-in";
        mctx.drawImage(PS.doc.selection.mask, 0, 0);
        buf = masked;
    }
    var lc = st.layer.canvas;
    PS.compositeStroke(lc.getContext("2d"), st.before, buf, st.o.opacity * st.colorAlpha, st.mode,
        !!(st.layer.locks && st.layer.locks.transparency));

    PS.strokePreview = null;
    PS._stroke = null;
    PS._lastPaint[st.kind] = { x: st.last.x, y: st.last.y, doc: PS.doc };

    var labels = { brush: "Brush Tool", pencil: "Pencil", eraser: "Eraser" };
    PS.commitLayerCanvas(labels[st.kind], st.layer, st.before);
    PS.requestRender();
};

/* ============================================================
   THUMBNAILS AND STROKE PREVIEWS
   ============================================================ */

// a preset's tip drawn into a w x h box (light on transparent)
var thumbCache = {}, thumbCount = 0;
PS.drawTipThumb = function (ctx, p, x, y, w, h, color) {
    var tip = Object.assign({}, PS.TIP_DEFAULTS, p.tip || {});
    var img = PS.tipImage(tip.shape);
    var d = Math.max(2, Math.round(Math.min(w, h) * (img ? 0.95 : Math.min(0.95, 0.35 + p.size / 120))));
    var hard = p.hardness === undefined ? 1 : p.hardness;
    color = color || { r: 230, g: 230, b: 230 };
    var key = (img ? tip.shape : "round:" + hard) + "|" + d + "|" + cssRgb(color);
    var t = thumbCache[key];
    if (!t) {
        if (++thumbCount > 600) { thumbCache = {}; thumbCount = 0; }
        t = thumbCache[key] = tinted(img ? scaledTip(img, d) : roundTipCanvas(d, hard), color);
    }
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(-tip.angle * Math.PI / 180);
    ctx.scale(tip.flipX ? -1 : 1, tip.roundness * (tip.flipY ? -1 : 1));
    ctx.drawImage(t, -t.width / 2, -t.height / 2);
    ctx.restore();
};

// An S-shaped sample stroke with the given settings into a canvas
PS.drawStrokePreview = function (canvas, kind, o, tip, opts) {
    opts = opts || {};
    var ctx = canvas.getContext("2d");
    var W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    var buf = PS.createCanvas(W, H);
    var size = Math.min(o.size, H * (opts.maxSizeK || 0.45));
    var color = opts.color || { r: 235, g: 235, b: 235 };
    var st = {
        o: Object.assign({}, o, { size: size, smoothing: 0, pressureSize: o.pressureSize, pressureOpacity: o.pressureOpacity }),
        tip: tip, pencil: kind === "pencil" || (kind === "eraser" && o.eraseMode === "pencil"),
        color: color, bg: opts.bg || { r: 120, g: 120, b: 120 }, rand: mulberry32(7),
        ctx: buf.getContext("2d")
    };
    var pad = Math.max(size * 0.6, 8);
    var N = 80;
    function at(i) {
        var t = i / N;
        // pressure tapers in and out, as a pen stroke would
        var p = Math.sin(Math.PI * t);
        return { x: pad + (W - 2 * pad) * t, y: H / 2 + Math.sin(t * Math.PI * 2) * (H / 2 - pad) * 0.55, p: Math.max(0.05, p) };
    }
    var a = at(0);
    strokeDown(st, a.x, a.y, a.p);
    for (var i = 1; i <= N; i++) { var q = at(i); segmentTo(st, q.x, q.y, q.p); }
    ctx.globalAlpha = kind === "eraser" ? 1 : (o.opacity === undefined ? 1 : o.opacity);
    ctx.drawImage(buf, 0, 0);
    ctx.globalAlpha = 1;
};

/* ============================================================
   OPTIONS BAR
   ============================================================ */

PS.BRUSH_ICONS = {
    panel: '<svg viewBox="0 0 24 24" stroke-width="1.5"><path d="M3 6h7l2 2h9v11H3z"/><path d="M9 16c2-3 4-3 6-5"/></svg>',
    pressureOpacity: '<svg viewBox="0 0 24 24" stroke-width="1.5"><path d="M14 4l6 6-9 9H5v-6z"/><path d="M4 21h16" stroke-dasharray="2 2"/></svg>',
    pressureSize: '<svg viewBox="0 0 24 24" stroke-width="1.5"><path d="M14 4l6 6-9 9H5v-6z"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
    airbrush: '<svg viewBox="0 0 24 24" stroke-width="1.5"><path d="M4 14h9l3-3h4v6h-4l-3-3"/><path d="M8 14v4h3M17 7l1.5-2.5M20 9l2-1M14 7.5 13.5 5"/></svg>',
    gear: '<svg viewBox="0 0 24 24" stroke-width="1.6"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
    plus: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M12 5v14M5 12h14"/></svg>',
    trash: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>'
};

function iconToggle(host, icon, title, on, onclick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "opt-icon-btn" + (on ? " active" : "");
    b.title = title;
    b.innerHTML = icon;
    b.addEventListener("click", onclick);
    host.appendChild(b);
    return b;
}

// size slider mapping: fine control for small brushes
function sizeToSlider(v) { return Math.round(Math.pow((PS.clamp(v, 1, 2500) - 1) / 2499, 1 / 3) * 1000); }
function sliderToSize(s) { return Math.max(1, Math.round(1 + 2499 * Math.pow(s / 1000, 3))); }

function brushToolOptions(kind, host) {
    var o = migrate(PS.toolOpts[kind]);
    PS.brushPickerButton(host, kind);
    iconToggle(host, PS.BRUSH_ICONS.panel, "Toggle the Brush panel (F5)", PS.ws.isVisible("brush"), function () {
        PS.toggleBrushPanel();
    });
    PS.ui.sep(host);
    if (kind === "eraser") {
        PS.ui.select(host, "Mode:", [{ v: "brush", l: "Brush" }, { v: "pencil", l: "Pencil" }], o.eraseMode || "brush", function (v) {
            o.eraseMode = v; PS.savePrefsDebounced(); PS.renderOptionsBar();
        });
    } else {
        PS.ui.select(host, "Mode:", PS.BRUSH_MODES, o.mode || "normal", function (v) { o.mode = v; PS.savePrefsDebounced(); })
            .title = "Blend mode of the paint";
    }
    PS.ui.slider(host, "Opacity:", Math.round(o.opacity * 100), 1, 100, 1, function (v) {
        o.opacity = v / 100; PS.savePrefsDebounced();
    }, "%");
    var pencilLike = kind === "pencil" || (kind === "eraser" && o.eraseMode === "pencil");
    if (!pencilLike) {
        iconToggle(host, PS.BRUSH_ICONS.pressureOpacity, "Pen pressure controls opacity", !!o.pressureOpacity, function () {
            o.pressureOpacity = !o.pressureOpacity; PS.savePrefsDebounced(); PS.renderOptionsBar();
        });
        PS.ui.slider(host, "Flow:", Math.round((o.flow === undefined ? 1 : o.flow) * 100), 1, 100, 1, function (v) {
            o.flow = v / 100; PS.savePrefsDebounced();
        }, "%");
        iconToggle(host, PS.BRUSH_ICONS.airbrush, "Airbrush: paint builds up while the pointer rests", !!o.airbrush, function () {
            o.airbrush = !o.airbrush; PS.savePrefsDebounced(); PS.renderOptionsBar();
        });
        PS.ui.numeric(host, "Smoothing:", Math.round((o.smoothing || 0) * 100), 0, 100, 1, function (v) {
            o.smoothing = v / 100; PS.savePrefsDebounced();
        }, "%").title = "The brush trails the pointer on a string for steadier lines";
    }
    iconToggle(host, PS.BRUSH_ICONS.pressureSize, "Pen pressure controls size", !!o.pressureSize, function () {
        o.pressureSize = !o.pressureSize; PS.savePrefsDebounced(); PS.renderOptionsBar();
    });
}

/* ---------- brush picker (options bar drop-down) ---------- */

PS._brushPicker = null;

// options: roundOnly (retouching tools: size and hardness, round presets)
PS.brushPickerButton = function (host, kind, options) {
    options = options || {};
    var o = PS.toolOpts[kind];
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "brush-pick-btn";
    btn.title = "Brush preset picker";
    var cv = document.createElement("canvas");
    cv.width = 22; cv.height = 22;
    var p = { size: o.size, hardness: o.hardness === undefined ? 1 : o.hardness, tip: options.roundOnly ? {} : (o.tip || {}) };
    PS.drawTipThumb(cv.getContext("2d"), p, 0, 0, 22, 22);
    var num = document.createElement("span");
    num.className = "brush-pick-size";
    num.textContent = Math.round(o.size);
    var tri = document.createElement("span");
    tri.className = "brush-pick-tri";
    btn.appendChild(cv);
    btn.appendChild(num);
    btn.appendChild(tri);
    btn.addEventListener("mousedown", function (e) { e.preventDefault(); });
    btn.addEventListener("click", function () {
        if (PS._brushPicker && PS._brushPicker.btnKind === kind) { PS.closeBrushPicker(); return; }
        PS.openBrushPicker(btn, kind, options);
    });
    host.appendChild(btn);
    return btn;
};

PS.closeBrushPicker = function () {
    var bp = PS._brushPicker;
    if (!bp) { return; }
    bp.el.remove();
    document.removeEventListener("pointerdown", bp.outside, true);
    document.removeEventListener("keydown", bp.key, true);
    PS._brushPicker = null;
};

PS.openBrushPicker = function (anchor, kind, options) {
    PS.closeBrushPicker();
    var el = document.createElement("div");
    el.className = "brush-picker";
    document.body.appendChild(el);
    var bp = {
        el: el, btnKind: kind,
        refresh: function () { build(); },
        outside: function (e) {
            if (el.contains(e.target) || (e.target.closest && e.target.closest(".brush-pick-btn, .context-menu, .dialog-overlay"))) { return; }
            PS.closeBrushPicker();
        },
        key: function (e) { if (e.key === "Escape") { PS.closeBrushPicker(); } }
    };
    PS._brushPicker = bp;

    function build() {
        var o = PS.toolOpts[kind];
        el.innerHTML = "";
        var tip = options.roundOnly ? PS.TIP_DEFAULTS : PS.brushTip(kind);
        var head = document.createElement("div");
        head.className = "bp-head";
        var rows = document.createElement("div");
        rows.className = "bp-rows";
        sliderRow(rows, "Size:", sizeToSlider(o.size), 0, 1000, function (v) {
            o.size = sliderToSize(v); numSize.value = o.size; PS.savePrefsDebounced(); refreshButton();
        }, "px");
        var numSize = rows.lastChild.querySelector("input[type=number]");
        numSize.min = 1; numSize.max = 2500; numSize.value = Math.round(o.size);
        numSize.addEventListener("change", function () {
            o.size = PS.clamp(Math.round(parseFloat(numSize.value) || 1), 1, 2500);
            rows.firstChild.querySelector("input[type=range]").value = sizeToSlider(o.size);
            PS.savePrefsDebounced(); refreshButton();
        });
        var hardRow = sliderRow(rows, "Hardness:", Math.round((o.hardness === undefined ? 1 : o.hardness) * 100), 0, 100, function (v) {
            o.hardness = v / 100; PS.savePrefsDebounced(); refreshButton();
        }, "%");
        if (PS.tipImage(tip.shape)) { hardRow.classList.add("disabled"); hardRow.title = "Sampled tips have no hardness"; }
        head.appendChild(rows);
        if (!options.roundOnly) {
            var gear = document.createElement("button");
            gear.type = "button";
            gear.className = "opt-icon-btn bp-gear";
            gear.title = "Brush preset options";
            gear.innerHTML = PS.BRUSH_ICONS.gear;
            gear.addEventListener("click", function (e) {
                e.stopPropagation();
                var r = gear.getBoundingClientRect();
                PS.contextMenu(r.right, r.bottom, presetMenuItems(kind), { alignRight: true });
            });
            head.appendChild(gear);
        }
        el.appendChild(head);
        var list = PS.brushPresets();
        if (options.roundOnly) {
            list = list.filter(function (p) {
                var t = p.tip || {};
                return (!t.shape || t.shape === "round") && (t.roundness === undefined || t.roundness === 1) && !t.shapeDyn && !t.scatterOn;
            });
        }
        el.appendChild(presetGrid(kind, list, { compact: true, roundOnly: options.roundOnly, onPick: function () {
            if (options.roundOnly) { build(); refreshButton(); }
        } }));
    }

    function refreshButton() {
        if (PS.renderOptionsBar && PS.tool === kind) {
            // the button's thumbnail and size follow without closing the picker
            var b = document.querySelector("#optionsbar .brush-pick-btn");
            if (b) {
                var o = PS.toolOpts[kind];
                b.querySelector(".brush-pick-size").textContent = Math.round(o.size);
                var cv = b.querySelector("canvas");
                var c = cv.getContext("2d");
                c.clearRect(0, 0, cv.width, cv.height);
                PS.drawTipThumb(c, { size: o.size, hardness: o.hardness, tip: options.roundOnly ? {} : o.tip }, 0, 0, cv.width, cv.height);
            }
        }
        if (PS.ws) { PS.ws.refresh(); }
    }

    build();
    var r = anchor.getBoundingClientRect();
    var er = el.getBoundingClientRect();
    el.style.left = Math.round(PS.clamp(r.left, 4, Math.max(4, window.innerWidth - er.width - 4))) + "px";
    el.style.top = Math.round(Math.min(r.bottom + 4, Math.max(4, window.innerHeight - er.height - 4))) + "px";
    setTimeout(function () {
        document.addEventListener("pointerdown", bp.outside, true);
        document.addEventListener("keydown", bp.key, true);
    }, 0);
};

// "Label [====o====] [12] px" row
function sliderRow(host, label, value, min, max, onInput, unit) {
    var row = document.createElement("div");
    row.className = "bp-row";
    var lab = document.createElement("span");
    lab.className = "bp-label";
    lab.textContent = label;
    var range = document.createElement("input");
    range.type = "range";
    range.min = min; range.max = max; range.step = 1;
    range.value = value;
    var num = document.createElement("input");
    num.type = "number";
    num.min = min; num.max = max;
    num.value = value;
    range.addEventListener("input", function () { num.value = range.value; onInput(parseFloat(range.value)); });
    num.addEventListener("change", function () {
        var v = PS.clamp(parseFloat(num.value) || 0, min, max);
        num.value = v; range.value = v; onInput(v);
    });
    row.appendChild(lab);
    row.appendChild(range);
    row.appendChild(num);
    if (unit) {
        var u = document.createElement("span");
        u.className = "bp-unit";
        u.textContent = unit;
        row.appendChild(u);
    }
    host.appendChild(row);
    return row;
}

// grid of preset thumbnails; click applies, right-click offers rename / delete
function presetGrid(kind, list, opts) {
    var grid = document.createElement("div");
    grid.className = "bp-grid" + (opts.list ? " list" : "") + (opts.compact ? " compact" : "");
    var cur = PS.toolOpts[kind].preset;
    list.forEach(function (p) {
        var cell = document.createElement("div");
        cell.className = "bp-cell" + (p.id === cur ? " active" : "");
        cell.title = p.name;
        var cv = document.createElement("canvas");
        cv.width = opts.list ? 34 : 38;
        cv.height = opts.list ? 30 : 30;
        PS.drawTipThumb(cv.getContext("2d"), p, 2, 1, cv.width - 4, cv.height - 2);
        cell.appendChild(cv);
        var lab = document.createElement("span");
        lab.className = "bp-size";
        lab.textContent = opts.list ? p.name : Math.round(p.size);
        cell.appendChild(lab);
        cell.addEventListener("click", function () {
            if (opts.roundOnly) {
                var o = PS.toolOpts[kind];
                o.size = p.size; o.hardness = p.hardness === undefined ? 1 : p.hardness; o.preset = p.id;
                PS.savePrefsDebounced();
            } else {
                PS.applyBrushPreset(kind, p);
            }
            Array.prototype.forEach.call(grid.children, function (c) { c.classList.toggle("active", c === cell); });
            if (opts.onPick) { opts.onPick(p); }
        });
        if (!opts.roundOnly) {
            cell.addEventListener("dblclick", function () { renamePreset(p.id); });
            cell.addEventListener("contextmenu", function (e) {
                e.preventDefault();
                e.stopPropagation();
                PS.contextMenu(e.clientX, e.clientY, [
                    { label: "Rename Brush...", action: function () { renamePreset(p.id); } },
                    { label: "Delete Brush", action: function () { deletePreset(p.id); } }
                ]);
            });
        }
        grid.appendChild(cell);
    });
    return grid;
}

function renamePreset(id) {
    var list = presetsCopy();
    var p = list.filter(function (x) { return x.id === id; })[0];
    if (!p) { return; }
    PS.promptName("Rename Brush", "Name:", p.name, function (name) {
        p.name = name;
        PS.setBrushPresets(list);
    });
}

function deletePreset(id) {
    var list = presetsCopy().filter(function (x) { return x.id !== id; });
    PS.setBrushPresets(list);
    pruneCustomTips();
}

PS.newBrushPreset = function () {
    var kind = PS.brushTool();
    PS.promptName("Brush Name", "Name:", "Brush " + (PS.brushPresets().length + 1), function (name) {
        var list = presetsCopy();
        var p = presetFromTool(kind, name);
        list.push(p);
        PS.toolOpts[kind].preset = p.id;
        PS.setBrushPresets(list);
    });
};

PS.resetBrushPresets = function () {
    PS.dialog({
        title: "Reset Brushes",
        build: function (body) { body.textContent = "Replace the brush presets with the default set? Presets you made are removed."; },
        buttons: [{ label: "Cancel" }, { label: "Reset", primary: true, action: function () {
            if (PS.prefs) { delete PS.prefs.brushPresets; }
            PS.savePrefsDebounced();
            pruneCustomTips();
            PS.refreshBrushUI();
        } }]
    });
};

function presetMenuItems(kind) {
    void kind;
    return [
        { label: "New Brush Preset...", action: PS.newBrushPreset },
        { sep: true },
        { label: "Define Brush Preset from Selection...", action: PS.defineBrushPreset, enabled: function () { return !!PS.doc; } },
        { label: "Load Brushes (.abr)...", action: PS.loadBrushFile },
        { label: "Reset Brushes...", action: PS.resetBrushPresets },
        { sep: true },
        { label: "Small Thumbnails", checked: function () { return !(PS.prefs && PS.prefs.brushListView); },
            action: function () { PS.prefs.brushListView = false; PS.savePrefsDebounced(); PS.refreshBrushUI(); } },
        { label: "Large List", checked: function () { return !!(PS.prefs && PS.prefs.brushListView); },
            action: function () { PS.prefs = PS.prefs || {}; PS.prefs.brushListView = true; PS.savePrefsDebounced(); PS.refreshBrushUI(); } }
    ];
}

// small modal asking for a name
PS.promptName = function (title, label, value, done) {
    var inp = document.createElement("input");
    inp.type = "text";
    inp.value = value || "";
    PS.dialog({
        title: title,
        build: function (body) { PS.dialogRow(body, label, inp); inp.style.width = "220px"; },
        buttons: [{ label: "Cancel" }, { label: "OK", primary: true, action: function () {
            var v = inp.value.trim();
            if (!v) { return false; }
            done(v);
        } }]
    });
};

/* ============================================================
   CUSTOM TIPS: DEFINE BRUSH PRESET, LOAD .ABR
   ============================================================ */

var MAX_CUSTOM_TIP = 400;   // longest side of a stored custom tip, pixels

// Grey image -> tip: dark = paint. Accepts {w, h, a: Uint8Array alpha} or a
// canvas holding colour pixels.
function tipFromCanvas(src) {
    var w = src.width, h = src.height;
    var d = src.getContext("2d").getImageData(0, 0, w, h).data;
    var out = PS.createCanvas(w, h);
    var octx = out.getContext("2d");
    var img = octx.createImageData(w, h), od = img.data;
    for (var i = 0; i < d.length; i += 4) {
        var lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
        od[i] = od[i + 1] = od[i + 2] = 255;
        od[i + 3] = Math.round((1 - lum) * d[i + 3]);
    }
    octx.putImageData(img, 0, 0);
    return out;
}

function tipFromAlpha(w, h, alpha) {
    var c = PS.createCanvas(w, h);
    var ctx = c.getContext("2d");
    var img = ctx.createImageData(w, h), d = img.data;
    for (var i = 0, j = 0; j < alpha.length; i += 4, j++) {
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = alpha[j];
    }
    ctx.putImageData(img, 0, 0);
    return c;
}

// crop to the painted area and limit the size
function finishTip(c) {
    var b = PS.maskBounds(c);
    if (!b) { return null; }
    var crop = PS.createCanvas(b.w, b.h);
    crop.getContext("2d").drawImage(c, -b.x, -b.y);
    if (Math.max(b.w, b.h) > MAX_CUSTOM_TIP) { crop = scaledTip(crop, MAX_CUSTOM_TIP); }
    return crop;
}

function addCustomTip(canvas, name) {
    var id = "u" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    PS.customTips[id] = { name: name, w: canvas.width, h: canvas.height, url: canvas.toDataURL("image/png"), canvas: canvas };
    return id;
}

// Edit > Define Brush Preset: the selected part of the visible image
PS.defineBrushPreset = function () {
    if (!PS.doc) { return; }
    var comp = PS.compositeToCanvas();
    var d = PS.doc;
    var b = d.selection ? d.selection.bounds : { x: 0, y: 0, w: d.width, h: d.height };
    if (!b || b.w < 1 || b.h < 1) { PS.toast("Nothing selected", true); return; }
    var c = PS.createCanvas(b.w, b.h);
    var ctx = c.getContext("2d");
    ctx.drawImage(comp, -b.x, -b.y);
    if (d.selection) {
        ctx.globalCompositeOperation = "destination-in";
        ctx.drawImage(d.selection.mask, -b.x, -b.y);
    }
    var tip = finishTip(tipFromCanvas(c));
    if (!tip) { PS.toast("The selection holds no dark pixels to make a brush from", true); return; }
    PS.promptName("Brush Name", "Name:", "Sampled Brush " + (Object.keys(PS.customTips).length + 1), function (name) {
        var id = addCustomTip(tip, name);
        var list = presetsCopy();
        var p = { id: "p" + id, name: name, size: Math.max(tip.width, tip.height), hardness: 1, tip: { shape: id, spacing: 0.25 } };
        list.push(p);
        PS.setBrushPresets(list);
        PS.applyBrushPreset(PS.brushTool(), p);
        PS.saveCustomTips();
        PS.toast("Brush \"" + name + "\" defined");
    });
};

function dynControl(dyn) {
    var c = dyn && dyn.control;
    if (c === "pen pressure") { return "pressure"; }
    if (c === "fade") { return "fade"; }
    if (c === "direction") { return "direction"; }
    if (c === "initial direction") { return "initial"; }
    return "off";
}

// presets from a parsed brush file (ag-psd's readAbr result)
function presetsFromAbr(abr, fileName) {
    var samples = {};
    (abr.samples || []).forEach(function (s) { samples[s.id] = s; });
    var out = [];
    (abr.brushes || []).forEach(function (b, i) {
        var sh = b.shape || {};
        var tip = { spacing: PS.clamp((sh.spacing || b.spacing || 25) / 100, 0.01, 10) };
        var hardness = 1, size = Math.round(sh.size || 30);
        if (sh.type === "sampled" && samples[sh.sampledData]) {
            var s = samples[sh.sampledData];
            var c = finishTip(tipFromAlpha(s.bounds.w, s.bounds.h, s.alpha));
            if (!c) { return; }
            tip.shape = addCustomTip(c, b.name || ("Brush " + (i + 1)));
        } else if (sh.type === "computed") {
            hardness = PS.clamp((sh.hardness === undefined ? 100 : sh.hardness) / 100, 0, 1);
        } else {
            return;     // bristle / erodible tips are not supported
        }
        if (sh.angle) { tip.angle = sh.angle; }
        if (sh.roundness !== undefined && sh.roundness !== 100) { tip.roundness = PS.clamp(sh.roundness / 100, 0.01, 1); }
        if (sh.flipX) { tip.flipX = true; }
        if (sh.flipY) { tip.flipY = true; }
        var sd = b.shapeDynamics;
        if (sd) {
            tip.shapeDyn = true;
            tip.sizeJitter = (sd.sizeDynamics && sd.sizeDynamics.jitter || 0) / 100;
            tip.sizeControl = dynControl(sd.sizeDynamics);
            tip.minDiameter = (sd.minimumDiameter || 0) / 100;
            tip.angleJitter = (sd.angleDynamics && sd.angleDynamics.jitter || 0) / 100;
            tip.angleControl = dynControl(sd.angleDynamics);
            tip.roundJitter = (sd.roundnessDynamics && sd.roundnessDynamics.jitter || 0) / 100;
            tip.minRoundness = Math.max(0.01, (sd.minimumRoundness || 25) / 100);
            if (sd.sizeDynamics && sd.sizeDynamics.steps) { tip.fadeSteps = sd.sizeDynamics.steps; }
        }
        var sc = b.scatter;
        if (sc) {
            tip.scatterOn = true;
            tip.scatter = (sc.scatterDynamics && sc.scatterDynamics.jitter || 0) / 100;
            tip.scatterBoth = !!sc.bothAxes;
            tip.count = Math.max(1, sc.count || 1);
            tip.countJitter = (sc.countDynamics && sc.countDynamics.jitter || 0) / 100;
        }
        var tr = b.transfer;
        if (tr) {
            tip.transferOn = true;
            tip.opacityJitter = (tr.opacityDynamics && tr.opacityDynamics.jitter || 0) / 100;
            tip.opacityControl = dynControl(tr.opacityDynamics);
            tip.flowJitter = (tr.flowDynamics && tr.flowDynamics.jitter || 0) / 100;
            tip.flowControl = dynControl(tr.flowDynamics);
        }
        var cd = b.colorDynamics;
        if (cd) {
            tip.colorOn = true;
            tip.fgbgJitter = (cd.foregroundBackground && cd.foregroundBackground.jitter || 0) / 100;
            tip.fgbgControl = dynControl(cd.foregroundBackground);
            tip.hueJitter = (cd.hue || 0) / 100;
            tip.satJitter = (cd.saturation || 0) / 100;
            tip.briJitter = (cd.brightness || 0) / 100;
            tip.colorPerTip = cd.perTip !== false;
        }
        out.push({ id: "p" + Date.now().toString(36) + i + Math.floor(Math.random() * 1e4).toString(36),
            name: b.name || (fileName + " " + (i + 1)), size: size, hardness: hardness, tip: tip });
    });
    return out;
}

// read a local / ArozOS file into an ArrayBuffer
PS.pickFileBuffer = function (accept, done) {
    if (PS.inArozOS() && typeof ao_module_openFileSelector !== "undefined") {
        window.psBrushFileCallback = function (filedata) {
            if (!filedata || !filedata.length) { return; }
            var f = filedata[0];
            fetch(PS.mediaUrl(f.filepath)).then(function (r) {
                if (!r.ok) { throw new Error("HTTP " + r.status); }
                return r.arrayBuffer();
            }).then(function (buf) { done(buf, f.filename); })
                .catch(function (err) { PS.toast("Cannot read " + f.filename + ": " + err.message, true); });
        };
        ao_module_openFileSelector(window.psBrushFileCallback, "user:/Desktop", "file", false, { path_memory_key: "brushes" });
        return;
    }
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = accept;
    inp.addEventListener("change", function () {
        var f = inp.files[0];
        if (!f) { return; }
        f.arrayBuffer().then(function (buf) { done(buf, f.name); });
    });
    inp.click();
};

PS.loadBrushFile = function () {
    PS.pickFileBuffer(".abr", function (buf, name) {
        PS.showBusy("Loading brushes...");
        PS.docio.readAbr(buf).then(function (abr) {
            PS.hideBusy();
            var added = presetsFromAbr(abr, name.replace(/\.abr$/i, ""));
            if (!added.length) { PS.toast("No brushes this editor can use were found in " + name, true); return; }
            PS.setBrushPresets(presetsCopy().concat(added));
            PS.saveCustomTips();
            PS.toast(added.length + " brush" + (added.length === 1 ? "" : "es") + " loaded from " + name);
        }).catch(function (err) {
            PS.hideBusy();
            PS.toast("Cannot read " + name + ": " + (err && err.message ? err.message : err), true);
        });
    });
};

/* ---------- storage of custom tips ---------- */

// custom tips no preset uses are forgotten
function pruneCustomTips() {
    var used = {};
    PS.brushPresets().forEach(function (p) { if (p.tip && p.tip.shape) { used[p.tip.shape] = true; } });
    PS.BRUSH_TOOLS.forEach(function (k) { var t = PS.toolOpts[k].tip; if (t && t.shape) { used[t.shape] = true; } });
    var changed = false;
    Object.keys(PS.customTips).forEach(function (id) { if (!used[id]) { delete PS.customTips[id]; changed = true; } });
    if (changed) { PS.saveCustomTips(); }
}

PS.saveCustomTips = function () {
    var data = {};
    Object.keys(PS.customTips).forEach(function (id) {
        var t = PS.customTips[id];
        data[id] = { name: t.name, w: t.w, h: t.h, url: t.url };
    });
    var json = JSON.stringify(data);
    function local() {
        try { localStorage.setItem("pixelstudio_brushes", json); }
        catch (e) { PS.toast("The custom brushes are too large to keep in this browser", true); }
    }
    if (PS.inArozOS()) {
        try {
            ao_module_agirun("Pixel Studio/backend/prefs.js", { action: "setbrushes", data: json }, function () { }, local);
            return;
        } catch (e) { /* standalone */ }
    }
    local();
};

PS.loadCustomTips = function (done) {
    function apply(data) {
        var ids = Object.keys(data || {});
        var left = ids.length;
        if (!left) { if (done) { done(); } return; }
        ids.forEach(function (id) {
            var t = data[id];
            var img = new Image();
            img.onload = function () {
                var c = PS.createCanvas(img.naturalWidth, img.naturalHeight);
                c.getContext("2d").drawImage(img, 0, 0);
                PS.customTips[id] = { name: t.name, w: c.width, h: c.height, url: t.url, canvas: c };
                if (--left === 0) { PS.refreshBrushUI(); if (done) { done(); } }
            };
            img.onerror = function () { if (--left === 0 && done) { done(); } };
            img.src = t.url;
        });
    }
    function local() {
        var data = null;
        try { data = JSON.parse(localStorage.getItem("pixelstudio_brushes") || "null"); } catch (e) { data = null; }
        apply(data);
    }
    if (PS.inArozOS()) {
        try {
            ao_module_agirun("Pixel Studio/backend/prefs.js", { action: "getbrushes" }, function (data) {
                if (typeof data === "string") { try { data = JSON.parse(data); } catch (e) { data = null; } }
                apply(data && !data.error ? data : null);
            }, local);
            return;
        } catch (e) { /* standalone */ }
    }
    local();
};

/* ============================================================
   PANELS: BRUSH (SETTINGS) AND BRUSH PRESETS
   ============================================================ */

PS.toggleBrushPanel = function () {
    if (PS.ws.isVisible("brush")) { PS.ws.hidePanel("brush"); } else { PS.ws.showPanel("brush"); }
    if (PS.BRUSH_TOOLS.indexOf(PS.tool) >= 0) { PS.renderOptionsBar(); }
};

var brushSection = "tip";   // open section of the Brush panel

PS.renderBrushPanel = function () {
    var body = PS.el("panel-brush-body");
    if (!body) { return; }
    var kind = PS.brushTool();
    var o = migrate(PS.toolOpts[kind]);
    var tip = PS.brushTip(kind);
    body.innerHTML = "";
    body.classList.add("brush-panel");

    function setTip(key, v, rebuild) {
        o.tip[key] = v;
        o.preset = null;
        PS.savePrefsDebounced();
        drawPreview();
        if (rebuild) { PS.renderBrushPanel(); }
        if (PS.tool === kind) { PS.renderOptionsBar(); }
    }

    var top = document.createElement("div");
    top.className = "brp-top";
    var who = document.createElement("span");
    who.className = "brp-tool";
    who.textContent = PS.tools[kind].name + " tool";
    top.appendChild(who);
    var presetsBtn = document.createElement("button");
    presetsBtn.type = "button";
    presetsBtn.className = "brp-btn";
    presetsBtn.textContent = "Brush Presets";
    presetsBtn.addEventListener("click", function () { PS.ws.showPanel("brushpresets"); });
    top.appendChild(presetsBtn);
    body.appendChild(top);

    var preview = document.createElement("canvas");
    preview.className = "brp-preview";
    preview.width = 256; preview.height = 64;
    body.appendChild(preview);
    function drawPreview() {
        PS.drawStrokePreview(preview, kind, o, PS.brushTip(kind), { maxSizeK: 0.4 });
    }

    function section(id, title, enableKey) {
        var wrap = document.createElement("div");
        wrap.className = "brp-sec" + (brushSection === id ? " open" : "");
        var head = document.createElement("div");
        head.className = "brp-sec-head";
        if (enableKey) {
            var cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = !!tip[enableKey];
            cb.title = "Turn " + title + " on or off";
            cb.addEventListener("click", function (e) { e.stopPropagation(); });
            cb.addEventListener("change", function () { setTip(enableKey, cb.checked); });
            head.appendChild(cb);
        }
        var t = document.createElement("span");
        t.textContent = title;
        head.appendChild(t);
        var chev = document.createElement("span");
        chev.className = "brp-chev";
        head.appendChild(chev);
        head.addEventListener("click", function () {
            brushSection = brushSection === id ? "" : id;
            PS.renderBrushPanel();
        });
        wrap.appendChild(head);
        var content = document.createElement("div");
        content.className = "brp-sec-body";
        wrap.appendChild(content);
        body.appendChild(wrap);
        return content;
    }

    function pct(host, label, key, max, unit) {
        sliderRow(host, label, Math.round((tip[key] || 0) * 100), 0, max || 100, function (v) { setTip(key, v / 100); }, unit || "%");
    }
    function control(host, key, label, opts) {
        var row = document.createElement("div");
        row.className = "bp-row";
        var lab = document.createElement("span");
        lab.className = "bp-label";
        lab.textContent = label;
        var sel = PS.selectInput(opts, tip[key] || "off");
        sel.addEventListener("change", function () { setTip(key, sel.value); });
        row.appendChild(lab);
        row.appendChild(sel);
        host.appendChild(row);
    }
    var CTRL = [{ v: "off", l: "Off" }, { v: "fade", l: "Fade" }, { v: "pressure", l: "Pen Pressure" }];

    // -- Brush Tip Shape
    var s1 = section("tip", "Brush Tip Shape");
    var tips = document.createElement("div");
    tips.className = "brp-tips";
    ["round"].concat(Object.keys(PS.TIP_SHAPES), Object.keys(PS.customTips)).forEach(function (shape) {
        var cell = document.createElement("div");
        cell.className = "brp-tipcell" + ((tip.shape || "round") === shape ? " active" : "");
        cell.title = PS.tipName(shape);
        var cv = document.createElement("canvas");
        cv.width = 30; cv.height = 30;
        PS.drawTipThumb(cv.getContext("2d"), { size: 60, hardness: shape === "round" ? o.hardness : 1, tip: { shape: shape } }, 1, 1, 28, 28);
        cell.appendChild(cv);
        cell.addEventListener("click", function () { setTip("shape", shape, true); });
        tips.appendChild(cell);
    });
    s1.appendChild(tips);
    sliderRow(s1, "Size:", sizeToSlider(o.size), 0, 1000, function (v) {
        o.size = sliderToSize(v);
        sizeNum.value = o.size;
        PS.savePrefsDebounced(); drawPreview();
        if (PS.tool === kind) { PS.renderOptionsBar(); }
    }, "px");
    var sizeNum = s1.lastChild.querySelector("input[type=number]");
    sizeNum.min = 1; sizeNum.max = 2500; sizeNum.value = Math.round(o.size);
    sizeNum.addEventListener("change", function () {
        o.size = PS.clamp(Math.round(parseFloat(sizeNum.value) || 1), 1, 2500);
        PS.savePrefsDebounced(); PS.renderBrushPanel();
        if (PS.tool === kind) { PS.renderOptionsBar(); }
    });
    var flips = document.createElement("div");
    flips.className = "bp-row";
    [["flipX", "Flip X"], ["flipY", "Flip Y"]].forEach(function (f) {
        var lab = document.createElement("label");
        lab.className = "brp-check";
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!tip[f[0]];
        cb.addEventListener("change", function () { setTip(f[0], cb.checked); });
        lab.appendChild(cb);
        lab.appendChild(document.createTextNode(f[1]));
        flips.appendChild(lab);
    });
    s1.appendChild(flips);
    sliderRow(s1, "Angle:", Math.round(tip.angle), -180, 180, function (v) { setTip("angle", v); }, "°");
    sliderRow(s1, "Roundness:", Math.round(tip.roundness * 100), 1, 100, function (v) { setTip("roundness", v / 100); }, "%");
    var hard = sliderRow(s1, "Hardness:", Math.round(o.hardness * 100), 0, 100, function (v) {
        o.hardness = v / 100; o.preset = null; PS.savePrefsDebounced(); drawPreview();
        if (PS.tool === kind) { PS.renderOptionsBar(); }
    }, "%");
    if (PS.tipImage(tip.shape)) { hard.classList.add("disabled"); }
    sliderRow(s1, "Spacing:", Math.round(tip.spacing * 100), 1, 1000, function (v) { setTip("spacing", v / 100); }, "%");

    // -- Shape Dynamics
    var s2 = section("shape", "Shape Dynamics", "shapeDyn");
    pct(s2, "Size Jitter:", "sizeJitter");
    control(s2, "sizeControl", "Control:", CTRL);
    if (tip.sizeControl === "fade" || tip.opacityControl === "fade" || tip.flowControl === "fade" || tip.fgbgControl === "fade") {
        sliderRow(s2, "Fade Steps:", tip.fadeSteps, 1, 999, function (v) { setTip("fadeSteps", v); });
    }
    pct(s2, "Min Diameter:", "minDiameter");
    pct(s2, "Angle Jitter:", "angleJitter");
    control(s2, "angleControl", "Control:", [{ v: "off", l: "Off" }, { v: "direction", l: "Direction" },
        { v: "initial", l: "Initial Direction" }, { v: "pressure", l: "Pen Pressure" }]);
    pct(s2, "Round Jitter:", "roundJitter");
    pct(s2, "Min Roundness:", "minRoundness");

    // -- Scattering
    var s3 = section("scatter", "Scattering", "scatterOn");
    pct(s3, "Scatter:", "scatter", 1000);
    var both = document.createElement("label");
    both.className = "brp-check";
    var bcb = document.createElement("input");
    bcb.type = "checkbox";
    bcb.checked = !!tip.scatterBoth;
    bcb.addEventListener("change", function () { setTip("scatterBoth", bcb.checked); });
    both.appendChild(bcb);
    both.appendChild(document.createTextNode("Both Axes"));
    s3.appendChild(both);
    sliderRow(s3, "Count:", tip.count, 1, 16, function (v) { setTip("count", v); });
    pct(s3, "Count Jitter:", "countJitter");

    // -- Transfer
    var s4 = section("transfer", "Transfer", "transferOn");
    pct(s4, "Opacity Jitter:", "opacityJitter");
    control(s4, "opacityControl", "Control:", CTRL);
    pct(s4, "Flow Jitter:", "flowJitter");
    control(s4, "flowControl", "Control:", CTRL);

    // -- Color Dynamics
    var s5 = section("color", "Color Dynamics", "colorOn");
    var per = document.createElement("label");
    per.className = "brp-check";
    var pcb = document.createElement("input");
    pcb.type = "checkbox";
    pcb.checked = tip.colorPerTip !== false;
    pcb.addEventListener("change", function () { setTip("colorPerTip", pcb.checked); });
    per.appendChild(pcb);
    per.appendChild(document.createTextNode("Apply Per Tip"));
    s5.appendChild(per);
    pct(s5, "FG/BG Jitter:", "fgbgJitter");
    control(s5, "fgbgControl", "Control:", CTRL);
    pct(s5, "Hue Jitter:", "hueJitter");
    pct(s5, "Saturation:", "satJitter");
    pct(s5, "Brightness:", "briJitter");

    drawPreview();
};

PS.renderBrushPresetsPanel = function () {
    var body = PS.el("panel-brushpresets-body");
    if (!body) { return; }
    var kind = PS.brushTool();
    var o = migrate(PS.toolOpts[kind]);
    body.innerHTML = "";
    body.classList.add("brush-presets-panel");
    var rows = document.createElement("div");
    rows.className = "bpp-head";
    sliderRow(rows, "Size:", sizeToSlider(o.size), 0, 1000, function (v) {
        o.size = sliderToSize(v); num.value = o.size; PS.savePrefsDebounced();
        if (PS.tool === kind) { PS.renderOptionsBar(); }
    }, "px");
    var num = rows.lastChild.querySelector("input[type=number]");
    num.min = 1; num.max = 2500; num.value = Math.round(o.size);
    num.addEventListener("change", function () {
        o.size = PS.clamp(Math.round(parseFloat(num.value) || 1), 1, 2500);
        PS.savePrefsDebounced(); PS.renderBrushPresetsPanel();
        if (PS.tool === kind) { PS.renderOptionsBar(); }
    });
    body.appendChild(rows);
    var grid = presetGrid(kind, PS.brushPresets(), { list: !!(PS.prefs && PS.prefs.brushListView) });
    grid.classList.add("bpp-grid");
    body.appendChild(grid);
    var foot = document.createElement("div");
    foot.className = "panel-footer bpp-foot";
    [[PS.BRUSH_ICONS.panel, "Toggle the Brush panel", function () { PS.ws.showPanel("brush"); }],
        [PS.BRUSH_ICONS.plus, "Create a new preset from this brush", PS.newBrushPreset],
        [PS.BRUSH_ICONS.trash, "Delete the selected preset", function () {
            var id = PS.toolOpts[kind].preset;
            if (id && PS.brushPresets().some(function (p) { return p.id === id; })) { deletePreset(id); }
        }]].forEach(function (b) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "opt-icon-btn";
        btn.title = b[1];
        btn.innerHTML = b[0];
        btn.addEventListener("click", b[2]);
        foot.appendChild(btn);
    });
    body.appendChild(foot);
};

PS.registerBrushPanels = function () {
    var icon = '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M20 4c-4 1-9 5.5-11 9l2 2c3.5-2 8-7 9-11zM9 13c-2 .3-3.4 1.6-3.8 4.2-.1.8-.8 1.4-1.7 1.6 1.3 1.4 4.6 1.6 6.3-.1 1.2-1.2 1.4-2.7.7-4.2z"/></svg>';
    var picon = '<svg viewBox="0 0 24 24" stroke-width="1.6"><circle cx="7" cy="7" r="3"/><circle cx="17" cy="7" r="3" stroke-dasharray="1.5 1.5"/><circle cx="7" cy="17" r="3" stroke-dasharray="1 2"/><path d="M14 17h6"/></svg>';
    PS.ws.register("brush", { title: "Brush", icon: icon, render: PS.renderBrushPanel, shortcut: "F5" });
    PS.ws.register("brushpresets", { title: "Brush Presets", icon: picon, render: PS.renderBrushPresetsPanel,
        menu: function () { return presetMenuItems(PS.brushTool()); } });
};

// the brush outline under the pointer: the tip's shape for sampled tips,
// an ellipse for round ones
PS.brushCursorOverlay = function (kind) {
    var cache = { key: null, path: null };
    return function (ctx) {
        if (!PS.cursorPos || PS._pointer.panning) { return; }
        var o = PS.toolOpts[kind];
        var tip = PS.brushTip(kind);
        var p = PS.docToOverlay(PS.cursorPos.x, PS.cursorPos.y);
        var d = o.size * PS.zoom;
        ctx.save();
        ctx.translate(p.x, p.y);
        if (d < 5) {
            // too small to outline: a crosshair
            ctx.strokeStyle = "rgba(0,0,0,0.7)";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.moveTo(0, -6); ctx.lineTo(0, 6);
            ctx.stroke();
            ctx.strokeStyle = "rgba(255,255,255,0.95)";
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();
            return;
        }
        var img = PS.tipImage(tip.shape);
        ctx.rotate(-tip.angle * Math.PI / 180);
        ctx.scale(tip.flipX ? -1 : 1, tip.flipY ? -1 : 1);
        if (img) {
            // outline of the sampled tip, traced once per tip and size
            var key = tip.shape + ":" + Math.round(d) + ":" + tip.roundness;
            if (cache.key !== key) {
                cache.key = key;
                cache.img = outlineImage(img, Math.round(d), tip.roundness);
            }
            if (cache.img) { ctx.drawImage(cache.img, -cache.img.width / 2, -cache.img.height / 2); }
        } else {
            ctx.beginPath();
            ctx.ellipse(0, 0, d / 2, Math.max(0.5, d / 2 * tip.roundness), 0, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(0,0,0,0.6)";
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.strokeStyle = "rgba(255,255,255,0.9)";
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        ctx.restore();
    };
};

// a light outline (with a dark halo) of a tip's shape at diameter d
function outlineImage(img, d, roundness) {
    d = Math.min(d, 1200);
    var s = scaledTip(img, Math.max(4, d));
    var w = s.width, h = Math.max(1, Math.round(s.height * roundness));
    var src = PS.createCanvas(w + 4, h + 4);
    var sctx = src.getContext("2d");
    sctx.drawImage(s, 2, 2, w, h);
    var data = sctx.getImageData(0, 0, w + 4, h + 4).data;
    var out = PS.createCanvas(w + 4, h + 4);
    var octx = out.getContext("2d");
    var img2 = octx.createImageData(w + 4, h + 4), od = img2.data;
    var W = w + 4, H = h + 4;
    function on(x, y) { return x >= 0 && y >= 0 && x < W && y < H && data[(y * W + x) * 4 + 3] > 60; }
    for (var y = 0; y < H; y++) {
        for (var x = 0; x < W; x++) {
            var me = on(x, y);
            var edge = me && (!on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1));
            var near = !me && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1));
            var i = (y * W + x) * 4;
            if (edge) { od[i] = od[i + 1] = od[i + 2] = 255; od[i + 3] = 230; }
            else if (near) { od[i] = od[i + 1] = od[i + 2] = 0; od[i + 3] = 150; }
        }
    }
    octx.putImageData(img2, 0, 0);
    return out;
}

/* ============================================================
   PAINT TOOLS
   ============================================================ */

(function () {
    function registerPaintTool(id, name, key, icon, hint) {
        PS.registerTool(id, {
            name: name,
            key: key,
            hint: hint,
            cursor: "crosshair",
            icon: icon,
            options: function (host) { brushToolOptions(id, host); },
            onDown: function (pt, e) { PS.beginStroke(id, pt, e); },
            onMove: function (pt, e) { PS.continueStroke(pt, e); },
            onUp: function () { PS.endStroke(); },
            overlay: PS.brushCursorOverlay(id)
        });
    }

    registerPaintTool("brush", "Brush", "b",
        '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M20 4c-4 1-9 5.5-11 9l2 2c3.5-2 8-7 9-11zM9 13c-2 .3-3.4 1.6-3.8 4.2-.1.8-.8 1.4-1.7 1.6 1.3 1.4 4.6 1.6 6.3-.1 1.2-1.2 1.4-2.7.7-4.2z"/></svg>',
        "[ and ] change the size, Shift+[ and ] the hardness, Alt-click samples a color, Shift-click draws a line");
    registerPaintTool("pencil", "Pencil", "b",
        '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3M4 20l4-1"/></svg>',
        "Hard-edged strokes. [ and ] change the size, Alt-click samples a color, Shift-click draws a line");
    registerPaintTool("eraser", "Eraser", "e",
        '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M9 19 4 14a2 2 0 0 1 0-2.8l7.2-7.2a2 2 0 0 1 2.8 0L20 10a2 2 0 0 1 0 2.8L13.8 19zM9 19h11M7 9l7 7"/></svg>',
        "[ and ] change the size, Shift-click erases a line");
})();
