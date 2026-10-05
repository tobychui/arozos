/*
    Pixel Studio - filters (the Filter menu)

    Filters run client-side on the active layer (or the mask being edited,
    or the Quick Mask), honour the selection, and preview live on the canvas
    while their settings window is open (PS.layerOverride). They are grouped
    in submenus by family; Ctrl+F repeats the last filter with the same
    settings and Ctrl+Alt+F reopens it.

    A filter is {id, label, cat, params: [...], render(srcCanvas, values)}:
    params are {key, label, min, max, value, step, unit} sliders, or
    {key, label, type: "select", options: [{v, l}], value} and
    {key, label, type: "check", value}. render returns a new canvas.
*/
"use strict";

/* ---------- application core ---------- */

// renderFn(srcCanvas) -> new canvas of the same size; written into the
// selected part of the paint target as one undo step
PS.applyFilterToLayer = function (label, renderFn) {
    var layer = PS.requirePaintableLayer();
    if (!layer) { return; }
    var before = PS.snapshotLayer(layer);
    var result = PS.filterResultWithSelection(layer.canvas, renderFn(layer.canvas));
    var ctx = layer.canvas.getContext("2d");
    ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    ctx.drawImage(result, 0, 0);
    PS.commitLayerCanvas(label, layer, before);
    PS.requestRender();
    PS.updateLayerThumbsThrottled();
};

// the filtered pixels inside the selection (soft edges blend), the original
// ones outside
PS.filterResultWithSelection = function (src, result) {
    var sel = PS.doc.selection;
    if (!sel) { return result; }
    var out = PS.cloneCanvas(src);
    var octx = out.getContext("2d");
    octx.globalCompositeOperation = "destination-out";
    octx.drawImage(sel.mask, 0, 0);
    var masked = PS.cloneCanvas(result);
    var mctx = masked.getContext("2d");
    mctx.globalCompositeOperation = "destination-in";
    mctx.drawImage(sel.mask, 0, 0);
    octx.globalCompositeOperation = "source-over";
    octx.drawImage(masked, 0, 0);
    return out;
};

// css filter shorthand
PS.cssFilterCanvas = function (src, filterString) {
    var out = PS.createCanvas(src.width, src.height);
    var ctx = out.getContext("2d");
    ctx.filter = filterString;
    ctx.drawImage(src, 0, 0);
    ctx.filter = "none";
    return out;
};

/* ---------- pixel helpers ---------- */

function fxPixels(c) { return c.getContext("2d").getImageData(0, 0, c.width, c.height); }

function fxCanvas(img) {
    var c = PS.createCanvas(img.width, img.height);
    c.getContext("2d").putImageData(img, 0, 0);
    return c;
}

// premultiplied float copy (resampling filters average colour by coverage)
function fxPremul(img) {
    var d = img.data, n = d.length;
    var f = new Float32Array(n);
    for (var i = 0; i < n; i += 4) {
        var a = d[i + 3] / 255;
        f[i] = d[i] * a; f[i + 1] = d[i + 1] * a; f[i + 2] = d[i + 2] * a; f[i + 3] = d[i + 3];
    }
    return f;
}

function fxUnpremul(f, w, h) {
    var img = new ImageData(w, h);
    var d = img.data;
    for (var i = 0; i < f.length; i += 4) {
        var a = f[i + 3];
        if (a <= 0.01) { continue; }
        var k = 255 / a;
        d[i] = f[i] * k; d[i + 1] = f[i + 1] * k; d[i + 2] = f[i + 2] * k; d[i + 3] = a;
    }
    return img;
}

// one horizontal + one vertical running-sum box pass, edges extended
function fxBoxPass(src, dst, w, h, r, horizontal) {
    if (r < 1) { dst.set(src); return; }
    var n = horizontal ? w : h, lines = horizontal ? h : w;
    var step = horizontal ? 4 : w * 4;
    var inv = 1 / (2 * r + 1);
    for (var line = 0; line < lines; line++) {
        var base = horizontal ? line * w * 4 : line * 4;
        for (var c = 0; c < 4; c++) {
            var o = base + c;
            var sum = src[o] * (r + 1);
            for (var k = 1; k <= r; k++) { sum += src[o + Math.min(k, n - 1) * step]; }
            for (var i = 0; i < n; i++) {
                dst[o + i * step] = sum * inv;
                var add = Math.min(i + r + 1, n - 1), rem = Math.max(i - r, 0);
                sum += src[o + add * step] - src[o + rem * step];
            }
        }
    }
}

function fxBoxBlur(f, w, h, rx, ry) {
    var tmp = new Float32Array(f.length);
    fxBoxPass(f, tmp, w, h, rx, true);
    fxBoxPass(tmp, f, w, h, ry, false);
    return f;
}

