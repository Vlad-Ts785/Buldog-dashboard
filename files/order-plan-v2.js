/* ══════════════════════════════════════════════════════════════════════════════
   «План задание v2» - своя система заявок вместо Google-таблицы планировки.
   plans/2026-09-10-order-plan-v2-native.md, перенос утверждённого превью
   (правило «превью = контракт»: разметка, тексты кнопок, поведение и звуки -
   один в один, отличия только там, где превью подменяло сервер демо-данными).

   Модуль полностью самодостаточен: рендерит разметку внутрь уже существующего
   контейнера #page-order-plan и ходит в живой API api.yardhub.ru/api/orders*.
   Ничего из справочников (юрлица, типы техники, люди) в коде не перечисляется -
   всё приходит из /orders/meta и /orders (правило «логика через справочники»).

   Экран выбирается по РОЛИ: manager - «Мои заявки», logist - «Заявки»,
   admin получает переключатель обоих.

   Стили - files/order-plan-v2.css (все классы с префиксом op2-).
   ══════════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

/* ───────────────────────── мелкие помощники ───────────────────────── */
var ROOT_ID = 'page-order-plan';
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

/* Своя экранировка - всё, что приходит от людей (заказчик, груз, адреса, имена),
   уходит в innerHTML только через неё. Общей escHtml_ в index.html нет - те,
   что есть, приватны внутри чужих IIFE. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; }
function fmtP(n) { n = num(n); return n ? n.toLocaleString('ru-RU').replace(/ /g, ' ') + ' ₽' : ''; }
function fmtPhone(p) {
  var d = String(p || '').replace(/\D/g, '');
  if (d.length === 11) d = d.slice(1);
  return d.length === 10 ? '+7 ' + d.slice(0, 3) + ' ' + d.slice(3, 6) + '-' + d.slice(6, 8) + '-' + d.slice(8) : (p || '');
}
function tmin(t) { if (!t) return 1e9; var p = String(t).split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
function hhmm(m) { m = ((m % 1440) + 1440) % 1440; return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
/* «700» -> «07:00»; пусто -> пусто (в бою сервер тоже это принимает, но незачем гонять мусор) */
function normT(s) {
  s = String(s == null ? '' : s).trim().replace(/[^\d]/g, '');
  if (!s) return '';
  if (s.length <= 2) return ('0' + s).slice(-2) + ':00';
  if (s.length === 3) s = '0' + s;
  return s.slice(0, 2) + ':' + s.slice(2, 4);
}
function shortTime(t) { return t ? String(t).slice(0, 5) : ''; }
/* HH:MM из отметки времени («2026-09-11 06:25:00», «...T06:25:00Z») - не путать с
   shortTime, которая режет ЧИСТОЕ время («06:25:00»). Ошибиться легко: на карточке
   вместо «06:25» появлялось «2026-». */
function hhmmOf(ts) {
  if (!ts) return '';
  var s = String(ts);
  var m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? (('0' + m[1]).slice(-2) + ':' + m[2]) : '';
}

var WD_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
var WD_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
var MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
function pad2(n) { return ('0' + n).slice(-2); }
function dObj(ds) { var p = String(ds || '').split('-'); return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1); }
function dStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function todayStr() { return dStr(new Date()); }
function addDays(ds, n) { var d = dObj(ds); d.setDate(d.getDate() + n); return dStr(d); }
function dm(ds) { var d = dObj(ds); return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1); }
function dmy(ds) { var d = dObj(ds); return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear(); }
function humanDate(ds) { var d = dObj(ds); return d.getDate() + ' ' + MONTH_GEN[d.getMonth()]; }
function weekdayFull(ds) { return WD_FULL[dObj(ds).getDay()]; }
function plural(n, one, few, many) { var m10 = n % 10, m100 = n % 100; if (m10 === 1 && m100 !== 11) return one; if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few; return many; }
/* «Трал до 20 т» -> «трал»: сегмент техники для фильтров логиста. Ничего не
   перечисляем - берём первое слово из того, что реально пришло с сервера. */
function segOf(type) { return String(type || '').trim().toLowerCase().split(/[\s,\/]+/)[0] || ''; }
function capit(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

/* ───────────────────────── звук (ГОСТ, раздел 8) ─────────────────────────
   Деликатный регистр 200-660 Гц + «кабинный» confirm 880->1320 как в plan-m.
   nav      - любой клик-переход/выбор (одно делегирование, см. NAV_SEL)
   tickUp   - действие удалось: поставил машину, сохранил, подтвердил, принял
   tickDown - снял/отменил/вернул назад (в т.ч. «Отменить» в тосте)
   toggle   - переключил состояние без оценки
   lift/drop- поднял плитку машины / уложил на другую заявку
   attention- конфликт, «нужен новый пропуск» - triangle-«покашливание», не сирена */
var AC = null;
var soundOn = true;
try { soundOn = localStorage.getItem('op2_sound') !== 'off'; } catch (e) {}
function blip(f1, f2, dur, vol, type) {
  if (!soundOn) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    var o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f1, AC.currentTime);
    o.frequency.exponentialRampToValueAtTime(f2, AC.currentTime + dur);
    g.gain.setValueAtTime(vol, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
    o.connect(g); g.connect(AC.destination); o.start(); o.stop(AC.currentTime + dur);
  } catch (e) {}
}
var S = {
  nav: function () { blip(392, 440, .05, .022); },
  tickUp: function () { blip(880, 1320, .09, .04); },
  tickDown: function () { blip(440, 330, .09, .035); },
  toggle: function () { blip(520, 560, .04, .02); },
  lift: function () { blip(330, 392, .06, .03); },
  drop: function () { blip(392, 300, .08, .035); },
  attention: function () { blip(220, 180, .12, .06, 'triangle'); },
  /* отбой у логиста - один «сиренный кряк» (Влад 10.09): резче и громче всего
     остального, играет ОДИН раз в момент отбоя; мигание строки дальше молчит.
     Единственное исключение из деликатного регистра. */
  otboy: function () { blip(320, 150, .35, .09, 'sawtooth'); blip(640, 300, .18, .03, 'square'); },
  /* новая ПОДТВЕРЖДЁННАЯ заявка у логиста - мажорное арпеджио C5-E5-G5-C6 */
  newOrder: function () { [[523, 0], [659, 90], [784, 180], [1047, 270]].forEach(function (p) { setTimeout(function () { blip(p[0], p[0] * 1.01, .16, .045); }, p[1]); }); }
};

/* ───────────────────────── доступ к API ─────────────────────────
   SESSION_TOKEN и YARD_API_BASE объявлены в index.html через let/const на
   верхнем уровне классического скрипта - в window их НЕТ, но лексическая
   область общая, читаются как голые идентификаторы (см. память
   project_window_global_let_const_gotcha). */
function apiBase() { try { return YARD_API_BASE; } catch (e) { return 'https://api.yardhub.ru/api'; } }
function apiToken() { try { return SESSION_TOKEN || ''; } catch (e) { return ''; } }

function apiGet(path, params) {
  try {
    if (typeof fetchFromYardApi_ === 'function') return fetchFromYardApi_(path, params || {});
  } catch (e) {}
  var qs = Object.keys(params || {}).map(function (k) {
    return (params[k] !== undefined && params[k] !== null && params[k] !== '') ? (k + '=' + encodeURIComponent(params[k])) : null;
  }).filter(Boolean).join('&');
  return fetch(apiBase() + path + (qs ? '?' + qs : ''), { headers: { 'X-Session-Token': apiToken() } })
    .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); });
}
function apiPost(path, params) {
  try {
    if (typeof postToYardApi_ === 'function') return postToYardApi_(path, params || {});
  } catch (e) {}
  var qs = Object.keys(params || {}).map(function (k) {
    return (params[k] !== undefined && params[k] !== null) ? (k + '=' + encodeURIComponent(params[k])) : null;
  }).filter(Boolean).join('&');
  return fetch(apiBase() + path + (qs ? '?' + qs : ''), { method: 'POST', headers: { 'X-Session-Token': apiToken() } })
    .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); });
}
/* POST с JSON-телом - только /orders/save (у него десятки полей, в query не влезут) */
function apiPostJson(path, obj) {
  return fetch(apiBase() + path, {
    method: 'POST',
    headers: { 'X-Session-Token': apiToken(), 'Content-Type': 'application/json' },
    body: JSON.stringify(obj || {})
  }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); });
}
/* Единый разбор ответа: ошибка - всегда тостом, это единственный канал (ГОСТ) */
function ok_(r, okFn, failMsg) {
  if (r && r.ok && r.data && r.data.error == null) { if (okFn) okFn(r.data); return true; }
  var msg = (r && r.data && r.data.error) ? r.data.error : (failMsg || 'сервер недоступен');
  S.attention();
  toast('<span class="op2-bad">Не получилось</span> · ' + esc(msg));
  return false;
}

/* ───────────────────────── состояние ───────────────────────── */
var ST_UI = { confirmed: 'ok', unconfirmed: 'nz', cancelled: 'ot', done: 'done' };
var ST_API = { ok: 'confirmed', nz: 'unconfirmed', ot: 'cancelled', done: 'done' };
var ST_LABEL = { ok: 'Подтверждено', nz: 'Не подтверждено', ot: 'Отбой', done: 'Выполнено' };
var ST_M = { ok: 'Подтверждено', nz: 'Не подтверждено', ot: 'Отбой' };   /* три статуса менеджера */
var ST_ORDER = { ok: 0, nz: 1, done: 2, ot: 3 };

var built = false;
var ME = null;              /* {email,name,role,code} */
var META = null;            /* {dictionary, own_entities} */
var VIEW = 'log';           /* 'mgr' | 'log' - какой экран показываем */
var DATE = todayStr();
var TO_DATE = '';           /* непусто - режим «Неделя» */
var ORD = [];
var ROSTER = [];
var COUNTS = {};
var FREE = null;
var MAX_UPD = '';
var lastOkAt = 0;
var pollTimer = null, tickTimer = null;
var firstLoadDone = false;
var prevSnap = {};          /* id -> {st, upd} для звуков на входящие изменения */
var MY_SEG = '';
var loadingOrders = false;

var F = { type: 'all', nocar: false, nd: false, newOnly: false, mine: false, q: '' };
var SORT = { key: 'n', dir: 1 };

/* ───────────────────────── доступ к полям заявки ───────────────────────── */
function oSt(o) { return ST_UI[o.status] || 'nz'; }
function oOwn(o) { return (o.executors || []).filter(function (e) { return e.kind !== 'hired'; }); }
function oHired(o) { return (o.executors || []).filter(function (e) { return e.kind === 'hired'; })[0] || null; }
function oNo(o) { return o.day_no != null ? o.day_no : (o.id || ''); }
function oTime(o) { return shortTime(o.service_time); }
function oMgrCode(o) {
  if (o.internal) return (o.taken_by_code || o.manager_code || '').toUpperCase();
  return (o.manager_code || '').toUpperCase();
}
function oMgrTitle(o) {
  if (o.internal) return 'внутренний заказ, создал логист ' + (o.taken_by_name || o.manager_name || '');
  return o.manager_name || o.manager_code || '';
}
function byId(id) { for (var i = 0; i < ORD.length; i++) { if (String(ORD[i].id) === String(id)) return ORD[i]; } return null; }
function execById(o, eid) { var l = o.executors || []; for (var i = 0; i < l.length; i++) { if (String(l[i].id) === String(eid)) return l[i]; } return null; }
function isMgr() { return VIEW === 'mgr'; }
function canDone() { return ME && ME.role !== 'manager'; }

/* ───────────────────────── тост (единственный канал) ───────────────────────── */
var toastT = null;
function toastEl() { return $('#op2-toast'); }
function toast(html, undoFn, ms) {
  var t = toastEl();
  if (!t) return;
  t.innerHTML = html;
  if (undoFn) {
    var b = document.createElement('button');
    b.textContent = 'Отменить';
    b.disabled = true;
    /* «Отменить» активна только после ответа сервера - иначе отменяем то,
       что ещё не записалось */
    setTimeout(function () { b.disabled = false; }, 420);
    b.onclick = function () { S.tickDown(); undoFn(); hideToast(); };
    t.appendChild(b);
  }
  t.classList.add('op2-show');
  clearTimeout(toastT);
  toastT = setTimeout(hideToast, ms || 5000);
  return t;
}
function hideToast() { var t = toastEl(); if (t) t.classList.remove('op2-show'); }
function soon(what) { S.attention(); toast('<span class="op2-warn">' + esc(what) + '</span> · формируется в следующей версии'); }
/* документы (СТС, паспорт) - хранилище справочников подключается следующим этапом */
function soonDoc(what) { S.attention(); toast('<span class="op2-warn">' + esc(what) + '</span> · следующая версия: сканы подтянем из Справочников'); }

/* ═════════════════════════ РАЗМЕТКА ═════════════════════════ */
function buildDom() {
  var page = document.getElementById(ROOT_ID);
  if (!page) return false;
  page.innerHTML =
    '<div class="op2-root" id="op2-root">' +
      /* страховка: старый код страницы (loadOrderPlanData/renderOrderPlan) больше
         не вызывается, но если кто-то дёрнет его из другого чата - не упадёт */
      '<div id="order-plan-content" class="op2-hidden"></div>' +
      '<div class="op2-page-head">' +
        '<h2 id="op2-title">Задание</h2>' +
        '<span class="op2-sub" id="op2-sub"></span>' +
        '<div class="op2-switch op2-hidden" id="op2-switch" role="tablist">' +
          '<button data-scr="mgr" role="tab">Менеджер · Мои заявки</button>' +
          '<button data-scr="log" role="tab">Логист · Заявки</button>' +
        '</div>' +
        '<button class="op2-chip op2-snd" id="op2-snd"></button>' +
      '</div>' +

      '<div id="op2-skel" class="op2-skel">' +
        '<div class="op2-skel-line" style="width:40%"></div>' +
        '<div class="op2-skel-block"></div>' +
        '<div class="op2-skel-block" style="height:220px"></div>' +
      '</div>' +

      /* ── экран менеджера ── */
      '<section class="op2-screen" id="op2-scr-mgr">' +
        '<div class="op2-bar op2-h48">' +
          '<div class="op2-tabs" id="op2-mgr-tabs"></div>' +
          '<input type="date" class="op2-dt" id="op2-mgr-date" autocomplete="off" aria-label="Другой день">' +
          '<div class="op2-sep"></div>' +
          '<input class="op2-search" id="op2-mgr-search" placeholder="Заказчик за 3 месяца, напр. ДиМ" autocomplete="off">' +
          '<span class="op2-spacer"></span>' +
          '<button class="op2-dbtn op2-primary" id="op2-mgr-new">Новая заявка</button>' +
        '</div>' +
        '<div class="op2-verdict" id="op2-verdict">' +
          '<div><div class="op2-verdict__word" id="op2-verdict-word"></div><div class="op2-verdict__sub" id="op2-verdict-sub"></div></div>' +
          '<div class="op2-verdict__lever"><div class="op2-k">Без машины</div><div class="op2-v" id="op2-verdict-v">0</div><div class="op2-f" id="op2-verdict-f"></div></div>' +
        '</div>' +
        '<div class="op2-free" id="op2-free"></div>' +
        '<div class="op2-tblwrap op2-x">' +
          '<table class="op2-tbl op2-mgr-tbl" id="op2-mgr-tbl">' +
            '<thead><tr>' +
              '<th>№</th><th data-sort="t" class="op2-on">Время<span class="op2-s">▲</span></th>' +
              '<th data-sort="type">Техника<span class="op2-s">↕</span></th>' +
              '<th data-sort="cust">Заказчик<span class="op2-s">↕</span></th>' +
              '<th>Откуда → куда</th><th>Машина · водитель</th>' +
              '<th data-sort="st">Статус<span class="op2-s">↕</span></th>' +
              '<th class="op2-num" data-sort="price">Стоимость<span class="op2-s">↕</span></th>' +
            '</tr></thead>' +
            '<tbody id="op2-mgr-body"></tbody>' +
            '<tfoot id="op2-mgr-foot"></tfoot>' +
          '</table>' +
        '</div>' +
        '<div class="op2-legend">' +
          '<span><span class="op2-nd"></span>под данные - данные водителей переданы заказчику (пропуск); заявлены основная и резерв, замена только из них</span>' +
          '<span><span class="op2-dim">уточнить</span> - поле ещё не заполнено</span>' +
          '<span>зелёный госномер - водитель подтвердил заявку; наведи - кто и когда отметил</span>' +
          '<span>Клик по строке - карточка, копирование на пропуск и для водителя</span>' +
        '</div>' +
      '</section>' +

      /* ── экран логиста ── */
      '<section class="op2-screen" id="op2-scr-log">' +
        '<div class="op2-bar op2-h44">' +
          '<button class="op2-tab" id="op2-log-prev" aria-label="Предыдущий день">◀</button>' +
          '<button class="op2-tab op2-on" id="op2-log-day"></button>' +
          '<button class="op2-tab" id="op2-log-next" aria-label="Следующий день">▶</button>' +
          '<input type="date" class="op2-dt" id="op2-log-date" autocomplete="off" aria-label="Другой день">' +
          '<div class="op2-sep"></div>' +
          '<div id="op2-log-types"></div>' +
          '<div class="op2-sep"></div>' +
          '<button class="op2-chip" id="op2-f-nocar">Без машины<span class="op2-n" id="op2-c-nocar">0</span></button>' +
          '<button class="op2-chip" id="op2-f-nd">Под данные<span class="op2-n" id="op2-c-nd">0</span></button>' +
          '<button class="op2-chip" id="op2-f-new">Новые<span class="op2-n" id="op2-c-new">0</span></button>' +
          '<button class="op2-chip op2-hidden" id="op2-f-mine"></button>' +
          '<span class="op2-spacer"></span>' +
          '<input class="op2-search" id="op2-log-search" placeholder="Заказчик или 3 цифры номера" autocomplete="off">' +
          '<button class="op2-dbtn op2-primary" id="op2-log-new" title="Внутренняя перевозка, для базы, ОЭ/ОКР/ОБР">Новая заявка</button>' +
        '</div>' +
        '<div class="op2-tblwrap op2-x">' +
          '<table class="op2-tbl" id="op2-log-tbl">' +
            '<thead id="op2-log-head"><tr>' +
              '<th class="op2-on" data-sort="n" title="По умолчанию - по номеру заявки">№<span class="op2-s">▲</span></th>' +
              '<th data-sort="t">Время<span class="op2-s">↕</span></th>' +
              '<th data-sort="cust">Заказчик<span class="op2-s">↕</span></th>' +
              '<th data-sort="type">Техника<span class="op2-s">↕</span></th>' +
              '<th>Груз</th><th>Откуда → куда</th><th>Габарит</th>' +
              '<th data-sort="mgr">Мен.<span class="op2-s">↕</span></th>' +
              '<th>Машина</th>' +
              '<th data-sort="st">Статус<span class="op2-s">↕</span></th>' +
            '</tr></thead>' +
            '<tbody id="op2-log-body" class="op2-log-body"></tbody>' +
          '</table>' +
        '</div>' +
        '<div class="op2-legend">' +
          '<span><span class="op2-dot-amber"></span>до подачи меньше 2 ч и машины нет</span>' +
          '<span><span class="op2-nd"></span>под данные: замена только из заявленных (основная + резерв), вне списка - подтверждение и новый пропуск</span>' +
          '<span><span class="op2-hire">Наёмник</span>компания · госномер · водитель</span>' +
          '<span>Отбой: строка мигает, пока логист не нажмёт «принять»; машину на отбой поставить нельзя; если стояла - «Снять машину»</span>' +
          '<span><button class="op2-dok op2-on" style="pointer-events:none">✓</button> водитель подтвердил заявку (ставит логист) - у менеджера госномер зелёный</span>' +
          '<span>Зажать плитку машины на полсекунды - режим перемещения: перетащи на другую заявку (пусто - перенос, занято - обмен), Esc - отмена</span>' +
          '<span>Менеджер - три буквы фамилии, как в Планировке</span>' +
        '</div>' +
      '</section>' +

      /* ── поповер пикера машин ── */
      '<div class="op2-pop" id="op2-pop" role="dialog" aria-label="Поставить машину">' +
        '<div class="op2-ph"><input id="op2-pop-search" placeholder="3 цифры номера или фамилия" autocomplete="off"><span class="op2-ctx" id="op2-pop-ctx"></span></div>' +
        '<div class="op2-pb" id="op2-pop-body"></div>' +
        '<div class="op2-hstep" id="op2-hstep"></div>' +
        '<div class="op2-pf">' +
          '<span class="op2-cur" id="op2-pop-cur"></span>' +
          '<button class="op2-ghost op2-hidden" id="op2-pop-back">← Свой парк</button>' +
          '<button class="op2-dbtn op2-primary op2-blocked" id="op2-pop-ok">Выбери машину</button>' +
        '</div>' +
      '</div>' +

      /* ── шторка карточки/формы ── */
      '<div class="op2-scrim" id="op2-scrim"></div>' +
      '<aside class="op2-drawer" id="op2-drawer" aria-label="Заявка">' +
        '<div class="op2-dh"><h3 id="op2-d-title">Заявка</h3><span class="op2-sub" id="op2-d-sub"></span><button class="op2-x" id="op2-d-close">Закрыть</button></div>' +
        '<div class="op2-db" id="op2-d-body"></div>' +
        '<div class="op2-df" id="op2-d-foot"></div>' +
      '</aside>' +

      '<div class="op2-toast" id="op2-toast"></div>' +
      '<div class="op2-stpop" id="op2-stpop" role="menu"></div>' +

      /* ── «Задание водителю» ── */
      '<div class="op2-dmod-scrim" id="op2-drv-scrim"><div class="op2-dmod" role="dialog" aria-label="Задание водителю">' +
        '<div class="op2-dh"><h3 id="op2-drv-title">Задание водителю</h3><span class="op2-dim op2-sm" id="op2-drv-sub"></span></div>' +
        '<pre id="op2-drv-txt"></pre>' +
        '<div class="op2-acts">' +
          '<a class="op2-dbtn op2-primary" id="op2-drv-max" target="_blank" rel="noopener">Отправить в Max</a>' +
          '<a class="op2-dbtn op2-primary" id="op2-drv-wa" target="_blank" rel="noopener">Отправить в WhatsApp</a>' +
          '<a class="op2-ghost" id="op2-drv-tg" target="_blank" rel="noopener">Telegram</a>' +
          '<button class="op2-ghost" id="op2-drv-copy">Копировать текст</button>' +
          '<button class="op2-ghost" id="op2-drv-close">Закрыть</button>' +
          '<span class="op2-hint op2-dim op2-sm">Текст собран из заявки, звёздочек нет · водителю - в его мессенджер по номеру из справочника</span>' +
        '</div>' +
      '</div></div>' +
    '</div>';
  wire();
  return true;
}

