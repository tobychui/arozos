/*
    Cine Studio - clip transitions

    A transition is stored on the INCOMING clip (clip.props.transition =
    {type, duration}) and plays over the first `duration` seconds of the
    clip. When another clip on the same track ends exactly where this
    clip starts, its last frame is frozen and blended; otherwise the
    transition runs from black.
*/
"use strict";

window.CS = window.CS || {};

CS.transitions = {

    registry: [
        { type: "none",     name: "None" },
        { type: "dissolve", name: "Cross Dissolve" },
        { type: "fade",     name: "Fade" },
        { type: "wipe",     name: "Wipe Right" }
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

    //Draw the incoming clip (and frozen predecessor) blended by type
    draw: function (ctx, clip, t, W, H, win) {
        var prev = CS.transitions.prevOf(clip);
        var k = win.k;
        var prevT = prev ? Math.max(prev.start, CS.clipEnd(prev) - 0.05) : 0;

        if (win.tr.type === "dissolve") {
            if (prev) { CS.player.drawClip(ctx, prev, W, H, prevT, {}); }
            CS.player.drawClip(ctx, clip, W, H, t, { alphaMul: k });
        } else if (win.tr.type === "fade") {
            //first half: outgoing fades to black; second half: incoming fades in
            if (k < 0.5) {
                if (prev) { CS.player.drawClip(ctx, prev, W, H, prevT, { alphaMul: 1 - k * 2 }); }
            } else {
                CS.player.drawClip(ctx, clip, W, H, t, { alphaMul: k * 2 - 1 });
            }
        } else if (win.tr.type === "wipe") {
            if (prev) { CS.player.drawClip(ctx, prev, W, H, prevT, {}); }
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, W * k, H);
            ctx.clip();
            CS.player.drawClip(ctx, clip, W, H, t, {});
            ctx.restore();
        } else {
            CS.player.drawClip(ctx, clip, W, H, t, {});
        }
    },

    /* ---------- inspector tab ---------- */

    renderTab: function (body, clip) {
        if (!clip) {
            CS.inspector.placeholder(body, "Select a clip on the timeline to add a transition into it.");
            return;
        }
        var track = CS.getTrack(clip.trackId);
        if (!track || track.kind !== "video") {
            CS.inspector.placeholder(body, "Transitions apply to clips on video tracks. Use Fade In / Fade Out effects for audio.");
            return;
        }

        var tr = clip.props.transition;
        var sec = CS.inspector.section(body, "Transition", function () {
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
            : "No clip ends where this one starts, so the transition will run from black.";
        sec.appendChild(note);
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
        CS.transitions.refreshApplied();
    },

    refreshApplied: function () {
        var clip = CS.selectedClip();
        var current = clip && clip.props.transition ? clip.props.transition.type : "";
        var cards = document.querySelectorAll("#transitions-grid .fx-card");
        for (var i = 0; i < cards.length; i++) {
            cards[i].classList.toggle("applied", cards[i].dataset.trType === current);
        }
    },

    previewCanvas: function (type) {
        var c = document.createElement("canvas");
        c.width = 150;
        c.height = 94;
        var ctx = c.getContext("2d");
        //outgoing side: warm scene, incoming side: cool scene
        var warm = ctx.createLinearGradient(0, 0, 0, 94);
        warm.addColorStop(0, "#c97b3a");
        warm.addColorStop(1, "#5c3a1e");
        var cool = ctx.createLinearGradient(0, 0, 0, 94);
        cool.addColorStop(0, "#2b6f9e");
        cool.addColorStop(1, "#123246");

        if (type === "wipe") {
            ctx.fillStyle = warm;
            ctx.fillRect(0, 0, 150, 94);
            ctx.fillStyle = cool;
            ctx.fillRect(0, 0, 82, 94);
            ctx.fillStyle = "rgba(255,255,255,0.8)";
            ctx.fillRect(80, 0, 3, 94);
        } else if (type === "fade") {
            ctx.fillStyle = warm;
            ctx.fillRect(0, 0, 70, 94);
            ctx.fillStyle = "#000";
            ctx.fillRect(60, 0, 30, 94);
            ctx.fillStyle = cool;
            ctx.globalAlpha = 0.9;
            ctx.fillRect(85, 0, 65, 94);
            ctx.globalAlpha = 1;
            var g = ctx.createLinearGradient(45, 0, 105, 0);
            g.addColorStop(0, "rgba(0,0,0,0)");
            g.addColorStop(0.5, "rgba(0,0,0,0.95)");
            g.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = g;
            ctx.fillRect(40, 0, 70, 94);
        } else {
            //dissolve: blend the two scenes across the middle
            ctx.fillStyle = warm;
            ctx.fillRect(0, 0, 150, 94);
            for (var x = 0; x < 150; x += 3) {
                ctx.globalAlpha = CS.clamp((x - 30) / 90, 0, 1);
                ctx.fillStyle = cool;
                ctx.fillRect(x, 0, 3, 94);
            }
            ctx.globalAlpha = 1;
        }
        return c;
    }
};
