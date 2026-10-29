/*
    ArozOS Office Suite - PDF core line measurement tests (common/pdfcore.js)
    Run with: node test_pdfcore.js   (exits 1 on failure)

    The exporters draw each line of text where the browser laid it out, so
    which characters splitByLine puts on which line is what the PDF shows.
    The DOM here is a stand-in: a text node set on lines of fixed-width
    characters, whose ranges answer getClientRects the way Blink / Gecko
    do, or the way WebKit (Safari) does - with one more, empty rect at the
    end of the line above for a range that starts where a line wrapped.
*/
"use strict";
var fs = require("fs");
var path = require("path");

global.window = global;
/* eslint-disable no-eval */
eval(fs.readFileSync(path.join(__dirname, "pdfcore.js"), "utf8") + "\nglobal.OfficePdfCore = OfficePdfCore;");
var C = OfficePdfCore;

var failures = 0, passes = 0;
function eq(name, got, want) {
    if (JSON.stringify(got) === JSON.stringify(want)) { passes++; return; }
    failures++;
    console.log("FAIL " + name + "\n  got:  " + JSON.stringify(got) + "\n  want: " + JSON.stringify(want));
}

/* ---- the stand-in layout ---- */
var CHAR_W = 10, LINE_H = 20, GLYPH_H = 16;

// lines: the node's text, one string per line box; lefts: where each line
// starts (text-align); zero: characters drawn with no width (collapsed spaces)
function layout(lines, o) {
    o = o || {};
    var chars = [];
    lines.forEach(function (ln, li) {
        var x = o.lefts ? o.lefts[li] : 0;
        for (var i = 0; i < ln.length; i++) {
            var w = o.zero && o.zero.indexOf(chars.length) >= 0 ? 0 : CHAR_W;
            chars.push({ line: li, left: x, right: x + w });
            x += w;
        }
    });
    return { text: lines.join(""), chars: chars, lines: lines, webkit: !!o.webkit };
}

function rect(left, right, line) {
    var top = line * LINE_H;
    return { left: left, right: right, top: top, bottom: top + GLYPH_H, width: right - left, height: GLYPH_H };
}

function FakeRange() { this.node = null; this.s = 0; this.e = 0; }
FakeRange.prototype.setStart = function (node, i) { this.node = node; this.s = i; };
FakeRange.prototype.setEnd = function (node, i) { this.node = node; this.e = i; };
FakeRange.prototype.selectNodeContents = function (node) { this.node = node; this.s = 0; this.e = node.text.length; };
FakeRange.prototype.getClientRects = function () {
    var n = this.node, out = [], cur = null;
    for (var i = this.s; i < this.e; i++) {
        var c = n.chars[i];
        if (cur && cur.line === c.line) { cur.right = c.right; continue; }
        if (cur) out.push(rect(cur.left, cur.right, cur.line));
        cur = { line: c.line, left: c.left, right: c.right };
    }
    if (cur) out.push(rect(cur.left, cur.right, cur.line));
    // WebKit: a range starting at a wrap also reports the end of the line above
    var first = n.chars[this.s];
    if (n.webkit && this.e > this.s && first.line > 0 && this.s > 0 && n.chars[this.s - 1].line === first.line - 1) {
        var above = n.chars[this.s - 1];
        out.unshift(rect(above.right, above.right, above.line));
    }
    return out;
};
// the union of every rect, empty ones included, as the browsers compute it
FakeRange.prototype.getBoundingClientRect = function () {
    var rs = this.getClientRects();
    if (!rs.length) return rect(0, 0, 0);
    var b = { left: rs[0].left, right: rs[0].right, top: rs[0].top, bottom: rs[0].bottom };
    rs.forEach(function (r) {
        b.left = Math.min(b.left, r.left); b.right = Math.max(b.right, r.right);
        b.top = Math.min(b.top, r.top); b.bottom = Math.max(b.bottom, r.bottom);
    });
    return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.right - b.left, height: b.bottom - b.top };
};
global.document = { createRange: function () { return new FakeRange(); } };

