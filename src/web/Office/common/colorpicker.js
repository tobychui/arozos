/*
    ArozOS Office - shared color picker (OfficeColorPicker)
    ========================================================
    A Google-Docs-style palette popup (square swatches) that replaces the
    browser-native <input type="color"> everywhere in the Office suite.

    Palette layout: optional "no color" row, an 8x10 standard grid
    (grays / base colors / tints / shades), then a CUSTOM section with the
    user's recent custom colors (persisted in localStorage, shared across
    the suite), a "+" button that opens a built-in HSV picker (saturation/
    value square + hue slider + hex field) and - when the browser supports
    it - an eyedropper.

    API:
        OfficeColorPicker.open({
            anchor: el,                  // element to drop under (or x/y)
            value: "#ff0000",            // current color (marks the swatch)
            allowNone: true,             // show the "no color" entry
            noneLabel: "Transparent",    // its label (default "No color")
            onPick: function(hex){...}   // "#rrggbb", or "" when none picked
        });
        OfficeColorPicker.close();
        OfficeColorPicker.isOpen();
        OfficeColorPicker.contains(node);

        // Drop-in replacement for a toolbar <input type="color">:
        // returns a <button> that keeps .val() and "change"/"input" event
        // semantics, so existing handlers keep working unchanged.
        var $c = OfficeColorPicker.swatchInput({
            id: "shTextColor", title: "Text color", value: "#202124",
            className: "of-tcolor", allowNone: false, noneLabel: "No fill"
        });
*/

