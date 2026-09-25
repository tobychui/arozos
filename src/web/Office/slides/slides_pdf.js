/*
    ArozOS Office - Slides PDF export
    =================================
    Builds the PDF in the browser, out of real PDF objects, from the very
    DOM the editor is showing. That is the only place the truth lives: how
    a line of text wrapped, where each line landed, which font the browser
    actually resolved. A server-side renderer has to guess all of it, and
    the guesses drift.

    What each element becomes:

      text      real PDF text (Tj), one show-text per line fragment, placed
                at the baseline the browser laid it out on - when the glyphs
                and the font allow it (see canDrawAsText). Otherwise that
                one text box is rasterized, nothing else.
      image     the original JPEG/PNG bytes, embedded once and re-used;
                crops, shaped crops and rounded corners are real PDF clip
                paths, flips are a negative scale in the matrix, and
                transparency is an ExtGState. A re-coloured picture is
                re-encoded through a canvas first, which is a pixel
                operation either way.
      shape     a real vector path, filled and stroked
      line      a real vector polyline, with arrow heads as filled triangles
      table     real vector cell fills and rules, text through the rules above
      chart     the chart's own SVG, translated element by element into PDF
                vectors - not a picture of it
      video     the captured poster frame, as an image
      /audio

    Rasterizing is the documented last resort, never the first move, and it
    is always scoped to the one element that needs it.

    The font rule. A PDF can only show text in a font it carries, and the
    browser will not hand over the bytes of a system font. Three answers,
    tried in that order, per character:

      1. one of the 14 standard PDF fonts, when the family the browser
         resolved is metrically identical to it (Arial / Liberation Sans ->
         Helvetica, and so on). Costs nothing and every reader has them.
      2. one of the faces the suite ships with itself (common/fonts,
         OfficeFonts) - embedded, subset to the glyphs actually used. This
         is what carries CJK, and it is why those families are in every
         font stack the editor writes.
      3. nothing covers it - emoji, a script we do not ship - and only then
         does that one text box come in as a picture of itself.

    A system font that is none of the above is substituted by the shipped
    face the document's own font stack names next, which is the same thing
    the browser does when it has no glyph. The fragment is then squeezed to
    the width the browser gave it (Tz), so a substituted face cannot push a
    line out of shape.

    Where it runs. Each slide is measured and drawn in the page, but onto a
    recording (OfficePdfDraw.recorder, common/pdfdraw.js): every pdf-lib
    call is written down as data, pictures are named rather than embedded,
    and fonts are only parsed here for their glyph widths. The file itself -
    embedding and deflating the pictures, subsetting the fonts, writing it
    out - is made from that recording in a Web Worker (common/pdfworker.js),
    so a large deck does not freeze the editor while it is written.

    Usage:
        SlidesPdf.build(body, { onProgress: fn(done, total, stage) })
            -> Promise<Uint8Array>
        stage: "measure" per slide drawn, then "page" and "save" from the
        worker
*/

