/*
    Pixel Studio - document I/O bridge

    Talks to the document worker (docio.worker.js) and maps between the
    worker's neutral layer tree and the editor model (model.js):

        PSD / ORA bytes --worker--> {meta, layers, composite} --> PS.doc
        PS.doc --> {doc, layers with ImageBitmaps} --worker--> bytes

    PSD fields the editor does not model are kept on layer.psd and
    doc.psd and written back unchanged.
*/
"use strict";

PS.docio = (function () {
    var worker = null;
    var seq = 0;
    var pending = {};

    function getWorker() {
        if (worker) { return worker; }
        // the version keeps a browser from running a cached older worker
        worker = new Worker("js/docio.worker.js?v=" + encodeURIComponent(PS.VERSION));
        worker.onmessage = function (e) {
            var msg = e.data;
            var p = pending[msg.id];
            if (!p) { return; }
            if (msg.progress !== undefined && msg.ok === undefined) {
                if (p.onProgress) { p.onProgress(msg.progress, msg.stage); }
                return;
            }
            delete pending[msg.id];
            if (msg.ok) { p.resolve(msg.result); } else { p.reject(new Error(msg.error)); }
        };
        worker.onerror = function (e) {
            // a crashed worker fails everything in flight; the next call starts a fresh one
            var err = new Error(e.message || "Document worker failed");
            Object.keys(pending).forEach(function (id) { pending[id].reject(err); });
            pending = {};
            try { worker.terminate(); } catch (x) { /* already gone */ }
            worker = null;
        };
        return worker;
    }

    function call(op, payload, transfer, onProgress) {
        return new Promise(function (resolve, reject) {
            var id = ++seq;
            pending[id] = { resolve: resolve, reject: reject, onProgress: onProgress };
            payload.id = id;
            payload.op = op;
            try {
                getWorker().postMessage(payload, transfer || []);
            } catch (err) {
                delete pending[id];
                reject(err);
            }
        });
    }

    function read(buffer, ext, onProgress) {
        return call(ext === "ora" ? "readOra" : "readPsd", { buffer: buffer }, [buffer], onProgress);
    }

    // Just the flattened image of a PSD / PSB / ORA file
    // a brush file (.abr): {brushes, samples}
    function readAbr(buffer) {
        return call("readAbr", { buffer: buffer }, [buffer]);
    }

    function readComposite(buffer, ext) {
        return call("readComposite", { buffer: buffer, format: ext === "ora" ? "ora" : "psd" }, [buffer]);
    }

    function write(job, onProgress) {
        var transfer = [];
        function collect(nodes) {
            (nodes || []).forEach(function (n) {
                if (n.pixels && n.pixels.bitmap) { transfer.push(n.pixels.bitmap); }
                if (n.mask && n.mask.bitmap) { transfer.push(n.mask.bitmap); }
                collect(n.children);
            });
        }
        collect(job.layers);
        if (job.composite) { transfer.push(job.composite); }
        return call(job.format === "ora" ? "writeOra" : "writePsd", job, transfer, onProgress);
    }

    return { read: read, readComposite: readComposite, readAbr: readAbr, write: write };
})();

/* ============================================================
   IMPORT: worker tree -> document model
   ============================================================ */

// Fields of an ag-psd layer the model represents itself; everything else is
// carried through layer.psd
PS.PSD_MODELED_FIELDS = [
    "name", "hidden", "opacity", "fillOpacity", "blendMode", "clipping", "protected",
    "transparencyProtected", "layerColor", "effects", "blendingRanges", "opened", "mask",
    "realMask", "vectorMask", "adjustment", "text", "vectorFill", "vectorStroke", "placedLayer",
    "top", "left", "bottom", "right", "sectionDivider", "children", "imageData", "canvas",
    "linkGroup", "linkGroupEnabled"
];

// Newer PSD blend modes the editor has no equivalent for
PS.PSD_EXTRA_BLENDS = { "linear height": 1, "height": 1, "subtraction": 1 };

PS.putPixelBlock = function (canvas, block) {
    if (!block || !block.width || !block.height) { return; }
    var img = new ImageData(new Uint8ClampedArray(block.data.buffer, block.data.byteOffset, block.width * block.height * 4),
        block.width, block.height);
    canvas.getContext("2d").putImageData(img, block.left, block.top);
};

