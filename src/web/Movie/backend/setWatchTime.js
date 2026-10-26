/*
    Movie App - Save Watch Position
    Stores or clears the playback position for a video file.
    Pass position=0 to clear (video finished or user reset).

    POST params:
        filepath – virtual path of the video file
        position – current time in seconds  (0 = clear the entry)
        duration – total duration in seconds
*/

includes("common.js");

function main() {
    if (!filepath || filepath === "undefined" || filepath.length === 0) {
        sendJSONResp(JSON.stringify({ error: "Missing filepath" }));
        return;
    }

    var pos = parseInt(position, 10);
    var dur = parseInt(duration,  10);
    if (isNaN(pos)) { pos = 0; }
    if (isNaN(dur)) { dur = 0; }

    newDBTableIfNotExists("movie_watchtime");

    if (pos <= 0) {
        deleteDBItem("movie_watchtime", filepath);
    } else {
        writeDBItem("movie_watchtime", filepath, JSON.stringify({
            position: pos,
            duration: dur,
            ts:       new Date().getTime()
        }));
    }

    sendOK();
}

main();
