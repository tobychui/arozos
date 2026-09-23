/*
    colorpicker.js

    An embedded colour picker laid out like the Photoshop Color Picker dialog,
    themed with the builder's own tokens instead of the browser's native
    <input type="color"> widget (which looks different on every OS and cannot be
    themed at all).

    Layout, left to right, matching the reference:

        [ saturation/value field ][ component strip ][ new/current + HSB/RGB + hex ]
                                                     [ buttons + Lab + CMYK ]
        [ Only Web Colors ]

    The field and the strip are canvases painted per pixel, so all nine
    component modes (H S B / R G B / L a b) drive them for real rather than the
    radios being decoration.

    Public API:
        WBColorPicker.open({
            value:     starting colour (any CSS hex/rgb/rgba)
            title:     optional dialog title
            onPreview: called continuously while the colour changes
            onApply:   called with the final colour on OK
            onCancel:  called with the original colour on Cancel/Escape
        })
*/

var WBColorPicker = (function () {

    /* ------------------------------------------------- colour maths -- */

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function round(v) { return Math.round(v); }

    function hexToRgb(hex) {
        hex = String(hex || "").trim().replace("#", "");
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        if (!/^[0-9a-f]{6}$/i.test(hex)) { return null; }
        return {
            r: parseInt(hex.substr(0, 2), 16),
            g: parseInt(hex.substr(2, 2), 16),
            b: parseInt(hex.substr(4, 2), 16)
        };
    }

    function rgbToHex(c) {
        function h(n) { return ("0" + clamp(round(n), 0, 255).toString(16)).slice(-2); }
        return "#" + h(c.r) + h(c.g) + h(c.b);
    }

    /* Accepts hex, rgb() and rgba(); alpha is carried through untouched. */
    function parseColor(value) {
        var s = String(value || "").trim();
        var hex = hexToRgb(s);
        if (hex) { return { r: hex.r, g: hex.g, b: hex.b, a: 1 }; }
        var m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/i);
        if (m) {
            return {
                r: clamp(round(parseFloat(m[1])), 0, 255),
                g: clamp(round(parseFloat(m[2])), 0, 255),
                b: clamp(round(parseFloat(m[3])), 0, 255),
                a: m[4] === undefined ? 1 : clamp(parseFloat(m[4]), 0, 1)
            };
        }
        return null;
    }

    function formatColor(c) {
        if (c.a !== undefined && c.a < 1) {
            return "rgba(" + round(c.r) + ", " + round(c.g) + ", " + round(c.b) + ", " +
                   (Math.round(c.a * 1000) / 1000) + ")";
        }
        return rgbToHex(c);
    }

    /* HSB (a.k.a. HSV): h 0-360, s 0-100, b 0-100 */
    function rgbToHsb(c) {
        var r = c.r / 255, g = c.g / 255, b = c.b / 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        var d = max - min;
        var h = 0;
        if (d !== 0) {
            if (max === r) { h = ((g - b) / d) % 6; }
            else if (max === g) { h = (b - r) / d + 2; }
            else { h = (r - g) / d + 4; }
            h *= 60;
            if (h < 0) { h += 360; }
        }
        return { h: h, s: max === 0 ? 0 : (d / max) * 100, b: max * 100 };
    }

    function hsbToRgb(hsb) {
        var h = ((hsb.h % 360) + 360) % 360, s = clamp(hsb.s, 0, 100) / 100,
            v = clamp(hsb.b, 0, 100) / 100;
        var c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
        var t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
        return { r: round((t[0] + m) * 255), g: round((t[1] + m) * 255), b: round((t[2] + m) * 255) };
    }

    /* CIE Lab, D65 white point */
    function rgbToLab(c) {
        function inv(u) {
            u /= 255;
            return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
        }
        var r = inv(c.r), g = inv(c.g), b = inv(c.b);
        var x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
        var y = (r * 0.2126729 + g * 0.7151522 + b * 0.0721750);
        var z = (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) / 1.08883;
        function f(t) { return t > 0.008856 ? Math.pow(t, 1 / 3) : (7.787 * t) + 16 / 116; }
        var fx = f(x), fy = f(y), fz = f(z);
        return { L: (116 * fy) - 16, A: 500 * (fx - fy), B: 200 * (fy - fz) };
    }

    function labToRgb(lab) {
        var fy = (lab.L + 16) / 116;
        var fx = fy + lab.A / 500;
        var fz = fy - lab.B / 200;
        function fi(t) {
            var t3 = t * t * t;
            return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787;
        }
        var x = fi(fx) * 0.95047, y = fi(fy), z = fi(fz) * 1.08883;
        var r = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
        var g = x * -0.9692660 + y * 1.8760108 + z * 0.0415560;
        var b = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;
        function gam(u) {
            u = u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(Math.max(u, 0), 1 / 2.4) - 0.055;
            return clamp(round(u * 255), 0, 255);
        }
        return { r: gam(r), g: gam(g), b: gam(b) };
    }

    /* Plain CMYK, the same naive transform Photoshop shows without a profile. */
    function rgbToCmyk(c) {
        var r = c.r / 255, g = c.g / 255, b = c.b / 255;
        var k = 1 - Math.max(r, g, b);
        if (k >= 1) { return { c: 0, m: 0, y: 0, k: 100 }; }
        return {
            c: ((1 - r - k) / (1 - k)) * 100,
            m: ((1 - g - k) / (1 - k)) * 100,
            y: ((1 - b - k) / (1 - k)) * 100,
            k: k * 100
        };
    }

    function cmykToRgb(v) {
        var c = clamp(v.c, 0, 100) / 100, m = clamp(v.m, 0, 100) / 100,
            y = clamp(v.y, 0, 100) / 100, k = clamp(v.k, 0, 100) / 100;
        return {
            r: round(255 * (1 - c) * (1 - k)),
            g: round(255 * (1 - m) * (1 - k)),
            b: round(255 * (1 - y) * (1 - k))
        };
    }

    /* Nearest colour on the 216 colour web-safe palette. */
    function webSafe(c) {
        function q(n) { return Math.round(n / 51) * 51; }
        return { r: q(c.r), g: q(c.g), b: q(c.b) };
    }

    /* --------------------------------------------------------- modes -- */

    /*
        Each mode says which component the vertical strip drives, and which two
        the field's axes drive. rgbAt() paints the field, stripAt() the strip.
    */
    var MODES = {
        h: { label: "H", unit: "°", max: 360, group: "hsb",
             get: function (s) { return s.hsb.h; },
             set: function (s, v) { s.hsb.h = v; syncFromHsb(s); },
             rgbAt: function (s, x, y) { return hsbToRgb({ h: s.hsb.h, s: x * 100, b: (1 - y) * 100 }); },
             stripAt: function (s, t) { return hsbToRgb({ h: t * 360, s: 100, b: 100 }); },
             xy: function (s) { return [s.hsb.s / 100, 1 - s.hsb.b / 100]; },
             setXY: function (s, x, y) { s.hsb.s = x * 100; s.hsb.b = (1 - y) * 100; syncFromHsb(s); } },

        s: { label: "S", unit: "%", max: 100, group: "hsb",
             get: function (s) { return s.hsb.s; },
             set: function (s, v) { s.hsb.s = v; syncFromHsb(s); },
             rgbAt: function (s, x, y) { return hsbToRgb({ h: x * 360, s: s.hsb.s, b: (1 - y) * 100 }); },
             stripAt: function (s, t) { return hsbToRgb({ h: s.hsb.h, s: t * 100, b: s.hsb.b }); },
             xy: function (s) { return [s.hsb.h / 360, 1 - s.hsb.b / 100]; },
             setXY: function (s, x, y) { s.hsb.h = x * 360; s.hsb.b = (1 - y) * 100; syncFromHsb(s); } },

        b: { label: "B", unit: "%", max: 100, group: "hsb",
             get: function (s) { return s.hsb.b; },
             set: function (s, v) { s.hsb.b = v; syncFromHsb(s); },
             rgbAt: function (s, x, y) { return hsbToRgb({ h: x * 360, s: (1 - y) * 100, b: s.hsb.b }); },
             stripAt: function (s, t) { return hsbToRgb({ h: s.hsb.h, s: s.hsb.s, b: t * 100 }); },
             xy: function (s) { return [s.hsb.h / 360, 1 - s.hsb.s / 100]; },
             setXY: function (s, x, y) { s.hsb.h = x * 360; s.hsb.s = (1 - y) * 100; syncFromHsb(s); } },

        r: { label: "R", unit: "", max: 255, group: "rgb",
             get: function (s) { return s.rgb.r; },
             set: function (s, v) { s.rgb.r = v; syncFromRgb(s); },
             rgbAt: function (s, x, y) { return { r: s.rgb.r, g: (1 - y) * 255, b: x * 255 }; },
             stripAt: function (s, t) { return { r: t * 255, g: s.rgb.g, b: s.rgb.b }; },
             xy: function (s) { return [s.rgb.b / 255, 1 - s.rgb.g / 255]; },
             setXY: function (s, x, y) { s.rgb.b = x * 255; s.rgb.g = (1 - y) * 255; syncFromRgb(s); } },

        g: { label: "G", unit: "", max: 255, group: "rgb",
             get: function (s) { return s.rgb.g; },
             set: function (s, v) { s.rgb.g = v; syncFromRgb(s); },
             rgbAt: function (s, x, y) { return { r: (1 - y) * 255, g: s.rgb.g, b: x * 255 }; },
             stripAt: function (s, t) { return { r: s.rgb.r, g: t * 255, b: s.rgb.b }; },
             xy: function (s) { return [s.rgb.b / 255, 1 - s.rgb.r / 255]; },
             setXY: function (s, x, y) { s.rgb.b = x * 255; s.rgb.r = (1 - y) * 255; syncFromRgb(s); } },

        bl: { label: "B", unit: "", max: 255, group: "rgb",
             get: function (s) { return s.rgb.b; },
             set: function (s, v) { s.rgb.b = v; syncFromRgb(s); },
             rgbAt: function (s, x, y) { return { r: x * 255, g: (1 - y) * 255, b: s.rgb.b }; },
             stripAt: function (s, t) { return { r: s.rgb.r, g: s.rgb.g, b: t * 255 }; },
             xy: function (s) { return [s.rgb.r / 255, 1 - s.rgb.g / 255]; },
             setXY: function (s, x, y) { s.rgb.r = x * 255; s.rgb.g = (1 - y) * 255; syncFromRgb(s); } },

        L: { label: "L", unit: "", max: 100, group: "lab",
             get: function (s) { return s.lab.L; },
             set: function (s, v) { s.lab.L = v; syncFromLab(s); },
             rgbAt: function (s, x, y) { return labToRgb({ L: s.lab.L, A: x * 255 - 128, B: (1 - y) * 255 - 128 }); },
             stripAt: function (s, t) { return labToRgb({ L: t * 100, A: s.lab.A, B: s.lab.B }); },
             xy: function (s) { return [(s.lab.A + 128) / 255, 1 - (s.lab.B + 128) / 255]; },
             setXY: function (s, x, y) { s.lab.A = x * 255 - 128; s.lab.B = (1 - y) * 255 - 128; syncFromLab(s); } },

        A: { label: "a", unit: "", max: 127, min: -128, group: "lab",
             get: function (s) { return s.lab.A; },
             set: function (s, v) { s.lab.A = v; syncFromLab(s); },
             rgbAt: function (s, x, y) { return labToRgb({ L: (1 - y) * 100, A: s.lab.A, B: x * 255 - 128 }); },
             stripAt: function (s, t) { return labToRgb({ L: s.lab.L, A: t * 255 - 128, B: s.lab.B }); },
             xy: function (s) { return [(s.lab.B + 128) / 255, 1 - s.lab.L / 100]; },
             setXY: function (s, x, y) { s.lab.B = x * 255 - 128; s.lab.L = (1 - y) * 100; syncFromLab(s); } },

        Bl: { label: "b", unit: "", max: 127, min: -128, group: "lab",
             get: function (s) { return s.lab.B; },
             set: function (s, v) { s.lab.B = v; syncFromLab(s); },
             rgbAt: function (s, x, y) { return labToRgb({ L: (1 - y) * 100, A: x * 255 - 128, B: s.lab.B }); },
             stripAt: function (s, t) { return labToRgb({ L: s.lab.L, A: s.lab.A, B: t * 255 - 128 }); },
             xy: function (s) { return [(s.lab.A + 128) / 255, 1 - s.lab.L / 100]; },
             setXY: function (s, x, y) { s.lab.A = x * 255 - 128; s.lab.L = (1 - y) * 100; syncFromLab(s); } }
    };

    /* keep the three representations in step, whichever one was edited */
    function syncFromRgb(s) { s.hsb = rgbToHsb(s.rgb); s.lab = rgbToLab(s.rgb); }
    function syncFromHsb(s) {
        var rgb = hsbToRgb(s.hsb);
        s.rgb.r = rgb.r; s.rgb.g = rgb.g; s.rgb.b = rgb.b;
        s.lab = rgbToLab(s.rgb);
    }
    function syncFromLab(s) {
        var rgb = labToRgb(s.lab);
        s.rgb.r = rgb.r; s.rgb.g = rgb.g; s.rgb.b = rgb.b;
        s.hsb = rgbToHsb(s.rgb);
    }

    /* -------------------------------------------------- saved swatches -- */

    var STORE_KEY = "wb_color_swatches";

    function savedSwatches() {
        try {
            var raw = window.localStorage.getItem(STORE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) { return []; }
    }

    function saveSwatch(hex) {
        try {
            var list = savedSwatches().filter(function (c) { return c !== hex; });
            list.unshift(hex);
            window.localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, 36)));
        } catch (e) { /* storage unavailable - swatches just do not persist */ }
    }

    /* --------------------------------------------------------- dialog -- */

    var current = null;

    function open(cfg) {
        close(true);
        cfg = cfg || {};

        var parsed = parseColor(cfg.value) || { r: 0, g: 0, b: 0, a: 1 };
        var state = {
            rgb: { r: parsed.r, g: parsed.g, b: parsed.b },
            alpha: parsed.a,
            mode: "h",
            webOnly: false
        };
        syncFromRgb(state);

        var originalValue = cfg.value || "";
        var originalRgb = { r: parsed.r, g: parsed.g, b: parsed.b };

        var el = build(state, cfg, originalRgb, originalValue);
        document.body.appendChild(el.backdrop);
        document.body.appendChild(el.panel);
        position(el.panel, cfg.anchor);
        current = { el: el, cfg: cfg, state: state, originalValue: originalValue };
        el.repaint();
        return el.panel;
    }

    function close(silent) {
        if (!current) { return; }
        var c = current;
        current = null;
        if (c.el.backdrop.parentNode) { c.el.backdrop.parentNode.removeChild(c.el.backdrop); }
        if (c.el.panel.parentNode) { c.el.panel.parentNode.removeChild(c.el.panel); }
        if (!silent && c.cfg.onCancel) { c.cfg.onCancel(c.originalValue); }
    }

    function position(panel, anchor) {
        var w = panel.offsetWidth, h = panel.offsetHeight;
        var x = (window.innerWidth - w) / 2;
        var y = (window.innerHeight - h) / 2;
        if (anchor && anchor.getBoundingClientRect) {
            var r = anchor.getBoundingClientRect();
            x = r.left - w - 12;                       /* prefer left of the dock */
            if (x < 10) { x = Math.min(r.right + 12, window.innerWidth - w - 10); }
            y = r.top - 40;
        }
        panel.style.left = Math.round(clamp(x, 10, Math.max(10, window.innerWidth - w - 10))) + "px";
        panel.style.top = Math.round(clamp(y, 10, Math.max(10, window.innerHeight - h - 10))) + "px";
    }

    var el = WBUI.el;

    function build(state, cfg, originalRgb, originalValue) {
        var backdrop = el("div", { class: "wb-cp-backdrop" });
        var panel = el("div", { class: "wb-cp" });

        /* --- field + strip --- */
        var field = el("canvas", { class: "wb-cp-field", width: 256, height: 256 });
        var fieldCursor = el("div", { class: "wb-cp-field-cursor" });
        var fieldWrap = el("div", { class: "wb-cp-field-wrap" }, [field, fieldCursor]);

        var strip = el("canvas", { class: "wb-cp-strip", width: 18, height: 256 });
        var stripCursor = el("div", { class: "wb-cp-strip-cursor" }, [
            el("i", { class: "wb-cp-arrow left" }),
            el("i", { class: "wb-cp-arrow right" })
        ]);
        var stripWrap = el("div", { class: "wb-cp-strip-wrap" }, [strip, stripCursor]);

        /* --- new / current --- */
        var newSwatch = el("div", { class: "wb-cp-chip new" });
        var curSwatch = el("div", { class: "wb-cp-chip current", style: "background:" + rgbToHex(originalRgb) });
        curSwatch.addEventListener("click", function () {
            state.rgb.r = originalRgb.r; state.rgb.g = originalRgb.g; state.rgb.b = originalRgb.b;
            syncFromRgb(state);
            repaint();
        });
        var preview = el("div", { class: "wb-cp-preview" }, [
            el("div", { class: "wb-cp-preview-label", text: "new" }),
            newSwatch,
            curSwatch,
            el("div", { class: "wb-cp-preview-label", text: "current" })
        ]);

        /* --- numeric rows --- */
        var inputs = {};

        function numberRow(modeKey, label, unit, opts) {
            opts = opts || {};
            var input = el("input", { class: "wb-cp-num", type: "text", spellcheck: "false" });
            inputs[modeKey || label] = input;

            var row = el("div", { class: "wb-cp-row" });
            if (modeKey) {
                var radio = el("input", { class: "wb-cp-radio", type: "radio", name: "wb-cp-mode" });
                radio.checked = (state.mode === modeKey);
                radio.addEventListener("change", function () {
                    state.mode = modeKey;
                    repaint();
                });
                inputs["radio_" + modeKey] = radio;
                row.appendChild(radio);
            } else {
                row.appendChild(el("span", { class: "wb-cp-radio-spacer" }));
            }
            row.appendChild(el("label", { class: "wb-cp-label", text: label + ":" }));
            row.appendChild(input);
            row.appendChild(el("span", { class: "wb-cp-unit", text: unit || "" }));

            input.addEventListener("change", function () { opts.commit(input.value); });
            input.addEventListener("keydown", function (e) {
                if (e.key === "Enter") { opts.commit(input.value); }
            });
            return row;
        }

        function num(v) { return String(Math.round(v)); }

        /* HSB + RGB column */
        var colHsb = el("div", { class: "wb-cp-group" }, [
            numberRow("h", "H", "°", { commit: function (v) { state.hsb.h = clamp(parseFloat(v) || 0, 0, 360); syncFromHsb(state); repaint(); } }),
            numberRow("s", "S", "%", { commit: function (v) { state.hsb.s = clamp(parseFloat(v) || 0, 0, 100); syncFromHsb(state); repaint(); } }),
            numberRow("b", "B", "%", { commit: function (v) { state.hsb.b = clamp(parseFloat(v) || 0, 0, 100); syncFromHsb(state); repaint(); } })
        ]);
        var colRgb = el("div", { class: "wb-cp-group" }, [
            numberRow("r", "R", "", { commit: function (v) { state.rgb.r = clamp(parseFloat(v) || 0, 0, 255); syncFromRgb(state); repaint(); } }),
            numberRow("g", "G", "", { commit: function (v) { state.rgb.g = clamp(parseFloat(v) || 0, 0, 255); syncFromRgb(state); repaint(); } }),
            numberRow("bl", "B", "", { commit: function (v) { state.rgb.b = clamp(parseFloat(v) || 0, 0, 255); syncFromRgb(state); repaint(); } })
        ]);

        /* Lab + CMYK column */
        var colLab = el("div", { class: "wb-cp-group" }, [
            numberRow("L", "L", "", { commit: function (v) { state.lab.L = clamp(parseFloat(v) || 0, 0, 100); syncFromLab(state); repaint(); } }),
            numberRow("A", "a", "", { commit: function (v) { state.lab.A = clamp(parseFloat(v) || 0, -128, 127); syncFromLab(state); repaint(); } }),
            numberRow("Bl", "b", "", { commit: function (v) { state.lab.B = clamp(parseFloat(v) || 0, -128, 127); syncFromLab(state); repaint(); } })
        ]);

        function cmykCommit() {
            var v = cmykToRgb({
                c: parseFloat(inputs.C.value) || 0, m: parseFloat(inputs.M.value) || 0,
                y: parseFloat(inputs.Y.value) || 0, k: parseFloat(inputs.K.value) || 0
            });
            state.rgb.r = v.r; state.rgb.g = v.g; state.rgb.b = v.b;
            syncFromRgb(state);
            repaint();
        }
        var colCmyk = el("div", { class: "wb-cp-group" }, [
            numberRow(null, "C", "%", { commit: cmykCommit }),
            numberRow(null, "M", "%", { commit: cmykCommit }),
            numberRow(null, "Y", "%", { commit: cmykCommit }),
            numberRow(null, "K", "%", { commit: cmykCommit })
        ]);

        /* --- hex --- */
        var hexInput = el("input", { class: "wb-cp-hex", type: "text", spellcheck: "false" });
        hexInput.addEventListener("change", function () { commitHex(); });
        hexInput.addEventListener("keydown", function (e) {
            if (e.key === "Enter") { e.preventDefault(); commitHex(); }
        });
        function commitHex() {
            var parsed = parseColor(hexInput.value.charAt(0) === "#" ? hexInput.value : "#" + hexInput.value);
            if (!parsed) { repaint(); return; }
            state.rgb.r = parsed.r; state.rgb.g = parsed.g; state.rgb.b = parsed.b;
            syncFromRgb(state);
            repaint();
        }
        var hexRow = el("div", { class: "wb-cp-hexrow" }, [
            el("span", { class: "wb-cp-label", text: "#" }),
            hexInput
        ]);

        /* --- buttons --- */
        var okBtn = el("button", { class: "wb-cp-btn primary", type: "button", text: "OK" });
        var cancelBtn = el("button", { class: "wb-cp-btn", type: "button", text: "Cancel" });
        var addBtn = el("button", { class: "wb-cp-btn", type: "button", text: "Add to Swatches" });
        var libBtn = el("button", { class: "wb-cp-btn", type: "button", text: "Color Libraries" });

        okBtn.addEventListener("click", function () {
            var out = formatColor({ r: state.rgb.r, g: state.rgb.g, b: state.rgb.b, a: state.alpha });
            var apply = cfg.onApply;
            close(true);
            if (apply) { apply(out); }
        });
        cancelBtn.addEventListener("click", function () { close(false); });
        addBtn.addEventListener("click", function () {
            saveSwatch(rgbToHex(state.rgb));
            addBtn.textContent = "Added";
            setTimeout(function () { addBtn.textContent = "Add to Swatches"; }, 900);
        });
        libBtn.addEventListener("click", function () { toggleLibrary(); });

        var buttons = el("div", { class: "wb-cp-buttons" }, [okBtn, cancelBtn, addBtn, libBtn]);

        /* --- only web colours --- */
        var webBox = el("input", { type: "checkbox", class: "wb-cp-check" });
        webBox.addEventListener("change", function () {
            state.webOnly = webBox.checked;
            if (state.webOnly) {
                var q = webSafe(state.rgb);
                state.rgb.r = q.r; state.rgb.g = q.g; state.rgb.b = q.b;
                syncFromRgb(state);
            }
            repaint();
        });
        var webRow = el("label", { class: "wb-cp-weblabel" }, [
            webBox, el("span", { text: "Only Web Colors" })
        ]);

        /* --- library overlay (saved swatches + this site's palette) --- */
        var library = el("div", { class: "wb-cp-library" });
        function toggleLibrary() {
            if (library.classList.contains("show")) { library.classList.remove("show"); return; }
            WBUI.clear(library);
            library.appendChild(el("div", { class: "wb-cp-lib-head" }, [
                el("span", { text: "Color Libraries" }),
                el("button", {
                    class: "wb-cp-lib-close", type: "button", html: WBIcon("close", 13),
                    onclick: function () { library.classList.remove("show"); }
                })
            ]));

            var theme = {};
            try { theme = WBModel.get().settings.theme || {}; } catch (e) { theme = {}; }
            addLibGroup(library, "This site", [theme.accent, theme.text, theme.background].filter(Boolean));
            addLibGroup(library, "Saved", savedSwatches());
            addLibGroup(library, "Basic", [
                "#000000", "#ffffff", "#f97316", "#ef4444", "#f59e0b", "#eab308",
                "#22c55e", "#10b981", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
                "#ec4899", "#64748b", "#94a3b8", "#e5e7eb"
            ]);
            library.classList.add("show");
        }

        function addLibGroup(host, title, colors) {
            if (!colors || !colors.length) { return; }
            host.appendChild(el("div", { class: "wb-cp-lib-title", text: title }));
            var grid = el("div", { class: "wb-cp-lib-grid" });
            colors.forEach(function (hex) {
                var parsedSwatch = parseColor(hex);
                if (!parsedSwatch) { return; }
                grid.appendChild(el("button", {
                    class: "wb-cp-lib-chip",
                    type: "button",
                    title: hex,
                    style: "background:" + hex,
                    onclick: function () {
                        state.rgb.r = parsedSwatch.r; state.rgb.g = parsedSwatch.g; state.rgb.b = parsedSwatch.b;
                        syncFromRgb(state);
                        library.classList.remove("show");
                        repaint();
                    }
                }));
            });
            host.appendChild(grid);
        }

        /* --- assemble, in the reference's order --- */
        var col3 = el("div", { class: "wb-cp-col wb-cp-col-values" }, [preview, colHsb, colRgb, hexRow]);
        var col4 = el("div", { class: "wb-cp-col wb-cp-col-actions" }, [buttons, colLab, colCmyk]);

        panel.appendChild(el("div", { class: "wb-cp-title", text: cfg.title || "Color Picker" }));
        panel.appendChild(el("div", { class: "wb-cp-main" }, [
            el("div", { class: "wb-cp-col wb-cp-col-field" }, [fieldWrap, webRow]),
            stripWrap,
            col3,
            col4
        ]));
        panel.appendChild(library);

        /* ------------------------------------------------ painting -- */

        var fieldCtx = field.getContext("2d");
        var stripCtx = strip.getContext("2d");
        var fieldImage = fieldCtx.createImageData(256, 256);
        var stripImage = stripCtx.createImageData(18, 256);

        function paintField() {
            var mode = MODES[state.mode];
            var data = fieldImage.data, i = 0;
            for (var y = 0; y < 256; y++) {
                for (var x = 0; x < 256; x++) {
                    var c = mode.rgbAt(state, x / 255, y / 255);
                    if (state.webOnly) { c = webSafe(c); }
                    data[i++] = c.r; data[i++] = c.g; data[i++] = c.b; data[i++] = 255;
                }
            }
            fieldCtx.putImageData(fieldImage, 0, 0);
        }

        function paintStrip() {
            var mode = MODES[state.mode];
            var data = stripImage.data, i = 0;
            for (var y = 0; y < 256; y++) {
                var c = mode.stripAt(state, 1 - y / 255);
                if (state.webOnly) { c = webSafe(c); }
                for (var x = 0; x < 18; x++) {
                    data[i++] = c.r; data[i++] = c.g; data[i++] = c.b; data[i++] = 255;
                }
            }
            stripCtx.putImageData(stripImage, 0, 0);
        }

        function repaint() {
            var mode = MODES[state.mode];
            paintField();
            paintStrip();

            var xy = mode.xy(state);
            fieldCursor.style.left = (clamp(xy[0], 0, 1) * 100) + "%";
            fieldCursor.style.top = (clamp(xy[1], 0, 1) * 100) + "%";

            var lo = mode.min === undefined ? 0 : mode.min;
            var t = (mode.get(state) - lo) / (mode.max - lo);
            stripCursor.style.top = ((1 - clamp(t, 0, 1)) * 100) + "%";

            var hex = rgbToHex(state.rgb);
            newSwatch.style.background = hex;

            if (document.activeElement !== inputs.h) { inputs.h.value = num(state.hsb.h); }
            if (document.activeElement !== inputs.s) { inputs.s.value = num(state.hsb.s); }
            if (document.activeElement !== inputs.b) { inputs.b.value = num(state.hsb.b); }
            if (document.activeElement !== inputs.r) { inputs.r.value = num(state.rgb.r); }
            if (document.activeElement !== inputs.g) { inputs.g.value = num(state.rgb.g); }
            if (document.activeElement !== inputs.bl) { inputs.bl.value = num(state.rgb.b); }
            if (document.activeElement !== inputs.L) { inputs.L.value = num(state.lab.L); }
            if (document.activeElement !== inputs.A) { inputs.A.value = num(state.lab.A); }
            if (document.activeElement !== inputs.Bl) { inputs.Bl.value = num(state.lab.B); }

            var cmyk = rgbToCmyk(state.rgb);
            if (document.activeElement !== inputs.C) { inputs.C.value = num(cmyk.c); }
            if (document.activeElement !== inputs.M) { inputs.M.value = num(cmyk.m); }
            if (document.activeElement !== inputs.Y) { inputs.Y.value = num(cmyk.y); }
            if (document.activeElement !== inputs.K) { inputs.K.value = num(cmyk.k); }

            if (document.activeElement !== hexInput) { hexInput.value = hex.replace("#", ""); }

            for (var key in MODES) {
                var radio = inputs["radio_" + key];
                if (radio) { radio.checked = (state.mode === key); }
            }

            if (cfg.onPreview) {
                cfg.onPreview(formatColor({ r: state.rgb.r, g: state.rgb.g, b: state.rgb.b, a: state.alpha }));
            }
        }

        /* ---------------------------------------------- interaction -- */

        function dragHandler(target, onMove) {
            function point(e) {
                var r = target.getBoundingClientRect();
                var cx = e.touches ? e.touches[0].clientX : e.clientX;
                var cy = e.touches ? e.touches[0].clientY : e.clientY;
                onMove(clamp((cx - r.left) / r.width, 0, 1), clamp((cy - r.top) / r.height, 0, 1));
            }
            target.addEventListener("mousedown", function (e) {
                e.preventDefault();
                point(e);
                function move(ev) { point(ev); }
                function up() {
                    document.removeEventListener("mousemove", move, true);
                    document.removeEventListener("mouseup", up, true);
                }
                document.addEventListener("mousemove", move, true);
                document.addEventListener("mouseup", up, true);
            });
        }

        dragHandler(fieldWrap, function (x, y) {
            MODES[state.mode].setXY(state, x, y);
            if (state.webOnly) {
                var q = webSafe(state.rgb);
                state.rgb.r = q.r; state.rgb.g = q.g; state.rgb.b = q.b;
                syncFromRgb(state);
            }
            repaint();
        });

        dragHandler(stripWrap, function (x, y) {
            var mode = MODES[state.mode];
            var lo = mode.min === undefined ? 0 : mode.min;
            mode.set(state, lo + (1 - y) * (mode.max - lo));
            if (state.webOnly) {
                var q = webSafe(state.rgb);
                state.rgb.r = q.r; state.rgb.g = q.g; state.rgb.b = q.b;
                syncFromRgb(state);
            }
            repaint();
        });

        backdrop.addEventListener("mousedown", function () { close(false); });
        panel.addEventListener("keydown", function (e) {
            if (e.key === "Escape") { e.preventDefault(); close(false); }
            if (e.key === "Enter" && e.target.tagName !== "INPUT") { okBtn.click(); }
        });

        return { panel: panel, backdrop: backdrop, repaint: repaint };
    }

    return {
        open: open,
        close: close,
        parseColor: parseColor,
        formatColor: formatColor,
        rgbToHex: rgbToHex,
        hexToRgb: hexToRgb,
        rgbToHsb: rgbToHsb,
        hsbToRgb: hsbToRgb,
        rgbToLab: rgbToLab,
        labToRgb: labToRgb,
        rgbToCmyk: rgbToCmyk,
        cmykToRgb: cmykToRgb,
        webSafe: webSafe
    };
})();
