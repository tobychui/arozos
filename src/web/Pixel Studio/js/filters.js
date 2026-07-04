/*
    Pixel Studio - filters
    All filters run client-side on the active layer, honoring the
    selection mask, with live preview through PS.layerOverride.
*/
"use strict";

/* ---------- application core ---------- */

// renderFn(srcCanvas) -> new canvas of the same size
PS.applyFilterToLayer = function (label, renderFn) {
    var layer = PS.requirePaintableLayer();
    if (!layer) { return; }
    var before = PS.snapshotLayer(layer);
    var result = renderFn(layer.canvas);

    var ctx = layer.canvas.getContext("2d");
    if (PS.doc.selection) {
        // keep unselected pixels, replace selected ones
        var masked = PS.cloneCanvas(result);
        var mctx = masked.getContext("2d");
        mctx.globalCompositeOperation = "destination-in";
        mctx.drawImage(PS.doc.selection.mask, 0, 0);

        ctx.globalCompositeOperation = "destination-out";
        ctx.drawImage(PS.doc.selection.mask, 0, 0);
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(masked, 0, 0);
    } else {
        ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        ctx.drawImage(result, 0, 0);
    }

    PS.commitLayerCanvas(label, layer, before);
    PS.requestRender();
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

/* ---------- filter catalog ---------- */

PS.filters = [
    {
        id: "gaussian-blur", label: "Gaussian Blur...",
        param: { label: "Radius", min: 1, max: 60, value: 6, unit: "px" },
        render: function (src, v) { return PS.cssFilterCanvas(src, "blur(" + v + "px)"); }
    },
    {
        id: "sharpen", label: "Sharpen",
        render: function (src) {
            return PS.convolveCanvas(src, [0, -1, 0, -1, 5, -1, 0, -1, 0]);
        }
    },
    {
        id: "pixelate", label: "Pixelate...",
        param: { label: "Block size", min: 2, max: 64, value: 8, unit: "px" },
        render: function (src, v) {
            var w = src.width, h = src.height;
            var small = PS.createCanvas(Math.max(1, w / v), Math.max(1, h / v));
            var sctx = small.getContext("2d");
            sctx.drawImage(src, 0, 0, small.width, small.height);
            var out = PS.createCanvas(w, h);
            var octx = out.getContext("2d");
            octx.imageSmoothingEnabled = false;
            octx.drawImage(small, 0, 0, w, h);
            return out;
        }
    },
    {
        id: "brightness", label: "Brightness...",
        param: { label: "Brightness", min: 10, max: 300, value: 120, unit: "%" },
        render: function (src, v) { return PS.cssFilterCanvas(src, "brightness(" + v + "%)"); }
    },
    {
        id: "contrast", label: "Contrast...",
        param: { label: "Contrast", min: 10, max: 300, value: 130, unit: "%" },
        render: function (src, v) { return PS.cssFilterCanvas(src, "contrast(" + v + "%)"); }
    },
    {
        id: "saturation", label: "Saturation...",
        param: { label: "Saturation", min: 0, max: 300, value: 150, unit: "%" },
        render: function (src, v) { return PS.cssFilterCanvas(src, "saturate(" + v + "%)"); }
    },
    {
        id: "hue", label: "Hue Rotate...",
        param: { label: "Angle", min: 0, max: 360, value: 90, unit: "°" },
        render: function (src, v) { return PS.cssFilterCanvas(src, "hue-rotate(" + v + "deg)"); }
    },
    { id: "sep1", sep: true },
    {
        id: "grayscale", label: "Grayscale",
        render: function (src) { return PS.cssFilterCanvas(src, "grayscale(100%)"); }
    },
    {
        id: "sepia", label: "Sepia",
        render: function (src) { return PS.cssFilterCanvas(src, "sepia(100%)"); }
    },
    {
        id: "invert", label: "Invert",
        render: function (src) { return PS.cssFilterCanvas(src, "invert(100%)"); }
    },
    { id: "sep2", sep: true },
    {
        id: "edge", label: "Edge Detect",
        render: function (src) {
            var w = src.width, h = src.height;
            var px = src.getContext("2d").getImageData(0, 0, w, h).data;
            var mag = PS.sobelMagnitude(px, w, h);
            var out = PS.createCanvas(w, h);
            var octx = out.getContext("2d");
            var img = octx.createImageData(w, h);
            for (var p = 0; p < w * h; p++) {
                var m = mag[p];
                var o = p * 4;
                img.data[o] = m;
                img.data[o + 1] = m;
                img.data[o + 2] = m;
                img.data[o + 3] = px[o + 3];
            }
            octx.putImageData(img, 0, 0);
            return out;
        }
    },
    {
        id: "emboss", label: "Emboss",
        render: function (src) {
            return PS.convolveCanvas(src, [-2, -1, 0, -1, 1, 1, 0, 1, 2]);
        }
    }
];

/* ---------- menu glue ---------- */

PS.runFilter = function (f) {
    if (!PS.requirePaintableLayer()) { return; }

    if (!f.param) {
        PS.applyFilterToLayer(f.label.replace("...", ""), function (src) {
            return f.render(src);
        });
        return;
    }

    // parametric filter: draggable, non-modal slider panel with live preview
    // so the user can reposition it off the area being edited
    var layer = PS.activeLayer();
    var value = f.param.value;
    var previewTimer = null;
    var applied = false;

    function updatePreview() {
        if (previewTimer) { return; }
        previewTimer = setTimeout(function () {
            previewTimer = null;
            PS.layerOverride = { layer: layer, canvas: f.render(layer.canvas, value) };
            PS.requestRender();
        }, 60);
    }

    function revertPreview() {
        if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
        if (PS.layerOverride && PS.layerOverride.layer === layer) {
            PS.layerOverride = null;
            PS.requestRender();
        }
    }

    PS.floatingPanel({
        title: f.label.replace("...", ""),
        build: function (body) {
            var row = document.createElement("div");
            row.className = "form-row";
            var lab = document.createElement("label");
            lab.textContent = f.param.label;
            var slider = document.createElement("input");
            slider.type = "range";
            slider.min = f.param.min;
            slider.max = f.param.max;
            slider.value = value;
            var val = document.createElement("span");
            val.className = "range-val";
            val.textContent = value + (f.param.unit || "");
            slider.addEventListener("input", function () {
                value = parseFloat(slider.value);
                val.textContent = value + (f.param.unit || "");
                updatePreview();
            });
            row.appendChild(lab);
            row.appendChild(slider);
            row.appendChild(val);
            body.appendChild(row);
            updatePreview();
        },
        buttons: [
            { label: "Cancel" },
            {
                label: "Apply", primary: true,
                action: function () {
                    applied = true;
                    if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
                    PS.layerOverride = null;
                    PS.applyFilterToLayer(f.label.replace("...", ""), function (src) {
                        return f.render(src, value);
                    });
                }
            }
        ],
        onClose: function () {
            // Cancel / close button: drop the preview without applying
            if (!applied) { revertPreview(); }
        }
    });
};
