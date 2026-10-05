/*
    Pixel Studio - Properties panel

    Context panel for the active layer (the Properties panel):
        adjustment layers   their settings (one editor per adjustment type)
        fill layers         colour / gradient / pattern
        shape layers        fill and stroke
        layer masks         density, feather, invert, apply, delete
        smart objects       what they hold and how to rasterize them
    Every change renders live; a burst of changes becomes one undo step.
*/
"use strict";

/* ---------- live edit + history grouping ---------- */

// Snapshot-based undo for edits of one layer property object (adjustment,
// fill, stroke, mask settings). begin() is called on the first change of a
// burst, commit() after the burst settles.
PS.propEditor = function (layer, label, getter, setter) {
    var before = null, timer = null;
    function begin() {
        if (before === null) { before = PS.deepCopy(getter(layer)); }
    }
    function commit() {
        if (timer) { clearTimeout(timer); timer = null; }
        if (before === null) { return; }
        var b = before, a = PS.deepCopy(getter(layer));
        before = null;
        // settings windows (Image > Adjustments) edit a stand-in layer
        if (layer._noHistory) { return; }
        if (JSON.stringify(a) === JSON.stringify(b)) { return; }
        PS.pushHistory(label,
            function () { setter(layer, PS.deepCopy(b)); PS.afterPropChange(layer); },
            function () { setter(layer, PS.deepCopy(a)); PS.afterPropChange(layer); });
    }
    return {
        change: function (fn) {
            begin();
            fn(getter(layer));
            PS.afterPropChange(layer);
            if (timer) { clearTimeout(timer); }
            timer = setTimeout(commit, 600);
        },
        commit: commit
    };
};

// Re-render whatever depends on the layer's settings
PS.afterPropChange = function (layer) {
    if (layer._onPropChange) { layer._onPropChange(); return; }
    if (layer.kind === "fill" || layer.kind === "shape") { PS.renderProceduralLayer(layer); }
    if (layer.mask) { layer.mask.rev++; }
    PS.requestRender();
    PS.updateLayerThumbsThrottled();
};

/* ---------- small widgets ---------- */

PS.prop = {
    section: function (host, title) {
        var s = document.createElement("div");
        s.className = "prop-section";
        if (title) {
            var h = document.createElement("div");
            h.className = "prop-title";
            h.textContent = title;
            s.appendChild(h);
        }
        host.appendChild(s);
        return s;
    },
    // label + range + number; onInput(value) live
    slider: function (host, label, value, min, max, step, onInput, unit) {
        var row = document.createElement("div");
        row.className = "prop-row";
        var l = document.createElement("label");
        l.textContent = label;
        row.appendChild(l);
        var r = document.createElement("input");
        r.type = "range"; r.min = min; r.max = max; r.step = step || 1; r.value = value;
        var n = PS.ui.numberField(value, min, max, step || 1, function (v) { r.value = v; onInput(v); });
        n.className = "prop-num";
        r.addEventListener("input", function () { n.value = r.value; onInput(parseFloat(r.value)); });
        PS.ui.wheelStep(r, min, max, step || 1, function (v) { n.value = v; onInput(v); });
        row.appendChild(r);
        row.appendChild(n);
        if (unit) {
            var u = document.createElement("span");
            u.className = "prop-unit";
            u.textContent = unit;
            row.appendChild(u);
        }
        host.appendChild(row);
        return { range: r, num: n, set: function (v) { r.value = v; n.value = v; } };
    },
    select: function (host, label, options, value, onChange) {
        var row = document.createElement("div");
        row.className = "prop-row";
        var l = document.createElement("label");
        l.textContent = label;
        row.appendChild(l);
        var s = PS.selectInput(options, value);
        s.addEventListener("change", function () { onChange(s.value); });
        row.appendChild(s);
        host.appendChild(row);
        return s;
    },
    check: function (host, label, value, onChange) {
        var row = document.createElement("label");
        row.className = "prop-row prop-check";
        var c = document.createElement("input");
        c.type = "checkbox";
        c.checked = !!value;
        c.addEventListener("change", function () { onChange(c.checked); });
        row.appendChild(c);
        row.appendChild(document.createTextNode(" " + label));
        host.appendChild(row);
        return c;
    },
    color: function (host, label, psdColor, onChange) {
        var row = document.createElement("div");
        row.className = "prop-row";
        var l = document.createElement("label");
        l.textContent = label;
        row.appendChild(l);
        var b = document.createElement("button");
        b.className = "prop-swatch";
        var hex = PS.psdColorToHex(psdColor);
        b.style.background = hex;
        b.addEventListener("click", function () {
            PS.openColorPicker("prop", {
                initial: hex,
                title: label,
                onChange: function (h) {
                    hex = h.slice(0, 7);
                    b.style.background = hex;
                    onChange(PS.hexToPsdColor(hex));
                }
            });
        });
        row.appendChild(b);
        host.appendChild(row);
        return b;
    },
    button: function (host, label, onClick) {
        var b = document.createElement("button");
        b.className = "prop-btn";
        b.textContent = label;
        b.addEventListener("click", onClick);
        host.appendChild(b);
        return b;
    },
    note: function (host, text) {
        var n = document.createElement("div");
        n.className = "prop-note";
        n.textContent = text;
        host.appendChild(n);
        return n;
    },
    gradient: function (host, label, gradient, onChange) {
        var row = document.createElement("div");
        row.className = "prop-row";
        var l = document.createElement("label");
        l.textContent = label;
        row.appendChild(l);
        var c = document.createElement("canvas");
        c.width = 150; c.height = 18;
        c.className = "prop-gradient";
        function draw(g) {
            var lut = PS.gradientLut(g, false);
            var ctx = c.getContext("2d");
            ctx.clearRect(0, 0, c.width, c.height);
            for (var x = 0; x < c.width; x++) {
                var k = Math.round(x / (c.width - 1) * 255) * 4;
                ctx.fillStyle = "rgba(" + lut[k] + "," + lut[k + 1] + "," + lut[k + 2] + "," + (lut[k + 3] / 255) + ")";
                ctx.fillRect(x, 0, 1, c.height);
            }
        }
        draw(gradient);
        c.title = "Click to edit the gradient";
        c.addEventListener("click", function () {
            PS.openGradientEditor({
                stops: PS.psdGradientToStops(gradient),
                title: label,
                onChange: function (stops) {
                    var ng = PS.stopsToPsdGradient(stops, gradient && gradient.name);
                    gradient = ng;
                    draw(ng);
                    onChange(ng);
                }
            });
        });
        row.appendChild(c);
        host.appendChild(row);
        return c;
    }
};

