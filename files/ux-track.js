/* ══════════════════════════════════════════════════════════════════════════════
   Журнал действий «Гладкая работа» - автосбор каждого клика, выбора, ввода и перехода.
   План: plans/2026-09-26-smooth-work-ux-analytics.md (Фаза 1А). Цель - найти лишние
   действия и ручной ввод того, что система может подставить сама. НЕ контроль людей.

   Что пишем: какое действие (имя кнопки/поля), где (панель), когда, сколько секунд и
   нажатий ушло на поле, была ли вставка из буфера. Что НЕ пишем никогда: набранный текст,
   значения текстовых полей (только длину), пароли, движение мыши, прокрутку.

   Как устроено:
   - один перехватчик на document в фазе захвата - существующие onclick не трогаем;
   - работа на событие постоянная: подъём по DOM не дальше UP уровней, без снимков страницы;
   - очередь в памяти + копия в localStorage (своя строка на вкладку, yard_ux_q.<sid>) -
     события без связи дойдут позже, в том числе из закрытой вкладки (их подберёт следующая);
   - пачка раз в 5 с или по 50 событий, на уходе со страницы - fetch keepalive;
   - доставка «хотя бы раз»: одну и ту же пачку можно прислать дважды (обрыв после записи,
     уход со страницы), сервер склеивает повтор по (sid, seq, t) - уникальный ключ ux_events;
   - токен только в заголовке X-Session-Token (запасной sendBeacon - в теле), НИКОГДА в URL:
     параметр запроса оседает в access.log nginx;
   - интерфейс о сборе не знает: все ошибки глушатся, никаких тостов и console.error;
   - аварийный выключатель: сервер ответил {enabled:false} (UX_TRACK=off в .env сервера)
     или страница задала window.YARD_UX_OFF = true - вкладка замолкает.

   Токен и адрес API: по умолчанию голые SESSION_TOKEN/YARD_API_BASE из index.html (let/const
   основного скрипта видны отсюда как голые имена, не как window.*). Страница со своей парой
   (plan-m.html, orders-m.html) задаёт ДО подключения этого файла:
     window.YARD_UX_CFG = { page: 'plan-m', token: function(){...}, base: function(){...},
                            preview: function(){ return режим «Смотреть как»; } };
   Роль и email не шлём - сервер берёт их из токена.

   Событие: {k, t, seq, sid, page, target, area, val, ms, n1, n2, len, flags}, пустые поля не шлём.
     click    target - имя действия, area - панель (ближайший предок с id);
     change   select/checkbox/radio: val - value варианта или on/off, не подпись и не ввод;
     field    ms в поле, n1 нажатий, n2 стираний, len - длина итога, flags 4 - была вставка;
     view     page - куда, target - откуда, ms - сколько был на прошлой странице;
     vis      val hidden/visible - живое время считается только пока вкладка видна;
     js_error val - текст ошибки (до 120), target - файл:строка.
   flags: 1 - режим «Смотреть как», 4 - вставка из буфера (2 - служебный запрос, ставит сервер).
   ══════════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';
if (window.YardUx) return; // подключили дважды - второй экземпляр не нужен

var CFG = window.YARD_UX_CFG || {};
var FLUSH_MS = 5000;        // обычный интервал пачки
var FLUSH_MAX_MS = 60000;   // потолок паузы при сбоях связи/сервера (удваивается от FLUSH_MS)
var BATCH = 50;             // событий в одном запросе (сервер принимает до 100)
var UNLOAD_BATCHES = 3;     // на уходе - не больше 150 событий: у keepalive общий лимит 64 КБ, остальное дошлёт следующее открытие
var QMAX = 500;             // потолок очереди вкладки, при переполнении теряются самые старые
var UP = 6;                 // подъём от кликнутого элемента к кнопке
var AREA_UP = 10;           // подъём к панели с id: панели сидят глубже кнопок, 10 чтений parentNode - те же наносекунды
var ORPHAN_MS = 180000;     // строка очереди чужой вкладки не обновлялась 3 мин - вкладки нет, подбираем её события
var SAVE_MS = 1000;         // копия очереди в localStorage - не чаще раза в секунду, не на каждый клик
var ERR_MAX = 30;           // ошибок JS за открытие страницы - защита от лавины из зациклившегося кода
var LS_PREFIX = 'yard_ux_q.';
var SS_SID = 'yard_ux_sid', SS_SEQ = 'yard_ux_seq', SS_PG = 'yard_ux_pg', SS_OFF = 'yard_ux_off';

function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
function noop() {}

var off = window.YARD_UX_OFF === true || ssGet(SS_OFF) === '1';
if (off) { window.YardUx = { page: noop, flush: noop, stats: noop }; return; }

/* ───────────── сессия вкладки: sid + сквозной номер seq (переживают перезагрузку) ───────────── */
function newSid() {
  var abc = 'abcdefghijklmnopqrstuvwxyz0123456789', s = '', buf = null, i;
  try { buf = new Uint8Array(16); window.crypto.getRandomValues(buf); } catch (e) { buf = null; }
  for (i = 0; i < 16; i++) s += abc.charAt((buf ? buf[i] : Math.floor(Math.random() * 256)) % 36);
  return s;
}
var sid = ssGet(SS_SID);
if (!/^[a-z0-9]{16}$/.test(sid || '')) { sid = newSid(); ssSet(SS_SID, sid); }
var seq = parseInt(ssGet(SS_SEQ), 10) || 0;
var LS_KEY = LS_PREFIX + sid;

