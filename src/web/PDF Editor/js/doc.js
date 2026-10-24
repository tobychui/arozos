/*
    PDF Editor - document model

    The editor never changes the PDF it opened. It keeps the original
    bytes (one "source" per PDF the document draws pages from) and a model
    of what the user did, and builds a new file from both when saving
    (js/save.js). That keeps every save lossless and lets undo reach back
    past a save.

    Model
        sources[s]  {name, bytes, pdf (pdf.js), info[i] {view, rotate}, encrypted}
        pages[k]    {id, s, i, view [x0,y0,x1,y1], rot0, rot, crop, objs[], edits[]}
                    s/i = source and page index (s = -1 for a blank page);
                    view = the page box in PDF user space; rot0 = the page's
                    own /Rotate, rot = the turn added here (0/90/180/270).
        meta        {title, author, subject, keywords, creator, producer, created, modified}
        deco        {hf, pn, wm, bg} - header & footer, page numbers, watermark, background
        attach[]    files to attach {id, name, asset}
        assets{id}  {bytes, mime, url, w, h} - images used by objects (never in undo)

    Geometry lives in "view space": points, origin at the top left of the
    page as it is shown (all rotation applied, crop ignored). Rotating a
    page turns everything on it with the page.

    Objects: {id, type, x, y, w, h, angle, opacity, ...type fields}
        text    text font size color bold italic underline strike align lh wrap bg border borderW radius pad
        image   asset
        rect / ellipse   stroke fill sw dash
        line    stroke sw dash arrow ('none' | 'end' | 'both') - drawn along the box's middle
        ink     pts [[nx, ny]...] (0..1 of the box) stroke sw
        markup  kind ('highlight' | 'underline' | 'strike') rects [{x,y,w,h}] color
        redact  (content under it is removed when saving)
        link    url | page
    edits[]: text of the original page taken out by Edit PDF
        {ops: [{n, rep}], boxes: [{x,y,w,h}], bg}
*/
window.PE = window.PE || {};

