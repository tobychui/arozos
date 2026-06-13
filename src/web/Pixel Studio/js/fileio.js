/*
    Pixel Studio - file I/O and document operations
    Opens files through the ArozOS media endpoint, saves through
    ao_module_uploadFile, and falls back to browser download/upload
    pickers when running outside the ArozOS desktop.

    Native project format: .pxs (JSON; raster layers as base64 PNG,
    text layers as re-renderable text data).
*/
"use strict";

PS.IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

PS.extOf = function (name) {
    var i = name.lastIndexOf(".");
    return i < 0 ? "" : name.slice(i + 1).toLowerCase();
};

PS.dirOf = function (vpath) {
    var parts = vpath.split("/");
    parts.pop();
    return parts.join("/");
};

/* ---------- new document ---------- */

// opts.mandatory: used at startup — if the user closes without creating and
// there is still no document, fall back to a default canvas so the app is
// never left in a document-less state.
PS.fileNewDialog = function (opts) {
    opts = opts || {};
    PS.confirmDiscard(function () {
        PS._showNewDocPanel(opts);
    });
};

PS._showNewDocPanel = function (opts) {
    var wIn, hIn, bgIn, presetIn;
    var created = false;

    PS.floatingPanel({
        title: "New Document",
        x: Math.round(window.innerWidth / 2 - 150),
        y: 110,
        build: function (body) {
            presetIn = PS.dialogRow(body, "Preset", PS.selectInput([
                { v: "custom", l: "Custom" },
                { v: "800x600", l: "800 x 600" },
                { v: "1024x768", l: "1024 x 768" },
                { v: "1280x720", l: "1280 x 720 (HD)" },
                { v: "1920x1080", l: "1920 x 1080 (Full HD)" },
                { v: "2480x3508", l: "A4 print (2480 x 3508)" },
                { v: "1080x1080", l: "Square (1080 x 1080)" }
            ], "custom"));
            wIn = PS.dialogRow(body, "Width (px)", PS.numberInput(1000, 1, 8192));
            hIn = PS.dialogRow(body, "Height (px)", PS.numberInput(700, 1, 8192));
            bgIn = PS.dialogRow(body, "Background", PS.selectInput([
                { v: "white", l: "White" },
                { v: "bgcolor", l: "Background color" },
                { v: "transparent", l: "Transparent" }
            ], "white"));
            presetIn.addEventListener("change", function () {
                if (presetIn.value === "custom") { return; }
                var p = presetIn.value.split("x");
                wIn.value = p[0];
                hIn.value = p[1];
            });
        },
        buttons: [
            { label: "Cancel" },
            {
                label: "Create", primary: true,
                action: function () {
                    created = true;
                    PS.newDocument({
                        width: parseInt(wIn.value, 10) || 1000,
                        height: parseInt(hIn.value, 10) || 700,
                        background: bgIn.value
                    });
                }
            }
        ],
        onClose: function () {
            if (!created && opts.mandatory && !PS.doc) {
                PS.newDocument({ width: 1000, height: 700, background: "white" });
            }
        }
    });
};

/* ---------- open ---------- */

PS.fileOpenDialog = function () {
    PS.confirmDiscard(function () {
        if (PS.inArozOS() && typeof ao_module_openFileSelector !== "undefined") {
            window.psOpenCallback = function psOpenCallback(filedata) {
                if (!filedata || !filedata.length) { return; }
                PS.openFromPath(filedata[0].filepath, filedata[0].filename);
            };
            ao_module_openFileSelector(window.psOpenCallback, "user:/Desktop", "file", false);
        } else {
            // standalone fallback
            var inp = document.createElement("input");
            inp.type = "file";
            inp.accept = ".png,.jpg,.jpeg,.gif,.webp,.bmp,.pxs";
            inp.addEventListener("change", function () {
                if (inp.files.length) { PS.openFromBlob(inp.files[0], inp.files[0].name); }
            });
            inp.click();
        }
    });
};

