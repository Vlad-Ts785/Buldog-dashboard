/* ══════════════════════════════════════════════════════════════════════════════
   «Найм» - воронка кандидатов-водителей CE (24.09.2026).
   План: plans/2026-09-24-driver-hiring-pipeline.md (Фаза 1). ТЗ - Феськов.
   Модуль самодостаточен (как order-plan-v2.js): рендерит разметку внутрь уже
   существующего контейнера #page-hiring и ходит в api.yardhub.ru/api/hiring/*.
   Этапы, сроки и причины отказа приходят с сервера (/hiring/meta) - в коде их нет.
   Кто что видит и двигает - решает сервер; сайт рисует то, что пришло (can_move /
   can_edit), и показывает ошибку сервера тостом.
   Визуальный язык - ТОЛЬКО готовые анатомии ГОСТа, без своих вариантов:
     KPI-плитки и канбан CRM (.crm-kpis/.kpi, .kb-*), поиск (.cx-search), чипы-фильтры
     (.crm-chip), шторка сделки CRM внутри плавающей скруглённой шторки (.crm-drawer-head,
     .dr-* : степпер этапов, «Отказ» с причинами, поля с автосохранением, лента истории),
     чипы-значения полей (.drv-chip). Свои классы hr- - минимум, см. files/hiring.css.
   ══════════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';
var ROOT_ID = 'page-hiring';
var PAGE_STEP = 60;             // карточек в колонке за раз («Показать ещё 60»)
var POLL_MS = 180000;           // доска и цифры обновляются сами раз в 3 минуты (вкладка видна)
var DAY_MS = 86400000;
var S = { inited: false, meta: null, cands: [], stats: null, q: '', vt: 'all', flt: null, kpi: null, more: {},
  openId: null, mode: null, loading: false, cand: null };

function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
/* p2Toast пишет текст через innerHTML - всё, что пришло с сервера или от людей, экранируем здесь. */
function toast(text, type, action) { try { p2Toast(esc(text), type || 'amber', action); } catch (e) {} }

/* Иконки - те же штриховые SVG, что в CRM (словарь ICO модуля CRM, index.html), 20/1.6. */
var A = 'viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
var ICO = {
  search: '<circle cx="9" cy="9" r="5"/><path d="M13 13l4 4"/>',
  close: '<path d="M5 5l10 10M15 5L5 15"/>',
  phone: '<path d="M4 4.5c0 6.3 5.2 11.5 11.5 11.5l1.5-2.5-3.2-1.6-1.6 1.6c-2.2-1-3.7-2.5-4.7-4.7l1.6-1.6L7 4z"/>',
  chat: '<path d="M3 5.5A1.5 1.5 0 014.5 4h11A1.5 1.5 0 0117 5.5v7a1.5 1.5 0 01-1.5 1.5H8l-4 3z"/>',
  check: '<path d="M4 10.5l4 4 8-8"/>',
  undo: '<path d="M7 7H3V3"/><path d="M3.5 7A7 7 0 1110 17"/>',
  won: '<circle cx="10" cy="10" r="7"/><path d="M6.5 10l2.5 2.5 4.5-5"/>',
  lost: '<circle cx="10" cy="10" r="7"/><path d="M7.5 7.5l5 5M12.5 7.5l-5 5"/>',
  stage: '<path d="M3 6h14M3 10h10M3 14h6"/>',
  user: '<circle cx="10" cy="7" r="3"/><path d="M4 17c.8-3 3-4.5 6-4.5s5.2 1.5 6 4.5"/>',
  plus: '<path d="M10 4v12M4 10h12"/>'
};
function ico(name) { return '<svg ' + A + '>' + (ICO[name] || '') + '</svg>'; }

/* ───────── API (SESSION_TOKEN/YARD_API_BASE - let/const в index.html, читаются голыми
   идентификаторами, см. память project_window_global_let_const_gotcha) ───────── */
function apiBase() { try { return YARD_API_BASE; } catch (e) { return 'https://api.yardhub.ru/api'; } }
function apiToken() { try { return SESSION_TOKEN || ''; } catch (e) { return ''; } }
function api(path, body, params) {
  var qs = Object.keys(params || {}).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  var opt = { headers: { 'X-Session-Token': apiToken() } };
  if (body) { opt.method = 'POST'; opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  return fetch(apiBase() + path + (qs ? '?' + qs : ''), opt).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (d) { return { ok: res.ok, status: res.status, data: d || {} }; });
  }).catch(function () { return { ok: false, status: 0, data: { error: 'Нет связи с сервером' } }; });
}

/* ───────── справочники и форматы ───────── */
function stages() { return (S.meta && S.meta.stages) || []; }
function openStages() { return stages().filter(function (s) { return !s.is_terminal; }); }
function stageBy(key) { return stages().filter(function (s) { return s.stage_key === key; })[0] || null; }
function reasonBy(key) { return ((S.meta && S.meta.reasons) || []).filter(function (r) { return r.reason_key === key; })[0] || null; }
function me() { return (S.meta && S.meta.me) || {}; }
var VT_LABEL = { tral: 'Трал', long: 'Длинномер' };
var VT_COL = { tral: 'тралы', long: 'длинномеры' };
var SOURCE_LABEL = { manual: 'вручную', avito: 'Авито', hh: 'hh.ru', call: 'звонок', referral: 'рекомендация', 'обзвон_2026-05': 'база обзвона' };
function sourceLabel(s) { return SOURCE_LABEL[s] || s || '-'; }
/* Цвет точки этапа - по смыслу (ГОСТ разд.1): открытые - нейтральный blue, вышел - green,
   отказ - red, база/резерв - muted. */
