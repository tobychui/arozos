/*
    Pixel Studio - vector masks, shape layers and fill layers

    Paths use ag-psd's BezierPath shape: {open, operation, fillRule, knots:
    [{linked, points: [inX, inY, anchorX, anchorY, outX, outY]}]} in document
    pixels. Subpaths combine in order with their boolean operation (combine,
    subtract, intersect, exclude).

    Shape layers (fill + vector mask + optional stroke) and fill layers
    (solid colour, gradient or pattern over the whole canvas) are drawn from
    their settings into layer.canvas whenever those settings change, so the
    compositor and every tool treat them like any other pixel layer.
*/
"use strict";

/* ---------- path geometry ---------- */

PS.subpathToPath2D = function (sp) {
    var p = new Path2D();
    var k = sp.knots || [];
    if (!k.length) { return p; }
    p.moveTo(k[0].points[2], k[0].points[3]);
    for (var i = 1; i < k.length; i++) {
        var a = k[i - 1].points, b = k[i].points;
        p.bezierCurveTo(a[4], a[5], b[0], b[1], b[2], b[3]);
    }
    if (!sp.open && k.length > 1) {
        var last = k[k.length - 1].points, first = k[0].points;
        p.bezierCurveTo(last[4], last[5], first[0], first[1], first[2], first[3]);
        p.closePath();
    }
    return p;
};

// Coverage of a path list as a doc-sized canvas (white, alpha = inside)
PS.rasterizePaths = function (paths, w, h, startFull) {
    var out = PS.createCanvas(w, h);
    var ctx = out.getContext("2d");
    ctx.fillStyle = "#fff";
    if (startFull) { ctx.fillRect(0, 0, w, h); }
    var tmp = PS.createCanvas(w, h);
    var tctx = tmp.getContext("2d");
    (paths || []).forEach(function (sp, i) {
        tctx.clearRect(0, 0, w, h);
        tctx.fillStyle = "#fff";
        tctx.fill(PS.subpathToPath2D(sp), sp.fillRule === "non-zero" ? "nonzero" : "evenodd");
        var op = sp.operation || "combine";
        // the first subpath of a shape starts it unless the mask starts full
        if (i === 0 && !startFull && op !== "combine") { op = op === "subtract" ? "none" : "combine"; }
        if (op === "none") { return; }
        ctx.globalCompositeOperation = {
            combine: "source-over", subtract: "destination-out",
            intersect: "destination-in", exclude: "xor"
        }[op] || "source-over";
        ctx.drawImage(tmp, 0, 0);
    });
    ctx.globalCompositeOperation = "source-over";
    return out;
};

// One Path2D for all subpaths (strokes ignore the boolean operations)
PS.pathsToPath2D = function (paths) {
    var all = new Path2D();
    (paths || []).forEach(function (sp) { all.addPath(PS.subpathToPath2D(sp)); });
    return all;
};

PS.translatePaths = function (paths, dx, dy) {
    (paths || []).forEach(function (sp) {
        (sp.knots || []).forEach(function (k) {
            for (var i = 0; i < 6; i += 2) { k.points[i] += dx; k.points[i + 1] += dy; }
        });
    });
};

PS.transformPaths = function (paths, m) {
    (paths || []).forEach(function (sp) {
        (sp.knots || []).forEach(function (k) {
            for (var i = 0; i < 6; i += 2) {
                var p = PS.applyAffine(m, k.points[i], k.points[i + 1]);
                k.points[i] = p.x; k.points[i + 1] = p.y;
            }
        });
    });
};

PS.pathsBounds = function (paths) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    (paths || []).forEach(function (sp) {
        (sp.knots || []).forEach(function (k) {
            for (var i = 0; i < 6; i += 2) {
                x0 = Math.min(x0, k.points[i]); x1 = Math.max(x1, k.points[i]);
                y0 = Math.min(y0, k.points[i + 1]); y1 = Math.max(y1, k.points[i + 1]);
            }
        });
    });
    if (x0 === Infinity) { return null; }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