PS.openFromPath = function (filepath, filename) {
    var url = "../media/?file=" + encodeURIComponent(filepath);
    var ext = PS.extOf(filename);

    if (ext === "pxs") {
        fetch(url)
            .then(function (r) {
                if (!r.ok) { throw new Error("HTTP " + r.status); }
                return r.json();
            })
            .then(function (data) { PS.loadProject(data, filepath, filename); })
            .catch(function (err) {
                PS.toast("Cannot open project: " + err.message, true);
            });
        return;
    }

    if (PS.IMAGE_EXTS.indexOf(ext) < 0) {
        PS.toast("Unsupported file type: ." + ext, true);
        return;
    }

    var img = new Image();
    img.onload = function () {
        PS.docFromImage(img, filepath, filename, ext);
    };
    img.onerror = function () {
        PS.toast("Cannot load image: " + filename, true);
    };
    img.src = url;
};

PS.openFromBlob = function (blob, filename) {
    var ext = PS.extOf(filename);
    if (ext === "pxs") {
        blob.text().then(function (txt) {
            try {
                PS.loadProject(JSON.parse(txt), "", filename);
            } catch (e) {
                PS.toast("Invalid project file", true);
            }
        });
        return;
    }
    var url = URL.createObjectURL(blob);
    var img = new Image();
    img.onload = function () {
        URL.revokeObjectURL(url);
        PS.docFromImage(img, "", filename, ext);
    };
    img.src = url;
};

PS.docFromImage = function (img, filepath, filename, ext) {
    PS.newDocument({
        width: img.naturalWidth,
        height: img.naturalHeight,
        background: "transparent",
        name: filename,
        filePath: filepath,
        format: ext,
        historyLabel: "Open"
    });
    var layer = PS.doc.layers[0];
    layer.canvas.getContext("2d").drawImage(img, 0, 0);
    PS.doc.dirty = false;
    PS.refreshUI();
    PS.requestRender();
};

/* ---------- project (de)serialization ---------- */

PS.serializeProject = function () {
    var d = PS.doc;
    return JSON.stringify({
        app: "PixelStudio",
        version: 1,
        width: d.width,
        height: d.height,
        active: d.activeLayer,
        guides: d.guides || { h: [], v: [] },
        rulers: !!PS.rulersOn,
        customColors: PS.customColors || [],
        layers: d.layers.map(function (layer) {
            var out = {
                name: layer.name,
                visible: layer.visible,
                opacity: layer.opacity,
                blend: layer.blend,
                type: layer.type
            };
            if (layer.type === "text") {
                out.text = layer.text;
            } else {
                out.data = layer.canvas.toDataURL("image/png");
            }
            return out;
        })
    });
};

PS.loadProject = function (data, filepath, filename) {
    if (!data || data.app !== "PixelStudio" || !Array.isArray(data.layers)) {
        PS.toast("Not a Pixel Studio project file", true);
        return;
    }

    var w = PS.clamp(parseInt(data.width, 10) || 1, 1, 8192);
    var h = PS.clamp(parseInt(data.height, 10) || 1, 1, 8192);

    var loaders = data.layers.map(function (spec) {
        return new Promise(function (resolve) {
            var layer = PS.makeLayer(spec.name || "Layer", w, h);
            layer.visible = spec.visible !== false;
            layer.opacity = (spec.opacity === undefined) ? 1 : spec.opacity;
            layer.blend = spec.blend || "source-over";
            if (spec.type === "text" && spec.text) {
                layer.type = "text";
                layer.text = spec.text;
                PS.renderTextLayer(layer);
                resolve(layer);
            } else if (spec.data) {
                var img = new Image();
                img.onload = function () {
                    layer.canvas.getContext("2d").drawImage(img, 0, 0);
                    resolve(layer);
                };
                img.onerror = function () { resolve(layer); };
                img.src = spec.data;
            } else {
                resolve(layer);
            }
        });
    });

    Promise.all(loaders).then(function (layers) {
        PS.doc = {
            width: w,
            height: h,
            layers: layers,
            activeLayer: PS.clamp(parseInt(data.active, 10) || 0, 0, layers.length - 1),
            selection: null,
            filePath: filepath || "",
            fileName: filename || "Untitled.pxs",
            format: "pxs",
            guides: (data.guides && data.guides.h && data.guides.v)
                ? { h: data.guides.h.slice(), v: data.guides.v.slice() }
                : { h: [], v: [] },
            dirty: false
        };
        PS.history.stack = [];
        PS.history.index = -1;
        PS.pushHistory("Open Project", null, null);
        PS.strokePreview = null;
        PS.layerOverride = null;

        // restore the file's custom palette and ruler state
        if (Array.isArray(data.customColors) && data.customColors.length) {
            data.customColors.forEach(function (c) {
                if (PS.customColors.indexOf(c) < 0) { PS.customColors.push(c); }
            });
            PS.renderColorPanel();
        }
        if (typeof data.rulers === "boolean") { PS.setRulers(data.rulers); }

        PS.updateCanvasSize();
        PS.zoomFit();
        PS.refreshUI();
        PS.requestRender();
    });
};

