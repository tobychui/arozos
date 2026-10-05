/*
    Pixel Studio - document worker

    Decodes and encodes layered documents off the main thread so opening a
    large file or saving (manual or automatic) never freezes the editor:

        readPsd   PSD / PSB bytes -> layer tree with 8-bit RGBA pixels
        readComposite  PSD / PSB / ORA bytes -> just the flattened image
                  (used by other apps, e.g. Cine Studio, to show a file)
        writePsd  layer tree (ImageBitmaps + PSD data) -> PSD bytes
        readOra   OpenRaster zip -> layer tree
        writeOra  layer tree -> OpenRaster zip

    Messages in:  {id, op, ...}
    Messages out: {id, progress, stage}  while working
                  {id, ok: true, result} or {id, ok: false, error} when done
*/
"use strict";

importScripts("vendor/ag-psd.js", "vendor/fflate.min.js");

// ag-psd only needs canvases for thumbnails and image decoding helpers;
// pixel data stays in plain ImageData-like objects (useImageData)
agPsd.initializeCanvas(function (w, h) {
    return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
}, function (w, h) {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
});

var currentId = null;
var lastProgress = 0;

function progress(value, stage) {
    var now = Date.now();
    if (value < 1 && now - lastProgress < 80) { return; }
    lastProgress = now;
    self.postMessage({ id: currentId, progress: Math.max(0, Math.min(1, value)), stage: stage || "" });
}

self.onmessage = function (e) {
    var msg = e.data;
    currentId = msg.id;
    var job;
    try {
        if (msg.op === "readPsd") { job = readPsd(msg); }
        else if (msg.op === "writePsd") { job = writePsd(msg); }
        else if (msg.op === "readOra") { job = readOra(msg); }
        else if (msg.op === "writeOra") { job = writeOra(msg); }
        else if (msg.op === "readComposite") { job = readComposite(msg); }
        else if (msg.op === "readAbr") { job = readAbr(msg); }
        else { throw new Error("Unknown operation " + msg.op); }
    } catch (err) {
        self.postMessage({ id: msg.id, ok: false, error: String(err && err.message ? err.message : err) });
        return;
    }
    Promise.resolve(job).then(function (out) {
        self.postMessage({ id: msg.id, ok: true, result: out.result }, out.transfer || []);
    }).catch(function (err) {
        self.postMessage({ id: msg.id, ok: false, error: String(err && err.message ? err.message : err) });
    });
};

/* ============================================================
   pixel helpers
   ============================================================ */

// ag-psd pixel data (8, 16 or 32 bit) -> 8-bit RGBA
function to8bit(pd) {
    var d = pd.data;
    if (d instanceof Uint8ClampedArray) { return d; }
    var out = new Uint8ClampedArray(pd.width * pd.height * 4);
    var i;
    if (d instanceof Uint16Array) {
        for (i = 0; i < out.length; i++) { out[i] = d[i] >> 8; }
    } else if (d instanceof Float32Array) {
        // 32-bit documents are linear light
        for (i = 0; i < out.length; i++) {
            var v = d[i];
            if ((i & 3) === 3) { out[i] = v * 255; }
            else { out[i] = Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2) * 255; }
        }
    } else {
        for (i = 0; i < out.length; i++) { out[i] = d[i]; }
    }
    return out;
}

function pixelBlock(pd, left, top) {
    if (!pd || !pd.width || !pd.height) { return null; }
    return { left: left | 0, top: top | 0, width: pd.width, height: pd.height, data: to8bit(pd) };
}

// Image source -> ImageData via a reusable OffscreenCanvas
var scratch = null;
function bitmapToImageData(bmp) {
    var w = bmp.width, h = bmp.height;
    if (!scratch) { scratch = new OffscreenCanvas(w, h); }
    if (scratch.width < w || scratch.height < h) {
        scratch = new OffscreenCanvas(Math.max(scratch.width, w), Math.max(scratch.height, h));
    }
    var ctx = scratch.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0);
    if (bmp.close) { bmp.close(); }
    return ctx.getImageData(0, 0, w, h);
}

