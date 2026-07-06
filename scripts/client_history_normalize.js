// Bound-скрипт таблицы "мега база" (историческая выгрузка заказов 2020-2026, ~112 тыс. строк).
// НЕ часть основного дашборда (scripts/full_script_final.js) - вставляется отдельно в
// Extensions > Apps Script этой конкретной Google Таблицы:
// https://docs.google.com/spreadsheets/d/1nXMXVxLiOK-7CXdSSFr7NcoCUvvyEDCjPyGhE0dv8es
//
// Задача: очистить сырую выгрузку 1С (лист "Лист_1") до строк отдела тралов/грузоперевозок,
// исключить внутренние компании и служебные записи, записать чистый результат в отдельный
// лист - чтобы дашборд (scripts/full_script_final.js) мог читать уже готовые данные, а не
// гонять по 112 тыс. строк сырья при каждом запросе.
//
// См. план: plans/2026-07-05-client-analytics-on-dashboard.md
//
// ВАЖНО про списки ниже: скопированы 1-в-1 из scripts/full_script_final.js (INTERNAL_CLIENTS,
// TRAL_MANAGERS, TRAL_LOGISTS, строки ~2006-2024). Это НЕ отдельный источник истины - при
// изменении списков там их нужно вручную синхронизировать и сюда. Заведено так, а не через
// общий модуль, потому что это разные Google-проекты Apps Script (общий код между ними без
// npm-паблиша/clasp не расшарить).
//
// ЗАПУСК: normalizeClientHistory(). На 112 тыс. строк один вызов может не уложиться в лимит
// Apps Script (6 минут на выполнение - его нельзя обойти, только подстроиться). Функция сама
// сохраняет прогресс (PropertiesService) и при повторном ручном запуске продолжает с того
// места, где остановилась, вместо того чтобы начинать заново. Если лог говорит "запусти ещё
// раз" - просто нажми ▶ снова, ничего не потеряется.

const RAW_SHEET_NAME = 'Лист_1';
const CLEAN_SHEET_NAME = 'Нормализованные_история_заказов';

// Влад, 2026-07-05: приоритет живых данных за июнь - отчёт 1С по текущему месяцу ещё
// дозаписывается/корректируется (почта → таблица → дашборд), значит июньские строки в этой
// исторической выгрузке - не финальные цифры. Хотя файл физически содержит данные по 30.06.2026,
// сюда попадает только то, что СТРОГО ДО этой границы - всё с июня 2026 дашборд берёт
// исключительно из своих живых листов ("Заказы_данные"/"Заказы_YYYY-MM"), не отсюда.
const HISTORY_CUTOFF = '2026-05-31';

const INTERNAL_CLIENTS = [
  'ТЕХНО ПАРК', 'ОТДЕЛ БУРОВЫХ РАБОТ', 'КРАНМАСТЕР',
  'МЕГАКРАН', 'БАЗА ДМД', 'БУЛЬДОГ ООО', 'БАЗА',
  'УМИАТ ЯРД', // Влад, 2026-07-05: решено исключить - см. ту же правку в full_script_final.js
  'ОТДЕЛ ЭКСКАВАТОРОВ ДМД', 'ОТДЕЛ КРАНОВ ДМД', 'ТД ЯРД' // Влад, 2026-07-06: старые внутренние КА, сейчас это ТЕХНО ПАРК (НАШ)
];

const TRAL_MANAGERS = [
  'Ахтамова', 'Гусейнова', 'Цуцурин',
  'Котельников', 'Цегельников', 'Гуляева', 'Гуштюк',
  'Дербенцева', 'Савиток', 'Филипчук', 'Шейко',
  'Коньшина', 'Володин', 'Прус-Роскошный',
  'Рыщанов', 'Суркова'
];

const TRAL_LOGISTS = [
  'Васин', 'Кан', 'Махура', 'Сильчев',
  'Прус-Роскошный', 'Рыщанов', 'Ахтамова', 'Гусейнова'
];

function inList_(name, list) {
  const n = String(name || '');
  return list.some(function(m) { return n.indexOf(m) >= 0; });
}

function parseNum_(val) {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

// Тот же формат, что ordFormatDate() в full_script_final.js - для согласованности между
// историческим и живым листами дашборда.
function formatDate_(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Europe/Moscow', 'yyyy-MM-dd');
  }
  const s = String(val);
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  return s;
}

const READ_BATCH_SIZE = 10000;
// Оставляем запас до жёсткого 6-минутного лимита Apps Script - на финальную сводку и
// форматирование тоже нужно время, поэтому не расходуем весь бюджет на чтение/запись.
const TIME_BUDGET_MS = 4.5 * 60 * 1000;

