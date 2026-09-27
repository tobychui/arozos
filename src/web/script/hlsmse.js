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

    Behaving like Safari's native player
      The pages using this treat it as a drop-in for native HLS, so it keeps
      the same contract: video.seekable spans every segment the playlist lists
      (not just what has been downloaded), which is how a page tells a seek it
      can make in place from one that needs the transcode restarted.

    Recovery
      • A segment download that fails on the network or with a server error
        is retried with backoff; a 404/403 is not, since it means the server
        session is gone and only reopening the stream helps.
      • A watchdog steps over small holes between segments, and points the
        download cursor back at the playhead if its media is neither buffered
        nor on the way.
      • Anything it cannot recover from is reported once through
        options.onError, after which the player stops. The caller is expected
        to reopen the stream (the Movie app restarts the transcode there).

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
// Retries after a failed segment download, the first waiting RETRY_DELAY_MS
// and each one after that twice as long as the one before.
var SEGMENT_RETRIES = 3;
var RETRY_DELAY_MS = 500;
// A download with no answer by then is abandoned and retried. A server
// segment is a few seconds of video, so this only trips on a hung connection.
var SEGMENT_TIMEOUT_MS = 20000;
// How often the stall watchdog looks at the element.
var STALL_CHECK_MS = 1000;
// The largest hole between buffered ranges the watchdog skips over. Holes this
// small come from audio and video starting a few frames apart at a segment
// boundary; they never fill in, and some browsers will not play across them.
var GAP_TOLERANCE_SECONDS = 1;
// How long playback may sit stuck on media the playlist already lists before
// the player gives up and reports it. Waiting on a transcode that has not yet
// produced the next segment never counts towards this.
var STALL_FAIL_MS = 30000;
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
    this.failed = false;

    this.mediaSource = null;
    this.sourceBuffer = null;
    this.playlist = null;
    this.initBuffer = null;
    this.refreshTimer = null;
    this.objectURL = null;

    // Download cursor. nextIndex is the next segment to fetch; a segment in
    // flight is recorded separately, so a seek landing mid-download can move
    // the cursor without the finished download moving it again.
    this.nextIndex = 0;
    this.appending = false;
    this.inflightIndex = -1;
    this.inflightAbort = null;
    // Bumped every time the cursor is moved by something other than a
    // download completing. A download started under an older generation is
    // discarded when it lands.
    this.cursorGeneration = 0;
    // A segment that arrived while the buffer was busy (removing, or the
    // previous append still running), appended on the next updateend.
    this.pendingAppend = null;

    // Stall watchdog state
    this.stallTicks = 0;
    this.healedIndex = -1;
    this.watchdogTimer = null;

    this._onSourceOpen = this._onSourceOpen.bind(this);
    this._pump = this._pump.bind(this);
    this._onSeeking = this._onSeeking.bind(this);
    this._onUpdateEnd = this._onUpdateEnd.bind(this);
    this._checkStall = this._checkStall.bind(this);

    this.mediaSource = new global.MediaSource();
    this.objectURL = URL.createObjectURL(this.mediaSource);
    this.mediaSource.addEventListener('sourceopen', this._onSourceOpen);
    this.video.addEventListener('timeupdate', this._pump);
    this.video.addEventListener('seeking', this._onSeeking);
    this.video.src = this.objectURL;
    this.watchdogTimer = setInterval(this._checkStall, STALL_CHECK_MS);
}

// Report an unrecoverable failure, once. The player stops working after this:
// the caller is expected to tear it down and reopen the stream.
Player.prototype._fail = function (reason, err) {
    if (this.destroyed || this.failed) { return; }
    this.failed = true;
    clearInterval(this.watchdogTimer);
    clearTimeout(this.refreshTimer);
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
            self.sourceBuffer.addEventListener('updateend', self._onUpdateEnd);
            self.sourceBuffer.addEventListener('error', function () {
                self._fail('The browser rejected a media segment');
            });
            self._syncDuration();
            self._append(buffer);
        });
    }).catch(function (err) {
        self._fail('Could not start the HLS stream', err);
    });
};

