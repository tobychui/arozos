/*
    Chatspace - service worker (PWA)

    Network-first with a cached fallback for the static app shell, so the
    installed app opens instantly and survives brief connectivity drops.
    Everything dynamic (the /system/ API surface, WebSockets, uploads and
    downloads) is deliberately left to the network - chat data must never
    be served stale from a cache.
*/

var CACHE_NAME = "chatspace-shell-v1";
var SHELL_ASSETS = [
    "index.html",
    "app.css",
    "app.js",
    "manifest.json",
    "img/module_icon.svg",
    "img/logo192.png",
    "img/logo512.png",
    "../script/semantic/semantic.min.css",
    "../script/jquery.min.js",
    "../script/ao_module.js"
];

self.addEventListener("install", function (event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function (cache) {
            //Best effort: a missing optional asset must not fail the install
            return Promise.all(SHELL_ASSETS.map(function (asset) {
                return cache.add(asset).catch(function () { });
            }));
        }).then(function () {
            return self.skipWaiting();
        })
    );
});

self.addEventListener("activate", function (event) {
    event.waitUntil(
        caches.keys().then(function (names) {
            return Promise.all(names.map(function (name) {
                if (name !== CACHE_NAME) return caches.delete(name);
            }));
        }).then(function () {
            return self.clients.claim();
        })
    );
});

self.addEventListener("fetch", function (event) {
    var req = event.request;
    if (req.method !== "GET") return;
    //Never intercept the live API / auth / media surface
    if (req.url.indexOf("/system/") >= 0 || req.url.indexOf("/api/") >= 0) return;

    event.respondWith(
        fetch(req).then(function (resp) {
            //Refresh the shell copy on every successful fetch
            if (resp && resp.ok && req.url.indexOf(self.location.origin) === 0) {
                var copy = resp.clone();
                caches.open(CACHE_NAME).then(function (cache) {
                    cache.put(req, copy).catch(function () { });
                }).catch(function () { });
            }
            return resp;
        }).catch(function () {
            return caches.match(req).then(function (hit) {
                return hit || Response.error();
            });
        })
    );
});
