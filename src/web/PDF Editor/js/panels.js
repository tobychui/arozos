/*
    PDF Editor - side panes

    Left: Thumbnails (reorder by dragging, pick several with Ctrl / Shift),
    Bookmarks (the outline of the opened PDF), Attachments and Objects (all
    that was added, page by page). Right: Properties - the format of the
    selection (or of the active tool), the file and its metadata (title,
    author, subject and keywords are editable) and the current page.
*/
window.PE = window.PE || {};

(function (PE) {
    'use strict';

    var D = PE.doc;
    var V = PE.view;
    var F = PE.fonts;
    var T = PE.T;
    var P = PE.panels = { left: 'thumbs', leftOpen: true, rightOpen: true, picked: [] };

    /* ------------------------------------------------------------ left pane */
    var TITLES = {
        thumbs: ['panel/thumbs', 'Thumbnails'],
        outline: ['panel/outline', 'Bookmarks'],
        attach: ['panel/attach', 'Attachments'],
        objects: ['panel/objects', 'Objects']
    };

    P.showLeft = function (name, toggle) {
        if (toggle && P.leftOpen && P.left === name) {
            P.leftOpen = false;
        } else {
            P.left = name;
            P.leftOpen = true;
        }
        layoutLeft();
        saveUi();
    };

    P.hideLeft = function () {
        P.leftOpen = false;
        layoutLeft();
        saveUi();
    };

    function layoutLeft() {
        var el = PE.$('peLeft');
        el.hidden = !P.leftOpen;
        PE.$('peLeftTitle').textContent = T(TITLES[P.left][0], TITLES[P.left][1]);
        Array.prototype.forEach.call(document.querySelectorAll('#peRail [data-panel]'), function (b) {
            b.classList.toggle('active', P.leftOpen && b.dataset.panel === P.left);
        });
        if (P.leftOpen) {
            renderLeft();
        }
        PE.emitUi && PE.emitUi();
    }

    function renderLeft() {
        var body = PE.$('peLeftBody');
        if (P.left === 'thumbs') {
            renderThumbs(body);
        } else if (P.left === 'outline') {
            renderOutline(body);
        } else if (P.left === 'attach') {
            renderAttach(body);
        } else {
            renderObjects(body);
        }
    }
    P.renderLeft = function () {
        if (P.leftOpen) {
            renderLeft();
        }
    };

    P.toggleRight = function (on) {
        P.rightOpen = on === undefined ? !P.rightOpen : on;
        PE.$('peRight').hidden = !P.rightOpen;
        if (P.rightOpen) {
            P.renderProps();
        }
        saveUi();
        PE.emitUi && PE.emitUi();
    };

    function saveUi() {
        try {
            localStorage.setItem('pdfeditor.panes', JSON.stringify({ left: P.left, leftOpen: P.leftOpen, rightOpen: P.rightOpen }));
        } catch (e) {
            //private mode
        }
    }

    /* ------------------------------------------------------------ thumbnails */
    var thumbObserver = null;
    var thumbById = {};
    var thumbWrap = null;
    var THUMB_W = 118;

    function thumbScale(k) {
        var d = D.dims(k);
        var s = THUMB_W / Math.max(d.w, d.h * 0.78);
        return s;
    }

    function makeThumb(p) {
        var card = PE.el('div', 'pe-thumb');
        card.draggable = true;
        var box = PE.el('div', 'pe-thumb-box');
        var inner = PE.el('div');
        inner.style.cssText = 'position:absolute;left:0;top:0';
        var under = PE.el('div', 'pe-thumb-objs');
        var canvas = PE.el('canvas');
        canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%';
        var over = PE.el('div', 'pe-thumb-objs');
        var objs = PE.el('div', 'pe-thumb-objs');
        [under, canvas, over, objs].forEach(function (x) {
            inner.appendChild(x);
        });
        box.appendChild(inner);
        card.appendChild(box);
        card.appendChild(PE.el('div', 'n'));
        card._t = { id: p.id, box: box, inner: inner, under: under, canvas: canvas, over: over, objs: objs, sig: '', drawn: false, token: 0 };
        return card;
    }

    function sigOf(p) {
        return D.totalRot(p) + '|' + (p.edits || []).length + '|' + p.s + ':' + p.i;
    }

    function sizeThumb(card, k) {
        var t = card._t;
        var s = thumbScale(k);
        var d = D.dims(k);
        t.scale = s;
        t.box.style.width = Math.round(d.w * s) + 'px';
        t.box.style.height = Math.round(d.h * s) + 'px';
        t.inner.style.width = d.W * s + 'px';
        t.inner.style.height = d.H * s + 'px';
        t.inner.style.left = -d.ox * s + 'px';
        t.inner.style.top = -d.oy * s + 'px';
        [t.under, t.over, t.objs].forEach(function (x) {
            x.style.width = d.W * s + 'px';
            x.style.height = d.H * s + 'px';
        });
        card.querySelector('.n').textContent = k + 1;
    }

    function drawThumb(card) {
        var k = +card.dataset.k;
        var p = D.pages[k];
        if (!p) {
            return;
        }
        var t = card._t;
        var s = t.scale;
        PE.deco.render(t.under, t.over, k, s);
        PE.objs.renderLayer(t.objs, k, s, false);
        var sig = sigOf(p);
        if (t.drawn && t.sig === sig) {
            return;
        }
        t.sig = sig;
        t.drawn = true;
        var token = ++t.token;
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        var d = D.dims(k);
        if (p.s < 0) {
            t.canvas.width = Math.ceil(d.W * s * dpr);
            t.canvas.height = Math.ceil(d.H * s * dpr);
            return;
        }
        D.pdfPage(k).then(function (page) {
            if (token !== t.token) {
                return;
            }
            var vp = page.getViewport({ scale: s * dpr, rotation: D.totalRot(p) });
            var off = document.createElement('canvas');
            off.width = Math.ceil(vp.width);
            off.height = Math.ceil(vp.height);
            return page.render({ canvasContext: off.getContext('2d'), viewport: vp, background: 'rgba(0,0,0,0)', intent: document.hidden ? 'print' : 'display' }).promise.then(function () {
                if (token !== t.token) {
                    return;
                }
                PE.textedit.patchCanvas(off, k, s * dpr);
                t.canvas.width = off.width;
                t.canvas.height = off.height;
                t.canvas.getContext('2d').drawImage(off, 0, 0);
            });
        }).catch(function () {});
    }

    function renderThumbs(body) {
        if (!thumbWrap || thumbWrap.parentNode !== body) {
            body.innerHTML = '';
            thumbWrap = PE.el('div', 'pe-thumbs');
            body.appendChild(thumbWrap);
            if (thumbObserver) {
                thumbObserver.disconnect();
            }
            thumbObserver = new IntersectionObserver(function (entries) {
                entries.forEach(function (e) {
                    if (e.isIntersecting) {
                        drawThumb(e.target);
                    }
                });
            }, { root: body, rootMargin: '400px 0px' });
            bindThumbEvents();
        }
        var keep = {};
        D.pages.forEach(function (p, k) {
            var card = thumbById[p.id];
            if (!card) {
                card = makeThumb(p);
                thumbById[p.id] = card;
            }
            keep[p.id] = true;
            card.dataset.k = k;
            if (thumbWrap.children[k] !== card) {
                thumbWrap.insertBefore(card, thumbWrap.children[k] || null);
            }
            sizeThumb(card, k);
        });
        Object.keys(thumbById).forEach(function (id) {
            if (!keep[id]) {
                var c = thumbById[id];
                if (c.parentNode) {
                    c.parentNode.removeChild(c);
                }
                thumbObserver.unobserve(c);
                delete thumbById[id];
            }
        });
        Array.prototype.forEach.call(thumbWrap.children, function (card) {
            card._t.drawn = card._t.drawn && card._t.sig === sigOf(D.pages[+card.dataset.k]);
            thumbObserver.unobserve(card);
            thumbObserver.observe(card);
        });
        P.picked = P.picked.filter(function (k) { return k < D.pages.length; });
        P.markCurrent();
    }

    P.resetThumbs = function () {
        thumbById = {};
        if (thumbWrap) {
            thumbWrap.innerHTML = '';
        }
    };

    /* Redraw the thumbnails of some pages (after objects changed) */
    P.refreshThumb = function (k) {
        if (!thumbWrap || P.left !== 'thumbs' || !P.leftOpen) {
            return;
        }
        var p = D.pages[k];
        var card = p && thumbById[p.id];
        if (card && card._t.drawn) {
            sizeThumb(card, k);
            drawThumb(card);
        }
    };

    P.markCurrent = function () {
        if (!thumbWrap) {
            return;
        }
        Array.prototype.forEach.call(thumbWrap.children, function (card) {
            var k = +card.dataset.k;
            card.classList.toggle('current', k === V.cur);
            card.classList.toggle('picked', P.picked.length > 1 && P.picked.indexOf(k) >= 0);
        });
        var cur = thumbWrap.children[V.cur];
        var body = PE.$('peLeftBody');
        if (cur && P.left === 'thumbs' && P.leftOpen) {
            var top = cur.offsetTop, bottom = top + cur.offsetHeight;
            if (top < body.scrollTop || bottom > body.scrollTop + body.clientHeight) {
                body.scrollTop = top - body.clientHeight / 2 + cur.offsetHeight / 2;
            }
        }
    };

    /* The pages a page command works on: the picked thumbnails or the current page */
    P.targetPages = function () {
        if (P.picked.length > 1) {
            return P.picked.slice().sort(function (a, b) { return a - b; });
        }
        return D.pages.length ? [V.cur] : [];
    };

    var anchorK = 0;
    var dragKs = null;

    function bindThumbEvents() {
        thumbWrap.addEventListener('click', function (e) {
            var card = e.target.closest('.pe-thumb');
            if (!card) {
                return;
            }
            var k = +card.dataset.k;
            if (e.shiftKey) {
                P.picked = [];
                for (var i = Math.min(anchorK, k); i <= Math.max(anchorK, k); i++) {
                    P.picked.push(i);
                }
            } else if (e.ctrlKey || e.metaKey) {
                if (!P.picked.length) {
                    P.picked = [V.cur];
                }
                var at = P.picked.indexOf(k);
                if (at >= 0) {
                    P.picked.splice(at, 1);
                } else {
                    P.picked.push(k);
                }
                anchorK = k;
            } else {
                P.picked = [k];
                anchorK = k;
            }
            V.goto(k);
            P.markCurrent();
            PE.emitUi && PE.emitUi();
        });
        thumbWrap.addEventListener('contextmenu', function (e) {
            var card = e.target.closest('.pe-thumb');
            if (!card) {
                return;
            }
            e.preventDefault();
            var k = +card.dataset.k;
            if (P.picked.indexOf(k) < 0) {
                P.picked = [k];
                anchorK = k;
                V.goto(k);
                P.markCurrent();
            }
            PE.menu({ x: e.clientX, y: e.clientY }, PE.app.menus.pageMenu());
        });
        thumbWrap.addEventListener('dragstart', function (e) {
            var card = e.target.closest('.pe-thumb');
            if (!card) {
                return;
            }
            var k = +card.dataset.k;
            dragKs = P.picked.length > 1 && P.picked.indexOf(k) >= 0 ? P.picked.slice() : [k];
            e.dataTransfer.effectAllowed = 'move';
            try {
                e.dataTransfer.setData('text/x-pdfeditor-pages', JSON.stringify(dragKs));
            } catch (err) {
                //older browsers
            }
        });
        function clearMarks() {
            Array.prototype.forEach.call(thumbWrap.querySelectorAll('.drop-before,.drop-after'), function (c) {
                c.classList.remove('drop-before', 'drop-after');
            });
        }
        thumbWrap.addEventListener('dragover', function (e) {
            if (!dragKs) {
                return;
            }
            var card = e.target.closest('.pe-thumb');
            if (!card) {
                return;
            }
            e.preventDefault();
            var r = card.getBoundingClientRect();
            var after = e.clientY > r.top + r.height / 2;
            clearMarks();
            card.classList.add(after ? 'drop-after' : 'drop-before');
        });
        thumbWrap.addEventListener('dragleave', function (e) {
            if (!thumbWrap.contains(e.relatedTarget)) {
                clearMarks();
            }
        });
        thumbWrap.addEventListener('drop', function (e) {
            if (!dragKs) {
                return;
            }
            e.preventDefault();
            var card = e.target.closest('.pe-thumb');
            clearMarks();
            if (!card) {
                dragKs = null;
                return;
            }
            var k = +card.dataset.k;
            var r = card.getBoundingClientRect();
            var to = e.clientY > r.top + r.height / 2 ? k + 1 : k;
            var ks = dragKs;
            dragKs = null;
            var first = D.movePages(ks, to);
            P.picked = ks.map(function (x, i) { return first + i; });
            V.goto(first);
        });
        thumbWrap.addEventListener('dragend', function () {
            dragKs = null;
            clearMarks();
        });
    }

    /* ------------------------------------------------------------ bookmarks */
    function renderOutline(body) {
        thumbWrap = null;
        body.innerHTML = '<div class="pe-list-empty">' + PE.esc(T('panel/loading', 'Loading...')) + '</div>';
        var src = D.sources[0];
        if (!src) {
            body.innerHTML = '<div class="pe-list-empty">' + PE.esc(T('panel/noOutline', 'This document has no bookmarks.')) + '</div>';
            return;
        }
        src.pdf.getOutline().then(function (items) {
            if (P.left !== 'outline') {
                return;
            }
            body.innerHTML = '';
            if (!items || !items.length) {
                body.innerHTML = '<div class="pe-list-empty">' + PE.esc(T('panel/noOutline', 'This document has no bookmarks.')) + '</div>';
                return;
            }
            var list = PE.el('div', 'pe-list');
            function add(parent, its, depth) {
                its.forEach(function (it) {
                    var row = PE.el('div', 'pe-li');
                    row.style.paddingLeft = 8 + depth * 14 + 'px';
                    var has = it.items && it.items.length;
                    row.innerHTML = '<span class="tw">' + (has ? PE.icon('chevdown', 'sm') : '') + '</span><span class="grow"></span>';
                    row.querySelector('.grow').textContent = it.title || '';
                    row.title = it.title || '';
                    parent.appendChild(row);
                    var kids = null;
                    if (has) {
                        kids = PE.el('div');
                        add(kids, it.items, depth + 1);
                        parent.appendChild(kids);
                        if (depth > 0) {
                            kids.hidden = true;
                            row.classList.add('closed');
                        }
                        row.querySelector('.tw').addEventListener('click', function (e) {
                            e.stopPropagation();
                            kids.hidden = !kids.hidden;
                            row.classList.toggle('closed', kids.hidden);
                        });
                    }
                    row.addEventListener('click', function () {
                        if (it.url) {
                            window.open(it.url, '_blank', 'noopener');
                            return;
                        }
                        goDest(src.pdf, it.dest);
                    });
                });
            }
            add(list, items, 0);
            body.appendChild(list);
        }).catch(function () {
            body.innerHTML = '<div class="pe-list-empty">' + PE.esc(T('panel/noOutline', 'This document has no bookmarks.')) + '</div>';
        });
    }

    function goDest(pdf, dest) {
        var p = typeof dest === 'string' ? pdf.getDestination(dest) : Promise.resolve(dest);
        p.then(function (d) {
            if (!d || !d.length) {
                return null;
            }
            if (typeof d[0] === 'number') {
                return d[0];
            }
            return pdf.getPageIndex(d[0]);
        }).then(function (idx) {
            if (idx === null || idx === undefined) {
                return;
            }
            var k = D.pageOfSource(0, idx);
            if (k >= 0) {
                V.goto(k);
            } else {
                PE.toast(T('panel/pageGone', 'That page is no longer in the document.'));
            }
        }).catch(function () {});
    }

    /* ------------------------------------------------------------ attachments */
    function renderAttach(body) {
        thumbWrap = null;
        body.innerHTML = '';
        var tools = PE.el('div', 'pe-side-tools');
        var add = PE.el('button', 'pe-btn sm', PE.icon('plus', 'sm') + PE.esc(T('panel/addFile', 'Attach a file')));
        add.addEventListener('click', function () {
            PE.run('attachFile');
        });
        tools.appendChild(add);
        body.appendChild(tools);
        var list = PE.el('div', 'pe-list');
        body.appendChild(list);
        var src = D.sources[0];
        var existing = src ? src.pdf.getAttachments().catch(function () { return null; }) : Promise.resolve(null);
        existing.then(function (att) {
            if (P.left !== 'attach') {
                return;
            }
            var any = false;
            if (att) {
                Object.keys(att).forEach(function (key) {
                    var a = att[key];
                    any = true;
                    var row = PE.el('div', 'pe-li');
                    row.innerHTML = PE.icon('attach', 'sm') + '<span class="grow"></span><span class="sub">' + PE.esc(PE.fmtBytes(a.content ? a.content.length : 0)) + '</span>';
                    row.querySelector('.grow').textContent = a.filename || key;
                    row.title = T('panel/download', 'Download');
                    row.addEventListener('click', function () {
                        PE.downloadBytes(a.content, a.filename || key);
                    });
                    list.appendChild(row);
                });
            }
            (D.attach || []).forEach(function (a) {
                any = true;
                var asset = D.assets[a.asset];
                var row = PE.el('div', 'pe-li');
                row.innerHTML = PE.icon('attach', 'sm') + '<span class="grow"></span><span class="sub">' + PE.esc(PE.fmtBytes(asset ? asset.bytes.length : 0)) + '</span>' +
                    '<button class="act" title="' + PE.esc(T('common/remove', 'Remove')) + '">' + PE.icon('trash', 'sm') + '</button>';
                row.querySelector('.grow').textContent = a.name + ' (' + T('panel/new', 'new') + ')';
                row.querySelector('.act').addEventListener('click', function (e) {
                    e.stopPropagation();
                    D.change(function () {
                        D.attach = D.attach.filter(function (x) { return x.id !== a.id; });
                    }, { all: false });
                    renderAttach(body);
                });
                row.addEventListener('click', function () {
                    if (asset) {
                        PE.downloadBytes(asset.bytes, a.name);
                    }
                });
                list.appendChild(row);
            });
            if (!any) {
                list.appendChild(PE.el('div', 'pe-list-empty', PE.esc(T('panel/noAttach', 'No files are attached to this document.'))));
            }
        });
    }

    /* ------------------------------------------------------------ objects */
    var TYPE_ICON = { text: 'addtext', image: 'image', rect: 'rect', ellipse: 'ellipse', line: 'line', ink: 'draw', markup: 'highlight', redact: 'redact', link: 'link' };

    P.objLabel = function (o) {
        switch (o.type) {
            case 'text': return o.text ? o.text.split('\n')[0].substring(0, 60) : T('obj/text', 'Text');
            case 'image': return T('obj/image', 'Picture');
            case 'rect': return o.fill === '#ffffff' && !o.stroke ? T('obj/whiteout', 'White-out') : T('obj/rect', 'Rectangle');
            case 'ellipse': return T('obj/ellipse', 'Ellipse');
            case 'line': return o.arrow && o.arrow !== 'none' ? T('obj/arrow', 'Arrow') : T('obj/line', 'Line');
            case 'ink': return T('obj/ink', 'Drawing');
            case 'markup': return o.kind === 'highlight' ? T('obj/highlight', 'Highlight') : o.kind === 'underline' ? T('obj/underline', 'Underline') : T('obj/strike', 'Strikethrough');
            case 'redact': return T('obj/redact', 'Redaction');
            case 'link': return o.url || T('link/toPage', 'Go to page {n}', { n: (o.page || 0) + 1 });
            default: return o.type;
        }
    };

    function renderObjects(body) {
        thumbWrap = null;
        body.innerHTML = '';
        var list = PE.el('div', 'pe-list');
        var any = false;
        var selIds = PE.objs.selected().map(function (o) { return o.id; });
        D.pages.forEach(function (p, k) {
            var edits = (p.edits || []).length;
            if (!p.objs.length && !edits) {
                return;
            }
            any = true;
            list.appendChild(PE.el('div', 'pe-list-h', PE.esc(T('panel/pageN', 'Page {n}', { n: k + 1 }))));
            if (edits) {
                var er = PE.el('div', 'pe-li');
                er.innerHTML = PE.icon('editpdf', 'sm') + '<span class="grow"></span>';
                er.querySelector('.grow').textContent = T('panel/editedBlocks', '{n} text block(s) replaced', { n: edits });
                er.addEventListener('click', function () { V.goto(k); });
                list.appendChild(er);
            }
            p.objs.slice().reverse().forEach(function (o) {
                var row = PE.el('div', 'pe-li' + (selIds.indexOf(o.id) >= 0 ? ' sel' : ''));
                row.innerHTML = PE.icon(TYPE_ICON[o.type] || 'objects', 'sm') + '<span class="grow"></span>' +
                    '<button class="act" title="' + PE.esc(T('common/delete', 'Delete')) + '">' + PE.icon('trash', 'sm') + '</button>';
                row.querySelector('.grow').textContent = P.objLabel(o);
                row.addEventListener('click', function () {
                    if (V.tool !== 'select') {
                        V.setTool('select');
                    }
                    V.reveal(k, o.x, o.y);
                    PE.objs.select([o.id], k);
                });
                row.querySelector('.act').addEventListener('click', function (e) {
                    e.stopPropagation();
                    PE.objs.remove([o.id]);
                });
                list.appendChild(row);
            });
        });
        if (!any) {
            list.appendChild(PE.el('div', 'pe-list-empty', PE.esc(T('panel/noObjects', 'Nothing has been added yet. Text, pictures, shapes, markup and signatures you add are listed here.'))));
        }
        body.appendChild(list);
    }

    /* ------------------------------------------------------------ properties */
    function propRow(k, v, cls) {
        return '<div class="k">' + PE.esc(k) + '</div><div class="v' + (cls ? ' ' + cls : '') + '">' + v + '</div>';
    }

    function metaInput(key, value, ph) {
        return '<div class="k">' + PE.esc(ph) + '</div><input class="v" data-meta="' + key + '" value="' + PE.esc(value || '') + '" placeholder="' + PE.esc(T('props/add', 'Add {what}', { what: ph.toLowerCase() })) + '">';
    }

    function locationOf(path) {
        if (!path) {
            return PE.esc(PE.hasBackend ? T('props/notSaved', 'Not saved yet') : T('props/thisDevice', 'This device'));
        }
        var dir = PE.dirOf(path);
        var m = /^([^:]+):\/?(.*)$/.exec(dir);
        var parts = [];
        if (m) {
            var root = m[1] === 'user' ? T('props/myFiles', 'My Files') : m[1];
            parts.push(root);
            m[2].split('/').forEach(function (x) {
                if (x) {
                    parts.push(x);
                }
            });
        } else {
            parts.push(dir);
        }
        return parts.map(PE.esc).join(' <span style="color:var(--text-3)">&gt;</span> ');
    }

    function pageSizeName(w, h) {
        var a = Math.min(w, h), b = Math.max(w, h);
        var known = [['A4', 595, 842], ['Letter', 612, 792], ['Legal', 612, 1008], ['A3', 842, 1191], ['A5', 420, 595], ['B5', 499, 709], ['Tabloid', 792, 1224]];
        for (var i = 0; i < known.length; i++) {
            if (Math.abs(a - known[i][1]) < 3 && Math.abs(b - known[i][2]) < 3) {
                return known[i][0];
            }
        }
        return '';
    }

    P.renderProps = function () {
        if (!P.rightOpen) {
            return;
        }
        var body = PE.$('peRightBody');
        var keepFocus = document.activeElement && body.contains(document.activeElement) ? document.activeElement.dataset.meta : null;
        if (keepFocus) {
            return;
        }
        body.innerHTML = '';
        if (!D.loaded) {
            body.appendChild(PE.el('div', 'pe-card', '<div class="pe-note">' + PE.esc(T('props/none', 'Open a PDF to see its properties.')) + '</div>'));
            return;
        }
        var fmt = formatCard();
        if (fmt) {
            body.appendChild(fmt);
        }
        //file
        var n = D.pages.length;
        var file = PE.el('div', 'pe-card');
        file.innerHTML = '<div class="pe-card-h">' + PE.esc(T('props/file', 'File')) + '</div>' +
            '<div class="pe-filecard"><svg class="ic pe-fileicon" viewBox="0 0 24 24"><use href="#pe-i-fileicon"/></svg><div style="min-width:0">' +
            '<div class="pe-filename"></div><div class="pe-filemeta"></div></div></div>';
        file.querySelector('.pe-filename').textContent = D.name || T('doc/untitled', 'Untitled');
        file.querySelector('.pe-filemeta').textContent = T('props/pdfdoc', 'PDF Document') + ' \u00b7 ' +
            T(n === 1 ? 'props/page1' : 'props/pagesN', n === 1 ? '1 page' : '{n} pages', { n: n }) + (D.size ? ' \u00b7 ' + PE.fmtBytes(D.size) : '');
        body.appendChild(file);
        //details
        var m = D.meta || {};
        var det = PE.el('div', 'pe-card');
        var created = m.created ? PE.fmtDate(new Date(m.created)) : '-';
        var modified = m.modified ? PE.fmtDate(new Date(m.modified)) : '-';
        det.innerHTML = '<div class="pe-props">' +
            propRow(T('props/location', 'Location'), locationOf(D.path), 'loc') +
            propRow(T('props/created', 'Created'), PE.esc(created)) +
            propRow(T('props/modified', 'Modified'), PE.esc(modified) + (D.dirty ? ' <span style="color:var(--accent)">(' + PE.esc(T('props/unsaved', 'unsaved changes')) + ')</span>' : '')) +
            metaInput('author', m.author, T('props/author', 'Author')) +
            metaInput('subject', m.subject, T('props/subject', 'Subject')) +
            metaInput('keywords', m.keywords, T('props/keywords', 'Keywords')) +
            metaInput('title', m.title, T('props/title', 'Title')) +
            (m.producer ? propRow(T('props/producer', 'Producer'), PE.esc(m.producer)) : '') +
            (D.version ? propRow(T('props/version', 'PDF version'), PE.esc(D.version)) : '') +
            '</div>';
        Array.prototype.forEach.call(det.querySelectorAll('[data-meta]'), function (inp) {
            inp.addEventListener('change', function () {
                var key = inp.dataset.meta;
                var v = inp.value.trim();
                if ((D.meta[key] || '') === v) {
                    return;
                }
                var snap = D.snapshot();
                D.meta[key] = v;
                D.pushUndo(snap);
                if (key === 'title') {
                    V.refreshAll();
                }
            });
            inp.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    inp.blur();
                }
            });
        });
        body.appendChild(det);
        //page
        var k = V.cur;
        if (D.pages[k]) {
            var d = D.dims(k);
            var pg = PE.el('div', 'pe-card');
            var mmW = Math.round(d.w / 72 * 25.4), mmH = Math.round(d.h / 72 * 25.4);
            var inW = (d.w / 72).toFixed(2), inH = (d.h / 72).toFixed(2);
            var nm = pageSizeName(d.w, d.h);
            pg.innerHTML = '<div class="pe-card-h">' + PE.esc(T('props/pageN', 'Page {n} of {total}', { n: k + 1, total: n })) + '</div><div class="pe-props">' +
                propRow(T('props/size', 'Size'), PE.esc((nm ? nm + ' \u00b7 ' : '') + mmW + ' \u00d7 ' + mmH + ' mm (' + inW + ' \u00d7 ' + inH + ' in)')) +
                propRow(T('props/rotation', 'Rotation'), PE.esc(D.totalRot(D.pages[k]) + '\u00b0')) +
                propRow(T('props/objects', 'Added'), PE.esc(String(D.pages[k].objs.length))) +
                (D.pages[k].crop ? propRow(T('props/cropped', 'Cropped'), '<a href="#" data-uncrop>' + PE.esc(T('props/uncrop', 'Remove crop')) + '</a>') : '') +
                '</div>';
            var unc = pg.querySelector('[data-uncrop]');
            if (unc) {
                unc.addEventListener('click', function (e) {
                    e.preventDefault();
                    D.change(function () {
                        D.pages[k].crop = null;
                    }, { pages: [k], structure: true });
                });
            }
            body.appendChild(pg);
        }
    };

    /* ------------------------------------------------------------ format card */
    function seg(name, opts, cur) {
        return '<div class="pe-seg" data-seg="' + name + '">' + opts.map(function (o) {
            return '<button type="button" data-v="' + o[0] + '" title="' + PE.esc(o[2]) + '"' + (String(cur) === String(o[0]) ? ' class="on"' : '') + '>' + PE.icon(o[1], 'sm') + '</button>';
        }).join('') + '</div>';
    }

    function toggle(name, icon, on, title) {
        return '<div class="pe-seg"><button type="button" data-toggle="' + name + '" title="' + PE.esc(title) + '"' + (on ? ' class="on"' : '') + '>' + PE.icon(icon, 'sm') + '</button></div>';
    }

    function colorBtn(name, color, title, allowNone) {
        return '<button type="button" class="pe-color" data-color="' + name + '"' + (allowNone ? ' data-none="1"' : '') + ' title="' + PE.esc(title) + '">' + PE.swatch(color) + '</button>';
    }

    function row(label, inner) {
        return '<div class="pe-fmt-row"><label>' + PE.esc(label) + '</label>' + inner + '</div>';
    }

    function fontOptions(cur) {
        return F.list().map(function (f) {
            return '<option value="' + PE.esc(f.key) + '"' + (f.key === cur ? ' selected' : '') + '>' + PE.esc(f.label) + '</option>';
        }).join('');
    }

    var TOOL_STYLE = { text: 'text', rect: 'shape', ellipse: 'shape', line: 'shape', arrow: 'shape', draw: 'ink', highlight: 'highlight', underline: 'underline', strike: 'strike' };

    function formatCard() {
        var objs = PE.objs.selected();
        var target = null, kind = null, title = '';
        if (objs.length) {
            target = objs[0];
            kind = objs[0].type;
            var same = objs.every(function (o) { return o.type === kind; });
            if (!same) {
                kind = 'mixed';
            }
            title = objs.length > 1 ? T('fmt/nSelected', '{n} selected', { n: objs.length }) : P.objLabel(objs[0]);
            if (kind === 'text' && objs.length === 1) {
                title = T('fmt/textTitle', 'Text');
            }
        } else if (TOOL_STYLE[V.tool]) {
            var st = TOOL_STYLE[V.tool];
            target = PE.objs.style[st];
            kind = st === 'shape' ? (V.tool === 'line' || V.tool === 'arrow' ? 'lineTool' : 'rect') : st === 'ink' ? 'ink' : st === 'text' ? 'text' : 'markup';
            title = T('fmt/toolTitle', 'Tool settings');
        } else {
            return null;
        }
        var o = target;
        var card = PE.el('div', 'pe-card');
        var h = '<div class="pe-card-h"><span class="grow"></span>';
        if (objs.length) {
            h += '<button class="pe-btn sm danger" data-act="delete" title="' + PE.esc(T('common/delete', 'Delete')) + '">' + PE.icon('trash', 'sm') + '</button>';
        }
        h += '</div><div class="pe-fmt">';
        var rotatable = objs.length === 1 && ['text', 'image', 'rect', 'ellipse', 'ink'].indexOf(kind) >= 0;
        switch (kind) {
            case 'text':
                h += row(T('fmt/font', 'Font'), '<select class="pe-select grow" data-field="font">' + fontOptions(o.font || 'helv') + '</select>');
                h += row(T('fmt/size', 'Size'), '<input class="pe-input num" type="number" min="2" max="400" step="0.5" data-field="size" value="' + (o.size || 12) + '">' +
                    toggle('bold', 'bold', o.bold, T('fmt/bold', 'Bold')) + toggle('italic', 'italic', o.italic, T('fmt/italic', 'Italic')) +
                    toggle('underline', 'underl', o.underline, T('fmt/underline', 'Underline')) + toggle('strike', 'strike', o.strike, T('fmt/strike', 'Strikethrough')));
                h += row(T('fmt/color', 'Colour'), colorBtn('color', o.color || '#000000', T('fmt/color', 'Colour')) +
                    seg('align', [['left', 'alignleft', T('fmt/left', 'Left')], ['center', 'aligncenter', T('fmt/center', 'Centre')], ['right', 'alignright', T('fmt/right', 'Right')]], o.align || 'left'));
                if (objs.length) {
                    h += row(T('fmt/spacing', 'Line spacing'), '<input class="pe-input num" type="number" min="0.6" max="4" step="0.05" data-field="lh" value="' + (o.lh || 1.2) + '">' +
                        '<label class="pe-check"><input type="checkbox" data-field="wrap"' + (o.wrap ? ' checked' : '') + '>' + PE.esc(T('fmt/wrap', 'Wrap')) + '</label>');
                    h += row(T('fmt/fill', 'Fill'), colorBtn('bg', o.bg, T('fmt/fill', 'Fill'), true) + '<label style="width:auto;color:var(--text-2);font-size:12px;margin-left:8px">' +
                        PE.esc(T('fmt/border', 'Border')) + '</label>' + colorBtn('border', o.border, T('fmt/border', 'Border'), true));
                }
                break;
            case 'rect':
            case 'ellipse':
                h += row(T('fmt/stroke', 'Outline'), colorBtn('stroke', o.stroke, T('fmt/stroke', 'Outline'), true) +
                    '<input class="pe-input num" type="number" min="0" max="50" step="0.5" data-field="sw" value="' + (o.sw === undefined ? 2 : o.sw) + '" title="' + PE.esc(T('fmt/width', 'Width')) + '">' +
                    toggle('dash', 'more', o.dash, T('fmt/dash', 'Dashed')));
                h += row(T('fmt/fill', 'Fill'), colorBtn('fill', o.fill, T('fmt/fill', 'Fill'), true));
                if (kind === 'rect' && objs.length) {
                    h += row(T('fmt/radius', 'Corners'), '<input class="pe-input num" type="number" min="0" max="200" data-field="radius" value="' + (o.radius || 0) + '">');
                }
                break;
            case 'line':
            case 'lineTool':
                h += row(T('fmt/color', 'Colour'), colorBtn('stroke', o.stroke || '#000000', T('fmt/color', 'Colour')) +
                    '<input class="pe-input num" type="number" min="0.25" max="50" step="0.25" data-field="sw" value="' + (o.sw || 2) + '" title="' + PE.esc(T('fmt/width', 'Width')) + '">' +
                    toggle('dash', 'more', o.dash, T('fmt/dash', 'Dashed')));
                if (kind === 'line') {
                    h += row(T('fmt/arrow', 'Arrows'), '<select class="pe-select" data-field="arrow"><option value="none">' + PE.esc(T('fmt/arrowNone', 'None')) +
                        '</option><option value="end">' + PE.esc(T('fmt/arrowEnd', 'At the end')) + '</option><option value="both">' + PE.esc(T('fmt/arrowBoth', 'Both ends')) + '</option></select>');
                }
                break;
            case 'ink':
                h += row(T('fmt/color', 'Colour'), colorBtn('stroke', o.stroke || '#000000', T('fmt/color', 'Colour')) +
                    '<input class="pe-input num" type="number" min="0.25" max="50" step="0.25" data-field="sw" value="' + (o.sw || 2) + '" title="' + PE.esc(T('fmt/width', 'Width')) + '">');
                break;
            case 'markup':
                h += row(T('fmt/color', 'Colour'), colorBtn('color', o.color || '#ffd400', T('fmt/color', 'Colour')));
                break;
            case 'redact':
                h += '<div class="pe-note">' + PE.esc(T('fmt/redactNote', 'When you save, the content under the box is removed for good and the page is stored as an image.')) + '</div>';
                break;
            case 'link':
                h += '<div class="pe-note" style="word-break:break-all">' + PE.esc(P.objLabel(o)) + '</div>' +
                    '<div class="pe-fmt-row"><button class="pe-btn sm" data-act="editlink">' + PE.esc(T('fmt/editLink', 'Edit link...')) + '</button></div>';
                break;
            case 'image':
                break;
            default:
                break;
        }
        if (objs.length && kind !== 'redact' && kind !== 'link' && kind !== 'markup') {
            var op = Math.round((o.opacity === undefined ? 1 : o.opacity) * 100);
            h += row(T('fmt/opacity', 'Opacity'), '<input class="pe-range grow" type="range" min="5" max="100" data-field="opacity" value="' + op + '"><span class="pe-note" data-oplbl>' + op + '%</span>');
        }
        if (rotatable) {
            h += row(T('fmt/rotation', 'Rotation'), '<input class="pe-input num" type="number" min="-360" max="360" data-field="angle" value="' + Math.round(o.angle || 0) + '"><span class="pe-note">\u00b0</span>');
        }
        h += '</div>';
        card.innerHTML = h;
        card.querySelector('.pe-card-h .grow').textContent = title;
        var arrowSel = card.querySelector('[data-field="arrow"]');
        if (arrowSel) {
            arrowSel.value = o.arrow || 'none';
        }
        bindFormat(card, objs, target, kind);
        return card;
    }

    function apply(objs, target, kind, patch) {
        if (objs.length) {
            PE.objs.update(patch);
            //remember the style for the next object of the kind
            var st = kind === 'text' ? 'text' : kind === 'rect' || kind === 'ellipse' || kind === 'line' ? 'shape' : kind === 'ink' ? 'ink' : null;
            if (kind === 'markup') {
                st = objs[0].kind;
            }
            if (st && PE.objs.style[st]) {
                Object.keys(patch).forEach(function (k) {
                    if (k in PE.objs.style[st] || ['font', 'size', 'color', 'bold', 'italic', 'stroke', 'fill', 'sw'].indexOf(k) >= 0) {
                        if (k !== 'opacity' && k !== 'angle') {
                            PE.objs.style[st][k] = patch[k];
                        }
                    }
                });
            }
        } else {
            Object.keys(patch).forEach(function (k) {
                target[k] = patch[k];
            });
            P.renderProps();
        }
    }

    function bindFormat(card, objs, target, kind) {
        Array.prototype.forEach.call(card.querySelectorAll('[data-field]'), function (inp) {
            var field = inp.dataset.field;
            var evt = inp.type === 'range' ? 'input' : 'change';
            inp.addEventListener(evt, function () {
                var v;
                if (inp.type === 'checkbox') {
                    v = inp.checked;
                } else if (inp.type === 'number' || inp.type === 'range') {
                    v = parseFloat(inp.value);
                    if (isNaN(v)) {
                        return;
                    }
                    if (field === 'opacity') {
                        v = v / 100;
                        var lbl = card.querySelector('[data-oplbl]');
                        if (lbl) {
                            lbl.textContent = Math.round(v * 100) + '%';
                        }
                    }
                } else {
                    v = inp.value;
                }
                var patch = {};
                patch[field] = v;
                if (field === 'opacity' && inp.type === 'range' && objs.length) {
                    //live while dragging, one undo step when released
                    objs.forEach(function (o) { o.opacity = v; });
                    var f = D.find(objs[0].id);
                    if (f) {
                        V.refreshPage(f.k);
                    }
                    return;
                }
                apply(objs, target, kind, patch);
            });
            if (field === 'opacity' && inp.type === 'range' && objs.length) {
                var snap = null;
                inp.addEventListener('pointerdown', function () {
                    snap = D.snapshot();
                });
                inp.addEventListener('change', function () {
                    if (snap) {
                        D.pushUndo(snap);
                        snap = null;
                        D.emit('objects', {});
                    }
                });
            }
        });
        Array.prototype.forEach.call(card.querySelectorAll('[data-toggle]'), function (b) {
            b.addEventListener('click', function () {
                var patch = {};
                patch[b.dataset.toggle] = !b.classList.contains('on');
                b.classList.toggle('on');
                apply(objs, target, kind, patch);
            });
        });
        Array.prototype.forEach.call(card.querySelectorAll('[data-seg]'), function (sg) {
            Array.prototype.forEach.call(sg.querySelectorAll('button'), function (b) {
                b.addEventListener('click', function () {
                    var patch = {};
                    patch[sg.dataset.seg] = b.dataset.v;
                    apply(objs, target, kind, patch);
                });
            });
        });
        Array.prototype.forEach.call(card.querySelectorAll('[data-color]'), function (b) {
            b.addEventListener('click', function () {
                var field = b.dataset.color;
                PE.colorMenu(b, target[field], !!b.dataset.none, function (c, live) {
                    var patch = {};
                    patch[field] = c;
                    if (live) {
                        b.innerHTML = PE.swatch(c);
                        return;
                    }
                    if (field === 'bg' && c && objs.length === 1 && objs[0].type === 'text' && F.padOf(objs[0]) < 4) {
                        patch.pad = 4;
                    }
                    if (field === 'border' && c && objs.length === 1 && objs[0].type === 'text') {
                        patch.borderW = objs[0].borderW || 1;
                        if (F.padOf(objs[0]) < 4) {
                            patch.pad = 4;
                        }
                    }
                    apply(objs, target, kind, patch);
                });
            });
        });
        var del = card.querySelector('[data-act="delete"]');
        if (del) {
            del.addEventListener('click', function () {
                PE.objs.deleteSel();
            });
        }
        var el = card.querySelector('[data-act="editlink"]');
        if (el) {
            el.addEventListener('click', function () {
                PE.dialogs.link(objs[0], function (t) {
                    PE.objs.update({ url: t.url || '', page: t.page });
                });
            });
        }
    }

    /* ------------------------------------------------------------ init */
    P.init = function () {
        try {
            var ui = JSON.parse(localStorage.getItem('pdfeditor.panes') || 'null');
            if (ui) {
                P.left = TITLES[ui.left] ? ui.left : 'thumbs';
                P.leftOpen = ui.leftOpen !== false;
                P.rightOpen = ui.rightOpen !== false;
            }
        } catch (e) {
            //defaults
        }
        if (window.innerWidth < 860) {
            P.leftOpen = false;
            P.rightOpen = false;
        }
        //below 860 px the panes float over the page: close them when the
        //window shrinks to that size so the page stays visible
        var wasWide = window.innerWidth >= 860;
        window.addEventListener('resize', function () {
            var wide = window.innerWidth >= 860;
            if (wasWide && !wide) {
                //not remembered: a wide window opens them again next time
                P.leftOpen = false;
                P.rightOpen = false;
                layoutLeft();
                PE.$('peRight').hidden = true;
            }
            wasWide = wide;
        });
        Array.prototype.forEach.call(document.querySelectorAll('#peRail [data-panel]'), function (b) {
            b.addEventListener('click', function () {
                P.showLeft(b.dataset.panel, true);
            });
        });
        PE.$('peLeftClose').addEventListener('click', P.hideLeft);
        PE.$('peRightClose').addEventListener('click', function () {
            P.toggleRight(false);
        });
        PE.$('peLeftBody').addEventListener('keydown', function (e) {
            if ((e.key === 'Delete' || e.key === 'Backspace') && P.left === 'thumbs') {
                e.preventDefault();
                PE.run('deletePages');
            }
        });
        PE.$('peLeftBody').tabIndex = 0;
        layoutLeft();
        PE.$('peRight').hidden = !P.rightOpen;
        P.renderProps();
    };
})(window.PE);
