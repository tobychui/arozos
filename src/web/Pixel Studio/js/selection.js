/*
    Pixel Studio - selection engine
    Selections are alpha masks (doc-sized canvas, alpha 255 = selected).
    Marching ants outlines are traced from the mask with a boundary-edge
    walk and drawn animated on the overlay. The magic wand supports an
    edge-detection (Sobel) based "smart" mode that refuses to grow across
    strong image edges.
*/
"use strict";

/* ---------- mask construction ---------- */

PS.makeMaskCanvas = function () {
    return PS.createCanvas(PS.doc.width, PS.doc.height);
};

PS.maskFromRect = function (x, y, w, h, ellipse) {
    var mask = PS.makeMaskCanvas();
    var ctx = mask.getContext("2d");
    ctx.fillStyle = "#fff";
    if (ellipse) {
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.fillRect(x, y, w, h);
    }
    return mask;
};

PS.maskFromPolygon = function (points) {
    var mask = PS.makeMaskCanvas();
    if (points.length < 3) { return mask; }
    var ctx = mask.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (var i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();
    ctx.fill();
    return mask;
};

/* ---------- applying selections (with history) ---------- */

// mode: "replace" | "add" | "subtract" | "intersect"
PS.setSelection = function (mask, mode, label) {
    var d = PS.doc;
    var before = d.selection;

    var combined;
    if (!before || mode === "replace" || !mode) {
        combined = mask ? PS.cloneCanvas(mask) : null;
    } else {
        combined = PS.cloneCanvas(before.mask);
        var ctx = combined.getContext("2d");
        if (mode === "add") {
            ctx.drawImage(mask, 0, 0);
        } else if (mode === "subtract") {
            ctx.globalCompositeOperation = "destination-out";
            ctx.drawImage(mask, 0, 0);
        } else if (mode === "intersect") {
            ctx.globalCompositeOperation = "destination-in";
            ctx.drawImage(mask, 0, 0);
        }
    }

    var after = combined ? PS.buildSelectionObject(combined) : null;
    d.selection = after;

    PS.pushHistory(label || "Select",
        function () { PS.doc.selection = before; },
        function () { PS.doc.selection = after; });
    PS.requestRender();
};

// Build the immutable selection object: bounds + traced outline
PS.buildSelectionObject = function (mask) {
    var bounds = PS.maskBounds(mask);
    if (!bounds) { return null; }
    var loops = PS.traceMaskOutline(mask);
    return {
        mask: mask,
        bounds: bounds,
        loops: loops,
        antPath: PS.loopsToPath(loops)
    };
};

PS.maskBounds = function (mask) {
    var w = mask.width, h = mask.height;
    var data = mask.getContext("2d").getImageData(0, 0, w, h).data;
    var minX = w, minY = h, maxX = -1, maxY = -1;
    for (var y = 0; y < h; y++) {
        var rowOff = y * w * 4 + 3;
        for (var x = 0; x < w; x++) {
            if (data[rowOff + x * 4] >= 128) {
                if (x < minX) { minX = x; }
                if (x > maxX) { maxX = x; }
                if (y < minY) { minY = y; }
                if (y > maxY) { maxY = y; }
            }
        }
    }
    if (maxX < 0) { return null; }
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
};

PS.deselect = function () {
    if (!PS.doc.selection) { return; }
    PS.setSelection(null, "replace", "Deselect");
};

PS.selectAll = function () {
    var mask = PS.makeMaskCanvas();
    var ctx = mask.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, mask.width, mask.height);
    PS.setSelection(mask, "replace", "Select All");
};

PS.invertSelection = function () {
    var d = PS.doc;
    if (!d.selection) { PS.selectAll(); return; }
    var mask = PS.makeMaskCanvas();
    var ctx = mask.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, mask.width, mask.height);
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(d.selection.mask, 0, 0);
    PS.setSelection(mask, "replace", "Inverse Selection");
};

PS.featherSelection = function (radius) {
    var d = PS.doc;
    if (!d.selection) { return; }
    var mask = PS.makeMaskCanvas();
    var ctx = mask.getContext("2d");
    ctx.filter = "blur(" + radius + "px)";
    ctx.drawImage(d.selection.mask, 0, 0);
    ctx.filter = "none";
    PS.setSelection(mask, "replace", "Feather Selection");
};

PS.translateSelection = function (dx, dy) {
    var d = PS.doc;
    if (!d.selection) { return; }
    var mask = PS.makeMaskCanvas();
    mask.getContext("2d").drawImage(d.selection.mask, dx, dy);
    d.selection = PS.buildSelectionObject(mask);
};

PS.selectionViewChanged = function () {
    // outline path is stored in document coordinates and transformed at draw
    // time, so nothing to recompute on zoom/scroll. Hook kept for callers.
};

/* ---------- outline tracing (boundary-edge walk) ---------- */

