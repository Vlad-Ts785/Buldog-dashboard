// Признаки сотрудника в карточке Справочников (этап 2.1в, plans/2026-09-24-stage2-directories-not-hardcode.md).
// Отдел тралов (продажи / снабжение / «только через снабжение»), план продаж - с датами «с/по», из
// sprav_person_attrs (сервер: GET /api/sprav/person_attrs, POST /api/sprav/person_attrs/set). Отдельный
// файл, не в index.html (дорожная карта: новый код - в свои файлы). Карточка зовёт sprPersonAttrsLoad_(id)
// из drvRegOpenForm_; id = null - секция скрыта (новая, ещё не сохранённая карточка).
// Подтверждение правки признака, влияющего на зарплату, - общий yardConfirm_ (files/yard-confirm.js).
(function () {
  'use strict';
  var st = { personId: null, data: null, edit: null, busy: false };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ru(d) { return d ? d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4) : ''; }

  // ── секция «Признаки» ────────────────────────────────────────────────────────────────
  function showErr(t) { var e = $('spa-error'); if (!e) return; e.textContent = t || ''; e.style.display = t ? '' : 'none'; }

  function load(personId) {
    var sec = $('spa-section');
    if (!sec) return;
    st.personId = personId || null; st.data = null; st.edit = null; showErr('');
    if (!personId) { sec.style.display = 'none'; return; }
    sec.style.display = '';
    $('spa-list').innerHTML = '<div class="spa-hint">Загрузка…</div>';
    fetchFromYardApi_('/sprav/person_attrs', { person_id: personId }).then(function (r) {
      if (st.personId !== personId) return; // карточку уже закрыли/открыли другую
      if (!r.ok) { $('spa-list').innerHTML = ''; showErr('Не загрузилось: ' + (r.data && r.data.error || 'ошибка сервера')); return; }
      st.data = r.data; render();
    }).catch(function () { if (st.personId === personId) showErr('Сервер не ответил'); });
  }

  function periods(attr) {
    return (st.data.rows || []).filter(function (r) { return r.attr === attr; });
  }
  function stateText(list) {
    var open = list.filter(function (r) { return !r.valid_to; })[0];
    if (open) return { on: true, text: open.valid_from === st.data.always ? 'всегда' : 'с ' + ru(open.valid_from) };
    var last = list.slice().sort(function (a, b) { return a.valid_to < b.valid_to ? 1 : -1; })[0];
    return { on: false, text: last ? 'был по ' + ru(last.valid_to) : 'нет' };
  }
  function histText(list) {
    if (list.length < 2 && !(list[0] && list[0].valid_to)) return '';
    return list.map(function (r) {
      return (r.valid_from === st.data.always ? 'всегда' : ru(r.valid_from)) + ' - ' + (r.valid_to ? ru(r.valid_to) : 'сейчас');
    }).join(' · ');
  }

  function render() {
    var d = st.data;
    if (!d) return;
    var html = '';
    (d.catalog || []).forEach(function (c) {
      var list = periods(c.key), s = stateText(list), hist = histText(list);
      html += '<div class="spa-row"><div class="spa-main"><div class="spa-label">' + esc(c.label) +
        (c.payroll ? '<span class="spa-pay" title="Влияет на выручку отдела и зарплату">зарплата</span>' : '') + '</div>' +
        '<div class="spa-desc">' + esc(c.hint) + '</div>' +
        (hist ? '<div class="spa-hist">' + esc(hist) + '</div>' : '') + '</div><div class="spa-side">' +
        '<div class="spa-state' + (s.on ? ' on' : '') + '">' + esc(s.text) + '</div>';
      if (st.edit === c.key) {
        html += '<div class="spa-edit"><span class="spa-edit-lbl">' + (s.on ? 'последний день' : 'с') + '</span>' +
          '<input type="date" autocomplete="off" id="spa-date" value="' + esc(d.today) + '">' +
          '<button type="button" class="spa-btn" data-act="save" data-attr="' + esc(c.key) + '" data-mode="' + (s.on ? 'stop' : 'start') + '">Сохранить</button>' +
          '<button type="button" class="spa-btn" data-act="cancel">Отмена</button></div>';
      } else {
        html += '<button type="button" class="spa-btn" data-act="edit" data-attr="' + esc(c.key) + '"' + (st.busy ? ' disabled' : '') + '>' +
          (s.on ? 'Завершить датой' : 'Включить с даты') + '</button>';
      }
      html += '</div></div>';
    });
    $('spa-list').innerHTML = html;
  }

  function save(attr, mode, date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) { showErr('Укажите дату'); return; }
    var c = (st.data.catalog || []).filter(function (x) { return x.key === attr; })[0];
    var who = ($('drv-reg-name') && $('drv-reg-name').value.trim()) || 'сотрудник';
    // Помесячно: месяц, где признак был хотя бы день, считается целиком. Включение меняет расчёт с
    // месяца даты, завершение - со СЛЕДУЮЩЕГО месяца (месяц последнего дня ещё за сотрудником).
    var y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
    if (mode === 'stop') { m += 1; if (m > 12) { m = 1; y += 1; } }
    var MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
    var month = MONTHS[m - 1] + ' ' + y;
    var go = function () {
      st.busy = true; showErr('');
      postToYardApi_('/sprav/person_attrs/set', { person_id: st.personId, attr: attr, action: mode, date: date, confirm: c && c.payroll ? '1' : '' })
        .then(function (r) {
          st.busy = false;
          if (!r.ok) { showErr('Не сохранилось: ' + (r.data && r.data.error || 'ошибка сервера')); render(); return; }
          st.data.rows = r.data.rows || []; st.edit = null; render();
          if (window.p2Toast) p2Toast('Признак сохранён: ' + (c ? c.label : attr), 'green');
        }).catch(function () { st.busy = false; showErr('Сервер не ответил'); render(); });
    };
    if (!c || !c.payroll) { go(); return; }
    window.yardConfirm_(
      (mode === 'start' ? 'Включить «' + esc(c.label) + '» у <b>' + esc(who) + '</b> с ' + esc(ru(date))
                        : 'Завершить «' + esc(c.label) + '» у <b>' + esc(who) + '</b>, последний день ' + esc(ru(date))) +
      '. Выручка отдела, планы и зарплата изменятся <b>с месяца ' + esc(month) + '</b> - месяц считается целиком, ' +
      'прошлые месяцы не пересчитываются.',
      function (ok) { if (ok) go(); }, 'Влияет на зарплату', mode === 'start' ? 'Включить' : 'Завершить');
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#spa-list [data-act]');
    if (!b || st.busy) return;
    var act = b.getAttribute('data-act');
    if (act === 'edit') { st.edit = b.getAttribute('data-attr'); showErr(''); render(); var i = $('spa-date'); if (i) i.focus(); }
    else if (act === 'cancel') { st.edit = null; showErr(''); render(); }
    else if (act === 'save') save(b.getAttribute('data-attr'), b.getAttribute('data-mode'), ($('spa-date') || {}).value);
  });

  window.sprPersonAttrsLoad_ = load;
})();