(function (PE) {
    'use strict';

    var D = PE.doc = {
        sources: [],
        pages: [],
        meta: {},
        deco: { hf: null, pn: null, wm: null, bg: null },
        attach: [],
        assets: {},
        path: null,
        name: '',
        size: 0,
        dirty: false,
        loaded: false,
        version: '',
        outline: null,
        fileAttachments: null
    };

    /* ------------------------------------------------------------ events */
    var handlers = {};
    D.on = function (evt, fn) {
        (handlers[evt] = handlers[evt] || []).push(fn);
    };
    D.emit = function (evt, data) {
        (handlers[evt] || []).forEach(function (fn) {
            try {
                fn(data);
            } catch (e) {
                console.error('[PDF Editor] ' + evt + ' handler failed', e);
            }
        });
    };

    /* ------------------------------------------------------------ geometry */
    function Viewport(view, rotation, scale) {
        //the same transform pdf.js's PageViewport builds (offset 0, no flip)
        var cx = (view[2] + view[0]) / 2, cy = (view[3] + view[1]) / 2;
        rotation = ((rotation % 360) + 360) % 360;
        var a, b, c, d;
        switch (rotation) {
            case 180: a = -1; b = 0; c = 0; d = 1; break;
            case 90: a = 0; b = 1; c = 1; d = 0; break;
            case 270: a = 0; b = -1; c = -1; d = 0; break;
            default: a = 1; b = 0; c = 0; d = -1;
        }
        var ox, oy, w, h;
        if (a === 0) {
            ox = Math.abs(cy - view[1]) * scale;
            oy = Math.abs(cx - view[0]) * scale;
            w = Math.abs(view[3] - view[1]) * scale;
            h = Math.abs(view[2] - view[0]) * scale;
        } else {
            ox = Math.abs(cx - view[0]) * scale;
            oy = Math.abs(cy - view[1]) * scale;
            w = Math.abs(view[2] - view[0]) * scale;
            h = Math.abs(view[3] - view[1]) * scale;
        }
        this.transform = [a * scale, b * scale, c * scale, d * scale,
            ox - a * scale * cx - c * scale * cy, oy - b * scale * cx - d * scale * cy];
        this.width = w;
        this.height = h;
        this.scale = scale;
        this.rotation = rotation;
        this.view = view;
    }
    Viewport.prototype.toView = function (x, y) {
        var m = this.transform;
        return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    };
    Viewport.prototype.toPdf = function (x, y) {
        var m = this.transform;
        var det = m[0] * m[3] - m[1] * m[2];
        var xt = x - m[4], yt = y - m[5];
        return [(m[3] * xt - m[2] * yt) / det, (-m[1] * xt + m[0] * yt) / det];
    };
    D.Viewport = Viewport;

    D.totalRot = function (p) {
        return ((p.rot0 || 0) + (p.rot || 0)) % 360;
    };

    D.viewport = function (k, scale) {
        var p = D.pages[k];
        return new Viewport(p.view, D.totalRot(p), scale || 1);
    };

    /* Page sizes at scale 1: W/H the whole page, w/h what shows (crop), ox/oy the crop origin */
    D.dims = function (k) {
        var p = D.pages[k];
        var vp = new Viewport(p.view, D.totalRot(p), 1);
        var r = { W: vp.width, H: vp.height, w: vp.width, h: vp.height, ox: 0, oy: 0 };
        if (p.crop) {
            r.w = p.crop.w;
            r.h = p.crop.h;
            r.ox = p.crop.x;
            r.oy = p.crop.y;
        }
        return r;
    };

    D.pdfPage = function (k) {
        var p = D.pages[k];
        if (!p || p.s < 0) {
            return Promise.resolve(null);
        }
        return D.sources[p.s].pdf.getPage(p.i + 1);
    };

    /* ------------------------------------------------------------ loading */
    function askPassword(name, retry) {
        return new Promise(function (resolve) {
            var body = PE.el('div', 'pe-form');
            body.innerHTML = '<p>' + PE.esc(retry ? PE.T('pw/wrong', 'The password is not correct. Try again.') :
                PE.T('pw/need', '"{name}" is protected. Enter its password to open it.', { name: name })) + '</p>' +
                '<input class="pe-input" type="password" autocomplete="off">';
            var given = null;
            PE.dialog({
                title: PE.T('pw/title', 'Password required'),
                body: body,
                buttons: [
                    { label: PE.T('common/cancel', 'Cancel') },
                    { label: PE.T('pw/open', 'Open'), primary: true, onClick: function () { given = body.querySelector('input').value; } }
                ],
                onClose: function () { resolve(given); }
            });
        });
    }

    D.loadPdf = function (bytes, name) {
        return PE.libs.pdfjs().then(function (pdfjsLib) {
            var task = pdfjsLib.getDocument({
                data: bytes.slice(0),
                cMapUrl: 'lib/pdfjs/cmaps/',
                cMapPacked: true,
                isEvalSupported: false
            });
            task.onPassword = function (update, reason) {
                askPassword(name, reason === 2).then(function (pw) {
                    if (pw === null) {
                        task.destroy();
                    } else {
                        update(pw);
                    }
                });
            };
            return task.promise;
        }).then(function (pdf) {
            var info = [];
            var jobs = [];
            for (var i = 0; i < pdf.numPages; i++) {
                (function (idx) {
                    jobs.push(pdf.getPage(idx + 1).then(function (pg) {
                        info[idx] = { view: pg.view.slice(), rotate: pg.rotate || 0 };
                    }));
                })(i);
            }
            return Promise.all(jobs).then(function () {
                return { name: name, bytes: bytes, pdf: pdf, info: info, encrypted: false };
            });
        });
    };

    function pageFromSource(s, i) {
        var inf = D.sources[s].info[i];
        return { id: PE.uid('p'), s: s, i: i, view: inf.view.slice(), rot0: inf.rotate, rot: 0, crop: null, objs: [], edits: [] };
    }

    D.blankPage = function (w, h) {
        return { id: PE.uid('p'), s: -1, i: -1, view: [0, 0, w, h], rot0: 0, rot: 0, crop: null, objs: [], edits: [] };
    };

    function releaseSources() {
        D.sources.forEach(function (src) {
            try {
                src.pdf.destroy();
            } catch (e) {
                //already gone
            }
        });
        Object.keys(D.assets).forEach(function (id) {
            if (D.assets[id].url) {
                URL.revokeObjectURL(D.assets[id].url);
            }
        });
    }

    D.reset = function () {
        releaseSources();
        D.sources = [];
        D.pages = [];
        D.meta = {};
        D.deco = { hf: null, pn: null, wm: null, bg: null };
        D.attach = [];
        D.assets = {};
        D.path = null;
        D.name = '';
        D.size = 0;
        D.dirty = false;
        D.loaded = false;
        D.version = '';
        D.outline = null;
        D.fileAttachments = null;
        undoStack = [];
        redoStack = [];
        libDocs = {};
        D.emit('dirty');
    };

    /* Open a PDF as the document. path is its ArozOS vpath (null for a file from the device). */
    D.open = function (bytes, name, path) {
        return D.loadPdf(bytes, name).then(function (src) {
            D.reset();
            D.sources = [src];
            D.pages = src.info.map(function (inf, i) {
                return pageFromSource(0, i);
            });
            D.path = path || null;
            D.name = name;
            D.size = bytes.length;
            D.loaded = true;
            return src.pdf.getMetadata().catch(function () { return null; }).then(function (md) {
                var inf = (md && md.info) || {};
                D.version = inf.PDFFormatVersion || '';
                D.meta = {
                    title: inf.Title || '',
                    author: inf.Author || '',
                    subject: inf.Subject || '',
                    keywords: inf.Keywords || '',
                    creator: inf.Creator || '',
                    producer: inf.Producer || '',
                    created: PE.parsePdfDate(inf.CreationDate),
                    modified: PE.parsePdfDate(inf.ModDate)
                };
                D.meta.created = D.meta.created ? D.meta.created.toISOString() : '';
                D.meta.modified = D.meta.modified ? D.meta.modified.toISOString() : '';
                src.encrypted = !!(md && md.info && md.info.IsEncrypted);
                return detectEncryption(src);
            }).then(function () {
                D.emit('load');
                return D;
            });
        });
    };

    function detectEncryption(src) {
        //pdf.js reports encryption through the trailer it parsed
        return src.pdf.getMetadata().then(function () {
            var tail = '';
            try {
                var b = src.bytes;
                var start = Math.max(0, b.length - 4096);
                for (var i = start; i < b.length; i++) {
                    tail += String.fromCharCode(b[i]);
                }
            } catch (e) {
                tail = '';
            }
            if (/\/Encrypt\s/.test(tail)) {
                src.encrypted = true;
            }
        }).catch(function () {});
    }

    D.newBlank = function (w, h, count, name) {
        D.reset();
        D.pages = [];
        for (var i = 0; i < (count || 1); i++) {
            D.pages.push(D.blankPage(w, h));
        }
        D.name = name || PE.T('doc/untitled', 'Untitled') + '.pdf';
        D.path = null;
        D.size = 0;
        D.loaded = true;
        var now = new Date().toISOString();
        D.meta = { title: '', author: '', subject: '', keywords: '', creator: '', producer: '', created: now, modified: now };
        D.dirty = true;
        D.emit('load');
        D.emit('dirty');
    };

    /* Another PDF to take pages from; resolves with its source index */
    D.addSource = function (bytes, name) {
        return D.loadPdf(bytes, name).then(function (src) {
            D.sources.push(src);
            return D.sources.length - 1;
        });
    };

    /* pdf-lib copies of the sources, loaded on demand (Edit PDF and saving) */
    var libDocs = {};
    D.libDoc = function (s) {
        if (!libDocs[s]) {
            libDocs[s] = PE.libs.pdflib().then(function (L) {
                return L.PDFDocument.load(D.sources[s].bytes, { ignoreEncryption: true, updateMetadata: false });
            });
        }
        return libDocs[s];
    };

    /* ------------------------------------------------------------ assets */
    D.addAsset = function (bytes, mime, w, h) {
        var id = PE.uid('a');
        var blob = new Blob([bytes], { type: mime || 'image/png' });
        D.assets[id] = { bytes: bytes, mime: mime || 'image/png', url: URL.createObjectURL(blob), w: w || 0, h: h || 0 };
        return id;
    };

    /*
        Turn any image the browser can decode into an asset: PNG and JPEG
        keep their bytes, everything else becomes PNG.
    */
    D.assetFromBytes = function (bytes) {
        var isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e;
        var isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
        var blob = new Blob([bytes]);
        var url = URL.createObjectURL(blob);
        return PE.loadImage(url).then(function (img) {
            var w = img.naturalWidth, h = img.naturalHeight;
            if (isPng || isJpg) {
                URL.revokeObjectURL(url);
                return D.addAsset(bytes, isPng ? 'image/png' : 'image/jpeg', w, h);
            }
            var c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            c.getContext('2d').drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            return PE.canvasToBlob(c, 'image/png').then(PE.readFile).then(function (png) {
                return D.addAsset(png, 'image/png', w, h);
            });
        });
    };

    /* ------------------------------------------------------------ history */
    var undoStack = [];
    var redoStack = [];
    var MAX_UNDO = 120;

    D.snapshot = function () {
        return JSON.stringify({ pages: D.pages, meta: D.meta, deco: D.deco, attach: D.attach });
    };

    function restore(snap) {
        var o = JSON.parse(snap);
        D.pages = o.pages;
        D.meta = o.meta;
        D.deco = o.deco;
        D.attach = o.attach || [];
    }

    D.pushUndo = function (snap) {
        undoStack.push(snap);
        if (undoStack.length > MAX_UNDO) {
            undoStack.shift();
        }
        redoStack = [];
        D.markDirty();
    };

    D.markDirty = function () {
        if (!D.dirty) {
            D.dirty = true;
            D.emit('dirty');
        }
    };

    D.markClean = function () {
        D.dirty = false;
        D.emit('dirty');
    };

    /*
        Run a change with undo: what.pages (indices) or what.all say which
        pages to redraw, what.structure that pages were added, removed or
        moved.
    */
    D.change = function (fn, what) {
        var snap = D.snapshot();
        var r = fn();
        D.pushUndo(snap);
        D.emit('change', what || { all: true });
        return r;
    };

    D.canUndo = function () {
        return undoStack.length > 0;
    };
    D.canRedo = function () {
        return redoStack.length > 0;
    };

    D.undo = function () {
        if (!undoStack.length) {
            return;
        }
        redoStack.push(D.snapshot());
        restore(undoStack.pop());
        D.markDirty();
        D.emit('change', { all: true, structure: true, restore: true });
    };

    D.redo = function () {
        if (!redoStack.length) {
            return;
        }
        undoStack.push(D.snapshot());
        restore(redoStack.pop());
        D.markDirty();
        D.emit('change', { all: true, structure: true, restore: true });
    };

    /* ------------------------------------------------------------ objects */
    D.find = function (id) {
        for (var k = 0; k < D.pages.length; k++) {
            var objs = D.pages[k].objs;
            for (var j = 0; j < objs.length; j++) {
                if (objs[j].id === id) {
                    return { k: k, o: objs[j], j: j };
                }
            }
        }
        return null;
    };

    D.pageIndexById = function (pid) {
        for (var k = 0; k < D.pages.length; k++) {
            if (D.pages[k].id === pid) {
                return k;
            }
        }
        return -1;
    };

    D.objectCount = function () {
        var n = 0;
        D.pages.forEach(function (p) {
            n += p.objs.length;
        });
        return n;
    };

    /* ------------------------------------------------------------ rotation */
    function rotPoint(x, y, W, H, d) {
        if (d === 90) {
            return [H - y, x];
        }
        if (d === 180) {
            return [W - x, H - y];
        }
        if (d === 270) {
            return [y, W - x];
        }
        return [x, y];
    }

    function rotRect(r, W, H, d) {
        var a = rotPoint(r.x, r.y, W, H, d);
        var b = rotPoint(r.x + r.w, r.y + r.h, W, H, d);
        return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
    }

    D.rectsBox = function (rects) {
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        rects.forEach(function (r) {
            x0 = Math.min(x0, r.x);
            y0 = Math.min(y0, r.y);
            x1 = Math.max(x1, r.x + r.w);
            y1 = Math.max(y1, r.y + r.h);
        });
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    };

    /* Turn page k clockwise by d (90 / 180 / 270), with everything on it */
    D.rotatePageModel = function (p, d) {
        d = ((d % 360) + 360) % 360;
        if (!d) {
            return;
        }
        var vp = new Viewport(p.view, D.totalRot(p), 1);
        var W = vp.width, H = vp.height;
        p.objs.forEach(function (o) {
            if (o.type === 'markup') {
                o.rects = o.rects.map(function (r) { return rotRect(r, W, H, d); });
                var bb = D.rectsBox(o.rects);
                o.x = bb.x;
                o.y = bb.y;
                o.w = bb.w;
                o.h = bb.h;
                o.angle = ((o.angle || 0) + d) % 360;
                return;
            }
            var c = rotPoint(o.x + o.w / 2, o.y + o.h / 2, W, H, d);
            o.x = c[0] - o.w / 2;
            o.y = c[1] - o.h / 2;
            o.angle = (((o.angle || 0) + d) % 360 + 360) % 360;
        });
        (p.edits || []).forEach(function (ed) {
            ed.boxes = ed.boxes.map(function (r) { return rotRect(r, W, H, d); });
        });
        if (p.crop) {
            p.crop = rotRect(p.crop, W, H, d);
        }
        p.rot = ((p.rot || 0) + d) % 360;
    };

    /* ------------------------------------------------------------ pages */
    D.rotatePages = function (ks, d) {
        D.change(function () {
            ks.forEach(function (k) {
                D.rotatePageModel(D.pages[k], d);
            });
        }, { pages: ks, structure: true });
    };

    D.deletePages = function (ks) {
        if (ks.length >= D.pages.length) {
            PE.toast(PE.T('org/keepOne', 'A document needs at least one page.'), { error: true });
            return false;
        }
        var set = {};
        ks.forEach(function (k) { set[k] = true; });
        D.change(function () {
            D.pages = D.pages.filter(function (p, k) { return !set[k]; });
        }, { all: true, structure: true });
        return true;
    };

    D.duplicatePages = function (ks) {
        var sorted = ks.slice().sort(function (a, b) { return a - b; });
        D.change(function () {
            var copies = sorted.map(function (k) {
                var c = PE.clone(D.pages[k]);
                c.id = PE.uid('p');
                c.objs.forEach(function (o) { o.id = PE.uid(); });
                return c;
            });
            var at = sorted[sorted.length - 1] + 1;
            Array.prototype.splice.apply(D.pages, [at, 0].concat(copies));
        }, { all: true, structure: true });
        return sorted[sorted.length - 1] + 1;
    };

    /* Move the pages ks so they start at index "to" (an index of the list before the move) */
    D.movePages = function (ks, to) {
        var set = {};
        ks.forEach(function (k) { set[k] = true; });
        var moving = D.pages.filter(function (p, k) { return set[k]; });
        var before = 0;
        ks.forEach(function (k) {
            if (k < to) {
                before++;
            }
        });
        var target = to - before;
        D.change(function () {
            var rest = D.pages.filter(function (p, k) { return !set[k]; });
            Array.prototype.splice.apply(rest, [target, 0].concat(moving));
            D.pages = rest;
        }, { all: true, structure: true });
        return target;
    };

    D.insertPages = function (pages, at) {
        D.change(function () {
            Array.prototype.splice.apply(D.pages, [at, 0].concat(pages));
        }, { all: true, structure: true });
    };

    D.pagesFromSource = function (s, indices) {
        return indices.map(function (i) {
            return pageFromSource(s, i);
        });
    };

    D.reversePages = function () {
        D.change(function () {
            D.pages.reverse();
        }, { all: true, structure: true });
    };

    /* The page the outline / links of source 0 mean by page index i, in the current order */
    D.pageOfSource = function (s, i) {
        for (var k = 0; k < D.pages.length; k++) {
            if (D.pages[k].s === s && D.pages[k].i === i) {
                return k;
            }
        }
        return -1;
    };
})(window.PE);
