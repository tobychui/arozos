/*
    node web/Office/slides/test_lines.js

    Checks the line styling (slides_lines.js) and the callout adjustments
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

if (failures) {
    console.log(failures + " check(s) failed");
    process.exit(1);
}
console.log("slides lines & adjustments: all checks passed");
