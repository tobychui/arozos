/*
    ArozOS Office - Slides editor
    ==============================================================
    Body schema (what serialize() returns / deserialize() receives):

    {
        size: [960, 540],              // slide coordinate space: 960 wide, as
                                       // tall as the deck's shape (720 = 4:3)
        theme: "clean",                // key into THEMES
        slides: [
            {
                id: "s-xxxx",
                bg: "#rrggbb" | null,  // null = use theme background
                bgImage: { src, x, y, w, h, tile, opacity },  // optional picture
                                       // background, placed in slide px (may
                                       // reach past the edges) or tiled
                bgGrad: { kind: "linear"|"radial", angle, cx, cy,
                          stops: [{ pos, color }] },          // optional gradient
                                       // background; either one is drawn over
                                       // bg and kept until a colour is chosen
                notes: "speaker notes plain text",
                transition: "none" | "fade" | "slide" | "zoom",   // entry transition
                objects: [
                    {
                        id: "o-xxxx",
                        type: "text" | "image" | "shape" | "line" | "table" |
                              "chart" | "video" | "audio",
                        x, y, w, h,    // slide units; for "line" w/h is the
                                       // vector to the 2nd endpoint (may be negative)
                        rot: 0,        // degrees, rotation about center (not lines)
                        z: 1,          // stacking order (mirrors array order)
                        group: "g-xx", // optional: objects sharing a group id
                                       // select and move as one unit
                        props: { ... } // per type:
                        //  text : { html, fontSize, color, align, bold, italic, underline }
                        //  image: { src, fit: "contain"|"cover"|"fill" }
                        //  shape: { kind: a SlidesShapes name, which is the
                        //                 PresentationML preset name -
                        //                 "rect"|"roundRect"|"ellipse"|"rightBrace"|...,
                        //                 or "custom" with geom (an imported freeform:
                        //                 { paths: [{ w, h, d, noFill, noStroke }] },
                        //                 M/L/C/Z in each path's own w x h space)
                        //           fill ("#rrggbb" or "#rrggbbaa"), fillGrad (as bgGrad),
                        //           stroke, strokeW, text, textColor, fontSize, bold,
                        //           adj: { adj1, adj2, ... } - a callout's tip, and the
                        //                guides of the presets drawn to PowerPoint's
                        //                formulas (chevron, arrows, ...; SlidesShapes) }
                        //  line : { stroke, strokeW, dashStyle, startHead, endHead }
                        //         (slides_lines.js; older documents say
                        //          dash / arrowEnd / arrowStart instead)
                        //  table: { rows: [["a","b"],...], headerRow, colW?, rowH?, fontSize, color,
                        //           merges?: [[row, col, rowSpan, colSpan], ...],
                        //           cellAnchor?: [["", "middle", "bottom"], ...],
                        //           styled? (an imported table style: its own fills,
                        //           text and rules - stroke / strokeW - and no
                        //           heading look from the editor) }
                        //  chart: { spec: <OfficeCharts spec> }
                        //  video: { src (data URL), autoplay }
                        //  audio: { src (data URL), autoplay }
                        // any type may also carry:
                        //  anim: "" | "fade" | "slide" | "zoom"   entrance animation,
                        //        revealed click-by-click in present mode
                        //  link: "" | "#3" (go to slide 3) | "https://..."
                        //        followed when clicked in present mode
                    }
                ]
            }
        ],
        fonts: [                       // optional: font faces a .pptx/.odp
            { family, weight, style, src }   // brought with it, installed as
        ]                              // @font-face (see installEmbeddedFonts)
    }

    Objects imported from a .pptx / .odp carry extra props that keep the
    typography and geometry of the file they came from. All are optional -
    an object made in the editor omits them and falls back to the
    stylesheet. See "Imported-deck fidelity props" in common/CONTRACT.md:
      text / shape : fontFamily, valign, pad[t,r,b,l], lineHeight,
                     and on a shape, html (rich text in place of text)
      image        : crop[l,t,r,b] fractions, radius, opacity, and fill /
                     fillGrad on the frame (seen through transparent parts)
      line         : points (a bent connector's polyline), arrowStart
      table        : cellFill[][], cellPad[t,r,b,l]

    An image also carries what the picture tools put on it:
      crop[l,t,r,b] / mask / radius  the crop and the shaped crop
      orig {x,y,w,h}                 the frame Reset image puts back
      flipH / flipV                  mirrored horizontally / vertically
      recolor / bright / contrast    the colour treatment (slides_image.js)
      opacity                        1 - transparency
    These are the same props the pptx reader writes, because a crop or a
    tint made here and one made in PowerPoint mean the same thing. See the
    "image crop tool" section below, slides_image.js for the tools that
    edit them, and CONTRACT.md for the frame-vs-source identity they obey.
*/

