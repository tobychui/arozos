/*
    Pixel Studio - document layer model

    The layer stack is a tree that mirrors a PSD document:
        PS.doc.root.children   bottom-most layer first
        group.children         same order, nested to any depth

    Every node is a plain object made by PS.makeLayer / PS.makeGroup:

        kind        "raster" | "text" | "shape" | "fill" | "smart" |
                    "adjustment" | "group"
        canvas      doc-sized pixels for every kind except group and
                    adjustment (text / shape / fill keep a rendered copy
                    of their procedural content)
        rev         bumped whenever the canvas pixels change; the GPU
                    compositor re-uploads a texture only when it moves
        blend       PSD blend mode key ("normal", "multiply", ...,
                    "pass through" for groups)
        opacity / fillOpacity   0..1 (fill opacity leaves layer styles alone)
        clipping    clipped to the nearest non-clipped layer below
        locks       {transparency, pixels, position}
        mask        user (raster) mask: grayscale doc-sized canvas
        vmask       vector mask: bezier paths
        effects     layer style, kept in ag-psd's LayerEffectsInfo shape
        blendIf     "Blend If" ranges (ag-psd blendingRanges)
        psd         every other PSD field, carried through untouched
                    so a load / save round trip loses nothing

    Layers are referenced by object, never by index: PS.doc.active is the
    active layer object.
*/
"use strict";

PS._layerIdSeq = 1;

PS.PIXEL_KINDS = { raster: 1, text: 1, shape: 1, fill: 1, smart: 1 };

PS.makeLayer = function (name, w, h, kind) {
    kind = kind || "raster";
    var hasPixels = !!PS.PIXEL_KINDS[kind];
    return {
        id: PS._layerIdSeq++,
        name: name,
        kind: kind,
        canvas: hasPixels ? PS.createCanvas(w, h) : null,
        rev: 1,
        visible: true,
        opacity: 1,
        fillOpacity: 1,
        blend: "normal",
        clipping: false,
        locks: { transparency: false, pixels: false, position: false },
        color: "none",
        link: 0,
        mask: null,
        vmask: null,
        effects: null,
        blendIf: null,
        children: null,
        open: true,
        text: null,
        adjustment: null,
        fill: null,
        stroke: null,
        smart: null,
        offcanvas: null,
        psd: null
    };
};

PS.makeGroup = function (name) {
    var g = PS.makeLayer(name || "Group", 1, 1, "group");
    g.children = [];
    g.blend = "pass through";
    return g;
};

PS.isGroup = function (layer) { return !!(layer && layer.kind === "group"); };

PS.hasPixels = function (layer) { return !!(layer && layer.canvas); };

/* ---------- revision tracking ---------- */

// Call after any change to a layer's canvas pixels (or its mask's pixels when
// handed a mask paint target). The compositor keys its texture cache on rev.
PS.touchLayer = function (layer) {
    if (!layer) { return; }
    if (layer.isMaskTarget) {
        layer.owner.mask.rev++;
        return;
    }
    layer.rev++;
};

PS.touchMask = function (layer) {
    if (layer && layer.mask) { layer.mask.rev++; }
};

/* ---------- traversal ---------- */

// Depth-first walk, bottom to top. fn(layer, parent, index, depth); a group
// is visited before its children. Return false from fn to stop early.
PS.eachLayer = function (fn, root) {
    var stopped = false;
    function walk(node, depth) {
        var list = node.children || [];
        for (var i = 0; i < list.length && !stopped; i++) {
            if (fn(list[i], node, i, depth) === false) { stopped = true; return; }
            if (list[i].children) { walk(list[i], depth + 1); }
        }
    }
    if (PS.doc) { walk(root || PS.doc.root, 0); }
};

// Flat list of every layer, bottom to top, groups before their contents
PS.allLayers = function () {
    var out = [];
    PS.eachLayer(function (l) { out.push(l); });
    return out;
};

PS.layerCount = function () {
    var n = 0;
    PS.eachLayer(function () { n++; });
    return n;
};

// {parent, index} of a layer, or null when it is not in the document
PS.locateLayer = function (layer) {
    var found = null;
    if (!PS.doc || !layer) { return null; }
    if (PS.doc.root.children.indexOf(layer) >= 0) {
        return { parent: PS.doc.root, index: PS.doc.root.children.indexOf(layer) };
    }
    PS.eachLayer(function (l) {
        if (l.children) {
            var i = l.children.indexOf(layer);
            if (i >= 0) { found = { parent: l, index: i }; return false; }
        }
    });
    return found;
};

