// v5.2.5-unique-app-file-cache-bypass-local
// Service worker celowo wyłączony. Ta wersja ma ominąć stare app.js przez app-v525.js.
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
