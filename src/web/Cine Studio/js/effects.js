/*
    Cine Studio - clip effects

    Each clip carries an ordered effect stack in clip.props.effects
    ([{type, amount}]). Effects are applied by the compositor so they
    show identically in the preview and in exports:

      - filter kind:   folded into the canvas ctx.filter string
      - pixelate:      source downscaled then upscaled without smoothing
      - mirror:        horizontal flip inside the clip transform
      - vignette/grain: full-frame overlays drawn after the clip
      - fade:          time-based alpha ramp (also drives audio volume
                       ramps for clips on audio tracks)
      - audiogain:     time-based volume ramp only (Fade To); shapes the
                       clip volume and never touches the picture

    Most effects carry a single "amount". A definition may instead declare a
    `params` list, in which case the instance stores one value per parameter
    key (Fade To keeps {from, to}).
*/
"use strict";

window.CS = window.CS || {};

CS.effects = {

    registry: [
        { type: "bw",       name: "Black & White", kind: "filter", min: 0, max: 100, def: 100, unit: "%", step: 1,
          make: function (v) { return "grayscale(" + (v / 100) + ")"; }, preview: "grayscale(1)" },
        { type: "sepia",    name: "Sepia", kind: "filter", min: 0, max: 100, def: 100, unit: "%", step: 1,
          make: function (v) { return "sepia(" + (v / 100) + ")"; }, preview: "sepia(1)" },
        { type: "invert",   name: "Invert", kind: "filter", min: 0, max: 100, def: 100, unit: "%", step: 1,
          make: function (v) { return "invert(" + (v / 100) + ")"; }, preview: "invert(1)" },
        { type: "hue",      name: "Hue Shift", kind: "filter", min: -180, max: 180, def: 120, unit: "deg", step: 1,
          make: function (v) { return "hue-rotate(" + v + "deg)"; }, preview: "hue-rotate(120deg)" },
        { type: "blur",     name: "Blur", kind: "filter", min: 0, max: 20, def: 6, unit: "px", step: 0.5,
          make: function (v, scale) { return "blur(" + (v * scale).toFixed(2) + "px)"; }, preview: "blur(2px)" },
        { type: "pixelate", name: "Pixelate", kind: "pixelate", min: 2, max: 64, def: 12, unit: "px", step: 1 },
        { type: "mirror",   name: "Mirror", kind: "mirror", noParam: true },
        { type: "vignette", name: "Vignette", kind: "vignette", min: 0, max: 100, def: 60, unit: "%", step: 1 },
        { type: "grain",    name: "Film Grain", kind: "grain", min: 0, max: 100, def: 40, unit: "%", step: 1 },
        { type: "fadein",   name: "Fade In", kind: "fade", min: 0.1, max: 5, def: 1, unit: "s", step: 0.1, audioOk: true },
        { type: "fadeout",  name: "Fade Out", kind: "fade", min: 0.1, max: 5, def: 1, unit: "s", step: 0.1, audioOk: true },
        { type: "fadeto",   name: "Fade To", kind: "audiogain", audioOk: true, audioOnly: true,
          params: [
              { key: "from", name: "Start", min: 0, max: 200, def: 100, unit: "%", step: 1 },
              { key: "to",   name: "End",   min: 0, max: 200, def: 0,   unit: "%", step: 1 }
          ] }
    ],

    get: function (type) {
        for (var i = 0; i < CS.effects.registry.length; i++) {
            if (CS.effects.registry[i].type === type) { return CS.effects.registry[i]; }
        }
        return null;
    },

    //Default instance payload for a definition: {amount} or one key per param
    defaultInstance: function (def) {
        var inst = { type: def.type };
        if (def.params) {
            def.params.forEach(function (prm) { inst[prm.key] = prm.def; });
        } else {
            inst.amount = def.noParam ? undefined : def.def;
        }
        return inst;
    },

    //Value of one parameter of an effect instance, falling back to its default
    paramValue: function (inst, prm) {
        var v = inst[prm.key];
        return (v === undefined || v === null || isNaN(v)) ? prm.def : v;
    },

    clipHas: function (clip, type) {
        var list = (clip.props && clip.props.effects) || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].type === type) { return list[i]; }
        }
        return null;
    },

    /* ---------- apply / remove ---------- */

    applyToSelected: function (type) {
        var clip = CS.selectedClip();
        if (!clip) { CS.toast("Select a clip on the timeline first"); return; }
        CS.effects.applyToClip(clip, type);
    },

    applyToClip: function (clip, type) {
        var def = CS.effects.get(type);
        if (!def) { return; }
        var track = CS.getTrack(clip.trackId);
        if (track && track.kind === "audio" && !def.audioOk) {
            CS.toast("Only fades apply to audio clips", true);
            return;
        }
        if (def.audioOnly && !CS.effects.clipHasAudio(clip)) {
            CS.toast(def.name + " needs a clip that carries audio", true);
            return;
        }
        if (!clip.props.effects) { clip.props.effects = []; }
        var fresh = CS.effects.defaultInstance(def);
        var existing = CS.effects.clipHas(clip, type);
        if (existing) {
            Object.keys(fresh).forEach(function (k) {
                if (k !== "type") { existing[k] = fresh[k]; }
            });
            CS.commit("Update Effect");
            CS.toast(def.name + " updated");
        } else {
            clip.props.effects.push(fresh);
            CS.commit("Add Effect");
            CS.toast(def.name + " applied");
        }
        CS.panels.refresh();
    },

    removeFromClip: function (clip, type) {
        clip.props.effects = (clip.props.effects || []).filter(function (e) { return e.type !== type; });
        CS.commit("Remove Effect");
        CS.panels.refresh();
    },

    /* ---------- render-time evaluation ---------- */

    //Whether the clip carries audio at all (titles, colors and stills do not)
    clipHasAudio: function (clip) {
        if (clip.kind === "title" || clip.kind === "color") { return false; }
        var media = CS.getMedia(clip.mediaId);
        return !!(media && (media.type === "audio" || media.type === "video"));
    },

    //Product of the fade-in / fade-out ramps at time t (1 when no fades)
    fadeAlpha: function (clip, t) {
        var a = 1;
        var list = (clip.props && clip.props.effects) || [];
        for (var i = 0; i < list.length; i++) {
            var e = list[i];
            if (e.type === "fadein") {
                a *= CS.clamp((t - clip.start) / Math.max(0.05, e.amount), 0, 1);
            } else if (e.type === "fadeout") {
                a *= CS.clamp((CS.clipEnd(clip) - t) / Math.max(0.05, e.amount), 0, 1);
            }
        }
        return a;
    },

    //Volume multiplier of the Fade To ramps at time t: the level travels
    //linearly from the start volume to the end volume across the whole clip
    fadeToGain: function (clip, t) {
        var g = 1;
        var list = (clip.props && clip.props.effects) || [];
        var def = CS.effects.get("fadeto");
        for (var i = 0; i < list.length; i++) {
            if (list[i].type !== "fadeto") { continue; }
            var from = CS.effects.paramValue(list[i], def.params[0]) / 100;
            var to = CS.effects.paramValue(list[i], def.params[1]) / 100;
            var dur = Math.max(0.05, CS.clipDuration(clip));
            var k = CS.clamp((t - clip.start) / dur, 0, 1);
            g *= from + (to - from) * k;
        }
        return Math.max(0, g);
    },

    //Everything that shapes the clip volume at time t: fades plus Fade To
    audioGain: function (clip, t) {
        return CS.effects.fadeAlpha(clip, t) * CS.effects.fadeToGain(clip, t);
    },

    //Summarize the effect stack for the compositor
    analyze: function (clip, t, W) {
        var res = { filter: "", alpha: 1, mirror: false, pixelate: 0, vignette: 0, grain: 0 };
        var list = (clip.props && clip.props.effects) || [];
        if (!list.length) { return res; }
        var scale = (W || 1920) / 1920;
        for (var i = 0; i < list.length; i++) {
            var e = list[i];
            var def = CS.effects.get(e.type);
            if (!def) { continue; }
            if (def.kind === "filter") {
                res.filter += " " + def.make(e.amount, scale);
            } else if (def.kind === "pixelate") {
                res.pixelate = e.amount;
            } else if (def.kind === "mirror") {
                res.mirror = true;
            } else if (def.kind === "vignette") {
                res.vignette = e.amount / 100;
            } else if (def.kind === "grain") {
                res.grain = e.amount / 100;
            }
        }
        res.alpha = CS.effects.fadeAlpha(clip, t);
        return res;
    },

    //Downscale the source into a reusable scratch canvas for pixelation
    _scratch: null,
    //rect (optional) limits the pixelation to a sub-rectangle of the source, so
    //an edge-cropped clip only pixelates the part that is actually drawn
    pixelateSource: function (src, sw, sh, block, rect) {
        rect = rect || { x: 0, y: 0, w: sw, h: sh };
        if (!CS.effects._scratch) { CS.effects._scratch = document.createElement("canvas"); }
        var c = CS.effects._scratch;
        var tw = Math.max(1, Math.round(rect.w / block));
        var th = Math.max(1, Math.round(rect.h / block));
        if (c.width !== tw || c.height !== th) { c.width = tw; c.height = th; }
        var ctx = c.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.clearRect(0, 0, tw, th);
        ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, tw, th);
        return c;
    },

    _vigCache: null,
    drawVignette: function (ctx, W, H, amount) {
        var key = W + "x" + H;
        if (!CS.effects._vigCache || CS.effects._vigCache.key !== key) {
            var g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
            g.addColorStop(0, "rgba(0,0,0,0)");
            g.addColorStop(1, "rgba(0,0,0,1)");
            CS.effects._vigCache = { key: key, gradient: g };
        }
        ctx.save();
        ctx.globalAlpha = amount;
        ctx.fillStyle = CS.effects._vigCache.gradient;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
    },

    _grainTiles: null,
    _grainTick: 0,
    drawGrain: function (ctx, W, H, amount) {
        if (!CS.effects._grainTiles) {
            CS.effects._grainTiles = [];
            for (var n = 0; n < 3; n++) {
                var tile = document.createElement("canvas");
                tile.width = 256;
                tile.height = 256;
                var tctx = tile.getContext("2d");
                var img = tctx.createImageData(256, 256);
                for (var i = 0; i < img.data.length; i += 4) {
                    var v = Math.floor(Math.random() * 255);
                    img.data[i] = v;
                    img.data[i + 1] = v;
                    img.data[i + 2] = v;
                    img.data[i + 3] = 255;
                }
                tctx.putImageData(img, 0, 0);
                CS.effects._grainTiles.push(tile);
            }
        }
        CS.effects._grainTick++;
        var t = CS.effects._grainTiles[CS.effects._grainTick % 3];
        ctx.save();
        ctx.globalAlpha = amount * 0.28;
        ctx.globalCompositeOperation = "overlay";
        ctx.fillStyle = ctx.createPattern(t, "repeat");
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
    },

    /* ---------- gallery panel ---------- */

    _galleryBuilt: false,
    renderGallery: function () {
        if (CS.effects._galleryBuilt) { CS.effects.refreshApplied(); return; }
        CS.effects._galleryBuilt = true;
        var grid = document.getElementById("fx-grid");
        grid.innerHTML = "";
        CS.effects.registry.forEach(function (def) {
            var card = document.createElement("div");
            card.className = "fx-card";
            card.dataset.fxType = def.type;

            var thumb = document.createElement("div");
            thumb.className = "fx-thumb";
            thumb.appendChild(CS.effects.previewCanvas(def));

            var name = document.createElement("div");
            name.className = "fx-name";
            name.textContent = def.name;

            card.appendChild(thumb);
            card.appendChild(name);
            card.addEventListener("click", function () {
                CS.effects.applyToSelected(def.type);
            });
            grid.appendChild(card);
        });
        CS.effects.refreshApplied();
    },

    refreshApplied: function () {
        var clip = CS.selectedClip();
        var cards = document.querySelectorAll("#fx-grid .fx-card");
        for (var i = 0; i < cards.length; i++) {
            var has = clip && !!CS.effects.clipHas(clip, cards[i].dataset.fxType);
            cards[i].classList.toggle("applied", has);
        }
    },

    //Small demo scene with the effect applied, used as the gallery preview
    previewCanvas: function (def) {
        var c = document.createElement("canvas");
        c.width = 150;
        c.height = 94;
        var ctx = c.getContext("2d");

        if (def.kind === "pixelate") {
            var base = CS.effects.baseScene(150, 94);
            var small = document.createElement("canvas");
            small.width = 15;
            small.height = 10;
            small.getContext("2d").drawImage(base, 0, 0, 15, 10);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(small, 0, 0, 150, 94);
            return c;
        }

        ctx.save();
        if (def.kind === "mirror") {
            ctx.translate(150, 0);
            ctx.scale(-1, 1);
        }
        if (def.kind === "filter" && def.preview && ctx.filter !== undefined) {
            ctx.filter = def.preview;
        }
        ctx.drawImage(CS.effects.baseScene(150, 94), 0, 0);
        ctx.restore();

        if (def.kind === "vignette") { CS.effects.drawVignette(ctx, 150, 94, 0.85); CS.effects._vigCache = null; }
        if (def.kind === "grain") { CS.effects.drawGrain(ctx, 150, 94, 1); }
        if (def.kind === "audiogain") {
            //Level ramp drawn as a wedge: loud on the left, quiet on the right
            ctx.fillStyle = "rgba(46, 124, 246, 0.65)";
            ctx.beginPath();
            ctx.moveTo(6, 88);
            ctx.lineTo(144, 88);
            ctx.lineTo(6, 14);
            ctx.closePath();
            ctx.fill();
        }
        if (def.kind === "fade") {
            var g = ctx.createLinearGradient(0, 0, 150, 0);
            if (def.type === "fadein") {
                g.addColorStop(0, "rgba(0,0,0,1)");
                g.addColorStop(0.9, "rgba(0,0,0,0)");
            } else {
                g.addColorStop(0.1, "rgba(0,0,0,0)");
                g.addColorStop(1, "rgba(0,0,0,1)");
            }
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, 150, 94);
        }
        return c;
    },

    _baseScene: null,
    baseScene: function (w, h) {
        if (CS.effects._baseScene) { return CS.effects._baseScene; }
        var c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        var ctx = c.getContext("2d");
        var g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, "#7fb2d9");
        g.addColorStop(0.6, "#c97b3a");
        g.addColorStop(1, "#5c3a1e");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        //sun
        ctx.fillStyle = "#ffe9b0";
        ctx.beginPath();
        ctx.arc(w * 0.68, h * 0.34, h * 0.14, 0, Math.PI * 2);
        ctx.fill();
        //hills
        ctx.fillStyle = "rgba(20,30,40,0.75)";
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (var x = 0; x <= w; x += 6) {
            ctx.lineTo(x, h * 0.62 + Math.sin(x * 0.06) * h * 0.12);
        }
        ctx.lineTo(w, h);
        ctx.fill();
        CS.effects._baseScene = c;
        return c;
    }
};
