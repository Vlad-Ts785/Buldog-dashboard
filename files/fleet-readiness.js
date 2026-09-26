/* ══════════════════════════════════════════════════════════════════════════════
   «Готовность парка» (25.09.2026) - сколько машин по колоннам выйдет завтра
   (или сегодня), сколько в ремонте и без водителя (вакансии и причины) и сколько
   дней. Для Феськова (руководитель автоколонн), доступ - матрица «Доступ и роли»,
   страница fleet-readiness. План: plans/2026-09-25-fleet-readiness-page.md.
   Всё считает сервер (GET /api/fleet_readiness, api/lib/fleet-readiness.js): статус
   дня - то же правило, что вечерний отчёт собственнику; «На линии» = исправна и с
   водителем. Здесь только рисуем и копируем готовый текст для Телеграма.
   ══════════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';
var ROOT_ID = 'page-fleet-readiness';
var POLL_MS = 120000;            // Планировка живая - обновляемся раз в 2 минуты, пока страница видна
var S = { data: null, loading: false, err: '', view: 'tomorrow', open: 'tral', tg: 'short', timer: null };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function toast(text, type) { try { p2Toast(esc(text), type || 'amber'); } catch (e) {} }

/* SESSION_TOKEN/YARD_API_BASE - let/const в index.html, читаются голыми идентификаторами
   (память project_window_global_let_const_gotcha) - тот же приём, что files/hiring.js. */
function apiBase() { try { return YARD_API_BASE; } catch (e) { return 'https://api.yardhub.ru/api'; } }
function apiToken() { try { return SESSION_TOKEN || ''; } catch (e) { return ''; } }
function api(path) {
  return fetch(apiBase() + path, { headers: { 'X-Session-Token': apiToken() } }).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (d) { return { ok: res.ok, status: res.status, data: d || {} }; });
  });
}

