/*
    Pixel Studio - background saving, autosave and crash recovery

    Every save (manual, Save As, export, autosave) runs as one queued job:

        snapshot   capture every canvas as an ImageBitmap (GPU copy, instant)
        encode     the document worker builds the PSD / ORA bytes
        deliver    upload to ArozOS (with progress), download, or store a
                   recovery copy in this browser (IndexedDB)

    The editor stays fully usable meanwhile: there is no modal and no
    full-screen overlay, only a small progress bar in the status bar.
    Clicking it opens the Save Status panel (current job, last save,
    autosave settings, errors with retry).

    Autosave writes the document back to its own file when that is safe
    (a layered file Pixel Studio opened without converting anything);
    otherwise - an untitled document, a flat image, a file opened with
    conversions - it keeps a recovery copy that is offered after a crash.
*/
"use strict";

PS.saveManager = (function () {
    var running = null;         // job in progress
    var queued = null;          // next requested save (latest wins)
    var lastError = null;       // {message, request}
    var lastSaved = null;       // {time, reason, filename}
    var panel = null;           // open Save Status panel
    var timer = null;

    var AUTOSAVE_CHECK_MS = 10000;
    var STAGES = { snapshot: "Preparing", encode: "Encoding", upload: "Uploading", store: "Storing recovery copy", download: "Downloading" };

    function settings() {
        var p = PS.prefs || {};
        return {
            enabled: p.autosave !== false,
            minutes: (typeof p.autosaveMinutes === "number" && p.autosaveMinutes > 0) ? p.autosaveMinutes : 2
        };
    }

    function setSettings(enabled, minutes) {
        PS.prefs = PS.prefs || {};
        PS.prefs.autosave = enabled;
        PS.prefs.autosaveMinutes = minutes;
        PS.savePrefsDebounced();
        renderStatus();
        renderPanel();
    }

    /* ---------- formats ---------- */

    function formatFor(req) {
        var ext = req.format || PS.extOf(req.filename) || "psd";
        if (ext === "jpeg") { ext = "jpg"; }
        if (ext === "psb") { return { kind: "layered", worker: "psd", psb: true, ext: ext, mime: "application/octet-stream" }; }
        if (ext === "psd") { return { kind: "layered", worker: "psd", ext: ext, mime: "application/octet-stream" }; }
        if (ext === "ora") { return { kind: "layered", worker: "ora", ext: ext, mime: "image/openraster" }; }
        return { kind: "flat", ext: ext, mime: ext === "jpg" ? "image/jpeg" : "image/" + ext };
    }

    /* ---------- queue ---------- */

    // req: {filepath, filename, reason: save|saveas|export|download|autosave|recovery, format, quality}
    function save(req) {
        if (!PS.doc) { return; }
        if (running) {
            if (req.reason === "autosave" || req.reason === "recovery") { return; }
            queued = req;
            PS.toast("Save queued - finishing the current save first");
            renderStatus();
            return;
        }
        run(req);
    }

    function run(req) {
        var doc = PS.doc;
        var fmt = formatFor(req);
        var job = {
            req: req,
            doc: doc,
            revision: doc.revision,
            stage: "snapshot",
            progress: 0,
            started: Date.now(),
            silent: req.reason === "autosave" || req.reason === "recovery"
        };
        // "Save" in the close prompt: this save closes the window when it succeeds
        if (PS.closeAfterSave && PS.closeAfterSave.doc === doc &&
            (req.reason === "save" || req.reason === "saveas" || req.reason === "download")) {
            job.closeAfter = true;
            PS.closeAfterSave = null;
        }
        running = job;
        lastError = null;
        update(job, "snapshot", 0.01);

        var produce;
        if (fmt.kind === "layered") {
            produce = PS.buildSaveJob(fmt.worker).then(function (wjob) {
                if (fmt.psb) { wjob.psb = true; }
                update(job, "encode", 0.05);
                return PS.docio.write(wjob, function (p) { update(job, "encode", 0.05 + p * 0.75); });
            }).then(function (res) {
                return new Blob([res.buffer], { type: fmt.mime });
            });
        } else {
            produce = PS.makeFlatBlob(fmt.ext, req.quality);
        }

        produce.then(function (blob) {
            return deliver(job, blob, fmt);
        }).then(function () {
            finish(job, fmt, null);
        }).catch(function (err) {
            finish(job, fmt, err || new Error("Save failed"));
        });
    }

    function deliver(job, blob, fmt) {
        var req = job.req;
        if (req.reason === "recovery") {
            update(job, "store", 0.85);
            return recovery.put(job.doc, blob);
        }
        if (!req.filepath || !PS.inArozOS()) {
            update(job, "download", 0.95);
            PS.downloadBlob(blob, req.filename);
            return Promise.resolve();
        }
        update(job, "upload", 0.8);
        return new Promise(function (resolve, reject) {
            var file = new File([blob], req.filename, { type: blob.type });
            try {
                ao_module_uploadFile(file, PS.dirOf(req.filepath), function () {
                    resolve();
                }, function (pct) {
                    update(job, "upload", 0.8 + 0.2 * (pct / 100));
                }, function (status) {
                    reject(new Error(status === 403 || status === 401
                        ? "permission denied" : "upload failed (HTTP " + status + ")"));
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    function finish(job, fmt, err) {
        running = null;
        var req = job.req;
        var doc = job.doc;
        if (err) {
            console.error(err);
            lastError = { message: err.message || String(err), request: req, time: Date.now() };
            if (!job.silent || req.reason === "autosave") {
                PS.toast((req.reason === "autosave" ? "Autosave failed: " : "Save failed: ") + lastError.message, true);
            }
        } else {
            var stillOpen = doc === PS.doc;
            if (req.reason === "save" || req.reason === "saveas" || req.reason === "autosave" ||
                (req.reason === "download" && fmt.kind === "layered")) {
                if (stillOpen) {
                    if (req.reason === "saveas" && req.filepath) {
                        doc.filePath = req.filepath;
                        doc.fileName = req.filename;
                        doc.format = fmt.ext;
                        // a fresh file of our own: nothing of the original left to protect
                        doc.lossyImport = false;
                    }
                    doc.savedRevision = job.revision;
                    doc.autoRevision = job.revision;
                    if (doc.revision === job.revision) {
                        doc.dirty = false;
                    }
                    PS.updateTitle();
                    PS.updateStatusBar();
                }
                recovery.remove(doc);
            } else if (req.reason === "recovery") {
                if (stillOpen) { doc.autoRevision = job.revision; }
            }
            lastSaved = { time: Date.now(), reason: req.reason, filename: req.filename };
            if (!job.silent) {
                PS.toast(req.reason === "export" ? "Exported " + req.filename
                    : (req.reason === "download" ? "Downloaded " + req.filename : "Saved " + req.filename));
            }
        }
        renderStatus();
        renderPanel();
        if (job.closeAfter && !err && doc === PS.doc && !doc.dirty) {
            PS.reallyClose();
            return;
        }
        if (queued) {
            var next = queued;
            queued = null;
            run(next);
        }
    }

    function update(job, stage, progress) {
        job.stage = stage;
        job.progress = Math.max(job.progress || 0, Math.min(1, progress));
        renderStatus();
        renderPanel();
    }

    /* ---------- autosave ---------- */

    function interacting() {
        return !!(PS._pointer && PS._pointer.down) || !!PS.strokePreview || !!PS.layerOverride ||
            !!PS.movePreview || !!PS.textEdit || !!document.querySelector(".float-panel.live-preview");
    }

    // Where autosave writes: "file" (back to the document's own file) or
    // "recovery" (a copy kept in this browser)
    function autosaveTarget(doc) {
        var ext = PS.extOf(doc.fileName);
        if (doc.filePath && PS.inArozOS() && PS.isLayeredExt(ext) && !doc.lossyImport) { return "file"; }
        return "recovery";
    }

    function tick() {
        var doc = PS.doc;
        var s = settings();
        if (!doc || running || !doc.dirty) { return; }
        if (doc.revision === (doc.autoRevision || 0)) { return; }     // nothing new since the last autosave
        var since = Date.now() - (doc.lastAutoTime || doc.openedAt || 0);
        var target = autosaveTarget(doc);
        // recovery copies are cheap insurance: keep them even with autosave off
        var minutes = s.enabled ? s.minutes : Math.max(s.minutes, 2);
        if (since < minutes * 60000) { return; }
        if (interacting()) { return; }
        doc.lastAutoTime = Date.now();
        if (target === "file" && s.enabled) {
            save({ filepath: doc.filePath, filename: doc.fileName, reason: "autosave" });
        } else {
            save({ filepath: "", filename: (doc.fileName.replace(/\.[^.]+$/, "") || "Untitled") + ".psd", reason: "recovery", format: "psd" });
        }
    }

    function documentOpened() {
        var doc = PS.doc;
        doc.openedAt = Date.now();
        doc.savedRevision = doc.revision;
        doc.autoRevision = doc.revision;
        doc.recoveryKey = "doc-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
        lastError = null;
        renderStatus();
        renderPanel();
    }

    // Save over a file that was opened with conversions: ask first, once
    function confirmLossyOverwrite(then) {
        var doc = PS.doc;
        if (!doc.lossyImport || doc.lossyConfirmed) { then(); return; }
        PS.dialog({
            title: "Overwrite the Original?",
            build: function (body) {
                body.textContent = "\"" + doc.fileName + "\" was opened with conversions (see the notes shown " +
                    "when it opened). Saving over it replaces the original data that could not be kept. " +
                    "Use Save As to keep the original file.";
            },
            buttons: [
                { label: "Cancel" },
                { label: "Save As...", action: function () { setTimeout(PS.fileSaveAs, 0); } },
                {
                    label: "Overwrite", primary: true, action: function () {
                        doc.lossyConfirmed = true;
                        doc.lossyImport = false;
                        then();
                    }
                }
            ]
        });
    }

    /* ---------- recovery copies (IndexedDB, this browser only) ---------- */

    var recovery = (function () {
        var DB = "pixelstudio", STORE = "recovery";
        var dbp = null;

        function open() {
            if (dbp) { return dbp; }
            dbp = new Promise(function (resolve, reject) {
                var r;
                try { r = indexedDB.open(DB, 1); } catch (e) { reject(e); return; }
                r.onupgradeneeded = function () {
                    if (!r.result.objectStoreNames.contains(STORE)) {
                        r.result.createObjectStore(STORE, { keyPath: "key" });
                    }
                };
                r.onsuccess = function () { resolve(r.result); };
                r.onerror = function () { reject(r.error); };
            });
            dbp.catch(function () { dbp = null; });
            return dbp;
        }

        function tx(mode, fn) {
            return open().then(function (db) {
                return new Promise(function (resolve, reject) {
                    var t = db.transaction(STORE, mode);
                    var out = fn(t.objectStore(STORE));
                    t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
                    t.onerror = function () { reject(t.error); };
                    t.onabort = function () { reject(t.error); };
                });
            });
        }

        function put(doc, blob) {
            return tx("readwrite", function (st) {
                return st.put({
                    key: doc.recoveryKey,
                    name: doc.fileName,
                    filePath: doc.filePath,
                    width: doc.width,
                    height: doc.height,
                    time: Date.now(),
                    blob: blob
                });
            }).then(prune);
        }

        function remove(doc) {
            if (!doc || !doc.recoveryKey) { return Promise.resolve(); }
            return tx("readwrite", function (st) { return st.delete(doc.recoveryKey); }).catch(function () { });
        }

        function list() {
            return tx("readonly", function (st) { return st.getAll(); }).then(function (rows) {
                return (rows || []).sort(function (a, b) { return b.time - a.time; });
            }).catch(function () { return []; });
        }

        function removeKey(key) {
            return tx("readwrite", function (st) { return st.delete(key); }).catch(function () { });
        }

        // keep the newest few
        function prune() {
            return list().then(function (rows) {
                return Promise.all(rows.slice(6).map(function (r) { return removeKey(r.key); }));
            });
        }

        return { put: put, remove: remove, list: list, removeKey: removeKey };
    })();

    // Offer recovery copies left by a previous session (crash, closed tab)
    function offerRecovery() {
        recovery.list().then(function (rows) {
            if (!rows.length || PS.doc) { return; }
            PS.dialog({
                title: "Recover Unsaved Artwork",
                build: function (body) {
                    var p = document.createElement("p");
                    p.textContent = "Pixel Studio kept recovery copies of artwork that was not saved:";
                    body.appendChild(p);
                    var list = document.createElement("div");
                    list.className = "recovery-list";
                    rows.forEach(function (r) {
                        var row = document.createElement("div");
                        row.className = "recovery-row";
                        var info = document.createElement("span");
                        info.className = "recovery-info";
                        info.textContent = r.name + "  (" + r.width + " x " + r.height + ", " +
                            new Date(r.time).toLocaleString() + ")";
                        row.appendChild(info);
                        var openBtn = document.createElement("button");
                        openBtn.textContent = "Open";
                        openBtn.addEventListener("click", function () {
                            closeDialog();
                            r.blob.arrayBuffer().then(function (buf) {
                                PS.docio.read(buf, "psd").then(function (result) {
                                    PS.loadDecodedDocument(result, r.filePath || "", r.name);
                                    // still unsaved: keep it dirty and drop the copy once saved
                                    PS.doc.dirty = true;
                                    PS.doc.recoveryKey = r.key;
                                    PS.doc.revision++;
                                    PS.updateTitle();
                                    PS.toast("Recovered " + r.name + " - save it to keep it");
                                });
                            });
                        });
                        var delBtn = document.createElement("button");
                        delBtn.textContent = "Discard";
                        delBtn.addEventListener("click", function () {
                            recovery.removeKey(r.key);
                            row.remove();
                        });
                        row.appendChild(openBtn);
                        row.appendChild(delBtn);
                        list.appendChild(row);
                    });
                    body.appendChild(list);
                },
                buttons: [{ label: "Later", primary: true }]
            });
            function closeDialog() {
                var host = PS.el("dialog-host");
                if (host.lastChild) { host.lastChild.remove(); }
            }
        });
    }

    /* ---------- status bar indicator ---------- */

    function timeAgo(t) {
        var s = Math.round((Date.now() - t) / 1000);
        if (s < 10) { return "just now"; }
        if (s < 60) { return s + " s ago"; }
        if (s < 3600) { return Math.round(s / 60) + " min ago"; }
        return new Date(t).toLocaleTimeString();
    }

    function renderStatus() {
        var el = PS.el("status-save");
        if (!el) { return; }
        el.innerHTML = "";
        el.className = "";
        var doc = PS.doc;
        if (!doc) { return; }
        var label = document.createElement("span");
        label.className = "save-label";
        if (running) {
            el.className = "busy";
            var bar = document.createElement("span");
            bar.className = "save-bar";
            var fill = document.createElement("span");
            fill.style.width = Math.round(running.progress * 100) + "%";
            bar.appendChild(fill);
            el.appendChild(bar);
            label.textContent = (running.req.reason === "autosave" ? "Autosaving " :
                (running.req.reason === "recovery" ? "Recovery copy " : "Saving ")) +
                Math.round(running.progress * 100) + "%";
        } else if (lastError) {
            el.className = "error";
            label.textContent = "Save failed - click for details";
        } else if (doc.dirty) {
            label.textContent = settings().enabled ? "Unsaved changes" : "Unsaved changes (autosave off)";
        } else if (lastSaved) {
            label.textContent = "Saved " + timeAgo(lastSaved.time);
        } else {
            label.textContent = doc.filePath ? "No changes" : "Not saved yet";
        }
        el.appendChild(label);
        el.title = "Save status (click for details)";
    }

    /* ---------- Save Status panel ---------- */

    function openPanel() {
        if (panel && !panel.closed) { panel.close(); panel = null; return; }
        var r = PS.el("status-save").getBoundingClientRect();
        panel = PS.floatingPanel({
            title: "Save Status",
            x: Math.max(8, r.left - 40),
            y: Math.max(8, r.top - 330),
            build: function (body) {
                body.classList.add("save-panel");
                fillPanel(body);
            },
            onClose: function () { panel = null; }
        });
        renderPanel();
    }

    function renderPanel() {
        if (!panel || !panel.root || panel.closed) { return; }
        var body = panel.root.querySelector(".float-panel-body");
        if (body) { fillPanel(body); }
    }

    function row(body, label, value) {
        var r = document.createElement("div");
        r.className = "save-row";
        var l = document.createElement("span");
        l.className = "save-row-label";
        l.textContent = label;
        var v = document.createElement("span");
        v.className = "save-row-value";
        if (value instanceof Node) { v.appendChild(value); } else { v.textContent = value; }
        r.appendChild(l);
        r.appendChild(v);
        body.appendChild(r);
        return v;
    }

    function fillPanel(body) {
        body.innerHTML = "";
        var doc = PS.doc;
        if (!doc) { body.textContent = "No document open."; return; }
        row(body, "Document", doc.fileName);
        row(body, "Location", doc.filePath || "Not saved to a file yet");

        var activity;
        if (running) {
            var wrap = document.createElement("span");
            wrap.className = "save-activity";
            var bar = document.createElement("span");
            bar.className = "save-bar wide";
            var fill = document.createElement("span");
            fill.style.width = Math.round(running.progress * 100) + "%";
            bar.appendChild(fill);
            wrap.appendChild(bar);
            var txt = document.createElement("span");
            txt.textContent = (STAGES[running.stage] || running.stage) + " - " + Math.round(running.progress * 100) + "% (" +
                ({ autosave: "autosave", recovery: "recovery copy", save: "save", saveas: "save as", export: "export", download: "download" }[running.req.reason] || running.req.reason) + ")";
            wrap.appendChild(txt);
            activity = wrap;
        } else {
            activity = queued ? "Waiting to save" : "Idle";
        }
        row(body, "Activity", activity);
        row(body, "Changes", doc.dirty ? "Unsaved changes" : "All changes saved");
        row(body, "Last save", lastSaved
            ? timeAgo(lastSaved.time) + " (" + ({ autosave: "autosave", recovery: "recovery copy", save: "saved", saveas: "saved as", export: "export", download: "download" }[lastSaved.reason] || lastSaved.reason) + ")"
            : "None this session");

        if (lastError) {
            var errWrap = document.createElement("span");
            errWrap.className = "save-error";
            errWrap.textContent = lastError.message + " ";
            var retry = document.createElement("button");
            retry.textContent = "Retry";
            retry.addEventListener("click", function () {
                var req = lastError.request;
                lastError = null;
                save(req);
            });
            errWrap.appendChild(retry);
            row(body, "Error", errWrap);
        }

        // autosave settings
        var s = settings();
        var asWrap = document.createElement("span");
        asWrap.className = "save-autosave";
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = s.enabled;
        cb.addEventListener("change", function () { setSettings(cb.checked, s.minutes); });
        asWrap.appendChild(cb);
        var every = document.createElement("span");
        every.textContent = " every ";
        asWrap.appendChild(every);
        var sel = PS.selectInput([
            { v: "1", l: "1 minute" }, { v: "2", l: "2 minutes" }, { v: "5", l: "5 minutes" },
            { v: "10", l: "10 minutes" }, { v: "30", l: "30 minutes" }
        ], String(s.minutes));
        sel.addEventListener("change", function () { setSettings(cb.checked, parseInt(sel.value, 10)); });
        asWrap.appendChild(sel);
        row(body, "Autosave", asWrap);
        var note = document.createElement("div");
        note.className = "save-note";
        note.textContent = autosaveTarget(doc) === "file"
            ? "Autosave writes this document back to its file in the background."
            : (doc.lossyImport
                ? "This file was opened with conversions, so autosave keeps a recovery copy in this browser instead of overwriting it."
                : "Until the document is saved as a layered file (.psd / .ora), autosave keeps a recovery copy in this browser.");
        body.appendChild(note);

        var btns = document.createElement("div");
        btns.className = "save-buttons";
        var saveNow = document.createElement("button");
        saveNow.textContent = "Save Now";
        saveNow.className = "primary";
        saveNow.disabled = !!running;
        saveNow.addEventListener("click", function () { PS.fileSave(); });
        btns.appendChild(saveNow);
        body.appendChild(btns);
    }

    /* ---------- boot ---------- */

    function init() {
        var el = PS.el("status-save");
        if (el) { el.addEventListener("click", openPanel); }
        if (timer) { clearInterval(timer); }
        timer = setInterval(function () {
            try { tick(); } catch (e) { console.error(e); }
            if (!running) { renderStatus(); }
        }, AUTOSAVE_CHECK_MS);
        window.addEventListener("beforeunload", function (e) {
            if (running || (PS.doc && PS.doc.dirty)) {
                e.preventDefault();
                e.returnValue = "";
            }
        });
        // a closed window or crashed tab leaves the latest edits behind as a
        // recovery copy: take one right away when the page is being hidden
        document.addEventListener("visibilitychange", function () {
            if (document.visibilityState === "hidden" && PS.doc && PS.doc.dirty && !running &&
                PS.doc.revision !== PS.doc.autoRevision && !interacting()) {
                save({ filepath: "", filename: (PS.doc.fileName.replace(/\.[^.]+$/, "") || "Untitled") + ".psd", reason: "recovery", format: "psd" });
            }
        });
        renderStatus();
    }

    return {
        init: init,
        save: save,
        documentOpened: documentOpened,
        confirmLossyOverwrite: confirmLossyOverwrite,
        offerRecovery: offerRecovery,
        openPanel: openPanel,
        renderStatus: renderStatus,
        isBusy: function () { return !!running; },
        autosaveTarget: autosaveTarget,
        settings: settings,
        setSettings: setSettings,
        recovery: recovery
    };
})();
