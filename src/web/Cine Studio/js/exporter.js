/*
    Cine Studio - export pipeline

    Renders the timeline in real time: the preview canvas is captured
    with captureStream and the WebAudio mix bus with a
    MediaStreamDestination, both recorded by a MediaRecorder into WebM.
    The result is uploaded to the ArozOS file system (or downloaded in
    standalone mode). When the host has ffmpeg, the WebM can be
    converted to MP4 server side; the intermediate WebM is deleted once
    the MP4 is written. Speaker monitoring is muted while recording so
    that the room stays quiet, with an unmute button on the progress
    dialog for anyone who wants to listen along.
*/
"use strict";

window.CS = window.CS || {};

CS.exporter = {
    active: false,
    recorder: null,
    chunks: [],
    progressTimer: 0,
    settings: null,
    ui: null,

    /* ---------- dialog ---------- */

    dialog: function () {
        if (CS.timelineDuration() <= 0) {
            CS.toast("The timeline is empty - nothing to export", true);
            return;
        }
        if (typeof MediaRecorder === "undefined") {
            CS.toast("This browser does not support MediaRecorder export", true);
            return;
        }

        var nameIn, formatIn, destRow;
        var dest = { dir: CS.APP_ROOT + "/Exports", label: "Cine Studio/Exports" };
        var inAroz = CS.inArozOS();

        CS.modal({
            title: "Export Video",
            build: function (body) {
                nameIn = CS.modalRow(body, "Filename", CS.textInput(CS.project.name || "Export"));

                var formats = [{ v: "webm", l: "WebM (VP9)" }];
                if (inAroz) {
                    formats.push({ v: "mp4", l: CS.serverFFmpeg ? "MP4 (server ffmpeg)" : "MP4 (unavailable - no ffmpeg)" });
                }
                formatIn = CS.modalRow(body, "Format", CS.selectInput(formats, "webm"));

                if (inAroz) {
                    var destBtn = document.createElement("button");
                    destBtn.className = "modal-btn";
                    destBtn.textContent = dest.label;
                    destBtn.title = "Choose destination folder";
                    destBtn.addEventListener("click", function () {
                        window.csExportDestCallback = function csExportDestCallback(filedata) {
                            if (!filedata || !filedata.length) { return; }
                            dest.dir = filedata[0].filepath;
                            destBtn.textContent = filedata[0].filename || dest.dir;
                        };
                        ao_module_openFileSelector(window.csExportDestCallback, CS.APP_ROOT + "/Exports", "folder", false, {
                            path_memory_key: "export"
                        });
                    });
                    destRow = CS.modalRow(body, "Save to", destBtn);
                }

                var note = document.createElement("div");
                note.className = "modal-note";
                note.textContent = "The timeline is rendered in real time at "
                    + CS.project.settings.width + " x " + CS.project.settings.height
                    + ". Keep this window visible during export. Preview audio is muted "
                    + "while recording - the exported file keeps its sound.";
                body.appendChild(note);
            },
            buttons: [
                { label: "Cancel" },
                {
                    label: "Export", primary: true,
                    action: function () {
                        var format = formatIn.value;
                        if (format === "mp4" && !CS.serverFFmpeg) {
                            CS.toast("MP4 export needs ffmpeg on the ArozOS host", true);
                            return false;
                        }
                        var base = (nameIn.value.trim() || "Export").replace(/[\\/:*?"<>|]/g, "_");
                        CS.exporter.start({
                            base: base,
                            format: format,
                            destDir: dest.dir,
                            toDevice: !inAroz
                        });
                        //start() swapped this dialog for the progress modal
                        return false;
                    }
                }
            ]
        });
    },

    //Export only: saving a project lives in the Open menu on the top bar
    quickMenu: function (anchorEl) {
        CS.showMenuUnder(anchorEl, [
            { label: "Export Video...", icon: "export-up", action: CS.exporter.dialog },
            { label: "Export Current Frame (PNG)", icon: "camera", action: CS.exporter.exportFrame }
        ]);
    },

    //Save the frame under the playhead as a PNG still
    exportFrame: function () {
        CS.player.syncElements();
        CS.player.renderFrame(CS.player.ctx, CS.state.playhead);
        var tc = CS.timecode(CS.state.playhead).replace(/:/g, ".");
        var defaultName = (CS.project.name || "Frame") + " " + tc + ".png";
        CS.player.canvas.toBlob(function (blob) {
            if (!blob) { CS.toast("Could not capture the frame", true); return; }
            if (CS.inArozOS() && typeof ao_module_openFileSelector !== "undefined") {
                window.csFrameCallback = function csFrameCallback(filedata) {
                    if (!filedata || !filedata.length) { return; }
                    var f = filedata[0];
                    var file = new File([blob], f.filename, { type: "image/png" });
                    ao_module_uploadFile(file, CS.dirOf(f.filepath), function () {
                        CS.toast("Exported " + f.filename);
                    });
                };
                ao_module_openFileSelector(window.csFrameCallback, CS.APP_ROOT + "/Exports", "new", false, {
                    defaultName: defaultName,
                    path_memory_key: "export"
                });
            } else {
                CS.fileio.downloadBlob(blob, defaultName);
            }
            CS.player.render(); //repaint overlays the frame render skipped
        }, "image/png");
    },

    /* ---------- recording ---------- */

    pickMimeType: function () {
        var candidates = [
            "video/webm;codecs=vp9,opus",
            "video/webm;codecs=vp8,opus",
            "video/webm"
        ];
        for (var i = 0; i < candidates.length; i++) {
            if (MediaRecorder.isTypeSupported(candidates[i])) { return candidates[i]; }
        }
        return "";
    },

    start: function (settings) {
        CS.exporter.settings = settings;
        CS.exporter.chunks = [];
        CS.player.pause();
        CS.player.initAudioBus();

        //Video: capture the compositing canvas
        var fps = CS.project.settings.fps;
        var stream;
        try {
            stream = CS.player.canvas.captureStream(fps);
        } catch (e) {
            CS.toast("Canvas capture is not supported in this browser", true);
            return;
        }

        //Audio: tap the master mix bus
        if (CS.player.audioCtx && CS.player.masterGain) {
            try {
                CS.exporter.audioDest = CS.player.audioCtx.createMediaStreamDestination();
                CS.player.masterGain.connect(CS.exporter.audioDest);
                CS.exporter.audioDest.stream.getAudioTracks().forEach(function (t) {
                    stream.addTrack(t);
                });
            } catch (e) { /* silent export */ }
        }

        var mime = CS.exporter.pickMimeType();
        try {
            CS.exporter.recorder = new MediaRecorder(stream, mime ? {
                mimeType: mime,
                videoBitsPerSecond: 12000000,
                audioBitsPerSecond: 192000
            } : undefined);
        } catch (e) {
            CS.toast("Cannot start recorder: " + e.message, true);
            return;
        }

        CS.exporter.recorder.ondataavailable = function (ev) {
            if (ev.data && ev.data.size) { CS.exporter.chunks.push(ev.data); }
        };
        CS.exporter.recorder.onstop = CS.exporter.onRecorderStop;

        CS.exporter.active = true;
        //Loop must not swallow the end-of-timeline stop that ends the export
        CS.exporter._loopWas = CS.state.loop;
        CS.state.loop = false;
        //Silence the speakers for the duration of the render; the recorded mix
        //is tapped before the monitor leg, so the file still has full audio
        CS.exporter._monitorWas = CS.player.monitorMuted;
        CS.player.setMonitorMuted(true);
        CS.exporter.showProgress();

        //Roll from the very beginning and let the player drive the frames
        CS.player.seek(0);
        CS.exporter.recorder.start(250);
        CS.player.play();
    },

    showProgress: function () {
        var fill, label, monitorBtn;
        var ui = CS.modal({
            title: "Exporting...",
            build: function (body) {
                var bar = document.createElement("div");
                bar.className = "modal-progress";
                fill = document.createElement("div");
                fill.className = "fill";
                bar.appendChild(fill);
                body.appendChild(bar);
                label = document.createElement("div");
                label.className = "modal-note";
                label.textContent = "Rendering timeline in real time...";
                body.appendChild(label);

                monitorBtn = document.createElement("button");
                monitorBtn.className = "modal-btn export-monitor-btn";
                monitorBtn.addEventListener("click", function () {
                    CS.player.setMonitorMuted(!CS.player.monitorMuted);
                    CS.exporter.paintMonitorButton();
                });
                body.appendChild(monitorBtn);
            },
            buttons: [
                {
                    label: "Cancel", action: function () {
                        CS.exporter.cancel();
                    }
                }
            ]
        });
        CS.exporter.ui = { fill: fill, label: label, monitorBtn: monitorBtn };
        CS.exporter.paintMonitorButton();
        CS.exporter.progressTimer = setInterval(function () {
            var dur = CS.timelineDuration();
            var pct = dur > 0 ? Math.min(100, (CS.state.playhead / dur) * 100) : 0;
            fill.style.width = pct.toFixed(1) + "%";
            label.textContent = "Rendering " + CS.timecode(CS.state.playhead) + " / " + CS.timecode(dur);
        }, 200);
    },

    //Reflect the current monitoring state on the progress dialog button
    paintMonitorButton: function () {
        var btn = CS.exporter.ui && CS.exporter.ui.monitorBtn;
        if (!btn) { return; }
        var muted = CS.player.monitorMuted;
        btn.innerHTML = '<span data-icon="' + (muted ? "speaker-off" : "speaker") + '"></span>' +
            "<span></span>";
        btn.lastChild.textContent = muted ? "Unmute Preview Audio" : "Mute Preview Audio";
        btn.title = muted
            ? "Listen to the mix while it records"
            : "Stop playing the mix through the speakers";
        CS.applyIcons(btn);
    },

    //Player calls this whenever playback stops; only meaningful mid-export
    onPlaybackStopped: function () {
        if (!CS.exporter.active) { return; }
        CS.exporter.active = false;
        clearInterval(CS.exporter.progressTimer);
        if (CS.exporter.ui) {
            CS.exporter.ui.fill.style.width = "100%";
            CS.exporter.ui.label.textContent = "Finalizing...";
        }
        if (CS.exporter.recorder && CS.exporter.recorder.state !== "inactive") {
            CS.exporter.recorder.stop();
        }
    },

    cancel: function () {
        clearInterval(CS.exporter.progressTimer);
        if (!CS.exporter.active) { return; }
        CS.exporter.active = false;
        CS.exporter.cancelled = true;
        if (CS.exporter.recorder && CS.exporter.recorder.state !== "inactive") {
            CS.exporter.recorder.stop();
        }
        CS.player.pause();
        CS.toast("Export cancelled");
    },

    detachAudioTap: function () {
        if (CS.exporter.audioDest && CS.player.masterGain) {
            try { CS.player.masterGain.disconnect(CS.exporter.audioDest); } catch (e) {}
            CS.exporter.audioDest = null;
        }
    },

    onRecorderStop: function () {
        CS.exporter.detachAudioTap();
        if (CS.exporter._loopWas !== undefined) {
            CS.state.loop = CS.exporter._loopWas;
            CS.exporter._loopWas = undefined;
        }
        if (CS.exporter._monitorWas !== undefined) {
            CS.player.setMonitorMuted(CS.exporter._monitorWas);
            CS.exporter._monitorWas = undefined;
        }
        var wasCancelled = CS.exporter.cancelled;
        CS.exporter.cancelled = false;
        var chunks = CS.exporter.chunks;
        CS.exporter.chunks = [];
        CS.exporter.recorder = null;
        if (wasCancelled) { CS.closeModal(); return; }

        var blob = new Blob(chunks, { type: "video/webm" });
        var s = CS.exporter.settings;

        if (s.toDevice) {
            CS.fileio.downloadBlob(blob, s.base + ".webm");
            CS.closeModal();
            CS.toast("Export downloaded");
            return;
        }

        if (s.format === "mp4") {
            CS.exporter.uploadAndConvert(blob, s);
        } else {
            CS.exporter.upload(blob, s.base + ".webm", s.destDir, function () {
                CS.closeModal();
                CS.exporter.finished(s.destDir, s.base + ".webm");
            });
        }
    },

    upload: function (blob, filename, destDir, done) {
        if (CS.exporter.ui) { CS.exporter.ui.label.textContent = "Uploading " + filename + "..."; }
        var file = new File([blob], filename, { type: blob.type });
        ao_module_uploadFile(file, destDir, function () {
            done();
        }, function (pct) {
            if (CS.exporter.ui) { CS.exporter.ui.label.textContent = "Uploading " + filename + " (" + Math.round(pct) + "%)"; }
        }, function () {
            CS.closeModal();
            CS.toast("Upload failed - check permissions", true);
        });
    },

    uploadAndConvert: function (blob, s) {
        var tempName = s.base + ".render.webm";
        CS.exporter.upload(blob, tempName, s.destDir, function () {
            if (CS.exporter.ui) { CS.exporter.ui.label.textContent = "Converting to MP4 on the server..."; }
            var src = s.destDir + "/" + tempName;
            var dst = s.destDir + "/" + s.base + ".mp4";
            ao_module_agirun("Cine Studio/backend/ffmpegtools.js", {
                action: "convert",
                src: src,
                dst: dst
            }, function (resp) {
                var data;
                try { data = typeof resp === "string" ? JSON.parse(resp) : resp; }
                catch (e) { data = { error: "bad response" }; }

                if (data && data.success) {
                    //The MP4 is written: the intermediate render is dead weight
                    CS.exporter.removeTemp(src, function () {
                        CS.closeModal();
                        CS.exporter.finished(s.destDir, s.base + ".mp4");
                    });
                } else {
                    //Keep the WebM so a failed conversion never loses the render
                    CS.closeModal();
                    CS.toast("MP4 conversion failed: " + ((data && data.error) || "unknown error")
                        + " - the WebM render was kept as " + tempName, true);
                }
            }, function () {
                CS.closeModal();
                CS.toast("MP4 conversion request failed - the WebM render was kept as "
                    + tempName, true);
            }, 0);
        });
    },

    //Delete an intermediate render file; the export is finished either way, so
    //a failed delete only warns instead of failing the export
    removeTemp: function (target, done) {
        if (CS.exporter.ui) { CS.exporter.ui.label.textContent = "Removing temporary file..."; }
        ao_module_agirun("Cine Studio/backend/ffmpegtools.js", {
            action: "cleanup",
            target: target
        }, function (resp) {
            var data;
            try { data = typeof resp === "string" ? JSON.parse(resp) : resp; }
            catch (e) { data = null; }
            if (!data || !data.ok) {
                CS.toast("Could not remove the temporary render file", true);
            }
            done();
        }, function () {
            CS.toast("Could not remove the temporary render file", true);
            done();
        }, 0);
    },

    finished: function (destDir, filename) {
        CS.toast("Exported " + filename);
        CS.showMenu([
            { label: "Reveal in File Manager", icon: "folder", action: function () {
                ao_module_openPath(destDir, filename);
            } },
            { label: "Done", icon: "check-circle", action: function () {} }
        ], window.innerWidth / 2 - 100, 80);
    }
};
