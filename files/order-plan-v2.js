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
/* Влад 11.09: «сторонние подсказки заполнения заблокировать, только внутренние дашборда» -
   Chrome/Яндекс игнорируют autocomplete="off" у полей, похожих на адрес/имя/телефон, и рисуют
   своё меню (со своей историей автозаполнения) поверх наших подсказок. Рабочий обход:
   autocomplete="new-password" + случайное name. 12.09 (живой тест, скриншот сторонней
   выпадашки над поиском машины в поповере «Поставить»): раньше это применялось ТОЛЬКО к
   #op2-d-body (шторка) - «все формы для заполнения должны быть заблокированы», вызывается
   теперь на каждом месте, где что-то рендерится: buildDom (статический каркас - тулбарные
   поиски, поиск в поповере), wireForm (шторка), openHiredStep (наёмник), renderList повтора. */
function blockForeignAutofill_(root) {
  $$('input:not([type=date]):not([type=checkbox]),textarea', root).forEach(function (i) {
    i.setAttribute('autocomplete', 'new-password'); i.setAttribute('autocorrect', 'off'); i.setAttribute('spellcheck', 'false');
    i.setAttribute('name', 'op2-' + Math.random().toString(36).slice(2, 9));
  });
}

/* Своя экранировка - всё, что приходит от людей (заказчик, груз, адреса, имена),
   уходит в innerHTML только через неё. Общей escHtml_ в index.html нет - те,
   что есть, приватны внутри чужих IIFE. */
function capFirst(s) { s = String(s || ''); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; } /* «буровая Liebherr…» -> «Буровая Liebherr…» */
/* Своя база (Влад 12.09) - кнопка «База» у адреса погрузки/выгрузки, только у логиста.
   Координаты - точный ответ DaData на этот адрес (проверено вручную 12.09), не пересчитываются. */
var BASE_ADDRESS_ = 'Московская обл, г Домодедово, мкр Центральный, ул Промышленная, д 37';
var BASE_LAT_ = '55.4672641', BASE_LON_ = '37.7794222';
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; }
function fmtP(n) { n = num(n); return n ? n.toLocaleString('ru-RU').replace(/ /g, ' ') + ' ₽' : ''; }
/* Денежное поле ввода - ГОСТ раздел 3 (Влад 12.09: «должно быть красиво с
   разделениями... невозможно внести белиберду со скобками - только цифры»).
   Живая маска: только цифры, разделение по тысячам пробелом на каждый ввод,
   курсор остаётся на том же месте среди цифр (не улетает в конец поля).
   num() уже умеет читать значение с пробелами (.replace(/\s/g,'')) - отдельно
   очищать перед сохранением/расчётом не нужно, само поле хранит «красивую»
   строку. Применять к КАЖДОМУ полю суммы по умолчанию - см. DESIGN_SYSTEM.md
   раздел 3, «Денежное поле ввода» для полного списка/оговорок. */
function wireMoneyInput_(id) {
  var el = $('#' + id);
  if (!el) return;
  el.addEventListener('input', function () {
    var start = this.selectionStart;
    var digitsBefore = this.value.slice(0, start).replace(/\D/g, '').length;
    var digits = this.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    var formatted = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    this.value = formatted;
    var count = 0, pos = formatted.length;
    for (var i = 0; i < formatted.length; i++) {
      if (formatted[i] !== ' ') count++;
      if (count === digitsBefore) { pos = i + 1; break; }
    }
    if (digitsBefore === 0) pos = 0;
    try { this.setSelectionRange(pos, pos); } catch (e) {}
  });
}
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
  /* шаг времени −30/+30 (Влад 11.09: «на + звук должен отличаться от −»): короткий, плюс - вверх, минус - вниз */
  stepUp: function () { blip(440, 560, .05, .03); },
  stepDown: function () { blip(560, 440, .05, .03); },
  toggle: function () { blip(520, 560, .04, .02); },
  lift: function () { blip(330, 392, .06, .03); },
  drop: function () { blip(392, 300, .08, .035); },
  attention: function () { blip(220, 180, .12, .06, 'triangle'); },
  /* отбой у логиста - один «сиренный кряк» (Влад 10.09): резче и громче всего
     остального, играет ОДИН раз в момент отбоя; мигание строки дальше молчит.
     Единственное исключение из деликатного регистра. */
  otboy: function () { blip(320, 150, .35, .09, 'sawtooth'); blip(640, 300, .18, .03, 'square'); },
  /* новая ПОДТВЕРЖДЁННАЯ заявка у логиста - мажорное арпеджио C5-E5-G5-C6 */
  newOrder: function () { [[523, 0], [659, 90], [784, 180], [1047, 270]].forEach(function (p) { setTimeout(function () { blip(p[0], p[0] * 1.01, .16, .045); }, p[1]); }); },
  /* «От кого» - раскрытие ряда юрлиц (Влад 11.09: «звук должен соответствовать
     раскрытию, не просто пик, а как раскрытие гармошки»). Не один тон, а бег коротких
     нот вверх, ОДНА НА КАЖДЫЙ появляющийся чип, на том же 35мс шаге, что несёт
     .op2-ent-enter в CSS - ухо и глаз раскрывают меха вместе. triangle, не sine -
     чуть «язычковый» тембр, без электронной чистоты. Свёртка - тот же бег вниз,
     втрое короче: спрятать проще, чем достать. */
  unfold: function (n) {
    var steps = Math.max(1, Math.min(8, n || 1));
    for (var i = 0; i < steps; i++) {
      (function (i) { setTimeout(function () { blip(258 + i * 32, 278 + i * 32, .05, .026, 'triangle'); }, i * 35); })(i);
    }
  },
  fold: function () {
    for (var i = 0; i < 3; i++) {
      (function (i) { setTimeout(function () { blip(360 - i * 40, 340 - i * 40, .04, .022, 'triangle'); }, i * 22); })(i);
    }
  }
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
  /* Протухшая сессия (401 needLogin) - на экран входа, как весь дашборд; иначе форма молча
     рендерилась без чипов (тот же класс бага, что у механика 11.09 - память
     project_mechanic_login_needlogin_bypass_bug). */
  if (r && r.data && r.data.needLogin && typeof showLoginScreen === 'function') {
    stopPolling();
    try { if (typeof clearAuthTokens_ === 'function') clearAuthTokens_(); } catch (e) {}
    showLoginScreen(r.data.error || 'Сессия истекла - войдите заново');
    return false;
  }
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
function isAdmin() { return !!(ME && ME.role === 'admin'); } /* удалять заявку может только Влад (11.09) */

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
      /* 11.09, Влад: «два раза Задание Задание выглядит глупо» - заголовок сверху уже даёт
         дашборд (page-title = PAGE_TITLES['order-plan']), здесь оставляем только подстрочник. */
      '<div class="op2-page-head">' +
        '<span class="op2-sub op2-sub-main" id="op2-sub"></span>' +
        '<div class="op2-presence op2-hidden" id="op2-presence" title="Кто сейчас на странице «Задание»: ярко - действует прямо сейчас"></div>' +
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
  blockForeignAutofill_(page); /* статический каркас - тулбарные поиски, поиск в поповере «Поставить» */
  wire();
  return true;
}

/* ═════════════════════════ ОБРАБОТЧИКИ ═════════════════════════ */
/* ГОСТ: ОДНО делегирование со списком-селектором, не обработчик на каждый элемент.
   Элементы с собственным звуком результата (RESULT_SEL) из nav исключены, чтобы
   не было двойного щелчка. */
