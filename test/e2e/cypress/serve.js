/*
    Minimal static server for the ArozOS web root, so the Cypress suite can
    run without Python or any other tooling. Serves ../../../src/web on
    WEB_PORT (default 8123).
*/
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..", "src", "web");
const PORT = parseInt(process.env.WEB_PORT || "8123", 10);

const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ico": "image/x-icon"
};

http.createServer(function (req, res) {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    let file = path.normalize(path.join(ROOT, urlPath));
    if (!file.startsWith(ROOT)) {
        res.writeHead(403);
        res.end();
        return;
    }
    fs.stat(file, function (err, st) {
        if (!err && st.isDirectory()) { file = path.join(file, "index.html"); }
        fs.readFile(file, function (err2, data) {
            if (err2) {
                res.writeHead(404);
                res.end("not found");
                return;
            }
            res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
            res.end(data);
        });
    });
}).listen(PORT, "127.0.0.1", function () {
    console.log("Serving " + ROOT + " on http://127.0.0.1:" + PORT);
});
