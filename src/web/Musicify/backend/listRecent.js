/*
    Musicify - List Recent Songs
    Scans all Music/ folders and returns up to 300 songs sorted by modification time (newest first).
    Returns: [{filepath, name, ext, filesize, hsize, mtime}]
*/
includes("common.js");
requirelib("filelib");

function main() {
    var musicRoots = getMusicRoots();
    var songs = [];

    for (var r = 0; r < musicRoots.length; r++) {
        var allFiles = filelib.walk(musicRoots[r], "file");
        for (var i = 0; i < allFiles.length; i++) {
            var f = allFiles[i];
            if (isMusicFile(f) && !isHiddenFile(f)) {
                songs.push(buildSongEntry(f));
            }
        }
    }

    songs.sort(function(a, b) { return b.mtime - a.mtime; });
    if (songs.length > 300) songs = songs.slice(0, 300);

    sendJSONResp(JSON.stringify(songs));
}

main();