// Bounds of pixels with alpha > 0: {x, y, w, h} or null when empty
function alphaBounds(img) {
    var w = img.width, h = img.height, d = img.data;
    var minX = w, minY = h, maxX = -1, maxY = -1;
    for (var y = 0; y < h; y++) {
        var row = y * w * 4 + 3;
        var rowHit = false;
        for (var x = 0; x < w; x++) {
            if (d[row + x * 4] !== 0) {
                rowHit = true;
                if (x < minX) { minX = x; }
                if (x > maxX) { maxX = x; }
            }
        }
        if (rowHit) {
            if (y < minY) { minY = y; }
            maxY = y;
        }
    }
    if (maxX < 0) { return null; }
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// Bounds of mask pixels that differ from the default value
function maskBounds(img, def) {
    var w = img.width, h = img.height, d = img.data;
    var minX = w, minY = h, maxX = -1, maxY = -1;
    for (var y = 0; y < h; y++) {
        var row = y * w * 4;
        for (var x = 0; x < w; x++) {
            if (d[row + x * 4] !== def) {
                if (x < minX) { minX = x; }
                if (x > maxX) { maxX = x; }
                if (y < minY) { minY = y; }
                if (y > maxY) { maxY = y; }
            }
        }
    }
    if (maxX < 0) { return null; }
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function crop(img, b) {
    if (b.x === 0 && b.y === 0 && b.w === img.width && b.h === img.height) {
        return { width: img.width, height: img.height, data: img.data };
    }
    var out = new Uint8ClampedArray(b.w * b.h * 4);
    for (var y = 0; y < b.h; y++) {
        var s = ((b.y + y) * img.width + b.x) * 4;
        out.set(img.data.subarray(s, s + b.w * 4), y * b.w * 4);
    }
    return { width: b.w, height: b.h, data: out };
}

// Grayscale mask pixels (value in R) -> RGBA gray with the erased-pixel rule
// used by the editor (transparent mask pixels reveal)
function maskGray(img) {
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
        var a = d[i + 3];
        var v = a === 255 ? d[i] : Math.round((d[i] * a + 255 * (255 - a)) / 255);
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
    }
    return img;
}

function stripLayerMeta(l) {
    var meta = {};
    Object.keys(l).forEach(function (k) {
        if (k === "imageData" || k === "canvas" || k === "children" || k === "rawData") { return; }
        meta[k] = l[k];
    });
    ["mask", "realMask"].forEach(function (k) {
        if (meta[k]) {
            var m = {};
            Object.keys(meta[k]).forEach(function (mk) {
                if (mk !== "imageData" && mk !== "canvas") { m[mk] = meta[k][mk]; }
            });
            meta[k] = m;
        }
    });
    return meta;
}

/* ============================================================
   PSD read
   ============================================================ */

function countLayers(list) {
    var n = 0;
    (list || []).forEach(function (l) { n += 1 + countLayers(l.children); });
    return n;
}

function readPsd(msg) {
    progress(0.02, "parse");
    var psd = agPsd.readPsd(new Uint8Array(msg.buffer), {
        useImageData: true,
        useRawThumbnail: true,
        skipThumbnail: true,
        throwForMissingFeatures: false,
        logMissingFeatures: false
    });
    progress(0.5, "layers");
    var transfer = [];
    var total = Math.max(1, countLayers(psd.children));
    var done = 0;

    function mapLayer(l) {
        var node = { meta: stripLayerMeta(l), pixels: null, mask: null, realMask: null, children: null };
        node.pixels = pixelBlock(l.imageData, l.left, l.top);
        if (node.pixels) { transfer.push(node.pixels.data.buffer); }
        ["mask", "realMask"].forEach(function (k) {
            var m = l[k];
            if (m && m.imageData && m.imageData.width && m.imageData.height) {
                node[k] = pixelBlock(m.imageData, m.left, m.top);
                transfer.push(node[k].data.buffer);
            }
        });
        if (l.children) { node.children = l.children.map(mapLayer); }
        done++;
        progress(0.5 + 0.45 * done / total, "layers");
        return node;
    }

    var layers = (psd.children || []).map(mapLayer);
    var composite = pixelBlock(psd.imageData, 0, 0);
    if (composite) { transfer.push(composite.data.buffer); }

    var meta = {};
    Object.keys(psd).forEach(function (k) {
        if (k === "children" || k === "imageData" || k === "canvas") { return; }
        meta[k] = psd[k];
    });
    if (meta.imageResources) {
        meta.imageResources = Object.assign({}, meta.imageResources);
        delete meta.imageResources.thumbnail;
        delete meta.imageResources.thumbnailRaw;
    }
    progress(1, "done");
    return { result: { format: "psd", meta: meta, layers: layers, composite: composite }, transfer: transfer };
}

// Brush presets and their sampled tips from an .abr file
function readAbr(msg) {
    var abr = agPsd.readAbr(new Uint8Array(msg.buffer), { logMissingFeatures: false });
    var transfer = [];
    var samples = (abr.samples || []).map(function (s) {
        transfer.push(s.alpha.buffer);
        return { id: s.id, bounds: s.bounds, alpha: s.alpha };
    });
    var brushes = (abr.brushes || []).map(function (b) {
        // the tip shape and dynamics only; sampled data stays referenced by id
        return {
            name: b.name, shape: b.shape, spacing: b.spacing, shapeDynamics: b.shapeDynamics, scatter: b.scatter,
            transfer: b.transfer, colorDynamics: b.colorDynamics
        };
    });
    return { result: { brushes: brushes, samples: samples }, transfer: transfer };
}

// The flattened image only: {width, height, data}
function readComposite(msg) {
    if (msg.format === "ora") {
        var files = fflate.unzipSync(new Uint8Array(msg.buffer));
        var src = files["mergedimage.png"] || files["Thumbnails/thumbnail.png"];
        if (!src) { throw new Error("The OpenRaster file has no merged image"); }
        return decodePng(src).then(function (img) {
            return { result: { width: img.width, height: img.height, data: img.data }, transfer: [img.data.buffer] };
        });
    }
    var psd = agPsd.readPsd(new Uint8Array(msg.buffer), {
        useImageData: true, skipLayerImageData: true, skipThumbnail: true, skipLinkedFilesData: true
    });
    // the merged image of 16 / 32-bit documents does not decode reliably:
    // the caller flattens the layers instead
    if (psd.bitsPerChannel && psd.bitsPerChannel !== 8) {
        throw new Error("The flattened image of a " + psd.bitsPerChannel + "-bit document is rebuilt from its layers");
    }
    var block = pixelBlock(psd.imageData, 0, 0);
    if (!block) { throw new Error("The file has no flattened image (saved without maximum compatibility)"); }
    return { result: { width: block.width, height: block.height, data: block.data }, transfer: [block.data.buffer] };
}

/* ============================================================
   PSD write
   ============================================================ */

function writePsd(msg) {
    var doc = msg.doc;
    var total = Math.max(1, countNodes(msg.layers));
    var done = 0;

    function buildLayer(node) {
        var l = Object.assign({}, node.meta || {});
        delete l.imageData; delete l.canvas;
        if (node.children) {
            l.children = node.children.map(buildLayer);
        } else if (node.pixels) {
            var img = bitmapToImageData(node.pixels.bitmap);
            var b = alphaBounds(img);
            if (b) {
                var c = crop(img, b);
                l.left = node.pixels.left + b.x;
                l.top = node.pixels.top + b.y;
                l.right = l.left + b.w;
                l.bottom = l.top + b.h;
                l.imageData = c;
            } else {
                l.left = l.top = l.right = l.bottom = 0;
            }
        } else {
            l.left = l.top = l.right = l.bottom = 0;
        }
        if (node.mask) {
            var mimg = maskGray(bitmapToImageData(node.mask.bitmap));
            var def = node.mask.defaultColor === undefined ? 255 : node.mask.defaultColor;
            var mb = maskBounds(mimg, def);
            var mask = Object.assign({}, node.mask.meta || {});
            delete mask.imageData; delete mask.canvas;
            mask.defaultColor = def;
            if (mb) {
                mask.left = mb.x; mask.top = mb.y;
                mask.right = mb.x + mb.w; mask.bottom = mb.y + mb.h;
                mask.imageData = crop(mimg, mb);
            } else {
                mask.left = mask.top = mask.right = mask.bottom = 0;
            }
            l.mask = mask;
        } else {
            delete l.mask;
        }
        delete l.realMask;
        done++;
        progress(0.05 + 0.75 * done / total, "layers");
        return l;
    }

    progress(0.02, "layers");
    var psd = Object.assign({}, doc);
    psd.width = doc.width;
    psd.height = doc.height;
    psd.bitsPerChannel = 8;
    psd.colorMode = 3;
    psd.channels = undefined;
    psd.children = msg.layers.map(buildLayer);

    var compositeImg = null;
    if (msg.composite) {
        compositeImg = bitmapToImageData(msg.composite);
        psd.imageData = { width: compositeImg.width, height: compositeImg.height, data: compositeImg.data.slice ? compositeImg.data.slice(0) : compositeImg.data };
    }

    return makeThumbnail(compositeImg, 160).then(function (thumb) {
        psd.imageResources = Object.assign({}, doc.imageResources || {});
        delete psd.imageResources.thumbnail;
        if (thumb) { psd.imageResources.thumbnailRaw = thumb; }
        progress(0.85, "write");

        var bottom = psd.children[0];
        var hasBackground = !!(bottom && msg.bottomMaybeBackground && isOpaqueFull(bottom, doc.width, doc.height));
        var bytes = agPsd.writePsdUint8Array(psd, {
            noBackground: !hasBackground,
            psb: !!msg.psb || doc.width > 30000 || doc.height > 30000,
            compress: false
        });
        progress(1, "done");
        var buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        return { result: { buffer: buf }, transfer: [buf] };
    });
}

// A layer covering the whole document with no transparent pixel
function isOpaqueFull(l, w, h) {
    var img = l.imageData;
    if (!img || l.left !== 0 || l.top !== 0 || img.width !== w || img.height !== h) { return false; }
    var d = img.data;
    for (var i = 3; i < d.length; i += 4) {
        if (d[i] !== 255) { return false; }
    }
    return true;
}

function countNodes(list) {
    var n = 0;
    (list || []).forEach(function (l) { n += 1 + countNodes(l.children); });
    return n;
}

// JPEG thumbnail (PSD image resource 1036) of the composite
function makeThumbnail(img, maxSide) {
    if (!img || typeof OffscreenCanvas === "undefined") { return Promise.resolve(null); }
    var scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    var tw = Math.max(1, Math.round(img.width * scale));
    var th = Math.max(1, Math.round(img.height * scale));
    var full = new OffscreenCanvas(img.width, img.height);
    full.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    var small = new OffscreenCanvas(tw, th);
    var sctx = small.getContext("2d");
    sctx.fillStyle = "#ffffff";
    sctx.fillRect(0, 0, tw, th);
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(full, 0, 0, tw, th);
    return small.convertToBlob({ type: "image/jpeg", quality: 0.85 }).then(function (blob) {
        return blob.arrayBuffer();
    }).then(function (ab) {
        return { width: tw, height: th, data: new Uint8Array(ab) };
    }).catch(function () { return null; });
}

/* ============================================================
   OpenRaster
   ============================================================ */

// Pixel Studio keeps what OpenRaster cannot express (masks, layer styles,
// adjustment / text / shape data, clipping, ...) in attributes of its own
// namespace; other applications ignore them and still see every layer.
var PS_NS = "https://arozos.com/pixelstudio/ora";

var ORA_BLEND = {
    "normal": "svg:src-over", "pass through": "svg:src-over", "multiply": "svg:multiply",
    "screen": "svg:screen", "overlay": "svg:overlay", "darken": "svg:darken",
    "lighten": "svg:lighten", "color dodge": "svg:color-dodge", "color burn": "svg:color-burn",
    "hard light": "svg:hard-light", "soft light": "svg:soft-light", "difference": "svg:difference",
    "exclusion": "svg:exclusion", "hue": "svg:hue", "saturation": "svg:saturation",
    "color": "svg:color", "luminosity": "svg:luminosity", "linear dodge": "svg:plus"
};

function oraBlendToPs(op) {
    var keys = Object.keys(ORA_BLEND);
    for (var i = 0; i < keys.length; i++) {
        if (ORA_BLEND[keys[i]] === op && keys[i] !== "pass through") { return keys[i]; }
    }
    // a few Krita / MyPaint extensions
    var extra = {
        "krita:linear_burn": "linear burn", "krita:linear_light": "linear light",
        "krita:vivid_light": "vivid light", "krita:pin_light": "pin light",
        "krita:hard_mix": "hard mix", "krita:subtract": "subtract", "krita:divide": "divide",
        "krita:darker_color": "darker color", "krita:lighter_color": "lighter color",
        "krita:dissolve": "dissolve"
    };
    return extra[op] || "normal";
}

// JSON for Pixel Studio's private data: byte arrays travel as base64
function jsonOut(v) {
    return JSON.stringify(v, function (k, x) {
        if (x && ArrayBuffer.isView(x)) {
            var bytes = new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
            var s = "";
            for (var i = 0; i < bytes.length; i += 8192) {
                s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
            }
            return { $bytes: btoa(s), $type: x.constructor.name };
        }
        return x;
    });
}

function jsonIn(text) {
    return JSON.parse(text, function (k, x) {
        if (x && typeof x === "object" && typeof x.$bytes === "string") {
            var bin = atob(x.$bytes);
            var u8 = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) { u8[i] = bin.charCodeAt(i); }
            if (x.$type === "Uint8ClampedArray") { return new Uint8ClampedArray(u8.buffer); }
            return u8;
        }
        return x;
    });
}