// Rasterised vector mask of a layer (cached until its paths change)
PS.vectorMaskCanvas = function (layer) {
    var vm = layer.vmask;
    if (!vm || !vm.paths) { return null; }
    var d = PS.doc;
    var key = (vm.rev || 0) + ":" + d.width + "x" + d.height + ":" + (vm.invert ? 1 : 0) + ":" + (vm.feather || 0);
    if (vm._raster && vm._rasterKey === key) { return vm._raster; }
    var c = PS.rasterizePaths(vm.paths, d.width, d.height, vm.psd && vm.psd.fillStartsWithAllPixels);
    if (vm.invert) {
        var inv = PS.createCanvas(d.width, d.height);
        var ictx = inv.getContext("2d");
        ictx.fillStyle = "#fff";
        ictx.fillRect(0, 0, d.width, d.height);
        ictx.globalCompositeOperation = "destination-out";
        ictx.drawImage(c, 0, 0);
        c = inv;
    }
    if (vm.feather > 0) {
        var f = PS.createCanvas(d.width, d.height);
        var fctx = f.getContext("2d");
        fctx.filter = "blur(" + (vm.feather / 2) + "px)";
        fctx.drawImage(c, 0, 0);
        c = f;
    }
    Object.defineProperty(vm, "_raster", { value: c, writable: true, configurable: true, enumerable: false });
    Object.defineProperty(vm, "_rasterKey", { value: key, writable: true, configurable: true, enumerable: false });
    return c;
};

/* ---------- fills (colour / gradient / pattern) ---------- */

// Paint a VectorContent over the whole of ctx (w x h). box: the area a
// gradient spans (defaults to the canvas)
PS.paintVectorContent = function (ctx, content, w, h, box) {
    box = box || { x: 0, y: 0, w: w, h: h };
    if (!content) { return; }
    if (content.type === "color" || (!content.type && content.color)) {
        var rgb = PS.psdColorToRgb(content.color);
        ctx.fillStyle = PS.rgbToHex(rgb[0], rgb[1], rgb[2]);
        ctx.fillRect(0, 0, w, h);
        return;
    }
    if (content.type === "pattern") {
        var pat = PS.patternCanvas(content);
        if (!pat) { ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, w, h); return; }
        var pp = ctx.createPattern(pat, "repeat");
        var sc = content.scale || 1;
        var ph = content.phase || { x: 0, y: 0 };
        if (pp.setTransform) { pp.setTransform(new DOMMatrix([sc, 0, 0, sc, ph.x || 0, ph.y || 0])); }
        ctx.fillStyle = pp;
        ctx.fillRect(0, 0, w, h);
        return;
    }
    // gradients (solid or noise)
    PS.paintGradient(ctx, content, w, h, box);
};

