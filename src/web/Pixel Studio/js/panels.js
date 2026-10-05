/*
    Pixel Studio - workspace panels

    Registers every panel with the workspace (workspace.js) and implements
    the ones that are not owned by another module:
        Color        foreground / background chips, R G B sliders, spectrum
        Swatches     palettes, custom and recent colours (editor.js)
        Adjustments  one click adds an adjustment layer
        Styles       layer style presets
        Channels     RGB / single channel view, layer mask, quick mask
        Navigator    overview of the image with the visible area
        Info         colour and position under the pointer
        Histogram    of the composite image
    Layers, History, Properties, Character and Paragraph are drawn by their
    own modules.
*/
"use strict";

PS.PANEL_ICONS = {
    layers: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M12 4 3 9l9 5 9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
    channels: '<svg viewBox="0 0 24 24" stroke-width="1.6"><circle cx="9" cy="10" r="5"/><circle cx="15" cy="10" r="5"/><circle cx="12" cy="15" r="5"/></svg>',
    color: '<svg viewBox="0 0 24 24" stroke-width="1.6"><rect x="4" y="4" width="10" height="10"/><rect x="10" y="10" width="10" height="10" fill="currentColor"/></svg>',
    swatches: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/></svg>',
    adjustments: '<svg viewBox="0 0 24 24" stroke-width="1.6"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
    styles: '<svg viewBox="0 0 24 24" stroke-width="1.6"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 16l8-8"/></svg>',
    history: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4M12 8v4l3 2"/></svg>',
    properties: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
    character: '<svg viewBox="0 0 24 24" stroke-width="1.8"><path d="M5 19 10 5l5 14M7 14h6M17 5v14"/></svg>',
    paragraph: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M13 4v16M17 4v16M17 4h-7a4 4 0 0 0 0 8h3"/></svg>',
    navigator: '<svg viewBox="0 0 24 24" stroke-width="1.6"><rect x="3" y="5" width="18" height="14"/><rect x="8" y="9" width="7" height="5"/></svg>',
    info: '<svg viewBox="0 0 24 24" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
    histogram: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M3 20h18M5 20v-4M8 20v-8M11 20v-12M14 20v-9M17 20v-5M20 20v-3"/></svg>'
};

/* ============================================================
   COLOR PANEL
   ============================================================ */

PS.colorTarget = "fg";

PS.renderColorSliders = function () {
    var body = PS.el("panel-color-body");
    if (!body) { return; }
    var hex = PS.colorTarget === "fg" ? PS.fg : PS.bg;
    var rgb = PS.hexToRgb(hex) || { r: 0, g: 0, b: 0 };
    if (!body._built) { buildColorPanel(body); }
    var u = body._ui;
    u.fg.style.background = PS.fg;
    u.bg.style.background = PS.bg;
    u.fg.classList.toggle("target", PS.colorTarget === "fg");
    u.bg.classList.toggle("target", PS.colorTarget === "bg");
    ["r", "g", "b"].forEach(function (c) {
        var row = u[c];
        if (document.activeElement !== row.num) { row.num.value = rgb[c]; }
        row.knob.style.left = (rgb[c] / 255 * 100) + "%";
        var lo = { r: rgb.r, g: rgb.g, b: rgb.b }, hi = { r: rgb.r, g: rgb.g, b: rgb.b };
        lo[c] = 0; hi[c] = 255;
        row.track.style.background = "linear-gradient(to right, " + PS.rgbToHex(lo.r, lo.g, lo.b) + ", " + PS.rgbToHex(hi.r, hi.g, hi.b) + ")";
    });
    if (document.activeElement !== u.hex) { u.hex.value = hex.slice(0, 7); }
};

