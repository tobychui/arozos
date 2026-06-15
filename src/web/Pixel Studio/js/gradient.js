/*
    Pixel Studio - Gradient tool
    Drag a line on the active layer to fill it with a gradient. Supports a
    single color fading to transparent, two-color transitions, and multi-stop
    custom gradients. Styles: linear, radial, reflected. Foreground/background
    presets resolve live; custom gradients keep their own stops. Respects the
    active selection mask and the tool opacity.
*/
"use strict";

/* ---------- presets ---------- */

PS.gradientPresets = [
    { id: "fg-bg", label: "Foreground to Background", dyn: true },
    { id: "fg-transparent", label: "Foreground to Transparent", dyn: true },
    { id: "fg-white", label: "Foreground to White", dyn: true },
    { id: "fg-black", label: "Foreground to Black", dyn: true },
    { id: "black-white", label: "Black, White", stops: [{ pos: 0, color: "#000000" }, { pos: 1, color: "#ffffff" }] },
    { id: "white-transparent", label: "White to Transparent", stops: [{ pos: 0, color: "#ffffff" }, { pos: 1, color: "#ffffff00" }] },
    { id: "black-transparent", label: "Black to Transparent", stops: [{ pos: 0, color: "#000000" }, { pos: 1, color: "#00000000" }] },
    { id: "sunrise", label: "Red, Yellow", stops: [{ pos: 0, color: "#ff3b30" }, { pos: 1, color: "#ffe000" }] },
    { id: "ocean", label: "Blue, Cyan", stops: [{ pos: 0, color: "#1d4ed8" }, { pos: 1, color: "#22d3ee" }] },
    { id: "violet-orange", label: "Violet, Orange", stops: [{ pos: 0, color: "#7c3aed" }, { pos: 1, color: "#fb923c" }] },
    {
        id: "spectrum", label: "Spectrum", stops: [
            { pos: 0.00, color: "#ff0000" }, { pos: 0.17, color: "#ff9900" },
            { pos: 0.34, color: "#ffff00" }, { pos: 0.50, color: "#33cc33" },
            { pos: 0.67, color: "#00ccff" }, { pos: 0.84, color: "#3333ff" },
            { pos: 1.00, color: "#cc33ff" }
        ]
    },
    {
        id: "rainbow-transparent", label: "Transparent Rainbow", stops: [
            { pos: 0, color: "#ff000000" }, { pos: 0.25, color: "#ffff00ff" },
            { pos: 0.5, color: "#00ff00ff" }, { pos: 0.75, color: "#00ffffff" },
            { pos: 1, color: "#0000ffff" }
        ]
    }
];

PS.gradientPresetById = function (id) {
    for (var i = 0; i < PS.gradientPresets.length; i++) {
        if (PS.gradientPresets[i].id === id) { return PS.gradientPresets[i]; }
    }
    return null;
};

// transparent / opaque variants of a hex color
function withAlpha(hex, a) {
    var c = PS.hexToRgb(hex) || { r: 0, g: 0, b: 0 };
    return PS.rgbToHex(c.r, c.g, c.b, a);
}

// resolve a dynamic (FG/BG) preset against the current colors
function dynStops(id) {
    switch (id) {
        case "fg-bg": return [{ pos: 0, color: PS.fg }, { pos: 1, color: PS.bg }];
        case "fg-transparent": return [{ pos: 0, color: withAlpha(PS.fg, 255) }, { pos: 1, color: withAlpha(PS.fg, 0) }];
        case "fg-white": return [{ pos: 0, color: PS.fg }, { pos: 1, color: "#ffffff" }];
        case "fg-black": return [{ pos: 0, color: PS.fg }, { pos: 1, color: "#000000" }];
    }
    return [{ pos: 0, color: "#000000" }, { pos: 1, color: "#ffffff" }];
}

function presetStops(p) {
    if (p.dyn) { return dynStops(p.id); }
    return p.stops.map(function (s) { return { pos: s.pos, color: s.color }; });
}

// the stops the tool will actually paint with
PS.activeGradientStops = function () {
    var g = PS.toolOpts.gradient;
    var p = PS.gradientPresetById(g.preset);
    if (p && p.dyn) { return dynStops(p.id); }
    if (g.stops && g.stops.length >= 2) { return g.stops; }
    if (p && p.stops) { return presetStops(p); }
    return [{ pos: 0, color: "#000000" }, { pos: 1, color: "#ffffff" }];
};

/* ---------- gradient construction + painting ---------- */

