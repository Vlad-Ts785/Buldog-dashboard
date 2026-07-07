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
//
// Найдено 2026-07-07 (диагностика debugAggregateDiag на дашборде): buildClientHistoryAggregate()
// читает "Начало" из уже записанного листа "Нормализованные_история_заказов" (эта же
// колонка сама была записана как чистая строка "YYYY-MM-DD", Google Таблицы автоматически
// конвертируют её в настоящую дату при setValues) - и на этом ВТОРОМ чтении instanceof Date
// сработал только для 315 из 36 577 значений (0.86%), остальные ушли в ветку String(val),
// дав "Sun Jan 05 2020 11:00:00 GMT+0300..." (обычный Date.prototype.toString()) - именно
// это ломало "Период"/сегменты на дашборде. Точный механизм, почему instanceof иногда не
// срабатывает на объекте, полученном через getValues(), не выяснили - но проверка "по
// утиной типизации" (есть ли методы getFullYear/getMonth/getDate) ловит оба случая
// одинаково надёжно и безопасна для обычных строк (у них таких методов просто нет).
function formatDate_(val) {
  if (!val) return '';
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

// ── АГРЕГАТ ПО КЛИЕНТАМ (Влад, 2026-07-06: "хочу, чтобы загрузка была мгновенной") ──
// Читает уже очищенный лист (CLEAN_SHEET_NAME, ~72 тыс. строк) и группирует по (клиент, день) -
// вместо 72 тыс. сырых строк дашборд будет читать ~5 тыс. строк (по одной на клиента) с
// компактной JSON-разбивкой по дням. Запускать ЗАНОВО каждый раз после normalizeClientHistory()
// (если тот перезапускался - например, поменялся HISTORY_CUTOFF, список INTERNAL_CLIENTS
// и т.п.) - агрегат сам по себе не подтягивает изменения автоматически.
const AGGREGATE_SHEET_NAME = 'История_клиентов_агрегат';
const AGG_READ_BATCH_SIZE = 15000;

function buildClientHistoryAggregate() {
  const startTime = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const clean = ss.getSheetByName(CLEAN_SHEET_NAME);
  if (!clean || clean.getLastRow() < 2) throw new Error('Нет очищенного листа "' + CLEAN_SHEET_NAME + '" - сначала запусти normalizeClientHistory()');

  const lastRow = clean.getLastRow();
  Logger.log('Строк в очищенном листе: ' + (lastRow - 1));

  // byCustomer[name] = { orders, revenue, profit, first, last, daily: { 'YYYY-MM-DD': {o,r,p} } }
  const byCustomer = {};

  for (let batchStart = 2; batchStart <= lastRow; batchStart += AGG_READ_BATCH_SIZE) {
    const numRows = Math.min(AGG_READ_BATCH_SIZE, lastRow - batchStart + 1);
    // Колонки очищенного листа: Номер(1), Заказчик(2), Менеджер по продажам(3),
    // Менеджер по снабжению(4), Тип техники(5), Сумма(6), Прибыль(7), Начало(8)
    const batch = clean.getRange(batchStart, 2, numRows, 7).getValues(); // Заказчик..Начало

    for (let i = 0; i < batch.length; i++) {
      const row = batch[i];
      const name = String(row[0] || '').trim();
      if (!name) continue;
      const revenue = parseNum_(row[4]);
      const profit  = parseNum_(row[5]);
      const dateStr = formatDate_(row[6]);
      if (!dateStr) continue;

      if (!byCustomer[name]) {
        byCustomer[name] = { orders: 0, revenue: 0, profit: 0, first: dateStr, last: dateStr, daily: {} };
      }
      const c = byCustomer[name];
      c.orders++;
      c.revenue += revenue;
      c.profit  += profit;
      if (dateStr < c.first) c.first = dateStr;
      if (dateStr > c.last)  c.last  = dateStr;
      if (!c.daily[dateStr]) c.daily[dateStr] = { o: 0, r: 0, p: 0 };
      c.daily[dateStr].o++;
      c.daily[dateStr].r += revenue;
      c.daily[dateStr].p += profit;
    }
    Logger.log('Обработано строк: ' + Math.min(batchStart - 2 + numRows, lastRow - 1) + ' из ' + (lastRow - 1) + ' (' + Math.round((Date.now() - startTime) / 1000) + ' сек)');
  }

  const names = Object.keys(byCustomer);
  Logger.log('Уникальных клиентов: ' + names.length);

  let agg = ss.getSheetByName(AGGREGATE_SHEET_NAME);
  if (agg) agg.clear();
  else agg = ss.insertSheet(AGGREGATE_SHEET_NAME);

  const outHeaders = ['Заказчик', 'Заказов', 'Выручка', 'Прибыль', 'Первый_заказ', 'Последний_заказ', 'ПоДням'];
  agg.getRange(1, 1, 1, outHeaders.length).setValues([outHeaders]).setFontWeight('bold');
  agg.setFrozenRows(1);

  // Понедельник той недели, в которую попадает dateStr - используется только как ЗАПАСНОЙ
  // ключ группировки для клиентов-выбросов (см. ниже), формат остаётся YYYY-MM-DD, поэтому
  // весь остальной код (сравнения строк на дашборде) не нуждается в изменениях.
  function weekStartKey_(dateStr) {
    const d = new Date(dateStr);
    const day = d.getDay(); // 0=Вс,1=Пн,...,6=Сб
    const diff = (day === 0 ? -6 : 1) - day;
    d.setDate(d.getDate() + diff);
    return Utilities.formatDate(d, 'Europe/Moscow', 'yyyy-MM-dd');
  }

  // Округляем суммы до целых рублей перед JSON.stringify - дробные "Сумма"/"Прибыль" в 1С
  // (копейки, 1065+ строк с ними в реальных данных) плюс накопление через += на многих
  // строках в день дают "грязные" хвосты вида 76000.00000000001 (обычное поведение чисел
  // с плавающей точкой в JS) - раздувает JSON в разы. Копейки в аналитике не нужны -
  // округление не теряет ничего важного. НО даже после округления реальные данные
  // 2026-07-07 показали, что у отдельных клиентов дневная разбивка всё равно превышает
  // лимит ячейки Google Sheets (50 000 симв.) - видимо, уникальных дней у них больше, чем
  // показывала локальная выгрузка на момент прикидки. Защита: если после округления всё
  // равно не влезает - сворачиваем ИМЕННО ЭТОГО клиента в недельные бакеты (~7x меньше
  // записей) вместо дневных - точность растущих/снижающихся для него будет чуть грубее,
  // но это единичные выбросы, не вся база, и без этой защиты весь прогон падает целиком.
  const CELL_LIMIT_SAFE = 45000;
  let degradedCount = 0;
  const out = names.map(function(name) {
    const c = byCustomer[name];
    const roundedDaily = {};
    Object.keys(c.daily).forEach(function(date) {
      const d = c.daily[date];
      roundedDaily[date] = { o: d.o, r: Math.round(d.r), p: Math.round(d.p) };
    });
    let json = JSON.stringify(roundedDaily);
    if (json.length > CELL_LIMIT_SAFE) {
      const weekly = {};
      Object.keys(c.daily).forEach(function(date) {
        const wk = weekStartKey_(date);
        const d = c.daily[date];
        if (!weekly[wk]) weekly[wk] = { o: 0, r: 0, p: 0 };
        weekly[wk].o += d.o; weekly[wk].r += d.r; weekly[wk].p += d.p;
      });
      Object.keys(weekly).forEach(function(wk) {
        weekly[wk].r = Math.round(weekly[wk].r);
        weekly[wk].p = Math.round(weekly[wk].p);
      });
      const weeklyJson = JSON.stringify(weekly);
      Logger.log('ВНИМАНИЕ: "' + name + '" - дневная разбивка (' + Object.keys(roundedDaily).length +
        ' дней, ' + json.length + ' симв.) не влезла в ячейку, свёрнута в недельную (' +
        Object.keys(weekly).length + ' недель, ' + weeklyJson.length + ' симв.)');
      json = weeklyJson;
      degradedCount++;
    }
    return [name, c.orders, Math.round(c.revenue), Math.round(c.profit), c.first, c.last, json];
  });
  Logger.log('Клиентов со свёрнутой (недельной вместо дневной) разбивкой: ' + degradedCount);

  const AGG_WRITE_BATCH_SIZE = 1000;
  for (let writeStart = 0; writeStart < out.length; writeStart += AGG_WRITE_BATCH_SIZE) {
    const chunk = out.slice(writeStart, writeStart + AGG_WRITE_BATCH_SIZE);
    agg.getRange(2 + writeStart, 1, chunk.length, outHeaders.length).setValues(chunk);
  }
  agg.getRange(2, 2, out.length, 2).setNumberFormat('#,##0');

  const totalRevenue = names.reduce(function(s, n) { return s + byCustomer[n].revenue; }, 0);
  const totalOrders = names.reduce(function(s, n) { return s + byCustomer[n].orders; }, 0);
  const maxDailyLen = out.reduce(function(m, r) { return Math.max(m, String(r[6]).length); }, 0);
  Logger.log('ГОТОВО. Агрегат: ' + out.length + ' клиентов | ' + totalOrders + ' заказов | выручка ' + Math.round(totalRevenue));
  Logger.log('Самая большая JSON-ячейка "ПоДням": ' + maxDailyLen + ' символов (лимит ячейки Google Sheets - 50 000)');
  Logger.log('Время выполнения: ' + Math.round((Date.now() - startTime) / 1000) + ' сек');
}
