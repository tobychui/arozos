/*
    Cine Studio - media pool

    Imports media from the ArozOS file system (virtual paths streamed
    through the /media endpoint) or from the local device (uploaded to
    user:/Cine Studio/Media so projects stay portable). Probes duration,
    dimensions, filmstrip thumbnails and audio waveform peaks.
*/
"use strict";

window.CS = window.CS || {};

CS.media = {

    /* ---------- source resolution ---------- */

    mediaURL: function (media) {
        if (media.vpath) { return "../media?file=" + encodeURIComponent(media.vpath); }
        return media.blobUrl || "";
    },

    typeFromExt: function (ext) {
        if (CS.VIDEO_EXTS.indexOf(ext) >= 0) { return "video"; }
        if (CS.AUDIO_EXTS.indexOf(ext) >= 0) { return "audio"; }
        if (CS.IMAGE_EXTS.indexOf(ext) >= 0) { return "image"; }
        return null;
    },

    acceptedExts: function () {
        return CS.VIDEO_EXTS.concat(CS.AUDIO_EXTS).concat(CS.IMAGE_EXTS);
    },

    /* ---------- import entry points ---------- */

    importDialog: function (anchorEl) {
        if (!CS.inArozOS()) { CS.media.importLocal(); return; }
        var items = [
            { label: "From ArozOS...", icon: "server", action: CS.media.importFromArozOS },
            { label: "From this device...", icon: "upload", action: CS.media.importLocal }
        ];
        if (anchorEl) { CS.showMenuUnder(anchorEl, items); }
        else { CS.media.importFromArozOS(); }
    },

    importFromArozOS: function () {
        window.csImportCallback = function csImportCallback(filedata) {
            if (!filedata || !filedata.length) { return; }
            filedata.forEach(function (f) {
                CS.media.addFromVpath(f.filepath, f.filename);
            });
        };
        ao_module_openFileSelector(window.csImportCallback, "user:/Desktop", "file", true, {
            filter: CS.media.acceptedExts()
        });
    },

    importLocal: function () {
        var inp = document.getElementById("local-file-input");
        inp.value = "";
        inp.onchange = function () {
            var files = Array.prototype.slice.call(inp.files);
            if (!files.length) { return; }
            if (CS.inArozOS()) {
                CS.media.uploadLocalFiles(files);
            } else {
                //Standalone fallback: keep the files in memory as blob URLs
                files.forEach(function (file) {
                    var ext = CS.extOf(file.name);
                    if (!CS.media.typeFromExt(ext)) { return; }
                    CS.media.register({
                        name: file.name,
                        blobUrl: URL.createObjectURL(file),
                        type: CS.media.typeFromExt(ext)
                    });
                });
            }
        };
        inp.click();
    },

    //Upload device files into the app media folder, then register the vpaths
    uploadLocalFiles: function (files) {
        var targetDir = CS.APP_ROOT + "/Media";
        var remaining = files.length;
        CS.toast("Uploading " + files.length + " file" + (files.length > 1 ? "s" : "") + "...");
        files.forEach(function (file) {
            var ext = CS.extOf(file.name);
            if (!CS.media.typeFromExt(ext)) {
                remaining--;
                CS.toast("Skipped unsupported file: " + file.name, true);
                return;
            }
            ao_module_uploadFile(file, targetDir, function () {
                remaining--;
                CS.media.addFromVpath(targetDir + "/" + file.name, file.name);
                if (remaining === 0) { CS.toast("Upload complete"); }
            }, undefined, function () {
                remaining--;
                CS.toast("Upload failed: " + file.name, true);
            });
        });
    },

    addFromVpath: function (vpath, filename) {
        //Ignore duplicates of the same virtual path
        for (var i = 0; i < CS.project.media.length; i++) {
            if (CS.project.media[i].vpath === vpath) {
                CS.toast(filename + " is already in the project");
                return CS.project.media[i];
            }
        }
        var ext = CS.extOf(filename);
        var type = CS.media.typeFromExt(ext);
        if (ext === CS.PROJECT_EXT) {
            CS.fileio.openFromPath(vpath, filename);
            return null;
        }
        if (!type) {
            CS.toast("Unsupported file type: ." + ext, true);
            return null;
        }
        return CS.media.register({ name: filename, vpath: vpath, type: type });
    },

    //Create the media entry, kick off probing, refresh the bin
    register: function (spec) {
        var media = {
            id: CS.uid(),
            name: spec.name,
            vpath: spec.vpath || "",
            blobUrl: spec.blobUrl || "",
            type: spec.type,
            duration: spec.type === "image" ? CS.IMAGE_DEFAULT_DURATION : 0,
            width: 0,
            height: 0,
            thumbs: [],
            peaks: null,
            offline: false,
            probed: false
        };
        CS.project.media.push(media);
        CS.markDirty();
        CS.media.renderBin();
        CS.media.probe(media);
        return media;
    },

    /* ---------- probing ---------- */

    probe: function (media) {
        if (media.type === "video") { CS.media.probeVideo(media); }
        else if (media.type === "audio") { CS.media.probeAudio(media); }
        else { CS.media.probeImage(media); }
    },

    probeImage: function (media) {
        var img = new Image();
        img.onload = function () {
            media.width = img.naturalWidth;
            media.height = img.naturalHeight;
            var c = document.createElement("canvas");
            c.width = 160;
            c.height = 100;
            var ctx = c.getContext("2d");
            CS.media.drawCover(ctx, img, img.naturalWidth, img.naturalHeight, 160, 100);
            media.thumbs = [c.toDataURL("image/jpeg", 0.72)];
            media.probed = true;
            CS.media.renderBin();
            CS.timeline.render();
            CS.player.invalidate();
        };
        img.onerror = function () { CS.media.markOffline(media); };
        img.src = CS.media.mediaURL(media);
    },

    probeVideo: function (media) {
        var v = document.createElement("video");
        v.preload = "auto";
        v.muted = true;
        var frameTargets = null;
        var thumbs = [];
        var canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 100;
        var ctx = canvas.getContext("2d");

        function beginFrames() {
            media.duration = v.duration && isFinite(v.duration) ? v.duration : 0;
            media.width = v.videoWidth;
            media.height = v.videoHeight;
            //Grab up to 5 frames spread across the clip for the filmstrip
            var n = Math.min(5, Math.max(1, Math.floor(media.duration)));
            frameTargets = [];
            for (var i = 0; i < n; i++) {
                frameTargets.push(Math.max(0.01, media.duration * (i + 0.5) / n));
            }
            v.currentTime = frameTargets[0];
        }

        v.addEventListener("loadedmetadata", function () {
            if (!isFinite(v.duration)) {
                //Streamed / MediaRecorder-produced webm reports Infinity
                //until a far seek forces the real duration to be resolved
                var onDur = function () {
                    if (isFinite(v.duration) && frameTargets === null) {
                        v.removeEventListener("durationchange", onDur);
                        beginFrames();
                    }
                };
                v.addEventListener("durationchange", onDur);
                v.currentTime = 1e10;
                return;
            }
            beginFrames();
        });
        v.addEventListener("seeked", function () {
            if (frameTargets === null) { return; }
            try {
                CS.media.drawCover(ctx, v, v.videoWidth, v.videoHeight, 160, 100);
                thumbs.push(canvas.toDataURL("image/jpeg", 0.7));
            } catch (e) { /* tainted or decode issue: keep going */ }
            media.thumbs = thumbs.slice();
            CS.media.renderBin();
            CS.timeline.render();
            if (thumbs.length < frameTargets.length) {
                v.currentTime = frameTargets[thumbs.length];
            } else {
                media.probed = true;
                v.removeAttribute("src");
                v.load();
                CS.player.invalidate();
            }
        });
        v.addEventListener("error", function () { CS.media.markOffline(media); });
        v.src = CS.media.mediaURL(media);
    },

    probeAudio: function (media) {
        var a = document.createElement("audio");
        a.preload = "metadata";
        var done = false;
        function finish() {
            if (done) { return; }
            done = true;
            media.duration = a.duration && isFinite(a.duration) ? a.duration : 0;
            media.probed = true;
            CS.media.renderBin();
            CS.timeline.render();
            CS.media.computePeaks(media);
        }
        a.addEventListener("loadedmetadata", function () {
            if (!isFinite(a.duration)) {
                //Force duration discovery on streamed containers
                var onDur = function () {
                    if (isFinite(a.duration)) {
                        a.removeEventListener("durationchange", onDur);
                        finish();
                    }
                };
                a.addEventListener("durationchange", onDur);
                a.currentTime = 1e10;
                return;
            }
            finish();
        });
        a.addEventListener("error", function () { CS.media.markOffline(media); });
        a.src = CS.media.mediaURL(media);
    },

    //Decode the audio and reduce it to ~600 min/max pairs for waveform drawing
    computePeaks: function (media) {
        fetch(CS.media.mediaURL(media))
            .then(function (r) {
                if (!r.ok) { throw new Error("HTTP " + r.status); }
                return r.arrayBuffer();
            })
            .then(function (buf) {
                var AC = window.AudioContext || window.webkitAudioContext;
                var ctx = new AC();
                return ctx.decodeAudioData(buf).then(function (audio) {
                    ctx.close();
                    return audio;
                });
            })
            .then(function (audio) {
                //The decoder knows the exact duration - trust it over metadata
                if (audio.duration && isFinite(audio.duration)) {
                    media.duration = audio.duration;
                }
                var ch = audio.getChannelData(0);
                var bins = 600;
                var step = Math.max(1, Math.floor(ch.length / bins));
                var peaks = new Array(bins);
                for (var i = 0; i < bins; i++) {
                    var start = i * step;
                    var max = 0;
                    //Sample sparsely inside each bin: enough for a visual waveform
                    for (var j = start; j < start + step && j < ch.length; j += 16) {
                        var v = Math.abs(ch[j]);
                        if (v > max) { max = v; }
                    }
                    peaks[i] = max;
                }
                media.peaks = peaks;
                CS.media.renderBin();
                CS.timeline.render();
            })
            .catch(function () {
                media.peaks = null; //waveform stays flat, playback still works
            });
    },

    markOffline: function (media) {
        media.offline = true;
        media.probed = true;
        CS.media.renderBin();
        CS.timeline.render();
        CS.toast("Media offline: " + media.name, true);
    },

    //object-fit: cover for canvas drawing
    drawCover: function (ctx, src, sw, sh, dw, dh) {
        if (!sw || !sh) { return; }
        var scale = Math.max(dw / sw, dh / sh);
        var w = sw * scale, h = sh * scale;
        ctx.drawImage(src, (dw - w) / 2, (dh - h) / 2, w, h);
    },

    /* ---------- media bin rendering ---------- */

    filteredMedia: function () {
        var kind = CS.state.binKind;
        var q = (CS.state.binSearch || "").toLowerCase();
        return CS.project.media.filter(function (m) {
            if (kind !== "all" && m.type !== kind) { return false; }
            if (q && m.name.toLowerCase().indexOf(q) < 0) { return false; }
            return true;
        });
    },

    renderBin: function () {
        var grid = document.getElementById("bin-grid");
        grid.innerHTML = "";
        grid.classList.toggle("list-mode", CS.state.binView === "list");
        var items = CS.media.filteredMedia();

        if (items.length === 0) {
            var hint = document.createElement("div");
            hint.className = "bin-empty-hint";
            hint.textContent = CS.project.media.length === 0
                ? "No media yet. Click Import to add video, audio or images from ArozOS or this device."
                : "No media matches the current filter.";
            grid.appendChild(hint);
        }

        items.forEach(function (m) {
            var item = document.createElement("div");
            item.className = "bin-item" + (CS.state.selectedMediaId === m.id ? " selected" : "");
            item.setAttribute("draggable", "true");

            var thumb = document.createElement("div");
            thumb.className = "bin-thumb";
            if (m.type === "audio") {
                thumb.classList.add("audio-thumb");
                var wave = document.createElement("canvas");
                wave.width = 156;
                wave.height = 96;
                CS.media.drawWave(wave.getContext("2d"), m.peaks, 156, 96, "#35c98b");
                thumb.appendChild(wave);
            } else if (m.thumbs.length) {
                thumb.style.backgroundImage = "url('" + m.thumbs[0] + "')";
            } else {
                thumb.innerHTML = '<span data-icon="' + (m.type === "image" ? "image" : "film") + '"></span>';
            }

            if (m.type !== "image") {
                var dur = document.createElement("span");
                dur.className = "duration";
                dur.textContent = CS.shortDuration(m.duration);
                thumb.appendChild(dur);
            }
            if (m.offline) {
                var badge = document.createElement("span");
                badge.className = "offline-badge";
                badge.innerHTML = CS.iconSVG("warning");
                thumb.appendChild(badge);
            }

            var name = document.createElement("div");
            name.className = "bin-name";
            name.textContent = m.name;
            name.title = m.vpath || m.name;

            item.appendChild(thumb);
            item.appendChild(name);

            item.addEventListener("click", function () {
                CS.state.selectedMediaId = m.id;
                CS.media.renderBin();
            });
            item.addEventListener("dblclick", function () {
                CS.media.sendToTimeline(m);
            });
            item.addEventListener("dragstart", function (ev) {
                ev.dataTransfer.setData("cinestudio/media", m.id);
                ev.dataTransfer.effectAllowed = "copy";
            });
            item.addEventListener("contextmenu", function (ev) {
                ev.preventDefault();
                CS.media.itemMenu(m, ev.clientX, ev.clientY);
            });

            grid.appendChild(item);
        });

        CS.applyIcons(grid);
        var n = items.length;
        document.getElementById("bin-count").textContent = n + " item" + (n === 1 ? "" : "s");
    },

    drawWave: function (ctx, peaks, w, h, color) {
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = color;
        var mid = h / 2;
        if (!peaks || !peaks.length) {
            ctx.globalAlpha = 0.4;
            ctx.fillRect(0, mid - 1, w, 2);
            ctx.globalAlpha = 1;
            return;
        }
        var n = Math.floor(w / 2);
        for (var i = 0; i < n; i++) {
            var p = peaks[Math.floor(i * peaks.length / n)] || 0;
            var bh = Math.max(1, p * (h * 0.86));
            ctx.fillRect(i * 2, mid - bh / 2, 1.4, bh);
        }
    },

    itemMenu: function (media, x, y) {
        CS.showMenu([
            { label: "Add to timeline", icon: "plus", action: function () { CS.media.sendToTimeline(media); } },
            {
                label: "Reveal in File Manager", icon: "folder", disabled: !media.vpath || !CS.inArozOS(),
                action: function () { ao_module_openPath(CS.dirOf(media.vpath), media.name); }
            },
            { sep: true },
            {
                label: "Remove from project", icon: "trash", action: function () {
                    CS.media.removeMedia(media);
                }
            }
        ], x, y);
    },

    removeMedia: function (media) {
        var used = CS.project.clips.some(function (c) { return c.mediaId === media.id; });
        function doRemove() {
            CS.project.clips = CS.project.clips.filter(function (c) { return c.mediaId !== media.id; });
            CS.project.media = CS.project.media.filter(function (m) { return m.id !== media.id; });
            if (CS.state.selectedMediaId === media.id) { CS.state.selectedMediaId = null; }
            CS.media.renderBin();
            CS.commit("Remove Media");
        }
        if (used) {
            CS.confirm("Remove media", media.name + " is used on the timeline. Remove it and all of its clips?", doRemove);
        } else {
            doRemove();
        }
    },

    //Double click: append at the playhead on the first compatible track
    sendToTimeline: function (media) {
        if (media.offline) { CS.toast("Cannot use offline media", true); return; }
        var kind = media.type === "audio" ? "audio" : "video";
        var track = null;
        var tracks = CS.project.tracks.filter(function (t) { return t.kind === kind; });
        if (tracks.length) { track = tracks[0]; }
        if (!track) { CS.toast("No compatible track", true); return; }
        var clip = CS.addClipToTimeline(media, track.id, CS.state.playhead);
        if (clip) {
            CS.state.selectedClipId = clip.id;
            CS.commit("Add Clip");
        }
    },

    /* ---------- bin chrome wiring ---------- */

    init: function () {
        document.getElementById("btn-import").addEventListener("click", function () {
            CS.media.importDialog(null);
        });
        document.getElementById("btn-import-menu").addEventListener("click", function (ev) {
            CS.media.importDialog(ev.currentTarget.parentNode);
        });

        var kindBtn = document.getElementById("bin-kind-btn");
        kindBtn.addEventListener("click", function () {
            var kinds = [
                { v: "all", l: "All Clips" },
                { v: "video", l: "Videos" },
                { v: "audio", l: "Audio" },
                { v: "image", l: "Images" }
            ];
            CS.showMenuUnder(kindBtn, kinds.map(function (k) {
                return {
                    label: k.l,
                    checked: CS.state.binKind === k.v,
                    action: function () {
                        CS.state.binKind = k.v;
                        document.getElementById("bin-kind-label").textContent = k.l;
                        CS.media.renderBin();
                    }
                };
            }));
        });

        document.getElementById("bin-search-input").addEventListener("input", function () {
            CS.state.binSearch = this.value;
            CS.media.renderBin();
        });

        document.getElementById("btn-bin-filter").addEventListener("click", function (ev) {
            kindBtn.click();
        });
        document.getElementById("btn-bin-view").addEventListener("click", function () {
            CS.state.binView = CS.state.binView === "list" ? "grid" : "list";
            CS.setIcon(this.querySelector("[data-icon]"), CS.state.binView === "list" ? "nav-elements" : "list-view");
            CS.media.renderBin();
        });

        //Accept drops from the ArozOS File Manager
        var bin = document.getElementById("mediabin");
        bin.addEventListener("dragover", function (ev) { ev.preventDefault(); });
        bin.addEventListener("drop", function (ev) {
            ev.preventDefault();
            if (typeof ao_module_utils === "undefined") { return; }
            var files = null;
            try { files = ao_module_utils.getDropFileInfo(ev); } catch (e) { files = null; }
            if (files) {
                files.forEach(function (f) { CS.media.addFromVpath(f.filepath, f.filename); });
            }
        });
    }
};
