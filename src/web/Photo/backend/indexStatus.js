/*
    indexStatus.js

    Lightweight status report for the photo search index. The front-end uses this
    to show how many photos are indexed and to decide whether a background
    (auto) index pass is worth kicking off.

    Response (JSON):
      {
        available,       // false if the SQLite index could not be opened
        total,           // indexed photo count
        withExif,        // how many carry EXIF
        cameras,         // distinct camera models
        dateMin,         // earliest taken_date (unix sec) or null
        dateMax,         // latest taken_date (unix sec) or null
        lastIndexed,     // unix sec of the last index pass
        schemaVersion
      }
*/

includes("imagedb.js");

function main() {
    var db = openIndexDB();
    if (db == null) {
        sendJSONResp(JSON.stringify({ available: false }));
        return;
    }

    var totalRow = db.queryRow("SELECT COUNT(*) AS c FROM photos");
    var total = totalRow ? totalRow.c : 0;

    var exifRow = db.queryRow("SELECT COUNT(*) AS c FROM photos WHERE has_exif = 1");
    var withExif = exifRow ? exifRow.c : 0;

    var camRow = db.queryRow("SELECT COUNT(DISTINCT camera_model) AS c FROM photos" +
        " WHERE camera_model IS NOT NULL AND camera_model <> ''");
    var cameras = camRow ? camRow.c : 0;

    var range = db.queryRow("SELECT MIN(taken_date) AS mn, MAX(taken_date) AS mx" +
        " FROM photos WHERE taken_date IS NOT NULL") || {};

    var lastIndexed = parseInt(metaGet(db, "last_indexed", "0")) || 0;
    db.close();

    sendJSONResp(JSON.stringify({
        available: true,
        total: total,
        withExif: withExif,
        cameras: cameras,
        dateMin: range.mn || null,
        dateMax: range.mx || null,
        lastIndexed: lastIndexed,
        schemaVersion: SCHEMA_VERSION
    }));
}

main();
