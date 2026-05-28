/*
    Movie App - Library Scanner
    Scans all file-system roots for video content.

    Scanning strategy:
      • root:/Video/       – scanned normally; subfolders classified as series or movie
      • root:/Movie/ etc.  – all subfolders forced to type "movie"
      • Any folder named "Movie" or "Movies" anywhere in the tree is treated the same

    Album object returned:
    {
        "name"        : "House MD",
        "type"        : "series" | "movie",
        "folderpath"  : "user:/Video/House MD/",
        "thumbnail"   : "<base64>" | "",
        "episodeCount": 44,
        "seasons"     : [              // only for "series"
            { "name": "Season 1", "folderpath": "…/", "episodeCount": 22 }
        ]
    }
*/

// ── Load shared config ────────────────────────────────────────────────────────
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

// Return video files directly inside a folder (non-recursive)
function listVideosInFolder(folderPath) {
    var ensure = ensureSlash(folderPath);
    var videos = [];
    for (var i = 0; i < VALID_VIDEO_FORMATS.length; i++) {
        var found = filelib.aglob(ensure + "*." + VALID_VIDEO_FORMATS[i]);
        if (found && found.length > 0) {
            for (var j = 0; j < found.length; j++) {
                var fname = basename(found[j]);
                if (fname.substr(0, 2) !== "._") { videos.push(found[j]); }
            }
        }
    }
    return videos;
}

// Return immediate subdirectories of a folder
function listSubdirs(folderPath) {
    var ensure = ensureSlash(folderPath);
    var all = filelib.walk(ensure, "folder");
    if (!all) { return []; }
    var immediate = [];
    for (var i = 0; i < all.length; i++) {
        var rel  = all[i].replace(ensure, "");
        var segs = rel.split("/").filter(function (s) { return s.length > 0; });
        if (segs.length === 1) { immediate.push(ensureSlash(all[i])); }
    }
    return immediate;
}

// Thumbnail from the first video file (better than folder icon)
function getFirstVideoThumb(videoFile) {
    if (!videoFile) { return ""; }
    var thumb = imagelib.loadThumbString(videoFile);
    if (thumb !== false && thumb !== null && typeof thumb === "string" && thumb.length > 0) {
        return thumb;
    }
    return "";
}

