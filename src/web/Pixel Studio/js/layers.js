/*
    Pixel Studio - layer operations and the Layers panel (bottom-right)

    Works on the layer tree from model.js: groups, layer / vector masks,
    clipping masks, locks, fill opacity and layer styles. Structural edits go
    through PS.layerStructure (history.js) so undo restores the whole tree.
*/
"use strict";

/* ---------- creation ---------- */

// Insertion point for a new layer: above the active layer in its parent, or
// at the top inside the active group when that group is expanded
PS.newLayerSlot = function () {
    var d = PS.doc;
    var a = PS.activeLayer();
    if (!a) { return { parent: d.root, index: d.root.children.length }; }
    if (a.kind === "group" && a.open) { return { parent: a, index: a.children.length }; }
    var loc = PS.locateLayer(a);
    return { parent: loc.parent, index: loc.index + 1 };
};

// Insert an already built layer object at the new-layer slot (one undo step)
PS.addLayerObject = function (layer, label, slot) {
    slot = slot || PS.newLayerSlot();
    PS.layerStructure(label || "New Layer", function () {
        PS.insertLayer(layer, slot.parent, slot.index);
        PS.doc.active = layer;
        PS.doc.editMask = false;
    });
    return layer;
};

PS.addLayer = function (name, opts) {
    opts = opts || {};
    var d = PS.doc;
    var layer = PS.makeLayer(name || ("Layer " + PS._layerIdSeq), d.width, d.height, opts.kind);
    if (opts.canvas) {
        layer.canvas.getContext("2d").drawImage(opts.canvas, 0, 0);
    }
    if (opts.type === "text") { layer.kind = "text"; }
    if (opts.text) { layer.text = opts.text; }
    return PS.addLayerObject(layer, opts.label || "New Layer");
};

// doc-space {x,y,w,h} of a layer's actual content (trimmed to opaque pixels
// for raster layers, text metrics for text layers), or null if empty
// The box fits the visible pixels (text included), cached until the layer's pixels change
PS.layerContentBounds = function (layer) {
    if (!layer) { return null; }
    if (layer.kind === "group") {
        var box = null;
        PS.eachLayer(function (l) {
            if (!l.canvas || !l.visible) { return; }
            var b = PS.layerContentBounds(l);
            if (!b) { return; }
            if (!box) { box = { x: b.x, y: b.y, w: b.w, h: b.h }; return; }
            var x2 = Math.max(box.x + box.w, b.x + b.w), y2 = Math.max(box.y + box.h, b.y + b.h);
            box.x = Math.min(box.x, b.x); box.y = Math.min(box.y, b.y);
            box.w = x2 - box.x; box.h = y2 - box.y;
        }, layer);
        return box;
    }
    if (!layer.canvas) { return null; }
    var key = layer.rev + ":" + layer.canvas.width + "x" + layer.canvas.height;
    if (layer._bounds && layer._bounds.key === key) { return layer._bounds.box; }
    var box = PS.maskBounds(layer.canvas);
    if (!box && layer.kind === "text" && layer.text && PS.textLayerBounds) { box = PS.textLayerBounds(layer); }
    layer._bounds = { key: key, box: box };
    return box;
};

/* ---------- align / distribute (Move tool options, Layer menu) ---------- */

PS.ALIGN_ICONS = {
    left: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M4 3v18"/><rect x="7" y="6" width="12" height="4"/><rect x="7" y="14" width="7" height="4"/></svg>',
    hcenter: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M12 3v18"/><rect x="5" y="6" width="14" height="4"/><rect x="8" y="14" width="8" height="4"/></svg>',
    right: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M20 3v18"/><rect x="5" y="6" width="12" height="4"/><rect x="10" y="14" width="7" height="4"/></svg>',
    top: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M3 4h18"/><rect x="6" y="7" width="4" height="12"/><rect x="14" y="7" width="4" height="7"/></svg>',
    vcenter: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M3 12h18"/><rect x="6" y="5" width="4" height="14"/><rect x="14" y="8" width="4" height="8"/></svg>',
    bottom: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M3 20h18"/><rect x="6" y="5" width="4" height="12"/><rect x="14" y="10" width="4" height="7"/></svg>',
    dleft: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M4 4v16M11 4v16M18 4v16"/><path d="M4 8h3M11 12h3M18 16h3"/></svg>',
    dhcenter: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M5 4v16M12 4v16M19 4v16"/><path d="M3 8h4M10 12h4M17 16h4"/></svg>',
    dtop: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M4 4h16M4 11h16M4 18h16"/><path d="M8 4v3M12 11v3M16 18v3"/></svg>',
    dvcenter: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M4 5h16M4 12h16M4 19h16"/><path d="M8 3v4M12 10v4M16 17v4"/></svg>'
};

// Move several layers each by its own offset as one undo step
PS.translateEach = function (moves, label) {
    moves = moves.filter(function (m) { return (Math.round(m.dx) || Math.round(m.dy)) && !m.layer.locks.position; });
    if (!moves.length) { return; }
    var all = [];
    moves.forEach(function (m) {
        PS.expandWithDescendants([m.layer]).forEach(function (l) { all.push({ layer: l, dx: Math.round(m.dx), dy: Math.round(m.dy) }); });
    });
    var before = all.map(function (m) { return PS.captureLayerState(m.layer); });
    all.forEach(function (m) { PS.translateLayerContent(m.layer, m.dx, m.dy); });
    var after = all.map(function (m) { return PS.captureLayerState(m.layer); });
    PS.pushHistory(label,
        function () { all.forEach(function (m, i) { PS.restoreLayerState(m.layer, before[i]); }); },
        function () { all.forEach(function (m, i) { PS.restoreLayerState(m.layer, after[i]); }); });
    PS.requestRender();
};

PS.alignLayers = function (mode) {
    var d = PS.doc;
    if (!d) { return; }
    var layers = PS.withLinkedLayers(PS.topLevelSelected());
    var items = layers.map(function (l) { return { layer: l, b: PS.layerContentBounds(l) }; }).filter(function (x) { return x.b; });
    if (!items.length) { return; }
    var ref;
    if (d.selection) { ref = d.selection.bounds; }
    else if (items.length >= 2) {
        ref = items.reduce(function (a, x) {
            if (!a) { return { x: x.b.x, y: x.b.y, w: x.b.w, h: x.b.h }; }
            var x0 = Math.min(a.x, x.b.x), y0 = Math.min(a.y, x.b.y);
            return { x: x0, y: y0, w: Math.max(a.x + a.w, x.b.x + x.b.w) - x0, h: Math.max(a.y + a.h, x.b.y + x.b.h) - y0 };
        }, null);
    } else {
        // one layer and no selection: align to the canvas
        ref = { x: 0, y: 0, w: d.width, h: d.height };
    }
    PS.translateEach(items.map(function (x) {
        var b = x.b, dx = 0, dy = 0;
        if (mode === "left") { dx = ref.x - b.x; }
        else if (mode === "hcenter") { dx = ref.x + ref.w / 2 - (b.x + b.w / 2); }
        else if (mode === "right") { dx = ref.x + ref.w - (b.x + b.w); }
        else if (mode === "top") { dy = ref.y - b.y; }
        else if (mode === "vcenter") { dy = ref.y + ref.h / 2 - (b.y + b.h / 2); }
        else if (mode === "bottom") { dy = ref.y + ref.h - (b.y + b.h); }
        return { layer: x.layer, dx: dx, dy: dy };
    }), "Align");
};

PS.distributeLayers = function (mode) {
    var layers = PS.topLevelSelected();
    var items = layers.map(function (l) { return { layer: l, b: PS.layerContentBounds(l) }; }).filter(function (x) { return x.b; });
    if (items.length < 3) { PS.toast("Select three or more layers to distribute", true); return; }
    var horizontal = mode === "dleft" || mode === "dhcenter";
    function key(b) {
        if (mode === "dleft") { return b.x; }
        if (mode === "dhcenter") { return b.x + b.w / 2; }
        if (mode === "dtop") { return b.y; }
        return b.y + b.h / 2;
    }
    items.sort(function (a, c) { return key(a.b) - key(c.b); });
    var first = key(items[0].b), last = key(items[items.length - 1].b);
    var step = (last - first) / (items.length - 1);
    PS.translateEach(items.map(function (x, i) {
        var delta = first + step * i - key(x.b);
        return { layer: x.layer, dx: horizontal ? delta : 0, dy: horizontal ? 0 : delta };
    }), "Distribute");
};

/* ---------- selection of several layers (panel Ctrl / Shift click) ---------- */

// Layers picked in the panel besides the active one, held as ids so tree
// edits cannot scramble them. The active layer always counts as selected.
PS.layerSel = [];

// Selected layers in stacking order (bottom to top), always including the
// active one and never a layer that has left the tree
PS.selectedLayers = function () {
    var d = PS.doc;
    if (!d) { return []; }
    var out = [];
    PS.eachLayer(function (l) {
        if (l === d.active || PS.layerSel.indexOf(l.id) >= 0) { out.push(l); }
    });
    return out;
};

