// sw.js - Service worker for Tripy PWA
//
// Strategy: cache-first for the app shell (HTML, JS, CSS), network-first for
// everything else. This makes the app installable AND lets it load offline
// after the first visit. JSONBin API calls are never cached (they go to the
// network, falling back to local data handled in app.js).

const CACHE_NAME = 'tripy-v1';
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
            .then(() => self.skipWaiting())
            .catch((err) => console.warn('SW install: some assets failed to cache', err))
    );
});

// Activate: clean up old caches, take control immediately.
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

// Fetch: cache-first for our own assets, network-first for the rest.
self.addEventListener('fetch', (event) => {
    const request = event.request;

    // Only handle GET requests.
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // Never cache JSONBin API calls — always go to network (the app handles
    // offline by falling back to localStorage).
    if (url.hostname === 'api.jsonbin.io') return;

    // Same-origin (our app shell): cache-first, fall back to network.
    if (url.origin === self.location.origin) {
        event.respondWith(
            caches.match(request).then((cached) => {
                return cached || fetch(request).then((response) => {
                    // Cache a copy of newly fetched same-origin assets.
                    if (response && response.status === 200 && response.type === 'basic') {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    }
                    return response;
                }).catch(() => cached);
            })
        );
    }
    // Cross-origin (Tailwind/DaisyUI CDNs): network-first, fall back to cache.
    else {
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