// Gaussian blur of sigma ~ radius from three box passes
function fxGauss(f, w, h, radius) {
    if (radius <= 0) { return f; }
    var n = 3;
    var wIdeal = Math.sqrt(12 * radius * radius / n + 1);
    var wl = Math.floor(wIdeal);
    if (wl % 2 === 0) { wl--; }
    var wu = wl + 2;
    var m = Math.round((12 * radius * radius - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
    for (var i = 0; i < n; i++) {
        var size = i < m ? wl : wu;
        var r = Math.max(0, (size - 1) / 2);
        fxBoxBlur(f, w, h, r, r);
    }
    return f;
}

PS.gaussianBlurCanvas = function (src, radius) {
    var img = fxPixels(src);
    var f = fxGauss(fxPremul(img), img.width, img.height, radius);
    return fxCanvas(fxUnpremul(f, img.width, img.height));
};

// bilinear sample of a premultiplied buffer (edges clamped)
function fxSample(f, w, h, x, y, out) {
    x = Math.min(Math.max(x, 0), w - 1.001);
    y = Math.min(Math.max(y, 0), h - 1.001);
    var x0 = Math.floor(x), y0 = Math.floor(y);
    var tx = x - x0, ty = y - y0;
    var i00 = (y0 * w + x0) * 4, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4;
    for (var c = 0; c < 4; c++) {
        var a = f[i00 + c] + (f[i10 + c] - f[i00 + c]) * tx;
        var b = f[i01 + c] + (f[i11 + c] - f[i01 + c]) * tx;
        out[c] = a + (b - a) * ty;
    }
}

// inverse-mapped distortion: map(x, y) -> source point
function fxDistort(src, map) {
    var img = fxPixels(src);
    var w = img.width, h = img.height;
    var f = fxPremul(img);
    var o = new Float32Array(f.length);
    var px = [0, 0, 0, 0], p = { x: 0, y: 0 };
    for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
            var i = (y * w + x) * 4;
            if (!map(x + 0.5, y + 0.5, p)) {
                o[i] = f[i]; o[i + 1] = f[i + 1]; o[i + 2] = f[i + 2]; o[i + 3] = f[i + 3];
                continue;
            }
            fxSample(f, w, h, p.x - 0.5, p.y - 0.5, px);
            o[i] = px[0]; o[i + 1] = px[1]; o[i + 2] = px[2]; o[i + 3] = px[3];
        }
    }
    return fxCanvas(fxUnpremul(o, w, h));
}

// area the distortion filters work in: the selection, else the canvas
function fxArea() {
    var d = PS.doc;
    var b = d.selection ? d.selection.bounds : { x: 0, y: 0, w: d.width, h: d.height };
    return { cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: b.w / 2, ry: b.h / 2 };
}

// 3x3 convolution (preserves alpha)
PS.convolveCanvas = function (src, kernel, divisor, offset) {
    var w = src.width, h = src.height;
    var input = src.getContext("2d").getImageData(0, 0, w, h);
    var output = src.getContext("2d").createImageData(w, h);
    var ip = input.data, op = output.data;
    divisor = divisor || 1;
    offset = offset || 0;

    for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
            var r = 0, g = 0, b = 0;
            for (var ky = -1; ky <= 1; ky++) {
                for (var kx = -1; kx <= 1; kx++) {
                    var sx = PS.clamp(x + kx, 0, w - 1);
                    var sy = PS.clamp(y + ky, 0, h - 1);
                    var si = (sy * w + sx) * 4;
                    var kv = kernel[(ky + 1) * 3 + (kx + 1)];
                    r += ip[si] * kv;
                    g += ip[si + 1] * kv;
                    b += ip[si + 2] * kv;
                }
            }
            var oi = (y * w + x) * 4;
            op[oi] = PS.clamp(r / divisor + offset, 0, 255);
            op[oi + 1] = PS.clamp(g / divisor + offset, 0, 255);
            op[oi + 2] = PS.clamp(b / divisor + offset, 0, 255);
            op[oi + 3] = ip[oi + 3];
        }
    }
    var out = PS.createCanvas(w, h);
    out.getContext("2d").putImageData(output, 0, 0);
    return out;
};

// per-channel min / max over a square (separable), colour channels only
function fxMinMax(src, r, isMax) {
    var img = fxPixels(src);
    var w = img.width, h = img.height, d = img.data;
    var tmp = new Uint8ClampedArray(d.length);
    var x, y, c, k, v, best;
    for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
            for (c = 0; c < 4; c++) {
                best = isMax ? 0 : 255;
                for (k = -r; k <= r; k++) {
                    v = d[(y * w + Math.min(w - 1, Math.max(0, x + k))) * 4 + c];
                    if (isMax ? v > best : v < best) { best = v; }
                }
                tmp[(y * w + x) * 4 + c] = best;
            }
        }
    }
    var out = new ImageData(w, h);
    var o = out.data;
    for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
            for (c = 0; c < 4; c++) {
                best = isMax ? 0 : 255;
                for (k = -r; k <= r; k++) {
                    v = tmp[(Math.min(h - 1, Math.max(0, y + k)) * w + x) * 4 + c];
                    if (isMax ? v > best : v < best) { best = v; }
                }
                o[(y * w + x) * 4 + c] = best;
            }
        }
    }
    return fxCanvas(out);
}