// kept for callers that only need a count
PS.selectedLayerIndices = function () { return PS.selectedLayers(); };

PS.setLayerSelection = function (layers) {
    PS.layerSel = (layers || []).map(function (l) { return l.id; });
};

PS.clearLayerSelection = function () { PS.layerSel = []; };

// Only the outermost of the selected layers: selecting a group and one of
// its children acts on the group alone
PS.topLevelSelected = function () {
    var sel = PS.selectedLayers();
    return sel.filter(function (l) {
        return !sel.some(function (o) { return o !== l && o.kind === "group" && PS.isInside(l, o); });
    });
};

PS.setActiveLayer = function (layer, keepMaskTarget) {
    if (PS.commitTextEdit) { PS.commitTextEdit(); }
    if (!layer) { return; }
    var changed = PS.doc.active !== layer;
    PS.doc.active = layer;
    if (changed && !keepMaskTarget) { PS.doc.editMask = false; }
    if (!layer.mask) { PS.doc.editMask = false; }
    PS.renderLayersPanel();
    if (PS.renderPropertiesPanel) { PS.renderPropertiesPanel(); }
    if (PS.refreshTypeUI) { PS.refreshTypeUI(); }
    if (PS.tool && PS.tools[PS.tool] && PS.tools[PS.tool].onLayerChange) {
        PS.tools[PS.tool].onLayerChange();
    }
};

// Panel row click: plain click selects one layer, Ctrl/Cmd toggles a layer,
// Shift extends from the active layer along the visible rows
PS.selectLayerFromClick = function (layer, e) {
    var d = PS.doc;
    var sel = PS.selectedLayers();

    if (e && (e.ctrlKey || e.metaKey)) {
        var at = sel.indexOf(layer);
        if (at >= 0) {
            if (sel.length === 1) { return; }
            sel.splice(at, 1);
            if (layer === d.active) {
                var next = sel[sel.length - 1];
                PS.setLayerSelection(sel);
                PS.setActiveLayer(next);
            } else {
                PS.setLayerSelection(sel);
                PS.renderLayersPanel();
            }
            return;
        }
        sel.push(layer);
        PS.setLayerSelection(sel);
        PS.setActiveLayer(layer);
        return;
    }

    if (e && e.shiftKey && d.active) {
        var rows = PS.layerDisplayList();
        var ia = -1, ib = -1;
        rows.forEach(function (r, i) {
            if (r.layer === d.active) { ia = i; }
            if (r.layer === layer) { ib = i; }
        });
        if (ia >= 0 && ib >= 0) {
            var range = [];
            for (var i = Math.min(ia, ib); i <= Math.max(ia, ib); i++) { range.push(rows[i].layer); }
            PS.setLayerSelection(range);
            PS.setActiveLayer(layer);
            return;
        }
    }

    PS.clearLayerSelection();
    PS.setActiveLayer(layer);
};

/* ---------- delete / duplicate ---------- */

PS.deleteSelectedLayers = function () {
    var d = PS.doc;
    var victims = PS.topLevelSelected();
    if (!victims.length) { return; }
    var remaining = PS.layerCount() - victims.reduce(function (n, l) {
        var c = 1;
        if (l.children) { PS.eachLayer(function () { c++; }, l); }
        return n + c;
    }, 0);
    if (remaining <= 0) { PS.toast("Cannot delete every layer", true); return; }

    // the next active layer: the one below the lowest deleted, or above it
    var loc = PS.locateLayer(victims[0]);
    PS.layerStructure(victims.length > 1 ? "Delete Layers" : "Delete Layer", function () {
        victims.forEach(function (l) { PS.removeLayerNode(l); });
        var sib = loc.parent.children;
        var pick = sib[Math.min(loc.index, sib.length - 1)] || sib[loc.index - 1] ||
            (loc.parent !== d.root ? loc.parent : null);
        d.active = pick || null;
        d.editMask = false;
    });
    PS.activeLayer();
    PS.renderLayersPanel();
};

PS.deleteLayer = PS.deleteSelectedLayers;

PS.duplicateLayer = function () {
    var d = PS.doc;
    var sources = PS.topLevelSelected();
    if (!sources.length) { return; }
    var copies = [];
    PS.layerStructure(sources.length > 1 ? "Duplicate Layers" : "Duplicate Layer", function () {
        // insert each copy right above its source, top-most first so the
        // indices of the others stay valid
        for (var i = sources.length - 1; i >= 0; i--) {
            var src = sources[i];
            var copy = PS.cloneLayer(src, " copy");
            var loc = PS.locateLayer(src);
            PS.insertLayer(copy, loc.parent, loc.index + 1);
            copies.unshift(copy);
        }
        d.active = copies[copies.length - 1];
    });
    PS.setLayerSelection(copies);
    PS.renderLayersPanel();
};

/* ---------- merging ---------- */

// Rasterise nodes (rendered isolated, as if they were a group in Normal mode)
// into a new raster layer
PS.rasterizeNodes = function (nodes, name) {
    var d = PS.doc;
    var c = PS.renderer.compositeCanvas(nodes);
    var layer = PS.makeLayer(name || "Merged", d.width, d.height);
    layer.canvas.getContext("2d").drawImage(c, 0, 0);
    return layer;
};

PS.mergeDown = function () {
    var d = PS.doc;
    var top = PS.activeLayer();
    var loc = PS.locateLayer(top);
    if (!loc || loc.index <= 0) { PS.toast("No layer below to merge into", true); return; }
    var bottom = loc.parent.children[loc.index - 1];
    if (!top.visible || !bottom.visible) { PS.toast("Both layers must be visible to merge", true); return; }

    // the lower layer is drawn plainly; the result takes over its blend mode
    // and opacity (Merge Down)
    var plainBottom = PS.cloneLayer(bottom);
    plainBottom.blend = bottom.kind === "group" ? "pass through" : "normal";
    plainBottom.opacity = 1;
    var upper = top;
    if (top.clipping) { upper = PS.cloneLayer(top); }
    var merged = PS.rasterizeNodes([plainBottom, upper], bottom.name);
    merged.blend = bottom.kind === "group" ? "normal" : bottom.blend;
    merged.opacity = bottom.opacity;
    merged.clipping = bottom.clipping;

    PS.layerStructure("Merge Down", function () {
        loc.parent.children.splice(loc.index - 1, 2, merged);
        d.active = merged;
        d.editMask = false;
    });
};

PS.mergeSelectedLayers = function () {
    var d = PS.doc;
    var sel = PS.topLevelSelected().filter(function (l) { return l.visible; });
    if (sel.length < 2) { PS.toast("Select two or more visible layers to merge", true); return; }
    var top = sel[sel.length - 1];
    var merged = PS.rasterizeNodes(sel, top.name);
    var loc = PS.locateLayer(top);
    PS.layerStructure("Merge Layers", function () {
        PS.insertLayer(merged, loc.parent, loc.index + 1);
        sel.forEach(function (l) { PS.removeLayerNode(l); });
        d.active = merged;
        d.editMask = false;
    });
};

PS.mergeSelectedOrDown = function () {
    if (PS.selectedLayers().length > 1) { PS.mergeSelectedLayers(); }
    else { PS.mergeDown(); }
};

// Merge every visible layer into one, keeping hidden ones (Ctrl+Shift+E)
PS.mergeVisible = function () {
    var d = PS.doc;
    var visibleTop = d.root.children.filter(function (l) { return l.visible; });
    if (visibleTop.length < 1) { return; }
    var merged = PS.rasterizeNodes(d.root.children, "Merged");
    PS.layerStructure("Merge Visible", function () {
        d.root.children = d.root.children.filter(function (l) { return !l.visible; });
        d.root.children.push(merged);
        d.active = merged;
        d.editMask = false;
    });
};

PS.flattenImage = function () {
    var d = PS.doc;
    var flat = PS.rasterizeNodes(d.root.children, "Background");
    PS.layerStructure("Flatten Image", function () {
        d.root.children = [flat];
        d.active = flat;
        d.editMask = false;
    });
};

/* ---------- groups ---------- */

PS.groupSelectedLayers = function () {
    var d = PS.doc;
    var sel = PS.topLevelSelected();
    if (!sel.length) { return; }
    var top = sel[sel.length - 1];
    var group = PS.makeGroup("Group " + (PS._groupSeq = (PS._groupSeq || 0) + 1));
    var loc = PS.locateLayer(top);
    PS.layerStructure("Group Layers", function () {
        PS.insertLayer(group, loc.parent, loc.index + 1);
        sel.forEach(function (l) {
            PS.removeLayerNode(l);
            group.children.push(l);
        });
        // a clipped layer whose base stayed outside would clip to nothing
        if (group.children.length && group.children[0].clipping) { group.children[0].clipping = false; }
        d.active = group;
        d.editMask = false;
    });
};

PS.newGroup = function () {
    var group = PS.makeGroup("Group " + (PS._groupSeq = (PS._groupSeq || 0) + 1));
    PS.addLayerObject(group, "New Group");
};

