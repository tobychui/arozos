/*
    ArozOS Office - drawing canvas (common/sketch.js)
    =================================================
    The Draw tab of Docs and Slides: a freehand drawing pad in a dialog
    (pens, highlighters, an eraser, undo), inserted into the document as a
    picture - a transparent PNG cropped to what was drawn, rendered at twice
    the size it is shown so it stays crisp when printed. A picture is what
    every format the suite writes can hold, which is why the strokes are not
    kept as vectors.

        OfficeSketch.open({
            title: "Drawing",
            pen: "pen-red",              // a PENS id to start with (optional)
            aspect: 9 / 16,              // canvas height / width (optional)
            onInsert: function (blob, w, h) { ... }   // PNG, its size in CSS px
        });
        OfficeSketch.PENS                // the presets the ribbon shows
        OfficeSketch.penIcon(pen)        // an SVG of that pen, for a button
*/
var OfficeSketch = (function () {
    "use strict";

    var PENS = [
        { id: "pen-black", kind: "pen", color: "#202124", width: 3, label: "Pen" },
        { id: "pen-red", kind: "pen", color: "#d0342c", width: 3, label: "Red pen" },
        { id: "pen-blue", kind: "pen", color: "#1a73e8", width: 3, label: "Blue pen" },
        { id: "pen-green", kind: "pen", color: "#188038", width: 3, label: "Green pen" },
        { id: "marker-yellow", kind: "marker", color: "#ffd400", width: 16, label: "Highlighter" },
        { id: "marker-green", kind: "marker", color: "#5ce07a", width: 16, label: "Green highlighter" }
    ];
    var WIDTHS = [1, 2, 3, 5, 8, 12, 16, 24];
    var MARKER_ALPHA = 0.45;

    function esc(t) { return OfficeApp.escapeHtml(t); }
    function penById(id) {
        for (var i = 0; i < PENS.length; i++) if (PENS[i].id === id) return PENS[i];
        return PENS[0];
    }
    function penIcon(p) {
        if (p.kind === "marker") {
            return '<svg class="of-ic" viewBox="0 0 24 24" aria-hidden="true">' +
                '<path d="M15 3l6 6-8.5 8.5-6-6z"/><path d="M6.5 11.5 4 18l2 2 6.5-2.5"/>' +
                '<path d="M3 21.5h9" stroke="' + p.color + '" stroke-width="3" opacity=".8"/></svg>';
        }
        return '<svg class="of-ic" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M4 20l1.4-5.2L16 4.2l3.8 3.8L9.2 18.6z"/><path d="M13.5 6.7l3.8 3.8"/>' +
            '<path d="M4 20l1.4-5.2 3.8 3.8z" fill="' + p.color + '" stroke="' + p.color + '"/></svg>';
    }

    /* ---------- drawing ---------- */
    function drawStroke(ctx, s) {
        var p = s.pts;
        if (!p.length) return;
        ctx.save();
        ctx.globalAlpha = s.kind === "marker" ? MARKER_ALPHA : 1;
        ctx.strokeStyle = s.color;
        ctx.fillStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.lineCap = s.kind === "marker" ? "square" : "round";
        ctx.lineJoin = "round";
        if (p.length === 1) {
            ctx.beginPath();
            ctx.arc(p[0][0], p[0][1], s.width / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            return;
        }
        // a quadratic through the midpoints: smooth, and it still passes
        // close to every sample
        ctx.beginPath();
        ctx.moveTo(p[0][0], p[0][1]);
        for (var i = 1; i < p.length - 1; i++) {
            var mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
            ctx.quadraticCurveTo(p[i][0], p[i][1], mx, my);
        }
        var last = p[p.length - 1];
        ctx.lineTo(last[0], last[1]);
        ctx.stroke();
        ctx.restore();
    }
    function bounds(strokes) {
        var b = null;
        strokes.forEach(function (s) {
            var r = s.width / 2 + 2;
            s.pts.forEach(function (q) {
                if (!b) b = { x1: q[0] - r, y1: q[1] - r, x2: q[0] + r, y2: q[1] + r };
                b.x1 = Math.min(b.x1, q[0] - r);
                b.y1 = Math.min(b.y1, q[1] - r);
                b.x2 = Math.max(b.x2, q[0] + r);
                b.y2 = Math.max(b.y2, q[1] + r);
            });
        });
        return b;
    }
    function hits(s, x, y, r) {
        var lim = r + s.width / 2;
        for (var i = 0; i < s.pts.length; i++) {
            var dx = s.pts[i][0] - x, dy = s.pts[i][1] - y;
            if (dx * dx + dy * dy <= lim * lim) return true;
            if (i > 0) {
                // the segment between two samples, for fast strokes
                var ax = s.pts[i - 1][0], ay = s.pts[i - 1][1];
                var bx = s.pts[i][0], by = s.pts[i][1];
                var vx = bx - ax, vy = by - ay;
                var len = vx * vx + vy * vy;
                if (len > 0) {
                    var t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / len));
                    var px = ax + t * vx - x, py = ay + t * vy - y;
                    if (px * px + py * py <= lim * lim) return true;
                }
            }
        }
        return false;
    }

    /* ---------- the dialog ---------- */
    function open(o) {
        o = o || {};
        var start = penById(o.pen);
        var tool = { kind: start.kind, color: start.color, width: start.width, eraser: false };
        var penId = start.id;     // the preset in hand, "" for a custom colour
        var strokes = [];
        var history = [[]], hpos = 0;
        var cur = null;

        var vw = Math.min(800, Math.max(260, window.innerWidth * 0.94 - 40));
        var cw = Math.round(vw);
        var ch = Math.round(Math.min(window.innerHeight * 0.6, cw * (o.aspect || 0.56)));
        var dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));

        var $b = $('<div class="of-sketch"></div>');
        var $bar = $('<div class="of-sketch-bar"></div>');
        var $pens = $('<div class="of-sketch-pens"></div>');
        PENS.forEach(function (p) {
            var $p = $('<button type="button" class="of-tbtn of-sketch-pen"></button>')
                .attr("title", p.label).attr("data-pen", p.id).html(penIcon(p));
            $p.on("click", function () {
                tool = { kind: p.kind, color: p.color, width: p.width, eraser: false };
                $color.val(p.color).trigger("of-cp-refresh");
                $width.val(String(p.width));
                penId = p.id;
                syncBar();
            });
            $pens.append($p);
        });
        var $eraser = $('<button type="button" class="of-tbtn" title="Eraser - removes whole strokes"><i class="eraser icon"></i></button>');
        $eraser.on("click", function () { tool.eraser = !tool.eraser; syncBar(); });
        var $color = OfficeColorPicker.swatchInput({ title: "Ink colour", value: start.color });
        $color.on("change", function () {
            tool.color = $color.val() || tool.color;
            tool.eraser = false;
            penId = "";
            syncBar();
        });
        var $width = $('<select class="of-tselect" title="Thickness"></select>');
        WIDTHS.forEach(function (w) { $width.append($("<option></option>").attr("value", w).text(w + " px")); });
        if (WIDTHS.indexOf(start.width) < 0) $width.append($("<option></option>").attr("value", start.width).text(start.width + " px"));
        $width.val(String(start.width));
        $width.on("change", function () { tool.width = parseInt($width.val(), 10) || 3; });
        var $undo = $('<button type="button" class="of-tbtn" title="Undo"><i class="undo icon"></i></button>');
        var $redo = $('<button type="button" class="of-tbtn" title="Redo"><i class="redo icon"></i></button>');
        var $clear = $('<button type="button" class="of-tbtn" title="Clear"><i class="trash alternate outline icon"></i></button>');
        $bar.append($pens).append('<span class="of-tsep"></span>').append($eraser)
            .append('<span class="of-tsep"></span>').append($color).append($width)
            .append('<span class="of-tsep"></span>').append($undo).append($redo).append($clear);
        $b.append($bar);

        var $wrap = $('<div class="of-sketch-paper"></div>').css({ width: cw + "px", height: ch + "px" });
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
        canvas.style.width = cw + "px";
        canvas.style.height = ch + "px";
        $wrap.append(canvas);
        $b.append($wrap);
        $b.append('<div class="of-dim">Draw with the mouse, a pen or a finger. The drawing is inserted as a picture, trimmed to what you drew.</div>');
        var ctx = canvas.getContext("2d");

        function redraw() {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, cw, ch);
            strokes.forEach(function (s) { drawStroke(ctx, s); });
            if (cur) drawStroke(ctx, cur);
        }
        function syncBar() {
            $pens.find(".of-sketch-pen").removeClass("active");
            if (penId && !tool.eraser) $pens.find('[data-pen="' + penId + '"]').addClass("active");
            $eraser.toggleClass("active", tool.eraser);
            $wrap.toggleClass("erasing", tool.eraser);
            $undo.prop("disabled", hpos === 0);
            $redo.prop("disabled", hpos >= history.length - 1);
            $clear.prop("disabled", strokes.length === 0);
        }
        function remember() {
            history = history.slice(0, hpos + 1);
            history.push(strokes.slice());
            hpos = history.length - 1;
            syncBar();
        }
        $undo.on("click", function () {
            if (hpos === 0) return;
            hpos--;
            strokes = history[hpos].slice();
            redraw();
            syncBar();
        });
        $redo.on("click", function () {
            if (hpos >= history.length - 1) return;
            hpos++;
            strokes = history[hpos].slice();
            redraw();
            syncBar();
        });
        $clear.on("click", function () {
            if (!strokes.length) return;
            strokes = [];
            redraw();
            remember();
        });

        function at(e) {
            var r = canvas.getBoundingClientRect();
            return [(e.clientX - r.left) * cw / r.width, (e.clientY - r.top) * ch / r.height];
        }
        var erasedAny = false;
        function eraseAt(q) {
            var keep = strokes.filter(function (s) { return !hits(s, q[0], q[1], 6); });
            if (keep.length !== strokes.length) {
                strokes = keep;
                erasedAny = true;
                redraw();
            }
        }
        canvas.addEventListener("pointerdown", function (e) {
            if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
            e.preventDefault();
            try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
            var q = at(e);
            if (tool.eraser || e.button === 5) {
                erasedAny = false;
                cur = { erasing: true, pts: [] };
                eraseAt(q);
                return;
            }
            cur = { kind: tool.kind, color: tool.color, width: tool.width, pts: [q] };
            redraw();
        });
        canvas.addEventListener("pointermove", function (e) {
            if (!cur) return;
            e.preventDefault();
            var list = (e.getCoalescedEvents && e.getCoalescedEvents()) || [e];
            if (!list.length) list = [e];
            if (cur.erasing) {
                list.forEach(function (ev) { eraseAt(at(ev)); });
                return;
            }
            list.forEach(function (ev) {
                var q = at(ev), last = cur.pts[cur.pts.length - 1];
                var dx = q[0] - last[0], dy = q[1] - last[1];
                if (dx * dx + dy * dy >= 0.6) cur.pts.push(q);
            });
            redraw();
        });
        var finish = function () {
            if (!cur) return;
            if (cur.erasing) {
                cur = null;
                if (erasedAny) remember();
                return;
            }
            strokes.push(cur);
            cur = null;
            redraw();
            remember();
        };
        canvas.addEventListener("pointerup", finish);
        canvas.addEventListener("pointercancel", finish);

        function insert(close) {
            var bb = bounds(strokes);
            if (!bb) {
                OfficeApp.toast("Draw something first", "error");
                return;
            }
            var x1 = Math.max(0, Math.floor(bb.x1)), y1 = Math.max(0, Math.floor(bb.y1));
            var w = Math.max(1, Math.ceil(Math.min(cw, bb.x2) - x1));
            var h = Math.max(1, Math.ceil(Math.min(ch, bb.y2) - y1));
            var S = 2;
            var out = document.createElement("canvas");
            out.width = w * S;
            out.height = h * S;
            var octx = out.getContext("2d");
            octx.setTransform(S, 0, 0, S, -x1 * S, -y1 * S);
            strokes.forEach(function (s) { drawStroke(octx, s); });
            out.toBlob(function (blob) {
                if (!blob) { OfficeApp.toast("The drawing could not be made into a picture", "error"); return; }
                close();
                if (o.onInsert) o.onInsert(blob, w, h);
            }, "image/png");
        }

        OfficeApp.dialog({
            title: o.title || "Drawing",
            body: $b,
            wide: true,
            dismissable: false,
            buttons: [
                { label: "Cancel" },
                { label: o.insertLabel || "Insert", primary: true, action: function (close) { insert(close); } }
            ]
        });
        syncBar();
        redraw();
    }

    return { open: open, PENS: PENS, penIcon: penIcon, penById: penById };
})();
