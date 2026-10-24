/*
    PDF Editor - building the saved PDF

    The output starts from the original file (so outlines, forms, links,
    attachments and metadata survive) and only touches what the user
    changed:
      - page order: the page tree is rebuilt when pages were added,
        removed, duplicated or moved (pages of other PDFs are copied in);
      - Edit PDF: the replaced text operations are taken out of the page's
        content stream (js/textedit.js); pages where that is not possible
        get the old text covered instead;
      - redaction: the page is rendered to an image with the boxes burnt in
        and its content, resources and annotations are replaced, after
        which every object nothing refers to any more is dropped from the
        file, so the hidden content does not survive anywhere in it;
      - objects and decorations are drawn as real PDF content (text stays
        text) in each object's own coordinate frame, links become link
        annotations, crop sets the CropBox.
    Pages of an encrypted PDF cannot be copied, so they are rendered to
    images.
*/
window.PE = window.PE || {};

(function (PE) {
    'use strict';

    var D = PE.doc;
    var F = PE.fonts;
    var S = PE.save = {};
    var RASTER = 2.5;       //render scale for flattened pages (180 dpi)

    function rgb(L, hex) {
        var c = PE.hexToRgb(hex || '#000000');
        return L.rgb(c.r, c.g, c.b);
    }

    /* Matrix taking the object's local box (origin bottom left, y up, points) to PDF user space */
    function frame(vp, o) {
        var a = (o.angle || 0) * Math.PI / 180;
        var cos = Math.cos(a), sin = Math.sin(a);
        var cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        function map(lx, ly) {
            var dx = lx - o.w / 2, dy = (o.h - ly) - o.h / 2;
            var vx = cx + dx * cos - dy * sin, vy = cy + dx * sin + dy * cos;
            return vp.toPdf(vx, vy);
        }
        var p0 = map(0, 0), px = map(1, 0), py = map(0, 1);
        return [px[0] - p0[0], px[1] - p0[1], py[0] - p0[0], py[1] - p0[1], p0[0], p0[1]];
    }

    /* The four corners of an object (view space) */
    function corners(o) {
        var a = (o.angle || 0) * Math.PI / 180;
        var cos = Math.cos(a), sin = Math.sin(a);
        var cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (s) {
            var dx = s[0] * o.w / 2, dy = s[1] * o.h / 2;
            return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
        });
    }

    function roundRectPath(w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        return 'M' + r + ' 0H' + (w - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + w + ' ' + r + 'V' + (h - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (w - r) + ' ' + h +
            'H' + r + 'A' + r + ' ' + r + ' 0 0 1 0 ' + (h - r) + 'V' + r + 'A' + r + ' ' + r + ' 0 0 1 ' + r + ' 0Z';
    }

    /* ------------------------------------------------------------ builder */
    function Builder(L, out) {
        this.L = L;
        this.out = out;
        this.fonts = {};
        this.images = {};
        this.libBytes = {};
    }

    Builder.prototype.stdFont = function (key, bold, italic) {
        var name = F.stdFontName(key, bold, italic);
        if (!this.fonts[name]) {
            this.fonts[name] = this.out.embedFont(this.L.StandardFonts[name]);
        }
        return this.fonts[name];
    };

    Builder.prototype.libFont = function (family, bold, italic) {
        var face = F.libFace(family, bold, italic);
        if (!face) {
            return Promise.resolve(null);
        }
        var id = 'lib:' + face.file;
        var self = this;
        if (!this.fonts[id]) {
            this.fonts[id] = PE.fetchBytes(F.libFaceUrl(face)).then(function (bytes) {
                return self.out.embedFont(bytes, { subset: true });
            }).catch(function (err) {
                console.warn('[PDF Editor] library font not embeddable', family, err);
                return null;
            });
        }
        return this.fonts[id];
    };

    function covers(pdfFont, text) {
        try {
            var fk = pdfFont.embedder && pdfFont.embedder.font;
            if (!fk || !fk.hasGlyphForCodePoint) {
                return false;
            }
            var chars = Array.from(text.replace(/[\r\n\t]/g, ''));
            for (var i = 0; i < chars.length; i++) {
                if (!fk.hasGlyphForCodePoint(chars[i].codePointAt(0))) {
                    return false;
                }
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    /* The PDF font for a text object, or null when it has to be drawn as a picture */
    Builder.prototype.fontFor = function (o) {
        var self = this;
        var key = o.font || 'helv';
        var all = String(o.text || '');
        if (F.isStd(key)) {
            if (F.encodable(key, all)) {
                return this.stdFont(key, o.bold, o.italic);
            }
            //fall back to a library family that has every character
            var fams = F.libFamilies();
            var chain = Promise.resolve(null);
            fams.forEach(function (fam) {
                chain = chain.then(function (found) {
                    if (found) {
                        return found;
                    }
                    return self.libFont(fam, o.bold, o.italic).then(function (f) {
                        return f && covers(f, all) ? f : null;
                    });
                });
            });
            return chain;
        }
        var fam = F.libFamily(key);
        return this.libFont(fam, o.bold, o.italic).then(function (f) {
            if (f && covers(f, all)) {
                return f;
            }
            if (F.encodable('helv', all)) {
                return self.stdFont('helv', o.bold, o.italic);
            }
            return null;
        });
    };

    Builder.prototype.image = function (assetId) {
        var a = D.assets[assetId];
        if (!a) {
            return Promise.resolve(null);
        }
        if (!this.images[assetId]) {
            this.images[assetId] = a.mime === 'image/jpeg' ? this.out.embedJpg(a.bytes) : this.out.embedPng(a.bytes);
        }
        return this.images[assetId];
    };

    Builder.prototype.pngOf = function (canvas) {
        var self = this;
        return PE.canvasToBlob(canvas, 'image/png').then(PE.readFile).then(function (b) {
            return self.out.embedPng(b);
        });
    };

    /* A text object drawn on a canvas (characters no embeddable font has) */
    function rasterText(o, scale) {
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.ceil(o.w * scale));
        c.height = Math.max(1, Math.ceil(o.h * scale));
        var ctx = c.getContext('2d');
        ctx.scale(scale, scale);
        var L = F.layout(o);
        var bw = o.border ? (o.borderW || 1) : 0;
        if (o.bg) {
            ctx.fillStyle = o.bg;
            ctx.fillRect(bw / 2, bw / 2, o.w - bw, o.h - bw);
        }
        if (o.border) {
            ctx.strokeStyle = o.border;
            ctx.lineWidth = bw;
            ctx.strokeRect(bw / 2, bw / 2, o.w - bw, o.h - bw);
        }
        ctx.fillStyle = o.color || '#000';
        ctx.font = (o.italic ? 'italic ' : '') + (o.bold ? 'bold ' : '') + L.size + 'px ' + F.css(o.font || 'helv');
        ctx.textBaseline = 'alphabetic';
        L.lines.forEach(function (ln, i) {
            var x = F.lineX(o, L, ln), y = F.baseline(L, i);
            ctx.fillText(ln.text, x, y);
            var th = Math.max(0.5, L.size * 0.06);
            if (o.underline) {
                ctx.fillRect(x, y + L.size * 0.1, ln.width, th);
            }
            if (o.strike) {
                ctx.fillRect(x, y - L.size * 0.3, ln.width, th);
            }
        });
        return c;
    }

    /* Draw one object onto a pdf-lib page */
    Builder.prototype.draw = function (pg, vp, o) {
        var L = this.L;
        var self = this;
        var op = o.opacity === undefined ? 1 : o.opacity;
        var w = o.w, h = o.h;
        function begin(obj) {
            var m = frame(vp, obj || o);
            pg.pushOperators(L.pushGraphicsState(), L.concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]));
        }
        function end() {
            pg.pushOperators(L.popGraphicsState());
        }
        switch (o.type) {
            case 'text': {
                return this.fontFor(o).then(function (font) {
                    var Lay = F.layout(o);
                    if (!font) {
                        return self.pngOf(rasterText(o, 4)).then(function (img) {
                            begin();
                            pg.drawImage(img, { x: 0, y: 0, width: w, height: h, opacity: op });
                            end();
                        });
                    }
                    begin();
                    var bw = o.border ? (o.borderW || 1) : 0;
                    if (o.bg || o.border) {
                        if (o.radius) {
                            pg.drawSvgPath(roundRectPath(w - bw, h - bw, o.radius), {
                                x: bw / 2, y: h - bw / 2, opacity: op, borderOpacity: op, borderWidth: bw,
                                color: o.bg ? rgb(L, o.bg) : undefined, borderColor: o.border ? rgb(L, o.border) : undefined
                            });
                        } else {
                            pg.drawRectangle({
                                x: bw / 2, y: bw / 2, width: Math.max(0, w - bw), height: Math.max(0, h - bw),
                                color: o.bg ? rgb(L, o.bg) : undefined, borderColor: o.border ? rgb(L, o.border) : undefined,
                                borderWidth: bw, opacity: op, borderOpacity: op
                            });
                        }
                    }
                    var col = rgb(L, o.color);
                    Lay.lines.forEach(function (ln, i) {
                        var base = F.baseline(Lay, i);
                        var tw = ln.width;
                        var x = F.lineX(o, Lay, ln);
                        if (o.align === 'center' || o.align === 'right') {
                            //place by the width the PDF font really has
                            try {
                                tw = font.widthOfTextAtSize(ln.text, Lay.size);
                            } catch (e) {
                                tw = ln.width;
                            }
                            var inner = Lay.width - 2 * Lay.pad;
                            x = Lay.pad + (o.align === 'center' ? (inner - tw) / 2 : inner - tw);
                        }
                        if (ln.text) {
                            pg.drawText(ln.text, { x: x, y: h - base, size: Lay.size, font: font, color: col, opacity: op });
                        }
                        var th = Math.max(0.5, Lay.size * 0.06);
                        if (o.underline && tw > 0) {
                            pg.drawRectangle({ x: x, y: h - (base + Lay.size * 0.1 + th), width: tw, height: th, color: col, opacity: op });
                        }
                        if (o.strike && tw > 0) {
                            pg.drawRectangle({ x: x, y: h - (base - Lay.size * 0.3 + th), width: tw, height: th, color: col, opacity: op });
                        }
                    });
                    end();
                });
            }
            case 'image':
                return this.image(o.asset).then(function (img) {
                    if (!img) {
                        return;
                    }
                    begin();
                    pg.drawImage(img, { x: 0, y: 0, width: w, height: h, opacity: op });
                    end();
                });
            case 'rect':
            case 'ellipse': {
                var sw = o.stroke ? (o.sw || 0) : 0;
                var opts = {
                    color: o.fill ? rgb(L, o.fill) : undefined,
                    borderColor: o.stroke && sw ? rgb(L, o.stroke) : undefined,
                    borderWidth: sw, opacity: op, borderOpacity: op,
                    borderDashArray: o.dash && sw ? [sw * 3, sw * 2] : undefined
                };
                if (!opts.color && !opts.borderColor) {
                    return Promise.resolve();
                }
                begin();
                if (o.type === 'ellipse') {
                    opts.x = w / 2;
                    opts.y = h / 2;
                    opts.xScale = Math.max(0, (w - sw) / 2);
                    opts.yScale = Math.max(0, (h - sw) / 2);
                    pg.drawEllipse(opts);
                } else if (o.radius) {
                    opts.x = sw / 2;
                    opts.y = h - sw / 2;
                    pg.drawSvgPath(roundRectPath(w - sw, h - sw, o.radius), opts);
                } else {
                    opts.x = sw / 2;
                    opts.y = sw / 2;
                    opts.width = Math.max(0, w - sw);
                    opts.height = Math.max(0, h - sw);
                    pg.drawRectangle(opts);
                }
                end();
                return Promise.resolve();
            }
            case 'line': {
                var lw = o.sw || 1;
                var ah = PE.objs.arrowSize(o);
                var x0 = o.arrow === 'both' ? ah * 0.8 : 0;
                var x1 = o.arrow === 'end' || o.arrow === 'both' ? w - ah * 0.8 : w;
                var col2 = rgb(L, o.stroke);
                begin();
                pg.drawLine({
                    start: { x: x0, y: h / 2 }, end: { x: Math.max(x0, x1), y: h / 2 }, thickness: lw, color: col2, opacity: op,
                    dashArray: o.dash ? [lw * 3, lw * 2] : undefined, lineCap: o.dash ? L.LineCapStyle.Butt : L.LineCapStyle.Round
                });
                var hy = h / 2;
                if (o.arrow === 'end' || o.arrow === 'both') {
                    pg.drawSvgPath('M' + w + ' ' + hy + 'L' + (w - ah) + ' ' + (hy - ah * 0.45) + 'L' + (w - ah) + ' ' + (hy + ah * 0.45) + 'Z', { x: 0, y: h, color: col2, opacity: op });
                }
                if (o.arrow === 'both') {
                    pg.drawSvgPath('M0 ' + hy + 'L' + ah + ' ' + (hy - ah * 0.45) + 'L' + ah + ' ' + (hy + ah * 0.45) + 'Z', { x: 0, y: h, color: col2, opacity: op });
                }
                end();
                return Promise.resolve();
            }
            case 'ink':
                begin();
                pg.pushOperators(L.setLineJoin(L.LineJoinStyle.Round));
                pg.drawSvgPath(PE.objs.inkPath(o), {
                    x: 0, y: h, borderColor: rgb(L, o.stroke), borderWidth: o.sw || 1, borderOpacity: op, borderLineCap: L.LineCapStyle.Round
                });
                end();
                return Promise.resolve();
            case 'markup': {
                var hl = o.kind === 'highlight';
                PE.objs.markupShapes(o).forEach(function (r) {
                    var ro = { x: r.x, y: r.y, w: r.w, h: r.h, angle: 0 };
                    begin(ro);
                    pg.drawRectangle({
                        x: 0, y: 0, width: r.w, height: r.h, color: rgb(L, o.color), opacity: hl ? 0.45 : 1,
                        blendMode: hl ? L.BlendMode.Multiply : undefined
                    });
                    end();
                });
                return Promise.resolve();
            }
            case 'redact':
                begin();
                pg.drawRectangle({ x: 0, y: 0, width: w, height: h, color: L.rgb(0, 0, 0) });
                end();
                return Promise.resolve();
            case 'cover':
                begin();
                pg.drawRectangle({ x: -0.6, y: -0.6, width: w + 1.2, height: h + 1.2, color: rgb(L, o.fill) });
                end();
                return Promise.resolve();
            default:
                return Promise.resolve();
        }
    };

    Builder.prototype.link = function (pg, vp, o) {
        var L = this.L;
        var pts = corners(o).map(function (q) { return vp.toPdf(q[0], q[1]); });
        var xs = pts.map(function (q) { return q[0]; }), ys = pts.map(function (q) { return q[1]; });
        var dict = {
            Type: 'Annot', Subtype: 'Link',
            Rect: [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)],
            Border: [0, 0, 0]
        };
        if (o.url) {
            dict.A = this.out.context.obj({ Type: 'Action', S: 'URI', URI: L.PDFString.of(o.url) });
        } else if (o.page >= 0 && o.page < this.out.getPageCount()) {
            dict.Dest = this.out.context.obj([this.out.getPage(o.page).ref, L.PDFName.of('Fit')]);
        } else {
            return;
        }
        var ref = this.out.context.register(this.out.context.obj(dict));
        pg.node.addAnnot(ref);
    };

    /* ------------------------------------------------------------ page rendering */
    function renderSource(p, scale, rotation) {
        return D.sources[p.s].pdf.getPage(p.i + 1).then(function (page) {
            var vp = page.getViewport({ scale: scale, rotation: rotation });
            var c = document.createElement('canvas');
            c.width = Math.max(1, Math.ceil(vp.width));
            c.height = Math.max(1, Math.ceil(vp.height));
            return page.render({ canvasContext: c.getContext('2d'), viewport: vp, intent: 'print' }).promise.then(function () {
                return { canvas: c, vp: vp };
            });
        });
    }

    /* Render page p unrotated with its Edit PDF areas and redactions burnt in */
    function flatCanvas(p) {
        return renderSource(p, RASTER, 0).then(function (r) {
            var ctx = r.canvas.getContext('2d');
            var vpv = new D.Viewport(p.view, D.totalRot(p), 1);
            function toCanvas(x, y) {
                var u = vpv.toPdf(x, y);
                return r.vp.convertToViewportPoint(u[0], u[1]);
            }
            (p.edits || []).forEach(function (ed) {
                ctx.fillStyle = ed.bg || '#ffffff';
                ed.boxes.forEach(function (b) {
                    var a = toCanvas(b.x, b.y), c = toCanvas(b.x + b.w, b.y + b.h);
                    ctx.fillRect(Math.min(a[0], c[0]) - 2, Math.min(a[1], c[1]) - 2, Math.abs(c[0] - a[0]) + 4, Math.abs(c[1] - a[1]) + 4);
                });
            });
            ctx.fillStyle = '#000000';
            p.objs.forEach(function (o) {
                if (o.type !== 'redact') {
                    return;
                }
                var pts = corners(o).map(function (q) { return toCanvas(q[0], q[1]); });
                ctx.beginPath();
                ctx.moveTo(pts[0][0], pts[0][1]);
                for (var i = 1; i < pts.length; i++) {
                    ctx.lineTo(pts[i][0], pts[i][1]);
                }
                ctx.closePath();
                ctx.fill();
            });
            return r.canvas;
        });
    }

    /* Replace a page's content with a picture of it */
    Builder.prototype.flatten = function (pg, p, canvas) {
        var L = this.L, out = this.out, ctx = out.context;
        return PE.canvasToBlob(canvas, 'image/jpeg', 0.9).then(PE.readFile).then(function (jpg) {
            return out.embedJpg(jpg);
        }).then(function (img) {
            pg.node.set(L.PDFName.of('Contents'), ctx.obj([]));
            pg.node.set(L.PDFName.of('Resources'), ctx.obj({ Font: {}, XObject: {}, ExtGState: {} }));
            pg.node.delete(L.PDFName.of('Annots'));
            pg.node.delete(L.PDFName.of('Group'));
            pg.node.normalize();
            var v = p.view;
            pg.drawImage(img, { x: v[0], y: v[1], width: v[2] - v[0], height: v[3] - v[1] });
        });
    };

    /* Drop every indirect object nothing refers to (after redaction / page removal) */
    function collectGarbage(L, out) {
        var ctx = out.context;
        var seen = {};
        var stack = [];
        var ti = ctx.trailerInfo || {};
        ['Root', 'Info', 'Encrypt', 'ID'].forEach(function (k) {
            if (ti[k]) {
                stack.push(ti[k]);
            }
        });
        while (stack.length) {
            var obj = stack.pop();
            if (!obj) {
                continue;
            }
            if (obj instanceof L.PDFRef) {
                if (seen[obj.tag]) {
                    continue;
                }
                seen[obj.tag] = true;
                stack.push(ctx.lookup(obj));
            } else if (obj instanceof L.PDFDict) {
                obj.entries().forEach(function (e) {
                    stack.push(e[1]);
                });
            } else if (obj instanceof L.PDFArray) {
                obj.asArray().forEach(function (e) {
                    stack.push(e);
                });
            } else if (obj instanceof L.PDFStream) {
                stack.push(obj.dict);
            }
        }
        var removed = 0;
        ctx.enumerateIndirectObjects().forEach(function (pair) {
            if (!seen[pair[0].tag]) {
                ctx.delete(pair[0]);
                removed++;
            }
        });
        return removed;
    }

    function inheritAttrs(L, pg) {
        ['MediaBox', 'CropBox', 'Resources', 'Rotate'].forEach(function (k) {
            var name = L.PDFName.of(k);
            if (!pg.node.get(name)) {
                var v = pg.node.getInheritableAttribute(name);
                if (v) {
                    pg.node.set(name, v);
                }
            }
        });
    }

    /* Move the content stream pdf-lib last appended to the front (drawn first) */
    function sendLastStreamToBack(L, pg) {
        var contents = pg.node.Contents();
        if (contents instanceof L.PDFArray && contents.size() > 1) {
            var last = contents.get(contents.size() - 1);
            contents.remove(contents.size() - 1);
            contents.insert(0, last);
        }
        pg.contentStream = undefined;
        pg.contentStreamRef = undefined;
    }

    /*
        Build the edited document. progress(fraction, message) is optional.
        Resolves with the PDF bytes.
    */
    S.build = function (progress) {
        progress = progress || function () {};
        if (PE.objs) {
            PE.objs.commitEdit();
        }
        var L, out, B;
        var baseIsSource = false;
        var libSrc = {};
        var needGc = false;
        return Promise.all([PE.libs.pdflib(), PE.libs.fontkit()]).then(function (r) {
            L = r[0];
            var fk = r[1];
            var usesFirst = D.pages.some(function (p) { return p.s === 0; });
            var start;
            if (D.sources.length && usesFirst && !D.sources[0].encrypted) {
                baseIsSource = true;
                start = L.PDFDocument.load(D.sources[0].bytes, { ignoreEncryption: true, updateMetadata: false });
            } else {
                start = L.PDFDocument.create();
            }
            return start.then(function (doc) {
                out = doc;
                out.registerFontkit(fk);
                B = new Builder(L, out);
                if (baseIsSource) {
                    libSrc[0] = out;
                }
            });
        }).then(function () {
            //pick or create the page objects in their new order
            var orig = baseIsSource ? out.getPages() : [];
            var taken = {};
            var list = [];
            var chain = Promise.resolve();
            D.pages.forEach(function (p, k) {
                chain = chain.then(function () {
                    progress(k / D.pages.length * 0.3, PE.T('save/pages', 'Preparing pages...'));
                    if (p.s < 0) {
                        var bp = L.PDFPage.create(out);
                        bp.setMediaBox(p.view[0], p.view[1], p.view[2] - p.view[0], p.view[3] - p.view[1]);
                        list.push(bp);
                        return;
                    }
                    var src = D.sources[p.s];
                    if (src.encrypted) {
                        return renderSource(p, RASTER, 0).then(function (rr) {
                            var np = L.PDFPage.create(out);
                            np.setMediaBox(p.view[0], p.view[1], p.view[2] - p.view[0], p.view[3] - p.view[1]);
                            if (p.rot0) {
                                np.setRotation(L.degrees(p.rot0));
                            }
                            list.push(np);
                            return B.pngOf(rr.canvas).then(function (img) {
                                np.drawImage(img, { x: p.view[0], y: p.view[1], width: p.view[2] - p.view[0], height: p.view[3] - p.view[1] });
                                np.contentStream = undefined;
                                np.contentStreamRef = undefined;
                            });
                        });
                    }
                    if (p.s === 0 && baseIsSource && !taken[p.i]) {
                        taken[p.i] = true;
                        list.push(orig[p.i]);
                        return;
                    }
                    var getSrc = libSrc[p.s] ? Promise.resolve(libSrc[p.s]) :
                        L.PDFDocument.load(src.bytes, { ignoreEncryption: true, updateMetadata: false }).then(function (d) {
                            libSrc[p.s] = d;
                            return d;
                        });
                    return getSrc.then(function (sd) {
                        return out.copyPages(sd, [p.i]);
                    }).then(function (copied) {
                        list.push(copied[0]);
                    });
                });
            });
            return chain.then(function () {
                var same = baseIsSource && list.length === orig.length && list.every(function (pg, i) { return pg === orig[i]; });
                if (!same) {
                    needGc = true;
                    orig.forEach(function (pg) {
                        inheritAttrs(L, pg);
                    });
                    for (var i = out.getPageCount() - 1; i >= 0; i--) {
                        out.removePage(i);
                    }
                    list.forEach(function (pg) {
                        out.addPage(pg);
                    });
                }
                return list;
            });
        }).then(function (list) {
            var chain = Promise.resolve();
            var links = [];
            D.pages.forEach(function (p, k) {
                chain = chain.then(function () {
                    progress(0.3 + k / D.pages.length * 0.6, PE.T('save/drawing', 'Writing page {n} of {total}...', { n: k + 1, total: D.pages.length }));
                    return buildPage(L, B, out, list[k], p, k, links).then(function (gc) {
                        if (gc) {
                            needGc = true;
                        }
                    });
                });
            });
            return chain.then(function () {
                links.forEach(function (l) {
                    B.link(l.pg, l.vp, l.o);
                });
            });
        }).then(function () {
            progress(0.92, PE.T('save/finishing', 'Finishing...'));
            var m = D.meta || {};
            out.setTitle(m.title || '');
            out.setAuthor(m.author || '');
            out.setSubject(m.subject || '');
            out.setKeywords(m.keywords ? [m.keywords] : []);
            if (m.creator) {
                out.setCreator(m.creator);
            } else if (!baseIsSource) {
                out.setCreator('ArozOS PDF Editor');
            }
            out.setProducer('ArozOS PDF Editor (pdf-lib)');
            var created = m.created ? new Date(m.created) : new Date();
            if (!isNaN(created.getTime())) {
                out.setCreationDate(created);
            }
            out.setModificationDate(new Date());
            var att = Promise.resolve();
            (D.attach || []).forEach(function (a) {
                var asset = D.assets[a.asset];
                if (!asset) {
                    return;
                }
                att = att.then(function () {
                    return out.attach(asset.bytes, a.name, { mimeType: asset.mime || 'application/octet-stream', creationDate: new Date(), modificationDate: new Date() });
                });
            });
            return att;
        }).then(function () {
            if (needGc) {
                collectGarbage(L, out);
            }
            return out.save({ useObjectStreams: true, updateFieldAppearances: false });
        }).then(function (bytes) {
            progress(1, '');
            return bytes;
        });
    };

    function buildPage(L, B, out, pg, p, k, links) {
        var rot = D.totalRot(p);
        var vp = new D.Viewport(p.view, rot, 1);
        var gc = false;
        if (p.s >= 0 && (p.rot || 0) !== 0) {
            pg.setRotation(L.degrees(rot));
        } else if (p.s < 0 && rot) {
            pg.setRotation(L.degrees(rot));
        }
        var hasRedact = p.objs.some(function (o) { return o.type === 'redact'; });
        var covers = [];
        var step = Promise.resolve();
        if (p.s >= 0 && !D.sources[p.s].encrypted && hasRedact) {
            gc = true;
            step = flatCanvas(p).then(function (c) {
                return B.flatten(pg, p, c);
            });
        } else if (p.s >= 0 && !D.sources[p.s].encrypted && p.edits && p.edits.length) {
            var ok = PE.textedit.rewrite(out, pg, p);
            if (ok) {
                gc = true;
            }
            p.edits.forEach(function (ed) {
                if (!ok || !ed.precise) {
                    ed.boxes.forEach(function (b) {
                        covers.push({ type: 'cover', x: b.x, y: b.y, w: b.w, h: b.h, angle: 0, fill: ed.bg || '#ffffff' });
                    });
                }
            });
        } else if (p.edits && p.edits.length) {
            //encrypted source (already a picture): cover the old text
            p.edits.forEach(function (ed) {
                ed.boxes.forEach(function (b) {
                    covers.push({ type: 'cover', x: b.x, y: b.y, w: b.w, h: b.h, angle: 0, fill: ed.bg || '#ffffff' });
                });
            });
        }
        var deco = PE.deco.objectsFor(k);
        var drawList = function (objs) {
            var c = Promise.resolve();
            objs.forEach(function (o) {
                c = c.then(function () {
                    return B.draw(pg, vp, o);
                });
            });
            return c;
        };
        return step.then(function () {
            pg.node.normalize();
            if (deco.under.length) {
                return drawList(deco.under).then(function () {
                    sendLastStreamToBack(L, pg);
                });
            }
        }).then(function () {
            return drawList(covers);
        }).then(function () {
            return drawList(p.objs.filter(function (o) {
                if (o.type === 'link') {
                    links.push({ pg: pg, vp: vp, o: o });
                    return false;
                }
                //on flattened pages the redaction is already in the picture
                return !(o.type === 'redact' && hasRedact && p.s >= 0 && !D.sources[p.s].encrypted);
            }));
        }).then(function () {
            return drawList(deco.over);
        }).then(function () {
            if (p.crop) {
                var a = vp.toPdf(p.crop.x, p.crop.y), b = vp.toPdf(p.crop.x + p.crop.w, p.crop.y + p.crop.h);
                var x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]);
                pg.setCropBox(x0, y0, Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
            }
            return gc;
        });
    }

    /* ------------------------------------------------------------ actions */
    function withBusy(msg, job) {
        var b = PE.busy(msg);
        return job(function (frac, m) {
            b.set(m || null, frac);
        }).then(function (r) {
            b.close();
            return r;
        }, function (err) {
            b.close();
            throw err;
        });
    }

    S.withBusy = withBusy;

    function fail(err) {
        console.error('[PDF Editor] save failed', err);
        PE.alert(PE.T('save/failTitle', 'Could not save'), (err && err.message) || String(err));
    }

    function writeTo(vpath) {
        var dir = PE.dirOf(vpath), name = PE.baseName(vpath);
        return withBusy(PE.T('save/saving', 'Saving...'), function (prog) {
            return S.build(prog).then(function (bytes) {
                prog(0.97, PE.T('save/uploading', 'Uploading...'));
                return PE.upload(new Blob([bytes], { type: 'application/pdf' }), name, dir).then(function () {
                    return bytes;
                });
            });
        }).then(function (bytes) {
            D.path = vpath;
            D.name = name;
            D.size = bytes.length;
            D.markClean();
            PE.app && PE.app.addRecent(vpath, name);
            D.emit('saved');
            PE.toast(PE.T('save/saved', 'Saved to {path}', { path: vpath }));
            return true;
        }).catch(function (err) {
            fail(err);
            return false;
        });
    }

    S.save = function () {
        if (!D.loaded) {
            return Promise.resolve(false);
        }
        if (!PE.hasBackend) {
            return S.download();
        }
        if (!D.path) {
            return S.saveAs();
        }
        return writeTo(D.path);
    };

    S.saveAs = function () {
        if (!D.loaded) {
            return Promise.resolve(false);
        }
        if (!PE.hasBackend) {
            return S.download();
        }
        var def = D.name && /\.pdf$/i.test(D.name) ? D.name : PE.stem(D.name || 'document') + '.pdf';
        return PE.pickServer({ type: 'new', root: D.path ? PE.dirOf(D.path) : 'user:/Desktop', defaultName: def, filter: ['pdf'], key: 'save' }).then(function (files) {
            if (!files.length) {
                return false;
            }
            var fp = files[0].filepath;
            if (!/\.pdf$/i.test(fp)) {
                fp += '.pdf';
            }
            return writeTo(fp);
        });
    };

    S.download = function () {
        if (!D.loaded) {
            return Promise.resolve(false);
        }
        return withBusy(PE.T('save/preparing', 'Preparing the PDF...'), S.build).then(function (bytes) {
            var name = /\.pdf$/i.test(D.name || '') ? D.name : PE.stem(D.name || 'document') + '.pdf';
            PE.downloadBytes(bytes, name, 'application/pdf');
            if (!PE.hasBackend) {
                D.markClean();
            }
            return true;
        }).catch(function (err) {
            fail(err);
            return false;
        });
    };

    S.print = function () {
        if (!D.loaded) {
            return;
        }
        withBusy(PE.T('save/preparingPrint', 'Preparing to print...'), S.build).then(function (bytes) {
            var url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
            var frame = document.createElement('iframe');
            frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0';
            frame.src = url;
            frame.onload = function () {
                setTimeout(function () {
                    try {
                        frame.contentWindow.focus();
                        frame.contentWindow.print();
                    } catch (e) {
                        window.open(url, '_blank');
                    }
                }, 300);
                setTimeout(function () {
                    if (frame.parentNode) {
                        frame.parentNode.removeChild(frame);
                    }
                    URL.revokeObjectURL(url);
                }, 120000);
            };
            document.body.appendChild(frame);
        }).catch(fail);
    };
})(window.PE);
