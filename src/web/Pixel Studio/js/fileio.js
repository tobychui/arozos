/*
    Pixel Studio - file I/O and document operations
    Opens files through the ArozOS media endpoint, saves through the save
    manager (savemanager.js), and falls back to browser download/upload
    pickers when running outside the ArozOS desktop.

    Native format: .psd (also .psb and OpenRaster .ora). Layered
    files are decoded and encoded in a worker (docio.js) so neither opening
    nor saving blocks the editor.
*/
"use strict";

PS.IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

// Camera RAW formats. The <img> tag cannot decode these, so Pixel Studio hands
// them over to the Raw Editor sub-app (Pixel Studio/raw/) which demosaics them
// in the browser and can pass the developed result back here.
PS.RAW_EXTS = ["arw", "dng", "nef", "cr2", "cr3", "orf", "raf", "rw2", "pef", "srw", "tiff", "tif"];

PS.isRawExt = function (ext) {
    return PS.RAW_EXTS.indexOf(String(ext).toLowerCase()) >= 0;
};

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

/* ---------- File > New ---------- */

// Document presets: [label, width, height, unit, resolution]
PS.DOC_PRESETS = {
    "Default Pixel Studio Size": [["Default Pixel Studio Size", 7, 5, "in", 72]],
    "U.S. Paper": [["Letter", 8.5, 11, "in", 300], ["Legal", 8.5, 14, "in", 300], ["Tabloid", 11, 17, "in", 300]],
    "International Paper": [["A3", 297, 420, "mm", 300], ["A4", 210, 297, "mm", 300], ["A5", 148, 210, "mm", 300],
        ["B4", 250, 353, "mm", 300], ["B5", 176, 250, "mm", 300]],
    "Photo": [["Landscape, 2 x 3", 3, 2, "in", 300], ["Landscape, 4 x 6", 6, 4, "in", 300], ["Landscape, 5 x 7", 7, 5, "in", 300],
        ["Landscape, 8 x 10", 10, 8, "in", 300], ["Portrait, 2 x 3", 2, 3, "in", 300], ["Portrait, 4 x 6", 4, 6, "in", 300],
        ["Portrait, 5 x 7", 5, 7, "in", 300], ["Portrait, 8 x 10", 8, 10, "in", 300]],
    "Web": [["640 x 480", 640, 480, "px", 72], ["800 x 600", 800, 600, "px", 72], ["1024 x 768", 1024, 768, "px", 72],
        ["1280 x 1024", 1280, 1024, "px", 72], ["1366 x 768", 1366, 768, "px", 72], ["1440 x 900", 1440, 900, "px", 72],
        ["1600 x 1200", 1600, 1200, "px", 72], ["1920 x 1080", 1920, 1080, "px", 72], ["Web Banner 728 x 90", 728, 90, "px", 72],
        ["Social Square 1080 x 1080", 1080, 1080, "px", 72]],
    "Mobile & Devices": [["320 x 480", 320, 480, "px", 72], ["640 x 960", 640, 960, "px", 72], ["640 x 1136", 640, 1136, "px", 72],
        ["750 x 1334", 750, 1334, "px", 72], ["1080 x 1920", 1080, 1920, "px", 72], ["1536 x 2048", 1536, 2048, "px", 72],
        ["2048 x 1536", 2048, 1536, "px", 72]],
    "Film & Video": [["NTSC DV 720 x 480", 720, 480, "px", 72], ["PAL D1/DV 720 x 576", 720, 576, "px", 72],
        ["HDV/HDTV 720p", 1280, 720, "px", 72], ["HDTV 1080p", 1920, 1080, "px", 72], ["UHD 4K 3840 x 2160", 3840, 2160, "px", 72],
        ["DCI 4K 4096 x 2160", 4096, 2160, "px", 72]]
};

PS.UNITS = [
    { v: "px", l: "Pixels" }, { v: "in", l: "Inches" }, { v: "cm", l: "Centimeters" },
    { v: "mm", l: "Millimeters" }, { v: "pt", l: "Points" }, { v: "pica", l: "Picas" }
];

// Length in a unit -> pixels at a resolution (ppi)
PS.unitToPx = function (v, unit, ppi) {
    switch (unit) {
        case "in": return v * ppi;
        case "cm": return v / 2.54 * ppi;
        case "mm": return v / 25.4 * ppi;
        case "pt": return v / 72 * ppi;
        case "pica": return v / 6 * ppi;
    }
    return v;
};

PS.pxToUnit = function (px, unit, ppi) {
    var v = PS.unitToPx(1, unit, ppi);
    return px / v;
};

PS.formatBytes = function (n) {
    if (n >= 1024 * 1024 * 1024) { return (n / 1073741824).toFixed(2) + "G"; }
    if (n >= 1024 * 1024) { return (n / 1048576).toFixed(2) + "M"; }
    return Math.round(n / 1024) + "K";
};

PS._newDocCounter = 1;

