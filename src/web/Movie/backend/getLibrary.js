/*
    Movie App - Library Scanner v2

    Scanning strategy for root:/Video/ direct children:
      • Subfolder has immediate subdirs with videos → type "series"  (seasons = those subdirs)
      • Subfolder has only direct video files        → type "collection" (flat playlist)
      • Subfolder is empty / container only         → recurse one level deeper

    Special folder names (case-insensitive) handled separately:
      • "Anime" / ANIME_FOLDER_NAMES → each child is an anime title  (type "anime")
      • "Movie" / MOVIE_FOLDER_NAMES → each child is a movie entry   (type "movie")

    Root-level Movie/Movies/Anime folders (not under Video/) are also processed.

    Loose video files directly in root:/Video/ → type "short".

    Types returned: "series" | "anime" | "movie" | "collection" | "short"
*/

includes("common.js");
requirelib("filelib");
requirelib("imagelib");

// ── Helpers ───────────────────────────────────────────────────────────────────

function fileExt(filepath) {
    var parts = filepath.split(".");
    if (parts.length < 2) { return ""; }
    return parts[parts.length - 1].toLowerCase();
}

function basename(filepath) {
    var clean = filepath;
    if (clean[clean.length - 1] === "/") { clean = clean.slice(0, -1); }
    var parts = clean.split("/");
    return parts[parts.length - 1];
}

function ensureSlash(path) {
    return path[path.length - 1] === "/" ? path : path + "/";
}

function isMovieFolderName(name) {
    var lower = name.toLowerCase();
    for (var i = 0; i < MOVIE_FOLDER_NAMES.length; i++) {
        if (lower === MOVIE_FOLDER_NAMES[i]) { return true; }
    }
    return false;
}

function isAnimeFolderName(name) {
    var lower = name.toLowerCase();
    for (var i = 0; i < ANIME_FOLDER_NAMES.length; i++) {
        if (lower === ANIME_FOLDER_NAMES[i]) { return true; }
    }
    return false;
}

function shouldSkipRoot(rootPath) {
    var lower = rootPath.toLowerCase();
    for (var i = 0; i < SKIP_ROOT_PREFIXES.length; i++) {
        if (lower.indexOf(SKIP_ROOT_PREFIXES[i]) === 0) { return true; }
    }
    return false;
}

// Return video files directly inside a folder (non-recursive, skips macOS forks)
function listVideosInFolder(folderPath) {
    var ensure = ensureSlash(folderPath);
    var videos = [];
    for (var i = 0; i < VALID_VIDEO_FORMATS.length; i++) {
        var found = filelib.aglob(ensure + "*." + VALID_VIDEO_FORMATS[i]);
        if (found && found.length > 0) {
            for (var j = 0; j < found.length; j++) {
                if (basename(found[j]).substr(0, 2) !== "._") { videos.push(found[j]); }
            }
        }
    }
    return videos;
}

// Return immediate subdirectories only (depth = 1)
function listSubdirs(folderPath) {
    var ensure = ensureSlash(folderPath);
    var all    = filelib.walk(ensure, "folder");
    if (!all) { return []; }
    var immediate = [];
    for (var i = 0; i < all.length; i++) {
        var rel  = all[i].replace(ensure, "");
        var segs = rel.split("/").filter(function (s) { return s.length > 0; });
        if (segs.length === 1) { immediate.push(ensureSlash(all[i])); }
    }
    return immediate;
}

// Load cached thumbnail string for a video file; returns base64 or ""
function getFirstVideoThumb(videoFile) {
    if (!videoFile) { return ""; }
    var t = imagelib.loadThumbString(videoFile);
    if (t !== false && t !== null && typeof t === "string" && t.length > 0) { return t; }
    return "";
}

// ── Scanners ──────────────────────────────────────────────────────────────────

