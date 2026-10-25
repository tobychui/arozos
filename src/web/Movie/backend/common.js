/*
    Movie App - Common Configuration
    If the app folder is renamed, update APP_NAME below and all paths
    will automatically adjust everywhere this file is included via requirepkg().
*/

// ── App identity ─────────────────────────────────────────────────────────────
var APP_NAME      = "Movie";
var BACKEND_PATH  = APP_NAME + "/backend/";

// ── Server API endpoints (relative from any page in this app) ────────────────
var MEDIA_API     = "../media";               // ?file=<vpath>  streams a file
var TRANSCODE_API  = "../media/transcode";            // ?file
var HLS_API        = "../media/hls";                  // ?file  same transcode, as an HLS playlist
var PROBE_API      = "../media/probe/";               // ?file  real codecs + playability
var STORYBOARD_API = "../media/storyboard/";          // ?file[&image=1]  scrub previews
var SUBTITLE_API   = "../media/subtitles/";           // ?file[&track=n|&font=n]  embedded tracks
var AGI_INTERFACE = "../system/ajgi/interface?script=";

// ── Script paths (used when calling ao_module_agirun from the frontend) ──────
var SCRIPT_GET_LIBRARY       = BACKEND_PATH + "getLibrary.js";
var SCRIPT_GET_LIBRARY_CACHE = BACKEND_PATH + "getLibraryCache.js";
var SCRIPT_GET_EPISODES  = BACKEND_PATH + "getEpisodes.js";
var SCRIPT_GET_THUMBNAIL = BACKEND_PATH + "getThumbnail.js";
var SCRIPT_LIST_FOLDER   = BACKEND_PATH + "listFolder.js";
var SCRIPT_GET_MOVIE_INFO     = BACKEND_PATH + "getMovieInfo.js";
var SCRIPT_DISABLE_MOVIE_INFO = BACKEND_PATH + "disableMovieInfo.js";
var SCRIPT_GET_WATCHTIME      = BACKEND_PATH + "getWatchTime.js";
var SCRIPT_SET_WATCHTIME      = BACKEND_PATH + "setWatchTime.js";
var SCRIPT_GET_INDEX_STATS    = BACKEND_PATH + "getIndexStats.js";
var SCRIPT_CLEAR_INDEX        = BACKEND_PATH + "clearIndex.js";

// ── Streaming mode ───────────────────────────────────────────────────────────
// Formats the browser cannot decode are transcoded on the fly, and there are
// two ways to deliver that transcode:
//
//   mp4  a single fragmented MP4 streamed down one response. The long-standing
//        default: it starts fastest and costs the server nothing but the ffmpeg
//        process. It cannot answer byte-range requests, which WebKit clients
//        (Safari, and every browser on iOS) require before they will play
//        anything, so on those it fails outright.
//   hls  the same transcode cut into segments behind a playlist. Every segment
//        is a finite, seekable file, so WebKit plays it and seeking inside the
//        transcoded window no longer restarts the stream.
//
// "auto" picks hls on WebKit and mp4 everywhere else (Firefox, Chrome, Edge on
// Windows and Linux). HLS exists for WebKit's sake and is not the better choice
// where MP4 works: the MP4 transcode writes into the response, so the client's
// reading pace holds ffmpeg back and closing the player ends it, while an HLS
// session writes the whole film to temp disk as fast as the CPU allows and
// outlives the player until it is reaped. Other browsers can still choose HLS
// in settings; they play it through Media Source (see nativeHLSSupported).
var STREAM_MODE_KEY = "movie_stream_mode";

// Fired on the <video> element when a Media Source HLS player loses a stream
// it had already bound (session reaped, segments failing, playback stuck),
// with event.detail.reason saying why. Pages treat it like the element's own
// 'error' event, which is how native HLS reports the same thing, and reopen
// the stream where it stopped.
var STREAM_LOST_EVENT = "transcodestreamlost";

