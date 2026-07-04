/*
    Cine Studio - core state model

    CS.project holds everything that is serialized into a .cine file:
    media pool, tracks, clips and project settings. CS.state holds
    transient editor state (playhead, selection, zoom, tool).
*/
"use strict";

window.CS = window.CS || {};

CS.VIDEO_EXTS = ["mp4", "webm", "mov", "mkv", "m4v", "avi", "ogv"];
CS.AUDIO_EXTS = ["mp3", "wav", "aac", "flac", "ogg", "m4a", "opus"];
CS.IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
CS.PROJECT_EXT = "cine";
CS.APP_ROOT = "user:/Cine Studio";
CS.IMAGE_DEFAULT_DURATION = 5;

CS.inArozOS = function () {
    return typeof ao_module_agirun !== "undefined" && window.location.protocol !== "file:" &&
        !CS._forceStandalone;
};

/* ---------- project factory ---------- */

CS.defaultClipProps = function () {
    return {
        x: 0, y: 0,
        scale: 100,
        rotation: 0,
        opacity: 100,
        crop: "fit",
        preset: "default",
        exposure: 0,
        contrast: 0,
        saturation: 1,
        volume: 100,
        effects: [],
        transition: null
    };
};

CS.newProject = function (opts) {
    opts = opts || {};
    CS.project = {
        app: "CineStudio",
        version: 1,
        name: opts.name || "My Project",
        filePath: "",
        fileName: "",
        settings: {
            width: opts.width || 1920,
            height: opts.height || 1080,
            fps: opts.fps || 30
        },
        media: [],
        tracks: [
            { id: "V1", kind: "video", name: "Video 1", visible: true, muted: false },
            { id: "A1", kind: "audio", name: "Audio 1", visible: true, muted: false },
            { id: "A2", kind: "audio", name: "Audio 2", visible: true, muted: false }
        ],
        clips: []
    };
    CS.state = {
        playhead: 0,
        playing: false,
        selectedClipId: null,
        selectedMediaId: null,
        zoom: 40,            // pixels per second
        tool: "select",
        previewZoom: "fit",
        safeArea: false,
        binKind: "all",
        binSearch: "",
        binView: "grid",
        dirty: false
    };
    CS.history = { stack: [], index: -1 };
    CS.pushHistory("New Project");
    if (CS.player) { CS.player.reset(); }
};

/* ---------- lookups ---------- */

CS.getMedia = function (id) {
    for (var i = 0; i < CS.project.media.length; i++) {
        if (CS.project.media[i].id === id) { return CS.project.media[i]; }
    }
    return null;
};

CS.getClip = function (id) {
    for (var i = 0; i < CS.project.clips.length; i++) {
        if (CS.project.clips[i].id === id) { return CS.project.clips[i]; }
    }
    return null;
};

CS.getTrack = function (id) {
    for (var i = 0; i < CS.project.tracks.length; i++) {
        if (CS.project.tracks[i].id === id) { return CS.project.tracks[i]; }
    }
    return null;
};

CS.selectedClip = function () {
    return CS.state.selectedClipId ? CS.getClip(CS.state.selectedClipId) : null;
};

//Video tracks top-down (V2 above V1), then audio tracks in order (A1, A2, ...)
CS.tracksInDisplayOrder = function () {
    var video = CS.project.tracks.filter(function (t) { return t.kind === "video"; });
    var audio = CS.project.tracks.filter(function (t) { return t.kind === "audio"; });
    video.sort(function (a, b) { return b.id.localeCompare(a.id, undefined, { numeric: true }); });
    audio.sort(function (a, b) { return a.id.localeCompare(b.id, undefined, { numeric: true }); });
    return video.concat(audio);
};

//Video tracks bottom-up for compositing (V1 first, higher tracks painted over)
CS.videoTracksInRenderOrder = function () {
    var video = CS.project.tracks.filter(function (t) { return t.kind === "video"; });
    video.sort(function (a, b) { return a.id.localeCompare(b.id, undefined, { numeric: true }); });
    return video;
};

CS.clipsOnTrack = function (trackId) {
    return CS.project.clips
        .filter(function (c) { return c.trackId === trackId; })
        .sort(function (a, b) { return a.start - b.start; });
};

CS.clipDuration = function (clip) {
    return clip.out - clip.in;
};

CS.clipEnd = function (clip) {
    return clip.start + CS.clipDuration(clip);
};

CS.timelineDuration = function () {
    var end = 0;
    CS.project.clips.forEach(function (c) {
        var e = CS.clipEnd(c);
        if (e > end) { end = e; }
    });
    return end;
};

//Sorted unique clip boundaries, used by prev/next edit point buttons
CS.editPoints = function () {
    var pts = [0];
    CS.project.clips.forEach(function (c) {
        pts.push(c.start);
        pts.push(CS.clipEnd(c));
    });
    pts.sort(function (a, b) { return a - b; });
    return pts.filter(function (p, i) { return i === 0 || p - pts[i - 1] > 0.0001; });
};

/* ---------- history (undo / redo) ---------- */

CS.pushHistory = function (label) {
    var snap = {
        label: label,
        clips: JSON.parse(JSON.stringify(CS.project.clips)),
        tracks: JSON.parse(JSON.stringify(CS.project.tracks))
    };
    CS.history.stack = CS.history.stack.slice(0, CS.history.index + 1);
    CS.history.stack.push(snap);
    if (CS.history.stack.length > 100) { CS.history.stack.shift(); }
    CS.history.index = CS.history.stack.length - 1;
};

//Call after any timeline mutation: records history and refreshes UI
CS.commit = function (label) {
    CS.pushHistory(label);
    CS.markDirty();
    CS.timeline.render();
    CS.inspector.render();
    CS.player.invalidate();
};