/* ── формат ── */
var WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
function dm(iso) { return iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) : ''; }
function dayLabel(iso) { return WD[new Date(iso + 'T12:00:00Z').getUTCDay()] + ' ' + dm(iso); }
function hm(iso) { return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
function cars(n) { var a = n % 10, b = n % 100; return a === 1 && b !== 11 ? 'машина' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'машины' : 'машин'; }
/* дни в статусе: >7 красным, >3 янтарным (ГОСТ, «Ролевая личная страница») */
function daysCls(n) { return n == null ? '' : n > 7 ? 'red' : n > 3 ? 'amber' : ''; }
/* open_ended - серия упирается в начало истории: «80+ дн.» = не меньше 80, раньше учёта не было */
function daysTxt(r) {
  if (r.open_ended) return r.days + '+ дн.';
  if (!r.days) return S.view === 'today' ? 'с сегодня' : 'с завтра';
  return r.days + ' дн.';
}
function verdictCls(p) { return p == null ? 'hold' : p >= 80 ? 'good' : p >= 60 ? 'warn' : 'bad'; }
/* «выходной 8, отпуск 3» */
function reasonsTxt(x, sep) {
  return (x.off_by_reason || []).map(function (o) { return o.label.toLowerCase() + ' ' + o.n; }).join(sep || ', ');
}
/* Машина в ремонте без закреплённого водителя - это ещё и вакансия (Влад, 25.09, вариант 2):
   она в «В ремонте» И в «Без водителя». Пометка «все в ремонте» / «из них в ремонте N». */
function vacNote(x) {
  if (!x.vacant_in_repair) return '';
  return x.vacant_in_repair === x.vacant ? 'все в ремонте' : 'из них в ремонте ' + x.vacant_in_repair;
}

/* ── таблица по колоннам ── */
function num(v, opt) {
  opt = opt || {};
  return '<td class="num"' + (opt.title ? ' title="' + esc(opt.title) + '"' : '') + '><div class="fr-v' + (v ? '' : ' fr-v--zero') + '">' +
    (v == null ? '—' : v + (opt.unit || '')) + '</div>' + (opt.sub ? '<div class="fr-sub">' + esc(opt.sub) + '</div>' : '') + '</td>';
}
function rowCells(x) {
  return num(x.total) + num(x.on_line) + num(x.repair) +
    num(x.no_driver) + num(x.vacant, { sub: x.vacant_in_repair ? x.vacant_in_repair + ' в ремонте' : '' }) + num(x.off, { title: reasonsTxt(x) }) +
    num(x.need_drivers) + num(x.readiness_pct, { unit: '%' });
}

/* ── разворот: машины в ремонте и без водителя ── */
function repairTable(list) {
  if (!list.length) return '<div class="fr-empty">В ремонте никого нет</div>';
  return '<div class="fr-scroll"><table class="tbl fr-dtbl"><thead><tr><th>Машина</th><th>С</th><th class="num">Стоит</th><th>Выход</th><th>Причина</th></tr></thead><tbody>' +
    list.map(function (r) {
      return '<tr><td class="mono">' + esc(r.gos) + ' <span class="muted">' + esc(r.type) + (r.kind === 'maint' ? ' · ТО' : '') + '</span></td>' +
        '<td class="mono muted">' + dm(r.since) + '</td>' +
        '<td class="num mono ' + daysCls(r.days) + '"' + (r.open_ended ? ' title="в ремонте с ' + dm(r.since) + ' или раньше - раньше учёта нет"' : '') + '>' + esc(daysTxt(r)) + '</td>' +
        '<td class="mono">' + (r.exit ? dm(r.exit) : '<span class="muted">не задан</span>') + '</td>' +
        '<td class="mech-ellip" title="' + esc(r.reason) + '">' + (r.reason ? esc(r.reason) : '<span class="muted">не указана</span>') +
          (r.driver ? '' : ' <span class="muted">· без водителя</span>') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}
function noDriverTable(list) {
  if (!list.length) return '<div class="fr-empty">Все машины с водителями</div>';
  return '<div class="fr-scroll"><table class="tbl fr-dtbl"><thead><tr><th>Машина</th><th>Почему</th><th>С</th><th class="num">Дней</th><th>До</th><th>Водитель</th></tr></thead><tbody>' +
    list.map(function (r) {
      var vac = r.sub === 'vacant';
      return '<tr><td class="mono">' + esc(r.gos) + ' <span class="muted">' + esc(r.type) + '</span></td>' +
        '<td class="fr-nowrap"><span class="mech-pill mech-pill--' + (vac ? 'rep' : 'nd') + '">' + (vac ? 'Вакансия' : esc(r.reason_label)) + '</span>' +
          (r.in_repair ? ' <span class="muted">· в ремонте</span>' : '') + '</td>' +
        '<td class="mono muted">' + dm(r.since) + '</td>' +
        '<td class="num mono ' + (vac ? daysCls(r.days) : '') + '"' + (r.open_ended ? ' title="без водителя с ' + dm(r.since) + ' или раньше - раньше учёта нет"' : '') + '>' + esc(daysTxt(r)) + '</td>' +
        '<td class="mono">' + (vac ? (r.in_repair && r.repair_exit ? '<span class="muted">ремонт до ' + dm(r.repair_exit) + '</span>' : '<span class="muted">—</span>')
          : (r.until ? dm(r.until) : '<span class="muted">не задано</span>')) + '</td>' +
        '<td class="fr-nowrap">' + (vac ? (r.prev_driver ? '<span class="muted">был ' + esc(r.prev_driver) + '</span>' : '<span class="muted">не назначен</span>') : esc(r.driver)) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}
function detailHtml(x) {
  var nd = 'вакансий ' + x.vacant + (vacNote(x) ? ' (' + vacNote(x) + ')' : '') + (x.off ? ' · ' + reasonsTxt(x, ' · ') : '');
  return '<div class="fr-dgrid">' +
    '<section class="fr-dsec"><div class="mech-head"><div class="mech-label">В ремонте</div><span class="mech-badge mech-badge--neutral">' + x.repair + '</span></div>' + repairTable(x.repair_list) + '</section>' +
    '<section class="fr-dsec"><div class="mech-head"><div class="mech-label">Без водителя</div><span class="mech-badge ' + (x.vacant ? 'mech-badge--bad' : 'mech-badge--neutral') + '">' + esc(nd) + '</span></div>' + noDriverTable(x.no_driver_list) + '</section>' +
    '</div>';
}

/* ── телефон: колонна = карточка со строками «метрика · число» (анатомия mech-row),
   без таблицы с прокруткой вбок (мобильный вид - целиком мобильный, не «полудесктоп») ── */
function mRow(label, v, opt) {
  opt = opt || {};
  return '<div class="mech-row' + (opt.total ? ' mech-row--total' : '') + (opt.sub ? ' fr-mc__subrow' : '') + '"><span class="mech-row__label">' + label + '</span><span class="mech-row__leader"></span>' +
    '<span class="mech-row__value' + (opt.cls ? ' ' + opt.cls : '') + '">' + (v == null ? '—' : v + (opt.unit || '')) + '</span><span class="mech-row__aux">' + esc(opt.aux || '') + '</span></div>';
}
function mRows(x, withTotal) {
  var h = '<div class="mech-rows">' + (withTotal ? mRow('Всего', x.total) : '') +
    mRow('На линии', x.on_line) + mRow('В ремонте', x.repair) + mRow('Без водителя', x.no_driver);
  if (x.no_driver) {
    h += mRow('вакансия', x.vacant, { sub: true, aux: x.vacant_in_repair ? x.vacant_in_repair + ' в рем.' : '' });
    (x.off_by_reason || []).forEach(function (o) { h += mRow(esc(o.label.toLowerCase()), o.n, { sub: true }); });
  }
  return h + mRow('Нет водителей, чел.', x.need_drivers) + mRow('Готовность', x.readiness_pct, { unit: '%', total: true }) + '</div>';
}
function mList(x) {
  var rep = x.repair_list.map(function (r) {
    return '<div class="mech-row"><span class="mech-row__label"><span class="fr-mc__gos">' + esc(r.gos) + '</span> ' + esc(r.type) + (r.kind === 'maint' ? ' · ТО' : '') + '</span><span class="mech-row__leader"></span>' +
      '<span class="mech-row__value ' + daysCls(r.days) + '">' + esc(daysTxt(r)) + '</span><span class="mech-row__aux">' + (r.exit ? 'до ' + dm(r.exit) : '') + '</span></div>';
  }).join('');
  var nd = x.no_driver_list.map(function (r) {
    var vac = r.sub === 'vacant';
    return '<div class="mech-row"><span class="mech-row__label"><span class="fr-mc__gos">' + esc(r.gos) + '</span> ' +
      '<span class="mech-pill mech-pill--' + (vac ? 'rep' : 'nd') + '">' + (vac ? (r.in_repair ? 'Вакансия · ремонт' : 'Вакансия') : esc(r.reason_label)) + '</span></span><span class="mech-row__leader"></span>' +
      '<span class="mech-row__value ' + (vac ? daysCls(r.days) : '') + '">' + esc(daysTxt(r)) + '</span><span class="mech-row__aux">' + (!vac && r.until ? 'до ' + dm(r.until) : '') + '</span></div>';
  }).join('');
  return '<div class="fr-mc__sec">В ремонте · ' + x.repair + '</div>' + (rep || '<div class="fr-empty">В ремонте никого нет</div>') +
    '<div class="fr-mc__sec">Без водителя · ' + x.no_driver + '</div>' + (nd || '<div class="fr-empty">Все машины с водителями</div>');
}
function mobileCards(d, v) {
  var out = '';
  d.groups.forEach(function (g) {
    var x = v.groups[g.key];
    if (!x || !x.total) return;
    var open = S.open === g.key;
    out += '<div class="fr-mc"><div class="fr-mc__head"><div><b>' + esc(g.label) + '</b>' + (g.head ? '<small>' + esc(g.head) + '</small>' : '') + '</div>' +
      '<span class="fr-mc__tot"><span class="mono">' + x.total + '</span> ' + cars(x.total) + '</span></div>' +
      mRows(x, false) +
      '<button type="button" class="crm-chip fr-mc__more" data-mg="' + g.key + '" aria-pressed="' + open + '"><span class="fr-chev">▸</span>Машины: в ремонте ' + x.repair + ', без водителя ' + x.no_driver + '</button>' +
      (open ? '<div class="fr-mc__det">' + mList(x) + '</div>' : '') + '</div>';
  });
  out += '<div class="fr-mc"><div class="fr-mc__head"><div><b>Итого</b></div></div>' + mRows(v.total, true) + '</div>';
  return '<div class="fr-mcards">' + out + '</div>';
}

/* ── страница ── */
function render() {
  var root = document.getElementById(ROOT_ID);
  if (!root) return;
  if (!S.data) {
    root.innerHTML = '<div class="card"><div class="mech-empty">' + (S.err ? esc(S.err) : 'Считаю парк…') + '</div></div>';
    return;
  }
  var d = S.data, v = d.views[S.view], t = v.total;
  var onDay = S.view === 'today' ? 'на сегодня' : 'на завтра';
  var chip = function (key, label) {
    return '<button type="button" class="crm-chip" data-view="' + key + '" aria-pressed="' + (S.view === key) + '" data-nav-sound>' + label + '</button>';
  };
  var html = '<div class="fr-bar"><div class="fr-chips" role="radiogroup" aria-label="На какой день">' +
    chip('tomorrow', 'Завтра · ' + dayLabel(d.tomorrow)) + chip('today', 'Сегодня · ' + dayLabel(d.today)) + '</div>' +
    '<div class="fr-stamp">по Планировке · обновлено в <b>' + hm(d.computed_at) + '</b></div></div>';

  // Вердикт: сколько машин выйдет (исправны и с водителем)
  var rs = reasonsTxt(t);
  html += '<div class="mp-status mp-status--' + verdictCls(t.readiness_pct) + '">' +
    '<div class="mp-status__l"><div class="mp-status__word">НА ЛИНИИ ' + t.on_line + ' ИЗ ' + t.total + '</div>' +
    // «не в работе» - то же число, что «Всего не в работе» в отчёте собственнику (один расчёт на сервере)
    '<div class="mp-status__sub">не в работе <b>' + (t.not_in_work != null ? t.not_in_work : t.total - t.on_line) + '</b> · в ремонте <b>' + t.repair + '</b> · без водителя <b>' + t.no_driver + '</b>' +
      (t.no_driver ? ': вакансий <b>' + t.vacant + '</b>' + (vacNote(t) ? ' (' + vacNote(t) + ')' : '') + (rs ? ', ' + esc(rs) : '') : '') + '</div></div>' +
    '<div class="mp-status__r"><div class="mp-status__cap">Готовность ' + onDay + '</div>' +
    '<div class="mp-status__lever">' + (t.readiness_pct == null ? '—' : t.readiness_pct + '%') + '</div>' +
    '<div class="mech-formula">' + t.on_line + ' на линии / ' + t.total + ' всего</div></div></div>';

  // Таблица по колоннам
  var body = '';
  d.groups.forEach(function (g) {
    var x = v.groups[g.key];
    if (!x || !x.total) return;
    var open = S.open === g.key;
    body += '<tr class="clickable fr-row" data-g="' + g.key + '" aria-expanded="' + open + '">' +
      '<td><div class="fr-name"><span class="fr-chev">▸</span><b>' + esc(g.label) + '</b></div>' +
        (g.head ? '<div class="fr-name"><small>' + esc(g.head) + '</small></div>' : '') + '</td>' +
      rowCells(x) + '</tr>' +
      '<tr class="fr-detail-row' + (open ? ' open' : '') + '" data-for="' + g.key + '"><td colspan="9"><div class="fr-detail-inner">' +
        (open ? detailHtml(x) : '') + '</div></td></tr>';
  });
  html += '<div class="card fr-card"><div class="mech-head"><div class="mech-label">По колоннам</div>' +
    '<span class="mech-badge mech-badge--neutral">' + onDay + ', ' + dayLabel(v.date) + '</span></div>' +
    '<div class="fr-scroll fr-desk"><table class="tbl fr-tbl"><thead>' +
      '<tr><th rowspan="2">Колонна</th><th rowspan="2" class="num">Всего</th><th rowspan="2" class="num">На линии</th><th rowspan="2" class="num">В ремонте</th>' +
      '<th colspan="3" class="fr-grp">Без водителя</th>' +
      '<th rowspan="2" class="num">Нет водителей, чел.</th><th rowspan="2" class="num">Готовность</th></tr>' +
      '<tr><th class="num">машин</th><th class="num">вакансий</th><th class="num">другие причины</th></tr>' +
    '</thead><tbody>' + body + '</tbody>' +
    '<tfoot><tr><td><div class="fr-name"><span class="fr-chev"></span><b>Итого</b></div></td>' + rowCells(t) + '</tr></tfoot></table></div>' +
    mobileCards(d, v);
  if (t.vacant) {
    html += '<div class="fr-note">Вакансий <b>' + t.vacant + '</b> - столько водителей нужно найти' +
      (t.vacant_in_repair ? ' (на <b>' + t.vacant_in_repair + '</b> ' + cars(t.vacant_in_repair) + ' в ремонте водителя тоже нет - после ремонта им нужен водитель)' : '') + '.' +
      (t.off ? ' Остальные <b>' + t.off + '</b> без водителя (' + esc(rs) + ') - водители есть, вернутся.' : '') + '</div>';
  }
  html += '<div class="mech-foot">Цифры - ' + onDay + ' по Планировке. На линии - машина исправна и с водителем. ' +
    'Без водителя - все машины, на которых нет водителя: вакансия (водитель не закреплён, в том числе у машин в ремонте) или в Планировке стоит выходной, отпуск и т.п. ' +
    'Машина в ремонте без водителя считается и в «В ремонте», и в «Без водителя» - поэтому на линии + в ремонте + без водителя может быть больше «Всего» ровно на число таких машин. ' +
    '«Другие причины» - всё, кроме вакансии (наведите на число - какие). ' +
    'Дни в списке машин - сколько полных дней подряд машина в этом статусе, «80+» - не меньше, раньше учёта нет. ' +
    'Готовность - доля машин на линии. Нажмите на колонну - откроется список машин.</div></div>';

  // Отчёт в Телеграм
  var tg = d.telegram[S.view][S.tg];
  var tgChip = function (key, label) {
    return '<button type="button" class="crm-chip" data-tg="' + key + '" aria-pressed="' + (S.tg === key) + '" data-nav-sound>' + label + '</button>';
  };
  html += '<div class="card fr-card fr-tg"><div class="mech-head"><div class="mech-label">Отчёт для Телеграма</div>' +
    '<div class="fr-chips" role="radiogroup" aria-label="Вид отчёта">' + tgChip('short', 'Госномера') + tgChip('detailed', 'Госномера и дни') + '</div></div>' +
    // Окно показывает сообщение так же, как его присылает бот (Влад, 26.09: «идентично в своей красоте»):
    // та же разметка rich_html, что уходит в sendRichMessage - заголовок, колонны, строки мелким шрифтом.
    '<div class="fr-tg__grid"><div class="fr-tg__msg fr-tg__msg--rich">' + (tg.rich_html || tg.html) + '</div>' +
    '<div class="fr-tg__side"><button type="button" class="mech-btn mech-btn--primary fr-copy">Скопировать для Телеграма</button>' +
    '<div class="mech-foot">Оформление - как у вечернего отчёта от бота: заголовок, колонны подзаголовками, строки мелким шрифтом. ' +
      'Порядок строк: Всего, На линии, В ремонте, Без водителя, под ним - вакансии и каждая причина отдельно. ' +
      'Госномера - только у машин не в работе: три цифры, буквы - если такие цифры в парке не у одной машины; каждый номер один раз, в «Итого» - только цифры. ' +
      'Сохранит ли Телеграм оформление при вставке, зависит от его приложения - если нет, придёт обычным текстом с теми же строками.</div></div></div></div>';

  root.innerHTML = html;
}

function toggleRow(key) {
  S.open = S.open === key ? null : key;
  var root = document.getElementById(ROOT_ID);
  root.querySelectorAll('.fr-row').forEach(function (tr) {
    var on = tr.getAttribute('data-g') === S.open;
    tr.setAttribute('aria-expanded', String(on));
    var det = root.querySelector('.fr-detail-row[data-for="' + tr.getAttribute('data-g') + '"]');
    if (!det) return;
    det.classList.toggle('open', on);
    var inner = det.querySelector('.fr-detail-inner');
    // лениво: содержимое разворота рисуется при первом открытии (канон «Разворот строки»)
    if (on && !inner.childNodes.length) inner.innerHTML = detailHtml(S.data.views[S.view].groups[S.open]);
  });
}

function copyTelegram() {
  var tg = S.data.telegram[S.view][S.tg];
  var ok = function () { toast('Скопировано - вставьте в чат Телеграма', 'green'); };
  var fail = function () { toast('Не удалось скопировать - выделите текст отчёта и скопируйте вручную', 'red'); };
  var legacy = function () {
    var ta = document.createElement('textarea');
    ta.value = tg.text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var done = false;
    try { done = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    if (done) ok(); else fail();
  };
  var plain = function () {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tg.text).then(ok, legacy);
    else legacy();
  };
  // Два формата сразу: text/html - та же разметка, что у сообщения бота (rich_html: h1 / h6 / footer),
  // и text/plain - вставляющее приложение берёт, что умеет.
  if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
    try {
      navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([tg.rich_html || tg.html], { type: 'text/html' }),
        'text/plain': new Blob([tg.text], { type: 'text/plain' })
      })]).then(ok, plain);
      return;
    } catch (e) { /* ниже - обычный текст */ }
  }
  plain();
}