/* ---------- panel ---------- */

PS.showLayerProperties = function (layer) {
    PS.ws.showPanel("properties");
    PS.renderPropertiesPanel(layer);
};

PS.showMaskProperties = function (layer) {
    PS.doc.editMask = true;
    PS.showLayerProperties(layer);
    PS.renderLayersPanel();
};

PS._propsFor = null;

PS.renderPropertiesPanel = function (layer) {
    var body = PS.el("panel-properties-body");
    if (!body) { return; }
    if (PS._propCommit) { PS._propCommit(); PS._propCommit = null; }
    body.innerHTML = "";
    layer = layer || (PS.doc ? PS.activeLayer() : null);
    PS._propsFor = layer;
    if (!layer) {
        PS.prop.note(body, "No document open.");
        return;
    }
    var title = document.createElement("div");
    title.className = "prop-heading";
    title.textContent = (PS.doc.editMask && layer.mask) ? "Layer Mask" : PS.layerKindLabel(layer);
    body.appendChild(title);

    if (PS.doc.editMask && layer.mask) { PS.maskProperties(body, layer); return; }
    if (layer.kind === "adjustment") { PS.adjustmentProperties(body, layer); return; }
    if (layer.kind === "fill") { PS.fillProperties(body, layer); return; }
    if (layer.kind === "shape") { PS.shapeProperties(body, layer); return; }
    if (layer.kind === "smart") { PS.smartProperties(body, layer); return; }
    if (layer.kind === "text") {
        var t = layer.text && layer.text.psd;
        PS.prop.note(body, "Double-click the layer thumbnail or click the text with the Text tool to edit it." +
            (t && t.warp && t.warp.style && t.warp.style !== "none" ? " Warp: " + t.warp.style + " (kept, not drawn while editing)." : ""));
        return;
    }
    if (layer.kind === "group") {
        PS.prop.note(body, layer.children.length + " layer(s). Blend mode Pass Through lets the layers inside blend with everything below.");
        if (layer.mask) { PS.prop.button(body, "Mask Properties", function () { PS.showMaskProperties(layer); }); }
        return;
    }
    var b = PS.layerContentBounds(layer);
    PS.prop.note(body, b ? ("Content: " + Math.round(b.w) + " x " + Math.round(b.h) + " px at " + Math.round(b.x) + ", " + Math.round(b.y)) : "Empty layer");
    if (layer.mask) { PS.prop.button(body, "Mask Properties", function () { PS.showMaskProperties(layer); }); }
};

