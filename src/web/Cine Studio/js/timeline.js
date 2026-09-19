/*
    Cine Studio - timeline

    Renders the ruler, track headers, track lanes and clips; handles
    scrubbing, the editing tools (select, track select, ripple, rolling,
    razor, slip, slide, rate stretch), drops from the media bin, snapping,
    zoom, sequence in / out points and gap handling.

    Tool semantics follow Premiere Pro:
      select        move clips, trim edges (gaps stay)
      trackselect   click selects every clip from there to the end of the
                    track (shift: on every track)
      ripple        trimming an edge shifts everything after it
      rolling       dragging an edit point trims both neighbours at once
      razor         click splits a clip
      slip          drag inside a clip changes what part of the source it
                    shows, position and length stay
      slide         drag moves the clip, the neighbours give / take the room
      ratestretch   dragging an edge changes the speed, not the content
*/
"use strict";

window.CS = window.CS || {};

CS.timeline = {
    TRACK_H_VIDEO: 62,
    TRACK_H_AUDIO: 52,
    MIN_CLIP_DUR: 0.1,
    TAIL_SECONDS: 30,   //empty space kept after the last clip

    TOOLS: [
        { id: "select", label: "Selection", key: "V", icon: "cursor" },
        { id: "trackselect", label: "Track Select Forward", key: "A", icon: "track-select" },
        { id: "ripple", label: "Ripple Edit", key: "B", icon: "ripple" },
        { id: "rolling", label: "Rolling Edit", key: "N", icon: "rolling" },
        { id: "ratestretch", label: "Rate Stretch", key: "R", icon: "stretch" },
        { id: "blade", label: "Razor", key: "C", icon: "blade" },
        { id: "slip", label: "Slip", key: "Y", icon: "slip" },
        { id: "slide", label: "Slide", key: "U", icon: "slide" }
    ],

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

        //Scrub by pressing / dragging on the ruler; double-click a marker flag
        //to name and colour it
        var ruler = document.getElementById("tl-ruler");
        ruler.addEventListener("pointerdown", function (ev) {
            ruler.setPointerCapture(ev.pointerId);
            CS.player.pause();
            CS.timeline.scrubTo(ev);
            ruler.onpointermove = function (mv) { CS.timeline.scrubTo(mv); };
            ruler.onpointerup = function () { ruler.onpointermove = null; ruler.onpointerup = null; };
        });
        ruler.addEventListener("dblclick", function (ev) {
            var t = CS.timeline.timeAtClientX(ev.clientX);
            var m = CS.markerNear(t, 6 / CS.state.zoom);
            if (m) { CS.editMarkerDialog(m); }
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
        document.getElementById("btn-zoom-fit").addEventListener("click", CS.timeline.zoomToSequence);
        CS.paintSlider(zoom);

        //Toolbar: one button per tool
        CS.timeline.TOOLS.forEach(function (tool) {
            var btn = document.getElementById("tool-" + tool.id);
            if (!btn) { return; }
            btn.title = tool.label + " (" + tool.key + ")";
            btn.addEventListener("click", function () { CS.timeline.setTool(tool.id); });
        });
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
        document.getElementById("btn-snap").addEventListener("click", function () {
            CS.state.snap = !CS.state.snap;
            this.classList.toggle("active", CS.state.snap);
            CS.toast("Snapping " + (CS.state.snap ? "on" : "off"));
        });
        document.getElementById("btn-linked").addEventListener("click", function () {
            CS.state.linked = !CS.state.linked;
            this.classList.toggle("active", CS.state.linked);
            CS.toast("Linked selection " + (CS.state.linked ? "on" : "off"));
        });
        document.getElementById("btn-marker").addEventListener("click", CS.toggleMarkerAtPlayhead);
        document.getElementById("btn-mark-in").addEventListener("click", function () { CS.setInPoint(CS.state.playhead); });
        document.getElementById("btn-mark-out").addEventListener("click", function () { CS.setOutPoint(CS.state.playhead); });
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
            var t = Math.max(0, CS.timeline.timeAtClientX(ev.clientX));
            var clip = CS.addClipToTimeline(media, trackId, t);
            if (clip) {
                CS.state.selectedClipId = clip.id;
                CS.commit("Add Clip on New Track");
            }
        });
    },

    setTool: function (tool) {
        var known = CS.timeline.TOOLS.some(function (t) { return t.id === tool; });
        if (!known) { return; }
        CS.state.tool = tool;
        CS.timeline.TOOLS.forEach(function (t) {
            var btn = document.getElementById("tool-" + t.id);
            if (btn) { btn.classList.toggle("active", t.id === tool); }
        });
        var lanes = document.getElementById("tl-tracks");
        if (lanes) { lanes.setAttribute("data-tool", tool); }
    },

    setZoom: function (z) {
        var scroll = document.getElementById("tl-scroll");
        var anchorTime = (scroll.scrollLeft + scroll.clientWidth / 2) / CS.state.zoom;
        CS.state.zoom = CS.clamp(z, 2, 400);
        var slider = document.getElementById("tl-zoom");
        slider.value = CS.state.zoom;
        CS.paintSlider(slider);
        CS.timeline.render();
        scroll.scrollLeft = anchorTime * CS.state.zoom - scroll.clientWidth / 2;
    },

    //Fit the whole sequence into the visible timeline width
    zoomToSequence: function () {
        var scroll = document.getElementById("tl-scroll");
        var dur = Math.max(1, CS.timelineDuration());
        CS.timeline.setZoom((scroll.clientWidth - 40) / dur);
        scroll.scrollLeft = 0;
    },

    timeAtClientX: function (clientX) {
        var scroll = document.getElementById("tl-scroll");
        var rect = scroll.getBoundingClientRect();
        return (clientX - rect.left + scroll.scrollLeft) / CS.state.zoom;
    },

    scrubTo: function (ev) {
        CS.player.seek(CS.timeline.timeAtClientX(ev.clientX));
    },

    contentWidth: function () {
        var scroll = document.getElementById("tl-scroll");
        var need = (CS.timelineDuration() + CS.timeline.TAIL_SECONDS) * CS.state.zoom;
        return Math.max(need, scroll ? scroll.clientWidth : 800);
    },

    trackHeight: function (track) {
        var base = track.kind === "video" ? CS.timeline.TRACK_H_VIDEO : CS.timeline.TRACK_H_AUDIO;
        return Math.round(base * (track.height || 1));
    },

    /* ---------- full render ---------- */

    render: function () {
        CS.timeline.renderHeaders();
        CS.timeline.renderTracks();
        CS.timeline.drawRuler();
        CS.timeline.updatePlayhead();
        CS.timeline.updateRange();
        CS.player.updateTransportUI();
    },

    renderHeaders: function () {
        var holder = document.getElementById("tl-track-headers");
        holder.innerHTML = "";
        CS.tracksInDisplayOrder().forEach(function (track) {
            var h = document.createElement("div");
            h.className = "track-header" + (track.solo ? " solo" : "") + (track.locked ? " locked" : "");
            h.style.height = CS.timeline.trackHeight(track) + "px";
            h.dataset.trackId = track.id;

            //Source patching: which tracks insert / overwrite edits land on
            var target = document.createElement("button");
            target.className = "th-target" + (track.target === false ? " off" : "");
            target.textContent = track.id;
            target.title = "Target track for insert / overwrite (source patching)";
            target.addEventListener("click", function () {
                track.target = (track.target === false);
                CS.timeline.renderHeaders();
            });

            var name = document.createElement("span");
            name.className = "th-name";
            name.textContent = track.name;
            name.title = "Double-click to rename";
            name.addEventListener("dblclick", function () { CS.timeline.renameTrack(track); });

            var lock = document.createElement("button");
            lock.className = "th-lock" + (track.locked ? " on" : "");
            lock.innerHTML = CS.iconSVG(track.locked ? "lock" : "unlock");
            lock.title = track.locked ? "Unlock track" : "Lock track (no edits, no drops)";
            lock.addEventListener("click", function () {
                track.locked = !track.locked;
                CS.commit(track.locked ? "Lock Track" : "Unlock Track");
            });

            var toggle = document.createElement("button");
            toggle.className = "th-toggle";
            var on = track.kind === "video" ? track.visible : !track.muted;
            toggle.classList.toggle("off", !on);
            toggle.innerHTML = CS.iconSVG(on ? "eye" : "eye-off");
            toggle.title = track.kind === "video" ? "Toggle track visibility" : "Mute track";
            toggle.addEventListener("click", function () {
                if (track.kind === "video") { track.visible = !track.visible; }
                else { track.muted = !track.muted; }
                CS.commit("Toggle Track");
            });

            h.appendChild(target);
            h.appendChild(name);
            if (track.kind === "audio") {
                var solo = document.createElement("button");
                solo.className = "th-solo" + (track.solo ? " on" : "");
                solo.textContent = "S";
                solo.title = "Solo track";
                solo.addEventListener("click", function () {
                    track.solo = !track.solo;
                    CS.commit(track.solo ? "Solo Track" : "Unsolo Track");
                });
                h.appendChild(solo);
            }
            h.appendChild(lock);
            h.appendChild(toggle);
            h.addEventListener("contextmenu", function (ev) {
                ev.preventDefault();
                CS.timeline.trackMenu(track, ev.clientX, ev.clientY);
            });
            holder.appendChild(h);
        });
    },

    renameTrack: function (track) {
        var nameIn;
        CS.modal({
            title: "Rename Track",
            build: function (body) {
                nameIn = CS.modalRow(body, "Name", CS.textInput(track.name));
            },
            buttons: [
                { label: "Cancel" },
                { label: "Rename", primary: true, action: function () {
                    var v = nameIn.value.trim();
                    if (v) { track.name = v; CS.commit("Rename Track"); }
                } }
            ]
        });
    },

    trackMenu: function (track, x, y) {
        var empty = CS.clipsOnTrack(track.id).length === 0;
        var sameKind = CS.project.tracks.filter(function (t) { return t.kind === track.kind; }).length;
        var items = [];
        if (track.kind === "audio") {
            items.push({
                label: "Solo", icon: "speaker", checked: !!track.solo,
                action: function () {
                    track.solo = !track.solo;
                    CS.commit(track.solo ? "Solo Track" : "Unsolo Track");
                }
            });
        }
        items.push({
            label: track.locked ? "Unlock track" : "Lock track", icon: "lock",
            action: function () {
                track.locked = !track.locked;
                CS.commit(track.locked ? "Lock Track" : "Unlock Track");
            }
        });
        items.push({ label: "Rename...", icon: "nav-text", action: function () { CS.timeline.renameTrack(track); } });
        items.push({ sep: true });
        [{ v: 0.7, l: "Small" }, { v: 1, l: "Normal" }, { v: 1.6, l: "Large" }].forEach(function (h) {
            items.push({
                label: "Track height: " + h.l, checked: (track.height || 1) === h.v,
                action: function () { track.height = h.v; CS.timeline.render(); }
            });
        });
        items.push({ sep: true });
        items.push({
            label: "Delete track", icon: "trash", disabled: !empty || sameKind <= 1,
            action: function () {
                CS.project.tracks = CS.project.tracks.filter(function (t) { return t.id !== track.id; });
                CS.commit("Delete Track");
            }
        });
        CS.showMenu(items, x, y);
    },

    renderTracks: function () {
        var holder = document.getElementById("tl-tracks");
        holder.innerHTML = "";
        holder.setAttribute("data-tool", CS.state.tool);
        var width = CS.timeline.contentWidth();
        document.getElementById("tl-content").style.width = width + "px";

        CS.tracksInDisplayOrder().forEach(function (track) {
            var lane = document.createElement("div");
            lane.className = "tl-track" + (track.locked ? " locked" : "");
            lane.style.height = CS.timeline.trackHeight(track) + "px";
            lane.style.width = width + "px";
            lane.dataset.trackId = track.id;

            CS.timeline.bindLaneDrop(lane, track);
            lane.addEventListener("pointerdown", function (ev) {
                if (ev.target !== lane) { return; }
                if (CS.state.tool === "trackselect") {
                    CS.timeline.selectForward(track, CS.timeline.timeAtClientX(ev.clientX), ev.shiftKey);
                    return;
                }
                CS.selectClip(null);
            });
            lane.addEventListener("contextmenu", function (ev) {
                if (ev.target !== lane) { return; }
                ev.preventDefault();
                CS.timeline.gapMenu(track, CS.timeline.timeAtClientX(ev.clientX), ev.clientX, ev.clientY);
            });

            CS.clipsOnTrack(track.id).forEach(function (clip) {
                lane.appendChild(CS.timeline.buildClipEl(clip, track));
            });

            holder.appendChild(lane);
        });
    },

    //Track select forward: everything on the track starting at or after t
    selectForward: function (track, t, allTracks) {
        var ids = [];
        CS.project.clips.forEach(function (c) {
            if (!allTracks && c.trackId !== track.id) { return; }
            if (CS.clipEnd(c) > t + 0.0001) { ids.push(c.id); }
        });
        CS.state.selectedClipIds = ids;
        CS.state.selectedClipId = ids.length ? ids[0] : null;
        CS.timeline.refreshSelection();
        CS.inspector.render();
        CS.toast(ids.length + " clip" + (ids.length === 1 ? "" : "s") + " selected");
    },

    //Context menu on empty lane space: close the gap under the pointer
    gapMenu: function (track, t, x, y) {
        var gap = CS.gapAt(track.id, t);
        CS.showMenu([
            {
                label: "Close gap (ripple delete)", icon: "trash", disabled: !gap || track.locked,
                action: function () { CS.closeGap(track.id, gap); }
            },
            {
                label: "Paste at playhead", icon: "copy", disabled: !CS.clipClipboard, action: CS.pasteClipsAtPlayhead
            }
        ], x, y);
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
        if ((CS.state.selectedClipIds || []).indexOf(clip.id) >= 0) { el.classList.add("selected"); }

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
        } else if (clip.kind === "adjust") {
            el.classList.add("adjust-clip");
            var albl = document.createElement("span");
            albl.className = "clip-label";
            albl.textContent = "Adjustment Layer";
            el.appendChild(albl);
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

        //Badges: effect stack, transition-in, speed, link, keyframes
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
        if (clip.props.audioTransition && clip.props.audioTransition.type !== "none") {
            var atMark = document.createElement("span");
            atMark.className = "clip-tr audio";
            el.appendChild(atMark);
        }
        var speed = CS.clipSpeed(clip);
        if (speed !== 1 || clip.props.reverse) {
            var spBadge = document.createElement("span");
            spBadge.className = "clip-speed";
            spBadge.textContent = (clip.props.reverse ? "-" : "") + Math.round(speed * 100) + "%";
            el.appendChild(spBadge);
        }
        if (clip.props.link) {
            var lnk = document.createElement("span");
            lnk.className = "clip-link";
            lnk.innerHTML = CS.iconSVG("link");
            lnk.title = "Linked clip";
            el.appendChild(lnk);
        }
        if (CS.keyframes) { CS.keyframes.decorateClip(el, clip); }

        //Trim handles
        ["left", "right"].forEach(function (side) {
            var handle = document.createElement("div");
            handle.className = "trim-handle " + side;
            handle.addEventListener("pointerdown", function (ev) {
                if (ev.button !== 0) { return; }
                ev.stopPropagation();
                if (track.locked) { CS.toast("Track is locked", true); return; }
                var mode = side === "left" ? "trim-l" : "trim-r";
                if (CS.state.tool === "ratestretch") { mode = side === "left" ? "rate-l" : "rate-r"; }
                else if (CS.state.tool === "rolling") { mode = side === "left" ? "roll-l" : "roll-r"; }
                else if (CS.state.tool === "ripple") { mode = side === "left" ? "ripple-l" : "ripple-r"; }
                CS.timeline.beginDrag(ev, clip, el, mode);
            });
            el.appendChild(handle);
        });

        el.addEventListener("pointerdown", function (ev) {
            if (ev.button !== 0) { return; }
            var tool = CS.state.tool;
            if (tool === "blade") {
                if (track.locked) { CS.toast("Track is locked", true); return; }
                var t = clip.start + (ev.clientX - el.getBoundingClientRect().left) / CS.state.zoom;
                if (t > clip.start + 0.05 && t < CS.clipEnd(clip) - 0.05) {
                    CS.splitClipLinked(clip, t);
                    CS.commit("Split Clip");
                }
                return;
            }
            if (tool === "trackselect") {
                CS.timeline.selectForward(track, clip.start, ev.shiftKey);
                return;
            }
            if (ev.shiftKey) {
                //Shift-click: extend / shrink the multi-selection, no drag
                CS.toggleSelectClip(clip.id);
                return;
            }
            if ((CS.state.selectedClipIds || []).indexOf(clip.id) < 0) {
                CS.selectClip(clip.id);
            } else {
                //Clicked inside an existing multi-selection: keep the group
                CS.state.selectedClipId = clip.id;
                CS.timeline.refreshSelection();
                CS.inspector.render();
            }
            if (track.locked) { return; }
            var mode = "move";
            if (tool === "slip") { mode = "slip"; }
            else if (tool === "slide") { mode = "slide"; }
            CS.timeline.beginDrag(ev, clip, el, mode);
        });

        el.addEventListener("contextmenu", function (ev) {
            ev.preventDefault();
            if ((CS.state.selectedClipIds || []).indexOf(clip.id) < 0) {
                CS.selectClip(clip.id);
            }
            CS.timeline.clipMenu(clip, track, media, ev.clientX, ev.clientY);
        });

        return el;
    },

    clipMenu: function (clip, track, media, x, y) {
        var canDetach = media && media.type === "video" && track.kind === "video" &&
            !clip.props.audioDetached;
        var canHold = media && media.type === "video" && track.kind === "video";
        CS.showMenu([
            { label: "Copy", icon: "copy", action: CS.copySelectedClips },
            { label: "Paste at playhead", icon: "copy", disabled: !CS.clipClipboard, action: CS.pasteClipsAtPlayhead },
            { label: "Duplicate", icon: "plus-square", action: CS.duplicateSelectedClips },
            { sep: true },
            { label: "Split at playhead", icon: "scissors", action: CS.splitAtPlayhead },
            { label: "Detach audio", icon: "detach", disabled: !canDetach, action: function () {
                CS.detachAudio(clip);
            } },
            { label: (clip.props.link ? "Unlink" : "Link selected clips"), icon: "link", action: function () {
                if (clip.props.link) { CS.unlinkClips(); } else { CS.linkSelectedClips(); }
            } },
            { label: "Add frame hold", icon: "camera", disabled: !canHold, action: function () {
                CS.addFrameHold(clip);
            } },
            { label: "Speed / Duration...", icon: "stretch", disabled: !media || media.type === "image", action: function () {
                CS.speedDialog(clip);
            } },
            { label: "Reset properties", icon: "rotate-ccw", action: function () {
                clip.props = CS.defaultClipProps();
                CS.commit("Reset Clip");
            } },
            { sep: true },
            { label: "Ripple delete", icon: "trash", action: CS.rippleDeleteSelected },
            { label: "Delete", icon: "trash", action: CS.deleteSelectedClip }
        ], x, y);
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
        var ids = CS.state.selectedClipIds || [];
        var nodes = document.querySelectorAll(".tl-clip");
        for (var i = 0; i < nodes.length; i++) {
            nodes[i].classList.toggle("selected", ids.indexOf(nodes[i].dataset.clipId) >= 0);
        }
    },

    //Repaint one clip element in place after a drag changed its geometry
    repaintClipEl: function (clip) {
        var el = document.querySelector('.tl-clip[data-clip-id="' + clip.id + '"]');
        if (!el) { return; }
        var track = CS.getTrack(clip.trackId);
        var media = CS.getMedia(clip.mediaId);
        el.style.left = (clip.start * CS.state.zoom) + "px";
        var w = Math.max(4, CS.clipDuration(clip) * CS.state.zoom);
        el.style.width = w + "px";
        var wave = el.querySelector(".clip-wave");
        if (wave && media) {
            CS.timeline.drawClipWave(wave, clip, media, w, CS.timeline.trackHeight(track) - 10);
        }
        var strip = el.querySelector(".clip-strip");
        if (strip && media) {
            CS.timeline.fillFilmstrip(strip, media, w, CS.timeline.trackHeight(track) - 10);
        }
    },

    /* ---------- neighbours ---------- */

    prevOnTrack: function (clip) {
        var best = null;
        CS.clipsOnTrack(clip.trackId).forEach(function (c) {
            if (c.id !== clip.id && CS.clipEnd(c) <= clip.start + 0.0001) {
                if (!best || CS.clipEnd(c) > CS.clipEnd(best)) { best = c; }
            }
        });
        return best;
    },

    nextOnTrack: function (clip) {
        var best = null;
        CS.clipsOnTrack(clip.trackId).forEach(function (c) {
            if (c.id !== clip.id && c.start >= CS.clipEnd(clip) - 0.0001) {
                if (!best || c.start < best.start) { best = c; }
            }
        });
        return best;
    },

    //Source length available to a clip (Infinity for free-duration clips)
    sourceLength: function (clip) {
        var media = CS.getMedia(clip.mediaId);
        if (!media || media.type === "image") { return Infinity; }
        return media.duration || clip.out;
    },

    /* ---------- drag: move, trim, ripple, roll, slip, slide, rate ---------- */

    beginDrag: function (ev, clip, el, mode) {
        if (CS.state.tool === "blade") { return; }
        CS.player.pause();
        //Move mode drags the whole selection when the clip belongs to it
        var group = [{ clip: clip, origStart: clip.start }];
        if (mode === "move") {
            var ids = CS.state.selectedClipIds || [];
            if (ids.indexOf(clip.id) >= 0 && ids.length > 1) {
                group = ids.map(function (id) {
                    var c = CS.getClip(id);
                    return c && !CS.trackLocked(c.trackId) ? { clip: c, origStart: c.start } : null;
                }).filter(function (g) { return !!g; });
            }
        }
        var prev = CS.timeline.prevOnTrack(clip);
        var next = CS.timeline.nextOnTrack(clip);
        //Later clips on the track, for ripple edits
        var later = CS.clipsOnTrack(clip.trackId).filter(function (c) {
            return c.id !== clip.id && c.start >= CS.clipEnd(clip) - 0.0001;
        }).map(function (c) { return { clip: c, origStart: c.start }; });

        CS.timeline._drag = {
            mode: mode,
            clip: clip,
            el: el,
            group: group,
            later: later,
            prev: prev ? { clip: prev, origOut: prev.out, origIn: prev.in, origStart: prev.start } : null,
            next: next ? { clip: next, origOut: next.out, origIn: next.in, origStart: next.start } : null,
            pointerId: ev.pointerId,
            startX: ev.clientX,
            startY: ev.clientY,
            origStart: clip.start,
            origIn: clip.in,
            origOut: clip.out,
            origSpeed: CS.clipSpeed(clip),
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
        var minDur = CS.timeline.MIN_CLIP_DUR;
        var v = isImage ? 1 : d.origSpeed;

        switch (d.mode) {
        case "move":
            CS.timeline.dragMove(d, ev, dt, media);
            break;

        case "trim-l":
        case "ripple-l": {
            var newStart = d.origStart + dt;
            var maxStart = d.origStart + (d.origOut - d.origIn) / v - minDur;
            newStart = CS.clamp(newStart, isImage ? 0 : d.origStart - d.origIn / v, maxStart);
            newStart = Math.max(0, CS.timeline.applySnap(newStart, clip, "trim"));
            var delta = newStart - d.origStart;
            clip.start = newStart;
            if (isImage) {
                //Free-duration clips renormalize to in = 0
                clip.in = 0;
                clip.out = (d.origOut - d.origIn) - delta;
            } else {
                clip.in = d.origIn + delta * v;
            }
            if (d.mode === "ripple-l") {
                //The head stays put and everything after closes up
                clip.start = d.origStart;
                CS.timeline.shiftLater(d, -delta);
            }
            break;
        }

        case "trim-r":
        case "ripple-r": {
            var newOut = d.origOut + dt * v;
            var maxOut = isImage ? 1e9 : CS.timeline.sourceLength(clip);
            newOut = CS.clamp(newOut, d.origIn + minDur * v, maxOut);
            var endTime = clip.start + (newOut - clip.in) / v;
            endTime = CS.timeline.applySnap(endTime, clip, "end");
            newOut = CS.clamp((endTime - clip.start) * v + clip.in, d.origIn + minDur * v, maxOut);
            clip.out = newOut;
            if (d.mode === "ripple-r") {
                CS.timeline.shiftLater(d, CS.clipEnd(clip) - (d.origStart + (d.origOut - d.origIn) / v));
            }
            break;
        }

        case "roll-r":
        case "roll-l": {
            //Rolling edit: the edit point moves, the outgoing clip grows or
            //shrinks by exactly what the incoming clip loses or gains
            var out = d.mode === "roll-r" ? { clip: clip, origOut: d.origOut, origIn: d.origIn } : d.prev;
            var inc = d.mode === "roll-r" ? d.next : { clip: clip, origIn: d.origIn, origOut: d.origOut, origStart: d.origStart };
            if (!out || !inc) {
                //No neighbour on that side: behaves like a plain trim
                d.mode = d.mode === "roll-r" ? "trim-r" : "trim-l";
                CS.timeline.onDragMove(ev);
                return;
            }
            var vo = CS.clipSpeed(out.clip), vi = CS.clipSpeed(inc.clip);
            var outIsImage = CS.timeline.sourceLength(out.clip) === Infinity;
            var incIsImage = CS.timeline.sourceLength(inc.clip) === Infinity;
            var minDt = -((out.origOut - out.origIn) / vo - minDur);
            var maxDt = (inc.origOut - inc.origIn) / vi - minDur;
            if (!outIsImage) { maxDt = Math.min(maxDt, (CS.timeline.sourceLength(out.clip) - out.origOut) / vo); }
            if (!incIsImage) { minDt = Math.max(minDt, -inc.origIn / vi); }
            var rdt = CS.clamp(dt, minDt, maxDt);
            var cut = CS.timeline.applySnap(inc.origStart + rdt, clip, "trim");
            rdt = CS.clamp(cut - inc.origStart, minDt, maxDt);
            out.clip.out = out.origOut + rdt * vo;
            inc.clip.start = inc.origStart + rdt;
            if (incIsImage) {
                inc.clip.in = 0;
                inc.clip.out = (inc.origOut - inc.origIn) - rdt;
            } else {
                inc.clip.in = inc.origIn + rdt * vi;
            }
            CS.timeline.repaintClipEl(out.clip);
            CS.timeline.repaintClipEl(inc.clip);
            break;
        }

        case "slip": {
            //Same place, same length, different part of the source
            if (isImage) { return; }
            var len = d.origOut - d.origIn;
            var maxIn = Math.max(0, CS.timeline.sourceLength(clip) - len);
            clip.in = CS.clamp(d.origIn - dt * v, 0, maxIn);
            clip.out = clip.in + len;
            CS.timeline.repaintClipEl(clip);
            CS.player.syncElements();
            CS.player.render();
            return;
        }

        case "slide": {
            //The clip moves; the previous clip's tail and the next clip's
            //head absorb the change so the sequence length is unchanged
            var lo = d.prev ? -((d.prev.origOut - d.prev.origIn) / CS.clipSpeed(d.prev.clip) - minDur) : -d.origStart;
            var hi = d.next ? (d.next.origOut - d.next.origIn) / CS.clipSpeed(d.next.clip) - minDur : 1e9;
            if (d.prev && CS.timeline.sourceLength(d.prev.clip) !== Infinity) {
                hi = Math.min(hi, (CS.timeline.sourceLength(d.prev.clip) - d.prev.origOut) / CS.clipSpeed(d.prev.clip));
            }
            if (d.next && CS.timeline.sourceLength(d.next.clip) !== Infinity) {
                lo = Math.max(lo, -d.next.origIn / CS.clipSpeed(d.next.clip));
            }
            //Without an adjacent neighbour the clip may only travel inside the gap
            if (!d.prev || CS.clipEnd(d.prev.clip) < d.origStart - 0.0001) {
                var prevEnd = d.prev ? CS.clipEnd(d.prev.clip) : 0;
                lo = Math.max(lo, prevEnd - d.origStart);
            }
            if (!d.next || d.next.origStart > d.origStart + (d.origOut - d.origIn) / v + 0.0001) {
                var nextStart = d.next ? d.next.origStart : 1e9;
                hi = Math.min(hi, nextStart - (d.origStart + (d.origOut - d.origIn) / v));
            }
            var sdt = CS.clamp(dt, lo, hi);
            clip.start = d.origStart + sdt;
            if (d.prev && Math.abs(CS.clipEnd({ start: d.prev.origStart, in: d.prev.origIn, out: d.prev.origOut, props: d.prev.clip.props }) - d.origStart) < 0.0001) {
                d.prev.clip.out = d.prev.origOut + sdt * CS.clipSpeed(d.prev.clip);
                CS.timeline.repaintClipEl(d.prev.clip);
            }
            if (d.next && Math.abs(d.next.origStart - (d.origStart + (d.origOut - d.origIn) / v)) < 0.0001) {
                var vn = CS.clipSpeed(d.next.clip);
                d.next.clip.start = d.next.origStart + sdt;
                if (CS.timeline.sourceLength(d.next.clip) === Infinity) {
                    d.next.clip.in = 0;
                    d.next.clip.out = (d.next.origOut - d.next.origIn) - sdt;
                } else {
                    d.next.clip.in = d.next.origIn + sdt * vn;
                }
                CS.timeline.repaintClipEl(d.next.clip);
            }
            break;
        }

        case "rate-r":
        case "rate-l": {
            //Rate stretch: the content stays, the duration changes the speed
            if (isImage) { return; }
            var srcLen = d.origOut - d.origIn;
            var origDur = srcLen / d.origSpeed;
            var newDur = d.mode === "rate-r" ? origDur + dt : origDur - dt;
            var limit = d.mode === "rate-r"
                ? (d.next ? d.next.origStart - d.origStart : 1e9)
                : (d.origStart + origDur) - (d.prev ? CS.clipEnd(d.prev.clip) : 0);
            newDur = CS.clamp(newDur, Math.max(minDur, srcLen / 8), Math.min(limit, srcLen / 0.1));
            clip.props.speed = srcLen / newDur;
            if (d.mode === "rate-l") { clip.start = d.origStart + origDur - newDur; }
            break;
        }
        }

        CS.timeline.repaintClipEl(clip);
    },

    //Move every clip after the dragged one on its track by dt (ripple)
    shiftLater: function (d, dt) {
        d.later.forEach(function (l) {
            l.clip.start = Math.max(0, l.origStart + dt);
            CS.timeline.repaintClipEl(l.clip);
        });
    },

    dragMove: function (d, ev, dt, media) {
        var clip = d.clip;
        var target = Math.max(0, d.origStart + dt);
        target = CS.timeline.applySnap(target, clip, "start");
        clip.start = target;

        //Group move: apply the (snapped) primary delta to every member
        var appliedDt = clip.start - d.origStart;
        d.group.forEach(function (g) {
            if (g.clip.id === clip.id) { return; }
            g.clip.start = Math.max(0, g.origStart + appliedDt);
            var gel = document.querySelector('.tl-clip[data-clip-id="' + g.clip.id + '"]');
            if (gel) { gel.style.left = (g.clip.start * CS.state.zoom) + "px"; }
        });

        //Vertical: move across compatible tracks (single-clip drags only)
        var isAudioClip = media && media.type === "audio";
        var lane = CS.timeline.laneUnderPointer(ev.clientY);
        d.newTrackKind = null;
        if (d.group.length > 1) {
            //group drags stay on their own tracks
        } else if (lane) {
            var track = CS.getTrack(lane.dataset.trackId);
            var kindOk = track && ((track.kind === "audio") === isAudioClip) && !track.locked;
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
    },

    onDragEnd: function () {
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
        var labels = {
            move: "Move Clip", "trim-l": "Trim Clip", "trim-r": "Trim Clip",
            "ripple-l": "Ripple Trim", "ripple-r": "Ripple Trim",
            "roll-l": "Rolling Edit", "roll-r": "Rolling Edit",
            slip: "Slip Clip", slide: "Slide Clip", "rate-l": "Rate Stretch", "rate-r": "Rate Stretch"
        };
        if (d.mode === "move") {
            if (d.newTrackKind && d.group.length === 1) {
                clip.trackId = CS.createTrack(d.newTrackKind);
            }
            //Settle every group member without overlaps, left to right
            d.group.slice().sort(function (a, b) { return a.clip.start - b.clip.start; })
                .forEach(function (g) {
                    g.clip.start = CS.timeline.resolveOverlap(g.clip, g.clip.trackId, g.clip.start);
                });
        } else if (d.mode === "trim-l" || d.mode === "trim-r" || d.mode === "rate-l" || d.mode === "rate-r") {
            //Trimming may have created an overlap with the next clip: clamp
            CS.timeline.clampTrimOverlap(clip);
        }
        CS.commit(labels[d.mode] || "Edit Clip");
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
        if (CS.state.inPoint !== null && CS.state.inPoint !== undefined) { pts.push(CS.state.inPoint); }
        if (CS.state.outPoint !== null && CS.state.outPoint !== undefined) { pts.push(CS.state.outPoint); }
        CS.project.clips.forEach(function (c) {
            if (excludeClip && c.id === excludeClip.id) { return; }
            pts.push(c.start);
            pts.push(CS.clipEnd(c));
        });
        (CS.project.markers || []).forEach(function (m) { pts.push(m.time); });
        return pts;
    },

    //Snap the candidate time (for the given clip edge) to nearby targets
    applySnap: function (time, clip, edge) {
        if (!CS.state.snap) { CS.timeline.hideSnapGuide(); return time; }
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
        var v = CS.clipSpeed(clip);
        var others = CS.clipsOnTrack(clip.trackId).filter(function (c) { return c.id !== clip.id; });
        others.forEach(function (o) {
            //clip's tail overlaps o's head
            if (clip.start < o.start && CS.clipEnd(clip) > o.start) {
                clip.out = clip.in + (o.start - clip.start) * v;
            }
            //clip's head overlaps o's tail
            if (clip.start >= o.start && clip.start < CS.clipEnd(o)) {
                var shift = CS.clipEnd(o) - clip.start;
                clip.start += shift;
                clip.in += shift * v;
                if (clip.out - clip.in < CS.timeline.MIN_CLIP_DUR * v) {
                    clip.out = clip.in + CS.timeline.MIN_CLIP_DUR * v;
                }
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
            if (track.locked) { CS.toast("Track is locked", true); return; }
            var mediaId = ev.dataTransfer.getData("cinestudio/media");
            var t = CS.timeline.timeAtClientX(ev.clientX);

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

    /* ---------- ruler, in / out range, playhead ---------- */

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

        //In / out range: shaded band along the ruler
        var inP = CS.state.inPoint, outP = CS.state.outPoint;
        if (inP !== null && inP !== undefined || outP !== null && outP !== undefined) {
            var x0 = (inP === null || inP === undefined) ? 0 : inP * zoom - scrollLeft;
            var x1 = (outP === null || outP === undefined) ? w : outP * zoom - scrollLeft;
            ctx.fillStyle = "rgba(46, 124, 246, 0.22)";
            ctx.fillRect(x0, 0, Math.max(0, x1 - x0), h - 1);
            ctx.fillStyle = "#2e7cf6";
            if (inP !== null && inP !== undefined) { ctx.fillRect(x0, 0, 2, h - 1); }
            if (outP !== null && outP !== undefined) { ctx.fillRect(x1 - 2, 0, 2, h - 1); }
        }

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
        //timeline markers: coloured flags pinned to the bottom of the ruler;
        //a marker with a duration shows as a bar
        (CS.project.markers || []).forEach(function (m) {
            var mx = m.time * zoom - scrollLeft;
            if (mx < -8 || mx > w + 8) { return; }
            ctx.fillStyle = m.color || "#f6c945";
            if (m.duration) {
                ctx.globalAlpha = 0.45;
                ctx.fillRect(mx, h - 9, m.duration * zoom, 8);
                ctx.globalAlpha = 1;
            }
            ctx.beginPath();
            ctx.moveTo(mx, h - 1);
            ctx.lineTo(mx - 5, h - 9);
            ctx.lineTo(mx + 5, h - 9);
            ctx.closePath();
            ctx.fill();
            if (m.name) {
                ctx.fillStyle = m.color || "#f6c945";
                ctx.font = "9.5px system-ui, sans-serif";
                ctx.fillText(m.name, mx + 8, h - 5);
                ctx.font = "10.5px ui-monospace, SFMono-Regular, Menlo, monospace";
            }
        });

        //bottom hairline
        ctx.fillStyle = "#1c1c22";
        ctx.fillRect(0, h - 1, w, 1);
    },

    //Shade the in / out range over the lanes as well
    updateRange: function () {
        var band = document.getElementById("tl-range");
        if (!band) {
            band = document.createElement("div");
            band.id = "tl-range";
            band.className = "tl-range";
            document.getElementById("tl-content").appendChild(band);
        }
        var inP = CS.state.inPoint, outP = CS.state.outPoint;
        var has = (inP !== null && inP !== undefined) || (outP !== null && outP !== undefined);
        if (!has) { band.style.display = "none"; return; }
        var x0 = (inP === null || inP === undefined) ? 0 : inP * CS.state.zoom;
        var x1 = (outP === null || outP === undefined) ? CS.timeline.contentWidth() : outP * CS.state.zoom;
        band.style.display = "block";
        band.style.left = x0 + "px";
        band.style.width = Math.max(0, x1 - x0) + "px";
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
