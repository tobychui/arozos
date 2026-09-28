/*
    Cine Studio - source monitor and three-point editing

    Double-clicking a media item opens it in the source monitor: the
    preview shows the clip on its own, with its own playhead and in / out
    points (I / O). Insert (,) places the marked range at the sequence
    playhead on the targeted track and pushes everything after it along;
    Overwrite (.) places it over whatever is there - Premiere's source
    patching / three-point editing.

    CS.source.active switches the preview between the source and the
    program monitor; the transport buttons and the timecode follow.
*/
"use strict";

window.CS = window.CS || {};

CS.source = {
    active: false,
    media: null,
    el: null,        //media element (video / audio) or Image for stills
    time: 0,
    inPoint: null,
    outPoint: null,
    playing: false,
    rafId: 0,
    lastTick: 0,

    init: function () {
        var tabs = document.querySelectorAll("#monitor-tabs button");
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].addEventListener("click", function () {
                CS.source.setActive(this.getAttribute("data-monitor") === "source");
            });
        }
        var actions = {
            "btn-src-in": function () { CS.source.markIn(); },
            "btn-src-out": function () { CS.source.markOut(); },
            "btn-src-insert": function () { CS.source.insert(); },
            "btn-src-overwrite": function () { CS.source.overwrite(); }
        };
        Object.keys(actions).forEach(function (id) {
            var btn = document.getElementById(id);
            if (btn) { btn.addEventListener("click", actions[id]); }
        });
        CS.source.paintTabs();
    },

    /* ---------- opening ---------- */

    //Show a media item in the source monitor
    open: function (media) {
        if (!media || media.offline) { CS.toast("Cannot open offline media", true); return; }
        if (!media.probed) { CS.toast(media.name + " is still loading", true); return; }
        CS.player.pause();
        CS.source.close();
        CS.source.media = media;
        CS.source.time = 0;
        CS.source.inPoint = null;
        CS.source.outPoint = null;
        if (media.type === "image") {
            var img = new Image();
            img.onload = function () { CS.source.render(); };
            img.src = CS.media.mediaURL(media);
            CS.source.el = img;
        } else {
            var el = document.createElement(media.type === "audio" ? "audio" : "video");
            el.preload = "auto";
            el.setAttribute("playsinline", "");
            el.src = CS.media.mediaURL(media);
            el.addEventListener("seeked", function () { if (!CS.source.playing) { CS.source.render(); } });
            el.addEventListener("loadeddata", function () { CS.source.render(); });
            document.getElementById("element-pool").appendChild(el);
            CS.source.el = el;
        }
        CS.source.setActive(true);
        CS.toast("Source: " + media.name + " - I / O mark, , inserts, . overwrites");
    },

    close: function () {
        CS.source.stop();
        if (CS.source.el && CS.source.el.tagName !== "IMG") {
            CS.source.el.pause();
            CS.source.el.removeAttribute("src");
            CS.source.el.remove();
        }
        CS.source.el = null;
        CS.source.media = null;
    },

    setActive: function (on) {
        if (on && !CS.source.media) {
            var m = CS.state.selectedMediaId ? CS.getMedia(CS.state.selectedMediaId) : null;
            if (!m) { CS.toast("Double-click a media item to open it in the source monitor"); return; }
            CS.source.open(m);
            return;
        }
        if (!on) { CS.source.stop(); } else { CS.player.pause(); }
        CS.source.active = !!on;
        CS.source.paintTabs();
        CS.player.render();
        CS.player.updateTransportUI();
        if (CS.previewctl && CS.previewctl.overlay) { CS.previewctl.overlay.style.display = on ? "none" : ""; }
    },

    paintTabs: function () {
        var tabs = document.querySelectorAll("#monitor-tabs button");
        for (var i = 0; i < tabs.length; i++) {
            var isSrc = tabs[i].getAttribute("data-monitor") === "source";
            tabs[i].classList.toggle("active", isSrc === CS.source.active);
        }
        var bar = document.getElementById("source-bar");
        if (bar) { bar.style.display = CS.source.active ? "flex" : "none"; }
        var name = document.getElementById("source-name");
        if (name) { name.textContent = CS.source.media ? CS.source.media.name : ""; }
        CS.source.paintRange();
    },

    paintRange: function () {
        var lbl = document.getElementById("source-range");
        if (!lbl) { return; }
        var r = CS.source.range();
        lbl.textContent = r ? (CS.timecode(r.start) + " - " + CS.timecode(r.end)) : "";
    },

    onSeek: function () { /* the program playhead moved: nothing to do here */ },

    /* ---------- transport ---------- */

    duration: function () {
        var m = CS.source.media;
        if (!m) { return 0; }
        return m.type === "image" ? CS.IMAGE_DEFAULT_DURATION : (m.duration || 0);
    },

    seek: function (t) {
        CS.source.time = CS.clamp(t, 0, CS.source.duration());
        var el = CS.source.el;
        if (el && el.tagName !== "IMG") {
            try { el.currentTime = CS.source.time; } catch (e) {}
        }
        CS.source.render();
        CS.player.updateTransportUI();
    },

    toggle: function () {
        if (CS.source.playing) { CS.source.stop(); } else { CS.source.play(); }
    },

    play: function () {
        var el = CS.source.el;
        if (!CS.source.media) { return; }
        if (CS.source.time >= CS.source.duration() - 0.01) { CS.source.time = 0; }
        CS.source.playing = true;
        CS.source.lastTick = performance.now();
        CS.setIcon(document.getElementById("play-icon"), "pause");
        if (el && el.tagName !== "IMG") {
            try { el.currentTime = CS.source.time; } catch (e) {}
            el.muted = CS.player.monitorMuted;
            var p = el.play();
            if (p && p.catch) { p.catch(function () {}); }
        }
        cancelAnimationFrame(CS.source.rafId);
        CS.source.rafId = requestAnimationFrame(CS.source.tick);
    },

    stop: function () {
        if (!CS.source.playing) { return; }
        CS.source.playing = false;
        cancelAnimationFrame(CS.source.rafId);
        var el = CS.source.el;
        if (el && el.tagName !== "IMG") { el.pause(); }
        var icon = document.getElementById("play-icon");
        if (icon) { CS.setIcon(icon, "play"); }
    },

    tick: function (now) {
        if (!CS.source.playing) { return; }
        var el = CS.source.el;
        if (el && el.tagName !== "IMG" && !el.paused) {
            CS.source.time = el.currentTime;
        } else {
            CS.source.time += (now - CS.source.lastTick) / 1000;
        }
        CS.source.lastTick = now;
        if (CS.source.time >= CS.source.duration()) {
            CS.source.time = CS.source.duration();
            CS.source.render();
            CS.player.updateTransportUI();
            CS.source.stop();
            return;
        }
        CS.source.render();
        CS.player.updateTransportUI();
        CS.source.rafId = requestAnimationFrame(CS.source.tick);
    },

    /* ---------- drawing ---------- */

    render: function () {
        var ctx = CS.player.ctx;
        var cv = CS.player.canvas;
        if (!ctx || !CS.source.media) { return; }
        var W = cv.width, H = cv.height;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.filter = "none";
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
        var m = CS.source.media;
        var el = CS.source.el;
        if (m.type === "audio") {
            CS.media.drawWave(ctx, m.peaks, W, H, "#35c98b");
            //playhead over the waveform
            ctx.fillStyle = "#fff";
            ctx.fillRect(Math.round(W * CS.source.time / Math.max(0.01, m.duration || 1)), 0, 2, H);
        } else if (el) {
            var sw = el.tagName === "IMG" ? el.naturalWidth : el.videoWidth;
            var sh = el.tagName === "IMG" ? el.naturalHeight : el.videoHeight;
            if (sw && sh) {
                var s = Math.min(W / sw, H / sh);
                var dw = sw * s, dh = sh * s;
                try { ctx.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh); } catch (e) {}
            }
        }
        //in / out marks along the bottom edge
        var r = CS.source.range();
        if (r) {
            var d = Math.max(0.01, CS.source.duration());
            ctx.fillStyle = "rgba(46,124,246,0.85)";
            ctx.fillRect(W * r.start / d, H - 4, Math.max(2, W * (r.end - r.start) / d), 4);
        }
    },

    /* ---------- in / out ---------- */

    markIn: function () {
        CS.source.inPoint = CS.source.time;
        if (CS.source.outPoint !== null && CS.source.outPoint <= CS.source.inPoint) { CS.source.outPoint = null; }
        CS.source.paintRange();
        CS.source.render();
    },

    markOut: function () {
        CS.source.outPoint = CS.source.time;
        if (CS.source.inPoint !== null && CS.source.inPoint >= CS.source.outPoint) { CS.source.inPoint = null; }
        CS.source.paintRange();
        CS.source.render();
    },

    //Marked range, defaulting to the whole clip
    range: function () {
        if (!CS.source.media) { return null; }
        var d = CS.source.duration();
        var a = CS.source.inPoint === null ? 0 : CS.source.inPoint;
        var b = CS.source.outPoint === null ? d : CS.source.outPoint;
        if (b <= a + 0.01) { return null; }
        return { start: a, end: b };
    },

    /* ---------- insert / overwrite ---------- */

    //Track the edit lands on: the first targeted track of the right kind
    targetTrack: function (media) {
        var kind = media.type === "audio" ? "audio" : "video";
        var tracks = CS.targetTracks(kind);
        if (!tracks.length) { return CS.createTrack(kind); }
        return tracks[0].id;
    },

    makeClip: function (media, range, trackId, at) {
        return {
            id: CS.uid(),
            mediaId: media.id,
            trackId: trackId,
            start: at,
            in: range.start,
            out: range.end,
            props: CS.defaultClipProps()
        };
    },

    //Insert: open a gap of the clip's length at the playhead on every
    //unlocked track, then drop the clip into it
    insert: function () {
        var media = CS.source.media;
        var range = media && CS.source.range();
        if (!media || !range) { CS.toast("Open a clip in the source monitor and mark in / out first"); return; }
        var at = CS.state.playhead;
        var len = range.end - range.start;
        var trackId = CS.source.targetTrack(media);
        if (CS.trackLocked(trackId)) { CS.toast("Target track is locked", true); return; }
        //Clips straddling the playhead are cut so the gap opens cleanly
        CS.project.clips.slice().forEach(function (c) {
            if (CS.trackLocked(c.trackId)) { return; }
            if (at > c.start + 0.001 && at < CS.clipEnd(c) - 0.001) { CS.splitClip(c, at); }
        });
        CS.project.clips.forEach(function (c) {
            if (!CS.trackLocked(c.trackId) && c.start >= at - 0.001) { c.start += len; }
        });
        var clip = CS.source.makeClip(media, range, trackId, at);
        CS.project.clips.push(clip);
        CS.selectClip(clip.id);
        CS.player.seek(at + len);
        CS.commit("Insert");
        CS.source.setActive(false);
    },

    //Overwrite: whatever the range covers on the target track is removed
    overwrite: function () {
        var media = CS.source.media;
        var range = media && CS.source.range();
        if (!media || !range) { CS.toast("Open a clip in the source monitor and mark in / out first"); return; }
        var at = CS.state.playhead;
        var len = range.end - range.start;
        var trackId = CS.source.targetTrack(media);
        if (CS.trackLocked(trackId)) { CS.toast("Target track is locked", true); return; }
        var inside = CS.isolateRange({ start: at, end: at + len }, [CS.getTrack(trackId)]);
        var ids = inside.map(function (c) { return c.id; });
        CS.project.clips = CS.project.clips.filter(function (c) { return ids.indexOf(c.id) < 0; });
        var clip = CS.source.makeClip(media, range, trackId, at);
        CS.project.clips.push(clip);
        CS.selectClip(clip.id);
        CS.player.seek(at + len);
        CS.commit("Overwrite");
        CS.source.setActive(false);
    }
};
