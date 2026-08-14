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

// Влад, 2026-08-14: "мне ведь пока нужны только данные за 26 год" - незачем читать и
// обрабатывать 2020-2025 (основная масса из 112 тыс. строк), если конечная цель - только
// наличка за январь-май 2026 для сравнения с "Поступлениями". Сырой лист отсортирован по
// дате по возрастанию (проверено визуально) - findRawStartRowForYear_() ниже находит первую
// строку с этой датой ОДНИМ лёгким чтением единственной колонки "Начало" (не всех 46) и
// свежий старт normalizeClientHistory() начинается сразу оттуда, а не с строки 2.
const HISTORY_SCAN_MIN_DATE = '2026-01-01';

const INTERNAL_CLIENTS = [
  'ТЕХНО ПАРК', 'ОТДЕЛ БУРОВЫХ РАБОТ', 'КРАНМАСТЕР',
  'МЕГАКРАН', 'БАЗА ДМД', 'БУЛЬДОГ ООО',
  // 'БАЗА' убрано 2026-08-14 (Влад: "Автобаза 2020 это клиент, остальные внутренние") -
  // короткое слово случайно резало реального клиента "АВТОБАЗА 2020 ООО" по совпадению
  // подстроки. "БАЗА ДМД" (выше) - точное совпадение, настоящий внутренний КА, остаётся.
  'УМИАТ ЯРД', // Влад, 2026-07-05: решено исключить - см. ту же правку в full_script_final.js
  'ОТДЕЛ ЭКСКАВАТОРОВ ДМД', 'ОТДЕЛ КРАНОВ ДМД', 'ТД ЯРД' // Влад, 2026-07-06: старые внутренние КА, сейчас это ТЕХНО ПАРК (НАШ)
];

// Влад, 2026-08-14: "выручка не бьётся с реальными данными" - причина найдена через
// diagnoseCashExclusions2026(): 5 бывших сотрудников отдела (январь-май 2026), которых нет
// в этих списках (списки отражают ТЕКУЩИЙ состав, не исторический) - их строки целиком
// отсеивались фильтром "не отдел тралов", вместе с выручкой И наличкой. Роли подтверждены
// Владом явно (не угадано): Васёв/Каспарова/Фидан - менеджеры, Горбачев/Свешников - логисты.
// Только в этом файле (историческая мега-база) - не трогает текущую зарплату/
// live-фильтрацию в full_script_final.js, та работает с ТЕКУЩИМ составом, отдельный вопрос.
const TRAL_MANAGERS = [
  'Ахтамова', 'Гусейнова', 'Цуцурин',
  'Котельников', 'Цегельников', 'Гуляева', 'Гуштюк',
  'Дербенцева', 'Савиток', 'Филипчук', 'Шейко',
  'Коньшина', 'Володин', 'Прус-Роскошный',
  'Рыщанов', 'Суркова',
  'Васёв', 'Каспарова', 'Фидан', // бывшие сотрудники (янв-май 2026), см. комментарий выше
];

const TRAL_LOGISTS = [
  'Васин', 'Кан', 'Махура', 'Сильчев',
  'Прус-Роскошный', 'Рыщанов', 'Ахтамова', 'Гусейнова',
  'Горбачев', 'Свешников', // бывшие сотрудники (янв-май 2026), см. комментарий выше
];

function inList_(name, list) {
  const n = String(name || '');
  return list.some(function(m) { return n.indexOf(m) >= 0; });
}