PS._showNewDocPanel = function (opts) {
    var created = false;
    var userPresets = (PS.prefs && PS.prefs.docPresets) || {};
    var last = (PS.prefs && PS.prefs.lastNewDoc) || null;
    var st = {
        name: "Untitled-" + (PS._newDocCounter),
        preset: "Clipboard",
        size: "",
        w: 830, h: 511, wUnit: "px", hUnit: "px",
        res: 72, resUnit: "ppi",
        mode: "rgb8",
        bg: "white"
    };
    if (last) { Object.assign(st, last, { name: st.name, preset: "Custom" }); }
    var clipW = 0, clipH = 0;
    if (PS.clipboard && PS.clipboard.canvas) { clipW = PS.clipboard.canvas.width; clipH = PS.clipboard.canvas.height; }
    if (clipW && clipH) { st.preset = "Clipboard"; st.w = clipW; st.h = clipH; st.wUnit = st.hUnit = "px"; st.res = 72; }
    else if (!last) { st.preset = "Default Pixel Studio Size"; }

    var el = {};

    function ppi() { return st.resUnit === "ppcm" ? st.res * 2.54 : st.res; }
    function pxW() { return Math.round(PS.unitToPx(st.w, st.wUnit, ppi())); }
    function pxH() { return Math.round(PS.unitToPx(st.h, st.hUnit, ppi())); }
    function fmt(v) { return String(Math.round(v * 1000) / 1000); }

    function presetOptions() {
        var out = [{ v: "Clipboard", l: "Clipboard" }];
        Object.keys(PS.DOC_PRESETS).forEach(function (k) { out.push({ v: k, l: k }); });
        Object.keys(userPresets).forEach(function (k) { out.push({ v: "user:" + k, l: k }); });
        out.push({ v: "Custom", l: "Custom" });
        return out;
    }

    function applySize(p) {
        st.w = p[1]; st.h = p[2]; st.wUnit = st.hUnit = p[3]; st.res = p[4]; st.resUnit = "ppi";
    }

    function choosePreset(v) {
        st.preset = v;
        if (v === "Clipboard") {
            if (clipW) { st.w = clipW; st.h = clipH; st.wUnit = st.hUnit = "px"; }
            readSystemClipboardSize();
        } else if (v.indexOf("user:") === 0) {
            var u = userPresets[v.slice(5)];
            if (u) { Object.assign(st, u, { name: st.name, preset: v }); }
        } else if (PS.DOC_PRESETS[v]) {
            var list = PS.DOC_PRESETS[v];
            var pick = list.filter(function (p) { return p[0] === st.size; })[0] || (v === "International Paper" ? list[1] : list[0]);
            st.size = pick[0];
            applySize(pick);
        }
        refresh();
    }

    // the Clipboard preset: the size of an image on the system clipboard
    function readSystemClipboardSize() {
        if (!navigator.clipboard || !navigator.clipboard.read) { return; }
        navigator.clipboard.read().then(function (items) {
            for (var i = 0; i < items.length; i++) {
                var t = (items[i].types || []).filter(function (x) { return x.indexOf("image") === 0; })[0];
                if (t) {
                    return items[i].getType(t).then(function (blob) { return createImageBitmap(blob); }).then(function (bmp) {
                        if (st.preset !== "Clipboard") { return; }
                        st.w = bmp.width; st.h = bmp.height; st.wUnit = st.hUnit = "px";
                        clipW = bmp.width; clipH = bmp.height;
                        refresh();
                    });
                }
            }
        }).catch(function () { /* no permission or no image: keep the internal clipboard size */ });
    }

    function refresh() {
        el.preset.innerHTML = "";
        presetOptions().forEach(function (o) {
            var op = document.createElement("option");
            op.value = o.v; op.textContent = o.l;
            el.preset.appendChild(op);
        });
        el.preset.value = st.preset;
        el.size.innerHTML = "";
        var sizes = PS.DOC_PRESETS[st.preset];
        el.size.disabled = !sizes;
        (sizes || []).forEach(function (p) {
            var op = document.createElement("option");
            op.value = p[0]; op.textContent = p[0];
            el.size.appendChild(op);
        });
        if (sizes) { el.size.value = st.size; }
        if (document.activeElement !== el.w) { el.w.value = fmt(st.w); }
        if (document.activeElement !== el.h) { el.h.value = fmt(st.h); }
        if (document.activeElement !== el.res) { el.res.value = fmt(st.res); }
        el.wUnit.value = st.wUnit;
        el.hUnit.value = st.hUnit;
        el.resUnit.value = st.resUnit;
        el.bg.value = st.bg;
        var w = pxW(), h = pxH();
        el.imgSize.textContent = PS.formatBytes(w * h * 3);
        el.pxSize.textContent = w + " x " + h + " pixels";
        var tooBig = w > PS.MAX_DOC_SIZE || h > PS.MAX_DOC_SIZE || w < 1 || h < 1;
        el.warn.textContent = tooBig ? "Pixel Studio documents are limited to " + PS.MAX_DOC_SIZE + " x " + PS.MAX_DOC_SIZE + " pixels." : "";
        el.ok.disabled = tooBig;
        el.del.disabled = st.preset.indexOf("user:") !== 0;
    }

    // typing a size leaves the preset (shown as "Custom")
    function custom() {
        if (st.preset.indexOf("user:") !== 0) { st.preset = "Custom"; }
    }

    function row(body, label, input, extra) {
        var r = document.createElement("div");
        r.className = "nd-row";
        var l = document.createElement("label");
        l.textContent = label;
        r.appendChild(l);
        r.appendChild(input);
        if (extra) { r.appendChild(extra); }
        body.appendChild(r);
        return r;
    }

    function create() {
        var w = pxW(), h = pxH();
        if (w < 1 || h < 1 || w > PS.MAX_DOC_SIZE || h > PS.MAX_DOC_SIZE) { return false; }
        created = true;
        PS.prefs = PS.prefs || {};
        PS.prefs.lastNewDoc = { w: st.w, h: st.h, wUnit: st.wUnit, hUnit: st.hUnit, res: st.res, resUnit: st.resUnit, bg: st.bg };
        PS.savePrefsDebounced();
        PS._newDocCounter++;
        var name = (st.name || "Untitled").trim();
        PS.newDocument({ width: w, height: h, background: st.bg, name: name });
        // resolution travels with the document (and into the PSD)
        PS.doc.psd = {
            imageResources: {
                resolutionInfo: {
                    horizontalResolution: st.res, horizontalResolutionUnit: st.resUnit === "ppcm" ? "PPCM" : "PPI",
                    widthUnit: st.wUnit === "cm" || st.wUnit === "mm" ? "Centimeters" : "Inches",
                    verticalResolution: st.res, verticalResolutionUnit: st.resUnit === "ppcm" ? "PPCM" : "PPI",
                    heightUnit: st.hUnit === "cm" || st.hUnit === "mm" ? "Centimeters" : "Inches"
                }
            }
        };
        PS.updateStatusBar();
        return true;
    }

    var dlg = PS.dialog({
        title: "New",
        build: function (body, d) {
            body.classList.add("nd-body");
            var left = document.createElement("div");
            left.className = "nd-left";
            var right = document.createElement("div");
            right.className = "nd-right";
            body.appendChild(left);
            body.appendChild(right);

            el.name = document.createElement("input");
            el.name.value = st.name;
            el.name.className = "nd-wide";
            el.name.addEventListener("input", function () { st.name = el.name.value; });
            row(left, "Name:", el.name);

            var box = document.createElement("fieldset");
            box.className = "nd-box";
            left.appendChild(box);
            el.preset = document.createElement("select");
            el.preset.className = "nd-wide";
            el.preset.addEventListener("change", function () { choosePreset(el.preset.value); });
            row(box, "Preset:", el.preset);
            el.size = document.createElement("select");
            el.size.className = "nd-wide";
            el.size.addEventListener("change", function () {
                var p = (PS.DOC_PRESETS[st.preset] || []).filter(function (x) { return x[0] === el.size.value; })[0];
                if (p) { st.size = p[0]; applySize(p); refresh(); }
            });
            row(box, "Size:", el.size);

            function numUnit(label, key, unitKey, units) {
                var n = document.createElement("input");
                n.type = "text";
                n.className = "nd-num";
                n.addEventListener("input", function () {
                    var v = parseFloat(n.value);
                    if (v > 0) { st[key] = v; custom(); refresh(); }
                });
                var u = PS.selectInput(units, st[unitKey]);
                u.className = "nd-unit";
                u.addEventListener("change", function () {
                    // keep the physical size when switching units
                    if (key === "res") {
                        var p = ppi();
                        st.resUnit = u.value;
                        st.res = u.value === "ppcm" ? p / 2.54 : p;
                    } else {
                        var px = PS.unitToPx(st[key], st[unitKey], ppi());
                        st[unitKey] = u.value;
                        st[key] = PS.pxToUnit(px, u.value, ppi());
                    }
                    custom();
                    refresh();
                });
                row(box, label, n, u);
                return [n, u];
            }
            var wu = numUnit("Width:", "w", "wUnit", PS.UNITS);
            el.w = wu[0]; el.wUnit = wu[1];
            var hu = numUnit("Height:", "h", "hUnit", PS.UNITS);
            el.h = hu[0]; el.hUnit = hu[1];
            var ru = numUnit("Resolution:", "res", "resUnit", [{ v: "ppi", l: "Pixels/Inch" }, { v: "ppcm", l: "Pixels/Centimeter" }]);
            el.res = ru[0]; el.resUnit = ru[1];
            // resolution changes keep the pixel size of pixel-sized documents
            var modeSel = PS.selectInput([{ v: "rgb", l: "RGB Color" }, { v: "gray", l: "Grayscale (opens as RGB)" }], "rgb");
            modeSel.className = "nd-mode";
            var depthSel = PS.selectInput([{ v: "8", l: "8 bit" }], "8");
            depthSel.className = "nd-unit";
            depthSel.disabled = true;
            row(box, "Color Mode:", modeSel, depthSel);
            el.bg = PS.selectInput([{ v: "white", l: "White" }, { v: "bgcolor", l: "Background Color" }, { v: "transparent", l: "Transparent" }], st.bg);
            el.bg.className = "nd-wide";
            el.bg.addEventListener("change", function () { st.bg = el.bg.value; });
            row(box, "Background Contents:", el.bg);

            var adv = document.createElement("div");
            adv.className = "nd-advanced";
            var advHead = document.createElement("button");
            advHead.className = "nd-adv-toggle";
            advHead.innerHTML = '<svg viewBox="0 0 10 10"><path d="M1.5 3h7L5 7.5z" fill="currentColor"/></svg> Advanced';
            var advBody = document.createElement("div");
            advBody.className = "nd-adv-body";
            var prof = PS.selectInput([{ v: "srgb", l: "Working RGB: sRGB IEC61966-2.1" }], "srgb");
            prof.className = "nd-wide";
            row(advBody, "Color Profile:", prof);
            var par = PS.selectInput([{ v: "square", l: "Square Pixels" }], "square");
            par.className = "nd-wide";
            row(advBody, "Pixel Aspect Ratio:", par);
            advHead.addEventListener("click", function () { adv.classList.toggle("open"); });
            adv.appendChild(advHead);
            adv.appendChild(advBody);
            box.appendChild(adv);

            el.warn = document.createElement("div");
            el.warn.className = "nd-warn";
            left.appendChild(el.warn);

            el.ok = document.createElement("button");
            el.ok.className = "primary";
            el.ok.textContent = "OK";
            el.ok.addEventListener("click", function () { if (create() !== false) { d.close(); } });
            var cancel = document.createElement("button");
            cancel.textContent = "Cancel";
            cancel.addEventListener("click", function () { d.close(); });
            var savePre = document.createElement("button");
            savePre.textContent = "Save Preset...";
            savePre.addEventListener("click", function () {
                var nm = window.prompt("Preset name:", pxW() + " x " + pxH());
                if (!nm) { return; }
                userPresets[nm] = { w: st.w, h: st.h, wUnit: st.wUnit, hUnit: st.hUnit, res: st.res, resUnit: st.resUnit, bg: st.bg };
                PS.prefs = PS.prefs || {};
                PS.prefs.docPresets = userPresets;
                PS.savePrefsDebounced();
                st.preset = "user:" + nm;
                refresh();
            });
            el.del = document.createElement("button");
            el.del.textContent = "Delete Preset...";
            el.del.addEventListener("click", function () {
                if (st.preset.indexOf("user:") !== 0) { return; }
                delete userPresets[st.preset.slice(5)];
                PS.prefs.docPresets = userPresets;
                PS.savePrefsDebounced();
                st.preset = "Custom";
                refresh();
            });
            [el.ok, cancel, savePre, el.del].forEach(function (b) { b.classList.add("nd-btn"); right.appendChild(b); });
            var info = document.createElement("div");
            info.className = "nd-info";
            info.innerHTML = '<div>Image Size:</div><div class="nd-bytes"></div><div class="nd-px"></div>';
            right.appendChild(info);
            el.imgSize = info.querySelector(".nd-bytes");
            el.pxSize = info.querySelector(".nd-px");

            if (st.preset === "Clipboard") { readSystemClipboardSize(); }
            if (PS.DOC_PRESETS[st.preset]) { choosePreset(st.preset); } else { refresh(); }
        },
        // hidden default button: Enter creates the document
        buttons: [{ label: "OK", primary: true, action: function () { return create(); } }],
        onClose: function () {
            if (!created && opts.mandatory && !PS.doc) {
                PS.newDocument({ width: 1000, height: 700, background: "white" });
            }
        }
    });
    dlg.root.classList.add("nd-dialog");
    setTimeout(function () { el.name.focus(); el.name.select(); }, 0);
};

