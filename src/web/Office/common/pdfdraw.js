/*
    ArozOS Office - PDF assembly from a display list
    ================================================
    The half of a browser-side PDF export that needs no page to look at.
    The exporter measures the document in the page (where every line, box
    and baseline is) and writes down what to draw as plain data - a display
    list. This file turns that list into a PDF with pdf-lib.

    It is written to run in a Web Worker (common/pdfworker.js), because this
    is the part that takes the time: embedding and deflating every picture,
    subsetting the fonts and serializing the file used to hold the page
    still for most of a large export. Nothing here touches the DOM, so the
    same code also runs in the page when a worker cannot be started.

    The job:
        {
          title, sheetW, sheetH,              // px (96/in)
          images: { id: { src } | { bytes } },  // data URL / URL, or JPEG/PNG bytes
          pages: [ [op, ...], ... ]
        }
    Coordinates are px from the page's top-left corner. Ops are arrays:
        ["rect", x, y, w, h, rgb, alpha]
        ["image", id, x, y, w, h, crop]       crop {t,r,b,l} fractions | null
        ["text", x, baseline, size, rgb, fitW, segs, deco]
              segs [[text, font, synthBold]]  font "s:Helvetica:bold:italic" | "f:<url>"
              deco [y, h, w] underline/strike bar, w used when nothing drew
        ["leader", x, w, baseline, size, rgb, ch, font]
        ["ellipse", cx, cy, rx, ry, rgb, strokeW]      strokeW 0 = filled
        ["poly", [x, y, ...], rgb, strokeW]
        ["frame", x, y, w, h, rgb, strokeW]

    Usage:
        OfficePdfDraw.render(job, { fontkit, onProgress }) -> Promise<Uint8Array>
*/

