/*
    ArozOS Office - home page
    =========================

    Vanilla JS, no framework, no build step (the rest of the suite's house
    style). Everything it needs is already on the page:

      - mode.js      which build this is, so formats the build cannot convert
                     are not offered
      - recents.js   OfficeRecents: the documents this browser is keeping

    How opening a file from here works. A File the visitor picks cannot be
    handed across a page navigation, so "Open from device" writes the bytes
    into OfficeRecents (IndexedDB) and sends the app to ?recent=<id>, which
    OfficePlatform resolves back to those bytes. That is the same path the
    "Recently opened" list uses, so there is one mechanism rather than two.

    Paths: BASE comes from <body data-office-base>, which the web-viewer
    generator rewrites when it moves this page to the site root. Never
    hardcode ../ here - a relative URL in this file resolves against the
    *document*, and the document sits at two different depths.
*/
(function () {
    "use strict";

    var BASE = document.body.getAttribute("data-office-base") || "../";

    /* ================= the three apps ================= */
    var APPS = {
        document: {
            dir: "docs", label: "Document", plural: "Documents", ext: ".doca",
            icon: "#i-doc", accent: "#3b82f6", soft: "#eaf2ff", line: "#c7ddfb",
            desc: "Word processor for creating letters, reports, and more."
        },
        spreadsheet: {
            dir: "sheets", label: "Spreadsheet", plural: "Spreadsheets", ext: ".xlsa",
            icon: "#i-sheet", accent: "#16a34a", soft: "#e7f7ee", line: "#bfe8cf",
            desc: "Analyze data with powerful formulas and charts."
        },
        presentation: {
            dir: "slides", label: "Presentation", plural: "Presentations", ext: ".ppta",
            icon: "#i-slides", accent: "#f97316", soft: "#fef1e6", line: "#fbd9b6",
            desc: "Design slides and present your ideas with style."
        }
    };
    var APP_ORDER = ["document", "spreadsheet", "presentation"];

    // Which extension belongs to which app. The foreign formats are only
    // offered when this build can actually convert them.
    var NATIVE_EXT = { ".doca": "document", ".xlsa": "spreadsheet", ".ppta": "presentation" };
    var TEXT_EXT = {
        ".txt": "document", ".md": "document", ".html": "document", ".htm": "document",
        ".csv": "spreadsheet", ".tsv": "spreadsheet"
    };
    var CONVERT_EXT = {
        ".docx": "document", ".odt": "document",
        ".xlsx": "spreadsheet", ".ods": "spreadsheet",
        ".pptx": "presentation", ".odp": "presentation"
    };

    /* mode.js sets these; in the ArozOS tree both are false/undefined and the
       server does the conversions, so everything is on the table there. */
    function isStandalone() {
        return (typeof window.OFFICE_STANDALONE !== "undefined") && !!window.OFFICE_STANDALONE;
    }
    function canConvert() {
        if (!isStandalone()) return true;
        return (typeof window.OFFICE_WASM !== "undefined") && !!window.OFFICE_WASM;
    }
    function openableExts() {
        var map = {};
        var add = function (src) { Object.keys(src).forEach(function (k) { map[k] = src[k]; }); };
        add(NATIVE_EXT);
        add(TEXT_EXT);
        if (canConvert()) add(CONVERT_EXT);
        return map;
    }
    function appForExt(ext) { return openableExts()[String(ext).toLowerCase()] || null; }

    /* ================= small utils ================= */
    function $(sel, root) { return (root || document).querySelector(sel); }
    function el(tag, cls, html) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html !== undefined) e.innerHTML = html;
        return e;
    }
    function esc(t) {
        return String(t === undefined || t === null ? "" : t)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    function svgIcon(sym, cls) {
        return '<svg class="' + (cls || "ic") + '"><use href="' + sym + '"></use></svg>';
    }
    function extOf(name) {
        var i = String(name).lastIndexOf(".");
        return i < 0 ? "" : String(name).substring(i).toLowerCase();
    }
    function stripExt(name) {
        var i = String(name).lastIndexOf(".");
        return i < 0 ? String(name) : String(name).substring(0, i);
    }
    function appUrl(appId, query) {
        return BASE + APPS[appId].dir + "/index.html" + (query || "");
    }
    function go(url) { window.location.href = url; }

    function ago(ts) {
        if (!ts) return "";
        var diff = new Date().getTime() - ts;
        if (diff < 0) diff = 0;
        var mins = Math.floor(diff / 60000);
        if (mins < 1) return "Just now";
        if (mins < 60) return mins + "m ago";
        var hrs = Math.floor(mins / 60);
        if (hrs < 24) return hrs + "h ago";
        var days = Math.floor(hrs / 24);
        if (days === 1) return "Yesterday";
        if (days < 7) return days + " days ago";
        return new Date(ts).toLocaleDateString();
    }

    /* The suite keeps one theme for every app under office_theme; follow it
       so the home page does not flip to light when the editors are dark. */
    function applyTheme() {
        var t = null;
        try { t = localStorage.getItem("office_theme"); } catch (e) { }
        if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
        else if (t === "light") document.documentElement.setAttribute("data-theme", "light");
    }

    /* ================= state ================= */
    var state = {
        filter: "",        // "" | document | spreadsheet | presentation
        query: "",
        recentsAll: false,
        tplPage: 0,
        tplAll: false,
        templates: []
    };
    var TPL_PER_PAGE = 6;
    var RECENT_SHOWN = 5;

    /* ================= create new ================= */
    function renderNewGrid() {
        var grid = $("#hmNewGrid");
        grid.innerHTML = "";
        APP_ORDER.forEach(function (id) {
            var a = APPS[id];
            var card = el("button", "hm-newcard");
            card.type = "button";
            card.style.setProperty("--accent", a.accent);
            card.style.setProperty("--accent-soft", a.soft);
            card.style.setProperty("--accent-line", a.line);
            card.innerHTML =
                '<span class="hm-newcard-ic">' + svgIcon(a.icon) + "</span>" +
                '<span class="hm-newcard-body"><b>' + esc(a.label) + "</b>" +
                "<span>" + esc(a.desc) + "</span></span>" +
                '<span class="hm-newcard-go">' + svgIcon("#i-arrow-right") + "</span>";
            card.addEventListener("click", function () { go(appUrl(id)); });
            grid.appendChild(card);
        });
    }

    function buildCreateMenu() {
        var menu = $("#hmCreateMenu");
        menu.innerHTML = "";
        APP_ORDER.forEach(function (id) {
            var a = APPS[id];
            var b = el("button", "", svgIcon(a.icon) +
                "<span><b>" + esc(a.label) + "</b>" +
                '<span class="hm-mi-sub">Blank ' + esc(a.ext) + " file</span></span>");
            b.type = "button";
            b.addEventListener("click", function () { go(appUrl(id)); });
            menu.appendChild(b);
        });
        menu.appendChild(el("div", "hm-menu-sep"));
        var open = el("button", "", svgIcon("#i-folder") + "<span>Open from device</span>");
        open.type = "button";
        open.addEventListener("click", function () { closeMenus(); pickFile(); });
        menu.appendChild(open);
    }
    function closeMenus() {
        $("#hmCreateMenu").hidden = true;
        var m = $(".hm-rowmenu");
        if (m) m.parentNode.removeChild(m);
    }

    /* ================= recently opened ================= */
    function recentEntries() {
        if (!window.OfficeRecents || !OfficeRecents.supported()) return [];
        var list = OfficeRecents.index();
        if (state.filter) {
            list = list.filter(function (e) { return e.app === state.filter; });
        }
        if (state.query) {
            var q = state.query.toLowerCase();
            list = list.filter(function (e) { return e.name.toLowerCase().indexOf(q) >= 0; });
        }
        return list;
    }

    function renderRecents() {
        var host = $("#hmRecentList");
        host.innerHTML = "";
        var all = recentEntries();
        var shown = state.recentsAll ? all : all.slice(0, RECENT_SHOWN);

        $("#hmRecentAll").hidden = all.length <= RECENT_SHOWN;
        $("#hmRecentAll").textContent = state.recentsAll ? "Show less" : "View all";

        if (!all.length) {
            host.appendChild(emptyRecents());
            return;
        }
        shown.forEach(function (entry) { host.appendChild(recentRow(entry)); });
    }

    function emptyRecents() {
        var why;
        if (!window.OfficeRecents || !OfficeRecents.supported()) {
            why = "This browser will not let the page store documents, so recent " +
                "files are unavailable. Opening and editing still work.";
        } else if (state.query) {
            why = "No recent document matches &ldquo;" + esc(state.query) + "&rdquo;.";
        } else if (state.filter) {
            why = "Nothing here yet. Documents you open or save will show up.";
        } else {
            why = "Open a file or start from a template &mdash; documents you " +
                "work on are kept in this browser so you can pick them up again.";
        }
        return el("div", "hm-empty",
            '<div class="hm-empty-ic">' + svgIcon("#i-open") + "</div>" +
            "<b>No recent documents</b><p>" + why + "</p>");
    }

    function recentRow(entry) {
        var app = APPS[entry.app] || APPS.document;
        var row = el("div", "hm-row");
        row.style.setProperty("--accent", app.accent);
        row.style.setProperty("--accent-soft", app.soft);
        row.innerHTML =
            '<span class="hm-row-ic">' + svgIcon(app.icon) + "</span>" +
            '<span class="hm-row-body">' +
            '<div class="hm-row-name">' + esc(entry.name) + "</div>" +
            '<div class="hm-row-sub">' + esc(app.label) + "</div></span>" +
            '<span class="hm-row-time">' + esc(ago(entry.at)) + "</span>";
        var more = el("button", "hm-row-more", svgIcon("#i-more"));
        more.type = "button";
        more.title = "More actions";
        more.addEventListener("click", function (ev) {
            ev.stopPropagation();
            openRowMenu(entry, more);
        });
        row.appendChild(more);
        row.addEventListener("click", function () { openRecent(entry); });
        return row;
    }

    function openRecent(entry) {
        var app = APPS[entry.app] ? entry.app : appForExt(entry.ext) || "document";
        go(appUrl(app, "?recent=" + encodeURIComponent(entry.id)));
    }

    function openRowMenu(entry, anchor) {
        closeMenus();
        var menu = el("div", "hm-menu hm-rowmenu");
        var add = function (icon, label, fn) {
            var b = el("button", "", svgIcon(icon) + "<span>" + esc(label) + "</span>");
            b.type = "button";
            b.addEventListener("click", function (ev) {
                ev.stopPropagation();
                closeMenus();
                fn();
            });
            menu.appendChild(b);
        };
        add("#i-open", "Open", function () { openRecent(entry); });
        add("#i-download", "Download a copy", function () { downloadRecent(entry); });
        menu.appendChild(el("div", "hm-menu-sep"));
        add("#i-trash", "Remove from list", function () {
            OfficeRecents.forget(entry.id, renderRecents);
        });

        // positioned against the page, not the row, so a scrolling card
        // cannot clip it
        var r = anchor.getBoundingClientRect();
        menu.style.position = "fixed";
        menu.style.top = (r.bottom + 6) + "px";
        menu.style.right = (window.innerWidth - r.right) + "px";
        menu.style.left = "auto";
        document.body.appendChild(menu);
    }

    function downloadRecent(entry) {
        OfficeRecents.load(entry.id, function (bytes) {
            var blob = new Blob([bytes], { type: "application/octet-stream" });
            var url = URL.createObjectURL(blob);
            var a = document.createElement("a");
            a.href = url;
            a.download = entry.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(url); }, 8000);
        }, function (msg) { window.alert("Could not read that document: " + msg); });
    }

    /* ================= templates ================= */
    function loadTemplates() {
        var url = BASE + "templates/manifest.json";
        var xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);
        xhr.onload = function () {
            if (xhr.status < 200 || xhr.status >= 300) { renderTemplates(); return; }
            try {
                var m = JSON.parse(xhr.responseText);
                state.templates = (m && m.templates) || [];
            } catch (e) { state.templates = []; }
            renderTemplates();
        };
        xhr.onerror = function () { renderTemplates(); };
        xhr.send();
    }

    function templateEntries() {
        var list = state.templates.slice();
        if (state.filter) {
            list = list.filter(function (t) { return t.app === state.filter; });
        }
        if (state.query) {
            var q = state.query.toLowerCase();
            list = list.filter(function (t) {
                return (t.label || "").toLowerCase().indexOf(q) >= 0 ||
                    (t.blurb || "").toLowerCase().indexOf(q) >= 0;
            });
        }
        return list;
    }

    function renderTemplates() {
        var grid = $("#hmTplGrid");
        var pager = $("#hmTplPager");
        grid.innerHTML = "";
        pager.innerHTML = "";

        var all = templateEntries();
        if (!all.length) {
            grid.appendChild(el("div", "hm-empty",
                "<b>No templates</b><p>" +
                (state.templates.length ? "Nothing matches the current filter."
                    : "The templates folder was not found next to this page.") +
                "</p>"));
            $("#hmTplAll").hidden = true;
            return;
        }

        var pages = Math.ceil(all.length / TPL_PER_PAGE);
        if (state.tplPage >= pages) state.tplPage = 0;
        var shown = state.tplAll ? all
            : all.slice(state.tplPage * TPL_PER_PAGE, (state.tplPage + 1) * TPL_PER_PAGE);

        shown.forEach(function (t) { grid.appendChild(templateCard(t)); });

        $("#hmTplAll").hidden = all.length <= TPL_PER_PAGE;
        $("#hmTplAll").textContent = state.tplAll ? "Show less" : "View all";
        if (!state.tplAll && pages > 1) renderPager(pager, pages);
    }

    function templateCard(t) {
        var app = APPS[t.app] || APPS.document;
        var card = el("button", "hm-tpl");
        card.type = "button";
        card.style.setProperty("--accent-line", app.line);
        card.title = t.blurb || t.label;
        card.innerHTML =
            '<span class="hm-tpl-thumb">' + drawPreview(t.preview, app) + "</span>" +
            '<span class="hm-tpl-label">' + esc(t.label) + "</span>";
        card.addEventListener("click", function () {
            go(appUrl(t.app, "?template=" + encodeURIComponent("../templates/" + t.file)));
        });
        return card;
    }

    function renderPager(pager, pages) {
        var prev = el("button", "hm-pgbtn", svgIcon("#i-chev-left"));
        prev.type = "button";
        prev.disabled = state.tplPage === 0;
        prev.title = "Previous";
        prev.addEventListener("click", function () {
            if (state.tplPage > 0) { state.tplPage--; renderTemplates(); }
        });
        pager.appendChild(prev);

        var dots = el("div", "hm-pgdots");
        for (var i = 0; i < pages; i++) {
            (function (n) {
                var d = el("button", "hm-pgdot" + (n === state.tplPage ? " is-active" : ""));
                d.type = "button";
                d.title = "Page " + (n + 1);
                d.addEventListener("click", function () { state.tplPage = n; renderTemplates(); });
                dots.appendChild(d);
            })(i);
        }
        pager.appendChild(dots);

        var next = el("button", "hm-pgbtn", svgIcon("#i-chev-right"));
        next.type = "button";
        next.disabled = state.tplPage >= pages - 1;
        next.title = "Next";
        next.addEventListener("click", function () {
            if (state.tplPage < pages - 1) { state.tplPage++; renderTemplates(); }
        });
        pager.appendChild(next);
    }

    /* ---------- template thumbnails ----------
       Drawn rather than shipped as images: twelve PNGs would be twelve more
       requests and would go stale the moment a template changes. Each is a
       stylised impression of the layout, not a render of the content. */
    function drawPreview(kind, app) {
        var W = 160, H = 134;
        var a = (app && app.accent) || "#3b82f6";
        var open = '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMid slice">' +
            '<rect width="' + W + '" height="' + H + '" fill="#ffffff"/>';
        var close = "</svg>";
        var g = "#e3e7ee", g2 = "#eef1f6";

        function lines(x, y, w, n, gap, color) {
            var s = "";
            for (var i = 0; i < n; i++) {
                var ww = (i === n - 1) ? w * 0.62 : w;
                s += '<rect x="' + x + '" y="' + (y + i * gap) + '" width="' + ww +
                    '" height="3" rx="1.5" fill="' + (color || g) + '"/>';
            }
            return s;
        }
        function grid(x, y, cols, rows, cw, ch, headFill) {
            var s = "", r, c;
            for (r = 0; r < rows; r++) {
                for (c = 0; c < cols; c++) {
                    var fill = (r === 0 && headFill) ? headFill : "#ffffff";
                    s += '<rect x="' + (x + c * cw) + '" y="' + (y + r * ch) + '" width="' + cw +
                        '" height="' + ch + '" fill="' + fill + '" stroke="' + g2 +
                        '" stroke-width="1"/>';
                }
            }
            return s;
        }

        switch (kind) {
            case "doc-blank":
                return open + lines(28, 34, 104, 7, 11, g2) + close;

            case "doc-report":
                return open +
                    '<rect x="26" y="22" width="58" height="7" rx="3" fill="' + a + '"/>' +
                    '<rect x="26" y="35" width="108" height="2.5" rx="1.2" fill="' + a + '" opacity=".35"/>' +
                    lines(26, 46, 108, 3, 8) +
                    '<rect x="26" y="76" width="108" height="34" rx="3" fill="#f4f7fc"/>' +
                    '<path d="M32 104l16-14 12 10 14-18 18 22z" fill="' + a + '" opacity=".5"/>' +
                    '<path d="M32 104h96" stroke="' + g + '" stroke-width="1.5"/>' +
                    close;

            case "doc-resume":
                return open +
                    '<rect x="18" y="14" width="42" height="106" fill="#f4f7fc"/>' +
                    '<circle cx="39" cy="34" r="11" fill="' + a + '" opacity=".45"/>' +
                    lines(26, 54, 26, 5, 9, "#dbe3ee") +
                    '<rect x="70" y="20" width="52" height="6" rx="3" fill="' + a + '"/>' +
                    lines(70, 36, 64, 3, 8) +
                    '<rect x="70" y="66" width="34" height="4" rx="2" fill="' + a + '" opacity=".5"/>' +
                    lines(70, 78, 64, 4, 8) +
                    close;

            case "doc-letter":
                return open +
                    lines(24, 20, 40, 3, 7, g2) +
                    lines(96, 44, 40, 3, 7, g2) +
                    '<rect x="24" y="70" width="30" height="3.5" rx="1.7" fill="' + a + '" opacity=".6"/>' +
                    lines(24, 82, 110, 4, 8) +
                    '<path d="M24 118c8-8 14 4 22-2s10-8 18-3" stroke="' + a +
                    '" stroke-width="2" fill="none" opacity=".7"/>' +
                    close;

            case "doc-notes":
                return open +
                    '<rect x="24" y="18" width="50" height="6" rx="3" fill="' + a + '"/>' +
                    grid(24, 32, 2, 3, 55, 11, "#f4f7fc") +
                    '<rect x="24" y="76" width="34" height="4" rx="2" fill="' + a + '" opacity=".5"/>' +
                    grid(24, 88, 3, 3, 37, 11, "#f4f7fc") +
                    close;

            case "sheet-blank":
                return open + grid(16, 20, 5, 8, 26, 13, "#f2f5f9") + close;

            case "sheet-budget":
                return open +
                    grid(14, 18, 4, 7, 33, 14, "#e7f7ee") +
                    '<rect x="14" y="18" width="132" height="14" fill="' + a + '" opacity=".8"/>' +
                    '<rect x="14" y="88" width="132" height="14" fill="' + a + '" opacity=".16"/>' +
                    '<circle cx="118" cy="112" r="15" fill="none" stroke="' + a +
                    '" stroke-width="7" opacity=".35"/>' +
                    '<path d="M118 97a15 15 0 0 1 13 22" fill="none" stroke="' + a +
                    '" stroke-width="7"/>' +
                    close;

            case "sheet-invoice":
                return open +
                    '<rect x="20" y="16" width="46" height="9" rx="2" fill="#f97316"/>' +
                    lines(20, 34, 40, 2, 7, g2) +
                    lines(100, 34, 40, 2, 7, g2) +
                    grid(20, 56, 3, 4, 40, 12, "#fef1e6") +
                    '<rect x="90" y="110" width="50" height="9" rx="2" fill="#f97316" opacity=".28"/>' +
                    close;

            case "sheet-tasks":
                return open +
                    grid(14, 18, 4, 7, 33, 14, "#e7f7ee") +
                    '<rect x="14" y="18" width="132" height="14" fill="' + a + '" opacity=".8"/>' +
                    '<rect x="84" y="36" width="26" height="8" rx="4" fill="#16a34a" opacity=".4"/>' +
                    '<rect x="84" y="50" width="26" height="8" rx="4" fill="#f59e0b" opacity=".45"/>' +
                    '<rect x="84" y="64" width="26" height="8" rx="4" fill="#ef4444" opacity=".35"/>' +
                    '<rect x="84" y="78" width="26" height="8" rx="4" fill="#9aa0a6" opacity=".35"/>' +
                    close;

            case "slides-blank":
                return open +
                    '<rect x="18" y="26" width="124" height="82" rx="4" fill="#ffffff" stroke="' +
                    g + '" stroke-width="1.5"/>' + close;

            case "slides-pitch":
                return open +
                    '<rect x="18" y="24" width="124" height="86" rx="4" fill="#fffaf5" stroke="' +
                    g + '" stroke-width="1.5"/>' +
                    '<rect x="32" y="48" width="64" height="8" rx="4" fill="#f97316"/>' +
                    '<rect x="32" y="64" width="86" height="4" rx="2" fill="#f97316" opacity=".3"/>' +
                    '<rect x="32" y="76" width="70" height="4" rx="2" fill="' + g + '"/>' +
                    close;

            case "slides-lesson":
                return open +
                    '<rect x="18" y="24" width="124" height="86" rx="4" fill="#ffffff" stroke="' +
                    g + '" stroke-width="1.5"/>' +
                    '<rect x="30" y="36" width="52" height="7" rx="3.5" fill="#f97316"/>' +
                    '<circle cx="34" cy="58" r="3" fill="#f97316" opacity=".55"/>' +
                    '<circle cx="34" cy="72" r="3" fill="#f97316" opacity=".55"/>' +
                    '<circle cx="34" cy="86" r="3" fill="#f97316" opacity=".55"/>' +
                    lines(44, 56, 78, 1, 0) + lines(44, 70, 68, 1, 0) + lines(44, 84, 74, 1, 0) +
                    close;
        }
        // an unknown preview name still gets a plausible page rather than a hole
        return open + lines(28, 34, 104, 6, 12, g2) + close;
    }

    /* ================= opening a file from the device ================= */
    function pickFile() {
        var input = $("#hmFile");
        input.value = "";
        input.accept = Object.keys(openableExts()).join(",");
        input.click();
    }

    function acceptFile(file) {
        if (!file) return;
        var ext = extOf(file.name);
        var app = appForExt(ext);
        if (!app) {
            window.alert("ArozOS Office cannot open " + (ext || "that kind of file") +
                (CONVERT_EXT[ext] ? " - this build was made without the Office format converters." : "."));
            return;
        }
        if (!window.OfficeRecents || !OfficeRecents.supported()) {
            window.alert("This browser will not let the page store the file, so it " +
                "cannot be handed to the editor from here. Open it with File > Open " +
                "inside " + APPS[app].label + " instead.");
            return;
        }
        var reader = new FileReader();
        reader.onload = function () {
            var bytes = new Uint8Array(reader.result);
            OfficeRecents.remember({ name: file.name, app: app, ext: ext, bytes: bytes },
                function (id) { go(appUrl(app, "?recent=" + encodeURIComponent(id))); },
                function (msg) { window.alert("Could not open that file: " + msg); });
        };
        reader.onerror = function () { window.alert("Could not read that file."); };
        reader.readAsArrayBuffer(file);
    }

    /* ================= filters ================= */
    function setFilter(f) {
        state.filter = f;
        state.tplPage = 0;
        var items = document.querySelectorAll(".hm-navitem[data-filter]");
        for (var i = 0; i < items.length; i++) {
            items[i].classList.toggle("is-active", items[i].getAttribute("data-filter") === f);
        }
        renderRecents();
        renderTemplates();
    }

    /* ================= wiring ================= */
    function init() {
        applyTheme();
        renderNewGrid();
        buildCreateMenu();
        renderRecents();
        loadTemplates();

        // formats line in the tip, so it never claims more than the build does
        var natives = Object.keys(NATIVE_EXT).join(", ");
        var tip = $(".hm-tip-formats");
        tip.textContent = canConvert()
            ? "Supported formats: " + natives + ", .docx, .xlsx, .pptx, ODF"
            : "Supported formats: " + natives;

        $("#hmCreate").addEventListener("click", function (ev) {
            ev.stopPropagation();
            var m = $("#hmCreateMenu");
            var wasOpen = !m.hidden;
            closeMenus();
            m.hidden = wasOpen;
        });
        document.addEventListener("click", closeMenus);
        window.addEventListener("resize", closeMenus);

        $("#hmRecentAll").addEventListener("click", function () {
            state.recentsAll = !state.recentsAll;
            renderRecents();
        });
        $("#hmTplAll").addEventListener("click", function () {
            state.tplAll = !state.tplAll;
            renderTemplates();
        });

        var nav = $("#hmNav");
        nav.addEventListener("click", function (ev) {
            var btn = ev.target.closest ? ev.target.closest(".hm-navitem") : null;
            if (!btn) return;
            if (btn.hasAttribute("data-filter")) { setFilter(btn.getAttribute("data-filter")); return; }
            if (btn.getAttribute("data-action") === "open-device") { pickFile(); return; }
            var goto = btn.getAttribute("data-goto");
            if (goto) {
                var target = document.getElementById(goto);
                if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        });

        var buttons = document.querySelectorAll('[data-action="open-device"]');
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].addEventListener("click", function (ev) {
                ev.stopPropagation();
                pickFile();
            });
        }

        $("#hmFile").addEventListener("change", function () {
            acceptFile(this.files && this.files[0]);
        });

        var search = $("#hmSearch");
        search.addEventListener("input", function () {
            state.query = this.value.trim();
            state.tplPage = 0;
            renderRecents();
            renderTemplates();
        });

        // Ctrl+O opens a file, and / jumps to the search box - both are what
        // the tip at the bottom of the page promises
        window.addEventListener("keydown", function (ev) {
            if ((ev.ctrlKey || ev.metaKey) && String(ev.key).toLowerCase() === "o") {
                ev.preventDefault();
                pickFile();
                return;
            }
            if (ev.key === "/" && document.activeElement !== search) {
                ev.preventDefault();
                search.focus();
            }
            if (ev.key === "Escape") closeMenus();
        });

        installDropTarget();
    }

    function installDropTarget() {
        var overlay = $("#hmDrop");
        var depth = 0;
        var carriesFile = function (e) {
            var dt = e.dataTransfer;
            if (!dt) return false;
            var types = dt.types || [];
            for (var i = 0; i < types.length; i++) if (types[i] === "Files") return true;
            return false;
        };
        window.addEventListener("dragenter", function (e) {
            if (!carriesFile(e)) return;
            e.preventDefault();
            depth++;
            overlay.hidden = false;
        });
        window.addEventListener("dragover", function (e) {
            if (!carriesFile(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
        });
        window.addEventListener("dragleave", function (e) {
            if (!carriesFile(e)) return;
            depth--;
            if (depth <= 0) { depth = 0; overlay.hidden = true; }
        });
        window.addEventListener("drop", function (e) {
            if (!carriesFile(e)) return;
            e.preventDefault();
            depth = 0;
            overlay.hidden = true;
            acceptFile(e.dataTransfer.files && e.dataTransfer.files[0]);
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