/* ---------- open ---------- */

// Layered formats Pixel Studio reads and writes itself (in a worker)
PS.LAYERED_EXTS = ["psd", "psb", "ora"];
// Flat formats it can write from the composite
PS.FLAT_WRITE_EXTS = ["png", "jpg", "jpeg", "webp"];

PS.isLayeredExt = function (ext) { return PS.LAYERED_EXTS.indexOf(ext) >= 0; };

PS.fileOpenDialog = function () {
    PS.confirmDiscard(function () {
        if (PS.inArozOS() && typeof ao_module_openFileSelector !== "undefined") {
            window.psOpenCallback = function psOpenCallback(filedata) {
                if (!filedata || !filedata.length) { return; }
                PS.openFromPath(filedata[0].filepath, filedata[0].filename);
            };
            ao_module_openFileSelector(window.psOpenCallback, "user:/Desktop", "file", false, {
                path_memory_key: "project"
            });
        } else {
            // standalone fallback
            var inp = document.createElement("input");
            inp.type = "file";
            // RAW files are not listed here: outside ArozOS there is no storage
            // path to hand to the Raw Editor sub-app.
            inp.accept = ".psd,.psb,.ora,.png,.jpg,.jpeg,.gif,.webp,.bmp";
            inp.addEventListener("change", function () {
                if (inp.files.length) { PS.openFromBlob(inp.files[0], inp.files[0].name); }
            });
            inp.click();
        }
    });
};

