/*
    ArozOS Office Suite - shared application framework
    ====================================================
    Shared by Docs, Sheets and Slides. Provides:
      - Document lifecycle: New / Open / Save / Save As, import of foreign
        formats, native JSON envelope handling, file version metadata
      - Auto-save, crash-recovery drafts (localStorage), recent documents
      - Menubar + statusbar chrome, dialogs, toasts, context menus
      - Keyboard shortcut registry, undo/redo bindings
      - Light/dark theme (shared across the suite), zoom controls, print

    Requires (include before this file):
        ../../script/jquery.min.js
        ../../script/ao_module.js
        ../common/mode.js
        ../common/container.js
        ../common/platform.js
        ../common/office.css

    Everything that reaches outside the browser tab - file dialogs, reading
    and writing documents, the native container, session snapshots, AGI
    calls - goes through OfficePlatform (common/platform.js), which is what
    lets the same source run both as an ArozOS webapp and as the standalone
    static-hosting build.

    Usage: see Office/common/CONTRACT.md for the full API reference.
*/

/* ================= Undo stack ================= */
/*
    Generic snapshot-based undo/redo helper.
        var undo = new OfficeUndoStack({
            limit: 100,
            apply: function(state){ ...restore editor from state... }
        });
        undo.init(initialState);
        undo.push(state);           // record a new state (call after a change)
        undo.pushDebounced(fn, ms); // coalesce rapid changes; fn() returns state
        undo.undo(); undo.redo();   // calls apply() with the target state
        undo.canUndo(); undo.canRedo();
        undo.reset(initialState);
*/
function OfficeUndoStack(opts) {
    opts = opts || {};
    this.limit = opts.limit || 100;
    this.applyFn = opts.apply || function () {};
    this.stack = [];
    this.pos = -1;
    this._debTimer = null;
}
OfficeUndoStack.prototype.init = function (state) {
    this.stack = [state];
    this.pos = 0;
};
OfficeUndoStack.prototype.reset = OfficeUndoStack.prototype.init;
OfficeUndoStack.prototype.push = function (state) {
    if (this.pos >= 0) {
        var cur = this.stack[this.pos];
        if (typeof cur === "string" && typeof state === "string" && cur === state) return;
        try {
            if (typeof cur === "object" && JSON.stringify(cur) === JSON.stringify(state)) return;
        } catch (e) { /* non-serializable state, push anyway */ }
    }
    this.stack = this.stack.slice(0, this.pos + 1);
    this.stack.push(state);
    if (this.stack.length > this.limit) this.stack.shift();
    this.pos = this.stack.length - 1;
};
OfficeUndoStack.prototype.pushDebounced = function (stateFn, ms) {
    var that = this;
    clearTimeout(this._debTimer);
    this._debTimer = setTimeout(function () {
        that.push(stateFn());
    }, ms || 400);
};
OfficeUndoStack.prototype.flushDebounced = function (stateFn) {
    if (this._debTimer) {
        clearTimeout(this._debTimer);
        this._debTimer = null;
        this.push(stateFn());
    }
};
OfficeUndoStack.prototype.canUndo = function () { return this.pos > 0; };
OfficeUndoStack.prototype.canRedo = function () { return this.pos < this.stack.length - 1; };
OfficeUndoStack.prototype.undo = function () {
    if (!this.canUndo()) return false;
    this.pos--;
    this.applyFn(this.stack[this.pos]);
    return true;
};
OfficeUndoStack.prototype.redo = function () {
    if (!this.canRedo()) return false;
    this.pos++;
    this.applyFn(this.stack[this.pos]);
    return true;
};

