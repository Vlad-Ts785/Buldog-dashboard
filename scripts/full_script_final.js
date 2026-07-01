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

  try { importReportFromGmail();   log.push('✅ Парк из 1С загружен'); }
  catch(e) { errors.push('❌ Парк из 1С: ' + e.message); }

  try { importOrdersReport();      log.push('✅ Заказы загружены'); }
  catch(e) { errors.push('❌ Заказы (импорт): ' + e.message); }

  try { importManagerReport();     log.push('✅ Менеджеры загружены'); }
  catch(e) { errors.push('❌ Менеджеры: ' + e.message); }

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
// ИМПОРТ ПАРКА ИЗ 1С (Gmail → Данные_1С)
// ============================================================
function importReportFromGmail() {
  const query = 'from:v.tsutsurin@yard-imperial.ru subject:"Отчет парк" has:attachment newer_than:3d';
  const threads = GmailApp.search(query);
  if (threads.length === 0) throw new Error('Письмо не найдено за последние 3 дня');

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
    { title: 'temp_park_' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS },
    reportFile.copyBlob()
  );
  const data = SpreadsheetApp.openById(tempFile.id).getSheets()[0].getDataRange().getValues();
  Drive.Files.remove(tempFile.id);

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const targetSheet = ss.getSheetByName('Данные_1С');
  if (!targetSheet) throw new Error('Лист Данные_1С не найден');

  targetSheet.clear();
  if (data && data.length > 0)
    targetSheet.getRange(1, 1, data.length, data[0].length).setValues(data);

  latestMessage.markRead();
  Utilities.sleep(2000);
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
    'Прицеп', 'Гос. номер прицепа', 'Тип из Штатки', 'Статус из Штатки', 'План ВП'
  ];
  normSheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');

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
    ]);
  }

  if (vehicles.length === 0) throw new Error('Нет данных о машинах');
  normSheet.getRange(2, 1, vehicles.length, headers.length).setValues(vehicles);
  normSheet.getRange(2, 4, vehicles.length, 7).setNumberFormat('#,##0.00');
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
  if (finSheet) {
    if (finSheet.getLastColumn() < 12) finSheet.clear();
  } else {
    finSheet = ss.insertSheet('История_финансов');
  }

  if (finSheet.getLastRow() === 0) {
    var hdrs = ['Дата','Госномер','Тип','Статус','Выручка','ФОТ','Топливо','Запчасти','Штрафы','Проходные','Валовая прибыль','План ВП'];
    finSheet.getRange(1, 1, 1, hdrs.length).setValues([hdrs]).setFontWeight('bold');
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
      f.revenue, f.fot, f.fuel, f.parts, f.fines, f.tolls, f.profit, v.plan
    ]);
  }

  if (rows.length > 0) {
    finSheet.getRange(finSheet.getLastRow() + 1, 1, rows.length, 12).setValues(rows);
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
// Менеджеры по продажам
const SALES_MANAGERS_LIST = [
  'Ахтамова', 'Володин', 'Гуляева', 'Гуштюк', 'Дербенцева',
  'Коньшина', 'Котельников', 'Савиток', 'Филипчук', 'Цегельников', 'Шейко'
];

// Логисты (внутренние перевозки)
const LOGISTS_LIST = [
  'Васин', 'Кан', 'Махура', 'Прус-Роскошный', 'Сильчев'
];

function isSalesManager(name) {
  return SALES_MANAGERS_LIST.some(m => name.includes(m));
}

function isLogist(name) {
  return LOGISTS_LIST.some(m => name.includes(m));
}

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
function buildManagersText() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var mgrSheet = ss.getSheetByName('Менеджеры_данные');
  if (!mgrSheet || mgrSheet.getLastRow() < 2) return '';

  var data = mgrSheet.getRange(2, 1, mgrSheet.getLastRow() - 1, 6).getValues();
  var managers = [];
  var logists = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var name = String(row[0] || '').trim();
    var plan = parseFloat(row[1]) || 0;
    var fakt = parseFloat(row[2]) || 0;
    var pay  = parseFloat(row[3]) || 0;
    var pct  = parseFloat(row[5]) || 0;
    var parts = name.replace(/[0-9\+\-\(\)\s]{5,}/g, '').trim().split(' ');
    var shortName = parts[0] + (parts[1] ? ' ' + parts[1][0] + '.' : '');
    var icon = pct >= 80 ? '🟢' : pct >= 50 ? '🟡' : '🔴';

    if (isSalesManager(name)) {
      managers.push({ shortName: shortName, plan: plan, fakt: fakt, pay: pay, pct: pct, icon: icon });
    } else if (isLogist(name)) {
      logists.push({ shortName: shortName, fakt: fakt });
    }
  }

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
  const myManagerRow = (orders.by_manager || []).filter(function(m) { return m.name === managerName; });
  const myLogistRow  = (orders.by_logist  || []).filter(function(m) { return m.name === managerName; });

  const allManagers = getManagersData(ss);
  const sur = managerName.trim().split(' ')[0].toLowerCase();
  const myPlanRow = allManagers.filter(function(m) {
    return m.name && m.name.trim().split(' ')[0].toLowerCase() === sur;
  });

  const detailWrapped = {};
  if (myDetail) detailWrapped[managerName] = myDetail;

  return {
    updated: new Date().toISOString(),
    role: 'manager',
    managerName: managerName,
    managers: myPlanRow,
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
  var providedKey = e && e.parameter ? (e.parameter.key || '') : '';
  var secretKey = PropertiesService.getScriptProperties().getProperty('DASHBOARD_KEY');
  if (!secretKey || providedKey !== secretKey) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'Доступ запрещён' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
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
    const data = {
      updated:    new Date().toISOString(),
      role:       'admin',
      summary:    getSummaryData(ss),
      vehicles:   getVehiclesData(ss, staffData),
      managers:   getManagersData(ss),
      drivers:    getDriversData(ss),
      fleet:      getFleetStatus(staffData),
      history:    getHistoryData(ss),
      repairs:    getRepairsData(staffData),
      staffMarkas: staffMarkas,
      orders:     getOrdersData(ss),
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
  for (var h = 0; h < headerRow.length; h++) {
    var hdr = String(headerRow[h] || '').trim();
    if (hdr === 'Статус на сегодня') statusCol = h;
    if (hdr.toUpperCase() === 'ВОДИТЕЛЬ 1' || hdr.toUpperCase() === 'ВОДИТЕЛЬ') driverCol = h;
  }

  var numCols = Math.max(statusCol + 1, driverCol + 1, 6);
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

    if (!gos || !type) continue;

    var gosClean = normalizeGos(gos);
    map[gosClean] = { type: type, status: status, marka: marka, trailerGos: trailerGos, gosOriginal: gos, plan: plan, driver: driver };
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
const SHTATKA_STATUS_VALUES = ['0','1','2','3','4','5','Р','Б','РВ']; // допустимые значения статуса

function isValidShtatkaStatus(status) {
  return SHTATKA_STATUS_VALUES.indexOf(String(status || '').trim()) >= 0;
}

// Ищет в шапке Штатки (строка 5) колонки-дни месяца - заголовки вида "01.06.", "15.07." и т.д.
// Позиция этих колонок плавает (зависит от числа дней в месяце), поэтому ищем по паттерну,
// не по фиксированной букве. Год в заголовке не указан - передаём отдельно.
function findShtatkaDayColumns(ss) {
  const sheet = ss.getSheetByName('Штатка');
  if (!sheet) return [];
  const lastCol = sheet.getLastColumn();
  const headerRow = sheet.getRange(5, 1, 1, lastCol).getValues()[0];
  const result = [];
  for (let h = 0; h < headerRow.length; h++) {
    const hdr = String(headerRow[h] || '').trim();
    const m = hdr.match(/^(\d{2})\.(\d{2})\.?$/);
    if (m) result.push({ col: h, day: parseInt(m[1], 10), month: parseInt(m[2], 10) });
  }
  return result;
}

// Разовая миграция: переносит текущую "широкую" сетку Штатки (дни-колонки) в
// Штатка_история. Идемпотентна - сначала чистит целевой месяц, потом пишет заново,
// можно запускать повторно без дублей. Год не хранится в заголовках сетки - передаём явно.
function migrateShtatkaGridToHistory(year) {
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

// Данные для страницы "Штатка" в дашборде: список машин (парк грузовиков - тралы/длинномеры,
// та же фильтрация, что и везде: тип+госномер тягача обязательны) + статусы за месяц.
function getShtatkaGridData(ss, monthKey) {
  const staffData = getStaffData(ss);
  const vehicles = Object.values(staffData)
    .map(function(v) {
      return { gos: v.gosOriginal, type: v.type, marka: v.marka, driver: v.driver, trailerGos: v.trailerGos };
    })
    .sort(function(a, b) { return a.gos.localeCompare(b.gos, 'ru'); });

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

// Нормализованные_данные = единственный источник (A-J финансы, M тип, N статус)
function getVehiclesData(ss, staffData) {
  var norm = ss.getSheetByName('Нормализованные_данные');
  if (!norm || norm.getLastRow() < 2) return [];

  var rows = norm.getRange(2, 1, norm.getLastRow() - 1, 15).getValues();
  var result = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var gos = String(r[0] || '').trim();
    if (!gos) continue;
    var staffInfo = staffData ? staffData[normalizeGos(gos)] : null;
    result.push({
      gos:     gos,
      marka:   String(r[1] || ''),
      type:    String(r[12] || ''),              // M — Тип из Штатки
      status:  String(r[13] || ''),              // N — Статус из Штатки
      revenue: parseFloat(r[3]) || 0,
      fot:     Math.abs(parseFloat(r[4]) || 0),
      fuel:    Math.abs(parseFloat(r[5]) || 0),
      parts:   Math.abs(parseFloat(r[6]) || 0),
      fines:   Math.abs(parseFloat(r[7]) || 0),
      tolls:   Math.abs(parseFloat(r[8]) || 0),
      profit:  parseFloat(r[9]) || 0,
      trailer: String(r[10] || ''),
      plan:    parseFloat(r[14]) || 0,           // O — план ВП из Штатки
      driver:  staffInfo ? staffInfo.driver : '',
    });
  }
  return result;
}

function getSummaryData(ss) {
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

  const mgr = ss.getSheetByName('Менеджеры_данные');
  let totalPlan=0, totalFakt=0, totalPayment=0, totalPayNal=0;
  if (mgr && mgr.getLastRow() > 1) {
    const mgrData = mgr.getRange(2, 1, mgr.getLastRow()-1, 6).getValues();
    for (let row of mgrData) {
      totalPlan    += parseFloat(row[1]) || 0;
      totalFakt    += parseFloat(row[2]) || 0;
      totalPayment += parseFloat(row[3]) || 0;
      totalPayNal  += parseFloat(row[4]) || 0;
    }
  }

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

function getManagersData(ss) {
  const mgr = ss.getSheetByName('Менеджеры_данные');
  if (!mgr || mgr.getLastRow() < 2) return [];
  const data = mgr.getRange(2, 1, mgr.getLastRow()-1, 6).getValues();
  return data.map(row => ({
    name:    row[0],
    plan:    parseFloat(row[1]) || 0,
    fakt:    parseFloat(row[2]) || 0,
    payment: parseFloat(row[3]) || 0,
    payNal:  parseFloat(row[4]) || 0,
    pct:     parseFloat(row[5]) || 0,
  })).sort((a,b) => b.fakt - a.fakt);
}

function getDriversData(ss) {
  const drv = ss.getSheetByName('ТОП_водителей_по_плану');
  if (!drv || drv.getLastRow() < 2) return [];
  const data = drv.getRange(2, 1, drv.getLastRow()-1, 7).getValues();
  return data.map(row => ({
    marka:  row[0], gos: row[1], type: row[2],
    plan:   parseFloat(row[3]) || 0,
    fakt:   parseFloat(row[4]) || 0,
    pct:    parseFloat(row[5]) || 0,
    driver: row[6],
  }));
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
  var data = hist.getRange(2, 1, lastRow - 1, 12).getValues();
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
    });
  }
  return result;
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
  'МЕГАКРАН', 'БАЗА ДМД', 'БУЛЬДОГ ООО', 'БАЗА'
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
  if (val instanceof Date) {
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
function splitOrdersRawByMonth(data) {
  if (!data || data.length < 5) return {};
  const headerRow = data[3]; // строка 4 (индекс 3) - как в parseOrdersRawRows
  const col = {};
  headerRow.forEach(function(h, i) { const key = String(h || '').trim(); if (key) col[key] = i; });
  const dateColIdx = col['Начало работ'];
  if (dateColIdx === undefined) return {};

  const buckets = {};
  for (let i = 4; i < data.length; i++) {
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
    const headerRows = data.slice(0, 4); // строки 1-4 (заголовки/шапка отчёта) - общие для всех кусков

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

  // Строка 4 (индекс 3) — заголовки колонок
  const headerRow = allData[3];
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

  for (let i = 4; i < allData.length; i++) {
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
  return aggregateOrdersRows(rows);
}

// Архивные данные за прошлый период (?action=orders_period&period=YYYY-MM)
function getOrdersDataForPeriod(ss, period) {
  const sheetName = ORDERS_ARCHIVE_PFX + period;
  const archive = ss.getSheetByName(sheetName);
  if (!archive || archive.getLastRow() < 5) return { error: 'Нет архива за ' + period };

  const parsed = parseOrdersRawRows(archive.getDataRange().getValues());
  if (parsed.rows.length === 0) return { error: 'Архив за ' + period + ' пуст' };
  return aggregateOrdersRows(parsed.rows);
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
    if (isHired) { totalHiredCost += hiredCost; hiredProfit += profit; }

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
    if (equip === 'Трал')      { tralOrders++;  tralAmount  += amount; addCargo(cargoTralMap, normalizeCargo(str(row, 'cargo')), amount); }
    if (equip === 'Длинномер') { longOrders++;  longAmount  += amount; addCargo(cargoLongMap, normalizeCargo(str(row, 'cargo')), amount); }

    // ── По менеджеру продаж ──
    if (mgrSales && ordInList(mgrSales, TRAL_MANAGERS)) {
      if (!managerMap[mgrSales]) {
        managerMap[mgrSales] = { name: mgrSales, orders:0, amount:0, payment:0, profit:0, hired_orders:0, hired_cost:0,
          internal_orders:0, internal_amount:0, internal_payment:0,
          own_amount:0, hired_margin_qualified:0, hired_margin_unqualified:0 };
      }
      const m = managerMap[mgrSales];
      m.orders++;
      m.amount  += amount;
      m.payment += payment;
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
        customerMap[cust] = { name:cust, orders:0, amount:0, payment:0, balance:0, first_half:0, second_half:0, mgr_counts:{}, hired_amount:0 };
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
      if (isHired) cm.hired_amount += hiredCost;

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
    if (isHired) {
      const supplier = str(row, 'hired');
      if (!supplierMap[supplier]) supplierMap[supplier] = { name:supplier, orders:0, revenue:0, cost:0, no_waybill:0 };
      supplierMap[supplier].orders++;
      supplierMap[supplier].revenue += amount;
      supplierMap[supplier].cost    += hiredCost;
      if (!hw) supplierMap[supplier].no_waybill++;
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
    const driverName = ordCleanName(str(row, 'driver'));
    if (driverName) {
      if (!driverMap[driverName]) driverMap[driverName] = { name: driverName, orders: 0, amount: 0, no_waybill: 0 };
      driverMap[driverName].orders++;
      driverMap[driverName].amount += amount;
      if (!hw) driverMap[driverName].no_waybill++;
    }
  }

  // Строим by_customer с вычисленным главным менеджером
  const customerList = Object.values(customerMap).map(function(c) {
    const topMgr = Object.keys(c.mgr_counts).sort(function(a,b){ return c.mgr_counts[b]-c.mgr_counts[a]; })[0] || '';
    return {
      name: c.name, orders: c.orders, amount: c.amount, payment: c.payment, balance: c.balance,
      first_half: c.first_half, second_half: c.second_half,
      mgr: topMgr.split(' ')[0], hired_amount: c.hired_amount
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

// ── РУЧНОЙ ЗАПУСК: только импорт + нормализация ─────────────
function runOrdersOnly() {
  const log = [], errors = [];
  try { importOrdersReport(); log.push('✅ Импорт заказов'); }
  catch(e) { errors.push('❌ Импорт: ' + e.message); }
  try { normalizeOrders();    log.push('✅ Нормализация заказов'); }
  catch(e) { errors.push('❌ Нормализация: ' + e.message); }
  Logger.log(log.concat(errors).join('\n'));
}
