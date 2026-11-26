/*
    previews.js

    Previews of photos for the waterfall layout (see previewlib.js).

    Request body (JSON):
      { "files": ["user:/Photo/a.jpg", ...], "generate": false }
        generate false  report the previews already cached (quick, up to 200
                        files); the others come back as {pending: true}
        generate true   draw the missing ones (slow, up to 6 files)

    Response (JSON):
      { mode, items: { <vpath>: item } } where item is one of
        { src, w, h, v }      cached preview: load ../media?file=<src>&v=<v>
        { dataURL, w, h }     realtime preview, drawn for this request
        { pending: true }     not drawn yet (ask again with generate)
        { error }             cannot be previewed; show the thumbnail
*/

includes("previewlib.js");

function main() {
    var payload = {};
    try {
        payload = JSON.parse((typeof POST_data !== "undefined") ? POST_data : "{}") || {};
    } catch (e) {
        payload = {};
    }
    var files = Array.isArray(payload.files) ? payload.files : [];
    var generate = payload.generate === true;
    files = files.slice(0, generate ? 6 : 200);

    var db = openIndexDB();
    var settings = previewSettings(db);
    if (db != null) {
        db.close();
    }

    var items = {};
    for (var i = 0; i < files.length; i++) {
        var f = "" + files[i];
        if (items[f]) {
            continue;
        }
        if (!previewSupported(f)) {
            items[f] = { error: "unsupported" };
            continue;
        }
        if (!filelib.fileExists(f)) {
            items[f] = { error: "missing" };
            continue;
        }
        if (settings.dir !== null) {
            var hit = previewLookup(settings.dir, f);
            if (hit) {
                items[f] = hit;
                continue;
            }
        }
        if (!generate) {
            items[f] = { pending: true };
            continue;
        }
        items[f] = previewRender(settings.dir, f);
    }

    sendJSONResp(JSON.stringify({ mode: settings.mode, items: items }));
}

main();