PS.blockCanvas = function (block) {
    var c = PS.createCanvas(block.width, block.height);
    PS.putPixelBlock(c, { left: 0, top: 0, width: block.width, height: block.height, data: block.data });
    return c;
};

PS.loadDecodedDocument = function (result, filepath, filename) {
    var meta = result.meta || {};
    var W = meta.width, H = meta.height;
    if (!(W > 0 && H > 0)) { PS.toast("The file has no image size", true); return; }
    if (W > PS.MAX_DOC_SIZE || H > PS.MAX_DOC_SIZE) {
        PS.toast("Documents larger than " + PS.MAX_DOC_SIZE + " px cannot be edited here (" + W + " x " + H + ")", true);
        return;
    }
    var maxTex = PS.gpu && PS.gpu.gl ? PS.gpu.maxSize() : PS.MAX_DOC_SIZE;
    if (W > maxTex || H > maxTex) {
        PS.toast("This graphics card cannot hold a " + W + " x " + H + " document", true);
        return;
    }

    var doc = PS.makeDocument(W, H, { name: filename, filePath: filepath, format: result.format });
    var notes = [];
    PS.doc = doc;   // the converters below read PS.doc for the document size

    if (result.format === "ora") {
        PS.importOraTree(result, doc, notes);
    } else {
        PS.importPsdTree(result, doc, notes);
    }

    if (!doc.root.children.length) {
        // no layers at all: the file only holds its flat composite
        var bg = PS.makeLayer("Background", W, H);
        if (result.composite) { PS.putPixelBlock(bg.canvas, result.composite); }
        doc.root.children.push(bg);
    }
    var all = PS.allLayers();
    doc.active = all.length ? doc.root.children[doc.root.children.length - 1] : null;
    doc.importNotes = notes;
    doc.lossyImport = notes.some(function (n) { return n.lossy; });

    PS.startDocument("Open");
    if (notes.length) { PS.showImportNotes(notes); }
};

PS.importPsdTree = function (result, doc, notes) {
    var meta = result.meta;
    doc.psd = meta;
    var ir = meta.imageResources || {};
    if (typeof ir.globalAngle === "number") { doc.globalAngle = ir.globalAngle; }
    if (typeof ir.globalAltitude === "number") { doc.globalAltitude = ir.globalAltitude; }
    if (ir.gridAndGuidesInformation && ir.gridAndGuidesInformation.guides) {
        ir.gridAndGuidesInformation.guides.forEach(function (g) {
            if (g.direction === "horizontal") { doc.guides.h.push(g.location); }
            else { doc.guides.v.push(g.location); }
        });
    }
    if (meta.bitsPerChannel && meta.bitsPerChannel !== 8) {
        notes.push({ lossy: true, text: meta.bitsPerChannel + "-bit color was converted to 8 bits per channel" });
    }
    if (meta.colorMode !== undefined && meta.colorMode !== 3) {
        notes.push({ lossy: true, text: "The document was converted to RGB color" });
    }
    if (meta.annotations && PS.notesFromPsd) {
        var an = PS.notesFromPsd(meta.annotations);
        doc.notes = an.notes;
        doc.psdOtherNotes = an.other;
        delete meta.annotations;
    }
    if (meta.artboards || PS.psdHasArtboards(result.layers)) {
        notes.push({ lossy: false, text: "Artboards are shown as groups" });
    }
    doc.root.children = (result.layers || []).map(function (n) { return PS.layerFromPsdNode(n, notes); });
};

PS.psdHasArtboards = function (nodes) {
    return (nodes || []).some(function (n) {
        return (n.meta && n.meta.artboard) || PS.psdHasArtboards(n.children);
    });
};

