/*
    hlsmse.js — a small HLS player built on Media Source Extensions

    Safari plays HLS natively; nothing else does. The usual answer is hls.js,
    but that is a large third-party bundle to vendor and keep updated. This
    module covers the one case ArozOS actually serves: a single-variant,
    server-generated playlist of fragmented-MP4 segments.

    fMP4 is what makes this short. Segments can be appended straight into a
    SourceBuffer, so there is no transport-stream demuxer here — the browser's
    own MP4 parser does that work. (An MPEG-TS playlist would need thousands of
    lines of demuxing, which is exactly why the server emits fMP4.)

    Supported
      • EVENT and VOD media playlists, including ones still being written
      • #EXT-X-MAP initialisation segments
      • Seeking anywhere inside the playlist, and buffer trimming behind
      • Codec detection read from the init segment, so the SourceBuffer is
        created with the stream's real profile rather than a guess

    Not supported (by design — the server never produces them)
      • Master playlists / multiple variants / bitrate switching
      • MPEG-TS segments, encryption, discontinuities, subtitle renditions
*/
(function (global) {
'use strict';

// How far ahead of the playhead to keep buffered before pausing downloads.
var BUFFER_AHEAD_SECONDS = 30;
// How much already-played media to keep before trimming it out of the buffer.
var BUFFER_BEHIND_SECONDS = 30;
// Fallback codecs when the init segment cannot be parsed: the server always
// encodes H.264 High + AAC-LC, so this is the right shape even if the exact
// profile digits differ.
var FALLBACK_CODECS = 'avc1.640029,mp4a.40.2';

function isSupported() {
    if (!global.MediaSource || !global.MediaSource.isTypeSupported) { return false; }
    return global.MediaSource.isTypeSupported('video/mp4; codecs="' + FALLBACK_CODECS + '"');
}

// ─── Playlist ─────────────────────────────────────────────────────────────────

// Resolve a possibly-relative playlist URI against the playlist's own location.
function resolveURI(uri, playlistURL) {
    try { return new URL(uri, new URL(playlistURL, global.location.href)).href; }
    catch (e) { return uri; }
}

function parsePlaylist(text, playlistURL) {
    var out = { segments: [], initURL: null, ended: false, targetDuration: 4 };
    var lines = String(text).replace(/\r/g, '').split('\n');
    var pendingDuration = 0;

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) { continue; }

        if (line.charAt(0) === '#') {
            if (line.indexOf('#EXTINF:') === 0) {
                pendingDuration = parseFloat(line.slice(8)) || 0;
            } else if (line.indexOf('#EXT-X-MAP:') === 0) {
                var m = line.match(/URI="([^"]*)"/);
                if (m) { out.initURL = resolveURI(m[1], playlistURL); }
            } else if (line.indexOf('#EXT-X-TARGETDURATION:') === 0) {
                out.targetDuration = parseFloat(line.slice(22)) || 4;
            } else if (line.indexOf('#EXT-X-ENDLIST') === 0) {
                out.ended = true;
            }
            continue;
        }

        out.segments.push({
            url: resolveURI(line, playlistURL),
            duration: pendingDuration,
            start: 0   // filled in below
        });
        pendingDuration = 0;
    }

    var clock = 0;
    for (var s = 0; s < out.segments.length; s++) {
        out.segments[s].start = clock;
        clock += out.segments[s].duration;
    }
    out.duration = clock;
    return out;
}

// ─── Codec detection ──────────────────────────────────────────────────────────