var SlidesPdf = (function () {
    "use strict";

    // the slide is 960x540 css px; a PDF point is 1/72", a css px 1/96",
    // so the page is 720x405 pt - the 10" x 5.625" of the pptx slide size
    var SLIDE_W = 960, SLIDE_H = 540;

    /* the shared exporter core (common/pdfcore.js) */
    var C = OfficePdfCore;
    var PX_TO_PT = C.PX_TO_PT;
    var familyList = C.familyList, loadFontkit = C.loadFontkit, makeFonts = C.makeFonts;
    var resolveChar = C.resolveChar, segmentText = C.segmentText, faceOf = C.faceOf;
    var eachTextNode = C.eachTextNode, px = C.px, clamp = C.clamp;
    var parseFill = C.parseFill, parseColor = C.parseColor, contrastOf = C.contrastOf;
    var collectRuns = C.collectRuns, canDrawAsText = C.canDrawAsText;
    var drawFragment = C.drawFragment, drawRuns = C.drawRuns;
    var rasterizeElement = C.rasterizeElement, rasterizeFallback = C.rasterizeFallback;
    var filteredImageData = C.filteredImageData;
    // a slide page: the core's drawing context at the slide's height
    function Page(page, pdfDoc, fonts) {
        return new C.Page(page, pdfDoc, fonts, SLIDE_H);
    }

    /* prepareFonts loads what this slide is about to need, and then checks
       that what arrived really covers it. The second look is not paranoia:
       the Traditional Chinese face has no simplified forms, so a deck that
       mixes them only discovers it needs the next file once the first one
       is in hand. Each pass asks for exactly one more face per character
       that is still homeless, so nothing large is fetched on spec. */
    function prepareFonts(objs, stageEl, fonts) {
        var MAX_PASSES = OfficeFonts.FALLBACK.length + 2;

        function eachChar(rootEl, fn) {
            eachTextNode(rootEl, function (node, text, cs) {
                var names = familyList(cs.fontFamily);
                var bold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
                var italic = cs.fontStyle === "italic" || cs.fontStyle === "oblique";
                for (var i = 0; i < text.length; i++) {
                    var cp = text.codePointAt(i);
                    if (cp > 0xFFFF) i++;
                    fn(resolveChar(cp, names, fonts, bold, italic), bold, italic);
                }
            });
        }

        function pass(n) {
            var asked = false;
            eachChar(stageEl, function (res, bold, italic) {
                if (res && res.need) {
                    fonts.want(res.need, bold, italic);
                    asked = true;
                }
            });
            if (!asked || n >= MAX_PASSES) return fonts.ready();
            return fonts.ready().then(function () { return pass(n + 1); });
        }

        /* Now that coverage is known, embed the faces this slide will draw
           with - and only those. It has to be the real decision, object by
           object: a text box that falls back to a raster draws with nothing
           at all, and a face left embedded but undrawn is a subset of no
           glyphs, which is not a font. */
        function embedUsed() {
            (objs || []).forEach(function (o, i) {
                var el = stageEl.children[i];
                if (!el || needsRaster(o, el, fonts)) return;
                textRootsOf(o, el).forEach(function (root) {
                    eachChar(root, function (res, bold, italic) {
                        if (res && res.shipped) fonts.use(res.shipped, bold, italic);
                    });
                });
            });
            return fonts.ready();
        }

        return pass(0).then(embedUsed);
    }

    /* ---------------- geometry -> PDF path operators ---------------- */

    // shapePathOps turns one of the editor's shape outlines into path
    // operators in page space. Used for both shape objects and the clip
    // path of a shaped crop, so the two cannot disagree.
    function shapePathOps(kind, x, y, w, h, radius, adj) {
        var X = function (v) { return px(x + v); };
        var Y = function (v) { return px(SLIDE_H - (y + v)); };
        var ops = [];
        if (!kind || kind === "rect") {
            ops.push(PDFLib.moveTo(X(0), Y(0)), PDFLib.lineTo(X(w), Y(0)),
                PDFLib.lineTo(X(w), Y(h)), PDFLib.lineTo(X(0), Y(h)), PDFLib.closePath());
            return ops;
        }
        if (kind === "roundRect") {
            var r = Math.min(radius > 0 ? radius : Math.min(w, h) * 0.15, Math.min(w, h) / 2);
            var k = r * 0.5523;
            ops.push(PDFLib.moveTo(X(r), Y(0)));
            ops.push(PDFLib.lineTo(X(w - r), Y(0)));
            ops.push(PDFLib.appendBezierCurve(X(w - r + k), Y(0), X(w), Y(r - k), X(w), Y(r)));
            ops.push(PDFLib.lineTo(X(w), Y(h - r)));
            ops.push(PDFLib.appendBezierCurve(X(w), Y(h - r + k), X(w - r + k), Y(h), X(w - r), Y(h)));
            ops.push(PDFLib.lineTo(X(r), Y(h)));
            ops.push(PDFLib.appendBezierCurve(X(r - k), Y(h), X(0), Y(h - r + k), X(0), Y(h - r)));
            ops.push(PDFLib.lineTo(X(0), Y(r)));
            ops.push(PDFLib.appendBezierCurve(X(0), Y(r - k), X(r - k), Y(0), X(r), Y(0)));
            ops.push(PDFLib.closePath());
            return ops;
        }
        if (kind === "ellipse") {
            var cx = w / 2, cy = h / 2, kx = cx * 0.5523, ky = cy * 0.5523;
            ops.push(PDFLib.moveTo(X(0), Y(cy)));
            ops.push(PDFLib.appendBezierCurve(X(0), Y(cy - ky), X(cx - kx), Y(0), X(cx), Y(0)));
            ops.push(PDFLib.appendBezierCurve(X(cx + kx), Y(0), X(w), Y(cy - ky), X(w), Y(cy)));
            ops.push(PDFLib.appendBezierCurve(X(w), Y(cy + ky), X(cx + kx), Y(h), X(cx), Y(h)));
            ops.push(PDFLib.appendBezierCurve(X(cx - kx), Y(h), X(0), Y(cy + ky), X(0), Y(cy)));
            ops.push(PDFLib.closePath());
            return ops;
        }
        var d = (window.SlidesShapes) ? SlidesShapes.path(kind, w, h, adj) : "";
        if (!d) return shapePathOps("rect", x, y, w, h, 0);
        return svgPathOps(d, X, Y);
    }

    /* svgPathOps turns one of the catalogue's paths into PDF path
       operators. It only has to understand M, L, C and Z because that is
       all slides_shapes.js ever writes - arcs arrive already converted to
       cubics, which is the whole reason for that restriction. */
    function svgPathOps(d, X, Y) {
        var ops = [];
        var re = /([MLCZ])([^MLCZ]*)/g;
        var m;
        while ((m = re.exec(d))) {
            var cmd = m[1];
            if (cmd === "Z") { ops.push(PDFLib.closePath()); continue; }
            var v = m[2].trim().split(/[\s,]+/).map(Number);
            if (cmd === "M") ops.push(PDFLib.moveTo(X(v[0]), Y(v[1])));
            else if (cmd === "L") ops.push(PDFLib.lineTo(X(v[0]), Y(v[1])));
            else ops.push(PDFLib.appendBezierCurve(X(v[0]), Y(v[1]),
                X(v[2]), Y(v[3]), X(v[4]), Y(v[5])));
        }
        return ops;
    }

    // boxOf returns an element's box in slide coordinates
    function boxOf(el, stageEl) {
        var r = el.getBoundingClientRect(), s = stageEl.getBoundingClientRect();
        return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height };
    }

    /* drawAsRaster puts one element in as an image of itself, at the box it
       occupies on the slide. A rotated object is drawn unrotated inside the
       rotation matrix its caller set up, so the picture stays crisp
       rather than being a picture of something already turned. */
    function drawAsRaster(pg, o, el, ctx) {
        var b = boxOf(el, ctx.stage);
        return rasterizeElement(el, b.w, b.h).then(function (src) {
            return src || rasterizeFallback(el, b.w, b.h);
        }).then(function (src) {
            if (!src) return;
            return ctx.embed(src).then(function (img) {
                if (!img) return;
                pg.p.drawImage(img, {
                    x: px(b.x), y: pg.y(b.y + b.h), width: px(b.w), height: px(b.h)
                });
            });
        });
    }

    /* ---------------- SVG (charts) -> PDF vectors ---------------- */

    /* OfficeCharts draws with rect / line / polyline / polygon / path /
       circle / text, so a chart can be put in the PDF as the vectors it
       already is. Anything unexpected in the tree makes the caller fall
       back to a raster for that one object. */
    var SVG_KNOWN = { g: 1, rect: 1, line: 1, circle: 1, polyline: 1,
        polygon: 1, path: 1, text: 1, defs: 1, title: 1, desc: 1 };

    /* svgTranslatable asks whether drawSvg can express this tree, before
       anything is drawn - an element it does not know, or a label in a
       script no font here can show, means the chart has to come in as a
       picture instead. */
    function svgTranslatable(el, fonts) {
        for (var i = 0; i < el.children.length; i++) {
            var c = el.children[i];
            var tag = c.tagName.toLowerCase();
            if (!SVG_KNOWN[tag]) return false;
            if (tag === "text") {
                var str = (c.textContent || "").replace(/[\u0000-\u001F\u007F]/g, " ");
                var cs = window.getComputedStyle(c);
                if (str.trim() && !segmentText(str, familyList(cs.fontFamily), fonts,
                    (parseInt(cs.fontWeight, 10) || 400) >= 600, false)) return false;
            }
            if (tag === "g" && !svgTranslatable(c, fonts)) return false;
        }
        return true;
    }

    function drawSvg(pg, svgEl, x, y, w, h) {
        var vb = (svgEl.getAttribute("viewBox") || "").split(/[\s,]+/).map(parseFloat);
        var vw = vb.length === 4 ? vb[2] : w, vh = vb.length === 4 ? vb[3] : h;
        var vx = vb.length === 4 ? vb[0] : 0, vy = vb.length === 4 ? vb[1] : 0;
        if (!(vw > 0) || !(vh > 0)) return false;
        var k = Math.min(w / vw, h / vh);
        var offX = x + (w - vw * k) / 2, offY = y + (h - vh * k) / 2;
        var X = function (v) { return offX + (v - vx) * k; };
        var Y = function (v) { return offY + (v - vy) * k; };

        var ok = true;
        var walk = function (el) {
            if (!ok) return;
            for (var i = 0; i < el.children.length; i++) {
                var c = el.children[i];
                var tag = c.tagName.toLowerCase();
                var cs = window.getComputedStyle(c);
                var fill = c.getAttribute("fill");
                var stroke = c.getAttribute("stroke");
                // charts inherit their text colour; resolve it the way the
                // browser did rather than guessing
                var fillF = (fill === "none") ? null
                    : parseFill(fill === "currentColor" || !fill ? cs.color : fill);
                var strokeF = (!stroke || stroke === "none") ? null
                    : parseFill(stroke === "currentColor" ? cs.color : stroke);
                var fillCol = fillF ? fillF.c : null, fillA = fillF ? fillF.a : 1;
                var strokeCol = strokeF ? strokeF.c : null, strokeA = strokeF ? strokeF.a : 1;
                var sw = parseFloat(c.getAttribute("stroke-width") || "1") * k;
                switch (tag) {
                    case "g": walk(c); break;
                    case "rect":
                        pg.rect(X(parseFloat(c.getAttribute("x") || 0)),
                            Y(parseFloat(c.getAttribute("y") || 0)),
                            parseFloat(c.getAttribute("width") || 0) * k,
                            parseFloat(c.getAttribute("height") || 0) * k,
                            { fill: fillCol, stroke: strokeCol, strokeW: strokeCol ? sw : 0,
                              fillOpacity: fillA, strokeOpacity: strokeA });
                        break;
                    case "line":
                        pg.p.drawLine({
                            start: { x: px(X(parseFloat(c.getAttribute("x1") || 0))), y: pg.y(Y(parseFloat(c.getAttribute("y1") || 0))) },
                            end: { x: px(X(parseFloat(c.getAttribute("x2") || 0))), y: pg.y(Y(parseFloat(c.getAttribute("y2") || 0))) },
                            thickness: px(sw), color: strokeCol || PDFLib.rgb(0, 0, 0)
                        });
                        break;
                    case "circle":
                        pg.p.drawCircle({
                            x: px(X(parseFloat(c.getAttribute("cx") || 0))),
                            y: pg.y(Y(parseFloat(c.getAttribute("cy") || 0))),
                            size: px(parseFloat(c.getAttribute("r") || 0) * k),
                            color: fillCol || undefined,
                            borderColor: strokeCol || undefined,
                            borderWidth: strokeCol ? px(sw) : undefined
                        });
                        break;
                    case "polyline":
                    case "polygon":
                        var pts = (c.getAttribute("points") || "").trim().split(/\s+/).map(function (p) {
                            var xy = p.split(",");
                            return [X(parseFloat(xy[0])), Y(parseFloat(xy[1]))];
                        }).filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); });
                        if (pts.length < 2) break;
                        var ops = [];
                        pts.forEach(function (p, i) {
                            ops.push(i === 0 ? PDFLib.moveTo(px(p[0]), pg.y(p[1]))
                                : PDFLib.lineTo(px(p[0]), pg.y(p[1])));
                        });
                        if (tag === "polygon") ops.push(PDFLib.closePath());
                        pg.save();
                        if (fillCol) ops.unshift(PDFLib.setFillingColor(fillCol));
                        if (strokeCol) {
                            ops.unshift(PDFLib.setStrokingColor(strokeCol));
                            ops.unshift(PDFLib.setLineWidth(px(sw)));
                        }
                        ops.push(fillCol && strokeCol ? PDFLib.fillAndStroke()
                            : (fillCol ? PDFLib.fill() : PDFLib.stroke()));
                        pg.ops(ops);
                        pg.restore();
                        break;
                    case "path":
                        var d = c.getAttribute("d");
                        if (!d) break;
                        pg.p.drawSvgPath(d, {
                            x: px(offX - vx * k), y: pg.y(offY - vy * k), scale: k * PX_TO_PT,
                            color: fillCol || undefined,
                            borderColor: strokeCol || undefined,
                            borderWidth: strokeCol ? px(sw) : undefined
                        });
                        break;
                    case "text":
                        var str = (c.textContent || "").replace(/[\u0000-\u001F\u007F]/g, " ");
                        if (!str.trim()) break;
                        // the svg is measured in px like the rest of the
                        // slide; only the final drawText call is in points.
                        // A label is placed from its own anchor, so it is
                        // measured first and never fitted to a box.
                        var names = familyList(cs.fontFamily);
                        var bold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
                        var sizePx = (parseFloat(cs.fontSize) || 12) * k;
                        var segs = segmentText(str, names, pg.fonts, bold, false);
                        if (!segs) { ok = false; return; }
                        var twPx = 0;
                        segs.forEach(function (seg) {
                            var f = faceOf(seg.res, pg.fonts, bold, false);
                            if (f) twPx += f.font.widthOfTextAtSize(seg.text, sizePx);
                        });
                        var anchor = c.getAttribute("text-anchor") || "start";
                        var tx = X(parseFloat(c.getAttribute("x") || 0));
                        if (anchor === "middle") tx -= twPx / 2;
                        else if (anchor === "end") tx -= twPx;
                        drawFragment(pg, {
                            text: str, names: names, bold: bold, italic: false,
                            sizePx: sizePx, xPx: tx,
                            baselinePx: Y(parseFloat(c.getAttribute("y") || 0)),
                            color: fillCol || PDFLib.rgb(0, 0, 0), fitPx: 0
                        });
                        break;
                    case "defs":
                    case "title":
                    case "desc":
                        break;
                    default:
                        ok = false;
                        return;
                }
            }
        };
        walk(svgEl);
        return ok;
    }

    /* ---------------- one object ---------------- */

    /* An object's rotation turns the whole object about its own centre.
       Rather than rotate every primitive, the drawing runs inside one
       matrix and the offscreen element is measured with its CSS rotation
       taken off - otherwise getBoundingClientRect would hand back the
       bounding box of the rotated result instead of the box itself. */
    function withRotation(pg, o, el, fn) {
        if (!o.rot) return fn();
        var prev = el ? el.style.transform : null;
        if (el) {
            el.style.transform = "none";
            void el.offsetWidth;                 // force the reflow
        }
        var rad = -o.rot * Math.PI / 180;        // css turns clockwise, pdf does not
        var cos = Math.cos(rad), sin = Math.sin(rad);
        var cx = px(o.x + o.w / 2), cy = pg.y(o.y + o.h / 2);
        pg.save();
        pg.ops([PDFLib.concatTransformationMatrix(cos, sin, -sin, cos,
            cx - (cos * cx - sin * cy), cy - (sin * cx + cos * cy))]);
        var restore = function () {
            pg.restore();
            if (el) el.style.transform = prev;
        };
        var out;
        try { out = fn(); } catch (e) { restore(); throw e; }
        return Promise.resolve(out).then(function (v) { restore(); return v; },
            function (e) { restore(); throw e; });
    }

    /* needsRaster answers the fallback question up front, before anything
       is drawn and before any transform is touched. It only inspects fonts
       and characters, so a rotated element can be asked safely. */
    /* textRootsOf names the elements an object actually takes its text
       from, so that asking "can this be drawn as text" and asking "which
       faces will it draw with" cannot look at different things. */
    function textRootsOf(o, el) {
        if (!el) return [];
        if (o.type === "text") return [el.querySelector(".sl-text-in")].filter(Boolean);
        if (o.type === "shape") return [el.querySelector(".sl-shape-text")].filter(Boolean);
        if (o.type === "table") return Array.prototype.slice.call(el.querySelectorAll("td, th"));
        if (o.type === "chart") return [el.querySelector("svg")].filter(Boolean);
        return [];
    }

    function needsRaster(o, el, fonts) {
        if (!el) return false;
        if (o.type === "chart") {
            var svg = el.querySelector("svg");
            return !svg || !svgTranslatable(svg, fonts);
        }
        var roots = textRootsOf(o, el);
        for (var i = 0; i < roots.length; i++) {
            var runs = collectRuns(roots[i], { left: 0, top: 0, x: 0, y: 0 });
            if (runs.length && !canDrawAsText(runs, fonts)) return true;
        }
        return false;
    }

    function drawObject(pg, o, el, ctx) {
        var raster = !!(el && needsRaster(o, el, pg.fonts));
        return withRotation(pg, o, el, function () {
            return raster ? drawAsRaster(pg, o, el, ctx)
                : drawObjectBody(pg, o, el, ctx);
        });
    }

    function drawObjectBody(pg, o, el, ctx) {
        var origin = null;
        if (el) {
            var r = el.getBoundingClientRect();
            origin = { left: r.left, top: r.top, x: o.x, y: o.y };
        }

        switch (o.type) {
            case "image":
            case "video":
            case "audio":
                return drawImageObject(pg, o, el, ctx);
            case "shape":
                return drawShapeObject(pg, o, el, origin, ctx);
            case "line":
                drawLineObject(pg, o);
                return Promise.resolve();
            case "table":
                return drawTableObject(pg, o, el, ctx);
            case "chart":
                return drawChartObject(pg, o, el, ctx);
            case "text":
                return drawTextObject(pg, o, el, origin, ctx);
        }
        return Promise.resolve();
    }

    /* ---- text object ---- */
    function drawTextObject(pg, o, el, origin, ctx) {
        var inner = el ? el.querySelector(".sl-text-in") : null;
        if (!inner) return Promise.resolve();
        var runs = collectRuns(inner, origin);
        if (runs.length) drawRuns(pg, runs);
        return Promise.resolve();
    }

    /* ---- image object ---- */
    function drawImageObject(pg, o, el, ctx) {
        var embedImage = ctx.embed;
        var p = o.props || {};
        var src = p.src;
        if (o.type === "video" || o.type === "audio") src = p.png || "";
        if (!src) return Promise.resolve();
        var filter = (window.SlidesImageTools ? SlidesImageTools.imageFilter(p) : "");
        var prep = filter ? filteredImageData(src, filter) : Promise.resolve(src);
        return prep.then(function (finalSrc) {
            return embedImage(finalSrc || src);
        }).then(function (img) {
            if (!img) return;
            var crop = p.crop;
            var kw = 1, kh = 1, cl = 0, ct = 0;
            if (crop && crop.length === 4) {
                cl = Number(crop[0]) || 0; ct = Number(crop[1]) || 0;
                kw = 1 - cl - (Number(crop[2]) || 0);
                kh = 1 - ct - (Number(crop[3]) || 0);
                if (!(kw > 0.001) || !(kh > 0.001)) { kw = kh = 1; cl = ct = 0; }
            }
            // the visible window is the object box; the whole picture is
            // that box scaled up by the crop, shifted so the kept part lines
            // up - the same identity the editor and the pptx reader use
            var fullW = o.w / kw, fullH = o.h / kh;
            var fullX = o.x - cl * fullW, fullY = o.y - ct * fullH;

            pg.save();
            // clip to the frame, in the shape the picture is masked to
            var clipOps = shapePathOps(p.mask || "rect", o.x, o.y, o.w, o.h, p.radius);
            clipOps.push(PDFLib.clip(), PDFLib.endPath());
            pg.ops(clipOps);
            if (p.opacity && p.opacity < 1) {
                pg.ops([PDFLib.setGraphicsState(pg.alpha(clamp(p.opacity, 0, 1)))]);
            }
            // flips are a negative scale about the picture's own centre
            var sx = p.flipH ? -1 : 1, sy = p.flipV ? -1 : 1;
            var drawX = fullX, drawY = fullY;
            if (sx < 0 || sy < 0) {
                var cx = px(fullX + fullW / 2), cy = pg.y(fullY + fullH / 2);
                pg.ops([PDFLib.concatTransformationMatrix(sx, 0, 0, sy,
                    cx - sx * cx, cy - sy * cy)]);
            }
            pg.p.drawImage(img, {
                x: px(drawX), y: pg.y(drawY + fullH),
                width: px(fullW), height: px(fullH)
            });
            pg.restore();
            // the picture's outline, along the frame (or the shape it is
            // cropped to), centred on it as the editor and PowerPoint draw it
            var sw = Number(p.strokeW) || 0;
            var sc = (sw > 0 && p.stroke && p.stroke !== "none") ? parseColor(p.stroke) : null;
            if (sc && o.type === "image") {
                var sops = shapePathOps(p.mask || "rect", o.x, o.y, o.w, o.h, p.radius);
                sops.unshift(PDFLib.setStrokingColor(sc), PDFLib.setLineWidth(px(sw)));
                var idash = SlidesLines.dashArray(p, sw);
                if (idash) sops.unshift(PDFLib.setDashPattern(idash.map(px), 0));
                sops.push(PDFLib.stroke());
                pg.save();
                pg.ops(sops);
                pg.restore();
            }
        });
    }

    /* ---- shape object ---- */
    function drawShapeObject(pg, o, el, origin, ctx) {
        var p = o.props || {};
        var kind = window.SlidesShapes ? SlidesShapes.canonical(p.kind || "rect") : (p.kind || "rect");
        var open = window.SlidesShapes && SlidesShapes.isOpen(kind);
        var evenOdd = window.SlidesShapes && SlidesShapes.evenOdd(kind);
        var strokeW = Number(p.strokeW) || 0;
        var fillCss = p.fill, strokeCss = p.stroke;
        // the same rule the canvas follows: a bracket, brace or arc is a
        // line, so it is stroked and never filled (see shapeSvg)
        if (open) {
            if (!strokeCss || strokeCss === "none") {
                strokeCss = (fillCss && fillCss !== "none") ? fillCss : "#333333";
            }
            if (!strokeW) strokeW = 2;
            fillCss = "none";
        }
        var fill = (fillCss && fillCss !== "none") ? parseColor(fillCss) : null;
        var stroke = (strokeW > 0 && strokeCss && strokeCss !== "none") ? parseColor(strokeCss) : null;
        if (fill || stroke) {
            var ops = shapePathOps(kind, o.x, o.y, o.w, o.h, p.radius, p.adj);
            if (fill) ops.unshift(PDFLib.setFillingColor(fill));
            if (stroke) {
                ops.unshift(PDFLib.setStrokingColor(stroke));
                ops.unshift(PDFLib.setLineWidth(px(strokeW)));
                var sdash = SlidesLines.dashArray(p, strokeW);
                if (sdash) {
                    ops.unshift(PDFLib.setDashPattern(sdash.map(px), 0));
                    if (SlidesLines.capOf(p) === "butt") ops.unshift(PDFLib.setLineCap(PDFLib.LineCapStyle.Butt));
                }
            }
            if (fill && stroke) {
                ops.push(evenOdd ? PDFLib.PDFOperator.of(PDFLib.PDFOperatorNames.FillEvenOddAndStroke)
                    : PDFLib.fillAndStroke());
            } else if (fill) {
                ops.push(evenOdd ? PDFLib.PDFOperator.of(PDFLib.PDFOperatorNames.FillEvenOdd)
                    : PDFLib.fill());
            } else {
                ops.push(PDFLib.stroke());
            }
            pg.save();
            pg.ops(ops);
            pg.restore();
        }
        // markings the canvas draws over the outline - the bars of a
        // predefined process, the fold of a folded corner
        var det = window.SlidesShapes ? SlidesShapes.detail(kind, o.w, o.h) : "";
        if (det) {
            var dc = stroke || parseColor(contrastOf(fillCss)) || PDFLib.rgb(0.2, 0.2, 0.2);
            var X = function (v) { return px(o.x + v); };
            var Y = function (v) { return px(SLIDE_H - (o.y + v)); };
            var dops = svgPathOps(det, X, Y);
            dops.unshift(PDFLib.setLineWidth(px(strokeW > 0 ? strokeW : 1)));
            dops.unshift(PDFLib.setStrokingColor(dc));
            dops.push(PDFLib.stroke());
            pg.save();
            pg.ops(dops);
            pg.restore();
        }
        // the caption rides on the same text rules as a text box
        var inner = el ? el.querySelector(".sl-shape-text") : null;
        if (!inner) return Promise.resolve();
        var runs = collectRuns(inner, origin || { left: 0, top: 0, x: o.x, y: o.y });
        if (runs.length) drawRuns(pg, runs);
        return Promise.resolve();
    }

    /* ---- line object ---- */
    function drawLineObject(pg, o) {
        var p = o.props || {};
        var pts = (p.points && p.points.length >= 2)
            ? p.points.map(function (pt) { return [o.x + pt[0], o.y + pt[1]]; })
            : [[o.x, o.y], [o.x + o.w, o.y + o.h]];
        var col = parseColor(p.stroke) || PDFLib.rgb(0.13, 0.13, 0.14);
        var sw = Number(p.strokeW) || 2;
        // the stroke, its dash and both ends are the very geometry the
        // canvas draws (slides_lines.js)
        var geo = SlidesLines.geometry(pts, p, sw);
        var dash = SlidesLines.dashArray(p, sw);
        var round = SlidesLines.capOf(p) === "round";

        var ops = [PDFLib.setStrokingColor(col), PDFLib.setLineWidth(px(sw)),
            PDFLib.setLineCap(round ? PDFLib.LineCapStyle.Round : PDFLib.LineCapStyle.Butt),
            PDFLib.setLineJoin(PDFLib.LineJoinStyle.Round)];
        if (dash) ops.push(PDFLib.setDashPattern(dash.map(px), 0));
        geo.line.forEach(function (pt, i) {
            ops.push(i === 0 ? PDFLib.moveTo(px(pt[0]), pg.y(pt[1])) : PDFLib.lineTo(px(pt[0]), pg.y(pt[1])));
        });
        ops.push(PDFLib.stroke());
        pg.save();
        pg.ops(ops);
        pg.restore();

        geo.heads.forEach(function (h) {
            var hpts = h.pts;
            if (h.kind === "circle") {
                // a circle as a fine polygon: a head is a few pixels across
                hpts = [];
                for (var k = 0; k < 32; k++) {
                    var a = k / 32 * Math.PI * 2;
                    hpts.push([h.cx + h.r * Math.cos(a), h.cy + h.r * Math.sin(a)]);
                }
            }
            var hops = h.fill ? [PDFLib.setFillingColor(col)]
                : [PDFLib.setStrokingColor(col), PDFLib.setLineWidth(px(sw)),
                    PDFLib.setLineCap(PDFLib.LineCapStyle.Round),
                    PDFLib.setLineJoin(PDFLib.LineJoinStyle.Round)];
            hpts.forEach(function (pt, i) {
                hops.push(i === 0 ? PDFLib.moveTo(px(pt[0]), pg.y(pt[1])) : PDFLib.lineTo(px(pt[0]), pg.y(pt[1])));
            });
            var closed = h.kind === "circle" || h.closed;
            if (closed) hops.push(PDFLib.closePath());
            hops.push(h.fill ? PDFLib.fill() : PDFLib.stroke());
            pg.save();
            pg.ops(hops);
            pg.restore();
        });
    }

    /* ---- table object ---- */
    function drawTableObject(pg, o, el, ctx) {
        if (!el) return Promise.resolve();
        var host = el.getBoundingClientRect();
        var origin = { left: host.left, top: host.top, x: o.x, y: o.y };
        var cells = el.querySelectorAll("td, th");
        var jobs = [];
        for (var i = 0; i < cells.length; i++) {
            (function (cell) {
                var cs = window.getComputedStyle(cell);
                var cr = cell.getBoundingClientRect();
                var cx = o.x + (cr.left - host.left), cy = o.y + (cr.top - host.top);
                var bg = parseFill(cs.backgroundColor);
                if (bg) pg.rect(cx, cy, cr.width, cr.height, { fill: bg.c, fillOpacity: bg.a });
                var bd = parseFill(cs.borderTopColor);
                var bw = parseFloat(cs.borderTopWidth) || 0;
                if (bd && bw > 0) {
                    pg.rect(cx, cy, cr.width, cr.height,
                        { stroke: bd.c, strokeW: bw, strokeOpacity: bd.a });
                }
                var runs = collectRuns(cell, origin);
                if (runs.length) drawRuns(pg, runs);
            })(cells[i]);
        }
        return Promise.all(jobs);
    }

    /* ---- chart object ---- */
    function drawChartObject(pg, o, el, ctx) {
        var svg = el ? el.querySelector("svg") : null;
        if (svg) drawSvg(pg, svg, o.x, o.y, o.w, o.h);
        return Promise.resolve();
    }

    /* ---------------- the build ---------------- */

    /* stage renders one slide offscreen at exactly 960x540 so every
       measurement below is taken at scale 1, whatever zoom the editor is at */
    function withStage(slide, fn) {
        var holder = document.createElement("div");
        holder.style.cssText = "position:fixed;left:-20000px;top:0;width:960px;height:540px;" +
            "overflow:hidden;contain:layout;";
        var el = document.createElement("div");
        el.className = "sl-slidebase";
        el.style.cssText = "width:960px;height:540px;position:relative;overflow:hidden;";
        holder.appendChild(el);
        document.body.appendChild(holder);
        SlidesApp.renderSlideContent(el, slide);
        return waitForImages(el).then(function () {
            return fn(el);
        }).then(function (r) {
            holder.remove();
            return r;
        }, function (e) {
            holder.remove();
            throw e;
        });
    }

    function waitForImages(root) {
        var imgs = Array.prototype.slice.call(root.querySelectorAll("img"));
        var pending = imgs.filter(function (im) { return !im.complete; });
        // the shipped faces have to be in place before anything is
        // measured: a line laid out in a fallback wraps somewhere else
        var fonts = OfficeFonts.preload().then(function () {
            return document.fonts && document.fonts.ready ? document.fonts.ready : null;
        });
        if (!pending.length) return fonts;
        return Promise.all([fonts].concat(pending.map(function (im) {
            return new Promise(function (res) {
                var done = function () { res(); };
                im.addEventListener("load", done);
                im.addEventListener("error", done);
                setTimeout(done, 6000);
            });
        })));
    }

    function build(body, opts) {
        opts = opts || {};
        if (typeof PDFLib === "undefined") {
            return Promise.reject(new Error("the PDF library failed to load"));
        }
        var slides = (body && body.slides) || [];
        if (!slides.length) return Promise.reject(new Error("the presentation has no slides"));

        return loadFontkit().then(function (fontkit) {
            return PDFLib.PDFDocument.create().then(function (pdfDoc) {
                pdfDoc.registerFontkit(fontkit);
                return { doc: pdfDoc, kit: fontkit };
            });
        }).then(function (made) {
            // this document is never saved: it only lends its fonts their
            // metrics - the drawing goes to the recording
            var pdfDoc = made.doc;
            var fonts = makeFonts(pdfDoc, made.kit);
            var rec = OfficePdfDraw.recorder();
            var embedImage = rec.embed;
            var theme = SlidesApp.themeOf();
            var chain = Promise.resolve();
            slides.forEach(function (slide, idx) {
                chain = chain.then(function () {
                    var page = rec.addPage([px(SLIDE_W), px(SLIDE_H)]);
                    var pg = new Page(page, pdfDoc, fonts);
                    var bg = parseColor(slide.bg || theme.bg);
                    if (bg) pg.rect(0, 0, SLIDE_W, SLIDE_H, { fill: bg });
                    return withStage(slide, function (stageEl) {
                        var ctx = { stage: stageEl, embed: embedImage };
                        // every face this slide needs is in hand before a
                        // single object is measured, so the drawing below
                        // can stay synchronous
                        var objs = slide.objects || [];
                        return prepareFonts(objs, stageEl, fonts).then(function () {
                            var seq = Promise.resolve();
                            objs.forEach(function (o, i) {
                                seq = seq.then(function () {
                                    return drawObject(pg, o, stageEl.children[i], ctx);
                                });
                            });
                            return seq;
                        });
                    });
                }).then(function () {
                    if (opts.onProgress) opts.onProgress(idx + 1, slides.length, "measure");
                    // let the editor breathe between slides
                    return new Promise(function (res) { setTimeout(res, 0); });
                });
            });
            return chain.then(function () {
                return OfficePdfDraw.run(rec.job(opts.title), {
                    onProgress: opts.onProgress, loadFontkit: loadFontkit
                });
            });
        });
    }

    return {
        build: build
    };
})();
