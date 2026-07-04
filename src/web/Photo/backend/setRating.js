/*
    setRating.js

    Set (or clear) the user's star rating for a single photo. Ratings are stored
    per-user in the photo_ratings table (see imagedb.js) keyed by the photo's
    virtual path, so they persist across re-indexing and schema rebuilds.

    Request body (JSON):
      { "filepath": "user:/Photo/a.jpg", "rating": 0..5 }

    A rating of 0 (or less) clears the rating.

    Response (JSON):
      { ok: true, filepath, rating }   // rating is the stored value (0 = cleared)
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
        sendJSONResp(JSON.stringify({ error: "missing filepath" }));
        return;
    }

    var db = openIndexDB();
    if (db == null) {
        sendJSONResp(JSON.stringify({ error: "index unavailable" }));
        return;
    }

    var stored = db_setRating(db, filepath, payload.rating);
    db.close();

    sendJSONResp(JSON.stringify({ ok: true, filepath: filepath, rating: stored }));
}

main();
