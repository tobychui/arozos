/*
    Musicify - Playlist Manager
    DB table: "Musicify"
    DB key prefix: "playlist/{USERNAME}/{playlistname}"

    Operations (opr parameter):
      list_all          → list all playlists with name + count
      get               → get songs in playlist  (name required)
      create            → create empty playlist  (name required)
      delete            → delete playlist        (name required)
      add               → add song               (name, song required — song is URL-encoded vpath)
      remove            → remove song by index   (name, index required)
      rename            → rename playlist        (name, newname required)
      reorder           → reorder songs          (name, order required — JSON array of new indices)
*/
requirelib("filelib");
newDBTableIfNotExists("Musicify");

var DB_PREFIX = "playlist/" + USERNAME + "/";

function sendErr(msg) { sendJSONResp(JSON.stringify({ error: msg })); }

function playlistKey(n) { return DB_PREFIX + n; }

function loadPlaylist(n) {
    var raw = readDBItem("Musicify", playlistKey(n));
    if (!raw || raw === "") return [];
    try { return JSON.parse(raw); } catch(e) { return []; }
}

function savePlaylist(n, data) {
    writeDBItem("Musicify", playlistKey(n), JSON.stringify(data));
}

function main() {
    if (typeof(opr) === "undefined") { sendErr("opr parameter required"); return; }

    // ── list_all ──────────────────────────────────────────────────────────────
    if (opr === "list_all") {
        var all = listDBTable("Musicify");
        var keys = Object.keys(all);
        var result = [];
        for (var i = 0; i < keys.length; i++) {
            if (keys[i].indexOf(DB_PREFIX) !== 0) continue;
            var pname = keys[i].slice(DB_PREFIX.length);
            var songs = [];
            try { songs = JSON.parse(all[keys[i]]); } catch(e) { continue; }
            result.push({ name: pname, count: songs.length });
        }
        sendJSONResp(JSON.stringify(result));

    // ── get ───────────────────────────────────────────────────────────────────
    } else if (opr === "get") {
        if (typeof(name) === "undefined") { sendErr("name required"); return; }
        sendJSONResp(JSON.stringify(loadPlaylist(name)));

    // ── create ────────────────────────────────────────────────────────────────
    } else if (opr === "create") {
        if (typeof(name) === "undefined" || name.trim() === "") { sendErr("name required"); return; }
        var existing = readDBItem("Musicify", playlistKey(name));
        if (existing && existing !== "") { sendErr("Playlist already exists"); return; }
        savePlaylist(name, []);
        sendJSONResp(JSON.stringify({ ok: true }));

    // ── delete ────────────────────────────────────────────────────────────────
    } else if (opr === "delete") {
        if (typeof(name) === "undefined") { sendErr("name required"); return; }
        deleteDBItem("Musicify", playlistKey(name));
        sendJSONResp(JSON.stringify({ ok: true }));

    // ── add ───────────────────────────────────────────────────────────────────
    } else if (opr === "add") {
        if (typeof(name) === "undefined" || typeof(song) === "undefined") {
            sendErr("name and song required"); return;
        }
        var vpath = decodeURIComponent(song);
        if (!filelib.fileExists(vpath)) { sendErr("File not found: " + vpath); return; }
        var list = loadPlaylist(name);
        // Deduplicate
        for (var i = 0; i < list.length; i++) {
            if (list[i].filepath === vpath) {
                sendJSONResp(JSON.stringify({ ok: true, duplicate: true })); return;
            }
        }
        var sz = filelib.filesize(vpath);
        var sizes = ['Bytes','KB','MB','GB','TB'];
        var si = sz === 0 ? 0 : parseInt(Math.floor(Math.log(sz) / Math.log(1024)));
        list.push({
            filepath: vpath,
            name: vpath.split("/").pop().replace(/\.[^.]+$/, ""),
            ext: vpath.split(".").pop().toLowerCase(),
            filesize: sz,
            hsize: (sz / Math.pow(1024, si)).toFixed(2) + ' ' + sizes[si],
            mtime: filelib.mtime(vpath, false)
        });
        savePlaylist(name, list);
        sendJSONResp(JSON.stringify({ ok: true }));

    // ── remove ────────────────────────────────────────────────────────────────
    } else if (opr === "remove") {
        if (typeof(name) === "undefined" || typeof(index) === "undefined") {
            sendErr("name and index required"); return;
        }
        var list = loadPlaylist(name);
        var idx = parseInt(index);
        if (isNaN(idx) || idx < 0 || idx >= list.length) { sendErr("Index out of range"); return; }
        list.splice(idx, 1);
        savePlaylist(name, list);
        sendJSONResp(JSON.stringify({ ok: true }));

    // ── rename ────────────────────────────────────────────────────────────────
    } else if (opr === "rename") {
        if (typeof(name) === "undefined" || typeof(newname) === "undefined" || newname.trim() === "") {
            sendErr("name and newname required"); return;
        }
        var list = loadPlaylist(name);
        savePlaylist(newname, list);
        deleteDBItem("Musicify", playlistKey(name));
        sendJSONResp(JSON.stringify({ ok: true }));

    // ── reorder ───────────────────────────────────────────────────────────────
    } else if (opr === "reorder") {
        if (typeof(name) === "undefined" || typeof(order) === "undefined") {
            sendErr("name and order required"); return;
        }
        var list = loadPlaylist(name);
        var newOrder;
        try { newOrder = JSON.parse(decodeURIComponent(order)); } catch(e) { sendErr("Invalid order JSON"); return; }
        var reordered = [];
        for (var i = 0; i < newOrder.length; i++) {
            var idx = parseInt(newOrder[i]);
            if (idx >= 0 && idx < list.length) reordered.push(list[idx]);
        }
        savePlaylist(name, reordered);
        sendJSONResp(JSON.stringify({ ok: true }));

    } else {
        sendErr("Unknown opr: " + opr);
    }
}

main();