// Walk the init segment's box tree for the sample entries, so the SourceBuffer
// is created with the codecs actually present rather than an assumption.
function codecsFromInitSegment(buffer) {
    var view = new DataView(buffer);
    var bytes = new Uint8Array(buffer);
    var video = null;
    var audio = null;

    function fourcc(offset) {
        return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    }

    // Containers whose payload is simply more boxes
    var containers = { moov: 8, trak: 8, mdia: 8, minf: 8, stbl: 8, stsd: 16 };

    function walk(start, end) {
        var offset = start;
        while (offset + 8 <= end) {
            var size = view.getUint32(offset);
            var type = fourcc(offset + 4);
            if (size < 8 || offset + size > end) { return; }

            if (containers[type] !== undefined) {
                walk(offset + containers[type], offset + size);
            } else if (type === 'avc1' || type === 'avc3') {
                video = readAvcC(offset + 8 + 78, offset + size) || 'avc1.640029';
            } else if (type === 'hvc1' || type === 'hev1') {
                video = type + '.1.6.L93.B0';   // rare here; the server encodes H.264
            } else if (type === 'mp4a') {
                audio = 'mp4a.40.2';
            }
            offset += size;
        }
    }

    // avcC carries profile / constraint flags / level, which form the codec string
    function readAvcC(start, end) {
        var offset = start;
        while (offset + 8 <= end) {
            var size = view.getUint32(offset);
            var type = fourcc(offset + 4);
            if (size < 8 || offset + size > end) { return null; }
            if (type === 'avcC') {
                var profile = bytes[offset + 9];
                var compat = bytes[offset + 10];
                var level = bytes[offset + 11];
                return 'avc1.' + hex2(profile) + hex2(compat) + hex2(level);
            }
            offset += size;
        }
        return null;
    }

    function hex2(n) { return (n < 16 ? '0' : '') + n.toString(16); }

    try { walk(0, bytes.length); } catch (e) { return null; }

    var parts = [];
    if (video) { parts.push(video); }
    if (audio) { parts.push(audio); }
    return parts.length ? parts.join(',') : null;
}

// ─── Player ───────────────────────────────────────────────────────────────────

function Player(videoEl, playlistURL, options) {
    this.video = videoEl;
    this.playlistURL = playlistURL;
    this.options = options || {};
    this.destroyed = false;

    this.mediaSource = null;
    this.sourceBuffer = null;
    this.playlist = null;
    this.initBuffer = null;
    this.nextIndex = 0;
    this.appending = false;
    this.refreshTimer = null;
    this.objectURL = null;

    this._onSourceOpen = this._onSourceOpen.bind(this);
    this._pump = this._pump.bind(this);
    this._onSeeking = this._onSeeking.bind(this);

    this.mediaSource = new global.MediaSource();
    this.objectURL = URL.createObjectURL(this.mediaSource);
    this.mediaSource.addEventListener('sourceopen', this._onSourceOpen);
    this.video.addEventListener('timeupdate', this._pump);
    this.video.addEventListener('seeking', this._onSeeking);
    this.video.src = this.objectURL;
}

Player.prototype._fail = function (reason, err) {
    if (this.destroyed) { return; }
    if (typeof this.options.onError === 'function') { this.options.onError(reason, err); }
};

Player.prototype._onSourceOpen = function () {
    var self = this;
    if (this.destroyed) { return; }

    this._loadPlaylist().then(function () {
        if (self.destroyed || !self.playlist) { return; }
        if (!self.playlist.initURL) {
            throw new Error('playlist has no initialisation segment');
        }
        return self._fetch(self.playlist.initURL).then(function (buffer) {
            if (self.destroyed) { return; }
            self.initBuffer = buffer;

            var codecs = codecsFromInitSegment(buffer) || FALLBACK_CODECS;
            var mime = 'video/mp4; codecs="' + codecs + '"';
            if (!global.MediaSource.isTypeSupported(mime)) {
                mime = 'video/mp4; codecs="' + FALLBACK_CODECS + '"';
            }

            self.sourceBuffer = self.mediaSource.addSourceBuffer(mime);
            self.sourceBuffer.addEventListener('updateend', self._pump);
            self.sourceBuffer.addEventListener('error', function () {
                self._fail('The browser rejected a media segment');
            });
            self._append(buffer);
        });
    }).catch(function (err) {
        self._fail('Could not start the HLS stream', err);
    });
};

Player.prototype._fetch = function (url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (response) {
        if (!response.ok) { throw new Error('HTTP ' + response.status + ' for ' + url); }
        return response.arrayBuffer();
    });
};

Player.prototype._loadPlaylist = function () {
    var self = this;
    return fetch(this.playlistURL, { credentials: 'same-origin', cache: 'no-store' })
        .then(function (response) {
            if (!response.ok) { throw new Error('HTTP ' + response.status + ' for the playlist'); }
            return response.text();
        })
        .then(function (text) {
            if (self.destroyed) { return; }
            self.playlist = parsePlaylist(text, self.playlistURL);
            self._scheduleRefresh();
        });
};

// A playlist still being written grows as the transcode advances, so keep
// re-reading it until the server marks it complete.
Player.prototype._scheduleRefresh = function () {
    var self = this;
    clearTimeout(this.refreshTimer);
    if (this.destroyed || !this.playlist || this.playlist.ended) { return; }

    var wait = Math.max(1000, (this.playlist.targetDuration || 4) * 500);
    this.refreshTimer = setTimeout(function () {
        if (self.destroyed) { return; }
        self._loadPlaylist().then(function () { self._pump(); })
            .catch(function () { self._scheduleRefresh(); });
    }, wait);
};