PS.ungroupLayers = function () {
    var d = PS.doc;
    var g = PS.activeLayer();
    if (!g || g.kind !== "group") { PS.toast("Select a group to ungroup", true); return; }
    var loc = PS.locateLayer(g);
    PS.layerStructure("Ungroup Layers", function () {
        var kids = g.children.slice();
        loc.parent.children.splice.apply(loc.parent.children, [loc.index, 1].concat(kids));
        d.active = kids.length ? kids[kids.length - 1] : (loc.parent.children[loc.index - 1] || null);
        d.editMask = false;
    });
};

PS.toggleGroupOpen = function (g) {
    g.open = !g.open;
    PS.renderLayersPanel();
};

/* ---------- ordering ---------- */

// Move the active layer one step up (dir 1) or down (-1) among its siblings;
// at the end of a group it steps out of the group
PS.moveLayer = function (dir) {
    var d = PS.doc;
    var layer = PS.activeLayer();
    var loc = PS.locateLayer(layer);
    if (!loc) { return; }
    var list = loc.parent.children;
    var j = loc.index + dir;
    PS.layerStructure(dir > 0 ? "Move Layer Up" : "Move Layer Down", function () {
        if (j >= 0 && j < list.length) {
            list[loc.index] = list[j];
            list[j] = layer;
        } else if (loc.parent !== d.root) {
            var ploc = PS.locateLayer(loc.parent);
            list.splice(loc.index, 1);
            PS.insertLayer(layer, ploc.parent, dir > 0 ? ploc.index + 1 : ploc.index);
        }
        d.active = layer;
    });
};

// Move a layer to parent / index (drag and drop). Moving a group into
// itself is refused.
PS.moveLayerTo = function (layer, parent, index) {
    var d = PS.doc;
    if (layer === parent || (parent !== d.root && PS.isInside(parent, layer))) { return; }
    var loc = PS.locateLayer(layer);
    if (!loc) { return; }
    if (loc.parent === parent && (index === loc.index || index === loc.index + 1)) { return; }
    PS.layerStructure("Reorder Layer", function () {
        loc.parent.children.splice(loc.index, 1);
        if (loc.parent === parent && index > loc.index) { index--; }
        PS.insertLayer(layer, parent, index);
        d.active = layer;
    });
};

/* ---------- properties ---------- */

PS.toggleLayerVisible = function (layer, soloAlt) {
    if (soloAlt) {
        // Alt+click: show only this layer (among its siblings), or show all again
        var loc = PS.locateLayer(layer);
        var sibs = loc.parent.children;
        var others = sibs.filter(function (l) { return l !== layer; });
        var soloed = others.every(function (l) { return !l.visible; }) && layer.visible;
        var before = sibs.map(function (l) { return l.visible; });
        sibs.forEach(function (l) { l.visible = soloed ? true : (l === layer); });
        var after = sibs.map(function (l) { return l.visible; });
        PS.pushHistory("Show / Hide Layers",
            function () { sibs.forEach(function (l, i) { l.visible = before[i]; }); },
            function () { sibs.forEach(function (l, i) { l.visible = after[i]; }); });
        PS.requestRender();
        PS.renderLayersPanel();
        return;
    }
    PS.layerPropChange(layer.visible ? "Hide Layer" : "Show Layer", layer,
        layer.visible, !layer.visible, function (l, v) { l.visible = v; });
};

PS.renameLayer = function (layer, newName) {
    var old = layer.name;
    if (!newName || newName === old) { return; }
    PS.layerPropChange("Rename Layer", layer, old, newName, function (l, v) { l.name = v; });
};

PS.setLayerBlend = function (layer, mode) {
    if (layer.blend === mode) { return; }
    PS.layerPropChange("Blend Mode", layer, layer.blend, mode, function (l, v) { l.blend = v; });
};

PS.toggleClipping = function (layer) {
    layer = layer || PS.activeLayer();
    if (!layer) { return; }
    var loc = PS.locateLayer(layer);
    if (!layer.clipping && loc.index === 0) {
        PS.toast("Clipping needs a layer below in the same group", true);
        return;
    }
    PS.layerPropChange(layer.clipping ? "Release Clipping Mask" : "Create Clipping Mask", layer,
        layer.clipping, !layer.clipping, function (l, v) { l.clipping = v; });
};

PS.setLock = function (layer, which, value) {
    var before = JSON.parse(JSON.stringify(layer.locks));
    var after = JSON.parse(JSON.stringify(layer.locks));
    if (which === "all") {
        after.transparency = after.pixels = after.position = value;
    } else {
        after[which] = value;
    }
    PS.layerPropChange("Lock", layer, before, after, function (l, v) { l.locks = JSON.parse(JSON.stringify(v)); });
};

PS.isFullyLocked = function (layer) {
    return !!(layer.locks.transparency && layer.locks.pixels && layer.locks.position);
};

PS.setLayerColor = function (layer, color) {
    PS.layerPropChange("Layer Color", layer, layer.color, color, function (l, v) { l.color = v; });
};

// Turn a text / shape / fill / smart layer into plain pixels
PS.rasterizeLayer = function (layer) {
    layer = layer || PS.activeLayer();
    if (!layer || !layer.canvas || layer.kind === "raster") {
        PS.toast("Nothing to rasterize on this layer", true);
        return;
    }
    if (PS.commitTextEdit) { PS.commitTextEdit(); }
    var r = PS.cloneLayer(layer);
    r.id = layer.id;
    r.kind = "raster";
    r.text = r.fill = r.stroke = r.smart = r.adjustment = null;
    if (layer.kind === "shape" || layer.kind === "fill") { r.vmask = null; }
    if (r.psd) {
        delete r.psd.text; delete r.psd.placedLayer; delete r.psd.vectorFill;
        delete r.psd.vectorStroke; delete r.psd.vectorOrigination;
    }
    PS.replaceLayer(layer, r, "Rasterize " + PS.layerKindLabel(layer));
};

// Swap one layer object for another in place (undoable)
PS.replaceLayer = function (oldLayer, newLayer, label) {
    var d = PS.doc;
    var loc = PS.locateLayer(oldLayer);
    if (!loc) { return; }
    PS.layerStructure(label || "Change Layer", function () {
        loc.parent.children[loc.index] = newLayer;
        if (d.active === oldLayer) { d.active = newLayer; }
    });
};

/* ---------- layer masks ---------- */

// mode: "reveal" | "hide" | "selection" | "hideSelection"
PS.addLayerMask = function (mode, layer) {
    var d = PS.doc;
    layer = layer || PS.activeLayer();
    if (!layer) { return; }
    if (layer.mask) { PS.toast("This layer already has a mask", true); return; }
    if (!mode) { mode = d.selection ? "selection" : "reveal"; }
    var mask = PS.makeMask(d.width, d.height, (mode === "hide" || mode === "selection") ? 0 : 255);
    if ((mode === "selection" || mode === "hideSelection") && d.selection) {
        var ctx = mask.canvas.getContext("2d");
        var tint = PS.createCanvas(d.width, d.height);
        var tctx = tint.getContext("2d");
        tctx.fillStyle = mode === "selection" ? "#fff" : "#000";
        tctx.fillRect(0, 0, d.width, d.height);
        tctx.globalCompositeOperation = "destination-in";
        tctx.drawImage(d.selection.mask, 0, 0);
        ctx.drawImage(tint, 0, 0);
        mask.defaultColor = mode === "selection" ? 0 : 255;
    }
    PS.layerPropChange("Add Layer Mask", layer, null, mask, function (l, v) {
        l.mask = v;
        if (!v) { d.editMask = false; }
    });
    d.editMask = true;
    PS.renderLayersPanel();
};

PS.deleteLayerMask = function (layer) {
    layer = layer || PS.activeLayer();
    if (!layer || !layer.mask) { return; }
    PS.doc.editMask = false;
    PS.layerPropChange("Delete Layer Mask", layer, layer.mask, null, function (l, v) { l.mask = v; });
};

// Bake the mask into the layer's pixels and drop it
PS.applyLayerMask = function (layer) {
    layer = layer || PS.activeLayer();
    if (!layer || !layer.mask) { return; }
    if (layer.kind !== "raster") { PS.toast("Rasterize the layer before applying its mask", true); return; }
    var r = PS.cloneLayer(layer);
    r.id = layer.id;
    var alpha = PS.maskToAlphaCanvas(layer.mask);
    var ctx = r.canvas.getContext("2d");
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(alpha, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    r.mask = null;
    PS.doc.editMask = false;
    PS.replaceLayer(layer, r, "Apply Layer Mask");
};

PS.toggleMaskEnabled = function (layer) {
    layer = layer || PS.activeLayer();
    if (!layer || !layer.mask) { return; }
    var m = layer.mask;
    PS.layerPropChange(m.enabled === false ? "Enable Layer Mask" : "Disable Layer Mask", layer,
        m.enabled !== false, m.enabled === false, function (l, v) { l.mask.enabled = v; });
};

PS.toggleMaskLinked = function (layer) {
    layer = layer || PS.activeLayer();
    if (!layer || !layer.mask) { return; }
    PS.layerPropChange("Link Mask", layer, layer.mask.linked !== false, layer.mask.linked === false,
        function (l, v) { l.mask.linked = v; });
};

PS.invertLayerMask = function (layer) {
    layer = layer || PS.activeLayer();
    if (!layer || !layer.mask) { return; }
    var target = PS.maskTarget(layer);
    var before = PS.snapshotLayer(target);
    var ctx = layer.mask.canvas.getContext("2d");
    ctx.globalCompositeOperation = "difference";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, layer.mask.canvas.width, layer.mask.canvas.height);
    ctx.globalCompositeOperation = "source-over";
    PS.commitLayerCanvas("Invert Mask", target, before);
    PS.requestRender();
};