PS.mediaUrl = function (filepath) {
    return "../media/?file=" + encodeURIComponent(filepath);
};

PS.openFromPath = function (filepath, filename) {
    var url = PS.mediaUrl(filepath);
    var ext = PS.extOf(filename);

    if (PS.isLayeredExt(ext)) {
        PS.showBusy("Opening " + filename + "...");
        fetch(url)
            .then(function (r) {
                if (!r.ok) { throw new Error("HTTP " + r.status); }
                return r.arrayBuffer();
            })
            .then(function (buf) { PS.openLayeredBuffer(buf, filepath, filename); })
            .catch(function (err) {
                PS.hideBusy();
                PS.toast("Cannot open " + filename + ": " + err.message, true);
            });
        return;
    }

    if (PS.IMAGE_EXTS.indexOf(ext) < 0) {
        // Not something the browser can decode. If it is a camera RAW file,
        // forward the open request to the Raw Editor sub-app instead of failing.
        if (PS.isRawExt(ext)) {
            PS.openInRawEditor(filepath, filename);
            return;
        }
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

// Decode a PSD / PSB / ORA file in the document worker and open it. When
// its layers cannot be read (newer features the reader does not
// understand), the file opens as its flattened image instead.
PS.openLayeredBuffer = function (buf, filepath, filename) {
    PS.showBusy("Reading " + filename + "...");
    var ext = PS.extOf(filename);
    var spare = buf.slice(0);   // the worker takes ownership of buf
    return PS.docio.read(buf, ext, function (progress) {
        PS.showBusy("Reading " + filename + "... " + Math.round(progress * 100) + "%");
    }).then(function (result) {
        PS.hideBusy();
        PS.loadDecodedDocument(result, filepath, filename);
    }).catch(function (err) {
        console.error(err);
        PS.showBusy("Reading the flattened image of " + filename + "...");
        return PS.docio.readComposite(spare, ext).then(function (img) {
            PS.hideBusy();
            PS.loadDecodedDocument({
                format: ext === "ora" ? "ora" : "psd",
                meta: { width: img.width, height: img.height },
                layers: [],
                composite: { left: 0, top: 0, width: img.width, height: img.height, data: img.data }
            }, filepath, filename);
            PS.doc.lossyImport = true;
            PS.doc.importNotes = [{ lossy: true, text: "The layers could not be read (" + (err && err.message ? err.message : err) + "), so the flattened image was opened" }];
            PS.showImportNotes(PS.doc.importNotes);
        }).catch(function (err2) {
            PS.hideBusy();
            PS.toast("Cannot open " + filename + ": " + (err && err.message ? err.message : err2), true);
        });
    });
};

// Hand a camera RAW file over to the Raw Editor sub-app. Inside the ArozOS
// desktop it opens as its own float window (from there "Open in Pixel Studio"
// sends the developed image back); standalone we navigate to it in place.
// Both entry points into openFromPath either have no document yet (launch
// "open with") or have already run confirmDiscard, so nothing is lost.
// Called without a file it just launches an empty Raw Editor (File > Raw Editor).
PS.openInRawEditor = function (filepath, filename) {
    var hash = filepath
        ? "#" + encodeURIComponent(JSON.stringify([{ filename: filename, filepath: filepath }]))
        : "";

    if (PS.inArozOS() && typeof ao_module_newfw !== "undefined") {
        ao_module_newfw({
            url: "Pixel Studio/raw/index.html" + hash,
            width: 1200,
            height: 760,
            appicon: "Pixel Studio/raw/img/module_icon.svg",
            title: filename ? "Raw Editor - " + filename : "Raw Editor"
        });
        if (filepath) { PS.toast("RAW file opened in Raw Editor"); }
        // Pixel Studio was launched only to open this RAW file - there is no
        // document to come back to, so close the empty float window.
        var inDesktop = (typeof ao_module_virtualDesktop !== "undefined" && ao_module_virtualDesktop);
        if (filepath && !PS.doc && inDesktop) {
            try { ao_module_close(); } catch (e) { /* not running in a float window */ }
        }
        return;
    }

    // Standalone (no ArozOS desktop): navigate in place when we are here to
    // open a file, otherwise pop the editor into its own tab.
    if (filepath) { window.location.href = "raw/index.html" + hash; }
    else { window.open("raw/index.html"); }
};

// Open a file's data as the document; resolves once it is open. filepath
// (optional) is where Save writes back to.
PS.openFromBlob = function (blob, filename, filepath) {
    var ext = PS.extOf(filename);
    if (PS.isLayeredExt(ext)) {
        return blob.arrayBuffer().then(function (buf) { return PS.openLayeredBuffer(buf, filepath || "", filename); });
    }
    return new Promise(function (resolve) {
        var url = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function () {
            URL.revokeObjectURL(url);
            PS.docFromImage(img, filepath || "", filename, ext);
            resolve();
        };
        img.onerror = function () {
            URL.revokeObjectURL(url);
            PS.toast("Cannot load image: " + filename, true);
            resolve();
        };
        img.src = url;
    });
};

/* ---------- drag and drop ---------- */

// Files dropped anywhere on Pixel Studio, from the computer or from the
// ArozOS file manager / desktop (their "filedata" carries storage paths):
//   no document open    the first file opens (a PSD keeps its layers), the
//                       rest are placed into it
//   a document open     each file is placed on a new layer, a PSD / ORA as
//                       its flattened image, centred, scaled down to fit and
//                       left in Free Transform (Enter places it)
PS.IMAGE_EXTS_DROP = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico"];

PS.isDroppableName = function (name) {
    var ext = PS.extOf(name || "");
    return PS.isLayeredExt(ext) || PS.IMAGE_EXTS_DROP.indexOf(ext) >= 0 || PS.isRawExt(ext);
};

// the data of a dropped item: a File, or a file in the user's storage
PS.droppedBlob = function (it) {
    if (it.file) { return Promise.resolve(it.file); }
    return fetch(PS.mediaUrl(it.path)).then(function (r) {
        if (!r.ok) { throw new Error("HTTP " + r.status); }
        return r.blob();
    });
};

// The flattened image of a decoded layered file, rendered here (files saved
// without the composite image)
PS.flattenDecoded = function (result) {
    var saved = PS.doc;
    var meta = result.meta || {};
    var doc = PS.makeDocument(meta.width, meta.height, {});
    try {
        PS.doc = doc;
        if (result.format === "ora") { PS.importOraTree(result, doc, []); }
        else { PS.importPsdTree(result, doc, []); }
        return PS.renderer.compositeCanvas();
    } finally {
        PS.doc = saved;
        PS.requestRender();
    }
};

// A dropped file as one flat canvas
PS.droppedCanvas = function (it) {
    var ext = PS.extOf(it.name);
    return PS.droppedBlob(it).then(function (blob) {
        if (PS.isLayeredExt(ext)) {
            return blob.arrayBuffer().then(function (buf) {
                var spare = buf.slice(0);
                return PS.docio.readComposite(buf, ext).then(function (img) {
                    return PS.blockCanvas(img);
                }, function () {
                    // no composite in the file: read the layers and flatten them
                    return PS.docio.read(spare, ext).then(PS.flattenDecoded);
                });
            });
        }
        return createImageBitmap(blob).then(function (bmp) {
            var c = PS.createCanvas(bmp.width, bmp.height);
            c.getContext("2d").drawImage(bmp, 0, 0);
            if (bmp.close) { bmp.close(); }
            return c;
        });
    });
};

// File > Place behaviour: the image on a new layer, centred and fitted
PS.placeCanvasAsLayer = function (src, name) {
    var d = PS.doc;
    var scale = Math.min(1, d.width / src.width, d.height / src.height);
    var w = Math.max(1, Math.round(src.width * scale)), h = Math.max(1, Math.round(src.height * scale));
    var layer = PS.makeLayer(name || ("Layer " + PS._layerIdSeq), d.width, d.height);
    var ctx = layer.canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, Math.round((d.width - w) / 2), Math.round((d.height - h) / 2), w, h);
    PS.addLayerObject(layer, "Place");
    PS.requestRender();
    PS.renderLayersPanel();
    if (PS.transform && PS.transform.begin({ kind: "layers" })) {
        PS.toast("Placed " + name + " - press Enter to commit, Esc to keep it as placed");
    }
    return layer;
};

PS.placeDropped = function (it) {
    if (PS.isRawExt(PS.extOf(it.name))) {
        if (it.path) { PS.openInRawEditor(it.path, it.name); }
        else { PS.toast(it.name + ": develop camera RAW files in the Raw Editor first", true); }
        return Promise.resolve();
    }
    PS.showBusy("Placing " + it.name + "...");
    return PS.droppedCanvas(it).then(function (c) {
        PS.hideBusy();
        if (PS.transform && PS.transform.active) { PS.transform.commit(); }
        PS.placeCanvasAsLayer(c, it.name.replace(/\.[^.]+$/, ""));
    }, function (err) {
        PS.hideBusy();
        PS.toast("Cannot place " + it.name + ": " + (err && err.message ? err.message : err), true);
    });
};

PS.openDropped = function (it) {
    if (PS.isRawExt(PS.extOf(it.name))) { return PS.placeDropped(it); }
    PS.showBusy("Opening " + it.name + "...");
    return PS.droppedBlob(it).then(function (blob) {
        PS.hideBusy();
        return PS.openFromBlob(blob, it.name, it.path || "");
    }, function (err) {
        PS.hideBusy();
        PS.toast("Cannot open " + it.name + ": " + (err && err.message ? err.message : err), true);
    });
};

PS.handleDroppedItems = function (items) {
    var list = items.filter(function (it) { return PS.isDroppableName(it.name); });
    if (!list.length) {
        PS.toast("Pixel Studio cannot open " + (items.length === 1 ? items[0].name : "these files"), true);
        return;
    }
    if (PS.textEdit) { PS.commitTextEdit(); }
    var chain = Promise.resolve();
    list.forEach(function (it) {
        chain = chain.then(function () { return PS.doc ? PS.placeDropped(it) : PS.openDropped(it); });
    });
    chain.catch(function (err) { console.error(err); });
};

PS.bindDropTarget = function () {
    var depth = 0;
    var hint = null;
    function isFileDrag(e) {
        var types = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.types) || []);
        return types.indexOf("Files") >= 0 || types.indexOf("filedata") >= 0;
    }
    function showHint(on) {
        if (on && !hint) {
            hint = document.createElement("div");
            hint.id = "drop-hint";
            document.body.appendChild(hint);
        }
        if (hint) {
            hint.textContent = PS.doc ? "Drop to place as a new layer" : "Drop to open";
            hint.style.display = on ? "flex" : "none";
        }
    }
    document.addEventListener("dragenter", function (e) {
        if (!isFileDrag(e)) { return; }
        depth++;
        showHint(true);
        e.preventDefault();
    });
    document.addEventListener("dragover", function (e) {
        if (!isFileDrag(e)) { return; }
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
    });
    document.addEventListener("dragleave", function (e) {
        if (!isFileDrag(e)) { return; }
        depth = Math.max(0, depth - 1);
        if (!depth) { showHint(false); }
    });
    document.addEventListener("drop", function (e) {
        if (!isFileDrag(e)) { return; }
        e.preventDefault();
        depth = 0;
        showHint(false);
        var items = [];
        var aroz = "";
        try { aroz = e.dataTransfer.getData("filedata"); } catch (err) { aroz = ""; }
        if (aroz) {
            try {
                JSON.parse(aroz).forEach(function (f) {
                    if (f && f.filepath) { items.push({ name: f.filename || f.filepath.split("/").pop(), path: f.filepath }); }
                });
            } catch (err2) { /* not ArozOS data */ }
        }
        if (!items.length && e.dataTransfer.files) {
            Array.prototype.forEach.call(e.dataTransfer.files, function (f) { items.push({ name: f.name, file: f }); });
        }
        if (items.length) { PS.handleDroppedItems(items); }
    });
};

