/*
    Pixel Studio - windowed color picker
    A draggable, non-modal HSV color wheel with a value slider, an alpha
    slider, and numeric entry in RGBA, HSV or CMYK. Replaces the browser's
    native <input type="color"> for the foreground/background colors.
*/
"use strict";

/* ---------- color-model conversions ---------- */

PS.rgbToHsv = function (r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    var h = 0;
    if (d !== 0) {
        if (max === r) { h = ((g - b) / d) % 6; }
        else if (max === g) { h = (b - r) / d + 2; }
        else { h = (r - g) / d + 4; }
        h *= 60; if (h < 0) { h += 360; }
    }
    return { h: h, s: max === 0 ? 0 : d / max, v: max };
};

PS.hsvToRgb = function (h, s, v) {
    h = ((h % 360) + 360) % 360;
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    var r1, g1, b1;
    if (h < 60) { r1 = c; g1 = x; b1 = 0; }
    else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
    else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
    else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
    else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
    else { r1 = c; g1 = 0; b1 = x; }
    return {
        r: Math.round((r1 + m) * 255),
        g: Math.round((g1 + m) * 255),
        b: Math.round((b1 + m) * 255)
    };
};

PS.rgbToCmyk = function (r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var k = 1 - Math.max(r, g, b);
    if (k >= 1) { return { c: 0, m: 0, y: 0, k: 100 }; }
    return {
        c: Math.round((1 - r - k) / (1 - k) * 100),
        m: Math.round((1 - g - k) / (1 - k) * 100),
        y: Math.round((1 - b - k) / (1 - k) * 100),
        k: Math.round(k * 100)
    };
};

PS.cmykToRgb = function (c, m, y, k) {
    c /= 100; m /= 100; y /= 100; k /= 100;
    return {
        r: Math.round(255 * (1 - c) * (1 - k)),
        g: Math.round(255 * (1 - m) * (1 - k)),
        b: Math.round(255 * (1 - y) * (1 - k))
    };
};

/* ---------- the picker ---------- */

PS._colorPicker = null;