function stageColor(st) {
  if (!st) return 'var(--muted)';
  if (st.stage_key === 'hired') return 'var(--green)';
  if (st.stage_key === 'rejected') return 'var(--red)';
  if (st.stage_key === 'callbase' || st.stage_key === 'reserve') return 'var(--muted)';
  return 'var(--blue)';
}
/* Телефон - канон ГОСТа «Телефон - поле ввода»: +7-XXX-XXX-XX-XX. */
function fmtPhone(p10) {
  if (!p10) return '';
  return '+7-' + p10.slice(0, 3) + '-' + p10.slice(3, 6) + '-' + p10.slice(6, 8) + '-' + p10.slice(8, 10);
}
function digits10(s) { var d = String(s || '').replace(/\D/g, ''); return d.length >= 11 ? d.slice(-10) : d; }
function agoText(ms) {
  var m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return m + ' мин';
  var h = Math.floor(m / 60);
  if (h < 48) return h + ' ч';
  return Math.floor(h / 24) + ' дн';
}
function since(iso) { var t = new Date(iso).getTime(); return isNaN(t) ? 0 : Date.now() - t; }
function fmtDateTime(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function fmtTime(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  var today = new Date(); var sameDay = d.toDateString() === today.toDateString();
  return sameDay ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : fmtDateTime(iso);
}
/* Просрочка считается ЛОКАЛЬНО от stage_changed_at и срока этапа - точка на карточке и плитка
   «Просрочено» живые, без ожидания следующего опроса сервера (ГОСТ разд.0 п.6). */
function overdueMin(c) {
  var st = stageBy(c.stage_key);
  if (!st || st.sla_minutes == null || st.is_terminal) return 0;
  var over = Math.floor(since(c.stage_changed_at) / 60000) - st.sla_minutes;
  return over > 0 ? over : 0;
}
/* Проверка СБ (таблица службы безопасности, lib/hiring-sb.js на сервере): статус у карточки и его вид.
   Цвет - только на этапе «Проверка СБ», словами - всегда (ГОСТ: цвет не говорит один). */
var SB_TEXT = { queued: 'в очереди в таблицу СБ', pending: 'СБ проверяет', approved: 'нет компромата', rejected: 'СБ: отказано',
  interview: 'СБ: нужно собеседование', question: 'у СБ вопрос' };
var SB_CLS = { approved: 'hr-sb-ok', rejected: 'hr-sb-bad', interview: 'hr-sb-wait', question: 'hr-sb-wait' };
var SB_REQ = [['full_name', 'ФИО'], ['birth_date', 'дата рождения'], ['birth_place', 'место рождения'], ['passport_no', 'серия и номер паспорта'],
  ['passport_issued_by', 'кем выдан'], ['passport_issue_date', 'дата выдачи'], ['reg_address', 'адрес регистрации'], ['phone10', 'телефон']];
/* То же, что R.sbMissing на сервере (он и решает) - здесь только чтобы подсказка обновлялась сразу при вводе. */
/* Кандидат на открытом этапе ПОСЛЕ «Проверки СБ», а СБ не ответила «нет компромата». */
function pastSbUnchecked(c) {
  var cur = stageBy(c.stage_key), sb = stageBy('security');
  return !!cur && !!sb && !cur.is_terminal && cur.sort_order > sb.sort_order && c.sb_status !== 'approved';
}
function sbMissing(c) { return SB_REQ.filter(function (p) { return c[p[0]] == null || String(c[p[0]]).trim() === ''; }).map(function (p) { return p[1]; }); }
function recallDue(c) { return !!c.recall_at && new Date(c.recall_at).getTime() <= Date.now(); }
/* Кружок ответственного - канон CRM (.kb-ava: инициалы, цвет «личности» по стабильному ключу,
   палитра IDENTITY_PALETTE_ из index.html). Нет ответственного - «?» (.is-none). */
function initials(name) { var p = String(name || '').trim().split(/\s+/).filter(Boolean); if (!p.length) return '?'; return (p.length === 1 ? p[0][0] : (p[0][0] + p[1][0])).toUpperCase(); }
function avaColor(key) {
  var pal; try { pal = IDENTITY_PALETTE_; } catch (e) { pal = null; }
  if (!pal || !pal.length) return 'var(--bg4)';
  var s = String(key || ''), h = 0;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return pal[h % pal.length];
}
function ava(name, key, title) {
  if (!name) return '<span class="kb-ava is-none" title="' + esc(title) + '">?</span>';
  return '<span class="kb-ava" style="background:' + avaColor(key || name) + '" title="' + esc(title) + '">' + esc(initials(name)) + '</span>';
}
function headOf(vt) { return vt ? (((S.meta && S.meta.column_heads) || {})[vt] || '') : ''; }
/* Кружки на карточке: HR (с этапов рекрутера) и колонна (с момента, как карточка дошла до НК). */
function ownersHtml(c) {
  var st = stageBy(c.stage_key), out = '';
  var recruiterStage = st && st.owner_role === 'recruiter';
  if (c.recruiter_name || recruiterStage) out += ava(c.recruiter_name, c.recruiter_email, c.recruiter_name ? 'HR: ' + c.recruiter_name : 'HR: никто не взял в работу');
  if (c.column_at) {
    var h = headOf(c.vehicle_type);
    out += ava(h, c.vehicle_type, c.vehicle_type ? 'Колонна: ' + VT_COL[c.vehicle_type] + (h ? ' (' + h + ')' : '') : 'Колонна не определена - возьмёт первый начальник колонны');
  }
  return out ? '<span class="hr-avas">' + out + '</span>' : '';
}
/* «Ждут меня» - открытая карточка, которую этот человек может двигать (признак от сервера). */
function waitsMe(c) { var st = stageBy(c.stage_key); return !!c.can_move && !!st && !st.is_terminal && st.stage_key !== 'callbase'; }

/* ───────── каркас страницы ───────── */
function buildDom() {
  var root = document.getElementById(ROOT_ID);
  root.innerHTML =
    '<div id="hr-loading" class="dr-empty" style="padding:16px">Загрузка...</div>' +
    '<div id="hr-body" style="display:none">' +
      '<div class="crm-kpis" id="hr-kpis"></div>' +
      '<div class="hr-toolbar">' +
        '<div class="cx-search hr-search" id="hr-search">' + ico('search') +
          '<input id="hr-q" type="text" autocomplete="off" placeholder="Фамилия или телефон">' +
          '<button type="button" class="cx-ibtn cx-clear" id="hr-q-clear" title="Очистить">' + ico('close') + '</button></div>' +
        '<div class="cx-chips" id="hr-vt">' +
          chip('all', 'Все', true) + chip('tral', 'Трал') + chip('long', 'Длинномер') + chip('none', 'Тип не указан') +
        '</div>' +
        '<div class="cx-chips" id="hr-flt">' +
          chip('mine', 'Ждут меня') + chip('recall', 'Пора перезвонить') + chip('warm', 'Тёплые') +
        '</div>' +
        '<span class="hr-count" id="hr-count"></span>' +
        '<button type="button" class="crm-chip hr-add" id="hr-add" data-nav-sound>' + ico('plus') + 'Добавить кандидата</button>' +
      '</div>' +
      '<div class="kb-hint">Перетащите карточку в соседний этап или в самый низ экрана - снизу появятся зоны «Вышел на работу» и «Отказ». Назад - с комментарием, отказ - с причиной (откроется карточка). Двигает хозяин этапа. Жёлтая точка - кандидат висит дольше срока этапа, красная - больше суток сверх срока.</div>' +
      '<div class="kb-panel"><div class="kb-board" id="hr-board"></div></div>' +
    '</div>' +
    // Полка во время перетаскивания и салют «Вышел на работу» - те же анатомии, что у канбана CRM (.kb-shelf, .crm-celebrate).
    '<div class="kb-shelf" id="hr-shelf">' +
      '<div class="kb-shelf-zone kb-shelf-zone--won" data-stage="hired">' + ico('won') + 'Вышел на работу</div>' +
      '<div class="kb-shelf-zone kb-shelf-zone--lost" data-stage="rejected">' + ico('lost') + 'Отказ</div>' +
    '</div>' +
    '<canvas class="crm-celebrate" id="hr-celebrate"></canvas>' +
    '<div class="mp-drawer-bk" id="hr-bk"></div>' +
    '<div class="mp-drawer mp-drawer-float mp-drawer-wide hr-drawer" id="hr-drawer" aria-hidden="true"></div>';
  var q = $('#hr-q');
  q.addEventListener('input', function () {
    S.q = this.value.trim().toLowerCase(); S.more = {};
    $('#hr-search').classList.toggle('has-value', !!this.value);
    renderBoard();
  });
  q.addEventListener('keydown', function (e) { if (e.key === 'Escape') clearSearch(); });
  $('#hr-q-clear').addEventListener('click', clearSearch);
  blockAutofill($('#hr-search'));
  $('#hr-vt').addEventListener('click', function (e) {
    var b = e.target.closest('.crm-chip'); if (!b) return;
    S.vt = b.getAttribute('data-v'); S.more = {};
    $$('#hr-vt .crm-chip').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    renderBoard();
  });
  $('#hr-flt').addEventListener('click', function (e) {
    var b = e.target.closest('.crm-chip'); if (!b) return;
    var v = b.getAttribute('data-v');
    S.flt = S.flt === v ? null : v; S.more = {};
    $$('#hr-flt .crm-chip').forEach(function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-v') === S.flt)); });
    renderBoard();
  });
  $('#hr-add').addEventListener('click', function () { openCreate(); });
  var kpiPick = function (e) {
    var t = e.target.closest('[data-kpi]');
    if (!t || (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ')) return;
    if (e.type === 'keydown') e.preventDefault();
    var k = t.getAttribute('data-kpi');
    S.kpi = S.kpi === k ? null : k; S.more = {};
    renderKpis(); renderBoard();
  };
  $('#hr-kpis').addEventListener('click', kpiPick);
  $('#hr-kpis').addEventListener('keydown', kpiPick);
  $('#hr-bk').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.mode && isActive()) closeDrawer(); });
  $('#hr-board').addEventListener('click', function (e) {
    var more = e.target.closest('[data-more]');
    if (more) { var k = more.getAttribute('data-more'); S.more[k] = (S.more[k] || 1) + 1; renderBoard(); return; }
    var card = e.target.closest('.kb-card[data-id]');
    if (S.suppressClick) { S.suppressClick = false; return; }   // клик, завершивший перетаскивание, - не открытие
    if (card) openCandidate(Number(card.getAttribute('data-id')));
  });
  // ГОСТ запрет №20: на интерактивной поверхности - без браузерного меню.
  ['#hr-board', '#hr-kpis', '#hr-drawer'].forEach(function (sel) { $(sel).addEventListener('contextmenu', function (e) { e.preventDefault(); }); });
  if (typeof initCursorLight_ === 'function') initCursorLight_(ROOT_ID, 'p2-light');
  // Живые значения: время на этапе и точки просрочки - раз в минуту; данные с сервера - раз в 3 минуты.
  setInterval(function () { if (!document.hidden && isActive()) { renderBoard(); renderKpis(); } }, 60000);
  setInterval(function () { if (!document.hidden && isActive() && !S.mode) reload(); }, POLL_MS);
}
function chip(v, label, on) {
  return '<button type="button" class="crm-chip" data-v="' + v + '" aria-pressed="' + (!!on) + '" data-nav-sound>' + esc(label) + '</button>';
}
function clearSearch() { var q = $('#hr-q'); q.value = ''; S.q = ''; $('#hr-search').classList.remove('has-value'); renderBoard(); }
function isActive() { var p = document.getElementById(ROOT_ID); return !!(p && p.classList.contains('active')); }

/* ───────── загрузка ───────── */
function load() {
  if (S.loading) return;
  S.loading = true;
  Promise.all([api('/hiring/meta'), api('/hiring/board'), api('/hiring/stats')]).then(function (r) {
    S.loading = false;
    var bad = r.filter(function (x) { return !x.ok; })[0];
    if (bad) {
      $('#hr-loading').textContent = bad.status === 403 ? 'Нет доступа к найму. Доступ выдаёт директор: Справочники -> Доступ и роли.' : (bad.data.error || 'Не удалось загрузить');
      $('#hr-loading').style.display = ''; $('#hr-body').style.display = 'none';
      return;
    }
    var firstMeta = !S.meta;
    S.meta = r[0].data; S.cands = r[1].data.candidates || []; S.stats = r[2].data;
    if (firstMeta) applyRoleDefaults();
    $('#hr-loading').style.display = 'none'; $('#hr-body').style.display = '';
    renderKpis(); renderBoard();
  });
}
/* Начальнику колонны и СБ по умолчанию - «Ждут меня»: его 3-5 кандидатов не тонут в общей базе.
   СБ кандидатов не заводит - кнопки нет (сервер всё равно ответил бы отказом). */
function applyRoleDefaults() {
  var rk = me().role_key;
  if (rk === 'column_head' || rk === 'security') {
    S.flt = 'mine';
    $$('#hr-flt .crm-chip').forEach(function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-v') === 'mine')); });
  }
  if (rk === 'security') { var a = $('#hr-add'); if (a) a.remove(); }
}
function reload(openId) {
  return Promise.all([api('/hiring/board'), api('/hiring/stats')]).then(function (r) {
    if (r[0].ok) S.cands = r[0].data.candidates || [];
    if (r[1].ok) S.stats = r[1].data;
    renderKpis(); renderBoard();
    if (openId) openCandidate(openId, true);
  });
}

/* ───────── KPI-плитки (цифры считает сервер; плитка = фильтр доски, как в CRM) ───────── */
function renderKpis() {
  var st = S.stats || {};
  var byStage = {}; (st.by_stage || []).forEach(function (x) { byStage[x.stage_key] = x.n; });
  var new7 = (st.new_7d_by_source || []).reduce(function (a, x) { return a + x.n; }, 0);
  var srcTop = (st.new_7d_by_source || []).slice().sort(function (a, b) { return b.n - a.n; }).slice(0, 2)
    .map(function (x) { return sourceLabel(x.source) + ' ' + x.n; }).join(' · ');
  var inWork = openStages().filter(function (s) { return s.stage_key !== 'callbase'; })
    .reduce(function (a, s) { return a + (byStage[s.stage_key] || 0); }, 0);
  var warm = S.cands.filter(function (c) { return c.stage_key === 'callbase' && c.warm; }).length;
  // Просрочка - живая, локально по доске; подпись - где именно застряло.
  var overBy = {};
  S.cands.forEach(function (c) { if (overdueMin(c) > 0) overBy[c.stage_key] = (overBy[c.stage_key] || 0) + 1; });
  var overN = Object.keys(overBy).reduce(function (a, k) { return a + overBy[k]; }, 0);
  var overSub = Object.keys(overBy).sort(function (a, b) { return overBy[b] - overBy[a]; }).slice(0, 2)
    .map(function (k) { var s = stageBy(k); return (s ? s.title : k) + ' ' + overBy[k]; }).join(' · ');
  var rejTop = (st.rejected_30d_reasons || []).slice(0, 2).map(function (x) { var r = reasonBy(x.reject_reason); return (r ? r.title : x.reject_reason) + ' ' + x.n; }).join(' · ');
  var mine = S.cands.filter(waitsMe).length;
  var boss = me().manage_all;
  var tiles = [];
  if (!boss) tiles.push({ key: 'mine', label: 'Ждут меня', val: mine, sub: 'кандидаты на моих этапах' });
  tiles.push({ key: 'new7', label: 'Новых за 7 дней', val: new7, sub: srcTop || 'пока нет' });
  tiles.push({ key: 'overdue', label: 'Просрочено сейчас', val: overN, sub: overSub || 'все в сроке', attn: overN > 0 });
  tiles.push({ key: 'work', label: 'В работе', val: inWork, sub: 'от отклика до оформления' });
  tiles.push({ key: 'hired', label: 'Вышли за 30 дней', val: st.hired_30d || 0, sub: 'этап «Вышел на работу»' });
  tiles.push({ key: 'rejected', label: 'Отказы за 30 дней', val: st.rejected_30d || 0, sub: rejTop || 'нет' });
  tiles.push({ key: 'callbase', label: 'База для обзвона', val: byStage.callbase || 0, sub: warm ? 'тёплых ' + warm : 'без срока' });
  $('#hr-kpis').innerHTML = tiles.map(function (t) {
    return '<div class="kpi' + (t.attn ? ' is-attention' : '') + '" role="button" tabindex="0" data-nav-sound data-kpi="' + t.key + '" aria-pressed="' + (S.kpi === t.key) + '" title="Показать на доске только этих кандидатов"><div class="kpi-label">' +
      (t.attn ? '<span class="crm-kpi-dot"></span>' : '') + esc(t.label) + '</div>' +
      '<div class="crm-kpi-val">' + esc(Number(t.val).toLocaleString('ru-RU')) + '</div>' +
      '<div class="kpi-sub">' + esc(t.sub) + '</div></div>';
  }).join('');
}

/* ───────── канбан ───────── */
function matchKpi(c) {
  if (!S.kpi) return true;
  var st = stageBy(c.stage_key);
  if (S.kpi === 'mine') return waitsMe(c);
  if (S.kpi === 'new7') return since(c.created_at) <= 7 * DAY_MS;
  if (S.kpi === 'overdue') return overdueMin(c) > 0;
  if (S.kpi === 'work') return !!st && !st.is_terminal && st.stage_key !== 'callbase';
  if (S.kpi === 'hired') return c.stage_key === 'hired' && since(c.stage_changed_at) <= 30 * DAY_MS;
  if (S.kpi === 'rejected') return c.stage_key === 'rejected' && since(c.stage_changed_at) <= 30 * DAY_MS;
  if (S.kpi === 'callbase') return c.stage_key === 'callbase';
  return true;
}
function matchFilter(c) {
  if (!matchKpi(c)) return false;
  if (S.flt === 'mine' && !waitsMe(c)) return false;
  if (S.flt === 'recall' && !recallDue(c)) return false;
  if (S.flt === 'warm' && !c.warm) return false;
  if (S.vt === 'none' && c.vehicle_type) return false;
  if (S.vt !== 'all' && S.vt !== 'none' && c.vehicle_type !== S.vt) return false;
  if (S.q) {
    var qd = digits10(S.q);
    var hay = String(c.full_name || '').toLowerCase();
    if (hay.indexOf(S.q) < 0 && !(qd.length >= 3 && String(c.phone10 || '').indexOf(qd) >= 0)) return false;
  }
  return true;
}
/* Порядок в колонке. База для обзвона - очередь: сначала «пора перезвонить», потом тёплые,
   потом не звонили ни разу, отработанные вниз. Остальные - срочные, просроченные, свежие. */
function sortCol(stKey, list) {
  if (stKey === 'callbase') {
    return list.sort(function (a, b) {
      var ra = recallDue(a) ? 0 : 1, rb = recallDue(b) ? 0 : 1; if (ra !== rb) return ra - rb;
      if (a.warm !== b.warm) return b.warm - a.warm;
      if ((a.call_attempts || 0) !== (b.call_attempts || 0)) return (a.call_attempts || 0) - (b.call_attempts || 0);
      return since(b.stage_changed_at) - since(a.stage_changed_at);
    });
  }
  return list.sort(function (a, b) {
    if (a.urgent !== b.urgent) return b.urgent - a.urgent;
    var oa = overdueMin(a), ob = overdueMin(b); if ((oa > 0) !== (ob > 0)) return ob > 0 ? 1 : -1;
    return since(a.stage_changed_at) - since(b.stage_changed_at);
  });
}
function cardHtml(c) {
  var over = overdueMin(c);
  var fresh = over > 1440 ? ' kb-stale' : over > 0 ? ' kb-wait' : ' kb-fresh';
  var won = c.stage_key === 'hired', lost = c.stage_key === 'rejected';
  var mark = won ? '<span class="kb-won-check" title="Вышел на работу">' + ico('check') + '</span>'
    : lost ? '<span class="kb-lost-mark" title="Отказ">' + ico('close') + '</span>'
    : '<span class="kb-pulse"' + (over > 0 ? ' title="Сверх срока этапа: ' + agoText(over * 60000) + '"' : '') + '></span>';
  var line = [VT_LABEL[c.vehicle_type] || 'тип не указан', c.license_cat, c.experience_years != null ? 'стаж ' + String(c.experience_years).replace('.', ',') + ' г' : null, c.city]
    .filter(Boolean).join(' · ');
  var tags = [];
  if (c.urgent) tags.push('<span class="hr-tag hr-tag-urgent">срочно</span>');
  if (recallDue(c)) tags.push('<span class="hr-tag hr-tag-urgent">перезвонить</span>');
  else if (c.recall_at) tags.push('<span class="hr-tag">перезвон ' + esc(fmtTime(c.recall_at)) + '</span>');
  if (c.warm) tags.push('<span class="hr-tag">тёплый</span>');
  if (c.call_attempts && !won && !lost) tags.push('<span class="hr-tag" title="Попыток дозвониться">попыток ' + c.call_attempts + '</span>');
  if (c.person_id) tags.push('<span class="hr-tag" title="Телефон совпал со справочником сотрудников">в справочнике</span>');
  var onSb = c.stage_key === 'security' && c.sb_status;
  // Ушёл дальше СБ без «нет компромата» (перенос из старой таблицы, решение руководителя) - предупреждаем словами.
  if (pastSbUnchecked(c)) tags.unshift('<span class="hr-tag hr-tag-urgent" title="Кандидат дальше этапа «Проверка СБ», а ответа «нет компромата» нет">' +
    esc(c.sb_status && c.sb_status !== 'approved' ? SB_TEXT[c.sb_status] || c.sb_status : 'без проверки СБ') + '</span>');
  if (onSb) tags.unshift('<span class="hr-tag hr-tag-sb ' + (SB_CLS[c.sb_status] || '') + '"' + (c.sb_comment ? ' title="' + esc(c.sb_comment) + '"' : '') + '>' + esc(SB_TEXT[c.sb_status] || c.sb_status) + '</span>');
  var loss = lost && c.reject_reason ? '<div class="kb-card-loss">' + esc((reasonBy(c.reject_reason) || {}).title || c.reject_reason) + '</div>' : '';
  return '<div class="kb-card' + fresh + (won ? ' kb-won-style' : '') + (lost ? ' kb-lost-style' : '') + (onSb && SB_CLS[c.sb_status] ? ' ' + SB_CLS[c.sb_status] : '') + (c.can_move ? ' hr-drag' : '') + (S.openId === c.id ? ' is-open' : '') + '" data-id="' + c.id + '">' +
    '<div class="kb-card-top"><span class="kb-client">' + esc(c.full_name || 'Без имени') + '</span>' + mark + '</div>' +
    '<div class="kb-cargo">' + esc(line) + '</div>' + loss +
    '<div class="kb-meta"><span class="kb-num">' + esc(fmtPhone(c.phone10)) + '</span><span class="kb-chan">' + esc(sourceLabel(c.source)) + '</span></div>' +
    '<div class="kb-card-bot"><span class="hr-bot-left">' + ownersHtml(c) + '<span class="kb-num" title="Сколько кандидат на этом этапе">' + esc(agoText(since(c.stage_changed_at))) + '</span></span>' +
      (tags.length ? '<span class="hr-tags">' + tags.join('') + '</span>' : '') + '</div>' +
  '</div>';
}
function slaText(min) {
  if (min == null) return '';
  if (min < 60) return min + ' мин';
  return min % 1440 === 0 ? (min / 1440) + ' дн' : Math.round(min / 60) + ' ч';
}
function renderBoard() {
  if (!S.meta || S.dragging) return;   // идёт перетаскивание - доску не перерисовываем (карточка сейчас в body)
  var list = S.cands.filter(matchFilter);
  $('#hr-count').textContent = list.length === S.cands.length ? 'кандидатов: ' + list.length : 'показано ' + list.length + ' из ' + S.cands.length;
  var board = $('#hr-board'), keepX = board.scrollLeft;
  var tops = {}; $$('.kb-col', board).forEach(function (c) { var l = $('.kb-list', c); if (l) tops[c.getAttribute('data-st')] = l.scrollTop; });
  board.innerHTML = stages().map(function (st) {
    var col = sortCol(st.stage_key, list.filter(function (c) { return c.stage_key === st.stage_key; }));
    var limit = PAGE_STEP * (S.more[st.stage_key] || 1);
    var cards = col.slice(0, limit).map(cardHtml).join('');
    var rest = col.length - Math.min(col.length, limit);
    var over = col.filter(function (c) { return overdueMin(c) > 0; }).length;
    var sla = slaText(st.sla_minutes);
    return '<div class="kb-col" data-st="' + esc(st.stage_key) + '" style="--stage:' + stageColor(st) + '">' +
      '<div class="kb-col-head"><span class="kb-stage-dot"></span><h4 class="kb-col-title" title="' + esc(st.title) + '">' + esc(st.title) + '</h4>' +
        '<span class="kb-count">' + col.length + '</span></div>' +
      (sla || over ? '<div class="hr-col-sla">' + (sla ? 'срок этапа ' + esc(sla) : '') + (over ? '<span class="hr-col-over">' + (sla ? ' · ' : '') + 'просрочено ' + over + '</span>' : '') + '</div>' : '') +
      '<div class="kb-list" data-col="' + esc(st.stage_key) + '">' + (cards || '<div class="kb-empty">Пусто</div>') +
        (rest > 0 ? '<button type="button" class="hr-more" data-more="' + esc(st.stage_key) + '">Показать ещё ' + Math.min(rest, PAGE_STEP) + ' из ' + rest + '</button>' : '') +
      '</div></div>';
  }).join('');
  board.scrollLeft = keepX;
  $$('.kb-col', board).forEach(function (c) { var l = $('.kb-list', c), t = tops[c.getAttribute('data-st')]; if (l && t) l.scrollTop = t; });
  $$('.kb-card.hr-drag', board).forEach(bindDrag);
}

/* ───────── перетаскивание - КЛОН канбана CRM (index.html, CRM.bindCard/flip/settle), ГОСТ разд.6 ─────────
   Физика буквально та же: порог 4px, lerp 0.28, наклон по лагу до ±7°, scale 1.03, плейсхолдер .kb-ph,
   FLIP соседей 300ms, settle 380ms с overshoot, Esc - вернуть на место; полка .kb-shelf снизу; звуки -
   регистр sounds5 CRM через общий uiBlip_ (выключатель звука сайдбара). Отличие от CRM - только правила
   найма: двигает хозяин этапа (карточки без can_move не берутся), вперёд - через сервер (он проверяет
   «следующий этап», тип техники и т.п., ошибка - откат с тостом), «Отказ» и «назад» не переносят карточку
   сразу, а открывают её шторку с формой причины / комментария (как askLostReason в CRM), «Вышел на работу» -
   победная сцена (салют bankCelebrate5_ + фанфара), как «Сделка успешна» в CRM.
   Палец (pointerType=touch) не тянет: на телефоне доска прокручивается, двигают кнопками в карточке. */
function blip(f1, f2, dur, vol, type, delay) { if (typeof uiBlip_ === 'function') uiBlip_(f1, f2, dur, vol, type, delay); }
var snd = {
  lift: function () { blip(1300, 950, 0.045, 0.07, 'sine'); blip(320, 260, 0.06, 0.045, 'triangle'); },
  reorder: function () { blip(780, 820, 0.03, 0.025, 'sine'); },
  drop: function () { blip(200, 70, 0.14, 0.12, 'sine'); blip(900, 500, 0.035, 0.045, 'triangle'); blip(140, 90, 0.1, 0.06, 'triangle', 0.01); },
  undo: function () { blip(660, 520, 0.09, 0.06, 'sine'); blip(520, 370, 0.12, 0.05, 'sine', 0.07); },
  open: function () { blip(280, 640, 0.18, 0.04, 'sine'); blip(140, 320, 0.18, 0.025, 'triangle'); },
  close: function () { blip(640, 280, 0.15, 0.035, 'sine'); blip(320, 140, 0.15, 0.02, 'triangle'); }
};
function reduced() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }
function candById(id) { return S.cands.filter(function (c) { return c.id === id; })[0] || null; }
function flip(containers, mutate) {
  var before = new Map();
  containers.forEach(function (c) { $$(':scope > .kb-card', c).forEach(function (n) { before.set(n, n.getBoundingClientRect()); }); });
  mutate();
  containers.forEach(function (c) {
    $$(':scope > .kb-card', c).forEach(function (n) {
      var b = before.get(n); if (!b || n.classList.contains('kb-lifted')) return;
      var a = n.getBoundingClientRect(), dx = b.left - a.left, dy = b.top - a.top;
      if (!dx && !dy) return;
      n.style.transition = 'none'; n.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'; n.getBoundingClientRect();
      requestAnimationFrame(function () { n.style.transition = 'transform 300ms cubic-bezier(.22,.9,.28,1)'; n.style.transform = ''; });
      n.addEventListener('transitionend', function te() { n.style.transition = ''; n.removeEventListener('transitionend', te); }, { once: true });
    });
  });
}
function bindDrag(card) {
  card.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'touch') return;                 // телефон - прокрутка и тап, не драг
    if (e.button !== undefined && e.button !== 0) return;
    var startX = e.clientX, startY = e.clientY, dragging = false, cancelled = false;
    var placeholder = null, rectAtStart = null, fromCol = null, fromIndex = 0, rafId = null;
    var cur = { x: 0, y: 0 }, target = { x: 0, y: 0 };
    var board = $('#hr-board'), shelf = $('#hr-shelf'), overShelf = null;
    try { card.setPointerCapture(e.pointerId); } catch (x) {}
    function physics() {
      cur.x += (target.x - cur.x) * 0.28; cur.y += (target.y - cur.y) * 0.28;
      var tilt = Math.max(-7, Math.min(7, (target.x - cur.x) * 0.10));
      card.style.transform = 'translate(' + cur.x + 'px,' + cur.y + 'px) rotate(' + tilt + 'deg) scale(1.03)';
      rafId = requestAnimationFrame(physics);
    }
    function onMove(ev) {
      var dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!dragging) {
        if (Math.hypot(dx, dy) < 4) return;
        dragging = true; S.dragging = true;
        rectAtStart = card.getBoundingClientRect();
        var list0 = card.closest('.kb-list'); fromCol = list0.getAttribute('data-col');
        fromIndex = Array.prototype.indexOf.call($$(':scope > .kb-card', list0), card);
        placeholder = document.createElement('div'); placeholder.className = 'kb-ph'; placeholder.style.height = rectAtStart.height + 'px';
        card.parentNode.insertBefore(placeholder, card);
        card.style.position = 'fixed'; card.style.left = rectAtStart.left + 'px'; card.style.top = rectAtStart.top + 'px'; card.style.width = rectAtStart.width + 'px';
        card.style.margin = '0'; card.style.zIndex = '1000'; card.style.pointerEvents = 'none'; card.style.willChange = 'transform';
        card.classList.add('kb-lifted'); document.body.appendChild(card);
        shelf.classList.add('is-on');
        snd.lift(); vibrate(8);
        if (reduced()) card.style.transform = 'translate(0,0) scale(1.03)'; else physics();
      }
      target.x = dx; target.y = dy;
      if (reduced()) card.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(1.03)';
      // Весь стек под курсором, а не верхний элемент: тост «Кандидат: … / Отменить» 5 с висит внизу по
      // центру ровно там, где выезжает полка, и угасающий тост перехватывает мышь - бросок в «Отказ» или
      // «Вышел» сразу после прошлого переноса молча не срабатывал (найдено тестом 24.09; в CRM то же).
      var stack = document.elementsFromPoint ? document.elementsFromPoint(ev.clientX, ev.clientY) : [document.elementFromPoint(ev.clientX, ev.clientY)];
      var zone = null, list = null;
      for (var si = 0; si < stack.length && !zone && !list; si++) {
        var el0 = stack[si]; if (!el0 || !el0.closest) continue;
        zone = el0.closest('.kb-shelf-zone');
        if (!zone) list = el0.closest('.kb-list');
      }
      overShelf = zone ? zone.getAttribute('data-stage') : null;
      $$('.kb-shelf-zone', shelf).forEach(function (z) { z.classList.toggle('kb-drop', z === zone); });
      $$('.kb-col', board).forEach(function (c) { c.classList.toggle('kb-drop', !!(list && c.contains(list))); });
      if (list && board.contains(list)) {
        var sib = $$(':scope > .kb-card', list), ref = null;
        for (var i = 0; i < sib.length; i++) { var r = sib[i].getBoundingClientRect(); if (ev.clientY < r.top + r.height / 2) { ref = sib[i]; break; } }
        var same = placeholder.parentNode === list && ((ref === null && placeholder.nextElementSibling === null) || placeholder.nextElementSibling === ref);
        if (!same) {
          var affected = [list]; if (placeholder.parentNode && placeholder.parentNode !== list) affected.push(placeholder.parentNode);
          flip(affected, function () { var em = $('.kb-empty', list); if (em) em.remove(); list.insertBefore(placeholder, ref); });
          snd.reorder();
        }
      }
    }
    function finish() {
      try { card.releasePointerCapture(e.pointerId); } catch (x) {}
      document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); document.removeEventListener('pointercancel', onCancel); window.removeEventListener('keydown', onKey);
      if (rafId) cancelAnimationFrame(rafId);
      shelf.classList.remove('is-on'); $$('.kb-shelf-zone', shelf).forEach(function (z) { z.classList.remove('kb-drop'); });
      $$('.kb-col', board).forEach(function (c) { c.classList.remove('kb-drop'); });
    }
    function settle(toList) {
      var first = reduced() ? { left: rectAtStart.left + target.x, top: rectAtStart.top + target.y } : { left: rectAtStart.left + cur.x, top: rectAtStart.top + cur.y };
      toList.insertBefore(card, placeholder); toList.removeChild(placeholder);
      ['position', 'left', 'top', 'width', 'margin', 'zIndex', 'pointerEvents', 'willChange'].forEach(function (p) { card.style[p] = ''; });
      var last = card.getBoundingClientRect();
      card.style.transition = 'none'; card.style.transform = 'translate(' + (first.left - last.left) + 'px,' + (first.top - last.top) + 'px) scale(1.03)';
      card.classList.remove('kb-lifted'); card.getBoundingClientRect();
      requestAnimationFrame(function () { card.style.transition = reduced() ? 'none' : 'transform 380ms cubic-bezier(.34,1.45,.5,1)'; card.style.transform = ''; });
      card.addEventListener('transitionend', function te() { card.style.transition = ''; card.removeEventListener('transitionend', te); }, { once: true });
      setTimeout(function () { S.dragging = false; }, 400);
    }
    function back() {
      var fromList = $('.kb-list[data-col="' + fromCol + '"]', board);
      var ref = $$(':scope > .kb-card', fromList)[fromIndex] || null;
      if (placeholder.parentNode !== fromList) fromList.insertBefore(placeholder, ref);
      settle(fromList);
    }
    function onKey(ke) { if (ke.key === 'Escape' && dragging) { cancelled = true; onUp(ke); } }
    function onCancel(ev) { if (dragging) { cancelled = true; onUp(ev); } else finish(); }
    function onUp() {
      finish();
      if (!dragging) return;                                  // простой клик - откроет обработчик click доски
      S.suppressClick = true; setTimeout(function () { S.suppressClick = false; }, 60);
      var id = Number(card.getAttribute('data-id')), c = candById(id);
      if (cancelled || !c || (!overShelf && !placeholder.parentNode)) { back(); snd.undo(); return; }
      var toList = placeholder.parentNode, toCol = overShelf || (toList ? toList.getAttribute('data-col') : null);
      if (!toCol || toCol === fromCol) { back(); snd.drop(); return; }   // порядок в колонке считает система, не рука
      dropTo_(c, card, fromCol, toCol, toList, back, settle);
    }
    document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp); document.addEventListener('pointercancel', onCancel); window.addEventListener('keydown', onKey);
  });
}
/* Что значит бросок в колонку toCol - правила найма поверх механики CRM. */
function dropTo_(c, card, fromCol, toCol, toList, back, settle) {
  var st = stageBy(fromCol), ts = stageBy(toCol);
  if (!ts) { back(); snd.undo(); return; }
  if (toCol === 'rejected') {                                  // причина обязательна - как askLostReason в CRM
    back(); snd.drop();
    openCandidate(c.id, false, function () { var f = $('#hr-lost-form'); if (f) { f.hidden = false; f.scrollIntoView({ block: 'center' }); } });
    return;
  }
  if (st && !st.is_terminal && !ts.is_terminal && ts.sort_order < st.sort_order) {   // назад - комментарий обязателен
    back(); snd.drop();
    openCandidate(c.id, false, function () {
      var f = $('#hr-back-form'); if (!f) return;
      f.hidden = false; $('#hr-back-to').textContent = ts.title; $('#hr-back-ok').setAttribute('data-to', toCol);
      var inp = $('#hr-back-comment'); if (inp) inp.focus();
    });
    return;
  }
  if (toCol === 'reserve' && !c.reserve_consent_at) { back(); snd.undo(); toast('В кадровый резерв - только с согласием кандидата. Отметьте его в карточке, раздел «Согласия».', 'amber'); return; }
  if (toCol === 'hired') { back(); hireWin_(c, card); return; }
  // Вперёд: карточка ложится сразу, сервер подтверждает (правила - hiring-rules.js); отказ сервера - откат.
  settle(toList); snd.drop(); vibrate(12);
  var prev = c.stage_key; c.stage_key = toCol; c.stage_changed_at = new Date().toISOString();
  api('/hiring/move', { id: c.id, to: toCol }).then(function (r) {
    if (!r.ok) { c.stage_key = prev; snd.undo(); toast(r.data.error || 'Не получилось', 'red'); setTimeout(function () { reload(); }, 420); return; }
    toast('Кандидат: ' + ts.title, 'green', { label: 'Отменить', fn: function () { undoLast_(c.id); } });
    setTimeout(function () { reload(); }, 420);
  });
}
/* «Вышел на работу» - победная сцена CRM: подсветка колонки, салют у карточки, фанфара, тост с «Отменить». */
function hireWin_(c, card) {
  api('/hiring/move', { id: c.id, to: 'hired' }).then(function (r) {
    if (!r.ok) { snd.undo(); toast(r.data.error || 'Не получилось', 'red'); return; }
    var col = $('#hr-board .kb-col[data-st="hired"]');
    if (col) { col.classList.add('kb-win-glow'); setTimeout(function () { col.classList.remove('kb-win-glow'); }, 300); }
    if (typeof bankWinFanfare_ === 'function') { try { bankWinFanfare_(1); } catch (e) {} }
    var cv = $('#hr-celebrate');
    if (cv && !reduced() && !document.hidden && typeof bankCelebrate5_ === 'function') {
      var rect = card.getBoundingClientRect();
      var tx = function (n, f) { return (typeof themeVar_ === 'function') ? themeVar_(n, f) : f; };
      try { bankCelebrate5_(cv, rect.left + rect.width / 2, rect.top + 6, { colors: [tx('--green', '#1D9E75'), tx('--amber', '#EF9F27'), tx('--text', '#e8e6df'), tx('--blue', '#378ADD')] }); } catch (e) {}
    }
    toast((c.full_name || 'Кандидат') + ' вышел на работу', 'green', { label: 'Отменить', fn: function () { undoLast_(c.id); } });
    setTimeout(function () { reload(); }, 600);
  });
}
function undoLast_(id) {
  api('/hiring/undo', { id: id }).then(function (r) {
    if (!r.ok) { toast(r.data.error || 'Отменить не получилось', 'red'); return; }
    snd.undo(); vibrate(8); toast('Отменено', 'green'); reload(S.openId === id ? id : null);
  });
}