PS.parentOf = function (layer) {
    var loc = PS.locateLayer(layer);
    return loc ? loc.parent : null;
};

// Ancestors of a layer, nearest first (root excluded)
PS.ancestorsOf = function (layer) {
    var out = [];
    var p = PS.parentOf(layer);
    while (p && p !== PS.doc.root) {
        out.push(p);
        p = PS.parentOf(p);
    }
    return out;
};

PS.isInside = function (layer, group) {
    return PS.ancestorsOf(layer).indexOf(group) >= 0;
};

// Visible to the eye only when every ancestor group is visible as well
PS.isEffectivelyVisible = function (layer) {
    if (!layer.visible) { return false; }
    var anc = PS.ancestorsOf(layer);
    for (var i = 0; i < anc.length; i++) {
        if (!anc[i].visible) { return false; }
    }
    return true;
};

PS.insertLayer = function (layer, parent, index) {
    parent = parent || PS.doc.root;
    var list = parent.children;
    if (index === undefined || index === null) { index = list.length; }
    list.splice(PS.clamp(index, 0, list.length), 0, layer);
};

PS.removeLayerNode = function (layer) {
    var loc = PS.locateLayer(layer);
    if (!loc) { return null; }
    loc.parent.children.splice(loc.index, 1);
    return loc;
};

// The layer a clipped layer is clipped to (nearest non-clipped sibling below)
PS.clipBaseOf = function (layer) {
    if (!layer.clipping) { return null; }
    var loc = PS.locateLayer(layer);
    if (!loc) { return null; }
    for (var i = loc.index - 1; i >= 0; i--) {
        if (!loc.parent.children[i].clipping) { return loc.parent.children[i]; }
    }
    return null;
};

// Rows for the layers panel: top to bottom, with nesting depth. Contents of
// a collapsed group are skipped unless includeCollapsed is set.
PS.layerDisplayList = function (includeCollapsed) {
    var out = [];
    function walk(node, depth) {
        var list = node.children || [];
        for (var i = list.length - 1; i >= 0; i--) {
            var l = list[i];
            out.push({ layer: l, depth: depth, parent: node, index: i });
            if (l.children && (l.open || includeCollapsed)) { walk(l, depth + 1); }
        }
    }
    if (PS.doc) { walk(PS.doc.root, 0); }
    return out;
};

/* ---------- structure snapshots (undo of tree edits) ---------- */

// Records every children array of the tree plus the active layer. Layer
// objects are shared, not copied: structural edits must replace a layer
// object rather than repaint it when contents change.
PS.captureStructure = function () {
    var lists = [{ node: PS.doc.root, children: PS.doc.root.children.slice() }];
    PS.eachLayer(function (l) {
        if (l.children) { lists.push({ node: l, children: l.children.slice() }); }
    });
    return { lists: lists, active: PS.doc.active };
};

PS.applyStructure = function (snap) {
    snap.lists.forEach(function (entry) {
        entry.node.children = entry.children.slice();
    });
    PS.doc.active = snap.active;
};

/* ---------- active layer ---------- */

PS.activeLayer = function () {
    if (!PS.doc) { return null; }
    var a = PS.doc.active;
    if (a && PS.locateLayer(a)) { return a; }
    // the active layer left the tree (undo, delete): fall back to the top one
    var all = PS.allLayers();
    PS.doc.active = all.length ? all[all.length - 1] : null;
    return PS.doc.active;
};

/* ---------- paint targets ---------- */

// Tools paint on whatever PS.paintTarget returns: the layer itself, or a
// stand-in for its mask while the mask is being edited (mask thumbnail
// clicked). The stand-in exposes the mask canvas as .canvas so the brush,
// fill, gradient and filter code needs no special cases.
PS.maskTarget = function (layer) {
    if (!layer.mask) { return null; }
    if (!layer._maskTarget || layer._maskTarget.canvas !== layer.mask.canvas) {
        layer._maskTarget = {
            isMaskTarget: true,
            owner: layer,
            id: "mask-" + layer.id,
            name: layer.name + " mask",
            kind: "raster",
            canvas: layer.mask.canvas,
            visible: true,
            locks: { transparency: false, pixels: false, position: false }
        };
    }
    return layer._maskTarget;
};

PS.paintTarget = function () {
    // Quick Mask mode paints the selection
    if (PS.doc && PS.doc.quickMask) { return PS.doc.quickMask.target; }
    var layer = PS.activeLayer();
    if (!layer) { return null; }
    if (PS.doc.editMask && layer.mask) { return PS.maskTarget(layer); }
    return layer;
};

