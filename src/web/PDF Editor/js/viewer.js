/*
    PDF Editor - page viewer

    Lays the pages out (continuous, single page or two pages side by side),
    renders the visible ones with pdf.js, keeps the overlays (objects,
    header/footer, Edit PDF blocks, search hits) in step with the zoom,
    and tracks the current page. 100% zoom is the paper's real size
    (96 CSS px per inch).

    Every page element holds, in order: under (background / watermark
    behind the text), the pdf.js canvas, the text layer (Select tool),
    Edit PDF blocks, over (header, footer, page numbers, watermark), the
    objects and the search highlights.
*/
window.PE = window.PE || {};

(function (PE) {
    'use strict';

    var D = PE.doc;
    var V = PE.view = {
        zoom: 1,
        fit: 'width',
        mode: 'continuous',
        cur: 0,
        tool: 'select',
        toolOpts: {},
        CSSU: 96 / 72,
        ZMIN: 0.1,
        ZMAX: 6.4
    };

    var viewer = null, pagesEl = null;
    var els = [];               //page elements in page order
    var byId = {};              //page id -> element (reused across rebuilds)
    var observer = null;
    var visible = {};
    var rendered = [];          //page ids with a rendered canvas, oldest first
    var busy = 0;
    var pumpTimer = null;
    var reRenderTimer = null;
    var textCache = {};

    V.scale = function () {
        return V.zoom * V.CSSU;
    };

    V.viewer = function () {
        return viewer;
    };

    V.pageEl = function (k) {
        return els[k] || null;
    };

    V.count = function () {
        return els.length;
    };

    /* ------------------------------------------------------------ building */
    function makePage(p) {
        var el = PE.el('div', 'pe-page');
        var inner = PE.el('div', 'pe-page-inner');
        var st = {
            id: p.id,
            inner: inner,
            under: PE.el('div', 'pe-under'),
            canvas: PE.el('canvas', 'pe-canvas'),
            text: PE.el('div', 'pe-textlayer'),
            runs: PE.el('div', 'pe-runs'),
            over: PE.el('div', 'pe-over'),
            objs: PE.el('div', 'pe-objs'),
            find: PE.el('div', 'pe-findhl'),
            scale: 0,
            ovScale: 0,
            textScale: 0,
            token: 0,
            sig: ''
        };
        st.canvas.width = 0;
        st.canvas.height = 0;
        [st.under, st.canvas, st.text, st.runs, st.over, st.objs, st.find].forEach(function (c) {
            inner.appendChild(c);
        });
        el.appendChild(inner);
        el._pe = st;
        return el;
    }

    function sigOf(p) {
        //what a rendered canvas depends on besides the zoom
        return D.totalRot(p) + '|' + (p.edits || []).length + '|' + p.s + ':' + p.i;
    }

    function sizePage(k) {
        var el = els[k];
        var st = el._pe;
        var s = V.scale();
        var d = D.dims(k);
        el.style.width = Math.round(d.w * s) + 'px';
        el.style.height = Math.round(d.h * s) + 'px';
        st.inner.style.width = d.W * s + 'px';
        st.inner.style.height = d.H * s + 'px';
        st.inner.style.left = -d.ox * s + 'px';
        st.inner.style.top = -d.oy * s + 'px';
    }

    /* Rebuild the page list (after pages were added, removed or reordered) */
    V.rebuild = function () {
        if (!pagesEl) {
            return;
        }
        var keep = {};
        var list = [];
        D.pages.forEach(function (p, k) {
            var el = byId[p.id];
            if (!el) {
                el = makePage(p);
                byId[p.id] = el;
            }
            el.dataset.k = k;
            keep[p.id] = true;
            var sig = sigOf(p);
            if (el._pe.sig !== sig) {
                el._pe.sig = sig;
                el._pe.scale = 0;
                el._pe.textScale = 0;
                el._pe.token++;
                el._pe.text.innerHTML = '';
            }
            el._pe.ovScale = 0;
            list.push(el);
        });
        Object.keys(byId).forEach(function (id) {
            if (!keep[id]) {
                if (observer) {
                    observer.unobserve(byId[id]);
                }
                if (byId[id].parentNode) {
                    byId[id].parentNode.removeChild(byId[id]);
                }
                delete byId[id];
            }
        });
        rendered = rendered.filter(function (id) { return keep[id]; });
        els = list;
        //put the elements in order without detaching the ones already in place
        list.forEach(function (el, k) {
            if (pagesEl.children[k] !== el) {
                pagesEl.insertBefore(el, pagesEl.children[k] || null);
            }
        });
        while (pagesEl.children.length > list.length) {
            pagesEl.removeChild(pagesEl.lastChild);
        }
        visible = {};
        list.forEach(function (el, k) {
            sizePage(k);
            if (observer) {
                observer.unobserve(el);
                observer.observe(el);
            }
        });
        if (V.cur >= els.length) {
            V.cur = Math.max(0, els.length - 1);
        }
        applyMode();
        if (V.fit) {
            computeFit();
        }
        schedule();
        V.updateStatus();
    };

    V.clear = function () {
        Object.keys(byId).forEach(function (id) {
            if (observer) {
                observer.unobserve(byId[id]);
            }
        });
        byId = {};
        els = [];
        rendered = [];
        visible = {};
        textCache = {};
        if (pagesEl) {
            pagesEl.innerHTML = '';
        }
    };

    /* Redraw a page: overlays always, the canvas too when opts.canvas */
    V.refreshPage = function (k, opts) {
        var el = els[k];
        if (!el) {
            return;
        }
        var p = D.pages[k];
        var sig = sigOf(p);
        if (el._pe.sig !== sig || (opts && opts.canvas)) {
            el._pe.sig = sig;
            el._pe.scale = 0;
            el._pe.textScale = 0;
            el._pe.token++;
        }
        sizePage(k);
        el._pe.ovScale = 0;
        if (visible[k]) {
            paintOverlays(k);
        }
        schedule();
    };

    V.refreshAll = function () {
        els.forEach(function (el, k) {
            sizePage(k);
            el._pe.ovScale = 0;
        });
        Object.keys(visible).forEach(function (k) {
            paintOverlays(+k);
        });
        schedule();
    };

    /* ------------------------------------------------------------ rendering */
    function paintOverlays(k) {
        var el = els[k];
        if (!el) {
            return;
        }
        var st = el._pe;
        var s = V.scale();
        st.ovScale = s;
        if (PE.deco) {
            PE.deco.render(st.under, st.over, k, s);
        }
        if (PE.objs) {
            PE.objs.renderLayer(st.objs, k, s, true);
        }
        if (PE.textedit) {
            PE.textedit.paintRuns(k);
        }
        paintFind(k);
    }

    function textLayer(k) {
        var el = els[k];
        var st = el._pe;
        var s = V.scale();
        if (V.tool !== 'textsel' || st.textScale === s) {
            return;
        }
        var p = D.pages[k];
        st.textScale = s;
        st.text.innerHTML = '';
        if (p.s < 0) {
            return;
        }
        var token = st.token;
        Promise.all([D.pdfPage(k), V.textContent(k)]).then(function (r) {
            if (token !== st.token || st.textScale !== s || !r[0] || !r[1]) {
                return;
            }
            var vp = r[0].getViewport({ scale: s, rotation: D.totalRot(p) });
            st.text.innerHTML = '';
            pdfjsLib.renderTextLayer({ textContent: r[1], container: st.text, viewport: vp, textDivs: [] });
        }).catch(function () {});
    }

    function renderCanvas(k) {
        var el = els[k];
        var st = el._pe;
        var s = V.scale();
        if (st.scale === s) {
            return Promise.resolve();
        }
        var token = ++st.token;
        var p = D.pages[k];
        var d = D.dims(k);
        var dpr = window.devicePixelRatio || 1;
        var rs = s * dpr;
        var area = d.W * rs * d.H * rs;
        var MAX = 14e6;
        if (area > MAX) {
            rs *= Math.sqrt(MAX / area);
        }
        if (p.s < 0) {
            st.canvas.width = Math.max(1, Math.round(d.W * rs));
            st.canvas.height = Math.max(1, Math.round(d.H * rs));
            st.scale = s;
            return Promise.resolve();
        }
        return D.pdfPage(k).then(function (page) {
            if (token !== st.token) {
                return;
            }
            var vp = page.getViewport({ scale: rs, rotation: D.totalRot(p) });
            var off = document.createElement('canvas');
            off.width = Math.max(1, Math.ceil(vp.width));
            off.height = Math.max(1, Math.ceil(vp.height));
            var task = page.render({
                canvasContext: off.getContext('2d'),
                viewport: vp,
                background: 'rgba(0,0,0,0)',
                intent: document.hidden ? 'print' : 'display'
            });
            return task.promise.then(function () {
                if (token !== st.token) {
                    return;
                }
                if (PE.textedit) {
                    PE.textedit.patchCanvas(off, k, rs);
                }
                st.canvas.width = off.width;
                st.canvas.height = off.height;
                st.canvas.getContext('2d').drawImage(off, 0, 0);
                st.scale = s;
                noteRendered(st.id);
            });
        }).catch(function (err) {
            if (err && err.name === 'RenderingCancelledException') {
                return;
            }
            console.warn('[PDF Editor] page render failed', err);
        });
    }

    function noteRendered(id) {
        var i = rendered.indexOf(id);
        if (i >= 0) {
            rendered.splice(i, 1);
        }
        rendered.push(id);
        if (rendered.length > 28) {
            for (var j = 0; j < rendered.length && rendered.length > 24; j++) {
                var el = byId[rendered[j]];
                if (el && !visible[+el.dataset.k]) {
                    el._pe.canvas.width = 0;
                    el._pe.canvas.height = 0;
                    el._pe.scale = 0;
                    el._pe.textScale = 0;
                    el._pe.text.innerHTML = '';
                    rendered.splice(j, 1);
                    j--;
                }
            }
        }
    }

    function schedule() {
        clearTimeout(pumpTimer);
        pumpTimer = setTimeout(pump, 16);
    }

    function pump() {
        var s = V.scale();
        var ks = Object.keys(visible).map(Number).filter(function (k) { return k < els.length; });
        ks.sort(function (a, b) { return Math.abs(a - V.cur) - Math.abs(b - V.cur); });
        ks.forEach(function (k) {
            if (els[k]._pe.ovScale !== s) {
                paintOverlays(k);
            }
            textLayer(k);
        });
        if (busy >= 2) {
            return;
        }
        for (var i = 0; i < ks.length && busy < 2; i++) {
            var st = els[ks[i]]._pe;
            if (st.scale !== s && !st.pending) {
                st.pending = true;
                busy++;
                (function (k, stx) {
                    renderCanvas(k).then(function () {
                        stx.pending = false;
                        busy--;
                        textLayer(k);
                        schedule();
                    });
                })(ks[i], st);
            }
        }
    }

    function onIntersect(entries) {
        entries.forEach(function (e) {
            var k = +e.target.dataset.k;
            if (e.isIntersecting) {
                visible[k] = true;
            } else {
                delete visible[k];
            }
        });
        schedule();
    }

    V.isVisible = function (k) {
        return !!visible[k];
    };

    /* ------------------------------------------------------------ text */
    V.textContent = function (k) {
        var p = D.pages[k];
        if (!p || p.s < 0) {
            return Promise.resolve(null);
        }
        var key = p.s + ':' + p.i;
        if (!textCache[key]) {
            textCache[key] = D.sources[p.s].pdf.getPage(p.i + 1).then(function (pg) {
                return pg.getTextContent({ normalizeWhitespace: true });
            }).catch(function () {
                return null;
            });
        }
        return textCache[key];
    };

    /*
        Text items of page k as view-space boxes (scale 1):
        [{str, x, y, w, h, dir:[dx,dy], ox, oy, len, angle}]
        (ox, oy) = baseline start; dir = unit vector along the text.
    */
    V.textItems = function (k) {
        return V.textContent(k).then(function (tc) {
            if (!tc) {
                return [];
            }
            var vp = D.viewport(k, 1);
            var out = [];
            tc.items.forEach(function (it) {
                if (!it.str) {
                    return;
                }
                var t = it.transform;
                var fs = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]) || 1;
                var len = Math.hypot(t[0], t[1]) || 1;
                var ux = t[0] / len, uy = t[1] / len;
                var vx = -uy, vy = ux;
                var w = it.width || 0;
                var asc = fs * 0.85, desc = fs * 0.22;
                var pts = [
                    [t[4] - vx * desc, t[5] - vy * desc],
                    [t[4] + ux * w - vx * desc, t[5] + uy * w - vy * desc],
                    [t[4] + ux * w + vx * asc, t[5] + uy * w + vy * asc],
                    [t[4] + vx * asc, t[5] + vy * asc]
                ].map(function (q) { return vp.toView(q[0], q[1]); });
                var xs = pts.map(function (q) { return q[0]; }), ys = pts.map(function (q) { return q[1]; });
                var o = vp.toView(t[4], t[5]);
                var e = vp.toView(t[4] + ux, t[5] + uy);
                var dx = e[0] - o[0], dy = e[1] - o[1];
                out.push({
                    str: it.str,
                    x: Math.min.apply(null, xs), y: Math.min.apply(null, ys),
                    w: Math.max.apply(null, xs) - Math.min.apply(null, xs),
                    h: Math.max.apply(null, ys) - Math.min.apply(null, ys),
                    ox: o[0], oy: o[1], dir: [dx, dy], len: w, fs: fs,
                    corners: pts,
                    angle: Math.round(Math.atan2(dy, dx) * 180 / Math.PI)
                });
            });
            return out;
        });
    };

    /* ------------------------------------------------------------ layout */
    function applyMode() {
        if (!pagesEl) {
            return;
        }
        pagesEl.classList.toggle('mode-two', V.mode === 'two');
        pagesEl.classList.toggle('mode-single', V.mode === 'single');
        els.forEach(function (el, k) {
            el.classList.toggle('cur', k === V.cur);
        });
    }

    V.setMode = function (m) {
        V.mode = m;
        applyMode();
        if (V.fit) {
            computeFit();
        }
        V.refreshAll();
        V.goto(V.cur, true);
        V.updateStatus();
        PE.emitUi && PE.emitUi();
    };

    function maxPageWidth() {
        var w = 0;
        for (var k = 0; k < D.pages.length; k++) {
            w = Math.max(w, D.dims(k).w);
        }
        return w || 612;
    }

    function computeFit() {
        if (!viewer || !D.pages.length) {
            return;
        }
        var cw = viewer.clientWidth - 48 - 4;
        var ch = viewer.clientHeight - 48;
        var mw = maxPageWidth();
        var s;
        if (V.mode === 'two') {
            s = (cw - 14) / (2 * mw);
        } else {
            s = cw / mw;
        }
        if (V.fit === 'page') {
            var d = D.dims(Math.min(V.cur, D.pages.length - 1));
            s = Math.min(s, ch / d.h);
        }
        var z = PE.clamp(s / V.CSSU, V.ZMIN, V.ZMAX);
        if (Math.abs(z - V.zoom) > 0.001) {
            setZoomInternal(z, null);
        }
    }

    V.setFit = function (f) {
        V.fit = f;
        computeFit();
        V.updateStatus();
    };

    function anchorOf(clientX, clientY) {
        var r = viewer.getBoundingClientRect();
        var ax = clientX === undefined ? viewer.clientWidth / 2 : clientX - r.left;
        var ay = clientY === undefined ? viewer.clientHeight / 2 : clientY - r.top;
        var k = V.cur;
        var docY = viewer.scrollTop + ay;
        for (var i = 0; i < els.length; i++) {
            if (els[i].offsetParent && els[i].offsetTop <= docY) {
                k = i;
            }
            if (els[i].offsetTop > docY) {
                break;
            }
        }
        var el = els[k];
        if (!el) {
            return null;
        }
        var s = V.scale();
        return {
            k: k, ax: ax, ay: ay,
            px: (viewer.scrollLeft + ax - el.offsetLeft) / s,
            py: (viewer.scrollTop + ay - el.offsetTop) / s
        };
    }

    function setZoomInternal(z, anchor) {
        var a = anchor || anchorOf();
        V.zoom = z;
        els.forEach(function (el, k) {
            sizePage(k);
        });
        if (a && els[a.k]) {
            var s = V.scale();
            var el = els[a.k];
            viewer.scrollLeft = el.offsetLeft + a.px * s - a.ax;
            viewer.scrollTop = el.offsetTop + a.py * s - a.ay;
        }
        Object.keys(visible).forEach(function (k) {
            paintOverlays(+k);
        });
        clearTimeout(reRenderTimer);
        reRenderTimer = setTimeout(schedule, 140);
        V.updateStatus();
        if (PE.objs) {
            PE.objs.onZoom();
        }
    }

    V.setZoom = function (z, clientX, clientY) {
        z = PE.clamp(z, V.ZMIN, V.ZMAX);
        V.fit = null;
        if (Math.abs(z - V.zoom) < 0.0005) {
            V.updateStatus();
            return;
        }
        var a = clientX === undefined ? anchorOf() : anchorOf(clientX, clientY);
        setZoomInternal(z, a);
    };

    var STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6.4];
    V.zoomStep = function (dir) {
        var z = V.zoom;
        var next = z;
        if (dir > 0) {
            for (var i = 0; i < STEPS.length; i++) {
                if (STEPS[i] > z + 0.001) {
                    next = STEPS[i];
                    break;
                }
            }
        } else {
            for (var j = STEPS.length - 1; j >= 0; j--) {
                if (STEPS[j] < z - 0.001) {
                    next = STEPS[j];
                    break;
                }
            }
        }
        V.setZoom(next);
    };

    /* ------------------------------------------------------------ navigation */
    V.goto = function (k, instant) {
        if (!els.length) {
            return;
        }
        k = PE.clamp(k, 0, els.length - 1);
        var changed = k !== V.cur;
        V.cur = k;
        if (V.mode === 'single') {
            applyMode();
            viewer.scrollTop = 0;
            if (V.fit === 'page') {
                computeFit();
            }
            schedule();
        } else {
            var el = els[k];
            viewer.scrollTop = Math.max(0, el.offsetTop - 14);
        }
        if (changed) {
            PE.emitPage && PE.emitPage();
        }
        V.updateStatus();
    };

    /* Scroll so the view-space point (x, y) of page k is visible */
    V.reveal = function (k, x, y) {
        var el = els[k];
        if (!el) {
            return;
        }
        if (V.mode === 'single' && k !== V.cur) {
            V.goto(k);
        }
        var s = V.scale();
        var d = D.dims(k);
        var ty = el.offsetTop + (y - d.oy) * s;
        var tx = el.offsetLeft + (x - d.ox) * s;
        if (ty < viewer.scrollTop + 40 || ty > viewer.scrollTop + viewer.clientHeight - 60) {
            viewer.scrollTop = ty - viewer.clientHeight / 3;
        }
        if (tx < viewer.scrollLeft + 20 || tx > viewer.scrollLeft + viewer.clientWidth - 40) {
            viewer.scrollLeft = tx - viewer.clientWidth / 2;
        }
    };

    function updateCur() {
        if (V.mode === 'single' || !els.length) {
            return;
        }
        var line = viewer.scrollTop + viewer.clientHeight * 0.32;
        var lo = 0, hi = els.length - 1, k = 0;
        while (lo <= hi) {
            var mid = (lo + hi) >> 1;
            if (els[mid].offsetTop <= line) {
                k = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        if (viewer.scrollTop + viewer.clientHeight >= viewer.scrollHeight - 2) {
            //at the very end the last pages may never reach the line
            var last = els.length - 1;
            if (els[last].offsetTop < viewer.scrollTop + viewer.clientHeight) {
                k = Math.max(k, last);
            }
        }
        if (k !== V.cur) {
            V.cur = k;
            V.updateStatus();
            PE.emitPage && PE.emitPage();
        }
    }

    /* ------------------------------------------------------------ points */
    V.pageIndexOf = function (node) {
        var el = node && node.closest ? node.closest('.pe-page') : null;
        if (!el || !el._pe) {
            return -1;
        }
        return +el.dataset.k;
    };

    /* Client coordinates to view-space points of page k */
    V.pagePoint = function (k, clientX, clientY) {
        var el = els[k];
        var r = el._pe.inner.getBoundingClientRect();
        var s = V.scale();
        return { x: (clientX - r.left) / s, y: (clientY - r.top) / s };
    };

    /* The page under a client point (or -1) */
    V.pageAtClient = function (clientX, clientY) {
        for (var k = 0; k < els.length; k++) {
            var r = els[k].getBoundingClientRect();
            if (r.width && clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
                return k;
            }
        }
        return -1;
    };

    /* ------------------------------------------------------------ tools */
    var TOOL_CLASS = {
        select: 'select', textsel: 'textsel', snapshot: 'snapshot', hand: 'hand', text: 'text', editpdf: 'editpdf', rect: 'shape', ellipse: 'shape', line: 'shape',
        arrow: 'shape', draw: 'draw', highlight: 'markup', underline: 'markup', strike: 'markup', redact: 'redact',
        whiteout: 'whiteout', link: 'link', crop: 'crop', place: 'place'
    };

    V.setTool = function (t, opts) {
        if (!TOOL_CLASS[t]) {
            t = 'select';
        }
        var prev = V.tool;
        V.tool = t;
        V.toolOpts = opts || {};
        Object.keys(TOOL_CLASS).forEach(function (k) {
            viewer.classList.remove('tool-' + TOOL_CLASS[k]);
        });
        viewer.classList.add('tool-' + TOOL_CLASS[t]);
        if (prev !== t) {
            if (PE.objs) {
                PE.objs.onTool(prev, t);
            }
            els.forEach(function (el) {
                el._pe.textScale = 0;
                if (t !== 'textsel') {
                    el._pe.text.innerHTML = '';
                }
            });
            Object.keys(visible).forEach(function (k) {
                paintOverlays(+k);
                textLayer(+k);
            });
        }
        showHint();
        PE.emitUi && PE.emitUi();
    };

    function showHint() {
        var h = PE.$('peHint');
        if (!h) {
            return;
        }
        var msg = '';
        switch (V.tool) {
            case 'editpdf': msg = PE.T('hint/editpdf', 'Click a block of text to edit it. The original text is replaced when you save.'); break;
            case 'draw': msg = PE.T('hint/draw', 'Drag on a page to draw. Press Esc when you are done.'); break;
            case 'highlight': msg = PE.T('hint/highlight', 'Drag across text to highlight it.'); break;
            case 'underline': msg = PE.T('hint/underline', 'Drag across text to underline it.'); break;
            case 'strike': msg = PE.T('hint/strike', 'Drag across text to strike it through.'); break;
            case 'redact': msg = PE.T('hint/redact', 'Drag over the content to remove. Redacted pages are saved as images so nothing stays under the boxes.'); break;
            case 'whiteout': msg = PE.T('hint/whiteout', 'Drag to cover an area with white.'); break;
            case 'link': msg = PE.T('hint/link', 'Drag over the area that should open the link.'); break;
            case 'crop': msg = PE.T('hint/crop', 'Drag the area of the page to keep.'); break;
            case 'place': msg = V.toolOpts.hint || PE.T('hint/place', 'Click on a page to place it.'); break;
            case 'text': msg = PE.T('hint/text', 'Click on a page to add text.'); break;
            case 'snapshot': msg = PE.T('hint/snapshot', 'Drag over the area to copy as a picture.'); break;
            case 'rect': case 'ellipse': case 'line': case 'arrow': msg = PE.T('hint/shape', 'Drag on a page to draw the shape.'); break;
            default: msg = '';
        }
        if (!msg) {
            h.hidden = true;
            return;
        }
        h.hidden = false;
        h.innerHTML = '<span>' + PE.esc(msg) + '</span>';
        var b = PE.el('button', '', PE.esc(V.tool === 'editpdf' || V.tool === 'draw' ? PE.T('hint/done', 'Done') : PE.T('common/cancel', 'Cancel')));
        b.addEventListener('click', function () { V.setTool('select'); });
        h.appendChild(b);
    }

    /* ------------------------------------------------------------ find */
    var find = { q: '', hits: [], idx: -1, index: null };

    function pageTextIndex(k) {
        return V.textContent(k).then(function (tc) {
            if (!tc) {
                return { text: '', map: [] };
            }
            var text = '';
            var map = [];       //per item: start offset in text
            tc.items.forEach(function (it, i) {
                var s = it.str || '';
                if (text && s && !/\s$/.test(text) && !/^\s/.test(s)) {
                    text += ' ';
                }
                map.push({ i: i, start: text.length, len: s.length });
                text += s;
            });
            return { text: text, map: map };
        });
    }

    V.findRun = function (q) {
        find.q = q;
        find.hits = [];
        find.idx = -1;
        if (!q) {
            paintAllFind();
            return Promise.resolve(0);
        }
        var needle = q.toLowerCase();
        var jobs = D.pages.map(function (p, k) {
            return pageTextIndex(k).then(function (ix) {
                var hay = ix.text.toLowerCase();
                var out = [];
                var pos = hay.indexOf(needle);
                while (pos >= 0 && out.length < 500) {
                    out.push({ k: k, start: pos, end: pos + needle.length, ix: ix });
                    pos = hay.indexOf(needle, pos + Math.max(1, needle.length));
                }
                return out;
            });
        });
        return Promise.all(jobs).then(function (res) {
            if (find.q !== q) {
                return find.hits.length;
            }
            res.forEach(function (r) {
                find.hits = find.hits.concat(r);
            });
            //start at the first hit on or after the current page
            find.idx = -1;
            for (var i = 0; i < find.hits.length; i++) {
                if (find.hits[i].k >= V.cur) {
                    find.idx = i;
                    break;
                }
            }
            if (find.idx < 0 && find.hits.length) {
                find.idx = 0;
            }
            paintAllFind();
            revealHit();
            return find.hits.length;
        });
    };

    V.findStep = function (dir) {
        if (!find.hits.length) {
            return;
        }
        find.idx = (find.idx + dir + find.hits.length) % find.hits.length;
        paintAllFind();
        revealHit();
    };

    V.findState = function () {
        return { count: find.hits.length, idx: find.idx };
    };

    V.findClear = function () {
        find.q = '';
        find.hits = [];
        find.idx = -1;
        paintAllFind();
    };

    function hitRects(hit, items) {
        var out = [];
        hit.ix.map.forEach(function (m) {
            var a = Math.max(hit.start, m.start), b = Math.min(hit.end, m.start + m.len);
            if (a >= b || !items[m.i]) {
                return;
            }
            var it = items[m.i];
            var n = Math.max(1, m.len);
            var f0 = (a - m.start) / n, f1 = (b - m.start) / n;
            var c = it.corners;
            //corners: 0 baseline-start(desc), 1 baseline-end(desc), 2 top-end, 3 top-start
            function lerp(p, q, f) {
                return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
            }
            var pts = [lerp(c[0], c[1], f0), lerp(c[0], c[1], f1), lerp(c[3], c[2], f1), lerp(c[3], c[2], f0)];
            var xs = pts.map(function (q) { return q[0]; }), ys = pts.map(function (q) { return q[1]; });
            out.push({
                x: Math.min.apply(null, xs), y: Math.min.apply(null, ys),
                w: Math.max.apply(null, xs) - Math.min.apply(null, xs), h: Math.max.apply(null, ys) - Math.min.apply(null, ys)
            });
        });
        return out;
    }

    function paintFind(k) {
        var el = els[k];
        if (!el) {
            return;
        }
        var layer = el._pe.find;
        layer.innerHTML = '';
        var mine = [];
        find.hits.forEach(function (h, i) {
            if (h.k === k) {
                mine.push({ h: h, cur: i === find.idx });
            }
        });
        if (!mine.length) {
            return;
        }
        var s = V.scale();
        V.textItems(k).then(function (items) {
            if (el._pe.find !== layer) {
                return;
            }
            layer.innerHTML = '';
            mine.forEach(function (m) {
                hitRects(m.h, items).forEach(function (r) {
                    var d = PE.el('div', 'hit' + (m.cur ? ' cur' : ''));
                    d.style.left = r.x * s + 'px';
                    d.style.top = r.y * s + 'px';
                    d.style.width = r.w * s + 'px';
                    d.style.height = r.h * s + 'px';
                    layer.appendChild(d);
                });
            });
        });
    }

    function paintAllFind() {
        els.forEach(function (el, k) {
            if (visible[k]) {
                paintFind(k);
            } else {
                el._pe.find.innerHTML = '';
                el._pe.ovScale = 0;
            }
        });
    }

    function revealHit() {
        var h = find.hits[find.idx];
        if (!h) {
            return;
        }
        V.textItems(h.k).then(function (items) {
            var rs = hitRects(h, items);
            if (rs.length) {
                if (V.mode === 'single' && h.k !== V.cur) {
                    V.goto(h.k);
                }
                V.reveal(h.k, rs[0].x, rs[0].y);
            } else {
                V.goto(h.k);
            }
        });
    }

    /* ------------------------------------------------------------ status bar */
    V.updateStatus = function () {
        var n = els.length;
        var inp = PE.$('pePageInput');
        if (!inp) {
            return;
        }
        if (document.activeElement !== inp) {
            inp.value = n ? V.cur + 1 : '';
        }
        PE.$('pePageCount').textContent = '/ ' + n;
        PE.$('peFirst').disabled = PE.$('pePrev').disabled = !n || V.cur <= 0;
        PE.$('peNext').disabled = PE.$('peLast').disabled = !n || V.cur >= n - 1;
        PE.$('peZoomLbl').textContent = Math.round(V.zoom * 100) + '%';
        var sl = PE.$('peZoomSlider');
        if (document.activeElement !== sl) {
            sl.value = Math.round(Math.log(V.zoom / V.ZMIN) / Math.log(V.ZMAX / V.ZMIN) * 1000);
        }
        PE.$('peFitBtn').classList.toggle('on', V.fit === 'width');
        var mb = PE.$('peModeBtn');
        mb.innerHTML = PE.icon(V.mode === 'two' ? 'twopage' : (V.mode === 'single' ? 'single' : 'continuous'), 'sm');
    };

    V.sliderToZoom = function (v) {
        return V.ZMIN * Math.pow(V.ZMAX / V.ZMIN, v / 1000);
    };

    /* ------------------------------------------------------------ init */
    var spaceDown = false;

    V.init = function () {
        viewer = PE.$('peViewer');
        pagesEl = PE.$('pePages');
        observer = new IntersectionObserver(onIntersect, { root: viewer, rootMargin: '700px 300px' });
        viewer.addEventListener('scroll', function () {
            updateCur();
            schedule();
        }, { passive: true });
        viewer.addEventListener('wheel', function (e) {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                var f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022));
                V.setZoom(V.zoom * f, e.clientX, e.clientY);
            }
        }, { passive: false });
        if (window.ResizeObserver) {
            new ResizeObserver(function () {
                if (V.fit) {
                    computeFit();
                }
            }).observe(viewer);
        }
        //panning: Hand tool, middle button, or space + drag
        viewer.addEventListener('pointerdown', function (e) {
            var pan = V.tool === 'hand' || e.button === 1 || (spaceDown && e.button === 0);
            if (!pan) {
                return;
            }
            if (e.target.closest && e.target.closest('.pe-obj') && V.tool !== 'hand' && !spaceDown && e.button !== 1) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            var sx = e.clientX, sy = e.clientY, sl = viewer.scrollLeft, stp = viewer.scrollTop;
            viewer.classList.add('panning');
            viewer.setPointerCapture(e.pointerId);
            function mv(ev) {
                viewer.scrollLeft = sl - (ev.clientX - sx);
                viewer.scrollTop = stp - (ev.clientY - sy);
            }
            function up() {
                viewer.classList.remove('panning');
                viewer.removeEventListener('pointermove', mv);
                viewer.removeEventListener('pointerup', up);
                viewer.removeEventListener('pointercancel', up);
            }
            viewer.addEventListener('pointermove', mv);
            viewer.addEventListener('pointerup', up);
            viewer.addEventListener('pointercancel', up);
        }, true);
        document.addEventListener('keydown', function (e) {
            if (e.code === 'Space' && !isTyping(e.target)) {
                if (!spaceDown) {
                    spaceDown = true;
                    viewer.classList.add('tool-hand');
                }
                if (e.target === document.body || e.target === viewer) {
                    e.preventDefault();
                }
            }
        });
        document.addEventListener('keyup', function (e) {
            if (e.code === 'Space') {
                spaceDown = false;
                if (V.tool !== 'hand') {
                    viewer.classList.remove('tool-hand');
                }
            }
        });
        V.setTool('select');
    };

    function isTyping(t) {
        return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    }
    V.isTyping = isTyping;
})(window.PE);
