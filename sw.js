const CACHE_NAME = 'tank-view-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // In a real scenario we'd cache ASSETS here, but to avoid 
      // strict offline failures during active development:
      return cache.addAll(ASSETS).catch(e => console.log('Caching failed loosely', e));
    })
  );
});

self.addEventListener('fetch', event => {
  // Only intercept GET requests
  if (event.request.method !== 'GET') return;
  // Don't intercept API requests
  if (event.request.url.includes('DataService.svc')) return;

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      // Return cached response if found, else fetch normally
      if (cachedResponse) {
        // Fetch new version in background (Stale-While-Revalidate)
        fetch(event.request).then(response => {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, response.clone());
            });
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});