/* ---------- save ---------- */

PS.fileSave = function () {
    if (PS.commitTextEdit) { PS.commitTextEdit(); }
    if (!PS.doc.filePath) { PS.fileSaveAs(); return; }
    PS.writeDocumentTo(PS.doc.filePath, PS.doc.fileName);
};

PS.fileSaveAs = function () {
    if (PS.commitTextEdit) { PS.commitTextEdit(); }
    var defaultName = PS.doc.fileName;
    if (PS.extOf(defaultName) === "") { defaultName += ".pxs"; }

    if (PS.inArozOS() && typeof ao_module_openFileSelector !== "undefined") {
        window.psSaveAsCallback = function psSaveAsCallback(filedata) {
            if (!filedata || !filedata.length) { return; }
            var f = filedata[0];
            PS.writeDocumentTo(f.filepath, f.filename, true);
        };
        ao_module_openFileSelector(window.psSaveAsCallback, "user:/Desktop", "new", false, { defaultName: defaultName });
    } else {
        PS.makeSaveBlob(PS.extOf(defaultName) || "pxs", function (blob) {
            PS.downloadBlob(blob, defaultName);
        });
    }
};

// Build the file blob for the given extension and hand it to cb
PS.makeSaveBlob = function (ext, cb, quality) {
    if (ext === "pxs") {
        cb(new Blob([PS.serializeProject()], { type: "application/json" }));
        return;
    }
    var flat = PS.compositeToCanvas();
    if (ext === "jpg" || ext === "jpeg") {
        // jpeg has no alpha: composite over white
        var opaque = PS.createCanvas(flat.width, flat.height);
        var ctx = opaque.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, flat.width, flat.height);
        ctx.drawImage(flat, 0, 0);
        opaque.toBlob(cb, "image/jpeg", quality || 0.92);
    } else if (ext === "webp") {
        flat.toBlob(cb, "image/webp", quality || 0.92);
    } else {
        flat.toBlob(cb, "image/png");
    }
};

PS.writeDocumentTo = function (filepath, filename) {
    var ext = PS.extOf(filename) || "pxs";
    if (ext !== "pxs" && PS.IMAGE_EXTS.indexOf(ext) < 0) {
        filename += ".pxs";
        filepath += ".pxs";
        ext = "pxs";
    }

    PS.makeSaveBlob(ext, function (blob) {
        var file = new File([blob], filename, { type: blob.type });
        try {
            ao_module_uploadFile(file, PS.dirOf(filepath), function () {
                PS.doc.filePath = filepath;
                PS.doc.fileName = filename;
                PS.doc.format = ext;
                PS.doc.dirty = false;
                PS.updateTitle();
                PS.updateStatusBar();
                PS.toast("Saved " + filename);
                if (ext !== "pxs" && PS.doc.layers.length > 1) {
                    PS.toast("Note: ." + ext + " is flattened - use .pxs to keep layers");
                }
            }, undefined, function () {
                PS.toast("Save failed - check permissions", true);
            });
        } catch (e) {
            PS.downloadBlob(blob, filename);
        }
    });
};

PS.downloadBlob = function (blob, filename) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    PS.doc.dirty = false;
    PS.updateTitle();
};

/* ---------- export ---------- */

PS.exportImage = function (format) {
    if (PS.commitTextEdit) { PS.commitTextEdit(); }
    var base = PS.doc.fileName.replace(/\.[^.]+$/, "");
    var filename = base + "." + format;
    var quality = 0.92;

    function doExport() {
        if (PS.inArozOS() && typeof ao_module_openFileSelector !== "undefined") {
            window.psExportCallback = function psExportCallback(filedata) {
                if (!filedata || !filedata.length) { return; }
                var f = filedata[0];
                PS.makeSaveBlob(format, function (blob) {
                    var file = new File([blob], f.filename, { type: blob.type });
                    ao_module_uploadFile(file, PS.dirOf(f.filepath), function () {
                        PS.toast("Exported " + f.filename);
                    });
                }, quality);
            };
            ao_module_openFileSelector(window.psExportCallback, "user:/Desktop", "new", false, { defaultName: filename });
        } else {
            PS.makeSaveBlob(format, function (blob) {
                PS.downloadBlob(blob, filename);
            }, quality);
        }
    }

    if (format === "jpg") {
        var qIn;
        PS.dialog({
            title: "Export JPEG",
            build: function (body) {
                qIn = PS.dialogRow(body, "Quality (%)", PS.numberInput(92, 10, 100));
            },
            buttons: [
                { label: "Cancel" },
                {
                    label: "Export", primary: true,
                    action: function () {
                        quality = PS.clamp(parseInt(qIn.value, 10) || 92, 10, 100) / 100;
                        doExport();
                    }
                }
            ]
        });
    } else {
        doExport();
    }
};