// ── Recursive folder classifier ───────────────────────────────────────────────
//
//   folderPath  – folder to classify
//   forceMovie  – true when an ancestor "Movie/Movies" folder was detected
//   results     – array to push result objects into
//   depth       – recursion guard (max 6 levels)
//
function scanAlbumFolder(folderPath, forceMovie, results, depth) {
    depth = depth || 0;
    if (depth > 6) { return; }

    var ensure = ensureSlash(folderPath);
    var name   = basename(ensure);

    // ── If THIS folder is named "Anime", each subfolder is its own series ────
    if (isAnimeFolderName(name)) {
        var animeSubs = listSubdirs(ensure);
        for (var ai = 0; ai < animeSubs.length; ai++) {
            var titlePath = ensureSlash(animeSubs[ai]);
            var titleName = basename(titlePath);
            var directEps = listVideosInFolder(titlePath);
            directEps.sort();
            var titleDirs = listSubdirs(titlePath);
            var titleSeasonsWithVids = [];
            for (var tj = 0; tj < titleDirs.length; tj++) {
                var sv = listVideosInFolder(titleDirs[tj]);
                if (sv.length > 0) {
                    sv.sort();
                    titleSeasonsWithVids.push({ folder: titleDirs[tj], videos: sv });
                }
            }
            titleSeasonsWithVids.sort(function (a, b) {
                return basename(a.folder) < basename(b.folder) ? -1 : 1;
            });
            if (directEps.length > 0) {
                // Episodes sitting directly in the title folder → one implicit season
                results.push({
                    name:         titleName,
                    type:         "anime",
                    folderpath:   titlePath,
                    thumbnail:    getFirstVideoThumb(directEps[0]),
                    episodeCount: directEps.length,
                    seasons:      [{ name: titleName, folderpath: titlePath, episodeCount: directEps.length }]
                });
            } else if (titleSeasonsWithVids.length > 0) {
                // Season sub-folders found
                var aTotalEps = 0;
                var aSeasons  = [];
                for (var ts = 0; ts < titleSeasonsWithVids.length; ts++) {
                    aTotalEps += titleSeasonsWithVids[ts].videos.length;
                    aSeasons.push({
                        name:         basename(titleSeasonsWithVids[ts].folder),
                        folderpath:   titleSeasonsWithVids[ts].folder,
                        episodeCount: titleSeasonsWithVids[ts].videos.length
                    });
                }
                results.push({
                    name:         titleName,
                    type:         "anime",
                    folderpath:   titlePath,
                    thumbnail:    getFirstVideoThumb(titleSeasonsWithVids[0].videos[0]),
                    episodeCount: aTotalEps,
                    seasons:      aSeasons
                });
            } else {
                // Empty or nested structure – fall back to normal scanning
                scanAlbumFolder(titlePath, false, results, depth + 1);
            }
        }
        return;
    }

    // ── If THIS folder is named "Movie/Movies", scan its children as movies ──
    if (isMovieFolderName(name)) {
        var subs = listSubdirs(ensure);
        for (var i = 0; i < subs.length; i++) {
            scanAlbumFolder(subs[i], true, results, depth + 1);
        }
        // Loose videos directly inside the Movie folder
        var looseVids = listVideosInFolder(ensure);
        looseVids.sort();
        for (var lv = 0; lv < looseVids.length; lv++) {
            var lvName   = basename(looseVids[lv]);
            var dot      = lvName.lastIndexOf(".");
            var displayN = dot > 0 ? lvName.substring(0, dot) : lvName;
            results.push({
                name:         displayN,
                type:         "movie",
                folderpath:   ensure,
                thumbnail:    getFirstVideoThumb(looseVids[lv]),
                episodeCount: 1,
                seasons:      [],
                _singleFile:  looseVids[lv]
            });
        }
        return;
    }

    // ── Gather direct content ─────────────────────────────────────────────────
    var directVideos = listVideosInFolder(ensure);
    directVideos.sort();

    var subdirs = listSubdirs(ensure);

    // Find sub-folders that have videos directly inside them
    var subsWithVideos = [];
    for (var k = 0; k < subdirs.length; k++) {
        var sf    = subdirs[k];
        var svids = listVideosInFolder(sf);
        svids.sort();
        if (svids.length > 0) {
            subsWithVideos.push({ folder: sf, videos: svids });
        }
    }
    // Sort seasons naturally by name
    subsWithVideos.sort(function (a, b) {
        return basename(a.folder) < basename(b.folder) ? -1 : 1;
    });

    // ── Case 1: folder has direct videos → movie/album ────────────────────────
    if (directVideos.length > 0) {
        results.push({
            name:         name,
            type:         "movie",
            folderpath:   ensure,
            thumbnail:    getFirstVideoThumb(directVideos[0]),
            episodeCount: directVideos.length,
            seasons:      []
        });
        return;
    }

    // ── Case 2: sub-folders contain videos ────────────────────────────────────
    if (subsWithVideos.length > 0) {
        if (forceMovie) {
            // Movie context → each sub-folder is a separate movie
            for (var m = 0; m < subsWithVideos.length; m++) {
                var sfF = subsWithVideos[m].folder;
                var sfV = subsWithVideos[m].videos;
                results.push({
                    name:         basename(sfF),
                    type:         "movie",
                    folderpath:   sfF,
                    thumbnail:    sfV.length > 0 ? getFirstVideoThumb(sfV[0]) : "",
                    episodeCount: sfV.length,
                    seasons:      []
                });
            }
        } else {
            // Normal context → TV series with seasons
            var totalEps = 0;
            var seasons  = [];
            for (var s = 0; s < subsWithVideos.length; s++) {
                totalEps += subsWithVideos[s].videos.length;
                seasons.push({
                    name:         basename(subsWithVideos[s].folder),
                    folderpath:   subsWithVideos[s].folder,
                    episodeCount: subsWithVideos[s].videos.length
                });
            }
            // Thumbnail: first video of first (alphabetically first) season
            var seriesThumb = subsWithVideos[0].videos.length > 0
                ? getFirstVideoThumb(subsWithVideos[0].videos[0]) : "";
            results.push({
                name:         name,
                type:         "series",
                folderpath:   ensure,
                thumbnail:    seriesThumb,
                episodeCount: totalEps,
                seasons:      seasons
            });
        }
        return;
    }

    // ── Case 3: empty / container folder → recurse into sub-folders ───────────
    for (var r = 0; r < subdirs.length; r++) {
        scanAlbumFolder(subdirs[r], forceMovie, results, depth + 1);
    }
}

