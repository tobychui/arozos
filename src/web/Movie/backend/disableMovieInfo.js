/*
    Movie App - Disable IMDB Info
    Writes a {"_disabled":true} marker into the movie's cache file so that
    getMovieInfo.js will not attempt to fetch (or serve) IMDB data for it again.

    POST params:
        movie – raw movie name (same value passed to getMovieInfo.js)
*/

includes("common.js");
requirelib("filelib");

var CACHE_DIR = "user:/.appdata/Movie/";

// Must stay in sync with the sanitize() function in getMovieInfo.js
function sanitize(str) {
    var out = "";
    var s   = str.toLowerCase();
    for (var i = 0; i < s.length; i++) {
        var c = s[i];
        if ((c >= "a" && c <= "z") || (c >= "0" && c <= "9")) { out += c; }
        else { out += "_"; }
    }
    while (out.indexOf("__") >= 0) { out = out.split("__").join("_"); }
    return out.substring(0, 80);
}

function mkdirIfMissing(path) {
    if (!filelib.fileExists(path)) { filelib.mkdir(path); }
}

function main() {
    if (!movie || movie === "undefined" || movie.length === 0) {
        sendJSONResp(JSON.stringify({ error: "Missing movie name" }));
        return;
    }

    mkdirIfMissing("user:/.appdata/");
    mkdirIfMissing(CACHE_DIR);

    var cacheFile = CACHE_DIR + sanitize(movie) + ".json";
    filelib.writeFile(cacheFile, JSON.stringify({ _disabled: true }));
    sendOK();
}

main();
