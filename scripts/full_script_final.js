// ============================================================
// ВРЕМЕННАЯ ДИАГНОСТИКА (2026-07-04) - без подчёркивания в конце имени, чтобы функция
// была видна в выпадающем списке редактора Apps Script (Выполнить -> выбрать функцию).
// Запустить вручную, посмотреть журнал (Просмотр -> Журналы выполнения). Удалить после
// того, как разберёмся с вопросом "почему парк-отчёт отстаёт от заказов".
//
// Влад считает, что таблица 1С, из которой формируется парк-отчёт (валовая прибыль),
// обновляется в реальном времени - как только машину/водителя проставили в заказе, эта
// выручка должна быть видна и в парк-отчёте. Проверяем это здесь: сравниваем время
// получения последнего письма "Отчет парк" с последним письмом "Рассылка Отчет таблица
// заказов" - если парк-письмо реально старше, значит 1С генерирует и шлёт эти два отчёта
// с разной частотой (внешнее ограничение, не баг в нашем скрипте). Если письма свежие
// одинаково, а данные всё равно расходятся - проблема в нашем импорте, будем копать дальше.
// ============================================================
function debugCheckReportFreshness() {
  function latestEmailInfo(query) {
    var threads = GmailApp.search(query);
    var msgs = [];
    threads.forEach(function(t) { t.getMessages().forEach(function(m) { msgs.push(m); }); });
    if (!msgs.length) return null;
    msgs.sort(function(a, b) { return b.getDate() - a.getDate(); });
    var latest = msgs[0];
    return {
      subject: latest.getSubject(),
      date: latest.getDate(),
      received: Utilities.formatDate(latest.getDate(), 'Europe/Moscow', 'dd.MM.yyyy HH:mm'),
      count: msgs.length,
    };
  }

  var park = latestEmailInfo('from:v.tsutsurin@yard-imperial.ru subject:"Отчет парк" has:attachment newer_than:3d');
  var orders = latestEmailInfo('subject:"Рассылка Отчет таблица заказов" has:attachment newer_than:3d');

  Logger.log('=== Отчёт "парк" (валовая прибыль/выручка своего парка) ===');
  if (park) {
    Logger.log('Последнее письмо получено: ' + park.received);
    Logger.log('Тема: ' + park.subject);
    Logger.log('Всего писем за 3 дня: ' + park.count);
  } else {
    Logger.log('Писем НЕ найдено за последние 3 дня - это само по себе повод спросить, почему');
  }

  Logger.log('=== Отчёт "заказы" (таблица заказов) ===');
  if (orders) {
    Logger.log('Последнее письмо получено: ' + orders.received);
    Logger.log('Тема: ' + orders.subject);
    Logger.log('Всего писем за 3 дня: ' + orders.count);
  } else {
    Logger.log('Писем НЕ найдено за последние 3 дня');
  }

  if (park && orders) {
    var diffHours = Math.round((orders.date - park.date) / 3600000);
    Logger.log('=== Вывод ===');
    Logger.log('Разница между письмами: ' + diffHours + ' ч. (положительное число - заказы новее парка)');
    Logger.log('Если разница пара часов - значит 1С реально шлёт оба отчёта примерно синхронно, и '
      + 'если данные всё равно расходятся - проблема в нашем импорте, ищем дальше.');
    Logger.log('Если "Отчет парк" получен заметно раньше (на день и больше) - значит 1С генерирует '
      + 'этот конкретный отчёт реже/по своему расписанию, и расхождение в цифрах объясняется именно '
      + 'этим (нужно попросить того, кто в 1С формирует "Отчет парк", слать его чаще).');
  }
}

// ============================================================
// ПРЕДПРОСМОТР ОТЧЁТА ЗАКАЗОВ (запустить вручную один раз)
// Ищет письмо "Рассылка Отчет таблица заказов", читает Excel,
// пишет первые 60 строк в лист "Предпросмотр_заказов"
// ============================================================
function previewOrderReport() {
  const query = 'subject:"Рассылка Отчет таблица заказов" has:attachment newer_than:7d';
  const threads = GmailApp.search(query);
  if (threads.length === 0) throw new Error('Письмо не найдено за 7 дней');

  // Берём последнее письмо из всех тредов
  let allMessages = [];
  for (let thread of threads)
    for (let msg of thread.getMessages()) allMessages.push(msg);
  allMessages.sort((a, b) => a.getDate() - b.getDate());
  const latest = allMessages[allMessages.length - 1];

  Logger.log('Письмо от: ' + latest.getDate() + ' | Тема: ' + latest.getSubject());

  // Ищем Excel-вложение
  let reportFile = null;
  for (let att of latest.getAttachments()) {
    Logger.log('Вложение: ' + att.getName() + ' (' + att.getContentType() + ')');
    if (att.getName().endsWith('.xlsx') || att.getName().endsWith('.xls')) {
      reportFile = att; break;
    }
  }
  if (!reportFile) throw new Error('Excel-вложение не найдено. Смотри Logger — список вложений выше.');

  // Конвертируем в Google Sheets
  const tempFile = Drive.Files.insert(
    { title: 'temp_orders_preview_' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS },
    reportFile.copyBlob()
  );

  const tempSS = SpreadsheetApp.openById(tempFile.id);
  const sheets = tempSS.getSheets();
  Logger.log('Листов в файле: ' + sheets.length);
  for (let s of sheets) Logger.log('  - ' + s.getName());

  // Читаем первый лист, первые 60 строк и 30 колонок
  const sourceSheet = sheets[0];
  const lastRow = Math.min(sourceSheet.getLastRow(), 60);
  const lastCol = Math.min(sourceSheet.getLastColumn(), 30);
  const data = sourceSheet.getRange(1, 1, lastRow, lastCol).getValues();

  Drive.Files.remove(tempFile.id);

  // Пишем в лист-предпросмотр
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let preview = ss.getSheetByName('Предпросмотр_заказов');
  if (preview) preview.clear();
  else preview = ss.insertSheet('Предпросмотр_заказов');

  preview.getRange(1, 1, data.length, data[0].length).setValues(data);
  preview.autoResizeColumns(1, data[0].length);

  Logger.log('✅ Готово! Открой лист "Предпросмотр_заказов" в таблице.');
  Logger.log('Строк: ' + data.length + ' | Колонок: ' + data[0].length);

  // Выводим заголовки (строка 1) в лог
  Logger.log('=== ЗАГОЛОВКИ (строка 1) ===');
  for (let c = 0; c < data[0].length; c++) {
    if (data[0][c]) Logger.log('Кол. ' + (c+1) + ': ' + data[0][c]);
  }
}

// ============================================================
// НАСТРОЙКИ — менять только здесь
// ============================================================
const CONFIG = {
  SPREADSHEET_ID: '1jCPRXYDFcTpZIHdJfngZveOQFycu6qbcl-MoXBxtBRM',  // публичная ссылка, не секрет
  TELEGRAM_CHAT_ID: '1829485641',  // @Vlad_Ts_777, не секрет
  TELEGRAM_LOGISTS_CHAT_ID: '-5072928374',  // группа "Кадры/Ремонт/База"
  ALERT_FINE_THRESHOLD: 50000,   // штраф выше этой суммы → алерт
  ALERT_LOSS_THRESHOLD: 0,       // прибыль ниже этого → алерт
};

// Google OAuth Client ID - не секрет (Google сам рекомендует класть его в открытый код сайта,
// подделать его бесполезно без контроля над зарегистрированными origin'ами).
const GOOGLE_CLIENT_ID = '872723319158-cmr4v5v31fk3uv8ass3vvdch7at66n8e.apps.googleusercontent.com';

// Токен Telegram НЕ хранится в коде (это секрет).
// Задаётся один раз в редакторе Apps Script:
//   Настройки проекта (шестерёнка) → Свойства скрипта → Добавить свойство
//   Имя: TELEGRAM_TOKEN | Значение: <токен бота>
// Локальная резервная копия токена лежит в .env (вне git).
function getTelegramToken_() {
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN');
  if (!token) {
    throw new Error('TELEGRAM_TOKEN не задан. Настройки проекта → Свойства скрипта → добавь TELEGRAM_TOKEN.');
  }
  return token;
}

// ============================================================
// ГЛАВНАЯ ТОЧКА ВХОДА — вешается на триггер каждые 6 часов
// ============================================================
function runAll() {
  const log = [];
  const errors = [];

  log.push('🚀 Запуск обновления: ' + new Date().toLocaleString('ru'));

  try { importParkReports();       log.push('✅ Парк из 1С загружен'); }
  catch(e) { errors.push('❌ Парк из 1С: ' + e.message); }

  try { importOrdersReport();      log.push('✅ Заказы загружены'); }
  catch(e) { errors.push('❌ Заказы (импорт): ' + e.message); }

  // importManagerReport() отключён 2026-07-02 - выручка менеджеров теперь берётся из
  // таблицы заказов (единый источник, см. plans/2026-07-02-manager-revenue-single-source.md),
  // отдельное письмо от 1С больше не нужно - заодно меньше обращений к Gmail-квоте.
  // Функция и лист "Менеджеры_данные" оставлены нетронутыми на случай отката.

  try { normalizeReport();         log.push('✅ Нормализация выполнена'); }
  catch(e) { errors.push('❌ Нормализация: ' + e.message); }

  try { normalizeOrders();         log.push('✅ Заказы нормализованы'); }
  catch(e) { errors.push('❌ Заказы (норм.): ' + e.message); }

  try { createTopDriversByPlan();  log.push('✅ Топ водителей обновлён'); }
  catch(e) { errors.push('❌ Топ водителей: ' + e.message); }

  try { saveDailyStats();          log.push('✅ История парка сохранена'); }
  catch(e) { errors.push('❌ История парка: ' + e.message); }

  try { saveFinancialHistory();    log.push('✅ Финансовая история сохранена'); }
  catch(e) { errors.push('❌ Фин. история: ' + e.message); }

  // Алерты и сводка — собираем данные один раз
  let alertsText = '';
  let summaryText = '';

  try {
    alertsText = buildAlertsText();
    summaryText = buildSummaryText();
  } catch(e) {
    errors.push('❌ Сборка отчёта: ' + e.message);
  }

  // Отправляем в Telegram
  try {
    if (alertsText) sendTelegram('🚨 *АЛЕРТЫ*\n\n' + alertsText);
    sendTelegram(summaryText);
    // Отдельное сообщение по менеджерам и логистам
    sendTelegram(buildManagersText());
    if (errors.length > 0) sendTelegram('⚠️ *Ошибки при обновлении*\n\n' + errors.join('\n'));
    log.push('✅ Telegram уведомления отправлены');
  } catch(e) {
    log.push('❌ Telegram: ' + e.message);
  }

  console.log(log.join('\n'));
  console.log(errors.join('\n'));
}

// ============================================================
// ИМПОРТ ПАРКА ИЗ 1С (Gmail → Данные_1С / Данные_1С_история)
// С 2026-07-02 1С шлёт ДВА письма в день - "Отчет парк июнь от ДД.ММ.ГГГГ" (прошлый месяц,
// обновляется корректировками до 5-6 числа) и "Отчет парк июль от ДД.ММ.ГГГГ" (текущий).
// Слово месяца в теме - это период отчёта, дата после "от" - просто дата отправки.
// ============================================================
var RU_MONTHS_ = { 'январь':1,'февраль':2,'март':3,'апрель':4,'май':5,'июнь':6,'июль':7,
  'август':8,'сентябрь':9,'октябрь':10,'ноябрь':11,'декабрь':12 };

// "Отчет парк июнь от 02.07.2026" -> 6. null, если слово месяца не распознано (не должно
// ронять весь импорт - просто это письмо пропускается).
function parseMonthFromParkSubject_(subject) {
  var m = String(subject || '').match(/Отчет\s+парк\s+(\S+)\s+от/i);
  if (!m) return null;
  var word = m[1].toLowerCase().replace(/[^а-яё]/g, '');
  return RU_MONTHS_[word] || null;
}

// Сверяет месяц письма с сегодняшним календарным месяцем (по Москве) - текущий/прошлый/
// ни один из двух (например, письмо за месяц двухмесячной давности - игнорируем).
function classifyParkMonth_(monthNum) {
  var todayStr = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM-dd');
  var p = todayStr.split('-').map(Number);
  var curYear = p[0], curMonth = p[1];
  var prevMonth = curMonth - 1, prevYear = curYear;
  if (prevMonth < 1) { prevMonth = 12; prevYear = curYear - 1; }
  if (monthNum === curMonth) return { type: 'current', year: curYear, month: curMonth };
  if (monthNum === prevMonth) return { type: 'previous', year: prevYear, month: prevMonth };
  return null;
}

function importParkReports() {
  var query = 'from:v.tsutsurin@yard-imperial.ru subject:"Отчет парк" has:attachment newer_than:3d';
  var threads = GmailApp.search(query);
  if (threads.length === 0) throw new Error('Письма "Отчет парк" не найдены за последние 3 дня');

  var allMessages = [];
  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages();
    for (var m = 0; m < msgs.length; m++) allMessages.push(msgs[m]);
  }
  allMessages.sort(function(a, b) { return b.getDate() - a.getDate(); }); // новые сначала

  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var handled = {}; // 'current'/'previous' -> true - обрабатываем только САМОЕ СВЕЖЕЕ письмо каждого типа
  var results = [];

  for (var i = 0; i < allMessages.length; i++) {
    var msg = allMessages[i];
    var monthNum = parseMonthFromParkSubject_(msg.getSubject());
    if (!monthNum) continue; // тема не распознана - пропускаем, не ломаем остальное
    var cls = classifyParkMonth_(monthNum);
    if (!cls || handled[cls.type]) continue;
    handled[cls.type] = true;

    var reportFile = null;
    var atts = msg.getAttachments();
    for (var a = 0; a < atts.length; a++) {
      var name = atts[a].getName();
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) { reportFile = atts[a]; break; }
    }
    if (!reportFile) { results.push(cls.type + ': Excel-вложение не найдено, пропущено'); continue; }

    var tempFile = Drive.Files.insert(
      { title: 'temp_park_' + cls.type + '_' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS },
      reportFile.copyBlob()
    );
    var data = SpreadsheetApp.openById(tempFile.id).getSheets()[0].getDataRange().getValues();
    Drive.Files.remove(tempFile.id);

    if (cls.type === 'current') {
      var targetSheet = ss.getSheetByName('Данные_1С');
      if (!targetSheet) throw new Error('Лист Данные_1С не найден');
      targetSheet.clear();
      if (data && data.length > 0) targetSheet.getRange(1, 1, data.length, data[0].length).setValues(data);
      results.push('current: Данные_1С обновлены (' + data.length + ' строк)');
    } else {
      var written = writeParkHistoryForMonth_(ss, cls.year, cls.month, data);
      results.push('previous: Данные_1С_история обновлена за ' + cls.year + '-' + String(cls.month).padStart(2, '0') + ' (' + written + ' машин)');
    }
    msg.markRead();
  }

  if (results.length === 0) throw new Error('Ни одно письмо не распознано (проверь темы писем)');
  Utilities.sleep(2000);
  return results;
}

function getOrCreateParkHistorySheet_(ss) {
  var sheet = ss.getSheetByName('Данные_1С_история');
  if (!sheet) {
    sheet = ss.insertSheet('Данные_1С_история');
    var headers = ['Месяц', 'Госномер', 'Тип', 'Статус', 'Выручка', 'ФОТ', 'Топливо', 'Запчасти',
      'Штрафы', 'Проходные', 'Валовая прибыль', 'План ВП'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  }
  return sheet;
}

// Разбирает "сырые" строки отчёта парка (та же логика, что normalizeReport(), но пишет в
// архив по завершённому месяцу, а не в живой Данные_1С) и идемпотентно записывает в
// Данные_1С_история - чистит этот месяц перед записью, т.к. "прошлый месяц" 1С присылает
// каждый день с уточнёнными цифрами, пока корректировки идут (до 5-6 числа).
function writeParkHistoryForMonth_(ss, year, month, rawData) {
  var staffData = getStaffData(ss);
  var monthKey = year + '-' + String(month).padStart(2, '0');
  var skipKeywords = ['Итого', 'ПР-4', 'ПР-5', 'ПР-3', 'ТКР-4', 'КР-3', 'П-3', 'К-3',
    'Длинномер', 'Единица техники', 'Тягач', 'Параметры:', 'ПР-8'];

  var newRows = [];
  for (var i = 2; i < rawData.length; i++) {
    var row = rawData[i];
    var fullName = String(row[0] || '').trim();
    if (!fullName) continue;

    var skip = false;
    for (var k = 0; k < skipKeywords.length; k++) {
      var kw = skipKeywords[k];
      if (fullName === kw || fullName.indexOf(kw + ' ') === 0 ||
          (fullName.indexOf(kw) >= 0 && !fullName.match(/[А-ЯA-Z]\d{3}/i))) { skip = true; break; }
    }
    if (skip) continue;

    var revenue = parseFloat(row[5]) || 0;
    var profit = parseFloat(row[12]) || 0;
    if (revenue === 0 && profit === 0) continue;

    var gosRaw = extractGosNumber(fullName);
    if (!gosRaw) continue;
    var gosFormatted = formatGosNumber(gosRaw);
    var staffInfo = staffData[normalizeGos(gosFormatted)] || {};

    newRows.push([
      monthKey, gosFormatted, staffInfo.type || '', staffInfo.status || '',
      revenue, parseFloat(row[6]) || 0, parseFloat(row[7]) || 0, parseFloat(row[8]) || 0,
      parseFloat(row[9]) || 0, parseFloat(row[10]) || 0, profit, staffInfo.plan || 0
    ]);
  }

  var histSheet = getOrCreateParkHistorySheet_(ss);
  var lastRow = histSheet.getLastRow();
  if (lastRow > 1) {
    var existing = histSheet.getRange(2, 1, lastRow - 1, 12).getValues();
    // Колонка "Месяц" - Google Таблицы молча превращают текст "2026-06" в объект Date (тот же
    // трюк, что уже ловили в getManagerPlans_ и getManagerPlans_/"Планы_менеджеров") - сравнение
    // "как есть" никогда не совпадало с monthKey, старые строки за месяц НЕ удалялись и копились
    // при каждом запуске, пока идут корректировки (найдено Владом 2026-07-04 - 13 дублей подряд).
    var keep = existing.filter(function(r) { return parkHistMonthKey_(r[0]) !== monthKey; });
    histSheet.getRange(2, 1, lastRow - 1, 12).clearContent();
    if (keep.length > 0) histSheet.getRange(2, 1, keep.length, 12).setValues(keep);
  }
  if (newRows.length > 0) {
    histSheet.getRange(histSheet.getLastRow() + 1, 1, newRows.length, 12).setValues(newRows);
  }
  return newRows.length;
}

// "Месяц" в Данные_1С_история может быть и текстом "2026-06", и объектом Date (Google Таблицы
// переформатируют сами) - приводим к единому текстовому виду для сравнения.
function parkHistMonthKey_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Europe/Moscow', 'yyyy-MM');
  return String(v || '').trim();
}

// ============================================================
// ИМПОРТ МЕНЕДЖЕРОВ (Gmail → Менеджеры_данные)  ИСПРАВЛЕНО
// ============================================================
function importManagerReport() {
  const query = 'subject:"Выручка по менеджерам и разнесение" has:attachment newer_than:3d';
  const threads = GmailApp.search(query);
  if (threads.length === 0) throw new Error('Письмо менеджеров не найдено за 3 дня');

  let allMessages = [];
  for (let thread of threads)
    for (let msg of thread.getMessages()) allMessages.push(msg);
  allMessages.sort((a, b) => a.getDate() - b.getDate());
  const latestMessage = allMessages[allMessages.length - 1];

  let reportFile = null;
  for (let att of latestMessage.getAttachments()) {
    if (att.getName().endsWith('.xlsx') || att.getName().endsWith('.xls')) {
      reportFile = att; break;
    }
  }
  if (!reportFile) throw new Error('Excel-вложение не найдено');

  const tempFile = Drive.Files.insert(
    { title: 'temp_mgr_' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS },
    reportFile.copyBlob()
  );
  const data = SpreadsheetApp.openById(tempFile.id).getSheets()[0].getDataRange().getValues();
  Drive.Files.remove(tempFile.id);

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let resultSheet = ss.getSheetByName('Менеджеры_данные');
  if (resultSheet) resultSheet.clear();
  else resultSheet = ss.insertSheet('Менеджеры_данные');

  const headers = ['Менеджер', 'План продаж', 'Факт продаж', 'Сумма оплаты', 'Сумма оплаты нал', '% выполнения'];
  resultSheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');

  const managers = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const name = String(row[0] || '').trim();
    if (!name || name.length < 10) continue;
    if (name.startsWith('Параметры') || name.startsWith('Отбор') ||
        name.startsWith('Подразделение') || name.startsWith('Менеджер') ||
        name.startsWith('Тралы') || name.startsWith('Итого')) continue;

    // ИСПРАВЛЕНО: план в колонке [6], не [5]
    const plan      = parseFloat(row[6])  || 0;
    const fakt      = parseFloat(row[9])  || 0;
    const sumOplaty = parseFloat(row[10]) || 0;
    const sumNal    = parseFloat(row[11]) || 0;
    const procent   = parseFloat(row[12]) || 0;

    if (fakt === 0 && plan === 0) continue;
    managers.push([name, plan, fakt, sumOplaty, sumNal, procent]);
  }

  if (managers.length === 0) throw new Error('Нет данных о менеджерах');
  resultSheet.getRange(2, 1, managers.length, headers.length).setValues(managers);
  resultSheet.getRange(2, 2, managers.length, 4).setNumberFormat('#,##0');
  resultSheet.getRange(2, 6, managers.length, 1).setNumberFormat('0.00');
  resultSheet.autoResizeColumns(1, headers.length);
  latestMessage.markRead();
}

