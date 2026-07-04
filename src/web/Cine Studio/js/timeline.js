/*
    Cine Studio - timeline

    Renders the ruler, track headers, track lanes and clips; handles
    scrubbing, drag-move, trim handles, blade splitting, drops from the
    media bin, snapping and zoom.
*/
"use strict";

window.CS = window.CS || {};

CS.timeline = {
    TRACK_H_VIDEO: 62,
    TRACK_H_AUDIO: 52,
    MIN_CLIP_DUR: 0.1,
    TAIL_SECONDS: 30,   //empty space kept after the last clip

    _drag: null,

    init: function () {
        var scroll = document.getElementById("tl-scroll");
        scroll.addEventListener("scroll", function () {
            CS.timeline.drawRuler();
            CS.timeline.syncHeaderScroll();
        });
        window.addEventListener("resize", function () {
            CS.timeline.drawRuler();
        });

        //Scrub by pressing / dragging on the ruler
        var ruler = document.getElementById("tl-ruler");
        ruler.addEventListener("pointerdown", function (ev) {
            ruler.setPointerCapture(ev.pointerId);
            CS.player.pause();
            CS.timeline.scrubTo(ev);
            ruler.onpointermove = function (mv) { CS.timeline.scrubTo(mv); };
            ruler.onpointerup = function () { ruler.onpointermove = null; ruler.onpointerup = null; };
        });

        //Zoom controls
        var zoom = document.getElementById("tl-zoom");
        zoom.addEventListener("input", function () {
            CS.timeline.setZoom(parseFloat(zoom.value));
        });
        document.getElementById("btn-zoom-in").addEventListener("click", function () {
            CS.timeline.setZoom(CS.state.zoom * 1.35);
        });
        document.getElementById("btn-zoom-out").addEventListener("click", function () {
            CS.timeline.setZoom(CS.state.zoom / 1.35);
        });
        CS.paintSlider(zoom);

        //Toolbar
        document.getElementById("tool-select").addEventListener("click", function () { CS.timeline.setTool("select"); });
        document.getElementById("tool-blade").addEventListener("click", function () { CS.timeline.setTool("blade"); });
        document.getElementById("tool-crop").addEventListener("click", function () {
            //Jump to the Crop controls in the inspector
            document.getElementById("inspector").classList.remove("hidden");
            CS.inspector.activeTab = "video";
            CS.inspector._collapsed["Crop"] = false;
            CS.inspector.updateTabs();
            CS.inspector.render();
            if (!CS.selectedClip()) { CS.toast("Select a clip to crop"); }
        });
        document.getElementById("tool-text").addEventListener("click", function () {
            CS.titles.insertPreset("title");
        });
        document.getElementById("tool-audio").addEventListener("click", function () {
            document.getElementById("inspector").classList.remove("hidden");
            CS.inspector.activeTab = "audio";
            CS.inspector.updateTabs();
            CS.inspector.render();
            if (!CS.selectedClip()) { CS.toast("Select a clip to adjust its audio"); }
        });
        document.getElementById("btn-undo").addEventListener("click", CS.undo);
        document.getElementById("btn-redo").addEventListener("click", CS.redo);
        document.getElementById("btn-delete-clip").addEventListener("click", CS.deleteSelectedClip);
        document.getElementById("btn-split-clip").addEventListener("click", CS.splitAtPlayhead);
        document.getElementById("btn-add-track").addEventListener("click", function (ev) {
            CS.showMenuUnder(ev.currentTarget, [
                { label: "Add video track", icon: "film", action: function () { CS.addTrack("video"); } },
                { label: "Add audio track", icon: "speaker", action: function () { CS.addTrack("audio"); } }
            ]);
        });

        //Dropping media on the empty area beyond the lanes creates a track
        var content = document.getElementById("tl-content");
        content.addEventListener("dragover", function (ev) {
            ev.preventDefault();
        });
        content.addEventListener("drop", function (ev) {
            if (ev.target.closest && ev.target.closest(".tl-track")) { return; } //lane handled it
            ev.preventDefault();
            var mediaId = ev.dataTransfer && ev.dataTransfer.getData("cinestudio/media");
            if (!mediaId) { return; }
            var media = CS.getMedia(mediaId);
            if (!media) { return; }
            if (media.offline) { CS.toast("Cannot use offline media", true); return; }
            var kind = media.type === "audio" ? "audio" : "video";
            var trackId = CS.createTrack(kind);
            var s = document.getElementById("tl-scroll");
            var rect = s.getBoundingClientRect();
            var t = Math.max(0, (ev.clientX - rect.left + s.scrollLeft) / CS.state.zoom);
            var clip = CS.addClipToTimeline(media, trackId, t);
            if (clip) {
                CS.state.selectedClipId = clip.id;
                CS.commit("Add Clip on New Track");
            }
        });
    },

    setTool: function (tool) {
        CS.state.tool = tool;
        document.getElementById("tool-select").classList.toggle("active", tool === "select");
        document.getElementById("tool-blade").classList.toggle("active", tool === "blade");
    },

    setZoom: function (z) {
        var scroll = document.getElementById("tl-scroll");
        var anchorTime = (scroll.scrollLeft + scroll.clientWidth / 2) / CS.state.zoom;
        CS.state.zoom = CS.clamp(z, 4, 200);
        var slider = document.getElementById("tl-zoom");
        slider.value = CS.state.zoom;
        CS.paintSlider(slider);
        CS.timeline.render();
        scroll.scrollLeft = anchorTime * CS.state.zoom - scroll.clientWidth / 2;
    },

    scrubTo: function (ev) {
        var scroll = document.getElementById("tl-scroll");
        var rect = scroll.getBoundingClientRect();
        var x = ev.clientX - rect.left + scroll.scrollLeft;
        CS.player.seek(x / CS.state.zoom);
    },

    contentWidth: function () {
        var scroll = document.getElementById("tl-scroll");
        var need = (CS.timelineDuration() + CS.timeline.TAIL_SECONDS) * CS.state.zoom;
        return Math.max(need, scroll ? scroll.clientWidth : 800);
    },

    trackHeight: function (track) {
        return track.kind === "video" ? CS.timeline.TRACK_H_VIDEO : CS.timeline.TRACK_H_AUDIO;
    },

    /* ---------- full render ---------- */

    render: function () {
        CS.timeline.renderHeaders();
        CS.timeline.renderTracks();
        CS.timeline.drawRuler();
        CS.timeline.updatePlayhead();
        CS.player.updateTransportUI();
    },

    renderHeaders: function () {
        var holder = document.getElementById("tl-track-headers");
        holder.innerHTML = "";
        CS.tracksInDisplayOrder().forEach(function (track) {
            var h = document.createElement("div");
            h.className = "track-header";
            h.style.height = CS.timeline.trackHeight(track) + "px";

            var icon = document.createElement("span");
            icon.className = "th-icon";
            icon.innerHTML = CS.iconSVG(track.kind === "video" ? "film" : "speaker");

            var name = document.createElement("span");
            name.className = "th-name";
            name.textContent = track.name;

            var toggle = document.createElement("button");
            toggle.className = "th-toggle";
            var on = track.kind === "video" ? track.visible : !track.muted;
            toggle.classList.toggle("off", !on);
            toggle.innerHTML = CS.iconSVG(on ? "eye" : "eye-off");
            toggle.title = track.kind === "video" ? "Toggle track visibility" : "Toggle track audio";
            toggle.addEventListener("click", function () {
                if (track.kind === "video") { track.visible = !track.visible; }
                else { track.muted = !track.muted; }
                CS.commit("Toggle Track");
            });

            h.appendChild(icon);
            h.appendChild(name);
            h.appendChild(toggle);
            h.addEventListener("contextmenu", function (ev) {
                ev.preventDefault();
                CS.timeline.trackMenu(track, ev.clientX, ev.clientY);
            });
            holder.appendChild(h);
        });
    },

    trackMenu: function (track, x, y) {
        var empty = CS.clipsOnTrack(track.id).length === 0;
        var sameKind = CS.project.tracks.filter(function (t) { return t.kind === track.kind; }).length;
        CS.showMenu([
            {
                label: "Delete track", icon: "trash", disabled: !empty || sameKind <= 1,
                action: function () {
                    CS.project.tracks = CS.project.tracks.filter(function (t) { return t.id !== track.id; });
                    CS.commit("Delete Track");
                }
            }
        ], x, y);
    },

    renderTracks: function () {
        var holder = document.getElementById("tl-tracks");
        holder.innerHTML = "";
        var width = CS.timeline.contentWidth();
        document.getElementById("tl-content").style.width = width + "px";

        CS.tracksInDisplayOrder().forEach(function (track) {
            var lane = document.createElement("div");
            lane.className = "tl-track";
            lane.style.height = CS.timeline.trackHeight(track) + "px";
            lane.style.width = width + "px";
            lane.dataset.trackId = track.id;

            CS.timeline.bindLaneDrop(lane, track);
            lane.addEventListener("pointerdown", function (ev) {
                if (ev.target === lane) { CS.selectClip(null); }
            });

            CS.clipsOnTrack(track.id).forEach(function (clip) {
                lane.appendChild(CS.timeline.buildClipEl(clip, track));
            });

            holder.appendChild(lane);
        });
    },

    /* ---------- clip elements ---------- */

    buildClipEl: function (clip, track) {
        var media = CS.getMedia(clip.mediaId);
        var el = document.createElement("div");
        el.className = "tl-clip";
        el.dataset.clipId = clip.id;
        var x = clip.start * CS.state.zoom;
        var w = Math.max(4, CS.clipDuration(clip) * CS.state.zoom);
        el.style.left = x + "px";
        el.style.width = w + "px";
        if (clip.id === CS.state.selectedClipId) { el.classList.add("selected"); }

        if (clip.kind === "title") {
            el.classList.add("title-clip");
            var tlbl = document.createElement("span");
            tlbl.className = "clip-label";
            tlbl.textContent = (clip.props.text && clip.props.text.content) || "Title";
            el.appendChild(tlbl);
        } else if (clip.kind === "color") {
            el.classList.add("color-clip");
            var cspec = clip.props.color || {};
            el.style.background = cspec.c1
                ? "linear-gradient(180deg, " + cspec.c0 + ", " + cspec.c1 + ")"
                : (cspec.c0 || "#000");
            var clbl = document.createElement("span");
            clbl.className = "clip-label";
            clbl.textContent = "Color";
            el.appendChild(clbl);
        } else if (!media || media.offline) {
            el.classList.add("offline");
            var lbl = document.createElement("span");
            lbl.className = "clip-label";
            lbl.textContent = (media ? media.name : "Missing media") + " (offline)";
            el.appendChild(lbl);
        } else if (track.kind === "audio") {
            el.classList.add("audio-clip");
            var audioIdx = CS.project.tracks.filter(function (t) { return t.kind === "audio"; })
                .findIndex(function (t) { return t.id === track.id; });
            if (audioIdx % 2 === 1) { el.classList.add("alt"); }

            var wave = document.createElement("canvas");
            wave.className = "clip-wave";
            CS.timeline.drawClipWave(wave, clip, media, w, CS.timeline.trackHeight(track) - 10);
            el.appendChild(wave);

            var label = document.createElement("span");
            label.className = "clip-label";
            label.textContent = media.name;
            el.appendChild(label);
        } else {
            //video / image clip: filmstrip of repeated probe frames
            var strip = document.createElement("div");
            strip.className = "clip-strip";
            CS.timeline.fillFilmstrip(strip, media, w, CS.timeline.trackHeight(track) - 10);
            el.appendChild(strip);
        }

        //Markers: effect stack + transition-in
        if (clip.props.effects && clip.props.effects.length) {
            var fxBadge = document.createElement("span");
            fxBadge.className = "clip-fx";
            fxBadge.textContent = "fx";
            el.appendChild(fxBadge);
        }
        if (clip.props.transition && clip.props.transition.type !== "none") {
            var trMark = document.createElement("span");
            trMark.className = "clip-tr";
            el.appendChild(trMark);
        }

        //Trim handles
        ["left", "right"].forEach(function (side) {
            var handle = document.createElement("div");
            handle.className = "trim-handle " + side;
            handle.addEventListener("pointerdown", function (ev) {
                ev.stopPropagation();
                CS.timeline.beginDrag(ev, clip, el, side === "left" ? "trim-l" : "trim-r");
            });
            el.appendChild(handle);
        });

        el.addEventListener("pointerdown", function (ev) {
            if (ev.button !== 0) { return; }
            if (CS.state.tool === "blade") {
                var rect = el.getBoundingClientRect();
                var t = clip.start + (ev.clientX - rect.left) / CS.state.zoom;
                if (t > clip.start + 0.05 && t < CS.clipEnd(clip) - 0.05) {
                    CS.splitClip(clip, t);
                    CS.commit("Split Clip");
                }
                return;
            }
            CS.selectClip(clip.id);
            CS.timeline.beginDrag(ev, clip, el, "move");
        });

        el.addEventListener("contextmenu", function (ev) {
            ev.preventDefault();
            CS.selectClip(clip.id);
            CS.showMenu([
                { label: "Split at playhead", icon: "scissors", action: CS.splitAtPlayhead },
                { label: "Reset properties", icon: "rotate-ccw", action: function () {
                    clip.props = CS.defaultClipProps();
                    CS.commit("Reset Clip");
                } },
                { sep: true },
                { label: "Delete", icon: "trash", action: CS.deleteSelectedClip }
            ], ev.clientX, ev.clientY);
        });

        return el;
    },

    fillFilmstrip: function (strip, media, clipW, clipH) {
        strip.innerHTML = "";
        if (!media.thumbs || !media.thumbs.length) {
            strip.style.background = "#2a2a33";
            return;
        }
        var frameW = Math.max(24, Math.round(clipH * 1.6));
        var count = Math.min(200, Math.ceil(clipW / frameW));
        var html = "";
        for (var i = 0; i < count; i++) {
            var t = media.thumbs[i % media.thumbs.length];
            html += '<img src="' + t + '" style="width:' + frameW + 'px;height:100%;object-fit:cover;" draggable="false">';
        }
        strip.style.display = "flex";
        strip.innerHTML = html;
    },

    drawClipWave: function (canvas, clip, media, w, h) {
        canvas.width = Math.min(4000, Math.max(2, Math.round(w)));
        canvas.height = Math.max(2, Math.round(h));
        var ctx = canvas.getContext("2d");
        var peaks = media.peaks;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        var mid = canvas.height * 0.62;
        if (!peaks || !peaks.length || !media.duration) {
            ctx.fillRect(0, mid - 1, canvas.width, 2);
            return;
        }
        var i0 = (clip.in / media.duration) * peaks.length;
        var i1 = (clip.out / media.duration) * peaks.length;
        var n = Math.floor(canvas.width / 2);
        for (var i = 0; i < n; i++) {
            var idx = Math.floor(i0 + (i1 - i0) * (i / n));
            var p = peaks[CS.clamp(idx, 0, peaks.length - 1)] || 0;
            var bh = Math.max(1, p * canvas.height * 0.7);
            ctx.fillRect(i * 2, mid - bh / 2, 1.4, bh);
        }
    },

    refreshSelection: function () {
        var nodes = document.querySelectorAll(".tl-clip");
        for (var i = 0; i < nodes.length; i++) {
            nodes[i].classList.toggle("selected", nodes[i].dataset.clipId === CS.state.selectedClipId);
        }
    },

    /* ---------- drag: move + trim ---------- */

    beginDrag: function (ev, clip, el, mode) {
        if (CS.state.tool === "blade") { return; }
        CS.player.pause();
        CS.timeline._drag = {
            mode: mode,
            clip: clip,
            el: el,
            pointerId: ev.pointerId,
            startX: ev.clientX,
            startY: ev.clientY,
            origStart: clip.start,
            origIn: clip.in,
            origOut: clip.out,
            origTrackId: clip.trackId,
            moved: false
        };
        //Track on the window: element-level capture is silently lost when
        //the clip is reparented into another lane mid-drag
        window.addEventListener("pointermove", CS.timeline.onDragMove);
        window.addEventListener("pointerup", CS.timeline.onDragEnd);
    },

    onDragMove: function (ev) {
        var d = CS.timeline._drag;
        if (!d) { return; }
        var dx = ev.clientX - d.startX;
        var dy = ev.clientY - d.startY;
        if (!d.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) { return; }
        d.moved = true;
        var dt = dx / CS.state.zoom;
        var clip = d.clip;
        var media = CS.getMedia(clip.mediaId);
        //Images, titles and color boards have no intrinsic duration
        var isImage = !media || media.type === "image";

        if (d.mode === "move") {
            var target = Math.max(0, d.origStart + dt);
            target = CS.timeline.applySnap(target, clip, "start");
            //If no snap on the left edge, try snapping the right edge
            clip.start = target;

            //Vertical: move across compatible tracks
            var isAudioClip = media && media.type === "audio";
            var lane = CS.timeline.laneUnderPointer(ev.clientY);
            d.newTrackKind = null;
            if (lane) {
                var track = CS.getTrack(lane.dataset.trackId);
                var kindOk = track && ((track.kind === "audio") === isAudioClip);
                if (kindOk && track.id !== clip.trackId) {
                    clip.trackId = track.id;
                    lane.appendChild(d.el);
                }
            } else {
                //Dragged past the outermost lanes: offer a brand-new track
                //(video above the top lane, audio below the bottom lane)
                var lanesRect = document.getElementById("tl-tracks").getBoundingClientRect();
                if (isAudioClip && ev.clientY > lanesRect.bottom) {
                    d.newTrackKind = "audio";
                } else if (!isAudioClip && ev.clientY < lanesRect.top) {
                    d.newTrackKind = "video";
                } else if (!isAudioClip && ev.clientY > lanesRect.bottom) {
                    //below everything also works for video: stack a new track on top
                    d.newTrackKind = "video";
                }
            }
            d.el.style.left = (clip.start * CS.state.zoom) + "px";
        } else {
            var minDur = CS.timeline.MIN_CLIP_DUR;
            if (d.mode === "trim-l") {
                var newStart = d.origStart + dt;
                var maxStart = d.origStart + (d.origOut - d.origIn) - minDur;
                newStart = CS.clamp(newStart, isImage ? 0 : d.origStart - d.origIn, maxStart);
                newStart = Math.max(0, CS.timeline.applySnap(newStart, clip, "trim"));
                var delta = newStart - d.origStart;
                clip.start = newStart;
                if (isImage) {
                    //Free-duration clips renormalize to in = 0
                    clip.in = 0;
                    clip.out = (d.origOut - d.origIn) - delta;
                } else {
                    clip.in = d.origIn + delta;
                }
            } else {
                var newOut = d.origOut + dt;
                var maxOut = isImage ? 1e9 : (media && media.duration ? media.duration : d.origOut);
                newOut = CS.clamp(newOut, d.origIn + minDur, maxOut);
                var endTime = clip.start + (newOut - clip.in);
                endTime = CS.timeline.applySnap(endTime, clip, "end");
                newOut = CS.clamp(endTime - clip.start + clip.in, d.origIn + minDur, maxOut);
                clip.out = newOut;
            }
            d.el.style.left = (clip.start * CS.state.zoom) + "px";
            d.el.style.width = Math.max(4, CS.clipDuration(clip) * CS.state.zoom) + "px";
            //Live-update strip/wave while trimming
            var track = CS.getTrack(clip.trackId);
            var wave = d.el.querySelector(".clip-wave");
            if (wave && media) {
                CS.timeline.drawClipWave(wave, clip, media, CS.clipDuration(clip) * CS.state.zoom, CS.timeline.trackHeight(track) - 10);
            }
            var strip = d.el.querySelector(".clip-strip");
            if (strip && media) {
                CS.timeline.fillFilmstrip(strip, media, CS.clipDuration(clip) * CS.state.zoom, CS.timeline.trackHeight(track) - 10);
            }
        }
    },

    onDragEnd: function (ev) {
        var d = CS.timeline._drag;
        if (!d) { return; }
        window.removeEventListener("pointermove", CS.timeline.onDragMove);
        window.removeEventListener("pointerup", CS.timeline.onDragEnd);
        CS.timeline._drag = null;
        CS.timeline.hideSnapGuide();

        if (!d.moved) {
            CS.timeline.refreshSelection();
            return;
        }

        var clip = d.clip;
        if (d.mode === "move") {
            if (d.newTrackKind) {
                clip.trackId = CS.createTrack(d.newTrackKind);
            }
            clip.start = CS.timeline.resolveOverlap(clip, clip.trackId, clip.start);
        } else {
            //Trimming may have created an overlap with the next clip: clamp
            CS.timeline.clampTrimOverlap(clip);
        }
        CS.commit(d.mode === "move" ? "Move Clip" : "Trim Clip");
    },

    laneUnderPointer: function (clientY) {
        var lanes = document.querySelectorAll(".tl-track");
        for (var i = 0; i < lanes.length; i++) {
            var r = lanes[i].getBoundingClientRect();
            if (clientY >= r.top && clientY <= r.bottom) { return lanes[i]; }
        }
        return null;
    },

    /* ---------- snapping ---------- */

    snapTargets: function (excludeClip) {
        var pts = [0, CS.state.playhead];
        CS.project.clips.forEach(function (c) {
            if (excludeClip && c.id === excludeClip.id) { return; }
            pts.push(c.start);
            pts.push(CS.clipEnd(c));
        });
        return pts;
    },

    //Snap the candidate time (for the given clip edge) to nearby targets
    applySnap: function (time, clip, edge) {
        var threshold = 8 / CS.state.zoom;
        var targets = CS.timeline.snapTargets(clip);
        var dur = CS.clipDuration(clip);
        var best = null, bestDist = threshold, guideAt = 0;
        targets.forEach(function (target) {
            //Edge being dragged lands on the target
            var d1 = Math.abs(time - target);
            if (d1 < bestDist) { best = target; bestDist = d1; guideAt = target; }
            //When moving the whole clip, the opposite edge can snap too
            if (edge === "start") {
                var d2 = Math.abs((time + dur) - target);
                if (d2 < bestDist) { best = target - dur; bestDist = d2; guideAt = target; }
            }
        });
        if (best !== null) {
            CS.timeline.showSnapGuide(guideAt);
            return best;
        }
        CS.timeline.hideSnapGuide();
        return time;
    },

    showSnapGuide: function (time) {
        var guide = document.getElementById("snap-guide");
        if (!guide) {
            guide = document.createElement("div");
            guide.id = "snap-guide";
            guide.className = "snap-guide";
            document.getElementById("tl-content").appendChild(guide);
        }
        guide.style.left = (time * CS.state.zoom) + "px";
        guide.style.display = "block";
    },

    hideSnapGuide: function () {
        var guide = document.getElementById("snap-guide");
        if (guide) { guide.style.display = "none"; }
    },

    /* ---------- overlap prevention ---------- */

    //Find the closest legal start position for clip on the track
    resolveOverlap: function (clip, trackId, desiredStart) {
        var dur = CS.clipDuration(clip);
        var others = CS.clipsOnTrack(trackId).filter(function (c) { return c.id !== clip.id; });
        var start = Math.max(0, desiredStart);

        function collides(s) {
            for (var i = 0; i < others.length; i++) {
                var o = others[i];
                if (s < CS.clipEnd(o) - 0.0001 && s + dur > o.start + 0.0001) { return o; }
            }
            return null;
        }

        var hit = collides(start);
        var guard = 0;
        while (hit && guard < 50) {
            //Choose the nearer side of the colliding clip
            var before = hit.start - dur;
            var after = CS.clipEnd(hit);
            if (before >= 0 && Math.abs(start - before) <= Math.abs(start - after)) {
                start = before;
            } else {
                start = after;
            }
            hit = collides(start);
            guard++;
        }
        return Math.max(0, start);
    },

    clampTrimOverlap: function (clip) {
        var others = CS.clipsOnTrack(clip.trackId).filter(function (c) { return c.id !== clip.id; });
        others.forEach(function (o) {
            //clip's tail overlaps o's head
            if (clip.start < o.start && CS.clipEnd(clip) > o.start) {
                clip.out = clip.in + (o.start - clip.start);
            }
            //clip's head overlaps o's tail
            if (clip.start >= o.start && clip.start < CS.clipEnd(o)) {
                var shift = CS.clipEnd(o) - clip.start;
                clip.start += shift;
                clip.in += shift;
                if (clip.out - clip.in < CS.timeline.MIN_CLIP_DUR) { clip.out = clip.in + CS.timeline.MIN_CLIP_DUR; }
            }
        });
    },

    /* ---------- drops from the media bin ---------- */

    bindLaneDrop: function (lane, track) {
        lane.addEventListener("dragover", function (ev) {
            if (!ev.dataTransfer) { return; }
            ev.preventDefault();
            lane.classList.add("drop-target");
        });
        lane.addEventListener("dragleave", function () {
            lane.classList.remove("drop-target");
        });
        lane.addEventListener("drop", function (ev) {
            ev.preventDefault();
            lane.classList.remove("drop-target");
            var mediaId = ev.dataTransfer.getData("cinestudio/media");
            var scroll = document.getElementById("tl-scroll");
            var rect = scroll.getBoundingClientRect();
            var t = (ev.clientX - rect.left + scroll.scrollLeft) / CS.state.zoom;

            if (mediaId) {
                var media = CS.getMedia(mediaId);
                if (!media) { return; }
                if (media.offline) { CS.toast("Cannot use offline media", true); return; }
                var isAudio = media.type === "audio";
                if (isAudio !== (track.kind === "audio")) {
                    CS.toast(isAudio ? "Audio clips go on audio tracks" : "Video clips go on video tracks", true);
                    return;
                }
                var clip = CS.addClipToTimeline(media, track.id, t);
                if (clip) {
                    CS.state.selectedClipId = clip.id;
                    CS.commit("Add Clip");
                }
                return;
            }

            //Drop straight from the ArozOS File Manager: import then place
            if (typeof ao_module_utils !== "undefined") {
                var files = null;
                try { files = ao_module_utils.getDropFileInfo(ev); } catch (e) { files = null; }
                if (files && files.length) {
                    files.forEach(function (f) { CS.media.addFromVpath(f.filepath, f.filename); });
                    CS.toast("Imported to media bin - drag to the timeline once probed");
                }
            }
        });
    },

    /* ---------- ruler + playhead ---------- */

    drawRuler: function () {
        var canvas = document.getElementById("tl-ruler");
        var scroll = document.getElementById("tl-scroll");
        if (!canvas || !scroll) { return; }
        var dpr = window.devicePixelRatio || 1;
        var w = scroll.clientWidth;
        var h = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--ruler-h"), 10) || 34;
        if (canvas.width !== Math.round(w * dpr)) {
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            canvas.style.width = w + "px";
            canvas.style.height = h + "px";
        }
        var ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        var zoom = CS.state.zoom;
        var scrollLeft = scroll.scrollLeft;

        //Pick a label step that keeps labels at least ~90px apart
        var steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
        var step = steps[steps.length - 1];
        for (var i = 0; i < steps.length; i++) {
            if (steps[i] * zoom >= 90) { step = steps[i]; break; }
        }
        var minor = step / 5;

        ctx.font = "10.5px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.textBaseline = "middle";

        var tStart = Math.floor(scrollLeft / zoom / minor) * minor;
        var tEnd = (scrollLeft + w) / zoom;
        for (var t = tStart; t <= tEnd; t += minor) {
            var x = t * zoom - scrollLeft;
            var isMajor = Math.abs(t / step - Math.round(t / step)) < 0.001;
            if (isMajor) {
                ctx.fillStyle = "#8b8b95";
                ctx.fillText(CS.timecode(t), x + 6, h / 2);
                ctx.fillStyle = "#3a3a44";
                ctx.fillRect(x, h - 10, 1, 10);
            } else {
                ctx.fillStyle = "#2a2a32";
                ctx.fillRect(x, h - 6, 1, 6);
            }
        }
        //bottom hairline
        ctx.fillStyle = "#1c1c22";
        ctx.fillRect(0, h - 1, w, 1);
    },

    updatePlayhead: function () {
        var ph = document.getElementById("tl-playhead");
        var x = CS.state.playhead * CS.state.zoom;
        ph.style.left = x + "px";

        //Keep the playhead visible while playing
        if (CS.state.playing) {
            var scroll = document.getElementById("tl-scroll");
            if (x < scroll.scrollLeft || x > scroll.scrollLeft + scroll.clientWidth - 40) {
                scroll.scrollLeft = Math.max(0, x - 80);
            }
        }
    },

    syncHeaderScroll: function () {
        //Keep the header column aligned when many tracks force vertical scroll
        var scroll = document.getElementById("tl-scroll");
        var headers = document.getElementById("tl-track-headers");
        if (scroll && headers) { headers.scrollTop = scroll.scrollTop; }
    }
};