PS.docFromImage = function (img, filepath, filename, ext) {
    var w = img.naturalWidth, h = img.naturalHeight;
    if (w > PS.MAX_DOC_SIZE || h > PS.MAX_DOC_SIZE) {
        PS.toast("Image is larger than " + PS.MAX_DOC_SIZE + " px - it cannot be edited here", true);
        return;
    }
    PS.doc = PS.makeDocument(w, h, { name: filename, filePath: filepath, format: ext });
    var layer = PS.makeLayer("Background", w, h);
    layer.canvas.getContext("2d").drawImage(img, 0, 0);
    PS.doc.root.children.push(layer);
    PS.doc.active = layer;
    PS.startDocument("Open");
};

/* ---------- busy indicator (opening files) ---------- */

PS.showBusy = function (text) {
    var el = PS.el("busy-indicator");
    if (!el) {
        el = document.createElement("div");
        el.id = "busy-indicator";
        el.innerHTML = '<span class="busy-spinner"></span><span class="busy-text"></span>';
        document.body.appendChild(el);
    }
    el.querySelector(".busy-text").textContent = text;
    el.style.display = "flex";
};

PS.hideBusy = function () {
    var el = PS.el("busy-indicator");
    if (el) { el.style.display = "none"; }
};

/* ---------- save ---------- */

