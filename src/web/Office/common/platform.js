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
                    page, native containers are packed and unpacked in the
                    browser by OfficeContainer, and saving hands the file
                    back as a download.

    Two separate capability questions, deliberately not one:

      hasBackend()  is there an ArozOS server? Gate anything that needs
                    storage, an AGI script or a user account on this.
      canConvert()  can this build convert the Office interchange formats
                    (.docx / .xlsx / .pptx / ODF)? True in ArozOS, and true
                    in a standalone build shipped with the WebAssembly
                    converters (src/wasm/office, loaded by common/wasm.js).
                    Import/export menu entries gate on this.

    Run a conversion through convertIn / convertOut rather than reaching for
    either host's mechanism: they take one descriptor naming the AGI script
    and the wasm converter, and pick the right one.

    The mode comes from common/mode.js (window.OFFICE_STANDALONE), which the
    web-viewer generator rewrites in its output tree. Nothing else in the
    suite should test that flag: ask OfficePlatform instead.

    Load order: mode.js, container.js, platform.js, office.js.

    Path shapes in standalone mode
    ------------------------------
      "local:/<name>"   a File the visitor picked - held in a registry for
                        the lifetime of the page
      "device:/<name>"  a save target: writing to it downloads the file
      "recent:/<id>"    a document kept in this browser by OfficeRecents
                        (IndexedDB), which is what ?recent=<id> opens
      anything else     a relative URL served next to the page (read only),
                        which is how ?open= and ?template= work

    Query parameters the home page uses (see home/home.js):
      ?open=<relative path>      open that document
      ?template=<relative path>  start a new unsaved document from it
      ?recent=<id>               reopen one of this browser's recent documents

    Requires: jquery, ../common/mode.js, ../common/container.js and (in
    ArozOS mode) ../../script/ao_module.js
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
    var WORKDIR = "user:/.appdata/Office";
    var TMPDIR = WORKDIR + "/tmp";
    var CONTAINER_BACKEND = "Office/common/backend/container.agi";
    var DATAURL_MAX = 1024 * 1024;      // blobs under 1 MB may stay inline
    var POST_INLINE_MAX = 4 * 1024 * 1024;   // stay well clear of the 10 MB form cap
    var workdirReady = false;

    var arozos = {
        name: "arozos",
        hasBackend: true,
        tracksRecents: true,
        autosavesToFile: true,
        // the office AGI lib is there whenever the host is
        canConvert: function () { return true; },

        /* One conversion, whichever direction. In this host both are the AGI
           call the app used to make by hand; spec.wasm is ignored. */
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
            ao_module_agirun(CONTAINER_BACKEND, { action: "prepare" }, function (data) {
                if (data && data.error) { if (errcb) errcb(data.error); return; }
                workdirReady = true;
                cb();
            }, function () {
                if (errcb) errcb("connection error");
            });
        },

        agirun: function (script, params, cb, errcb, timeout) {
            ao_module_agirun(script, params, cb, errcb, timeout);
        },

        /* ---------- large AGI payloads ----------
           The AGI gateway reads its POST parameters with Go's r.ParseForm,
           which caps an application/x-www-form-urlencoded body at 10 MB.
           Past that the parse fails, EVERY parameter silently disappears and
           the still-uploading socket gets reset (the browser reports a plain
           network error). Export payloads cross that line easily once images
           and chart bitmaps are inlined as data URLs, so anything bigger
           than POST_INLINE_MAX is streamed to a temp file through the system
           upload endpoint (buffered to disk server side instead of being
           held in RAM) and handed to the script as a vpath in <field>File.
           The backend script reads that file and deletes it. */
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
            if (typeof payload !== "string" || payload.length <= POST_INLINE_MAX ||
                typeof ao_module_uploadFile !== "function") {
                post(params);
                return;
            }
            arozos.prepareWorkdir(function () {
                var name = "post-" + Date.now().toString(36) + "-" +
                    Math.random().toString(36).substring(2, 8) + ".json";
                var file;
                try {
                    file = new File([new Blob([payload], { type: "application/json" })],
                        name, { type: "application/json" });
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

        containerLoad: function (path, cb, errcb) {
            // templates and ?open= documents are web assets: read and unpack
            // them here rather than asking the backend for a vpath it has no
            // way to resolve
            if (!isVpath(path)) { webContainerLoad(path, cb, errcb); return; }
            arozos.agirun(CONTAINER_BACKEND, { action: "load", filepath: path }, function (data) {
                if (!data || data.error) {
                    errcb((data && data.error) || "no response");
                    return;
                }
                cb(data.envelope);
            }, function () { errcb("cannot reach the ArozOS backend"); }, 120000);
        },
        containerSave: function (path, envelopeJson, cb, errcb) {
            arozos.agirunLarge(CONTAINER_BACKEND, {
                action: "save", filepath: path, content: envelopeJson
            }, "content", function () { cb(); }, errcb, 120000);
        },

        sessionSave: function (app, envelopeJson, cb, errcb) {
            arozos.agirunLarge(CONTAINER_BACKEND, {
                action: "session-save", app: app, content: envelopeJson
            }, "content", cb || function () { }, errcb || function () { }, 60000);
        },
        sessionLoad: function (app, cb) {
            arozos.agirun(CONTAINER_BACKEND, { action: "session-load", app: app },
                function (data) { cb(data && data.envelope); },
                function () { cb(null); }, 60000);
        },
        sessionDelete: function (app) {
            arozos.agirun(CONTAINER_BACKEND, { action: "session-delete", app: app },
                function () { }, function () { }, 60000);
        },

        // page-relative form matching what the server-side unpacker writes;
        // the packer recognizes it and embeds the file at save time
        mediaUrl: function (vpath) {
            return "../../media?file=" + encodeURIComponent(vpath);
        },

        /* Turn a Blob/File into a document-storable src string. Small blobs
           stay inline data URLs; anything bigger is streamed to the Office
           working directory through the system upload endpoint and
           referenced by a media?file= link (packToFile embeds it into the
           container at save time). */
        blobToSrc: function (blob, filename, cb, errcb) {
            errcb = errcb || function (msg) { status(msg, "error"); };
            var asDataURL = function (failMsg) {
                // inline fallback only for small payloads - big base64 blobs
                // would break the save POST again
                if (blob.size > 8 * 1024 * 1024) {
                    errcb(failMsg || "File is too large to embed without an ArozOS backend");
                    return;
                }
                readAsDataURL(blob, cb, errcb);
            };
            if (blob.size <= DATAURL_MAX) { asDataURL(); return; }
            if (typeof ao_module_uploadFile !== "function") { asDataURL(); return; }
            arozos.prepareWorkdir(function () {
                var safe = String(filename || "media").replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 80);
                var name = Date.now().toString(36) + "-" + safe;
                var file;
                try {
                    file = new File([blob], name, { type: blob.type || "application/octet-stream" });
                } catch (e) { asDataURL(); return; }
                ao_module_uploadFile(file, WORKDIR + "/uploads",
                    function (resp) {
                        if (typeof resp === "string" && resp.indexOf('"error"') >= 0) {
                            errcb("Upload failed: " + resp);
                            return;
                        }
                        cb(arozos.mediaUrl(WORKDIR + "/uploads/" + name));
                    },
                    undefined,
                    function () { asDataURL("Upload failed and the file is too large to embed"); });
            }, function () { asDataURL(); });
        },

        loadInputFiles: function () {
            // a ?template= / ?open= / ?recent= link is answered the same way
            // in both hosts; otherwise ask the desktop what it opened us with
            var entry = entryPointFiles();
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
    var RECENT_PREFIX = "recent:/";

    /*
        A virtual path names something a host owns - "user:/Desktop/a.doca" in
        ArozOS, "local:/", "device:/" and "recent:/" in the browser. Anything
        else is a plain relative URL served by whatever web server is in front
        of the suite, and is read the same way in both hosts: over HTTP, and
        unpacked client-side. That is what lets templates/ and ?open= work
        identically whether or not there is an ArozOS behind the page.
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
    */
    function entryPointFiles() {
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

        var open = param("open");
        if (open) return [{ filepath: open, filename: basename(open) }];
        return null;
    }

    /*
        The name a document should be written out under. Normally that is the
        last path segment - but a document reopened from the recent list has
        the path "recent:/<id>", and an id is not a filename: saving one has
        to produce "My Report.doca", not "mtm6gu3c-bn7mpk". The recent index
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
        fetchRelative(path, "arraybuffer", cb, errcb);
    }
    /* Read a native container that is not a host's own file - a template, a
       ?open= document, or one of this browser's recent documents - and unpack
       it here. Both hosts use this; only ArozOS storage goes to the backend. */
    function webContainerLoad(path, cb, errcb) {
        readWebBytes(path, function (bytes) {
            var envelope;
            try {
                envelope = OfficeContainer.unpack(bytes);
            } catch (e) {
                errcb(e.message || "unreadable document");
                return;
            }
            // opening a document is what puts it in "recently opened";
            // reopening one already there only moves it up the list, and a
            // template is a starting point rather than a document the visitor
            // has worked on, so it is not remembered at all
            if (path.indexOf(RECENT_PREFIX) === 0) {
                if (window.OfficeRecents) OfficeRecents.touch(path.substring(RECENT_PREFIX.length));
            } else if (!isTemplatePath(path)) {
                keepRecent(basename(path), envelope, bytes);
            }
            cb(envelope);
        }, errcb);
    }
    function readWebText(path, cb, errcb) {
        if (path.indexOf(RECENT_PREFIX) === 0) {
            readWebBytes(path, function (bytes) {
                cb(OfficeContainer.utf8Decode(bytes));
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
        opening or saving. envelope may be the JSON string or the parsed
        object - it is read only for the app type.
    */
    function keepRecent(name, envelope, bytes) {
        if (!name || !bytes || !window.OfficeRecents || !OfficeRecents.supported()) return;
        var app = "";
        try {
            var env = (typeof envelope === "string") ? JSON.parse(envelope) : envelope;
            app = (env && env.app) || "";
        } catch (e) { app = ""; }
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

        // only when the build shipped the WebAssembly converters
        canConvert: function () {
            return !!(window.OfficeWasm && OfficeWasm.available());
        },

        /* The converters are the same Go code the AGI backends run, compiled
           to WebAssembly (src/wasm/office). The module is a few MB, so it is
           fetched the first time one of these is called, not at page load -
           the caller's busy overlay covers the wait. */
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
                var zipName = null;
                if (res.mediaZip && res.mediaZip.length) {
                    // .pptx keeps video and audio beside the file rather than
                    // embedding them - hand over the sidecar as its own download
                    zipName = stripExt(name) + ".zip";
                    try {
                        download(res.mediaZip, zipName, "application/zip");
                    } catch (e) {
                        zipName = null;
                    }
                }
                cb({ mediaZip: zipName });
            }, errcb);
        },

        prepareWorkdir: function (cb) { cb(); },

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

        containerLoad: function (path, cb, errcb) {
            var f = localFiles[path];
            if (!f) { webContainerLoad(path, cb, errcb); return; }
            // a File the visitor picked: same unpack, but the bytes come from
            // the file rather than the network
            readAsBytes(f, function (bytes) {
                var envelope;
                try {
                    envelope = OfficeContainer.unpack(bytes);
                } catch (e) {
                    errcb(e.message || "unreadable document");
                    return;
                }
                keepRecent(basename(path), envelope, bytes);
                cb(envelope);
            }, errcb);
        },
        containerSave: function (path, envelopeJson, cb, errcb) {
            var bytes;
            try {
                bytes = OfficeContainer.pack(envelopeJson);
            } catch (e) {
                errcb(e.message || "could not build the document");
                return;
            }
            var name = saveName(path);
            try {
                download(bytes, name, "application/zip");
            } catch (e) {
                errcb(e.message || "download failed");
                return;
            }
            // a saved document is the one most worth having in recents: the
            // download leaves the browser's hands, this copy does not
            keepRecent(name, envelopeJson, bytes);
            cb();
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

        /* Office interchange formats, whichever host is running.
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

        containerLoad: function (p, cb, errcb) { host.containerLoad(p, cb, errcb); },
        containerSave: function (p, j, cb, errcb) { host.containerSave(p, j, cb, errcb); },

        sessionSave: function (a, j, cb, errcb) { host.sessionSave(a, j, cb, errcb); },
        sessionLoad: function (a, cb) { host.sessionLoad(a, cb); },
        sessionDelete: function (a) { host.sessionDelete(a); },

        agirun: function (s, p, cb, errcb, t) { host.agirun(s, p, cb, errcb, t); },
        agirunLarge: function (s, p, f, cb, errcb, t) { host.agirunLarge(s, p, f, cb, errcb, t); },
        prepareWorkdir: function (cb, errcb) { host.prepareWorkdir(cb, errcb); },

        mediaUrl: function (v) { return host.mediaUrl(v); },
        blobToSrc: function (b, n, cb, errcb) { host.blobToSrc(b, n, cb, errcb); },

        loadInputFiles: function () { return host.loadInputFiles(); },
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
