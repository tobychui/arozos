/*
    viewer.doc.js

    Markdown and plain text reader.

    Markdown is converted by marked (vendored in vendor/marked, MIT) and the
    result is cleaned by an allow-list sanitiser before it touches the page:
    the document comes from a user's file and must never run script in
    Drive's origin. Relative images and links resolve against the file's
    own folder. Headings feed an outline with scroll tracking.

    Text files get line numbers, word wrap, a choice of character encoding
    (useful for Big5 / GBK / Shift_JIS files), find, a table view for CSV
    and TSV, and pretty printing for JSON. Office files are not handled here.
*/

(function () {
    "use strict";

    var I = DriveUI.I;
    var esc = DriveUI.esc;
    var API = DriveAPI;
    var U = DriveViewer.util;

    var ENCODINGS = [
        ["utf-8", "UTF-8"], ["big5", "Big5 (繁體)"], ["gbk", "GBK (简体)"], ["shift_jis", "Shift_JIS (日本語)"],
        ["euc-kr", "EUC-KR (한국어)"], ["utf-16le", "UTF-16 LE"], ["utf-16be", "UTF-16 BE"], ["windows-1252", "Western (Windows-1252)"]
    ];
    var MAX_TABLE_ROWS = 5000;

    /* Sanitiser --------------------------------------------------------------- */
    var ALLOWED = {
        H1: [], H2: [], H3: [], H4: [], H5: [], H6: [], P: [], BR: [], HR: [], STRONG: [], B: [], EM: [], I: [], DEL: [], S: [],
        U: [], SUP: [], SUB: [], CODE: ["class"], PRE: [], BLOCKQUOTE: [], UL: [], OL: ["start"], LI: [], TABLE: [], THEAD: [],
        TBODY: [], TFOOT: [], TR: [], TH: ["align", "colspan", "rowspan"], TD: ["align", "colspan", "rowspan"], A: ["href", "title"],
        IMG: ["src", "alt", "title", "width", "height"], KBD: [], DETAILS: ["open"], SUMMARY: [], DIV: [], SPAN: [], MARK: [],
        FIGURE: [], FIGCAPTION: [], INPUT: ["type", "checked", "disabled"], DL: [], DT: [], DD: [], ABBR: ["title"], SMALL: [], CENTER: []
    };

    function safeURL(url, forImage) {
        url = String(url || "").trim();
        if (/^(https?:|mailto:|#)/i.test(url)) {
            return url;
        }
        if (forImage && /^data:image\/(png|gif|jpe?g|webp|svg\+xml);/i.test(url)) {
            return url;
        }
        if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
            return "";
        }
        return url;
    }

    function sanitize(html) {
        var doc = new DOMParser().parseFromString("<body>" + html + "</body>", "text/html");
        (function clean(node) {
            Array.prototype.slice.call(node.childNodes).forEach(function (child) {
                if (child.nodeType == 3) {
                    return;
                }
                if (child.nodeType != 1) {
                    child.remove();
                    return;
                }
                var tag = child.tagName;
                if (!ALLOWED[tag]) {
                    if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "NOSCRIPT", "SVG", "MATH", "FORM", "LINK", "META", "BASE"].indexOf(tag) >= 0) {
                        child.remove();
                        return;
                    }
                    //Unknown element: keep its content, drop the element
                    clean(child);
                    while (child.firstChild) {
                        child.parentNode.insertBefore(child.firstChild, child);
                    }
                    child.remove();
                    return;
                }
                Array.prototype.slice.call(child.attributes).forEach(function (a) {
                    var name = a.name.toLowerCase();
                    if (ALLOWED[tag].indexOf(name) < 0) {
                        child.removeAttribute(a.name);
                    }
                });
                if (tag == "A") {
                    var href = safeURL(child.getAttribute("href"), false);
                    if (href) {
                        child.setAttribute("href", href);
                    } else {
                        child.removeAttribute("href");
                    }
                }
                if (tag == "IMG") {
                    var src = safeURL(child.getAttribute("src"), true);
                    if (src) {
                        child.setAttribute("src", src);
                    } else {
                        child.remove();
                        return;
                    }
                    child.setAttribute("loading", "lazy");
                }
                if (tag == "INPUT") {
                    if (child.getAttribute("type") != "checkbox") {
                        child.remove();
                        return;
                    }
                    //Read only through CSS, so the box keeps its normal colours
                    child.removeAttribute("disabled");
                    child.setAttribute("tabindex", "-1");
                }
                clean(child);
            });
        })(doc.body);
        return doc.body.innerHTML;
    }

    function slug(text, used) {
        var s = String(text).toLowerCase().trim().replace(/[^\wÀ-￿\s-]/g, "").replace(/\s+/g, "-") || "section";
        var base = s, n = 1;
        while (used[s]) {
            s = base + "-" + (n++);
        }
        used[s] = true;
        return s;
    }

    function resolvePath(dir, rel) {
        var parts = (dir.replace(/\/+$/, "") + "/" + rel).split("/");
        var out = [];
        parts.forEach(function (p, i) {
            if (p == "..") {
                if (out.length > 1) {
                    out.pop();
                }
            } else if (p != "." && (p != "" || i == 0)) {
                out.push(p);
            }
        });
        return out.join("/").replace(/^([^:\/]+):(?!\/)/, "$1:/");
    }

    /* CSV ---------------------------------------------------------------------- */
    function parseDelimited(text, sep) {
        var rows = [], row = [], field = "", q = false;
        for (var i = 0; i < text.length; i++) {
            var c = text[i];
            if (q) {
                if (c == '"') {
                    if (text[i + 1] == '"') {
                        field += '"';
                        i++;
                    } else {
                        q = false;
                    }
                } else {
                    field += c;
                }
            } else if (c == '"') {
                q = true;
            } else if (c == sep) {
                row.push(field);
                field = "";
            } else if (c == "\n" || c == "\r") {
                if (c == "\r" && text[i + 1] == "\n") {
                    i++;
                }
                row.push(field);
                rows.push(row);
                row = [];
                field = "";
                if (rows.length > MAX_TABLE_ROWS) {
                    break;
                }
            } else {
                field += c;
            }
        }
        if (field || row.length) {
            row.push(field);
            rows.push(row);
        }
        return rows;
    }

    /* ---------------------------------------------------------------------- */
    function mount(ctx) {
        var item = ctx.item;
        var mem = ctx.memory;
        var ext = DriveIcons.getExt(item.name);
        var isMD = ctx.kind == "markdown";
        var isTable = ext == "csv" || ext == "tsv";
        mem.zoom = mem.zoom || 1;
        if (mem.wrap === undefined) {
            mem.wrap = true;
        }
        var st = {
            bytes: null, text: "", encoding: "utf-8", view: isMD ? "rendered" : (isTable ? "table" : "text"),
            json: false, destroyed: false, hits: [], at: -1, q: ""
        };

        ctx.body.innerHTML = (isMD ? '<nav class="dv-toc vw-scroll' + (mem.toc === false ? "" : "") + '"' + (mem.toc === false ? " hidden" : "") + '></nav>' : "") +
            '<div class="dv-main vw-scroll" tabindex="0"><div class="vw-state"><div class="vw-spin"></div></div></div>';
        var toc = ctx.body.querySelector(".dv-toc");
        var main = ctx.body.querySelector(".dv-main");
        main.style.setProperty("--dv-zoom", mem.zoom);

        var tools = "";
        if (isMD || isTable) {
            var a = isMD ? ["rendered", T("vw/rendered", "Reading")] : ["table", T("vw/table", "Table")];
            tools += '<div class="segmented vw-hide-sm" style="background:rgba(255,255,255,.06)" data-t="view">' +
                '<button data-v="' + a[0] + '" class="' + (st.view == a[0] ? "active" : "") + '">' + esc(a[1]) + '</button>' +
                '<button data-v="text" class="' + (st.view == "text" ? "active" : "") + '">' + esc(isMD ? T("vw/source", "Source") : T("vw/text", "Text")) + '</button></div>';
        }
        if (ext == "json") {
            tools += '<button class="vw-ic vw-hide-sm" data-t="json" title="' + esc(T("vw/formatJson", "Format JSON")) + '">' + I("code") + '</button>';
        }
        tools += '<div class="vw-pill"><button class="vw-ic" data-t="out" title="' + esc(T("vw/smaller", "Smaller text")) + '">' + I("minimize") + '</button>' +
            '<span class="vw-pill-label" style="display:inline-grid;place-items:center" data-t="zoomlabel">' + Math.round(mem.zoom * 100) + '%</span>' +
            '<button class="vw-ic" data-t="in" title="' + esc(T("vw/larger", "Larger text")) + '">' + I("plus") + '</button></div>';
        if (isMD) {
            tools += '<button class="vw-ic' + (mem.toc === false ? "" : " on") + '" data-t="toc" title="' + esc(T("vw/outline", "Outline")) + '">' + I("list") + '</button>';
        }
        tools += '<button class="vw-ic' + (mem.wrap ? " on" : "") + '" data-t="wrap" title="' + esc(T("vw/wrap", "Word wrap")) + '"' + (st.view == "text" ? "" : " hidden") + '>' + wrapIcon() + '</button>' +
            '<button class="vw-ic vw-hide-sm" data-t="enc" title="' + esc(T("vw/encoding", "Text encoding")) + '">' + I("translate") + '</button>' +
            '<button class="vw-ic" data-t="find" title="' + esc(T("vw/findText", "Find")) + ' (Ctrl+F)">' + I("search") + '</button>' +
            '<button class="vw-ic vw-hide-sm" data-t="copy" title="' + esc(T("vw/copyAll", "Copy all text")) + '">' + I("copy") + '</button><span class="vw-sep vw-hide-sm"></span>';
        ctx.tools.innerHTML = tools;

        function wrapIcon() {
            return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                '<path d="M4 6h16M4 12h13a3 3 0 0 1 0 6h-4"/><path d="M15 16l-2 2 2 2"/><path d="M4 18h5"/></svg>';
        }

        /* Loading -------------------------------------------------------------- */
        fetch(ctx.url, { credentials: "same-origin" }).then(function (r) {
            if (!r.ok) {
                throw new Error("HTTP " + r.status);
            }
            return r.arrayBuffer();
        }).then(function (buf) {
            if (st.destroyed) {
                return;
            }
            st.bytes = new Uint8Array(buf);
            st.encoding = guessEncoding(st.bytes);
            decode();
            var p = isMD ? U.loadScript("Drive/vendor/marked/marked.min.js?v=12.0.0") : Promise.resolve();
            return p.then(render);
        }).catch(function (err) {
            if (st.destroyed) {
                return;
            }
            main.innerHTML = U.stateHTML(item, T("vw/textFailed", "This file cannot be shown"), err.message,
                [{ id: "dl", icon: "download", label: T("toolbar/download", "Download"), primary: true }]);
            U.bindState(main, { dl: function () { DriveActions.download([item]); } });
        });

        function guessEncoding(b) {
            if (b[0] == 0xFF && b[1] == 0xFE) {
                return "utf-16le";
            }
            if (b[0] == 0xFE && b[1] == 0xFF) {
                return "utf-16be";
            }
            try {
                new TextDecoder("utf-8", { fatal: true }).decode(b.subarray(0, Math.min(b.length, 256 * 1024)));
                return "utf-8";
            } catch (e) {
                //Not valid UTF-8: guess from the interface language
                var lang = DriveI18n.locale();
                if (lang.indexOf("zh-cn") == 0) {
                    return "gbk";
                }
                if (lang.indexOf("zh") == 0) {
                    return "big5";
                }
                if (lang.indexOf("ja") == 0) {
                    return "shift_jis";
                }
                if (lang.indexOf("ko") == 0) {
                    return "euc-kr";
                }
                return "windows-1252";
            }
        }

        function decode() {
            try {
                st.text = new TextDecoder(st.encoding).decode(st.bytes).replace(/^﻿/, "");
            } catch (e) {
                st.text = new TextDecoder("utf-8").decode(st.bytes);
            }
        }

        /* Rendering -------------------------------------------------------------- */
        function render() {
            if (st.destroyed) {
                return;
            }
            st.hits = [];
            st.at = -1;
            var wrapBtn = ctx.tools.querySelector('[data-t="wrap"]');
            if (wrapBtn) {
                wrapBtn.hidden = st.view != "text";
            }
            if (st.view == "rendered") {
                renderMarkdown();
            } else if (st.view == "table") {
                renderTable();
            } else {
                renderText();
            }
            ctx.setPrintable(true);
        }

        function renderMarkdown() {
            var html = "";
            try {
                html = window.marked.parse(st.text, { gfm: true, breaks: false });
            } catch (e) {
                html = "<pre>" + esc(st.text) + "</pre>";
            }
            main.innerHTML = '<article class="dv-paper md">' + sanitize(html) + '</article>';
            var article = main.querySelector("article");
            var dir = API.parentOf(item.path);
            var used = {};
            var heads = [];
            article.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach(function (h) {
                h.id = slug(h.textContent, used);
                heads.push(h);
            });
            article.querySelectorAll("img").forEach(function (img) {
                var src = img.getAttribute("src");
                if (src && !/^(https?:|data:)/i.test(src)) {
                    img.src = API.mediaURL(resolvePath(dir, decodeURI(src.split("#")[0].split("?")[0])));
                }
            });
            article.querySelectorAll("a[href]").forEach(function (a) {
                var href = a.getAttribute("href");
                if (href.charAt(0) == "#") {
                    a.addEventListener("click", function (e) {
                        e.preventDefault();
                        var target = article.querySelector('[id="' + CSS.escape(decodeURIComponent(href.substring(1))) + '"]');
                        if (target) {
                            target.scrollIntoView({ behavior: "smooth", block: "start" });
                        }
                    });
                } else if (/^(https?:|mailto:)/i.test(href)) {
                    a.target = "_blank";
                    a.rel = "noopener noreferrer";
                } else {
                    //A file next to this one: open it in Drive
                    a.addEventListener("click", function (e) {
                        e.preventDefault();
                        var path = resolvePath(dir, decodeURI(href.split("#")[0].split("?")[0]));
                        var other = { name: API.baseName(path), path: path, isDir: false, size: -1, mtime: 0 };
                        if (DriveViewer.canOpen(other)) {
                            DriveViewer.open(other);
                        } else {
                            window.open(API.mediaURL(path), "_blank");
                        }
                    });
                }
            });
            if (toc) {
                if (!heads.length) {
                    toc.innerHTML = '<h4>' + esc(T("vw/outline", "Outline")) + '</h4><p style="color:var(--vw-text-3);font-size:12.5px;padding:0 8px">' + esc(T("vw/noHeadings", "No headings in this document.")) + '</p>';
                } else {
                    toc.innerHTML = '<h4>' + esc(T("vw/outline", "Outline")) + '</h4>' + heads.map(function (h) {
                        return '<a href="#" class="l' + h.tagName.substring(1) + '" data-id="' + esc(h.id) + '">' + esc(h.textContent) + '</a>';
                    }).join("");
                    toc.querySelectorAll("a").forEach(function (link) {
                        link.addEventListener("click", function (e) {
                            e.preventDefault();
                            var h = article.querySelector('[id="' + CSS.escape(link.getAttribute("data-id")) + '"]');
                            if (h) {
                                h.scrollIntoView({ behavior: "smooth", block: "start" });
                            }
                            if (window.innerWidth <= 900) {
                                toc.classList.remove("open");
                            }
                        });
                    });
                }
                var spy = function () {
                    var top = main.getBoundingClientRect().top + 80;
                    var active = null;
                    heads.forEach(function (h) {
                        if (h.getBoundingClientRect().top <= top) {
                            active = h.id;
                        }
                    });
                    toc.querySelectorAll("a").forEach(function (l) {
                        l.classList.toggle("active", l.getAttribute("data-id") == active);
                    });
                };
                main.onscroll = spy;
                spy();
            }
        }

        function renderText() {
            var text = st.text;
            if (st.json) {
                try {
                    text = JSON.stringify(JSON.parse(text), null, 2);
                } catch (e) {
                    DriveUI.toast(T("vw/jsonInvalid", "This file is not valid JSON"), { type: "error" });
                    st.json = false;
                }
            }
            var lines = text.replace(/\r\n?/g, "\n").split("\n");
            st.lines = lines;
            var digits = String(lines.length).length;
            var html = new Array(lines.length);
            for (var i = 0; i < lines.length; i++) {
                html[i] = '<div class="tv-line"><span>' + esc(lines[i]) + '</span></div>';
            }
            main.innerHTML = '<div class="tv' + (mem.wrap ? " wrap" : "") + '" style="--gutter:' + Math.max(3, digits) + 'ch">' + html.join("") + '</div>';
            main.onscroll = null;
        }

        function renderTable() {
            var rows = parseDelimited(st.text, ext == "tsv" ? "\t" : (st.text.split("\n")[0].split(";").length > st.text.split("\n")[0].split(",").length ? ";" : ","));
            if (!rows.length) {
                main.innerHTML = "";
                return;
            }
            var head = rows[0];
            var body = rows.slice(1, MAX_TABLE_ROWS + 1);
            var isNum = function (v) { return /^-?[\d,]*\.?\d+(e[+-]?\d+)?%?$/i.test(String(v).trim()); };
            var html = '<table class="tv-table"><thead><tr><th>#</th>' + head.map(function (h) { return '<th title="' + esc(h) + '">' + esc(h) + '</th>'; }).join("") + '</tr></thead><tbody>' +
                body.map(function (r, n) {
                    return '<tr><td class="num" style="color:#56617a">' + (n + 1) + '</td>' + head.map(function (_, c) {
                        var v = r[c] == null ? "" : r[c];
                        return '<td' + (isNum(v) ? ' class="num"' : "") + ' title="' + esc(v) + '">' + esc(v) + '</td>';
                    }).join("") + '</tr>';
                }).join("") + '</tbody></table>';
            if (rows.length > MAX_TABLE_ROWS) {
                html += '<p style="color:var(--vw-text-3);font-size:12.5px;margin:0 18px 30px">' + esc(T("vw/tableCut", "Showing the first {n} rows. Switch to Text to see everything.", { n: MAX_TABLE_ROWS })) + '</p>';
            }
            main.innerHTML = html;
            main.onscroll = null;
        }

        /* Find ------------------------------------------------------------------- */
        var findBar = null, findTimer = null;

        function openFind() {
            if (findBar) {
                findBar.querySelector("input").select();
                return;
            }
            findBar = DriveUI.el('<div class="vw-find"><input type="search" placeholder="' + esc(T("vw/findText", "Find")) + '">' +
                '<span class="count"></span><button class="vw-ic" data-f="prev" title="' + esc(T("pv/prev", "Previous")) + '">' + I("chevronUp") + '</button>' +
                '<button class="vw-ic" data-f="next" title="' + esc(T("pv/next", "Next")) + '">' + I("chevronDown") + '</button>' +
                '<button class="vw-ic" data-f="close" title="' + esc(T("common/close", "Close")) + '">' + I("x") + '</button></div>');
            ctx.body.appendChild(findBar);
            var input = findBar.querySelector("input");
            input.focus();
            input.addEventListener("input", function () {
                clearTimeout(findTimer);
                findTimer = setTimeout(function () { runFind(input.value); }, 200);
            });
            input.addEventListener("keydown", function (e) {
                e.stopPropagation();
                if (e.key == "Enter") {
                    step(e.shiftKey ? -1 : 1);
                } else if (e.key == "Escape") {
                    closeFind();
                }
            });
            findBar.querySelector('[data-f="prev"]').addEventListener("click", function () { step(-1); });
            findBar.querySelector('[data-f="next"]').addEventListener("click", function () { step(1); });
            findBar.querySelector('[data-f="close"]').addEventListener("click", closeFind);
        }

        function closeFind() {
            if (findBar) {
                findBar.remove();
                findBar = null;
            }
            clearMarks();
            st.q = "";
            main.focus();
        }

        function clearMarks() {
            main.querySelectorAll("mark[data-hit]").forEach(function (m) {
                m.replaceWith(document.createTextNode(m.textContent));
            });
            main.querySelectorAll(".tv-line.hit-line").forEach(function (l) { l.classList.remove("hit-line"); });
            var root = main.firstElementChild;
            if (root) {
                root.normalize();
            }
        }

        //Wrap every match in a <mark>, walking text nodes so markup stays intact
        function runFind(q) {
            clearMarks();
            st.q = q = String(q || "");
            st.hits = [];
            st.at = -1;
            var count = findBar && findBar.querySelector(".count");
            if (!q) {
                if (count) {
                    count.textContent = "";
                }
                return;
            }
            var lower = q.toLowerCase();
            var walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, null);
            var nodes = [];
            while (walker.nextNode()) {
                nodes.push(walker.currentNode);
            }
            nodes.forEach(function (node) {
                var text = node.nodeValue;
                var idx = text.toLowerCase().indexOf(lower);
                if (idx < 0) {
                    return;
                }
                var frag = document.createDocumentFragment();
                var last = 0;
                while (idx >= 0 && st.hits.length < 5000) {
                    frag.appendChild(document.createTextNode(text.substring(last, idx)));
                    var m = document.createElement("mark");
                    m.setAttribute("data-hit", "");
                    m.textContent = text.substr(idx, q.length);
                    frag.appendChild(m);
                    st.hits.push(m);
                    last = idx + q.length;
                    idx = text.toLowerCase().indexOf(lower, last);
                }
                frag.appendChild(document.createTextNode(text.substring(last)));
                node.parentNode.replaceChild(frag, node);
            });
            if (count) {
                count.textContent = st.hits.length ? "" : T("vw/noMatches", "No matches");
            }
            if (st.hits.length) {
                step(1);
            }
        }

        function step(dir) {
            if (!st.hits.length) {
                return;
            }
            if (st.hits[st.at]) {
                st.hits[st.at].classList.remove("current");
            }
            st.at = (st.at + dir + st.hits.length) % st.hits.length;
            var m = st.hits[st.at];
            m.classList.add("current");
            m.scrollIntoView({ block: "center", inline: "nearest" });
            if (findBar) {
                findBar.querySelector(".count").textContent = (st.at + 1) + " / " + st.hits.length;
            }
        }

        /* Tools ------------------------------------------------------------------ */
        function setZoom(z) {
            mem.zoom = Math.max(0.6, Math.min(2.4, Math.round(z * 10) / 10));
            main.style.setProperty("--dv-zoom", mem.zoom);
            ctx.tools.querySelector('[data-t="zoomlabel"]').textContent = Math.round(mem.zoom * 100) + "%";
        }

        ctx.tools.querySelectorAll("[data-v]").forEach(function (b) {
            b.addEventListener("click", function () {
                st.view = b.getAttribute("data-v");
                ctx.tools.querySelectorAll("[data-v]").forEach(function (x) { x.classList.toggle("active", x === b); });
                if (findBar) {
                    closeFind();
                }
                render();
            });
        });
        ctx.tools.querySelectorAll("[data-t]").forEach(function (b) {
            if (b.getAttribute("data-t") == "view" || b.getAttribute("data-t") == "zoomlabel") {
                return;
            }
            b.addEventListener("click", function () {
                var t = b.getAttribute("data-t");
                if (t == "in") {
                    setZoom(mem.zoom + 0.1);
                } else if (t == "out") {
                    setZoom(mem.zoom - 0.1);
                } else if (t == "wrap") {
                    mem.wrap = !mem.wrap;
                    b.classList.toggle("on", mem.wrap);
                    var tv = main.querySelector(".tv");
                    if (tv) {
                        tv.classList.toggle("wrap", mem.wrap);
                    }
                } else if (t == "toc") {
                    if (window.innerWidth <= 900) {
                        toc.hidden = false;
                        toc.classList.toggle("open");
                        return;
                    }
                    mem.toc = mem.toc === false;
                    toc.hidden = !mem.toc;
                    b.classList.toggle("on", mem.toc);
                } else if (t == "json") {
                    st.json = !st.json;
                    b.classList.toggle("on", st.json);
                    st.view = "text";
                    render();
                } else if (t == "find") {
                    openFind();
                } else if (t == "copy") {
                    DriveActions.copyText(st.text).then(function () {
                        DriveUI.toast(T("vw/copied", "Text copied"), { type: "success" });
                    }).catch(DriveUI.error);
                } else if (t == "enc") {
                    DriveUI.menu({ anchor: b, align: "end" }, [{ title: T("vw/encoding", "Text encoding") }].concat(ENCODINGS.map(function (e) {
                        return {
                            checkable: true, checked: st.encoding == e[0], label: e[1], action: function () {
                                st.encoding = e[0];
                                decode();
                                render();
                            }
                        };
                    })));
                }
            });
        });

        return {
            shortcuts: [
                [T("vw/findText", "Find"), "Ctrl + F"], [T("vw/larger", "Larger text"), "Ctrl + ="], [T("vw/smaller", "Smaller text"), "Ctrl + -"],
                [T("vw/wrap", "Word wrap"), "Alt + Z"], [T("vw/keyPrevNextFile", "Previous / next file"), "Alt + Left / Alt + Right"]
            ],
            key: function (e) {
                var k = e.key;
                if ((e.ctrlKey || e.metaKey) && (k == "f" || k == "F")) {
                    e.preventDefault();
                    openFind();
                    return true;
                }
                if ((e.ctrlKey || e.metaKey) && (k == "=" || k == "+")) {
                    e.preventDefault();
                    setZoom(mem.zoom + 0.1);
                    return true;
                }
                if ((e.ctrlKey || e.metaKey) && k == "-") {
                    e.preventDefault();
                    setZoom(mem.zoom - 0.1);
                    return true;
                }
                if (e.altKey && (k == "z" || k == "Z")) {
                    var w = ctx.tools.querySelector('[data-t="wrap"]');
                    if (w && !w.hidden) {
                        w.click();
                    }
                    return true;
                }
                if (e.altKey && k == "ArrowRight") {
                    ctx.go(1);
                    return true;
                }
                if (e.altKey && k == "ArrowLeft") {
                    ctx.go(-1);
                    return true;
                }
                if (k == "Escape" && findBar) {
                    closeFind();
                    return true;
                }
                return false;
            },
            print: function () {
                if (st.view == "rendered") {
                    var article = main.querySelector("article");
                    U.printContent('<div class="md" style="font-size:11pt;color:#000">' + (article ? article.innerHTML : "") + '</div>');
                } else {
                    var pre = document.createElement("pre");
                    pre.textContent = st.text;
                    U.printContent([pre]);
                }
            },
            destroy: function () {
                st.destroyed = true;
                main.onscroll = null;
            }
        };
    }

    DriveViewer.register(["markdown", "text"], { mount: mount });
})();