/* ═════════════════════════ ОБРАБОТЧИКИ ═════════════════════════ */
/* ГОСТ: ОДНО делегирование со списком-селектором, не обработчик на каждый элемент.
   Элементы с собственным звуком результата (RESULT_SEL) из nav исключены, чтобы
   не было двойного щелчка. */
var NAV_SEL = '.op2-tab,.op2-chip,.op2-ghost,.op2-dbtn,.op2-slot,.op2-veh,.op2-st-chip,.op2-sugg .op2-it,.op2-free .op2-day,.op2-stpop button,.op2-pop .op2-vi,.op2-copybtn,.op2-take,.op2-dt,.op2-mgr-tbl tbody tr,.op2-log-body tr,.op2-switch button,[data-nav-sound]';
var RESULT_SEL = '#op2-f-save,#op2-rp-go,#op2-pop-ok,.op2-dok,.op2-unset-ot,.op2-slot.op2-ot,#op2-drv-copy,#op2-drv-max,#op2-d-drv-ok,.op2-dl,.op2-copybtn,.op2-stpop button,.op2-pop .op2-vi[data-act="unset"],#op2-snd,.op2-blocked';

function wire() {
  var root = $('#op2-root');

  root.addEventListener('click', function (e) {
    var t = e.target.closest(NAV_SEL);
    if (!t) return;
    if (e.target.closest(RESULT_SEL)) return;
    S.nav();
  });

  /* звук */
  var snd = $('#op2-snd');
  syncSndBtn();
  snd.addEventListener('click', function () {
    soundOn = !soundOn;
    try { localStorage.setItem('op2_sound', soundOn ? 'on' : 'off'); } catch (e) {}
    syncSndBtn();
    if (soundOn) S.toggle();
  });

  /* переключатель экранов (только admin) */
  $('#op2-switch').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-scr]');
    if (!b) return;
    VIEW = b.dataset.scr;
    closePop(); closeDrawer();
    renderAll();
    loadOrders();
  });

  /* ── даты ── */
  $('#op2-mgr-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('.op2-tab'); if (!b) return;
    if (b.dataset.week === '1') { TO_DATE = addDays(todayStr(), 6); DATE = todayStr(); }
    else { DATE = b.dataset.d; TO_DATE = ''; }
    F.q = ''; $('#op2-mgr-search').value = '';
    renderAll(); loadOrders(); loadFree();
  });
  $('#op2-mgr-date').addEventListener('change', function () { if (!this.value) return; DATE = this.value; TO_DATE = ''; renderAll(); loadOrders(); });
  $('#op2-log-date').addEventListener('change', function () { if (!this.value) return; DATE = this.value; TO_DATE = ''; renderAll(); loadOrders(); });
  $('#op2-log-prev').addEventListener('click', function () { DATE = addDays(DATE, -1); TO_DATE = ''; renderAll(); loadOrders(); });
  $('#op2-log-next').addEventListener('click', function () { DATE = addDays(DATE, 1); TO_DATE = ''; renderAll(); loadOrders(); });

  /* ── фильтры логиста ── */
  $('#op2-log-types').addEventListener('click', function (e) {
    var b = e.target.closest('.op2-chip'); if (!b) return;
    $$('.op2-chip', this).forEach(function (x) { x.classList.remove('op2-on'); });
    b.classList.add('op2-on'); F.type = b.dataset.t; renderLog();
  });
  [['op2-f-nocar', 'nocar'], ['op2-f-nd', 'nd'], ['op2-f-new', 'newOnly'], ['op2-f-mine', 'mine']].forEach(function (p) {
    $('#' + p[0]).addEventListener('click', function () { this.classList.toggle('op2-on'); F[p[1]] = this.classList.contains('op2-on'); renderLog(); });
  });
  var logSearchT = null;
  $('#op2-log-search').addEventListener('input', function () {
    var v = this.value.trim();
    clearTimeout(logSearchT);
    logSearchT = setTimeout(function () { F.q = v; renderLog(); }, 140);
  });

  /* ── поиск менеджера: за 3 месяца, отдельным запросом диапазона ── */
  var mgrSearchT = null;
  $('#op2-mgr-search').addEventListener('input', function () {
    var v = this.value.trim();
    clearTimeout(mgrSearchT);
    mgrSearchT = setTimeout(function () { F.q = v; if (v.length >= 2) loadWideSearch(v); else { WIDE = null; renderMgr(); } }, 350);
  });

  /* ── сортировка таблиц ── */
  $('#op2-log-head').addEventListener('click', function (e) { sortClick(e, this, renderLog); });
  $('#op2-mgr-tbl').querySelector('thead').addEventListener('click', function (e) { sortClick(e, this, renderMgr); });

  /* ── «Новая заявка» ── */
  $('#op2-mgr-new').addEventListener('click', function () { openDrawerForm(null, false, 'mgr'); });
  $('#op2-log-new').addEventListener('click', function () { openDrawerForm(null, false, 'log'); });

  /* ── свободные машины: раскрыть список ── */
  $('#op2-free').addEventListener('click', function (e) { var d = e.target.closest('.op2-day'); if (d) d.classList.toggle('op2-open'); });

  /* ── таблица менеджера ── */
  $('#op2-mgr-body').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-oid]'); if (!tr) return;
    var ch = e.target.closest('.op2-st-chip');
    if (ch) { openStPop(ch, tr); return; }
    var o = byId(tr.dataset.oid); if (!o) return;
    $$('#op2-mgr-body tr.op2-open').forEach(function (r) { r.classList.remove('op2-open'); });
    tr.classList.add('op2-open');
    openDrawerView(o, 'mgr');
  });
  /* ГОСТ, запрет №20: системное меню правой кнопки на рабочей поверхности запрещено */
  $('#op2-mgr-body').addEventListener('contextmenu', function (e) {
    e.preventDefault();
    var tr = e.target.closest('tr[data-oid]'); if (!tr) return;
    var o = byId(tr.dataset.oid); if (!o) return;
    openRowMenu(e.clientX, e.clientY, mgrRowMenu(o));
  });

  /* ── таблица логиста ── */
  $('#op2-log-body').addEventListener('click', onLogClick);
  $('#op2-log-body').addEventListener('contextmenu', function (e) {
    e.preventDefault();
    if (mv.active) return;
    var tr = e.target.closest('tr[data-oid]'); if (!tr) return;
    var o = byId(tr.dataset.oid); if (!o) return;
    openRowMenu(e.clientX, e.clientY, logRowMenu(o));
  });
  $('#op2-log-body').addEventListener('pointerdown', onVehPointerDown);

  /* ── поповер пикера ── */
  $('#op2-pop-search').addEventListener('input', function () { renderPop(this.value); });
  $('#op2-pop-body').addEventListener('click', onPopBodyClick);
  $('#op2-pop-back').addEventListener('click', function () {
    $('#op2-pop').classList.remove('op2-hired');
    this.classList.add('op2-hidden');
    var ok = $('#op2-pop-ok'); ok.className = 'op2-dbtn op2-primary op2-blocked'; ok.textContent = 'Выбери машину';
  });
  $('#op2-pop-ok').addEventListener('click', onPopOk);

  /* ── шторка ── */
  $('#op2-d-close').addEventListener('click', closeDrawer);
  $('#op2-scrim').addEventListener('click', closeDrawer);
  $('#op2-d-foot').addEventListener('click', onDrawerFoot);

  /* ── «Задание водителю» ── */
  $('#op2-drv-close').addEventListener('click', closeDrv);
  $('#op2-drv-scrim').addEventListener('click', function (e) { if (e.target === this) closeDrv(); });

  /* ── статус-поповер ── */
  $('#op2-stpop').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || !stTr) return;
    var tr = stTr; closeStPop();
    if (!b.classList.contains('op2-cur')) setStatusUi(tr, b.dataset.st);
  });

  /* ── глобальные: Esc, клик мимо, скролл ── */
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('mousedown', onDocMouseDown, true);
  window.addEventListener('scroll', function () { if ($('#op2-pop') && $('#op2-pop').classList.contains('op2-open')) closePop(); }, true);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', function () { clearTimeout(mv.timer); mv.timer = null; if (mv.active) endMove(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && isPageActive()) loadOrders(); });
}

function syncSndBtn() {
  var b = $('#op2-snd'); if (!b) return;
  b.textContent = 'Звук: ' + (soundOn ? 'вкл' : 'выкл');
  b.classList.toggle('op2-on', soundOn);
}
function sortClick(e, head, rerender) {
  var th = e.target.closest('th[data-sort]'); if (!th) return;
  if (SORT.key === th.dataset.sort) SORT.dir = -SORT.dir; else { SORT.key = th.dataset.sort; SORT.dir = 1; }
  $$('th', head).forEach(function (x) { x.classList.remove('op2-on'); var s = x.querySelector('.op2-s'); if (s) s.textContent = '↕'; });
  th.classList.add('op2-on');
  var s2 = th.querySelector('.op2-s'); if (s2) s2.textContent = SORT.dir > 0 ? '▲' : '▼';
  S.nav(); rerender();
}
function onKeyDown(e) {
  if (e.key !== 'Escape') return;
  if (!isPageActive()) return;
  if (mv.active) { endMove(); S.tickDown(); toast('Перемещение отменено'); return; }
  if ($('#op2-row-menu')) { closeRowMenu(); return; }
  if ($('#op2-drv-scrim').classList.contains('op2-open')) { closeDrv(); return; }
  if ($('#op2-stpop').classList.contains('op2-open')) { closeStPop(); return; }
  if ($('#op2-pop').classList.contains('op2-open')) { closePop(); return; }
  closeDrawer();
}
function onDocMouseDown(e) {
  if (!built) return;
  var sp = $('#op2-stpop');
  if (sp && sp.classList.contains('op2-open') && !e.target.closest('#op2-stpop') && !e.target.closest('.op2-st-chip')) closeStPop();
  var pop = $('#op2-pop');
  if (pop && pop.classList.contains('op2-open') && !e.target.closest('#op2-pop') && !e.target.closest('.op2-slot,.op2-veh')) closePop();
  if ($('#op2-row-menu') && !e.target.closest('#op2-row-menu')) closeRowMenu();
}
function isPageActive() {
  var p = document.getElementById(ROOT_ID);
  return !!(p && p.classList.contains('active'));
}

/* ═════════════════════════ ЗАГРУЗКА ═════════════════════════ */
function loadMeta() {
  return apiGet('/orders/meta', {}).then(function (r) {
    if (r && r.ok && r.data && !r.data.error) {
      META = r.data;
      if (r.data.me) applyMe(r.data.me);
    }
  }).catch(function () {});
}
function applyMe(me) {
  var first = !ME;
  ME = me;
  if (first) {
    VIEW = (me.role === 'manager') ? 'mgr' : 'log';
    $('#op2-switch').classList.toggle('op2-hidden', me.role !== 'admin');
    if (me.role === 'admin') syncSwitch();
  }
}
function syncSwitch() {
  $$('#op2-switch button').forEach(function (b) { b.classList.toggle('op2-on', b.dataset.scr === VIEW); });
}
function loadOrders(silent) {
  if (loadingOrders) return Promise.resolve();
  loadingOrders = true;
  var params = { date: DATE };
  if (TO_DATE) params.to = TO_DATE;
  return apiGet('/orders', params).then(function (r) {
    loadingOrders = false;
    if (!r || !r.ok || !r.data || r.data.error) {
      if (!silent) ok_(r, null, 'заявки не загрузились');
      return;
    }
    var d = r.data;
    if (d.me) applyMe(d.me);
    if (d.roster) ROSTER = d.roster;
    var changed = (d.max_updated || '') !== MAX_UPD || !firstLoadDone;
    MAX_UPD = d.max_updated || '';
    ORD = d.orders || [];
    lastOkAt = Date.now();
    deriveMySeg();
    if (firstLoadDone) soundsForDiff();
    snapshot();
    firstLoadDone = true;
    if (changed || !silent) renderAll();
    else renderUpdated();
  }).catch(function () { loadingOrders = false; });
}
function loadCounts() {
  var tabs = dayTabs();
  var from = tabs[0].d, to = tabs[tabs.length - 2].d;
  return apiGet('/orders/counts', { from: from, to: to }).then(function (r) {
    if (!r || !r.ok || !r.data || r.data.error) return;
    COUNTS = {};
    (r.data.counts || []).forEach(function (c) { COUNTS[c.date] = c; });
    renderTabs();
  }).catch(function () {});
}
function loadFree() {
  var t = todayStr();
  return apiGet('/orders/free_vehicles', { dates: t + ',' + addDays(t, 1) }).then(function (r) {
    if (!r || !r.ok || !r.data || r.data.error) return;
    FREE = r.data.free || {};
    renderFree();
  }).catch(function () {});
}
var WIDE = null;
var wideCache = { at: 0, rows: null };
function loadWideSearch(q) {
  var t = todayStr();
  var from = addDays(t, -90), to = addDays(t, 30);
  function apply(rows) {
    var qq = q.toLowerCase();
    WIDE = { q: q, rows: rows.filter(function (o) { return String(o.customer || '').toLowerCase().indexOf(qq) >= 0; }) };
    renderMgr();
  }
  if (wideCache.rows && Date.now() - wideCache.at < 5 * 60 * 1000) { apply(wideCache.rows); return; }
  apiGet('/orders', { date: from, to: to }).then(function (r) {
    if (!r || !r.ok || !r.data || r.data.error) { ok_(r, null, 'поиск за 3 месяца не удался'); return; }
    wideCache = { at: Date.now(), rows: r.data.orders || [] };
    apply(wideCache.rows);
  }).catch(function () {});
}
/* Сегмент логиста выводим из данных, а не из списка в коде: чаще всего
   встречающийся тип среди заявок, которые он сам взял в работу. Не вывелся -
   чип «Мой сегмент» просто не показываем (сервер поля me.segment пока не даёт). */
function deriveMySeg() {
  if (!ME || ME.role === 'manager') { MY_SEG = ''; return; }
  var cnt = {};
  ORD.forEach(function (o) {
    if (!o.taken_by_name || !ME.name || o.taken_by_name !== ME.name) return;
    var s = segOf(o.equipment_type); if (!s) return;
    cnt[s] = (cnt[s] || 0) + 1;
  });
  var best = '', bn = 0;
  Object.keys(cnt).forEach(function (k) { if (cnt[k] > bn) { bn = cnt[k]; best = k; } });
  MY_SEG = best;
}
function snapshot() {
  prevSnap = {};
  ORD.forEach(function (o) { prevSnap[o.id] = { st: oSt(o), upd: o.updated_at || '' }; });
}
function soundsForDiff() {
  var newConfirmed = false, newOtboy = false;
  ORD.forEach(function (o) {
    var p = prevSnap[o.id];
    var st = oSt(o);
    if (!p) { if (!isMgr() && st === 'ok') newConfirmed = true; return; }
    if (p.st !== 'ot' && st === 'ot') newOtboy = true;
  });
  if (newOtboy) S.otboy();
  else if (newConfirmed) S.newOrder();
}

