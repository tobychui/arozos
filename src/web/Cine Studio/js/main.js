/*
    Cine Studio - core state model

    CS.project holds everything that is serialized into a .cine file:
    media pool, tracks, clips and project settings. CS.state holds
    transient editor state (playhead, selection, zoom, tool).
*/
"use strict";

window.CS = window.CS || {};

//Everything the editor accepts. Formats a browser cannot decode itself are
//turned into proxies by the host's ffmpeg (see media.js prepare)
CS.VIDEO_EXTS = ["mp4", "webm", "mov", "mkv", "m4v", "avi", "ogv", "ts", "m2ts", "mts", "flv", "wmv",
    "mpg", "mpeg", "3gp", "3g2", "mxf", "vob", "divx", "f4v", "asf", "rm", "rmvb", "mk3d", "y4m", "dv", "hevc", "h264", "264", "265"];
CS.AUDIO_EXTS = ["mp3", "wav", "aac", "flac", "ogg", "oga", "m4a", "opus", "wma", "aif", "aiff", "aifc", "ape",
    "ac3", "eac3", "dts", "mka", "amr", "caf", "m4b", "mp2", "au", "wv", "tta", "spx", "mid", "midi"];
CS.IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg", "tif", "tiff", "heic", "heif",
    "psd", "tga", "dds", "exr", "pbm", "pgm", "ppm", "jp2", "ico"];
CS.PROJECT_EXT = "cine";
CS.APP_ROOT = "user:/Cine Studio";
CS.IMAGE_DEFAULT_DURATION = 5;

//What a mainstream browser plays / decodes on its own (container level; the
//codecs inside a video are checked with the media server's probe endpoint)
CS.BROWSER_VIDEO_EXTS = ["mp4", "webm", "m4v", "ogv", "mov"];
CS.BROWSER_AUDIO_EXTS = ["mp3", "wav", "aac", "flac", "ogg", "oga", "m4a", "opus"];
CS.BROWSER_IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg", "ico"];
//Still formats ffmpeg reads directly; anything else is rasterised before a
//render (titles, SVG, AVIF ...)
CS.FFMPEG_IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

//Playback resolution of the preview, like Premiere's Full / 1/2 / 1/4: the
//preview canvas is composited at this fraction of the project size and
//footage larger than that is played through a proxy of matching size
CS.PREVIEW_QUALITIES = [
    { v: 1, l: "Full" },
    { v: 0.5, l: "1/2" },
    { v: 0.25, l: "1/4" }
];
CS.prefs = { previewQuality: 1 };
try {
    var storedQ = parseFloat(localStorage.getItem("cinestudio_preview_quality"));
    if (storedQ === 0.5 || storedQ === 0.25 || storedQ === 1) { CS.prefs.previewQuality = storedQ; }
} catch (e) { /* storage unavailable */ }

CS.previewQuality = function () {
    return CS.prefs.previewQuality || 1;
};

CS.setPreviewQuality = function (q) {
    CS.prefs.previewQuality = q;
    try { localStorage.setItem("cinestudio_preview_quality", String(q)); } catch (e) { /* ignore */ }
    var label = document.getElementById("preview-quality-label");
    if (label) {
        CS.PREVIEW_QUALITIES.forEach(function (o) { if (o.v === q) { label.textContent = o.l; } });
    }
    if (CS.player) { CS.player.applyProjectSize(); }
    if (CS.media) { CS.media.applyQuality(); }
};

//Proxy height for the current playback resolution: the project height scaled
//down, never below 240 px, 0 (source size) at full quality. Mirrors
//render.ProxyHeight on the server.
CS.proxyHeight = function () {
    var q = CS.previewQuality();
    if (q >= 1) { return 0; }
    var h = Math.floor(CS.project.settings.height * q);
    if (h < 240) { h = 240; }
    return h - (h % 2);
};

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
        cropTop: 0,
        cropBottom: 0,
        cropLeft: 0,
        cropRight: 0,
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
        linked: true,        // linked selection: video + its detached audio select together
        inPoint: null,       // sequence in / out points (seconds), null = unset
        outPoint: null,
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
    //The window title is the single indicator of the saved / edited state
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

