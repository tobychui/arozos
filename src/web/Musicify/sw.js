/* Musicify Service Worker - PWA offline support
 *
 * iOS Safari standalone-mode restriction
 * ──────────────────────────────────────
 * iOS rejects any navigation response whose Response.redirected === true with
 * "Response served by service worker has redirections".  This happens when:
 *   1. cache.addAll() stores a response that the server returned via a redirect
 *      (e.g. HTTP→HTTPS, trailing-slash normalisation, session redirect).
 *   2. That cached response is later returned for a navigate-mode request.
 *
 * Fix: during install, detect redirected responses and re-fetch the final URL
 * so the stored object is always clean (redirected: false).  During fetch,
 * navigation requests are served straight from the clean cached index.html;
 * if the cache is cold, the network response is de-redirected before use.
 */

const CACHE_NAME    = 'musicify-v2';   // bump clears the old redirected-response cache
const STATIC_ASSETS = [
    './index.html',
    './musicify.js',
    './manifest.json'
];

// ── Install ───────────────────────────────────────────────────────────────────
// Fetch every static asset and guarantee what is stored has no redirect trail.
async function fetchClean(url) {
    const resp = await fetch(url, { cache: 'reload' });
    // If the server redirected us, re-fetch the resolved final URL directly so
    // the resulting Response object has redirected === false.
    return resp.redirected ? fetch(resp.url, { cache: 'reload' }) : resp;
}

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            Promise.all(
                STATIC_ASSETS.map(url =>
                    fetchClean(url).then(clean => cache.put(url, clean))
                )
            )
        )
    );
    self.skipWaiting();
});

// ── Activate ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = request.url;

    // Only handle GET — let everything else pass through untouched.
    if (request.method !== 'GET') return;

    // Dynamic API calls and media streams must always go direct to the server.
    if (url.includes('/system/') || url.includes('/media') || url.includes('/ajgi/')) return;

    // ── Navigation requests (page loads, iOS PWA home-screen launch) ─────────
    // Serve the pre-cached index.html directly.  Because it was stored via
    // fetchClean() during install it has redirected === false, which satisfies
    // iOS Safari's navigation-response requirement.  Fall back to a live fetch
    // (with redirect stripping) if the cache is somehow cold.
    if (request.mode === 'navigate') {
        event.respondWith(
            caches.match('./index.html').then(cached => {
                if (cached) return cached;

                // Cache miss — go to network but strip any redirect chain.
                return fetch(request)
                    .then(resp => resp.redirected ? fetch(resp.url) : resp)
                    .catch(() => new Response(
                        '<!doctype html><title>Offline</title><p>Musicify is offline.</p>',
                        { status: 503, headers: { 'Content-Type': 'text/html' } }
                    ));
            })
        );
        return;
    }

    // ── Static assets — cache-first with network fallback ────────────────────
    event.respondWith(
        caches.match(request).then(cached => cached || fetch(request))
    );
});