PS.buildCanvasGradient = function (ctx, s, e, style, stops) {
    var grad, i;
    if (style === "radial") {
        var r = Math.hypot(e.x - s.x, e.y - s.y) || 1;
        grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
        for (i = 0; i < stops.length; i++) { grad.addColorStop(PS.clamp(stops[i].pos, 0, 1), stops[i].color); }
    } else if (style === "reflected") {
        grad = ctx.createLinearGradient(2 * s.x - e.x, 2 * s.y - e.y, e.x, e.y);
        for (i = 0; i < stops.length; i++) {
            var p = PS.clamp(stops[i].pos, 0, 1);
            grad.addColorStop(PS.clamp(0.5 + 0.5 * p, 0, 1), stops[i].color);
            grad.addColorStop(PS.clamp(0.5 - 0.5 * p, 0, 1), stops[i].color);
        }
    } else {
        grad = ctx.createLinearGradient(s.x, s.y, e.x, e.y);
        for (i = 0; i < stops.length; i++) { grad.addColorStop(PS.clamp(stops[i].pos, 0, 1), stops[i].color); }
    }
    return grad;
};

PS.applyGradient = function (start, end) {
    var layer = PS.requirePaintableLayer();
    if (!layer) { return; }
    var g = PS.toolOpts.gradient;
    var stops = PS.activeGradientStops();
    if (g.reverse) {
        stops = stops.map(function (s) { return { pos: 1 - s.pos, color: s.color }; });
    }
    var before = PS.snapshotLayer(layer);
    PS.maskedDraw(layer, function (ctx) {
        var grad = PS.buildCanvasGradient(ctx, start, end, g.style, stops);
        ctx.save();
        ctx.globalAlpha = (g.opacity === undefined ? 1 : g.opacity);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, PS.doc.width, PS.doc.height);
        ctx.restore();
    });
    PS.commitLayerCanvas("Gradient", layer, before);
    PS.requestRender();
};

/* ---------- stop interpolation + preview rendering (shared) ---------- */

PS.gradientColorAt = function (stops, pos) {
    var sorted = stops.slice().sort(function (a, b) { return a.pos - b.pos; });
    if (pos <= sorted[0].pos) { return sorted[0].color; }
    var last = sorted[sorted.length - 1];
    if (pos >= last.pos) { return last.color; }
    for (var i = 0; i < sorted.length - 1; i++) {
        var a = sorted[i], b = sorted[i + 1];
        if (pos >= a.pos && pos <= b.pos) {
            var t = (pos - a.pos) / ((b.pos - a.pos) || 1);
            var ca = PS.hexToRgb(a.color), cb = PS.hexToRgb(b.color);
            return PS.rgbToHex(ca.r + (cb.r - ca.r) * t, ca.g + (cb.g - ca.g) * t,
                ca.b + (cb.b - ca.b) * t, ca.a + (cb.a - ca.a) * t);
        }
    }
    return sorted[0].color;
};

PS.renderGradientBar = function (canvas, stops) {
    var ctx = canvas.getContext("2d");
    var w = canvas.width, h = canvas.height, cs = 6, x, y;
    for (y = 0; y < h; y += cs) {
        for (x = 0; x < w; x += cs) {
            ctx.fillStyle = ((Math.floor(x / cs) + Math.floor(y / cs)) % 2 === 0) ? "#bbb" : "#777";
            ctx.fillRect(x, y, cs, cs);
        }
    }
    var g = ctx.createLinearGradient(0, 0, w, 0);
    stops.slice().sort(function (a, b) { return a.pos - b.pos; }).forEach(function (s) {
        g.addColorStop(PS.clamp(s.pos, 0, 1), s.color);
    });
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
};

/* ---------- the tool ---------- */

