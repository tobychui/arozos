/*
    reader.pdf.js

    A copy of Drive's PDF viewer (Drive/js/viewer.pdf.js), kept as close to
    it as possible so improvements can be carried across. The differences:
    the Drive globals are this app's own (DriveUI -> ReaderUI, DriveViewer ->
    Reader, DriveActions.download / Drive.locationLabel -> Reader.*), pdf.js
    and the cMaps come from js/ and cmaps/ in this folder, and the password
    prompt hides what is typed.

    PDF reader on pdf.js (Apache-2.0, see LICENSE): a rail of
    page thumbnails and the document outline, continuous pages rendered as
    they scroll into view with a selectable text layer and clickable links,
    zoom (buttons, presets, Ctrl + wheel, pinch), rotation, find in the
    document, a floating page navigator, password protected files and
    printing.

    Zooming resizes every page at once (the canvases are stretched) and the
    visible pages are redrawn sharp shortly after, so it stays fluid on long
    documents.
*/

(function () {
    "use strict";

    var I = ReaderUI.I;
    var esc = ReaderUI.esc;
    var U = Reader.util;

    var BASE = "js/";
    var CSS_UNITS = 96 / 72;
    var ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
    var MAX_RENDERED = 24;

    function ready() {
        return U.loadScript(BASE + "pdf.js?v=2.7.570").then(function () {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = U.absolute(BASE + "pdf.worker.js?v=2.7.570");
            return window.pdfjsLib;
        });
    }

    function mount(ctx) {
        var item = ctx.item;
        var mem = ctx.memory;
        if (mem.rail === undefined) {
            mem.rail = window.innerWidth > 900;
        }
        var st = {
            pdf: null, task: null, pages: [], count: 0, zoom: 1, mode: "auto", rot: 0, current: 1,
            destroyed: false, renderTimer: null, rendered: [], outline: null,
            find: { q: "", hits: [], at: -1, text: {} }
        };

        ctx.body.innerHTML =
            '<aside class="pdf-rail' + (mem.rail ? "" : " collapsed") + '">' +
            '<div class="pdf-rail-tabs"><button class="active" data-tab="pages">' + esc(T("vw/pages", "Pages")) + '</button>' +
            '<button data-tab="outline">' + esc(T("vw/outline", "Outline")) + '</button></div>' +
            '<div class="pdf-thumbs vw-scroll"></div><div class="pdf-outline vw-scroll" hidden></div></aside>' +
            '<div class="pdf-main vw-scroll" tabindex="0"><div class="pdf-pages"><div class="vw-state"><div class="vw-spin"></div>' +
            '<div class="vw-progress"><i></i></div></div></div></div>' +
            '<div class="vw-float pdf-nav" hidden><button class="vw-ic" data-n="prev" title="' + esc(T("vw/prevPage", "Previous page")) + '">' + I("chevronLeft") + '</button>' +
            '<input type="text" inputmode="numeric" value="1" aria-label="' + esc(T("vw/page", "Page")) + '"><span>/ 1</span>' +
            '<button class="vw-ic" data-n="next" title="' + esc(T("vw/nextPage", "Next page")) + '">' + I("chevronRight") + '</button></div>';

        var rail = ctx.body.querySelector(".pdf-rail");
        var thumbs = ctx.body.querySelector(".pdf-thumbs");
        var outlineEl = ctx.body.querySelector(".pdf-outline");
        var main = ctx.body.querySelector(".pdf-main");
        var pagesEl = ctx.body.querySelector(".pdf-pages");
        var nav = ctx.body.querySelector(".pdf-nav");
        var navInput = nav.querySelector("input");

        ctx.tools.innerHTML =
            '<button class="vw-ic' + (mem.rail ? " on" : "") + '" data-t="rail" title="' + esc(T("vw/sidebar", "Page sidebar")) + '">' + I("panel") + '</button>' +
            '<div class="vw-pill"><button class="vw-ic" data-t="out" title="' + esc(T("pv/zoomOut", "Zoom out")) + '">' + I("minimize") + '</button>' +
            '<button class="vw-pill-label" data-t="zoom" title="' + esc(T("vw/zoomOptions", "Zoom options")) + '">100%</button>' +
            '<button class="vw-ic" data-t="in" title="' + esc(T("pv/zoomIn", "Zoom in")) + '">' + I("plus") + '</button></div>' +
            '<button class="vw-ic vw-hide-sm" data-t="rotate" title="' + esc(T("pv/rotate", "Rotate")) + '">' + I("rotate") + '</button>' +
            '<button class="vw-ic" data-t="find" title="' + esc(T("vw/find", "Find in document")) + ' (Ctrl+F)">' + I("search") + '</button><span class="vw-sep vw-hide-sm"></span>';
        var zoomLabel = ctx.tools.querySelector('[data-t="zoom"]');

        /* Loading ------------------------------------------------------------- */
        function fail(err) {
            if (st.destroyed) {
                return;
            }
            pagesEl.innerHTML = U.stateHTML(item, T("vw/pdfFailed", "This PDF cannot be opened"), err && err.message ? err.message : "",
                [{ id: "dl", icon: "download", label: T("toolbar/download", "Download"), primary: true }]);
            U.bindState(pagesEl, { dl: function () { Reader.download(item); } });
        }

        ready().then(function (pdfjsLib) {
            if (st.destroyed) {
                return;
            }
            var task = pdfjsLib.getDocument({
                url: ctx.url,
                cMapUrl: U.absolute("cmaps/"),
                cMapPacked: true,
                withCredentials: true
            });
            st.task = task;
            task.onProgress = function (p) {
                var bar = pagesEl.querySelector(".vw-progress i");
                if (bar && p.total) {
                    bar.style.width = Math.min(100, p.loaded / p.total * 100) + "%";
                }
            };
            task.onPassword = function (update, reason) {
                ReaderUI.prompt({
                    title: T("vw/pdfPassword", "Password protected PDF"),
                    label: reason == 2 ? T("vw/pdfWrongPassword", "Wrong password, try again") : T("vw/pdfEnterPassword", "Enter the password to open this file"),
                    icon: "lock", ok: T("menu/open", "Open"), password: true
                }).then(function (pw) {
                    if (pw == null) {
                        fail(new Error(T("vw/pdfLocked", "The file stays locked without its password.")));
                        return;
                    }
                    update(pw);
                });
            };
            return task.promise;
        }).then(function (pdf) {
            if (!pdf || st.destroyed) {
                return;
            }
            st.pdf = pdf;
            st.count = pdf.numPages;
            return pdf.getPage(1).then(function (first) {
                st.base = first.getViewport({ scale: 1 });
                build(first);
            });
        }).catch(fail);

        function pageSize(p) {
            var vp = p.viewport || st.base;
            var rot = ((p.rotate || 0) + st.rot) % 180 != 0;
            var w = (rot ? vp.height : vp.width) * st.zoom * CSS_UNITS;
            var h = (rot ? vp.width : vp.height) * st.zoom * CSS_UNITS;
            return { w: Math.round(w), h: Math.round(h) };
        }

        function build(first) {
            pagesEl.innerHTML = "";
            thumbs.innerHTML = "";
            for (var i = 1; i <= st.count; i++) {
                var div = ReaderUI.el('<div class="pdf-page" data-page="' + i + '"><div class="ph"><div class="vw-spin" style="width:22px;height:22px;border-width:2px;border-color:#ddd;border-top-color:#999"></div></div></div>');
                var p = { n: i, div: div, viewport: i == 1 ? st.base : null, rotate: i == 1 ? first.rotate : 0, scale: 0, task: null, textDivs: null };
                st.pages.push(p);
                pagesEl.appendChild(div);
                var t = ReaderUI.el('<button class="pdf-thumb" data-page="' + i + '"><div class="pg" style="aspect-ratio:' + st.base.width + '/' + st.base.height + '"></div><span>' + i + '</span></button>');
                t.addEventListener("click", (function (n) {
                    return function () {
                        goToPage(n);
                        if (window.innerWidth <= 900) {
                            toggleRail(false);
                        }
                    };
                })(i));
                thumbs.appendChild(t);
            }
            nav.hidden = false;
            nav.querySelector("span").textContent = "/ " + st.count;
            setZoomMode(mem.zoomMode || "auto", true);
            observe();
            ctx.setPrintable(true);
            ctx.setMeta(ReaderUI.fmtSize(item.size) + " · " + T("vw/pageCount", "{n} pages", { n: st.count }) + " · " + Reader.locationLabel(item.path));
            main.focus();
        }

        /* Zoom ------------------------------------------------------------------ */
        function fitWidth() {
            var w = main.clientWidth - 48;
            return w / (st.base.width * CSS_UNITS * (st.rot % 180 ? st.base.height / st.base.width : 1));
        }

        function fitPage() {
            var w = main.clientWidth - 48, h = main.clientHeight - 56;
            var bw = (st.rot % 180 ? st.base.height : st.base.width) * CSS_UNITS;
            var bh = (st.rot % 180 ? st.base.width : st.base.height) * CSS_UNITS;
            return Math.min(w / bw, h / bh);
        }

        function setZoomMode(mode, initial) {
            st.mode = mode;
            if (mode == "width") {
                setZoom(fitWidth(), initial);
            } else if (mode == "page") {
                setZoom(fitPage(), initial);
            } else if (mode == "auto") {
                setZoom(Math.min(fitWidth(), 1.25), initial);
            } else {
                setZoom(parseFloat(mode), initial);
            }
        }

        function setZoom(z, initial, anchor) {
            if (!st.base) {
                return;
            }
            z = Math.max(0.1, Math.min(5, z));
            //Keep the point under the anchor (or the centre) where it is
            var ax = anchor ? anchor.x : main.clientWidth / 2;
            var ay = anchor ? anchor.y : main.clientHeight / 2;
            var fx = (main.scrollLeft + ax) / Math.max(1, main.scrollWidth);
            var fy = (main.scrollTop + ay) / Math.max(1, main.scrollHeight);
            st.zoom = z;
            st.pages.forEach(function (p) {
                var s = pageSize(p);
                p.div.style.width = s.w + "px";
                p.div.style.height = s.h + "px";
            });
            zoomLabel.textContent = Math.round(z * 100) + "%";
            if (!initial) {
                main.scrollLeft = fx * main.scrollWidth - ax;
                main.scrollTop = fy * main.scrollHeight - ay;
            }
            scheduleRender();
        }

        function stepZoom(dir) {
            var z = st.zoom;
            var next = dir > 0 ? ZOOMS.filter(function (x) { return x > z + 0.001; })[0] : ZOOMS.filter(function (x) { return x < z - 0.001; }).pop();
            if (next) {
                st.mode = String(next);
                mem.zoomMode = st.mode;
                setZoom(next);
            }
        }

        /* Rendering --------------------------------------------------------- */
        var io = null, thumbIO = null;
        var visible = {};

        function observe() {
            io = new IntersectionObserver(function (entries) {
                entries.forEach(function (en) {
                    var n = parseInt(en.target.getAttribute("data-page"), 10);
                    if (en.isIntersecting) {
                        visible[n] = true;
                    } else {
                        delete visible[n];
                    }
                });
                scheduleRender();
            }, { root: main, rootMargin: "800px 0px" });
            st.pages.forEach(function (p) { io.observe(p.div); });
            thumbIO = new IntersectionObserver(function (entries) {
                entries.forEach(function (en) {
                    if (en.isIntersecting) {
                        thumbIO.unobserve(en.target);
                        renderThumb(parseInt(en.target.getAttribute("data-page"), 10), en.target.querySelector(".pg"));
                    }
                });
            }, { root: thumbs, rootMargin: "300px" });
            thumbs.querySelectorAll(".pdf-thumb").forEach(function (t) { thumbIO.observe(t); });
            main.addEventListener("scroll", onScroll, { passive: true });
        }

        function scheduleRender() {
            clearTimeout(st.renderTimer);
            st.renderTimer = setTimeout(renderVisible, 120);
        }

        function getPage(p) {
            return st.pdf.getPage(p.n).then(function (page) {
                if (!p.viewport) {
                    p.viewport = page.getViewport({ scale: 1 });
                    p.rotate = page.rotate;
                    var s = pageSize(p);
                    p.div.style.width = s.w + "px";
                    p.div.style.height = s.h + "px";
                }
                return page;
            });
        }

        function renderVisible() {
            if (st.destroyed || !st.pdf) {
                return;
            }
            var list = Object.keys(visible).map(Number).sort(function (a, b) {
                return Math.abs(a - st.current) - Math.abs(b - st.current);
            });
            list.forEach(function (n) {
                var p = st.pages[n - 1];
                if (p && Math.abs(p.scale - st.zoom) > 0.001 || (p && p.rot !== st.rot)) {
                    renderPage(p);
                }
            });
            //Free the canvases of pages far away
            if (st.rendered.length > MAX_RENDERED) {
                st.rendered.sort(function (a, b) { return Math.abs(b.n - st.current) - Math.abs(a.n - st.current); });
                while (st.rendered.length > MAX_RENDERED) {
                    var far = st.rendered.shift();
                    if (visible[far.n]) {
                        st.rendered.push(far);
                        break;
                    }
                    far.div.querySelectorAll("canvas, .textLayer, .lnk").forEach(function (n) { n.remove(); });
                    far.scale = 0;
                    far.textDivs = null;
                }
            }
        }

        function renderPage(p) {
            if (p.task) {
                try { p.task.cancel(); } catch (e) { }
                p.task = null;
            }
            var zoom = st.zoom, rot = st.rot;
            getPage(p).then(function (page) {
                if (st.destroyed || zoom != st.zoom) {
                    return;
                }
                var dpr = Math.min(window.devicePixelRatio || 1, 2);
                var viewport = page.getViewport({ scale: zoom * CSS_UNITS, rotation: (page.rotate + rot) % 360 });
                var canvas = document.createElement("canvas");
                canvas.width = Math.floor(viewport.width * dpr);
                canvas.height = Math.floor(viewport.height * dpr);
                canvas.style.width = "100%";
                canvas.style.height = "100%";
                var task = page.render({
                    canvasContext: canvas.getContext("2d"),
                    viewport: viewport,
                    transform: dpr != 1 ? [dpr, 0, 0, dpr, 0, 0] : null
                });
                p.task = task;
                return task.promise.then(function () {
                    p.task = null;
                    if (st.destroyed || zoom != st.zoom) {
                        return;
                    }
                    p.div.querySelectorAll("canvas, .ph, .textLayer, .lnk").forEach(function (n) { n.remove(); });
                    p.div.insertBefore(canvas, p.div.firstChild);
                    p.scale = zoom;
                    p.rot = rot;
                    if (st.rendered.indexOf(p) < 0) {
                        st.rendered.push(p);
                    }
                    return renderText(p, page, viewport).then(function () { return renderLinks(p, page, viewport); });
                });
            }).catch(function (e) {
                if (!e || e.name != "RenderingCancelledException") {
                    console.warn("[PDF Viewer]", e);
                }
            });
        }

        function textOf(n) {
            if (st.find.text[n]) {
                return Promise.resolve(st.find.text[n]);
            }
            return st.pdf.getPage(n).then(function (page) {
                return page.getTextContent();
            }).then(function (tc) {
                st.find.text[n] = tc;
                return tc;
            });
        }

        function renderText(p, page, viewport) {
            return textOf(p.n).then(function (tc) {
                if (st.destroyed) {
                    return;
                }
                var layer = document.createElement("div");
                layer.className = "textLayer";
                p.div.appendChild(layer);
                p.textDivs = [];
                var t = window.pdfjsLib.renderTextLayer({ textContent: tc, container: layer, viewport: viewport, textDivs: p.textDivs, enhanceTextSelection: false });
                return t.promise.then(function () { highlightPage(p); });
            }).catch(function () { });
        }

        function renderLinks(p, page, viewport) {
            return page.getAnnotations().then(function (annots) {
                annots.forEach(function (a) {
                    if (a.subtype != "Link" || (!a.url && !a.dest)) {
                        return;
                    }
                    var r = viewport.convertToViewportRectangle(a.rect);
                    var x = Math.min(r[0], r[2]), y = Math.min(r[1], r[3]);
                    var link = document.createElement("a");
                    link.className = "lnk";
                    link.style.cssText = "position:absolute;left:" + x + "px;top:" + y + "px;width:" + Math.abs(r[2] - r[0]) + "px;height:" + Math.abs(r[3] - r[1]) + "px;z-index:2";
                    if (a.url && /^(https?|mailto):/i.test(a.url)) {
                        link.href = a.url;
                        link.target = "_blank";
                        link.rel = "noopener noreferrer";
                        link.title = a.url;
                    } else if (a.dest) {
                        link.href = "#";
                        link.addEventListener("click", function (e) {
                            e.preventDefault();
                            goToDest(a.dest);
                        });
                    } else {
                        return;
                    }
                    p.div.appendChild(link);
                });
            }).catch(function () { });
        }

        function renderThumb(n, holder) {
            if (!st.pdf) {
                return;
            }
            st.pdf.getPage(n).then(function (page) {
                var vp = page.getViewport({ scale: 1, rotation: (page.rotate + st.rot) % 360 });
                var scale = 240 / vp.width;
                var viewport = page.getViewport({ scale: scale, rotation: (page.rotate + st.rot) % 360 });
                var c = document.createElement("canvas");
                c.width = Math.floor(viewport.width);
                c.height = Math.floor(viewport.height);
                return page.render({ canvasContext: c.getContext("2d"), viewport: viewport }).promise.then(function () {
                    if (st.destroyed) {
                        return;
                    }
                    holder.innerHTML = "";
                    holder.style.aspectRatio = "";
                    holder.appendChild(c);
                });
            }).catch(function () { });
        }

        /* Navigation ------------------------------------------------------------ */
        function onScroll() {
            var mid = main.scrollTop + main.clientHeight * 0.35;
            var cur = st.current;
            for (var i = 0; i < st.pages.length; i++) {
                var d = st.pages[i].div;
                if (d.offsetTop <= mid && d.offsetTop + d.offsetHeight + 18 > mid) {
                    cur = i + 1;
                    break;
                }
            }
            if (cur != st.current) {
                st.current = cur;
                updateNav();
            }
        }

        function updateNav() {
            if (document.activeElement !== navInput) {
                navInput.value = st.current;
            }
            thumbs.querySelectorAll(".pdf-thumb.active").forEach(function (t) { t.classList.remove("active"); });
            var t = thumbs.querySelector('.pdf-thumb[data-page="' + st.current + '"]');
            if (t) {
                t.classList.add("active");
                var tr = t.getBoundingClientRect(), rr = thumbs.getBoundingClientRect();
                if (tr.top < rr.top || tr.bottom > rr.bottom) {
                    thumbs.scrollTop += tr.top - rr.top - rr.height / 2 + tr.height / 2;
                }
            }
            nav.querySelector('[data-n="prev"]').disabled = st.current <= 1;
            nav.querySelector('[data-n="next"]').disabled = st.current >= st.count;
        }

        function goToPage(n, offsetY) {
            n = Math.max(1, Math.min(st.count, n));
            var d = st.pages[n - 1].div;
            main.scrollTop = d.offsetTop - 16 + (offsetY || 0);
            st.current = n;
            updateNav();
        }

        function goToDest(dest) {
            var resolve = typeof dest === "string" ? st.pdf.getDestination(dest) : Promise.resolve(dest);
            resolve.then(function (d) {
                if (!d) {
                    return;
                }
                var ref = d[0];
                var idx = typeof ref === "object" ? st.pdf.getPageIndex(ref) : Promise.resolve(ref);
                return idx.then(function (i) { goToPage(i + 1); });
            }).catch(function () { });
        }

        nav.querySelector('[data-n="prev"]').addEventListener("click", function () { goToPage(st.current - 1); });
        nav.querySelector('[data-n="next"]').addEventListener("click", function () { goToPage(st.current + 1); });
        navInput.addEventListener("keydown", function (e) {
            if (e.key == "Enter") {
                var n = parseInt(navInput.value, 10);
                if (n) {
                    goToPage(n);
                }
                main.focus();
            } else if (e.key == "Escape") {
                navInput.value = st.current;
                main.focus();
            }
            e.stopPropagation();
        });
        navInput.addEventListener("focus", function () { navInput.select(); });
        navInput.addEventListener("blur", function () { navInput.value = st.current; });

        /* Rail and outline ------------------------------------------------------ */
        function toggleRail(force) {
            mem.rail = force === undefined ? !mem.rail : force;
            rail.classList.toggle("collapsed", !mem.rail);
            ctx.tools.querySelector('[data-t="rail"]').classList.toggle("on", mem.rail);
            setTimeout(function () {
                if (st.mode == "width" || st.mode == "page" || st.mode == "auto") {
                    setZoomMode(st.mode);
                }
            }, 220);
        }

        ctx.body.querySelectorAll("[data-tab]").forEach(function (b) {
            b.addEventListener("click", function () {
                var tab = b.getAttribute("data-tab");
                ctx.body.querySelectorAll("[data-tab]").forEach(function (x) { x.classList.toggle("active", x === b); });
                thumbs.hidden = tab != "pages";
                outlineEl.hidden = tab != "outline";
                if (tab == "outline" && st.outline == null && st.pdf) {
                    st.outline = [];
                    outlineEl.innerHTML = '<div class="vw-spin" style="width:20px;height:20px;border-width:2px;margin:20px auto"></div>';
                    st.pdf.getOutline().then(function (o) {
                        st.outline = o || [];
                        outlineEl.innerHTML = "";
                        if (!st.outline.length) {
                            outlineEl.innerHTML = '<p style="color:var(--vw-text-3);font-size:12.5px;padding:8px">' + esc(T("vw/noOutline", "This document has no outline.")) + '</p>';
                            return;
                        }
                        (function add(items, depth) {
                            items.forEach(function (o2) {
                                var b2 = ReaderUI.el('<button style="padding-left:' + (8 + depth * 12) + 'px" title="' + esc(o2.title) + '">' + esc(o2.title) + '</button>');
                                b2.addEventListener("click", function () {
                                    if (o2.dest) {
                                        goToDest(o2.dest);
                                    } else if (o2.url) {
                                        window.open(o2.url, "_blank", "noopener");
                                    }
                                });
                                outlineEl.appendChild(b2);
                                if (o2.items && o2.items.length) {
                                    add(o2.items, depth + 1);
                                }
                            });
                        })(st.outline, 0);
                    }).catch(function () { outlineEl.innerHTML = ""; });
                }
            });
        });

        /* Find ------------------------------------------------------------------ */
        var findBar = null, findTimer = null;

        function openFind() {
            if (findBar) {
                findBar.querySelector("input").select();
                return;
            }
            findBar = ReaderUI.el('<div class="vw-find"><input type="search" placeholder="' + esc(T("vw/findPlaceholder", "Find in document")) + '">' +
                '<span class="count"></span><button class="vw-ic" data-f="prev" title="' + esc(T("pv/prev", "Previous")) + '">' + I("chevronUp") + '</button>' +
                '<button class="vw-ic" data-f="next" title="' + esc(T("pv/next", "Next")) + '">' + I("chevronDown") + '</button>' +
                '<button class="vw-ic" data-f="close" title="' + esc(T("common/close", "Close")) + '">' + I("x") + '</button></div>');
            ctx.body.appendChild(findBar);
            var input = findBar.querySelector("input");
            input.focus();
            input.addEventListener("input", function () {
                clearTimeout(findTimer);
                findTimer = setTimeout(function () { runFind(input.value); }, 250);
            });
            input.addEventListener("keydown", function (e) {
                e.stopPropagation();
                if (e.key == "Enter") {
                    stepFind(e.shiftKey ? -1 : 1);
                } else if (e.key == "Escape") {
                    closeFind();
                }
            });
            findBar.querySelector('[data-f="prev"]').addEventListener("click", function () { stepFind(-1); });
            findBar.querySelector('[data-f="next"]').addEventListener("click", function () { stepFind(1); });
            findBar.querySelector('[data-f="close"]').addEventListener("click", closeFind);
        }

        function closeFind() {
            if (findBar) {
                findBar.remove();
                findBar = null;
            }
            st.find.q = "";
            st.find.hits = [];
            st.pages.forEach(highlightPage);
            main.focus();
        }

        function runFind(q) {
            q = String(q || "").trim().toLowerCase();
            st.find.q = q;
            st.find.hits = [];
            st.find.at = -1;
            var count = findBar && findBar.querySelector(".count");
            if (!q || !st.pdf) {
                if (count) {
                    count.textContent = "";
                }
                st.pages.forEach(highlightPage);
                return;
            }
            if (count) {
                count.textContent = "...";
            }
            var jobs = [];
            for (var n = 1; n <= st.count; n++) {
                jobs.push(textOf(n));
            }
            Promise.all(jobs).then(function (all) {
                if (st.find.q != q) {
                    return;
                }
                all.forEach(function (tc, idx) {
                    var text = "", spans = [];
                    tc.items.forEach(function (it, i) {
                        spans.push({ start: text.length, end: text.length + it.str.length, i: i });
                        text += it.str;
                    });
                    var lower = text.toLowerCase();
                    var at = lower.indexOf(q);
                    while (at >= 0) {
                        var items = spans.filter(function (s) { return s.end > at && s.start < at + q.length; }).map(function (s) { return s.i; });
                        st.find.hits.push({ page: idx + 1, items: items });
                        at = lower.indexOf(q, at + q.length);
                    }
                });
                st.pages.forEach(highlightPage);
                if (st.find.hits.length) {
                    //Start from the first hit at or after the current page
                    var first = 0;
                    for (var h = 0; h < st.find.hits.length; h++) {
                        if (st.find.hits[h].page >= st.current) {
                            first = h;
                            break;
                        }
                    }
                    st.find.at = first - 1;
                    stepFind(1);
                } else if (count) {
                    count.textContent = T("vw/noMatches", "No matches");
                }
            });
        }

        function stepFind(dir) {
            var hits = st.find.hits;
            if (!hits.length) {
                return;
            }
            st.find.at = (st.find.at + dir + hits.length) % hits.length;
            var hit = hits[st.find.at];
            if (findBar) {
                findBar.querySelector(".count").textContent = (st.find.at + 1) + " / " + hits.length;
            }
            var p = st.pages[hit.page - 1];
            st.pages.forEach(highlightPage);
            if (p.textDivs && p.textDivs[hit.items[0]]) {
                var span = p.textDivs[hit.items[0]];
                main.scrollTop = p.div.offsetTop + span.offsetTop - main.clientHeight / 3;
            } else {
                goToPage(hit.page);
            }
        }

        function highlightPage(p) {
            if (!p.textDivs) {
                return;
            }
            p.textDivs.forEach(function (d) { d.classList.remove("hit", "current"); });
            if (!st.find.q) {
                return;
            }
            st.find.hits.forEach(function (h, idx) {
                if (h.page != p.n) {
                    return;
                }
                h.items.forEach(function (i) {
                    var d = p.textDivs[i];
                    if (d) {
                        d.classList.add("hit");
                        if (idx == st.find.at) {
                            d.classList.add("current");
                        }
                    }
                });
            });
        }

        /* Printing ------------------------------------------------------------- */
        function print() {
            if (!st.pdf) {
                return;
            }
            var total = Math.min(st.count, 300);
            var dismiss = ReaderUI.toast(T("vw/preparingPrint", "Preparing {n} pages for printing...", { n: total }), { timeout: 60000 });
            var out = [];
            var chain = Promise.resolve();
            for (var i = 1; i <= total; i++) {
                (function (n) {
                    chain = chain.then(function () {
                        return st.pdf.getPage(n).then(function (page) {
                            var viewport = page.getViewport({ scale: 2, rotation: page.rotate });
                            var c = document.createElement("canvas");
                            c.width = Math.floor(viewport.width);
                            c.height = Math.floor(viewport.height);
                            return page.render({ canvasContext: c.getContext("2d"), viewport: viewport }).promise.then(function () {
                                var wrap = document.createElement("div");
                                wrap.className = "page";
                                var img = new Image();
                                img.src = c.toDataURL("image/jpeg", 0.92);
                                wrap.appendChild(img);
                                out.push(wrap);
                            });
                        });
                    });
                })(i);
            }
            chain.then(function () {
                dismiss();
                if (!st.destroyed) {
                    U.printContent(out);
                }
            }).catch(function (e) {
                dismiss();
                ReaderUI.error(e);
            });
        }

        /* Tools and gestures --------------------------------------------------- */
        ctx.tools.querySelectorAll("[data-t]").forEach(function (b) {
            b.addEventListener("click", function () {
                var t = b.getAttribute("data-t");
                if (t == "in") {
                    stepZoom(1);
                } else if (t == "out") {
                    stepZoom(-1);
                } else if (t == "rail") {
                    toggleRail();
                } else if (t == "rotate") {
                    st.rot = (st.rot + 90) % 360;
                    thumbs.querySelectorAll(".pdf-thumb .pg").forEach(function (pg, idx) {
                        renderThumb(idx + 1, pg);
                    });
                    setZoomMode(st.mode);
                } else if (t == "find") {
                    openFind();
                } else if (t == "zoom") {
                    var pick = function (mode) {
                        return function () {
                            mem.zoomMode = mode;
                            setZoomMode(mode);
                        };
                    };
                    ReaderUI.menu({ anchor: b }, [
                        { checkable: true, checked: st.mode == "auto", label: T("vw/autoZoom", "Automatic"), action: pick("auto") },
                        { checkable: true, checked: st.mode == "width", label: T("vw/fitWidth", "Fit width"), action: pick("width") },
                        { checkable: true, checked: st.mode == "page", label: T("vw/fitPage", "Fit page"), action: pick("page") },
                        "-"
                    ].concat([0.5, 0.75, 1, 1.25, 1.5, 2, 3].map(function (z) {
                        return { checkable: true, checked: st.mode == String(z), label: Math.round(z * 100) + "%", action: pick(String(z)) };
                    })));
                }
            });
        });

        main.addEventListener("wheel", function (e) {
            if (!e.ctrlKey && !e.metaKey) {
                return;
            }
            e.preventDefault();
            var r = main.getBoundingClientRect();
            st.mode = "custom";
            setZoom(st.zoom * Math.pow(1.0022, -e.deltaY), false, { x: e.clientX - r.left, y: e.clientY - r.top });
            mem.zoomMode = String(st.zoom);
        }, { passive: false });

        var touches = {}, pinch = null;
        main.addEventListener("pointerdown", function (e) {
            if (e.pointerType != "touch") {
                return;
            }
            touches[e.pointerId] = e;
            var ids = Object.keys(touches);
            if (ids.length == 2) {
                var a = touches[ids[0]], b = touches[ids[1]];
                pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), zoom: st.zoom };
            }
        });
        main.addEventListener("pointermove", function (e) {
            if (!(e.pointerId in touches)) {
                return;
            }
            touches[e.pointerId] = e;
            var ids = Object.keys(touches);
            if (pinch && ids.length == 2) {
                var a = touches[ids[0]], b = touches[ids[1]];
                var r = main.getBoundingClientRect();
                st.mode = "custom";
                setZoom(pinch.zoom * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.d, false,
                    { x: (a.clientX + b.clientX) / 2 - r.left, y: (a.clientY + b.clientY) / 2 - r.top });
            }
        });
        var endTouch = function (e) {
            delete touches[e.pointerId];
            if (Object.keys(touches).length < 2) {
                pinch = null;
            }
        };
        main.addEventListener("pointerup", endTouch);
        main.addEventListener("pointercancel", endTouch);

        return {
            shortcuts: [
                [T("vw/keyPage", "Previous / next page"), "Left / Right"], [T("vw/firstLast", "First / last page"), "Home / End"],
                [T("pv/zoomIn", "Zoom in"), "+ / Ctrl + Wheel"], [T("pv/zoomOut", "Zoom out"), "-"], [T("vw/fitWidth", "Fit width"), "0"],
                [T("vw/find", "Find in document"), "Ctrl + F"], [T("pv/rotate", "Rotate"), "R"], [T("vw/print", "Print"), "Ctrl + P"]
            ],
            key: function (e) {
                if ((e.ctrlKey || e.metaKey) && (e.key == "f" || e.key == "F")) {
                    e.preventDefault();
                    openFind();
                    return true;
                }
                if ((e.ctrlKey || e.metaKey) && (e.key == "=" || e.key == "+")) {
                    e.preventDefault();
                    stepZoom(1);
                    return true;
                }
                if ((e.ctrlKey || e.metaKey) && e.key == "-") {
                    e.preventDefault();
                    stepZoom(-1);
                    return true;
                }
                if (e.ctrlKey || e.metaKey || e.altKey) {
                    return false;
                }
                var typing = e.target && (e.target.tagName == "INPUT");
                if (typing) {
                    return false;
                }
                if (e.key == "Escape" && findBar) {
                    closeFind();
                    return true;
                }
                var k = e.key;
                if (k == "ArrowRight" || k == "PageDown" || k == "n") {
                    goToPage(st.current + 1);
                } else if (k == "ArrowLeft" || k == "PageUp" || k == "p") {
                    goToPage(st.current - 1);
                } else if (k == "Home") {
                    goToPage(1);
                } else if (k == "End") {
                    goToPage(st.count);
                } else if (k == "+" || k == "=") {
                    stepZoom(1);
                } else if (k == "-") {
                    stepZoom(-1);
                } else if (k == "0") {
                    mem.zoomMode = "width";
                    setZoomMode("width");
                } else if (k == "r" || k == "R") {
                    ctx.tools.querySelector('[data-t="rotate"]').click();
                } else if (k == "/") {
                    e.preventDefault();
                    openFind();
                } else {
                    return false;
                }
                e.preventDefault();
                return true;
            },
            print: print,
            onResize: function () {
                if (st.mode == "width" || st.mode == "page" || st.mode == "auto") {
                    setZoomMode(st.mode);
                }
            },
            destroy: function () {
                st.destroyed = true;
                clearTimeout(st.renderTimer);
                if (io) {
                    io.disconnect();
                }
                if (thumbIO) {
                    thumbIO.disconnect();
                }
                st.pages.forEach(function (p) {
                    if (p.task) {
                        try { p.task.cancel(); } catch (e) { }
                    }
                });
                if (st.pdf) {
                    st.pdf.destroy();
                } else if (st.task) {
                    st.task.destroy();
                }
            }
        };
    }

    Reader.register(["pdf"], { mount: mount });
})();