// Mask value (luminance, erased pixels reveal) as an alpha canvas
PS.maskToAlphaCanvas = function (mask) {
    var w = mask.canvas.width, h = mask.canvas.height;
    var src = mask.canvas.getContext("2d").getImageData(0, 0, w, h).data;
    var out = new ImageData(w, h);
    var dens = mask.density === undefined ? 1 : mask.density;
    for (var i = 0; i < src.length; i += 4) {
        var v = (src[i] * src[i + 3] + 255 * (255 - src[i + 3])) / 255;
        out.data[i] = out.data[i + 1] = out.data[i + 2] = 255;
        out.data[i + 3] = 255 - dens * (255 - v);
    }
    var c = PS.createCanvas(w, h);
    c.getContext("2d").putImageData(out, 0, 0);
    return c;
};

PS.deleteVectorMask = function (layer) {
    layer = layer || PS.activeLayer();
    if (!layer || !layer.vmask) { return; }
    PS.layerPropChange("Delete Vector Mask", layer, layer.vmask, null, function (l, v) { l.vmask = v; });
};

PS.toggleVectorMaskEnabled = function (layer) {
    layer = layer || PS.activeLayer();
    if (!layer || !layer.vmask) { return; }
    PS.layerPropChange("Toggle Vector Mask", layer, layer.vmask.enabled !== false, layer.vmask.enabled === false,
        function (l, v) { l.vmask.enabled = v; });
};

/* ---------- layer styles (on / off from the panel) ---------- */

PS.toggleEffectsVisible = function (layer) {
    if (!layer.effects) { return; }
    PS.layerPropChange(layer.effects.disabled ? "Show Layer Style" : "Hide Layer Style", layer,
        !!layer.effects.disabled, !layer.effects.disabled, function (l, v) { l.effects.disabled = v; });
};

PS.toggleEffectEnabled = function (layer, key, idx) {
    var fx = layer.effects;
    if (!fx || !fx[key]) { return; }
    var entry = Array.isArray(fx[key]) ? fx[key][idx || 0] : fx[key];
    if (!entry) { return; }
    var was = entry.enabled !== false;
    PS.layerPropChange(was ? "Hide Effect" : "Show Effect", layer, was, !was, function (l, v) {
        var e = Array.isArray(l.effects[key]) ? l.effects[key][idx || 0] : l.effects[key];
        e.enabled = v;
    });
};

PS.clearLayerStyle = function (layer) {
    layer = layer || PS.activeLayer();
    if (!layer || !layer.effects) { return; }
    PS.layerPropChange("Clear Layer Style", layer, layer.effects, null, function (l, v) { l.effects = v; });
};

PS._styleClipboard = null;

PS.copyLayerStyle = function () {
    var l = PS.activeLayer();
    if (!l || !l.effects) { PS.toast("This layer has no layer style", true); return; }
    PS._styleClipboard = PS.deepCopy(l.effects);
    PS.toast("Layer style copied");
};

PS.pasteLayerStyle = function () {
    if (!PS._styleClipboard) { PS.toast("No layer style copied", true); return; }
    var targets = PS.selectedLayers();
    var befores = targets.map(function (l) { return l.effects; });
    var style = PS._styleClipboard;
    targets.forEach(function (l) { l.effects = PS.deepCopy(style); });
    var afters = targets.map(function (l) { return l.effects; });
    PS.pushHistory("Paste Layer Style",
        function () { targets.forEach(function (l, i) { l.effects = befores[i]; }); },
        function () { targets.forEach(function (l, i) { l.effects = afters[i]; }); });
    PS.requestRender();
    PS.renderLayersPanel();
};

/* ---------- layers panel UI ---------- */

PS._thumbTimer = null;

PS.updateLayerThumbsThrottled = function () {
    if (PS._thumbTimer) { return; }
    PS._thumbTimer = setTimeout(function () {
        PS._thumbTimer = null;
        PS.updateLayerThumbs();
    }, 250);
};

PS._drawThumb = function (thumb, src, fill) {
    var tctx = thumb.getContext("2d");
    tctx.clearRect(0, 0, thumb.width, thumb.height);
    if (fill) { tctx.fillStyle = fill; tctx.fillRect(0, 0, thumb.width, thumb.height); }
    var scale = Math.min(thumb.width / PS.doc.width, thumb.height / PS.doc.height);
    var w = PS.doc.width * scale, h = PS.doc.height * scale;
    tctx.drawImage(src, (thumb.width - w) / 2, (thumb.height - h) / 2, w, h);
};

PS.updateLayerThumbs = function () {
    if (!PS.doc) { return; }
    var byId = {};
    PS.eachLayer(function (l) { byId[l.id] = l; });
    document.querySelectorAll("#layers-list .layer-row").forEach(function (row) {
        var layer = byId[row.dataset.id];
        if (!layer) { return; }
        var thumb = row.querySelector("canvas.content-thumb");
        if (thumb && layer.canvas) { PS._drawThumb(thumb, layer.canvas); }
        var mthumb = row.querySelector("canvas.mask-thumb");
        if (mthumb && layer.mask) { PS._drawThumb(mthumb, layer.mask.canvas, "#fff"); }
    });
};

PS.ICONS = {
    eye: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
    folder: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M3 6.5h6l2 2h10v10.5H3z"/></svg>',
    folderOpen: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M3 6.5h6l2 2h8v2.5"/><path d="M3 6.5v12.5h16l3-8.5H6l-3 8.5"/></svg>',
    adjust: '<svg viewBox="0 0 24 24" stroke-width="1.6"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
    chain: '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    lock: '<svg viewBox="0 0 24 24" stroke-width="1.8"><rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    lockAlpha: '<svg viewBox="0 0 24 24" stroke-width="1.4"><rect x="4" y="4" width="16" height="16"/><path d="M4 4h4v4H4zM12 4h4v4h-4zM8 8h4v4H8zM16 8h4v4h-4zM4 12h4v4H4zM12 12h4v4h-4zM8 16h4v4H8zM16 16h4v4h-4z" fill="currentColor" stroke="none"/></svg>',
    lockPixels: '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M4 20 15 9l3 3L7 23M15 9l2-2a2.1 2.1 0 0 1 3 3l-2 2"/></svg>',
    lockPosition: '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/></svg>',
    fx: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M10 4H8a2 2 0 0 0-2 2v14M3 10h7M13 10l7 9M20 10l-7 9"/></svg>',
    mask: '<svg viewBox="0 0 24 24" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="1.5"/><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>',
    newLayer: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M5 4h10l4 4v12H5z"/><path d="M12 10v6M9 13h6"/></svg>',
    trash: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></svg>',
    clipArrow: '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M7 4v10h10M13 10l4 4-4 4"/></svg>',
    smart: '<svg viewBox="0 0 24 24" stroke-width="1.6"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 15h8M12 8v7"/></svg>',
    text: '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg>',
    caret: '<svg viewBox="0 0 24 24" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>',
    caretDown: '<svg viewBox="0 0 24 24" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>',
    shape: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M4 18 12 5l8 13z"/></svg>'
};

PS.EFFECT_NAMES = [
    ["dropShadow", "Drop Shadow"], ["innerShadow", "Inner Shadow"], ["outerGlow", "Outer Glow"],
    ["innerGlow", "Inner Glow"], ["bevel", "Bevel & Emboss"], ["satin", "Satin"],
    ["solidFill", "Color Overlay"], ["gradientOverlay", "Gradient Overlay"],
    ["patternOverlay", "Pattern Overlay"], ["stroke", "Stroke"]
];

// [{key, index, name, entry}] for every effect present on a layer
PS.listEffects = function (fx) {
    var out = [];
    if (!fx) { return out; }
    PS.EFFECT_NAMES.forEach(function (e) {
        var v = fx[e[0]];
        if (!v) { return; }
        (Array.isArray(v) ? v : [v]).forEach(function (entry, i) {
            if (entry.present === false) { return; }
            out.push({ key: e[0], index: i, name: e[1], entry: entry });
        });
    });
    return out;
};

// Layer filter of the panel (the "Kind" / "Name" filter bar)
PS.layerFilter = { on: false, mode: "kind", kinds: {}, name: "" };

PS.layerKindClass = function (l) {
    if (l.kind === "raster") { return "pixel"; }
    if (l.kind === "adjustment" || l.kind === "fill") { return "adjustment"; }
    if (l.kind === "text") { return "type"; }
    if (l.kind === "shape") { return "shape"; }
    if (l.kind === "smart") { return "smart"; }
    return "group";
};