function parseNum_(val) {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

// 0-based индекс колонки -> буква A1 (0->A, 25->Z, 26->AA...) - для логов, чтобы можно было
// глазами свериться с реальным столбцом в Google Таблице (2026-08-13, из-за бага с
// задвоенным заголовком "Наличные" - см. normalizeClientHistory()).
function colLetter_(index) {
  let n = index + 1, s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
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

// Уменьшено с 10000 (2026-08-13, Влад: "Out of memory error" на прогоне после добавления
// колонки "Наличные") - сырой лист "Лист_1" широкий (~46 колонок), 10000 строк × 46 колонок
// разом в памяти V8-песочницы Apps Script оказалось слишком много. Меньше строк за раз -
// больше итераций до готовности, но каждая легче и надёжнее.
const READ_BATCH_SIZE = 3000;
// Оставляем запас до жёсткого 6-минутного лимита Apps Script - на финальную сводку и
// форматирование тоже нужно время, поэтому не расходуем весь бюджет на чтение/запись.
const TIME_BUDGET_MS = 4.5 * 60 * 1000;

const PROP_NEXT_ROW = 'histNorm_nextRow';
const PROP_COUNTERS = 'histNorm_counters';

// Бинарный поиск по колонке "Начало" - сырой лист отсортирован по дате по возрастанию.
// ПЕРЕДЕЛАНО 2026-08-14: первая версия читала ВСЮ колонку одним getRange().getValues() на
// 112 тыс. строк - у Влада упало по "Exceeded maximum execution time" (~6 минут) ДО начала
// основного цикла, где нет защиты по времени вообще. Бинарный поиск читает ПО ОДНОЙ ячейке
// за раз (~17 обращений вместо 112 тыс.) - на порядок быстрее и не рискует таймаутом.
function findRawStartRowForYear_(raw, col, minDate) {
  const dateColIdx = col['Начало'];
  if (dateColIdx === undefined) return 2;
  const lastRow = raw.getLastRow();
  let lo = 2, hi = lastRow;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const val = raw.getRange(mid, dateColIdx + 1, 1, 1).getValue();
    const d = formatDate_(val);
    // Пустая/нераспознанная дата в середине диапазона (редкие служебные строки) - считаем
    // "раньше" искомой даты, чтобы поиск сдвигался вправо и не залипал - в худшем случае
    // вернёт строку на несколько позиций раньше нужной, не потеря данных.
    if (d && d >= minDate) hi = mid; else lo = mid + 1;
  }
  Logger.log('Первая строка с датой >= ' + minDate + ': строка ' + lo + ' (бинарный поиск - сырой лист отсортирован по дате по возрастанию).');
  return lo;
}

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
  const dupeHeaders_ = []; // для лога - если что-то задвоено, лучше сразу увидеть
  headerRow.forEach(function(h, i) {
    const key = String(h || '').trim();
    if (!key) return;
    // ПЕРВОЕ вхождение выигрывает, а не последнее (2026-08-13, реальный баг у Влада:
    // в сыром листе оказалось ДВА столбца с названием "Наличные" - один настоящий
    // (реалистичные суммы вроде 115 000), второй - какое-то другое поле, совпавшее по
    // имени (значения ~= Сумма/1000, явно не деньги). Раньше col[key]=i без проверки
    // молча брал ПОСЛЕДНИЙ дубль - в данном случае неправильный).
    if (col[key] !== undefined) { dupeHeaders_.push(key + ' (столбец ' + colLetter_(i) + ', уже был в ' + colLetter_(col[key]) + ')'); return; }
    col[key] = i;
  });
  if (dupeHeaders_.length) {
    Logger.log('ВНИМАНИЕ: повторяющиеся заголовки в сыром листе (взят ПЕРВЫЙ по счёту, не последний): ' + dupeHeaders_.join('; '));
  }

  const required = ['Заказчик', 'Менеджер по продажам', 'Менеджер по снабжению', 'Тип техники', 'Сумма', 'Прибыль', 'Начало', 'Номер'];
  const missing = required.filter(function(k) { return col[k] === undefined; });
  if (missing.length) throw new Error('В сыром листе нет колонок: ' + missing.join(', '));

  // Наличные (2026-08-13, Влад: "осталось наличку с января по май найти и подгрузить, можем
  // подтянуть из мега-базы?") - НЕ в required выше: название колонки НЕ гарантировано - в
  // живом отчёте 1С (Заказы_данные, aggregateOrdersRows) она называется "Оплата нал", но
  // Влад проверил вручную (2026-08-13): в этой исторической выгрузке за прошлые периоды (по
  // май включительно) 1С отдаёт её под другим именем - "Наличные" (столбец AM в сыром
  // "Лист_1"). Проверяем оба варианта названия, первый найденный - в приоритете. Если НИ
  // ОДНОГО из них нет - пишем 0 везде и явно логируем, чтобы не потерять время на молчаливое
  // "наличка почему-то всегда ноль".
  const CASH_COLUMN_ALIASES_ = ['Оплата нал', 'Наличные'];
  const cashColName_ = CASH_COLUMN_ALIASES_.filter(function(k) { return col[k] !== undefined; })[0] || null;
  const hasCashCol = !!cashColName_;
  Logger.log(hasCashCol
    ? 'Колонка "' + cashColName_ + '" найдена в столбце ' + colLetter_(col[cashColName_]) + ' - наличка будет подтянута.'
    : 'ВНИМАНИЕ: ни одной из колонок (' + CASH_COLUMN_ALIASES_.join(', ') + ') в сыром листе нет - наличка за этот период недоступна в исходнике, будет 0 у всех строк.');

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
    const outHeaders = ['Номер', 'Заказчик', 'Менеджер по продажам', 'Менеджер по снабжению', 'Тип техники', 'Сумма', 'Прибыль', 'Начало', 'Наличные'];
    clean.getRange(1, 1, 1, outHeaders.length).setValues([outHeaders]).setFontWeight('bold');
    clean.setFrozenRows(1);
    // Влад, 2026-08-14: "мне ведь пока нужны только данные за 26 год" - пропускаем 2020-2025
    // одним лёгким сканированием, не читая все 46 колонок ради строк, которые всё равно
    // выбросим по HISTORY_SCAN_MIN_DATE.
    nextRow = findRawStartRowForYear_(raw, col, HISTORY_SCAN_MIN_DATE);
    counters = {
      totalRows: 0, cutoffExcludedRows: 0, internalRows: 0, internalRevenue: 0,
      otherDeptRows: 0, adminOrEmptyRows: 0, tagLeakRows: 0, tagLeakRevenue: 0, maxDate: ''
    };
    Logger.log('Начинаем со строки ' + nextRow + ' (' + (lastRow - nextRow + 1) + ' строк подлежит обработке из ' + (lastRow - 1) + ' всего в сыром листе)');
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
      const cash = hasCashCol ? parseNum_(row[col[cashColName_]]) : 0;

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
      out.push([orderId, customer, mgrSales, mgrSupply, equipType, revenue, profit, dateStr, cash]);
    }

    if (out.length) {
      const writeRow = clean.getLastRow() + 1;
      clean.getRange(writeRow, 1, out.length, 9).setValues(out);
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
  let totalCash = 0;
  if (writtenRows > 0) {
    const customers = clean.getRange(2, 2, writtenRows, 1).getValues();
    const revenues = clean.getRange(2, 6, writtenRows, 1).getValues();
    const cashCol = clean.getRange(2, 9, writtenRows, 1).getValues();
    for (let i = 0; i < writtenRows; i++) {
      uniqueClients[customers[i][0]] = true;
      totalRevenue += revenues[i][0];
      totalCash += cashCol[i][0] || 0;
    }
  }

  Logger.log('ГОТОВО.');
  Logger.log('Обработано строк (начиная с ' + HISTORY_SCAN_MIN_DATE + '): ' + counters.totalRows);
  Logger.log('Исключено (позже ' + HISTORY_CUTOFF + ' - приоритет живых данных дашборда за июнь+): ' + counters.cutoffExcludedRows);
  Logger.log('Исключено (внутренние компании из INTERNAL_CLIENTS): ' + counters.internalRows + ', выручка ' + Math.round(counters.internalRevenue));
  Logger.log('Исключено (не отдел тралов/грузоперевозок): ' + counters.otherDeptRows);
  Logger.log('Исключено (служебные/пустые/без даты): ' + counters.adminOrEmptyRows);
  Logger.log('ИТОГО чистых строк: ' + writtenRows + ' | клиентов: ' + Object.keys(uniqueClients).length + ' | выручка: ' + Math.round(totalRevenue));
  Logger.log('НАЛИЧНЫЕ (за весь период до ' + HISTORY_CUTOFF + '): ' + Math.round(totalCash) +
    (hasCashCol ? ' (колонка "' + cashColName_ + '")' : ' - ни одной колонки налички в исходнике не было, это ожидаемый ноль'));
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

// Диагностика (2026-08-14, Влад отфильтровал в самой Таблице ненулевые "Наличные" - 3828
// строк по всему листу, включая заметные суммы в диапазоне 2026 года, а normalizeClientHistory()
// в тот же диапазон дал всего 2683 ₽ суммарно - разница слишком большая, чтобы поверить на
// слово, нужно увидеть ПОЧЕМУ строки отсеиваются). Читает ТОЛЬКО диапазон 2026 года (тот же
// findRawStartRowForYear_, что и normalizeClientHistory()), НИЧЕГО не пишет - только логирует
// разбивку: сколько строк/наличности ушло в каждую причину исключения + примеры первых строк
// каждой категории, чтобы можно было сверить с тем, что видно глазами в самой Таблице.
function diagnoseCashExclusions2026() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const raw = ss.getSheetByName(RAW_SHEET_NAME);
  if (!raw) throw new Error('Лист "' + RAW_SHEET_NAME + '" не найден');

  const lastRow = raw.getLastRow();
  const lastCol = raw.getLastColumn();
  const headerRow = raw.getRange(1, 1, 1, lastCol).getValues()[0];
  const col = {};
  headerRow.forEach(function(h, i) {
    const key = String(h || '').trim();
    if (key && col[key] === undefined) col[key] = i;
  });
  const cashColName_ = ['Оплата нал', 'Наличные'].filter(function(k) { return col[k] !== undefined; })[0];
  if (!cashColName_) { Logger.log('Колонка налички не найдена вообще - нечего диагностировать.'); return; }
  Logger.log('Колонка налички: "' + cashColName_ + '" в столбце ' + colLetter_(col[cashColName_]));

  const ADMIN_VALUES = { 'РЕМОНТ': true, 'БЕЗ ВОДИТЕЛЯ': true, '': true };
  const startRow = findRawStartRowForYear_(raw, col, HISTORY_SCAN_MIN_DATE);
  const numRows = lastRow - startRow + 1;
  Logger.log('Диапазон для диагностики: строки ' + startRow + '-' + lastRow + ' (' + numRows + ' строк).');

  const batch = raw.getRange(startRow, 1, numRows, lastCol).getValues();
  const buckets = {
    included:   { count: 0, cash: 0, examples: [] },
    adminEmpty: { count: 0, cash: 0, examples: [] },
    afterCutoff:{ count: 0, cash: 0, examples: [] },
    internal:   { count: 0, cash: 0, examples: [] },
    otherDept:  { count: 0, cash: 0, examples: [] },
  };
  function pushExample_(bucket, rowNum, row, dateStr, cash) {
    if (bucket.examples.length < 5) {
      bucket.examples.push('стр.' + rowNum + ': дата=' + dateStr + ' менеджер_прод="' + String(row[col['Менеджер по продажам']] || '') +
        '" менеджер_снаб="' + String(row[col['Менеджер по снабжению']] || '') + '" наличка=' + cash);
    }
  }

  for (let i = 0; i < batch.length; i++) {
    const row = batch[i];
    const rowNum = startRow + i;
    const customer = String(row[col['Заказчик']] || '').trim();
    const dateStr = formatDate_(row[col['Начало']]);
    const cash = parseNum_(row[col[cashColName_]]);
    const mgrSales = String(row[col['Менеджер по продажам']] || '').trim();
    const mgrSupply = String(row[col['Менеджер по снабжению']] || '').trim();

    let bucket;
    if (!customer || ADMIN_VALUES[customer] || !dateStr) bucket = buckets.adminEmpty;
    else if (dateStr > HISTORY_CUTOFF) bucket = buckets.afterCutoff;
    else if (inList_(customer, INTERNAL_CLIENTS)) bucket = buckets.internal;
    else if (!(inList_(mgrSales, TRAL_MANAGERS) || inList_(mgrSupply, TRAL_LOGISTS))) bucket = buckets.otherDept;
    else bucket = buckets.included;

    bucket.count++;
    bucket.cash += cash;
    if (cash > 0) pushExample_(bucket, rowNum, row, dateStr, cash);
  }

  Logger.log('=== ИТОГО ПО ПРИЧИНАМ (строк / сумма налички) ===');
  Logger.log('Включено в чистые данные: ' + buckets.included.count + ' строк, наличка ' + Math.round(buckets.included.cash));
  Logger.log('Исключено (пусто/служебное): ' + buckets.adminEmpty.count + ' строк, наличка ' + Math.round(buckets.adminEmpty.cash));
  Logger.log('Исключено (позже ' + HISTORY_CUTOFF + '): ' + buckets.afterCutoff.count + ' строк, наличка ' + Math.round(buckets.afterCutoff.cash));
  Logger.log('Исключено (внутренние компании): ' + buckets.internal.count + ' строк, наличка ' + Math.round(buckets.internal.cash));
  Logger.log('Исключено (не отдел тралов - менеджер не в списках): ' + buckets.otherDept.count + ' строк, наличка ' + Math.round(buckets.otherDept.cash));
  Logger.log('=== ПРИМЕРЫ (первые 5 строк с ненулевой наличкой в каждой категории) ===');
  Object.keys(buckets).forEach(function(name) {
    if (buckets[name].examples.length) Logger.log(name + ':\n  ' + buckets[name].examples.join('\n  '));
  });
}

