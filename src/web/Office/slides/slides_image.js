/*
    ArozOS Office - Slides picture tools
    ====================================
    Everything that acts on a selected picture, kept out of slides.js so
    that file stays about the document and the canvas:

      - the floating picture bar, the same shape as the text-edit bar but
        anchored to a selected image: crop, reset, format options
      - the shape grid: the crop shapes drawn as icons rather than listed
        as names, shared by the bar and the toolbar's crop button
      - the format panel: a docked side panel for size, position, rotation,
        alignment, re-colour and the brightness / contrast / transparency
        adjustments

    slides.js owns the document, so this module never touches the model
    directly - it asks through the host object passed to init():

        SlidesImageTools.init({
            getImage: fn -> the lone selected image object, or null,
            objEl:    fn(id) -> its DOM element,
            commit:   fn,                    // model changed, redraw + undo
            startCrop: fn(id), endCrop: fn(apply), isCropping: fn -> bool,
            resetImage: fn(obj), setMask: fn(obj, kind),
            shapeKinds: [{kind,label}],
            slideSize: [w,h], relayout: fn
        });

    and the host drives it with sync() / hide() / reposition().
*/

var SlidesImageTools = (function () {
    "use strict";

    var host = null;
    var $bar = null;
    var $panel = null;
    var barObjId = null;

    /* Re-colour presets. Each is a CSS filter chain, and the swatches in
       the panel show the picture itself through that filter, so what is
       previewed is exactly what is applied. The tint recipe (grayscale,
       then sepia as a colour base, then rotate the hue) is the standard
       way to wash an arbitrary photo into one hue with plain CSS. */
    var RECOLORS = [
        { key: "", label: "No recolour", filter: "" },
        { key: "gray", label: "Greyscale", filter: "grayscale(1)" },
        { key: "sepia", label: "Sepia", filter: "sepia(1)" },
        { key: "washout", label: "Washed out", filter: "grayscale(0.4) brightness(1.35) contrast(0.7)" },
        { key: "blue-light", label: "Light blue", filter: tint(210, 0.55, 1.25) },
        { key: "blue-dark", label: "Dark blue", filter: tint(215, 1.1, 0.7) },
        { key: "teal", label: "Teal", filter: tint(175, 1.0, 0.95) },
        { key: "green", label: "Green", filter: tint(105, 0.95, 0.95) },
        { key: "lime", label: "Lime", filter: tint(75, 1.3, 1.15) },
        { key: "yellow", label: "Yellow", filter: tint(45, 1.4, 1.15) },
        { key: "orange", label: "Orange", filter: tint(15, 1.3, 1.0) },
        { key: "red", label: "Red", filter: tint(345, 1.2, 0.9) },
        { key: "purple", label: "Purple", filter: tint(265, 0.9, 0.9) },
        { key: "pink", label: "Pink", filter: tint(315, 0.9, 1.15) },
        { key: "black-white", label: "Black and white", filter: "grayscale(1) contrast(2.6) brightness(1.05)" },
        { key: "negative", label: "Negative", filter: "invert(1)" }
    ];
    // hue is where the wash lands, sat how strong it is, bright how light
    function tint(hue, sat, bright) {
        return "grayscale(1) sepia(1) hue-rotate(" + (hue - 40) + "deg) " +
            "saturate(" + sat + ") brightness(" + bright + ")";
    }
    function recolorByKey(key) {
        for (var i = 0; i < RECOLORS.length; i++) {
            if (RECOLORS[i].key === (key || "")) return RECOLORS[i];
        }
        return RECOLORS[0];
    }

    /* imageFilter is the single place that turns a picture's re-colour and
       adjustments into CSS, so the canvas, the thumbnails, present mode and
       the panel's own swatches all agree. Exported for slides.js to use
       while rendering. */
    function imageFilter(p) {
        var parts = [];
        var rc = recolorByKey(p.recolor);
        if (rc.filter) parts.push(rc.filter);
        var b = Number(p.bright) || 0;
        var c = Number(p.contrast) || 0;
        if (b) parts.push("brightness(" + (1 + clamp(b, -0.9, 2)) + ")");
        if (c) parts.push("contrast(" + (1 + clamp(c, -0.9, 2)) + ")");
        return parts.join(" ");
    }

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function esc(t) { return OfficeApp.escapeHtml(t); }
    function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }

    /* ================= shape grid ================= */

    // shapeIcon draws one crop shape as a small outline. The catalogue draws
    // it, from the very same geometry the canvas uses, so the icon cannot
    // drift from the mask it stands for.
    function shapeIcon(kind, size) {
        return SlidesShapes.icon(kind || "rect", size || 22);
    }

    /* showShapeMenu opens the crop-shape picker under an element. The
       shapes are icons in a grid rather than a list of names, because the
       outline is the thing being chosen. */
    function showShapeMenu(anchorEl) {
        closeShapeMenu();
        if (!host) return;
        var o = host.getImage();
        if (!o) return;
        var $m = $('<div class="sl-shapegrid of-noprint"></div>');
        var $none = $('<button type="button" class="sl-shapegrid-none"></button>')
            .append($(shapeIcon("rect")))
            .append($("<span></span>").text("No shape (rectangle)"));
        if (!o.props.mask) $none.addClass("active");
        $none.on("click", function () { closeShapeMenu(); host.setMask(o, ""); });
        $m.append($none);

        var $grid = $('<div class="sl-shapegrid-cells"></div>');
        host.shapeKinds.forEach(function (s) {
            if (s.kind === "rect") return;
            var $b = $('<button type="button" class="sl-shapegrid-cell"></button>')
                .attr("title", s.label)
                .html(shapeIcon(s.kind));
            if (o.props.mask === s.kind) $b.addClass("active");
            $b.on("click", function () { closeShapeMenu(); host.setMask(o, s.kind); });
            $grid.append($b);
        });
        $m.append($grid);
        $("body").append($m);

        var r = anchorEl.getBoundingClientRect();
        var w = $m.outerWidth(), h = $m.outerHeight();
        var x = Math.min(r.left, window.innerWidth - w - 6);
        var y = r.bottom + 4;
        if (y + h > window.innerHeight - 6) y = Math.max(6, r.top - h - 4);
        $m.css({ left: Math.max(6, x) + "px", top: y + "px" });
        setTimeout(function () {
            $(document).on("mousedown.slshapegrid", function (e) {
                if (!$m[0].contains(e.target)) closeShapeMenu();
            });
        }, 0);
    }
    function closeShapeMenu() {
        $(".sl-shapegrid").remove();
        $(document).off("mousedown.slshapegrid");
    }

    /* ================= floating picture bar ================= */

    function barBtn(icon, title, fn) {
        var $b = $('<button type="button" class="of-te-btn" title="' + esc(title) + '">' +
            '<i class="' + icon + ' icon"></i></button>');
        $b.on("mousedown", function (e) { e.preventDefault(); });
        $b.on("click", fn);
        return $b;
    }

    function buildBar() {
        $bar = $('<div class="of-textedit-bar sl-imagebar of-noprint"></div>');
        var $row = $('<div class="of-te-row"></div>');
        $bar.append($row);

        $row.append($('<span class="sl-imagebar-label"></span>')
            .append('<i class="image outline icon"></i>')
            .append(document.createTextNode("Edit image")));
        $row.append('<div class="of-te-sep"></div>');

        // crop and the crop shapes are one control: the button crops, the
        // caret beside it picks the shape to crop to
        var $crop = barBtn("crop", "Crop image", function () {
            var o = host.getImage();
            if (!o) return;
            if (host.isCropping()) host.endCrop(true); else host.startCrop(o.id);
        });
        $crop.addClass("sl-imagebar-crop");
        $row.append($crop);
        var $caret = barBtn("caret down", "Crop to shape", function (e) {
            showShapeMenu(e.currentTarget);
        });
        $caret.addClass("sl-imagebar-caret");
        $row.append($caret);

        $row.append(barBtn("history", "Reset image (clear crop, shape and colour)", function () {
            var o = host.getImage();
            if (o) host.resetImage(o);
        }));
        $row.append('<div class="of-te-sep"></div>');
        var $fmt = barBtn("sliders horizontal", "Format options", function () {
            togglePanel();
        });
        $fmt.addClass("sl-imagebar-fmt");
        $row.append($fmt);

        $("body").append($bar);
    }

    function syncBarState() {
        if (!$bar) return;
        $bar.find(".sl-imagebar-crop").toggleClass("active", !!host.isCropping());
        $bar.find(".sl-imagebar-fmt").toggleClass("active", !!$panel);
    }

    function reposition() {
        if (!$bar || !host) return;
        var o = host.getImage();
        var el = o ? host.objEl(o.id) : null;
        if (!el) { hideBar(); return; }
        var r = el.getBoundingClientRect();
        var w = $bar.outerWidth(), h = $bar.outerHeight();
        var x = r.left + (r.width - w) / 2;
        // below the picture by default, like the reference: the space above
        // is usually where the slide's own content is
        var y = r.bottom + 8;
        if (y + h > window.innerHeight - 4) y = Math.max(4, r.top - h - 8);
        if (x + w > window.innerWidth - 4) x = window.innerWidth - w - 4;
        if (x < 4) x = 4;
        $bar.css({ left: x + "px", top: y + "px" });
    }

    function hideBar() {
        if ($bar) { $bar.remove(); $bar = null; }
        barObjId = null;
        closeShapeMenu();
    }

    /* sync is called whenever the selection or the document changes: it
       shows the bar for a lone picture and takes it away otherwise */
    function sync() {
        if (!host) return;
        var o = host.getImage();
        if (!o) {
            hideBar();
            if ($panel) renderPanel();
            return;
        }
        if (!$bar) buildBar();
        barObjId = o.id;
        syncBarState();
        reposition();
        if ($panel) renderPanel();
    }

    /* ================= format panel ================= */

    function togglePanel() {
        if (!host) return;
        if ($panel) closePanel(); else openPanel();
    }
    function openPanel() {
        if ($panel) return;
        $panel = $('<div id="slFormatPanel" class="of-noprint"></div>');
        $("#slMain").after($panel);
        renderPanel();
        syncBarState();
        if (host.relayout) host.relayout();
    }
    function closePanel() {
        if (!$panel) return;
        $panel.remove();
        $panel = null;
        syncBarState();
        if (host.relayout) host.relayout();
    }

    function section(title, key, $body) {
        var open = OfficeApp.getSetting("fmtSection." + key, true);
        var $s = $('<div class="sl-fp-section"></div>').toggleClass("closed", !open);
        var $h = $('<div class="sl-fp-head"><i class="chevron down icon"></i><span></span></div>');
        $h.find("span").text(title);
        $h.on("click", function () {
            var nowClosed = $s.toggleClass("closed").hasClass("closed");
            OfficeApp.setSetting("fmtSection." + key, !nowClosed);
        });
        return $s.append($h).append($('<div class="sl-fp-body"></div>').append($body));
    }

    // numField builds a labelled number input that writes straight through
    // to the model, committing on change
    function numField(label, unit, get, set, opts) {
        opts = opts || {};
        var $w = $('<div class="sl-fp-field"></div>');
        $w.append($("<label></label>").text(label));
        var $row = $('<div class="sl-fp-inputrow"></div>');
        var $i = $('<input type="number" class="sl-fp-num">')
            .attr("step", opts.step || 1).val(get());
        if (opts.min !== undefined) $i.attr("min", opts.min);
        if (opts.max !== undefined) $i.attr("max", opts.max);
        $i.on("change", function () { set(num($i.val(), get())); });
        $row.append($i);
        if (unit) $row.append($('<span class="sl-fp-unit"></span>').text(unit));
        return $w.append($row);
    }

    function slider(label, get, set) {
        var $w = $('<div class="sl-fp-field"></div>');
        var $lab = $("<label></label>").text(label);
        $w.append($lab);
        var $i = $('<input type="range" class="sl-fp-range" min="-90" max="100" step="1">')
            .val(Math.round(get() * 100));
        var $val = $('<span class="sl-fp-unit"></span>').text(Math.round(get() * 100) + "%");
        $i.on("input", function () { $val.text($i.val() + "%"); });
        $i.on("change", function () { set(num($i.val(), 0) / 100); });
        return $w.append($('<div class="sl-fp-inputrow"></div>').append($i).append($val));
    }

    function renderPanel() {
        if (!$panel || !host) return;
        $panel.empty();
        var $head = $('<div class="sl-fp-title"><i class="sliders horizontal icon"></i>' +
            "<span>Format options</span></div>");
        $head.append($('<button type="button" class="sl-fp-close" title="Close">' +
            '<i class="times icon"></i></button>').on("click", closePanel));
        $panel.append($head);

        var o = host.getImage();
        if (!o) {
            $panel.append('<div class="sl-fp-empty">Select a picture to see its ' +
                "format options.</div>");
            return;
        }
        var p = o.props;
        // commit() calls back into sync(), which re-renders this panel,
        // so reading the fresh values back is not this function's job
        var apply = function () { host.commit(); };

        /* ---- size and rotation ---- */
        var $size = $("<div></div>");
        var $grid = $('<div class="sl-fp-grid"></div>');
        $grid.append(numField("Width", "px", function () { return Math.round(o.w); },
            function (v) {
                v = Math.max(4, v);
                if (p.lockAspect && o.w > 0) o.h = Math.max(4, o.h * v / o.w);
                o.w = v;
                apply();
            }));
        $grid.append(numField("Height", "px", function () { return Math.round(o.h); },
            function (v) {
                v = Math.max(4, v);
                if (p.lockAspect && o.h > 0) o.w = Math.max(4, o.w * v / o.h);
                o.h = v;
                apply();
            }));
        $size.append($grid);
        var $lock = $('<label class="sl-fp-check"><input type="checkbox"> ' +
            "<span>Lock aspect ratio</span></label>");
        $lock.find("input").prop("checked", !!p.lockAspect).on("change", function () {
            p.lockAspect = this.checked;
            if (!p.lockAspect) delete p.lockAspect;
            host.commit();
        });
        $size.append($lock);

        var $rot = $('<div class="sl-fp-grid"></div>');
        $rot.append(numField("Angle", "deg", function () { return Math.round(o.rot || 0); },
            function (v) { o.rot = ((v % 360) + 360) % 360; apply(); }, { min: 0, max: 359 }));
        var $flips = $('<div class="sl-fp-field"><label>Rotate / flip</label></div>');
        var $frow = $('<div class="sl-fp-inputrow"></div>');
        $frow.append(iconBtn("redo", "Rotate 90 degrees", function () {
            o.rot = (((o.rot || 0) + 90) % 360); apply();
        }));
        $frow.append(iconBtn("arrows alternate horizontal", "Flip horizontally", function () {
            p.flipH = !p.flipH; if (!p.flipH) delete p.flipH; apply();
        }, !!p.flipH));
        $frow.append(iconBtn("arrows alternate vertical", "Flip vertically", function () {
            p.flipV = !p.flipV; if (!p.flipV) delete p.flipV; apply();
        }, !!p.flipV));
        $rot.append($flips.append($frow));
        $size.append($rot);
        $panel.append(section("Size and rotation", "size", $size));

        /* ---- position and alignment ---- */
        var $pos = $("<div></div>");
        var $pgrid = $('<div class="sl-fp-grid"></div>');
        $pgrid.append(numField("X", "px", function () { return Math.round(o.x); },
            function (v) { o.x = v; apply(); }));
        $pgrid.append(numField("Y", "px", function () { return Math.round(o.y); },
            function (v) { o.y = v; apply(); }));
        $pos.append($pgrid);
        var $al = $('<div class="sl-fp-field"><label>Align to slide</label></div>');
        var $arow = $('<div class="sl-fp-inputrow"></div>');
        [["align left", "Left", function () { o.x = 0; }],
         ["align center", "Centre", function () { o.x = (host.slideSize[0] - o.w) / 2; }],
         ["align right", "Right", function () { o.x = host.slideSize[0] - o.w; }],
         ["angle up", "Top", function () { o.y = 0; }],
         ["minus", "Middle", function () { o.y = (host.slideSize[1] - o.h) / 2; }],
         ["angle down", "Bottom", function () { o.y = host.slideSize[1] - o.h; }]
        ].forEach(function (a) {
            $arow.append(iconBtn(a[0], a[1], function () { a[2](); apply(); }));
        });
        $pos.append($al.append($arow));
        $panel.append(section("Position", "pos", $pos));

        /* ---- re-colour ---- */
        var $rc = $('<div class="sl-fp-swatches"></div>');
        RECOLORS.forEach(function (r) {
            var $b = $('<button type="button" class="sl-fp-swatch"></button>').attr("title", r.label);
            $b.append($('<img alt="">').attr("src", p.src || "").css("filter", r.filter || "none"));
            $b.append($("<span></span>").text(r.label));
            if ((p.recolor || "") === r.key) $b.addClass("active");
            $b.on("click", function () {
                if (r.key) p.recolor = r.key; else delete p.recolor;
                apply();
            });
            $rc.append($b);
        });
        $panel.append(section("Re-colour", "recolor", $rc));

        /* ---- adjustments ---- */
        var $adj = $("<div></div>");
        $adj.append(slider("Transparency", function () {
            return p.opacity ? 1 - clamp(Number(p.opacity), 0, 1) : 0;
        }, function (v) {
            v = clamp(v, 0, 1);
            if (v <= 0.001) delete p.opacity; else p.opacity = Math.round((1 - v) * 1000) / 1000;
            apply();
        }));
        $adj.append(slider("Brightness", function () { return Number(p.bright) || 0; },
            function (v) {
                if (Math.abs(v) < 0.005) delete p.bright; else p.bright = v;
                apply();
            }));
        $adj.append(slider("Contrast", function () { return Number(p.contrast) || 0; },
            function (v) {
                if (Math.abs(v) < 0.005) delete p.contrast; else p.contrast = v;
                apply();
            }));
        $panel.append(section("Adjustments", "adjust", $adj));
    }

    function iconBtn(icon, title, fn, active) {
        var $b = $('<button type="button" class="sl-fp-iconbtn" title="' + esc(title) + '">' +
            '<i class="' + icon + ' icon"></i></button>');
        if (active) $b.addClass("active");
        $b.on("click", fn);
        return $b;
    }

    /* ================= public ================= */
    function init(h) {
        host = h;
        $(window).on("resize.slimagebar", function () { reposition(); });
    }

    return {
        init: init,
        sync: sync,
        hide: function () { hideBar(); closeShapeMenu(); },
        reposition: reposition,
        syncState: syncBarState,
        togglePanel: togglePanel,
        panelOpen: function () { return !!$panel; },
        showShapeMenu: showShapeMenu,
        shapeIcon: shapeIcon,
        imageFilter: imageFilter,
        recolorFilter: function (key) { return recolorByKey(key).filter; },
        recolors: RECOLORS
    };
})();
