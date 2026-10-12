/*
    node web/Office/slides/test_lines.js

    Checks the line styling (slides_lines.js) and the shape adjustments
    (slides_shapes.js) without a browser: the canvas and the PDF exporter
    both draw from these, so a wrong number here is wrong everywhere.
*/
"use strict";
var fs = require("fs");
var path = require("path");

global.window = global;
/* eslint-disable no-eval */
eval(fs.readFileSync(path.join(__dirname, "slides_shapes.js"), "utf8") + "\nglobal.SlidesShapes = SlidesShapes;");
var SlidesLines = require("./slides_lines.js");

var failures = 0;
function check(name, ok, detail) {
    if (!ok) {
        failures++;
        console.log("FAIL " + name + (detail ? ": " + detail : ""));
    }
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol || 0.01); }

/* ---- reading and writing the props ---- */
check("legacy dash", SlidesLines.dashOf({ dash: true }) === "legacy");
check("legacy dash array", JSON.stringify(SlidesLines.dashArray({ dash: true }, 2)) === "[6,4.8]");
check("solid has no dash", SlidesLines.dashArray({}, 2) === null);
check("dot pattern", JSON.stringify(SlidesLines.dashArray({ dashStyle: "dot" }, 3)) === "[3,3]");
check("dash-dot pattern", JSON.stringify(SlidesLines.dashArray({ dashStyle: "dashDot" }, 2)) === "[8,6,2,6]");
check("preset dashes are flat", SlidesLines.capOf({ dashStyle: "dash" }) === "butt");
check("solid is round", SlidesLines.capOf({}) === "round");
check("legacy arrowEnd", SlidesLines.headOf({ arrowEnd: true }, true) === "triangle");
check("no start by default", SlidesLines.headOf({}, false) === "none");
check("unknown head is none", SlidesLines.headOf({ endHead: "bogus" }, true) === "none");

var p = {};
SlidesLines.setHead(p, true, "openCircle");
check("setHead end", p.endHead === "openCircle" && p.arrowEnd === true);
SlidesLines.setHead(p, true, "none");
check("setHead none clears the flag", p.endHead === "none" && p.arrowEnd === false);
SlidesLines.setDash(p, "longDash");
check("setDash", p.dashStyle === "longDash" && p.dash === true);
SlidesLines.setDash(p, "solid");
check("setDash solid", p.dashStyle === "solid" && p.dash === false && SlidesLines.dashArray(p, 2) === null);

/* ---- geometry ---- */
var pts = [[0, 0], [100, 0]];
SlidesLines.HEADS.forEach(function (h) {
    var g = SlidesLines.geometry(pts, { endHead: h.id }, 2);
    var want = h.id === "none" ? 0 : 1;
    check("head " + h.id + " drawn", g.heads.length === want, JSON.stringify(g.heads));
    // the stroke never pokes out past the tip
    check("head " + h.id + " keeps the line inside", g.line[1][0] <= 100);
});
var s = 6 + 2 * 2.4;
var tri = SlidesLines.geometry(pts, { endHead: "triangle" }, 2);
check("filled arrow tip", near(tri.heads[0].pts[0][0], 100) && near(tri.heads[0].pts[0][1], 0));
check("filled arrow pulls the line back", near(tri.line[1][0], 100 - s * 0.6));
var oc = SlidesLines.geometry(pts, { endHead: "openCircle" }, 2);
check("open circle is stroked", oc.heads[0].kind === "circle" && oc.heads[0].fill === false);
check("open circle: line stops at its edge", near(oc.line[1][0], 100 - s * 0.4));
var st = SlidesLines.geometry(pts, { startHead: "square" }, 2);
check("start head at the start", near(st.heads[0].pts[0][0] + st.heads[0].pts[2][0], 0, 0.01));
var ar = SlidesLines.geometry(pts, { endHead: "arrow" }, 2);
check("line arrow is an open V", ar.heads[0].closed === false && ar.heads[0].fill === false);
// a vertical line turns its heads with it
var v = SlidesLines.geometry([[0, 0], [0, 50]], { endHead: "triangle" }, 2);
check("head follows the direction", near(v.heads[0].pts[0][1], 50) && near(v.heads[0].pts[1][1], 50 - s));
check("svg markup", SlidesLines.svgMarkup(pts, { endHead: "diamond", dashStyle: "dot" }, 2, "#123456")
    .indexOf('stroke-dasharray="2 2"') > 0);