/* ---------- masks ---------- */

PS.maskProperties = function (body, layer) {
    var ed = PS.propEditor(layer, "Mask Properties",
        function (l) { return { density: l.mask.density, feather: l.mask.feather }; },
        function (l, v) { l.mask.density = v.density; l.mask.feather = v.feather; });
    PS._propCommit = ed.commit;
    PS.prop.slider(body, "Density", Math.round((layer.mask.density === undefined ? 1 : layer.mask.density) * 100), 0, 100, 1, function (v) {
        ed.change(function () { layer.mask.density = v / 100; });
    }, "%");
    PS.prop.slider(body, "Feather", layer.mask.feather || 0, 0, 250, 0.5, function (v) {
        ed.change(function () { layer.mask.feather = v; });
    }, "px");
    var row = document.createElement("div");
    row.className = "prop-buttons";
    PS.prop.button(row, "Invert", function () { PS.invertLayerMask(layer); });
    PS.prop.button(row, layer.mask.enabled === false ? "Enable" : "Disable", function () { PS.toggleMaskEnabled(layer); PS.renderPropertiesPanel(layer); });
    PS.prop.button(row, "Apply", function () { PS.applyLayerMask(layer); PS.renderPropertiesPanel(); });
    PS.prop.button(row, "Delete", function () { PS.deleteLayerMask(layer); PS.renderPropertiesPanel(); });
    body.appendChild(row);
    PS.prop.note(body, "Paint on the mask with black to hide and white to reveal. Alt+click the mask thumbnail to view it.");
};

/* ---------- adjustments ---------- */

