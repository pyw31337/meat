const CACHE_NAME = 'meat-price-watch-v4';
const APP_SHELL = ['./', './manifest.webmanifest', './favicon-object.png', './pwa-192.png', './pwa-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok && response.type === 'basic') caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match('./'))));
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data?.json() ?? {}; } catch { payload = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(payload.title || '메가마트 가격 관측소', {
    body: payload.body || '조건에 맞는 가격을 확인하세요.',
    icon: './pwa-192.png',
    badge: './favicon-object.png',
    tag: payload.tag || 'meat-price-alert',
    renotify: true,
    data: { url: payload.url || './' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const target = new URL(event.notification.data?.url || './', self.location.origin).href;
    const existing = windows.find((client) => client.url === target);
    return existing ? existing.focus() : clients.openWindow(target);
  }));
});