function buildColorPanel(body) {
    body.innerHTML = "";
    body.classList.add("color-panel");
    var ui = {};
    var top = document.createElement("div");
    top.className = "cpanel-top";
    var chips = document.createElement("div");
    chips.className = "cpanel-chips";
    ui.bg = document.createElement("div");
    ui.bg.className = "cpanel-chip bg";
    ui.fg = document.createElement("div");
    ui.fg.className = "cpanel-chip fg";
    [["fg", ui.fg, "Foreground color (click to edit with the sliders, double-click for the picker)"],
        ["bg", ui.bg, "Background color (click to edit with the sliders, double-click for the picker)"]].forEach(function (d) {
        d[1].title = d[2];
        d[1].addEventListener("click", function () { PS.colorTarget = d[0]; PS.renderColorSliders(); });
        d[1].addEventListener("dblclick", function () { PS.openColorPicker(d[0]); });
    });
    chips.appendChild(ui.bg);
    chips.appendChild(ui.fg);
    top.appendChild(chips);

    var sliders = document.createElement("div");
    sliders.className = "cpanel-sliders";
    ["r", "g", "b"].forEach(function (c) {
        var row = document.createElement("div");
        row.className = "cpanel-row";
        var lab = document.createElement("span");
        lab.textContent = c.toUpperCase();
        var track = document.createElement("div");
        track.className = "cpanel-track";
        var knob = document.createElement("i");
        track.appendChild(knob);
        var num = document.createElement("input");
        num.type = "number";
        num.min = 0; num.max = 255;
        num.className = "cpanel-num";
        function set(v) {
            var hex = PS.colorTarget === "fg" ? PS.fg : PS.bg;
            var rgb = PS.hexToRgb(hex) || { r: 0, g: 0, b: 0 };
            rgb[c] = PS.clamp(Math.round(v), 0, 255);
            var out = PS.rgbToHex(rgb.r, rgb.g, rgb.b);
            if (PS.colorTarget === "fg") { PS.setFg(out, true); } else { PS.setBg(out); }
        }
        track.addEventListener("pointerdown", function (e) {
            track.setPointerCapture(e.pointerId);
            function at(ev) {
                var r = track.getBoundingClientRect();
                set((ev.clientX - r.left) / r.width * 255);
            }
            at(e);
            function move(ev) { at(ev); }
            function up() {
                track.removeEventListener("pointermove", move);
                track.removeEventListener("pointerup", up);
                PS.pushRecentColor(PS.colorTarget === "fg" ? PS.fg : PS.bg);
            }
            track.addEventListener("pointermove", move);
            track.addEventListener("pointerup", up);
        });
        num.addEventListener("change", function () { set(parseFloat(num.value) || 0); });
        PS.ui.wheelStep(num, 0, 255, 1, set);
        row.appendChild(lab);
        row.appendChild(track);
        row.appendChild(num);
        sliders.appendChild(row);
        ui[c] = { track: track, knob: knob, num: num };
    });
    top.appendChild(sliders);
    body.appendChild(top);

    var hexRow = document.createElement("div");
    hexRow.className = "cpanel-hexrow";
    var hl = document.createElement("span");
    hl.textContent = "#";
    ui.hex = document.createElement("input");
    ui.hex.className = "color-hex";
    ui.hex.addEventListener("change", function () {
        var rgb = PS.hexToRgb(ui.hex.value);
        if (!rgb) { PS.renderColorSliders(); return; }
        var out = PS.rgbToHex(rgb.r, rgb.g, rgb.b, rgb.a);
        if (PS.colorTarget === "fg") { PS.setFg(out); } else { PS.setBg(out); }
    });
    hexRow.appendChild(hl);
    hexRow.appendChild(ui.hex);
    body.appendChild(hexRow);

    // spectrum ramp: hue across, brightness / saturation up and down
    var ramp = document.createElement("canvas");
    ramp.className = "cpanel-ramp";
    ramp.width = 256; ramp.height = 40;
    var rctx = ramp.getContext("2d");
    var g1 = rctx.createLinearGradient(0, 0, 256, 0);
    ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ff0000"].forEach(function (c, i) { g1.addColorStop(i / 6, c); });
    rctx.fillStyle = g1;
    rctx.fillRect(0, 0, 256, 40);
    var g2 = rctx.createLinearGradient(0, 0, 0, 40);
    g2.addColorStop(0, "rgba(255,255,255,1)");
    g2.addColorStop(0.5, "rgba(255,255,255,0)");
    g2.addColorStop(0.5, "rgba(0,0,0,0)");
    g2.addColorStop(1, "rgba(0,0,0,1)");
    rctx.fillStyle = g2;
    rctx.fillRect(0, 0, 256, 40);
    ramp.title = "Click to pick (Alt+click sets the background color)";
    ramp.addEventListener("pointerdown", function (e) {
        ramp.setPointerCapture(e.pointerId);
        function pick(ev) {
            var r = ramp.getBoundingClientRect();
            var x = PS.clamp(Math.floor((ev.clientX - r.left) / r.width * 256), 0, 255);
            var y = PS.clamp(Math.floor((ev.clientY - r.top) / r.height * 40), 0, 39);
            var d = rctx.getImageData(x, y, 1, 1).data;
            var hex = PS.rgbToHex(d[0], d[1], d[2]);
            if (e.altKey || PS.colorTarget === "bg") { PS.setBg(hex); } else { PS.setFg(hex, true); }
        }
        pick(e);
        function move(ev) { pick(ev); }
        function up() { ramp.removeEventListener("pointermove", move); ramp.removeEventListener("pointerup", up); }
        ramp.addEventListener("pointermove", move);
        ramp.addEventListener("pointerup", up);
    });
    body.appendChild(ramp);
    body._ui = ui;
    body._built = true;
}

/* ============================================================
   ADJUSTMENTS PANEL
   ============================================================ */

