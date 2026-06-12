/*
    indexPhotos.js

    Incremental photo indexer for the Photo module search feature.

    Walks the user's photo library roots (or a single `root` if given), extracts
    metadata for every image and stores it in the per-user SQLite index. Designed
    to be called repeatedly: each request fully processes at most BATCH new/changed
    files and reports `hasMore`, so the front-end can loop without blocking on a
    huge library. This is what powers "auto indexing" — the Photo app kicks this
    off in the background on load and loops until `hasMore` is false.

    Request body (JSON, all optional):
      {
        "mode": "incremental" | "full",   // full wipes the index first, then
                                          //   indexes incrementally (see below)
        "root": "user:/Photo"             // restrict to one root (no deletes)
      }

    "full" is a one-shot reset: it clears the index at the start of the call and
    then proceeds exactly like an incremental pass. The caller should send "full"
    once and then keep looping with "incremental" until hasMore is false — that
    way each round makes forward progress instead of re-extracting the same files.

    Response (JSON):
      { scanned, indexed, removed, remaining, hasMore, total }

    Called with no body it indexes all photo roots incrementally, which also makes
    it safe to wire up as a background / nightly task in future.
*/

includes("imagedb.js");

// Images fully extracted (resolution + EXIF) per request. Bounds request time;
// the expensive work is gated by this, the cheap directory walk is not.
var BATCH = 30;

function main() {
    var rawBody = (typeof POST_data !== "undefined") ? POST_data : "{}";
    var payload = {};
    try {
        payload = JSON.parse(rawBody) || {};
    } catch (e) {
        payload = {};
    }

    var mode = payload.mode || "incremental";   // incremental | full
    var rootParam = payload.root || null;

    var db = openIndexDB();
    if (db == null) {
        sendJSONResp(JSON.stringify({ error: "index unavailable", hasMore: false }));
        return;
    }

    var excludeList = parseExcludeList(metaGet(db, "exclude_folders", "[]"));
    var roots = rootParam ? [rootParam] : getPhotoRoots();

    // Full rebuild is a one-shot reset: wipe the index, then index incrementally
    // so each subsequent (incremental) round keeps making forward progress.
    if (mode === "full") {
        if (rootParam) {
            db.exec("DELETE FROM photos WHERE folder = ? OR folder LIKE ?", [rootParam, rootParam + "/%"]);
        } else {
            db.exec("DELETE FROM photos");
        }
    }

    // Snapshot the current index for cheap incremental comparison.
    var existing = {};
    var existingRows = db.query("SELECT filepath, modified_date, filesize FROM photos");
    for (var i = 0; i < existingRows.length; i++) {
        existing[existingRows[i].filepath] = existingRows[i];
    }

    // Walk every root and decide which files need (re)indexing.
    var present = {};
    var pending = [];
    var scanned = 0;
    for (var r = 0; r < roots.length; r++) {
        var files;
        try {
            files = filelib.walk(roots[r], "file");
        } catch (e) {
            files = [];
        }
        if (!files) {
            files = [];
        }
        for (var f = 0; f < files.length; f++) {
            var fp = files[f];
            if (!db_isImageFile(fp)) {
                continue;
            }
            if (isExcluded(fp, excludeList)) {
                continue;
            }
            present[fp] = true;
            scanned++;

            var mt = filelib.mtime(fp, true);
            if (mt === false) {
                mt = 0;
            }
            var sz = filelib.filesize(fp);
            var ex = existing[fp];
            // After a full-mode wipe the index is empty, so every file is "new"
            // here and gets queued; on later incremental rounds matched files are
            // skipped, which is what lets the batch loop advance to completion.
            if (!ex || ex.modified_date != mt || ex.filesize != sz) {
                pending.push({ filepath: fp, mtime: mt, filesize: sz });
            }
        }
    }

    // Prune deleted files — only when scanning the whole library (no single root),
    // otherwise we'd wrongly drop photos that live outside the requested root.
    var removed = 0;
    if (!rootParam) {
        for (var key in existing) {
            if (!present[key]) {
                db.exec("DELETE FROM photos WHERE filepath = ?", [key]);
                removed++;
            }
        }
    }

    // Process at most BATCH pending files this round.
    var indexed = 0;
    var processCount = Math.min(BATCH, pending.length);
    for (var p = 0; p < processCount; p++) {
        var item = pending[p];
        try {
            var meta = extractPhotoMeta(item.filepath, item.mtime, item.filesize);
            upsertPhoto(db, meta);
            indexed++;
        } catch (e) {
            /* unreadable / unsupported file — skip it */
        }
    }

    var remaining = pending.length - processCount;
    var totalRow = db.queryRow("SELECT COUNT(*) AS c FROM photos");
    var total = totalRow ? totalRow.c : 0;

    metaSet(db, "last_indexed", Math.floor(Date.now() / 1000));
    metaSet(db, "last_scan_count", scanned);
    db.close();

    sendJSONResp(JSON.stringify({
        scanned: scanned,
        indexed: indexed,
        removed: removed,
        remaining: remaining,
        hasMore: remaining > 0,
        total: total
    }));
}

main();
