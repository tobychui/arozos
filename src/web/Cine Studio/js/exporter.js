/*
    Cine Studio - export pipeline

    Inside ArozOS with ffmpeg on the host, the timeline is rendered on the
    server: the project is flattened into a render spec (mod/media/render)
    that mirrors the preview compositor clip for clip, generated clips
    (titles, colour boards) and images ffmpeg cannot read are rasterised
    into a scratch folder, and ffmpeg.renderTimeline encodes the result
    from the ORIGINAL media files - proxies are never used for output. The
    render runs in the background; the dialog follows its progress file
    and the browser is free the whole time.

    Without ffmpeg (or outside ArozOS) the old real-time path remains: the
    preview canvas is captured with captureStream and the WebAudio mix bus
    with a MediaStreamDestination, both recorded by a MediaRecorder into
    WebM while the timeline plays once.
*/
"use strict";

window.CS = window.CS || {};

CS.exporter = {
    //server render job in flight
    job: null,
    //legacy recorder state
    active: false,
    recorder: null,
    chunks: [],
    progressTimer: 0,
    settings: null,
    ui: null,

    FORMATS_SERVER: [
        { v: "mp4", l: "MP4 (H.264 / AAC)" },
        { v: "mov", l: "MOV (H.264 / AAC)" },
        { v: "mkv", l: "MKV (H.264 / AAC)" },
        { v: "webm", l: "WebM (VP9 / Opus)" },
        { v: "gif", l: "GIF (animated, no sound)" },
        { v: "m4a", l: "M4A (audio only)" }
    ],

    useServer: function () {
        return CS.inArozOS() && CS.serverFFmpeg;
    },

    /* ---------- dialog ---------- */

    dialog: function () {
        if (CS.timelineDuration() <= 0) {
            CS.toast("The timeline is empty - nothing to export", true);
            return;
        }
        var server = CS.exporter.useServer();
        if (!server && typeof MediaRecorder === "undefined") {
            CS.toast("This browser does not support MediaRecorder export", true);
            return;
        }
        var pending = CS.project.media.filter(function (m) { return m.proxyState === "pending"; });
        if (pending.length) {
            CS.toast("Wait for " + pending.length + " clip(s) to finish preparing before exporting", true);
            return;
        }

        var nameIn, formatIn, sizeIn, qualityIn, hwIn, rangeIn;
        var dest = { dir: CS.APP_ROOT + "/Exports", label: "Cine Studio/Exports" };
        var inAroz = CS.inArozOS();

        CS.modal({
            title: "Export Video",
            build: function (body) {
                nameIn = CS.modalRow(body, "Filename", CS.textInput(CS.project.name || "Export"));

                if (server) {
                    formatIn = CS.modalRow(body, "Format", CS.selectInput(CS.exporter.FORMATS_SERVER, "mp4"));
                    var W = CS.project.settings.width, H = CS.project.settings.height;
                    sizeIn = CS.modalRow(body, "Size", CS.selectInput([
                        { v: "1", l: "Full (" + W + " x " + H + ")" },
                        { v: "0.5", l: "1/2 (" + Math.round(W / 2) + " x " + Math.round(H / 2) + ")" },
                        { v: "0.25", l: "1/4 (" + Math.round(W / 4) + " x " + Math.round(H / 4) + ")" }
                    ], "1"));
                    qualityIn = CS.modalRow(body, "Quality", CS.selectInput([
                        { v: "high", l: "High" },
                        { v: "medium", l: "Medium" },
                        { v: "low", l: "Low (smaller file)" }
                    ], "high"));
                    if (CS.inOutRange()) {
                        var rangeLabel = document.createElement("label");
                        rangeLabel.className = "modal-check";
                        rangeIn = document.createElement("input");
                        rangeIn.type = "checkbox";
                        rangeIn.checked = true;
                        rangeLabel.appendChild(rangeIn);
                        rangeLabel.appendChild(document.createTextNode("Export the in / out range only"));
                        CS.modalRow(body, "Range", rangeLabel);
                    }
                    if (CS.serverHWEncoder) {
                        var hwLabel = document.createElement("label");
                        hwLabel.className = "modal-check";
                        hwIn = document.createElement("input");
                        hwIn.type = "checkbox";
                        hwLabel.appendChild(hwIn);
                        hwLabel.appendChild(document.createTextNode("Use hardware encoder (" + CS.serverHWEncoder + ")"));
                        hwLabel.title = "Faster, at somewhat lower quality than the software encoder";
                        CS.modalRow(body, "Encoder", hwLabel);
                    }
                } else {
                    formatIn = CS.modalRow(body, "Format", CS.selectInput([{ v: "webm", l: "WebM (VP9, recorded in browser)" }], "webm"));
                }

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
                    CS.modalRow(body, "Save to", destBtn);
                }

                var note = document.createElement("div");
                note.className = "modal-note";
                note.textContent = server
                    ? "The timeline is rendered on the server from the original media files, so you can keep " +
                      "editing (or close this window) while it encodes."
                    : "The timeline is rendered in real time at " + CS.project.settings.width + " x " +
                      CS.project.settings.height + ". Keep this window visible during export. Preview audio " +
                      "is muted while recording - the exported file keeps its sound. Install ffmpeg on the " +
                      "host for server-side rendering and more formats.";
                body.appendChild(note);
            },
            buttons: [
                { label: "Cancel" },
                {
                    label: "Export", primary: true,
                    action: function () {
                        var base = (nameIn.value.trim() || "Export").replace(/[\\/:*?"<>|]/g, "_");
                        if (server) {
                            CS.exporter.startServer({
                                base: base,
                                format: formatIn.value,
                                scale: parseFloat(sizeIn.value) || 1,
                                quality: qualityIn.value,
                                hardware: !!(hwIn && hwIn.checked),
                                rangeOnly: !!(rangeIn && rangeIn.checked),
                                destDir: dest.dir
                            });
                        } else {
                            CS.exporter.startRecorder({
                                base: base,
                                format: "webm",
                                destDir: dest.dir,
                                toDevice: !inAroz
                            });
                        }
                        //the start functions swap this dialog for the progress modal
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

    //Save the frame under the playhead as a PNG still at full project size
    exportFrame: function () {
        CS.player.syncElements();
        var frame = CS.player.renderFullFrame(CS.state.playhead);
        var tc = CS.timecode(CS.state.playhead).replace(/:/g, ".");
        var defaultName = (CS.project.name || "Frame") + " " + tc + ".png";
        frame.toBlob(function (blob) {
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
        }, "image/png");
    },

    /* ================= server-side render ================= */

    startServer: function (s) {
        var job = {
            settings: s,
            dir: "",
            progress: "",
            output: s.destDir + "/" + s.base + "." + s.format,
            cancelled: false,
            uploads: 0
        };
        CS.exporter.job = job;
        CS.player.pause();
        CS.exporter.showServerProgress(job);
        CS.exporter.setStage("Preparing...", 0);

        CS.exporter.agi({ action: "jobdir" })
            .then(function (data) {
                if (!data.ok || !data.vpath) { throw new Error("could not create the scratch folder"); }
                job.dir = data.vpath;
                return CS.exporter.buildSpec(job);
            })
            .then(function (spec) {
                if (job.cancelled) { throw new Error("cancelled"); }
                CS.exporter.setStage("Starting render...", 0);
                //From here on the render belongs to the server: it deletes the scratch
                //folder and notifies the user when it ends, so this tab may close
                return CS.exporter.agi({ action: "render", spec: JSON.stringify(spec), dst: job.output, scratch: job.dir });
            })
            .then(function (data) {
                if (!data.ok || !data.progress) { throw new Error(data.error || "could not start the render"); }
                job.progress = data.progress;
                if (job.cancelled) { CS.exporter.cancelServer(); return; }
                CS.exporter.pollServer(job);
            })
            .catch(function (err) {
                if (job.cancelled || (err && err.message === "cancelled")) { return; }
                CS.exporter.finishServer(job, false, err && err.message ? err.message : String(err));
            });
    },

    //Renders the server started earlier: running ones get their progress
    //dialog back, finished or failed ones are reported once and forgotten.
    //This is what a tab that was closed mid-render finds when it is reopened.
    resumeJobs: function () {
        if (!CS.exporter.useServer()) { return; }
        CS.exporter.agi({ action: "jobs" }).then(function (data) {
            (data.jobs || []).forEach(function (j) {
                if (CS.exporter.job && CS.exporter.job.progress === j.progress) { return; }
                var dir = CS.dirOf(j.output);
                if (j.stage === "failed") {
                    CS.toast("Export of " + j.name + " failed: " + (j.error || "render failed"), true);
                    CS.exporter.agi({ action: "cleanup", target: j.progress }).catch(function () {});
                } else if (j.completed && j.exists) {
                    CS.exporter.finished(dir, j.name);
                    CS.exporter.agi({ action: "cleanup", target: j.progress }).catch(function () {});
                } else if (!CS.exporter.job) {
                    var dot = j.name.lastIndexOf(".");
                    var job = {
                        settings: { base: dot > 0 ? j.name.substr(0, dot) : j.name, format: dot > 0 ? j.name.substr(dot + 1) : "", destDir: dir },
                        dir: "", progress: j.progress, output: j.output, cancelled: false, uploads: 0
                    };
                    CS.exporter.job = job;
                    CS.exporter.showServerProgress(job);
                    CS.exporter.setStage("Rendering " + Math.round(j.percentage || 0) + "%", j.percentage || 0);
                    CS.toast("Export of " + j.name + " is still rendering on the server");
                    CS.exporter.pollServer(job);
                } else {
                    CS.toast("Export of " + j.name + " is also still rendering on the server");
                }
            });
        }, function () { /* no backend answer: nothing to resume */ });
    },

    showServerProgress: function (job) {
        var fill, label, stage;
        CS.modal({
            title: "Exporting...",
            build: function (body) {
                var bar = document.createElement("div");
                bar.className = "modal-progress";
                fill = document.createElement("div");
                fill.className = "fill";
                bar.appendChild(fill);
                body.appendChild(bar);
                stage = document.createElement("div");
                stage.className = "modal-stage";
                body.appendChild(stage);
                label = document.createElement("div");
                label.className = "modal-note";
                label.textContent = "Rendering on the server from the original media. Once it says Rendering you can " +
                    "keep editing or close this tab: the render carries on, saves to " + job.settings.destDir +
                    " and sends you a notification when it is done.";
                body.appendChild(label);
            },
            buttons: [
                { label: "Hide", action: function () { CS.exporter.ui = null; CS.toast("Export continues in the background"); } },
                { label: "Cancel", action: function () { CS.exporter.cancelServer(); } }
            ]
        });
        CS.exporter.ui = { fill: fill, stage: stage, label: label };
    },

    setStage: function (text, pct) {
        var ui = CS.exporter.ui;
        if (!ui) { return; }
        ui.stage.textContent = text;
        if (pct !== undefined && pct !== null) { ui.fill.style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + "%"; }
    },

    pollServer: function (job) {
        function tick() {
            if (job.cancelled || CS.exporter.job !== job) { return; }
            CS.exporter.agi({ action: "progress", progress: job.progress, target: job.output })
                .then(function (p) {
                    if (job.cancelled) { return; }
                    if (p.stage === "failed") {
                        CS.exporter.finishServer(job, false, p.error || "render failed");
                        return;
                    }
                    if (p.completed && p.exists) {
                        CS.exporter.finishServer(job, true);
                        return;
                    }
                    var pct = p.percentage || 0;
                    if (p.stage === "queued") { CS.exporter.setStage("Queued - waiting for a free encoder...", 0); }
                    else if (p.stage === "uploading") { CS.exporter.setStage("Saving " + job.settings.base + "." + job.settings.format + "...", 100); }
                    else { CS.exporter.setStage("Rendering " + Math.round(pct) + "%", pct); }
                    setTimeout(tick, 700);
                })
                .catch(function () { setTimeout(tick, 2000); });
        }
        setTimeout(tick, 500);
    },

    cancelServer: function () {
        var job = CS.exporter.job;
        if (!job) { CS.closeModal(); return; }
        job.cancelled = true;
        CS.exporter.job = null;
        CS.closeModal();
        CS.exporter.ui = null;
        var done = function () { CS.exporter.cleanupJob(job); CS.toast("Export cancelled"); };
        if (job.progress) {
            CS.exporter.agi({ action: "cancel", progress: job.progress }).then(done, done);
        } else {
            done();
        }
    },

    finishServer: function (job, ok, errMsg) {
        if (CS.exporter.job === job) { CS.exporter.job = null; }
        CS.closeModal();
        CS.exporter.ui = null;
        CS.exporter.cleanupJob(job);
        if (ok) {
            CS.exporter.finished(job.settings.destDir, job.settings.base + "." + job.settings.format);
        } else {
            CS.toast("Export failed: " + errMsg, true);
        }
    },

    //Remove the scratch folder and the progress file of a job
    cleanupJob: function (job) {
        if (job.dir) { CS.exporter.agi({ action: "cleanup", target: job.dir }).catch(function () {}); }
        if (job.progress) { CS.exporter.agi({ action: "cleanup", target: job.progress }).catch(function () {}); }
    },

    //Promise wrapper around the backend script
    agi: function (params) {
        return new Promise(function (resolve, reject) {
            ao_module_agirun("Cine Studio/backend/ffmpegtools.js", params, function (resp) {
                var data;
                try { data = typeof resp === "string" ? JSON.parse(resp) : resp; }
                catch (e) { reject(new Error("bad response from the server")); return; }
                if (data && data.error && data.ok === undefined && data.percentage === undefined) {
                    reject(new Error(data.error));
                    return;
                }
                resolve(data || {});
            }, function (xhr) {
                var msg = "request failed";
                try {
                    var info = JSON.parse(xhr.responseText);
                    if (info && info.message) { msg = info.message; }
                } catch (e) { /* keep the generic message */ }
                reject(new Error(msg));
            }, 0);
        });
    },

    /* ---------- spec ---------- */

    //Flatten the project into the server render spec. Everything that is
    //decided in the browser at preview time (paint order, audibility, which
    //clip a transition blends from) is decided here the same way.
    buildSpec: function (job) {
        var W = CS.project.settings.width;
        var H = CS.project.settings.height;
        var s = job.settings;
        var spec = {
            width: W,
            height: H,
            fps: CS.project.settings.fps,
            duration: CS.timelineDuration(),
            scale: s.scale,
            format: s.format,
            quality: s.quality,
            hardware: !!s.hardware,
            layers: [],
            audio: []
        };
        var uploads = [];        // {name, blob} to push into the scratch folder
        var uploadedSrc = {};    // cache key -> vpath in the scratch folder
        var pendingSources = []; // promises resolving media sources

        function scratchPath(name) { return job.dir + "/" + name; }

        //Queue a blob for upload and return its future vpath
        function queueBlob(name, blobPromise) {
            var vpath = scratchPath(name);
            pendingSources.push(blobPromise.then(function (blob) {
                if (!blob) { throw new Error("could not render " + name); }
                uploads.push({ name: name, blob: blob });
            }));
            return vpath;
        }

        function canvasBlob(canvas) {
            return new Promise(function (resolve) { canvas.toBlob(resolve, "image/png"); });
        }

        //Where the server should read a video / image clip's pixels from, and
        //the factor that converts browser-side crop pixels to source pixels
        function pictureSource(media) {
            if (media.type === "video") {
                var k = (media.srcWidth && media.width) ? media.srcWidth / media.width : 1;
                return { src: media.vpath, k: k };
            }
            //Images: give ffmpeg the original when it can read it, otherwise the
            //exact pixels the preview shows
            var ext = CS.extOf(media.name);
            if (media.srcKind === "pxs" || CS.FFMPEG_IMAGE_EXTS.indexOf(ext) < 0) {
                var key = "img:" + media.id;
                if (!uploadedSrc[key]) {
                    if (media.proxyState === "ready" && media.proxyVpath && !media.compositeUrl) {
                        uploadedSrc[key] = media.proxyVpath;   //server-made PNG of the original
                    } else {
                        uploadedSrc[key] = queueBlob("image_" + media.id + ".png", CS.exporter.rasterize(CS.media.mediaURL(media)));
                    }
                }
                return { src: uploadedSrc[key], k: 1 };
            }
            return { src: media.vpath, k: 1 };
        }

        function audioSource(media) {
            if (media.srcKind === "asproj" && media.compositeUrl) {
                var key = "aud:" + media.id;
                if (!uploadedSrc[key]) {
                    uploadedSrc[key] = queueBlob("audio_" + media.id + ".wav",
                        fetch(media.compositeUrl).then(function (r) { return r.blob(); }));
                }
                return uploadedSrc[key];
            }
            return media.vpath;
        }

        function effectList(clip) {
            var out = [];
            (clip.props.effects || []).forEach(function (e) {
                if (e.type === "fadeto") { return; } //audio only
                var entry = { type: e.type, amount: (e.amount === undefined || e.amount === null) ? 0 : Number(e.amount) };
                if (e.type === "chromakey") {
                    var def = CS.effects.get("chromakey");
                    entry.color = e.color || "#00ff00";
                    entry.similarity = CS.effects.paramValue(e, def.params[1]);
                    entry.soft = CS.effects.paramValue(e, def.params[2]);
                }
                out.push(entry);
            });
            return out;
        }

        //Keyframes of the listed properties, clip-local times; when the
        //export covers an in / out range the times are shifted with the clip
        function keyframesOf(clip, keys, shift) {
            var kfs = clip.props.keyframes;
            if (!kfs) { return undefined; }
            var out = {};
            var any = false;
            keys.forEach(function (key) {
                if (kfs[key] && kfs[key].length) {
                    any = true;
                    out[key] = kfs[key].map(function (k) {
                        return { t: Math.max(0, k.t - (shift || 0)), v: k.v, ease: k.ease || "linear" };
                    });
                }
            });
            return any ? out : undefined;
        }

        function layerProps(clip, k) {
            var p = clip.props;
            return {
                x: p.x || 0,
                y: p.y || 0,
                scale: p.scale === undefined ? 100 : p.scale,
                rotation: p.rotation || 0,
                opacity: p.opacity === undefined ? 100 : p.opacity,
                crop: p.crop || "fit",
                cropTop: Math.round((p.cropTop || 0) * k),
                cropBottom: Math.round((p.cropBottom || 0) * k),
                cropLeft: Math.round((p.cropLeft || 0) * k),
                cropRight: Math.round((p.cropRight || 0) * k),
                preset: p.preset || "default",
                exposure: p.exposure || 0,
                contrast: p.contrast || 0,
                saturation: p.saturation === undefined ? 1 : p.saturation,
                blend: p.blend || "normal",
                flipH: !!p.flipH,
                flipV: !!p.flipV,
                effects: effectList(clip),
                keyframes: keyframesOf(clip, ["x", "y", "scale", "rotation", "opacity"], 0)
            };
        }

        //Optional in / out range: only the part of each clip inside the
        //range is rendered, shifted so the range starts at 0
        var range = s.rangeOnly ? CS.inOutRange() : null;
        if (range) { spec.duration = range.end - range.start; }
        function rangeCut(clip) {
            if (!range) { return { skip: false, start: clip.start, duration: CS.clipDuration(clip), headCut: 0 }; }
            var end = CS.clipEnd(clip);
            if (end <= range.start || clip.start >= range.end) { return { skip: true }; }
            var s0 = Math.max(clip.start, range.start);
            var e0 = Math.min(end, range.end);
            return { skip: false, start: s0 - range.start, duration: e0 - s0, headCut: s0 - clip.start };
        }

        //Picture layers, bottom track first, clips in time order
        CS.videoTracksInRenderOrder().forEach(function (track) {
            if (!track.visible) { return; }
            var prevLayer = null;
            CS.clipsOnTrack(track.id).forEach(function (clip) {
                var layer = null;
                var cut = rangeCut(clip);
                if (cut.skip) { return; }
                if (clip.kind === "adjust") {
                    layer = { kind: "adjust", src: "", props: layerProps(clip, 1) };
                } else if (clip.kind === "title" || clip.kind === "color") {
                    //Generated clips: the exact frame the preview draws, as PNG
                    var canvas = CS.titles.renderSource(clip, W, H);
                    var src = queueBlob("gen_" + clip.id + ".png", canvasBlob(canvas));
                    layer = { kind: "image", src: src, props: layerProps(clip, 1) };
                } else {
                    var media = CS.getMedia(clip.mediaId);
                    if (!media || media.offline) { return; }
                    if (!media.vpath && !media.compositeUrl) {
                        throw new Error(media.name + " is not stored on the server");
                    }
                    if (media.type === "video") {
                        var vs = pictureSource(media);
                        layer = { kind: "video", src: vs.src, props: layerProps(clip, vs.k) };
                    } else if (media.type === "image") {
                        var is = pictureSource(media);
                        layer = { kind: "image", src: is.src, props: layerProps(clip, is.k) };
                    } else {
                        return; //audio media on a video track has no picture
                    }
                }
                layer.id = clip.id;
                layer.start = cut.start;
                layer.duration = cut.duration;
                layer.speed = CS.clipSpeed(clip);
                layer.reverse = !!clip.props.reverse;
                //A head cut moves the in point forward (or the out point back
                //for reversed clips) by the cut length in source time
                layer.in = clip.props.reverse
                    ? (clip.in || 0) + Math.max(0, (clip.out - clip.in) - (cut.headCut + cut.duration) * layer.speed)
                    : (clip.in || 0) + cut.headCut * layer.speed;
                if (cut.headCut > 0) {
                    layer.props.keyframes = keyframesOf(clip, ["x", "y", "scale", "rotation", "opacity"], cut.headCut);
                }
                layer.prevId = "";
                var tr = clip.props.transition;
                if (tr && tr.type && tr.type !== "none" && cut.headCut === 0 && clip.kind !== "adjust") {
                    layer.transition = { type: tr.type, duration: Math.min(tr.duration || 1, layer.duration) };
                    var prev = CS.transitions.prevOf(clip);
                    if (prev && prevLayer && prev.id === prevLayer.id) { layer.prevId = prev.id; }
                }
                spec.layers.push(layer);
                prevLayer = layer;
            });
        });

        //Audio, following the same audibility rules as the preview
        var anySolo = CS.project.tracks.some(function (tr) { return tr.kind === "audio" && tr.solo; });
        var fadeToDef = CS.effects.get("fadeto");
        CS.project.clips.forEach(function (clip) {
            if (clip.kind === "title" || clip.kind === "color") { return; }
            var media = CS.getMedia(clip.mediaId);
            if (!media || media.offline || (media.type !== "video" && media.type !== "audio")) { return; }
            var track = CS.getTrack(clip.trackId);
            if (!track || !track.visible || track.muted) { return; }
            if (anySolo && track.kind === "audio" && !track.solo) { return; }
            var vol = (clip.props.volume === undefined ? 100 : clip.props.volume) / 100;
            var animatedVolume = CS.keyframes.has(clip, "volume");
            if (vol <= 0 && !animatedVolume) { return; }
            if (!media.vpath && !media.compositeUrl) {
                throw new Error(media.name + " is not stored on the server");
            }
            var cut = rangeCut(clip);
            if (cut.skip) { return; }
            var speed = CS.clipSpeed(clip);
            var a = {
                id: clip.id,
                src: audioSource(media),
                start: cut.start,
                duration: cut.duration,
                in: clip.props.reverse
                    ? (clip.in || 0) + Math.max(0, (clip.out - clip.in) - (cut.headCut + cut.duration) * speed)
                    : (clip.in || 0) + cut.headCut * speed,
                speed: speed,
                reverse: !!clip.props.reverse,
                //An animated volume is sent as keyframes; the static level is
                //then the unity the keyframes multiply
                volume: animatedVolume ? 1 : Math.min(4, Math.max(0, vol)),
                pan: clip.props.pan || 0,
                fadeIn: 0,
                fadeOut: 0,
                inCurve: "linear",
                outCurve: "linear",
                hasRamp: false,
                rampFrom: 1,
                rampTo: 1,
                keyframes: keyframesOf(clip, ["volume", "pan"], cut.headCut)
            };
            (clip.props.effects || []).forEach(function (e) {
                if (e.type === "fadein") { a.fadeIn = Math.max(0.05, e.amount || 0); }
                else if (e.type === "fadeout") { a.fadeOut = Math.max(0.05, e.amount || 0); }
                else if (e.type === "fadeto" && fadeToDef) {
                    a.hasRamp = true;
                    a.rampFrom = CS.effects.paramValue(e, fadeToDef.params[0]) / 100;
                    a.rampTo = CS.effects.paramValue(e, fadeToDef.params[1]) / 100;
                }
            });
            //Audio transitions: this clip's crossfade in, and the fade out the
            //next clip's crossfade asks for
            var at = clip.props.audioTransition;
            if (at && at.type !== "none" && cut.headCut === 0) {
                a.fadeIn = Math.max(a.fadeIn, Math.min(at.duration || 1, a.duration));
                a.inCurve = at.type === "power" ? "power" : "linear";
            }
            var next = CS.transitions.nextOf(clip);
            var nat = next && next.props.audioTransition;
            if (nat && nat.type !== "none" && Math.abs(cut.duration - CS.clipDuration(clip)) < 0.001) {
                a.fadeOut = Math.max(a.fadeOut, Math.min(nat.duration || 1, a.duration));
                a.outCurve = nat.type === "power" ? "power" : "linear";
            }
            spec.audio.push(a);
        });

        if (!spec.layers.length && !spec.audio.length) {
            return Promise.reject(new Error("nothing on the timeline can be rendered"));
        }

        //Rasterise everything, then push the files one by one
        return Promise.all(pendingSources).then(function () {
            return CS.exporter.uploadAll(job, uploads);
        }).then(function () { return spec; });
    },

    uploadAll: function (job, uploads) {
        var i = 0;
        function next() {
            if (job.cancelled) { return Promise.reject(new Error("cancelled")); }
            if (i >= uploads.length) { return Promise.resolve(); }
            var u = uploads[i++];
            CS.exporter.setStage("Preparing assets (" + i + " / " + uploads.length + ")...", 0);
            return CS.exporter.uploadBlob(u.blob, u.name, job.dir).then(next);
        }
        return next();
    },

    uploadBlob: function (blob, name, dir) {
        return new Promise(function (resolve, reject) {
            var file = new File([blob], name, { type: blob.type || "application/octet-stream" });
            ao_module_uploadFile(file, dir, function () { resolve(dir + "/" + name); }, undefined, function () {
                reject(new Error("could not upload " + name));
            });
        });
    },

    //Decode an image the browser can show and hand back its pixels as PNG
    rasterize: function (url) {
        return new Promise(function (resolve, reject) {
            var img = new Image();
            img.onload = function () {
                var c = document.createElement("canvas");
                c.width = img.naturalWidth || 1;
                c.height = img.naturalHeight || 1;
                c.getContext("2d").drawImage(img, 0, 0);
                c.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error("rasterisation failed")); }, "image/png");
            };
            img.onerror = function () { reject(new Error("could not load image")); };
            img.src = url;
        });
    },

    /* ================= legacy: real-time recorder ================= */

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

    startRecorder: function (settings) {
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
        CS.exporter.showRecorderProgress();

        //Roll from the very beginning and let the player drive the frames
        CS.player.seek(0);
        CS.exporter.recorder.start(250);
        CS.player.play();
    },

    showRecorderProgress: function () {
        var fill, label, monitorBtn;
        CS.modal({
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

    //Player calls this whenever playback stops; only meaningful mid-recording
    onPlaybackStopped: function () {
        if (!CS.exporter.active) { return; }
        CS.exporter.active = false;
        clearInterval(CS.exporter.progressTimer);
        if (CS.exporter.ui && CS.exporter.ui.label) {
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

        CS.exporter.upload(blob, s.base + ".webm", s.destDir, function () {
            CS.closeModal();
            CS.exporter.finished(s.destDir, s.base + ".webm");
        });
    },

    upload: function (blob, filename, destDir, done) {
        if (CS.exporter.ui && CS.exporter.ui.label) { CS.exporter.ui.label.textContent = "Uploading " + filename + "..."; }
        var file = new File([blob], filename, { type: blob.type });
        ao_module_uploadFile(file, destDir, function () {
            done();
        }, function (pct) {
            if (CS.exporter.ui && CS.exporter.ui.label) { CS.exporter.ui.label.textContent = "Uploading " + filename + " (" + Math.round(pct) + "%)"; }
        }, function () {
            CS.closeModal();
            CS.toast("Upload failed - check permissions", true);
        });
    },

    /* ---------- shared ---------- */

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

//Until the server has accepted the render, this tab still has work to do
//(rasterising titles and uploading them), so leaving would lose the export.
//After that the render no longer needs the tab, and leaving is fine.
window.addEventListener("beforeunload", function (ev) {
    var job = CS.exporter.job;
    if (job && !job.progress && !job.cancelled) {
        ev.preventDefault();
        ev.returnValue = "";
    }
});