/* ───────── шторка: каркас ───────── */
function openDrawer() {
  if (!$('#hr-drawer').classList.contains('show')) snd.open();
  $('#hr-bk').classList.add('show'); $('#hr-drawer').classList.add('show'); $('#hr-drawer').setAttribute('aria-hidden', 'false');
}
function closeDrawer() {
  if ($('#hr-drawer').classList.contains('show')) snd.close();
  S.mode = null; S.openId = null; S.cand = null;
  $('#hr-bk').classList.remove('show'); $('#hr-drawer').classList.remove('show'); $('#hr-drawer').setAttribute('aria-hidden', 'true');
  renderBoard();
}
/* Браузерные подсказки автозаполнения - блок (ГОСТ разд.4, усиленный вариант; дату тоже). */
function blockAutofill(root) {
  $$('input:not([type=checkbox]),textarea', root).forEach(function (i) {
    var isDate = i.type === 'date' || i.type === 'datetime-local';
    i.setAttribute('autocomplete', isDate ? 'off' : 'new-password');
    i.setAttribute('autocorrect', 'off'); i.setAttribute('spellcheck', 'false');
    if (!isDate) i.setAttribute('name', 'hr-' + Math.random().toString(36).slice(2, 9));
  });
}
/* Маски - клоны канонов ГОСТа: телефон (drvPhoneMask_, index.html) и деньги (wireMoneyInput_,
   order-plan-v2.js). Оба живут в чужих областях видимости, поэтому здесь копия той же логики. */