// median over a square per colour channel (sliding histograms)
function fxMedian(src, r) {
    var img = fxPixels(src);
    var w = img.width, h = img.height, d = img.data;
    var out = new ImageData(w, h);
    var o = out.data;
    var area = (2 * r + 1) * (2 * r + 1), half = area >> 1;
    var hist = [new Int32Array(256), new Int32Array(256), new Int32Array(256)];
    for (var y = 0; y < h; y++) {
        var c, k, j, xx, yy;
        for (c = 0; c < 3; c++) { hist[c].fill(0); }
        for (j = -r; j <= r; j++) {
            yy = Math.min(h - 1, Math.max(0, y + j));
            for (k = -r; k <= r; k++) {
                xx = Math.min(w - 1, Math.max(0, k));
                for (c = 0; c < 3; c++) { hist[c][d[(yy * w + xx) * 4 + c]]++; }
            }
        }
        for (var x = 0; x < w; x++) {
            var oi = (y * w + x) * 4;
            for (c = 0; c < 3; c++) {
                var acc = 0, m = 0;
                var hc = hist[c];
                while (m < 255 && acc + hc[m] <= half) { acc += hc[m]; m++; }
                o[oi + c] = m;
            }
            o[oi + 3] = d[oi + 3];
            if (x + 1 >= w) { break; }
            var xOut = Math.max(0, x - r), xIn = Math.min(w - 1, x + r + 1);
            for (j = -r; j <= r; j++) {
                yy = Math.min(h - 1, Math.max(0, y + j));
                var io = (yy * w + xOut) * 4, ii = (yy * w + xIn) * 4;
                for (c = 0; c < 3; c++) { hist[c][d[io + c]]--; hist[c][d[ii + c]]++; }
            }
        }
    }
    return fxCanvas(out);
}

// smooth value noise (fractal) for Clouds
function fxCloudNoise(w, h, seed) {
    var rnd = seed;
    function rand() { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; }
    var out = new Float32Array(w * h);
    var amp = 1, total = 0;
    var size = Math.max(w, h) / 2;
    while (size >= 2) {
        var gw = Math.ceil(w / size) + 2, gh = Math.ceil(h / size) + 2;
        var grid = new Float32Array(gw * gh);
        for (var i = 0; i < grid.length; i++) { grid[i] = rand(); }
        for (var y = 0; y < h; y++) {
            var gy = y / size, y0 = Math.floor(gy), ty = gy - y0;
            ty = ty * ty * (3 - 2 * ty);
            for (var x = 0; x < w; x++) {
                var gx = x / size, x0 = Math.floor(gx), tx = gx - x0;
                tx = tx * tx * (3 - 2 * tx);
                var a = grid[y0 * gw + x0], b = grid[y0 * gw + x0 + 1];
                var c = grid[(y0 + 1) * gw + x0], dd = grid[(y0 + 1) * gw + x0 + 1];
                out[y * w + x] += amp * (a + (b - a) * tx + ((c + (dd - c) * tx) - (a + (b - a) * tx)) * ty);
            }
        }
        total += amp;
        amp *= 0.5;
        size /= 2;
    }
    for (var k = 0; k < out.length; k++) { out[k] /= total; }
    return out;
}

/* ---------- the catalog ---------- */

PS.FILTER_CATEGORIES = ["Blur", "Distort", "Noise", "Pixelate", "Render", "Sharpen", "Stylize", "Other"];