/* ---------- launch input files ---------- */

PS.openLaunchFiles = function () {
    var inputFiles = null;
    try {
        if (typeof ao_module_loadInputFiles !== "undefined") {
            inputFiles = ao_module_loadInputFiles();
        }
    } catch (e) { inputFiles = null; }

    if (inputFiles && inputFiles.length > 0) {
        PS.openFromPath(inputFiles[0].filepath, inputFiles[0].filename);
        return true;
    }
    return false;
};

/* ============================================================
   DOCUMENT GEOMETRY OPERATIONS
   ============================================================ */

// wraps an operation that rebuilds the layer stack / canvas size
PS.docGeometryOp = function (label, fn) {
    function capture() {
        return {
            w: PS.doc.width, h: PS.doc.height,
            layers: PS.doc.layers.slice(),
            active: PS.doc.activeLayer,
            sel: PS.doc.selection
        };
    }
    function apply(s) {
        PS.doc.width = s.w;
        PS.doc.height = s.h;
        PS.doc.layers = s.layers.slice();
        PS.doc.activeLayer = s.active;
        PS.doc.selection = s.sel;
        PS.updateCanvasSize();
    }
    var before = capture();
    fn();
    var after = capture();
    PS.pushHistory(label,
        function () { apply(before); },
        function () { apply(after); });
    PS.updateCanvasSize();
    PS.requestRender();
    PS.renderLayersPanel();
    PS.updateStatusBar();
};

// returns a NEW layer object with transformed content (originals untouched
// so history restore stays valid)
PS.transformLayer = function (layer, newW, newH, drawFn, textFn) {
    var out = PS.makeLayer(layer.name, newW, newH);
    out.visible = layer.visible;
    out.opacity = layer.opacity;
    out.blend = layer.blend;

    if (layer.type === "text" && layer.text && textFn) {
        out.type = "text";
        out.text = JSON.parse(JSON.stringify(layer.text));
        textFn(out.text);
        PS.renderTextLayer(out);
    } else {
        // raster (or text being rasterized by the transform)
        drawFn(out.canvas.getContext("2d"), layer.canvas);
    }
    return out;
};

PS.resizeImage = function (newW, newH) {
    var d = PS.doc;
    var sx = newW / d.width, sy = newH / d.height;
    PS.docGeometryOp("Resize Image", function () {
        d.layers = d.layers.map(function (layer) {
            return PS.transformLayer(layer, newW, newH, function (ctx, src) {
                ctx.imageSmoothingQuality = "high";
                ctx.drawImage(src, 0, 0, newW, newH);
            }, function (t) {
                t.size = Math.max(1, Math.round(t.size * sy));
                t.x = Math.round(t.x * sx);
                t.y = Math.round(t.y * sy);
            });
        });
        d.width = newW;
        d.height = newH;
        d.selection = null;
    });
};

PS.resizeCanvas = function (newW, newH, anchorX, anchorY) {
    var d = PS.doc;
    var dx = Math.round((newW - d.width) * anchorX);
    var dy = Math.round((newH - d.height) * anchorY);
    PS.docGeometryOp("Canvas Size", function () {
        d.layers = d.layers.map(function (layer) {
            return PS.transformLayer(layer, newW, newH, function (ctx, src) {
                ctx.drawImage(src, dx, dy);
            }, function (t) {
                t.x += dx;
                t.y += dy;
            });
        });
        d.width = newW;
        d.height = newH;
        d.selection = null;
    });
};