var NAV_SEL = '.op2-tab,.op2-chip,.op2-ghost,.op2-dbtn,.op2-slot,.op2-veh,.op2-st-chip,.op2-sugg .op2-it,.op2-free .op2-day,.op2-stpop button,.op2-pop .op2-vi,.op2-copybtn,.op2-take,.op2-dt,.op2-mgr-tbl tbody tr,.op2-log-body tr,.op2-switch button,[data-nav-sound]';
var RESULT_SEL = '#op2-f-save,#op2-rp-go,#op2-pop-ok,.op2-dok,.op2-unset-ot,.op2-slot.op2-ot,#op2-drv-copy,#op2-drv-max,#op2-d-drv-ok,.op2-dl,.op2-copybtn,.op2-stpop button,.op2-pop .op2-vi[data-act="unset"],#op2-snd,.op2-blocked,#op2-f-ent .op2-chip';

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
  ['pointerdown', 'keydown'].forEach(function (ev) { $('#' + ROOT_ID).addEventListener(ev, function () { lastInteract = Date.now(); }, true); });

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
  /* Влад 12.09 (живой тест): «прокручиваю колесиком вниз - список закрывается» - скролл не
     всплывает, поэтому ловим его на capture-фазе с window; но так же ловился и скролл СПИСКА
     машин ВНУТРИ самого поповера (у #op2-pop-body своя прокрутка) - каждое движение колеса
     по списку закрывало его же. Закрываем только если событие пришло НЕ изнутри поповера
     (значит скроллится страница за ним, а не сам список). */
  window.addEventListener('scroll', function (e) {
    var pop = $('#op2-pop');
    if (!pop || !pop.classList.contains('op2-open')) return;
    if (e.target && e.target.nodeType === 1 && pop.contains(e.target)) return;
    closePop();
  }, true);
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
  /* «Под данные» - попап подсказки (перенос редизайна 12.09) */
  if ($('.op2-info-dot.op2-open') && !e.target.closest('.op2-info-dot') && !e.target.closest('.op2-info-pop')) {
    $$('.op2-info-pop').forEach(function (p) { p.remove(); });
    $$('.op2-info-dot').forEach(function (d) { d.classList.remove('op2-open'); });
  }
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
    } else { ok_(r, null, 'справочники не загрузились'); } /* 401 -> экран входа, прочее - тост */
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
/* присутствие: heartbeat раз в 7 с (вместе с поллингом), active=1 если что-то делал за последние 7 с */
var lastInteract = 0;
function presenceBeat() {
  if (!ME) return;
  var active = (Date.now() - lastInteract) < 7000 ? 1 : 0;
  apiPost('/orders/presence', { active: active }).catch(function () {});
  if (ME.role === 'admin') {
    apiGet('/orders/presence', {}).then(function (r) {
      if (!r || !r.ok || !r.data || !r.data.users) return;
      var box = $('#op2-presence'); if (!box) return;
      var users = r.data.users.slice().sort(function (a, b) { return (a.role || '').localeCompare(b.role || '') || a.code.localeCompare(b.code, 'ru'); });
      box.classList.toggle('op2-hidden', false);
      box.innerHTML = users.length ? users.map(function (u) {
        var act = u.active_ago !== null && u.active_ago < 10;
        return '<span class="op2-pt' + (act ? ' op2-active' : '') + '" title="' + esc(u.name) + (u.role ? ' · ' + esc(u.role) : '') + (act ? ' · действует сейчас' : ' · на странице') + '">' + esc(u.code) + '</span>';
      }).join('') : '<span class="op2-pt op2-none" title="Сейчас на странице никого, кроме вас">никого</span>';
    }).catch(function () {});
  }
}
function loadOrders(silent) {
  if (loadingOrders) return Promise.resolve();
  loadingOrders = true;
  presenceBeat();
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
/* Влад 12.09: «не нужно так длинно писать полное имя - нужно сокращённо, Цуц/Кан/Мах, как
   уже есть у логистов» + «логисты тоже должны видеть, какой логист работает с заявкой» - код
   (taken_by_code, тот же code3 - «три буквы фамилии, как в Планировке», что и manager_code)
   виден ВСЕГДА, не только пока машина не поставлена, и в таблице менеджера, и в таблице
   логиста, и в карточке. Полное имя осталось в title (навести мышью), а не в самой строке.
   takenByHtml_ - голый тег (своя обёртка/класс вызывающего места, или '' - без класса вовсе);
   takenByBadge_ - готовый бейдж с пробелом впереди для табличных ячеек. */
function takenByHtml_(o, verb, wrapClass) {
  if (!o.taken_by_name) return '';
  return '<span' + (wrapClass ? ' class="' + wrapClass + '"' : '') + ' title="' + esc(o.taken_by_name) + '">' + esc(verb) + ' ' + esc((o.taken_by_code || o.taken_by_name).toUpperCase()) + '</span>';
}
function takenByBadge_(o) {
  var h = takenByHtml_(o, 'взял', 'op2-takenby');
  return h ? ' ' + h : '';
}
function mgrVehCell(o) {
  var h = oHired(o);
  if (h) {
    return '<div class="op2-veh"><span class="op2-hire">Наёмник</span><span class="op2-drv">' + esc(h.carrier_name || 'перевозчик уточняется') +
      (h.vehicle_gos ? ' · <span class="op2-mono">' + esc(h.vehicle_gos) + '</span>' : '') + (h.driver_name ? ' · ' + esc(h.driver_name) : '') + '</span></div>' + takenByBadge_(o) + pendHtml(o, 'mgr');
  }
  var vs = oOwn(o);
  if (!vs.length) {
    return '<span class="op2-dim">машину ещё не поставили</span>' + takenByBadge_(o);
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
  return inner + takenByBadge_(o) + pendHtml(o, 'mgr');
}
/* «замена машины» (type=replace_vehicle, from_gos/to_gos) и «замена перевозчика»
   (type=replace_carrier, from_carrier_name/to_carrier_name) - один и тот же
   plan_order_change_requests, один общий разбор from/to, чтобы не дублировать
   ветвление в каждом месте, где показывается или разрешается запрос. */
function pendFromTo_(p) {
  if (p.type === 'replace_carrier') return { from: p.from_carrier_name || '', to: p.to_carrier_name || '', extra: '', cls: '' };
  return { from: p.from_gos || '', to: p.to_gos || '', extra: p.to_driver_name || '', cls: 'op2-mono' };
}
function pendHtml(o, who) {
  var p = o.pending_request;
  if (!p) return '';
  var ft = pendFromTo_(p);
  if (who === 'mgr') {
    return '<div class="op2-pend">логист предлагает замену → <span class="' + ft.cls + '">' + esc(ft.to) + '</span> · <b>ждёт вашего подтверждения</b></div>';
  }
  return '<div class="op2-pend" title="Замена вне заявленных на заявке под данные: ждёт, пока менеджер согласует с заказчиком">замена → <span class="' +
    ft.cls + '">' + esc(ft.to) + '</span>' + (ft.extra ? ' · ' + esc(ft.extra) : '') + ' · <b>ждёт менеджера</b></div>';
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
      (h.driver_name ? ' · ' + esc(h.driver_name) : '') + (h.carrier_status ? ' · ' + esc(h.carrier_status) : '') + '</span></div>' + takenByBadge_(o) + pendHtml(o, 'log');
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
      '</div>' + okBtn(v) + '</div>' + takenByBadge_(o) + pendHtml(o, 'log');
  }
  return '<div class="op2-vehrow"><div class="op2-veh op2-multi" data-oid="' + esc(o.id) + '">' +
    vs.map(function (v) {
      return '<div class="op2-row"><span class="op2-gos' + (v.driver_confirmed_at ? ' op2-ok' : '') + '">' + esc(v.vehicle_gos || '') + '</span>' +
        '<span class="op2-drv">' + esc(v.driver_name || '') + (v.role ? ' · ' + (v.role === 'reserve' ? 'резерв' : 'основная') : '') + (v.driver_confirmed_at ? ' · подтвердил' : '') + '</span></div>';
    }).join('') + '</div><div style="display:flex;flex-direction:column;gap:2px">' + vs.map(okBtn).join('') + '</div></div>' + takenByBadge_(o) + pendHtml(o, 'log');
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
    /* Влад 12.09 (живой тест): «фильтр должен фильтровать, но почему-то не фильтрует» -
       раньше новая заявка (isFresh) показывалась ВСЕГДА, в обход любого фильтра (типа
       техники, поиска, «Без машины», «Под данные») - две тестовые заявки разных типов обе
       остались видны при фильтре «Трал». Свежесть теперь не обходит фильтры - она только
       подсвечивает строку (op2-new-halo ниже) и считается отдельным счётчиком «Новые»
       (F.newOnly ниже даёт целенаправленно посмотреть все новые через один клик). */
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
    { label: 'Повторить', fn: function () { openRepeat(o); } },
    { label: 'Отбой', fn: function () { setStatus(o, 'ot'); } },
    { label: 'Копировать данные на пропуск', fn: function () { copyText(passText(o), 'Данные на пропуск скопированы'); } }
  ].concat(isAdmin() ? [{ label: 'Удалить заявку', fn: function () { deleteOrder(o); } }] : []);
}
function logRowMenu(o) {
  var items = [];
  if (!o.taken_by_name) items.push({ label: 'Беру в работу', fn: function () { apiPost('/orders/take', { id: o.id }).then(function (r) { if (ok_(r)) { S.tickUp(); toast('Взял в работу заявку №' + esc(oNo(o))); loadOrders(); } }); } });
  items.push({ label: 'Добавить вторую машину', fn: function () { var tr = $('#op2-log-body tr[data-oid="' + o.id + '"]'); openPop(tr || $('#op2-log-body'), o, true); } });
  items.push({ label: 'Все заявки этой машины →', fn: function () { showByVehicle(o); } });
  items.push({ label: 'История', fn: function () { openDrawerView(o, 'log', true); } });
  if (isAdmin()) items.push({ label: 'Удалить заявку', fn: function () { deleteOrder(o); } });
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
    : 'Сейчас: <b>без машины</b>' + (o.taken_by_name ? ' · ' + takenByHtml_(o, 'взял', '') : '');
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
    '<div class="op2-fld op2-sugg" id="op2-h-cobox"><label>Компания-перевозчик</label>' +
      '<input id="op2-h-co" autocomplete="off" placeholder="Начни вводить - по первым буквам" value="' + esc(h.carrier_name || '') + '" data-entity-id="' + esc(h.carrier_id || '') + '">' +
      '<div class="op2-list" id="op2-h-colist"></div>' +
      '<span class="op2-hint">Справочник юрлиц + кого уже возили</span></div>' +
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
  blockForeignAutofill_($('#op2-hstep'));
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
  wireMoneyInput_('op2-h-rate');
  /* Влад 12.09: «партнёру наёмной техники тоже должен быть справочник юридических лиц» -
     тот же принцип подсказок, что у «Заказчика» (fetchCustomers), отдельный источник
     (история наёмок + sprav_legal_entities, а не заказчики). Ручной ввод сбрасывает
     entity-привязку - если менеджер сам допечатал название, это уже не выбор из списка. */
  var coT = null;
  $('#op2-h-co').addEventListener('input', function () {
    $('#op2-pop-ok').textContent = 'Отдать наёмнику' + (this.value.trim() ? ' · ' + this.value.trim() : '');
    this.dataset.entityId = '';
    var v = this.value.trim(); clearTimeout(coT);
    if (v.length < 2) { $('#op2-h-cobox').classList.remove('op2-open'); return; }
    coT = setTimeout(function () { fetchCarriers(v); }, 250);
  });
  $('#op2-h-co').addEventListener('blur', function () { setTimeout(function () { $('#op2-h-cobox').classList.remove('op2-open'); }, 150); });
  $('#op2-h-colist').addEventListener('mousedown', function (e) {
    var it = e.target.closest('.op2-it'); if (!it) return;
    var inp = $('#op2-h-co');
    inp.value = it.dataset.name || ''; inp.dataset.entityId = it.dataset.eid || '';
    $('#op2-pop-ok').textContent = 'Отдать наёмнику' + (it.dataset.name ? ' · ' + it.dataset.name : '');
    $('#op2-h-cobox').classList.remove('op2-open');
  });
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
    carrier_id: $('#op2-h-co').dataset.entityId || '',
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
    closePop();
    /* Влад 12.09 (живой тест): «была под данные, но я смог изменить название компании-партнёра
       без согласования с менеджером» - смена перевозчика на «под данные» заявке теперь идёт
       тем же путём, что и замена своей машины вне заявленных: не применяется тихо, а ждёт
       менеджера. Компания на исполнителе остаётся прежней, пока не подтвердят. */
    if (r.data && r.data.pending) {
      S.attention();
      toast('Запрос на замену перевозчика: <span class="op2-warn">' + esc(co) + '</span> · заявка №' + esc(oNo(o)) +
        ' под данные · <b>менеджер согласует с заказчиком</b>', null, 9000);
      loadOrders();
      return;
    }
    S.tickUp();
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
      takenByHtml_(o, 'взял', 'op2-by') + '</div>' +
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
      '<span class="op2-by">' + okTxt + (o.taken_by_name ? ' · ' + takenByHtml_(o, 'взял', '') : '') + '</span></div>' +
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
    vehHtml = '<div class="op2-vehcard"><div class="op2-top"><span class="op2-dim">Машину ещё не поставили' + (o.taken_by_name ? ' · ' + takenByHtml_(o, 'принял', '') : '') + '</span></div>' +
      (isLog ? '<div class="op2-acts"><button class="op2-dbtn op2-primary" id="op2-d-put">Поставить машину</button>' +
        (o.taken_by_name ? '' : '<button class="op2-ghost" id="op2-d-take">Беру в работу</button>') + '</div>' : '') + '</div>';
  }

  var stSeg = !isLog ? '<div class="op2-sect"><div class="op2-t">Статус</div><div class="op2-seg" id="op2-d-st">' +
    Object.keys(ST_M).map(function (kk) { return '<button class="op2-chip' + (k === kk ? ' op2-on' : '') + '" data-st="' + kk + '">' + esc(ST_M[kk]) + '</button>'; }).join('') +
    '<span class="op2-hint op2-dim" style="align-self:center;margin-left:6px">один клик · логисты видят сразу</span></div></div>' : '';

  var p = o.pending_request;
  var pft = p ? pendFromTo_(p) : null;
  var pendBar = p ? '<div class="op2-cbar op2-pendbar"><div class="op2-grow"><b>' +
    (isLog ? 'Ждёт менеджера · замена' : 'Логист ' + esc(p.requested_by_name || '') + ' предлагает замену') + '</b> · <span class="' + pft.cls + '">' + esc(pft.from) + '</span> → <span class="' + pft.cls + '">' + esc(pft.to) + '</span>' +
    (pft.extra ? ' ' + esc(pft.extra) : '') + (p.requested_at ? ' · ' + esc(p.requested_at) : '') +
    ' · заявка под данные: данные на пропуск изменятся, нужно согласие заказчика</div>' +
    (isLog ? '<span class="op2-dim op2-sm">до ответа менеджера едет ' + esc(pft.from) + ' · позвони, если срочно</span>'
      : '<button class="op2-dbtn op2-primary" id="op2-d-approve">Подтвердить · заказчик согласен</button>' +
        '<button class="op2-ghost op2-red" id="op2-d-reject">Отклонить · едет ' + esc(pft.from) + '</button>') +
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
      (o.crm_deal_id ? kv('CRM', '<a href="#" class="op2-crmlink" data-deal="' + esc(o.crm_deal_id) + '">сделка №' + esc(o.crm_deal_id) + ' →</a>') : '') +
    '</div>' +
    '<div class="op2-sect"><div class="op2-t">История</div><ul class="op2-hist" id="op2-hist-box"><li><span class="op2-dim">загружаем…</span></li></ul></div>';

  $('#op2-d-foot').innerHTML = (isLog
    ? '<button class="op2-del" id="op2-d-otboy">Отбой по заявке</button>' + (canDone() ? '<button class="op2-ghost" id="op2-d-done">Выполнено</button>' : '')
    : '<button class="op2-del" id="op2-d-otboy">Отбой</button>' +
      '<button class="op2-ghost" id="op2-d-contract" title="Разовая договор-заявка заказчику: реквизиты, табличная часть, условия, печать и подпись - из заявки">Договор-заявка ⤓</button>' +
      '<button class="op2-ghost" id="op2-d-repeat">Повторить</button>') +
    '<button class="op2-dbtn op2-primary" id="op2-d-edit">Редактировать</button>';

  /* обработчики тела карточки */
  var body = $('#op2-d-body');
  var crmLink = $('.op2-crmlink', body);
  if (crmLink) crmLink.addEventListener('click', function (e) { e.preventDefault(); var id = +this.dataset.deal; closeDrawer(); if (window.CRM && CRM.openDeal) { showPage('crm', document.querySelector('[data-page="crm"]')); setTimeout(function () { CRM.openDeal(id); }, 400); } });
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
  var ft = pendFromTo_(p);
  apiPost('/orders/change_request_resolve', { id: p.id, action: action }).then(function (r) {
    if (!ok_(r)) return;
    if (action === 'approve') {
      S.tickUp();
      toast('Замена подтверждена: <span class="op2-tick">' + esc(ft.to) + (ft.extra ? ' · ' + esc(ft.extra) : '') + '</span> на №' + esc(oNo(o)) +
        ' · логисту ушло · <b>отправь заказчику новые данные на пропуск</b>', null, 9000);
    } else {
      S.tickDown();
      toast('Замена отклонена · на №' + esc(oNo(o)) + ' едет ' + esc(ft.from) + ' · логисту ушло');
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
  if (id === 'op2-d-repeat' && o) { openRepeat(o); return; }
  if (id === 'op2-d-edit' && o) { openDrawerForm(o, false, isMgr() ? 'mgr' : 'log'); return; }
  if (id === 'op2-d-back' && o) { openDrawerView(o, isMgr() ? 'mgr' : 'log'); return; }
  if (id === 'op2-rp-go' && o) { runRepeat(e.target, o); return; }
  if (e.target.classList.contains('op2-del')) {
    if (formMode && o && o.id && isAdmin()) { deleteOrder(o); return; }
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
var formPrefill = false;  /* форма новой заявки с полями из CRM-сделки (Влад 11.09: кнопка «Создать задание» в CRM) */
var PREFILL = null;       /* {crm_deal_id, customer, ...} - ждёт, пока страница построится и META придёт */
function dict(name) { return (META && META.dictionary && META.dictionary[name]) || []; }
function entities() { return (META && META.own_entities) || []; }
function internalCustomers() { return (META && (META.internal_customers || META.own_entities)) || []; }
/* Быстрые часы (Влад 11.09): на сегодня - следующие целые часы от «сейчас» (завожу в 19:00 -> 20, 21, 22, 23),
   на другой день - с 8 утра. Никаких «уже поздно - завтра»: день выбирает человек. */
function quickTimes(ds) {
  var isToday = ds === todayStr();
  if (!isToday) return { list: ['08:00', '09:00', '10:00', '11:00'], why: 'с утра' };
  var start = Math.ceil((nowMin() + 30) / 60) * 60, list = [];
  for (var i = 0; i < 4; i++) { var m = start + i * 60; if (m >= 24 * 60) break; list.push(hhmm(m)); }
  if (!list.length) return { list: ['08:00', '09:00', '10:00', '11:00'], why: 'сегодня часов не осталось - это уже утро' };
  return { list: list, why: 'ближайшие от ' + hhmm(nowMin()) };
}
/* «От кого» - сворачиваемый ряд (вариант А мозгового штурма, Влад 11.09: «однозначно
   вариант А»). Свёрнуто видно только выбранное юрлицо + «Ещё · N» - остальные не в
   DOM вовсе, до клика по «Ещё». Заново собирается и при выборе последнего заказчика
   (см. loadCustomerHistory ниже - там раньше искали чип по data-ent прямо в разметке,
   теперь он может быть свёрнут, поэтому там тоже зовём entRowHtml). */
function entChipHtml(e2, on) {
  var ready = !!(e2.has_bank && e2.has_stamp);
  var ttl = [e2.full_name || e2.name, e2.inn ? 'ИНН ' + e2.inn : '', e2.director || '', ready ? 'банк и печать есть' : ((e2.has_bank ? '' : 'нет банка ') + (e2.has_stamp ? '' : 'нет печати'))].filter(Boolean).join(' · ');
  return '<button class="op2-chip' + (on ? ' op2-on' : '') + '" data-ent="' + esc(e2.id) + '" title="' + esc(ttl) + '"' + (ready ? '' : ' style="opacity:.55"') + '>' + esc(e2.short || e2.name) + (ready ? '' : ' ·') + '</button>';
}
function entRowHtml(curId) {
  var list = entities();
  var cur = list.filter(function (e2) { return String(e2.id) === String(curId); })[0] || list[0];
  var restN = Math.max(0, list.length - 1);
  return (cur ? entChipHtml(cur, true) : '') +
    (restN ? '<button class="op2-chip" data-ent-more>Ещё <span class="op2-mono" style="color:var(--tint-amber)">' + restN + '</span></button>' : '');
}
function collapseEntRow(seg, curId) { seg.innerHTML = entRowHtml(curId); }
function expandEntRow(seg) {
  var more = seg.querySelector('[data-ent-more]'); if (!more) return;
  var curBtn = seg.querySelector('.op2-chip.op2-on');
  var curId = curBtn ? curBtn.dataset.ent : '';
  var oldRect = more.getBoundingClientRect();
  var rest = entities().filter(function (e2) { return String(e2.id) !== String(curId); });
  more.outerHTML = '<button class="op2-chip op2-ent-close" data-ent-close>×</button>';
  seg.insertAdjacentHTML('beforeend', rest.map(function (e2) { return entChipHtml(e2, false).replace('class="op2-chip', 'class="op2-chip op2-ent-enter'); }).join(''));
  var closeBtn = seg.querySelector('.op2-ent-close');
  var newRect = closeBtn.getBoundingClientRect();
  closeBtn.style.transform = 'translate(' + (oldRect.left - newRect.left) + 'px,' + (oldRect.top - newRect.top) + 'px)';
  requestAnimationFrame(function () { closeBtn.style.transform = 'none'; });
  $$('.op2-ent-enter', seg).forEach(function (c, i) { c.style.animationDelay = (i * 35) + 'ms'; });
  S.unfold(rest.length);
}

/* «Кто заказывает» (только логист) - та же гармошка, что «От кого» выше (Влад
   12.09: «по тем же принципам, как у нас и другие построенные гармошки»).
   «Внешний заказчик» - не отдельный контрол, а ПЕРВЫЙ пункт того же единого
   списка, что и юрлица (id пустая строка), поэтому вся ent-логика (свернуть/
   развернуть/подсветить активный) работает без изменений что для юрлица, что
   для «внешнего». */
function whoOptions_() {
  return [{ id: '', name: '', label: 'Внешний заказчик' }].concat(internalCustomers().map(function (x) {
    return { id: String(x.id), name: x.name, label: x.short || x.name, full_name: x.full_name };
  }));
}
function whoChipHtml(x, on) {
  return '<button class="op2-chip' + (on ? ' op2-on' : '') + '" data-who="' + esc(x.id) + '" data-name="' + esc(x.name) + '"' + (x.full_name ? ' title="' + esc(x.full_name) + '"' : '') + '>' + esc(x.label) + '</button>';
}
function whoRowHtml(curWho) {
  var opts = whoOptions_();
  var primary = opts.filter(function (x) { return x.label === 'ТП'; })[0] || opts[0];
  var cur = opts.filter(function (x) { return x.id === String(curWho || ''); })[0] || primary;
  var restN = Math.max(0, opts.length - 1);
  return whoChipHtml(cur, true) +
    (restN ? '<button class="op2-chip" data-who-more>Ещё <span class="op2-mono" style="color:var(--tint-amber)">' + restN + '</span></button>' : '');
}
function collapseWhoRow(seg, curWho) { seg.dataset.cur = curWho == null ? '' : curWho; seg.innerHTML = whoRowHtml(curWho); }
function expandWhoRow(seg) {
  var more = seg.querySelector('[data-who-more]'); if (!more) return;
  var curBtn = seg.querySelector('.op2-chip.op2-on');
  var curId = curBtn ? curBtn.dataset.who : '';
  var oldRect = more.getBoundingClientRect();
  var rest = whoOptions_().filter(function (x) { return x.id !== curId; });
  more.outerHTML = '<button class="op2-chip op2-ent-close" data-who-close>×</button>';
  seg.insertAdjacentHTML('beforeend', rest.map(function (x) { return whoChipHtml(x, false).replace('class="op2-chip', 'class="op2-chip op2-ent-enter'); }).join(''));
  var closeBtn2 = seg.querySelector('.op2-ent-close');
  var newRect2 = closeBtn2.getBoundingClientRect();
  closeBtn2.style.transform = 'translate(' + (oldRect.left - newRect2.left) + 'px,' + (oldRect.top - newRect2.top) + 'px)';
  requestAnimationFrame(function () { closeBtn2.style.transform = 'none'; });
  $$('.op2-ent-enter', seg).forEach(function (c, i) { c.style.animationDelay = (i * 35) + 'ms'; });
  S.unfold(rest.length);
}

/* «Тип техники» - тот же приём, перенесён по превью 11.09 (Влад: «давай внедряй»).
   Отличие от «От кого»: тут ВСЕГДА видны оба основных типа (Трал, Длинномер) - это не
   "текущий выбор", а быстрый доступ к двум самым частым; выбор виден третьим - .op2-on
   на одном из чипов (основном или раскрытом). При выборе из «Ещё» ряд сворачивается
   обратно (сам выбор не помещается среди двух постоянных мест) - сам чип уходит в
   начало ряда подсвеченным (см. eqRowHtml ниже); отдельный текст-подсказка убран
   12.09 при переносе редизайна (Влад 11.09: «оставь подсказку только по данные») -
   чипа достаточно, дублировать текстом незачем.
   seg.dataset.cur хранит текущее значение НЕЗАВИСИМО от того, виден ли его чип прямо
   сейчас - «×» без выбора обязан вернуть то, что было, а не потерять его.
   Устаревший тип (в заявке уже стоит, но в справочнике деактивирован - напр. старые
   градации трала по тоннажу при переходе на 4 позиции 11.09) показывается ОТДЕЛЬНЫМ
   тусклым чипом рядом с основными, а не молча теряется - тот же приём, что «нет банка»
   у юрлиц: чип есть, просто помечен как проблемный. */
function eqChipHtml(x, on, extraCls, gone) {
  return '<button class="op2-chip' + (on ? ' op2-on' : '') + (extraCls ? ' ' + extraCls : '') + '" data-eq="' + esc(x.value) + '"' +
    (gone ? ' title="Убрано из справочника - осталось только в этой заявке"' : '') + '>' + esc(x.value) + (gone ? ' ·' : '') + '</button>';
}
function eqRowHtml(curVal) {
  var eq = dict('equipment');
  var eqPrimary = eq.filter(function (x) { return x.primary; });
  var eqRest = eq.filter(function (x) { return !x.primary; });
  var isKnown = eqPrimary.concat(eqRest).some(function (x) { return x.value === curVal; });
  var html = eqPrimary.map(function (x) { return eqChipHtml(x, x.value === curVal); }).join('');
  if (curVal && !isKnown) html += eqChipHtml({ value: curVal }, true, 'op2-eq-gone', true);
  if (eqRest.length) html += '<button class="op2-chip" data-eq-more>Ещё <span class="op2-mono" style="color:var(--tint-amber)">' + eqRest.length + '</span></button>';
  return html;
}
function collapseEqRow(seg, curVal) { seg.dataset.cur = curVal || ''; seg.innerHTML = eqRowHtml(curVal); }
function expandEqRow(seg) {
  var more = seg.querySelector('[data-eq-more]'); if (!more) return;
  var curBtn = seg.querySelector('.op2-chip.op2-on');
  var curVal = curBtn ? curBtn.dataset.eq : '';
  var oldRect = more.getBoundingClientRect();
  var rest = dict('equipment').filter(function (x) { return !x.primary && x.value !== curVal; });
  more.outerHTML = '<button class="op2-chip op2-ent-close" data-eq-close>×</button>';
  seg.insertAdjacentHTML('beforeend', rest.map(function (x) { return eqChipHtml(x, false, 'op2-ent-enter'); }).join(''));
  var closeBtn = seg.querySelector('.op2-ent-close');
  var newRect = closeBtn.getBoundingClientRect();
  closeBtn.style.transform = 'translate(' + (oldRect.left - newRect.left) + 'px,' + (oldRect.top - newRect.top) + 'px)';
  requestAnimationFrame(function () { closeBtn.style.transform = 'none'; });
  $$('.op2-ent-enter', seg).forEach(function (c, i) { c.style.animationDelay = (i * 35) + 'ms'; });
  S.unfold(rest.length);
}

function openDrawerForm(o, repeat, who, prefill) {
  formMode = true; formRepeat = !!repeat; formPrefill = !!prefill; formWho = who || (isMgr() ? 'mgr' : 'log');
  formOrder = o || null;
  drawerOrder = o || null;
  openDrawer();
  renderForm();
  if (repeat && o) toast('Поля скопированы из №' + esc(oNo(o)) + ' · дата по умолчанию - завтра');
}
function renderForm() {
  var o = formOrder, repeat = formRepeat, isLog = formWho === 'log';
  var evening = false; /* Влад 11.09: «если сегодня завожу - сегодня; надо - руками нажму завтра» */
  var defDate = repeat ? addDays(todayStr(), 1) : (o ? o.service_date : DATE);
  var editing = !!(o && !repeat && !formPrefill);

  $('#op2-d-title').textContent = repeat ? 'Новая заявка · повтор №' + oNo(o) : (editing ? 'Заявка №' + oNo(o) + ' · редактирование' : (formPrefill ? 'Новая заявка · из CRM' + (o && o.crm_deal_id ? ' · сделка №' + o.crm_deal_id : '') : (isLog ? 'Новая заявка · логист' : 'Новая заявка')));
  $('#op2-d-sub').textContent = repeat ? 'все поля из №' + oNo(o) + ' · проверь дату и время'
    : humanDate(defDate) + ' · ' + ((ME && ME.name) || '') + (isLog ? ' · внутренняя перевозка или свой заказчик' : '');

  var eqPrimary0 = dict('equipment').filter(function (x) { return x.primary; });
  var curEq = o ? (o.equipment_type || '') : (eqPrimary0[0] ? eqPrimary0[0].value : '');
  var gabs = dict('gabarit').map(function (g) { return (g && g.value) || g; }); /* словарь отдаёт {value, primary} */
  var curGab = o ? (o.gabarit || '') : (gabs[0] || '');
  var curEnt = o && o.executor_entity_id ? String(o.executor_entity_id) : (entities()[0] ? String(entities()[0].id) : '');
  /* «Кто заказывает» (только логист) - Влад 12.09: «технопарк - основной внутренний
     заказчик, пусть будет по умолчанию, все остальные по нажатию гармошки». Дефолт
     ТОЛЬКО для НОВОЙ заявки (o нет вовсе) - у существующей заявки (правка/повтор/
     из CRM) всегда показываем то, что реально сохранено, включая явно внешнего
     заказчика (o.internal ложный при o != null) - не переинтерпретируем задним числом. */
  var whoPrimary0 = internalCustomers().filter(function (x) { return x.short === 'ТП'; })[0];
  var curWho = o ? (o.internal ? String(o.customer_entity_id) : '') : (whoPrimary0 ? String(whoPrimary0.id) : '');

  function optList(list, cur) {
    return list.map(function (x) { var val = (x && x.value != null) ? x.value : x; return '<option value="' + esc(val) + '"' + (String(cur) === String(val) ? ' selected' : '') + '>' + esc(val) + '</option>'; }).join('');
  }

  var hasContact = !!(o && (o.customer_contact_name || o.customer_contact_phone));
  $('#op2-d-body').innerHTML =
    '<div class="op2-cols"><div class="op2-main">' +
    '<div class="op2-sect"><div class="op2-t">Когда и для кого</div><div class="op2-grid2">' +
      '<div class="op2-fld"><label>Дата подачи</label><div class="op2-seg" id="op2-f-datebox">' +
        '<button class="op2-chip' + (defDate === todayStr() ? ' op2-on' : '') + '" data-d="' + esc(todayStr()) + '">Сегодня ' + esc(dm(todayStr())) + '</button>' +
        '<button class="op2-chip' + (defDate === addDays(todayStr(), 1) ? ' op2-on' : '') + '" data-d="' + esc(addDays(todayStr(), 1)) + '">Завтра ' + esc(dm(addDays(todayStr(), 1))) + '</button>' +
        '<span class="op2-datewrap"><button type="button" class="op2-calbtn" id="op2-f-calbtn" title="Выбрать другую дату"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg></button>' +
        '<input type="date" class="op2-dt op2-dt-hidden" id="op2-f-date" value="' + esc(defDate) + '" autocomplete="off" tabindex="-1"></span>' +
      '</div></div>' +

      '<div class="op2-fld"><label>Время подачи</label><div class="op2-timerow">' +
        '<button class="op2-stp" data-d="-30">−30</button>' +
        '<input id="op2-f-time" placeholder="--:--" title="Можно набрать 700 - станет 07:00" autocomplete="off" value="' + esc(o ? oTime(o) : '') + '">' +
        '<button class="op2-stp" data-d="30">+30</button>' +
        '<span class="op2-hint">↑/↓ ±30 мин</span></div><div class="op2-qk" id="op2-f-qk"></div></div>' +

      '<div class="op2-fld op2-full"><label>Тип техники</label><div class="op2-seg" id="op2-f-eq" data-cur="' + esc(curEq) + '">' +
        eqRowHtml(curEq) +
      '</div></div>' +

      '<div class="op2-fld op2-full"><label>От кого (исполнитель с нашей стороны)</label><div class="op2-seg" id="op2-f-ent">' +
        entRowHtml(curEnt) +
      '</div></div>' +

      (isLog ? '<div class="op2-fld op2-full"><label>Кто заказывает</label><div class="op2-seg" id="op2-f-who" data-cur="' + esc(curWho) + '">' +
        whoRowHtml(curWho) +
        '</div><span class="op2-hint">Внутренние заказы - с суммой, как обычные; менеджерам не показываются. Список - из Справочника юрлиц</span></div>' : '') +

      '<div class="op2-fld op2-sugg" id="op2-f-custbox"><label>Заказчик</label>' +
        '<input id="op2-f-cust" placeholder="Начни вводить - по первым буквам" autocomplete="off" value="' + esc(o ? o.customer : '') + '">' +
        '<div class="op2-list" id="op2-f-custlist"></div></div>' +

      '<div class="op2-fld op2-contact-fld' + (hasContact ? '' : ' op2-collapsed') + '" id="op2-f-custcontact-fld">' +
        '<label class="op2-contact-ph">.</label>' +
        '<button type="button" class="op2-add-contact" id="op2-f-custcontact-add"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Контакт заказчика</button>' +
        '<label class="op2-contact-lbl">Контакт заказчика</label>' +
        '<input id="op2-f-custcontact" placeholder="Имя · телефон" autocomplete="off" value="' + esc(o ? [o.customer_contact_name, o.customer_contact_phone].filter(Boolean).join(' · ') : '') + '">' +
        '<span class="op2-hint" id="op2-f-custcontact-hint">Подсказки - контакты этого заказчика по прошлым заявкам</span></div>' +

      '<div class="op2-fld op2-full op2-nd-fld"><label><input type="checkbox" class="op2-cb" id="op2-f-nd-cb"' + (o && o.needs_data ? ' checked' : '') + '>Под данные</label>' +
        '<button type="button" class="op2-info-dot" id="op2-f-nd-info" title="Что это">i</button></div>' +
    '</div></div>' +

    '<div class="op2-sect"><div class="op2-t">Откуда - куда</div><div class="op2-grid2">' +
      '<div class="op2-fld op2-full op2-sugg" id="op2-f-frombox"><label' + (isLog ? ' class="op2-lbl-flex"' : '') + '><span>Адрес погрузки</span>' +
        (isLog ? '<button type="button" class="op2-addr-base" data-side="from">База</button>' : '') + '</label>' +
        '<input id="op2-f-from" placeholder="Адрес, ссылка на карту или координаты 55.75, 37.62" autocomplete="off" value="' + esc(o ? o.load_address : '') + '">' +
        '<div class="op2-list" id="op2-f-fromlist"></div>' +
        '<span class="op2-hint op2-okc" id="op2-f-fromhint">' + (o && o.load_lat ? esc(o.load_lat + ' · ' + o.load_lon) : '') + '</span></div>' +
      '<div class="op2-fld"><label>Контакт на погрузке</label><input id="op2-f-fromcontact" placeholder="Имя · телефон" autocomplete="off" value="' + esc(o ? [o.load_contact_name, o.load_contact_phone].filter(Boolean).join(' · ') : '') + '"></div>' +
      '<div class="op2-fld"><label>Контакт на выгрузке</label><input id="op2-f-tocontact" placeholder="Имя · телефон" autocomplete="off" value="' + esc(o ? [o.unload_contact_name, o.unload_contact_phone].filter(Boolean).join(' · ') : '') + '"></div>' +
      '<div class="op2-fld op2-full op2-sugg" id="op2-f-tobox"><label' + (isLog ? ' class="op2-lbl-flex"' : '') + '><span>Адрес выгрузки</span>' +
        (isLog ? '<button type="button" class="op2-addr-base" data-side="to">База</button>' : '') + '</label>' +
        '<input id="op2-f-to" placeholder="Адрес, ссылка на карту или координаты" autocomplete="off" value="' + esc(o ? o.unload_address : '') + '">' +
        '<div class="op2-list" id="op2-f-tolist"></div>' +
        '<span class="op2-hint op2-warn" id="op2-f-tohint"></span></div>' +
    '</div></div>' +
    '</div>' +

    '<div class="op2-side"><div class="op2-card">' +
    '<div class="op2-sect"><div class="op2-t">Что везём</div></div>' +
      '<div class="op2-fld op2-sugg" id="op2-f-cargobox"><label>Груз</label><input id="op2-f-cargo" placeholder="начни вводить: jcb 3, bg 40, морск, быт…" autocomplete="off" value="' + esc(o ? o.cargo : '') + '">' +
        '<div class="op2-list" id="op2-f-cargolist"></div><span class="op2-hint" id="op2-f-cargo-hint">Подсказки - справочник техники и что уже возили; вес и Д×Ш×В подставятся сами</span></div>' +
      '<div class="op2-grid2" style="grid-template-columns:1fr 1.6fr">' +
        '<div class="op2-fld"><label>Вес, т</label><input id="op2-f-weight" class="op2-mono" inputmode="decimal" placeholder="8" autocomplete="off" value="' + esc(o ? (o.cargo_weight_t || '') : '') + '"></div>' +
        '<div class="op2-fld"><label>Габарит</label><div class="op2-seg" id="op2-f-gab">' +
          gabs.map(function (g) { return '<button class="op2-chip' + (g === curGab ? ' op2-on' : '') + '" data-gab="' + esc(g) + '">' + esc(g) + '</button>'; }).join('') +
        '</div></div>' +
      '</div>' +
      '<div class="op2-fld"><label>Габариты груза</label><input id="op2-f-dims" placeholder="Д × Ш × В" autocomplete="off" value="' + esc(o ? (o.cargo_dims || '') : '') + '"></div>' +
      '<div class="op2-fld"><label>Документы</label><select id="op2-f-docs"><option value="">—</option>' + optList(dict('documents'), o ? o.documents : '') + '</select></div>' +
      '<div class="op2-fld"><label>Условия переработки</label><select id="op2-f-rework"><option value="">—</option>' + optList(dict('rework'), o ? o.rework_terms : '') + '</select></div>' +
    '</div>' +
    '<div class="op2-card">' +
    '<div class="op2-sect"><div class="op2-t">Деньги</div></div>' +
      '<div class="op2-fld"><label>Стоимость, ₽</label><input id="op2-f-price" class="op2-mono" inputmode="numeric" placeholder="38 000" autocomplete="off" value="' + esc(o && num(o.price) ? o.price : '') + '"></div>' +
      '<div class="op2-fld"><label>Статус оплаты</label><select id="op2-f-pay"><option value="">—</option>' + optList(dict('payment_status'), o ? o.payment_status : '') + '</select></div>' +
      '<div class="op2-fld"><label><input type="checkbox" class="op2-cb" id="op2-f-cash"' + (o && o.cash ? ' checked' : '') + '>Наличные</label></div>' +
    '</div>' +
    '</div>' +
    '</div>' +

    '<div class="op2-sect"><div class="op2-t">Примечание</div><div class="op2-fld"><textarea id="op2-f-note" rows="3" placeholder="Что логисту важно знать">' + esc(o ? (o.note || '') : '') + '</textarea></div></div>';

  $('#op2-d-foot').innerHTML = '<button class="op2-del">' + ((editing && isAdmin()) ? 'Удалить' : 'Отмена') + '</button>' +
    '<span class="op2-dim op2-sm" id="op2-f-state"></span>' +
    '<button class="op2-dbtn op2-primary op2-blocked" id="op2-f-save">Укажи заказчика</button>';

  wireForm();
}
function wireForm() {
  wireMoneyInput_('op2-f-price');
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
    b.addEventListener('click', function () { ft.value = hhmm(tmin(normT(ft.value) || '08:00') + (+this.dataset.d)); if (+this.dataset.d > 0) S.stepUp(); else S.stepDown(); tickState(); });
  });
  var calBtn = $('#op2-f-calbtn'), dateNative = $('#op2-f-date');
  $('#op2-f-datebox').addEventListener('click', function (e) {
    var b = e.target.closest('.op2-chip'); if (!b) return;
    $$('.op2-chip', this).forEach(function (x) { x.classList.remove('op2-on'); });
    b.classList.add('op2-on');
    dateNative.value = b.dataset.d;
    calBtn.classList.remove('op2-on'); calBtn.title = 'Выбрать другую дату';
    drawQk();
  });
  /* иконка-календарь вместо всегда видимого <input type=date> (Влад 11.09, перенос
     редизайна 12.09) - сам input остаётся в DOM (скрыт визуально), showPicker() его
     открывает; выбор даты вне Сегодня/Завтра виден по подсветке кнопки и её title,
     как в утверждённом превью - отдельного текстового поля под датой нет */
  calBtn.addEventListener('click', function () {
    S.nav();
    if (dateNative.showPicker) { try { dateNative.showPicker(); return; } catch (e) {} }
    dateNative.focus(); dateNative.click();
  });
  dateNative.addEventListener('change', function () {
    $$('#op2-f-datebox .op2-chip').forEach(function (x) { x.classList.toggle('op2-on', x.dataset.d === this.value); }, this);
    var isPreset = !!$('#op2-f-datebox .op2-chip.op2-on');
    calBtn.classList.toggle('op2-on', !isPreset);
    calBtn.title = isPreset ? 'Выбрать другую дату' : humanDate(this.value);
    drawQk();
  });
  $('#op2-f-eq').addEventListener('click', function (e) {
    var seg = this;
    // stopPropagation - та же причина, что у «От кого» (см. коммент там): смена
    // разметки внутри отвязывает e.target ДО всплытия к звуковому делегату на
    // document, генерический S.nav() наложился бы поверх S.unfold()/S.fold().
    e.stopPropagation();
    if (e.target.closest('[data-eq-more]')) { expandEqRow(seg); return; }
    if (e.target.closest('[data-eq-close]')) {
      S.fold(); collapseEqRow(seg, seg.dataset.cur); return;
    }
    var pick = e.target.closest('.op2-chip[data-eq]'); if (!pick) return;
    // «Развёрнуто» - по наличию «×», а не по числу чипов: устаревший (op2-eq-gone) тип
    // сам по себе добавляет чип и в свёрнутом виде, так что счёт по длине был бы неверен.
    var wasOpen = !!seg.querySelector('[data-eq-close]');
    collapseEqRow(seg, pick.dataset.eq);
    if (wasOpen) S.fold();
  });
  $('#op2-f-ent').addEventListener('click', function (e) {
    var seg = this;
    // stopPropagation - ОБЯЗАТЕЛЬНО: expandEntRow/collapseEntRow меняют DOM (outerHTML/
    // innerHTML), из-за чего e.target становится «отвязанным» узлом ДО того, как клик
    // всплывёт до общего звукового делегата на document - .closest(RESULT_SEL) на
    // отвязанном узле не находит #op2-f-ent предком и НЕ срабатывает, генерический
    // S.nav() наложился бы поверх S.unfold()/S.fold() (поймано на живой проверке 11.09 -
    // звук «гармошки» шёл вместе с обычным щелчком, а не вместо него). Звук здесь и
    // только здесь - решаем сами, выше не пускаем.
    e.stopPropagation();
    if (e.target.closest('[data-ent-more]')) { expandEntRow(seg); return; }
    if (e.target.closest('[data-ent-close]')) {
      var cur0 = seg.querySelector('.op2-chip.op2-on');
      S.fold(); collapseEntRow(seg, cur0 ? cur0.dataset.ent : ''); return;
    }
    var pick = e.target.closest('.op2-chip[data-ent]'); if (!pick) return;
    var wasOpen = seg.querySelectorAll('.op2-chip[data-ent]').length > 1;
    collapseEntRow(seg, pick.dataset.ent);
    if (wasOpen) S.fold();
  });
  var gab = $('#op2-f-gab');
  if (gab) gab.addEventListener('click', function (e) {
    var b = e.target.closest('.op2-chip'); if (!b) return;
    $$('.op2-chip', this).forEach(function (x) { x.classList.remove('op2-on'); });
    b.classList.add('op2-on');
  });
  var fw = $('#op2-f-who');
  if (fw) {
    var applyWho = function (btn) {
      var fc = $('#op2-f-cust');
      if (btn.dataset.who) { fc.value = btn.dataset.name; fc.readOnly = true; }
      else if (fc.readOnly) { fc.value = ''; fc.readOnly = false; }
    };
    fw.addEventListener('click', function (e) {
      var seg = this;
      // stopPropagation - та же причина, что у «От кого»/«Тип техники»: outerHTML
      // отвязывает e.target ДО всплытия к звуковому делегату на document.
      e.stopPropagation();
      if (e.target.closest('[data-who-more]')) { expandWhoRow(seg); return; }
      if (e.target.closest('[data-who-close]')) {
        var cur0 = seg.querySelector('.op2-chip.op2-on');
        S.fold(); collapseWhoRow(seg, cur0 ? cur0.dataset.who : ''); return;
      }
      var pick = e.target.closest('.op2-chip[data-who]'); if (!pick) return;
      var wasOpen = seg.querySelectorAll('.op2-chip[data-who]').length > 1;
      collapseWhoRow(seg, pick.dataset.who);
      applyWho(seg.querySelector('.op2-chip.op2-on'));
      tickState();
      if (wasOpen) S.fold();
    });
    var wb0 = $('#op2-f-who .op2-chip.op2-on'); if (wb0 && wb0.dataset.who) applyWho(wb0);
  }

  /* «Под данные» - единственная оставшаяся подсказка спрятана за точку (i), перенос
     редизайна 12.09 (Влад 11.09: «оставь подсказку только по данные») */
  var ndInfo = $('#op2-f-nd-info');
  ndInfo.addEventListener('click', function (e) {
    e.stopPropagation();
    var already = this.classList.contains('op2-open');
    $$('.op2-info-pop').forEach(function (p) { p.remove(); });
    $$('.op2-info-dot').forEach(function (d) { d.classList.remove('op2-open'); });
    if (already) return;
    this.classList.add('op2-open');
    var pop = document.createElement('div'); pop.className = 'op2-info-pop';
    pop.textContent = 'Заказчику нужны данные водителя заранее (пропускной режим). После планирования машину и водителя не меняют без согласования - логист заявит основную и резервную, данные обоих уйдут заказчику.';
    this.closest('.op2-nd-fld').appendChild(pop);
    requestAnimationFrame(function () { pop.classList.add('op2-open'); });
  });

  /* «Контакт заказчика» - скрыт за кнопкой, пока не нажали (Влад 11.09: «почти никто
     не вводит») - поле остаётся в DOM (collectForm читает его безусловно), кнопка
     только снимает класс op2-collapsed */
  var addContactBtn = $('#op2-f-custcontact-add');
  if (addContactBtn) addContactBtn.addEventListener('click', function () {
    S.nav();
    $('#op2-f-custcontact-fld').classList.remove('op2-collapsed');
    $('#op2-f-custcontact').focus();
  });

  /* подсказки заказчика */
  var custT = null;
  $('#op2-f-cust').addEventListener('input', function () {
    tickState();
    var v = this.value.trim();
    clearTimeout(custT);
    if (v.length < 2) { $('#op2-f-custbox').classList.remove('op2-open'); return; }
    var digits = v.replace(/\D/g, '');
    /* ИНН (10/12 цифр) - ищем контрагента по ИНН: справочник -> DaData (Влад 11.09) */
    if (/^\d+$/.test(v) && (digits.length === 10 || digits.length === 12)) { custT = setTimeout(function () { fetchInn(digits); }, 250); return; }
    custT = setTimeout(function () { fetchCustomers(v); }, 250);
  });
  $('#op2-f-custlist').addEventListener('mousedown', function (e) {
    var sv = e.target.closest('.op2-inn-save');
    if (sv) { e.preventDefault(); saveInn(sv); return; }
    var it = e.target.closest('.op2-it'); if (!it) return;
    $('#op2-f-cust').value = it.dataset.name || '';
    $('#op2-f-custbox').classList.remove('op2-open');
    if (it.dataset.eid) $('#op2-f-cust').dataset.entityId = it.dataset.eid;
    fetchCustomerHistory(it.dataset.name || '');
    tickState();
  });
  $('#op2-f-cust').addEventListener('blur', function () { setTimeout(function () { $('#op2-f-custbox').classList.remove('op2-open'); }, 150); });
  /* помощник груза: справочник техники + история; выбор заполняет вес, Д×Ш×В, габарит и ставит «проверить» */
  var cargoT = null;
  $('#op2-f-cargo').addEventListener('input', function () {
    tickState();
    var v = this.value.trim(); clearTimeout(cargoT);
    if (v.length < 2) { $('#op2-f-cargobox').classList.remove('op2-open'); return; }
    cargoT = setTimeout(function () { fetchCargo(v); }, 200);
  });
  $('#op2-f-cargo').addEventListener('blur', function () { setTimeout(function () { $('#op2-f-cargobox').classList.remove('op2-open'); }, 150); });
  $('#op2-f-cargolist').addEventListener('mousedown', function (e) {
    var it = e.target.closest('.op2-it'); if (!it || !it.dataset.name) return;
    e.preventDefault(); applyCargo(it.dataset);
  });

  /* подсказки адресов из истории заказчика */
  function applyAddr_(side, address, lat, lon, hintText) {
    var inp = $('#op2-f-' + side);
    inp.value = address || ''; inp.dataset.lat = lat || ''; inp.dataset.lon = lon || '';
    var hint = $('#op2-f-' + side + 'hint');
    if (hint) { hint.textContent = lat ? (lat + ' · ' + lon) : (hintText || ''); hint.className = 'op2-hint op2-okc'; }
    $('#op2-f-' + side + 'box').classList.remove('op2-open');
    tickState();
  }
  ['from', 'to'].forEach(function (side) {
    var inp = $('#op2-f-' + side);
    inp.addEventListener('focus', function () { if ($('#op2-f-' + side + 'list').querySelector('.op2-it')) $('#op2-f-' + side + 'box').classList.add('op2-open'); });
    inp.addEventListener('blur', function () { setTimeout(function () { $('#op2-f-' + side + 'box').classList.remove('op2-open'); }, 150); tickState(); });
    inp.addEventListener('input', function () { fetchGeoSuggest(side, this.value); });
    $('#op2-f-' + side + 'list').addEventListener('mousedown', function (e) {
      var it = e.target.closest('.op2-it'); if (!it) return;
      applyAddr_(side, it.dataset.address, it.dataset.lat, it.dataset.lon, 'из истории заказчика');
      if (it.dataset.cname || it.dataset.cphone) {
        $('#op2-f-' + side + 'contact').value = [it.dataset.cname, it.dataset.cphone].filter(Boolean).join(' · ');
      }
    });
  });
  /* Влад 12.09: «даже просто должна быть где-то кнопка «Адрес погрузки»/«Адрес выгрузки», просто
     база, чтобы нажал быстро и всё» - «это только логистов» (кнопка и так рисуется только у isLog,
     см. renderForm). Координаты - точный ответ DaData на этот же адрес, захардкожены, а не считаются
     заново на каждом клике: адрес базы не «плавает», отдельный сетевой запрос тут не нужен. */
  $$('.op2-addr-base').forEach(function (btn) {
    btn.addEventListener('mousedown', function (e) {
      e.preventDefault();
      applyAddr_(btn.dataset.side, BASE_ADDRESS_, BASE_LAT_, BASE_LON_);
      S.tickUp();
    });
  });

  $$('#op2-d-body input,#op2-d-body select,#op2-d-body textarea').forEach(function (i) { i.addEventListener('input', tickState); });
  blockForeignAutofill_($('#op2-d-body'));
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
  /* Влад 12.09: «создание заявки невозможно, пока не внесут цену - и логисты в своих заявках,
     и менеджеры» - жёсткий блок наравне с заказчиком/техникой, без исключения по роли. Только
     на СОЗДАНИИ (та же граница, что и на сервере) - правку старой заявки без цены не блокируем
     задним числом, editing вычисляется как в saveForm(). */
  var creating = !(formOrder && !formRepeat && !formPrefill);
  if (creating && !num(($('#op2-f-price') || {}).value)) {
    b.className = 'op2-dbtn op2-primary op2-blocked'; b.textContent = 'Укажи цену'; st.textContent = ''; return;
  }
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
  // ВАЖНО: не искать .op2-chip.op2-on - выбор из «Ещё» сворачивается назад в [Трал]
  // [Длинномер][Ещё], сам чип выбранного (напр. «Тент») в DOM не остаётся вообще (виден
  // только текстом в подсказке). seg.dataset.cur - единственный источник истины, который
  // переживает сворачивание; собирается им же в collapseEqRow. Без этой правки форма
  // тихо уходила бы на сервер с пустым типом техники при любом выборе не из primary -
  // поймано на живой проверке 11.09.
  var seg = $('#op2-f-eq');
  return seg ? (seg.dataset.cur || '') : '';
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
/* Влад 12.09: «партнёру наёмной техники тоже должен быть справочник юридических лиц» - тот же
   принцип, что и у «Заказчика» (fetchCustomers выше), только своя история вместо «моих
   заказов» - «кого уже возили В ЭТОМ МЕСЯЦЕ» (второй заход, сервер сам режет по service_date
   текущего календарного месяца), не всё время. */
function fetchCarriers(q) {
  apiGet('/orders/carriers', { q: q }).then(function (r) {
    if (!r || !r.ok || !r.data || r.data.error) return;
    var hist = r.data.history || [], all = r.data.all || [];
    var h = '';
    if (hist.length) h += '<div class="op2-sec">Уже возили в этом месяце</div>' + hist.slice(0, 6).map(function (c) {
      return '<div class="op2-it" data-name="' + esc(c.name) + '"' + (c.entity_id ? ' data-eid="' + esc(c.entity_id) + '"' : '') + '><span>' + esc(c.name) + '</span><span class="op2-m">' + esc(c.n || '') + '×</span></div>';
    }).join('');
    if (all.length) h += '<div class="op2-sec">Справочник юрлиц</div>' + all.slice(0, 10).map(function (c) {
      return '<div class="op2-it" data-name="' + esc(c.name) + '" data-eid="' + esc(c.id) + '"><span>' + esc(c.name) + '</span><span class="op2-m">' + esc(c.inn || '') + '</span></div>';
    }).join('');
    h += '<div class="op2-it" data-name="' + esc(q) + '"><span>Новый: «' + esc(q) + '»</span><span class="op2-m">как ввели</span></div>';
    $('#op2-h-colist').innerHTML = h;
    $('#op2-h-cobox').classList.add('op2-open');
  }).catch(function () {});
}
function fetchInn(inn) {
  apiGet('/orders/inn', { inn: inn }).then(function (r) {
    if (!r || !r.data) return;
    var d = r.data, h = '';
    if (d.error) h = '<div class="op2-sec">По ИНН</div><div class="op2-it" data-name=""><span class="op2-dim">' + esc(d.error) + '</span></div>';
    else if (d.found === 'sprav') {
      var e = d.entity;
      h = '<div class="op2-sec">По ИНН · в справочнике</div><div class="op2-it" data-name="' + esc(e.name) + '" data-eid="' + esc(e.id) + '"><span>' + esc(e.name) + '</span><span class="op2-m">ИНН ' + esc(e.inn) + (e.is_own ? ' · своё' : '') + '</span></div>';
    } else if (d.found === 'dadata') {
      var x = d.entity;
      h = '<div class="op2-sec">По ИНН · найдено в ЕГРЮЛ, в справочнике ещё нет</div>' +
        '<div class="op2-it" data-name="' + esc(x.name) + '"><span>' + esc(x.name) + '<span class="op2-dim op2-sm"> · ' + esc((x.legal_address || '').slice(0, 60)) + (x.director_name ? ' · ' + esc(x.director_name) : '') + '</span></span><span class="op2-m">ИНН ' + esc(x.inn) + '</span></div>' +
        '<div class="op2-it op2-inn-row"><button class="op2-ghost op2-inn-save" data-inn="' + esc(x.inn) + '" data-name="' + esc(x.name) + '" data-full="' + esc(x.full_name || '') + '" data-kpp="' + esc(x.kpp || '') + '" data-ogrn="' + esc(x.ogrn || '') + '" data-addr="' + esc(x.legal_address || '') + '" data-dir="' + esc(x.director_name || '') + '" data-post="' + esc(x.director_post || '') + '" data-status="' + esc(x.egrul_status || '') + '">Сохранить в справочник и подставить</button></div>';
    } else h = '<div class="op2-sec">По ИНН</div><div class="op2-it" data-name=""><span class="op2-dim">ИНН ' + esc(inn) + ' не найден - проверь цифры</span></div>';
    if (d.found) h += '<div class="op2-it op2-inn-row" id="op2-inn-risk"><span class="op2-dim op2-sm">проверяем контрагента…</span></div>';
    $('#op2-f-custlist').innerHTML = h;
    $('#op2-f-custbox').classList.add('op2-open');
    if (d.found) innRisk(inn);
  }).catch(function () {});
}
/* Светофор контрагента прямо в подсказке (Влад 11.09: «при вводе ИНН сразу лампочку и кратко справку») -
   тот же /counterparty/check, что на странице «Проверка контрагента» (admin/manager; логисту 403 - молча). */
function innRisk(inn) {
  apiPost('/counterparty/check', { inn: inn }).then(function (r) {
    var box = $('#op2-inn-risk'); if (!box) return;
    if (!r || !r.ok || !r.data || r.data.error) { box.innerHTML = '<span class="op2-dim op2-sm">' + (r && r.data && r.data.error ? esc(r.data.error) : 'проверка недоступна') + '</span>'; return; }
    var d = r.data, c = d.card || {};
    var col = (d.light === 'red' || d.light === 'bankrupt') ? 'var(--tint-red)' : d.light === 'yellow' ? 'var(--tint-amber)' : d.light === 'green' ? 'var(--tint-green)' : 'var(--muted)';
    var lbl = d.light === 'bankrupt' ? 'Банкрот' : d.light === 'red' ? 'Красный' : d.light === 'yellow' ? 'Жёлтый' : d.light === 'green' ? 'Зелёный' : 'нет данных';
    var mln = function (v) { v = Number(v); if (!v) return ''; return v >= 1e9 ? (v / 1e9).toFixed(1).replace('.', ',') + ' млрд ₽' : v >= 1e6 ? Math.round(v / 1e6) + ' млн ₽' : Math.round(v / 1e3) + ' тыс ₽'; };
    var facts = [];
    if (c.status) facts.push(c.status);
    if (c.reg_date) facts.push('с ' + String(c.reg_date).slice(0, 4));
    if (c.revenue) facts.push('выручка ' + mln(c.revenue) + (c.revenueYear ? ' (' + c.revenueYear + ')' : ''));
    if (c.employees) facts.push('сотр. ' + c.employees);
    if (Number(c.nedoimka) > 0) facts.push('недоимка ' + mln(c.nedoimka));
    var reasons = (d.reasons || []).slice(0, 2);
    box.innerHTML = '<div style="display:flex;flex-direction:column;gap:3px;min-width:0">' +
      '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + col + ';margin-right:6px;vertical-align:middle' + (d.pulse ? ';box-shadow:0 0 0 3px rgba(226,75,74,.25)' : '') + '"></span><b style="color:' + col + '">' + esc(lbl) + '</b>' + (d.marker ? ' <b style="color:' + col + '">' + esc(d.marker) + '</b>' : '') +
      (facts.length ? ' <span class="op2-dim op2-sm">· ' + esc(facts.join(' · ')) + '</span>' : '') + '</span>' +
      (reasons.length ? '<span class="op2-dim op2-sm">' + reasons.map(esc).join(' · ') + '</span>' : '') +
      (d.from_cache && d.checked_at ? '<span class="op2-dim op2-sm">проверено ' + esc(d.checked_at) + '</span>' : '') + '</div>';
  }).catch(function () { var box = $('#op2-inn-risk'); if (box) box.innerHTML = '<span class="op2-dim op2-sm">проверка недоступна</span>'; });
}
function saveInn(btn) {
  var d = btn.dataset;
  btn.disabled = true; btn.textContent = 'Сохраняем…';
  apiPost('/orders/inn_save', { inn: d.inn, name: d.name, full_name: d.full, kpp: d.kpp, ogrn: d.ogrn, legal_address: d.addr, director_name: d.dir, director_post: d.post, egrul_status: d.status }).then(function (r) {
    if (!ok_(r)) { btn.disabled = false; btn.textContent = 'Сохранить в справочник и подставить'; return; }
    var fc = $('#op2-f-cust'); fc.value = r.data.name || d.name; fc.dataset.entityId = r.data.id;
    $('#op2-f-custbox').classList.remove('op2-open');
    S.tickUp();
    toast((r.data.existed ? 'Уже в справочнике: ' : 'Сохранено в справочник: ') + '<span class="op2-tick">' + esc(r.data.name || d.name) + '</span> · ИНН ' + esc(d.inn));
    fetchCustomerHistory(fc.value); tickState();
  }).catch(function () { btn.disabled = false; });
}
function fetchCargo(q) {
  /* справочник техники экскаваторного отдела (Влад 12.09) - СТРОГО в форме логиста, менеджерам не нужен
     и не должен даже запрашиваться (сервер сам это перепроверяет ролью, тут просто не дёргаем зря). */
  var isLogForm = formWho === 'log';
  var reqs = [apiGet('/orders/cargo', { q: q })];
  if (isLogForm) reqs.push(apiGet('/orders/fleet', { q: q }).catch(function () { return null; }));
  Promise.all(reqs).then(function (results) {
    var r = results[0];
    if (!r || !r.ok || !r.data) return;
    var items = r.data.items || [], h = '';
    var cat = items.filter(function (i) { return i.src === 'catalog'; }), his = items.filter(function (i) { return i.src === 'history'; });
    var fleet = (isLogForm && results[1] && results[1].ok && results[1].data) ? (results[1].data.items || []) : [];
    var row = function (i) {
      var sub = (i.category ? esc(i.category) : '') + (i.n ? (i.category ? ' · ' : '') + 'возили ' + i.n + '×' : '');
      var nameCap = capFirst(i.name);
      return '<div class="op2-it op2-cargo-it" data-name="' + esc(nameCap) + '" data-w="' + esc(i.weight_t || '') + '" data-dims="' + esc(i.dims || '') + '" data-l="' + esc(i.length_m || '') + '" data-wd="' + esc(i.width_m || '') + '" data-h="' + esc(i.height_m || '') + '" data-note="' + esc(i.note || '') + '">' +
        '<div class="op2-cargo-main"><span class="op2-cargo-name">' + esc(nameCap) + '</span>' + (sub ? '<span class="op2-cargo-sub">' + sub + '</span>' : '') + '</div>' +
        '<div class="op2-cargo-meta">' + (i.weight_t ? '<span class="op2-cargo-w">' + esc(i.weight_t) + ' т</span>' : '') + (i.dims ? '<span class="op2-cargo-dims">' + esc(i.dims) + '</span>' : '') + '</div></div>';
    };
    var rowFleet = function (i) {
      var nameCap = capFirst(i.name);
      var sub = (i.category ? esc(i.category) : '') + (i.gos ? ' · г/н ' + esc(i.gos) : '');
      /* у своей техники нет веса/габаритов груза - применяем без пометки «проверить» (applyCargo не найдёт
         d.w/d.dims/габарит и промолчит), только модель + госномер подставляются в «Груз». */
      return '<div class="op2-it op2-cargo-it" data-name="' + esc(nameCap) + '" data-gos="' + esc(i.gos || '') + '">' +
        '<div class="op2-cargo-main"><span class="op2-cargo-name">' + esc(nameCap) + '</span>' + (sub ? '<span class="op2-cargo-sub">' + sub + '</span>' : '') + '</div>' +
        '<div class="op2-cargo-meta">' + (i.gos ? '<span class="op2-cargo-dims">' + esc(i.gos) + '</span>' : '') + '</div></div>';
    };
    if (fleet.length) h += '<div class="op2-sec">Наша техника (гос.номер)</div>' + fleet.map(rowFleet).join('');
    if (cat.length) h += '<div class="op2-sec">Справочник техники</div>' + cat.map(row).join('');
    if (his.length) h += '<div class="op2-sec">Уже возили</div>' + his.map(row).join('');
    if (!h) { $('#op2-f-cargobox').classList.remove('op2-open'); return; }
    $('#op2-f-cargolist').innerHTML = h;
    $('#op2-f-cargobox').classList.add('op2-open');
  }).catch(function () {});
}
/* прикидка габарита по транспортным размерам: шире 2,55 м, выше 3,0 м (с площадкой трала > 4 м) или длиннее 12 м - негабарит */
function guessGabarit(l, w, h) {
  l = Number(l) || 0; w = Number(w) || 0; h = Number(h) || 0;
  if (!l && !w && !h) return null;
  return (w > 2.55 || h > 3.0 || l > 12) ? 'Негабарит' : 'Габарит';
}
function applyCargo(d) {
  var fc = $('#op2-f-cargo'), fw = $('#op2-f-weight'), fd = $('#op2-f-dims'), note = $('#op2-f-note');
  /* Влад: «выбрал один груз, затем другой - данные от первого не поменялись» - явный повторный выбор
     из подсказки переписывает вес/габариты, даже если поля уже заполнены прошлым грузом. */
  var prevName = fc.dataset.cargoName || '';
  /* техника из справочника экскаваторов (d.gos) - у неё нет веса/габаритов груза, в «Груз» идёт
     модель + госномер, без пометки «проверить» (auto ниже останется пустым сам по себе). */
  var displayName = (d.name || '') + (d.gos ? ' · г/н ' + d.gos : '');
  var overwrite = prevName && prevName !== displayName;
  fc.value = displayName; fc.dataset.cargoName = displayName;
  var auto = [];
  if (d.w && (overwrite || !fw.value.trim())) { fw.value = d.w; auto.push('вес'); }
  if (d.dims && (overwrite || !fd.value.trim())) { fd.value = d.dims; auto.push('Д×Ш×В'); }
  var g = guessGabarit(d.l, d.wd, d.h);
  if (g) { $$('#op2-f-gab .op2-chip').forEach(function (x) { x.classList.toggle('op2-on', x.dataset.gab === g); }); auto.push('габарит'); }
  if (auto.length) {
    var tag = 'характеристики груза из справочника - проверить';
    if (note && note.value.indexOf(tag) < 0) note.value = (note.value.trim() ? note.value.trim() + ' · ' : '') + tag + (d.note ? ' (' + d.note + ')' : '');
    $('#op2-f-cargo-hint').innerHTML = '<span class="op2-warn">Подставлено из справочника: ' + esc(auto.join(', ')) + ' - проверь</span>' + (d.note ? ' · ' + esc(d.note) : '');
    S.tickUp();
  } else { $('#op2-f-cargo-hint').textContent = 'Подставлено: ' + (displayName || ''); }
  $('#op2-f-cargobox').classList.remove('op2-open');
  tickState();
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
    listSubSection_('from', 'op2-sub-hist').innerHTML = head + addr;
    listSubSection_('to', 'op2-sub-hist').innerHTML = head + addr;
    var c = (d.contacts || [])[0];
    if (c && !$('#op2-f-custcontact').value.trim()) {
      $('#op2-f-custcontact-hint').textContent = 'Из истории: ' + [c.name, fmtPhone(c.phone)].filter(Boolean).join(' · ');
    }
    /* «как в прошлой заявке этого заказчика» - только если менеджер ещё не выбрал сам.
       Ряд «От кого» теперь сворачиваемый (вариант А) - искомое юрлицо может быть НЕ в
       DOM (спрятано под «Ещё»), поэтому подставляем через collapseEntRow, а не прямым
       classList - она сама пересобирает ряд с нужным юрлицом видимым. */
    var entSeg = $('#op2-f-ent');
    var curOn = entSeg && entSeg.querySelector('.op2-chip.op2-on');
    if (d.last_executor_entity_id && !formOrder && entSeg &&
        (!curOn || String(curOn.dataset.ent) !== String(d.last_executor_entity_id))) {
      collapseEntRow(entSeg, d.last_executor_entity_id);
    }
  }).catch(function () {});
}
/* список подсказок адреса делится на два независимых подраздела - история заказчика
   (fetchCustomerHistory выше) и живой геокодинг (fetchGeoSuggest ниже) - каждый пишет
   только в свой div, не затирая другой при повторном срабатывании. */
function listSubSection_(side, cls) {
  var list = $('#op2-f-' + side + 'list');
  var sub = list.querySelector('.' + cls);
  if (!sub) { sub = document.createElement('div'); sub.className = cls; list.appendChild(sub); }
  return sub;
}
/* «Адреса» - живой геокодинг DaData (Влад 12.09: подключить то же, что уже работает в
   Калькуляторе - тот же сервер /api/geocoder/suggest, ключ уже там, ничего нового не
   заводим). dadataAddrParts_ - дословно тот же разбор полей, что и в files/index.html
   (Clc.geoc()/dadataAddrParts_), не изобретаем второй раз. */
function dadataAddrParts_(d) {
  d = d || {};
  var line = [d.street_with_type, d.house].filter(Boolean).join(', ');
  var first = line || d.settlement_with_type || d.city_with_type || d.region_with_type || '';
  var rest = [];
  if (line && line !== first) rest.push(line);
  if (d.city_district_with_type) rest.push(d.city_district_with_type);
  if (d.settlement_with_type && d.settlement_with_type !== first) rest.push(d.settlement_with_type);
  if (d.city_with_type && d.city_with_type !== first) rest.push(d.city_with_type);
  if (d.region_with_type && d.region_with_type !== d.city_with_type) rest.push(d.region_with_type);
  var seen = {};
  return [first].concat(rest).filter(function (v) { if (!v || seen[v]) return false; seen[v] = true; return true; });
}
var geoSuggestT_ = {};
function fetchGeoSuggest(side, q) {
  clearTimeout(geoSuggestT_[side]);
  var geoSub = listSubSection_(side, 'op2-sub-geo');
  if (!q || q.trim().length < 3) { geoSub.innerHTML = ''; return; }
  geoSuggestT_[side] = setTimeout(function () {
    apiGet('/geocoder/suggest', { q: q.trim() }).then(function (r) {
      var sug = (r && r.ok && r.data && r.data.suggestions) || [];
      var seen = {}, html = '';
      sug.forEach(function (f) {
        if (f.lat == null || f.lon == null) return;
        var parts = dadataAddrParts_(f);
        if (!parts[0]) return;
        var main = parts[0], sub = parts.slice(1, 3).join(', ');
        var key = main + '|' + sub;
        if (seen[key]) return;
        seen[key] = true;
        /* Влад 12.09: «улица Гагарина есть и в Новгороде, и в Великом Новгороде» -
           для логистики город/населённый пункт ОБЯЗАН остаться в сохранённом адресе,
           не только в серой строке подсказки. main (первая часть dadataAddrParts_)
           часто ТОЛЬКО улица+дом - в поле кладём f.value целиком (полный
           отформатированный адрес DaData, город уже внутри), main/sub - только
           для вида самой подсказки в списке. */
        html += '<div class="op2-it" data-address="' + esc(f.value || main) + '" data-lat="' + esc(f.lat) + '" data-lon="' + esc(f.lon) + '">' +
          '<span>' + esc(main) + '</span><span class="op2-m">' + esc(sub) + '</span></div>';
      });
      geoSub.innerHTML = html ? '<div class="op2-sec">Адреса</div>' + html : '';
      /* проверка фокуса - ответ может прийти уже после того, как менеджер кликнул
         мимо (blur закрывает бокс через 150мс); без неё список открылся бы заново
         сам по себе поверх уже незнакомого действия */
      if (html && document.activeElement === $('#op2-f-' + side)) {
        var box = $('#op2-f-' + side + 'box'); if (box) box.classList.add('op2-open');
      }
    }).catch(function () {});
  }, 400);
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
  var whoBtn = fw ? $('#op2-f-who .op2-chip.op2-on') : null;
  if (whoBtn && whoBtn.dataset.who) { payload.internal = 1; payload.customer_entity_id = whoBtn.dataset.who; }
  else if ($('#op2-f-cust').dataset.entityId) { payload.customer_entity_id = $('#op2-f-cust').dataset.entityId; }
  return payload;
}
function saveForm(btn) {
  if (btn.classList.contains('op2-blocked')) { toast('<span class="op2-warn">' + esc(btn.textContent) + '</span>'); return; }
  var warn = btn.classList.contains('op2-warn');
  var payload = collectForm();
  var editing = !!(formOrder && !formRepeat && !formPrefill);
  if (editing) payload.id = formOrder.id;
  if (formPrefill && formOrder && formOrder.crm_deal_id) payload.crm_deal_id = formOrder.crm_deal_id; /* связь с CRM-сделкой */
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

/* ═════════════════════════ ПОВТОРИТЬ (один экран: дни × количество × время) ═════════════════════════
   Влад 11.09: «не нужно три меню - одно "Повторить"; кликаешь на дату: один клик = одна заявка на эту
   дату; кликнул 5 раз на сегодня - 5 заявок на сегодня; 5 раз на всю неделю - по 5 на каждый день.
   Список - время подачи одинаковое (копия), чип −30/+30, прямо по списку выставляешь время и
   создаёшь массив». Клик по дню = +1, правый клик = −1; пресеты «Будни»/«Все 7 дней» - то же на
   каждый день группы. Все созданные - «Не подтверждено» (умолчание сервера), подтверждаются вручную. */
function dayLabel(d) {
  if (d === todayStr()) return 'Сегодня ' + dm(d);
  if (d === addDays(todayStr(), 1)) return 'Завтра ' + dm(d);
  return WD_SHORT[dObj(d).getDay()] + ' ' + dObj(d).getDate();
}
function openRepeat(o) {
  drawerOrder = o; formMode = false;
  openDrawer();
  var base = todayStr();                      /* окно - неделя от сегодня, независимо от даты образца */
  var days = [];
  for (var i = 0; i < 7; i++) {
    var d = addDays(base, i), wd = dObj(d).getDay();
    days.push({ d: d, l: dayLabel(d), wd: (wd !== 0 && wd !== 6) ? 1 : 0 });
  }
  var defTime = oTime(o) || '';
  var rows = [];                              /* {d, t} - по одной на будущую заявку, порядок = порядок кликов */
  $('#op2-d-title').textContent = 'Повторить №' + oNo(o);
  $('#op2-d-sub').textContent = (o.customer || '') + ' · ' + (o.equipment_type || '') + ' · ' + (defTime || 'время уточнить') +
    ' · ' + (o.load_address || '—') + ' → ' + (o.unload_address || '—');
  $('#op2-d-body').innerHTML =
    '<div class="op2-sect"><div class="op2-t">На какие дни и сколько</div><div class="op2-seg" id="op2-rp-days" style="flex-wrap:wrap">' +
      days.map(function (x) { return '<button class="op2-chip" data-d="' + esc(x.d) + '" data-wd="' + x.wd + '">' + esc(x.l) + '</button>'; }).join('') +
    '</div>' +
    '<div class="op2-qk" id="op2-rp-presets"><button class="op2-chip" data-preset="wd">Будни</button><button class="op2-chip" data-preset="all">Все 7 дней</button><button class="op2-chip" data-preset="none">Сбросить</button></div>' +
    '<span class="op2-hint">Клик по дню - <b>+1 заявка</b> на этот день, правый клик - −1. «Будни» / «Все 7 дней» - +1 на каждый день группы (5 кликов - по 5 на каждый). Заказчик, груз, адреса, цена, юрлицо - как в №' + esc(oNo(o)) + '.</span></div>' +
    '<div class="op2-sect"><div class="op2-t">Что получится <span class="op2-dim op2-sm">- время у всех как в образце, поправь −30/+30 или впиши</span></div>' +
      '<div class="op2-rb-list" id="op2-rp-list"></div></div>';
  $('#op2-d-foot').innerHTML = '<button class="op2-ghost" id="op2-d-back">← Назад к заявке</button>' +
    '<span class="op2-dim op2-sm" id="op2-rp-state"></span>' +
    '<button class="op2-dbtn op2-primary op2-blocked" id="op2-rp-go">Создать заявки</button>';

  function countOf(d) { return rows.filter(function (r) { return r.d === d; }).length; }
  function renderChips() {
    $$('#op2-rp-days .op2-chip').forEach(function (c) {
      var n = countOf(c.dataset.d);
      c.classList.toggle('op2-on', n > 0);
      c.innerHTML = esc(dayLabel(c.dataset.d)) + (n ? '<span class="op2-n">×' + n + '</span>' : '');
    });
  }
  function renderList() {
    var byDay = {}; rows.forEach(function (r, i) { (byDay[r.d] = byDay[r.d] || []).push(i); });
    var h = '';
    days.forEach(function (x) {
      var idx = byDay[x.d]; if (!idx) return;
      h += '<div class="op2-rb-day">' + esc(x.l) + ' <span class="op2-dim">· ' + idx.length + ' ' + plural(idx.length, 'заявка', 'заявки', 'заявок') + '</span></div>';
      idx.forEach(function (i, k) {
        h += '<div class="op2-rb-row"><span class="op2-rb-no">' + (k + 1) + '</span>' +
          '<button class="op2-stp op2-rb-stp" data-i="' + i + '" data-d="-30">−30</button>' +
          '<input value="' + esc(rows[i].t) + '" data-i="' + i + '" placeholder="--:--" autocomplete="off">' +
          '<button class="op2-stp op2-rb-stp" data-i="' + i + '" data-d="30">+30</button>' +
          '<button class="op2-rb-rm" data-i="' + i + '" title="Убрать эту заявку из списка">✕</button></div>';
      });
    });
    $('#op2-rp-list').innerHTML = h || '<span class="op2-dim op2-sm">кликни по дню выше - каждая клик добавит заявку</span>';
    blockForeignAutofill_($('#op2-rp-list'));
    var g = $('#op2-rp-go');
    g.className = 'op2-dbtn op2-primary' + (rows.length ? '' : ' op2-blocked');
    g.textContent = rows.length ? 'Создать ' + rows.length + ' ' + plural(rows.length, 'заявку', 'заявки', 'заявок') : 'Создать заявки';
    $('#op2-rp-state').textContent = rows.length ? 'все - «Не подтверждено», подтверждаешь каждую отдельно' : '';
  }
  function render() { renderChips(); renderList(); }
  function addDay(d) { rows.push({ d: d, t: defTime }); }
  function removeDay(d) { for (var i = rows.length - 1; i >= 0; i--) if (rows[i].d === d) { rows.splice(i, 1); return; } }
  function groupDays(p) { return days.filter(function (x) { return p === 'all' || (p === 'wd' && x.wd === 1); }).map(function (x) { return x.d; }); }

  var dayBox = $('#op2-rp-days'), preBox = $('#op2-rp-presets'), list = $('#op2-rp-list');
  dayBox.addEventListener('click', function (e) { var c = e.target.closest('.op2-chip'); if (!c) return; addDay(c.dataset.d); render(); });
  dayBox.addEventListener('contextmenu', function (e) { var c = e.target.closest('.op2-chip'); if (!c) return; e.preventDefault(); removeDay(c.dataset.d); render(); S.tickDown(); });
  preBox.addEventListener('click', function (e) {
    var c = e.target.closest('.op2-chip'); if (!c) return;
    var p = c.dataset.preset;
    if (p === 'none') { rows = []; render(); return; }
    groupDays(p).forEach(addDay); render();
  });
  preBox.addEventListener('contextmenu', function (e) {
    var c = e.target.closest('.op2-chip'); if (!c || c.dataset.preset === 'none') return;
    e.preventDefault(); groupDays(c.dataset.preset).forEach(removeDay); render(); S.tickDown();
  });
  list.addEventListener('click', function (e) {
    var st = e.target.closest('.op2-rb-stp');
    if (st) { var r = rows[+st.dataset.i]; r.t = hhmm(tmin(r.t || defTime || '08:00') + (+st.dataset.d)); if (+st.dataset.d > 0) S.stepUp(); else S.stepDown(); renderList(); return; }
    var rm = e.target.closest('.op2-rb-rm');
    if (rm) { rows.splice(+rm.dataset.i, 1); render(); }
  });
  list.addEventListener('change', function (e) {
    var inp = e.target.closest('input[data-i]'); if (!inp) return;
    rows[+inp.dataset.i].t = normT(inp.value) || ''; inp.value = rows[+inp.dataset.i].t;
  });
  render();

  /* runRepeat читает состояние отсюда - одна шторка за раз, замыкание живёт до закрытия */
  openRepeat._rows = function () { return rows.slice(); };
}
function runRepeat(btn, o) {
  var rows = openRepeat._rows ? openRepeat._rows() : [];
  if (btn.classList.contains('op2-blocked') || !rows.length) { toast('<span class="op2-warn">Кликни по дню - добавь хотя бы одну заявку</span>'); return; }
  var base = {
    needs_data: o.needs_data ? 1 : 0, customer: o.customer,
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
  Promise.all(rows.map(function (r) {
    var p = {}; Object.keys(base).forEach(function (k) { p[k] = base[k]; });
    p.service_date = r.d; p.service_time = r.t || '';
    return apiPostJson('/orders/save', p).then(function (res) { return { r: res, d: r.d }; });
  })).then(function (res) {
    btn.disabled = false;
    var good = res.filter(function (x) { return x.r && x.r.ok && x.r.data && !x.r.data.error; });
    var bad = res.length - good.length;
    var perDay = {}; good.forEach(function (x) { perDay[x.d] = (perDay[x.d] || 0) + 1; });
    closeDrawer();
    if (good.length) S.tickUp();
    toast('Создано ' + good.length + ' ' + plural(good.length, 'заявка', 'заявки', 'заявок') + ' по образцу №' + esc(oNo(o)) + ': ' +
      esc(Object.keys(perDay).sort().map(function (d) { return dayLabel(d) + ' ×' + perDay[d]; }).join(', ')) +
      (bad ? ' · <span class="op2-bad">' + bad + ' не создалось</span>' : '') + ' · все «Не подтверждено» - подтверди каждую', null, 9000);
    loadOrders(); loadCounts();
  }).catch(function () { btn.disabled = false; });
}

/* ═════════════════════════ ЖИВОСТЬ ═════════════════════════ */
function startPolling() {
  stopPolling();
  /* «Максимально онлайн» (Влад 11.09): раз в 2 с спрашиваем дешёвый штамп версии /orders/tick и
     перезагружаем таблицу только когда он сменился (чужое действие долетает за ~2 с); heartbeat
     присутствия и страховочная полная перезагрузка - раз в 7 с. */
  var beat = 0;
  pollTimer = setInterval(function () {
    if (document.hidden) return;      /* вкладка не видна - не дёргаем сервер */
    if (!isPageActive()) return;      /* ушли на другую страницу дашборда */
    beat++;
    if (beat % 3 === 0) { loadOrders(true); return; }
    var params = { date: DATE }; if (TO_DATE) params.to = TO_DATE;
    apiGet('/orders/tick', params).then(function (r) {
      if (r && r.ok && r.data && r.data.v !== undefined && r.data.v !== MAX_UPD) loadOrders(true);
    }).catch(function () {});
  }, 2000);
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
  if (!META) loadMeta().then(function () { renderAll(); loadOrders(); runPrefill(); });
  else { loadOrders(); runPrefill(); }
  loadCounts();
  loadFree();
  startPolling();
}
/* Заявка из CRM: CRM.createTask кладёт поля сделки сюда и переключает страницу; форма откроется,
   как только страница построена и справочники загружены. У админа - экран менеджера. */
function runPrefill() {
  if (!PREFILL || !built || !META) return;
  var pre = PREFILL; PREFILL = null;
  if (!pre.service_date) pre.service_date = todayStr(); /* как у пустой формы - сегодня */
  if (ME && ME.role === 'admin' && VIEW !== 'mgr') { VIEW = 'mgr'; syncSwitch(); renderAll(); }
  openDrawerForm(pre, false, 'mgr', true);
  toast('Поля взяты из CRM · сделка №' + esc(pre.crm_deal_id || '?') + ' · проверь дату, время и тип техники');
}
window.OP2 = { open: open, reload: function () { loadOrders(); }, stop: stopPolling,
  newFrom: function (pre) { PREFILL = pre || null; runPrefill(); } };

})();