PS.filters = [
    /* Blur */
    {
        id: "average", label: "Average", cat: "Blur",
        render: function (src) {
            var img = fxPixels(src), d = img.data;
            var sel = PS.doc.selection ? fxPixels(PS.doc.selection.mask).data : null;
            var r = 0, g = 0, b = 0, a = 0;
            for (var i = 0; i < d.length; i += 4) {
                var wgt = (sel ? sel[i + 3] / 255 : 1) * d[i + 3] / 255;
                r += d[i] * wgt; g += d[i + 1] * wgt; b += d[i + 2] * wgt; a += wgt;
            }
            var out = PS.createCanvas(src.width, src.height);
            if (a <= 0) { return out; }
            var ctx = out.getContext("2d");
            ctx.fillStyle = "rgb(" + Math.round(r / a) + "," + Math.round(g / a) + "," + Math.round(b / a) + ")";
            ctx.fillRect(0, 0, out.width, out.height);
            ctx.globalCompositeOperation = "destination-in";
            ctx.drawImage(src, 0, 0);
            return out;
        }
    },
    { id: "blur", label: "Blur", cat: "Blur", render: function (src) { return PS.gaussianBlurCanvas(src, 1); } },
    { id: "blur-more", label: "Blur More", cat: "Blur", render: function (src) { return PS.gaussianBlurCanvas(src, 2.5); } },
    {
        id: "box-blur", label: "Box Blur...", cat: "Blur",
        params: [{ key: "r", label: "Radius", min: 1, max: 200, value: 10, unit: "px" }],
        render: function (src, p) {
            var img = fxPixels(src);
            var f = fxBoxBlur(fxPremul(img), img.width, img.height, p.r, p.r);
            return fxCanvas(fxUnpremul(f, img.width, img.height));
        }
    },
    {
        id: "gaussian-blur", label: "Gaussian Blur...", cat: "Blur",
        params: [{ key: "r", label: "Radius", min: 0.1, max: 250, value: 5, step: 0.1, unit: "px" }],
        render: function (src, p) { return PS.gaussianBlurCanvas(src, p.r); }
    },
    {
        id: "motion-blur", label: "Motion Blur...", cat: "Blur",
        params: [
            { key: "angle", label: "Angle", min: -90, max: 90, value: 0, unit: "°" },
            { key: "dist", label: "Distance", min: 1, max: 999, value: 20, unit: "px" }
        ],
        render: function (src, p) {
            // rotate the direction onto x, box blur along rows, rotate back
            var w = src.width, h = src.height;
            var a = -p.angle * Math.PI / 180;
            var diag = Math.ceil(Math.hypot(w, h)) + 2;
            var big = PS.createCanvas(diag, diag);
            var bctx = big.getContext("2d");
            bctx.translate(diag / 2, diag / 2);
            bctx.rotate(-a);
            bctx.drawImage(src, -w / 2, -h / 2);
            var img = bctx.getImageData(0, 0, diag, diag);
            var f = fxPremul(img);
            var tmp = new Float32Array(f.length);
            fxBoxPass(f, tmp, diag, diag, Math.max(1, Math.round(p.dist / 2)), true);
            var blurred = fxCanvas(fxUnpremul(tmp, diag, diag));
            var out = PS.createCanvas(w, h);
            var octx = out.getContext("2d");
            octx.translate(w / 2, h / 2);
            octx.rotate(a);
            octx.drawImage(blurred, -diag / 2, -diag / 2);
            return out;
        }
    },
    /* Distort */
    {
        id: "pinch", label: "Pinch...", cat: "Distort",
        params: [{ key: "amount", label: "Amount", min: -100, max: 100, value: 50, unit: "%" }],
        render: function (src, p) {
            var A = fxArea(), k = p.amount / 100;
            return fxDistort(src, function (x, y, o) {
                var dx = (x - A.cx) / A.rx, dy = (y - A.cy) / A.ry;
                var r = Math.hypot(dx, dy);
                if (r >= 1 || r === 0) { return false; }
                var s = Math.pow(Math.sin(Math.PI * r / 2), -k);
                o.x = A.cx + dx * s * A.rx; o.y = A.cy + dy * s * A.ry;
                return true;
            });
        }
    },
    {
        id: "polar", label: "Polar Coordinates...", cat: "Distort",
        params: [{ key: "mode", label: "Mode", type: "select", value: "toPolar",
            options: [{ v: "toPolar", l: "Rectangular to Polar" }, { v: "toRect", l: "Polar to Rectangular" }] }],
        render: function (src, p) {
            var w = src.width, h = src.height, cx = w / 2, cy = h / 2;
            return fxDistort(src, function (x, y, o) {
                if (p.mode === "toPolar") {
                    var dx = (x - cx) / cx, dy = (y - cy) / cy;
                    var ang = Math.atan2(dx, -dy);
                    if (ang < 0) { ang += Math.PI * 2; }
                    o.x = ang / (Math.PI * 2) * w;
                    o.y = Math.hypot(dx, dy) * h;
                } else {
                    var t = x / w * Math.PI * 2, rr = y / h;
                    o.x = cx + Math.sin(t) * rr * cx;
                    o.y = cy - Math.cos(t) * rr * cy;
                }
                return true;
            });
        }
    },
    {
        id: "ripple", label: "Ripple...", cat: "Distort",
        params: [
            { key: "amount", label: "Amount", min: -999, max: 999, value: 100, unit: "%" },
            { key: "size", label: "Size", type: "select", value: "medium", options: [{ v: "small", l: "Small" }, { v: "medium", l: "Medium" }, { v: "large", l: "Large" }] }
        ],
        render: function (src, p) {
            var wl = { small: 8, medium: 18, large: 40 }[p.size];
            var amp = p.amount / 100 * wl / 3;
            return fxDistort(src, function (x, y, o) {
                o.x = x + Math.sin(y / wl * Math.PI * 2) * amp;
                o.y = y + Math.sin(x / wl * Math.PI * 2) * amp;
                return true;
            });
        }
    },
    {
        id: "spherize", label: "Spherize...", cat: "Distort",
        params: [{ key: "amount", label: "Amount", min: -100, max: 100, value: 100, unit: "%" }],
        render: function (src, p) {
            var A = fxArea(), k = p.amount / 100;
            return fxDistort(src, function (x, y, o) {
                var dx = (x - A.cx) / A.rx, dy = (y - A.cy) / A.ry;
                var r = Math.hypot(dx, dy);
                if (r >= 1 || r === 0) { return false; }
                // a sphere's refraction: r' = asin(r) / (pi / 2), mixed by amount
                var sph = k >= 0 ? Math.asin(r) / (Math.PI / 2) : Math.sin(r * Math.PI / 2);
                var nr = r + (sph - r) * Math.abs(k);
                o.x = A.cx + dx / r * nr * A.rx; o.y = A.cy + dy / r * nr * A.ry;
                return true;
            });
        }
    },
    {
        id: "twirl", label: "Twirl...", cat: "Distort",
        params: [{ key: "angle", label: "Angle", min: -999, max: 999, value: 50, unit: "°" }],
        render: function (src, p) {
            var A = fxArea(), rad = p.angle * Math.PI / 180;
            return fxDistort(src, function (x, y, o) {
                var dx = (x - A.cx) / A.rx, dy = (y - A.cy) / A.ry;
                var r = Math.hypot(dx, dy);
                if (r >= 1) { return false; }
                var a = Math.atan2(dy, dx) + rad * (1 - r);
                o.x = A.cx + Math.cos(a) * r * A.rx; o.y = A.cy + Math.sin(a) * r * A.ry;
                return true;
            });
        }
    },
    {
        id: "wave", label: "Wave...", cat: "Distort",
        params: [
            { key: "wl", label: "Wavelength", min: 2, max: 999, value: 60, unit: "px" },
            { key: "amp", label: "Amplitude", min: 1, max: 999, value: 10, unit: "px" },
            { key: "type", label: "Type", type: "select", value: "sine", options: [{ v: "sine", l: "Sine" }, { v: "triangle", l: "Triangle" }, { v: "square", l: "Square" }] }
        ],
        render: function (src, p) {
            function wave(t) {
                var f = t - Math.floor(t);
                if (p.type === "triangle") { return f < 0.5 ? f * 4 - 1 : 3 - f * 4; }
                if (p.type === "square") { return f < 0.5 ? 1 : -1; }
                return Math.sin(f * Math.PI * 2);
            }
            return fxDistort(src, function (x, y, o) {
                o.x = x + wave(y / p.wl) * p.amp;
                o.y = y + wave(x / p.wl + 0.25) * p.amp;
                return true;
            });
        }
    },
    /* Noise */
    {
        id: "add-noise", label: "Add Noise...", cat: "Noise",
        params: [
            { key: "amount", label: "Amount", min: 0.1, max: 400, value: 12.5, step: 0.1, unit: "%" },
            { key: "dist", label: "Distribution", type: "select", value: "uniform", options: [{ v: "uniform", l: "Uniform" }, { v: "gaussian", l: "Gaussian" }] },
            { key: "mono", label: "Monochromatic", type: "check", value: false }
        ],
        render: function (src, p) {
            var img = fxPixels(src), d = img.data;
            var amt = p.amount / 100 * 255;
            var seed = 1234567;
            function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
            function noise() {
                if (p.dist === "gaussian") {
                    var u = Math.max(1e-6, rand()), v = rand();
                    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * amt / 2.5;
                }
                return (rand() * 2 - 1) * amt;
            }
            for (var i = 0; i < d.length; i += 4) {
                if (p.mono) {
                    var n = noise();
                    d[i] += n; d[i + 1] += n; d[i + 2] += n;
                } else {
                    d[i] += noise(); d[i + 1] += noise(); d[i + 2] += noise();
                }
            }
            return fxCanvas(img);
        }
    },
    { id: "despeckle", label: "Despeckle", cat: "Noise", render: function (src) { return fxMedian(src, 1); } },
    {
        id: "median", label: "Median...", cat: "Noise",
        params: [{ key: "r", label: "Radius", min: 1, max: 50, value: 2, unit: "px" }],
        render: function (src, p) { return fxMedian(src, p.r); }
    },
    /* Pixelate */
    {
        id: "mosaic", label: "Mosaic...", cat: "Pixelate",
        params: [{ key: "cell", label: "Cell Size", min: 2, max: 200, value: 8, unit: "square" }],
        render: function (src, p) {
            var w = src.width, h = src.height, v = p.cell;
            var small = PS.createCanvas(Math.max(1, Math.ceil(w / v)), Math.max(1, Math.ceil(h / v)));
            var sctx = small.getContext("2d");
            sctx.imageSmoothingQuality = "high";
            sctx.drawImage(src, 0, 0, small.width * v, small.height * v, 0, 0, small.width, small.height);
            var out = PS.createCanvas(w, h);
            var octx = out.getContext("2d");
            octx.imageSmoothingEnabled = false;
            octx.drawImage(small, 0, 0, small.width * v, small.height * v);
            return out;
        }
    },
    /* Render */
    {
        id: "clouds", label: "Clouds", cat: "Render",
        render: function (src) {
            var w = src.width, h = src.height;
            var n = fxCloudNoise(w, h, (Date.now() & 0xffff) + 1);
            var a = PS.hexToRgb(PS.fg) || { r: 0, g: 0, b: 0 }, b = PS.hexToRgb(PS.bg) || { r: 255, g: 255, b: 255 };
            var img = new ImageData(w, h), d = img.data;
            for (var i = 0, k = 0; k < n.length; k++, i += 4) {
                var t = PS.clamp((n[k] - 0.5) * 1.6 + 0.5, 0, 1);
                d[i] = a.r + (b.r - a.r) * t; d[i + 1] = a.g + (b.g - a.g) * t; d[i + 2] = a.b + (b.b - a.b) * t; d[i + 3] = 255;
            }
            return fxCanvas(img);
        }
    },
    /* Sharpen */
    { id: "sharpen", label: "Sharpen", cat: "Sharpen", render: function (src) { return PS.convolveCanvas(src, [0, -0.5, 0, -0.5, 3, -0.5, 0, -0.5, 0]); } },
    { id: "sharpen-more", label: "Sharpen More", cat: "Sharpen", render: function (src) { return PS.convolveCanvas(src, [0, -1, 0, -1, 5, -1, 0, -1, 0]); } },
    {
        id: "unsharp-mask", label: "Unsharp Mask...", cat: "Sharpen",
        params: [
            { key: "amount", label: "Amount", min: 1, max: 500, value: 50, unit: "%" },
            { key: "r", label: "Radius", min: 0.1, max: 250, value: 1, step: 0.1, unit: "px" },
            { key: "thr", label: "Threshold", min: 0, max: 255, value: 0, unit: "levels" }
        ],
        render: function (src, p) {
            var img = fxPixels(src), d = img.data;
            var w = img.width, h = img.height;
            var bl = fxUnpremul(fxGauss(fxPremul(img), w, h, p.r), w, h).data;
            var k = p.amount / 100;
            for (var i = 0; i < d.length; i += 4) {
                var lum = (d[i] - bl[i]) * 0.3 + (d[i + 1] - bl[i + 1]) * 0.59 + (d[i + 2] - bl[i + 2]) * 0.11;
                if (Math.abs(lum) * 2 < p.thr) { continue; }
                for (var c = 0; c < 3; c++) { d[i + c] = d[i + c] + (d[i + c] - bl[i + c]) * k; }
            }
            return fxCanvas(img);
        }
    },
    /* Stylize */
    {
        id: "emboss", label: "Emboss...", cat: "Stylize",
        params: [
            { key: "angle", label: "Angle", min: -180, max: 180, value: 135, unit: "°" },
            { key: "height", label: "Height", min: 1, max: 100, value: 3, unit: "px" },
            { key: "amount", label: "Amount", min: 1, max: 500, value: 100, unit: "%" }
        ],
        render: function (src, p) {
            var img = fxPixels(src), d = img.data;
            var w = img.width, h = img.height;
            var a = p.angle * Math.PI / 180;
            var ox = Math.cos(a) * p.height / 2, oy = -Math.sin(a) * p.height / 2;
            var f = fxPremul(img);
            var s1 = [0, 0, 0, 0], s2 = [0, 0, 0, 0];
            var out = new ImageData(w, h), o = out.data;
            var k = p.amount / 100;
            for (var y = 0; y < h; y++) {
                for (var x = 0; x < w; x++) {
                    fxSample(f, w, h, x + ox, y + oy, s1);
                    fxSample(f, w, h, x - ox, y - oy, s2);
                    var l1 = (s1[0] * 0.3 + s1[1] * 0.59 + s1[2] * 0.11), l2 = (s2[0] * 0.3 + s2[1] * 0.59 + s2[2] * 0.11);
                    var v = PS.clamp(128 + (l1 - l2) * k, 0, 255);
                    var i = (y * w + x) * 4;
                    o[i] = v; o[i + 1] = v; o[i + 2] = v; o[i + 3] = d[i + 3];
                }
            }
            return fxCanvas(out);
        }
    },
    {
        id: "find-edges", label: "Find Edges", cat: "Stylize",
        render: function (src) {
            var img = fxPixels(src), d = img.data;
            var w = img.width, h = img.height;
            var out = new ImageData(w, h), o = out.data;
            for (var y = 0; y < h; y++) {
                var rm = Math.max(0, y - 1) * w * 4, r0 = y * w * 4, rp = Math.min(h - 1, y + 1) * w * 4;
                for (var x = 0; x < w; x++) {
                    var i = r0 + x * 4;
                    var cm = Math.max(0, x - 1) * 4, c0 = x * 4, cp = Math.min(w - 1, x + 1) * 4;
                    for (var c = 0; c < 3; c++) {
                        var gx = -d[rm + cm + c] - 2 * d[r0 + cm + c] - d[rp + cm + c] + d[rm + cp + c] + 2 * d[r0 + cp + c] + d[rp + cp + c];
                        var gy = -d[rm + cm + c] - 2 * d[rm + c0 + c] - d[rm + cp + c] + d[rp + cm + c] + 2 * d[rp + c0 + c] + d[rp + cp + c];
                        o[i + c] = 255 - Math.min(255, Math.sqrt(gx * gx + gy * gy) / 2);
                    }
                    o[i + 3] = d[i + 3];
                }
            }
            return fxCanvas(out);
        }
    },
    {
        id: "solarize", label: "Solarize", cat: "Stylize",
        render: function (src) {
            var img = fxPixels(src), d = img.data;
            for (var i = 0; i < d.length; i += 4) {
                for (var c = 0; c < 3; c++) { if (d[i + c] > 127) { d[i + c] = 255 - d[i + c]; } }
            }
            return fxCanvas(img);
        }
    },
    /* Other */
    {
        id: "high-pass", label: "High Pass...", cat: "Other",
        params: [{ key: "r", label: "Radius", min: 0.1, max: 250, value: 10, step: 0.1, unit: "px" }],
        render: function (src, p) {
            var img = fxPixels(src), d = img.data;
            var w = img.width, h = img.height;
            var bl = fxUnpremul(fxGauss(fxPremul(img), w, h, p.r), w, h).data;
            for (var i = 0; i < d.length; i += 4) {
                for (var c = 0; c < 3; c++) { d[i + c] = 128 + d[i + c] - bl[i + c]; }
            }
            return fxCanvas(img);
        }
    },
    {
        id: "maximum", label: "Maximum...", cat: "Other",
        params: [{ key: "r", label: "Radius", min: 1, max: 50, value: 1, unit: "px" }],
        render: function (src, p) { return fxMinMax(src, p.r, true); }
    },
    {
        id: "minimum", label: "Minimum...", cat: "Other",
        params: [{ key: "r", label: "Radius", min: 1, max: 50, value: 1, unit: "px" }],
        render: function (src, p) { return fxMinMax(src, p.r, false); }
    },
    {
        id: "offset", label: "Offset...", cat: "Other",
        params: [
            { key: "h", label: "Horizontal", min: -30000, max: 30000, value: 0, unit: "px right" },
            { key: "v", label: "Vertical", min: -30000, max: 30000, value: 0, unit: "px down" },
            { key: "mode", label: "Undefined Areas", type: "select", value: "wrap", options: [{ v: "transparent", l: "Set to Transparent" }, { v: "repeat", l: "Repeat Edge Pixels" }, { v: "wrap", l: "Wrap Around" }] }
        ],
        render: function (src, p) {
            var w = src.width, h = src.height;
            var out = PS.createCanvas(w, h);
            var ctx = out.getContext("2d");
            var dx = Math.round(p.h), dy = Math.round(p.v);
            if (p.mode === "wrap") {
                var mx = ((dx % w) + w) % w, my = ((dy % h) + h) % h;
                for (var ix = -1; ix <= 0; ix++) {
                    for (var iy = -1; iy <= 0; iy++) { ctx.drawImage(src, mx + ix * w, my + iy * h); }
                }
            } else if (p.mode === "repeat") {
                return fxDistort(src, function (x, y, o) { o.x = x - dx; o.y = y - dy; return true; });
            } else {
                ctx.drawImage(src, dx, dy);
            }
            return out;
        }
    }
];

