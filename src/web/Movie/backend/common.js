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
// "auto" picks hls on WebKit and mp4 everywhere else, so nothing changes for
// browsers that were already working.
var STREAM_MODE_KEY = "movie_stream_mode";

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
var _codecProbeCache = {};

function isWebPlayableExtension(ext) {
    return WEB_PLAYABLE_EXTENSIONS.indexOf(String(ext || "").toLowerCase()) !== -1;
}

// Decide whether a file can be handed to the browser as-is. Calls back with
// true for direct play, false to transcode.
//
// Only web-native containers are probed: anything else is transcoded regardless,
// so there is nothing to learn. Results are cached per file, making repeat plays
// and episode changes free.
function resolveDirectPlay(filepath, ext, callback) {
    if (!isWebPlayableExtension(ext)) { callback(false); return; }
    if (Object.prototype.hasOwnProperty.call(_codecProbeCache, filepath)) {
        callback(_codecProbeCache[filepath]);
        return;
    }

    fetch(PROBE_API + "?file=" + encodeURIComponent(filepath), { credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (info) {
            // A probe error (no ffmpeg, remote file system) leaves the old
            // extension-based behaviour in place rather than blocking playback.
            var direct = (info && !info.error) ? !!info.directPlay : true;
            _codecProbeCache[filepath] = direct;
            callback(direct);
        })
        .catch(function () { callback(true); });
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

// Build the streaming URL for a transcoded file, honouring the current mode.
// startSeconds restarts the transcode at an offset; the resulting stream always
// begins at zero, so callers track the offset separately.
function transcodeStreamURL(filepath, startSeconds) {
    var base = usingHLS() ? HLS_API : TRANSCODE_API;
    var url  = base + "?file=" + encodeURIComponent(filepath);
    if (startSeconds && startSeconds > 0.001) {
        url += "&start=" + startSeconds.toFixed(3);
    }
    return url;
}

// Point a <video> at a stream URL. HLS on a browser without native support is
// routed through hls.js when it is available. Returns false when the stream
// cannot be played at all, so the caller can say so rather than hang.
function attachTranscodeStream(videoEl, url, onError) {
    detachTranscodeStream(videoEl);

    var isPlaylist = url.indexOf(HLS_API) === 0;
    if (isPlaylist && !nativeHLSSupported(videoEl)) {
        if (window.Hls && window.Hls.isSupported()) {
            var hls = new window.Hls({ enableWorker: true });
            videoEl._hlsInstance = hls;
            hls.loadSource(url);
            hls.attachMedia(videoEl);
            return true;
        }
        if (window.MovieHLS && window.MovieHLS.isSupported()) {
            videoEl._mseInstance = window.MovieHLS.attach(videoEl, url, {
                onError: function (reason, err) {
                    if (typeof onError === "function") { onError(reason, err); }
                }
            });
            return true;
        }
        return false;
    }

    videoEl.src = url;
    videoEl.load();
    return true;
}

// Release whichever player is currently bound to the element. Always call this
// before pointing a <video> somewhere new, or an MSE attachment keeps feeding
// segments into an element that has moved on.
function detachTranscodeStream(videoEl) {
    if (!videoEl) { return; }
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
