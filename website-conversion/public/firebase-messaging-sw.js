/* Firebase Cloud Messaging delivers a push event here. The FCM payload is
   rendered directly so the worker does not need a second Firebase config copy. */
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) {}
  const notification = payload.notification || payload.data || {};
  const title = notification.title || 'New offer on OfferHaikya';
  const options = {
    body: notification.body || 'A new offer matches your preferences.',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: { url: notification.url || (payload.data && payload.data.url) || 'https://www.offerhaikya.com' },
    tag: (payload.data && payload.data.postId) || title,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data && event.notification.data.url || 'https://www.offerhaikya.com';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    for (const client of windows) {
      if ('focus' in client) { client.navigate(target); return client.focus(); }
    }
    return clients.openWindow(target);
  }));
});