PS.ADJ_PANEL_ICONS = {
    "brightness/contrast": '<svg viewBox="0 0 24 24" stroke-width="1.5"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>',
    "levels": '<svg viewBox="0 0 24 24" stroke-width="1.5"><path d="M3 19h18M5 19c2-10 4-12 6-6s4 2 8 6"/></svg>',
    "curves": '<svg viewBox="0 0 24 24" stroke-width="1.5"><rect x="3" y="3" width="18" height="18"/><path d="M4 20C10 20 12 4 20 4"/></svg>',
    "exposure": '<svg viewBox="0 0 24 24" stroke-width="1.5"><rect x="3" y="3" width="18" height="18"/><path d="M3 21 21 3M6 8h4M8 6v4M14 16h4"/></svg>',
    "vibrance": '<svg viewBox="0 0 24 24" stroke-width="1.5"><path d="M4 6l8 14 8-14z"/></svg>',
    "hue/saturation": '<svg viewBox="0 0 24 24" stroke-width="1.5"><path d="M3 18h18M3 13h18M3 8h18"/><path d="M8 6v4M15 11v4M11 16v4"/></svg>',
    "color balance": '<svg viewBox="0 0 24 24" stroke-width="1.5"><path d="M12 4v16M5 20h14M4 9l3-5 3 5a3 3 0 0 1-6 0zM14 9l3-5 3 5a3 3 0 0 1-6 0z"/></svg>',
    "black & white": '<svg viewBox="0 0 24 24" stroke-width="1.5"><rect x="3" y="5" width="18" height="14"/><path d="M12 5v14" /><path d="M3 5h9v14H3z" fill="currentColor"/></svg>',
    "photo filter": '<svg viewBox="0 0 24 24" stroke-width="1.5"><rect x="3" y="7" width="18" height="12" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8 7l2-3h4l2 3"/></svg>',
    "channel mixer": '<svg viewBox="0 0 24 24" stroke-width="1.5"><circle cx="9" cy="10" r="5"/><circle cx="15" cy="10" r="5"/><circle cx="12" cy="15" r="5"/></svg>',
    "color lookup": '<svg viewBox="0 0 24 24" stroke-width="1.5"><path d="M3 4h18v16H3zM3 10h18M3 15h18M9 4v16M15 4v16"/></svg>',
    "invert": '<svg viewBox="0 0 24 24" stroke-width="1.5"><rect x="3" y="3" width="18" height="18"/><path d="M3 21 21 3v18z" fill="currentColor"/></svg>',
    "posterize": '<svg viewBox="0 0 24 24" stroke-width="1.5"><path d="M3 20h4v-5h5v-5h5V5h4"/></svg>',
    "threshold": '<svg viewBox="0 0 24 24" stroke-width="1.5"><rect x="3" y="3" width="18" height="18"/><path d="M3 14c4-4 6 2 9-2s5 1 9-3v14H3z" fill="currentColor"/></svg>',
    "gradient map": '<svg viewBox="0 0 24 24" stroke-width="1.5"><rect x="3" y="7" width="18" height="10"/><path d="M7 7v10M11 7v10M15 7v10" /></svg>',
    "selective color": '<svg viewBox="0 0 24 24" stroke-width="1.5"><rect x="3" y="3" width="8" height="8"/><rect x="13" y="3" width="8" height="8" fill="currentColor"/><rect x="3" y="13" width="8" height="8" fill="currentColor"/><rect x="13" y="13" width="8" height="8"/></svg>'
};

PS.renderAdjustmentsPanel = function () {
    var body = PS.el("panel-adjustments-body");
    if (!body) { return; }
    if (body._built) { return; }
    body.innerHTML = "";
    var t = document.createElement("div");
    t.className = "adjp-title";
    t.textContent = "Add an adjustment";
    body.appendChild(t);
    var grid = document.createElement("div");
    grid.className = "adjp-grid";
    PS.ADJUSTMENTS.forEach(function (a) {
        if (!a) { return; }
        var b = document.createElement("button");
        b.className = "adjp-btn";
        b.innerHTML = PS.ADJ_PANEL_ICONS[a[0]] || "";
        b.title = a[1];
        b.addEventListener("click", function () {
            if (!PS.doc) { PS.toast("Open or create a document first", true); return; }
            PS.newAdjustmentLayer(a[0]);
        });
        grid.appendChild(b);
    });
    body.appendChild(grid);
    body._built = true;
};

/* ============================================================
   STYLES PANEL (layer style presets)
   ============================================================ */

