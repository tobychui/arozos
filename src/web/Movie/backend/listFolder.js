/*
    Movie App - Folder Browser
    Given a virtual folder path (POST param: folder), returns its immediate
    subfolders and video files. When folder is empty or "/", returns all
    storage roots (excluding tmp and trash).

    Each folder entry includes:
      isRoot    – true when the item is a top-level storage root (user:/, disk:/, …)
      hasVideos – true when the folder contains at least one video file directly inside
      thumbnail – base64 thumbnail from the first video file found, or ""

    POST params:
        folder  – virtual path (optional; omit or "/" to list storage roots)

    Returns JSON:
    {
        "path"   : "user:/Video/",
        "folders": [{ "name": "…", "path": "…", "isRoot": false, "hasVideos": true, "thumbnail": "…" }],
        "videos" : [{ "name": "…", "filepath": "…", "ext": ".mp4" }]
    }
*/

includes("common.js");
requirelib("filelib");
requirelib("imagelib");

function fileExt(filepath) {
    var parts = filepath.split(".");
    if (parts.length < 2) { return ""; }
    return "." + parts[parts.length - 1].toLowerCase();
}

function ensureSlash(path) {
    return path[path.length - 1] === "/" ? path : path + "/";
}

function shouldSkipRoot(rootPath) {
    var lower = rootPath.toLowerCase();
    for (var i = 0; i < SKIP_ROOT_PREFIXES.length; i++) {
        if (lower.indexOf(SKIP_ROOT_PREFIXES[i]) === 0) { return true; }
    }
    return false;
}

// Return the filepath of the first video file directly inside folderPath, or null.
function firstVideoIn(folderPath) {
    var ensure = ensureSlash(folderPath);
    var items = filelib.readdir(ensure, "default");
    if (!items) { return null; }
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.IsDir) { continue; }
        var ext = fileExt(item.Filepath).replace(".", "");
        for (var k = 0; k < VALID_VIDEO_FORMATS.length; k++) {
            if (ext === VALID_VIDEO_FORMATS[k]) { return item.Filepath; }
        }
    }
    return null;
}

// Load cached thumbnail for a video file; return base64 string or "".
function loadThumb(videoPath) {
    if (!videoPath) { return ""; }
    var t = imagelib.loadThumbString(videoPath);
    if (t !== false && t !== null && typeof t === "string" && t.length > 0) { return t; }
    return "";
}

function main() {
    var listRoot = (!folder || folder === "undefined" || folder.length === 0 || folder === "/");

    if (listRoot) {
        var roots = filelib.glob("/");
        if (!roots) { roots = []; }
        var folderList = [];
        for (var i = 0; i < roots.length; i++) {
            if (shouldSkipRoot(roots[i])) { continue; }
            folderList.push({
                name:      roots[i],
                path:      ensureSlash(roots[i]),
                isRoot:    true,
                hasVideos: false,
                thumbnail: ""
            });
        }
        sendJSONResp(JSON.stringify({ path: "/", folders: folderList, videos: [] }));
        return;
    }

    var ensure = folder;
    if (ensure[ensure.length - 1] !== "/") { ensure += "/"; }

    if (!filelib.fileExists(ensure)) {
        sendJSONResp(JSON.stringify({ error: "Folder not found: " + ensure }));
        return;
    }

    var items = filelib.readdir(ensure, "default");
    if (!items) { items = []; }

    var folders = [];
    var videos = [];

    for (var j = 0; j < items.length; j++) {
        var item = items[j];
        if (item.IsDir) {
            var subPath  = ensureSlash(item.Filepath);
            var firstVid = firstVideoIn(subPath);
            var hasVids  = firstVid !== null;
            folders.push({
                name:      item.Filename,
                path:      subPath,
                isRoot:    false,
                hasVideos: hasVids,
                thumbnail: hasVids ? loadThumb(firstVid) : ""
            });
        } else {
            var ext = fileExt(item.Filepath);
            var extClean = ext.replace(".", "");
            var isVideo = false;
            for (var k = 0; k < VALID_VIDEO_FORMATS.length; k++) {
                if (extClean === VALID_VIDEO_FORMATS[k]) { isVideo = true; break; }
            }
            if (isVideo) {
                var base = item.Filename;
                var dot  = base.lastIndexOf(".");
                videos.push({ name: dot > 0 ? base.substring(0, dot) : base, filepath: item.Filepath, ext: ext });
            }
        }
    }

    folders.sort(function(a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
    videos.sort(function(a, b)  { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });

    sendJSONResp(JSON.stringify({ path: ensure, folders: folders, videos: videos }));
}

main();