// Диагностика (2026-08-14, Влад сверил с БДР финансистов - "Операционный бюджет тралного
// отдела": январь ДОХОДЫ 19 373 780, февраль 26 277 686, март 39 287 408, апрель 49 278 163,
// май 45 503 067 - наша "Коммерческая выручка" на дашборде за эти месяцы систематически
// НИЖЕ БДР на 3-9 млн ₽/месяц, растущий разрыв, а фикс 5 сотрудников дал всего +468К на все
// 5 месяцев - явно не вся причина). Показывает ПО КАЖДОМУ МЕСЯЦУ отдельно (не общей суммой,
// как diagnoseCashExclusions2026): включённая выручка (для прямой сверки со строками БДР) +
// список КОНКРЕТНЫХ клиентов в "внутренние" (подозрение - INTERNAL_CLIENTS слишком широкий,
// например 'БАЗА' - короткое слово, может случайно резать реального клиента по подстроке).
function diagnoseRevenueVsBDR2026() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const raw = ss.getSheetByName(RAW_SHEET_NAME);
  if (!raw) throw new Error('Лист "' + RAW_SHEET_NAME + '" не найден');

  const lastRow = raw.getLastRow();
  const lastCol = raw.getLastColumn();
  const headerRow = raw.getRange(1, 1, 1, lastCol).getValues()[0];
  const col = {};
  headerRow.forEach(function(h, i) {
    const key = String(h || '').trim();
    if (key && col[key] === undefined) col[key] = i;
  });
  const ADMIN_VALUES = { 'РЕМОНТ': true, 'БЕЗ ВОДИТЕЛЯ': true, '': true };
  const startRow = findRawStartRowForYear_(raw, col, HISTORY_SCAN_MIN_DATE);
  const numRows = lastRow - startRow + 1;
  const batch = raw.getRange(startRow, 1, numRows, lastCol).getValues();

  // Помесячно (2026-01..2026-05) - выручка included + разбивка исключений.
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];
  const byMonth = {};
  months.forEach(function(m) { byMonth[m] = { included: 0, internal: 0, otherDept: 0, adminEmpty: 0 }; });
  // Кто именно попал во "внутренние" - суммарно по клиенту за весь период (не по месяцу,
  // чтобы список был компактным и его было легко глазами оценить целиком).
  const internalByCustomer = {};

  for (let i = 0; i < batch.length; i++) {
    const row = batch[i];
    const customer = String(row[col['Заказчик']] || '').trim();
    const dateStr = formatDate_(row[col['Начало']]);
    const revenue = parseNum_(row[col['Сумма']]);
    const mgrSales = String(row[col['Менеджер по продажам']] || '').trim();
    const mgrSupply = String(row[col['Менеджер по снабжению']] || '').trim();
    const mk = dateStr ? dateStr.slice(0, 7) : '';

    if (!customer || ADMIN_VALUES[customer] || !dateStr) { if (byMonth[mk]) byMonth[mk].adminEmpty += revenue; continue; }
    if (dateStr > HISTORY_CUTOFF) continue; // после мая - не в нашем разборе (2026-06+)
    if (!byMonth[mk]) continue; // защита - если вдруг дата за пределами янв-май
    if (inList_(customer, INTERNAL_CLIENTS)) {
      byMonth[mk].internal += revenue;
      if (!internalByCustomer[customer]) internalByCustomer[customer] = { count: 0, revenue: 0 };
      internalByCustomer[customer].count++;
      internalByCustomer[customer].revenue += revenue;
      continue;
    }
    if (!(inList_(mgrSales, TRAL_MANAGERS) || inList_(mgrSupply, TRAL_LOGISTS))) { byMonth[mk].otherDept += revenue; continue; }
    byMonth[mk].included += revenue;
  }

  Logger.log('=== ВЫРУЧКА ПО МЕСЯЦАМ (сверка с БДР - "ДОХОДЫ" построчно) ===');
  months.forEach(function(m) {
    const b = byMonth[m];
    Logger.log(m + ': включено=' + Math.round(b.included) + ' | внутренние=' + Math.round(b.internal) +
      ' | не-тралы=' + Math.round(b.otherDept) + ' | пусто/служебное=' + Math.round(b.adminEmpty));
  });

  Logger.log('=== КТО ПОПАЛ ВО "ВНУТРЕННИЕ" (весь период янв-май, отсортировано по сумме) ===');
  const internalList = Object.keys(internalByCustomer).map(function(name) {
    return { name: name, count: internalByCustomer[name].count, revenue: internalByCustomer[name].revenue };
  }).sort(function(a, b) { return b.revenue - a.revenue; });
  internalList.forEach(function(c) {
    Logger.log('"' + c.name + '" - ' + c.count + ' строк, выручка ' + Math.round(c.revenue));
  });
}