PS.STYLE_PRESETS = function () {
    var D = PS.EFFECT_DEFAULTS;
    function px(v) { return { value: v, units: "Pixels" }; }
    function with_(base, extra) { return Object.assign(base, extra); }
    return [
        { name: "Default Style (None)", fx: null },
        { name: "Drop Shadow", fx: { dropShadow: [with_(D.dropShadow(), { size: px(8), distance: px(6) })] } },
        { name: "Soft Glow", fx: { outerGlow: with_(D.outerGlow(), { size: px(14), color: { r: 255, g: 240, b: 160 }, opacity: 0.9 }) } },
        { name: "Neon", fx: { outerGlow: with_(D.outerGlow(), { size: px(10), color: { r: 0, g: 230, b: 255 }, opacity: 1, choke: px(10) }), stroke: [with_(D.stroke(), { size: px(2), color: { r: 180, g: 255, b: 255 }, position: "center" })] } },
        { name: "Bevel", fx: { bevel: with_(D.bevel(), { size: px(6) }), dropShadow: [with_(D.dropShadow(), { size: px(4), distance: px(3), opacity: 0.5 })] } },
        { name: "Pillow Emboss", fx: { bevel: with_(D.bevel(), { style: "pillow emboss", size: px(6) }) } },
        { name: "Stroke Black", fx: { stroke: [with_(D.stroke(), { size: px(3) })] } },
        { name: "Stroke White", fx: { stroke: [with_(D.stroke(), { size: px(4), color: { r: 255, g: 255, b: 255 } })], dropShadow: [with_(D.dropShadow(), { size: px(5), distance: px(3), opacity: 0.6 })] } },
        { name: "Inner Shadow", fx: { innerShadow: [with_(D.innerShadow(), { size: px(8), distance: px(4) })] } },
        { name: "Gold", fx: {
            gradientOverlay: [with_(D.gradientOverlay(), { gradient: PS.stopsToPsdGradient([{ pos: 0, color: "#8a5a10" }, { pos: 0.45, color: "#f7d774" }, { pos: 0.55, color: "#c99a2e" }, { pos: 1, color: "#fff2b0" }], "Gold"), angle: 90 })],
            bevel: with_(D.bevel(), { size: px(4), strength: 2 }),
            dropShadow: [with_(D.dropShadow(), { size: px(5), distance: px(3), opacity: 0.6 })]
        } },
        { name: "Chrome", fx: {
            gradientOverlay: [with_(D.gradientOverlay(), { gradient: PS.stopsToPsdGradient([{ pos: 0, color: "#f2f2f2" }, { pos: 0.48, color: "#7a7a7a" }, { pos: 0.52, color: "#3a3a3a" }, { pos: 1, color: "#e0e0e0" }], "Chrome"), angle: 90 })],
            bevel: with_(D.bevel(), { size: px(5), strength: 1.5, technique: "chisel hard" })
        } },
        { name: "Color Overlay Red", fx: { solidFill: [with_(D.solidFill(), { color: { r: 220, g: 40, b: 40 } })] } },
        { name: "Satin", fx: { satin: D.satin(), dropShadow: [with_(D.dropShadow(), { size: px(4), distance: px(2), opacity: 0.4 })] } },
        { name: "Long Shadow", fx: { dropShadow: [with_(D.dropShadow(), { size: px(2), distance: px(14), choke: px(80), opacity: 0.45 })] } }
    ];
};

// A small preview of a style on a rounded square, rendered by the compositor
PS.renderStylePreview = function (fx, size) {
    size = size || 44;
    var saved = PS.doc;
    var c = PS.createCanvas(size, size);
    try {
        var d = PS.makeDocument(size, size, {});
        var bg = PS.makeLayer("bg", size, size);
        var bctx = bg.canvas.getContext("2d");
        bctx.fillStyle = "#ffffff";
        bctx.fillRect(0, 0, size, size);
        var l = PS.makeLayer("shape", size, size);
        var ctx = l.canvas.getContext("2d");
        ctx.fillStyle = "#9a9a9a";
        var m = Math.round(size * 0.22), r = size * 0.18;
        ctx.beginPath();
        if (ctx.roundRect) { ctx.roundRect(m, m, size - 2 * m, size - 2 * m, r); } else { ctx.rect(m, m, size - 2 * m, size - 2 * m); }
        ctx.fill();
        l.effects = fx ? Object.assign({ disabled: false, scale: 1 }, PS.deepCopy(fx)) : null;
        d.root.children = [bg, l];
        PS.doc = d;
        var out = PS.renderer.compositeCanvas();
        c.getContext("2d").drawImage(out, 0, 0);
    } catch (e) {
        console.error(e);
    }
    PS.doc = saved;
    return c;
};

PS.applyStylePreset = function (p) {
    if (!PS.doc) { return; }
    var targets = PS.selectedLayers().filter(function (l) { return l.kind !== "adjustment"; });
    if (!targets.length) { return; }
    var befores = targets.map(function (l) { return l.effects; });
    var afters = targets.map(function () { return p.fx ? Object.assign({ disabled: false, scale: 1 }, PS.deepCopy(p.fx)) : null; });
    targets.forEach(function (l, i) { l.effects = afters[i]; });
    PS.pushHistory("Apply Style",
        function () { targets.forEach(function (l, i) { l.effects = befores[i]; }); },
        function () { targets.forEach(function (l, i) { l.effects = PS.deepCopy(afters[i]); }); });
    PS.requestRender();
    PS.renderLayersPanel();
};