// True when writing the document into the given filename would silently throw
// structure away, i.e. a layered document going into a flat image format.
PS.wouldFlatten = function (filename) {
    if (!PS.doc) { return false; }
    if (PS.isLayeredExt(PS.extOf(filename))) { return false; }
    var all = PS.allLayers();
    return all.length > 1 || all.some(function (l) {
        return l.kind !== "raster" || l.mask || l.effects || l.blend !== "normal" || l.opacity < 1;
    });
};

// Swap whatever extension a name carries for .psd
PS.asProjectName = function (filename) {
    return filename.replace(/\.[^.]+$/, "") + ".psd";
};

PS.fileSave = function () {
    if (!PS.doc) { PS.toast("No document to save", true); return; }
    if (PS.commitTextEdit) { PS.commitTextEdit(); }
    // Never overwrite in place when that would flatten the document, or when
    // the file was opened from a format Pixel Studio cannot write back
    var ext = PS.extOf(PS.doc.fileName);
    var canWriteBack = PS.isLayeredExt(ext) || PS.FLAT_WRITE_EXTS.indexOf(ext) >= 0;
    if (!PS.doc.filePath || !canWriteBack || PS.wouldFlatten(PS.doc.fileName)) { PS.fileSaveAs(); return; }
    PS.saveManager.confirmLossyOverwrite(function () {
        PS.saveManager.save({ filepath: PS.doc.filePath, filename: PS.doc.fileName, reason: "save" });
    });
};

PS.fileSaveAs = function () {
    if (!PS.doc) { PS.toast("No document to save", true); return; }
    if (PS.commitTextEdit) { PS.commitTextEdit(); }
    var defaultName = PS.doc.fileName;
    if (PS.extOf(defaultName) === "") { defaultName += ".psd"; }

    if (PS.wouldFlatten(defaultName) || PS.FLAT_WRITE_EXTS.concat(PS.LAYERED_EXTS).indexOf(PS.extOf(defaultName)) < 0) {
        defaultName = PS.asProjectName(defaultName);
    }

    if (PS.inArozOS() && typeof ao_module_openFileSelector !== "undefined") {
        window.psSaveAsCallback = function psSaveAsCallback(filedata) {
            if (!filedata || !filedata.length) { return; }
            var f = filedata[0];
            PS.writeDocumentTo(f.filepath, f.filename);
        };
        // start the picker where the document came from, falling back to Desktop
        var startDir = PS.doc.filePath ? PS.dirOf(PS.doc.filePath) : "user:/Desktop";
        ao_module_openFileSelector(window.psSaveAsCallback, startDir, "new", false, {
            defaultName: defaultName,
            path_memory_key: "project",
            //An unsaved document has no folder of its own to start from, so open
            //wherever Pixel Studio was last used instead
            force_path_overwrite: !PS.doc.filePath
        });
    } else {
        PS.saveManager.save({ filepath: "", filename: defaultName, reason: "download" });
    }
};

/* ---------- closing the window ---------- */

// The desktop calls ao_module_close() when the window's close button is
// pressed (and so does File > Close): unsaved work is never thrown away
// without asking. "Save" closes the window once that save has finished.
PS.closeAfterSave = null;   // {doc}: the next save of this document closes the window

PS.reallyClose = function () {
    // no second question from the page's beforeunload guard
    if (PS.doc) { PS.doc.dirty = false; }
    if (typeof ao_module_closeHandler === "function") {
        ao_module_closeHandler();
    } else {
        PS.toast("Close the browser tab to exit");
    }
};

PS.requestClose = function () {
    if (PS.commitTextEdit) { PS.commitTextEdit(); }
    if (PS.transform && PS.transform.active) { PS.transform.commit(); }
    var d = PS.doc;
    if (!d || !d.dirty) {
        if (PS.saveManager && PS.saveManager.isBusy()) {
            // a save is still writing: close when it is done
            PS.toast("Finishing the save before closing...");
            var wait = setInterval(function () {
                if (PS.saveManager.isBusy()) { return; }
                clearInterval(wait);
                if (!PS.doc || !PS.doc.dirty) { PS.reallyClose(); }
            }, 200);
            return;
        }
        PS.reallyClose();
        return;
    }
    PS.dialog({
        title: "Pixel Studio",
        resizable: false,
        build: function (body) {
            body.textContent = "Save changes to the document \u201c" + d.fileName + "\u201d before closing?";
        },
        buttons: [
            { label: "Cancel" },
            {
                label: "Don't Save", action: function () {
                    // thrown away on purpose: no recovery copy is offered next time
                    if (PS.saveManager && PS.saveManager.recovery) { PS.saveManager.recovery.remove(d); }
                    PS.reallyClose();
                }
            },
            {
                label: "Save", primary: true, action: function () {
                    PS.closeAfterSave = { doc: d };
                    PS.fileSave();
                }
            }
        ]
    });
};

