/*
    Musicify - List Folder Contents
    Parameters: folder (vpath, URL-encoded)
    Returns: { folders: [string], songs: [{filepath, name, ext, filesize, hsize, mtime}] }
*/
includes("common.js");
requirelib("filelib");

function main() {
    if (typeof(folder) === "undefined" || folder === "") {
        sendJSONResp(JSON.stringify({ error: "folder parameter required" }));
        return;
    }

    var decodedFolder = decodeURIComponent(folder);
    // Remove trailing wildcard/slash if present
    decodedFolder = decodedFolder.replace(/\/\*$/, "").replace(/\/$/, "");

    var results = filelib.aglob(decodedFolder + "/*", "user");
    var subfolders = [];
    var songs = [];

    for (var i = 0; i < results.length; i++) {
        var f = results[i];
        if (isHiddenFile(f)) continue;
        if (filelib.isDir(f)) {
            subfolders.push(f);
        } else if (isMusicFile(f)) {
            songs.push(buildSongEntry(f));
        }
    }

    sendJSONResp(JSON.stringify({ folders: subfolders, songs: songs }));
}

main();
