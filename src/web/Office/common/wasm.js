/*
    OfficeWasm - the Office format converters, loaded on demand
    ==========================================================

    In ArozOS the .docx / .xlsx / .pptx / ODF conversions run server side in
    mod/office behind the AGI gateway. The standalone web edition has no
    server, so it ships the very same Go code compiled to WebAssembly
    (src/wasm/office) and runs it in the page.

    This file is only the loader and the call wrapper; nothing outside
    common/platform.js should touch it. Ask `OfficePlatform.canConvert()`
    whether conversions are possible at all, and go through
    `OfficePlatform.convertIn/convertOut` to run one.

        OfficeWasm.available()                 // was this build made with -wasm?
        OfficeWasm.isReady()                   // module already loaded?
        OfficeWasm.load(cb, errcb)             // fetch + start it (idempotent)
        OfficeWasm.runImport(name, bytes, cb(jsonString), errcb)
        OfficeWasm.runExport(name, jsonStr, cb({data, mediaZip}), errcb)

    Notes on the design:

    - **Lazy.** The module is a few MB, which is most of the page weight, and
      plenty of visitors only ever read a .doca. It is fetched the first time
      a conversion is actually asked for, never on page load.
    - **Plain fetch, not instantiateStreaming.** Streaming instantiation
      needs the server to send Content-Type: application/wasm, and the whole
      promise of this build is that it works on any dumb static host - a
      handful of which serve .wasm as octet-stream.
    - **The calls are synchronous inside the module** (see src/wasm/office),
      because Go's wasm runtime shares this thread anyway. They are wrapped
      in a paint yield here so the caller's busy overlay is on screen before
      the thread is tied up.
    - `go.run()` on a module whose main ends in `select {}` returns a promise
      that never settles, so readiness is signalled the other way: the module
      calls back into `window.__officeWasmReady` once its table is up.
*/
var OfficeWasm = (function () {
    "use strict";

    // where office.wasm and wasm_exec.js sit, resolved from this file's own
    // URL so it does not matter which app page pulled it in
    var BASE = (function () {
        try {
            var s = document.currentScript;
            if (s && s.src) return s.src.replace(/[^/]*$/, "") + "wasm/";
        } catch (e) { }
        return "../common/wasm/";
    })();

    var IDLE = 0, LOADING = 1, READY = 2, FAILED = 3;
    var state = IDLE;
    var loadError = null;
    var waiting = [];          // [{cb, errcb}] queued while LOADING

    function available() {
        return (typeof window.OFFICE_WASM !== "undefined") && !!window.OFFICE_WASM;
    }
    function isReady() { return state === READY; }

    function settle(ok, err) {
        state = ok ? READY : FAILED;
        loadError = ok ? null : err;
        var queue = waiting;
        waiting = [];
        queue.forEach(function (w) {
            if (ok) { w.cb(); } else if (w.errcb) { w.errcb(err); }
        });
    }

    function injectScript(url, cb, errcb) {
        var el = document.createElement("script");
        el.src = url;
        el.onload = function () { cb(); };
        el.onerror = function () { errcb("could not load " + url); };
        document.head.appendChild(el);
    }

    function startModule(cb, errcb) {
        if (typeof window.Go !== "function") {
            errcb("the WebAssembly runtime did not load");
            return;
        }
        var go = new window.Go();
        var url = BASE + "office.wasm";
        fetch(url).then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.arrayBuffer();
        }).then(function (buf) {
            return WebAssembly.instantiate(buf, go.importObject);
        }).then(function (res) {
            // the module signals readiness from inside main(); go.run's own
            // promise never settles because main ends in select{}
            var done = false;
            window.__officeWasmReady = function () {
                if (done) return;
                done = true;
                cb();
            };
            go.run(res.instance);
            // main() sets the table and calls back synchronously, so if it
            // has not by now something is wrong with the module itself
            setTimeout(function () {
                if (!done) {
                    done = true;
                    if (window.__officeWasm) { cb(); }
                    else { errcb("the converter module started but registered nothing"); }
                }
            }, 0);
        }).catch(function (e) {
            errcb("could not load the converters: " + (e && e.message ? e.message : e));
        });
    }

    function load(cb, errcb) {
        errcb = errcb || function () { };
        if (state === READY) { cb(); return; }
        if (state === FAILED) { errcb(loadError); return; }
        waiting.push({ cb: cb, errcb: errcb });
        if (state === LOADING) return;
        state = LOADING;

        if (!available()) {
            settle(false, "this build was made without the converter module");
            return;
        }
        var boot = function () {
            startModule(function () { settle(true); },
                function (msg) { settle(false, msg); });
        };
        if (typeof window.Go === "function") { boot(); return; }
        injectScript(BASE + "wasm_exec.js", boot, function (msg) {
            settle(false, msg);
        });
    }

    /* Give the browser a frame to paint the caller's busy overlay before the
       conversion takes the thread. Two rAFs: the first fires before the
       pending paint, the second after it.

       A timer runs alongside them and whichever fires first wins, because a
       hidden or backgrounded tab never paints - rAF there is throttled to a
       stop, and on its own it would leave a conversion started in a
       background tab hanging forever with no error and no result. */
    function afterPaint(fn) {
        var done = false;
        var go = function () {
            if (done) return;
            done = true;
            fn();
        };
        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(function () {
                requestAnimationFrame(function () { setTimeout(go, 0); });
            });
        }
        setTimeout(go, 120);
    }

    function call(kind, name, payload, cb, errcb) {
        errcb = errcb || function () { };
        load(function () {
            var api = window.__officeWasm;
            if (!api || typeof api[kind] !== "function") {
                errcb("the converter module is missing " + kind);
                return;
            }
            afterPaint(function () {
                var res;
                try {
                    res = api[kind](name, payload);
                } catch (e) {
                    errcb("conversion failed: " + (e && e.message ? e.message : e));
                    return;
                }
                if (!res || !res.ok) {
                    errcb((res && res.error) || "conversion failed");
                    return;
                }
                cb(res);
            });
        }, errcb);
    }

    function runImport(name, bytes, cb, errcb) {
        call("runImport", name, bytes, function (res) { cb(res.json); }, errcb);
    }
    function runExport(name, jsonStr, cb, errcb) {
        call("runExport", name, jsonStr, function (res) {
            cb({ data: res.data, mediaZip: res.mediaZip || null });
        }, errcb);
    }

    // what this module can actually do, for a capability check that does not
    // depend on the front end and the Go side agreeing on a hardcoded list
    function converters() {
        var api = window.__officeWasm;
        if (!api) return null;
        return { importers: api.importers || [], exporters: api.exporters || [] };
    }

    return {
        available: available,
        isReady: isReady,
        load: load,
        runImport: runImport,
        runExport: runExport,
        converters: converters,
        baseUrl: function () { return BASE; }
    };
})();