PS.layerFromPsdNode = function (node, notes) {
    var d = PS.doc;
    var m = node.meta || {};
    var kind = "raster";
    if (node.children) { kind = "group"; }
    else if (m.adjustment) { kind = "adjustment"; }
    else if (m.text) { kind = "text"; }
    else if (m.placedLayer) { kind = "smart"; }
    else if (m.vectorFill) {
        kind = (m.vectorMask && m.vectorMask.paths && m.vectorMask.paths.length) ? "shape" : "fill";
    }

    var layer = kind === "group" ? PS.makeGroup(m.name || "Group") : PS.makeLayer(m.name || "Layer", d.width, d.height, kind);
    layer.name = m.name || layer.name;
    layer.visible = !m.hidden;
    layer.opacity = typeof m.opacity === "number" ? m.opacity : 1;
    layer.fillOpacity = typeof m.fillOpacity === "number" ? m.fillOpacity : 1;
    var blend = m.blendMode || (kind === "group" ? "pass through" : "normal");
    if (PS.blendModeIndex[blend] === undefined) {
        notes.push({ lossy: true, text: "\"" + layer.name + "\": blend mode \"" + blend + "\" is shown as Normal" });
        blend = "normal";
    }
    layer.blend = blend;
    layer.clipping = !!m.clipping;
    var prot = m.protected || {};
    layer.locks = {
        transparency: !!(prot.transparency || m.transparencyProtected),
        pixels: !!prot.composite,
        position: !!prot.position
    };
    layer.color = m.layerColor || "none";
    layer.link = (m.linkGroup && m.linkGroupEnabled !== false) ? m.linkGroup : 0;
    layer.effects = m.effects ? PS.deepCopy(m.effects) : null;
    layer.blendIf = m.blendingRanges ? PS.deepCopy(m.blendingRanges) : null;
    if (layer.effects && layer.effects.disabled === undefined) { layer.effects.disabled = false; }

    // pixels (and anything beyond the canvas edge)
    if (layer.canvas && node.pixels) {
        var px = node.pixels;
        PS.putPixelBlock(layer.canvas, px);
        if (px.left < 0 || px.top < 0 || px.left + px.width > d.width || px.top + px.height > d.height) {
            layer.offcanvas = { canvas: PS.blockCanvas(px), left: px.left, top: px.top };
        }
    }

    // user mask: when a vector mask is present the file stores the user
    // mask as the "real" mask and the first mask record is the vector one
    var maskBlock = null, maskMeta = null;
    if (node.realMask && m.realMask) { maskBlock = node.realMask; maskMeta = m.realMask; }
    else if (m.mask && !m.mask.fromVectorData) { maskBlock = node.mask; maskMeta = m.mask; }
    if (maskMeta && (maskBlock || maskMeta.defaultColor !== undefined)) {
        var def = maskMeta.defaultColor === undefined ? 255 : maskMeta.defaultColor;
        var mask = PS.makeMask(d.width, d.height, def);
        if (maskBlock) { PS.putPixelBlock(mask.canvas, maskBlock); }
        mask.enabled = !maskMeta.disabled;
        mask.density = typeof maskMeta.userMaskDensity === "number" ? maskMeta.userMaskDensity : 1;
        mask.feather = typeof maskMeta.userMaskFeather === "number" ? maskMeta.userMaskFeather : 0;
        mask.psd = maskMeta;
        layer.mask = mask;
    }
    if (m.vectorMask && m.vectorMask.paths) {
        layer.vmask = {
            paths: PS.deepCopy(m.vectorMask.paths),
            invert: !!m.vectorMask.invert,
            linked: !m.vectorMask.notLink,
            enabled: !m.vectorMask.disable,
            density: typeof (m.mask && m.mask.vectorMaskDensity) === "number" ? m.mask.vectorMaskDensity : 1,
            feather: (m.mask && m.mask.vectorMaskFeather) || 0,
            psd: PS.deepCopy(m.vectorMask),
            rev: 1
        };
    }

    if (kind === "group") {
        layer.open = m.opened !== false;
        layer.children = node.children.map(function (c) { return PS.layerFromPsdNode(c, notes); });
        if (m.artboard) { layer.artboard = PS.deepCopy(m.artboard); }
    } else if (kind === "adjustment") {
        layer.adjustment = PS.deepCopy(m.adjustment);
    } else if (kind === "text") {
        layer.text = PS.textFromPsd ? PS.textFromPsd(m.text, layer) : { psd: m.text };
    } else if (kind === "smart") {
        layer.smart = PS.deepCopy(m.placedLayer);
    } else if (kind === "fill" || kind === "shape") {
        layer.fill = PS.deepCopy(m.vectorFill);
        layer.stroke = m.vectorStroke ? PS.deepCopy(m.vectorStroke) : null;
        if (kind === "fill" && PS.renderProceduralLayer) {
            // fill layers carry no reliable pixels: draw them from their settings
            PS.renderProceduralLayer(layer);
        }
    }

    var keep = {};
    Object.keys(m).forEach(function (k) {
        if (PS.PSD_MODELED_FIELDS.indexOf(k) < 0) { keep[k] = m[k]; }
    });
    layer.psd = keep;
    return layer;
};