// Scan an Anime container: each immediate child becomes one anime title (type "anime")
function scanAnimeContainer(containerPath, results) {
    var cEnsure = ensureSlash(containerPath);
    var titles  = listSubdirs(cEnsure);
    for (var i = 0; i < titles.length; i++) {
        var titlePath = ensureSlash(titles[i]);
        var titleName = basename(titlePath);
        var directEps = listVideosInFolder(titlePath);
        directEps.sort();

        var titleSubdirs    = listSubdirs(titlePath);
        var seasonsWithVids = [];
        for (var j = 0; j < titleSubdirs.length; j++) {
            var sv = listVideosInFolder(titleSubdirs[j]);
            if (sv.length > 0) {
                sv.sort();
                seasonsWithVids.push({ folder: ensureSlash(titleSubdirs[j]), videos: sv });
            }
        }
        seasonsWithVids.sort(function(a, b) { return basename(a.folder) < basename(b.folder) ? -1 : 1; });

        if (directEps.length > 0) {
            results.push({
                name:         titleName,
                type:         "anime",
                folderpath:   titlePath,
                thumbnail:    getFirstVideoThumb(directEps[0]),
                episodeCount: directEps.length,
                seasons:      [{ name: titleName, folderpath: titlePath, episodeCount: directEps.length }]
            });
        } else if (seasonsWithVids.length > 0) {
            var total   = 0;
            var seasons = [];
            for (var k = 0; k < seasonsWithVids.length; k++) {
                total += seasonsWithVids[k].videos.length;
                seasons.push({
                    name:         basename(seasonsWithVids[k].folder),
                    folderpath:   seasonsWithVids[k].folder,
                    episodeCount: seasonsWithVids[k].videos.length
                });
            }
            results.push({
                name:         titleName,
                type:         "anime",
                folderpath:   titlePath,
                thumbnail:    getFirstVideoThumb(seasonsWithVids[0].videos[0]),
                episodeCount: total,
                seasons:      seasons
            });
        }
        // else: skip empty title folder
    }
}

// Scan a Movie container: each immediate child (or loose file) is one movie (type "movie")
function scanMovieContainer(containerPath, results) {
    var cEnsure = ensureSlash(containerPath);
    var subs    = listSubdirs(cEnsure);
    for (var i = 0; i < subs.length; i++) {
        var sfPath = ensureSlash(subs[i]);
        var sfVids = listVideosInFolder(sfPath);
        sfVids.sort();
        if (sfVids.length > 0) {
            results.push({
                name:         basename(sfPath),
                type:         "movie",
                folderpath:   sfPath,
                thumbnail:    getFirstVideoThumb(sfVids[0]),
                episodeCount: sfVids.length,
                seasons:      []
            });
        } else {
            // One more level (e.g. Movie/Franchise/Film/*.mkv)
            var subSubs = listSubdirs(sfPath);
            for (var j = 0; j < subSubs.length; j++) {
                var ssVids = listVideosInFolder(subSubs[j]);
                ssVids.sort();
                if (ssVids.length > 0) {
                    results.push({
                        name:         basename(subSubs[j]),
                        type:         "movie",
                        folderpath:   ensureSlash(subSubs[j]),
                        thumbnail:    getFirstVideoThumb(ssVids[0]),
                        episodeCount: ssVids.length,
                        seasons:      []
                    });
                }
            }
        }
    }
    // Loose single-file movies directly in the container
    var loose = listVideosInFolder(cEnsure);
    loose.sort();
    for (var lv = 0; lv < loose.length; lv++) {
        var base = basename(loose[lv]);
        var dot  = base.lastIndexOf(".");
        results.push({
            name:         dot > 0 ? base.substring(0, dot) : base,
            type:         "movie",
            folderpath:   cEnsure,
            thumbnail:    getFirstVideoThumb(loose[lv]),
            episodeCount: 1,
            seasons:      [],
            _singleFile:  loose[lv]
        });
    }
}