PS.renderStylesPanel = function () {
    var body = PS.el("panel-styles-body");
    if (!body) { return; }
    if (body._built) { return; }
    body.innerHTML = "";
    var grid = document.createElement("div");
    grid.className = "styles-grid";
    PS.STYLE_PRESETS().forEach(function (p) {
        var b = document.createElement("button");
        b.className = "style-swatch";
        b.title = p.name + " - click to apply to the selected layers";
        var prev = PS.renderStylePreview(p.fx, 40);
        b.appendChild(prev);
        if (!p.fx) {
            var x = document.createElement("i");
            x.className = "style-none";
            b.appendChild(x);
        }
        b.addEventListener("click", function () { PS.applyStylePreset(p); });
        grid.appendChild(b);
    });
    body.appendChild(grid);
    body._built = true;
};

/* ============================================================
   CHANNELS PANEL
   ============================================================ */

PS.viewChannel = null;   // null = RGB, or "r" | "g" | "b"

PS.renderChannelsPanel = function () {
    var body = PS.el("panel-channels-body");
    if (!body) { return; }
    body.innerHTML = "";
    if (!PS.doc) { return; }
    var thumbSrc = PS.el("doc-canvas");
    var rows = [["rgb", "RGB", "Ctrl+2"], ["r", "Red", "Ctrl+3"], ["g", "Green", "Ctrl+4"], ["b", "Blue", "Ctrl+5"]];
    rows.forEach(function (r) {
        var row = document.createElement("div");
        var on = (r[0] === "rgb") ? !PS.viewChannel : PS.viewChannel === r[0];
        row.className = "chan-row" + (on ? " active" : "");
        var eye = document.createElement("div");
        eye.className = "layer-eye";
        eye.innerHTML = (r[0] === "rgb" ? !PS.viewChannel : (!PS.viewChannel || PS.viewChannel === r[0])) ? PS.ICONS.eye : "";
        row.appendChild(eye);
        var th = document.createElement("canvas");
        th.className = "chan-thumb";
        th.width = 36; th.height = 28;
        try {
            var tctx = th.getContext("2d");
            var sc = Math.min(36 / PS.doc.width, 28 / PS.doc.height);
            var w = PS.doc.width * sc, h = PS.doc.height * sc;
            tctx.drawImage(thumbSrc, (36 - w) / 2, (28 - h) / 2, w, h);
            if (r[0] !== "rgb") {
                var img = tctx.getImageData(0, 0, 36, 28);
                var k = { r: 0, g: 1, b: 2 }[r[0]];
                for (var i = 0; i < img.data.length; i += 4) {
                    var v = img.data[i + k];
                    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
                }
                tctx.putImageData(img, 0, 0);
            }
        } catch (e) { /* canvas not ready */ }
        row.appendChild(th);
        var n = document.createElement("span");
        n.className = "chan-name";
        n.textContent = r[1];
        row.appendChild(n);
        var sc2 = document.createElement("span");
        sc2.className = "chan-key";
        sc2.textContent = r[2];
        row.appendChild(sc2);
        row.addEventListener("click", function () { PS.setViewChannel(r[0] === "rgb" ? null : r[0]); });
        body.appendChild(row);
    });
    var a = PS.activeLayer();
    if (a && a.mask) {
        var mrow = document.createElement("div");
        mrow.className = "chan-row" + (PS.viewMaskOf === a ? " active" : "");
        mrow.innerHTML = '<div class="layer-eye">' + (PS.viewMaskOf === a ? PS.ICONS.eye : "") + '</div>';
        var mt = document.createElement("canvas");
        mt.className = "chan-thumb";
        mt.width = 36; mt.height = 28;
        PS._drawThumb(mt, a.mask.canvas, "#fff");
        mrow.appendChild(mt);
        var mn = document.createElement("span");
        mn.className = "chan-name";
        mn.style.fontStyle = "italic";
        mn.textContent = a.name + " Mask";
        mrow.appendChild(mn);
        mrow.addEventListener("click", function () { PS.toggleMaskView(a); PS.renderChannelsPanel(); });
        body.appendChild(mrow);
    }
    if (PS.quickMask) {
        var q = document.createElement("div");
        q.className = "chan-row active";
        q.innerHTML = '<div class="layer-eye">' + PS.ICONS.eye + '</div><span class="chan-name" style="font-style:italic">Quick Mask</span>';
        body.appendChild(q);
    }
};