// ============================================================
// НОРМАЛИЗАЦИЯ (Данные_1С → Нормализованные_данные)
// ============================================================
function normalizeReport() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const dataSheet = ss.getSheetByName('Данные_1С');
  if (!dataSheet) throw new Error('Лист Данные_1С не найден');

  const lastRow = dataSheet.getLastRow();
  if (lastRow < 10) throw new Error('Данных недостаточно');

  const data = dataSheet.getRange(1, 1, lastRow, 13).getValues();

  // Читаем Штатку — карта госномер → {type, status, trailerGos}
  const staffData = getStaffData(ss);

  let normSheet = ss.getSheetByName('Нормализованные_данные');
  if (normSheet) normSheet.clear();
  else normSheet = ss.insertSheet('Нормализованные_данные');

  const headers = [
    'Госномер (ключ)', 'Марка', 'Тип техники', 'Выручка', 'ФОТ',
    'Топливо', 'Запчасти', 'Штрафы', 'Проходные', 'Валовая прибыль',
    'Прицеп', 'Гос. номер прицепа', 'Тип из Штатки', 'Статус из Штатки', 'План ВП',
    'Прогноз ВП'
  ];
  normSheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');

  // Прогноз по темпу - тот же расчёт, что уже используется на Панели/"По менеджерам":
  // факт/день_месяца*дней_в_месяце. Влад, 2026-07-04: "нужна колонка по прогнозу плана
  // по валовой прибыли" - прямо в таблицу, не только на дашборде.
  // День берём "вчера", а не сегодня - Нормализованные_данные обычно отстаёт на день
  // (отчёт "Отчет парк" от 1С приходит с лагом, см. переписку 2026-07-04), то есть в
  // моменте это фактически данные ЗА ВЧЕРА - если делить факт на "сегодня", темп занижается.
  const todayForForecast = new Date();
  todayForForecast.setDate(todayForForecast.getDate() - 1);
  const dayOfMonthForForecast = todayForForecast.getDate();
  const daysInMonthForForecast = new Date(todayForForecast.getFullYear(), todayForForecast.getMonth() + 1, 0).getDate();
  const forecastPaceRatio = dayOfMonthForForecast > 0 ? (daysInMonthForForecast / dayOfMonthForForecast) : 1;

  const skipKeywords = ['Итого','ПР-4','ПР-5','ПР-3','ТКР-4','КР-3','П-3','К-3',
                        'Длинномер','Единица техники','Тягач','Параметры:','ПР-8'];
  const vehicles = [];

  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    const fullName = String(row[0] || '').trim();
    if (!fullName) continue;

    let skip = false;
    for (let kw of skipKeywords) {
      if (fullName === kw || fullName.startsWith(kw + ' ') ||
          (fullName.includes(kw) && !fullName.match(/[А-ЯA-Z]\d{3}/i))) {
        skip = true; break;
      }
    }
    if (skip) continue;

    const revenue = parseFloat(row[5]) || 0;
    const profit  = parseFloat(row[12]) || 0;
    if (revenue === 0 && profit === 0) continue;

    const gosRaw = extractGosNumber(fullName);
    if (!gosRaw) continue;

    const gosFormatted = formatGosNumber(gosRaw);
    const staffInfo = staffData[normalizeGos(gosFormatted)] || {};

    vehicles.push([
      gosFormatted,                            // A — госномер
      fullName.split(' ').slice(0, 2).join(' '), // B — марка
      detectType(fullName),                    // C — тип техники (из 1С)
      revenue,                                 // D — выручка
      parseFloat(row[6]) || 0,                 // E — ФОТ
      parseFloat(row[7]) || 0,                 // F — топливо
      parseFloat(row[8]) || 0,                 // G — запчасти
      parseFloat(row[9]) || 0,                 // H — штрафы
      parseFloat(row[10]) || 0,                // I — проходные
      profit,                                  // J — валовая прибыль
      String(row[3] || '').trim(),             // K — прицеп (описание из 1С)
      staffInfo.trailerGos || '',              // L — гос. номер прицепа из Штатки
      staffInfo.type       || '',              // M — тип из Штатки (ПР-8, ТКР-4, КР-3...)
      staffInfo.status     || '',              // N — статус из Штатки (В работе / Ремонт)
      staffInfo.plan       || 0,              // O — план ВП из Штатки (колонка F)
      Math.round(profit * forecastPaceRatio), // P — прогноз ВП по темпу на конец месяца
    ]);
  }

  if (vehicles.length === 0) throw new Error('Нет данных о машинах');
  normSheet.getRange(2, 1, vehicles.length, headers.length).setValues(vehicles);
  normSheet.getRange(2, 4, vehicles.length, 7).setNumberFormat('#,##0.00');
  normSheet.getRange(2, 16, vehicles.length, 1).setNumberFormat('#,##0');
  normSheet.setColumnWidths(1, 1, 140);
  normSheet.autoResizeColumns(2, 3);
}

function detectType(name) {
  if (name.includes('ПР-8')) return 'ПР-8';
  if (name.includes('ПР-5')) return 'ПР-5';
  if (name.includes('ПР-4')) return 'ПР-4';
  if (name.includes('ПР-3')) return 'ПР-3';
  if (name.includes('ТКР-4')) return 'ТКР-4';
  if (name.includes('КР-3')) return 'КР-3';
  if (name.includes('К-3')) return 'К-3';
  if (name.includes('Рапид') || name.includes('П-3')) return 'Рапид';
  if (name.includes('Борт') || name.includes('Длинномер')) return 'Длинномер';
  return 'Трал';
}

// ============================================================
// ТОП ВОДИТЕЛЕЙ (Штатка → ТОП_водителей_по_плану)
// ============================================================
function createTopDriversByPlan() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Штатка');
  if (!sheet) throw new Error('Лист Штатка не найден');

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  // Ищем колонку «ВОДИТЕЛЬ 1» по заголовку в строке 5
  const headerRow = sheet.getRange(5, 1, 1, lastCol).getValues()[0];
  var driverCol = -1;
  for (var h = 0; h < headerRow.length; h++) {
    var hdr = String(headerRow[h] || '').trim().toUpperCase();
    if (hdr === 'ВОДИТЕЛЬ 1' || hdr === 'ВОДИТЕЛЬ') { driverCol = h; break; }
  }
  // fallback: старый индекс
  if (driverCol < 0) driverCol = 33;

  const numCols = Math.max(driverCol + 1, 8); // минимум A-H
  const data = sheet.getRange(6, 1, lastRow - 5, numCols).getValues();

  const vehicles = [];
  for (let row of data) {
    const plan    = parseFloat(row[5]) || 0;
    const fakt    = parseFloat(row[6]) || 0;
    const procent = parseFloat(row[7]) || 0;
    const driver  = String(row[driverCol] || '').trim();

    if (procent <= 0) continue;

    let type = String(row[0] || '').trim();
    const trailer = String(row[3] || '').trim();
    if (!type) {
      const m = trailer.match(/ПР-[0-9]|ТКР-4|КР-3|К-3/);
      type = m ? m[0] : '—';
    }

    vehicles.push({
      marka:   String(row[1] || '').split(' ')[0],
      gos:     String(row[2] || '').trim(),
      type:    type || '—',
      plan, fakt, procent, driver
    });
  }

  vehicles.sort((a, b) => b.procent - a.procent);
  const top10 = vehicles.slice(0, 10);

  let resultSheet = ss.getSheetByName('ТОП_водителей_по_плану');
  if (resultSheet) resultSheet.clear();
  else resultSheet = ss.insertSheet('ТОП_водителей_по_плану');

  const headers = ['Марка', 'Госномер', 'Тип', 'План', 'Факт', '% выполнения', 'Водитель'];
  resultSheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');

  const outputData = top10.map(v => [v.marka, v.gos, v.type, v.plan, v.fakt, v.procent, v.driver]);
  resultSheet.getRange(2, 1, outputData.length, outputData[0].length).setValues(outputData);
  resultSheet.getRange(2, 4, outputData.length, 2).setNumberFormat('#,##0');
  resultSheet.getRange(2, 6, outputData.length, 1).setNumberFormat('0.00%');
  resultSheet.autoResizeColumns(1, 7);
}

// ============================================================
// ИСТОРИЯ ПАРКА (статусы каждый день → История_показателей)
// ИСПРАВЛЕН БАГ: totalTrails ≠ workTrails
// ============================================================
function saveDailyStats() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  // Используем getFleetStatus — тот же источник, что и дашборд
  const fleet = getFleetStatus(getStaffData(ss));
  const tr = fleet.trailers;
  const tk = fleet.trucks;

  const workTrails    = tr.working;
  const repairTrails  = tr.repair;
  const noDriverTrails= tr.noDriver;
  const noOrderTrails = tr.noOrder;
  const totalTrails   = tr.total;

  const workLongs     = tk.working;
  const repairLongs   = tk.repair;
  const noDriverLongs = tk.noDriver;
  const noOrderLongs  = tk.noOrder;
  const totalLongs    = tk.total;

  const simpleTrails = repairTrails + noDriverTrails + noOrderTrails;
  const simpleLongs  = repairLongs  + noDriverLongs  + noOrderLongs;

  let historySheet = ss.getSheetByName('История_показателей');
  if (!historySheet) {
    historySheet = ss.insertSheet('История_показателей');
    const headers = [
      'Дата',
      'Всего тралы', 'В работе тралы', 'Ремонт тралы', 'Без водителя тралы', 'Без заказа тралы', 'Простой тралы',
      'Всего длинномеры', 'В работе длинномеры', 'Ремонт длинномеры', 'Без водителя длинномеры', 'Без заказа длинномеры', 'Простой длинномеры'
    ];
    historySheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lastRow = historySheet.getLastRow();
  let todayRowIndex = -1;

  if (lastRow > 1) {
    const dates = historySheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < dates.length; i++) {
      if (dates[i][0] instanceof Date) {
        const d = new Date(dates[i][0]);
        d.setHours(0, 0, 0, 0);
        if (d.getTime() === today.getTime()) { todayRowIndex = i + 2; break; }
      }
    }
  }

  const newRow = [
    new Date(),
    totalTrails, workTrails, repairTrails, noDriverTrails, noOrderTrails, simpleTrails,
    totalLongs,  workLongs,  repairLongs,  noDriverLongs,  noOrderLongs,  simpleLongs
  ];

  if (todayRowIndex > 0) {
    historySheet.getRange(todayRowIndex, 1, 1, newRow.length).setValues([newRow]);
  } else {
    historySheet.appendRow(newRow);
  }
}

// ============================================================
// ФИНАНСОВАЯ ИСТОРИЯ ПО МАШИНАМ (нарастающий итог месяца)
// Структура v2: Дата | Госномер | Тип | Статус | Выручка | ФОТ | Топливо | Запчасти | Штрафы | Проходные | Прибыль | План ВП
// ============================================================
function saveFinancialHistory() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  // Мастер-список: ВСЕ машины из Штатки (включая без выручки — ремонт, без водителя)
  var staffData = getStaffData(ss);
  if (Object.keys(staffData).length === 0) throw new Error('Штатка пуста или недоступна');

  // Финансы: только машины с выручкой из Нормализованных_данных
  var finMap = {};
  var normSheet = ss.getSheetByName('Нормализованные_данные');
  if (normSheet && normSheet.getLastRow() > 1) {
    var normData = normSheet.getRange(2, 1, normSheet.getLastRow() - 1, 10).getValues();
    for (var n = 0; n < normData.length; n++) {
      var nr = normData[n];
      var nGos = String(nr[0] || '').trim();
      if (!nGos) continue;
      finMap[normalizeGos(nGos)] = {
        revenue: parseFloat(nr[3]) || 0,
        fot:     parseFloat(nr[4]) || 0,
        fuel:    parseFloat(nr[5]) || 0,
        parts:   parseFloat(nr[6]) || 0,
        fines:   parseFloat(nr[7]) || 0,
        tolls:   parseFloat(nr[8]) || 0,
        profit:  parseFloat(nr[9]) || 0,
      };
    }
  }

  var finSheet = ss.getSheetByName('История_финансов');
  if (!finSheet) finSheet = ss.insertSheet('История_финансов');

  if (finSheet.getLastRow() === 0) {
    var hdrs = ['Дата','Госномер','Тип','Статус','Выручка','ФОТ','Топливо','Запчасти','Штрафы','Проходные','Валовая прибыль','План ВП','Водитель'];
    finSheet.getRange(1, 1, 1, hdrs.length).setValues([hdrs]).setFontWeight('bold');
  } else if (finSheet.getLastColumn() < 13) {
    // Добавлена колонка "Водитель" (2026-07-04) - старые строки без неё не трогаем,
    // задним числом водителя не восстановить, история просто начинает копиться с сегодня.
    finSheet.getRange(1, 13).setValue('Водитель').setFontWeight('bold');
  }

  // Удаляем записи за сегодня — перезапишем актуальными
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var finLastRow = finSheet.getLastRow();
  if (finLastRow > 1) {
    var existingDates = finSheet.getRange(2, 1, finLastRow - 1, 1).getValues();
    var deleteFrom = -1;
    for (var di = 0; di < existingDates.length; di++) {
      if (existingDates[di][0] instanceof Date) {
        var d = new Date(existingDates[di][0]);
        d.setHours(0, 0, 0, 0);
        if (d.getTime() === today.getTime()) { deleteFrom = di + 2; break; }
      }
    }
    if (deleteFrom > 0) finSheet.deleteRows(deleteFrom, finLastRow - deleteFrom + 1);
  }

  // Строим строки: за основу берём Штатку, финансы джойним по госномеру
  var rows = [];
  var nowDate = new Date();
  for (var gosClean in staffData) {
    var v = staffData[gosClean];
    var f = finMap[gosClean] || { revenue:0, fot:0, fuel:0, parts:0, fines:0, tolls:0, profit:0 };
    rows.push([
      nowDate, v.gosOriginal, v.type, v.status,
      f.revenue, f.fot, f.fuel, f.parts, f.fines, f.tolls, f.profit, v.plan, v.driver || ''
    ]);
  }

  if (rows.length > 0) {
    finSheet.getRange(finSheet.getLastRow() + 1, 1, rows.length, 13).setValues(rows);
  }
}

// ============================================================
// АЛЕРТЫ — собирает текст для Telegram
// ============================================================
function buildAlertsText() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const normSheet = ss.getSheetByName('Нормализованные_данные');
  if (!normSheet) return '';

  const lastRow = normSheet.getLastRow();
  if (lastRow < 2) return '';

  const data = normSheet.getRange(2, 1, lastRow - 1, 10).getValues();
  const alerts = [];

  for (let row of data) {
    const gos    = row[0];
    const type   = row[2];
    const profit = parseFloat(row[9]) || 0;
    const fines  = Math.abs(parseFloat(row[7]) || 0);

    if (profit < CONFIG.ALERT_LOSS_THRESHOLD) {
      alerts.push(`🔴 ${gos} (${type}) — убыток ${formatNum(profit)} руб.`);
    }
    if (fines > CONFIG.ALERT_FINE_THRESHOLD) {
      alerts.push(`⚠️ ${gos} (${type}) — штраф ${formatNum(fines)} руб.`);
    }
  }

  return alerts.length > 0 ? alerts.join('\n') : '';
}

// ============================================================
// СВОДКА — строит основное сообщение для Telegram
// ============================================================

function buildSummaryText() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  // Финансы по парку
  const normSheet = ss.getSheetByName('Нормализованные_данные');
  let totalRevenue = 0, totalProfit = 0, lossCount = 0;
  if (normSheet && normSheet.getLastRow() > 1) {
    const data = normSheet.getRange(2, 1, normSheet.getLastRow() - 1, 10).getValues();
    for (let row of data) {
      totalRevenue += parseFloat(row[3]) || 0;
      const p = parseFloat(row[9]) || 0;
      totalProfit += p;
      if (p < 0) lossCount++;
    }
  }

  // Статус парка — из Штатки (все машины, включая без выручки)
  var fleet = getFleetStatus(getStaffData(ss));
  var workT = fleet.trailers.working, repairT = fleet.trailers.repair, noDriverT = fleet.trailers.noDriver;
  var workL = fleet.trucks.working,   repairL = fleet.trucks.repair,   noDriverL = fleet.trucks.noDriver;

  var now = new Date().toLocaleString('ru', { timeZone: 'Europe/Moscow' });
  var margin = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(1) : '0';

  return '📊 *Сводка парка* | ' + now + '\n\n' +
    '💰 *Финансы (нарастающий итог месяца)*\n' +
    'Выручка парка: ' + formatNum(totalRevenue) + ' руб.\n' +
    'Валовая прибыль: ' + formatNum(totalProfit) + ' руб. (' + margin + '%)\n' +
    (lossCount > 0 ? '🔴 В убытке: ' + lossCount + ' машин' : '✅ Убыточных нет') + '\n\n' +
    '🚛 *Тралы (36 ед.)*\n' +
    'В работе: ' + workT + ' | Ремонт: ' + repairT + ' | Без вод.: ' + noDriverT + '\n\n' +
    '🚚 *Длинномеры (19 ед.)*\n' +
    'В работе: ' + workL + ' | Ремонт: ' + repairL + ' | Без вод.: ' + noDriverL;
}

// ============================================================
// ОТДЕЛЬНОЕ СООБЩЕНИЕ ПО МЕНЕДЖЕРАМ И ЛОГИСТАМ
// ============================================================
// Факт/план менеджеров и логистов - из таблицы заказов (by_manager/by_logist уже
// разделены по ролям при агрегации), план - из "Планы_менеджеров". Один источник
// вместо отдельного листа Менеджеры_данные (см. plans/2026-07-02-manager-revenue-single-source.md).
function buildManagersText() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var ordersData = getOrdersData(ss);
  if (!ordersData || ordersData.error) return '';

  function shortNameOf(name) {
    var parts = String(name || '').replace(/[0-9\+\-\(\)\s]{5,}/g, '').trim().split(' ');
    return parts[0] + (parts[1] ? ' ' + parts[1][0] + '.' : '');
  }

  var managers = (ordersData.by_manager || []).map(function(m) {
    var pct = m.pct || 0;
    var icon = pct >= 80 ? '🟢' : pct >= 50 ? '🟡' : '🔴';
    return { shortName: shortNameOf(m.name), plan: m.plan || 0, fakt: m.amount || 0, pay: m.payment || 0, pct: pct, icon: icon };
  });
  var logists = (ordersData.by_logist || []).map(function(l) {
    return { shortName: shortNameOf(l.name), fakt: l.amount || 0 };
  });

  managers.sort(function(a, b) { return b.pct - a.pct; });

  var mgrTotal = 0, mgrPlan = 0, mgrPay = 0;
  for (var j = 0; j < managers.length; j++) {
    mgrTotal += managers[j].fakt;
    mgrPlan  += managers[j].plan;
    mgrPay   += managers[j].pay;
  }

  var mgrLines = '';
  for (var k = 0; k < managers.length; k++) {
    var m = managers[k];
    mgrLines += m.icon + ' ' + m.shortName + ': ' + m.pct.toFixed(0) + '%\n';
    mgrLines += '   Факт: ' + formatNum(m.fakt) + ' | Оплата: ' + formatNum(m.pay) + '\n';
  }

  var logLines = '';
  for (var l = 0; l < logists.length; l++) {
    logLines += '📦 ' + logists[l].shortName + ': ' + formatNum(logists[l].fakt) + '\n';
  }

  var text = '👥 *Менеджеры по продажам*\n\n';
  text += mgrLines;
  text += '\n📊 Итого:\n';
  text += 'Факт: ' + formatNum(mgrTotal) + ' / ' + formatNum(mgrPlan) + '\n';
  text += 'Оплата: ' + formatNum(mgrPay) + ' | Долг: ' + formatNum(mgrTotal - mgrPay) + '\n';
  text += '\n🚚 *Логисты (внутренние рейсы)*\n';
  text += logLines || 'Нет данных';
  return text;
}



// ============================================================
// ОТПРАВКА В TELEGRAM
// ============================================================
function sendTelegram(text, chatId) {
  const url = `https://api.telegram.org/bot${getTelegramToken_()}/sendMessage`;
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: chatId || CONFIG.TELEGRAM_CHAT_ID,
      text: text,
      parse_mode: 'Markdown'
    })
  });
}

// ============================================================
// УТИЛИТЫ
// ============================================================
function formatNum(n) {
  return Math.round(n).toLocaleString('ru');
}

function extractGosNumber(fullName) {
  const patterns = [
    /[А-ЯA-Z]\d{3}[А-ЯA-Z]{2}\d{3}/i,
    /[А-ЯA-Z]\d{3}[А-ЯA-Z]{2}\d{2}/i,
    /[А-ЯA-Z]{2}\d{3}[А-ЯA-Z]{2}\d{3}/i,
  ];
  for (let p of patterns) {
    const m = fullName.match(p);
    if (m) return m[0];
  }
  const parts = fullName.split(' ');
  for (let i = 0; i < parts.length - 3; i++) {
    if (/^[А-ЯA-Z]$/i.test(parts[i]) &&
        /^\d{3}$/.test(parts[i+1]) &&
        /^[А-ЯA-Z]{2}$/i.test(parts[i+2]) &&
        /^\d{2,3}$/.test(parts[i+3])) {
      return parts[i] + parts[i+1] + parts[i+2] + parts[i+3];
    }
  }
  return '';
}