/* ---------- blend modes ---------- */

// The blend modes, grouped by family. "pass through" is offered
// for groups only.
PS.blendModeGroups = [
    [["normal", "Normal"], ["dissolve", "Dissolve"]],
    [["darken", "Darken"], ["multiply", "Multiply"], ["color burn", "Color Burn"],
        ["linear burn", "Linear Burn"], ["darker color", "Darker Color"]],
    [["lighten", "Lighten"], ["screen", "Screen"], ["color dodge", "Color Dodge"],
        ["linear dodge", "Linear Dodge (Add)"], ["lighter color", "Lighter Color"]],
    [["overlay", "Overlay"], ["soft light", "Soft Light"], ["hard light", "Hard Light"],
        ["vivid light", "Vivid Light"], ["linear light", "Linear Light"],
        ["pin light", "Pin Light"], ["hard mix", "Hard Mix"]],
    [["difference", "Difference"], ["exclusion", "Exclusion"],
        ["subtract", "Subtract"], ["divide", "Divide"]],
    [["hue", "Hue"], ["saturation", "Saturation"], ["color", "Color"],
        ["luminosity", "Luminosity"]]
];

// flat {v, l} list for selects (group: true adds Pass Through first)
PS.blendModeOptions = function (forGroup) {
    var out = [];
    if (forGroup) { out.push({ v: "pass through", l: "Pass Through" }); }
    PS.blendModeGroups.forEach(function (g) {
        g.forEach(function (m) { out.push({ v: m[0], l: m[1] }); });
    });
    return out;
};

PS.blendModeIndex = (function () {
    var map = { "pass through": 0 };
    var i = 1;
    PS.blendModeGroups.forEach(function (g) {
        g.forEach(function (m) { map[m[0]] = i++; });
    });
    return map;
})();

PS.blendModeLabel = function (key) {
    var label = key;
    PS.blendModeGroups.forEach(function (g) {
        g.forEach(function (m) { if (m[0] === key) { label = m[1]; } });
    });
    return key === "pass through" ? "Pass Through" : label;
};

// Canvas 2D composite operation for a blend mode (the 2D fallback renderer
// and quick merges); modes 2D canvas lacks fall back to the closest one.
PS.canvasBlendOp = function (key) {
    var map = {
        "normal": "source-over", "pass through": "source-over", "dissolve": "source-over",
        "darken": "darken", "multiply": "multiply", "color burn": "color-burn",
        "linear burn": "multiply", "darker color": "darken",
        "lighten": "lighten", "screen": "screen", "color dodge": "color-dodge",
        "linear dodge": "lighter", "lighter color": "lighten",
        "overlay": "overlay", "soft light": "soft-light", "hard light": "hard-light",
        "vivid light": "hard-light", "linear light": "hard-light", "pin light": "hard-light",
        "hard mix": "hard-light",
        "difference": "difference", "exclusion": "exclusion", "subtract": "difference",
        "divide": "color-dodge",
        "hue": "hue", "saturation": "saturation", "color": "color", "luminosity": "luminosity"
    };
    return map[key] || "source-over";
};

/* ---------- layer masks ---------- */

// Grayscale doc-sized mask canvas filled with value (0 hides, 255 reveals)
PS.createMaskCanvas = function (w, h, value) {
    var c = PS.createCanvas(w, h);
    var ctx = c.getContext("2d");
    var v = PS.clamp(Math.round(value === undefined ? 255 : value), 0, 255);
    ctx.fillStyle = "rgb(" + v + "," + v + "," + v + ")";
    ctx.fillRect(0, 0, c.width, c.height);
    return c;
};

PS.makeMask = function (w, h, value) {
    return {
        canvas: PS.createMaskCanvas(w, h, value),
        rev: 1,
        enabled: true,
        linked: true,
        defaultColor: value === undefined ? 255 : value,
        density: 1,
        feather: 0
    };
};

/* ---------- copying ---------- */

PS.deepCopy = function (o) {
    if (o === null || o === undefined) { return o; }
    if (ArrayBuffer.isView(o)) { return o.slice(); }
    if (Array.isArray(o)) { return o.map(PS.deepCopy); }
    if (typeof o === "object") {
        if (o instanceof HTMLCanvasElement) { return PS.cloneCanvas(o); }
        var out = {};
        Object.keys(o).forEach(function (k) {
            if (k.charAt(0) === "_") { return; }   // transient caches
            out[k] = PS.deepCopy(o[k]);
        });
        return out;
    }
    return o;
};