PS.importOraTree = function (result, doc, notes) {
    var extra = (result.meta && result.meta.ps) || null;
    if (extra) {
        if (extra.guides) { doc.guides = extra.guides; }
        if (typeof extra.globalAngle === "number") { doc.globalAngle = extra.globalAngle; }
        if (typeof extra.globalAltitude === "number") { doc.globalAltitude = extra.globalAltitude; }
        if (extra.psd) { doc.psd = extra.psd; }
        if (Array.isArray(extra.notes)) { doc.notes = extra.notes; }
    }
    function mapNode(node) {
        var d = PS.doc;
        var m = node.meta;
        var ps = node.ps || {};
        var kind = node.children ? "group" : (ps.kind || "raster");
        var layer = kind === "group" ? PS.makeGroup(m.name) : PS.makeLayer(m.name, d.width, d.height, kind);
        layer.visible = !m.hidden;
        layer.opacity = isNaN(m.opacity) ? 1 : m.opacity;
        layer.blend = PS.blendModeIndex[m.blendMode] !== undefined ? m.blendMode : "normal";
        if (layer.canvas && node.pixels) {
            var px = node.pixels;
            PS.putPixelBlock(layer.canvas, px);
            if (px.left < 0 || px.top < 0 || px.left + px.width > d.width || px.top + px.height > d.height) {
                layer.offcanvas = { canvas: PS.blockCanvas(px), left: px.left, top: px.top };
            }
        }
        // Pixel Studio's own extras (absent in files from other applications)
        if (ps.fillOpacity !== undefined) { layer.fillOpacity = ps.fillOpacity; }
        if (ps.clipping) { layer.clipping = true; }
        if (ps.locks) { layer.locks = ps.locks; }
        if (ps.color) { layer.color = ps.color; }
        if (ps.effects) { layer.effects = ps.effects; }
        if (ps.blendIf) { layer.blendIf = ps.blendIf; }
        if (ps.vmask) { layer.vmask = ps.vmask; layer.vmask.rev = 1; }
        if (ps.adjustment) { layer.adjustment = ps.adjustment; }
        if (ps.text) { layer.text = ps.text; }
        if (ps.fill) { layer.fill = ps.fill; }
        if (ps.stroke) { layer.stroke = ps.stroke; }
        if (ps.smart) { layer.smart = ps.smart; }
        if (ps.psd) { layer.psd = ps.psd; }
        if (node.mask) {
            var mm = ps.mask || {};
            var mask = PS.makeMask(d.width, d.height, mm.defaultColor === undefined ? 255 : mm.defaultColor);
            PS.putPixelBlock(mask.canvas, node.mask);
            mask.enabled = mm.enabled !== false;
            mask.linked = mm.linked !== false;
            mask.density = mm.density === undefined ? 1 : mm.density;
            mask.feather = mm.feather || 0;
            layer.mask = mask;
        }
        if (kind === "group") {
            layer.open = m.opened !== false;
            layer.children = node.children.map(mapNode);
        }
        if (kind === "fill" && PS.renderProceduralLayer) { PS.renderProceduralLayer(layer); }
        return layer;
    }
    doc.root.children = (result.layers || []).map(mapNode);
};

// What had to change while opening a file, shown once after it opens
PS.showImportNotes = function (notes) {
    var lossy = notes.some(function (n) { return n.lossy; });
    PS.dialog({
        title: lossy ? "Opened with Changes" : "Opened",
        build: function (body) {
            var p = document.createElement("p");
            p.textContent = lossy
                ? "This file uses features Pixel Studio does not support. They were converted so the document can be edited:"
                : "Notes about this file:";
            body.appendChild(p);
            var ul = document.createElement("ul");
            ul.className = "import-notes";
            notes.forEach(function (n) {
                var li = document.createElement("li");
                li.textContent = n.text;
                ul.appendChild(li);
            });
            body.appendChild(ul);
            if (lossy) {
                var p2 = document.createElement("p");
                p2.textContent = "Save asks before overwriting the original file; Save As keeps it untouched. " +
                    "Autosave writes a recovery copy instead of the original.";
                body.appendChild(p2);
            }
        },
        buttons: [{ label: "OK", primary: true }]
    });
};