var OfficeColorPicker = (function () {
    // Google-Docs standard palette: grays, base colors, then 3 tint and
    // 3 shade rows - 10 columns each.
    var ROWS = [
        ["#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff"],
        ["#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff"],
        ["#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc"],
        ["#dd7e6b", "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#a4c2f4", "#9fc5e8", "#b4a7d6", "#d5a6bd"],
        ["#cc4125", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6d9eeb", "#6fa8dc", "#8e7cc3", "#c27ba0"],
        ["#a61c00", "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3c78d8", "#3d85c6", "#674ea7", "#a64d79"],
        ["#85200c", "#990000", "#b45f06", "#bf9000", "#38761d", "#134f5c", "#1155cc", "#0b5394", "#351c75", "#741b47"],
        ["#5b0f00", "#660000", "#783f04", "#7f6000", "#274e13", "#0c343d", "#1c4587", "#073763", "#20124d", "#4c1130"]
    ];
    var LS_KEY = "office_cp_custom";
    var $panel = null;
    var opts = null;
    var anchorNode = null;

    /* ---------- color math ---------- */
    function normHex(v) {
        if (!v) return null;
        v = String(v).trim().replace(/^#/, "");
        if (/^[0-9a-fA-F]{3}$/.test(v)) {
            v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
        }
        if (!/^[0-9a-fA-F]{6}$/.test(v)) return null;
        return "#" + v.toLowerCase();
    }
    function hexToHsv(hex) {
        var r = parseInt(hex.substr(1, 2), 16) / 255;
        var g = parseInt(hex.substr(3, 2), 16) / 255;
        var b = parseInt(hex.substr(5, 2), 16) / 255;
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        var h = 0;
        if (d !== 0) {
            if (mx === r) h = ((g - b) / d) % 6;
            else if (mx === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;
            if (h < 0) h += 360;
        }
        return { h: h, s: mx === 0 ? 0 : d / mx, v: mx };
    }
    function hsvToHex(h, s, v) {
        var c = v * s;
        var x = c * (1 - Math.abs((h / 60) % 2 - 1));
        var m = v - c;
        var r = 0, g = 0, b = 0;
        if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
        else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
        else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
        var to = function (n) {
            return ("0" + Math.round((n + m) * 255).toString(16)).slice(-2);
        };
        return "#" + to(r) + to(g) + to(b);
    }

    /* ---------- recent custom colors (shared across the suite) ---------- */
    function getCustom() {
        try {
            var v = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
            return Array.isArray(v) ? v : [];
        } catch (e) { return []; }
    }
    function addCustom(hex) {
        var list = getCustom().filter(function (c) { return c !== hex; });
        list.unshift(hex);
        if (list.length > 8) list.length = 8;
        try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch (e) { }
    }

    /* ---------- panel ---------- */
    function pick(hex) {
        var cb = opts && opts.onPick;
        close();
        if (cb) cb(hex);
    }
    // keep the host's text selection alive: nothing in the panel may steal
    // focus on mousedown (the hex input re-enables it for itself)
    function guardFocus($el) {
        $el.on("mousedown", function (e) {
            if (!$(e.target).is("input.of-cp-hex")) e.preventDefault();
        });
    }
    function swatch(hex, selHex) {
        var $c = $('<button type="button" class="of-cp-cell"></button>')
            .attr("title", hex)
            .css("background", hex);
        if (selHex && hex === selHex) $c.addClass("sel");
        $c.on("click", function () { pick(hex); });
        return $c;
    }
    function buildPaletteView() {
        $panel.empty();
        var selHex = normHex(opts.value);

        if (opts.allowNone) {
            var $none = $('<button type="button" class="of-cp-none">' +
                '<i class="ban icon"></i>' +
                '<span></span></button>');
            $none.find("span").text(opts.noneLabel || "No color");
            $none.on("click", function () { pick(""); });
            $panel.append($none);
        }

        var $grid = $('<div class="of-cp-grid"></div>');
        ROWS.forEach(function (row) {
            row.forEach(function (hex) { $grid.append(swatch(hex, selHex)); });
        });
        $panel.append($grid);

        $panel.append('<div class="of-cp-label">Custom</div>');
        var $row = $('<div class="of-cp-customrow"></div>');
        var $add = $('<button type="button" class="of-cp-add" title="Custom color...">+</button>');
        $add.on("click", buildCustomView);
        $row.append($add);
        if (window.EyeDropper) {
            var $eye = $('<button type="button" class="of-cp-add" title="Pick color from screen"><i class="eye dropper icon"></i></button>');
            $eye.on("click", function () {
                try {
                    new window.EyeDropper().open().then(function (res) {
                        var hex = normHex(res.sRGBHex);
                        if (hex) { addCustom(hex); pick(hex); }
                    }, function () { });
                } catch (e) { }
            });
            $row.append($eye);
        }
        getCustom().forEach(function (hex) { $row.append(swatch(hex, selHex)); });
        $panel.append($row);
        clampToViewport();
    }

    /* ---------- built-in HSV picker (the "+" view) ---------- */
    function buildCustomView() {
        $panel.empty();
        var hsv = hexToHsv(normHex(opts.value) || "#2185d0");

        var $sv = $('<div class="of-cp-sv"><div class="of-cp-dot"></div></div>');
        var $hue = $('<div class="of-cp-hue"><div class="of-cp-dot"></div></div>');
        var $hexrow = $('<div class="of-cp-hexrow">' +
            '<div class="of-cp-preview"></div>' +
            '<input type="text" class="of-cp-hex" maxlength="7" spellcheck="false">' +
            '</div>');
        var $actions = $('<div class="of-cp-actions">' +
            '<button type="button" class="of-cp-btn of-cp-back">Back</button>' +
            '<button type="button" class="of-cp-btn of-cp-ok">OK</button></div>');
        $panel.append($sv).append($hue).append($hexrow).append($actions);

        function currentHex() { return hsvToHex(hsv.h, hsv.s, hsv.v); }
        function sync(skipHexField) {
            $sv.css("background",
                "linear-gradient(to top, #000, transparent)," +
                "linear-gradient(to right, #fff, hsl(" + Math.round(hsv.h) + ",100%,50%))");
            $sv.find(".of-cp-dot").css({
                left: (hsv.s * 100) + "%",
                top: ((1 - hsv.v) * 100) + "%"
            });
            $hue.find(".of-cp-dot").css({ left: (hsv.h / 360 * 100) + "%", top: "50%" });
            var hex = currentHex();
            $hexrow.find(".of-cp-preview").css("background", hex);
            if (!skipHexField) $hexrow.find(".of-cp-hex").val(hex);
        }
        function dragTrack($el, onMove) {
            $el.on("pointerdown", function (e) {
                e.preventDefault();
                var el = this;
                try { el.setPointerCapture(e.pointerId); } catch (err) { }
                var move = function (ev) {
                    var r = el.getBoundingClientRect();
                    onMove(
                        Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)),
                        Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)));
                    sync();
                };
                move(e.originalEvent || e);
                $el.on("pointermove.ofcpdrag", function (ev) { move(ev.originalEvent || ev); });
                $el.one("pointerup pointercancel", function () { $el.off("pointermove.ofcpdrag"); });
            });
        }
        dragTrack($sv, function (fx, fy) { hsv.s = fx; hsv.v = 1 - fy; });
        dragTrack($hue, function (fx) { hsv.h = fx * 360; });

        $hexrow.find(".of-cp-hex").on("input", function () {
            var hex = normHex(this.value);
            if (hex) { hsv = hexToHsv(hex); sync(true); }
        }).on("keydown", function (e) {
            if (e.key === "Enter") { e.preventDefault(); $actions.find(".of-cp-ok").trigger("click"); }
            e.stopPropagation();   // hosts bind global keydown handlers
        });
        $actions.find(".of-cp-back").on("click", buildPaletteView);
        $actions.find(".of-cp-ok").on("click", function () {
            var hex = currentHex();
            addCustom(hex);
            pick(hex);
        });
        sync();
        clampToViewport();
    }

    /* ---------- open / close / position ---------- */
    function clampToViewport() {
        if (!$panel) return;
        var w = $panel.outerWidth(), h = $panel.outerHeight();
        var x = parseFloat($panel.css("left")), y = parseFloat($panel.css("top"));
        if (x + w > window.innerWidth - 4) x = window.innerWidth - w - 4;
        if (y + h > window.innerHeight - 4) {
            // flip above the anchor when there is no room below
            var ar = anchorNode && anchorNode.getBoundingClientRect ?
                anchorNode.getBoundingClientRect() : null;
            y = ar ? Math.max(4, ar.top - h - 4) : Math.max(4, window.innerHeight - h - 4);
        }
        if (x < 4) x = 4;
        if (y < 4) y = 4;
        $panel.css({ left: x + "px", top: y + "px" });
    }
    function open(options) {
        close();
        opts = options || {};
        anchorNode = opts.anchor || null;
        var x = opts.x, y = opts.y;
        if (anchorNode && anchorNode.getBoundingClientRect) {
            var r = anchorNode.getBoundingClientRect();
            x = r.left;
            y = r.bottom + 4;
        }
        $panel = $('<div class="of-cp-panel of-noprint"></div>')
            .css({ left: (x || 0) + "px", top: (y || 0) + "px" });
        guardFocus($panel);
        $("body").append($panel);
        buildPaletteView();
        // close on any press outside the panel (deferred so the opening
        // click itself does not immediately dismiss it)
        setTimeout(function () {
            $(document).on("pointerdown.ofcp", function (e) {
                if ($panel && !$panel[0].contains(e.target)) close();
            });
            $(document).on("keydown.ofcp", function (e) {
                if (e.key === "Escape") close();
            });
        }, 0);
    }
    function close() {
        if ($panel) { $panel.remove(); $panel = null; }
        $(document).off("pointerdown.ofcp keydown.ofcp");
        opts = null;
        anchorNode = null;
    }

    /* ---------- <input type="color"> drop-in replacement ---------- */
    function swatchInput(o) {
        o = o || {};
        var $btn = $('<button type="button" class="of-cp-swatchbtn"><span class="of-cp-chip"></span></button>');
        if (o.id) $btn.attr("id", o.id);
        if (o.title) $btn.attr("title", o.title);
        if (o.className) $btn.addClass(o.className);
        function paint() {
            var v = $btn.val();
            $btn.find(".of-cp-chip").css("background", v || "transparent")
                .toggleClass("none", !v);
        }
        $btn.val(o.value || "#000000");
        paint();
        // keep the host's text selection alive
        $btn.on("mousedown", function (e) { e.preventDefault(); });
        $btn.on("click", function () {
            open({
                anchor: $btn[0],
                value: $btn.val(),
                allowNone: !!o.allowNone,
                noneLabel: o.noneLabel,
                onPick: function (hex) {
                    $btn.val(hex);
                    paint();
                    // fire both events so existing input[type=color]
                    // handlers keep working unchanged
                    $btn.trigger("input").trigger("change");
                }
            });
        });
        // repaint when a host sets the value programmatically via .val()
        $btn.on("of-cp-refresh", paint);
        return $btn;
    }

    return {
        open: open,
        close: close,
        isOpen: function () { return !!$panel; },
        contains: function (node) { return !!($panel && node && $panel[0].contains(node)); },
        swatchInput: swatchInput,
        normHex: normHex
    };
})();