PS.layerPassesFilter = function (l) {
    var f = PS.layerFilter;
    if (!f.on) { return true; }
    if (f.mode === "name") {
        return !f.name || l.name.toLowerCase().indexOf(f.name.toLowerCase()) >= 0;
    }
    var any = Object.keys(f.kinds).filter(function (k) { return f.kinds[k]; });
    if (!any.length) { return true; }
    return !!f.kinds[PS.layerKindClass(l)];
};

// Display rows with the filter applied: groups stay when anything inside matches
PS.filteredDisplayList = function () {
    var rows = PS.layerDisplayList();
    if (!PS.layerFilter.on) { return rows; }
    return rows.filter(function (r) {
        if (r.layer.kind !== "group") { return PS.layerPassesFilter(r.layer); }
        if (PS.layerPassesFilter(r.layer)) { return true; }
        var hit = false;
        PS.eachLayer(function (c) { if (c.kind !== "group" && PS.layerPassesFilter(c)) { hit = true; return false; } }, r.layer);
        return hit;
    });
};

PS.FILTER_ICONS = {
    pixel: ['<svg viewBox="0 0 24 24" stroke-width="1.6"><rect x="4" y="5" width="16" height="14"/><path d="M4 16l5-5 4 4 3-3 4 4"/></svg>', "Pixel layers"],
    adjustment: ['<svg viewBox="0 0 24 24" stroke-width="1.6"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>', "Adjustment and fill layers"],
    type: ['<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg>', "Type layers"],
    shape: ['<svg viewBox="0 0 24 24" stroke-width="1.6"><rect x="4" y="4" width="16" height="16"/><path d="M4 4l3 3M20 4l-3 3M4 20l3-3M20 20l-3-3"/></svg>', "Shape layers"],
    smart: ['<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M5 4h10l4 4v12H5z"/><path d="M9 14l3-3 3 3"/></svg>', "Smart objects"]
};

PS.renderLayersPanel = function () {
    var body = PS.el("panel-layers-body");
    if (!body) { return; }
    var d = PS.doc;
    var scrollTop = 0;
    var oldList = PS.el("layers-list");
    if (oldList) { scrollTop = oldList.scrollTop; }
    body.innerHTML = "";
    body.classList.add("layers-panel");

    // -- filter bar
    var f = PS.layerFilter;
    var fb = document.createElement("div");
    fb.className = "lp-filter" + (f.on ? " on" : "");
    var modeSel = PS.selectInput([{ v: "kind", l: "Kind" }, { v: "name", l: "Name" }], f.mode);
    modeSel.className = "lp-filter-mode";
    modeSel.addEventListener("change", function () { f.mode = modeSel.value; f.on = true; PS.renderLayersPanel(); });
    fb.appendChild(modeSel);
    var fh = document.createElement("div");
    fh.className = "lp-filter-host";
    if (f.mode === "name") {
        var ni = document.createElement("input");
        ni.className = "lp-filter-name";
        ni.placeholder = "Layer name";
        ni.value = f.name;
        ni.addEventListener("input", function () {
            f.name = ni.value; f.on = true;
            var pos = ni.selectionStart;
            PS.renderLayersPanel();
            var again = document.querySelector(".lp-filter-name");
            if (again) { again.focus(); again.setSelectionRange(pos, pos); }
        });
        ni.addEventListener("keydown", function (e) { e.stopPropagation(); });
        fh.appendChild(ni);
    } else {
        Object.keys(PS.FILTER_ICONS).forEach(function (k) {
            var b = document.createElement("button");
            b.className = "lp-filter-btn" + (f.kinds[k] ? " on" : "");
            b.innerHTML = PS.FILTER_ICONS[k][0];
            b.title = "Filter for " + PS.FILTER_ICONS[k][1].toLowerCase();
            b.addEventListener("click", function () { f.kinds[k] = !f.kinds[k]; f.on = true; PS.renderLayersPanel(); });
            fh.appendChild(b);
        });
    }
    fb.appendChild(fh);
    var sw = document.createElement("button");
    sw.className = "lp-filter-switch" + (f.on ? " on" : "");
    sw.title = f.on ? "Turn layer filtering off" : "Turn layer filtering on";
    sw.addEventListener("click", function () { f.on = !f.on; PS.renderLayersPanel(); });
    fb.appendChild(sw);
    body.appendChild(fb);

    var active = d ? PS.activeLayer() : null;

    // -- blend mode / opacity
    var row1 = document.createElement("div");
    row1.className = "lp-controls";
    var blendSel = PS.selectInput(PS.blendModeOptions(active && active.kind === "group"), active ? active.blend : "normal");
    blendSel.className = "lp-blend";
    blendSel.title = "Blend mode";
    blendSel.disabled = !active;
    blendSel.addEventListener("change", function () { PS.setLayerBlend(PS.activeLayer(), blendSel.value); });
    row1.appendChild(blendSel);
    row1.appendChild(PS.scrubField("Opacity", "opacity", active));
    body.appendChild(row1);

    // -- locks / fill
    var row2 = document.createElement("div");
    row2.className = "lp-controls";
    var lockLab = document.createElement("span");
    lockLab.className = "lp-label";
    lockLab.textContent = "Lock:";
    row2.appendChild(lockLab);
    [
        ["transparency", PS.ICONS.lockAlpha, "Lock transparent pixels"],
        ["pixels", PS.ICONS.lockPixels, "Lock image pixels"],
        ["position", PS.ICONS.lockPosition, "Lock position"],
        ["all", PS.ICONS.lock, "Lock all"]
    ].forEach(function (def) {
        var b = document.createElement("button");
        b.className = "lock-btn";
        b.innerHTML = def[1];
        b.title = def[2];
        var on = active ? (def[0] === "all" ? PS.isFullyLocked(active) : !!active.locks[def[0]]) : false;
        if (on) { b.classList.add("on"); }
        b.disabled = !active;
        b.addEventListener("click", function () { PS.setLock(PS.activeLayer(), def[0], !on); });
        row2.appendChild(b);
    });
    var spacer = document.createElement("span");
    spacer.style.flex = "1 1 auto";
    row2.appendChild(spacer);
    row2.appendChild(PS.scrubField("Fill", "fillOpacity", active && active.kind !== "group" ? active : null));
    body.appendChild(row2);

    // -- rows
    var list = document.createElement("div");
    list.id = "layers-list";
    if (d) {
        var sel = PS.selectedLayers();
        PS.filteredDisplayList().forEach(function (r) {
            list.appendChild(PS._buildLayerRow(r.layer, r.depth, sel));
            var fxList = PS.listEffects(r.layer.effects);
            if (fxList.length && r.layer._fxOpen !== false) {
                list.appendChild(PS._buildEffectsRows(r.layer, r.depth, fxList));
            }
        });
        // dropping below the last row moves a layer to the bottom of the stack
        var tail = document.createElement("div");
        tail.className = "layers-tail";
        tail.addEventListener("dragover", function (e) {
            if (!PS._draggedLayer) { return; }
            e.preventDefault();
            tail.classList.add("drag-over");
        });
        tail.addEventListener("dragleave", function () { tail.classList.remove("drag-over"); });
        tail.addEventListener("drop", function (e) {
            e.preventDefault();
            tail.classList.remove("drag-over");
            var dragged = PS._draggedLayer;
            if (dragged) { PS.moveLayerTo(dragged, d.root, 0); }
        });
        list.appendChild(tail);
    }
    body.appendChild(list);
    list.scrollTop = scrollTop;

    // -- footer
    var footer = document.createElement("div");
    footer.className = "layers-footer";
    [
        [PS.ICONS.chain, "Link layers", function () { PS.linkSelectedLayers(); }],
        [PS.ICONS.fx, "Add a layer style", function (e) { PS.showLayerStyleMenu(e.currentTarget); }],
        [PS.ICONS.mask, "Add layer mask (Alt: hide all)", function (e) {
            var a = PS.activeLayer();
            if (!a) { return; }
            if (a.mask) { PS.toast("This layer already has a mask", true); return; }
            PS.addLayerMask(e.altKey ? (d.selection ? "hideSelection" : "hide") : null);
        }],
        [PS.ICONS.adjust, "Create new fill or adjustment layer", function (e) { PS.showNewAdjustmentMenu(e.currentTarget); }],
        [PS.ICONS.folder, "Create a new group (Ctrl+G groups the selected layers)", function () { PS.newGroup(); }],
        [PS.ICONS.newLayer, "Create a new layer (Ctrl+Shift+N)", function () { PS.addLayer(); }],
        [PS.ICONS.trash, "Delete layer", function () { PS.deleteSelectedLayers(); }]
    ].forEach(function (def) {
        var btn = document.createElement("button");
        btn.innerHTML = def[0];
        btn.title = def[1];
        btn.disabled = !d;
        btn.addEventListener("click", def[2]);
        footer.appendChild(btn);
    });
    body.appendChild(footer);

    PS.updateLayerThumbs();
};