/* ============================================================
   EXPORT: document model -> worker job
   ============================================================ */

// PSD data for one layer (no pixels)
PS.psdLayerMeta = function (layer) {
    var m = Object.assign({}, layer.psd || {});
    m.name = layer.name;
    m.hidden = !layer.visible;
    m.opacity = layer.opacity;
    m.fillOpacity = layer.fillOpacity;
    m.blendMode = layer.blend;
    m.clipping = !!layer.clipping;
    m.transparencyProtected = !!layer.locks.transparency;
    m.protected = {
        transparency: !!layer.locks.transparency,
        composite: !!layer.locks.pixels,
        position: !!layer.locks.position
    };
    m.layerColor = layer.color || "none";
    m.linkGroup = layer.link || 0;
    m.linkGroupEnabled = true;
    if (layer.effects && PS.listEffects(layer.effects).length) { m.effects = PS.deepCopy(layer.effects); }
    else { delete m.effects; }
    if (layer.blendIf) { m.blendingRanges = PS.deepCopy(layer.blendIf); }
    if (layer.kind === "group") {
        m.opened = layer.open !== false;
        if (layer.artboard) { m.artboard = layer.artboard; }
    }
    if (layer.vmask) {
        var vm = Object.assign({}, layer.vmask.psd || {});
        vm.paths = PS.deepCopy(layer.vmask.paths);
        vm.invert = !!layer.vmask.invert;
        vm.notLink = layer.vmask.linked === false;
        vm.disable = layer.vmask.enabled === false;
        m.vectorMask = vm;
    }
    if (layer.kind === "adjustment") { m.adjustment = PS.deepCopy(layer.adjustment); }
    if (layer.kind === "text" && layer.text) {
        var t = PS.textToPsd ? PS.textToPsd(layer) : (layer.text.psd || null);
        if (t) { m.text = t; }
    }
    if (layer.kind === "smart" && layer.smart) { m.placedLayer = PS.deepCopy(layer.smart); }
    if ((layer.kind === "fill" || layer.kind === "shape") && layer.fill) {
        m.vectorFill = PS.deepCopy(layer.fill);
        if (layer.stroke) { m.vectorStroke = PS.deepCopy(layer.stroke); }
    }
    return m;
};

