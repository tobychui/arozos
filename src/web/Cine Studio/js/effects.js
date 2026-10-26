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
        { type: "fadeout",  name: "Fade Out", kind: "fade", min: 0.1, max: 5, def: 1, unit: "s", step: 0.1, audioOk: true }
    ],

    get: function (type) {
        for (var i = 0; i < CS.effects.registry.length; i++) {
            if (CS.effects.registry[i].type === type) { return CS.effects.registry[i]; }
        }
        return null;
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
        if (!clip.props.effects) { clip.props.effects = []; }
        var existing = CS.effects.clipHas(clip, type);
        if (existing) {
            existing.amount = def.noParam ? undefined : def.def;
            CS.commit("Update Effect");
            CS.toast(def.name + " updated");
        } else {
            clip.props.effects.push({ type: type, amount: def.noParam ? undefined : def.def });
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
    pixelateSource: function (src, sw, sh, block) {
        if (!CS.effects._scratch) { CS.effects._scratch = document.createElement("canvas"); }
        var c = CS.effects._scratch;
        var tw = Math.max(1, Math.round(sw / block));
        var th = Math.max(1, Math.round(sh / block));
        if (c.width !== tw || c.height !== th) { c.width = tw; c.height = th; }
        var ctx = c.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.clearRect(0, 0, tw, th);
        ctx.drawImage(src, 0, 0, tw, th);
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