// Independent copy of a layer (and, for groups, its whole subtree) with
// fresh ids. Used by Duplicate Layer and geometry operations.
PS.cloneLayer = function (src, nameSuffix) {
    var copy = PS.makeLayer(src.name + (nameSuffix || ""), 1, 1, src.kind);
    Object.keys(src).forEach(function (k) {
        if (k === "id" || k === "name" || k.charAt(0) === "_") { return; }
        if (k === "children") {
            copy.children = src.children ? src.children.map(function (c) { return PS.cloneLayer(c); }) : null;
            return;
        }
        copy[k] = PS.deepCopy(src[k]);
    });
    copy.rev = 1;
    if (copy.mask) { copy.mask.rev = 1; }
    if (copy.vmask) { copy.vmask.rev = (copy.vmask.rev || 0) + 1; }
    return copy;
};

/* ---------- layer kind helpers ---------- */

PS.layerKindLabel = function (layer) {
    if (!layer) { return ""; }
    if (layer.kind === "adjustment" && layer.adjustment) {
        return PS.adjustmentLabel ? PS.adjustmentLabel(layer.adjustment.type) : "Adjustment";
    }
    return {
        raster: "Layer", text: "Text", shape: "Shape", fill: "Fill",
        smart: "Smart Object", adjustment: "Adjustment", group: "Group"
    }[layer.kind] || "Layer";
};

// True when the layer's pixels can be painted on directly
PS.isPaintable = function (layer) {
    return !!(layer && (layer.kind === "raster" || layer.isMaskTarget));
};

/* ---------- whole-layer state snapshots (undo of in-place edits) ---------- */

// Everything a move / transform may change on one layer, copied so it can be
// put back exactly
PS.captureLayerState = function (layer) {
    return {
        canvas: layer.canvas ? PS.cloneCanvas(layer.canvas) : null,
        mask: layer.mask ? PS.cloneCanvas(layer.mask.canvas) : null,
        maskDefault: layer.mask ? layer.mask.defaultColor : null,
        vmask: layer.vmask ? PS.deepCopy(layer.vmask.paths) : null,
        text: layer.text ? PS.deepCopy(layer.text) : null,
        smart: layer.smart ? PS.deepCopy(layer.smart) : null,
        fill: layer.fill ? PS.deepCopy(layer.fill) : null,
        offcanvas: layer.offcanvas ? {
            canvas: PS.cloneCanvas(layer.offcanvas.canvas),
            left: layer.offcanvas.left, top: layer.offcanvas.top
        } : null
    };
};

PS.restoreLayerState = function (layer, st) {
    if (st.canvas && layer.canvas) { PS.restoreLayerCanvas(layer, st.canvas); }
    if (st.mask && layer.mask) {
        var mc = layer.mask.canvas;
        mc.getContext("2d").clearRect(0, 0, mc.width, mc.height);
        mc.getContext("2d").drawImage(st.mask, 0, 0);
        layer.mask.defaultColor = st.maskDefault;
        layer.mask.rev++;
    }
    if (st.vmask && layer.vmask) {
        layer.vmask.paths = PS.deepCopy(st.vmask);
        layer.vmask.rev = (layer.vmask.rev || 0) + 1;
    }
    if (st.text) { layer.text = PS.deepCopy(st.text); }
    if (st.smart) { layer.smart = PS.deepCopy(st.smart); }
    if (st.fill) { layer.fill = PS.deepCopy(st.fill); }
    layer.offcanvas = st.offcanvas ? {
        canvas: PS.cloneCanvas(st.offcanvas.canvas),
        left: st.offcanvas.left, top: st.offcanvas.top
    } : null;
};

/* ---------- pixels beyond the canvas edge ---------- */

// A PSD layer may hold pixels outside the document. The editable
// layer.canvas covers the document only; the full raster is kept in
// layer.offcanvas = {canvas, left, top} and merged back on save (and before
// moves / transforms, so nothing beyond the edge is lost).
PS.offcanvasMerged = function (layer) {
    var d = PS.doc;
    var oc = layer.offcanvas;
    if (!oc) { return { canvas: layer.canvas, left: 0, top: 0 }; }
    var x0 = Math.min(oc.left, 0), y0 = Math.min(oc.top, 0);
    var x1 = Math.max(oc.left + oc.canvas.width, d.width);
    var y1 = Math.max(oc.top + oc.canvas.height, d.height);
    var c = PS.createCanvas(x1 - x0, y1 - y0);
    var ctx = c.getContext("2d");
    ctx.drawImage(oc.canvas, oc.left - x0, oc.top - y0);
    ctx.clearRect(-x0, -y0, d.width, d.height);
    ctx.drawImage(layer.canvas, -x0, -y0);
    return { canvas: c, left: x0, top: y0 };
};

