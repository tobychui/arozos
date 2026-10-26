/*
    Minimal static file server for the Cine Studio E2E tests.

    Serves the ArozOS web root (src/web) so the app and its shared
    scripts (../script/*) load exactly as they do in production. The
    tests seed their own media as in-memory blobs and stub the ArozOS
    backend, so server-side AGI endpoints (/system/*, /media) are not
    needed here and simply 404 - which the app already handles.
*/
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".map": "application/json; charset=utf-8"
};

// Create (but do not start) a server rooted at webRoot.
function createServer(webRoot) {
    const root = path.resolve(webRoot);
    return http.createServer(function (req, res) {
        let urlPath;
        try {
            urlPath = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
        } catch (e) {
            res.writeHead(400);
            res.end("bad request");
            return;
        }
        if (urlPath.endsWith("/")) { urlPath += "index.html"; }

        // Resolve within the web root, rejecting path traversal.
        const target = path.join(root, urlPath);
        if (target !== root && !target.startsWith(root + path.sep)) {
            res.writeHead(403);
            res.end("forbidden");
            return;
        }

        fs.stat(target, function (err, stat) {
            if (err || !stat.isFile()) {
                res.writeHead(404);
                res.end("not found");
                return;
            }
            res.writeHead(200, {
                "Content-Type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
                "Cache-Control": "no-store"
            });
            fs.createReadStream(target).pipe(res);
        });
    });
}

// Start a server and resolve with { server, port, baseURL }.
function start(webRoot, port) {
    return new Promise(function (resolve, reject) {
        const server = createServer(webRoot);
        server.on("error", reject);
        server.listen(port || 0, "127.0.0.1", function () {
            const actual = server.address().port;
            resolve({ server: server, port: actual, baseURL: "http://127.0.0.1:" + actual });
        });
    });
}

module.exports = { createServer, start };
