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

    A page may instead be a recording, { size: [w, h] (pt), calls: [...] },
    made by recorder() below: the pdf-lib page calls an exporter made (Slides
    draws with pdf-lib directly), written down as data and made again here.
    A font is named "k:<standard font>" or "f:<url of a shipped face>", a
    picture by its id in job.images.

    Usage:
        OfficePdfDraw.render(job, { fontkit, onProgress }) -> Promise<Uint8Array>
        OfficePdfDraw.run(job, { onProgress, loadFontkit })  (in the page:
            renders in a worker, or here when no worker can start)
        var rec = OfficePdfDraw.recorder();   (in the page)
            rec.addPage([w, h]) -> a stand-in for a pdf-lib PDFPage
            rec.embed(src)      -> Promise<picture handle> for drawImage
            rec.job(title)      -> the job
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
            if (ref.indexOf("k:") === 0) {
                p = Promise.resolve(pdfDoc.embedStandardFont(PDFLib.StandardFonts[ref.substring(2)]));
            } else if (ref.indexOf("s:") === 0) {
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
                // a recording names what it could not check: try it as a PNG
                return spec.guess ? pdfDoc.embedPng(bytes) : null;
            }).catch(function () { return null; }).then(function (img) {
                imageReady[id] = img;
                return img;
            });
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

        /* ---- recorded pages ---- */

        // what a recorded argument refers to: fonts and pictures by name
        function refsIn(v, fonts, images) {
            if (!v || typeof v !== "object") return;
            if (v.__font) { fonts.push(v.__font); return; }
            if (v.__img) { images.push(v.__img); return; }
            if (Array.isArray(v)) { v.forEach(function (x) { refsIn(x, fonts, images); }); return; }
            for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) refsIn(v[k], fonts, images);
        }
        function preloadCalls(calls) {
            var fonts = [], images = [];
            calls.forEach(function (c) { refsIn(c, fonts, images); });
            return Promise.all(fonts.map(loadFont).concat(images.map(loadImage)));
        }
        function decode(v) {
            if (!v || typeof v !== "object") return v;
            if (v.__font) return fontReady[v.__font];
            if (v.__img) return imageReady[v.__img];
            if (Array.isArray(v)) return v.map(decode);
            var out = {};
            for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = decode(v[k]);
            return out;
        }
        function replay(page, calls) {
            var gs = {};
            calls.forEach(function (c) {
                switch (c[0]) {
                    case "ops":
                        // operator arguments were kept as the text they write
                        page.pushOperators.apply(page, c[1].map(function (o) {
                            return PDFLib.PDFOperator.of(o[0], o[1]);
                        }));
                        break;
                    case "alpha":
                        if (!gs[c[1]]) {
                            var ref = pdfDoc.context.register(pdfDoc.context.obj({ Type: "ExtGState", ca: c[2], CA: c[2] }));
                            page.node.setExtGState(PDFLib.PDFName.of(c[1]), ref);
                            gs[c[1]] = true;
                        }
                        break;
                    case "drawImage":
                        var img = imageReady[c[1].__img];
                        if (img) page.drawImage(img, decode(c[2]));
                        break;
                    case "drawText":
                        var o = decode(c[2]);
                        if (o.font) page.drawText(c[1], o);
                        break;
                    case "drawSvgPath":
                        page.drawSvgPath(c[1], decode(c[2]));
                        break;
                    default:
                        if (typeof page[c[0]] === "function") page[c[0]](decode(c[1]));
                }
            });
        }
        var imageReady = {};

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
                if (!Array.isArray(ops)) {
                    chain = chain.then(function () {
                        return preloadCalls(ops.calls);
                    }).then(function () {
                        replay(pdfDoc.addPage(ops.size), ops.calls);
                        if (opts.onProgress) opts.onProgress(i + 1, total, "page");
                        return tick();
                    });
                    return;
                }
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

    /* ---------------- recording (in the page) ---------------- */

    function encodeArg(v) {
        if (v === undefined || v === null || typeof v !== "object") return v;
        if (v.__ref) return { __font: v.__ref };
        if (v.__img) return { __img: v.__img };
        if (Array.isArray(v)) return v.map(encodeArg);
        var out = {};
        for (var k in v) {
            if (!Object.prototype.hasOwnProperty.call(v, k) || v[k] === undefined) continue;
            out[k] = encodeArg(v[k]);
        }
        return out;
    }

    function recorder() {
        var pages = [];
        var images = {};
        var bySrc = {};
        var seq = 0;
        function RecPage(calls) {
            this.calls = calls;
            this.node = {};
        }
        ["drawRectangle", "drawLine", "drawCircle", "drawEllipse", "drawSquare"].forEach(function (m) {
            RecPage.prototype[m] = function (o) { this.calls.push([m, encodeArg(o)]); };
        });
        RecPage.prototype.drawText = function (text, o) { this.calls.push(["drawText", String(text), encodeArg(o)]); };
        RecPage.prototype.drawImage = function (img, o) {
            if (img && img.__img) this.calls.push(["drawImage", { __img: img.__img }, encodeArg(o)]);
        };
        RecPage.prototype.drawSvgPath = function (d, o) { this.calls.push(["drawSvgPath", String(d), encodeArg(o)]); };
        RecPage.prototype.pushOperators = function () {
            var list = [];
            for (var i = 0; i < arguments.length; i++) {
                var op = arguments[i];
                // PDFOperator writes each argument with String(); keeping
                // that text keeps the content stream byte for byte
                list.push([op.name, (op.args || []).map(function (a) { return String(a); })]);
            }
            this.calls.push(["ops", list]);
        };
        RecPage.prototype.recordAlpha = function (key, a) { this.calls.push(["alpha", key, a]); };

        return {
            addPage: function (size) {
                var calls = [];
                pages.push({ size: size, calls: calls });
                return new RecPage(calls);
            },
            // a picture is named, not embedded: the worker embeds it once
            embed: function (src) {
                if (!src) return Promise.resolve(null);
                if (bySrc[src]) return Promise.resolve(bySrc[src]);
                var id = "p" + (seq++);
                var abs = src;
                if (src.indexOf("data:") !== 0) {
                    try { abs = new URL(src, document.baseURI).href; } catch (e) { abs = src; }
                }
                images[id] = { src: abs, guess: true };
                bySrc[src] = { __img: id };
                return Promise.resolve(bySrc[src]);
            },
            job: function (title) {
                return { title: title || "", images: images, pages: pages };
            }
        };
    }

    /* ---------------- running a job (in the page) ---------------- */

    var WORKER_URL = "../common/pdfworker.js";

    /* The worker is where the time goes (pictures, fonts, compression).
       When one cannot be started at all - an old browser, a page opened
       from disk - the same code runs in the page instead, just less
       politely. */
    function run(job, o) {
        o = o || {};
        return new Promise(function (resolve, reject) {
            var worker;
            var started = false;
            function inPage() {
                var fk = o.loadFontkit ? o.loadFontkit() : Promise.resolve(self.fontkit);
                fk.then(function (kit) {
                    return render(job, { fontkit: kit, onProgress: o.onProgress });
                }).then(resolve, reject);
            }
            try {
                worker = new Worker(WORKER_URL);
            } catch (e) {
                inPage();
                return;
            }
            worker.onmessage = function (e) {
                var m = e.data || {};
                started = true;
                if (m.type === "progress") {
                    if (o.onProgress) o.onProgress(m.done, m.total, m.stage);
                } else if (m.type === "done") {
                    worker.terminate();
                    resolve(m.bytes);
                } else if (m.type === "error") {
                    worker.terminate();
                    reject(new Error(m.message || "the PDF could not be written"));
                }
            };
            worker.onerror = function (e) {
                if (e && e.preventDefault) e.preventDefault();
                worker.terminate();
                if (!started) inPage();
                else reject(new Error((e && e.message) || "the PDF worker failed"));
            };
            var transfer = [];
            Object.keys(job.images || {}).forEach(function (id) {
                var b = job.images[id].bytes;
                if (b && b.buffer && transfer.indexOf(b.buffer) < 0) transfer.push(b.buffer);
            });
            worker.postMessage({ job: job }, transfer);
        });
    }

    return { render: render, recorder: recorder, run: run };
})();
