/*
    ArozOS Office Suite - document font registry
    ============================================
    The families the suite ships with itself (common/fonts/, declared in
    common/fonts/fonts.css) and the rules for falling back between them.

    Why the suite ships fonts at all: a PDF can only show text in a font it
    embeds, and a browser will not hand over a system font's bytes. Text set
    in a system font can therefore only reach a PDF as a picture of itself.
    These files are here so that the exporter can embed the exact bytes the
    screen was drawn with, and the export comes out as real, selectable,
    searchable text.

    The fallback rule, which both the editor and the PDF exporter follow:

        <what the document asked for>, Noto Sans, Noto Sans TC,
        Noto Sans SC, Noto Sans JP, Noto Sans KR, <generic>

    The browser walks that list per character and uses the first family that
    has a glyph, so Latin keeps the document's own font while CJK lands on
    the shipped face for it. stack() is what puts the tail on, and every
    place that writes a font-family into a document goes through it - a bare
    "font-family: Arial" would send CJK to whatever the machine happens to
    have, which is exactly the font the exporter cannot embed.

    A document that is mostly Japanese should pick "Noto Sans JP" from the
    font menu: the Han characters Chinese and Japanese share have different
    regional forms, and the first family in the list is the one that wins.

    Usage:
        OfficeFonts.MENU                  // family names for a font picker
        OfficeFonts.stack("Arial")        // -> "Arial, \"Noto Sans\", ..."
        OfficeFonts.isShipped("Noto Sans TC")
        OfficeFonts.faceFor("Noto Sans", bold, italic)
                                          // -> { url, synthBold } | null
        OfficeFonts.preload(["Noto Sans TC"])   // -> Promise
*/

var OfficeFonts = (function () {
    "use strict";

    // every app lives one folder below Office/, so this reaches the shared
    // font folder from Docs, Sheets and Slides alike
    var DIR = "../common/fonts/";

    /* The shipped families. The CJK faces carry Regular only: bold is
       synthesized, by the browser on screen and by a stroked text rendering
       mode in the PDF, which is the same smear without the advance widths
       moving - and saves shipping four more multi-megabyte files. */
    var SHIPPED = {
        "noto sans": {
            family: "Noto Sans",
            faces: {
                "400": "NotoSans-Regular.ttf",
                "700": "NotoSans-Bold.ttf",
                "400i": "NotoSans-Italic.ttf",
                "700i": "NotoSans-BoldItalic.ttf"
            }
        },
        "noto sans tc": { family: "Noto Sans TC", faces: { "400": "NotoSansTC-Regular.ttf" } },
        "noto sans sc": { family: "Noto Sans SC", faces: { "400": "NotoSansSC-Regular.ttf" } },
        "noto sans jp": { family: "Noto Sans JP", faces: { "400": "NotoSansJP-Regular.ttf" } },
        "noto sans kr": { family: "Noto Sans KR", faces: { "400": "NotoSansKR-Regular.ttf" } }
    };

    /* The tail of every font stack, in the order a character is offered to
       them. Noto Sans comes first so that Latin, Greek and Cyrillic keep a
       proportional Latin design - the CJK faces carry Latin too, and would
       otherwise swallow it. */
    var FALLBACK = ["Noto Sans", "Noto Sans TC", "Noto Sans SC", "Noto Sans JP", "Noto Sans KR"];

    // what a font picker offers: the document fonts first, then the
    // classics that a .pptx / .docx out in the world will ask for
    var MENU = [
        "Noto Sans", "Noto Sans TC", "Noto Sans SC", "Noto Sans JP", "Noto Sans KR",
        "Arial", "Georgia", "Times New Roman", "Courier New", "Verdana",
        "Segoe UI", "Tahoma", "Trebuchet MS", "Impact", "Comic Sans MS"
    ];

    function quote(name) {
        return /^[A-Za-z][A-Za-z0-9 ]*$/.test(name) ? name : '"' + name + '"';
    }

    /* stack builds the full font-family list for a requested family: the
       family itself, then the shipped fallbacks it does not already name,
       then the generic. Pass nothing for the document default. */
    function stack(family, generic) {
        var out = [];
        var seen = {};
        function add(n) {
            var k = String(n).trim().replace(/^["']|["']$/g, "");
            if (!k || seen[k.toLowerCase()]) return;
            seen[k.toLowerCase()] = true;
            out.push(k);
        }
        String(family || "").split(",").forEach(add);
        FALLBACK.forEach(add);
        return out.map(quote).join(", ") + ", " + (generic || "sans-serif");
    }

    function isShipped(family) {
        return !!SHIPPED[String(family || "").trim().replace(/^["']|["']$/g, "").toLowerCase()];
    }

    /* faceFor picks the file that backs one family at one weight/style. A
       family that does not ship that face (the CJK ones ship Regular only)
       comes back with the nearest file it does have plus a note of what the
       caller has to synthesize itself - which is what the browser does on
       screen, so doing the same keeps the two in step. */
    function faceFor(family, bold, italic) {
        var rec = SHIPPED[String(family || "").trim().replace(/^["']|["']$/g, "").toLowerCase()];
        if (!rec) return null;
        // exact face first, then drop italic, then drop bold, then plain
        var tries = [
            [(bold ? "700" : "400") + (italic ? "i" : ""), false, false],
            [bold ? "700" : "400", false, !!italic],
            ["400" + (italic ? "i" : ""), !!bold, false],
            ["400", !!bold, !!italic]
        ];
        for (var i = 0; i < tries.length; i++) {
            var file = rec.faces[tries[i][0]];
            if (!file) continue;
            return {
                family: rec.family,
                url: DIR + file,
                synthBold: tries[i][1],
                synthItalic: tries[i][2]
            };
        }
        return null;
    }

    /* preload makes sure the browser has the faces in hand before anything
       measures text in them - document.fonts.ready alone only waits for
       loads that have already started. */
    function preload(families, sizeCss) {
        if (!document.fonts || !document.fonts.load) return Promise.resolve();
        var jobs = [];
        (families || FALLBACK).forEach(function (f) {
            if (!isShipped(f)) return;
            try {
                jobs.push(document.fonts.load((sizeCss || "16px") + " " + quote(f)));
            } catch (e) { /* a browser that dislikes the shorthand: skip */ }
        });
        return Promise.all(jobs).then(function () { }, function () { });
    }

    return {
        DIR: DIR,
        MENU: MENU,
        FALLBACK: FALLBACK,
        stack: stack,
        isShipped: isShipped,
        faceFor: faceFor,
        preload: preload
    };
})();