// Gradient fill geometry: angle, scale, offset (percent of
// the box), style linear / radial / angle / reflected / diamond
PS.paintGradient = function (ctx, g, w, h, box) {
    var lut = PS.gradientLut(g, g.reverse);
    var ang = (g.angle === undefined ? 90 : g.angle) * Math.PI / 180;
    var dir = [Math.cos(ang), -Math.sin(ang)];
    var scale = g.scale === undefined ? 1 : g.scale;
    var off = g.offset || { x: 0, y: 0 };
    var cx = box.x + box.w / 2 + (off.x || 0) / 100 * box.w;
    var cy = box.y + box.h / 2 + (off.y || 0) / 100 * box.h;
    var len = Math.max(1, (Math.abs(box.w * dir[0]) + Math.abs(box.h * dir[1])) / 2 * scale);
    var style = g.style || g.gradientStyle || "linear";
    function stops(grad, mirror) {
        for (var i = 0; i < 256; i += 3) {
            var c = "rgba(" + lut[i * 4] + "," + lut[i * 4 + 1] + "," + lut[i * 4 + 2] + "," + (lut[i * 4 + 3] / 255) + ")";
            if (mirror) {
                grad.addColorStop(0.5 + 0.5 * i / 255, c);
                grad.addColorStop(0.5 - 0.5 * i / 255, c);
            } else {
                grad.addColorStop(i / 255, c);
            }
        }
        var e = "rgba(" + lut[1020] + "," + lut[1021] + "," + lut[1022] + "," + (lut[1023] / 255) + ")";
        if (mirror) { grad.addColorStop(1, e); grad.addColorStop(0, e); } else { grad.addColorStop(1, e); }
        return grad;
    }
    var grad;
    if (style === "radial") {
        grad = stops(ctx.createRadialGradient(cx, cy, 0, cx, cy, len));
    } else if (style === "angle" && ctx.createConicGradient) {
        // the angle gradient sweeps clockwise from the gradient angle
        grad = stops(ctx.createConicGradient(-ang, cx, cy));
    } else if (style === "reflected") {
        grad = stops(ctx.createLinearGradient(cx - dir[0] * len, cy - dir[1] * len, cx + dir[0] * len, cy + dir[1] * len), true);
    } else if (style === "diamond") {
        var img = ctx.createImageData(w, h);
        var dd = img.data;
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var px = x + 0.5 - cx, py = y + 0.5 - cy;
                var along = px * dir[0] + py * dir[1], across = px * dir[1] - py * dir[0];
                var t = Math.min(1, (Math.abs(along) + Math.abs(across)) / len);
                var k = Math.round(t * 255) * 4, o = (y * w + x) * 4;
                dd[o] = lut[k]; dd[o + 1] = lut[k + 1]; dd[o + 2] = lut[k + 2]; dd[o + 3] = lut[k + 3];
            }
        }
        ctx.putImageData(img, 0, 0);
        return;
    } else {
        grad = stops(ctx.createLinearGradient(cx - dir[0] * len, cy - dir[1] * len, cx + dir[0] * len, cy + dir[1] * len));
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
};

// Canvas of a pattern referenced by {name, id}, from the document's patterns
PS.patternCanvas = function (ref) {
    var pats = (PS.doc && PS.doc.psd && PS.doc.psd.patterns) || [];
    var p = pats.filter(function (x) { return ref && (x.id === ref.id || x.name === ref.name); })[0];
    if (!p || !p.data) { return null; }
    if (p._canvas) { return p._canvas; }
    var w = p.bounds ? p.bounds.w : Math.round(Math.sqrt(p.data.length / 4));
    var h = p.bounds ? p.bounds.h : w;
    var c = PS.createCanvas(w, h);
    c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(p.data.buffer ? p.data.slice().buffer : p.data), w, h), 0, 0);
    Object.defineProperty(p, "_canvas", { value: c, writable: true, configurable: true, enumerable: false });
    return c;
};

// A few patterns for documents that bring none of their own
PS.builtinPatterns = function () {
    function make(name, id, size, draw) {
        var c = PS.createCanvas(size, size);
        draw(c.getContext("2d"), size);
        var data = c.getContext("2d").getImageData(0, 0, size, size).data;
        return { name: name, id: id, x: 0, y: 0, bounds: { x: 0, y: 0, w: size, h: size }, data: new Uint8Array(data.buffer.slice(0)) };
    }
    return [
        make("Checkerboard", "ps-builtin-checker", 16, function (ctx, s) {
            ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, s, s);
            ctx.fillStyle = "#c8c8c8"; ctx.fillRect(0, 0, s / 2, s / 2); ctx.fillRect(s / 2, s / 2, s / 2, s / 2);
        }),
        make("Diagonal Lines", "ps-builtin-diagonal", 12, function (ctx, s) {
            ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, s, s);
            ctx.strokeStyle = "#555555"; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(-1, s + 1); ctx.lineTo(s + 1, -1); ctx.moveTo(-1, 1); ctx.lineTo(1, -1);
            ctx.moveTo(s - 1, s + 1); ctx.lineTo(s + 1, s - 1); ctx.stroke();
        }),
        make("Dots", "ps-builtin-dots", 14, function (ctx, s) {
            ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, s, s);
            ctx.fillStyle = "#3a3a3a"; ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 5, 0, 7); ctx.fill();
        }),
        make("Grid", "ps-builtin-grid", 16, function (ctx, s) {
            ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, s, s);
            ctx.fillStyle = "#9a9a9a"; ctx.fillRect(0, 0, s, 1); ctx.fillRect(0, 0, 1, s);
        })
    ];
};

