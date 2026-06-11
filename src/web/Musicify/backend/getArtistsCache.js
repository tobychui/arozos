/*
    Musicify - Artists Cache Reader
    Returns the previously-saved artists list from server storage.
    Does NO file-system scanning — responds in milliseconds.

    Written by listArtists.js after every full scan, so it is always as fresh
    as the last completed scan (even if the browser tab was closed during it).

    Returns JSON: { ts: <unix-ms>, items: [...artists] }
    or            { error: "no_cache" }
*/

includes("common.js");
requirelib("filelib");

var CACHE_FILE = "user:/.appdata/Musicify/artists_cache.json";

function main() {
    if (!filelib.fileExists(CACHE_FILE)) {
        sendJSONResp(JSON.stringify({ error: "no_cache" }));
        return;
    }
    var content = filelib.readFile(CACHE_FILE);
    if (!content || content === false || content.length < 10) {
        sendJSONResp(JSON.stringify({ error: "no_cache" }));
        return;
    }
    sendJSONResp(content);  // { ts, items } — already valid JSON
}

main();