Player.prototype._onUpdateEnd = function () {
    if (this.destroyed) { return; }
    if (this.pendingAppend) {
        var buffer = this.pendingAppend;
        this.pendingAppend = null;
        this._append(buffer);
        return;
    }
    // Setting the duration is refused while the buffer is updating, so a
    // playlist refresh that arrived meanwhile is applied here
    this._syncDuration();
    this._pump();
};

// Fetch one segment (or the init segment), retrying transient failures.
//
// isCurrent is checked before every retry; once it returns false (a seek has
// moved the cursor elsewhere) the download is abandoned instead of retried.
Player.prototype._fetch = function (url, isCurrent) {
    var self = this;
    var attempt = 0;

    function tryOnce() {
        var controller = global.AbortController ? new global.AbortController() : null;
        var timedOut = false;
        var timer = null;
        if (controller) {
            self.inflightAbort = controller;
            timer = setTimeout(function () { timedOut = true; controller.abort(); }, SEGMENT_TIMEOUT_MS);
        }

        return fetch(url, { credentials: 'same-origin', signal: controller ? controller.signal : undefined })
            .then(function (response) {
                if (!response.ok) {
                    var httpErr = new Error('HTTP ' + response.status + ' for ' + url);
                    // 404/403 mean the session behind this stream is gone or
                    // was never ours: asking again cannot change the answer
                    httpErr.retryable = response.status >= 500;
                    throw httpErr;
                }
                return response.arrayBuffer();
            })
            .then(function (buffer) {
                clearTimeout(timer);
                return buffer;
            }, function (err) {
                clearTimeout(timer);
                if (self.destroyed || (isCurrent && !isCurrent())) { throw err; }
                // An abort that was not the timeout came from a seek or teardown
                if (err && err.name === 'AbortError' && !timedOut) { throw err; }
                if ((err && err.retryable === false) || attempt >= SEGMENT_RETRIES) { throw err; }
                var wait = RETRY_DELAY_MS * Math.pow(2, attempt);
                attempt++;
                return new Promise(function (resolve) { setTimeout(resolve, wait); }).then(function () {
                    if (self.destroyed || (isCurrent && !isCurrent())) { throw err; }
                    return tryOnce();
                });
            });
    }
    return tryOnce();
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
            self._syncDuration();
            self._scheduleRefresh();
        });
};

// A playlist still being written grows as the transcode advances, so keep
// re-reading it until the server marks it complete.
Player.prototype._scheduleRefresh = function () {
    var self = this;
    clearTimeout(this.refreshTimer);
    if (this.destroyed || this.failed || !this.playlist || this.playlist.ended) { return; }

    // Half a segment, but never more than two seconds. The page decides whether
    // a seek can be served in place from how far this playlist reaches, and
    // the first copy lists a single segment (the server answers as soon as one
    // exists). With a hardware encoder that ignores forced keyframes, segments
    // run to 10s or more, and a stale playlist turns seeks into needless
    // transcode restarts.
    var wait = Math.max(1000, Math.min(2000, (this.playlist.targetDuration || 4) * 500));
    this.refreshTimer = setTimeout(function () {
        if (self.destroyed) { return; }
        self._loadPlaylist().then(function () { self._pump(); })
            .catch(function () { self._scheduleRefresh(); });
    }, wait);
};

