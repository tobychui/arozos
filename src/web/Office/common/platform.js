/*
    OfficePlatform - the host abstraction for the ArozOS Office Suite
    ================================================================

    Every place the suite reaches outside the browser tab goes through this
    file, so the same source runs in two hosts:

      "arozos"      the ArozOS desktop. Files live in the virtual file
                    system, dialogs are the desktop's file selector, and the
                    heavy format conversions run server side in the AGI
                    backends (mod/office).

      "standalone"  a plain static web server with no ArozOS behind it
                    (the "ArozOS Office Web" build). Documents are read from
                    the visitor's device or from a relative URL next to the
                    page, opened and saved by the same Go code compiled to
                    WebAssembly (common/wasm.js), and saving hands the file
                    back as a download.

    Documents are .docx / .xlsx / .pptx in both hosts: documentLoad turns
    the file into the editor envelope and documentSave writes the envelope
    back as the file (mod/office native.go - the OOXML plus the editor's own
    copy embedded in the package).

    Two separate capability questions, deliberately not one:

      hasBackend()  is there an ArozOS server? Gate anything that needs
                    storage, an AGI script or a user account on this.
      canConvert()  does this build carry the Office format code (mod/office)?
                    True in ArozOS, and true in the standalone build, which
                    always ships it as WebAssembly (src/wasm/office): it is
                    what opens and saves every document there.

    Run a conversion through convertIn / convertOut rather than reaching for
    either host's mechanism: they take one descriptor naming the AGI script
    and the wasm converter, and pick the right one.

    The mode comes from common/mode.js (window.OFFICE_STANDALONE), which the
    web-viewer generator rewrites in its output tree. Nothing else in the
    suite should test that flag: ask OfficePlatform instead.

    Load order: mode.js, recents.js, wasm.js, platform.js, office.js.

    Path shapes in standalone mode
    ------------------------------
      "local:/<name>"   a File the visitor picked - held in a registry for
                        the lifetime of the page
      "device:/<name>"  a save target: writing to it downloads the file
      "recent:/<id>"    a document kept in this browser by OfficeRecents
                        (IndexedDB), which is what ?recent=<id> opens
      anything else     a relative URL served next to the page (read only),
                        which is how ?open= and ?template= work (a template
                        is a plain envelope JSON file, templates/*.json)

    Query parameters the home page uses (see home/home.js):
      ?open=<relative path>      open that document
      ?template=<relative path>  start a new unsaved document from it
      ?recent=<id>               reopen one of this browser's recent documents
      ?request=<share link>      (standalone) open a public ArozOS share,
                                 optionally with &name=<file name>

    Requires: jquery, ../common/mode.js, ../common/wasm.js (standalone),
    (for ?request=) ../common/share.js and (in ArozOS mode)
    ../../script/ao_module.js
*/
var OfficePlatform = (function () {
    "use strict";

    var STANDALONE = (typeof window.OFFICE_STANDALONE !== "undefined") &&
        !!window.OFFICE_STANDALONE;

    /* ---------- small helpers (duplicated from OfficeApp: this file loads
       first, and they are three lines each) ---------- */
    function basename(p) {
        var s = String(p || "").replace(/\\/g, "/");
        var q = s.indexOf("?");
        if (q >= 0) s = s.substring(0, q);
        return s.substring(s.lastIndexOf("/") + 1);
    }
    function stripExt(p) {
        var i = String(p).lastIndexOf(".");
        return i < 0 ? String(p) : String(p).substring(0, i);
    }
    function now() { return new Date().getTime(); }
    function extOf(name) {
        var s = basename(name);
        var i = s.lastIndexOf(".");
        return i < 0 ? "" : s.substring(i).toLowerCase();
    }

    /* The suite's own formats, by extension: which app lives in each, the
       WebAssembly converter that opens and saves it, and its MIME type. */
    var NATIVE = {
        ".docx": { app: "document", wasm: "documentFile",
            mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
        ".xlsx": { app: "spreadsheet", wasm: "spreadsheetFile",
            mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
        ".pptx": { app: "presentation", wasm: "presentationFile",
            mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }
    };
    function nativeOf(name) { return NATIVE[extOf(name)] || null; }
    function extForApp(app) {
        for (var e in NATIVE) if (NATIVE[e].app === app) return e;
        return "";
    }

    /* gzip a string with the browser's own CompressionStream; cb(null) where
       there is none (the payload then goes uncompressed) */
    function gzipText(text, cb) {
        if (typeof CompressionStream !== "function" || typeof Response !== "function" ||
            typeof Blob !== "function") {
            cb(null);
            return;
        }
        try {
            var stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
            new Response(stream).blob().then(function (b) { cb(b); }, function () { cb(null); });
        } catch (e) { cb(null); }
    }
    function status(msg, type) {
        if (window.OfficeApp && OfficeApp.setStatus) OfficeApp.setStatus(msg, type);
    }
    function toast(msg, type) {
        if (window.OfficeApp && OfficeApp.toast) OfficeApp.toast(msg, type);
        else status(msg, type);
    }
    /*
        This page's path relative to the ArozOS web root ("Office/docs/
        index.html"), which is the form newFloatWindow wants. ao_root is the
        way back up to that root ("../../"), so the same number of trailing
        path segments is the way back down to here - and the app keeps
        working if the whole desktop is served from a sub-path.
    */
    function pagePath() {
        var parts = String(window.location.pathname).split("/")
            .filter(function (s) { return s.length > 0; });
        var up = (String(typeof ao_root === "string" ? ao_root : "").match(/\.\.\//g) || []).length;
        if (up > 0 && parts.length > up + 1) parts = parts.slice(parts.length - up - 1);
        return parts.join("/");
    }
    // a path relative to this page ("../img/docs.svg") in the same web-root
    // relative form ("Office/img/docs.svg")
    function pageRelative(rel) {
        var dir = pagePath().split("/");
        dir.pop();
        String(rel || "").split("/").forEach(function (seg) {
            if (!seg || seg === ".") return;
            if (seg === "..") { dir.pop(); return; }
            dir.push(seg);
        });
        return dir.join("/");
    }

    /* ================================================================
       ArozOS host
       ================================================================ */
    /* Working copies (pictures of the open documents, pictures dropped in
       before a save, oversized request payloads) live under tmp:/, which
       ArozOS empties nightly of anything a day old. Each editor window has
       its own folders, named by INSTANCE, and deletes them when it closes;
       see common/backend/document.agi. */
    var WORKDIR = "tmp:/.appdata/Office";
    var TMPDIR = WORKDIR + "/tmp";
    var INSTANCE = (Date.now().toString(36) +
        Math.random().toString(36).substring(2, 10)).replace(/[^a-z0-9]/g, "");
    var UPLOADS = WORKDIR + "/uploads/" + INSTANCE;
    // well inside the sweep's day, and throttled background timers still
    // manage it
    var KEEPALIVE_MS = 2 * 60 * 60 * 1000;
    var DOCUMENT_BACKEND = "Office/common/backend/document.agi";
    // only tiny blobs stay inline: an inline picture is base64 in the body,
    // which rides along on every save (pictures do not gzip), while an
    // uploaded one is a link the server reads - sent once, however often
    // the document is saved
    var DATAURL_MAX = 32 * 1024;
    var POST_INLINE_MAX = 4 * 1024 * 1024;   // stay well clear of the 10 MB form cap
    // past this a payload is gzipped and uploaded rather than form-posted:
    // a urlencoded JSON body is roughly twice its own size, a gzipped one a
    // fifth of it, and the upload is one extra round trip
    var COMPRESS_MIN = 64 * 1024;
    var workdirReady = false;
    var keepAliveTimer = null;
    var workdirReleased = false;

    /* An open window keeps its working copies from the nightly sweep, and
       lets them go when it closes - unless it closes with unsaved changes:
       the draft kept in this browser still links them, and the sweep will
       take them a day later. */
    function startKeepAlive() {
        if (keepAliveTimer || typeof ao_module_agirun !== "function") return;
        keepAliveTimer = setInterval(function () {
            ao_module_agirun(DOCUMENT_BACKEND, { action: "touch", instance: INSTANCE },
                function () { }, function () { });
        }, KEEPALIVE_MS);
        window.addEventListener("pagehide", function () {
            if (window.OfficeApp && OfficeApp.isDirty && OfficeApp.isDirty()) return;
            releaseWorkdir();
        });
    }
    /* The vpath behind a media?file= link, or "" */
    function linkVpath(src) {
        var m = /media\?file=([^&"'\s)]+)/.exec(String(src || ""));
        if (!m) return "";
        try { return decodeURIComponent(m[1]); } catch (e) { return ""; }
    }
    /* A link into another window's working copies - a picture copied from
       there. That window deletes its folders when it closes, so the picture
       has to become this window's own. */
    function isForeignWorkingCopy(src) {
        var vp = linkVpath(src);
        return vp.indexOf(WORKDIR + "/") === 0 && vp.indexOf("/" + INSTANCE + "/") < 0;
    }
    function releaseWorkdir() {
        if (workdirReleased || !keepAliveTimer) return;
        workdirReleased = true;
        clearInterval(keepAliveTimer);
        var url = (typeof ao_root === "string" ? ao_root : "../../") +
            "system/ajgi/interface?script=" + DOCUMENT_BACKEND;
        var form = new URLSearchParams({ action: "release", instance: INSTANCE });
        // a closing page cannot wait for an answer: a beacon still goes out
        try {
            if (navigator.sendBeacon && navigator.sendBeacon(url, form)) return;
        } catch (e) { }
        try { fetch(url, { method: "POST", body: form, keepalive: true, credentials: "same-origin" }); } catch (e) { }
    }

    var arozos = {
        name: "arozos",
        hasBackend: true,
        tracksRecents: true,
        autosavesToFile: true,
        // the office AGI lib is there whenever the host is
        canConvert: function () { return true; },

        /* One conversion to or from a foreign format (ODF), whichever
           direction. In this host both are an AGI call; spec.wasm is
           ignored. */
        convertIn: function (spec, srcRef, cb, errcb) {
            arozos.agirun(spec.agi, { action: spec.action, src: srcRef },
                function (data) {
                    if (!data || data.error) {
                        errcb((data && data.error) || "no response");
                        return;
                    }
                    cb(data.body);
                },
                function () { errcb("cannot reach the ArozOS backend"); }, 120000);
        },
        convertOut: function (spec, destRef, bodyJson, cb, errcb) {
            arozos.agirunLarge(spec.agi, {
                action: spec.action, dest: destRef, data: bodyJson
            }, "data", function (data) {
                // the pptx writer reports its media sidecar zip by vpath
                cb({ mediaZip: data && data.mediaZip ? basename(data.mediaZip) : null });
            }, errcb, 180000);
        },

        prepareWorkdir: function (cb, errcb) {
            if (workdirReady) { cb(); return; }
            ao_module_agirun(DOCUMENT_BACKEND, { action: "prepare", instance: INSTANCE }, function (data) {
                if (data && data.error) { if (errcb) errcb(data.error); return; }
                workdirReady = true;
                startKeepAlive();
                cb();
            }, function () {
                if (errcb) errcb("connection error");
            });
        },
        releaseWorkdir: function () { releaseWorkdir(); },

        agirun: function (script, params, cb, errcb, timeout) {
            ao_module_agirun(script, params, cb, errcb, timeout);
        },

        /* ---------- large AGI payloads ----------
           The AGI gateway reads its POST parameters with Go's r.ParseForm,
           which caps an application/x-www-form-urlencoded body at 10 MB.
           Past that the parse fails, EVERY parameter silently disappears and
           the still-uploading socket gets reset (the browser reports a plain
           network error). So a payload of any size worth mentioning is
           uploaded as a file through the system upload endpoint instead
           (streamed to disk server side rather than held in RAM) and handed
           to the script as a vpath in <field>File.

           That is also what makes a save cheap on a slow link: the upload is
           gzipped (CompressionStream) - a document body shrinks to a fifth
           or less, where urlencoding would have doubled it. The backend
           reads the file with office.readPayload, which gunzips it, and
           deletes it. Small payloads are simply posted. */
        agirunLarge: function (script, params, field, cb, errcb, timeout) {
            timeout = timeout || 0;
            errcb = errcb || function () { };
            var payload = params[field];
            var post = function (p) {
                ao_module_agirun(script, p, function (data) {
                    if (data && data.error) { errcb(data.error); return; }
                    cb(data);
                }, function () { errcb("connection error"); }, timeout);
            };
            if (typeof payload !== "string" || payload.length <= COMPRESS_MIN ||
                typeof ao_module_uploadFile !== "function") {
                post(params);
                return;
            }
            var upload = function (blob, name) {
                arozos.prepareWorkdir(function () {
                    var file;
                    try {
                        file = new File([blob], name, { type: blob.type || "application/octet-stream" });
                    } catch (e) { post(params); return; }
                    ao_module_uploadFile(file, TMPDIR, function (resp) {
                        if (typeof resp === "string" && resp.indexOf('"error"') >= 0) {
                            errcb("upload failed: " + resp);
                            return;
                        }
                        // hand over the vpath instead of the payload itself
                        var p = {};
                        Object.keys(params).forEach(function (k) {
                            if (k !== field) p[k] = params[k];
                        });
                        p[field + "File"] = TMPDIR + "/" + name;
                        post(p);
                    }, undefined, function () {
                        errcb("upload failed - the document is too large to send");
                    });
                }, function () { post(params); });
            };
            var stem = "post-" + Date.now().toString(36) + "-" +
                Math.random().toString(36).substring(2, 8);
            gzipText(payload, function (gz) {
                if (gz) { upload(gz, stem + ".json.gz"); return; }
                if (payload.length <= POST_INLINE_MAX) { post(params); return; }
                upload(new Blob([payload], { type: "application/json" }), stem + ".json");
            });
        },

        pickOpen: function (opts, cb) {
            try {
                ao_module_openFileSelector(function (files) {
                    if (files && files.length > 0) cb(files);
                }, opts.startDir || "user:/Desktop", "file", !!opts.multiple, {
                    filter: opts.filter,
                    path_memory_key: opts.memoryKey || "document"
                });
            } catch (e) {
                toast("File selector is not available here", "error");
            }
        },
        pickSave: function (opts, cb) {
            try {
                ao_module_openFileSelector(function (files) {
                    if (!files || !files.length) return;
                    var fp = files[0].filepath, fn = files[0].filename;
                    if (opts.ext && fn.toLowerCase().lastIndexOf(opts.ext.toLowerCase()) !==
                        fn.length - opts.ext.length) {
                        fp += opts.ext;
                        fn += opts.ext;
                    }
                    cb({ filepath: fp, filename: fn });
                }, opts.startDir || "user:/Desktop", "new", false, {
                    defaultName: opts.defaultName,
                    path_memory_key: opts.memoryKey || "document",
                    // a document that has never been saved has no folder of
                    // its own, so start from wherever this app was last used
                    force_path_overwrite: !!opts.forceOverwrite
                });
            } catch (e) {
                toast("File selector is not available here", "error");
            }
        },

        readText: function (path, cb, errcb) {
            // a template or a document published as a web asset is fetched
            // over HTTP in both hosts; only a vpath goes through the VFS
            if (!isVpath(path)) { readWebText(path, cb, errcb); return; }
            $.ajax({
                url: ao_root + "media?file=" + encodeURIComponent(path) + "&nocache=" + now(),
                dataType: "text",
                success: function (data) { cb(data); },
                error: function (xhr) { if (errcb) errcb(xhr); }
            });
        },
        writeText: function (path, content, cb, errcb) {
            arozos.agirunLarge("Office/common/backend/filesaver.agi", {
                filepath: path,
                content: content
            }, "content", function () {
                if (cb) cb();
            }, function (msg) {
                if (errcb) errcb(msg);
            });
        },

        /* Write bytes the client produced (the Slides PDF renderer is the
           one that needs this: only the browser knows how the text laid
           out). Base64 rides the same oversized-payload path every export
           uses, and the backend decodes it with office.writeBinaryFile. */
        writeBytes: function (path, bytes, cb, errcb) {
            var b64;
            try { b64 = bytesToBase64(bytes); }
            catch (e) { if (errcb) errcb("could not encode the file"); return; }
            arozos.agirunLarge("Office/common/backend/binsaver.agi", {
                filepath: path,
                content: b64
            }, "content", function () {
                if (cb) cb();
            }, function (msg) {
                if (errcb) errcb(msg);
            });
        },

        /* The suite's own open and save: a .docx / .xlsx / .pptx in the
           user's storage becomes the editor envelope and back
           (common/backend/document.agi -> office.loadDocument /
           office.saveDocument). Pictures stay links both ways - the server
           reads and extracts them, so they never cross the network as
           base64. */
        documentLoad: function (path, cb, errcb) {
            if (!isVpath(path)) {
                errcb("open documents from your ArozOS storage");
                return;
            }
            arozos.agirun(DOCUMENT_BACKEND, { action: "load", filepath: path, instance: INSTANCE }, function (data) {
                if (!data || data.error) {
                    errcb((data && data.error) || "no response");
                    return;
                }
                startKeepAlive();
                cb(data.envelope);
            }, function () { errcb("cannot reach the ArozOS backend"); }, 120000);
        },
        documentSave: function (path, envelopeJson, cb, errcb) {
            arozos.agirunLarge(DOCUMENT_BACKEND, {
                action: "save", filepath: path, content: envelopeJson
            }, "content", function () { cb(); }, errcb, 180000);
        },

        sessionSave: function (app, envelopeJson, cb, errcb) {
            arozos.agirunLarge(DOCUMENT_BACKEND, {
                action: "session-save", app: app, content: envelopeJson
            }, "content", cb || function () { }, errcb || function () { }, 60000);
        },
        sessionLoad: function (app, cb) {
            arozos.agirun(DOCUMENT_BACKEND, { action: "session-load", app: app, instance: INSTANCE },
                function (data) {
                    if (data && data.envelope) startKeepAlive();
                    cb(data && data.envelope);
                },
                function () { cb(null); }, 60000);
        },
        sessionDelete: function (app) {
            arozos.agirun(DOCUMENT_BACKEND, { action: "session-delete", app: app },
                function () { }, function () { }, 60000);
        },

        // page-relative form matching what office.loadDocument writes; the
        // server reads the file behind it at save time
        mediaUrl: function (vpath) {
            return "../../media?file=" + encodeURIComponent(vpath);
        },

        /* Turn a Blob/File into a document-storable src string. Small blobs
           stay inline data URLs; anything bigger is streamed to the Office
           working directory through the system upload endpoint and
           referenced by a media?file= link (the server reads it into the
           file at save time). */
        blobToSrc: function (blob, filename, cb, errcb) {
            if (blob.size <= DATAURL_MAX) {
                readAsDataURL(blob, cb, errcb || function (msg) { status(msg, "error"); });
                return;
            }
            arozos.cacheBlob(blob, filename, cb, errcb);
        },
        /* The same, whatever the size: a render the editor makes for saving
           (a chart as PNG, a video's poster frame) is uploaded once and
           linked, so it is not sent again with every save. */
        cacheBlob: function (blob, filename, cb, errcb) {
            errcb = errcb || function (msg) { status(msg, "error"); };
            var asDataURL = function (failMsg) {
                // inline fallback only for small payloads - big base64 blobs
                // would make every save carry them
                if (blob.size > 8 * 1024 * 1024) {
                    errcb(failMsg || "File is too large to embed without an ArozOS backend");
                    return;
                }
                readAsDataURL(blob, cb, errcb);
            };
            if (typeof ao_module_uploadFile !== "function") { asDataURL(); return; }
            arozos.prepareWorkdir(function () {
                var safe = String(filename || "media").replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 80);
                var name = Date.now().toString(36) + "-" + safe;
                var file;
                try {
                    file = new File([blob], name, { type: blob.type || "application/octet-stream" });
                } catch (e) { asDataURL(); return; }
                ao_module_uploadFile(file, UPLOADS,
                    function (resp) {
                        if (typeof resp === "string" && resp.indexOf('"error"') >= 0) {
                            errcb("Upload failed: " + resp);
                            return;
                        }
                        cb(arozos.mediaUrl(UPLOADS + "/" + name));
                    },
                    undefined,
                    function () { asDataURL("Upload failed and the file is too large to embed"); });
            }, function () { asDataURL(); });
        },

        /* A pasted picture that links into another window's working copies
           is copied into this window's own (cb gets the new src, or the old
           one when the copy fails - it still works while that window is
           open). Anything else is returned as it is. */
        adoptSrc: function (src, cb) {
            if (!isForeignWorkingCopy(src) || typeof fetch !== "function") { cb(src); return; }
            var name = linkVpath(src).split("/").pop() || "picture.png";
            fetch(src, { credentials: "same-origin" }).then(function (r) {
                if (!r.ok) throw new Error("HTTP " + r.status);
                return r.blob();
            }).then(function (blob) {
                arozos.cacheBlob(blob, name, cb, function () { cb(src); });
            }).catch(function () { cb(src); });
        },
        isForeignWorkingCopy: isForeignWorkingCopy,

        loadInputFiles: function (ext) {
            // a ?template= / ?open= / ?recent= link is answered the same way
            // in both hosts; otherwise ask the desktop what it opened us with
            var entry = entryPointFiles(ext);
            if (entry) return entry;
            try { return ao_module_loadInputFiles(); } catch (e) { return null; }
        },
        /* Open a document in a second window of this same app - the desktop
           launches another floatWindow, a plain browser tab another tab. The
           file is handed over the same way the desktop hands one to an
           opened-with app: the hash carries the input file list. */
        openDocument: function (filepath, filename, opts) {
            opts = opts || {};
            var hash = "#" + encodeURIComponent(JSON.stringify(
                [{ filepath: filepath, filename: filename }]));
            try {
                ao_module_newfw({
                    url: pagePath() + hash,
                    title: filename,
                    appicon: opts.appIcon ? pageRelative(opts.appIcon) : undefined,
                    width: opts.width || 1080,
                    height: opts.height || 700
                });
                return true;
            } catch (e) { return false; }
        },
        setWindowTitle: function (t) {
            try { ao_module_setWindowTitle(t); } catch (e) { document.title = t; }
        },
        setWindowTheme: function (dark) {
            try { ao_module_setWindowTheme(dark ? "dark" : "white"); } catch (e) { }
        }
    };

    /* ================================================================
       Standalone host (static hosting, no server)
       ================================================================ */
    // blobs may be inlined generously here - nothing has to survive a POST
    var STANDALONE_INLINE_MAX = 24 * 1024 * 1024;
    var SESSION_MAX = 4 * 1024 * 1024;   // localStorage is ~5 MB per origin
    var localFiles = {};                 // "local:/<name>" -> File
    var sharedFiles = {};                // "share:/<name>" -> preview URL

    function readAsDataURL(blob, cb, errcb) {
        var reader = new FileReader();
        reader.onload = function () { cb(reader.result); };
        reader.onerror = function () { errcb("Could not read the file"); };
        reader.readAsDataURL(blob);
    }
    function readAsText(blob, cb, errcb) {
        var reader = new FileReader();
        reader.onload = function () { cb(reader.result); };
        reader.onerror = function () { errcb("Could not read the file"); };
        reader.readAsText(blob);
    }
    function readAsBytes(blob, cb, errcb) {
        var reader = new FileReader();
        reader.onload = function () { cb(new Uint8Array(reader.result)); };
        reader.onerror = function () { errcb("Could not read the file"); };
        reader.readAsArrayBuffer(blob);
    }
    /* Fetch a document served next to the page. Only relative paths are
       accepted: a document is meant to sit in the viewer's own folder, and
       refusing absolute URLs keeps ?open= from being turned into a fetch of
       somewhere else. */
    function fetchRelative(url, responseType, cb, errcb) {
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) || url.indexOf("//") === 0) {
            errcb("only documents served next to this page can be opened by link");
            return;
        }
        var xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);
        if (responseType) xhr.responseType = responseType;
        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) {
                cb(responseType === "arraybuffer" ? new Uint8Array(xhr.response) : xhr.responseText);
            } else {
                errcb("HTTP " + xhr.status);
            }
        };
        xhr.onerror = function () { errcb("network error"); };
        xhr.send();
    }
    /* base64 in chunks: String.fromCharCode.apply on a multi-megabyte
       array blows the argument limit */
    function bytesToBase64(bytes) {
        var arr = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes);
        var CHUNK = 0x8000;
        var parts = [];
        for (var i = 0; i < arr.length; i += CHUNK) {
            parts.push(String.fromCharCode.apply(null, arr.subarray(i, i + CHUNK)));
        }
        return btoa(parts.join(""));
    }

    function download(bytesOrText, filename, mime) {
        var blob = (bytesOrText instanceof Uint8Array)
            ? new Blob([bytesOrText], { type: mime || "application/octet-stream" })
            : new Blob([bytesOrText], { type: (mime || "text/plain") + ";charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = filename || "document";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 8000);
    }
    function acceptFromFilter(filter) {
        if (!filter || !filter.length) return "";
        return filter.map(function (e) {
            return e.charAt(0) === "." ? e : ("." + e);
        }).join(",");
    }
    function sessionKey(app) {
        return "officeSession_" + String(app || "app").replace(/[^a-zA-Z0-9_-]/g, "");
    }
    // a server-only feature reached in standalone mode: say so once, plainly
    function noBackend(what) {
        toast((what || "That") + " needs an ArozOS server - this is the " +
            "standalone web edition", "error");
    }
    var NO_CONVERTER = "this build has no converter for that format";
    var NO_WASM = "this build was made without the Office format code, so it cannot open or save documents";
    var RECENT_PREFIX = "recent:/";
    var SHARE_PREFIX = "share:/";

    /*
        A virtual path names something a host owns - "user:/Desktop/a.docx" in
        ArozOS, "local:/", "device:/" and "recent:/" in the browser. Anything
        else is a plain relative URL served by whatever web server is in front
        of the suite, and is read over HTTP. That is what lets templates/
        work identically whether or not there is an ArozOS behind the page.
    */
    function isVpath(p) {
        return /^[a-zA-Z][a-zA-Z0-9_+.-]*:\//.test(String(p || ""));
    }

    /*
        Entry points a link (or the home page) can use to point an app at
        something, in either host:

          ?open=<relative path>      open a document published next to the app
          ?template=<relative path>  start a NEW unsaved document from it, so
                                     Save asks for a name instead of writing
                                     back over the template
          ?recent=<id>               reopen a document this browser kept
                                     (OfficeRecents)

        Relative paths only - fetchRelative refuses anything with a scheme, so
        none of these can be turned into a fetch of another site.

        The one deliberate exception, standalone only:

          ?request=<share link>[&name=<file name>]
                                     open a document from a public ArozOS
                                     share. OfficeShare.parse only accepts a
                                     share path and rewrites it to that
                                     server's preview endpoint, so this is
                                     not a general fetch either. The home
                                     page normally takes these links itself
                                     (it can tell which app a document is
                                     for) and only falls back to sending one
                                     here when it cannot keep the file.

        ext is the calling app's own extension; a share link does not carry
        the file name, and the document is only opened as one when the name
        says it is.
    */
    function entryPointFiles(ext) {
        var q = window.location.search || "";
        var param = function (name) {
            var m = new RegExp("[?&]" + name + "=([^&]+)").exec(q);
            if (!m) return null;
            try { return decodeURIComponent(m[1]) || null; } catch (e) { return null; }
        };

        var recent = param("recent");
        if (recent) {
            var name = "";
            if (window.OfficeRecents) {
                OfficeRecents.index().forEach(function (e) {
                    if (e.id === recent) name = e.name;
                });
            }
            if (!name) return null;   // gone from this browser: start blank
            return [{ filepath: RECENT_PREFIX + recent, filename: name }];
        }

        var tpl = param("template");
        if (tpl) return [{ filepath: tpl, filename: basename(tpl), asTemplate: true }];

        var request = param("request");
        if (request && STANDALONE && window.OfficeShare) {
            var info;
            try { info = OfficeShare.parse(request); }
            catch (e) { toast(e.message, "error"); return null; }
            var app = NATIVE[ext] ? NATIVE[ext].app : "";
            var shareName = OfficeShare.fileName(app, [param("name"), info.nameHint]);
            var sharePath = SHARE_PREFIX + shareName;
            sharedFiles[sharePath] = info.previewUrl;
            return [{ filepath: sharePath, filename: shareName }];
        }

        var open = param("open");
        if (open) return [{ filepath: open, filename: basename(open) }];
        return null;
    }

    /*
        The name a document should be written out under. Normally that is the
        last path segment - but a document reopened from the recent list has
        the path "recent:/<id>", and an id is not a filename: saving one has
        to produce "My Report.docx", not "mtm6gu3c-bn7mpk". The recent index
        is the only thing that knows, so ask it.
    */
    function saveName(path) {
        if (String(path).indexOf(RECENT_PREFIX) === 0 && window.OfficeRecents) {
            var id = String(path).substring(RECENT_PREFIX.length);
            var found = "";
            OfficeRecents.index().forEach(function (e) {
                if (e.id === id) found = e.name;
            });
            if (found) return found;
        }
        return basename(path);
    }

    // read bytes for a path no host owns: a relative URL, or this browser's
    // own recent-document store
    function readWebBytes(path, cb, errcb) {
        if (path.indexOf(RECENT_PREFIX) === 0) {
            if (!window.OfficeRecents) { errcb("recent documents are not available here"); return; }
            OfficeRecents.load(path.substring(RECENT_PREFIX.length), cb, errcb);
            return;
        }
        if (sharedFiles[path]) {
            OfficeShare.fetch(sharedFiles[path], function (bytes) { cb(bytes); }, errcb);
            return;
        }
        fetchRelative(path, "arraybuffer", cb, errcb);
    }
    function readWebText(path, cb, errcb) {
        if (path.indexOf(RECENT_PREFIX) === 0) {
            readWebBytes(path, function (bytes) {
                cb(new TextDecoder("utf-8").decode(bytes));
            }, errcb);
            return;
        }
        fetchRelative(path, "", cb, errcb);
    }

    // Templates live in the site's own templates/ folder and are scaffolds,
    // not the visitor's documents: opening one must not push it into the
    // recent list, and Save must ask for a name rather than overwrite it.
    function isTemplatePath(path) {
        return /(^|\/)templates\//.test(String(path || ""));
    }

    /*
        Keep a copy of the document in this browser so the home page can
        offer it again after a reload. Best-effort throughout: recents are a
        convenience, and a full quota or a private window must never break
        opening or saving.
    */
    function keepRecent(name, bytes) {
        if (!name || !bytes || !window.OfficeRecents || !OfficeRecents.supported()) return;
        var app = nativeOf(name) ? nativeOf(name).app : "";
        var dot = name.lastIndexOf(".");
        OfficeRecents.remember({
            name: name,
            app: app,
            ext: dot < 0 ? "" : name.substring(dot).toLowerCase(),
            bytes: bytes
        }, function () { }, function () { /* over quota or unavailable: skip */ });
    }

    var standalone = {
        name: "standalone",
        hasBackend: false,
        // recents point at File objects that die with the page, and autosave
        // would mean a download every 25 seconds
        tracksRecents: false,
        autosavesToFile: false,

        // the build ships the WebAssembly module (generate.go always adds it)
        canConvert: function () {
            return !!(window.OfficeWasm && OfficeWasm.available());
        },

        /* The converters are the same Go code the AGI backends run, compiled
           to WebAssembly (src/wasm/office). The module is a few MB, so it is
           fetched the first time a document is opened or saved, not at page
           load - the caller's busy overlay covers the wait. */
        convertIn: function (spec, srcRef, cb, errcb) {
            if (!spec.wasm) { errcb(NO_CONVERTER); return; }
            standalone.readBytes(srcRef, function (bytesIn) {
                OfficeWasm.runImport(spec.wasm, bytesIn, cb, errcb);
            }, function (msg) { errcb("could not read the file: " + msg); });
        },
        convertOut: function (spec, destRef, bodyJson, cb, errcb) {
            if (!spec.wasm) { errcb(NO_CONVERTER); return; }
            OfficeWasm.runExport(spec.wasm, bodyJson, function (res) {
                var name = saveName(destRef);
                try {
                    download(res.data, name, "application/octet-stream");
                } catch (e) {
                    errcb(e.message || "download failed");
                    return;
                }
                cb({ mediaZip: null });
            }, errcb);
        },

        prepareWorkdir: function (cb) { cb(); },
        releaseWorkdir: function () { },
        adoptSrc: function (src, cb) { cb(src); },
        isForeignWorkingCopy: function () { return false; },

        agirun: function (script, params, cb, errcb) {
            if (errcb) errcb("no ArozOS backend in the standalone web edition");
        },
        agirunLarge: function (script, params, field, cb, errcb) {
            if (errcb) errcb("no ArozOS backend in the standalone web edition");
        },

        pickOpen: function (opts, cb) {
            var input = document.createElement("input");
            input.type = "file";
            if (opts.multiple) input.multiple = true;
            var accept = acceptFromFilter(opts.filter);
            if (accept) input.accept = accept;
            input.style.display = "none";
            document.body.appendChild(input);
            input.addEventListener("change", function () {
                var picked = Array.prototype.slice.call(input.files || []);
                document.body.removeChild(input);
                if (!picked.length) return;
                cb(picked.map(function (f) {
                    var p = "local:/" + f.name;
                    localFiles[p] = f;
                    return { filepath: p, filename: f.name, file: f };
                }));
            });
            input.click();
        },
        /*
            There is no file system to browse, so "where to save" is just a
            name: the write itself is a browser download into whatever the
            visitor's browser calls its downloads folder.
        */
        pickSave: function (opts, cb) {
            var def = opts.defaultName || "document";
            var ask = function (label, defVal, done) {
                if (window.OfficeApp && OfficeApp.prompt) OfficeApp.prompt("Download as", label, defVal, done);
                else done(window.prompt(label, defVal));
            };
            ask("File name", def, function (name) {
                if (!name) return;
                name = String(name).replace(/[\\/:*?"<>|]/g, "_").trim();
                if (!name) return;
                if (opts.ext && name.toLowerCase().lastIndexOf(opts.ext.toLowerCase()) !==
                    name.length - opts.ext.length) {
                    name += opts.ext;
                }
                cb({ filepath: "device:/" + name, filename: name });
            });
        },

        readText: function (path, cb, errcb) {
            errcb = errcb || function () { };
            var f = localFiles[path];
            if (f) { readAsText(f, cb, errcb); return; }
            readWebText(path, cb, errcb);
        },
        readBytes: function (path, cb, errcb) {
            errcb = errcb || function () { };
            var f = localFiles[path];
            if (f) { readAsBytes(f, cb, errcb); return; }
            readWebBytes(path, cb, errcb);
        },
        writeText: function (path, content, cb, errcb) {
            try {
                download(content, saveName(path), "text/plain");
                if (cb) cb();
            } catch (e) {
                if (errcb) errcb(e.message || "download failed");
            }
        },
        writeBytes: function (path, bytes, cb, errcb) {
            try {
                download(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
                    saveName(path), "application/octet-stream");
                if (cb) cb();
            } catch (e) {
                if (errcb) errcb(e.message || "download failed");
            }
        },

        /* The suite's own open and save, run by the WebAssembly module: the
           file's bytes become the envelope (pictures inline as data URLs -
           there is no file system to link into) and the envelope becomes the
           file, handed over as a download. Both keep a copy in this
           browser's recent documents. */
        documentLoad: function (path, cb, errcb) {
            var name = saveName(path);
            var nat = nativeOf(name);
            if (!nat) { errcb("not a .docx, .xlsx or .pptx file"); return; }
            if (!standalone.canConvert()) { errcb(NO_WASM); return; }
            standalone.readBytes(path, function (bytes) {
                OfficeWasm.runImport(nat.wasm, bytes, function (envelope) {
                    // opening a document is what puts it in "recently opened";
                    // reopening one already there only moves it up the list
                    if (String(path).indexOf(RECENT_PREFIX) === 0) {
                        if (window.OfficeRecents) OfficeRecents.touch(path.substring(RECENT_PREFIX.length));
                    } else if (!isTemplatePath(path)) {
                        keepRecent(name, bytes);
                    }
                    cb(envelope);
                }, errcb);
            }, function (msg) { errcb("could not read the file: " + msg); });
        },
        documentSave: function (path, envelopeJson, cb, errcb) {
            var name = saveName(path);
            var nat = nativeOf(name);
            if (!nat) { errcb("documents are saved as .docx, .xlsx or .pptx"); return; }
            if (!standalone.canConvert()) { errcb(NO_WASM); return; }
            OfficeWasm.runExport(nat.wasm, envelopeJson, function (res) {
                try {
                    download(res.data, name, nat.mime);
                } catch (e) {
                    errcb(e.message || "download failed");
                    return;
                }
                // a saved document is the one most worth having in recents: the
                // download leaves the browser's hands, this copy does not
                keepRecent(name, res.data);
                cb();
            }, errcb);
        },

        /* The session snapshot is the crash net, so it stays inside the
           browser: localStorage, skipped when the document outgrows the
           per-origin quota (the plain draft in OfficeApp does the same). */
        sessionSave: function (app, envelopeJson, cb) {
            try {
                if (envelopeJson.length <= SESSION_MAX) {
                    localStorage.setItem(sessionKey(app), envelopeJson);
                }
            } catch (e) { /* quota or private mode: the draft still covers us */ }
            if (cb) cb();
        },
        sessionLoad: function (app, cb) {
            var raw = null;
            try { raw = localStorage.getItem(sessionKey(app)); } catch (e) { }
            cb(raw);
        },
        sessionDelete: function (app) {
            try { localStorage.removeItem(sessionKey(app)); } catch (e) { }
        },

        mediaUrl: function () {
            // nothing to link to: the storage pickers are hidden in this mode
            return "";
        },
        blobToSrc: function (blob, filename, cb, errcb) {
            standalone.cacheBlob(blob, filename, cb, errcb);
        },
        // nowhere to upload to: a render made for saving stays inline
        cacheBlob: function (blob, filename, cb, errcb) {
            errcb = errcb || function (msg) { status(msg, "error"); };
            if (blob.size > STANDALONE_INLINE_MAX) {
                errcb("File is too large for the standalone web edition (max " +
                    Math.round(STANDALONE_INLINE_MAX / 1048576) + " MB)");
                return;
            }
            readAsDataURL(blob, cb, errcb);
        },

        loadInputFiles: entryPointFiles,
        setWindowTitle: function (t) { document.title = t; },
        setWindowTheme: function () { },
        /* Saving here is a download, so there is no path a second window
           could be pointed at - the caller says so instead. */
        openDocument: function () { return false; },

        /* A File that arrived by drag and drop rather than through a picker:
           register it the same way pickOpen does, then hand the caller the
           path it now answers to. */
        adoptDroppedFile: function (file, cb) {
            var p = "local:/" + file.name;
            localFiles[p] = file;
            cb(p, file.name);
        }
    };

    /* ================================================================
       Chosen host
       ================================================================ */
    var host = STANDALONE ? standalone : arozos;

    // Uniform "this needs a server" guard for the apps' menu entries: they
    // gate on hasBackend() so the item is absent rather than failing late.
    function requireBackend(what) {
        if (host.hasBackend) return true;
        noBackend(what);
        return false;
    }
    /* The matching guard for the Office interchange formats. A standalone
       build made without -wasm has no converters at all, which is a
       different thing from having no server - so it says so differently. */
    function requireConvert(what) {
        if (host.canConvert()) return true;
        toast((what || "That") + " needs the Office format converters, which " +
            "this build does not include", "error");
        return false;
    }

    return {
        mode: function () { return host.name; },
        isStandalone: function () { return !host.hasBackend; },
        hasBackend: function () { return host.hasBackend; },
        canConvert: function () { return host.canConvert(); },
        tracksRecents: function () { return host.tracksRecents; },
        autosavesToFile: function () { return host.autosavesToFile; },
        requireBackend: requireBackend,
        requireConvert: requireConvert,

        /* Foreign formats (ODF), whichever host is running.
           spec = { agi: "<backend .agi path>", action: "<agi action>",
                    wasm: "<converter name from src/wasm/office>" }
           convertIn  -> cb(bodyJsonString)
           convertOut -> cb({mediaZip: <name or null>}) */
        convertIn: function (spec, srcRef, cb, errcb) {
            host.convertIn(spec, srcRef, cb, errcb || function () { });
        },
        convertOut: function (spec, destRef, bodyJson, cb, errcb) {
            host.convertOut(spec, destRef, bodyJson, cb, errcb || function () { });
        },

        pickOpen: function (o, cb) { host.pickOpen(o || {}, cb); },
        pickSave: function (o, cb) { host.pickSave(o || {}, cb); },

        readText: function (p, cb, errcb) { host.readText(p, cb, errcb); },
        writeText: function (p, c, cb, errcb) { host.writeText(p, c, cb, errcb); },
        // a file the client rendered itself (the Slides PDF); bytes is a
        // Uint8Array, and the standalone host turns it into a download
        writeBytes: function (p, b, cb, errcb) { host.writeBytes(p, b, cb, errcb); },

        // the suite's own .docx / .xlsx / .pptx: file <-> envelope JSON
        documentLoad: function (p, cb, errcb) { host.documentLoad(p, cb, errcb || function () { }); },
        documentSave: function (p, j, cb, errcb) { host.documentSave(p, j, cb, errcb || function () { }); },
        nativeExtension: extForApp,

        sessionSave: function (a, j, cb, errcb) { host.sessionSave(a, j, cb, errcb); },
        sessionLoad: function (a, cb) { host.sessionLoad(a, cb); },
        sessionDelete: function (a) { host.sessionDelete(a); },

        agirun: function (s, p, cb, errcb, t) { host.agirun(s, p, cb, errcb, t); },
        agirunLarge: function (s, p, f, cb, errcb, t) { host.agirunLarge(s, p, f, cb, errcb, t); },
        prepareWorkdir: function (cb, errcb) { host.prepareWorkdir(cb, errcb); },
        // the window is closing for good: drop its working copies
        releaseWorkdir: function () { host.releaseWorkdir(); },
        // a pasted picture from another window becomes this window's own
        adoptSrc: function (src, cb) { host.adoptSrc(src, cb); },
        isForeignWorkingCopy: function (src) { return host.isForeignWorkingCopy(src); },

        mediaUrl: function (v) { return host.mediaUrl(v); },
        blobToSrc: function (b, n, cb, errcb) { host.blobToSrc(b, n, cb, errcb); },
        // a render made for saving (chart PNG, poster frame): a link in
        // ArozOS, so later saves do not carry it again
        cacheBlob: function (b, n, cb, errcb) { host.cacheBlob(b, n, cb, errcb); },

        // ext: the calling app's native extension, which names a document
        // opened from a share link that did not say what it is called
        loadInputFiles: function (ext) { return host.loadInputFiles(ext); },
        // open a document in a second window of this app; false = this host
        // has nowhere to open it from (the standalone build saves by download)
        openDocument: function (fp, fn, o) { return !!host.openDocument(fp, fn, o || {}); },
        adoptDroppedFile: function (f, cb) {
            if (host.adoptDroppedFile) host.adoptDroppedFile(f, cb);
        },
        setWindowTitle: function (t) { host.setWindowTitle(t); },
        setWindowTheme: function (d) { host.setWindowTheme(d); }
    };
})();
