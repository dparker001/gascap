// Custom push event handler — merged into generated sw.js by next-pwa
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { data = { title: 'GasCap', body: event.data.text() }; }

  event.waitUntil(
    self.registration.showNotification(data.title ?? '⛽ GasCap', {
      body:  data.body  ?? '',
      icon:  data.icon  ?? '/icon-192.png',
      badge: data.badge ?? '/icon-192.png',
      data:  { url: data.url ?? '/' },
      vibrate: [100, 50, 100],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
