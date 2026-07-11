/* sw.js — offline cache. Bump CACHE when files change. */
const CACHE = 'clef-runner-v35';
// Precache the app shell + small data. The big sharded song library
// (js/data/<genre>.<n>.js, ~25MB) is NOT precached — it loads on demand and is
// runtime-cached by the fetch handler below on first use.
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './assets/icon.svg',
  './css/styles.css',
  './js/theory.js', './js/audio.js', './js/pitch.js', './js/instruments.js',
  './js/lickgen.js', './js/abc.js', './js/data/tunes.js', './js/data/manifest.js',
  './js/licks.js', './js/folktunes.js', './js/songs.js',
  './js/scales.js', './js/import.js', './js/library.js',
  './js/game.js', './js/auth.js', './js/stats.js', './js/celebrate.js', './js/main.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // don't intercept the Google SSO script / cross-origin
  if (new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