PS.cropToSelection = function () {
    var d = PS.doc;
    if (!d.selection) { PS.toast("No selection to crop to", true); return; }
    var b = d.selection.bounds;
    PS.docGeometryOp("Crop", function () {
        d.layers = d.layers.map(function (layer) {
            return PS.transformLayer(layer, b.w, b.h, function (ctx, src) {
                ctx.drawImage(src, -b.x, -b.y);
            }, function (t) {
                t.x -= b.x;
                t.y -= b.y;
            });
        });
        d.width = b.w;
        d.height = b.h;
        d.selection = null;
    });
};

PS.flipImage = function (horizontal) {
    var d = PS.doc;
    PS.docGeometryOp(horizontal ? "Flip Horizontal" : "Flip Vertical", function () {
        d.layers = d.layers.map(function (layer) {
            // text layers are rasterized by flips
            return PS.transformLayer(layer, d.width, d.height, function (ctx, src) {
                ctx.save();
                if (horizontal) { ctx.translate(d.width, 0); ctx.scale(-1, 1); }
                else { ctx.translate(0, d.height); ctx.scale(1, -1); }
                ctx.drawImage(src, 0, 0);
                ctx.restore();
            }, null);
        });
        d.selection = null;
    });
};

PS.rotateImage = function (deg) {
    var d = PS.doc;
    var swap = (deg === 90 || deg === 270);
    var newW = swap ? d.height : d.width;
    var newH = swap ? d.width : d.height;
    PS.docGeometryOp("Rotate " + deg + "°", function () {
        d.layers = d.layers.map(function (layer) {
            return PS.transformLayer(layer, newW, newH, function (ctx, src) {
                ctx.save();
                ctx.translate(newW / 2, newH / 2);
                ctx.rotate(deg * Math.PI / 180);
                ctx.drawImage(src, -src.width / 2, -src.height / 2);
                ctx.restore();
            }, null);
        });
        d.width = newW;
        d.height = newH;
        d.selection = null;
    });
};

/* ---------- dialogs for geometry ops ---------- */

PS.resizeImageDialog = function () {
    var wIn, hIn, lockIn;
    var ratio = PS.doc.width / PS.doc.height;
    PS.dialog({
        title: "Resize Image",
        build: function (body) {
            wIn = PS.dialogRow(body, "Width (px)", PS.numberInput(PS.doc.width, 1, 8192));
            hIn = PS.dialogRow(body, "Height (px)", PS.numberInput(PS.doc.height, 1, 8192));
            var cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = true;
            lockIn = PS.dialogRow(body, "Keep aspect ratio", cb);
            wIn.addEventListener("input", function () {
                if (lockIn.checked) { hIn.value = Math.max(1, Math.round(parseInt(wIn.value, 10) / ratio) || 1); }
            });
            hIn.addEventListener("input", function () {
                if (lockIn.checked) { wIn.value = Math.max(1, Math.round(parseInt(hIn.value, 10) * ratio) || 1); }
            });
        },
        buttons: [
            { label: "Cancel" },
            {
                label: "Resize", primary: true,
                action: function () {
                    var w = PS.clamp(parseInt(wIn.value, 10) || PS.doc.width, 1, 8192);
                    var h = PS.clamp(parseInt(hIn.value, 10) || PS.doc.height, 1, 8192);
                    PS.resizeImage(w, h);
                }
            }
        ]
    });
};

PS.resizeCanvasDialog = function () {
    var wIn, hIn, anchorIn;
    PS.dialog({
        title: "Canvas Size",
        build: function (body) {
            wIn = PS.dialogRow(body, "Width (px)", PS.numberInput(PS.doc.width, 1, 8192));
            hIn = PS.dialogRow(body, "Height (px)", PS.numberInput(PS.doc.height, 1, 8192));
            anchorIn = PS.dialogRow(body, "Anchor", PS.selectInput([
                { v: "0.5,0.5", l: "Center" },
                { v: "0,0", l: "Top Left" },
                { v: "0.5,0", l: "Top" },
                { v: "1,0", l: "Top Right" },
                { v: "0,0.5", l: "Left" },
                { v: "1,0.5", l: "Right" },
                { v: "0,1", l: "Bottom Left" },
                { v: "0.5,1", l: "Bottom" },
                { v: "1,1", l: "Bottom Right" }
            ], "0.5,0.5"));
        },
        buttons: [
            { label: "Cancel" },
            {
                label: "Apply", primary: true,
                action: function () {
                    var a = anchorIn.value.split(",");
                    PS.resizeCanvas(
                        PS.clamp(parseInt(wIn.value, 10) || PS.doc.width, 1, 8192),
                        PS.clamp(parseInt(hIn.value, 10) || PS.doc.height, 1, 8192),
                        parseFloat(a[0]), parseFloat(a[1]));
                }
            }
        ]
    });
};