// Returns an array of loops; each loop is a flat array [x0,y0, x1,y1, ...]
// of pixel-corner coordinates in document space.
PS.traceMaskOutline = function (mask) {
    var w = mask.width, h = mask.height;
    var data = mask.getContext("2d").getImageData(0, 0, w, h).data;

    function sel(x, y) {
        if (x < 0 || y < 0 || x >= w || y >= h) { return false; }
        return data[(y * w + x) * 4 + 3] >= 128;
    }

    // directed boundary edges, selected region kept on the left
    // key: start corner index (y*(w+1)+x) -> array of end corner indices
    var edgeMap = new Map();
    var W1 = w + 1;

    function addEdge(x0, y0, x1, y1) {
        var k = y0 * W1 + x0;
        var list = edgeMap.get(k);
        if (!list) { list = []; edgeMap.set(k, list); }
        list.push(y1 * W1 + x1);
    }

    for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
            if (!sel(x, y)) { continue; }
            if (!sel(x, y - 1)) { addEdge(x, y, x + 1, y); }         // top
            if (!sel(x + 1, y)) { addEdge(x + 1, y, x + 1, y + 1); } // right
            if (!sel(x, y + 1)) { addEdge(x + 1, y + 1, x, y + 1); } // bottom
            if (!sel(x - 1, y)) { addEdge(x, y + 1, x, y); }         // left
        }
    }

    var loops = [];
    var iter = edgeMap.keys();
    var startEntry = iter.next();
    var guard = 4 * (w + 2) * (h + 2);

    while (!startEntry.done) {
        var start = startEntry.value;
        var loop = [];
        var cur = start;
        var lastX = -2, lastY = -2, lastDx = 9, lastDy = 9;

        do {
            var list = edgeMap.get(cur);
            if (!list || list.length === 0) { edgeMap.delete(cur); break; }
            var next = list.pop();
            if (list.length === 0) { edgeMap.delete(cur); }

            var cx = cur % W1, cy = Math.floor(cur / W1);
            var nx = next % W1, ny = Math.floor(next / W1);
            var dx = nx - cx, dy = ny - cy;
            if (dx === lastDx && dy === lastDy) {
                // collinear continuation: replace last point
                loop[loop.length - 2] = nx;
                loop[loop.length - 1] = ny;
            } else {
                if (loop.length === 0) { loop.push(cx, cy); }
                loop.push(nx, ny);
                lastDx = dx; lastDy = dy;
            }
            cur = next;
        } while (cur !== start && guard-- > 0);

        if (loop.length >= 6) { loops.push(loop); }
        iter = edgeMap.keys();
        startEntry = iter.next();
    }
    return loops;
};

PS.loopsToPath = function (loops) {
    var path = new Path2D();
    loops.forEach(function (loop) {
        path.moveTo(loop[0], loop[1]);
        for (var i = 2; i < loop.length; i += 2) {
            path.lineTo(loop[i], loop[i + 1]);
        }
        path.closePath();
    });
    return path;
};

// draw animated marching ants on the overlay (called every frame)
PS.drawSelectionOverlay = function (ctx, t) {
    var sel = PS.doc.selection;
    if (!sel || !sel.antPath) { return; }
    var origin = PS.docToOverlay(0, 0);
    var z = PS.zoom;

    ctx.save();
    ctx.translate(origin.x, origin.y);
    ctx.scale(z, z);
    ctx.lineWidth = 1 / z;
    var dash = 5 / z;
    var phase = ((t || 0) * 0.012 % (2 * dash));

    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.setLineDash([dash, dash]);
    ctx.lineDashOffset = -phase;
    ctx.stroke(sel.antPath);

    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineDashOffset = -phase + dash;
    ctx.stroke(sel.antPath);
    ctx.restore();
};

/* ---------- magic wand / smart select ---------- */