// Identifies this player to the HLS endpoint. Seeking outside the transcoded
// window restarts the transcode at a new offset, and the server has no other
// way to tell that the previous one is finished with: the MP4 stream dies with
// its HTTP response, an HLS session does not. Without this every seek leaves
// another ffmpeg racing through the rest of the film, and after a couple of
// jumps the host is too busy to produce the segment the player is waiting for.
//
// One id per page load, so two tabs never retire each other's transcode.
// Restricted to characters the server accepts for this parameter.
var MOVIE_CLIENT_ID = "c" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function isWebKitClient() {
    var ua = navigator.userAgent;
    // On iOS every browser is WebKit underneath, whatever it calls itself.
    if (/CriOS|FxiOS/.test(ua)) { return true; }
    // Chrome, Edge and Opera all carry "Safari" in their desktop UA.
    if (/Chrome\/|Chromium|Edg\/|OPR\/|Firefox\//.test(ua)) { return false; }
    return /Safari/.test(ua);
}

function getStreamMode() {
    var mode = localStorage.getItem(STREAM_MODE_KEY);
    return (mode === "mp4" || mode === "hls") ? mode : "auto";
}

function setStreamMode(mode) {
    if (mode !== "mp4" && mode !== "hls") { mode = "auto"; }
    localStorage.setItem(STREAM_MODE_KEY, mode);
}

// Whether the current preference resolves to HLS for this browser.
function usingHLS() {
    var mode = getStreamMode();
    if (mode === "hls") { return true; }
    if (mode === "mp4") { return false; }
    return isWebKitClient();
}

// ── Streaming quality ────────────────────────────────────────────────────────
// The resolution a transcode is scaled to, on the familiar 360p–1080p ladder.
// Each step also caps the bitrate on the server (kbps below mirrors the
// ceilings in mod/media/transcoder/quality.go), so a lower step is what to pick
// on a slow link. "original" keeps the source resolution and plays the file
// directly whenever the browser can; any other step always transcodes. "auto"
// moves between those on its own, see AutoQualityController below.
//
// Steps are boxes (long × short side) rather than heights so that a portrait
// clip or a 2.4:1 film is judged the way the server will scale it. A step
// larger than the source is not offered: the server never enlarges, so it
// would only cost a transcode for the same picture.
var STREAM_QUALITY_KEY = "movie_stream_quality";
var STREAM_QUALITIES = [
    { id: "auto",     label: "Auto" },
    { id: "original", label: "Original" },
    { id: "1080p", label: "1080p", long: 1920, short: 1080, kbps: 5000 },
    { id: "720p",  label: "720p",  long: 1280, short: 720,  kbps: 2800 },
    { id: "480p",  label: "480p",  long: 854,  short: 480,  kbps: 1400 },
    { id: "360p",  label: "360p",  long: 640,  short: 360,  kbps: 800 }
];

function streamQualityStep(id) {
    for (var i = 0; i < STREAM_QUALITIES.length; i++) {
        if (STREAM_QUALITIES[i].id === id) { return STREAM_QUALITIES[i]; }
    }
    return null;
}

function getStreamQuality() {
    var quality = localStorage.getItem(STREAM_QUALITY_KEY);
    return streamQualityStep(quality) ? quality : "original";
}

function setStreamQuality(quality) {
    if (!streamQualityStep(quality)) { quality = "original"; }
    localStorage.setItem(STREAM_QUALITY_KEY, quality);
}

// Whether a step is worth offering for a source described by a probe result.
// Without one (no ffmpeg, a remote file system, probe still running) every step
// is offered; the server will not enlarge the picture whichever is chosen.
function streamQualityAvailable(id, info) {
    var step = streamQualityStep(id);
    if (!step) { return false; }
    if (!step.long || !info || !(info.width > 0) || !(info.height > 0)) { return true; }
    var long  = Math.max(info.width, info.height);
    var short = Math.min(info.width, info.height);
    return long >= step.long || short >= step.short;
}

// The step a given file actually plays at: the viewer's choice, the step Auto
// is on, or the source resolution when the choice is larger than the file.
function effectiveStreamQuality(filepath) {
    var quality = getStreamQuality();
    if (quality === "auto") { return autoQualityStep(filepath); }
    if (!streamQualityAvailable(quality, cachedMediaInfo(filepath))) { return "original"; }
    return quality;
}

// The &res= parameter for a transcode of this file, or "" at source resolution.
function streamQualityParam(filepath) {
    var quality = effectiveStreamQuality(filepath);
    return quality === "original" ? "" : "&res=" + quality;
}

// ── Auto quality ─────────────────────────────────────────────────────────────
// Auto judges the connection from the video buffer alone; nothing is
// downloaded just to measure it. While the browser is still filling its buffer
// it is downloading as fast as it can, so how many seconds of video arrive per
// second of wall time (the fill rate) says how much faster than real time the
// current step can be delivered. Multiplied by that step's bitrate it gives an
// estimate of what the link carries. That covers a slow server too: an HLS
// transcode that cannot keep up fills slowly, and a smaller step is also
// cheaper to encode.
//
// It only holds while the browser really is downloading. Playing a file
// directly, Chrome keeps a fixed number of bytes ahead and rests in between,
// which it announces with a 'suspend' event, so any measurement spanning a rest
// is thrown away and a resting browser is never taken for one running dry. (The
// Media Source player never rests below 30 seconds ahead, and the element does
// not report suspends for it.)
//
// Once the buffer is full the browser only tops it up, so there is nothing
// left to measure and an old estimate says nothing about a link that has since
// got faster. A buffer that stays full is then the evidence instead: after a
// long stall-free stretch Auto tries the next step up, and the fresh stream's
// own fill rate shows straight away whether it holds.
//
// Every change of step restarts the stream, so Auto is deliberately slow to
// move: down at once on real rebuffering or a buffer running dry, up only one
// step at a time, and a step that did not hold is left alone twice as long as
// the last time before it is tried again. Bitrates are the server's ceilings,
// so estimates are comparative rather than an exact measure of the line.
var AUTO_QUALITY_ESTIMATE_KEY = "movie_auto_quality_kbps";
var AUTO_QUALITY_LADDER  = ["original", "1080p", "720p", "480p", "360p"];   // best first
var AUTO_TICK_MS         = 1000;
var AUTO_FILL_CEILING    = 15;     // seconds ahead below which every browser keeps downloading
var AUTO_SAMPLE_SECONDS  = 8;      // window a fill rate is measured over: two HLS segments, which arrive whole
var AUTO_LOW_BUFFER      = 6;      // seconds ahead that count as running dry
var AUTO_STALL_MS        = 2000;   // a rebuffer at least this long steps down
var AUTO_SEEK_GRACE_MS   = 3000;   // waiting right after a seek is the seek, not the link
var AUTO_SETTLE_MS       = 8000;   // start-up of a fresh stream is not judged
var AUTO_COOLDOWN_MS     = 10000;  // least time between two changes
var AUTO_UP_HOLD_MS      = 45000;  // stall-free time before trying a better step
var AUTO_PROBE_MS        = 60000;  // a step up undone within this did not hold
var AUTO_RETRY_MAX_MS    = 600000; // longest a step that did not hold is left alone
var AUTO_ESTIMATE_FRESH_MS = 60000; // an estimate older than this no longer vetoes a step up
var AUTO_UP_MARGIN       = 1.5;    // headroom wanted over the next step's bitrate
var AUTO_START_MARGIN    = 1.3;    // headroom wanted when choosing where a file starts
var AUTO_DOWN_MARGIN     = 0.8;    // share of the estimate a lower step may use

var _autoQuality = { filepath: null, step: "original" };

function autoQualityEstimate() {
    var kbps = parseFloat(localStorage.getItem(AUTO_QUALITY_ESTIMATE_KEY));
    return kbps > 0 ? kbps : 0;
}

// Steps Auto may use for a file, best first.
function autoQualityLadder(info) {
    return AUTO_QUALITY_LADDER.filter(function (id) { return streamQualityAvailable(id, info); });
}

// Bitrate of a step in kbit/s. The scaled steps have the server's ceiling; the
// source resolution costs what the file does when played as it is, and has no
// ceiling at all when transcoded, where superfast x264 runs above the scaled
// step of the same size.
function streamStepKbps(id, info, transcoded) {
    var step = streamQualityStep(id);
    if (step && step.kbps) { return step.kbps; }
    if (!transcoded && info && info.bitRate > 0) { return info.bitRate / 1000; }
    var ladder = autoQualityLadder(info);
    var sameSize = ladder.length > 1 ? streamQualityStep(ladder[1]) : null;
    return sameSize ? sameSize.kbps * 1.5 : 8000;
}

// The step Auto plays a file at. A new file starts at the best step the last
// estimate can carry, or at Original when there is no estimate yet. The choice
// is only fixed once the file's probe is in, since the steps depend on its size.
function autoQualityStep(filepath) {
    if (_autoQuality.filepath === filepath) { return _autoQuality.step; }
    var info   = cachedMediaInfo(filepath);
    var ladder = autoQualityLadder(info);
    var estimate = autoQualityEstimate();
    var step = ladder[0];
    if (estimate > 0) {
        var transcoded = !(info && info.directPlay);
        step = ladder[ladder.length - 1];
        for (var i = 0; i < ladder.length; i++) {
            if (streamStepKbps(ladder[i], info, transcoded) * AUTO_START_MARGIN <= estimate) {
                step = ladder[i];
                break;
            }
        }
    }
    if (mediaInfoProbed(filepath)) { _autoQuality = { filepath: filepath, step: step }; }
    return step;
}

function setAutoQualityStep(filepath, step) {
    _autoQuality = { filepath: filepath, step: step };
}

// Watches one <video> element and moves Auto between steps. hooks:
//   filepath()     the file playing, or null when Auto should keep still
//                  (nothing playing, or the picture is on a cast receiver)
//   isTranscoded() whether the element is playing a transcode
//   onSwitch(step) re-open the current file at the step just chosen
function AutoQualityController(videoEl, hooks) {
    this.video = videoEl;
    this.hooks = hooks;
    this.window = null;          // fill-rate measurement in progress
    this.rate = null;            // fill rate of the current stream, averaged
    this.estimateAt = 0;         // when this player last measured the link
    this.streamStartedAt = Date.now();
    this.lastSwitchAt = 0;
    this.lastSeekAt = 0;
    this.lastStallAt = 0;
    this.stallStart = 0;
    this.hasPlayed = false;
    this.lastProgressAt = 0;
    this.lastSuspendAt = 0;
    this.file = null;
    this.probe = null;           // the last step up, while it has yet to hold
    this.blocked = {};           // step -> { until, hold } for steps that did not hold

    var self = this;
    videoEl.addEventListener("loadstart", function () {
        // A new stream: a seek-by-reload, a new episode or a change of step
        self.streamStartedAt = Date.now();
        self.window = null;
        self.rate = null;
        self.stallStart = 0;
        self.hasPlayed = false;
    });
    videoEl.addEventListener("progress", function () { self.lastProgressAt = Date.now(); });
    videoEl.addEventListener("suspend", function () { self.lastSuspendAt = Date.now(); });
    videoEl.addEventListener("seeking", function () {
        self.lastSeekAt = Date.now();
        self.window = null;
    });
    videoEl.addEventListener("waiting", function () {
        if (!self.hasPlayed || videoEl.paused) { return; }
        if (Date.now() - self.lastSeekAt < AUTO_SEEK_GRACE_MS) { return; }
        if (!self.stallStart) { self.stallStart = Date.now(); }
    });
    videoEl.addEventListener("playing", function () {
        self.hasPlayed = true;
        if (self.stallStart && Date.now() - self.stallStart >= AUTO_STALL_MS) {
            self.lastStallAt = Date.now();
        }
        self.stallStart = 0;
    });
    this.timer = setInterval(function () { self.tick(); }, AUTO_TICK_MS);
}

// End of the buffered range under the playhead, and how far ahead it reaches.
AutoQualityController.prototype._bufferAhead = function () {
    var buffered = this.video.buffered;
    var time = this.video.currentTime;
    for (var i = 0; i < buffered.length; i++) {
        if (buffered.start(i) <= time + 0.25 && time < buffered.end(i)) {
            return { end: buffered.end(i), ahead: buffered.end(i) - time };
        }
    }
    return { end: time, ahead: 0 };
};

AutoQualityController.prototype._currentKbps = function (filepath) {
    return streamStepKbps(autoQualityStep(filepath), cachedMediaInfo(filepath), this.hooks.isTranscoded());
};

AutoQualityController.prototype._recordRate = function (rate, filepath) {
    rate = Math.max(0, Math.min(rate, 50));
    // Averaged within a stream: a window still catches one segment more or
    // less than the link really delivered
    this.rate = this.rate === null ? rate : (this.rate + rate) / 2;
    this.estimateAt = Date.now();
    var sample = this.rate * this._currentKbps(filepath);
    var previous = autoQualityEstimate();
    var estimate = previous > 0 ? previous * 0.7 + sample * 0.3 : sample;
    try { localStorage.setItem(AUTO_QUALITY_ESTIMATE_KEY, String(Math.round(estimate))); } catch (e) {}
};

// Whether the browser has stopped downloading because it has enough. It fires
// 'progress' and then 'suspend' at the end of each burst, hence the >=.
AutoQualityController.prototype._resting = function () {
    return this.lastSuspendAt > 0 && this.lastSuspendAt >= this.lastProgressAt;
};

// Measure the fill rate, but only while the browser is certainly downloading:
// the buffer is short and it has not rested since the window opened. A window
// spanning a rest would read as a slow link.
AutoQualityController.prototype._sampleFill = function (now, buffer, filepath) {
    var w = this.window;
    if (w && this.lastSuspendAt >= w.t) {
        w = this.window = null;
    }
    if (buffer.ahead >= AUTO_FILL_CEILING) {
        // The browser may rest from here on. A window cut short by getting
        // here is not used either: over a second or two, whether the last
        // segment happened to land inside it decides the reading. A link that
        // fills this fast is not what holds Auto back anyway.
        this.window = null;
        return;
    }
    if (!w || buffer.end < w.end - 0.5) {
        this.window = this._resting() ? null : { t: now, end: buffer.end };
        return;
    }
    var seconds = (now - w.t) / 1000;
    if (seconds >= AUTO_SAMPLE_SECONDS) {
        this._recordRate((buffer.end - w.end) / seconds, filepath);
        this.window = { t: now, end: buffer.end };
    }
};

AutoQualityController.prototype._switch = function (filepath, step, now) {
    var up = AUTO_QUALITY_LADDER.indexOf(step) < AUTO_QUALITY_LADDER.indexOf(autoQualityStep(filepath));
    if (!up && this.probe && now - this.probe.at < AUTO_PROBE_MS) {
        // The last step up did not hold: leave it alone twice as long as before
        var last = this.blocked[this.probe.step];
        var hold = last ? Math.min(last.hold * 2, AUTO_RETRY_MAX_MS) : 2 * AUTO_UP_HOLD_MS;
        this.blocked[this.probe.step] = { until: now + hold, hold: hold };
    }
    this.probe = up ? { step: step, from: autoQualityStep(filepath), at: now } : null;
    this.lastSwitchAt = now;
    setAutoQualityStep(filepath, step);
    if (typeof this.hooks.onSwitch === "function") { this.hooks.onSwitch(step); }
};

AutoQualityController.prototype.tick = function () {
    var video = this.video;
    var filepath = this.hooks.filepath();
    if (getStreamQuality() !== "auto" || !filepath || !mediaInfoProbed(filepath)) {
        this.window = null;
        return;
    }
    // A paused element may stop downloading, which says nothing about the link
    if (video.paused || video.seeking || video.ended) {
        this.window = null;
        return;
    }

    // What a step costs depends on the file, so what failed on the last one
    // says nothing about this one
    if (this.file !== filepath) {
        this.file = filepath;
        this.probe = null;
        this.blocked = {};
    }

    var now = Date.now();
    var buffer = this._bufferAhead();
    this._sampleFill(now, buffer, filepath);
    if (now - this.streamStartedAt < AUTO_SETTLE_MS || now - this.lastSwitchAt < AUTO_COOLDOWN_MS) { return; }

    var info    = cachedMediaInfo(filepath);
    var ladder  = autoQualityLadder(info);
    var current = Math.max(0, ladder.indexOf(autoQualityStep(filepath)));

    var stalled  = this.stallStart && now - this.stallStart >= AUTO_STALL_MS;
    // Running dry: little left, a recent reading below real time, and the
    // browser still trying rather than resting on what it has
    var draining = buffer.ahead < AUTO_LOW_BUFFER && this.rate !== null && this.rate < 0.9 &&
        now - this.estimateAt < 2 * AUTO_SAMPLE_SECONDS * 1000 && !this._resting();
    if ((stalled || draining) && current < ladder.length - 1) {
        // A step up that did not hold goes back to where it came from, as long
        // as the link has not dropped below that too. Otherwise, with a rate
        // measured on this stream, go straight to a step it can carry; without
        // one, a single step is the safe guess.
        var throughput = this.rate !== null ? this.rate * this._currentKbps(filepath) : null;
        var from = this.probe && now - this.probe.at < AUTO_PROBE_MS ? ladder.indexOf(this.probe.from) : -1;
        var target = current + 1;
        if (from > current && (throughput === null || throughput >= streamStepKbps(ladder[from], info, true))) {
            target = from;
        } else if (throughput !== null) {
            var budget = throughput * AUTO_DOWN_MARGIN;
            while (target < ladder.length - 1 && streamStepKbps(ladder[target], info, true) > budget) { target++; }
        }
        if (stalled) { this.lastStallAt = now; }
        this.stallStart = 0;
        this._switch(filepath, ladder[target], now);
        return;
    }

    if (current > 0 && !this.stallStart &&
            now - Math.max(this.lastStallAt, this.lastSwitchAt, this.streamStartedAt) >= AUTO_UP_HOLD_MS &&
            buffer.ahead >= AUTO_FILL_CEILING) {
        // A full buffer kept full shows headroom. A recent measurement of this
        // stream says whether it is enough for the next step; without one, try
        // it. Original played as it is costs the file's own bitrate, otherwise
        // it is another transcode.
        var next = ladder[current - 1];
        var retry = this.blocked[next];
        if (retry && now < retry.until) { return; }
        var nextKbps = streamStepKbps(next, info, !(info && info.directPlay));
        var fresh = this.rate !== null && now - this.estimateAt < AUTO_ESTIMATE_FRESH_MS;
        if (!fresh || this.rate * this._currentKbps(filepath) >= nextKbps * AUTO_UP_MARGIN) {
            this._switch(filepath, next, now);
        }
    }
};

// WebKit plays HLS natively. Everywhere else it is played through Media Source
// Extensions: hls.js if someone has vendored it into web/script/, otherwise the
// built-in MSE player in web/script/hlsmse.js, which is enough because the
// server emits single-variant fragmented-MP4 playlists.
function nativeHLSSupported(videoEl) {
    if (!videoEl || !videoEl.canPlayType) { return false; }
    if (videoEl.canPlayType("application/vnd.apple.mpegurl") === "") { return false; }
    // canPlayType alone cannot be trusted here: Chrome answers "maybe" for the
    // HLS MIME type and then fails to play the playlist. WebKit is the only
    // engine with a real native HLS pipeline, so the answer only counts there —
    // everyone else goes through Media Source instead.
    return isWebKitClient();
}

function hlsPlaybackSupported(videoEl) {
    if (nativeHLSSupported(videoEl)) { return true; }
    if (window.Hls && window.Hls.isSupported()) { return true; }
    return !!(window.MovieHLS && window.MovieHLS.isSupported());
}

// ── Direct play vs transcode ─────────────────────────────────────────────────
// The container extension is only a hint. An .mp4 may hold HEVC, AV1 or 10-bit
// H.264, none of which most browsers decode — playing those directly fails with
// a bare decode error (NS_ERROR_DOM_MEDIA_METADATA_ERR on Firefox) instead of
// being transcoded. So the server is asked what the file really contains.
var WEB_PLAYABLE_EXTENSIONS = ["mp4", "webm", "ogg", "m4v"];
var _mediaInfoCache = {};

function isWebPlayableExtension(ext) {
    return WEB_PLAYABLE_EXTENSIONS.indexOf(String(ext || "").toLowerCase()) !== -1;
}

// Ask the server what a file contains (codecs, picture size). Calls back with
// the probe result, or null when there is none to be had (no ffmpeg, a remote
// file system). Answers are cached per file, making repeat plays and episode
// changes free.
function probeMediaInfo(filepath, callback) {
    if (mediaInfoProbed(filepath)) {
        callback(_mediaInfoCache[filepath]);
        return;
    }

    // Without ffmpeg the probe route does not exist and the request falls
    // through to the plain media endpoint, which would start sending the whole
    // film. Anything that is not JSON is cut off at the headers.
    var controller = window.AbortController ? new AbortController() : null;
    fetch(PROBE_API + "?file=" + encodeURIComponent(filepath),
          { credentials: "same-origin", signal: controller ? controller.signal : undefined })
        .then(function (r) {
            if ((r.headers.get("Content-Type") || "").indexOf("json") === -1) {
                if (controller) { controller.abort(); }
                return null;
            }
            return r.json();
        })
        .then(function (info) {
            info = (info && !info.error) ? info : null;
            _mediaInfoCache[filepath] = info;
            callback(info);
        })
        .catch(function () {
            // Settled as "nothing known", like a probe error, so Auto can fix
            // the file's starting step instead of re-deciding it on every call.
            _mediaInfoCache[filepath] = null;
            callback(null);
        });
}

function cachedMediaInfo(filepath) {
    return _mediaInfoCache[filepath] || null;
}

// Whether the probe for a file has answered (with a result or with nothing).
function mediaInfoProbed(filepath) {
    return Object.prototype.hasOwnProperty.call(_mediaInfoCache, filepath);
}

// Decide whether a file can be handed to the browser as-is. Calls back with
// true for direct play, false to transcode.
//
// Every file is probed, not only web-native containers: the picture size is
// what decides which quality steps apply, and a step below the source always
// means a transcode, however playable the file is.
function resolveDirectPlay(filepath, ext, callback) {
    probeMediaInfo(filepath, function (info) {
        if (effectiveStreamQuality(filepath) !== "original") { callback(false); return; }
        if (!isWebPlayableExtension(ext)) { callback(false); return; }
        // A probe error (no ffmpeg, remote file system) leaves the old
        // extension-based behaviour in place rather than blocking playback.
        callback(info ? !!info.directPlay : true);
    });
}

// Safety net for direct playback: the probe can still be wrong for a browser
// missing a platform decoder, so a decode failure retries as a transcode rather
// than leaving the viewer on a dead player.
function onDirectPlaybackFailure(videoEl, onFallback) {
    clearDirectPlaybackWatch(videoEl);
    var handler = function () {
        clearDirectPlaybackWatch(videoEl);
        var err = videoEl.error;
        // 3 = MEDIA_ERR_DECODE, 4 = MEDIA_ERR_SRC_NOT_SUPPORTED. A network
        // abort is not a codec problem and must not trigger a transcode.
        if (!err || (err.code !== 3 && err.code !== 4)) { return; }
        if (typeof onFallback === "function") { onFallback(); }
    };
    videoEl._directFallback = handler;
    videoEl.addEventListener("error", handler);
}

function clearDirectPlaybackWatch(videoEl) {
    if (videoEl && videoEl._directFallback) {
        videoEl.removeEventListener("error", videoEl._directFallback);
        videoEl._directFallback = null;
    }
}

// Build the streaming URL for a transcoded file, honouring the current mode
// and quality.
// startSeconds restarts the transcode at an offset; the resulting stream always
// begins at zero, so callers track the offset separately.
function transcodeStreamURL(filepath, startSeconds) {
    var hls  = usingHLS();
    var base = hls ? HLS_API : TRANSCODE_API;
    var url  = base + "?file=" + encodeURIComponent(filepath);
    if (startSeconds && startSeconds > 0.001) {
        url += "&start=" + startSeconds.toFixed(3);
    }
    url += streamQualityParam(filepath);
    // Only HLS needs it, and the MP4 response is cacheable — a per-load
    // parameter would defeat that cache for nothing.
    if (hls) { url += "&client=" + MOVIE_CLIENT_ID; }
    return url;
}

// Fetch a playlist before handing it to the player.
//
// Answering a playlist request means starting (or joining) a transcode and
// waiting for its first segment, so it can fail long after the player has
// committed to the URL: a seek past the end of the file, a host too busy to
// produce a segment in time, a session that has already been reaped. A <video>
// element cannot tell any of that from a stream it simply cannot decode — it
// reports NotSupportedError and the reason is lost. Asking first keeps the real
// message, and hands the player a playlist that is already ready.
function preflightPlaylist(url, callback) {
    fetch(url, { credentials: "same-origin", cache: "no-store" })
        .then(function (response) {
            return response.text().then(function (body) {
                if (response.ok && String(body).trim().indexOf("#EXTM3U") === 0) {
                    callback(true);
                    return;
                }
                callback(false, playlistErrorMessage(body, response.status));
            });
        })
        .catch(function () {
            callback(false, "Transcode failed: could not reach the server");
        });
}

// Turn whatever arrived instead of a playlist into a line worth showing.
function playlistErrorMessage(body, status) {
    var text = String(body || "").trim();
    // Some endpoints still report failure as a 200 carrying a JSON error object
    if (text.charAt(0) === "{") {
        try {
            var parsed = JSON.parse(text);
            if (parsed && parsed.error) { text = String(parsed.error); }
        } catch (e) { /* not JSON after all — show it as it came */ }
    }
    if (!text) { text = "the transcode did not start (HTTP " + status + ")"; }
    if (text.length > 120) { text = text.substring(0, 119) + "…"; }
    return "Transcode failed: " + text;
}

// Point a <video> at a stream URL. HLS on a browser without native support is
// routed through hls.js when it is available. Returns false when the stream
// cannot be played at all, so the caller can say so rather than hang.
//
// A playlist is checked before the player is pointed at it, which makes the
// attachment asynchronous: onReady fires once the stream is actually bound, and
// is where the caller should call play(). onError reports a stream that never
// became playable, with the server's own explanation. A stream that fails after
// it was bound is reported on the element instead: its 'error' event for native
// playback, STREAM_LOST_EVENT for the Media Source player.
function attachTranscodeStream(videoEl, url, onError, onReady) {
    detachTranscodeStream(videoEl);

    var ready = function () { if (typeof onReady === "function") { onReady(); } };
    var fail  = function (reason, err) { if (typeof onError === "function") { onError(reason, err); } };

    if (url.indexOf(HLS_API) !== 0) {
        videoEl.src = url;
        videoEl.load();
        ready();
        return true;
    }

    // Choose the player before making a request, so a browser that cannot play
    // HLS at all is reported without waiting on a transcode it will not use.
    var bind;
    if (nativeHLSSupported(videoEl)) {
        bind = function () { videoEl.src = url; videoEl.load(); ready(); };
    } else if (window.Hls && window.Hls.isSupported()) {
        bind = function () {
            var hls = new window.Hls({ enableWorker: true });
            videoEl._hlsInstance = hls;
            hls.loadSource(url);
            hls.attachMedia(videoEl);
            ready();
        };
    } else if (window.MovieHLS && window.MovieHLS.isSupported()) {
        bind = function () {
            var instance = window.MovieHLS.attach(videoEl, url, {
                onError: function (reason, err) {
                    // A player already replaced by a newer stream is not news
                    if (videoEl._mseInstance !== instance) { return; }
                    videoEl.dispatchEvent(new CustomEvent(STREAM_LOST_EVENT, {
                        detail: { reason: reason, error: err }
                    }));
                }
            });
            videoEl._mseInstance = instance;
            ready();
        };
    } else {
        return false;
    }

    // Stop the stream being replaced now, not when the new one binds. Tearing
    // down its player does not stop the element: it plays on through whatever
    // it had buffered while the page already counts time from the new offset,
    // so after a jump to 2:20 the clock runs 2:20, 2:21, 2:22 over the old
    // picture, then snaps back to 2:20 when the new stream arrives. The gap is
    // the preflight below, which waits for the server to start ffmpeg at the
    // new offset - seconds, not milliseconds. An emptied element shows nothing
    // (the page keeps its freeze frame over it) and holds its clock at zero,
    // which is exactly the new offset.
    stopElementMedia(videoEl);

    // A seek made while the previous playlist is still being fetched must not
    // be overtaken by that older answer.
    var generation = (videoEl._streamGeneration || 0) + 1;
    videoEl._streamGeneration = generation;
    preflightPlaylist(url, function (ok, reason) {
        if (videoEl._streamGeneration !== generation) { return; }
        if (!ok) { fail(reason); return; }
        bind();
    });
    return true;
}

// Empty the element so nothing keeps playing from its old source. Removing the
// attribute (rather than setting src to "") matters: an empty src is an invalid
// source and fires 'error', which the pages would treat as a lost stream. The
// load() rejects a pending play() with AbortError, which playVideo ignores.
function stopElementMedia(videoEl) {
    if (!videoEl.hasAttribute("src")) { return; }
    videoEl.removeAttribute("src");
    videoEl.load();
}

// Release whichever player is currently bound to the element. Always call this
// before pointing a <video> somewhere new, or an MSE attachment keeps feeding
// segments into an element that has moved on.
function detachTranscodeStream(videoEl) {
    if (!videoEl) { return; }
    // Retires any playlist request still in flight for the old stream
    videoEl._streamGeneration = (videoEl._streamGeneration || 0) + 1;
    if (videoEl._hlsInstance) {
        try { videoEl._hlsInstance.destroy(); } catch (e) {}
        videoEl._hlsInstance = null;
    }
    if (videoEl._mseInstance) {
        try { videoEl._mseInstance.destroy(); } catch (e) {}
        videoEl._mseInstance = null;
    }
}

// ── Scanner settings ─────────────────────────────────────────────────────────
var VALID_VIDEO_FORMATS = ["mp4", "webm", "ogg", "mkv", "avi", "mov", "m4v", "wmv", "flv", "rmvb", "ts"];
var SKIP_ROOT_PREFIXES  = ["tmp:/", "trash:/"];    // roots to skip entirely
var VIDEO_FOLDER_NAME   = "Video";                 // expected folder inside each root
var MOVIE_FOLDER_NAMES  = ["movie", "movies"];     // folder names (case-insensitive) treated as movie containers
var ANIME_FOLDER_NAMES  = ["anime"];               // folder names (case-insensitive) treated as anime containers
