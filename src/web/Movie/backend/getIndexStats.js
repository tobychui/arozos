/*
    Movie App - Index Statistics

    Reports the on-disk footprint of the library index plus how many storage
    roots a scan would visit. Deliberately does NOT parse the cache file — it
    can be several MB (thumbnails are inlined as base64) and the front end has
    already loaded that data via getLibraryCache.js, so album/video totals are
    counted client-side instead.

    Returns JSON:
      { exists: bool, sizeBytes: int, roots: int, skippedRoots: int }
*/

includes("common.js");
requirelib("filelib");

var CACHE_FILE = "user:/.appdata/Movie/library_cache.json";

function shouldSkipRoot(rootPath) {
    var lower = rootPath.toLowerCase();
    for (var i = 0; i < SKIP_ROOT_PREFIXES.length; i++) {
        if (lower.indexOf(SKIP_ROOT_PREFIXES[i]) === 0) { return true; }
    }
    return false;
}

function main() {
    var out = { exists: false, sizeBytes: 0, roots: 0, skippedRoots: 0 };

    // How many storage roots the scanner would walk on the next run
    var roots = filelib.glob("/");
    if (roots) {
        for (var i = 0; i < roots.length; i++) {
            if (shouldSkipRoot(roots[i])) { out.skippedRoots++; }
            else                          { out.roots++; }
        }
    }

    if (filelib.fileExists(CACHE_FILE)) {
        out.exists = true;
        try {
            var size = filelib.filesize(CACHE_FILE);
            if (size && size > 0) { out.sizeBytes = size; }
        } catch (e) {}
    }

    sendJSONResp(JSON.stringify(out));
}

main();