// target: "fg" | "bg" | (any other value = custom, then opts = {initial, title,
// onChange(hex), onClose}). Custom mode lets callers (e.g. the gradient editor)
// reuse the wheel to pick an arbitrary color with alpha.
PS.openColorPicker = function (target, opts) {
    opts = opts || {};
    var custom = (target !== "fg" && target !== "bg");
    if (PS._colorPicker) { PS._colorPicker.close(); }

    var startHex = custom ? (opts.initial || "#000000") : ((target === "fg") ? PS.fg : PS.bg);
    var rgb0 = PS.hexToRgb(startHex) || { r: 0, g: 0, b: 0, a: 255 };
    var hsv0 = PS.rgbToHsv(rgb0.r, rgb0.g, rgb0.b);
    var state = { h: hsv0.h, s: hsv0.s, v: hsv0.v, a: (rgb0.a === undefined ? 255 : rgb0.a) };
    var mode = "rgba";

    var wheel, wctx, valC, vctx, alphaC, actx, preview, hexField;
    var fields = {};
    var inputsHost;
    var wheelCacheV = null, wheelCacheImg = null;

    var panel = PS.floatingPanel({
        title: custom ? (opts.title || "Select Color") : ("Color Picker — " + (target === "fg" ? "Foreground" : "Background")),
        x: Math.round(window.innerWidth / 2 - 150),
        y: 90,
        build: function (body) {
            body.classList.add("cp-body");

            // --- wheel + value slider row ---
            var top = document.createElement("div");
            top.className = "cp-top";

            wheel = document.createElement("canvas");
            wheel.width = 168; wheel.height = 168;
            wheel.className = "cp-wheel";
            top.appendChild(wheel);

            valC = document.createElement("canvas");
            valC.width = 18; valC.height = 168;
            valC.className = "cp-val";
            top.appendChild(valC);
            body.appendChild(top);

            // --- alpha slider + preview ---
            var arow = document.createElement("div");
            arow.className = "cp-arow";
            alphaC = document.createElement("canvas");
            alphaC.width = 168; alphaC.height = 16;
            alphaC.className = "cp-alpha";
            arow.appendChild(alphaC);
            var prevWrap = document.createElement("div");
            prevWrap.className = "cp-preview";
            preview = document.createElement("i");
            prevWrap.appendChild(preview);
            arow.appendChild(prevWrap);
            body.appendChild(arow);

            // --- mode tabs ---
            var tabs = document.createElement("div");
            tabs.className = "cp-tabs";
            [["rgba", "RGBA"], ["hsv", "HSV"], ["cmyk", "CMYK"]].forEach(function (m) {
                var t = document.createElement("button");
                t.type = "button";
                t.textContent = m[1];
                t.dataset.mode = m[0];
                t.className = "cp-tab" + (m[0] === mode ? " active" : "");
                t.addEventListener("click", function () {
                    mode = m[0];
                    Array.prototype.forEach.call(tabs.children, function (c) {
                        c.classList.toggle("active", c.dataset.mode === mode);
                    });
                    buildInputs();
                    syncInputs();
                });
                tabs.appendChild(t);
            });
            body.appendChild(tabs);

            inputsHost = document.createElement("div");
            inputsHost.className = "cp-inputs";
            body.appendChild(inputsHost);

            // --- hex ---
            var hexRow = document.createElement("div");
            hexRow.className = "cp-hexrow";
            var hl = document.createElement("label");
            hl.textContent = "Hex";
            hexField = document.createElement("input");
            hexField.type = "text";
            hexField.className = "cp-hex";
            hexField.addEventListener("change", function () {
                var rgb = PS.hexToRgb(hexField.value);
                if (!rgb) { syncInputs(); return; }
                var hsv = PS.rgbToHsv(rgb.r, rgb.g, rgb.b);
                state.h = hsv.h; state.s = hsv.s; state.v = hsv.v;
                state.a = (rgb.a === undefined ? 255 : rgb.a);
                refresh();
            });
            hexRow.appendChild(hl);
            hexRow.appendChild(hexField);
            body.appendChild(hexRow);

            wctx = wheel.getContext("2d");
            vctx = valC.getContext("2d");
            actx = alphaC.getContext("2d");

            bindDrag(wheel, onWheel);
            bindDrag(valC, onVal);
            bindDrag(alphaC, onAlpha);

            buildInputs();
            refresh();
        },
        buttons: [{ label: "Done", primary: true }],
        onClose: function () {
            PS._colorPicker = null;
            if (custom) { if (opts.onClose) { opts.onClose(); } }
            else if (target === "fg") { PS.pushRecentColor(PS.fg); }
        }
    });
    PS._colorPicker = panel;

    /* ----- drawing ----- */

    function ensureWheel() {
        var size = wheel.width, cx = size / 2, cy = size / 2, R = size / 2 - 2;
        if (wheelCacheV !== state.v || !wheelCacheImg) {
            var img = wctx.createImageData(size, size);
            var data = img.data;
            for (var y = 0; y < size; y++) {
                for (var x = 0; x < size; x++) {
                    var dx = x - cx, dy = y - cy, dist = Math.sqrt(dx * dx + dy * dy);
                    var idx = (y * size + x) * 4;
                    if (dist <= R) {
                        var hue = Math.atan2(dy, dx) * 180 / Math.PI; if (hue < 0) { hue += 360; }
                        var rgb = PS.hsvToRgb(hue, dist / R, state.v);
                        data[idx] = rgb.r; data[idx + 1] = rgb.g; data[idx + 2] = rgb.b; data[idx + 3] = 255;
                    }
                }
            }
            wheelCacheImg = img; wheelCacheV = state.v;
        }
        wctx.putImageData(wheelCacheImg, 0, 0);
        // selection marker
        var hr = state.h * Math.PI / 180, mr = state.s * R;
        var mx = cx + mr * Math.cos(hr), my = cy + mr * Math.sin(hr);
        wctx.beginPath(); wctx.arc(mx, my, 5, 0, Math.PI * 2);
        wctx.strokeStyle = "#000"; wctx.lineWidth = 3; wctx.stroke();
        wctx.beginPath(); wctx.arc(mx, my, 5, 0, Math.PI * 2);
        wctx.strokeStyle = "#fff"; wctx.lineWidth = 1.5; wctx.stroke();
    }

    function drawVal() {
        var w = valC.width, h = valC.height;
        var top = PS.hsvToRgb(state.h, state.s, 1);
        var grad = vctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, "rgb(" + top.r + "," + top.g + "," + top.b + ")");
        grad.addColorStop(1, "#000");
        vctx.fillStyle = grad; vctx.fillRect(0, 0, w, h);
        var my = (1 - state.v) * h;
        vctx.strokeStyle = "#fff"; vctx.lineWidth = 2;
        vctx.strokeRect(1, PS.clamp(my - 2, 0, h - 4), w - 2, 4);
        vctx.strokeStyle = "#000"; vctx.lineWidth = 1;
        vctx.strokeRect(1, PS.clamp(my - 2, 0, h - 4), w - 2, 4);
    }

    function drawAlpha() {
        var w = alphaC.width, h = alphaC.height, cs = 5;
        for (var yy = 0; yy < h; yy += cs) {
            for (var xx = 0; xx < w; xx += cs) {
                actx.fillStyle = ((Math.floor(xx / cs) + Math.floor(yy / cs)) % 2 === 0) ? "#bbb" : "#777";
                actx.fillRect(xx, yy, cs, cs);
            }
        }
        var rgb = PS.hsvToRgb(state.h, state.s, state.v);
        var grad = actx.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + ",0)");
        grad.addColorStop(1, "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + ",1)");
        actx.fillStyle = grad; actx.fillRect(0, 0, w, h);
        var mx = (state.a / 255) * w;
        actx.strokeStyle = "#000"; actx.lineWidth = 3; actx.strokeRect(PS.clamp(mx - 2, 0, w - 4), 0, 4, h);
        actx.strokeStyle = "#fff"; actx.lineWidth = 1.5; actx.strokeRect(PS.clamp(mx - 2, 0, w - 4), 0, 4, h);
    }

    /* ----- inputs ----- */

    function numField(label, max) {
        var wrap = document.createElement("div");
        wrap.className = "cp-field";
        var l = document.createElement("label");
        l.textContent = label;
        var inp = document.createElement("input");
        inp.type = "number";
        inp.min = 0; inp.max = max;
        inp.addEventListener("input", commitInputs);
        wrap.appendChild(l); wrap.appendChild(inp);
        inputsHost.appendChild(wrap);
        return inp;
    }

    function buildInputs() {
        inputsHost.innerHTML = "";
        fields = {};
        if (mode === "rgba") {
            fields.r = numField("R", 255); fields.g = numField("G", 255);
            fields.b = numField("B", 255); fields.a = numField("A", 255);
        } else if (mode === "hsv") {
            fields.h = numField("H", 360); fields.s = numField("S", 100); fields.v = numField("V", 100);
        } else {
            fields.c = numField("C", 100); fields.m = numField("M", 100);
            fields.y = numField("Y", 100); fields.k = numField("K", 100);
        }
    }

    function commitInputs() {
        if (mode === "rgba") {
            var r = clampNum(fields.r, 255), g = clampNum(fields.g, 255), b = clampNum(fields.b, 255);
            state.a = clampNum(fields.a, 255);
            var hsv = PS.rgbToHsv(r, g, b);
            state.h = hsv.h; state.s = hsv.s; state.v = hsv.v;
        } else if (mode === "hsv") {
            state.h = clampNum(fields.h, 360);
            state.s = clampNum(fields.s, 100) / 100;
            state.v = clampNum(fields.v, 100) / 100;
        } else {
            var rgb = PS.cmykToRgb(clampNum(fields.c, 100), clampNum(fields.m, 100),
                clampNum(fields.y, 100), clampNum(fields.k, 100));
            var h2 = PS.rgbToHsv(rgb.r, rgb.g, rgb.b);
            state.h = h2.h; state.s = h2.s; state.v = h2.v;
        }
        ensureWheel(); drawVal(); drawAlpha(); updatePreview(); apply();
    }

    function clampNum(inp, max) {
        var v = parseFloat(inp.value);
        if (isNaN(v)) { v = 0; }
        return PS.clamp(v, 0, max);
    }

    function syncInputs() {
        var rgb = PS.hsvToRgb(state.h, state.s, state.v);
        if (mode === "rgba") {
            fields.r.value = rgb.r; fields.g.value = rgb.g; fields.b.value = rgb.b; fields.a.value = state.a;
        } else if (mode === "hsv") {
            fields.h.value = Math.round(state.h); fields.s.value = Math.round(state.s * 100); fields.v.value = Math.round(state.v * 100);
        } else {
            var cm = PS.rgbToCmyk(rgb.r, rgb.g, rgb.b);
            fields.c.value = cm.c; fields.m.value = cm.m; fields.y.value = cm.y; fields.k.value = cm.k;
        }
        updatePreview();
    }

    function updatePreview() {
        var rgb = PS.hsvToRgb(state.h, state.s, state.v);
        var hex = PS.rgbToHex(rgb.r, rgb.g, rgb.b, state.a);
        hexField.value = hex;
        preview.style.background = hex;
    }

    function apply() {
        var rgb = PS.hsvToRgb(state.h, state.s, state.v);
        var hex = PS.rgbToHex(rgb.r, rgb.g, rgb.b, state.a);
        if (custom) { if (opts.onChange) { opts.onChange(hex); } }
        else if (target === "fg") { PS.setFg(hex, true); }
        else { PS.setBg(hex); }
    }

    function refresh() {
        ensureWheel(); drawVal(); drawAlpha(); syncInputs(); apply();
    }

    /* ----- interaction ----- */

    function bindDrag(canvas, onPos) {
        function rel(e) {
            var r = canvas.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
        }
        canvas.addEventListener("pointerdown", function (e) {
            canvas.setPointerCapture(e.pointerId);
            onPos(rel(e)); e.preventDefault();
        });
        canvas.addEventListener("pointermove", function (e) {
            if (e.buttons & 1) { onPos(rel(e)); }
        });
    }

    function onWheel(p) {
        var R = wheel.width / 2 - 2, cx = wheel.width / 2, cy = wheel.height / 2;
        var dx = p.x - cx, dy = p.y - cy, dist = Math.min(Math.sqrt(dx * dx + dy * dy), R);
        var hue = Math.atan2(dy, dx) * 180 / Math.PI; if (hue < 0) { hue += 360; }
        state.h = hue; state.s = dist / R;
        refresh();
    }

    function onVal(p) { state.v = PS.clamp(1 - p.y / p.h, 0, 1); refresh(); }
    function onAlpha(p) { state.a = Math.round(PS.clamp(p.x / p.w, 0, 1) * 255); refresh(); }
};