/* ============================================================
   CLIPBOARD (internal)
   ============================================================ */

PS.copySelection = function (cut, merged) {
    var layer = PS.activeLayer();
    if (!layer) { return; }
    var src = merged ? PS.compositeToCanvas() : layer.canvas;
    var grab = PS.getSelectedPixels(src);
    var b = grab.bounds;

    var cropped = PS.createCanvas(b.w, b.h);
    cropped.getContext("2d").drawImage(grab.canvas, -b.x, -b.y);
    PS.clipboard = { canvas: cropped, x: b.x, y: b.y };

    if (cut) {
        if (layer.type === "text") { PS.toast("Cannot cut from a text layer", true); return; }
        var before = PS.snapshotLayer(layer);
        PS.clearSelectedOnLayer(layer);
        PS.commitLayerCanvas("Cut", layer, before);
        PS.requestRender();
    } else {
        PS.toast(merged ? "Copied (merged)" : "Copied");
    }
};

PS.pasteClipboard = function () {
    if (!PS.clipboard) { PS.toast("Clipboard is empty", true); return; }
    var full = PS.createCanvas(PS.doc.width, PS.doc.height);
    full.getContext("2d").drawImage(PS.clipboard.canvas, PS.clipboard.x, PS.clipboard.y);
    PS.addLayer("Pasted Layer", { canvas: full });
    PS.requestRender();
};

// Drop an Image (from the system clipboard) onto a new, centered layer.
// Content larger than the document is clipped to the canvas.
PS.pasteImageAsLayer = function (img) {
    if (!PS.doc) { return; }
    var d = PS.doc;
    var canvas = PS.createCanvas(d.width, d.height);
    var x = Math.round((d.width - img.naturalWidth) / 2);
    var y = Math.round((d.height - img.naturalHeight) / 2);
    canvas.getContext("2d").drawImage(img, x, y);
    PS.addLayer("Pasted Image", { canvas: canvas });
    PS.requestRender();
    PS.toast("Pasted image as new layer");
};

// Menu "Paste": try the async system clipboard for an image first, then fall
// back to the in-app clipboard. (The Ctrl+V key path uses the paste event.)
PS.pasteFromClipboard = function () {
    if (navigator.clipboard && navigator.clipboard.read) {
        navigator.clipboard.read().then(function (items) {
            for (var i = 0; i < items.length; i++) {
                var types = items[i].types || [];
                for (var j = 0; j < types.length; j++) {
                    if (types[j].indexOf("image") === 0) {
                        items[i].getType(types[j]).then(function (blob) {
                            PS.loadImageBlobAsLayer(blob);
                        });
                        return;
                    }
                }
            }
            PS.pasteClipboard();
        }).catch(function () {
            PS.pasteClipboard();
        });
    } else {
        PS.pasteClipboard();
    }
};

// Load an image Blob and place it on a new layer (shared by paste paths)
PS.loadImageBlobAsLayer = function (blob) {
    var url = URL.createObjectURL(blob);
    var img = new Image();
    img.onload = function () {
        URL.revokeObjectURL(url);
        PS.pasteImageAsLayer(img);
    };
    img.onerror = function () {
        URL.revokeObjectURL(url);
        PS.toast("Could not read pasted image", true);
    };
    img.src = url;
};

/* ---------- edit helpers used by menu/hotkeys ---------- */

PS.fillWithColor = function (hex, label) {
    var layer = PS.requirePaintableLayer();
    if (!layer) { return; }
    var before = PS.snapshotLayer(layer);
    PS.maskedDraw(layer, function (ctx) {
        ctx.fillStyle = hex;
        ctx.fillRect(0, 0, PS.doc.width, PS.doc.height);
    });
    PS.commitLayerCanvas(label || "Fill", layer, before);
    PS.requestRender();
};

PS.clearSelected = function () {
    var layer = PS.requirePaintableLayer();
    if (!layer) { return; }
    var before = PS.snapshotLayer(layer);
    PS.clearSelectedOnLayer(layer);
    PS.commitLayerCanvas("Clear", layer, before);
    PS.requestRender();
};
