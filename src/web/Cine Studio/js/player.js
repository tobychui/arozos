/*
    Cine Studio - preview player and compositor

    Draws the frame under the playhead onto the preview canvas by
    compositing every visible video-track clip (transform, crop, color
    filters, opacity) and keeps a pool of hidden <video>/<audio>
    elements time-synced for playback. The same pipeline is reused by
    the exporter (canvas captureStream + WebAudio mix bus).
*/
"use strict";

window.CS = window.CS || {};

CS.player = {
    canvas: null,
    ctx: null,
    pool: {},        // clipId -> media element
    images: {},      // mediaId -> HTMLImageElement
    audioCtx: null,
    masterGain: null,
    exportDest: null,
    lastTick: 0,
    rafId: 0,
    rate: 1,          //shuttle rate: 1 = normal, 2/4/8 = fast, negative = reverse

    init: function () {
        CS.player.canvas = document.getElementById("preview-canvas");
        CS.player.ctx = CS.player.canvas.getContext("2d");
        CS.player.applyProjectSize();

        document.getElementById("btn-play").addEventListener("click", CS.player.toggle);
        document.getElementById("btn-prev-edit").addEventListener("click", function () {
            CS.player.gotoEditPoint(-1);
        });
        document.getElementById("btn-next-edit").addEventListener("click", function () {
            CS.player.gotoEditPoint(1);
        });
        document.getElementById("btn-fullscreen").addEventListener("click", function () {
            var stage = document.getElementById("preview-stage");
            if (document.fullscreenElement) { document.exitFullscreen(); }
            else if (stage.requestFullscreen) { stage.requestFullscreen(); }
        });
        document.getElementById("btn-safe-area").addEventListener("click", function () {
            CS.state.safeArea = !CS.state.safeArea;
            this.classList.toggle("active", CS.state.safeArea);
            CS.player.render();
        });
        document.getElementById("btn-loop").addEventListener("click", function () {
            CS.state.loop = !CS.state.loop;
            this.classList.toggle("active", CS.state.loop);
        });

        var zoomBtn = document.getElementById("btn-preview-zoom");
        zoomBtn.addEventListener("click", function () {
            var levels = [
                { v: "fit", l: "Fit" },
                { v: "0.5", l: "50%" },
                { v: "1", l: "100%" },
                { v: "2", l: "200%" }
            ];
            CS.showMenuUnder(zoomBtn, levels.map(function (z) {
                return {
                    label: z.l,
                    checked: String(CS.state.previewZoom) === z.v,
                    action: function () {
                        CS.state.previewZoom = z.v;
                        document.getElementById("preview-zoom-label").textContent = z.l;
                        CS.player.applyPreviewZoom();
                    }
                };
            }));
        });
    },

    applyProjectSize: function () {
        CS.player.canvas.width = CS.project.settings.width;
        CS.player.canvas.height = CS.project.settings.height;
        CS.player.applyPreviewZoom();
        CS.player.render();
    },

    applyPreviewZoom: function () {
        var c = CS.player.canvas;
        var stage = document.getElementById("preview-stage");
        if (CS.state.previewZoom === "fit") {
            c.style.width = "";
            c.style.height = "";
            c.style.maxWidth = "100%";
            c.style.maxHeight = "100%";
            stage.style.overflow = "hidden";
        } else {
            var z = parseFloat(CS.state.previewZoom);
            c.style.maxWidth = "none";
            c.style.maxHeight = "none";
            c.style.width = Math.round(CS.project.settings.width * z) + "px";
            c.style.height = Math.round(CS.project.settings.height * z) + "px";
            stage.style.overflow = "auto";
        }
    },

    reset: function () {
        CS.player.pause();
        var pool = document.getElementById("element-pool");
        if (pool) { pool.innerHTML = ""; }
        CS.player.pool = {};
        CS.player.images = {};
        if (CS.player.canvas) { CS.player.applyProjectSize(); }
    },

    /* ---------- element pool ---------- */

    ensureElement: function (clip, media) {
        var el = CS.player.pool[clip.id];
        if (el) { return el; }
        el = document.createElement(media.type === "audio" ? "audio" : "video");
        el.preload = "auto";
        el.setAttribute("playsinline", "");
        el.src = CS.media.mediaURL(media);
        el.addEventListener("seeked", function () {
            if (!CS.state.playing) { CS.player.render(); }
        });
        document.getElementById("element-pool").appendChild(el);
        CS.player.pool[clip.id] = el;
        CS.player.attachToMixBus(el);
        return el;
    },

    ensureImage: function (media) {
        var img = CS.player.images[media.id];
        if (img) { return img; }
        img = new Image();
        img.src = CS.media.mediaURL(media);
        img.onload = function () { if (!CS.state.playing) { CS.player.render(); } };
        CS.player.images[media.id] = img;
        return img;
    },

    //Drop pool entries whose clip no longer exists
    prunePool: function () {
        Object.keys(CS.player.pool).forEach(function (clipId) {
            if (!CS.getClip(clipId)) {
                var el = CS.player.pool[clipId];
                el.pause();
                el.remove();
                delete CS.player.pool[clipId];
            }
        });
    },

    /* ---------- audio mix bus (playback monitoring + export capture) ---------- */

    initAudioBus: function () {
        if (CS.player.audioCtx) {
            if (CS.player.audioCtx.state === "suspended") { CS.player.audioCtx.resume(); }
            return;
        }
        try {
            var AC = window.AudioContext || window.webkitAudioContext;
            CS.player.audioCtx = new AC();
            CS.player.masterGain = CS.player.audioCtx.createGain();
            CS.player.masterGain.connect(CS.player.audioCtx.destination);
            //Route the already-created elements through the bus
            Object.keys(CS.player.pool).forEach(function (clipId) {
                CS.player.attachToMixBus(CS.player.pool[clipId]);
            });
        } catch (e) {
            CS.player.audioCtx = null;
        }
    },

    attachToMixBus: function (el) {
        if (!CS.player.audioCtx || el._csRouted) { return; }
        try {
            var src = CS.player.audioCtx.createMediaElementSource(el);
            src.connect(CS.player.masterGain);
            el._csRouted = true;
        } catch (e) { /* element stays on direct output */ }
    },

    /* ---------- transport ---------- */

    toggle: function () {
        if (CS.state.playing) { CS.player.pause(); } else { CS.player.setRate(1); CS.player.play(); }
    },

    //JKL shuttle: L speeds up forward, J speeds up backward, K pauses
    setRate: function (r) {
        CS.player.rate = r;
    },

    shuttle: function (dir) {
        var r = CS.player.rate;
        if (!CS.state.playing || (dir > 0 && r < 0) || (dir < 0 && r > 0)) {
            r = dir; //start at 1x in the requested direction
        } else {
            r = CS.clamp(r * 2, -8, 8); //same direction: double up to 8x
        }
        CS.player.setRate(r);
        if (!CS.state.playing) { CS.player.play(); }
        CS.toast("Playback " + (r > 0 ? "" : "-") + Math.abs(r) + "x");
    },

    play: function () {
        var dur = CS.timelineDuration();
        if (dur <= 0) { CS.toast("Timeline is empty"); return; }
        if (CS.player.rate > 0 && CS.state.playhead >= dur - 0.01) { CS.state.playhead = 0; }
        if (CS.player.rate < 0 && CS.state.playhead <= 0.01) { CS.state.playhead = dur; }
        CS.player.initAudioBus();
        CS.state.playing = true;
        CS.player.lastTick = performance.now();
        CS.setIcon(document.getElementById("play-icon"), "pause");
        //Start the media elements inside the user gesture so autoplay
        //policies treat the playback as user initiated
        CS.player.syncElements();
        cancelAnimationFrame(CS.player.rafId);
        CS.player.rafId = requestAnimationFrame(CS.player.tick);
    },

    pause: function () {
        CS.state.playing = false;
        CS.player.rate = 1;
        cancelAnimationFrame(CS.player.rafId);
        Object.keys(CS.player.pool).forEach(function (id) {
            if (!CS.player.pool[id].paused) { CS.player.pool[id].pause(); }
        });
        var icon = document.getElementById("play-icon");
        if (icon) { CS.setIcon(icon, "play"); }
        if (CS.exporter && CS.exporter.onPlaybackStopped) { CS.exporter.onPlaybackStopped(); }
    },

    seek: function (t) {
        var dur = Math.max(CS.timelineDuration(), 0);
        CS.state.playhead = CS.clamp(t, 0, Math.max(dur, 0));
        CS.player.syncElements();
        CS.player.render();
        CS.player.updateTransportUI();
        CS.timeline.updatePlayhead();
    },

    gotoEditPoint: function (dir) {
        var pts = CS.editPoints();
        var t = CS.state.playhead;
        if (dir < 0) {
            for (var i = pts.length - 1; i >= 0; i--) {
                if (pts[i] < t - 0.02) { CS.player.seek(pts[i]); return; }
            }
            CS.player.seek(0);
        } else {
            for (var j = 0; j < pts.length; j++) {
                if (pts[j] > t + 0.02) { CS.player.seek(pts[j]); return; }
            }
        }
    },

    tick: function (now) {
        if (!CS.state.playing) { return; }
        var dt = (now - CS.player.lastTick) / 1000;
        CS.player.lastTick = now;
        CS.state.playhead += dt * CS.player.rate;

        var dur = CS.timelineDuration();
        //Reverse shuttle reached the head of the timeline
        if (CS.player.rate < 0 && CS.state.playhead <= 0) {
            CS.state.playhead = 0;
            CS.player.syncElements();
            CS.player.render();
            CS.player.updateTransportUI();
            CS.timeline.updatePlayhead();
            CS.player.pause();
            return;
        }
        if (CS.player.rate > 0 && CS.state.playhead >= dur) {
            if (CS.state.loop) {
                CS.state.playhead = 0; //loop back around and keep rolling
            } else {
                CS.state.playhead = dur;
                CS.player.syncElements();
                CS.player.render();
                CS.player.updateTransportUI();
                CS.timeline.updatePlayhead();
                CS.player.pause();
                return;
            }
        }

        CS.player.syncElements();
        CS.player.render();
        CS.player.updateTransportUI();
        CS.timeline.updatePlayhead();
        CS.player.rafId = requestAnimationFrame(CS.player.tick);
    },

    updateTransportUI: function () {
        document.getElementById("tc-current").textContent = CS.timecode(CS.state.playhead);
        document.getElementById("tc-total").textContent = CS.timecode(CS.timelineDuration());
    },

    /* ---------- element time sync ---------- */

    activeAt: function (clip, t) {
        return t >= clip.start && t < CS.clipEnd(clip);
    },

    syncElements: function () {
        var t = CS.state.playhead;
        var frozen = CS.transitions.frozenTargets(t);
        var rate = CS.player.rate;
        var reverse = CS.state.playing && rate < 0;
        //Track solo: when any audio track is soloed, other audio tracks mute
        var anySolo = CS.project.tracks.some(function (tr) { return tr.kind === "audio" && tr.solo; });

        CS.project.clips.forEach(function (clip) {
            if (clip.kind === "title" || clip.kind === "color") { return; }
            var media = CS.getMedia(clip.mediaId);
            if (!media || media.type === "image" || media.offline) { return; }
            var track = CS.getTrack(clip.trackId);
            var el = CS.player.ensureElement(clip, media);
            var active = CS.player.activeAt(clip, t) && track && track.visible;
            var speed = CS.clipSpeed(clip);
            var target = clip.in + (t - clip.start) * speed;

            //Volume: clip setting shaped by any fade in/out effects
            var vol = (clip.props.volume === undefined ? 100 : clip.props.volume) / 100;
            vol *= CS.effects.fadeAlpha(clip, t);
            el.volume = CS.clamp(vol, 0, 1);
            var soloMuted = anySolo && track && track.kind === "audio" && !track.solo;
            el.muted = !!(track && track.muted) || soloMuted;

            if (CS.state.playing && active && !reverse) {
                try { el.playbackRate = CS.clamp(speed * Math.max(rate, 0.0625), 0.0625, 16); } catch (e) {}
                if (el.paused) {
                    try { el.currentTime = target; } catch (e) {}
                    var p = el.play();
                    if (p && p.catch) { p.catch(function () {}); }
                } else if (Math.abs(el.currentTime - target) > 0.14 * Math.max(1, Math.abs(rate))) {
                    try { el.currentTime = target; } catch (e) {}
                }
            } else if (CS.state.playing && active && reverse) {
                //Media elements cannot play backwards: step frames by seeking
                if (!el.paused) { el.pause(); }
                if (Math.abs(el.currentTime - target) > 0.05) {
                    try { el.currentTime = target; } catch (e) {}
                }
            } else if (CS.state.playing && !active) {
                if (!el.paused) { el.pause(); }
            } else {
                //Paused scrub: park the element on the exact frame; a clip
                //feeding a transition freezes on its own last frame instead
                if (!el.paused) { el.pause(); }
                var parkAt = active ? target : frozen[clip.id];
                if (parkAt !== undefined && Math.abs(el.currentTime - parkAt) > 0.03) {
                    try { el.currentTime = parkAt; } catch (e) {}
                }
            }
        });
    },

    /* ---------- rendering ---------- */

    invalidate: function () {
        CS.player.prunePool();
        CS.player.syncElements();
        CS.player.render();
        CS.player.updateTransportUI();
        var empty = document.getElementById("preview-empty");
        empty.style.display = CS.project.clips.length ? "none" : "flex";
    },

    buildFilter: function (props) {
        var parts = [];
        var exposure = props.exposure || 0;
        var contrast = props.contrast || 0;
        var saturation = (props.saturation === undefined) ? 1 : props.saturation;
        if (exposure !== 0) { parts.push("brightness(" + (1 + exposure) + ")"); }
        if (contrast !== 0) { parts.push("contrast(" + (1 + contrast / 100) + ")"); }
        if (saturation !== 1) { parts.push("saturate(" + saturation + ")"); }
        if (props.preset === "warm") { parts.push("sepia(0.28)"); }
        if (props.preset === "cool") { parts.push("hue-rotate(-18deg)"); }
        return parts.length ? parts.join(" ") : "none";
    },

    render: function () {
        var ctx = CS.player.ctx;
        if (!ctx) { return; }
        CS.player.renderFrame(ctx, CS.state.playhead);
        if (CS.state.safeArea) { CS.player.drawSafeArea(ctx); }
        if (CS.previewctl && CS.previewctl.overlay) { CS.previewctl.redraw(); }
    },

    //Composite the frame at time t onto the given 2d context
    renderFrame: function (ctx, t) {
        var W = CS.project.settings.width;
        var H = CS.project.settings.height;
        ctx.filter = "none";
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);

        CS.videoTracksInRenderOrder().forEach(function (track) {
            if (!track.visible) { return; }
            CS.clipsOnTrack(track.id).forEach(function (clip) {
                if (!CS.player.activeAt(clip, t)) { return; }
                var win = CS.transitions.windowAt(clip, t);
                if (win) {
                    CS.transitions.draw(ctx, clip, t, W, H, win);
                } else {
                    CS.player.drawClip(ctx, clip, W, H, t, {});
                }
            });
        });

        ctx.filter = "none";
        ctx.globalAlpha = 1;
    },

    drawClip: function (ctx, clip, W, H, t, opts) {
        opts = opts || {};
        var src, sw, sh;

        if (clip.kind === "title" || clip.kind === "color") {
            src = CS.titles.renderSource(clip, W, H);
            sw = src.width;
            sh = src.height;
        } else {
            var media = CS.getMedia(clip.mediaId);
            if (!media || media.offline) { return; }
            if (media.type === "video") {
                src = CS.player.pool[clip.id];
                if (!src || src.readyState < 2) { return; }
                sw = src.videoWidth;
                sh = src.videoHeight;
            } else if (media.type === "image") {
                src = CS.player.ensureImage(media);
                if (!src.complete || !src.naturalWidth) { return; }
                sw = src.naturalWidth;
                sh = src.naturalHeight;
            } else {
                return; //audio has no visual
            }
        }
        if (!sw || !sh) { return; }

        var p = clip.props;
        var fx = CS.effects.analyze(clip, t === undefined ? CS.state.playhead : t, W);
        if (fx.alpha <= 0) { return; }

        if (fx.pixelate > 1) {
            src = CS.effects.pixelateSource(src, sw, sh, fx.pixelate);
            sw = src.width;
            sh = src.height;
        }

        var dw, dh;
        if (p.crop === "stretch") {
            dw = W;
            dh = H;
        } else {
            var s = (p.crop === "fill") ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
            dw = sw * s;
            dh = sh * s;
        }
        var userScale = (p.scale === undefined ? 100 : p.scale) / 100;
        dw *= userScale;
        dh *= userScale;

        ctx.save();
        if (p.blend && p.blend !== "normal") {
            ctx.globalCompositeOperation = p.blend;
        }
        ctx.translate(W / 2 + (p.x || 0), H / 2 + (p.y || 0));
        if (p.rotation) { ctx.rotate(p.rotation * Math.PI / 180); }
        var flipX = (fx.mirror ? -1 : 1) * (p.flipH ? -1 : 1);
        var flipY = p.flipV ? -1 : 1;
        if (flipX !== 1 || flipY !== 1) { ctx.scale(flipX, flipY); }
        var alpha = CS.clamp((p.opacity === undefined ? 100 : p.opacity) / 100, 0, 1) * fx.alpha;
        if (opts.alphaMul !== undefined) { alpha *= CS.clamp(opts.alphaMul, 0, 1); }
        ctx.globalAlpha = alpha;
        var baseFilter = CS.player.buildFilter(p);
        var filterStr = ((baseFilter === "none" ? "" : baseFilter) + fx.filter).trim();
        ctx.filter = filterStr || "none";
        if (fx.pixelate > 1) { ctx.imageSmoothingEnabled = false; }
        try {
            ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh);
        } catch (e) { /* frame not decodable yet */ }
        ctx.restore();

        //Full-frame overlays after the clip itself
        if (fx.vignette > 0) { CS.effects.drawVignette(ctx, W, H, fx.vignette * fx.alpha); }
        if (fx.grain > 0) { CS.effects.drawGrain(ctx, W, H, fx.grain); }
    },

    drawSafeArea: function (ctx) {
        var W = CS.project.settings.width;
        var H = CS.project.settings.height;
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = Math.max(1, W / 960);
        ctx.strokeRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9);
        ctx.strokeRect(W * 0.1, H * 0.1, W * 0.8, H * 0.8);
        ctx.restore();
    }
};