PS.adjustmentProperties = function (body, layer) {
    var adj = layer.adjustment;
    var ed = PS.propEditor(layer, PS.adjustmentLabel(adj.type),
        function (l) { return l.adjustment; },
        function (l, v) { l.adjustment = v; });
    PS._propCommit = ed.commit;
    var S = PS.prop;
    function set(fn) { ed.change(function () { fn(layer.adjustment); }); }
    var a = adj;

    switch (a.type) {
        case "brightness/contrast":
            S.slider(body, "Brightness", a.brightness || 0, a.useLegacy ? -100 : -150, 150, 1, function (v) { set(function (x) { x.brightness = v; }); });
            S.slider(body, "Contrast", a.contrast || 0, a.useLegacy ? -100 : -50, 100, 1, function (v) { set(function (x) { x.contrast = v; }); });
            S.check(body, "Use Legacy", a.useLegacy, function (v) { set(function (x) { x.useLegacy = v; }); });
            break;
        case "levels": {
            var chan = "rgb";
            var host = document.createElement("div");
            S.select(body, "Channel", [{ v: "rgb", l: "RGB" }, { v: "red", l: "Red" }, { v: "green", l: "Green" }, { v: "blue", l: "Blue" }], chan, function (v) { chan = v; build(); });
            body.appendChild(host);
            var build = function () {
                host.innerHTML = "";
                var lv = function () { return layer.adjustment[chan] || (layer.adjustment[chan] = { shadowInput: 0, highlightInput: 255, shadowOutput: 0, highlightOutput: 255, midtoneInput: 1 }); };
                var c = lv();
                S.slider(host, "Input black", c.shadowInput, 0, 253, 1, function (v) { set(function () { lv().shadowInput = v; }); });
                S.slider(host, "Midtones", c.midtoneInput, 0.1, 9.99, 0.01, function (v) { set(function () { lv().midtoneInput = v; }); });
                S.slider(host, "Input white", c.highlightInput, 2, 255, 1, function (v) { set(function () { lv().highlightInput = v; }); });
                S.slider(host, "Output black", c.shadowOutput, 0, 255, 1, function (v) { set(function () { lv().shadowOutput = v; }); });
                S.slider(host, "Output white", c.highlightOutput, 0, 255, 1, function (v) { set(function () { lv().highlightOutput = v; }); });
            };
            build();
            break;
        }
        case "curves":
            PS.curvesEditor(body, layer, set);
            break;
        case "exposure":
            S.slider(body, "Exposure", a.exposure || 0, -20, 20, 0.01, function (v) { set(function (x) { x.exposure = v; }); });
            S.slider(body, "Offset", a.offset || 0, -0.5, 0.5, 0.0001, function (v) { set(function (x) { x.offset = v; }); });
            S.slider(body, "Gamma", a.gamma || 1, 0.01, 9.99, 0.01, function (v) { set(function (x) { x.gamma = v; }); });
            break;
        case "vibrance":
            S.slider(body, "Vibrance", a.vibrance || 0, -100, 100, 1, function (v) { set(function (x) { x.vibrance = v; }); });
            S.slider(body, "Saturation", a.saturation || 0, -100, 100, 1, function (v) { set(function (x) { x.saturation = v; }); });
            break;
        case "hue/saturation": {
            var range = "master";
            var hhost = document.createElement("div");
            S.select(body, "Range", [{ v: "master", l: "Master" }, { v: "reds", l: "Reds" }, { v: "yellows", l: "Yellows" },
                { v: "greens", l: "Greens" }, { v: "cyans", l: "Cyans" }, { v: "blues", l: "Blues" }, { v: "magentas", l: "Magentas" }],
            range, function (v) { range = v; buildHs(); });
            body.appendChild(hhost);
            var buildHs = function () {
                hhost.innerHTML = "";
                var r = layer.adjustment[range] || (layer.adjustment[range] = PS.defaultAdjustment("hue/saturation")[range]);
                S.slider(hhost, "Hue", r.hue || 0, -180, 180, 1, function (v) { set(function (x) { x[range].hue = v; }); });
                S.slider(hhost, "Saturation", r.saturation || 0, -100, 100, 1, function (v) { set(function (x) { x[range].saturation = v; }); });
                S.slider(hhost, "Lightness", r.lightness || 0, -100, 100, 1, function (v) { set(function (x) { x[range].lightness = v; }); });
            };
            buildHs();
            break;
        }
        case "color balance": {
            var tone = "midtones";
            var chost = document.createElement("div");
            S.select(body, "Tone", [{ v: "shadows", l: "Shadows" }, { v: "midtones", l: "Midtones" }, { v: "highlights", l: "Highlights" }], tone, function (v) { tone = v; buildCb(); });
            body.appendChild(chost);
            var buildCb = function () {
                chost.innerHTML = "";
                var t = layer.adjustment[tone] || (layer.adjustment[tone] = { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 });
                S.slider(chost, "Cyan / Red", t.cyanRed || 0, -100, 100, 1, function (v) { set(function (x) { x[tone].cyanRed = v; }); });
                S.slider(chost, "Magenta / Green", t.magentaGreen || 0, -100, 100, 1, function (v) { set(function (x) { x[tone].magentaGreen = v; }); });
                S.slider(chost, "Yellow / Blue", t.yellowBlue || 0, -100, 100, 1, function (v) { set(function (x) { x[tone].yellowBlue = v; }); });
            };
            buildCb();
            S.check(body, "Preserve Luminosity", a.preserveLuminosity !== false, function (v) { set(function (x) { x.preserveLuminosity = v; }); });
            break;
        }
        case "black & white":
            [["reds", "Reds"], ["yellows", "Yellows"], ["greens", "Greens"], ["cyans", "Cyans"], ["blues", "Blues"], ["magentas", "Magentas"]].forEach(function (c) {
                S.slider(body, c[1], a[c[0]] === undefined ? 0 : a[c[0]], -200, 300, 1, function (v) { set(function (x) { x[c[0]] = v; }); }, "%");
            });
            S.check(body, "Tint", a.useTint, function (v) { set(function (x) { x.useTint = v; }); });
            S.color(body, "Tint color", a.tintColor || { r: 225, g: 211, b: 179 }, function (c) { set(function (x) { x.tintColor = c; }); });
            break;
        case "photo filter":
            S.color(body, "Filter color", { r: PS.photoFilterRgb(a.color)[0], g: PS.photoFilterRgb(a.color)[1], b: PS.photoFilterRgb(a.color)[2] }, function (c) { set(function (x) { x.color = c; }); });
            S.slider(body, "Density", Math.round((a.density === undefined ? 0.25 : a.density) * 100), 1, 100, 1, function (v) { set(function (x) { x.density = v / 100; }); }, "%");
            S.check(body, "Preserve Luminosity", a.preserveLuminosity !== false, function (v) { set(function (x) { x.preserveLuminosity = v; }); });
            break;
        case "channel mixer": {
            var out = a.monochrome ? "gray" : "red";
            var mhost = document.createElement("div");
            var outSel = S.select(body, "Output", [{ v: "red", l: "Red" }, { v: "green", l: "Green" }, { v: "blue", l: "Blue" }], out === "gray" ? "red" : out, function (v) { out = v; buildMx(); });
            S.check(body, "Monochrome", a.monochrome, function (v) {
                set(function (x) { x.monochrome = v; if (v && !x.gray) { x.gray = { red: 40, green: 40, blue: 20, constant: 0 }; } });
                out = v ? "gray" : outSel.value;
                outSel.disabled = v;
                buildMx();
            });
            outSel.disabled = !!a.monochrome;
            body.appendChild(mhost);
            var buildMx = function () {
                mhost.innerHTML = "";
                var key = layer.adjustment.monochrome ? "gray" : out;
                var row = layer.adjustment[key] || (layer.adjustment[key] = { red: key === "red" ? 100 : 0, green: key === "green" ? 100 : 0, blue: key === "blue" ? 100 : 0, constant: 0 });
                ["red", "green", "blue"].forEach(function (c) {
                    S.slider(mhost, c.charAt(0).toUpperCase() + c.slice(1), row[c] || 0, -200, 200, 1, function (v) { set(function (x) { x[key][c] = v; }); }, "%");
                });
                S.slider(mhost, "Constant", row.constant || 0, -200, 200, 1, function (v) { set(function (x) { x[key].constant = v; }); }, "%");
            };
            buildMx();
            break;
        }
        case "color lookup": {
            S.note(body, a.lut3DFileName || a.name ? ("Lookup: " + String(a.lut3DFileName || a.name).split(/[\\/]/).pop()) : "No lookup table loaded.");
            if (!PS.adjustmentLut3D(a) && (a.lut3DFileName || a.name)) {
                S.note(body, "This lookup uses an embedded color profile Pixel Studio does not draw; it is kept in the file.");
            }
            S.button(body, "Load .cube / .3dl File...", function () {
                var inp = document.createElement("input");
                inp.type = "file";
                inp.accept = ".cube,.3dl,.CUBE,.3DL";
                inp.addEventListener("change", function () {
                    var f = inp.files[0];
                    if (!f) { return; }
                    f.arrayBuffer().then(function (buf) {
                        var bytes = new Uint8Array(buf);
                        var text = new TextDecoder().decode(bytes);
                        var fmt = /\.3dl$/i.test(f.name) ? "3dl" : "cube";
                        if (!PS.parseLut3D(text, fmt)) { PS.toast("Not a lookup table Pixel Studio can read: " + f.name, true); return; }
                        set(function (x) {
                            x.lookupType = "3dlut"; x.lutFormat = fmt; x.name = f.name; x.lut3DFileName = f.name;
                            x.lut3DFileData = bytes; x.dataOrder = "rgb"; x.tableOrder = "bgr";
                            delete x.profile;
                            x._lut3d = null;
                        });
                        PS.renderPropertiesPanel(layer);
                    });
                });
                inp.click();
            });
            break;
        }
        case "invert":
            S.note(body, "Inverts the colors below. No settings.");
            break;
        case "posterize":
            S.slider(body, "Levels", a.levels || 4, 2, 255, 1, function (v) { set(function (x) { x.levels = v; }); });
            break;
        case "threshold":
            S.slider(body, "Threshold", a.level || 128, 1, 255, 1, function (v) { set(function (x) { x.level = v; }); });
            break;
        case "gradient map":
            S.gradient(body, "Gradient", { type: "solid", colorStops: a.colorStops, opacityStops: a.opacityStops }, function (g) {
                set(function (x) { x.colorStops = g.colorStops; x.opacityStops = g.opacityStops; x.gradientType = "solid"; });
            });
            S.check(body, "Dither", a.dither, function (v) { set(function (x) { x.dither = v; }); });
            S.check(body, "Reverse", a.reverse, function (v) { set(function (x) { x.reverse = v; }); });
            break;
        case "selective color": {
            var col = "reds";
            var shost = document.createElement("div");
            S.select(body, "Colors", ["reds", "yellows", "greens", "cyans", "blues", "magentas", "whites", "neutrals", "blacks"].map(function (c) {
                return { v: c, l: c.charAt(0).toUpperCase() + c.slice(1) };
            }), col, function (v) { col = v; buildSc(); });
            body.appendChild(shost);
            var buildSc = function () {
                shost.innerHTML = "";
                var v0 = layer.adjustment[col] || (layer.adjustment[col] = { c: 0, m: 0, y: 0, k: 0 });
                [["c", "Cyan"], ["m", "Magenta"], ["y", "Yellow"], ["k", "Black"]].forEach(function (k) {
                    S.slider(shost, k[1], v0[k[0]] || 0, -100, 100, 1, function (v) { set(function (x) { x[col][k[0]] = v; }); }, "%");
                });
            };
            buildSc();
            S.select(body, "Method", [{ v: "relative", l: "Relative" }, { v: "absolute", l: "Absolute" }], a.mode || "relative", function (v) { set(function (x) { x.mode = v; }); });
            break;
        }
    }
};