// ── Root scanner ──────────────────────────────────────────────────────────────

function scanRoot(rootPath) {
    var albums = [];
    var ensure = ensureSlash(rootPath);

    // 1. Scan root:/Video/ (primary video library)
    var videoBase = ensure + VIDEO_FOLDER_NAME + "/";
    if (filelib.fileExists(videoBase)) {
        var videoDirs = listSubdirs(videoBase);
        for (var i = 0; i < videoDirs.length; i++) {
            scanAlbumFolder(videoDirs[i], false, albums, 0);
        }
        // Loose videos sitting directly in Video/ → individual "short" entries
        var looseVideos = listVideosInFolder(videoBase);
        looseVideos.sort();
        for (var lv = 0; lv < looseVideos.length; lv++) {
            var lvName = basename(looseVideos[lv]);
            var lvDot  = lvName.lastIndexOf(".");
            var lvDisp = lvDot > 0 ? lvName.substring(0, lvDot) : lvName;
            albums.push({
                name:         lvDisp,
                type:         "short",
                folderpath:   videoBase,
                thumbnail:    getFirstVideoThumb(looseVideos[lv]),
                episodeCount: 1,
                seasons:      [],
                _singleFile:  looseVideos[lv]
            });
        }
    }

    // 2. Scan any root-level Movie/Movies folders (e.g. disk:/Movie/)
    var rootDirs = listSubdirs(ensure);
    for (var d = 0; d < rootDirs.length; d++) {
        var dirName      = basename(rootDirs[d]);
        var dirNameLower = dirName.toLowerCase();
        // Skip the Video folder (already handled above)
        if (dirName === VIDEO_FOLDER_NAME) { continue; }
        if (MOVIE_FOLDER_NAMES.indexOf(dirNameLower) >= 0) {
            var movieDirs = listSubdirs(rootDirs[d]);
            for (var m = 0; m < movieDirs.length; m++) {
                scanAlbumFolder(movieDirs[m], true, albums, 0);
            }
            // Loose videos directly in root:/Movie/
            var looseMovies = listVideosInFolder(rootDirs[d]);
            looseMovies.sort();
            for (var lm = 0; lm < looseMovies.length; lm++) {
                var lmName = basename(looseMovies[lm]);
                var lmDot  = lmName.lastIndexOf(".");
                var dispN  = lmDot > 0 ? lmName.substring(0, lmDot) : lmName;
                albums.push({
                    name:         dispN,
                    type:         "movie",
                    folderpath:   rootDirs[d],
                    thumbnail:    getFirstVideoThumb(looseMovies[lm]),
                    episodeCount: 1,
                    seasons:      [],
                    _singleFile:  looseMovies[lm]
                });
            }
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
        var root = roots[i];
        if (shouldSkipRoot(root)) { continue; }
        var found = scanRoot(root);
        for (var j = 0; j < found.length; j++) { allAlbums.push(found[j]); }
    }

    sendJSONResp(JSON.stringify(allAlbums));
}

main();
