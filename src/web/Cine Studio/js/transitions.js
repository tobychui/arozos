/*
    Cine Studio - clip transitions

    A video transition is stored on the INCOMING clip
    (clip.props.transition = {type, duration}) and plays over the first
    `duration` seconds of the clip. When another clip on the same track
    ends exactly where this clip starts, its last frame is frozen and
    blended; otherwise the transition runs from nothing.

    Audio transitions (clip.props.audioTransition = {type, duration}) fade
    the incoming clip in and the outgoing clip out with a constant power
    or constant gain curve, the way Premiere's audio crossfades do.

    Every video transition maps onto an ffmpeg xfade transition (see
    render/graph.go) so the server render matches the preview.
*/
"use strict";

window.CS = window.CS || {};

CS.transitions = {

    registry: [
        { type: "none",       name: "None" },
        { type: "dissolve",   name: "Cross Dissolve", group: "Dissolve" },
        { type: "fade",       name: "Dip to Black", group: "Dissolve" },
        { type: "dipwhite",   name: "Dip to White", group: "Dissolve" },
        { type: "blur",       name: "Blur Dissolve", group: "Dissolve" },
        { type: "pixelate",   name: "Pixelate Dissolve", group: "Dissolve" },
        { type: "wipe",       name: "Wipe Right", group: "Wipe" },
        { type: "wipeleft",   name: "Wipe Left", group: "Wipe" },
        { type: "wipeup",     name: "Wipe Up", group: "Wipe" },
        { type: "wipedown",   name: "Wipe Down", group: "Wipe" },
        { type: "barndoors",  name: "Barn Doors", group: "Wipe" },
        { type: "diagonal",   name: "Diagonal Wipe", group: "Wipe" },
        { type: "radial",     name: "Clock Wipe", group: "Wipe" },
        { type: "pushleft",   name: "Push Left", group: "Slide" },
        { type: "pushright",  name: "Push Right", group: "Slide" },
        { type: "pushup",     name: "Push Up", group: "Slide" },
        { type: "pushdown",   name: "Push Down", group: "Slide" },
        { type: "iris",       name: "Iris Open", group: "Iris" },
        { type: "irisclose",  name: "Iris Close", group: "Iris" },
        { type: "zoom",       name: "Cross Zoom", group: "Zoom" }
    ],

    audioRegistry: [
        { type: "none",  name: "None" },
        { type: "power", name: "Constant Power" },
        { type: "gain",  name: "Constant Gain" }
    ],

    get: function (type) {
        for (var i = 0; i < CS.transitions.registry.length; i++) {
            if (CS.transitions.registry[i].type === type) { return CS.transitions.registry[i]; }
        }
        return null;
    },

    /* ---------- apply ---------- */

    applyToSelected: function (type) {
        var clip = CS.selectedClip();
        if (!clip) { CS.toast("Select a clip on the timeline first"); return; }
        var track = CS.getTrack(clip.trackId);
        if (!track || track.kind !== "video") {
            //On an audio clip the same gesture means an audio crossfade
            if (track && track.kind === "audio" && type !== "none") {
                CS.transitions.applyAudioToSelected("power");
                return;
            }
            CS.toast("Transitions apply to clips on video tracks", true);
            return;
        }
        if (type === "none") {
            clip.props.transition = null;
        } else {
            var prevDur = (clip.props.transition && clip.props.transition.duration) || 1;
            clip.props.transition = { type: type, duration: prevDur };
        }
        CS.commit(type === "none" ? "Remove Transition" : "Add Transition");
        CS.panels.refresh();
        if (type !== "none") { CS.toast(CS.transitions.get(type).name + " applied to clip start"); }
    },

    applyAudioToSelected: function (type) {
        var clip = CS.selectedClip();
        if (!clip) { CS.toast("Select a clip on the timeline first"); return; }
        if (!CS.effects.clipHasAudio(clip)) { CS.toast("The clip has no audio", true); return; }
        if (type === "none") {
            clip.props.audioTransition = null;
        } else {
            var prevDur = (clip.props.audioTransition && clip.props.audioTransition.duration) || 1;
            clip.props.audioTransition = { type: type, duration: prevDur };
        }
        CS.commit(type === "none" ? "Remove Audio Transition" : "Add Audio Transition");
        CS.panels.refresh();
    },

    /* ---------- render-time helpers ---------- */

    //The clip on the same track that ends where this clip begins
    prevOf: function (clip) {
        var clips = CS.clipsOnTrack(clip.trackId);
        for (var i = 0; i < clips.length; i++) {
            if (clips[i].id !== clip.id && Math.abs(CS.clipEnd(clips[i]) - clip.start) < 0.05) {
                return clips[i];
            }
        }
        return null;
    },

    //The clip on the same track that starts where this clip ends
    nextOf: function (clip) {
        var clips = CS.clipsOnTrack(clip.trackId);
        var end = CS.clipEnd(clip);
        for (var i = 0; i < clips.length; i++) {
            if (clips[i].id !== clip.id && Math.abs(clips[i].start - end) < 0.05) {
                return clips[i];
            }
        }
        return null;
    },

    //Whether clip is inside its transition window at time t
    windowAt: function (clip, t) {
        var tr = clip.props && clip.props.transition;
        if (!tr || tr.type === "none") { return null; }
        var dur = Math.min(tr.duration, CS.clipDuration(clip));
        if (t >= clip.start && t < clip.start + dur) {
            return { tr: tr, k: CS.clamp((t - clip.start) / Math.max(0.05, dur), 0, 1) };
        }
        return null;
    },

    //Predecessor clips that must stay parked on their last frame at time t,
    //so scrubbing into a transition shows the frozen outgoing frame
    frozenTargets: function (t) {
        var out = {};
        CS.project.clips.forEach(function (clip) {
            if (!CS.transitions.windowAt(clip, t)) { return; }
            var prev = CS.transitions.prevOf(clip);
            if (prev) { out[prev.id] = Math.max(prev.in, prev.out - 0.05); }
        });
        return out;
    },

    //Gain of the audio transitions touching the clip at time t: its own fade
    //in and the fade out demanded by the next clip's crossfade
    audioGain: function (clip, t) {
        var g = 1;
        var at = clip.props && clip.props.audioTransition;
        if (at && at.type !== "none") {
            var d = Math.min(at.duration, CS.clipDuration(clip));
            if (t < clip.start + d) {
                var k = CS.clamp((t - clip.start) / Math.max(0.05, d), 0, 1);
                g *= at.type === "power" ? Math.sin(k * Math.PI / 2) : k;
            }
        }
        var next = CS.transitions.nextOf(clip);
        var nat = next && next.props && next.props.audioTransition;
        if (nat && nat.type !== "none") {
            var d2 = Math.min(nat.duration, CS.clipDuration(clip));
            var end = CS.clipEnd(clip);
            if (t > end - d2) {
                var k2 = CS.clamp((end - t) / Math.max(0.05, d2), 0, 1);
                g *= nat.type === "power" ? Math.sin(k2 * Math.PI / 2) : k2;
            }
        }
        return g;
    },

    //Draw the incoming clip (and frozen predecessor) blended by type
    draw: function (ctx, clip, t, W, H, win) {
        var prev = CS.transitions.prevOf(clip);
        var k = win.k;
        var prevT = prev ? Math.max(prev.start, CS.clipEnd(prev) - 0.05) : 0;
        var type = win.tr.type;
        var drawPrev = function (opts) { if (prev) { CS.player.drawClip(ctx, prev, W, H, prevT, opts || {}); } };
        var drawIn = function (opts) { CS.player.drawClip(ctx, clip, W, H, t, opts || {}); };
        var clipped = function (pathFn, drawFn) {
            ctx.save();
            ctx.beginPath();
            pathFn();
            ctx.clip();
            drawFn();
            ctx.restore();
        };
        var shifted = function (dx, dy, drawFn) {
            ctx.save();
            ctx.translate(dx, dy);
            drawFn();
            ctx.restore();
        };

        switch (type) {
        case "dissolve":
            drawPrev();
            drawIn({ alphaMul: k });
            break;
        case "fade":
        case "dipwhite":
            //first half: outgoing fades away; second half: incoming fades in
            if (k < 0.5) { drawPrev({ alphaMul: 1 - k * 2 }); } else { drawIn({ alphaMul: k * 2 - 1 }); }
            if (type === "dipwhite") {
                ctx.save();
                ctx.globalAlpha = 1 - Math.abs(k - 0.5) * 2;
                ctx.fillStyle = "#fff";
                ctx.fillRect(0, 0, W, H);
                ctx.restore();
            }
            break;
        case "blur": {
            var blur = Math.sin(k * Math.PI) * 24 * (W / 1920);
            ctx.save();
            ctx.filter = "blur(" + blur.toFixed(1) + "px)";
            drawPrev();
            drawIn({ alphaMul: k });
            ctx.restore();
            break;
        }
        case "pixelate": {
            drawPrev();
            drawIn({ alphaMul: k });
            var block = Math.round(2 + Math.sin(k * Math.PI) * 38);
            if (block > 2) {
                var small = CS.effects.pixelateSource(ctx.canvas, ctx.canvas.width, ctx.canvas.height, block, null);
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(small, 0, 0, ctx.canvas.width, ctx.canvas.height);
                ctx.restore();
            }
            break;
        }
        case "wipe":
            drawPrev();
            clipped(function () { ctx.rect(0, 0, W * k, H); }, drawIn);
            break;
        case "wipeleft":
            drawPrev();
            clipped(function () { ctx.rect(W * (1 - k), 0, W * k, H); }, drawIn);
            break;
        case "wipeup":
            drawPrev();
            clipped(function () { ctx.rect(0, H * (1 - k), W, H * k); }, drawIn);
            break;
        case "wipedown":
            drawPrev();
            clipped(function () { ctx.rect(0, 0, W, H * k); }, drawIn);
            break;
        case "barndoors":
            drawPrev();
            clipped(function () { ctx.rect(W / 2 * (1 - k), 0, W * k, H); }, drawIn);
            break;
        case "diagonal":
            drawPrev();
            clipped(function () {
                ctx.moveTo(0, 0);
                ctx.lineTo(2 * W * k, 0);
                ctx.lineTo(0, 2 * H * k);
                ctx.closePath();
            }, drawIn);
            break;
        case "radial":
            drawPrev();
            clipped(function () {
                ctx.moveTo(W / 2, H / 2);
                ctx.arc(W / 2, H / 2, Math.hypot(W, H), -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
                ctx.closePath();
            }, drawIn);
            break;
        case "pushleft":
            shifted(-W * k, 0, drawPrev);
            shifted(W * (1 - k), 0, drawIn);
            break;
        case "pushright":
            shifted(W * k, 0, drawPrev);
            shifted(-W * (1 - k), 0, drawIn);
            break;
        case "pushup":
            shifted(0, -H * k, drawPrev);
            shifted(0, H * (1 - k), drawIn);
            break;
        case "pushdown":
            shifted(0, H * k, drawPrev);
            shifted(0, -H * (1 - k), drawIn);
            break;
        case "iris":
            drawPrev();
            clipped(function () { ctx.arc(W / 2, H / 2, Math.hypot(W, H) / 2 * k, 0, Math.PI * 2); }, drawIn);
            break;
        case "irisclose":
            drawIn();
            clipped(function () { ctx.arc(W / 2, H / 2, Math.hypot(W, H) / 2 * (1 - k), 0, Math.PI * 2); }, drawPrev);
            break;
        case "zoom": {
            var z = 1 + Math.sin(k * Math.PI) * 0.35;
            ctx.save();
            ctx.translate(W / 2, H / 2);
            ctx.scale(z, z);
            ctx.translate(-W / 2, -H / 2);
            drawPrev();
            drawIn({ alphaMul: k });
            ctx.restore();
            break;
        }
        default:
            drawIn();
        }
    },

    /* ---------- inspector tab ---------- */

    renderTab: function (body, clip) {
        if (!clip) {
            CS.inspector.placeholder(body, "Select a clip on the timeline to add a transition into it.");
            return;
        }
        var track = CS.getTrack(clip.trackId);
        if (track && track.kind === "video") {
            var tr = clip.props.transition;
            var sec = CS.inspector.section(body, "Video Transition", function () {
                clip.props.transition = null;
                CS.commit("Remove Transition");
            });

            CS.inspector.row(sec, "Type", [
                CS.inspector.select(
                    CS.transitions.registry.map(function (r) { return { v: r.type, l: r.name }; }),
                    tr ? tr.type : "none",
                    function (v) { CS.transitions.applyToSelected(v); }
                )
            ]);

            if (tr && tr.type !== "none") {
                CS.inspector.row(sec, "Duration", [
                    CS.inspector.slider(0.2, 3, 0.1, tr.duration, function (v) { tr.duration = v; }),
                    CS.inspector.numChip(null, tr.duration, "s", function (v) {
                        tr.duration = CS.clamp(v, 0.1, 10);
                    }, 0.1, 1)
                ]);
            }

            var note = document.createElement("div");
            note.className = "modal-note";
            note.textContent = CS.transitions.prevOf(clip)
                ? "Blends from the previous clip on this track into this clip."
                : "No clip ends where this one starts, so the transition will run from nothing.";
            sec.appendChild(note);
        }

        if (CS.effects.clipHasAudio(clip)) {
            var at = clip.props.audioTransition;
            var asec = CS.inspector.section(body, "Audio Transition", function () {
                clip.props.audioTransition = null;
                CS.commit("Remove Audio Transition");
            });
            CS.inspector.row(asec, "Type", [
                CS.inspector.select(
                    CS.transitions.audioRegistry.map(function (r) { return { v: r.type, l: r.name }; }),
                    at ? at.type : "none",
                    function (v) { CS.transitions.applyAudioToSelected(v); }
                )
            ]);
            if (at && at.type !== "none") {
                CS.inspector.row(asec, "Duration", [
                    CS.inspector.slider(0.1, 3, 0.1, at.duration, function (v) { at.duration = v; }),
                    CS.inspector.numChip(null, at.duration, "s", function (v) {
                        at.duration = CS.clamp(v, 0.1, 10);
                    }, 0.1, 1)
                ]);
            }
            var anote = document.createElement("div");
            anote.className = "modal-note";
            anote.textContent = "Fades this clip in and the previous clip on the track out over the duration.";
            asec.appendChild(anote);
        } else if (!track || track.kind !== "video") {
            CS.inspector.placeholder(body, "Transitions apply to clips on video tracks. Use Fade In / Fade Out effects for audio.");
        }
    },

    /* ---------- gallery panel ---------- */

    _panelBuilt: false,
    renderPanel: function () {
        if (CS.transitions._panelBuilt) { CS.transitions.refreshApplied(); return; }
        CS.transitions._panelBuilt = true;
        var grid = document.getElementById("transitions-grid");
        grid.innerHTML = "";
        CS.transitions.registry.forEach(function (def) {
            if (def.type === "none") { return; }
            var card = document.createElement("div");
            card.className = "fx-card";
            card.dataset.trType = def.type;
            var thumb = document.createElement("div");
            thumb.className = "fx-thumb";
            thumb.appendChild(CS.transitions.previewCanvas(def.type));
            var name = document.createElement("div");
            name.className = "fx-name";
            name.textContent = def.name;
            card.appendChild(thumb);
            card.appendChild(name);
            card.addEventListener("click", function () {
                CS.transitions.applyToSelected(def.type);
            });
            grid.appendChild(card);
        });
        CS.transitions.audioRegistry.forEach(function (def) {
            if (def.type === "none") { return; }
            var card = document.createElement("div");
            card.className = "fx-card";
            card.dataset.atType = def.type;
            var thumb = document.createElement("div");
            thumb.className = "fx-thumb";
            thumb.appendChild(CS.transitions.audioPreviewCanvas(def.type));
            var name = document.createElement("div");
            name.className = "fx-name";
            name.textContent = def.name + " (audio)";
            card.appendChild(thumb);
            card.appendChild(name);
            card.addEventListener("click", function () {
                CS.transitions.applyAudioToSelected(def.type);
            });
            grid.appendChild(card);
        });
        CS.transitions.refreshApplied();
    },

    refreshApplied: function () {
        var clip = CS.selectedClip();
        var current = clip && clip.props.transition ? clip.props.transition.type : "";
        var currentAudio = clip && clip.props.audioTransition ? clip.props.audioTransition.type : "";
        var cards = document.querySelectorAll("#transitions-grid .fx-card");
        for (var i = 0; i < cards.length; i++) {
            var c = cards[i];
            c.classList.toggle("applied", (c.dataset.trType && c.dataset.trType === current) ||
                (c.dataset.atType && c.dataset.atType === currentAudio));
        }
    },

    //Small still of the transition half way through, drawn with the real
    //draw() code on two synthetic frames
    previewCanvas: function (type) {
        var c = document.createElement("canvas");
        c.width = 150;
        c.height = 94;
        var ctx = c.getContext("2d");
        var warm = ctx.createLinearGradient(0, 0, 0, 94);
        warm.addColorStop(0, "#c97b3a");
        warm.addColorStop(1, "#5c3a1e");
        var cool = ctx.createLinearGradient(0, 0, 0, 94);
        cool.addColorStop(0, "#2b6f9e");
        cool.addColorStop(1, "#123246");
        var fakeClip = { props: { transition: { type: type, duration: 1 } } };
        //Stand-ins for drawClip: paint the whole frame in one colour
        var realDraw = CS.player.drawClip;
        var realPrev = CS.transitions.prevOf;
        CS.transitions.prevOf = function () { return { id: "p", start: 0, in: 0, out: 1, props: {} }; };
        CS.player.drawClip = function (cx, clip, W, H, t, opts) {
            cx.save();
            cx.globalAlpha = (opts && opts.alphaMul !== undefined) ? opts.alphaMul : 1;
            cx.fillStyle = clip.id === "p" ? warm : cool;
            cx.fillRect(0, 0, W, H);
            cx.restore();
        };
        try {
            CS.transitions.draw(ctx, fakeClip, 0.55, 150, 94, { tr: fakeClip.props.transition, k: 0.55 });
        } catch (e) { /* preview only */ }
        CS.player.drawClip = realDraw;
        CS.transitions.prevOf = realPrev;
        return c;
    },

    audioPreviewCanvas: function (type) {
        var c = document.createElement("canvas");
        c.width = 150;
        c.height = 94;
        var ctx = c.getContext("2d");
        ctx.fillStyle = "#14201a";
        ctx.fillRect(0, 0, 150, 94);
        ctx.lineWidth = 2;
        ["#c97b3a", "#35c98b"].forEach(function (col, idx) {
            ctx.strokeStyle = col;
            ctx.beginPath();
            for (var x = 0; x <= 150; x += 3) {
                var k = x / 150;
                var g = idx === 0 ? (type === "power" ? Math.cos(k * Math.PI / 2) : 1 - k)
                    : (type === "power" ? Math.sin(k * Math.PI / 2) : k);
                var y = 84 - g * 70;
                if (x === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
            }
            ctx.stroke();
        });
        return c;
    }
};
