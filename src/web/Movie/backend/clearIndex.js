/*
    Movie App - Clear Library Index

    Deletes the cached scan result so the next scan starts from scratch.
    Only removes the index file — no user media is touched.

    Returns JSON: { ok: true, removed: bool } or { error: "..." }
*/

includes("common.js");
requirelib("filelib");

var CACHE_FILE = "user:/.appdata/Movie/library_cache.json";

function main() {
    if (!filelib.fileExists(CACHE_FILE)) {
        // Nothing to remove is a success from the caller's point of view
        sendJSONResp(JSON.stringify({ ok: true, removed: false }));
        return;
    }

    try {
        filelib.deleteFile(CACHE_FILE);
    } catch (e) {
        sendJSONResp(JSON.stringify({ error: "delete_failed" }));
        return;
    }

    if (filelib.fileExists(CACHE_FILE)) {
        sendJSONResp(JSON.stringify({ error: "delete_failed" }));
        return;
    }

    sendJSONResp(JSON.stringify({ ok: true, removed: true }));
}

main();