// "Opacity: [100%][v]" - a value field: type a value, drag the
// label left / right (scrubby slider) or open the pop-up slider. A whole
// drag or burst of steps is one undo entry.
PS.scrubField = function (label, prop, layer) {
    var wrap = document.createElement("span");
    wrap.className = "lp-scrub" + (layer ? "" : " disabled");
    var lab = document.createElement("span");
    lab.className = "lp-label scrubby";
    lab.textContent = label + ":";
    lab.title = "Drag left or right to change";
    var num = document.createElement("input");
    num.className = "lp-num";
    num.value = layer ? Math.round(layer[prop] * 100) + "%" : "";
    num.disabled = !layer;
    var arrow = document.createElement("button");
    arrow.className = "lp-arrow";
    arrow.innerHTML = '<svg viewBox="0 0 10 10"><path d="M2 3.5h6L5 7z" fill="currentColor"/></svg>';
    arrow.disabled = !layer;
    wrap.appendChild(lab);
    wrap.appendChild(num);
    wrap.appendChild(arrow);
    if (!layer) { return wrap; }

    var startVal = null, commitTimer = null;
    function setVal(pct) {
        pct = PS.clamp(Math.round(pct), 0, 100);
        if (startVal === null) { startVal = layer[prop]; }
        layer[prop] = pct / 100;
        num.value = pct + "%";
        PS.requestRender();
    }
    function commit() {
        if (commitTimer) { clearTimeout(commitTimer); commitTimer = null; }
        var oldV = startVal;
        startVal = null;
        if (oldV === null || oldV === layer[prop]) { return; }
        var newV = layer[prop];
        PS.pushHistory(label === "Fill" ? "Fill Opacity" : "Layer Opacity",
            function () { layer[prop] = oldV; },
            function () { layer[prop] = newV; });
    }
    function commitSoon() {
        if (commitTimer) { clearTimeout(commitTimer); }
        commitTimer = setTimeout(commit, 500);
    }
    num.addEventListener("keydown", function (e) {
        e.stopPropagation();
        if (e.key === "Enter") { num.blur(); }
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            setVal(Math.round(layer[prop] * 100) + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1));
            commitSoon();
        }
    });
    num.addEventListener("change", function () {
        var v = parseFloat(num.value);
        if (isNaN(v)) { num.value = Math.round(layer[prop] * 100) + "%"; return; }
        setVal(v);
        commit();
    });
    num.addEventListener("focus", function () { num.select(); });
    PS.ui.wheelStep(num, 0, 100, 1, function (v) { setVal(v); commitSoon(); });
    num.addEventListener("wheel", function () { /* handled by wheelStep */ });
    // scrubby label
    lab.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        lab.setPointerCapture(e.pointerId);
        var x0 = e.clientX, v0 = layer[prop] * 100;
        function move(ev) { setVal(v0 + (ev.clientX - x0) * (ev.shiftKey ? 2 : 0.5)); }
        function up() {
            lab.removeEventListener("pointermove", move);
            lab.removeEventListener("pointerup", up);
            commit();
        }
        lab.addEventListener("pointermove", move);
        lab.addEventListener("pointerup", up);
    });
    // pop-up slider
    arrow.addEventListener("click", function (e) {
        e.stopPropagation();
        var pop = document.createElement("div");
        pop.className = "lp-popup";
        var r = document.createElement("input");
        r.type = "range";
        r.min = 0; r.max = 100;
        r.value = Math.round(layer[prop] * 100);
        r.addEventListener("input", function () { setVal(parseFloat(r.value)); });
        r.addEventListener("change", commit);
        pop.appendChild(r);
        document.body.appendChild(pop);
        var ar = arrow.getBoundingClientRect();
        pop.style.left = Math.max(4, Math.min(window.innerWidth - 170, ar.right - 160)) + "px";
        pop.style.top = (ar.bottom + 2) + "px";
        setTimeout(function () {
            function away(ev) {
                if (pop.contains(ev.target)) { return; }
                pop.remove();
                document.removeEventListener("pointerdown", away, true);
                commit();
            }
            document.addEventListener("pointerdown", away, true);
        }, 0);
    });
    return wrap;
};

// Thumbnail element of a layer row (canvas, or icon thumbnails)
PS._layerThumb = function (layer, isActive) {
    var d = PS.doc;
    var wrap = document.createElement("div");
    wrap.className = "layer-thumb" + (isActive && !d.editMask ? " targeted" : "");
    if (layer.kind === "adjustment") {
        wrap.classList.add("icon-thumb");
        wrap.innerHTML = (PS.ADJ_PANEL_ICONS && PS.ADJ_PANEL_ICONS[layer.adjustment && layer.adjustment.type]) || PS.ICONS.adjust;
    } else if (layer.kind === "text") {
        wrap.classList.add("type-thumb");
        wrap.innerHTML = '<span>T</span>';
    } else if (layer.kind === "fill") {
        var sw = document.createElement("canvas");
        sw.className = "content-thumb fill-thumb";
        sw.width = 32; sw.height = 32;
        wrap.appendChild(sw);
    } else {
        var thumb = document.createElement("canvas");
        thumb.className = "content-thumb";
        thumb.width = 32; thumb.height = 32;
        wrap.appendChild(thumb);
        if (layer.kind === "smart" || layer.kind === "shape") {
            var badge = document.createElement("span");
            badge.className = "thumb-badge";
            badge.innerHTML = layer.kind === "smart" ? PS.ICONS.smart : PS.ICONS.shape;
            wrap.appendChild(badge);
        }
    }
    return wrap;
};

