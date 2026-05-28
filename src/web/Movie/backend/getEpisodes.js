/*
    Movie App - Episode Lister
    Given a folder path (POST param: folder), returns all video files in that folder.

    POST params:
        folder  – virtual path to a folder (e.g. "user:/Video/House MD/Season 1/")

    Returns JSON array:
    [
        { "name": "Episode 1 - Pilot", "filepath": "user:/Video/...", "ext": ".mp4", "index": 0 },
        ...
    ]
*/

// ── Load shared config ────────────────────────────────────────────────────────
includes("common.js");
requirelib("filelib");

// ── Helpers ───────────────────────────────────────────────────────────────────

function fileExt(filepath) {
    var parts = filepath.split(".");
    if (parts.length < 2) { return ""; }
    return "." + parts[parts.length - 1].toLowerCase();
}

function basename(filepath) {
    var clean = filepath;
    if (clean[clean.length - 1] === "/") { clean = clean.slice(0, -1); }
    var parts = clean.split("/");
    return parts[parts.length - 1];
}

function displayName(filepath) {
    var base = basename(filepath);
    // strip extension
    var dotIdx = base.lastIndexOf(".");
    if (dotIdx > 0) { base = base.substring(0, dotIdx); }
    return base;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
    if (!folder || folder === "undefined" || folder.length === 0) {
        sendJSONResp(JSON.stringify({ error: "Missing required parameter: folder" }));
        return;
    }

    var ensure = folder;
    if (ensure[ensure.length - 1] !== "/") { ensure += "/"; }

    if (!filelib.fileExists(ensure)) {
        sendJSONResp(JSON.stringify({ error: "Folder not found: " + ensure }));
        return;
    }

    var episodes = [];
    var idx = 0;
    for (var i = 0; i < VALID_VIDEO_FORMATS.length; i++) {
        var found = filelib.aglob(ensure + "*." + VALID_VIDEO_FORMATS[i]);
        if (!found) { continue; }
        for (var j = 0; j < found.length; j++) {
            var fname = basename(found[j]);
            // skip macOS resource fork files
            if (fname.substr(0, 2) === "._") { continue; }
            episodes.push({
                name    : displayName(found[j]),
                filepath: found[j],
                ext     : fileExt(found[j]),
                index   : idx
            });
            idx++;
        }
    }

    // Natural sort by name
    episodes.sort(function(a, b) {
        return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });

    // Re-index after sort
    for (var k = 0; k < episodes.length; k++) {
        episodes[k].index = k;
    }

    sendJSONResp(JSON.stringify(episodes));
}

main();