// Patterns available to pick: the document's own plus the built-in ones
PS.availablePatterns = function () {
    var own = (PS.doc && PS.doc.psd && PS.doc.psd.patterns) || [];
    var builtin = PS._builtinPatterns || (PS._builtinPatterns = PS.builtinPatterns());
    return own.concat(builtin.filter(function (b) { return !own.some(function (o) { return o.id === b.id; }); }));
};

// Make sure a referenced pattern travels with the document (saved as Patt)
PS.ensurePatternInDoc = function (ref) {
    if (!ref || !PS.doc) { return; }
    var d = PS.doc;
    d.psd = d.psd || {};
    d.psd.patterns = d.psd.patterns || [];
    if (d.psd.patterns.some(function (p) { return p.id === ref.id; })) { return; }
    var src = PS.availablePatterns().filter(function (p) { return p.id === ref.id; })[0];
    if (src) { d.psd.patterns.push(src); }
};

/* ---------- procedural layers ---------- */

// Redraw a shape or fill layer's pixels from its settings
PS.renderProceduralLayer = function (layer) {
    var d = PS.doc;
    var w = d.width, h = d.height;
    if (!layer.canvas || layer.canvas.width !== w || layer.canvas.height !== h) {
        layer.canvas = PS.createCanvas(w, h);
    }
    var ctx = layer.canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);

    if (layer.kind === "fill") {
        PS.paintVectorContent(ctx, layer.fill, w, h);
        layer.rev++;
        return;
    }
    if (layer.kind !== "shape") { return; }
    var paths = layer.vmask ? layer.vmask.paths : [];
    var stroke = layer.stroke;
    var box = PS.pathsBounds(paths) || { x: 0, y: 0, w: w, h: h };
    var cover = PS.rasterizePaths(paths, w, h, layer.vmask && layer.vmask.psd && layer.vmask.psd.fillStartsWithAllPixels);

    if (!stroke || stroke.fillEnabled !== false) {
        var fillC = PS.createCanvas(w, h);
        var fctx = fillC.getContext("2d");
        PS.paintVectorContent(fctx, layer.fill, w, h, box);
        fctx.globalCompositeOperation = "destination-in";
        fctx.drawImage(cover, 0, 0);
        ctx.drawImage(fillC, 0, 0);
    }
    if (stroke && stroke.strokeEnabled) {
        var res = stroke.resolution || 72;
        var lw = PS.unitPx(stroke.lineWidth, 3);
        if (stroke.lineWidth && stroke.lineWidth.units === "Points") { lw = lw * res / 72; }
        var align = stroke.lineAlignment || "center";
        var sc = PS.createCanvas(w, h);
        var sctx = sc.getContext("2d");
        sctx.lineWidth = align === "center" ? lw : lw * 2;
        sctx.lineCap = stroke.lineCapType || "butt";
        sctx.lineJoin = stroke.lineJoinType || "miter";
        sctx.miterLimit = stroke.miterLimit || 10;
        if (stroke.lineDashSet && stroke.lineDashSet.length) {
            sctx.setLineDash(stroke.lineDashSet.map(function (v) { return PS.unitPx(v) * lw; }));
            sctx.lineDashOffset = PS.unitPx(stroke.lineDashOffset) * lw;
        }
        sctx.strokeStyle = "#fff";
        sctx.stroke(PS.pathsToPath2D(paths));
        if (align === "inside") {
            sctx.globalCompositeOperation = "destination-in";
            sctx.drawImage(cover, 0, 0);
        } else if (align === "outside") {
            sctx.globalCompositeOperation = "destination-out";
            sctx.drawImage(cover, 0, 0);
        }
        // colour the stroke with its own content
        var paint = PS.createCanvas(w, h);
        var pctx = paint.getContext("2d");
        PS.paintVectorContent(pctx, stroke.content || { type: "color", color: { r: 0, g: 0, b: 0 } }, w, h, box);
        pctx.globalCompositeOperation = "destination-in";
        pctx.drawImage(sc, 0, 0);
        ctx.globalAlpha = stroke.opacity === undefined ? 1 : stroke.opacity;
        ctx.globalCompositeOperation = PS.canvasBlendOp(stroke.blendMode || "normal");
        ctx.drawImage(paint, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
    }
    layer.rev++;
};