function formatGosNumber(raw) {
  if (!raw) return '';
  const latToRus = { A:'А',B:'В',E:'Е',K:'К',M:'М',H:'Н',O:'О',P:'Р',C:'С',T:'Т',X:'Х',Y:'У' };
  let cleaned = raw.replace(/[^A-Za-zА-Яа-я0-9]/g, '');
  let result = '';
  for (let ch of cleaned) {
    result += latToRus[ch.toUpperCase()] || ch;
  }
  if (result.length === 9) return `${result[0]} ${result.slice(1,4)} ${result.slice(4,6)} ${result.slice(6,9)}`;
  if (result.length === 10) return `${result.slice(0,2)} ${result.slice(2,5)} ${result.slice(5,7)} ${result.slice(7,10)}`;
  if (result.length === 8) return `${result[0]} ${result.slice(1,4)} ${result.slice(4,6)} ${result.slice(6,8)}`;
  return result;
}

// ============================================================
// НАСТРОЙКА ТРИГГЕРА (запустить один раз вручную)
// ============================================================
// Отладка join: запусти вручную, посмотри в Журнале выполнения
function debugStaffJoin() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  // Ключи из Штатки
  const staffData = getStaffData(ss);
  const staffKeys = Object.keys(staffData).slice(0, 10);
  Logger.log('=== ШТАТКА (первые 10 ключей) ===');
  staffKeys.forEach(function(k) {
    Logger.log(k + ' → тип:' + staffData[k].type + ' статус:' + staffData[k].status);
  });

  // Ключи из Нормализованных данных
  const norm = ss.getSheetByName('Нормализованные_данные');
  if (!norm) { Logger.log('Нет листа Нормализованные_данные'); return; }
  const rows = norm.getRange(2, 1, Math.min(10, norm.getLastRow() - 1), 1).getValues();
  Logger.log('=== НОРМАЛИЗОВАННЫЕ_ДАННЫЕ (первые 10 госномеров) ===');
  rows.forEach(function(r) {
    var gos = String(r[0] || '').trim();
    var key = normalizeGos(gos);
    var found = !!staffData[key];
    Logger.log(gos + ' → ключ:' + key + ' → найдено в Штатке: ' + found);
  });
}

function setupTrigger() {
  // Удаляем все старые триггеры runAll
  ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'runAll'; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });

  // Создаём триггеры на конкретные часы по Москве
  var hours = [10, 12, 14, 16, 18, 20];
  for (var i = 0; i < hours.length; i++) {
    ScriptApp.newTrigger('runAll')
      .timeBased()
      .atHour(hours[i])
      .everyDays(1)
      .inTimezone('Europe/Moscow')
      .create();
  }

  console.log('Триггеры установлены: runAll в 10, 12, 14, 16, 18, 20 по Москве');
}

// ============================================================
// АВТОРИЗАЦИЯ ЧЕРЕЗ GOOGLE — вход + роли (admin / manager)
// ============================================================

// Запустить вручную ОДИН РАЗ. Создаёт лист "Доступ" - туда вписать вручную
// email каждого менеджера, его имя ТОЧНО как оно встречается в заказах
// (колонка "Менеджер по продажам" в 1С, например "Ахтамова Лиана"), и роль.
function setupAccessSheet() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  if (ss.getSheetByName('Доступ')) {
    Logger.log('Лист «Доступ» уже существует - ничего не делаю.');
    return;
  }
  const sheet = ss.insertSheet('Доступ');
  const headers = ['Email', 'Имя менеджера (как в заказах)', 'Роль (admin/manager)'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setColumnWidth(1, 260);
  sheet.setColumnWidth(2, 260);
  sheet.setColumnWidth(3, 170);
  Logger.log('✅ Лист «Доступ» создан. Заполни email/имя/роль вручную (по строке на человека).');
}

// Проверяет id_token через Google, возвращает email (в нижнем регистре) или null.
function verifyGoogleToken_(idToken) {
  if (!idToken) return null;
  try {
    const resp = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
    if (resp.getResponseCode() !== 200) return null;
    const info = JSON.parse(resp.getContentText());
    if (info.aud !== GOOGLE_CLIENT_ID) return null;       // токен выписан не для нашего приложения
    if (!info.email || info.email_verified !== 'true') return null;
    return String(info.email).trim().toLowerCase();
  } catch (e) {
    return null;
  }
}

// Ищет email в листе "Доступ", возвращает {name, role} или null.
function getAccessRole_(ss, email) {
  const sheet = ss.getSheetByName('Доступ');
  if (!sheet || sheet.getLastRow() < 2) return null;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  for (let i = 0; i < data.length; i++) {
    const rowEmail = String(data[i][0] || '').trim().toLowerCase();
    if (rowEmail && rowEmail === email) {
      return {
        name: String(data[i][1] || '').trim(),
        role: String(data[i][2] || '').trim().toLowerCase(),
      };
    }
  }
  return null;
}

// Урезанный набор данных для роли "manager" - только его собственные цифры,
// без доступа к данным других людей и компании в целом.
function getManagerView_(ss, managerName) {
  const orders = getOrdersData(ss);
  if (orders.error) return { error: orders.error };

  const myDetail = (orders.by_manager_detail || {})[managerName] || null;
  // by_manager уже содержит план/факт/% (joinManagerPlans_ внутри getOrdersData) -
  // отдельный поход в Менеджеры_данные больше не нужен, план и факт из одного места.
  const myManagerRow = (orders.by_manager || []).filter(function(m) { return m.name === managerName; });
  const myLogistRow  = (orders.by_logist  || []).filter(function(m) { return m.name === managerName; });

  const detailWrapped = {};
  if (myDetail) detailWrapped[managerName] = myDetail;

  return {
    updated: new Date().toISOString(),
    role: 'manager',
    managerName: managerName,
    managers: myManagerRow,
    orders: {
      period: orders.period,
      by_manager: myManagerRow,
      by_logist: myLogistRow,
      by_manager_detail: detailWrapped,
    },
  };
}

// ============================================================
// API ДЛЯ ДАШБОРДА — читает Штатку для статусов и типов
// ============================================================
// ============================================================
// ОБНОВЛЁННЫЙ doGet — добавить в Apps Script вместо старого
// Изменения: статусы из Штатки (колонка AF) + типы из колонки A
// ============================================================