// Curves: drag points, click to add, drag a point off the graph to remove
PS.curvesEditor = function (body, layer, set) {
    var chan = "rgb";
    PS.prop.select(body, "Channel", [{ v: "rgb", l: "RGB" }, { v: "red", l: "Red" }, { v: "green", l: "Green" }, { v: "blue", l: "Blue" }], chan, function (v) { chan = v; draw(); });
    var c = document.createElement("canvas");
    c.width = 200; c.height = 200;
    c.className = "curves-canvas";
    body.appendChild(c);
    PS.prop.note(body, "Click to add a point, drag to move it, drag it off the graph to remove it.");
    var dragIdx = -1;
    function pts() {
        var a = layer.adjustment;
        if (!a[chan] || a[chan].length < 2) { a[chan] = [{ input: 0, output: 0 }, { input: 255, output: 255 }]; }
        return a[chan];
    }
    function toXY(p) { return { x: p.input / 255 * 199 + 0.5, y: 199.5 - p.output / 255 * 199 }; }
    function draw() {
        var ctx = c.getContext("2d");
        ctx.fillStyle = "#1e1e1e";
        ctx.fillRect(0, 0, 200, 200);
        ctx.strokeStyle = "#3a3a3a";
        ctx.lineWidth = 1;
        for (var i = 1; i < 4; i++) {
            ctx.beginPath(); ctx.moveTo(i * 50 + 0.5, 0); ctx.lineTo(i * 50 + 0.5, 200); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i * 50 + 0.5); ctx.lineTo(200, i * 50 + 0.5); ctx.stroke();
        }
        ctx.strokeStyle = "#555";
        ctx.beginPath(); ctx.moveTo(0, 200); ctx.lineTo(200, 0); ctx.stroke();
        var vals = PS.curveSpline(pts());
        ctx.strokeStyle = { rgb: "#e6e6e6", red: "#ff6666", green: "#66dd66", blue: "#6699ff" }[chan];
        ctx.beginPath();
        for (var x = 0; x < 256; x++) {
            var px = x / 255 * 199 + 0.5, py = 199.5 - PS.clamp(vals[x], 0, 255) / 255 * 199;
            if (x === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
        }
        ctx.stroke();
        pts().forEach(function (p, i) {
            var q = toXY(p);
            ctx.fillStyle = i === dragIdx ? "#4a90d9" : "#fff";
            ctx.fillRect(q.x - 3, q.y - 3, 6, 6);
        });
    }
    function eventVal(e) {
        var r = c.getBoundingClientRect();
        return {
            input: PS.clamp(Math.round((e.clientX - r.left) / r.width * 255), 0, 255),
            output: PS.clamp(Math.round((1 - (e.clientY - r.top) / r.height) * 255), 0, 255),
            outside: e.clientX < r.left - 20 || e.clientX > r.right + 20 || e.clientY < r.top - 20 || e.clientY > r.bottom + 20
        };
    }
    c.addEventListener("pointerdown", function (e) {
        var v = eventVal(e);
        var p = pts();
        dragIdx = -1;
        p.forEach(function (q, i) {
            if (Math.abs(q.input - v.input) < 8 && Math.abs(q.output - v.output) < 12) { dragIdx = i; }
        });
        if (dragIdx < 0) {
            set(function (a) {
                a[chan].push({ input: v.input, output: v.output });
                a[chan].sort(function (x, y) { return x.input - y.input; });
            });
            pts().forEach(function (q, i) { if (q.input === v.input && q.output === v.output) { dragIdx = i; } });
        }
        c.setPointerCapture(e.pointerId);
        draw();
    });
    c.addEventListener("pointermove", function (e) {
        if (dragIdx < 0 || !(e.buttons & 1)) { return; }
        var v = eventVal(e);
        set(function (a) {
            var p = a[chan];
            var q = p[dragIdx];
            if (!q) { return; }
            var lo = dragIdx > 0 ? p[dragIdx - 1].input + 1 : 0;
            var hi = dragIdx < p.length - 1 ? p[dragIdx + 1].input - 1 : 255;
            q.input = PS.clamp(v.input, lo, hi);
            q.output = v.output;
            q._remove = v.outside && p.length > 2;
        });
        draw();
    });
    c.addEventListener("pointerup", function () {
        if (dragIdx >= 0) {
            set(function (a) { a[chan] = a[chan].filter(function (q) { var r = !q._remove; delete q._remove; return r; }); });
        }
        dragIdx = -1;
        draw();
    });
    draw();
};

