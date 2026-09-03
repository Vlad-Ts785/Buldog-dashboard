// Service Worker дашборда. Два дела:
// 1) Push-уведомления CRM и водителей (plans/2026-08-26-own-crm-replace-bitrix.md, Фаза 4г;
//    plans/2026-09-03-employee-mobile-app.md). Живёт в фоне браузера ОТДЕЛЬНО от вкладки -
//    уведомление доходит, даже если вкладка закрыта (пока сам браузер запущен - ограничение
//    платформы Web Push, не наше).
// 2) Кэш app-shell ТОЛЬКО экрана водителя (driver.html + манифест + иконки) - 03.09,
//    Фаза 2: на объектах связь плохая, страница обязана открываться без сети, очередь
//    событий/фото живёт в IndexedDB внутри самой страницы. index.html НЕ кэшируем
//    сознательно (2,6 МБ, финансовые данные, отдельное решение - Фаза 4 плана).
//
// Область действия (scope) - папка files/, где лежит этот файл и обе страницы.
// DRIVER_CACHE - версия кэша: менять при КАЖДОМ деплое driver.html, иначе телефон
// водителя может неделю сидеть на старом коде (прокси yardhub.ru кэширует 10 мин +
// service worker поверх - двойной слой устаревания, см. план, пре-мортем п.7).

var DRIVER_CACHE = 'driver-shell-2026-09-03.1';
var DRIVER_SHELL = ['/files/driver.html', '/files/driver.webmanifest', '/files/icon-192.png', '/files/icon-512.png'];

self.addEventListener('install', function (event) {
  self.skipWaiting(); // новая версия сразу активна, не ждать закрытия старых вкладок
  event.waitUntil(
    caches.open(DRIVER_CACHE).then(function (cache) {
      // addAll падает целиком при одном 404 - кладём по одному, что смогли
      return Promise.all(DRIVER_SHELL.map(function (u) {
        return fetch(u, { cache: 'no-cache' }).then(function (r) { if (r.ok) return cache.put(u, r); }).catch(function () {});
      }));
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('driver-shell-') === 0 && k !== DRIVER_CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Только shell водителя: сеть первой (чтобы обновления доезжали), при обрыве - кэш.
// Всё остальное (index.html, API api.yardhub.ru, шрифты) - мимо, как будто SW нет.
self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  if (DRIVER_SHELL.indexOf(url.pathname) < 0) return;
  event.respondWith(
    fetch(event.request).then(function (r) {
      if (r && r.ok) { var copy = r.clone(); caches.open(DRIVER_CACHE).then(function (c) { c.put(url.pathname, copy); }); }
      return r;
    }).catch(function () {
      return caches.match(url.pathname).then(function (hit) { return hit || Response.error(); });
    })
  );
});

self.addEventListener('push', function (event) {
  var data = { title: 'TS HUB', body: 'Новое событие', url: '/files/index.html' };
  try {
    if (event.data) data = Object.assign(data, event.data.json());
  } catch (e) {
    // сервер всегда шлёт валидный JSON - на всякий случай не роняем обработчик, если нет
  }
  // Водителю (url на driver.html) - свой tag: его "назначен рейс" не должен затирать
  // CRM-уведомление в том же браузере и наоборот.
  var isDriver = String(data.url || '').indexOf('driver.html') >= 0;
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'https://yardhub.ru/files/icon-192.png',
      tag: isDriver ? 'yard-driver' : 'yard-crm', // повторное уведомление заменяет предыдущее, не копится стопкой
      vibrate: isDriver ? [60, 40, 60] : undefined,
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
  var page = url.indexOf('driver.html') >= 0 ? 'driver.html' : 'index.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
      for (var i = 0; i < windowClients.length; i++) {
        if (windowClients[i].url.indexOf(page) >= 0 && 'focus' in windowClients[i]) {
          return windowClients[i].focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
