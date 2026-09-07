// sw.js — Service Worker para notificações do Controle de Ponto
// O Chrome bloqueia new Notification() no contexto de página; só aceita
// notificações disparadas via ServiceWorkerRegistration.showNotification().

// Toma controle imediato das abas abertas, sem precisar de segundo reload
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(clients.claim()));

self.addEventListener('message', event => {
  if (!event.data || event.data.type !== 'SHOW_NOTIFICATION') return;

  const { title, body, tag } = event.data;
  self.registration.showNotification(title, {
    body,
    tag,
    icon: '/icon.svg',
    badge: '/icon.svg',
    renotify: false,
    requireInteraction: false,
  });
});

// Ao clicar na notificação, foca a aba do app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
