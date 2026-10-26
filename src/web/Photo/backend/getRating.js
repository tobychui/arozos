/*
    getRating.js

    Return the user's star rating (0 = unrated) for a single photo. Used by the
    viewer to show the current rating when a photo is opened from a folder (search
    results already carry the rating inline).

    Request body (JSON):
      { "filepath": "user:/Photo/a.jpg" }

    Response (JSON):
      { filepath, rating }   // rating is 0..5
*/

includes("imagedb.js");

function main() {
    var rawBody = (typeof POST_data !== "undefined") ? POST_data : "{}";
    var payload = {};
    try {
        payload = JSON.parse(rawBody) || {};
    } catch (e) {
        payload = {};
    }

    var filepath = payload.filepath || "";
    if (!filepath) {
        sendJSONResp(JSON.stringify({ rating: 0 }));
        return;
    }

    var db = openIndexDB();
    if (db == null) {
        sendJSONResp(JSON.stringify({ rating: 0 }));
        return;
    }

    var rating = db_getRating(db, filepath);
    db.close();

    sendJSONResp(JSON.stringify({ filepath: filepath, rating: rating }));
}

main();
