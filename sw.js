// Minimal offline app-shell cache. The actual trip data offline support comes
// from Firestore's own persistentLocalCache (see index.html) - this service
// worker only makes sure the page itself (index.html + styles.css + extras.js)
// still loads with no connection at all, e.g. mid-flight or with no signal abroad.
const CACHE_NAME = 'triplan-shell-v2';
const SHELL_URL = './index.html';
const SHELL_FILES = ['./index.html', './styles.css', './extras.js', './config.js'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(SHELL_FILES.map(f => cache.add(f).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for the app shell itself, so people editing these files and
// redeploying always get the newest version when online - falling back to
// the cached copy only when the network request fails (offline).
self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  const isNav = req.mode === 'navigate' || url.pathname.endsWith('/index.html');
  const isShellFile = url.origin === self.location.origin && /\/(styles\.css|extras\.js|config\.js)$/.test(url.pathname);
  if(!isNav && !isShellFile) return; // let everything else (Firestore, fonts) go straight to the network
  const key = isNav ? SHELL_URL : './' + url.pathname.split('/').pop();
  event.respondWith(
    fetch(req).then(res => {
      if(res.ok){
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(key, copy));
      }
      return res;
    }).catch(() => caches.match(key))
  );
});