/* ---------- creating fill layers ---------- */

PS.newFillLayer = function (type) {
    if (!PS.doc) { return; }
    var d = PS.doc;
    var layer = PS.makeLayer({ color: "Color Fill 1", gradient: "Gradient Fill 1", pattern: "Pattern Fill 1" }[type], d.width, d.height, "fill");
    if (type === "color") {
        layer.fill = { type: "color", color: PS.hexToPsdColor(PS.fg) };
    } else if (type === "gradient") {
        var g = PS.stopsToPsdGradient([{ pos: 0, color: PS.fg }, { pos: 1, color: PS.bg }], "Foreground to Background");
        layer.fill = Object.assign(g, { style: "linear", angle: 90, scale: 1, reverse: false, dither: true, align: true, offset: { x: 0, y: 0 } });
    } else {
        var pat = PS.availablePatterns()[0];
        PS.ensurePatternInDoc(pat);
        layer.fill = { type: "pattern", name: pat.name, id: pat.id, scale: 1, phase: { x: 0, y: 0 }, linked: true };
    }
    // a fill layer comes with a mask (from the selection when there is one)
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
    PS.renderProceduralLayer(layer);
    PS.addLayerObject(layer, "New Fill Layer");
    if (PS.showLayerProperties) { PS.showLayerProperties(layer); }
};

PS.fillLayerMenuItems = function () {
    return [
        { label: "Solid Color...", action: function () { PS.newFillLayer("color"); } },
        { label: "Gradient...", action: function () { PS.newFillLayer("gradient"); } },
        { label: "Pattern...", action: function () { PS.newFillLayer("pattern"); } }
    ];
};

/* ---------- shape layers from the Shape tool ---------- */

