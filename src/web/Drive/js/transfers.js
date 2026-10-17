/*
    transfers.js

    Uploads and background file operations, with one progress panel in the
    corner of the page (no separate window like the File Manager's
    standalone file operation dialog).

      upload      small files go through the XHR POST endpoint, large ones
                  through the chunked WebSocket channel (script/chunkupload.js,
                  the same client the File Manager and the desktop use);
                  without File Manager they go to fs.agi in hex chunks
      operation   move / copy / zip / unzip tasks started on the server,
                  followed by polling /system/file_system/ongoing
      zip         "download several items" packs them in tmp:/ first and
                  hands the archive to the browser once it is ready
*/

(function (global) {
    "use strict";

    var I = DriveUI.I;
    var esc = DriveUI.esc;
    var API = DriveAPI;

    var POST_CUTOFF = 25 * 1024 * 1024;
    var MAX_PARALLEL = 3;
    var AGI_CHUNK = 2 * 1024 * 1024;
    var AGI_LIMIT = 24 * 1024 * 1024;

    var tasks = [];
    var queue = [];
    var running = 0;
    var collapsed = false;
    var pollTimer = null;
    var seq = 0;
    var refreshTimer = null;

    function newTask(props) {
        var t = $.extend({
            id: "t" + (++seq),
            kind: "upload",
            name: "",
            status: "queued",
            loaded: 0,
            total: 0,
            percent: -1,
            error: "",
            abort: null,
            started: Date.now()
        }, props);
        tasks.unshift(t);
        show();
        return t;
    }

    function finished(t) {
        return t.status == "done" || t.status == "error" || t.status == "cancelled";
    }

    //Refresh the listing once when a batch of changes lands
    function softRefresh() {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(function () {
            Drive.refresh();
            Drive.refreshQuota();
        }, 400);
    }

    /* ------------------------------------------------------------------ */
    /*  Panel                                                              */
    /* ------------------------------------------------------------------ */
    function show() {
        var panel = document.getElementById("transfers");
        panel.hidden = false;
        render();
    }

    function hide() {
        var active = tasks.filter(function (t) { return !finished(t); });
        if (active.length) {
            DriveUI.confirm({
                title: T("xfer/cancelAllTitle", "Cancel transfers?"),
                message: T("xfer/cancelAllText", "{n} transfers are still running. Cancel them?", { n: active.length }),
                ok: T("xfer/cancelAll", "Cancel transfers"), danger: true
            }).then(function (ok) {
                if (!ok) {
                    return;
                }
                active.forEach(cancel);
                tasks = [];
                document.getElementById("transfers").hidden = true;
            });
            return;
        }
        tasks = [];
        document.getElementById("transfers").hidden = true;
    }

    function cancel(t) {
        if (finished(t)) {
            return;
        }
        if (t.status == "queued") {
            queue = queue.filter(function (q) { return q.task !== t; });
        }
        if (t.abort) {
            try { t.abort(); } catch (e) { }
        }
        t.status = "cancelled";
        render();
    }

    function headline() {
        var active = tasks.filter(function (t) { return !finished(t); });
        var failed = tasks.filter(function (t) { return t.status == "error"; });
        var uploads = active.filter(function (t) { return t.kind == "upload"; }).length;
        if (active.length) {
            if (uploads == active.length) {
                return T("xfer/uploadingN", "Uploading {n} items", { n: active.length });
            }
            return T("xfer/workingN", "{n} transfers in progress", { n: active.length });
        }
        if (failed.length) {
            return T("xfer/failedN", "{n} items failed", { n: failed.length });
        }
        return T("xfer/doneN", "{n} transfers complete", { n: tasks.length });
    }

    function remainingText() {
        var active = tasks.filter(function (t) { return t.status == "running" && t.kind == "upload" && t.total > 0; });
        if (!active.length) {
            return "";
        }
        var loaded = 0, total = 0, elapsed = 0;
        active.forEach(function (t) {
            loaded += t.loaded;
            total += t.total;
            elapsed = Math.max(elapsed, (Date.now() - t.started) / 1000);
        });
        if (loaded <= 0 || elapsed < 2) {
            return "";
        }
        var rate = loaded / elapsed;
        var left = (total - loaded) / rate;
        if (!isFinite(left) || left > 86400) {
            return "";
        }
        if (left < 60) {
            return T("xfer/secondsLeft", "{n} s left", { n: Math.max(1, Math.round(left)) });
        }
        return T("xfer/minutesLeft", "{n} min left", { n: Math.round(left / 60) });
    }

    function statusText(t) {
        switch (t.status) {
            case "queued": return T("xfer/queued", "Waiting");
            case "processing": return t.note || T("xfer/processing", "Finishing up");
            case "done": return t.doneText || T("xfer/done", "Done");
            case "cancelled": return T("xfer/cancelled", "Cancelled");
            case "error": return t.error || T("xfer/failed", "Failed");
        }
        if (t.total > 0) {
            return DriveUI.fmtSize(t.loaded) + " / " + DriveUI.fmtSize(t.total);
        }
        if (t.percent >= 0) {
            return Math.round(t.percent) + "%";
        }
        return t.note || T("xfer/working", "Working");
    }

    function percentOf(t) {
        if (t.total > 0) {
            return Math.min(100, t.loaded / t.total * 100);
        }
        return t.percent;
    }

    function render() {
        var panel = document.getElementById("transfers");
        if (panel.hidden) {
            return;
        }
        panel.classList.toggle("collapsed", collapsed);
        var rem = remainingText();
        var html = '<div class="transfers-head"><b>' + esc(headline()) + (rem ? '<small>' + esc(rem) + '</small>' : "") + '</b>' +
            '<button class="icon-btn small" data-act="collapse" title="' + esc(collapsed ? T("xfer/expand", "Expand") : T("xfer/collapse", "Collapse")) + '">' +
            I(collapsed ? "chevronUp" : "chevronDown") + '</button>' +
            '<button class="icon-btn small" data-act="close" title="' + esc(T("common/close", "Close")) + '">' + I("x") + '</button></div>' +
            '<div class="transfers-list scroll-y">';
        tasks.forEach(function (t) {
            var pct = percentOf(t);
            var stateIcon = "";
            if (t.status == "done") {
                stateIcon = '<span class="state-ic ok">' + I("check") + '</span>';
            } else if (t.status == "error") {
                stateIcon = '<span class="state-ic bad" title="' + esc(t.error) + '">' + I("alert") + '</span>';
            } else if (t.status == "cancelled") {
                stateIcon = '<span class="state-ic">' + I("x") + '</span>';
            }
            var bar = "";
            if (t.status == "running" || t.status == "processing") {
                bar = '<div class="bar' + (pct < 0 || t.status == "processing" ? " indeterminate" : "") + '"><i style="width:' + Math.max(0, pct) + '%"></i></div>';
            }
            var actions = "";
            if (!finished(t)) {
                actions = '<button class="icon-btn small" data-cancel="' + t.id + '" title="' + esc(T("common/cancel", "Cancel")) + '">' + I("x") + '</button>';
            } else if (t.status == "done" && t.link) {
                actions = '<a class="icon-btn small" href="' + esc(t.link) + '" download="' + esc(t.linkName || "") + '" title="' + esc(T("xfer/downloadAgain", "Download again")) + '">' + I("download") + '</a>';
            } else if (t.status == "done" && t.folder) {
                actions = '<button class="icon-btn small" data-open="' + t.id + '" title="' + esc(T("xfer/showFolder", "Show in folder")) + '">' + I("folderOpen") + '</button>';
            } else if (t.status == "error" && t.retry) {
                actions = '<button class="icon-btn small" data-retry="' + t.id + '" title="' + esc(T("common/retry", "Try again")) + '">' + I("refresh") + '</button>';
            }
            var icon = t.icon ? '<span class="ft-box"><span class="ic-wrap" style="color:var(--accent-text)">' + I(t.icon, { size: 24 }) + '</span></span>' :
                '<span class="ft-box">' + DriveIcons.file(t.name, false) + '</span>';
            html += '<div class="xfer">' + icon + '<div class="body"><b title="' + esc(t.name) + '">' + esc(t.name) + '</b>' +
                '<small class="' + (t.status == "error" ? "err" : "") + '">' + esc(statusText(t)) + '</small>' + bar + '</div>' +
                stateIcon + actions + '</div>';
        });
        html += '</div>';
        panel.innerHTML = html;
        panel.querySelector('[data-act="collapse"]').addEventListener("click", function () {
            collapsed = !collapsed;
            render();
        });
        panel.querySelector('[data-act="close"]').addEventListener("click", hide);
        panel.querySelectorAll("[data-cancel]").forEach(function (b) {
            b.addEventListener("click", function () {
                var t = tasks.filter(function (x) { return x.id == b.getAttribute("data-cancel"); })[0];
                if (t) {
                    cancel(t);
                }
            });
        });
        panel.querySelectorAll("[data-retry]").forEach(function (b) {
            b.addEventListener("click", function () {
                var t = tasks.filter(function (x) { return x.id == b.getAttribute("data-retry"); })[0];
                if (t && t.retry) {
                    tasks.splice(tasks.indexOf(t), 1);
                    t.retry();
                }
            });
        });
        panel.querySelectorAll("[data-open]").forEach(function (b) {
            b.addEventListener("click", function () {
                var t = tasks.filter(function (x) { return x.id == b.getAttribute("data-open"); })[0];
                if (t && t.folder) {
                    location.hash = Drive.folderRoute(t.folder);
                }
            });
        });
    }

    //A timer rather than requestAnimationFrame: rAF stops in a background
    //tab, which left rows frozen at 0% until the tab was shown again
    var renderPending = false;
    function renderSoon() {
        if (renderPending) {
            return;
        }
        renderPending = true;
        setTimeout(function () {
            renderPending = false;
            render();
        }, 60);
    }

    /* ------------------------------------------------------------------ */
    /*  Uploads                                                            */
    /* ------------------------------------------------------------------ */
    //entries: [{file, dir}] where dir is the target folder of that file
    function uploadEntries(entries) {
        if (!entries.length) {
            return;
        }
        if (!API.caps.fm) {
            var tooBig = entries.filter(function (e) { return e.file.size > AGI_LIMIT; });
            if (tooBig.length) {
                DriveUI.toast(T("xfer/tooBigReduced", "{n} files are larger than 24 MB and need the File Manager permission to upload", { n: tooBig.length }), { type: "error" });
                entries = entries.filter(function (e) { return e.file.size <= AGI_LIMIT; });
            }
        }
        entries.forEach(function (e) {
            var task = newTask({ kind: "upload", name: e.file.name, total: e.file.size, folder: e.dir });
            queue.push({ task: task, file: e.file, dir: e.dir });
        });
        pump();
        render();
    }

    function pump() {
        while (running < MAX_PARALLEL && queue.length) {
            var job = queue.shift();
            if (job.task.status == "cancelled") {
                continue;
            }
            running++;
            startUpload(job);
        }
    }

    function jobEnded() {
        running = Math.max(0, running - 1);
        pump();
        renderSoon();
        softRefresh();
    }

    function startUpload(job) {
        var t = job.task;
        t.status = "running";
        t.started = Date.now();
        t.retry = function () {
            uploadEntries([{ file: job.file, dir: job.dir }]);
        };
        DriveAPI.recentAdd(DriveAPI.joinPath(job.dir, job.file.name));
        if (!API.caps.fm) {
            uploadViaAGI(job);
        } else if (job.file.size > POST_CUTOFF && global.ChunkUpload) {
            uploadViaSocket(job);
        } else {
            uploadViaPost(job);
        }
        renderSoon();
    }

    function uploadViaPost(job) {
        var t = job.task;
        var xhr = new XMLHttpRequest();
        var form = new FormData();
        form.append("file", job.file, job.file.name);
        form.append("path", job.dir);
        var ended = false;
        function end() {
            if (!ended) {
                ended = true;
                jobEnded();
            }
        }
        t.abort = function () {
            xhr.abort();
            end();
        };
        xhr.upload.addEventListener("progress", function (e) {
            if (e.lengthComputable) {
                t.loaded = e.loaded;
                t.total = e.total;
                if (e.loaded >= e.total) {
                    t.status = "processing";
                }
                renderSoon();
            }
        });
        xhr.addEventListener("load", function () {
            if (t.status == "cancelled") {
                return end();
            }
            var resp = null;
            try {
                resp = JSON.parse(xhr.responseText);
            } catch (e) {
                resp = null;
            }
            if (xhr.status == 200 && !(resp && resp.error)) {
                t.status = "done";
                t.loaded = t.total;
            } else {
                t.status = "error";
                t.error = resp && resp.error ? T("srv/" + resp.error, resp.error) : T("xfer/uploadFailed", "Upload failed (the file may be too big or the disk full)");
            }
            end();
        });
        xhr.addEventListener("error", function () {
            if (t.status != "cancelled") {
                t.status = "error";
                t.error = T("err/network", "Cannot reach the server");
            }
            end();
        });
        xhr.open("POST", API.ROOT + "system/file_system/upload?path=" + encodeURIComponent(job.dir));
        xhr.send(form);
    }

    function socketBase() {
        var secure = location.protocol == "https:";
        var port = location.port || (secure ? "443" : "80");
        return (secure ? "wss://" : "ws://") + location.hostname + ":" + port;
    }

    function uploadViaSocket(job) {
        var t = job.task;
        var ended = false;
        function end() {
            if (!ended) {
                ended = true;
                jobEnded();
            }
        }
        var url = socketBase() + "/system/file_system/lowmemUpload?filename=" +
            encodeURIComponent(encodeURIComponent(job.file.name)) + "&path=" + encodeURIComponent(job.dir);
        var ctl = ChunkUpload.start({
            url: url,
            file: job.file,
            chunkSize: 1024 * 1024,
            windowSize: 8 * 1024 * 1024,
            ackTimeout: 30000,
            maxRetries: 3,
            pingInterval: 20000,
            onProgress: function (loaded, total) {
                t.loaded = loaded;
                t.total = total;
                renderSoon();
            },
            onProcessing: function () {
                t.status = "processing";
                renderSoon();
            },
            onMove: function (status) {
                t.status = "processing";
                t.note = typeof status === "string" ? status : "";
                renderSoon();
            },
            onDone: function () {
                t.status = "done";
                t.loaded = t.total;
                end();
            },
            onError: function (message) {
                if (t.status != "cancelled") {
                    t.status = "error";
                    t.error = message || T("xfer/failed", "Failed");
                }
                end();
            },
            onClose: function () {
                if (!finished(t)) {
                    t.status = "error";
                    t.error = T("xfer/connectionLost", "Connection lost");
                }
                end();
            },
            onSocketError: function () {
                if (!finished(t)) {
                    t.status = "error";
                    t.error = T("xfer/connectionLost", "Connection lost");
                }
                end();
            }
        });
        t.abort = function () {
            ctl.abort();
            end();
        };
    }

    function toHex(buffer) {
        var bytes = new Uint8Array(buffer);
        var hex = new Array(bytes.length);
        for (var i = 0; i < bytes.length; i++) {
            hex[i] = (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
        }
        return hex.join("");
    }

    function uploadViaAGI(job) {
        var t = job.task;
        var file = job.file;
        var chunks = Math.max(1, Math.ceil(file.size / AGI_CHUNK));
        var index = 0;
        var target = null;
        var cancelled = false;
        t.abort = function () {
            cancelled = true;
            jobEnded();
        };
        function next() {
            if (cancelled) {
                return;
            }
            if (index >= chunks) {
                t.status = "done";
                t.loaded = t.total;
                jobEnded();
                return;
            }
            var blob = file.slice(index * AGI_CHUNK, Math.min(file.size, (index + 1) * AGI_CHUNK));
            blob.arrayBuffer().then(function (buf) {
                var data = { opr: "upload", dir: job.dir, name: file.name, index: index, total: file.size, chunk: toHex(buf) };
                if (target) {
                    data.target = target;
                }
                return API.agi("fs.agi", data);
            }).then(function (r) {
                if (r && r.path) {
                    target = r.path;
                }
                index++;
                t.loaded = Math.min(file.size, index * AGI_CHUNK);
                renderSoon();
                next();
            }).catch(function (err) {
                if (!cancelled) {
                    t.status = "error";
                    t.error = err.message;
                    jobEnded();
                }
            });
        }
        next();
    }

    /* Picking and dropping ------------------------------------------------- */
    function pick(targetDir, folder) {
        var input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        if (folder) {
            input.webkitdirectory = true;
            input.setAttribute("webkitdirectory", "");
            input.setAttribute("directory", "");
        }
        input.style.display = "none";
        input.addEventListener("change", function () {
            var files = Array.prototype.slice.call(input.files || []);
            input.remove();
            if (!files.length) {
                return;
            }
            var entries = files.map(function (f) {
                var rel = f.webkitRelativePath || "";
                var dir = targetDir;
                if (rel && rel.indexOf("/") > 0) {
                    dir = Drive.normDir(targetDir + rel.substring(0, rel.lastIndexOf("/")));
                }
                return { file: f, dir: dir };
            });
            uploadEntries(entries);
        });
        document.body.appendChild(input);
        input.click();
    }

    function readAllEntries(reader) {
        return new Promise(function (resolve) {
            var all = [];
            function more() {
                reader.readEntries(function (batch) {
                    if (!batch.length) {
                        resolve(all);
                        return;
                    }
                    all = all.concat(Array.prototype.slice.call(batch));
                    more();
                }, function () { resolve(all); });
            }
            more();
        });
    }

    function walkEntry(entry, dir, out) {
        if (entry.isFile) {
            return new Promise(function (resolve) {
                entry.file(function (f) {
                    out.push({ file: f, dir: dir });
                    resolve();
                }, function () { resolve(); });
            });
        }
        if (entry.isDirectory) {
            var sub = Drive.normDir(dir + entry.name);
            return readAllEntries(entry.createReader()).then(function (children) {
                if (!children.length) {
                    //Keep empty folders too
                    return API.mkdir(dir, entry.name).catch(function () { });
                }
                return children.reduce(function (p, child) {
                    return p.then(function () { return walkEntry(child, sub, out); });
                }, Promise.resolve());
            });
        }
        return Promise.resolve();
    }

    function fromDataTransfer(dt, targetDir) {
        if (!Drive.isWritable(targetDir)) {
            DriveUI.toast(T("err/readonly", "This location is read only"), { type: "error" });
            return;
        }
        var items = dt.items ? Array.prototype.slice.call(dt.items) : [];
        var entries = items.map(function (i) {
            return i.kind == "file" && i.webkitGetAsEntry ? i.webkitGetAsEntry() : null;
        }).filter(Boolean);
        if (!entries.length) {
            uploadEntries(Array.prototype.slice.call(dt.files || []).map(function (f) { return { file: f, dir: targetDir }; }));
            return;
        }
        var out = [];
        Promise.all(entries.map(function (en) { return walkEntry(en, targetDir, out); })).then(function () {
            uploadEntries(out);
            if (!out.length) {
                softRefresh();
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Server side operations                                             */
    /* ------------------------------------------------------------------ */
    var OP_LABEL = {
        move: ["xfer/moving", "Moving {name}"], copy: ["xfer/copying", "Copying {name}"],
        zip: ["xfer/zipping", "Compressing {name}"], unzip: ["xfer/unzipping", "Extracting {name}"]
    };
    var OP_ICON = { move: "move", copy: "copy", zip: "archive", unzip: "extract" };

    function describe(opr, items) {
        var name = items.length == 1 ? items[0].name : T("drag/items", "{n} items", { n: items.length });
        var l = OP_LABEL[opr] || ["xfer/working", "Working"];
        return T(l[0], l[1], { name: name });
    }

    /*
        operation(opr, items, dest, existsresp, opts) -> Promise resolved when
        the server finishes. opts.doneText replaces "Done" on the row.
    */
    function operation(opr, items, dest, existsresp, opts) {
        opts = opts || {};
        var task = newTask({
            kind: "op", name: describe(opr, items), icon: OP_ICON[opr] || "file", status: "running",
            percent: 0, folder: opts.folder || dest, doneText: opts.doneText
        });
        render();
        return API.startOperation(opr, items.map(function (i) { return i.path; }), dest, existsresp).then(function (r) {
            if (r && r.sync) {
                task.status = "done";
                renderSoon();
                softRefresh();
                return;
            }
            return follow(task, r.oprid);
        }).catch(function (err) {
            task.status = "error";
            task.error = err.message;
            renderSoon();
            throw err;
        });
    }

    var followers = {};

    function follow(task, oprid) {
        return new Promise(function (resolve, reject) {
            task.oprid = oprid;
            task.misses = 0;
            task.abort = function () {
                API.controlOperation(oprid, "cancel").catch(function () { });
            };
            followers[oprid] = { task: task, resolve: resolve, reject: reject };
            startPolling();
        });
    }

    function startPolling() {
        if (pollTimer) {
            return;
        }
        poll();
        pollTimer = setInterval(poll, 1000);
    }

    function poll() {
        var ids = Object.keys(followers);
        if (!ids.length) {
            clearInterval(pollTimer);
            pollTimer = null;
            return;
        }
        API.ongoing().then(function (list) {
            if (!Array.isArray(list)) {
                return;
            }
            var byId = {};
            list.forEach(function (x) { byId[x.ID] = x; });
            ids.forEach(function (id) {
                var f = followers[id];
                var t = f.task;
                var rec = byId[id];
                if (t.status == "cancelled") {
                    delete followers[id];
                    f.reject(new Error(T("xfer/cancelled", "Cancelled")));
                    return;
                }
                if (!rec) {
                    //Finished records drop out after a few seconds
                    t.misses++;
                    if (t.misses >= 3) {
                        t.status = "done";
                        delete followers[id];
                        f.resolve();
                        softRefresh();
                    }
                    return;
                }
                t.misses = 0;
                if (rec.Status == "completed") {
                    t.status = "done";
                    t.percent = 100;
                    delete followers[id];
                    API.controlOperation(id, "remove").catch(function () { });
                    f.resolve(rec);
                    softRefresh();
                } else if (rec.Status == "error") {
                    t.status = "error";
                    t.error = rec.Error || T("xfer/failed", "Failed");
                    delete followers[id];
                    f.reject(new Error(t.error));
                    softRefresh();
                } else if (rec.Status == "cancelled") {
                    t.status = "cancelled";
                    delete followers[id];
                    f.reject(new Error(T("xfer/cancelled", "Cancelled")));
                    softRefresh();
                } else {
                    t.percent = rec.Progress || 0;
                    if (rec.TotalSize > 0) {
                        t.total = rec.TotalSize;
                        t.loaded = rec.DoneSize;
                    }
                    t.note = rec.LatestFile ? DriveAPI.baseName(rec.LatestFile) : "";
                }
            });
            renderSoon();
        }).catch(function () { });
    }

    /* Zip and download ------------------------------------------------------ */
    function zipDownload(items) {
        var name = items.length == 1 ? items[0].name + ".zip" : "download.zip";
        var task = newTask({ kind: "op", name: T("xfer/preparing", "Preparing {name}", { name: name }), icon: "archive", status: "running", percent: 0 });
        render();
        API.zipForDownload(items.map(function (i) { return i.path; })).then(function (r) {
            return follow(task, r.oprid).then(function () {
                var url = API.downloadURL(r.dest);
                task.status = "done";
                task.name = name;
                task.link = url;
                task.linkName = name;
                renderSoon();
                saveURL(url, name);
            });
        }).catch(function (err) {
            if (task.status != "cancelled") {
                task.status = "error";
                task.error = err.message;
                renderSoon();
            }
        });
    }

    function saveURL(url, name) {
        var a = document.createElement("a");
        a.href = url;
        a.download = name || "";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { a.remove(); }, 1000);
    }

    global.DriveTransfers = {
        pick: pick,
        uploadEntries: uploadEntries,
        fromDataTransfer: fromDataTransfer,
        operation: operation,
        zipDownload: zipDownload,
        saveURL: saveURL,
        hasActive: function () {
            return tasks.some(function (t) { return !finished(t); });
        }
    };

    window.addEventListener("beforeunload", function (e) {
        if (tasks.some(function (t) { return t.kind == "upload" && !finished(t); })) {
            e.preventDefault();
            e.returnValue = "";
        }
    });
})(window);