function doGet(e) {
  const ss = SpreadsheetApp.openById('1jCPRXYDFcTpZIHdJfngZveOQFycu6qbcl-MoXBxtBRM');

  // Вход через Google - без валидного токена и email в листе "Доступ" данных не отдаём
  var idToken = e && e.parameter ? (e.parameter.id_token || '') : '';
  var email = verifyGoogleToken_(idToken);
  if (!email) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'Не авторизован', needLogin: true }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var access = getAccessRole_(ss, email);
  if (!access || !access.role) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'У этого аккаунта нет доступа к дашборду', needLogin: true }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    // Отдельный endpoint для истории по машинам (тяжёлые данные, грузим лениво) - только admin
    var action = e && e.parameter ? (e.parameter.action || '') : '';
    if (action === 'vehicle_history') {
      if (access.role !== 'admin') {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Доступ запрещён' })).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService
        .createTextOutput(JSON.stringify({ history: getVehicleHistory(ss) }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // График в карточке машины: выручка + кол-во заказов по дням за выбранный период
    // (?action=vehicle_orders_history&gos=...&from=YYYY-MM-DD&to=YYYY-MM-DD). Источник - таблица
    // заказов (текущий месяц + архивы), не Нормализованные_данные/История_финансов - у тех
    // может быть лаг в свежести (см. переписку с Владом 2026-07-04 про "Отчет парк"), а тут
    // нужны именно точные дневные цифры за произвольный выбранный период.
    if (action === 'vehicle_orders_history') {
      if (access.role !== 'admin') {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Доступ запрещён' })).setMimeType(ContentService.MimeType.JSON);
      }
      var vohGos = e.parameter.gos || '';
      var vohFrom = e.parameter.from || '';
      var vohTo = e.parameter.to || '';
      if (!vohGos || !/^\d{4}-\d{2}-\d{2}$/.test(vohFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(vohTo)) {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Некорректные параметры' })).setMimeType(ContentService.MimeType.JSON);
      }
      var vohFromP = vohFrom.split('-').map(Number);
      var vohToP = vohTo.split('-').map(Number);
      return ContentService
        .createTextOutput(JSON.stringify({
          days: getVehicleOrdersHistory_(ss, vohGos,
            new Date(vohFromP[0], vohFromP[1] - 1, vohFromP[2]),
            new Date(vohToP[0], vohToP[1] - 1, vohToP[2])),
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Список месяцев, по которым есть архив заказов - для выпадающего списка периода (только admin)
    if (action === 'available_periods') {
      if (access.role !== 'admin') {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Доступ запрещён' })).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService
        .createTextOutput(JSON.stringify({ periods: getAvailablePeriods(ss) }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Данные за прошлый период (вкладки Заказы/Менеджеры/Логисты/Зарплата, только admin)
    if (action === 'orders_period') {
      if (access.role !== 'admin') {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Доступ запрещён' })).setMimeType(ContentService.MimeType.JSON);
      }
      var period = e.parameter.period || '';
      if (!/^\d{4}-\d{2}$/.test(period)) {
        return ContentService
          .createTextOutput(JSON.stringify({ error: 'Некорректный период' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService
        .createTextOutput(JSON.stringify({
          orders:  getOrdersDataForPeriod(ss, period),
          summary: { profit: getGrossProfitForPeriod(ss, period) },
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Отправка отчёта в Telegram-группу логистов (только admin) - через GET, не POST,
    // т.к. браузер блокирует POST на редиректе script.google.com → googleusercontent.com.
    // Текст формирует сам сервер из своих данных - чтобы не передавать длинный текст
    // через адресную строку (URL с кириллицей+токеном входа мог превышать лимит длины).
    if (action === 'send_telegram_logists') {
      if (access.role !== 'admin') {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Доступ запрещён' })).setMimeType(ContentService.MimeType.JSON);
      }
      if (!CONFIG.TELEGRAM_LOGISTS_CHAT_ID) {
        return ContentService.createTextOutput(JSON.stringify({ error: 'TELEGRAM_LOGISTS_CHAT_ID не задан в CONFIG' })).setMimeType(ContentService.MimeType.JSON);
      }
      var ordersForReport = getOrdersData(ss);
      var noWaybillDrivers = (ordersForReport && ordersForReport.by_driver_no_waybill) || [];
      if (!noWaybillDrivers.length) {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Нечего отправлять - все путевые листы сданы' })).setMimeType(ContentService.MimeType.JSON);
      }
      var reportLines = noWaybillDrivers.map(function(d, i) {
        var pct = d.orders > 0 ? Math.round(d.no_waybill / d.orders * 100) : 0;
        return (i+1) + '. ' + d.name + ' — ' + d.no_waybill + ' из ' + d.orders + ' (' + pct + '%)';
      });
      var reportText = '📋 Не сданные путевые листы\n\n' + reportLines.join('\n');
      sendTelegram(reportText, CONFIG.TELEGRAM_LOGISTS_CHAT_ID);
      return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
    }

    // Штатка как рабочий инструмент дашборда (только admin) - см. plans/2026-07-01-shtatka-dashboard-tool.md
    if (action === 'shtatka_grid') {
      if (access.role !== 'admin') {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Доступ запрещён' })).setMimeType(ContentService.MimeType.JSON);
      }
      var shtatkaMonth = e.parameter.month || '';
      if (!/^\d{4}-\d{2}$/.test(shtatkaMonth)) {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Некорректный месяц' })).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify(getShtatkaGridData(ss, shtatkaMonth))).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'shtatka_set_status') {
      if (access.role !== 'admin') {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Доступ запрещён' })).setMimeType(ContentService.MimeType.JSON);
      }
      try {
        setShtatkaStatus(ss, e.parameter.gos, e.parameter.date, e.parameter.status);
        return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
      } catch (shtatkaErr) {
        return ContentService.createTextOutput(JSON.stringify({ error: shtatkaErr.message })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (action === 'shtatka_set_driver') {
      if (access.role !== 'admin') {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Доступ запрещён' })).setMimeType(ContentService.MimeType.JSON);
      }
      try {
        setShtatkaDriver(ss, e.parameter.gos, e.parameter.driver);
        return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
      } catch (shtatkaErr) {
        return ContentService.createTextOutput(JSON.stringify({ error: shtatkaErr.message })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    if (action === 'vehicles_period') {
      if (access.role !== 'admin') {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Доступ запрещён' })).setMimeType(ContentService.MimeType.JSON);
      }
      var vpFrom = e.parameter.from || '';
      var vpTo = e.parameter.to || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(vpFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(vpTo)) {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Некорректный диапазон дат' })).setMimeType(ContentService.MimeType.JSON);
      }
      var vpFromP = vpFrom.split('-').map(Number);
      var vpToP = vpTo.split('-').map(Number);
      var vpStaffData = getStaffData(ss);
      var vpVehicles = aggregateFinHistoryForRange(ss, vpStaffData,
        new Date(vpFromP[0], vpFromP[1] - 1, vpFromP[2]),
        new Date(vpToP[0], vpToP[1] - 1, vpToP[2]));
      return ContentService.createTextOutput(JSON.stringify({
        vehicles: vpVehicles,
        drivers: deriveDriversFromVehicles(vpVehicles)
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Клиентская аналитика: топ-клиенты, win-back, растущие/снижающиеся, сезонность
    // (только admin - см. plans/2026-07-05-client-analytics-on-dashboard.md).
    // Кэш 30 мин (CacheService) - исторический кусок (2020-05.2026) статичен и больше не
    // изменится, а без кэша каждое открытие вкладки заново перечитывает и парсит десятки
    // тысяч строк - именно это делало вкладку медленной (Влад, 2026-07-06).
    // ?from=YYYY-MM-DD&to=YYYY-MM-DD - опциональный период (Влад, 2026-07-06: "должен быть
    // выбор периода") - фильтруем строки ДО расчёта, весь остальной код (топ-клиенты,
    // сегменты, win-back, сезонность) естественно пересчитывается относительно этого куска,
    // т.к. ref_date/period_start и так берутся из переданных rows, а не жёстко "сегодня".
    // ?segment=... - фильтр топ-клиентов по сегменту (см. computeClientAnalytics_).
    if (action === 'client_analytics') {
      if (access.role !== 'admin') {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Доступ запрещён' })).setMimeType(ContentService.MimeType.JSON);
      }
      var caFrom = /^\d{4}-\d{2}-\d{2}$/.test(e.parameter.from || '') ? e.parameter.from : '';
      var caTo   = /^\d{4}-\d{2}-\d{2}$/.test(e.parameter.to || '')   ? e.parameter.to   : '';
      var caSegment = e.parameter.segment || '';
      var caCache = CacheService.getScriptCache();
      // v4 - смена версии ключа специально сбрасывает старый кэш (там мог быть уже
      // закэширован "битый" ответ с невалидными датами до фикса 2026-07-07).
      var caCacheKey = 'client_analytics_v4_' + (caFrom || 'all') + '_' + (caTo || 'all') + '_' + (caSegment || 'all');
      var caCached = caCache.get(caCacheKey);
      if (caCached) {
        return ContentService.createTextOutput(caCached).setMimeType(ContentService.MimeType.JSON);
      }
      // Быстрый путь - предпосчитанный агрегат истории (см. getClientHistoryAggregate_) вместо
      // построчного парсинга 72 тыс. строк. ОТКАТ: если агрегата ещё нет (лист не создан
      // buildClientHistoryAggregate() в таблице "мега база") - используем старый путь как
      // раньше, ничего не падает. Если после появления агрегата что-то пойдёт не так -
      // откатить в 1 строку: заменить caHistAgg на null здесь же.
      var caResult;
      var caHistAgg = getClientHistoryAggregate_();
      if (caHistAgg) {
        var caLiveRows = getClientLiveRows_(ss);
        caResult = computeClientAnalyticsFromAggregate_(caHistAgg, caLiveRows, { segment: caSegment, from: caFrom, to: caTo });
      } else {
        var caRows = getClientAnalyticsRows_(ss);
        if (caFrom) caRows = caRows.filter(function(r) { return r.date >= caFrom; });
        if (caTo)   caRows = caRows.filter(function(r) { return r.date <= caTo; });
        caResult = computeClientAnalytics_(caRows, { segment: caSegment });
      }
      var caJson = JSON.stringify(caResult);
      try { if (caJson.length < 95000) caCache.put(caCacheKey, caJson, 1800); } catch (cacheErr) { /* кэш - не критично, отдаём результат в любом случае */ }
      return ContentService.createTextOutput(caJson).setMimeType(ContentService.MimeType.JSON);
    }

    // Личный профиль менеджера (?action=manager_profile&manager=Цегельников) - только admin,
    // тот же кэш на 30 мин, отдельный ключ на каждого менеджера.
    if (action === 'manager_profile') {
      if (access.role !== 'admin') {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Доступ запрещён' })).setMimeType(ContentService.MimeType.JSON);
      }
      var mpName = e.parameter.manager || '';
      if (!mpName) {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Не указан менеджер' })).setMimeType(ContentService.MimeType.JSON);
      }
      var mpCache = CacheService.getScriptCache();
      var mpCacheKey = 'manager_profile_v2_' + mpName;
      var mpCached = mpCache.get(mpCacheKey);
      if (mpCached) {
        return ContentService.createTextOutput(mpCached).setMimeType(ContentService.MimeType.JSON);
      }
      var mpRows = getClientAnalyticsRows_(ss);
      var mpJson = JSON.stringify(computeManagerProfile_(mpRows, mpName));
      try { if (mpJson.length < 95000) mpCache.put(mpCacheKey, mpJson, 1800); } catch (cacheErr) { /* кэш - не критично */ }
      return ContentService.createTextOutput(mpJson).setMimeType(ContentService.MimeType.JSON);
    }

    // Менеджер - только его собственные данные, без доступа к остальному
    if (access.role === 'manager') {
      return ContentService
        .createTextOutput(JSON.stringify(getManagerView_(ss, access.name)))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const staffData = getStaffData(ss); // читаем Штатку один раз
    // Карта госномер → марка из Штатки (для всех 55 машин, не только с выручкой)
    var staffMarkas = {};
    Object.values(staffData).forEach(function(v) { staffMarkas[v.gosOriginal] = v.marka; });
    var defaultRange = getCurrentMonthRange_();
    var vehiclesData = aggregateFinHistoryForRange(ss, staffData, defaultRange.from, defaultRange.to);
    var ordersData = getOrdersData(ss);
    const data = {
      updated:    new Date().toISOString(),
      role:       'admin',
      summary:    getSummaryData(ss, ordersData),
      vehicles:   vehiclesData,
      drivers:    deriveDriversFromVehicles(vehiclesData),
      fleet:      getFleetStatus(staffData),
      history:    getHistoryData(ss),
      repairs:    getRepairsData(staffData),
      staffMarkas: staffMarkas,
      orders:     ordersData,
    };
    return ContentService
      .createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(e) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Нормализация госномера: убираем пробелы + кириллица→латиница (А=A, В=B и т.д.)
function normalizeGos(gos) {
  return String(gos || '').replace(/\s/g, '').toUpperCase()
    .replace(/А/g,'A').replace(/В/g,'B').replace(/Е/g,'E')
    .replace(/К/g,'K').replace(/М/g,'M').replace(/Н/g,'H')
    .replace(/О/g,'O').replace(/Р/g,'P').replace(/С/g,'C')
    .replace(/Т/g,'T').replace(/У/g,'Y').replace(/Х/g,'X');
}

// Читаем Штатку один раз — возвращаем карту госномер → {type, status, marka}
function getStaffData(ss) {
  const sheet = ss.getSheetByName('Штатка');
  if (!sheet) return {};

  var lastRow = sheet.getLastRow();
  if (lastRow < 6) return {};

  // Строка 5 — заголовки. Ищем колонки динамически,
  // чтобы добавление колонок в исходную таблицу не ломало скрипт.
  var lastCol = sheet.getLastColumn();
  var headerRow = sheet.getRange(5, 1, 1, lastCol).getValues()[0];
  var statusCol = 36; // fallback: AK
  var driverCol = -1; // ВОДИТЕЛЬ 1
  var driver2Col = -1;
  var driver3Col = -1;
  for (var h = 0; h < headerRow.length; h++) {
    var hdr = String(headerRow[h] || '').trim();
    if (hdr === 'Статус на сегодня') statusCol = h;
    if (hdr.toUpperCase() === 'ВОДИТЕЛЬ 1' || hdr.toUpperCase() === 'ВОДИТЕЛЬ') driverCol = h;
    if (hdr.toUpperCase() === 'ВОДИТЕЛЬ 2') driver2Col = h;
    if (hdr.toUpperCase() === 'ВОДИТЕЛЬ 3') driver3Col = h;
  }

  var numCols = Math.max(statusCol + 1, driverCol + 1, driver2Col + 1, driver3Col + 1, 6);
  var data = sheet.getRange(6, 1, lastRow - 5, numCols).getValues();
  var map = {};

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var type       = String(row[0] || '').trim();
    var marka      = String(row[1] || '').trim();
    var gos        = String(row[2] || '').trim();
    var trailerGos = String(row[4] || '').trim();
    var plan       = parseFloat(row[5]) || 0;
    var status     = statusCol < row.length ? String(row[statusCol] || '').trim() : '';
    var driver     = driverCol >= 0 && driverCol < row.length ? String(row[driverCol] || '').trim() : '';
    var driver2    = driver2Col >= 0 && driver2Col < row.length ? String(row[driver2Col] || '').trim() : '';
    var driver3    = driver3Col >= 0 && driver3Col < row.length ? String(row[driver3Col] || '').trim() : '';

    if (!gos || !type) continue;

    var gosClean = normalizeGos(gos);
    map[gosClean] = { type: type, status: status, marka: marka, trailerGos: trailerGos, gosOriginal: gos, plan: plan, driver: driver, driver2: driver2, driver3: driver3, rowIndex: i };
  }
  return map;
}

// ============================================================
// ШТАТКА КАК РАБОЧИЙ ИНСТРУМЕНТ ДАШБОРДА (2026-07-01)
// Ежедневный статус машины хранится в отдельном листе "Штатка_история"
// (Дата | Госномер | Статус) - длинный формат, не "широкая" сетка по дням,
// которая раньше перезатиралась каждый месяц (см. plans/2026-07-01-shtatka-dashboard-tool.md).
// ============================================================

const SHTATKA_HISTORY_SHEET = 'Штатка_история';
const SHTATKA_STATUS_VALUES = ['0','1','2','3','4','5','Р','В','РВ']; // допустимые значения статуса (В = без водителя, реальная буква из Штатки, не Б)

function isValidShtatkaStatus(status) {
  return SHTATKA_STATUS_VALUES.indexOf(String(status || '').trim()) >= 0;
}

// Ищет в шапке Штатки (строка 5) колонки-дни месяца - заголовки вида "01.06.", "15.07." и т.д.
// Позиция этих колонок плавает (зависит от числа дней в месяце), поэтому ищем по паттерну,
// не по фиксированной букве. Год в заголовке не указан - передаём отдельно.
// Ячейка может быть отформатирована как настоящая дата - тогда getValues() отдаёт объект Date,
// а не строку "01.07." - обрабатываем оба варианта.
// Штатка держит фиксированные 31 колонку-день (лишние для короткого месяца сворачиваются,
// не удаляются) - если в такой свёрнутой колонке окажется несуществующая дата (например
// "31.06."), и Date, и сам Sheets молча перекатят её на 1-е число следующего месяца, из-за
// чего дата задвоится с уже существующей реальной колонкой. Берём только первое вхождение
// каждой даты, чтобы такой перекат не создал две записи на одну дату в истории.
function findShtatkaDayColumns(ss) {
  const sheet = ss.getSheetByName('Штатка');
  if (!sheet) return [];
  const lastCol = sheet.getLastColumn();
  const headerRow = sheet.getRange(5, 1, 1, lastCol).getValues()[0];
  const result = [];
  const seen = {};
  for (let h = 0; h < headerRow.length; h++) {
    const raw = headerRow[h];
    let day, month;
    if (raw instanceof Date) {
      day = raw.getDate();
      month = raw.getMonth() + 1;
    } else {
      const hdr = String(raw || '').trim();
      const m = hdr.match(/^(\d{2})\.(\d{2})\.?$/);
      if (!m) continue;
      day = parseInt(m[1], 10);
      month = parseInt(m[2], 10);
    }
    const key = month + '-' + day;
    if (seen[key]) continue;
    seen[key] = true;
    result.push({ col: h, day: day, month: month });
  }
  return result;
}

// Разовая миграция: переносит текущую "широкую" сетку Штатки (дни-колонки) в
// Штатка_история. Идемпотентна - сначала чистит целевой месяц, потом пишет заново,
// можно запускать повторно без дублей. Год не хранится в заголовках сетки - передаём явно.
// Кнопка "Выполнить" в редакторе Apps Script не умеет передавать аргументы - при запуске
// оттуда year всегда undefined, поэтому подставляем текущий год по умолчанию.
function migrateShtatkaGridToHistory(year) {
  year = year || new Date().getFullYear();
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Штатка');
  if (!sheet) throw new Error('Лист Штатка не найден');

  const dayCols = findShtatkaDayColumns(ss);
  if (!dayCols.length) throw new Error('Не найдено ни одной колонки-дня в шапке Штатки (строка 5)');

  const staffData = getStaffData(ss); // тот же фильтр, что и везде: есть тип + госномер тягача
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const rows = sheet.getRange(6, 1, lastRow - 5, lastCol).getValues();

  // Собираем затрагиваемые месяцы (обычно один, но код не завязан на это)
  const monthsAffected = {};
  dayCols.forEach(function(dc) { monthsAffected[String(year) + '-' + String(dc.month).padStart(2,'0')] = true; });

  const newRows = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const type = String(row[0] || '').trim();
    const gos  = String(row[2] || '').trim();
    if (!gos || !type) continue; // те же правила, что в getStaffData() - минимум мусора
    const gosClean = normalizeGos(gos);
    if (!staffData[gosClean]) continue; // подстраховка, если фильтр где-то разошёлся

    dayCols.forEach(function(dc) {
      const val = String(row[dc.col] || '').trim();
      if (!val) return; // пустая клетка - нечего переносить
      const dateStr = year + '-' + String(dc.month).padStart(2,'0') + '-' + String(dc.day).padStart(2,'0');
      newRows.push([dateStr, staffData[gosClean].gosOriginal, val]);
    });
  }

  const histSheet = getOrCreateShtatkaHistorySheet(ss);
  removeShtatkaHistoryForMonths(histSheet, Object.keys(monthsAffected));

  if (newRows.length > 0) {
    histSheet.getRange(histSheet.getLastRow() + 1, 1, newRows.length, 3).setValues(newRows);
  }
  Logger.log('✅ Миграция Штатки: перенесено ' + newRows.length + ' записей за ' + Object.keys(monthsAffected).join(', '));
  return newRows.length;
}

function getOrCreateShtatkaHistorySheet(ss) {
  let sheet = ss.getSheetByName(SHTATKA_HISTORY_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SHTATKA_HISTORY_SHEET);
    sheet.getRange(1, 1, 1, 3).setValues([['Дата', 'Госномер', 'Статус']]).setFontWeight('bold');
  }
  return sheet;
}

// Удаляет все строки Штатка_история, чья дата попадает в один из указанных месяцев
// ("2026-07" и т.п.) - нужно для идемпотентности миграции и для перезаписи при setShtatkaStatus.
function removeShtatkaHistoryForMonths(histSheet, monthKeys) {
  const lastRow = histSheet.getLastRow();
  if (lastRow < 2) return;
  const data = histSheet.getRange(2, 1, lastRow - 1, 3).getValues();
  const keep = data.filter(function(r) {
    const dateStr = r[0] instanceof Date ? Utilities.formatDate(r[0], 'Europe/Moscow', 'yyyy-MM-dd') : String(r[0]);
    return monthKeys.indexOf(dateStr.slice(0, 7)) === -1;
  });
  histSheet.getRange(2, 1, lastRow - 1, 3).clearContent();
  if (keep.length > 0) {
    histSheet.getRange(2, 1, keep.length, 3).setValues(keep);
  }
}

// Разовая уборка: первый прогон migrateShtatkaGridToHistory() был запущен кнопкой "Выполнить"
// без аргумента - year получился undefined, и часть строк записалась с датой "undefined-MM-DD".
// Эта функция удаляет такие битые строки. Запустить один раз, затем заново
// migrateShtatkaGridToHistory() (уже с исправленным годом по умолчанию).
function cleanupUndefinedShtatkaHistory() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHTATKA_HISTORY_SHEET);
  if (!sheet) { Logger.log('Лист Штатка_история не найден - нечего чистить'); return 0; }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('Лист пуст - нечего чистить'); return 0; }
  const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  const keep = data.filter(function(r) { return String(r[0]).indexOf('undefined') !== 0; });
  const removed = data.length - keep.length;
  sheet.getRange(2, 1, lastRow - 1, 3).clearContent();
  if (keep.length > 0) sheet.getRange(2, 1, keep.length, 3).setValues(keep);
  Logger.log('🧹 Удалено битых строк: ' + removed + ', осталось корректных: ' + keep.length);
  return removed;
}

// Разовая настройка: ставит два ежедневных триггера (12:00 и 19:00), которые сами гоняют
// migrateShtatkaGridToHistory() - Штатка в вебе теперь просто витрина (Влад работает в
// оригинальной Excel-таблице, данные приходят через IMPORTRANGE), обновляется автоматически,
// без ручных запусков. Идемпотентна - сначала удаляет свои же старые триггеры, чтобы не
// наплодить дублей при повторном запуске. atHour() даёт срабатывание где-то в течение
// указанного часа, не строго в 12:00:00 - это стандартное поведение триггеров Apps Script.
// Время берётся по часовому поясу проекта (Настройки проекта -> Часовой пояс) - если там
// стоит не Europe/Moscow, стоит поправить перед запуском этой функции.
function setupShtatkaAutoMigration() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'migrateShtatkaGridToHistory') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('migrateShtatkaGridToHistory').timeBased().atHour(12).everyDays(1).create();
  ScriptApp.newTrigger('migrateShtatkaGridToHistory').timeBased().atHour(19).everyDays(1).create();
  Logger.log('✅ Настроены автозапуски миграции Штатки: 12:00 и 19:00 ежедневно');
}

// Данные для страницы "Штатка" в дашборде: список машин (парк грузовиков - тралы/длинномеры,
// та же фильтрация, что и везде: тип+госномер тягача обязательны) + статусы за месяц.
// Порядок машин - как в самой Штатке (Влад к нему привык), не пересортировываем.
function getShtatkaGridData(ss, monthKey) {
  const staffData = getStaffData(ss);
  const vehicles = Object.values(staffData)
    .map(function(v) {
      const drivers = [v.driver, v.driver2, v.driver3].filter(function(d) {
        return d && d.toLowerCase() !== 'не требуется';
      });
      const uniqueDrivers = drivers.filter(function(d, i) { return drivers.indexOf(d) === i; });
      return { gos: v.gosOriginal, type: v.type, marka: v.marka, driver: v.driver, trailerGos: v.trailerGos, drivers: uniqueDrivers };
    });

  const histSheet = ss.getSheetByName(SHTATKA_HISTORY_SHEET);
  const grid = {}; // { "О 894 ХМ 797": { "2026-07-01": "Р", ... } }
  if (histSheet && histSheet.getLastRow() > 1) {
    const data = histSheet.getRange(2, 1, histSheet.getLastRow() - 1, 3).getValues();
    data.forEach(function(r) {
      const dateStr = r[0] instanceof Date ? Utilities.formatDate(r[0], 'Europe/Moscow', 'yyyy-MM-dd') : String(r[0]);
      if (dateStr.slice(0, 7) !== monthKey) return;
      const gos = String(r[1] || '').trim();
      const status = String(r[2] || '').trim();
      if (!gos || !status) return;
      if (!grid[gos]) grid[gos] = {};
      grid[gos][dateStr] = status;
    });
  }

  return { vehicles: vehicles, grid: grid };
}

// Запись/обновление статуса одной машины за один день (только admin, см. doGet).
// Валидирует статус - мусор в лист не попадает.
function setShtatkaStatus(ss, gos, dateStr, status) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new Error('Некорректная дата');
  if (!isValidShtatkaStatus(status)) throw new Error('Недопустимый статус: ' + status);
  const gosTrim = String(gos || '').trim();
  if (!gosTrim) throw new Error('Не указан госномер');

  const histSheet = getOrCreateShtatkaHistorySheet(ss);
  const lastRow = histSheet.getLastRow();

  // Ищем существующую строку за эту дату+машину - обновляем, а не плодим дубли
  if (lastRow > 1) {
    const data = histSheet.getRange(2, 1, lastRow - 1, 3).getValues();
    for (let i = 0; i < data.length; i++) {
      const rDate = data[i][0] instanceof Date ? Utilities.formatDate(data[i][0], 'Europe/Moscow', 'yyyy-MM-dd') : String(data[i][0]);
      const rGos  = String(data[i][1] || '').trim();
      if (rDate === dateStr && rGos === gosTrim) {
        histSheet.getRange(i + 2, 3).setValue(status);
        return;
      }
    }
  }
  histSheet.appendRow([dateStr, gosTrim, status]);
}

// Смена водителя на машине (вахта закончилась, пересадка) - это "текущее состояние" машины,
// как и сцепка тягач+прицеп, а не факт за конкретный день. Поэтому пишем прямо в лист Штатка
// (колонка "ВОДИТЕЛЬ 1"), а не в историю - следующий getStaffData()/getShtatkaGridData() сразу
// увидят новое значение.
function setShtatkaDriver(ss, gos, driverName) {
  const gosTrim = String(gos || '').trim();
  if (!gosTrim) throw new Error('Не указан госномер');
  const driverTrim = String(driverName || '').trim();
  if (!driverTrim) throw new Error('Не указан водитель');

  const sheet = ss.getSheetByName('Штатка');
  if (!sheet) throw new Error('Лист Штатка не найден');

  const lastCol = sheet.getLastColumn();
  const headerRow = sheet.getRange(5, 1, 1, lastCol).getValues()[0];
  let driverCol = -1;
  for (let h = 0; h < headerRow.length; h++) {
    const hdr = String(headerRow[h] || '').trim().toUpperCase();
    if (hdr === 'ВОДИТЕЛЬ 1' || hdr === 'ВОДИТЕЛЬ') { driverCol = h; break; }
  }
  if (driverCol < 0) throw new Error('Колонка "ВОДИТЕЛЬ 1" не найдена в шапке Штатки');

  const gosClean = normalizeGos(gosTrim);
  const lastRow = sheet.getLastRow();
  const gosColumn = sheet.getRange(6, 3, lastRow - 5, 1).getValues();
  for (let i = 0; i < gosColumn.length; i++) {
    if (normalizeGos(String(gosColumn[i][0] || '')) === gosClean) {
      sheet.getRange(6 + i, driverCol + 1).setValue(driverTrim);
      return;
    }
  }
  throw new Error('Машина с госномером ' + gosTrim + ' не найдена в Штатке');
}

// Список машин в ремонте из Штатки
function getRepairsData(staffData) {
  const repairs = [];
  const statuses = ['Ремонт', 'ремонт', 'РЕМОНТ'];

  for (const [gos, info] of Object.entries(staffData)) {
    if (statuses.some(s => info.status.includes(s))) {
      repairs.push({
        gos: info.gosOriginal,
        type: info.type,
        status: info.status,
        driver: info.driver,
      });
    }
  }
  return repairs;
}

// Строит массив машин (страница "Техника") за диапазон дат, по месяцам. Для каждого
// затронутого месяца - сначала пробуем "Данные_1С_история" (авторитетно: пишется из
// отдельного письма 1С "за прошлый месяц", см. importParkReports()/writeParkHistoryForMonth_()).
// Если архива за этот месяц ещё нет (обычно - текущий, ещё не завершённый месяц) - откат на
// подневные снимки "Истории_финансов" (последний снимок в диапазоне внутри месяца - снимки
// кумулятивные, не дельта за день). И архив, и снимки хранятся в одном порядке колонок
// ([2]=Тип,[3]=Статус,[4]=Выручка,[5]=ФОТ,[6]=Топливо,[7]=Запчасти,[8]=Штрафы,[9]=Проходные,
// [10]=Валовая прибыль,[11]=План ВП) - можно обрабатывать одинаково независимо от источника.
// Марка/прицеп/водитель - "текущее состояние" из Штатки (staffData), не историзируются.
function aggregateFinHistoryForRange(ss, staffData, fromDate, toDate) {
  var from = new Date(fromDate); from.setHours(0, 0, 0, 0);
  var to = new Date(toDate); to.setHours(23, 59, 59, 999);

  var monthKeys = [];
  var cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cursor <= to) {
    monthKeys.push(cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0'));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  // Данные_1С_история - авторитетный источник для месяцев, где он уже есть
  var parkHistByMonth = {}; // monthKey -> { gos -> row }
  var parkHist = ss.getSheetByName('Данные_1С_история');
  if (parkHist && parkHist.getLastRow() > 1) {
    var phData = parkHist.getRange(2, 1, parkHist.getLastRow() - 1, 12).getValues();
    phData.forEach(function(r) {
      // "Месяц" - Date или текст, см. parkHistMonthKey_ (тот же баг, что уже чинили в
      // writeParkHistoryForMonth_ - без этого archives вообще никогда не совпадали с
      // monthKeys, и авторитетный источник молча не использовался ни разу).
      var mk = parkHistMonthKey_(r[0]);
      if (monthKeys.indexOf(mk) === -1) return;
      var gos = String(r[1] || '').trim();
      if (!gos) return;
      if (!parkHistByMonth[mk]) parkHistByMonth[mk] = {};
      parkHistByMonth[mk][gos] = r;
    });
  }

  // Для месяцев без архива - откат на подневные снимки Истории_финансов
  var monthsNeedingFallback = monthKeys.filter(function(mk) { return !parkHistByMonth[mk]; });
  var fallbackByVehicleMonth = {}; // gos -> { monthKey -> {date, row} }
  if (monthsNeedingFallback.length > 0) {
    var hist = ss.getSheetByName('История_финансов');
    if (hist && hist.getLastRow() > 1) {
      var data = hist.getRange(2, 1, hist.getLastRow() - 1, 12).getValues();
      for (var i = 0; i < data.length; i++) {
        var r = data[i];
        var d = r[0] instanceof Date ? r[0] : new Date(r[0]);
        if (isNaN(d.getTime()) || d < from || d > to) continue;
        var mk = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        if (monthsNeedingFallback.indexOf(mk) === -1) continue;
        var gos = String(r[1] || '').trim();
        if (!gos) continue;
        if (!fallbackByVehicleMonth[gos]) fallbackByVehicleMonth[gos] = {};
        var existing = fallbackByVehicleMonth[gos][mk];
        if (!existing || d > existing.date) fallbackByVehicleMonth[gos][mk] = { date: d, row: r };
      }
    }
  }

  var allGos = {};
  Object.keys(parkHistByMonth).forEach(function(mk) {
    Object.keys(parkHistByMonth[mk]).forEach(function(g) { allGos[g] = true; });
  });
  Object.keys(fallbackByVehicleMonth).forEach(function(g) { allGos[g] = true; });

  // Водитель ЗА ВЫБРАННЫЙ ПЕРИОД, а не сегодняшний живой - Данные_1С_история этого не хранит,
  // поэтому смотрим отдельно в История_финансов (там есть колонка "Водитель" с 2026-07-04) -
  // берём самую позднюю запись внутри диапазона [from, to]. Влад, 2026-07-04: карточка машины
  // должна показывать данные именно за выбранный период, а не "как сейчас".
  var driverByGos = {};
  var histForDriver = ss.getSheetByName('История_финансов');
  if (histForDriver && histForDriver.getLastRow() > 1 && histForDriver.getLastColumn() >= 13) {
    var dData = histForDriver.getRange(2, 1, histForDriver.getLastRow() - 1, 13).getValues();
    for (var di = 0; di < dData.length; di++) {
      var dr = dData[di];
      var dd = dr[0] instanceof Date ? dr[0] : new Date(dr[0]);
      if (isNaN(dd.getTime()) || dd < from || dd > to) continue;
      var dGos = String(dr[1] || '').trim();
      var dDriver = String(dr[12] || '').trim();
      if (!dGos || !dDriver) continue;
      var existingD = driverByGos[dGos];
      if (!existingD || dd > existingD.date) driverByGos[dGos] = { date: dd, driver: dDriver };
    }
  }

  var result = [];
  Object.keys(allGos).forEach(function(gos) {
    var agg = { gos: gos, marka: '', type: '', status: '', revenue: 0, fot: 0, fuel: 0, parts: 0,
      fines: 0, tolls: 0, profit: 0, trailer: '', plan: 0, driver: '' };
    monthKeys.forEach(function(mk) {
      var r = null;
      if (parkHistByMonth[mk] && parkHistByMonth[mk][gos]) {
        r = parkHistByMonth[mk][gos];
      } else if (fallbackByVehicleMonth[gos] && fallbackByVehicleMonth[gos][mk]) {
        r = fallbackByVehicleMonth[gos][mk].row;
      }
      if (!r) return;
      agg.revenue += parseFloat(r[4]) || 0;
      agg.fot     += Math.abs(parseFloat(r[5]) || 0);
      agg.fuel    += Math.abs(parseFloat(r[6]) || 0);
      agg.parts   += Math.abs(parseFloat(r[7]) || 0);
      agg.fines   += Math.abs(parseFloat(r[8]) || 0);
      agg.tolls   += Math.abs(parseFloat(r[9]) || 0);
      agg.profit  += parseFloat(r[10]) || 0;
      agg.plan    += parseFloat(r[11]) || 0;
      // monthKeys в хронологическом порядке - последнее непустое значение перезаписывает
      // предыдущее, то есть в итоге остаётся самое свежее (без отдельного сравнения дат)
      if (r[2]) agg.type = String(r[2]);
      if (r[3]) agg.status = String(r[3]);
    });
    var staffInfo = staffData ? staffData[normalizeGos(gos)] : null;
    if (staffInfo) {
      agg.marka = staffInfo.marka;
      agg.trailer = staffInfo.trailerGos;
      agg.driver = staffInfo.driver; // фолбэк - сегодняшний водитель, если истории ещё нет
    }
    if (driverByGos[gos]) agg.driver = driverByGos[gos].driver; // приоритет - водитель за сам период
    result.push(agg);
  });
  return result;
}

// "Топ" водителей (страница "Водители") - производный от того же массива машин, не отдельный
// лист (раньше читали "ТОП_водителей_по_плану", который 1С обновляет только на текущий месяц -
// источник рассинхрона с "Техникой"). Берём машины с назначенным водителем и планом > 0.
// v.plan - это "План ВП" (валовая прибыль) из Штатки, поэтому факт для сравнения тоже
// должен быть по валовой прибыли (v.profit), а не по выручке - иначе план и факт в разных
// единицах (Влад, 2026-07-02).
function deriveDriversFromVehicles(vehicles) {
  return vehicles
    .filter(function(v) { return v.driver && v.plan > 0; })
    .map(function(v) {
      return { marka: v.marka, gos: v.gos, type: v.type, plan: v.plan, fakt: v.profit,
        pct: v.plan > 0 ? v.profit / v.plan : 0, driver: v.driver };
    })
    .sort(function(a, b) { return b.fakt - a.fakt; });
}

// Диапазон по умолчанию для "Техники"/"Водителей" без выбора периода - с начала текущего
// месяца (по Москве) по сегодня.
function getCurrentMonthRange_() {
  var todayStr = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM-dd');
  var p = todayStr.split('-').map(Number);
  return { from: new Date(p[0], p[1] - 1, 1), to: new Date(p[0], p[1] - 1, p[2]) };
}

// ordersData - уже посчитанный getOrdersData(ss) (с проставленными планами через
// joinManagerPlans_) - передаётся, чтобы не считать заказы дважды за один запрос.
// Продажи менеджеров (salesFakt/salesPlan/salesPayment) теперь считаются из таблицы
// заказов (by_manager) - один источник вместо отдельного листа Менеджеры_данные
// (см. plans/2026-07-02-manager-revenue-single-source.md - раньше давало рассинхрон
// после смены месяца).
function getSummaryData(ss, ordersData) {
  const norm = ss.getSheetByName('Нормализованные_данные');
  if (!norm || norm.getLastRow() < 2) return {};

  const data = norm.getRange(2, 1, norm.getLastRow() - 1, 10).getValues();
  let revenue=0, profit=0, fot=0, fuel=0, parts=0, fines=0, tolls=0, lossCount=0;

  for (let row of data) {
    revenue += parseFloat(row[3]) || 0;
    fot     += parseFloat(row[4]) || 0;
    fuel    += parseFloat(row[5]) || 0;
    parts   += parseFloat(row[6]) || 0;
    fines   += parseFloat(row[7]) || 0;
    tolls   += parseFloat(row[8]) || 0;
    const p  = parseFloat(row[9]) || 0;
    profit  += p;
    if (p < 0) lossCount++;
  }

  const byManager = (ordersData && ordersData.by_manager) || [];
  let totalPlan=0, totalFakt=0, totalPayment=0, totalPayNal=0;
  byManager.forEach(function(m) {
    totalFakt    += m.amount || 0;
    totalPayment += m.payment || 0;
    totalPayNal  += m.cash || 0;
  });
  // План суммируем из ПОЛНОЙ карты планов (managerPlans, не только по_manager) - менеджер без
  // единого заказа в этом периоде иначе тихо теряет план из суммы. НО считаем только АКТИВНЫЕ
  // отделы (те же имена, что в DEPT_CFG на фронтенде, "По менеджерам") - иначе в сумму лезут
  // Рыщанов/Прус-Роскошный/Суркова, чей отдел больше не продаёт, и план на Панели (77.65М)
  // расходится с "По менеджерам" (75М) - см. Влад 2026-07-04.
  const activePlanKeys = ['ахтамова','цегельников','гуштюк','дербенцева','шейко',
    'гусейнова','савиток','филипчук','котельников','гуляева','коньшина','володин',
    'цуцурин','внутренние'];
  const allPlans = (ordersData && ordersData.managerPlans) || {};
  activePlanKeys.forEach(function(k) { totalPlan += allPlans[k] || 0; });

  return {
    revenue, profit, fot, fuel, parts, fines, tolls,
    margin: revenue > 0 ? (profit/revenue*100) : 0,
    lossCount, vehicleCount: data.length,
    salesPlan: totalPlan,
    salesFakt: totalFakt,
    salesPayment: totalPayment,
    salesPayNal: totalPayNal,
    salesPct: totalPlan > 0 ? (totalFakt/totalPlan*100) : 0,
    profitPlan: 50400000, // план ВП из Штатки
  };
}

// staffData — результат getStaffData(ss). Считаем по всему парку (включая машины без выручки).
// Длинномеры = тип начинается на "Борт", всё остальное = тралы.
function getFleetStatus(staffData) {
  var tWork=0, tRepair=0, tNoDrv=0, tNoOrder=0;
  var lWork=0, lRepair=0, lNoDrv=0, lNoOrder=0;

  for (var gos in staffData) {
    var v = staffData[gos];
    var type   = v.type   || '';
    var status = v.status || '';
    var isTruck   = type === 'Борт' || type.indexOf('Борт') === 0;
    var isWork    = status.indexOf('В работе')    >= 0;
    var isRepair  = status.indexOf('Ремонт')      >= 0;
    var isNoDrv   = status.indexOf('Без водителя') >= 0;
    var isNoOrder = status.indexOf('Без заказа')   >= 0;

    if (isTruck) {
      if (isWork) lWork++; else if (isRepair) lRepair++; else if (isNoDrv) lNoDrv++; else if (isNoOrder) lNoOrder++;
    } else {
      if (isWork) tWork++; else if (isRepair) tRepair++; else if (isNoDrv) tNoDrv++; else if (isNoOrder) tNoOrder++;
    }
  }

  return {
    trailers: { total:36, working:tWork, noDriver:tNoDrv, repair:tRepair, noOrder:tNoOrder },
    trucks:   { total:19, working:lWork, noDriver:lNoDrv, repair:lRepair, noOrder:lNoOrder },
  };
}

function getHistoryData(ss) {
  const hist = ss.getSheetByName('История_показателей');
  if (!hist || hist.getLastRow() < 2) return [];
  const lastRow = hist.getLastRow();
  const startRow = Math.max(2, lastRow - 29);
  const data = hist.getRange(startRow, 1, lastRow - startRow + 1, 13).getValues();
  return data
    .filter(row => row[0] instanceof Date)
    .map(row => ({
      date:           new Date(row[0]).toISOString().split('T')[0],
      workTrails:     parseFloat(row[2]) || 0,
      repairTrails:   parseFloat(row[3]) || 0,
      noDriverTrails: parseFloat(row[4]) || 0,
      workTrucks:     parseFloat(row[8]) || 0,
      repairTrucks:   parseFloat(row[9]) || 0,
      noDriverTrucks: parseFloat(row[10])|| 0,
    }));
}

// История по машинам — для вкладки Динамика (?action=vehicle_history)
function getVehicleHistory(ss) {
  var hist = ss.getSheetByName('История_финансов');
  if (!hist || hist.getLastRow() < 2) return [];
  var lastRow = hist.getLastRow();
  var lastCol = Math.min(hist.getLastColumn(), 13);
  var data = hist.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var result = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (!(row[0] instanceof Date) || !String(row[1] || '').trim()) continue;
    result.push({
      date:    Utilities.formatDate(row[0], 'Europe/Moscow', 'yyyy-MM-dd'),
      gos:     String(row[1] || '').trim(),
      type:    String(row[2] || ''),
      status:  String(row[3] || ''),
      revenue: parseFloat(row[4]) || 0,
      fot:     Math.abs(parseFloat(row[5]) || 0),
      fuel:    Math.abs(parseFloat(row[6]) || 0),
      parts:   Math.abs(parseFloat(row[7]) || 0),
      fines:   Math.abs(parseFloat(row[8]) || 0),
      tolls:   Math.abs(parseFloat(row[9]) || 0),
      profit:  parseFloat(row[10]) || 0,
      plan:    parseFloat(row[11]) || 0,
      driver:  String(row[12] || '').trim(),
    });
  }
  return result;
}

// Выручка + количество заказов по дням для конкретной машины за произвольный диапазон дат -
// для графика в карточке машины (см. vehicle_orders_history выше). Источник - таблица заказов
// (текущий месяц "Заказы_данные" + архивы "Заказы_YYYY-MM"), госномер матчим по полю "Машина"
// (там полное описание техники, гос.номер внутри строки - та же логика, что и в normalizeReport()).
function getVehicleOrdersHistory_(ss, gos, fromDate, toDate) {
  var gosClean = normalizeGos(gos);
  var from = new Date(fromDate); from.setHours(0, 0, 0, 0);
  var to = new Date(toDate); to.setHours(23, 59, 59, 999);

  var monthKeys = [];
  var cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cursor <= to) {
    monthKeys.push(cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0'));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  var currentMonthKey = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM');
  var byDate = {}; // date -> {date, revenue, orders}

  monthKeys.forEach(function(mk) {
    var rows;
    if (mk === currentMonthKey) {
      var live = ss.getSheetByName(ORDERS_NORM_SHEET);
      if (!live || live.getLastRow() < 2) return;
      rows = live.getRange(2, 1, live.getLastRow() - 1, 43).getValues();
    } else {
      var archive = ss.getSheetByName(ORDERS_ARCHIVE_PFX + mk);
      if (!archive || archive.getLastRow() < 5) return;
      rows = parseOrdersRawRows(archive.getDataRange().getValues()).rows;
    }
    rows.forEach(function(row) {
      var machine = String(row[23] || '');
      var rawGos = extractGosNumber(machine);
      if (!rawGos || normalizeGos(rawGos) !== gosClean) return;
      var rawDate = row[2]; // "Начало работ"
      var dateStr = rawDate instanceof Date
        ? Utilities.formatDate(rawDate, 'Europe/Moscow', 'yyyy-MM-dd')
        : String(rawDate || '').trim();
      if (!dateStr) return;
      var d = new Date(dateStr + 'T00:00:00');
      if (isNaN(d.getTime()) || d < from || d > to) return;
      if (!byDate[dateStr]) byDate[dateStr] = { date: dateStr, revenue: 0, orders: 0 };
      byDate[dateStr].revenue += ordParseNum(row[30]);
      byDate[dateStr].orders++;
    });
  });

  return Object.values(byDate).sort(function(a, b) { return a.date.localeCompare(b.date); });
}

// Валовая прибыль своего парка за прошлый период (для зарплаты Рыщанова на вкладке "Зарплата"
// при выборе периода). Берёт последний день внутри месяца - там накопительный итог за весь месяц.
function getGrossProfitForPeriod(ss, period) {
  var hist = ss.getSheetByName('История_финансов');
  if (!hist || hist.getLastRow() < 2) return null;
  var lastRow = hist.getLastRow();
  var data = hist.getRange(2, 1, lastRow - 1, 11).getValues();

  var lastDateKey = '';
  var sumByDate = {};
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (!(row[0] instanceof Date)) continue;
    var dateKey = Utilities.formatDate(row[0], 'Europe/Moscow', 'yyyy-MM-dd');
    if (dateKey.slice(0, 7) !== period) continue;
    if (!sumByDate[dateKey]) sumByDate[dateKey] = 0;
    sumByDate[dateKey] += parseFloat(row[10]) || 0;
    if (dateKey > lastDateKey) lastDateKey = dateKey;
  }
  return lastDateKey ? sumByDate[lastDateKey] : null;
}

// ============================================================
// МОДУЛЬ ЗАКАЗОВ (встроен из orders_module.js)
// ============================================================

// ============================================================
// МОДУЛЬ ЗАКАЗОВ — orders_module.js
// Подключается к full_script_final.js автоматически (общее пространство GAS).
//
// Что добавить в full_script_final.js:
//   runAll()  → вызовы importOrdersReport() и normalizeOrders()
//   doGet()   → orders: getOrdersData(ss)
// ============================================================

// ── КОНФИГУРАЦИЯ ────────────────────────────────────────────
const ORDERS_GMAIL_QUERY  = 'subject:"Рассылка Отчет таблица заказов" has:attachment newer_than:3d';
const ORDERS_RAW_SHEET    = 'Заказы_сырые';
const ORDERS_NORM_SHEET   = 'Заказы_данные';
const ORDERS_ARCHIVE_PFX  = 'Заказы_';   // + YYYY-MM, например «Заказы_2026-05»

// Внутренние заказчики — выручка есть, поступлений нет; считаем отдельно
const INTERNAL_CLIENTS = [
  'ТЕХНО ПАРК', 'ОТДЕЛ БУРОВЫХ РАБОТ', 'КРАНМАСТЕР',
  'МЕГАКРАН', 'БАЗА ДМД', 'БУЛЬДОГ ООО', 'БАЗА',
  'УМИАТ ЯРД', // Влад, 2026-07-05: тег "(НАШ)" в 1С, найдено при анализе клиентской базы
  'ОТДЕЛ ЭКСКАВАТОРОВ ДМД', 'ОТДЕЛ КРАНОВ ДМД', 'ТД ЯРД' // Влад, 2026-07-06: старые внутренние КА, сейчас это ТЕХНО ПАРК (НАШ)
];

// Менеджеры отдела — для фильтрации чужих строк
const TRAL_MANAGERS = [
  'Ахтамова', 'Гусейнова', 'Цуцурин',
  'Котельников', 'Цегельников', 'Гуляева', 'Гуштюк',
  'Дербенцева', 'Савиток', 'Филипчук', 'Шейко',
  'Коньшина', 'Володин', 'Прус-Роскошный',
  'Рыщанов', 'Суркова'
];

// Логисты отдела (Прус-Роскошный — двойная роль)
const TRAL_LOGISTS = [
  'Васин', 'Кан', 'Махура', 'Сильчев',
  'Прус-Роскошный', 'Рыщанов', 'Ахтамова', 'Гусейнова'
];

// ── ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ─────────────────────────────────

// Груз в 1С - свободный текст ("Экскаватор Hitachi", "экскав.", "Экск-р").
// Сводим к категории по ключевому слову, чтобы в топе грузов не было дублей.
// Порядок важен: более узкие слова проверяем раньше (автокран до крана).
const CARGO_KEYWORDS = [
  { cat: 'Кран',              words: ['кран', 'автокран', 'гусеничный кран'] },
  { cat: 'Экскаватор',        words: ['экскав', 'эксков'] },
  { cat: 'Бульдозер',         words: ['бульдоз', 'бульдоз'] },
  { cat: 'Погрузчик',         words: ['погрузчик', 'фронтальн'] },
  { cat: 'Каток',             words: ['каток'] },
  { cat: 'Грейдер',           words: ['грейдер', 'автогрейдер'] },
  { cat: 'Самосвал',          words: ['самосвал'] },
  { cat: 'Трактор',           words: ['трактор'] },
  { cat: 'Буровая установка', words: ['буров', 'бур установ', 'убр', 'бкм'] },
  { cat: 'Трубоукладчик',     words: ['трубоуклад'] },
  { cat: 'Бытовка / вагон',   words: ['бытов', 'вагон', 'блок-контейнер', 'модул'] },
  { cat: 'Ёмкость / резервуар', words: ['ёмкост', 'емкост', 'резервуар', 'цистерн'] },
  { cat: 'Трубы',             words: ['труб'] },
  { cat: 'Плиты / блоки',     words: ['плит', 'блок фбс', 'жби'] },
  { cat: 'Сваи',              words: ['свая', 'свай'] },
  { cat: 'Генератор / ДГУ',   words: ['генератор', 'дгу', 'дизельн'] },
  { cat: 'Опалубка',          words: ['опалубк'] },
  { cat: 'Металлоконструкции', words: ['металлоконстр', 'м/к', 'мк '] },
];

function normalizeCargo(text) {
  const t = String(text || '').trim();
  if (!t) return 'Прочие грузы';   // пустой груз - в общую корзину
  const low = t.toLowerCase();
  for (let i = 0; i < CARGO_KEYWORDS.length; i++) {
    const words = CARGO_KEYWORDS[i].words;
    for (let j = 0; j < words.length; j++) {
      if (low.indexOf(words[j]) >= 0) return CARGO_KEYWORDS[i].cat;
    }
  }
  // Не распознали (сборная солянка) - тоже в "Прочие грузы"
  return 'Прочие грузы';
}

function ordCleanName(fullName) {
  return String(fullName || '')
    .replace(/\+?[78][\d\s\-\(\)]{8,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ordParseNum(val) {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

function ordExtractPeriodMonth(rowArr) {
  for (const cell of rowArr) {
    const s = String(cell || '');
    // Ищем паттерн ДД.ММ.ГГГГ
    const m = s.match(/\d{2}\.(\d{2})\.(\d{4})/);
    if (m) return m[2] + '-' + m[1];   // "2026-06"
  }
  return null;
}

function ordFormatDate(val) {
  if (!val) return '';
  // instanceof Date может не сработать для значений, пришедших через
  // SpreadsheetApp.openById() (чужая таблица) - на практике поймали 2026-07-07 случай,
  // когда дата дошла до фронтенда как "Wed Sep 30 2020 10:00:00 GMT+0300..." (типичный
  // Date.prototype.toString()), а не как чистая строка - похоже, объект не прошёл
  // instanceof-проверку. Доп. проверка по "утиной типизации" - безопасна, ничего не меняет
  // для обычных строк (у них просто нет getFullYear/getMonth/getDate).
  const looksLikeDate = val instanceof Date ||
    (typeof val === 'object' && typeof val.getFullYear === 'function' &&
     typeof val.getMonth === 'function' && typeof val.getDate === 'function');
  if (looksLikeDate) {
    return Utilities.formatDate(val, 'Europe/Moscow', 'yyyy-MM-dd');
  }
  const s = String(val);
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  return s;
}

function ordMonthKey(val) {
  const d = ordFormatDate(val);
  return d ? d.slice(0, 7) : '';  // "2026-06"
}

function ordInList(name, list) {
  const n = String(name || '');
  return list.some(function(m) { return n.indexOf(m) >= 0; });
}

// Разбивает сырые данные отчёта на группы по месяцу (ключ - "2026-06" и т.д.),
// используя ту же колонку "Начало работ", что и normalizeOrders() при подсчёте monthKey.
// Нужна с тех пор, как 1С стала слать отчёт за 2 месяца сразу (прошлый + текущий) -
// раньше в файле был ровно один месяц, теперь может быть несколько.
// Возвращает {} если формат файла не распознан (нет строки заголовков на нужном месте).
// Обычно заголовки колонок - строка 4 (индекс 3), первые 3 строки - "Параметры:"/"Отбор:"/
// пусто. Но у архива "Заказы_2026-06" эти 3 строки оказались потеряны (заголовки лежали в
// строке 1) - из-за этого parseOrdersRawRows/splitOrdersRawByMonth брали ЗА ЗАГОЛОВКИ
// строку с реальными данными, ни одна колонка не находилась, и весь месяц молча
// распознавался как пустой (Влад, 2026-07-04: "выбираю июнь на Зарплате - не подтягивается").
// Ищем строку заголовков по содержимому (есть "Номер" и "Заказчик"), а не по фиксированному
// индексу - устойчиво к обоим вариантам структуры.
function findOrdersHeaderRowIndex_(allData) {
  var limit = Math.min(allData.length, 10);
  for (var i = 0; i < limit; i++) {
    var row = allData[i] || [];
    var hasNomer = false, hasZakazchik = false;
    for (var j = 0; j < row.length; j++) {
      var cell = String(row[j] || '').trim();
      if (cell === 'Номер') hasNomer = true;
      if (cell === 'Заказчик') hasZakazchik = true;
    }
    if (hasNomer && hasZakazchik) return i;
  }
  return 3; // не нашли по содержимому - старое поведение как подстраховка
}

function splitOrdersRawByMonth(data) {
  if (!data || data.length < 5) return {};
  const headerRowIdx = findOrdersHeaderRowIndex_(data);
  const headerRow = data[headerRowIdx];
  const col = {};
  headerRow.forEach(function(h, i) { const key = String(h || '').trim(); if (key) col[key] = i; });
  const dateColIdx = col['Начало работ'];
  if (dateColIdx === undefined) return {};

  const buckets = {};
  for (let i = headerRowIdx + 1; i < data.length; i++) {
    const month = ordMonthKey(data[i][dateColIdx]);
    if (!month) continue; // строка без даты - пропускаем, к месяцам не относится
    if (!buckets[month]) buckets[month] = [];
    buckets[month].push(data[i]);
  }
  return buckets;
}

// ── ИМПОРТ: Gmail → Заказы_сырые ────────────────────────────

function importOrdersReport() {
  const threads = GmailApp.search(ORDERS_GMAIL_QUERY);
  if (!threads.length) throw new Error('Письмо заказов не найдено за 3 дня');

  const msgs = [];
  for (const t of threads) for (const m of t.getMessages()) msgs.push(m);
  msgs.sort(function(a, b) { return a.getDate() - b.getDate(); });
  const latest = msgs[msgs.length - 1];

  let att = null;
  for (const a of latest.getAttachments()) {
    if (a.getName().endsWith('.xlsx') || a.getName().endsWith('.xls')) { att = a; break; }
  }
  if (!att) throw new Error('Excel-вложение заказов не найдено');

  // Конвертируем xlsx → Google Sheets временный файл
  const tmp = Drive.Files.insert(
    { title: 'tmp_orders_' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS },
    att.copyBlob()
  );
  const data = SpreadsheetApp.openById(tmp.id).getSheets()[0].getDataRange().getValues();
  Drive.Files.remove(tmp.id);

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  // С 1С теперь может приходить сразу несколько месяцев в одном файле (прошлый + текущий -
  // окно для коррекций до 5-6 числа). Определяем, сколько разных месяцев реально в файле.
  const monthBuckets = splitOrdersRawByMonth(data);
  const monthsPresent = Object.keys(monthBuckets).sort(); // по возрастанию "2026-06" < "2026-07"

  if (monthsPresent.length > 1) {
    // Несколько месяцев в одном файле - разносим каждый в свой лист.
    // Самый поздний месяц = текущий рабочий (живая таблица), остальные - обновление архивов
    // (именно то, что нужно для коррекций прошлого месяца в начале следующего).
    const liveMonth = monthsPresent[monthsPresent.length - 1];
    // Строки до заголовков включительно (обычно 1-4) - общие для всех кусков. По индексу,
    // найденному по содержимому (см. findOrdersHeaderRowIndex_), а не жёстко "4" - иначе при
    // сдвинутой структуре архив получает те же битые заголовки, что уже ловили на "Заказы_2026-06".
    const headerRows = data.slice(0, findOrdersHeaderRowIndex_(data) + 1);

    monthsPresent.forEach(function(month) {
      const monthData = headerRows.concat(monthBuckets[month]);
      if (month === liveMonth) {
        let raw = ss.getSheetByName(ORDERS_RAW_SHEET);
        if (raw) raw.clear();
        else      raw = ss.insertSheet(ORDERS_RAW_SHEET);
        raw.getRange(1, 1, monthData.length, monthData[0].length).setValues(monthData);
        Logger.log('✅ Текущий месяц ' + month + ': ' + monthBuckets[month].length + ' строк -> живая таблица');
      } else {
        writeArchiveSheet(ss, ORDERS_ARCHIVE_PFX + month, monthData);
        Logger.log('✅ Обновлён архив ' + month + ': ' + monthBuckets[month].length + ' строк');
      }
    });

    latest.markRead();
    Logger.log('✅ Заказы импортированы (отчёт за несколько месяцев): ' + monthsPresent.join(', '));
    return;
  }

  // Один месяц в файле (или формат не распознан splitOrdersRawByMonth) - старое поведение,
  // без изменений: обычная архивация при переходе на новый месяц / поздняя коррекция.
  const archiveResult = archiveOrdersIfNeeded(ss, data);
  if (archiveResult.action === 'archive_only') {
    // Запоздавшая коррекция за уже прошедший месяц - текущую (живую) таблицу не трогаем,
    // обновлён только архив прошлого месяца. См. archiveOrdersIfNeeded().
    Logger.log('Поздняя коррекция за ' + archiveResult.month + ' - архив обновлён, текущий месяц не тронут');
    latest.markRead();
    return;
  }

  let raw = ss.getSheetByName(ORDERS_RAW_SHEET);
  if (raw) raw.clear();
  else      raw = ss.insertSheet(ORDERS_RAW_SHEET);

  if (data.length > 0) {
    raw.getRange(1, 1, data.length, data[0].length).setValues(data);
  }

  latest.markRead();
  Logger.log('✅ Заказы импортированы: ' + data.length + ' строк, письмо от ' + latest.getDate());
}

// ── АРХИВАЦИЯ при смене месяца ───────────────────────────────

// Возвращает { action: 'normal' } если можно обычным образом перезаписать живую таблицу,
// или { action: 'archive_only', month } если это запоздавшая коррекция за прошедший месяц -
// тогда живую таблицу трогать нельзя, нужно только обновить архив этого месяца.
function archiveOrdersIfNeeded(ss, newData) {
  const raw = ss.getSheetByName(ORDERS_RAW_SHEET);
  if (!raw || raw.getLastRow() < 5) return { action: 'normal' };

  // Строка 2 в сыром листе содержит период
  const existingPeriodRow = raw.getRange(2, 1, 1, 10).getValues()[0];
  const existingMonth     = ordExtractPeriodMonth(existingPeriodRow);
  const newMonth          = ordExtractPeriodMonth(newData[1] || []);

  if (!existingMonth || !newMonth || existingMonth === newMonth) return { action: 'normal' };

  if (newMonth < existingMonth) {
    // Пришедший отчёт за месяц РАНЬШЕ текущего живого - это поздняя коррекция
    // (бухгалтерия ещё доделывает прошлый месяц). Текущий месяц на дашборде не трогаем,
    // только обновляем архив того прошлого месяца свежими цифрами.
    writeArchiveSheet(ss, ORDERS_ARCHIVE_PFX + newMonth, newData);
    return { action: 'archive_only', month: newMonth };
  }

  // newMonth > existingMonth - обычный переход на новый месяц
  const archiveName = ORDERS_ARCHIVE_PFX + existingMonth;
  if (!ss.getSheetByName(archiveName)) {
    const existing = raw.getDataRange().getValues();
    writeArchiveSheet(ss, archiveName, existing);
    Logger.log('✅ Архив создан: ' + archiveName + ' (' + existing.length + ' строк)');
  }
  return { action: 'normal' };
}

function writeArchiveSheet(ss, archiveName, data) {
  let archive = ss.getSheetByName(archiveName);
  if (archive) archive.clear();
  else archive = ss.insertSheet(archiveName);
  if (data.length > 0) {
    archive.getRange(1, 1, data.length, data[0].length).setValues(data);
  }
}

// ── НОРМАЛИЗАЦИЯ: Заказы_сырые → Заказы_данные ──────────────

function normalizeOrders() {
  const ss  = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const raw = ss.getSheetByName(ORDERS_RAW_SHEET);
  if (!raw || raw.getLastRow() < 5) throw new Error('Нет сырых данных заказов');

  const parsed = parseOrdersRawRows(raw.getDataRange().getValues());

  let norm = ss.getSheetByName(ORDERS_NORM_SHEET);
  if (norm) norm.clear();
  else       norm = ss.insertSheet(ORDERS_NORM_SHEET);

  norm.getRange(1, 1, 1, parsed.headers.length)
      .setValues([parsed.headers])
      .setFontWeight('bold')
      .setBackground('#1e1e26')
      .setFontColor('#888780');

  if (parsed.rows.length > 0) {
    norm.getRange(2, 1, parsed.rows.length, parsed.headers.length).setValues(parsed.rows);
    // Числовые колонки: Сумма → Оплачено поставщику (колонки 31-40, индексы 30-39)
    norm.getRange(2, 31, parsed.rows.length, 10).setNumberFormat('#,##0');
  }

  norm.setFrozenRows(1);
  norm.autoResizeColumns(1, 7);

  Logger.log('✅ Заказы нормализованы: ' + parsed.rows.length + ' строк в ' + ORDERS_NORM_SHEET);
}

// Чистая функция: сырые строки (как из Заказы_сырые или архива Заказы_YYYY-MM) -> нормализованные.
// Не трогает листы - используется и для текущего месяца, и для разбора архивов "на лету".
function parseOrdersRawRows(allData) {
  if (!allData || allData.length < 5) return { headers: [], rows: [] };

  // Обычно заголовки колонок - строка 4 (индекс 3), но см. findOrdersHeaderRowIndex_ -
  // ищем по содержимому, не по фиксированному индексу.
  const headerRowIdx = findOrdersHeaderRowIndex_(allData);
  const headerRow = allData[headerRowIdx];
  const col = {};
  headerRow.forEach(function(h, i) {
    const key = String(h || '').trim();
    if (key) col[key] = i;
  });

  // Геттеры по имени колонки
  const g   = function(row, name) { const i = col[name]; return i !== undefined ? row[i] : null; };
  const str = function(row, name) { return String(g(row, name) || '').trim(); };
  const num = function(row, name) { return ordParseNum(g(row, name)); };
  const boo = function(row, name) { return str(row, name) === 'Да'; };

  const normHeaders = [
    'Номер заказа', 'Дата создания', 'Начало работ', 'Окончание работ',
    'Тип оплаты', 'Проведен', 'Путевка', 'Есть реализация', 'Оригинал получен',
    'Заказчик', 'Организация (наша)', 'Подразделение', 'Код подразд.', 'Внутренний',
    'Отдел', 'Менеджер продаж', 'Менеджер снабжения', 'Старший менеджер',
    'Ответственный', 'Водитель',
    'Тип техники', 'Единица', 'Кол-во', 'Машина', 'Груз', 'Оборудование', 'Адрес',
    'Найм', 'Стоимость найма', 'Часы найма',
    'Сумма', 'Оплата итого', 'Оплата нал', 'Оплата ПП', 'Поступление',
    'Прибыль', 'Прибыль от мин. прайса', 'Остаток', 'Баланс орг.', 'Оплачено поставщику',
    'Договор', 'Отдел траллов', 'Месяц'
  ];

  const rows = [];

  for (let i = headerRowIdx + 1; i < allData.length; i++) {
    const row = allData[i];

    const orderId = str(row, 'Номер');
    if (!orderId) continue;
    if (boo(row, 'Пометка удаления')) continue;

    const manSales  = str(row, 'Менеджер по продажам');
    const manSupply = str(row, 'Менеджер по снабжению');

    // Фильтр: хотя бы один из менеджеров — наш сотрудник
    const isTralDept = ordInList(manSales, TRAL_MANAGERS) || ordInList(manSupply, TRAL_LOGISTS);
    if (!isTralDept) continue;

    const customer   = str(row, 'Заказчик');
    const divRaw     = str(row, 'Подразделение');
    const divCode    = divRaw.replace(/\..+/, '').trim();  // "01", "05", "08"
    const isInternal = ordInList(customer, INTERNAL_CLIENTS);

    // Статус реализации: текст начинается с "Реализация" → документ создан
    const realizRef  = str(row, 'Реализация');
    const hasRealiz  = realizRef.indexOf('Реализация') === 0;

    // Статус путевки: Нет или пусто → нет путевки
    const waybillVal = str(row, 'Путевка');
    const hasWaybill = waybillVal !== 'Нет' && waybillVal !== '';

    // Найм: Привлеченная техника — Нет/пусто → нет найма
    const hiredRaw   = str(row, 'Привлеченная техника');
    const isHired    = hiredRaw !== 'Нет' && hiredRaw !== '';

    // Дата начала работ для месяца
    const dateStart  = g(row, 'Начало работ');
    const monthKey   = ordMonthKey(dateStart);

    rows.push([
      orderId,
      ordFormatDate(g(row, 'Дата')),
      ordFormatDate(dateStart),
      ordFormatDate(g(row, 'Окончание работ')),
      str(row, 'Оплата'),
      str(row, 'Проведен'),
      hasWaybill ? 'Да' : 'Нет',
      hasRealiz  ? 'Да' : 'Нет',
      str(row, 'Оригинал получен'),
      customer,
      str(row, 'Организация'),
      divRaw,
      divCode,
      isInternal ? 'Да' : 'Нет',
      str(row, 'Отдел'),
      ordCleanName(manSales),
      ordCleanName(manSupply),
      ordCleanName(str(row, 'Старший менеджер')),
      ordCleanName(str(row, 'Ответственный')),
      ordCleanName(str(row, 'Водитель')),
      str(row, 'Тип техники'),
      str(row, 'Единица измерения'),
      num(row, 'Часы'),
      str(row, 'Данные по машине'),
      str(row, 'Груз'),
      str(row, 'Оборудование техники'),
      str(row, 'Адрес объекта'),
      isHired ? hiredRaw : 'Нет',  // храним имя поставщика, не 'Да'
      num(row, 'Стоимость привлеченной техники'),
      num(row, 'Часы привлеченной техники'),
      num(row, 'Сумма'),
      num(row, 'Сумма оплаты'),
      num(row, 'Сумма оплаты нал'),
      num(row, 'Сумма оплаты по ПП'),
      num(row, 'Поступление'),
      num(row, 'Прибыль'),
      num(row, 'Прибыль от мин. прайса'),
      num(row, 'Сумма остаток'),
      num(row, 'Баланс по организации'),
      num(row, 'Поставщику оплачено'),
      str(row, 'Договор'),
      isTralDept ? 'Да' : 'Нет',
      monthKey
    ]);
  }

  return { headers: normHeaders, rows: rows };
}

// ── API ДЛЯ ДАШБОРДА ─────────────────────────────────────────
// Вызывается из doGet() основного скрипта: orders: getOrdersData(ss)

function getOrdersData(ss) {
  const norm = ss.getSheetByName(ORDERS_NORM_SHEET);
  if (!norm || norm.getLastRow() < 2) return { error: 'Нет данных заказов' };

  const rows = norm.getRange(2, 1, norm.getLastRow() - 1, 43).getValues();
  const result = aggregateOrdersRows(rows);
  const monthKey = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM');
  const smartLost = computeLostCustomers_(ss, rows, monthKey);
  if (smartLost) result.lost_customers = smartLost;
  return joinManagerPlans_(ss, result, monthKey);
}

// Архивные данные за прошлый период (?action=orders_period&period=YYYY-MM)
function getOrdersDataForPeriod(ss, period) {
  const sheetName = ORDERS_ARCHIVE_PFX + period;
  const archive = ss.getSheetByName(sheetName);
  if (!archive || archive.getLastRow() < 5) return { error: 'Нет архива за ' + period };

  const parsed = parseOrdersRawRows(archive.getDataRange().getValues());
  if (parsed.rows.length === 0) return { error: 'Архив за ' + period + ' пуст' };
  const result = aggregateOrdersRows(parsed.rows);
  const smartLost = computeLostCustomers_(ss, parsed.rows, period);
  if (smartLost) result.lost_customers = smartLost;
  return joinManagerPlans_(ss, result, period);
}

// Клиенты, у которых давно не было заказов - используем и текущий, и прошлый месяц (архив
// "Заказы_YYYY-MM"), чтобы не путать "ещё не успел заказать в начале месяца" с реально
// пропавшим клиентом. Раньше "пропавшие" считались только как "1-я половина месяца была,
// 2-й нет" - в начале нового месяца это давало почти всех клиентов подряд (2-й половины
// просто ещё не было). Влад, 2026-07-04: "у нас теперь есть два месяца, может эффективнее
// отражать". Если архива за прошлый месяц ещё нет - возвращаем null, вызывающий код
// оставит старую (внутримесячную) эвристику из aggregateOrdersRows.
function computeLostCustomers_(ss, currentRows, monthKey) {
  const parts = String(monthKey || '').split('-');
  let py = parseInt(parts[0], 10), pm = parseInt(parts[1], 10) - 1;
  if (!py || !pm) return null;
  if (pm < 1) { pm = 12; py -= 1; }
  const prevMonthKey = py + '-' + String(pm).padStart(2, '0');
  const prevSheet = ss.getSheetByName(ORDERS_ARCHIVE_PFX + prevMonthKey);
  if (!prevSheet || prevSheet.getLastRow() < 5) return null;
  const prevRows = parseOrdersRawRows(prevSheet.getDataRange().getValues()).rows;
  if (!prevRows.length) return null;

  // Индексы колонок те же, что и C-карта в aggregateOrdersRows: customer:9, internal:13,
  // mgr_s:15, date_s:2, amount:30.
  const custMap = {};
  function ingest(rows) {
    rows.forEach(function(row) {
      if (String(row[13] || '').trim() === 'Да') return; // внутренние перевозки не считаем
      const cust = String(row[9] || '').trim();
      if (!cust) return;
      const rawDate = row[2];
      const dateStr = rawDate instanceof Date
        ? Utilities.formatDate(rawDate, 'Europe/Moscow', 'yyyy-MM-dd')
        : String(rawDate || '').trim();
      if (!custMap[cust]) custMap[cust] = { name: cust, last_date: '', mgr: '', orders_total: 0, amount_total: 0 };
      const c = custMap[cust];
      c.orders_total++;
      c.amount_total += ordParseNum(row[30]);
      if (dateStr && dateStr > c.last_date) { c.last_date = dateStr; c.mgr = String(row[15] || '').trim(); }
    });
  }
  ingest(prevRows);
  ingest(currentRows);

  const today = new Date();
  return Object.values(custMap)
    .map(function(c) {
      const days = c.last_date ? Math.floor((today - new Date(c.last_date)) / 86400000) : null;
      return {
        name: c.name, mgr: c.mgr.split(' ')[0], last_date: c.last_date,
        days_since: days, orders_total: c.orders_total, amount_total: c.amount_total,
      };
    })
    .filter(function(c) { return c.days_since !== null && c.days_since >= 15; })
    .sort(function(a, b) { return b.days_since - a.days_since; })
    .slice(0, 40);
}

// ── ПЛАНЫ МЕНЕДЖЕРОВ (лист "Планы_менеджеров", Влад вводит вручную каждый месяц) ──
// Месяц (YYYY-MM) | Менеджер (фамилия) | План. Один источник плана - не константа в коде,
// чтобы план можно было менять по месяцам без правки скрипта. См.
// plans/2026-07-02-manager-revenue-single-source.md.
function getManagerPlans_(ss, monthKey) {
  const sheet = ss.getSheetByName('Планы_менеджеров');
  if (!sheet || sheet.getLastRow() < 2) return {};
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  const plans = {};
  data.forEach(function(r) {
    // "2026-07" похоже на дату - Google Таблицы могут молча превратить ячейку в
    // объект Date (1 июля) вместо текста, что при ручном вводе, что через setValues().
    // Проверено на реальных данных (2026-07-02) - именно так и произошло, план был
    // 0 у всех менеджеров из-за этого несовпадения типов.
    const mk = r[0] instanceof Date
      ? Utilities.formatDate(r[0], 'Europe/Moscow', 'yyyy-MM')
      : String(r[0] || '').trim();
    if (mk !== monthKey) return;
    const name = String(r[1] || '').trim().toLowerCase();
    if (!name) return;
    plans[name] = parseFloat(r[2]) || 0;
  });
  return plans;
}

// Проставляет .plan каждому менеджеру в by_manager (мутирует ordersResult). Заодно план
// "Внутренних перевозок" - та же строка "Планы_менеджеров", ключ "Внутренние" (не человек,
// но механизм тот же самый - Влад сам вписывает план в тот же лист, без отдельной константы
// в коде, см. Влад 2026-07-03: "откуда цифра 10 миллионов - установить план").
function joinManagerPlans_(ss, ordersResult, monthKey) {
  if (!ordersResult) return ordersResult;
  const plans = getManagerPlans_(ss, monthKey);
  if (ordersResult.by_manager) {
    ordersResult.by_manager.forEach(function(m) {
      const key = String(m.name || '').trim().split(' ')[0].toLowerCase();
      m.plan = plans[key] || 0;
      m.pct = m.plan > 0 ? (m.amount / m.plan * 100) : 0;
    });
  }
  if (ordersResult.summary) {
    ordersResult.summary.internal_plan = plans['внутренние'] || 0;
  }
  // Сырая карта планов (фамилия -> план), отдельно от by_manager - план менеджера/директора
  // существует независимо от того, есть ли у него заказы В ЭТОМ периоде (например только
  // начался месяц, ни одного заказа ещё не закрыто) - по by_manager такого менеджера вообще
  // не найти, план бы тихо выпал из суммы отдела (Влад, 2026-07-04: "по-прежнему 16 млн").
  ordersResult.managerPlans = plans;
  return ordersResult;
}

// Разовая функция: Влад запускает один раз при переезде на "Планы_менеджеров", чтобы
// перенести туда текущие цифры (раньше зашитые в MGR_PLANS во фронтенде) за текущий месяц.
// Дальше план на новый месяц Влад дописывает в этот лист вручную - здесь ничего запускать
// больше не нужно.
function seedManagerPlansForCurrentMonth() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const monthKey = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM');
  const CURRENT_PLANS = {
    'ахтамова': 8000000, 'цегельников': 10000000, 'гуштюк': 5000000, 'дербенцева': 650000,
    'шейко': 650000, 'гусейнова': 0, 'савиток': 10000000, 'филипчук': 2000000,
    'котельников': 5000000, 'гуляева': 3000000, 'коньшина': 2000000, 'володин': 2000000,
    'рыщанов': 0, 'прус-роскошный': 2650000, 'суркова': 0, 'цуцурин': 6000000
  };

  let sheet = ss.getSheetByName('Планы_менеджеров');
  if (!sheet) {
    sheet = ss.insertSheet('Планы_менеджеров');
    sheet.getRange(1, 1, 1, 3).setValues([['Месяц', 'Менеджер', 'План']]).setFontWeight('bold');
  }

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const existing = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    const alreadySeeded = existing.some(function(r) { return String(r[0]).trim() === monthKey; });
    if (alreadySeeded) {
      Logger.log('План за ' + monthKey + ' уже есть в "Планы_менеджеров" - ничего не делаю (запусти вручную для нового месяца, скопировав строки).');
      return;
    }
  }

  const rows = Object.keys(CURRENT_PLANS).map(function(name) {
    return [monthKey, name.charAt(0).toUpperCase() + name.slice(1), CURRENT_PLANS[name]];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 3).setValues(rows);
  Logger.log('✅ Планы_менеджеров: добавлено ' + rows.length + ' строк за ' + monthKey);
}

// Список месяцев, по которым есть архив (для выпадающего списка на дашборде)
function getAvailablePeriods(ss) {
  const sheets = ss.getSheets();
  const periods = [];
  const re = new RegExp('^' + ORDERS_ARCHIVE_PFX + '(\\d{4}-\\d{2})$');
  sheets.forEach(function(s) {
    const m = s.getName().match(re);
    if (m) periods.push(m[1]);
  });
  periods.sort().reverse();
  return periods;
}

// Чистая функция: нормализованные строки заказов -> агрегированный JSON для дашборда.
// Используется и для текущего месяца (Заказы_данные), и для архивов прошлых периодов.
function aggregateOrdersRows(rows) {
  const C = {
    id:0, date_c:1, date_s:2, date_e:3,
    pay_type:4, posted:5, waybill:6, realiz:7, orig:8,
    customer:9, our_org:10, division:11, div_code:12, internal:13,
    dept:14, mgr_s:15, mgr_l:16, mgr_sr:17, resp:18, driver:19,
    equip:20, unit:21, qty:22, vehicle:23, cargo:24, equip_name:25, address:26,
    hired:27, hired_cost:28, hired_qty:29,
    amount:30, payment:31, cash:32, bank:33, pay_in:34,
    profit:35, profit_min:36, balance:37, org_bal:38, paid_sup:39,
    contract:40, tral_dept:41, month:42
  };

  const num      = function(row, k) { return ordParseNum(row[C[k]]); };
  const str      = function(row, k) { return String(row[C[k]] || '').trim(); };
  const yes      = function(row, k) { return str(row, k) === 'Да'; };
  const isHiredR = function(row)    { return str(row, 'hired') !== 'Нет'; };
  // Google Sheets возвращает Date-объекты при чтении ячеек с датами
  const dateVal  = function(row, k) {
    const v = row[C[k]];
    if (!v) return '';
    if (v instanceof Date) return Utilities.formatDate(v, 'Europe/Moscow', 'yyyy-MM-dd');
    return String(v).trim();
  };

  let totalOrders=0, totalAmount=0, totalPayment=0, totalBalance=0;
  let totalHiredCost=0, hiredProfit=0;
  let internalAmount=0, internalOrders=0;
  let tralOrders=0, tralAmount=0, longOrders=0, longAmount=0;
  let ownAmount=0, hiredAmountRev=0;
  let ownTralOrders=0, ownLongOrders=0, hiredTralOrders=0, hiredLongOrders=0;
  var noWaybillOwn=[0,0,0], noWaybillHired=[0,0,0], waybillNotPosted=[0,0,0], postedNoRealiz=[0,0,0], complete=[0,0,0];

  const managerMap  = {};
  const logistMap   = {};
  const customerMap = {};
  const dayMap      = {};
  const supplierMap = {};
  const driverMap   = {};
  const problemOrders = [];
  const mgrDetailMap = {}; // персональная разбивка по менеджеру (для личной страницы)
  const internalMap  = {}; // вкладка "Внутренние перевозки" - по нашим предприятиям
  const internalCargoMap = {}; // груз -> кол-во рейсов (только внутренние)
  let internalTral = 0, internalLong = 0; // тип нашей техники (только внутренние)
  const cargoTralMap = {}; // категория груза -> {trips, amount} (тралы, все заказы)
  const cargoLongMap = {}; // категория груза -> {trips, amount} (длинномеры)

  function addCargo(map, cat, amount) {
    if (!map[cat]) map[cat] = { name: cat, trips: 0, amount: 0 };
    map[cat].trips++;
    map[cat].amount += amount;
  }

  // Каноничное имя внутреннего предприятия - чтобы варианты записи клиента схлопывались
  // в одну группу (по совпадению с шаблоном из INTERNAL_CLIENTS).
  function internalClientName(customer) {
    const c = String(customer || '');
    for (let i = 0; i < INTERNAL_CLIENTS.length; i++) {
      if (c.indexOf(INTERNAL_CLIENTS[i]) >= 0) return INTERNAL_CLIENTS[i];
    }
    return customer || 'Прочее';
  }

  function mgrDetail(name) {
    if (!mgrDetailMap[name]) {
      mgrDetailMap[name] = {
        name: name, customers: {}, rows_total: 0, rows_complete: 0,
        tral_orders: 0, long_orders: 0,
        doc: { no_waybill_own:0, no_waybill_hired:0, waybill_not_posted:0, posted_no_realiz:0, complete:0 },
      };
    }
    return mgrDetailMap[name];
  }

  for (const row of rows) {
    totalOrders++;
    const amount    = num(row, 'amount');
    const payment   = num(row, 'payment');   // Оплата итого (累计)
    const payIn     = num(row, 'pay_in');    // Поступление за период
    const profit    = num(row, 'profit');
    const balance   = num(row, 'balance');
    const isInt     = yes(row, 'internal');
    const equip     = str(row, 'equip');
    const isHired   = isHiredR(row);
    const hiredCost = num(row, 'hired_cost');
    const dateStr   = dateVal(row, 'date_s');
    const mgrSales  = str(row, 'mgr_s');
    const hw        = yes(row, 'waybill'); // есть ли путёвка - нужно в нескольких местах ниже

    // С июля 2026: 8%/8%/2%/2% от маржи найма платится только если маржа% по заказу >=23%
    const marginPct      = (isHired && amount > 0) ? (profit / amount) : 0;
    const marginQualifies = isHired && marginPct >= 0.23;

    totalAmount  += amount;
    totalPayment += payment;
    totalBalance += balance;
    if (isHired) { totalHiredCost += hiredCost; hiredProfit += profit; hiredAmountRev += amount; }
    else         { ownAmount += amount; }

    if (isInt) {
      internalAmount += amount; internalOrders++;
      // Разбивка для вкладки "Внутренние перевозки"
      const entName = internalClientName(str(row, 'customer'));
      if (!internalMap[entName]) internalMap[entName] = { name: entName, trips: 0, amount: 0 };
      internalMap[entName].trips++;
      internalMap[entName].amount += amount;
      if (equip === 'Трал')      internalTral++;
      if (equip === 'Длинномер') internalLong++;
      const cargoName = normalizeCargo(str(row, 'cargo'));
      internalCargoMap[cargoName] = (internalCargoMap[cargoName] || 0) + 1;
    }
    if (equip === 'Трал') {
      tralOrders++; tralAmount += amount; addCargo(cargoTralMap, normalizeCargo(str(row, 'cargo')), amount);
      if (isHired) hiredTralOrders++; else ownTralOrders++;
    }
    if (equip === 'Длинномер') {
      longOrders++; longAmount += amount; addCargo(cargoLongMap, normalizeCargo(str(row, 'cargo')), amount);
      if (isHired) hiredLongOrders++; else ownLongOrders++;
    }

    // ── По менеджеру продаж ──
    if (mgrSales && ordInList(mgrSales, TRAL_MANAGERS)) {
      if (!managerMap[mgrSales]) {
        managerMap[mgrSales] = { name: mgrSales, orders:0, amount:0, payment:0, cash:0, profit:0, hired_orders:0, hired_cost:0,
          internal_orders:0, internal_amount:0, internal_payment:0,
          own_amount:0, hired_margin_qualified:0, hired_margin_unqualified:0 };
      }
      const m = managerMap[mgrSales];
      m.orders++;
      m.amount  += amount;
      m.payment += payment;
      m.cash    += num(row, 'cash');
      if (isHired) m.profit += profit;   // прибыль только по найму
      if (isInt) { m.internal_orders++; m.internal_amount += amount; m.internal_payment += payment; }
      if (isHired) {
        m.hired_orders++; m.hired_cost += hiredCost;
        if (marginQualifies) m.hired_margin_qualified += profit;
        else m.hired_margin_unqualified += profit;
      } else {
        m.own_amount += amount;
      }
      var mgrDet = mgrDetail(mgrSales);
      mgrDet.rows_total++;
      if (equip === 'Трал')      mgrDet.tral_orders++;
      if (equip === 'Длинномер') mgrDet.long_orders++;
    }

    // ── По логисту ──
    const mgrLog = str(row, 'mgr_l');
    if (mgrLog && ordInList(mgrLog, TRAL_LOGISTS)) {
      if (!logistMap[mgrLog]) {
        logistMap[mgrLog] = { name: mgrLog, orders:0, amount:0, hired_orders:0, hired_cost:0, tral:0, long_:0,
          own_amount:0, hired_margin_qualified:0, hired_margin_unqualified:0 };
      }
      const l = logistMap[mgrLog];
      l.orders++;
      l.amount += amount;
      if (equip === 'Трал')      l.tral++;
      if (equip === 'Длинномер') l.long_++;
      if (isHired) {
        if (marginQualifies) l.hired_margin_qualified += profit;
        else l.hired_margin_unqualified += profit;
      } else {
        l.own_amount += amount;
      }
      if (isHired) { l.hired_orders++; l.hired_cost += hiredCost; }
    }

    // ── По клиентам (внешние) ──
    if (!isInt) {
      const cust   = str(row, 'customer');
      const dayNum = parseInt((dateStr || '').split('-')[2]) || 0;
      if (!customerMap[cust]) {
        customerMap[cust] = { name:cust, orders:0, amount:0, payment:0, balance:0, first_half:0, second_half:0, mgr_counts:{}, hired_margin:0 };
      }
      const cm = customerMap[cust];
      cm.orders++;
      cm.amount   += amount;
      cm.payment  += payment;
      cm.balance  += balance;
      if (dayNum >= 1  && dayNum <= 15) cm.first_half++;   // кол-во заказов в 1-й пол.
      if (dayNum >= 16) cm.second_half++;                   // кол-во заказов во 2-й пол.
      const mgrKey = mgrSales || str(row, 'mgr_sr');
      if (mgrKey) cm.mgr_counts[mgrKey] = (cm.mgr_counts[mgrKey] || 0) + 1;
      // Маржа найма по клиенту (сумма - стоимость привлечённой техники), не сумма закупки
      // у поставщика - Влад, 2026-07-04: "колонка найм должна отражать маржу в деньгах".
      if (isHired) cm.hired_margin += profit;

      // Та же разбивка, но только для своего менеджера - не смешивается с другими
      if (mgrSales && ordInList(mgrSales, TRAL_MANAGERS)) {
        var md = mgrDetail(mgrSales);
        if (!md.customers[cust]) {
          md.customers[cust] = { name:cust, orders:0, amount:0, payment:0, balance:0, first_half:0, second_half:0, first_unpaid_date:null };
        }
        var mdc = md.customers[cust];
        mdc.orders++;
        mdc.amount   += amount;
        mdc.payment  += payment;
        mdc.balance  += balance;
        if (dayNum >= 1  && dayNum <= 15) mdc.first_half++;
        if (dayNum >= 16) mdc.second_half++;
        // Срок дебиторки - с даты самого раннего неоплаченного заказа этого клиента
        if ((amount - payment) > 0.01 && dateStr) {
          if (!mdc.first_unpaid_date || dateStr < mdc.first_unpaid_date) mdc.first_unpaid_date = dateStr;
        }
      }
    }

    // ── По дням ──
    if (dateStr) {
      if (!dayMap[dateStr]) dayMap[dateStr] = { date:dateStr, orders:0, amount:0, hired_cost:0, payment:0 };
      dayMap[dateStr].orders++;
      dayMap[dateStr].amount    += amount;
      dayMap[dateStr].hired_cost += isHired ? hiredCost : 0;
      dayMap[dateStr].payment   += payment;
    }

    // ── По поставщикам найма ──
    // Воронка "нет путёвки" не считает внутренние перевозки (свои же компании -
    // ТЕХНОПАРК, МЕГАКРАН, ОТДЕЛ БУРОВЫХ РАБОТ и т.п., см. INTERNAL_CLIENTS) - Влад попросил
    // явно, 2026-07-02: по ним путёвки не спрашивают, их наличие в воронке только шумит.
    // Заказы/выручка поставщика при этом считаются как обычно - искажается только сам счётчик
    // "нет путёвки".
    if (isHired) {
      const supplier = str(row, 'hired');
      const isInternalOrder = isInt || ordInList(str(row, 'customer'), INTERNAL_CLIENTS);
      if (!supplierMap[supplier]) supplierMap[supplier] = { name:supplier, orders:0, revenue:0, cost:0, no_waybill:0 };
      supplierMap[supplier].orders++;
      supplierMap[supplier].revenue += amount;
      supplierMap[supplier].cost    += hiredCost;
      if (!hw && !isInternalOrder) supplierMap[supplier].no_waybill++;
    }

    // ── Статус документов (внешние заказы, разбивка по декадам) ──
    if (!isInt) {
      const dayNum2 = parseInt((dateStr||'').split('-')[2]) || 0;
      const dec = dayNum2 <= 10 ? 0 : dayNum2 <= 20 ? 1 : 2;
      const pst = yes(row, 'posted');
      const hr  = yes(row, 'realiz');
      let docStatus = '', docLabel = '';
      if (!hw)       { if (isHired) noWaybillHired[dec]++; else noWaybillOwn[dec]++; docStatus='no_waybill'; docLabel='нет путёвки'; }
      else if (!pst) { waybillNotPosted[dec]++;  docStatus='not_posted'; docLabel='не проведён'; }
      else if (!hr)  { postedNoRealiz[dec]++;    docStatus='no_realiz';  docLabel='нет реализации'; }
      else           { complete[dec]++; }

      if (mgrSales && ordInList(mgrSales, TRAL_MANAGERS)) {
        var md2 = mgrDetail(mgrSales).doc;
        if (!hw)       { if (isHired) md2.no_waybill_hired++; else md2.no_waybill_own++; }
        else if (!pst) md2.waybill_not_posted++;
        else if (!hr)  md2.posted_no_realiz++;
        else           { md2.complete++; mgrDetail(mgrSales).rows_complete++; }
      }

      if (docStatus) {
        problemOrders.push({
          id: str(row,'id'), date: dateStr,
          customer: str(row,'customer'), mgr: mgrSales,
          amount: amount, balance: balance, status: docLabel, decade: dec + 1,
        });
      }
    }

    // ── По водителям ──
    // Та же логика, что у поставщиков выше - внутренние перевозки не считаем в воронку
    // "нет путёвки" (Влад, 2026-07-02), заказы/выручка водителя считаются как обычно.
    const driverName = ordCleanName(str(row, 'driver'));
    if (driverName) {
      const isInternalOrder = isInt || ordInList(str(row, 'customer'), INTERNAL_CLIENTS);
      if (!driverMap[driverName]) driverMap[driverName] = { name: driverName, orders: 0, amount: 0, no_waybill: 0 };
      driverMap[driverName].orders++;
      driverMap[driverName].amount += amount;
      if (!hw && !isInternalOrder) driverMap[driverName].no_waybill++;
    }
  }

  // Строим by_customer с вычисленным главным менеджером
  const customerList = Object.values(customerMap).map(function(c) {
    const topMgr = Object.keys(c.mgr_counts).sort(function(a,b){ return c.mgr_counts[b]-c.mgr_counts[a]; })[0] || '';
    return {
      name: c.name, orders: c.orders, amount: c.amount, payment: c.payment, balance: c.balance,
      first_half: c.first_half, second_half: c.second_half,
      mgr: topMgr.split(' ')[0], hired_margin: c.hired_margin
    };
  }).sort(function(a,b){ return b.amount-a.amount; });

  // Клиенты, пропавшие во 2-й половине
  const lostCustomers = customerList.filter(function(c){ return c.first_half > 0 && c.second_half === 0; });

  // Поставщики найма с маржой
  const supplierList = Object.values(supplierMap).map(function(s) {
    const margin = s.revenue - s.cost;
    return {
      name: s.name, orders: s.orders, revenue: s.revenue, cost: s.cost,
      margin: margin, margin_pct: s.revenue > 0 ? Math.round(margin / s.revenue * 100) : 0,
      no_waybill: s.no_waybill,
    };
  }).sort(function(a,b){ return b.revenue-a.revenue; });

  // Личная страница менеджера - отдельная разбивка, не смешанная с другими менеджерами
  const managerDetail = {};
  Object.keys(mgrDetailMap).forEach(function(name) {
    const md = mgrDetailMap[name];
    const custList = Object.values(md.customers).sort(function(a,b){ return b.amount-a.amount; });
    managerDetail[name] = {
      rows_total:    md.rows_total,
      rows_complete: md.rows_complete,
      rows_open:     md.rows_total - md.rows_complete,
      tral_orders:   md.tral_orders,
      long_orders:   md.long_orders,
      doc:           md.doc,
      top_customers: custList.slice(0, 10),
      lost_customers: custList.filter(function(c){ return c.first_half > 0 && c.second_half === 0; }),
      debtors: custList
        .map(function(c){ return { name:c.name, unpaid:c.amount-c.payment, orders:c.orders, first_unpaid_date:c.first_unpaid_date }; })
        .filter(function(c){ return c.unpaid > 0; })
        .sort(function(a,b){ return b.unpaid-a.unpaid; }),
    };
  });

  // Топ грузов: сортируем по числу рейсов, "Прочие грузы" всегда в конец
  function sortCargo(map) {
    return Object.values(map).sort(function(a, b) {
      if (a.name === 'Прочие грузы') return 1;
      if (b.name === 'Прочие грузы') return -1;
      return b.trips - a.trips;
    });
  }

  const months = rows.map(function(r) {
    const v = r[C.month];
    if (!v) return '';
    if (v instanceof Date) return Utilities.formatDate(v, 'Europe/Moscow', 'yyyy-MM');
    return String(v).trim().slice(0, 7);
  }).filter(Boolean);
  const period = months[0] || '';

  return {
    period: period,
    summary: {
      total_orders:    totalOrders,
      total_amount:    totalAmount,
      total_payment:   totalPayment,
      hired_profit:    hiredProfit,    // прибыль только по найму
      total_hired_cost: totalHiredCost,
      total_balance:   totalBalance,
      internal_orders: internalOrders,
      internal_amount: internalAmount,
      tral_orders:     tralOrders,
      tral_amount:     tralAmount,
      long_orders:     longOrders,
      long_amount:     longAmount,
      own_amount:        ownAmount,        // выручка своего парка (не найм)
      hired_amount:      hiredAmountRev,   // выручка по наёмным заказам (сумма клиенту, не оплата поставщику)
      own_tral_orders:   ownTralOrders,
      own_long_orders:   ownLongOrders,
      hired_tral_orders: hiredTralOrders,
      hired_long_orders: hiredLongOrders,
    },
    top_cargo_tral: sortCargo(cargoTralMap),
    top_cargo_long: sortCargo(cargoLongMap),
    doc_status: {
      no_waybill:         noWaybillOwn[0]+noWaybillOwn[1]+noWaybillOwn[2]+noWaybillHired[0]+noWaybillHired[1]+noWaybillHired[2],
      no_waybill_own:     noWaybillOwn[0]+noWaybillOwn[1]+noWaybillOwn[2],
      no_waybill_hired:   noWaybillHired[0]+noWaybillHired[1]+noWaybillHired[2],
      waybill_not_posted: waybillNotPosted[0]+waybillNotPosted[1]+waybillNotPosted[2],
      posted_no_realiz:   postedNoRealiz[0]+postedNoRealiz[1]+postedNoRealiz[2],
      complete:           complete[0]+complete[1]+complete[2],
    },
    doc_by_decade: [
      { label:'1-10',  no_waybill_own:noWaybillOwn[0], no_waybill_hired:noWaybillHired[0], waybill_not_posted:waybillNotPosted[0], posted_no_realiz:postedNoRealiz[0], complete:complete[0] },
      { label:'11-20', no_waybill_own:noWaybillOwn[1], no_waybill_hired:noWaybillHired[1], waybill_not_posted:waybillNotPosted[1], posted_no_realiz:postedNoRealiz[1], complete:complete[1] },
      { label:'21+',   no_waybill_own:noWaybillOwn[2], no_waybill_hired:noWaybillHired[2], waybill_not_posted:waybillNotPosted[2], posted_no_realiz:postedNoRealiz[2], complete:complete[2] },
    ],
    by_manager:        Object.values(managerMap).sort(function(a,b){ return b.amount-a.amount; }),
    by_logist:         Object.values(logistMap).sort(function(a,b){ return b.orders-a.orders; }),
    by_customer:       customerList.slice(0, 30),
    lost_customers:    lostCustomers,
    by_hired_supplier: supplierList,
    by_day:            Object.values(dayMap).sort(function(a,b){ return a.date.localeCompare(b.date); }),
    problem_orders:    problemOrders.slice(0, 600),
    by_driver:         Object.values(driverMap).sort(function(a,b){ return b.orders-a.orders; }).slice(0, 25),
    by_driver_no_waybill: Object.values(driverMap)
      .filter(function(d){ return d.no_waybill > 0; })
      .sort(function(a,b){ return b.no_waybill-a.no_waybill; })
      .slice(0, 25),
    by_supplier_no_waybill: supplierList
      .filter(function(s){ return s.no_waybill > 0; })
      .sort(function(a,b){ return b.no_waybill-a.no_waybill; }),
    by_manager_detail: managerDetail,
    internal: {
      total_trips:  internalOrders,
      total_amount: internalAmount,
      by_enterprise: Object.values(internalMap).sort(function(a,b){ return b.amount-a.amount; }),
      equip: { tral: internalTral, long: internalLong },
      top_cargo: Object.keys(internalCargoMap)
        .map(function(name){ return { name: name, trips: internalCargoMap[name] }; })
        .sort(function(a,b){ return b.trips-a.trips; })
        .slice(0, 8),
    },
  };
}

// ── КЛИЕНТСКАЯ АНАЛИТИКА (Фаза 2, план plans/2026-07-05-client-analytics-on-dashboard.md) ──
// Склеивает историю (2020 - 31.05.2026, разовая выгрузка, нормализована отдельным скриптом
// scripts/client_history_normalize.js в таблице Влада) с живыми данными самого дашборда
// (Заказы_данные + архивы Заказы_YYYY-MM, июнь 2026+). Граница фиксированная - HISTORY_CUTOFF,
// не "последняя дата в файле" - см. план, почему (Влад просил приоритет живых данных за июнь,
// т.к. отчёт 1С по текущему месяцу ещё дозаписывается/корректируется).

const CLIENT_HISTORY_SHEET_ID   = '1nXMXVxLiOK-7CXdSSFr7NcoCUvvyEDCjPyGhE0dv8es';
const CLIENT_HISTORY_SHEET_NAME = 'Нормализованные_история_заказов';
// Должно совпадать с HISTORY_CUTOFF в scripts/client_history_normalize.js - если там меняют,
// менять и здесь, иначе либо задвоятся заказы на границе, либо появится дыра в данных.
const CLIENT_HISTORY_CUTOFF = '2026-05-31';

// Собирает единый список строк {customer, mgrSales, mgrSupply, equip, amount, profit, date}
// из истории (чужая таблица, только <= CLIENT_HISTORY_CUTOFF) и из живых данных дашборда
// (Заказы_данные + все архивы, только > CLIENT_HISTORY_CUTOFF - защита от задвоения, даже если
// исторический лист вдруг снова будет содержать более поздние даты).
// Только живая часть (Заказы_данные + архивы, > CLIENT_HISTORY_CUTOFF) - лёгкая, читает
// только СВОЮ таблицу, без похода в чужую (историческую). Используется новым
// (агрегатным) путём для client_analytics, где история приходит отдельно и заранее
// посчитанной - см. getClientHistoryAggregate_/computeClientAnalyticsFromAggregate_.
function getClientLiveRows_(ss) {
  const rows = [];

  function ingestLiveRows_(parsedRows) {
    parsedRows.forEach(function(row) {
      const isInternal = String(row[13] || '').trim() === 'Да';
      if (isInternal) return;
      const dateStr = ordFormatDate(row[2]); // 'Начало работ'
      if (!dateStr || dateStr <= CLIENT_HISTORY_CUTOFF) return; // уже покрыто историей
      rows.push({
        customer: String(row[9] || '').trim(),
        mgrSales: String(row[15] || '').trim(),
        mgrSupply: String(row[16] || '').trim(),
        equip: String(row[20] || '').trim(),
        amount: ordParseNum(row[30]),
        profit: ordParseNum(row[35]),
        date: dateStr,
      });
    });
  }

  const normSheet = ss.getSheetByName(ORDERS_NORM_SHEET);
  if (normSheet && normSheet.getLastRow() > 1) {
    ingestLiveRows_(normSheet.getRange(2, 1, normSheet.getLastRow() - 1, 43).getValues());
  }

  getAvailablePeriods(ss).forEach(function(period) {
    const archive = ss.getSheetByName(ORDERS_ARCHIVE_PFX + period);
    if (!archive || archive.getLastRow() < 5) return;
    const parsed = parseOrdersRawRows(archive.getDataRange().getValues());
    ingestLiveRows_(parsed.rows);
  });

  return rows;
}

// Историческая часть (чужая таблица, <= CLIENT_HISTORY_CUTOFF) в виде сырых строк -
// используется старым путём (manager_profile). Держим отдельно от getClientLiveRows_,
// чтобы новый (агрегатный) путь мог не читать эти 72 тыс. строк вообще.
function getClientHistoryRawRows_() {
  const rows = [];
  try {
    const histSS = SpreadsheetApp.openById(CLIENT_HISTORY_SHEET_ID);
    const histSheet = histSS.getSheetByName(CLIENT_HISTORY_SHEET_NAME);
    if (histSheet && histSheet.getLastRow() > 1) {
      const data = histSheet.getRange(2, 1, histSheet.getLastRow() - 1, 8).getValues();
      data.forEach(function(r) {
        // Номер(0), Заказчик(1), Менеджер по продажам(2), Менеджер по снабжению(3),
        // Тип техники(4), Сумма(5), Прибыль(6), Начало(7)
        // ordFormatDate(), не String() - Google Sheets сама конвертирует строки вида
        // "2026-05-15" в настоящие Date-объекты при записи (setValues), если колонка не
        // зафиксирована как текст. Наивный String(r[7]) на Date-объекте даёт мусор вида
        // "Fri May 15 2026 00:00:00 GMT+0300..." - сравнение с CUTOFF ломается, почти все
        // исторические строки отсеивались как "позже cutoff". Баг 2026-07-06 - именно из-за
        // этого на дашборде оставались только живые июнь/июль, вся история 2020-2026 терялась.
        const dateStr = ordFormatDate(r[7]);
        if (!dateStr || dateStr > CLIENT_HISTORY_CUTOFF) return;
        rows.push({
          customer: String(r[1] || '').trim(),
          mgrSales: String(r[2] || '').trim(),
          mgrSupply: String(r[3] || '').trim(),
          equip: String(r[4] || '').trim(),
          amount: ordParseNum(r[5]),
          profit: ordParseNum(r[6]),
          date: dateStr,
        });
      });
    }
  } catch (histErr) {
    Logger.log('Не удалось прочитать историческую таблицу клиентов: ' + histErr);
  }
  return rows;
}

// Старый комбинированный путь (история построчно + живое) - используется manager_profile.
// Держим НЕТРОНУТЫМ ради отката: если агрегатный путь (Фаза 4) даст сбой, client_analytics
// можно откатить на этот же путь буквально одной строкой в doGet (см. план).
function getClientAnalyticsRows_(ss) {
  return getClientHistoryRawRows_().concat(getClientLiveRows_(ss));
}

const CLIENT_HISTORY_AGGREGATE_SHEET_NAME = 'История_клиентов_агрегат';

// Читает предпосчитанный агрегат по клиентам (см. buildClientHistoryAggregate() в
// scripts/client_history_normalize.js - отдельный разовый прогон в таблице "мега база",
// не автоматический). ~5 тыс. строк вместо 72 тыс. сырых - на порядок быстрее, чем
// getClientHistoryRawRows_(). Формат строки: Заказчик|Заказов|Выручка|Прибыль|
// Первый_заказ|Последний_заказ|ПоДням(JSON: {"YYYY-MM-DD":{"o":N,"r":R,"p":P}}).
// Возвращает null, если агрегата ещё нет (лист не создан) - вызывающий код должен
// откатиться на getClientAnalyticsRows_ в этом случае, не падать.
function getClientHistoryAggregate_() {
  try {
    const histSS = SpreadsheetApp.openById(CLIENT_HISTORY_SHEET_ID);
    const sheet = histSS.getSheetByName(CLIENT_HISTORY_AGGREGATE_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return null;
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
    const agg = {};
    data.forEach(function(r) {
      const name = String(r[0] || '').trim();
      if (!name) return;
      let daily = {};
      try { daily = JSON.parse(r[6] || '{}'); } catch (parseErr) { daily = {}; }
      agg[name] = {
        name: name,
        orders: ordParseNum(r[1]),
        revenue: ordParseNum(r[2]),
        profit: ordParseNum(r[3]),
        first_order: ordFormatDate(r[4]),
        last_order: ordFormatDate(r[5]),
        daily: daily,
      };
    });
    return agg;
  } catch (aggErr) {
    Logger.log('Не удалось прочитать агрегат истории клиентов: ' + aggErr);
    return null;
  }
}

// Дата обязана выглядеть как YYYY-MM-DD - иначе строковые сравнения (date < c.first_order
// и т.п.) дают полную кашу молча. Баг 2026-07-07: на дашборде "Период" показал "Wed Sep 30
// 2020 10:00:00 GMT+0300..." - это ровно то, что даёт JS Date.prototype.toString(), то есть
// где-то объект-дата прошёл мимо ordFormatDate. Не нашли точную причину (похоже на известный
// нюанс с датами при чтении ЧУЖОЙ таблицы через SpreadsheetApp.openById - объект может не
// проходить instanceof Date, если пришёл из другого контекста выполнения), но неважно откуда
// именно - невалидный ключ теперь просто отбрасывается с предупреждением в лог, а не портит
// refDate/сегменты для всех клиентов сразу.
function isValidDateStr_(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// Новый (быстрый) путь для client_analytics - byCustomer и pseudoRows строятся из
// предпосчитанного агрегата (уже сгруппирован по клиенту и по дню) + живых строк, вместо
// построчного парсинга 72 тыс. исторических строк на каждый запрос. from/to (опционально) -
// точная фильтрация по дням, т.к. агрегат хранит дневную (не месячную) детализацию -
// день - минимальная единица, которая нужна и растущим/снижающимся (окно 180 дней), и
// произвольному периоду с самой страницы.
function computeClientAnalyticsFromAggregate_(historyAgg, liveRows, opts) {
  opts = opts || {};
  const from = opts.from || '';
  const to   = opts.to   || '';

  const byCustomer = {};
  const pseudoRows = [];
  let totalOrders = 0;
  let badDateCount = 0;

  Object.keys(historyAgg).forEach(function(name) {
    const h = historyAgg[name];
    Object.keys(h.daily).forEach(function(date) {
      if (!isValidDateStr_(date)) {
        badDateCount++;
        if (badDateCount <= 5) Logger.log('Пропущен невалидный ключ даты у "' + name + '": ' + JSON.stringify(date));
        return;
      }
      if (from && date < from) return;
      if (to && date > to) return;
      const d = h.daily[date];
      if (!byCustomer[name]) {
        byCustomer[name] = { name: name, orders: 0, revenue: 0, profit: 0, first_order: date, last_order: date };
      }
      const c = byCustomer[name];
      c.orders += d.o; c.revenue += d.r; c.profit += (d.p || 0);
      if (date < c.first_order) c.first_order = date;
      if (date > c.last_order)  c.last_order  = date;
      totalOrders += d.o;
      pseudoRows.push({ customer: name, date: date, amount: d.r });
    });
  });

  liveRows.forEach(function(r) {
    if (!isValidDateStr_(r.date)) {
      badDateCount++;
      if (badDateCount <= 5) Logger.log('Пропущена невалидная дата в живой строке "' + r.customer + '": ' + JSON.stringify(r.date));
      return;
    }
    if (from && r.date < from) return;
    if (to && r.date > to) return;
    if (!byCustomer[r.customer]) {
      byCustomer[r.customer] = { name: r.customer, orders: 0, revenue: 0, profit: 0, first_order: r.date, last_order: r.date };
    }
    const c = byCustomer[r.customer];
    c.orders++; c.revenue += r.amount; c.profit += r.profit;
    if (r.date < c.first_order) c.first_order = r.date;
    if (r.date > c.last_order)  c.last_order  = r.date;
    totalOrders++;
    pseudoRows.push({ customer: r.customer, date: r.date, amount: r.amount });
  });

  if (badDateCount > 0) Logger.log('ВСЕГО пропущено записей с невалидной датой: ' + badDateCount);

  return finishClientAnalytics_(byCustomer, pseudoRows, opts, totalOrders);
}

function daysBetween_(dateStr, refStr) {
  return Math.round((new Date(refStr) - new Date(dateStr)) / 86400000);
}

function addDays_(dateStr, delta) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + delta);
  return Utilities.formatDate(d, 'Europe/Moscow', 'yyyy-MM-dd');
}

function clientSegment_(days) {
  if (days <= 30) return 'Активный';
  if (days <= 90) return 'Под риском';
  if (days <= 365) return 'Отток (до года)';
  return 'Отток (давно)';
}

// Методика 1-в-1 из .business/clients/analyze_clients.py (согласована и проверена на разовом
// анализе 2026-07-04..05) - топ-клиенты, концентрация (Парето), сегменты по давности, win-back,
// растущие/снижающиеся, сезонность по месяцам (только полные календарные годы).
// Общая часть расчёта - топ-клиенты/сегменты/win-back из уже собранной карты по клиенту,
// растущие-снижающиеся/сезонность из плоского списка {customer,date,amount}. Не знает,
// собраны ли byCustomer/pseudoRows из сырых строк или из предпосчитанного агрегата -
// вызывается из обоих путей (computeClientAnalytics_ ниже и computeClientAnalyticsFromAggregate_,
// см. план plans/2026-07-05-client-analytics-on-dashboard.md, раздел "Фаза 4").
function finishClientAnalytics_(byCustomer, pseudoRows, opts, totalOrdersCount) {
  opts = opts || {};
  var customers = Object.keys(byCustomer).map(function(k) { return byCustomer[k]; });
  if (!customers.length) return { error: 'Нет данных для клиентской аналитики' };

  var refDate = customers.reduce(function(max, c) { return c.last_order > max ? c.last_order : max; }, '');
  var periodStart = customers.reduce(function(min, c) { return c.first_order < min ? c.first_order : min; }, refDate);

  customers.forEach(function(c) {
    c.recency_days     = daysBetween_(c.last_order, refDate);
    c.avg_order_value  = c.orders ? c.revenue / c.orders : 0;
    c.segment          = clientSegment_(c.recency_days);
  });
  customers.sort(function(a, b) { return b.revenue - a.revenue; });

  var totalRevenue = customers.reduce(function(s, c) { return s + c.revenue; }, 0);
  var top10Revenue = customers.slice(0, 10).reduce(function(s, c) { return s + c.revenue; }, 0);
  var top20Count   = Math.ceil(customers.length * 0.2);
  var top20Revenue = customers.slice(0, top20Count).reduce(function(s, c) { return s + c.revenue; }, 0);

  var cum = 0, clientsFor80 = customers.length;
  for (var i = 0; i < customers.length; i++) {
    cum += customers[i].revenue;
    if (cum >= totalRevenue * 0.8) { clientsFor80 = i + 1; break; }
  }

  var segMap = {};
  customers.forEach(function(c) {
    if (!segMap[c.segment]) segMap[c.segment] = { segment: c.segment, clients: 0, revenue: 0 };
    segMap[c.segment].clients++;
    segMap[c.segment].revenue += c.revenue;
  });

  // Win-back: та же методика, что в analyze_clients.py - молчит 60+ дней, было хотя бы 3
  // заказа и от 300к исторической выручки (не разовый мелкий клиент).
  var winback = customers
    .filter(function(c) { return c.recency_days > 60 && c.orders >= 3 && c.revenue >= 300000; })
    .sort(function(a, b) { return b.revenue - a.revenue; });

  // Растущие/снижающиеся - последние 180 дней vs предыдущие 180 дней от refDate.
  // ВАЖНО (см. чат с Владом 2026-07-05): это сравнение чувствительно к сезонности - если
  // окно half-year падает на границу высокого/низкого сезона, "падение" может быть сезонным
  // артефактом, а не реальным трендом. Показывать на дашборде с этой оговоркой, не как
  // прямой сигнал тревоги.
  var d6  = addDays_(refDate, -180);
  var d12 = addDays_(refDate, -360);
  var last6Map = {}, prev6Map = {};
  pseudoRows.forEach(function(r) {
    if (r.date > d6) { last6Map[r.customer] = (last6Map[r.customer] || 0) + r.amount; }
    else if (r.date > d12 && r.date <= d6) { prev6Map[r.customer] = (prev6Map[r.customer] || 0) + r.amount; }
  });
  var trendNames = {};
  Object.keys(last6Map).forEach(function(k) { trendNames[k] = true; });
  Object.keys(prev6Map).forEach(function(k) { trendNames[k] = true; });
  var trend = Object.keys(trendNames).map(function(name) {
    var last6 = last6Map[name] || 0, prev6 = prev6Map[name] || 0;
    return { name: name, last6: last6, prev6: prev6, delta: last6 - prev6 };
  });
  var growing = trend
    .filter(function(t) { return t.prev6 >= 100000 && t.delta > 0; })
    .sort(function(a, b) { return b.delta - a.delta; });
  var declining = trend
    .filter(function(t) { return t.prev6 >= 200000 && t.delta < 0; })
    .sort(function(a, b) { return a.delta - b.delta; });

  // Сезонность - только полные календарные годы (отсекаем первый/последний неполный),
  // как в analyze_clients.py, иначе частичные края искажают средние по месяцам.
  var yearsSeen = {};
  pseudoRows.forEach(function(r) { yearsSeen[r.date.slice(0, 4)] = true; });
  var yearsList = Object.keys(yearsSeen).sort();
  var fullYears = yearsList.length > 2 ? yearsList.slice(1, -1) : yearsList;
  var monthRevenue = {};
  pseudoRows.forEach(function(r) {
    if (fullYears.indexOf(r.date.slice(0, 4)) === -1) return;
    var m = r.date.slice(5, 7);
    monthRevenue[m] = (monthRevenue[m] || 0) + r.amount;
  });
  var seasonality = [];
  for (var mi = 1; mi <= 12; mi++) {
    var mk = (mi < 10 ? '0' : '') + mi;
    seasonality.push({
      month: mk,
      revenue_per_year: fullYears.length ? (monthRevenue[mk] || 0) / fullYears.length : 0,
    });
  }

  return {
    ref_date: refDate,
    period_start: periodStart,
    total_clients: customers.length,
    total_revenue: totalRevenue,
    total_orders: totalOrdersCount != null ? totalOrdersCount : customers.reduce(function(s, c) { return s + c.orders; }, 0),
    top10_pct: totalRevenue ? top10Revenue / totalRevenue * 100 : 0,
    top20_pct: totalRevenue ? top20Revenue / totalRevenue * 100 : 0,
    clients_for_80pct: clientsFor80,
    // Фильтр по сегменту (?segment=Отток (давно)) - Влад, 2026-07-06: "хочу выбрать например
    // только отток". Без фильтра - топ-100 по выручке среди всех; с фильтром - топ-300 среди
    // клиентов именно этого сегмента (без фильтра по сегменту топ-100 почти всегда состоит из
    // активных клиентов - у отточных просто редко бывает высокая выручка, чтобы попасть в топ).
    top_clients: opts.segment
      ? customers.filter(function(c) { return c.segment === opts.segment; }).slice(0, 300)
      : customers.slice(0, 100),
    segments: Object.keys(segMap).map(function(k) { return segMap[k]; }),
    winback: winback.slice(0, 200),
    growing: growing.slice(0, 100),
    declining: declining.slice(0, 100),
    seasonality: seasonality,
    full_years_used: fullYears,
  };
}

// Старый путь - строит byCustomer/pseudoRows из сырых строк {customer,mgrSales,...,amount,date}.
// Используется для manager_profile (там объём строк на порядок меньше - фильтр по одному
// менеджеру, пересчитывать 72 тыс. строк на каждый клик не так дорого, как для всей базы).
function computeClientAnalytics_(rows, opts) {
  opts = opts || {};
  if (!rows.length) return { error: 'Нет данных для клиентской аналитики' };

  var byCustomer = {};
  rows.forEach(function(r) {
    if (!byCustomer[r.customer]) {
      byCustomer[r.customer] = {
        name: r.customer, orders: 0, revenue: 0, profit: 0,
        first_order: r.date, last_order: r.date,
      };
    }
    var c = byCustomer[r.customer];
    c.orders++;
    c.revenue += r.amount;
    c.profit  += r.profit;
    if (r.date < c.first_order) c.first_order = r.date;
    if (r.date > c.last_order)  c.last_order  = r.date;
  });

  return finishClientAnalytics_(byCustomer, rows, opts, rows.length);
}

// Рейтинг менеджеров по выручке - для "место среди менеджеров" в личном профиле.
function computeManagerRanking_(rows) {
  var byMgr = {};
  TRAL_MANAGERS.forEach(function(m) { byMgr[m] = { name: m, revenue: 0, clients: {} }; });
  rows.forEach(function(r) {
    TRAL_MANAGERS.forEach(function(m) {
      if (r.mgrSales.indexOf(m) >= 0) {
        byMgr[m].revenue += r.amount;
        byMgr[m].clients[r.customer] = true;
      }
    });
  });
  return Object.keys(byMgr).map(function(m) {
    return { name: byMgr[m].name, revenue: byMgr[m].revenue, clients: Object.keys(byMgr[m].clients).length };
  }).sort(function(a, b) { return b.revenue - a.revenue; });
}

// Личный профиль менеджера (как показывался Владу в чате для Цегельникова) - фильтр по
// подстроке в "Менеджер по продажам", остальное - та же логика computeClientAnalytics_
// плюс разбивка по годам/дням недели/типу техники и место в рейтинге.
function computeManagerProfile_(allRows, managerName) {
  var rows = allRows.filter(function(r) { return r.mgrSales.indexOf(managerName) >= 0; });
  if (!rows.length) return { error: 'Нет данных по менеджеру "' + managerName + '"' };

  var base = computeClientAnalytics_(rows);

  var byYear = {};
  rows.forEach(function(r) {
    var y = r.date.slice(0, 4);
    if (!byYear[y]) byYear[y] = { year: y, orders: 0, revenue: 0 };
    byYear[y].orders++;
    byYear[y].revenue += r.amount;
  });

  var wdNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']; // JS Date.getDay(): 0 = воскресенье
  var byWeekday = {};
  rows.forEach(function(r) {
    var wd = wdNames[new Date(r.date).getDay()];
    if (!byWeekday[wd]) byWeekday[wd] = { weekday: wd, orders: 0, revenue: 0 };
    byWeekday[wd].orders++;
    byWeekday[wd].revenue += r.amount;
  });

  var byEquip = {};
  rows.forEach(function(r) {
    var eq = r.equip || 'Прочее';
    if (!byEquip[eq]) byEquip[eq] = { equip: eq, orders: 0, revenue: 0 };
    byEquip[eq].orders++;
    byEquip[eq].revenue += r.amount;
  });

  var ranking = computeManagerRanking_(allRows);
  var rank = ranking.findIndex(function(m) { return m.name === managerName; }) + 1;

  return {
    manager: managerName,
    rank: rank || null,
    total_managers: ranking.length,
    total_orders: rows.length,
    total_revenue: base.total_revenue,
    total_clients: base.total_clients,
    top10_pct: base.top10_pct,
    top20_pct: base.top20_pct,
    clients_for_80pct: base.clients_for_80pct,
    top_clients: base.top_clients,
    segments: base.segments,
    winback: base.winback,
    growing: base.growing,
    declining: base.declining,
    seasonality: base.seasonality,
    by_year: Object.keys(byYear).sort().map(function(y) { return byYear[y]; }),
    by_weekday: Object.keys(byWeekday).map(function(k) { return byWeekday[k]; }),
    by_equip: Object.keys(byEquip).map(function(k) { return byEquip[k]; }).sort(function(a, b) { return b.revenue - a.revenue; }),
  };
}

// ── РУЧНОЙ ЗАПУСК: только импорт + нормализация ─────────────
function runOrdersOnly() {
  const log = [], errors = [];
  try { importOrdersReport(); log.push('✅ Импорт заказов'); }
  catch(e) { errors.push('❌ Импорт: ' + e.message); }
  try { normalizeOrders();    log.push('✅ Нормализация заказов'); }
  catch(e) { errors.push('❌ Нормализация: ' + e.message); }
  Logger.log(log.concat(errors).join('\n'));
}