/* ───────────── токен, адрес API, режим «Смотреть как» ───────────── */
function token() {
  try {
    if (typeof CFG.token === 'function') return String(CFG.token() || '');
    return (typeof SESSION_TOKEN !== 'undefined' && SESSION_TOKEN) ? String(SESSION_TOKEN) : '';
  } catch (e) { return ''; }
}
function apiBase() {
  try {
    if (typeof CFG.base === 'function') return String(CFG.base() || '');
    if (typeof CFG.base === 'string') return CFG.base;
    return typeof YARD_API_BASE !== 'undefined' ? String(YARD_API_BASE) : '';
  } catch (e) { return ''; }
}
function isPreview() {
  try {
    if (typeof CFG.preview === 'function') return !!CFG.preview();
    // index.html: viewAsEntry живёт только у admin (клиентская надстройка, роль остаётся admin)
    return !!(typeof viewAsEntry !== 'undefined' && viewAsEntry && typeof D !== 'undefined' && D && D.role === 'admin');
  } catch (e) { return false; }
}
// Чей это журнал: короткий отпечаток email из самого токена (payload токена - base64url JSON).
// Нужен, чтобы события, накопленные без связи у одного человека, не ушли с токеном другого
// (общий компьютер в офисе, выход-вход). Сам email в localStorage не кладём - только отпечаток.
var who = { tok: null, u: '' };
function userMark(tok) {
  if (tok === who.tok) return who.u;
  var u = '', h = 5381, i, p;
  try {
    p = tok.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    while (p.length % 4) p += '=';
    var em = String(JSON.parse(atob(p)).email || '').toLowerCase();
    for (i = 0; i < em.length; i++) h = ((h << 5) + h + em.charCodeAt(i)) | 0;
    u = em ? (h >>> 0).toString(36) : '';
  } catch (e) { u = ''; }
  who = { tok: tok, u: u };
  return u;
}

/* ───────────── очередь и её копия в localStorage ───────────── */
var q = [];
var timer = null, saveTimer = null, inflight = false, delay = FLUSH_MS, badTok = null;
// _s - «в пути» (не слать второй раз, пока не ответили), _u - отпечаток владельца.
// В запрос не уходит ни то, ни другое; в localStorage - только _u.
function wire(k, v) { return (k === '_s' || k === '_u') ? undefined : v; }
function lsWire(k, v) { return k === '_s' ? undefined : v; }
function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try {
    if (!q.length) localStorage.removeItem(LS_KEY);
    else localStorage.setItem(LS_KEY, JSON.stringify({ ts: Date.now(), ev: q }, lsWire));
  } catch (e) {}
}
function saveSoon() { if (!saveTimer) saveTimer = setTimeout(saveNow, SAVE_MS); }
function trim() { if (q.length > QMAX) q.splice(0, q.length - QMAX); }
// Подобрать недошедшее: своя строка (эта же вкладка до перезагрузки) и строки закрытых вкладок.
// Строки живых соседних вкладок не трогаем - у них свой цикл отправки. Если две вкладки
// подберут одну строку одновременно - повтор склеит сервер по уникальному ключу.
function adopt() {
  var keys = [], now = Date.now(), i, k, o;
  try {
    for (i = 0; i < localStorage.length; i++) { k = localStorage.key(i); if (k && k.indexOf(LS_PREFIX) === 0) keys.push(k); }
  } catch (e) { return; }
  for (i = 0; i < keys.length; i++) {
    try {
      o = JSON.parse(localStorage.getItem(keys[i]) || 'null');
      if (keys[i] !== LS_KEY && o && o.ts && now - o.ts < ORPHAN_MS) continue;
      localStorage.removeItem(keys[i]);
      if (o && o.ev && o.ev.length) {
        q = q.concat(o.ev.filter(function (e) { return e && e.k && e.sid && e.seq; }));
      }
    } catch (e) { try { localStorage.removeItem(keys[i]); } catch (e2) {} }
  }
  trim();
  if (q.length) { saveSoon(); schedule(FLUSH_MS); }
}