/* ---------- fill and shape layers ---------- */

PS.fillContentEditor = function (body, getContent, setContent, label) {
    var S = PS.prop;
    var content = getContent();
    var type = content.type || (content.colorStops ? "gradient" : "color");
    if (type === "solid" || type === "noise") { type = "gradient"; }
    S.select(body, label || "Fill", [{ v: "color", l: "Solid Color" }, { v: "gradient", l: "Gradient" }, { v: "pattern", l: "Pattern" }], type, function (v) {
        if (v === "color") { setContent({ type: "color", color: PS.hexToPsdColor(PS.fg) }); }
        else if (v === "gradient") {
            var g = PS.stopsToPsdGradient([{ pos: 0, color: PS.fg }, { pos: 1, color: PS.bg }], "Foreground to Background");
            setContent(Object.assign(g, { style: "linear", angle: 90, scale: 1, reverse: false, dither: true, align: true, offset: { x: 0, y: 0 } }));
        } else {
            var pat = PS.availablePatterns()[0];
            PS.ensurePatternInDoc(pat);
            setContent({ type: "pattern", name: pat.name, id: pat.id, scale: 1, phase: { x: 0, y: 0 }, linked: true });
        }
        PS.renderPropertiesPanel();
    });
    if (type === "color") {
        S.color(body, "Color", content.color, function (c) { setContent(Object.assign({}, getContent(), { type: "color", color: c })); });
    } else if (type === "gradient") {
        S.gradient(body, "Gradient", content, function (g) {
            var cur = getContent();
            setContent(Object.assign({}, cur, { colorStops: g.colorStops, opacityStops: g.opacityStops, type: "solid" }));
        });
        S.select(body, "Style", ["linear", "radial", "angle", "reflected", "diamond"].map(function (s) {
            return { v: s, l: s.charAt(0).toUpperCase() + s.slice(1) };
        }), content.style || "linear", function (v) { setContent(Object.assign({}, getContent(), { style: v })); });
        S.slider(body, "Angle", content.angle === undefined ? 90 : content.angle, -180, 180, 1, function (v) { setContent(Object.assign({}, getContent(), { angle: v })); }, "°");
        S.slider(body, "Scale", Math.round((content.scale === undefined ? 1 : content.scale) * 100), 10, 150, 1, function (v) { setContent(Object.assign({}, getContent(), { scale: v / 100 })); }, "%");
        S.check(body, "Reverse", content.reverse, function (v) { setContent(Object.assign({}, getContent(), { reverse: v })); });
    } else {
        var pats = PS.availablePatterns();
        var grid = document.createElement("div");
        grid.className = "prop-patterns";
        pats.forEach(function (p) {
            var c = document.createElement("canvas");
            c.width = 32; c.height = 32;
            c.className = "prop-pattern" + (p.id === content.id ? " active" : "");
            c.title = String(p.name).replace(/^\$\$\$\/[^=]*=/, "");
            PS.ensurePatternInDoc(p);
            var pc = PS.patternCanvas(p);
            if (pc) {
                var ctx = c.getContext("2d");
                ctx.fillStyle = ctx.createPattern(pc, "repeat");
                ctx.fillRect(0, 0, 32, 32);
            }
            c.addEventListener("click", function () {
                setContent(Object.assign({}, getContent(), { type: "pattern", name: p.name, id: p.id }));
                PS.renderPropertiesPanel();
            });
            grid.appendChild(c);
        });
        body.appendChild(grid);
        S.slider(body, "Scale", Math.round((content.scale || 1) * 100), 1, 1000, 1, function (v) { setContent(Object.assign({}, getContent(), { scale: v / 100 })); }, "%");
    }
};

