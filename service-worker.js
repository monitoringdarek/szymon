// v5.2.4-cache-reset-status-local
// Service worker celowo wyłączony w tej wersji, żeby przeglądarka nie trzymała starego app.js.
self.addEventListener('install', event => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => String(key).includes('szymon-ai-coach')).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  return;
});
