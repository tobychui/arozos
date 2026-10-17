/*
    viewer.js

    The shell of Drive's built-in viewers. It owns the full window overlay
    (top bar, actions, history entry, keyboard routing, printing) and hands
    the stage to one viewer module per kind:

        image      js/viewer.image.js
        video      js/viewer.video.js
        audio      js/viewer.audio.js
        pdf        js/viewer.pdf.js
        markdown   js/viewer.doc.js
        text       js/viewer.doc.js

    Everything a viewer needs ships inside the Drive folder (vendor/ holds
    pdf.js and marked), so nothing depends on another web app the user may
    not have permission for. Files are read through /media, which only checks
    the user's file permissions.

    A module is {mount(ctx) -> instance}; an instance may define destroy(),
    key(event) -> handled, print() and onResize().

    DrivePreview stays as an alias for the code that opened the old preview.
*/

(function (global) {
    "use strict";

    var I = DriveUI.I;
    var esc = DriveUI.esc;
    var API = DriveAPI;

    var EXT = {};
    function map(kind, list) {
        list.split(" ").forEach(function (e) { EXT[e] = kind; });
    }
    map("image", "jpg jpeg jfif pjpeg png apng gif bmp webp svg ico avif heic heif tif tiff cr2 cr3 nef arw dng raw raf orf rw2");
    map("video", "mp4 m4v webm ogv mov mkv avi wmv flv ts mts m2ts 3gp mpg mpeg");
    map("audio", "mp3 m4a aac wav ogg oga opus flac weba wma aiff aif alac");
    map("pdf", "pdf");
    map("markdown", "md markdown mdown mkd");
    map("text", "txt text log ini cfg conf nfo csv tsv json jsonc xml yaml yml toml srt vtt ass sub env properties " +
        "sh bash zsh bat cmd ps1 py rb pl lua r go rs java kt kts scala c h cc cpp hpp cs swift m mm php js mjs cjs ts tsx jsx " +
        "vue svelte css scss less sass html htm xhtml sql agi gradle dockerfile makefile gitignore editorconfig diff patch");

    var TEXT_LIMIT = 5 * 1024 * 1024;
    var FAMILY = { image: "image", video: "video", audio: "audio", pdf: "pdf", markdown: "doc", text: "doc" };
    var modules = {};
    var memory = {};
    var cur = null;
    var root = null;
    var pushed = false;
    var ownPops = 0;
    var afterPop = [];
    var scripts = {};

    //Absolute URL: some libraries (pdf.js) resolve against the window location
    //and ignore the page's <base>, which is the web root here
    function absolute(url) {
        return new URL(url, document.baseURI).href;
    }

    function kindOf(item) {
        if (!item || item.isDir) {
            return null;
        }
        var name = String(item.name || "");
        var ext = DriveIcons.getExt(name);
        if (!ext) {
            var lower = name.toLowerCase();
            if (["makefile", "dockerfile", "readme", "license", "changelog"].indexOf(lower) >= 0) {
                return "text";
            }
            return null;
        }
        var kind = EXT[ext] || null;
        if (kind == "text" && item.size > TEXT_LIMIT) {
            return null;
        }
        return kind;
    }

    function canOpen(item) {
        var kind = kindOf(item);
        return kind != null && !!modules[kind] && !item.shareOnly;
    }

    function register(kinds, module) {
        kinds.forEach(function (k) { modules[k] = module; });
    }

    /* ------------------------------------------------------------------ */
    /*  Shared helpers for the viewer modules                              */
    /* ------------------------------------------------------------------ */
    function fmtTime(sec) {
        if (!isFinite(sec) || sec < 0) {
            sec = 0;
        }
        sec = Math.floor(sec);
        var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
        var pad = function (n) { return (n < 10 ? "0" : "") + n; };
        return h > 0 ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
    }

    function loadScript(src) {
        if (scripts[src]) {
            return scripts[src];
        }
        scripts[src] = new Promise(function (resolve, reject) {
            var s = document.createElement("script");
            s.src = src;
            s.onload = function () { resolve(); };
            s.onerror = function () {
                delete scripts[src];
                reject(new Error("Unable to load " + src));
            };
            document.head.appendChild(s);
        });
        return scripts[src];
    }

    var TILE_ICON = { image: "image", video: "video", audio: "music", pdf: "doc", doc: "doc", sheet: "grid", slide: "monitor", text: "doc", code: "code" };

    function tileHTML(item, kind) {
        var cat = DriveIcons.category(item.name, false);
        return '<span class="vw-tile" style="background:' + DriveIcons.color(cat) + '">' + I(TILE_ICON[cat] || (kind == "markdown" ? "doc" : "file")) + '</span>';
    }

    /*
        seekBar({onSeek(fraction, done), tip(fraction) -> html})
        Returns {el, set(played, bufferedEnd), duration}
    */
    function seekBar(opts) {
        var el = DriveUI.el('<div class="seek" role="slider" aria-label="' + esc(T("vw/seek", "Seek")) + '" tabindex="-1">' +
            '<div class="seek-track"><div class="seek-buf"></div><div class="seek-hover"></div><div class="seek-play"></div><div class="seek-knob"></div></div>' +
            '<div class="seek-tip"></div></div>');
        var buf = el.querySelector(".seek-buf"), play = el.querySelector(".seek-play"), knob = el.querySelector(".seek-knob");
        var hover = el.querySelector(".seek-hover"), tip = el.querySelector(".seek-tip");
        var dragging = false;

        function frac(ev) {
            var r = el.getBoundingClientRect();
            var x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
            return Math.max(0, Math.min(1, x / r.width));
        }

        function showTip(f) {
            hover.style.width = (f * 100) + "%";
            if (opts.tip) {
                tip.innerHTML = opts.tip(f);
                var r = el.getBoundingClientRect();
                var w = tip.offsetWidth || 60;
                var x = Math.max(w / 2, Math.min(r.width - w / 2, f * r.width));
                tip.style.left = x + "px";
            }
        }

        el.addEventListener("pointermove", function (ev) {
            var f = frac(ev);
            showTip(f);
            if (dragging) {
                setPlayed(f);
                opts.onSeek(f, false);
            }
        });
        el.addEventListener("pointerdown", function (ev) {
            if (ev.button != 0) {
                return;
            }
            dragging = true;
            el.classList.add("dragging");
            el.setPointerCapture(ev.pointerId);
            var f = frac(ev);
            setPlayed(f);
            showTip(f);
            opts.onSeek(f, false);
        });
        var end = function (ev) {
            if (!dragging) {
                return;
            }
            dragging = false;
            el.classList.remove("dragging");
            opts.onSeek(frac(ev), true);
        };
        el.addEventListener("pointerup", end);
        el.addEventListener("pointercancel", function () {
            dragging = false;
            el.classList.remove("dragging");
        });

        function setPlayed(f) {
            play.style.width = (f * 100) + "%";
            knob.style.left = (f * 100) + "%";
        }

        return {
            el: el,
            set: function (played, buffered) {
                if (!dragging) {
                    setPlayed(Math.max(0, Math.min(1, played || 0)));
                }
                buf.style.width = (Math.max(0, Math.min(1, buffered || 0)) * 100) + "%";
            },
            isDragging: function () { return dragging; }
        };
    }

    /*
        GET a JSON endpoint of the media server. Without ffmpeg on the host the
        /media/probe/, /media/storyboard/ ... handlers are not registered, and
        the request falls through to /media/, which would stream the whole
        file back. So anything that is not JSON is aborted at the headers.
    */
    function fetchJSON(url) {
        var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
        return fetch(url, { credentials: "same-origin", signal: ctl ? ctl.signal : undefined }).then(function (r) {
            var type = r.headers.get("content-type") || "";
            if (!r.ok || type.indexOf("json") < 0) {
                if (ctl) {
                    ctl.abort();
                }
                throw new Error("not available");
            }
            return r.json();
        }).then(function (data) {
            if (data && data.error) {
                throw new Error(data.error);
            }
            return data;
        });
    }

    function rangeFill(input) {
        var min = parseFloat(input.min || 0), max = parseFloat(input.max || 1);
        input.style.setProperty("--p", ((parseFloat(input.value) - min) / (max - min) * 100) + "%");
    }

    function stateHTML(item, title, text, actions) {
        return '<div class="vw-state"><div class="big">' + DriveIcons.file(item.name, false) + '</div><b>' + esc(title) + '</b>' +
            (text ? '<div>' + esc(text) + '</div>' : "") + '<div class="row">' + (actions || []).map(function (a) {
                return '<button class="vw-btn' + (a.primary ? " primary" : "") + '" data-state-act="' + a.id + '">' + I(a.icon) + esc(a.label) + '</button>';
            }).join("") + '</div></div>';
    }

    function bindState(container, handlers) {
        container.querySelectorAll("[data-state-act]").forEach(function (b) {
            b.addEventListener("click", function () {
                var fn = handlers[b.getAttribute("data-state-act")];
                if (fn) {
                    fn();
                }
            });
        });
    }

    //Print the given nodes (or HTML) on their own, without the rest of the page
    function printContent(content) {
        var holder = document.getElementById("vwPrint");
        if (!holder) {
            holder = document.createElement("div");
            holder.id = "vwPrint";
            document.body.appendChild(holder);
        }
        holder.innerHTML = "";
        if (typeof content === "string") {
            holder.innerHTML = content;
        } else {
            [].concat(content).forEach(function (n) { holder.appendChild(n); });
        }
        var done = false;
        var cleanup = function () {
            if (done) {
                return;
            }
            done = true;
            holder.innerHTML = "";
            window.removeEventListener("afterprint", cleanup);
        };
        window.addEventListener("afterprint", cleanup);
        //Give images a moment to decode before the print dialog snapshots them
        var imgs = holder.querySelectorAll("img");
        Promise.all(Array.prototype.map.call(imgs, function (img) {
            return img.complete ? Promise.resolve() : new Promise(function (r) { img.onload = img.onerror = r; });
        })).then(function () {
            window.print();
            setTimeout(cleanup, 1500);
        });
    }

    function osd(text, icon) {
        if (!root) {
            return;
        }
        var el = root.querySelector(".vw-osd");
        el.innerHTML = (icon ? I(icon) : "") + "<span>" + esc(text) + "</span>";
        el.classList.add("show");
        clearTimeout(el.__t);
        el.__t = setTimeout(function () { el.classList.remove("show"); }, 900);
    }

    function toggleFullscreen(el) {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else if (el && el.requestFullscreen) {
            el.requestFullscreen().catch(function () { });
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Shell                                                              */
    /* ------------------------------------------------------------------ */
    function siblings(item, kind) {
        var fam = FAMILY[kind];
        var src = Drive.state.sorted || [];
        var inList = src.some(function (i) { return i.path == item.path; });
        if (!inList) {
            return [item];
        }
        return src.filter(function (i) {
            var k = kindOf(i);
            return k && FAMILY[k] == fam && !i.shareOnly;
        });
    }

    function metaText(item) {
        var bits = [];
        if (item.size >= 0) {
            bits.push(DriveUI.fmtSize(item.size));
        }
        if (item.trashed) {
            bits.push(T("vw/inTrash", "In the trash"));
        } else {
            bits.push(Drive.locationLabel(item.path));
        }
        if (item.mtime) {
            bits.push(T("vw/edited", "Edited {date}", { date: DriveUI.fmtDay(item.mtime) }));
        }
        return bits.join(" · ");
    }

    function buildShell() {
        root = DriveUI.el('<div class="vw" role="dialog" aria-modal="true">' +
            '<header class="vw-bar">' +
            '<button class="vw-ic" data-act="back" title="' + esc(T("host/back", "Back to Drive")) + '">' + I("arrowLeft") + '</button>' +
            '<div class="vw-file"><span data-slot="tile"></span><div class="vw-title"><b data-slot="name"></b><small data-slot="meta"></small></div></div>' +
            '<div class="vw-tools" data-slot="tools"></div>' +
            '<div class="vw-actions">' +
            '<button class="vw-ic" data-act="download" title="' + esc(T("toolbar/download", "Download")) + '">' + I("download") + '</button>' +
            '<button class="vw-ic vw-hide-sm" data-act="print" title="' + esc(T("vw/print", "Print")) + '" hidden>' + I("doc") + '</button>' +
            '<button class="vw-share" data-act="share">' + I("link") + '<span>' + esc(T("toolbar/share", "Share")) + '</span></button>' +
            '<button class="vw-ic" data-act="more" title="' + esc(T("toolbar/more", "More")) + '">' + I("moreV") + '</button>' +
            '<button class="vw-ic vw-hide-sm" data-act="close" title="' + esc(T("common/close", "Close")) + '">' + I("x") + '</button>' +
            '</div></header>' +
            '<div class="vw-body" data-slot="body"></div><div class="vw-osd"></div></div>');
        root.querySelector('[data-act="print"]').innerHTML = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/><path d="M17.5 12h.01"/></svg>';
        root.querySelectorAll("[data-act]").forEach(function (b) {
            b.addEventListener("click", function (e) {
                action(b.getAttribute("data-act"), b, e);
            });
        });
        document.body.appendChild(root);
    }

    function action(act, btn) {
        if (!cur) {
            return;
        }
        var item = cur.item;
        if (act == "back" || act == "close") {
            close();
        } else if (act == "download") {
            DriveActions.download([item]);
        } else if (act == "share") {
            DriveShare.open(item);
        } else if (act == "print") {
            if (cur.inst && cur.inst.print) {
                cur.inst.print();
            }
        } else if (act == "more") {
            var mods = item.trashed ? [] : DriveActions.compatibleModules(item);
            DriveUI.menu({ anchor: btn, align: "end" }, [
                mods.length ? {
                    icon: "apps", label: T("menu/openWith", "Open with"), submenu: function () {
                        return mods.map(function (m) {
                            return { img: API.ROOT + m.IconPath, label: m.Name, action: function () { close(false, function () { DriveActions.openWithModule(item, m); }); } };
                        });
                    }
                } : null,
                { icon: "newTab", label: T("vw/openRaw", "Open file in new tab"), action: function () { window.open(API.mediaURL(item.path), "_blank"); } },
                !item.trashed ? { icon: "link", label: T("menu/copyLink", "Copy link"), action: function () { DriveActions.copyLink(item); } } : null,
                !item.trashed ? {
                    icon: "folderOpen", label: T("menu/showLocation", "Show file location"), action: function () {
                        close(false, function () {
                            location.hash = Drive.folderRoute(API.parentOf(item.path));
                            setTimeout(function () { Drive.setSelection([item.path], { anchor: item.path, focus: item.path }); }, 600);
                        });
                    }
                } : null,
                !item.trashed ? {
                    icon: "info", label: T("menu/details", "View details"), action: function () {
                        close(false, function () {
                            Drive.setSelection([item.path], { anchor: item.path, focus: item.path });
                            Drive.toggleDetails(true);
                        });
                    }
                } : null,
                "-",
                { icon: "keyboard", label: T("help/shortcuts", "Keyboard shortcuts"), action: showKeys }
            ]);
        }
    }

    function showKeys() {
        var rows = (cur && cur.inst && cur.inst.shortcuts) ? cur.inst.shortcuts : [];
        rows = rows.concat([[T("vw/keyClose", "Close the viewer"), "Esc"]]);
        DriveUI.modal({
            title: T("help/shortcuts", "Keyboard shortcuts"), icon: "keyboard",
            body: '<div class="shortcut-grid">' + rows.map(function (r) {
                return '<span>' + esc(r[0]) + '</span><span>' + r[1].split(" / ").map(function (k) {
                    return k.split(" + ").map(function (p) { return '<span class="kbd">' + esc(p) + '</span>'; }).join(" + ");
                }).join(" / ") + '</span>';
            }).join("") + '</div>',
            buttons: [{ label: T("common/close", "Close"), cls: "primary" }]
        });
    }

    function mount(item) {
        var kind = kindOf(item);
        if (cur && cur.inst && cur.inst.destroy) {
            try { cur.inst.destroy(); } catch (e) { console.warn(e); }
        }
        var body = root.querySelector('[data-slot="body"]');
        var tools = root.querySelector('[data-slot="tools"]');
        body.innerHTML = "";
        tools.innerHTML = "";
        root.setAttribute("data-kind", kind);
        root.querySelector(".vw-osd").classList.remove("show");
        root.querySelector('[data-slot="tile"]').innerHTML = tileHTML(item, kind);
        root.querySelector('[data-slot="name"]').textContent = item.name;
        root.querySelector('[data-slot="name"]').title = item.name;
        root.querySelector('[data-slot="meta"]').textContent = metaText(item);
        root.querySelector('[data-act="share"]').hidden = !!item.trashed;
        var list = cur && cur.list && cur.list.some(function (i) { return i.path == item.path; }) && FAMILY[cur.kind] == FAMILY[kind] ? cur.list : siblings(item, kind);
        var index = 0;
        list.forEach(function (i, n) {
            if (i.path == item.path) {
                index = n;
            }
        });
        memory[kind] = memory[kind] || {};
        cur = { item: item, kind: kind, list: list, index: index, inst: null };
        var ctx = {
            item: item,
            kind: kind,
            list: list,
            index: index,
            body: body,
            tools: tools,
            root: root,
            memory: memory[kind],
            url: absolute(API.mediaURL(item.path)),
            hasPrev: index > 0,
            hasNext: index < list.length - 1,
            go: function (delta) { go(delta); },
            goTo: function (other) { mount(other); },
            close: close,
            osd: osd,
            fullscreen: toggleFullscreen,
            setPrintable: function (on) {
                root.querySelector('[data-act="print"]').hidden = !on;
            },
            setMeta: function (text) {
                root.querySelector('[data-slot="meta"]').textContent = text || metaText(item);
            }
        };
        ctx.setPrintable(false);
        var module = modules[kind];
        try {
            cur.inst = module.mount(ctx) || {};
        } catch (e) {
            console.error(e);
            body.innerHTML = stateHTML(item, T("vw/failed", "This file cannot be shown"), e.message, [{ id: "dl", icon: "download", label: T("toolbar/download", "Download") }]);
            bindState(body, { dl: function () { DriveActions.download([item]); } });
            cur.inst = {};
        }
        if ("mediaSession" in navigator && kind != "audio" && kind != "video") {
            navigator.mediaSession.metadata = null;
        }
    }

    function go(delta) {
        if (!cur || cur.list.length < 2) {
            return;
        }
        var next = cur.index + delta;
        if (next < 0 || next >= cur.list.length) {
            return;
        }
        mount(cur.list[next]);
    }

    function open(item) {
        if (!canOpen(item)) {
            return false;
        }
        DriveUI.closeMenus(0);
        DriveUI.closePopover();
        //A slideshow or autoplay carries over between files, never between visits
        Object.keys(memory).forEach(function (k) {
            delete memory[k].slideshow;
        });
        if (!root) {
            buildShell();
            if (!pushed) {
                try {
                    history.pushState({ driveViewer: true }, "", location.href);
                    pushed = true;
                } catch (e) { }
            }
        }
        cur = null;
        mount(item);
        return true;
    }

    /*
        close(fromHistory, then): "then" runs once the history entry the viewer
        added is gone, so navigation done in it is not undone by that pop.
    */
    function close(fromHistory, then) {
        if (!root) {
            if (then) {
                then();
            }
            return;
        }
        if (cur && cur.inst && cur.inst.destroy) {
            try { cur.inst.destroy(); } catch (e) { }
        }
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(function () { });
        }
        if ("mediaSession" in navigator) {
            navigator.mediaSession.metadata = null;
            ["play", "pause", "previoustrack", "nexttrack", "seekbackward", "seekforward", "seekto"].forEach(function (a) {
                try { navigator.mediaSession.setActionHandler(a, null); } catch (e) { }
            });
        }
        root.remove();
        root = null;
        cur = null;
        if (pushed && fromHistory !== true) {
            pushed = false;
            if (history.state && history.state.driveViewer) {
                //This pop is ours: the listener must not close a viewer opened meanwhile
                ownPops++;
                if (then) {
                    afterPop.push(then);
                    then = null;
                }
                history.back();
            }
        }
        pushed = false;
        if (then) {
            then();
        }
    }

    window.addEventListener("popstate", function () {
        if (ownPops > 0) {
            ownPops--;
            var fn = afterPop.shift();
            if (fn) {
                setTimeout(fn, 0);
            }
            return;
        }
        if (root) {
            pushed = false;
            close(true);
        }
    });

    window.addEventListener("resize", function () {
        if (cur && cur.inst && cur.inst.onResize) {
            cur.inst.onResize();
        }
    });

    function onKey(e) {
        if (DriveUI.menuOpen() && DriveUI.menuKeyNav(e)) {
            e.preventDefault();
            return;
        }
        var top = DriveUI.topModal();
        if (top) {
            if (e.key == "Escape") {
                top.close();
            }
            return;
        }
        if (cur && cur.inst && cur.inst.key && cur.inst.key(e)) {
            return;
        }
        var typing = e.target && (e.target.tagName == "INPUT" || e.target.tagName == "TEXTAREA" || e.target.isContentEditable);
        if (typing) {
            return;
        }
        if (e.key == "Escape") {
            if (document.fullscreenElement) {
                return;
            }
            close();
        } else if (e.key == "?") {
            showKeys();
        } else if ((e.ctrlKey || e.metaKey) && (e.key == "s" || e.key == "S")) {
            e.preventDefault();
            DriveActions.download([cur.item]);
        } else if ((e.ctrlKey || e.metaKey) && (e.key == "p" || e.key == "P") && cur.inst && cur.inst.print) {
            e.preventDefault();
            cur.inst.print();
        }
    }

    var Viewer = {
        open: open,
        close: close,
        isOpen: function () { return root != null; },
        onKey: onKey,
        canOpen: canOpen,
        kindOf: kindOf,
        register: register,
        current: function () { return cur; },
        util: {
            fmtTime: fmtTime,
            absolute: absolute,
            fetchJSON: fetchJSON,
            loadScript: loadScript,
            seekBar: seekBar,
            rangeFill: rangeFill,
            stateHTML: stateHTML,
            bindState: bindState,
            printContent: printContent,
            toggleFullscreen: toggleFullscreen
        }
    };

    global.DriveViewer = Viewer;
    //Kept for the callers of the first, simpler previewer
    global.DrivePreview = {
        open: open,
        close: close,
        isOpen: Viewer.isOpen,
        onKey: onKey,
        canPreview: canOpen,
        kind: kindOf
    };
})(window);
