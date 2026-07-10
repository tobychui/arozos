/*
    ArozOS Office - Slides editor
    ==============================================================
    Body schema (what serialize() returns / deserialize() receives):

    {
        size: [960, 540],              // fixed slide coordinate space (16:9)
        theme: "clean",                // key into THEMES
        slides: [
            {
                id: "s-xxxx",
                bg: "#rrggbb" | null,  // null = use theme background
                notes: "speaker notes plain text",
                objects: [
                    {
                        id: "o-xxxx",
                        type: "text" | "image" | "shape" | "line" | "table" | "chart",
                        x, y, w, h,    // slide units; for "line" w/h is the
                                       // vector to the 2nd endpoint (may be negative)
                        rot: 0,        // degrees, rotation about center (not lines)
                        z: 1,          // stacking order (mirrors array order)
                        props: { ... } // per type:
                        //  text : { html, fontSize, color, align, bold, italic, underline }
                        //  image: { src, fit: "contain"|"cover"|"fill" }
                        //  shape: { kind: "rect"|"round"|"ellipse"|"triangle"|"diamond"|
                        //                 "arrow"|"star"|"chevron",
                        //           fill, stroke, strokeW, text, textColor, fontSize, bold }
                        //  line : { stroke, strokeW, dash, arrowEnd }
                        //  table: { rows: [["a","b"],...], headerRow, colW?, fontSize, color }
                        //  chart: { spec: <OfficeCharts spec> }
                    }
                ]
            }
        ]
    }
*/

