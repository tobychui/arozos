/*
    Cine Studio - direct manipulation on the preview

    An overlay canvas on top of the preview lets the user click a clip
    to select it, drag it to reposition (props.x / props.y) and pull a
    corner handle to scale it (props.scale). Works for video, image,
    title and color clips on video tracks; rotation aware.
*/
"use strict";

window.CS = window.CS || {};

CS.previewctl = {
    overlay: null,
    ctx: null,
    drag: null,
    HANDLE_R: 7,        //handle hit radius in display px

    init: function () {
        CS.previewctl.overlay = document.getElementById("preview-overlay");
        CS.previewctl.ctx = CS.previewctl.overlay.getContext("2d");
        var ov = CS.previewctl.overlay;
        ov.addEventListener("pointerdown", CS.previewctl.onDown);
        ov.addEventListener("pointermove", CS.previewctl.onHover);
        window.addEventListener("resize", CS.previewctl.redraw);
    },

    /* ---------- geometry ---------- */

    //Display px per project px (the canvas is CSS-scaled to fit the stage)
    displayScale: function () {
        var canvas = CS.player.canvas;
        var rect = canvas.getBoundingClientRect();
        return rect.width / CS.project.settings.width;
    },

    toProject: function (ev) {
        var rect = CS.player.canvas.getBoundingClientRect();
        var s = rect.width / CS.project.settings.width;
        return {
            x: (ev.clientX - rect.left) / s,
            y: (ev.clientY - rect.top) / s
        };
    },

    //Source dimensions for a clip's frame (project coords, before transform)
    sourceDims: function (clip) {
        var W = CS.project.settings.width;
        var H = CS.project.settings.height;
        if (clip.kind === "title" || clip.kind === "color") { return { sw: W, sh: H }; }
        var media = CS.getMedia(clip.mediaId);
        if (!media || !media.width || !media.height) { return null; }
        return { sw: media.width, sh: media.height };
    },

    //Bounding box {cx, cy, w, h, rot} of the clip in project coordinates,
    //mirroring the drawClip crop / scale math
    clipBox: function (clip) {
        var dims = CS.previewctl.sourceDims(clip);
        if (!dims) { return null; }
        var W = CS.project.settings.width;
        var H = CS.project.settings.height;
        var p = clip.props;
        var dw, dh;
        if (p.crop === "stretch") {
            dw = W;
            dh = H;
        } else {
            var s = (p.crop === "fill")
                ? Math.max(W / dims.sw, H / dims.sh)
                : Math.min(W / dims.sw, H / dims.sh);
            dw = dims.sw * s;
            dh = dims.sh * s;
        }
        var userScale = (p.scale === undefined ? 100 : p.scale) / 100;
        return {
            cx: W / 2 + (p.x || 0),
            cy: H / 2 + (p.y || 0),
            w: dw * userScale,
            h: dh * userScale,
            rot: (p.rotation || 0) * Math.PI / 180
        };
    },

    corners: function (box) {
        var cos = Math.cos(box.rot), sin = Math.sin(box.rot);
        var hw = box.w / 2, hh = box.h / 2;
        return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(function (c) {
            return {
                x: box.cx + c[0] * cos - c[1] * sin,
                y: box.cy + c[0] * sin + c[1] * cos
            };
        });
    },

    insideBox: function (box, x, y) {
        var dx = x - box.cx, dy = y - box.cy;
        var cos = Math.cos(-box.rot), sin = Math.sin(-box.rot);
        var lx = dx * cos - dy * sin;
        var ly = dx * sin + dy * cos;
        return Math.abs(lx) <= box.w / 2 && Math.abs(ly) <= box.h / 2;
    },

    //Corner handle index under the pointer (project coords), or -1
    handleAt: function (box, x, y) {
        var r = CS.previewctl.HANDLE_R / CS.previewctl.displayScale();
        var pts = CS.previewctl.corners(box);
        for (var i = 0; i < pts.length; i++) {
            if (Math.hypot(pts[i].x - x, pts[i].y - y) <= r * 1.6) { return i; }
        }
        return -1;
    },

    //Clip on a video track that is visible at the playhead and whose box
    //contains the point; topmost track wins
    topClipAt: function (x, y) {
        var t = CS.state.playhead;
        var tracks = CS.videoTracksInRenderOrder().slice().reverse();
        for (var i = 0; i < tracks.length; i++) {
            if (!tracks[i].visible) { continue; }
            var clips = CS.clipsOnTrack(tracks[i].id);
            for (var j = 0; j < clips.length; j++) {
                if (!CS.player.activeAt(clips[j], t)) { continue; }
                var box = CS.previewctl.clipBox(clips[j]);
                if (box && CS.previewctl.insideBox(box, x, y)) { return clips[j]; }
            }
        }
        return null;
    },

    //The selected clip, when it is manipulable on the preview right now
    activeSelection: function () {
        var clip = CS.selectedClip();
        if (!clip) { return null; }
        var track = CS.getTrack(clip.trackId);
        if (!track || track.kind !== "video" || !track.visible) { return null; }
        if (!CS.player.activeAt(clip, CS.state.playhead)) { return null; }
        return clip;
    },

    /* ---------- pointer interaction ---------- */

    onDown: function (ev) {
        if (ev.button !== 0) { return; }
        var pos = CS.previewctl.toProject(ev);
        var clip = CS.previewctl.activeSelection();
        var mode = null;

        if (clip) {
            var box = CS.previewctl.clipBox(clip);
            var h = box ? CS.previewctl.handleAt(box, pos.x, pos.y) : -1;
            if (h >= 0) { mode = "resize"; }
            else if (box && CS.previewctl.insideBox(box, pos.x, pos.y)) { mode = "move"; }
        }
        if (!mode) {
            var hit = CS.previewctl.topClipAt(pos.x, pos.y);
            if (hit) {
                CS.selectClip(hit.id);
                clip = hit;
                mode = "move";
            } else {
                CS.selectClip(null);
                return;
            }
        }

        CS.player.pause();
        var box0 = CS.previewctl.clipBox(clip);
        CS.previewctl.drag = {
            mode: mode,
            clip: clip,
            startPos: pos,
            origX: clip.props.x || 0,
            origY: clip.props.y || 0,
            origScale: clip.props.scale === undefined ? 100 : clip.props.scale,
            origDist: Math.max(4, Math.hypot(pos.x - box0.cx, pos.y - box0.cy)),
            moved: false
        };
        var ov = CS.previewctl.overlay;
        ov.setPointerCapture(ev.pointerId);
        ov.onpointermove = CS.previewctl.onDrag;
        ov.onpointerup = CS.previewctl.onUp;
        ev.preventDefault();
    },

    onDrag: function (ev) {
        var d = CS.previewctl.drag;
        if (!d) { return; }
        var pos = CS.previewctl.toProject(ev);
        var dx = pos.x - d.startPos.x;
        var dy = pos.y - d.startPos.y;
        if (!d.moved && Math.hypot(dx, dy) < 2 / CS.previewctl.displayScale()) { return; }
        d.moved = true;

        if (d.mode === "move") {
            d.clip.props.x = Math.round(d.origX + dx);
            d.clip.props.y = Math.round(d.origY + dy);
        } else {
            //uniform scale around the clip center, rotation independent
            var box = CS.previewctl.clipBox(d.clip);
            var dist = Math.hypot(pos.x - box.cx, pos.y - box.cy);
            d.clip.props.scale = CS.clamp(Math.round(d.origScale * dist / d.origDist), 1, 1000);
        }
        CS.player.render();
    },

    onUp: function () {
        var d = CS.previewctl.drag;
        var ov = CS.previewctl.overlay;
        ov.onpointermove = null;
        ov.onpointerup = null;
        CS.previewctl.drag = null;
        if (d && d.moved) {
            CS.commit(d.mode === "move" ? "Move in Preview" : "Scale in Preview");
        }
    },

    //Cursor feedback while not dragging
    onHover: function (ev) {
        if (CS.previewctl.drag) { return; }
        var clip = CS.previewctl.activeSelection();
        var cursor = "default";
        if (clip) {
            var pos = CS.previewctl.toProject(ev);
            var box = CS.previewctl.clipBox(clip);
            if (box) {
                if (CS.previewctl.handleAt(box, pos.x, pos.y) >= 0) { cursor = "nwse-resize"; }
                else if (CS.previewctl.insideBox(box, pos.x, pos.y)) { cursor = "move"; }
            }
        }
        CS.previewctl.overlay.style.cursor = cursor;
    },

    /* ---------- overlay drawing ---------- */

    redraw: function () {
        var ov = CS.previewctl.overlay;
        var ctx = CS.previewctl.ctx;
        if (!ov || !ctx || !CS.player.canvas) { return; }
        var rect = CS.player.canvas.getBoundingClientRect();
        var dpr = window.devicePixelRatio || 1;
        var w = Math.max(1, Math.round(rect.width));
        var h = Math.max(1, Math.round(rect.height));
        if (ov.width !== w * dpr || ov.height !== h * dpr) {
            ov.width = w * dpr;
            ov.height = h * dpr;
        }
        ov.style.width = w + "px";
        ov.style.height = h + "px";
        //Anchor the overlay exactly over the (centered) canvas
        var wrapRect = document.getElementById("canvas-wrap").getBoundingClientRect();
        ov.style.left = (rect.left - wrapRect.left) + "px";
        ov.style.top = (rect.top - wrapRect.top) + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        var clip = CS.previewctl.activeSelection();
        if (!clip) { return; }
        var box = CS.previewctl.clipBox(clip);
        if (!box) { return; }
        var s = w / CS.project.settings.width;
        var pts = CS.previewctl.corners(box).map(function (p) {
            return { x: p.x * s, y: p.y * s };
        });

        ctx.strokeStyle = "rgba(46, 124, 246, 0.95)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (var i = 1; i < 4; i++) { ctx.lineTo(pts[i].x, pts[i].y); }
        ctx.closePath();
        ctx.stroke();

        pts.forEach(function (p) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = "#ffffff";
            ctx.fill();
            ctx.strokeStyle = "rgba(0,0,0,0.6)";
            ctx.lineWidth = 1;
            ctx.stroke();
        });
    }
};
