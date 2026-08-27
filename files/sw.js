// Service Worker для push-уведомлений CRM (plans/2026-08-26-own-crm-replace-bitrix.md,
// Фаза 4г). Живёт в фоне браузера ОТДЕЛЬНО от вкладки дашборда - поэтому уведомление
// доходит, даже если вкладка/дашборд закрыты (пока сам браузер запущен - это ограничение
// платформы Web Push, не наше: если браузер целиком закрыт, уведомление придёт, когда он
// снова откроется, не раньше).
//
// Область действия (scope) - папка files/, где лежит этот файл и сам index.html. Ничего
// другого на сайте не трогает и не кэширует - только push-уведомления, оффлайн-режим
// сознательно не делаем (это отдельная, не запрошенная задача).

self.addEventListener('install', function (event) {
  self.skipWaiting(); // новая версия сразу активна, не ждать закрытия старых вкладок
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (event) {
  var data = { title: 'ЯРД CRM', body: 'Новое событие', url: '/files/index.html' };
  try {
    if (event.data) data = Object.assign(data, event.data.json());
  } catch (e) {
    // сервер всегда шлёт валидный JSON - на всякий случай не роняем обработчик, если нет
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'https://yardhub.ru/files/icon-192.png',
      tag: 'yard-crm', // повторное уведомление заменяет предыдущее, не копится стопкой
      data: { url: data.url },
      // Звук - системный звук уведомлений браузера (silent не указан = звук играет по
      // умолчанию). Свой mp3 подставить нельзя - ограничение Web Notifications API у
      // всех браузеров, не только у нас.
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/files/index.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
      for (var i = 0; i < windowClients.length; i++) {
        if (windowClients[i].url.indexOf('index.html') >= 0 && 'focus' in windowClients[i]) {
          return windowClients[i].focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
