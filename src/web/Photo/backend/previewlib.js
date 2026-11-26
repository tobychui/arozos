/*
    previewlib.js

    Previews for the waterfall layout: every photo drawn upright and fitted to
    PREVIEW_MAX_WIDTH x PREVIEW_MAX_HEIGHT, keeping its shape. The system
    thumbnails are square crops, so they cannot show a photo in its own shape.
    The drawing is done by imagelib.renderPreview (RAW, HEIC and the EXIF
    orientation included).

    Where previews go is the user's choice (Photo > Settings). It is kept in
    the index database's index_meta table, which survives an index rebuild:
      preview_mode  "realtime"  draw on every request, store nothing (default)
                    "appdata"   cache in PREVIEW_DEFAULT_DIR
                    "custom"    cache in the folder in preview_path
    A cached preview is <dir>/<hh>/<hash>.jpg, where hash is 14 hex digits of
    the photo's virtual path and hh its first two. It is drawn again when the
    photo is newer than it. Only files named like that are ever deleted from a
    cache folder, so a custom folder may hold other files too.

    ES5 only (Otto VM).
*/

includes("imagedb.js");

var PREVIEW_DEFAULT_DIR = "user:/.appdata/photo/previews";
var PREVIEW_MAX_WIDTH = 720;
var PREVIEW_MAX_HEIGHT = 2160;
var PREVIEW_MODES = ["appdata", "custom", "realtime"];
var PREVIEW_SHARD_RE = /^[0-9a-f]{2}$/;
var PREVIEW_FILE_RE = /^[0-9a-f]{14}\.jpg$/;

// 32 bit integer multiply (Math.imul is not part of ES5)
function pv_imul(a, b) {
    var ah = (a >>> 16) & 0xffff;
    var al = a & 0xffff;
    var bh = (b >>> 16) & 0xffff;
    var bl = b & 0xffff;
    return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0)) | 0;
}

// 53 bit hash (cyrb53) of a string as 14 hex digits. A collision among a
// million photos is about a one in twenty thousand chance.
function previewHash(str) {
    str = "" + str;
    var h1 = 0xdeadbeef ^ 0;
    var h2 = 0x41c6ce57 ^ 0;
    for (var i = 0; i < str.length; i++) {
        var ch = str.charCodeAt(i);
        h1 = pv_imul(h1 ^ ch, 2654435761);
        h2 = pv_imul(h2 ^ ch, 1597334677);
    }
    h1 = pv_imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= pv_imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = pv_imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= pv_imul(h1 ^ (h1 >>> 13), 3266489909);
    var n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    var hex = n.toString(16);
    while (hex.length < 14) {
        hex = "0" + hex;
    }
    return hex;
}

// A virtual folder path the user typed or picked, without trailing slashes,
// or "" when it is not one ("disk1:/Cache", "user:/").
function previewCleanFolder(path) {
    path = ("" + (path || "")).trim().replace(/\\/g, "/");
    if (!/^[^\/:]+:\//.test(path) && !/^[^\/:]+:$/.test(path)) {
        return "";
    }
    var parts = path.split("/");
    for (var i = 0; i < parts.length; i++) {
        if (parts[i] === "..") {
            return "";
        }
    }
    path = path.replace(/\/+$/, "");
    if (/^[^\/:]+:$/.test(path)) {
        path = path + "/";
    }
    return path;
}

// The preview settings of this user: { mode, path, dir }. dir is the cache
// folder, or null for realtime previews.
function previewSettings(db) {
    var mode = "realtime";
    var path = "";
    if (db != null) {
        mode = metaGet(db, "preview_mode", "realtime");
        path = metaGet(db, "preview_path", "");
    }
    if (PREVIEW_MODES.indexOf(mode) < 0) {
        mode = "realtime";
    }
    var dir = PREVIEW_DEFAULT_DIR;
    if (mode === "realtime") {
        dir = null;
    } else if (mode === "custom" && previewCleanFolder(path) !== "") {
        dir = previewCleanFolder(path);
    }
    return { mode: mode, path: path, dir: dir };
}

function previewJoin(dir, name) {
    return dir.charAt(dir.length - 1) === "/" ? dir + name : dir + "/" + name;
}