/* ═════════════════════════ РЕНДЕР ═════════════════════════ */
function dayTabs() {
  var t = todayStr();
  var arr = [
    { d: addDays(t, -1), l: 'Вчера' },
    { d: t, l: 'Сегодня ' + dm(t) },
    { d: addDays(t, 1), l: 'Завтра' }
  ];
  /* дальше - ближайшие будни (выходные логистам как вкладки не нужны, в превью
     после «Завтра» стояли сразу Пн и Вт); в любой день доступны через календарь */
  var i = 2, added = 0;
  while (added < 2 && i < 10) {
    var d = addDays(t, i), wd = dObj(d).getDay();
    if (wd !== 0 && wd !== 6) { arr.push({ d: d, l: WD_SHORT[wd] + ' ' + dObj(d).getDate() }); added++; }
    i++;
  }
  arr.push({ d: '', l: 'Неделя', week: true });
  return arr;
}
function renderTabs() {
  var box = $('#op2-mgr-tabs'); if (!box) return;
  box.innerHTML = dayTabs().map(function (t) {
    var on = t.week ? !!TO_DATE : (!TO_DATE && t.d === DATE);
    var c = COUNTS[t.d];
    var cnt = '';
    if (c && c.total) {
      cnt = '<span class="op2-cnt">' + c.total + (c.nocar ? ' · ' + c.nocar + ' без машины' : '') + '</span>';
    }
    return '<button class="op2-tab' + (on ? ' op2-on' : '') + '" data-d="' + esc(t.d) + '"' + (t.week ? ' data-week="1"' : '') + '>' + esc(t.l) + cnt + '</button>';
  }).join('');
}
function renderUpdated() {
  var el = $('#op2-sub'); if (!el) return;
  var who = ME ? (ME.name || ME.email || '') : '';
  var when = lastOkAt ? Math.max(1, Math.round((Date.now() - lastOkAt) / 1000)) : 0;
  var ago = when ? '<span class="op2-mono">обновлено ' + (when > 90 ? Math.round(when / 60) + ' мин назад' : when + ' с назад') + '</span>' : '';
  if (isMgr()) el.innerHTML = esc(who) + (ago ? ' · ' + ago : '');
  else el.innerHTML = esc(capit(weekdayFull(DATE)) + ', ' + humanDate(DATE)) + (ago ? ' · ' + ago : '') + (who ? ' · вы: ' + esc(who) : '');
}
function renderAll() {
  if (!built) return;
  $('#op2-skel').classList.toggle('op2-hidden', !!ME);
  $('#op2-scr-mgr').classList.toggle('op2-on', !!ME && isMgr());
  $('#op2-scr-log').classList.toggle('op2-on', !!ME && !isMgr());
  $('#op2-title').textContent = 'Задание'; /* 11.09, Влад: «называется просто Задание» - у обеих ролей */
  if (ME && ME.role === 'admin') syncSwitch();
  $('#op2-mgr-date').value = TO_DATE ? todayStr() : DATE;
  $('#op2-log-date').value = DATE;
  $('#op2-log-day').textContent = dm(DATE);
  renderUpdated();
  renderTabs();
  if (isMgr()) { renderVerdict(); renderFree(); renderMgr(); }
  else { renderTypeChips(); renderLog(); }
}

/* ── вердикт менеджера ── */
function renderVerdict() {
  var rows = ORD;
  var total = rows.length;
  var withCar = rows.filter(function (o) { return oSt(o) !== 'ot' && (oOwn(o).length || oHired(o)); }).length;
  var noCar = rows.filter(function (o) { return oSt(o) !== 'ot' && !oOwn(o).length && !oHired(o); }).length;
  var ot = rows.filter(function (o) { return oSt(o) === 'ot'; }).length;
  var nd = rows.filter(function (o) { return !!o.needs_data; }).length;
  var v = $('#op2-verdict');
  v.classList.toggle('op2-good', noCar === 0 && total > 0);
  $('#op2-verdict-word').textContent = total
    ? total + ' ' + plural(total, 'ЗАЯВКА', 'ЗАЯВКИ', 'ЗАЯВОК') + (TO_DATE ? ' НА НЕДЕЛЮ' : ' НА ' + (DATE === todayStr() ? 'СЕГОДНЯ' : dm(DATE)))
    : 'ЗАЯВОК НЕТ';
  $('#op2-verdict-sub').textContent = withCar + ' с машиной · ' + noCar + ' без машины · ' + ot + ' отбой · ' + nd + ' под данные';
  $('#op2-verdict-v').textContent = noCar;
  /* формула должна сходиться по цифрам страницы: всего − с машиной − отбой
     (в превью отбоев на дне не было, и вычитаемое было одно) */
  $('#op2-verdict-f').textContent = total
    ? '(' + total + ' − ' + withCar + ' с машиной' + (ot ? ' − ' + ot + ' отбой' : '') + ') из ' + total
    : '';
}

/* ── свободные машины сегодня/завтра ── */
function renderFree() {
  var box = $('#op2-free'); if (!box) return;
  var t = todayStr(), tm = addDays(t, 1);
  function card(d, label) {
    var f = (FREE || {})[d];
    if (!f) return '<div class="op2-day"><div class="op2-k">' + esc(label) + '</div><div class="op2-row"><span class="op2-v op2-zero">—</span><span class="op2-by">данные парка не пришли</span></div></div>';
    var byParts = [];
    if (f.tral != null) byParts.push('тралы <b>' + esc(f.tral) + '</b>');
    if (f.bort != null) byParts.push('борта <b>' + esc(f.bort) + '</b>');
    var list = (f.list || []).map(function (v) {
      return '<span class="op2-gos">' + esc(v.gos) + '</span>' + esc(v.type || '') + (v.driver ? ' · ' + esc(v.driver) : ' · без водителя');
    }).join('<br>');
    return '<div class="op2-day" data-day="' + esc(d) + '">' +
      '<div class="op2-k">' + esc(label) + '</div>' +
      '<div class="op2-row"><span class="op2-v' + (f.total ? '' : ' op2-zero') + '">' + esc(f.total || 0) + '</span><span class="op2-by">' + byParts.join(' · ') + '</span></div>' +
      (list ? '<div class="op2-list">' + list + '</div>' : '') +
      '</div>';
  }
  box.innerHTML = card(t, 'Свободны сегодня · ' + dm(t)) + card(tm, 'Свободны завтра · ' + dm(tm)) +
    '<div class="op2-note">Считается по Планировке логистов: машина в строю и без отрезка на этот день. Клик - список госномеров.</div>';
}

/* ── общая сортировка ── */
function sortRows(rows) {
  var k = SORT.key, d = SORT.dir;
  return rows.sort(function (a, b) {
    var va, vb;
    if (k === 't') { va = tmin(oTime(a)); vb = tmin(oTime(b)); }
    else if (k === 'n') { va = num(oNo(a)); vb = num(oNo(b)); }
    else if (k === 'price') { va = num(a.price); vb = num(b.price); }
    else if (k === 'st') { va = ST_ORDER[oSt(a)]; vb = ST_ORDER[oSt(b)]; }
    else if (k === 'cust') { va = String(a.customer || '').toLowerCase(); vb = String(b.customer || '').toLowerCase(); }
    else if (k === 'type') { va = String(a.equipment_type || '').toLowerCase(); vb = String(b.equipment_type || '').toLowerCase(); }
    else if (k === 'mgr') { va = oMgrCode(a); vb = oMgrCode(b); }
    else { va = ''; vb = ''; }
    return (va > vb ? 1 : va < vb ? -1 : 0) * d || (num(oNo(a)) - num(oNo(b)));
  });
}
function stChip(o) {
  var k = oSt(o);
  return '<span class="op2-st-chip op2-' + k + '">' + esc(ST_LABEL[k]) + '</span>';
}
function routeCell(o, w) {
  var mw = w ? ' style="max-width:' + w + 'px"' : '';
  return '<span class="op2-route"><span class="op2-ell"' + mw + '>' + (o.load_address ? esc(o.load_address) : '<span class="op2-dim">уточнить</span>') + '</span>' +
    '<span class="op2-arr">→</span><span class="op2-ell"' + mw + '>' + (o.unload_address ? esc(o.unload_address) : '<span class="op2-dim">уточнить</span>') + '</span></span>';
}
function timeCell(o) {
  var t = oTime(o);
  return t ? '<span class="op2-mono">' + esc(t) + '</span>' : '<span class="op2-dim">уточнить</span>';
}

/* ── таблица менеджера ── */
function renderMgr() {
  var body = $('#op2-mgr-body'); if (!body) return;
  var rows = WIDE && F.q ? WIDE.rows.slice() : ORD.slice();
  if (!WIDE && F.q) {
    var q = F.q.toLowerCase();
    rows = rows.filter(function (o) { return String(o.customer || '').toLowerCase().indexOf(q) >= 0; });
  }
  rows = sortRows(rows);
  body.innerHTML = rows.map(function (o) {
    var k = oSt(o);
    var cls = 'op2-r36' + (k === 'ot' ? ' op2-otboy' : '');
    return '<tr class="' + cls + '" data-oid="' + esc(o.id) + '">' +
      '<td class="op2-ono">' + esc(oNo(o)) + '</td>' +
      '<td>' + timeCell(o) + '</td>' +
      '<td>' + (o.equipment_type ? '<span class="op2-ttype">' + esc(o.equipment_type) + '</span>' : '<span class="op2-dim">уточнить</span>') + '</td>' +
      '<td class="op2-ell" title="' + esc(o.customer) + '">' + (WIDE && F.q ? '<span class="op2-code" style="margin-right:6px">' + esc(dm(o.service_date)) + '</span>' : '') + esc(o.customer || '') + '</td>' +
      '<td>' + routeCell(o, 160) + '</td>' +
      '<td>' + mgrVehCell(o) + '</td>' +
      '<td>' + (o.needs_data ? '<span class="op2-nd" title="под данные: данные водителей у заказчика"></span>' : '') + stChip(o) + '</td>' +
      '<td class="op2-num op2-mono">' + (num(o.price) ? esc(fmtP(o.price)) : '<span class="op2-dim">—</span>') + '</td>' +
      '</tr>';
  }).join('');
  var cash = rows.filter(function (o) { return !!o.cash; }).length;
  var sum = rows.reduce(function (a, o) { return a + num(o.price); }, 0);
  $('#op2-mgr-foot').innerHTML = '<tr><td colspan="7">' +
    (WIDE && F.q ? 'Поиск за 3 месяца · «' + esc(F.q) + '» · ' : 'Итого за ' + (TO_DATE ? 'неделю' : 'день') + ' · ') +
    rows.length + ' ' + plural(rows.length, 'заявка', 'заявки', 'заявок') + (cash ? ' · ' + cash + ' наличными' : '') +
    '</td><td class="op2-num"><span class="op2-mono">' + esc(fmtP(sum) || '—') + '</span></td></tr>';
}
function mgrVehCell(o) {
  var h = oHired(o);
  if (h) {
    return '<div class="op2-veh"><span class="op2-hire">Наёмник</span><span class="op2-drv">' + esc(h.carrier_name || 'перевозчик уточняется') +
      (h.vehicle_gos ? ' · <span class="op2-mono">' + esc(h.vehicle_gos) + '</span>' : '') + (h.driver_name ? ' · ' + esc(h.driver_name) : '') + '</span></div>';
  }
  var vs = oOwn(o);
  if (!vs.length) {
    return '<span class="op2-dim">машину ещё не поставили' + (o.taken_by_name ? ' · <b style="font-weight:500;color:var(--text)">принял ' + esc(o.taken_by_name) + '</b>' : '') + '</span>';
  }
  function row(v) {
    var okc = v.driver_confirmed_at ? ' op2-ok' : '';
    var ttl = v.driver_confirmed_at ? ' title="Водитель ' + esc(v.driver_name || '') + ' подтвердил заявку · ' + esc(v.driver_confirmed_by || '') + ' ' + esc(hhmmOf(v.driver_confirmed_at) || '') + '"' : '';
    var roleTxt = (vs.length > 1 && v.role) ? ' · ' + (v.role === 'reserve' ? 'резерв' : 'основная') : '';
    return '<span class="op2-gos' + okc + '"' + ttl + '>' + esc(v.vehicle_gos || '') + '</span>' +
      '<span class="op2-drv">' + esc(v.driver_name || 'водитель уточняется') + roleTxt + '</span>';
  }
  var inner = vs.length === 1
    ? '<div class="op2-veh">' + row(vs[0]) + '</div>'
    : '<div class="op2-veh op2-multi">' + vs.map(function (v) { return '<div class="op2-row">' + row(v) + '</div>'; }).join('') + '</div>';
  return inner + pendHtml(o, 'mgr');
}
function pendHtml(o, who) {
  var p = o.pending_request;
  if (!p) return '';
  if (who === 'mgr') {
    return '<div class="op2-pend">логист предлагает замену → <span class="op2-mono">' + esc(p.to_gos || '') + '</span> · <b>ждёт вашего подтверждения</b></div>';
  }
  return '<div class="op2-pend" title="Замена вне заявленных на заявке под данные: ждёт, пока менеджер согласует с заказчиком">замена → <span class="op2-mono">' +
    esc(p.to_gos || '') + '</span>' + (p.to_driver_name ? ' · ' + esc(p.to_driver_name) : '') + ' · <b>ждёт менеджера</b></div>';
}

/* ── таблица логиста ── */
function renderTypeChips() {
  var box = $('#op2-log-types'); if (!box) return;
  var segs = [];
  ORD.forEach(function (o) { var s = segOf(o.equipment_type); if (s && segs.indexOf(s) < 0) segs.push(s); });
  segs.sort();
  if (F.type !== 'all' && segs.indexOf(F.type) < 0) F.type = 'all';
  box.innerHTML = '<button class="op2-chip' + (F.type === 'all' ? ' op2-on' : '') + '" data-t="all">Все</button>' +
    segs.map(function (s) { return '<button class="op2-chip' + (F.type === s ? ' op2-on' : '') + '" data-t="' + esc(s) + '">' + esc(capit(s)) + '</button>'; }).join('');
  var mine = $('#op2-f-mine');
  mine.classList.toggle('op2-hidden', !MY_SEG);
  if (MY_SEG) {
    mine.innerHTML = 'Мой сегмент: ' + esc(MY_SEG);
    mine.classList.toggle('op2-on', F.mine);
  } else { F.mine = false; }
}
function nowMin() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function vehCellLog(o) {
  var k = oSt(o);
  if (k === 'ot') {
    var vs0 = oOwn(o).map(function (v) { return '<span class="op2-gos">' + esc(v.vehicle_gos || '') + '</span>'; }).join(' ');
    if (!o.otboy_ack_by) {
      return '<button class="op2-slot op2-ot" data-oid="' + esc(o.id) + '" data-ot="1">Отбой' + (vs0 ? ' · ' + vs0 : '') + '<span class="op2-take">принять</span></button>';
    }
    return '<div class="op2-otdone">отбой принят · ' + esc(o.otboy_ack_by) + ' ' + esc(hhmmOf(o.otboy_ack_at) || '') +
      (vs0 ? ' ' + vs0 + '<button class="op2-unset-ot" data-oid="' + esc(o.id) + '">Снять машину</button>' : '') + '</div>';
  }
  var h = oHired(o);
  if (h) {
    return '<div class="op2-veh" data-oid="' + esc(o.id) + '"><span class="op2-hire">Наёмник</span><span class="op2-drv">' +
      esc(h.carrier_name || 'перевозчик уточняется') + (h.vehicle_gos ? ' · <span class="op2-mono">' + esc(h.vehicle_gos) + '</span>' : '') +
      (h.driver_name ? ' · ' + esc(h.driver_name) : '') + (h.carrier_status ? ' · ' + esc(h.carrier_status) : '') + '</span></div>';
  }
  var vs = oOwn(o);
  if (!vs.length) {
    var t = oTime(o);
    var amber = (t && tmin(t) - nowMin() < 120 && tmin(t) >= nowMin() && DATE === todayStr()) ? '<span class="op2-dot-amber" title="до подачи меньше 2 ч"></span>' : '';
    var take = o.taken_by_name ? '<span class="op2-take">взял ' + esc(String(o.taken_by_code || o.taken_by_name).toUpperCase()) + '</span>' : '<span class="op2-take">беру</span>';
    return '<button class="op2-slot" data-oid="' + esc(o.id) + '">' + amber + 'Поставить' + take + '</button>';
  }
  function okBtn(v) {
    var on = !!v.driver_confirmed_at;
    var ttl = on ? 'Водитель ' + (v.driver_name || '') + ' подтвердил · ' + (v.driver_confirmed_by || '') + ' ' + (hhmmOf(v.driver_confirmed_at) || '') + ' · клик - снять'
      : 'Водитель подтвердил заявку? клик - отметить';
    return '<button class="op2-dok' + (on ? ' op2-on' : '') + '" data-oid="' + esc(o.id) + '" data-eid="' + esc(v.id) + '" title="' + esc(ttl) + '">✓</button>';
  }
  if (vs.length === 1) {
    var v = vs[0];
    return '<div class="op2-vehrow"><div class="op2-veh" data-oid="' + esc(o.id) + '" data-eid="' + esc(v.id) + '">' +
      '<span class="op2-gos' + (v.driver_confirmed_at ? ' op2-ok' : '') + '">' + esc(v.vehicle_gos || '') + '</span>' +
      '<span class="op2-drv">' + esc(v.driver_name || 'водитель уточняется') + (v.driver_confirmed_at ? ' · подтвердил' : '') + '</span>' +
      '</div>' + okBtn(v) + '</div>' + pendHtml(o, 'log');
  }
  return '<div class="op2-vehrow"><div class="op2-veh op2-multi" data-oid="' + esc(o.id) + '">' +
    vs.map(function (v) {
      return '<div class="op2-row"><span class="op2-gos' + (v.driver_confirmed_at ? ' op2-ok' : '') + '">' + esc(v.vehicle_gos || '') + '</span>' +
        '<span class="op2-drv">' + esc(v.driver_name || '') + (v.role ? ' · ' + (v.role === 'reserve' ? 'резерв' : 'основная') : '') + (v.driver_confirmed_at ? ' · подтвердил' : '') + '</span></div>';
    }).join('') + '</div><div style="display:flex;flex-direction:column;gap:2px">' + vs.map(okBtn).join('') + '</div></div>' + pendHtml(o, 'log');
}
function renderLog() {
  var body = $('#op2-log-body'); if (!body) return;
  var noCar = 0, nd = 0, nw = 0;
  ORD.forEach(function (o) {
    if (oSt(o) !== 'ot' && !oHired(o) && !oOwn(o).length) noCar++;
    if (o.needs_data) nd++;
    if (isFresh(o)) nw++;
  });
  $('#op2-c-nocar').textContent = noCar;
  $('#op2-c-nd').textContent = nd;
  $('#op2-c-new').textContent = nw;

  var rows = sortRows(ORD.slice()).filter(function (o) {
    if (isFresh(o)) return true;   /* новая заявка показывается всегда, даже вне фильтра */
    if (F.type !== 'all' && segOf(o.equipment_type) !== F.type) return false;
    if (F.mine && MY_SEG && segOf(o.equipment_type) !== MY_SEG && !(!oOwn(o).length && !oHired(o))) return false;
    if (F.nocar && (oOwn(o).length || oHired(o) || oSt(o) === 'ot')) return false;
    if (F.nd && !o.needs_data) return false;
    if (F.newOnly && !isFresh(o)) return false;
    if (F.q) {
      var q = F.q.toLowerCase(), qd = q.replace(/\s/g, '');
      var inCust = String(o.customer || '').toLowerCase().indexOf(q) >= 0;
      var inGos = (o.executors || []).some(function (v) { return String(v.vehicle_gos || '').replace(/\s/g, '').toLowerCase().indexOf(qd) >= 0; });
      if (!inCust && !inGos) return false;
    }
    return true;
  });

  body.innerHTML = rows.map(function (o) {
    var k = oSt(o);
    var vs = oOwn(o);
    var cls = 'op2-r44' + (k === 'ot' ? ' op2-otboy' + (o.otboy_ack_by ? '' : ' op2-unack') : '') + (isFresh(o) ? ' op2-new-halo' : '');
    var h = vs.length > 1 ? ' style="height:' + (44 + 18 * (vs.length - 1)) + 'px"' : '';
    return '<tr class="' + cls + '" data-oid="' + esc(o.id) + '"' + h + '>' +
      '<td class="op2-ono">' + esc(oNo(o)) + '</td>' +
      '<td>' + timeCell(o) + '</td>' +
      '<td class="op2-ell" title="' + esc(o.customer) + '">' + (isFresh(o) ? '<span class="op2-st-chip op2-ok" style="margin-right:6px">новая</span>' : '') + esc(o.customer || '') + '</td>' +
      '<td>' + (o.equipment_type ? '<span class="op2-ttype">' + esc(o.equipment_type) + '</span>' : '<span class="op2-dim">уточнить</span>') + '</td>' +
      '<td class="op2-dim op2-ell" style="max-width:150px">' + esc(o.cargo || '') + '</td>' +
      '<td>' + routeCell(o, 120) + '</td>' +
      '<td class="op2-sm">' + (o.gabarit ? '<span style="color:var(--tint-amber)">' + esc(o.gabarit) + '</span>' : '') + '</td>' +
      '<td><span class="op2-code" title="' + esc(oMgrTitle(o)) + '"' + (o.internal ? ' style="color:var(--tint-blue)"' : '') + '>' + esc(oMgrCode(o)) + '</span></td>' +
      '<td>' + vehCellLog(o) + '</td>' +
      '<td class="op2-st">' + (o.needs_data ? '<span class="op2-nd" title="под данные"></span>' : '') + stChip(o) + '</td>' +
      '</tr>';
  }).join('');
}
/* «новая» - создана за последние 10 минут и ещё не разобрана */
function isFresh(o) {
  if (!o.created_at) return false;
  var t = Date.parse(String(o.created_at).replace(' ', 'T'));
  if (!isFinite(t)) return false;
  return (Date.now() - t) < 10 * 60 * 1000 && !oOwn(o).length && !oHired(o);
}

