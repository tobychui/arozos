/*
    PDF Tool — editor

    Renders the open document with pdf.js and lets the user place text, images
    and chops on top. Saving re-opens the ORIGINAL bytes with pdf-lib and draws
    the overlays as real PDF content, so pages keep their vector text and pages
    without overlays are left untouched.

    The pristine source bytes are held in memory for the life of the document, so
    saving repeatedly (or overwriting the source file) never re-applies overlays
    on top of an already-stamped copy.
*/

(function (T) {
    'use strict';

    var FONT = "'Helvetica Neue', Arial, sans-serif";
    var TEXT_BASELINE_RATIO = 0.8; // top of a line to its baseline, as a fraction of font size

    /*
        doc.srcBytes — pristine original, never mutated
        doc.savePath — where it lives on the server, or null for a document that
                       was built in memory (From Images) and not saved yet
    */
    var doc = {
        pdf: null, srcBytes: null, savePath: null, filename: '',
        page: 1, num: 0, overlays: {}
    };
    T.doc = doc;

    var zoom = 'fit'; // 'fit' or a numeric scale (1 = 100%)
    var sel = null;
    var resizeTimer = null;
    var canvas, overlayEl, stageEl, propsEl, stampMenu, zoomEl, fileNameEl, rootEl;
    var editButtons = [];

    function $(id) { return document.getElementById(id); }

    function enableEditing(on) {
        editButtons.forEach(function (b) { b.disabled = !on; });
    }

    /* ── Selection ──────────────────────────────────────────────────── */

    function selectOverlay(o, el) {
        clearSelection();
        sel = { o: o, el: el };
        el.classList.add('selected');
        if (o.type === 'text') {
            propsEl.classList.add('show');
            rootEl.classList.add('props-open'); // lifts the toast clear of the bar
            var px = Math.round(o.fontFrac * canvas.height);
            $('peFontSize').value = px;
            $('peFontVal').textContent = px + 'px';
            $('peColor').value = o.color || '#000000';
        }
    }

    function clearSelection() {
        if (sel) { sel.el.classList.remove('selected'); }
        sel = null;
        propsEl.classList.remove('show');
        rootEl.classList.remove('props-open');
    }

    /* ── Overlay elements ───────────────────────────────────────────── */

    function makeOverlayEl(o) {
        var el = document.createElement('div');
        el.className = 'pe-ov ' + (o.type === 'text' ? 'pe-text' : 'pe-img');
        el.style.left = (o.fx * canvas.width) + 'px';
        el.style.top = (o.fy * canvas.height) + 'px';

        if (o.type === 'text') {
            el.textContent = o.t;
            el.style.fontSize = (o.fontFrac * canvas.height) + 'px';
            el.style.color = o.color || '#000';
            el.addEventListener('dblclick', function () {
                el.setAttribute('contenteditable', 'true');
                el.focus();
            });
            el.addEventListener('blur', function () {
                el.removeAttribute('contenteditable');
                o.t = el.textContent;
                o.fx = el.offsetLeft / canvas.width;
                o.fy = el.offsetTop / canvas.height;
            });
        } else {
            el.style.width = (o.fwFrac * canvas.width) + 'px';
            el.style.height = (o.fhFrac * canvas.height) + 'px';
            var img = document.createElement('img');
            img.src = o.src;
            el.appendChild(img);
            var handle = document.createElement('div');
            handle.className = 'pe-handle';
            el.appendChild(handle);
            wireResize(handle, el, o);
        }

        var del = document.createElement('button');
        del.className = 'pe-del';
        del.innerHTML = '<svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"><line x1="1" y1="1" x2="8" y2="8"/><line x1="8" y1="1" x2="1" y2="8"/></svg>';
        del.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        del.addEventListener('click', function (e) {
            e.stopPropagation();
            var arr = doc.overlays[doc.page] || [];
            var i = arr.indexOf(o);
            if (i !== -1) { arr.splice(i, 1); }
            clearSelection();
            el.parentNode.removeChild(el);
        });
        el.appendChild(del);

        wireDrag(el, o);
        el.addEventListener('mousedown', function () { selectOverlay(o, el); });
        return el;
    }

    function wireDrag(el, o) {
        el.addEventListener('mousedown', function (e) {
            if (el.getAttribute('contenteditable') === 'true') { return; }
            if (e.target.classList.contains('pe-handle')) { return; }
            e.preventDefault();
            var startX = e.clientX, startY = e.clientY;
            var baseL = el.offsetLeft, baseT = el.offsetTop;
            function mv(ev) {
                var nl = Math.max(0, Math.min(canvas.width - 6, baseL + (ev.clientX - startX)));
                var nt = Math.max(0, Math.min(canvas.height - 6, baseT + (ev.clientY - startY)));
                el.style.left = nl + 'px';
                el.style.top = nt + 'px';
                o.fx = nl / canvas.width;
                o.fy = nt / canvas.height;
            }
            function up() {
                document.removeEventListener('mousemove', mv);
                document.removeEventListener('mouseup', up);
            }
            document.addEventListener('mousemove', mv);
            document.addEventListener('mouseup', up);
        });
    }

    function wireResize(handle, el, o) {
        handle.addEventListener('mousedown', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var startX = e.clientX;
            var startW = el.offsetWidth;
            var aspect = el.offsetHeight / el.offsetWidth;
            function mv(ev) {
                var nw = Math.max(18, Math.min(canvas.width, startW + (ev.clientX - startX)));
                var nh = nw * aspect;
                el.style.width = nw + 'px';
                el.style.height = nh + 'px';
                o.fwFrac = nw / canvas.width;
                o.fhFrac = nh / canvas.height;
            }
            function up() {
                document.removeEventListener('mousemove', mv);
                document.removeEventListener('mouseup', up);
            }
            document.addEventListener('mousemove', mv);
            document.addEventListener('mouseup', up);
        });
    }

    function addOverlay(o) {
        if (!doc.overlays[doc.page]) { doc.overlays[doc.page] = []; }
        doc.overlays[doc.page].push(o);
        if (overlayEl) {
            var el = makeOverlayEl(o);
            overlayEl.appendChild(el);
            selectOverlay(o, el);
        }
    }

    /* ── Rendering (Fit fills the stage; a numeric zoom scrolls) ────── */

    function pageScale(v1) {
        if (zoom === 'fit') {
            var availW = Math.max(80, stageEl.clientWidth - 28);
            var availH = Math.max(80, stageEl.clientHeight - 28);
            return Math.min(availW / v1.width, availH / v1.height, 4);
        }
        return zoom;
    }

    function renderPage(n) {
        if (!doc.pdf) { return; }
        clearSelection();
        doc.pdf.getPage(n).then(function (page) {
            var v1 = page.getViewport({ scale: 1 });
            var vp = page.getViewport({ scale: pageScale(v1) });

            stageEl.classList.toggle('zoomed', zoom !== 'fit');
            stageEl.innerHTML = '';

            var wrap = document.createElement('div');
            wrap.className = 'pe-wrap';
            wrap.style.width = vp.width + 'px';
            wrap.style.height = vp.height + 'px';

            canvas = document.createElement('canvas');
            canvas.width = vp.width;
            canvas.height = vp.height;
            overlayEl = document.createElement('div');
            overlayEl.className = 'pe-overlay';
            wrap.appendChild(canvas);
            wrap.appendChild(overlayEl);
            stageEl.appendChild(wrap);

            overlayEl.addEventListener('mousedown', function (e) {
                if (e.target === overlayEl) { clearSelection(); }
            });

            page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise.then(function () {
                (doc.overlays[n] || []).forEach(function (o) { overlayEl.appendChild(makeOverlayEl(o)); });
            });

            $('pePageLbl').textContent = n + ' / ' + doc.num;
            $('pePrev').disabled = (n <= 1);
            $('peNext').disabled = (n >= doc.num);
        });
    }

    /* ── Opening ────────────────────────────────────────────────────── */

    /*
        Open a document from raw bytes. savePath is the file it came from, or null
        when it only exists in memory (built by "From Images" and not saved yet).
    */
    function openBytes(bytes, filename, savePath) {
        doc.srcBytes = bytes;
        doc.savePath = savePath || null;
        doc.filename = filename;
        doc.overlays = {};
        doc.page = 1;
        zoom = 'fit';
        zoomEl.value = 'fit';

        fileNameEl.textContent = filename + (doc.savePath ? '' : ' (unsaved)');
        fileNameEl.title = doc.savePath || filename + ' — not saved yet';
        T.hideToast();
        stageEl.classList.remove('zoomed');
        stageEl.innerHTML = '<div class="pe-empty">Opening…</div>';
        ao_module_setWindowTitle(filename + ' - PDF Tool');

        return T.loadPdfJs().then(function () {
            // pdf.js may transfer the buffer to its worker, so hand it a copy
            return pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
        }).then(function (pdf) {
            doc.pdf = pdf;
            doc.num = pdf.numPages;
            doc.page = 1;
            enableEditing(true);
            renderPage(1);
        }).catch(function (err) {
            stageEl.innerHTML = '<div class="pe-empty">Could not open this PDF:<br>' +
                T.escHtml(String(err && err.message ? err.message : err)) + '</div>';
        });
    }

    T.openBytes = openBytes;

    function openPdf(filepath, filename) {
        stageEl.innerHTML = '<div class="pe-empty">Loading…</div>';
        return T.fetchBytes(T.mediaUrl(filepath)).then(function (bytes) {
            return openBytes(bytes, filename || filepath.split('/').pop(), filepath);
        }).catch(function (err) {
            stageEl.innerHTML = '<div class="pe-empty">Could not read this file:<br>' +
                T.escHtml(String(err && err.message ? err.message : err)) + '</div>';
        });
    }

    function placeImageFromSrc(src) {
        if (!canvas) { return; }
        T.loadImage(src).then(function (probe) {
            var dispW = Math.min(150, canvas.width * 0.32);
            var dispH = dispW * (probe.naturalHeight / probe.naturalWidth);
            addOverlay({
                type: 'image', src: src, fx: 0.4, fy: 0.4,
                fwFrac: dispW / canvas.width, fhFrac: dispH / canvas.height
            });
        }).catch(function () {
            T.toast('Could not load that image.', true);
        });
    }

    /* ── Stamp picker ───────────────────────────────────────────────── */

    function openStampMenu(anchor) {
        T.Chops.load(function (chops) {
            if (!chops.length) {
                stampMenu.innerHTML = '<div class="pe-stamp-empty">No chops saved yet.<br>' +
                    '<button class="pt-btn tiny" id="peStampManage" style="margin-top:8px">Open Chop Library</button></div>';
            } else {
                var html = '<div class="pe-stamp-grid">';
                chops.forEach(function (c) {
                    html += '<div class="pe-stamp-item" data-src="' + T.mediaUrl(c.path) + '">' +
                        '<img src="' + T.mediaUrl(c.path) + '" alt=""><span>' + T.escHtml(c.name) + '</span></div>';
                });
                html += '</div><button class="pt-btn tiny" id="peStampManage" style="margin-top:9px;width:100%">Manage chops…</button>';
                stampMenu.innerHTML = html;

                Array.prototype.forEach.call(stampMenu.querySelectorAll('.pe-stamp-item'), function (it) {
                    it.addEventListener('click', function () {
                        placeImageFromSrc(this.getAttribute('data-src'));
                        stampMenu.classList.remove('show');
                    });
                });
            }
            var manage = stampMenu.querySelector('#peStampManage');
            if (manage) {
                manage.addEventListener('click', function () {
                    stampMenu.classList.remove('show');
                    T.openChopManager();
                });
            }
            stampMenu.style.left = anchor.offsetLeft + 'px';
            stampMenu.style.top = (anchor.offsetTop + anchor.offsetHeight + 6) + 'px';
            stampMenu.classList.add('show');
        });
    }

    /* ── Building the edited document ───────────────────────────────── */

    function rasteriseText(o, fontPt) {
        var lines = String(o.t).split('\n');
        var probe = document.createElement('canvas').getContext('2d');
        probe.font = fontPt + 'px ' + FONT;
        var wPt = 1;
        lines.forEach(function (ln) { wPt = Math.max(wPt, probe.measureText(ln).width); });
        var lineH = fontPt * 1.25;
        var hPt = lines.length * lineH;
        var k = 3; // supersample for crisp glyphs
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.ceil(wPt * k));
        c.height = Math.max(1, Math.ceil(hPt * k));
        var cx = c.getContext('2d');
        cx.scale(k, k);
        cx.fillStyle = o.color || '#000';
        cx.textBaseline = 'top';
        cx.font = fontPt + 'px ' + FONT;
        lines.forEach(function (ln, i) { cx.fillText(ln, 0, i * lineH); });
        return { canvas: c, wPt: wPt, hPt: hPt };
    }

    function hexToRgb(hex) {
        hex = (hex || '#000000').replace('#', '');
        if (hex.length === 3) { hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]; }
        return {
            r: parseInt(hex.substr(0, 2), 16) / 255,
            g: parseInt(hex.substr(2, 2), 16) / 255,
            b: parseInt(hex.substr(4, 2), 16) / 255
        };
    }

    /*
        Apply every overlay to a copy of the original document and return the bytes.
        Each image placement is embedded as its OWN PDF image object inside its own
        graphics state, so overlapping images stay independent objects in the output
        instead of being flattened together.
    */
    function buildEditedBytes(status) {
        var byteCache = {}; // src -> Promise<{bytes,isPng}>, avoids re-decoding one source

        function embedFresh(pdfDoc, src) {
            if (!byteCache[src]) { byteCache[src] = T.imageBytesFor(src); }
            return byteCache[src].then(function (r) {
                return r.isPng ? pdfDoc.embedPng(r.bytes) : pdfDoc.embedJpg(r.bytes);
            });
        }

        return T.loadPdfLib().then(function () {
            return PDFLib.PDFDocument.load(doc.srcBytes.slice(0), { ignoreEncryption: true });
        }).then(function (pdfDoc) {
            var degrees = PDFLib.degrees, rgb = PDFLib.rgb;
            return pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica).then(function (helv) {
                var libPages = pdfDoc.getPages();
                var pageKeys = Object.keys(doc.overlays).filter(function (k) {
                    return (doc.overlays[k] || []).length;
                });

                // Walk only the pages that actually carry overlays, in order.
                return pageKeys.reduce(function (chain, k) {
                    return chain.then(function () {
                        var pn = parseInt(k, 10);
                        var libPage = libPages[pn - 1];
                        if (!libPage) { return; }
                        if (status) { status('Writing page ' + pn + '…'); }

                        return doc.pdf.getPage(pn).then(function (jsPage) {
                            var vp = jsPage.getViewport({ scale: 1 });
                            var rot = vp.rotation || 0;

                            return (doc.overlays[pn] || []).reduce(function (c2, o) {
                                return c2.then(function () {
                                    var dx = o.fx * vp.width, dy = o.fy * vp.height;

                                    if (o.type === 'image') {
                                        var ew = o.fwFrac * vp.width, eh = o.fhFrac * vp.height;
                                        var bl = vp.convertToPdfPoint(dx, dy + eh);
                                        // Fresh embed per placement keeps each one a separate layer
                                        return embedFresh(pdfDoc, o.src).then(function (img) {
                                            libPage.pushOperators(PDFLib.pushGraphicsState());
                                            libPage.drawImage(img, {
                                                x: bl[0], y: bl[1], width: ew, height: eh, rotate: degrees(rot)
                                            });
                                            libPage.pushOperators(PDFLib.popGraphicsState());
                                        });
                                    }

                                    var fontPt = o.fontFrac * vp.height;
                                    var col = hexToRgb(o.color);
                                    var canEncode = true;
                                    try { helv.encodeText(o.t); } catch (e) { canEncode = false; }

                                    if (canEncode) {
                                        libPage.pushOperators(PDFLib.pushGraphicsState());
                                        String(o.t).split('\n').forEach(function (ln, i) {
                                            var topY = dy + TEXT_BASELINE_RATIO * fontPt + i * fontPt * 1.25;
                                            var pt = vp.convertToPdfPoint(dx, topY);
                                            libPage.drawText(ln, {
                                                x: pt[0], y: pt[1], size: fontPt, font: helv,
                                                color: rgb(col.r, col.g, col.b), rotate: degrees(rot)
                                            });
                                        });
                                        libPage.pushOperators(PDFLib.popGraphicsState());
                                        return;
                                    }

                                    // Glyphs the standard font cannot encode (e.g. CJK):
                                    // rasterise just this text box and place it as an image.
                                    var rt = rasteriseText(o, fontPt);
                                    var blt = vp.convertToPdfPoint(dx, dy + rt.hPt);
                                    return T.canvasToBytes(rt.canvas, 'image/png')
                                        .then(function (png) { return pdfDoc.embedPng(png); })
                                        .then(function (img) {
                                            libPage.pushOperators(PDFLib.pushGraphicsState());
                                            libPage.drawImage(img, {
                                                x: blt[0], y: blt[1], width: rt.wPt, height: rt.hPt, rotate: degrees(rot)
                                            });
                                            libPage.pushOperators(PDFLib.popGraphicsState());
                                        });
                                });
                            }, Promise.resolve());
                        });
                    });
                }, Promise.resolve()).then(function () { return pdfDoc.save(); });
            });
        });
    }

    /* ── Saving ─────────────────────────────────────────────────────── */

    function writeTo(dir, name, onFinished) {
        var btn = $('peSave');
        var label = btn.innerHTML;
        btn.disabled = true;

        function status(t) { btn.textContent = t; }
        function done() { btn.innerHTML = label; btn.disabled = false; }

        status('Saving…');
        buildEditedBytes(status).then(function (outBytes) {
            status('Uploading…');
            return T.uploadBlob(new Blob([outBytes], { type: 'application/pdf' }), name, dir);
        }).then(function () {
            var full = dir.replace(/\/$/, '') + '/' + name;
            // The in-memory original stays pristine, so overlays remain editable and
            // are never applied twice — even when we just overwrote the source file.
            doc.savePath = full;
            doc.filename = name;
            fileNameEl.textContent = name;
            fileNameEl.title = full;
            ao_module_setWindowTitle(name + ' - PDF Tool');
            T.toast('<strong>' + T.escHtml(name) + '</strong> saved to ' + T.escHtml(dir) + '.', false);
            done();
            if (onFinished) { onFinished(); }
        }).catch(function (err) {
            T.toast('<strong>Error:</strong> ' + T.escHtml(String(err && err.message ? err.message : err)), true);
            done();
        });
    }

    /*
        Build the edited document and hand it to the browser's downloader, so it
        lands on the user's own device without going through the server at all.
    */
    function downloadPdf() {
        if (!doc.pdf) { return; }
        clearSelection();

        var btn = $('peSave');
        var label = btn.innerHTML;
        btn.disabled = true;

        function status(t) { btn.textContent = t; }
        function done() { btn.innerHTML = label; btn.disabled = false; }

        status('Preparing…');
        buildEditedBytes(status).then(function (outBytes) {
            var name = doc.filename || 'document.pdf';
            if (!/\.pdf$/i.test(name)) { name += '.pdf'; }

            var url = URL.createObjectURL(new Blob([outBytes], { type: 'application/pdf' }));
            var a = document.createElement('a');
            a.href = url;
            a.download = name;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            // Let the transfer start before the blob is released
            setTimeout(function () { URL.revokeObjectURL(url); }, 10000);

            T.toast('<strong>' + T.escHtml(name) + '</strong> downloaded.', false);
            done();
        }).catch(function (err) {
            T.toast('<strong>Error:</strong> ' + T.escHtml(String(err && err.message ? err.message : err)), true);
            done();
        });
    }

    function save() {
        if (!doc.pdf) { return; }
        clearSelection();

        var canOverwrite = !!doc.savePath;
        var actions = [{ label: 'Cancel', onClick: function (c) { c.close(); } }];

        actions.push({
            label: 'Save As…',
            primary: !canOverwrite,
            onClick: function (c) {
                c.close();
                var startDir = doc.savePath ? T.dirOf(doc.savePath) : 'user:/Desktop';
                var defName = canOverwrite
                    ? T.basenameNoExt(doc.filename) + '_edited.pdf'
                    : doc.filename;
                ao_module_openFileSelector('_ptSaveAsCb', startDir, 'new', false, { defaultName: defName });
            }
        });

        if (canOverwrite) {
            actions.push({
                label: 'Overwrite',
                primary: true,
                onClick: function (c) {
                    c.close();
                    writeTo(T.dirOf(doc.savePath), doc.savePath.split('/').pop());
                }
            });
        }

        T.modal({
            title: 'Save PDF',
            bodyHtml: canOverwrite
                ? '<p class="pt-hint">Overwrite the original file, or write the result to a new one.</p>' +
                  '<span class="pt-label">Current file</span>' +
                  '<div class="pt-pathbox">' + T.escHtml(doc.savePath) + '</div>'
                : '<p class="pt-hint">This document is read only, use Save As to save a copy.</p>' +
                  '<div class="pt-empty-box">Not saved yet</div>',
            actions: actions
        });
    }

    window._ptSaveAsCb = function (files) {
        if (!files || !files.length) { return; }
        var fp = files[0].filepath;
        var name = files[0].filename || fp.split('/').pop();
        if (!/\.pdf$/i.test(name)) {
            name += '.pdf';
            fp += '.pdf';
        }
        writeTo(T.dirOf(fp), name);
    };

    /* ── Boot ───────────────────────────────────────────────────────── */

    function boot() {
        rootEl = $('peRoot');
        stageEl = $('peStage');
        propsEl = $('peProps');
        stampMenu = $('peStampMenu');
        zoomEl = $('peZoom');
        fileNameEl = $('peFileName');

        editButtons = ['peAddText', 'peAddImg', 'peUpload', 'peAddStamp', 'peSave', 'peSaveMenu', 'peZoom']
            .map(function (id) { return $(id); });

        var ICON = {
            server: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2" width="11" height="4" rx="1"/><rect x="1.5" y="8" width="11" height="4" rx="1"/><circle cx="4" cy="4" r="0.6" fill="currentColor"/><circle cx="4" cy="10" r="0.6" fill="currentColor"/></svg>',
            device: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 9V2.5M4.3 5.2 7 2.5l2.7 2.7"/><path d="M2 9.5v1.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9.5"/></svg>',
            images: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="11" height="9" rx="1.3"/><circle cx="4.7" cy="5.5" r="1"/><path d="M1.5 10 L5 6.5 L7.5 8.5 L10 5.5 L12.5 9"/></svg>',
            save: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2h7.5L12 4.5V12H2z"/><path d="M4.5 2v3h4V2"/><rect x="4.5" y="7.5" width="5" height="3.5"/></svg>',
            expt: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="11" height="9" rx="1.3"/><path d="M1.5 10 L5 6.5 L7.5 8.5 L10 5.5 L12.5 9"/><circle cx="4.7" cy="5.5" r="1"/></svg>',
            download: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 2v6.5M4.3 5.8 7 8.5l2.7-2.7"/><path d="M2 10v1.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V10"/></svg>'
        };

        var openDeviceInput = $('peOpenDeviceInput');

        $('peOpen').addEventListener('click', function () {
            T.menu(this, [
                {
                    label: 'Open from server…', icon: ICON.server, onClick: function () {
                        ao_module_openFileSelector('_ptPickPdf', 'user:/', 'file', false, { filter: ['pdf'] });
                    }
                },
                {
                    label: 'Open from this device…', icon: ICON.device, onClick: function () {
                        openDeviceInput.value = '';
                        openDeviceInput.click();
                    }
                },
                { separator: true },
                { label: 'Create from images…', icon: ICON.images, onClick: function () { T.openImagesToPdf(); } }
            ]);
        });

        openDeviceInput.addEventListener('change', function () {
            if (!this.files || !this.files.length) { return; }
            var f = this.files[0];
            f.arrayBuffer().then(function (buf) {
                openBytes(new Uint8Array(buf), f.name, null);
            });
        });

        $('peAddText').addEventListener('click', function () {
            if (!canvas) { return; }
            addOverlay({
                type: 'text', t: 'Double-click to edit', fx: 0.12, fy: 0.12,
                fontFrac: 24 / canvas.height, color: $('peColor').value || '#d0021b'
            });
        });

        $('peAddImg').addEventListener('click', function () {
            ao_module_openFileSelector('_ptPickImg', 'user:/', 'file', false,
                { filter: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] });
        });

        var uploadInput = $('peUploadInput');
        $('peUpload').addEventListener('click', function () {
            uploadInput.value = '';
            uploadInput.click();
        });
        uploadInput.addEventListener('change', function () {
            if (!this.files || !this.files.length) { return; }
            var reader = new FileReader();
            reader.onload = function (ev) { placeImageFromSrc(ev.target.result); };
            reader.readAsDataURL(this.files[0]);
        });

        // Keep the button's own events off the document closer below, so clicking
        // the icon (the event target is the inner <svg>) toggles rather than closes.
        $('peAddStamp').addEventListener('mousedown', function (e) { e.stopPropagation(); });
        $('peAddStamp').addEventListener('click', function (e) {
            e.stopPropagation();
            if (stampMenu.classList.contains('show')) {
                stampMenu.classList.remove('show');
                return;
            }
            openStampMenu(this);
        });

        document.addEventListener('mousedown', function (e) {
            if (!stampMenu.contains(e.target)) { stampMenu.classList.remove('show'); }
        });

        $('pePrev').addEventListener('click', function () {
            if (doc.page > 1) { doc.page--; renderPage(doc.page); }
        });
        $('peNext').addEventListener('click', function () {
            if (doc.page < doc.num) { doc.page++; renderPage(doc.page); }
        });

        zoomEl.addEventListener('change', function () {
            zoom = this.value === 'fit' ? 'fit' : parseFloat(this.value);
            if (doc.pdf) { renderPage(doc.page); }
        });

        $('peFontSize').addEventListener('input', function () {
            $('peFontVal').textContent = this.value + 'px';
            if (sel && sel.o.type === 'text') {
                sel.o.fontFrac = parseInt(this.value, 10) / canvas.height;
                sel.el.style.fontSize = this.value + 'px';
            }
        });
        $('peColor').addEventListener('input', function () {
            if (sel && sel.o.type === 'text') {
                sel.o.color = this.value;
                sel.el.style.color = this.value;
            }
        });

        $('peSave').addEventListener('click', save);
        $('peSaveMenu').addEventListener('click', function () {
            T.menu(this, [
                { label: 'Save…', icon: ICON.save, onClick: save },
                { label: 'Download to this device', icon: ICON.download, onClick: downloadPdf },
                { separator: true },
                {
                    label: 'Export pages as images…', icon: ICON.expt,
                    onClick: function () { T.openExportImages(doc); }
                }
            ]);
        });

        /* ── Drag and drop: File Manager items and OS files ── */
        ['dragenter', 'dragover'].forEach(function (ev) {
            stageEl.addEventListener(ev, function (e) {
                e.preventDefault();
                stageEl.classList.add('dragover');
            });
        });
        stageEl.addEventListener('dragleave', function (e) {
            if (e.relatedTarget && stageEl.contains(e.relatedTarget)) { return; }
            stageEl.classList.remove('dragover');
        });
        stageEl.addEventListener('drop', function (e) {
            e.preventDefault();
            stageEl.classList.remove('dragover');

            // Dropped from the OS
            if (e.dataTransfer.files && e.dataTransfer.files.length) {
                var f = e.dataTransfer.files[0];
                if (!/\.pdf$/i.test(f.name)) { T.toast('Only PDF files can be opened here.', true); return; }
                f.arrayBuffer().then(function (buf) {
                    openBytes(new Uint8Array(buf), f.name, null);
                });
                return;
            }

            // Dropped from the ArozOS File Manager
            var info = null;
            try { info = ao_module_utils.getDropFileInfo(e); } catch (err) { info = null; }
            if (info && info.length) {
                if (!/\.pdf$/i.test(info[0].filename)) {
                    T.toast('Only PDF files can be opened here.', true);
                    return;
                }
                openPdf(info[0].filepath, info[0].filename);
            }
        });

        // Re-fit on resize (Fit mode only)
        new ResizeObserver(function () {
            if (!doc.pdf || zoom !== 'fit') { return; }
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () { if (doc.pdf) { renderPage(doc.page); } }, 120);
        }).observe(stageEl);

        window._ptPickPdf = function (files) {
            if (!files || !files.length) { return; }
            openPdf(files[0].filepath, files[0].filename);
        };
        window._ptPickImg = function (files) {
            if (!files || !files.length) { return; }
            placeImageFromSrc(T.mediaUrl(files[0].filepath));
        };

        // Opened with a file (embedded mode or "open with")
        var input = ao_module_loadInputFiles();
        if (input && input.length) {
            openPdf(input[0].filepath, input[0].filename);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})(window.PDFTool);