(function () {
    var drag = null;

    function constrainEnd(s, e, on) {
        if (!on) { return e; }
        var dx = e.x - s.x, dy = e.y - s.y;
        var ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        var len = Math.hypot(dx, dy);
        return { x: s.x + len * Math.cos(ang), y: s.y + len * Math.sin(ang) };
    }

    PS.registerTool("gradient", {
        name: "Gradient",
        key: "g",
        cursor: "crosshair",
        icon: '<svg viewBox="0 0 24 24" stroke-width="1.6"><rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 19 20 5"/></svg>',
        options: function (host) {
            var o = PS.toolOpts.gradient;

            // live preview + open the editor
            var g = PS.ui.group(host);
            PS.ui.label(g, "Gradient");
            var prev = document.createElement("canvas");
            prev.width = 90; prev.height = 18;
            prev.className = "grad-opt-preview";
            prev.title = "Click to edit the gradient";
            PS.renderGradientBar(prev, PS.activeGradientStops());
            prev.addEventListener("click", function () { PS.openGradientEditor(); });
            g.appendChild(prev);

            PS.ui.select(host, "Style", [
                { v: "linear", l: "Linear" },
                { v: "radial", l: "Radial" },
                { v: "reflected", l: "Reflected" }
            ], o.style, function (v) { o.style = v; PS.savePrefsDebounced(); });

            PS.ui.slider(host, "Opacity", Math.round(o.opacity * 100), 1, 100, 1, function (v) {
                o.opacity = v / 100; PS.savePrefsDebounced();
            }, function (v) { return v + "%"; });

            PS.ui.checkbox(host, "Reverse", o.reverse, function (v) {
                o.reverse = v; PS.savePrefsDebounced();
            });

            PS.ui.label(host, "Drag on the canvas to apply. Shift constrains the angle.");
        },
        onDown: function (pt, e) {
            if (!PS.requirePaintableLayer()) { return; }
            drag = { start: pt, cur: pt, constrain: e.shiftKey };
        },
        onMove: function (pt, e) {
            if (!drag) { return; }
            drag.cur = pt;
            drag.constrain = e.shiftKey;
        },
        onUp: function () {
            if (!drag) { return; }
            var s = drag.start, e = constrainEnd(drag.start, drag.cur, drag.constrain);
            drag = null;
            if (Math.hypot(e.x - s.x, e.y - s.y) < 2) { return; }
            PS.applyGradient(s, e);
        },
        overlay: function (ctx) {
            if (!drag) { return; }
            var e = constrainEnd(drag.start, drag.cur, drag.constrain);
            PS.overlayDocSpace(ctx, function (px) {
                ctx.lineWidth = 1.5 * px;
                ctx.strokeStyle = "rgba(255,255,255,0.95)";
                ctx.beginPath();
                ctx.moveTo(drag.start.x, drag.start.y);
                ctx.lineTo(e.x, e.y);
                ctx.stroke();
                ctx.strokeStyle = "rgba(0,0,0,0.9)";
                ctx.setLineDash([4 * px, 3 * px]);
                ctx.stroke();
                ctx.setLineDash([]);
                // endpoint dots
                [drag.start, e].forEach(function (p) {
                    ctx.fillStyle = "#fff"; ctx.strokeStyle = "#000"; ctx.lineWidth = px;
                    ctx.beginPath(); ctx.arc(p.x, p.y, 3 * px, 0, Math.PI * 2);
                    ctx.fill(); ctx.stroke();
                });
            });
        }
    });
}());

/* ---------- windowed gradient editor ---------- */