/* ═════════════════════════ СТАТУС В ОДИН КЛИК ═════════════════════════ */
var stTr = null;
function openStPop(chip, tr) {
  stTr = tr;
  var o = byId(tr.dataset.oid);
  var cur = o ? oSt(o) : 'nz';
  var sp = $('#op2-stpop');
  sp.innerHTML = Object.keys(ST_M).map(function (k) {
    return '<button data-st="' + k + '" class="' + (k === cur ? 'op2-cur' : '') + '"><span class="op2-st-chip op2-' + k + '">' + esc(ST_M[k]) + '</span>' +
      (k === cur ? '<span class="op2-dim op2-sm">сейчас</span>' : '') + '</button>';
  }).join('');
  var r = chip.getBoundingClientRect();
  sp.style.left = Math.min(r.left, window.innerWidth - 230) + 'px';
  sp.style.top = (r.bottom + 4) + 'px';
  sp.classList.add('op2-open');
}
function closeStPop() { var sp = $('#op2-stpop'); if (sp) sp.classList.remove('op2-open'); stTr = null; }
function setStatusUi(tr, k) {
  var o = byId(tr.dataset.oid); if (!o) return;
  setStatus(o, k);
}
function setStatus(o, k) {
  var prev = oSt(o);
  if (prev === k) return;
  apiPost('/orders/status', { id: o.id, status: ST_API[k] }).then(function (r) {
    if (!ok_(r)) return;
    o.status = ST_API[k];
    if (k === 'ot') { o.otboy_ack_by = null; o.otboy_ack_at = null; }
    renderAll();
    if (k === 'ok') S.tickUp(); else if (k === 'ot') S.tickDown(); else S.toggle();
    toast('Заявка №' + esc(oNo(o)) + ': <span class="' + (k === 'ot' ? 'op2-bad' : k === 'ok' ? 'op2-tick' : 'op2-warn') + '">' + esc(ST_M[k] || ST_LABEL[k]) + '</span>' +
      (k === 'ot' ? ' · у логистов строка мигает, пока не примут отбой' : ' · логисты видят сразу'),
      function () { apiPost('/orders/status', { id: o.id, status: ST_API[prev] }).then(function (r2) { if (ok_(r2)) { o.status = ST_API[prev]; renderAll(); } }); });
  });
}

/* ═════════════════════════ КЛИКИ В ТАБЛИЦЕ ЛОГИСТА ═════════════════════════ */
function onLogClick(e) {
  var dk = e.target.closest('.op2-dok');
  var un = e.target.closest('.op2-unset-ot');
  var slot = e.target.closest('.op2-slot');
  var veh = e.target.closest('.op2-veh');

  if (dk) {
    var od = byId(dk.dataset.oid); if (!od) return;
    var vd = execById(od, dk.dataset.eid); if (!vd) return;
    var was = !!vd.driver_confirmed_at;
    apiPost('/orders/executor_confirm', { executor_id: vd.id, on: was ? 0 : 1 }).then(function (r) {
      if (!ok_(r)) return;
      if (was) S.tickDown(); else S.tickUp();
      toast(was ? 'Подтверждение водителя по №' + esc(oNo(od)) + ' снято'
        : 'Водитель <span class="op2-tick">' + esc(vd.driver_name || '') + ' подтвердил</span> заявку №' + esc(oNo(od)) + ' · у менеджера госномер зелёный',
        function () { apiPost('/orders/executor_confirm', { executor_id: vd.id, on: was ? 1 : 0 }).then(function (r2) { if (ok_(r2)) loadOrders(); }); });
      loadOrders();
    });
    return;
  }
  if (un) {
    var ou = byId(un.dataset.oid); if (!ou) return;
    var list = oOwn(ou);
    if (!list.length) return;
    var gosList = list.map(function (v) { return v.vehicle_gos; }).join(', ');
    var firstGos = list[0].vehicle_gos;
    Promise.all(list.map(function (v) { return apiPost('/orders/executor_remove', { executor_id: v.id }); })).then(function (rs) {
      if (!rs.every(function (r) { return r && r.ok && r.data && !r.data.error; })) { ok_(rs[0], null, 'снять машину не удалось'); return; }
      S.tickDown();
      toast('Снято ' + esc(gosList) + ' с заявки №' + esc(oNo(ou)) + ' · машина свободна, с ленты убрана',
        function () { apiPost('/orders/executor_set', { order_id: ou.id, gos: firstGos, mode: 'replace' }).then(function (r2) { if (ok_(r2)) loadOrders(); }); });
      loadOrders();
    });
    return;
  }
  if (slot && slot.dataset.ot) {
    var oo = byId(slot.dataset.oid); if (!oo) return;
    apiPost('/orders/otboy_ack', { id: oo.id }).then(function (r) {
      if (!ok_(r)) return;
      S.tickUp();
      if (oOwn(oo).length) toast('Отбой по №' + esc(oNo(oo)) + ' принят · <span class="op2-warn">' + esc(oOwn(oo)[0].vehicle_gos || '') + ' ещё стоит на этой заявке</span> - сними машину', null, 7000);
      else toast('Отбой по №' + esc(oNo(oo)) + ' принят <span class="op2-tick">✓</span> · менеджер видит, что логист в курсе');
      loadOrders();
    });
    return;
  }
  if (slot) {
    var o = byId(slot.dataset.oid); if (!o) return;
    if (e.target.classList.contains('op2-take') && !o.taken_by_name) {
      apiPost('/orders/take', { id: o.id }).then(function (r) {
        if (!ok_(r)) return;
        S.tickUp();
        toast('Взял в работу заявку №' + esc(oNo(o)) + ' · <span class="op2-tick">видно всем логистам</span>');
        loadOrders();
      });
      return;
    }
    openPop(slot, o);
    return;
  }
  if (veh) {
    if (mv.suppress) { mv.suppress = false; return; }
    var o2 = byId(veh.dataset.oid); if (!o2) return;
    openPop(veh, o2);
    return;
  }
  var tr = e.target.closest('tr[data-oid]');
  if (tr) { var o3 = byId(tr.dataset.oid); if (o3) openDrawerView(o3, 'log'); }
}

/* ═════════════════════════ СВОЁ КОНТЕКСТНОЕ МЕНЮ ═════════════════════════ */
function closeRowMenu() { var m = $('#op2-row-menu'); if (m) m.remove(); }
function openRowMenu(x, y, items) {
  closeRowMenu();
  var m = document.createElement('div');
  m.className = 'op2-stpop op2-open';
  m.id = 'op2-row-menu';
  m.innerHTML = items.map(function (it, i) { return '<button data-i="' + i + '">' + esc(it.label) + '</button>'; }).join('');
  $('#op2-root').appendChild(m);
  m.style.left = Math.min(x, window.innerWidth - 240) + 'px';
  m.style.top = Math.min(y, window.innerHeight - (items.length * 34 + 24)) + 'px';
  m.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var it = items[+b.dataset.i];
    closeRowMenu();
    if (it && it.fn) { S.nav(); it.fn(); }
  });
}
function mgrRowMenu(o) {
  return [
    { label: 'Повторить', fn: function () { openDrawerForm(o, true, 'mgr'); } },
    { label: 'Повторить на несколько дней', fn: function () { openRepeatN(o); } },
    { label: 'Отбой', fn: function () { setStatus(o, 'ot'); } },
    { label: 'Копировать данные на пропуск', fn: function () { copyText(passText(o), 'Данные на пропуск скопированы'); } }
  ];
}
function logRowMenu(o) {
  var items = [];
  if (!o.taken_by_name) items.push({ label: 'Беру в работу', fn: function () { apiPost('/orders/take', { id: o.id }).then(function (r) { if (ok_(r)) { S.tickUp(); toast('Взял в работу заявку №' + esc(oNo(o))); loadOrders(); } }); } });
  items.push({ label: 'Добавить вторую машину', fn: function () { var tr = $('#op2-log-body tr[data-oid="' + o.id + '"]'); openPop(tr || $('#op2-log-body'), o, true); } });
  items.push({ label: 'Все заявки этой машины →', fn: function () { showByVehicle(o); } });
  items.push({ label: 'История', fn: function () { openDrawerView(o, 'log', true); } });
  return items;
}
function showByVehicle(o) {
  var v = oOwn(o)[0];
  if (!v || !v.vehicle_gos) { toast('<span class="op2-warn">На заявке нет своей машины</span>'); return; }
  apiGet('/orders/by_vehicle', { gos: v.vehicle_gos }).then(function (r) {
    if (!ok_(r)) return;
    var list = (r.data.orders || r.data.list || []);
    if (!list.length) { toast('По ' + esc(v.vehicle_gos) + ' других заявок нет'); return; }
    toast('<span class="op2-mono">' + esc(v.vehicle_gos) + '</span> · ' + list.length + ' ' + plural(list.length, 'заявка', 'заявки', 'заявок') + ': ' +
      esc(list.slice(0, 6).map(function (x) { return dm(x.service_date) + ' №' + (x.day_no != null ? x.day_no : x.id) + (x.service_time ? ' ' + shortTime(x.service_time) : ''); }).join(' · ')), null, 9000);
  });
}

