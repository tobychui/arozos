/*
    Musicify - List Artists
    Groups all music files by top-level folder under each root's Music/ directory.
    Returns: [ { name, path, songCount, songs: [{...}] } ]
*/
includes("common.js");
requirelib("filelib");

function main() {
    var musicRoots = getMusicRoots();
    var artistMap = {};

    for (var r = 0; r < musicRoots.length; r++) {
        var musicRoot = musicRoots[r];
        var topEntries = filelib.aglob(musicRoot + "*", "default");

        // Songs directly in Music/ root belong to "Unknown Artist"
        for (var i = 0; i < topEntries.length; i++) {
            var entry = topEntries[i];
            if (isHiddenFile(entry)) continue;
            if (!filelib.isDir(entry) && isMusicFile(entry)) {
                if (!artistMap["__unknown__"]) {
                    artistMap["__unknown__"] = { name: "Unknown Artist", path: musicRoot, songs: [] };
                }
                artistMap["__unknown__"].songs.push(buildSongEntry(entry));
            }
        }

        // Each subdirectory is an artist
        for (var i = 0; i < topEntries.length; i++) {
            var artistDir = topEntries[i];
            if (!filelib.isDir(artistDir) || isHiddenFile(artistDir)) continue;

            var artistName = artistDir.split("/").pop();
            if (!artistMap[artistName]) {
                artistMap[artistName] = { name: artistName, path: artistDir, songs: [] };
            }

            var songFiles = filelib.walk(artistDir, "file");
            for (var j = 0; j < songFiles.length; j++) {
                var f = songFiles[j];
                if (isMusicFile(f) && !isHiddenFile(f)) {
                    artistMap[artistName].songs.push(buildSongEntry(f));
                }
            }
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
