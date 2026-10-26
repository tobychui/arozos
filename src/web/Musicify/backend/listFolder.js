/*
    Musicify - List Folder Contents
    Parameters: folder (vpath, URL-encoded)
    Returns: { folders: [string], songs: [{filepath, name, ext, filesize, hsize, mtime}] }

    NOTE: We use filelib.readdir() rather than filelib.aglob() here because
    aglob fails silently on non-user:/ virtual drives (e.g. "D:/" on Windows)
    regardless of the sort/scope parameter supplied.  filelib.readdir() uses a
    different internal code-path that works across every mounted drive, which is
    why the legacy Music module (the only other backend that lists drives) also
    uses readdir exclusively.
*/
includes("common.js");
requirelib("filelib");

function main() {
    if (typeof(folder) === "undefined" || folder === "") {
        sendJSONResp(JSON.stringify({ error: "folder parameter required" }));
        return;
    }

    var decodedFolder = decodeURIComponent(folder);
    // Normalise: strip any trailing "/*" glob suffix or bare trailing slash
    decodedFolder = decodedFolder.replace(/\/\*$/, "").replace(/\/$/, "");

    // filelib.readdir returns an array of entry objects:
    //   { Filepath, Filename, IsDir, Ext, Filesize, LastModified }
    // This works on all mounted drives including Windows drive-letter roots
    // (D:/, E:/ …) where filelib.aglob fails silently.
    var entries = filelib.readdir(decodedFolder);
    var subfolders = [];
    var songs = [];

    if (entries) {
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var f = entry.Filepath;
            if (!f || isHiddenFile(f)) continue;
            if (entry.IsDir) {
                subfolders.push(f);
            } else if (isMusicFile(f)) {
                songs.push(buildSongEntry(f));
            }
        }
    }

    sendJSONResp(JSON.stringify({ folders: subfolders, songs: songs }));
}

main();