/* ───────────── отправка ───────────── */
var KEEPALIVE = (function () {
  try { return 'keepalive' in new Request('', { method: 'POST' }); } catch (e) { return false; }
})();
function schedule(ms) {
  if (off) return;
  if (timer) { if (ms > 0) return; clearTimeout(timer); }
  timer = setTimeout(function () { timer = null; flush(false); }, ms);
}
function mark(batch, on) {
  for (var i = 0; i < batch.length; i++) { if (on) batch[i]._s = 1; else delete batch[i]._s; }
}
function drop(batch) {
  q = q.filter(function (e) { return batch.indexOf(e) < 0; });
  saveSoon();
}
function backoff() {
  delay = Math.min(delay * 2, FLUSH_MAX_MS);
  saveNow(); // заодно свежая метка времени строки - соседние вкладки не сочтут нас закрытыми
  schedule(delay);
}
function takeBatch(me) {
  var b = [], i;
  for (i = 0; i < q.length && b.length < BATCH; i++) if (!q[i]._s && q[i]._u === me) b.push(q[i]);
  return b;
}
function shutdown() {
  off = true;
  ssSet(SS_OFF, '1');
  q = [];
  if (timer) { clearTimeout(timer); timer = null; }
  saveNow();
}
function send(batch, tok, url, unload) {
  mark(batch, true);
  if (unload && !KEEPALIVE) {
    // Браузер без keepalive: sendBeacon заголовков не умеет - токен В ТЕЛЕ (checkSession читает
    // его там), не в URL. text/plain - «простой» запрос без предварительного OPTIONS, иначе
    // маяк на другой домен с JSON браузер может не отправить вовсе. Ответа маяк не даёт -
    // если страница уже уходит, копия в localStorage не успеет обновиться и события придут
    // ещё раз со следующим открытием (сервер склеит повтор).
    var queued = false;
    try {
      if (navigator.sendBeacon) queued = navigator.sendBeacon(url, new Blob([JSON.stringify({ session_token: tok, events: batch }, wire)], { type: 'text/plain;charset=UTF-8' }));
    } catch (e) {}
    if (queued) drop(batch); else mark(batch, false);
    return;
  }
  if (!unload) inflight = true;
  var opts = { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': tok }, body: JSON.stringify({ events: batch }, wire) };
  if (unload) opts.keepalive = true; // переживает закрытие страницы, в отличие от обычного fetch
  fetch(url, opts).then(function (r) {
    if (!unload) inflight = false;
    if (r.ok) {
      drop(batch);
      delay = FLUSH_MS;
      r.json().then(function (j) { if (j && j.enabled === false) shutdown(); }, noop);
    } else if (r.status === 401) {
      mark(batch, false); badTok = tok; // сессия истекла/отозвана - копим до нового входа, не долбим сервер
    } else if (r.status === 400 || r.status === 413 || r.status === 422) {
      drop(batch); // пачку сервер не примет никогда - повтор не поможет, иначе она застрянет навсегда
    } else {
      mark(batch, false); backoff(); // 5xx, 404 (сервер ещё не выкачен/откачен) - ждём и повторяем
    }
    // остаток очереди - следующей пачкой (при паузе после сбоя таймер уже стоит, schedule его не сократит)
    if (!unload && !off && q.length && r.status !== 401) schedule(q.length >= BATCH && delay === FLUSH_MS ? 0 : delay);
  }, function () {
    if (!unload) inflight = false;
    mark(batch, false);
    backoff(); // нет связи - события лежат в копии, дойдут позже
  });
}
function flush(unload) {
  if (off) return;
  try {
    if (!unload && timer) { clearTimeout(timer); timer = null; }
    var tok = token(), base = apiBase();
    if (!tok || !base || !q.length) return;
    var me = userMark(tok), i, b;
    for (i = 0; i < q.length; i++) if (q[i]._u !== me) break;
    if (i < q.length) { q = q.filter(function (e) { return e._u === me; }); saveSoon(); } // чужие события на этом устройстве не отдаём под своим входом
    if (tok === badTok) return;
    var url = base + '/ux/batch'; // БЕЗ параметров: токен только в заголовке/теле
    if (unload) {
      for (i = 0; i < UNLOAD_BATCHES; i++) { b = takeBatch(me); if (!b.length) break; send(b, tok, url, true); }
      return;
    }
    if (inflight) return;
    if (navigator.onLine === false) { backoff(); return; }
    b = takeBatch(me);
    if (b.length) send(b, tok, url, false);
  } catch (e) {}
}

/* ───────────── запись события ───────────── */
var curPage = '', curT0 = 0, loggedPage = '', pendingView = null;
var pg = (ssGet(SS_PG) || '').split('|');
var prevPage = pg[0] || '', prevT0 = parseInt(pg[1], 10) || 0; // страница прошлого документа этой вкладки
var bootT = Date.now();

function emit(e) {
  if (off || window.YARD_UX_OFF === true) return false;
  var tok = token();
  if (!tok) return false; // не вошёл - не копим
  if (e.k !== 'view') ensureView();
  var ev = { k: e.k, t: Date.now(), seq: ++seq, sid: sid, page: e.page || curPage || 'unknown' };
  ssSet(SS_SEQ, String(seq));
  if (e.target) ev.target = e.target;
  if (e.area) ev.area = e.area;
  if (e.val != null && e.val !== '') ev.val = e.val;
  if (e.ms != null) ev.ms = Math.max(0, Math.round(e.ms));
  if (e.n1) ev.n1 = e.n1;
  if (e.n2) ev.n2 = e.n2;
  if (e.len) ev.len = e.len;
  var fl = (isPreview() ? 1 : 0) | (e.paste ? 4 : 0);
  if (fl) ev.flags = fl;
  ev._u = userMark(tok);
  q.push(ev);
  trim();
  saveSoon();
  schedule(q.length >= BATCH && delay === FLUSH_MS && !inflight ? 0 : delay); // пока пачка в пути - остаток уйдёт по её ответу
  return true;
}

/* ───────────── переходы между страницами ───────────── */
function detectPage() {
  if (CFG.page) return String(CFG.page);
  try { var a = document.querySelector('.page.active'); if (a && a.id) return a.id.replace(/^page-/, ''); } catch (e) {}
  return '';
}
function logView() {
  if (!pendingView) return;
  if (emit({ k: 'view', page: curPage, target: pendingView.from, ms: pendingView.ms })) loggedPage = curPage;
}
function setPage(id, at) {
  id = String(id || '').slice(0, 60);
  if (!id || id === curPage) return; // повторный showPage той же страницы - это клик, он уже в журнале
  var now = at || Date.now();
  var t0 = curPage ? curT0 : prevT0;
  pendingView = { from: curPage || prevPage, ms: t0 ? now - t0 : null };
  curPage = id; curT0 = now;
  ssSet(SS_PG, id + '|' + now);
  logView();
}
// Первое действие документа без явного перехода (index.html: стартовая страница стоит
// разметкой, showPage не зовётся) - сначала пишем, на какой странице человек. Ждём первого
// действия, а не момента загрузки: у менеджера стартовая «Панель» мелькает под загрузкой и
// сразу сменяется его страницей - это не его переход. Не вошёл при переходе - дописываем после входа.
function ensureView() {
  if (!curPage) setPage(detectPage() || 'unknown', bootT);
  else if (loggedPage !== curPage) logView();
}

/* ───────────── имя действия ───────────── */
function tagOf(el) { return String(el.tagName || '').toLowerCase(); }
function squash(s) { return String(s || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''); }
function mask(s) { return String(s).replace(/\d+/g, '#'); } // row-123 и row-124 - одна кнопка, не сотни
function cut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) : s; }
var BTN_CLS = /(^|[\s_-])(btn|button)([\s_-]|$)/i;
var INTERACTIVE = { button: 1, a: 1, input: 1, select: 1, textarea: 1, label: 1, summary: 1 };
var ROLES = { button: 1, link: 1, tab: 1, menuitem: 1, 'switch': 1, option: 1, checkbox: 1 };
function isInteractive(el) {
  if (INTERACTIVE[tagOf(el)]) return true;
  if (el.hasAttribute('onclick') || el.hasAttribute('data-ux') || el.hasAttribute('contenteditable')) return true;
  if (ROLES[el.getAttribute('role')]) return true;
  var ti = el.getAttribute('tabindex');
  if (ti != null && ti !== '-1') return true;
  return BTN_CLS.test(el.getAttribute('class') || '');
}
// Кликнули по иконке/подписи внутри кнопки - поднимаемся до самой кнопки. Кнопки нет -
// ближайший элемент с id рядом (строка/карточка с делегированным обработчиком), иначе сам элемент.
function pick(t) {
  var el = t, firstId = null, i;
  for (i = 0; el && el.nodeType === 1 && i <= UP; i++) {
    if (isInteractive(el)) return el;
    if (!firstId && i <= 3 && el.getAttribute('id')) firstId = el;
    el = el.parentNode;
  }
  return firstId || t;
}
// Имя функции из onclick: op2SaveOrder('123') -> op2SaveOrder, CRM.open(5) -> CRM.open.
// Аргументы не берём никогда - в них id и имена. Служебные event/this/if/confirm пропускаем.
var SKIP_FN = { event: 1, 'this': 1, document: 1, 'return': 1, 'if': 1, 'for': 1, 'while': 1, 'switch': 1, 'typeof': 1,
  'function': 1, 'new': 1, 'void': 1, 'var': 1, confirm: 1, alert: 1, prompt: 1, setTimeout: 1, requestAnimationFrame: 1 };
