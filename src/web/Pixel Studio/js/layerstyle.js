/*
    Pixel Studio - Layer Style dialog

    The Layer Style window: Blending Options (mode, opacity, fill,
    Blend If) and every layer effect, edited live on the canvas. The values
    are written straight into layer.effects (ag-psd's LayerEffectsInfo), so
    whatever the file stored round-trips and whatever is set here is saved
    with the document. OK records one undo step; Cancel restores the layer.
*/
"use strict";

PS.EFFECT_DEFAULTS = {
    dropShadow: function () {
        return { enabled: true, present: true, showInDialog: true, blendMode: "multiply", color: { r: 0, g: 0, b: 0 }, opacity: 0.75, useGlobalLight: true, angle: 120, distance: { value: 5, units: "Pixels" }, choke: { value: 0, units: "Pixels" }, size: { value: 5, units: "Pixels" }, noise: 0, antialiased: false, contour: PS.contourFromPreset("Linear"), layerConceals: true };
    },
    innerShadow: function () {
        return { enabled: true, present: true, showInDialog: true, blendMode: "multiply", color: { r: 0, g: 0, b: 0 }, opacity: 0.75, useGlobalLight: true, angle: 120, distance: { value: 5, units: "Pixels" }, choke: { value: 0, units: "Pixels" }, size: { value: 5, units: "Pixels" }, noise: 0, antialiased: false, contour: PS.contourFromPreset("Linear") };
    },
    outerGlow: function () {
        return { enabled: true, present: true, showInDialog: true, blendMode: "screen", color: { r: 255, g: 255, b: 190 }, opacity: 0.75, technique: "softer", choke: { value: 0, units: "Pixels" }, size: { value: 5, units: "Pixels" }, noise: 0, jitter: 0, antialiased: false, contour: PS.contourFromPreset("Linear"), range: 0.5 };
    },
    innerGlow: function () {
        return { enabled: true, present: true, showInDialog: true, blendMode: "screen", color: { r: 255, g: 255, b: 190 }, opacity: 0.75, technique: "softer", choke: { value: 0, units: "Pixels" }, size: { value: 5, units: "Pixels" }, noise: 0, jitter: 0, antialiased: false, source: "edge", contour: PS.contourFromPreset("Linear"), range: 0.5 };
    },
    bevel: function () {
        return { enabled: true, present: true, showInDialog: true, highlightBlendMode: "screen", highlightColor: { r: 255, g: 255, b: 255 }, highlightOpacity: 0.75, shadowBlendMode: "multiply", shadowColor: { r: 0, g: 0, b: 0 }, shadowOpacity: 0.75, technique: "smooth", style: "inner bevel", useGlobalLight: true, angle: 120, altitude: 30, strength: 1, size: { value: 5, units: "Pixels" }, direction: "up", soften: { value: 0, units: "Pixels" }, contour: PS.contourFromPreset("Linear"), antialiasGloss: false, useShape: false, useTexture: false };
    },
    satin: function () {
        return { enabled: true, present: true, showInDialog: true, blendMode: "multiply", color: { r: 0, g: 0, b: 0 }, antialiased: false, invert: true, opacity: 0.5, angle: 19, distance: { value: 11, units: "Pixels" }, size: { value: 14, units: "Pixels" }, contour: PS.contourFromPreset("Gaussian") };
    },
    solidFill: function () {
        return { enabled: true, present: true, showInDialog: true, blendMode: "normal", color: { r: 255, g: 0, b: 0 }, opacity: 1 };
    },
    gradientOverlay: function () {
        return { enabled: true, present: true, showInDialog: true, blendMode: "normal", opacity: 1, gradient: PS.stopsToPsdGradient([{ pos: 0, color: "#000000" }, { pos: 1, color: "#ffffff" }], "Black, White"), type: "linear", angle: 90, scale: 1, reverse: false, dither: false, align: true, offset: { x: 0, y: 0 } };
    },
    patternOverlay: function () {
        var p = PS.availablePatterns()[0];
        PS.ensurePatternInDoc(p);
        return { enabled: true, present: true, showInDialog: true, blendMode: "normal", opacity: 1, pattern: { name: p.name, id: p.id }, scale: 1, align: true, phase: { x: 0, y: 0 } };
    },
    stroke: function () {
        return { enabled: true, present: true, showInDialog: true, overprint: false, size: { value: 3, units: "Pixels" }, position: "outside", fillType: "color", blendMode: "normal", opacity: 1, color: { r: 0, g: 0, b: 0 } };
    }
};

