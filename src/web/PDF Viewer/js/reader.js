/*
    reader.js

    The page around the PDF reader: a dark top bar with the file, the
    reader's tools, download / print / more, keyboard routing and printing.
    The reader itself (js/reader.pdf.js) is a copy of Drive's PDF viewer and
    talks to this shell through the same small API Drive's viewer shell
    offers: Reader.register, Reader.util and the ctx handed to mount().

    The file comes in through the URL hash like every ArozOS module
    (ao_module_loadInputFiles) and is read from /media, which only checks
    the user's file permissions. pdf.js is the copy in js/ and cmaps/, the
    same files PDF Tool loads from this folder.
*/

(function (global) {
    "use strict";

    var UI = ReaderUI;
    var I = UI.I;
    var esc = UI.esc;

    var module = null;
    var inst = null;
    var item = null;
    var root = null;
    var memory = {};
    var scripts = {};

    function register(kinds, mod) {
        if (kinds.indexOf("pdf") >= 0) {
            module = mod;
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Helpers for the reader                                             */
    /* ------------------------------------------------------------------ */
    //Absolute URL: pdf.js resolves its worker and cMaps against the window
    function absolute(url) {
        return new URL(url, document.baseURI).href;
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

    function stateHTML(it, title, text, actions) {
        return '<div class="vw-state"><div class="big">' + UI.fileIcon() + '</div><b>' + esc(title) + '</b>' +
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

    //Print the given nodes on their own, without the rest of the page
    function printContent(content) {
        var holder = document.getElementById("vwPrint");
        if (!holder) {
            holder = document.createElement("div");
            holder.id = "vwPrint";
            document.body.appendChild(holder);
        }
        holder.innerHTML = "";
        [].concat(content).forEach(function (n) { holder.appendChild(n); });
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
        var imgs = holder.querySelectorAll("img");
        Promise.all(Array.prototype.map.call(imgs, function (img) {
            return img.complete ? Promise.resolve() : new Promise(function (r) { img.onload = img.onerror = r; });
        })).then(function () {
            window.print();
            setTimeout(cleanup, 1500);
        });
    }

    function mediaURL(path) {
        return "../media/?file=" + encodeURIComponent(path);
    }

    function download(it) {
        it = it || item;
        if (!it) {
            return;
        }
        var a = document.createElement("a");
        a.href = "../media/download/?file=" + encodeURIComponent(it.path);
        a.download = it.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    //"user:/Documents/a.pdf" -> "user:/Documents"
    function locationLabel(path) {
        var p = String(path || "").replace(/\/+$/, "");
        var cut = p.lastIndexOf("/");
        if (cut < 0) {
            return p;
        }
        var parent = p.substring(0, cut);
        return /:$/.test(parent) ? parent + "/" : parent;
    }

    /* ------------------------------------------------------------------ */
    /*  Page                                                               */
    /* ------------------------------------------------------------------ */
    function metaText(it) {
        var bits = [];
        if (it.size != null) {
            bits.push(UI.fmtSize(it.size));
        }
        bits.push(locationLabel(it.path));
        if (it.mtime) {
            bits.push(T("vw/edited", "Edited {date}", { date: UI.fmtDay(it.mtime) }));
        }
        return bits.join(" · ");
    }

    function buildShell() {
        root = UI.el('<div class="vw" data-kind="pdf">' +
            '<header class="vw-bar">' +
            '<div class="vw-file"><span data-slot="tile"><span class="vw-tile" style="background:#ef4444">' + I("doc") + '</span></span>' +
            '<div class="vw-title"><b data-slot="name"></b><small data-slot="meta"></small></div></div>' +
            '<div class="vw-tools" data-slot="tools"></div>' +
            '<div class="vw-actions">' +
            '<button class="vw-ic" data-act="open" title="' + esc(T("rd/openFile", "Open a file")) + '">' + I("folderOpen") + '</button>' +
            '<button class="vw-ic" data-act="download" title="' + esc(T("toolbar/download", "Download")) + '" hidden>' + I("download") + '</button>' +
            '<button class="vw-ic vw-hide-sm" data-act="print" title="' + esc(T("vw/print", "Print")) + '" hidden>' + I("printer") + '</button>' +
            '<button class="vw-ic" data-act="more" title="' + esc(T("toolbar/more", "More")) + '">' + I("moreV") + '</button>' +
            '</div></header>' +
            '<div class="vw-body" data-slot="body"></div><div class="vw-osd"></div></div>');
        root.querySelectorAll("[data-act]").forEach(function (b) {
            b.addEventListener("click", function () { action(b.getAttribute("data-act"), b); });
        });
        document.body.appendChild(root);
    }

    function action(act, btn) {
        if (act == "open") {
            pickFile();
        } else if (act == "download") {
            download();
        } else if (act == "print") {
            if (inst && inst.print) {
                inst.print();
            }
        } else if (act == "close") {
            ao_module_close();
        } else if (act == "more") {
            UI.menu({ anchor: btn, align: "end" }, [
                { icon: "folderOpen", label: T("rd/openFile", "Open a file"), action: pickFile },
                item ? { icon: "newTab", label: T("vw/openRaw", "Open file in new tab"), action: function () { window.open(mediaURL(item.path), "_blank"); } } : null,
                "-",
                { icon: "keyboard", label: T("help/shortcuts", "Keyboard shortcuts"), action: showKeys }
            ]);
        }
    }

    function showKeys() {
        var rows = (inst && inst.shortcuts) ? inst.shortcuts.slice() : [];
        rows.push([T("toolbar/download", "Download"), "Ctrl + S"]);
        UI.modal({
            title: T("help/shortcuts", "Keyboard shortcuts"), icon: "keyboard",
            body: '<div class="shortcut-grid">' + rows.map(function (r) {
                return '<span>' + esc(r[0]) + '</span><span>' + r[1].split(" / ").map(function (k) {
                    return k.split(" + ").map(function (p) { return '<span class="kbd">' + esc(p) + '</span>'; }).join(" + ");
                }).join(" / ") + '</span>';
            }).join("") + '</div>',
            buttons: [{ label: T("common/close", "Close"), cls: "primary" }]
        });
    }

    function osd(text, icon) {
        var el = root.querySelector(".vw-osd");
        el.innerHTML = (icon ? I(icon) : "") + "<span>" + esc(text) + "</span>";
        el.classList.add("show");
        clearTimeout(el.__t);
        el.__t = setTimeout(function () { el.classList.remove("show"); }, 900);
    }

    function setPrintable(on) {
        root.querySelector('[data-act="print"]').hidden = !on;
    }

    function unmount() {
        if (inst && inst.destroy) {
            try { inst.destroy(); } catch (e) { console.warn(e); }
        }
        inst = null;
        root.querySelector('[data-slot="body"]').innerHTML = "";
        root.querySelector('[data-slot="tools"]').innerHTML = "";
        setPrintable(false);
    }

    function showEmpty() {
        unmount();
        item = null;
        root.querySelector('[data-slot="name"]').textContent = T("rd/title", "PDF Viewer");
        root.querySelector('[data-slot="meta"]').textContent = "";
        root.querySelector('[data-act="download"]').hidden = true;
        ao_module_setWindowTitle(T("rd/title", "PDF Viewer"));
        var body = root.querySelector('[data-slot="body"]');
        body.innerHTML = stateHTML(null, T("rd/noFile", "No file is open"), T("rd/noFileText", "Open a PDF from your files to read it here."),
            [{ id: "open", icon: "folderOpen", label: T("rd/openFile", "Open a file"), primary: true }]);
        bindState(body, { open: pickFile });
    }

    //HEAD on the media URL gives the size and date without reading the file
    function stat(it) {
        var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
        var timer = setTimeout(function () { if (ctl) { ctl.abort(); } }, 4000);
        return fetch(mediaURL(it.path), { method: "HEAD", credentials: "same-origin", signal: ctl ? ctl.signal : undefined }).then(function (r) {
            clearTimeout(timer);
            if (!r.ok) {
                return;
            }
            var len = parseInt(r.headers.get("content-length"), 10);
            if (!isNaN(len)) {
                it.size = len;
            }
            var mod = Date.parse(r.headers.get("last-modified") || "");
            if (!isNaN(mod)) {
                it.mtime = Math.floor(mod / 1000);
            }
        }).catch(function () { clearTimeout(timer); });
    }

    function mount(file) {
        unmount();
        item = { name: file.filename || String(file.filepath).split("/").pop(), path: file.filepath, size: null, mtime: 0 };
        var it = item;
        root.querySelector('[data-slot="name"]').textContent = it.name;
        root.querySelector('[data-slot="name"]').title = it.name;
        root.querySelector('[data-slot="meta"]').textContent = locationLabel(it.path);
        root.querySelector('[data-act="download"]').hidden = false;
        ao_module_setWindowTitle(it.name);
        stat(it).then(function () {
            if (item !== it) {
                return;
            }
            root.querySelector('[data-slot="meta"]').textContent = metaText(it);
            start(it);
        });
    }

    function start(it) {
        var ctx = {
            item: it,
            kind: "pdf",
            list: [it],
            index: 0,
            body: root.querySelector('[data-slot="body"]'),
            tools: root.querySelector('[data-slot="tools"]'),
            root: root,
            memory: memory,
            url: absolute(mediaURL(it.path)),
            hasPrev: false,
            hasNext: false,
            go: function () { },
            goTo: function () { },
            close: function () { ao_module_close(); },
            osd: osd,
            setPrintable: setPrintable,
            setMeta: function (text) {
                root.querySelector('[data-slot="meta"]').textContent = text || metaText(it);
            }
        };
        try {
            inst = module.mount(ctx) || {};
        } catch (e) {
            console.error(e);
            ctx.body.innerHTML = stateHTML(it, T("vw/failed", "This file cannot be shown"), e.message,
                [{ id: "dl", icon: "download", label: T("toolbar/download", "Download") }]);
            bindState(ctx.body, { dl: function () { download(it); } });
            inst = {};
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Opening files                                                      */
    /* ------------------------------------------------------------------ */
    function pickFile() {
        ao_module_openFileSelector("_readerFilePicked", "user:/", "file", false, { filter: ["pdf"] });
    }

    //Called back by name from the file selector window
    global._readerFilePicked = function (files) {
        if (!files || !files.length) {
            return;
        }
        var file = { filename: files[0].filename, filepath: files[0].filepath };
        try {
            history.replaceState(null, "", "#" + encodeURIComponent(JSON.stringify([file])));
        } catch (e) { }
        mount(file);
    };

    function fromHash() {
        var files = ao_module_loadInputFiles();
        if (files && files.length && files[0].filepath) {
            mount(files[0]);
        } else {
            showEmpty();
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Keys and boot                                                      */
    /* ------------------------------------------------------------------ */
    document.addEventListener("keydown", function (e) {
        if (UI.menuOpen() && UI.menuKeyNav(e)) {
            e.preventDefault();
            return;
        }
        var top = UI.topModal();
        if (top) {
            if (e.key == "Escape") {
                top.close();
            }
            return;
        }
        if (inst && inst.key && inst.key(e)) {
            return;
        }
        var typing = e.target && (e.target.tagName == "INPUT" || e.target.tagName == "TEXTAREA" || e.target.isContentEditable);
        if (typing) {
            return;
        }
        if (e.key == "?") {
            showKeys();
        } else if ((e.ctrlKey || e.metaKey) && (e.key == "s" || e.key == "S")) {
            e.preventDefault();
            download();
        } else if ((e.ctrlKey || e.metaKey) && (e.key == "o" || e.key == "O")) {
            e.preventDefault();
            pickFile();
        } else if ((e.ctrlKey || e.metaKey) && (e.key == "p" || e.key == "P") && inst && inst.print) {
            e.preventDefault();
            inst.print();
        }
    });

    window.addEventListener("resize", function () {
        if (inst && inst.onResize) {
            inst.onResize();
        }
    });

    window.addEventListener("hashchange", fromHash);

    global.Reader = {
        register: register,
        download: download,
        locationLabel: locationLabel,
        util: {
            absolute: absolute,
            loadScript: loadScript,
            stateHTML: stateHTML,
            bindState: bindState,
            printContent: printContent
        }
    };

    document.addEventListener("DOMContentLoaded", function () {
        UI.loadLocale().then(function () {
            buildShell();
            fromHash();
        });
    });
})(window);
