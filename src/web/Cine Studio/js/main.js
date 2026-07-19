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
        speed: 1,
        blend: "normal",
        flipH: false,
        flipV: false,
        effects: [],
        transition: null
    };
};

CS.clipSpeed = function (clip) {
    var v = clip.props && clip.props.speed;
    return (v && v > 0) ? v : 1;
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
        loop: false,
        snap: true,
        binKind: "all",
        binSearch: "",
        binView: "grid",
        selectedClipIds: [],
        dirty: false
    };
    CS.project.markers = [];
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

//Duration on the timeline: source range divided by playback speed
CS.clipDuration = function (clip) {
    return (clip.out - clip.in) / CS.clipSpeed(clip);
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
    CS.state.selectedClipIds = (CS.state.selectedClipIds || []).filter(function (id) {
        return !!CS.getClip(id);
    });
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
    //Saved on disk: the crash-recovery snapshot is no longer needed
    if (CS.session) { CS.session.clearSnapshot(); }
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

/* ---------- selection (multi-select aware) ---------- */

//Primary selection; replaces any multi-selection with the single clip
CS.selectClip = function (clipId) {
    CS.state.selectedClipId = clipId;
    CS.state.selectedClipIds = clipId ? [clipId] : [];
    CS.timeline.refreshSelection();
    CS.inspector.render();
};

//Shift-click: add / remove a clip from the selection set
CS.toggleSelectClip = function (clipId) {
    var ids = CS.state.selectedClipIds || [];
    var idx = ids.indexOf(clipId);
    if (idx >= 0) {
        ids.splice(idx, 1);
        if (CS.state.selectedClipId === clipId) {
            CS.state.selectedClipId = ids.length ? ids[ids.length - 1] : null;
        }
    } else {
        ids.push(clipId);
        CS.state.selectedClipId = clipId;
    }
    CS.state.selectedClipIds = ids;
    CS.timeline.refreshSelection();
    CS.inspector.render();
};

CS.selectedClips = function () {
    return (CS.state.selectedClipIds || [])
        .map(function (id) { return CS.getClip(id); })
        .filter(function (c) { return !!c; });
};

CS.deleteSelectedClip = function () {
    var clips = CS.selectedClips();
    if (!clips.length) { CS.toast("No clip selected"); return; }
    var ids = clips.map(function (c) { return c.id; });
    CS.project.clips = CS.project.clips.filter(function (c) { return ids.indexOf(c.id) < 0; });
    CS.state.selectedClipId = null;
    CS.state.selectedClipIds = [];
    CS.commit(clips.length > 1 ? "Delete Clips" : "Delete Clip");
};

//Delete and close the gap: later clips on the same track shift left
CS.rippleDeleteSelected = function () {
    var clips = CS.selectedClips();
    if (clips.length !== 1) {
        CS.toast(clips.length ? "Ripple delete works on a single clip" : "No clip selected");
        return;
    }
    var clip = clips[0];
    var dur = CS.clipDuration(clip);
    CS.project.clips = CS.project.clips.filter(function (c) { return c.id !== clip.id; });
    CS.clipsOnTrack(clip.trackId).forEach(function (c) {
        if (c.start >= clip.start - 0.0001) { c.start = Math.max(0, c.start - dur); }
    });
    CS.state.selectedClipId = null;
    CS.state.selectedClipIds = [];
    CS.commit("Ripple Delete");
};

/* ---------- clipboard (clips) ---------- */

CS.clipClipboard = null;

CS.copySelectedClips = function () {
    var clips = CS.selectedClips();
    if (!clips.length) { CS.toast("No clip selected"); return; }
    var minStart = Math.min.apply(null, clips.map(function (c) { return c.start; }));
    CS.clipClipboard = clips.map(function (c) {
        var copy = JSON.parse(JSON.stringify(c));
        copy.rel = c.start - minStart;
        return copy;
    });
    CS.toast("Copied " + clips.length + " clip" + (clips.length > 1 ? "s" : ""));
};

CS.pasteClipsAtPlayhead = function () {
    if (!CS.clipClipboard || !CS.clipClipboard.length) { CS.toast("Clip clipboard is empty"); return; }
    var newIds = [];
    CS.clipClipboard.forEach(function (src) {
        var clip = JSON.parse(JSON.stringify(src));
        delete clip.rel;
        clip.id = CS.uid();
        clip.start = CS.state.playhead + src.rel;
        if (!CS.getTrack(clip.trackId)) {
            //Original track is gone: fall back to the first compatible one
            var kind = (clip.kind === "title" || clip.kind === "color") ? "video"
                : (CS.getMedia(clip.mediaId) && CS.getMedia(clip.mediaId).type === "audio") ? "audio" : "video";
            var tracks = CS.project.tracks.filter(function (t) { return t.kind === kind; });
            if (!tracks.length) { return; }
            clip.trackId = tracks[0].id;
        }
        clip.start = CS.timeline.resolveOverlap(clip, clip.trackId, clip.start);
        CS.project.clips.push(clip);
        newIds.push(clip.id);
    });
    if (!newIds.length) { return; }
    CS.state.selectedClipIds = newIds;
    CS.state.selectedClipId = newIds[newIds.length - 1];
    CS.commit("Paste");
};

//Duplicate each selected clip right after itself on its own track
CS.duplicateSelectedClips = function () {
    var clips = CS.selectedClips();
    if (!clips.length) { CS.toast("No clip selected"); return; }
    var newIds = [];
    clips.forEach(function (c) {
        var clip = JSON.parse(JSON.stringify(c));
        clip.id = CS.uid();
        clip.start = CS.timeline.resolveOverlap(clip, clip.trackId, CS.clipEnd(c));
        CS.project.clips.push(clip);
        newIds.push(clip.id);
    });
    CS.state.selectedClipIds = newIds;
    CS.state.selectedClipId = newIds[newIds.length - 1];
    CS.commit("Duplicate");
};

/* ---------- timeline markers ---------- */

//Add a marker at the playhead, or remove one already there
CS.toggleMarkerAtPlayhead = function () {
    if (!CS.project.markers) { CS.project.markers = []; }
    var t = CS.state.playhead;
    var eps = 4 / CS.state.zoom; //within a few pixels counts as "here"
    for (var i = 0; i < CS.project.markers.length; i++) {
        if (Math.abs(CS.project.markers[i].time - t) < eps) {
            CS.project.markers.splice(i, 1);
            CS.markDirty();
            CS.timeline.drawRuler();
            CS.toast("Marker removed");
            return;
        }
    }
    CS.project.markers.push({ id: CS.uid(), time: t });
    CS.project.markers.sort(function (a, b) { return a.time - b.time; });
    CS.markDirty();
    CS.timeline.drawRuler();
    CS.toast("Marker added");
};

//Jump to the next / previous marker relative to the playhead
CS.gotoMarker = function (dir) {
    var ms = CS.project.markers || [];
    var t = CS.state.playhead;
    if (dir > 0) {
        for (var i = 0; i < ms.length; i++) {
            if (ms[i].time > t + 0.02) { CS.player.seek(ms[i].time); return; }
        }
    } else {
        for (var j = ms.length - 1; j >= 0; j--) {
            if (ms[j].time < t - 0.02) { CS.player.seek(ms[j].time); return; }
        }
    }
};

/* ---------- clip operations ---------- */

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
    var srcOffset = (t - clip.start) * CS.clipSpeed(clip);
    var right = JSON.parse(JSON.stringify(clip));
    right.id = CS.uid();
    right.start = t;
    right.in = clip.in + srcOffset;
    clip.out = clip.in + srcOffset;
    CS.project.clips.push(right);
    CS.state.selectedClipId = right.id;
    CS.state.selectedClipIds = [right.id];
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

//Split a video clip's embedded audio onto its own audio-track clip
CS.detachAudio = function (clip) {
    var media = CS.getMedia(clip.mediaId);
    if (!media || media.type !== "video") { return; }
    if (clip.props.audioDetached) { CS.toast("Audio is already detached"); return; }

    //Find an audio track with room at this position, or add one
    var trackId = null;
    var audioTracks = CS.project.tracks.filter(function (t) { return t.kind === "audio"; });
    for (var i = 0; i < audioTracks.length; i++) {
        var busy = CS.clipsOnTrack(audioTracks[i].id).some(function (c) {
            return clip.start < CS.clipEnd(c) && CS.clipEnd(clip) > c.start;
        });
        if (!busy) { trackId = audioTracks[i].id; break; }
    }
    if (!trackId) { trackId = CS.createTrack("audio"); }

    var audioClip = JSON.parse(JSON.stringify(clip));
    audioClip.id = CS.uid();
    audioClip.trackId = trackId;
    audioClip.props.transition = null;
    audioClip.props.effects = (clip.props.effects || []).filter(function (e) {
        return e.type === "fadein" || e.type === "fadeout";
    });
    CS.project.clips.push(audioClip);

    //Silence the original video clip's own audio
    clip.props.volume = 0;
    clip.props.audioDetached = true;

    //Waveform for the detached clip if the container's audio can be decoded
    if (!media.peaks) { CS.media.computePeaks(media); }

    CS.selectClip(audioClip.id);
    CS.commit("Detach Audio");
    CS.toast("Audio detached to " + trackId);
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
