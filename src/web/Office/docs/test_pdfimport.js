/*
    ArozOS Office - Docs PDF import unit tests (docs_pdfimport.js and
    common/pdfread.js)
    Run with: node test_pdfimport.js   (exits 1 on failure)

    The reflow works on geometry alone, so these build pages out of runs
    the way pdfread.js reports them and check what comes back: lines,
    paragraphs, lists, tables, columns, running footers. Each case is one
    that a real PDF got wrong at some point.
*/
global.window = global;
global.document = { currentScript: null };
require("../common/pdfread.js");
require("./docs_pdfimport.js");
var R = window.OfficePdfRead, D = window.DocsPdfImport;

var failures = 0, passes = 0;
function eq(name, got, want) {
    if (JSON.stringify(got) === JSON.stringify(want)) { passes++; return; }
    failures++;
    console.log("FAIL " + name + "\n  got:  " + JSON.stringify(got) + "\n  want: " + JSON.stringify(want));
}
function ch(code) { return String.fromCharCode(code); }

/* ---- building pages ---- */
var FONT = { family: "Arial", bold: false, italic: false, mono: false, serif: false, symbol: false, raw: "ArialMT", asc: 0.9, desc: 0.2 };
function run(text, x, base, size, extra) {
    var r = {
        text: text, x0: x, x1: x + text.length * size * 0.5, base: base, size: size,
        top: base - 0.9 * size, bottom: base + 0.2 * size, font: FONT, color: [0, 0, 0],
        invisible: false, angle: 0, spaceBefore: false, letterSpacing: 0, vertical: false
    };
    for (var k in extra || {}) r[k] = extra[k];
    return r;
}
// a line of words, one run each (or one run per glyph)
function words(text, x, base, size, perGlyph) {
    var out = [];
    text.split(" ").forEach(function (w) {
        if (perGlyph) {
            w.split("").forEach(function (c) { out.push(run(c, x, base, size)); x += size * 0.5; });
        } else {
            out.push(run(w, x, base, size));
            x += w.length * size * 0.5;
        }
        x += size * 0.25;
    });
    return out;
}
function page(runs, shapes, n) {
    return { number: n || 1, width: 595, height: 842, runs: runs, shapes: shapes || [], images: [], links: [] };
}
function rule(x0, y0, x1, y1) {
    return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1),
        fill: null, stroke: [0, 0, 0], lw: 0.5, alpha: 1, rect: false, curve: false, count: 2, segs: [[x0, y0, x1, y1]] };
}
function paragraphs(pg) {
    var out = [];
    pg.regions.forEach(function (rg) { out = out.concat(D._paragraphsOf(rg, 72, 523)); });
    return out;
}
function texts(ps) {
    return ps.filter(function (p) { return !p.block; }).map(function (p) {
        return p.lines.map(function (l) { return l.text; }).join(" / ");
    });
}
// a line that fills the column (x 72 .. ~520 at 11pt)
var FULL = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt";
var FULL2 = "magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut";

/* ---- font names ---- */
[
    ["ABCDEF+TimesNewRomanPS-BoldItalicMT", "Times New Roman"],
    ["ArialMT", "Arial"],
    ["Arial-BoldMT", "Arial"],
    ["BCDEEE+Calibri-Light", "Calibri Light"],
    ["MicrosoftJhengHei", "Microsoft JhengHei"],
    ["NotoSansCJKtc-Regular", "Noto Sans TC"],
    ["Helvetica-Bold", "Helvetica"],
    ["F1", ""],
    ["T1_0", ""],
    ["GillSansMT", "Gill Sans"],
    ["SourceSerifPro-Semibold", "Source Serif Pro"]
].forEach(function (c) { eq("family of " + c[0], R.familyOf(c[0]), c[1]); });

/* ---- text cleanup ---- */
var DING = { symbol: true };
eq("Wingdings l is a dot", R._cleanText("l", DING), ch(0x25CF));
eq("symbol private use bullet", R._cleanText(ch(0xF0B7), {}), ch(0x2022));
eq("fi ligature spelled out", R._cleanText(ch(0xFB01) + "nd", {}), "find");
eq("soft hyphen dropped", R._cleanText("co" + ch(0xAD) + "op", {}), "coop");

/* ---- paper ---- */
eq("A4 portrait", D._pickPaper(595, 842).size + " " + D._pickPaper(595, 842).orientation, "A4 portrait");
eq("Letter landscape", D._pickPaper(792, 612).size + " " + D._pickPaper(792, 612).orientation, "Letter landscape");

/* ---- lines join into paragraphs ---- */
(function () {
    var rs = words(FULL, 72, 100, 11).concat(words(FULL2, 72, 113, 11), words("short last line", 72, 126, 11),
        words("a new paragraph after a gap", 72, 152, 11));
    var ps = paragraphs(D._analyzePage(page(rs)));
    eq("wrapped lines make one paragraph", texts(ps).length, 2);
    eq("first paragraph has three lines", ps[0].lines.length, 3);
})();
(function () {
    // Google Docs draws every glyph by itself
    var rs = words(FULL, 72, 100, 11, true).concat(words(FULL2, 72, 113, 11, true), words("the end", 72, 126, 11, true));
    var ps = paragraphs(D._analyzePage(page(rs)));
    eq("glyph-by-glyph lines still join", texts(ps).length, 1);
    eq("glyph runs get their spaces back", ps[0].lines[2].text, "the end");
})();
(function () {
    // a short line ends its paragraph: the next line's first word would have fitted
    var rs = words("A short line.", 72, 100, 11).concat(words("Next paragraph", 72, 113, 11));
    eq("short line ends the paragraph", texts(paragraphs(D._analyzePage(page(rs)))).length, 2);
})();
(function () {
    // in a box narrower than the column (a slide) a line never fills it,
    // but one that did not end a sentence carries on in lower case
    var rs = words("I have zero knowledge about", 72, 100, 18).concat(words("self-hosting and proxies", 72, 122, 18));
    eq("narrow box line carries on", texts(paragraphs(D._analyzePage(page(rs)))).length, 1);
})();

