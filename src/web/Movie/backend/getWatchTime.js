/*
    Movie App - Get Watch Position
    Returns the saved playback position for a video file.

    POST params:
        filepath – virtual path of the video file

    Returns JSON: { position: <seconds>, duration: <seconds>, ts: <unix-ms> }
    or { error: "no_data" }
*/

includes("common.js");

function main() {
    if (!filepath || filepath === "undefined" || filepath.length === 0) {
        sendJSONResp(JSON.stringify({ error: "Missing filepath" }));
        return;
    }

    newDBTableIfNotExists("movie_watchtime");
    var stored = readDBItem("movie_watchtime", filepath);

    if (!stored || stored === false || stored.length === 0) {
        sendJSONResp(JSON.stringify({ error: "no_data" }));
        return;
    }

    sendResp(stored); // already a JSON string
}

main();