function wirePhoneMask(el) {
  if (!el) return;
  el.addEventListener('input', function () {
    var start = this.selectionStart;
    var rawBefore = this.value.slice(0, start).replace(/\D/g, '');
    if (rawBefore.charAt(0) === '7' || rawBefore.charAt(0) === '8') rawBefore = rawBefore.slice(1);
    var digitsBefore = rawBefore.length;
    var digits = this.value.replace(/\D/g, '');
    if (digits.charAt(0) === '7' || digits.charAt(0) === '8') digits = digits.slice(1);
    digits = digits.slice(0, 10);
    if (!digits.length) { this.value = ''; return; }
    var groups = [digits.slice(0, 3)];
    if (digits.length > 3) groups.push(digits.slice(3, 6));
    if (digits.length > 6) groups.push(digits.slice(6, 8));
    if (digits.length > 8) groups.push(digits.slice(8, 10));
    var numPart = groups.join('-');
    this.value = '+7-' + numPart;
    var count = 0, pos = numPart.length;
    for (var i = 0; i < numPart.length; i++) { if (numPart[i] !== '-') count++; if (count === digitsBefore) { pos = i + 1; break; } }
    try { this.setSelectionRange(3 + pos, 3 + pos); } catch (e) {}
  });
}
function wireMoneyMask(el) {
  if (!el) return;
  el.addEventListener('input', function () {
    var start = this.selectionStart;
    var digitsBefore = this.value.slice(0, start).replace(/\D/g, '').length;
    var digits = this.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    var formatted = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    this.value = formatted;
    var count = 0, pos = formatted.length;
    for (var i = 0; i < formatted.length; i++) { if (formatted[i] !== ' ') count++; if (count === digitsBefore) { pos = i + 1; break; } }
    if (digitsBefore === 0) pos = 0;
    try { this.setSelectionRange(pos, pos); } catch (e) {}
  });
}
function field(label, inner, full) {
  return '<div class="dr-field' + (full ? ' hr-full' : '') + '"><label>' + esc(label) + '</label>' + inner + '</div>';
}
function inp(key, val, attrs, cls) {
  return '<input class="dr-input' + (cls ? ' ' + cls : '') + '" data-f="' + key + '" type="text" value="' + esc(val == null ? '' : val) + '"' + (attrs || '') + '>';
}
/* Выбор значения поля чипами (.drv-chip - канон значения, как статус в карточке сотрудника). */
function valChips(key, val, opts) {
  var v = val == null ? '' : String(val);
  return '<div class="hr-vchips" data-chips="' + key + '">' + opts.map(function (o) {
    return '<button type="button" class="drv-chip" data-v="' + esc(o[0]) + '" aria-pressed="' + (v === String(o[0])) + '">' + esc(o[1]) + '</button>';
  }).join('') + '</div>';
}
var YN = [['1', 'Да'], ['0', 'Нет'], ['', 'Не знаем']];
function yn(key, val) { return valChips(key, val === 1 || val === true ? '1' : val === 0 || val === false ? '0' : '', YN); }
function chipVal(root, key) {
  var b = $('[data-chips="' + key + '"] .drv-chip[aria-pressed="true"]', root);
  return b ? b.getAttribute('data-v') : '';
}
/* Чипы-значения: клик выбирает; если передан onPick - сразу сохраняем (автосохранение карточки). */
function wireValChips(root, onPick) {
  $$('[data-chips]', root).forEach(function (g) {
    g.addEventListener('click', function (e) {
      var b = e.target.closest('.drv-chip'); if (!b || b.disabled) return;
      $$('.drv-chip', g).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      if (onPick) onPick(g.getAttribute('data-chips'), b.getAttribute('data-v'), g);
    });
  });
}

/* ───────── новый кандидат ───────── */
function openCreate() {
  S.mode = 'create'; S.openId = null; S.cand = null;
  var dr = $('#hr-drawer');
  dr.innerHTML =
    '<div class="crm-drawer-head"><div style="flex:1;min-width:0"><div class="dr-eyebrow"><span class="kb-stage-dot" style="--stage:var(--blue)"></span>Новый отклик</div>' +
      '<div class="dr-title">Новый кандидат</div><div class="dr-sub">Попадёт в колонку «Новый отклик», рекрутер получит уведомление</div></div>' +
      '<button type="button" class="cx-ibtn" id="hr-x" title="Закрыть (Esc)">' + ico('close') + '</button></div>' +
    '<div class="crm-drawer-body">' +
      '<div class="dr-section"><div class="dr-grid2 hr-grid">' +
        field('Телефон *', inp('phone', '', ' inputmode="tel" maxlength="16" placeholder="+7-900-000-00-00"', 'mono')) +
        field('ФИО', inp('full_name', '', ' maxlength="200" placeholder="Фамилия Имя Отчество"')) +
        field('Тип техники', valChips('vehicle_type', '', [['tral', 'Трал'], ['long', 'Длинномер'], ['', 'Не указан']]), true) +
        field('Откуда кандидат', valChips('source', 'avito', [['avito', 'Авито'], ['hh', 'hh.ru'], ['call', 'Звонок'], ['referral', 'Рекомендация'], ['manual', 'Другое']]), true) +
        field('Заметка', '<textarea class="dr-textarea" data-f="notes" maxlength="2000" rows="3" placeholder="Что уже известно о кандидате"></textarea>', true) +
        field('Согласие на обработку персональных данных', valChips('pd', '0', [['1', 'Получено'], ['0', 'Не получено']]), true) +
      '</div></div>' +
      '<button type="button" class="dr-calc-cta" id="hr-create-save">' + ico('plus') + 'Добавить кандидата</button>' +
    '</div>';
  wireValChips(dr, null);
  blockAutofill(dr); wirePhoneMask($('[data-f="phone"]', dr));
  $('#hr-x').addEventListener('click', closeDrawer);
  $('#hr-create-save').addEventListener('click', function () {
    var btn = this; btn.disabled = true;
    api('/hiring/candidate', {
      phone: $('[data-f="phone"]', dr).value, full_name: $('[data-f="full_name"]', dr).value, vehicle_type: chipVal(dr, 'vehicle_type'),
      source: chipVal(dr, 'source') || 'manual', notes: $('[data-f="notes"]', dr).value, pd_consent: chipVal(dr, 'pd') === '1'
    }).then(function (r) {
      btn.disabled = false;
      if (r.status === 409 && r.data.id) { toast('Кандидат с этим телефоном уже есть', 'amber', { label: 'Открыть', fn: function () { openCandidate(r.data.id); } }); return; }
      if (!r.ok) { toast(r.data.error || 'Не сохранилось', 'red'); return; }
      toast(r.data.person ? 'Добавлен. Телефон совпал со справочником: ' + r.data.person.full_name : 'Кандидат добавлен', 'green');
      reload(r.data.id);
    });
  });
  openDrawer();
  setTimeout(function () { var p = $('[data-f="phone"]', dr); if (p) p.focus(); }, 60);
}

