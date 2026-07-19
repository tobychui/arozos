/*
    Audio Studio - project.js

    Project data model: tracks and clips, plus every editing operation
    (split, trim, move, cut / delete range, mute range, copy / paste)
    and an undo / redo history.

    A clip is a window into an AudioBuffer:
        { id, name, start, offset, duration, buffer }
    start    = position on the timeline (sec)
    offset   = where inside buffer the clip begins (sec)
    duration = clip length (sec)

    Content-destructive operations always build NEW AudioBuffers and never
    mutate shared ones, so undo snapshots can hold plain references.

    Depends on ASEngine (for the shared AudioContext).
*/

var ASProject = (function () {
    "use strict";

    var TRACK_COLORS = [
        { clip: "#45d3e3", wave: "#0e3a41", header: "#2fb6c6" }, //cyan
        { clip: "#6db1f7", wave: "#102c47", header: "#5697dd" }, //blue
        { clip: "#f2a7d8", wave: "#47122f", header: "#d88cbe" }, //pink
        { clip: "#ef8b8b", wave: "#451414", header: "#d57272" }, //red
        { clip: "#e7c65c", wave: "#3f3410", header: "#ccab45" }, //yellow
        { clip: "#79d6a3", wave: "#12402a", header: "#61bd8b" }, //green
        { clip: "#f0a860", wave: "#432a0d", header: "#d68f4a" }, //orange
        { clip: "#b99cf0", wave: "#2b1a4d", header: "#a184d6" }  //purple
    ];

    var EPS = 0.0005;
    var MIN_CLIP_LEN = 0.02;
    var MAX_UNDO = 64;

    var tracks = [];
    var idCounter = 1;
    var colorCounter = 0;
    var undoStack = [];
    var redoStack = [];

    var PEAK_BIN = 256;              //Samples per peak bin
    var peakCache = new WeakMap();   //AudioBuffer -> {min:Float32Array, max:Float32Array}

    function ctx() {
        return ASEngine.getContext();
    }

    /* ---------- Undo / redo ---------- */

    function snapshot() {
        return {
            tracks: tracks.map(function (t) {
                var copy = {};
                Object.keys(t).forEach(function (k) {
                    if (k !== "clips") { copy[k] = t[k]; }
                });
                copy.clips = t.clips.map(function (c) {
                    return { id: c.id, name: c.name, start: c.start, offset: c.offset, duration: c.duration, buffer: c.buffer };
                });
                return copy;
            })
        };
    }

    function restore(snap) {
        tracks = snap.tracks.map(function (t) {
            var copy = {};
            Object.keys(t).forEach(function (k) {
                if (k !== "clips") { copy[k] = t[k]; }
            });
            copy.clips = t.clips.map(function (c) {
                return { id: c.id, name: c.name, start: c.start, offset: c.offset, duration: c.duration, buffer: c.buffer };
            });
            return copy;
        });
    }

    //Call before any structural mutation so it can be undone
    function beginEdit() {
        undoStack.push(snapshot());
        if (undoStack.length > MAX_UNDO) {
            undoStack.shift();
        }
        redoStack = [];
    }

    function undo() {
        if (undoStack.length === 0) {
            return false;
        }
        redoStack.push(snapshot());
        restore(undoStack.pop());
        return true;
    }

    function redo() {
        if (redoStack.length === 0) {
            return false;
        }
        undoStack.push(snapshot());
        restore(redoStack.pop());
        return true;
    }

    function canUndo() { return undoStack.length > 0; }
    function canRedo() { return redoStack.length > 0; }

    /* ---------- Buffer helpers ---------- */

    function secToSamples(sec, sr) {
        return Math.max(0, Math.round(sec * sr));
    }

    //Extract [fromSec, toSec) of a buffer into a new AudioBuffer
    function sliceBuffer(buffer, fromSec, toSec) {
        var sr = buffer.sampleRate;
        var from = Math.min(secToSamples(fromSec, sr), buffer.length);
        var to = Math.min(secToSamples(toSec, sr), buffer.length);
        var len = Math.max(1, to - from);
        var out = ctx().createBuffer(buffer.numberOfChannels, len, sr);
        for (var ch = 0; ch < buffer.numberOfChannels; ch++) {
            out.getChannelData(ch).set(buffer.getChannelData(ch).subarray(from, from + len));
        }
        return out;
    }

    //Join two buffers back to back into a new AudioBuffer
    function concatBuffers(a, b) {
        var sr = a.sampleRate;
        var chs = Math.max(a.numberOfChannels, b.numberOfChannels);
        var out = ctx().createBuffer(chs, a.length + b.length, sr);
        for (var ch = 0; ch < chs; ch++) {
            var dst = out.getChannelData(ch);
            dst.set(a.getChannelData(Math.min(ch, a.numberOfChannels - 1)), 0);
            dst.set(b.getChannelData(Math.min(ch, b.numberOfChannels - 1)), a.length);
        }
        return out;
    }

    //Copy a buffer with [fromSec, toSec) zeroed out
    function silenceRegion(buffer, fromSec, toSec) {
        var sr = buffer.sampleRate;
        var out = ctx().createBuffer(buffer.numberOfChannels, buffer.length, sr);
        var from = Math.min(secToSamples(fromSec, sr), buffer.length);
        var to = Math.min(secToSamples(toSec, sr), buffer.length);
        for (var ch = 0; ch < buffer.numberOfChannels; ch++) {
            var dst = out.getChannelData(ch);
            dst.set(buffer.getChannelData(ch));
            dst.fill(0, from, to);
        }
        return out;
    }

    //Materialize the visible window of a clip into a standalone buffer
    function bakeClip(clip) {
        return sliceBuffer(clip.buffer, clip.offset, clip.offset + clip.duration);
    }

    /* ---------- Peaks (waveform cache) ---------- */

    //Returns {min, max} Float32Arrays with one entry per PEAK_BIN samples,
    //computed over all channels of the buffer. Cached per AudioBuffer.
    function getPeaks(buffer) {
        var cached = peakCache.get(buffer);
        if (cached !== undefined) {
            return cached;
        }
        var bins = Math.ceil(buffer.length / PEAK_BIN);
        var mins = new Float32Array(bins);
        var maxs = new Float32Array(bins);
        for (var b = 0; b < bins; b++) {
            mins[b] = 1;
            maxs[b] = -1;
        }
        for (var ch = 0; ch < buffer.numberOfChannels; ch++) {
            var data = buffer.getChannelData(ch);
            for (var i = 0; i < data.length; i++) {
                var bin = (i / PEAK_BIN) | 0;
                var v = data[i];
                if (v < mins[bin]) { mins[bin] = v; }
                if (v > maxs[bin]) { maxs[bin] = v; }
            }
        }
        var result = { min: mins, max: maxs, bin: PEAK_BIN };
        peakCache.set(buffer, result);
        return result;
    }

    /* ---------- Track operations ---------- */

    function addTrack(name) {
        beginEdit();
        var track = {
            id: idCounter++,
            name: name || ("Track " + (tracks.length + 1)),
            colorIndex: colorCounter++ % TRACK_COLORS.length,
            volume: 1.0,     //Linear, from the volume slider (0 .. 1.5)
            gainDb: 0,       //Extra gain in dB, from the gain knob / effects panel
            pan: 0,          //-1 .. 1
            muted: false,
            solo: false,
            clips: []
        };
        tracks.push(track);
        return track;
    }

    function removeTrack(trackId) {
        var idx = tracks.findIndex(function (t) { return t.id === trackId; });
        if (idx < 0) {
            return;
        }
        beginEdit();
        tracks.splice(idx, 1);
    }

    function moveTrack(trackId, direction) {
        var idx = tracks.findIndex(function (t) { return t.id === trackId; });
        var target = idx + direction;
        if (idx < 0 || target < 0 || target >= tracks.length) {
            return;
        }
        beginEdit();
        var tmp = tracks[idx];
        tracks[idx] = tracks[target];
        tracks[target] = tmp;
    }

    function getTrack(trackId) {
        return tracks.find(function (t) { return t.id === trackId; }) || null;
    }

    function trackColor(track) {
        return TRACK_COLORS[track.colorIndex % TRACK_COLORS.length];
    }

    /* ---------- Clip operations ---------- */

    function clipEnd(clip) {
        return clip.start + clip.duration;
    }

    function addClip(track, buffer, start, name) {
        var clip = {
            id: idCounter++,
            name: name || track.name,
            start: Math.max(0, start),
            offset: 0,
            duration: buffer.duration,
            buffer: buffer
        };
        track.clips.push(clip);
        sortClips(track);
        return clip;
    }

    function sortClips(track) {
        track.clips.sort(function (a, b) { return a.start - b.start; });
    }

    function findClipAt(track, time) {
        return track.clips.find(function (c) {
            return time > c.start + EPS && time < clipEnd(c) - EPS;
        }) || null;
    }

    //Split the clip under `time` into two clips sharing the same buffer
    function splitAt(track, time) {
        var clip = findClipAt(track, time);
        if (clip === null) {
            return false;
        }
        beginEdit();
        var right = {
            id: idCounter++,
            name: clip.name,
            start: time,
            offset: clip.offset + (time - clip.start),
            duration: clipEnd(clip) - time,
            buffer: clip.buffer
        };
        clip.duration = time - clip.start;
        track.clips.push(right);
        sortClips(track);
        return true;
    }

    //Silence [t0, t1] of every clip on the track that intersects the range
    function muteRange(track, t0, t1) {
        var affected = track.clips.filter(function (c) {
            return clipEnd(c) > t0 + EPS && c.start < t1 - EPS;
        });
        if (affected.length === 0) {
            return false;
        }
        beginEdit();
        affected.forEach(function (c) {
            var baked = bakeClip(c);
            var local0 = Math.max(0, t0 - c.start);
            var local1 = Math.min(c.duration, t1 - c.start);
            c.buffer = silenceRegion(baked, local0, local1);
            c.offset = 0;
            c.duration = c.buffer.duration;
        });
        return true;
    }

    //Remove [t0, t1] from the track.
    //closeGap=false : clips are split / trimmed, a silent gap remains.
    //closeGap=true  : everything after t1 shifts left; if the range was in the
    //                 middle of one clip, its head and tail are merged into a
    //                 single new clip (front and back joined together).
    function deleteRange(track, t0, t1, closeGap) {
        var affects = track.clips.some(function (c) {
            return clipEnd(c) > t0 + EPS && c.start < t1 - EPS;
        });
        var hasLater = track.clips.some(function (c) { return c.start >= t1 - EPS; });
        if (!affects && !(closeGap && hasLater)) {
            return false;
        }
        beginEdit();
        removeRangeInternal(track, t0, t1, closeGap);
        return true;
    }

    //Core of deleteRange without the undo bookkeeping; also used to clear
    //space before inserting a clip so clips never overlap on a track
    function removeRangeInternal(track, t0, t1, closeGap) {
        var removed = t1 - t0;
        var next = [];
        track.clips.forEach(function (c) {
            var end = clipEnd(c);
            if (end <= t0 + EPS || c.start >= t1 - EPS) {
                next.push(c); //Untouched (may be shifted below)
                return;
            }
            var hasHead = c.start < t0 - EPS;
            var hasTail = end > t1 + EPS;
            if (hasHead && hasTail && closeGap) {
                //Merge front and back sections into one clip
                var head = sliceBuffer(c.buffer, c.offset, c.offset + (t0 - c.start));
                var tail = sliceBuffer(c.buffer, c.offset + (t1 - c.start), c.offset + c.duration);
                var merged = concatBuffers(head, tail);
                next.push({
                    id: idCounter++,
                    name: c.name,
                    start: c.start,
                    offset: 0,
                    duration: merged.duration,
                    buffer: merged
                });
                return;
            }
            if (hasHead) {
                next.push({
                    id: idCounter++,
                    name: c.name,
                    start: c.start,
                    offset: c.offset,
                    duration: t0 - c.start,
                    buffer: c.buffer
                });
            }
            if (hasTail) {
                next.push({
                    id: idCounter++,
                    name: c.name,
                    start: t1,
                    offset: c.offset + (t1 - c.start),
                    duration: end - t1,
                    buffer: c.buffer
                });
            }
            //Clip fully inside the range: dropped
        });
        if (closeGap) {
            next.forEach(function (c) {
                if (c.start >= t1 - EPS) {
                    c.start = Math.max(0, c.start - removed);
                }
            });
        }
        track.clips = next;
        sortClips(track);
    }

    //Copy [t0, t1] of a track into a standalone buffer (silence where empty).
    //Returns null when no clip intersects the range.
    function copyRange(track, t0, t1) {
        var affected = track.clips.filter(function (c) {
            return clipEnd(c) > t0 + EPS && c.start < t1 - EPS;
        });
        if (affected.length === 0) {
            return null;
        }
        var sr = ctx().sampleRate;
        var chs = 1;
        affected.forEach(function (c) {
            chs = Math.max(chs, c.buffer.numberOfChannels);
        });
        var len = Math.max(1, secToSamples(t1 - t0, sr));
        var out = ctx().createBuffer(chs, len, sr);
        affected.forEach(function (c) {
            var overlap0 = Math.max(t0, c.start);
            var overlap1 = Math.min(t1, clipEnd(c));
            var srcSr = c.buffer.sampleRate;
            var srcFrom = secToSamples(c.offset + (overlap0 - c.start), srcSr);
            var copyLen = secToSamples(overlap1 - overlap0, srcSr);
            var dstFrom = secToSamples(overlap0 - t0, sr);
            for (var ch = 0; ch < chs; ch++) {
                var src = c.buffer.getChannelData(Math.min(ch, c.buffer.numberOfChannels - 1));
                var dst = out.getChannelData(ch);
                //Mix (add) so overlapping clips are both captured.
                //Note: assumes clip buffers share the context sample rate,
                //which holds because all buffers are decoded by this context.
                var n = Math.min(copyLen, src.length - srcFrom, dst.length - dstFrom);
                for (var i = 0; i < n; i++) {
                    dst[dstFrom + i] += src[srcFrom + i];
                }
            }
        });
        return out;
    }

    function pasteBuffer(track, at, buffer, name) {
        beginEdit();
        //Clips must never overlap: pasting over existing audio replaces it
        removeRangeInternal(track, at, at + buffer.duration, false);
        return addClip(track, buffer, at, name || "Pasted");
    }

    //Add a clip as a separate undoable action (recordings / imports).
    //Existing audio under the new clip is overwritten (punch-in style) so
    //clips on the same track never overlap.
    function insertClip(track, buffer, start, name) {
        beginEdit();
        removeRangeInternal(track, start, start + buffer.duration, false);
        return addClip(track, buffer, start, name);
    }

    //Allowed start range for moving a clip without crossing its neighbours.
    //Returns {min, max} for clip.start.
    function moveBounds(track, clip) {
        var min = 0;
        var max = Infinity;
        var end = clipEnd(clip);
        track.clips.forEach(function (c) {
            if (c.id === clip.id) {
                return;
            }
            var cEnd = clipEnd(c);
            if (cEnd <= clip.start + EPS && cEnd > min) {
                min = cEnd;
            }
            if (c.start >= end - EPS && c.start - clip.duration < max) {
                max = c.start - clip.duration;
            }
        });
        return { min: min, max: Math.max(min, max) };
    }

    //Apply processFn(buffer) -> buffer to [t0, t1] of every intersecting clip.
    //Length-changing effects (e.g. speed) ripple the audio after the range so
    //clips never end up overlapping. Returns the number of clips affected.
    function applyEffectToRange(track, t0, t1, processFn) {
        var affected = track.clips.filter(function (c) {
            return clipEnd(c) > t0 + EPS && c.start < t1 - EPS;
        });
        if (affected.length === 0) {
            return 0;
        }
        beginEdit();
        sortClips(track);
        var shift = 0;
        track.clips.forEach(function (c) {
            c.start += shift;
            var intersects = clipEnd(c) > t0 + shift + EPS && c.start < t1 + shift - EPS;
            if (!intersects) {
                return;
            }
            var rangeT0 = t0 + shift;
            var rangeT1 = t1 + shift;
            var baked = bakeClip(c);
            var sr = baked.sampleRate;
            var s0 = Math.max(0, Math.min(baked.length, secToSamples(rangeT0 - c.start, sr)));
            var s1 = Math.max(s0, Math.min(baked.length, secToSamples(rangeT1 - c.start, sr)));
            if (s1 - s0 < 1) {
                return;
            }
            var mid = ctx().createBuffer(baked.numberOfChannels, s1 - s0, sr);
            var ch;
            for (ch = 0; ch < baked.numberOfChannels; ch++) {
                mid.getChannelData(ch).set(baked.getChannelData(ch).subarray(s0, s1));
            }
            var processed = processFn(mid);
            var totalLen = s0 + processed.length + (baked.length - s1);
            var chs = Math.max(baked.numberOfChannels, processed.numberOfChannels);
            var out = ctx().createBuffer(chs, Math.max(1, totalLen), sr);
            for (ch = 0; ch < chs; ch++) {
                var dst = out.getChannelData(ch);
                var srcBase = baked.getChannelData(Math.min(ch, baked.numberOfChannels - 1));
                var srcMid = processed.getChannelData(Math.min(ch, processed.numberOfChannels - 1));
                dst.set(srcBase.subarray(0, s0), 0);
                dst.set(srcMid, s0);
                dst.set(srcBase.subarray(s1), s0 + processed.length);
            }
            var oldDur = c.duration;
            c.buffer = out;
            c.offset = 0;
            c.duration = out.duration;
            shift += c.duration - oldDur;
        });
        sortClips(track);
        return affected.length;
    }

    function removeClip(track, clipId) {
        var idx = track.clips.findIndex(function (c) { return c.id === clipId; });
        if (idx < 0) {
            return;
        }
        beginEdit();
        track.clips.splice(idx, 1);
    }

    /* ---------- Project file (serialize / restore) ---------- */

    var PROJECT_FORMAT = "arozos-audiostudio-project";
    var PROJECT_VERSION = 1;

    //Collect every unique AudioBuffer referenced by the project (split clips
    //share one buffer) and build a portable metadata object. The caller is
    //responsible for storing each buffer of the returned .buffers array and
    //filling in meta.buffers[i].file (or .data) before saving the metadata.
    function serializeProject(name) {
        var buffers = [];
        var indexByBuffer = new Map();
        tracks.forEach(function (t) {
            t.clips.forEach(function (c) {
                if (!indexByBuffer.has(c.buffer)) {
                    indexByBuffer.set(c.buffer, buffers.length);
                    buffers.push(c.buffer);
                }
            });
        });
        var meta = {
            format: PROJECT_FORMAT,
            version: PROJECT_VERSION,
            name: name,
            sampleRate: ctx().sampleRate,
            savedAt: new Date().toISOString(),
            buffers: buffers.map(function (b, i) {
                return { index: i, duration: b.duration, channels: b.numberOfChannels };
            }),
            tracks: tracks.map(function (t) {
                return {
                    name: t.name,
                    colorIndex: t.colorIndex,
                    volume: t.volume,
                    gainDb: t.gainDb,
                    pan: t.pan,
                    muted: t.muted,
                    solo: t.solo,
                    clips: t.clips.map(function (c) {
                        return {
                            name: c.name,
                            start: c.start,
                            offset: c.offset,
                            duration: c.duration,
                            buffer: indexByBuffer.get(c.buffer)
                        };
                    })
                };
            })
        };
        return { meta: meta, buffers: buffers };
    }

    function isProjectMeta(meta) {
        return meta !== null && typeof meta === "object" &&
            meta.format === PROJECT_FORMAT && Array.isArray(meta.tracks);
    }

    //Replace the current project with the given metadata + decoded buffers
    //(audioBuffers[i] corresponds to meta.buffers[i]). Undoable.
    function restoreProject(meta, audioBuffers) {
        beginEdit();
        tracks = meta.tracks.map(function (t) {
            var track = {
                id: idCounter++,
                name: t.name || "Track",
                colorIndex: typeof t.colorIndex === "number" ? t.colorIndex : (colorCounter++ % TRACK_COLORS.length),
                volume: typeof t.volume === "number" ? t.volume : 1,
                gainDb: typeof t.gainDb === "number" ? t.gainDb : 0,
                pan: typeof t.pan === "number" ? t.pan : 0,
                muted: t.muted === true,
                solo: t.solo === true,
                clips: []
            };
            (t.clips || []).forEach(function (c) {
                var buf = audioBuffers[c.buffer];
                if (buf === undefined || buf === null) {
                    return; //Missing data file: skip the clip, keep the rest
                }
                track.clips.push({
                    id: idCounter++,
                    name: c.name || track.name,
                    start: Math.max(0, c.start || 0),
                    offset: Math.max(0, c.offset || 0),
                    duration: Math.min(c.duration || buf.duration, buf.duration),
                    buffer: buf
                });
            });
            sortClips(track);
            return track;
        });
        colorCounter = Math.max(colorCounter, tracks.length);
    }

    /* ---------- Project level ---------- */

    function duration() {
        var d = 0;
        tracks.forEach(function (t) {
            t.clips.forEach(function (c) {
                d = Math.max(d, clipEnd(c));
            });
        });
        return d;
    }

    function isEmpty() {
        return tracks.every(function (t) { return t.clips.length === 0; });
    }

    return {
        MIN_CLIP_LEN: MIN_CLIP_LEN,
        getTracks: function () { return tracks; },
        getTrack: getTrack,
        trackColor: trackColor,
        addTrack: addTrack,
        removeTrack: removeTrack,
        moveTrack: moveTrack,
        addClip: addClip,
        insertClip: insertClip,
        removeClip: removeClip,
        sortClips: sortClips,
        clipEnd: clipEnd,
        findClipAt: findClipAt,
        splitAt: splitAt,
        muteRange: muteRange,
        deleteRange: deleteRange,
        copyRange: copyRange,
        pasteBuffer: pasteBuffer,
        moveBounds: moveBounds,
        applyEffectToRange: applyEffectToRange,
        bakeClip: bakeClip,
        getPeaks: getPeaks,
        duration: duration,
        isEmpty: isEmpty,
        serializeProject: serializeProject,
        restoreProject: restoreProject,
        isProjectMeta: isProjectMeta,
        beginEdit: beginEdit,
        undo: undo,
        redo: redo,
        canUndo: canUndo,
        canRedo: canRedo
    };
})();
