// Offline cache for the app shell + tag data. Learning-track audio is
// streamed from barbershoptags.com and not cached.
const CACHE = 'daily-tag-v18';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png',
  'data/tags.json', 'data/corrections.json', 'data/pending.json',
  'js/app.js', 'js/audio.js', 'js/curriculum.js', 'js/game.js', 'js/keyboard.js', 'js/lesson.js',
  'js/mic.js', 'js/music.js', 'js/notation.js', 'js/pitch.js', 'js/scoring.js', 'js/srs.js', 'js/store.js', 'js/corrections.js', 'js/review.js',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // network-first so updates arrive; cache fallback for offline
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