Player.prototype._bufferedAhead = function () {
    var buffered = this.video.buffered;
    var time = this.video.currentTime;
    for (var i = 0; i < buffered.length; i++) {
        if (buffered.start(i) <= time + 0.25 && time < buffered.end(i)) {
            return buffered.end(i) - time;
        }
    }
    return 0;
};

Player.prototype._segmentIndexForTime = function (time) {
    var segments = this.playlist ? this.playlist.segments : [];
    for (var i = 0; i < segments.length; i++) {
        if (time < segments[i].start + segments[i].duration) { return i; }
    }
    return segments.length;
};

Player.prototype._onSeeking = function () {
    if (this.destroyed || !this.playlist || !this.sourceBuffer) { return; }
    var target = this.video.currentTime;

    // Already buffered around the target: let the browser play it.
    var buffered = this.video.buffered;
    for (var i = 0; i < buffered.length; i++) {
        if (buffered.start(i) <= target && target < buffered.end(i) - 0.1) { return; }
    }

    // Otherwise restart the append cursor at the segment covering the target.
    this.nextIndex = this._segmentIndexForTime(target);
    this._pump();
};

// Drive downloads: keep a window buffered ahead of the playhead, and trim what
// is far behind so a long session does not grow without bound.
Player.prototype._pump = function () {
    var self = this;
    if (this.destroyed || !this.sourceBuffer || this.sourceBuffer.updating || this.appending) { return; }
    if (!this.playlist) { return; }

    this._trimBehind();

    if (this.nextIndex >= this.playlist.segments.length) {
        if (this.playlist.ended && this.mediaSource.readyState === 'open') {
            try { this.mediaSource.endOfStream(); } catch (e) {}
        }
        return;
    }
    if (this._bufferedAhead() > BUFFER_AHEAD_SECONDS) { return; }

    var segment = this.playlist.segments[this.nextIndex];
    this.appending = true;
    this._fetch(segment.url).then(function (buffer) {
        self.appending = false;
        if (self.destroyed || !self.sourceBuffer) { return; }
        self.nextIndex++;
        self._append(buffer);
    }).catch(function (err) {
        self.appending = false;
        self._fail('A media segment failed to load', err);
    });
};

Player.prototype._append = function (buffer) {
    if (this.destroyed || !this.sourceBuffer) { return; }
    try {
        this.sourceBuffer.appendBuffer(new Uint8Array(buffer));
    } catch (err) {
        // A full buffer is recoverable: drop what is behind and retry once.
        if (err && err.name === 'QuotaExceededError') {
            this._trimBehind(true);
            try { this.sourceBuffer.appendBuffer(new Uint8Array(buffer)); return; } catch (e) {}
        }
        this._fail('The browser rejected a media segment', err);
    }
};

Player.prototype._trimBehind = function (aggressive) {
    if (!this.sourceBuffer || this.sourceBuffer.updating) { return; }
    var keep = aggressive ? 5 : BUFFER_BEHIND_SECONDS;
    var cutoff = this.video.currentTime - keep;
    if (cutoff <= 0) { return; }

    var buffered = this.sourceBuffer.buffered;
    if (!buffered.length) { return; }
    if (buffered.start(0) < cutoff) {
        try { this.sourceBuffer.remove(buffered.start(0), cutoff); } catch (e) {}
    }
};

Player.prototype.destroy = function () {
    this.destroyed = true;
    clearTimeout(this.refreshTimer);
    this.video.removeEventListener('timeupdate', this._pump);
    this.video.removeEventListener('seeking', this._onSeeking);

    if (this.sourceBuffer) {
        try { this.sourceBuffer.abort(); } catch (e) {}
        this.sourceBuffer = null;
    }
    if (this.mediaSource && this.mediaSource.readyState === 'open') {
        try { this.mediaSource.endOfStream(); } catch (e) {}
    }
    if (this.objectURL) {
        try { URL.revokeObjectURL(this.objectURL); } catch (e) {}
        this.objectURL = null;
    }
    this.mediaSource = null;
};

global.MovieHLS = {
    isSupported: isSupported,
    attach: function (videoEl, playlistURL, options) {
        return new Player(videoEl, playlistURL, options);
    },
    // exposed for tests
    _parsePlaylist: parsePlaylist,
    _codecsFromInitSegment: codecsFromInitSegment
};

})(window);
