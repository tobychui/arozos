/*
    photoSettings.js

    Backend of the Photo settings dialog. Settings live in the per-user index
    database (index_meta), which an index rebuild keeps.

    Request body (JSON) by action:
      { action: "get" }
          => { preview: {mode, path, dir, defaultDir}, index: {total, lastIndexed},
               exclude: [...] }
      { action: "set", previewMode: "appdata|custom|realtime", previewPath }
          => same as get, or { error } when the custom folder cannot be used
      { action: "cacheStats", dir? }   => { files, bytes } of the cache folder
      { action: "clearCache", dir? }   => { removed }
          dir defaults to the cache folder in use; another folder is only
          accepted when it is the default or the saved custom folder.
      { action: "setExclude", folders: ["Screenshots", ...] }  => same as get
*/

includes("previewlib.js");

function settingsReply(db) {
    var st = previewSettings(db);
    var totalRow = db.queryRow("SELECT COUNT(*) AS c FROM photos");
    return {
        preview: { mode: st.mode, path: st.path, dir: st.dir, defaultDir: PREVIEW_DEFAULT_DIR },
        index: {
            total: totalRow ? totalRow.c : 0,
            lastIndexed: parseInt(metaGet(db, "last_indexed", "0")) || 0
        },
        exclude: parseExcludeList(metaGet(db, "exclude_folders", "[]"))
    };
}

// Whether a folder is one of the photo library roots or inside one
function insidePhotoLibrary(path) {
    var roots = getPhotoRoots();
    for (var i = 0; i < roots.length; i++) {
        var r = roots[i].replace(/\/+$/, "");
        if (path === r || path.indexOf(r + "/") === 0) {
            return true;
        }
    }
    return false;
}

// A cache folder this request may look into or clear
function knownCacheDir(db, dir) {
    var st = previewSettings(db);
    if (!dir) {
        return st.dir;
    }
    dir = previewCleanFolder(dir);
    if (dir === PREVIEW_DEFAULT_DIR || (dir !== "" && dir === previewCleanFolder(st.path))) {
        return dir;
    }
    return null;
}

function main() {
    var payload = {};
    try {
        payload = JSON.parse((typeof POST_data !== "undefined") ? POST_data : "{}") || {};
    } catch (e) {
        payload = {};
    }

    var db = openIndexDB();
    if (db == null) {
        sendJSONResp(JSON.stringify({ error: "index unavailable" }));
        return;
    }

    var action = payload.action || "get";
    var reply;
    if (action === "set") {
        var mode = "" + (payload.previewMode || "appdata");
        if (PREVIEW_MODES.indexOf(mode) < 0) {
            reply = { error: "unknown preview mode" };
        } else if (mode === "custom") {
            var path = previewCleanFolder(payload.previewPath);
            if (path === "") {
                reply = { error: "not a folder path" };
            } else if (!filelib.fileExists(path) || !filelib.isDir(path)) {
                reply = { error: "folder not found" };
            } else if (!pathCanWrite(path)) {
                reply = { error: "folder is read only" };
            } else if (insidePhotoLibrary(path)) {
                // Previews there would be indexed and listed as photos
                reply = { error: "folder is inside the photo library" };
            } else {
                metaSet(db, "preview_mode", mode);
                metaSet(db, "preview_path", path);
            }
        } else {
            metaSet(db, "preview_mode", mode);
        }
        if (!reply) {
            reply = settingsReply(db);
        }
    } else if (action === "cacheStats" || action === "clearCache") {
        var dir = knownCacheDir(db, payload.dir);
        if (dir === null) {
            reply = action === "cacheStats" ? { files: 0, bytes: 0 } : { removed: 0 };
        } else if (action === "cacheStats") {
            reply = previewCacheStats(dir);
        } else {
            reply = { removed: previewCacheClear(dir) };
        }
    } else if (action === "setExclude") {
        var list = Array.isArray(payload.folders) ? payload.folders : [];
        var clean = [];
        for (var i = 0; i < list.length; i++) {
            var frag = ("" + list[i]).trim().replace(/^\/+|\/+$/g, "");
            if (frag.length && clean.indexOf(frag) < 0) {
                clean.push(frag);
            }
        }
        metaSet(db, "exclude_folders", JSON.stringify(clean));
        reply = settingsReply(db);
    } else {
        reply = settingsReply(db);
    }

    db.close();
    sendJSONResp(JSON.stringify(reply));
}

main();