// Bezier knots approximating an ellipse / polygon for a new shape layer
PS.shapePathsFromRect = function (kind, r, opts) {
    function knot(x, y, ix, iy, ox, oy) {
        return { linked: ix !== undefined, points: [ix === undefined ? x : ix, iy === undefined ? y : iy, x, y, ox === undefined ? x : ox, oy === undefined ? y : oy] };
    }
    var x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
    var knots = [];
    if (kind === "ellipse") {
        var k = 0.5522847498;
        var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = r.w / 2, ry = r.h / 2;
        knots = [
            knot(cx, y0, cx - rx * k, y0, cx + rx * k, y0),
            knot(x1, cy, x1, cy - ry * k, x1, cy + ry * k),
            knot(cx, y1, cx + rx * k, y1, cx - rx * k, y1),
            knot(x0, cy, x0, cy + ry * k, x0, cy - ry * k)
        ];
    } else if (kind === "rounded") {
        var rad = Math.min(opts.radius || 12, r.w / 2, r.h / 2), q = rad * 0.4477;
        knots = [
            knot(x0 + rad, y0, x0 + q, y0, x0 + rad, y0), knot(x1 - rad, y0, x1 - rad, y0, x1 - q, y0),
            knot(x1, y0 + rad, x1, y0 + q, x1, y0 + rad), knot(x1, y1 - rad, x1, y1 - rad, x1, y1 - q),
            knot(x1 - rad, y1, x1 - q, y1, x1 - rad, y1), knot(x0 + rad, y1, x0 + rad, y1, x0 + q, y1),
            knot(x0, y1 - rad, x0, y1 - q, x0, y1 - rad), knot(x0, y0 + rad, x0, y0 + rad, x0, y0 + q)
        ];
    } else if (kind === "triangle") {
        knots = [knot((x0 + x1) / 2, y0), knot(x1, y1), knot(x0, y1)];
    } else if (kind === "star") {
        var n = opts.points || 5, scx = (x0 + x1) / 2, scy = (y0 + y1) / 2;
        for (var i = 0; i < n * 2; i++) {
            var a = -Math.PI / 2 + i * Math.PI / n;
            var f = (i % 2) ? 0.45 : 1;
            knots.push(knot(scx + Math.cos(a) * r.w / 2 * f, scy + Math.sin(a) * r.h / 2 * f));
        }
    } else {
        knots = [knot(x0, y0), knot(x1, y0), knot(x1, y1), knot(x0, y1)];
    }
    return [{ open: false, operation: "combine", fillRule: "non-zero", knots: knots }];
};

// Line / arrow as a closed outline so they render as filled shapes
PS.shapePathsFromLine = function (a, b, width, arrow) {
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    var ux = dx / len, uy = dy / len, nx = -uy * width / 2, ny = ux * width / 2;
    function k(x, y) { return { linked: false, points: [x, y, x, y, x, y] }; }
    var knots;
    if (arrow) {
        var head = Math.max(width * 3, 12), hw = Math.max(width * 2, 8);
        var bx = b.x - ux * head, by = b.y - uy * head;
        knots = [k(a.x + nx, a.y + ny), k(bx + nx, by + ny), k(bx - uy * hw, by + ux * hw), k(b.x, b.y),
            k(bx + uy * hw, by - ux * hw), k(bx - nx, by - ny), k(a.x - nx, a.y - ny)];
    } else {
        knots = [k(a.x + nx, a.y + ny), k(b.x + nx, b.y + ny), k(b.x - nx, b.y - ny), k(a.x - nx, a.y - ny)];
    }
    return [{ open: false, operation: "combine", fillRule: "non-zero", knots: knots }];
};

PS.newShapeLayer = function (name, paths, fillHex, strokeHex, strokeWidth) {
    var d = PS.doc;
    var layer = PS.makeLayer(name || "Shape 1", d.width, d.height, "shape");
    layer.fill = { type: "color", color: PS.hexToPsdColor(fillHex || PS.fg) };
    layer.vmask = { paths: paths, invert: false, linked: true, enabled: true, density: 1, feather: 0, rev: 1, psd: null };
    if (strokeHex || fillHex === null) {
        layer.stroke = {
            strokeEnabled: !!strokeHex, fillEnabled: fillHex !== null,
            lineWidth: { value: strokeWidth || 3, units: "Pixels" }, lineDashOffset: { value: 0, units: "Pixels" },
            miterLimit: 100, lineCapType: "butt", lineJoinType: "miter", lineAlignment: "center",
            scaleLock: false, strokeAdjust: false, lineDashSet: [], blendMode: "normal", opacity: 1,
            content: { type: "color", color: PS.hexToPsdColor(strokeHex || "#000000") }, resolution: 72
        };
    }
    PS.renderProceduralLayer(layer);
    PS.addLayerObject(layer, "New Shape Layer");
    return layer;
};