/* ───────── карточка кандидата ───────── */
/* after(dr) - что сделать сразу после отрисовки (бросок в «Отказ» раскрывает форму причины,
   бросок назад - форму комментария; см. dropTo_). */
function openCandidate(id, keepScroll, after) {
  var dr = $('#hr-drawer');
  var body = $('.crm-drawer-body', dr);
  var top = keepScroll && body && S.openId === id ? body.scrollTop : 0;
  var same = S.openId === id && S.mode === 'view';
  S.mode = 'view'; S.openId = id;
  // Перерисовка той же карточки (после действия) - без мигания «Загрузка...» и с тем же скроллом.
  if (!same) dr.innerHTML = '<div class="crm-drawer-body"><div class="dr-empty">Загрузка карточки...</div></div>';
  openDrawer(); renderBoard();
  api('/hiring/candidate', null, { id: id }).then(function (r) {
    if (S.openId !== id) return;
    if (!r.ok) { dr.innerHTML = '<div class="crm-drawer-body"><div class="dr-empty">' + esc(r.data.error || 'Не удалось открыть') + '</div></div>'; return; }
    renderCandidate(r.data);
    var b2 = $('.crm-drawer-body', dr); if (b2 && top) b2.scrollTop = top;
    if (after) { try { after(dr); } catch (e) {} }
  });
}
var EV_TEXT = { create: 'Карточка создана', move: 'Этап', comment: 'Комментарий', edit: 'Правка карточки', import: 'Импорт из базы обзвона', attempt: 'Звонок', undo: 'Отмена перехода', avito: 'Отклик на Авито',
  assign: 'Ответственный', handoff: 'Передача в колонну', doc: 'Документы', sb: 'Служба безопасности' };
function timeline(d) {
  var items = [];
  (d.events || []).forEach(function (e) { items.push({ at: e.created_at, kind: 'ev', e: e }); });
  (d.messages || []).forEach(function (m) { items.push({ at: m.created_at, kind: 'msg', m: m }); });
  (d.calls || []).forEach(function (c) { items.push({ at: c.event_at, kind: 'call', c: c }); });
  items.sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
  if (!items.length) return '<div class="dr-empty">Событий пока нет</div>';
  return '<div class="dr-tl">' + items.slice(0, 80).map(function (it) {
    var icon = 'stage', cls = '', text;
    if (it.kind === 'ev') {
      var e = it.e;
      if (e.action === 'comment') icon = 'chat';
      if (e.action === 'attempt') { icon = 'phone'; cls = ' is-bad'; }
      if (e.action === 'move' && e.to_stage === 'rejected') cls = ' is-bad';
      if (e.action === 'move' && e.to_stage === 'hired') cls = ' is-good';
      var head = EV_TEXT[e.action] || e.action;
      if (e.action === 'move' || e.action === 'import' || e.action === 'undo' || (e.action === 'avito' && e.to_stage)) head += ': ' + (stageBy(e.from_stage) ? stageBy(e.from_stage).title + ' -> ' : '') + ((stageBy(e.to_stage) || {}).title || e.to_stage || '');
      if (e.reason_key) head += ' · ' + ((reasonBy(e.reason_key) || {}).title || e.reason_key);
      var own = e.action === 'comment' || e.action === 'attempt' || e.action === 'avito';
      text = '<div class="dr-tl-text' + (own ? '' : ' muted') + '">' + esc(own ? (e.comment || head) : head) + '</div>' +
        (e.comment && !own ? '<div class="dr-tl-text">' + esc(e.comment) + '</div>' : '') +
        '<div class="dr-tl-meta"><span>' + esc(fmtDateTime(it.at)) + '</span>' + (e.actor_name ? '<span>' + esc(e.actor_name) + '</span>' : '') + '</div>';
    } else if (it.kind === 'msg') {
      var m = it.m; icon = 'chat';
      text = '<div class="dr-tl-text"><span style="color:var(--muted)">' + esc(m.direction === 'out' ? (m.sender_name || 'Мы') : 'Кандидат') + ':</span> ' +
        esc(m.text || (m.msg_type === 'voice' ? 'Голосовое сообщение' : m.msg_type === 'image' ? 'Фото' : 'Вложение')) + '</div>' +
        '<div class="dr-tl-meta"><span>' + esc(fmtDateTime(it.at)) + '</span><span>' + esc(m.channel === 'avito' ? 'Авито' : (m.channel || '')) + '</span></div>';
    } else {
      icon = 'phone';
      text = '<div class="dr-tl-text">Звонок в Mango</div><div class="dr-tl-meta"><span>' + esc(fmtDateTime(it.at)) + '</span>' + (it.c.extension ? '<span>доб. ' + esc(it.c.extension) + '</span>' : '') + '</div>';
    }
    return '<div class="dr-tl-item"><span class="dr-tl-ico' + cls + '">' + ico(icon) + '</span><div>' + text + '</div></div>';
  }).join('') + '</div>';
}
/* ───────── документы кандидата (для СБ и НК). Файл открывается через blob с заголовком сессии -
   токен в адрес НЕ кладём (в логах nginx он бы остался). Распознавания нет - решение Влада 25.09. ───────── */
var DOC_LABEL = { passport: 'Паспорт', passport_reg: 'Прописка', license: 'Вод. удостоверение', skzi: 'Карта СКЗИ', med: 'Медсправка', other: 'Другое' };
function fmtBytes(n) { n = Number(n) || 0; return n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ'; }
function loadDocs(id) {
  api('/hiring/documents', null, { id: id }).then(function (r) {
    if (S.openId !== id || !$('#hr-docs')) return;
    if (!r.ok) { $('#hr-docs').innerHTML = '<div class="dr-empty">Не удалось загрузить список</div>'; return; }
    paintDocs(id, r.data);
  });
}
function paintDocs(id, data) {
  var docs = data.documents || [];
  $('#hr-docs-n').textContent = docs.length ? String(docs.length) : '';
  var ocr = data.ocr || {};
  var rows = docs.map(function (x) {
    var ocrBtn = x.can_ocr && x.ocr_state === 'none' && ocr.enabled ? '<button type="button" class="crm-chip" data-ocr="' + x.id + '" title="Платно: 0,71 ₽ из гранта Yandex Cloud">Распознать</button>' : '';
    return '<div class="hr-doc-wrap"><div class="dr-row hr-doc"><span class="hr-doc-name"><button type="button" class="hr-doc-open" data-doc="' + x.id + '" title="Открыть">' + esc(x.original_name || 'файл') + '</button>' +
      '<span class="aux">' + esc(DOC_LABEL[x.doc_type] || 'Другое') + ' · ' + esc(fmtBytes(x.size_bytes)) + ' · ' + esc(fmtDateTime(x.uploaded_at)) + (x.uploaded_name ? ' · ' + esc(x.uploaded_name) : '') + '</span></span>' +
      ocrBtn + (x.can_delete ? '<button type="button" class="cx-ibtn" data-doc-del="' + x.id + '" title="Удалить">' + ico('close') + '</button>' : '') + '</div>' +
      ocrBlock(x, data.can_upload) + '</div>';
  }).join('');
  var hasOcrDocs = docs.some(function (x) { return !x.ocr_problem; });
  var ocrLine = data.can_upload && hasOcrDocs ? '<div class="hr-doc-hint">' + (ocr.enabled
    ? 'Распознавание паспорта и ВУ - пилот до ' + esc(String(ocr.until || '').split('-').reverse().join('.')) + ', в этом месяце ' + ocr.used + ' из ' + ocr.limit + '. Только по кнопке, данные потом проверяет человек.'
    : 'Распознавание недоступно: ' + esc(ocr.reason || '')) + '</div>' : '';
  var add = data.can_upload ? '<div class="cx-chips hr-owner-pick">' + Object.keys(DOC_LABEL).map(function (k) {
    return '<button type="button" class="crm-chip" data-doc-add="' + k + '">' + ico('plus') + esc(DOC_LABEL[k]) + '</button>';
  }).join('') + '</div><div class="hr-doc-hint">PDF или фото (JPG, PNG, HEIC), до 15 МБ. Видят руководители, HR и начальник колонны кандидата, СБ.</div>' : '';
  $('#hr-docs').innerHTML = (rows || '<div class="dr-empty">Документов пока нет</div>') + ocrLine + add;
  $$('#hr-docs [data-doc]').forEach(function (b) { b.addEventListener('click', function () { openDoc(b.getAttribute('data-doc')); }); });
  $$('#hr-docs [data-ocr]').forEach(function (b) {
    b.addEventListener('click', function () {
      b.disabled = true; b.textContent = 'Распознаю...';
      api('/hiring/document_ocr', { doc: Number(b.getAttribute('data-ocr')) }).then(function (r) {
        if (!r.ok) { toast(r.data.error || 'Не распознано', 'red'); b.disabled = false; b.textContent = 'Распознать'; return; }
        toast('Распознано - проверьте поля и сохраните', 'green'); loadDocs(id);
      });
    });
  });
  $$('#hr-docs [data-ocr-edit]').forEach(function (b) {
    b.addEventListener('click', function () { var w = b.closest('.hr-doc-wrap'); $('.hr-ocr-view', w).hidden = true; $('.hr-ocr-form', w).hidden = false; });
  });
  $$('#hr-docs [data-ocr-save]').forEach(function (b) {
    b.addEventListener('click', function () {
      var w = b.closest('.hr-doc-wrap');
      var fields = $$('[data-ocr-key]', w).map(function (el) { return { key: el.getAttribute('data-ocr-key'), value: el.value }; });
      var an = $('[data-apply="name"]', w), ac = $('[data-apply="cat"]', w);
      b.disabled = true;
      api('/hiring/document_ocr_save', { doc: Number(b.getAttribute('data-ocr-save')), fields: fields, apply_name: !!(an && an.checked), apply_cat: !!(ac && ac.checked) }).then(function (r) {
        b.disabled = false;
        if (!r.ok) { toast(r.data.error || 'Не сохранилось', 'red'); return; }
        toast('Данные документа сохранены' + ((r.data.applied || []).length ? ', карточка обновлена' : ''), 'green');
        if ((r.data.applied || []).length) openCandidate(id, true); else loadDocs(id);
      });
    });
  });
  $$('#hr-docs [data-doc-del]').forEach(function (b) {
    b.addEventListener('click', function () {
      var name = (b.closest('.hr-doc').querySelector('.hr-doc-open') || {}).textContent || 'документ';
      var go = function (yes) {
        if (!yes) return;
        api('/hiring/document_delete', { doc: Number(b.getAttribute('data-doc-del')) }).then(function (r) {
          if (!r.ok) { toast(r.data.error || 'Не удалилось', 'red'); return; }
          toast('Документ удалён', 'amber'); loadDocs(id);
        });
      };
      // Общий диалог подтверждения ГОСТа (files/yard-confirm.js); нет его (превью) - системный confirm.
      if (window.yardConfirm_) window.yardConfirm_('Удалить «' + esc(name) + '»? Файл <b>удалится с сервера</b>, вернуть его будет нельзя.', go, 'Документ кандидата', 'Удалить');
      else go(confirm('Удалить документ? Файл удалится с сервера.'));
    });
  });
  var input = $('#hr-doc-file'), pickedType = 'other';
  $$('#hr-docs [data-doc-add]').forEach(function (b) {
    b.addEventListener('click', function () { pickedType = b.getAttribute('data-doc-add'); input.value = ''; input.click(); });
  });
  input.onchange = function () {
    var f = input.files && input.files[0]; if (!f) return;
    if (f.size > 15 * 1048576) { toast('Файл больше 15 МБ', 'red'); return; }
    var fd = new FormData(); fd.append('file', f);
    toast('Загружаю «' + f.name + '»...', 'amber');
    fetch(apiBase() + '/hiring/document_upload?id=' + id + '&doc_type=' + encodeURIComponent(pickedType), { method: 'POST', headers: { 'X-Session-Token': apiToken() }, body: fd })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) { return { ok: res.ok, data: d }; }); })
      .then(function (r) {
        if (!r.ok) { toast(r.data.error || 'Не удалось загрузить файл', 'red'); return; }
        toast(DOC_LABEL[pickedType] + ': загружено', 'green'); loadDocs(id);
      })
      .catch(function () { toast('Нет связи с сервером', 'red'); });
  };
}
/* Распознанные поля документа: черновик - форма «проверьте и сохраните» (распознавание ошибается, особенно
   на рукописном «кем выдан»), проверенные - строки только для чтения + «Исправить» (без нового платного вызова). */