function bind() {
  var root = document.getElementById(ROOT_ID);
  if (!root || root.dataset.frBound) return;
  root.dataset.frBound = '1';
  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-view]');
    if (b) { S.view = b.getAttribute('data-view'); render(); return; }
    b = e.target.closest('[data-tg]');
    if (b) { S.tg = b.getAttribute('data-tg'); render(); return; }
    if (e.target.closest('.fr-copy')) { copyTelegram(); return; }
    b = e.target.closest('[data-mg]');
    if (b) { var k = b.getAttribute('data-mg'); S.open = S.open === k ? null : k; render(); return; }
    var tr = e.target.closest('.fr-row');
    if (tr) toggleRow(tr.getAttribute('data-g'));
  });
}

function load() {
  if (S.loading) return;
  S.loading = true;
  api('/fleet_readiness').then(function (r) {
    S.loading = false;
    if (!r.ok || !r.data || !r.data.views) {
      S.err = (r.data && r.data.error) || 'Сервер не ответил - обновите страницу через минуту';
      if (!S.data) render(); else toast(S.err, 'red');
      return;
    }
    S.err = ''; S.data = r.data;
    render();
  }).catch(function (e) {
    S.loading = false; S.err = 'Нет связи с сервером: ' + e.message;
    if (!S.data) render();
  });
}

function open() {
  bind();
  render();
  load();
  if (!S.timer) {
    S.timer = setInterval(function () {
      var pg = document.getElementById(ROOT_ID);
      if (!pg || !pg.classList.contains('active') || document.hidden) return;
      load();
    }, POLL_MS);
  }
}
window.FR = { open: open };
})();
