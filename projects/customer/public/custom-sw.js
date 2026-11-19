/* Angular's service worker (offline + updates) plus order-status push notifications. */
importScripts('./ngsw-worker.js');

self.addEventListener('push', (event) => {
  let p = {};
  try {
    p = event.data ? event.data.json() : {};
  } catch (e) {
    return;
  }
  const d = p.data || (p.notification && p.notification.data) || p;
  const title = d.title || (p.notification && p.notification.title);
  if (!title) return;
  const url = d.url || '/orders';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: d.body || (p.notification && p.notification.body) || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: d.orderId || 'order',
      renotify: true,
      vibrate: [200, 100, 200],
      // ngsw-worker opens / focuses the order page when the notification is tapped.
      data: { onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url } } },
    }),
  );
});
