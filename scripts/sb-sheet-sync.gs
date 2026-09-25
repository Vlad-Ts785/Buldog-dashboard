/**
 * ЯРД ↔ таблица службы безопасности (СБ). 25.09.2026, plans/2026-09-25-hiring-sb-sheet-sync.md.
 *
 * СБ работает в таблице как раньше. Этот скрипт вставляется В САМУ таблицу СБ
 * (Расширения → Apps Script → вставить весь файл → Сохранить) и сам ходит на сервер ЯРД:
 *   - отдаёт строки таблицы (хранение у нас + ответы СБ из столбца «Комментарий»);
 *   - красит строку по ответу СБ: зелёный - «нет компромата», красный - отказ, жёлтый - собеседование,
 *     оранжевый - у СБ вопрос. Пустой ответ (ещё не проверили) - цвет не трогаем;
 *   - дописывает строки кандидатов, которых HR отправили на проверку из «Найма».
 *
 * Первый запуск (один раз, делает Влад): меню «ЯРД» → «1. Ввести ключ» → «2. Проверить связь» →
 * «3. Выгрузить всю таблицу на сервер» → «4. Включить автообмен».
 * Ключ хранится в ЛИЧНЫХ свойствах того, кто его ввёл (UserProperties): другие редакторы таблицы его не видят,
 * триггеры работают от имени ввёдшего. Ключ открывает на сервере ТОЛЬКО обмен с СБ.
 * Столбцы ищутся по ЗАГОЛОВКАМ первой строки, не по буквам - переставлять столбцы можно.
 * Справа один раз добавлен служебный столбец «ID ЯРД (не трогать)» - по нему строка узнаётся, даже если таблицу
 * отсортировать или вставить строки. Столбец можно скрыть, но НЕ удалять (скрипт тогда остановится и сообщит).
 * Правило Apps Script проекта: без шаблонных строк (обратных кавычек) внутри .map.
 *
 * Ревью 25.09 (после 11 копий одной заявки): ID выдаётся точечно и только пустым ячейкам (не переписываем весь
 * столбец снимком), повтор ID чинится, заявка пишется вместе с ID одним действием и запоминается, прежняя строка
 * перед записью перепроверяется по ID, ответ СБ в ней не стирается, лист расширяется при нужде, цвета - по ID,
 * а не по номерам строк, ошибки - на сервер (/client_error), выдача ID не мешает отправке ответов СБ.
 */

var SB_API = 'https://api.yardhub.ru/api/sb';
var SB_ID_HEADER = 'ID ЯРД (не трогать)';
var SB_FIELDS = {                       // поле -> заголовок столбца (сравнение без регистра и лишних пробелов)
  date: 'ДАТА', fio: 'Ф.И.О.', birth: 'Дата и место рождения', passport: 'Паспорт Серия/№', issued_by: 'Кем выдан',
  issue_date: 'Дата выдачи', address: 'Адрес регистрации', position: 'Должность', comment: 'Комментарий',
  phone: 'Номер телефона кандидата', note: 'Примечание'
};
var SB_COLORS = { approved: '#d9ead3', rejected: '#f4cccc', interview: '#fff2cc', question: '#fce5cd' };
var SB_CHUNK = 400;                     // строк за один запрос
var SB_TAIL = 40;                       // каждые 5 минут - последние строки (новые и свежие ответы)
var SB_FULL = 400;                      // раз в 30 минут - последние 400 строк (экономим квоту Apps Script)
var SB_FULL_EVERY_MS = 30 * 60 * 1000;

function onOpen() {
  SpreadsheetApp.getUi().createMenu('ЯРД')
    .addItem('1. Ввести ключ', 'sbSetKey')
    .addItem('2. Проверить связь', 'sbPing')
    .addItem('3. Выгрузить всю таблицу на сервер', 'sbPushAll')
    .addItem('4. Включить автообмен', 'sbInstallTriggers')
    .addSeparator()
    .addItem('Синхронизировать сейчас', 'sbSyncRecent')
    .addItem('Покрасить всю таблицу по ответам СБ', 'sbColorAll')
    .addItem('Выключить автообмен', 'sbRemoveTriggers')
    .addToUi();
}

function sbSetKey() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Ключ обмена с ЯРД', 'Вставьте ключ, который дал Влад (он открывает только обмен с СБ):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var v = String(r.getResponseText() || '').trim();
  if (v.length < 32) { ui.alert('Ключ слишком короткий - проверьте, что скопирован целиком.'); return; }
  PropertiesService.getUserProperties().setProperty('SB_SHEET_TOKEN', v);
  PropertiesService.getScriptProperties().deleteProperty('SB_SHEET_TOKEN');   // старое место - видно всем редакторам
  ui.alert('Ключ сохранён (виден только вам). Дальше - «2. Проверить связь».');
}