/* ═════════════════════════ ПИКЕР МАШИН ═════════════════════════ */
var popOrder = null, popAdd = false, popVeh = [], popSelGos = '', popHiredDraft = null;
function openPop(anchor, o, forceAdd) {
  popOrder = o; popAdd = !!forceAdd; popSelGos = ''; popHiredDraft = null;
  var pop = $('#op2-pop');
  pop.classList.remove('op2-hired');
  $('#op2-pop-back').classList.add('op2-hidden');
  $('#op2-pop-ctx').textContent = (o.equipment_type || 'техника') + ' · ' + (oTime(o) || 'время уточнить');
  var vs = oOwn(o);
  $('#op2-pop-cur').innerHTML = vs.length
    ? 'Сейчас: <b>' + esc(vs.map(function (v) { return v.vehicle_gos; }).join(', ')) + '</b>'
    : 'Сейчас: <b>без машины</b>' + (o.taken_by_name ? ' · взял ' + esc(o.taken_by_name) : '');
  var ok = $('#op2-pop-ok');
  ok.className = 'op2-dbtn op2-primary op2-blocked';
  ok.textContent = vs.length && !popAdd ? 'Выбери замену или «Снять»' : 'Выбери машину';
  $('#op2-pop-body').innerHTML = '<div class="op2-sec"><span>загружаем парк…</span><span class="op2-ln"></span></div>';

  var r = anchor.getBoundingClientRect();
  var x = Math.min(r.left, window.innerWidth - 392), y = r.bottom + 6;
  if (y + Math.min(window.innerHeight * .6, 480) > window.innerHeight) y = Math.max(8, r.top - Math.min(window.innerHeight * .6, 480) - 6);
  pop.style.left = Math.max(8, x) + 'px';
  pop.style.top = y + 'px';
  pop.classList.add('op2-open');
  setTimeout(function () { var s = $('#op2-pop-search'); if (s) { s.value = ''; s.focus(); } }, 30);

  apiGet('/orders/vehicles', { date: o.service_date || DATE, time: oTime(o) }).then(function (res) {
    if (!res || !res.ok || !res.data || res.data.error) { popVeh = []; ok_(res, null, 'парк не загрузился'); renderPop(''); return; }
    popVeh = res.data.vehicles || [];
    renderPop('');
  }).catch(function () { popVeh = []; renderPop(''); });
}
function closePop() { var p = $('#op2-pop'); if (p) p.classList.remove('op2-open'); popOrder = null; }
function renderPop(q) {
  var o = popOrder; if (!o) return;
  q = String(q || '').toLowerCase().replace(/\s/g, '');
  function match(v) {
    return !q || String(v.gos || '').replace(/\s/g, '').toLowerCase().indexOf(q) >= 0 || String(v.driver || '').toLowerCase().indexOf(q) >= 0;
  }
  var oSeg = segOf(o.equipment_type);
  var free = popVeh.filter(function (v) { return v.state === 'free' && match(v); })
    .sort(function (a, b) { return (segOf(a.type) === oSeg ? 0 : 1) - (segOf(b.type) === oSeg ? 0 : 1); });
  var busy = popVeh.filter(function (v) { return v.state === 'busy' && match(v); });
  var nodrv = popVeh.filter(function (v) { return v.state === 'nodriver' && match(v); });
  var rep = popVeh.filter(function (v) { return v.state === 'repair' && match(v); });
  function item(v, extra, off) {
    return '<div class="op2-vi' + (off ? ' op2-off' : '') + '" data-gos="' + esc(v.gos) + '">' +
      '<span class="op2-gos">' + esc(v.gos) + '</span>' +
      '<span class="op2-ty">' + esc([v.marka, v.type].filter(Boolean).join(' · ')) + '</span>' +
      '<span class="op2-rt">' + extra + '</span></div>';
  }
  function sec(title, n) { return '<div class="op2-sec"><span>' + esc(title) + '</span><span class="op2-ln"></span><span>' + n + '</span></div>'; }
  var vs = oOwn(o);
  var h = '';
  if (o.needs_data && vs.length) {
    h += sec('Заявленные · данные у заказчика', vs.length) + vs.map(function (v) {
      var role = v.role === 'reserve' ? 'резерв' : 'основная';
      return '<div class="op2-vi" data-gos="' + esc(v.vehicle_gos) + '" data-declared="1">' +
        '<span class="op2-gos">' + esc(v.vehicle_gos) + '</span><span class="op2-ty">' + esc(role) + '</span>' +
        '<span class="op2-rt"><b>' + esc(v.driver_name || '') + '</b> · ' + (v.role === 'reserve' ? 'сделать основной' : 'основная сейчас') + '</span></div>';
    }).join('');
  }
  if (vs.length) {
    h += '<div class="op2-vi op2-act" data-act="unset"><span class="op2-gos">Снять ' + esc(vs[0].vehicle_gos || '') + '</span><span class="op2-rt">строка вернётся в «без машины»</span></div>' +
      '<div class="op2-vi op2-act' + (popAdd ? ' op2-sel' : '') + '" data-act="add"><span class="op2-gos">Добавить вторую машину</span></div>';
  }
  h += sec('Свободны ' + (oTime(o) || ''), free.length) + free.map(function (v) {
    return item(v, '<b>' + esc(v.driver || 'без водителя') + '</b>' + (v.trailer ? ' · ' + esc(v.trailer) : '') + (v.trips_today ? '<br>рейсов сегодня: ' + esc(v.trips_today) : ''));
  }).join('');
  h += sec('Заняты в это время', busy.length) + busy.map(function (v) {
    return item(v, '<b>' + esc(v.driver || '') + '</b> · рейс ' + esc(v.busy || ''));
  }).join('');
  h += sec('Без водителя', nodrv.length) + nodrv.map(function (v) { return item(v, 'нет водителя в системе', true); }).join('');
  h += sec('Ремонт, ТО', rep.length) + rep.map(function (v) { return item(v, esc(v.busy || 'ремонт'), true); }).join('');
  h += '<div class="op2-vi op2-hired-item" data-act="hired"><span class="op2-gos">Наёмник →</span><span class="op2-rt">компания · госномер · водитель · ставка</span></div>';
  $('#op2-pop-body').innerHTML = h;
}
function onPopBodyClick(e) {
  var it = e.target.closest('.op2-vi'); if (!it || it.classList.contains('op2-off')) return;
  var o = popOrder; if (!o) return;
  var act = it.dataset.act;
  if (act === 'hired') { openHiredStep(o); return; }
  if (act === 'unset') {
    var vs = oOwn(o); if (!vs.length) return;
    var gos0 = vs[0].vehicle_gos;
    var no = oNo(o);
    Promise.all(vs.map(function (v) { return apiPost('/orders/executor_remove', { executor_id: v.id }); })).then(function (rs) {
      if (!rs.every(function (r) { return r && r.ok && r.data && !r.data.error; })) { ok_(rs[0], null, 'снять машину не удалось'); return; }
      closePop(); S.tickDown();
      toast('Снято ' + esc(gos0) + ' · заявка №' + esc(no) + ' снова без машины · менеджеру ушло уведомление',
        function () { apiPost('/orders/executor_set', { order_id: o.id, gos: gos0, mode: 'replace' }).then(function (r2) { if (ok_(r2)) loadOrders(); }); });
      loadOrders();
    });
    return;
  }
  if (act === 'add') {
    popAdd = true; popSelGos = '';
    $$('.op2-vi', this).forEach(function (x) { x.classList.remove('op2-sel'); });
    it.classList.add('op2-sel');
    var okb = $('#op2-pop-ok'); okb.className = 'op2-dbtn op2-primary op2-blocked'; okb.textContent = 'Выбери вторую машину';
    return;
  }
  $$('.op2-vi', this).forEach(function (x) { x.classList.remove('op2-sel'); });
  it.classList.add('op2-sel');
  popSelGos = it.dataset.gos;
  var v = popVeh.filter(function (x) { return x.gos === popSelGos; })[0] || { gos: popSelGos, driver: '', state: 'free' };
  var declared = it.dataset.declared === '1';
  var vs2 = oOwn(o);
  var outside = !!(o.needs_data && vs2.length && !declared && !popAdd);
  var ok = $('#op2-pop-ok');
  ok.className = 'op2-dbtn op2-primary' + ((v.state === 'busy' || outside) ? ' op2-warn' : '');
  if (declared) {
    ok.textContent = 'Сделать основной ' + v.gos + ' · из заявленных, без нового пропуска';
  } else {
    ok.textContent = (vs2.length && !popAdd ? 'Заменить ' + (vs2[0].vehicle_gos || '') + ' → ' : 'Поставить ') + v.gos +
      (v.driver ? ' · ' + v.driver : '') + (oTime(o) ? ' на ' + oTime(o) : '') +
      (v.state === 'busy' ? ' (занята)' : '') + (outside ? ' · вне заявленных - нужен новый пропуск' : '');
  }
  ok.dataset.gos = v.gos;
  ok.dataset.declared = declared ? '1' : '';
  ok.dataset.outside = outside ? '1' : '';
}
function onPopOk() {
  var o = popOrder; if (!o) return;
  if (this.classList.contains('op2-blocked')) { toast('<span class="op2-warn">Сначала выбери машину</span> из списка или «Наёмник»'); return; }
  if ($('#op2-pop').classList.contains('op2-hired')) { saveHired(o); return; }
  var gos = this.dataset.gos;
  var declared = this.dataset.declared === '1';
  var outside = this.dataset.outside === '1';
  var mode = popAdd ? 'add' : 'replace';
  var no = oNo(o);
  var v = popVeh.filter(function (x) { return x.gos === gos; })[0] || { gos: gos, driver: '' };
  apiPost('/orders/executor_set', { order_id: o.id, gos: gos, mode: mode }).then(function (r) {
    if (r && r.data && r.data.error && String(r.data.error).length) {
      /* 409 - на заявке отбой, ставить машину нельзя */
      S.attention();
      toast('<span class="op2-bad">' + esc(r.data.error) + '</span>');
      return;
    }
    if (!ok_(r)) return;
    var d = r.data;
    closePop();
    loadOrders();
    if (d.pending) {
      /* под данные, машина вне заявленных: сами не меняем - запрос менеджеру */
      S.attention();
      toast('Запрос на замену: <span class="op2-warn">' + esc(gos) + (v.driver ? ' · ' + esc(v.driver) : '') + '</span> · заявка №' + esc(no) +
        ' под данные · <b>менеджер согласует с заказчиком</b>', null, 9000);
      return;
    }
    if (d.swapped || declared) {
      S.tickUp();
      toast('Основная теперь <span class="op2-tick">' + esc(gos) + (v.driver ? ' · ' + esc(v.driver) : '') + '</span> · из заявленных, пропуск действует');
      return;
    }
    S.tickUp();
    var exec = d.executor || null;
    var t = toast('Поставлено <span class="op2-tick">' + esc(gos) + (v.driver ? ' · ' + esc(v.driver) : '') + '</span> на заявку №' + esc(no) +
      (o.needs_data && mode === 'add' ? ' как резерв' : '') + ' · менеджеру ушло уведомление',
      exec ? function () { apiPost('/orders/executor_remove', { executor_id: exec.id }).then(function (r2) { if (ok_(r2)) loadOrders(); }); } : null, 9000);
    if (t) {
      var tb = document.createElement('button');
      tb.textContent = 'Задание водителю →';
      tb.onclick = function () { hideToast(); apiGet('/orders/one', { id: o.id }).then(function (r3) { openDrv((r3 && r3.data && r3.data.order) || o); }); };
      t.appendChild(tb);
    }
    if (outside) { /* сервер разрешил - предупреждение всё равно показываем отдельно */
      setTimeout(function () { toast('<span class="op2-warn">Заявка под данные</span> · заказчику нужен новый пропуск на ' + esc(gos), null, 8000); }, 600);
    }
  });
}
/* второй шаг пикера - наёмник */
function openHiredStep(o) {
  var pop = $('#op2-pop');
  pop.classList.add('op2-hired');
  $('#op2-pop-back').classList.remove('op2-hidden');
  var h = oHired(o) || {};
  var statuses = ['договариваюсь', 'подтвердил', 'выехал', 'отказался'];
  $('#op2-hstep').innerHTML =
    '<div class="op2-fld"><label>Компания-перевозчик</label><input id="op2-h-co" autocomplete="off" placeholder="Название перевозчика" value="' + esc(h.carrier_name || '') + '"><span class="op2-hint">Из справочника перевозчиков</span></div>' +
    '<div class="op2-g2">' +
      '<div class="op2-fld"><label>Контакт у перевозчика</label><input id="op2-h-contact" autocomplete="off" placeholder="Имя · телефон" value="' + esc(h.carrier_contact || '') + '"></div>' +
      '<div class="op2-fld"><label>Статус перевозчика</label><div class="op2-cstat" id="op2-h-cs">' +
        statuses.map(function (s) { return '<button class="op2-chip' + ((h.carrier_status || 'договариваюсь') === s ? ' op2-on' : '') + '" data-cs="' + esc(s) + '">' + esc(s) + '</button>'; }).join('') +
      '</div></div>' +
      '<div class="op2-fld"><label>Госномер тягача</label><input id="op2-h-gos" class="op2-mono" autocomplete="off" placeholder="Н 123 АВ 790" value="' + esc(h.vehicle_gos || '') + '"></div>' +
      '<div class="op2-fld"><label>Госномер прицепа</label><input id="op2-h-trailer" class="op2-mono" autocomplete="off" placeholder="АК 4567 50" value="' + esc(h.trailer_gos || '') + '"></div>' +
      '<div class="op2-fld"><label>Водитель</label><input id="op2-h-drv" autocomplete="off" placeholder="Фамилия Имя Отчество" value="' + esc(h.driver_name || '') + '"></div>' +
      '<div class="op2-fld"><label>Телефон водителя</label><input id="op2-h-phone" class="op2-mono" autocomplete="off" placeholder="+7" value="' + esc(h.driver_phone || '') + '"></div>' +
      '<div class="op2-fld"><label>Ставка закупки, ₽</label><input id="op2-h-rate" class="op2-mono" inputmode="numeric" autocomplete="off" value="' + esc(h.purchase_rate || '') + '"></div>' +
      '<div class="op2-fld"><label>Расчёт</label><input id="op2-h-settle" autocomplete="off" placeholder="Б/н с НДС · наличные · отсрочка" value="' + esc(h.settlement || '') + '"></div>' +
    '</div>' +
    '<div class="op2-margin"><span class="op2-k">Цена менеджера ' + esc(fmtP(o.price) || 'не указана') + ' · маржа</span><span class="op2-v" id="op2-h-margin">—</span></div>' +
    '<div class="op2-fld"><label>Комментарий</label><input id="op2-h-comment" autocomplete="off" placeholder="Что важно знать по перевозчику" value="' + esc(h.comment || '') + '"></div>';
  var ok = $('#op2-pop-ok');
  ok.className = 'op2-dbtn op2-primary';
  ok.textContent = 'Отдать наёмнику';
  function recalc() {
    var m = num(o.price) - num($('#op2-h-rate').value);
    var el = $('#op2-h-margin');
    if (!num(o.price)) { el.textContent = '—'; el.className = 'op2-v'; return; }
    el.textContent = (m >= 0 ? '+' : '−') + fmtP(Math.abs(m));
    el.className = 'op2-v ' + (m >= 0 ? 'op2-pos' : 'op2-neg');
  }
  $('#op2-h-rate').addEventListener('input', recalc);
  $('#op2-h-co').addEventListener('input', function () { $('#op2-pop-ok').textContent = 'Отдать наёмнику' + (this.value.trim() ? ' · ' + this.value.trim() : ''); });
  $('#op2-h-cs').addEventListener('click', function (e) {
    var c = e.target.closest('.op2-chip'); if (!c) return;
    $$('.op2-chip', this).forEach(function (x) { x.classList.remove('op2-on'); });
    c.classList.add('op2-on');
  });
  recalc();
}
function saveHired(o) {
  var co = $('#op2-h-co').value.trim();
  if (!co) { toast('<span class="op2-warn">Впиши компанию-перевозчика</span> · остальное можно потом'); return; }
  var cs = $('#op2-h-cs .op2-chip.op2-on');
  apiPost('/orders/hired_set', {
    order_id: o.id,
    carrier_name: co,
    carrier_contact: $('#op2-h-contact').value.trim(),
    gos: $('#op2-h-gos').value.trim(),
    trailer_gos: $('#op2-h-trailer').value.trim(),
    driver_name: $('#op2-h-drv').value.trim(),
    driver_phone: $('#op2-h-phone').value.trim(),
    purchase_rate: String(num($('#op2-h-rate').value) || ''),
    settlement: $('#op2-h-settle').value.trim(),
    carrier_status: cs ? cs.dataset.cs : '',
    comment: $('#op2-h-comment').value.trim()
  }).then(function (r) {
    if (!ok_(r)) return;
    closePop(); S.tickUp();
    toast('Отдано наёмнику <span class="op2-tick">' + esc(co) + '</span> · заявка №' + esc(oNo(o)) + ' · госномер и водителя допиши, когда подтвердят');
    loadOrders();
  });
}

/* ═════════════════════════ ПЕРЕМЕЩЕНИЕ МАШИНЫ ═════════════════════════
   Зажать плитку 450 мс -> режим перемещения -> отпустить на другой заявке
   (ГОСТ, раздел 6 «Долгое нажатие»). Пусто - перенос, занято - обмен. */
var mv = { timer: null, o: null, src: null, ghost: null, active: false, sx: 0, sy: 0, suppress: false };
function onVehPointerDown(e) {
  var veh = e.target.closest('.op2-veh'); if (!veh || e.button !== 0) return;
  var o = byId(veh.dataset.oid);
  if (!o || !oOwn(o).length || oSt(o) === 'ot') return;
  mv.sx = e.clientX; mv.sy = e.clientY; mv.o = o; mv.src = veh;
  clearTimeout(mv.timer);
  mv.timer = setTimeout(function () { mv.timer = null; startMove(e.clientX, e.clientY); }, 450);
}
function startMove(x, y) {
  mv.active = true; mv.suppress = true;
  closePop();
  document.body.classList.add('op2-moving');
  mv.src.classList.add('op2-lift');
  S.lift();
  if (navigator.vibrate) { try { navigator.vibrate(30); } catch (e) {} }
  var vs = oOwn(mv.o);
  var g = document.createElement('div');
  g.className = 'op2-mvghost';
  g.innerHTML = '<span class="op2-gos">' + esc(vs.map(function (v) { return v.vehicle_gos; }).join(' + ')) + '</span>' +
    '<span class="op2-drv">' + esc(vs.map(function (v) { return v.driver_name || ''; }).filter(Boolean).join(', ')) + ' · с заявки №' + esc(oNo(mv.o)) + '</span>';
  document.body.appendChild(g);
  mv.ghost = g;
  posGhost(x, y);
  toast('Режим перемещения · отпусти на другой заявке · Esc - отмена', null, 60000);
}
function posGhost(x, y) { if (mv.ghost) { mv.ghost.style.left = (x + 14) + 'px'; mv.ghost.style.top = (y + 10) + 'px'; } }
function rowAt(x, y) { var el = document.elementFromPoint(x, y); return el && el.closest('.op2-log-body tr[data-oid]'); }
function endMove() {
  mv.active = false;
  document.body.classList.remove('op2-moving');
  if (mv.src) mv.src.classList.remove('op2-lift');
  if (mv.ghost) mv.ghost.remove();
  mv.ghost = null;
  $$('.op2-log-body tr.op2-drop').forEach(function (r) { r.classList.remove('op2-drop'); });
  hideToast();
}
function onPointerMove(e) {
  if (mv.timer && (Math.abs(e.clientX - mv.sx) > 6 || Math.abs(e.clientY - mv.sy) > 6)) { clearTimeout(mv.timer); mv.timer = null; }
  if (!mv.active) return;
  posGhost(e.clientX, e.clientY);
  $$('.op2-log-body tr.op2-drop').forEach(function (r) { r.classList.remove('op2-drop'); });
  var tr = rowAt(e.clientX, e.clientY);
  if (tr && String(tr.dataset.oid) !== String(mv.o.id) && !tr.classList.contains('op2-otboy')) tr.classList.add('op2-drop');
}
function onPointerUp(e) {
  clearTimeout(mv.timer); mv.timer = null;
  if (!mv.active) return;
  var tr = rowAt(e.clientX, e.clientY);
  var src = mv.o;
  endMove();
  if (!tr || String(tr.dataset.oid) === String(src.id)) { S.tickDown(); toast('Перемещение отменено · машина осталась на №' + esc(oNo(src))); return; }
  var t = byId(tr.dataset.oid); if (!t) return;
  if (oSt(t) === 'ot') { S.attention(); toast('<span class="op2-warn">На заявку с отбоем машину не ставим</span>'); return; }
  S.drop();
  var v = oOwn(src)[0];
  if (!v) return;
  apiPost('/orders/executor_move', { executor_id: v.id, to_order_id: t.id }).then(function (r) {
    if (!ok_(r)) { loadOrders(); return; }
    var d = r.data;
    var msg = d.swapped
      ? 'Поменяли местами: <span class="op2-tick">' + esc(v.vehicle_gos || '') + '</span> → №' + esc(oNo(t)) + ', встречная машина → №' + esc(oNo(src))
      : 'Перенесено <span class="op2-tick">' + esc(v.vehicle_gos || '') + (v.driver_name ? ' · ' + esc(v.driver_name) : '') + '</span> с №' + esc(oNo(src)) + ' на №' + esc(oNo(t)) + ' · №' + esc(oNo(src)) + ' снова без машины';
    if (d.warn_needs_data || src.needs_data || t.needs_data) msg += ' · <span class="op2-warn">под данные - нужен новый пропуск</span>';
    if (segOf(t.equipment_type) && segOf(src.equipment_type) && segOf(t.equipment_type) !== segOf(src.equipment_type)) {
      msg += ' · <span class="op2-warn">тип заявки ' + esc(t.equipment_type) + ', машина с ' + esc(src.equipment_type) + '</span>';
    }
    toast(msg + ' · менеджерам ушло уведомление',
      function () { apiPost('/orders/executor_move', { executor_id: v.id, to_order_id: src.id }).then(function (r2) { if (ok_(r2)) loadOrders(); }); }, 9000);
    loadOrders();
  });
}

/* ═════════════════════════ ТЕКСТЫ: ЗАДАНИЕ ВОДИТЕЛЮ, ПРОПУСК ═════════════════════════ */
function driverText(o) {
  var vs = oOwn(o);
  var h = oHired(o);
  var v = vs[0] || h || null;
  var L = [];
  L.push('ЗАЯВКА №' + oNo(o) + (o.equipment_type ? ' · ' + String(o.equipment_type).toUpperCase() : ''));
  L.push('Подача: ' + weekdayFull(o.service_date) + ' ' + dmy(o.service_date) + ', ' + (oTime(o) || 'время уточняется'));
  if (v) L.push('Машина: ' + (v.vehicle_gos || 'уточнить') + ' · водитель ' + (v.driver_name || 'уточнить'));
  L.push('');
  L.push('Груз: ' + (o.cargo || 'уточнить') + (o.cargo_weight_t ? ', ' + o.cargo_weight_t + ' т' : '') + ' · ' + String(o.gabarit || 'габарит').toLowerCase());
  if (o.cargo_dims) L.push('Габариты: ' + o.cargo_dims);
  L.push('Документы: ' + (o.documents || 'уточнить'));
  L.push('Переработка: ' + String(o.rework_terms || 'по согласованию с логистом').toLowerCase());
  L.push('');
  L.push('ПОГРУЗКА');
  L.push(o.load_address || 'адрес уточняется');
  if (o.load_lat && o.load_lon) L.push('Карта: https://yandex.ru/maps/?pt=' + o.load_lon + ',' + o.load_lat + '&z=17 · ' + o.load_lat + ', ' + o.load_lon);
  if (o.load_contact_name || o.load_contact_phone) L.push([o.load_contact_name, fmtPhone(o.load_contact_phone)].filter(Boolean).join(' · '));
  L.push('');
  L.push('ВЫГРУЗКА');
  L.push(o.unload_address || 'адрес уточняется');
  if (o.unload_lat && o.unload_lon) L.push('Карта: https://yandex.ru/maps/?pt=' + o.unload_lon + ',' + o.unload_lat + '&z=17 · ' + o.unload_lat + ', ' + o.unload_lon);
  if (o.unload_contact_name || o.unload_contact_phone) L.push([o.unload_contact_name, fmtPhone(o.unload_contact_phone)].filter(Boolean).join(' · '));
  if (o.note) { L.push(''); L.push('Примечание: ' + o.note); }
  L.push('');
  L.push('Логист: ' + ((ME && ME.name) || ''));
  return L.join('\n');
}
function passText(o) {
  var v = oOwn(o)[0] || oHired(o) || {};
  var L = [];
  L.push('Заявка №' + oNo(o) + ', ' + dm(o.service_date) + ', подача ' + (oTime(o) || 'уточнить'));
  L.push('Тягач: ' + (v.vehicle_gos || 'уточнить') + (v.trailer_gos ? ', п/п ' + v.trailer_gos : ''));
  L.push('Водитель: ' + (v.driver_name || 'уточнить') + (v.driver_phone ? ', ' + fmtPhone(v.driver_phone) : ''));
  return L.join('\n');
}
function copyText(txt, okMsg) {
  var done = false;
  try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt); done = true; } } catch (e) {}
  if (!done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    } catch (e) {}
  }
  S.tickUp();
  if (okMsg) toast('<span class="op2-tick">' + esc(okMsg) + '</span>');
}
function openDrv(o) {
  var v = oOwn(o)[0] || oHired(o) || { vehicle_gos: 'машина не поставлена', driver_name: '' };
  var txt = driverText(o);
  $('#op2-drv-title').textContent = 'Задание водителю · заявка №' + oNo(o);
  $('#op2-drv-sub').textContent = [v.driver_name, v.vehicle_gos].filter(Boolean).join(' · ');
  $('#op2-drv-txt').innerHTML = esc(txt).replace(/^(ЗАЯВКА №\d+.*|ПОГРУЗКА|ВЫГРУЗКА)$/gm, '<b>$1</b>');
  var phone = String(v.driver_phone || '').replace(/\D/g, '');
  function sent() { if (v.id) apiPost('/orders/executor_task_sent', { executor_id: v.id }).then(function () { loadOrders(); }); }
  var wa = $('#op2-drv-wa');
  wa.href = 'https://wa.me/' + (phone || '') + '?text=' + encodeURIComponent(txt);
  wa.onclick = function () { sent(); };
  /* Max (max.ru): текст в буфер + открыть чат с водителем - прямой ссылки-шаринга у Max нет */
  var mx = $('#op2-drv-max');
  mx.href = 'https://max.ru/';
  mx.onclick = function () { copyText(txt, 'Текст задания скопирован · вставь в чат с ' + (v.driver_name || 'водителем') + ' в Max'); sent(); };
  var tg = $('#op2-drv-tg');
  tg.href = 'https://t.me/share/url?url=' + encodeURIComponent('Заявка №' + oNo(o)) + '&text=' + encodeURIComponent(txt);
  tg.onclick = function () { sent(); };
  var cp = $('#op2-drv-copy');
  cp.textContent = 'Копировать текст';
  cp.onclick = function () { copyText(txt); this.textContent = 'Скопировано ✓'; sent(); };
  $('#op2-drv-scrim').classList.add('op2-open');
}
function closeDrv() { $('#op2-drv-scrim').classList.remove('op2-open'); }

