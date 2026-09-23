// Всплывающие уведомления логисту о том, что ответил водитель (принял/отказался) -
// 23.09.2026, Влад: "хочу чтобы были всплывашки у логиста по событиям водителя... и чтобы
// они висели пока не нажмешь крестик". requireInteraction:true - именно про это: браузер
// НЕ убирает уведомление само, только по клику/крестику пользователя (Chrome/Edge на
// десктопе это уважают; Safari требireInteraction игнорирует - там уведомление скроется
// как обычно, ограничение самого браузера, не нашего кода).
//
// ОГРАНИЧЕНИЕ, которое нужно понимать сразу: это НЕ настоящий Push (Web Push API с
// сервис-воркером) - тот работал бы, даже когда вкладка/браузер закрыты, но требует
// намного больше инфраструктуры (VAPID-ключи, service worker, хранение подписок в базе,
// сервер шлёт пуш через отдельную библиотеку). Здесь - опрос (polling) КАЖДЫЕ 15 СЕКУНД,
// пока эта вкладка дашборда открыта (хоть в фоне, хоть свёрнута) - для "логист сидит с
// дашбордом весь день, хочет видеть ответы водителей" этого достаточно и не требует
// трогать общий, сейчас очень активно редактируемый order-plan-v2.js - файл отдельный,
// подключается своим <script> в index.html.
//
// Своя заявка = created_by текущего логиста (сервер сам фильтрует, /api/logist_long/events).
(function () {
  'use strict';
  var POLL_MS = 15000;
  var LS_KEY = 'll_push_enabled';
  var ICON = 'icon-192.png';

  var seen = {};       // executor_id -> true, чтобы не показать один и тот же ответ дважды
  var sinceIso = null; // курсор "с какого момента искать новое" - от МОМЕНТА ВКЛЮЧЕНИЯ,
                        // не с начала времён (иначе первое включение обвалит лавину старых)
  var timer = null;
  var btn = null;

  function fmtEvent(e) {
    var ru = 'Заявка №' + e.day_no + ' · ' + (e.vehicle_gos || '') ;
    if (e.driver_bot_status === 'accepted') {
      return { title: '✅ ' + (e.driver_name || 'Водитель') + ' принял(а) задание', body: ru };
    }
    if (e.driver_bot_status === 'declined') {
      return { title: '❌ ' + (e.driver_name || 'Водитель') + ' отказался(лась)',
        body: ru + '\nПричина: ' + (e.driver_bot_decline_reason || 'не указана') };
    }
    return null;
  }

  function apiUrl(path, params) {
    var base = (typeof YARD_API_BASE !== 'undefined' && YARD_API_BASE) || 'https://api.yardhub.ru/api';
    var qs = Object.keys(params || {}).map(function (k) {
      return params[k] != null ? (k + '=' + encodeURIComponent(params[k])) : null;
    }).filter(Boolean).join('&');
    return base + path + (qs ? '?' + qs : '');
  }
  function sessionToken() { try { return (typeof SESSION_TOKEN !== 'undefined' && SESSION_TOKEN) || ''; } catch (e) { return ''; } }

  function poll() {
    var tok = sessionToken();
    if (!tok) return; // не залогинен - опрашивать нечего
    fetch(apiUrl('/logist_long/events', { since: sinceIso }), { headers: { 'X-Session-Token': tok } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) return;
        (d.events || []).forEach(function (e) {
          if (seen[e.id]) return;
          seen[e.id] = true;
          var f = fmtEvent(e);
          if (!f) return;
          try {
            var n = new Notification(f.title, { body: f.body, icon: ICON, requireInteraction: true, tag: 'll-' + e.id });
            n.onclick = function () { window.focus(); n.close(); };
          } catch (err) { /* браузер отказал показать - не роняем опрос */ }
        });
        if (d.now) sinceIso = d.now;
      })
      .catch(function () { /* сеть моргнула - следующий опрос через 15 с сам подхватит */ });
  }

  function startPolling() {
    if (timer) return;
    sinceIso = new Date().toISOString(); // с этой секунды, не с истории
    poll();
    timer = setInterval(poll, POLL_MS);
  }
  function stopPolling() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function setEnabled(on) {
    try { localStorage.setItem(LS_KEY, on ? '1' : '0'); } catch (e) {}
    if (on) startPolling(); else stopPolling();
    renderBtn();
  }
  function isEnabled() {
    try { return localStorage.getItem(LS_KEY) === '1'; } catch (e) { return false; }
  }

  function renderBtn() {
    if (!btn) return;
    var on = isEnabled() && Notification.permission === 'granted';
    btn.textContent = on ? '🔔' : '🔕';
    btn.title = on
      ? 'Уведомления о водителях включены · клик - выключить'
      : 'Включить всплывающие уведомления о водителях (принял/отказался)';
    btn.classList.toggle('ll-push-on', on);
  }

  function onBtnClick() {
    if (!('Notification' in window)) { alert('Этот браузер не умеет показывать системные уведомления.'); return; }
    if (isEnabled() && Notification.permission === 'granted') { setEnabled(false); return; }
    if (Notification.permission === 'denied') {
      alert('Уведомления запрещены для этого сайта в настройках браузера. Разреши их там и обнови страницу.');
      return;
    }
    Notification.requestPermission().then(function (perm) {
      if (perm === 'granted') setEnabled(true);
    });
  }

  function injectBtn() {
    var css = document.createElement('style');
    css.textContent =
      '.ll-push-btn{position:fixed;right:18px;bottom:18px;z-index:9000;width:44px;height:44px;' +
      'border-radius:50%;border:1px solid var(--border,#2a3630);background:var(--bg3,#182420);' +
      'color:var(--text,#eef3f0);font-size:19px;line-height:1;cursor:pointer;' +
      'box-shadow:0 8px 20px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;}' +
      '.ll-push-btn.ll-push-on{border-color:var(--green,#1d9e75);box-shadow:0 0 0 3px rgba(29,158,117,.18),0 8px 20px rgba(0,0,0,.35);}';
    document.head.appendChild(css);
    btn = document.createElement('button');
    btn.className = 'll-push-btn';
    btn.type = 'button';
    btn.addEventListener('click', onBtnClick);
    document.body.appendChild(btn);
    renderBtn();
  }

  function boot() {
    injectBtn();
    if (isEnabled() && 'Notification' in window && Notification.permission === 'granted') startPolling();
    document.addEventListener('visibilitychange', function () {
      // опрос идёт и в фоне (requireInteraction нужен именно для свёрнутой вкладки) -
      // здесь только освежаем иконку кнопки на случай, если пользователь потрогал
      // разрешение в настройках браузера, пока вкладка была скрыта.
      if (!document.hidden) renderBtn();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
