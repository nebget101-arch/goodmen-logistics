const CACHE = 'fn-driver-poc-v1';
const STATIC = [
  '/experiments/driver-mobile-poc/',
  '/experiments/driver-mobile-poc/index.html',
  '/experiments/driver-mobile-poc/styles.css',
  '/experiments/driver-mobile-poc/app.js',
  '/experiments/driver-mobile-poc/manifest.json'
];

self.addEventListener('install', e =>
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()))
);

self.addEventListener('activate', e =>
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
);

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Pass API calls through; serve shell from cache
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