/* ---------- menu glue ---------- */

PS.filterById = function (id) {
    for (var i = 0; i < PS.filters.length; i++) { if (PS.filters[i].id === id) { return PS.filters[i]; } }
    return null;
};

PS.filterMenuItems = function () {
    return PS.FILTER_CATEGORIES.map(function (cat) {
        return {
            label: cat, submenu: function () {
                return PS.filters.filter(function (f) { return f.cat === cat; }).map(function (f) {
                    return { label: f.label, action: function () { PS.runFilter(f); } };
                });
            }
        };
    });
};

function filterDefaults(f) {
    var v = {};
    (f.params || []).forEach(function (p) { v[p.key] = p.value; });
    // the values used last time are offered again
    var last = PS.prefs && PS.prefs.filterValues && PS.prefs.filterValues[f.id];
    if (last) { Object.keys(last).forEach(function (k) { if (k in v) { v[k] = last[k]; } }); }
    return v;
}

PS.applyFilterWith = function (f, values) {
    PS._lastFilter = { id: f.id, values: PS.deepCopy(values) };
    if (f.params && f.params.length) {
        PS.prefs.filterValues = PS.prefs.filterValues || {};
        PS.prefs.filterValues[f.id] = PS.deepCopy(values);
        PS.savePrefsDebounced();
    }
    PS.showBusy && PS.showBusy(f.label.replace("...", ""));
    setTimeout(function () {
        try {
            PS.applyFilterToLayer(f.label.replace("...", ""), function (src) { return f.render(src, values); });
        } finally {
            if (PS.hideBusy) { PS.hideBusy(); }
        }
    }, 20);
};