// A save the user backed out of (Save As cancelled) must not close the window
// later: any work on the canvas forgets the pending close
document.addEventListener("pointerdown", function (e) {
    if (PS.closeAfterSave && e.target && e.target.closest && e.target.closest("#workspace, #toolbar, #dock")) {
        PS.closeAfterSave = null;
    }
}, true);

window.ao_module_close = PS.requestClose;

// Save As target picked: unknown extensions become .psd; a flat format
// asks before discarding the layers
PS.writeDocumentTo = function (filepath, filename) {
    var ext = PS.extOf(filename);
    if (!PS.isLayeredExt(ext) && PS.FLAT_WRITE_EXTS.indexOf(ext) < 0) {
        filename += ".psd";
        filepath += ".psd";
        ext = "psd";
    }
    function go() {
        PS.saveManager.save({ filepath: filepath, filename: filename, reason: "saveas" });
    }
    if (PS.wouldFlatten(filename)) {
        PS.dialog({
            title: "Flatten Image?",
            build: function (body) {
                body.textContent = "." + ext + " files hold a single flat image. The saved file will " +
                    "not keep layers, masks or layer styles - the open document stays layered. " +
                    "Save as .psd to keep everything.";
            },
            buttons: [
                { label: "Cancel" },
                { label: "Save Flat Copy", primary: true, action: go }
            ]
        });
        return;
    }
    go();
};

PS.downloadBlob = function (blob, filename) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
};

