/*
    OfficeNative - the bridge to a native desktop shell
    ===================================================

    A desktop shell (apps/ArozOS Office Mac: a Cocoa window around a
    WKWebView, serving the standalone build from 127.0.0.1) runs the suite
    as a real desktop application. It announces itself by defining
    window.OFFICE_NATIVE before any page script runs:

        { platform: "macos", version: "1.0.0",
          token: "<per-launch secret>", window: <window id> }

    and answers on the page's own origin under /__native/. Every request
    carries the token (X-Office-Token) and the window it comes from
    (X-Office-Window); the shell refuses anything else, so another page or
    program on this machine cannot drive it.

    Files are capabilities, not paths. The page never names a file on disk:
    the shell hands out "native:/<handle>/<name>" for a file the person
    picked in a system dialog, opened from Finder or dropped on a window,
    and only those can be read or written. Script that a hostile document
    managed to run in the editor still could not reach anything else.

    Endpoints (JSON in and out unless noted; errors are {error} with a
    non-2xx status):

      POST pick-open       {exts:[".docx"], multiple}  -> {files:[{path,name}]}
      POST pick-save       {name, ext, near}           -> {path,name} | {cancelled:true}
      GET  file?path=<p>   -> the file's bytes
      PUT  file?path=<p>   <- the file's bytes, written atomically
      POST recents         -> {items:[{path,name,app,ext,folder,at}]}
      POST recents/forget  {path}
      POST window          {action, ...} where action is
                             open    {path} or {url}: another window
                             close   this window, now (the page has agreed)
                             close-cancelled  the person kept the window
                             info    {edited, path, seq}: close-button dot,
                                     proxy icon (the newest seq wins)
                             theme   {theme: "light" | "dark" | "system"}
                             print   the system print panel (answers when done)
                             reveal  {path}: show the file in Finder

    The shell calls into the page through two functions:

      OfficeNative.requestClose()  the window's close button. true = close
                                   now; false = the page is asking the
                                   person and will answer with close or
                                   close-cancelled
      OfficeNative.menu(name)      an item of the system menu bar that the
                                   page carries out (save, saveAs, print,
                                   undo, redo)

    Without a shell (ArozOS, the web edition) available() is false and
    nothing here does anything: platform.js only picks its native host
    when it is true.

    Load order: mode.js, native.js, ... platform.js.
*/
var OfficeNative = (function () {
    "use strict";

    var cfg = window.OFFICE_NATIVE || null;
    var PREFIX = "native:/";
    var BASE = "/__native/";

    function available() {
        return !!(cfg && typeof cfg.token === "string" && cfg.token.length > 0 &&
            typeof window.fetch === "function");
    }
    function isNativePath(p) { return String(p || "").indexOf(PREFIX) === 0; }

    /* ---------- transport ---------- */
    function headers(extra) {
        var h = {
            "X-Office-Token": cfg.token,
            "X-Office-Window": String(cfg.window || 0)
        };
        Object.keys(extra || {}).forEach(function (k) { h[k] = extra[k]; });
        return h;
    }
    function failure(res) {
        return res.text().then(function (t) {
            var msg = "HTTP " + res.status;
            try {
                var o = JSON.parse(t);
                if (o && o.error) msg = o.error;
            } catch (e) { if (t) msg = t; }
            throw new Error(msg);
        });
    }
    function call(endpoint, payload) {
        if (!available()) return Promise.reject(new Error("no native shell"));
        return fetch(BASE + endpoint, {
            method: "POST",
            headers: headers({ "Content-Type": "application/json" }),
            body: JSON.stringify(payload || {}),
            cache: "no-store"
        }).then(function (res) {
            if (!res.ok) return failure(res);
            return res.json();
        });
    }
    function fileUrl(path) { return BASE + "file?path=" + encodeURIComponent(path); }

    // ".docx" and "docx" both appear in the suite's filters
    function normExts(list) {
        return (list || []).map(function (e) {
            e = String(e).toLowerCase();
            return e.charAt(0) === "." ? e : "." + e;
        });
    }

    /* ---------- files ---------- */
    function read(path) {
        if (!available()) return Promise.reject(new Error("no native shell"));
        return fetch(fileUrl(path), { headers: headers(), cache: "no-store" }).then(function (res) {
            if (!res.ok) return failure(res);
            return res.arrayBuffer();
        }).then(function (buf) { return new Uint8Array(buf); });
    }
    // data: a Uint8Array, or a string (written as UTF-8)
    function write(path, data) {
        if (!available()) return Promise.reject(new Error("no native shell"));
        return fetch(fileUrl(path), {
            method: "PUT",
            headers: headers({ "Content-Type": "application/octet-stream" }),
            body: data,
            cache: "no-store"
        }).then(function (res) {
            if (!res.ok) return failure(res);
            return res.json();
        });
    }
    // -> [{path, name}], empty when the person cancelled
    function pickOpen(opts) {
        opts = opts || {};
        return call("pick-open", {
            exts: normExts(opts.exts),
            multiple: !!opts.multiple
        }).then(function (r) { return (r && r.files) || []; });
    }
    // -> {path, name}, or null when the person cancelled. near: a native
    // path whose folder the dialog starts in
    function pickSave(opts) {
        opts = opts || {};
        return call("pick-save", {
            name: opts.name || "",
            ext: opts.ext || "",
            near: isNativePath(opts.near) ? opts.near : ""
        }).then(function (r) { return (r && r.path) ? r : null; });
    }
    function recents() {
        return call("recents").then(function (r) { return (r && r.items) || []; });
    }
    function forgetRecent(path) { return call("recents/forget", { path: path }); }

    /* ---------- the window ---------- */
    function windowAction(action, extra) {
        var p = extra || {};
        p.action = action;
        return call("window", p);
    }
    // {path: native path} opens that document; {url: page path} opens a page
    function openWindow(target) {
        target = target || {};
        return windowAction("open", { path: target.path || "", url: target.url || "" });
    }
    function closeWindow() { return windowAction("close"); }
    /* Each update is its own request, and requests can overtake each
       other: seq orders them (the shell keeps the newest), and it grows
       across page loads in the window too. */
    var infoCount = 0;
    function windowInfo(info) {
        info = info || {};
        infoCount = (infoCount + 1) % 1000;
        return windowAction("info", {
            edited: !!info.edited,
            path: isNativePath(info.path) ? info.path : "",
            seq: Date.now() * 1000 + infoCount
        });
    }
    // dark: true / false, or null to follow the system
    function setTheme(dark) {
        return windowAction("theme", { theme: dark === null ? "system" : (dark ? "dark" : "light") });
    }
    // resolves once the print panel is finished with the page
    function print() { return windowAction("print"); }
    function reveal(path) { return windowAction("reveal", { path: path }); }

    /* ---------- the shell calling in ---------- */
    var closing = false;
    function requestClose() {
        var app = window.OfficeApp;
        if (!app || typeof app.requestClose !== "function") return true;
        if (typeof app.isDirty === "function" && !app.isDirty()) return true;
        // the close button again while the question is up: keep asking once
        if (closing) return false;
        closing = true;
        app.requestClose(function () {
            closing = false;
            closeWindow();
        }, function () {
            closing = false;
            windowAction("close-cancelled");
        });
        return false;
    }

    /* A key combination the page's own shortcuts answer (OfficeHotkeys),
       for menu items whose command lives in the app rather than in
       OfficeApp: the same handler runs whether the person pressed the keys
       or picked the menu item. Falls back to the browser's command when no
       handler claimed it (a plain text field's own undo). */
    function sendKey(key, shift, fallback) {
        var target = document.activeElement || document.body;
        var ev;
        try {
            ev = new KeyboardEvent("keydown", {
                key: key, code: "Key" + key.toUpperCase(), metaKey: true,
                shiftKey: !!shift, bubbles: true, cancelable: true
            });
        } catch (e) { return false; }
        if (target.dispatchEvent(ev) && fallback) {
            try { document.execCommand(fallback); } catch (e) { }
        }
        return true;
    }
    function menu(name) {
        var app = window.OfficeApp;
        switch (name) {
            case "save":
                if (app && app.save) { app.save(); return true; }
                return false;
            case "saveAs":
                if (app && app.saveAs) { app.saveAs(); return true; }
                return false;
            case "print":
                if (app && app.print) { app.print(); return true; }
                window.print();
                return true;
            case "undo":
                return sendKey("z", false, "undo");
            case "redo":
                return sendKey("z", true, "redo");
        }
        return false;
    }

    /* window.print() does nothing in a WKWebView: hand it to the shell's
       print panel. OfficeApp prints through OfficePlatform.print, which
       waits for the panel; this only catches a direct call. */
    if (available()) {
        window.print = function () { print(); };
    }

    return {
        available: available,
        platform: function () { return cfg ? cfg.platform || "" : ""; },
        isNativePath: isNativePath,
        read: read,
        write: write,
        pickOpen: pickOpen,
        pickSave: pickSave,
        recents: recents,
        forgetRecent: forgetRecent,
        openWindow: openWindow,
        closeWindow: closeWindow,
        windowInfo: windowInfo,
        setTheme: setTheme,
        print: print,
        reveal: reveal,
        requestClose: requestClose,
        menu: menu
    };
})();