const PROP_VERIFY_NEXT_ROW = 'verifyDates_nextRow';
const PROP_VERIFY_STATE = 'verifyDates_state';
const VERIFY_BATCH_SIZE = 20000; // лёгкий скан (2 колонки, не 46) - можно крупнее пакет

// Влад, 2026-08-14: даже сложив ВСЕ 4 категории (включено+внутренние+не-тралы+пусто) за
// январь получилось 17.16М, а в БДР январь = 19.37М - 2.2М пропадает ЕЩЁ ДО фильтрации по
// менеджерам/внутренним. Гипотеза: findRawStartRowForYear_() бинарным поиском предполагает
// СТРОГУЮ сортировку по дате - если где-то в файле порядок сбивается (например, поздние
// корректировки дописаны в конец не по хронологии), часть январских строк может физически
// лежать РАНЬШЕ строки 108857 и биноар-поиск их просто не увидит. Эта функция - ПОЛНЫЙ
// проход по ВСЕМ 112 тыс. строк (не только предполагаемому диапазону 2026 года), читает
// ТОЛЬКО 2 узкие колонки (Начало, Сумма) - легче полного 46-колоночного чтения, поэтому
// пакет крупнее. Резюмируемая (та же защита от таймаута/OOM, что и normalizeClientHistory) -
// если лог скажет "запусти ещё раз", просто нажми ▶ снова.
function verifyDateSortingAndFullRevenue() {
  const startTime = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const raw = ss.getSheetByName(RAW_SHEET_NAME);
  if (!raw) throw new Error('Лист "' + RAW_SHEET_NAME + '" не найден');
  const lastRow = raw.getLastRow();
  const lastCol = raw.getLastColumn();
  const headerRow = raw.getRange(1, 1, 1, lastCol).getValues()[0];
  const col = {};
  headerRow.forEach(function(h, i) { const key = String(h || '').trim(); if (key && col[key] === undefined) col[key] = i; });
  const dateColIdx = col['Начало'], sumColIdx = col['Сумма'];
  if (dateColIdx === undefined || sumColIdx === undefined) throw new Error('Не найдена колонка "Начало" или "Сумма"');

  const props = PropertiesService.getScriptProperties();
  let nextRow = parseInt(props.getProperty(PROP_VERIFY_NEXT_ROW), 10);
  let state;
  if (!nextRow || nextRow < 2) {
    nextRow = 2;
    state = { byMonth: { '2026-01': 0, '2026-02': 0, '2026-03': 0, '2026-04': 0, '2026-05': 0 },
      countByMonth: { '2026-01': 0, '2026-02': 0, '2026-03': 0, '2026-04': 0, '2026-05': 0 },
      minRow: {}, maxRow: {}, outsideExpectedRange: 0, outsideExpectedRevenue: 0 };
    Logger.log('Начинаем полный проход с начала (' + (lastRow - 1) + ' строк).');
  } else {
    state = JSON.parse(props.getProperty(PROP_VERIFY_STATE));
    Logger.log('Продолжаем с прошлого запуска, строка ' + nextRow + ' из ' + lastRow);
  }

  const EXPECTED_MIN_ROW = 108857, EXPECTED_MAX_ROW = 112754; // диапазон, который сейчас использует normalizeClientHistory()

  while (nextRow <= lastRow && (Date.now() - startTime) < TIME_BUDGET_MS) {
    const numRows = Math.min(VERIFY_BATCH_SIZE, lastRow - nextRow + 1);
    const batch = raw.getRange(nextRow, 1, numRows, lastCol).getValues();
    for (let i = 0; i < batch.length; i++) {
      const rowNum = nextRow + i;
      const d = formatDate_(batch[i][dateColIdx]);
      if (!d) continue;
      const mk = d.slice(0, 7);
      if (state.byMonth[mk] === undefined) continue; // не январь-май 2026 - не наш интерес здесь
      const sum = parseNum_(batch[i][sumColIdx]);
      state.byMonth[mk] += sum;
      state.countByMonth[mk]++;
      if (state.minRow[mk] === undefined || rowNum < state.minRow[mk]) state.minRow[mk] = rowNum;
      if (state.maxRow[mk] === undefined || rowNum > state.maxRow[mk]) state.maxRow[mk] = rowNum;
      if (rowNum < EXPECTED_MIN_ROW || rowNum > EXPECTED_MAX_ROW) {
        state.outsideExpectedRange++;
        state.outsideExpectedRevenue += sum;
      }
    }
    nextRow += numRows;
    props.setProperty(PROP_VERIFY_NEXT_ROW, String(nextRow));
    props.setProperty(PROP_VERIFY_STATE, JSON.stringify(state));
    Logger.log('Обработано до строки ' + (nextRow - 1) + ' из ' + lastRow + ' (' + Math.round((Date.now() - startTime) / 1000) + ' сек)');
  }

  if (nextRow <= lastRow) {
    Logger.log('Время вышло, прогресс сохранён - ЗАПУСТИ verifyDateSortingAndFullRevenue() ЕЩЁ РАЗ.');
    return;
  }

  Logger.log('=== ГОТОВО - полная (без binary search) сверка по всем ' + (lastRow - 1) + ' строкам ===');
  Object.keys(state.byMonth).forEach(function(m) {
    Logger.log(m + ': выручка=' + Math.round(state.byMonth[m]) + ' (' + state.countByMonth[m] + ' строк), ' +
      'строки ' + (state.minRow[m] || '-') + '..' + (state.maxRow[m] || '-'));
  });
  Logger.log('Строк с датой янв-май 2026, но ВНЕ ожидаемого диапазона ' + EXPECTED_MIN_ROW + '-' + EXPECTED_MAX_ROW + ': ' +
    state.outsideExpectedRange + ' строк, выручка ' + Math.round(state.outsideExpectedRevenue) +
    (state.outsideExpectedRange > 0 ? ' - ВОТ ГДЕ ПРОПАВШИЕ ДЕНЬГИ, сортировка по дате не строгая!' : ' - сортировка подтверждена, дело не в этом.'));

  props.deleteProperty(PROP_VERIFY_NEXT_ROW);
  props.deleteProperty(PROP_VERIFY_STATE);
}