/* ═════════════════════════ ШТОРКА: КАРТОЧКА ═════════════════════════ */
var drawerOrder = null;
function openDrawer() { $('#op2-drawer').classList.add('op2-open'); $('#op2-scrim').classList.add('op2-open'); }
function closeDrawer() {
  var d = $('#op2-drawer'); if (!d) return;
  d.classList.remove('op2-open');
  $('#op2-scrim').classList.remove('op2-open');
  $$('.op2-log-body tr.op2-open,#op2-mgr-body tr.op2-open').forEach(function (r) { r.classList.remove('op2-open'); });
  drawerOrder = null;
}
function openDrawerView(o, who, withHistory) {
  drawerOrder = o;
  formMode = false; formOrder = null; formRepeat = false;
  openDrawer();
  renderView(o, who);
  /* свежая копия заявки и история - отдельными запросами, экран не ждёт их */
  apiGet('/orders/one', { id: o.id }).then(function (r) {
    if (r && r.ok && r.data && r.data.order && drawerOrder && String(drawerOrder.id) === String(o.id)) {
      drawerOrder = r.data.order;
      renderView(drawerOrder, who);
      loadHistoryInto(drawerOrder);
    }
  }).catch(function () {});
  if (withHistory) loadHistoryInto(o);
}
function loadHistoryInto(o) {
  apiGet('/orders/history', { id: o.id }).then(function (r) {
    if (!r || !r.ok || !r.data || r.data.error) return;
    var box = $('#op2-hist-box'); if (!box) return;
    var h = r.data.history || [];
    box.innerHTML = h.length ? h.map(function (x) {
      return '<li><span class="op2-tm">' + esc(x.at || '') + '</span><span><span class="op2-who">' + esc(x.by || '') + '</span> ' + esc(x.action || '') + (x.detail ? ' · ' + esc(x.detail) : '') + '</span></li>';
    }).join('') : '<li><span class="op2-dim">записей пока нет</span></li>';
  }).catch(function () {});
}
function renderView(o, who) {
  var isLog = who === 'log';
  var k = oSt(o);
  var vs = oOwn(o), h = oHired(o), v = vs[0];
  $('#op2-d-title').textContent = 'Заявка №' + oNo(o) + ' · ' + (o.customer || '');
  $('#op2-d-sub').textContent = humanDate(o.service_date) + (oTime(o) ? ' · ' + oTime(o) : ' · время уточнить') +
    (o.equipment_type ? ' · ' + o.equipment_type : '') + (oMgrCode(o) ? ' · менеджер ' + oMgrCode(o) : '');

  var vehHtml;
  if (h) {
    var marg = num(o.price) - num(h.purchase_rate);
    vehHtml = '<div class="op2-vehcard"><div class="op2-top"><span class="op2-hire">Наёмник</span><span class="op2-gos">' + esc(h.vehicle_gos || 'госномер уточняется') + '</span>' +
      (o.taken_by_name ? '<span class="op2-by">взял ' + esc(o.taken_by_name) + '</span>' : '') + '</div>' +
      '<div class="op2-line"><span><span class="op2-k">Компания</span> ' + esc(h.carrier_name || 'уточнить') + '</span>' +
      '<span><span class="op2-k">Водитель</span> ' + esc(h.driver_name || 'уточнить') + '</span>' +
      '<span><span class="op2-k">Статус перевозчика</span> ' + esc(h.carrier_status || 'уточнить') + '</span></div>' +
      '<div class="op2-line"><span><span class="op2-k">Закупка</span> <span class="op2-mono">' + esc(fmtP(h.purchase_rate) || '—') + '</span></span>' +
      (num(o.price) && num(h.purchase_rate) ? '<span><span class="op2-k">Маржа</span> <span class="op2-mono" style="color:var(--' + (marg >= 0 ? 'tint-green' : 'tint-red') + ')">' + (marg >= 0 ? '+' : '−') + esc(fmtP(Math.abs(marg))) + '</span></span>' : '') + '</div>' +
      '<div class="op2-acts"><button class="op2-ghost op2-copybtn" data-copy="pass">Копировать данные на пропуск</button>' +
      '<button class="op2-dbtn op2-primary" id="op2-d-drv">Задание водителю</button></div></div>';
  } else if (v) {
    var okTxt = v.driver_confirmed_at
      ? ' · <span style="color:var(--tint-green)">водитель подтвердил ' + esc([v.driver_confirmed_by, hhmmOf(v.driver_confirmed_at)].filter(Boolean).join(' ')) + '</span>'
      : ' · <span class="op2-dim">водитель ещё не подтвердил</span>';
    vehHtml = '<div class="op2-vehcard"><div class="op2-top">' +
      '<span class="op2-gos' + (v.driver_confirmed_at ? ' op2-ok' : '') + '">' + esc(v.vehicle_gos || '') + '</span>' +
      (o.equipment_type ? '<span class="op2-ttype">' + esc(o.equipment_type) + '</span>' : '') +
      '<span class="op2-by">' + okTxt + '</span></div>' +
      '<div class="op2-line"><span><span class="op2-k">Водитель</span> ' + esc(v.driver_name || 'уточнить') + '</span>' +
      '<span><span class="op2-k">Телефон</span> ' + (v.driver_phone ? '<a class="op2-tel op2-mono" href="tel:' + esc(String(v.driver_phone).replace(/[^\d+]/g, '')) + '">' + esc(fmtPhone(v.driver_phone)) + '</a>' : '<span class="op2-dim">уточнить</span>') + '</span>' +
      '<span><span class="op2-k">Прицеп</span> <span class="op2-mono">' + esc(v.trailer_gos || '—') + '</span></span></div>' +
      (vs[1] ? '<div class="op2-line"><span class="op2-k">' + (o.needs_data ? 'Резерв' : '+ вторая машина') + '</span> <span class="op2-mono">' + esc(vs[1].vehicle_gos || '') + '</span> · ' + esc(vs[1].driver_name || '') + '</div>' : '') +
      (o.needs_data ? '<div class="op2-line"><span class="op2-nd"></span><span class="op2-k">Под данные</span> данные обоих водителей у заказчика · замена только из заявленных, вне списка - новый пропуск' +
        (o.needs_data_sent_at ? ' · отправлено ' + esc(o.needs_data_sent_at) : '') + '</div>' : '') +
      '<div class="op2-line op2-docs"><span class="op2-k">Документы</span>' +
        '<button class="op2-ghost op2-dl op2-soon" data-doc="СТС тягача ' + esc(v.vehicle_gos || '') + '">СТС тягача ⤓</button>' +
        '<button class="op2-ghost op2-dl op2-soon" data-doc="СТС прицепа ' + esc(v.trailer_gos || '') + '">СТС прицепа ⤓</button>' +
        '<button class="op2-ghost op2-dl op2-soon" data-doc="Паспорт ' + esc(v.driver_name || '') + '">Паспорт водителя ⤓</button>' +
        '<button class="op2-ghost op2-dl op2-soon" data-doc="Паспортные данные текстом">Паспортные данные текстом</button>' +
      '</div>' +
      '<div class="op2-acts"><button class="op2-ghost op2-copybtn" data-copy="pass">Копировать данные на пропуск</button>' +
      '<button class="op2-dbtn op2-primary" id="op2-d-drv">Задание водителю</button>' +
      (isLog ? '<button class="op2-ghost" id="op2-d-drv-ok" data-eid="' + esc(v.id) + '">' + (v.driver_confirmed_at ? 'Снять подтверждение водителя' : 'Водитель подтвердил') + '</button>' : '') +
      '</div></div>';
  } else if (k === 'ot') {
    vehHtml = '<div class="op2-vehcard"><div class="op2-top"><span class="op2-bad" style="color:var(--tint-red);font-weight:600">Отбой</span>' +
      '<span class="op2-dim">' + (o.otboy_ack_by ? 'логист принял · ' + esc(o.otboy_ack_by) : 'логист ещё не принял') + '</span></div>' +
      '<div class="op2-line op2-dim">Машину на отбой поставить нельзя</div></div>';
  } else {
    vehHtml = '<div class="op2-vehcard"><div class="op2-top"><span class="op2-dim">Машину ещё не поставили' + (o.taken_by_name ? ' · принял ' + esc(o.taken_by_name) : '') + '</span></div>' +
      (isLog ? '<div class="op2-acts"><button class="op2-dbtn op2-primary" id="op2-d-put">Поставить машину</button>' +
        (o.taken_by_name ? '' : '<button class="op2-ghost" id="op2-d-take">Беру в работу</button>') + '</div>' : '') + '</div>';
  }

  var stSeg = !isLog ? '<div class="op2-sect"><div class="op2-t">Статус</div><div class="op2-seg" id="op2-d-st">' +
    Object.keys(ST_M).map(function (kk) { return '<button class="op2-chip' + (k === kk ? ' op2-on' : '') + '" data-st="' + kk + '">' + esc(ST_M[kk]) + '</button>'; }).join('') +
    '<span class="op2-hint op2-dim" style="align-self:center;margin-left:6px">один клик · логисты видят сразу</span></div></div>' : '';

  var p = o.pending_request;
  var pendBar = p ? '<div class="op2-cbar op2-pendbar"><div class="op2-grow"><b>' +
    (isLog ? 'Ждёт менеджера · замена' : 'Логист ' + esc(p.requested_by_name || '') + ' предлагает замену') + '</b> · <span class="op2-mono">' + esc(p.from_gos || '') + '</span> → <span class="op2-mono">' + esc(p.to_gos || '') + '</span>' +
    (p.to_driver_name ? ' ' + esc(p.to_driver_name) : '') + (p.requested_at ? ' · ' + esc(p.requested_at) : '') +
    ' · заявка под данные: данные на пропуск изменятся, нужно согласие заказчика</div>' +
    (isLog ? '<span class="op2-dim op2-sm">до ответа менеджера едет ' + esc(p.from_gos || '') + ' · позвони, если срочно</span>'
      : '<button class="op2-dbtn op2-primary" id="op2-d-approve">Подтвердить · заказчик согласен</button>' +
        '<button class="op2-ghost op2-red" id="op2-d-reject">Отклонить · едет ' + esc(p.from_gos || '') + '</button>') +
    '</div>' : '';

  function kv(k2, v2) { return '<div class="op2-kv"><span class="op2-k">' + esc(k2) + '</span><span class="op2-v">' + v2 + '</span></div>'; }
  function val(x) { return x ? esc(x) : '<span class="op2-dim">уточнить</span>'; }
  var entName = '';
  if (META && o.executor_entity_id) {
    (META.own_entities || []).forEach(function (e2) { if (String(e2.id) === String(o.executor_entity_id)) entName = e2.name; });
  }

  $('#op2-d-body').innerHTML = pendBar + stSeg +
    '<div class="op2-sect"><div class="op2-t">Машина · водитель</div>' + vehHtml + '</div>' +
    '<div class="op2-sect"><div class="op2-t">Груз и точки</div>' +
      kv('Груз', val([o.cargo, o.cargo_weight_t ? o.cargo_weight_t + ' т' : ''].filter(Boolean).join(', '))) +
      (o.cargo_dims ? kv('Габариты груза', val(o.cargo_dims)) : '') +
      kv('Габарит', val(o.gabarit)) +
      kv('Погрузка', val(o.load_address) + (o.load_lat && o.load_lon ? ' <span class="op2-sm op2-dim op2-mono">· ' + esc(o.load_lat) + ' · ' + esc(o.load_lon) + '</span>' : (o.load_address && (o.load_confirmed === 0 || o.load_confirmed === false) ? ' <span class="op2-sm" style="color:var(--tint-amber)">· адрес не подтверждён</span>' : ''))) +
      kv('Контакт на погрузке', val([o.load_contact_name, fmtPhone(o.load_contact_phone)].filter(Boolean).join(' · '))) +
      kv('Выгрузка', val(o.unload_address) + (o.unload_lat && o.unload_lon ? ' <span class="op2-sm op2-dim op2-mono">· ' + esc(o.unload_lat) + ' · ' + esc(o.unload_lon) + '</span>' : '')) +
      kv('Контакт на выгрузке', val([o.unload_contact_name, fmtPhone(o.unload_contact_phone)].filter(Boolean).join(' · '))) +
      kv('Контакт заказчика', val([o.customer_contact_name, fmtPhone(o.customer_contact_phone)].filter(Boolean).join(' · '))) +
      kv('Документы', val(o.documents)) +
      kv('Переработка', val(o.rework_terms)) +
      kv('Исполнитель (от кого)', val(entName) + ' <span class="op2-sm op2-dim">· реквизиты, печать и подпись в договор-заявку</span>') +
      kv('Стоимость', '<span class="op2-mono">' + (num(o.price) ? esc(fmtP(o.price)) : '<span class="op2-dim">не указана</span>') + (o.cash ? ' · наличные' : '') + '</span>') +
      kv('Статус оплаты', val(o.payment_status)) +
      kv('Примечание', o.note ? esc(o.note) : '<span class="op2-dim">—</span>') +
    '</div>' +
    '<div class="op2-sect"><div class="op2-t">История</div><ul class="op2-hist" id="op2-hist-box"><li><span class="op2-dim">загружаем…</span></li></ul></div>';

  $('#op2-d-foot').innerHTML = (isLog
    ? '<button class="op2-del" id="op2-d-otboy">Отбой по заявке</button>' + (canDone() ? '<button class="op2-ghost" id="op2-d-done">Выполнено</button>' : '')
    : '<button class="op2-del" id="op2-d-otboy">Отбой</button>' +
      '<button class="op2-ghost" id="op2-d-contract" title="Разовая договор-заявка заказчику: реквизиты, табличная часть, условия, печать и подпись - из заявки">Договор-заявка ⤓</button>' +
      '<button class="op2-ghost" id="op2-d-repeat">Повторить</button>' +
      '<button class="op2-ghost" id="op2-d-repeat-n">Повторить на несколько дней</button>') +
    '<button class="op2-dbtn op2-primary" id="op2-d-edit">Редактировать</button>';

  /* обработчики тела карточки */
  var body = $('#op2-d-body');
  var put = $('#op2-d-put');
  if (put) put.addEventListener('click', function () { closeDrawer(); var s = $('#op2-log-body .op2-slot[data-oid="' + o.id + '"]'); if (s) openPop(s, o); });
  var take = $('#op2-d-take');
  if (take) take.addEventListener('click', function () { apiPost('/orders/take', { id: o.id }).then(function (r) { if (ok_(r)) { S.tickUp(); toast('Взял в работу заявку №' + esc(oNo(o))); loadOrders(); openDrawerView(o, who); } }); });
  var dd = $('#op2-d-drv');
  if (dd) dd.addEventListener('click', function () { openDrv(o); });
  var dok = $('#op2-d-drv-ok');
  if (dok) dok.addEventListener('click', function () {
    var was = !!v.driver_confirmed_at;
    apiPost('/orders/executor_confirm', { executor_id: dok.dataset.eid, on: was ? 0 : 1 }).then(function (r) {
      if (!ok_(r)) return;
      if (was) S.tickDown(); else S.tickUp();
      toast(was ? 'Подтверждение водителя снято' : 'Водитель <span class="op2-tick">' + esc(v.driver_name || '') + ' подтвердил</span> заявку №' + esc(oNo(o)));
      loadOrders();
      apiGet('/orders/one', { id: o.id }).then(function (r2) { if (r2 && r2.data && r2.data.order) { drawerOrder = r2.data.order; renderView(drawerOrder, who); } });
    });
  });
  var ap = $('#op2-d-approve');
  if (ap) ap.addEventListener('click', function () { resolveRequest(o, 'approve', who); });
  var rj = $('#op2-d-reject');
  if (rj) rj.addEventListener('click', function () { resolveRequest(o, 'reject', who); });
  var ds = $('#op2-d-st');
  if (ds) ds.addEventListener('click', function (e) {
    var b = e.target.closest('.op2-chip'); if (!b || b.classList.contains('op2-on')) return;
    setStatus(o, b.dataset.st);
    $$('.op2-chip', this).forEach(function (x) { x.classList.remove('op2-on'); });
    b.classList.add('op2-on');
  });
  $$('[data-copy]', body).forEach(function (b) {
    var label = b.textContent;
    b.addEventListener('click', function () {
      copyText(passText(o));
      b.textContent = 'Скопировано ✓';
      setTimeout(function () { b.textContent = label; }, 1600);
    });
  });
  /* СТС и паспорта - хранилище справочников подключим следующим этапом */
  $$('.op2-dl', body).forEach(function (b) {
    b.addEventListener('click', function () { soonDoc(b.dataset.doc); });
  });
}
function resolveRequest(o, action, who) {
  var p = o.pending_request; if (!p) return;
  apiPost('/orders/change_request_resolve', { id: p.id, action: action }).then(function (r) {
    if (!ok_(r)) return;
    if (action === 'approve') {
      S.tickUp();
      toast('Замена подтверждена: <span class="op2-tick">' + esc(p.to_gos || '') + (p.to_driver_name ? ' · ' + esc(p.to_driver_name) : '') + '</span> на №' + esc(oNo(o)) +
        ' · логисту ушло · <b>отправь заказчику новые данные на пропуск</b>', null, 9000);
    } else {
      S.tickDown();
      toast('Замена отклонена · на №' + esc(oNo(o)) + ' едет ' + esc(p.from_gos || '') + ' · логисту ушло');
    }
    loadOrders();
    apiGet('/orders/one', { id: o.id }).then(function (r2) { if (r2 && r2.data && r2.data.order) { drawerOrder = r2.data.order; renderView(drawerOrder, who); } });
  });
}