var SlidesApp = (function () {
    "use strict";

    /* ================= constants ================= */
    var SLIDE_W = 960, SLIDE_H = 540;
    var GRID = 10;
    var GUIDE_TOL = 5;

    var THEMES = {
        clean:    { label: "Clean",    bg: "#ffffff", text: "#202124", accent: "#e07b1f" },
        midnight: { label: "Midnight", bg: "linear-gradient(135deg,#232a36 0%,#0b0e13 100%)", text: "#e8eaed", accent: "#4c9be8" },
        ocean:    { label: "Ocean",    bg: "linear-gradient(135deg,#0f4c75 0%,#3282b8 100%)", text: "#f4faff", accent: "#bbe1fa" },
        sunset:   { label: "Sunset",   bg: "linear-gradient(135deg,#c0392b 0%,#8e44ad 100%)", text: "#fdf2ec", accent: "#f8c471" },
        forest:   { label: "Forest",   bg: "linear-gradient(160deg,#0f3d33 0%,#1e6f5c 100%)", text: "#eafaf1", accent: "#7dcea0" },
        paper:    { label: "Paper",    bg: "#f6f1e5", text: "#3d3a33", accent: "#8e44ad" }
    };

    var TYPE_NAMES = {
        text: "Text box", image: "Image", shape: "Shape",
        line: "Line", table: "Table", chart: "Chart"
    };

    var SHAPE_KINDS = [
        { kind: "rect",     label: "Rectangle" },
        { kind: "round",    label: "Rounded rectangle" },
        { kind: "ellipse",  label: "Ellipse" },
        { kind: "triangle", label: "Triangle" },
        { kind: "diamond",  label: "Diamond" },
        { kind: "arrow",    label: "Arrow" },
        { kind: "star",     label: "Star" },
        { kind: "chevron",  label: "Chevron" }
    ];

    /* ================= state ================= */
    var body = null;          // document body (see schema above)
    var cur = 0;              // current slide index
    var sel = [];             // selected object ids on the current slide
    var undo = null;          // OfficeUndoStack
    var clip = null;          // internal object clipboard (array of clones)
    var editingId = null;     // object id currently in text-edit mode
    var editingKind = null;   // "text" | "shape" | "table"
    var pendingDraw = null;   // "line" | "arrow" when a draw is armed
    var lastCell = null;      // {r,c} last clicked table cell
    var zoomPct = 100;
    var fitScale = 1;
    var drag = null;          // active pointer interaction
    var rafPending = false;
    var lastPointerEvt = null;
    var thumbTimer = null;
    var snapGrid = false;

    var canvasEl, layerEl, framesEl, guideVEl, guideHEl, marqueeEl;

    /* ================= small utils ================= */
    function esc(t) { return OfficeApp.escapeHtml(t); }
    function deep(o) { return JSON.parse(JSON.stringify(o)); }
    function snap() { return JSON.stringify(body); }
    function genId(p) {
        return (p || "o") + "-" + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
    }
    function aoRoot() { return (typeof ao_root !== "undefined") ? ao_root : "../../"; }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function themeOf() { return THEMES[body && body.theme] || THEMES.clean; }
    function curSlide() { return body.slides[cur]; }
    function objById(id) {
        var objs = curSlide().objects;
        for (var i = 0; i < objs.length; i++) if (objs[i].id === id) return objs[i];
        return null;
    }
    function selObjs() {
        return sel.map(objById).filter(function (o) { return !!o; });
    }
    function curScale() { return fitScale * zoomPct / 100; }
    function contrastText(hex) {
        var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
        if (!m) return "#ffffff";
        var n = parseInt(m[1], 16);
        var lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
        return lum > 160 ? "#202124" : "#ffffff";
    }

    /* ================= document model ================= */
    function newTextObj(html, x, y, w, h, fontSize, align, color) {
        return {
            id: genId(), type: "text", x: x, y: y, w: w, h: h, rot: 0, z: 1,
            props: { html: html, fontSize: fontSize, color: color, align: align || "left" }
        };
    }
    function newSlide(kind) {
        var th = themeOf ? themeOf() : THEMES.clean;
        var textColor = (body ? themeOf() : th).text;
        var s = { id: genId("s"), bg: null, notes: "", objects: [] };
        if (kind === "title") {
            s.objects.push(newTextObj("Presentation title", 80, 190, 800, 90, 44, "center", textColor));
            s.objects.push(newTextObj("Subtitle", 180, 300, 600, 50, 20, "center", textColor));
        } else if (kind === "normal") {
            s.objects.push(newTextObj("Slide title", 50, 34, 860, 66, 32, "left", textColor));
        }
        s.objects.forEach(function (o, i) { o.z = i + 1; });
        return s;
    }
    function defaultBody() {
        var b = { size: [SLIDE_W, SLIDE_H], theme: "clean", slides: [] };
        body = b; // themeOf() needs it while building the first slide
        b.slides.push(newSlide("title"));
        return b;
    }
    function normalizeBody(b) {
        if (!b || typeof b !== "object") b = {};
        b.size = [SLIDE_W, SLIDE_H];
        if (!THEMES[b.theme]) b.theme = "clean";
        if (!Array.isArray(b.slides) || b.slides.length === 0) {
            b.slides = [{ id: genId("s"), bg: null, notes: "", objects: [] }];
        }
        b.slides.forEach(function (s) {
            s.id = s.id || genId("s");
            s.bg = s.bg || null;
            s.notes = typeof s.notes === "string" ? s.notes : "";
            if (!Array.isArray(s.objects)) s.objects = [];
            s.objects = s.objects.filter(function (o) { return o && TYPE_NAMES[o.type]; });
            s.objects.forEach(function (o, i) {
                o.id = o.id || genId();
                o.x = Number(o.x) || 0; o.y = Number(o.y) || 0;
                o.w = Number(o.w) || 0; o.h = Number(o.h) || 0;
                o.rot = Number(o.rot) || 0;
                o.z = i + 1;
                if (!o.props || typeof o.props !== "object") o.props = {};
            });
        });
        return b;
    }

    /* ================= rendering: objects ================= */
    function textStyle(p) {
        var s = "font-size:" + (Number(p.fontSize) || 24) + "px;";
        if (p.color) s += "color:" + esc(p.color) + ";";
        s += "text-align:" + esc(p.align || "left") + ";";
        if (p.bold) s += "font-weight:700;";
        if (p.italic) s += "font-style:italic;";
        if (p.underline) s += "text-decoration:underline;";
        return s;
    }

    function shapePoints(kind, w, h) {
        var pts;
        switch (kind) {
            case "triangle":
                pts = [[w / 2, 0], [w, h], [0, h]]; break;
            case "diamond":
                pts = [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]; break;
            case "arrow":
                pts = [[0, h * 0.3], [w * 0.62, h * 0.3], [w * 0.62, 0], [w, h / 2],
                       [w * 0.62, h], [w * 0.62, h * 0.7], [0, h * 0.7]]; break;
            case "chevron":
                pts = [[0, 0], [w * 0.72, 0], [w, h / 2], [w * 0.72, h], [0, h], [w * 0.28, h / 2]]; break;
            case "star":
                pts = [];
                var cx = w / 2, cy = h / 2, rx = w / 2, ry = h / 2, inner = 0.42;
                for (var i = 0; i < 10; i++) {
                    var ang = -Math.PI / 2 + i * Math.PI / 5;
                    var f = (i % 2 === 0) ? 1 : inner;
                    pts.push([cx + rx * f * Math.cos(ang), cy + ry * f * Math.sin(ang)]);
                }
                break;
            default:
                pts = null;
        }
        return pts;
    }

    function shapeSvg(o) {
        var w = Math.max(4, o.w), h = Math.max(4, o.h);
        var p = o.props;
        var sw = Number(p.strokeW) || 0;
        var attrs = 'fill="' + esc(p.fill || "#e07b1f") + '"' +
            (sw > 0 ? ' stroke="' + esc(p.stroke || "#333333") + '" stroke-width="' + sw + '"' : ' stroke="none"') +
            ' stroke-linejoin="round" vector-effect="non-scaling-stroke"';
        var inner;
        var i = Math.max(1, sw / 2 + 0.5);
        if (o.props.kind === "rect" || o.props.kind === "round" || !o.props.kind) {
            var rx = o.props.kind === "round" ? Math.min(w, h) * 0.15 : 0;
            inner = '<rect x="' + i + '" y="' + i + '" width="' + (w - 2 * i) + '" height="' + (h - 2 * i) +
                '" rx="' + rx + '" ' + attrs + "/>";
        } else if (o.props.kind === "ellipse") {
            inner = '<ellipse cx="' + (w / 2) + '" cy="' + (h / 2) + '" rx="' + (w / 2 - i) + '" ry="' + (h / 2 - i) + '" ' + attrs + "/>";
        } else {
            var pts = shapePoints(o.props.kind, w, h) || [[0, 0], [w, 0], [w, h], [0, h]];
            inner = '<polygon points="' + pts.map(function (pt) {
                return pt[0].toFixed(1) + "," + pt[1].toFixed(1);
            }).join(" ") + '" ' + attrs + "/>";
        }
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + " " + h +
            '" preserveAspectRatio="none">' + inner + "</svg>";
    }

    function shapeTextDiv(o) {
        var p = o.props;
        var s = "font-size:" + (Number(p.fontSize) || 18) + "px;";
        s += "color:" + esc(p.textColor || contrastText(p.fill)) + ";";
        if (p.bold) s += "font-weight:700;";
        return '<div class="sl-shape-text" style="' + s + '">' + esc(p.text || "") + "</div>";
    }

    function lineBBox(o) {
        return {
            x: o.x + Math.min(0, o.w),
            y: o.y + Math.min(0, o.h),
            w: Math.abs(o.w),
            h: Math.abs(o.h)
        };
    }
    function positionLineEl(el, o) {
        var bb = lineBBox(o);
        el.style.left = bb.x + "px";
        el.style.top = bb.y + "px";
        el.style.width = Math.max(1, bb.w) + "px";
        el.style.height = Math.max(1, bb.h) + "px";
    }
    function lineSvg(o) {
        var p = o.props;
        var sw = Number(p.strokeW) || 2;
        var stroke = p.stroke || "#202124";
        var x1 = Math.max(0, -o.w), y1 = Math.max(0, -o.h);
        var x2 = x1 + o.w, y2 = y1 + o.h;
        var out = '<svg xmlns="http://www.w3.org/2000/svg" style="overflow:visible;" width="100%" height="100%">';
        // generous transparent hit area
        out += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 +
            '" stroke="rgba(0,0,0,0)" stroke-width="' + Math.max(14, sw + 10) + '"/>';
        var ex = x2, ey = y2;
        var head = "";
        if (p.arrowEnd) {
            var ang = Math.atan2(y2 - y1, x2 - x1);
            var s = 6 + sw * 2.4;
            var bx = x2 - s * Math.cos(ang), by = y2 - s * Math.sin(ang);
            var px = s * 0.45 * -Math.sin(ang), py = s * 0.45 * Math.cos(ang);
            head = '<polygon points="' + x2.toFixed(1) + "," + y2.toFixed(1) + " " +
                (bx + px).toFixed(1) + "," + (by + py).toFixed(1) + " " +
                (bx - px).toFixed(1) + "," + (by - py).toFixed(1) +
                '" fill="' + esc(stroke) + '"/>';
            ex = x2 - s * 0.6 * Math.cos(ang);
            ey = y2 - s * 0.6 * Math.sin(ang);
        }
        out += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + ex + '" y2="' + ey +
            '" stroke="' + esc(stroke) + '" stroke-width="' + sw + '" stroke-linecap="round"' +
            (p.dash ? ' stroke-dasharray="' + (sw * 3) + " " + (sw * 2.4) + '"' : "") + "/>";
        out += head + "</svg>";
        return out;
    }

    /* Table cells store a limited HTML subset (so per-cell bold/color/font
       formatting survives edit mode). This sanitizer keeps only inline
       formatting produced by execCommand and strips everything else. */
    var CELL_OK_TAGS = { B: 1, I: 1, U: 1, STRONG: 1, EM: 1, S: 1, STRIKE: 1, SPAN: 1, FONT: 1, BR: 1, SUB: 1, SUP: 1 };
    var CELL_OK_STYLES = ["font-size", "color", "font-family", "font-weight", "font-style", "text-decoration", "background-color"];
    function sanitizeCellHtml(html) {
        if (html === undefined || html === null) return "";
        // parse in an inert DOMParser document: unlike innerHTML on a live
        // div, <img onerror> handlers can never fire while parsing there
        var doc = new DOMParser().parseFromString(
            "<!DOCTYPE html><body><div>" + String(html) + "</div></body>", "text/html");
        var tmp = doc.body.firstChild;
        if (!tmp) return "";
        (function walk(node) {
            var children = Array.prototype.slice.call(node.childNodes);
            children.forEach(function (ch) {
                if (ch.nodeType === 8) { node.removeChild(ch); return; }   // comments
                if (ch.nodeType !== 1) return;                              // text stays
                if (ch.tagName === "SCRIPT" || ch.tagName === "STYLE") {
                    node.removeChild(ch);
                    return;
                }
                walk(ch);
                if (!CELL_OK_TAGS[ch.tagName]) {
                    // unwrap unknown elements, turning block boundaries into <br>
                    if (/^(DIV|P|LI|H[1-6]|TR|TD)$/.test(ch.tagName) && ch.previousSibling) {
                        node.insertBefore(document.createElement("br"), ch);
                    }
                    while (ch.firstChild) node.insertBefore(ch.firstChild, ch);
                    node.removeChild(ch);
                } else {
                    // scrub attributes down to the formatting whitelist
                    Array.prototype.slice.call(ch.attributes).forEach(function (a) {
                        var an = a.name.toLowerCase();
                        var ok = an === "style" ||
                            (ch.tagName === "FONT" && (an === "color" || an === "face" || an === "size"));
                        if (!ok) ch.removeAttribute(a.name);
                    });
                    if (ch.getAttribute("style")) {
                        var kept = [];
                        ch.getAttribute("style").split(";").forEach(function (decl) {
                            var ci = decl.indexOf(":");
                            if (ci < 0) return;
                            var prop = decl.substring(0, ci).trim().toLowerCase();
                            if (CELL_OK_STYLES.indexOf(prop) >= 0) kept.push(decl.trim());
                        });
                        if (kept.length) ch.setAttribute("style", kept.join(";"));
                        else ch.removeAttribute("style");
                    }
                }
            });
        })(tmp);
        return tmp.innerHTML;
    }

    function tableHtml(o) {
        var p = o.props;
        var rows = p.rows || [["", ""]];
        var cols = rows[0] ? rows[0].length : 1;
        var accent = themeOf().accent;
        var headBg = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent + "2e" : "rgba(127,127,127,0.18)";
        var s = "font-size:" + (Number(p.fontSize) || 16) + "px;";
        if (p.color) s += "color:" + esc(p.color) + ";";
        var out = '<table class="sl-table" style="' + s + '"><colgroup>';
        for (var c = 0; c < cols; c++) {
            var wPct = (p.colW && p.colW[c]) ? p.colW[c] : (100 / cols);
            out += '<col style="width:' + wPct + '%">';
        }
        out += "</colgroup>";
        rows.forEach(function (r, ri) {
            var isHead = p.headerRow && ri === 0;
            var trStyle = (p.rowH && p.rowH[ri] !== undefined) ? ' style="height:' + p.rowH[ri] + '%;"' : "";
            out += '<tr class="' + (isHead ? "sl-thead" : "") + '"' + trStyle + ">";
            r.forEach(function (cell, ci) {
                out += '<td data-r="' + ri + '" data-c="' + ci + '"' +
                    (isHead ? ' style="background:' + headBg + ';"' : "") + ">" +
                    sanitizeCellHtml(cell) + "</td>";
            });
            out += "</tr>";
        });
        out += "</table>";
        return out;
    }

    function renderObjectEl(o, zIdx) {
        var d = document.createElement("div");
        d.className = "sl-obj sl-type-" + o.type;
        d.setAttribute("data-id", o.id);
        d.style.zIndex = zIdx + 1;
        if (o.type === "line") {
            positionLineEl(d, o);
            d.innerHTML = lineSvg(o);
            return d;
        }
        d.style.left = o.x + "px";
        d.style.top = o.y + "px";
        d.style.width = Math.max(1, o.w) + "px";
        d.style.height = Math.max(1, o.h) + "px";
        if (o.rot) d.style.transform = "rotate(" + o.rot + "deg)";
        switch (o.type) {
            case "text":
                d.innerHTML = '<div class="sl-text-in" style="' + textStyle(o.props) + '">' +
                    (o.props.html || "") + "</div>";
                break;
            case "image":
                d.innerHTML = '<img draggable="false" src="' + esc(o.props.src || "") +
                    '" style="object-fit:' + esc(o.props.fit || "contain") + ';" alt="">';
                break;
            case "shape":
                d.innerHTML = shapeSvg(o) + shapeTextDiv(o);
                break;
            case "table":
                d.innerHTML = tableHtml(o);
                break;
            case "chart":
                d.innerHTML = '<div class="sl-chart-box">' +
                    OfficeCharts.renderToString(o.props.spec || {}, Math.max(60, o.w), Math.max(60, o.h)) +
                    "</div>";
                break;
        }
        return d;
    }

    /* Render one slide's full content into an element (also used by
       thumbnails, present mode, print and export). */
    function renderSlideContent(el, slide) {
        var th = themeOf();
        el.innerHTML = "";
        el.style.background = slide.bg || th.bg;
        el.style.color = th.text;
        (slide.objects || []).forEach(function (o, i) {
            el.appendChild(renderObjectEl(o, i));
        });
    }

    /* ================= rendering: editor ================= */
    function renderEditorSlide() {
        renderSlideContent(layerEl, curSlide());
    }

    function getBBox(o) {
        if (o.type === "line") return lineBBox(o);
        return { x: o.x, y: o.y, w: o.w, h: o.h };
    }

    function mkHandle(name, px, py, hs) {
        var h = document.createElement("div");
        h.className = "sl-h";
        h.setAttribute("data-h", name);
        h.style.left = (px - hs / 2) + "px";
        h.style.top = (py - hs / 2) + "px";
        h.style.width = hs + "px";
        h.style.height = hs + "px";
        h.style.borderWidth = Math.max(1, hs / 7) + "px";
        return h;
    }

    function renderOverlay() {
        if (!framesEl) return;
        framesEl.innerHTML = "";
        var s = curScale() || 1;
        var hs = Math.max(7, 10 / s);
        var bw = Math.max(1, 1.6 / s);
        selObjs().forEach(function (o) {
            var bb = getBBox(o);
            var fr = document.createElement("div");
            fr.className = "sl-frame";
            fr.style.left = bb.x + "px";
            fr.style.top = bb.y + "px";
            fr.style.width = Math.max(1, bb.w) + "px";
            fr.style.height = Math.max(1, bb.h) + "px";
            fr.style.borderWidth = bw + "px";
            if (o.type !== "line" && o.rot) fr.style.transform = "rotate(" + o.rot + "deg)";
            if (sel.length === 1) {
                if (o.type === "line") {
                    fr.className += " sl-frame-line";
                    var x1 = Math.max(0, -o.w), y1 = Math.max(0, -o.h);
                    fr.appendChild(mkHandle("p1", x1, y1, hs));
                    fr.appendChild(mkHandle("p2", x1 + o.w, y1 + o.h, hs));
                } else {
                    var w = bb.w, hgt = bb.h;
                    [["nw", 0, 0], ["n", w / 2, 0], ["ne", w, 0], ["e", w, hgt / 2],
                     ["se", w, hgt], ["s", w / 2, hgt], ["sw", 0, hgt], ["w", 0, hgt / 2]]
                        .forEach(function (hd) {
                            fr.appendChild(mkHandle(hd[0], hd[1], hd[2], hs));
                        });
                    var stemH = 24 / s;
                    var stem = document.createElement("div");
                    stem.className = "sl-rot-stem";
                    stem.style.left = (w / 2 - bw / 2) + "px";
                    stem.style.top = (-stemH) + "px";
                    stem.style.width = bw + "px";
                    stem.style.height = stemH + "px";
                    fr.appendChild(stem);
                    fr.appendChild(mkHandle("rot", w / 2, -stemH, hs));
                }
            }
            framesEl.appendChild(fr);
        });
    }

    /* ================= rendering: rail / thumbnails ================= */
    function renderThumb(i) {
        var $mini = $("#slThumbs .sl-thumb").eq(i).find(".sl-thumb-mini");
        if ($mini.length && body.slides[i]) renderSlideContent($mini[0], body.slides[i]);
    }
    function renderThumbSoon(i) {
        clearTimeout(thumbTimer);
        thumbTimer = setTimeout(function () { renderThumb(i); }, 220);
    }
    function renderAllThumbs() {
        body.slides.forEach(function (s, i) { renderThumb(i); });
    }

    var dragSlideIdx = -1;
    function renderRail() {
        var $t = $("#slThumbs").empty();
        body.slides.forEach(function (s, i) {
            var $th = $('<div class="sl-thumb" draggable="true"></div>');
            if (i === cur) $th.addClass("active");
            $th.append('<div class="sl-thumb-num">' + (i + 1) + "</div>");
            var $view = $('<div class="sl-thumb-view"><div class="sl-thumb-mini sl-slidebase"></div></div>');
            $th.append($view);
            renderSlideContent($view.find(".sl-thumb-mini")[0], s);
            $th.on("click", function () { selectSlide(i); });
            $th.on("contextmenu", function (e) {
                e.preventDefault();
                selectSlide(i);
                showSlideContextMenu(e.clientX, e.clientY, i);
            });
            // drag to reorder
            $th.on("dragstart", function (e) {
                dragSlideIdx = i;
                $th.addClass("dragging");
                try {
                    e.originalEvent.dataTransfer.setData("text/plain", String(i));
                    e.originalEvent.dataTransfer.effectAllowed = "move";
                } catch (err) { }
            });
            $th.on("dragover", function (e) {
                if (dragSlideIdx < 0) return;
                e.preventDefault();
                var r = $th[0].getBoundingClientRect();
                var before = (e.originalEvent.clientY - r.top) < r.height / 2;
                $th.toggleClass("drop-before", before).toggleClass("drop-after", !before);
            });
            $th.on("dragleave", function () { $th.removeClass("drop-before drop-after"); });
            $th.on("drop", function (e) {
                e.preventDefault();
                var before = $th.hasClass("drop-before");
                $th.removeClass("drop-before drop-after");
                if (dragSlideIdx < 0 || dragSlideIdx === i) return;
                var to = i + (before ? 0 : 1);
                moveSlideTo(dragSlideIdx, to);
            });
            $th.on("dragend", function () {
                dragSlideIdx = -1;
                $("#slThumbs .sl-thumb").removeClass("dragging drop-before drop-after");
            });
            $t.append($th);
        });
    }
    function updateRailActive() {
        $("#slThumbs .sl-thumb").each(function (i) {
            $(this).toggleClass("active", i === cur);
        });
    }

    /* ================= layout / zoom ================= */
    function layoutCanvas() {
        var area = document.getElementById("slCanvasArea");
        if (!area) return;
        var aw = Math.max(60, area.clientWidth - 48);
        var ah = Math.max(60, area.clientHeight - 48);
        fitScale = Math.max(0.05, Math.min(aw / SLIDE_W, ah / SLIDE_H));
        var s = curScale();
        var wrap = document.getElementById("slCanvasWrap");
        wrap.style.width = (SLIDE_W * s) + "px";
        wrap.style.height = (SLIDE_H * s) + "px";
        canvasEl.style.transform = "scale(" + s + ")";
        var gt = Math.max(1, 1.5 / s) + "px";
        guideVEl.style.width = gt;
        guideHEl.style.height = gt;
        renderOverlay();
        if (window.OfficeTextEditBar && OfficeTextEditBar.isVisible()) OfficeTextEditBar.reposition();
    }

    /* ================= status / notes ================= */
    function updateStatus() {
        OfficeApp.updateStatusItem("slide", "Slide " + (cur + 1) + " of " + body.slides.length);
        var msg = "";
        var so = selObjs();
        if (so.length === 1) msg = TYPE_NAMES[so[0].type] || "";
        else if (so.length > 1) msg = so.length + " objects selected";
        OfficeApp.updateStatusItem("sel", esc(msg));
    }
    function syncNotes() {
        $("#slNotesText").val(curSlide().notes || "");
    }

    /* ================= selection / commit ================= */
    function setSel(ids) {
        var seen = {};
        sel = (ids || []).filter(function (id) {
            if (seen[id] || !objById(id)) return false;
            seen[id] = true;
            return true;
        });
        renderOverlay();
        updateStatus();
        syncToolbarFromSel();
    }

    /* While editing, fold the live DOM text back into the model WITHOUT
       leaving edit mode - so toolbar changes mid-edit never clobber the
       user's unsaved typing. */
    function syncEditingIntoModel() {
        if (!editingId) return;
        var o = objById(editingId);
        var el = objEl(editingId);
        if (!o || !el) return;
        if (editingKind === "text") {
            var inner = el.querySelector(".sl-text-in");
            if (inner) o.props.html = inner.innerHTML;
        } else if (editingKind === "shape") {
            var st = el.querySelector(".sl-shape-text");
            if (st) o.props.text = st.innerText.replace(/\n$/, "");
        } else if (editingKind === "table") {
            var cells = el.querySelectorAll("td");
            var rows = deep(o.props.rows || []);
            for (var i = 0; i < cells.length; i++) {
                var r = parseInt(cells[i].getAttribute("data-r"), 10);
                var c = parseInt(cells[i].getAttribute("data-c"), 10);
                if (rows[r] && rows[r][c] !== undefined) {
                    rows[r][c] = sanitizeCellHtml(cells[i].innerHTML);
                }
            }
            o.props.rows = rows;
        }
    }

    /* Re-enter edit mode on the freshly re-rendered element (commit()
       rebuilds the DOM, which drops contenteditable state). */
    function reapplyEditState() {
        if (!editingId) return;
        var o = objById(editingId);
        var el = objEl(editingId);
        if (!o || !el) {
            editingId = null;
            editingKind = null;
            if (window.OfficeTextEditBar) OfficeTextEditBar.hide();
            return;
        }
        el.classList.add("sl-editing");
        if (editingKind === "table") {
            var cells = el.querySelectorAll("td");
            for (var i = 0; i < cells.length; i++) cells[i].setAttribute("contenteditable", "true");
            buildTableResizers(o, el);
        } else {
            var inner = el.querySelector(editingKind === "text" ? ".sl-text-in" : ".sl-shape-text");
            if (inner) {
                inner.setAttribute("contenteditable", "true");
                inner.focus();
                try {
                    var range = document.createRange();
                    range.selectNodeContents(inner);
                    range.collapse(false);
                    var s = window.getSelection();
                    s.removeAllRanges();
                    s.addRange(range);
                } catch (e) { }
            }
        }
        el.addEventListener("focusout", onEditFocusOut);
        if (window.OfficeTextEditBar) OfficeTextEditBar.reposition();
    }

    /* After a model mutation of the current slide: redraw, record undo,
       mark the document dirty and refresh the thumbnail. Live text edits
       are folded in first and edit mode survives the re-render. */
    function commit() {
        syncEditingIntoModel();
        renderEditorSlide();
        reapplyEditState();
        renderOverlay();
        renderThumb(cur);
        updateStatus();
        OfficeApp.markDirty();
        undo.push(snap());
    }
    /* After structural slide-list changes (add/remove/reorder slides). */
    function structCommit(newCur) {
        cur = clamp(newCur, 0, body.slides.length - 1);
        sel = [];
        renderRail();
        renderEditorSlide();
        renderOverlay();
        syncNotes();
        updateStatus();
        OfficeApp.markDirty();
        undo.push(snap());
    }
    function renderAll() {
        cur = clamp(cur, 0, body.slides.length - 1);
        renderRail();
        renderEditorSlide();
        renderOverlay();
        syncNotes();
        updateStatus();
        syncToolbarFromSel();
    }

    function selectSlide(i) {
        if (i === cur && $("#slThumbs .sl-thumb").length) {
            updateRailActive();
            return;
        }
        endEdit(true);
        cur = clamp(i, 0, body.slides.length - 1);
        sel = [];
        renderEditorSlide();
        renderOverlay();
        updateRailActive();
        syncNotes();
        updateStatus();
        syncToolbarFromSel();
    }

    /* ================= slide operations ================= */
    function addSlideAfter(i) {
        endEdit(true);
        body.slides.splice(i + 1, 0, newSlide("normal"));
        structCommit(i + 1);
    }
    function duplicateSlide(i) {
        endEdit(true);
        var copy = deep(body.slides[i]);
        copy.id = genId("s");
        copy.objects.forEach(function (o) { o.id = genId(); });
        body.slides.splice(i + 1, 0, copy);
        structCommit(i + 1);
    }
    function deleteSlide(i) {
        endEdit(true);
        if (body.slides.length <= 1) {
            body.slides[0] = newSlide("");
            structCommit(0);
        } else {
            body.slides.splice(i, 1);
            structCommit(Math.min(i, body.slides.length - 1));
        }
    }
    function moveSlide(i, dir) {
        var j = i + dir;
        if (j < 0 || j >= body.slides.length) return;
        var s = body.slides.splice(i, 1)[0];
        body.slides.splice(j, 0, s);
        structCommit(j);
    }
    function moveSlideTo(from, to) {
        var s = body.slides.splice(from, 1)[0];
        if (from < to) to--;
        body.slides.splice(to, 0, s);
        structCommit(to);
    }
    function showSlideContextMenu(x, y, i) {
        OfficeApp.showContextMenu(x, y, [
            { label: "New slide", icon: "plus", action: function () { addSlideAfter(i); } },
            { label: "Duplicate slide", icon: "clone outline", action: function () { duplicateSlide(i); } },
            { label: "Delete slide", icon: "trash alternate outline", action: function () { deleteSlide(i); } },
            { sep: true },
            {
                label: "Move up", icon: "angle up",
                enabled: function () { return i > 0; },
                action: function () { moveSlide(i, -1); }
            },
            {
                label: "Move down", icon: "angle down",
                enabled: function () { return i < body.slides.length - 1; },
                action: function () { moveSlide(i, 1); }
            },
            { sep: true },
            { label: "Background...", icon: "paint brush", action: function () { bgDialog(i); } }
        ]);
    }

    /* ================= object operations ================= */
    function addObj(type, props, geo) {
        var slide = curSlide();
        var o = {
            id: genId(), type: type,
            x: geo.x, y: geo.y, w: geo.w, h: geo.h,
            rot: 0, z: slide.objects.length + 1, props: props
        };
        slide.objects.push(o);
        setSel([o.id]);
        commit();
        return o;
    }
    function deleteSelection() {
        if (!sel.length) return;
        endEdit(false);
        var slide = curSlide();
        slide.objects = slide.objects.filter(function (o) { return sel.indexOf(o.id) < 0; });
        slide.objects.forEach(function (o, i) { o.z = i + 1; });
        sel = [];
        commit();
    }
    function copySelection() {
        if (!sel.length) return;
        clip = selObjs().map(deep);
        OfficeApp.setStatus(clip.length + " object" + (clip.length > 1 ? "s" : "") + " copied");
    }
    function cutSelection() {
        if (!sel.length) return;
        copySelection();
        deleteSelection();
    }
    function pasteClipboard() {
        if (!clip || !clip.length) return false;
        var slide = curSlide();
        var ids = [];
        clip.forEach(function (c) {
            var n = deep(c);
            n.id = genId();
            n.x += 15; n.y += 15;
            n.z = slide.objects.length + 1;
            slide.objects.push(n);
            ids.push(n.id);
        });
        clip = clip.map(function (c) { var n = deep(c); n.x += 15; n.y += 15; return n; });
        setSel(ids);
        commit();
        return true;
    }
    function duplicateSelection() {
        if (!sel.length) return;
        var saved = clip;
        clip = selObjs().map(deep);
        pasteClipboard();
        clip = saved;
    }
    function nudgeSelection(dx, dy) {
        var so = selObjs();
        if (!so.length) return;
        so.forEach(function (o) {
            o.x = clamp(o.x + dx, -2000, 3000);
            o.y = clamp(o.y + dy, -2000, 3000);
            updateObjEl(o);
        });
        renderOverlay();
        OfficeApp.markDirty();
        undo.pushDebounced(snap, 600);
        renderThumbSoon(cur);
    }
    function cycleSelection() {
        var objs = curSlide().objects;
        if (!objs.length) return;
        if (!sel.length) { setSel([objs[0].id]); return; }
        var i = -1;
        objs.forEach(function (o, oi) { if (o.id === sel[0]) i = oi; });
        setSel([objs[(i + 1) % objs.length].id]);
    }
    function selectAllObjects() {
        setSel(curSlide().objects.map(function (o) { return o.id; }));
    }

    function reorderSelection(mode) {
        if (!sel.length) return;
        var slide = curSlide();
        var objs = slide.objects;
        var isSel = function (o) { return sel.indexOf(o.id) >= 0; };
        var i;
        if (mode === "front") {
            slide.objects = objs.filter(function (o) { return !isSel(o); })
                .concat(objs.filter(isSel));
        } else if (mode === "back") {
            slide.objects = objs.filter(isSel)
                .concat(objs.filter(function (o) { return !isSel(o); }));
        } else if (mode === "forward") {
            for (i = objs.length - 2; i >= 0; i--) {
                if (isSel(objs[i]) && !isSel(objs[i + 1])) {
                    var t = objs[i]; objs[i] = objs[i + 1]; objs[i + 1] = t;
                }
            }
        } else if (mode === "backward") {
            for (i = 1; i < objs.length; i++) {
                if (isSel(objs[i]) && !isSel(objs[i - 1])) {
                    var t2 = objs[i]; objs[i] = objs[i - 1]; objs[i - 1] = t2;
                }
            }
        }
        slide.objects.forEach(function (o, oi) { o.z = oi + 1; });
        commit();
    }

    function alignSelection(mode) {
        var so = selObjs();
        if (!so.length) return;
        so.forEach(function (o) {
            var bb = getBBox(o);
            var target;
            switch (mode) {
                case "left": target = 0; o.x += target - bb.x; break;
                case "center": target = (SLIDE_W - bb.w) / 2; o.x += target - bb.x; break;
                case "right": target = SLIDE_W - bb.w; o.x += target - bb.x; break;
                case "top": target = 0; o.y += target - bb.y; break;
                case "middle": target = (SLIDE_H - bb.h) / 2; o.y += target - bb.y; break;
                case "bottom": target = SLIDE_H - bb.h; o.y += target - bb.y; break;
            }
        });
        commit();
    }

    /* Apply a property mutation to selected objects; commit when changed. */
    function applyToSel(fn) {
        var so = selObjs();
        if (!so.length) return false;
        var changed = false;
        so.forEach(function (o) { if (fn(o) !== false) changed = true; });
        if (changed) commit();
        return changed;
    }

    /* ================= object insertion ================= */
    function insertText() {
        var th = themeOf();
        var o = addObj("text", { html: "Text", fontSize: 24, color: th.text, align: "left" },
            { x: 330, y: 240, w: 300, h: 60 });
        startEdit(o.id);
    }
    function insertShape(kind) {
        var th = themeOf();
        addObj("shape", {
            kind: kind, fill: /^#[0-9a-fA-F]{6}$/.test(th.accent) ? th.accent : "#e07b1f",
            stroke: "#333333", strokeW: 0, text: "", fontSize: 18
        }, { x: 380, y: 190, w: 200, h: 160 });
    }
    function armDraw(kind) {
        endEdit(true);
        pendingDraw = kind;
        canvasEl.classList.add("sl-drawmode");
        OfficeApp.setStatus("Drag on the slide to draw a " + (kind === "arrow" ? "arrow" : "line") +
            " - Esc to cancel", "info", 0);
        syncDrawButtons();
    }
    function disarmDraw() {
        pendingDraw = null;
        canvasEl.classList.remove("sl-drawmode");
        OfficeApp.setStatus("");
        syncDrawButtons();
    }
    function syncDrawButtons() {
        $("#slBtnLine").toggleClass("active", pendingDraw === "line");
        $("#slBtnArrow").toggleClass("active", pendingDraw === "arrow");
    }

    function placeImage(src) {
        var img = new Image();
        var place = function (w, h) {
            var sc = Math.min(480 / w, 320 / h, 1);
            var pw = Math.max(40, Math.round(w * sc)), ph = Math.max(40, Math.round(h * sc));
            addObj("image", { src: src, fit: "contain" },
                { x: Math.round((SLIDE_W - pw) / 2), y: Math.round((SLIDE_H - ph) / 2), w: pw, h: ph });
        };
        img.onload = function () { place(img.naturalWidth || 480, img.naturalHeight || 320); };
        img.onerror = function () { place(480, 320); };
        img.src = src;
    }
    function imageFromStorage() {
        try {
            ao_module_openFileSelector(function (files) {
                (files || []).forEach(function (f) {
                    placeImage(aoRoot() + "media?file=" + encodeURIComponent(f.filepath));
                });
            }, "user:/Desktop", "file", true, { filter: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] });
        } catch (e) {
            OfficeApp.toast("File selector is not available here", "error");
        }
    }
    function imageFromDevice() {
        $("#slDeviceImage").trigger("click");
    }
    function imageFromUrl() {
        OfficeApp.prompt("Insert image from URL", "Image URL", "https://", function (v) {
            if (v) placeImage(v.trim());
        });
    }

    function tableDialog() {
        var $b = $(
            '<div class="sl-dialog-row">' +
            '<div><label>Rows</label><input type="number" id="slTblRows" min="1" max="20" value="3"></div>' +
            '<div><label>Columns</label><input type="number" id="slTblCols" min="1" max="12" value="3"></div>' +
            "</div>" +
            '<div class="sl-swatch-row"><input type="checkbox" id="slTblHead" checked style="width:auto;">' +
            '<label for="slTblHead" style="display:inline;margin:0;">First row is a header</label></div>'
        );
        OfficeApp.dialog({
            title: "Insert table",
            body: $b,
            buttons: [
                { label: "Cancel" },
                {
                    label: "Insert", primary: true,
                    action: function (close, $bd) {
                        var r = clamp(parseInt($bd.find("#slTblRows").val(), 10) || 3, 1, 20);
                        var c = clamp(parseInt($bd.find("#slTblCols").val(), 10) || 3, 1, 12);
                        var head = $bd.find("#slTblHead").prop("checked");
                        close();
                        var rows = [];
                        for (var ri = 0; ri < r; ri++) {
                            var row = [];
                            for (var ci = 0; ci < c; ci++) row.push("");
                            rows.push(row);
                        }
                        var th = themeOf();
                        var w = Math.min(760, Math.max(240, c * 150));
                        var h = Math.min(440, r * 38 + 6);
                        addObj("table", { rows: rows, headerRow: head, fontSize: 16, color: th.text },
                            { x: Math.round((SLIDE_W - w) / 2), y: 120, w: w, h: h });
                    }
                }
            ]
        });
    }

    /* ---------- chart dialog (insert + re-edit) ---------- */
    function chartDialog(existing) {
        var spec = existing ? deep(existing.props.spec || {}) : {
            type: "bar", title: "",
            labels: ["A", "B", "C", "D"],
            series: [{ name: "Series 1", values: [4, 7, 5, 8] },
                     { name: "Series 2", values: [2, 4, 6, 3] }]
        };
        spec.labels = spec.labels || [];
        spec.series = (spec.series && spec.series.length) ? spec.series : [{ name: "Series 1", values: [] }];

        var $b = $(
            '<div class="sl-dialog-row" style="margin-bottom:10px;">' +
            '<div style="flex:0 0 130px;"><label>Type</label><select id="slChType">' +
            '<option value="bar">Bar</option><option value="line">Line</option><option value="pie">Pie</option>' +
            "</select></div>" +
            '<div><label>Title</label><input type="text" id="slChTitle"></div>' +
            '<div style="flex:0 0 auto;"><label>&nbsp;</label>' +
            '<span class="sl-swatch-row" style="margin:0;"><input type="checkbox" id="slChStacked" style="width:auto;">' +
            '<label for="slChStacked" style="display:inline;margin:0;">Stacked</label></span></div>' +
            "</div>" +
            '<div style="max-height:44vh;overflow:auto;"><table class="sl-grid-table" id="slChGrid"></table></div>' +
            '<div class="sl-grid-tools">' +
            '<button type="button" class="of-btn" data-op="addrow"><i class="plus icon"></i>Row</button>' +
            '<button type="button" class="of-btn" data-op="delrow"><i class="minus icon"></i>Row</button>' +
            '<button type="button" class="of-btn" data-op="addcol"><i class="plus icon"></i>Series</button>' +
            '<button type="button" class="of-btn" data-op="delcol"><i class="minus icon"></i>Series</button>' +
            "</div>"
        );
        $b.find("#slChType").val(spec.type || "bar");
        $b.find("#slChTitle").val(spec.title || "");
        $b.find("#slChStacked").prop("checked", !!(spec.options && spec.options.stacked));

        function renderGrid() {
            var $g = $b.find("#slChGrid").empty();
            var $hr = $("<tr></tr>");
            $hr.append('<td><input type="text" value="Category" disabled style="opacity:.55;"></td>');
            spec.series.forEach(function (s, si) {
                $hr.append('<td><input type="text" class="sl-ch-sname" data-s="' + si +
                    '" value="' + esc(s.name || ("Series " + (si + 1))) + '"></td>');
            });
            $g.append($hr);
            spec.labels.forEach(function (l, li) {
                var $r = $("<tr></tr>");
                $r.append('<td><input type="text" class="sl-ch-label" data-l="' + li +
                    '" value="' + esc(l) + '"></td>');
                spec.series.forEach(function (s, si) {
                    var v = (s.values && s.values[li] !== undefined) ? s.values[li] : "";
                    $r.append('<td><input type="text" class="sl-ch-val" data-l="' + li +
                        '" data-s="' + si + '" value="' + esc(v) + '"></td>');
                });
                $g.append($r);
            });
        }
        function readGrid() {
            $b.find(".sl-ch-sname").each(function () {
                spec.series[$(this).data("s")].name = $(this).val();
            });
            $b.find(".sl-ch-label").each(function () {
                spec.labels[$(this).data("l")] = $(this).val();
            });
            spec.series.forEach(function (s) { s.values = s.values || []; });
            $b.find(".sl-ch-val").each(function () {
                var li = $(this).data("l"), si = $(this).data("s");
                spec.series[si].values[li] = parseFloat($(this).val()) || 0;
            });
        }
        $b.on("click", ".sl-grid-tools .of-btn", function () {
            readGrid();
            var op = $(this).data("op");
            if (op === "addrow") {
                spec.labels.push("Item " + (spec.labels.length + 1));
                spec.series.forEach(function (s) { s.values.push(0); });
            } else if (op === "delrow" && spec.labels.length > 1) {
                spec.labels.pop();
                spec.series.forEach(function (s) { s.values.pop(); });
            } else if (op === "addcol") {
                var vals = spec.labels.map(function () { return 0; });
                spec.series.push({ name: "Series " + (spec.series.length + 1), values: vals });
            } else if (op === "delcol" && spec.series.length > 1) {
                spec.series.pop();
            }
            renderGrid();
        });
        renderGrid();

        OfficeApp.dialog({
            title: existing ? "Edit chart" : "Insert chart",
            body: $b,
            wide: true,
            buttons: [
                { label: "Cancel" },
                {
                    label: existing ? "Update" : "Insert", primary: true,
                    action: function (close, $bd) {
                        readGrid();
                        spec.type = $bd.find("#slChType").val();
                        spec.title = $bd.find("#slChTitle").val();
                        spec.options = spec.options || {};
                        spec.options.stacked = $bd.find("#slChStacked").prop("checked");
                        close();
                        if (existing) {
                            existing.props.spec = spec;
                            commit();
                        } else {
                            addObj("chart", { spec: spec }, { x: 240, y: 110, w: 480, h: 320 });
                        }
                    }
                }
            ]
        });
    }

    /* ---------- slide background dialog ---------- */
    function bgDialog(i) {
        var slide = body.slides[i];
        var initial = (slide.bg && /^#/.test(slide.bg)) ? slide.bg : "#ffffff";
        var $b = $(
            '<div class="sl-swatch-row"><input type="checkbox" id="slBgTheme" style="width:auto;"' +
            (slide.bg ? "" : " checked") + ">" +
            '<label for="slBgTheme" style="display:inline;margin:0;">Use theme background</label></div>' +
            '<div class="sl-swatch-row"><label style="display:inline;margin:0;">Custom color</label>' +
            '<input type="color" id="slBgColor" value="' + esc(initial) + '" style="width:60px;height:32px;padding:2px;"></div>'
        );
        $b.find("#slBgColor").on("input", function () {
            $b.find("#slBgTheme").prop("checked", false);
        });
        OfficeApp.dialog({
            title: "Slide background",
            body: $b,
            buttons: [
                { label: "Cancel" },
                {
                    label: "Apply", primary: true,
                    action: function (close, $bd) {
                        var useTheme = $bd.find("#slBgTheme").prop("checked");
                        slide.bg = useTheme ? null : $bd.find("#slBgColor").val();
                        close();
                        if (i === cur) commit(); else { OfficeApp.markDirty(); undo.push(snap()); }
                        renderThumb(i);
                    }
                }
            ]
        });
    }

    /* ---------- theme picker ---------- */
    /* Objects created under the old theme keep its default text color as an
       explicit value - remap those to the new theme's default so switching
       e.g. dark -> light does not leave invisible white text behind. */
    function remapThemeColors(oldTheme, newTheme) {
        var oldText = (oldTheme.text || "").toLowerCase();
        var newText = newTheme.text;
        if (!oldText || oldText === (newText || "").toLowerCase()) return;
        var matches = function (c) { return (c || "").toLowerCase() === oldText; };
        body.slides.forEach(function (s) {
            s.objects.forEach(function (o) {
                var p = o.props;
                if (o.type === "text" || o.type === "table") {
                    if (matches(p.color)) p.color = newText;
                } else if (o.type === "shape") {
                    if (matches(p.textColor)) p.textColor = newText;
                } else if (o.type === "line") {
                    if (matches(p.stroke)) p.stroke = newText;
                }
            });
        });
    }
    function setTheme(key) {
        if (!THEMES[key] || body.theme === key) return;
        var oldTheme = themeOf();
        body.theme = key;
        remapThemeColors(oldTheme, THEMES[key]);
        renderEditorSlide();
        renderOverlay();
        renderAllThumbs();
        OfficeApp.markDirty();
        undo.push(snap());
    }
    function themeDialog() {
        var $g = $('<div class="sl-theme-grid"></div>');
        Object.keys(THEMES).forEach(function (k) {
            var t = THEMES[k];
            var $c = $('<div class="sl-theme-card' + (body.theme === k ? " active" : "") + '"></div>');
            $c.append('<div class="sl-theme-prev" style="background:' + t.bg + ";color:" + t.text + ';">Aa</div>');
            $c.append('<div class="sl-theme-name">' + esc(t.label) + "</div>");
            $c.on("click", function () {
                setTheme(k);
                $g.find(".sl-theme-card").removeClass("active");
                $c.addClass("active");
            });
            $g.append($c);
        });
        OfficeApp.dialog({
            title: "Presentation theme",
            body: $g,
            buttons: [{ label: "Done", primary: true }]
        });
    }

    /* ================= table row/col ops ================= */
    function tableCellTarget(o) {
        var rows = o.props.rows || [];
        var r = lastCell ? clamp(lastCell.r, 0, rows.length - 1) : rows.length - 1;
        var c = lastCell ? clamp(lastCell.c, 0, (rows[0] || []).length - 1) : (rows[0] || []).length - 1;
        return { r: r, c: c };
    }
    function tableAddRow(o, after) {
        var t = tableCellTarget(o);
        var cols = (o.props.rows[0] || []).length || 1;
        var row = [];
        for (var i = 0; i < cols; i++) row.push("");
        o.props.rows.splice(t.r + (after ? 1 : 0), 0, row);
        delete o.props.rowH;
        o.h += Math.max(24, Math.round(o.h / Math.max(1, o.props.rows.length - 1)));
        commit();
    }
    function tableDelRow(o) {
        if (o.props.rows.length <= 1) return;
        var t = tableCellTarget(o);
        var rowH = Math.round(o.h / o.props.rows.length);
        o.props.rows.splice(t.r, 1);
        delete o.props.rowH;
        o.h = Math.max(30, o.h - rowH);
        lastCell = null;
        commit();
    }
    function tableAddCol(o, after) {
        var t = tableCellTarget(o);
        o.props.rows.forEach(function (r) { r.splice(t.c + (after ? 1 : 0), 0, ""); });
        delete o.props.colW;
        o.w = Math.min(940, o.w + Math.max(60, Math.round(o.w / Math.max(1, o.props.rows[0].length - 1))));
        commit();
    }
    function tableDelCol(o) {
        if ((o.props.rows[0] || []).length <= 1) return;
        var t = tableCellTarget(o);
        var colWpx = Math.round(o.w / o.props.rows[0].length);
        o.props.rows.forEach(function (r) { r.splice(t.c, 1); });
        delete o.props.colW;
        o.w = Math.max(60, o.w - colWpx);
        lastCell = null;
        commit();
    }

    /* ---------- table column / row resizing (edit mode) ---------- */
    function ensureTableGrid(o) {
        var rows = o.props.rows || [];
        var cols = rows[0] ? rows[0].length : 1;
        if (!Array.isArray(o.props.colW) || o.props.colW.length !== cols) {
            o.props.colW = [];
            for (var c = 0; c < cols; c++) o.props.colW.push(100 / cols);
        }
        if (!Array.isArray(o.props.rowH) || o.props.rowH.length !== rows.length) {
            o.props.rowH = [];
            for (var r = 0; r < rows.length; r++) o.props.rowH.push(100 / Math.max(1, rows.length));
        }
    }
    /* Thin drag bars on every internal column/row boundary while a table
       is in edit mode. Dragging adjusts colW / rowH percentages. */
    function buildTableResizers(o, el) {
        $(el).find(".sl-tbl-rz").remove();
        if (!o || o.type !== "table") return;
        ensureTableGrid(o);
        var table = el.querySelector("table.sl-table");
        if (!table || !table.rows.length) return;
        var c, r;
        var accX = 0;
        for (c = 0; c < table.rows[0].cells.length - 1; c++) {
            accX += table.rows[0].cells[c].offsetWidth;
            var gv = document.createElement("div");
            gv.className = "sl-tbl-rz sl-tbl-rz-col";
            gv.setAttribute("data-idx", c);
            gv.style.left = (accX - 3) + "px";
            el.appendChild(gv);
        }
        var accY = 0;
        for (r = 0; r < table.rows.length - 1; r++) {
            accY += table.rows[r].offsetHeight;
            var gh = document.createElement("div");
            gh.className = "sl-tbl-rz sl-tbl-rz-row";
            gh.setAttribute("data-idx", r);
            gh.style.top = (accY - 3) + "px";
            el.appendChild(gh);
        }
    }
    /* Live-apply colW/rowH to the rendered table during a resize drag */
    function applyTableGridLive(o) {
        var el = objEl(o.id);
        if (!el) return;
        var table = el.querySelector("table.sl-table");
        if (!table) return;
        var colEls = table.querySelectorAll("colgroup col");
        for (var c = 0; c < colEls.length; c++) {
            if (o.props.colW[c] !== undefined) colEls[c].style.width = o.props.colW[c] + "%";
        }
        for (var r = 0; r < table.rows.length; r++) {
            if (o.props.rowH[r] !== undefined) table.rows[r].style.height = o.props.rowH[r] + "%";
        }
        buildTableResizers(o, el);
    }

    /* ================= in-place text editing ================= */
    function objEl(id) {
        return layerEl.querySelector('.sl-obj[data-id="' + id + '"]');
    }
    function startEdit(id) {
        var o = objById(id);
        if (!o) return;
        if (editingId && editingId !== id) endEdit(true);
        var el = objEl(id);
        if (!el) return;
        if (o.type === "text" || o.type === "shape") {
            var inner = el.querySelector(o.type === "text" ? ".sl-text-in" : ".sl-shape-text");
            if (!inner) return;
            editingId = id;
            editingKind = o.type;
            setSel([id]);
            el.classList.add("sl-editing");
            inner.setAttribute("contenteditable", "true");
            inner.focus();
            try { document.execCommand("selectAll", false, null); } catch (e) { }
            el.addEventListener("focusout", onEditFocusOut);
            showTextEditBar(o, el);
        } else if (o.type === "table") {
            editingId = id;
            editingKind = "table";
            setSel([id]);
            el.classList.add("sl-editing");
            var cells = el.querySelectorAll("td");
            for (var i = 0; i < cells.length; i++) cells[i].setAttribute("contenteditable", "true");
            var t = tableCellTarget(o);
            var focusCell = el.querySelector('td[data-r="' + t.r + '"][data-c="' + t.c + '"]');
            if (focusCell) focusCell.focus();
            el.addEventListener("focusout", onEditFocusOut);
            buildTableResizers(o, el);
            showTextEditBar(o, el);
        } else if (o.type === "chart") {
            chartDialog(o);
        }
    }
    function showTextEditBar(o, el) {
        if (!window.OfficeTextEditBar) return;
        OfficeTextEditBar.show({
            anchor: el,
            fontSize: Number(o.props.fontSize) || (o.type === "table" ? 16 : 24),
            onFontSize: function (px) {
                o.props.fontSize = px;
                $("#slFontSize").val(px);
                commit();
            }
        });
    }
    function onEditFocusOut() {
        var id = editingId;
        setTimeout(function () {
            if (!id || editingId !== id) return;
            var el = objEl(id);
            // focus moving into the floating format bar is still "editing"
            if (window.OfficeTextEditBar && OfficeTextEditBar.contains(document.activeElement)) return;
            if (el && !el.contains(document.activeElement)) endEdit(true);
        }, 0);
    }
    function endEdit(commitChanges) {
        if (!editingId) return;
        var id = editingId, kind = editingKind;
        var o = objById(id);
        var el = objEl(id);
        editingId = null;
        editingKind = null;
        if (window.OfficeTextEditBar) OfficeTextEditBar.hide();
        var changed = false;
        if (o && el) {
            if (kind === "text") {
                var inner = el.querySelector(".sl-text-in");
                if (inner) {
                    var html = inner.innerHTML;
                    if (commitChanges && html !== o.props.html) { o.props.html = html; changed = true; }
                }
            } else if (kind === "shape") {
                var st = el.querySelector(".sl-shape-text");
                if (st) {
                    var txt = st.innerText.replace(/\n$/, "");
                    if (commitChanges && txt !== (o.props.text || "")) { o.props.text = txt; changed = true; }
                }
            } else if (kind === "table") {
                var cells = el.querySelectorAll("td");
                var rows = deep(o.props.rows || []);
                for (var i = 0; i < cells.length; i++) {
                    var r = parseInt(cells[i].getAttribute("data-r"), 10);
                    var c = parseInt(cells[i].getAttribute("data-c"), 10);
                    if (rows[r] && rows[r][c] !== undefined) {
                        rows[r][c] = sanitizeCellHtml(cells[i].innerHTML);
                    }
                }
                if (commitChanges && JSON.stringify(rows) !== JSON.stringify(o.props.rows)) {
                    o.props.rows = rows;
                    changed = true;
                }
            }
        }
        if (changed) {
            commit();
        } else {
            renderEditorSlide();
            renderOverlay();
        }
    }

    /* ================= live element update (during drag) ================= */
    function updateObjEl(o) {
        var el = objEl(o.id);
        if (!el) return;
        if (o.type === "line") {
            positionLineEl(el, o);
            el.innerHTML = lineSvg(o);
            return;
        }
        el.style.left = o.x + "px";
        el.style.top = o.y + "px";
        el.style.width = Math.max(1, o.w) + "px";
        el.style.height = Math.max(1, o.h) + "px";
        el.style.transform = o.rot ? "rotate(" + o.rot + "deg)" : "";
    }

    /* ================= pointer interaction ================= */
    function toSlideXY(e) {
        var r = canvasEl.getBoundingClientRect();
        var s = curScale() || 1;
        return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
    }
    function showGuide(which, on) {
        (which === "v" ? guideVEl : guideHEl).style.display = on ? "block" : "none";
    }
    function hideGuides() { showGuide("v", false); showGuide("h", false); }

    function onCanvasPointerDown(e) {
        if (e.button === 2) return;   // context menu handled separately
        OfficeApp.closeAllMenus();
        var pt = toSlideXY(e);

        // table column/row resize bars (present in table edit mode)
        if (e.target.classList && e.target.classList.contains("sl-tbl-rz")) {
            var rzHost = e.target.closest(".sl-obj");
            var rzObj = rzHost ? objById(rzHost.getAttribute("data-id")) : null;
            if (rzObj) {
                ensureTableGrid(rzObj);
                var isCol = e.target.classList.contains("sl-tbl-rz-col");
                drag = {
                    mode: isCol ? "tblcol" : "tblrow",
                    id: rzObj.id, start: pt, moved: false,
                    idx: parseInt(e.target.getAttribute("data-idx"), 10),
                    startArr: (isCol ? rzObj.props.colW : rzObj.props.rowH).slice()
                };
                try { canvasEl.setPointerCapture(e.pointerId); } catch (err) { }
            }
            e.preventDefault();
            return;
        }

        // when editing, clicks inside the edited object keep the caret working
        if (editingId) {
            var edEl = objEl(editingId);
            if (edEl && edEl.contains(e.target)) {
                var cell = e.target.closest ? e.target.closest("td") : null;
                if (cell) {
                    lastCell = { r: parseInt(cell.getAttribute("data-r"), 10), c: parseInt(cell.getAttribute("data-c"), 10) };
                }
                return;
            }
            endEdit(true);
        }

        // armed line/arrow drawing
        if (pendingDraw) {
            var th = themeOf();
            var slide = curSlide();
            var lo = {
                id: genId(), type: "line", x: pt.x, y: pt.y, w: 0, h: 0, rot: 0,
                z: slide.objects.length + 1,
                props: {
                    stroke: /^#/.test(th.text) ? th.text : "#202124",
                    strokeW: 2, dash: false, arrowEnd: pendingDraw === "arrow"
                }
            };
            slide.objects.push(lo);
            renderEditorSlide();
            drag = { mode: "draw", id: lo.id, start: pt, moved: false };
            try { canvasEl.setPointerCapture(e.pointerId); } catch (err) { }
            return;
        }

        // resize / rotate / line endpoint handles
        if (e.target.classList && e.target.classList.contains("sl-h")) {
            var hname = e.target.getAttribute("data-h");
            var so = selObjs();
            if (so.length !== 1) return;
            var o = so[0];
            drag = {
                mode: hname === "rot" ? "rotate" : (hname === "p1" || hname === "p2") ? "lineend" : "resize",
                h: hname, id: o.id, start: pt, moved: false,
                g: { x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rot || 0 }
            };
            try { canvasEl.setPointerCapture(e.pointerId); } catch (err) { }
            return;
        }

        var hitEl = e.target.closest ? e.target.closest(".sl-obj") : null;
        if (hitEl && layerEl.contains(hitEl)) {
            var id = hitEl.getAttribute("data-id");
            var cell2 = e.target.closest ? e.target.closest("td") : null;
            if (cell2) {
                lastCell = { r: parseInt(cell2.getAttribute("data-r"), 10), c: parseInt(cell2.getAttribute("data-c"), 10) };
            }
            var pendingToggle = null, pendingCollapse = null;
            var wasSelected = sel.length === 1 && sel[0] === id && !e.shiftKey;
            if (sel.indexOf(id) < 0) {
                setSel(e.shiftKey ? sel.concat([id]) : [id]);
            } else if (e.shiftKey) {
                pendingToggle = id;
            } else if (sel.length > 1) {
                pendingCollapse = id;
            }
            var geos = {};
            selObjs().forEach(function (o2) {
                geos[o2.id] = { x: o2.x, y: o2.y };
            });
            drag = {
                mode: "move", start: pt, geos: geos, moved: false,
                pendingToggle: pendingToggle, pendingCollapse: pendingCollapse,
                clickedId: id, wasSelected: wasSelected
            };
            try { canvasEl.setPointerCapture(e.pointerId); } catch (err) { }
            return;
        }

        // empty canvas: marquee select
        if (!e.shiftKey) setSel([]);
        drag = { mode: "marquee", start: pt, baseSel: sel.slice(), moved: false };
        try { canvasEl.setPointerCapture(e.pointerId); } catch (err) { }
    }

    function onCanvasPointerMove(e) {
        if (!drag) return;
        lastPointerEvt = e;
        if (!rafPending) {
            rafPending = true;
            requestAnimationFrame(applyDragFrame);
        }
    }

    function applyDragFrame() {
        rafPending = false;
        if (!drag || !lastPointerEvt) return;
        var e = lastPointerEvt;
        var pt = toSlideXY(e);
        var dx = pt.x - drag.start.x;
        var dy = pt.y - drag.start.y;
        if (!drag.moved && Math.abs(dx) < 2 && Math.abs(dy) < 2 && drag.mode !== "rotate") return;
        drag.moved = true;

        var o, g;
        switch (drag.mode) {
            case "move": {
                var ox = dx, oy = dy;
                var ids = Object.keys(drag.geos);
                if (!ids.length) return;
                if (snapGrid) {
                    var pg = drag.geos[ids[0]];
                    ox = Math.round((pg.x + dx) / GRID) * GRID - pg.x;
                    oy = Math.round((pg.y + dy) / GRID) * GRID - pg.y;
                }
                // union bbox at the tentative offset, for center smart guides
                var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                ids.forEach(function (id) {
                    var oo = objById(id);
                    if (!oo) return;
                    var saved = { x: oo.x, y: oo.y };
                    oo.x = drag.geos[id].x + ox; oo.y = drag.geos[id].y + oy;
                    var bb = getBBox(oo);
                    oo.x = saved.x; oo.y = saved.y;
                    minX = Math.min(minX, bb.x); minY = Math.min(minY, bb.y);
                    maxX = Math.max(maxX, bb.x + bb.w); maxY = Math.max(maxY, bb.y + bb.h);
                });
                var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
                var gv = false, gh = false;
                if (Math.abs(cx - SLIDE_W / 2) <= GUIDE_TOL) { ox += SLIDE_W / 2 - cx; gv = true; }
                if (Math.abs(cy - SLIDE_H / 2) <= GUIDE_TOL) { oy += SLIDE_H / 2 - cy; gh = true; }
                showGuide("v", gv);
                showGuide("h", gh);
                ids.forEach(function (id) {
                    var oo = objById(id);
                    if (!oo) return;
                    oo.x = drag.geos[id].x + ox;
                    oo.y = drag.geos[id].y + oy;
                    updateObjEl(oo);
                });
                renderOverlay();
                break;
            }
            case "resize": {
                o = objById(drag.id);
                if (!o) return;
                g = drag.g;
                var rad = -(g.rot || 0) * Math.PI / 180;
                var ldx = dx * Math.cos(rad) - dy * Math.sin(rad);
                var ldy = dx * Math.sin(rad) + dy * Math.cos(rad);
                var dirs = {
                    n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0],
                    ne: [1, -1], nw: [-1, -1], se: [1, 1], sw: [-1, 1]
                }[drag.h] || [0, 0];
                var minSz = 16;
                var dW = dirs[0] === 1 ? ldx : dirs[0] === -1 ? -ldx : 0;
                var dH = dirs[1] === 1 ? ldy : dirs[1] === -1 ? -ldy : 0;
                var newW = Math.max(minSz, g.w + dW);
                var newH = Math.max(minSz, g.h + dH);
                if (e.shiftKey && dirs[0] !== 0 && dirs[1] !== 0) {
                    var ar = g.w / Math.max(1, g.h);
                    if (Math.abs(newW - g.w) >= Math.abs(newH - g.h) * ar) newH = Math.max(minSz, newW / ar);
                    else newW = Math.max(minSz, newH * ar);
                }
                if (snapGrid) {
                    newW = Math.max(minSz, Math.round(newW / GRID) * GRID);
                    newH = Math.max(minSz, Math.round(newH / GRID) * GRID);
                }
                o.w = newW; o.h = newH;
                o.x = dirs[0] === -1 ? g.x + (g.w - newW) : g.x;
                o.y = dirs[1] === -1 ? g.y + (g.h - newH) : g.y;
                updateObjEl(o);
                renderOverlay();
                break;
            }
            case "rotate": {
                o = objById(drag.id);
                if (!o) return;
                g = drag.g;
                var ccx = g.x + g.w / 2, ccy = g.y + g.h / 2;
                var ang = Math.atan2(pt.y - ccy, pt.x - ccx) * 180 / Math.PI + 90;
                if (e.shiftKey) ang = Math.round(ang / 15) * 15;
                else ang = Math.round(ang);
                ang = ((ang + 180) % 360 + 360) % 360 - 180;
                o.rot = ang;
                updateObjEl(o);
                renderOverlay();
                break;
            }
            case "lineend": {
                o = objById(drag.id);
                if (!o) return;
                g = drag.g;
                if (drag.h === "p2") {
                    var e2x = g.x + g.w + dx, e2y = g.y + g.h + dy;
                    if (snapGrid) { e2x = Math.round(e2x / GRID) * GRID; e2y = Math.round(e2y / GRID) * GRID; }
                    o.w = e2x - o.x; o.h = e2y - o.y;
                } else {
                    var n1x = g.x + dx, n1y = g.y + dy;
                    if (snapGrid) { n1x = Math.round(n1x / GRID) * GRID; n1y = Math.round(n1y / GRID) * GRID; }
                    o.x = n1x; o.y = n1y;
                    o.w = g.x + g.w - n1x; o.h = g.y + g.h - n1y;
                }
                updateObjEl(o);
                renderOverlay();
                break;
            }
            case "draw": {
                o = objById(drag.id);
                if (!o) return;
                var vx = pt.x - o.x, vy = pt.y - o.y;
                if (e.shiftKey) {
                    var len = Math.sqrt(vx * vx + vy * vy);
                    var a45 = Math.round(Math.atan2(vy, vx) / (Math.PI / 4)) * (Math.PI / 4);
                    vx = len * Math.cos(a45);
                    vy = len * Math.sin(a45);
                }
                if (snapGrid) {
                    vx = Math.round((o.x + vx) / GRID) * GRID - o.x;
                    vy = Math.round((o.y + vy) / GRID) * GRID - o.y;
                }
                o.w = vx; o.h = vy;
                updateObjEl(o);
                break;
            }
            case "tblcol": {
                o = objById(drag.id);
                if (!o) return;
                var ci = drag.idx;
                var cTotal = drag.startArr[ci] + drag.startArr[ci + 1];
                var cPct = clamp(drag.startArr[ci] + (dx / Math.max(1, o.w)) * 100, 5, cTotal - 5);
                o.props.colW[ci] = cPct;
                o.props.colW[ci + 1] = cTotal - cPct;
                applyTableGridLive(o);
                break;
            }
            case "tblrow": {
                o = objById(drag.id);
                if (!o) return;
                var ri = drag.idx;
                var rTotal = drag.startArr[ri] + drag.startArr[ri + 1];
                var rPct = clamp(drag.startArr[ri] + (dy / Math.max(1, o.h)) * 100, 5, rTotal - 5);
                o.props.rowH[ri] = rPct;
                o.props.rowH[ri + 1] = rTotal - rPct;
                applyTableGridLive(o);
                break;
            }
            case "marquee": {
                var rx = Math.min(drag.start.x, pt.x), ry = Math.min(drag.start.y, pt.y);
                var rw = Math.abs(dx), rh = Math.abs(dy);
                marqueeEl.style.display = "block";
                marqueeEl.style.left = rx + "px";
                marqueeEl.style.top = ry + "px";
                marqueeEl.style.width = rw + "px";
                marqueeEl.style.height = rh + "px";
                var hits = curSlide().objects.filter(function (oo) {
                    var bb = getBBox(oo);
                    return bb.x < rx + rw && bb.x + bb.w > rx && bb.y < ry + rh && bb.y + bb.h > ry;
                }).map(function (oo) { return oo.id; });
                setSel(drag.baseSel.concat(hits));
                break;
            }
        }
    }

    function onCanvasPointerUp(e) {
        if (!drag) return;
        var d = drag;
        drag = null;
        lastPointerEvt = null;
        hideGuides();
        try { canvasEl.releasePointerCapture(e.pointerId); } catch (err) { }

        if (d.mode === "marquee") {
            marqueeEl.style.display = "none";
            return;
        }
        if (d.mode === "draw") {
            var o = objById(d.id);
            disarmDraw();
            if (o && Math.abs(o.w) < 4 && Math.abs(o.h) < 4) {
                curSlide().objects = curSlide().objects.filter(function (oo) { return oo.id !== d.id; });
                renderEditorSlide();
                renderOverlay();
                return;
            }
            if (o) {
                setSel([o.id]);
                commit();
            }
            return;
        }
        if (d.mode === "tblcol" || d.mode === "tblrow") {
            if (d.moved) commit();
            return;
        }
        if (d.mode === "move" && !d.moved) {
            if (d.pendingToggle) {
                setSel(sel.filter(function (id) { return id !== d.pendingToggle; }));
            } else if (d.pendingCollapse) {
                setSel([d.pendingCollapse]);
            } else if (d.wasSelected) {
                // second click on an already-selected object enters text edit
                var co = objById(d.clickedId);
                if (co && (co.type === "text" || co.type === "shape" || co.type === "table")) {
                    startEdit(co.id);
                }
            }
            return;
        }
        if (d.moved) commit();
    }

    function onCanvasDblClick(e) {
        var el = e.target.closest ? e.target.closest(".sl-obj") : null;
        if (!el || !layerEl.contains(el)) return;
        var id = el.getAttribute("data-id");
        var o = objById(id);
        if (!o) return;
        if (o.type === "text" || o.type === "shape" || o.type === "table") startEdit(id);
        else if (o.type === "chart") chartDialog(o);
    }

    /* ================= context menus ================= */
    function orderSub() {
        return [
            { label: "Bring to front", action: function () { reorderSelection("front"); } },
            { label: "Bring forward", action: function () { reorderSelection("forward"); } },
            { label: "Send backward", action: function () { reorderSelection("backward"); } },
            { label: "Send to back", action: function () { reorderSelection("back"); } }
        ];
    }
    function alignSub() {
        return [
            { label: "Align left", icon: "align left", action: function () { alignSelection("left"); } },
            { label: "Align center", icon: "align center", action: function () { alignSelection("center"); } },
            { label: "Align right", icon: "align right", action: function () { alignSelection("right"); } },
            { sep: true },
            { label: "Align top", action: function () { alignSelection("top"); } },
            { label: "Align middle", action: function () { alignSelection("middle"); } },
            { label: "Align bottom", action: function () { alignSelection("bottom"); } }
        ];
    }
    function onCanvasContextMenu(e) {
        e.preventDefault();
        var el = e.target.closest ? e.target.closest(".sl-obj") : null;
        var items;
        if (el && layerEl.contains(el)) {
            var id = el.getAttribute("data-id");
            var o = objById(id);
            if (!o) return;
            var cell = e.target.closest ? e.target.closest("td") : null;
            if (cell) {
                lastCell = { r: parseInt(cell.getAttribute("data-r"), 10), c: parseInt(cell.getAttribute("data-c"), 10) };
            }
            if (sel.indexOf(id) < 0) setSel([id]);
            items = [
                { label: "Cut", icon: "cut", key: "Ctrl+X", action: cutSelection },
                { label: "Copy", icon: "copy", key: "Ctrl+C", action: copySelection },
                { label: "Duplicate", icon: "clone outline", key: "Ctrl+D", action: duplicateSelection },
                { label: "Delete", icon: "trash alternate outline", key: "Del", action: deleteSelection },
                { sep: true },
                { label: "Order", icon: "bars", sub: orderSub() },
                { label: "Align to slide", icon: "align center", sub: alignSub() }
            ];
            if (o.type === "text" || o.type === "shape") {
                items.push({ sep: true });
                items.push({
                    label: "Edit text", icon: "i cursor",
                    action: function () { startEdit(o.id); }
                });
            }
            if (o.type === "table") {
                items.push({ sep: true });
                items.push({
                    label: "Table", icon: "table", sub: [
                        { label: "Insert row above", action: function () { tableAddRow(o, false); } },
                        { label: "Insert row below", action: function () { tableAddRow(o, true); } },
                        { label: "Delete row", action: function () { tableDelRow(o); } },
                        { sep: true },
                        { label: "Insert column left", action: function () { tableAddCol(o, false); } },
                        { label: "Insert column right", action: function () { tableAddCol(o, true); } },
                        { label: "Delete column", action: function () { tableDelCol(o); } },
                        { sep: true },
                        {
                            label: "Header row",
                            checked: function () { return !!o.props.headerRow; },
                            action: function () { o.props.headerRow = !o.props.headerRow; commit(); }
                        }
                    ]
                });
            }
            if (o.type === "chart") {
                items.push({ sep: true });
                items.push({
                    label: "Edit chart data...", icon: "chart bar",
                    action: function () { chartDialog(o); }
                });
            }
            if (o.type === "image") {
                items.push({ sep: true });
                items.push({
                    label: "Image fit", icon: "image outline", sub: ["contain", "cover", "fill"].map(function (f) {
                        return {
                            label: f.charAt(0).toUpperCase() + f.substring(1),
                            checked: function () { return (o.props.fit || "contain") === f; },
                            action: function () { o.props.fit = f; commit(); }
                        };
                    })
                });
            }
            if (o.type === "line") {
                items.push({ sep: true });
                items.push({
                    label: "Arrow head",
                    checked: function () { return !!o.props.arrowEnd; },
                    action: function () { o.props.arrowEnd = !o.props.arrowEnd; commit(); }
                });
                items.push({
                    label: "Dashed",
                    checked: function () { return !!o.props.dash; },
                    action: function () { o.props.dash = !o.props.dash; commit(); }
                });
            }
        } else {
            items = [
                {
                    label: "Paste", icon: "paste", key: "Ctrl+V",
                    enabled: function () { return !!(clip && clip.length); },
                    action: function () { pasteClipboard(); }
                },
                { sep: true },
                { label: "New slide", icon: "plus", action: function () { addSlideAfter(cur); } },
                { label: "Background...", icon: "paint brush", action: function () { bgDialog(cur); } }
            ];
        }
        OfficeApp.showContextMenu(e.clientX, e.clientY, items);
    }

    /* ================= keyboard ================= */
    function isTypingTarget(t) {
        return t && (t.isContentEditable ||
            /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ""));
    }
    function onKeyDown(e) {
        if (window.SlidesPresent && SlidesPresent.isActive()) return;
        if (e.key === "F5") {
            e.preventDefault();
            endEdit(true);
            startPresent(cur);
            return;
        }
        if ($(".of-dialog-overlay").length) return;
        if (editingId || isTypingTarget(e.target)) {
            if (e.key === "Escape" && editingId) {
                e.preventDefault();
                endEdit(true);
            }
            return;
        }
        var ctrl = e.ctrlKey || e.metaKey;
        var k = (e.key || "").toLowerCase();
        if (ctrl && k === "d") {
            e.preventDefault();
            if (sel.length) duplicateSelection();
            else duplicateSlide(cur);
            return;
        }
        if (ctrl && k === "c") { if (sel.length) { e.preventDefault(); copySelection(); } return; }
        if (ctrl && k === "x") { if (sel.length) { e.preventDefault(); cutSelection(); } return; }
        // Ctrl+V is NOT handled here on purpose: the native "paste" event
        // (onPasteEvent) fires and decides between clipboard images,
        // internal object clipboard and plain text.
        if (ctrl && k === "a") { e.preventDefault(); selectAllObjects(); return; }
        if (ctrl && k === "m") { e.preventDefault(); addSlideAfter(cur); return; }
        if (ctrl) return;

        switch (e.key) {
            case "Delete":
            case "Backspace":
                if (sel.length) { e.preventDefault(); deleteSelection(); }
                return;
            case "Escape":
                if (pendingDraw) disarmDraw();
                else setSel([]);
                return;
            case "Tab":
                e.preventDefault();
                cycleSelection();
                return;
            case "ArrowLeft":
            case "ArrowRight":
            case "ArrowUp":
            case "ArrowDown":
                if (sel.length) {
                    e.preventDefault();
                    var step = e.shiftKey ? 10 : 1;
                    var dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
                    var dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
                    nudgeSelection(dx, dy);
                } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                    selectSlide(cur - 1);
                } else {
                    selectSlide(cur + 1);
                }
                return;
            case "PageUp":
                e.preventDefault();
                selectSlide(cur - 1);
                return;
            case "PageDown":
                e.preventDefault();
                selectSlide(cur + 1);
                return;
        }
    }

    /* ================= system clipboard & drag-drop images ================= */
    function fileToImage(file) {
        var reader = new FileReader();
        reader.onload = function () { placeImage(reader.result); };
        reader.readAsDataURL(file);
    }

    /* Native paste event: screenshots / copied images become image objects,
       otherwise fall back to the internal object clipboard, then plain text. */
    function onPasteEvent(e) {
        if (window.SlidesPresent && SlidesPresent.isActive()) return;
        // typing somewhere (text edit, notes, dialogs): keep native paste
        if (editingId || isTypingTarget(e.target) || $(".of-dialog-overlay").length) return;
        var cd = e.clipboardData;
        if (!cd) return;
        var i, handled = false;
        var items = cd.items || [];
        for (i = 0; i < items.length; i++) {
            if (items[i].kind === "file" && items[i].type.indexOf("image/") === 0) {
                var f = items[i].getAsFile();
                if (f) { fileToImage(f); handled = true; }
            }
        }
        if (handled) { e.preventDefault(); return; }
        if (clip && clip.length) { e.preventDefault(); pasteClipboard(); return; }
        var t = cd.getData("text/plain");
        if (t) {
            e.preventDefault();
            var th = themeOf();
            addObj("text", { html: esc(t).replace(/\n/g, "<br>"), fontSize: 24, color: th.text, align: "left" },
                { x: 280, y: 220, w: 400, h: 90 });
        }
    }

    /* Drop image files (or an image URL) onto the slide canvas. */
    function onCanvasDrop(e) {
        var dt = e.originalEvent ? e.originalEvent.dataTransfer : e.dataTransfer;
        if (!dt) return;
        if (dragSlideIdx >= 0) return;   // thumbnail reordering, not a file drop
        var i, handled = false;
        var files = dt.files || [];
        for (i = 0; i < files.length; i++) {
            if ((files[i].type || "").indexOf("image/") === 0) {
                fileToImage(files[i]);
                handled = true;
            }
        }
        if (!handled) {
            var uri = dt.getData("text/uri-list") || dt.getData("text/plain");
            if (uri && /^(https?:|data:image\/)/i.test(uri.trim())) {
                placeImage(uri.trim().split("\n")[0]);
                handled = true;
            }
        }
        if (handled) e.preventDefault();
    }
    function initClipboardAndDnd() {
        document.addEventListener("paste", onPasteEvent);
        var area = document.getElementById("slCanvasArea");
        area.addEventListener("dragover", function (e) {
            if (dragSlideIdx >= 0) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
        });
        area.addEventListener("drop", onCanvasDrop);
    }

    /* ================= toolbar ================= */
    function tbtn(icon, title, fn, id) {
        var $b = $('<button type="button" class="of-tbtn"' + (id ? ' id="' + id + '"' : "") +
            ' title="' + esc(title) + '"><i class="' + icon + ' icon"></i></button>');
        $b.on("click", fn);
        return $b;
    }
    function buildToolbar() {
        var $tb = $("#toolbar").empty();

        $tb.append(tbtn("undo", "Undo (Ctrl+Z)", function () { doUndo(); }));
        $tb.append(tbtn("redo", "Redo (Ctrl+Y)", function () { doRedo(); }));
        $tb.append('<div class="of-tsep"></div>');
        $tb.append(tbtn("plus square outline", "New slide (Ctrl+M)", function () { addSlideAfter(cur); }));
        $tb.append('<div class="of-tsep"></div>');

        $tb.append(tbtn("font", "Insert text box", insertText));
        var $imgBtn = tbtn("image outline", "Insert image", function (e) {
            var r = e.currentTarget.getBoundingClientRect();
            OfficeApp.showContextMenu(r.left, r.bottom + 4, [
                { label: "From ArozOS storage...", icon: "folder open", action: imageFromStorage },
                { label: "From this device...", icon: "upload", action: imageFromDevice },
                { label: "From URL...", icon: "linkify", action: imageFromUrl }
            ]);
        });
        $tb.append($imgBtn);
        var $shpBtn = tbtn("object group", "Insert shape", function (e) {
            var r = e.currentTarget.getBoundingClientRect();
            OfficeApp.showContextMenu(r.left, r.bottom + 4, SHAPE_KINDS.map(function (s) {
                return { label: s.label, action: function () { insertShape(s.kind); } };
            }));
        });
        $tb.append($shpBtn);
        $tb.append(tbtn("minus", "Draw line", function () {
            if (pendingDraw === "line") disarmDraw(); else armDraw("line");
        }, "slBtnLine"));
        $tb.append(tbtn("long arrow alternate right", "Draw arrow", function () {
            if (pendingDraw === "arrow") disarmDraw(); else armDraw("arrow");
        }, "slBtnArrow"));
        $tb.append(tbtn("table", "Insert table", tableDialog));
        $tb.append(tbtn("chart bar", "Insert chart", function () { chartDialog(null); }));
        $tb.append('<div class="of-tsep"></div>');

        var $fs = $('<input type="number" class="of-tinput sl-num" id="slFontSize" min="6" max="200" step="1" title="Font size" value="24">');
        $fs.on("change", function () {
            var v = clamp(parseInt($fs.val(), 10) || 24, 6, 200);
            $fs.val(v);
            applyToSel(function (o) {
                if (o.type === "text" || o.type === "shape" || o.type === "table") {
                    o.props.fontSize = v;
                    return true;
                }
                return false;
            });
        });
        $tb.append($fs);

        function fmtBtn(icon, title, prop, cmd, id) {
            var $b = tbtn(icon, title, function () {
                if (editingId) {
                    // editing text, a shape label or a table cell: format the
                    // live selection (cells persist it as sanitized HTML)
                    try { document.execCommand(cmd); } catch (e) { }
                    return;
                }
                applyToSel(function (o) {
                    if (o.type === "text" || o.type === "shape") {
                        o.props[prop] = !o.props[prop];
                        return true;
                    }
                    return false;
                });
            }, id);
            $b.on("mousedown", function (e) { e.preventDefault(); }); // keep text caret
            return $b;
        }
        $tb.append(fmtBtn("bold", "Bold", "bold", "bold", "slBtnBold"));
        $tb.append(fmtBtn("italic", "Italic", "italic", "italic", "slBtnItalic"));
        $tb.append(fmtBtn("underline", "Underline", "underline", "underline", "slBtnUnderline"));
        $tb.append('<div class="of-tsep"></div>');

        [["align left", "left"], ["align center", "center"], ["align right", "right"]].forEach(function (a) {
            $tb.append(tbtn(a[0], "Align text " + a[1], function () {
                applyToSel(function (o) {
                    if (o.type === "text") { o.props.align = a[1]; return true; }
                    return false;
                });
            }));
        });
        $tb.append('<div class="of-tsep"></div>');

        function colorInput(id, title, def) {
            return $('<input type="color" class="of-tcolor" id="' + id + '" title="' + esc(title) + '" value="' + def + '">');
        }
        $tb.append('<span class="sl-tlabel">Text</span>');
        var $tc = colorInput("slTextColor", "Text color", "#202124");
        $tc.on("change", function () {
            var v = $tc.val();
            if (editingId) {
                // color only the selected text / cell content
                try { document.execCommand("foreColor", false, v); } catch (e) { }
                return;
            }
            applyToSel(function (o) {
                if (o.type === "text" || o.type === "table") { o.props.color = v; return true; }
                if (o.type === "shape") { o.props.textColor = v; return true; }
                return false;
            });
        });
        $tb.append($tc);
        $tb.append('<span class="sl-tlabel">Fill</span>');
        var $fc = colorInput("slFillColor", "Shape fill color", "#e07b1f");
        $fc.on("change", function () {
            var v = $fc.val();
            applyToSel(function (o) {
                if (o.type === "shape") { o.props.fill = v; return true; }
                return false;
            });
        });
        $tb.append($fc);
        $tb.append('<span class="sl-tlabel">Line</span>');
        var $sc = colorInput("slStrokeColor", "Line / border color", "#333333");
        $sc.on("change", function () {
            var v = $sc.val();
            applyToSel(function (o) {
                if (o.type === "shape" || o.type === "line") { o.props.stroke = v; return true; }
                return false;
            });
        });
        $tb.append($sc);
        var $sw = $('<input type="number" class="of-tinput sl-num" id="slStrokeW" min="0" max="30" step="1" title="Line / border width" value="2">');
        $sw.on("change", function () {
            var v = clamp(parseInt($sw.val(), 10) || 0, 0, 30);
            $sw.val(v);
            applyToSel(function (o) {
                if (o.type === "shape") { o.props.strokeW = v; return true; }
                if (o.type === "line") { o.props.strokeW = Math.max(1, v); return true; }
                return false;
            });
        });
        $tb.append($sw);
        $tb.append('<div class="of-tsep"></div>');

        var $snap = tbtn("magnet", "Snap to grid (10 px)", function () {
            snapGrid = !snapGrid;
            OfficeApp.setSetting("snapGrid", snapGrid);
            $snap.toggleClass("active", snapGrid);
        }, "slBtnSnap");
        $snap.toggleClass("active", snapGrid);
        $tb.append($snap);

        $tb.append('<div class="sl-spacer"></div>');
        var $present = $('<button type="button" class="of-tbtn sl-present-btn" title="Present (F5)">' +
            '<i class="play icon"></i>&nbsp;Present</button>');
        $present.on("click", function () { startPresent(cur); });
        $tb.append($present);
    }

    function syncToolbarFromSel() {
        var so = selObjs();
        var o = so.length ? so[0] : null;
        if (!o) return;
        var p = o.props;
        if (o.type === "text" || o.type === "shape" || o.type === "table") {
            $("#slFontSize").val(Number(p.fontSize) || (o.type === "table" ? 16 : 24));
        }
        var tcol = o.type === "shape" ? p.textColor : p.color;
        if (tcol && /^#[0-9a-fA-F]{6}$/.test(tcol)) $("#slTextColor").val(tcol);
        if (o.type === "shape" && p.fill && /^#[0-9a-fA-F]{6}$/.test(p.fill)) $("#slFillColor").val(p.fill);
        if ((o.type === "shape" || o.type === "line") && p.stroke && /^#[0-9a-fA-F]{6}$/.test(p.stroke)) {
            $("#slStrokeColor").val(p.stroke);
        }
        if (o.type === "shape" || o.type === "line") $("#slStrokeW").val(Number(p.strokeW) || 0);
        $("#slBtnBold").toggleClass("active", !!p.bold);
        $("#slBtnItalic").toggleClass("active", !!p.italic);
        $("#slBtnUnderline").toggleClass("active", !!p.underline);
    }

    /* ================= notes panel ================= */
    function toggleNotes() {
        var collapsed = $("#slNotes").toggleClass("collapsed").hasClass("collapsed");
        OfficeApp.setSetting("notesCollapsed", collapsed);
        layoutCanvas();
    }
    function initNotes() {
        if (OfficeApp.getSetting("notesCollapsed", false)) $("#slNotes").addClass("collapsed");
        $("#slNotesHead").on("click", toggleNotes);
        $("#slNotesText").on("input", function () {
            curSlide().notes = this.value;
            OfficeApp.markDirty();
            undo.pushDebounced(snap, 900);
            renderThumbSoon(cur);
        });
    }

    /* ================= undo / redo ================= */
    function doUndo() { endEdit(true); undo.undo(); }
    function doRedo() { endEdit(true); undo.redo(); }
    function applyUndoState(state) {
        try { body = normalizeBody(JSON.parse(state)); } catch (e) { return; }
        editingId = null;
        editingKind = null;
        cur = clamp(cur, 0, body.slides.length - 1);
        sel = sel.filter(function (id) { return !!objById(id); });
        renderAll();
        OfficeApp.markDirty();
    }

    /* ================= present / print ================= */
    function startPresent(fromIndex) {
        endEdit(true);
        if (window.SlidesPresent) SlidesPresent.start(fromIndex);
    }
    function fillPrintArea() {
        var $pa = $("#slPrintArea").empty();
        body.slides.forEach(function (s) {
            var $pg = $('<div class="sl-print-page"><div class="sl-slidebase"></div></div>');
            renderSlideContent($pg.find(".sl-slidebase")[0], s);
            $pa.append($pg);
        });
    }
    function clearPrintArea() { $("#slPrintArea").empty(); }

    /* ================= PPTX import / export ================= */
    var PPTX_BACKEND = "Office/slides/backend/pptx.agi";

    /* Load a .pptx from ArozOS storage through the "office" AGI lib. */
    function importPptx(fp, fn) {
        OfficeApp.showBusy("Importing " + fn + "...");
        ao_module_agirun(PPTX_BACKEND, { action: "import", src: fp }, function (data) {
            OfficeApp.hideBusy();
            if (!data || data.error) {
                OfficeApp.toast("Import failed: " + ((data && data.error) || "no response"), "error");
                return;
            }
            var b = data.body;
            if (typeof b === "string") {
                try { b = JSON.parse(b); } catch (e) { b = null; }
            }
            if (!b || !b.slides) {
                OfficeApp.toast("Import failed: unexpected response", "error");
                return;
            }
            body = normalizeBody(b);
            cur = 0;
            sel = [];
            editingId = null;
            renderAll();
            undo.init(snap());
            OfficeApp.markDirty();
            OfficeApp.setStatus("Imported " + fn + " - use Save to store it as .ppta");
        }, function () {
            OfficeApp.hideBusy();
            OfficeApp.toast("Import failed: cannot reach the ArozOS backend", "error");
        }, 120000);
    }
    function importPptxDialog() {
        try {
            ao_module_openFileSelector(function (files) {
                if (files && files.length > 0) importPptx(files[0].filepath, files[0].filename);
            }, "user:/Desktop", "file", false, { filter: ["pptx"] });
        } catch (e) {
            OfficeApp.toast("File selector is not available here", "error");
        }
    }

    /* Rasterize a chart spec to a PNG dataURL (charts export as pictures). */
    function rasterizeChartToPng(spec, w, h) {
        return new Promise(function (resolve) {
            w = Math.max(60, Math.round(w)); h = Math.max(60, Math.round(h));
            var svg = OfficeCharts.renderToString(spec, w, h)
                .replace('width="100%" height="100%"', 'width="' + w + '" height="' + h + '"');
            // charts inherit currentColor for text - fix it for export
            svg = svg.replace("<svg ", '<svg color="#202124" ');
            var img = new Image();
            img.onload = function () {
                try {
                    var cv = document.createElement("canvas");
                    cv.width = w * 2; cv.height = h * 2;
                    var ctx = cv.getContext("2d");
                    ctx.fillStyle = "#ffffff";
                    ctx.fillRect(0, 0, cv.width, cv.height);
                    ctx.drawImage(img, 0, 0, cv.width, cv.height);
                    resolve(cv.toDataURL("image/png"));
                } catch (e) { resolve(null); }
            };
            img.onerror = function () { resolve(null); };
            img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
        });
    }

    /* Convert a same-origin image URL (media?file=...) to a PNG dataURL. */
    function urlToDataUrl(src) {
        return fetch(src).then(function (r) {
            if (!r.ok) throw new Error("http " + r.status);
            return r.blob();
        }).then(function (blob) {
            return new Promise(function (resolve, reject) {
                var reader = new FileReader();
                reader.onload = function () { resolve(reader.result); };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        });
    }

    /* Deep-clone the body and inline every image / chart as a dataURL so the
       server-side exporter can embed them into the .pptx. */
    function prepareBodyForPptx() {
        var b = deep(body);
        var jobs = [];
        b.slides.forEach(function (s) {
            s.objects.forEach(function (o) {
                if (o.type === "chart") {
                    jobs.push(rasterizeChartToPng(o.props.spec || {}, o.w, o.h).then(function (png) {
                        if (png) o.props.png = png;
                    }));
                } else if (o.type === "image" && o.props.src && !/^data:/i.test(o.props.src)) {
                    jobs.push(urlToDataUrl(o.props.src).then(function (durl) {
                        o.props.src = durl;
                    }).catch(function () { /* leave original src; exporter skips it */ }));
                }
            });
        });
        return Promise.all(jobs).then(function () { return b; });
    }

    function exportPptx() {
        endEdit(true);
        var defName = OfficeApp.stripExt(OfficeApp.getFileName() || "New Presentation.ppta") + ".pptx";
        try {
            ao_module_openFileSelector(function (files) {
                if (!files || !files.length) return;
                var fp = files[0].filepath;
                if (!/\.pptx$/i.test(fp)) fp += ".pptx";
                OfficeApp.showBusy("Exporting PowerPoint file...");
                prepareBodyForPptx().then(function (prepared) {
                    ao_module_agirun(PPTX_BACKEND, {
                        action: "export",
                        dest: fp,
                        data: JSON.stringify(prepared)
                    }, function (data) {
                        OfficeApp.hideBusy();
                        if (data && data.error) {
                            OfficeApp.toast("Export failed: " + data.error, "error");
                        } else {
                            OfficeApp.setStatus("Exported " + OfficeApp.basename(fp));
                            OfficeApp.toast("Exported " + OfficeApp.basename(fp));
                        }
                    }, function () {
                        OfficeApp.hideBusy();
                        OfficeApp.toast("Export failed: cannot reach the ArozOS backend", "error");
                    }, 180000);
                }).catch(function (err) {
                    OfficeApp.hideBusy();
                    OfficeApp.toast("Export failed: " + (err && err.message ? err.message : "prepare error"), "error");
                });
            }, "user:/Desktop", "new", false, { defaultName: defName });
        } catch (e) {
            OfficeApp.toast("File selector is not available here", "error");
        }
    }

    /* ================= menus ================= */
    function insertMenuItems() {
        return [
            { label: "Text box", icon: "font", action: insertText },
            {
                label: "Image", icon: "image outline", sub: [
                    { label: "From ArozOS storage...", icon: "folder open", action: imageFromStorage },
                    { label: "From this device...", icon: "upload", action: imageFromDevice },
                    { label: "From URL...", icon: "linkify", action: imageFromUrl }
                ]
            },
            {
                label: "Shape", icon: "object group", sub: SHAPE_KINDS.map(function (s) {
                    return { label: s.label, action: function () { insertShape(s.kind); } };
                })
            },
            { label: "Line", icon: "minus", action: function () { armDraw("line"); } },
            { label: "Arrow", icon: "long arrow alternate right", action: function () { armDraw("arrow"); } },
            { label: "Table...", icon: "table", action: tableDialog },
            { label: "Chart...", icon: "chart bar", action: function () { chartDialog(null); } },
            { sep: true },
            { label: "New slide", icon: "plus", key: "Ctrl+M", action: function () { addSlideAfter(cur); } }
        ];
    }
    function slideMenuItems() {
        return [
            { label: "New slide", icon: "plus", key: "Ctrl+M", action: function () { addSlideAfter(cur); } },
            { label: "Duplicate slide", icon: "clone outline", key: "Ctrl+D", action: function () { duplicateSlide(cur); } },
            { label: "Delete slide", icon: "trash alternate outline", action: function () { deleteSlide(cur); } },
            { sep: true },
            {
                label: "Move slide up", icon: "angle up",
                enabled: function () { return cur > 0; },
                action: function () { moveSlide(cur, -1); }
            },
            {
                label: "Move slide down", icon: "angle down",
                enabled: function () { return cur < body.slides.length - 1; },
                action: function () { moveSlide(cur, 1); }
            },
            { sep: true },
            { label: "Background...", icon: "paint brush", action: function () { bgDialog(cur); } }
        ];
    }
    function formatMenuItems() {
        var hasSel = function () { return sel.length > 0; };
        return [
            { label: "Align to slide", icon: "align center", enabled: hasSel, sub: alignSub },
            { label: "Order", icon: "bars", enabled: hasSel, sub: orderSub },
            { sep: true },
            { label: "Duplicate object", icon: "clone outline", key: "Ctrl+D", enabled: hasSel, action: duplicateSelection },
            { label: "Delete object", icon: "trash alternate outline", key: "Del", enabled: hasSel, action: deleteSelection }
        ];
    }
    function designMenuItems() {
        var items = Object.keys(THEMES).map(function (k) {
            return {
                label: THEMES[k].label,
                checked: function () { return body.theme === k; },
                action: function () { setTheme(k); }
            };
        });
        items.push({ sep: true });
        items.push({ label: "Browse themes...", icon: "paint brush", action: themeDialog });
        return items;
    }

    /* ================= init ================= */
    function initDomRefs() {
        canvasEl = document.getElementById("slCanvas");
        layerEl = document.getElementById("slSlideLayer");
        layerEl.className = "sl-slidebase";
        var overlay = document.getElementById("slOverlay");
        overlay.innerHTML = '<div id="slFrames"></div>' +
            '<div id="slGuideV" class="sl-guide"></div>' +
            '<div id="slGuideH" class="sl-guide"></div>' +
            '<div id="slMarquee"></div>';
        framesEl = document.getElementById("slFrames");
        guideVEl = document.getElementById("slGuideV");
        guideHEl = document.getElementById("slGuideH");
        marqueeEl = document.getElementById("slMarquee");

        canvasEl.addEventListener("pointerdown", onCanvasPointerDown);
        canvasEl.addEventListener("pointermove", onCanvasPointerMove);
        canvasEl.addEventListener("pointerup", onCanvasPointerUp);
        canvasEl.addEventListener("pointercancel", onCanvasPointerUp);
        canvasEl.addEventListener("dblclick", onCanvasDblClick);
        canvasEl.addEventListener("contextmenu", onCanvasContextMenu);

        // click on the gray area around the canvas deselects
        document.getElementById("slCanvasArea").addEventListener("pointerdown", function (e) {
            if (e.target.id === "slCanvasArea" || e.target.id === "slCanvasWrap") {
                endEdit(true);
                setSel([]);
            }
        });

        $("#slRailAdd").on("click", function () { addSlideAfter(body.slides.length - 1); });

        $("#slDeviceImage").on("change", function () {
            var files = this.files;
            for (var i = 0; i < files.length; i++) {
                (function (f) {
                    var reader = new FileReader();
                    reader.onload = function () { placeImage(reader.result); };
                    reader.readAsDataURL(f);
                })(files[i]);
            }
            this.value = "";
        });

        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("resize", layoutCanvas);
    }

    function init() {
        snapGrid = false;
        undo = new OfficeUndoStack({ limit: 100, apply: applyUndoState });

        initDomRefs();

        OfficeApp.init({
            appName: "Slides",
            appType: "presentation",
            appIcon: "../img/slides.svg",
            extension: ".ppta",
            fileTypeName: "Presentation",
            defaultFileName: "New Presentation",

            serialize: function () { return deep(body); },
            deserialize: function (b) {
                body = normalizeBody(b);
                cur = 0;
                sel = [];
                editingId = null;
                renderAll();
                undo.init(snap());
            },
            create: function () {
                body = defaultBody();
                cur = 0;
                sel = [];
                editingId = null;
                renderAll();
                undo.init(snap());
            },

            onUndo: doUndo,
            onRedo: doRedo,
            canUndo: function () { return undo.canUndo(); },
            canRedo: function () { return undo.canRedo(); },

            onCut: function () {
                if (editingId) { try { document.execCommand("cut"); } catch (e) { } return; }
                cutSelection();
            },
            onCopy: function () {
                if (editingId) { try { document.execCommand("copy"); } catch (e) { } return; }
                copySelection();
            },
            onPaste: function () {
                if (editingId) {
                    if (navigator.clipboard && navigator.clipboard.readText) {
                        navigator.clipboard.readText().then(function (t) {
                            try { document.execCommand("insertText", false, t); } catch (e) { }
                        }).catch(function () { });
                    }
                    return;
                }
                // menu-driven paste: async clipboard - try images first, then
                // the internal object clipboard, then plain text
                var fallback = function () {
                    if (pasteClipboard()) return;
                    if (navigator.clipboard && navigator.clipboard.readText) {
                        navigator.clipboard.readText().then(function (t) {
                            if (!t) return;
                            var th = themeOf();
                            addObj("text", { html: esc(t).replace(/\n/g, "<br>"), fontSize: 24, color: th.text, align: "left" },
                                { x: 280, y: 220, w: 400, h: 90 });
                        }).catch(function () {
                            OfficeApp.setStatus("Nothing to paste", "error");
                        });
                    }
                };
                if (navigator.clipboard && navigator.clipboard.read) {
                    navigator.clipboard.read().then(function (cbItems) {
                        var found = null;
                        cbItems.forEach(function (it) {
                            it.types.forEach(function (ty) {
                                if (!found && ty.indexOf("image/") === 0) found = { it: it, ty: ty };
                            });
                        });
                        if (found) {
                            found.it.getType(found.ty).then(function (blob) { fileToImage(blob); });
                        } else { fallback(); }
                    }).catch(fallback);
                } else { fallback(); }
            },

            menus: [
                { title: "Insert", items: insertMenuItems },
                { title: "Slide", items: slideMenuItems },
                { title: "Format", items: formatMenuItems },
                { title: "Design", items: designMenuItems }
            ],
            binaryImporters: {
                ".pptx": importPptx
            },
            fileMenuExtras: [
                { label: "Import PowerPoint (.pptx)...", icon: "file powerpoint outline", action: importPptxDialog },
                {
                    label: "Export", icon: "external alternate", sub: [
                        {
                            label: "PowerPoint (.pptx)", icon: "file powerpoint outline",
                            action: exportPptx
                        },
                        {
                            label: "PDF document (.pdf)", icon: "file pdf outline",
                            action: function () { SlidesExport.exportPDF(); }
                        },
                        {
                            label: "Current slide as PNG", icon: "file image outline",
                            action: function () { SlidesExport.exportPNG(false); }
                        },
                        {
                            label: "All slides as PNGs", icon: "images outline",
                            action: function () { SlidesExport.exportPNG(true); }
                        }
                    ]
                }
            ],
            viewMenuExtras: [
                { label: "Present", icon: "play", key: "F5", action: function () { startPresent(cur); } },
                { label: "Present from beginning", icon: "play circle outline", action: function () { startPresent(0); } },
                { sep: true },
                {
                    label: "Speaker notes",
                    checked: function () { return !$("#slNotes").hasClass("collapsed"); },
                    action: toggleNotes
                },
                {
                    label: "Snap to grid",
                    checked: function () { return snapGrid; },
                    action: function () {
                        snapGrid = !snapGrid;
                        OfficeApp.setSetting("snapGrid", snapGrid);
                        $("#slBtnSnap").toggleClass("active", snapGrid);
                    }
                }
            ],

            onZoomChanged: function (pct) {
                zoomPct = pct;
                layoutCanvas();
            },
            onBeforePrint: fillPrintArea,
            onAfterPrint: clearPrintArea
        });

        snapGrid = !!OfficeApp.getSetting("snapGrid", false);
        buildToolbar();
        initNotes();
        initClipboardAndDnd();

        OfficeApp.addStatusItem("slide", "");
        OfficeApp.addStatusItem("sel", "");
        updateStatus();

        OfficeApp.registerShortcut("Ctrl+M", function () { addSlideAfter(cur); });

        zoomPct = OfficeApp.getZoom();
        layoutCanvas();
        setTimeout(layoutCanvas, 120);   // once chrome has settled
    }

    $(document).ready(init);

    /* ---------- public API (used by present.js) ---------- */
    return {
        getBody: function () { return body; },
        getCurrentIndex: function () { return cur; },
        renderSlideContent: renderSlideContent,
        themeOf: themeOf,
        slideCount: function () { return body ? body.slides.length : 0; }
    };
})();