// Build a mask by region growing from (x,y) on the flattened image.
// opts: tolerance (0-255), contiguous (bool), smart (bool), edgeThreshold (0-255)
PS.magicWandMask = function (x, y, opts) {
    var d = PS.doc;
    var w = d.width, h = d.height;
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= w || y >= h) { return null; }

    var src = PS.compositeToCanvas().getContext("2d").getImageData(0, 0, w, h);
    var px = src.data;

    // Sobel gradient magnitude as edge barrier for smart mode
    var edge = null;
    if (opts.smart) {
        edge = PS.sobelMagnitude(px, w, h);
    }
    var edgeThreshold = opts.edgeThreshold || 60;

    var i0 = (y * w + x) * 4;
    var sr = px[i0], sg = px[i0 + 1], sb = px[i0 + 2], sa = px[i0 + 3];
    var tol = opts.tolerance;

    function matches(i) {
        var dr = px[i] - sr, dg = px[i + 1] - sg, db = px[i + 2] - sb, da = px[i + 3] - sa;
        if (Math.abs(dr) > tol || Math.abs(dg) > tol || Math.abs(db) > tol || Math.abs(da) > tol) {
            return false;
        }
        if (edge && edge[i >> 2] > edgeThreshold) { return false; }
        return true;
    }

    var selBuf = new Uint8Array(w * h);

    if (!opts.contiguous) {
        for (var p = 0; p < w * h; p++) {
            if (matches(p * 4)) { selBuf[p] = 1; }
        }
        // seed pixel always selected even if it sits on an edge
        selBuf[y * w + x] = 1;
    } else {
        // scanline flood fill
        var stack = [[x, y]];
        selBuf[y * w + x] = 1;
        while (stack.length) {
            var pt = stack.pop();
            var cx = pt[0], cy = pt[1];

            // walk left/right along the scanline
            var left = cx;
            while (left > 0 && !selBuf[cy * w + left - 1] && matches((cy * w + left - 1) * 4)) {
                left--;
                selBuf[cy * w + left] = 1;
            }
            var right = cx;
            while (right < w - 1 && !selBuf[cy * w + right + 1] && matches((cy * w + right + 1) * 4)) {
                right++;
                selBuf[cy * w + right] = 1;
            }
            // spawn fills above/below the run
            for (var sx = left; sx <= right; sx++) {
                if (cy > 0 && !selBuf[(cy - 1) * w + sx] && matches(((cy - 1) * w + sx) * 4)) {
                    selBuf[(cy - 1) * w + sx] = 1;
                    stack.push([sx, cy - 1]);
                }
                if (cy < h - 1 && !selBuf[(cy + 1) * w + sx] && matches(((cy + 1) * w + sx) * 4)) {
                    selBuf[(cy + 1) * w + sx] = 1;
                    stack.push([sx, cy + 1]);
                }
            }
        }
    }

    var mask = PS.makeMaskCanvas();
    var mctx = mask.getContext("2d");
    var mdata = mctx.createImageData(w, h);
    for (var q = 0; q < w * h; q++) {
        if (selBuf[q]) {
            var off = q * 4;
            mdata.data[off] = 255;
            mdata.data[off + 1] = 255;
            mdata.data[off + 2] = 255;
            mdata.data[off + 3] = 255;
        }
    }
    mctx.putImageData(mdata, 0, 0);
    return mask;
};

// Sobel gradient magnitude (0-255 clamped) over the luminance channel
PS.sobelMagnitude = function (px, w, h) {
    var lum = new Float32Array(w * h);
    for (var p = 0; p < w * h; p++) {
        var o = p * 4;
        var a = px[o + 3] / 255;
        // composite over mid-grey so transparent edges register too
        lum[p] = (0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2]) * a + 128 * (1 - a);
    }
    var mag = new Float32Array(w * h);
    for (var y = 1; y < h - 1; y++) {
        for (var x = 1; x < w - 1; x++) {
            var i = y * w + x;
            var tl = lum[i - w - 1], tc = lum[i - w], tr = lum[i - w + 1];
            var ml = lum[i - 1], mr = lum[i + 1];
            var bl = lum[i + w - 1], bc = lum[i + w], br = lum[i + w + 1];
            var gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
            var gy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
            var m = Math.sqrt(gx * gx + gy * gy) / 4;
            mag[i] = m > 255 ? 255 : m;
        }
    }
    return mag;
};

/* ---------- selection-aware editing helpers ---------- */

// Run drawFn against the layer respecting the active selection mask.
// drawFn receives a 2d context covering the full document.
PS.maskedDraw = function (layer, drawFn) {
    var d = PS.doc;
    if (!d.selection) {
        drawFn(layer.canvas.getContext("2d"));
        return;
    }
    var scratch = PS.createCanvas(d.width, d.height);
    var sctx = scratch.getContext("2d");
    drawFn(sctx);
    sctx.globalCompositeOperation = "destination-in";
    sctx.drawImage(d.selection.mask, 0, 0);
    layer.canvas.getContext("2d").drawImage(scratch, 0, 0);
};

// Extract the selected pixels of a canvas: {canvas (doc-sized), bounds}
PS.getSelectedPixels = function (srcCanvas) {
    var d = PS.doc;
    var out = PS.createCanvas(d.width, d.height);
    var ctx = out.getContext("2d");
    ctx.drawImage(srcCanvas, 0, 0);
    var bounds;
    if (d.selection) {
        ctx.globalCompositeOperation = "destination-in";
        ctx.drawImage(d.selection.mask, 0, 0);
        bounds = d.selection.bounds;
    } else {
        bounds = { x: 0, y: 0, w: d.width, h: d.height };
    }
    return { canvas: out, bounds: bounds };
};

// Erase the selected region (or everything when no selection) on a layer
PS.clearSelectedOnLayer = function (layer) {
    var d = PS.doc;
    var ctx = layer.canvas.getContext("2d");
    if (d.selection) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.drawImage(d.selection.mask, 0, 0);
        ctx.globalCompositeOperation = "source-over";
    } else {
        ctx.clearRect(0, 0, d.width, d.height);
    }
};
