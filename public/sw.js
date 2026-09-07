// sw.js — Service Worker para notificações do Controle de Ponto
//
// Responsabilidades:
//  1. Receber push FCM (app fechado) → showNotification()
//  2. Receber mensagens da página (SHOW_NOTIFICATION, SCHEDULE_NOTIFICATION)
//  3. Ao clicar na notificação → focar/abrir o app

// Firebase Messaging compat para SW (necessário para receber push FCM)
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyCG7q025r8RFRoZmcJynFUMvpJGuGNAC6k",
  authDomain:        "tool-ponto.firebaseapp.com",
  projectId:         "tool-ponto",
  storageBucket:     "tool-ponto.firebasestorage.app",
  messagingSenderId: "425959566307",
  appId:             "1:425959566307:web:c7d068cd24417a2e660ed6"
});

const fcmMessaging = firebase.messaging();

// Recebe push FCM quando o app está fechado ou em background
fcmMessaging.onBackgroundMessage(payload => {
  const { title, body } = payload.notification || {};
  const tag = payload.data?.tag || 'ponto-notif';
  if (!title) return;
  self.registration.showNotification(title, {
    body,
    tag,
    icon:               '/icon.svg',
    badge:              '/icon.svg',
    requireInteraction: false,
  });
});

// Toma controle imediato sem precisar de segundo reload
self.addEventListener('install',  ()     => self.skipWaiting());
self.addEventListener('activate', event  => event.waitUntil(clients.claim()));

// Mensagens enviadas pela página quando o app está aberto
self.addEventListener('message', event => {
  if (!event.data) return;

  if (event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag } = event.data;
    self.registration.showNotification(title, {
      body, tag, icon: '/icon.svg', badge: '/icon.svg',
      requireInteraction: false,
    });
  }

  if (event.data.type === 'SCHEDULE_NOTIFICATION') {
    const { delayMs, title, body, tag } = event.data;
    if (!delayMs || delayMs <= 0) return;
    setTimeout(() => {
      self.registration.showNotification(title, {
        body, tag, icon: '/icon.svg', badge: '/icon.svg',
        requireInteraction: false,
      });
    }, delayMs);
  }
});

// Clique na notificação → foca a aba do app ou abre uma nova
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