PS.MULTI_EFFECTS = { dropShadow: 1, innerShadow: 1, solidFill: 1, gradientOverlay: 1, stroke: 1 };

PS.openLayerStyleDialog = function (focusKey, addIfMissing) {
    var layer = PS.activeLayer();
    if (!layer || !PS.doc) { return; }
    if (PS._layerStyleOpen) { PS._layerStyleOpen.close(); }
    if (PS.commitTextEdit) { PS.commitTextEdit(); }
    var d = PS.doc;
    var snap = {
        effects: PS.deepCopy(layer.effects), blend: layer.blend, opacity: layer.opacity,
        fillOpacity: layer.fillOpacity, blendIf: PS.deepCopy(layer.blendIf),
        angle: d.globalAngle, altitude: d.globalAltitude,
        psdFlags: layer.psd ? { a: layer.psd.blendInteriorElements, b: layer.psd.blendClippendElements } : null
    };
    if (!layer.effects) { layer.effects = { disabled: false, scale: 1 }; }
    var fx = layer.effects;
    var current = { key: "blending", index: 0 };
    var listHost, settingsHost;
    var accepted = false;

    function list(key) { return fx[key] ? (Array.isArray(fx[key]) ? fx[key] : [fx[key]]) : []; }
    function entry(key, i) { return list(key)[i || 0]; }
    function isOn(e) { return !!(e && e.present !== false && e.enabled !== false); }

    function ensure(key) {
        if (!list(key).length) {
            var e = PS.EFFECT_DEFAULTS[key]();
            fx[key] = PS.MULTI_EFFECTS[key] ? [e] : e;
        }
        return entry(key, 0);
    }

    function changed() {
        PS.requestRender();
    }

    if (focusKey && focusKey !== "blending") {
        if (addIfMissing || !list(focusKey).length) {
            var e0 = ensure(focusKey);
            e0.enabled = true; e0.present = true;
        }
        current = { key: focusKey, index: 0 };
    }

    /* ---- left: effect list ---- */
    function renderList() {
        listHost.innerHTML = "";
        function item(label, key, index, hasCheck) {
            var row = document.createElement("div");
            row.className = "ls-item" + (current.key === key && current.index === index ? " active" : "");
            if (hasCheck) {
                var c = document.createElement("input");
                c.type = "checkbox";
                c.checked = isOn(entry(key, index));
                c.addEventListener("click", function (ev) {
                    ev.stopPropagation();
                    var en = list(key).length ? entry(key, index) : ensure(key);
                    en.enabled = c.checked;
                    en.present = true;
                    changed();
                    current = { key: key, index: index };
                    renderList();
                    renderSettings();
                });
                row.appendChild(c);
            }
            var l = document.createElement("span");
            l.textContent = label;
            row.appendChild(l);
            if (PS.MULTI_EFFECTS[key] && list(key).length && index === list(key).length - 1) {
                var add = document.createElement("button");
                add.className = "ls-add";
                add.textContent = "+";
                add.title = "Add another " + label;
                add.addEventListener("click", function (ev) {
                    ev.stopPropagation();
                    if (!Array.isArray(fx[key])) { fx[key] = [fx[key]]; }
                    fx[key].unshift(PS.EFFECT_DEFAULTS[key]());
                    current = { key: key, index: 0 };
                    changed();
                    renderList();
                    renderSettings();
                });
                row.appendChild(add);
                if (list(key).length > 1) {
                    var rem = document.createElement("button");
                    rem.className = "ls-add";
                    rem.textContent = "−";
                    rem.title = "Remove this " + label;
                    rem.addEventListener("click", function (ev) {
                        ev.stopPropagation();
                        fx[key].splice(current.key === key ? current.index : index, 1);
                        current = { key: key, index: 0 };
                        changed();
                        renderList();
                        renderSettings();
                    });
                    row.appendChild(rem);
                }
            }
            row.addEventListener("click", function () {
                if (hasCheck && !list(key).length) { var en = ensure(key); en.enabled = true; changed(); }
                current = { key: key, index: index };
                renderList();
                renderSettings();
            });
            listHost.appendChild(row);
        }
        item("Blending Options", "blending", 0, false);
        PS.EFFECT_NAMES.forEach(function (e) {
            var n = Math.max(1, list(e[0]).length);
            for (var i = 0; i < n; i++) { item(e[1], e[0], i, true); }
        });
        var all = document.createElement("label");
        all.className = "ls-all";
        var ac = document.createElement("input");
        ac.type = "checkbox";
        ac.checked = !fx.disabled;
        ac.addEventListener("change", function () { fx.disabled = !ac.checked; changed(); });
        all.appendChild(ac);
        all.appendChild(document.createTextNode(" Show effects"));
        listHost.appendChild(all);
    }

    /* ---- right: settings ---- */
    var S = PS.prop;
    function px(host, label, obj, key, min, max) {
        return S.slider(host, label, PS.unitPx(obj[key], 0), min, max, 1, function (v) {
            obj[key] = { value: v, units: "Pixels" }; changed();
        }, "px");
    }
    function pct(host, label, obj, key, min, max, unitless) {
        var v0 = obj[key] === undefined ? 0 : obj[key];
        return S.slider(host, label, Math.round(v0 * 100), min || 0, max || 100, 1, function (v) {
            obj[key] = v / 100; changed();
        }, unitless ? "" : "%");
    }
    function pctUnits(host, label, obj, key) {
        return S.slider(host, label, PS.unitPx(obj[key], 0), 0, 100, 1, function (v) {
            obj[key] = { value: v, units: "Pixels" }; changed();
        }, "%");
    }
    function blend(host, label, obj, key) {
        return S.select(host, label || "Blend Mode", PS.blendModeOptions(false), obj[key] || "normal", function (v) { obj[key] = v; changed(); });
    }
    function color(host, label, obj, key) {
        return S.color(host, label || "Color", obj[key] || { r: 0, g: 0, b: 0 }, function (c) { obj[key] = c; changed(); });
    }
    function contour(host, label, obj, key) {
        var name = (obj[key] && obj[key].name) || "Linear";
        var opts = PS.contourPresets.map(function (c) { return { v: c.name, l: c.name }; });
        if (!PS.contourPresets.some(function (c) { return c.name === name; })) { opts.unshift({ v: name, l: String(name).replace(/^\$\$\$\/[^=]*=/, "") }); }
        return S.select(host, label || "Contour", opts, name, function (v) {
            if (PS.contourPresets.some(function (c) { return c.name === v; })) { obj[key] = PS.contourFromPreset(v); changed(); }
        });
    }
    function angle(host, obj, withAltitude) {
        var useG = obj.useGlobalLight !== false;
        var a = S.slider(host, "Angle", Math.round(useG ? d.globalAngle : (obj.angle === undefined ? 120 : obj.angle)), -180, 180, 1, function (v) {
            if (obj.useGlobalLight !== false) { d.globalAngle = v; } else { obj.angle = v; }
            changed();
        }, "°");
        var alt = null;
        if (withAltitude) {
            alt = S.slider(host, "Altitude", Math.round(useG ? d.globalAltitude : (obj.altitude === undefined ? 30 : obj.altitude)), 0, 90, 1, function (v) {
                if (obj.useGlobalLight !== false) { d.globalAltitude = v; } else { obj.altitude = v; }
                changed();
            }, "°");
        }
        S.check(host, "Use Global Light", useG, function (v) {
            obj.useGlobalLight = v;
            if (!v) { obj.angle = d.globalAngle; if (withAltitude) { obj.altitude = d.globalAltitude; } }
            changed();
            renderSettings();
        });
        return a;
    }

    function renderSettings() {
        settingsHost.innerHTML = "";
        var h = document.createElement("div");
        h.className = "ls-heading";
        settingsHost.appendChild(h);
        var key = current.key;
        if (key === "blending") {
            h.textContent = "Blending Options";
            S.select(settingsHost, "Blend Mode", PS.blendModeOptions(layer.kind === "group"), layer.blend, function (v) { layer.blend = v; changed(); });
            S.slider(settingsHost, "Opacity", Math.round(layer.opacity * 100), 0, 100, 1, function (v) { layer.opacity = v / 100; changed(); }, "%");
            if (layer.kind !== "group") {
                S.slider(settingsHost, "Fill Opacity", Math.round(layer.fillOpacity * 100), 0, 100, 1, function (v) { layer.fillOpacity = v / 100; changed(); }, "%");
            }
            layer.psd = layer.psd || {};
            S.check(settingsHost, "Blend Interior Effects as Group", !!layer.psd.blendInteriorElements, function (v) { layer.psd.blendInteriorElements = v; });
            S.check(settingsHost, "Blend Clipped Layers as Group", layer.psd.blendClippendElements !== false, function (v) { layer.psd.blendClippendElements = v; });
            PS.blendIfEditor(settingsHost, layer, changed);
            return;
        }
        var e = entry(key, current.index);
        if (!e) { e = ensure(key); }
        h.textContent = (PS.EFFECT_NAMES.filter(function (x) { return x[0] === key; })[0] || [0, key])[1];
        var sec;
        switch (key) {
            case "dropShadow":
            case "innerShadow":
                blend(settingsHost, null, e, "blendMode");
                color(settingsHost, null, e, "color");
                pct(settingsHost, "Opacity", e, "opacity");
                angle(settingsHost, e, false);
                px(settingsHost, "Distance", e, "distance", 0, 1000);
                pctUnits(settingsHost, key === "dropShadow" ? "Spread" : "Choke", e, "choke");
                px(settingsHost, "Size", e, "size", 0, 250);
                contour(settingsHost, null, e, "contour");
                pct(settingsHost, "Noise", e, "noise");
                if (key === "dropShadow") {
                    S.check(settingsHost, "Layer Knocks Out Drop Shadow", e.layerConceals !== false, function (v) { e.layerConceals = v; changed(); });
                }
                break;
            case "outerGlow":
            case "innerGlow":
                blend(settingsHost, null, e, "blendMode");
                pct(settingsHost, "Opacity", e, "opacity");
                pct(settingsHost, "Noise", e, "noise");
                color(settingsHost, null, e, "color");
                S.select(settingsHost, "Technique", [{ v: "softer", l: "Softer" }, { v: "precise", l: "Precise" }], e.technique || "softer", function (v) { e.technique = v; changed(); });
                if (key === "innerGlow") {
                    S.select(settingsHost, "Source", [{ v: "center", l: "Center" }, { v: "edge", l: "Edge" }], e.source || "edge", function (v) { e.source = v; changed(); });
                }
                pctUnits(settingsHost, key === "outerGlow" ? "Spread" : "Choke", e, "choke");
                px(settingsHost, "Size", e, "size", 0, 250);
                contour(settingsHost, null, e, "contour");
                pct(settingsHost, "Range", e, "range", 1, 100);
                break;
            case "bevel":
                S.select(settingsHost, "Style", ["outer bevel", "inner bevel", "emboss", "pillow emboss", "stroke emboss"].map(function (s) {
                    return { v: s, l: s.replace(/\b\w/g, function (c) { return c.toUpperCase(); }) };
                }), e.style || "inner bevel", function (v) { e.style = v; changed(); });
                S.select(settingsHost, "Technique", [{ v: "smooth", l: "Smooth" }, { v: "chisel hard", l: "Chisel Hard" }, { v: "chisel soft", l: "Chisel Soft" }], e.technique || "smooth", function (v) { e.technique = v; changed(); });
                pct(settingsHost, "Depth", e, "strength", 1, 1000);
                S.select(settingsHost, "Direction", [{ v: "up", l: "Up" }, { v: "down", l: "Down" }], e.direction || "up", function (v) { e.direction = v; changed(); });
                px(settingsHost, "Size", e, "size", 0, 250);
                px(settingsHost, "Soften", e, "soften", 0, 16);
                sec = S.section(settingsHost, "Shading");
                angle(sec, e, true);
                contour(sec, "Gloss Contour", e, "contour");
                blend(sec, "Highlight Mode", e, "highlightBlendMode");
                color(sec, "Highlight", e, "highlightColor");
                pct(sec, "Highlight Opacity", e, "highlightOpacity");
                blend(sec, "Shadow Mode", e, "shadowBlendMode");
                color(sec, "Shadow", e, "shadowColor");
                pct(sec, "Shadow Opacity", e, "shadowOpacity");
                break;
            case "satin":
                blend(settingsHost, null, e, "blendMode");
                color(settingsHost, null, e, "color");
                pct(settingsHost, "Opacity", e, "opacity");
                S.slider(settingsHost, "Angle", e.angle === undefined ? 19 : e.angle, -180, 180, 1, function (v) { e.angle = v; changed(); }, "°");
                px(settingsHost, "Distance", e, "distance", 1, 250);
                px(settingsHost, "Size", e, "size", 0, 250);
                contour(settingsHost, null, e, "contour");
                S.check(settingsHost, "Invert", e.invert, function (v) { e.invert = v; changed(); });
                break;
            case "solidFill":
                blend(settingsHost, null, e, "blendMode");
                color(settingsHost, null, e, "color");
                pct(settingsHost, "Opacity", e, "opacity");
                break;
            case "gradientOverlay":
                blend(settingsHost, null, e, "blendMode");
                pct(settingsHost, "Opacity", e, "opacity");
                S.gradient(settingsHost, "Gradient", e.gradient, function (g) { e.gradient = Object.assign({}, e.gradient || {}, g); changed(); });
                S.check(settingsHost, "Reverse", e.reverse, function (v) { e.reverse = v; changed(); });
                S.select(settingsHost, "Style", ["linear", "radial", "angle", "reflected", "diamond"].map(function (s) {
                    return { v: s, l: s.charAt(0).toUpperCase() + s.slice(1) };
                }), e.type || "linear", function (v) { e.type = v; changed(); });
                S.check(settingsHost, "Align with Layer", e.align !== false, function (v) { e.align = v; changed(); });
                S.slider(settingsHost, "Angle", e.angle === undefined ? 90 : e.angle, -180, 180, 1, function (v) { e.angle = v; changed(); }, "°");
                pct(settingsHost, "Scale", e, "scale", 10, 150);
                S.check(settingsHost, "Dither", e.dither, function (v) { e.dither = v; changed(); });
                break;
            case "patternOverlay":
                blend(settingsHost, null, e, "blendMode");
                pct(settingsHost, "Opacity", e, "opacity");
                PS.patternPicker(settingsHost, e.pattern, function (p) { e.pattern = { name: p.name, id: p.id }; PS.ensurePatternInDoc(p); changed(); });
                pct(settingsHost, "Scale", e, "scale", 1, 1000);
                break;
            case "stroke":
                px(settingsHost, "Size", e, "size", 1, 250);
                S.select(settingsHost, "Position", [{ v: "outside", l: "Outside" }, { v: "inside", l: "Inside" }, { v: "center", l: "Center" }], e.position || "outside", function (v) { e.position = v; changed(); });
                blend(settingsHost, null, e, "blendMode");
                pct(settingsHost, "Opacity", e, "opacity");
                S.select(settingsHost, "Fill Type", [{ v: "color", l: "Color" }, { v: "gradient", l: "Gradient" }, { v: "pattern", l: "Pattern" }], e.fillType || "color", function (v) {
                    e.fillType = v;
                    if (v === "gradient" && !e.gradient) {
                        e.gradient = Object.assign(PS.stopsToPsdGradient([{ pos: 0, color: "#000000" }, { pos: 1, color: "#ffffff" }], "Black, White"), { style: "linear", angle: 90, scale: 1, align: true });
                    }
                    if (v === "pattern" && !e.pattern) {
                        var p = PS.availablePatterns()[0];
                        PS.ensurePatternInDoc(p);
                        e.pattern = { name: p.name, id: p.id };
                    }
                    changed();
                    renderSettings();
                });
                if ((e.fillType || "color") === "color") { color(settingsHost, null, e, "color"); }
                else if (e.fillType === "gradient") {
                    S.gradient(settingsHost, "Gradient", e.gradient, function (g) { e.gradient = Object.assign({}, e.gradient || {}, g); changed(); });
                    S.select(settingsHost, "Style", ["linear", "radial", "angle", "reflected", "diamond"].map(function (s) {
                        return { v: s, l: s.charAt(0).toUpperCase() + s.slice(1) };
                    }), (e.gradient && e.gradient.style) || "linear", function (v) { e.gradient.style = v; changed(); });
                    S.slider(settingsHost, "Angle", (e.gradient && e.gradient.angle !== undefined) ? e.gradient.angle : 90, -180, 180, 1, function (v) { e.gradient.angle = v; changed(); }, "°");
                } else {
                    PS.patternPicker(settingsHost, e.pattern, function (p) { e.pattern = { name: p.name, id: p.id }; PS.ensurePatternInDoc(p); changed(); });
                }
                break;
        }
    }

    var panel = PS.floatingPanel({
        title: "Layer Style - " + layer.name,
        x: Math.max(8, window.innerWidth - 980),
        y: 70,
        build: function (body) {
            body.classList.add("ls-body");
            listHost = document.createElement("div");
            listHost.className = "ls-list";
            settingsHost = document.createElement("div");
            settingsHost.className = "ls-settings";
            body.appendChild(listHost);
            body.appendChild(settingsHost);
            renderList();
            renderSettings();
        },
        buttons: [
            { label: "Cancel", action: function () { restore(); } },
            {
                label: "OK", primary: true, action: function () {
                    accepted = true;
                    commit();
                }
            }
        ],
        onCancel: function () { restore(); },
        onClose: function () {
            PS._layerStyleOpen = null;
            if (!accepted) { restore(); }
        }
    });
    PS._layerStyleOpen = panel;

    function cleanEffects(f) {
        if (!f) { return null; }
        // drop effects that were never switched on
        PS.EFFECT_NAMES.forEach(function (e) {
            var v = f[e[0]];
            if (!v) { return; }
            if (Array.isArray(v)) {
                f[e[0]] = v.filter(function (x) { return x.enabled !== false || x.present !== false; });
                if (!f[e[0]].length) { delete f[e[0]]; }
            }
        });
        return PS.listEffects(f).length ? f : null;
    }

    function restore() {
        if (accepted) { return; }
        layer.effects = snap.effects;
        layer.blend = snap.blend;
        layer.opacity = snap.opacity;
        layer.fillOpacity = snap.fillOpacity;
        layer.blendIf = snap.blendIf;
        d.globalAngle = snap.angle;
        d.globalAltitude = snap.altitude;
        if (snap.psdFlags && layer.psd) {
            layer.psd.blendInteriorElements = snap.psdFlags.a;
            layer.psd.blendClippendElements = snap.psdFlags.b;
        }
        PS.requestRender();
        PS.renderLayersPanel();
    }

    function commit() {
        layer.effects = cleanEffects(layer.effects);
        var after = {
            effects: PS.deepCopy(layer.effects), blend: layer.blend, opacity: layer.opacity,
            fillOpacity: layer.fillOpacity, blendIf: PS.deepCopy(layer.blendIf),
            angle: d.globalAngle, altitude: d.globalAltitude
        };
        var before = snap;
        function apply(s) {
            layer.effects = PS.deepCopy(s.effects);
            layer.blend = s.blend;
            layer.opacity = s.opacity;
            layer.fillOpacity = s.fillOpacity;
            layer.blendIf = PS.deepCopy(s.blendIf);
            d.globalAngle = s.angle;
            d.globalAltitude = s.altitude;
        }
        if (JSON.stringify(after) !== JSON.stringify({
            effects: before.effects, blend: before.blend, opacity: before.opacity,
            fillOpacity: before.fillOpacity, blendIf: before.blendIf, angle: before.angle, altitude: before.altitude
        })) {
            PS.pushHistory("Layer Style", function () { apply(before); }, function () { apply(after); });
        }
        PS.requestRender();
        PS.renderLayersPanel();
    }
};

