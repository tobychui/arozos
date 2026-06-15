/*
    Musicify - List Music Library Roots
    Enumerates all mounted storage roots that have a Music/ folder.
    Returns: [ { label, root } ]
      label: disk identifier, e.g. "user:" or "disk:"
      root:  vpath to the Music folder without trailing slash, e.g. "user:/Music"
*/
includes("common.js");
requirelib("filelib");

function main() {
    var musicRoots = getMusicRoots();
    var result = [];
    for (var i = 0; i < musicRoots.length; i++) {
        // getMusicRoots() returns paths like "user:/Music/" — strip trailing slash
        var cleanRoot = musicRoots[i].replace(/\/$/, "");
        // Extract the disk identifier (part before the first colon)
        var diskId = cleanRoot.split(":")[0] + ":";
        result.push({ label: diskId, root: cleanRoot });
    }
    sendJSONResp(JSON.stringify(result));
}

main();