PS.fillProperties = function (body, layer) {
    var ed = PS.propEditor(layer, "Fill Settings", function (l) { return l.fill; }, function (l, v) { l.fill = v; });
    PS._propCommit = ed.commit;
    PS.fillContentEditor(body, function () { return layer.fill; }, function (c) {
        ed.change(function () { layer.fill = c; });
    });
};

PS.shapeProperties = function (body, layer) {
    var ed = PS.propEditor(layer, "Shape Settings",
        function (l) { return { fill: l.fill, stroke: l.stroke }; },
        function (l, v) { l.fill = v.fill; l.stroke = v.stroke; });
    PS._propCommit = ed.commit;
    var S = PS.prop;
    function stroke() {
        if (!layer.stroke) {
            layer.stroke = {
                strokeEnabled: false, fillEnabled: true, lineWidth: { value: 3, units: "Pixels" },
                lineDashOffset: { value: 0, units: "Pixels" }, miterLimit: 100, lineCapType: "butt",
                lineJoinType: "miter", lineAlignment: "center", lineDashSet: [], blendMode: "normal", opacity: 1,
                content: { type: "color", color: { r: 0, g: 0, b: 0 } }, resolution: 72
            };
        }
        return layer.stroke;
    }
    S.check(body, "Fill", !layer.stroke || layer.stroke.fillEnabled !== false, function (v) { ed.change(function () { stroke().fillEnabled = v; }); });
    PS.fillContentEditor(body, function () { return layer.fill; }, function (c) { ed.change(function () { layer.fill = c; }); }, "Fill type");
    var sec = S.section(body, "Stroke");
    S.check(sec, "Stroke", layer.stroke && layer.stroke.strokeEnabled, function (v) { ed.change(function () { stroke().strokeEnabled = v; }); });
    var st = layer.stroke || {};
    S.color(sec, "Color", (st.content && st.content.color) || { r: 0, g: 0, b: 0 }, function (c) {
        ed.change(function () { stroke().content = { type: "color", color: c }; stroke().strokeEnabled = true; });
    });
    var w = PS.unitPx(st.lineWidth, 3);
    if (st.lineWidth && st.lineWidth.units === "Points") { w = w * (st.resolution || 72) / 72; }
    S.slider(sec, "Width", Math.round(w * 10) / 10, 0, 288, 0.1, function (v) {
        ed.change(function () { stroke().lineWidth = { value: v, units: "Pixels" }; });
    }, "px");
    S.select(sec, "Align", [{ v: "inside", l: "Inside" }, { v: "center", l: "Center" }, { v: "outside", l: "Outside" }], st.lineAlignment || "center", function (v) {
        ed.change(function () { stroke().lineAlignment = v; });
    });
    S.select(sec, "Dashes", [{ v: "solid", l: "Solid" }, { v: "dash", l: "Dashed" }, { v: "dot", l: "Dotted" }],
        (st.lineDashSet && st.lineDashSet.length) ? (PS.unitPx(st.lineDashSet[0]) <= 0.5 ? "dot" : "dash") : "solid", function (v) {
            ed.change(function () {
                var s2 = stroke();
                s2.lineDashSet = v === "solid" ? [] : (v === "dash" ? [{ value: 4, units: "None" }, { value: 2, units: "None" }] : [{ value: 0, units: "None" }, { value: 2, units: "None" }]);
                s2.lineCapType = v === "dot" ? "round" : s2.lineCapType;
            });
        });
};

PS.smartProperties = function (body, layer) {
    var s = layer.smart || {};
    var files = (PS.doc.psd && PS.doc.psd.linkedFiles) || [];
    var f = files.filter(function (x) { return x.id === s.id; })[0];
    PS.prop.note(body, "Embedded " + (s.type || "raster") + " smart object" + (f ? ": " + f.name : "") +
        (s.width ? " (" + Math.round(s.width) + " x " + Math.round(s.height) + " px source)" : "") + ".");
    PS.prop.note(body, "Pixel Studio shows the rendering of the smart object stored in the file and keeps its contents, transform and smart filters. Move it freely; rasterize it to paint on it.");
    if (f && f.data) {
        PS.prop.button(body, "Save Contents As...", function () {
            var name = f.name || "contents";
            PS.downloadBlob(new Blob([f.data]), name);
        });
    }
    PS.prop.button(body, "Rasterize", function () { PS.rasterizeLayer(layer); });
};
