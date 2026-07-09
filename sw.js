// sw.js - Service worker for Tripy PWA
//
// Bump APP_VERSION whenever the app shell changes so that users who have
// installed the PWA get served the new files (the SW detects the version
// change, replaces the cache, and takes control of open tabs).
//
// Strategy: cache-first for the app shell (HTML, JS, CSS), network-first for
// everything else. JSONBin API calls are never cached (they go to the network,
// falling back to local data handled in app.js).

const APP_VERSION = 6;
const CACHE_NAME = `tripy-v${APP_VERSION}`;
const APP_SHELL = [
    './',
    './index.html',
    './js/app.js',
    './js/data.js',
    './js/sync.js',
    './js/api.js',
    './js/trip-registry.js',
    './manifest.json',
    './icons/icon.svg',
];

// Install: pre-cache the app shell.
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting()) // Force the waiting SW to activate
            .catch((err) => console.warn('SW install: some assets failed to cache', err))
    );
});

// Activate: clean up old caches, take control immediately so the page
// sees the new version without needing a second reload.
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim()) // Take control of open pages
    );
});

// Fetch: cache-first for same-origin assets, network-first for CDN.
self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // Never cache JSONBin API calls.
    if (url.hostname === 'api.jsonbin.io') return;

    if (url.origin === self.location.origin) {
        // Cache-first for app shell
        event.respondWith(
            caches.match(request).then((cached) => {
                return cached || fetch(request).then((response) => {
                    if (response && response.status === 200 && response.type === 'basic') {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    }
                    return response;
                }).catch(() => cached);
            })
        );
    } else {
        // Network-first for CDN assets (Tailwind/DaisyUI)
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    return response;
                })
                .catch(() => caches.match(request))
        );
    }
});