//Primary selection; replaces any multi-selection with the single clip (and
//its link partners while linked selection is on)
CS.selectClip = function (clipId) {
    CS.state.selectedClipId = clipId;
    CS.state.selectedClipIds = clipId ? [clipId] : [];
    if (clipId && CS.state.linked) {
        CS.linkPartners(clipId).forEach(function (c) {
            if (CS.state.selectedClipIds.indexOf(c.id) < 0) { CS.state.selectedClipIds.push(c.id); }
        });
    }
    CS.timeline.refreshSelection();
    CS.inspector.render();
};

//Other clips sharing the clip's link group
CS.linkPartners = function (clipId) {
    var clip = CS.getClip(clipId);
    if (!clip || !clip.props.link) { return []; }
    return CS.project.clips.filter(function (c) { return c.id !== clipId && c.props.link === clip.props.link; });
};

CS.trackLocked = function (trackId) {
    var t = CS.getTrack(trackId);
    return !!(t && t.locked);
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
    var clips = CS.selectedClips().filter(function (c) { return !CS.trackLocked(c.trackId); });
    if (!clips.length) { CS.toast(CS.selectedClips().length ? "Track is locked" : "No clip selected"); return; }
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
    if (CS.trackLocked(clip.trackId)) { CS.toast("Track is locked", true); return; }
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

//Split the clip under the playhead (prefers the selected clip; with a
//multi-selection under the playhead every selected clip is split)
CS.splitAtPlayhead = function () {
    var t = CS.state.playhead;
    var candidates = CS.project.clips.filter(function (c) {
        return t > c.start + 0.02 && t < CS.clipEnd(c) - 0.02 && !CS.trackLocked(c.trackId);
    });
    if (candidates.length === 0) { CS.toast("Playhead is not over a splittable clip"); return; }
    var selected = candidates.filter(function (c) {
        return (CS.state.selectedClipIds || []).indexOf(c.id) >= 0;
    });
    var targets = selected.length ? selected : [candidates[0]];
    var newIds = [];
    var done = {};
    targets.forEach(function (clip) {
        //A link partner already cut alongside an earlier target is skipped
        if (done[clip.id]) { return; }
        var made = CS.splitClipLinked(clip, t);
        made.forEach(function (pair) {
            done[pair.left] = true;
            newIds.push(pair.right);
        });
    });
    CS.state.selectedClipIds = newIds;
    CS.state.selectedClipId = newIds[newIds.length - 1];
    CS.commit("Split Clip");
};

//Split a clip and, while linked selection is on, its link partners too.
//Returns [{left, right}] ids for every clip that was cut, the clip first.
CS.splitClipLinked = function (clip, t) {
    var made = [];
    if (t > clip.start + 0.02 && t < CS.clipEnd(clip) - 0.02) {
        made.push({ left: clip.id, right: CS.splitClip(clip, t) });
    }
    if (CS.state.linked) {
        CS.linkPartners(clip.id).forEach(function (p) {
            if (t > p.start + 0.02 && t < CS.clipEnd(p) - 0.02 && !CS.trackLocked(p.trackId)) {
                made.push({ left: p.id, right: CS.splitClip(p, t) });
            }
        });
    }
    return made;
};

CS.splitClip = function (clip, t) {
    var srcOffset = (t - clip.start) * CS.clipSpeed(clip);
    var right = JSON.parse(JSON.stringify(clip));
    right.id = CS.uid();
    right.start = t;
    right.in = clip.in + srcOffset;
    clip.out = clip.in + srcOffset;
    //A transition belongs to the head of the original clip only
    right.props.transition = null;
    right.props.audioTransition = null;
    if (CS.keyframes) { CS.keyframes.splitKeyframes(clip, right, t - clip.start); }
    CS.project.clips.push(right);
    CS.state.selectedClipId = right.id;
    CS.state.selectedClipIds = [right.id];
    return right.id;
};

//Place a media item on the timeline. Returns the new clip.
CS.addClipToTimeline = function (media, trackId, startTime) {
    var track = CS.getTrack(trackId);
    if (!track) { return null; }
    if (media.offline) { CS.toast("Cannot use offline media", true); return null; }
    if (!media.probed && media.type !== "image") {
        CS.toast(media.proxyState === "pending"
            ? "Still preparing " + media.name + " - try again in a moment"
            : media.name + " is still loading", true);
        return null;
    }
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
    //Video and its audio stay linked so they select, move and split together
    var link = clip.props.link || CS.uid();
    clip.props.link = link;
    audioClip.props.link = link;
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

//Ask the server whether ffmpeg is available: it enables server-side renders
//and proxies for footage the browser cannot play
CS.serverFFmpeg = false;
CS.serverHWEncoder = "";
CS._ffmpegChecked = false;
CS._ffmpegWaiters = [];
CS.checkServerFFmpeg = function () {
    if (!CS.inArozOS()) { CS._ffmpegChecked = true; return; }
    function done() {
        CS._ffmpegChecked = true;
        var waiters = CS._ffmpegWaiters;
        CS._ffmpegWaiters = [];
        waiters.forEach(function (fn) { fn(); });
    }
    ao_module_agirun("Cine Studio/backend/ffmpegtools.js", { action: "check" }, function (resp) {
        try {
            var data = typeof resp === "string" ? JSON.parse(resp) : resp;
            CS.serverFFmpeg = !!data.ffmpeg;
            CS.serverHWEncoder = data.hwEncoder || "";
        } catch (e) { CS.serverFFmpeg = false; }
        done();
    }, function () { CS.serverFFmpeg = false; done(); });
};

//Run fn once the ffmpeg check has answered (immediately if it already has)
CS.whenFFmpegKnown = function (fn) {
    if (CS._ffmpegChecked) { fn(); } else { CS._ffmpegWaiters.push(fn); }
};

/* ---------- linking ---------- */

//Link every selected clip into one group (moves, selects, splits together)
CS.linkSelectedClips = function () {
    var clips = CS.selectedClips();
    if (clips.length < 2) { CS.toast("Select two or more clips to link"); return; }
    var link = CS.uid();
    clips.forEach(function (c) { c.props.link = link; });
    CS.commit("Link Clips");
    CS.toast(clips.length + " clips linked");
};

CS.unlinkClips = function () {
    var clips = CS.selectedClips();
    if (!clips.length) { return; }
    clips.forEach(function (c) {
        CS.linkPartners(c.id).forEach(function (p) { p.props.link = ""; });
        c.props.link = "";
    });
    CS.commit("Unlink Clips");
    CS.toast("Clips unlinked");
};

/* ---------- sequence in / out and range edits ---------- */

CS.setInPoint = function (t) {
    CS.state.inPoint = Math.max(0, t);
    if (CS.state.outPoint !== null && CS.state.outPoint <= CS.state.inPoint) { CS.state.outPoint = null; }
    CS.timeline.drawRuler();
    CS.timeline.updateRange();
};

CS.setOutPoint = function (t) {
    CS.state.outPoint = Math.max(0, t);
    if (CS.state.inPoint !== null && CS.state.inPoint >= CS.state.outPoint) { CS.state.inPoint = null; }
    CS.timeline.drawRuler();
    CS.timeline.updateRange();
};

CS.clearInOut = function (which) {
    if (which !== "out") { CS.state.inPoint = null; }
    if (which !== "in") { CS.state.outPoint = null; }
    CS.timeline.drawRuler();
    CS.timeline.updateRange();
};

//The effective range: unset ends fall back to the sequence bounds
CS.inOutRange = function () {
    var a = CS.state.inPoint, b = CS.state.outPoint;
    if ((a === null || a === undefined) && (b === null || b === undefined)) { return null; }
    var start = (a === null || a === undefined) ? 0 : a;
    var end = (b === null || b === undefined) ? CS.timelineDuration() : b;
    if (end <= start + 0.001) { return null; }
    return { start: start, end: end };
};

//Tracks an insert / overwrite / lift / extract acts on: the targeted ones,
//or every unlocked track when nothing is targeted
CS.targetTracks = function (kind) {
    var all = CS.project.tracks.filter(function (t) { return !t.locked && (!kind || t.kind === kind); });
    var targeted = all.filter(function (t) { return t.target !== false; });
    return targeted.length ? targeted : all;
};

//Cut every clip on the given tracks at the range bounds so the range can be
//removed cleanly; returns the clips lying fully inside the range
CS.isolateRange = function (range, tracks) {
    var trackIds = tracks.map(function (t) { return t.id; });
    [range.start, range.end].forEach(function (t) {
        CS.project.clips.slice().forEach(function (c) {
            if (trackIds.indexOf(c.trackId) < 0) { return; }
            if (t > c.start + 0.001 && t < CS.clipEnd(c) - 0.001) { CS.splitClip(c, t); }
        });
    });
    return CS.project.clips.filter(function (c) {
        return trackIds.indexOf(c.trackId) >= 0 && c.start >= range.start - 0.001 && CS.clipEnd(c) <= range.end + 0.001;
    });
};

//Lift: remove what lies between in and out on the target tracks, leaving a gap
CS.rangeLift = function () {
    var range = CS.inOutRange();
    if (!range) { CS.toast("Set in and out points first (I / O)"); return; }
    var inside = CS.isolateRange(range, CS.targetTracks());
    if (!inside.length) { CS.toast("Nothing inside the in / out range"); return; }
    var ids = inside.map(function (c) { return c.id; });
    CS.project.clips = CS.project.clips.filter(function (c) { return ids.indexOf(c.id) < 0; });
    CS.state.selectedClipId = null;
    CS.state.selectedClipIds = [];
    CS.commit("Lift");
};

//Extract: like lift, then close the gap on every unlocked track
CS.rangeExtract = function () {
    var range = CS.inOutRange();
    if (!range) { CS.toast("Set in and out points first (I / O)"); return; }
    var tracks = CS.project.tracks.filter(function (t) { return !t.locked; });
    var inside = CS.isolateRange(range, tracks);
    var ids = inside.map(function (c) { return c.id; });
    CS.project.clips = CS.project.clips.filter(function (c) { return ids.indexOf(c.id) < 0; });
    var len = range.end - range.start;
    CS.project.clips.forEach(function (c) {
        if (!CS.trackLocked(c.trackId) && c.start >= range.end - 0.001) { c.start -= len; }
    });
    CS.state.selectedClipId = null;
    CS.state.selectedClipIds = [];
    CS.clearInOut();
    CS.commit("Extract");
};

//Gap on a track around time t, or null when a clip covers t
CS.gapAt = function (trackId, t) {
    var clips = CS.clipsOnTrack(trackId);
    var start = 0, end = Infinity;
    for (var i = 0; i < clips.length; i++) {
        var c = clips[i];
        if (t >= c.start && t < CS.clipEnd(c)) { return null; }
        if (CS.clipEnd(c) <= t) { start = Math.max(start, CS.clipEnd(c)); }
        if (c.start > t) { end = Math.min(end, c.start); }
    }
    if (end === Infinity) { return null; } //trailing space is not a gap
    return { start: start, end: end };
};

//Ripple delete a gap: everything after it on the track moves left
CS.closeGap = function (trackId, gap) {
    if (!gap) { return; }
    var len = gap.end - gap.start;
    CS.clipsOnTrack(trackId).forEach(function (c) {
        if (c.start >= gap.end - 0.001) { c.start -= len; }
    });
    CS.commit("Close Gap");
};

/* ---------- nudging ---------- */

//Move the selected clips by a number of frames (negative = left)
CS.nudgeSelected = function (frames) {
    var clips = CS.selectedClips().filter(function (c) { return !CS.trackLocked(c.trackId); });
    if (!clips.length) { return; }
    var dt = frames / CS.project.settings.fps;
    clips.sort(function (a, b) { return frames > 0 ? b.start - a.start : a.start - b.start; });
    clips.forEach(function (c) {
        c.start = CS.timeline.resolveOverlap(c, c.trackId, Math.max(0, c.start + dt));
    });
    CS.commit("Nudge");
};

/* ---------- markers ---------- */

CS.MARKER_COLORS = ["#f6c945", "#2e7cf6", "#35c98b", "#e2574c", "#b56bd8", "#f28c3b", "#ffffff"];

CS.markerNear = function (t, eps) {
    var ms = CS.project.markers || [];
    for (var i = 0; i < ms.length; i++) {
        if (Math.abs(ms[i].time - t) < eps) { return ms[i]; }
    }
    return null;
};

//Name, colour, comment and duration of a marker
CS.editMarkerDialog = function (m) {
    var nameIn, colorIn, durIn, noteIn;
    CS.modal({
        title: "Marker",
        build: function (body) {
            nameIn = CS.modalRow(body, "Name", CS.textInput(m.name || ""));
            colorIn = CS.modalRow(body, "Color", CS.selectInput(CS.MARKER_COLORS.map(function (c, i) {
                return { v: c, l: ["Yellow", "Blue", "Green", "Red", "Purple", "Orange", "White"][i] };
            }), m.color || CS.MARKER_COLORS[0]));
            durIn = CS.modalRow(body, "Duration (s)", CS.textInput(String(m.duration || 0)));
            noteIn = CS.modalRow(body, "Comment", CS.textInput(m.note || ""));
        },
        buttons: [
            { label: "Delete", action: function () {
                CS.project.markers = CS.project.markers.filter(function (x) { return x !== m; });
                CS.markDirty();
                CS.timeline.drawRuler();
            } },
            { label: "Cancel" },
            { label: "Save", primary: true, action: function () {
                m.name = nameIn.value.trim();
                m.color = colorIn.value;
                m.duration = Math.max(0, parseFloat(durIn.value) || 0);
                m.note = noteIn.value.trim();
                CS.markDirty();
                CS.timeline.drawRuler();
            } }
        ]
    });
};

/* ---------- speed / duration, frame hold ---------- */

CS.speedDialog = function (clip) {
    var media = CS.getMedia(clip.mediaId);
    if (!media || media.type === "image") { return; }
    var speedIn, durIn, revIn;
    var srcLen = clip.out - clip.in;
    CS.modal({
        title: "Speed / Duration",
        build: function (body) {
            speedIn = CS.modalRow(body, "Speed (%)", CS.textInput(String(Math.round(CS.clipSpeed(clip) * 100))));
            durIn = CS.modalRow(body, "Duration (s)", CS.textInput(CS.clipDuration(clip).toFixed(2)));
            speedIn.addEventListener("input", function () {
                var s = parseFloat(speedIn.value) / 100;
                if (s > 0) { durIn.value = (srcLen / s).toFixed(2); }
            });
            durIn.addEventListener("input", function () {
                var d = parseFloat(durIn.value);
                if (d > 0) { speedIn.value = String(Math.round(srcLen / d * 100)); }
            });
            var revLabel = document.createElement("label");
            revLabel.className = "modal-check";
            revIn = document.createElement("input");
            revIn.type = "checkbox";
            revIn.checked = !!clip.props.reverse;
            revLabel.appendChild(revIn);
            revLabel.appendChild(document.createTextNode("Reverse speed"));
            CS.modalRow(body, "Direction", revLabel);
            var note = document.createElement("div");
            note.className = "modal-note";
            note.textContent = "Changing the speed changes the clip length on the timeline. Reversed clips play their source backwards.";
            body.appendChild(note);
        },
        buttons: [
            { label: "Cancel" },
            { label: "Apply", primary: true, action: function () {
                var s = CS.clamp(parseFloat(speedIn.value) / 100 || 1, 0.1, 8);
                clip.props.speed = s;
                clip.props.reverse = !!revIn.checked;
                CS.timeline.clampTrimOverlap(clip);
                CS.commit("Speed / Duration");
            } }
        ]
    });
};

//Insert a still of the frame under the playhead right after it (Premiere's
//Add Frame Hold): the still is captured from the clip's own picture
CS.addFrameHold = function (clip) {
    var media = CS.getMedia(clip.mediaId);
    if (!media || media.type !== "video") { CS.toast("Frame holds come from video clips", true); return; }
    var t = CS.state.playhead;
    if (!(t >= clip.start && t < CS.clipEnd(clip))) { t = clip.start; }
    var el = CS.player.pool[clip.id];
    if (!el || el.readyState < 2 || !el.videoWidth) {
        CS.toast("Frame not ready yet - try again in a moment", true);
        return;
    }
    var c = document.createElement("canvas");
    c.width = el.videoWidth;
    c.height = el.videoHeight;
    c.getContext("2d").drawImage(el, 0, 0);
    c.toBlob(function (blob) {
        if (!blob) { CS.toast("Could not capture the frame", true); return; }
        var name = CS.baseName(media.name) + " hold " + CS.timecode(t).replace(/:/g, ".") + ".png";
        function place(still) {
            var hold = {
                id: CS.uid(),
                mediaId: still.id,
                trackId: clip.trackId,
                start: t,
                in: 0,
                out: 2,
                props: JSON.parse(JSON.stringify(clip.props))
            };
            hold.props.speed = 1;
            hold.props.reverse = false;
            hold.props.transition = null;
            hold.props.volume = 0;
            //Cut the clip and push its tail behind the hold
            if (t > clip.start + 0.02 && t < CS.clipEnd(clip) - 0.02) {
                var rightId = CS.splitClip(clip, t);
                var right = CS.getClip(rightId);
                right.start += 2;
            }
            CS.clipsOnTrack(clip.trackId).forEach(function (c2) {
                if (c2.id !== clip.id && c2.start >= t + 2 - 0.001 && c2.start < t + 2 + 2) { return; }
                if (c2.id !== clip.id && c2.start >= t && c2.start < t + 2) { c2.start += 2; }
            });
            CS.project.clips.push(hold);
            CS.selectClip(hold.id);
            CS.commit("Add Frame Hold");
        }
        if (CS.inArozOS() && typeof ao_module_uploadFile !== "undefined") {
            var file = new File([blob], name, { type: "image/png" });
            ao_module_uploadFile(file, CS.APP_ROOT + "/Media", function () {
                var still = CS.media.register({ name: name, vpath: CS.APP_ROOT + "/Media/" + name, type: "image" });
                place(still);
            }, undefined, function () { CS.toast("Could not save the frame", true); });
        } else {
            place(CS.media.register({ name: name, blobUrl: URL.createObjectURL(blob), type: "image" }));
        }
    }, "image/png");
};

/* ---------- history panel ---------- */

CS.historyDialog = function () {
    CS.modal({
        title: "History",
        build: function (body) {
            var list = document.createElement("div");
            list.className = "history-list";
            CS.history.stack.forEach(function (snap, i) {
                var row = document.createElement("button");
                row.className = "history-item" + (i === CS.history.index ? " current" : "") + (i > CS.history.index ? " undone" : "");
                row.textContent = (i + 1) + ". " + snap.label;
                row.addEventListener("click", function () {
                    CS.history.index = i;
                    CS.applySnapshot(snap);
                    CS.closeModal();
                });
                list.appendChild(row);
            });
            body.appendChild(list);
            var note = document.createElement("div");
            note.className = "modal-note";
            note.textContent = "Click a step to jump back (or forward) to it.";
            body.appendChild(note);
        },
        buttons: [{ label: "Close" }]
    });
};
