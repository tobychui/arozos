/*
    searchPhotos.js

    Search the per-user photo index. Accepts an iOS-style free-text query and/or
    a structured filter object, and returns matching photos. Search covers — but
    is not limited to — file name, resolution, shooting parameters (camera, lens,
    ISO, aperture, shutter, focal length), the date a photo was taken (created)
    and its file modification date.

    Request body (JSON, all optional):
      {
        "q": "canon iso:1600 f/2.8 2023 landscape",  // free-text query
        "filters": { ... },                          // structured overrides
        "sort": "taken_desc",                        // see buildOrderBy()
        "limit": 1000,
        "offset": 0
      }

    Response (JSON):
      { results: [ {filepath, filesize, ...} ], total, limit, offset, query }

    Each result carries `filepath` and `filesize`, so the existing Photo grid /
    viewer renders them with no further changes.

    Free-text query tokens (combine freely, all AND-ed together):
      canon              free text -> file name / camera / lens / make
      name:beach         file name contains
      model:"EOS R5"     camera model
      make:sony          camera make
      lens:50            lens model contains
      iso:1600           ISO equals (or 800-3200, >800, <1600)
      f/2.8  aperture:2  aperture (or 1.4-2.8)
      focal:50  50mm     focal length mm (or 24-70)
      mp:24  mp:>20      megapixels
      width:>4000        pixel width   (also w:)
      height:>3000       pixel height  (also h:)
      landscape          orientation (portrait / square)
      .jpg  raw          file type / RAW group
      2023  year:2023    taken in year
      taken:2023-01..2023-06   taken date range  (before:/after: also work)
      modified:>2024-01-01     file modified date
      rating:>=4  rating:5  rating:3-5   user star rating (0 = unrated)
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

    var q = payload.q || "";
    var filters = payload.filters || {};
    var sort = payload.sort || "taken_desc";

    var limit = parseInt(payload.limit);
    if (isNaN(limit) || limit <= 0) {
        limit = 500;
    }
    if (limit > 2000) {
        limit = 2000;
    }
    var offset = parseInt(payload.offset);
    if (isNaN(offset) || offset < 0) {
        offset = 0;
    }

    var db = openIndexDB();
    if (db == null) {
        sendJSONResp(JSON.stringify({ error: "index unavailable", results: [], total: 0 }));
        return;
    }

    var filter = parseSearchQuery(q);
    applyExplicitFilters(filter, filters);

    var w = buildWhere(filter);
    var orderBy = buildOrderBy(sort);

    // LEFT JOIN the per-user ratings so a `rating:` filter resolves and every
    // result carries its star rating (0 = unrated). `filepath` exists in both
    // tables, so it must be qualified.
    var from = "FROM photos LEFT JOIN photo_ratings ON photo_ratings.filepath = photos.filepath";

    var countRow = db.queryRow("SELECT COUNT(*) AS c " + from + " WHERE " + w.clause, w.args);
    var total = countRow ? countRow.c : 0;

    var rows = db.query(
        "SELECT photos.filepath AS filepath, filename, filesize, ext, width, height, megapixels, orientation," +
        " taken_date, modified_date, camera_make, camera_model, lens_model, focal_length," +
        " aperture, shutter, shutter_label, iso, has_exif," +
        " IFNULL(photo_ratings.rating, 0) AS rating " + from + " WHERE " + w.clause +
        " ORDER BY " + orderBy + " LIMIT ? OFFSET ?",
        w.args.concat([limit, offset])
    );
    db.close();

    sendJSONResp(JSON.stringify({
        results: rows,
        total: total,
        limit: limit,
        offset: offset,
        query: q
    }));
}

main();