/* ---------- export (flat copies, never changes the document's file) ---------- */

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
                PS.saveManager.save({
                    filepath: f.filepath, filename: f.filename, reason: "export",
                    format: format, quality: quality
                });
            };
            ao_module_openFileSelector(window.psExportCallback, "user:/Desktop", "new", false, {
                defaultName: filename,
                path_memory_key: "export"
            });
        } else {
            PS.saveManager.save({ filepath: "", filename: filename, reason: "export", format: format, quality: quality });
        }
    }

    if (format === "jpg" || format === "webp") {
        var qIn;
        PS.dialog({
            title: "Export " + (format === "jpg" ? "JPEG" : "WebP"),
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

// Flat image blob of the committed composite
PS.makeFlatBlob = function (ext, quality) {
    return new Promise(function (resolve, reject) {
        var flat = PS.compositeToCanvas();
        function done(blob) { if (blob) { resolve(blob); } else { reject(new Error("Image encoding failed")); } }
        if (ext === "jpg" || ext === "jpeg") {
            // jpeg has no alpha: composite over white
            var opaque = PS.createCanvas(flat.width, flat.height);
            var ctx = opaque.getContext("2d");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, flat.width, flat.height);
            ctx.drawImage(flat, 0, 0);
            opaque.toBlob(done, "image/jpeg", quality || 0.92);
        } else if (ext === "webp") {
            flat.toBlob(done, "image/webp", quality || 0.92);
        } else {
            flat.toBlob(done, "image/png");
        }
    });
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
   Every layer of the tree is rebuilt through one affine map from old
   document coordinates to new ones, so pixels, masks, vector paths, text
   and smart object placements all follow.
   ============================================================ */

// wraps an operation that rebuilds the layer tree / canvas size
PS.docGeometryOp = function (label, fn) {
    function capture() {
        return {
            w: PS.doc.width, h: PS.doc.height,
            structure: PS.captureStructure(),
            sel: PS.doc.selection
        };
    }
    function apply(s) {
        PS.doc.width = s.w;
        PS.doc.height = s.h;
        PS.applyStructure(s.structure);
        PS.doc.selection = s.sel;
        PS.updateCanvasSize();
    }
    if (PS.commitTextEdit) { PS.commitTextEdit(); }
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

// m = [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f
PS.applyAffine = function (m, x, y) {
    return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
};

// New tree with every layer transformed by m into a newW x newH document.
// opts.smooth: resample smoothly (resize). Groups get new objects too so the
// old tree stays intact for undo.
PS.transformTree = function (m, newW, newH, opts) {
    opts = opts || {};
    function mapList(list) {
        return list.map(function (l) {
            var out = PS.transformLayer(l, m, newW, newH, opts, mapList);
            if (PS.doc.active === l) { PS.doc.active = out; }
            return out;
        });
    }
    PS.doc.root.children = mapList(PS.doc.root.children);
};

PS.transformLayer = function (layer, m, newW, newH, opts, mapList) {
    var out = PS.makeLayer(layer.name, 1, 1, layer.kind);
    Object.keys(layer).forEach(function (k) {
        if (k === "id" || k === "canvas" || k === "children" || k === "mask" ||
            k === "offcanvas" || k.charAt(0) === "_") { return; }
        out[k] = PS.deepCopy(layer[k]);
    });
    out.id = layer.id;

    function drawInto(dst, src, dx, dy) {
        var ctx = dst.getContext("2d");
        ctx.save();
        ctx.imageSmoothingEnabled = !!opts.smooth;
        ctx.imageSmoothingQuality = "high";
        ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        ctx.drawImage(src, dx || 0, dy || 0);
        ctx.restore();
    }

    if (layer.canvas) {
        out.canvas = PS.createCanvas(newW, newH);
        // opts.keepOutside (Crop without Delete Cropped Pixels): pixels that
        // leave the canvas are kept beyond its edge
        if (layer.offcanvas || (opts.keepOutside && layer.kind === "raster")) {
            // transform the full raster so pixels beyond the edge survive
            var full = PS.offcanvasMerged(layer);
            var corners = [
                PS.applyAffine(m, full.left, full.top),
                PS.applyAffine(m, full.left + full.canvas.width, full.top + full.canvas.height)
            ];
            var x0 = Math.floor(Math.min(corners[0].x, corners[1].x));
            var y0 = Math.floor(Math.min(corners[0].y, corners[1].y));
            var x1 = Math.ceil(Math.max(corners[0].x, corners[1].x));
            var y1 = Math.ceil(Math.max(corners[0].y, corners[1].y));
            var big = PS.createCanvas(Math.max(1, x1 - x0), Math.max(1, y1 - y0));
            var bctx = big.getContext("2d");
            bctx.imageSmoothingEnabled = !!opts.smooth;
            bctx.setTransform(m[0], m[1], m[2], m[3], m[4] - x0, m[5] - y0);
            bctx.drawImage(full.canvas, full.left, full.top);
            out.canvas.getContext("2d").drawImage(big, x0, y0);
            if (x0 < 0 || y0 < 0 || x1 > newW || y1 > newH) {
                out.offcanvas = { canvas: big, left: x0, top: y0 };
            }
        } else if (layer.kind === "fill") {
            out.canvas = PS.createCanvas(newW, newH);   // re-rendered below
        } else {
            drawInto(out.canvas, layer.canvas);
        }
    }

    if (layer.mask) {
        out.mask = PS.deepCopy(layer.mask);
        var v = layer.mask.defaultColor === undefined ? 255 : layer.mask.defaultColor;
        out.mask.canvas = PS.createMaskCanvas(newW, newH, v);
        drawInto(out.mask.canvas, layer.mask.canvas);
        out.mask.rev = 1;
    }

    if (out.vmask && PS.transformPaths) {
        PS.transformPaths(out.vmask.paths, m);
        out.vmask.rev = (out.vmask.rev || 0) + 1;
    }
    if (out.text && PS.transformText) { PS.transformText(out, m, opts); }
    if (out.smart && out.smart.transform) {
        for (var i = 0; i < out.smart.transform.length; i += 2) {
            var p = PS.applyAffine(m, out.smart.transform[i], out.smart.transform[i + 1]);
            out.smart.transform[i] = p.x;
            out.smart.transform[i + 1] = p.y;
        }
    }
    if (layer.children) { out.children = mapList(layer.children); }
    if (layer.kind === "fill" || layer.kind === "shape") { out._needsRender = true; }
    return out;
};

// Re-render procedural layers (fill / shape) after a geometry change
PS.renderPendingProcedural = function () {
    PS.eachLayer(function (l) {
        if (l._needsRender && PS.renderProceduralLayer) {
            delete l._needsRender;
            PS.renderProceduralLayer(l);
        }
    });
};

PS.resizeImage = function (newW, newH) {
    var d = PS.doc;
    var sx = newW / d.width, sy = newH / d.height;
    PS.docGeometryOp("Resize Image", function () {
        PS.transformTree([sx, 0, 0, sy, 0, 0], newW, newH, { smooth: true, scale: Math.sqrt(sx * sy) });
        d.width = newW;
        d.height = newH;
        d.selection = null;
        PS.renderPendingProcedural();
    });
};

PS.resizeCanvas = function (newW, newH, anchorX, anchorY) {
    var d = PS.doc;
    var dx = Math.round((newW - d.width) * anchorX);
    var dy = Math.round((newH - d.height) * anchorY);
    PS.docGeometryOp("Canvas Size", function () {
        PS.transformTree([1, 0, 0, 1, dx, dy], newW, newH, {});
        d.width = newW;
        d.height = newH;
        d.selection = null;
        PS.renderPendingProcedural();
    });
};

PS.cropToSelection = function () {
    var d = PS.doc;
    if (!d.selection) { PS.toast("No selection to crop to", true); return; }
    var b = d.selection.bounds;
    PS.docGeometryOp("Crop", function () {
        PS.transformTree([1, 0, 0, 1, -b.x, -b.y], b.w, b.h, {});
        d.width = b.w;
        d.height = b.h;
        d.selection = null;
        PS.renderPendingProcedural();
    });
};

PS.flipImage = function (horizontal) {
    var d = PS.doc;
    var m = horizontal ? [-1, 0, 0, 1, d.width, 0] : [1, 0, 0, -1, 0, d.height];
    PS.docGeometryOp(horizontal ? "Flip Horizontal" : "Flip Vertical", function () {
        PS.transformTree(m, d.width, d.height, {});
        d.selection = null;
        PS.renderPendingProcedural();
    });
};

PS.rotateImage = function (deg) {
    var d = PS.doc;
    var W = d.width, H = d.height;
    var swap = (deg === 90 || deg === 270);
    var newW = swap ? H : W;
    var newH = swap ? W : H;
    var m;
    if (deg === 90) { m = [0, 1, -1, 0, H, 0]; }
    else if (deg === 270) { m = [0, -1, 1, 0, 0, W]; }
    else { m = [-1, 0, 0, -1, W, H]; }
    PS.docGeometryOp("Rotate " + deg + "°", function () {
        PS.transformTree(m, newW, newH, {});
        d.width = newW;
        d.height = newH;
        d.selection = null;
        PS.renderPendingProcedural();
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
    var layer = PS.activeLayer() ? PS.paintTarget() : null;
    if (!layer) { return; }
    if (!merged && !layer.canvas) { PS.toast("This layer has no pixels to copy", true); return; }
    var src = merged ? PS.compositeToCanvas() : layer.canvas;
    var grab = PS.getSelectedPixels(src);
    var b = grab.bounds;

    var cropped = PS.createCanvas(b.w, b.h);
    cropped.getContext("2d").drawImage(grab.canvas, -b.x, -b.y);
    PS.clipboard = { canvas: cropped, x: b.x, y: b.y };

    if (cut) {
        layer = PS.requirePaintableLayer();
        if (!layer) { return; }
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
// Images larger than the document are scaled down (keeping aspect ratio)
// so the whole picture fits inside the canvas instead of being clipped.
PS.pasteImageAsLayer = function (img) {
    if (!PS.doc) { return; }
    var d = PS.doc;
    var scale = Math.min(1, d.width / img.naturalWidth, d.height / img.naturalHeight);
    var w = Math.max(1, Math.round(img.naturalWidth * scale));
    var h = Math.max(1, Math.round(img.naturalHeight * scale));
    var canvas = PS.createCanvas(d.width, d.height);
    var ctx = canvas.getContext("2d");
    var x = Math.round((d.width - w) / 2);
    var y = Math.round((d.height - h) / 2);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, x, y, w, h);
    PS.addLayer("Pasted Image", { canvas: canvas });
    PS.requestRender();
    PS.toast(scale < 1
        ? "Pasted image (scaled to fit canvas)"
        : "Pasted image as new layer");
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