function sbPing() {
  var r = sbCall_('get', '/ping');
  SpreadsheetApp.getUi().alert(r.ok ? 'Связь есть. На сервере строк: ' + r.rows : 'Нет связи: ' + (r.error || 'ошибка'));
}

// Выгрузка всей таблицы (первая или повторная - пересверить всё). Цвета не трогает.
function sbPushAll() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { SpreadsheetApp.getUi().alert('Идёт другая синхронизация - повторите через минуту.'); return; }
  try {
    var sh = sbSheet_(), cols = sbCols_(sh);
    sbEnsureIds_(sh, cols);
    var last = sh.getLastRow(), saved = 0;
    for (var from = 2; from <= last; from += SB_CHUNK) {
      var rows = sbReadRows_(sh, cols, from, Math.min(last, from + SB_CHUNK - 1));
      var r = sbCall_('post', '/rows', { rows: rows });
      if (!r.ok) throw new Error('сервер ответил: ' + (r.error || 'ошибка') + ' (строки с ' + from + ')');
      saved += r.saved || 0;
    }
    SpreadsheetApp.getUi().alert('Готово: на сервер отправлено строк - ' + saved + '.');
  } catch (err) { sbReportError_('sbPushAll', err); throw err;
  } finally { lock.releaseLock(); }
}

// Раз в 5 минут (триггер): заявки из «Найма» -> строки; ответы СБ -> сервер; цвет строк.
function sbSyncRecent() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var sh = sbSheet_(), cols = sbCols_(sh);
    var watch = sbPullQueue_(sh, cols);
    // Выдача ID отдельно: если она упадёт, ответы СБ всё равно уйдут на сервер (ревью 25.09).
    try { sbEnsureIds_(sh, cols); } catch (e1) { sbReportError_('выдача ID', e1); }
    var last = sh.getLastRow();
    if (last < 2) return;
    var props = PropertiesService.getScriptProperties();
    var full = Date.now() - Number(props.getProperty('SB_LAST_FULL') || 0) > SB_FULL_EVERY_MS;
    var from = Math.max(2, last - (full ? SB_FULL : SB_TAIL) + 1);
    var rows = sbReadRows_(sh, cols, from, last);
    // + строки, ответа по которым ждёт «Найм» (могут быть глубоко в таблице)
    if (watch && watch.length) {
      var idRows = sbIdRows_(sh, cols), extra = [];
      watch.forEach(function (u) { var rw = idRows[u]; if (rw && rw < from) extra.push(rw); });
      rows = rows.concat(sbReadRowsAt_(sh, cols, extra));
    }
    var r = sbCall_('post', '/rows', { rows: rows });
    if (!r.ok) { sbReportError_('сверка строк', r.error); return; }
    if (full) props.setProperty('SB_LAST_FULL', String(Date.now()));
    sbPaint_(sh, cols, r.statuses || {}, false);
  } catch (err) { sbReportError_('sbSyncRecent', err); throw err;
  } finally { lock.releaseLock(); }
}

// Правка в таблице (установленный триггер): изменённые строки - сразу на сервер и покрасить.
function sbOnEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getSheetId() !== sbSheet_().getSheetId()) return;
  var r1 = Math.max(2, e.range.getRow()), r2 = e.range.getLastRow();
  if (r2 < 2 || r2 - r1 > 200) return;             // большие вставки подберёт сверка
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;                  // занято - подберёт сверка раз в 5 минут
  try {
    var cols = sbCols_(sh);
    try { sbEnsureIds_(sh, cols); } catch (e1) { sbReportError_('выдача ID (правка)', e1); }
    var rows = sbReadRows_(sh, cols, r1, r2);
    if (!rows.length) return;
    var r = sbCall_('post', '/rows', { rows: rows });
    if (r.ok) sbPaint_(sh, cols, r.statuses || {}, false);
  } catch (err) { sbReportError_('sbOnEdit', err);
  } finally { lock.releaseLock(); }
}