function xmlEscape(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function xmlUnescape(s) {
    return String(s).replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">").replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); })
        .replace(/&amp;/g, "&");
}

// Minimal XML element parser for stack.xml (workers have no DOMParser):
// returns {name, attrs, children}
function parseXml(text) {
    var re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g;
    var root = { name: "#root", attrs: {}, children: [] };
    var stack = [root];
    var m;
    while ((m = re.exec(text))) {
        if (!m[2]) { continue; }        // declaration or comment
        if (m[1] === "/") {
            if (stack.length > 1) { stack.pop(); }
            continue;
        }
        var attrs = {};
        var ar = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
        var a;
        while ((a = ar.exec(m[3] || ""))) {
            attrs[a[1]] = xmlUnescape(a[3] !== undefined ? a[3] : a[4]);
        }
        var el = { name: m[2], attrs: attrs, children: [] };
        stack[stack.length - 1].children.push(el);
        if (m[4] !== "/") { stack.push(el); }
    }
    return root;
}

function decodePng(bytes) {
    return createImageBitmap(new Blob([bytes], { type: "image/png" })).then(bitmapToImageData);
}

function readOra(msg) {
    progress(0.02, "unzip");
    var files = fflate.unzipSync(new Uint8Array(msg.buffer));
    if (!files["stack.xml"]) { throw new Error("Not an OpenRaster file (stack.xml missing)"); }
    var xml = parseXml(fflate.strFromU8(files["stack.xml"]));
    var image = xml.children.filter(function (c) { return c.name === "image"; })[0];
    if (!image) { throw new Error("stack.xml has no image element"); }
    var W = parseInt(image.attrs.w, 10), H = parseInt(image.attrs.h, 10);
    if (!(W > 0 && H > 0)) { throw new Error("Invalid image size in stack.xml"); }
    var top = image.children.filter(function (c) { return c.name === "stack"; })[0] || { children: [] };

    var transfer = [];
    var jobs = [];
    var totalLayers = 0;

    function psAttr(attrs, name) {
        // our attributes are written with the "ps:" prefix bound to PS_NS
        return attrs["ps:" + name];
    }

    function mapNode(el) {
        var a = el.attrs;
        var meta = {
            name: a.name || (el.name === "stack" ? "Group" : "Layer"),
            hidden: a.visibility === "hidden",
            opacity: a.opacity !== undefined ? parseFloat(a.opacity) : 1,
            blendMode: psAttr(a, "blend") || oraBlendToPs(a["composite-op"] || "svg:src-over")
        };
        var extra = psAttr(a, "data");
        var node = { meta: meta, pixels: null, mask: null, children: null, ps: null };
        if (extra) {
            try { node.ps = jsonIn(extra); } catch (e) { node.ps = null; }
        }
        if (el.name === "stack") {
            if (!psAttr(a, "blend")) {
                meta.blendMode = a.isolation === "isolate" ? meta.blendMode : "pass through";
            }
            meta.opened = psAttr(a, "open") !== "false";
            // stack.xml lists the topmost element first
            node.children = el.children.filter(function (c) { return c.name === "stack" || c.name === "layer"; })
                .reverse().map(mapNode);
        } else {
            totalLayers++;
            var src = a.src;
            var x = parseInt(a.x || "0", 10), y = parseInt(a.y || "0", 10);
            if (src && files[src]) {
                jobs.push(decodePng(files[src]).then(function (img) {
                    node.pixels = { left: x, top: y, width: img.width, height: img.height, data: img.data };
                    transfer.push(img.data.buffer);
                }));
            }
        }
        var maskSrc = psAttr(a, "mask");
        if (maskSrc && files[maskSrc]) {
            jobs.push(decodePng(files[maskSrc]).then(function (img) {
                node.mask = { left: 0, top: 0, width: img.width, height: img.height, data: img.data };
                transfer.push(img.data.buffer);
            }));
        }
        return node;
    }

    var layers = top.children.filter(function (c) { return c.name === "stack" || c.name === "layer"; })
        .reverse().map(mapNode);
    var docExtra = null;
    if (psAttr(image.attrs, "data")) {
        try { docExtra = jsonIn(psAttr(image.attrs, "data")); } catch (e) { docExtra = null; }
    }
    var composite = null;
    if (files["mergedimage.png"]) {
        jobs.push(decodePng(files["mergedimage.png"]).then(function (img) {
            composite = { left: 0, top: 0, width: img.width, height: img.height, data: img.data };
            transfer.push(img.data.buffer);
        }));
    }
    var finished = 0;
    jobs = jobs.map(function (j) {
        return j.then(function () {
            finished++;
            progress(0.1 + 0.85 * finished / Math.max(1, jobs.length), "layers");
        });
    });
    return Promise.all(jobs).then(function () {
        progress(1, "done");
        return {
            result: { format: "ora", meta: { width: W, height: H, ps: docExtra }, layers: layers, composite: composite },
            transfer: transfer
        };
    });
}

