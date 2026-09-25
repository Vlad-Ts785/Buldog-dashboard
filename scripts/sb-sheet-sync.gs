/**
 * ЯРД ↔ таблица службы безопасности (СБ). 25.09.2026, plans/2026-09-25-hiring-sb-sheet-sync.md.
 *
 * СБ работает в таблице как раньше. Этот скрипт вставляется В САМУ таблицу СБ
 * (Расширения → Apps Script → вставить весь файл → Сохранить) и сам ходит на сервер ЯРД:
 *   - отдаёт строки таблицы (хранение у нас + ответы СБ из столбца «Комментарий»);
 *   - красит строку по ответу СБ: зелёный - «нет компромата», красный - отказ, жёлтый - собеседование,
 *     оранжевый - у СБ вопрос. Пустой ответ (ещё не проверили) - цвет не трогаем;
 *   - (этап 2) дописывает строки кандидатов, которых HR отправили на проверку из «Найма».
 *
 * Первый запуск (один раз, делает Влад): меню «ЯРД» → «1. Ввести ключ» → «2. Проверить связь» →
 * «3. Выгрузить всю таблицу на сервер» → «4. Включить автообмен».
 * Ключ - только в свойствах скрипта (не в коде); он открывает на сервере ТОЛЬКО обмен с СБ.
 * Столбцы ищутся по ЗАГОЛОВКАМ первой строки, не по буквам - переставлять столбцы можно.
 * Справа скрипт один раз добавляет служебный столбец «ID ЯРД (не трогать)» - по нему строка узнаётся,
 * даже если таблицу отсортировать или вставить строки. Этот столбец можно скрыть, но не удалять.
 * Правило Apps Script проекта: без шаблонных строк (обратных кавычек) внутри .map.
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
var SB_RECENT = 400;                    // сколько последних строк сверять раз в 5 минут

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
  PropertiesService.getScriptProperties().setProperty('SB_SHEET_TOKEN', v);
  ui.alert('Ключ сохранён. Дальше - «2. Проверить связь».');
}

function sbPing() {
  var r = sbCall_('get', '/ping');
  SpreadsheetApp.getUi().alert(r.ok ? 'Связь есть. На сервере строк: ' + r.rows : 'Нет связи: ' + (r.error || 'ошибка'));
}

// Первая выгрузка всей таблицы (и повторная - если нужно пересверить всё). Цвета не трогает.
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
  } finally { lock.releaseLock(); }
}

// Раз в 5 минут (триггер): последние строки таблицы -> сервер, покрасить по ответу. Этап 2 - ещё и заявки из «Найма».
function sbSyncRecent() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var sh = sbSheet_(), cols = sbCols_(sh);
    sbPullQueue_(sh, cols);
    sbEnsureIds_(sh, cols);
    var last = sh.getLastRow();
    var from = Math.max(2, last - SB_RECENT + 1);
    if (last < 2) return;
    var rows = sbReadRows_(sh, cols, from, last);
    var r = sbCall_('post', '/rows', { rows: rows });
    if (r.ok) sbPaint_(sh, cols, rows, r.statuses || {}, false);
    else sbReportError_('сверка строк', r.error);
  } catch (err) { sbReportError_('sbSyncRecent', err); throw err;
  } finally { lock.releaseLock(); }
}

// Правка в таблице (установленный триггер): изменённые строки - сразу на сервер и покрасить.
function sbOnEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getSheetId() !== sbSheet_().getSheetId()) return;
  var r1 = Math.max(2, e.range.getRow()), r2 = e.range.getLastRow();
  if (r2 < 2 || r2 - r1 > 200) return;             // большие вставки подберёт сверка раз в 5 минут
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    var cols = sbCols_(sh);
    sbEnsureIds_(sh, cols);
    var rows = sbReadRows_(sh, cols, r1, r2);
    var r = sbCall_('post', '/rows', { rows: rows });
    if (r.ok) sbPaint_(sh, cols, rows, r.statuses || {}, false);
  } catch (err) { sbReportError_('sbOnEdit', err);
  } finally { lock.releaseLock(); }
}

// Покрасить все строки по ответам СБ (разово, по кнопке меню).
function sbColorAll() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Покрасить все строки таблицы по ответам СБ?', 'Зелёный - нет компромата, красный - отказ, жёлтый - собеседование, оранжевый - вопрос СБ.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var sh = sbSheet_(), cols = sbCols_(sh);
  sbEnsureIds_(sh, cols);
  var last = sh.getLastRow();
  for (var from = 2; from <= last; from += SB_CHUNK) {
    var rows = sbReadRows_(sh, cols, from, Math.min(last, from + SB_CHUNK - 1));
    var r = sbCall_('post', '/rows', { rows: rows });
    if (!r.ok) { ui.alert('Сервер ответил ошибкой: ' + (r.error || '')); return; }
    sbPaint_(sh, cols, rows, r.statuses || {}, true);
  }
  ui.alert('Готово.');
}

function sbInstallTriggers() {
  sbRemoveTriggers(true);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger('sbSyncRecent').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('sbOnEdit').forSpreadsheet(ss).onEdit().create();
  SpreadsheetApp.getUi().alert('Автообмен включён: правки уходят сразу, сверка и новые заявки - раз в 5 минут.');
}
function sbRemoveTriggers(silent) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'sbSyncRecent' || f === 'sbOnEdit') ScriptApp.deleteTrigger(t);
  });
  if (silent !== true) SpreadsheetApp.getUi().alert('Автообмен выключен.');
}

// ───────── служебное ─────────
function sbSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = PropertiesService.getScriptProperties().getProperty('SB_SHEET_NAME');
  var sh = name ? ss.getSheetByName(name) : null;
  if (!sh) {
    sh = ss.getSheets()[0];               // таблица СБ - первый лист
    PropertiesService.getScriptProperties().setProperty('SB_SHEET_NAME', sh.getName());
  }
  return sh;
}
function sbNorm_(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); }
// Номера столбцов (с 1) по заголовкам; служебный столбец ID создаётся справа, если его нет.
function sbCols_(sh) {
  var lastCol = sh.getLastColumn();
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(sbNorm_);
  var cols = {};
  Object.keys(SB_FIELDS).forEach(function (k) {
    var i = head.indexOf(sbNorm_(SB_FIELDS[k]));
    if (i >= 0) cols[k] = i + 1;
  });
  if (!cols.fio || !cols.comment) throw new Error('Не нашёл столбцы «Ф.И.О.» и «Комментарий» в первой строке');
  var idIdx = head.indexOf(sbNorm_(SB_ID_HEADER));
  if (idIdx < 0) {
    idIdx = lastCol;                      // следующий свободный справа
    sh.getRange(1, idIdx + 1).setValue(SB_ID_HEADER).setFontColor('#999999');
  }
  cols.id = idIdx + 1;
  cols.paintTo = Math.max.apply(null, Object.keys(SB_FIELDS).map(function (k) { return cols[k] || 1; }));
  return cols;
}
// Всем строкам с данными (ФИО, паспорт или телефон) без ID - выдать ID «SB-N» (счётчик в свойствах скрипта).
function sbEnsureIds_(sh, cols) {
  var last = sh.getLastRow();
  if (last < 2) return;
  var n = last - 1;
  var ids = sh.getRange(2, cols.id, n, 1).getValues();
  var fio = sh.getRange(2, cols.fio, n, 1).getValues();
  var pas = cols.passport ? sh.getRange(2, cols.passport, n, 1).getValues() : null;
  var ph = cols.phone ? sh.getRange(2, cols.phone, n, 1).getValues() : null;
  var props = PropertiesService.getScriptProperties();
  var next = Number(props.getProperty('SB_NEXT_ID') || '0');
  if (!next) {                            // первый запуск или сброс свойств - продолжаем после самого большого ID
    next = 1;
    ids.forEach(function (r) { var m = String(r[0] || '').match(/^SB-(\d+)$/); if (m && Number(m[1]) >= next) next = Number(m[1]) + 1; });
  }
  var changed = false;
  for (var i = 0; i < n; i++) {
    if (String(ids[i][0] || '').trim()) continue;
    var has = String(fio[i][0] || '').trim() || (pas && String(pas[i][0] || '').trim()) || (ph && String(ph[i][0] || '').trim());
    if (!has) continue;
    ids[i][0] = 'SB-' + next++;
    changed = true;
  }
  if (changed) {
    sh.getRange(2, cols.id, n, 1).setValues(ids);
    props.setProperty('SB_NEXT_ID', String(next));
  }
}
function sbCell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Europe/Moscow', 'dd.MM.yyyy');
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
// Красит строки по статусу от сервера. force=false: «на проверке» (пусто) не трогаем - не стираем чужие цвета.
// Одним чтением и одной записью на весь блок строк - иначе 11 тысяч строк не уложатся в 6 минут Apps Script.
function sbPaint_(sh, cols, rows, statuses, force) {
  if (!rows.length) return;
  var r1 = rows[0].row, r2 = rows[0].row;
  rows.forEach(function (r) { if (r.row < r1) r1 = r.row; if (r.row > r2) r2 = r.row; });
  var rng = sh.getRange(r1, 1, r2 - r1 + 1, cols.paintTo);
  var bg = rng.getBackgrounds(), dirty = false;
  rows.forEach(function (r) {
    var color = SB_COLORS[statuses[r.uid]];
    if (!color && !force) return;
    var line = bg[r.row - r1], want = color || '#ffffff';
    for (var j = 0; j < line.length; j++) { if (line[j] !== want) { line[j] = want; dirty = true; } }
  });
  if (dirty) rng.setBackgrounds(bg);
}
// Заявки из «Найма» (HR перевёл кандидата на «Проверку СБ»): новая строка внизу таблицы, либо - если СБ ещё не
// ответила или задала вопрос - обновление ПРЕЖНЕЙ строки кандидата (по ID) с очищенным «Комментарием».
// После записи сообщаем серверу ID строки - по нему потом вернётся ответ СБ.
// ЗАЩИТА ОТ ДУБЛЕЙ (25.09, живой случай: скрипт дописывал строку и падал до подтверждения - за час 11 копий):
// номер ID берётся ДО записи и запоминается в свойствах скрипта (SB_REQ_<номер заявки>), строка пишется сразу
// вместе с ID одним действием. Повторная выдача той же заявки строку НЕ дописывает - только подтверждает снова.
function sbPullQueue_(sh, cols) {
  var r = sbCall_('get', '/queue');
  if (!r.ok || !r.items || !r.items.length) return;
  var props = PropertiesService.getScriptProperties();
  var width = Math.max(cols.id, cols.paintTo);
  var idRows = sbIdRows_(sh, cols), acks = [];
  r.items.forEach(function (it) {
    try {
      var done = props.getProperty('SB_REQ_' + it.req_id);
      if (done && idRows[done]) { acks.push({ req_id: it.req_id, uid: done, row: idRows[done] }); return; }
      var uid = it.uid && idRows[it.uid] ? it.uid : '';
      var row = uid ? idRows[uid] : null;
      var vals;
      if (!row) {
        row = sh.getLastRow() + 1;
        uid = 'SB-' + sbTakeId_(sh, cols, props);
        props.setProperty('SB_REQ_' + it.req_id, uid);
        vals = []; for (var i = 0; i < width; i++) vals.push('');
      } else {
        vals = sh.getRange(row, 1, 1, width).getValues()[0];
      }
      Object.keys(SB_FIELDS).forEach(function (k) { if (cols[k]) vals[cols[k] - 1] = it.cells && it.cells[k] != null ? it.cells[k] : ''; });
      vals[cols.id - 1] = uid;
      sh.getRange(row, 1, 1, width).setValues([vals]);
      idRows[uid] = row;
      acks.push({ req_id: it.req_id, uid: uid, row: row });
      try { sh.getRange(row, 1, 1, cols.paintTo).setBackground('#ffffff'); } catch (e2) { sbReportError_('цвет строки ' + row, e2); }
    } catch (err) { sbReportError_('заявка ' + it.req_id, err); }
  });
  if (acks.length) { var a = sbCall_('post', '/queue_ack', { acks: acks }); if (!a.ok) sbReportError_('queue_ack', a.error); }
}
// Следующий номер ID «SB-N» (тот же счётчик, что у sbEnsureIds_), сразу сохраняется.
function sbTakeId_(sh, cols, props) {
  var next = Number(props.getProperty('SB_NEXT_ID') || '0');
  if (!next) {
    next = 1;
    var map = sbIdRows_(sh, cols);
    Object.keys(map).forEach(function (u) { var m = u.match(/^SB-(\d+)$/); if (m && Number(m[1]) >= next) next = Number(m[1]) + 1; });
  }
  props.setProperty('SB_NEXT_ID', String(next + 1));
  return next;
}
// Ошибка скрипта - на сервер ЯРД (журнал выполнений Apps Script оттуда не виден).
function sbReportError_(where, err) {
  try {
    console.error(where, err);
    sbCall_('post', '/client_error', { where: String(where), message: String((err && (err.stack || err.message)) || err) });
  } catch (e) {}
}
function sbIdRows_(sh, cols) {
  var last = sh.getLastRow(), map = {};
  if (last < 2) return map;
  var ids = sh.getRange(2, cols.id, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) { var u = String(ids[i][0] || '').trim(); if (u) map[u] = i + 2; }
  return map;
}
function sbCall_(method, path, body) {
  var token = PropertiesService.getScriptProperties().getProperty('SB_SHEET_TOKEN');
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