var FN_RE = /(^|[^\w$.])([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\(/g;
function handlerName(code) {
  if (!code) return '';
  var m, chain, first;
  code = String(code).slice(0, 400);
  FN_RE.lastIndex = 0;
  while ((m = FN_RE.exec(code))) {
    chain = m[2].replace(/\s+/g, '');
    if (chain.indexOf('window.') === 0) chain = chain.slice(7);
    first = chain.split('.')[0];
    if (!chain || SKIP_FN[first]) continue;
    return cut(chain, 80);
  }
  return '';
}
// Надпись кнопки - только короткая и без цифр («Сохранить», «Отбой»), и не в строке таблицы
// или списка: там надписи - это данные (номер заявки, фамилия, госномер), а не имя кнопки.
function btnLabel(el, tag) {
  var txt, i, p;
  if (tag === 'input') {
    if (!/^(button|submit|reset)$/i.test(el.type || '')) return '';
    txt = el.value; // надпись кнопки-input, не ввод человека
  } else {
    if (!(tag === 'button' || tag === 'a' || el.getAttribute('role') === 'button' || BTN_CLS.test(el.getAttribute('class') || ''))) return '';
    if (el.childElementCount > 8) return '';
    txt = el.textContent;
  }
  if (!txt || txt.length > 200) return '';
  txt = squash(txt);
  if (!txt || txt.length > 24 || /\d/.test(txt)) return '';
  for (p = el.parentNode, i = 0; p && p.nodeType === 1 && i < UP; i++, p = p.parentNode) {
    if (p.tagName === 'TR' || p.tagName === 'LI') return '';
  }
  return txt;
}
function tagClass(el) {
  var tag = tagOf(el), cls = squash(el.getAttribute('class')).split(' ')[0];
  if (tag === 'input') tag += ':' + String(el.type || 'text').toLowerCase();
  return mask(tag + (cls ? '.' + cls : ''));
}
var HANDLERS = { click: ['onclick'], change: ['onchange', 'oninput', 'onclick'], field: ['oninput', 'onchange', 'onblur', 'onkeyup', 'onkeydown'] };
function nameOf(el, kind) {
  var v = el.getAttribute('data-ux'), list = HANDLERS[kind], i;
  if (v) return cut(v, 160);                    // имя, данное разработчиком, - как есть
  v = el.getAttribute('id');
  if (v) return cut(mask(v), 160);
  for (i = 0; i < list.length; i++) { v = handlerName(el.getAttribute(list[i])); if (v) return v; }
  if (kind === 'click') { v = btnLabel(el, tagOf(el)); if (v) return v; }
  if (kind === 'field') {
    // подсказка в пустом поле - текст разработчика, а не ввод человека
    v = squash(el.getAttribute('placeholder') || el.getAttribute('aria-label'));
    if (v && v.length <= 32 && !/\d/.test(v)) return v;
  }
  return cut(tagClass(el), 160);
}
function areaOf(el) {
  var p = el.parentNode, i, id;
  for (i = 0; p && p.nodeType === 1 && i < AREA_UP; i++, p = p.parentNode) {
    id = p.getAttribute('id');
    if (id) return cut(mask(id), 80);
  }
  return '';
}

/* ───────────── обработчики ───────────── */
var st = { n: 0, sum: 0, max: 0 }; // замер цены обработчика клика - YardUx.stats() в консоли
function now_() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

function onClick(ev) {
  if (off) return;
  var t0 = now_();
  try {
    if (ev.isTrusted === false) return; // программный .click() из кода - не действие человека
    var t = ev.target;
    if (t && t.nodeType !== 1) t = t.parentNode;
    if (!t || t.nodeType !== 1) return;
    var el = pick(t), tag = tagOf(el), ty;
    if (tag === 'input') {
      ty = String(el.type || '').toLowerCase();
      if (ty === 'password' || ty === 'checkbox' || ty === 'radio') return; // флажки пишет change, пароль - никогда
    }
    if (tag === 'label' && el.control && /^(checkbox|radio)$/i.test(el.control.type || '')) return;
    emit({ k: 'click', target: nameOf(el, 'click'), area: areaOf(el) });
  } catch (e) {}
  var d = now_() - t0;
  st.n++; st.sum += d; if (d > st.max) st.max = d;
}

function onChange(ev) {
  if (off) return;
  try {
    if (ev.isTrusted === false) return;
    var el = ev.target, tag, ty, val, i, n;
    if (!el || el.nodeType !== 1) return;
    tag = tagOf(el);
    if (tag === 'select') {
      if (el.multiple) { for (n = 0, i = 0; i < el.options.length; i++) if (el.options[i].selected) n++; val = 'n=' + n; }
      else val = el.value; // value выбранного варианта (код/id), не видимая подпись
    } else if (tag === 'input') {
      ty = String(el.type || '').toLowerCase();
      if (ty === 'checkbox') val = el.checked ? 'on' : 'off';
      else if (ty === 'radio') val = el.value || 'on';
      else return; // текстовые поля - только событие field (без содержимого); файл, пароль - никогда
    } else return;
    emit({ k: 'change', target: nameOf(el, 'change'), area: areaOf(el), val: cut(val, 80) });
  } catch (e) {}
}

// Текстовое поле: одно событие при уходе - сколько секунд в поле, сколько нажатий и
// стираний, была ли вставка, итоговая ДЛИНА. Само значение не читается ни в какой момент.
var TEXT_TYPES = { text: 1, search: 1, tel: 1, email: 1, number: 1, date: 1, url: 1, 'datetime-local': 1, time: 1, month: 1, week: 1 };
var fld = null;
function isTextField(el) {
  var tag = tagOf(el);
  if (tag === 'textarea') return true;
  if (tag === 'input') return TEXT_TYPES[String(el.type || 'text').toLowerCase()] === 1; // password сюда не входит
  return !!el.isContentEditable;
}
function fieldLen(el) {
  try {
    var tag = tagOf(el);
    if (tag === 'input' || tag === 'textarea') return String(el.value || '').length;
    return String(el.textContent || '').length;
  } catch (e) { return 0; }
}
function endField() {
  var f = fld;
  fld = null;
  if (!f) return;
  var ms = Date.now() - f.t0;
  var keys = Math.max(f.keys, f.edits);
  if (!keys && !f.paste && ms < 500) return; // проскочил табом - не ввод
  emit({ k: 'field', target: f.name, area: f.area, ms: ms, n1: Math.min(keys, 32767), n2: Math.min(Math.max(f.kdel, f.idel), 32767),
    len: Math.min(fieldLen(f.el), 32767), paste: f.paste });
}
function onFocusIn(ev) {
  if (off) return;
  try {
    var el = ev.target;
    if (fld && fld.el !== el) endField(); // прошлое поле убрали из DOM без focusout - закрываем сами
    if (fld || !el || el.nodeType !== 1 || !isTextField(el)) return;
    // имя и панель - сейчас, пока поле точно в DOM (после ввода его могут перерисовать)
    fld = { el: el, t0: Date.now(), keys: 0, edits: 0, kdel: 0, idel: 0, paste: 0, name: nameOf(el, 'field'), area: areaOf(el) };
  } catch (e) {}
}
function onFocusOut(ev) { try { if (fld && ev.target === fld.el) endField(); } catch (e) {} }
function onKey(ev) {
  if (!fld || ev.target !== fld.el) return;
  var k = ev.key;
  if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'CapsLock') return;
  fld.keys++;
  if (k === 'Backspace' || k === 'Delete') fld.kdel++;
}
// Правки - ещё и по input: экранная клавиатура телефона шлёт keydown с key 'Unidentified' (Backspace
// по нему не распознать), а ввод через подсказку клавиатуры/IME может прийти вовсе без keydown.
// inputType надёжен. И нажатия (n1), и стирания (n2) - большее из двух счётчиков.
function onInput(ev) {
  if (!fld || ev.target !== fld.el) return;
  var it = ev.inputType || '';
  fld.edits++;
  if (it.indexOf('delete') === 0) fld.idel++;
  else if (it === 'insertFromPaste' || it === 'insertFromDrop') fld.paste = 1;
}
function onPaste(ev) { if (fld && (ev.target === fld.el || (fld.el.contains && fld.el.contains(ev.target)))) fld.paste = 1; }

function onVis() {
  if (off) return;
  try {
    var hidden = document.visibilityState === 'hidden';
    if (hidden) endField();
    emit({ k: 'vis', val: hidden ? 'hidden' : 'visible' });
    if (hidden) { saveNow(); flush(true); }
  } catch (e) {}
}
function onHide() {
  if (off) return;
  try { endField(); saveNow(); flush(true); } catch (e) {}
}

var errN = 0, lastErr = '', lastErrT = 0;
function reportError(msg, file, line) {
  if (off) return;
  msg = cut(squash(msg), 120);
  var now = Date.now();
  if (!msg || errN >= ERR_MAX || (msg === lastErr && now - lastErrT < 2000)) return;
  errN++; lastErr = msg; lastErrT = now;
  // длинные числа (id, телефон) - в #: и для группировки одинаковых ошибок, и чтобы не хранить данные
  emit({ k: 'js_error', val: msg.replace(/\d{4,}/g, '#'), target: file ? cut(String(file).split('?')[0].split('/').pop() + ':' + (line || 0), 160) : '' });
}
function onError(ev) {
  try { if (ev && ev.message) reportError(ev.message, ev.filename, ev.lineno); } catch (e) {} // без message - сбой загрузки картинки/скрипта, не наш код
}
function onRejection(ev) {
  try { var r = ev && ev.reason; reportError(r && r.message ? r.message : String(r), '', 0); } catch (e) {}
}

/* ───────────── запуск ───────────── */
var cap = { capture: true, passive: true };
document.addEventListener('click', onClick, cap);
document.addEventListener('change', onChange, cap);
document.addEventListener('focusin', onFocusIn, cap);
document.addEventListener('focusout', onFocusOut, cap);
document.addEventListener('keydown', onKey, cap);
document.addEventListener('input', onInput, cap);
document.addEventListener('paste', onPaste, cap);
document.addEventListener('visibilitychange', onVis, cap);
window.addEventListener('pagehide', onHide, cap);
window.addEventListener('error', onError);
window.addEventListener('unhandledrejection', onRejection);
window.addEventListener('online', function () { delay = FLUSH_MS; schedule(0); });

adopt();
if (CFG.page) setPage(CFG.page); // отдельные страницы (plan-m, orders-m) - одна страница на файл

window.YardUx = {
  page: function (id) { try { setPage(id); } catch (e) {} },
  flush: function (onUnload) { try { if (onUnload) { endField(); saveNow(); } flush(!!onUnload); } catch (e) {} },
  // живая проверка «клик укладывается в 1 мс»: YardUx.stats() в консоли
  stats: function () { return { clicks: st.n, avg_ms: st.n ? +(st.sum / st.n).toFixed(3) : 0, max_ms: +st.max.toFixed(3), queued: q.length, sid: sid, seq: seq }; }
};
})();
