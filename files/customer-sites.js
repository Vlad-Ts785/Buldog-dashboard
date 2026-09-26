// Площадки заказчика в карточке контрагента Справочников (26.09.2026, фаза Б-3 плана
// plans/2026-09-26-customer-addresses-and-price-geo.md; вид - одобренное превью examples/preview-customer-sites.html).
// Место погрузки/выгрузки хранится один раз у заказчика: точка, контакт на месте, пометка водителю.
// Сервер - api/lib/customer-sites.js: GET /api/sites, POST /api/sites/save|archive, GET /api/sites/history
// (правка - только admin; менеджер ставит точку площадке без точки из формы заявки, order-plan-v2.js).
// Отдельный файл, не в index.html (дорожная карта: новый код - в свои файлы). Карточка зовёт
// custSitesLoad_(entityId, entityName) из legalOpenForm_; entityId = null - секция скрыта.
// Данные уходят телом запроса (postToYardApiWithBody_), не строкой адреса: в них телефоны на месте.
(function () {
  'use strict';
  var st = { entityId: null, entityName: '', sites: [], edit: null, busy: false, journal: {} };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dm(d) { return d ? d.slice(8, 10) + '.' + d.slice(5, 7) : ''; }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  function hasPt(s) { return s.lat != null && s.lon != null; }
  function ptText(s) { return hasPt(s) ? s.lat + ', ' + s.lon : ''; }
  function contactText(s) { return [s.contact_name, s.contact_phone].filter(Boolean).join(' · '); }
  function mapUrl(s) { return 'https://yandex.ru/maps/?pt=' + s.lon + ',' + s.lat + '&z=16'; }
  // ошибка - в открытой форме (рядом с кнопкой), иначе - под списком
  function showErr(t) {
    ['csite-ferr', 'csite-error'].forEach(function (id) { var x = $(id); if (x) { x.textContent = ''; x.style.display = 'none'; } });
    var e = $('csite-ferr') || $('csite-error'); if (!e || !t) return;
    e.textContent = t; e.style.display = '';
  }

  function load(entityId, entityName) {
    var sec = $('csite-section');
    if (!sec) return;
    st.entityId = entityId || null; st.entityName = entityName || ''; st.sites = []; st.edit = null; st.journal = {}; showErr('');
    // D объявлена в index.html через let - её нет в window, только голым именем (ловушка window.D)
    var isAdmin = typeof D !== 'undefined' && D && D.role === 'admin';
    if (!entityId || !isAdmin) { sec.style.display = 'none'; return; }
    sec.style.display = '';
    $('csite-list').innerHTML = '<div class="csite-hint">Загрузка…</div>';
    $('csite-count').textContent = '';
    fetchFromYardApi_('/sites', { entity: entityId, archived: '1' }).then(function (r) {
      if (st.entityId !== entityId) return; // карточку уже закрыли/открыли другую
      if (!r.ok) { $('csite-list').innerHTML = ''; showErr('Не загрузилось: ' + (r.data && r.data.error || 'ошибка сервера')); return; }
      st.sites = r.data.sites || []; render();
    }).catch(function () { if (st.entityId === entityId) showErr('Сервер не ответил'); });
  }

  function sideChip(s) {
    if (s.load_count && s.unload_count) return '<span class="csite-chip side">погрузка и выгрузка</span>';
    if (s.load_count) return '<span class="csite-chip side">погрузка</span>';
    if (s.unload_count) return '<span class="csite-chip side">выгрузка</span>';
    return '';
  }
  function metaText(s) {
    var parts = [];
    if (s.uses) parts.push(s.uses + ' ' + plural(s.uses, 'заявка', 'заявки', 'заявок'));
    if (s.first_used && s.last_used) parts.push(s.first_used === s.last_used ? dm(s.first_used) : dm(s.first_used) + ' - ' + dm(s.last_used));
    parts.push(hasPt(s) ? ptText(s) : (s.uses ? 'ни в одной нет точки' : 'точки нет'));
    return parts.join(' · ');
  }

  function rowHtml(s) {
    var chips = sideChip(s) + (hasPt(s) ? '<span class="csite-chip ok">точка есть</span>' : '<span class="csite-chip warn">нет точки</span>') +
      (s.needs_check ? '<span class="csite-chip warn" title="' + esc(s.check_note || '') + '">проверить точку</span>' : '') +
      (s.archived ? '<span class="csite-chip side">в архиве</span>' : '');
    var btn = s.archived
      ? '<button type="button" class="csite-btn" data-act="restore" data-id="' + s.id + '">Вернуть из архива</button>'
      : '<button type="button" class="csite-btn" data-act="edit" data-id="' + s.id + '">' + (hasPt(s) ? 'Изменить' : 'Поставить точку') + '</button>';
    return '<div class="csite-row' + (s.archived ? ' off' : '') + '"><div class="csite-body">' +
      '<div class="csite-name">' + esc(s.name || s.address) + ' ' + chips + '</div>' +
      '<div class="csite-addr">' + esc(s.address) + '</div>' +
      '<div class="csite-meta">' + esc(metaText(s)) + '</div></div>' + (st.edit === s.id ? '' : btn) + '</div>' +
      (st.edit === s.id ? editHtml(s) : '');
  }

  function editHtml(s) {
    var isNew = !s.id;
    var journal = st.journal[s.id];
    return '<div class="csite-edit" data-id="' + (s.id || '') + '">' +
      (s.needs_check && s.check_note ? '<div class="csite-check">Проверить точку: ' + esc(s.check_note) + '</div>' : '') +
      '<div class="csite-grid">' +
        '<div><label for="csite-f-name">Название</label><input autocomplete="off" id="csite-f-name" maxlength="120" value="' + esc(s.name || '') + '" placeholder="коротко: «Горки», «ЮВХ-6»"></div>' +
        '<div><label for="csite-f-pt">Точка (широта, долгота)</label><input autocomplete="off" id="csite-f-pt" class="mono" value="' + esc(ptText(s)) + '" placeholder="ссылка Яндекс.Карт или 55.75, 37.62"></div>' +
        '<div class="full"><label for="csite-f-addr">Адрес - как пишут менеджеры</label><input autocomplete="off" id="csite-f-addr" maxlength="500" value="' + esc(s.address || '') + '"></div>' +
        '<div><label for="csite-f-contact">Контакт на месте</label><input autocomplete="off" id="csite-f-contact" value="' + esc(contactText(s)) + '" placeholder="Имя · телефон"></div>' +
        '<div><label for="csite-f-note">Пометка для водителя</label><input autocomplete="off" id="csite-f-note" maxlength="300" value="' + esc(s.driver_note || '') + '" placeholder="например: въезд с северной стороны"></div>' +
      '</div>' +
      '<div class="csite-acts">' +
        '<button type="button" class="csite-btn primary" data-act="save"' + (st.busy ? ' disabled' : '') + '>Сохранить</button>' +
        '<button type="button" class="csite-btn" data-act="cancel">Отмена</button>' +
        (s.needs_check && hasPt(s) ? '<button type="button" class="csite-btn" data-act="ptok"' + (st.busy ? ' disabled' : '') + '>Точка верна</button>' : '') +
        (hasPt(s) ? '<a class="csite-link" href="' + esc(mapUrl(s)) + '" target="_blank" rel="noopener">Открыть точку на карте ↗</a>' : '') +
        (isNew ? '' : '<span class="csite-grow"></span><button type="button" class="csite-btn" data-act="journal">Журнал</button>' +
          '<button type="button" class="csite-btn danger" data-act="archive"' + (st.busy ? ' disabled' : '') + '>В архив</button>') +
      '</div>' +
      '<div class="csite-err" id="csite-ferr"></div>' +
      '<div class="csite-hint">Точку ставит только человек - ссылкой Яндекс.Карт или координатами, поиск по адресу её не ставит. ' +
        'Правка действует на новые заявки, старые не меняются. Кто и когда правил - в журнале площадки.</div>' +
      (journal ? '<div class="csite-journal">' + journal + '</div>' : '') +
    '</div>';
  }

  function render() {
    var live = st.sites.filter(function (s) { return !s.archived; });
    var arch = st.sites.filter(function (s) { return s.archived; });
    $('csite-count').textContent = live.length ? String(live.length) : '';
    var html = '';
    if (!live.length && st.edit !== 'new') html += '<div class="csite-hint">Площадок пока нет. Постоянное место погрузки или выгрузки этого заказчика можно добавить здесь.</div>';
    live.forEach(function (s) { html += rowHtml(s); });
    if (st.edit === 'new') html += editHtml({ id: 0, name: '', address: '', lat: null, lon: null });
    else html += '<button type="button" class="csite-btn csite-add" data-act="new">+ Добавить площадку</button>';
    if (arch.length) html += '<div class="csite-sub">Архив</div>' + arch.map(rowHtml).join('');
    $('csite-list').innerHTML = html;
  }

  function val(id) { var e = $(id); return e ? e.value.trim() : ''; }
  function findSite(id) { return st.sites.filter(function (s) { return s.id === id; })[0] || null; }
  function replaceSite(site) {
    var i = -1; st.sites.forEach(function (s, k) { if (s.id === site.id) i = k; });
    if (i >= 0) st.sites[i] = site; else st.sites.push(site);
  }

  // Пока идёт запрос - только выключаем кнопки, форму не перерисовываем: при ошибке всё, что человек
  // ввёл, остаётся в полях (перерисовка вернула бы старые значения площадки).
  function setBusy(on) {
    st.busy = on;
    Array.prototype.forEach.call(document.querySelectorAll('#csite-list button[data-act]'), function (b) { b.disabled = on; });
  }
  function post(path, body, okText) {
    setBusy(true); showErr('');
    return postToYardApiWithBody_(path, body).then(function (r) {
      if (!r.ok || !r.data || r.data.error) { setBusy(false); showErr('Не сохранилось: ' + (r.data && r.data.error || 'ошибка сервера')); return null; }
      st.busy = false;
      replaceSite(r.data.site); st.edit = null; delete st.journal[r.data.site.id]; render();
      if (window.p2Toast && okText) p2Toast(okText, 'green');
      return r.data.site;
    }).catch(function () { setBusy(false); showErr('Сервер не ответил'); return null; });
  }

  function save() {
    var id = st.edit === 'new' ? 0 : st.edit;
    var s = id ? findSite(id) : { lat: null, lon: null };
    var body = { name: val('csite-f-name'), address: val('csite-f-addr'), driver_note: val('csite-f-note') };
    if (!body.address) { showErr('Адрес площадки обязателен'); return; }
    // точку и контакт шлём, только если их правили: «сохранить» с нетронутой точкой - не проверка точки
    var pt = val('csite-f-pt'), ct = val('csite-f-contact');
    if (pt !== ptText(s)) body.point_text = pt;
    if (!id || ct !== contactText(s)) body.contact = ct;
    if (id) body.id = id; else { body.customer_entity_id = st.entityId; body.customer_name = st.entityName; }
    post('/sites/save', body, id ? 'Площадка сохранена' : 'Площадка добавлена');
  }

  var HIST_LABEL_ = { name: 'название', address: 'адрес', contact_name: 'контакт', contact_phone: 'телефон',
    driver_note: 'пометка водителю', needs_check: 'проверить точку', customer_entity_id: 'юрлицо', customer_name: 'заказчик' };
  var HIST_ACTION_ = { create: 'создана', update: 'изменена', set_point: 'точка', archive: 'в архив', restore: 'из архива' };
  function histLine(h) {
    var at = h.at ? new Date(h.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    var c = (h.detail && typeof h.detail === 'object') ? h.detail : {}, parts = [];
    if (c.lat || c.lon) {
      var was = c.lat && c.lon ? (c.lat[0] ? c.lat[0] + ', ' + c.lon[0] : 'нет') : '', now = c.lat && c.lon ? (c.lat[1] ? c.lat[1] + ', ' + c.lon[1] : 'нет') : '';
      parts.push(was || now ? 'точка ' + was + ' → ' + now : 'точка изменена');
    }
    Object.keys(c).forEach(function (k) {
      if (k === 'lat' || k === 'lon') return;
      if (k === 'needs_check') { if (c[k][1] === '0') parts.push('точка проверена'); else parts.push('нужно проверить точку'); return; }
      if (k === 'text') { parts.push('новое написание адреса «' + c[k][1] + '»'); return; }
      parts.push((HIST_LABEL_[k] || k) + ' ' + (c[k][0] || 'пусто') + ' → ' + (c[k][1] || 'пусто'));
    });
    // у «точки» действие и так видно из текста («точка нет → 55.70, 37.60») - без повтора слова
    var what = h.action === 'set_point' && parts.length ? parts.join('; ')
      : (HIST_ACTION_[h.action] || h.action) + (parts.length ? ': ' + parts.join('; ') : '');
    return '<div class="csite-jrow"><span class="csite-jat">' + esc(at) + '</span><span class="csite-jwho">' + esc(h.by || '') + '</span>' +
      '<span class="csite-jwhat">' + esc(what) + '</span></div>';
  }
  function journal(id) {
    if (st.journal[id]) { delete st.journal[id]; render(); return; }
    st.journal[id] = '<div class="csite-hint">Загрузка…</div>'; render();
    fetchFromYardApi_('/sites/history', { id: id }).then(function (r) {
      if (st.edit !== id) return;
      var list = (r.ok && r.data && r.data.history) || [];
      st.journal[id] = list.length ? list.map(histLine).join('') : '<div class="csite-hint">Правок ещё не было - площадка из первого наполнения по заявкам.</div>';
      render();
    }).catch(function () { st.journal[id] = '<div class="csite-hint">Сервер не ответил</div>'; render(); });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#csite-list [data-act]');
    if (!b || st.busy) return;
    var act = b.getAttribute('data-act'), id = Number(b.getAttribute('data-id')) || null;
    if (act === 'edit') { st.edit = id; showErr(''); render(); var i = $(hasPt(findSite(id) || {}) ? 'csite-f-name' : 'csite-f-pt'); if (i) i.focus(); }
    else if (act === 'new') { st.edit = 'new'; showErr(''); render(); var a = $('csite-f-addr'); if (a) a.focus(); }
    else if (act === 'cancel') { st.edit = null; showErr(''); render(); }
    else if (act === 'save') save();
    else if (act === 'ptok') { var s = findSite(st.edit); if (s) post('/sites/save', { id: s.id, point_text: ptText(s) }, 'Точка отмечена как проверенная'); }
    else if (act === 'journal') journal(st.edit);
    else if (act === 'archive') {
      var sa = findSite(st.edit); if (!sa) return;
      window.yardConfirm_('Убрать площадку <b>' + esc(sa.name || sa.address) + '</b> в архив? Её не будет в подсказках новых заявок. ' +
        'Заявки, где она уже выбрана, не меняются; вернуть можно в любой момент.',
        function (ok) { if (ok) post('/sites/archive', { id: sa.id, archived: 1 }, 'Площадка в архиве'); }, 'Площадка', 'В архив');
    }
    else if (act === 'restore') post('/sites/archive', { id: id, archived: 0 }, 'Площадка возвращена');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target.closest || !e.target.closest('#csite-list .csite-edit')) return;
    e.preventDefault(); if (!st.busy) save();
  });

  window.custSitesLoad_ = load;
})();