// Ctrl+F
PS.repeatLastFilter = function (reopen) {
    var lf = PS._lastFilter;
    var f = lf && PS.filterById(lf.id);
    if (!f) { return; }
    if (reopen) { PS.runFilter(f); return; }
    if (!PS.requirePaintableLayer()) { return; }
    PS.applyFilterWith(f, lf.values);
};

PS.runFilter = function (f) {
    if (PS.transform && PS.transform.active) { PS.transform.commit(); }
    if (!PS.requirePaintableLayer()) { return; }
    var values = filterDefaults(f);
    if (!f.params || !f.params.length) { PS.applyFilterWith(f, values); return; }

    // settings window with live preview on the canvas
    var layer = PS.paintTarget();
    var previewTimer = null;
    var applied = false;
    var preview = true;

    function updatePreview() {
        if (previewTimer) { clearTimeout(previewTimer); }
        previewTimer = setTimeout(function () {
            previewTimer = null;
            if (applied) { return; }
            if (!preview) { revertPreview(); return; }
            PS.layerOverride = { layer: layer, canvas: PS.filterResultWithSelection(layer.canvas, f.render(layer.canvas, values)) };
            PS.requestRender();
        }, 120);
    }

    function revertPreview() {
        if (PS.layerOverride && PS.layerOverride.layer === layer) {
            PS.layerOverride = null;
            PS.requestRender();
        }
    }

    PS.floatingPanel({
        title: f.label.replace("...", ""),
        x: Math.max(80, window.innerWidth - 600), y: 110,
        build: function (body) {
            body.classList.add("filter-dialog");
            f.params.forEach(function (p) {
                var row = document.createElement("div");
                row.className = "form-row";
                var lab = document.createElement("label");
                lab.textContent = p.label;
                row.appendChild(lab);
                if (p.type === "select") {
                    var sel = PS.selectInput(p.options, values[p.key]);
                    sel.addEventListener("change", function () { values[p.key] = sel.value; updatePreview(); });
                    row.appendChild(sel);
                } else if (p.type === "check") {
                    var cb = document.createElement("input");
                    cb.type = "checkbox";
                    cb.checked = !!values[p.key];
                    cb.addEventListener("change", function () { values[p.key] = cb.checked; updatePreview(); });
                    row.appendChild(cb);
                } else {
                    var step = p.step || 1;
                    var range = document.createElement("input");
                    range.type = "range";
                    range.min = p.min; range.max = Math.min(p.max, p.sliderMax || p.max); range.step = step;
                    range.value = values[p.key];
                    var num = PS.ui.numberField(values[p.key], p.min, p.max, step, function (v) {
                        values[p.key] = v;
                        range.value = v;
                        updatePreview();
                    });
                    range.addEventListener("input", function () {
                        values[p.key] = parseFloat(range.value);
                        num.value = range.value;
                        updatePreview();
                    });
                    row.appendChild(range);
                    row.appendChild(num);
                    if (p.unit) {
                        var unit = document.createElement("span");
                        unit.className = "unit-label";
                        unit.textContent = p.unit;
                        row.appendChild(unit);
                    }
                }
                body.appendChild(row);
            });
            var pr = document.createElement("label");
            pr.className = "adjust-preview";
            var pc = document.createElement("input");
            pc.type = "checkbox";
            pc.checked = true;
            pc.addEventListener("change", function () { preview = pc.checked; updatePreview(); });
            pr.appendChild(pc);
            pr.appendChild(document.createTextNode(" Preview"));
            body.appendChild(pr);
            updatePreview();
        },
        buttons: [
            { label: "Cancel" },
            {
                label: "OK", primary: true,
                action: function () {
                    applied = true;
                    if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
                    revertPreview();
                    PS.applyFilterWith(f, values);
                }
            }
        ],
        onClose: function () {
            if (!applied) {
                if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
                revertPreview();
            }
        }
    });
};
