/*
    PDF Tool — shared helpers

    Virtual-path utilities, byte/canvas helpers, lazy loaders for the two PDF
    libraries, and the toast + modal primitives used by the editor and dialogs.
*/

window.PDFTool = window.PDFTool || {};

(function (T) {
    'use strict';

    /* ── Virtual path helpers ───────────────────────────────────────── */

    T.dirOf = function (vpath) {
        var p = vpath.split('/');
        p.pop();
        return p.join('/');
    };

    T.basenameNoExt = function (vpath) {
        var n = vpath.split('/').pop();
        var d = n.lastIndexOf('.');
        return d > 0 ? n.slice(0, d) : n;
    };

    T.mediaUrl = function (vpath) {
        return '/media?file=' + encodeURIComponent(vpath);
    };

    T.escHtml = function (s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    /* ── Transfer helpers ───────────────────────────────────────────── */

    T.uploadBlob = function (blob, filename, targetDir) {
        return new Promise(function (resolve, reject) {
            ao_module_uploadFile(new File([blob], filename, { type: blob.type }),
                targetDir, resolve, undefined, reject);
        });
    };

    T.fetchBytes = function (url) {
        return fetch(url).then(function (r) {
            if (!r.ok) { throw new Error('HTTP ' + r.status); }
            return r.arrayBuffer();
        }).then(function (buf) { return new Uint8Array(buf); });
    };

    T.canvasToBytes = function (c, mime, quality) {
        return new Promise(function (resolve, reject) {
            c.toBlob(function (blob) {
                if (!blob) { reject(new Error('Canvas export failed')); return; }
                var fr = new FileReader();
                fr.onload = function (e) { resolve(new Uint8Array(e.target.result)); };
                fr.onerror = reject;
                fr.readAsArrayBuffer(blob);
            }, mime || 'image/png', quality);
        });
    };

    T.loadImage = function (src) {
        return new Promise(function (resolve, reject) {
            var img = new Image();
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error('Could not load image')); };
            img.src = src;
        });
    };

    /* ── Library loaders (both are lazy; pdf.js is shared with PDF Viewer) ── */

    var pdfJsReady = false;

    T.loadPdfJs = function () {
        return new Promise(function (resolve, reject) {
            if (pdfJsReady || typeof pdfjsLib !== 'undefined') {
                if (!pdfJsReady) {
                    pdfjsLib.GlobalWorkerOptions.workerSrc = '../PDF Viewer/js/pdf.worker.js';
                    pdfJsReady = true;
                }
                resolve();
                return;
            }
            var s = document.createElement('script');
            s.src = '../PDF Viewer/js/pdf.js';
            s.onload = function () {
                pdfjsLib.GlobalWorkerOptions.workerSrc = '../PDF Viewer/js/pdf.worker.js';
                pdfJsReady = true;
                resolve();
            };
            s.onerror = function () { reject(new Error('Failed to load the PDF renderer')); };
            document.head.appendChild(s);
        });
    };

    /* pdf-lib (vendored, MIT) — writes real PDF content instead of rasterising */
    T.loadPdfLib = function () {
        return new Promise(function (resolve, reject) {
            if (typeof PDFLib !== 'undefined') { resolve(); return; }
            var s = document.createElement('script');
            s.src = 'lib/pdf-lib.min.js';
            s.onload = function () { resolve(); };
            s.onerror = function () { reject(new Error('Failed to load pdf-lib')); };
            document.head.appendChild(s);
        });
    };

    /*
        Fetch an image and normalise it to bytes a PDF can hold directly.
        PNG and JPEG pass through untouched; anything else is drawn to a canvas and
        re-encoded as PNG so transparency survives.

        Returns {bytes, isPng}. Kept separate from embedding so a caller can embed
        the same source more than once and get an independent PDF image object each
        time (see the editor: every placement is its own layer).
    */
    T.imageBytesFor = function (src) {
        return T.fetchBytes(src).then(function (bytes) {
            if (bytes[0] === 0x89 && bytes[1] === 0x50) { return { bytes: bytes, isPng: true }; }
            if (bytes[0] === 0xFF && bytes[1] === 0xD8) { return { bytes: bytes, isPng: false }; }
            return T.loadImage(src).then(function (img) {
                var c = document.createElement('canvas');
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
                c.getContext('2d').drawImage(img, 0, 0);
                return T.canvasToBytes(c, 'image/png').then(function (png) {
                    return { bytes: png, isPng: true };
                });
            });
        });
    };

    /* Embed an image into a pdf-lib document as a fresh, independent image object. */
    T.embedImage = function (pdfDoc, src) {
        return T.imageBytesFor(src).then(function (r) {
            return r.isPng ? pdfDoc.embedPng(r.bytes) : pdfDoc.embedJpg(r.bytes);
        });
    };

    /* ── Toast ──────────────────────────────────────────────────────── */

    /* A pill at the bottom centre of the stage. Always fades itself out. */
    T.toast = function (html, isError) {
        var el = document.getElementById('ptToast');
        if (!el) { return; }
        el.innerHTML = '<div class="pe-pill' + (isError ? ' err' : '') + '">' + html + '</div>';
        el.classList.add('show');
        clearTimeout(el._t);
        el._t = setTimeout(function () { el.classList.remove('show'); }, isError ? 6000 : 4000);
    };

    T.hideToast = function () {
        var el = document.getElementById('ptToast');
        if (el) {
            clearTimeout(el._t);
            el.classList.remove('show');
        }
    };

    /* ── Dropdown menu ──────────────────────────────────────────────── */

    /*
        PDFTool.menu(anchorEl, [{label, icon, onClick, disabled}, {separator:true}])
        Positions itself under the anchor inside .pe-root and closes on outside
        click or Escape.
    */
    T.menu = function (anchor, items) {
        var root = document.getElementById('peRoot');
        var existing = root.querySelector('.pe-menu');
        if (existing) { existing.parentNode.removeChild(existing); }

        var menu = document.createElement('div');
        menu.className = 'pe-menu';

        items.forEach(function (it) {
            if (it.separator) {
                var hr = document.createElement('div');
                hr.className = 'pe-menu-sep';
                menu.appendChild(hr);
                return;
            }
            var b = document.createElement('button');
            b.className = 'pe-menu-item';
            b.disabled = !!it.disabled;
            b.innerHTML = '<span class="pe-menu-ico">' + (it.icon || '') + '</span><span>' + T.escHtml(it.label) + '</span>';
            b.addEventListener('click', function () {
                close();
                if (it.onClick) { it.onClick(); }
            });
            menu.appendChild(b);
        });

        function close() {
            if (menu.parentNode) { menu.parentNode.removeChild(menu); }
            document.removeEventListener('mousedown', onDoc, true);
            document.removeEventListener('keydown', onKey);
        }
        function onDoc(e) {
            if (!menu.contains(e.target) && !anchor.contains(e.target)) { close(); }
        }
        function onKey(e) { if (e.key === 'Escape') { close(); } }

        root.appendChild(menu);

        // Position under the anchor, clamped to the app's right edge
        var a = anchor.getBoundingClientRect();
        var r = root.getBoundingClientRect();
        var left = a.left - r.left;
        menu.style.top = (a.bottom - r.top + 6) + 'px';
        menu.style.left = Math.max(6, Math.min(left, r.width - menu.offsetWidth - 6)) + 'px';

        setTimeout(function () {
            document.addEventListener('mousedown', onDoc, true);
            document.addEventListener('keydown', onKey);
        }, 0);

        return { close: close };
    };

    /* ── Modal ──────────────────────────────────────────────────────── */

    /*
        PDFTool.modal({
            title:      "Dialog title",
            bodyHtml:   "<p>…</p>",
            actions:    [{label:"Save", primary:true, onClick:function(ctx){…}}],
            dismissible:false,          // disables backdrop click + Escape
            onOpen:     function(ctx){} // ctx = {body, footer, close}
        })
    */
    T.modal = function (opts) {
        var back = document.createElement('div');
        back.className = 'pt-modal-back';
        back.innerHTML =
            '<div class="pt-modal" role="dialog" aria-modal="true">' +
                '<div class="pt-modal-hd">' +
                    '<span>' + T.escHtml(opts.title || '') + '</span>' +
                    '<button class="pt-modal-x" title="Close" aria-label="Close">' +
                        '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">' +
                        '<line x1="1.5" y1="1.5" x2="10.5" y2="10.5"/><line x1="10.5" y1="1.5" x2="1.5" y2="10.5"/></svg>' +
                    '</button>' +
                '</div>' +
                '<div class="pt-modal-bd"></div>' +
                '<div class="pt-modal-ft"></div>' +
            '</div>';

        var body = back.querySelector('.pt-modal-bd');
        var foot = back.querySelector('.pt-modal-ft');
        if (opts.bodyHtml) { body.innerHTML = opts.bodyHtml; }

        function close() {
            if (back.parentNode) { back.parentNode.removeChild(back); }
            document.removeEventListener('keydown', onKey);
        }

        function onKey(e) {
            if (e.key === 'Escape' && opts.dismissible !== false) { close(); }
        }

        var ctx = { body: body, footer: foot, close: close };

        (opts.actions || []).forEach(function (a) {
            var b = document.createElement('button');
            b.className = 'pt-btn' + (a.primary ? ' primary' : '');
            b.textContent = a.label;
            b.addEventListener('click', function () {
                if (a.onClick) { a.onClick({ body: body, footer: foot, close: close, button: b }); }
            });
            foot.appendChild(b);
            if (a.id) { b.id = a.id; }
        });

        back.querySelector('.pt-modal-x').addEventListener('click', close);
        back.addEventListener('mousedown', function (e) {
            if (e.target === back && opts.dismissible !== false) { close(); }
        });
        document.addEventListener('keydown', onKey);

        document.body.appendChild(back);
        if (opts.onOpen) { opts.onOpen(ctx); }
        return ctx;
    };

    /* ── Small inline icons ─────────────────────────────────────────── */

    T.svg = {
        up: '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8.5 L6.5 4 L10.5 8.5"/></svg>',
        down: '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5 L6.5 9 L10.5 4.5"/></svg>',
        x: '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="2" y1="2" x2="11" y2="11"/><line x1="11" y1="2" x2="2" y2="11"/></svg>'
    };

})(window.PDFTool);
