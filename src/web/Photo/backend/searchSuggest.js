/*
    searchSuggest.js

    Autocomplete suggestions for the Photo search box (iOS-style). Given the
    partial query the user is typing, returns a small, ranked, de-duplicated list
    of suggestions drawn from the actual contents of the per-user index:

      - When the box is empty: popular facets (top cameras, recent years,
        orientation, common file types) so there is always something to tap.
      - While typing: completions for the active (last) token — matching camera
        models, lenses, file names, years, file types, plus smart filter tokens
        (iso:..., f/...) when the user starts typing a known filter keyword.

    Each suggestion: { type, label, value, hint }
      type  -> drives the icon on the front-end (camera/lens/date/type/file/filter)
      label -> what is shown to the user
      value -> text inserted into the query box when picked
      hint  -> small right-aligned note (usually a photo count)

    Request body (JSON): { "q": "partial query" }
    Response (JSON):      { suggestions: [...], query }
*/

includes("imagedb.js");

function buildSuggestions(db, q) {
    var out = [];
    var lower = ("" + q).toLowerCase();

    function add(type, label, value, hint) {
        if (label === null || label === undefined || ("" + label).length === 0) {
            return;
        }
        out.push({ type: type, label: "" + label, value: "" + value, hint: hint || "" });
    }

    // ---- Empty box: show popular facets -------------------------------------
    if (lower.length === 0) {
        var cams = db.query("SELECT camera_model AS m, COUNT(*) AS c FROM photos" +
            " WHERE camera_model IS NOT NULL AND camera_model <> ''" +
            " GROUP BY camera_model ORDER BY c DESC LIMIT 4");
        for (var i = 0; i < cams.length; i++) {
            add("camera", cams[i].m, "model:\"" + cams[i].m + "\"", cams[i].c + " photos");
        }

        var yrs = db.query("SELECT strftime('%Y', taken_date, 'unixepoch') AS y, COUNT(*) AS c" +
            " FROM photos WHERE taken_date IS NOT NULL GROUP BY y ORDER BY y DESC LIMIT 4");
        for (var j = 0; j < yrs.length; j++) {
            add("date", yrs[j].y, yrs[j].y, yrs[j].c + " photos");
        }

        add("filter", "Landscape", "landscape", "orientation");
        add("filter", "Portrait", "portrait", "orientation");

        var exts = db.query("SELECT ext, COUNT(*) AS c FROM photos" +
            " WHERE ext IS NOT NULL AND ext <> '' GROUP BY ext ORDER BY c DESC LIMIT 3");
        for (var k = 0; k < exts.length; k++) {
            add("type", "." + exts[k].ext, "." + exts[k].ext, exts[k].c + " photos");
        }
        return out;
    }

    // ---- Typing: complete the active (last) token ---------------------------
    var parts = ("" + q).split(/\s+/);
    var lastToken = parts[parts.length - 1].toLowerCase();
    var prefix = parts.slice(0, parts.length - 1).join(" ");

    function withPrefix(tok) {
        return (prefix ? prefix + " " : "") + tok;
    }

    var like = "%" + lastToken + "%";
    var a, list;

    // Smart filter-keyword completions.
    if (lastToken.indexOf("iso") === 0) {
        list = db.query("SELECT DISTINCT iso FROM photos WHERE iso IS NOT NULL ORDER BY iso LIMIT 6");
        for (a = 0; a < list.length; a++) {
            add("filter", "ISO " + list[a].iso, withPrefix("iso:" + list[a].iso), "");
        }
    }
    if (/^f\/?\d*\.?\d*$/.test(lastToken)) {
        list = db.query("SELECT DISTINCT aperture FROM photos WHERE aperture IS NOT NULL ORDER BY aperture LIMIT 6");
        for (a = 0; a < list.length; a++) {
            var av = Math.round(list[a].aperture * 10) / 10;
            add("filter", "f/" + av, withPrefix("f/" + av), "");
        }
    }

    // Camera models.
    list = db.query("SELECT camera_model AS m, COUNT(*) AS c FROM photos" +
        " WHERE LOWER(IFNULL(camera_model,'')) LIKE ?" +
        " GROUP BY camera_model ORDER BY c DESC LIMIT 4", [like]);
    for (a = 0; a < list.length; a++) {
        add("camera", list[a].m, withPrefix("model:\"" + list[a].m + "\""), list[a].c + " photos");
    }

    // Lenses.
    list = db.query("SELECT lens_model AS l, COUNT(*) AS c FROM photos" +
        " WHERE LOWER(IFNULL(lens_model,'')) LIKE ?" +
        " GROUP BY lens_model ORDER BY c DESC LIMIT 3", [like]);
    for (a = 0; a < list.length; a++) {
        add("lens", list[a].l, withPrefix("lens:\"" + list[a].l + "\""), list[a].c + " photos");
    }

    // File names.
    list = db.query("SELECT filename FROM photos WHERE filename_lc LIKE ?" +
        " ORDER BY filename_lc LIMIT 6", [like]);
    for (a = 0; a < list.length; a++) {
        add("file", list[a].filename, list[a].filename, "file name");
    }

    // Years.
    if (/^\d{1,4}$/.test(lastToken)) {
        list = db.query("SELECT strftime('%Y', taken_date, 'unixepoch') AS y, COUNT(*) AS c" +
            " FROM photos WHERE taken_date IS NOT NULL GROUP BY y HAVING y LIKE ?" +
            " ORDER BY y DESC LIMIT 4", [lastToken + "%"]);
        for (a = 0; a < list.length; a++) {
            add("date", list[a].y, withPrefix(list[a].y), list[a].c + " photos");
        }
    }

    // Months (match by name prefix; the filter matches that month across all years).
    if (/^[a-z]+$/.test(lastToken)) {
        var MN = ["January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"];
        for (a = 0; a < MN.length; a++) {
            if (MN[a].toLowerCase().indexOf(lastToken) === 0) {
                var mc = db.queryRow("SELECT COUNT(*) AS c FROM photos WHERE taken_date IS NOT NULL" +
                    " AND CAST(strftime('%m', taken_date, 'unixepoch') AS INTEGER) = ?", [a + 1]);
                add("date", MN[a], withPrefix("month:" + (a + 1)), (mc && mc.c ? mc.c + " photos" : ""));
            }
        }
    }

    // File types.
    if (lastToken.charAt(0) === "." || lastToken.length <= 4) {
        var ex = lastToken.replace(/^\./, "");
        list = db.query("SELECT ext, COUNT(*) AS c FROM photos WHERE ext LIKE ?" +
            " GROUP BY ext ORDER BY c DESC LIMIT 3", [ex + "%"]);
        for (a = 0; a < list.length; a++) {
            add("type", "." + list[a].ext, withPrefix("." + list[a].ext), list[a].c + " photos");
        }
    }

    // De-duplicate by inserted value and cap the list length.
    var seen = {};
    var dedup = [];
    for (var d = 0; d < out.length; d++) {
        if (!seen[out[d].value]) {
            seen[out[d].value] = true;
            dedup.push(out[d]);
        }
    }
    return dedup.slice(0, 12);
}

function main() {
    var rawBody = (typeof POST_data !== "undefined") ? POST_data : "{}";
    var payload = {};
    try {
        payload = JSON.parse(rawBody) || {};
    } catch (e) {
        payload = {};
    }
    var q = payload.q || "";

    var db = openIndexDB();
    if (db == null) {
        sendJSONResp(JSON.stringify({ suggestions: [], query: q }));
        return;
    }

    var suggestions = buildSuggestions(db, q);
    db.close();

    sendJSONResp(JSON.stringify({ suggestions: suggestions, query: q }));
}

main();