/* подвал шторки - одно делегирование на все режимы (карточка/форма/повтор) */
function onDrawerFoot(e) {
  var id = e.target.id;
  var o = drawerOrder;
  if (id === 'op2-f-save') { saveForm(e.target); return; }
  if (id === 'op2-d-otboy' && o) { setStatus(o, 'ot'); closeDrawer(); return; }
  if (id === 'op2-d-done' && o) { setStatus(o, 'done'); closeDrawer(); return; }
  if (id === 'op2-d-contract' && o) { soon('Договор-заявка по №' + oNo(o)); return; }
  if (id === 'op2-d-repeat' && o) { openDrawerForm(o, true, isMgr() ? 'mgr' : 'log'); return; }
  if (id === 'op2-d-repeat-n' && o) { openRepeatN(o); return; }
  if (id === 'op2-d-edit' && o) { openDrawerForm(o, false, isMgr() ? 'mgr' : 'log'); return; }
  if (id === 'op2-d-back' && o) { openDrawerView(o, isMgr() ? 'mgr' : 'log'); return; }
  if (id === 'op2-rp-go' && o) { runRepeatN(e.target, o); return; }
  if (e.target.classList.contains('op2-del')) {
    if (formMode && o && o.id) { deleteOrder(o); return; }
    closeDrawer();
    return;
  }
}
function deleteOrder(o) {
  /* необратимое действие - единственный случай, где ГОСТ допускает confirm() */
  if (!window.confirm('Удалить заявку №' + oNo(o) + '? Отменить это будет нельзя.')) return;
  apiPost('/orders/delete', { id: o.id }).then(function (r) {
    if (!ok_(r)) return;
    S.tickDown(); closeDrawer();
    toast('Заявка №' + esc(oNo(o)) + ' удалена');
    loadOrders(); loadCounts();
  });
}

/* ═════════════════════════ ШТОРКА: ФОРМА ═════════════════════════ */
var formMode = false, formWho = 'mgr', formOrder = null, formRepeat = false;
function dict(name) { return (META && META.dictionary && META.dictionary[name]) || []; }
function entities() { return (META && META.own_entities) || []; }
function quickTimes(ds) {
  var isToday = ds === todayStr();
  if (!isToday) return { list: ['07:00', '08:00', '09:00', '10:00'], why: 'утро' };
  var start = Math.ceil((nowMin() + 30) / 60) * 60, list = [];
  for (var i = 0; i < 4; i++) { var m = start + i * 60; if (m > 21 * 60) break; list.push(hhmm(m)); }
  if (!list.length) return { list: ['07:00', '08:00', '09:00', '10:00'], why: 'на сегодня уже поздно - утро завтра' };
  return { list: list, why: 'ближайшие от ' + hhmm(nowMin()) };
}
function openDrawerForm(o, repeat, who) {
  formMode = true; formRepeat = !!repeat; formWho = who || (isMgr() ? 'mgr' : 'log');
  formOrder = o || null;
  drawerOrder = o || null;
  openDrawer();
  renderForm();
  if (repeat && o) toast('Поля скопированы из №' + esc(oNo(o)) + ' · дата по умолчанию - завтра');
}
function renderForm() {
  var o = formOrder, repeat = formRepeat, isLog = formWho === 'log';
  var evening = nowMin() >= 18 * 60;
  var defDate = repeat ? addDays(todayStr(), 1) : (o ? o.service_date : (evening ? addDays(DATE, 1) : DATE));
  var editing = !!(o && !repeat);

  $('#op2-d-title').textContent = repeat ? 'Новая заявка · повтор №' + oNo(o) : (editing ? 'Заявка №' + oNo(o) + ' · редактирование' : (isLog ? 'Новая заявка · логист' : 'Новая заявка'));
  $('#op2-d-sub').textContent = repeat ? 'все поля из №' + oNo(o) + ' · проверь дату и время'
    : humanDate(defDate) + ' · ' + ((ME && ME.name) || '') + (isLog ? ' · внутренняя перевозка или свой заказчик' : '');

  var eq = dict('equipment');
  var eqPrimary = eq.filter(function (x) { return x.primary; });
  var eqRest = eq.filter(function (x) { return !x.primary; });
  var curEq = o ? (o.equipment_type || '') : (eqPrimary[0] ? eqPrimary[0].value : '');
  var gabs = dict('gabarit').map(function (g) { return (g && g.value) || g; }); /* словарь отдаёт {value, primary} */
  var curGab = o ? (o.gabarit || '') : (gabs[0] || '');
  var curEnt = o && o.executor_entity_id ? String(o.executor_entity_id) : (entities()[0] ? String(entities()[0].id) : '');

  function optList(list, cur) {
    return list.map(function (x) { var val = (x && x.value != null) ? x.value : x; return '<option value="' + esc(val) + '"' + (String(cur) === String(val) ? ' selected' : '') + '>' + esc(val) + '</option>'; }).join('');
  }

  $('#op2-d-body').innerHTML =
    '<div class="op2-sect"><div class="op2-t">Когда и для кого</div><div class="op2-grid2">' +
      '<div class="op2-fld"><label>Дата подачи</label><div class="op2-seg" id="op2-f-datebox">' +
        '<button class="op2-chip' + (defDate === todayStr() ? ' op2-on' : '') + '" data-d="' + esc(todayStr()) + '">Сегодня ' + esc(dm(todayStr())) + '</button>' +
        '<button class="op2-chip' + (defDate === addDays(todayStr(), 1) ? ' op2-on' : '') + '" data-d="' + esc(addDays(todayStr(), 1)) + '">Завтра ' + esc(dm(addDays(todayStr(), 1))) + '</button>' +
        '<input type="date" class="op2-dt" id="op2-f-date" value="' + esc(defDate) + '" autocomplete="off" style="margin-left:4px">' +
      '</div>' + (evening && !editing ? '<span class="op2-hint">после 18:00 по умолчанию - завтра</span>' : '') + '</div>' +

      '<div class="op2-fld"><label>Время подачи</label><div class="op2-timerow">' +
        '<button class="op2-stp" data-d="-30">−30</button>' +
        '<input id="op2-f-time" placeholder="--:--" title="Можно набрать 700 - станет 07:00" autocomplete="off" value="' + esc(o ? oTime(o) : '') + '">' +
        '<button class="op2-stp" data-d="30">+30</button>' +
        '<span class="op2-hint">↑/↓ ±30 мин</span></div><div class="op2-qk" id="op2-f-qk"></div></div>' +

      '<div class="op2-fld op2-full"><label>Тип техники</label><div class="op2-seg" id="op2-f-eq">' +
        eqPrimary.map(function (x) { return '<button class="op2-chip' + (x.value === curEq ? ' op2-on' : '') + '" data-eq="' + esc(x.value) + '">' + esc(x.value) + '</button>'; }).join('') +
        (eqRest.length ? '<select id="op2-f-eq-more" style="margin-left:4px"><option value="">ещё…</option>' + optList(eqRest, curEq) + '</select>' : '') +
      '</div><span class="op2-hint" id="op2-f-eq-hint">' + (curEq ? 'Выбрано: ' + esc(curEq) : 'Основные - чипами, остальная техника в «ещё…»') + '</span></div>' +

      '<div class="op2-fld op2-full"><label>От кого (исполнитель с нашей стороны)</label><div class="op2-seg" id="op2-f-ent">' +
        entities().map(function (e2) {
          var ready = !!(e2.has_bank && e2.has_stamp);
          var ttl = [e2.full_name || e2.name, e2.inn ? 'ИНН ' + e2.inn : '', e2.director || '', ready ? 'банк и печать есть' : ((e2.has_bank ? '' : 'нет банка ') + (e2.has_stamp ? '' : 'нет печати'))].filter(Boolean).join(' · ');
          return '<button class="op2-chip' + (String(e2.id) === curEnt ? ' op2-on' : '') + '" data-ent="' + esc(e2.id) + '" title="' + esc(ttl) + '"' + (ready ? '' : ' style="opacity:.55"') + '>' + esc(e2.short || e2.name) + (ready ? '' : ' ·') + '</button>';
        }).join('') +
      '</div><span class="op2-hint">Реквизиты, печать и подпись этого юрлица уйдут в договор-заявку. С точкой - в справочнике нет банка или печати</span></div>' +

      (isLog ? '<div class="op2-fld op2-full"><label>Кто заказывает</label><select id="op2-f-who">' +
        '<option value="">Внешний заказчик - ввести ниже</option>' +
        '<optgroup label="Внутренние контрагенты (из Справочника юрлиц)">' +
          entities().map(function (e2) { return '<option value="' + esc(e2.id) + '"' + (o && o.internal && String(o.customer_entity_id) === String(e2.id) ? ' selected' : '') + '>' + esc(e2.name) + '</option>'; }).join('') +
        '</optgroup></select><span class="op2-hint">Внутренние заказы - те же заказчики, с суммой; список из Справочника, не из кода. В колонке «Мен.» у логистов - код логиста; менеджерам такая заявка не показывается</span></div>' : '') +

      '<div class="op2-fld op2-sugg" id="op2-f-custbox"><label>Заказчик</label>' +
        '<input id="op2-f-cust" placeholder="Начни вводить - по первым буквам" autocomplete="off" value="' + esc(o ? o.customer : '') + '">' +
        '<div class="op2-list" id="op2-f-custlist"></div></div>' +

      '<div class="op2-fld op2-full"><label>Контакт заказчика</label>' +
        '<input id="op2-f-custcontact" placeholder="Имя · телефон" autocomplete="off" value="' + esc(o ? [o.customer_contact_name, o.customer_contact_phone].filter(Boolean).join(' · ') : '') + '">' +
        '<span class="op2-hint" id="op2-f-custcontact-hint">Подсказки - контакты этого заказчика по прошлым заявкам</span></div>' +

      '<div class="op2-fld op2-full"><label><input type="checkbox" class="op2-cb" id="op2-f-nd-cb"' + (o && o.needs_data ? ' checked' : '') + '>Под данные</label>' +
        '<span class="op2-hint">Заказчику нужны данные водителя заранее (пропускной режим). После планирования машину и водителя не меняют без согласования - логист заявит основную и резервную, данные обоих уйдут заказчику.</span></div>' +
    '</div></div>' +

    '<div class="op2-sect"><div class="op2-t">Что везём</div><div class="op2-grid2">' +
      '<div class="op2-fld"><label>Груз</label><input id="op2-f-cargo" placeholder="экскаватор JCB 3CX" autocomplete="off" value="' + esc(o ? o.cargo : '') + '"></div>' +
      '<div class="op2-fld"><label>Вес, т</label><input id="op2-f-weight" class="op2-mono" inputmode="decimal" placeholder="8" autocomplete="off" value="' + esc(o ? (o.cargo_weight_t || '') : '') + '"></div>' +
      '<div class="op2-fld"><label>Габариты груза</label><input id="op2-f-dims" placeholder="Д × Ш × В" autocomplete="off" value="' + esc(o ? (o.cargo_dims || '') : '') + '"></div>' +
      '<div class="op2-fld"><label>Габарит</label><div class="op2-seg" id="op2-f-gab">' +
        gabs.map(function (g) { return '<button class="op2-chip' + (g === curGab ? ' op2-on' : '') + '" data-gab="' + esc(g) + '">' + esc(g) + '</button>'; }).join('') +
      '</div></div>' +
      '<div class="op2-fld"><label>Документы</label><select id="op2-f-docs"><option value="">—</option>' + optList(dict('documents'), o ? o.documents : '') + '</select></div>' +
      '<div class="op2-fld"><label>Условия переработки</label><select id="op2-f-rework"><option value="">—</option>' + optList(dict('rework'), o ? o.rework_terms : '') + '</select></div>' +
    '</div></div>' +

    '<div class="op2-sect"><div class="op2-t">Откуда - куда</div><div class="op2-grid2">' +
      '<div class="op2-fld op2-full op2-sugg" id="op2-f-frombox"><label>Адрес погрузки</label>' +
        '<input id="op2-f-from" placeholder="Адрес, ссылка на карту или координаты 55.75, 37.62" autocomplete="off" value="' + esc(o ? o.load_address : '') + '">' +
        '<div class="op2-list" id="op2-f-fromlist"></div>' +
        '<span class="op2-hint op2-okc" id="op2-f-fromhint">' + (o && o.load_lat ? esc(o.load_lat + ' · ' + o.load_lon) : '') + '</span></div>' +
      '<div class="op2-fld"><label>Контакт на погрузке</label><input id="op2-f-fromcontact" placeholder="Имя · телефон" autocomplete="off" value="' + esc(o ? [o.load_contact_name, o.load_contact_phone].filter(Boolean).join(' · ') : '') + '"></div>' +
      '<div class="op2-fld"><label>Контакт на выгрузке</label><input id="op2-f-tocontact" placeholder="Имя · телефон" autocomplete="off" value="' + esc(o ? [o.unload_contact_name, o.unload_contact_phone].filter(Boolean).join(' · ') : '') + '"></div>' +
      '<div class="op2-fld op2-full op2-sugg" id="op2-f-tobox"><label>Адрес выгрузки</label>' +
        '<input id="op2-f-to" placeholder="Адрес, ссылка на карту или координаты" autocomplete="off" value="' + esc(o ? o.unload_address : '') + '">' +
        '<div class="op2-list" id="op2-f-tolist"></div>' +
        '<span class="op2-hint op2-warn" id="op2-f-tohint"></span></div>' +
    '</div></div>' +

    '<div class="op2-sect"><div class="op2-t">Деньги</div><div class="op2-grid2">' +
      '<div class="op2-fld"><label>Стоимость, ₽</label><input id="op2-f-price" class="op2-mono" inputmode="numeric" placeholder="38 000" autocomplete="off" value="' + esc(o && num(o.price) ? o.price : '') + '"></div>' +
      '<div class="op2-fld"><label>Статус оплаты</label><select id="op2-f-pay"><option value="">—</option>' + optList(dict('payment_status'), o ? o.payment_status : '') + '</select></div>' +
      '<div class="op2-fld op2-full"><label><input type="checkbox" class="op2-cb" id="op2-f-cash"' + (o && o.cash ? ' checked' : '') + '>Наличные</label></div>' +
    '</div></div>' +

    '<div class="op2-sect"><div class="op2-t">Примечание</div><div class="op2-fld"><textarea id="op2-f-note" rows="3" placeholder="Что логисту важно знать">' + esc(o ? (o.note || '') : '') + '</textarea></div></div>';

  $('#op2-d-foot').innerHTML = '<button class="op2-del">' + (editing ? 'Удалить' : 'Отмена') + '</button>' +
    '<span class="op2-dim op2-sm" id="op2-f-state"></span>' +
    '<button class="op2-dbtn op2-primary op2-blocked" id="op2-f-save">Укажи заказчика</button>';

  wireForm();
}
function wireForm() {
  var ft = $('#op2-f-time');
  function drawQk() {
    var q = quickTimes($('#op2-f-date').value);
    $('#op2-f-qk').innerHTML = q.list.map(function (t) { return '<button class="op2-chip" data-q="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') +
      '<button class="op2-chip" data-q="">Уточнить</button><span class="op2-hint op2-dim" style="align-self:center;margin-left:4px">' + esc(q.why) + '</span>';
  }
  drawQk();
  $('#op2-f-qk').addEventListener('click', function (e) {
    var b = e.target.closest('.op2-chip'); if (!b) return;
    ft.value = b.dataset.q;
    $$('.op2-chip', this).forEach(function (x) { x.classList.remove('op2-on'); });
    b.classList.add('op2-on');
    tickState();
  });
  ft.addEventListener('blur', function () { this.value = normT(this.value); tickState(); });
  ft.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    var m = tmin(normT(this.value) || '08:00') + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 5 : 30);
    this.value = hhmm(m);
    tickState();
  });
  $$('.op2-stp', $('#op2-d-body')).forEach(function (b) {
    b.addEventListener('click', function () { ft.value = hhmm(tmin(normT(ft.value) || '08:00') + (+this.dataset.d)); tickState(); });
  });
  $('#op2-f-datebox').addEventListener('click', function (e) {
    var b = e.target.closest('.op2-chip'); if (!b) return;
    $$('.op2-chip', this).forEach(function (x) { x.classList.remove('op2-on'); });
    b.classList.add('op2-on');
    $('#op2-f-date').value = b.dataset.d;
    drawQk();
  });
  $('#op2-f-date').addEventListener('change', function () {
    $$('#op2-f-datebox .op2-chip').forEach(function (x) { x.classList.toggle('op2-on', x.dataset.d === this.value); }, this);
    drawQk();
  });
  $('#op2-f-eq').addEventListener('click', function (e) {
    var b = e.target.closest('.op2-chip'); if (!b) return;
    $$('.op2-chip', this).forEach(function (x) { x.classList.remove('op2-on'); });
    b.classList.add('op2-on');
    var sel = $('#op2-f-eq-more'); if (sel) sel.value = '';
    $('#op2-f-eq-hint').textContent = 'Выбрано: ' + b.dataset.eq;
  });
  var eqMore = $('#op2-f-eq-more');
  if (eqMore) eqMore.addEventListener('change', function () {
    if (!this.value) return;
    $$('#op2-f-eq .op2-chip').forEach(function (x) { x.classList.remove('op2-on'); });
    $('#op2-f-eq-hint').textContent = 'Выбрано: ' + this.value;
    S.nav();
  });
  $('#op2-f-ent').addEventListener('click', function (e) {
    var b = e.target.closest('.op2-chip'); if (!b) return;
    $$('.op2-chip', this).forEach(function (x) { x.classList.remove('op2-on'); });
    b.classList.add('op2-on');
  });
  var gab = $('#op2-f-gab');
  if (gab) gab.addEventListener('click', function (e) {
    var b = e.target.closest('.op2-chip'); if (!b) return;
    $$('.op2-chip', this).forEach(function (x) { x.classList.remove('op2-on'); });
    b.classList.add('op2-on');
  });
  var fw = $('#op2-f-who');
  if (fw) {
    fw.addEventListener('change', function () {
      S.nav();
      var fc = $('#op2-f-cust');
      if (this.value) {
        var name = this.options[this.selectedIndex].text;
        fc.value = name; fc.readOnly = true;
      } else if (fc.readOnly) { fc.value = ''; fc.readOnly = false; }
      tickState();
    });
    if (fw.value) { var fc0 = $('#op2-f-cust'); fc0.value = fw.options[fw.selectedIndex].text; fc0.readOnly = true; }
  }

  /* подсказки заказчика */
  var custT = null;
  $('#op2-f-cust').addEventListener('input', function () {
    tickState();
    var v = this.value.trim();
    clearTimeout(custT);
    if (v.length < 2) { $('#op2-f-custbox').classList.remove('op2-open'); return; }
    custT = setTimeout(function () { fetchCustomers(v); }, 250);
  });
  $('#op2-f-custlist').addEventListener('mousedown', function (e) {
    var it = e.target.closest('.op2-it'); if (!it) return;
    $('#op2-f-cust').value = it.dataset.name || '';
    $('#op2-f-custbox').classList.remove('op2-open');
    if (it.dataset.eid) $('#op2-f-cust').dataset.entityId = it.dataset.eid;
    fetchCustomerHistory(it.dataset.name || '');
    tickState();
  });
  $('#op2-f-cust').addEventListener('blur', function () { setTimeout(function () { $('#op2-f-custbox').classList.remove('op2-open'); }, 150); });

  /* подсказки адресов из истории заказчика */
  ['from', 'to'].forEach(function (side) {
    var inp = $('#op2-f-' + side);
    inp.addEventListener('focus', function () { if ($('#op2-f-' + side + 'list').innerHTML) $('#op2-f-' + side + 'box').classList.add('op2-open'); });
    inp.addEventListener('blur', function () { setTimeout(function () { $('#op2-f-' + side + 'box').classList.remove('op2-open'); }, 150); tickState(); });
    $('#op2-f-' + side + 'list').addEventListener('mousedown', function (e) {
      var it = e.target.closest('.op2-it'); if (!it) return;
      inp.value = it.dataset.address || '';
      inp.dataset.lat = it.dataset.lat || '';
      inp.dataset.lon = it.dataset.lon || '';
      if (it.dataset.cname || it.dataset.cphone) {
        $('#op2-f-' + side + 'contact').value = [it.dataset.cname, it.dataset.cphone].filter(Boolean).join(' · ');
      }
      var hint = $('#op2-f-' + side + 'hint');
      if (hint) { hint.textContent = it.dataset.lat ? (it.dataset.lat + ' · ' + it.dataset.lon) : 'из истории заказчика'; hint.className = 'op2-hint op2-okc'; }
      $('#op2-f-' + side + 'box').classList.remove('op2-open');
      tickState();
    });
  });

  $$('#op2-d-body input,#op2-d-body select,#op2-d-body textarea').forEach(function (i) { i.addEventListener('input', tickState); });
  if (formOrder && formOrder.customer) fetchCustomerHistory(formOrder.customer);
  tickState();
}
function tickState() {
  var b = $('#op2-f-save'), st = $('#op2-f-state');
  if (!b) return;
  var cust = ($('#op2-f-cust') || {}).value ? $('#op2-f-cust').value.trim() : '';
  if (!cust) { b.className = 'op2-dbtn op2-primary op2-blocked'; b.textContent = 'Укажи заказчика'; st.textContent = ''; return; }
  var miss = [];
  if (!$('#op2-f-time').value.trim()) miss.push('время');
  if (!$('#op2-f-to').value.trim()) miss.push('адрес выгрузки');
  if (!formEq()) miss.push('тип техники');
  if (miss.indexOf('тип техники') >= 0) { b.className = 'op2-dbtn op2-primary op2-blocked'; b.textContent = 'Выбери тип техники'; st.textContent = ''; return; }
  if (miss.length) {
    b.className = 'op2-dbtn op2-primary op2-warn';
    b.textContent = 'Сохранить · есть незаполненные';
    st.textContent = 'Не хватает: ' + miss.join(', ') + ' · сохраним, поля подсветятся «уточнить»';
  } else {
    b.className = 'op2-dbtn op2-primary';
    b.textContent = 'Сохранить заявку';
    st.textContent = '';
  }
}
function formEq() {
  var on = $('#op2-f-eq .op2-chip.op2-on');
  if (on) return on.dataset.eq;
  var sel = $('#op2-f-eq-more');
  return sel && sel.value ? sel.value : '';
}
function splitContact(s) {
  s = String(s || '').trim();
  if (!s) return { name: '', phone: '' };
  var parts = s.split('·');
  if (parts.length >= 2) return { name: parts[0].trim(), phone: parts.slice(1).join('·').trim() };
  var m = s.match(/([+\d][\d\s\-()]{6,})$/);
  if (m) return { name: s.slice(0, m.index).replace(/[,\s]+$/, '').trim(), phone: m[1].trim() };
  return { name: s, phone: '' };
}
function fetchCustomers(q) {
  apiGet('/orders/customers', { q: q }).then(function (r) {
    if (!r || !r.ok || !r.data || r.data.error) return;
    var mine = r.data.mine || [], all = r.data.all || [];
    var h = '';
    if (mine.length) h += '<div class="op2-sec">Мои за 30 дней</div>' + mine.slice(0, 6).map(function (c) {
      return '<div class="op2-it" data-name="' + esc(c.name) + '"' + (c.entity_id ? ' data-eid="' + esc(c.entity_id) + '"' : '') + '><span>' + esc(c.name) + '</span><span class="op2-m">' + esc(c.n || '') + '</span></div>';
    }).join('');
    if (all.length) h += '<div class="op2-sec">Все контрагенты</div>' + all.slice(0, 10).map(function (c) {
      return '<div class="op2-it" data-name="' + esc(c.name) + '" data-eid="' + esc(c.id) + '"><span>' + esc(c.name) + '</span><span class="op2-m">' + esc(c.inn || (c.is_own ? 'своё' : '')) + '</span></div>';
    }).join('');
    h += '<div class="op2-it" data-name="' + esc(q) + '"><span>Новый: «' + esc(q) + '»</span><span class="op2-m">как ввели</span></div>';
    $('#op2-f-custlist').innerHTML = h;
    $('#op2-f-custbox').classList.add('op2-open');
  }).catch(function () {});
}
function fetchCustomerHistory(name) {
  if (!name) return;
  apiGet('/orders/customer_history', { customer: name }).then(function (r) {
    if (!r || !r.ok || !r.data || r.data.error) return;
    var d = r.data;
    var addr = (d.addresses || []).slice(0, 8).map(function (a) {
      return '<div class="op2-it" data-address="' + esc(a.address) + '" data-lat="' + esc(a.lat || '') + '" data-lon="' + esc(a.lon || '') + '" data-cname="' + esc(a.contact_name || '') + '" data-cphone="' + esc(a.contact_phone || '') + '">' +
        '<span>' + esc(a.address) + '</span><span class="op2-m">' + esc(a.n || '') + '</span></div>';
    }).join('');
    var head = addr ? '<div class="op2-sec">Точки этого заказчика</div>' : '';
    $('#op2-f-fromlist').innerHTML = head + addr;
    $('#op2-f-tolist').innerHTML = head + addr;
    var c = (d.contacts || [])[0];
    if (c && !$('#op2-f-custcontact').value.trim()) {
      $('#op2-f-custcontact-hint').textContent = 'Из истории: ' + [c.name, fmtPhone(c.phone)].filter(Boolean).join(' · ');
    }
    /* «как в прошлой заявке этого заказчика» - только если менеджер ещё не выбрал сам */
    if (d.last_executor_entity_id && !formOrder) {
      var b = $('#op2-f-ent .op2-chip[data-ent="' + d.last_executor_entity_id + '"]');
      if (b && !$('#op2-f-ent .op2-chip.op2-on[data-ent="' + d.last_executor_entity_id + '"]')) {
        $$('#op2-f-ent .op2-chip').forEach(function (x) { x.classList.remove('op2-on'); });
        b.classList.add('op2-on');
      }
    }
  }).catch(function () {});
}
function collectForm() {
  var fc = splitContact($('#op2-f-custcontact').value);
  var lc = splitContact($('#op2-f-fromcontact').value);
  var uc = splitContact($('#op2-f-tocontact').value);
  var entBtn = $('#op2-f-ent .op2-chip.op2-on');
  var gabBtn = $('#op2-f-gab .op2-chip.op2-on');
  var fw = $('#op2-f-who');
  var from = $('#op2-f-from'), to = $('#op2-f-to');
  var payload = {
    service_date: $('#op2-f-date').value,
    service_time: normT($('#op2-f-time').value),
    needs_data: $('#op2-f-nd-cb').checked ? 1 : 0,
    customer: $('#op2-f-cust').value.trim(),
    executor_entity_id: entBtn ? entBtn.dataset.ent : '',
    customer_contact_name: fc.name,
    customer_contact_phone: fc.phone,
    equipment_type: formEq(),
    cargo: $('#op2-f-cargo').value.trim(),
    cargo_weight_t: $('#op2-f-weight').value.trim(),
    cargo_dims: $('#op2-f-dims').value.trim(),
    gabarit: gabBtn ? gabBtn.dataset.gab : '',
    rework_terms: $('#op2-f-rework').value,
    documents: $('#op2-f-docs').value,
    note: $('#op2-f-note').value.trim(),
    cash: $('#op2-f-cash').checked ? 1 : 0,
    load_address: from.value.trim(),
    load_lat: from.dataset.lat || '',
    load_lon: from.dataset.lon || '',
    load_contact_name: lc.name,
    load_contact_phone: lc.phone,
    unload_address: to.value.trim(),
    unload_lat: to.dataset.lat || '',
    unload_lon: to.dataset.lon || '',
    unload_contact_name: uc.name,
    unload_contact_phone: uc.phone,
    price: num($('#op2-f-price').value) || 0,
    payment_status: $('#op2-f-pay').value
  };
  if (fw && fw.value) { payload.internal = 1; payload.customer_entity_id = fw.value; }
  else if ($('#op2-f-cust').dataset.entityId) { payload.customer_entity_id = $('#op2-f-cust').dataset.entityId; }
  return payload;
}
function saveForm(btn) {
  if (btn.classList.contains('op2-blocked')) { toast('<span class="op2-warn">' + esc(btn.textContent) + '</span>'); return; }
  var warn = btn.classList.contains('op2-warn');
  var payload = collectForm();
  var editing = !!(formOrder && !formRepeat);
  if (editing) payload.id = formOrder.id;
  btn.disabled = true;
  apiPostJson('/orders/save', payload).then(function (r) {
    btn.disabled = false;
    if (!ok_(r)) return;
    var d = r.data;
    formMode = false;
    closeDrawer();
    S.tickUp();
    var no = d.day_no != null ? d.day_no : (d.order && d.order.day_no);
    toast('Заявка №' + esc(no) + (editing ? ' сохранена' : ' создана') +
      (payload.internal ? ' · <span class="op2-tick">внутренний заказчик</span>' + (payload.price ? ' · ' + esc(fmtP(payload.price)) : ' · <span class="op2-warn">без суммы</span>') + ' · в списке менеджеров не появится' : '') +
      (warn ? ' · <span class="op2-warn">незаполненные поля</span>' : '') +
      (editing ? '' : (payload.internal ? '' : (formWho === 'log' ? ' · менеджер увидит у себя' : ' · логисты видят сразу'))));
    if (payload.service_date !== DATE && !TO_DATE) { DATE = payload.service_date; renderAll(); }
    loadOrders(); loadCounts(); loadFree();
  }).catch(function () { btn.disabled = false; });
}