// Publish the playlist's length as the media duration.
//
// Media Source reports seekable as 0..duration, and left alone the duration
// only ever reaches the end of what has been appended — about half a minute
// past the playhead. A page asking "has the transcode got this far?" would
// then be told no for segments that exist, and restart ffmpeg for nothing.
// Using the playlist's length gives the same answer Safari's native player
// does for an EVENT playlist: everything the transcode has produced so far.
Player.prototype._syncDuration = function () {
    var ms = this.mediaSource;
    if (!ms || ms.readyState !== 'open' || !this.playlist) { return; }
    // Refused while an append or removal is running; retried on updateend
    if (this.sourceBuffer && this.sourceBuffer.updating) { return; }

    var target = this.playlist.duration;
    if (!(target > 0)) { return; }
    // Only ever grow it. Shrinking below the buffered media is refused, and a
    // finished stream's endOfStream() settles it a fraction under the
    // playlist's rounded total, which is not worth fighting over.
    if (!isNaN(ms.duration) && target <= ms.duration + 0.5) { return; }
    try { ms.duration = target; } catch (e) { /* retried on the next refresh */ }
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

// Whether there is media to play at `time`, with a little room after it.
Player.prototype._isBufferedAt = function (time) {
    var buffered = this.video.buffered;
    for (var i = 0; i < buffered.length; i++) {
        if (buffered.start(i) <= time && time < buffered.end(i) - 0.1) { return true; }
    }
    return false;
};

// Whether a segment's whole span is already in the buffer. The edges are
// allowed some slack: audio and video rarely start and end on exactly the
// segment's nominal boundary.
Player.prototype._isSegmentBuffered = function (segment) {
    var buffered = this.video.buffered;
    var start = segment.start + 0.2;
    var end = segment.start + segment.duration - 0.2;
    for (var i = 0; i < buffered.length; i++) {
        if (buffered.start(i) <= start && end <= buffered.end(i)) { return true; }
    }
    return false;
};

Player.prototype._segmentIndexForTime = function (time) {
    var segments = this.playlist ? this.playlist.segments : [];
    for (var i = 0; i < segments.length; i++) {
        if (time < segments[i].start + segments[i].duration) { return i; }
    }
    return segments.length;
};

// Point the download cursor at `index`, abandoning whatever download is in
// flight. The abandoned download's result is dropped when it lands (see the
// generation check in _pump), so it can neither be appended out of turn nor
// move the cursor off the segment that is now wanted.
Player.prototype._retarget = function (index) {
    this.cursorGeneration++;
    if (this.inflightAbort) {
        try { this.inflightAbort.abort(); } catch (e) {}
        this.inflightAbort = null;
    }
    this.appending = false;
    this.inflightIndex = -1;
    this.nextIndex = index;
    this._pump();
};

Player.prototype._onSeeking = function () {
    if (this.destroyed || !this.playlist || !this.sourceBuffer) { return; }
    var target = this.video.currentTime;

    // Already buffered around the target: let the browser play it.
    if (this._isBufferedAt(target)) { return; }

    // Otherwise restart the download cursor at the segment covering the target.
    this._retarget(this._segmentIndexForTime(target));
};

// Drive downloads: keep a window buffered ahead of the playhead, and trim what
// is far behind so a long session does not grow without bound.
Player.prototype._pump = function () {
    var self = this;
    if (this.destroyed || this.failed || !this.sourceBuffer || this.sourceBuffer.updating || this.appending) { return; }
    if (!this.playlist) { return; }

    this._trimBehind();

    // After a backward seek the cursor walks forward over segments that are
    // still buffered from before; fetching those again only costs bandwidth.
    var segments = this.playlist.segments;
    while (this.nextIndex < segments.length && this._isSegmentBuffered(segments[this.nextIndex])) {
        this.nextIndex++;
    }

    if (this.nextIndex >= segments.length) {
        if (this.playlist.ended && this.mediaSource.readyState === 'open') {
            try { this.mediaSource.endOfStream(); } catch (e) {}
        }
        return;
    }
    if (this._bufferedAhead() > BUFFER_AHEAD_SECONDS) { return; }

    var index = this.nextIndex;
    var generation = this.cursorGeneration;
    var isCurrent = function () { return generation === self.cursorGeneration; };

    this.appending = true;
    this.inflightIndex = index;
    this._fetch(segments[index].url, isCurrent).then(function (buffer) {
        // A seek moved the cursor while this was downloading. It has already
        // cleared the in-flight state and started the download it wants.
        if (!isCurrent()) { return; }
        self.appending = false;
        self.inflightIndex = -1;
        self.inflightAbort = null;
        if (self.destroyed || !self.sourceBuffer) { return; }
        self.nextIndex = index + 1;
        self._append(buffer);
    }).catch(function (err) {
        if (!isCurrent()) { return; }
        self.appending = false;
        self.inflightIndex = -1;
        self.inflightAbort = null;
        self._fail('A media segment failed to load', err);
    });
};

Player.prototype._append = function (buffer) {
    if (this.destroyed || !this.sourceBuffer) { return; }
    if (this.sourceBuffer.updating) {
        // A removal started by the trim is still running; append once it ends
        this.pendingAppend = buffer;
        return;
    }
    try {
        this.sourceBuffer.appendBuffer(new Uint8Array(buffer));
    } catch (err) {
        // A full buffer is recoverable: drop what is behind and retry once the
        // removal has finished.
        if (err && err.name === 'QuotaExceededError' && this._trimBehind(true)) {
            this.pendingAppend = buffer;
            return;
        }
        this._fail('The browser rejected a media segment', err);
    }
};

// Remove media far behind the playhead. Returns true when a removal was
// started (the buffer is then updating until the next updateend).
Player.prototype._trimBehind = function (aggressive) {
    if (!this.sourceBuffer || this.sourceBuffer.updating) { return false; }
    var keep = aggressive ? 5 : BUFFER_BEHIND_SECONDS;
    var cutoff = this.video.currentTime - keep;
    if (cutoff <= 0) { return false; }

    var buffered = this.sourceBuffer.buffered;
    if (!buffered.length) { return false; }
    if (buffered.start(0) < cutoff) {
        try { this.sourceBuffer.remove(buffered.start(0), cutoff); return true; } catch (e) {}
    }
    return false;
};

// Step over a small hole just ahead of the playhead. Returns true if it moved
// the playhead.
Player.prototype._jumpGap = function (time) {
    if (this._isBufferedAt(time)) { return false; }
    var buffered = this.video.buffered;
    for (var i = 0; i < buffered.length; i++) {
        var start = buffered.start(i);
        if (start > time && start - time <= GAP_TOLERANCE_SECONDS) {
            this.video.currentTime = start + 0.05;
            return true;
        }
    }
    return false;
};

// Runs every STALL_CHECK_MS. Playback that cannot move on is nudged past a
// small hole first, then has its missing media fetched again, and is only
// reported as failed once neither has helped for STALL_FAIL_MS.
Player.prototype._checkStall = function () {
    if (this.destroyed || this.failed || !this.sourceBuffer || !this.playlist) { return; }
    var video = this.video;

    // HAVE_FUTURE_DATA or better: the element can move on by itself
    if (video.ended || video.readyState >= 3) {
        this.stallTicks = 0;
        this.healedIndex = -1;
        return;
    }
    this.stallTicks++;
    // One quiet tick is normal: the next segment is often mid-append
    if (this.stallTicks < 2) { return; }

    var time = video.currentTime;
    if (this._jumpGap(time)) { return; }

    var index = this._segmentIndexForTime(time);
    if (index >= this.playlist.segments.length) {
        // Waiting on the transcode to produce the next segment. Nothing is
        // wrong on this side, so none of this counts as a stall.
        this.stallTicks = 0;
        return;
    }

    // The media for the playhead is neither buffered nor being downloaded.
    // Whatever left the cursor elsewhere, bring it back — once per segment,
    // so a segment that genuinely cannot fill the hole does not loop.
    var onItsWay = (this.appending && this.inflightIndex === index) ||
        this.pendingAppend !== null || this.sourceBuffer.updating;
    if (!onItsWay && !this._isBufferedAt(time) && this.healedIndex !== index) {
        this.healedIndex = index;
        this._retarget(index);
        return;
    }

    // A download in flight has its own timeout and retries, and a paused
    // viewer is not waiting on anything
    if (onItsWay || video.paused) { return; }
    if (this.stallTicks * STALL_CHECK_MS >= STALL_FAIL_MS) {
        this._fail('Playback stalled and could not recover');
    }
};

Player.prototype.destroy = function () {
    this.destroyed = true;
    clearTimeout(this.refreshTimer);
    clearInterval(this.watchdogTimer);
    this.video.removeEventListener('timeupdate', this._pump);
    this.video.removeEventListener('seeking', this._onSeeking);
    if (this.inflightAbort) {
        try { this.inflightAbort.abort(); } catch (e) {}
        this.inflightAbort = null;
    }
    this.pendingAppend = null;

    if (this.sourceBuffer) {
        this.sourceBuffer.removeEventListener('updateend', this._onUpdateEnd);
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
