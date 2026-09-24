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
function recallDue(c) { return !!c.recall_at && new Date(c.recall_at).getTime() <= Date.now(); }
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
      '<div class="kb-hint">Кандидата двигает хозяин этапа - в карточке (открывается по клику). Назад - только с комментарием, отказ - только с причиной. Жёлтая точка - кандидат висит дольше срока этапа, красная - больше суток сверх срока.</div>' +
      '<div class="kb-panel"><div class="kb-board" id="hr-board"></div></div>' +
    '</div>' +
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
  var loss = lost && c.reject_reason ? '<div class="kb-card-loss">' + esc((reasonBy(c.reject_reason) || {}).title || c.reject_reason) + '</div>' : '';
  return '<div class="kb-card' + fresh + (won ? ' kb-won-style' : '') + (lost ? ' kb-lost-style' : '') + (S.openId === c.id ? ' is-open' : '') + '" data-id="' + c.id + '">' +
    '<div class="kb-card-top"><span class="kb-client">' + esc(c.full_name || 'Без имени') + '</span>' + mark + '</div>' +
    '<div class="kb-cargo">' + esc(line) + '</div>' + loss +
    '<div class="kb-meta"><span class="kb-num">' + esc(fmtPhone(c.phone10)) + '</span><span class="kb-chan">' + esc(sourceLabel(c.source)) + '</span></div>' +
    '<div class="kb-card-bot"><span class="kb-num" title="Сколько кандидат на этом этапе">' + esc(agoText(since(c.stage_changed_at))) + '</span>' +
      (tags.length ? '<span class="hr-tags">' + tags.join('') + '</span>' : '') + '</div>' +
  '</div>';
}
function slaText(min) {
  if (min == null) return '';
  if (min < 60) return min + ' мин';
  return min % 1440 === 0 ? (min / 1440) + ' дн' : Math.round(min / 60) + ' ч';
}
function renderBoard() {
  if (!S.meta) return;
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
      '<div class="kb-list">' + (cards || '<div class="kb-empty">Пусто</div>') +
        (rest > 0 ? '<button type="button" class="hr-more" data-more="' + esc(st.stage_key) + '">Показать ещё ' + Math.min(rest, PAGE_STEP) + ' из ' + rest + '</button>' : '') +
      '</div></div>';
  }).join('');
  board.scrollLeft = keepX;
  $$('.kb-col', board).forEach(function (c) { var l = $('.kb-list', c), t = tops[c.getAttribute('data-st')]; if (l && t) l.scrollTop = t; });
}

/* ───────── шторка: каркас ───────── */
function openDrawer() {
  $('#hr-bk').classList.add('show'); $('#hr-drawer').classList.add('show'); $('#hr-drawer').setAttribute('aria-hidden', 'false');
}
function closeDrawer() {
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
function openCandidate(id, keepScroll) {
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
  });
}
var EV_TEXT = { create: 'Карточка создана', move: 'Этап', comment: 'Комментарий', edit: 'Правка карточки', import: 'Импорт из базы обзвона', attempt: 'Звонок', undo: 'Отмена перехода', avito: 'Отклик на Авито' };
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
  if (nextKey === 'column_interview') {
    var heads = (S.meta && S.meta.column_heads) || {};
    label = c.vehicle_type ? 'Передать НК' + (heads[c.vehicle_type] ? ': ' + heads[c.vehicle_type] : '') + ' (' + VT_COL[c.vehicle_type] + ')' : 'Передать НК - сначала укажите тип техники';
  }
  if (nextKey === 'security') label = 'Собеседование пройдено: в СБ';
  if (nextKey === 'onboarding') label = 'СБ пройдена: тестовая смена';
  if (nextKey === 'hired') label = 'Вышел на работу';
  return { key: nextKey, label: label };
}
/* Что не заполнено к передаче НК - мягкое предупреждение (жёстко сервер требует только тип техники). */
function missingForNk(c) {
  var m = [];
  if (!c.vehicle_type) m.push('тип техники');
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
  var miss = na && na.key === 'column_interview' ? missingForNk(c) : [];
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
        (na ? '<button type="button" class="dr-calc-cta" id="hr-next" data-to="' + esc(na.key) + '"' + (na.key === 'column_interview' && !c.vehicle_type ? ' disabled' : '') + '>' + esc(na.label) + '</button>' +
          (miss.length ? '<div class="hr-hint-amber">Не заполнено к передаче НК: ' + esc(miss.join(', ')) + '</div>' : '') : '') +
      '</div>' + callSec +
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
    if (['vehicle_type', 'license_cat', 'has_skzi', 'experience_years', 'start_date'].indexOf(key) >= 0) refreshNext(c);
  });
}
/* После правки полей скрининга - подпись/доступность главной кнопки и подсказка «не заполнено». */
function refreshNext(c) {
  var nb = $('#hr-next'); if (!nb) return;
  var na = nextAction(c); if (!na) return;
  nb.textContent = na.label; nb.setAttribute('data-to', na.key);
  nb.disabled = na.key === 'column_interview' && !c.vehicle_type;
  var miss = na.key === 'column_interview' ? missingForNk(c) : [];
  var h = nb.nextElementSibling && nb.nextElementSibling.classList.contains('hr-hint-amber') ? nb.nextElementSibling : null;
  if (miss.length) { if (!h) { h = document.createElement('div'); h.className = 'hr-hint-amber'; nb.parentNode.insertBefore(h, nb.nextSibling); } h.textContent = 'Не заполнено к передаче НК: ' + miss.join(', '); }
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
