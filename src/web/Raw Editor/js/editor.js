/*
    editor.js — UI controller for the Raw Editor WebApp.

    Wires the Camera-Raw style controls to the WebGL develop pipeline, handles
    file loading (ArozOS input files, file picker, drag & drop), the live
    histogram, LUT loading, auto white-balance / auto tone, and saving the
    developed image back to the user's storage as a JPEG.
*/

(function () {
    "use strict";

    var renderer = null;
    var glOK = true;
    var decoded = null;           // last decoded {data,width,height,meta,source}
    var sourceFile = null;        // {filename, filepath} of the opened file
    var lut = null;               // parsed LUT
    var renderQueued = false;

    var defaults = {
        temperature: 5500, tint: 0, exposure: 0, contrast: 0,
        highlights: 0, shadows: 0, whites: 0, blacks: 0,
        texture: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0,
        vignette: 0, grain: 0, lutAmount: 100
    };
    var state = Object.assign({}, defaults);
    state.baseTemp = 5500;
    state.treatment = "color";
    state.lutEnabled = true;
    // Per-group bypass ("eye") toggles.
    state.groupOn = { light: true, color: true, effects: true, lut: true };

    // ---- init WebGL ------------------------------------------------------
    try {
        renderer = GLRender.create(document.getElementById("view"));
    } catch (e) {
        glOK = false;
        showFatal(e.message);
    }

    // =====================================================================
    //  Slider wiring
    // =====================================================================
    function clampToRange(el, v) {
        var min = parseFloat(el.dataset.min), max = parseFloat(el.dataset.max);
        if (v < min) v = min;
        if (v > max) v = max;
        return v;
    }

    function initSliders() {
        document.querySelectorAll(".slider").forEach(function (row) {
            var key = row.dataset.key;
            var range = row.querySelector("input[type=range]");
            var num = row.querySelector(".s-val");
            var step = row.dataset.step || "1";
            range.min = row.dataset.min; range.max = row.dataset.max; range.step = step;
            num.min = row.dataset.min; num.max = row.dataset.max; num.step = step;
            var def = parseFloat(row.dataset.def);
            setSlider(row, def);

            range.addEventListener("input", function () {
                var v = parseFloat(range.value);
                num.value = fmt(v, step);
                state[key] = v;
                scheduleRender();
            });
            num.addEventListener("change", function () {
                var v = parseFloat(num.value);
                if (isNaN(v)) v = parseFloat(row.dataset.def);
                v = clampToRange(row, v);
                num.value = fmt(v, step);
                range.value = v;
                state[key] = v;
                scheduleRender();
            });
            // double click resets one slider to its default
            row.querySelector(".s-name").addEventListener("dblclick", function () {
                setSlider(row, parseFloat(row.dataset.def));
                state[key] = parseFloat(row.dataset.def);
                scheduleRender();
            });
        });
    }

    function fmt(v, step) {
        return (parseFloat(step) < 1) ? (Math.round(v * 100) / 100).toString() : Math.round(v).toString();
    }

    function setSlider(row, v) {
        var range = row.querySelector("input[type=range]");
        var num = row.querySelector(".s-val");
        range.value = v;
        num.value = fmt(v, row.dataset.step || "1");
    }

    function setSliderByKey(key, v) {
        var row = document.querySelector('.slider[data-key="' + key + '"]');
        if (row) setSlider(row, v);
        state[key] = v;
    }

    // =====================================================================
    //  Render
    // =====================================================================
    function scheduleRender() {
        if (renderQueued || !renderer || !decoded) return;
        renderQueued = true;
        requestAnimationFrame(function () {
            renderQueued = false;
            doRender();
        });
    }

    function getParams() {
        var g = state.groupOn;
        var p = {
            baseTemp: state.baseTemp,
            // Color group
            temperature: g.color ? state.temperature : state.baseTemp,
            tint: g.color ? state.tint : 0,
            vibrance: g.color ? state.vibrance : 0,
            saturation: g.color ? state.saturation : 0,
            // Light group
            exposure: g.light ? state.exposure : 0,
            contrast: g.light ? state.contrast : 0,
            highlights: g.light ? state.highlights : 0,
            shadows: g.light ? state.shadows : 0,
            whites: g.light ? state.whites : 0,
            blacks: g.light ? state.blacks : 0,
            // Effects group
            texture: g.effects ? state.texture : 0,
            clarity: g.effects ? state.clarity : 0,
            dehaze: g.effects ? state.dehaze : 0,
            vignette: g.effects ? state.vignette : 0,
            grain: g.effects ? state.grain : 0,
            // LUT group
            lutEnabled: !!(lut && state.lutEnabled && g.lut),
            lutAmount: state.lutAmount / 100
        };
        if (state.treatment === "bw") { p.saturation = -100; p.vibrance = 0; }
        return p;
    }

    function doRender() {
        if (!renderer || !decoded) return;
        renderer.render(getParams());
        updateHistogram();
        updateFilmstrip();
    }

    // =====================================================================
    //  Histogram
    // =====================================================================
    var histSmall = document.createElement("canvas");
    histSmall.width = 252; histSmall.height = 84;
    var histSmallCtx = histSmall.getContext("2d");

    function updateHistogram() {
        var view = document.getElementById("view");
        var hc = document.getElementById("histogram");
        var ctx = hc.getContext("2d");
        ctx.clearRect(0, 0, hc.width, hc.height);
        if (!decoded) return;
        try {
            histSmallCtx.drawImage(view, 0, 0, histSmall.width, histSmall.height);
        } catch (e) { return; }
        var img = histSmallCtx.getImageData(0, 0, histSmall.width, histSmall.height).data;
        var r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256);
        for (var i = 0; i < img.length; i += 4) {
            r[img[i]]++; g[img[i + 1]]++; b[img[i + 2]]++;
        }
        var max = 1;
        for (var k = 1; k < 255; k++) { // ignore pure black/white spikes for scaling
            if (r[k] > max) max = r[k];
            if (g[k] > max) max = g[k];
            if (b[k] > max) max = b[k];
        }
        drawChannel(ctx, r, max, "rgba(255,80,80,0.75)");
        drawChannel(ctx, g, max, "rgba(90,220,90,0.75)");
        drawChannel(ctx, b, max, "rgba(90,140,255,0.75)");

        // Clipping indicators (fraction of pixels pinned to 0 / 255).
        var totalPx = histSmall.width * histSmall.height;
        var hi = Math.max(r[255], g[255], b[255]);
        var lo = Math.max(r[0], g[0], b[0]);
        var ch = document.getElementById("clipHigh");
        var cs = document.getElementById("clipShadow");
        if (ch) ch.classList.toggle("active-high", hi / totalPx > 0.01);
        if (cs) cs.classList.toggle("active-shadow", lo / totalPx > 0.01);
    }

    // Small preview thumbnail in the bottom filmstrip.
    function updateFilmstrip() {
        var fs = document.getElementById("filmstrip");
        var v = document.getElementById("view");
        if (!fs || !v.width) return;
        var ctx = fs.getContext("2d");
        ctx.fillStyle = "#111"; ctx.fillRect(0, 0, fs.width, fs.height);
        var s = Math.min(fs.width / v.width, fs.height / v.height);
        var w = v.width * s, h = v.height * s;
        try { ctx.drawImage(v, (fs.width - w) / 2, (fs.height - h) / 2, w, h); } catch (e) { /* ignore */ }
    }

    function drawChannel(ctx, arr, max, color) {
        var w = ctx.canvas.width, h = ctx.canvas.height;
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (var x = 0; x < 256; x++) {
            var v = Math.min(1, arr[x] / max);
            var px = (x / 255) * w;
            var py = h - v * (h - 2);
            ctx.lineTo(px, py);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
    }

    // =====================================================================
    //  File loading
    // =====================================================================
    function showLoader(text) {
        document.getElementById("loaderText").textContent = text || "Working...";
        document.getElementById("loader").style.display = "flex";
    }
    function hideLoader() { document.getElementById("loader").style.display = "none"; }

    function showFatal(msg) {
        var dh = document.getElementById("dropHint");
        if (dh) dh.innerHTML = '<i class="warning circle icon huge"></i><p>' + escapeHtml(msg) + "</p>";
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"]/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
        });
    }

    function loadFromPath(filepath, filename) {
        if (!glOK) return;
        sourceFile = { filepath: filepath, filename: filename };
        showLoader("Reading file...");
        document.getElementById("dropHint").style.display = "none";
        var url = "../media?file=" + encodeURIComponent(filepath);
        fetch(url).then(function (resp) {
            if (!resp.ok) throw new Error("Could not read file (HTTP " + resp.status + ")");
            return resp.arrayBuffer();
        }).then(function (buf) {
            showLoader("Decoding " + (filename || "image") + " ...");
            // Defer so the loader paints before the heavy decode.
            setTimeout(function () { decodeBuffer(buf, filename); }, 30);
        }).catch(function (err) {
            hideLoader();
            showFatal(err.message || String(err));
        });
    }

    function loadFromArrayBuffer(buf, filename) {
        showLoader("Decoding " + (filename || "image") + " ...");
        document.getElementById("dropHint").style.display = "none";
        setTimeout(function () { decodeBuffer(buf, filename); }, 30);
    }

    function decodeBuffer(buf, filename) {
        RawDecoder.decode(buf, filename).then(function (res) {
            decoded = res;
            renderer.setImage(res);
            document.getElementById("view").style.display = "block";
            applyMeta(res.meta, filename, res);
            resetAll(true);
            hideLoader();
        }).catch(function (err) {
            hideLoader();
            showFatal(err.message || String(err));
        });
    }

    function applyMeta(meta, filename, res) {
        state.baseTemp = (meta && meta.temp) ? meta.temp : 5500;
        defaults.temperature = state.baseTemp;
        document.getElementById("fileTitle").textContent =
            (filename || "Untitled") + (meta && meta.camera ? "   —   " + meta.camera : "");
        ao_module_setWindowTitle("Raw Editor - " + (filename || "Untitled"));
        // EXIF line
        setText("exifShutter", meta && meta.shutter ? formatShutter(meta.shutter) : "--");
        setText("exifAperture", meta && meta.aperture ? "f/" + round1(meta.aperture) : "--");
        setText("exifIso", meta && meta.iso ? "ISO " + meta.iso : "--");
        setText("exifFocal", meta && meta.focal ? Math.round(meta.focal) + " mm" : "--");
        // Status line
        var srcLabel = { "raw-demosaic": "RAW demosaiced", "embedded-preview": "Embedded preview", "image": "Image" }[res.source] || res.source;
        setText("statusInfo", srcLabel + "   ·   " + res.width + " x " + res.height + " px");
    }

    function formatShutter(t) {
        if (t >= 1) return round1(t) + " s";
        return "1/" + Math.round(1 / t) + " s";
    }
    function round1(v) { return Math.round(v * 10) / 10; }
    function setText(id, t) { var e = document.getElementById(id); if (e) e.textContent = t; }

    // =====================================================================
    //  White balance presets + auto
    // =====================================================================
    var wbPresets = { daylight: 5500, cloudy: 6500, shade: 7500, tungsten: 2850, fluorescent: 3800 };

    document.getElementById("wbPreset").addEventListener("change", function () {
        var v = this.value;
        if (v === "asshot") { setSliderByKey("temperature", state.baseTemp); setSliderByKey("tint", 0); }
        else if (v === "auto") { autoWhiteBalance(); }
        else if (wbPresets[v] != null) { setSliderByKey("temperature", wbPresets[v]); setSliderByKey("tint", 0); }
        scheduleRender();
    });

    // When temp/tint are edited manually flip the preset to Custom.
    ["temperature", "tint"].forEach(function (key) {
        var row = document.querySelector('.slider[data-key="' + key + '"]');
        row.querySelector("input[type=range]").addEventListener("input", function () {
            document.getElementById("wbPreset").value = "custom";
        });
    });

    function autoWhiteBalance() {
        if (!decoded) return;
        var d = decoded.data, n = d.length;
        var sr = 0, sg = 0, sb = 0, cnt = 0;
        var stride = Math.max(4, Math.floor(n / 4 / 40000) * 4);
        for (var i = 0; i < n; i += stride) { sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; cnt++; }
        var ar = sr / cnt, ag = sg / cnt, ab = sb / cnt;
        if (ar <= 0 || ab <= 0) return;
        // Solve kelvinGain to equalise R and B: (1+0.9wr)/(1-0.9wr) = ab/ar.
        var ratio = ab / ar;
        var wr = (ratio - 1) / (0.9 * (ratio + 1));
        wr = Math.max(-1, Math.min(1, wr));
        var temp = state.baseTemp * Math.exp(wr * (Math.log(50000) - Math.log(2000)));
        temp = Math.max(2000, Math.min(50000, temp));
        // Tint: green vs magenta balance.
        var tint = ((ar + ab) / 2 - ag) / ((ar + ab) / 2 + ag) * 150;
        tint = Math.max(-150, Math.min(150, tint));
        setSliderByKey("temperature", Math.round(temp));
        setSliderByKey("tint", Math.round(tint));
    }

    // =====================================================================
    //  Auto tone / reset
    // =====================================================================
    document.getElementById("btnAuto").addEventListener("click", function () { autoTone(); scheduleRender(); });
    document.getElementById("btnDefault").addEventListener("click", function () {
        ["exposure", "contrast", "highlights", "shadows", "whites", "blacks"].forEach(function (k) {
            setSliderByKey(k, defaults[k]);
        });
        scheduleRender();
    });

    function autoTone() {
        if (!decoded) return;
        var d = decoded.data, n = d.length;
        var sum = 0, cnt = 0, hiClip = 0, loClip = 0;
        var stride = Math.max(4, Math.floor(n / 4 / 40000) * 4);
        for (var i = 0; i < n; i += stride) {
            var lum = Math.pow(Math.max(0, 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]), 1 / 2.2);
            sum += lum; cnt++;
            if (lum > 0.96) hiClip++;
            if (lum < 0.03) loClip++;
        }
        var mean = sum / cnt;
        var exposure = Math.log(0.46 / Math.max(0.03, mean)) / Math.log(2);
        exposure = Math.max(-2.5, Math.min(2.5, exposure));
        setSliderByKey("exposure", Math.round(exposure * 100) / 100);
        setSliderByKey("contrast", 8);
        setSliderByKey("highlights", hiClip / cnt > 0.02 ? -35 : -10);
        setSliderByKey("shadows", loClip / cnt > 0.02 ? 35 : 12);
        setSliderByKey("whites", 8);
        setSliderByKey("blacks", -6);
    }

    function resetAll(keepImage) {
        Object.keys(defaults).forEach(function (k) {
            var def = (k === "temperature") ? state.baseTemp : defaults[k];
            setSliderByKey(k, def);
        });
        state.treatment = "color";
        document.getElementById("btnBW").classList.remove("active");
        document.getElementById("wbPreset").value = "asshot";
        if (keepImage) scheduleRender();
    }

    document.getElementById("btnReset").addEventListener("click", function () { resetAll(true); });

    // Treatment (B&W) toggle in the Edit header
    document.getElementById("btnBW").addEventListener("click", function () {
        state.treatment = (state.treatment === "bw") ? "color" : "bw";
        this.classList.toggle("active", state.treatment === "bw");
        scheduleRender();
    });

    // Auto white balance eyedropper
    document.getElementById("btnEyedrop").addEventListener("click", function () {
        autoWhiteBalance();
        document.getElementById("wbPreset").value = "auto";
        scheduleRender();
    });

    // =====================================================================
    //  Collapsible groups (chevron) + per-group bypass (eye)
    // =====================================================================
    document.querySelectorAll(".group-head").forEach(function (head) {
        var group = head.parentElement;
        head.addEventListener("click", function (e) {
            if (e.target.classList.contains("eye-toggle")) return;
            group.classList.toggle("collapsed");
        });
        var eye = head.querySelector(".eye-toggle");
        if (eye) {
            eye.addEventListener("click", function (e) {
                e.stopPropagation();
                var key = group.dataset.group;
                state.groupOn[key] = !state.groupOn[key];
                group.classList.toggle("bypassed", !state.groupOn[key]);
                eye.className = state.groupOn[key] ? "eye icon eye-toggle" : "eye slash icon eye-toggle";
                scheduleRender();
            });
        }
    });

    // =====================================================================
    //  LUT
    // =====================================================================
    document.getElementById("btnLoadLut").addEventListener("click", function () {
        document.getElementById("lutFile").click();
    });
    document.getElementById("lutFile").addEventListener("change", function () {
        var f = this.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
            try {
                lut = LUTParser.parse(reader.result);
                renderer.setLUT(lut);
                state.lutEnabled = true;
                document.getElementById("lutEnabled").checked = true;
                document.getElementById("lutInfo").style.display = "block";
                document.getElementById("lutName").textContent = (lut.title ? lut.title + "  " : "") + f.name + "  (" + lut.size + "³)";
                scheduleRender();
            } catch (e) {
                alert("Could not load LUT: " + e.message);
            }
        };
        reader.readAsText(f);
        this.value = "";
    });
    document.getElementById("lutEnabled").addEventListener("change", function () {
        state.lutEnabled = this.checked;
        scheduleRender();
    });
    document.getElementById("btnClearLut").addEventListener("click", function () {
        lut = null;
        renderer.setLUT(null);
        document.getElementById("lutInfo").style.display = "none";
        scheduleRender();
    });

    // =====================================================================
    //  Open / drag & drop
    // =====================================================================
    function openPicker() {
        if (typeof ao_module_openFileSelector === "function" && window.parent !== window) {
            ao_module_openFileSelector(function (files) {
                if (files && files.length) loadFromPath(files[0].filepath, files[0].filename);
            }, "user:/", "file", false);
        } else {
            var inp = document.createElement("input");
            inp.type = "file";
            inp.accept = ".arw,.dng,.nef,.cr2,.cr3,.orf,.raf,.rw2,.pef,.srw,.tif,.tiff,.jpg,.jpeg,.png,.webp";
            inp.onchange = function () {
                var f = inp.files[0];
                if (!f) return;
                sourceFile = null;
                f.arrayBuffer().then(function (buf) { loadFromArrayBuffer(buf, f.name); });
            };
            inp.click();
        }
    }
    document.getElementById("btnOpen").addEventListener("click", openPicker);
    document.getElementById("btnOpen2").addEventListener("click", openPicker);

    var stage = document.getElementById("stage");
    stage.addEventListener("dragover", function (e) { e.preventDefault(); stage.classList.add("dragover"); });
    stage.addEventListener("dragleave", function () { stage.classList.remove("dragover"); });
    stage.addEventListener("drop", function (e) {
        e.preventDefault();
        stage.classList.remove("dragover");
        // Local OS file drop.
        if (e.dataTransfer.files && e.dataTransfer.files.length) {
            var f = e.dataTransfer.files[0];
            sourceFile = null;
            f.arrayBuffer().then(function (buf) { loadFromArrayBuffer(buf, f.name); });
            return;
        }
        // ArozOS file-explorer drop.
        try {
            var info = ao_module_utils.getDropFileInfo(e);
            if (info && info.length) loadFromPath(info[0].filepath, info[0].filename);
        } catch (err) { /* ignore */ }
    });

    // Zoom buttons (CSS driven, simple fit / 1:1 toggle)
    var oneToOne = false;
    function fitToWindow() {
        oneToOne = false;
        var v = document.getElementById("view");
        v.style.maxWidth = ""; v.style.maxHeight = ""; v.style.width = ""; v.style.height = "";
    }
    document.getElementById("btnFit").addEventListener("click", fitToWindow);
    document.getElementById("btnZoomFit").addEventListener("click", fitToWindow);
    document.getElementById("btnZoom100").addEventListener("click", function () {
        oneToOne = !oneToOne;
        var v = document.getElementById("view");
        if (oneToOne && decoded) { v.style.maxWidth = "none"; v.style.maxHeight = "none"; v.style.width = decoded.width + "px"; v.style.height = decoded.height + "px"; }
        else { fitToWindow(); }
    });

    // =====================================================================
    //  Save + Done
    // =====================================================================
    document.getElementById("btnSave").addEventListener("click", saveImage);
    document.getElementById("btnDone").addEventListener("click", openInPixelStudio);
    document.getElementById("btnCancel").addEventListener("click", function () {
        if (typeof ao_module_close === "function") ao_module_close();
    });

    // Hand the developed image off to Pixel Studio: write the current develop to
    // a temporary file (tmp:/ is cleared automatically) then launch Pixel Studio
    // as a float window with that file as its input.
    function openInPixelStudio() {
        var inDesktop = (typeof ao_module_virtualDesktop !== "undefined" && ao_module_virtualDesktop);
        if (!decoded || !renderer) {
            if (typeof ao_module_close === "function") ao_module_close();
            return;
        }
        if (!inDesktop || typeof ao_module_uploadFile !== "function") {
            // Outside the ArozOS desktop we cannot open another module — just save.
            saveImage();
            return;
        }
        doRender(); // ensure the canvas holds the latest develop
        var view = document.getElementById("view");
        view.toBlob(function (blob) {
            if (!blob) { alert("Failed to encode image."); return; }
            var base = (sourceFile && sourceFile.filename) ? stripExt(sourceFile.filename) : "Untitled";
            var fname = base + "_raw_" + Date.now() + ".jpg";
            var tmpDir = "tmp:/RawEditor";
            var file = ao_module_utils.blobToFile(blob, fname);
            showLoader("Opening in Pixel Studio...");
            ao_module_uploadFile(file, tmpDir, function () {
                hideLoader();
                launchPixelStudio(tmpDir + "/" + fname, fname);
                if (typeof ao_module_close === "function") ao_module_close();
            }, undefined, function () {
                hideLoader();
                alert("Could not hand the image to Pixel Studio. Try 'Save Image...' instead.");
            });
        }, "image/jpeg", 0.95);
    }

    function launchPixelStudio(filepath, filename) {
        var hash = encodeURIComponent(JSON.stringify([{ filename: filename, filepath: filepath }]));
        ao_module_newfw({
            url: "Pixel Studio/index.html#" + hash,
            width: 1280,
            height: 820,
            appicon: "Pixel Studio/img/module_icon.png",
            title: "Pixel Studio - " + filename
        });
    }

    function saveImage() {
        if (!decoded || !renderer) { alert("Nothing to save yet."); return; }
        doRender(); // make sure the canvas holds the latest develop
        var view = document.getElementById("view");
        view.toBlob(function (blob) {
            if (!blob) { alert("Failed to encode image."); return; }
            var baseName = (sourceFile && sourceFile.filename ? stripExt(sourceFile.filename) : "Untitled") + "_edited.jpg";
            if (window.parent !== window && typeof ao_module_openFileSelector === "function") {
                var defDir = "user:/Desktop";
                if (sourceFile && sourceFile.filepath) {
                    var parts = sourceFile.filepath.split("/"); parts.pop(); defDir = parts.join("/");
                }
                ao_module_openFileSelector(function (files) {
                    if (!files || !files.length) return;
                    var fp = files[0].filepath.split("/"); var fn = fp.pop(); var dir = fp.join("/");
                    if (!/\.jpe?g$/i.test(fn)) fn = stripExt(fn) + ".jpg";
                    uploadBlob(blob, fn, dir);
                }, defDir, "new", false, { defaultName: baseName });
            } else {
                // Fallback: browser download.
                var a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = baseName;
                a.click();
                setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
            }
        }, "image/jpeg", 0.92);
    }

    function uploadBlob(blob, filename, dir) {
        var file = ao_module_utils.blobToFile(blob, filename);
        showLoader("Saving " + filename + " ...");
        ao_module_uploadFile(file, dir, function () {
            hideLoader();
            setText("statusInfo", "Saved: " + dir + "/" + filename);
        }, undefined, function () {
            hideLoader();
            alert("Failed to save image to " + dir);
        });
    }

    function stripExt(name) { var i = name.lastIndexOf("."); return i < 0 ? name : name.substring(0, i); }

    // =====================================================================
    //  Boot
    // =====================================================================
    initSliders();

    if (glOK) {
        var inputFiles = (typeof ao_module_loadInputFiles === "function") ? ao_module_loadInputFiles() : null;
        if (inputFiles && inputFiles.length) {
            loadFromPath(inputFiles[0].filepath, inputFiles[0].filename);
        }
    }
})();
