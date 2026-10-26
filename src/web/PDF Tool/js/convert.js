/*
    PDF Tool — conversion dialogs

    "Export Images"  : renders the open document's pages to JPEG/PNG, including
                       any overlays currently placed (what you see is what you get).
    "From Images"    : builds a brand new PDF out of a list of images via pdf-lib,
                       either onto page-sized "base plates" or pages matching each
                       image. The result can be opened straight in the editor
                       without ever touching the server.
*/

(function (T) {
    'use strict';

    var FONT = "'Helvetica Neue', Arial, sans-serif";

    /* Page sizes in PDF points (72 per inch) */
    var PAGE_PRESETS = {
        auto: null,
        a4p: [595.28, 841.89],
        a4l: [841.89, 595.28],
        a3p: [841.89, 1190.55],
        a3l: [1190.55, 841.89],
        letterp: [612, 792],
        letterl: [792, 612],
        legalp: [612, 1008]
    };

    /* Draw the editor's overlays onto an export canvas at its own resolution. */
    function drawOverlays(cx, overlays, W, H, imgMap) {
        (overlays || []).forEach(function (o) {
            if (o.type === 'text') {
                var fontPx = o.fontFrac * H;
                cx.fillStyle = o.color || '#000';
                cx.textBaseline = 'top';
                cx.font = fontPx + 'px ' + FONT;
                String(o.t).split('\n').forEach(function (ln, i) {
                    cx.fillText(ln, o.fx * W, o.fy * H + i * fontPx * 1.25);
                });
            } else if (o.type === 'image' && imgMap[o.src]) {
                cx.drawImage(imgMap[o.src], o.fx * W, o.fy * H, o.fwFrac * W, o.fhFrac * H);
            }
        });
    }

    function preloadOverlayImages(overlaysByPage) {
        var srcs = {};
        Object.keys(overlaysByPage || {}).forEach(function (k) {
            (overlaysByPage[k] || []).forEach(function (o) {
                if (o.type === 'image') { srcs[o.src] = 1; }
            });
        });
        var map = {};
        return Promise.all(Object.keys(srcs).map(function (src) {
            return T.loadImage(src).then(function (img) { map[src] = img; },
                function () { /* skip an image that will not load */ });
        })).then(function () { return map; });
    }

    /* ── Export pages as images ─────────────────────────────────────── */

    T.openExportImages = function (doc) {
        if (!doc || !doc.pdf) { return; }
        if (!doc.savePath) {
            T.toast('Save this document first so the images have somewhere to go.', true);
            return;
        }

        var dlg = T.modal({
            title: 'Export Pages as Images',
            bodyHtml:
                '<div class="pt-field">' +
                    '<span class="pt-label">Format</span>' +
                    '<div class="pt-radios">' +
                        '<label><input type="radio" name="exFmt" value="jpg" checked> JPEG</label>' +
                        '<label><input type="radio" name="exFmt" value="png"> PNG</label>' +
                    '</div>' +
                '</div>' +
                '<div class="pt-field" id="exQField">' +
                    '<span class="pt-label">JPEG quality: <span id="exQVal">90</span>%</span>' +
                    '<input type="range" id="exQ" min="50" max="100" value="90" style="width:100%">' +
                '</div>' +
                '<div class="pt-field">' +
                    '<span class="pt-label">Resolution</span>' +
                    '<select class="pt-select" id="exScale">' +
                        '<option value="1">Standard (1x)</option>' +
                        '<option value="2" selected>High (2x)</option>' +
                        '<option value="3">Very high (3x)</option>' +
                    '</select>' +
                '</div>' +
                '<p class="pt-hint">Saved next to the document. Text, images and chops you have placed are included.</p>' +
                '<div id="exProg"></div>',
            actions: [
                { label: 'Cancel', onClick: function (c) { c.close(); } },
                { label: 'Export', primary: true, onClick: run }
            ]
        });

        var qField = dlg.body.querySelector('#exQField');
        var qRange = dlg.body.querySelector('#exQ');
        qRange.addEventListener('input', function () {
            dlg.body.querySelector('#exQVal').textContent = this.value;
        });
        Array.prototype.forEach.call(dlg.body.querySelectorAll('input[name=exFmt]'), function (r) {
            r.addEventListener('change', function () {
                qField.style.display = this.value === 'jpg' ? '' : 'none';
            });
        });

        function run(ctx) {
            var fmt = dlg.body.querySelector('input[name=exFmt]:checked').value;
            var quality = parseInt(qRange.value, 10) / 100;
            var scale = parseFloat(dlg.body.querySelector('#exScale').value);
            var mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
            var ext = fmt === 'png' ? '.png' : '.jpg';
            var outDir = T.dirOf(doc.savePath);
            var base = T.basenameNoExt(doc.savePath);
            var prog = dlg.body.querySelector('#exProg');

            ctx.button.disabled = true;
            prog.innerHTML = '<div class="pt-hint">Preparing…</div>';

            preloadOverlayImages(doc.overlays).then(function (imgMap) {
                var n = doc.pdf.numPages;

                function fail(err) {
                    prog.innerHTML = '<div class="result-box result-err"><strong>Error:</strong> ' +
                        T.escHtml(String(err && err.message ? err.message : err)) + '</div>';
                    ctx.button.disabled = false;
                }

                function next(i) {
                    if (i > n) {
                        prog.innerHTML = '<div class="result-box result-ok"><strong>' + n +
                            ' image' + (n !== 1 ? 's' : '') + '</strong> saved to ' + T.escHtml(outDir) + '</div>';
                        ctx.button.disabled = false;
                        return;
                    }
                    prog.innerHTML = '<div class="pt-hint">Rendering page ' + i + ' of ' + n + '…</div>';

                    doc.pdf.getPage(i).then(function (page) {
                        var vp = page.getViewport({ scale: scale });
                        var c = document.createElement('canvas');
                        c.width = vp.width;
                        c.height = vp.height;
                        var cx = c.getContext('2d');
                        if (fmt !== 'png') {
                            cx.fillStyle = '#FFF';
                            cx.fillRect(0, 0, c.width, c.height);
                        }
                        page.render({ canvasContext: cx, viewport: vp }).promise.then(function () {
                            drawOverlays(cx, doc.overlays[i], c.width, c.height, imgMap);
                            c.toBlob(function (blob) {
                                T.uploadBlob(blob, base + '_page' + i + ext, outDir)
                                    .then(function () { next(i + 1); }, fail);
                            }, mime, quality);
                        }, fail);
                    }, fail);
                }

                next(1);
            });
        }
    };

    /* ── Build a PDF from images ────────────────────────────────────── */

    T.openImagesToPdf = function () {
        var images = [];
        var overrideDir = null;

        var dlg = T.modal({
            title: 'Create PDF from Images',
            bodyHtml:
                '<div class="pt-field">' +
                    '<span class="pt-label">Images</span>' +
                    '<div id="i2pList"></div>' +
                    '<button class="pt-btn" id="i2pAdd" style="margin-top:8px">Add Images…</button>' +
                '</div>' +
                '<div class="pt-field">' +
                    '<span class="pt-label">Page size</span>' +
                    '<select class="pt-select" id="i2pSize">' +
                        '<option value="auto" selected>Match each image</option>' +
                        '<option value="a4p">A4 portrait</option>' +
                        '<option value="a4l">A4 landscape</option>' +
                        '<option value="a3p">A3 portrait</option>' +
                        '<option value="a3l">A3 landscape</option>' +
                        '<option value="letterp">Letter portrait</option>' +
                        '<option value="letterl">Letter landscape</option>' +
                        '<option value="legalp">Legal portrait</option>' +
                    '</select>' +
                    '<p class="pt-hint" style="margin:6px 0 0">Images are scaled to fit and centred on the page. ' +
                    'Nothing is cropped and the aspect ratio is kept.</p>' +
                '</div>' +
                '<div class="pt-field">' +
                    '<span class="pt-label">Output filename</span>' +
                    '<input type="text" class="pt-input" id="i2pName" placeholder="output.pdf">' +
                '</div>' +
                '<div class="pt-field">' +
                    '<span class="pt-label">Save to folder</span>' +
                    '<div class="pt-row">' +
                        '<button class="pt-btn" id="i2pDir">Choose…</button>' +
                        '<span class="pt-path" id="i2pDirLbl">Same folder as the first image</span>' +
                    '</div>' +
                '</div>' +
                '<div id="i2pProg"></div>',
            actions: [
                { label: 'Cancel', onClick: function (c) { c.close(); } },
                { label: 'Open in Editor', onClick: openInEditor },
                { label: 'Save to Server', primary: true, onClick: saveToServer }
            ]
        });

        var listEl = dlg.body.querySelector('#i2pList');
        var progEl = dlg.body.querySelector('#i2pProg');

        function renderList() {
            if (!images.length) {
                listEl.innerHTML = '<div class="pt-empty-box">No images added yet.</div>';
                return;
            }
            var html = '<div class="pt-imglist">';
            images.forEach(function (img, idx) {
                html += '<div class="pt-imgrow">' +
                    '<img class="pt-thumb" src="' + T.mediaUrl(img.filepath) + '" alt="">' +
                    '<span class="pt-imgname">' + T.escHtml(img.filename) + '</span>' +
                    '<span class="pt-imgbtns">' +
                        (idx > 0 ? '<button class="pt-iconbtn" data-mv="-1" data-i="' + idx + '" title="Move up">' + T.svg.up + '</button>' : '') +
                        (idx < images.length - 1 ? '<button class="pt-iconbtn" data-mv="1" data-i="' + idx + '" title="Move down">' + T.svg.down + '</button>' : '') +
                        '<button class="pt-iconbtn danger" data-rm="' + idx + '" title="Remove">' + T.svg.x + '</button>' +
                    '</span>' +
                '</div>';
            });
            listEl.innerHTML = html + '</div>';

            Array.prototype.forEach.call(listEl.querySelectorAll('[data-mv]'), function (b) {
                b.addEventListener('click', function () {
                    var i = parseInt(this.getAttribute('data-i'), 10);
                    var j = i + parseInt(this.getAttribute('data-mv'), 10);
                    if (j < 0 || j >= images.length) { return; }
                    var tmp = images[i]; images[i] = images[j]; images[j] = tmp;
                    renderList();
                });
            });
            Array.prototype.forEach.call(listEl.querySelectorAll('[data-rm]'), function (b) {
                b.addEventListener('click', function () {
                    images.splice(parseInt(this.getAttribute('data-rm'), 10), 1);
                    renderList();
                });
            });
        }

        dlg.body.querySelector('#i2pAdd').addEventListener('click', function () {
            ao_module_openFileSelector('_ptI2pAddCb', 'user:/', 'file', true,
                { filter: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] });
        });
        dlg.body.querySelector('#i2pDir').addEventListener('click', function () {
            ao_module_openFileSelector('_ptI2pDirCb', 'user:/', 'folder', false);
        });

        window._ptI2pAddCb = function (files) {
            if (!files || !files.length) { return; }
            files.forEach(function (f) {
                if (!images.some(function (x) { return x.filepath === f.filepath; })) {
                    images.push({ filepath: f.filepath, filename: f.filename });
                }
            });
            renderList();
        };
        window._ptI2pDirCb = function (files) {
            if (!files || !files.length) { return; }
            overrideDir = files[0].filepath;
            dlg.body.querySelector('#i2pDirLbl').textContent = overrideDir;
        };

        function outputName() {
            var name = dlg.body.querySelector('#i2pName').value.trim() || 'output';
            return /\.pdf$/i.test(name) ? name : name + '.pdf';
        }

        /* Build the document in memory and hand back its bytes. */
        function build(ctx) {
            if (!images.length) {
                progEl.innerHTML = '<div class="result-box result-err">Add at least one image first.</div>';
                return Promise.reject(null);
            }
            var preset = PAGE_PRESETS[dlg.body.querySelector('#i2pSize').value] || null;

            ctx.button.disabled = true;
            progEl.innerHTML = '<div class="pt-hint">Loading pdf-lib…</div>';

            return T.loadPdfLib().then(function () {
                return PDFLib.PDFDocument.create();
            }).then(function (pdfDoc) {
                return images.reduce(function (chain, im, i) {
                    return chain.then(function () {
                        progEl.innerHTML = '<div class="pt-hint">Adding image ' + (i + 1) + ' of ' + images.length + '…</div>';
                        return T.embedImage(pdfDoc, T.mediaUrl(im.filepath)).then(function (emb) {
                            if (!preset) {
                                // One page per image, exactly the image's own size
                                var p = pdfDoc.addPage([emb.width, emb.height]);
                                p.drawImage(emb, { x: 0, y: 0, width: emb.width, height: emb.height });
                                return;
                            }
                            // Fixed base plate: scale to fit inside, keep aspect, centre it
                            var pw = preset[0], ph = preset[1];
                            var s = Math.min(pw / emb.width, ph / emb.height);
                            var w = emb.width * s, h = emb.height * s;
                            var page = pdfDoc.addPage([pw, ph]);
                            page.drawImage(emb, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
                        });
                    });
                }, Promise.resolve()).then(function () {
                    progEl.innerHTML = '<div class="pt-hint">Writing PDF…</div>';
                    return pdfDoc.save();
                });
            }).catch(function (err) {
                if (err) {
                    progEl.innerHTML = '<div class="result-box result-err"><strong>Error:</strong> ' +
                        T.escHtml(String(err.message || err)) + '</div>';
                }
                ctx.button.disabled = false;
                throw err;
            });
        }

        /* Straight into the editor — never round-trips through the server */
        function openInEditor(ctx) {
            build(ctx).then(function (bytes) {
                ctx.button.disabled = false;
                ctx.close();
                T.openBytes(bytes, outputName(), null);
            }).catch(function () { /* message already shown */ });
        }

        function saveToServer(ctx) {
            var name = outputName();
            build(ctx).then(function (bytes) {
                var outDir = overrideDir || T.dirOf(images[0].filepath);
                progEl.innerHTML = '<div class="pt-hint">Uploading…</div>';
                return T.uploadBlob(new Blob([bytes], { type: 'application/pdf' }), name, outDir)
                    .then(function () {
                        progEl.innerHTML = '<div class="result-box result-ok"><strong>' + T.escHtml(name) +
                            '</strong> created in ' + T.escHtml(outDir) + '</div>';
                        ctx.button.disabled = false;
                    });
            }).catch(function (err) {
                if (err) {
                    progEl.innerHTML = '<div class="result-box result-err"><strong>Error:</strong> ' +
                        T.escHtml(String(err.message || err)) + '</div>';
                }
                ctx.button.disabled = false;
            });
        }

        renderList();
    };

})(window.PDFTool);
