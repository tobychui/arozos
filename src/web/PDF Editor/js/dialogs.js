/*
    PDF Editor - dialogs

    Links, crop, snapshot, pictures, signatures, stamps, blank / inserted
    pages, extract and split, attachments, keyboard shortcuts and About.
    Signatures are kept per user as PNG files in
    user:/.appdata/PDF Editor/Signatures (backend/signatures.agi lists and
    deletes them); without a backend they stay in this browser.
*/
window.PE = window.PE || {};

(function (PE) {
    'use strict';

    var D = PE.doc;
    var V = PE.view;
    var F = PE.fonts;
    var T = PE.T;
    var DL = PE.dialogs = {};

    var SIG_DIR = 'user:/.appdata/PDF Editor/Signatures';

    /* ------------------------------------------------------------ links */
    DL.link = function (existing, cb) {
        var isPage = existing && !existing.url && existing.page >= 0;
        var body = PE.el('div', 'pe-form');
        body.innerHTML =
            '<label class="pe-check"><input type="radio" name="lk" value="url"' + (isPage ? '' : ' checked') + '>' + PE.esc(T('link/web', 'Web address')) + '</label>' +
            '<input class="pe-input" type="text" data-url placeholder="https://" value="' + PE.esc(existing && existing.url ? existing.url : '') + '">' +
            '<label class="pe-check"><input type="radio" name="lk" value="page"' + (isPage ? ' checked' : '') + '>' + PE.esc(T('link/page', 'Page in this document')) + '</label>' +
            '<div class="pe-row"><input class="pe-input num" type="number" min="1" max="' + D.pages.length + '" data-page value="' + (isPage ? existing.page + 1 : 1) + '">' +
            '<span class="pe-note">' + PE.esc(T('link/ofN', 'of {n}', { n: D.pages.length })) + '</span></div>';
        var url = body.querySelector('[data-url]'), pg = body.querySelector('[data-page]');
        url.addEventListener('focus', function () { body.querySelector('[value=url]').checked = true; });
        pg.addEventListener('focus', function () { body.querySelector('[value=page]').checked = true; });
        PE.dialog({
            title: existing ? T('link/edit', 'Edit link') : T('link/add', 'Add link'),
            body: body,
            buttons: [
                { label: T('common/cancel', 'Cancel') },
                {
                    label: T('common/ok', 'OK'), primary: true, onClick: function () {
                        if (body.querySelector('[value=url]').checked) {
                            var u = url.value.trim();
                            if (!u) {
                                url.focus();
                                return false;
                            }
                            if (!/^[a-z][a-z0-9+.\-]*:/i.test(u)) {
                                u = (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(u) ? 'mailto:' : 'https://') + u;
                            }
                            cb({ url: u, page: -1 });
                        } else {
                            var n = parseInt(pg.value, 10);
                            if (!(n >= 1 && n <= D.pages.length)) {
                                pg.focus();
                                return false;
                            }
                            cb({ url: '', page: n - 1 });
                        }
                    }
                }
            ]
        });
    };

    /* ------------------------------------------------------------ crop */
    DL.crop = function (k, r) {
        var body = PE.el('div', 'pe-form');
        var mm = function (v) { return Math.round(v / 72 * 25.4); };
        body.innerHTML = '<p>' + PE.esc(T('crop/size', 'The kept area is {w} \u00d7 {h} mm.', { w: mm(r.w), h: mm(r.h) })) + '</p>' +
            '<label class="pe-check"><input type="radio" name="cr" value="this" checked>' + PE.esc(T('crop/this', 'This page')) + '</label>' +
            '<label class="pe-check"><input type="radio" name="cr" value="all">' + PE.esc(T('crop/all', 'All pages of the same size')) + '</label>' +
            '<div class="pe-note">' + PE.esc(T('crop/note', 'Cropping hides the rest of the page; the content stays in the file.')) + '</div>';
        PE.dialog({
            title: T('crop/title', 'Crop pages'),
            body: body,
            buttons: [
                { label: T('common/cancel', 'Cancel') },
                {
                    label: T('crop/apply', 'Crop'), primary: true, onClick: function () {
                        var all = body.querySelector('[value=all]').checked;
                        var d0 = D.dims(k);
                        var ks = [];
                        D.pages.forEach(function (p, i) {
                            if (i === k) {
                                ks.push(i);
                                return;
                            }
                            if (all) {
                                var d = D.dims(i);
                                if (Math.abs(d.W - d0.W) < 1 && Math.abs(d.H - d0.H) < 1) {
                                    ks.push(i);
                                }
                            }
                        });
                        D.change(function () {
                            ks.forEach(function (i) {
                                var d = D.dims(i);
                                var x = Math.max(0, r.x), y = Math.max(0, r.y);
                                D.pages[i].crop = { x: x, y: y, w: Math.min(d.W - x, r.w), h: Math.min(d.H - y, r.h) };
                            });
                        }, { pages: ks, structure: true });
                    }
                }
            ]
        });
    };

    /* ------------------------------------------------------------ snapshot */
    DL.snapshot = function (k, r) {
        var b = PE.busy(T('snap/making', 'Capturing...'));
        PE.convert.renderPage(k, 3).then(function (c) {
            b.close();
            var s = c.width / D.dims(k).W;
            var out = document.createElement('canvas');
            out.width = Math.max(1, Math.round(r.w * s));
            out.height = Math.max(1, Math.round(r.h * s));
            var ctx = out.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, out.width, out.height);
            ctx.drawImage(c, -r.x * s, -r.y * s);
            return PE.canvasToBlob(out, 'image/png').then(function (blob) {
                var url = URL.createObjectURL(blob);
                var body = PE.el('div', 'pe-form', '<div style="text-align:center;background:var(--viewer);border-radius:8px;padding:10px"><img style="max-width:100%;max-height:300px;box-shadow:var(--page-shadow)"></div>');
                body.querySelector('img').src = url;
                var name = PE.stem(D.name) + '_p' + (k + 1) + '.png';
                var buttons = [
                    {
                        label: T('snap/copy', 'Copy'), primary: true, onClick: function () {
                            try {
                                navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(function () {
                                    PE.toast(T('snap/copied', 'Copied to the clipboard.'));
                                }, function () {
                                    PE.toast(T('snap/noClipboard', 'The browser did not allow copying. Use Download instead.'), { error: true });
                                });
                            } catch (e) {
                                PE.toast(T('snap/noClipboard', 'The browser did not allow copying. Use Download instead.'), { error: true });
                            }
                        }
                    },
                    { label: T('snap/download', 'Download'), onClick: function () { PE.downloadBytes(blob, name); } }
                ];
                if (PE.hasBackend) {
                    buttons.push({
                        label: T('snap/save', 'Save to...'), onClick: function () {
                            PE.pickServer({ type: 'new', root: D.path ? PE.dirOf(D.path) : 'user:/Desktop', defaultName: name, filter: ['png'], key: 'export' }).then(function (files) {
                                if (!files.length) {
                                    return;
                                }
                                var fp = files[0].filepath;
                                if (!/\.png$/i.test(fp)) {
                                    fp += '.png';
                                }
                                PE.upload(blob, PE.baseName(fp), PE.dirOf(fp)).then(function () {
                                    PE.toast(T('save/saved', 'Saved to {path}', { path: fp }));
                                }, function (err) {
                                    PE.toast(err.message, { error: true });
                                });
                            });
                        }
                    });
                }
                buttons.push({
                    label: T('snap/insert', 'Paste on page'), left: true, onClick: function () {
                        PE.readFile(blob).then(function (bytes) {
                            var id = D.addAsset(bytes, 'image/png', out.width, out.height);
                            PE.objs.add(k, { type: 'image', asset: id, x: r.x + 12, y: r.y + 12, w: r.w, h: r.h, angle: 0 });
                        });
                    }
                });
                PE.dialog({
                    title: T('snap/title', 'Snapshot'), body: body, buttons: buttons, onClose: function () {
                        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
                    }
                });
            });
        }).catch(function (err) {
            b.close();
            PE.toast(err.message || String(err), { error: true });
        });
    };

    /* ------------------------------------------------------------ pictures */
    DL.chooseImage = function () {
        return new Promise(function (resolve) {
            function fromFiles(files) {
                if (!files.length) {
                    resolve(null);
                    return;
                }
                PE.readFile(files[0]).then(D.assetFromBytes).then(resolve, function (err) {
                    PE.toast(err.message, { error: true });
                    resolve(null);
                });
            }
            if (!PE.hasBackend) {
                PE.pickLocal('image/*', false).then(fromFiles);
                return;
            }
            var picked = false;
            var body = PE.el('div', 'pe-form', '<p>' + PE.esc(T('img/where', 'Where is the picture?')) + '</p>');
            var ctx = PE.dialog({
                title: T('img/title', 'Insert a picture'),
                body: body,
                buttons: [
                    {
                        label: T('img/device', 'This device'), onClick: function () {
                            picked = true;
                            PE.pickLocal('image/*', false).then(fromFiles);
                        }
                    },
                    {
                        label: T('img/arozos', 'My files'), primary: true, onClick: function () {
                            picked = true;
                            PE.pickServer({ filter: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'], key: 'image' }).then(function (files) {
                                if (!files.length) {
                                    resolve(null);
                                    return;
                                }
                                PE.fetchBytes(PE.mediaUrl(files[0].filepath)).then(D.assetFromBytes).then(resolve, function (err) {
                                    PE.toast(err.message, { error: true });
                                    resolve(null);
                                });
                            });
                        }
                    }
                ],
                onClose: function () {
                    if (!picked) {
                        resolve(null);
                    }
                }
            });
            return ctx;
        });
    };

    /* Arm the place tool with an object maker; the ghost follows the mouse */
    DL.placeObject = function (w, h, ghostHtml, make, hint) {
        V.setTool('place', {
            ghost: { w: w, h: h, html: ghostHtml },
            hint: hint,
            make: function (k, pt) {
                var o = make();
                o.x = pt.x - o.w / 2;
                o.y = pt.y - o.h / 2;
                return o;
            }
        });
    };

    DL.placeImage = function (assetId, hint) {
        var a = D.assets[assetId];
        var k = V.cur;
        var d = D.dims(k);
        var maxW = d.w * 0.5, maxH = d.h * 0.5;
        var w = a.w * 0.75 || 200, h = a.h * 0.75 || 150;
        var f = Math.min(1, maxW / w, maxH / h);
        w *= f;
        h *= f;
        DL.placeObject(w, h, '<img src="' + a.url + '" style="width:100%;height:100%;display:block">', function () {
            return { type: 'image', asset: assetId, w: w, h: h, angle: 0 };
        }, hint || T('hint/placeImage', 'Click on a page to put the picture there.'));
    };

    DL.addImage = function () {
        DL.chooseImage().then(function (id) {
            if (id) {
                DL.placeImage(id);
            }
        });
    };

    /* ------------------------------------------------------------ stamps */
    DL.STAMPS = [
        ['APPROVED', '#107c10'], ['REJECTED', '#c42b1c'], ['DRAFT', '#0f6cbd'], ['CONFIDENTIAL', '#c42b1c'],
        ['FINAL', '#107c10'], ['FOR REVIEW', '#ca5010'], ['RECEIVED', '#0f6cbd'], ['PAID', '#107c10'],
        ['COMPLETED', '#107c10'], ['NOT APPROVED', '#c42b1c'], ['VOID', '#616161'], ['SAMPLE', '#5c2d91']
    ];

    function stampObj(text, color, withDate) {
        var o = {
            type: 'text', text: withDate ? text + '\n' + PE.fmtDay(new Date()) : text, font: 'helv', size: 18, bold: true, color: color,
            border: color, borderW: 2, radius: 5, pad: 7, align: 'center', lh: 1.15, wrap: false, x: 0, y: 0, w: 10, h: 10, angle: 0
        };
        F.fit(o);
        return o;
    }

    DL.placeStamp = function (text, color, withDate) {
        var o = stampObj(text, color, withDate);
        var svg = '<svg viewBox="0 0 ' + o.w + ' ' + o.h + '" style="width:100%;height:100%;overflow:visible">' + PE.objs.svgBody(o) + '</svg>';
        DL.placeObject(o.w, o.h, svg, function () {
            return stampObj(text, color, withDate);
        }, T('hint/placeStamp', 'Click on a page to stamp it.'));
    };

    DL.customStamp = function () {
        var body = PE.el('div', 'pe-form');
        body.innerHTML = '<div class="pe-row"><label>' + PE.esc(T('stamp/text', 'Text')) + '</label><input class="pe-input grow" type="text" data-t value="' + PE.esc(T('stamp/default', 'CHECKED')) + '"></div>' +
            '<div class="pe-row"><label>' + PE.esc(T('fmt/color', 'Colour')) + '</label><input type="color" class="pe-color" data-c value="#0f6cbd"></div>' +
            '<div class="pe-row"><label></label><label class="pe-check"><input type="checkbox" data-d checked>' + PE.esc(T('stamp/withDate', "Add today's date")) + '</label></div>';
        PE.dialog({
            title: T('stamp/custom', 'Custom stamp'),
            body: body,
            buttons: [
                { label: T('common/cancel', 'Cancel') },
                {
                    label: T('stamp/place', 'Place'), primary: true, onClick: function () {
                        var t = body.querySelector('[data-t]').value.trim();
                        if (!t) {
                            return false;
                        }
                        DL.placeStamp(t, body.querySelector('[data-c]').value, body.querySelector('[data-d]').checked);
                    }
                }
            ]
        });
    };

    DL.dateStamp = function () {
        var st = PE.objs.style.text;
        var mk = function () {
            var o = { type: 'text', text: PE.fmtDay(new Date()), font: st.font, size: st.size, color: st.color, bold: false, italic: false, align: 'left', lh: 1.2, wrap: false, x: 0, y: 0, w: 10, h: 10, angle: 0 };
            F.fit(o);
            return o;
        };
        var g = mk();
        DL.placeObject(g.w, g.h, '<svg viewBox="0 0 ' + g.w + ' ' + g.h + '" style="width:100%;height:100%;overflow:visible">' + PE.objs.svgBody(g) + '</svg>', mk,
            T('hint/placeDate', 'Click on a page to put the date there.'));
    };

    /* ------------------------------------------------------------ signatures */
    var sigCache = null;    //[{id, url, name}]
    var LS_SIG = 'pdfeditor.signatures';

    DL.listSignatures = function () {
        if (sigCache) {
            return Promise.resolve(sigCache);
        }
        if (!PE.hasBackend) {
            try {
                sigCache = JSON.parse(localStorage.getItem(LS_SIG) || '[]');
            } catch (e) {
                sigCache = [];
            }
            return Promise.resolve(sigCache);
        }
        return PE.agi('signatures.agi', { opr: 'list' }).then(function (r) {
            sigCache = ((r && r.files) || []).map(function (f) {
                return { id: f.path, name: f.name, url: PE.mediaUrl(f.path) + '&t=' + (f.mtime || 0) };
            });
            return sigCache;
        }).catch(function () {
            sigCache = [];
            return sigCache;
        });
    };

    function storeSignature(blob) {
        sigCache = null;
        if (!PE.hasBackend) {
            return PE.readDataUrl(blob).then(function (url) {
                var list = [];
                try {
                    list = JSON.parse(localStorage.getItem(LS_SIG) || '[]');
                } catch (e) {
                    list = [];
                }
                list.unshift({ id: PE.uid('s'), name: 'signature', url: url });
                try {
                    localStorage.setItem(LS_SIG, JSON.stringify(list.slice(0, 8)));
                } catch (e) {
                    PE.toast(T('sig/noSpace', 'The signature could not be kept in this browser.'), { error: true });
                }
            });
        }
        var name = 'sig_' + Date.now() + '.png';
        return PE.upload(blob, name, SIG_DIR);
    }

    DL.deleteSignature = function (sig) {
        sigCache = null;
        if (!PE.hasBackend) {
            try {
                var list = JSON.parse(localStorage.getItem(LS_SIG) || '[]').filter(function (s) { return s.id !== sig.id; });
                localStorage.setItem(LS_SIG, JSON.stringify(list));
            } catch (e) {
                //nothing kept
            }
            return Promise.resolve();
        }
        return PE.agi('signatures.agi', { opr: 'delete', path: sig.id });
    };

    DL.useSignature = function (sig) {
        PE.fetchBytes(sig.url).then(D.assetFromBytes).then(function (id) {
            var a = D.assets[id];
            var w = 150, h = a.w ? 150 * a.h / a.w : 50;
            if (h > 70) {
                w *= 70 / h;
                h = 70;
            }
            DL.placeObject(w, h, '<img src="' + a.url + '" style="width:100%;height:100%;display:block">', function () {
                return { type: 'image', asset: id, w: w, h: h, angle: 0 };
            }, T('hint/placeSig', 'Click where the signature goes.'));
        }).catch(function (err) {
            PE.toast(err.message, { error: true });
        });
    };

    /* Trim transparent edges and turn white into transparent */
    function cleanSignature(canvas, knockWhite) {
        var ctx = canvas.getContext('2d');
        var w = canvas.width, h = canvas.height;
        var img = ctx.getImageData(0, 0, w, h);
        var px = img.data;
        var x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var o = (y * w + x) * 4;
                if (knockWhite) {
                    var lum = (px[o] + px[o + 1] + px[o + 2]) / 3;
                    if (lum > 235) {
                        px[o + 3] = 0;
                    } else if (lum > 200) {
                        px[o + 3] = Math.round(px[o + 3] * (235 - lum) / 35);
                    }
                }
                if (px[o + 3] > 16) {
                    if (x < x0) { x0 = x; }
                    if (y < y0) { y0 = y; }
                    if (x > x1) { x1 = x; }
                    if (y > y1) { y1 = y; }
                }
            }
        }
        if (x1 < 0) {
            return null;
        }
        ctx.putImageData(img, 0, 0);
        var m = 6;
        x0 = Math.max(0, x0 - m);
        y0 = Math.max(0, y0 - m);
        x1 = Math.min(w - 1, x1 + m);
        y1 = Math.min(h - 1, y1 + m);
        var out = document.createElement('canvas');
        out.width = x1 - x0 + 1;
        out.height = y1 - y0 + 1;
        out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
        return out;
    }

    var SCRIPT_FONTS = ['"Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive', '"Lucida Handwriting", "Segoe Script", cursive',
        '"Brush Script MT", "Segoe Script", cursive', '"Ink Free", "Segoe Print", "Comic Sans MS", cursive'];

    DL.createSignature = function () {
        var body = PE.el('div');
        var color = '#0b2a6f';
        body.innerHTML = '<div class="pe-tabsel"><button type="button" class="on" data-tab="draw">' + PE.esc(T('sig/draw', 'Draw')) + '</button>' +
            '<button type="button" data-tab="type">' + PE.esc(T('sig/type', 'Type')) + '</button>' +
            '<button type="button" data-tab="image">' + PE.esc(T('sig/image', 'Image')) + '</button></div>' +
            '<div data-pane="draw"><canvas class="pe-sigpad" width="1000" height="360"></canvas>' +
            '<div class="pe-row" style="margin-top:8px"><span class="pe-note grow">' + PE.esc(T('sig/drawHint', 'Sign with your mouse, pen or finger.')) + '</span>' +
            '<button type="button" class="pe-btn sm" data-clear>' + PE.esc(T('sig/clear', 'Clear')) + '</button></div></div>' +
            '<div data-pane="type" hidden><input class="pe-input" style="width:100%" type="text" data-name placeholder="' + PE.esc(T('sig/yourName', 'Your name')) + '">' +
            '<div data-fonts style="display:grid;gap:6px;margin-top:8px"></div></div>' +
            '<div data-pane="image" hidden><p>' + PE.esc(T('sig/imageHint', 'Use a photo or scan of your signature. A white background is made transparent.')) + '</p>' +
            '<button type="button" class="pe-btn" data-pick>' + PE.esc(T('sig/choose', 'Choose a picture...')) + '</button>' +
            '<div style="margin-top:10px;text-align:center"><img data-preview style="max-width:100%;max-height:140px" hidden></div></div>' +
            '<div class="pe-row" style="margin-top:12px"><span class="pe-note">' + PE.esc(T('sig/ink', 'Ink')) + '</span>' +
            ['#0b2a6f', '#000000', '#1f5aa6', '#8b1a1a'].map(function (c) {
                return '<button type="button" data-ink="' + c + '" style="width:22px;height:22px;border-radius:50%;border:2px solid ' + (c === color ? 'var(--accent)' : 'transparent') + ';background:' + c + '"></button>';
            }).join('') +
            '<span class="grow"></span><label class="pe-check"><input type="checkbox" data-keep checked>' + PE.esc(T('sig/keep', 'Keep for next time')) + '</label></div>';
        var tab = 'draw';
        var pad = body.querySelector('canvas');
        var pctx = pad.getContext('2d');
        var drawn = false;
        var imgCanvas = null;
        var typedFont = SCRIPT_FONTS[0];
        function inkAll() {
            Array.prototype.forEach.call(body.querySelectorAll('[data-ink]'), function (b) {
                b.style.borderColor = b.dataset.ink === color ? 'var(--accent)' : 'transparent';
            });
            renderTyped();
        }
        Array.prototype.forEach.call(body.querySelectorAll('[data-ink]'), function (b) {
            b.addEventListener('click', function () {
                color = b.dataset.ink;
                inkAll();
            });
        });
        Array.prototype.forEach.call(body.querySelectorAll('[data-tab]'), function (b) {
            b.addEventListener('click', function () {
                tab = b.dataset.tab;
                Array.prototype.forEach.call(body.querySelectorAll('[data-tab]'), function (x) { x.classList.toggle('on', x === b); });
                Array.prototype.forEach.call(body.querySelectorAll('[data-pane]'), function (x) { x.hidden = x.dataset.pane !== tab; });
                if (tab === 'type') {
                    body.querySelector('[data-name]').focus();
                }
            });
        });
        //drawing pad
        var last = null;
        function pos(e) {
            var r = pad.getBoundingClientRect();
            return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height, e.pressure || 0.5];
        }
        pad.addEventListener('pointerdown', function (e) {
            pad.setPointerCapture(e.pointerId);
            last = pos(e);
            drawn = true;
        });
        pad.addEventListener('pointermove', function (e) {
            if (!last) {
                return;
            }
            var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
            (evs.length ? evs : [e]).forEach(function (ev) {
                var p = pos(ev);
                pctx.strokeStyle = color;
                pctx.lineCap = 'round';
                pctx.lineJoin = 'round';
                pctx.lineWidth = 3.2 + (ev.pointerType === 'pen' ? p[2] * 4 : 1.6);
                pctx.beginPath();
                pctx.moveTo(last[0], last[1]);
                pctx.lineTo(p[0], p[1]);
                pctx.stroke();
                last = p;
            });
        });
        ['pointerup', 'pointercancel'].forEach(function (n) {
            pad.addEventListener(n, function () { last = null; });
        });
        body.querySelector('[data-clear]').addEventListener('click', function () {
            pctx.clearRect(0, 0, pad.width, pad.height);
            drawn = false;
        });
        //typed
        var fontsBox = body.querySelector('[data-fonts]');
        function renderTyped() {
            var name = body.querySelector('[data-name]').value || T('sig/yourName', 'Your name');
            fontsBox.innerHTML = '';
            SCRIPT_FONTS.forEach(function (f) {
                var d = PE.el('div', 'pe-typed');
                d.style.fontFamily = f;
                d.style.color = color;
                d.style.cursor = 'pointer';
                d.style.fontSize = '34px';
                d.style.height = '64px';
                if (f === typedFont) {
                    d.style.boxShadow = '0 0 0 2px var(--accent)';
                }
                d.textContent = name;
                d.addEventListener('click', function () {
                    typedFont = f;
                    renderTyped();
                });
                fontsBox.appendChild(d);
            });
        }
        body.querySelector('[data-name]').addEventListener('input', renderTyped);
        renderTyped();
        //image
        body.querySelector('[data-pick]').addEventListener('click', function () {
            var go = function (bytes) {
                var url = URL.createObjectURL(new Blob([bytes]));
                PE.loadImage(url).then(function (img) {
                    var c = document.createElement('canvas');
                    var f = Math.min(1, 1200 / img.naturalWidth);
                    c.width = Math.round(img.naturalWidth * f);
                    c.height = Math.round(img.naturalHeight * f);
                    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                    imgCanvas = cleanSignature(c, true);
                    var pv = body.querySelector('[data-preview]');
                    if (imgCanvas) {
                        pv.src = imgCanvas.toDataURL('image/png');
                        pv.hidden = false;
                    }
                    URL.revokeObjectURL(url);
                });
            };
            if (PE.hasBackend) {
                PE.pickServer({ filter: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'], key: 'image' }).then(function (files) {
                    if (files.length) {
                        PE.fetchBytes(PE.mediaUrl(files[0].filepath)).then(go);
                    }
                });
            } else {
                PE.pickLocal('image/*').then(function (files) {
                    if (files.length) {
                        PE.readFile(files[0]).then(go);
                    }
                });
            }
        });
        function result() {
            if (tab === 'draw') {
                if (!drawn) {
                    return null;
                }
                var c = document.createElement('canvas');
                c.width = pad.width;
                c.height = pad.height;
                c.getContext('2d').drawImage(pad, 0, 0);
                return cleanSignature(c, false);
            }
            if (tab === 'type') {
                var name = body.querySelector('[data-name]').value.trim();
                if (!name) {
                    return null;
                }
                var c2 = document.createElement('canvas');
                var ctx = c2.getContext('2d');
                ctx.font = '120px ' + typedFont;
                var w = Math.ceil(ctx.measureText(name).width) + 60;
                c2.width = Math.min(4000, w);
                c2.height = 220;
                ctx = c2.getContext('2d');
                ctx.font = '120px ' + typedFont;
                ctx.fillStyle = color;
                ctx.textBaseline = 'middle';
                ctx.fillText(name, 30, 110);
                return cleanSignature(c2, false);
            }
            if (imgCanvas) {
                //recolour the ink
                var c3 = document.createElement('canvas');
                c3.width = imgCanvas.width;
                c3.height = imgCanvas.height;
                var x3 = c3.getContext('2d');
                x3.drawImage(imgCanvas, 0, 0);
                x3.globalCompositeOperation = 'source-in';
                x3.fillStyle = color;
                x3.fillRect(0, 0, c3.width, c3.height);
                return c3;
            }
            return null;
        }
        PE.dialog({
            title: T('sig/create', 'Create signature'),
            body: body,
            wide: true,
            buttons: [
                { label: T('common/cancel', 'Cancel') },
                {
                    label: T('sig/use', 'Use signature'), primary: true, onClick: function () {
                        var c = result();
                        if (!c) {
                            PE.toast(T('sig/empty', 'Draw, type or choose a signature first.'), { error: true });
                            return false;
                        }
                        var keep = body.querySelector('[data-keep]').checked;
                        PE.canvasToBlob(c, 'image/png').then(function (blob) {
                            var job = keep ? storeSignature(blob).catch(function (err) {
                                PE.toast(T('sig/notKept', 'The signature could not be kept: {e}', { e: err.message }), { error: true });
                            }) : Promise.resolve();
                            return job.then(function () {
                                return PE.readFile(blob);
                            });
                        }).then(function (bytes) {
                            var id = D.addAsset(bytes, 'image/png', c.width, c.height);
                            var w = 150, h = 150 * c.height / c.width;
                            if (h > 70) {
                                w *= 70 / h;
                                h = 70;
                            }
                            DL.placeObject(w, h, '<img src="' + D.assets[id].url + '" style="width:100%;height:100%;display:block">', function () {
                                return { type: 'image', asset: id, w: w, h: h, angle: 0 };
                            }, T('hint/placeSig', 'Click where the signature goes.'));
                        });
                    }
                }
            ]
        });
    };

    DL.manageSignatures = function () {
        DL.listSignatures().then(function (list) {
            var body = PE.el('div');
            function draw() {
                body.innerHTML = '';
                if (!list.length) {
                    body.innerHTML = '<p>' + PE.esc(T('sig/none', 'No signatures are kept yet.')) + '</p>';
                    return;
                }
                var grid = PE.el('div', 'pe-sig-tiles');
                list.forEach(function (sig) {
                    var t = PE.el('div', 'pe-sig-tile', '<img alt=""><button class="x" title="' + PE.esc(T('common/delete', 'Delete')) + '">' + PE.icon('trash', 'sm') + '</button>');
                    t.querySelector('img').src = sig.url;
                    t.querySelector('.x').addEventListener('click', function (e) {
                        e.stopPropagation();
                        DL.deleteSignature(sig).then(function () {
                            list = list.filter(function (s) { return s !== sig; });
                            draw();
                        }, function (err) {
                            PE.toast(err.message, { error: true });
                        });
                    });
                    t.addEventListener('click', function () {
                        ctx.close();
                        DL.useSignature(sig);
                    });
                    grid.appendChild(t);
                });
                body.appendChild(grid);
            }
            draw();
            var ctx = PE.dialog({
                title: T('sig/manage', 'Signatures'),
                body: body,
                buttons: [
                    { label: T('sig/new', 'New signature...'), left: true, onClick: function () { setTimeout(DL.createSignature, 0); } },
                    { label: T('common/close', 'Close'), primary: true }
                ]
            });
        });
    };

    /* ------------------------------------------------------------ pages */
    var SIZES = [['A4', 595.28, 841.89], ['Letter', 612, 792], ['Legal', 612, 1008], ['A3', 841.89, 1190.55], ['A5', 419.53, 595.28], ['B5', 498.9, 708.66]];

    function sizeForm(withCount) {
        return '<div class="pe-row"><label>' + PE.esc(T('page/size', 'Page size')) + '</label><select class="pe-select" data-size>' +
            (D.loaded && D.pages.length ? '<option value="cur">' + PE.esc(T('page/sameAsCurrent', 'Same as the current page')) + '</option>' : '') +
            SIZES.map(function (s) { return '<option value="' + s[0] + '">' + s[0] + '</option>'; }).join('') + '</select></div>' +
            '<div class="pe-row"><label>' + PE.esc(T('page/orient', 'Orientation')) + '</label><select class="pe-select" data-orient><option value="p">' +
            PE.esc(T('page/portrait', 'Portrait')) + '</option><option value="l">' + PE.esc(T('page/landscape', 'Landscape')) + '</option></select></div>' +
            (withCount ? '<div class="pe-row"><label>' + PE.esc(T('page/count', 'Pages')) + '</label><input class="pe-input num" type="number" min="1" max="500" value="1" data-count></div>' : '');
    }

    function readSize(body) {
        var v = body.querySelector('[data-size]').value;
        var w, h;
        if (v === 'cur') {
            var d = D.dims(V.cur);
            w = d.w;
            h = d.h;
        } else {
            SIZES.forEach(function (s) {
                if (s[0] === v) {
                    w = s[1];
                    h = s[2];
                }
            });
        }
        var land = body.querySelector('[data-orient]').value === 'l';
        if ((land && h > w) || (!land && w > h)) {
            var t = w;
            w = h;
            h = t;
        }
        var c = body.querySelector('[data-count]');
        return { w: w, h: h, n: c ? Math.max(1, Math.min(500, parseInt(c.value, 10) || 1)) : 1 };
    }

    DL.newBlank = function () {
        var body = PE.el('div', 'pe-form', sizeForm(true));
        PE.dialog({
            title: T('page/newTitle', 'New blank PDF'),
            body: body,
            buttons: [
                { label: T('common/cancel', 'Cancel') },
                {
                    label: T('page/create', 'Create'), primary: true, onClick: function () {
                        var s = readSize(body);
                        PE.app.confirmDiscard().then(function (ok) {
                            if (ok) {
                                D.newBlank(s.w, s.h, s.n);
                            }
                        });
                    }
                }
            ],
            onOpen: function () {
                var sel = body.querySelector('[data-size]');
                if (sel.querySelector('[value=cur]')) {
                    sel.value = 'A4';
                }
            }
        });
    };

    function positionRow() {
        return '<div class="pe-row"><label>' + PE.esc(T('page/where', 'Insert')) + '</label><select class="pe-select" data-where>' +
            '<option value="after">' + PE.esc(T('page/afterCur', 'After the current page')) + '</option>' +
            '<option value="before">' + PE.esc(T('page/beforeCur', 'Before the current page')) + '</option>' +
            '<option value="start">' + PE.esc(T('page/atStart', 'At the beginning')) + '</option>' +
            '<option value="end">' + PE.esc(T('page/atEnd', 'At the end')) + '</option></select></div>';
    }

    function readWhere(body) {
        var w = body.querySelector('[data-where]').value;
        if (w === 'before') {
            return V.cur;
        }
        if (w === 'start') {
            return 0;
        }
        if (w === 'end') {
            return D.pages.length;
        }
        return Math.min(D.pages.length, V.cur + 1);
    }

    DL.insertBlank = function () {
        var body = PE.el('div', 'pe-form', sizeForm(true) + positionRow());
        PE.dialog({
            title: T('page/blankTitle', 'Insert blank pages'),
            body: body,
            buttons: [
                { label: T('common/cancel', 'Cancel') },
                {
                    label: T('page/insert', 'Insert'), primary: true, onClick: function () {
                        var s = readSize(body);
                        var at = readWhere(body);
                        var pages = [];
                        for (var i = 0; i < s.n; i++) {
                            pages.push(D.blankPage(s.w, s.h));
                        }
                        D.insertPages(pages, at);
                        V.goto(at);
                    }
                }
            ]
        });
    };

    DL.insertPdf = function () {
        var pick = PE.hasBackend ? PE.pickServer({ filter: ['pdf'], key: 'insert' }).then(function (files) {
            if (!files.length) {
                return null;
            }
            return PE.fetchBytes(PE.mediaUrl(files[0].filepath)).then(function (b) {
                return { bytes: b, name: files[0].filename };
            });
        }) : PE.pickLocal('application/pdf,.pdf').then(function (files) {
            if (!files.length) {
                return null;
            }
            return PE.readFile(files[0]).then(function (b) {
                return { bytes: b, name: files[0].name };
            });
        });
        pick.then(function (f) {
            if (!f) {
                return;
            }
            var b = PE.busy(T('page/reading', 'Reading {name}...', { name: f.name }));
            return D.addSource(f.bytes, f.name).then(function (s) {
                b.close();
                var n = D.sources[s].info.length;
                var body = PE.el('div', 'pe-form', '<p>' + PE.esc(T('page/hasN', '{name} has {n} pages.', { name: f.name, n: n })) + '</p>' +
                    '<div class="pe-row"><label>' + PE.esc(T('page/which', 'Pages')) + '</label><input class="pe-input grow" type="text" data-range value="1-' + n + '"></div>' +
                    positionRow());
                PE.dialog({
                    title: T('page/insertPdfTitle', 'Insert pages from a PDF'),
                    body: body,
                    buttons: [
                        { label: T('common/cancel', 'Cancel') },
                        {
                            label: T('page/insert', 'Insert'), primary: true, onClick: function () {
                                var list = PE.parseRange(body.querySelector('[data-range]').value, n);
                                if (!list) {
                                    PE.toast(T('page/badRange', 'Enter pages like 1-3, 5'), { error: true });
                                    return false;
                                }
                                var at = readWhere(body);
                                D.insertPages(D.pagesFromSource(s, list), at);
                                V.goto(at);
                                PE.toast(T('page/inserted', '{n} page(s) inserted.', { n: list.length }));
                            }
                        }
                    ]
                });
            }, function (err) {
                b.close();
                PE.alert(T('open/failTitle', 'Could not open the file'), err.message || String(err));
            });
        });
    };

    /* Pictures as pages (also "Images to PDF" for a new document) */
    DL.imagesAsPages = function (asNew) {
        var pick = PE.hasBackend ? PE.pickServer({ filter: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'], multiple: true, key: 'image' }).then(function (files) {
            return Promise.all(files.map(function (f) {
                return PE.fetchBytes(PE.mediaUrl(f.filepath)).then(function (b) {
                    return { bytes: b, name: f.filename };
                });
            }));
        }) : PE.pickLocal('image/*', true).then(function (files) {
            return Promise.all(files.map(function (f) {
                return PE.readFile(f).then(function (b) {
                    return { bytes: b, name: f.name };
                });
            }));
        });
        pick.then(function (imgs) {
            if (!imgs || !imgs.length) {
                return;
            }
            var body = PE.el('div', 'pe-form', '<p>' + PE.esc(T('img/nPictures', '{n} picture(s) selected.', { n: imgs.length })) + '</p>' +
                '<div class="pe-row"><label>' + PE.esc(T('page/size', 'Page size')) + '</label><select class="pe-select" data-fit>' +
                '<option value="image">' + PE.esc(T('img/fitImage', 'Same as each picture')) + '</option>' +
                '<option value="A4">A4</option><option value="Letter">Letter</option></select></div>' +
                '<div class="pe-row"><label>' + PE.esc(T('img/margin', 'Margin (pt)')) + '</label><input class="pe-input num" type="number" min="0" max="144" value="0" data-margin></div>' +
                (asNew ? '' : positionRow()));
            PE.dialog({
                title: asNew ? T('img/toPdfTitle', 'Images to PDF') : T('img/asPagesTitle', 'Insert pictures as pages'),
                body: body,
                buttons: [
                    { label: T('common/cancel', 'Cancel') },
                    {
                        label: asNew ? T('page/create', 'Create') : T('page/insert', 'Insert'), primary: true, onClick: function () {
                            var fit = body.querySelector('[data-fit]').value;
                            var margin = Math.max(0, parseFloat(body.querySelector('[data-margin]').value) || 0);
                            var at = asNew ? 0 : readWhere(body);
                            var go = function () {
                                var b = PE.busy(T('img/adding', 'Adding pictures...'));
                                var pages = [];
                                var newName = imgs.length === 1 ? PE.stem(imgs[0].name) + '.pdf' : T('img/newName', 'Pictures') + '.pdf';
                                if (asNew) {
                                    //start the new document first so the pictures belong to it
                                    D.newBlank(595.28, 841.89, 1, newName);
                                }
                                var chain = Promise.resolve();
                                imgs.forEach(function (im) {
                                    chain = chain.then(function () {
                                        return D.assetFromBytes(im.bytes).then(function (id) {
                                            var a = D.assets[id];
                                            var iw = a.w * 0.75, ih = a.h * 0.75;
                                            var pw, ph;
                                            if (fit === 'image') {
                                                pw = iw + 2 * margin;
                                                ph = ih + 2 * margin;
                                            } else {
                                                var sz = fit === 'A4' ? [595.28, 841.89] : [612, 792];
                                                if (iw > ih) {
                                                    sz = [sz[1], sz[0]];
                                                }
                                                pw = sz[0];
                                                ph = sz[1];
                                            }
                                            var f = Math.min((pw - 2 * margin) / iw, (ph - 2 * margin) / ih);
                                            var w = iw * f, h = ih * f;
                                            var p = D.blankPage(pw, ph);
                                            p.objs.push({ id: PE.uid(), type: 'image', asset: id, x: (pw - w) / 2, y: (ph - h) / 2, w: w, h: h, angle: 0 });
                                            pages.push(p);
                                        });
                                    });
                                });
                                chain.then(function () {
                                    b.close();
                                    if (asNew) {
                                        D.pages = pages;
                                        D.emit('load');
                                    } else {
                                        D.insertPages(pages, at);
                                        V.goto(at);
                                    }
                                }, function (err) {
                                    b.close();
                                    PE.toast(err.message, { error: true });
                                });
                            };
                            if (asNew) {
                                PE.app.confirmDiscard().then(function (ok) {
                                    if (ok) {
                                        go();
                                    }
                                });
                            } else {
                                go();
                            }
                        }
                    }
                ]
            });
        });
    };

    /* ------------------------------------------------------------ extract / split */
    /* Write a PDF to ArozOS (a picked file) or download it; resolves with the vpath or name */
    DL.deliverPdf = function (bytes, defName, key) {
        if (!PE.hasBackend) {
            PE.downloadBytes(bytes, defName, 'application/pdf');
            return Promise.resolve(defName);
        }
        return PE.pickServer({ type: 'new', root: D.path ? PE.dirOf(D.path) : 'user:/Desktop', defaultName: defName, filter: ['pdf'], key: key || 'export' }).then(function (files) {
            if (!files.length) {
                return null;
            }
            var fp = files[0].filepath;
            if (!/\.pdf$/i.test(fp)) {
                fp += '.pdf';
            }
            return PE.upload(new Blob([bytes], { type: 'application/pdf' }), PE.baseName(fp), PE.dirOf(fp)).then(function () {
                return fp;
            });
        });
    };

    /* Build the edited document and copy groups of its pages into new PDFs */
    DL.subsets = function (groups, prog) {
        return PE.save.build(function (f, m) {
            prog(f * 0.7, m);
        }).then(function (bytes) {
            return PE.libs.pdflib().then(function (L) {
                return L.PDFDocument.load(bytes, { updateMetadata: false }).then(function (full) {
                    var outs = [];
                    var chain = Promise.resolve();
                    groups.forEach(function (g, gi) {
                        chain = chain.then(function () {
                            prog(0.7 + gi / groups.length * 0.3, T('split/making', 'Making file {n} of {total}...', { n: gi + 1, total: groups.length }));
                            return L.PDFDocument.create().then(function (doc) {
                                return doc.copyPages(full, g).then(function (pages) {
                                    pages.forEach(function (p) {
                                        doc.addPage(p);
                                    });
                                    doc.setTitle(D.meta.title || PE.stem(D.name));
                                    if (D.meta.author) {
                                        doc.setAuthor(D.meta.author);
                                    }
                                    doc.setProducer('ArozOS PDF Editor (pdf-lib)');
                                    return doc.save();
                                });
                            }).then(function (b) {
                                outs.push(b);
                            });
                        });
                    });
                    return chain.then(function () {
                        return outs;
                    });
                });
            });
        });
    };

    function pagesLabel(list) {
        var parts = [];
        var i = 0;
        while (i < list.length) {
            var j = i;
            while (j + 1 < list.length && list[j + 1] === list[j] + 1) {
                j++;
            }
            parts.push(i === j ? String(list[i] + 1) : (list[i] + 1) + '-' + (list[j] + 1));
            i = j + 1;
        }
        return parts.join(', ');
    }

    DL.extract = function () {
        var ks = PE.panels.targetPages();
        var body = PE.el('div', 'pe-form', '<div class="pe-row"><label>' + PE.esc(T('page/which', 'Pages')) + '</label><input class="pe-input grow" type="text" data-range value="' + pagesLabel(ks) + '"></div>' +
            '<div class="pe-row"><label></label><label class="pe-check"><input type="checkbox" data-del>' + PE.esc(T('extract/delete', 'Delete these pages from this document')) + '</label></div>' +
            '<div class="pe-note">' + PE.esc(T('extract/note', 'The new PDF includes everything you added to these pages.')) + '</div>');
        PE.dialog({
            title: T('extract/title', 'Extract pages'),
            body: body,
            buttons: [
                { label: T('common/cancel', 'Cancel') },
                {
                    label: T('extract/go', 'Extract'), primary: true, onClick: function () {
                        var list = PE.parseRange(body.querySelector('[data-range]').value, D.pages.length);
                        if (!list) {
                            PE.toast(T('page/badRange', 'Enter pages like 1-3, 5'), { error: true });
                            return false;
                        }
                        var del = body.querySelector('[data-del]').checked;
                        PE.save.withBusy(T('extract/working', 'Extracting...'), function (prog) {
                            return DL.subsets([list], prog);
                        }).then(function (outs) {
                            return DL.deliverPdf(outs[0], PE.stem(D.name) + '_' + T('extract/suffix', 'pages') + '_' + pagesLabel(list).replace(/[ ,]+/g, '_') + '.pdf');
                        }).then(function (where) {
                            if (!where) {
                                return;
                            }
                            PE.toast(T('save/saved', 'Saved to {path}', { path: where }));
                            if (del) {
                                D.deletePages(list);
                            }
                        }).catch(function (err) {
                            PE.alert(T('extract/fail', 'Could not extract the pages'), err.message || String(err));
                        });
                    }
                }
            ]
        });
    };

    DL.split = function () {
        var n = D.pages.length;
        var body = PE.el('div', 'pe-form');
        body.innerHTML =
            '<label class="pe-check"><input type="radio" name="sp" value="every" checked>' + PE.esc(T('split/every', 'Every')) +
            ' <input class="pe-input num" type="number" min="1" max="' + n + '" value="1" data-every> ' + PE.esc(T('split/pagesEach', 'page(s)')) + '</label>' +
            '<label class="pe-check"><input type="radio" name="sp" value="ranges">' + PE.esc(T('split/ranges', 'By page ranges')) + '</label>' +
            '<input class="pe-input" type="text" data-ranges placeholder="1-3; 4-8; 9-' + n + '">' +
            '<label class="pe-check"><input type="radio" name="sp" value="half">' + PE.esc(T('split/half', 'Into two halves')) + '</label>' +
            '<div class="pe-note" data-sum></div>';
        function groups() {
            var mode = body.querySelector('[name=sp]:checked').value;
            var g = [];
            if (mode === 'every') {
                var e = Math.max(1, parseInt(body.querySelector('[data-every]').value, 10) || 1);
                for (var i = 0; i < n; i += e) {
                    var grp = [];
                    for (var j = i; j < Math.min(n, i + e); j++) {
                        grp.push(j);
                    }
                    g.push(grp);
                }
            } else if (mode === 'half') {
                var h = Math.ceil(n / 2);
                var a = [], b = [];
                for (var x = 0; x < n; x++) {
                    (x < h ? a : b).push(x);
                }
                g = [a, b].filter(function (q) { return q.length; });
            } else {
                body.querySelector('[data-ranges]').value.split(';').forEach(function (part) {
                    var l = PE.parseRange(part, n);
                    if (l) {
                        g.push(l);
                    }
                });
            }
            return g;
        }
        function sum() {
            var g = groups();
            body.querySelector('[data-sum]').textContent = g.length ? T('split/willMake', 'This makes {n} PDF files.', { n: g.length }) : T('split/nothing', 'Enter at least one page range.');
        }
        body.addEventListener('input', sum);
        body.addEventListener('change', sum);
        PE.dialog({
            title: T('split/title', 'Split document'),
            body: body,
            onOpen: sum,
            buttons: [
                { label: T('common/cancel', 'Cancel') },
                {
                    label: T('split/go', 'Split'), primary: true, onClick: function () {
                        var g = groups();
                        if (!g.length) {
                            return false;
                        }
                        var base = PE.stem(D.name);
                        var pickDir = PE.hasBackend ? PE.pickServer({ type: 'folder', root: D.path ? PE.dirOf(D.path) : 'user:/Desktop', key: 'export' }).then(function (f) {
                            return f.length ? f[0].filepath.replace(/\/$/, '') : null;
                        }) : Promise.resolve('');
                        pickDir.then(function (dir) {
                            if (dir === null) {
                                return;
                            }
                            PE.save.withBusy(T('split/working', 'Splitting...'), function (prog) {
                                return DL.subsets(g, prog).then(function (outs) {
                                    var chain = Promise.resolve();
                                    outs.forEach(function (bytes, i) {
                                        var name = base + '_' + (i + 1) + '.pdf';
                                        chain = chain.then(function () {
                                            prog(0.95, T('split/writing', 'Writing {name}...', { name: name }));
                                            if (!PE.hasBackend) {
                                                PE.downloadBytes(bytes, name, 'application/pdf');
                                                return PE.tick();
                                            }
                                            return PE.upload(new Blob([bytes], { type: 'application/pdf' }), name, dir);
                                        });
                                    });
                                    return chain.then(function () {
                                        return outs.length;
                                    });
                                });
                            }).then(function (count) {
                                PE.toast(T('split/done', '{n} files written.', { n: count }) + (dir ? ' (' + dir + ')' : ''));
                            }).catch(function (err) {
                                PE.alert(T('split/fail', 'Could not split the document'), err.message || String(err));
                            });
                        });
                    }
                }
            ]
        });
    };

    /* ------------------------------------------------------------ attachments */
    DL.attachFile = function () {
        var pick = PE.hasBackend ? PE.pickServer({ key: 'attach' }).then(function (files) {
            if (!files.length) {
                return null;
            }
            return PE.fetchBytes(PE.mediaUrl(files[0].filepath)).then(function (b) {
                return { bytes: b, name: files[0].filename };
            });
        }) : PE.pickLocal('', false).then(function (files) {
            if (!files.length) {
                return null;
            }
            return PE.readFile(files[0]).then(function (b) {
                return { bytes: b, name: files[0].name, type: files[0].type };
            });
        });
        pick.then(function (f) {
            if (!f) {
                return;
            }
            var id = D.addAsset(f.bytes, f.type || 'application/octet-stream');
            D.change(function () {
                D.attach.push({ id: PE.uid('f'), name: f.name, asset: id });
            }, { all: false });
            PE.panels.showLeft('attach');
            PE.toast(T('attach/added', '{name} will be attached when you save.', { name: f.name }));
        });
    };

    /* ------------------------------------------------------------ help */
    DL.shortcuts = function () {
        var rows = [
            [T('kb/open', 'Open'), 'Ctrl+O'], [T('kb/save', 'Save'), 'Ctrl+S'], [T('kb/saveAs', 'Save as'), 'Ctrl+Shift+S'], [T('kb/print', 'Print'), 'Ctrl+P'],
            [T('kb/undo', 'Undo / Redo'), 'Ctrl+Z / Ctrl+Y'], [T('kb/copy', 'Copy, cut, paste, duplicate'), 'Ctrl+C / X / V / D'],
            [T('kb/delete', 'Delete the selection'), 'Delete'], [T('kb/nudge', 'Move the selection'), T('kb/arrows', 'Arrow keys (Shift: 10 pt)')],
            [T('kb/find', 'Find'), 'Ctrl+F'], [T('kb/zoom', 'Zoom in / out'), 'Ctrl+= / Ctrl+-'], [T('kb/fit', 'Fit width'), 'Ctrl+0'],
            [T('kb/pages', 'Previous / next page'), 'PgUp / PgDn'], [T('kb/firstLast', 'First / last page'), 'Home / End'],
            [T('kb/pan', 'Move around (any tool)'), T('kb/space', 'Hold Space and drag')], [T('kb/hand', 'Hand / Select / Edit PDF'), 'H / V / E'],
            [T('kb/textTool', 'Add text'), 'T'], [T('kb/escape', 'Finish editing or leave a tool'), 'Esc'],
            [T('kb/editText', 'Edit text you added'), T('kb/dbl', 'Double-click')]
        ];
        PE.dialog({
            title: T('kb/title', 'Keyboard shortcuts'),
            body: '<table class="pe-kbd-table">' + rows.map(function (r) {
                return '<tr><td>' + PE.esc(r[0]) + '</td><td>' + r[1].split(' / ').map(function (k) {
                    return /^[A-Za-z]+[+=-]|^[A-Z]$|^(Esc|Delete|Home|End|PgUp|PgDn)$/.test(k) ? '<kbd>' + PE.esc(k) + '</kbd>' : PE.esc(k);
                }).join(' / ') + '</td></tr>';
            }).join('') + '</table>',
            buttons: [{ label: T('common/close', 'Close'), primary: true }]
        });
    };

    DL.about = function () {
        PE.dialog({
            title: T('about/title', 'About PDF Editor'),
            body: '<div style="display:flex;gap:16px;align-items:flex-start"><img src="img/module_icon.svg" style="width:56px;height:56px" alt="">' +
                '<div><div style="font-size:16px;font-weight:600">PDF Editor</div>' +
                '<p style="margin:4px 0 10px">' + PE.esc(T('about/version', 'Version {v}', { v: PE.VERSION })) + '</p>' +
                '<p>' + PE.esc(T('about/text', 'Edit the text of PDF files, add text, pictures, shapes, signatures and stamps, organize pages and convert documents for ArozOS Office. The file you open is never changed until you save, and the saved file keeps real, selectable text.')) + '</p>' +
                '<p class="pe-note">' + PE.esc(T('about/credits', 'Uses pdf.js (Apache-2.0), pdf-lib and fontkit (MIT).')) + '</p></div></div>',
            buttons: [{ label: T('common/close', 'Close'), primary: true }]
        });
    };
})(window.PE);
