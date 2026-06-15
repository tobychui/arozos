/*
    Musicify - Full Buffer Transcode
    Converts an audio file to MP3 using ffmpeg and caches the result in
    tmp:/Musicify/buffer/ so subsequent requests for the same file+samplerate
    are served instantly without re-encoding.

    The buffer directory is part of tmp:/ which ArozOS clears every 24 hours,
    so the cache is self-managing.

    Parameters (GET or POST):
        file        - virtual path of the source audio file (URL-encoded)
        samplerate  - target sample rate in kHz: "16" | "24" | "48"  (default: "48")

    Returns JSON:
        { "path": "tmp:/Musicify/buffer/<hash>.mp3" }   on success
        { "error": "<message>" }                         on failure
*/

requirelib("filelib");
requirelib("ffmpeg");

// ── djb2 hash – produces a stable hex string from a source string ─────────────
function simpleHash(str) {
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash = hash & hash; // keep 32-bit
    }
    return (hash >>> 0).toString(16);
}

// ── Validate required "file" parameter ───────────────────────────────────────
if (typeof(file) === "undefined" || file === "") {
    sendJSONResp(JSON.stringify({ error: "file parameter required" }));
} else {
    var decodedFile = decodeURIComponent(file);

    // Normalise sample-rate (kHz string → integer → back to string for key)
    var sr = "48";
    if (typeof(samplerate) !== "undefined" && samplerate !== "" && samplerate !== "undefined") {
        var srInt = parseInt(samplerate);
        if (srInt === 16 || srInt === 24 || srInt === 48) {
            sr = String(srInt);
        }
    }

    // Build a stable cache key from filepath + samplerate
    var hashKey = simpleHash(decodedFile + "|" + sr);
    var bufferDir  = "tmp:/Musicify/buffer";
    var bufferPath = bufferDir + "/" + hashKey + ".mp3";

    // Ensure the buffer directory exists
    if (!filelib.fileExists(bufferDir)) {
        filelib.mkdir(bufferDir);
    }

    // Return the cached file when it already exists
    if (filelib.fileExists(bufferPath)) {
        sendJSONResp(JSON.stringify({ path: bufferPath }));
    } else {
        // Convert: source → MP3 at the requested sample rate
        var sampleRateHz = parseInt(sr) * 1000;
        var ok = ffmpeg.audioConvert(decodedFile, bufferPath, sampleRateHz);
        if (ok) {
            sendJSONResp(JSON.stringify({ path: bufferPath }));
        } else {
            sendJSONResp(JSON.stringify({ error: "Transcoding failed" }));
        }
    }
}
