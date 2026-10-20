/*
    viewer.audio.js

    Music player: album art and tags read from the file itself (ID3v2 for
    MP3, metadata blocks for FLAC; the server thumbnail is the fallback for
    the art), a spectrum visualiser on the Web Audio API, the other tracks of
    the folder as a queue, shuffle and repeat, speed, and the Media Session
    API so keyboard media keys and the lock screen control it.

    One AudioContext is shared by every track so that moving to the next
    song never needs a new user gesture to be heard.
*/

(function () {
    "use strict";

    var I = DriveUI.I;
    var esc = DriveUI.esc;
    var API = DriveAPI;
    var U = DriveViewer.util;

    var audioCtx = null;
    var tagCache = {};
    var SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
    var BROWSER_FORMATS = { mp3: 1, m4a: 1, aac: 1, wav: 1, ogg: 1, oga: 1, opus: 1, flac: 1, weba: 1 };

    /* Reading tags ----------------------------------------------------------- */

    //Read the first maxBytes of a file, aborting the transfer once there is enough
    function readHead(path, maxBytes) {
        var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
        return fetch(API.mediaURL(path), {
            credentials: "same-origin",
            headers: { Range: "bytes=0-" + (maxBytes - 1) },
            signal: ctl ? ctl.signal : undefined
        }).then(function (r) {
            if (!r.body || !r.body.getReader) {
                return r.arrayBuffer().then(function (b) { return new Uint8Array(b.slice(0, maxBytes)); });
            }
            var reader = r.body.getReader();
            var chunks = [], got = 0;
            function pump() {
                return reader.read().then(function (res) {
                    if (res.done || got >= maxBytes) {
                        if (!res.done && ctl) {
                            ctl.abort();
                        }
                        var out = new Uint8Array(Math.min(got, maxBytes));
                        var off = 0;
                        chunks.forEach(function (c) {
                            var take = Math.min(c.length, out.length - off);
                            if (take > 0) {
                                out.set(c.subarray(0, take), off);
                                off += take;
                            }
                        });
                        return out;
                    }
                    chunks.push(res.value);
                    got += res.value.length;
                    return pump();
                });
            }
            return pump();
        });
    }

    function decodeText(bytes, enc) {
        try {
            var label = enc == 1 ? "utf-16" : enc == 2 ? "utf-16be" : enc == 3 ? "utf-8" : "latin1";
            return new TextDecoder(label).decode(bytes).replace(/\u0000+$/g, "").replace(/\u0000/g, " ").trim();
        } catch (e) {
            return "";
        }
    }

    function syncsafe(b, o) {
        return (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
    }

    function parseID3(b) {
        if (b.length < 10 || b[0] != 0x49 || b[1] != 0x44 || b[2] != 0x33) {
            return null;
        }
        var ver = b[3];
        var size = syncsafe(b, 6) + 10;
        var tags = { needed: size };
        var pos = 10;
        if (b[5] & 0x40) {
            pos += ver == 4 ? syncsafe(b, 10) : ((b[10] << 24) | (b[11] << 16) | (b[12] << 8) | b[13]) + 4;
        }
        var end = Math.min(size, b.length);
        while (pos + 10 <= end) {
            var id = String.fromCharCode(b[pos], b[pos + 1], b[pos + 2], b[pos + 3]);
            if (!/^[A-Z0-9]{4}$/.test(id)) {
                break;
            }
            var fsize = ver == 4 ? syncsafe(b, pos + 4) : ((b[pos + 4] << 24) | (b[pos + 5] << 16) | (b[pos + 6] << 8) | b[pos + 7]);
            var data = b.subarray(pos + 10, Math.min(pos + 10 + fsize, b.length));
            if (fsize <= 0) {
                break;
            }
            if (id == "TIT2" || id == "TPE1" || id == "TALB" || id == "TYER" || id == "TDRC" || id == "TRCK" || id == "TPE2") {
                var text = decodeText(data.subarray(1), data[0]);
                var keys = { TIT2: "title", TPE1: "artist", TALB: "album", TYER: "year", TDRC: "year", TRCK: "track", TPE2: "albumArtist" };
                tags[keys[id]] = text;
            } else if (id == "APIC" && !tags.picture && data.length > 10) {
                var enc = data[0];
                var i = 1;
                var mime = "";
                while (i < data.length && data[i] != 0) {
                    mime += String.fromCharCode(data[i++]);
                }
                i += 2; //null + picture type
                //Description, terminated by one or two zero bytes depending on the encoding
                if (enc == 1 || enc == 2) {
                    while (i + 1 < data.length && !(data[i] == 0 && data[i + 1] == 0)) {
                        i += 2;
                    }
                    i += 2;
                } else {
                    while (i < data.length && data[i] != 0) {
                        i++;
                    }
                    i++;
                }
                if (i < data.length) {
                    tags.picture = new Blob([data.slice(i)], { type: mime.indexOf("/") > 0 ? mime : "image/jpeg" });
                }
            }
            pos += 10 + fsize;
        }
        return tags;
    }

    function parseFLAC(b) {
        if (b.length < 8 || String.fromCharCode(b[0], b[1], b[2], b[3]) != "fLaC") {
            return null;
        }
        var tags = {};
        var pos = 4;
        while (pos + 4 <= b.length) {
            var last = b[pos] & 0x80, type = b[pos] & 0x7f;
            var len = (b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3];
            var body = b.subarray(pos + 4, Math.min(pos + 4 + len, b.length));
            var dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
            try {
                if (type == 4) {
                    var vlen = dv.getUint32(0, true);
                    var n = dv.getUint32(4 + vlen, true);
                    var p = 8 + vlen;
                    for (var k = 0; k < n && p + 4 <= body.length; k++) {
                        var clen = dv.getUint32(p, true);
                        var c = new TextDecoder("utf-8").decode(body.subarray(p + 4, p + 4 + clen));
                        p += 4 + clen;
                        var eq = c.indexOf("=");
                        var key = c.substring(0, eq).toUpperCase(), val = c.substring(eq + 1);
                        var map = { TITLE: "title", ARTIST: "artist", ALBUM: "album", DATE: "year", TRACKNUMBER: "track", ALBUMARTIST: "albumArtist" };
                        if (map[key] && !tags[map[key]]) {
                            tags[map[key]] = val;
                        }
                    }
                } else if (type == 6 && !tags.picture) {
                    var q = 4;
                    var mlen = dv.getUint32(q, false);
                    var mime = new TextDecoder().decode(body.subarray(q + 4, q + 4 + mlen));
                    q += 4 + mlen;
                    var dlen = dv.getUint32(q, false);
                    q += 4 + dlen + 16;
                    var plen = dv.getUint32(q, false);
                    tags.picture = new Blob([body.slice(q + 4, q + 4 + plen)], { type: mime || "image/jpeg" });
                }
            } catch (e) {
                //Truncated block: keep what was read
            }
            if (last) {
                break;
            }
            pos += 4 + len;
        }
        return tags;
    }

    function readTags(item) {
        if (tagCache[item.path]) {
            return Promise.resolve(tagCache[item.path]);
        }
        var ext = DriveIcons.getExt(item.name);
        if (ext != "mp3" && ext != "flac") {
            return Promise.resolve({});
        }
        return readHead(item.path, 512 * 1024).then(function (b) {
            var tags = ext == "flac" ? parseFLAC(b) : parseID3(b);
            if (tags && tags.needed && tags.needed > b.length && tags.needed < 6 * 1024 * 1024) {
                //Large embedded picture: read the whole tag once
                return readHead(item.path, tags.needed).then(function (b2) { return parseID3(b2) || {}; });
            }
            return tags || {};
        }).catch(function () { return {}; }).then(function (tags) {
            tagCache[item.path] = tags;
            return tags;
        });
    }

    function title(item, tags) {
        return (tags && tags.title) || item.name.replace(/\.[^.]+$/, "");
    }

    /* ---------------------------------------------------------------------- */
    function mount(ctx) {
        var item = ctx.item;
        var mem = ctx.memory;
        mem.repeat = mem.repeat || "off"; //off | all | one
        var ext = DriveIcons.getExt(item.name);
        var vol = (function () {
            try { return JSON.parse(localStorage.getItem("drive_media_volume") || "null"); } catch (e) { return null; }
        })();
        var st = { mode: BROWSER_FORMATS[ext] ? "direct" : "transcode", offset: 0, duration: 0, speed: mem.speed || 1, destroyed: false, tried: false, artURL: "" };

        ctx.body.innerHTML =
            '<div class="ap"><div class="ap-main"><div class="ap-bg"></div><div class="ap-stage">' +
            '<div class="ap-art">' + I("music") + '</div>' +
            '<div class="ap-meta"><h2></h2><p></p></div>' +
            '<canvas class="ap-vis"></canvas>' +
            '<div class="ap-seek"><div data-seek></div><div class="ap-times"><span data-cur>0:00</span><span data-dur>--:--</span></div></div>' +
            '<div class="ap-ctrl">' +
            '<button class="vp-btn' + (mem.shuffle ? " on" : "") + '" data-c="shuffle" title="' + esc(T("vw/shuffle", "Shuffle")) + ' (S)">' + shuffleIcon() + '</button>' +
            '<button class="vp-btn" data-c="prev" title="' + esc(T("pv/prev", "Previous")) + ' (P)">' + skipIcon(true) + '</button>' +
            '<button class="vp-btn ap-play" data-c="play" title="' + esc(T("vw/play", "Play")) + '">' + I("play") + '</button>' +
            '<button class="vp-btn" data-c="next" title="' + esc(T("pv/next", "Next")) + ' (N)">' + skipIcon(false) + '</button>' +
            '<button class="vp-btn' + (mem.repeat != "off" ? " on" : "") + '" data-c="repeat" title="' + esc(T("vw/repeat", "Repeat")) + ' (R)">' + repeatIcon(mem.repeat) + '</button>' +
            '</div>' +
            '<div class="ap-extra"><button class="vp-btn" data-c="mute"></button><input class="vw-range" type="range" min="0" max="1" step="0.02" data-c="vol" aria-label="' + esc(T("vw/volume", "Volume")) + '">' +
            '<button class="vp-btn" data-c="speed" title="' + esc(T("vw/speed", "Speed")) + '" style="width:auto;padding:0 10px;font-size:13px;font-weight:600">' + st.speed + 'x</button></div>' +
            '</div></div><aside class="vw-panel ap-side"><div class="ap-side-head"><span>' + esc(T("vw/queue", "Queue")) + '</span><small>' +
            esc(T("drag/items", "{n} items", { n: ctx.list.length })) + '</small></div><div class="ap-list vw-scroll"></div></aside></div><audio preload="metadata"></audio>';

        var main = ctx.body.querySelector(".ap-main");
        var audio = ctx.body.querySelector("audio");
        var art = main.querySelector(".ap-art");
        var bg = main.querySelector(".ap-bg");
        var canvas = main.querySelector(".ap-vis");
        var playBtn = main.querySelector('[data-c="play"]');
        var volInput = main.querySelector('[data-c="vol"]');
        var muteBtn = main.querySelector('[data-c="mute"]');
        var listEl = ctx.body.querySelector(".ap-list");

        main.querySelector("h2").textContent = title(item, null);
        main.querySelector("p").textContent = Drive.locationLabel(item.path);

        function skipIcon(back) {
            return '<svg class="ic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
                (back ? '<path d="M6 5h2v14H6zM19 5.5v13l-9.5-6.5z"/>' : '<path d="M16 5h2v14h-2zM5 5.5v13l9.5-6.5z"/>') + '</svg>';
        }
        function shuffleIcon() {
            return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                '<path d="M3 7h3.5c2 0 3.2 1 4.3 2.7l2.4 4.6c1.1 1.7 2.3 2.7 4.3 2.7H21"/><path d="M3 17h3.5c1.4 0 2.4-.5 3.2-1.4M14.3 8.4c.8-.9 1.8-1.4 3.2-1.4H21"/><path d="M18.5 4.5 21 7l-2.5 2.5M18.5 14.5 21 17l-2.5 2.5"/></svg>';
        }
        function repeatIcon(mode) {
            return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                '<path d="M4 11V9a3 3 0 0 1 3-3h12"/><path d="M16 3l3 3-3 3"/><path d="M20 13v2a3 3 0 0 1-3 3H5"/><path d="M8 21l-3-3 3-3"/>' +
                (mode == "one" ? '<text x="12" y="14.6" text-anchor="middle" font-size="7.5" font-weight="700" fill="currentColor" stroke="none" font-family="Segoe UI,Arial,sans-serif">1</text>' : "") + '</svg>';
        }
        function volIcon() {
            var v = audio.muted ? 0 : audio.volume;
            var waves = v == 0 ? '<path d="M16 9.5l5 5M21 9.5l-5 5"/>' : (v < 0.5 ? '<path d="M15.5 9.2a4 4 0 0 1 0 5.6"/>' : '<path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.3 6.6a7.6 7.6 0 0 1 0 10.8"/>');
            return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor"/>' + waves + '</svg>';
        }

        /* Queue ---------------------------------------------------------------- */
        function renderQueue() {
            listEl.innerHTML = "";
            ctx.list.forEach(function (it, n) {
                var active = n == ctx.index;
                var row = DriveUI.el('<button class="ap-track' + (active ? " active" : "") + '"><span class="n">' +
                    (active ? '<span class="eq' + (audio.paused ? " paused" : "") + '"><i></i><i></i><i></i></span>' : (n + 1)) + '</span>' +
                    '<span class="t" title="' + esc(it.name) + '">' + esc(title(it, tagCache[it.path])) + '</span><small>' + esc(DriveUI.fmtSize(it.size)) + '</small></button>');
                row.addEventListener("click", function () {
                    if (n != ctx.index) {
                        ctx.goTo(it);
                    } else {
                        togglePlay();
                    }
                });
                listEl.appendChild(row);
            });
            var a = listEl.querySelector(".ap-track.active");
            if (a) {
                a.scrollIntoView({ block: "nearest" });
            }
        }

        /* Playback ------------------------------------------------------------- */
        function now() {
            return st.offset + (audio.currentTime || 0);
        }

        function total() {
            if (st.mode == "transcode") {
                return st.duration || 0;
            }
            return isFinite(audio.duration) ? audio.duration : 0;
        }

        function source(start) {
            if (st.mode == "transcode") {
                return API.ROOT + "media/transcode/audio/?file=" + encodeURIComponent(item.path) + (start > 0 ? "&start=" + Math.floor(start) : "");
            }
            return ctx.url;
        }

        function load(start, play) {
            st.offset = st.mode == "transcode" ? Math.max(0, Math.floor(start || 0)) : 0;
            audio.src = source(st.offset);
            audio.playbackRate = st.speed;
            audio.loop = mem.repeat == "one";
            if (st.mode == "direct" && start > 0) {
                audio.addEventListener("loadedmetadata", function once() {
                    audio.removeEventListener("loadedmetadata", once);
                    audio.currentTime = start;
                });
            }
            if (play) {
                audio.play().catch(function () { });
            }
        }

        function seekTo(t) {
            var d = total();
            t = Math.max(0, d ? Math.min(d - 0.2, t) : t);
            if (st.mode == "transcode") {
                load(t, !audio.paused || true);
            } else {
                audio.currentTime = t;
            }
        }

        function togglePlay() {
            if (audio.paused) {
                ensureContext();
                audio.play().catch(function () { });
            } else {
                audio.pause();
            }
        }

        function nextTrack(manual) {
            if (ctx.list.length < 2) {
                if (!manual) {
                    return;
                }
                seekTo(0);
                return;
            }
            if (mem.shuffle) {
                var n;
                do {
                    n = Math.floor(Math.random() * ctx.list.length);
                } while (n == ctx.index);
                ctx.goTo(ctx.list[n]);
            } else if (ctx.hasNext) {
                ctx.go(1);
            } else if (mem.repeat == "all" || manual) {
                ctx.goTo(ctx.list[0]);
            }
        }

        function prevTrack() {
            if (now() > 3 || ctx.list.length < 2) {
                seekTo(0);
                return;
            }
            if (ctx.hasPrev) {
                ctx.go(-1);
            } else {
                ctx.goTo(ctx.list[ctx.list.length - 1]);
            }
        }

        var seek = U.seekBar({
            onSeek: function (f, done) {
                var d = total();
                if (!d) {
                    return;
                }
                if (st.mode == "direct") {
                    audio.currentTime = f * d;
                } else if (done) {
                    seekTo(f * d);
                }
                main.querySelector("[data-cur]").textContent = U.fmtTime(f * d);
            },
            tip: function (f) {
                return U.fmtTime(f * total());
            }
        });
        main.querySelector("[data-seek]").appendChild(seek.el);

        function renderTime() {
            var d = total();
            main.querySelector("[data-cur]").textContent = U.fmtTime(now());
            main.querySelector("[data-dur]").textContent = d ? U.fmtTime(d) : "--:--";
            var buffered = 0;
            try {
                if (audio.buffered.length) {
                    buffered = st.offset + audio.buffered.end(audio.buffered.length - 1);
                }
            } catch (e) { }
            seek.set(d ? now() / d : 0, d ? buffered / d : 0);
        }

        /* Visualiser ---------------------------------------------------------- */
        var analyser = null, srcNode = null, raf = 0, freq = null;

        function ensureContext() {
            if (analyser) {
                if (audioCtx.state == "suspended") {
                    audioCtx.resume();
                }
                return;
            }
            try {
                if (!audioCtx) {
                    var AC = window.AudioContext || window.webkitAudioContext;
                    if (!AC) {
                        return;
                    }
                    audioCtx = new AC();
                }
                if (audioCtx.state == "suspended") {
                    audioCtx.resume();
                }
                srcNode = audioCtx.createMediaElementSource(audio);
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 256;
                analyser.smoothingTimeConstant = 0.78;
                srcNode.connect(analyser);
                analyser.connect(audioCtx.destination);
                freq = new Uint8Array(analyser.frequencyBinCount);
            } catch (e) {
                analyser = null;
            }
        }

        function draw() {
            raf = requestAnimationFrame(draw);
            var dpr = window.devicePixelRatio || 1;
            var w = canvas.clientWidth, h = canvas.clientHeight;
            if (canvas.width != w * dpr) {
                canvas.width = w * dpr;
                canvas.height = h * dpr;
            }
            var g = canvas.getContext("2d");
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            g.clearRect(0, 0, w, h);
            var bars = 48;
            var gap = 3;
            var bw = (w - gap * (bars - 1)) / bars;
            var grad = g.createLinearGradient(0, h, 0, 0);
            grad.addColorStop(0, "rgba(91,147,255,.9)");
            grad.addColorStop(1, "rgba(190,120,255,.9)");
            g.fillStyle = grad;
            if (analyser && !audio.paused) {
                analyser.getByteFrequencyData(freq);
            }
            for (var i = 0; i < bars; i++) {
                var v = 0;
                if (freq && analyser && !audio.paused) {
                    //Lower bins carry most of the energy: spread them out
                    var idx = Math.floor(Math.pow(i / bars, 1.6) * (freq.length * 0.85));
                    v = freq[idx] / 255;
                }
                var bh = Math.max(3, v * h);
                var x = i * (bw + gap);
                g.globalAlpha = 0.35 + v * 0.65;
                roundRect(g, x, h - bh, bw, bh, Math.min(3, bw / 2));
            }
            g.globalAlpha = 1;
        }

        function roundRect(g, x, y, w, h, r) {
            g.beginPath();
            g.moveTo(x + r, y);
            g.arcTo(x + w, y, x + w, y + h, r);
            g.lineTo(x + w, y + h);
            g.lineTo(x, y + h);
            g.arcTo(x, y, x + w, y, r);
            g.closePath();
            g.fill();
        }

        /* Art and tags ---------------------------------------------------------- */
        function setArt(url) {
            if (!url) {
                return;
            }
            var img = new Image();
            img.onload = function () {
                if (st.destroyed) {
                    return;
                }
                art.innerHTML = "";
                art.appendChild(img);
                bg.style.backgroundImage = "url('" + url + "')";
                updateSession(url);
            };
            img.src = url;
        }

        function updateSession(artwork) {
            if (!("mediaSession" in navigator)) {
                return;
            }
            var tags = tagCache[item.path] || {};
            try {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: title(item, tags), artist: tags.artist || "", album: tags.album || "ArozOS Drive",
                    artwork: artwork ? [{ src: artwork, sizes: "512x512" }] : []
                });
            } catch (e) { }
        }

        readTags(item).then(function (tags) {
            if (st.destroyed) {
                return;
            }
            main.querySelector("h2").textContent = title(item, tags);
            var sub = [tags.artist || tags.albumArtist, tags.album, tags.year].filter(Boolean).join(" · ");
            main.querySelector("p").textContent = sub || Drive.locationLabel(item.path);
            ctx.setMeta();
            if (tags.picture) {
                st.artURL = URL.createObjectURL(tags.picture);
                setArt(st.artURL);
            } else if (API.caps.fm) {
                setArt(API.thumbURL(item.path) + "&t=" + (item.mtime || 0));
            }
            updateSession(st.artURL);
            renderQueue();
        });

        /* Volume ------------------------------------------------------------- */
        function renderVolume() {
            muteBtn.innerHTML = volIcon();
            volInput.value = audio.muted ? 0 : audio.volume;
            U.rangeFill(volInput);
        }
        audio.volume = vol && typeof vol.v === "number" ? vol.v : 1;
        audio.muted = !!(vol && vol.m);
        renderVolume();
        volInput.addEventListener("input", function () {
            audio.volume = parseFloat(volInput.value);
            audio.muted = audio.volume == 0;
        });

        /* Controls ------------------------------------------------------------- */
        main.querySelectorAll("[data-c]").forEach(function (b) {
            if (b.tagName == "INPUT") {
                return;
            }
            b.addEventListener("click", function () {
                var c = b.getAttribute("data-c");
                if (c == "play") {
                    togglePlay();
                } else if (c == "next") {
                    nextTrack(true);
                } else if (c == "prev") {
                    prevTrack();
                } else if (c == "shuffle") {
                    mem.shuffle = !mem.shuffle;
                    b.classList.toggle("on", mem.shuffle);
                    ctx.osd(mem.shuffle ? T("vw/shuffleOn", "Shuffle on") : T("vw/shuffleOff", "Shuffle off"), null);
                } else if (c == "repeat") {
                    mem.repeat = mem.repeat == "off" ? "all" : mem.repeat == "all" ? "one" : "off";
                    audio.loop = mem.repeat == "one";
                    b.classList.toggle("on", mem.repeat != "off");
                    b.innerHTML = repeatIcon(mem.repeat);
                    ctx.osd(mem.repeat == "off" ? T("vw/repeatOff", "Repeat off") : mem.repeat == "all" ? T("vw/repeatAll", "Repeat all") : T("vw/repeatOne", "Repeat one"), null);
                } else if (c == "mute") {
                    audio.muted = !audio.muted;
                    if (!audio.muted && audio.volume == 0) {
                        audio.volume = 0.6;
                    }
                } else if (c == "speed") {
                    DriveUI.menu({ anchor: b, above: true }, SPEEDS.map(function (s) {
                        return {
                            checkable: true, checked: st.speed == s, label: s == 1 ? T("vw/normal", "Normal") : s + "x", action: function () {
                                st.speed = s;
                                mem.speed = s;
                                audio.playbackRate = s;
                                b.textContent = s + "x";
                            }
                        };
                    }));
                }
            });
        });

        audio.addEventListener("play", function () {
            playBtn.innerHTML = I("pause");
            renderQueue();
            if (!raf) {
                draw();
            }
            if ("mediaSession" in navigator) {
                navigator.mediaSession.playbackState = "playing";
            }
        });
        audio.addEventListener("pause", function () {
            playBtn.innerHTML = I("play");
            renderQueue();
            if ("mediaSession" in navigator) {
                navigator.mediaSession.playbackState = "paused";
            }
        });
        audio.addEventListener("timeupdate", renderTime);
        audio.addEventListener("progress", renderTime);
        audio.addEventListener("loadedmetadata", renderTime);
        audio.addEventListener("volumechange", function () {
            renderVolume();
            try { localStorage.setItem("drive_media_volume", JSON.stringify({ v: audio.volume, m: audio.muted })); } catch (e) { }
        });
        audio.addEventListener("ended", function () {
            if (mem.repeat != "one") {
                nextTrack(false);
            }
        });
        audio.addEventListener("error", function () {
            if (st.destroyed || !audio.getAttribute("src")) {
                return;
            }
            if (st.mode == "direct" && !st.tried) {
                st.tried = true;
                U.fetchJSON(API.ROOT + "media/duration/?file=" + encodeURIComponent(item.path)).then(function (r) {
                    st.mode = "transcode";
                    st.duration = (r && r.duration) || 0;
                    load(0, true);
                }).catch(function () { failed(); });
                return;
            }
            failed();
        });

        function failed() {
            main.innerHTML = U.stateHTML(item, T("vw/audioFailed", "This audio file cannot be played in the browser."),
                T("vw/noFfmpeg", "Ask the administrator to install ffmpeg on the server to play it in compatible mode."),
                [{ id: "dl", icon: "download", label: T("toolbar/download", "Download"), primary: true }]);
            U.bindState(main, { dl: function () { DriveActions.download([item]); } });
        }

        if ("mediaSession" in navigator) {
            try {
                navigator.mediaSession.setActionHandler("play", function () { audio.play(); });
                navigator.mediaSession.setActionHandler("pause", function () { audio.pause(); });
                navigator.mediaSession.setActionHandler("previoustrack", prevTrack);
                navigator.mediaSession.setActionHandler("nexttrack", function () { nextTrack(true); });
                navigator.mediaSession.setActionHandler("seekbackward", function () { seekTo(now() - 10); });
                navigator.mediaSession.setActionHandler("seekforward", function () { seekTo(now() + 10); });
            } catch (e) { }
        }

        renderQueue();
        draw();
        if (st.mode == "transcode") {
            U.fetchJSON(API.ROOT + "media/duration/?file=" + encodeURIComponent(item.path)).then(function (r) {
                st.duration = (r && r.duration) || 0;
                renderTime();
            }).catch(function () { });
        }
        ensureContext();
        load(0, true);

        //Warm the tag cache of the queue so its titles fill in
        ctx.list.slice(Math.max(0, ctx.index - 3), ctx.index + 12).forEach(function (it, n) {
            setTimeout(function () {
                if (!st.destroyed && !tagCache[it.path]) {
                    readTags(it).then(function () {
                        if (!st.destroyed) {
                            renderQueue();
                        }
                    });
                }
            }, 300 + n * 150);
        });

        return {
            shortcuts: [
                [T("vw/playPause", "Play / pause"), "Space"], [T("vw/back5", "Back / forward 5 s"), "Left / Right"],
                [T("vw/volume", "Volume"), "Up / Down"], [T("vw/keyPrevNext", "Previous / next"), "P / N"],
                [T("vw/mute", "Mute"), "M"], [T("vw/shuffle", "Shuffle"), "S"], [T("vw/repeat", "Repeat"), "R"]
            ],
            key: function (e) {
                if (e.ctrlKey || e.metaKey || e.altKey) {
                    return false;
                }
                var k = e.key;
                if (k == " " || k == "k" || k == "K") {
                    togglePlay();
                } else if (k == "ArrowLeft") {
                    seekTo(now() - 5);
                } else if (k == "ArrowRight") {
                    seekTo(now() + 5);
                } else if (k == "ArrowUp") {
                    audio.volume = Math.min(1, audio.volume + 0.05);
                    ctx.osd(Math.round(audio.volume * 100) + "%", "music");
                } else if (k == "ArrowDown") {
                    audio.volume = Math.max(0, audio.volume - 0.05);
                    ctx.osd(Math.round(audio.volume * 100) + "%", "music");
                } else if (k == "n" || k == "N") {
                    nextTrack(true);
                } else if (k == "p" || k == "P") {
                    prevTrack();
                } else if (k == "m" || k == "M") {
                    audio.muted = !audio.muted;
                } else if (k == "s" || k == "S") {
                    main.querySelector('[data-c="shuffle"]').click();
                } else if (k == "r" || k == "R") {
                    main.querySelector('[data-c="repeat"]').click();
                } else {
                    return false;
                }
                e.preventDefault();
                return true;
            },
            destroy: function () {
                st.destroyed = true;
                cancelAnimationFrame(raf);
                raf = 0;
                audio.pause();
                try {
                    if (srcNode) {
                        srcNode.disconnect();
                    }
                    if (analyser) {
                        analyser.disconnect();
                    }
                } catch (e) { }
                audio.removeAttribute("src");
                audio.load();
                if (st.artURL) {
                    setTimeout(function () { URL.revokeObjectURL(st.artURL); }, 1000);
                }
            }
        };
    }

    DriveViewer.register(["audio"], { mount: mount });
})();