CS.applySnapshot = function (snap) {
    CS.project.clips = JSON.parse(JSON.stringify(snap.clips));
    CS.project.tracks = JSON.parse(JSON.stringify(snap.tracks));
    if (CS.state.selectedClipId && !CS.getClip(CS.state.selectedClipId)) {
        CS.state.selectedClipId = null;
    }
    CS.markDirty();
    CS.timeline.render();
    CS.inspector.render();
    CS.player.invalidate();
};

CS.undo = function () {
    if (CS.history.index <= 0) { CS.toast("Nothing to undo"); return; }
    CS.history.index--;
    CS.applySnapshot(CS.history.stack[CS.history.index]);
};

CS.redo = function () {
    if (CS.history.index >= CS.history.stack.length - 1) { CS.toast("Nothing to redo"); return; }
    CS.history.index++;
    CS.applySnapshot(CS.history.stack[CS.history.index]);
};

/* ---------- dirty / title state ---------- */

CS.markDirty = function () {
    CS.state.dirty = true;
    CS.updateSaveState();
};

CS.markClean = function () {
    CS.state.dirty = false;
    CS.updateSaveState();
};

CS.updateSaveState = function () {
    var el = document.getElementById("save-state-icon");
    if (el) { CS.setIcon(el, CS.state.dirty ? "dot-circle" : "check-circle"); }
    var nameEl = document.getElementById("project-name");
    if (nameEl) { nameEl.textContent = CS.project.name; }
    var title = CS.project.name + (CS.state.dirty ? " (edited)" : "") + " - Cine Studio";
    if (typeof ao_module_setWindowTitle !== "undefined") {
        try { ao_module_setWindowTitle(title); } catch (e) { document.title = title; }
    } else {
        document.title = title;
    }
};

/* ---------- clip operations ---------- */

CS.selectClip = function (clipId) {
    CS.state.selectedClipId = clipId;
    CS.timeline.refreshSelection();
    CS.inspector.render();
};

CS.deleteSelectedClip = function () {
    var clip = CS.selectedClip();
    if (!clip) { CS.toast("No clip selected"); return; }
    CS.project.clips = CS.project.clips.filter(function (c) { return c.id !== clip.id; });
    CS.state.selectedClipId = null;
    CS.commit("Delete Clip");
};

//Split the clip under the playhead (prefers the selected clip)
CS.splitAtPlayhead = function () {
    var t = CS.state.playhead;
    var candidates = CS.project.clips.filter(function (c) {
        return t > c.start + 0.02 && t < CS.clipEnd(c) - 0.02;
    });
    if (candidates.length === 0) { CS.toast("Playhead is not over a splittable clip"); return; }
    var clip = null;
    for (var i = 0; i < candidates.length; i++) {
        if (candidates[i].id === CS.state.selectedClipId) { clip = candidates[i]; }
    }
    if (!clip) { clip = candidates[0]; }
    CS.splitClip(clip, t);
    CS.commit("Split Clip");
};

CS.splitClip = function (clip, t) {
    var offset = t - clip.start;
    var right = JSON.parse(JSON.stringify(clip));
    right.id = CS.uid();
    right.start = t;
    right.in = clip.in + offset;
    clip.out = clip.in + offset;
    CS.project.clips.push(right);
    CS.state.selectedClipId = right.id;
};

//Place a media item on the timeline. Returns the new clip.
CS.addClipToTimeline = function (media, trackId, startTime) {
    var track = CS.getTrack(trackId);
    if (!track) { return null; }
    var duration = media.type === "image" ? CS.IMAGE_DEFAULT_DURATION : (media.duration || 1);
    var clip = {
        id: CS.uid(),
        mediaId: media.id,
        trackId: trackId,
        start: Math.max(0, startTime),
        in: 0,
        out: duration,
        props: CS.defaultClipProps()
    };
    clip.start = CS.timeline.resolveOverlap(clip, trackId, clip.start);
    CS.project.clips.push(clip);
    return clip;
};

//Create a track without committing history (callers commit themselves)
CS.createTrack = function (kind) {
    var prefix = kind === "video" ? "V" : "A";
    var maxN = 0;
    CS.project.tracks.forEach(function (t) {
        if (t.kind === kind) {
            var n = parseInt(t.id.substring(1), 10);
            if (n > maxN) { maxN = n; }
        }
    });
    var id = prefix + (maxN + 1);
    CS.project.tracks.push({
        id: id,
        kind: kind,
        name: (kind === "video" ? "Video " : "Audio ") + (maxN + 1),
        visible: true,
        muted: false
    });
    return id;
};

CS.addTrack = function (kind) {
    CS.createTrack(kind);
    CS.commit("Add Track");
};

/* ---------- backend bootstrap ---------- */

//Make sure the per-user app folders exist (no-op outside ArozOS)
CS.ensureAppFolders = function () {
    if (!CS.inArozOS()) { return; }
    ao_module_agirun("Cine Studio/backend/ensuredir.js", {}, function () {}, function () {});
};

//Ask the server whether ffmpeg is available (enables MP4 export path)
CS.serverFFmpeg = false;
CS.checkServerFFmpeg = function () {
    if (!CS.inArozOS()) { return; }
    ao_module_agirun("Cine Studio/backend/ffmpegtools.js", { action: "check" }, function (resp) {
        try {
            var data = typeof resp === "string" ? JSON.parse(resp) : resp;
            CS.serverFFmpeg = !!data.ffmpeg;
        } catch (e) { CS.serverFFmpeg = false; }
    }, function () { CS.serverFFmpeg = false; });
};
