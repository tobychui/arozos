/* Musicify Service Worker - PWA offline support */
const CACHE_NAME = 'musicify-v1';
const STATIC_ASSETS = [
    './index.html',
    './musicify.js',
    './manifest.json'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    const url = event.request.url;
    // Never cache dynamic API calls or media streams
    if (url.includes('/system/') || url.includes('/media') || url.includes('/ajgi/')) return;
    event.respondWith(
        caches.match(event.request).then(response => response || fetch(event.request))
    );
});
