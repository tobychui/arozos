/*
    Cine Studio - keyframes (Premiere's Effect Controls animation)

    Animatable clip properties carry a list of keyframes in
    clip.props.keyframes[key] = [{t, v, ease}], with t in seconds from the
    start of the clip on the timeline and ease "linear" (default) or
    "ease" (smooth in / out). While a property is animated, every edit in
    the inspector or on the preview writes a keyframe at the playhead
    instead of the static value; CS.keyframes.value() resolves the value
    the compositor, the mixer and the server render use at any time.
*/
"use strict";

window.CS = window.CS || {};

CS.keyframes = {

    //Animatable properties and their static fallbacks
    PROPS: {
        x: { label: "X", def: 0 },
        y: { label: "Y", def: 0 },
        scale: { label: "Scale", def: 100 },
        rotation: { label: "Rotation", def: 0 },
        opacity: { label: "Opacity", def: 100 },
        volume: { label: "Volume", def: 100 },
        pan: { label: "Pan", def: 0 }
    },

    /* ---------- model ---------- */

    list: function (clip, key) {
        var kfs = clip && clip.props && clip.props.keyframes;
        return (kfs && kfs[key]) ? kfs[key] : [];
    },

    has: function (clip, key) {
        return CS.keyframes.list(clip, key).length > 0;
    },

    //Whether any property of the clip is animated
    anyAnimated: function (clip) {
        if (!clip || !clip.props || !clip.props.keyframes) { return false; }
        var kfs = clip.props.keyframes;
        return Object.keys(kfs).some(function (k) { return kfs[k] && kfs[k].length; });
    },

    //Tolerance for "the same time": one frame
    eps: function () {
        return 0.5 / ((CS.project && CS.project.settings.fps) || 30);
    },

    //Value of a property at absolute timeline time t; fallback is the
    //static value used when the property is not animated
    value: function (clip, key, t, fallback) {
        var kfs = CS.keyframes.list(clip, key);
        if (!kfs.length) { return fallback; }
        return CS.keyframes.interpolate(kfs, t - clip.start);
    },

    //Interpolate a sorted keyframe list at clip-local time tl
    interpolate: function (kfs, tl) {
        if (tl <= kfs[0].t) { return kfs[0].v; }
        var last = kfs[kfs.length - 1];
        if (tl >= last.t) { return last.v; }
        for (var i = 0; i < kfs.length - 1; i++) {
            var a = kfs[i], b = kfs[i + 1];
            if (tl >= a.t && tl <= b.t) {
                var span = b.t - a.t;
                var k = span > 0 ? (tl - a.t) / span : 1;
                if (a.ease === "ease" || b.ease === "ease") { k = k * k * (3 - 2 * k); } //smoothstep
                else if (a.ease === "hold") { k = 0; }
                return a.v + (b.v - a.v) * k;
            }
        }
        return last.v;
    },

    //Add or replace the keyframe at clip-local time tl
    set: function (clip, key, tl, v, ease) {
        if (!clip.props.keyframes) { clip.props.keyframes = {}; }
        if (!clip.props.keyframes[key]) { clip.props.keyframes[key] = []; }
        var kfs = clip.props.keyframes[key];
        tl = CS.clamp(tl, 0, Math.max(0, CS.clipDuration(clip)));
        var eps = CS.keyframes.eps();
        for (var i = 0; i < kfs.length; i++) {
            if (Math.abs(kfs[i].t - tl) < eps) {
                kfs[i].v = v;
                if (ease) { kfs[i].ease = ease; }
                return kfs[i];
            }
        }
        var kf = { t: tl, v: v, ease: ease || "linear" };
        kfs.push(kf);
        kfs.sort(function (p, q) { return p.t - q.t; });
        return kf;
    },

    at: function (clip, key, tl) {
        var kfs = CS.keyframes.list(clip, key);
        var eps = CS.keyframes.eps();
        for (var i = 0; i < kfs.length; i++) {
            if (Math.abs(kfs[i].t - tl) < eps) { return kfs[i]; }
        }
        return null;
    },

    remove: function (clip, key, tl) {
        var kfs = CS.keyframes.list(clip, key);
        var eps = CS.keyframes.eps();
        var kept = kfs.filter(function (k) { return Math.abs(k.t - tl) >= eps; });
        if (kept.length === kfs.length) { return false; }
        clip.props.keyframes[key] = kept;
        if (!kept.length) { delete clip.props.keyframes[key]; }
        return true;
    },

    //Stopwatch: turn animation on (first keyframe at the playhead with the
    //current value) or off (keep the value under the playhead as static)
    toggle: function (clip, key) {
        var tl = CS.state.playhead - clip.start;
        var current = CS.keyframes.value(clip, key, CS.state.playhead, CS.keyframes.staticValue(clip, key));
        if (CS.keyframes.has(clip, key)) {
            delete clip.props.keyframes[key];
            CS.keyframes.setStatic(clip, key, current);
            CS.commit("Remove Keyframes");
        } else {
            CS.keyframes.set(clip, key, tl, current);
            CS.commit("Animate " + CS.keyframes.PROPS[key].label);
        }
    },

    staticValue: function (clip, key) {
        var v = clip.props[key];
        return (v === undefined || v === null) ? CS.keyframes.PROPS[key].def : v;
    },

    setStatic: function (clip, key, v) {
        clip.props[key] = v;
    },

    //Edit from a control: writes a keyframe at the playhead when animated,
    //otherwise the static value
    applyEdit: function (clip, key, v) {
        if (CS.keyframes.has(clip, key)) {
            CS.keyframes.set(clip, key, CS.state.playhead - clip.start, v);
        } else {
            CS.keyframes.setStatic(clip, key, v);
        }
    },

    //Toggle a keyframe at the playhead (the diamond button)
    toggleAtPlayhead: function (clip, key) {
        var tl = CS.state.playhead - clip.start;
        if (CS.keyframes.at(clip, key, tl)) {
            CS.keyframes.remove(clip, key, tl);
            if (!CS.keyframes.has(clip, key)) {
                CS.keyframes.setStatic(clip, key, CS.keyframes.value(clip, key, CS.state.playhead, CS.keyframes.staticValue(clip, key)));
            }
            CS.commit("Remove Keyframe");
        } else {
            var v = CS.keyframes.value(clip, key, CS.state.playhead, CS.keyframes.staticValue(clip, key));
            CS.keyframes.set(clip, key, tl, v);
            CS.commit("Add Keyframe");
        }
    },

    //Previous / next keyframe of the property relative to the playhead
    neighbour: function (clip, key, dir) {
        var tl = CS.state.playhead - clip.start;
        var kfs = CS.keyframes.list(clip, key);
        var eps = CS.keyframes.eps();
        if (dir < 0) {
            for (var i = kfs.length - 1; i >= 0; i--) { if (kfs[i].t < tl - eps) { return kfs[i]; } }
        } else {
            for (var j = 0; j < kfs.length; j++) { if (kfs[j].t > tl + eps) { return kfs[j]; } }
        }
        return null;
    },

    nav: function (clip, key, dir) {
        var kf = CS.keyframes.neighbour(clip, key, dir);
        if (kf) { CS.player.seek(clip.start + kf.t); }
    },

    setEase: function (clip, key, tl, ease) {
        var kf = CS.keyframes.at(clip, key, tl);
        if (kf) { kf.ease = ease; CS.commit("Keyframe Interpolation"); }
    },

    //When a clip is split, each half keeps the keyframes on its side with
    //the boundary value baked in so the motion is unchanged
    splitKeyframes: function (left, right, cutLocal) {
        var kfs = left.props.keyframes;
        if (!kfs) { return; }
        var leftOut = {}, rightOut = {};
        Object.keys(kfs).forEach(function (key) {
            var list = kfs[key];
            if (!list || !list.length) { return; }
            var vCut = CS.keyframes.interpolate(list, cutLocal);
            var l = list.filter(function (k) { return k.t < cutLocal; }).map(function (k) { return { t: k.t, v: k.v, ease: k.ease }; });
            var r = list.filter(function (k) { return k.t > cutLocal; }).map(function (k) { return { t: k.t - cutLocal, v: k.v, ease: k.ease }; });
            l.push({ t: cutLocal, v: vCut, ease: "linear" });
            r.unshift({ t: 0, v: vCut, ease: "linear" });
            leftOut[key] = l;
            rightOut[key] = r;
        });
        left.props.keyframes = leftOut;
        right.props.keyframes = rightOut;
    },

    /* ---------- timeline decoration ---------- */

    decorateClip: function (el, clip) {
        if (!CS.keyframes.anyAnimated(clip)) { return; }
        var lane = document.createElement("div");
        lane.className = "kf-lane";
        var times = {};
        var kfs = clip.props.keyframes;
        Object.keys(kfs).forEach(function (key) {
            (kfs[key] || []).forEach(function (k) { times[k.t.toFixed(3)] = k.t; });
        });
        Object.keys(times).forEach(function (t) {
            var d = document.createElement("span");
            d.className = "kf-diamond";
            d.style.left = (times[t] * CS.state.zoom) + "px";
            lane.appendChild(d);
        });
        el.appendChild(lane);
    },

    /* ---------- inspector widgets ---------- */

    //Stopwatch + previous / add-remove / next buttons for a property
    controls: function (clip, key) {
        var holder = document.createElement("span");
        holder.className = "kf-controls";
        holder.style.display = "inline-flex";
        holder.style.gap = "1px";
        var animated = CS.keyframes.has(clip, key);
        var tl = CS.state.playhead - clip.start;

        var watch = document.createElement("button");
        watch.className = "kf-btn" + (animated ? " on" : "");
        watch.innerHTML = CS.iconSVG("stopwatch");
        watch.title = animated ? "Stop animating (keeps the current value)" : "Animate with keyframes";
        watch.setAttribute("data-kf-toggle", key);
        watch.addEventListener("click", function () { CS.keyframes.toggle(clip, key); });
        holder.appendChild(watch);

        if (animated) {
            var prev = document.createElement("button");
            prev.className = "kf-btn nav";
            prev.innerHTML = CS.iconSVG("chevron-right");
            prev.style.transform = "scaleX(-1)";
            prev.title = "Previous keyframe";
            prev.disabled = !CS.keyframes.neighbour(clip, key, -1);
            prev.addEventListener("click", function () { CS.keyframes.nav(clip, key, -1); });

            var diamond = document.createElement("button");
            diamond.className = "kf-btn" + (CS.keyframes.at(clip, key, tl) ? " on" : "");
            diamond.innerHTML = CS.iconSVG("keyframe");
            diamond.title = "Add / remove keyframe at the playhead";
            diamond.setAttribute("data-kf-diamond", key);
            diamond.addEventListener("click", function () { CS.keyframes.toggleAtPlayhead(clip, key); });
            diamond.addEventListener("contextmenu", function (ev) {
                ev.preventDefault();
                var kf = CS.keyframes.at(clip, key, tl);
                if (!kf) { return; }
                CS.showMenu([
                    { label: "Linear", checked: (kf.ease || "linear") === "linear", action: function () { CS.keyframes.setEase(clip, key, tl, "linear"); } },
                    { label: "Ease in / out", checked: kf.ease === "ease", action: function () { CS.keyframes.setEase(clip, key, tl, "ease"); } },
                    { label: "Hold", checked: kf.ease === "hold", action: function () { CS.keyframes.setEase(clip, key, tl, "hold"); } }
                ], ev.clientX, ev.clientY);
            });

            var next = document.createElement("button");
            next.className = "kf-btn nav";
            next.innerHTML = CS.iconSVG("chevron-right");
            next.title = "Next keyframe";
            next.disabled = !CS.keyframes.neighbour(clip, key, 1);
            next.addEventListener("click", function () { CS.keyframes.nav(clip, key, 1); });

            holder.appendChild(prev);
            holder.appendChild(diamond);
            holder.appendChild(next);
        }
        return holder;
    },

    //Value to show in the inspector for a property right now
    shown: function (clip, key) {
        return CS.keyframes.value(clip, key, CS.state.playhead, CS.keyframes.staticValue(clip, key));
    }
};