PS.setViewChannel = function (c) {
    PS.viewChannel = c;
    PS.requestRender();
    setTimeout(PS.renderChannelsPanel, 60);
};

/* ============================================================
   NAVIGATOR
   ============================================================ */

PS.renderNavigatorPanel = function () {
    var body = PS.el("panel-navigator-body");
    if (!body) { return; }
    if (!body._built) {
        body.innerHTML = "";
        var wrap = document.createElement("div");
        wrap.className = "nav-wrap";
        var cv = document.createElement("canvas");
        cv.className = "nav-canvas";
        wrap.appendChild(cv);
        var box = document.createElement("div");
        box.className = "nav-box";
        wrap.appendChild(box);
        body.appendChild(wrap);
        var zr = document.createElement("div");
        zr.className = "nav-zoom";
        var zn = document.createElement("input");
        zn.className = "nav-zoom-num";
        var zs = document.createElement("input");
        zs.type = "range";
        zs.min = 0; zs.max = 1000;
        zr.appendChild(zn);
        zr.appendChild(zs);
        body.appendChild(zr);
        // zoom slider is logarithmic between 5 % and 3200 %
        zs.addEventListener("input", function () {
            if (!PS.doc) { return; }
            var z = Math.exp(Math.log(0.05) + (Math.log(32) - Math.log(0.05)) * zs.value / 1000);
            PS.setZoom(z, PS.viewportCenterDocPt());
        });
        zn.addEventListener("change", function () {
            var v = parseFloat(zn.value);
            if (PS.doc && v > 0) { PS.setZoom(v / 100, PS.viewportCenterDocPt()); }
        });
        function pan(ev) {
            if (!PS.doc) { return; }
            var r = cv.getBoundingClientRect();
            var x = (ev.clientX - r.left) / r.width * PS.doc.width;
            var y = (ev.clientY - r.top) / r.height * PS.doc.height;
            PS.centerViewOn(x, y);
        }
        wrap.addEventListener("pointerdown", function (e) {
            wrap.setPointerCapture(e.pointerId);
            pan(e);
            function move(ev) { pan(ev); }
            function up() { wrap.removeEventListener("pointermove", move); wrap.removeEventListener("pointerup", up); }
            wrap.addEventListener("pointermove", move);
            wrap.addEventListener("pointerup", up);
        });
        body._ui = { cv: cv, box: box, zn: zn, zs: zs, wrap: wrap };
        body._built = true;
    }
    var u = body._ui;
    if (!PS.doc) { u.cv.width = 1; return; }
    var bw = Math.max(60, body.clientWidth - 16), bh = Math.max(60, body.clientHeight - 44);
    var sc = Math.min(bw / PS.doc.width, bh / PS.doc.height);
    var w = Math.max(1, Math.round(PS.doc.width * sc)), h = Math.max(1, Math.round(PS.doc.height * sc));
    if (u.cv.width !== w || u.cv.height !== h) { u.cv.width = w; u.cv.height = h; }
    try { u.cv.getContext("2d").drawImage(PS.el("doc-canvas"), 0, 0, w, h); } catch (e) { /* not ready */ }
    u.cv.style.width = w + "px";
    u.cv.style.height = h + "px";
    u.wrap.style.width = w + "px";
    u.wrap.style.height = h + "px";
    var v = PS.visibleDocRect();
    u.box.style.left = PS.clamp(v.x * sc, 0, w) + "px";
    u.box.style.top = PS.clamp(v.y * sc, 0, h) + "px";
    u.box.style.width = Math.min(w, v.w * sc) + "px";
    u.box.style.height = Math.min(h, v.h * sc) + "px";
    if (document.activeElement !== u.zn) { u.zn.value = (Math.round(PS.zoom * 1000) / 10) + "%"; }
    u.zs.value = Math.round((Math.log(PS.zoom) - Math.log(0.05)) / (Math.log(32) - Math.log(0.05)) * 1000);
};

// Document rectangle currently visible in the workspace
PS.visibleDocRect = function () {
    var ws = PS.el("workspace");
    var wr = ws.getBoundingClientRect();
    var a = PS.eventToDoc({ clientX: wr.left, clientY: wr.top });
    var b = PS.eventToDoc({ clientX: wr.left + ws.clientWidth, clientY: wr.top + ws.clientHeight });
    return { x: Math.max(0, a.x), y: Math.max(0, a.y), w: Math.min(PS.doc.width, b.x) - Math.max(0, a.x), h: Math.min(PS.doc.height, b.y) - Math.max(0, a.y) };
};

PS.centerViewOn = function (x, y) {
    var ws = PS.el("workspace");
    var c = PS.viewportCenterDocPt();
    ws.scrollLeft += (x - c.x) * PS.zoom;
    ws.scrollTop += (y - c.y) * PS.zoom;
    PS.refreshViewPanels();
};