PS._buildLayerRow = function (layer, depth, sel) {
    var d = PS.doc;
    var row = document.createElement("div");
    var isActive = layer === d.active;
    row.className = "layer-row"
        + (isActive ? " active" : "")
        + (sel.length > 1 && sel.indexOf(layer) >= 0 ? " selected" : "")
        + (layer.kind === "group" ? " group-row" : "")
        + (!PS.isEffectivelyVisible(layer) ? " hidden-layer" : "");
    if (layer.color && layer.color !== "none") { row.dataset.color = layer.color; }
    row.dataset.id = layer.id;
    row.draggable = true;

    var eye = document.createElement("div");
    eye.className = "layer-eye";
    eye.innerHTML = layer.visible ? PS.ICONS.eye : "";
    eye.title = "Indicates layer visibility (Alt+click: show only this layer)";
    eye.addEventListener("click", function (e) {
        e.stopPropagation();
        PS.toggleLayerVisible(layer, e.altKey);
    });
    row.appendChild(eye);

    var content = document.createElement("div");
    content.className = "layer-content";
    content.style.paddingLeft = (4 + depth * 16) + "px";
    row.appendChild(content);

    if (layer.kind === "group") {
        var disc = document.createElement("span");
        disc.className = "layer-disclosure";
        disc.innerHTML = layer.open ? '<svg viewBox="0 0 10 10"><path d="M1.5 3h7L5 7.5z" fill="currentColor"/></svg>'
            : '<svg viewBox="0 0 10 10"><path d="M3 1.5v7L7.5 5z" fill="currentColor"/></svg>';
        disc.title = layer.open ? "Collapse group" : "Expand group";
        disc.addEventListener("click", function (e) {
            e.stopPropagation();
            if (e.altKey) {
                // Alt: open / close every group inside as well
                var to = !layer.open;
                layer.open = to;
                PS.eachLayer(function (c) { if (c.kind === "group") { c.open = to; } }, layer);
                PS.renderLayersPanel();
                return;
            }
            PS.toggleGroupOpen(layer);
        });
        content.appendChild(disc);
        var folder = document.createElement("span");
        folder.className = "layer-folder";
        folder.innerHTML = '<svg viewBox="0 0 24 24"><path d="M2.5 6.5h7l2 2h10v10.5h-19z" fill="#d7d7d7" stroke="#3a3a3a" stroke-width="1"/></svg>';
        content.appendChild(folder);
    } else {
        if (layer.clipping) {
            var clip = document.createElement("span");
            clip.className = "layer-clip";
            clip.innerHTML = PS.ICONS.clipArrow;
            clip.title = "Clipped to the layer below";
            content.appendChild(clip);
        }
        var thumbWrap = PS._layerThumb(layer, isActive);
        thumbWrap.title = layer.kind === "adjustment" || layer.kind === "fill"
            ? "Double-click to edit the settings" : "Ctrl+click: load as selection";
        thumbWrap.addEventListener("click", function (e) {
            e.stopPropagation();
            if (e.ctrlKey || e.metaKey) {
                PS.loadLayerSelection(layer, e.shiftKey ? (e.altKey ? "intersect" : "add") : (e.altKey ? "subtract" : "replace"));
                return;
            }
            if (e.shiftKey) { PS.selectLayerFromClick(layer, e); return; }
            PS.clearLayerSelection();
            PS.doc.active = layer;
            PS.doc.editMask = false;
            PS.setActiveLayer(layer, true);
        });
        thumbWrap.addEventListener("dblclick", function (e) {
            e.stopPropagation();
            PS.editLayerContent(layer);
        });
        content.appendChild(thumbWrap);
    }

    // mask (link + thumbnail)
    if (layer.mask) {
        var link = document.createElement("span");
        link.className = "layer-link" + (layer.mask.linked === false ? " off" : "");
        link.innerHTML = PS.ICONS.chain;
        link.title = "Mask linked to the layer (click to toggle)";
        link.addEventListener("click", function (e) {
            e.stopPropagation();
            PS.toggleMaskLinked(layer);
        });
        content.appendChild(link);

        var mwrap = document.createElement("div");
        mwrap.className = "layer-thumb mask-wrap" + (isActive && d.editMask ? " targeted" : "")
            + (layer.mask.enabled === false ? " disabled" : "");
        var mthumb = document.createElement("canvas");
        mthumb.className = "mask-thumb";
        mthumb.width = 32; mthumb.height = 32;
        mwrap.appendChild(mthumb);
        mwrap.title = "Layer mask: click to paint on it, Shift+click to disable, Alt+click to view, Ctrl+click to load as selection";
        mwrap.addEventListener("click", function (e) {
            e.stopPropagation();
            if (e.ctrlKey || e.metaKey) { PS.loadMaskSelection(layer); return; }
            if (e.shiftKey) { PS.toggleMaskEnabled(layer); return; }
            if (e.altKey) { PS.toggleMaskView(layer); return; }
            PS.clearLayerSelection();
            PS.doc.active = layer;
            PS.doc.editMask = true;
            PS.setActiveLayer(layer, true);
        });
        mwrap.addEventListener("dblclick", function (e) {
            e.stopPropagation();
            PS.doc.active = layer;
            PS.doc.editMask = true;
            if (PS.showMaskProperties) { PS.showMaskProperties(layer); }
        });
        content.appendChild(mwrap);
    }
    if (layer.vmask && layer.kind !== "shape") {
        var vwrap = document.createElement("div");
        vwrap.className = "layer-thumb vmask-wrap" + (layer.vmask.enabled === false ? " disabled" : "");
        vwrap.innerHTML = PS.ICONS.shape;
        vwrap.title = "Vector mask (Shift+click to disable)";
        vwrap.addEventListener("click", function (e) {
            e.stopPropagation();
            if (e.shiftKey) { PS.toggleVectorMaskEnabled(layer); }
        });
        content.appendChild(vwrap);
    }

    var name = document.createElement("div");
    var isBackground = layer.name === "Background" && PS.doc.root.children[0] === layer && layer.kind === "raster";
    name.className = "layer-name" + (isBackground ? " background-name" : "");
    name.textContent = layer.name;
    name.title = "Double-click to rename";
    content.appendChild(name);

    // badges: link, fx, lock
    var badges = document.createElement("span");
    badges.className = "layer-badges";
    if (layer.link) {
        var lk0 = document.createElement("span");
        lk0.className = "layer-linked";
        lk0.innerHTML = PS.ICONS.chain;
        lk0.title = "Linked with other layers";
        badges.appendChild(lk0);
    }
    if (PS.listEffects(layer.effects).length) {
        var fx = document.createElement("span");
        fx.className = "layer-fx" + (layer.effects.disabled ? " off" : "");
        fx.innerHTML = '<span class="fx-text">fx</span>' + (layer._fxOpen === false
            ? '<svg viewBox="0 0 10 10"><path d="M3 1.5v7L7.5 5z" fill="currentColor"/></svg>'
            : '<svg viewBox="0 0 10 10"><path d="M1.5 3h7L5 7.5z" fill="currentColor"/></svg>');
        fx.title = "Layer style - click to show / hide the effects, double-click to edit";
        fx.addEventListener("click", function (e) {
            e.stopPropagation();
            layer._fxOpen = layer._fxOpen === false;
            PS.renderLayersPanel();
        });
        fx.addEventListener("dblclick", function (e) {
            e.stopPropagation();
            PS.setActiveLayer(layer);
            if (PS.openLayerStyleDialog) { PS.openLayerStyleDialog(); }
        });
        badges.appendChild(fx);
    }
    if (layer.locks.transparency || layer.locks.pixels || layer.locks.position || isBackground) {
        var lk = document.createElement("span");
        lk.className = "layer-lock" + (PS.isFullyLocked(layer) ? " full" : "");
        lk.innerHTML = PS.ICONS.lock;
        lk.title = "Locked";
        badges.appendChild(lk);
    }
    content.appendChild(badges);

    row.addEventListener("click", function (e) { PS.selectLayerFromClick(layer, e); });

    row.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        if (PS.selectedLayers().indexOf(layer) < 0) { PS.clearLayerSelection(); }
        PS.setActiveLayer(layer);
        PS.showLayerContextMenu(e.clientX, e.clientY);
    });

    name.addEventListener("dblclick", function (e) {
        e.stopPropagation();
        name.innerHTML = "";
        var inp = document.createElement("input");
        inp.value = layer.name;
        name.appendChild(inp);
        inp.focus();
        inp.select();
        function done() { PS.renameLayer(layer, inp.value.trim()); PS.renderLayersPanel(); }
        inp.addEventListener("blur", done);
        inp.addEventListener("click", function (ev) { ev.stopPropagation(); });
        inp.addEventListener("keydown", function (ev) {
            ev.stopPropagation();
            if (ev.key === "Enter") { inp.blur(); }
            if (ev.key === "Escape") { inp.removeEventListener("blur", done); PS.renderLayersPanel(); }
        });
    });
    // double-click elsewhere on the row: Layer Style
    row.addEventListener("dblclick", function () {
        PS.setActiveLayer(layer);
        if (layer.kind === "adjustment" || layer.kind === "fill") { PS.editLayerContent(layer); return; }
        if (PS.openLayerStyleDialog) { PS.openLayerStyleDialog(); }
    });

    // drag to reorder / into groups
    row.addEventListener("dragstart", function (e) {
        PS._draggedLayer = layer;
        e.dataTransfer.setData("text/plain", String(layer.id));
        e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", function () { PS._draggedLayer = null; });
    function zone(e) {
        var rect = row.getBoundingClientRect();
        var t = (e.clientY - rect.top) / rect.height;
        if (layer.kind === "group" && t > 0.3 && t < 0.7) { return "into"; }
        return t < 0.5 ? "above" : "below";
    }
    row.addEventListener("dragover", function (e) {
        // files dragged in from outside are handled by the window
        if (!PS._draggedLayer) { return; }
        e.preventDefault();
        var z = zone(e);
        row.classList.toggle("drag-over-top", z === "above");
        row.classList.toggle("drag-over-bottom", z === "below");
        row.classList.toggle("drag-over-into", z === "into");
    });
    row.addEventListener("dragleave", function () {
        row.classList.remove("drag-over-top", "drag-over-bottom", "drag-over-into");
    });
    row.addEventListener("drop", function (e) {
        e.preventDefault();
        row.classList.remove("drag-over-top", "drag-over-bottom", "drag-over-into");
        var dragged = PS._draggedLayer;
        PS._draggedLayer = null;
        if (!dragged || dragged === layer) { return; }
        var z = zone(e);
        if (z === "into") {
            PS.moveLayerTo(dragged, layer, layer.children.length);
            return;
        }
        var loc = PS.locateLayer(layer);
        // rows are listed top first: "above" means a higher index
        if (z === "below" && layer.kind === "group" && layer.open && layer.children.length) {
            // just below an open group's header: the top of the group
            PS.moveLayerTo(dragged, layer, layer.children.length);
            return;
        }
        PS.moveLayerTo(dragged, loc.parent, z === "above" ? loc.index + 1 : loc.index);
    });

    return row;
};

/* ---------- linked layers ---------- */

// Link the selected layers so they move together (or unlink them)
PS.linkSelectedLayers = function () {
    var sel = PS.selectedLayers();
    if (sel.length < 2) {
        var a = PS.activeLayer();
        if (a && a.link) {
            PS.layerPropChange("Unlink Layer", a, a.link, 0, function (l, v) { l.link = v; });
        } else {
            PS.toast("Select two or more layers to link", true);
        }
        return;
    }
    var allLinked = sel.every(function (l) { return l.link && l.link === sel[0].link; });
    var before = sel.map(function (l) { return l.link || 0; });
    var id = allLinked ? 0 : (PS._linkSeq = (PS._linkSeq || 100) + 1);
    sel.forEach(function (l) { l.link = id; });
    PS.pushHistory(allLinked ? "Unlink Layers" : "Link Layers",
        function () { sel.forEach(function (l, i) { l.link = before[i]; }); },
        function () { sel.forEach(function (l) { l.link = id; }); });
    PS.renderLayersPanel();
};

// The given layers plus every layer linked to one of them
PS.withLinkedLayers = function (layers) {
    var ids = {};
    layers.forEach(function (l) { if (l.link) { ids[l.link] = true; } });
    var out = layers.slice();
    if (!Object.keys(ids).length) { return out; }
    PS.eachLayer(function (l) { if (l.link && ids[l.link] && out.indexOf(l) < 0) { out.push(l); } });
    return out;
};

/* ---------- selections from layers (Ctrl+click a thumbnail) ---------- */

PS.loadLayerSelection = function (layer, mode) {
    var d = PS.doc;
    var mask = PS.makeMaskCanvas();
    var ctx = mask.getContext("2d");
    if (layer.kind === "group") {
        ctx.drawImage(PS.renderer.compositeCanvas([layer]), 0, 0);
    } else if (layer.canvas) {
        ctx.drawImage(layer.canvas, 0, 0);
    } else {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, d.width, d.height);
    }
    // keep only the alpha as white coverage
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, d.width, d.height);
    PS.setSelection(mask, mode || "replace", "Load Selection");
};

