/* LevelUp web notifications service worker.
 * Sirf notification display ke liye — koi fetch/cache handler nahi, taaki
 * Vite SPA serving kabhi interfere na ho. Web pe notifications tab band hone
 * ke baad bhi notification center me dikhti hain isi se.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ('focus' in client) return client.focus();
        }
        return self.clients.openWindow('/');
      }),
  );
});