function encodePng(img) {
    var c = new OffscreenCanvas(img.width, img.height);
    c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    return c.convertToBlob({ type: "image/png" }).then(function (b) { return b.arrayBuffer(); })
        .then(function (ab) { return new Uint8Array(ab); });
}

function writeOra(msg) {
    var doc = msg.doc;
    var files = {};
    var jobs = [];
    var serial = 0;
    var total = Math.max(1, countNodes(msg.layers));
    var done = 0;

    function attrs(obj) {
        return Object.keys(obj).filter(function (k) { return obj[k] !== undefined && obj[k] !== null; })
            .map(function (k) { return k + "=\"" + xmlEscape(obj[k]) + "\""; }).join(" ");
    }

    function nodeXml(node, indent) {
        var m = node.meta || {};
        var blend = m.blendMode || "normal";
        var a = {
            name: m.name || "Layer",
            visibility: m.hidden ? "hidden" : "visible",
            opacity: (m.opacity === undefined ? 1 : m.opacity).toFixed(3),
            "composite-op": ORA_BLEND[blend] || "svg:src-over"
        };
        if (!ORA_BLEND[blend] || blend === "pass through") { a["ps:blend"] = blend; }
        if (node.ps) { a["ps:data"] = jsonOut(node.ps); }
        if (node.mask) {
            var mname = "data/mask" + (++serial) + ".png";
            a["ps:mask"] = mname;
            var mimg = maskGray(bitmapToImageData(node.mask.bitmap));
            jobs.push(encodePng(mimg).then(function (bytes) { files[mname] = [bytes, { level: 0 }]; }));
        }
        var out;
        if (node.children) {
            a.isolation = blend === "pass through" ? "auto" : "isolate";
            if (m.opened === false) { a["ps:open"] = "false"; }
            var kids = node.children.slice().reverse().map(function (c) { return nodeXml(c, indent + "  "); });
            out = indent + "<stack " + attrs(a) + ">\n" + kids.join("") + indent + "</stack>\n";
        } else {
            if (node.pixels) {
                var img = bitmapToImageData(node.pixels.bitmap);
                var b = alphaBounds(img);
                if (b) {
                    var name = "data/layer" + (++serial) + ".png";
                    a.src = name;
                    a.x = node.pixels.left + b.x;
                    a.y = node.pixels.top + b.y;
                    var cropped = crop(img, b);
                    jobs.push(encodePng(cropped).then(function (bytes) { files[name] = [bytes, { level: 0 }]; }));
                }
            }
            out = indent + "<layer " + attrs(a) + "/>\n";
        }
        done++;
        progress(0.05 + 0.5 * done / total, "layers");
        return out;
    }

    progress(0.02, "layers");
    var body = msg.layers.slice().reverse().map(function (n) { return nodeXml(n, "    "); }).join("");
    var imgAttrs = { version: "0.0.6", w: doc.width, h: doc.height, "xmlns:ps": PS_NS };
    if (doc.ps) { imgAttrs["ps:data"] = jsonOut(doc.ps); }
    var stackXml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
        "<image " + attrs(imgAttrs) + ">\n" +
        "  <stack>\n" + body + "  </stack>\n</image>\n";

    var composite = msg.composite ? bitmapToImageData(msg.composite) : null;
    if (composite) {
        jobs.push(encodePng(composite).then(function (bytes) { files["mergedimage.png"] = [bytes, { level: 0 }]; }));
        // thumbnail: at most 256 px on the long side
        var scale = Math.min(1, 256 / Math.max(composite.width, composite.height));
        var tw = Math.max(1, Math.round(composite.width * scale));
        var th = Math.max(1, Math.round(composite.height * scale));
        var full = new OffscreenCanvas(composite.width, composite.height);
        full.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(composite.data), composite.width, composite.height), 0, 0);
        var small = new OffscreenCanvas(tw, th);
        small.getContext("2d").drawImage(full, 0, 0, tw, th);
        jobs.push(small.convertToBlob({ type: "image/png" }).then(function (b) { return b.arrayBuffer(); })
            .then(function (ab) { files["Thumbnails/thumbnail.png"] = [new Uint8Array(ab), { level: 0 }]; }));
    }

    return Promise.all(jobs).then(function () {
        progress(0.8, "write");
        // the mimetype entry must come first and be stored uncompressed
        var ordered = { "mimetype": [fflate.strToU8("image/openraster"), { level: 0 }] };
        ordered["stack.xml"] = [fflate.strToU8(stackXml), { level: 6 }];
        Object.keys(files).sort().forEach(function (k) { ordered[k] = files[k]; });
        var zipped = fflate.zipSync(ordered);
        progress(1, "done");
        var buf = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
        return { result: { buffer: buf }, transfer: [buf] };
    });
}
