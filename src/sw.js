// sw.js — Custom Service Worker (Kalathaki)
// Handles: Workbox precaching, API caching, Web Push notifications
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// On install: take over immediately (don't wait for old SW to release)
self.skipWaiting();

// On activate: claim all open tabs, then tell them to reload for the new version.
// We only want to reload when REPLACING an existing controller, not on first install.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    clients.claim().then(() => {
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    }).then((openClients) => {
      openClients.forEach((client) => client.postMessage({ type: 'SW_UPDATED' }));
    })
  );
});

// Workbox injects the precache manifest here
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ── Runtime caching ────────────────────────────────────────────────────────
// Google Fonts — cache-first, 1 year
registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new CacheFirst({
    cacheName: 'google-fonts-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 })],
  }),
);

// API lists — network-first, 24h fallback
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/lists'),
  new NetworkFirst({
    cacheName: 'api-lists-cache',
    networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 })],
  }),
);

// ── Push notification handler ──────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { data = { title: 'Καλαθάκι', body: event.data.text() }; }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Καλαθάκι 🛒', {
      body:    data.body || '',
      icon:    '/pwa-192x192.png',
      badge:   '/pwa-192x192.png',
      tag:     data.tag || 'kalathaki',
      data:    { url: data.url || '/' },
      vibrate: [200, 100, 200],
      actions: data.actions || [],
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    }),
  );
});
