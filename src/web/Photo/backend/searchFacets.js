/*
    searchFacets.js

    What the Photo filter panel can offer, read from the per-user index: the
    cameras, lenses and file types present (with photo counts), how many
    photos carry each star rating, and the ranges of the shooting values, so
    the panel only lists choices that will match something.

    Request body (JSON): { "folder": "user:/Photo/Trip" }   optional scope,
        the same as searchPhotos.js (that folder and every folder below it)
    Response (JSON):
      { available, total, cameras: [{v, make, c}], lenses: [{v, c}],
        exts: [{v, c}], ratings: {0: c, 1: c, ...},
        ranges: { iso, aperture, focal, taken, megapixels, filesize } each {min, max} }
*/

includes("imagedb.js");

function main() {
    var payload = {};
    try {
        payload = JSON.parse((typeof POST_data !== "undefined") ? POST_data : "{}") || {};
    } catch (e) {
        payload = {};
    }

    var db = openIndexDB();
    if (db == null) {
        sendJSONResp(JSON.stringify({ available: false }));
        return;
    }

    var filter = newFilter();
    if (payload.folder) {
        filter.folder.push("" + payload.folder);
    }
    var w = buildWhere(filter);
    var from = " FROM photos LEFT JOIN photo_ratings ON photo_ratings.filepath = photos.filepath WHERE " + w.clause;

    var cameras = db.query("SELECT camera_model AS v, MAX(camera_make) AS make, COUNT(*) AS c" + from +
        " AND camera_model IS NOT NULL AND camera_model <> '' GROUP BY camera_model ORDER BY c DESC LIMIT 60", w.args);
    var lenses = db.query("SELECT lens_model AS v, COUNT(*) AS c" + from +
        " AND lens_model IS NOT NULL AND lens_model <> '' GROUP BY lens_model ORDER BY c DESC LIMIT 60", w.args);
    var exts = db.query("SELECT ext AS v, COUNT(*) AS c" + from +
        " AND ext IS NOT NULL AND ext <> '' GROUP BY ext ORDER BY c DESC", w.args);
    var ratingRows = db.query("SELECT IFNULL(photo_ratings.rating, 0) AS r, COUNT(*) AS c" + from +
        " GROUP BY r", w.args);
    var agg = db.queryRow("SELECT COUNT(*) AS total," +
        " MIN(iso) AS isoMin, MAX(iso) AS isoMax," +
        " MIN(aperture) AS fMin, MAX(aperture) AS fMax," +
        " MIN(focal_length) AS focalMin, MAX(focal_length) AS focalMax," +
        " MIN(taken_date) AS takenMin, MAX(taken_date) AS takenMax," +
        " MIN(megapixels) AS mpMin, MAX(megapixels) AS mpMax," +
        " MIN(filesize) AS sizeMin, MAX(filesize) AS sizeMax" + from, w.args) || {};
    db.close();

    var ratings = {};
    for (var i = 0; i < ratingRows.length; i++) {
        ratings[ratingRows[i].r] = ratingRows[i].c;
    }

    function range(lo, hi) {
        return { min: (lo === undefined ? null : lo), max: (hi === undefined ? null : hi) };
    }

    sendJSONResp(JSON.stringify({
        available: true,
        total: agg.total || 0,
        cameras: cameras,
        lenses: lenses,
        exts: exts,
        ratings: ratings,
        ranges: {
            iso: range(agg.isoMin, agg.isoMax),
            aperture: range(agg.fMin, agg.fMax),
            focal: range(agg.focalMin, agg.focalMax),
            taken: range(agg.takenMin, agg.takenMax),
            megapixels: range(agg.mpMin, agg.mpMax),
            filesize: range(agg.sizeMin, agg.sizeMax)
        }
    }));
}

main();