// Если нужно начать verifyDateSortingAndFullRevenue() заново (например, посреди прогона
// поменялся файл) - запусти один раз перед повторным запуском.
function resetVerifyDateSortingProgress() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(PROP_VERIFY_NEXT_ROW);
  props.deleteProperty(PROP_VERIFY_STATE);
  Logger.log('Прогресс сброшен.');
}

// Защита от "Out of memory error" в середине normalizeClientHistory() (2026-08-13, реальный
// случай у Влада) - каждый пакет сначала ЗАПИСЫВАЕТСЯ в лист, и только ПОСЛЕ этого прогресс
// сохраняется в PropertiesService. Если сбой произошёл ровно между этими двумя шагами, при
// повторном запуске тот же пакет обработается и запишется ЕЩЁ РАЗ - в листе появятся
// дублирующиеся строки (полностью идентичные по всем 9 колонкам). Запусти ОДИН РАЗ после
// того, как normalizeClientHistory() отчитается "ГОТОВО" (не раньше - до этого лист ещё не
// полный, дедуп по частичным данным ничего не даст).
function dedupeClientHistoryRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const clean = ss.getSheetByName(CLEAN_SHEET_NAME);
  if (!clean || clean.getLastRow() < 2) { Logger.log('Лист "' + CLEAN_SHEET_NAME + '" пуст или не найден.'); return; }

  const lastRow = clean.getLastRow();
  const data = clean.getRange(2, 1, lastRow - 1, 9).getValues();
  const seen = {};
  const kept = [];
  let dupCount = 0;

  data.forEach(function(row) {
    // Составной ключ по ВСЕМ 9 колонкам - легитимная многострочная разбивка одного заказа
    // (тот же "Номер" несколько раз) обычно отличается хотя бы Суммой/Типом техники, поэтому
    // точное совпадение по всем полям - надёжный признак именно случайного задвоения пакета,
    // а не двух разных настоящих строк одного заказа.
    const key = row.join('|');
    if (seen[key]) { dupCount++; return; }
    seen[key] = true;
    kept.push(row);
  });

  if (dupCount === 0) {
    Logger.log('Дублей не найдено (' + (lastRow - 1) + ' строк проверено) - ничего не изменено.');
    return;
  }

  clean.getRange(2, 1, lastRow - 1, 9).clearContent();
  if (kept.length) clean.getRange(2, 1, kept.length, 9).setValues(kept);
  Logger.log('Удалено дублей: ' + dupCount + '. Было ' + (lastRow - 1) + ' строк, стало ' + kept.length + '.');
  Logger.log('ВАЖНО: после этого нужно заново запустить buildClientHistoryAggregate() - агрегат ещё построен по старым (с дублями) данным.');
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

  // byCustomer[name] = { orders, revenue, profit, first, last, lastManager,
  //                       daily: { 'YYYY-MM-DD': {o,r,p} } }
  // lastManager - "Менеджер по продажам" привязанный к САМОМУ ПОЗДНЕМУ заказу клиента -
  // Влад, 2026-07-07: "после колонки клиент нужен ответственный менеджер" на дашборде.
  const byCustomer = {};

  for (let batchStart = 2; batchStart <= lastRow; batchStart += AGG_READ_BATCH_SIZE) {
    const numRows = Math.min(AGG_READ_BATCH_SIZE, lastRow - batchStart + 1);
    // Колонки очищенного листа: Номер(1), Заказчик(2), Менеджер по продажам(3),
    // Менеджер по снабжению(4), Тип техники(5), Сумма(6), Прибыль(7), Начало(8), Наличные(9)
    // - последняя добавлена 2026-08-13, см. normalizeClientHistory().
    const batch = clean.getRange(batchStart, 2, numRows, 8).getValues(); // Заказчик..Наличные

    for (let i = 0; i < batch.length; i++) {
      const row = batch[i];
      const name = String(row[0] || '').trim();
      if (!name) continue;
      const mgrSales = String(row[1] || '').trim();
      const revenue = parseNum_(row[4]);
      const profit  = parseNum_(row[5]);
      const dateStr = formatDate_(row[6]);
      const cash    = parseNum_(row[7]);
      if (!dateStr) continue;

      if (!byCustomer[name]) {
        byCustomer[name] = { orders: 0, revenue: 0, profit: 0, cash: 0, first: dateStr, last: dateStr, lastManager: mgrSales, daily: {} };
      }
      const c = byCustomer[name];
      c.orders++;
      c.revenue += revenue;
      c.profit  += profit;
      c.cash    += cash;
      if (dateStr < c.first) c.first = dateStr;
      if (dateStr >= c.last) { c.last = dateStr; c.lastManager = mgrSales; }
      if (!c.daily[dateStr]) c.daily[dateStr] = { o: 0, r: 0, p: 0, c: 0 };
      c.daily[dateStr].o++;
      c.daily[dateStr].r += revenue;
      c.daily[dateStr].p += profit;
      c.daily[dateStr].c += cash;
    }
    Logger.log('Обработано строк: ' + Math.min(batchStart - 2 + numRows, lastRow - 1) + ' из ' + (lastRow - 1) + ' (' + Math.round((Date.now() - startTime) / 1000) + ' сек)');
  }

  const names = Object.keys(byCustomer);
  Logger.log('Уникальных клиентов: ' + names.length);

  let agg = ss.getSheetByName(AGGREGATE_SHEET_NAME);
  if (agg) agg.clear();
  else agg = ss.insertSheet(AGGREGATE_SHEET_NAME);

  // "Наличные" - строго В КОНЕЦ (после "ПоДням"), не сдвигает индексы остальных полей,
  // которые уже читает getClientHistoryAggregate_() в full_script_final.js.
  const outHeaders = ['Заказчик', 'Заказов', 'Выручка', 'Прибыль', 'Первый_заказ', 'Последний_заказ', 'Менеджер', 'ПоДням', 'Наличные'];
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
      roundedDaily[date] = { o: d.o, r: Math.round(d.r), p: Math.round(d.p), c: Math.round(d.c || 0) };
    });
    let json = JSON.stringify(roundedDaily);
    if (json.length > CELL_LIMIT_SAFE) {
      const weekly = {};
      Object.keys(c.daily).forEach(function(date) {
        const wk = weekStartKey_(date);
        const d = c.daily[date];
        if (!weekly[wk]) weekly[wk] = { o: 0, r: 0, p: 0, c: 0 };
        weekly[wk].o += d.o; weekly[wk].r += d.r; weekly[wk].p += d.p; weekly[wk].c += (d.c || 0);
      });
      Object.keys(weekly).forEach(function(wk) {
        weekly[wk].r = Math.round(weekly[wk].r);
        weekly[wk].p = Math.round(weekly[wk].p);
        weekly[wk].c = Math.round(weekly[wk].c);
      });
      const weeklyJson = JSON.stringify(weekly);
      Logger.log('ВНИМАНИЕ: "' + name + '" - дневная разбивка (' + Object.keys(roundedDaily).length +
        ' дней, ' + json.length + ' симв.) не влезла в ячейку, свёрнута в недельную (' +
        Object.keys(weekly).length + ' недель, ' + weeklyJson.length + ' симв.)');
      json = weeklyJson;
      degradedCount++;
    }
    return [name, c.orders, Math.round(c.revenue), Math.round(c.profit), c.first, c.last, c.lastManager, json, Math.round(c.cash || 0)];
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
  const maxDailyLen = out.reduce(function(m, r) { return Math.max(m, String(r[7]).length); }, 0);
  Logger.log('ГОТОВО. Агрегат: ' + out.length + ' клиентов | ' + totalOrders + ' заказов | выручка ' + Math.round(totalRevenue));
  Logger.log('Самая большая JSON-ячейка "ПоДням": ' + maxDailyLen + ' символов (лимит ячейки Google Sheets - 50 000)');
  Logger.log('Время выполнения: ' + Math.round((Date.now() - startTime) / 1000) + ' сек');
}