// Snapshot the document for the worker. Every canvas is captured as an
// ImageBitmap at call time (a GPU copy, cheap), so the user can keep
// painting while the worker encodes. Resolves to the job object.
PS.buildSaveJob = function (format) {
    var d = PS.doc;
    var waits = [];

    function snap(canvas, target, key) {
        waits.push(createImageBitmap(canvas).then(function (bmp) { target[key] = bmp; }));
    }

    function nodeFor(layer) {
        var node = { meta: null, pixels: null, mask: null, children: null, ps: null };
        if (format === "ora") {
            node.meta = {
                name: layer.name, hidden: !layer.visible, opacity: layer.opacity,
                blendMode: layer.blend, opened: layer.open !== false
            };
            node.ps = PS.oraLayerExtras(layer);
        } else {
            node.meta = PS.psdLayerMeta(layer);
        }
        if (layer.canvas) {
            var src = layer.offcanvas ? PS.offcanvasMerged(layer) : { canvas: layer.canvas, left: 0, top: 0 };
            node.pixels = { left: src.left, top: src.top };
            snap(src.canvas, node.pixels, "bitmap");
        }
        if (layer.mask) {
            node.mask = {
                defaultColor: layer.mask.defaultColor === undefined ? 255 : layer.mask.defaultColor,
                meta: Object.assign({}, layer.mask.psd || {}, {
                    disabled: layer.mask.enabled === false,
                    userMaskDensity: layer.mask.density,
                    userMaskFeather: layer.mask.feather,
                    positionRelativeToLayer: false,
                    fromVectorData: false
                })
            };
            snap(layer.mask.canvas, node.mask, "bitmap");
        }
        if (layer.children) { node.children = layer.children.map(nodeFor); }
        return node;
    }

    var layers = d.root.children.map(nodeFor);
    var job = { format: format, layers: layers, composite: null };

    if (format === "ora") {
        job.doc = {
            width: d.width, height: d.height,
            ps: { guides: d.guides, globalAngle: d.globalAngle, globalAltitude: d.globalAltitude, psd: d.psd,
                notes: d.notes && d.notes.length ? d.notes : undefined }
        };
    } else {
        var meta = Object.assign({}, d.psd || {});
        delete meta.children;
        // notes travel as annotations
        delete meta.annotations;
        if ((d.notes && d.notes.length) || (d.psdOtherNotes && d.psdOtherNotes.length)) {
            meta.annotations = PS.notesToPsd(d.notes, d.psdOtherNotes);
        }
        meta.width = d.width;
        meta.height = d.height;
        var ir = Object.assign({}, meta.imageResources || {});
        ir.globalAngle = d.globalAngle;
        ir.globalAltitude = d.globalAltitude;
        var guides = [];
        (d.guides.h || []).forEach(function (y) { guides.push({ location: y, direction: "horizontal" }); });
        (d.guides.v || []).forEach(function (x) { guides.push({ location: x, direction: "vertical" }); });
        ir.gridAndGuidesInformation = Object.assign({}, ir.gridAndGuidesInformation || {}, { guides: guides });
        if (!ir.gridAndGuidesInformation.grid) { ir.gridAndGuidesInformation.grid = { horizontal: 18 * 32, vertical: 18 * 32 }; }
        delete ir.layerSelectionIds;
        delete ir.layerState;
        meta.imageResources = ir;
        job.doc = meta;
        var bottom = d.root.children[0];
        // the worker confirms the pixels are fully opaque before writing it as
        // the locked Background layer
        job.bottomMaybeBackground = !!(bottom && bottom.kind === "raster" && bottom.name === "Background" &&
            bottom.blend === "normal" && bottom.opacity === 1 && bottom.fillOpacity === 1 && bottom.visible &&
            !bottom.mask && !bottom.vmask && !bottom.effects && !bottom.offcanvas && !bottom.clipping);
    }

    waits.push(PS.renderer.snapshotComposite().then(function (bmp) { job.composite = bmp; }));
    return Promise.all(waits).then(function () { return job; });
};

// Pixel Studio data an OpenRaster layer cannot hold natively
PS.oraLayerExtras = function (layer) {
    var x = { kind: layer.kind === "group" ? undefined : layer.kind };
    if (layer.fillOpacity !== 1) { x.fillOpacity = layer.fillOpacity; }
    if (layer.clipping) { x.clipping = true; }
    if (layer.locks.transparency || layer.locks.pixels || layer.locks.position) { x.locks = layer.locks; }
    if (layer.color && layer.color !== "none") { x.color = layer.color; }
    if (layer.effects) { x.effects = layer.effects; }
    if (layer.blendIf) { x.blendIf = layer.blendIf; }
    if (layer.vmask) {
        x.vmask = { paths: layer.vmask.paths, invert: layer.vmask.invert, linked: layer.vmask.linked,
            enabled: layer.vmask.enabled, density: layer.vmask.density, feather: layer.vmask.feather };
    }
    if (layer.mask) {
        x.mask = { defaultColor: layer.mask.defaultColor, enabled: layer.mask.enabled,
            linked: layer.mask.linked, density: layer.mask.density, feather: layer.mask.feather };
    }
    if (layer.adjustment) { x.adjustment = layer.adjustment; }
    if (layer.text) { x.text = PS.deepCopy(layer.text); }
    if (layer.fill) { x.fill = layer.fill; }
    if (layer.stroke) { x.stroke = layer.stroke; }
    if (layer.smart) { x.smart = layer.smart; }
    if (layer.psd && Object.keys(layer.psd).length) { x.psd = layer.psd; }
    var keys = Object.keys(x).filter(function (k) { return x[k] !== undefined; });
    return keys.length ? x : null;
};