const PROP_NEXT_ROW = 'histNorm_nextRow';
const PROP_COUNTERS = 'histNorm_counters';

function normalizeClientHistory() {
  const startTime = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const raw = ss.getSheetByName(RAW_SHEET_NAME);
  if (!raw) throw new Error('Лист "' + RAW_SHEET_NAME + '" не найден');

  const lastRow = raw.getLastRow();
  const lastCol = raw.getLastColumn();
  if (lastRow < 2) throw new Error('Данных нет');

  const headerRow = raw.getRange(1, 1, 1, lastCol).getValues()[0];
  const col = {};
  headerRow.forEach(function(h, i) {
    const key = String(h || '').trim();
    if (key) col[key] = i;
  });

  const required = ['Заказчик', 'Менеджер по продажам', 'Менеджер по снабжению', 'Тип техники', 'Сумма', 'Прибыль', 'Начало', 'Номер'];
  const missing = required.filter(function(k) { return col[k] === undefined; });
  if (missing.length) throw new Error('В сыром листе нет колонок: ' + missing.join(', '));

  // 'БЕЗ ВОДИТЕЛЯ' - Влад, 2026-07-05: служебный статус в 1С, не реальный клиент (882 строки
  // в полной истории) - похоже на старый техпроцесс, сейчас таких клиентов нет.
  const ADMIN_VALUES = { 'РЕМОНТ': true, 'БЕЗ ВОДИТЕЛЯ': true, '': true };

  const props = PropertiesService.getScriptProperties();
  let clean = ss.getSheetByName(CLEAN_SHEET_NAME);
  let nextRow = parseInt(props.getProperty(PROP_NEXT_ROW), 10);
  let counters;

  if (!nextRow || nextRow < 2 || !clean) {
    // Свежий старт (первый запуск или сброс) - создаём/чистим лист, обнуляем прогресс
    if (clean) clean.clear();
    else clean = ss.insertSheet(CLEAN_SHEET_NAME);
    const outHeaders = ['Номер', 'Заказчик', 'Менеджер по продажам', 'Менеджер по снабжению', 'Тип техники', 'Сумма', 'Прибыль', 'Начало'];
    clean.getRange(1, 1, 1, outHeaders.length).setValues([outHeaders]).setFontWeight('bold');
    clean.setFrozenRows(1);
    nextRow = 2;
    counters = {
      totalRows: 0, cutoffExcludedRows: 0, internalRows: 0, internalRevenue: 0,
      otherDeptRows: 0, adminOrEmptyRows: 0, tagLeakRows: 0, tagLeakRevenue: 0, maxDate: ''
    };
    Logger.log('Начинаем с первой строки (' + (lastRow - 1) + ' строк данных всего)');
  } else {
    counters = JSON.parse(props.getProperty(PROP_COUNTERS));
    Logger.log('Продолжаем с прошлого запуска: уже обработано ' + counters.totalRows + ' из ' + (lastRow - 1) + ' строк');
  }

  while (nextRow <= lastRow && (Date.now() - startTime) < TIME_BUDGET_MS) {
    const numRows = Math.min(READ_BATCH_SIZE, lastRow - nextRow + 1);
    const batch = raw.getRange(nextRow, 1, numRows, lastCol).getValues();
    const out = [];

    for (let i = 0; i < batch.length; i++) {
      const row = batch[i];
      counters.totalRows++;

      const customer = String(row[col['Заказчик']] || '').trim();
      const dateStr = formatDate_(row[col['Начало']]);
      const revenue = parseNum_(row[col['Сумма']]);
      const profit = parseNum_(row[col['Прибыль']]);
      const mgrSales = String(row[col['Менеджер по продажам']] || '').trim();
      const mgrSupply = String(row[col['Менеджер по снабжению']] || '').trim();
      const equipType = String(row[col['Тип техники']] || '').trim();
      const orderId = String(row[col['Номер']] || '').trim();

      if (!customer || ADMIN_VALUES[customer] || !dateStr) { counters.adminOrEmptyRows++; continue; }

      if (dateStr > HISTORY_CUTOFF) { counters.cutoffExcludedRows++; continue; }

      const isInternal = inList_(customer, INTERNAL_CLIENTS);
      if (isInternal) { counters.internalRows++; counters.internalRevenue += revenue; continue; }

      // Тег "(НАШ)" в самих данных 1С есть, но нет в INTERNAL_CLIENTS (пока сознательно не
      // трогаем - см. "Открытые вопросы" в плане). Не фильтруем, но считаем отдельно, чтобы
      // утечка была видна, а не потерялась молча в общих цифрах.
      if (customer.indexOf('(НАШ)') >= 0) {
        counters.tagLeakRows++;
        counters.tagLeakRevenue += revenue;
      }

      const isTralDept = inList_(mgrSales, TRAL_MANAGERS) || inList_(mgrSupply, TRAL_LOGISTS);
      if (!isTralDept) { counters.otherDeptRows++; continue; }

      if (dateStr > counters.maxDate) counters.maxDate = dateStr;
      out.push([orderId, customer, mgrSales, mgrSupply, equipType, revenue, profit, dateStr]);
    }

    if (out.length) {
      const writeRow = clean.getLastRow() + 1;
      clean.getRange(writeRow, 1, out.length, 8).setValues(out);
    }

    nextRow += numRows;

    // Сохраняем прогресс после каждого батча - если время выйдет в середине цикла, работа
    // этого батча не потеряется на следующем запуске.
    props.setProperty(PROP_NEXT_ROW, String(nextRow));
    props.setProperty(PROP_COUNTERS, JSON.stringify(counters));
  }

  if (nextRow <= lastRow) {
    Logger.log('Промежуточный итог: обработано ' + counters.totalRows + ' из ' + (lastRow - 1) +
      ' строк, время вышло. Прогресс сохранён - ЗАПУСТИ normalizeClientHistory() ЕЩЁ РАЗ, ' +
      'чтобы продолжить с того же места.');
    return;
  }

  // Готово - финальная сводка. Числа клиентов/выручки считаем по уже накопленному чистому
  // листу (а не по JS-переменным, которые не переживают несколько запусков).
  const writtenRows = clean.getLastRow() - 1;
  if (writtenRows > 0) {
    clean.getRange(2, 6, writtenRows, 2).setNumberFormat('#,##0');
  }
  // autoResizeColumns() сознательно НЕ вызываем - на 70+ тыс. строк это очень медленная
  // операция в Apps Script и, вероятно, была основной причиной "Exceeded maximum execution
  // time" в первой версии скрипта. Чисто косметика, можно расширить колонки руками в Таблице.

  let uniqueClients = {};
  let totalRevenue = 0;
  if (writtenRows > 0) {
    const customers = clean.getRange(2, 2, writtenRows, 1).getValues();
    const revenues = clean.getRange(2, 6, writtenRows, 1).getValues();
    for (let i = 0; i < writtenRows; i++) {
      uniqueClients[customers[i][0]] = true;
      totalRevenue += revenues[i][0];
    }
  }

  Logger.log('ГОТОВО.');
  Logger.log('Всего строк в сыром листе: ' + counters.totalRows);
  Logger.log('Исключено (позже ' + HISTORY_CUTOFF + ' - приоритет живых данных дашборда за июнь+): ' + counters.cutoffExcludedRows);
  Logger.log('Исключено (внутренние компании из INTERNAL_CLIENTS): ' + counters.internalRows + ', выручка ' + Math.round(counters.internalRevenue));
  Logger.log('Исключено (не отдел тралов/грузоперевозок): ' + counters.otherDeptRows);
  Logger.log('Исключено (служебные/пустые/без даты): ' + counters.adminOrEmptyRows);
  Logger.log('ИТОГО чистых строк: ' + writtenRows + ' | клиентов: ' + Object.keys(uniqueClients).length + ' | выручка: ' + Math.round(totalRevenue));
  Logger.log('Последняя дата в чистых данных (должна быть <= ' + HISTORY_CUTOFF + '): ' + counters.maxDate);
  Logger.log('---');
  Logger.log('ДИАГНОСТИКА: строк с тегом "(НАШ)" НЕ в INTERNAL_CLIENTS, НЕ отфильтрованы: ' + counters.tagLeakRows + ', выручка ' + Math.round(counters.tagLeakRevenue));

  props.deleteProperty(PROP_NEXT_ROW);
  props.deleteProperty(PROP_COUNTERS);
}

// Если нужно начать нормализацию с нуля (например, поменяли исходный файл) - запусти это
// один раз перед normalizeClientHistory(), иначе она продолжит со старого места.
function resetClientHistoryProgress() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(PROP_NEXT_ROW);
  props.deleteProperty(PROP_COUNTERS);
  Logger.log('Прогресс сброшен - следующий запуск normalizeClientHistory() начнёт с начала.');
}