PS.openGradientEditor = function () {
    var g = PS.toolOpts.gradient;
    // working copy of the current stops (sorted)
    var stops = PS.activeGradientStops().map(function (s) { return { pos: s.pos, color: s.color }; });
    var selected = 0;
    var bar, track, ctrls, presetHost;

    function sortStops() {
        stops.sort(function (a, b) { return a.pos - b.pos; });
    }

    function markCustom() {
        g.preset = "custom";
        g.stops = stops.map(function (s) { return { pos: s.pos, color: s.color }; });
        PS.savePrefsDebounced();
        if (PS.tool === "gradient") { PS.renderOptionsBar(); }
    }

    function selectPreset(p) {
        stops = presetStops(p);
        sortStops();
        selected = 0;
        g.preset = p.id;
        g.stops = stops.map(function (s) { return { pos: s.pos, color: s.color }; });
        PS.savePrefsDebounced();
        if (PS.tool === "gradient") { PS.renderOptionsBar(); }
        refresh();
    }

    function refresh() {
        PS.renderGradientBar(bar, stops);
        renderTrack();
        renderCtrls();
        highlightPreset();
    }

    function renderTrack() {
        track.innerHTML = "";
        stops.forEach(function (s, i) {
            var m = document.createElement("div");
            m.className = "grad-stop" + (i === selected ? " selected" : "");
            m.style.left = (PS.clamp(s.pos, 0, 1) * 100) + "%";
            var sw = document.createElement("i");
            sw.style.background = s.color;
            m.appendChild(sw);
            track.appendChild(m);
        });
    }

    function renderCtrls() {
        ctrls.innerHTML = "";
        if (!stops.length) { return; }
        var s = stops[selected];

        var well = document.createElement("button");
        well.className = "grad-stop-well";
        well.style.background = s.color;
        well.title = "Edit stop color (alpha = transparency)";
        well.addEventListener("click", function () {
            PS.openColorPicker("grad-stop", {
                initial: s.color,
                title: "Stop Color",
                onChange: function (hex) {
                    s.color = hex;
                    well.style.background = hex;
                    PS.renderGradientBar(bar, stops);
                    renderTrack();
                    markCustom();
                }
            });
        });
        ctrls.appendChild(well);

        var posWrap = document.createElement("div");
        posWrap.className = "grad-pos";
        var lab = document.createElement("label");
        lab.textContent = "Pos %";
        var posInp = document.createElement("input");
        posInp.type = "number"; posInp.min = 0; posInp.max = 100;
        posInp.value = Math.round(s.pos * 100);
        posInp.addEventListener("input", function () {
            var v = PS.clamp(parseFloat(posInp.value) || 0, 0, 100) / 100;
            s.pos = v;
            PS.renderGradientBar(bar, stops);
            renderTrack();
            markCustom();
        });
        posWrap.appendChild(lab);
        posWrap.appendChild(posInp);
        ctrls.appendChild(posWrap);

        var del = document.createElement("button");
        del.className = "grad-del";
        del.textContent = "Delete";
        del.disabled = stops.length <= 2;
        del.addEventListener("click", function () {
            if (stops.length <= 2) { return; }
            stops.splice(selected, 1);
            selected = PS.clamp(selected, 0, stops.length - 1);
            markCustom();
            refresh();
        });
        ctrls.appendChild(del);
    }

    function highlightPreset() {
        if (!presetHost) { return; }
        Array.prototype.forEach.call(presetHost.children, function (t) {
            t.classList.toggle("active", t.dataset.id === g.preset);
        });
    }

    PS.floatingPanel({
        title: "Gradient Editor",
        x: Math.round(window.innerWidth / 2 - 170),
        y: 96,
        build: function (body) {
            body.classList.add("grad-editor");

            // presets
            var pl = document.createElement("div");
            pl.className = "swatch-label";
            pl.textContent = "Presets";
            body.appendChild(pl);

            presetHost = document.createElement("div");
            presetHost.className = "grad-presets";
            PS.gradientPresets.forEach(function (p) {
                var t = document.createElement("canvas");
                t.width = 52; t.height = 20;
                t.className = "grad-thumb";
                t.dataset.id = p.id;
                t.title = p.label;
                PS.renderGradientBar(t, presetStops(p));
                t.addEventListener("click", function () { selectPreset(p); });
                presetHost.appendChild(t);
            });
            body.appendChild(presetHost);

            // live bar + stop track
            var barWrap = document.createElement("div");
            barWrap.className = "grad-bar-wrap";
            bar = document.createElement("canvas");
            bar.width = 300; bar.height = 26;
            bar.className = "grad-bar";
            barWrap.appendChild(bar);
            track = document.createElement("div");
            track.className = "grad-track";
            barWrap.appendChild(track);
            body.appendChild(barWrap);

            ctrls = document.createElement("div");
            ctrls.className = "grad-stop-controls";
            body.appendChild(ctrls);

            var hint = document.createElement("div");
            hint.className = "swatch-hint";
            hint.textContent = "Click the bar to add a stop; drag stops to move; click a stop to edit.";
            body.appendChild(hint);

            bindTrack();
            refresh();
        },
        buttons: [{ label: "Done", primary: true }]
    });

    /* ----- track interaction (add / select / drag stops) ----- */
    function bindTrack() {
        var dragging = null;
        function posFromEvent(e) {
            var r = track.getBoundingClientRect();
            return PS.clamp((e.clientX - r.left) / r.width, 0, 1);
        }
        function hitStop(pos) {
            var best = -1, bd = 0.04;
            stops.forEach(function (s, i) {
                var d = Math.abs(s.pos - pos);
                if (d <= bd) { bd = d; best = i; }
            });
            return best;
        }
        function down(e) {
            var pos = posFromEvent(e);
            var hit = hitStop(pos);
            if (hit < 0) {
                stops.push({ pos: pos, color: PS.gradientColorAt(stops, pos) });
                sortStops();
                selected = -1;
                stops.forEach(function (s, i) { if (s.pos === pos) { selected = i; } });
                markCustom();
            } else {
                selected = hit;
            }
            dragging = selected;
            track.setPointerCapture(e.pointerId);
            refresh();
            e.preventDefault();
        }
        function move(e) {
            if (dragging === null || !(e.buttons & 1)) { return; }
            stops[selected].pos = posFromEvent(e);
            PS.renderGradientBar(bar, stops);
            renderTrack();
        }
        function up() {
            if (dragging === null) { return; }
            dragging = null;
            sortStops();
            // keep the same stop selected after sorting
            markCustom();
            refresh();
        }
        track.addEventListener("pointerdown", down);
        track.addEventListener("pointermove", move);
        track.addEventListener("pointerup", up);
        track.addEventListener("pointercancel", up);
        // clicking the bar itself adds a stop too
        bar.addEventListener("pointerdown", down);
    }
};