var SlidesApp = (function () {
    "use strict";

    /* ================= constants ================= */
    /* The slide is 960 px wide; its height follows the deck's shape (540
       for 16:9, 720 for a 4:3 deck from PowerPoint). Both are the current
       deck's, set from body.size by setSlideSize() whenever a document
       comes in, and published as --sl-w / --sl-h / --sl-ar so every slide
       surface in slides.css - canvas, rail, overview, present, print -
       takes the same shape. */
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
        line: "Line", table: "Table", chart: "Chart",
        video: "Video", audio: "Audio"
    };
    var TRANSITIONS = [
        { key: "none", label: "None" },
        { key: "fade", label: "Fade" },
        { key: "slide", label: "Slide in" },
        { key: "zoom", label: "Zoom" }
    ];
    var ANIMS = [
        { key: "", label: "None" },
        { key: "fade", label: "Fade in" },
        { key: "slide", label: "Slide in" },
        { key: "zoom", label: "Zoom in" }
    ];
    var MEDIA_MAX_BYTES = 200 * 1024 * 1024;  // uploads stream to the workdir

    /* What a picture can be masked to. Deliberately a short list and not
       the whole catalogue, for two reasons. A mask reads as a silhouette,
       so the outlines worth offering are the ones that still say something
       at thumbnail size - and every one of these is a polygon, which is
       what lets maskClipPath() state it in percentages so the clip follows
       the frame while it is being dragged. A curved shape would have to be
       restated in pixels at every size. Every shape the editor can draw
       lives in SlidesShapes (slides_shapes.js) and is offered by the
       Insert > Shape picker. */
    var MASK_KINDS = [
        "rect", "roundRect", "ellipse", "triangle", "rtTriangle", "diamond",
        "pentagon", "hexagon", "heptagon", "octagon", "decagon", "dodecagon",
        "parallelogram", "trapezoid", "plus", "star4", "star5", "star6",
        "star8", "star12", "chevron", "homePlate", "rightArrow", "leftArrow",
        "upArrow", "downArrow", "leftRightArrow", "upDownArrow",
        "flowChartManualInput", "flowChartInputOutput", "irregularSeal1"
    ].map(function (k) {
        return { kind: k, label: SlidesShapes.label(k) };
    });

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
    /* image crop mode: cropId is the picture being cropped, cropRect is the
       part of it that will be kept and cropFull is where the whole picture
       sits behind that (both in slide units), cropBefore is what to put
       back if the crop is cancelled */
    var cropId = null;
    var cropRect = null;
    var cropFull = null;
    var cropBefore = null;

    var canvasEl, layerEl, framesEl, guideVEl, guideHEl, marqueeEl, cropEl;

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
        // an imported fill may carry alpha as #rrggbbaa
        var m = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(String(hex || ""));
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
        var s = { id: genId("s"), bg: null, notes: "", transition: "none", objects: [] };
        if (kind === "title") {
            s.objects.push(newTextObj("Presentation title", 80, 190, 800, 90, 44, "center", textColor));
            s.objects.push(newTextObj("Subtitle", 180, 300, 600, 50, 20, "center", textColor));
        } else if (kind === "normal") {
            s.objects.push(newTextObj("Slide title", 50, 34, 860, 66, 32, "left", textColor));
        } else if (kind === "content") {
            s.objects.push(newTextObj("Slide title", 50, 34, 860, 66, 32, "left", textColor));
            s.objects.push(newTextObj("Content", 50, 130, 860, 360, 22, "left", textColor));
        } else if (kind === "two") {
            s.objects.push(newTextObj("Slide title", 50, 34, 860, 66, 32, "left", textColor));
            s.objects.push(newTextObj("Left content", 50, 130, 420, 360, 20, "left", textColor));
            s.objects.push(newTextObj("Right content", 490, 130, 420, 360, 20, "left", textColor));
        } else if (kind === "caption") {
            s.objects.push(newTextObj("Title", 60, 60, 840, 300, 28, "left", textColor));
            s.objects.push(newTextObj("Caption", 60, 400, 840, 60, 16, "left", textColor));
        } else if (kind === "section") {
            s.objects.push(newTextObj("Section header", 60, 230, 840, 80, 36, "left", textColor));
        } else if (kind === "onecol") {
            s.objects.push(newTextObj("Heading", 60, 60, 840, 60, 28, "left", textColor));
            s.objects.push(newTextObj("Text", 60, 140, 840, 340, 18, "left", textColor));
        } else if (kind === "mainpoint") {
            s.objects.push(newTextObj("Main point", 80, 210, 800, 120, 44, "left", textColor));
        } else if (kind === "sectiondesc") {
            s.objects.push(newTextObj("Section title", 60, 120, 380, 90, 30, "left", textColor));
            s.objects.push(newTextObj("Description", 60, 230, 380, 200, 16, "left", textColor));
        } else if (kind === "bignumber") {
            s.objects.push(newTextObj("100%", 80, 160, 800, 140, 88, "center", textColor));
            s.objects.push(newTextObj("What it stands for", 80, 320, 800, 60, 18, "center", textColor));
        }
        // the layouts are drawn for 960x540; a deck of another shape gets
        // them spread over its own height
        if (SLIDE_H !== 540) {
            var ky = SLIDE_H / 540;
            s.objects.forEach(function (o) {
                o.y = Math.round(o.y * ky);
                o.h = Math.round(o.h * ky);
            });
        }
        s.objects.forEach(function (o, i) { o.z = i + 1; });
        return s;
    }
    function defaultBody() {
        setSlideSize(960, 540);
        var b = { size: [SLIDE_W, SLIDE_H], theme: "clean", slides: [] };
        body = b; // themeOf() needs it while building the first slide
        b.slides.push(newSlide("title"));
        return b;
    }
    /* A deck states its own size: 960 wide and as tall as its shape (a
       4:3 PowerPoint deck is 960x720). Anything odd falls back to 16:9. */
    function sizeOf(b) {
        var sz = b && b.size;
        var w = sz && Number(sz[0]), h = sz && Number(sz[1]);
        if (!(w >= 100 && w <= 4000 && h >= 100 && h <= 4000)) return [960, 540];
        return [Math.round(w), Math.round(h)];
    }
    function setSlideSize(w, h) {
        SLIDE_W = w;
        SLIDE_H = h;
        var root = document.documentElement.style;
        root.setProperty("--sl-w", w + "px");
        root.setProperty("--sl-h", h + "px");
        root.setProperty("--sl-ar", w + " / " + h);
    }
    function normalizeBody(b) {
        if (!b || typeof b !== "object") b = {};
        b.size = sizeOf(b);
        setSlideSize(b.size[0], b.size[1]);
        if (!THEMES[b.theme]) b.theme = "clean";
        if (!Array.isArray(b.slides) || b.slides.length === 0) {
            b.slides = [{ id: genId("s"), bg: null, notes: "", objects: [] }];
        }
        b.slides.forEach(function (s) {
            s.id = s.id || genId("s");
            s.bg = s.bg || null;
            if (!s.bgImage || typeof s.bgImage !== "object" || !s.bgImage.src) delete s.bgImage;
            if (!s.bgGrad || typeof s.bgGrad !== "object" || !Array.isArray(s.bgGrad.stops) ||
                !s.bgGrad.stops.length) delete s.bgGrad;
            s.notes = typeof s.notes === "string" ? s.notes : "";
            if (typeof s.transition !== "string") s.transition = "none";
            if (!Array.isArray(s.objects)) s.objects = [];
            s.objects = s.objects.filter(function (o) { return o && TYPE_NAMES[o.type]; });
            s.objects.forEach(function (o, i) {
                o.id = o.id || genId();
                o.x = Number(o.x) || 0; o.y = Number(o.y) || 0;
                o.w = Number(o.w) || 0; o.h = Number(o.h) || 0;
                o.rot = Number(o.rot) || 0;
                o.z = i + 1;
                if (!o.props || typeof o.props !== "object") o.props = {};
                // decks written before the shape catalogue carry three
                // editor-invented names; rewrite them as they come in
                if (o.props.kind) o.props.kind = SlidesShapes.canonical(o.props.kind);
                if (o.props.mask) o.props.mask = SlidesShapes.canonical(o.props.mask);
            });
        });
        if (!Array.isArray(b.fonts)) delete b.fonts;
        installEmbeddedFonts(b.fonts);
        // fonts the deck names that this machine lacks get a stand-in
        // scaled to the original's width, so lines break where they did
        // for the author; the faces it carries itself are left alone
        OfficeFonts.substitute(OfficeFonts.familiesIn(JSON.stringify(b.slides)),
            (b.fonts || []).map(function (f) { return f && f.family; }), { lines: "powerpoint" });
        return b;
    }

    /* A deck imported from a file may carry the font faces it was designed
       in, so text renders in the right typeface on a machine that does not
       have them installed. They go in one stylesheet for the whole page:
       the editor, the thumbnails, present mode and print all share it. */
    function installEmbeddedFonts(fonts) {
        var el = document.getElementById("slEmbeddedFonts");
        if (!fonts || !fonts.length) {
            if (el) el.parentNode.removeChild(el);
            return;
        }
        if (!el) {
            el = document.createElement("style");
            el.id = "slEmbeddedFonts";
            document.head.appendChild(el);
        }
        var css = "";
        fonts.forEach(function (f) {
            if (!f || typeof f.src !== "string" || f.src.indexOf("data:") !== 0) return;
            if (!f.family) return;
            css += "@font-face{font-family:'" + String(f.family).replace(/['\\]/g, "") +
                "';src:url(" + f.src + ");font-weight:" + (Number(f.weight) || 400) +
                ";font-style:" + (f.style === "italic" ? "italic" : "normal") +
                ";font-display:block;}\n";
        });
        el.textContent = css;
    }

    /* ================= rendering: objects ================= */
    /* Imported decks (pptx / odp) carry their own typography on the text
       object: the CSS font stack the file asked for, the text-box insets,
       the paragraph line height and the vertical anchor. Documents made in
       the editor have none of those and fall back to the stylesheet. */
    var VALIGN_JUSTIFY = { top: "flex-start", middle: "center", bottom: "flex-end" };

    function padStyle(pad) {
        if (!pad || pad.length !== 4) return "";
        return "padding:" + pad.map(function (v) {
            return (Number(v) || 0) + "px";
        }).join(" ") + ";";
    }

    function textStyle(p) {
        var s = "font-size:" + (Number(p.fontSize) || 24) + "px;";
        if (p.color) s += "color:" + esc(p.color) + ";";
        s += "text-align:" + esc(p.align || "left") + ";";
        if (p.bold) s += "font-weight:700;";
        if (p.italic) s += "font-style:italic;";
        if (p.underline) s += "text-decoration:underline;";
        if (p.fontFamily) s += "font-family:" + esc(OfficeFonts.stack(p.fontFamily)) + ";";
        if (p.lineHeight) s += "line-height:" + (Number(p.lineHeight) || 1.3) + ";";
        s += padStyle(p.pad);
        s += "justify-content:" + (VALIGN_JUSTIFY[p.valign] || "flex-start") + ";";
        return s;
    }

    /* An imported picture may be cropped (pptx srcRect), have rounded
       corners and be partly transparent. The crop is reproduced the way
       PowerPoint defines it: the visible rectangle is scaled up to fill
       the frame and the rest is clipped by the wrapper. */
    function imageHtml(p, w, h) {
        var imgS = "object-fit:" + esc(p.fit || "contain") + ";" + cropImgStyle(p.crop);
        var wrapS = "";
        // a fill on the picture's frame, seen through its transparent parts
        var under = p.fillGrad ? gradientCss(p.fillGrad) : (p.fill && p.fill !== "none" ? esc(p.fill) : "");
        if (under) wrapS += "background:" + under + ";";
        if (p.radius) wrapS += "border-radius:" + (Number(p.radius) || 0) + "px;";
        if (p.opacity) wrapS += "opacity:" + clamp(Number(p.opacity) || 1, 0, 1) + ";";
        var clip = maskClipPath(p.mask);
        if (clip) wrapS += "clip-path:" + clip + ";-webkit-clip-path:" + clip + ";";
        // a picture's outline (pptx <a:ln> on the picture) is centred on the
        // frame like PowerPoint draws it; a shaped crop gets it along the
        // shape, which a clipped wrapper cannot draw on itself
        var sw = Number(p.strokeW) || 0;
        var outline = "";
        if (sw > 0 && p.stroke && p.stroke !== "none") {
            var dash = SlidesLines.dashArray(p, sw);
            if (!clip && !dash) {
                wrapS += "outline:" + sw + "px solid " + esc(p.stroke) +
                    ";outline-offset:" + (-sw / 2) + "px;";
            } else if (w > 0 && h > 0) {
                // CSS has no dash-dot, and a clipped wrapper cannot draw
                // along its own clip: an SVG does both
                var d = clip && window.SlidesShapes ? SlidesShapes.path(p.mask, w, h) : "";
                var r = Number(p.radius) || 0;
                var geo = d ? '<path d="' + esc(d) + '"'
                    : '<rect x="0" y="0" width="' + w + '" height="' + h + '" rx="' + r + '"';
                outline = '<svg class="sl-img-outline" width="' + w + '" height="' + h +
                    '" style="position:absolute;left:0;top:0;overflow:visible;pointer-events:none;">' +
                    geo + ' fill="none" stroke="' + esc(p.stroke) + '" stroke-width="' + sw + '"' +
                    ' stroke-linecap="' + SlidesLines.capOf(p) + '"' +
                    (dash ? ' stroke-dasharray="' + dash.join(" ") + '"' : "") + "/></svg>";
            }
        }
        // re-colour and the brightness / contrast adjustments are one CSS
        // filter, built by the picture tools so the canvas, the thumbnails,
        // present mode and the panel's own swatches all agree
        if (window.SlidesImageTools) {
            var f = SlidesImageTools.imageFilter(p);
            if (f) imgS += "filter:" + f + ";";
        }
        var flip = (p.flipH ? "scaleX(-1) " : "") + (p.flipV ? "scaleY(-1)" : "");
        if (flip) imgS += "transform:" + flip.trim() + ";" + flipOriginStyle(p.crop);
        return '<div class="sl-img-wrap" style="' + wrapS + '">' +
            '<img draggable="false" src="' + esc(p.src || "") +
            '" style="' + imgS + '" alt=""></div>' + outline;
    }

    /* The visible rectangle is scaled up to fill the frame and the rest is
       clipped by the wrapper - the same definition PowerPoint's srcRect
       uses, so an imported crop and one made here mean the same thing. */
    function cropImgStyle(c) {
        if (!c || c.length !== 4) return "";
        var l = Number(c[0]) || 0, t = Number(c[1]) || 0;
        var kw = 1 - l - (Number(c[2]) || 0);
        var kh = 1 - t - (Number(c[3]) || 0);
        if (!(kw > 0.001) || !(kh > 0.001)) return "";
        return "position:absolute;object-fit:fill;" +
            "width:" + (100 / kw) + "%;height:" + (100 / kh) + "%;" +
            "left:" + (-l / kw * 100) + "%;top:" + (-t / kh * 100) + "%;";
    }

    /* A flip mirrors what the frame shows, about the frame's centre: that
       is PowerPoint's order (crop the picture, then flip the result). A
       cropped <img> is bigger than its frame and offset, so mirroring it
       about its own centre would show the part the crop removed from the
       opposite side - an off-centre crop then looks cut in the wrong
       place. The frame's centre, in the picture's own box: */
    function flipOriginStyle(c) {
        if (!c || c.length !== 4) return "";
        var l = Number(c[0]) || 0, t = Number(c[1]) || 0;
        var kw = 1 - l - (Number(c[2]) || 0);
        var kh = 1 - t - (Number(c[3]) || 0);
        if (!(kw > 0.001) || !(kh > 0.001)) return "";
        return "transform-origin:" + ((l + kw / 2) * 100) + "% " + ((t + kh / 2) * 100) + "%;";
    }

    /* A shaped crop ("mask image"): the picture is clipped to one of the
       editor's shape outlines. shapePoints() already defines every polygon
       shape, so asking it for a 100x100 box yields percentages directly. */
    function maskClipPath(kind) {
        if (!kind || kind === "rect") return "";
        if (kind === "ellipse") return "ellipse(50% 50% at 50% 50%)";
        if (kind === "roundRect") return "";    // border-radius draws this one
        var pts = shapePoints(kind, 100, 100);
        if (!pts) return "";
        return "polygon(" + pts.map(function (pt) {
            return pt[0].toFixed(2) + "% " + pt[1].toFixed(2) + "%";
        }).join(",") + ")";
    }

    /* shapePoints is the polygon form of a shape, for the one caller that
       wants corners rather than a path: the CSS clip-path of a mask, which
       states them as percentages so the clip follows the frame. A shape
       with curves in it has none, and says so - which is why MASK_KINDS is
       all polygons. */
    function shapePoints(kind, w, h) {
        return SlidesShapes.points(kind, w, h);
    }

    /* shapeSvg draws one shape. The geometry comes from SlidesShapes, so
       the canvas, the icon in the picker, a shaped crop and the PDF export
       are all working from the same outline.

       Two shapes are still drawn as SVG primitives rather than as a path:
       a rectangle and an ellipse, because a rounded rectangle's radius is
       a property the user sets and `rx` follows the box as it is resized. */
    function shapeSvg(o) {
        var w = Math.max(4, o.w), h = Math.max(4, o.h);
        var p = o.props;
        var kind = SlidesShapes.canonical(p.kind || "rect");
        var sw = Number(p.strokeW) || 0;
        var stroke = p.stroke || "";
        // an imported shape may legitimately have no fill (an outline-only
        // box); only an editor-made shape with nothing set gets the default
        var fill = p.fill || "#e07b1f";
        // a bracket, a brace or an arc is a line and not an area: with no
        // stroke there would be nothing on the slide at all
        var open = SlidesShapes.isOpen(kind);
        if (open) {
            if (!stroke || stroke === "none") stroke = (fill && fill !== "none") ? fill : "#333333";
            if (!sw) sw = 2;
            fill = "none";
        }
        var hasStroke = sw > 0 && stroke && stroke !== "none";
        // an imported gradient fill is an SVG paint server of its own
        var defs = "";
        if (!open && p.fillGrad && p.fillGrad.stops && p.fillGrad.stops.length) {
            var gid = "slg" + (++gradSeq);
            defs = "<defs>" + svgGradient(p.fillGrad, w, h, gid) + "</defs>";
            fill = "url(#" + gid + ")";
        }
        var attrs = 'fill="' + esc(fill) + '"' +
            (SlidesShapes.evenOdd(kind) ? ' fill-rule="evenodd"' : "") +
            (hasStroke ? ' stroke="' + esc(stroke) + '" stroke-width="' + sw + '"' +
                (SlidesLines.dashArray(p, sw) ? ' stroke-dasharray="' + SlidesLines.dashArray(p, sw).join(" ") +
                    '" stroke-linecap="' + SlidesLines.capOf(p) + '"' : "") : ' stroke="none"') +
            ' stroke-linejoin="round" vector-effect="non-scaling-stroke"';
        var inner;
        var i = hasStroke ? Math.max(0.5, sw / 2) : 0;
        if (kind === "rect" || kind === "roundRect") {
            var rx = kind === "roundRect"
                ? (p.radius !== undefined ? Number(p.radius) : Math.min(w, h) * 0.15) : 0;
            inner = '<rect x="' + i + '" y="' + i + '" width="' + (w - 2 * i) + '" height="' + (h - 2 * i) +
                '" rx="' + rx + '" ' + attrs + "/>";
        } else if (kind === "ellipse") {
            inner = '<ellipse cx="' + (w / 2) + '" cy="' + (h / 2) + '" rx="' + (w / 2 - i) + '" ry="' + (h / 2 - i) + '" ' + attrs + "/>";
        } else if (kind === "custom" && p.geom) {
            // an imported freeform: the filled paths, then any drawn only
            // as an outline (a path the file says has no fill)
            var cd = SlidesShapes.customPath(p.geom, w, h, "fill");
            inner = cd ? '<path d="' + cd + '" ' + attrs + "/>" : "";
            var od = (p.geom.paths || []).some(function (gp) { return gp.noFill; })
                ? SlidesShapes.customPath({ paths: p.geom.paths.filter(function (gp) { return gp.noFill; }) }, w, h) : "";
            if (od && hasStroke) {
                inner += '<path d="' + od + '" fill="none" stroke="' + esc(stroke) + '" stroke-width="' + sw +
                    '" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>';
            }
        } else {
            var d = SlidesShapes.path(kind, w, h, p.adj);
            if (!d) d = SlidesShapes.path("rect", w, h);
            inner = '<path d="' + d + '" ' + attrs + "/>";
        }
        // markings - the divider bars of a predefined process, the fold of a
        // folded corner. They are drawn, never filled.
        var det = SlidesShapes.detail(kind, w, h);
        if (det) {
            inner += '<path d="' + det + '" fill="none" stroke="' +
                esc(hasStroke ? stroke : contrastText(fill)) + '" stroke-width="' +
                (sw > 0 ? sw : 1) + '" vector-effect="non-scaling-stroke"/>';
        }
        // a stroke sits astride the outline, so half of it falls outside the
        // box - which is what PowerPoint draws too
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + " " + h +
            '" preserveAspectRatio="none" style="overflow:visible">' + defs + inner + "</svg>";
    }

    /* A gradient as an SVG paint server over a w x h box, laid out the way
       CSS lays out the same gradient (gradientCss): a linear one along the
       CSS gradient line, a radial one as "circle farthest-corner". The
       PDF exporter paints from the same numbers. */
    var gradSeq = 0;
    function svgGradient(g, w, h, id) {
        var stops = (g.stops || []).map(function (st) {
            var c = String(st.color || "#000000");
            var op = "";
            var m = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(c);
            if (m) { c = "#" + m[1]; op = ' stop-opacity="' + (parseInt(m[2], 16) / 255).toFixed(3) + '"'; }
            return '<stop offset="' + clamp(Number(st.pos) || 0, 0, 1) + '" stop-color="' + esc(c) + '"' + op + "/>";
        }).join("");
        if (g.kind === "radial") {
            var cx = (isFinite(Number(g.cx)) ? Number(g.cx) : 0.5) * w;
            var cy = (isFinite(Number(g.cy)) ? Number(g.cy) : 0.5) * h;
            var r = Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy),
                Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy));
            return '<radialGradient id="' + id + '" gradientUnits="userSpaceOnUse" cx="' + cx +
                '" cy="' + cy + '" r="' + r + '">' + stops + "</radialGradient>";
        }
        var a = (Number(g.angle) || 0) * Math.PI / 180;
        var dx = Math.sin(a), dy = -Math.cos(a);
        var half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
        return '<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="' +
            (w / 2 - dx * half) + '" y1="' + (h / 2 - dy * half) + '" x2="' + (w / 2 + dx * half) +
            '" y2="' + (h / 2 + dy * half) + '">' + stops + "</linearGradient>";
    }

    function shapeTextDiv(o) {
        var p = o.props;
        var s = "font-size:" + (Number(p.fontSize) || 18) + "px;";
        s += "color:" + esc(p.textColor || contrastText(p.fill)) + ";";
        if (p.bold) s += "font-weight:700;";
        if (p.italic) s += "font-style:italic;";
        if (p.fontFamily) s += "font-family:" + esc(OfficeFonts.stack(p.fontFamily)) + ";";
        if (p.lineHeight) s += "line-height:" + (Number(p.lineHeight) || 1.25) + ";";
        // an imported shape carries the same rich paragraph HTML a text
        // object does, plus the alignment and insets its source stated
        if (p.html) {
            s += "text-align:" + esc(p.align || "center") + ";";
            s += "justify-content:" + (VALIGN_JUSTIFY[p.valign] || "center") + ";";
            s += padStyle(p.pad);
            return '<div class="sl-shape-text sl-shape-rich" style="' + s + '">' + p.html + "</div>";
        }
        return '<div class="sl-shape-text" style="' + s + '">' + esc(p.text || "") + "</div>";
    }

    /* A line is normally two points: its origin and the vector in o.w/o.h.
       A connector imported from a pptx may bend, and then carries the whole
       polyline in props.points (relative to o.x/o.y) with o.w/o.h still
       spanning end to end, so selection and dragging keep working. */
    function linePoints(o) {
        var p = o.props && o.props.points;
        if (p && p.length >= 2) {
            return p.map(function (pt) { return [Number(pt[0]) || 0, Number(pt[1]) || 0]; });
        }
        return [[0, 0], [o.w, o.h]];
    }
    function lineBBox(o) {
        var pts = linePoints(o);
        var x0 = pts[0][0], y0 = pts[0][1], x1 = x0, y1 = y0;
        pts.forEach(function (pt) {
            x0 = Math.min(x0, pt[0]); x1 = Math.max(x1, pt[0]);
            y0 = Math.min(y0, pt[1]); y1 = Math.max(y1, pt[1]);
        });
        return { x: o.x + x0, y: o.y + y0, w: x1 - x0, h: y1 - y0 };
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
        // draw in the element's own box: shift the polyline so its
        // top-left corner sits at 0,0
        var pts = linePoints(o);
        var ox = 0, oy = 0;
        pts.forEach(function (pt) { ox = Math.min(ox, pt[0]); oy = Math.min(oy, pt[1]); });
        pts = pts.map(function (pt) { return [pt[0] - ox, pt[1] - oy]; });

        function poly(list) {
            return list.map(function (pt) {
                return pt[0].toFixed(1) + "," + pt[1].toFixed(1);
            }).join(" ");
        }
        var out = '<svg xmlns="http://www.w3.org/2000/svg" style="overflow:visible;" width="100%" height="100%">';
        // generous transparent hit area
        out += '<polyline points="' + poly(pts) + '" fill="none" ' +
            'stroke="rgba(0,0,0,0)" stroke-width="' + Math.max(14, sw + 10) + '"/>';
        // the stroke, its dash and both ends: slides_lines.js, which the PDF
        // exporter asks too
        out += SlidesLines.svgMarkup(pts, p, sw, stroke);
        out += "</svg>";
        return out;
    }

    /* Table cells store a limited HTML subset (so per-cell bold/color/font
       formatting survives edit mode). This sanitizer keeps only inline
       formatting produced by execCommand and strips everything else. */
    var CELL_OK_TAGS = { B: 1, I: 1, U: 1, STRONG: 1, EM: 1, S: 1, STRIKE: 1, SPAN: 1, FONT: 1, BR: 1, SUB: 1, SUP: 1, A: 1, DIV: 1 };
    var CELL_OK_STYLES = ["font-size", "color", "font-family", "font-weight", "font-style", "text-decoration", "background-color",
        "vertical-align", "line-height", "letter-spacing", "text-transform",
        // an imported bullet marker is a positioned span (pptx_reader.go)
        "position", "left", "top", "display", "width"];
    // a paragraph in a cell (an imported table's, or one Enter made) keeps
    // its alignment, spacing and indents
    var CELL_BLOCK_STYLES = ["text-align", "line-height", "margin-top", "margin-bottom", "padding-left",
        "padding-right", "text-indent", "font-size", "position", "top", "tab-size"];
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
                            (ch.tagName === "FONT" && (an === "color" || an === "face" || an === "size")) ||
                            (ch.tagName === "A" && an === "href" &&
                                /^(https?:\/\/|#)/i.test(a.value));
                        if (!ok) ch.removeAttribute(a.name);
                    });
                    if (ch.getAttribute("style")) {
                        var kept = [];
                        ch.getAttribute("style").split(";").forEach(function (decl) {
                            var ci = decl.indexOf(":");
                            if (ci < 0) return;
                            var prop = decl.substring(0, ci).trim().toLowerCase();
                            var okList = ch.tagName === "DIV" ? CELL_BLOCK_STYLES : CELL_OK_STYLES;
                            if (okList.indexOf(prop) >= 0) kept.push(decl.trim());
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
        // an imported table states its own cell shading and insets; one
        // that came with a table style (p.styled) states its whole look,
        // rules included, and gets no heading shading or weight from here
        var cellPad = padStyle(p.cellPad);
        var rule = "";
        if (p.styled) {
            var rw = Number(p.strokeW) || 0;
            rule = (!p.stroke || p.stroke === "none" || rw <= 0) ? "border:none;"
                : "border:" + rw + "px solid " + esc(p.stroke) + ";";
        }
        // merged cells span; the cells under a merge are not drawn
        var span = {}, covered = {};
        (Array.isArray(p.merges) ? p.merges : []).forEach(function (m) {
            var mr = Number(m[0]), mc = Number(m[1]), rs = Math.max(1, Number(m[2]) || 1), cs = Math.max(1, Number(m[3]) || 1);
            if (!(mr >= 0 && mc >= 0) || covered[mr + ":" + mc]) return;
            span[mr + ":" + mc] = [rs, cs];
            for (var y = mr; y < mr + rs; y++) {
                for (var x = mc; x < mc + cs; x++) if (y !== mr || x !== mc) covered[y + ":" + x] = true;
            }
        });
        rows.forEach(function (r, ri) {
            var isHead = p.headerRow && ri === 0;
            var trStyle = (p.rowH && p.rowH[ri] !== undefined) ? ' style="height:' + p.rowH[ri] + '%;"' : "";
            out += '<tr class="' + (isHead && !p.styled ? "sl-thead" : "") + '"' + trStyle + ">";
            r.forEach(function (cell, ci) {
                var bg = (p.cellFill && p.cellFill[ri]) ? p.cellFill[ri][ci] : "";
                if (!bg && isHead && !p.styled) bg = headBg;
                var va = (p.cellAnchor && p.cellAnchor[ri]) ? p.cellAnchor[ri][ci] : "";
                var tdStyle = cellPad + rule + (bg ? "background:" + esc(bg) + ";" : "") +
                    (va === "middle" || va === "bottom" ? "vertical-align:" + va + ";" : "");
                if (covered[ri + ":" + ci]) return;
                var sp = span[ri + ":" + ci];
                out += '<td data-r="' + ri + '" data-c="' + ci + '"' +
                    (sp && sp[0] > 1 ? ' rowspan="' + sp[0] + '"' : "") +
                    (sp && sp[1] > 1 ? ' colspan="' + sp[1] + '"' : "") +
                    (tdStyle ? ' style="' + tdStyle + '"' : "") + ">" +
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
                d.innerHTML = imageHtml(o.props, o.w, o.h);
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
            case "video":
                d.innerHTML = '<video class="sl-media" src="' + esc(o.props.src || "") +
                    '" preload="metadata" controls' + (o.props.autoplay ? " autoplay muted" : "") + "></video>";
                break;
            case "audio":
                d.innerHTML = '<div class="sl-audio-box"><i class="music icon"></i>' +
                    '<audio class="sl-media" src="' + esc(o.props.src || "") +
                    '" preload="metadata" controls' + (o.props.autoplay ? " autoplay" : "") + "></audio></div>";
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
        applyBgLayer(el, slide);
        el.style.color = th.text;
        (slide.objects || []).forEach(function (o, i) {
            el.appendChild(renderObjectEl(o, i));
        });
    }

    /* An imported slide may have a picture or a gradient for its
       background (slide.bgImage / slide.bgGrad), drawn over its plain
       colour. It is painted by the slide surface's ::before (slides.css,
       .sl-hasbg) from two custom properties rather than by a child element,
       so the surface's children stay exactly its objects, in order - the
       PDF exporter and the hit testing both count on that. */
    function gradientCss(g) {
        if (!g || !Array.isArray(g.stops) || !g.stops.length) return "";
        var stops = g.stops.map(function (st) {
            return esc(String(st.color || "#000000")) + " " +
                ((Number(st.pos) || 0) * 100).toFixed(2) + "%";
        });
        if (stops.length === 1) stops.push(stops[0]);
        if (g.kind === "radial") {
            var cx = Number(g.cx), cy = Number(g.cy);
            return "radial-gradient(circle farthest-corner at " +
                ((isFinite(cx) ? cx : 0.5) * 100) + "% " + ((isFinite(cy) ? cy : 0.5) * 100) + "%," +
                stops.join(",") + ")";
        }
        return "linear-gradient(" + (Number(g.angle) || 0) + "deg," + stops.join(",") + ")";
    }
    function bgLayerCss(slide) {
        var im = slide.bgImage;
        if (im && im.src) {
            var url = 'url("' + String(im.src).replace(/["\\\n]/g, "") + '")';
            var w = Number(im.w) || SLIDE_W, h = Number(im.h) || SLIDE_H;
            return url + " " + (Number(im.x) || 0) + "px " + (Number(im.y) || 0) + "px / " +
                w + "px " + h + "px " + (im.tile ? "repeat" : "no-repeat");
        }
        return gradientCss(slide.bgGrad);
    }
    function applyBgLayer(el, slide) {
        var css = bgLayerCss(slide);
        el.classList.toggle("sl-hasbg", !!css);
        if (!css) {
            el.style.removeProperty("--sl-bgfill");
            el.style.removeProperty("--sl-bgop");
            return;
        }
        el.style.setProperty("--sl-bgfill", css);
        var op = slide.bgImage && slide.bgImage.src ? Number(slide.bgImage.opacity) : 0;
        if (op > 0 && op < 1) el.style.setProperty("--sl-bgop", op);
        else el.style.removeProperty("--sl-bgop");
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

    /* ---- shape adjustments: a callout's tip, a rounded corner ----
       The yellow handle sits where the adjustment is: on the tip of a
       speech bubble, on the top edge where a rounded rectangle's corner
       ends. Positions are in the frame's own (unrotated) box. */
    function adjHandlePos(o) {
        if (o.type !== "shape" || !o.props) return null;
        var kind = SlidesShapes.canonical(o.props.kind || "rect");
        var how = SlidesShapes.adjustable(kind);
        if (how === "tip") {
            if (o.props.adj) return SlidesShapes.tipPoint(kind, o.w, o.h, o.props.adj);
            var lt = SlidesShapes.legacyTip(kind);
            return lt ? [lt.tip[0] * o.w, lt.tip[1] * o.h] : null;
        }
        if (how === "radius") {
            var r = o.props.radius !== undefined ? Number(o.props.radius) : Math.min(o.w, o.h) * 0.15;
            return [clamp(r, 0, Math.min(o.w, o.h) / 2), 0];
        }
        return null;
    }
    /* A callout made before adjustments existed drew its body in the top of
       the frame and its tip at the bottom. The first drag of its handle
       turns it into the adjusted form without moving anything: the frame
       shrinks to the body and the tip is stated where it already was. */
    function adoptAdjustments(o) {
        var kind = SlidesShapes.canonical(o.props.kind || "rect");
        if (SlidesShapes.adjustable(kind) !== "tip" || o.props.adj) return;
        var lt = SlidesShapes.legacyTip(kind);
        if (!lt) return;
        var tip = [lt.tip[0] * o.w, lt.tip[1] * o.h];
        var bodyH = Math.max(8, o.h * lt.body);
        o.h = bodyH;
        o.props.adj = {
            adj1: Math.round((tip[0] - o.w / 2) / o.w * 100000),
            adj2: Math.round((tip[1] - bodyH / 2) / bodyH * 100000)
        };
        if (lt.round) o.props.adj.adj3 = Math.round(lt.round * 100000);
    }

    function renderOverlay() {
        if (!framesEl) return;
        framesEl.innerHTML = "";
        if (window.SlidesImageTools) SlidesImageTools.reposition();
        if (cropId) {
            // the crop tool replaces the selection frame while it is open
            renderCropOverlay();
            return;
        }
        if (cropEl) cropEl.innerHTML = "";
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
                    // handles sit on the real endpoints, which for a bent
                    // connector are the ends of its polyline
                    var lp = linePoints(o);
                    fr.appendChild(mkHandle("p1", lp[0][0] - (bb.x - o.x), lp[0][1] - (bb.y - o.y), hs));
                    fr.appendChild(mkHandle("p2", lp[lp.length - 1][0] - (bb.x - o.x),
                        lp[lp.length - 1][1] - (bb.y - o.y), hs));
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
                    var ah = adjHandlePos(o);
                    if (ah) {
                        var knob = mkHandle("adj", ah[0], ah[1], hs * 0.95);
                        knob.className += " sl-h-adj";
                        knob.title = SlidesShapes.adjustable(o.props.kind) === "tip"
                            ? "Drag to move the tip" : "Drag to round the corners";
                        fr.appendChild(knob);
                    }
                }
            }
            framesEl.appendChild(fr);
        });
    }

    /* ================= image crop tool =================
       Cropping is a view onto the picture, never a change to its pixels:
       the object frame states which part is visible and props.crop states
       which part of the source that is. While the tool is open the whole
       picture is shown ghosted, with the part that will be kept drawn at
       full strength on top - so dragging a handle shrinks the visible
       window and dragging the picture slides it behind that window. */

    // fullImageRect returns where the whole picture sits, in slide units,
    // given the frame and crop an object currently has
    function fullImageRect(o) {
        var c = o.props.crop;
        var l = 0, t = 0, kw = 1, kh = 1;
        if (c && c.length === 4) {
            l = Number(c[0]) || 0;
            t = Number(c[1]) || 0;
            kw = 1 - l - (Number(c[2]) || 0);
            kh = 1 - t - (Number(c[3]) || 0);
        }
        if (!(kw > 0.001) || !(kh > 0.001)) { l = 0; t = 0; kw = 1; kh = 1; }
        var fw = o.w / kw, fh = o.h / kh;
        return { x: o.x - l * fw, y: o.y - t * fh, w: fw, h: fh };
    }

    function startCrop(id) {
        var o = objById(id);
        if (!o || o.type !== "image") return;
        if (editingId) endEdit(true);
        if (cropId && cropId !== id) endCrop(true);
        setSel([id]);
        cropId = id;
        cropBefore = { x: o.x, y: o.y, w: o.w, h: o.h,
                       crop: o.props.crop ? o.props.crop.slice() : null };
        cropFull = fullImageRect(o);
        cropRect = { x: o.x, y: o.y, w: o.w, h: o.h };
        renderOverlay();
        syncToolbarFromSel();
        OfficeApp.setStatus(
            "Crop: drag the handles to trim, drag the picture to reposition, " +
            "Enter to apply, Esc to cancel", "info", 6000);
    }

    function endCrop(apply) {
        if (!cropId) return;
        var o = objById(cropId);
        cropId = null;
        if (o) {
            if (apply) {
                var l = (cropRect.x - cropFull.x) / cropFull.w;
                var t = (cropRect.y - cropFull.y) / cropFull.h;
                var r = 1 - (cropRect.x + cropRect.w - cropFull.x) / cropFull.w;
                var b = 1 - (cropRect.y + cropRect.h - cropFull.y) / cropFull.h;
                var crop = [l, t, r, b].map(function (v) {
                    return Math.round(clamp(v, 0, 0.99) * 10000) / 10000;
                });
                var cropped = crop.some(function (v) { return v > 0.0005; });
                // the frame the whole picture would fill is what Reset image
                // puts back, so it is stamped the first time one is trimmed
                if (cropped && !o.props.orig) {
                    o.props.orig = {
                        x: Math.round(cropFull.x * 100) / 100,
                        y: Math.round(cropFull.y * 100) / 100,
                        w: Math.round(cropFull.w * 100) / 100,
                        h: Math.round(cropFull.h * 100) / 100
                    };
                }
                o.x = cropRect.x; o.y = cropRect.y;
                o.w = cropRect.w; o.h = cropRect.h;
                if (cropped) o.props.crop = crop; else delete o.props.crop;
                commit();
            } else {
                o.x = cropBefore.x; o.y = cropBefore.y;
                o.w = cropBefore.w; o.h = cropBefore.h;
                if (cropBefore.crop) o.props.crop = cropBefore.crop;
                else delete o.props.crop;
                renderEditorSlide();
            }
        }
        cropRect = cropFull = cropBefore = null;
        renderOverlay();
        syncToolbarFromSel();
    }

    var CROP_HANDLES = [
        ["nw", 0, 0], ["n", 0.5, 0], ["ne", 1, 0], ["e", 1, 0.5],
        ["se", 1, 1], ["s", 0.5, 1], ["sw", 0, 1], ["w", 0, 0.5]
    ];

    function renderCropOverlay() {
        if (!cropEl) return;
        var o = objById(cropId);
        if (!o) { cropEl.innerHTML = ""; return; }
        // the picture itself is hidden while the tool is open, so what is
        // on screen is only the ghost and the part being kept
        var srcEl = objEl(cropId);
        if (srcEl) srcEl.classList.add("sl-cropping");
        var s = curScale() || 1;
        var src = esc(o.props.src || "");
        var box = function (r) {
            return "left:" + r.x + "px;top:" + r.y + "px;" +
                "width:" + Math.max(1, r.w) + "px;height:" + Math.max(1, r.h) + "px;";
        };
        var html = '<div class="sl-crop-ghost" style="' + box(cropFull) + '">' +
            '<img draggable="false" src="' + src + '" alt=""></div>';
        // the kept part: the same picture, positioned so it lines up with
        // the ghost behind it, clipped by the crop rectangle
        html += '<div class="sl-crop-rect" style="' + box(cropRect) + '">' +
            '<img draggable="false" src="' + src + '" alt="" style="' +
            "left:" + (cropFull.x - cropRect.x) + "px;top:" + (cropFull.y - cropRect.y) + "px;" +
            "width:" + cropFull.w + "px;height:" + cropFull.h + 'px;">';
        // corner grips are drawn as an L hugging the corner, edge grips as
        // a bar centred on the edge - the same language Slides/Docs use
        var len = Math.min(Math.max(9, 14 / s), Math.min(cropRect.w, cropRect.h) / 2);
        var th = Math.max(2.5, 4 / s);
        CROP_HANDLES.forEach(function (h) {
            var name = h[0];
            var left, top, w, hgt, extra = "";
            if (name === "n" || name === "s") {
                w = len; hgt = th;
                left = cropRect.w / 2 - len / 2;
                top = name === "n" ? 0 : cropRect.h - th;
            } else if (name === "e" || name === "w") {
                w = th; hgt = len;
                left = name === "w" ? 0 : cropRect.w - th;
                top = cropRect.h / 2 - len / 2;
            } else {
                w = len; hgt = len;
                left = name.indexOf("w") >= 0 ? 0 : cropRect.w - len;
                top = name.indexOf("n") >= 0 ? 0 : cropRect.h - len;
                extra = "background:transparent;" +
                    "border-" + (name.indexOf("n") >= 0 ? "top" : "bottom") +
                    ":" + th + "px solid #202124;" +
                    "border-" + (name.indexOf("w") >= 0 ? "left" : "right") +
                    ":" + th + "px solid #202124;";
            }
            html += '<div class="sl-croph" data-ch="' + name + '" style="' +
                "left:" + left + "px;top:" + top + "px;" +
                "width:" + w + "px;height:" + hgt + "px;" + extra + '"></div>';
        });
        html += "</div>";
        cropEl.innerHTML = html;
    }

    /* Reset image: undo every crop and shaped crop and put the picture
       back the way it came in. props.orig remembers the frame the whole
       picture filled when it was first trimmed; without one (a picture
       that was only masked) the frame stays where it is and only its
       height is corrected to the source's own aspect ratio. */
    function resetImage(o) {
        if (!o || o.type !== "image") return;
        if (cropId === o.id) endCrop(false);
        var full = fullImageRect(o);
        // everything the picture tools can put on a picture comes off: the
        // crop, the shaped crop, the flips and the colour treatment
        ["crop", "mask", "radius", "flipH", "flipV",
         "recolor", "bright", "contrast", "opacity"].forEach(function (k) {
            delete o.props[k];
        });
        if (o.props.orig) {
            o.x = o.props.orig.x; o.y = o.props.orig.y;
            o.w = o.props.orig.w; o.h = o.props.orig.h;
            delete o.props.orig;
        } else {
            o.x = full.x; o.y = full.y; o.w = full.w; o.h = full.h;
        }
        var nat = naturalSizeOf(o);
        if (nat && nat.w > 0 && nat.h > 0) {
            // a picture stretched by dragging a corner is undistorted too
            o.h = Math.max(8, o.w * nat.h / nat.w);
        }
        commit();
        OfficeApp.setStatus("Image reset", "success", 2000);
    }

    // naturalSizeOf reads the source's own pixel size off the live <img>,
    // which is already decoded because the object is on screen
    function naturalSizeOf(o) {
        var el = objEl(o.id);
        var img = el ? el.querySelector("img") : null;
        if (img && img.naturalWidth > 0) {
            return { w: img.naturalWidth, h: img.naturalHeight };
        }
        return null;
    }

    function setImageMask(o, kind) {
        if (!o || o.type !== "image") return;
        if (cropId === o.id) endCrop(true);
        if (!kind || kind === "rect") {
            delete o.props.mask;
            delete o.props.radius;
        } else {
            o.props.mask = kind;
            if (kind === "roundRect") o.props.radius = Math.min(o.w, o.h) * 0.15;
            else delete o.props.radius;
        }
        commit();
    }

    /* ================= rendering: rail / thumbnails ================= */

    /* A preview is the whole slide at full size, shrunk by a transform. The
       box it has to fit inside is whatever the rail can spare once the
       scrollbar has taken its cut, which varies by platform - so measure it
       rather than assume it. Getting this wrong does not look like a wrong
       scale, it looks like the right-hand edge of every slide is missing. */
    function fitThumbs() {
        var view = document.querySelector("#slThumbs .sl-thumb-view");
        var thumbs = document.getElementById("slThumbs");
        if (!view || !thumbs) return;
        var w = view.clientWidth;
        if (w > 0) thumbs.style.setProperty("--sl-thumb-scale", w / SLIDE_W);
    }

    function renderThumb(i) {
        var $mini = $("#slThumbs .sl-thumb").eq(i).find(".sl-thumb-mini");
        if ($mini.length && body.slides[i]) renderSlideContent($mini[0], body.slides[i]);
        if (overview) {
            var $ov = $("#slOverview .sl-ov-card").eq(i).find(".sl-ov-mini");
            if ($ov.length && body.slides[i]) renderSlideContent($ov[0], body.slides[i]);
        }
    }
    function renderThumbSoon(i) {
        clearTimeout(thumbTimer);
        thumbTimer = setTimeout(function () { renderThumb(i); }, 220);
    }
    function renderAllThumbs() {
        body.slides.forEach(function (s, i) { renderThumb(i); });
    }

    var dragSlideIdx = -1;

    // railFocused answers whose Delete key it is: the rail's or the canvas's
    function railFocused() {
        var a = document.activeElement;
        var rail = document.getElementById("slRail");
        return !!(a && rail && rail.contains(a));
    }

    function renderRail() {
        // deleting a slide rebuilds the rail, and the keyboard should not
        // have to be given back by hand to delete the next one
        var refocus = railFocused();
        var $t = $("#slThumbs").empty();
        body.slides.forEach(function (s, i) {
            var $th = $('<div class="sl-thumb" draggable="true" tabindex="0"></div>');
            if (i === cur) $th.addClass("active");
            $th.append('<div class="sl-thumb-num">' + (i + 1) + "</div>");
            var $view = $('<div class="sl-thumb-view"><div class="sl-thumb-mini sl-slidebase"></div></div>');
            $th.append($view);
            renderSlideContent($view.find(".sl-thumb-mini")[0], s);
            // Taking focus is what lets Delete mean "this slide", and
            // focusing selects - so the slide the keyboard is on and the
            // slide being edited can never be two different slides.
            $th.on("click", function () { $th.focus(); selectSlide(i); });
            $th.on("focus", function () { selectSlide(i); });
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
        fitThumbs();
        if (refocus) $("#slThumbs .sl-thumb").eq(cur).focus();
        if (overview) {
            renderOverview();
            focusOverview();
        }
    }
    function updateRailActive() {
        $("#slThumbs .sl-thumb").each(function (i) {
            $(this).toggleClass("active", i === cur);
        });
        // walking the deck with the keys: the rail scrolls with it
        var act = $("#slThumbs .sl-thumb").eq(cur)[0];
        if (act) act.scrollIntoView({ block: "nearest", inline: "nearest" });
        if (overview) {
            $("#slOverview .sl-ov-card").each(function (i) {
                $(this).toggleClass("active", i === cur);
            });
        }
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
        // the re-render replaced the object element - re-anchor the floating
        // bar to the fresh node (also refreshes its table-op section)
        showTextEditBar(o, el);
        syncListButtonState();
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
        // the picture bar is anchored to a DOM node the re-render replaced
        if (window.SlidesImageTools) SlidesImageTools.sync();
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
        endCrop(true);
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
    function addSlideAfter(i, layout) {
        endEdit(true);
        body.slides.splice(i + 1, 0, newSlide(layout || "normal"));
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
        endCrop(false);
        endEdit(false);
        var slide = curSlide();
        slide.objects = slide.objects.filter(function (o) { return sel.indexOf(o.id) < 0; });
        slide.objects.forEach(function (o, i) { o.z = i + 1; });
        sel = [];
        commit();
    }
    /* Object copies also ride the SYSTEM clipboard as marker JSON.
       Without this, Ctrl+C on an object left the system clipboard holding
       whatever was copied before (e.g. an old screenshot), and the paste
       handler - which rightly checks clipboard images first - pasted that
       stale content instead of duplicating the object. Bonus: objects now
       paste across two Slides windows. */
    var OBJ_CLIP_MARKER = "arozos-slides-objects";
    /* A shared text/html snapshot of the copied objects so they can be
       pasted into Docs/Sheets (and external editors). Images/text/tables/
       shapes carry over; video/audio/lines are same-app only. */
    function objectsToHtml(objs) {
        if (!objs || !objs.length) return "";
        var parts = [];
        objs.forEach(function (o) {
            if (o.type === "image") {
                parts.push(OfficeClipboard.imageHtml(absoluteMedia(o.props.src), o.w, o.h));
            } else if (o.type === "text") {
                parts.push('<div>' + (o.props.html || "") + "</div>");
            } else if (o.type === "table") {
                parts.push(tableHtml(o));
            } else if (o.type === "shape") {
                parts.push(OfficeClipboard.imageHtml(
                    OfficeClipboard.svgImageSrc(shapeSvg(o)), o.w, o.h));
            } else if (o.type === "chart") {
                // render the chart spec to a self-contained SVG snapshot
                var csvg = OfficeCharts.renderToString(o.props.spec || {},
                    Math.max(60, o.w), Math.max(60, o.h));
                csvg = csvg.replace("<svg ", '<svg color="#202124" ');
                parts.push(OfficeClipboard.imageHtml(
                    OfficeClipboard.svgImageSrc(csvg), o.w, o.h));
            }
        });
        return parts.join("\n");
    }
    // media?file= links are relative to Office/<app>/; Docs sits at the same
    // depth so they resolve unchanged, but make device data URLs pass through
    function absoluteMedia(src) { return src || ""; }
    function objectClipboardText() {
        return JSON.stringify({ app: OBJ_CLIP_MARKER, version: 1, objects: clip });
    }
    function parseObjectClipboardText(t) {
        if (!t || t.indexOf(OBJ_CLIP_MARKER) < 0) return null;
        try {
            var o = JSON.parse(t);
            if (o && o.app === OBJ_CLIP_MARKER && Array.isArray(o.objects) && o.objects.length) {
                return o.objects;
            }
        } catch (e) { }
        return null;
    }
    function copySelection() {
        if (!sel.length) return;
        clip = selObjs().map(deep);
        // async system-clipboard sync for menu/toolbar copies (writes both
        // the object marker and the shared text/html); real Ctrl+C goes
        // through the "copy" event which sets both synchronously
        OfficeClipboard.writeAsync({
            text: objectClipboardText(),
            html: objectsToHtml(clip)
        }).catch(function () { });
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
        var gidMap = {};   // pasted copies form their own new groups
        clip.forEach(function (c) {
            var n = deep(c);
            n.id = genId();
            if (n.group) {
                if (!gidMap[n.group]) gidMap[n.group] = genId("g");
                n.group = gidMap[n.group];
            }
            n.x += 15; n.y += 15;
            n.z = slide.objects.length + 1;
            slide.objects.push(n);
            ids.push(n.id);
        });
        clip = clip.map(function (c) { var n = deep(c); n.x += 15; n.y += 15; return n; });
        setSel(ids);
        commit();
        adoptPastedMedia(ids);
        return true;
    }
    /* Pictures copied from another window link into that window's working
       copies, which go when it closes: make them this window's own. */
    function adoptPastedMedia(ids) {
        var slide = curSlide();
        slide.objects.forEach(function (o) {
            if (ids.indexOf(o.id) < 0 || !o.props) return;
            ["src", "png", "poster"].forEach(function (k) {
                var v = o.props[k];
                if (!v || !OfficePlatform.isForeignWorkingCopy(v)) return;
                OfficePlatform.adoptSrc(v, function (nv) {
                    if (nv === v || o.props[k] !== v) return;
                    o.props[k] = nv;
                    OfficeApp.markDirty();
                    renderAll();
                });
            });
        });
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

    /* ---------- grouping ---------- */
    function groupSelection() {
        var so = selObjs();
        if (so.length < 2) {
            OfficeApp.setStatus("Select two or more objects to group them", "error");
            return;
        }
        var gid = genId("g");
        so.forEach(function (o) { o.group = gid; });
        commit();
        OfficeApp.setStatus("Grouped " + so.length + " objects");
    }
    function ungroupSelection() {
        var so = selObjs();
        var any = false;
        so.forEach(function (o) { if (o.group) { delete o.group; any = true; } });
        if (any) {
            commit();
            OfficeApp.setStatus("Ungrouped");
        }
    }
    function selectionHasGroup() {
        return selObjs().some(function (o) { return !!o.group; });
    }
    /* expand an id list with every member of the touched groups */
    function expandGroups(ids) {
        var gids = {};
        ids.forEach(function (id) {
            var o = objById(id);
            if (o && o.group) gids[o.group] = true;
        });
        if (!Object.keys(gids).length) return ids;
        var out = ids.slice();
        curSlide().objects.forEach(function (o) {
            if (o.group && gids[o.group] && out.indexOf(o.id) < 0) out.push(o.id);
        });
        return out;
    }

    /* ---------- animation / link ---------- */
    function setAnimation(key) {
        applyToSel(function (o) {
            if (key) o.props.anim = key;
            else delete o.props.anim;
            return true;
        });
        OfficeApp.setStatus(key
            ? "Entrance animation set - objects appear click-by-click in present mode"
            : "Animation removed");
    }
    function linkDialog() {
        var so = selObjs();
        if (so.length !== 1) {
            OfficeApp.setStatus("Select a single object to link", "error");
            return;
        }
        var o = so[0];
        var cur = o.props.link || "";
        var isSlide = /^#\d+$/.test(cur);
        var $b = $(
            '<div><label style="display:flex;align-items:center;gap:6px;">' +
            '<input type="radio" name="slLinkKind" value="url" style="width:auto;"' + (isSlide ? "" : " checked") + "> Web address</label>" +
            '<input type="text" id="slLinkUrl" placeholder="https://..." value="' + esc(isSlide ? "" : cur) + '">' +
            '<label style="display:flex;align-items:center;gap:6px;margin-top:10px;">' +
            '<input type="radio" name="slLinkKind" value="slide" style="width:auto;"' + (isSlide ? " checked" : "") + "> Go to slide</label>" +
            '<input type="number" id="slLinkSlide" min="1" max="' + body.slides.length + '" value="' +
            (isSlide ? cur.substring(1) : "1") + '"></div>'
        );
        OfficeApp.dialog({
            title: "Object link (opens in present mode)",
            body: $b,
            buttons: [
                {
                    label: "Remove link", danger: true,
                    action: function (close) {
                        close();
                        delete o.props.link;
                        commit();
                    }
                },
                { label: "Cancel" },
                {
                    label: "Apply", primary: true,
                    action: function (close, $bd) {
                        var kind = $bd.find('input[name="slLinkKind"]:checked').val();
                        if (kind === "slide") {
                            var n = clamp(parseInt($bd.find("#slLinkSlide").val(), 10) || 1, 1, body.slides.length);
                            o.props.link = "#" + n;
                        } else {
                            var u = $bd.find("#slLinkUrl").val().trim();
                            if (!/^https?:\/\//i.test(u)) {
                                OfficeApp.toast("Enter a full http(s):// address", "error");
                                return;
                            }
                            o.props.link = u;
                        }
                        close();
                        commit();
                    }
                }
            ]
        });
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
    /* showShapePicker is the Insert > Shape control: the categories on the
       left, the shapes of the one in hand as icons on the right. Icons and
       not a list of names, because the outline is the thing being chosen -
       and they are drawn from the catalogue, so a picker entry cannot come
       to disagree with what gets inserted. */
    var $shapePicker = null;
    function closeShapePicker() {
        if ($shapePicker) { $shapePicker.remove(); $shapePicker = null; }
        $(document).off("mousedown.slshapepick");
    }
    function showShapePicker(x, y) {
        closeShapePicker();
        var $m = $('<div class="sl-shapepick of-noprint"></div>');
        var $cats = $('<div class="sl-shapepick-cats"></div>');
        var $grid = $('<div class="sl-shapepick-grid"></div>');
        SlidesShapes.CATEGORIES.forEach(function (c, idx) {
            var $b = $('<button type="button" class="sl-shapepick-cat"></button>');
            $b.append($('<i class="icon"></i>').addClass(c.icon));
            $b.append($("<span></span>").text(c.label));
            $b.append('<i class="caret right icon sl-shapepick-more"></i>');
            function open() {
                $cats.find(".sl-shapepick-cat").removeClass("active");
                $b.addClass("active");
                $grid.empty();
                c.kinds.forEach(function (k) {
                    var $cell = $('<button type="button" class="sl-shapepick-cell"></button>')
                        .attr("title", SlidesShapes.label(k))
                        .html(SlidesShapes.icon(k, 22));
                    $cell.on("click", function () { closeShapePicker(); insertShape(k); });
                    $grid.append($cell);
                });
            }
            $b.on("mouseenter click", open);
            if (idx === 0) open();
            $cats.append($b);
        });
        $m.append($cats).append($grid);
        $("body").append($m);
        var mw = $m.outerWidth(), mh = $m.outerHeight();
        $m.css({
            left: Math.max(4, Math.min(x, window.innerWidth - mw - 6)) + "px",
            top: Math.max(4, Math.min(y, window.innerHeight - mh - 6)) + "px"
        });
        $shapePicker = $m;
        setTimeout(function () {
            $(document).on("mousedown.slshapepick", function (e) {
                if ($shapePicker && !$shapePicker[0].contains(e.target)) closeShapePicker();
            });
        }, 0);
    }

    // a brace or a bracket only reads as itself tall and narrow, so the
    // catalogue gets to say what box its shapes want
    function shapeDefaultSize(kind) {
        return SlidesShapes.defaultSize(kind) || [200, 160];
    }
    function shapeProps(kind) {
        var th = themeOf();
        var props = {
            kind: kind, fill: /^#[0-9a-fA-F]{6}$/.test(th.accent) ? th.accent : "#e07b1f",
            stroke: "#333333", strokeW: 0, text: "", fontSize: 18
        };
        // a speech bubble starts with its tip where PowerPoint puts one,
        // and a yellow handle to move it
        if (SlidesShapes.adjustable(kind) === "tip") props.adj = SlidesShapes.tipDefaults(kind);
        return props;
    }
    /* Picking a shape arms the canvas, as PowerPoint does: drag out the box
       it should fill (Shift keeps the shape's own proportions), or click to
       drop one at its default size there. */
    var pendingShape = null;
    function insertShape(kind) {
        armDraw("shape");
        pendingShape = kind;
        OfficeApp.setStatus("Drag on the slide to draw the " + SlidesShapes.label(kind).toLowerCase() +
            " (Shift keeps its proportions), or click to place it - Esc to cancel", "info", 0);
    }
    function armDraw(kind) {
        endEdit(true);
        pendingDraw = kind;
        pendingShape = null;
        canvasEl.classList.add("sl-drawmode");
        OfficeApp.setStatus("Drag on the slide to draw a " + (kind === "arrow" ? "arrow" : "line") +
            " - Esc to cancel", "info", 0);
        syncDrawButtons();
    }
    function disarmDraw() {
        pendingDraw = null;
        pendingShape = null;
        canvasEl.classList.remove("sl-drawmode");
        OfficeApp.setStatus("");
        syncDrawButtons();
    }
    function syncDrawButtons() {
        $("#slBtnLine").toggleClass("active", pendingDraw === "line");
        $("#slBtnArrow").toggleClass("active", pendingDraw === "arrow");
        if (window.OfficeRibbon) OfficeRibbon.refresh();
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
    /* ArozOS storage does not exist in the standalone web edition; the menu
       drops the entry there rather than offering a picker that cannot open. */
    function storageSourceItem(action) {
        if (!OfficePlatform.hasBackend()) return null;
        return { label: "From ArozOS storage...", icon: "folder open", action: action };
    }
    function imageFromStorage() {
        OfficePlatform.pickOpen({
            filter: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"],
            multiple: true,
            memoryKey: "media"
        }, function (files) {
            files.forEach(function (f) {
                // reference the storage file - the server reads it into the
                // saved file, keeping edits and saves lightweight
                placeImage(OfficeApp.mediaUrl(f.filepath));
            });
        });
    }
    function imageFromDevice() {
        $("#slDeviceImage").trigger("click");
    }
    function imageFromUrl() {
        OfficeApp.prompt("Insert image from URL", "Image URL", "https://", function (v) {
            if (v) placeImage(v.trim());
        });
    }

    /* ---------- video / audio (workdir-linked, read into the file on save) ---------- */
    function placeMedia(kind, src) {
        var geo = kind === "video"
            ? { x: 240, y: 135, w: 480, h: 270 }
            : { x: 280, y: 240, w: 400, h: 64 };
        addObj(kind, { src: src, autoplay: false }, geo);
        OfficeApp.setStatus(TYPE_NAMES[kind] + " inserted - it plays with its controls in present mode");
    }
    function mediaBlobToObject(kind, blob, name) {
        if (blob.size > MEDIA_MAX_BYTES) {
            OfficeApp.toast("File is too large (max " + Math.round(MEDIA_MAX_BYTES / 1048576) + " MB)", "error");
            return;
        }
        // big files stream to user:/.appdata/Office/uploads and are linked;
        // the save reads them server side without a giant POST payload
        OfficeApp.showBusy("Importing " + (name || TYPE_NAMES[kind].toLowerCase()) + "...");
        OfficeApp.blobToSrc(blob, name || (kind + ".bin"), function (src) {
            OfficeApp.hideBusy();
            placeMedia(kind, src);
        }, function (msg) {
            OfficeApp.hideBusy();
            OfficeApp.toast(msg, "error");
        });
    }
    function mediaFromStorage(kind) {
        var filters = kind === "video"
            ? ["mp4", "webm", "ogv"]
            : ["mp3", "wav", "ogg", "flac", "aac"];
        OfficePlatform.pickOpen({ filter: filters, memoryKey: "media" }, function (files) {
            // just link it - the server reads the file in at save time
            placeMedia(kind, OfficeApp.mediaUrl(files[0].filepath));
        });
    }
    function mediaFromDevice(kind) {
        var input = document.createElement("input");
        input.type = "file";
        input.accept = kind === "video" ? "video/*" : "audio/*";
        input.onchange = function () {
            if (input.files && input.files[0]) {
                mediaBlobToObject(kind, input.files[0], input.files[0].name);
            }
        };
        input.click();
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
        // a picture or gradient brought in with the deck stays until the
        // slide is given a colour (or the theme's background) instead
        var fancy = !!(slide.bgImage || slide.bgGrad);
        var initial = (slide.bg && /^#[0-9a-f]{6}/i.test(slide.bg)) ? slide.bg.substring(0, 7) : "#ffffff";
        var $b = $(
            (fancy ? '<div class="sl-swatch-row"><input type="checkbox" id="slBgKeep" style="width:auto;" checked>' +
                '<label for="slBgKeep" style="display:inline;margin:0;">Keep the picture / gradient background</label></div>' : "") +
            '<div class="sl-swatch-row"><input type="checkbox" id="slBgTheme" style="width:auto;"' +
            (slide.bg || fancy ? "" : " checked") + ">" +
            '<label for="slBgTheme" style="display:inline;margin:0;">Use theme background</label></div>' +
            '<div class="sl-swatch-row"><label style="display:inline;margin:0;">Custom color</label></div>'
        );
        $b.children().last().append(OfficeColorPicker.swatchInput({
            id: "slBgColor", title: "Slide background color", value: initial
        }).css({ width: "60px", height: "32px" }));
        $b.find("#slBgColor").on("input", function () {
            $b.find("#slBgTheme, #slBgKeep").prop("checked", false);
        });
        $b.find("#slBgTheme").on("change", function () {
            if (this.checked) $b.find("#slBgKeep").prop("checked", false);
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
                        if (fancy && $bd.find("#slBgKeep").prop("checked")) {
                            close();
                            return;
                        }
                        delete slide.bgImage;
                        delete slide.bgGrad;
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
        if (Array.isArray(o.props.cellFill)) o.props.cellFill.splice(t.r + (after ? 1 : 0), 0, row.slice());
        if (Array.isArray(o.props.cellAnchor)) o.props.cellAnchor.splice(t.r + (after ? 1 : 0), 0, row.slice());
        // a merge cannot follow the grid through a new row or column
        delete o.props.merges;
        delete o.props.rowH;
        o.h += Math.max(24, Math.round(o.h / Math.max(1, o.props.rows.length - 1)));
        commit();
    }
    function tableDelRow(o) {
        if (o.props.rows.length <= 1) return;
        var t = tableCellTarget(o);
        var rowH = Math.round(o.h / o.props.rows.length);
        o.props.rows.splice(t.r, 1);
        if (Array.isArray(o.props.cellFill)) o.props.cellFill.splice(t.r, 1);
        if (Array.isArray(o.props.cellAnchor)) o.props.cellAnchor.splice(t.r, 1);
        delete o.props.merges;
        delete o.props.rowH;
        o.h = Math.max(30, o.h - rowH);
        lastCell = null;
        commit();
    }
    function tableAddCol(o, after) {
        var t = tableCellTarget(o);
        o.props.rows.forEach(function (r) { r.splice(t.c + (after ? 1 : 0), 0, ""); });
        (o.props.cellFill || []).concat(o.props.cellAnchor || []).forEach(function (r) { if (Array.isArray(r)) r.splice(t.c + (after ? 1 : 0), 0, ""); });
        delete o.props.merges;
        delete o.props.colW;
        o.w = Math.min(940, o.w + Math.max(60, Math.round(o.w / Math.max(1, o.props.rows[0].length - 1))));
        commit();
    }
    function tableDelCol(o) {
        if ((o.props.rows[0] || []).length <= 1) return;
        var t = tableCellTarget(o);
        var colWpx = Math.round(o.w / o.props.rows[0].length);
        o.props.rows.forEach(function (r) { r.splice(t.c, 1); });
        (o.props.cellFill || []).concat(o.props.cellAnchor || []).forEach(function (r) { if (Array.isArray(r)) r.splice(t.c, 1); });
        delete o.props.merges;
        delete o.props.colW;
        o.w = Math.max(60, o.w - colWpx);
        lastCell = null;
        commit();
    }

    /* ---------- table ops for the floating text-edit bar ----------
       Rendered by OfficeTextEditBar as an extra divider-separated section
       while a table object is being edited. */
    function currentTableObj() {
        if (editingId) {
            var eo = objById(editingId);
            if (eo && eo.type === "table") return eo;
        }
        var so = selObjs();
        if (so.length === 1 && so[0].type === "table") return so[0];
        return null;
    }
    function withTableObj(fn) {
        var o = currentTableObj();
        if (o) fn(o);
    }
    function slidesTableOps() {
        return [
            {
                icon: "angle up", title: "Insert row above",
                fn: function () { withTableObj(function (o) { tableAddRow(o, false); }); }
            },
            {
                icon: "angle down", title: "Insert row below",
                fn: function () { withTableObj(function (o) { tableAddRow(o, true); }); }
            },
            {
                icon: "angle left", title: "Insert column left",
                fn: function () { withTableObj(function (o) { tableAddCol(o, false); }); }
            },
            {
                icon: "angle right", title: "Insert column right",
                fn: function () { withTableObj(function (o) { tableAddCol(o, true); }); }
            },
            {
                icon: "minus", title: "Delete row",
                fn: function () { withTableObj(function (o) { tableDelRow(o); }); }
            },
            {
                icon: "eraser", title: "Delete column",
                fn: function () { withTableObj(function (o) { tableDelCol(o); }); }
            },
            {
                icon: "trash alternate outline", title: "Delete table",
                fn: function () {
                    withTableObj(function (o) {
                        endEdit(false);
                        setSel([o.id]);
                        deleteSelection();
                    });
                }
            },
            {
                icon: "heading", title: "Header row",
                active: function () {
                    var o = currentTableObj();
                    return !!(o && o.props.headerRow);
                },
                fn: function () {
                    withTableObj(function (o) {
                        o.props.headerRow = !o.props.headerRow;
                        commit();
                    });
                }
            }
        ];
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
        endCrop(true);
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
            syncListButtonState();
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
            },
            tableOps: o.type === "table" ? slidesTableOps() : null
        });
    }
    /* Bulleted / numbered lists only make sense inside a full text box
       (not a shape's single-line caption). Auto-enters edit mode when a
       lone text object is selected but not yet being edited. */
    function toggleList(cmd) {
        if (editingId && editingKind === "text") {
            try { document.execCommand(cmd); } catch (e) { }
            syncListButtonState();
            return;
        }
        var so = selObjs();
        if (so.length === 1 && so[0].type === "text") {
            startEdit(so[0].id);
            setTimeout(function () {
                try { document.execCommand(cmd); } catch (e) { }
                syncListButtonState();
            }, 0);
            return;
        }
        OfficeApp.setStatus("Double-click a text box to edit it, then toggle the list", "error");
    }
    function syncListButtonState() {
        var ul = false, ol = false;
        if (editingId && editingKind === "text") {
            try { ul = document.queryCommandState("insertUnorderedList"); } catch (e) { }
            try { ol = document.queryCommandState("insertOrderedList"); } catch (e) { }
        }
        $("#slBtnUL").toggleClass("active", !!ul);
        $("#slBtnOL").toggleClass("active", !!ol);
    }
    function onEditFocusOut() {
        var id = editingId;
        setTimeout(function () {
            if (!id || editingId !== id) return;
            var el = objEl(id);
            // focus moving into the floating format bar is still "editing",
            // and so is the ribbon's font list or size box
            if (window.OfficeTextEditBar && OfficeTextEditBar.contains(document.activeElement)) return;
            if ($(document.activeElement).closest(".of-ribbon, .of-rb-popup").length) return;
            // a dialog opened over the editor (e.g. the Insert-link prompt)
            // must not tear down the edit - otherwise the box re-renders and
            // the command applies to a dead selection
            if ($(".of-dialog-overlay").length) return;
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
        syncListButtonState();
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

        // crop mode owns every press until it is closed
        if (cropId) {
            if (e.target.classList && e.target.classList.contains("sl-croph")) {
                drag = {
                    mode: "crophandle", h: e.target.getAttribute("data-ch"),
                    start: pt, moved: false,
                    g: { x: cropRect.x, y: cropRect.y, w: cropRect.w, h: cropRect.h }
                };
                try { canvasEl.setPointerCapture(e.pointerId); } catch (err) { }
                e.preventDefault();
                return;
            }
            if (e.target.closest && e.target.closest(".sl-crop-rect, .sl-crop-ghost")) {
                drag = {
                    mode: "croppan", start: pt, moved: false,
                    g: { x: cropFull.x, y: cropFull.y }
                };
                try { canvasEl.setPointerCapture(e.pointerId); } catch (err) { }
                e.preventDefault();
                return;
            }
            // a press anywhere else closes the tool; the next click then
            // does whatever it was going to do, against a settled DOM
            endCrop(true);
            e.preventDefault();
            return;
        }

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

        // armed shape: drag out its box
        if (pendingDraw === "shape" && pendingShape) {
            var sslide = curSlide();
            var sobj = {
                id: genId(), type: "shape", x: pt.x, y: pt.y, w: 0, h: 0, rot: 0,
                z: sslide.objects.length + 1, props: shapeProps(pendingShape)
            };
            sslide.objects.push(sobj);
            renderEditorSlide();
            drag = { mode: "drawshape", id: sobj.id, start: pt, moved: false, kind: pendingShape };
            try { canvasEl.setPointerCapture(e.pointerId); } catch (err) { }
            return;
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
                mode: hname === "rot" ? "rotate" : (hname === "p1" || hname === "p2") ? "lineend"
                    : hname === "adj" ? "adjust" : "resize",
                h: hname, id: o.id, start: pt, moved: false,
                g: { x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rot || 0 }
            };
            if (drag.mode === "adjust") {
                // where the handle starts; an old callout is converted on the
                // first real move (adoptAdjustments), which leaves the tip -
                // and so this point - exactly where it is
                drag.at = adjHandlePos(o) || [0, 0];
                drag.how = SlidesShapes.adjustable(o.props.kind);
            }
            // the pointer leaves the knob as soon as the object turns, so
            // the rotate cursor has to be put on the canvas for the drag
            if (drag.mode === "rotate") canvasEl.classList.add("sl-rotating");
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
                // clicking a grouped object selects its whole group
                setSel(expandGroups(e.shiftKey ? sel.concat([id]) : [id]));
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
            case "adjust": {
                o = objById(drag.id);
                if (!o) return;
                if (drag.how === "tip") adoptAdjustments(o);
                // the pointer's travel, turned into the shape's own box
                var arad = -(drag.g.rot || 0) * Math.PI / 180;
                var lx = drag.at[0] + dx * Math.cos(arad) - dy * Math.sin(arad);
                var ly = drag.at[1] + dx * Math.sin(arad) + dy * Math.cos(arad);
                if (drag.how === "radius") {
                    o.props.radius = Math.round(clamp(lx, 0, Math.min(o.w, o.h) / 2) * 100) / 100;
                } else {
                    var adj = {};
                    Object.keys(o.props.adj || {}).forEach(function (k) { adj[k] = o.props.adj[k]; });
                    adj.adj1 = Math.round((lx - o.w / 2) / Math.max(1, o.w) * 100000);
                    adj.adj2 = Math.round((ly - o.h / 2) / Math.max(1, o.h) * 100000);
                    o.props.adj = adj;
                }
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
            case "crophandle": {
                if (!cropRect || !cropFull) return;
                g = drag.g;
                var MINC = 8;
                var nx = g.x, ny = g.y, nw = g.w, nh = g.h;
                var name = drag.h;
                if (name.indexOf("w") >= 0) {
                    nx = clamp(g.x + dx, cropFull.x, g.x + g.w - MINC);
                    nw = g.x + g.w - nx;
                } else if (name.indexOf("e") >= 0) {
                    nw = clamp(g.w + dx, MINC, cropFull.x + cropFull.w - g.x);
                }
                if (name.indexOf("n") >= 0) {
                    ny = clamp(g.y + dy, cropFull.y, g.y + g.h - MINC);
                    nh = g.y + g.h - ny;
                } else if (name.indexOf("s") >= 0) {
                    nh = clamp(g.h + dy, MINC, cropFull.y + cropFull.h - g.y);
                }
                cropRect = { x: nx, y: ny, w: nw, h: nh };
                renderCropOverlay();
                break;
            }
            case "croppan": {
                if (!cropRect || !cropFull) return;
                // the picture slides behind the window, so the window must
                // stay inside the picture
                cropFull.x = clamp(drag.g.x + dx,
                    cropRect.x + cropRect.w - cropFull.w, cropRect.x);
                cropFull.y = clamp(drag.g.y + dy,
                    cropRect.y + cropRect.h - cropFull.h, cropRect.y);
                renderCropOverlay();
                break;
            }
            case "lineend": {
                o = objById(drag.id);
                if (!o) return;
                g = drag.g;
                // dragging an endpoint straightens an imported bent
                // connector - the editor only draws two-point lines
                if (o.props && o.props.points) delete o.props.points;
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
            case "drawshape": {
                o = objById(drag.id);
                if (!o) return;
                var sx0 = drag.start.x, sy0 = drag.start.y, ex = pt.x, ey = pt.y;
                if (snapGrid) {
                    ex = Math.round(ex / GRID) * GRID;
                    ey = Math.round(ey / GRID) * GRID;
                }
                var bw = Math.abs(ex - sx0), bh = Math.abs(ey - sy0);
                if (e.shiftKey && bw > 0 && bh > 0) {
                    var ds = shapeDefaultSize(drag.kind);
                    var ar = ds[0] / ds[1];
                    if (bw / bh > ar) bw = bh * ar; else bh = bw / ar;
                }
                o.x = ex < sx0 ? sx0 - bw : sx0;
                o.y = ey < sy0 ? sy0 - bh : sy0;
                o.w = bw;
                o.h = bh;
                updateObjEl(o);
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
                setSel(expandGroups(drag.baseSel.concat(hits)));
                break;
            }
        }
    }

    function onCanvasPointerUp(e) {
        if (!drag) return;
        var d = drag;
        drag = null;
        lastPointerEvt = null;
        canvasEl.classList.remove("sl-rotating");
        hideGuides();
        try { canvasEl.releasePointerCapture(e.pointerId); } catch (err) { }

        if (d.mode === "marquee") {
            marqueeEl.style.display = "none";
            return;
        }
        if (d.mode === "drawshape") {
            var so2 = objById(d.id);
            disarmDraw();
            if (!so2) return;
            if (so2.w < 6 && so2.h < 6) {
                // a click: the shape's own size, centred where it was clicked
                var dsz = shapeDefaultSize(d.kind);
                so2.w = dsz[0];
                so2.h = dsz[1];
                so2.x = clamp(d.start.x - dsz[0] / 2, 0, SLIDE_W - dsz[0]);
                so2.y = clamp(d.start.y - dsz[1] / 2, 0, SLIDE_H - dsz[1]);
            } else {
                so2.w = Math.max(6, so2.w);
                so2.h = Math.max(6, so2.h);
            }
            setSel([so2.id]);
            commit();
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
        if (d.mode === "crophandle" || d.mode === "croppan") {
            // the crop tool stays open until it is applied or cancelled
            return;
        }
        if (d.mode === "move" && !d.moved) {
            if (d.pendingToggle) {
                setSel(sel.filter(function (id) { return id !== d.pendingToggle; }));
            } else if (d.pendingCollapse) {
                setSel(expandGroups([d.pendingCollapse]));
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
        else if (o.type === "image") startCrop(id);
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
                { label: "Align to slide", icon: "align center", sub: alignSub() },
                { sep: true },
                {
                    label: "Group", icon: "object group outline", key: "Ctrl+G",
                    enabled: function () { return sel.length >= 2; },
                    action: groupSelection
                },
                {
                    label: "Ungroup", key: "Ctrl+Shift+G",
                    enabled: selectionHasGroup,
                    action: ungroupSelection
                },
                {
                    label: "Animate (entrance)", icon: "magic",
                    sub: ANIMS.map(function (a) {
                        return {
                            label: a.label,
                            checked: function () { return (o.props.anim || "") === a.key; },
                            action: function () { setAnimation(a.key); }
                        };
                    })
                },
                { label: "Link...", icon: "linkify", action: linkDialog }
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
                    label: "Crop image", icon: "crop",
                    action: function () { startCrop(o.id); }
                });
                items.push({
                    label: "Mask image", icon: "object ungroup outline",
                    sub: [{
                        label: "None (rectangle)",
                        checked: function () { return !o.props.mask; },
                        action: function () { setImageMask(o, ""); }
                    }, { sep: true }].concat(MASK_KINDS.filter(function (s) {
                        return s.kind !== "rect";
                    }).map(function (s) {
                        return {
                            label: s.label,
                            checked: function () { return o.props.mask === s.kind; },
                            action: function () { setImageMask(o, s.kind); }
                        };
                    }))
                });
                items.push({
                    label: "Reset image", icon: "history",
                    action: function () { resetImage(o); }
                });
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
            if (o.type === "line" || o.type === "shape" || o.type === "image") {
                items.push({ sep: true });
                items.push({ label: "Line weight", icon: "bars", sub: weightItems() });
                items.push({ label: "Line dash", icon: "ellipsis horizontal", sub: dashItems() });
                if (o.type === "line") {
                    items.push({ label: "Line start", icon: "long arrow alternate left", sub: headItems(false) });
                    items.push({ label: "Line end", icon: "long arrow alternate right", sub: headItems(true) });
                }
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
    function presActive() {
        return !!(window.SlidesPresent && SlidesPresent.isActive());
    }
    /* All editor keys go through the shared OfficeHotkeys registry
       (common/hotkeys.js) - `when` gates replace the old hand-rolled
       onKeyDown ordering, and descriptions feed the Ctrl+/ help dialog.
       Ctrl+C/X/V are NOT consumed here: the native copy/cut/paste events
       (initClipboardAndDnd) own them so the system clipboard stays in
       sync with the object clipboard. */
    function registerHotkeys() {
        var HK = OfficeHotkeys;
        var GS = "Slides", GO = "Objects", GT = "Text editing";
        var notPresenting = function () { return !presActive(); };
        var editorIdle = function () { return !presActive() && !editingId && !cropId; };

        HK.register("F5", function () { endEdit(true); startPresent(cur); },
            { id: "sl.present", description: "Start presentation", group: GS, allowInInput: true, when: notPresenting });
        HK.register("Shift+F5", function () { endEdit(true); startPresent(0); },
            { id: "sl.present0", description: "Present from beginning", group: GS, allowInInput: true, when: notPresenting });
        HK.register("Ctrl+M", function () { addSlideAfter(cur); },
            { id: "sl.newslide", description: "New slide", group: GS, allowInInput: true, when: notPresenting });
        HK.register("PageUp", function () { selectSlide(cur - 1); },
            { id: "sl.prevslide", description: "Previous slide", group: GS, when: editorIdle });
        HK.register("PageDown", function () { selectSlide(cur + 1); },
            { id: "sl.nextslide", description: "Next slide", group: GS, when: editorIdle });

        HK.register("Ctrl+D", function () {
            if (sel.length) duplicateSelection();
            else duplicateSlide(cur);
        }, { id: "sl.duplicate", description: "Duplicate object / slide", group: GO, when: editorIdle });
        HK.register("Ctrl+A", function () { selectAllObjects(); },
            { id: "sl.selectall", description: "Select all objects", group: GO, when: editorIdle });
        HK.register("Ctrl+G", function () { groupSelection(); },
            { id: "sl.group", description: "Group objects", group: GO, when: editorIdle });
        HK.register("Ctrl+Shift+G", function () { ungroupSelection(); },
            { id: "sl.ungroup", description: "Ungroup objects", group: GO, when: editorIdle });
        HK.register("Tab", function () { cycleSelection(); },
            { id: "sl.cycle", description: "Cycle through objects", group: GO, when: editorIdle });
        HK.register("Delete", function () { deleteSelection(); },
            { id: "sl.delete", description: "Delete selection", group: GO, when: function () { return editorIdle() && sel.length > 0; } });
        HK.register("Backspace", function () { deleteSelection(); },
            { id: "sl.delete2", when: function () { return editorIdle() && sel.length > 0; } });
        /* Delete means the slide when the rail has the keyboard and the
           canvas when it does not. Registered after the object one so it
           gets first look (the registry is LIFO), though the two guards are
           mutually exclusive anyway - selecting a slide clears the object
           selection. */
        HK.register("Delete", function () { deleteSlide(cur); },
            { id: "sl.deleteslide", description: "Delete slide", group: GS,
                when: function () { return editorIdle() && railFocused(); } });
        HK.register("Backspace", function () { deleteSlide(cur); },
            { id: "sl.deleteslide2", when: function () { return editorIdle() && railFocused(); } });
        HK.register("Escape", function () {
            if (cropId) { endCrop(false); return; }
            if (editingId) { endEdit(true); return; }
            if (pendingDraw) { disarmDraw(); return; }
            if (sel.length) { setSel([]); return; }
            return false;
        }, { id: "sl.escape", allowInInput: true, when: notPresenting });
        HK.register("Enter", function () {
            if (!cropId) return false;
            endCrop(true);
        }, { id: "sl.cropapply", description: "Apply crop", group: GO,
             when: function () { return !presActive() && !!cropId; } });

        // arrows: nudge the selection (Shift = 10 px) or walk the deck
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].forEach(function (k) {
            var move = function (e) {
                if (sel.length) {
                    var step = e.shiftKey ? 10 : 1;
                    nudgeSelection(
                        k === "ArrowLeft" ? -step : k === "ArrowRight" ? step : 0,
                        k === "ArrowUp" ? -step : k === "ArrowDown" ? step : 0);
                } else if (e.shiftKey) {
                    return false;
                } else if (k === "ArrowUp" || k === "ArrowLeft") {
                    selectSlide(cur - 1);
                } else {
                    selectSlide(cur + 1);
                }
            };
            var desc = k === "ArrowLeft" ? "Nudge selection / change slide (Shift = 10 px)" : "";
            HK.register(k, move, { id: "sl.arrow." + k, description: desc, group: GO, when: editorIdle });
            HK.register("Shift+" + k, move, { id: "sl.sarrow." + k, when: editorIdle });
        });

        // list toggles work while typing inside a text box
        HK.register("Ctrl+Shift+8", function () { toggleList("insertUnorderedList"); },
            { id: "sl.ul", description: "Bulleted list", group: GT, allowInInput: true, when: notPresenting });
        HK.register("Ctrl+Shift+*", function () { toggleList("insertUnorderedList"); },
            { id: "sl.ul2", allowInInput: true, when: notPresenting });
        HK.register("Ctrl+Shift+7", function () { toggleList("insertOrderedList"); },
            { id: "sl.ol", description: "Numbered list", group: GT, allowInInput: true, when: notPresenting });
        HK.register("Ctrl+Shift+&", function () { toggleList("insertOrderedList"); },
            { id: "sl.ol2", allowInInput: true, when: notPresenting });

        // documentation-only entries: the native clipboard events do the
        // actual work, the fall-through handler just lists them in help
        HK.register("Ctrl+C", function () { return false; },
            { id: "sl.copy.doc", description: "Copy objects / text", group: GO, allowInInput: true });
        HK.register("Ctrl+X", function () { return false; },
            { id: "sl.cut.doc", description: "Cut objects / text", group: GO, allowInInput: true });
        HK.register("Ctrl+V", function () { return false; },
            { id: "sl.paste.doc", description: "Paste", group: GO, allowInInput: true });
    }

    /* ================= system clipboard & drag-drop images ================= */
    function fileToImage(file) {
        // small images inline; big ones upload to the Office workdir
        OfficeApp.blobToSrc(file, file.name || "pasted.png", function (src) {
            placeImage(src);
        }, function (msg) {
            OfficeApp.toast(msg, "error");
        });
    }

    /* Native paste event: screenshots / copied images become image objects,
       otherwise fall back to the internal object clipboard, then plain text. */
    function onPasteEvent(e) {
        if (window.SlidesPresent && SlidesPresent.isActive()) return;
        // typing somewhere (text edit, notes, dialogs): keep native paste
        if (editingId || isTypingTarget(e.target) || $(".of-dialog-overlay").length) return;
        var cd = e.clipboardData;
        if (!cd) return;
        // our own object clipboard (marker JSON written by Ctrl+C on
        // objects) wins over everything - it IS the newest copy
        var objs = parseObjectClipboardText(cd.getData("text/plain"));
        if (objs) {
            e.preventDefault();
            clip = objs.map(deep);
            pasteClipboard();
            return;
        }
        var i, handled = false;
        var items = cd.items || [];
        for (i = 0; i < items.length; i++) {
            if (items[i].kind === "file" && items[i].type.indexOf("image/") === 0) {
                var f = items[i].getAsFile();
                if (f) { fileToImage(f); handled = true; }
            }
        }
        if (handled) { e.preventDefault(); return; }
        // cross-app: a Docs picture / Sheets chart / cells arrive as text/html
        var html = cd.getData("text/html");
        if (html && pasteForeignHtml(html)) { e.preventDefault(); return; }
        if (clip && clip.length) { e.preventDefault(); pasteClipboard(); return; }
        var t = cd.getData("text/plain");
        if (t && !OfficeClipboard.isMarker(t)) {
            e.preventDefault();
            var th = themeOf();
            addObj("text", { html: esc(t).replace(/\n/g, "<br>"), fontSize: 24, color: th.text, align: "left" },
                { x: 280, y: 220, w: 400, h: 90 });
        }
    }
    /* Build slide objects from a shared text/html payload. Returns true when
       something was inserted. */
    function pasteForeignHtml(html) {
        var p = OfficeClipboard.parse(html);
        if (!p.hasContent) return false;
        if (p.images.length) {
            p.images.forEach(function (im) { placeImage(im.src); });
            return true;
        }
        if (p.tables.length) {
            objectFromHtmlTable(p.tables[0]);
            return true;
        }
        // rich text -> a text box (sanitize to the inline subset we allow)
        var frag = sanitizeCellHtml(p.html);
        if (frag.replace(/<[^>]*>/g, "").replace(/\s/g, "") === "") return false;
        var th = themeOf();
        addObj("text", { html: frag, fontSize: 24, color: th.text, align: "left" },
            { x: 240, y: 200, w: 480, h: 120 });
        return true;
    }
    function objectFromHtmlTable(rows) {
        var data = rows.map(function (tr) {
            return tr.map(function (cell) { return sanitizeCellHtml(cell.innerHTML); });
        });
        var cols = data[0] ? data[0].length : 1;
        var w = Math.min(880, Math.max(240, cols * 140));
        var h = Math.min(480, Math.max(80, data.length * 34));
        addObj("table", { rows: data, headerRow: false, fontSize: 16 },
            { x: Math.round((SLIDE_W - w) / 2), y: Math.round((SLIDE_H - h) / 2), w: w, h: h });
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
        // Ctrl+C / Ctrl+X in object mode: put the objects on the system
        // clipboard (synchronously - no permission prompt in a user
        // gesture) so the next paste deterministically duplicates them
        function onCopyCutEvent(e, isCut) {
            if (presActive() || editingId || isTypingTarget(e.target) ||
                $(".of-dialog-overlay").length) return;
            if (!sel.length) return;
            copySelection();
            if (e.clipboardData) {
                e.clipboardData.setData("text/plain", objectClipboardText());
                var html = objectsToHtml(clip);
                if (html) e.clipboardData.setData("text/html", html);
                e.preventDefault();
            }
            if (isCut) deleteSelection();
        }
        document.addEventListener("copy", function (e) { onCopyCutEvent(e, false); });
        document.addEventListener("cut", function (e) { onCopyCutEvent(e, true); });
        var area = document.getElementById("slCanvasArea");
        area.addEventListener("dragover", function (e) {
            if (dragSlideIdx >= 0) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
        });
        area.addEventListener("drop", onCanvasDrop);
    }

    /* ================= toolbar ================= */
    /* ================= ribbon ================= */
    /* The ribbon (common/ribbon.js), as PowerPoint lays it out: Home,
       Insert, Draw, Design, Transitions, Animations, Slide Show and View,
       plus Shape Format and Picture Format, which only show while such an
       object is selected. File stays a menu (office.js); the Slideshow
       button sits in the title bar. */
    var FONT_STEPS = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96];
    function textObjs() {
        return selObjs().filter(function (o) { return o.type === "text" || o.type === "shape" || o.type === "table"; });
    }
    function hasShapeSel() {
        return selObjs().some(function (o) { return o.type === "shape" || o.type === "line" || o.type === "text"; });
    }
    function buildToolbar() {
        var R = OfficeRibbon;
        var B = R.button, D = R.dropdown;

        /* ---------- Home ---------- */
        var home = R.tab("home", "Home");
        home.group({ id: "slides", label: "Slides", svg: "newSlide", priority: 3 })
            .add(R.big({
                svg: "newSlide", label: "New slide", key: "Ctrl+M",
                onClick: function () { addSlideAfter(cur); },
                menuTitle: "New slide with layout",
                onOpen: function (el, r) {
                    OfficeApp.closeAllMenus();
                    showLayoutPicker(r.left, r.bottom + 4);
                },
                menu: true
            }))
            .stack([
                B({ icon: "clone outline", label: "Duplicate", showLabel: true, key: "Ctrl+D", onClick: function () { duplicateSlide(cur); } }),
                B({ icon: "trash alternate outline", label: "Delete", showLabel: true, onClick: function () { deleteSlide(cur); } }),
                B({ svg: "background", label: "Background", showLabel: true, onClick: function () { bgDialog(cur); } })
            ]);
        var $font = $('<select class="of-tselect sl-fontsel" id="slFontFamily" title="Font"></select>');
        OfficeFonts.MENU.forEach(function (f) {
            $font.append($("<option></option>").attr("value", f).text(f).css("font-family", OfficeFonts.stack(f)));
        });
        $font.on("change", function () { applyFontFamily($font.val()); });
        var $fs = $('<input type="number" class="of-tinput sl-num" id="slFontSize" min="6" max="400" step="1" title="Font size" value="24">');
        $fs.on("change", function () {
            var v = clamp(parseFloat($fs.val()) || 24, 6, 400);
            $fs.val(v);
            applyFontSizeAll(v);
        });
        var font = home.group({ id: "font", label: "Font", icon: "font", priority: 9 });
        font.row([$font, $fs,
            B({ svg: "growFont", title: "Increase font size", key: "Ctrl+]", onClick: function () { stepFontSize(1); } }),
            B({ svg: "shrinkFont", title: "Decrease font size", key: "Ctrl+[", onClick: function () { stepFontSize(-1); } }),
            B({ svg: "clearFormat", title: "Clear formatting", onClick: clearTextFormatting }),
            B({
                svg: "formatPainter", title: "Format painter - click, then click the object to format (double-click to keep it on)", id: "slPainter",
                active: function () { return !!painter; },
                onClick: function () { startPainter(false); }
            }).on("dblclick", function () { startPainter(true); })
        ]);
        var fmt = function (icon, title, key, prop, cmd, id, svg) {
            return B({
                icon: svg ? null : icon, svg: svg, title: title, key: key, id: id,
                onClick: function () {
                    if (prop) toggleTextProp(prop, cmd);
                    else inlineCommand(cmd);
                }
            });
        };
        font.row([
            fmt("bold", "Bold", "Ctrl+B", "bold", "bold", "slBtnBold"),
            fmt("italic", "Italic", "Ctrl+I", "italic", "italic", "slBtnItalic"),
            fmt("underline", "Underline", "Ctrl+U", "underline", "underline", "slBtnUnderline"),
            fmt("strikethrough", "Strikethrough", null, null, "strikeThrough", "slBtnStrike"),
            fmt(null, "Superscript", null, null, "superscript", "slBtnSup", "superscript"),
            fmt(null, "Subscript", null, null, "subscript", "slBtnSub", "subscript"),
            "|",
            R.colorButton({ id: "slTextColor", svg: "fontColor", title: "Font color", value: "#d0342c", onPick: applyTextColor })
        ]);

        var para = home.group({ id: "paragraph", label: "Paragraph", icon: "paragraph", priority: 7 });
        para.row([
            B({ icon: "list ul", title: "Bulleted list", key: "Ctrl+Shift+8", id: "slBtnUL", onClick: function () { toggleList("insertUnorderedList"); } }),
            B({ icon: "list ol", title: "Numbered list", key: "Ctrl+Shift+7", id: "slBtnOL", onClick: function () { toggleList("insertOrderedList"); } }),
            "|",
            D({ svg: "lineSpacing", title: "Line spacing", menu: lineSpacingItems }),
            D({ svg: "alignMiddle", title: "Align text vertically", menu: valignItems })
        ]);
        para.row(["left", "center", "right", "justify"].map(function (a) {
            return B({
                icon: "align " + a, title: a === "justify" ? "Justify" : "Align " + a, id: "slAlign_" + a,
                onClick: function () { setTextAlign(a); }
            });
        }));

        home.group({ id: "drawing", label: "Drawing", svg: "shapes", priority: 5 })
            .add(R.big({ svg: "shapes", label: "Shapes", onOpen: openShapePicker, menu: true }))
            .add(R.big({ svg: "arrange", label: "Arrange", menu: arrangeItems }))
            .stack([
                R.colorButton({ id: "slFillColor", svg: "fill", title: "Shape fill", value: "#e07b1f", allowNone: true, noneLabel: "No fill", onPick: applyFill }),
                R.colorButton({ id: "slStrokeColor", svg: "outline", title: "Shape outline", value: "#333333", allowNone: true, noneLabel: "No outline", onPick: applyStroke }),
                D({ svg: "lineWeight", title: "Outline weight and dash", menu: function () {
                    return [
                        { label: "Weight", icon: "minus", sub: weightItems },
                        { label: "Dash", icon: "ellipsis horizontal", sub: dashItems }
                    ];
                } })
            ]);
        home.group({ id: "pane", label: "Format pane", svg: "formatPane", priority: 2 })
            .add(R.big({
                svg: "formatPane", label: "Format pane", title: "Picture format options",
                enabled: function () { return !!selectedImage(); },
                active: function () { return !!(window.SlidesImageTools && SlidesImageTools.panelOpen()); },
                onClick: function () { if (window.SlidesImageTools && selectedImage()) SlidesImageTools.togglePanel(); OfficeRibbon.refresh(); }
            }))
            .add(R.big({ svg: "alignObjects", label: "Align", menu: alignSub, enabled: function () { return sel.length > 0; } }))
            .add(R.big({ svg: "findReplace", label: "Find / Replace", key: "Ctrl+H", onClick: findReplaceDialog }));

        /* ---------- Insert ---------- */
        var ins = R.tab("insert", "Insert");
        ins.group({ id: "slides", label: "Slides", svg: "newSlide" })
            .add(R.big({
                svg: "newSlide", label: "New slide", key: "Ctrl+M", onClick: function () { addSlideAfter(cur); },
                onOpen: function (el, r) { OfficeApp.closeAllMenus(); showLayoutPicker(r.left, r.bottom + 4); }, menu: true
            }));
        ins.group({ id: "tables", label: "Tables", svg: "table" })
            .add(R.big({ svg: "table", label: "Table", onClick: tableDialog }));
        ins.group({ id: "images", label: "Images", svg: "picture" })
            .add(R.big({ svg: "picture", label: "Pictures", menu: imageMenu }))
            .add(R.big({ svg: "drawing", label: "Drawing", onClick: function () { drawingDialog(); } }));
        ins.group({ id: "illustrations", label: "Illustrations", svg: "shapes" })
            .add(R.big({ svg: "shapes", label: "Shapes", onOpen: openShapePicker, menu: true }))
            .add(R.big({ svg: "chart", label: "Chart", onClick: function () { chartDialog(null); } }))
            .stack([
                B({ icon: "minus", label: "Line", showLabel: true, id: "slBtnLine", active: function () { return pendingDraw === "line"; }, onClick: function () { if (pendingDraw === "line") disarmDraw(); else armDraw("line"); } }),
                B({ icon: "long arrow alternate right", label: "Arrow", showLabel: true, id: "slBtnArrow", active: function () { return pendingDraw === "arrow"; }, onClick: function () { if (pendingDraw === "arrow") disarmDraw(); else armDraw("arrow"); } })
            ]);
        ins.group({ id: "text", label: "Text", svg: "textBox" })
            .add(R.big({ svg: "textBox", label: "Text box", onClick: insertText }))
            .add(R.big({ svg: "link", label: "Link", enabled: function () { return sel.length === 1; }, onClick: linkDialog }));
        ins.group({ id: "media", label: "Media", svg: "video" })
            .add(R.big({ svg: "video", label: "Video", menu: function () { return mediaMenu("video"); } }))
            .add(R.big({ svg: "audio", label: "Audio", menu: function () { return mediaMenu("audio"); } }));

        /* ---------- Draw ---------- */
        var draw = R.tab("draw", "Draw");
        draw.group({ id: "tools", label: "Tools", svg: "pen" })
            .add(R.big({ icon: "mouse pointer", label: "Select", active: function () { return !pendingDraw; }, onClick: function () { if (pendingDraw) disarmDraw(); OfficeRibbon.refresh(); } }))
            .add(R.big({ icon: "minus", label: "Line", active: function () { return pendingDraw === "line"; }, onClick: function () { armDraw("line"); OfficeRibbon.refresh(); } }))
            .add(R.big({ icon: "long arrow alternate right", label: "Arrow", active: function () { return pendingDraw === "arrow"; }, onClick: function () { armDraw("arrow"); OfficeRibbon.refresh(); } }))
            .add(R.big({ svg: "shapes", label: "Shapes", onOpen: openShapePicker, menu: true }));
        var pens = draw.group({ id: "pens", label: "Pens", svg: "pen" });
        OfficeSketch.PENS.forEach(function (p) {
            pens.add(R.big({
                iconHtml: OfficeSketch.penIcon(p), label: p.label,
                title: "Draw with the " + p.label.toLowerCase(),
                onClick: function () { drawingDialog(p.id); }
            }));
        });
        draw.group({ id: "canvas", label: "Canvas", svg: "drawing" })
            .add(R.big({ svg: "drawing", label: "Drawing canvas", onClick: function () { drawingDialog(); } }));

        /* ---------- Design ---------- */
        var design = R.tab("design", "Design");
        design.group({ id: "themes", label: "Themes", svg: "theme", priority: 5 })
            .add(R.gallery({
                id: "slThemes", cls: "sl-themes", tileW: 96, visible: 6, moreTitle: "All themes",
                items: Object.keys(THEMES).map(function (k) {
                    var t = THEMES[k];
                    return {
                        key: k, label: t.label,
                        build: function ($t) {
                            var $p = $('<span class="sl-themeprev"></span>').css({ background: t.bg, color: t.text });
                            $p.append('<span class="sl-themeprev-aa">Aa</span>')
                                .append($('<span class="sl-themeprev-bar"></span>').css("background", t.accent));
                            $t.append($p).append($('<span class="sl-themeprev-name"></span>').text(t.label));
                        },
                        active: function () { return body.theme === k; },
                        onClick: function () { setTheme(k); }
                    };
                }),
                extra: [{ label: "Browse themes...", icon: "paint brush", action: themeDialog }]
            }));
        design.group({ id: "customize", label: "Customize", svg: "background" })
            .add(R.big({ svg: "background", label: "Background", title: "Format the slide background", onClick: function () { bgDialog(cur); } }))
            .add(R.big({ svg: "theme", label: "Browse themes", onClick: themeDialog }));

        /* ---------- Transitions ---------- */
        var tr = R.tab("transitions", "Transitions");
        tr.group({ id: "transition", label: "Transition to this slide", svg: "transition", priority: 5 })
            .add(R.gallery({
                id: "slTransitions", cls: "sl-effects", tileW: 74, visible: 6,
                items: TRANSITIONS.map(function (t) {
                    return {
                        key: t.key, label: t.label,
                        html: effectIcon("tr-" + t.key) + '<span class="sl-effect-name">' + esc(t.label) + "</span>",
                        active: function () { return (curSlide().transition || "none") === t.key; },
                        onClick: function () { curSlide().transition = t.key; commit(); }
                    };
                })
            }));
        tr.group({ id: "timing", label: "Timing", svg: "transition" })
            .add(R.big({
                svg: "transition", label: "Apply to all",
                onClick: function () {
                    var t = curSlide().transition || "none";
                    body.slides.forEach(function (s) { s.transition = t; });
                    commit();
                    OfficeApp.setStatus("Transition applied to every slide");
                }
            }))
            .add(R.big({ svg: "present", label: "Preview", title: "Play this slide from here", onClick: function () { startPresent(cur); } }));

        /* ---------- Animations ---------- */
        var an = R.tab("animations", "Animations");
        an.group({ id: "animation", label: "Animation", svg: "animation", priority: 5 })
            .add(R.gallery({
                id: "slAnims", cls: "sl-effects", tileW: 74, visible: 6,
                items: ANIMS.map(function (a) {
                    return {
                        key: a.key, label: a.label,
                        html: effectIcon("an-" + (a.key || "none")) + '<span class="sl-effect-name">' + esc(a.label) + "</span>",
                        active: function () {
                            var so = selObjs();
                            return so.length > 0 && (so[0].props.anim || "") === a.key;
                        },
                        onClick: function () {
                            if (!sel.length) { OfficeApp.setStatus("Select an object to animate first", "info", 3000); return; }
                            setAnimation(a.key);
                        }
                    };
                })
            }));
        an.group({ id: "interaction", label: "Interaction", svg: "link" })
            .add(R.big({ svg: "link", label: "Click link", title: "Link the object to a slide or a web page", enabled: function () { return sel.length === 1; }, onClick: linkDialog }))
            .add(R.big({ svg: "present", label: "Preview", onClick: function () { startPresent(cur); } }));

        /* ---------- Slide Show ---------- */
        var show = R.tab("slideshow", "Slide Show");
        show.group({ id: "start", label: "Start Slide Show", svg: "present" })
            .add(R.big({ svg: "fromStart", label: "From beginning", key: "Shift+F5", onClick: function () { startPresent(0); } }))
            .add(R.big({ svg: "present", label: "From current slide", key: "F5", onClick: function () { startPresent(cur); } }))
            .add(R.big({ svg: "presenter", label: "Presenter view", onClick: function () { startPresent(cur, { presenter: true }); } }));
        show.group({ id: "setup", label: "Set Up", svg: "notes" })
            .add(R.big({ svg: "notes", label: "Speaker notes", active: notesShown, onClick: function () { toggleNotes(); OfficeRibbon.refresh(); } }));

        /* ---------- View ---------- */
        var view = R.tab("view", "View");
        view.group({ id: "views", label: "Presentation Views", svg: "normalView" })
            .add(R.big({ svg: "normalView", label: "Normal", active: function () { return !overview; }, onClick: function () { setOverview(false); } }))
            .add(R.big({ svg: "overview", label: "Slide overview", key: "Ctrl+Alt+1", active: function () { return overview; }, onClick: function () { setOverview(true); } }));
        view.group({ id: "show", label: "Show", svg: "notes" })
            .add(R.big({ svg: "notes", label: "Notes", active: notesShown, onClick: function () { toggleNotes(); OfficeRibbon.refresh(); } }))
            .add(R.big({ svg: "snap", label: "Snap to grid", active: function () { return snapGrid; }, onClick: toggleSnap }));
        view.group({ id: "zoom", label: "Zoom", svg: "zoomIn" })
            .add(R.big({ svg: "zoomOut", label: "Zoom out", key: "Ctrl+-", onClick: function () { OfficeApp.zoomOut(); } }))
            .add(R.big({ svg: "zoom100", label: "Fit", title: "Fit the slide to the window", key: "Ctrl+0", onClick: function () { OfficeApp.setZoom(100); } }))
            .add(R.big({ svg: "zoomIn", label: "Zoom in", key: "Ctrl+=", onClick: function () { OfficeApp.zoomIn(); } }));
        view.group({ id: "appearance", label: "Appearance", svg: "darkTheme" })
            .add(R.big({ svg: "darkTheme", label: "Dark theme", active: function () { return OfficeApp.isDark(); }, onClick: function () { OfficeApp.toggleTheme(); OfficeRibbon.refresh(); } }));

        /* ---------- Shape Format (contextual) ---------- */
        var sf = R.tab("shapeformat", "Shape Format", { contextual: true, when: function () { return !overview && strokedObjs().some(function (o) { return o.type !== "image"; }); } });
        sf.group({ id: "styles", label: "Shape Styles", svg: "fill" }).stack([
            R.colorButton({ id: "slFillColor2", svg: "fill", title: "Shape fill", value: "#e07b1f", allowNone: true, noneLabel: "No fill", onPick: applyFill }),
            R.colorButton({ id: "slStrokeColor2", svg: "outline", title: "Shape outline", value: "#333333", allowNone: true, noneLabel: "No outline", onPick: applyStroke })
        ]);
        sf.group({ id: "lines", label: "Lines", svg: "lineWeight" })
            .add(R.big({ svg: "lineWeight", label: "Weight", menu: weightItems }))
            .add(R.big({ svg: "lineDash", label: "Dash", menu: dashItems }))
            .add(R.big({ iconHtml: SlidesLines.toolIcon("start"), label: "Line start", visible: function () { return lineObjs().length > 0; }, menu: function () { return headItems(false); } }))
            .add(R.big({ iconHtml: SlidesLines.toolIcon("end"), label: "Line end", visible: function () { return lineObjs().length > 0; }, menu: function () { return headItems(true); } }));
        arrangeGroup(sf);

        /* ---------- Picture Format (contextual) ---------- */
        var pf = R.tab("pictureformat", "Picture Format", { contextual: true, when: function () { return !overview && !!selectedImage(); } });
        pf.group({ id: "adjust", label: "Adjust", svg: "resetPicture" })
            .add(R.big({
                svg: "crop", label: "Crop", active: function () { return !!cropId; },
                onClick: function () {
                    var io = selectedImage();
                    if (io) { if (cropId === io.id) endCrop(true); else startCrop(io.id); }
                    OfficeRibbon.refresh();
                },
                onOpen: function (el) { if (selectedImage() && window.SlidesImageTools) SlidesImageTools.showShapeMenu(el); },
                menu: true, menuTitle: "Crop to shape"
            }))
            .add(R.big({ svg: "resetPicture", label: "Reset picture", onClick: function () { var io = selectedImage(); if (io) resetImage(io); } }))
            .add(R.big({
                svg: "formatPane", label: "Format pane",
                active: function () { return !!(window.SlidesImageTools && SlidesImageTools.panelOpen()); },
                onClick: function () { if (window.SlidesImageTools) SlidesImageTools.togglePanel(); OfficeRibbon.refresh(); }
            }));
        pf.group({ id: "border", label: "Picture Border", svg: "outline" })
            .add(R.colorButton({ id: "slImgStroke", svg: "outline", title: "Picture border", value: "#333333", allowNone: true, noneLabel: "No border", onPick: applyPictureBorder }))
            .add(R.big({ svg: "lineWeight", label: "Weight", menu: weightItems }))
            .add(R.big({ svg: "lineDash", label: "Dash", menu: dashItems }));
        arrangeGroup(pf);

        /* ---------- the title bar: Slideshow ---------- */
        var $present = $('<button type="button" class="sl-present-btn" title="Start the slide show (F5)">' +
            '<i class="play icon"></i><span>Slideshow</span></button>');
        var $presentMore = $('<button type="button" class="sl-present-more" title="More ways to present"><i class="caret down icon"></i></button>');
        $present.on("click", function () { startPresent(cur); });
        $presentMore.on("click", function (e) {
            var r = e.currentTarget.getBoundingClientRect();
            OfficeApp.showContextMenu(r.right - 240, r.bottom + 4, [
                { label: "Present from current slide", icon: "play", key: "F5", action: function () { startPresent(cur); } },
                { label: "Present from beginning", icon: "play circle outline", key: "Shift+F5", action: function () { startPresent(0); } },
                { label: "Present with presenter view", icon: "desktop", action: function () { startPresent(cur, { presenter: true }); } }
            ]);
        });
        OfficeApp.titleBarSlot().append($('<span class="sl-present-split"></span>').append($present).append($presentMore));

        /* ---------- the status bar: Normal / Overview ---------- */
        OfficeApp.addStatusItem("views",
            '<span class="sl-viewbtns"><button type="button" class="sl-viewbtn" data-view="normal" title="Normal">' +
            OfficeIcons.get("normalView") + '</button><button type="button" class="sl-viewbtn" data-view="overview" title="Slide overview (Ctrl+Alt+1)">' +
            OfficeIcons.get("overview") + "</button></span>");
        $(document).on("click", ".sl-viewbtn", function () { setOverview($(this).attr("data-view") === "overview"); });
        syncViewButtons();
    }
    function arrangeGroup(tab) {
        var R = OfficeRibbon;
        tab.group({ id: "arrange", label: "Arrange", svg: "arrange" })
            .add(R.big({ svg: "bringFront", label: "Bring forward", onClick: function () { reorderSelection("forward"); }, menu: orderSub }))
            .add(R.big({ svg: "sendBack", label: "Send backward", onClick: function () { reorderSelection("backward"); }, menu: orderSub }))
            .add(R.big({ svg: "alignObjects", label: "Align", menu: alignSub }))
            .add(R.big({ svg: "group", label: "Group", menu: arrangeGroupItems }));
    }
    function arrangeGroupItems() {
        return [
            { label: "Group", icon: "object group outline", key: "Ctrl+G", enabled: function () { return sel.length >= 2; }, action: groupSelection },
            { label: "Ungroup", key: "Ctrl+Shift+G", enabled: selectionHasGroup, action: ungroupSelection }
        ];
    }
    function arrangeItems() {
        var items = [{ label: "Order", icon: "bars", sub: orderSub }, { label: "Align", icon: "align center", sub: alignSub }, { sep: true }];
        return items.concat(arrangeGroupItems()).concat([
            { sep: true },
            { label: "Duplicate", icon: "clone outline", key: "Ctrl+D", enabled: function () { return sel.length > 0; }, action: duplicateSelection },
            { label: "Delete", icon: "trash alternate outline", key: "Del", enabled: function () { return sel.length > 0; }, action: deleteSelection }
        ]);
    }
    function imageMenu() {
        return [
            storageSourceItem(imageFromStorage),
            { label: "From this device...", icon: "upload", action: imageFromDevice },
            { label: "From URL...", icon: "linkify", action: imageFromUrl }
        ].filter(Boolean);
    }
    function mediaMenu(kind) {
        return [
            storageSourceItem(function () { mediaFromStorage(kind); }),
            { label: "From this device...", icon: "upload", action: function () { mediaFromDevice(kind); } }
        ].filter(Boolean);
    }
    function openShapePicker(el, r) {
        OfficeApp.closeAllMenus();
        showShapePicker(r.left, r.bottom + 4);
    }
    function notesShown() { return !$("#slNotes").hasClass("collapsed"); }
    function toggleSnap() {
        snapGrid = !snapGrid;
        OfficeApp.setSetting("snapGrid", snapGrid);
        OfficeRibbon.refresh();
    }
    // the small pictures on the Transitions and Animations galleries
    function effectIcon(kind) {
        var a = '<rect x="3" y="5" width="18" height="14" rx="1.5"/>';
        var body = {
            "tr-none": a,
            "tr-fade": '<rect x="3" y="5" width="18" height="14" rx="1.5" opacity=".35"/><rect class="accs" x="6" y="8" width="12" height="8" rx="1"/>',
            "tr-slide": '<rect x="2" y="5" width="12" height="14" rx="1.5" opacity=".4"/><rect class="accs" x="10" y="5" width="12" height="14" rx="1.5"/><path d="M13 12h5M16 10l2 2-2 2"/>',
            "tr-zoom": '<rect x="2" y="4" width="20" height="16" rx="1.5" opacity=".35"/><rect class="accs" x="7" y="8" width="10" height="8" rx="1"/><path d="M4 6l3 2M20 6l-3 2M4 18l3-2M20 18l-3-2"/>',
            "an-none": '<circle cx="12" cy="12" r="7" opacity=".5"/><path d="M7 17 17 7"/>',
            "an-fade": '<path class="acc" d="M12 4l2 4.5 5 .6-3.7 3.4 1 4.9L12 15l-4.3 2.4 1-4.9L5 9.1l5-.6z" opacity=".55"/>',
            "an-slide": '<path class="acc" d="M15 5l1.6 3.6 3.9.4-2.9 2.6.8 3.9-3.4-2-3.4 2 .8-3.9-2.9-2.6 3.9-.4z"/><path d="M2 9h5M3 13h5M2 17h6"/>',
            "an-zoom": '<path class="acc" d="M12 7l1.2 2.7 2.9.3-2.2 2 .6 2.9-2.5-1.5-2.5 1.5.6-2.9-2.2-2 2.9-.3z"/><path d="M4 4l3 3M20 4l-3 3M4 20l3-3M20 20l-3-3"/>'
        }[kind] || a;
        return '<svg class="of-ic sl-effect-ic" viewBox="0 0 24 24" aria-hidden="true">' + body + "</svg>";
    }

    /* ---------- Home: text formatting ----------
       With a text box being edited the commands act on the selected text
       (execCommand, or the floating text bar's font code); otherwise on
       every selected object as a whole. */
    function applyFontFamily(name) {
        if (editingId && window.OfficeTextEditBar && OfficeTextEditBar.hasTextSelection && OfficeTextEditBar.hasTextSelection()) {
            OfficeTextEditBar.applyFontFamily(name);
            syncEditingIntoModel();
            OfficeApp.markDirty();
            return;
        }
        applyToSel(function (o) {
            if (o.type !== "text" && o.type !== "shape" && o.type !== "table") return false;
            o.props.fontFamily = name;
            return true;
        });
    }
    function applyFontSizeAll(v) {
        if (editingId && window.OfficeTextEditBar && OfficeTextEditBar.hasTextSelection && OfficeTextEditBar.hasTextSelection()) {
            OfficeTextEditBar.applyFontSizePx(v);
            syncEditingIntoModel();
            OfficeApp.markDirty();
            return;
        }
        applyToSel(function (o) {
            if (o.type === "text" || o.type === "shape" || o.type === "table") {
                o.props.fontSize = v;
                return true;
            }
            return false;
        });
    }
    function stepFontSize(dir) {
        var so = textObjs();
        if (!so.length) return;
        var curSize = Number(so[0].props.fontSize) || (so[0].type === "table" ? 16 : 24);
        var next = curSize;
        var i;
        if (dir > 0) {
            next = curSize + 8;
            for (i = 0; i < FONT_STEPS.length; i++) if (FONT_STEPS[i] > curSize) { next = FONT_STEPS[i]; break; }
        } else {
            next = Math.max(6, curSize - 1);
            for (i = FONT_STEPS.length - 1; i >= 0; i--) if (FONT_STEPS[i] < curSize) { next = FONT_STEPS[i]; break; }
        }
        // editing: the selected text grows; otherwise the whole object
        if (editingId) { applyFontSizeAll(next); if (!OfficeTextEditBar.hasTextSelection()) return; }
        applyToSel(function (o) {
            if (o.type !== "text" && o.type !== "shape" && o.type !== "table") return false;
            var s = Number(o.props.fontSize) || (o.type === "table" ? 16 : 24);
            o.props.fontSize = dir > 0 ? Math.max(next, s) : Math.min(next, s);
            if (s === curSize) o.props.fontSize = next;
            return true;
        });
        $("#slFontSize").val(next);
    }
    function toggleTextProp(prop, cmd) {
        if (editingId) {
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
    }
    /* strike, superscript and subscript live on the text runs: on a whole
       text box they are applied as an edit over all of its text */
    function inlineCommand(cmd) {
        if (editingId) {
            try { document.execCommand(cmd); } catch (e) { }
            return;
        }
        var ids = selObjs().filter(function (o) { return o.type === "text"; }).map(function (o) { return o.id; });
        if (!ids.length) {
            OfficeApp.setStatus("Select a text box, or some text in one", "info", 3000);
            return;
        }
        var keep = sel.slice();
        ids.forEach(function (id) {
            startEdit(id);
            try { document.execCommand(cmd); } catch (e) { }
            endEdit(true);
        });
        setSel(keep);
    }
    function clearTextFormatting() {
        if (editingId) {
            try { document.execCommand("removeFormat"); } catch (e) { }
            return;
        }
        var th = themeOf();
        applyToSel(function (o) {
            if (o.type !== "text" && o.type !== "shape") return false;
            delete o.props.bold;
            delete o.props.italic;
            delete o.props.underline;
            delete o.props.fontFamily;
            if (o.type === "text") {
                o.props.color = th.text;
                if (o.props.html) o.props.html = stripRunFormatting(o.props.html);
            } else {
                delete o.props.textColor;
            }
            return true;
        });
    }
    // drop the run-level styling of stored text, keeping the paragraphs,
    // lists, alignment and links
    function stripRunFormatting(html) {
        var d = document.createElement("div");
        d.innerHTML = html;
        var inl = d.querySelectorAll("b, strong, i, em, u, s, strike, del, sup, sub, font");
        for (var i = inl.length - 1; i >= 0; i--) {
            var el = inl[i];
            while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
            el.parentNode.removeChild(el);
        }
        var spans = d.querySelectorAll("span[style]");
        for (i = 0; i < spans.length; i++) {
            ["font-family", "font-size", "font-weight", "font-style", "color", "background-color",
                "text-decoration", "text-decoration-line", "vertical-align"].forEach(function (k) {
                spans[i].style.removeProperty(k);
            });
            if (!spans[i].getAttribute("style")) spans[i].removeAttribute("style");
        }
        return d.innerHTML;
    }
    function applyTextColor(v) {
        if (!v) return;
        if (editingId) {
            try { document.execCommand("foreColor", false, v); } catch (e) { }
            return;
        }
        applyToSel(function (o) {
            if (o.type === "text" || o.type === "table") { o.props.color = v; return true; }
            if (o.type === "shape") { o.props.textColor = v; return true; }
            return false;
        });
    }
    function setTextAlign(a) {
        applyToSel(function (o) {
            if (o.type === "text" || o.type === "shape") {
                o.props.align = a;
                // the paragraphs of rich text state their own alignment
                if (o.props.html) {
                    var d = document.createElement("div");
                    d.innerHTML = o.props.html;
                    var blocks = d.querySelectorAll("div, p, li");
                    for (var i = 0; i < blocks.length; i++) blocks[i].style.removeProperty("text-align");
                    o.props.html = d.innerHTML;
                }
                return true;
            }
            return false;
        });
    }
    var LINE_SPACINGS = [1, 1.15, 1.3, 1.5, 2, 2.5];
    function lineSpacingItems() {
        var so = textObjs();
        var cur0 = so.length ? (Number(so[0].props.lineHeight) || 0) : 0;
        return LINE_SPACINGS.map(function (v) {
            return {
                label: String(v), checked: Math.abs(cur0 - v) < 0.01,
                action: function () {
                    applyToSel(function (o) {
                        if (o.type !== "text" && o.type !== "shape") return false;
                        o.props.lineHeight = v;
                        return true;
                    });
                }
            };
        });
    }
    function valignItems() {
        var so = textObjs();
        var curV = so.length ? (so[0].props.valign || "top") : "";
        return [["top", "Top", "alignTop"], ["middle", "Middle", "alignMiddle"], ["bottom", "Bottom", "alignBottom"]].map(function (v) {
            return {
                label: v[1], checked: curV === v[0],
                action: function () {
                    applyToSel(function (o) {
                        if (o.type !== "text" && o.type !== "shape") return false;
                        o.props.valign = v[0];
                        return true;
                    });
                }
            };
        });
    }

    /* ---------- Home: drawing colours ---------- */
    function applyFill(v) {
        applyToSel(function (o) {
            if (o.type !== "shape") return false;
            o.props.fill = v || "none";
            return true;
        });
        OfficeRibbon.setColor("#slFillColor", v);
        OfficeRibbon.setColor("#slFillColor2", v);
    }
    function applyStroke(v) {
        applyToSel(function (o) {
            if (o.type === "shape" || o.type === "line") { o.props.stroke = v || "none"; return true; }
            return false;
        });
        OfficeRibbon.setColor("#slStrokeColor", v);
        OfficeRibbon.setColor("#slStrokeColor2", v);
    }
    function applyPictureBorder(v) {
        applyToSel(function (o) {
            if (o.type !== "image") return false;
            o.props.stroke = v || "none";
            if (v && !(Number(o.props.strokeW) > 0)) o.props.strokeW = 2;
            if (!v) o.props.strokeW = 0;
            return true;
        });
    }

    /* ---------- Home: format painter ----------
       Copies the look of the selected object - its text style, fill and
       outline - onto the next object clicked. Double-click keeps it on. */
    var PAINT_KEYS = {
        text: ["fontSize", "color", "bold", "italic", "underline", "fontFamily", "align", "lineHeight", "valign"],
        shape: ["fill", "stroke", "strokeW", "dashStyle", "dash", "textColor", "fontSize", "bold", "italic", "underline", "fontFamily", "align", "valign"],
        line: ["stroke", "strokeW", "dashStyle", "dash", "startHead", "endHead", "arrowEnd", "arrowStart"],
        image: ["stroke", "strokeW", "radius", "opacity", "recolor", "bright", "contrast"],
        table: ["fontSize", "color", "fontFamily"]
    };
    var painter = null;
    function startPainter(sticky) {
        if (painter && !sticky) { stopPainter(); return; }
        var so = selObjs();
        if (so.length !== 1) {
            OfficeApp.setStatus("Select the object whose format to copy", "info", 3000);
            return;
        }
        var src = so[0];
        var props = {};
        (PAINT_KEYS[src.type] || []).forEach(function (k) { if (src.props[k] !== undefined) props[k] = deep(src.props[k]); });
        painter = { fromId: src.id, type: src.type, props: props, sticky: !!sticky };
        canvasEl.classList.add("sl-painting");
        OfficeApp.setStatus(sticky ? "Format painter on - click objects to format, Esc to stop" :
            "Click the object to format", "info", 4000);
        OfficeRibbon.refresh();
    }
    function stopPainter() {
        painter = null;
        if (canvasEl) canvasEl.classList.remove("sl-painting");
        OfficeRibbon.refresh();
    }
    function applyPainterToSel() {
        if (!painter) return;
        var targets = selObjs().filter(function (o) { return o.id !== painter.fromId; });
        if (!targets.length) return;
        var p = painter;
        targets.forEach(function (o) {
            (PAINT_KEYS[o.type] || []).forEach(function (k) {
                // text style crosses between text boxes and shape labels
                var srcKey = k;
                if (o.type === "shape" && k === "textColor" && p.type === "text") srcKey = "color";
                if (o.type === "text" && k === "color" && p.type === "shape") srcKey = "textColor";
                if (p.props[srcKey] !== undefined) o.props[k] = deep(p.props[srcKey]);
            });
        });
        commit();
        if (!p.sticky) stopPainter();
    }

    /* ---------- Insert / Draw: drawings ---------- */
    function drawingDialog(penId) {
        endEdit(true);
        OfficeSketch.open({
            title: "Drawing", pen: penId, aspect: SLIDE_H / SLIDE_W,
            onInsert: function (blob, w, h) {
                OfficeApp.blobToSrc(blob, "drawing.png", function (src) {
                    // drawn on a slide-shaped canvas: keep its place and size
                    // relative to the slide it was drawn for
                    var sc = Math.min(1, (SLIDE_W - 40) / w, (SLIDE_H - 40) / h);
                    var pw = Math.max(8, Math.round(w * sc)), ph = Math.max(8, Math.round(h * sc));
                    addObj("image", { src: src, fit: "contain" },
                        { x: Math.round((SLIDE_W - pw) / 2), y: Math.round((SLIDE_H - ph) / 2), w: pw, h: ph });
                }, function (msg) { OfficeApp.toast(msg, "error"); });
            }
        });
    }

    /* ---------- Home: find and replace ----------
       Searches the text of every text box, shape label and table cell, in
       slide order from the current slide, and replaces in the text nodes
       only, so formatting runs stay as they are. */
    function textHolders(o) {
        // [{get, set}] for each piece of HTML the object carries
        var out = [];
        if (o.type === "text") {
            out.push({ get: function () { return o.props.html || ""; }, set: function (h) { o.props.html = h; } });
        } else if (o.type === "shape") {
            if (o.props.html) out.push({ get: function () { return o.props.html; }, set: function (h) { o.props.html = h; } });
            else out.push({ get: function () { return esc(o.props.text || ""); }, set: function (h) {
                var d = document.createElement("div");
                d.innerHTML = h;
                o.props.text = d.textContent;
            } });
        } else if (o.type === "table") {
            (o.props.rows || []).forEach(function (row, r) {
                row.forEach(function (cell, c) {
                    out.push({ get: function () { return o.props.rows[r][c] || ""; }, set: function (h) { o.props.rows[r][c] = h; } });
                });
            });
        }
        return out;
    }
    function plainOf(html) {
        var d = document.createElement("div");
        d.innerHTML = html;
        return d.textContent || "";
    }
    function replaceInHtml(html, needle, repl, all, matchCase) {
        var d = document.createElement("div");
        d.innerHTML = html;
        var count = 0;
        var flags = matchCase ? "g" : "gi";
        var rx = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
        var walker = document.createTreeWalker(d, NodeFilter.SHOW_TEXT, null);
        var nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (var i = 0; i < nodes.length; i++) {
            var t = nodes[i].nodeValue;
            var changed = t.replace(rx, function (m) {
                if (!all && count > 0) return m;
                count++;
                return repl;
            });
            if (changed !== t) nodes[i].nodeValue = changed;
            if (!all && count > 0) break;
        }
        return { html: d.innerHTML, count: count };
    }
    var findPos = { s: 0, o: -1 };
    function findReplaceDialog() {
        endEdit(true);
        var $b = $('<div class="sl-findrep"></div>');
        $b.append("<label>Find what</label>");
        var $f = $('<input type="text" class="fr-find">');
        $b.append($f);
        $b.append("<label>Replace with</label>");
        var $r = $('<input type="text" class="fr-repl">');
        $b.append($r);
        var $mc = $('<label class="ps-check"><input type="checkbox" class="fr-case"> Match case</label>');
        $b.append($mc);
        var $msg = $('<div class="of-dim fr-msg">&nbsp;</div>');
        $b.append($msg);
        var matches = function (o, needle, mc) {
            return textHolders(o).some(function (h) {
                var t = plainOf(h.get());
                return mc ? t.indexOf(needle) >= 0 : t.toLowerCase().indexOf(needle.toLowerCase()) >= 0;
            });
        };
        var findNext = function () {
            var needle = $f.val();
            if (!needle) return null;
            var mc = $b.find(".fr-case").prop("checked");
            var n = body.slides.length;
            var startS = findPos.s < n ? findPos.s : cur;
            for (var step = 0; step <= n; step++) {
                var si = (startS + step) % n;
                var objs = body.slides[si].objects;
                var from = (step === 0) ? findPos.o + 1 : 0;
                for (var oi = from; oi < objs.length; oi++) {
                    if (matches(objs[oi], needle, mc)) {
                        findPos = { s: si, o: oi };
                        if (si !== cur) selectSlide(si);
                        setSel([objs[oi].id]);
                        $msg.text("Found on slide " + (si + 1));
                        return objs[oi];
                    }
                }
            }
            findPos = { s: cur, o: -1 };
            $msg.text("No matches");
            return null;
        };
        var replaceIn = function (o, all) {
            var needle = $f.val(), mc = $b.find(".fr-case").prop("checked");
            var total = 0;
            textHolders(o).forEach(function (h) {
                if (!all && total > 0) return;
                var res = replaceInHtml(h.get(), needle, $r.val(), all, mc);
                if (res.count) { h.set(res.html); total += res.count; }
            });
            return total;
        };
        findPos = { s: cur, o: -1 };
        OfficeApp.dialog({
            title: "Find and replace",
            body: $b,
            buttons: [
                { label: "Close" },
                {
                    label: "Replace all", action: function () {
                        var needle = $f.val();
                        if (!needle) return;
                        var total = 0;
                        body.slides.forEach(function (s) {
                            s.objects.forEach(function (o) { total += replaceIn(o, true); });
                        });
                        if (total) { renderAll(); OfficeApp.markDirty(); undo.push(snap()); }
                        $msg.text(total ? "Replaced " + total + " occurrence" + (total === 1 ? "" : "s") : "No matches");
                    }
                },
                {
                    label: "Replace", action: function () {
                        var o = sel.length === 1 ? objById(sel[0]) : null;
                        if (o && $f.val() && matches(o, $f.val(), $b.find(".fr-case").prop("checked"))) {
                            if (replaceIn(o, false)) commit();
                        }
                        findNext();
                    }
                },
                { label: "Find next", primary: true, action: function () { findNext(); } }
            ]
        });
        $f.on("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); findNext(); } });
        setTimeout(function () { $f.focus(); }, 30);
    }

    /* ================= slide overview ================= */
    /* The whole deck as a grid of slides, Google Slides' grid view and
       PowerPoint's Slide Sorter: click selects, double-click (or Enter)
       opens the slide, drag reorders, right-click has the slide menu, and
       Delete / Ctrl+D / Ctrl+M work on the slide in hand. The previews are
       the same renderSlideContent() the rail uses. */
    var overview = false;
    var OV_SIZES = [140, 180, 220, 280, 340, 420];
    function overviewSize() {
        var i = OfficeApp.getSetting("overviewSize", 2);
        return OV_SIZES[clamp(i, 0, OV_SIZES.length - 1)];
    }
    function setOverview(on) {
        on = !!on;
        if (on === overview) { if (on) focusOverview(); return; }
        endCrop(true);
        endEdit(true);
        if (pendingDraw) disarmDraw();
        overview = on;
        document.body.classList.toggle("sl-overview-on", on);
        if (on) {
            setSel([]);
            renderOverview();
            focusOverview();
        } else {
            $("#slOverview").empty();
            renderRail();
            layoutCanvas();
            fitThumbs();
        }
        syncViewButtons();
        OfficeApp.updateMenus();
    }
    function syncViewButtons() {
        $(".sl-viewbtn[data-view=normal]").toggleClass("active", !overview);
        $(".sl-viewbtn[data-view=overview]").toggleClass("active", overview);
    }
    function focusOverview() {
        var $c = $("#slOverview .sl-ov-card").eq(cur);
        if ($c.length) {
            $c[0].focus({ preventScroll: true });
            $c[0].scrollIntoView({ block: "nearest" });
        }
    }
    var ovDrag = -1;
    function renderOverview() {
        var $ov = $("#slOverview");
        if (!$ov.length) return;
        var size = overviewSize();
        var keepScroll = $ov.find(".sl-ov-grid").scrollTop() || 0;
        $ov.empty();
        var $grid = $('<div class="sl-ov-grid"></div>').css("--sl-ov-w", size + "px")
            .css("--sl-ov-scale", size / SLIDE_W);
        body.slides.forEach(function (s, i) {
            var $c = $('<div class="sl-ov-card" tabindex="0" draggable="true"></div>').attr("data-i", i);
            if (i === cur) $c.addClass("active");
            var $v = $('<div class="sl-ov-view"><div class="sl-ov-mini sl-slidebase"></div></div>');
            $c.append($v);
            var $meta = $('<div class="sl-ov-meta"></div>').append('<span class="sl-ov-num">' + (i + 1) + "</span>");
            if (s.transition && s.transition !== "none") {
                $meta.append('<span class="sl-ov-flag" title="Transition: ' + esc(s.transition) + '">' + OfficeIcons.get("transition") + "</span>");
            }
            if (s.notes) $meta.append('<span class="sl-ov-flag" title="Has speaker notes">' + OfficeIcons.get("notes") + "</span>");
            $c.append($meta);
            renderSlideContent($v.find(".sl-ov-mini")[0], s);
            $c.on("click", function () { overviewSelect(i); });
            $c.on("dblclick", function () { cur = i; setOverview(false); selectSlide(i); });
            $c.on("contextmenu", function (e) {
                e.preventDefault();
                overviewSelect(i);
                showSlideContextMenu(e.clientX, e.clientY, i);
            });
            $c.on("dragstart", function (e) {
                ovDrag = i;
                $c.addClass("dragging");
                try {
                    e.originalEvent.dataTransfer.setData("text/plain", String(i));
                    e.originalEvent.dataTransfer.effectAllowed = "move";
                } catch (err) { }
            });
            $c.on("dragover", function (e) {
                if (ovDrag < 0) return;
                e.preventDefault();
                var r = $c[0].getBoundingClientRect();
                var before = (e.originalEvent.clientX - r.left) < r.width / 2;
                $c.toggleClass("drop-before", before).toggleClass("drop-after", !before);
            });
            $c.on("dragleave", function () { $c.removeClass("drop-before drop-after"); });
            $c.on("drop", function (e) {
                e.preventDefault();
                var before = $c.hasClass("drop-before");
                $c.removeClass("drop-before drop-after");
                if (ovDrag < 0 || ovDrag === i) return;
                moveSlideTo(ovDrag, i + (before ? 0 : 1));
            });
            $c.on("dragend", function () {
                ovDrag = -1;
                $("#slOverview .sl-ov-card").removeClass("dragging drop-before drop-after");
            });
            $grid.append($c);
        });
        // a new slide at the end, as the last card
        var $add = $('<button type="button" class="sl-ov-add" title="New slide (Ctrl+M)"><i class="plus icon"></i></button>');
        $add.on("click", function () { addSlideAfter(body.slides.length - 1); });
        $grid.append($add);
        $ov.append($grid);
        $grid.scrollTop(keepScroll);
        // the size control, Google Slides' grid view has it at the bottom
        var $zoom = $('<div class="sl-ov-zoom"></div>');
        var $minus = $('<button type="button" title="Smaller slides"><i class="minus icon"></i></button>');
        var $mid = $('<span class="sl-ov-zoomic" title="Slide size">' + OfficeIcons.get("overview") + "</span>");
        var $plus = $('<button type="button" title="Larger slides"><i class="plus icon"></i></button>');
        var step = function (d) {
            var i = clamp(OfficeApp.getSetting("overviewSize", 2) + d, 0, OV_SIZES.length - 1);
            OfficeApp.setSetting("overviewSize", i);
            renderOverview();
            focusOverview();
        };
        $minus.on("click", function () { step(-1); });
        $plus.on("click", function () { step(1); });
        $zoom.append($minus).append($mid).append($plus);
        $ov.append($zoom);
    }
    function overviewSelect(i) {
        if (i < 0 || i >= body.slides.length) return;
        cur = i;
        $("#slOverview .sl-ov-card").each(function (k) { $(this).toggleClass("active", k === i); });
        var $c = $("#slOverview .sl-ov-card").eq(i);
        if ($c.length && document.activeElement !== $c[0]) {
            $c[0].focus({ preventScroll: true });
        }
        if ($c.length) $c[0].scrollIntoView({ block: "nearest" });
        // the editor behind follows, so leaving the overview lands here
        renderEditorSlide();
        syncNotes();
        updateStatus();
    }
    function overviewColumns() {
        var cards = document.querySelectorAll("#slOverview .sl-ov-card");
        if (cards.length < 2) return 1;
        var top = cards[0].offsetTop, n = 0;
        for (var i = 0; i < cards.length; i++) {
            if (cards[i].offsetTop !== top) break;
            n++;
        }
        return Math.max(1, n);
    }
    function registerOverviewKeys() {
        var HK = OfficeHotkeys;
        var on = function () { return overview && !presActive(); };
        var G = "Slide overview";
        HK.register("Ctrl+]", function () { stepFontSize(1); },
            { id: "sl.grow", description: "Increase font size", group: "Text editing", allowInInput: true, when: function () { return !presActive(); } });
        HK.register("Ctrl+[", function () { stepFontSize(-1); },
            { id: "sl.shrink", description: "Decrease font size", group: "Text editing", allowInInput: true, when: function () { return !presActive(); } });
        HK.register("Ctrl+H", function () { findReplaceDialog(); },
            { id: "sl.findrep", description: "Find and replace", group: "Slides", when: function () { return !presActive(); } });
        HK.register("Escape", function () { stopPainter(); },
            { id: "sl.painteresc", allowInInput: true, when: function () { return !!painter; } });
        HK.register("Ctrl+Alt+1", function () { setOverview(!overview); },
            { id: "sl.overview", description: "Slide overview on / off", group: "Slides", allowInInput: true, when: function () { return !presActive(); } });
        HK.register("Escape", function () { setOverview(false); }, { id: "sl.ov.esc", description: "Back to the slide", group: G, allowInInput: true, when: on });
        HK.register("Enter", function () { var i = cur; setOverview(false); selectSlide(i); }, { id: "sl.ov.enter", description: "Open the slide", group: G, when: on });
        HK.register("Delete", function () { deleteSlide(cur); }, { id: "sl.ov.del", description: "Delete slide", group: G, when: on });
        HK.register("Backspace", function () { deleteSlide(cur); }, { id: "sl.ov.bs", when: on });
        HK.register("Home", function () { overviewSelect(0); }, { id: "sl.ov.home", when: on });
        HK.register("End", function () { overviewSelect(body.slides.length - 1); }, { id: "sl.ov.end", when: on });
        HK.register("Ctrl+A", function () { }, { id: "sl.ov.ctrla", when: on });
        HK.register("Tab", function () { return false; }, { id: "sl.ov.tab", when: on });
        [["ArrowLeft", -1, 0], ["ArrowRight", 1, 0], ["ArrowUp", 0, -1], ["ArrowDown", 0, 1]].forEach(function (k) {
            HK.register(k[0], function () {
                var step = k[1] + k[2] * overviewColumns();
                overviewSelect(clamp(cur + step, 0, body.slides.length - 1));
            }, { id: "sl.ov." + k[0], description: k[0] === "ArrowLeft" ? "Move between slides" : "", group: G, when: on });
        });
    }

    /* ---- line menus (weight, dash, start, end) ---- */
    // what the line menus act on: shapes, lines and picture frames
    function strokedObjs() {
        return selObjs().filter(function (o) {
            return o.type === "shape" || o.type === "line" || o.type === "image";
        });
    }
    function lineObjs() {
        return selObjs().filter(function (o) { return o.type === "line"; });
    }
    // a frame with no colour of its own takes the line colour on the
    // toolbar, or setting its weight would show nothing
    function ensureStroke(o) {
        if (!o.props.stroke || o.props.stroke === "none") {
            o.props.stroke = OfficeRibbon.colorOf("#slStrokeColor") || "#333333";
        }
    }
    function weightItems() {
        var first = strokedObjs()[0];
        return SlidesLines.WEIGHTS.map(function (w) {
            return {
                label: w + "px", html: SlidesLines.weightIcon(w) + '<span class="sl-mi-text">' + w + "px</span>",
                checked: function () { return !!first && (Number(first.props.strokeW) || 0) === w; },
                action: function () {
                    applyToSel(function (o) {
                        if (o.type !== "shape" && o.type !== "line" && o.type !== "image") return false;
                        o.props.strokeW = w;
                        if (o.type !== "line") ensureStroke(o);
                        return true;
                    });
                }
            };
        });
    }
    function dashItems() {
        var first = strokedObjs()[0];
        return SlidesLines.DASHES.map(function (d) {
            return {
                label: d.label, html: SlidesLines.dashIcon(d.id),
                checked: function () {
                    if (!first) return false;
                    var cur = SlidesLines.dashOf(first.props);
                    return cur === d.id || (cur === "legacy" && d.id === "dash");
                },
                action: function () {
                    applyToSel(function (o) {
                        if (o.type !== "shape" && o.type !== "line" && o.type !== "image") return false;
                        SlidesLines.setDash(o.props, d.id);
                        return true;
                    });
                }
            };
        });
    }
    function headItems(end) {
        var first = lineObjs()[0];
        return SlidesLines.HEADS.map(function (h) {
            return {
                label: h.label, html: SlidesLines.headIcon(h.id, end),
                checked: function () { return !!first && SlidesLines.headOf(first.props, end) === h.id; },
                action: function () {
                    applyToSel(function (o) {
                        if (o.type !== "line") return false;
                        SlidesLines.setHead(o.props, end, h.id);
                        return true;
                    });
                }
            };
        });
    }

    // selectedImage returns the lone selected picture, or null
    function selectedImage() {
        var so = selObjs();
        return (so.length === 1 && so[0].type === "image") ? so[0] : null;
    }

    /* The ribbon follows the selection: font and size, the toggles, and
       the contextual Shape / Picture Format tabs (OfficeRibbon.refresh).
       The colour buttons keep the colour last used, as in Office. */
    function syncToolbarFromSel() {
        var so = selObjs();
        var o = so.length ? so[0] : null;
        if (window.SlidesImageTools) SlidesImageTools.sync();
        if (window.OfficeRibbon) OfficeRibbon.refresh();
        var p = o ? o.props : {};
        if (o && (o.type === "text" || o.type === "shape" || o.type === "table")) {
            $("#slFontSize").val(Number(p.fontSize) || (o.type === "table" ? 16 : 24));
            var fam = String(p.fontFamily || "Arial").replace(/['"]/g, "").split(",")[0].trim();
            var $ff = $("#slFontFamily");
            if ($ff.find('option[value="' + fam + '"]').length) $ff.val(fam);
        }
        $("#slBtnBold").toggleClass("active", !!p.bold);
        $("#slBtnItalic").toggleClass("active", !!p.italic);
        $("#slBtnUnderline").toggleClass("active", !!p.underline);
        var al = o && (o.type === "text" || o.type === "shape") ? (p.align || "left") : "";
        ["left", "center", "right", "justify"].forEach(function (a) {
            $("#slAlign_" + a).toggleClass("active", al === a);
        });
    }

    /* ================= notes panel ================= */
    function toggleNotes() {
        var collapsed = $("#slNotes").toggleClass("collapsed").hasClass("collapsed");
        OfficeApp.setSetting("notesCollapsed", collapsed);
        layoutCanvas();
    }
    function initNotes() {
        // a phone starts with the notes folded away (not saved as a choice)
        if (OfficeApp.getSetting("notesCollapsed", false) || OfficeRibbon.isNarrow()) $("#slNotes").addClass("collapsed");
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
    function startPresent(fromIndex, opts) {
        endEdit(true);
        if (window.SlidesPresent) SlidesPresent.start(fromIndex, opts);
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

    /* ================= ODP import / export =================
       The deck's own format, .pptx, is opened and saved by the framework
       (OfficePlatform.documentLoad / documentSave). OpenDocument goes
       through the same Go converters either way: the office AGI library in
       ArozOS, the WebAssembly build of it (src/wasm/office) in the
       standalone web edition. One descriptor names both; OfficePlatform
       picks. */
    var CONVERT_BACKEND = "Office/slides/backend/convert.agi";
    var CONVERT = {
        "import-odf": { agi: CONVERT_BACKEND, action: "import-odf", wasm: "odpToPresentation" },
        "export-odf": { agi: CONVERT_BACKEND, action: "export-odf", wasm: "presentationToOdp" }
    };

    function importOdp(fp, fn) {
        var action = "import-odf";
        OfficeApp.showBusy("Importing " + fn + "...");
        OfficePlatform.convertIn(CONVERT[action], fp, function (data) {
            OfficeApp.hideBusy();
            var b = data;
            if (typeof b === "string") {
                try { b = JSON.parse(b); } catch (e) { b = null; }
            }
            if (!b || !b.slides) {
                OfficeApp.toast("Import failed: unexpected response", "error");
                return;
            }
            OfficeApp.splashStep("Preparing the slides...", function () {
                body = normalizeBody(b);
                cur = 0;
                sel = [];
                editingId = null;
                renderAll();
                undo.init(snap());
                // the framework kept us attached to the source file, so Save
                // writes straight back to it in its own format
                OfficeApp.setStatus("Opened " + fn);
                OfficeApp.documentLoaded();
            });
        }, function (msg) {
            OfficeApp.hideBusy();
            OfficeApp.toast("Import failed: " + msg, "error");
        });
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


    /* Capture a poster frame of a video source as a PNG data URL - used as
       the embedded media poster in pptx exports and the placeholder image
       in pdf exports. Resolves null when the frame cannot be captured
       (unsupported codec etc.); exports fall back to a generic poster. */
    function captureVideoFrame(src) {
        return new Promise(function (resolve) {
            var v = document.createElement("video");
            var done = false;
            var timer = null;
            function finish(result) {
                if (done) return;
                done = true;
                if (timer) clearTimeout(timer);
                v.removeAttribute("src");
                try { v.load(); } catch (e) { /* detach only */ }
                resolve(result);
            }
            timer = setTimeout(function () { finish(null); }, 8000);
            v.muted = true;
            v.preload = "auto";
            v.addEventListener("error", function () { finish(null); });
            v.addEventListener("loadeddata", function () {
                // seek slightly in so black lead-in frames are skipped
                try { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); } catch (e) { finish(null); }
            });
            v.addEventListener("seeked", function () {
                try {
                    var c = document.createElement("canvas");
                    c.width = v.videoWidth || 480;
                    c.height = v.videoHeight || 270;
                    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
                    finish(c.toDataURL("image/png"));
                } catch (e) { finish(null); }
            });
            v.src = src;
        });
    }

    /* Deep-clone the body and inline every image / chart as a dataURL so the
       server-side exporter can embed them into the .pptx. */
    /* What the .pptx needs that only the browser can make: every chart as a
       PNG (the writer draws charts as pictures) and a poster frame for every
       video. Both are kept for the session by what they were made from, and
       in ArozOS uploaded once (OfficePlatform.cacheBlob) - an unchanged chart
       costs nothing on the next save, which is what lets a deck autosave.
       Pictures are left alone: a storage picture stays a media?file= link,
       and the server reads it. */
    var renderCache = {};   // key -> Promise(src | null)
    function dataUrlToBlob(durl) {
        var comma = durl.indexOf(",");
        var mime = (/^data:([^;,]+)/.exec(durl) || [])[1] || "image/png";
        var bin = atob(durl.substring(comma + 1));
        var arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: mime });
    }
    function cachedRender(key, make) {
        if (!renderCache[key]) {
            renderCache[key] = make().then(function (durl) {
                if (!durl) return null;
                return new Promise(function (resolve) {
                    OfficePlatform.cacheBlob(dataUrlToBlob(durl), "render.png",
                        resolve, function () { resolve(durl); });
                });
            });
            // a failed render is tried again next time
            renderCache[key].then(function (src) { if (!src) delete renderCache[key]; });
        }
        return renderCache[key];
    }
    // b is the framework's private copy of the body
    function prepareNative(b) {
        var jobs = [];
        b.slides.forEach(function (s) {
            s.objects.forEach(function (o) {
                if (o.type === "chart") {
                    var spec = o.props.spec || {};
                    jobs.push(cachedRender("chart|" + JSON.stringify(spec) + "|" + Math.round(o.w) + "x" + Math.round(o.h),
                        function () { return rasterizeChartToPng(spec, o.w, o.h); }).then(function (png) {
                        if (png) o.props.png = png;
                    }));
                } else if (o.type === "video" && o.props.src) {
                    // the media file itself keeps its media?file= link - the
                    // server reads the bytes, so they never ride this payload
                    var src = o.props.src;
                    jobs.push(cachedRender("video|" + src, function () { return captureVideoFrame(src); })
                        .then(function (png) { if (png) o.props.png = png; }));
                }
                // audio keeps its link untouched (no frame to capture)
            });
        });
        return Promise.all(jobs);
    }
    function preparedCopy() {
        var b = deep(body);
        return prepareNative(b).then(function () { return b; });
    }

    function exportOdp() {
        if (!OfficePlatform.requireConvert("Exporting .odp")) return;
        endEdit(true);
        var defName = OfficeApp.stripExt(OfficeApp.getFileName() || "New Presentation.pptx") + ".odp";
        OfficePlatform.pickSave({ defaultName: defName, ext: ".odp", memoryKey: "export" }, function (file) {
            var fp = file.filepath;
            OfficeApp.showBusy("Exporting OpenDocument file...");
            preparedCopy().then(function (prepared) {
                // pictures stay links: the server reads them (office lib), and
                // the web edition keeps them inline already
                OfficePlatform.convertOut(CONVERT["export-odf"], fp, JSON.stringify(prepared), function () {
                    OfficeApp.hideBusy();
                    OfficeApp.setStatus("Exported " + OfficeApp.basename(fp));
                    OfficeApp.toast("Exported " + OfficeApp.basename(fp));
                }, function (errmsg) {
                    OfficeApp.hideBusy();
                    OfficeApp.toast("Export failed: " + errmsg, "error");
                });
            }).catch(function (err) {
                OfficeApp.hideBusy();
                OfficeApp.toast("Export failed: " + (err && err.message ? err.message : "prepare error"), "error");
            });
        });
    }
    /* PDF is built in the browser (slides_pdf.js), not on the server: only
       the browser knows which font it actually resolved and where every
       line wrapped, and that is exactly what the export has to reproduce.
       Each element goes in as the real PDF object it should be - text as
       text, pictures as embedded images with real clip paths, shapes and
       charts as vectors - and only an element the format genuinely cannot
       express falls back to a raster of itself. */
    function canExportPdf() {
        return typeof PDFLib !== "undefined" && !!window.SlidesPdf;
    }
    function exportPdf() {
        if (!canExportPdf()) {
            OfficeApp.toast("The PDF library failed to load", "error");
            return;
        }
        endEdit(true);
        endCrop(true);
        var defName = OfficeApp.stripExt(OfficeApp.getFileName() || "New Presentation.pptx") + ".pdf";
        OfficePlatform.pickSave({ defaultName: defName, ext: ".pdf", memoryKey: "export" }, function (file) {
            var fp = file.filepath;
            // rendering a deck takes a moment, and there is no reason for
            // the editor to be unusable while it happens - savePdfTo works
            // from a snapshot, so editing on does not change what comes out
            var prog = OfficeApp.showProgress({
                title: "Exporting PDF", anchor: "#slCanvasArea"
            });
            prog.set(0, 1, "Preparing...");
            savePdfTo(fp, function () {
                prog.close();
                OfficeApp.setStatus("Exported " + OfficeApp.basename(fp));
                OfficeApp.toast("Exported " + OfficeApp.basename(fp));
            }, function (msg) {
                prog.close();
                OfficeApp.toast("Export failed: " + msg, "error");
            }, prog);
        });
    }

    /* savePdfTo renders the deck and writes the bytes; shared by File >
       Export and by the .pdf entry in SAVE_FORMATS. prog is optional - a
       progress panel to report pages through.

       The deck is copied before rendering. The export runs without blocking
       the editor, so the document underneath can change while it is going;
       taking a snapshot is what makes the file that lands on disk the deck
       as it was when the export was asked for. */
    function savePdfTo(fp, done, fail, prog) {
        if (!canExportPdf()) { fail("the PDF library failed to load"); return; }
        endEdit(true);
        endCrop(true);
        var snapshot;
        try {
            snapshot = JSON.parse(JSON.stringify(body));
        } catch (e) {
            fail("the presentation could not be read");
            return;
        }
        SlidesPdf.build(snapshot, {
            title: OfficeApp.stripExt(OfficeApp.getFileName() || "Presentation"),
            onProgress: function (n, total, stage) {
                // measuring the slides is the first half, writing the file
                // (in a worker) the second
                var f = total > 0 ? n / total : 0;
                var pct, msg;
                if (stage === "save") {
                    pct = 97;
                    msg = "Writing the file...";
                } else if (stage === "page") {
                    pct = 50 + 45 * f;
                    msg = "Writing " + n + " / " + total + (total === 1 ? " page" : " pages");
                } else {
                    pct = 50 * f;
                    msg = "Exporting " + n + " / " + total + (total === 1 ? " page" : " pages");
                }
                if (prog) prog.set(pct, 100, msg);
                else OfficeApp.setStatus("Exporting PDF... " + msg);
            }
        }).then(function (bytes) {
            if (prog) prog.message("Writing " + OfficeApp.basename(fp) + "...");
            OfficePlatform.writeBytes(fp, bytes, done, fail);
        }).catch(function (err) {
            fail(err && err.message ? err.message : "render error");
        });
    }

    /* ================= saving back into a foreign format =================
       A deck opened from .odp goes on living in that file: the framework
       keeps filepath/filename pointing at it and Ctrl+S comes back here
       instead of forcing a Save As to .pptx. This is the same converter the
       Export menu uses, reporting through the framework's save callbacks
       rather than a toast of its own. */
    function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
    function saveOdp(fp, done, fail) {
        endEdit(true);
        preparedCopy().then(function (prepared) {
            OfficePlatform.convertOut(CONVERT["export-odf"], fp, JSON.stringify(prepared),
                function () { done(); }, fail);
        }).catch(function (err) {
            fail((err && err.message) ? err.message : "could not prepare the presentation");
        });
    }
    /* .odp: the OpenDocument presentation writer emits text, images, charts,
       shapes, lines and tables (mod/office/odp_writer.go) - a video or audio
       object would simply vanish, so the save is refused instead. */
    function odpUnsupported() {
        var n = 0;
        ((body && body.slides) || []).forEach(function (s) {
            (s.objects || []).forEach(function (o) {
                if (o.type === "video" || o.type === "audio") n++;
            });
        });
        return n ? [plural(n, "video / audio object", "video / audio objects") +
            " - the OpenDocument presentation writer cannot store them"] : [];
    }
    /*
        The formats File > Save as offers besides .pptx, and the ones a deck
        opened from .odp is saved back into. needsConvert marks the
        writers that go through the Office format converters and needsBackend
        the ones that need a server outright (the real-text PDF renderer);
        OfficeApp drops whichever the running host cannot do. PDF is oneWay -
        it is a rendering, so writing one leaves the deck on its own file.
    */
    var SAVE_FORMATS = [
        {
            ext: ".odp", label: "OpenDocument presentation (.odp)", icon: "file alternate outline",
            needsConvert: true, noAutosave: true,
            unsupported: odpUnsupported,
            save: function (fp, fn, done, fail) { saveOdp(fp, done, fail); }
        },
        {
            // rendered in the browser, so it needs no backend - only the
            // PDF library (see exportPdf)
            ext: ".pdf", label: "PDF document (.pdf)", icon: "file pdf outline",
            oneWay: true,
            save: function (fp, fn, done, fail) { savePdfTo(fp, done, fail); }
        }
    ];

    /* The layouts a new slide can start from, in the order the picker
       shows them. They are skeletons of real objects, not a placeholder
       system - so what the preview draws is what the slide will be. */
    var LAYOUTS = [
        { key: "title", label: "Title slide" },
        { key: "section", label: "Section header" },
        { key: "content", label: "Title and body" },
        { key: "two", label: "Title and two columns" },
        { key: "normal", label: "Title only" },
        { key: "onecol", label: "One-column text" },
        { key: "mainpoint", label: "Main point" },
        { key: "sectiondesc", label: "Section title and description" },
        { key: "caption", label: "Caption" },
        { key: "bignumber", label: "Big number" },
        { key: "blank", label: "Blank" }
    ];
    /* showLayoutPicker is the caret beside New slide: every layout as a
       preview of itself. The previews are built by the same newSlide() and
       renderSlideContent() the document uses, at the scale the rail uses,
       so a preview cannot come to disagree with the slide it makes. */
    var $layoutPicker = null;
    function closeLayoutPicker() {
        if ($layoutPicker) { $layoutPicker.remove(); $layoutPicker = null; }
        $(document).off("mousedown.sllayoutpick");
    }
    function showLayoutPicker(x, y) {
        closeLayoutPicker();
        var $m = $('<div class="sl-layoutpick of-noprint"></div>');
        LAYOUTS.forEach(function (l) {
            var $c = $('<button type="button" class="sl-layoutpick-cell"></button>');
            var $v = $('<div class="sl-layoutpick-view"><div class="sl-layoutpick-mini sl-slidebase"></div></div>');
            $c.append($v);
            $c.append($('<div class="sl-layoutpick-label"></div>').text(l.label));
            $m.append($c);
            renderSlideContent($v.find(".sl-layoutpick-mini")[0], newSlide(l.key));
            $c.on("click", function () {
                closeLayoutPicker();
                addSlideAfter(cur, l.key);
            });
        });
        $("body").append($m);
        var mw = $m.outerWidth(), mh = $m.outerHeight();
        $m.css({
            left: Math.max(4, Math.min(x, window.innerWidth - mw - 6)) + "px",
            top: Math.max(4, Math.min(y, window.innerHeight - mh - 6)) + "px"
        });
        $layoutPicker = $m;
        setTimeout(function () {
            $(document).on("mousedown.sllayoutpick", function (e) {
                if ($layoutPicker && !$layoutPicker[0].contains(e.target)) closeLayoutPicker();
            });
        }, 0);
    }
    /* ================= init ================= */
    function initDomRefs() {
        canvasEl = document.getElementById("slCanvas");
        layerEl = document.getElementById("slSlideLayer");
        layerEl.className = "sl-slidebase";
        var overlay = document.getElementById("slOverlay");
        overlay.innerHTML = '<div id="slFrames"></div>' +
            '<div id="slCrop"></div>' +
            '<div id="slGuideV" class="sl-guide"></div>' +
            '<div id="slGuideH" class="sl-guide"></div>' +
            '<div id="slMarquee"></div>';
        framesEl = document.getElementById("slFrames");
        cropEl = document.getElementById("slCrop");
        guideVEl = document.getElementById("slGuideV");
        guideHEl = document.getElementById("slGuideH");
        marqueeEl = document.getElementById("slMarquee");

        canvasEl.addEventListener("pointerdown", onCanvasPointerDown);
        canvasEl.addEventListener("pointermove", onCanvasPointerMove);
        canvasEl.addEventListener("pointerup", onCanvasPointerUp);
        canvasEl.addEventListener("pointercancel", onCanvasPointerUp);
        canvasEl.addEventListener("dblclick", onCanvasDblClick);
        canvasEl.addEventListener("contextmenu", onCanvasContextMenu);
        // links inside text boxes must never navigate the editor itself -
        // Ctrl+click follows them (like Docs/Word), a plain click only edits
        canvasEl.addEventListener("click", function (e) {
            var a = e.target.closest ? e.target.closest("a[href]") : null;
            if (!a || !layerEl.contains(a)) return;
            e.preventDefault();
            var href = a.getAttribute("href") || "";
            if (!(e.ctrlKey || e.metaKey)) {
                OfficeApp.setStatus("Ctrl+Click to open link: " + href, "info", 4000);
                return;
            }
            if (/^https?:\/\//i.test(href)) {
                window.open(href, "_blank", "noopener");
            } else if (/^#\d+$/.test(href)) {
                var n = parseInt(href.substring(1), 10) - 1;
                if (n >= 0 && n < body.slides.length) selectSlide(n);
            }
        });

        // click on the gray area around the canvas deselects
        document.getElementById("slCanvasArea").addEventListener("pointerdown", function (e) {
            if (e.target.id === "slCanvasArea" || e.target.id === "slCanvasWrap") {
                endEdit(true);
                setSel([]);
            }
        });


        $("#slDeviceImage").on("change", function () {
            var files = this.files;
            for (var i = 0; i < files.length; i++) fileToImage(files[i]);
            this.value = "";
        });

        registerHotkeys();
        window.addEventListener("resize", function () {
            layoutCanvas();
            fitThumbs();
        });
        // live list-button state as the caret moves through the text box
        document.addEventListener("selectionchange", function () {
            if (editingId && editingKind === "text") syncListButtonState();
        });
    }

    function init() {
        // the picture tools live in their own module and reach the document
        // only through this host object
        if (window.SlidesImageTools) {
            SlidesImageTools.init({
                getImage: selectedImage,
                objEl: objEl,
                commit: commit,
                startCrop: startCrop,
                endCrop: endCrop,
                isCropping: function () { return !!cropId; },
                resetImage: resetImage,
                setMask: setImageMask,
                shapeKinds: MASK_KINDS,
                // read on use: the deck that is open decides the size
                get slideSize() { return [SLIDE_W, SLIDE_H]; },
                relayout: layoutCanvas
            });
        }
        snapGrid = false;
        undo = new OfficeUndoStack({ limit: 100, apply: applyUndoState });

        initDomRefs();

        OfficeApp.init({
            appName: "Slides",
            appType: "presentation",
            appIcon: "../img/slides.svg",
            extension: ".pptx",
            nativeLabel: "PowerPoint presentation (.pptx)",
            fileTypeName: "Presentation",
            defaultFileName: "New Presentation",
            // charts drawn to PNG and video poster frames, before a save
            prepareNative: function (copy) {
                endEdit(true);
                return prepareNative(copy);
            },

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
                // menu-driven paste: async clipboard - our object marker
                // wins, then images, internal object clipboard, plain text
                var fallback = function () {
                    if (navigator.clipboard && navigator.clipboard.readText) {
                        navigator.clipboard.readText().then(function (t) {
                            var objs = parseObjectClipboardText(t);
                            if (objs) {
                                clip = objs.map(deep);
                                pasteClipboard();
                                return;
                            }
                            if (pasteClipboard()) return;
                            if (!t) return;
                            var th = themeOf();
                            addObj("text", { html: esc(t).replace(/\n/g, "<br>"), fontSize: 24, color: th.text, align: "left" },
                                { x: 280, y: 220, w: 400, h: 90 });
                        }).catch(function () {
                            if (!pasteClipboard()) OfficeApp.setStatus("Nothing to paste", "error");
                        });
                    } else if (!pasteClipboard()) {
                        OfficeApp.setStatus("Nothing to paste", "error");
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

            // the ribbon (buildToolbar) carries Insert, Slide, Format,
            // Design and View; File and Edit stay menus
            ribbon: true,
            editMenuExtras: [
                { label: "Select all", icon: "i cursor", key: "Ctrl+A", action: selectAllObjects },
                { label: "Delete", icon: "trash alternate outline", key: "Del", enabled: function () { return sel.length > 0; }, action: deleteSelection },
                { label: "Duplicate", icon: "clone outline", key: "Ctrl+D", enabled: function () { return sel.length > 0; }, action: duplicateSelection },
                {
                    label: "Format painter", icon: "paint brush",
                    action: function () { startPainter(false); }
                },
                { sep: true },
                { label: "Find and replace...", icon: "exchange", key: "Ctrl+H", action: findReplaceDialog }
            ],
            binaryImporters: {
                ".odp": importOdp
            },
            saveFormats: SAVE_FORMATS,
            /*
                .odp needs the Office converters - the AGI backend in ArozOS,
                the WebAssembly module in the web edition; .pptx is the deck's
                own format (File > Save / Save as). The .pdf
                export is rendered here in the browser (slides_pdf.js), so it
                needs no backend at all. The PNG exports are rendered by
                html2canvas right here and are always available.
            */
            fileMenuExtras: [
                {
                    label: "Export", icon: "external alternate", sub: function () {
                        var items = [];
                        if (OfficePlatform.canConvert()) {
                            items.push({
                                label: "OpenDocument (.odp)", icon: "file alternate outline",
                                action: exportOdp
                            });
                        }
                        if (canExportPdf()) {
                            items.push({
                                label: "PDF document (.pdf)", icon: "file pdf outline",
                                action: exportPdf
                            });
                        }
                        items.push({
                            label: "Current slide as PNG", icon: "file image outline",
                            action: function () { SlidesExport.exportPNG(false); }
                        });
                        items.push({
                            label: "All slides as PNGs", icon: "images outline",
                            action: function () { SlidesExport.exportPNG(true); }
                        });
                        return items;
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
        $("#slFontFamily").val("Arial");
        // the document was loaded before the ribbon existed
        syncToolbarFromSel();
        registerOverviewKeys();
        // the format painter lays its look on the object the click selected
        canvasEl.addEventListener("pointerup", function () {
            if (painter) setTimeout(applyPainterToSel, 0);
        });
        initNotes();
        initClipboardAndDnd();

        OfficeApp.addStatusItem("slide", "");
        OfficeApp.addStatusItem("sel", "");
        updateStatus();

        zoomPct = OfficeApp.getZoom();
        layoutCanvas();
        setTimeout(layoutCanvas, 120);   // once chrome has settled
    }

    $(document).ready(init);

    /* ---------- public API (used by present.js) ---------- */
    return {
        getBody: function () { return body; },
        getCurrentIndex: function () { return cur; },
        slideSize: function () { return [SLIDE_W, SLIDE_H]; },
        renderSlideContent: renderSlideContent,
        themeOf: themeOf,
        slideCount: function () { return body ? body.slides.length : 0; }
    };
})();