// Покрасить все строки по ответам СБ (разово, по кнопке меню).
function sbColorAll() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Покрасить все строки таблицы по ответам СБ?', 'Зелёный - нет компромата, красный - отказ, жёлтый - собеседование, оранжевый - вопрос СБ.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { ui.alert('Идёт другая синхронизация - повторите через минуту.'); return; }
  try {
    var sh = sbSheet_(), cols = sbCols_(sh);
    sbEnsureIds_(sh, cols);
    var last = sh.getLastRow();
    for (var from = 2; from <= last; from += SB_CHUNK) {
      var to = Math.min(last, from + SB_CHUNK - 1);
      var rows = sbReadRows_(sh, cols, from, to);
      var r = sbCall_('post', '/rows', { rows: rows });
      if (!r.ok) { ui.alert('Сервер ответил ошибкой: ' + (r.error || '')); return; }
      sbPaintBlock_(sh, cols, from, to, r.statuses || {}, true);
    }
    ui.alert('Готово.');
  } catch (err) { sbReportError_('sbColorAll', err); throw err;
  } finally { lock.releaseLock(); }
}

function sbInstallTriggers() {
  sbRemoveTriggers(true);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger('sbSyncRecent').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('sbOnEdit').forSpreadsheet(ss).onEdit().create();
  SpreadsheetApp.getUi().alert('Автообмен включён: правки уходят сразу, новые заявки и сверка - раз в 5 минут.');
}
function sbRemoveTriggers(silent) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'sbSyncRecent' || f === 'sbOnEdit') ScriptApp.deleteTrigger(t);
  });
  if (silent !== true) SpreadsheetApp.getUi().alert('Автообмен выключен (ваши триггеры).');
}

// ───────── заявки из «Найма» ─────────
// Новая строка внизу таблицы, либо - если СБ ещё не дала окончательного ответа - обновление ПРЕЖНЕЙ строки кандидата
// (по ID) с очищенным «Комментарием». ЗАЩИТА ОТ ДУБЛЕЙ (25.09, 11 копий): ID берётся ДО записи и запоминается
// (SB_REQ_<номер заявки>), строка пишется вместе с ID; повторная выдача той же заявки только подтверждается.
// Возвращает список ID строк, ответа по которым ждёт «Найм» (для сверки).
function sbPullQueue_(sh, cols) {
  var r = sbCall_('get', '/queue');
  if (!r.ok) { if (r.error) sbReportError_('очередь', r.error); return []; }
  var items = r.items || [];
  if (!items.length) return r.watch || [];
  var props = PropertiesService.getScriptProperties();
  var idRows = sbIdRows_(sh, cols), acks = [];
  items.forEach(function (it) {
    try {
      var done = props.getProperty('SB_REQ_' + it.req_id);
      if (done && idRows[done]) { acks.push({ req_id: it.req_id, uid: done, row: idRows[done] }); return; }
      var uid = '', row = null;
      if (it.uid && idRows[it.uid]) {
        row = idRows[it.uid];
        if (String(sh.getRange(row, cols.id).getValue() || '').trim() !== it.uid) row = null;   // строку сдвинули
        else if (/компром|компрот|отказ/i.test(String(sh.getRange(row, cols.comment).getValue() || ''))) {
          // СБ за эти минуты уже ответила окончательно - ничего не перетираем, только подтверждаем строку.
          props.setProperty('SB_REQ_' + it.req_id, it.uid);
          acks.push({ req_id: it.req_id, uid: it.uid, row: row });
          return;
        } else uid = it.uid;
      }
      if (!row) {
        row = sh.getLastRow() + 1;
        if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), row - sh.getMaxRows());   // лист «впритык» - расширяем
        uid = 'SB-' + sbTakeId_(sh, cols, props, idRows);
      }
      props.setProperty('SB_REQ_' + it.req_id, uid);
      // Только ячейки наших полей и ID - соседние формулы/данные СБ в строке не трогаем.
      Object.keys(SB_FIELDS).forEach(function (k) {
        if (cols[k]) sh.getRange(row, cols[k]).setValue(it.cells && it.cells[k] != null ? it.cells[k] : '');
      });
      sh.getRange(row, cols.id).setValue(uid);
      idRows[uid] = row;
      acks.push({ req_id: it.req_id, uid: uid, row: row });
      try { sh.getRange(row, 1, 1, cols.paintTo).setBackground('#ffffff'); } catch (e2) { sbReportError_('цвет строки ' + row, e2); }
    } catch (err) { sbReportError_('заявка ' + it.req_id, err); }
  });
  if (acks.length) { var a = sbCall_('post', '/queue_ack', { acks: acks }); if (!a.ok) sbReportError_('queue_ack', a.error); }
  return r.watch || [];
}
// Следующий номер ID: не меньше счётчика и больше самого большого ID на листе (сброс свойств не даст повторов).
function sbTakeId_(sh, cols, props, idRows) {
  var next = Number(props.getProperty('SB_NEXT_ID') || '0');
  var map = idRows || sbIdRows_(sh, cols), max = 0;
  Object.keys(map).forEach(function (u) { var m = u.match(/^SB-(\d+)$/); if (m && Number(m[1]) > max) max = Number(m[1]); });
  if (next <= max) next = max + 1;
  props.setProperty('SB_NEXT_ID', String(next + 1));
  return next;
}

