// Minimal offline app-shell cache. The actual trip data offline support comes
// from Firestore's own persistentLocalCache (see index.html) - this service
// worker only makes sure the page itself (HTML/CSS/JS, all in one file) still
// loads with no connection at all, e.g. mid-flight or with no signal abroad.
const CACHE_NAME = 'triplan-shell-v1';
const SHELL_URL = './index.html';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.add(SHELL_URL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for the app shell itself, so people editing this file and
// redeploying always get the newest version when online - falling back to
// the cached copy only when the network request fails (offline).
self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.mode !== 'navigate' && !req.url.endsWith('/index.html')) return; // let everything else (Firestore, fonts) go straight to the network
  event.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(SHELL_URL, copy));
      return res;
    }).catch(() => caches.match(SHELL_URL))
  );
});
