/*
    Movie App - IMDB Info Fetcher
    Searches the IMDB API for a movie by title and caches the result locally.

    POST params:
        movie – movie title to search for

    Cache: user:/Document/Appdata/Movie/{sanitized_title}.json
    Returns JSON: first IMDB search result, or { error: "..." }

    Result fields (from iamidiotareyoutoo.com search API):
        #TITLE, #YEAR, #IMDB_ID, #ACTORS, #AKA, #IMDB_URL, #IMG_POSTER,
        photo_width, photo_height
*/

includes("common.js");
requirelib("filelib");
requirelib("http");

var CACHE_DIR = "user:/Document/Appdata/Movie/";

// Sanitize a string into a safe filename
function sanitize(str) {
    var out = "";
    var s   = str.toLowerCase();
    for (var i = 0; i < s.length; i++) {
        var c = s[i];
        if ((c >= "a" && c <= "z") || (c >= "0" && c <= "9")) { out += c; }
        else { out += "_"; }
    }
    // Collapse runs of underscores
    while (out.indexOf("__") >= 0) { out = out.split("__").join("_"); }
    return out.substring(0, 80);
}

// Create a directory only if it does not already exist
function mkdirIfMissing(path) {
    if (!filelib.fileExists(path)) { filelib.mkdir(path); }
}

// Minimal URL-safe encoding for a query string value
function urlEncode(str) {
    var out = "";
    for (var i = 0; i < str.length; i++) {
        var c = str[i];
        if (c === " ") { out += "+"; }
        else if (
            (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") ||
            (c >= "0" && c <= "9") || c === "-" || c === "_" || c === "." || c === "~"
        ) { out += c; }
        else { out += encodeURIComponent(c); }
    }
    return out;
}

// Recognised technical tokens that appear after the release year in scene filenames.
// Shared by extractMovieTitle() and extractYear() so both use identical logic.
var TECH_TOKEN =
    "\\d{3,4}[pP]|4[kK]|2160[pP]|" +
    "BluRay|Blu-Ray|BRRip|BDRip|BDRemux|REMUX|" +
    "WEB-DL|WEBRip|WEB|AMZN|NF|HULU|DSNP|ATVP|PCOK|U-NEXT|IMAX|" +
    "DVDRip|DVDScr|HDTV|PDTV|DSRip|HC|" +
    "x264|x265|X264|X265|XViD|DivX|HEVC|AVC|H\\.264|H\\.265|H264|H265|" +
    "AAC|AC3|DTS|MP3|FLAC|DD5|DD\\+|TrueHD|Atmos|" +
    "PROPER|REPACK|EXTENDED|THEATRICAL|LIMITED|INTERNAL|READNFO|DC|3D|" +
    "YIFY|YTS|RARBG|ETRG|FGT|SPARKS|NTG|GECKOS|VISUM|FraMeSToR";

// Shared preprocessing: normalise separators and glued years so both
// extractMovieTitle() and extractYear() operate on the same clean string.
function preprocessName(raw) {
    var s = raw;
    s = s.replace(/\[[^\]]*\]/g, " ").replace(/\([^)]*\)/g, " ");
    if ((s.match(/[A-Za-z0-9]\.[A-Za-z0-9]/g) || []).length >= 3) {
        s = s.split(".").join(" ");
    }
    s = s.split("_").join(" ").replace(/\s+/g, " ").trim();
    // Insert space before a year glued to a word (Movie2023 → Movie 2023)
    s = s.replace(/([A-Za-z])((?:19|20)\d{2})\b/g, "$1 $2");
    return s;
}

/*
    Extract a clean movie title from a scene-release filename / folder name.

    Strategy:
        1-4. Shared preprocessing (preprocessName)
        5.   Find the FIRST year followed by a technical token → cut there.
             This avoids cutting on a year that IS the title (e.g. "1917 2019 1080p").
        6.   Fall back to any standalone four-digit year.
        7.   No year: strip residual tech tokens in-place.
*/
function extractMovieTitle(raw) {
    var s      = preprocessName(raw);
    var techRe = new RegExp("\\b((?:19|20)\\d{2})\\s+(?:" + TECH_TOKEN + ")\\b", "i");
    var m      = s.match(techRe);
    if (m) {
        s = s.substring(0, m.index).trim();
    } else {
        var ym = s.match(/\b((?:19|20)\d{2})\b/);
        if (ym) {
            s = s.substring(0, ym.index).trim();
        } else {
            var strips = [
                /\b\d{3,4}[pP]\b/g,
                /\b4[kK]\b/g,
                new RegExp("\\b(?:" + TECH_TOKEN + ")\\b", "gi"),
                /\s*-\s*[A-Z0-9]{2,}$/i
            ];
            for (var i = 0; i < strips.length; i++) { s = s.replace(strips[i], " "); }
        }
    }
    s = s.replace(/\s+/g, " ").trim().replace(/^[-.\s]+/, "").replace(/[-.\s]+$/, "").trim();
    return s.length > 0 ? s : raw;
}

/*
    Extract the release year embedded in a filename, or null if none found.
    Uses the same preprocessing and priority as extractMovieTitle so the two
    functions always agree on which number is the year.
*/
function extractYear(raw) {
    var s      = preprocessName(raw);
    var techRe = new RegExp("\\b((?:19|20)\\d{2})\\s+(?:" + TECH_TOKEN + ")\\b", "i");
    var m      = s.match(techRe);
    if (m) { return m[1]; }
    var ym = s.match(/\b((?:19|20)\d{2})\b/);
    if (ym) { return ym[1]; }
    return null;
}

function main() {
    if (!movie || movie === "undefined" || movie.length === 0) {
        sendJSONResp(JSON.stringify({ error: "Missing movie name" }));
        return;
    }

    // Ensure cache hierarchy exists
    mkdirIfMissing("user:/Document/");
    mkdirIfMissing("user:/Document/Appdata/");
    mkdirIfMissing(CACHE_DIR);

    var cacheFile = CACHE_DIR + sanitize(movie) + ".json";

    // Return from cache if available
    if (filelib.fileExists(cacheFile)) {
        var cached = filelib.readFile(cacheFile);
        if (cached !== false && cached.length > 2) {
            sendJSONResp(cached);   // must use sendJSONResp so jQuery parses it as an object
            return;
        }
    }

    var cleanTitle = extractMovieTitle(movie);
    var filmYear   = extractYear(movie);   // e.g. "1951", or null

    // Fetch from IMDB search API
    var url  = "https://imdb.iamidiotareyoutoo.com/search?q=" + urlEncode(cleanTitle);
    var resp = http.get(url);
    if (!resp || resp === false || resp.length === 0) {
        sendJSONResp(JSON.stringify({ error: "API unreachable" }));
        return;
    }

    var data;
    try { data = JSON.parse(resp); } catch (e) {
        sendJSONResp(JSON.stringify({ error: "Invalid API response" }));
        return;
    }

    if (!data.ok || !data.description || data.description.length === 0) {
        sendJSONResp(JSON.stringify({ error: "not_found" }));
        return;
    }

    // Pick the result whose year matches the filename year (if we detected one).
    // Fall back to the first result when there is no year or no match.
    var result = data.description[0];
    if (filmYear && data.description.length > 1) {
        for (var ri = 0; ri < data.description.length; ri++) {
            if (String(data.description[ri]["#YEAR"]) === filmYear) {
                result = data.description[ri];
                break;
            }
        }
    }

    filelib.writeFile(cacheFile, JSON.stringify(result));
    sendJSONResp(JSON.stringify(result));
}

main();
