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

/* ---------- selection transform (resize handles) ---------- */

PS.selTransform = (function () {
    var HANDLE_PX = 8;    // handle square size, screen pixels
    var PAD_PX    = 6;    // gap between selection bounds and box edge, screen pixels

    var SEL_TOOLS = ["marquee-rect", "marquee-ellipse", "lasso", "lasso-poly", "wand"];

    var CURSOR = {
        nw: "nwse-resize", n: "ns-resize",   ne: "nesw-resize",
        e:  "ew-resize",   se: "nwse-resize", s:  "ns-resize",
        sw: "nesw-resize", w: "ew-resize"
    };

    // Ordered list for iteration
    var HANDLE_IDS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

    var state = null;
    // state: {
    //   handle, origBounds, origMask, origSelection, startPt, lastBounds, lastMask,
    //   // content-transform fields (null when the active layer can't be transformed):
    //   layer, before, base, float, preview
    // }

    function isSelTool() {
        return SEL_TOOLS.indexOf(PS.tool) >= 0;
    }

    // True when the active layer's selected pixels can be scaled along with
    // the selection (raster + visible). Text/hidden layers fall back to a
    // selection-only resize.
    function canTransformContent(layer) {
        return !!layer && layer.type === "raster" && layer.visible;
    }

    // Returns 8 handle positions in doc coords for a given bounds object
    function handlePositions(b) {
        var z = PS.zoom;
        var pad = PAD_PX / z;
        var x = b.x - pad, y = b.y - pad;
        var r = b.x + b.w + pad, bot = b.y + b.h + pad;
        var mx = (x + r) / 2, my = (y + bot) / 2;
        return {
            nw: { x: x,  y: y   }, n: { x: mx, y: y   }, ne: { x: r,  y: y   },
            e:  { x: r,  y: my  },                         se: { x: r,  y: bot },
            s:  { x: mx, y: bot }, sw: { x: x,  y: bot }, w:  { x: x,  y: my  }
        };
    }

    // Returns the handle id under pt (doc coords), or null
    function hitHandle(pt) {
        if (!isSelTool() || !PS.doc || !PS.doc.selection) { return null; }
        var positions = handlePositions(PS.doc.selection.bounds);
        var hitR = (HANDLE_PX / 2 + 3) / PS.zoom;
        for (var i = 0; i < HANDLE_IDS.length; i++) {
            var id = HANDLE_IDS[i];
            var h = positions[id];
            if (Math.abs(pt.x - h.x) <= hitR && Math.abs(pt.y - h.y) <= hitR) {
                return id;
            }
        }
        return null;
    }

    // Compute new bounds from a handle drag delta
    function computeBounds(handle, orig, delta) {
        var x = orig.x, y = orig.y, r = x + orig.w, bot = y + orig.h;
        var dx = delta.x, dy = delta.y;

        if (handle === "nw") { x += dx; y += dy; }
        else if (handle === "n")  { y += dy; }
        else if (handle === "ne") { r += dx; y += dy; }
        else if (handle === "e")  { r += dx; }
        else if (handle === "se") { r += dx; bot += dy; }
        else if (handle === "s")  { bot += dy; }
        else if (handle === "sw") { x += dx; bot += dy; }
        else if (handle === "w")  { x += dx; }

        var MIN = 2;
        if (r - x < MIN) {
            if (handle.indexOf("e") >= 0) { r = x + MIN; } else { x = r - MIN; }
        }
        if (bot - y < MIN) {
            if (handle.indexOf("s") >= 0) { bot = y + MIN; } else { y = bot - MIN; }
        }

        return { x: Math.round(x), y: Math.round(y),
                 w: Math.round(r - x), h: Math.round(bot - y) };
    }

    // Re-shape freely-computed bounds so they keep the original aspect ratio
    // (Shift held). Corner handles anchor the opposite corner; edge handles
    // derive the other dimension and stay centered on the untouched axis.
    function constrainAspect(handle, orig, nb) {
        var MIN = 2;
        var ratio = orig.w / (orig.h || 1);
        var w2, h2, x, y;

        if (handle.length === 2) {
            // corner: uniform scale driven by the dominant axis
            var s = Math.max(nb.w / orig.w, nb.h / orig.h);
            w2 = Math.max(MIN, Math.round(orig.w * s));
            h2 = Math.max(MIN, Math.round(orig.h * s));
            x = (handle.indexOf("w") >= 0) ? orig.x + orig.w - w2 : orig.x;
            y = (handle.indexOf("n") >= 0) ? orig.y + orig.h - h2 : orig.y;
        } else if (handle === "e" || handle === "w") {
            w2 = Math.max(MIN, nb.w);
            h2 = Math.max(MIN, Math.round(w2 / ratio));
            x = nb.x;
            y = Math.round(orig.y + orig.h / 2 - h2 / 2);
        } else {
            h2 = Math.max(MIN, nb.h);
            w2 = Math.max(MIN, Math.round(h2 * ratio));
            y = nb.y;
            x = Math.round(orig.x + orig.w / 2 - w2 / 2);
        }
        return { x: x, y: y, w: w2, h: h2 };
    }

    // Scale origMask (doc-sized) from origBounds region to newBounds
    function scaleMask(origMask, origBounds, newBounds) {
        var mask = PS.makeMaskCanvas();
        if (newBounds.w <= 0 || newBounds.h <= 0) { return mask; }
        var ctx = mask.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(origMask,
            origBounds.x, origBounds.y, origBounds.w, origBounds.h,
            newBounds.x,  newBounds.y,  newBounds.w,  newBounds.h);
        return mask;
    }

    return {
        get dragging() { return !!state; },

        // Returns CSS cursor string for the handle under pt, or null
        getCursor: function (pt) {
            if (!pt) { return null; }
            var h = hitHandle(pt);
            return h ? CURSOR[h] : null;
        },

        // Call on pointerdown; returns true if a handle was grabbed.
        // forceHandle lets a caller (the Move tool's content-box corners) grab
        // a specific handle without relying on sub-pixel hit-testing.
        onDown: function (pt, e, forceHandle) {
            if (!isSelTool() || !PS.doc || !PS.doc.selection) { return false; }
            var h = forceHandle || hitHandle(pt);
            if (!h) { return false; }
            var sel = PS.doc.selection;
            var layer = PS.activeLayer();

            state = {
                handle:        h,
                origBounds:    sel.bounds,
                origMask:      PS.cloneCanvas(sel.mask),
                origSelection: sel,
                startPt:       pt,
                lastBounds:    null,
                lastMask:      null,
                layer:         null,
                before:        null,
                base:          null,
                float:         null,
                preview:       null
            };

            if (canTransformContent(layer)) {
                state.layer = layer;
                state.before = PS.snapshotLayer(layer);

                // base = the layer with the selected region erased
                var base = PS.cloneCanvas(layer.canvas);
                var bctx = base.getContext("2d");
                bctx.globalCompositeOperation = "destination-out";
                bctx.drawImage(state.origMask, 0, 0);
                bctx.globalCompositeOperation = "source-over";
                state.base = base;

                // float = the selected pixels cropped to the selection bounds
                var ob = state.origBounds;
                var selPx = PS.getSelectedPixels(layer.canvas).canvas;
                var fl = PS.createCanvas(ob.w, ob.h);
                fl.getContext("2d").drawImage(selPx, -ob.x, -ob.y);
                state.float = fl;

                state.preview = PS.createCanvas(PS.doc.width, PS.doc.height);
            }
            return true;
        },

        // Call on pointermove while dragging; updates live selection +
        // (when possible) a live preview of the scaled content. Holding
        // Shift keeps the selection's original aspect ratio while it is
        // held, releasing it mid-drag returns to free scaling.
        onMove: function (pt, e) {
            if (!state) { return; }
            var delta = { x: pt.x - state.startPt.x, y: pt.y - state.startPt.y };
            var nb = computeBounds(state.handle, state.origBounds, delta);
            if (e && e.shiftKey) {
                nb = constrainAspect(state.handle, state.origBounds, nb);
            }
            state.lastBounds = nb;
            var mask = scaleMask(state.origMask, state.origBounds, nb);
            state.lastMask = mask;
            // Live selection preview (no history)
            PS.doc.selection = PS.buildSelectionObject(mask);

            if (state.layer) {
                var pctx = state.preview.getContext("2d");
                pctx.clearRect(0, 0, state.preview.width, state.preview.height);
                pctx.drawImage(state.base, 0, 0);
                if (nb.w > 0 && nb.h > 0) {
                    pctx.imageSmoothingEnabled = true;
                    pctx.imageSmoothingQuality = "high";
                    pctx.drawImage(state.float, nb.x, nb.y, nb.w, nb.h);
                }
                PS.layerOverride = { layer: state.layer, canvas: state.preview };
            }
            PS.requestRender();
        },

        // Call on pointerup; bakes the scaled content + selection to history
        onUp: function () {
            if (!state) { return false; }
            var s = state;
            state = null;

            if (!s.lastMask) {
                // No movement — restore cleanly without a history entry
                PS.doc.selection = s.origSelection;
                if (s.layer) { PS.layerOverride = null; }
                PS.requestRender();
                return true;
            }

            if (s.layer) {
                // Bake base + scaled content into the layer, then record one
                // history entry restoring both the pixels and the selection.
                PS.layerOverride = null;
                var nb = s.lastBounds;
                var lctx = s.layer.canvas.getContext("2d");
                lctx.clearRect(0, 0, s.layer.canvas.width, s.layer.canvas.height);
                lctx.drawImage(s.base, 0, 0);
                if (nb.w > 0 && nb.h > 0) {
                    lctx.imageSmoothingEnabled = true;
                    lctx.imageSmoothingQuality = "high";
                    lctx.drawImage(s.float, nb.x, nb.y, nb.w, nb.h);
                }

                var layer = s.layer;
                var beforeCanvas = s.before;
                var afterCanvas = PS.cloneCanvas(layer.canvas);
                var beforeSel = s.origSelection;
                var afterSel = PS.buildSelectionObject(s.lastMask);
                PS.doc.selection = afterSel;
                PS.pushHistory("Scale Selection",
                    function () {
                        PS.restoreLayerCanvas(layer, beforeCanvas);
                        PS.doc.selection = beforeSel;
                    },
                    function () {
                        PS.restoreLayerCanvas(layer, afterCanvas);
                        PS.doc.selection = afterSel;
                    });
                PS.requestRender();
            } else {
                // Selection-only resize (text/hidden layer)
                PS.doc.selection = s.origSelection;
                PS.setSelection(s.lastMask, "replace", "Scale Selection");
            }
            return true;
        },

        // Draw the bounding box + 8 white handles on the overlay canvas
        drawOverlay: function (ctx) {
            if (!isSelTool() || !PS.doc || !PS.doc.selection) { return; }
            var b = PS.doc.selection.bounds;
            var z = PS.zoom;
            var origin = PS.docToOverlay(0, 0);
            var pad = PAD_PX;

            // Bounding box in screen coords
            var sx = origin.x + b.x * z - pad;
            var sy = origin.y + b.y * z - pad;
            var sw = b.w * z + 2 * pad;
            var sh = b.h * z + 2 * pad;

            // Blue dashed bounding box
            ctx.save();
            ctx.strokeStyle = "rgba(100,160,255,0.85)";
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(Math.round(sx) + 0.5, Math.round(sy) + 0.5,
                           Math.round(sw), Math.round(sh));
            ctx.setLineDash([]);
            ctx.restore();

            // White handle squares at 8 positions
            var hs = HANDLE_PX, hh = hs / 2;
            var pts = [
                { x: sx,          y: sy          },
                { x: sx + sw / 2, y: sy          },
                { x: sx + sw,     y: sy          },
                { x: sx + sw,     y: sy + sh / 2 },
                { x: sx + sw,     y: sy + sh     },
                { x: sx + sw / 2, y: sy + sh     },
                { x: sx,          y: sy + sh     },
                { x: sx,          y: sy + sh / 2 }
            ];

            ctx.save();
            for (var i = 0; i < pts.length; i++) {
                var hp = pts[i];
                var hx = Math.round(hp.x), hy = Math.round(hp.y);
                // Dark border
                ctx.fillStyle = "rgba(30,30,30,0.75)";
                ctx.fillRect(hx - hh - 1, hy - hh - 1, hs + 2, hs + 2);
                // White fill
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(hx - hh, hy - hh, hs, hs);
            }
            ctx.restore();
        }
    };
}());