// what splitByLine makes of a node: [start, text, left, right] per line
function split(node) {
    var r = new FakeRange();
    r.selectNodeContents(node);
    return C.splitByLine(node, node.text, r.getClientRects()).map(function (ln) {
        return [ln.start, ln.text, ln.rect.left, ln.rect.right];
    });
}

/* ---- rangeBox ---- */
(function () {
    var n = layout(["Basics of ", "Reverse Proxy"], { webkit: true });
    var r = new FakeRange();
    r.setStart(n, 10); r.setEnd(n, 11);
    var b = C.rangeBox(r);
    eq("rangeBox skips WebKit's empty rect", [b.left, b.right, b.top, b.width], [0, 10, LINE_H, 10]);
    eq("the bounding box does not", r.getBoundingClientRect().top, 0);

    // a short line under a long one: the bounding box is as wide as the
    // line above, which fitted the text to the wrong width
    var s = layout(["& why they are commonly used in ", "Homelab setups"], { webkit: true });
    r.setStart(s, 32); r.setEnd(s, 46);
    eq("rangeBox of a wrapped line is that line", [C.rangeBox(r).left, C.rangeBox(r).width], [0, 140]);
    eq("the bounding box is the line above's width", r.getBoundingClientRect().width, 320);

    r.setStart(n, 0); r.setEnd(n, 23);
    b = C.rangeBox(r);
    eq("rangeBox unions the lines", [b.left, b.right, b.top, b.bottom], [0, 130, 0, LINE_H + GLYPH_H]);

    var z = layout(["a ", "b"], { zero: [1] });
    r.setStart(z, 1); r.setEnd(z, 2);
    eq("rangeBox of a collapsed space is null", C.rangeBox(r), null);
})();

/* ---- splitByLine: the same lines whichever engine measured them ---- */
[
    {
        name: "a wrapped title",
        lines: ["Basics of ", "Reverse Proxy"],
        want: [[0, "Basics of ", 0, 100], [10, "Reverse Proxy", 0, 130]]
    },
    {
        name: "a subtitle",
        lines: ["& why they are commonly used in ", "Homelab setups"],
        want: [[0, "& why they are commonly used in ", 0, 320], [32, "Homelab setups", 0, 140]]
    },
    {
        name: "CJK broken before its punctuation",
        lines: ["明明只是想遠端控制我的主機，", "結果一不小心就做出一套開源 ", "USB / IP KVM 的這件事"],
        want: [
            [0, "明明只是想遠端控制我的主機，", 0, 140],
            [14, "結果一不小心就做出一套開源 ", 0, 140],
            [28, "USB / IP KVM 的這件事", 0, 170]
        ]
    },
    {
        name: "centred lines keep their own left",
        lines: ["A centred line that wraps onto ", "a short one"],
        lefts: [5, 100],
        want: [[0, "A centred line that wraps onto ", 5, 315], [31, "a short one", 100, 210]]
    },
    {
        name: "a word broken mid-way",
        lines: ["Supercalifragilistic", "expialidocious"],
        want: [[0, "Supercalifragilistic", 0, 200], [20, "expialidocious", 0, 140]]
    }
].forEach(function (tc) {
    eq(tc.name + " (Blink / Gecko)", split(layout(tc.lines, { lefts: tc.lefts })), tc.want);
    eq(tc.name + " (WebKit)", split(layout(tc.lines, { lefts: tc.lefts, webkit: true })), tc.want);
});

// spaces collapsed to nothing at the start of a line draw nothing: they
// stay with the line before, and the next line starts at its first ink
eq("collapsed spaces never open a line",
    split(layout(["one ", "  two"], { zero: [4, 5] })),
    [[0, "one   ", 0, 40], [6, "two", 0, 30]]);
eq("collapsed spaces never open a line (WebKit)",
    split(layout(["one ", "  two"], { zero: [4, 5], webkit: true })),
    [[0, "one   ", 0, 40], [6, "two", 0, 30]]);
eq("one line is handed back whole",
    split(layout(["Reverse Proxy"], { webkit: true })),
    [[0, "Reverse Proxy", 0, 130]]);

console.log((failures ? "FAILED " + failures : "ok") + " (" + passes + " passed)");
process.exit(failures ? 1 : 0);