/* ---- callout adjustments ---- */
["wedgeRectCallout", "wedgeRoundRectCallout", "wedgeEllipseCallout", "cloudCallout"].forEach(function (k) {
    check(k + " is adjustable", SlidesShapes.adjustable(k) === "tip");
    var d = SlidesShapes.tipDefaults(k);
    check(k + " defaults", d.adj1 === -20833 && d.adj2 === 62500);
    var tip = SlidesShapes.tipPoint(k, 200, 100, { adj1: 50000, adj2: -100000 });
    check(k + " tip", near(tip[0], 200) && near(tip[1], -50), JSON.stringify(tip));
    var path2 = SlidesShapes.path(k, 200, 100, { adj1: 50000, adj2: -100000 });
    // the cloud's last bubble is a small circle centred on the tip
    var reach = k === "cloudCallout" ? /M203\.5 -50/ : /L200 -50|200 -50/;
    check(k + " path reaches the tip", reach.test(path2), path2.substring(0, 160));
    check(k + " legacy path unchanged", SlidesShapes.path(k, 200, 100) !== path2);
});
check("roundRect adjusts its radius", SlidesShapes.adjustable("roundRect") === "radius");
check("rect has no adjustment", SlidesShapes.adjustable("rect") === "");
// the rectangular tail leaves the side the tip is beyond, between 2/12
// and 5/12 of it when the tip is on the left half
var below = SlidesShapes.path("wedgeRectCallout", 120, 60, { adj1: -20833, adj2: 62500 });
check("tail on the bottom side", below.indexOf("L50 60L25") > 0 || below.indexOf("L50 60") > 0, below);

/* ---- preset handles ---- */
// every handle lands back where it was dragged from, and the outline it
// leads to is a real path
SlidesShapes.CATEGORIES.forEach(function (c) {
    c.kinds.forEach(function (k) {
        [[200, 100], [80, 240]].forEach(function (sz) {
            SlidesShapes.handles(k, sz[0], sz[1], null).forEach(function (pt, i) {
                var adj = SlidesShapes.dragHandle(k, i, sz[0], sz[1], pt[0], pt[1], null);
                var back = SlidesShapes.handles(k, sz[0], sz[1], adj)[i];
                check(k + " handle " + i + " round trip at " + sz,
                    near(back[0], pt[0], 0.5) && near(back[1], pt[1], 0.5), JSON.stringify([pt, back, adj]));
                var d = SlidesShapes.path(k, sz[0], sz[1], adj);
                check(k + " adjusted path", d && !/NaN/.test(d), d);
            });
        });
    });
});
// a right arrow: the shaft's thickness at the tail, the head's base on top
var ra = SlidesShapes.handles("rightArrow", 200, 100, null);
check("arrow handles", ra.length === 2 && near(ra[0][0], 0) && near(ra[0][1], 25) &&
    near(ra[1][0], 150) && near(ra[1][1], 0), JSON.stringify(ra));
var thin = SlidesShapes.dragHandle("rightArrow", 0, 200, 100, 0, 40, null);
check("arrow shaft drag", thin.adj1 === 20000 && thin.adj2 === 50000, JSON.stringify(thin));
var longHead = SlidesShapes.dragHandle("rightArrow", 1, 200, 100, 100, 0, thin);
check("arrow head drag keeps the shaft", longHead.adj1 === 20000 && longHead.adj2 === 100000, JSON.stringify(longHead));
check("arrow head is capped by the length",
    SlidesShapes.dragHandle("rightArrow", 1, 200, 100, -500, 0, null).adj2 === 200000);
// the same drag on an up arrow, whose head is at the top
var ua = SlidesShapes.dragHandle("upArrow", 1, 100, 200, 0, 100, null);
check("up arrow head drag", ua.adj2 === 100000, JSON.stringify(ua));
// a rounded single corner: the handle is where the corner ends
var r1 = SlidesShapes.dragHandle("round1Rect", 0, 200, 100, 170, 0, null);
check("corner drag", r1.adj === 30000, JSON.stringify(r1));
check("corner is capped at half", SlidesShapes.dragHandle("round1Rect", 0, 200, 100, 0, 0, null).adj === 50000);
check("star inner radius", SlidesShapes.dragHandle("star5", 0, 100, 100, 50, 25, null).adj === 25000);
check("points follow adjustments",
    JSON.stringify(SlidesShapes.points("triangle", 100, 50, { adj: 0 })[0]) === "[0,0]");
check("rect has no handles", SlidesShapes.handles("rect", 100, 100, null).length === 0);
check("roundRect keeps its radius handle in slides.js", SlidesShapes.handles("roundRect", 100, 100, null).length === 0);

if (failures) {
    console.log(failures + " check(s) failed");
    process.exit(1);
}
console.log("slides lines & adjustments: all checks passed");