/* ---- overprinting ---- */
(function () {
    // "ll" is two letters side by side, not one drawn twice
    var rs = [run("w", 72, 100, 11), run("i", 77.5, 100, 11), run("l", 83, 100, 11), run("l", 88.5, 100, 11)];
    var pg = D._analyzePage(page(rs));
    eq("adjacent identical letters kept", pg.regions[0].items[0].text, "will");
})();
(function () {
    // the same word drawn twice, a hair apart: a fake bold
    var rs = [run("Bold", 72, 100, 11), run("Bold", 72.3, 100, 11)];
    var pg = D._analyzePage(page(rs));
    var L = pg.regions[0].items[0];
    eq("overprint is one run", L.text, "Bold");
    eq("overprint reads as bold", L.tokens[0].run.bold, true);
})();

/* ---- lists ---- */
(function () {
    var B = ch(0x2022);
    var rs = [run(B, 80, 100, 11)].concat(words(FULL.substring(0, 80), 96, 100, 11),
        words("continues under the text", 96, 113, 11),
        [run(B, 80, 126, 11)], words("second item", 96, 126, 11));
    var ps = paragraphs(D._analyzePage(page(rs)));
    eq("two bullet items", ps.length, 2);
    eq("hanging line belongs to its item", ps[0].lines.length, 2);
    eq("bullet marker", ps[0].marker && ps[0].marker.kind + " " + ps[0].marker.marker, "bullet " + B);
    eq("item text starts after the gap", ps[1].marker.textX, 96);
})();
(function () {
    // "1" and "." drawn as runs of their own
    var rs = [run("1", 80, 100, 11), run(".", 85.5, 100, 11)].concat(words("Heterogeneous nodes", 96, 100, 11));
    var L = D._analyzePage(page(rs)).regions[0].items[0];
    var m = D._listMarker(L);
    eq("number marker across runs", m && [m.kind, m.fmt, m.value, m.textX], ["number", "decimal", 1, 96]);
})();
(function () {
    var rs = words("1.5 litres of water", 72, 100, 11);
    var L = D._analyzePage(page(rs)).regions[0].items[0];
    eq("a number in a sentence is no list", D._listMarker(L), null);
})();

/* ---- tables ---- */
(function () {
    var s = [rule(72, 90, 372, 90), rule(72, 120, 372, 120), rule(72, 150, 372, 150),
        rule(72, 90, 72, 150), rule(222, 90, 222, 150), rule(372, 90, 372, 150)];
    var rs = [run("A1", 80, 108, 10), run("B1", 230, 108, 10), run("A2", 80, 138, 10), run("B2", 230, 138, 10)];
    var pg = D._analyzePage(page(rs, s));
    eq("grid of rules is a table", pg.tables.length, 1);
    var t = pg.tables[0];
    eq("table shape", [t.rows, t.cols, t.cells.length], [2, 2, 4]);
    eq("cell text lands in its cell", t.cells.map(function (c) { return c.runs.map(function (r) { return r.text; }).join(""); }).sort(), ["A1", "A2", "B1", "B2"]);
})();
(function () {
    // an inner rule missing between two cells merges them
    var s = [rule(72, 90, 372, 90), rule(72, 120, 372, 120), rule(72, 150, 372, 150),
        rule(72, 90, 72, 150), rule(222, 120, 222, 150), rule(372, 90, 372, 150)];
    var rs = [run("Header", 80, 108, 10), run("A2", 80, 138, 10), run("B2", 230, 138, 10)];
    var t = D._analyzePage(page(rs, s)).tables[0];
    var head = t.cells.filter(function (c) { return c.r === 0; });
    eq("merged header cell spans both columns", head.length === 1 && head[0].cs, 2);
})();

/* ---- columns ---- */
(function () {
    var rs = [];
    for (var i = 0; i < 5; i++) {
        rs = rs.concat(words("left column text line " + i, 72, 100 + i * 13, 10));
        rs = rs.concat(words("right column text line " + i, 310, 100 + i * 13, 10));
    }
    var pg = D._analyzePage(page(rs));
    var order = [];
    pg.regions.forEach(function (rg) { rg.items.forEach(function (l) { if (!l.kind) order.push(l.text.split(" ")[0]); }); });
    eq("a column is read to its end first", order.slice(0, 6).join(","), "left,left,left,left,left,right");
})();

/* ---- running footers ---- */
(function () {
    var pages = [1, 2, 3].map(function (n) {
        return D._analyzePage(page(words(FULL, 72, 100, 11).concat(words("Report title", 72, 800, 9),
            [run(String(n), 500, 800, 9)]), [], n));
    });
    var res = D._stripRunning(pages);
    eq("repeated footer text is the footer", res.footer, "Report title");
    eq("its number is a page number", res.pageNumbers, true);
    var left = 0;
    pages.forEach(function (pg) { pg.regions.forEach(function (rg) { left += rg.items.length; }); });
    eq("only the body is left", left, 3);
})();

console.log(passes + " passed, " + failures + " failed");
if (failures) process.exit(1);
