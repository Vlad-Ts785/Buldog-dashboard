// Service Worker дашборда. Два дела:
// 1) Push-уведомления CRM и водителей (plans/2026-08-26-own-crm-replace-bitrix.md, Фаза 4г;
//    plans/2026-09-03-employee-mobile-app.md). Живёт в фоне браузера ОТДЕЛЬНО от вкладки -
//    уведомление доходит, даже если вкладка закрыта (пока сам браузер запущен - ограничение
//    платформы Web Push, не наше).
// 2) Кэш app-shell ТОЛЬКО экрана водителя (driver.html + манифест + иконки) - 03.09,
//    Фаза 2: на объектах связь плохая, страница обязана открываться без сети, очередь
//    событий/фото живёт в IndexedDB внутри самой страницы.
// 3) App shell основного дашборда (23.09, plans/2026-09-23-instant-open-app-shell.md):
//    index.html и его JS/CSS открываются из хранилища браузера мгновенно, новая версия
//    скачивается в фоне целым набором и включается со следующего открытия. Данные (API)
//    НЕ кэшируются никогда - только код страницы. В самом index.html данных нет.
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

// ── App shell дашборда ──────────────────────────────────────────────────────────────────
// Аварийный выключатель: false + выкатка = кэш оболочки стирается, всё идёт в сеть как раньше.
var SHELL_ENABLED = true;
var SHELL_INDEX = '/files/index.html';
var SHELL_FILES = [SHELL_INDEX, '/files/gos-plate.js', '/files/order-plan-v2.js', '/files/order-plan-v2.css', '/files/logist-push-notify.js', '/files/hiring.js', '/files/hiring.css',
  '/files/yard-confirm.js', '/files/yard-confirm.css', '/files/sprav-person-attrs.js', '/files/sprav-person-attrs.css'];
var SHELL_PREFIX = 'app-shell-v-';
var SHELL_META = 'app-shell-meta';
// current - версия, из которой отдаём сейчас; pending - скачанная в фоне, включается только
// в начале СЛЕДУЮЩЕГО открытия, чтобы внутри одной загрузки не смешались старый index.html
// и новый order-plan-v2.js (набор всегда целиком из одной версии).
function shellMetaGet_(key) {
  return caches.open(SHELL_META).then(function (c) { return c.match('/__shell_' + key); })
    .then(function (r) { return r ? r.text() : null; });
}
function shellMetaSet_(key, val) {
  return caches.open(SHELL_META).then(function (c) {
    return val ? c.put('/__shell_' + key, new Response(val)) : c.delete('/__shell_' + key);
  });
}
function shellHash_(s) {
  var h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function shellDropCachesExcept_(keep) {
  return caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf(SHELL_PREFIX) === 0 && keep.indexOf(k) < 0; })
      .map(function (k) { return caches.delete(k); }));
  });
}
function shellPromotePending_() {
  return Promise.all([shellMetaGet_('current'), shellMetaGet_('pending')]).then(function (v) {
    if (!v[1]) return v[0];
    return shellMetaSet_('current', v[1]).then(function () { return shellMetaSet_('pending', null); })
      .then(function () { return shellDropCachesExcept_([SHELL_PREFIX + v[1]]); })
      .then(function () { return v[1]; });
  });
}
function shellNotifyClients_(msg) {
  return self.clients.matchAll({ type: 'window' }).then(function (list) {
    list.forEach(function (c) { if (c.url.indexOf(SHELL_INDEX) >= 0 || /\/files\/$/.test(c.url)) c.postMessage(msg); });
  });
}
var shellUpdating_ = null;
function shellUpdate_() {
  if (!SHELL_ENABLED) return Promise.resolve(null);
  if (shellUpdating_) return shellUpdating_;
  shellUpdating_ = Promise.all(SHELL_FILES.map(function (u) { return fetch(u, { cache: 'no-cache' }); }))
    .then(function (resps) {
      // Перенаправленный ответ (r.redirected) в оболочку не берём: браузер откажется открыть
      // страницу из него - навигация упадёт целиком (поймано на локальном serve с cleanUrls).
      var tags = resps.map(function (r) { return r && r.ok && !r.redirected ? (r.headers.get('ETag') || r.headers.get('Last-Modified')) : null; });
      if (tags.some(function (t) { return !t; })) return null; // неполный набор или без меток - текущую версию не трогаем
      var ver = shellHash_(tags.join('|'));
      return Promise.all([shellMetaGet_('current'), shellMetaGet_('pending')]).then(function (m) {
        if (ver === m[0] || ver === m[1]) {
          if (ver === m[0] && m[1]) return shellMetaSet_('pending', null).then(function () { return null; });
          return null;
        }
        var name = SHELL_PREFIX + ver;
        return caches.open(name).then(function (c) {
          return Promise.all(resps.map(function (r, i) { return c.put(SHELL_FILES[i], r); }));
        }).then(function () {
          // Первая установка - сразу текущая. Иначе - ждёт следующего открытия.
          return shellMetaSet_(m[0] ? 'pending' : 'current', ver);
        }).then(function () {
          return shellDropCachesExcept_(m[0] ? [SHELL_PREFIX + m[0], name] : [name]);
        }).then(function () {
          if (m[0]) return shellNotifyClients_({ type: 'shell-updated' });
        });
      });
    })
    .catch(function () { return null; })
    .then(function (r) { shellUpdating_ = null; return r; });
  return shellUpdating_;
}
function shellMatch_(path) {
  return shellMetaGet_('current').then(function (ver) {
    if (!ver) return null;
    return caches.open(SHELL_PREFIX + ver).then(function (c) { return c.match(path); });
  }).then(function (hit) { return hit && !hit.redirected ? hit : null; });
}

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        if (k.indexOf('driver-shell-') === 0 && k !== DRIVER_CACHE) return true;
        return !SHELL_ENABLED && (k.indexOf(SHELL_PREFIX) === 0 || k === SHELL_META);
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
      .then(function () { if (SHELL_ENABLED) return shellUpdate_(); })
  );
});

// Оболочка дашборда: открытие - из хранилища сразу, в фоне проверка новой версии.
// Нет своей копии (первый заход, сбой) - обычная сеть. Ctrl+Shift+R идёт мимо SW всегда.
self.addEventListener('fetch', function (event) {
  if (!SHELL_ENABLED || event.request.method !== 'GET') return;
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  var path = url.pathname === '/files/' ? SHELL_INDEX : url.pathname;
  if (SHELL_FILES.indexOf(path) < 0) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(shellPromotePending_().then(function () { return shellMatch_(SHELL_INDEX); })
      .then(function (hit) { return hit || fetch(event.request); })
      .catch(function () { return fetch(event.request); }));
    event.waitUntil(shellUpdate_());
    return;
  }
  event.respondWith(shellMatch_(path).then(function (hit) { return hit || fetch(event.request); })
    .catch(function () { return fetch(event.request); }));
});

// Только shell водителя: сеть первой (чтобы обновления доезжали), при обрыве - кэш.
// API api.yardhub.ru, шрифты и прочее - мимо, как будто SW нет.
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