// Cache file of a photo inside a cache folder
function previewCacheFile(dir, filepath) {
    var h = previewHash(filepath);
    return previewJoin(previewJoin(dir, h.substring(0, 2)), h + ".jpg");
}

// Whether the preview drawer reads this kind of file
function previewSupported(filepath) {
    return db_isImageFile(filepath);
}

// The cached preview of a photo as {src, w, h, v}, or null when there is none
// or the photo changed after it was drawn. v (its time) busts browser caches.
function previewLookup(dir, filepath) {
    var file = previewCacheFile(dir, filepath);
    if (!filelib.fileExists(file)) {
        return null;
    }
    var cacheTime = filelib.mtime(file, true);
    var photoTime = filelib.mtime(filepath, true);
    if (cacheTime === false || (photoTime !== false && photoTime > cacheTime)) {
        return null;
    }
    var dim = imagelib.getImageDimension(file);
    if (!dim || !dim[0] || !dim[1]) {
        return null;
    }
    return { src: file, w: dim[0], h: dim[1], v: cacheTime };
}

// Whether this server can draw previews (imagelib.renderPreview came with a
// newer ArozOS build)
function previewAvailable() {
    return typeof imagelib !== "undefined" && typeof imagelib.renderPreview === "function";
}

// Draw the preview of a photo into dir (or inline when dir is null)
function previewRender(dir, filepath) {
    var r;
    if (!previewAvailable()) {
        return { error: "unavailable" };
    }
    if (dir === null) {
        r = imagelib.renderPreview(filepath, "", PREVIEW_MAX_WIDTH, PREVIEW_MAX_HEIGHT);
        if (!r || !r.dataURL) {
            return { error: "failed" };
        }
        return { dataURL: r.dataURL, w: r.width, h: r.height };
    }
    var file = previewCacheFile(dir, filepath);
    r = imagelib.renderPreview(filepath, file, PREVIEW_MAX_WIDTH, PREVIEW_MAX_HEIGHT);
    if (!r || !r.width) {
        return { error: "failed" };
    }
    var t = filelib.mtime(file, true);
    return { src: file, w: r.width, h: r.height, v: t || Math.floor(Date.now() / 1000) };
}

// The entries of a folder as [{Filename, Filepath, Filesize, IsDir}]. readdir,
// unlike glob, lists folders below a hidden one such as user:/.appdata.
function previewReadDir(dir) {
    try {
        var list = filelib.readdir(dir, "default");
        if (typeof list === "string") {
            list = JSON.parse(list);
        }
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}

// Calls fn(vpath, bytes) for every preview file in a cache folder. Only the
// shard folders 00-ff are looked into, never the rest of a custom folder.
function previewEachCacheFile(dir, fn) {
    if (!dir || !filelib.fileExists(dir)) {
        return;
    }
    var hex = "0123456789abcdef";
    for (var a = 0; a < 16; a++) {
        for (var b = 0; b < 16; b++) {
            var shard = previewJoin(dir, hex.charAt(a) + hex.charAt(b));
            if (!filelib.fileExists(shard)) {
                continue;
            }
            var files = previewReadDir(shard);
            for (var i = 0; i < files.length; i++) {
                if (!files[i].IsDir && PREVIEW_FILE_RE.test(files[i].Filename)) {
                    fn(previewJoin(shard, files[i].Filename), files[i].Filesize || 0);
                }
            }
        }
    }
}

// How many previews a cache folder holds and their size in bytes
function previewCacheStats(dir) {
    var stats = { files: 0, bytes: 0 };
    previewEachCacheFile(dir, function (file, bytes) {
        stats.files++;
        stats.bytes += bytes;
    });
    return stats;
}

// Delete every preview of a cache folder, and the shard folders left empty
function previewCacheClear(dir) {
    var removed = 0;
    var shards = {};
    previewEachCacheFile(dir, function (file) {
        if (filelib.deleteFile(file)) {
            removed++;
        }
        var parts = ("" + file).split("/");
        parts.pop();
        shards[parts.join("/")] = true;
    });
    for (var shard in shards) {
        if (PREVIEW_SHARD_RE.test(shard.split("/").pop()) && previewReadDir(shard).length === 0) {
            filelib.deleteFile(shard);
        }
    }
    return removed;
}
