/*
    Cine Studio - generated clips: titles and color boards

    Title clips (clip.kind === "title") and color clips (clip.kind ===
    "color") have no backing media. They render into a cached offscreen
    canvas at project resolution which the compositor then treats as a
    normal frame source, so transforms, color controls, effects and
    transitions all apply to them for free.
*/
"use strict";

window.CS = window.CS || {};

CS.titles = {

    presets: [
        { id: "title",      name: "Title",
          text: { content: "Title", size: 110, color: "#ffffff", bold: true, align: "center", vpos: 0.5, style: "plain" } },
        { id: "subtitle",   name: "Subtitle",
          text: { content: "Subtitle", size: 54, color: "#ffffff", bold: false, align: "center", vpos: 0.72, style: "plain" } },
        { id: "lowerthird", name: "Lower Third",
          text: { content: "Lower Third", size: 62, color: "#ffffff", bold: true, align: "left", vpos: 0.84, style: "bar" } },
        { id: "caption",    name: "Caption",
          text: { content: "Caption", size: 44, color: "#ffffff", bold: false, align: "center", vpos: 0.9, style: "box" } }
    ],

    elements: [
        { id: "black",  name: "Black",  c0: "#000000" },
        { id: "white",  name: "White",  c0: "#ffffff" },
        { id: "red",    name: "Red",    c0: "#c62828" },
        { id: "blue",   name: "Blue",   c0: "#1e63c9" },
        { id: "green",  name: "Green",  c0: "#1e8a4c" },
        { id: "violet", name: "Violet", c0: "#6d5ae0" },
        { id: "dusk",   name: "Dusk",   c0: "#2b3a67", c1: "#b56576" },
        { id: "ember",  name: "Ember",  c0: "#1a1a1d", c1: "#c9401e" }
    ],

    /* ---------- insertion ---------- */

    //Find a video track free around the playhead (topmost first) or add one
    pickVideoTrack: function (start, dur) {
        var video = CS.videoTracksInRenderOrder().slice().reverse(); //topmost first
        for (var i = 0; i < video.length; i++) {
            var busy = CS.clipsOnTrack(video[i].id).some(function (c) {
                return start < CS.clipEnd(c) && start + dur > c.start;
            });
            if (!busy) { return video[i].id; }
        }
        //All video tracks busy at the playhead: add a new one on top
        var maxN = 0;
        CS.project.tracks.forEach(function (t) {
            if (t.kind === "video") { maxN = Math.max(maxN, parseInt(t.id.substring(1), 10)); }
        });
        var id = "V" + (maxN + 1);
        CS.project.tracks.push({ id: id, kind: "video", name: "Video " + (maxN + 1), visible: true, muted: false });
        return id;
    },

    insertPreset: function (presetId) {
        var preset = null;
        CS.titles.presets.forEach(function (p) { if (p.id === presetId) { preset = p; } });
        if (!preset) { return; }
        var dur = 4;
        var start = CS.state.playhead;
        var props = CS.defaultClipProps();
        props.text = JSON.parse(JSON.stringify(preset.text));
        var clip = {
            id: CS.uid(),
            mediaId: null,
            kind: "title",
            trackId: CS.titles.pickVideoTrack(start, dur),
            start: start,
            in: 0,
            out: dur,
            props: props
        };
        CS.project.clips.push(clip);
        CS.selectClip(clip.id);
        CS.commit("Add Title");
        CS.toast("Title added - edit the text in the inspector");
    },

    insertElement: function (elId) {
        var el = null;
        CS.titles.elements.forEach(function (e) { if (e.id === elId) { el = e; } });
        if (!el) { return; }
        var dur = 5;
        var start = CS.state.playhead;
        var props = CS.defaultClipProps();
        props.color = { c0: el.c0, c1: el.c1 || "" };
        var clip = {
            id: CS.uid(),
            mediaId: null,
            kind: "color",
            trackId: CS.titles.pickVideoTrack(start, dur),
            start: start,
            in: 0,
            out: dur,
            props: props
        };
        CS.project.clips.push(clip);
        CS.selectClip(clip.id);
        CS.commit("Add Element");
    },

    /* ---------- frame source rendering ---------- */

    //Render (and cache) the clip's generated frame at project resolution.
    //The cache lives outside the clip object so history snapshots and
    //project serialization never see DOM canvases.
    _cache: {},
    renderSource: function (clip, W, H) {
        var key = W + "x" + H + JSON.stringify(clip.props.text || clip.props.color || {});
        var cached = CS.titles._cache[clip.id];
        if (cached && cached.key === key) { return cached.canvas; }
        var c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        var ctx = c.getContext("2d");
        if (clip.kind === "color") {
            CS.titles.drawColor(ctx, clip.props.color, W, H);
        } else {
            CS.titles.drawText(ctx, clip.props.text, W, H);
        }
        CS.titles._cache[clip.id] = { key: key, canvas: c };
        return c;
    },

    drawColor: function (ctx, color, W, H) {
        if (color && color.c1) {
            var g = ctx.createLinearGradient(0, 0, 0, H);
            g.addColorStop(0, color.c0);
            g.addColorStop(1, color.c1);
            ctx.fillStyle = g;
        } else {
            ctx.fillStyle = (color && color.c0) || "#000000";
        }
        ctx.fillRect(0, 0, W, H);
    },

    drawText: function (ctx, text, W, H) {
        text = text || {};
        var size = Math.max(8, (text.size || 80) * (W / 1920));
        var font = (text.bold ? "700 " : "400 ") + size + "px " +
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
        ctx.font = font;
        ctx.textBaseline = "middle";
        var content = (text.content || "").split("\n");
        var lineH = size * 1.25;
        var blockH = lineH * content.length;
        var y0 = H * (text.vpos === undefined ? 0.5 : text.vpos) - blockH / 2 + lineH / 2;
        var pad = size * 0.45;

        content.forEach(function (line, i) {
            var y = y0 + i * lineH;
            var tw = ctx.measureText(line).width;
            var x;
            if (text.align === "left") { x = W * 0.08; ctx.textAlign = "left"; }
            else if (text.align === "right") { x = W * 0.92; ctx.textAlign = "right"; }
            else { x = W / 2; ctx.textAlign = "center"; }

            if (text.style === "bar") {
                var bx = (text.align === "right") ? x - tw - pad : (text.align === "center" ? x - tw / 2 - pad : x - pad);
                ctx.fillStyle = "rgba(20, 20, 26, 0.72)";
                CS.titles.roundRect(ctx, bx, y - lineH / 2, tw + pad * 2, lineH, size * 0.16);
                ctx.fill();
                //accent stripe on the leading edge
                ctx.fillStyle = "#2e7cf6";
                ctx.fillRect(bx, y - lineH / 2, Math.max(3, size * 0.09), lineH);
            } else if (text.style === "box") {
                var bx2 = (text.align === "right") ? x - tw - pad : (text.align === "center" ? x - tw / 2 - pad : x - pad);
                ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
                CS.titles.roundRect(ctx, bx2, y - lineH / 2, tw + pad * 2, lineH, size * 0.2);
                ctx.fill();
            } else {
                ctx.shadowColor = "rgba(0,0,0,0.65)";
                ctx.shadowBlur = size * 0.12;
                ctx.shadowOffsetY = size * 0.03;
            }
            ctx.fillStyle = text.color || "#ffffff";
            ctx.fillText(line, x, y);
            ctx.shadowColor = "transparent";
            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;
        });
    },

    roundRect: function (ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    },

    //Invalidate the cached frame after a text edit
    invalidate: function (clip) {
        delete CS.titles._cache[clip.id];
        CS.player.render();
    },

    /* ---------- inspector text section ---------- */

    buildTextSection: function (body, clip) {
        var text = clip.props.text;
        var sec = CS.inspector.section(body, "Text", function () {
            var preset = CS.titles.presets[0];
            clip.props.text = JSON.parse(JSON.stringify(preset.text));
            CS.titles.invalidate(clip);
            CS.commit("Reset Text");
        });

        var contentIn = document.createElement("input");
        contentIn.type = "text";
        contentIn.value = text.content;
        contentIn.style.cssText = "flex:1;min-width:0;height:26px;padding:0 9px;background:var(--bg-elev);" +
            "border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12.5px;outline:none;";
        contentIn.addEventListener("input", function () {
            text.content = contentIn.value;
            CS.titles.invalidate(clip);
            CS.timeline.render();
        });
        contentIn.addEventListener("change", function () { CS.commit("Edit Title Text"); });
        CS.inspector.row(sec, "Content", [contentIn]);

        CS.inspector.row(sec, "Size", [
            CS.inspector.slider(12, 240, 1, text.size, function (v) { text.size = v; CS.titles.invalidate(clip); }),
            CS.inspector.numChip(null, text.size, "px", function (v) { text.size = CS.clamp(v, 8, 400); CS.titles.invalidate(clip); }, 1)
        ]);

        var colorIn = document.createElement("input");
        colorIn.type = "color";
        colorIn.value = text.color;
        colorIn.style.cssText = "width:34px;height:24px;padding:0;border:1px solid var(--border);" +
            "border-radius:6px;background:var(--bg-elev);cursor:pointer;";
        colorIn.addEventListener("input", function () {
            text.color = colorIn.value;
            CS.titles.invalidate(clip);
        });
        colorIn.addEventListener("change", function () { CS.commit("Title Color"); });
        CS.inspector.row(sec, "Color", [colorIn,
            CS.inspector.select([
                { v: "false", l: "Regular" },
                { v: "true", l: "Bold" }
            ], String(!!text.bold), function (v) {
                text.bold = (v === "true");
                CS.titles.invalidate(clip);
                CS.commit("Title Weight");
            })
        ]);

        CS.inspector.row(sec, "Align", [
            CS.inspector.select([
                { v: "left", l: "Left" },
                { v: "center", l: "Center" },
                { v: "right", l: "Right" }
            ], text.align || "center", function (v) {
                text.align = v;
                CS.titles.invalidate(clip);
                CS.commit("Title Align");
            })
        ]);

        CS.inspector.row(sec, "Vertical", [
            CS.inspector.slider(0, 100, 1, Math.round((text.vpos === undefined ? 0.5 : text.vpos) * 100), function (v) {
                text.vpos = v / 100;
                CS.titles.invalidate(clip);
            }),
            CS.inspector.numChip(null, Math.round((text.vpos === undefined ? 0.5 : text.vpos) * 100), "%", function (v) {
                text.vpos = CS.clamp(v, 0, 100) / 100;
                CS.titles.invalidate(clip);
            }, 1)
        ]);

        CS.inspector.row(sec, "Style", [
            CS.inspector.select([
                { v: "plain", l: "Plain" },
                { v: "bar", l: "Lower-third bar" },
                { v: "box", l: "Caption box" }
            ], text.style || "plain", function (v) {
                text.style = v;
                CS.titles.invalidate(clip);
                CS.commit("Title Style");
            })
        ]);
    },

    /* ---------- gallery panels ---------- */

    _panelBuilt: false,
    renderPanel: function () {
        if (CS.titles._panelBuilt) { return; }
        CS.titles._panelBuilt = true;
        var grid = document.getElementById("titles-grid");
        grid.innerHTML = "";
        CS.titles.presets.forEach(function (p) {
            var card = document.createElement("div");
            card.className = "fx-card";
            var thumb = document.createElement("div");
            thumb.className = "fx-thumb";
            var c = document.createElement("canvas");
            c.width = 300;
            c.height = 188;
            var ctx = c.getContext("2d");
            ctx.fillStyle = "#101016";
            ctx.fillRect(0, 0, 300, 188);
            var demo = JSON.parse(JSON.stringify(p.text));
            demo.size = demo.size * 1.6;
            CS.titles.drawText(ctx, demo, 300, 188);
            thumb.appendChild(c);
            var name = document.createElement("div");
            name.className = "fx-name";
            name.textContent = p.name;
            card.appendChild(thumb);
            card.appendChild(name);
            card.addEventListener("click", function () { CS.titles.insertPreset(p.id); });
            grid.appendChild(card);
        });
    },

    _elementsBuilt: false,
    renderElementsPanel: function () {
        if (CS.titles._elementsBuilt) { return; }
        CS.titles._elementsBuilt = true;
        var grid = document.getElementById("elements-grid");
        grid.innerHTML = "";
        CS.titles.elements.forEach(function (e) {
            var card = document.createElement("div");
            card.className = "fx-card";
            var thumb = document.createElement("div");
            thumb.className = "fx-thumb";
            thumb.style.background = e.c1
                ? "linear-gradient(180deg, " + e.c0 + ", " + e.c1 + ")"
                : e.c0;
            if (e.id === "white") { thumb.style.borderColor = "#3a3a44"; }
            var name = document.createElement("div");
            name.className = "fx-name";
            name.textContent = e.name;
            card.appendChild(thumb);
            card.appendChild(name);
            card.addEventListener("click", function () { CS.titles.insertElement(e.id); });
            grid.appendChild(card);
        });
    }
};
