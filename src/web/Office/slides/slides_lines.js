/*
    ArozOS Slides - line styling (SlidesLines)

    What a line looks like along its length and at its ends, the way
    Google Slides offers it: a weight, one of six dash styles, and one of
    ten ends at each end (none, a line arrow, a filled arrow, a filled
    circle, square or diamond, and open versions of the last four).

    Everything that draws a line asks this module - the canvas (slides.js
    lineSvg / shapeSvg / imageHtml), the thumbnails and present mode (the
    same render), and the PDF exporter (slides_pdf.js) - so the editor and
    the PDF cannot disagree about where a dash falls or how big a head is.
    Geometry comes back as plain points in the caller's own coordinates.

    Props (on a line; weight and dash also on shapes and picture frames):
        strokeW    the weight, px
        dashStyle  "solid" | "dot" | "dash" | "dashDot" | "longDash" | "longDashDot"
        startHead / endHead   one of HEADS below
    A document written before these existed has only dash (a plain dash,
    drawn the way it always was) and arrowStart / arrowEnd (a filled
    arrow); setDash / setHead keep those in step so older readers still
    see the gist. The .pptx mapping is in mod/office/pptx_lines.go.
*/
var SlidesLines = (function () {
    "use strict";

    var WEIGHTS = [1, 2, 3, 4, 8, 12, 16, 24];

    var DASHES = [
        { id: "solid", label: "Solid" },
        { id: "dot", label: "Dot" },
        { id: "dash", label: "Dash" },
        { id: "dashDot", label: "Dash-dot" },
        { id: "longDash", label: "Long dash" },
        { id: "longDashDot", label: "Long dash-dot" }
    ];
    // dash / gap lengths in multiples of the weight - PowerPoint's own
    // presets (sysDot, dash, dashDot, lgDash, lgDashDot), drawn with flat
    // caps as PowerPoint draws them
    var PATTERN = {
        dot: [1, 1],
        dash: [4, 3],
        dashDot: [4, 3, 1, 3],
        longDash: [8, 3],
        longDashDot: [8, 3, 1, 3]
    };

    var HEADS = [
        { id: "none", label: "None" },
        { id: "arrow", label: "Arrow" },
        { id: "triangle", label: "Filled arrow" },
        { id: "circle", label: "Filled circle" },
        { id: "square", label: "Filled square" },
        { id: "diamond", label: "Filled diamond" },
        { id: "openTriangle", label: "Open arrow" },
        { id: "openCircle", label: "Open circle" },
        { id: "openSquare", label: "Open square" },
        { id: "openDiamond", label: "Open diamond" }
    ];
    var HEAD_IDS = {};
    HEADS.forEach(function (h) { HEAD_IDS[h.id] = true; });

    /* ---------- reading the props ---------- */
    // "solid", a PATTERN key, or "legacy" (the old dash: true)
    function dashOf(p) {
        p = p || {};
        if (p.dashStyle && PATTERN[p.dashStyle]) return p.dashStyle;
        if (p.dashStyle === "solid") return "solid";
        return p.dash ? "legacy" : "solid";
    }
    // the dash pattern at weight sw, or null for a solid line
    function dashArray(p, sw) {
        var d = dashOf(p);
        if (d === "solid") return null;
        if (d === "legacy") return [sw * 3, sw * 2.4];
        return PATTERN[d].map(function (v) { return v * sw; });
    }
    // the cap a line is drawn with: a preset dash is flat, as in PowerPoint,
    // or a dot would come out as a smear; everything else keeps the round
    // cap the editor has always drawn
    function capOf(p) {
        var d = dashOf(p);
        return (d === "solid" || d === "legacy") ? "round" : "butt";
    }
    function headOf(p, end) {
        p = p || {};
        var v = end ? p.endHead : p.startHead;
        if (v) return HEAD_IDS[v] ? v : "none";
        return (end ? p.arrowEnd : p.arrowStart) ? "triangle" : "none";
    }

    /* ---------- writing them ---------- */
    function setDash(p, id) {
        if (!id || id === "solid" || !PATTERN[id]) {
            p.dashStyle = "solid";
            p.dash = false;
        } else {
            p.dashStyle = id;
            p.dash = true;
        }
    }
    function setHead(p, end, id) {
        if (!HEAD_IDS[id]) id = "none";
        if (end) { p.endHead = id; p.arrowEnd = id !== "none"; }
        else { p.startHead = id; p.arrowStart = id !== "none"; }
    }

    /* ---------- geometry ---------- */
    /*
        pts: the line's polyline [[x,y], ...] (at least two points), in any
        coordinates. Returns { line: the polyline to stroke, pulled back
        where a head would show it through, heads: [...] } where a head is
          { kind: "poly", pts, closed, fill }   fill: true = filled with the
                                                 line colour, false = stroked
          { kind: "circle", cx, cy, r, fill }
        A stroked head is drawn at the line's own weight.
    */
    function geometry(pts, p, sw) {
        var line = pts.map(function (pt) { return [pt[0], pt[1]]; });
        var heads = [];
        var s = 6 + sw * 2.4;          // the head's length
        var hw = s * 0.45;             // half its width

        function one(tipIdx, fromIdx, type) {
            if (type === "none") return;
            var tip = pts[tipIdx], from = pts[fromIdx];
            var dx = tip[0] - from[0], dy = tip[1] - from[1];
            var len = Math.sqrt(dx * dx + dy * dy);
            if (!(len > 0)) return;
            var ux = dx / len, uy = dy / len;          // along the line, to the tip
            var nx = -uy, ny = ux;                     // across it
            var at = function (a, b) {                 // a along, b across, from the tip
                return [tip[0] + ux * a + nx * b, tip[1] + uy * a + ny * b];
            };
            var pull = 0;                              // how far the line stops short
            var open = type.indexOf("open") === 0;
            var base = open ? type.charAt(4).toLowerCase() + type.substring(5) : type;
            if (base === "arrow") {
                heads.push({ kind: "poly", pts: [at(-s, hw), at(0, 0), at(-s, -hw)], closed: false, fill: false });
                pull = sw * 0.5;
            } else if (base === "triangle") {
                heads.push({ kind: "poly", pts: [at(0, 0), at(-s, hw), at(-s, -hw)], closed: true, fill: !open });
                pull = open ? s : s * 0.6;
            } else if (base === "circle") {
                var r = s * 0.4;
                heads.push({ kind: "circle", cx: tip[0], cy: tip[1], r: r, fill: !open });
                pull = open ? r : 0;
            } else if (base === "square") {
                var a = s * 0.35;
                heads.push({ kind: "poly", pts: [at(a, a), at(a, -a), at(-a, -a), at(-a, a)], closed: true, fill: !open });
                pull = open ? a : 0;
            } else if (base === "diamond") {
                var d = s * 0.45;
                heads.push({ kind: "poly", pts: [at(d, 0), at(0, d), at(-d, 0), at(0, -d)], closed: true, fill: !open });
                pull = open ? d : 0;
            } else {
                return;
            }
            if (pull > 0) {
                var k = Math.min(pull, len * 0.9);
                line[tipIdx] = [tip[0] - ux * k, tip[1] - uy * k];
            }
        }
        var n = pts.length;
        if (n >= 2) {
            one(n - 1, n - 2, headOf(p, true));
            one(0, 1, headOf(p, false));
        }
        return { line: line, heads: heads };
    }

    /* ---------- SVG ---------- */
    function f1(v) { return (Math.round(v * 10) / 10).toString(); }
    function ptsAttr(list) {
        return list.map(function (pt) { return f1(pt[0]) + "," + f1(pt[1]); }).join(" ");
    }
    function esc(s) {
        return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    }
    // the stroke and heads of a line as SVG markup, in pts' coordinates
    function svgMarkup(pts, p, sw, color) {
        var g = geometry(pts, p, sw);
        var dash = dashArray(p, sw);
        var col = esc(color);
        var out = '<polyline points="' + ptsAttr(g.line) + '" fill="none" stroke="' + col +
            '" stroke-width="' + sw + '" stroke-linecap="' + capOf(p) + '" stroke-linejoin="round"' +
            (dash ? ' stroke-dasharray="' + dash.map(f1).join(" ") + '"' : "") + "/>";
        g.heads.forEach(function (h) {
            var paint = h.fill ? ' fill="' + col + '" stroke="none"'
                : ' fill="none" stroke="' + col + '" stroke-width="' + sw + '" stroke-linejoin="round" stroke-linecap="round"';
            if (h.kind === "circle") {
                out += '<circle cx="' + f1(h.cx) + '" cy="' + f1(h.cy) + '" r="' + f1(h.r) + '"' + paint + "/>";
            } else {
                out += "<" + (h.closed ? "polygon" : "polyline") + ' points="' + ptsAttr(h.pts) + '"' + paint + "/>";
            }
        });
        return out;
    }

    /* ---------- menu and toolbar pictures ---------- */
    function svg(w, h, body) {
        return '<svg class="sl-line-ico" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h +
            '" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible;">' + body + "</svg>";
    }
    // a menu entry's picture of a weight
    function weightIcon(w) {
        var h = Math.max(12, Math.min(24, w + 4));
        return svg(56, h, '<line x1="2" y1="' + (h / 2) + '" x2="54" y2="' + (h / 2) +
            '" stroke="currentColor" stroke-width="' + Math.min(w, 20) + '"/>');
    }
    function dashIcon(id) {
        var p = { dashStyle: id };
        return svg(56, 12, svgMarkup([[2, 6], [54, 6]], p, 2, "currentColor"));
    }
    // end: true pictures the end of a line (pointing right), false its start
    function headIcon(id, end) {
        var p = {};
        setHead(p, end, id);
        // a line from left to right: its start is the left end
        return svg(36, 14, svgMarkup([[5, 7], [31, 7]], p, 1.5, "currentColor"));
    }
    // the toolbar buttons' own glyphs
    var TOOL_ICONS = {
        weight: svg(18, 18, '<line x1="2" y1="4" x2="16" y2="4" stroke="currentColor" stroke-width="1"/>' +
            '<line x1="2" y1="8.5" x2="16" y2="8.5" stroke="currentColor" stroke-width="2"/>' +
            '<line x1="2" y1="14" x2="16" y2="14" stroke="currentColor" stroke-width="3.5"/>'),
        dash: svg(18, 18, '<line x1="2" y1="4" x2="16" y2="4" stroke="currentColor" stroke-width="1.6"/>' +
            '<line x1="2" y1="9" x2="16" y2="9" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 2"/>' +
            '<line x1="2" y1="14" x2="16" y2="14" stroke="currentColor" stroke-width="1.6" stroke-dasharray="1.6 1.6"/>'),
        start: svg(18, 18, '<line x1="5" y1="9" x2="16" y2="9" stroke="currentColor" stroke-width="1.6"/>' +
            '<circle cx="4.5" cy="9" r="2.6" fill="currentColor"/>'),
        end: svg(18, 18, '<line x1="2" y1="9" x2="12" y2="9" stroke="currentColor" stroke-width="1.6"/>' +
            '<polygon points="16.5,9 10.5,5.5 10.5,12.5" fill="currentColor"/>')
    };

    return {
        WEIGHTS: WEIGHTS,
        DASHES: DASHES,
        HEADS: HEADS,
        dashOf: dashOf,
        dashArray: dashArray,
        capOf: capOf,
        headOf: headOf,
        setDash: setDash,
        setHead: setHead,
        geometry: geometry,
        svgMarkup: svgMarkup,
        weightIcon: weightIcon,
        dashIcon: dashIcon,
        headIcon: headIcon,
        toolIcon: function (name) { return TOOL_ICONS[name] || ""; }
    };
})();

if (typeof module !== "undefined" && module.exports) module.exports = SlidesLines;
