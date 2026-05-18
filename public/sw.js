// Minimal Service Worker to enable PWA install prompt
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
    // We let the browser handle all fetching directly for now.
    // This allows the PWA to be installable without aggressive caching issues.
    return;
});