// Classify a direct child of the Video/ folder.
//
//   subsWithVids.length > 0  →  "series"     (those subdirs are seasons)
//   directVideos.length > 0  →  "collection" (flat playlist)
//   otherwise                →  recurse one level (handles containers like Video/Pack/Series/)
//
// depth guards against infinite recursion; max 2 recursive calls from scanRoot.
function classifyVideoFolder(folderPath, results, depth) {
    depth = depth || 0;
    if (depth > 2) { return; }

    var ensure = ensureSlash(folderPath);
    var name   = basename(ensure);

    // Delegate to specialised scanners
    if (isAnimeFolderName(name)) { scanAnimeContainer(ensure, results); return; }
    if (isMovieFolderName(name)) { scanMovieContainer(ensure, results); return; }

    var directVideos = listVideosInFolder(ensure);
    directVideos.sort();

    var subdirs = listSubdirs(ensure);

    // Build list of immediate subdirs that contain video files directly inside them
    var subsWithVids = [];
    for (var i = 0; i < subdirs.length; i++) {
        var sv = listVideosInFolder(subdirs[i]);
        if (sv.length > 0) {
            sv.sort();
            subsWithVids.push({ folder: ensureSlash(subdirs[i]), videos: sv });
        }
    }
    subsWithVids.sort(function(a, b) { return basename(a.folder) < basename(b.folder) ? -1 : 1; });

    if (subsWithVids.length > 0) {
        // TV series / anime-style: subdirs are seasons
        var totalEps = 0;
        var seasons  = [];
        for (var s = 0; s < subsWithVids.length; s++) {
            totalEps += subsWithVids[s].videos.length;
            seasons.push({
                name:         basename(subsWithVids[s].folder),
                folderpath:   subsWithVids[s].folder,
                episodeCount: subsWithVids[s].videos.length
            });
        }
        results.push({
            name:         name,
            type:         "series",
            folderpath:   ensure,
            thumbnail:    getFirstVideoThumb(subsWithVids[0].videos[0]),
            episodeCount: totalEps,
            seasons:      seasons
        });
    } else if (directVideos.length > 0) {
        // Flat playlist: all videos live directly inside this folder
        results.push({
            name:         name,
            type:         "collection",
            folderpath:   ensure,
            thumbnail:    getFirstVideoThumb(directVideos[0]),
            episodeCount: directVideos.length,
            seasons:      []
        });
    } else {
        // Container with no direct videos and no season subdirs → recurse
        for (var r = 0; r < subdirs.length; r++) {
            classifyVideoFolder(subdirs[r], results, depth + 1);
        }
    }
}

// ── Root scanner ──────────────────────────────────────────────────────────────

function scanRoot(rootPath) {
    var albums = [];
    var ensure = ensureSlash(rootPath);

    // 1. root:/Video/ — each immediate subfolder becomes a library entry
    var videoBase = ensure + VIDEO_FOLDER_NAME + "/";
    if (filelib.fileExists(videoBase)) {
        var videoDirs = listSubdirs(videoBase);
        for (var i = 0; i < videoDirs.length; i++) {
            classifyVideoFolder(videoDirs[i], albums, 0);
        }
        // Loose video files directly in Video/ → individual "short" entries
        var looseVideos = listVideosInFolder(videoBase);
        looseVideos.sort();
        for (var lv = 0; lv < looseVideos.length; lv++) {
            var lvBase = basename(looseVideos[lv]);
            var lvDot  = lvBase.lastIndexOf(".");
            albums.push({
                name:         lvDot > 0 ? lvBase.substring(0, lvDot) : lvBase,
                type:         "short",
                folderpath:   videoBase,
                thumbnail:    getFirstVideoThumb(looseVideos[lv]),
                episodeCount: 1,
                seasons:      [],
                _singleFile:  looseVideos[lv]
            });
        }
    }

    // 2. Root-level Movie/Movies and Anime folders (siblings of Video/)
    var rootDirs = listSubdirs(ensure);
    for (var d = 0; d < rootDirs.length; d++) {
        var dirName = basename(rootDirs[d]);
        if (dirName === VIDEO_FOLDER_NAME) { continue; } // already processed above
        if (MOVIE_FOLDER_NAMES.indexOf(dirName.toLowerCase()) >= 0) {
            scanMovieContainer(rootDirs[d], albums);
        }
        if (isAnimeFolderName(dirName)) {
            scanAnimeContainer(rootDirs[d], albums);
        }
    }

    return albums;
}

// ── Entry point ───────────────────────────────────────────────────────────────

function main() {
    var allAlbums = [];
    var roots     = filelib.glob("/");
    if (!roots) { roots = []; }

    for (var i = 0; i < roots.length; i++) {
        if (shouldSkipRoot(roots[i])) { continue; }
        var found = scanRoot(roots[i]);
        for (var j = 0; j < found.length; j++) { allAlbums.push(found[j]); }
    }

    // Persist to server-side cache so any device (or next session) can load instantly.
    // This runs before sendJSONResp so the file is guaranteed written even if the
    // client closes the tab before the response arrives.
    try {
        if (!filelib.fileExists("user:/Document/"))           { filelib.mkdir("user:/Document/"); }
        if (!filelib.fileExists("user:/Document/Appdata/"))   { filelib.mkdir("user:/Document/Appdata/"); }
        if (!filelib.fileExists("user:/Document/Appdata/Movie/")) { filelib.mkdir("user:/Document/Appdata/Movie/"); }
        filelib.writeFile(
            "user:/Document/Appdata/Movie/library_cache.json",
            JSON.stringify({ ts: new Date().getTime(), data: allAlbums })
        );
    } catch (e) {}  // never let a cache-write failure break the response

    sendJSONResp(JSON.stringify(allAlbums));
}

main();