// Rebuild layer.canvas (the document-sized view) from a full raster
PS.setOffcanvasRaster = function (layer, full) {
    var d = PS.doc;
    layer.offcanvas = full;
    var ctx = layer.canvas.getContext("2d");
    ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    ctx.drawImage(full.canvas, full.left, full.top);
    layer.rev++;
    // nothing left outside the document: drop the extra raster
    if (full.left >= 0 && full.top >= 0 &&
        full.left + full.canvas.width <= d.width && full.top + full.canvas.height <= d.height) {
        layer.offcanvas = null;
    }
};

// Leaf and group layers affected when the given layers are moved: groups
// bring their whole subtree
PS.expandWithDescendants = function (layers) {
    var out = [];
    layers.forEach(function (l) {
        if (out.indexOf(l) < 0) { out.push(l); }
        if (l.children) {
            PS.eachLayer(function (c) { if (out.indexOf(c) < 0) { out.push(c); } }, l);
        }
    });
    return out;
};

// Shift a canvas's content by (dx, dy), filling uncovered area with fillStyle
PS.shiftCanvas = function (canvas, dx, dy, fillStyle) {
    var copy = PS.cloneCanvas(canvas);
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (fillStyle) {
        ctx.fillStyle = fillStyle;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.clearRect(dx, dy, canvas.width, canvas.height);
    }
    ctx.drawImage(copy, dx, dy);
};

// Translate one layer's content in place (no history)
PS.translateLayerContent = function (layer, dx, dy) {
    if (!dx && !dy) { return; }
    if (layer.offcanvas && layer.canvas) {
        var full = PS.offcanvasMerged(layer);
        full.left += dx;
        full.top += dy;
        PS.setOffcanvasRaster(layer, full);
    } else if (layer.canvas && layer.kind !== "fill") {
        // fill layers are endless: only their mask moves
        PS.shiftCanvas(layer.canvas, dx, dy);
        layer.rev++;
    }
    var maskMoves = layer.mask && layer.mask.linked !== false;
    if (maskMoves) {
        var v = layer.mask.defaultColor === undefined ? 255 : layer.mask.defaultColor;
        PS.shiftCanvas(layer.mask.canvas, dx, dy, "rgb(" + v + "," + v + "," + v + ")");
        layer.mask.rev++;
    }
    if (layer.vmask && (layer.vmask.linked !== false || layer.kind === "shape") && PS.translatePaths) {
        PS.translatePaths(layer.vmask.paths, dx, dy);
        layer.vmask.rev = (layer.vmask.rev || 0) + 1;
    }
    if (layer.text && PS.translateText) { PS.translateText(layer, dx, dy); }
    if (layer.smart && layer.smart.transform) {
        for (var i = 0; i < layer.smart.transform.length; i += 2) {
            layer.smart.transform[i] += dx;
            layer.smart.transform[i + 1] += dy;
        }
    }
};

// Undoable move of several layers (groups move their contents)
PS.translateLayers = function (layers, dx, dy, label) {
    dx = Math.round(dx); dy = Math.round(dy);
    if (!dx && !dy) { return; }
    var all = PS.expandWithDescendants(layers);
    var before = all.map(PS.captureLayerState);
    all.forEach(function (l) { PS.translateLayerContent(l, dx, dy); });
    var after = all.map(PS.captureLayerState);
    PS.pushHistory(label || "Move",
        function () { all.forEach(function (l, i) { PS.restoreLayerState(l, before[i]); }); },
        function () { all.forEach(function (l, i) { PS.restoreLayerState(l, after[i]); }); });
    PS.requestRender();
};

// Move preview: the compositor samples these layers shifted by (dx, dy)
// instead of repainting their canvases on every pointer move
PS.movePreview = null;   // {layers: [...], dx, dy}

PS.moveOffsetOf = function (layer) {
    var mp = PS.movePreview;
    if (!mp || mp.layers.indexOf(layer) < 0) { return null; }
    return { dx: mp.dx, dy: mp.dy, maskToo: !layer.mask || layer.mask.linked !== false };
};
