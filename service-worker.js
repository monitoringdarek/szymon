const CACHE_NAME = 'szymon-ai-coach-road-to-kalmar-v05';
const FILES = ['./','./index.html','./styles.css','./app.js','./manifest.json','./icon-180.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.url.includes('supabase.co')) return;
  event.respondWith(caches.match(event.request).then(response => response || fetch(event.request)));
});