// Pattern swatches to pick from (document patterns + built-in ones)
PS.patternPicker = function (host, current, onPick) {
    var grid = document.createElement("div");
    grid.className = "prop-patterns";
    PS.availablePatterns().forEach(function (p) {
        var c = document.createElement("canvas");
        c.width = 32; c.height = 32;
        c.className = "prop-pattern" + (current && p.id === current.id ? " active" : "");
        c.title = String(p.name).replace(/^\$\$\$\/[^=]*=/, "");
        var pc = (function () {
            var w = p.bounds ? p.bounds.w : 16, h = p.bounds ? p.bounds.h : 16;
            var cc = PS.createCanvas(w, h);
            cc.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(p.data), w, h), 0, 0);
            return cc;
        })();
        var ctx = c.getContext("2d");
        ctx.fillStyle = ctx.createPattern(pc, "repeat");
        ctx.fillRect(0, 0, 32, 32);
        c.addEventListener("click", function () {
            Array.prototype.forEach.call(grid.children, function (x) { x.classList.remove("active"); });
            c.classList.add("active");
            onPick(p);
        });
        grid.appendChild(c);
    });
    host.appendChild(grid);
};

// "Blend If" sliders: This Layer / Underlying Layer, each with black and
// white points that split (low / high) for a smooth transition
PS.blendIfEditor = function (host, layer, changed) {
    var sec = PS.prop.section(host, "Blend If");
    var chan = 0;
    PS.prop.select(sec, "Channel", [{ v: "0", l: "Gray" }, { v: "1", l: "Red" }, { v: "2", l: "Green" }, { v: "3", l: "Blue" }], "0", function (v) {
        chan = parseInt(v, 10);
        build();
    });
    var area = document.createElement("div");
    sec.appendChild(area);
    function bi() {
        if (!layer.blendIf) {
            var r = function () { return [0, 0, 255, 255]; };
            layer.blendIf = {
                compositeGrayBlendSource: r(), compositeGraphBlendDestinationRange: r(),
                ranges: [0, 1, 2, 3].map(function () { return { sourceRange: r(), destRange: r() }; })
            };
        }
        return layer.blendIf;
    }
    function rangeOf(which) {
        var b = bi();
        if (chan === 0) { return which === "src" ? b.compositeGrayBlendSource : b.compositeGraphBlendDestinationRange; }
        var r = b.ranges[chan] || (b.ranges[chan] = { sourceRange: [0, 0, 255, 255], destRange: [0, 0, 255, 255] });
        return which === "src" ? r.sourceRange : r.destRange;
    }
    function build() {
        area.innerHTML = "";
        [["src", "This Layer"], ["dst", "Underlying Layer"]].forEach(function (w) {
            var r = rangeOf(w[0]);
            var t = document.createElement("div");
            t.className = "prop-title";
            t.textContent = w[1];
            area.appendChild(t);
            PS.prop.slider(area, "Black from", r[0], 0, 255, 1, function (v) { r[0] = v; if (r[1] < v) { r[1] = v; } changed(); });
            PS.prop.slider(area, "Black to", r[1], 0, 255, 1, function (v) { r[1] = Math.max(v, r[0]); changed(); });
            PS.prop.slider(area, "White from", r[2], 0, 255, 1, function (v) { r[2] = Math.min(v, r[3]); changed(); });
            PS.prop.slider(area, "White to", r[3], 0, 255, 1, function (v) { r[3] = v; if (r[2] > v) { r[2] = v; } changed(); });
        });
    }
    build();
};
