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
        OfficeFonts.substitute(["Calibri"], skip, { lines: "powerpoint" })
                                          // stand-ins for missing fonts,
                                          // metric-matched -> Promise
        OfficeFonts.familiesIn(html)      // families a document names
        OfficeFonts.ready()               // -> Promise, substitutions done
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
        /* Document families (doc: true): open fonts that Office files name,
           shipped so that a machine without them draws - and a PDF embeds -
           the real thing (common/fonts/README.md lists them and their
           licences). The metric twins among them stand in for the Office
           fonts they copy (TWINS). A family without an italic or bold file
           is slanted or emboldened by the browser from the face it has.
           Carlito is Calibri's twin: same advance widths, so a Calibri
           document breaks its lines where Office does. */
        "carlito": {
            family: "Carlito",
            doc: true,
            faces: {
                "400": "Carlito-Regular.ttf",
                "700": "Carlito-Bold.ttf",
                "400i": "Carlito-Italic.ttf",
                "700i": "Carlito-BoldItalic.ttf"
            }
        },
        "abril fatface": { family: "Abril Fatface", doc: true, faces: { "400": "AbrilFatface-Regular.ttf" } },
        "amatic sc": { family: "Amatic SC", doc: true, faces: { "400": "AmaticSC-Regular.ttf" } },
        "arimo": { family: "Arimo", doc: true, faces: { "400": "Arimo-Regular.ttf", "700": "Arimo-Bold.ttf", "400i": "Arimo-Italic.ttf", "700i": "Arimo-BoldItalic.ttf" } },
        "barlow": { family: "Barlow", doc: true, faces: { "400": "Barlow-Regular.ttf", "700": "Barlow-Bold.ttf" } },
        "bebas neue": { family: "Bebas Neue", doc: true, faces: { "400": "BebasNeue-Regular.ttf" } },
        "caladea": { family: "Caladea", doc: true, faces: { "400": "Caladea-Regular.ttf", "700": "Caladea-Bold.ttf", "400i": "Caladea-Italic.ttf", "700i": "Caladea-BoldItalic.ttf" } },
        "comfortaa": { family: "Comfortaa", doc: true, faces: { "400": "Comfortaa-Regular.ttf", "700": "Comfortaa-Bold.ttf" } },
        "cousine": { family: "Cousine", doc: true, faces: { "400": "Cousine-Regular.ttf", "700": "Cousine-Bold.ttf", "400i": "Cousine-Italic.ttf", "700i": "Cousine-BoldItalic.ttf" } },
        "eb garamond": { family: "EB Garamond", doc: true, faces: { "400": "EBGaramond-Regular.ttf", "700": "EBGaramond-Bold.ttf", "400i": "EBGaramond-Italic.ttf", "700i": "EBGaramond-BoldItalic.ttf" } },
        "fira sans": { family: "Fira Sans", doc: true, faces: { "400": "FiraSans-Regular.ttf", "700": "FiraSans-Bold.ttf" } },
        "gelasio": { family: "Gelasio", doc: true, faces: { "400": "Gelasio-Regular.ttf", "700": "Gelasio-Bold.ttf", "400i": "Gelasio-Italic.ttf", "700i": "Gelasio-BoldItalic.ttf" } },
        "inter": { family: "Inter", doc: true, faces: { "400": "Inter-Regular.ttf", "700": "Inter-Bold.ttf" } },
        "josefin sans": { family: "Josefin Sans", doc: true, faces: { "400": "JosefinSans-Regular.ttf", "700": "JosefinSans-Bold.ttf" } },
        "karla": { family: "Karla", doc: true, faces: { "400": "Karla-Regular.ttf", "700": "Karla-Bold.ttf" } },
        "lato": { family: "Lato", doc: true, faces: { "400": "Lato-Regular.ttf", "700": "Lato-Bold.ttf", "400i": "Lato-Italic.ttf", "700i": "Lato-BoldItalic.ttf" } },
        "libre baskerville": { family: "Libre Baskerville", doc: true, faces: { "400": "LibreBaskerville-Regular.ttf", "700": "LibreBaskerville-Bold.ttf" } },
        "lora": { family: "Lora", doc: true, faces: { "400": "Lora-Regular.ttf", "700": "Lora-Bold.ttf", "400i": "Lora-Italic.ttf", "700i": "Lora-BoldItalic.ttf" } },
        "merriweather": { family: "Merriweather", doc: true, faces: { "400": "Merriweather-Regular.ttf", "700": "Merriweather-Bold.ttf", "400i": "Merriweather-Italic.ttf", "700i": "Merriweather-BoldItalic.ttf" } },
        "montserrat": { family: "Montserrat", doc: true, faces: { "400": "Montserrat-Regular.ttf", "700": "Montserrat-Bold.ttf", "400i": "Montserrat-Italic.ttf", "700i": "Montserrat-BoldItalic.ttf" } },
        "mulish": { family: "Mulish", doc: true, faces: { "400": "Mulish-Regular.ttf", "700": "Mulish-Bold.ttf" } },
        "noto serif": { family: "Noto Serif", doc: true, faces: { "400": "NotoSerif-Regular.ttf", "700": "NotoSerif-Bold.ttf", "400i": "NotoSerif-Italic.ttf", "700i": "NotoSerif-BoldItalic.ttf" } },
        "nunito": { family: "Nunito", doc: true, faces: { "400": "Nunito-Regular.ttf", "700": "Nunito-Bold.ttf" } },
        "old standard tt": { family: "Old Standard TT", doc: true, faces: { "400": "OldStandardTT-Regular.ttf" } },
        "open sans": { family: "Open Sans", doc: true, faces: { "400": "OpenSans-Regular.ttf", "700": "OpenSans-Bold.ttf", "400i": "OpenSans-Italic.ttf", "700i": "OpenSans-BoldItalic.ttf" } },
        "oswald": { family: "Oswald", doc: true, faces: { "400": "Oswald-Regular.ttf", "700": "Oswald-Bold.ttf" } },
        "playfair display": { family: "Playfair Display", doc: true, faces: { "400": "PlayfairDisplay-Regular.ttf", "700": "PlayfairDisplay-Bold.ttf", "400i": "PlayfairDisplay-Italic.ttf", "700i": "PlayfairDisplay-BoldItalic.ttf" } },
        "poppins": { family: "Poppins", doc: true, faces: { "400": "Poppins-Regular.ttf", "700": "Poppins-Bold.ttf", "400i": "Poppins-Italic.ttf", "700i": "Poppins-BoldItalic.ttf" } },
        "pt sans": { family: "PT Sans", doc: true, faces: { "400": "PTSans-Regular.ttf", "700": "PTSans-Bold.ttf" } },
        "pt serif": { family: "PT Serif", doc: true, faces: { "400": "PTSerif-Regular.ttf", "700": "PTSerif-Bold.ttf" } },
        "quicksand": { family: "Quicksand", doc: true, faces: { "400": "Quicksand-Regular.ttf", "700": "Quicksand-Bold.ttf" } },
        "raleway": { family: "Raleway", doc: true, faces: { "400": "Raleway-Regular.ttf", "700": "Raleway-Bold.ttf", "400i": "Raleway-Italic.ttf", "700i": "Raleway-BoldItalic.ttf" } },
        "roboto": { family: "Roboto", doc: true, faces: { "400": "Roboto-Regular.ttf", "700": "Roboto-Bold.ttf", "400i": "Roboto-Italic.ttf", "700i": "Roboto-BoldItalic.ttf" } },
        "roboto slab": { family: "Roboto Slab", doc: true, faces: { "400": "RobotoSlab-Regular.ttf", "700": "RobotoSlab-Bold.ttf" } },
        "rubik": { family: "Rubik", doc: true, faces: { "400": "Rubik-Regular.ttf", "700": "Rubik-Bold.ttf" } },
        "source sans 3": { family: "Source Sans 3", doc: true, faces: { "400": "SourceSans3-Regular.ttf", "700": "SourceSans3-Bold.ttf", "400i": "SourceSans3-Italic.ttf", "700i": "SourceSans3-BoldItalic.ttf" } },
        "source serif 4": { family: "Source Serif 4", doc: true, faces: { "400": "SourceSerif4-Regular.ttf", "700": "SourceSerif4-Bold.ttf" } },
        "spectral": { family: "Spectral", doc: true, faces: { "400": "Spectral-Regular.ttf" } },
        "tinos": { family: "Tinos", doc: true, faces: { "400": "Tinos-Regular.ttf", "700": "Tinos-Bold.ttf", "400i": "Tinos-Italic.ttf", "700i": "Tinos-BoldItalic.ttf" } },
        "work sans": { family: "Work Sans", doc: true, faces: { "400": "WorkSans-Regular.ttf", "700": "WorkSans-Bold.ttf" } },
        "noto sans tc": { family: "Noto Sans TC", faces: { "400": "NotoSansTC-Regular.ttf" } },
        "noto sans sc": { family: "Noto Sans SC", faces: { "400": "NotoSansSC-Regular.ttf" } },
        "noto sans jp": { family: "Noto Sans JP", faces: { "400": "NotoSansJP-Regular.ttf" } },
        "noto sans kr": { family: "Noto Sans KR", faces: { "400": "NotoSansKR-Regular.ttf" } }
    };

    /* Metric twins the suite ships: a missing family on the left is drawn
       in the shipped file on the right, so it needs no scaling and every
       line is as wide as in the original - which no scaled look-alike
       manages, its letters being wider here and narrower there. A machine
       that has the original keeps it. */
    var TWINS = {
        "calibri": "carlito",
        "cambria": "caladea",
        "arial": "arimo", "helvetica": "arimo", "liberation sans": "arimo",
        "times new roman": "tinos", "times": "tinos", "liberation serif": "tinos",
        "courier new": "cousine", "liberation mono": "cousine",
        "georgia": "gelasio"
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
        "Arial", "Calibri", "Cambria", "Georgia", "Times New Roman", "Courier New", "Verdana",
        "Segoe UI", "Tahoma", "Trebuchet MS", "Impact", "Comic Sans MS"
    ];

    // then every shipped document family that is not a twin (the twins are
    // reached under the names of the fonts they copy, which are above)
    (function () {
        var twinOf = {};
        for (var t in TWINS) twinOf[TWINS[t]] = true;
        Object.keys(SHIPPED).sort().forEach(function (k) {
            if (SHIPPED[k].doc && !twinOf[k] && MENU.indexOf(SHIPPED[k].family) < 0) MENU.push(SHIPPED[k].family);
        });
    })();

    /* The document families are declared here, straight from SHIPPED, so
       that the list and the declarations cannot drift. A declaration only
       names the file: the browser fetches a face the first time some text
       is set in it. They go first in the head, so the stand-ins
       substitute() writes later (the same files, with PowerPoint's line
       metrics) win over them. */
    var declaredEl = null;
    function declareShipped() {
        if (declaredEl || typeof document === "undefined" || !document.head) return;
        var css = "";
        Object.keys(SHIPPED).forEach(function (k) {
            var rec = SHIPPED[k];
            if (!rec.doc) return;
            Object.keys(rec.faces).forEach(function (f) {
                css += "@font-face{font-family:\"" + rec.family + "\";src:url(\"" + DIR + rec.faces[f] +
                    "\") format(\"truetype\");font-weight:" + parseInt(f, 10) + ";font-style:" +
                    (/i$/.test(f) ? "italic" : "normal") + ";font-display:swap;}\n";
            });
        });
        declaredEl = document.createElement("style");
        declaredEl.id = "ofShippedFaces";
        declaredEl.textContent = css;
        document.head.insertBefore(declaredEl, document.head.firstChild);
    }
    if (typeof document !== "undefined") {
        if (document.head) declareShipped();
        else document.addEventListener("DOMContentLoaded", declareShipped);
    }

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

    /* ================= substitution: a missing font keeps its size =================

       A document names the fonts it was set in - Calibri, Garamond, Century
       Gothic - and the machine showing it often has none of them. Left to
       itself the browser drops to the next family in the stack, Noto Sans,
       which is a fine face but a wide one: 16% wider than Calibri, 20% wider
       than Garamond. Every line then breaks somewhere else, text runs out of
       its box, a title that was two lines becomes three.

       So a missing family is not left to fall through. substitute() gives it
       an @font-face of its own, under its own name, drawn from the closest
       face this machine does have - a metric twin where one exists (Carlito
       for Calibri, Liberation Sans for Arial), else one of the same kind
       (serif for serif) - and scaled with size-adjust until its average
       advance on an English sample is the original's. Lines then break where
       the document's author saw them break. The vertical metrics come along
       (ascent-override / descent-override), so the baseline sits where the
       original font would put it.

       METRICS holds what that needs about the original, measured from the
       real font files (the faces Microsoft Print to PDF embeds in a
       reference export, the macOS system fonts, the open-source faces):
           family: [category, [avg advance per em: regular, bold, italic,
                    bold italic - 0 or missing = not measured], ascent,
                    descent (both per em, the Windows metrics)]
       The advance is that of SAMPLE - pangrams for coverage plus plain
       prose, so letters weigh about as they do in real text (pangrams alone
       made Calibri 1% narrower than it sets) - and the substitute is
       measured on the same string at run time, in this browser, so
       whatever face the browser really picked is what gets scaled. A family that is not in
       the table still gets a face of its own kind, at its natural size. */
    var SAMPLE = "Heuristics are aids to learning, reasoning and discovery. The quick brown fox " +
        "jumps over the lazy dog; Pack my box with five dozen liquor jugs. 2024 Results: 15% of 380 users. " +
        "Course Outline: Learning Goals for the Term. With a clear outline, we can easily check whether the " +
        "reasoning is sound or not. In doing so, we improve on the logic of the first draft, and see that the " +
        "choice of words matters.";
    var METRICS = {
        "arial": ["sans", [0.4394, 0.473, 0.4394, 0.473], 0.905, 0.212],
        "arial narrow": ["sans", [0.3604, 0.3879, 0.3604, 0.3879], 0.922, 0.21],
        "arial black": ["sans", [0.5449], 1.101, 0.31],
        "arial rounded mt bold": ["sans", [0.4782], 0.946, 0.211],
        "helvetica": ["sans", [0.4394, 0.473, 0.4394, 0.473], 0.95, 0.225],
        "helvetica neue": ["sans", [0.444, 0.4723, 0.4409, 0.4725], 0.952, 0.213],
        "calibri": ["sans", [0.4017, 0.4103, 0.3988, 0.4089], 0.952, 0.269],
        "carlito": ["sans", [0.4017, 0.4103, 0.3988, 0.4089], 0.952, 0.269],
        "cambria": ["serif", [0.4015, 0.4414, 0.3936, 0.4352], 0.95, 0.222],
        "caladea": ["serif", [0.4015, 0.4414, 0.3936, 0.4352], 0.95, 0.222],
        "garamond": ["serif", [0.3864], 0.862, 0.263],
        "eb garamond": ["serif", [0.3765, 0.4155, 0.3635, 0.4176], 1.047, 0.39],
        "times new roman": ["serif", [0.4005, 0.4243, 0.4011, 0.4109], 0.891, 0.216],
        "times": ["serif", [0.4005, 0.4243, 0.4011, 0.4109], 0.891, 0.216],
        "tinos": ["serif", [0.4005, 0.4243, 0.4011, 0.4109], 0.891, 0.216],
        "liberation serif": ["serif", [0.4005, 0.4243, 0.4011, 0.4109], 0.891, 0.216],
        "liberation sans": ["sans", [0.4394, 0.473, 0.4394, 0.473], 0.905, 0.212],
        "arimo": ["sans", [0.4394, 0.473, 0.4394, 0.473], 0.905, 0.212],
        "georgia": ["serif", [0.436, 0.5073, 0.4444, 0.5158], 0.917, 0.219],
        "century gothic": ["sans", [0.4756], 0.971, 0.22],
        "playfair display": ["serif", [0.4431, 0.4539, 0.4185, 0.4446], 1.159, 0.251],
        "lato": ["sans", [0.4347, 0.4395, 0.409, 0.4142], 1.117, 0.299],
        "open sans": ["sans", [0.4589, 0.4914, 0.434, 0.4657], 1.124, 0.318],
        "roboto": ["sans", [0.4374, 0.4448, 0.4252, 0.4323], 0.95, 0.25],
        "montserrat": ["sans", [0.491, 0.5184, 0.4949, 0.5214], 1.109, 0.453],
        "raleway": ["sans", [0.4537, 0.4706, 0.4373, 0.4565], 1.154, 0.234],
        "poppins": ["sans", [0.4867, 0.5005, 0.4921, 0.5038], 1.135, 0.627],
        "verdana": ["sans", [0.5059, 0.5623, 0.5058, 0.5622], 1.005, 0.21],
        "tahoma": ["sans", [0.4424, 0.5006], 1.0, 0.206],
        "trebuchet ms": ["sans", [0.4489, 0.4694, 0.4531, 0.4762], 0.939, 0.222],
        "segoe ui": ["sans", [0.446], 1.079, 0.251],
        "courier new": ["mono", [0.6001, 0.6001, 0.6001, 0.6001], 0.833, 0.3],
        "courier": ["mono", [0.6001, 0.6001, 0.6001, 0.6001], 0.754, 0.246],
        "consolas": ["mono", [0.5498, 0.5498, 0.5498, 0.5498], 0.743, 0.257],
        "lucida console": ["mono", [0.6021], 0.789, 0.211],
        "gill sans": ["sans", [0.4061, 0.5037, 0.3734, 0.4762], 0.918, 0.231],
        "gill sans mt": ["sans", [0.4061, 0.5037, 0.3734, 0.4762], 0.918, 0.231],
        "futura": ["sans", [0.4531, 0.537, 0.4556], 1.039, 0.26],
        "palatino": ["serif", [0.4384, 0.4517, 0.3994, 0.4398], 1.173, 0.483],
        "palatino linotype": ["serif", [0.4384, 0.4517, 0.3994, 0.4398], 1.173, 0.483],
        "book antiqua": ["serif", [0.4384, 0.4517, 0.3994, 0.4398], 1.173, 0.483],
        "baskerville": ["serif", [0.3991, 0.4681, 0.3372, 0.462], 0.961, 0.344],
        "didot": ["serif", [0.4473, 0.46, 0.4086], 0.941, 0.299],
        "optima": ["sans", [0.4296, 0.4368, 0.4283, 0.4362], 0.919, 0.268],
        "avenir": ["sans", [0.442, 0.4721, 0.442, 0.4721], 1.0, 0.325],
        "avenir next": ["sans", [0.4531, 0.4805, 0.4445, 0.4754], 1.0, 0.366],
        "menlo": ["mono", [0.6021, 0.6021, 0.6021, 0.6021], 0.928, 0.236],
        "impact": ["sans", [0.3984], 1.009, 0.211],
        "comic sans ms": ["sans", [0.4649, 0.4984], 1.102, 0.291],
        "microsoft sans serif": ["sans", [0.4377], 0.922, 0.21],
        "bodoni 72": ["serif", [0.3688, 0.389, 0.3655], 0.936, 0.266],
        "noto serif": ["serif", [0.4712, 0.4998, 0.4592, 0.5046], 1.069, 0.389],
        "noto sans": ["sans", [0.464, 0.492, 0.4375, 0.4675], 1.069, 0.293],
        "source sans pro": ["sans", [0.4085, 0.4333], 0.934, 0.288],
        "source sans 3": ["sans", [0.4085, 0.4333, 0.3979, 0.4201], 0.934, 0.288],
        "source serif pro": ["serif", [0.4414, 0.4548], 1.009, 0.324],
        "source serif 4": ["serif", [0.4414, 0.4548], 1.009, 0.324],
        "pt sans": ["sans", [0.4243, 0.4242], 1.019, 0.276],
        "pt serif": ["serif", [0.4395, 0.4751], 1.018, 0.276],
        "oswald": ["sans", [0.3579, 0.4056], 1.325, 0.377],
        "lora": ["serif", [0.4599, 0.4727, 0.4457, 0.4514], 1.206, 0.294],
        "nunito": ["sans", [0.4436, 0.4611], 1.077, 0.3],
        "merriweather": ["serif", [0.4742, 0.4875, 0.4438, 0.4517], 1.238, 0.494],
        "ubuntu": ["sans", [0.4455, 0.4689], 0.932, 0.189],
        "inter": ["sans", [0.4705, 0.4839], 1.108, 0.322],
        "roboto slab": ["serif", [0.4639, 0.4702], 1.048, 0.302],
        "work sans": ["sans", [0.4914, 0.4922], 1.105, 0.343],
        "libre baskerville": ["serif", [0.5065, 0.5184], 1.182, 0.27],
        "quicksand": ["sans", [0.4545, 0.4789], 1.183, 0.303],
        "fira sans": ["sans", [0.448, 0.4493], 0.935, 0.265],
        "comfortaa": ["sans", [0.5112, 0.5155], 1.285, 0.332],
        "abril fatface": ["serif", [0.4497], 1.058, 0.291],
        "bebas neue": ["sans", [0.3341], 0.95, 0.35],
        "josefin sans": ["sans", [0.4453, 0.4729], 1.242, 0.324],
        "old standard tt": ["serif", [0.4312], 0.948, 0.282],
        "amatic sc": ["sans", [0.2821], 1.139, 0.265],
        "rubik": ["sans", [0.4589, 0.4895], 1.066, 0.466],
        "mulish": ["sans", [0.4551, 0.4717], 1.065, 0.297],
        "karla": ["sans", [0.4463, 0.4677], 1.031, 0.273],
        "spectral": ["serif", [0.4371], 1.059, 0.463],
        "barlow": ["sans", [0.4232, 0.4356], 1.112, 0.249],
        "big caslon": ["serif", [0.3974], 0.934, 0.257],
        "cochin": ["serif", [0.4122, 0.4312, 0.3571, 0.3981], 0.897, 0.25],
        "charter": ["serif", [0.4351, 0.4634, 0.4182, 0.4537], 0.963, 0.236],
        "iowan old style": ["serif", [0.444, 0.478, 0.3857, 0.4328], 1.013, 0.262],
        "american typewriter": ["serif", [0.4725, 0.4975], 0.904, 0.25],
        "andale mono": ["mono", [0.6001], 0.907, 0.218],
        "copperplate": ["serif", [0.5202, 0.537], 0.763, 0.248],
        "cousine": ["mono", [0.6001, 0.6001, 0.6001, 0.6001], 0.833, 0.3],
        "gelasio": ["serif", [0.436, 0.5073, 0.4444, 0.5159], 1.27, 0.391]
    };

    /* Where a substitute comes from: first a face drawn to the same
       metrics or the same design (LOOKALIKE), then the first face of the
       original's kind this machine has. Noto Sans is behind every one of
       them as a file, so a face always loads. */
    var KIND_FACES = {
        sans: ["Arial", "Liberation Sans", "Arimo", "Helvetica", "Helvetica Neue"],
        serif: ["Times New Roman", "Liberation Serif", "Tinos", "Times", "Georgia", "DejaVu Serif", "Noto Serif"],
        mono: ["Courier New", "Liberation Mono", "Cousine", "Menlo", "Consolas", "DejaVu Sans Mono", "Courier"]
    };
    var LOOKALIKE = {
        "calibri": ["Carlito"],
        "cambria": ["Caladea", "Georgia"],
        "arial": ["Liberation Sans", "Arimo", "Helvetica"],
        "helvetica": ["Arial", "Liberation Sans", "Arimo"],
        "helvetica neue": ["Helvetica", "Arial", "Liberation Sans"],
        "times new roman": ["Liberation Serif", "Tinos", "Times"],
        "times": ["Times New Roman", "Liberation Serif", "Tinos"],
        "courier new": ["Liberation Mono", "Cousine", "Courier"],
        "garamond": ["EB Garamond", "Adobe Garamond Pro", "Baskerville", "Georgia"],
        "eb garamond": ["Garamond", "Adobe Garamond Pro", "Baskerville"],
        "century gothic": ["Futura", "Avenir", "Avenir Next", "URW Gothic"],
        "gill sans mt": ["Gill Sans"],
        "gill sans": ["Gill Sans MT"],
        "playfair display": ["Didot", "Bodoni 72", "Georgia"],
        "book antiqua": ["Palatino Linotype", "Palatino", "URW Palladio L"],
        "palatino linotype": ["Palatino", "Book Antiqua", "URW Palladio L"],
        "palatino": ["Palatino Linotype", "Book Antiqua", "URW Palladio L"],
        "segoe ui": ["Selawik", "Helvetica Neue", "Arial"],
        "consolas": ["Menlo", "Liberation Mono", "Courier New"],
        "georgia": ["Gelasio"]
    };
    // families never given a stand-in: pictographs mapped onto letters
    // (a substitute would show letters), and the CJK faces, whose script
    // the shipped Noto Sans CJK fallbacks already carry at the full width
    var NO_SUBST = /wingdings|webdings|symbol|dingbat|ming|mincho|gothic\b.*(ms|yu)|(ms|yu)\b.*gothic|sim(sun|hei)|yahei|jhenghei|meiryo|gulim|batang|dotum|malgun|kai(ti)?\b|fangsong|hiragino|pingfang|heiti|songti|stsong|stkaiti|biaukai|kaiu|[\u2e80-\u9fff\uac00-\ud7af]/i;
    var GENERIC = { "serif": 1, "sans-serif": 1, "monospace": 1, "cursive": 1, "fantasy": 1, "system-ui": 1,
        "ui-serif": 1, "ui-sans-serif": 1, "ui-monospace": 1, "inherit": 1, "initial": 1, "emoji": 1, "math": 1 };
    // weight words in a family name ("Open Sans SemiBold") - the face is
    // bold itself, and the metrics are the base family's
    var HEAVY_RE = /\s+(semi\s*bold|demi\s*bold|extra\s*bold|ultra\s*bold|bold|black|heavy)$/i;
    var LIGHT_RE = /\s+(extra\s*light|ultra\s*light|semi\s*light|light|thin|hairline|book|medium|regular|condensed|narrow)$/i;

    function norm(name) {
        return String(name || "").trim().replace(/^["']+|["']+$/g, "").replace(/\s+/g, " ").toLowerCase();
    }
    function kindOf(key) {
        if (METRICS[key]) return METRICS[key][0];
        if (/mono|courier|consol|code|typewriter|terminal/.test(key)) return "mono";
        if (/serif/.test(key) && !/sans/.test(key)) return "serif";
        if (/times|roman|garamond|georgia|antiqua|palatino|cambria|baskerville|bodoni|didot|caslon|schoolbook|bookman|constantia|rockwell|slab|playfair|merriweather|lora|minion|charter|cochin|perpetua|centaur|goudy|elephant|bell mt|calisto|californian|cooper|footlight|high tower|modern no|niagara|poor richard|book/.test(key)) return "serif";
        return "sans";
    }
    // the base family whose measurements stand in for a weighted name
    function metricKey(key) {
        var k = key;
        for (var i = 0; i < 3 && !METRICS[k]; i++) k = k.replace(HEAVY_RE, "").replace(LIGHT_RE, "");
        return METRICS[k] ? k : "";
    }

    /* installed reports whether the machine really has a family - measured,
       because document.fonts.check() says yes to any local name. A family
       that exists overrides both generics behind it; one that does not falls
       through and comes out exactly as wide as the generic. */
    var PROBE = "mmmmmmmmwwwwwwwwiiiiiiiil1I0Oo";
    var probe = null;
    function installed(name) {
        try {
            if (!probe) {
                probe = { ctx: document.createElement("canvas").getContext("2d"), base: {} };
                ["monospace", "serif"].forEach(function (g) {
                    probe.ctx.font = "72px " + g;
                    probe.base[g] = probe.ctx.measureText(PROBE).width;
                });
            }
            var q = '"' + String(name).replace(/["\\]/g, "") + '"';
            for (var g in probe.base) {
                probe.ctx.font = "72px " + q + ", " + g;
                if (probe.ctx.measureText(PROBE).width !== probe.base[g]) return true;
            }
            return false;
        } catch (e) {
            return true;   // cannot tell: leave the family alone
        }
    }

    /* local() names a face by its full name or its PostScript name, never
       by family + weight, so each style of a substitute is asked for under
       the names it is installed as on Windows, macOS and Linux. */
    var PS_NAMES = {
        "arial": ["ArialMT", "Arial-BoldMT", "Arial-ItalicMT", "Arial-BoldItalicMT"],
        "times new roman": ["TimesNewRomanPSMT", "TimesNewRomanPS-BoldMT", "TimesNewRomanPS-ItalicMT", "TimesNewRomanPS-BoldItalicMT"],
        "courier new": ["CourierNewPSMT", "CourierNewPS-BoldMT", "CourierNewPS-ItalicMT", "CourierNewPS-BoldItalicMT"],
        "times": ["Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"]
    };
    var STYLE_WORDS = ["", " Bold", " Italic", " Bold Italic"];
    var PS_WORDS = ["-Regular", "-Bold", "-Italic", "-BoldItalic"];
    function localSrc(family, st, only) {
        var names = [];
        if (st === 0) names.push(family, family + " Regular");
        else names.push(family + STYLE_WORDS[st]);
        if (st === 3) names.push(family + " BoldItalic");
        var ps = PS_NAMES[norm(family)];
        if (ps) names.push(ps[st]);
        var bare = family.replace(/\s+/g, "");
        names.push(bare + PS_WORDS[st]);
        if (st === 0) names.push(bare);
        var out = names.map(function (n) { return 'local("' + n.replace(/["\\]/g, "") + '")'; });
        // only: the installed font itself, and nothing in its place
        if (only) return out.join(", ");
        // the shipped face is always there behind them
        var shipped = SHIPPED["noto sans"].faces[["400", "700", "400i", "700i"][st]];
        out.push('url("' + DIR + shipped + '") format("truetype")');
        return out.join(", ");
    }

    var substituted = {};       // key -> { via, adjust: [4] } once a face is in
    var pending = Promise.resolve();
    var styleEl = null;
    var seq = 0;
    var STYLE_DESC = [
        { w: "100 549", s: "normal", css: "400 normal" },
        { w: "550 1000", s: "normal", css: "700 normal" },
        { w: "100 549", s: "italic", css: "400 italic" },
        { w: "550 1000", s: "italic", css: "700 italic" }
    ];

    function faceRule(family, src, st, extra) {
        var d = STYLE_DESC[st];
        return "@font-face{font-family:\"" + family.replace(/["\\]/g, "") + "\";src:" + src +
            ";font-weight:" + d.w + ";font-style:" + d.s + ";font-display:block;" + (extra || "") + "}\n";
    }
    function sampleWidth(ctx, family, st) {
        ctx.font = STYLE_DESC[st].css + ' 100px "' + family.replace(/["\\]/g, "") + '"';
        return ctx.measureText(SAMPLE).width / 100 / SAMPLE.length;
    }

    /* substitute gives every family in the list that this machine lacks a
       stand-in of its own (see above). skip names families the document
       brings itself (embedded faces), which must not be shadowed. Resolves
       once the new faces are in place - true when anything changed, so a
       caller with its own text measurements knows to redo them. */
    function substitute(families, skip, opts) {
        var skipKeys = {};
        (skip || []).forEach(function (f) { skipKeys[norm(f)] = true; });
        var lines = opts && opts.lines === "powerpoint" ? "powerpoint" : "";
        var job = pending.then(function () { return runSubstitute(families || [], skipKeys, lines); });
        pending = job.then(function () { }, function () { });
        return job;
    }
    function runSubstitute(families, skipKeys, lines) {
        if (!document.fonts || !document.fonts.load || !document.head) return Promise.resolve(false);
        var plans = [];
        var seen = {};
        families.forEach(function (fam) {
            var name = String(fam || "").trim().replace(/^["']+|["']+$/g, "");
            var key = norm(name);
            if (!key || seen[key] || GENERIC[key] || skipKeys[key] || substituted[key]) return;
            // a fallback face (Noto Sans and its CJK sisters) is fonts.css's
            if (SHIPPED[key] && !SHIPPED[key].doc) return;
            seen[key] = true;
            if (NO_SUBST.test(key)) return;
            // a family the suite ships is its own file, at its own size -
            // also when a weight word is in the name ("Open Sans SemiBold")
            var sk = SHIPPED[key] ? key : metricKey(key);
            if (SHIPPED[sk] && SHIPPED[sk].doc) {
                plans.push({ name: name, key: key, mk: METRICS[sk] ? sk : "", via: SHIPPED[sk].family,
                    heavy: sk !== key && HEAVY_RE.test(" " + key), kind: kindOf(sk), exact: true });
                return;
            }
            if (installed(name)) {
                // the font is here: with PowerPoint's line model it still
                // gets a face of its own - itself, at its own size - so its
                // ascent and descent can be restated (see below)
                if (lines === "powerpoint" && METRICS[key]) {
                    plans.push({ name: name, key: key, mk: key, heavy: false, via: name, self: true });
                }
                return;
            }
            var mk = metricKey(key);
            var heavy = HEAVY_RE.test(" " + key.replace(/^\s+/, "")) && !METRICS[key];
            var kind = kindOf(mk || key);
            var cands = (LOOKALIKE[mk] || []).concat(KIND_FACES[kind]);
            var twin = TWINS[mk] ? SHIPPED[TWINS[mk]].family : "";
            var via = twin, viaShipped = false;
            for (var i = 0; i < cands.length && !twin; i++) {
                var ck = norm(cands[i]);
                // a stand-in of our own is not a face local() can reach
                if (ck === key || substituted[ck]) continue;
                // a shipped face is always there (and, declared, would
                // look installed to the probe without being local())
                if (SHIPPED[ck] && SHIPPED[ck].doc) { via = SHIPPED[ck].family; viaShipped = true; break; }
                if (installed(cands[i])) { via = cands[i]; break; }
            }
            plans.push({ name: name, key: key, mk: mk, heavy: heavy, via: via, kind: kind, twin: !!twin,
                viaShipped: viaShipped });
        });
        if (!plans.length) return Promise.resolve(false);

        // pass 1: each style of each stand-in at its natural size, under a
        // throwaway name, to measure what this browser really draws
        var probeCss = "", loads = [];
        plans.forEach(function (pl) {
            pl.src = [];
            for (var st = 0; st < 4; st++) {
                // a weighted name ("Open Sans SemiBold") is bold even when
                // the text asks for normal weight
                var from = pl.heavy ? st | 1 : st;
                if (pl.twin || pl.exact) {
                    // a shipped file alone: the PDF exporter embeds those
                    // bytes, so the screen draws the same ones. A style the
                    // family has no file for gets no face, and the browser
                    // slants or emboldens the one it has, as it would anyway
                    var face = faceFor(pl.via, from & 1, from & 2);
                    pl.src[st] = face && !face.synthBold && !face.synthItalic ?
                        'url("' + face.url + '") format("truetype")' : "";
                    if (pl.src[st]) loads.push(STYLE_DESC[st].css + ' 100px "' + pl.via + '"');
                    continue;
                }
                if (!pl.probe) pl.probe = "__of_sub" + (++seq);
                pl.src[st] = pl.viaShipped ? 'url("' + faceFor(pl.via, from & 1, from & 2).url + '") format("truetype")'
                    : pl.via ? localSrc(pl.via, from, pl.self)
                    : 'url("' + DIR + SHIPPED["noto sans"].faces[["400", "700", "400i", "700i"][from]] + '") format("truetype")';
                probeCss += faceRule(pl.probe, pl.src[st], st);
                loads.push(STYLE_DESC[st].css + ' 100px "' + pl.probe + '"');
            }
        });
        var probeEl = document.createElement("style");
        probeEl.textContent = probeCss;
        document.head.appendChild(probeEl);
        return Promise.all(loads.map(function (f) {
            return document.fonts.load(f, SAMPLE).catch(function () { });
        })).then(function () {
            var ctx = document.createElement("canvas").getContext("2d");
            var css = "";
            var finalLoads = [];
            plans.forEach(function (pl) {
                var m = pl.mk ? METRICS[pl.mk] : null;
                var adj = [1, 1, 1, 1];
                if (pl.self) {
                    // a face of an installed font must draw exactly what the
                    // font does in every style, or it would shadow it with
                    // something else (a local() name this system spells
                    // differently): one style off and the family is left be
                    for (var k = 0; k < 4; k++) {
                        var a0 = sampleWidth(ctx, pl.name, k), a1 = sampleWidth(ctx, pl.probe, k);
                        if (!(a0 > 0) || Math.abs(a1 - a0) > a0 * 0.002) return;
                    }
                } else if (!pl.twin && !pl.exact) for (var st = 0; st < 4; st++) {
                    // (a twin is drawn as it is: its widths are the
                    // original's, kerning included, which the browser's
                    // measurement would read as a difference)
                    var got = sampleWidth(ctx, pl.probe, st);
                    var want = m && m[1][pl.heavy ? st | 1 : st];
                    if (!want && m && m[1][0]) {
                        // the original's bold / italic was not measured:
                        // keep the regular's scale
                        adj[st] = adj[0];
                        continue;
                    }
                    if (want && got > 0) adj[st] = Math.max(0.6, Math.min(1.6, want / got));
                }
                for (var s2 = 0; s2 < 4; s2++) {
                    if (!pl.src[s2]) continue;
                    // a shipped family in a word processor's page is simply
                    // itself: the declaration fonts.js made already says so
                    if (pl.exact && (lines !== "powerpoint" || !m)) continue;
                    var extra = "";
                    if (Math.abs(adj[s2] - 1) > 0.002) extra += "size-adjust:" + (adj[s2] * 100).toFixed(2) + "%;";
                    if (m) {
                        // PowerPoint sets a line 1.2 em tall and puts the
                        // baseline where the font's ascent:descent split
                        // falls in it; CSS centres ascent + descent in the
                        // line instead. Stating them so they add up to the
                        // 1.2 em line makes the two the same at single
                        // spacing. A word processor uses the real metrics.
                        var asc = m[2], dsc = m[3];
                        if (lines === "powerpoint") {
                            asc = 1.2 * m[2] / (m[2] + m[3]);
                            dsc = 1.2 * m[3] / (m[2] + m[3]);
                        } else {
                            // a word processor's page keeps the line height
                            // the fallback face gave it (the Docs layout is
                            // tuned to Google Docs, whose lines are the same
                            // height in every font); only the width changes.
                            // A twin keeps the lines of its kind's usual
                            // stand-in, so shipping it moved nothing down
                            var vface = pl.twin ? KIND_FACES[pl.kind][0] : pl.via || "noto sans";
                            var vm = METRICS[norm(vface)] || METRICS["noto sans"];
                            asc = vm[2];
                            dsc = vm[3];
                        }
                        extra += "ascent-override:" + (asc / adj[s2] * 100).toFixed(2) + "%;" +
                            "descent-override:" + (dsc / adj[s2] * 100).toFixed(2) + "%;line-gap-override:0%;";
                    }
                    css += faceRule(pl.name, pl.src[s2], s2, extra);
                    finalLoads.push(STYLE_DESC[s2].css + ' 16px "' + pl.name.replace(/["\\]/g, "") + '"');
                }
                substituted[pl.key] = { via: pl.via || "Noto Sans", adjust: adj, kind: pl.kind,
                    twin: !!(pl.twin || pl.exact) };
            });
            probeEl.parentNode.removeChild(probeEl);
            if (!styleEl) {
                styleEl = document.createElement("style");
                styleEl.id = "ofFontSubstitutes";
                document.head.appendChild(styleEl);
            }
            styleEl.textContent += css;
            return Promise.all(finalLoads.map(function (f) {
                return document.fonts.load(f, SAMPLE).catch(function () { });
            }));
        }).then(function () { return true; }, function () {
            if (probeEl.parentNode) probeEl.parentNode.removeChild(probeEl);
            return false;
        });
    }

    /* familiesIn lists the families named by every font-family declaration
       in a piece of markup or a serialized document body, primary first */
    function familiesIn(text) {
        var out = [], seen = {};
        var re = /font-family\s*:\s*([^;}<>]+)/gi, m;
        var src = String(text || "").replace(/\\"/g, '"').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        while ((m = re.exec(src))) {
            m[1].split(",").forEach(function (f) {
                var n = f.trim().replace(/^["']+|["']+$/g, "").trim();
                var k = n.toLowerCase();
                if (n && !seen[k]) { seen[k] = true; out.push(n); }
            });
        }
        return out;
    }

    /* the stand-in a family was given, for exporters that draw text
       themselves: { via: "Arial", adjust: [r, b, i, bi], kind: "sans",
       twin: false } or null. twin: via is a shipped metric twin, which an
       exporter can embed in place of the original. */
    function substituteOf(family) {
        return substituted[norm(family)] || null;
    }

    return {
        DIR: DIR,
        MENU: MENU,
        FALLBACK: FALLBACK,
        stack: stack,
        isShipped: isShipped,
        faceFor: faceFor,
        preload: preload,
        substitute: substitute,
        substituteOf: substituteOf,
        familiesIn: familiesIn,
        // resolves once every substitution asked for so far is in place
        ready: function () { return pending; }
    };
})();