/* ═════════════════════════ ПОВТОРИТЬ НА НЕСКОЛЬКО ДНЕЙ ═════════════════════════ */
function openRepeatN(o) {
  drawerOrder = o; formMode = false;
  openDrawer();
  var base = o.service_date || DATE;
  var days = [];
  for (var i = 1; i <= 7; i++) {
    var d = addDays(base, i), wd = dObj(d).getDay();
    days.push({ d: d, l: WD_SHORT[wd] + ' ' + dObj(d).getDate(), wd: (wd !== 0 && wd !== 6) ? 1 : 0 });
  }
  $('#op2-d-title').textContent = 'Повторить №' + oNo(o) + ' на несколько дней';
  $('#op2-d-sub').textContent = (o.customer || '') + ' · ' + (o.equipment_type || '') + ' · ' + (oTime(o) || 'время уточнить') +
    ' · ' + (o.load_address || '—') + ' → ' + (o.unload_address || '—');
  $('#op2-d-body').innerHTML =
    '<div class="op2-sect"><div class="op2-t">На какие дни</div><div class="op2-seg" id="op2-rp-days" style="flex-wrap:wrap">' +
      days.map(function (x) { return '<button class="op2-chip" data-d="' + esc(x.d) + '" data-l="' + esc(x.l) + '" data-wd="' + x.wd + '">' + esc(x.l) + '</button>'; }).join('') +
    '</div>' +
    '<div class="op2-qk" id="op2-rp-presets"><button class="op2-chip" data-preset="wd">Будни</button><button class="op2-chip" data-preset="all">Все 7 дней</button><button class="op2-chip" data-preset="none">Сбросить</button></div>' +
    '<span class="op2-hint">Время, тип техники, груз, адреса, контакты, цена - как в №' + esc(oNo(o)) + '. Машину логист ставит на каждый день отдельно; номера заявок - свои внутри каждого дня.</span></div>' +
    '<div class="op2-sect"><div class="op2-t">Что получится</div><ul class="op2-hist" id="op2-rp-list"><li><span class="op2-dim">выбери дни</span></li></ul></div>';
  $('#op2-d-foot').innerHTML = '<button class="op2-ghost" id="op2-d-back">← Назад к заявке</button>' +
    '<span class="op2-dim op2-sm" id="op2-rp-state"></span>' +
    '<button class="op2-dbtn op2-primary op2-blocked" id="op2-rp-go">Создать заявки</button>';

  function refresh() {
    var sel = $$('#op2-rp-days .op2-chip.op2-on');
    var b = $('#op2-rp-go');
    $('#op2-rp-list').innerHTML = sel.length ? sel.map(function (c) {
      return '<li><span class="op2-tm">' + esc(c.dataset.l) + '</span><span>' + esc(oTime(o) || 'время уточнить') + ' · ' + esc(o.equipment_type || '') + ' · ' + esc(o.customer || '') +
        (o.cargo ? ' · <span class="op2-dim">' + esc(o.cargo) + '</span>' : '') + '</span></li>';
    }).join('') : '<li><span class="op2-dim">выбери дни</span></li>';
    b.className = 'op2-dbtn op2-primary' + (sel.length ? '' : ' op2-blocked');
    b.textContent = sel.length ? 'Создать ' + sel.length + ' ' + plural(sel.length, 'заявку', 'заявки', 'заявок') : 'Создать заявки';
    $('#op2-rp-state').textContent = sel.length ? 'логисты увидят каждую на своём дне' : '';
  }
  $('#op2-rp-days').addEventListener('click', function (e) { var c = e.target.closest('.op2-chip'); if (!c) return; c.classList.toggle('op2-on'); refresh(); });
  $('#op2-rp-presets').addEventListener('click', function (e) {
    var c = e.target.closest('.op2-chip'); if (!c) return;
    var p = c.dataset.preset;
    $$('#op2-rp-days .op2-chip').forEach(function (x) { x.classList.toggle('op2-on', p === 'all' || (p === 'wd' && x.dataset.wd === '1')); });
    refresh();
  });
  refresh();
}
function runRepeatN(btn, o) {
  if (btn.classList.contains('op2-blocked')) { toast('<span class="op2-warn">Выбери хотя бы один день</span>'); return; }
  var sel = $$('#op2-rp-days .op2-chip.op2-on');
  var base = {
    service_time: oTime(o), needs_data: o.needs_data ? 1 : 0, customer: o.customer,
    customer_entity_id: o.customer_entity_id || '', executor_entity_id: o.executor_entity_id || '',
    customer_contact_name: o.customer_contact_name || '', customer_contact_phone: o.customer_contact_phone || '',
    equipment_type: o.equipment_type, cargo: o.cargo || '', cargo_weight_t: o.cargo_weight_t || '',
    cargo_dims: o.cargo_dims || '', gabarit: o.gabarit || '', rework_terms: o.rework_terms || '',
    documents: o.documents || '', note: o.note || '', cash: o.cash ? 1 : 0,
    load_address: o.load_address || '', load_lat: o.load_lat || '', load_lon: o.load_lon || '',
    load_contact_name: o.load_contact_name || '', load_contact_phone: o.load_contact_phone || '',
    unload_address: o.unload_address || '', unload_lat: o.unload_lat || '', unload_lon: o.unload_lon || '',
    unload_contact_name: o.unload_contact_name || '', unload_contact_phone: o.unload_contact_phone || '',
    price: num(o.price) || 0, payment_status: o.payment_status || '', internal: o.internal ? 1 : 0
  };
  btn.disabled = true;
  Promise.all(sel.map(function (c) {
    var p = {}; Object.keys(base).forEach(function (k) { p[k] = base[k]; });
    p.service_date = c.dataset.d;
    return apiPostJson('/orders/save', p).then(function (r) { return { r: r, l: c.dataset.l }; });
  })).then(function (res) {
    btn.disabled = false;
    var good = res.filter(function (x) { return x.r && x.r.ok && x.r.data && !x.r.data.error; });
    var bad = res.length - good.length;
    closeDrawer();
    if (good.length) S.tickUp();
    toast('Создано ' + good.length + ' ' + plural(good.length, 'заявка', 'заявки', 'заявок') + ' по образцу №' + esc(oNo(o)) + ': ' +
      esc(good.map(function (x) { return '№' + ((x.r.data.day_no != null) ? x.r.data.day_no : '?') + ' ' + x.l; }).join(', ')) +
      (bad ? ' · <span class="op2-bad">' + bad + ' не создалось</span>' : '') + ' · логисты увидят на своих днях', null, 9000);
    loadOrders(); loadCounts();
  }).catch(function () { btn.disabled = false; });
}

/* ═════════════════════════ ЖИВОСТЬ ═════════════════════════ */
function startPolling() {
  stopPolling();
  pollTimer = setInterval(function () {
    if (document.hidden) return;      /* вкладка не видна - не дёргаем сервер */
    if (!isPageActive()) return;      /* ушли на другую страницу дашборда */
    loadOrders(true);
  }, 7000);
  tickTimer = setInterval(function () { if (!document.hidden && isPageActive()) renderUpdated(); }, 1000);
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}

/* ═════════════════════════ ВХОД ═════════════════════════ */
function open() {
  if (!built) { if (!buildDom()) return; built = true; }
  renderAll();
  if (!META) loadMeta().then(function () { renderAll(); loadOrders(); });
  else loadOrders();
  loadCounts();
  loadFree();
  startPolling();
}
window.OP2 = { open: open, reload: function () { loadOrders(); }, stop: stopPolling };

})();