// ───────── служебное ─────────
function sbSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SB_SHEET_ID');
  if (id) { var byId = ss.getSheets().filter(function (s) { return String(s.getSheetId()) === id; })[0]; if (byId) return byId; }
  var name = props.getProperty('SB_SHEET_NAME');
  var sh = (name && ss.getSheetByName(name)) || ss.getSheets()[0];   // таблица СБ - первый лист
  props.setProperty('SB_SHEET_ID', String(sh.getSheetId()));        // дальше - по номеру листа (переименование не собьёт)
  props.setProperty('SB_SHEET_NAME', sh.getName());
  return sh;
}
function sbNorm_(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); }
// Номера столбцов (с 1) по заголовкам. Столбец ID создаётся ОДИН раз; если потом пропал - стоп с сообщением
// (иначе выдали бы 11 000 новых ID и сломали связь с «Наймом»).
function sbCols_(sh) {
  var lastCol = sh.getLastColumn();
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(sbNorm_);
  var cols = {};
  Object.keys(SB_FIELDS).forEach(function (k) {
    var i = head.indexOf(sbNorm_(SB_FIELDS[k]));
    if (i >= 0) cols[k] = i + 1;
  });
  if (!cols.fio || !cols.comment) throw new Error('Не нашёл столбцы «Ф.И.О.» и «Комментарий» в первой строке');
  var props = PropertiesService.getScriptProperties();
  var idIdx = head.indexOf(sbNorm_(SB_ID_HEADER));
  if (idIdx < 0) {
    if (props.getProperty('SB_ID_COL_READY')) throw new Error('Пропал столбец «' + SB_ID_HEADER + '» - верните его (Правка → Отменить или история версий), без него связь с «Наймом» теряется');
    if (lastCol >= sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 1);
    idIdx = lastCol;                      // следующий свободный справа
    sh.getRange(1, idIdx + 1).setValue(SB_ID_HEADER).setFontColor('#999999');
  }
  props.setProperty('SB_ID_COL_READY', '1');
  cols.id = idIdx + 1;
  cols.paintTo = Math.max.apply(null, Object.keys(SB_FIELDS).map(function (k) { return cols[k] || 1; }));
  return cols;
}
// Строкам с данными (ФИО, паспорт или телефон) без ID - выдать ID «SB-N». Пишем ТОЧЕЧНО только выданные ячейки
// и прямо перед записью проверяем, что ячейка всё ещё пуста (СБ могла отсортировать таблицу). Повтор ID (строку
// скопировали вместе со скрытым столбцом) - нижней копии выдаётся новый ID.
function sbEnsureIds_(sh, cols) {
  var last = sh.getLastRow();
  if (last < 2) return;
  var n = last - 1;
  var ids = sh.getRange(2, cols.id, n, 1).getValues();
  var fio = sh.getRange(2, cols.fio, n, 1).getValues();
  var pas = cols.passport ? sh.getRange(2, cols.passport, n, 1).getValues() : null;
  var ph = cols.phone ? sh.getRange(2, cols.phone, n, 1).getValues() : null;
  var props = PropertiesService.getScriptProperties();
  var seen = {}, max = 0, need = [];
  for (var i = 0; i < n; i++) {
    var u = String(ids[i][0] || '').trim();
    var m = u.match(/^SB-(\d+)$/);
    if (m && Number(m[1]) > max) max = Number(m[1]);
    if (u && !seen[u]) { seen[u] = true; continue; }
    var has = String(fio[i][0] || '').trim() || (pas && String(pas[i][0] || '').trim()) || (ph && String(ph[i][0] || '').trim());
    if (has) need.push({ row: i + 2, was: u });   // пустой ID или повтор
  }
  if (!need.length) return;
  var next = Number(props.getProperty('SB_NEXT_ID') || '0');
  if (next <= max) next = max + 1;
  need.forEach(function (x) {
    var cell = sh.getRange(x.row, cols.id);
    if (String(cell.getValue() || '').trim() !== x.was) return;   // ячейку уже поменяли - не трогаем
    cell.setValue('SB-' + next);
    if (x.was) sbReportError_('повтор ID', 'строка ' + x.row + ': ' + x.was + ' -> SB-' + next);
    next++;
  });
  props.setProperty('SB_NEXT_ID', String(next));
}
function sbIdRows_(sh, cols) {
  var last = sh.getLastRow(), map = {};
  if (last < 2) return map;
  var ids = sh.getRange(2, cols.id, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) { var u = String(ids[i][0] || '').trim(); if (u && !map[u]) map[u] = i + 2; }
  return map;
}
function sbCell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'dd.MM.yyyy');
  return v === null || v === undefined ? '' : String(v);
}
function sbReadRows_(sh, cols, from, to) {
  if (to < from) return [];
  var width = Math.max(cols.id, cols.paintTo);
  var vals = sh.getRange(from, 1, to - from + 1, width).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var uid = String(vals[i][cols.id - 1] || '').trim();
    if (!uid) continue;
    var cells = {};
    Object.keys(SB_FIELDS).forEach(function (k) { cells[k] = cols[k] ? sbCell_(vals[i][cols[k] - 1]) : ''; });
    out.push({ uid: uid, row: from + i, cells: cells });
  }
  return out;
}
// Отдельные строки (по списку номеров) - одним чтением на каждый непрерывный кусок.
function sbReadRowsAt_(sh, cols, rowNums) {
  var list = rowNums.slice().sort(function (a, b) { return a - b; }), out = [], i = 0;
  while (i < list.length) {
    var j = i;
    while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
    out = out.concat(sbReadRows_(sh, cols, list[i], list[j]));
    i = j + 1;
  }
  return out;
}
// Цвет по ответу СБ. Номера строк берём заново ПОСЛЕ ответа сервера (по ID), красим только те строки, где цвет
// другой. «На проверке» (пусто) не трогаем - не стираем чужие цвета.
function sbPaint_(sh, cols, statuses, force) {
  var uids = Object.keys(statuses);
  if (!uids.length) return;
  var idRows = sbIdRows_(sh, cols);
  uids.forEach(function (u) {
    var color = SB_COLORS[statuses[u]];
    if (!color && !force) return;
    var row = idRows[u];
    if (!row) return;
    var rng = sh.getRange(row, 1, 1, cols.paintTo);
    var want = color || '#ffffff';
    if (rng.getBackgrounds()[0].some(function (b) { return b !== want; })) rng.setBackground(want);
  });
}
// Блоком (для «Покрасить всю таблицу»): одно чтение и одна запись на блок, ID перечитываются прямо перед записью.
function sbPaintBlock_(sh, cols, from, to, statuses, force) {
  var rng = sh.getRange(from, 1, to - from + 1, cols.paintTo);
  var ids = sh.getRange(from, cols.id, to - from + 1, 1).getValues();
  var bg = rng.getBackgrounds(), dirty = false;
  for (var i = 0; i < ids.length; i++) {
    var color = SB_COLORS[statuses[String(ids[i][0] || '').trim()]];
    if (!color && !force) continue;
    var want = color || '#ffffff';
    for (var j = 0; j < bg[i].length; j++) { if (bg[i][j] !== want) { bg[i][j] = want; dirty = true; } }
  }
  if (dirty) rng.setBackgrounds(bg);
}
function sbToken_() {
  return PropertiesService.getUserProperties().getProperty('SB_SHEET_TOKEN') ||
    PropertiesService.getScriptProperties().getProperty('SB_SHEET_TOKEN');   // старое место (до 25.09) - на переходный период
}
// Ошибка скрипта - на сервер ЯРД (журнал выполнений Apps Script оттуда не виден).
function sbReportError_(where, err) {
  try {
    console.error(where, err);
    sbCall_('post', '/client_error', { where: String(where), message: String((err && (err.stack || err.message)) || err) });
  } catch (e) {}
}
function sbCall_(method, path, body) {
  var token = sbToken_();
  if (!token) return { ok: false, error: 'не введён ключ (меню ЯРД → 1. Ввести ключ)' };
  var opt = { method: method, headers: { 'X-SB-Token': token }, muteHttpExceptions: true };
  if (body) { opt.contentType = 'text/plain'; opt.payload = JSON.stringify(body); }
  try {
    var resp = UrlFetchApp.fetch(SB_API + path, opt);
    var j = {};
    try { j = JSON.parse(resp.getContentText()); } catch (e) { j = { error: 'ответ не JSON (' + resp.getResponseCode() + ')' }; }
    if (resp.getResponseCode() !== 200) { j.ok = false; j.error = j.error || ('код ' + resp.getResponseCode()); }
    return j;
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
}
