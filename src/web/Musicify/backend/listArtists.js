/*
    Musicify - List Artists
    Recursively walks each root's Music/ directory and groups music files by their
    immediate parent folder — so nested structures like Music/Genre/Artist/track.mp3
    correctly surface "Artist" as the artist, not "Genre".
    Files sitting directly in Music/ are grouped under "Unknown Artist".
    Returns: [ { name, path, songCount, songs: [{...}] } ]
*/
includes("common.js");
requirelib("filelib");

function main() {
    var musicRoots = getMusicRoots();
    // Key: full parent-folder path (guarantees uniqueness across roots/nesting levels)
    var artistMap = {};

    for (var r = 0; r < musicRoots.length; r++) {
        var musicRoot = musicRoots[r]; // e.g. "user:/Music/"

        // Walk ALL files under the music root recursively
        var allFiles = filelib.walk(musicRoot, "file");

        for (var i = 0; i < allFiles.length; i++) {
            var f = allFiles[i];
            if (!isMusicFile(f) || isHiddenFile(f)) continue;

            // Derive the immediate parent folder path
            var parts = f.split("/");
            parts.pop(); // remove filename
            var parentPath = parts.join("/") + "/";

            var artistKey, artistName, artistPath;

            if (parentPath === musicRoot) {
                // File lives directly inside Music/ → Unknown Artist
                artistKey  = musicRoot + "__unknown__";
                artistName = "Unknown Artist";
                artistPath = musicRoot;
            } else {
                // Use the full parent path as the unique key
                artistKey  = parentPath;
                artistName = parts[parts.length - 1]; // last path component
                artistPath = parentPath;
            }

            if (!artistMap[artistKey]) {
                artistMap[artistKey] = { name: artistName, path: artistPath, songs: [] };
            }
            artistMap[artistKey].songs.push(buildSongEntry(f));
        }
    }

    var artists = [];
    var keys = Object.keys(artistMap);
    for (var i = 0; i < keys.length; i++) {
        var a = artistMap[keys[i]];
        if (a.songs.length > 0) {
            artists.push({ name: a.name, path: a.path, songCount: a.songs.length, songs: a.songs });
        }
    }

    artists.sort(function(a, b) {
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });

    sendJSONResp(JSON.stringify(artists));
}

main();