function ocrBlock(x, canEdit) {
  if (x.ocr_state === 'none' || !x.ocr_fields || !x.ocr_fields.length) return '';
  var isLicense = x.doc_type === 'license';
  var form = '<div class="hr-ocr-form"' + (x.ocr_state === 'confirmed' ? ' hidden' : '') + '>' +
    '<div class="hr-hint-amber">Распознано автоматически - сверьте с документом и исправьте ошибки.</div>' +
    '<div class="dr-grid2 hr-grid">' + x.ocr_fields.map(function (f) {
      return '<div class="dr-field"><label>' + esc(f.label) + '</label><input class="dr-input" data-ocr-key="' + esc(f.key) + '" value="' + esc(f.value) + '" maxlength="300"' + (canEdit ? '' : ' disabled') + '></div>';
    }).join('') + '</div>' +
    (canEdit ? '<div class="hr-inline hr-wrap hr-ocr-apply">' +
      '<label class="hr-check"><input type="checkbox" data-apply="name"> ФИО - в карточку кандидата</label>' +
      (isLicense ? '<label class="hr-check"><input type="checkbox" data-apply="cat" checked> Категорию (CE) - в карточку</label>' : '') +
      '<button type="button" class="crm-chip" data-ocr-save="' + x.id + '">' + ico('check') + 'Сохранить проверенное</button></div>' : '') +
  '</div>';
  var view = x.ocr_state === 'confirmed' ? '<div class="hr-ocr-view">' + x.ocr_fields.map(function (f) {
      return '<div class="dr-row"><span>' + esc(f.label) + '</span><span>' + esc(f.value) + '</span></div>';
    }).join('') +
    '<div class="hr-doc-hint">Проверено' + (x.ocr_confirmed_name ? ': ' + esc(x.ocr_confirmed_name) : '') + (x.ocr_confirmed_at ? ', ' + esc(fmtDateTime(x.ocr_confirmed_at)) : '') +
      (canEdit ? ' · <button type="button" class="hr-doc-open hr-link" data-ocr-edit="' + x.id + '">Исправить</button>' : '') + '</div></div>' : '';
  return '<div class="hr-ocr">' + view + form + '</div>';
}
function openDoc(docId) {
  // Окно открываем сразу по клику (иначе браузер телефона заблокирует всплывающее), адрес - после загрузки.
  var w = window.open('', '_blank');
  fetch(apiBase() + '/hiring/document_file?doc=' + encodeURIComponent(docId), { headers: { 'X-Session-Token': apiToken() } })
    .then(function (res) { if (!res.ok) throw new Error(String(res.status)); return res.blob(); })
    .then(function (blob) {
      var url = URL.createObjectURL(blob);
      if (w) w.location.href = url; else window.location.href = url;
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    })
    .catch(function () { if (w) w.close(); toast('Не удалось открыть документ', 'red'); });
}
/* Секция «Проверка СБ»: текущий ответ (цвет + словами), чего не хватает для отправки, прежние проверки из таблицы СБ. */
function sbSection(c, d) {
  var hist = d.sb_history || [];
  var onSb = c.stage_key === 'security';
  var past = pastSbUnchecked(c);
  if (!c.sb_status && !hist.length && c.stage_key !== 'screening' && !onSb && !past) return '';
  var now = c.sb_status ? '<div class="dr-row"><span>Сейчас</span><span><span class="hr-tag hr-tag-sb ' + (SB_CLS[c.sb_status] || '') + '">' + esc(SB_TEXT[c.sb_status] || c.sb_status) + '</span>' +
      (c.sb_comment && c.sb_status !== 'approved' ? ' <span class="aux">«' + esc(c.sb_comment) + '»</span>' : '') + (c.sb_at ? ' <span class="aux mono">' + esc(fmtDateTime(c.sb_at)) + '</span>' : '') + '</span></div>' : '';
  var miss = c.stage_key === 'screening' ? sbMissing(c) : [];   // уже отправлен - подсказка не нужна
  var rej = onSb && c.sb_status === 'rejected' && c.can_move ? '<button type="button" class="crm-chip is-bad" id="hr-sb-reject">' + ico('lost') + 'Отказ: не прошёл СБ</button>' : '';
  if (onSb && (c.sb_status === 'question' || c.sb_status === 'interview') && c.can_move) rej += '<button type="button" class="crm-chip" id="hr-sb-resend">' + ico('undo') + 'Отправить в СБ заново (паспорт поправлен)</button>';
  // Уже дальше СБ, а проверки не было: отправить, не двигая этап (заполните паспорт - кнопка проверит).
  if (past && c.sb_status !== 'queued' && c.sb_status !== 'pending' && (c.can_move || c.can_edit)) {
    rej = '<div class="hr-hint-amber">Кандидат прошёл дальше без ответа СБ «нет компромата».</div>' + rej +
      '<button type="button" class="crm-chip" id="hr-sb-resend">' + ico('undo') + 'Отправить в СБ</button>';
  }
  var rows = hist.map(function (h) {
    var dt = h.check_date ? fmtDate(h.check_date) : (h.date_raw || '');
    return '<div class="dr-row"><span class="mono">' + esc(dt || '-') + '</span><span>' + esc(h.position || '') + ' · <span class="hr-tag hr-tag-sb ' + (SB_CLS[h.sb_status] || '') + '">' +
      esc(SB_TEXT[h.sb_status] || h.sb_status) + '</span>' + (h.sb_comment && h.sb_status !== 'approved' ? ' <span class="aux">«' + esc(h.sb_comment) + '»</span>' : '') + '</span></div>';
  }).join('');
  return '<div class="dr-section"><div class="dr-label">Проверка СБ <span class="aux">таблица службы безопасности</span></div>' + now +
    (miss.length ? '<div class="hr-hint-amber">Для отправки в СБ не заполнено: ' + esc(miss.join(', ')) + '</div>' : '') + rej +
    (rows ? '<div class="hr-doc-hint">Записи о нём в таблице СБ:</div>' + rows : '') + '</div>';
}
function fmtDate(v) { var d = new Date(String(v).slice(0, 10) + 'T12:00:00Z'); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU'); }
/* «Взять из распознанного паспорта»: поля проверенного (или хотя бы распознанного) паспорта -> в пустые поля карточки. */
function passFromOcr(c, btn) {
  btn.disabled = true;
  api('/hiring/documents', null, { id: c.id }).then(function (r) {
    btn.disabled = false;
    var doc = ((r.data && r.data.documents) || []).filter(function (x) { return x.doc_type === 'passport' && x.ocr_fields && x.ocr_fields.length; })
      .sort(function (a, b) { return (b.ocr_state === 'confirmed') - (a.ocr_state === 'confirmed'); })[0];
    if (!doc) { toast('Нет распознанного паспорта: загрузите фото в «Документы» и нажмите «Распознать»', 'amber'); return; }
    var g = function (k) { return ((doc.ocr_fields.filter(function (x) { return x.key === k; })[0]) || {}).value || ''; };
    var iso = function (v) { var m = String(v || '').match(/(\d{2})\.(\d{2})\.(\d{4})/); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
    /* адрес регистрации: из самого паспорта (многостраничный PDF, 25.09) или из отдельного документа «Прописка» */
    var regDoc = ((r.data && r.data.documents) || []).filter(function (x) { return x.doc_type === 'passport_reg' && x.ocr_fields && x.ocr_fields.length; })[0];
    var regOf = function (dd) { return dd ? ((dd.ocr_fields.filter(function (x) { return x.key === 'reg_address'; })[0]) || {}).value || '' : ''; };
    var want = { birth_date: iso(g('birth_date')), birth_place: g('birth_place'), passport_no: g('number'),
      passport_issued_by: [g('issued_by'), g('subdivision') ? 'код ' + g('subdivision') : ''].filter(Boolean).join(', '), passport_issue_date: iso(g('issue_date')),
      reg_address: regOf(doc) || regOf(regDoc) };
    var body = { id: c.id }, n = 0;
    Object.keys(want).forEach(function (k) { if (want[k] && !c[k]) { body[k] = want[k]; n++; } });
    if (!n) { toast('Поля паспорта уже заполнены - перенос не нужен', 'amber'); return; }
    api('/hiring/candidate', body).then(function (r2) {
      if (!r2.ok) { toast(r2.data.error || 'Не сохранилось', 'red'); return; }
      toast('Из паспорта перенесено полей: ' + n + (doc.ocr_state === 'confirmed' ? '' : ' (паспорт не проверен человеком - сверьте)'), doc.ocr_state === 'confirmed' ? 'green' : 'amber');
      openCandidate(c.id, true);
    });
  });
}
/* Главная кнопка «куда дальше» - подпись по следующему этапу; для НК - кому именно. */
function nextAction(c) {
  var st = stageBy(c.stage_key); if (!st || st.is_terminal) return null;
  var nextKey = st.stage_key === 'callbase' ? 'screening' : null;
  if (!nextKey) {
    var open = openStages(), i = open.map(function (s) { return s.stage_key; }).indexOf(st.stage_key);
    nextKey = i >= 0 && i < open.length - 1 ? open[i + 1].stage_key : 'hired';
  }
  var ns = stageBy(nextKey); if (!ns) return null;
  var label = 'Дальше: ' + ns.title;
  if (nextKey === 'screening') label = 'Взял в работу: скрининг';
  // Порядок этапов с 25.09 (HR): скрининг -> СБ -> собеседование с НК -> тестовая смена.
  if (nextKey === 'column_interview') {
    var heads = (S.meta && S.meta.column_heads) || {};
    label = c.vehicle_type ? 'СБ пройдена: к НК' + (heads[c.vehicle_type] ? ' ' + heads[c.vehicle_type] : '') + ' (' + VT_COL[c.vehicle_type] + ')' : 'СБ пройдена: к начальникам колонн (колонна не определена)';
  }
  if (nextKey === 'security') label = 'Скрининг пройден: на проверку СБ';
  // Дальше СБ - только после «нет компромата» (сервер проверяет так же; руководитель может и без).
  if (st.stage_key === 'security' && c.sb_status !== 'approved' && !me().manage_all) {
    var wait = { rejected: 'СБ отказала - переведите кандидата в «Отказ»', interview: 'СБ просит собеседование - ждём решения СБ',
      question: 'У СБ вопрос - поправьте паспорт и отправьте заново' }[c.sb_status] || (c.sb_status === 'queued' ? 'Отправляется в таблицу СБ...' : 'Ждём ответа СБ');
    return { key: nextKey, label: wait, disabled: true };
  }
  if (nextKey === 'onboarding') label = 'Собеседование пройдено: тестовая смена';
  if (nextKey === 'hired') label = 'Вышел на работу';
  return { key: nextKey, label: label };
}
/* Что HR не заполнил на скрининге (он передаёт дальше - на СБ, потом к НК) - мягкое предупреждение. */
function missingForNk(c) {
  var m = [];
  if (!c.vehicle_type) m.push('тип техники (без него кандидата возьмёт первый свободный НК)');
  if (!c.license_cat) m.push('категория');
  if (c.has_skzi == null || c.has_skzi === '') m.push('карта СКЗИ');
  if (c.experience_years == null || c.experience_years === '') m.push('стаж');
  if (!c.start_date) m.push('дата выхода');
  return m;
}
function renderCandidate(d) {
  var c = d.candidate, st = stageBy(c.stage_key);
  S.cand = c;
  var dr = $('#hr-drawer');
  var ro = !c.can_edit;
  var dis = ro ? ' disabled' : '';
  var over = overdueMin(c);
  var na = c.can_move ? nextAction(c) : null;
  var miss = na && c.stage_key === 'screening' ? missingForNk(c).concat(sbMissing(c).map(function (x) { return x + ' (для СБ)'; })) : [];
  var open = openStages();
  var curIdx = open.map(function (s) { return s.stage_key; }).indexOf(c.stage_key);
  var boss = !!me().manage_all;
  var stepper = '<div class="dr-stages" style="grid-template-columns:repeat(' + open.length + ',1fr)">' + open.map(function (s, i) {
    var cls = s.stage_key === c.stage_key ? ' is-cur' : (curIdx >= 0 && i < curIdx ? ' is-done' : '');
    // Назад - можно (с комментарием), вперёд - только на следующий этап; руководитель - любой.
    var canClick = c.can_move && s.stage_key !== c.stage_key && (boss || (curIdx >= 0 && i < curIdx) || (na && na.key === s.stage_key));
    return '<button type="button" class="dr-stage' + cls + '" style="--stage:' + stageColor(s) + '" data-stage="' + esc(s.stage_key) + '" title="' + esc(s.title) + '"' + (canClick ? ' data-nav-sound' : ' disabled') + '>' + esc(s.title) + '</button>';
  }).join('') + '</div>';
  var reasons = (S.meta.reasons || []);
  var term = c.can_move ? '<div class="dr-stage-term">' +
      (st && st.is_terminal ? (boss ? '<button type="button" class="crm-chip" data-act="reopen">' + ico('undo') + 'Вернуть в работу</button>' : '') :
        '<button type="button" class="crm-chip is-bad" data-act="lost">' + ico('lost') + 'Отказ</button>' +
        '<button type="button" class="crm-chip" data-act="reserve">' + ico('user') + 'В кадровый резерв</button>') +
    '</div>' : '';
  var backForm = '<div class="hr-form" id="hr-back-form" hidden><div class="dr-label">Вернуть на этап <span class="aux" id="hr-back-to"></span></div>' +
    '<div class="hr-inline"><input class="dr-input" id="hr-back-comment" maxlength="2000" placeholder="Почему возвращаем - обязательно"><button type="button" class="crm-chip" id="hr-back-ok">' + ico('undo') + 'Вернуть</button></div></div>';
  var reasonChips = function (side) {
    return reasons.filter(function (x) { return x.side === side; }).map(function (x) { return '<button type="button" class="crm-chip" aria-pressed="false" data-reason="' + esc(x.reason_key) + '">' + esc(x.title) + '</button>'; }).join('');
  };
  var lostForm = '<div class="hr-form" id="hr-lost-form" hidden><div class="dr-label">Причина отказа <span class="aux">обязательно</span></div>' +
    '<div class="hr-reason-group"><span class="hr-reason-side">Мы отказали</span><div class="cx-chips">' + reasonChips('company') + '</div></div>' +
    '<div class="hr-reason-group"><span class="hr-reason-side">Кандидат ушёл</span><div class="cx-chips">' + reasonChips('candidate') + '</div></div>' +
    '<div class="hr-inline"><input class="dr-input" id="hr-lost-comment" maxlength="2000" placeholder="Комментарий (по желанию)"><button type="button" class="crm-chip is-bad" id="hr-lost-ok" disabled>Подтвердить отказ</button></div></div>';
  var callSec = c.can_move && st && ['callbase', 'new', 'screening'].indexOf(st.stage_key) >= 0 ?
    '<div class="dr-section"><div class="dr-label">Звонок <span class="aux">' + (c.call_attempts ? 'попыток ' + c.call_attempts + (c.last_attempt_at ? ', последняя ' + esc(fmtDateTime(c.last_attempt_at)) : '') : 'ещё не звонили') + '</span></div>' +
      '<div class="hr-inline hr-wrap"><a class="crm-chip" href="tel:+7' + esc(c.phone10 || '') + '">' + ico('phone') + 'Позвонить</a>' +
      '<button type="button" class="crm-chip" data-act="attempt">Не дозвонился</button>' +
      '<button type="button" class="crm-chip" data-recall="120">Не дозвонился, перезвон через 2 часа</button>' +
      '<button type="button" class="crm-chip" data-recall="tomorrow">Не дозвонился, перезвон завтра 10:00</button></div>' +
      '<div class="dr-field hr-recall-field"><label>Перезвонить (дата и время)</label><input class="dr-input mono" type="datetime-local" id="hr-recall" value="' + esc(toLocalInput(c.recall_at)) + '"></div>' +
      (c.call_attempts >= 3 ? '<div class="hr-hint-amber">Три попытки без ответа - можно закрыть отказом «Пропал / недозвон».</div>' : '') +
    '</div>' : '';
  /* Ответственные - как у менеджеров в CRM: HR (кто взял в работу) и колонна (начальник колонны).
     Руководитель переназначает HR чипами (тот же вид, что выбор ответственного в шторке сделки CRM). */
  var takeBtn = c.can_take ? '<button type="button" class="crm-chip" data-take="1">' + ico('user') + 'Взять себе</button>' : '';
  var st0 = st || {};
  var hrRow = '<div class="dr-row"><span>HR</span><span class="hr-owner">' +
      (c.recruiter_name ? ava(c.recruiter_name, c.recruiter_email, c.recruiter_name) + esc(c.recruiter_name) : '<span class="aux">никто не взял в работу</span>') +
      (st0.owner_role === 'recruiter' ? takeBtn : '') + '</span></div>';
  var hrPick = boss && (S.meta.recruiters || []).length ? '<div class="cx-chips hr-owner-pick">' + (S.meta.recruiters || []).map(function (r) {
      return '<button type="button" class="crm-chip" aria-pressed="' + (r.email === c.recruiter_email) + '" data-hr="' + esc(r.email) + '">' + ava(r.name, r.email, r.name) + esc(r.name) + '</button>';
    }).join('') + (c.recruiter_email ? '<button type="button" class="crm-chip" data-hr="">В общий пул</button>' : '') + '</div>' : '';
  var colHead = headOf(c.vehicle_type);
  var colRow = c.column_at || c.vehicle_type ? '<div class="dr-row"><span>Колонна</span><span class="hr-owner">' +
      (c.vehicle_type ? ava(colHead, c.vehicle_type, colHead || VT_COL[c.vehicle_type]) + esc(VT_COL[c.vehicle_type]) + (colHead ? ' · ' + esc(colHead) : '') +
          (c.column_at ? '' : ' <span class="aux">после скрининга</span>') :
        '<span class="aux">не определена - возьмёт первый начальник колонны</span>') +
      (st0.owner_role === 'column_head' ? takeBtn : '') + '</span></div>' : '';
  // Себе ничью карточку НК берёт кнопкой «Взять себе» - «Передать» в свою же колонну не дублируем.
  var handoff = (c.can_handoff || []).filter(function (v) { return v !== me().segment; }).map(function (v) {
    var h = headOf(v);
    return '<button type="button" class="crm-chip" data-handoff="' + esc(v) + '">' + ico('undo') + 'Передать: ' + esc(VT_COL[v]) + (h ? ' (' + esc(h) + ')' : '') + '</button>';
  }).join('');
  var ownersSec = '<div class="dr-section"><div class="dr-label">Ответственные</div>' + hrRow + hrPick + colRow +
    (handoff ? '<div class="cx-chips hr-owner-pick">' + handoff + '</div>' : '') + '</div>';
  var personHtml = d.person ? '<div class="dr-row"><span>В справочнике сотрудников</span><span>' + esc(d.person.full_name) + ' · ' + esc(d.person.employment_status === 'active' ? 'работает' : d.person.employment_status === 'fired' ? 'уволен' + (d.person.fired_date ? ' ' + String(d.person.fired_date).slice(0, 10) : '') : d.person.employment_status) + '</span></div>' : '';
  var consentRow = function (label, at, key) {
    return '<div class="dr-row"><span>' + label + '</span><span>' + (at ? '<span class="mono">' + esc(fmtDateTime(at)) + '</span>' : (ro ? 'нет' : '<button type="button" class="crm-chip" data-consent="' + key + '">Отметить: получено</button>')) + '</span></div>';
  };

  dr.innerHTML =
    '<div class="crm-drawer-head"><div style="flex:1;min-width:0">' +
      '<div class="dr-eyebrow"><span class="kb-stage-dot" style="--stage:' + stageColor(st) + '"></span>' + esc(st ? st.title : c.stage_key) +
        (c.stage_key === 'rejected' && c.reject_reason ? ' · ' + esc((reasonBy(c.reject_reason) || {}).title || c.reject_reason) : '') + '</div>' +
      '<div class="dr-title">' + esc(c.full_name || 'Без имени') + '</div>' +
      '<div class="dr-sub">' + (c.phone10 ? '<a class="mono" href="tel:+7' + esc(c.phone10) + '" style="color:inherit;text-decoration:none">' + esc(fmtPhone(c.phone10)) + '</a><span class="cx-dotsep"></span>' : '') +
        '<span>' + esc(sourceLabel(c.source)) + '</span><span class="cx-dotsep"></span><span>на этапе <span class="mono">' + esc(agoText(since(c.stage_changed_at))) + '</span></span>' +
        (over > 0 ? '<span class="cx-dotsep"></span><span style="color:var(--amber)">сверх срока ' + esc(agoText(over * 60000)) + '</span>' : '') + '</div></div>' +
      '<button type="button" class="cx-ibtn" id="hr-x" title="Закрыть (Esc)">' + ico('close') + '</button></div>' +
    '<div class="crm-drawer-body">' +
      '<div class="dr-section"><div class="dr-label">Этап' + (ro ? ' <span class="aux">ведёт другой сотрудник - только просмотр</span>' : '') + '</div>' + stepper + term + backForm + lostForm +
        (na ? '<button type="button" class="dr-calc-cta" id="hr-next" data-to="' + esc(na.key) + '"' + (na.disabled ? ' disabled' : '') + '>' + esc(na.label) + '</button>' +
          (miss.length ? '<div class="hr-hint-amber">Не заполнено на скрининге: ' + esc(miss.join(', ')) + '</div>' : '') : '') +
      '</div>' + ownersSec + callSec +
      '<div class="dr-section"><div class="dr-label">Скрининг <span class="dr-saved aux">сохранено</span></div><div class="dr-grid2 hr-grid">' +
        field('Тип техники', valChips('vehicle_type', c.vehicle_type || '', [['tral', 'Трал'], ['long', 'Длинномер'], ['', 'Не указан']]), true) +
        field('Категория прав', valChips('license_cat', c.license_cat || '', [['CE', 'CE'], ['C', 'C'], ['E', 'E'], ['', 'Не знаем']])) +
        field('Карта водителя СКЗИ', yn('has_skzi', c.has_skzi)) +
        field('Стаж на длинномерах / тралах, лет', inp('experience_years', c.experience_years == null ? '' : String(c.experience_years).replace('.', ','), ' inputmode="decimal" maxlength="5"' + dis, 'mono')) +
        field('Возможная дата выхода', '<input class="dr-input mono" data-f="start_date" type="date" value="' + esc(c.start_date ? String(c.start_date).slice(0, 10) : '') + '"' + dis + '>') +
        field('Ожидаемая зарплата, ₽ в месяц', inp('salary_expect', c.salary_expect ? String(c.salary_expect).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : '', ' inputmode="numeric" maxlength="11"' + dis, 'mono')) +
        field('Действующая медсправка', yn('has_med_cert', c.has_med_cert)) +
        field('Готов к вахте / сменному графику', yn('shift_ready', c.shift_ready)) +
        field('Период работы / отдыха', inp('shift_pattern', c.shift_pattern, ' maxlength="80" placeholder="например 20/10"' + dis)) +
        field('Работа в Москве и МО, выезды', yn('moscow_ok', c.moscow_ok)) +
        field('Готов к тестовой смене', yn('test_shift_ready', c.test_shift_ready)) +
        field('Срочный кандидат', valChips('urgent', c.urgent ? '1' : '0', [['1', 'Да'], ['0', 'Нет']])) +
      '</div></div>' +
      sbSection(c, d) +
      '<div class="dr-section" id="hr-pass-sec"><div class="dr-label">Паспорт для СБ <span class="dr-saved aux">сохранено</span>' +
        (ro ? '' : '<button type="button" class="hr-doc-open hr-link hr-label-act" id="hr-pass-ocr">взять из распознанного паспорта</button>') + '</div>' +
        '<div class="dr-grid2 hr-grid">' +
        field('Дата рождения', '<input class="dr-input mono" data-f="birth_date" type="date" value="' + esc(c.birth_date ? String(c.birth_date).slice(0, 10) : '') + '"' + dis + '>') +
        field('Место рождения', inp('birth_place', c.birth_place, ' maxlength="300"' + dis)) +
        field('Серия и номер паспорта', inp('passport_no', c.passport_no, ' maxlength="40" placeholder="4510 123456"' + dis, 'mono')) +
        field('Дата выдачи', '<input class="dr-input mono" data-f="passport_issue_date" type="date" value="' + esc(c.passport_issue_date ? String(c.passport_issue_date).slice(0, 10) : '') + '"' + dis + '>') +
        field('Кем выдан', inp('passport_issued_by', c.passport_issued_by, ' maxlength="400"' + dis), true) +
        field('Адрес регистрации', inp('reg_address', c.reg_address, ' maxlength="500"' + dis), true) +
      '</div></div>' +
      '<div class="dr-section"><div class="dr-label">Контакт <span class="dr-saved aux">сохранено</span></div><div class="dr-grid2 hr-grid">' +
        field('ФИО', inp('full_name', c.full_name, ' maxlength="200"' + dis)) +
        field('Телефон', inp('phone', c.phone10 ? fmtPhone(c.phone10) : '', ' inputmode="tel" maxlength="16" placeholder="+7-900-000-00-00"' + dis, 'mono')) +
        field('Город проживания', inp('city', c.city, ' maxlength="120"' + dis)) +
        field('Гражданство', inp('citizenship', c.citizenship, ' maxlength="60"' + dis)) +
        field('Email', inp('email', c.email, ' maxlength="200"' + dis)) +
        field('Резюме (ссылка)', inp('resume_url', c.resume_url, ' maxlength="600"' + dis)) +
      '</div></div>' +
      '<div class="dr-section"><div class="dr-label">Опыт и заметки <span class="dr-saved aux">сохранено</span></div><div class="dr-grid2 hr-grid">' +
        field('Опыт', '<textarea class="dr-textarea" data-f="experience_text" maxlength="4000" rows="3"' + dis + '>' + esc(c.experience_text || '') + '</textarea>', true) +
        field('Допуски и сертификаты', inp('permits', c.permits, ' maxlength="1000"' + dis), true) +
        field('Заметки', '<textarea class="dr-textarea" data-f="notes" maxlength="8000" rows="3"' + dis + '>' + esc(c.notes || '') + '</textarea>', true) +
      '</div></div>' +
      '<div class="dr-section"><div class="dr-label">Согласия и источник</div>' +
        consentRow('Обработка персональных данных', c.pd_consent_at, 'pd') +
        consentRow('Хранение в кадровом резерве', c.reserve_consent_at, 'reserve') +
        '<div class="dr-row"><span>Источник</span><span>' + esc(sourceLabel(c.source)) + (c.source_detail ? ' · ' + esc(c.source_detail) : '') + '</span></div>' +
        '<div class="dr-row"><span>Добавлен</span><span class="mono">' + esc(fmtDateTime(c.created_at)) + '</span></div>' + personHtml +
      '</div>' +
      '<div class="dr-section" id="hr-docs-sec"><div class="dr-label">Документы <span class="aux" id="hr-docs-n"></span></div>' +
        '<div id="hr-docs"><div class="dr-empty">Загрузка...</div></div>' +
        '<input type="file" id="hr-doc-file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*" hidden>' +
      '</div>' +
      '<div class="dr-section"><div class="dr-label">История <span class="aux">' + ((d.events || []).length + (d.messages || []).length + (d.calls || []).length) + '</span></div>' +
        '<div class="hr-inline"><input class="dr-input" id="hr-comment" maxlength="2000" placeholder="Комментарий в историю"><button type="button" class="crm-chip" id="hr-comment-add">Добавить</button></div>' +
        '<div id="hr-tl">' + timeline(d) + '</div></div>' +
    '</div>';
  if (ro) $$('[data-chips] .drv-chip', dr).forEach(function (b) { b.disabled = true; });
  blockAutofill(dr);
  wirePhoneMask($('[data-f="phone"]', dr)); wireMoneyMask($('[data-f="salary_expect"]', dr));
  $('#hr-x').addEventListener('click', closeDrawer);
  // Автосохранение (канон шторки сделки CRM: при уходе с поля + метка «сохранено» у секции).
  $$('[data-f]', dr).forEach(function (el) {
    el.addEventListener('change', function () { saveField(c, el.getAttribute('data-f'), el.value, el); });
  });
  wireValChips(dr, function (key, v, g) { if (!ro) saveField(c, key, v, g); });
  $$('[data-consent]', dr).forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-consent'), body = { id: c.id }; body[k === 'pd' ? 'pd_consent' : 'reserve_consent'] = true;
      api('/hiring/candidate', body).then(function (r) { if (!r.ok) { toast(r.data.error || 'Не сохранилось', 'red'); return; } toast('Согласие отмечено', 'green'); openCandidate(c.id, true); });
    });
  });
  function assign(body, btn, okText) {
    if (btn) btn.disabled = true;
    api('/hiring/assign', Object.assign({ id: c.id }, body)).then(function (r) {
      if (btn) btn.disabled = false;
      if (!r.ok) { toast(r.data.error || 'Не сохранилось', 'red'); return; }
      toast(okText, 'green');
      load();
      // Передал в чужую колонну / вернул в пул - карточка может пропасть из моей видимости.
      api('/hiring/candidate', null, { id: c.id }).then(function (r2) { if (!r2.ok) { closeDrawer(); return; } if (S.openId === c.id) renderCandidate(r2.data); });
    });
  }
  loadDocs(c.id);
  var po = $('#hr-pass-ocr'); if (po) po.addEventListener('click', function () { passFromOcr(c, po); });
  var sbRs = $('#hr-sb-resend'); if (sbRs) sbRs.addEventListener('click', function () {
    sbRs.disabled = true;
    api('/hiring/sb_resend', { id: c.id }).then(function (r) { sbRs.disabled = false; if (!r.ok) { toast(r.data.error || 'Не отправилось', 'red'); return; } toast('Отправлено в СБ заново - строка в их таблице обновится в течение 5 минут', 'green'); reload(c.id); });
  });
  var sbRej = $('#hr-sb-reject'); if (sbRej) sbRej.addEventListener('click', function () {
    $('#hr-back-form').hidden = true; $('#hr-lost-form').hidden = false;
    var rb = $('#hr-lost-form [data-reason="sb_fail"]'); if (rb) rb.click();
    $('#hr-lost-form').scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  $$('[data-take]', dr).forEach(function (b) { b.addEventListener('click', function () { assign({ take: true }, b, 'Кандидат закреплён за вами'); }); });
  $$('[data-hr]', dr).forEach(function (b) {
    b.addEventListener('click', function () { var e = b.getAttribute('data-hr'); assign({ recruiter_email: e }, b, e ? 'HR назначен' : 'Кандидат возвращён в общий пул'); });
  });
  $$('[data-handoff]', dr).forEach(function (b) {
    b.addEventListener('click', function () { var v = b.getAttribute('data-handoff'); assign({ segment: v }, b, 'Передан в колонну: ' + VT_COL[v]); });
  });
  $('#hr-comment-add').addEventListener('click', addComment);
  $('#hr-comment').addEventListener('keydown', function (e) { if (e.key === 'Enter') addComment(); });
  function addComment() {
    var t = $('#hr-comment').value.trim(); if (!t) return;
    api('/hiring/comment', { id: c.id, comment: t }).then(function (r) {
      if (!r.ok) { toast(r.data.error || 'Не сохранилось', 'red'); return; }
      $('#hr-comment').value = '';
      // Только лента истории - поля карточки не перерисовываем.
      api('/hiring/candidate', null, { id: c.id }).then(function (r2) { if (r2.ok && S.openId === c.id) $('#hr-tl').innerHTML = timeline(r2.data); });
    });
  }
  if (!c.can_move) return;
  var nb = $('#hr-next'); if (nb) nb.addEventListener('click', function () { move(c, nb.getAttribute('data-to'), {}, nb); });
  $$('.dr-stage[data-stage]', dr).forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.disabled) return;
      var to = b.getAttribute('data-stage'), ts = stageBy(to);
      if (st && !st.is_terminal && ts.sort_order < st.sort_order) {
        $('#hr-lost-form').hidden = true; $('#hr-back-form').hidden = false;
        $('#hr-back-to').textContent = ts.title; $('#hr-back-ok').setAttribute('data-to', to); $('#hr-back-comment').focus();
      } else move(c, to, {}, b);
    });
  });
  var bo = $('#hr-back-ok'); bo.addEventListener('click', function () {
    var cm = $('#hr-back-comment').value.trim();
    if (!cm) { toast('Напишите, почему возвращаете - без комментария кандидат останется на месте', 'amber'); $('#hr-back-comment').focus(); return; }
    move(c, bo.getAttribute('data-to'), { comment: cm }, bo);
  });
  $$('[data-act]', dr).forEach(function (b) {
    b.addEventListener('click', function () {
      var act = b.getAttribute('data-act');
      if (act === 'lost') { $('#hr-back-form').hidden = true; $('#hr-lost-form').hidden = !$('#hr-lost-form').hidden; }
      if (act === 'reserve') {
        if (!c.reserve_consent_at) { toast('В кадровый резерв - только с согласием кандидата. Отметьте его в «Согласиях».', 'amber'); return; }
        move(c, 'reserve', {}, b);
      }
      if (act === 'reopen') move(c, 'screening', { comment: 'Возвращён в работу' }, b);
      if (act === 'attempt') attempt(c, null, b);
    });
  });
  var pickedReason = null;
  $$('#hr-lost-form [data-reason]', dr).forEach(function (b) {
    b.addEventListener('click', function () {
      pickedReason = b.getAttribute('data-reason');
      $$('#hr-lost-form [data-reason]', dr).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      $('#hr-lost-ok').disabled = false;
    });
  });
  $('#hr-lost-ok').addEventListener('click', function () {
    if (!pickedReason) return;
    move(c, 'rejected', { reason: pickedReason, comment: $('#hr-lost-comment').value.trim() }, this);
  });
  var rc = $('#hr-recall');
  if (rc) {
    rc.addEventListener('change', function () { saveField(c, 'recall_at', rc.value ? new Date(rc.value).toISOString() : '', rc); });
    $$('[data-recall]', dr).forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-recall'), t = new Date();
        if (v === 'tomorrow') { t.setDate(t.getDate() + 1); t.setHours(10, 0, 0, 0); } else t = new Date(Date.now() + Number(v) * 60000);
        attempt(c, t.toISOString(), b);
      });
    });
  }
}
function toLocalInput(iso) {
  if (!iso) return '';
  var d = new Date(iso); if (isNaN(d.getTime())) return '';
  var p = function (n) { return ('0' + n).slice(-2); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
/* Сохранение одного поля + метка «сохранено» у секции (канон .dr-saved CRM). */
function saveField(c, key, value, el) {
  var body = { id: c.id };
  if (key === 'phone') {
    if (digits10(value) === String(c.phone10 || '')) return;
    body.phone = value;
  } else if (key === 'salary_expect') body[key] = String(value || '').replace(/\s/g, '');
  else body[key] = value;
  api('/hiring/candidate', body).then(function (r) {
    if (r.status === 409 && r.data.id) { toast('Этот телефон уже у другого кандидата', 'amber', { label: 'Открыть', fn: function () { openCandidate(r.data.id); } }); return; }
    if (!r.ok) { toast(r.data.error || 'Не сохранилось', 'red'); return; }
    if (key === 'phone') c.phone10 = digits10(value); else c[key] = value === '' ? null : value;
    var sec = el && el.closest ? el.closest('.dr-section') : null, mark = sec ? $('.dr-saved', sec) : null;
    if (mark) { mark.classList.add('on'); clearTimeout(mark._t); mark._t = setTimeout(function () { mark.classList.remove('on'); }, 1600); }
    var bc = S.cands.filter(function (x) { return x.id === c.id; })[0];
    if (bc) { if (key === 'phone') bc.phone10 = c.phone10; else if (key in bc) bc[key] = c[key]; renderBoard(); }
    if (['vehicle_type', 'license_cat', 'has_skzi', 'experience_years', 'start_date', 'full_name', 'birth_date', 'birth_place', 'passport_no',
      'passport_issued_by', 'passport_issue_date', 'reg_address'].indexOf(key) >= 0) refreshNext(c);
  });
}
/* После правки полей скрининга - подпись/доступность главной кнопки и подсказка «не заполнено». */
function refreshNext(c) {
  var nb = $('#hr-next'); if (!nb) return;
  var na = nextAction(c); if (!na) return;
  nb.textContent = na.label; nb.setAttribute('data-to', na.key);
  nb.disabled = !!na.disabled;   // к НК можно и без типа техники; после СБ - только с «нет компромата»
  var miss = c.stage_key === 'screening' ? missingForNk(c).concat(sbMissing(c).map(function (x) { return x + ' (для СБ)'; })) : [];
  var h = nb.nextElementSibling && nb.nextElementSibling.classList.contains('hr-hint-amber') ? nb.nextElementSibling : null;
  if (miss.length) { if (!h) { h = document.createElement('div'); h.className = 'hr-hint-amber'; nb.parentNode.insertBefore(h, nb.nextSibling); } h.textContent = 'Не заполнено на скрининге: ' + miss.join(', '); }
  else if (h) h.remove();
}
function attempt(c, recallIso, ctl) {
  if (ctl) ctl.disabled = true;
  api('/hiring/attempt', { id: c.id, recall_at: recallIso }).then(function (r) {
    if (ctl) ctl.disabled = false;
    if (!r.ok) { toast(r.data.error || 'Не получилось', 'red'); return; }
    toast('Не дозвонился: попытка ' + r.data.call_attempts + (r.data.recall_at ? ', перезвонить ' + fmtDateTime(r.data.recall_at) : ''), 'amber');
    reload(c.id);
  });
}
function move(c, to, opts, ctl) {
  var body = { id: c.id, to: to, comment: opts.comment || '' };
  if (opts.reason) body.reason = opts.reason;
  if (to === 'reserve') body.reserve_consent = !!c.reserve_consent_at;
  if (ctl) ctl.disabled = true;
  api('/hiring/move', body).then(function (r) {
    if (ctl) ctl.disabled = false;
    if (!r.ok) { toast(r.data.error || 'Не получилось', 'red'); return; }
    var st = stageBy(to);
    // Отменяемое действие - «Отменить» в тосте (ГОСТ разд.4). Сервер откатывает СВОЙ последний
    // переход в течение 5 минут - даже если этап уже ведёт другой человек.
    toast('Кандидат: ' + (st ? st.title : to), to === 'rejected' ? 'amber' : 'green', {
      label: 'Отменить', fn: function () {
        api('/hiring/undo', { id: c.id }).then(function (r2) {
          if (!r2.ok) { toast(r2.data.error || 'Отменить не получилось', 'red'); return; }
          toast('Отменено', 'green'); reload(c.id);
        });
      }
    });
    reload(c.id);
  });
}

function open() {
  if (!S.inited) { S.inited = true; buildDom(); }
  load();
}
window.HR = { open: open };
})();