/* ============================================================
   INFO
   ============================================================ */

PS._infoSample = null;

PS.renderInfoPanel = function () {
    var body = PS.el("panel-info-body");
    if (!body) { return; }
    if (!body._built) {
        body.innerHTML =
            '<div class="info-grid">' +
            '<div><b>R:</b> <span data-k="r"></span><br><b>G:</b> <span data-k="g"></span><br><b>B:</b> <span data-k="b"></span></div>' +
            '<div><b>C:</b> <span data-k="c"></span><br><b>M:</b> <span data-k="m"></span><br><b>Y:</b> <span data-k="y"></span><br><b>K:</b> <span data-k="k"></span></div>' +
            '<div><b>X:</b> <span data-k="x"></span><br><b>Y:</b> <span data-k="yy"></span></div>' +
            '<div><b>W:</b> <span data-k="w"></span><br><b>H:</b> <span data-k="h"></span></div>' +
            '</div><div class="info-doc" data-k="doc"></div><div class="info-tip" data-k="tip"></div>';
        body._built = true;
    }
    function set(k, v) { var e = body.querySelector('[data-k="' + k + '"]'); if (e) { e.textContent = v; } }
    var s = PS._infoSample;
    if (s) {
        set("r", s[0]); set("g", s[1]); set("b", s[2]);
        var cm = PS.rgbToCmyk(s[0], s[1], s[2]);
        set("c", cm.c + "%"); set("m", cm.m + "%"); set("y", cm.y + "%"); set("k", cm.k + "%");
    } else {
        ["r", "g", "b", "c", "m", "y", "k"].forEach(function (k) { set(k, ""); });
    }
    var p = PS.cursorPos;
    set("x", p ? Math.floor(p.x) : "");
    set("yy", p ? Math.floor(p.y) : "");
    var sel = PS.doc && PS.doc.selection;
    var rm = PS.tool === "ruler" && PS.rulerMeasure ? PS.rulerMeasure() : null;
    if (rm) {
        // the Ruler tool's measurement
        set("w", Math.round(rm.w * 10) / 10);
        set("h", Math.round(rm.h * 10) / 10);
    } else {
        set("w", sel ? sel.bounds.w : "");
        set("h", sel ? sel.bounds.h : "");
    }
    set("doc", PS.doc ? ("Doc: " + PS.doc.width + " x " + PS.doc.height + " px, " + Math.round(PS.docResolution ? PS.docResolution() : 72) + " ppi") : "");
    set("tip", PS.tools[PS.tool] ? PS.tools[PS.tool].name + " tool" : "");
};

