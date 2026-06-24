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
  SPREADSHEET_ID: '1jCPRXYDFcTpZIHdJfngZveOQFycu6qbcl-MoXBxtBRM',
  TELEGRAM_TOKEN: '8818207527:AAHhoPM9txqeuWkZP0U2PBPXOJI0QkBg5gc',
  TELEGRAM_CHAT_ID: '1829485641',  // @Vlad_Ts_777
  ALERT_FINE_THRESHOLD: 50000,   // штраф выше этой суммы → алерт
  ALERT_LOSS_THRESHOLD: 0,       // прибыль ниже этого → алерт
};

// ============================================================
// ГЛАВНАЯ ТОЧКА ВХОДА — вешается на триггер каждые 6 часов
// ============================================================
function runAll() {
  const log = [];
  const errors = [];

  log.push('🚀 Запуск обновления: ' + new Date().toLocaleString('ru'));

  try { importReportFromGmail();   log.push('✅ Парк из 1С загружен'); }
  catch(e) { errors.push('❌ Парк из 1С: ' + e.message); }

  try { importManagerReport();     log.push('✅ Менеджеры загружены'); }
  catch(e) { errors.push('❌ Менеджеры: ' + e.message); }

  try { normalizeReport();         log.push('✅ Нормализация выполнена'); }
  catch(e) { errors.push('❌ Нормализация: ' + e.message); }

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
  const data = sheet.getRange(6, 1, lastRow - 5, 36).getValues();

  const vehicles = [];
  for (let row of data) {
    const plan    = parseFloat(row[5]) || 0;
    const fakt    = parseFloat(row[6]) || 0;
    const procent = parseFloat(row[7]) || 0;
    const driver  = String(row[33] || '').trim();

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
  const sheet = ss.getSheetByName('Штатка');
  if (!sheet) throw new Error('Лист Штатка не найден');

  const getVal = (range) => {
    const val = sheet.getRange(range).getValue();
    return (val === '' || val === null) ? 0 : Number(val);
  };

  // ИСПРАВЛЕНО: правильные ячейки для каждого показателя
  const workTrails    = getVal('AG2');  // В работе тралы
  const noDriverTrails= getVal('AG3');  // Без водителя тралы
  const repairTrails  = getVal('AG4');  // Ремонт тралы
  const noOrderTrails = getVal('AJ2');  // Без заказа тралы

  const workLongs     = getVal('AH2');  // В работе длинномеры
  const noDriverLongs = getVal('AH3');  // Без водителя длинномеры
  const repairLongs   = getVal('AH4');  // Ремонт длинномеры
  const noOrderLongs  = getVal('AK2');  // Без заказа длинномеры

  // Всего = фиксированные значения (меняются редко при покупке/выводе)
  const totalTrails = 36;
  const totalLongs  = 19;

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
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const normSheet = ss.getSheetByName('Нормализованные_данные');
  if (!normSheet) throw new Error('Нормализованные_данные не найдены');

  const lastRow = normSheet.getLastRow();
  if (lastRow < 2) return;

  // Читаем все 15 колонок A-O: финансы + тип/статус/план из Штатки
  const data = normSheet.getRange(2, 1, lastRow - 1, 15).getValues();

  let finSheet = ss.getSheetByName('История_финансов');

  // Миграция: если лист существует, но со старым форматом (< 12 колонок) — чистим
  if (finSheet) {
    const ncols = finSheet.getLastColumn();
    if (ncols < 12) finSheet.clear();
  } else {
    finSheet = ss.insertSheet('История_финансов');
  }

  if (finSheet.getLastRow() === 0) {
    const headers = ['Дата', 'Госномер', 'Тип', 'Статус', 'Выручка', 'ФОТ', 'Топливо', 'Запчасти', 'Штрафы', 'Проходные', 'Валовая прибыль', 'План ВП'];
    finSheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Удаляем записи за сегодня (перезаписываем свежими)
  const finLastRow = finSheet.getLastRow();
  if (finLastRow > 1) {
    const existingDates = finSheet.getRange(2, 1, finLastRow - 1, 1).getValues();
    let deleteFrom = -1;
    for (let i = 0; i < existingDates.length; i++) {
      if (existingDates[i][0] instanceof Date) {
        const d = new Date(existingDates[i][0]);
        d.setHours(0, 0, 0, 0);
        if (d.getTime() === today.getTime()) { deleteFrom = i + 2; break; }
      }
    }
    if (deleteFrom > 0) {
      finSheet.deleteRows(deleteFrom, finLastRow - deleteFrom + 1);
    }
  }

  // Новая структура строки: тип/статус/план берём из Штатки (колонки M, N, O)
  const rows = data
    .filter(row => String(row[0] || '').trim())
    .map(row => [
      new Date(),               // Дата
      row[0],                   // Госномер (A)
      row[12] || row[2] || '',  // Тип из Штатки (M), fallback 1С (C)
      row[13] || '',            // Статус из Штатки (N)
      row[3],                   // Выручка (D)
      row[4],                   // ФОТ (E)
      row[5],                   // Топливо (F)
      row[6],                   // Запчасти (G)
      row[7],                   // Штрафы (H)
      row[8],                   // Проходные (I)
      row[9],                   // Прибыль (J)
      row[14] || 0,             // План ВП (O)
    ]);

  if (rows.length > 0) {
    finSheet.getRange(finSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
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

  // Статус парка — из Нормализованных_данных (колонки M=тип, N=статус)
  var fleet = getFleetStatus(ss);
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
function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_TOKEN}/sendMessage`;
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: CONFIG.TELEGRAM_CHAT_ID,
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
// API ДЛЯ ДАШБОРДА — читает Штатку для статусов и типов
// ============================================================
// ============================================================
// ОБНОВЛЁННЫЙ doGet — добавить в Apps Script вместо старого
// Изменения: статусы из Штатки (колонка AF) + типы из колонки A
// ============================================================

function doGet(e) {
  const ss = SpreadsheetApp.openById('1jCPRXYDFcTpZIHdJfngZveOQFycu6qbcl-MoXBxtBRM');
  try {
    // Отдельный endpoint для истории по машинам (тяжёлые данные, грузим лениво)
    var action = e && e.parameter ? (e.parameter.action || '') : '';
    if (action === 'vehicle_history') {
      return ContentService
        .createTextOutput(JSON.stringify({ history: getVehicleHistory(ss) }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const staffData = getStaffData(ss); // читаем Штатку один раз
    const data = {
      updated:    new Date().toISOString(),
      summary:    getSummaryData(ss),
      vehicles:   getVehiclesData(ss),
      managers:   getManagersData(ss),
      drivers:    getDriversData(ss),
      fleet:      getFleetStatus(ss),
      history:    getHistoryData(ss),
      repairs:    getRepairsData(staffData),
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

  const lastRow = sheet.getLastRow();
  if (lastRow < 6) return {};

  // Колонки (0-based): A=0 Тип, B=1 Марка, C=2 Госномер тягача, E=4 Госномер прицепа, F=5 План ВП, AK=36 Статус
  const data = sheet.getRange(6, 1, lastRow - 5, 37).getValues();
  const map = {};

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var type       = String(row[0] || '').trim();   // A — модификация (ПР-8, ТКР-4, КР-3...)
    var marka      = String(row[1] || '').trim();   // B — марка тягача
    var gos        = String(row[2] || '').trim();   // C — госномер тягача
    var trailerGos = String(row[4] || '').trim();   // E — госномер прицепа
    var plan       = parseFloat(row[5]) || 0;       // F — план ВП на машину
    var status     = String(row[36] || '').trim();  // AK — Статус на сегодня (index 36)

    if (!gos || !type) continue;

    var gosClean = normalizeGos(gos);
    map[gosClean] = { type: type, status: status, marka: marka, trailerGos: trailerGos, gosOriginal: gos, plan: plan };
  }
  return map;
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
function getVehiclesData(ss) {
  var norm = ss.getSheetByName('Нормализованные_данные');
  if (!norm || norm.getLastRow() < 2) return [];

  var rows = norm.getRange(2, 1, norm.getLastRow() - 1, 15).getValues();
  var result = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var gos = String(r[0] || '').trim();
    if (!gos) continue;
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

function getFleetStatus(ss) {
  var norm = ss.getSheetByName('Нормализованные_данные');
  var empty = {
    trailers: { total:36, working:0, noDriver:0, repair:0, noOrder:0 },
    trucks:   { total:19, working:0, noDriver:0, repair:0, noOrder:0 },
  };
  if (!norm || norm.getLastRow() < 2) return empty;

  var data = norm.getRange(2, 1, norm.getLastRow() - 1, 14).getValues();
  var tWork=0, tRepair=0, tNoDriver=0, tNoOrder=0;
  var lWork=0, lRepair=0, lNoDriver=0, lNoOrder=0;

  for (var i = 0; i < data.length; i++) {
    var type   = String(data[i][12] || '').trim();  // M — Тип из Штатки
    var status = String(data[i][13] || '').trim();  // N — Статус из Штатки
    if (!type && !status) continue;

    // Длинномеры = только "Борт", всё остальное — тралы
    var isTruck   = type === 'Борт' || type.indexOf('Борт') === 0;
    var isWork    = status.indexOf('В работе') >= 0 || status.indexOf('в работе') >= 0;
    var isRepair  = status.indexOf('Ремонт')   >= 0 || status.indexOf('ремонт')   >= 0;
    var isNoDrv   = status.indexOf('Без водителя') >= 0;
    var isNoOrder = status.indexOf('Без заказа')   >= 0;

    if (isTruck) {
      if (isWork) lWork++; else if (isRepair) lRepair++; else if (isNoDrv) lNoDriver++; else if (isNoOrder) lNoOrder++;
    } else {
      if (isWork) tWork++; else if (isRepair) tRepair++; else if (isNoDrv) tNoDriver++; else if (isNoOrder) tNoOrder++;
    }
  }

  return {
    trailers: { total:36, working:tWork, noDriver:tNoDriver, repair:tRepair, noOrder:tNoOrder },
    trucks:   { total:19, working:lWork, noDriver:lNoDriver, repair:lRepair, noOrder:lNoOrder },
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