PS.loadMaskSelection = function (layer) {
    if (!layer.mask) { return; }
    PS.setSelection(PS.maskToAlphaCanvas(layer.mask), "replace", "Load Selection");
};

// "Effects" sub-rows under a styled layer, each with its own visibility eye
PS._buildEffectsRows = function (layer, depth, fxList) {
    var wrap = document.createElement("div");
    wrap.className = "fx-rows" + (layer.effects.disabled ? " off" : "");
    var head = document.createElement("div");
    head.className = "fx-row";
    var eye = document.createElement("div");
    eye.className = "layer-eye";
    eye.innerHTML = layer.effects.disabled ? "" : PS.ICONS.eye;
    eye.title = "Show / hide all effects";
    eye.addEventListener("click", function (e) { e.stopPropagation(); PS.toggleEffectsVisible(layer); });
    head.appendChild(eye);
    var lab = document.createElement("span");
    lab.className = "fx-label";
    lab.style.paddingLeft = (depth * 14 + 30) + "px";
    lab.textContent = "Effects";
    head.appendChild(lab);
    head.addEventListener("dblclick", function () {
        PS.setActiveLayer(layer);
        if (PS.openLayerStyleDialog) { PS.openLayerStyleDialog(); }
    });
    wrap.appendChild(head);

    fxList.forEach(function (fx) {
        var r = document.createElement("div");
        r.className = "fx-row" + (fx.entry.enabled === false ? " off" : "");
        var e2 = document.createElement("div");
        e2.className = "layer-eye";
        e2.innerHTML = fx.entry.enabled === false ? "" : PS.ICONS.eye;
        e2.addEventListener("click", function (e) {
            e.stopPropagation();
            PS.toggleEffectEnabled(layer, fx.key, fx.index);
        });
        r.appendChild(e2);
        var l2 = document.createElement("span");
        l2.className = "fx-label";
        l2.style.paddingLeft = (depth * 14 + 42) + "px";
        l2.textContent = fx.name;
        r.appendChild(l2);
        r.addEventListener("dblclick", function () {
            PS.setActiveLayer(layer);
            if (PS.openLayerStyleDialog) { PS.openLayerStyleDialog(fx.key); }
        });
        wrap.appendChild(r);
    });
    return wrap;
};

// Double-click a thumbnail: edit what the layer is made of
PS.editLayerContent = function (layer) {
    PS.setActiveLayer(layer);
    if (layer.kind === "text" && PS.startTextEditOnLayer) {
        PS.setTool("text");
        PS.startTextEditOnLayer(layer);
    } else if ((layer.kind === "adjustment" || layer.kind === "fill") && PS.showLayerProperties) {
        PS.showLayerProperties(layer);
    } else if (layer.kind === "smart" && PS.smartObjectInfo) {
        PS.smartObjectInfo(layer);
    } else if (PS.openLayerStyleDialog) {
        PS.openLayerStyleDialog();
    }
};

// Alt+click on a mask thumbnail: show the mask itself on the canvas
PS.toggleMaskView = function (layer) {
    PS.viewMaskOf = (PS.viewMaskOf === layer) ? null : layer;
    PS.requestRender();
    PS.toast(PS.viewMaskOf ? "Showing the layer mask (Alt+click again to return)" : "Showing the image");
};

// Layer > Layer Style and the fx button of the Layers panel
PS.layerStyleMenuItems = function () {
    var items = [{ label: "Blending Options...", action: function () { PS.openLayerStyleDialog && PS.openLayerStyleDialog("blending"); } }, { sep: true }];
    PS.EFFECT_NAMES.forEach(function (e) {
        items.push({ label: e[1] + "...", action: function () { PS.openLayerStyleDialog && PS.openLayerStyleDialog(e[0], true); } });
    });
    var has = function () { return !!(PS.activeLayer() && PS.activeLayer().effects); };
    items.push({ sep: true },
        { label: "Copy Layer Style", action: function () { PS.copyLayerStyle(); }, enabled: has },
        { label: "Paste Layer Style", action: function () { PS.pasteLayerStyle(); } },
        { label: "Clear Layer Style", action: function () { PS.clearLayerStyle(); }, enabled: has });
    return items;
};

PS.showLayerStyleMenu = function (anchor) {
    var r = anchor.getBoundingClientRect();
    PS.contextMenu(r.left, r.top - 4, PS.layerStyleMenuItems());
};

PS.showNewAdjustmentMenu = function (anchor) {
    var r = anchor.getBoundingClientRect();
    var items = [];
    if (PS.fillLayerMenuItems) { items = items.concat(PS.fillLayerMenuItems()); items.push({ sep: true }); }
    if (PS.adjustmentMenuItems) { items = items.concat(PS.adjustmentMenuItems()); }
    if (!items.length) { return; }
    PS.contextMenu(r.left, r.top - 4, items);
};

// Right-click menu for the layers list
PS.showLayerContextMenu = function (x, y) {
    var layer = PS.activeLayer();
    var sel = PS.selectedLayers();
    var multi = sel.length > 1;
    var loc = PS.locateLayer(layer);

    var items = [
        { label: "Blending Options...", action: function () { PS.openLayerStyleDialog && PS.openLayerStyleDialog("blending"); } },
        { label: multi ? "Duplicate Layers" : "Duplicate Layer", shortcut: "Ctrl+J", action: PS.duplicateLayer },
        {
            label: multi ? "Delete " + sel.length + " Layers" : "Delete Layer",
            action: PS.deleteSelectedLayers
        },
        { sep: true },
        { label: "Group Layers", shortcut: "Ctrl+G", action: PS.groupSelectedLayers },
        {
            label: "Ungroup Layers", shortcut: "Ctrl+Shift+G", action: PS.ungroupLayers,
            enabled: function () { return layer.kind === "group"; }
        },
        { sep: true }
    ];

    if (layer.mask) {
        items.push({ label: layer.mask.enabled === false ? "Enable Layer Mask" : "Disable Layer Mask", action: function () { PS.toggleMaskEnabled(layer); } });
        items.push({ label: "Apply Layer Mask", action: function () { PS.applyLayerMask(layer); } });
        items.push({ label: "Delete Layer Mask", action: function () { PS.deleteLayerMask(layer); } });
        items.push({ label: "Invert Layer Mask", action: function () { PS.invertLayerMask(layer); } });
    } else {
        items.push({ label: "Add Layer Mask", action: function () { PS.addLayerMask(); } });
    }
    if (layer.vmask && layer.kind !== "shape") {
        items.push({ label: "Delete Vector Mask", action: function () { PS.deleteVectorMask(layer); } });
    }
    items.push({
        label: layer.clipping ? "Release Clipping Mask" : "Create Clipping Mask", shortcut: "Ctrl+Alt+G",
        action: function () { PS.toggleClipping(layer); },
        enabled: function () { return layer.clipping || (loc && loc.index > 0); }
    });
    items.push({ sep: true });
    if (layer.effects) {
        items.push({ label: "Copy Layer Style", action: PS.copyLayerStyle });
    }
    if (PS._styleClipboard) {
        items.push({ label: "Paste Layer Style", action: PS.pasteLayerStyle });
    }
    if (layer.effects) {
        items.push({ label: "Clear Layer Style", action: function () { PS.clearLayerStyle(layer); } });
    }
    if (layer.canvas && layer.kind !== "raster") {
        items.push({ label: "Rasterize " + PS.layerKindLabel(layer), action: function () { PS.rasterizeLayer(layer); } });
    }
    items.push({ sep: true });
    if (multi) {
        items.push({ label: "Merge Layers", shortcut: "Ctrl+E", action: PS.mergeSelectedLayers });
    } else {
        items.push({
            label: "Merge Down", shortcut: "Ctrl+E", action: PS.mergeDown,
            enabled: function () { return !!(loc && loc.index > 0); }
        });
    }
    items.push({ label: "Merge Visible", shortcut: "Ctrl+Shift+E", action: PS.mergeVisible });
    items.push({ label: "Flatten Image", action: PS.flattenImage });
    items.push({ sep: true });
    items.push({
        label: "Layer Color...", action: function () {
            var colors = [["none", "No Color"], ["red", "Red"], ["orange", "Orange"], ["yellow", "Yellow"],
                ["green", "Green"], ["blue", "Blue"], ["violet", "Violet"], ["gray", "Gray"]];
            PS.contextMenu(x, y, colors.map(function (c) {
                return {
                    label: c[1], checked: function () { return layer.color === c[0]; },
                    action: function () { PS.setLayerColor(layer, c[0]); }
                };
            }));
        }
    });

    PS.contextMenu(x, y, items);
};