var OfficePdfDraw = (function () {
    "use strict";

    var PX = 0.75;
    var STD_VARIANTS = {
        Helvetica: ["Helvetica", "HelveticaBold", "HelveticaOblique", "HelveticaBoldOblique"],
        TimesRoman: ["TimesRoman", "TimesRomanBold", "TimesRomanItalic", "TimesRomanBoldItalic"],
        Courier: ["Courier", "CourierBold", "CourierOblique", "CourierBoldOblique"]
    };

    function rgb(c) {
        return PDFLib.rgb(c[0], c[1], c[2]);
    }

    function base64Bytes(src) {
        var comma = src.indexOf(",");
        if (comma < 0 || src.substring(0, comma).indexOf(";base64") < 0) return null;
        var bin = atob(src.substring(comma + 1));
        var out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }
    function sniff(bytes) {
        if (bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8) return "jpg";
        if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "png";
        return null;
    }

    function render(job, opts) {
        opts = opts || {};
        var pdfDoc;
        var fontCache = {};    // font ref -> Promise<PDFFont|null>
        var fontReady = {};    // font ref -> PDFFont|null
        var imageCache = {};   // id -> Promise<PDFImage|null>

        function loadFont(ref) {
            if (fontCache[ref]) return fontCache[ref];
            var p;
            if (ref.indexOf("s:") === 0) {
                var parts = ref.split(":");
                var names = STD_VARIANTS[parts[1]] || STD_VARIANTS.Helvetica;
                var key = names[(parts[2] === "1" ? 1 : 0) + (parts[3] === "1" ? 2 : 0)];
                p = Promise.resolve(pdfDoc.embedStandardFont(PDFLib.StandardFonts[key]));
            } else {
                var url = ref.substring(2);
                p = fetch(url).then(function (r) {
                    if (!r.ok) throw new Error("cannot read " + url);
                    return r.arrayBuffer();
                }).then(function (buf) {
                    return pdfDoc.embedFont(new Uint8Array(buf), { subset: true });
                });
            }
            fontCache[ref] = p.then(function (f) { fontReady[ref] = f; return f; }, function () {
                fontReady[ref] = null;
                return null;
            });
            return fontCache[ref];
        }

        function loadImage(id) {
            if (imageCache[id]) return imageCache[id];
            var spec = (job.images || {})[id] || {};
            var bytesP;
            if (spec.bytes) {
                bytesP = Promise.resolve(spec.bytes);
            } else if (spec.src && spec.src.indexOf("data:") === 0) {
                bytesP = Promise.resolve(base64Bytes(spec.src));
            } else if (spec.src) {
                bytesP = fetch(spec.src).then(function (r) {
                    if (!r.ok) throw new Error("cannot read " + spec.src);
                    return r.arrayBuffer();
                }).then(function (b) { return new Uint8Array(b); });
            } else {
                bytesP = Promise.resolve(null);
            }
            imageCache[id] = bytesP.then(function (bytes) {
                if (!bytes) return null;
                var kind = sniff(bytes);
                if (kind === "jpg") return pdfDoc.embedJpg(bytes);
                if (kind === "png") return pdfDoc.embedPng(bytes);
                return null;
            }).catch(function () { return null; });
            return imageCache[id];
        }

        // everything a page refers to is loaded before it is drawn, so the
        // drawing itself stays synchronous
        function preload(ops) {
            var jobs = [];
            ops.forEach(function (op) {
                if (op[0] === "image") jobs.push(loadImage(op[1]));
                else if (op[0] === "text") op[6].forEach(function (s) { jobs.push(loadFont(s[1])); });
                else if (op[0] === "leader") jobs.push(loadFont(op[7]));
            });
            return Promise.all(jobs);
        }

        function drawPage(page, ops, images) {
            var H = job.sheetH;
            var y = function (top) { return (H - top) * PX; };
            var push = function (list) { page.pushOperators.apply(page, list); };
            ops.forEach(function (op, idx) {
                switch (op[0]) {
                    case "rect":
                        page.drawRectangle({
                            x: op[1] * PX, y: y(op[2] + op[4]), width: op[3] * PX, height: op[4] * PX,
                            color: rgb(op[5]), opacity: op[6]
                        });
                        break;
                    case "frame":
                        page.drawRectangle({
                            x: op[1] * PX, y: y(op[2] + op[4]), width: op[3] * PX, height: op[4] * PX,
                            borderColor: rgb(op[5]), borderWidth: op[6] * PX
                        });
                        break;
                    case "image":
                        var emb = images[idx];
                        if (!emb) break;
                        var b = { x: op[2], y: op[3], w: op[4], h: op[5] };
                        var crop = op[6];
                        push([PDFLib.pushGraphicsState()]);
                        if (crop) {
                            push([
                                PDFLib.moveTo(b.x * PX, y(b.y)), PDFLib.lineTo((b.x + b.w) * PX, y(b.y)),
                                PDFLib.lineTo((b.x + b.w) * PX, y(b.y + b.h)), PDFLib.lineTo(b.x * PX, y(b.y + b.h)),
                                PDFLib.closePath(), PDFLib.clip(), PDFLib.endPath()
                            ]);
                            var kw = 1 - crop.l - crop.r, kh = 1 - crop.t - crop.b;
                            if (kw > 0.001 && kh > 0.001) {
                                var fw = b.w / kw, fh = b.h / kh;
                                b = { x: b.x - crop.l * fw, y: b.y - crop.t * fh, w: fw, h: fh };
                            }
                        }
                        page.drawImage(emb, { x: b.x * PX, y: y(b.y + b.h), width: b.w * PX, height: b.h * PX });
                        push([PDFLib.popGraphicsState()]);
                        break;
                    case "text":
                        drawText(page, op, y, push);
                        break;
                    case "leader":
                        var font = fontReady[op[7]];
                        if (!font) break;
                        var cw = font.widthOfTextAtSize(op[6], op[4]);
                        if (!(cw > 0)) break;
                        var n = Math.floor((op[2] - cw) / cw);
                        if (n < 1) break;
                        page.drawText(new Array(n + 1).join(op[6]), {
                            x: (op[1] + op[2] - n * cw) * PX, y: y(op[3]),
                            size: op[4] * PX, font: font, color: rgb(op[5])
                        });
                        break;
                    case "ellipse":
                        page.drawEllipse(op[6] > 0 ? {
                            x: op[1] * PX, y: y(op[2]), xScale: op[3] * PX, yScale: op[4] * PX,
                            borderColor: rgb(op[5]), borderWidth: op[6] * PX
                        } : {
                            x: op[1] * PX, y: y(op[2]), xScale: op[3] * PX, yScale: op[4] * PX,
                            color: rgb(op[5])
                        });
                        break;
                    case "poly":
                        var pts = op[1];
                        if (pts.length < 4) break;
                        var list = [PDFLib.pushGraphicsState()];
                        list.push(op[3] > 0 ? PDFLib.setStrokingColor(rgb(op[2])) : PDFLib.setFillingColor(rgb(op[2])));
                        if (op[3] > 0) list.push(PDFLib.setLineWidth(op[3] * PX));
                        list.push(PDFLib.moveTo(pts[0] * PX, y(pts[1])));
                        for (var i = 2; i + 1 < pts.length; i += 2) list.push(PDFLib.lineTo(pts[i] * PX, y(pts[i + 1])));
                        list.push(PDFLib.closePath(), op[3] > 0 ? PDFLib.stroke() : PDFLib.fill(), PDFLib.popGraphicsState());
                        push(list);
                        break;
                }
            });
        }

        /* one line fragment, in as many pieces as it takes fonts to spell
           it, squeezed or stretched to the width the browser gave it */
        function drawText(page, op, y, push) {
            var x = op[1], baseline = op[2], size = op[3], col = rgb(op[4]), fitW = op[5];
            var segs = [];
            var total = 0;
            for (var i = 0; i < op[6].length; i++) {
                var s = op[6][i];
                var font = fontReady[s[1]];
                if (!font) return;
                var w = font.widthOfTextAtSize(s[0], size);
                segs.push({ text: s[0], font: font, synthBold: s[2], w: w });
                total += w;
            }
            var scale = 1;
            if (fitW > 0 && total > 0) {
                var ratio = fitW / total;
                // a ratio far from 1 means the measurement, not the font, is
                // wrong (a collapsed space, a transform) - leave it alone
                if (ratio > 0.5 && ratio < 2 && Math.abs(ratio - 1) > 0.005) scale = ratio;
            }
            var cursor = x;
            segs.forEach(function (seg) {
                var ops = [PDFLib.pushGraphicsState()];
                if (scale !== 1) ops.push(PDFLib.setCharacterSqueeze(scale * 100));
                if (seg.synthBold) {
                    ops.push(PDFLib.setTextRenderingMode(PDFLib.TextRenderingMode.FillAndOutline));
                    ops.push(PDFLib.setLineWidth(size / 28 * PX));
                    ops.push(PDFLib.setStrokingColor(col));
                }
                push(ops);
                page.drawText(seg.text, { x: cursor * PX, y: y(baseline), size: size * PX, font: seg.font, color: col });
                push([PDFLib.popGraphicsState()]);
                cursor += seg.w * scale;
            });
            var deco = op[7];
            if (deco) {
                var dw = total * scale || deco[2];
                page.drawRectangle({ x: x * PX, y: y(deco[0] + deco[1]), width: dw * PX, height: deco[1] * PX, color: col });
            }
        }

        function tick() {
            return new Promise(function (res) { setTimeout(res, 0); });
        }

        var total = job.pages.length;
        return PDFLib.PDFDocument.create().then(function (doc) {
            pdfDoc = doc;
            if (opts.fontkit) doc.registerFontkit(opts.fontkit);
            if (job.title) doc.setTitle(job.title);
            doc.setProducer("ArozOS Office");
            var chain = Promise.resolve();
            job.pages.forEach(function (ops, i) {
                chain = chain.then(function () {
                    return preload(ops);
                }).then(function () {
                    return Promise.all(ops.map(function (op) {
                        return op[0] === "image" ? loadImage(op[1]) : null;
                    }));
                }).then(function (images) {
                    var page = pdfDoc.addPage([job.sheetW * PX, job.sheetH * PX]);
                    drawPage(page, ops, images);
                    if (opts.onProgress) opts.onProgress(i + 1, total, "page");
                    return tick();
                });
            });
            return chain;
        }).then(function () {
            if (opts.onProgress) opts.onProgress(total, total, "save");
            return pdfDoc.save({ objectsPerTick: 20 });
        });
    }

    return { render: render };
})();