/* ================= OfficeApp ================= */
var OfficeApp = (function () {
    var cfg = null;
    var filepath = null;      // virtual path of the open file, null = unsaved
    var filename = null;      // display name (with extension)
    var dirty = false;
    var meta = null;          // envelope meta of the open document
    var zoom = 100;
    var shortcuts = {};       // normalized combo -> handler
    var statusTimer = null;
    var draftTimer = null;
    var autosaveTimer = null;
    var loadedFromImport = false;

    var ENVELOPE_TYPE = "arozos/office";
    var GENERATOR = "ArozOS Office/1.0";
    var DRAFT_MAX_AGE = 7 * 24 * 3600 * 1000;   // prune drafts older than 7 days
    var DRAFT_MAX_SIZE = 4 * 1024 * 1024;        // skip drafts over 4 MB
    var AUTOSAVE_INTERVAL = 25 * 1000;
    var RECENT_MAX = 10;

    /* ---------- small utils ---------- */
    function escapeHtml(t) {
        if (t === undefined || t === null) return "";
        return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    function basename(p) {
        if (!p) return "";
        var s = String(p).replace(/\\/g, "/");
        return s.substring(s.lastIndexOf("/") + 1);
    }
    function dirname(p) {
        if (!p) return "";
        var s = String(p).replace(/\\/g, "/");
        return s.substring(0, s.lastIndexOf("/"));
    }
    function extOf(p) {
        var b = basename(p);
        var i = b.lastIndexOf(".");
        return i < 0 ? "" : b.substring(i).toLowerCase();
    }
    function stripExt(p) {
        var i = String(p).lastIndexOf(".");
        return i < 0 ? String(p) : String(p).substring(0, i);
    }
    function now() { return new Date().getTime(); }
    // "meeting-notes" -> "Meeting Notes": template file names become the
    // suggested document name, so they should read like one
    function titleCase(s) {
        return String(s || "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
            .replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
    }

    function lsKey(k) { return "office_" + (cfg ? cfg.appType : "generic") + "_" + k; }
    function getSetting(k, def) {
        try {
            var v = localStorage.getItem(lsKey(k));
            return v === null ? def : JSON.parse(v);
        } catch (e) { return def; }
    }
    function setSetting(k, v) {
        try { localStorage.setItem(lsKey(k), JSON.stringify(v)); } catch (e) { }
    }

    /* ---------- host bridge (see common/platform.js) ----------
       These stay on OfficeApp because the whole suite already calls them
       through it; the implementation - ArozOS virtual file system and AGI
       gateway, or the visitor's own device - lives in OfficePlatform. */
    function vfsLoad(path, cb, errcb) { OfficePlatform.readText(path, cb, errcb); }
    function vfsSave(path, content, cb, errcb) { OfficePlatform.writeText(path, content, cb, errcb); }
    function mediaUrl(vpath) { return OfficePlatform.mediaUrl(vpath); }
    function blobToSrc(blob, filename, cb, errcb) {
        OfficePlatform.blobToSrc(blob, filename, cb, errcb);
    }
    function agirunLarge(script, params, field, cb, errcb, timeout) {
        OfficePlatform.agirunLarge(script, params, field, cb, errcb, timeout);
    }

    /* ---------- session snapshots ("Restore from previous session") ---------- */
    function saveSession() {
        if (!cfg || !cfg.packed) return;
        var env;
        try { env = buildEnvelopeNoBump(); } catch (e) { return; }
        // annotate a COPY of meta - session bookkeeping must not leak into
        // the real document file
        var m = {};
        Object.keys(env.meta || {}).forEach(function (k) { m[k] = env.meta[k]; });
        m._sessionAt = now();
        m._origin = filepath ? { fp: filepath, fn: filename } : null;
        env.meta = m;
        OfficePlatform.sessionSave(cfg.appType, JSON.stringify(env));
    }
    // drop the saved session snapshot so it stops prompting on next launch
    function deleteSession() {
        if (!cfg || !cfg.packed) return;
        OfficePlatform.sessionDelete(cfg.appType);
    }
    function trySessionRestore() {
        OfficePlatform.sessionLoad(cfg.appType, function (envelope) {
            var env = envelope;
            if (typeof env === "string") {
                try { env = JSON.parse(env); } catch (e) { env = null; }
            }
            if (!env || env.type !== ENVELOPE_TYPE || env.app !== cfg.appType || !env.body) {
                checkDraft();
                return;
            }
            var m = env.meta || {};
            var when = m._sessionAt ? new Date(m._sessionAt).toLocaleString() : "an earlier session";
            var what = m._origin && m._origin.fn ? escapeHtml(m._origin.fn) : "an unsaved document";
            var restore = function () {
                var origin = m._origin;
                delete m._sessionAt;
                delete m._origin;
                meta = m;
                if (origin && origin.fp) {
                    filepath = origin.fp;
                    filename = origin.fn;
                }
                cfg.deserialize(env.body);
                markDirty();
                updateTitle();
                setStatus("Previous session restored - remember to save");
            };
            dialog({
                title: "Restore from previous session?",
                body: "You were working on <b>" + what + "</b> (" + escapeHtml(when) + ").<br><br>" +
                    '<span class="of-dim">Start fresh deletes the saved snapshot.</span>',
                dismissable: true,
                buttons: [
                    // keeps the snapshot: dismiss now, may be offered next launch
                    //{ label: "Start fresh", action: function (close) { close(); checkDraft(); } },
                    // deletes the snapshot so it stops prompting
                    {
                        label: "Start fresh", danger: true,
                        action: function (close) { close(); deleteSession(); checkDraft(); }
                    },
                    {
                        label: "Restore", primary: true,
                        action: function (close) { close(); restore(); }
                    }
                ]
            });
        });
    }

    /* ---------- envelope ---------- */
    function buildEnvelope() {
        var m = meta || {};
        m.title = stripExt(filename || cfg.defaultFileName);
        m.createdAt = m.createdAt || now();
        m.modifiedAt = now();
        m.revision = (m.revision || 0) + 1;
        m.generator = GENERATOR;
        meta = m;
        return {
            type: ENVELOPE_TYPE,
            app: cfg.appType,
            version: 1,
            meta: m,
            body: cfg.serialize()
        };
    }
    function parseEnvelope(text) {
        var obj = JSON.parse(text);
        if (!obj || obj.type !== ENVELOPE_TYPE || obj.app !== cfg.appType) {
            throw new Error("Not a valid " + cfg.fileTypeName + " file");
        }
        return obj;
    }

    /* ---------- title / status ---------- */
    function updateTitle() {
        var name = filename || (cfg.defaultFileName + cfg.extension);
        var t = name + (dirty ? " •" : "") + " - " + cfg.appName;
        OfficePlatform.setWindowTitle(t);
        var $dn = $(".of-docname");
        $dn.html((dirty ? '<span class="of-dirty-dot">• </span>' : "") + escapeHtml(name));
    }
    function setStatus(msg, type, timeout) {
        var $m = $(".of-status-msg");
        $m.text(msg || "").removeClass("error");
        if (type === "error") $m.addClass("error");
        clearTimeout(statusTimer);
        if (timeout !== 0) {
            statusTimer = setTimeout(function () { $m.text(""); }, timeout || 5000);
        }
    }
    function addStatusItem(id, html) {
        var $it = $('<span class="of-status-item" data-sid="' + escapeHtml(id) + '"></span>').html(html);
        $(".of-status-items").append($it);
        return $it;
    }
    function updateStatusItem(id, html) {
        $('.of-status-item[data-sid="' + id + '"]').html(html);
    }

    /* ---------- dirty / drafts ---------- */
    function draftKey() {
        return "officeDraft_" + cfg.appType + "_" + (filepath || "untitled");
    }
    function saveDraft() {
        try {
            var env = buildEnvelopeNoBump();
            var s = JSON.stringify({ t: now(), fp: filepath, fn: filename, env: env });
            if (s.length > DRAFT_MAX_SIZE) return;
            localStorage.setItem(draftKey(), s);
        } catch (e) { }
    }
    function buildEnvelopeNoBump() {
        // snapshot without touching revision/modified metadata
        return {
            type: ENVELOPE_TYPE, app: cfg.appType, version: 1,
            meta: meta || {}, body: cfg.serialize()
        };
    }
    function clearDraft() {
        try { localStorage.removeItem(draftKey()); } catch (e) { }
    }
    function pruneDrafts() {
        try {
            var kill = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf("officeDraft_") === 0) {
                    try {
                        var d = JSON.parse(localStorage.getItem(k));
                        if (!d.t || now() - d.t > DRAFT_MAX_AGE) kill.push(k);
                    } catch (e) { kill.push(k); }
                }
            }
            kill.forEach(function (k) { localStorage.removeItem(k); });
        } catch (e) { }
    }
    function checkDraft() {
        var raw = null;
        try { raw = localStorage.getItem(draftKey()); } catch (e) { }
        if (!raw) return;
        var d;
        try { d = JSON.parse(raw); } catch (e) { clearDraft(); return; }
        if (!d || !d.env || !d.env.body) { clearDraft(); return; }
        var when = new Date(d.t).toLocaleString();
        confirmDialog("Recover unsaved changes?",
            "A recovered version of this document from <b>" + escapeHtml(when) +
            "</b> was found. It may contain changes that were never saved.",
            "Restore", "Discard",
            function (restore) {
                if (restore) {
                    meta = d.env.meta || meta;
                    cfg.deserialize(d.env.body);
                    markDirty();
                    setStatus("Recovered draft restored - remember to save");
                } else {
                    clearDraft();
                }
            });
    }
    function markDirty() {
        if (!dirty) { dirty = true; updateTitle(); }
        clearTimeout(draftTimer);
        draftTimer = setTimeout(saveDraft, 2500);
    }
    function markClean() {
        dirty = false;
        clearTimeout(draftTimer);
        clearDraft();
        updateTitle();
    }

    /* ---------- recent documents ---------- */
    /* A recent entry is only useful where the path survives the page: the
       standalone build opens File objects the visitor picked, which are gone
       on reload, so it keeps no list rather than offering dead entries. */
    function getRecents() {
        if (!OfficePlatform.tracksRecents()) return [];
        return getSetting("recent", []);
    }
    function addRecent(fp, fn) {
        if (!OfficePlatform.tracksRecents()) return;
        var list = getRecents().filter(function (r) { return r.fp !== fp; });
        list.unshift({ fp: fp, fn: fn, t: now() });
        setSetting("recent", list.slice(0, RECENT_MAX));
    }

    /* ---------- document lifecycle ---------- */
    /*
        Foreign binary formats (.docx / .xlsx / .pptx / ODF) go through the Go
        converters - server side in ArozOS, in the WebAssembly module in a
        standalone build made with them. Reading the list through here rather
        than off cfg keeps one decision in one place: with no converters they
        are neither offered in the Open dialog's filter nor accepted by
        openPath.
    */
    function binaryImporters() {
        if (!OfficePlatform.canConvert()) return {};
        return cfg.binaryImporters || {};
    }
    function loadNativeEnvelope(env, fp, fn, opts) {
        if (!env || env.type !== ENVELOPE_TYPE || env.app !== cfg.appType) {
            throw new Error("Not a valid " + cfg.fileTypeName + " file");
        }
        meta = env.meta || {};
        loadedFromImport = false;
        /*
            A template is a starting point, not a file the person is editing:
            the content loads but the document stays unattached, so Ctrl+S
            asks where to put it instead of writing back over the template.
            The name is kept as a suggestion for that dialog.
        */
        if (opts && opts.asTemplate) {
            var pretty = titleCase(stripExt(fn));
            filepath = null;
            filename = pretty + cfg.extension;
            meta = { createdAt: now(), revision: 0 };
            cfg.deserialize(env.body);
            markClean();
            setStatus("New " + cfg.fileTypeName.toLowerCase() +
                " from the " + pretty + " template");
            return;
        }
        filepath = fp; filename = fn;
        cfg.deserialize(env.body);
        markClean();
        addRecent(fp, fn);
        setStatus("Opened " + fn);
        checkDraft();
    }
    function loadNativeText(text, fp, fn, opts) {
        loadNativeEnvelope(parseEnvelope(text), fp, fn, opts);
    }
    /*
        A file opened from a foreign format stays attached to that file when
        the app declared a writer for its extension (cfg.saveFormats): Save
        then writes back in the original format, and only steps up to the
        native container once the document outgrows it (see doSaveForeign).
        With no writer the import is read-only and Save has to become Save As
        - which is what every app did before saveFormats existed.
    */
    function adoptImportedPath(fp, fn) {
        loadedFromImport = true;
        if (saveFormatFor(extOf(fn))) {
            filepath = fp;
            filename = fn;
        } else {
            filepath = null;   // read-only import: force Save As on save
            filename = stripExt(fn) + cfg.extension;
        }
    }
    function importedStatus(fn) {
        return filepath ? ("Opened " + fn) :
            ("Imported " + fn + " - use Save to store it as " + cfg.extension);
    }
    function loadImportText(text, fp, fn) {
        var ext = extOf(fn);
        var importer = (cfg.importers || {})[ext];
        if (!importer) { setStatus("Unsupported file type " + ext, "error"); return; }
        meta = { createdAt: now(), revision: 0 };
        adoptImportedPath(fp, fn);
        importer(text, fn);
        dirty = false; updateTitle();
        if (filepath) addRecent(filepath, filename);
        setStatus(importedStatus(fn));
    }
    function openPath(fp, fn, opts) {
        fn = fn || basename(fp);
        // binary foreign formats (e.g. .pptx) are handled by the app itself,
        // usually through a server-side AGI conversion - no text fetch here
        var bi = binaryImporters()[extOf(fn)];
        if (bi) {
            meta = { createdAt: now(), revision: 0 };
            adoptImportedPath(fp, fn);
            dirty = false;
            updateTitle();
            if (filepath) addRecent(filepath, filename);
            bi(fp, fn);
            return;
        }
        setStatus("Opening " + fn + "...", "info", 0);
        // packed apps store native files as zip containers with embedded
        // assets, so they are unpacked rather than fetched as text - server
        // side in ArozOS, by OfficeContainer in the standalone build
        if (cfg.packed && extOf(fn) === cfg.extension) {
            OfficePlatform.containerLoad(fp, function (envelope) {
                var env = envelope;
                if (typeof env === "string") {
                    try { env = JSON.parse(env); } catch (e) { env = null; }
                }
                try {
                    loadNativeEnvelope(env, fp, fn, opts);
                } catch (err) {
                    setStatus("Cannot open " + fn + ": " + err.message, "error");
                }
            }, function (msg) {
                setStatus("Failed to open " + fn + ": " + (msg || "unknown error"), "error");
            });
            return;
        }
        vfsLoad(fp, function (text) {
            try {
                if (extOf(fn) === cfg.extension) {
                    loadNativeText(text, fp, fn, opts);
                } else {
                    loadImportText(text, fp, fn);
                }
            } catch (err) {
                setStatus("Cannot open " + fn + ": " + err.message, "error");
            }
        }, function () {
            setStatus("Failed to load " + fn, "error");
        });
    }
    function newDocument() {
        var go = function () {
            filepath = null;
            filename = null;
            meta = { createdAt: now(), revision: 0 };
            loadedFromImport = false;
            cfg.create();
            markClean();
            setStatus("New " + cfg.fileTypeName.toLowerCase() + " created");
        };
        if (dirty) {
            confirmDialog("Discard unsaved changes?",
                "The current document has unsaved changes that will be lost.",
                "Discard", "Cancel", function (yes) { if (yes) go(); });
        } else { go(); }
    }
    function openDialog() {
        var go = function () {
            var filter = [cfg.extension.substring(1)];
            (Object.keys(cfg.importers || {})).forEach(function (e) {
                filter.push(e.substring(1));
            });
            (Object.keys(binaryImporters())).forEach(function (e) {
                filter.push(e.substring(1));
            });
            OfficePlatform.pickOpen({ filter: filter, memoryKey: "document" }, function (files) {
                openPath(files[0].filepath, files[0].filename);
            });
        };
        if (dirty) {
            confirmDialog("Discard unsaved changes?",
                "The current document has unsaved changes that will be lost.",
                "Discard", "Cancel", function (yes) { if (yes) go(); });
        } else { go(); }
    }
    /* ---------- foreign save formats (cfg.saveFormats) ---------- */
    /*
        An app may declare formats it can write besides its native container:

            saveFormats: [{
                ext: ".csv", label: "CSV (.csv)", icon: "file alternate outline",
                oneWay: true,                        // a rendering (PDF):
                                                     // never becomes the file
                                                     // the document lives in
                unsupported: fn -> null | [reason, ...],
                save: fn(fp, fn, done, fail(msg))
            }]

        They drive both Save As (a format picker) and Save (a document opened
        from one of these formats writes straight back to it). Apps that
        declare none keep the native-format-only behaviour unchanged.
    */
    /*
        Two flags mark a writer that cannot exist everywhere:

          needsConvert  goes through the Office format converters (.xlsx,
                        .ods, ...) - present in ArozOS, and in a standalone
                        build shipped with the WebAssembly module
          needsBackend  needs a server outright (the real-text PDF renderer)

        Filtering here rather than in each app keeps Save As, the
        save-back-into-a-foreign-format path and autosave consistent.
    */
    function saveFormats() {
        var list = (cfg && cfg.saveFormats) || [];
        return list.filter(function (f) {
            if (f.needsBackend && !OfficePlatform.hasBackend()) return false;
            if (f.needsConvert && !OfficePlatform.canConvert()) return false;
            return true;
        });
    }
    function findSaveFormat(ext, adoptableOnly) {
        var list = saveFormats();
        for (var i = 0; i < list.length; i++) {
            if (list[i].ext !== ext) continue;
            return (adoptableOnly && list[i].oneWay) ? null : list[i];
        }
        return null;
    }
    // a writer whose output the document can go on living in (excludes PDF)
    function saveFormatFor(ext) { return findSaveFormat(ext, true); }
    function formatLabel(fmt) { return (fmt && (fmt.label || fmt.ext)) || cfg.extension; }
    function formatReasons(fmt) {
        if (!fmt || !fmt.unsupported) return null;
        var r;
        try { r = fmt.unsupported(); } catch (e) { return null; }
        return (r && r.length) ? r : null;
    }
    /*
        A foreign format holds less than the native container does, so it may
        refuse a document outright instead of silently dropping content. The
        reasons come from the app as plain strings - escaped here, never
        trusted as markup.
    */
    function formatBlockedDialog(fmt, reasons) {
        var label = formatLabel(fmt);
        var list = reasons.map(function (t) {
            return "<li>" + escapeHtml(t) + "</li>";
        }).join("");
        setStatus("Cannot save in " + label + " format", "error");
        dialog({
            title: "Cannot save as " + label,
            body: "<p>This " + escapeHtml(cfg.fileTypeName.toLowerCase()) +
                " uses features that " + escapeHtml(label) + " cannot store:</p>" +
                "<ul>" + list + "</ul>" +
                "<p>Save it as " + escapeHtml(cfg.extension) +
                " to keep them, or use File &gt; Export for a lossy copy.</p>",
            buttons: [
                { label: "Cancel" },
                {
                    label: "Save as " + cfg.extension + "...", primary: true,
                    action: function (close) { close(); saveAsFormat(null); }
                }
            ]
        });
    }
    function doSaveForeign(fp, fn, fmt, cb, silent) {
        var reasons = formatReasons(fmt);
        if (reasons) {
            // autosave must never interrupt with a dialog: it skips the write
            // and lets the session snapshot be the safety net instead
            if (!silent) formatBlockedDialog(fmt, reasons);
            return false;
        }
        if (cfg.onBeforeSave) { try { cfg.onBeforeSave(); } catch (e) { } }
        setStatus("Saving...", "info", 0);
        fmt.save(fp, fn, function () {
            setStatus("Saved " + fn);
            // a one-way rendering is a copy, not the document's own file - the
            // editor keeps its path and stays dirty
            if (!fmt.oneWay) {
                filepath = fp; filename = fn;
                loadedFromImport = false;
                markClean();
                addRecent(fp, fn);
                saveSession();
            }
            if (cb) cb();
        }, function (err) {
            setStatus("Save failed: " + err, "error");
        });
        return true;
    }

    function save(cb) {
        if (!filepath) { saveAs(cb); return; }
        doSaveTo(filepath, filename, cb);
    }
    function saveAs(cb) { saveAsFormat(null, cb); }
    /*
        `fmt` is a cfg.saveFormats entry, or null for the native format. The
        format fixes the extension, so the picker only supplies the name.
    */
    function saveAsFormat(fmt, cb) {
        var ext = fmt ? fmt.ext : cfg.extension;
        // ask before making the user pick a filename, not after
        var reasons = formatReasons(fmt);
        if (reasons) { formatBlockedDialog(fmt, reasons); return; }
        var defName = stripExt(filename || cfg.defaultFileName) + ext;
        OfficePlatform.pickSave({
            defaultName: defName,
            ext: ext,
            memoryKey: "document",
            //A document that has never been saved has no folder of its own, so start
            //from wherever this app was last used rather than the hardcoded Desktop
            forceOverwrite: !filepath
        }, function (file) {
            doSaveTo(file.filepath, file.filename, cb);
        });
    }
    // returns false when the write was declined (format cannot hold the doc)
    function doSaveTo(fp, fn, cb, silent) {
        var ext = extOf(fn);
        if (ext !== cfg.extension) {
            // one of the app's own foreign formats - including a document
            // opened from one and saved straight back with Ctrl+S
            var fmt = findSaveFormat(ext, false);
            if (fmt) return doSaveForeign(fp, fn, fmt, cb, silent);
        }
        if (cfg.onBeforeSave) { try { cfg.onBeforeSave(); } catch (e) { } }
        setStatus("Saving...", "info", 0);
        var env;
        try { env = buildEnvelope(); }
        catch (e) { setStatus("Save failed: " + e.message, "error"); return false; }
        var payload = JSON.stringify(env);
        var done = function () {
            filepath = fp; filename = fn;
            loadedFromImport = false;
            markClean();
            addRecent(fp, fn);
            setStatus("Saved " + fn);
            saveSession();   // keep the session snapshot in step with the file
            if (cb) cb();
        };
        var fail = function (err) {
            setStatus("Save failed: " + err, "error");
        };
        if (cfg.packed) {
            // native zip container: media data URLs become embedded assets
            OfficePlatform.containerSave(fp, payload, done, fail);
        } else {
            vfsSave(fp, payload, done, fail);
        }
        return true;
    }

    /* ---------- autosave ---------- */
    function autosaveEnabled() { return getSetting("autosave", true); }
    function autosaveTick() {
        // a host with no file system to write back to (the standalone build
        // saves by downloading) must never autosave: the snapshot below is
        // the whole safety net there
        if (dirty && filepath && autosaveEnabled() && OfficePlatform.autosavesToFile()) {
            // a document living in a foreign format is autosaved only while
            // that format can still hold it; when it cannot, doSaveTo's silent
            // mode declines the write rather than interrupting with a dialog,
            // and the session snapshot below protects the work instead
            if (!doSaveTo(filepath, filename, null, true)) saveSession();
        } else if (dirty) {
            // unsaved (or autosave-off) documents still get a session
            // snapshot so "Restore from previous session" can recover them
            saveSession();
        }
    }

    /* ---------- theme ---------- */
    function isDark() {
        try { return localStorage.getItem("office_theme") === "dark"; } catch (e) { return false; }
    }
    function applyTheme() {
        var dark = isDark();
        $("body").toggleClass("dark", dark);
        OfficePlatform.setWindowTheme(dark);
        if (cfg && cfg.onThemeChanged) { try { cfg.onThemeChanged(dark); } catch (e) { } }
    }
    function toggleTheme() {
        try { localStorage.setItem("office_theme", isDark() ? "light" : "dark"); } catch (e) { }
        applyTheme();
        refreshMenuChecks();
    }

    /* ---------- zoom ---------- */
    var ZOOM_LEVELS = [50, 65, 75, 90, 100, 110, 125, 150, 175, 200];
    function applyZoom() {
        if (cfg.zoomTarget) {
            $(cfg.zoomTarget).css("zoom", zoom / 100);
        }
        $(".of-zoom-val").text(zoom + "%");
        setSetting("zoom", zoom);
        if (cfg.onZoomChanged) { try { cfg.onZoomChanged(zoom); } catch (e) { } }
    }
    function setZoom(z) {
        zoom = Math.max(25, Math.min(400, Math.round(z)));
        applyZoom();
    }
    /*
        Ctrl/Cmd + wheel zooms the document, not the whole ArozOS desktop.
        The browser's own page zoom owns that gesture, so the listener has to
        be non-passive to be allowed to preventDefault it.

        Deltas are accumulated rather than stepped per event: one mouse notch
        is ~100, but a trackpad pinch arrives as a stream of small deltas
        (Chrome reports those as wheel events with ctrlKey set) and stepping
        on each one would rocket through the zoom levels.
    */
    var WHEEL_ZOOM_STEP = 40;
    var wheelAccum = 0;
    function onWheelZoom(e) {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        // reversing direction should respond at once rather than first
        // having to work off the leftover from the other direction
        if (wheelAccum !== 0 && (wheelAccum < 0) !== (e.deltaY < 0)) wheelAccum = 0;
        wheelAccum += e.deltaY;
        // at most one level per event, so a single wheel notch (~100) is one
        // step while a stream of small pinch deltas still adds up to one
        if (wheelAccum <= -WHEEL_ZOOM_STEP) { wheelAccum = 0; zoomStep(1); }
        else if (wheelAccum >= WHEEL_ZOOM_STEP) { wheelAccum = 0; zoomStep(-1); }
    }
    function zoomStep(dir) {
        var i;
        if (dir > 0) {
            for (i = 0; i < ZOOM_LEVELS.length; i++) {
                if (ZOOM_LEVELS[i] > zoom) { setZoom(ZOOM_LEVELS[i]); return; }
            }
            setZoom(zoom + 25);
        } else {
            for (i = ZOOM_LEVELS.length - 1; i >= 0; i--) {
                if (ZOOM_LEVELS[i] < zoom) { setZoom(ZOOM_LEVELS[i]); return; }
            }
            setZoom(Math.max(25, zoom - 10));
        }
    }

    /* ---------- keyboard shortcuts ---------- */
    function normalizeCombo(c) {
        var parts = String(c).split("+").map(function (p) { return p.trim(); });
        var mods = { ctrl: false, alt: false, shift: false };
        var key = "";
        parts.forEach(function (p) {
            var l = p.toLowerCase();
            if (l === "ctrl" || l === "cmd" || l === "meta") mods.ctrl = true;
            else if (l === "alt") mods.alt = true;
            else if (l === "shift") mods.shift = true;
            else key = l;
        });
        return (mods.ctrl ? "ctrl+" : "") + (mods.alt ? "alt+" : "") + (mods.shift ? "shift+" : "") + key;
    }
    function comboFromEvent(e) {
        var key = e.key;
        if (!key) return "";
        if (key === " ") key = "space";
        key = key.toLowerCase();
        if (key === "escape") key = "esc";
        return ((e.ctrlKey || e.metaKey) ? "ctrl+" : "") + (e.altKey ? "alt+" : "") +
            (e.shiftKey ? "shift+" : "") + key;
    }
    // Registers through the shared OfficeHotkeys registry when loaded
    // (hotkeys.js); the local map only remains as a standalone fallback.
    // opts (optional) pass straight through: description/group make the
    // binding show up in the Ctrl+/ help dialog, when() gates it.
    function registerShortcut(combo, handler, opts) {
        if (window.OfficeHotkeys) {
            return OfficeHotkeys.register(combo, function (e) {
                closeAllMenus();
                return handler(e);
            }, $.extend({ allowInInput: true, inDialogs: true, group: "General" }, opts || {}));
        }
        shortcuts[normalizeCombo(combo)] = handler;
    }
    function handleKeydown(e) {
        var combo = comboFromEvent(e);
        var h = shortcuts[combo];
        if (h) {
            e.preventDefault();
            e.stopPropagation();
            closeAllMenus();
            h(e);
            return;
        }
        if (combo === "esc") closeAllMenus();
    }

    /* ---------- menus (menubar drops, context menus, floating submenus) ---------- */
    /*
        Submenus are NOT nested in their parent menu element - parents may
        scroll (overflow-y) which would clip them. Instead every submenu is
        a body-level ".of-float-menu" tagged with its depth; opening a menu
        at depth N closes every float menu at depth >= N.
    */
    function closeFloatMenus(minDepth) {
        minDepth = minDepth || 0;
        $(".of-float-menu").each(function () {
            if (($(this).data("depth") || 0) >= minDepth) $(this).remove();
        });
        if (minDepth === 0) $(".of-menu-item.of-has-sub").removeClass("open");
    }
    function closeAllMenus() {
        $(".of-menu").removeClass("open");
        closeFloatMenus(0);
    }
    function positionFloatMenu($m, x, y) {
        var w = $m.outerWidth(), h = $m.outerHeight();
        if (x + w > window.innerWidth) x = Math.max(4, window.innerWidth - w - 4);
        if (y + h > window.innerHeight) y = Math.max(4, window.innerHeight - h - 4);
        $m.css({ left: x + "px", top: y + "px" });
    }
    function openFloatSubmenu($it, sub, depth) {
        closeFloatMenus(depth);
        $it.closest(".of-menu-drop, .of-float-menu").find(".of-has-sub").removeClass("open");
        $it.addClass("open");
        var items = (typeof sub === "function") ? sub() : sub;
        var $sm = $('<div class="of-context-menu of-float-menu"></div>').data("depth", depth);
        renderMenuItems($sm, items, depth);
        if (!items || items.length === 0) {
            $sm.append('<div class="of-menu-item disabled"><span style="width:16px;"></span><span class="of-mi-label">(empty)</span></div>');
        }
        $("body").append($sm);
        var r = $it[0].getBoundingClientRect();
        var w = $sm.outerWidth();
        var x = r.right + 2;
        if (x + w > window.innerWidth) x = Math.max(4, r.left - w - 2);
        positionFloatMenu($sm, x, r.top - 4);
    }
    /*
        With foreign writers declared, "Save as" becomes a format picker whose
        first entry is the native container; without them it stays the plain
        Save As command it has always been.
    */
    function saveAsMenuItem() {
        var list = saveFormats();
        if (!list.length) {
            return {
                label: "Save as...", icon: "copy outline", key: "Ctrl+Shift+S",
                action: function () { saveAs(); }
            };
        }
        var sub = [
            {
                label: cfg.fileTypeName + " (" + cfg.extension + ")",
                icon: "save", key: "Ctrl+Shift+S",
                action: function () { saveAsFormat(null); }
            },
            { sep: true }
        ];
        list.forEach(function (f) {
            sub.push({
                label: formatLabel(f), icon: f.icon || "file outline",
                action: function () { saveAsFormat(f); }
            });
        });
        return { label: "Save as", icon: "copy outline", sub: sub };
    }
    function renderMenuItems($drop, items, depth) {
        depth = depth || 0;
        $drop.empty();
        (items || []).forEach(function (it) {
            if (!it) return;
            if (it.sep) { $drop.append('<div class="of-menu-sep"></div>'); return; }
            var $it = $('<div class="of-menu-item"></div>');
            if (it.checked !== undefined) {
                var on = (typeof it.checked === "function") ? it.checked() : it.checked;
                $it.append('<span class="of-mi-check">' + (on ? "✓" : "") + "</span>");
            } else if (it.icon) {
                $it.append('<i class="' + escapeHtml(it.icon) + ' icon"></i>');
            } else {
                $it.append('<span style="width:16px;"></span>');
            }
            $it.append('<span class="of-mi-label">' + escapeHtml(it.label) + "</span>");
            if (it.key) $it.append('<span class="of-mi-key">' + escapeHtml(it.key) + "</span>");
            if (typeof it.enabled === "function" && !it.enabled()) $it.addClass("disabled");
            if (it.sub) {
                $it.addClass("of-has-sub");
                var open = function () { openFloatSubmenu($it, it.sub, depth + 1); };
                $it.on("mouseenter", open);
                $it.on("click", function (ev) { ev.stopPropagation(); open(); });
            } else {
                // hovering a plain item closes any deeper submenu
                $it.on("mouseenter", function () { closeFloatMenus(depth + 1); });
                if (it.action) {
                    $it.on("click", function (ev) {
                        ev.stopPropagation();
                        closeAllMenus();
                        it.action();
                    });
                }
            }
            $drop.append($it);
        });
    }
    function buildMenubar(menus) {
        var $bar = $('<div class="of-menubar of-noprint"></div>');
        $bar.append('<img class="of-appicon" src="' + escapeHtml(cfg.appIcon || "../img/docs.svg") + '" alt="">');
        var $menus = $('<div style="display:flex;"></div>');
        menus.forEach(function (m) {
            var $m = $('<div class="of-menu" tabindex="-1">' + escapeHtml(m.title) + "</div>");
            var $drop = $('<div class="of-menu-drop"></div>');
            $m.append($drop);
            // contextual menus (e.g. Table) only show when their condition
            // holds; the app re-evaluates via OfficeApp.updateMenus()
            if (m.when) {
                $m.data("when", m.when);
                $m.hide();
            }
            $m.on("click", function (ev) {
                if ($(ev.target).closest(".of-menu-drop").length) return;
                var wasOpen = $m.hasClass("open");
                closeAllMenus();
                if (!wasOpen) {
                    renderMenuItems($drop, (typeof m.items === "function") ? m.items() : m.items, 0);
                    $m.addClass("open");
                }
            });
            $m.on("mouseenter", function () {
                if ($(".of-menu.open").length && !$m.hasClass("open")) {
                    closeAllMenus();
                    renderMenuItems($drop, (typeof m.items === "function") ? m.items() : m.items, 0);
                    $m.addClass("open");
                }
            });
            $menus.append($m);
        });
        $bar.append($menus);
        $bar.append('<div class="of-docname"></div>');
        // one global closer for menubar drops, context menus and submenus
        $(document).on("mousedown.ofmenu", function (ev) {
            if (!$(ev.target).closest(".of-menubar, .of-context-menu").length) closeAllMenus();
        });
        return $bar;
    }
    function refreshMenuChecks() {
        // menus re-render on open; nothing to do live
    }
    // show/hide conditional menubar menus (menu defs carrying when: fn)
    function updateMenus() {
        $(".of-menubar .of-menu").each(function () {
            var w = $(this).data("when");
            if (!w) return;
            var on = false;
            try { on = !!w(); } catch (e) { }
            if (!on && $(this).hasClass("open")) closeAllMenus();
            $(this).toggle(on);
        });
    }
    function standardMenus() {
        var fileItems = function () {
            var items = [
                { label: "New", icon: "file outline", key: "Ctrl+Alt+N", action: newDocument },
                { label: "Open...", icon: "folder open", key: "Ctrl+O", action: openDialog },
                !OfficePlatform.tracksRecents() ? null : {
                    label: "Open recent", icon: "history", sub: function () {
                        return getRecents().map(function (r) {
                            return {
                                label: r.fn, action: function () {
                                    if (dirty) {
                                        confirmDialog("Discard unsaved changes?",
                                            "The current document has unsaved changes.",
                                            "Discard", "Cancel",
                                            function (yes) { if (yes) openPath(r.fp, r.fn); });
                                    } else { openPath(r.fp, r.fn); }
                                }
                            };
                        });
                    }
                },
                { sep: true },
                { label: "Save", icon: "save", key: "Ctrl+S", action: function () { save(); } },
                saveAsMenuItem(),
                { label: "Auto-save", checked: autosaveEnabled, action: function () { setSetting("autosave", !autosaveEnabled()); } }
            ];
            if (cfg.fileMenuExtras && cfg.fileMenuExtras.length) {
                items.push({ sep: true });
                items = items.concat(cfg.fileMenuExtras);
            }
            items.push({ sep: true });
            items.push({ label: "Print / PDF...", icon: "print", key: "Ctrl+P", action: printDoc });
            return items;
        };
        var editItems = function () {
            var items = [
                {
                    label: "Undo", icon: "undo", key: "Ctrl+Z",
                    enabled: function () { return !cfg.canUndo || cfg.canUndo(); },
                    action: function () { if (cfg.onUndo) cfg.onUndo(); }
                },
                {
                    label: "Redo", icon: "redo", key: "Ctrl+Y",
                    enabled: function () { return !cfg.canRedo || cfg.canRedo(); },
                    action: function () { if (cfg.onRedo) cfg.onRedo(); }
                },
                { sep: true },
                { label: "Cut", icon: "cut", key: "Ctrl+X", action: function () { clipboardAction("cut"); } },
                { label: "Copy", icon: "copy", key: "Ctrl+C", action: function () { clipboardAction("copy"); } },
                { label: "Paste", icon: "paste", key: "Ctrl+V", action: function () { clipboardAction("paste"); } }
            ];
            if (cfg.editMenuExtras && cfg.editMenuExtras.length) {
                items.push({ sep: true });
                items = items.concat(cfg.editMenuExtras);
            }
            return items;
        };
        var viewItems = function () {
            var items = [
                { label: "Zoom in", icon: "zoom-in", key: "Ctrl+=", action: function () { zoomStep(1); } },
                { label: "Zoom out", icon: "zoom-out", key: "Ctrl+-", action: function () { zoomStep(-1); } },
                { label: "Reset zoom", icon: "expand", key: "Ctrl+0", action: function () { setZoom(100); } },
                { sep: true },
                { label: "Dark theme", checked: isDark, action: toggleTheme }
            ];
            if (cfg.viewMenuExtras && cfg.viewMenuExtras.length) {
                items.push({ sep: true });
                items = items.concat(cfg.viewMenuExtras);
            }
            return items;
        };
        var menus = [
            { title: "File", items: fileItems },
            { title: "Edit", items: editItems }
        ];
        (cfg.menus || []).forEach(function (m) { menus.push(m); });
        menus.push({ title: "View", items: viewItems });
        return menus;
    }

    /* ---------- clipboard ---------- */
    function clipboardAction(op) {
        var hook = { cut: cfg.onCut, copy: cfg.onCopy, paste: cfg.onPaste }[op];
        if (hook) { hook(); return; }
        if (op === "paste") {
            if (navigator.clipboard && navigator.clipboard.readText) {
                navigator.clipboard.readText().then(function (t) {
                    if (cfg.onPasteText) cfg.onPasteText(t);
                    else document.execCommand("insertText", false, t);
                }).catch(function () {
                    setStatus("Paste blocked by the browser - use Ctrl+V instead", "error");
                });
            } else {
                setStatus("Paste is not available - use Ctrl+V instead", "error");
            }
        } else {
            document.execCommand(op);
        }
    }

    /* ---------- print ---------- */
    function printDoc() {
        closeAllMenus();
        if (cfg.onBeforePrint) { try { cfg.onBeforePrint(); } catch (e) { } }
        setTimeout(function () {
            window.print();
            if (cfg.onAfterPrint) { try { cfg.onAfterPrint(); } catch (e) { } }
        }, 60);
    }

    /* ---------- dialogs / toasts / context menu ---------- */
    function dialog(opt) {
        var $ov = $('<div class="of-dialog-overlay"></div>');
        var $dl = $('<div class="of-dialog"></div>');
        if (opt.wide) $dl.addClass("wide");
        if (opt.title) $dl.append('<div class="of-dialog-title">' + escapeHtml(opt.title) + "</div>");
        var $body = $('<div class="of-dialog-body"></div>');
        if (opt.body instanceof $) $body.append(opt.body);
        else $body.html(opt.body || "");
        $dl.append($body);
        var close = function () { $ov.remove(); $(document).off("keydown.ofdialog"); };
        if (opt.buttons && opt.buttons.length) {
            var $act = $('<div class="of-dialog-actions"></div>');
            opt.buttons.forEach(function (b) {
                var $b = $('<button class="of-btn"></button>').text(b.label);
                if (b.primary) $b.addClass("primary");
                if (b.danger) $b.addClass("danger");
                $b.on("click", function () {
                    if (b.action) b.action(close, $body);
                    else close();
                });
                $act.append($b);
            });
            $dl.append($act);
        }
        $ov.append($dl);
        $ov.on("mousedown", function (e) { if (e.target === $ov[0] && opt.dismissable !== false) close(); });
        $(document).on("keydown.ofdialog", function (e) {
            if (e.key === "Escape" && opt.dismissable !== false) close();
        });
        $("body").append($ov);
        return { close: close, body: $body };
    }
    function confirmDialog(title, msgHtml, yesLabel, noLabel, cb) {
        dialog({
            title: title,
            body: "<p>" + msgHtml + "</p>",
            dismissable: false,
            buttons: [
                { label: noLabel || "Cancel", action: function (close) { close(); cb(false); } },
                { label: yesLabel || "OK", primary: true, action: function (close) { close(); cb(true); } }
            ]
        });
    }
    function promptDialog(title, label, defVal, cb) {
        var $b = $("<div><label>" + escapeHtml(label) + '</label><input type="text" class="of-prompt-input"></div>');
        $b.find("input").val(defVal === undefined ? "" : defVal);
        var d = dialog({
            title: title, body: $b,
            buttons: [
                { label: "Cancel", action: function (close) { close(); cb(null); } },
                {
                    label: "OK", primary: true, action: function (close, $body) {
                        var v = $body.find(".of-prompt-input").val();
                        close(); cb(v);
                    }
                }
            ]
        });
        var $in = d.body.find("input");
        $in.trigger("focus").trigger("select");
        $in.on("keydown", function (e) {
            if (e.key === "Enter") { var v = $in.val(); d.close(); cb(v); }
        });
        return d;
    }
    function toast(msg, type, ms) {
        var $h = $(".of-toast-holder");
        if (!$h.length) { $h = $('<div class="of-toast-holder"></div>'); $("body").append($h); }
        var $t = $('<div class="of-toast"></div>').text(msg);
        if (type === "error") $t.addClass("error");
        $h.append($t);
        requestAnimationFrame(function () { $t.addClass("show"); });
        setTimeout(function () {
            $t.removeClass("show");
            setTimeout(function () { $t.remove(); }, 250);
        }, ms || 2600);
    }
    function showContextMenu(x, y, items) {
        closeFloatMenus(0);
        var $cm = $('<div class="of-context-menu of-float-menu"></div>').data("depth", 0);
        renderMenuItems($cm, items, 0);
        $("body").append($cm);
        positionFloatMenu($cm, x, y);
        return { close: function () { closeFloatMenus(0); } };
    }
    function showBusy(msg) {
        hideBusy();
        var $o = $('<div class="of-busy-overlay"><div class="of-spinner"></div><div class="of-busy-msg"></div></div>');
        $o.find(".of-busy-msg").text(msg || "Working...");
        $("body").append($o);
    }
    function hideBusy() { $(".of-busy-overlay").remove(); }

    /* ---------- statusbar ---------- */
    function buildStatusbar() {
        var $sb = $('<div class="of-statusbar of-noprint"></div>');
        $sb.append('<span class="of-status-msg"></span>');
        $sb.append('<span class="of-status-items"></span>');
        var $z = $('<span class="of-status-zoom"></span>');
        var $minus = $('<button type="button" title="Zoom out">−</button>');
        var $plus = $('<button type="button" title="Zoom in">+</button>');
        var $val = $('<span class="of-zoom-val" title="Reset zoom">100%</span>');
        $minus.on("click", function () { zoomStep(-1); });
        $plus.on("click", function () { zoomStep(1); });
        $val.on("click", function () { setZoom(100); });
        $z.append($minus).append($val).append($plus);
        $sb.append($z);
        return $sb;
    }

    /* ---------- init ---------- */
    function init(config) {
        cfg = config;
        if (!cfg.appType || !cfg.serialize || !cfg.deserialize || !cfg.create) {
            throw new Error("OfficeApp.init: appType, serialize, deserialize and create are required");
        }
        cfg.fileTypeName = cfg.fileTypeName || "Document";
        cfg.defaultFileName = cfg.defaultFileName || "Untitled";

        $("body").addClass("of-app");

        // chrome
        var $menubar = buildMenubar(standardMenus());
        $("body").prepend($menubar);
        $("body").append(buildStatusbar());

        // shortcuts (standard)
        registerShortcut("Ctrl+S", function () { save(); }, { description: "Save" });
        registerShortcut("Ctrl+Shift+S", function () { saveAs(); }, { description: "Save as..." });
        registerShortcut("Ctrl+O", function () { openDialog(); }, { description: "Open..." });
        registerShortcut("Ctrl+Alt+N", function () { newDocument(); }, { description: "New document" });
        registerShortcut("Ctrl+P", function () { printDoc(); }, { description: "Print" });
        registerShortcut("Ctrl+=", function () { zoomStep(1); }, { description: "Zoom in" });
        registerShortcut("Ctrl++", function () { zoomStep(1); });
        registerShortcut("Ctrl+-", function () { zoomStep(-1); }, { description: "Zoom out" });
        registerShortcut("Ctrl+0", function () { setZoom(100); }, { description: "Reset zoom" });
        // non-passive so the browser's own page zoom can be preventDefault-ed
        window.addEventListener("wheel", onWheelZoom, { passive: false });
        if (cfg.onUndo) registerShortcut("Ctrl+Z", function () { cfg.onUndo(); }, { description: "Undo" });
        if (cfg.onRedo) {
            registerShortcut("Ctrl+Y", function () { cfg.onRedo(); }, { description: "Redo" });
            registerShortcut("Ctrl+Shift+Z", function () { cfg.onRedo(); });
        }
        if (window.OfficeHotkeys) {
            registerShortcut("Ctrl+/", function () { OfficeHotkeys.showHelp(); },
                { description: "Keyboard shortcuts help" });
            // Escape falls through (return false) so app-level Escape
            // handlers still run after any open menu is closed
            OfficeHotkeys.register("Escape", function () {
                closeAllMenus();
                return false;
            }, { id: "of.menuclose", allowInInput: true, inDialogs: true });
        } else {
            window.addEventListener("keydown", handleKeydown, true);
        }

        // theme + zoom
        applyTheme();
        zoom = getSetting("zoom", 100);
        applyZoom();

        // housekeeping
        pruneDrafts();

        // load input file (embedded / open-with) or start blank
        meta = { createdAt: now(), revision: 0 };
        var inputs = OfficePlatform.loadInputFiles();
        if (inputs && inputs.length > 0) {
            cfg.create();
            openPath(inputs[0].filepath, inputs[0].filename,
                { asTemplate: !!inputs[0].asTemplate });
        } else {
            cfg.create();
            markClean();
            if (cfg.packed) {
                trySessionRestore();   // falls back to checkDraft() itself
            } else {
                checkDraft();
            }
        }

        // autosave + unload guard
        autosaveTimer = setInterval(autosaveTick, AUTOSAVE_INTERVAL);
        window.addEventListener("beforeunload", function (e) {
            if (dirty) {
                saveDraft();
                e.preventDefault();
                e.returnValue = "";
            }
        });
        installFloatWindowCloseGuard();
        installStandaloneDropOpen();

        updateTitle();

        // the standalone build has no storage behind it - say so once, so
        // "Save downloads a copy" is not a surprise the first time
        if (OfficePlatform.isStandalone() && (!inputs || !inputs.length)) {
            setStatus("Web edition - open a " + cfg.extension +
                " from this device, and Save downloads it back", "info", 9000);
        }
    }

    /*
        Standalone build: dropping a document on the window opens it.
        This is the whole point of the web edition - somebody was sent a
        .doca and wants to look at it - so it is worth a drop target even
        though the apps already handle drops of their own.

        It listens in the capture phase but only claims the event when every
        dropped file is one this app can open; anything else (an image being
        dropped into the page, say) falls straight through to the app's own
        handler untouched.
    */
    function installStandaloneDropOpen() {
        if (!OfficePlatform.isStandalone()) return;
        var openable = function (name) {
            var e = extOf(name);
            return e === cfg.extension || !!(cfg.importers || {})[e];
        };
        var claims = function (e) {
            var dt = e.dataTransfer;
            if (!dt || !dt.files || dt.files.length !== 1) return false;
            return openable(dt.files[0].name);
        };
        document.addEventListener("dragover", function (e) {
            if (!claims(e)) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "copy";
        }, true);
        document.addEventListener("drop", function (e) {
            if (!claims(e)) return;
            e.preventDefault();
            e.stopPropagation();
            var file = e.dataTransfer.files[0];
            var go = function () { OfficePlatform.adoptDroppedFile(file, openPath); };
            if (dirty) {
                confirmDialog("Discard unsaved changes?",
                    "The current document has unsaved changes that will be lost.",
                    "Discard", "Cancel", function (yes) { if (yes) go(); });
            } else { go(); }
        }, true);
    }

    /* The desktop routes a floatWindow's X button through the iframe's
       ao_module_close() (see ao_module.js + desktop.html: it calls
       contentWindow.ao_module_close() when defined). beforeunload does NOT
       fire when the desktop just removes the iframe, so override that hook
       to confirm before discarding unsaved changes. */
    function installFloatWindowCloseGuard() {
        if (typeof window.ao_module_close !== "function") return;
        var reallyClose = function () {
            markClean();   // never re-prompt while the window tears down
            if (typeof window.ao_module_closeHandler === "function") {
                ao_module_closeHandler();
            }
        };
        window.ao_module_close = function () {
            if (!dirty) { reallyClose(); return; }
            dialog({
                title: "Unsaved changes",
                body: "<b>" + escapeHtml(filename || (cfg.defaultFileName + cfg.extension)) +
                    "</b> has unsaved changes. Close it anyway?",
                dismissable: true,
                buttons: [
                    { label: "Cancel" },
                    {
                        label: "Close without saving", danger: true,
                        action: function (close) { close(); reallyClose(); }
                    },
                    {
                        label: "Save & close", primary: true,
                        // save() only calls back on success, so a failed or
                        // cancelled save leaves the window open
                        action: function (close) { close(); save(reallyClose); }
                    }
                ]
            });
        };
    }

    /* ---------- public API ---------- */
    return {
        init: init,
        // lifecycle
        newDocument: newDocument,
        open: openDialog,
        openPath: openPath,
        save: save,
        saveAs: saveAs,
        markDirty: markDirty,
        isDirty: function () { return dirty; },
        getFilePath: function () { return filepath; },
        getFileName: function () { return filename; },
        getMeta: function () { return meta; },
        wasImported: function () { return loadedFromImport; },
        // ui
        setStatus: setStatus,
        addStatusItem: addStatusItem,
        updateStatusItem: updateStatusItem,
        dialog: dialog,
        confirm: confirmDialog,
        prompt: promptDialog,
        toast: toast,
        showContextMenu: showContextMenu,
        showBusy: showBusy,
        hideBusy: hideBusy,
        closeAllMenus: closeAllMenus,
        updateMenus: updateMenus,
        // features
        registerShortcut: registerShortcut,
        print: printDoc,
        setZoom: setZoom,
        getZoom: function () { return zoom; },
        zoomIn: function () { zoomStep(1); },
        zoomOut: function () { zoomStep(-1); },
        toggleTheme: toggleTheme,
        isDark: isDark,
        // storage
        getSetting: getSetting,
        setSetting: setSetting,
        getRecents: getRecents,
        // host (see common/platform.js)
        hasBackend: function () { return OfficePlatform.hasBackend(); },
        isStandalone: function () { return OfficePlatform.isStandalone(); },
        // vfs / media
        vfsLoad: vfsLoad,
        vfsSave: vfsSave,
        blobToSrc: blobToSrc,
        mediaUrl: mediaUrl,
        agirunLarge: agirunLarge,
        // utils
        escapeHtml: escapeHtml,
        basename: basename,
        dirname: dirname,
        extOf: extOf,
        stripExt: stripExt
    };
})();
