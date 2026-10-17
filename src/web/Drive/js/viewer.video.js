/*
    viewer.video.js

    Video player with its own controls: seek bar with buffered range and
    storyboard previews, volume, speed, subtitles (files next to the video
    and tracks inside it), loop and autoplay, picture in picture, full
    screen, resume where you left off, keyboard and touch gestures, and the
    Media Session API for hardware media keys.

    When the browser cannot decode a file (the server's codec probe says so,
    or playback fails) and ffmpeg is on the host, it switches to the server
    transcode stream. That stream cannot seek by itself, so seeking reloads
    it from the new start time and the player adds that offset back.
*/

(function () {
    "use strict";

    var I = DriveUI.I;
    var esc = DriveUI.esc;
    var API = DriveAPI;
    var U = DriveViewer.util;

    var SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    var RESUME_KEY = "drive_resume_positions";

    function store(key, value) {
        try {
            if (value === undefined) {
                return JSON.parse(localStorage.getItem(key) || "null");
            }
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            return null;
        }
    }

    function resumeOf(path) {
        var all = store(RESUME_KEY) || {};
        return all[path] || null;
    }

    function saveResume(path, t, d) {
        var all = store(RESUME_KEY) || {};
        if (t < 10 || (d && t > d - 15)) {
            delete all[path];
        } else {
            all[path] = { t: t, d: d, ts: Date.now() };
        }
        //Keep the 200 most recent entries
        var keys = Object.keys(all).sort(function (a, b) { return all[b].ts - all[a].ts; });
        keys.slice(200).forEach(function (k) { delete all[k]; });
        store(RESUME_KEY, all);
    }

    /* Subtitle parsing ------------------------------------------------------ */
    function parseTime(s) {
        var m = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/.exec(s);
        if (!m) {
            return NaN;
        }
        return (parseInt(m[1] || "0", 10) * 3600) + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt((m[4] + "00").substring(0, 3), 10) / 1000;
    }

    function parseSRT(text) {
        var cues = [];
        String(text).replace(/\r/g, "").replace(/^﻿/, "").split(/\n\s*\n/).forEach(function (block) {
            var lines = block.split("\n");
            var at = -1;
            for (var i = 0; i < lines.length; i++) {
                if (lines[i].indexOf("-->") >= 0) {
                    at = i;
                    break;
                }
            }
            if (at < 0) {
                return;
            }
            var parts = lines[at].split("-->");
            var start = parseTime(parts[0]), end = parseTime(parts[1]);
            if (isNaN(start) || isNaN(end)) {
                return;
            }
            cues.push({ start: start, end: end, text: lines.slice(at + 1).join("\n").trim() });
        });
        return cues;
    }

    function parseASS(text) {
        var cues = [];
        var format = null;
        String(text).replace(/\r/g, "").split("\n").forEach(function (line) {
            if (/^Format:/i.test(line) && format == null) {
                format = line.substring(7).split(",").map(function (s) { return s.trim().toLowerCase(); });
            } else if (/^Dialogue:/i.test(line)) {
                var f = format || ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"];
                var raw = line.substring(9).trim();
                var parts = raw.split(",");
                var head = parts.slice(0, f.length - 1);
                var body = parts.slice(f.length - 1).join(",");
                var start = parseTime(head[f.indexOf("start")] + "0"), end = parseTime(head[f.indexOf("end")] + "0");
                body = body.replace(/\{[^}]*\}/g, "").replace(/\\N/gi, "\n").replace(/\\h/g, " ").trim();
                if (!isNaN(start) && !isNaN(end) && body) {
                    cues.push({ start: start, end: end, text: body });
                }
            }
        });
        return cues.sort(function (a, b) { return a.start - b.start; });
    }

    function parseSubtitles(text, ext) {
        if (ext == "ass" || ext == "ssa" || /^\s*\[Script Info\]/i.test(text)) {
            return parseASS(text);
        }
        //SRT and WebVTT share the cue syntax this cares about
        return parseSRT(String(text).replace(/^WEBVTT[^\n]*\n/, ""));
    }

    function vttTime(t) {
        t = Math.max(0, t);
        var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
        var pad = function (n, w) { n = String(n); while (n.length < w) { n = "0" + n; } return n; };
        return pad(h, 2) + ":" + pad(m, 2) + ":" + pad(s.toFixed(3), 6);
    }

    function toVTT(cues, shift) {
        var out = "WEBVTT\n\n";
        cues.forEach(function (c) {
            var s = c.start - shift, e = c.end - shift;
            if (e <= 0) {
                return;
            }
            out += vttTime(s) + " --> " + vttTime(e) + "\n" + c.text.replace(/-->/g, "->") + "\n\n";
        });
        return out;
    }

    var LANG = {
        en: "English", eng: "English", zh: "中文", chi: "中文", zho: "中文", ja: "日本語", jpn: "日本語", ko: "한국어", kor: "한국어",
        fr: "Français", fre: "Français", fra: "Français", de: "Deutsch", ger: "Deutsch", deu: "Deutsch", es: "Español", spa: "Español"
    };

    /* ---------------------------------------------------------------------- */
    function mount(ctx) {
        var item = ctx.item;
        var mem = ctx.memory;
        if (mem.autoplay === undefined) {
            mem.autoplay = true;
        }
        var vol = store("drive_media_volume");
        var st = {
            mode: "direct",          //direct | transcode
            canTranscode: false,
            offset: 0,               //transcode stream start, seconds
            duration: 0,
            res: "original",
            speed: 1,
            tracks: [],              //{label, load() -> Promise<cues>}
            track: -1,
            cues: null,
            storyboard: null,
            destroyed: false,
            triedTranscode: false
        };

        ctx.body.innerHTML =
            '<div class="vp" tabindex="-1">' +
            '<video playsinline preload="metadata"></video>' +
            '<div class="vp-topshade"></div>' +
            '<div class="vw-spin vp-busy"></div>' +
            '<button class="vp-big" aria-label="' + esc(T("vw/play", "Play")) + '">' + I("play") + '</button>' +
            '<div class="vp-controls">' +
            '<div data-seek></div>' +
            '<div class="vp-row">' +
            '<button class="vp-btn" data-c="play" title="' + esc(T("vw/play", "Play")) + ' (K)">' + I("play") + '</button>' +
            '<button class="vp-btn vp-hide-sm" data-c="prev" title="' + esc(T("pv/prev", "Previous")) + ' (Shift+P)"' + (ctx.hasPrev ? "" : " disabled style=\"opacity:.35\"") + '>' + skipIcon(true) + '</button>' +
            '<button class="vp-btn vp-hide-sm" data-c="next" title="' + esc(T("pv/next", "Next")) + ' (Shift+N)"' + (ctx.hasNext ? "" : " disabled style=\"opacity:.35\"") + '>' + skipIcon(false) + '</button>' +
            '<div class="vp-vol"><button class="vp-btn" data-c="mute" title="' + esc(T("vw/mute", "Mute")) + ' (M)"></button>' +
            '<input class="vw-range" type="range" min="0" max="1" step="0.02" data-c="vol" aria-label="' + esc(T("vw/volume", "Volume")) + '"></div>' +
            '<span class="vp-time" data-time>0:00 / 0:00</span>' +
            '<span class="vp-spacer"></span>' +
            '<span class="vp-badge vp-hide-sm" data-badge hidden></span>' +
            '<button class="vp-btn" data-c="cc" title="' + esc(T("vw/subtitles", "Subtitles")) + ' (C)" hidden>' + ccIcon() + '</button>' +
            '<button class="vp-btn" data-c="settings" title="' + esc(T("vw/settings", "Playback settings")) + '">' + I("cog") + '</button>' +
            ('pictureInPictureEnabled' in document && document.pictureInPictureEnabled ? '<button class="vp-btn vp-hide-sm" data-c="pip" title="' + esc(T("vw/pip", "Picture in picture")) + '">' + pipIcon() + '</button>' : "") +
            '<button class="vp-btn" data-c="fs" title="' + esc(T("vw/fullscreen", "Full screen")) + ' (F)">' + fsIcon(false) + '</button>' +
            '</div></div></div>';

        var vp = ctx.body.querySelector(".vp");
        var video = vp.querySelector("video");
        var big = vp.querySelector(".vp-big");
        var timeEl = vp.querySelector("[data-time]");
        var badge = vp.querySelector("[data-badge]");
        var volInput = vp.querySelector('[data-c="vol"]');
        var muteBtn = vp.querySelector('[data-c="mute"]');
        var playBtn = vp.querySelector('[data-c="play"]');
        var ccBtn = vp.querySelector('[data-c="cc"]');

        if (ctx.hasPrev) {
            var pn = DriveUI.el('<button class="vw-side-nav prev" aria-label="' + esc(T("pv/prev", "Previous")) + '">' + I("chevronLeft") + '</button>');
            pn.addEventListener("click", function (e) { e.stopPropagation(); ctx.go(-1); });
            vp.appendChild(pn);
        }
        if (ctx.hasNext) {
            var nn = DriveUI.el('<button class="vw-side-nav next" aria-label="' + esc(T("pv/next", "Next")) + '">' + I("chevronRight") + '</button>');
            nn.addEventListener("click", function (e) { e.stopPropagation(); ctx.go(1); });
            vp.appendChild(nn);
        }

        /* Icons that the shared icon set does not have -------------------- */
        function skipIcon(back) {
            return '<svg class="ic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
                (back ? '<path d="M6 5h2v14H6zM19 5.5v13l-9.5-6.5z"/>' : '<path d="M16 5h2v14h-2zM5 5.5v13l9.5-6.5z"/>') + '</svg>';
        }
        function ccIcon() {
            return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/>' +
                '<path d="M10.5 10.2a2.2 2.2 0 1 0 0 3.6M17 10.2a2.2 2.2 0 1 0 0 3.6"/></svg>';
        }
        function pipIcon() {
            return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><rect x="12" y="11.5" width="6.5" height="5" rx="1" fill="currentColor"/></svg>';
        }
        function fsIcon(exit) {
            return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                (exit ? '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>' : '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>') + '</svg>';
        }
        function volIcon() {
            var v = video.muted ? 0 : video.volume;
            var waves = v == 0 ? '<path d="M16 9.5l5 5M21 9.5l-5 5"/>' : (v < 0.5 ? '<path d="M15.5 9.2a4 4 0 0 1 0 5.6"/>' : '<path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.3 6.6a7.6 7.6 0 0 1 0 10.8"/>');
            return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor"/>' + waves + '</svg>';
        }

        /* Time and sources -------------------------------------------------- */
        function now() {
            return st.offset + (video.currentTime || 0);
        }

        function total() {
            if (st.mode == "transcode") {
                return st.duration || (st.offset + (isFinite(video.duration) ? video.duration : 0));
            }
            return isFinite(video.duration) ? video.duration : (st.duration || 0);
        }

        function sourceFor(start) {
            if (st.mode == "transcode") {
                var url = API.ROOT + "media/transcode/?file=" + encodeURIComponent(item.path);
                if (st.res != "original") {
                    url += "&res=" + st.res;
                }
                if (start > 0) {
                    url += "&start=" + Math.floor(start);
                }
                return url;
            }
            return ctx.url;
        }

        function load(start, autoplay) {
            vp.classList.add("buffering");
            st.offset = st.mode == "transcode" ? Math.max(0, Math.floor(start || 0)) : 0;
            video.src = sourceFor(st.offset);
            if (st.mode == "direct" && start > 0) {
                video.addEventListener("loadedmetadata", function seekOnce() {
                    video.removeEventListener("loadedmetadata", seekOnce);
                    video.currentTime = start;
                });
            }
            video.playbackRate = st.speed;
            refreshTrack();
            if (autoplay) {
                var p = video.play();
                if (p && p.catch) {
                    p.catch(function () {
                        big.classList.remove("hide");
                        vp.classList.remove("buffering");
                    });
                }
            }
            updateBadge();
        }

        function seekTo(t) {
            var d = total();
            if (d) {
                t = Math.max(0, Math.min(d - 0.25, t));
            } else {
                t = Math.max(0, t);
            }
            if (st.mode == "transcode") {
                load(t, true);
            } else {
                video.currentTime = t;
            }
            renderTime();
        }

        function switchToTranscode(reason) {
            if (st.mode == "transcode" || !st.canTranscode) {
                return false;
            }
            st.mode = "transcode";
            var at = now();
            DriveUI.toast(T("vw/compatMode", "Playing in compatible mode: the server converts this video while it plays."));
            if (!st.duration) {
                U.fetchJSON(API.ROOT + "media/duration/?file=" + encodeURIComponent(item.path)).then(function (r) {
                    if (r && r.duration > 0) {
                        st.duration = r.duration;
                        renderTime();
                    }
                }).catch(function () { });
            }
            load(at, true);
            return true;
        }

        function updateBadge() {
            var bits = [];
            if (st.mode == "transcode") {
                bits.push(T("vw/compat", "Compatible"));
            }
            if (video.videoHeight) {
                var h = video.videoHeight;
                bits.push(h >= 2000 ? "4K" : h >= 1400 ? "1440p" : h >= 1000 ? "1080p" : h >= 700 ? "720p" : h + "p");
            }
            badge.textContent = bits.join(" · ");
            badge.hidden = bits.length == 0;
        }

        /* Seek bar with storyboard previews --------------------------------- */
        var seek = U.seekBar({
            onSeek: function (f, done) {
                var d = total();
                if (!d) {
                    return;
                }
                if (st.mode == "direct") {
                    video.currentTime = f * d;
                } else if (done) {
                    seekTo(f * d);
                }
                renderTime(f * d);
            },
            tip: function (f) {
                var d = total();
                var t = f * d;
                var frame = "";
                var sb = st.storyboard;
                if (sb && sb.count > 0) {
                    var idx = Math.min(sb.count - 1, Math.floor(t / sb.interval));
                    var w = Math.min(160, sb.tileWidth), k = w / sb.tileWidth, h = Math.round(sb.tileHeight * k);
                    var col = idx % sb.cols, row = Math.floor(idx / sb.cols);
                    frame = '<div class="frame" style="width:' + w + 'px;height:' + h + 'px;background-image:url(\'' + sb.image + '\');background-size:' +
                        (sb.cols * sb.tileWidth * k) + 'px ' + (sb.rows * sb.tileHeight * k) + 'px;background-position:-' + (col * sb.tileWidth * k) + 'px -' + (row * sb.tileHeight * k) + 'px"></div>';
                }
                return frame + U.fmtTime(t);
            }
        });
        vp.querySelector("[data-seek]").appendChild(seek.el);

        function renderTime(preview) {
            var d = total();
            var t = preview !== undefined ? preview : now();
            timeEl.textContent = U.fmtTime(t) + " / " + (d ? U.fmtTime(d) : "--:--");
            var buffered = 0;
            try {
                if (video.buffered.length) {
                    buffered = st.offset + video.buffered.end(video.buffered.length - 1);
                }
            } catch (e) { }
            seek.set(d ? t / d : 0, d ? buffered / d : 0);
        }

        /* Volume ------------------------------------------------------------ */
        function renderVolume() {
            muteBtn.innerHTML = volIcon();
            volInput.value = video.muted ? 0 : video.volume;
            U.rangeFill(volInput);
        }
        video.volume = vol && typeof vol.v === "number" ? vol.v : 1;
        video.muted = !!(vol && vol.m);
        renderVolume();
        volInput.addEventListener("input", function () {
            video.volume = parseFloat(volInput.value);
            video.muted = video.volume == 0;
        });
        function setVolume(v) {
            video.volume = Math.max(0, Math.min(1, v));
            video.muted = video.volume == 0;
            ctx.osd(Math.round(video.volume * 100) + "%", "music");
        }

        /* Subtitles --------------------------------------------------------- */
        function refreshTrack() {
            Array.prototype.slice.call(video.querySelectorAll("track")).forEach(function (t) {
                if (t.src.indexOf("blob:") == 0) {
                    URL.revokeObjectURL(t.src);
                }
                t.remove();
            });
            if (!st.cues || st.track < 0) {
                ccBtn.classList.remove("on");
                return;
            }
            var url = URL.createObjectURL(new Blob([toVTT(st.cues, st.offset)], { type: "text/vtt" }));
            var tr = document.createElement("track");
            tr.kind = "subtitles";
            tr.label = st.tracks[st.track].label;
            tr.src = url;
            tr.default = true;
            video.appendChild(tr);
            setTimeout(function () {
                if (video.textTracks[0]) {
                    video.textTracks[0].mode = "showing";
                }
            }, 0);
            ccBtn.classList.add("on");
        }

        function chooseTrack(n) {
            if (n < 0) {
                st.track = -1;
                st.cues = null;
                mem.subtitles = false;
                refreshTrack();
                ctx.osd(T("vw/subsOff", "Subtitles off"), null);
                return;
            }
            var tr = st.tracks[n];
            tr.load().then(function (cues) {
                if (st.destroyed) {
                    return;
                }
                st.track = n;
                st.cues = cues;
                mem.subtitles = true;
                refreshTrack();
                ctx.osd(tr.label, null);
            }).catch(function () {
                DriveUI.toast(T("vw/subsFailed", "This subtitle track could not be loaded"), { type: "error" });
            });
        }

        function discoverTracks() {
            var base = item.name.replace(/\.[^.]+$/, "").toLowerCase();
            var parent = API.parentOf(item.path);
            var sidecars = API.list(parent, false).then(function (items) {
                return items.filter(function (i) {
                    var ext = DriveIcons.getExt(i.name);
                    return !i.isDir && ["srt", "vtt", "ass", "ssa"].indexOf(ext) >= 0 && i.name.toLowerCase().indexOf(base) == 0;
                }).map(function (i) {
                    var rest = i.name.substring(base.length).replace(/\.[^.]+$/, "").replace(/^[.\s_-]+/, "");
                    return {
                        label: rest ? (LANG[rest.toLowerCase()] || rest) : i.name,
                        load: function () {
                            return API.readText(i.path).then(function (text) { return parseSubtitles(text, DriveIcons.getExt(i.name)); });
                        }
                    };
                });
            }).catch(function () { return []; });
            var embedded = U.fetchJSON(API.ROOT + "media/subtitles/?file=" + encodeURIComponent(item.path)).then(function (info) {
                return ((info && info.subtitles) || []).filter(function (s) { return s.textual; }).map(function (s, n) {
                    var lang = LANG[String(s.language || "").toLowerCase()] || s.language;
                    return {
                        label: (s.title || lang || T("vw/track", "Track {n}", { n: n + 1 })) + (s.title && lang ? " (" + lang + ")" : "") + " · " + T("vw/embedded", "built in"),
                        default: s.default,
                        load: function () {
                            return fetch(API.ROOT + "media/subtitles/?file=" + encodeURIComponent(item.path) + "&track=" + s.index, { credentials: "same-origin" })
                                .then(function (r) { return r.text(); }).then(function (t) { return parseSubtitles(t, "srt"); });
                        }
                    };
                });
            }).catch(function () { return []; });
            Promise.all([sidecars, embedded]).then(function (r) {
                if (st.destroyed) {
                    return;
                }
                st.tracks = r[0].concat(r[1]);
                ccBtn.hidden = st.tracks.length == 0;
                if (st.tracks.length && mem.subtitles !== false) {
                    var def = 0;
                    st.tracks.forEach(function (t, n) {
                        if (t.default) {
                            def = n;
                        }
                    });
                    if (mem.subtitles) {
                        chooseTrack(def);
                    }
                }
            });
        }

        function subtitleMenu(anchor) {
            DriveUI.menu({ anchor: anchor, align: "end", above: vp.querySelector(".vp-controls .seek") || true }, [{ title: T("vw/subtitles", "Subtitles") },
            { checkable: true, checked: st.track < 0, label: T("vw/off", "Off"), action: function () { chooseTrack(-1); } }].concat(st.tracks.map(function (t, n) {
                return { checkable: true, checked: st.track == n, label: t.label, action: function () { chooseTrack(n); } };
            })));
        }

        function settingsMenu(anchor) {
            var items = [{
                icon: "clock", label: T("vw/speed", "Speed") + ": " + (st.speed == 1 ? T("vw/normal", "Normal") : st.speed + "x"), submenu: SPEEDS.map(function (s) {
                    return { checkable: true, checked: st.speed == s, label: s == 1 ? T("vw/normal", "Normal") : s + "x", action: function () { setSpeed(s); } };
                })
            }];
            if (st.canTranscode) {
                items.push({
                    icon: "sliders", label: T("vw/quality", "Quality") + ": " + (st.mode == "direct" ? T("vw/originalFile", "Original file") : (st.res == "original" ? T("vw/compat", "Compatible") : st.res)), submenu: [
                        { checkable: true, checked: st.mode == "direct", label: T("vw/originalFile", "Original file"), action: function () { if (st.mode != "direct") { var t = now(); st.mode = "direct"; load(t, true); } } },
                        "-",
                        { title: T("vw/compatTitle", "Converted by the server") },
                        { checkable: true, checked: st.mode == "transcode" && st.res == "original", label: T("vw/sameRes", "Same resolution"), action: function () { st.res = "original"; st.mode == "transcode" ? load(now(), true) : switchToTranscode(); } },
                        { checkable: true, checked: st.mode == "transcode" && st.res == "1080p", label: "1080p", action: function () { st.res = "1080p"; st.mode == "transcode" ? load(now(), true) : switchToTranscode(); } },
                        { checkable: true, checked: st.mode == "transcode" && st.res == "720p", label: "720p", action: function () { st.res = "720p"; st.mode == "transcode" ? load(now(), true) : switchToTranscode(); } },
                        { checkable: true, checked: st.mode == "transcode" && st.res == "360p", label: T("vw/dataSaver", "360p (data saver)"), action: function () { st.res = "360p"; st.mode == "transcode" ? load(now(), true) : switchToTranscode(); } }
                    ]
                });
            }
            items.push("-");
            items.push({ checkable: true, checked: video.loop, label: T("vw/loop", "Loop"), action: function () { video.loop = !video.loop; ctx.osd(video.loop ? T("vw/loopOn", "Loop on") : T("vw/loopOff", "Loop off"), "refresh"); } });
            if (ctx.list.length > 1) {
                items.push({ checkable: true, checked: mem.autoplay, label: T("vw/autoplay", "Play the next video"), action: function () { mem.autoplay = !mem.autoplay; } });
            }
            DriveUI.menu({ anchor: anchor, align: "end", above: vp.querySelector(".vp-controls .seek") || true }, items);
        }

        function setSpeed(s) {
            st.speed = s;
            video.playbackRate = s;
            ctx.osd(s + "x", "clock");
        }

        /* Play state and controls visibility -------------------------------- */
        function togglePlay() {
            if (video.paused || video.ended) {
                var p = video.play();
                if (p && p.catch) {
                    p.catch(function () { });
                }
            } else {
                video.pause();
            }
        }

        var idleTimer = null;
        function wake() {
            vp.classList.remove("idle");
            clearTimeout(idleTimer);
            idleTimer = setTimeout(function () {
                if (!video.paused && !vp.querySelector(".vp-controls:hover") && !DriveUI.menuOpen()) {
                    vp.classList.add("idle");
                }
            }, 2600);
        }
        vp.addEventListener("pointermove", wake);
        vp.addEventListener("pointerdown", wake);

        var clickTimer = null;
        var lastTap = 0;
        video.addEventListener("click", function (e) {
            if (e.pointerType === "touch") {
                return;
            }
            clearTimeout(clickTimer);
            clickTimer = setTimeout(togglePlay, 220);
        });
        video.addEventListener("dblclick", function () {
            clearTimeout(clickTimer);
            ctx.fullscreen(vp);
        });
        //Touch: tap shows the controls, a double tap on either side skips 10 seconds
        video.addEventListener("pointerup", function (e) {
            if (e.pointerType !== "touch") {
                return;
            }
            var t = Date.now();
            var r = vp.getBoundingClientRect();
            if (t - lastTap < 300) {
                var left = e.clientX - r.left < r.width / 2;
                seekTo(now() + (left ? -10 : 10));
                ctx.osd(left ? "-10 s" : "+10 s", left ? "arrowLeft" : "arrowRight");
                lastTap = 0;
            } else {
                lastTap = t;
                if (vp.classList.contains("idle")) {
                    wake();
                } else if (!video.paused) {
                    vp.classList.add("idle");
                }
            }
        });

        big.addEventListener("click", togglePlay);
        vp.querySelectorAll("[data-c]").forEach(function (b) {
            if (b.tagName == "INPUT") {
                return;
            }
            b.addEventListener("click", function (e) {
                e.stopPropagation();
                var c = b.getAttribute("data-c");
                if (c == "play") {
                    togglePlay();
                } else if (c == "prev") {
                    ctx.go(-1);
                } else if (c == "next") {
                    ctx.go(1);
                } else if (c == "mute") {
                    video.muted = !video.muted;
                    if (!video.muted && video.volume == 0) {
                        video.volume = 0.6;
                    }
                } else if (c == "cc") {
                    subtitleMenu(b);
                } else if (c == "settings") {
                    settingsMenu(b);
                } else if (c == "pip") {
                    if (document.pictureInPictureElement) {
                        document.exitPictureInPicture().catch(function () { });
                    } else {
                        video.requestPictureInPicture().catch(function () { });
                    }
                } else if (c == "fs") {
                    ctx.fullscreen(vp);
                }
            });
        });

        var onFs = function () {
            var fsBtn = vp.querySelector('[data-c="fs"]');
            if (fsBtn) {
                fsBtn.innerHTML = fsIcon(document.fullscreenElement === vp);
            }
        };
        document.addEventListener("fullscreenchange", onFs);

        /* Video events -------------------------------------------------------- */
        var lastSave = 0;
        video.addEventListener("play", function () {
            big.classList.add("hide");
            playBtn.innerHTML = I("pause");
            playBtn.title = T("vw/pause", "Pause") + " (K)";
            wake();
            if ("mediaSession" in navigator) {
                navigator.mediaSession.playbackState = "playing";
            }
        });
        video.addEventListener("pause", function () {
            playBtn.innerHTML = I("play");
            playBtn.title = T("vw/play", "Play") + " (K)";
            vp.classList.remove("idle");
            saveResume(item.path, now(), total());
            if ("mediaSession" in navigator) {
                navigator.mediaSession.playbackState = "paused";
            }
        });
        video.addEventListener("waiting", function () { vp.classList.add("buffering"); });
        video.addEventListener("playing", function () { vp.classList.remove("buffering"); });
        video.addEventListener("canplay", function () { vp.classList.remove("buffering"); });
        video.addEventListener("loadedmetadata", function () {
            vp.classList.remove("buffering");
            updateBadge();
            renderTime();
        });
        video.addEventListener("timeupdate", function () {
            renderTime();
            if (Date.now() - lastSave > 5000) {
                lastSave = Date.now();
                saveResume(item.path, now(), total());
            }
        });
        video.addEventListener("progress", function () { renderTime(); });
        video.addEventListener("volumechange", function () {
            renderVolume();
            store("drive_media_volume", { v: video.volume, m: video.muted });
        });
        video.addEventListener("ended", function () {
            saveResume(item.path, 0, total());
            if (mem.autoplay && ctx.hasNext && !video.loop) {
                ctx.osd(T("vw/upNext", "Up next: {name}", { name: ctx.list[ctx.index + 1].name }), "play");
                setTimeout(function () {
                    if (!st.destroyed) {
                        mem.autostart = true;
                        ctx.go(1);
                    }
                }, 1500);
            } else {
                big.classList.remove("hide");
            }
        });
        video.addEventListener("error", function () {
            if (st.destroyed || !video.getAttribute("src")) {
                return;
            }
            vp.classList.remove("buffering");
            if (st.mode == "direct" && st.canTranscode && !st.triedTranscode) {
                st.triedTranscode = true;
                switchToTranscode("error");
                return;
            }
            showFailure();
        });

        function showFailure() {
            var box = DriveUI.el('<div style="position:absolute;inset:0;display:flex;z-index:6;background:rgba(0,0,0,.85)"></div>');
            box.innerHTML = U.stateHTML(item, T("pv/cannotPlay", "This video format cannot be played in the browser."),
                st.canTranscode ? T("vw/convertFailed", "The server could not convert it either.") : T("vw/noFfmpeg", "Ask the administrator to install ffmpeg on the server to play it in compatible mode."),
                [{ id: "dl", icon: "download", label: T("toolbar/download", "Download"), primary: true }]);
            U.bindState(box, { dl: function () { DriveActions.download([item]); } });
            vp.appendChild(box);
        }

        /* Media Session ------------------------------------------------------- */
        if ("mediaSession" in navigator) {
            try {
                navigator.mediaSession.metadata = new MediaMetadata({ title: item.name, artist: Drive.locationLabel(item.path), album: "ArozOS Drive" });
                navigator.mediaSession.setActionHandler("play", function () { video.play(); });
                navigator.mediaSession.setActionHandler("pause", function () { video.pause(); });
                navigator.mediaSession.setActionHandler("seekbackward", function () { seekTo(now() - 10); });
                navigator.mediaSession.setActionHandler("seekforward", function () { seekTo(now() + 10); });
                navigator.mediaSession.setActionHandler("previoustrack", ctx.hasPrev ? function () { ctx.go(-1); } : null);
                navigator.mediaSession.setActionHandler("nexttrack", ctx.hasNext ? function () { ctx.go(1); } : null);
            } catch (e) { }
        }

        /* Start ----------------------------------------------------------------- */
        var resume = resumeOf(item.path);
        var autostart = mem.autostart !== false;
        mem.autostart = true;

        function begin(probe) {
            if (st.destroyed) {
                return;
            }
            if (probe) {
                st.canTranscode = true;
                if (probe.directPlay === false) {
                    st.mode = "transcode";
                    st.triedTranscode = true;
                    U.fetchJSON(API.ROOT + "media/duration/?file=" + encodeURIComponent(item.path)).then(function (r) {
                        if (r && r.duration > 0) {
                            st.duration = r.duration;
                            renderTime();
                        }
                    }).catch(function () { });
                }
            }
            load(0, autostart && !resume);
            if (resume) {
                showResume();
            }
            //Previews and subtitles are extras: never hold playback for them
            if (st.canTranscode) {
                U.fetchJSON(API.ROOT + "media/storyboard/?file=" + encodeURIComponent(item.path)).then(function (layout) {
                    if (layout && layout.count > 0) {
                        layout.image = API.ROOT + "media/storyboard/?file=" + encodeURIComponent(item.path) + "&image=1";
                        st.storyboard = layout;
                        if (!st.duration && layout.duration) {
                            st.duration = layout.duration;
                        }
                        new Image().src = layout.image;
                    }
                }).catch(function () { });
            }
            discoverTracks();
        }

        function showResume() {
            var chip = DriveUI.el('<div class="vp-chip">' + I("history") + '<span>' + esc(T("vw/resumeFrom", "Resume from {time}", { time: U.fmtTime(resume.t) })) + '</span>' +
                '<button class="vw-btn primary" data-r="yes">' + esc(T("vw/resume", "Resume")) + '</button>' +
                '<button class="vw-btn" data-r="no">' + esc(T("vw/startOver", "Start over")) + '</button></div>');
            vp.appendChild(chip);
            var gone = function () { chip.remove(); };
            chip.querySelector('[data-r="yes"]').addEventListener("click", function (e) {
                e.stopPropagation();
                gone();
                seekTo(resume.t);
                video.play().catch(function () { });
            });
            chip.querySelector('[data-r="no"]').addEventListener("click", function (e) {
                e.stopPropagation();
                gone();
                video.play().catch(function () { });
            });
            setTimeout(gone, 12000);
        }

        U.fetchJSON(API.ROOT + "media/probe/?file=" + encodeURIComponent(item.path)).then(begin).catch(function () { begin(null); });

        return {
            shortcuts: [
                [T("vw/playPause", "Play / pause"), "Space / K"], [T("vw/back10", "Back / forward 10 s"), "J / L"],
                [T("vw/back5", "Back / forward 5 s"), "Left / Right"], [T("vw/volume", "Volume"), "Up / Down"],
                [T("vw/mute", "Mute"), "M"], [T("vw/fullscreen", "Full screen"), "F"], [T("vw/subtitles", "Subtitles"), "C"],
                [T("vw/speed", "Speed"), "< / >"], [T("vw/jump", "Jump to 0% - 90%"), "0 - 9"], [T("vw/keyPrevNext", "Previous / next"), "Shift + P / Shift + N"]
            ],
            key: function (e) {
                if (e.ctrlKey || e.metaKey || e.altKey) {
                    return false;
                }
                var k = e.key;
                wake();
                if (k == " " || k == "k" || k == "K") {
                    togglePlay();
                } else if (k == "ArrowLeft") {
                    seekTo(now() - 5);
                    ctx.osd("-5 s", "arrowLeft");
                } else if (k == "ArrowRight") {
                    seekTo(now() + 5);
                    ctx.osd("+5 s", "arrowRight");
                } else if (k == "j" || k == "J") {
                    seekTo(now() - 10);
                    ctx.osd("-10 s", "arrowLeft");
                } else if (k == "l" || k == "L") {
                    seekTo(now() + 10);
                    ctx.osd("+10 s", "arrowRight");
                } else if (k == "ArrowUp") {
                    setVolume(video.volume + 0.05);
                } else if (k == "ArrowDown") {
                    setVolume(video.volume - 0.05);
                } else if (k == "m" || k == "M") {
                    video.muted = !video.muted;
                    ctx.osd(video.muted ? T("vw/muted", "Muted") : Math.round(video.volume * 100) + "%", "music");
                } else if (k == "f" || k == "F") {
                    ctx.fullscreen(vp);
                } else if (k == "c" || k == "C") {
                    if (!st.tracks.length) {
                        return true;
                    }
                    chooseTrack(st.track < 0 ? 0 : (st.track + 1 < st.tracks.length ? st.track + 1 : -1));
                } else if (k == ">" || k == ".") {
                    setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(st.speed) + 1)]);
                } else if (k == "<" || k == ",") {
                    setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(st.speed) - 1)]);
                } else if (/^[0-9]$/.test(k)) {
                    var d = total();
                    if (d) {
                        seekTo(d * parseInt(k, 10) / 10);
                    }
                } else if (k == "Home") {
                    seekTo(0);
                } else if (k == "End") {
                    seekTo(total());
                } else if (k == "N") {
                    ctx.go(1);
                } else if (k == "P") {
                    ctx.go(-1);
                } else {
                    return false;
                }
                e.preventDefault();
                return true;
            },
            destroy: function () {
                st.destroyed = true;
                saveResume(item.path, now(), total());
                clearTimeout(idleTimer);
                document.removeEventListener("fullscreenchange", onFs);
                if (document.pictureInPictureElement === video) {
                    document.exitPictureInPicture().catch(function () { });
                }
                video.pause();
                video.removeAttribute("src");
                video.load();
                st.cues = null;
                refreshTrack();
            }
        };
    }

    DriveViewer.register(["video"], { mount: mount });
})();
