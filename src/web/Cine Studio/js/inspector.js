/*
    Cine Studio - inspector panel

    Property editor for the selected clip: Transform / Crop / Color on
    the Video tab, volume and volume ramps on the Audio tab. Values
    live-update the preview; history is committed when the gesture ends.
*/
"use strict";

window.CS = window.CS || {};

CS.inspector = {
    activeTab: "video",
    _collapsed: {},

    init: function () {
        var tabs = document.querySelectorAll(".itab");
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].addEventListener("click", function () {
                CS.inspector.activeTab = this.getAttribute("data-itab");
                CS.inspector.updateTabs();
                CS.inspector.render();
            });
        }
        document.getElementById("btn-toggle-inspector").addEventListener("click", function () {
            var hidden = document.getElementById("inspector").classList.toggle("hidden");
            this.classList.toggle("active", hidden);
            //The preview canvas is CSS-fitted, so it resizes with the panel:
            //re-anchor the selection overlay onto its new box
            CS.player.applyPreviewZoom();
            //Percentage max-width / max-height on the canvas can settle one
            //layout pass late, so measure again once the reflow is done
            setTimeout(CS.previewctl.redraw, 0);
        });
    },

    updateTabs: function () {
        var tabs = document.querySelectorAll(".itab");
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.toggle("active", tabs[i].getAttribute("data-itab") === CS.inspector.activeTab);
        }
    },

    //Called when the selection changes: pick a sensible tab automatically
    autoTab: function () {
        var clip = CS.selectedClip();
        if (!clip) { return; }
        var track = CS.getTrack(clip.trackId);
        if (track && track.kind === "audio" && CS.inspector.activeTab === "video") {
            CS.inspector.activeTab = "audio";
            CS.inspector.updateTabs();
        }
        if (track && track.kind === "video" && CS.inspector.activeTab === "audio") {
            CS.inspector.activeTab = "video";
            CS.inspector.updateTabs();
        }
    },

    render: function () {
        var body = document.getElementById("inspector-body");
        body.innerHTML = "";
        var clip = CS.selectedClip();

        if (CS.inspector.activeTab === "effects") {
            CS.inspector.renderEffectsTab(body, clip);
            return;
        }
        if (CS.inspector.activeTab === "transition") {
            CS.transitions.renderTab(body, clip);
            CS.applyIcons(body);
            return;
        }

        if (!clip) {
            CS.inspector.placeholder(body, "Select a clip on the timeline to edit its properties.");
            return;
        }
        var track = CS.getTrack(clip.trackId);
        var media = CS.getMedia(clip.mediaId);

        if (CS.inspector.activeTab === "audio") {
            CS.inspector.renderAudioTab(body, clip, media, track);
            return;
        }

        if (track && track.kind === "audio") {
            CS.inspector.placeholder(body, "This is an audio clip. Use the Audio tab to adjust it.");
            return;
        }

        CS.inspector.renderVideoTab(body, clip);
    },

    placeholder: function (body, text) {
        var el = document.createElement("div");
        el.className = "insp-placeholder";
        el.textContent = text;
        body.appendChild(el);
    },

    /* ---------- video tab ---------- */

    renderVideoTab: function (body, clip) {
        var p = clip.props;

        //---- Text (title clips only) ----
        if (clip.kind === "title") {
            CS.titles.buildTextSection(body, clip);
        }

        //---- Transform ----
        var transform = CS.inspector.section(body, "Transform", function () {
            p.x = 0; p.y = 0; p.scale = 100; p.rotation = 0; p.opacity = 100;
            CS.commit("Reset Transform");
        });

        var xChip = CS.inspector.numChip("X", p.x, "", function (v) { p.x = v; }, 1);
        var yChip = CS.inspector.numChip("Y", p.y, "", function (v) { p.y = v; }, 1);
        CS.inspector.row(transform, "Position", [xChip, yChip]);

        CS.inspector.row(transform, "Scale", [
            CS.inspector.slider(10, 300, 1, p.scale, function (v) { p.scale = v; }),
            CS.inspector.numChip(null, p.scale, "%", function (v) { p.scale = CS.clamp(v, 1, 1000); }, 1)
        ]);

        CS.inspector.row(transform, "Rotation", [
            CS.inspector.dial(p.rotation, function (v) { p.rotation = v; }),
            CS.inspector.numChip(null, p.rotation, "°", function (v) { p.rotation = ((v % 360) + 360) % 360; }, 1)
        ]);

        CS.inspector.row(transform, "Opacity", [
            CS.inspector.slider(0, 100, 1, p.opacity, function (v) { p.opacity = v; }),
            CS.inspector.numChip(null, p.opacity, "%", function (v) { p.opacity = CS.clamp(v, 0, 100); }, 1)
        ]);

        CS.inspector.row(transform, "Blend", [
            CS.inspector.select([
                { v: "normal", l: "Normal" },
                { v: "multiply", l: "Multiply" },
                { v: "screen", l: "Screen" },
                { v: "overlay", l: "Overlay" },
                { v: "lighter", l: "Add" },
                { v: "soft-light", l: "Soft Light" },
                { v: "difference", l: "Difference" }
            ], p.blend || "normal", function (v) {
                p.blend = v;
                CS.commit("Blend Mode");
            })
        ]);

        CS.inspector.row(transform, "Flip", [
            CS.inspector.toggleChip("Horizontal", !!p.flipH, function (on) {
                p.flipH = on;
                CS.commit("Flip Horizontal");
            }),
            CS.inspector.toggleChip("Vertical", !!p.flipV, function (on) {
                p.flipV = on;
                CS.commit("Flip Vertical");
            })
        ]);

        //---- Speed (media-backed clips only; generated clips trim freely) ----
        var media = CS.getMedia(clip.mediaId);
        if (media && (media.type === "video" || media.type === "audio")) {
            var speed = CS.inspector.section(body, "Speed", function () {
                p.speed = 1;
                CS.commit("Reset Speed");
            });
            CS.inspector.row(speed, "Rate", [
                CS.inspector.slider(25, 400, 5, Math.round(CS.clipSpeed(clip) * 100), function (v) {
                    p.speed = v / 100;
                    CS.timeline.clampTrimOverlap(clip);
                }),
                CS.inspector.numChip(null, Math.round(CS.clipSpeed(clip) * 100), "%", function (v) {
                    p.speed = CS.clamp(v, 10, 800) / 100;
                    CS.timeline.clampTrimOverlap(clip);
                }, 5)
            ]);
            var spNote = document.createElement("div");
            spNote.className = "modal-note";
            spNote.textContent = "Changes clip length on the timeline; audio pitch follows the rate.";
            speed.appendChild(spNote);
        }

        //---- Crop ----
        var crop = CS.inspector.section(body, "Crop", function () {
            p.crop = "fit";
            p.cropTop = 0; p.cropBottom = 0; p.cropLeft = 0; p.cropRight = 0;
            CS.commit("Reset Crop");
        });
        CS.inspector.row(crop, "Type", [
            CS.inspector.select([
                { v: "fit", l: "Fit" },
                { v: "fill", l: "Fill" },
                { v: "stretch", l: "Stretch" }
            ], p.crop, function (v) {
                p.crop = v;
                CS.commit("Change Crop");
            })
        ]);

        //Per-edge crop in source pixels; the remaining region is what gets
        //fitted into the frame, so cropping also re-frames the clip
        var dims = CS.inspector.cropSourceDims(clip);
        [
            { key: "cropTop", label: "Top", span: dims.h },
            { key: "cropBottom", label: "Bottom", span: dims.h },
            { key: "cropLeft", label: "Left", span: dims.w },
            { key: "cropRight", label: "Right", span: dims.w }
        ].forEach(function (edge) {
            var max = Math.max(0, edge.span - 2);
            CS.inspector.row(crop, edge.label, [
                CS.inspector.slider(0, max, 1, p[edge.key] || 0, function (v) {
                    p[edge.key] = CS.inspector.clampCrop(p, edge.key, v, dims);
                }),
                CS.inspector.numChip(null, p[edge.key] || 0, "px", function (v) {
                    p[edge.key] = CS.inspector.clampCrop(p, edge.key, v, dims);
                }, 1)
            ]);
        });

        var cropNote = document.createElement("div");
        cropNote.className = "modal-note";
        cropNote.textContent = dims.known
            ? "Cropped from each edge of the " + dims.w + " x " + dims.h + " source, in source pixels."
            : "Cropped from each edge of the source, in source pixels.";
        crop.appendChild(cropNote);

        //---- Color ----
        var color = CS.inspector.section(body, "Color", function () {
            p.preset = "default"; p.exposure = 0; p.contrast = 0; p.saturation = 1;
            CS.commit("Reset Color");
        });
        CS.inspector.row(color, "Preset", [
            CS.inspector.select([
                { v: "default", l: "Default" },
                { v: "mono", l: "Monochrome" },
                { v: "warm", l: "Warm" },
                { v: "cool", l: "Cool" },
                { v: "vivid", l: "Vivid" }
            ], p.preset || "default", function (v) {
                CS.inspector.applyPreset(clip, v);
            })
        ]);
        CS.inspector.row(color, "Exposure", [
            CS.inspector.slider(-1, 1, 0.01, p.exposure, function (v) { p.exposure = v; }),
            CS.inspector.numChip(null, p.exposure, "", function (v) { p.exposure = CS.clamp(v, -1, 1); }, 0.01, 2)
        ]);
        CS.inspector.row(color, "Contrast", [
            CS.inspector.slider(-50, 50, 1, p.contrast, function (v) { p.contrast = v; }),
            CS.inspector.numChip(null, p.contrast, "", function (v) { p.contrast = CS.clamp(v, -50, 50); }, 1)
        ]);
        CS.inspector.row(color, "Saturation", [
            CS.inspector.slider(0, 2, 0.01, p.saturation, function (v) { p.saturation = v; }),
            CS.inspector.numChip(null, p.saturation, "", function (v) { p.saturation = CS.clamp(v, 0, 2); }, 0.01, 2)
        ]);

        //---- Reset all ----
        var reset = document.createElement("button");
        reset.className = "insp-reset-all";
        reset.textContent = "Reset All";
        reset.addEventListener("click", function () {
            clip.props = CS.defaultClipProps();
            CS.commit("Reset All");
        });
        body.appendChild(reset);

        CS.applyIcons(body);
    },

    //Shared by the Color preset dropdown and the Filters gallery panel
    applyPreset: function (clip, v) {
        var p = clip.props;
        p.preset = v;
        if (v === "mono") { p.saturation = 0; }
        if (v === "vivid") { p.saturation = 1.35; p.contrast = 10; }
        if (v === "default") { p.exposure = 0; p.contrast = 0; p.saturation = 1; }
        CS.commit("Color Preset");
        CS.panels.refresh();
    },

    /* ---------- effects tab ---------- */

    renderEffectsTab: function (body, clip) {
        if (!clip) {
            CS.inspector.placeholder(body, "Select a clip on the timeline, then add effects here or from the Effects panel on the left.");
            return;
        }
        var track = CS.getTrack(clip.trackId);
        var isAudio = track && track.kind === "audio";

        //Add-effect dropdown (only effects not applied yet, audio gets fades only)
        var available = CS.effects.registry.filter(function (def) {
            if (isAudio && !def.audioOk) { return false; }
            return !CS.effects.clipHas(clip, def.type);
        });
        var addBtn = document.createElement("button");
        addBtn.className = "insp-select";
        addBtn.style.width = "100%";
        addBtn.style.marginTop = "10px";
        addBtn.innerHTML = "<span></span>" + '<span data-icon="plus" class="mini"></span>';
        addBtn.firstChild.textContent = "Add Effect";
        addBtn.addEventListener("click", function () {
            if (!available.length) { CS.toast("All available effects are applied"); return; }
            CS.showMenuUnder(addBtn, available.map(function (def) {
                return {
                    label: def.name,
                    action: function () { CS.effects.applyToClip(clip, def.type); }
                };
            }));
        });
        body.appendChild(addBtn);

        var list = clip.props.effects || [];
        if (!list.length) {
            CS.inspector.placeholder(body, isAudio
                ? "No effects on this clip. Fade In and Fade Out shape the clip volume."
                : "No effects on this clip. Add one above or from the Effects panel.");
            CS.applyIcons(body);
            return;
        }

        list.forEach(function (e) {
            var def = CS.effects.get(e.type);
            if (!def) { return; }
            var sec = CS.inspector.section(body, def.name, function () {
                CS.effects.removeFromClip(clip, e.type);
            });
            //Repurpose the section reset button as a remove button
            var head = sec.parentNode.querySelector(".sec-reset");
            head.innerHTML = CS.iconSVG("trash");
            head.title = "Remove effect";

            if (def.params) {
                //Multi-parameter effect (Fade To): one row per parameter
                def.params.forEach(function (prm) {
                    CS.inspector.row(sec, prm.name, [
                        CS.inspector.slider(prm.min, prm.max, prm.step || 1,
                            CS.effects.paramValue(e, prm), function (v) { e[prm.key] = v; }),
                        CS.inspector.numChip(null, CS.effects.paramValue(e, prm), prm.unit, function (v) {
                            e[prm.key] = CS.clamp(v, prm.min, prm.max);
                        }, prm.step || 1)
                    ]);
                });
                if (def.kind === "audiogain") {
                    var fxNote = document.createElement("div");
                    fxNote.className = "modal-note";
                    fxNote.textContent = "Ramps the clip volume across its full length.";
                    sec.appendChild(fxNote);
                }
            } else if (def.noParam) {
                var note = document.createElement("div");
                note.className = "modal-note";
                note.textContent = "This effect has no settings.";
                sec.appendChild(note);
            } else {
                CS.inspector.row(sec, "Amount", [
                    CS.inspector.slider(def.min, def.max, def.step || 1, e.amount, function (v) { e.amount = v; }),
                    CS.inspector.numChip(null, e.amount, def.unit, function (v) {
                        e.amount = CS.clamp(v, def.min, def.max);
                    }, def.step || 1, (def.step && def.step < 1) ? 1 : 0)
                ]);
            }
        });

        CS.applyIcons(body);
    },

    /* ---------- audio tab ---------- */

    renderAudioTab: function (body, clip, media, track) {
        var p = clip.props;
        var hasAudio = media && (media.type === "audio" || media.type === "video");
        if (!hasAudio) {
            CS.inspector.placeholder(body, "The selected clip has no audio.");
            return;
        }

        var sec = CS.inspector.section(body, "Audio", function () {
            p.volume = 100;
            CS.commit("Reset Audio");
        });
        CS.inspector.row(sec, "Volume", [
            CS.inspector.slider(0, 200, 1, (p.volume === undefined ? 100 : p.volume), function (v) { p.volume = v; }),
            CS.inspector.numChip(null, (p.volume === undefined ? 100 : p.volume), "%", function (v) { p.volume = CS.clamp(v, 0, 200); }, 1)
        ]);

        var note = document.createElement("div");
        note.className = "modal-note";
        note.textContent = track && track.kind === "audio"
            ? "Tip: the eye toggle on the track header mutes the whole track."
            : "This controls the audio embedded in the video clip.";
        sec.appendChild(note);

        CS.inspector.renderFadeToSection(body, clip);

        CS.applyIcons(body);
    },

    //"Fade To" filter: a linear volume ramp from a start to an end volume over
    //the whole clip. Stored as a regular entry in the clip effect stack so it
    //also shows up (and can be removed) on the Effects tab.
    renderFadeToSection: function (body, clip) {
        var def = CS.effects.get("fadeto");
        var fx = CS.effects.clipHas(clip, "fadeto");

        var sec = CS.inspector.section(body, def.name, function () {
            if (CS.effects.clipHas(clip, "fadeto")) {
                CS.effects.removeFromClip(clip, "fadeto");
            }
        });
        var head = sec.parentNode.querySelector(".sec-reset");
        head.title = fx ? "Remove Fade To" : "Reset section";
        if (fx) { head.innerHTML = CS.iconSVG("trash"); }

        if (!fx) {
            var addBtn = document.createElement("button");
            addBtn.className = "insp-select";
            addBtn.style.width = "100%";
            addBtn.style.justifyContent = "center";
            addBtn.textContent = "Add Fade To";
            addBtn.addEventListener("click", function () {
                CS.effects.applyToClip(clip, "fadeto"); //commit re-renders the tab
            });
            var holder = document.createElement("div");
            holder.className = "insp-row";
            holder.appendChild(addBtn);
            sec.appendChild(holder);

            var hint = document.createElement("div");
            hint.className = "modal-note";
            hint.textContent = "Fades the clip volume from a start level to an end level.";
            sec.appendChild(hint);
            return;
        }

        def.params.forEach(function (prm) {
            CS.inspector.row(sec, prm.name, [
                CS.inspector.slider(prm.min, prm.max, prm.step || 1,
                    CS.effects.paramValue(fx, prm), function (v) { fx[prm.key] = v; }),
                CS.inspector.numChip(null, CS.effects.paramValue(fx, prm), prm.unit, function (v) {
                    fx[prm.key] = CS.clamp(v, prm.min, prm.max);
                }, prm.step || 1)
            ]);
        });

        var rampNote = document.createElement("div");
        rampNote.className = "modal-note";
        rampNote.textContent = "The volume travels linearly from the start level to the end "
            + "level across the whole clip, on top of the clip volume above.";
        sec.appendChild(rampNote);
    },

    /* ---------- crop helpers ---------- */

    //Pixel size of the clip source: media dimensions, or the project frame for
    //generated clips (titles / colors) and media that has not been probed yet
    cropSourceDims: function (clip) {
        var W = CS.project.settings.width;
        var H = CS.project.settings.height;
        if (clip.kind !== "title" && clip.kind !== "color") {
            var media = CS.getMedia(clip.mediaId);
            if (media && media.width && media.height) {
                return { w: media.width, h: media.height, known: true };
            }
        }
        return { w: W, h: H, known: false };
    },

    //Keep a crop value inside the source and leave at least 2px of picture
    //together with the crop on the opposite edge
    clampCrop: function (props, key, value, dims) {
        var opposites = {
            cropTop: { other: "cropBottom", span: dims.h },
            cropBottom: { other: "cropTop", span: dims.h },
            cropLeft: { other: "cropRight", span: dims.w },
            cropRight: { other: "cropLeft", span: dims.w }
        };
        var o = opposites[key];
        var room = Math.max(0, o.span - 2 - (props[o.other] || 0));
        return CS.clamp(Math.round(value), 0, room);
    },

    /* ---------- widget builders ---------- */

    section: function (body, title, onReset) {
        var sec = document.createElement("div");
        sec.className = "insp-section" + (CS.inspector._collapsed[title] ? " collapsed" : "");

        var head = document.createElement("div");
        head.className = "insp-section-head";
        head.innerHTML = '<span class="caret">' + CS.iconSVG("chevron-down") + '</span>' +
            '<span class="sec-title"></span>' +
            '<button class="sec-reset" title="Reset section">' + CS.iconSVG("rotate-ccw") + "</button>";
        head.querySelector(".sec-title").textContent = title;
        head.addEventListener("click", function (ev) {
            if (ev.target.closest(".sec-reset")) { return; }
            CS.inspector._collapsed[title] = !CS.inspector._collapsed[title];
            sec.classList.toggle("collapsed", CS.inspector._collapsed[title]);
        });
        head.querySelector(".sec-reset").addEventListener("click", function () {
            if (onReset) { onReset(); }
        });

        var rows = document.createElement("div");
        rows.className = "insp-rows";

        sec.appendChild(head);
        sec.appendChild(rows);
        body.appendChild(sec);
        return rows;
    },

    row: function (rowsEl, labelText, controls) {
        var row = document.createElement("div");
        row.className = "insp-row";
        var label = document.createElement("span");
        label.className = "insp-label";
        label.textContent = labelText;
        var holder = document.createElement("div");
        holder.className = "insp-control";
        controls.forEach(function (c) { holder.appendChild(c); });
        row.appendChild(label);
        row.appendChild(holder);
        rowsEl.appendChild(row);
        return row;
    },

    liveUpdate: function () {
        CS.player.syncElements();
        CS.player.render();
    },

    slider: function (min, max, step, value, apply) {
        var s = document.createElement("input");
        s.type = "range";
        s.className = "insp-slider";
        s.min = min;
        s.max = max;
        s.step = step;
        s.value = value;
        CS.paintSlider(s);
        s.addEventListener("input", function () {
            apply(parseFloat(s.value));
            CS.paintSlider(s);
            CS.inspector.liveUpdate();
        });
        s.addEventListener("change", function () {
            CS.commit("Adjust Property");
        });
        return s;
    },

    numChip: function (labelText, value, unit, apply, step, decimals) {
        var chip = document.createElement("span");
        chip.className = "num-chip";
        var html = "";
        if (labelText) { html += "<label></label>"; }
        html += '<input type="text">';
        if (unit) { html += '<span class="unit"></span>'; }
        chip.innerHTML = html;
        if (labelText) { chip.querySelector("label").textContent = labelText; }
        if (unit) { chip.querySelector(".unit").textContent = unit; }
        var inp = chip.querySelector("input");
        var dec = (decimals === undefined) ? 0 : decimals;
        inp.value = Number(value).toFixed(dec);
        inp.addEventListener("change", function () {
            var v = parseFloat(inp.value);
            if (isNaN(v)) { return; }
            apply(v);
            CS.commit("Adjust Property");
        });
        //Drag vertically on the chip to scrub the value
        inp.addEventListener("keydown", function (ev) {
            var delta = (ev.key === "ArrowUp") ? (step || 1) : (ev.key === "ArrowDown") ? -(step || 1) : 0;
            if (delta) {
                ev.preventDefault();
                var v = (parseFloat(inp.value) || 0) + delta;
                inp.value = v.toFixed(dec);
                apply(v);
                CS.inspector.liveUpdate();
            }
        });
        return chip;
    },

    dial: function (value, apply) {
        var dial = document.createElement("div");
        dial.className = "dial";
        var tick = document.createElement("div");
        tick.className = "tick";
        dial.appendChild(tick);
        function paint(v) { tick.style.transform = "rotate(" + v + "deg)"; }
        paint(value);
        dial.addEventListener("pointerdown", function (ev) {
            ev.preventDefault();
            dial.setPointerCapture(ev.pointerId);
            var startY = ev.clientY;
            var startV = value;
            dial.onpointermove = function (mv) {
                value = Math.round(startV + (startY - mv.clientY));
                value = ((value % 360) + 360) % 360;
                paint(value);
                apply(value);
                CS.inspector.liveUpdate();
            };
            dial.onpointerup = function () {
                dial.onpointermove = null;
                dial.onpointerup = null;
                CS.commit("Rotate Clip");
            };
        });
        dial.title = "Drag up / down to rotate";
        return dial;
    },

    //Small on/off pill used for boolean properties (flip H / V)
    toggleChip: function (labelText, on, onChange) {
        var btn = document.createElement("button");
        btn.className = "insp-select";
        btn.style.minWidth = "0";
        btn.style.flex = "1";
        btn.style.justifyContent = "center";
        function paint() {
            btn.style.color = on ? "var(--accent)" : "var(--text)";
            btn.style.boxShadow = on ? "inset 0 0 0 1px var(--accent)" : "none";
        }
        btn.textContent = labelText;
        paint();
        btn.addEventListener("click", function () {
            on = !on;
            paint();
            onChange(on);
        });
        return btn;
    },

    select: function (options, value, onChange) {
        var btn = document.createElement("button");
        btn.className = "insp-select";
        var current = options.filter(function (o) { return o.v === value; })[0];
        btn.innerHTML = "<span></span>" + '<span data-icon="chevron-down" class="mini"></span>';
        btn.firstChild.textContent = current ? current.l : value;
        btn.addEventListener("click", function () {
            CS.showMenuUnder(btn, options.map(function (o) {
                return {
                    label: o.l,
                    checked: o.v === value,
                    action: function () { onChange(o.v); }
                };
            }));
        });
        return btn;
    }
};