// Colour of the composite under the pointer (a 1 x 1 GPU read, throttled)
PS.sampleInfo = (function () {
    var last = 0, pending = false;
    return function () {
        if (!PS.ws.isVisible("info") || !PS.doc || !PS.cursorPos) { return; }
        var now = Date.now();
        if (now - last < 80) {
            if (!pending) { pending = true; setTimeout(function () { pending = false; PS.sampleInfo(); }, 90); }
            return;
        }
        last = now;
        var x = Math.floor(PS.cursorPos.x), y = Math.floor(PS.cursorPos.y);
        if (x < 0 || y < 0 || x >= PS.doc.width || y >= PS.doc.height) { PS._infoSample = null; PS.renderInfoPanel(); return; }
        var gl = PS.gpu.gl;
        if (gl) {
            var px = new Uint8Array(4);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.readPixels(x, PS.doc.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            PS._infoSample = [px[0], px[1], px[2], px[3]];
        }
        PS.renderInfoPanel();
    };
})();

/* ============================================================
   HISTOGRAM
   ============================================================ */

PS.histChannel = "rgb";

PS.renderHistogramPanel = function () {
    var body = PS.el("panel-histogram-body");
    if (!body) { return; }
    if (!body._built) {
        body.innerHTML = "";
        var sel = PS.selectInput([{ v: "rgb", l: "RGB" }, { v: "lum", l: "Luminosity" }, { v: "r", l: "Red" }, { v: "g", l: "Green" }, { v: "b", l: "Blue" }, { v: "colors", l: "Colors" }], PS.histChannel);
        sel.className = "hist-select";
        sel.addEventListener("change", function () { PS.histChannel = sel.value; PS.renderHistogramPanel(); });
        body.appendChild(sel);
        var cv = document.createElement("canvas");
        cv.className = "hist-canvas";
        cv.width = 256; cv.height = 100;
        body.appendChild(cv);
        var st = document.createElement("div");
        st.className = "hist-stats";
        body.appendChild(st);
        body._ui = { cv: cv, st: st };
        body._built = true;
    }
    var u = body._ui;
    var ctx = u.cv.getContext("2d");
    ctx.fillStyle = "#e6e6e6";
    ctx.fillRect(0, 0, 256, 100);
    if (!PS.doc) { return; }
    var src = PS.el("doc-canvas");
    var sc = Math.min(1, 300 / Math.max(PS.doc.width, PS.doc.height));
    var w = Math.max(1, Math.round(PS.doc.width * sc)), h = Math.max(1, Math.round(PS.doc.height * sc));
    var tmp = PS._histTmp || (PS._histTmp = PS.createCanvas(w, h));
    tmp.width = w; tmp.height = h;
    var tctx = tmp.getContext("2d", { willReadFrequently: true });
    tctx.clearRect(0, 0, w, h);
    try { tctx.drawImage(src, 0, 0, w, h); } catch (e) { return; }
    var d = tctx.getImageData(0, 0, w, h).data;
    var hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256), hl = new Uint32Array(256);
    var n = 0, sum = 0;
    for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) { continue; }
        hr[d[i]]++; hg[d[i + 1]]++; hb[d[i + 2]]++;
        var l = Math.round(0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]);
        hl[l]++; n++; sum += l;
    }
    function draw(arr, color, max) {
        ctx.fillStyle = color;
        for (var x = 0; x < 256; x++) {
            var v = arr[x] / max * 98;
            ctx.fillRect(x, 100 - v, 1, v);
        }
    }
    function maxOf(a) { var m = 1; for (var x = 0; x < 256; x++) { if (a[x] > m) { m = a[x]; } } return m; }
    var c = PS.histChannel;
    if (c === "colors") {
        var m = Math.max(maxOf(hr), maxOf(hg), maxOf(hb));
        ctx.globalCompositeOperation = "multiply";
        draw(hr, "rgba(255,0,0,0.9)", m); draw(hg, "rgba(0,200,0,0.9)", m); draw(hb, "rgba(0,0,255,0.9)", m);
        ctx.globalCompositeOperation = "source-over";
    } else {
        var arr = c === "r" ? hr : (c === "g" ? hg : (c === "b" ? hb : hl));
        draw(arr, c === "r" ? "#c00" : (c === "g" ? "#090" : (c === "b" ? "#00c" : "#222")), maxOf(arr));
    }
    var mean = n ? sum / n : 0;
    u.st.textContent = "Mean: " + mean.toFixed(1) + "    Pixels: " + (n ? Math.round(n / (sc * sc)) : 0);
};

/* ============================================================
   panel registration + refresh hooks
   ============================================================ */

PS.registerPanels = function () {
    var W = PS.ws;
    var I = PS.PANEL_ICONS;
    W.register("color", { title: "Color", icon: I.color, render: PS.renderColorSliders, shortcut: "F6" });
    W.register("swatches", { title: "Swatches", icon: I.swatches, render: PS.renderSwatchesPanel });
    W.register("adjustments", { title: "Adjustments", icon: I.adjustments, render: PS.renderAdjustmentsPanel });
    W.register("styles", { title: "Styles", icon: I.styles, render: PS.renderStylesPanel });
    W.register("layers", { title: "Layers", icon: I.layers, render: function () { PS.renderLayersPanel(); }, shortcut: "F7" });
    W.register("channels", { title: "Channels", icon: I.channels, render: PS.renderChannelsPanel });
    W.register("history", { title: "History", icon: I.history, render: function () { PS.renderHistoryPanel(); } });
    W.register("properties", { title: "Properties", icon: I.properties, render: function () { if (PS.renderPropertiesPanel) { PS.renderPropertiesPanel(); } } });
    W.register("character", { title: "Character", icon: I.character, render: function () { if (PS.renderCharacterPanel) { PS.renderCharacterPanel(); } } });
    W.register("paragraph", { title: "Paragraph", icon: I.paragraph, render: function () { if (PS.renderParagraphPanel) { PS.renderParagraphPanel(); } } });
    W.register("navigator", { title: "Navigator", icon: I.navigator, render: PS.renderNavigatorPanel });
    W.register("info", { title: "Info", icon: I.info, render: PS.renderInfoPanel, shortcut: "F8" });
    W.register("histogram", { title: "Histogram", icon: I.histogram, render: PS.renderHistogramPanel });
    if (PS.registerBrushPanels) { PS.registerBrushPanels(); }
    if (PS.registerNotesPanel) { PS.registerNotesPanel(); }
};

// Panels that follow the image or the view, refreshed after renders (throttled)
PS.refreshViewPanels = (function () {
    var timer = null;
    return function () {
        if (timer) { return; }
        timer = setTimeout(function () {
            timer = null;
            if (PS.ws.isVisible("navigator")) { PS.renderNavigatorPanel(); }
            if (PS.ws.isVisible("histogram")) { PS.renderHistogramPanel(); }
            if (PS.ws.isVisible("channels")) { PS.renderChannelsPanel(); }
        }, 250);
    };
})();
