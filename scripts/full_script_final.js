// ═══════════════════════════════════════════════════════════════════════════
// 📌 ОГЛАВЛЕНИЕ - функции для ручного запуска (Влад, 2026-08-13: "не удобно листать искать").
// Как найти нужную: Ctrl+F по названию функции в этом файле - сразу перейдёшь к коду. В
// самом редакторе Apps Script имя есть и в выпадающем списке "Выполнить" сверху - начни его
// печатать, список сам предложит совпадения (не обязательно листать весь список глазами).
//
// Файл большой (~90 функций без "_" в конце - подчёркивание в конце имени специально
// скрывает функцию из списка "Выполнить", это внутренние помощники, их руками не запускают).
// Подавляющее большинство функций НИЖЕ этого блока - НЕ из списка ниже: это разовые
// диагностические/фиксовые скрипты под конкретные инциденты прошлого (Bitrix24, дедуп
// заказов и т.п.), почти все уже отработали своё и оставлены на случай повтора той же
// проблемы. Актуальные для РЕГУЛЯРНОЙ работы - вот они:
//
// ЕЖЕДНЕВНЫЙ ПАЙПЛАЙН (и так работает по расписанию 6 раз в день - вручную нужен только
// для принудительного повторного прогона/отладки конкретного шага):
//   runAll()                    - обновить всё разом (парк, заказы, ДЗ, Поступления, Telegram)
//   importReceiptsReport()      - импорт отчёта "Поступления" (уже часть runAll)
//   importDebtReport()          - импорт отчёта ДЗ (уже часть runAll)
//   importOrdersReport()        - импорт заказов (уже часть runAll)
//   importParkReports()         - импорт отчёта "Парк" (уже часть runAll)
//
// НАСТРОЙКА (запускается один раз - при первой настройке или после смены конфигурации):
//   setupTrigger()               - переустановить расписание runAll (6:05/9:05/12:05/15:05/18:05/21:05 мск)
//   setupAccessSheet()           - создать/обновить лист "Доступ" (список email -> роль)
//   setupShtatkaAutoMigration()  - настроить автопереход "Штатки" в историю по месяцам
//
// ПО ЗАПРОСУ (запускать вручную, когда нужно досчитать/поправить задним числом):
//   backfillMonthSummaries()     - пересчитать "История_месяцев" по всем месяцам с архивом
//                                  заказов (Заказы_YYYY-MM) - нужно после добавления новой
//                                  колонки в сводку ИЛИ если появился архив за старый месяц
//
// Если нужной функции нет в списке выше - она почти наверняка есть в файле, просто это
// разовый скрипт под старую задачу: Ctrl+F по имени найдёт её в любом случае.
// ═══════════════════════════════════════════════════════════════════════════

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
// БИТРИКС24 — источник лидов/сделок (Авито/сайт/звонки), см.
// plans/2026-07-12-bitrix24-crm-integration.md
// ============================================================
// Входящий вебхук НЕ хранится в коде (это секрет, права ограничены только
// CRM + user_brief). Задаётся один раз в редакторе Apps Script:
//   Настройки проекта (шестерёнка) → Свойства скрипта → Добавить свойство
//   Имя: BITRIX24_WEBHOOK_URL | Значение: https://b24-XXXXXX.bitrix24.ru/rest/1/XXXXXXXXXXXXXXXX/
function getBitrixWebhookUrl_() {
  var url = PropertiesService.getScriptProperties().getProperty('BITRIX24_WEBHOOK_URL');
  if (!url) {
    throw new Error('BITRIX24_WEBHOOK_URL не задан. Настройки проекта → Свойства скрипта → добавь BITRIX24_WEBHOOK_URL.');
  }
  return url;
}

function bitrixCall_(method, params) {
  var url = getBitrixWebhookUrl_() + method + '.json';
  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(params || {}),
    muteHttpExceptions: true,
  });
  var body = JSON.parse(resp.getContentText());
  if (body.error) {
    throw new Error('Bitrix24 API (' + method + '): ' + body.error + ' - ' + (body.error_description || ''));
  }
  return body;
}

// Разворачивает вложенный объект в плоский вид с квадратными скобками, как ждёт PHP:
// {fields: {LIST: {n0: {VALUE: 'x'}}}} -> {'fields[LIST][n0][VALUE]': 'x'}
function flattenParams_(obj, prefix, out) {
  Object.keys(obj).forEach(function (k) {
    var key = prefix ? prefix + '[' + k + ']' : k;
    var v = obj[k];
    if (v !== null && typeof v === 'object') flattenParams_(v, key, out);
    else out[key] = v;
  });
  return out;
}

// Тот же вызов, но form-urlencoded вместо JSON. Методы crm.*.userfield.* не понимают
// вложенный JSON (молча отвечают result:true и ничего не делают, либо ругаются, что
// обязательное поле не найдено) - им нужен именно PHP-формат fields[KEY][sub].
// Проверено на живом портале 2026-07-16: JSON-вариант создал поля БЕЗ подписей и
// БЕЗ значений списка, из-за чего они не отрисовывались на карточке вообще.
function bitrixCallForm_(method, params) {
  var url = getBitrixWebhookUrl_() + method + '.json';
  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    payload: flattenParams_(params || {}, '', {}),
    muteHttpExceptions: true,
  });
  var body = JSON.parse(resp.getContentText());
  if (body.error) {
    throw new Error('Bitrix24 API (' + method + '): ' + body.error + ' - ' + (body.error_description || ''));
  }
  return body;
}

// Постранично забирает все сделки (Битрикс24 отдаёт по 50 за раз через поле "next").
function getBitrixDeals_() {
  var deals = [];
  var start = 0;
  while (true) {
    var body = bitrixCall_('crm.deal.list', {
      select: ['ID', 'TITLE', 'SOURCE_ID', 'STAGE_ID', 'STAGE_SEMANTIC_ID', 'CATEGORY_ID', 'DATE_CREATE', 'DATE_MODIFY', 'OPPORTUNITY', 'ASSIGNED_BY_ID', 'CLOSED', 'UF_CRM_LOSE_REASON', 'UF_CRM_ORDER_1C_ID'],
      start: start,
    });
    deals = deals.concat(body.result);
    if (body.next === undefined || body.next === null) break;
    start = body.next;
  }
  return deals;
}

// Сводка по лидам/сделкам для вкладки "Маркетинг". Стадии пока не размечены как
// успех/отказ/отложено (Влад настраивает воронку в Битрикс24 отдельно, см. план) -
// считаем сырые счётчики по SOURCE_ID/STAGE_ID, детальную классификацию добавим
// когда воронка будет зафиксирована.
function getBitrixMarketingData_() {
  var deals = getBitrixDeals_();

  var bySource = {};
  var byStage = {};
  // Раньше тут была одна сумма revenueTotal по ВСЕМ сделкам подряд - включая
  // открытые и отказы. Получалось число, которое выглядит как выручка, но ей не
  // является (2,99 млн при реальных 183 тыс закрытых). Разделено на три:
  // wonRevenue - реально закрытые деньги, pipelineOpen - что ещё в работе,
  // lostAmount - сколько унесли отказы.
  var wonRevenue = 0;
  var pipelineOpen = 0;
  var lostAmount = 0;

  deals.forEach(function (d) {
    var source = d.SOURCE_ID || 'Не указан';
    bySource[source] = (bySource[source] || 0) + 1;

    var stage = d.STAGE_ID || 'Не указан';
    byStage[stage] = (byStage[stage] || 0) + 1;

    var sum = parseFloat(d.OPPORTUNITY || 0);
    // STAGE_SEMANTIC_ID: S = успех, F = провал, P = в процессе. Надёжнее, чем
    // сверять STAGE_ID со списком стадий - воронку правят руками, коды стадий
    // вроде UC_YQ3O03 появляются на ходу, а семантика остаётся.
    if (d.STAGE_SEMANTIC_ID === 'S') wonRevenue += sum;
    else if (d.STAGE_SEMANTIC_ID === 'F') lostAmount += sum;
    else pipelineOpen += sum;
  });

  return {
    updated: new Date().toISOString(),
    total: deals.length,
    wonRevenue: wonRevenue,
    pipelineOpen: pipelineOpen,
    lostAmount: lostAmount,
    bySource: bySource,
    byStage: byStage,
  };
}

// Показывает все открытые линии и их ключевые настройки. Читалка, ничего не меняет -
// нужна, чтобы сверять состояние после правок (и потому что с машины Влада прямые
// запросы к Битриксу режет VPN, см. план).
function showBitrixLines() {
  var lines = bitrixCall_('imopenlines.config.list.get', {}).result || [];
  lines.forEach(function (l) {
    Logger.log(
      '[' + l.ID + '] ' + l.LINE_NAME +
      ' | активна: ' + l.ACTIVE +
      ' | распределение: ' + l.QUEUE_TYPE +
      ' | переход, сек: ' + l.QUEUE_TIME +
      ' | проверять доступность: ' + l.CHECK_AVAILABLE +
      ' | лимит чатов: ' + l.MAX_CHAT +
      ' | источник: ' + l.CRM_SOURCE
    );
  });
}

// Чинит мёртвые линии: включает проверку доступности оператора там, где она снята.
// Линии 3 ("Открытая линия 2 (Узнать источник)?") и 5 ("Открытая линия 3") активны,
// но за всё время не привели ни одного лида - при этом у них снята та же галочка,
// из-за которой обращения уходили к отсутствующим сотрудникам. Если туда когда-нибудь
// подключат канал, он не должен наступить на те же грабли.
// НЕ выключает сами линии - выключение живой линии тихо роняет входящие сообщения
// клиентов, это решение Влада, а не моё.
function fixBitrixDeadLines() {
  var lines = bitrixCall_('imopenlines.config.list.get', {}).result || [];
  var fixed = 0;

  lines.forEach(function (l) {
    if (l.CHECK_AVAILABLE === 'Y') return;
    bitrixCall_('imopenlines.config.update', {
      CONFIG_ID: l.ID,
      PARAMS: { CHECK_AVAILABLE: 'Y' }
    });
    Logger.log('Включил проверку доступности: [' + l.ID + '] ' + l.LINE_NAME);
    fixed++;
  });

  if (fixed === 0) Logger.log('Все линии уже с проверкой доступности - править нечего.');

  Logger.log('--- Состояние после правки ---');
  showBitrixLines();
}

// РАЗОВАЯ настройка: заводит поле "Причина брака" на ЛИДЕ и выводит его на карточку.
// Дыра, найденная 2026-07-17: обязательная "Причина отказа" стоит на СДЕЛКЕ (стадия
// ОТКАЗ), но лид, помеченный "Некачественный", сделкой не становится НИКОГДА - умирает
// раньше, и причину никто не спрашивает. На момент находки так молча ушли 12 реальных
// обращений из 31 (плюс 3 теста Влада), то есть каждый третий лид.
// Сразу form-urlencoded: JSON-вызовы crm.*.userfield.* Битрикс принимает (result:true),
// но подписи и значения списка молча игнорирует - обожглись на этом с полями сделки.
// Идемпотентна: если поле уже есть, значения не задваивает.
function setupBitrixLeadJunkReason() {
  var NAME = 'JUNK_REASON';
  var LABEL = 'Причина брака';
  var VALUES = [
    'Спам / реклама',
    'Ошиблись номером',
    'Недозвон - клиент не отвечает',
    'Не наш профиль - не возим такое',
    'Ищет работу',
    'Дубль',
    'Другое'
  ];

  var all = bitrixCall_('crm.lead.userfield.list', {}).result || [];
  var found = all.filter(function (f) { return f.FIELD_NAME === 'UF_CRM_' + NAME; })[0];

  if (!found) {
    var created = bitrixCallForm_('crm.lead.userfield.add', {
      fields: {
        FIELD_NAME: NAME,
        USER_TYPE_ID: 'enumeration',
        XML_ID: NAME,
        MANDATORY: 'N',
        SHOW_FILTER: 'Y',
        SHOW_IN_LIST: 'Y',
        EDIT_IN_LIST: 'Y'
      }
    });
    Logger.log('Поле создано, ID ' + created.result);
    all = bitrixCall_('crm.lead.userfield.list', {}).result || [];
    found = all.filter(function (f) { return f.FIELD_NAME === 'UF_CRM_' + NAME; })[0];
  } else {
    Logger.log('Поле уже есть, ID ' + found.ID + ' - обновляю');
  }

  var before = bitrixCall_('crm.lead.userfield.get', { id: found.ID }).result;

  bitrixCallForm_('crm.lead.userfield.update', {
    id: found.ID,
    fields: {
      EDIT_FORM_LABEL: { ru: LABEL, en: LABEL },
      LIST_COLUMN_LABEL: { ru: LABEL, en: LABEL },
      LIST_FILTER_LABEL: { ru: LABEL, en: LABEL }
    }
  });

  if ((before.LIST || []).length === 0) {
    var listParam = {};
    VALUES.forEach(function (v, i) {
      listParam['n' + i] = { VALUE: v, SORT: String((i + 1) * 10), DEF: 'N' };
    });
    bitrixCallForm_('crm.lead.userfield.update', { id: found.ID, fields: { LIST: listParam } });
  } else {
    Logger.log('Значения списка уже есть (' + before.LIST.length + ') - не трогаю');
  }

  // Выводим на ОБЩИЙ вид карточки лида. Своя карточка менеджерам запрещена правами,
  // поэтому общий вид - единственный, который они увидят.
  var SECTION = 'yard_lead_result';
  var cfg = bitrixCall_('crm.lead.details.configuration.get', { scope: 'C' }).result || [];
  if (!cfg.some(function (s) { return s.name === SECTION; })) {
    var section = {
      name: SECTION,
      title: 'Итог лида',
      type: 'section',
      elements: [{ name: 'UF_CRM_' + NAME, optionFlags: '0' }]
    };
    bitrixCall_('crm.lead.details.configuration.set', { scope: 'C', data: [section].concat(cfg) });
    Logger.log('Секция "Итог лида" добавлена на карточку');
  } else {
    Logger.log('Секция "Итог лида" уже на карточке');
  }

  // Проверяем чтением, а не верим коду ответа
  var after = bitrixCall_('crm.lead.userfield.get', { id: found.ID }).result;
  var vals = (after.LIST || []).map(function (x) { return x.VALUE; });
  var cfgAfter = bitrixCall_('crm.lead.details.configuration.get', { scope: 'C' }).result || [];
  var onCard = cfgAfter.some(function (s) {
    return (s.elements || []).some(function (e) { return e.name === 'UF_CRM_' + NAME; });
  });

  Logger.log('--- ПРОВЕРКА ---');
  Logger.log('Поле: UF_CRM_' + NAME + ' (ID ' + found.ID + ')');
  Logger.log('Значений в списке: ' + vals.length + ' [' + vals.join(' | ') + ']');
  Logger.log('На карточке лида: ' + onCard);
  Logger.log('--- Дальше руками: сделать поле обязательным на статусе "Некачественный" ---');
}

// Показывает роботов/бизнес-процессы на ЛИДАХ и СДЕЛКАХ. Ищем робота, который сам
// создаёт сделку из лида - он бы объяснил четыре пустые сделки, родившиеся 16.07 в
// 16:56-16:58 из четырёх разных лидов без единого звонка.
// Версия про автоперезвон Манго проверена и ОТВЕРГНУТА: в это окно звонили два
// клиента, и оба - НЕ те, по которым задвоились сделки (2026-07-17).
function showBitrixLeadRobots() {
  var TYPES = [
    { title: 'ЛИДЫ',   dt: ['crm', 'CCrmDocumentLead', 'LEAD'] },
    { title: 'СДЕЛКИ', dt: ['crm', 'CCrmDocumentDeal', 'DEAL'] }
  ];

  TYPES.forEach(function (t) {
    Logger.log('=== ' + t.title + ' ===');
    var list;
    try {
      list = bitrixCall_('bizproc.workflow.template.list', {
        select: ['ID', 'NAME', 'DOCUMENT_TYPE', 'AUTO_EXECUTE', 'ACTIVE', 'MODIFIED'],
        filter: { DOCUMENT_TYPE: t.dt }
      }).result || [];
    } catch (e) {
      Logger.log('  ошибка: ' + e.message);
      return;
    }
    if (!list.length) { Logger.log('  шаблонов нет'); return; }
    list.forEach(function (w) {
      Logger.log('  #' + w.ID + ' | ' + w.NAME +
        ' | активен: ' + w.ACTIVE +
        ' | автозапуск: ' + w.AUTO_EXECUTE +
        ' | изменён: ' + (w.MODIFIED || '-'));
    });
  });

  // Триггеры автоматизации CRM - они запускают роботов по внешним событиям
  Logger.log('=== ТРИГГЕРЫ АВТОМАТИЗАЦИИ ===');
  try {
    var trg = bitrixCall_('crm.automation.trigger.list', {}).result || [];
    Logger.log(trg.length ? JSON.stringify(trg) : '  своих триггеров нет');
  } catch (e) {
    Logger.log('  ошибка: ' + e.message);
  }
}

// ПОЛНАЯ РАЗВЕДКА Битрикса - один запуск, весь актуальный снимок. Влад просит
// "зайди и исследуй всё" (2026-07-17). Читалка, ничего не меняет. Идёт через
// Apps Script - прямой curl с машины Влада режет VPN.
function exploreBitrixFull() {
  // --- Справочники: имена стадий, имена людей, названия причин отказа ---
  var stageName = {};
  try {
    (bitrixCall_('crm.dealcategory.stage.list', {}).result || []).forEach(function (s) { stageName[s.STATUS_ID] = s.NAME; });
  } catch (e) { Logger.log('стадии: ' + e.message); }

  var userName = {};
  try {
    (bitrixCall_('user.get', { FILTER: { ACTIVE: 'Y' } }).result || []).forEach(function (u) {
      userName[u.ID] = ((u.LAST_NAME || '') + ' ' + (u.NAME || '')).trim() || u.EMAIL || ('ID' + u.ID);
    });
  } catch (e) { Logger.log('юзеры: ' + e.message); }

  var reasonName = {};
  try {
    var rf = bitrixCall_('crm.deal.userfield.list', { filter: { FIELD_NAME: 'UF_CRM_LOSE_REASON' } }).result || [];
    if (rf[0] && rf[0].LIST) rf[0].LIST.forEach(function (x) { reasonName[x.ID] = x.VALUE; });
  } catch (e) { Logger.log('причины: ' + e.message); }

  var deals = getBitrixDeals_();
  var now = new Date();
  var today = now.toISOString().slice(0, 10);

  Logger.log('╔══════════ СНИМОК БИТРИКСА ' + now.toLocaleString('ru') + ' ══════════╗');
  Logger.log('ВСЕГО СДЕЛОК: ' + deals.length);

  // По стадиям
  var byStage = {}, byStageSum = {};
  deals.forEach(function (d) {
    byStage[d.STAGE_ID] = (byStage[d.STAGE_ID] || 0) + 1;
    byStageSum[d.STAGE_ID] = (byStageSum[d.STAGE_ID] || 0) + parseFloat(d.OPPORTUNITY || 0);
  });
  Logger.log('\n── ВОРОНКА ──');
  Object.keys(byStage).forEach(function (s) {
    Logger.log('  ' + String(byStage[s]).padStart(3) + ' | ' + (stageName[s] || s).slice(0, 30).padEnd(30) + ' | ' + Math.round(byStageSum[s]).toLocaleString('ru') + ' руб');
  });

  // По источникам
  var bySource = {};
  deals.forEach(function (d) { var s = d.SOURCE_ID || '(пусто)'; bySource[s] = (bySource[s] || 0) + 1; });
  Logger.log('\n── ИСТОЧНИКИ ──');
  Object.keys(bySource).sort(function (a, b) { return bySource[b] - bySource[a]; }).forEach(function (s) {
    Logger.log('  ' + String(bySource[s]).padStart(3) + ' | ' + s);
  });

  // По ответственным
  var byUser = {};
  deals.forEach(function (d) { var u = userName[d.ASSIGNED_BY_ID] || ('ID' + d.ASSIGNED_BY_ID); byUser[u] = (byUser[u] || 0) + 1; });
  Logger.log('\n── ПО ОТВЕТСТВЕННЫМ ──');
  Object.keys(byUser).sort(function (a, b) { return byUser[b] - byUser[a]; }).forEach(function (u) {
    Logger.log('  ' + String(byUser[u]).padStart(3) + ' | ' + u);
  });

  // Заполняемость наших полей
  var lost = deals.filter(function (d) { return d.STAGE_ID === 'LOSE'; });
  var won = deals.filter(function (d) { return d.STAGE_ID === 'WON'; });
  var withReason = lost.filter(function (d) { return d.UF_CRM_LOSE_REASON; });
  var with1C = won.filter(function (d) { return d.UF_CRM_ORDER_1C_ID; });
  Logger.log('\n── ДИСЦИПЛИНА ЗАПОЛНЕНИЯ ──');
  Logger.log('  Причина отказа: ' + withReason.length + ' из ' + lost.length + ' отказов');
  Logger.log('  Номер 1С: ' + with1C.length + ' из ' + won.length + ' успешных');

  // Раскладка причин отказа
  if (withReason.length) {
    var byReason = {};
    lost.forEach(function (d) {
      var r = d.UF_CRM_LOSE_REASON ? (reasonName[d.UF_CRM_LOSE_REASON] || d.UF_CRM_LOSE_REASON) : '(не указана)';
      byReason[r] = (byReason[r] || 0) + 1;
    });
    Logger.log('  Раскладка отказов:');
    Object.keys(byReason).sort(function (a, b) { return byReason[b] - byReason[a]; }).forEach(function (r) {
      Logger.log('    ' + String(byReason[r]).padStart(3) + ' | ' + r);
    });
  }

  // Нулевые сделки в NEW (бывшие лиды, разобрать)
  var newZero = deals.filter(function (d) { return d.STAGE_ID === 'NEW' && parseFloat(d.OPPORTUNITY || 0) === 0; });
  Logger.log('\n── К РАЗБОРУ ──');
  Logger.log('  Сделок в "Новые заявки" с суммой 0: ' + newZero.length);

  // Зависшие открытые сделки
  var stale = deals.filter(function (d) {
    if (d.CLOSED === 'Y') return false;
    var mod = new Date(d.DATE_MODIFY);
    return (now - mod) / 86400000 > 2;
  });
  Logger.log('  Открытых сделок без движения >2 дней: ' + stale.length);

  // Дубли
  var byTitle = {};
  deals.forEach(function (d) { (byTitle[d.TITLE] = byTitle[d.TITLE] || []).push(d); });
  var dups = Object.keys(byTitle).filter(function (t) { return byTitle[t].length > 1; });
  Logger.log('  Дублей по названию: ' + dups.length + (dups.length ? ' (' + dups.join('; ') + ')' : ''));

  // Создано сегодня
  Logger.log('  Создано сегодня: ' + deals.filter(function (d) { return (d.DATE_CREATE || '').slice(0, 10) === today; }).length);

  // Активные лиды (должно быть 0 после переключения режима)
  try {
    var leads = bitrixCall_('crm.lead.list', { select: ['ID'], filter: { '!STATUS_ID': ['CONVERTED', 'JUNK'] } }).result || [];
    Logger.log('  Активных лидов: ' + leads.length + ' (после режима "без лидов" должно быть 0)');
  } catch (e) { Logger.log('  лиды: ' + e.message); }

  // Открытые линии
  Logger.log('\n── ОТКРЫТЫЕ ЛИНИИ ──');
  try {
    (bitrixCall_('imopenlines.config.list.get', {}).result || []).forEach(function (l) {
      Logger.log('  [' + l.ID + '] ' + l.LINE_NAME + ' | активна:' + l.ACTIVE + ' | доступность:' + l.CHECK_AVAILABLE + ' | переход,сек:' + l.QUEUE_TIME + ' | источник:' + l.CRM_SOURCE);
    });
  } catch (e) { Logger.log('  линии: ' + e.message); }

  Logger.log('╚═══════════════════════════════════════════════════╝');
}

// Полная сводка после переключения в режим "без лидов" (Влад переключил 2026-07-17).
// При переходе Битрикс конвертирует все лиды в сделки. Проверяем: не потерялось ли,
// не наплодило ли дублей, где теперь висят бывшие лиды, сколько осталось лидов (должно
// быть 0 активных). Читалка, ничего не меняет.
function checkBitrixAfterModeSwitch() {
  var deals = getBitrixDeals_();
  Logger.log('=== ВСЕГО СДЕЛОК: ' + deals.length + ' ===');

  // Разбивка по стадиям
  var byStage = {};
  var byStageSum = {};
  deals.forEach(function (d) {
    var s = d.STAGE_ID;
    byStage[s] = (byStage[s] || 0) + 1;
    byStageSum[s] = (byStageSum[s] || 0) + parseFloat(d.OPPORTUNITY || 0);
  });
  Logger.log('--- ПО СТАДИЯМ ---');
  Object.keys(byStage).forEach(function (s) {
    Logger.log('  ' + String(byStage[s]).padStart(3) + ' | ' + s + ' | сумма: ' + Math.round(byStageSum[s]).toLocaleString('ru'));
  });

  // Разбивка по источникам
  var bySource = {};
  deals.forEach(function (d) { var s = d.SOURCE_ID || '(пусто)'; bySource[s] = (bySource[s] || 0) + 1; });
  Logger.log('--- ПО ИСТОЧНИКАМ ---');
  Object.keys(bySource).sort(function (a, b) { return bySource[b] - bySource[a]; }).forEach(function (s) {
    Logger.log('  ' + String(bySource[s]).padStart(3) + ' | ' + s);
  });

  // Свежие сделки за сегодня (бывшие лиды приезжают с сегодняшней датой модификации)
  var today = new Date().toISOString().slice(0, 10);
  var todayDeals = deals.filter(function (d) { return (d.DATE_CREATE || '').slice(0, 10) === today; });
  Logger.log('--- Создано сегодня (' + today + '): ' + todayDeals.length + ' сделок ---');

  // Дубли по названию
  var byTitle = {};
  deals.forEach(function (d) { (byTitle[d.TITLE] = byTitle[d.TITLE] || []).push(d); });
  var dups = Object.keys(byTitle).filter(function (t) { return byTitle[t].length > 1; });
  Logger.log('--- ДУБЛИ ПО НАЗВАНИЮ: ' + dups.length + ' групп ---');
  dups.forEach(function (t) {
    Logger.log('  "' + t + '" x' + byTitle[t].length + ': #' + byTitle[t].map(function (d) { return d.ID; }).join(', #'));
  });

  // Остались ли активные лиды
  var leads = bitrixCall_('crm.lead.list', { select: ['ID', 'STATUS_ID'], filter: { '!STATUS_ID': ['CONVERTED', 'JUNK'] } }).result || [];
  Logger.log('--- Активных лидов осталось: ' + leads.length + ' (должно быть 0) ---');

  Logger.log('=== Проверь глазами: все сделки на месте, дублей нет, лиды пусты ===');
}

// Проверяет гипотезу про автоперезвон Манго (Влад, 2026-07-17: "Рагим настроил в Манго
// автоперезвон - если пропустили звонок, Манго звонит менеджеру, тот берёт трубку, и
// Манго звонит клиенту"). Если дубли рождает автообзвон, в 16:56-16:58 16.07 должны
// лежать звонки. Если звонков нет - виноват человек, а не система.
// Показывает звонки за 16.07 с 16:30 до 17:10 и кто их создал.
function checkBitrixCallBurst() {
  var from = '2026-07-16T16:30:00+03:00';
  var to   = '2026-07-16T17:10:00+03:00';

  var acts = [];
  var start = 0;
  while (true) {
    var body = bitrixCall_('crm.activity.list', {
      filter: { '>=CREATED': from, '<=CREATED': to },
      select: ['ID', 'SUBJECT', 'TYPE_ID', 'DIRECTION', 'CREATED', 'AUTHOR_ID',
               'OWNER_TYPE_ID', 'OWNER_ID', 'PROVIDER_ID', 'COMPLETED'],
      order: { CREATED: 'ASC' },
      start: start
    });
    acts = acts.concat(body.result || []);
    if (body.next === undefined || body.next === null) break;
    start = body.next;
  }

  Logger.log('Дел/звонков за 16.07 16:30-17:10: ' + acts.length);
  // TYPE_ID: 1=встреча, 2=звонок, 3=задача, 4=письмо. DIRECTION: 1=входящий, 2=исходящий
  var TYPE = { '1': 'встреча', '2': 'ЗВОНОК', '3': 'задача', '4': 'письмо' };
  var DIR  = { '1': 'входящий', '2': 'исходящий' };

  acts.forEach(function (a) {
    Logger.log(
      a.CREATED.slice(11, 16) +
      ' | ' + (TYPE[a.TYPE_ID] || ('тип ' + a.TYPE_ID)) +
      ' | ' + (DIR[a.DIRECTION] || '-') +
      ' | автор: ' + a.AUTHOR_ID +
      ' | ' + (a.PROVIDER_ID || '') +
      ' | ' + String(a.SUBJECT || '').slice(0, 55)
    );
  });

  var calls = acts.filter(function (a) { return String(a.TYPE_ID) === '2'; });
  Logger.log('--- ВЫВОД ---');
  Logger.log('Звонков в этом окне: ' + calls.length);
  Logger.log(calls.length > 0
    ? 'Звонки ЕСТЬ -> версия про автоперезвон Манго правдоподобна'
    : 'Звонков НЕТ -> дубли создал ЧЕЛОВЕК руками, автоперезвон ни при чём');
}

// РАЗОВАЯ чистка: удаляет 6 задвоенных сделок, найденных findBitrixDuplicates
// (Влад разрешил 2026-07-17). Все они - повторная конвертация одного и того же лида:
// четыре пустышки с 0 руб из трёхминутного залпа 16.07 в 16:56-16:58, и две копии
// отказа на 20 000. Оригиналы живы и остаются.
// НЕ трогаю "Дмитрий - Авито чат" (#39/#45) - там РАЗНЫЕ лиды, это может быть
// настоящее повторное обращение, а не дубль. Решает Влад глазами.
// Перед удалением сверяет сделку с ожиданием - если данные разошлись, пропускает.
function cleanBitrixDuplicates() {
  var TO_DELETE = [
    { id: '89', title: '7 495 988-96-97 - Входящий звонок', sum: 0,     stage: 'PREPARATION' },
    { id: '91', title: '7 902 413-19-87 - Входящий звонок', sum: 0,     stage: 'PREPARATION' },
    { id: '93', title: '7 925 460-41-53 - Входящий звонок', sum: 0,     stage: 'PREPARATION' },
    { id: '95', title: '7 925 460-41-53 - Входящий звонок', sum: 0,     stage: 'PREPARATION' },
    { id: '73', title: '7 977 455-51-61 - Входящий звонок', sum: 20000, stage: 'LOSE' },
    { id: '77', title: '7 977 455-51-61 - Входящий звонок', sum: 20000, stage: 'LOSE' }
  ];

  var deleted = 0, skipped = 0;

  TO_DELETE.forEach(function (want) {
    var d;
    try {
      d = bitrixCall_('crm.deal.get', { id: want.id }).result;
    } catch (e) {
      Logger.log('#' + want.id + ': не найдена (уже удалена?) - пропускаю');
      skipped++;
      return;
    }
    if (!d) { Logger.log('#' + want.id + ': пусто - пропускаю'); skipped++; return; }

    var sumNow = Math.round(parseFloat(d.OPPORTUNITY || 0));
    if (d.TITLE !== want.title || sumNow !== want.sum || d.STAGE_ID !== want.stage) {
      Logger.log('#' + want.id + ': ДАННЫЕ РАЗОШЛИСЬ, НЕ УДАЛЯЮ.' +
        ' ожидал [' + want.title + ' | ' + want.sum + ' | ' + want.stage + ']' +
        ' нашёл [' + d.TITLE + ' | ' + sumNow + ' | ' + d.STAGE_ID + ']');
      skipped++;
      return;
    }

    bitrixCall_('crm.deal.delete', { id: want.id });
    Logger.log('УДАЛЕНА #' + want.id + ' | ' + d.TITLE + ' | ' + sumNow + ' руб | ' + d.STAGE_ID);
    deleted++;
  });

  Logger.log('--- Удалено: ' + deleted + ', пропущено: ' + skipped + ' ---');
  Logger.log('--- Проверяю, что дублей больше нет ---');
  findBitrixDuplicates();
}

// Ищет задвоенные сделки и контакты. Влад заметил на канбане две сделки с одним
// номером в одну минуту (2026-07-17). В данных нашлось хуже: "7 977 455-51-61" висит
// ТРИЖДЫ, причём с одинаковой суммой 20 000 - значит размножилась вместе с данными,
// а не заведена заново руками.
// Задача диагностики - понять, откуда растут дубли:
//   разные LEAD_ID -> каждый входящий звонок плодит новый лид (настройки телефонии)
//   один LEAD_ID   -> лид сконвертирован в сделку несколько раз (конвертация)
// Плюс проверяем, не плодятся ли контакты - тогда засоряется клиентская база.
function findBitrixDuplicates() {
  var deals = [];
  var start = 0;
  while (true) {
    var body = bitrixCall_('crm.deal.list', {
      select: ['ID', 'TITLE', 'DATE_CREATE', 'STAGE_ID', 'OPPORTUNITY', 'ASSIGNED_BY_ID',
               'LEAD_ID', 'CONTACT_ID', 'COMPANY_ID', 'SOURCE_ID'],
      order: { ID: 'ASC' },
      start: start
    });
    deals = deals.concat(body.result);
    if (body.next === undefined || body.next === null) break;
    start = body.next;
  }
  Logger.log('Всего сделок: ' + deals.length);

  var byTitle = {};
  deals.forEach(function (d) {
    (byTitle[d.TITLE] = byTitle[d.TITLE] || []).push(d);
  });

  var dups = Object.keys(byTitle).filter(function (t) { return byTitle[t].length > 1; });
  Logger.log('Названий с дублями: ' + dups.length + '\n');

  dups.forEach(function (t) {
    var arr = byTitle[t];
    Logger.log('>>> ' + t + ' (' + arr.length + ' сделок)');
    arr.forEach(function (d) {
      Logger.log('    #' + d.ID + ' | ' + d.DATE_CREATE.slice(0, 16) +
        ' | ' + d.STAGE_ID + ' | ' + d.OPPORTUNITY +
        ' | ЛИД: ' + (d.LEAD_ID || 'нет') +
        ' | КОНТАКТ: ' + (d.CONTACT_ID || 'нет'));
    });
    var leads = arr.map(function (d) { return String(d.LEAD_ID || 'нет'); });
    var contacts = arr.map(function (d) { return String(d.CONTACT_ID || 'нет'); });
    var uniqLeads = leads.filter(function (v, i) { return leads.indexOf(v) === i; });
    var uniqContacts = contacts.filter(function (v, i) { return contacts.indexOf(v) === i; });
    Logger.log('    ВЫВОД: лидов ' + uniqLeads.length + ', контактов ' + uniqContacts.length +
      ' -> ' + (uniqLeads.length > 1 ? 'РАЗНЫЕ лиды (плодит телефония/линия)' : 'ОДИН лид (виновата конвертация)') +
      (uniqContacts.length > 1 ? ' + КОНТАКТЫ ТОЖЕ ДУБЛИРУЮТСЯ' : ''));
    Logger.log('');
  });

  // Дубли в клиентской базе по телефону
  var contacts = [];
  start = 0;
  while (true) {
    var cb = bitrixCall_('crm.contact.list', { select: ['ID', 'NAME', 'PHONE', 'DATE_CREATE'], start: start });
    contacts = contacts.concat(cb.result);
    if (cb.next === undefined || cb.next === null) break;
    start = cb.next;
  }
  var byPhone = {};
  contacts.forEach(function (c) {
    (c.PHONE || []).forEach(function (p) {
      var num = String(p.VALUE).replace(/\D/g, '').slice(-10);
      if (num) (byPhone[num] = byPhone[num] || []).push(c.ID);
    });
  });
  var dupPhones = Object.keys(byPhone).filter(function (p) { return byPhone[p].length > 1; });
  Logger.log('=== КОНТАКТЫ ===');
  Logger.log('Всего контактов: ' + contacts.length + ' | телефонов с дублями: ' + dupPhones.length);
  dupPhones.forEach(function (p) {
    Logger.log('  ...' + p + ' -> контакты #' + byPhone[p].join(', #'));
  });
}

// Показывает, в каком виде карточки лежат наши поля: в ОБЩЕМ (виден всем) или только
// в личном виде конкретного человека. Влад правил карточку руками через "Выбрать поле",
// и Битрикс мог сохранить это только ему - тогда менеджеры полей не увидят, а вся
// настройка окажется бесполезной. Читалка, ничего не меняет.
function checkBitrixCardScopes() {
  var WANT = ['UF_CRM_LOSE_REASON', 'UF_CRM_ORDER_1C_ID'];

  function fieldsOf(cfg) {
    var names = [];
    (cfg || []).forEach(function (s) {
      (s.elements || []).forEach(function (e) { names.push(e.name); });
    });
    return names;
  }

  var common = bitrixCall_('crm.deal.details.configuration.get', { scope: 'C' }).result;
  var cNames = fieldsOf(common);
  Logger.log('=== ОБЩИЙ вид карточки (scope C) - его видят все, у кого нет своего ===');
  Logger.log('  секции: ' + (common || []).map(function (s) { return s.name; }).join(', '));
  WANT.forEach(function (f) {
    Logger.log('  ' + f + ': ' + (cNames.indexOf(f) >= 0 ? 'ЕСТЬ' : 'НЕТ !!!'));
  });

  // Личные виды сотрудников. У менеджеров "свой вид карточки" запрещён правами, но
  // если личный вид всё же сохранён, он перебьёт общий - это и надо поймать.
  var users = bitrixCall_('user.get', { FILTER: { ACTIVE: 'Y' } }).result || [];
  Logger.log('=== ЛИЧНЫЕ виды (scope P) ===');
  users.forEach(function (u) {
    var name = ((u.LAST_NAME || '') + ' ' + (u.NAME || '')).trim() || u.EMAIL;
    var personal;
    try {
      personal = bitrixCall_('crm.deal.details.configuration.get', { scope: 'P', userId: u.ID }).result;
    } catch (e) {
      Logger.log('  ' + name + ': ошибка чтения - ' + e.message);
      return;
    }
    if (!personal || !personal.length) {
      Logger.log('  ' + name + ': личного вида нет -> видит ОБЩИЙ (это хорошо)');
      return;
    }
    var pNames = fieldsOf(personal);
    var miss = WANT.filter(function (f) { return pNames.indexOf(f) === -1; });
    Logger.log('  ' + name + ': ЕСТЬ личный вид' +
      (miss.length ? ' -> в нём НЕТ полей: ' + miss.join(', ') : ' -> наши поля в нём есть'));
  });

  Logger.log('--- Если у кого-то есть личный вид без наших полей - запусти forceBitrixCommonCard() ---');
}

// Сбрасывает личные виды карточки у всех и переводит всех на общий вид. Применять,
// если checkBitrixCardScopes() показал, что у кого-то свой вид без наших полей.
// Осторожно: чужие личные настройки карточки при этом пропадут.
function forceBitrixCommonCard() {
  bitrixCall_('crm.deal.details.configuration.forceCommonScopeForAll', {});
  Logger.log('Все переведены на общий вид карточки. Проверяю результат:');
  checkBitrixCardScopes();
}

// Чинит поля "Причина отказа" и "Номер заказа 1С": проставляет подписи и значения
// выпадающего списка. Оба поля были созданы через JSON-вызов, который Битрикс принял
// (result: true), но подписи и список молча проигнорировал - поля оказались БЕЗ
// названий, из-за чего не отрисовывались на карточке и висели в "Скрытых полях"
// пустыми чекбоксами (скриншот Влада, 2026-07-16). Настройка карточки при этом
// читалась как успешная - проверка через API врала, потому что смотрела не на тот
// слой. Лечится вызовом в form-urlencoded (см. bitrixCallForm_).
// Идемпотентна: значения списка добавляются только если он пуст.
function fixBitrixFields() {
  var WANT = [
    {
      name: 'UF_CRM_LOSE_REASON',
      label: 'Причина отказа',
      values: ['Недозвон', 'Дорого, нашли дешевле', 'Неактуально, закрыли потребность',
               'Неквалифицированный лид', 'Спам / нецелевое обращение', 'Другое']
    },
    { name: 'UF_CRM_ORDER_1C_ID', label: 'Номер заказа 1С', values: null }
  ];

  var all = bitrixCall_('crm.deal.userfield.list', {}).result || [];

  WANT.forEach(function (want) {
    var found = all.filter(function (f) { return f.FIELD_NAME === want.name; })[0];
    if (!found) { Logger.log('НЕ НАЙДЕНО поле ' + want.name + ' - пропускаю'); return; }

    var before = bitrixCall_('crm.deal.userfield.get', { id: found.ID }).result;
    Logger.log('=== ' + want.name + ' (ID ' + found.ID + ') ===');
    Logger.log('  БЫЛО подпись: "' + (before.EDIT_FORM_LABEL || '(пусто)') + '"' +
               ' | значений списка: ' + ((before.LIST || []).length));

    // 1. Подписи
    bitrixCallForm_('crm.deal.userfield.update', {
      id: found.ID,
      fields: {
        EDIT_FORM_LABEL: { ru: want.label, en: want.label },
        LIST_COLUMN_LABEL: { ru: want.label, en: want.label },
        LIST_FILTER_LABEL: { ru: want.label, en: want.label }
      }
    });

    // 2. Значения выпадающего списка - только если список пуст, иначе задвоим
    if (want.values && (before.LIST || []).length === 0) {
      var listParam = {};
      want.values.forEach(function (v, i) {
        listParam['n' + i] = { VALUE: v, SORT: String((i + 1) * 10), DEF: 'N' };
      });
      bitrixCallForm_('crm.deal.userfield.update', { id: found.ID, fields: { LIST: listParam } });
    }

    // 3. Проверяем чтением, а не верим коду ответа - именно на этом я обжёгся
    var after = bitrixCall_('crm.deal.userfield.get', { id: found.ID }).result;
    Logger.log('  СТАЛО подпись: "' + (after.EDIT_FORM_LABEL || '(ПУСТО - НЕ ПОЧИНИЛОСЬ)') + '"');
    if (want.values) {
      var vals = (after.LIST || []).map(function (x) { return x.VALUE; });
      Logger.log('  СТАЛО значений списка: ' + vals.length + ' [' + vals.join(' | ') + ']');
    }
  });

  Logger.log('--- Готово. Обнови карточку сделки в браузере (F5) и проверь секцию "Итог сделки" ---');
}

// Выключает мёртвые линии 3 и 5 (Влад разрешил 2026-07-16). Обе активны, но за всё
// время не привели ни одного лида. Выключение обратимо - ACTIVE обратно в 'Y'.
// Линии 1 (Авито) и 7 (Онлайн-чат сайта) НЕ трогаем, они рабочие.
function disableBitrixDeadLines() {
  var DEAD = ['3', '5'];
  var lines = bitrixCall_('imopenlines.config.list.get', {}).result || [];

  lines.forEach(function (l) {
    if (DEAD.indexOf(String(l.ID)) === -1) return;
    if (l.ACTIVE === 'N') { Logger.log('[' + l.ID + '] уже выключена'); return; }
    bitrixCall_('imopenlines.config.update', {
      CONFIG_ID: l.ID,
      PARAMS: { ACTIVE: 'N' }
    });
    Logger.log('Выключил: [' + l.ID + '] ' + l.LINE_NAME);
  });

  Logger.log('--- Состояние после ---');
  showBitrixLines();
}

// Разведка: какие методы API мне вообще доступны с текущими правами. Нужно, чтобы
// не гадать, можно ли через REST сделать обязательные поля по стадиям, роботов на
// стадию и права доступа CRM - или это только интерфейс.
function probeBitrixMethods() {
  var all = bitrixCall_('methods', {}).result || [];
  Logger.log('Всего методов доступно: ' + all.length);

  var groups = {
    'ПРАВА ДОСТУПА (permission/role)': /permission|role/i,
    'РОБОТЫ / БИЗНЕС-ПРОЦЕССЫ (bizproc)': /bizproc|robot|trigger/i,
    'НАСТРОЙКИ ПОЛЕЙ (fields/settings/userfield)': /userfield|fields|settings|configuration/i,
    'СТАДИИ / СТАТУСЫ (status/category)': /status|category|stage/i,
    'ДЕЛА / ЗАДАЧИ (activity/task)': /activity|task/i
  };

  Object.keys(groups).forEach(function (title) {
    var re = groups[title];
    var found = all.filter(function (m) { return re.test(m); });
    Logger.log('--- ' + title + ' (' + found.length + ') ---');
    Logger.log(found.join(', ') || '(ничего)');
  });
}

// Запустить вручную ОДИН РАЗ после того, как задан BITRIX24_WEBHOOK_URL, чтобы
// проверить подключение до того, как заводить его в doGet. Смотреть результат
// в журнале выполнения редактора (Logger).
function testBitrixMarketing() {
  var data = getBitrixMarketingData_();
  Logger.log(JSON.stringify(data, null, 2));
  return data;
}

// РАЗОВАЯ настройка: выводит поля "Причина отказа" и "Номер заказа 1С" на карточку
// сделки в Битрикс24. Поля были созданы через API, но лежали в базе невидимыми -
// в общем виде карточки их не было, поэтому за 4 дня работы причина отказа не
// заполнилась НИ РАЗУ из 11 отказов (менеджеры физически не видели поле).
// Своя карточка менеджерам запрещена в правах, поэтому пишем в общий вид (scope C).
// Идемпотентна: повторный запуск ничего не дублирует.
// Запускать вручную из редактора, результат смотреть в журнале выполнения.
function setupBitrixCard() {
  var SECTION = 'yard_result';
  var current = bitrixCall_('crm.deal.details.configuration.get', { scope: 'C' }).result || [];

  var already = current.some(function (s) { return s.name === SECTION; });
  if (already) {
    Logger.log('Секция "Итог сделки" уже есть на карточке - ничего не делаю.');
    return;
  }

  var section = {
    name: SECTION,
    title: 'Итог сделки',
    type: 'section',
    elements: [
      { name: 'UF_CRM_LOSE_REASON', optionFlags: '0' },
      { name: 'UF_CRM_ORDER_1C_ID', optionFlags: '0' }
    ]
  };
  var data = [section].concat(current);

  bitrixCall_('crm.deal.details.configuration.set', { scope: 'C', data: data });

  // Проверяем результат чтением, а не верим коду ответа
  var after = bitrixCall_('crm.deal.details.configuration.get', { scope: 'C' }).result || [];
  var names = [];
  after.forEach(function (s) {
    (s.elements || []).forEach(function (e) { names.push(e.name); });
  });
  Logger.log('Секций на карточке: ' + after.length + ' (' + after.map(function (s) { return s.name; }).join(', ') + ')');
  Logger.log('Причина отказа на карточке: ' + (names.indexOf('UF_CRM_LOSE_REASON') >= 0));
  Logger.log('Номер заказа 1С на карточке: ' + (names.indexOf('UF_CRM_ORDER_1C_ID') >= 0));
}

// ============================================================
// ГЛАВНАЯ ТОЧКА ВХОДА — вешается на триггер каждые 6 часов
// ============================================================
function runAll() {
  // Блокировка на время всего прогона (Влад, 2026-07-24: "Service Spreadsheets timed out" -
  // сработало, когда ручной запуск наложился на уже идущий прогон/плановый триггер, и два
  // скрипта одновременно читали-писали одну и ту же таблицу на 2000+ строк). Без блокировки
  // это будет повторяться при любом совпадении ручного запуска с триггером по расписанию.
  // Ждём до 10 сек, если лок занят - другой прогон уже идёт, просто выходим, а не долбим
  // ту же таблицу вторым потоком.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log('⏳ runAll() уже выполняется в другом запуске - пропускаю, чтобы не грузить ту же таблицу одновременно');
    return;
  }

  try {
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

  // Сводка текущего месяца для "Глобальной статистики" (Влад, 2026-08-04) - после
  // saveFinancialHistory, чтобы Данные_1С_история/История_финансов на этот момент уже
  // содержали сегодняшний снимок, а Заказы_данные/Нормализованные_данные - свежий импорт.
  try { saveMonthSummary_(SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID), Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM')); log.push('✅ Сводка месяца сохранена'); }
  catch(e) { errors.push('❌ Сводка месяца: ' + e.message); }

  // 1С шлёт отчёт ДЗ раз в день в 15:00 (Влад, 2026-07-08) - в остальные прогоны письма
  // просто не будет, importDebtReport() кинет ошибку "не найдено за 2 дня", которая
  // безопасно уходит в errors и не ломает остальной пайплайн. saveDebtHistory() читает уже
  // сохранённые данные - не зависит от того, обновились ли они в этом самом прогоне.
  try { importDebtReport();        log.push('✅ ДЗ импортирована'); }
  catch(e) { errors.push('❌ ДЗ (импорт): ' + e.message); }
  try { saveDebtHistory();         log.push('✅ История ДЗ сохранена'); }
  catch(e) { errors.push('❌ История ДЗ: ' + e.message); }

  // 1С шлёт отчёт "Поступления" 3 раза в день (6:00/12:00/18:00, Влад 2026-08-13) - в
  // остальные прогоны письма не будет (newer_than:2d покрывает выходные/задержки), ошибка
  // безопасно уходит в errors, не ломает остальной пайплайн.
  try { importReceiptsReport();    log.push('✅ Поступления импортированы'); }
  catch(e) { errors.push('❌ Поступления (импорт): ' + e.message); }

  // Precompute главного payload дашборда (2026-08-13) - в самом конце, после того как все
  // источники выше уже свежие за этот прогон. doGet() читает готовое вместо пересчёта на
  // каждый визит.
  try { saveMainPayloadCache_(SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)); log.push('✅ Кэш главной страницы обновлён'); }
  catch(e) { errors.push('❌ Кэш главной страницы: ' + e.message); }

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
  } finally {
    lock.releaseLock();
  }
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
    // Раньше строка с нулевой выручкой и нулевой ВП за весь месяц пропускалась целиком -
    // предполагалось, что это мусорная строка отчёта. На деле так же выглядит настоящая
    // машина, простоявшая весь месяц в ремонте без единого заказа (Влад, 2026-07-19: "не все
    // тралы показывает как ремонтные, которые в штатке отмечены как ремонт" - именно такие
    // машины пропадали из архива). Мусорные строки уже отсеяны выше по skipKeywords, а ниже -
    // по валидному госномеру (gosRaw), поэтому отдельный фильтр по выручке/прибыли не нужен.

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

  const headers = [
    'Госномер (ключ)', 'Марка', 'Тип техники', 'Выручка', 'ФОТ',
    'Топливо', 'Запчасти', 'Штрафы', 'Проходные', 'Валовая прибыль',
    'Прицеп', 'Гос. номер прицепа', 'Тип из Штатки', 'Статус из Штатки', 'План ВП',
    'Прогноз ВП'
  ];

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

  // Проверяем результат ПЕРЕД тем, как трогать лист (Влад, 2026-07-24: "куда-то пропали все
  // данные" - раньше normSheet.clear() шёл ДО этой проверки, поэтому битый/пустой отчёт от
  // 1С стирал вчерашние рабочие данные и ничем не заменял их - весь дашборд обнулялся до
  // следующего успешного прогона). Если сегодня разобрать нечего - оставляем лист как есть
  // (вчерашние, чуть устаревшие, но живые данные) вместо того, чтобы обнулить дашборд.
  if (vehicles.length === 0) throw new Error('Нет данных о машинах - лист Нормализованные_данные не тронут, остались прежние данные');

  let normSheet = ss.getSheetByName('Нормализованные_данные');
  if (normSheet) normSheet.clear();
  else normSheet = ss.insertSheet('Нормализованные_данные');
  normSheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
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
// ДЕБИТОРСКАЯ ЗАДОЛЖЕННОСТЬ (Gmail → ДЗ_данные → История_ДЗ)
// 1С шлёт письмо раз в день в 15:00 (Влад, 2026-07-08). Источник - 3-уровневая иерархия
// Юрлицо -> Контрагент -> Документ (см. plans/2026-07-08-debt-receivables-tab.md для
// полного разбора структуры и решений по фильтрации). Юрлицо НЕ фильтруем (трал-бизнес
// размазан по всем 5 компаниям группы - тендеры/переходный период до перевода всего на
// Бульдог), фильтруем только по менеджеру (TRAL_MANAGERS, как везде).
// ============================================================
const DEBT_RAW_SHEET = 'ДЗ_данные';
const DEBT_HISTORY_SHEET = 'История_ДЗ';
// Лист "История_ДЗ_по_контрагентам" (2026-07-12, удалён 2026-07-14 - график переделали на
// линии по юрлицам, см. DEBT_HISTORY_SHEET/orgTotals) - ВОЗВРАЩЁН 2026-07-15 для другой
// задачи: Влад хочет по клику на стрелку тренда видеть, КАКИЕ КОНКРЕТНО контрагенты
// изменили баланс со вчера на сегодня ("кто и как уменьшил или увеличил ДЗ") - для этого
// снова нужен посуточный снимок баланса по каждому клиенту, не только по юрлицам.
const DEBT_CUSTOMER_HISTORY_SHEET = 'История_ДЗ_по_контрагентам';

// Порог "мёртвой" ДЗ (Влад, 2026-07-10/16) - долги старше этого возраста по умолчанию
// скрыты из таблиц/расчётов на фронтенде (кнопка-переключатель), а с 2026-07-16 ещё и
// образуют отдельную корзину "Мёртвая" в блоке "Просрочка". Держать в синхроне с
// DEBT_AGE_LIMIT_DAYS в files/index.html.
const DEBT_AGE_LIMIT_DAYS = 600;

// Убирает телефон из имени менеджера ("Савиток Олеся Анатольевна 8-985-150-11-85" ->
// "Савиток Олеся Анатольевна") - та же логика, что фронтендный cleanName() (files/index.html).
// Влад, 2026-07-08: "это вообще нужно везде исключать... у менеджера есть фамилия имя
// отчество, и всё, больше ничего не надо".
function cleanManagerName_(name) {
  return String(name || '').replace(/[\d\+\-\(\)\s]{6,}/g, '').trim().split(' ').slice(0, 3).join(' ');
}

// Короткие имена юрлиц группы - для колонок в ДЗ_данные и разбивки на дашборде
// (Влад, 2026-07-08: "разбита по нашим... контрагентам: сколько на Бульдоге, сколько на
// Ярде"). Ключ - точное название строки юрлица в отчёте 1С.
const DEBT_ORG_SHORT_NAMES = {
  '01. ЯРД ИМПЕРИАЛ ООО': 'Ярд Империал',
  '03. СТРОЙТРАНС ООО':   'Стройтранс',
  '05. ТЕХНО ПАРК ООО':   'Техно Парк',
  '06. МЕГАКРАН ООО':     'Мегакран',
  '08. БУЛЬДОГ ООО':      'Бульдог',
};
const DEBT_ORG_KEYS = Object.keys(DEBT_ORG_SHORT_NAMES);

// Разбирает сырую 2D-выгрузку отчёта "Взаиморасчёты" в плоский список по клиентам.
// Документ-строки (Отдел+Менеджер заполнены) дают долг(G)/дату/менеджера. Контрагент-строки
// (только колонка A) дают аванс(H)/гарантийный платёж(I)/депозит(J) - эти три колонки НЕ
// встречаются на уровне документа, только на уровне контрагента (проверено на образце).
// Один контрагент может повторяться под разными юрлицами (165 из ~3800 в образце) -
// суммируем по имени для общих итогов, но и сохраняем разбивку по юрлицу отдельно (см. план).
function parseDebtRawRows_(rawData) {
  const customers = {};
  let currentOrg = null;
  let currentContragent = null;

  for (let r = 9; r < rawData.length; r++) { // строка 10 в Excel (1-индекс) = индекс 9
    const row = rawData[r];
    const a = String(row[0] || '').trim();
    if (!a) continue;
    if (a === 'Итого') break;

    if (/^\d{2}\.\s/.test(a)) { currentOrg = a; currentContragent = null; continue; } // строка юрлица

    const dept = String(row[3] || '').trim();
    // Строки "Поступление..." под менеджером "master" НЕ имеют заполненный "Отдел" (как и
    // строки контрагента) - без этой проверки они ошибочно принимались за НОВОГО
    // контрагента, и следующие за ними реальные документы уходили не тому клиенту (Влад,
    // 2026-07-14, на скриншоте: "Поступление на расчётный счёт ... — Техно Парк: 29 800 ₽"
    // выглядело как отдельный контрагент с долгом - подтверждённый баг). Распознаём такую
    // строку по паттерну "... от ДД.ММ.ГГГГ ЧЧ:ММ:СС" даже без "Отдела" - это документ,
    // просто без привязки к конкретному менеджеру, не новый контрагент.
    const looksLikeDocRow = dept !== '' || /от\s+\d{2}\.\d{2}\.\d{4}\s+\d{1,2}:\d{2}/.test(a);
    if (looksLikeDocRow) {
      // строка документа - менеджера НЕ фильтруем по TRAL_MANAGERS (список менеджеров в
      // самом отчёте 1С уже задаёт Влад в параметрах отчёта - "Менеджер В списке..." см.
      // план; если фильтровать ещё и здесь по своему списку, при добавлении в 1С уволенных
      // сотрудников их долг тихо терялся бы, пока не обновишь TRAL_MANAGERS вручную - Влад,
      // 2026-07-10: "сегодня загружу всех менеджеров, которые когда-либо были").
      if (!currentContragent || !customers[currentContragent]) continue;
      // Колонка "Менеджер" была F (row[5]) с самого начала (2026-07-08), но в письме 1С от
      // 12.08.2026 сдвинулась на E (row[4]) - шапка "Отдел"/"Менеджер" в самом файле это
      // подтверждает (raw-дамп debugDumpDebtReport: индекс 3="Отдел", индекс 4="Менеджер",
      // индекс 5 пуст). Из-за этого row[5] был всегда пуст -> manager всегда falsy -> НИ
      // ОДИН документ не проходил дальше -> hasRealManagerDoc никогда не ставился -> весь
      // отчёт схлопывался в 0 клиентов ("после разбора и фильтрации не осталось ни одного
      // клиента"), а ДЗ_данные с этого момента замерла на старых цифрах (импорт падает ДО
      // sheet.clear(), см. importDebtReport()) - отсюда и "нет изменений со вчера" на
      // дашборде несколько дней подряд. Проверяем оба индекса (E и F) - переживёт, если 1С
      // сдвинет колонку обратно.
      const manager = cleanManagerName_(row[4]) || cleanManagerName_(row[5]);
      if (!manager) continue;
      const dateMatch = a.match(/от (\d{2})\.(\d{2})\.(\d{4})/);
      if (!dateMatch) continue;
      const docDate = dateMatch[3] + '-' + dateMatch[2] + '-' + dateMatch[1];
      // Описание документа без "от ДД.ММ.ГГГГ ЧЧ:ММ:СС" в хвосте - дата уже отдельным полем
      // (Влад, 2026-07-09: "видеть детальную структуру долга" по каждому контрагенту).
      const docDesc = a.replace(/\s*от \d{2}\.\d{2}\.\d{4}.*$/, '');
      customers[currentContragent].docs.push({ manager: manager, date: docDate, desc: docDesc, debt: ordParseNum(row[6]), org: currentOrg });
      // Метка "есть хотя бы один документ от РЕАЛЬНОГО менеджера" (Влад, 2026-07-16, на
      // примере "ГЛАВГОРСТРОЙ ООО": "там даже менеджера моего нет... такие ситуации нам не
      // нужны") - у некоторых контрагентов ВСЕ документы - это банковские "Поступление"/
      // "Списание" под псевдо-менеджером master, без единого реального акта (Реализация/
      // Таблица заказов). Такой контрагент - не настоящий должник трал-бизнеса, а
      // административная запись 1С (часто с отрицательным "авансом", который наша формула
      // долг-аванс превращает в фиктивный положительный долг).
      if (manager.toLowerCase() !== 'master') customers[currentContragent].hasRealManagerDoc = true;
    } else {
      // строка контрагента
      currentContragent = a;
      if (!customers[a]) {
        customers[a] = { contragent: a, debt: 0, advance: 0, guaranteePayment: 0, guaranteeDeposit: 0, ourDebt: 0, docs: [], byOrg: {} };
      }
      const c = customers[a];
      const debt = ordParseNum(row[6]), advance = ordParseNum(row[7]);
      const gPayment = ordParseNum(row[8]), gDeposit = ordParseNum(row[9]);
      // "Сумма нашего долга" (колонка L, row[11]) - взаимозачёт (Влад, 2026-07-16: "мы
      // арендная компания, наши клиенты в том числе партнёры... они оказывали нам услуги,
      // давали экскаваторы, поэтому это как взаимозачёт"). Деньги реально поступили на наш
      // счёт ("Поступление на расчётный счёт..." под этим контрагентом), 1С пока не
      // разнесла их по актам, поэтому висят отдельной колонкой - но фактически гасят долг
      // клиента. Проверено арифметикой самой 1С: Итог(K) + Сумма_нашего_долга(L) =
      // Общий_итог(N) - на примере "АРТ-СТРОЙ ООО": -563 375 + 578 375 = 15 000.
      const ourDebt = ordParseNum(row[11]);
      c.debt             += debt;
      c.advance          += advance;
      c.guaranteePayment += gPayment;
      c.guaranteeDeposit += gDeposit;
      c.ourDebt           += ourDebt;
      if (currentOrg) {
        if (!c.byOrg[currentOrg]) c.byOrg[currentOrg] = { debt: 0, advance: 0, guaranteePayment: 0, guaranteeDeposit: 0, ourDebt: 0 };
        c.byOrg[currentOrg].debt             += debt;
        c.byOrg[currentOrg].advance          += advance;
        c.byOrg[currentOrg].guaranteePayment += gPayment;
        c.byOrg[currentOrg].guaranteeDeposit += gDeposit;
        c.byOrg[currentOrg].ourDebt          += ourDebt;
      }
    }
  }

  const result = [];
  Object.keys(customers).forEach(function(name) {
    const c = customers[name];
    if (!c.hasRealManagerDoc) return; // ни одного документа от РЕАЛЬНОГО менеджера (только master) - не наш клиент
    const unpaidDocs = c.docs.filter(function(x) { return x.debt > 0; });
    const datedDocs = unpaidDocs.length ? unpaidDocs : c.docs;
    let oldestDate = datedDocs[0].date, latestDate = datedDocs[0].date, latestManager = datedDocs[0].manager;
    datedDocs.forEach(function(x) {
      if (x.date < oldestDate) oldestDate = x.date;
      if (x.date >= latestDate) { latestDate = x.date; latestManager = x.manager; }
    });
    // Баланс по каждому юрлицу ОТДЕЛЬНО (долг минус аванс И минус гарантийные колонки -
    // всё внутри самого юрлица, это законно, тот же контрагент с тем же юрлицом), в
    // фиксированном порядке DEBT_ORG_KEYS. Гарантийный платёж/депозит вычитаются из долга
    // (Влад, 2026-07-13, на примере "СТАЛЬ ТРЕЙД ООО": "показывает долг, но долг закрыт
    // менеджером - у него удержали из ЗП 47125") - подтверждено на реальных данных: обе
    // колонки часто ТОЧНО равны сумме долга того же контрагента (например "АЛДОКС ООО" -
    // долг 106 000, гарантийный депозит 106 000) - долг уже покрыт, просто не деньгами
    // клиента, а гарантией (депозит - удержано из зарплаты менеджера; платёж - вероятно,
    // гарантия от самого клиента при заключении договора).
    // Каждая "гасящая" колонка зажата снизу нулём (Math.max(0, ...)) - Влад, 2026-07-17, на
    // примере "ЮУСК ООО": в 1С "Сумма аванса" по Техно Парку пришла ОТРИЦАТЕЛЬНОЙ (-103 000,
    // мастер-строка "на авансе"), и наивное debt-advance превращало вычитание отрицательного
    // числа в СЛОЖЕНИЕ - 0 - (-103000) = +103 000 фиктивного долга, который затем ещё и
    // суммировался в общий баланс (210 000 Бульдог + 103 000 Техно Парк = 313 000 вместо
    // верных 210 000). "Мы не учитываем эти отрицательные суммы в таком контексте" (Влад) -
    // раз колонка меньше нуля, она ничего не гасит, но и долг не создаёт.
    const byOrgBalance = {};
    DEBT_ORG_KEYS.forEach(function(orgKey) {
      const o = c.byOrg[orgKey];
      byOrgBalance[orgKey] = o
        ? (o.debt - Math.max(0, o.advance) - Math.max(0, o.guaranteePayment) - Math.max(0, o.guaranteeDeposit) - Math.max(0, o.ourDebt))
        : 0;
    });
    // Итоговый баланс = сумма ТОЛЬКО положительных остатков по юрлицам (Влад, 2026-07-09:
    // "плюс с минусом мы не сводим, показываем только долг"). Раньше баланс считался как
    // общий долг минус общий аванс ПО ВСЕМ юрлицам сразу - из-за этого аванс, накопленный
    // на одном юрлице (например Техно Парк, где мы держим больше денег клиента, чем он
    // должен), ошибочно уменьшал реальный долг на другом юрлице (Бульдог) - разные
    // юридические лица, гасить долг одного авансом другого нельзя. Та же логика теперь и
    // для гарантийных колонок - юрлицо А не может закрыть долг юрлица Б.
    let balance = 0;
    DEBT_ORG_KEYS.forEach(function(orgKey) { if (byOrgBalance[orgKey] > 0) balance += byOrgBalance[orgKey]; });

    // Погашение документов "по хронологии 1С" (Влад, 2026-07-11/12) - 1С сам не привязывает
    // поступление к конкретному документу ("мастер"-строки поступлений не связаны ни с
    // отделом/менеджером, ни по номеру документа с "Реализацией", проверено на реальной
    // выгрузке), а ведёт учёт как бегущий остаток по датам (подтверждено Владом при
    // развороте отчёта ДЗ в самой 1С по датам - именно такой порядок и виден). Гасим САМЫЕ
    // СТАРЫЕ документы поступлениями первыми - повторяет ту же хронологическую логику, не
    // произвольное предположение. Считаем ОТДЕЛЬНО по каждому юрлицу (тот же принцип, что и
    // баланс - аванс одного юрлица не может гасить документ другого).
    // Пул покрытия = аванс + гарантийный платёж + гарантийный депозит + "сумма нашего долга"
    // (взаимозачёт, Влад, 2026-07-16) - все четыре одинаково закрывают документы, просто
    // разными деньгами (клиента, гарантией/зарплатой менеджера, или встречной услугой типа
    // аренды экскаватора) - см. комментарий у byOrgBalance выше.
    const docsByOrg = {};
    unpaidDocs.forEach(function(x) { (docsByOrg[x.org] = docsByOrg[x.org] || []).push(x); });
    Object.keys(docsByOrg).forEach(function(orgKey) {
      // Та же защита от отрицательных значений, что и в byOrgBalance выше - отрицательный
      // аванс/гарантия не должен УМЕНЬШАТЬ пул покрытия (тем самым как бы "требуя" покрыть
      // ещё и его) - просто не участвует.
      const o = c.byOrg[orgKey];
      const orgCoverage = o
        ? (Math.max(0, o.advance) + Math.max(0, o.guaranteePayment) + Math.max(0, o.guaranteeDeposit) + Math.max(0, o.ourDebt))
        : 0;
      let remaining = orgCoverage;
      const sorted = docsByOrg[orgKey].slice().sort(function(a, b) { return a.date.localeCompare(b.date); });
      sorted.forEach(function(x) {
        const covered = Math.min(x.debt, Math.max(0, remaining));
        x.covered = covered;
        remaining -= covered;
      });
    });

    // Пересчитываем "с какой даты реально не оплачено" ПО FIFO-ОЦЕНКЕ (Влад, 2026-07-12:
    // "сроки долга пересчитывай по логике, например КРОКУС от 25 июня не оплачено") -
    // раньше брали дату самого старого документа с долгом вообще, даже если по FIFO-оценке
    // он уже эффективно погашен более поздними поступлениями (проверено на самой 1С:
    // разворот "Дебиторская задолженность" по датам показывает именно бегущий остаток в
    // хронологическом порядке - см. обсуждение с Владом). Теперь - дата самого старого
    // документа, который FIFO-оценка НЕ считает полностью покрытым.
    const stillOpenDocs = unpaidDocs.filter(function(x) { return (x.covered || 0) < x.debt; });
    if (stillOpenDocs.length) {
      oldestDate = stillOpenDocs[0].date;
      stillOpenDocs.forEach(function(x) { if (x.date < oldestDate) oldestDate = x.date; });
    }
    // если stillOpenDocs пуст - по оценке все документы полностью покрыты, оставляем старое
    // oldestDate (дата самого старого документа вообще) как безопасный fallback; у клиентов
    // с balance>0 такого не бывает - баланс>0 гарантирует хотя бы один непокрытый документ.

    result.push({
      contragent: c.contragent,
      manager: latestManager, // менеджер самого свежего документа - тот же приём, что и в client_history
      debt: c.debt,
      advance: c.advance,
      guaranteePayment: c.guaranteePayment,
      guaranteeDeposit: c.guaranteeDeposit,
      ourDebt: c.ourDebt,
      balance: balance,
      lastDocDate: latestDate,
      oldestUnpaidDate: oldestDate,
      byOrgBalance: byOrgBalance,
      // Детальная структура долга - по каким именно документам/периодам он образовался, с
      // указанием юрлица у каждого документа (Влад, 2026-07-09: "видно, какая на Бульдоге,
      // какая на Ярде"), только ещё не закрытые (debt>0), от старых к новым. covered -
      // FIFO-оценка того, сколько из этого документа уже покрыто авансом (см. выше) -
      // ОЦЕНКА, не факт.
      unpaidDocs: unpaidDocs
        .map(function(x) { return { date: x.date, desc: x.desc, debt: x.debt, covered: x.covered || 0, org: DEBT_ORG_SHORT_NAMES[x.org] || x.org }; })
        .sort(function(a, b) { return a.date.localeCompare(b.date); }),
    });
  });

  return result.sort(function(a, b) { return b.balance - a.balance; });
}

function importDebtReport() {
  const query = 'subject:"Отчет по дебиторской задолженности" has:attachment newer_than:2d';
  const threads = GmailApp.search(query);
  if (!threads.length) throw new Error('Письмо ДЗ не найдено за 2 дня');

  const msgs = [];
  for (const t of threads) for (const m of t.getMessages()) msgs.push(m);
  msgs.sort(function(a, b) { return b.getDate() - a.getDate(); });
  const latest = msgs[0];

  let att = null;
  for (const a of latest.getAttachments()) {
    if (a.getName().endsWith('.xlsx') || a.getName().endsWith('.xls')) { att = a; break; }
  }
  if (!att) throw new Error('Excel-вложение ДЗ не найдено');

  const tmp = Drive.Files.insert(
    { title: 'tmp_debt_' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS },
    att.copyBlob()
  );
  const data = SpreadsheetApp.openById(tmp.id).getSheets()[0].getDataRange().getValues();
  Drive.Files.remove(tmp.id);

  const parsed = parseDebtRawRows_(data);
  if (!parsed.length) throw new Error('ДЗ: после разбора и фильтрации не осталось ни одного клиента - проверь формат файла');

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(DEBT_RAW_SHEET);
  if (sheet) sheet.clear();
  else sheet = ss.insertSheet(DEBT_RAW_SHEET);

  // Балансы по юрлицам - фиксированные колонки в конце, по одной на каждое юрлицо группы
  // (Влад, 2026-07-08: "разбита... сколько на Бульдоге, сколько на Ярде"). Порядок = DEBT_ORG_KEYS.
  const orgHeaders = DEBT_ORG_KEYS.map(function(k) { return 'Баланс: ' + DEBT_ORG_SHORT_NAMES[k]; });
  // Последняя колонка - JSON со списком неоплаченных документов (дата/описание/сумма), для
  // детальной структуры долга по клику на контрагента (Влад, 2026-07-09). Хранить как JSON
  // в одной ячейке проще, чем заводить отдельный лист - список короткий (обычно до 20-30
  // документов на клиента).
  // "Сумма нашего долга" добавлена В КОНЕЦ (перед JSON), а не между существующими колонками
  // - чтобы не сдвигать индексы, на которые уже завязаны saveDebtHistory()/
  // saveDebtCustomerHistory_() (обе читают только первые 9+orgs колонок, этой не касаются).
  const headers = ['Контрагент', 'Менеджер', 'Сумма долга', 'Сумма аванса', 'Гарантийный платёж',
    'Гарантийный депозит', 'Баланс (долг-аванс)', 'Дата последнего документа', 'Дата старейшего неоплаченного']
    .concat(orgHeaders, ['Сумма нашего долга (взаимозачёт)', 'Документы (JSON)']);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  const rows = parsed.map(function(c) {
    return [c.contragent, c.manager, c.debt, c.advance, c.guaranteePayment, c.guaranteeDeposit,
      c.balance, c.lastDocDate, c.oldestUnpaidDate]
      .concat(DEBT_ORG_KEYS.map(function(k) { return c.byOrgBalance[k]; }), [c.ourDebt, JSON.stringify(c.unpaidDocs)]);
  });
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.getRange(2, 3, rows.length, 5).setNumberFormat('#,##0');
  sheet.getRange(2, 10, rows.length, DEBT_ORG_KEYS.length).setNumberFormat('#,##0');
  sheet.getRange(2, 10 + DEBT_ORG_KEYS.length, rows.length, 1).setNumberFormat('#,##0');

  latest.markRead();
  Logger.log('✅ ДЗ импортирована: ' + parsed.length + ' клиентов');
}

// Дневной снимок общей ДЗ - идемпотентно (перезаписывает сегодняшнюю строку), т.к. runAll()
// гоняется несколько раз в день, а отчёт от 1С обновляется только раз в день в 15:00 - без
// идемпотентности накопились бы дубли за каждый прогон, как уже было с Данные_1С_история
// (см. writeParkHistoryForMonth_, тот же урок).
function saveDebtHistory() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const debtSheet = ss.getSheetByName(DEBT_RAW_SHEET);
  if (!debtSheet || debtSheet.getLastRow() < 2) return;

  const numCols = 9 + DEBT_ORG_KEYS.length;
  const rawData = debtSheet.getRange(2, 1, debtSheet.getLastRow() - 1, numCols).getValues();
  // Банкроты исключены из истории НАЧИНАЯ С ЭТОГО МОМЕНТА (Влад, 2026-07-16: "чтобы при
  // нажатии не показывало банкротов вообще нигде" - в отличие от фильтра "600 дней", этот
  // распространяется и на график, т.к. банкрот - деньги, которых точно не будет, а не
  // просто старый долг). Задним числом уже записанные дни не поправить - как и всегда с
  // изменением логики истории в этом проекте.
  const debtStatusesForHist = getDebtStatuses_(ss);
  const data = rawData.filter(function(r) {
    const st = debtStatusesForHist[String(r[0] || '')];
    return !st || st.status !== 'Банкрот';
  });
  // Отдельный набор ТОЛЬКО для сумм истории (totalBalance/orgTotals/sum0to90 ниже) - помимо
  // банкротов исключает ещё и "Долг отдела кранов/экскаваторов" (2026-08-11), в точности как
  // фронтенд исключает их из "Общая ДЗ" (см. комментарий у DEBT_STATUS_EXCLUDE_FROM_TOTAL
  // выше). `data` (без этого дополнительного фильтра) намеренно остаётся как есть и идёт в
  // saveDebtCustomerHistory_() ниже - подробный список "Что изменилось" должен видеть ЭТИХ
  // контрагентов тоже (Влад: "должна всё-таки фигурировать в 4-м блоке"), просто их сумма не
  // должна искажать общий итог/тренд.
  const dataForTotal = data.filter(function(r) {
    const st = debtStatusesForHist[String(r[0] || '')];
    return !st || DEBT_STATUS_EXCLUDE_FROM_TOTAL.indexOf(st.status) < 0;
  });

  let totalBalance = 0, totalDebt = 0, debtorCount = 0, sum0to90 = 0;
  const orgTotals = DEBT_ORG_KEYS.map(function() { return 0; });
  const todayStrHist = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM-dd');
  // Только реальные должники (баланс > 0) - та же граница, что и в getDebtData() (Влад,
  // 2026-07-09: цифра в графике "ДЗ по дням" не совпадала с "Общая ДЗ" в KPI - раньше тут
  // суммировались ВСЕ клиенты, включая тех, у кого баланс отрицательный (мы держим больше
  // аванса, чем они должны) - это гасило итог до ~11М вместо ~33М "живых" должников).
  dataForTotal.forEach(function(r) {
    const balance = parseFloat(r[6]) || 0;
    if (balance <= 0) return;
    debtorCount++;
    totalBalance += balance;
    totalDebt += parseFloat(r[2]) || 0;
    // По юрлицам - только положительные (та же логика, что и балансов в getDebtData) -
    // нужно для истории и стрелок тенденций по каждому юрлицу (Влад, 2026-07-10).
    DEBT_ORG_KEYS.forEach(function(orgKey, i) {
      const v = parseFloat(r[9 + i]) || 0;
      if (v > 0) orgTotals[i] += v;
    });
    // Долг 0-90 дней (текущая+короткая+средняя) - для карточки "Дебиторская задолженность"
    // на Панели (Влад, 2026-07-16: "выведи... сумму от 0 до 90 дней... динамику в виде
    // графика"). oldestUnpaidDate (r[8]) уже посчитан при импорте, дни считаем так же, как
    // в getDebtData().
    const oldestUnpaidDate = ordFormatDate(r[8]);
    if (oldestUnpaidDate) {
      const d1 = new Date(oldestUnpaidDate + 'T00:00:00'), d2 = new Date(todayStrHist + 'T00:00:00');
      const daysOverdue = Math.round((d2 - d1) / 86400000);
      if (daysOverdue <= 90) sum0to90 += balance;
    }
  });

  const orgHeaders = DEBT_ORG_KEYS.map(function(k) { return DEBT_ORG_SHORT_NAMES[k]; });
  const allHeaders = ['Дата', 'Баланс (долг-аванс)', 'Сумма долга', 'Кол-во должников'].concat(orgHeaders, ['ДЗ 0-90 дней']);
  let histSheet = ss.getSheetByName(DEBT_HISTORY_SHEET);
  if (!histSheet) {
    histSheet = ss.insertSheet(DEBT_HISTORY_SHEET);
    histSheet.getRange(1, 1, 1, allHeaders.length).setValues([allHeaders]).setFontWeight('bold');
  } else if (histSheet.getLastColumn() < allHeaders.length) {
    // Старый лист без колонок по юрлицам - дописываем недостающие заголовки, старые строки
    // просто останутся с пустыми значениями в них (Влад, 2026-07-10: "стрелки тенденций...
    // по каждому юрлицу").
    const missing = allHeaders.slice(histSheet.getLastColumn());
    histSheet.getRange(1, histSheet.getLastColumn() + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lastRow = histSheet.getLastRow();
  let todayRowIndex = -1;
  if (lastRow > 1) {
    const dates = histSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < dates.length; i++) {
      if (dates[i][0] instanceof Date) {
        const d = new Date(dates[i][0]);
        d.setHours(0, 0, 0, 0);
        if (d.getTime() === today.getTime()) { todayRowIndex = i + 2; break; }
      }
    }
  }

  const newRow = [new Date(), totalBalance, totalDebt, debtorCount].concat(orgTotals, [sum0to90]);
  if (todayRowIndex > 0) histSheet.getRange(todayRowIndex, 1, 1, newRow.length).setValues([newRow]);
  else histSheet.appendRow(newRow);

  saveDebtCustomerHistory_(ss, data);
}

// Дневной снимок баланса ПО КАЖДОМУ КОНТРАГЕНТУ И ЮРЛИЦУ - для drill-down "что изменилось"
// по клику на стрелку тренда (Влад, 2026-07-15, уточнение 2026-07-16: "если кликаю на
// Бульдог - хочу видеть только Бульдог изменения"). Одна строка на (контрагент, юрлицо) -
// "Итого" по контрагенту считается на чтении суммированием его строк по юрлицам, отдельно
// не храним. Идемпотентно - удаляет сегодняшние строки перед записью новых. data - уже
// прочитанные строки ДЗ_данные, повторно не читаем.
// Ёмкость: ~140 должников × ~1.2 (часть работает через несколько юрлиц) ≈ 170 строк/день
// ≈ 62 тыс. строк/год ≈ 245 тыс. ячеек/год - при лимите книги 10 млн ячеек (общий на все
// листы) не проблема даже на десятилетия вперёд (Влад, 2026-07-16: "выдержит ли табличка").
function saveDebtCustomerHistory_(ss, data) {
  let custHistSheet = ss.getSheetByName(DEBT_CUSTOMER_HISTORY_SHEET);
  if (!custHistSheet) {
    custHistSheet = ss.insertSheet(DEBT_CUSTOMER_HISTORY_SHEET);
    custHistSheet.getRange(1, 1, 1, 4).setValues([['Дата', 'Контрагент', 'Юрлицо', 'Баланс']]).setFontWeight('bold');
  } else if (custHistSheet.getLastColumn() < 4) {
    // Старый лист без колонки "Юрлицо" (до 2026-07-16, всего ~1 день данных). Просто
    // дописать заголовок недостаточно - у старых строк баланс УЖЕ физически лежит в
    // колонке 3 (которая станет "Юрлицо"), а не в новой колонке 4 - это исказило бы
    // разбор (строка "50000" прочиталась бы как название юрлица). Т.к. это всего один
    // день недавних данных, безопаснее удалить старые строки, чем читать их неверно.
    const oldLastRow = custHistSheet.getLastRow();
    if (oldLastRow > 1) custHistSheet.deleteRows(2, oldLastRow - 1);
    custHistSheet.getRange(1, 4).setValue('Баланс').setFontWeight('bold');
    custHistSheet.getRange(1, 3).setValue('Юрлицо').setFontWeight('bold');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lastRow = custHistSheet.getLastRow();
  if (lastRow > 1) {
    const dates = custHistSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    let deleteFrom = -1, deleteCount = 0;
    for (let i = 0; i < dates.length; i++) {
      if (dates[i][0] instanceof Date) {
        const d = new Date(dates[i][0]);
        d.setHours(0, 0, 0, 0);
        if (d.getTime() === today.getTime()) {
          if (deleteFrom < 0) deleteFrom = i + 2;
          deleteCount++;
        }
      }
    }
    if (deleteFrom > 0) custHistSheet.deleteRows(deleteFrom, deleteCount);
  }

  const now = new Date();
  const rows = [];
  data.forEach(function(r) {
    const balance = parseFloat(r[6]) || 0;
    if (balance <= 0) return; // только реальные должники
    const name = String(r[0] || '');
    DEBT_ORG_KEYS.forEach(function(orgKey, i) {
      const orgBalance = parseFloat(r[9 + i]) || 0;
      if (orgBalance > 0) rows.push([now, name, DEBT_ORG_SHORT_NAMES[orgKey], orgBalance]);
    });
  });
  if (rows.length > 0) {
    custHistSheet.getRange(custHistSheet.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
  }
}

// ── СТАТУС ВЗЫСКАНИЯ ПО КОНТРАГЕНТУ (Влад, 2026-07-14) ────────────────────
// "Хочу по каждому контрагенту проставлять вручную статус... должник, претензия, суд,
// исполнительный лист, и срок сколько уже стоит такой статус". Отдельный лист - НЕ
// перезаписывается импортом ДЗ_данные (тот полностью перезаписывается 1С-отчётом каждый
// день), одна строка на контрагента.
const DEBT_STATUS_SHEET = 'ДЗ_Статусы';
// "Долг отдела кранов"/"Долг отдела экскаваторов" (Влад, 2026-08-10) - контрагент числится в
// общем реестре ДЗ, но долг реально относится к другому отделу компании (не к тралам). На
// фронтенде эти два статуса всегда вычитаются из "Общая ДЗ" (и всех производных сумм) - см.
// DEBT_STATUS_EXCLUDE_FROM_TOTAL в index.html, тот же приём, что уже есть для "Банкрот", но
// без переключателя "показать" - эти долги просто не наши.
const DEBT_STATUS_OPTIONS = ['Должник', 'Претензия', 'Вх. претензия', 'Поручение', 'Суд', 'Исполнительный лист', 'В графике', 'Банкрот', 'Долг отдела кранов', 'Долг отдела экскаваторов'];
// Та же константа, что и DEBT_STATUS_EXCLUDE_FROM_TOTAL в index.html - используется backend'ом
// в saveDebtHistory() (2026-08-11), чтобы записанная в историю "Общая ДЗ" считалась в ТОМ ЖЕ
// составе, что и фронтенд. Без этого стрелка тренда на карточке "Общая ДЗ" сравнивала
// сегодняшний живой итог (уже без кранов/экскаваторов) со вчерашним сохранённым (который их
// ещё включал) - показывала движение долга там, где реально сменился только статус, а не
// сумма (баг найден 2026-08-11: Влад заметил, что "-3%" в стрелке тренда не бьётся с пустым
// списком "Что изменилось" - список считает по-другому, БЕЗ этого фильтра, честно, поэтому и
// разошёлся с искажённой стрелкой).
const DEBT_STATUS_EXCLUDE_FROM_TOTAL = ['Долг отдела кранов', 'Долг отдела экскаваторов'];

function isValidDebtStatus_(status) {
  return DEBT_STATUS_OPTIONS.indexOf(status) >= 0;
}

// Гарантирует, что лист статусов существует и имеет 4 колонки (Контрагент/Статус/Дата
// установки/Комментарий) - колонка "Комментарий" добавлена 2026-07-15 (Влад: "хочу вносить
// ручные комментарии по контрагенту, текст может быть длинный") в тот же лист, что и
// статус - оба поля одной природы (ручные заметки поверх авто-импорта из 1С).
function ensureDebtStatusSheet_(ss) {
  let sheet = ss.getSheetByName(DEBT_STATUS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(DEBT_STATUS_SHEET);
    sheet.getRange(1, 1, 1, 4).setValues([['Контрагент', 'Статус', 'Дата установки', 'Комментарий']]).setFontWeight('bold');
  } else if (sheet.getLastColumn() < 4) {
    sheet.getRange(1, 4).setValue('Комментарий').setFontWeight('bold');
  }
  return sheet;
}

// {contragent: {status, since, comment}} - since = дата, с которой стоит ИМЕННО этот
// статус (не дата создания строки - см. setDebtStatus_, дата обновляется только при смене
// статуса).
function getDebtStatuses_(ss) {
  const sheet = ss.getSheetByName(DEBT_STATUS_SHEET);
  const result = {};
  if (!sheet || sheet.getLastRow() < 2) return result;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  data.forEach(function(r) {
    const name = String(r[0] || '').trim();
    if (!name) return;
    result[name] = {
      status: String(r[1] || ''),
      since: r[2] instanceof Date ? Utilities.formatDate(r[2], 'Europe/Moscow', 'yyyy-MM-dd') : String(r[2] || ''),
      comment: String(r[3] || ''),
    };
  });
  return result;
}

// Находит номер строки контрагента в листе статусов, создаёт строку, если её ещё нет.
function findOrCreateDebtStatusRow_(sheet, name) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const names = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < names.length; i++) {
      if (String(names[i][0] || '').trim() === name) return i + 2;
    }
  }
  sheet.appendRow([name, '', '', '']);
  return sheet.getLastRow();
}

// Дата "с какого числа" обновляется, ТОЛЬКО если статус реально изменился - повторная
// установка того же статуса (например, повторный клик по тому же значению в выпадающем
// списке) не сбрасывает счётчик "сколько дней уже стоит статус".
function setDebtStatus_(ss, contragent, status) {
  const name = String(contragent || '').trim();
  if (!name) throw new Error('Не указан контрагент');
  if (!isValidDebtStatus_(status)) throw new Error('Недопустимый статус: ' + status);

  const sheet = ensureDebtStatusSheet_(ss);
  const today = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM-dd');
  const row = findOrCreateDebtStatusRow_(sheet, name);
  const current = sheet.getRange(row, 2, 1, 1).getValue();
  if (String(current || '') !== status) {
    sheet.getRange(row, 2, 1, 2).setValues([[status, today]]);
  }
}

// Комментарий НЕ трогает статус/дату - отдельное поле, может обновляться независимо
// (Влад, 2026-07-15: "текст может быть длинный").
function setDebtComment_(ss, contragent, comment) {
  const name = String(contragent || '').trim();
  if (!name) throw new Error('Не указан контрагент');
  const sheet = ensureDebtStatusSheet_(ss);
  const row = findOrCreateDebtStatusRow_(sheet, name);
  sheet.getRange(row, 4).setValue(String(comment || ''));
}

// Агрегация ДЗ для дашборда - читает уже посчитанный ДЗ_данные (см. importDebtReport).
// compareDaysBack - за сколько дней назад искать точку сравнения для "Что изменилось"
// (Влад, 2026-07-19: "хочу не только в разрезе одного дня в сравнении с вчера, но и более
// широких диапазонах - пусть это будет неделя для начала") - по умолчанию 1 (вчера, как
// раньше). Для >1 берём БЛИЖАЙШУЮ доступную дату к цели (сбор истории мог прерваться на
// день-два), а не требуем точного совпадения - иначе "неделя" часто осталась бы пустой.
function getDebtData(ss, compareDaysBack) {
  compareDaysBack = compareDaysBack || 1;
  const sheet = ss.getSheetByName(DEBT_RAW_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return null;

  const numCols = 9 + DEBT_ORG_KEYS.length + 2; // + "Сумма нашего долга" + "Документы (JSON)"
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, numCols).getValues();
  const ourDebtColIdx = 9 + DEBT_ORG_KEYS.length;
  const docsColIdx = ourDebtColIdx + 1;
  const allCustomers = data.map(function(r) {
    // Разбивка по юрлицам - только положительные (Влад, 2026-07-09: "показываем только
    // долг" - отрицательный остаток на одном юрлице не гасит долг на другом, поэтому и в
    // разбивке ему не место, только запутывает).
    const byOrg = [];
    DEBT_ORG_KEYS.forEach(function(orgKey, i) {
      const v = parseFloat(r[9 + i]) || 0;
      if (v > 0) byOrg.push({ org: DEBT_ORG_SHORT_NAMES[orgKey], balance: v });
    });
    // Детальная структура долга по документам - клик по контрагенту на дашборде
    // (Влад, 2026-07-09). Если JSON битый/пустой - просто пустой список, не роняем весь ответ.
    let unpaidDocs = [];
    try { unpaidDocs = JSON.parse(r[docsColIdx] || '[]'); } catch (parseErr) { unpaidDocs = []; }
    return {
      contragent: String(r[0] || ''), manager: String(r[1] || ''),
      debt: parseFloat(r[2]) || 0, advance: parseFloat(r[3]) || 0,
      guaranteePayment: parseFloat(r[4]) || 0, guaranteeDeposit: parseFloat(r[5]) || 0,
      ourDebt: parseFloat(r[ourDebtColIdx]) || 0,
      balance: parseFloat(r[6]) || 0,
      lastDocDate: ordFormatDate(r[7]), oldestUnpaidDate: ordFormatDate(r[8]),
      byOrg: byOrg,
      unpaidDocs: unpaidDocs,
    };
  });
  // Только реальные должники (баланс > 0) - для самой вкладки ДЗ.
  const customers = allCustomers.filter(function(c) { return c.balance > 0; })
    .sort(function(a, b) { return b.balance - a.balance; });

  // "Долгие заказы, не закрытые документами" - для карточки на Панели (Влад, 2026-07-11:
  // "я открываю контрагента, вижу, что заказ в прошлом месяце даже не закрыт... нужно
  // обратить внимание в первую очередь"). "Таблица заказов" в 1С = заказ ещё не оформлен
  // как "Реализация (акт, накладная, УПД)" - бумажно не закрыт. Считаем по ВСЕМ клиентам
  // (allCustomers, не только customers с положительным балансом) - это про незакрытые
  // документы, а не про то, кто должен денег (у клиента может быть баланс <=0 в целом, но
  // конкретный заказ всё равно висит незакрытым).
  const todayForMonth = new Date();
  const currentMonthStart = todayForMonth.getFullYear() + '-' + String(todayForMonth.getMonth() + 1).padStart(2, '0') + '-01';
  let oldUnclosedCount = 0, oldUnclosedAmount = 0;
  allCustomers.forEach(function(c) {
    (c.unpaidDocs || []).forEach(function(d) {
      if (d.desc && d.desc.indexOf('Таблица заказов') === 0 && d.date && d.date < currentMonthStart) {
        oldUnclosedCount++;
        oldUnclosedAmount += d.debt;
      }
    });
  });

  const todayStr = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM-dd');
  function daysSince(dateStr) {
    if (!dateStr) return 0;
    const d1 = new Date(dateStr + 'T00:00:00'), d2 = new Date(todayStr + 'T00:00:00');
    return Math.round((d2 - d1) / 86400000);
  }
  // Бегут по allCustomers (не только customers с балансом>0), чтобы статус/дни просрочки
  // были доступны и в "Гарантии" (та таблица строится из allCustomers - у контрагента может
  // быть депозит, даже если долг уже полностью закрыт) - иначе банкрота с депозитом было бы
  // нечем распознать при скрытии банкротов (см. ниже).
  allCustomers.forEach(function(c) { c.daysOverdue = daysSince(c.oldestUnpaidDate); });

  // Статус взыскания (Влад, 2026-07-14: "должник, претензия, суд, исполнительный лист... и
  // срок сколько уже стоит такой статус"; добавлен "Банкрот" 2026-07-16).
  const debtStatuses = getDebtStatuses_(ss);
  allCustomers.forEach(function(c) {
    const st = debtStatuses[c.contragent];
    c.status = st ? st.status : '';
    c.statusSince = st ? st.since : '';
    c.statusDays = st ? daysSince(st.since) : 0;
    c.comment = st ? st.comment : '';
  });

  // Автоматический статус "В графике" для свежих долгов (Влад, 2026-07-16: "все кто до 30
  // дней автомат статус в графике, после 30 дней статус должен быть пустой и я уже
  // определяю что с ним") - ТОЛЬКО пока статус не проставлен вручную (ручной выбор всегда
  // в приоритете, см. debtStatuses выше), и НЕ пишется в ДЗ_Статусы - пересчитывается
  // заново при каждом запросе по daysOverdue, поэтому при переходе за 30 дней автоматически
  // становится пустым, без ручной очистки.
  allCustomers.forEach(function(c) {
    if (!c.status && c.daysOverdue <= 30) {
      c.status = 'В графике';
      c.statusAuto = true;
    }
  });

  // 4-й блок КПЭ "По статусам" (Влад, 2026-07-16: "нужен четвёртый блок где будут суммы по
  // статусам, например сумма всех статусов Исполнительный лист") - сумма долга и кол-во
  // должников на каждый статус, плюс отдельно те, у кого статус вообще не проставлен.
  const byStatusMap = {};
  customers.forEach(function(c) {
    const key = c.status || '(без статуса)';
    if (!byStatusMap[key]) byStatusMap[key] = { status: key, balance: 0, customers: 0 };
    byStatusMap[key].balance += c.balance;
    byStatusMap[key].customers++;
  });
  const byStatus = Object.keys(byStatusMap)
    .map(function(k) { return byStatusMap[k]; })
    .sort(function(a, b) { return b.balance - a.balance; });

  const byManagerMap = {};
  customers.forEach(function(c) {
    if (!byManagerMap[c.manager]) byManagerMap[c.manager] = { name: c.manager, balance: 0, customers: 0 };
    byManagerMap[c.manager].balance += c.balance;
    byManagerMap[c.manager].customers++;
  });

  const totalBalance = customers.reduce(function(s, c) { return s + c.balance; }, 0);
  // "Текущая" (0-30 дн.) добавлена, чтобы 4 корзины давали ровно totalBalance (Влад,
  // 2026-07-10: "сумма этих чисел меньше, чем общее ДЗ... должно всё биться") - раньше
  // просрочка 0-30 дней вообще никуда не попадала, отсюда и расхождение с "Общая ДЗ".
  const current0_30 = customers.filter(function(c) { return c.daysOverdue <= 30; }).reduce(function(s,c){return s+c.balance;}, 0);
  const overdue30 = customers.filter(function(c) { return c.daysOverdue > 30 && c.daysOverdue <= 60; }).reduce(function(s,c){return s+c.balance;}, 0);
  const overdue60 = customers.filter(function(c) { return c.daysOverdue > 60 && c.daysOverdue <= 90; }).reduce(function(s,c){return s+c.balance;}, 0);
  const overdue90 = customers.filter(function(c) { return c.daysOverdue > 90 && c.daysOverdue < DEBT_AGE_LIMIT_DAYS; }).reduce(function(s,c){return s+c.balance;}, 0);
  // "Мёртвая" (Влад, 2026-07-16: "в блок просрочка добавь мёртвая - это от 600 дней и
  // больше") - считаем от ПОЛНОГО allCustomers (не customers, отфильтрованного по
  // 600-дневному лимиту фронтендом), иначе эта корзина всегда показывала бы 0.
  const deadDebt = allCustomers.filter(function(c) { return c.balance > 0 && c.daysOverdue >= DEBT_AGE_LIMIT_DAYS; }).reduce(function(s,c){return s+c.balance;}, 0);

  // Общий долг по юрлицам (Влад, 2026-07-09: "32602... эта сумма должна быть разбита: на
  // сколько в Бульдоге, сколько в Ярде") - сумма положительных остатков по каждому юрлицу
  // среди РЕАЛЬНЫХ должников (customers уже отфильтрован на balance>0 выше).
  const byOrgMap = {};
  customers.forEach(function(c) {
    (c.byOrg || []).forEach(function(o) {
      byOrgMap[o.org] = (byOrgMap[o.org] || 0) + o.balance;
    });
  });
  const byOrg = Object.keys(byOrgMap)
    .map(function(org) { return { org: org, balance: byOrgMap[org] }; })
    .sort(function(a, b) { return b.balance - a.balance; });

  const histSheet = ss.getSheetByName(DEBT_HISTORY_SHEET);
  let history = [];
  if (histSheet && histSheet.getLastRow() > 1) {
    const histNumCols = 4 + DEBT_ORG_KEYS.length + 1; // + "ДЗ 0-90 дней"
    history = histSheet.getRange(2, 1, histSheet.getLastRow() - 1, histNumCols).getValues()
      .filter(function(r) { return r[0] instanceof Date; })
      .map(function(r) {
        // Разбивка по юрлицам за этот день - для стрелок тенденций по каждому юрлицу
        // (Влад, 2026-07-10). Старые строки (записаны до этой колонки) дадут 0 - не страшно,
        // тренд для них просто не посчитается (см. фронтенд).
        const byOrgDay = {};
        DEBT_ORG_KEYS.forEach(function(k, i) { byOrgDay[DEBT_ORG_SHORT_NAMES[k]] = parseFloat(r[4 + i]) || 0; });
        return {
          date: Utilities.formatDate(r[0], 'Europe/Moscow', 'yyyy-MM-dd'),
          balance: r[1] || 0, debt: r[2] || 0, debtors: r[3] || 0,
          byOrg: byOrgDay,
          // Долг 0-90 дней - для мини-графика на карточке "Дебиторская задолженность" на
          // Панели (Влад, 2026-07-16). Строки до этой колонки дадут 0 - копится с момента
          // деплоя, как и всё остальное в этой истории.
          debt0to90: parseFloat(r[4 + DEBT_ORG_KEYS.length]) || 0,
        };
      })
      .sort(function(a, b) { return a.date.localeCompare(b.date); });
  }

  // Все клиенты с гарантийным ДЕПОЗИТОМ (не только реальные должники - клиент с полностью
  // покрытым долгом уже не входит в customers, но депозит по нему всё ещё стоит показать) -
  // Влад, 2026-07-14/15: "хочу отдельной табличкой внизу все гарантийные депозиты и сумма
  // их" -> уточнение: "нужно видеть только депозиты, гарантийные платежи не нужны" - платёж
  // (Гарантийный платёж) в эту таблицу больше не попадает.
  const guarantees = allCustomers
    .filter(function(c) { return (c.guaranteeDeposit || 0) > 0; })
    .map(function(c) {
      // status - чтобы фронтенд мог скрыть банкротов и здесь тоже (Влад, 2026-07-16: "нигде").
      return { contragent: c.contragent, manager: c.manager, guaranteeDeposit: c.guaranteeDeposit, status: c.status };
    })
    .sort(function(a, b) { return b.guaranteeDeposit - a.guaranteeDeposit; });
  const guaranteesTotal = guarantees.reduce(function(s, g) { return s + g.guaranteeDeposit; }, 0);

  // Drill-down "что изменилось" по клику на стрелку тренда (Влад, 2026-07-15: "при нажатии
  // на -5% +23% видеть какие именно изменения были, кто и как уменьшил или увеличил ДЗ";
  // уточнение 2026-07-16: "если кликаю на Бульдог - хочу видеть только Бульдог изменения") -
  // сравниваем ЖИВОЙ баланс сейчас с последним записанным снимком за ПРОШЛЫЙ (не сегодняшний
  // - тот мог быть ещё не записан) день. Считаем и общий diff (по всем юрлицам), и отдельно
  // diff по каждому юрлицу.
  const custHistSheet = ss.getSheetByName(DEBT_CUSTOMER_HISTORY_SHEET);
  let debtChanges = [];
  const debtChangesByOrg = {};
  let debtChangesCompareDate = null; // дата точки сравнения - показываем на фронте ("vs 12.07")
  if (custHistSheet && custHistSheet.getLastRow() > 1) {
    const custHistNumCols = Math.min(4, custHistSheet.getLastColumn());
    const hasOrgCol = custHistNumCols >= 4;
    const custHistData = custHistSheet.getRange(2, 1, custHistSheet.getLastRow() - 1, custHistNumCols).getValues();
    const availableDateKeys = {};
    custHistData.forEach(function(r) {
      if (!(r[0] instanceof Date)) return;
      const key = Utilities.formatDate(r[0], 'Europe/Moscow', 'yyyy-MM-dd');
      if (key < todayStr) availableDateKeys[key] = true;
    });
    const sortedDateKeys = Object.keys(availableDateKeys).sort();
    let prevDateKey = null;
    if (compareDaysBack <= 1) {
      // "Вчера" - последняя доступная дата до сегодня (как раньше).
      prevDateKey = sortedDateKeys.length ? sortedDateKeys[sortedDateKeys.length - 1] : null;
    } else {
      // Более широкий период (неделя и т.п.) - ближайшая доступная дата к цели, а не точное
      // совпадение (сбор истории мог прерваться на день-два).
      const targetDate = new Date(todayStr + 'T00:00:00');
      targetDate.setDate(targetDate.getDate() - compareDaysBack);
      let bestDiff = Infinity;
      sortedDateKeys.forEach(function(k) {
        const diff = Math.abs(new Date(k + 'T00:00:00').getTime() - targetDate.getTime());
        if (diff < bestDiff) { bestDiff = diff; prevDateKey = k; }
      });
    }
    debtChangesCompareDate = prevDateKey;
    if (prevDateKey) {
      const prevByName = {};         // {контрагент: баланс вчера, сумма по всем юрлицам}
      const prevByNameOrg = {};      // {юрлицо: {контрагент: баланс вчера в этом юрлице}}
      custHistData.forEach(function(r) {
        if (!(r[0] instanceof Date)) return;
        const key = Utilities.formatDate(r[0], 'Europe/Moscow', 'yyyy-MM-dd');
        if (key !== prevDateKey) return;
        const name = String(r[1] || '');
        const org = hasOrgCol ? String(r[2] || '') : '';
        const bal = parseFloat(r[hasOrgCol ? 3 : 2]) || 0;
        prevByName[name] = (prevByName[name] || 0) + bal;
        if (org) {
          if (!prevByNameOrg[org]) prevByNameOrg[org] = {};
          prevByNameOrg[org][name] = (prevByNameOrg[org][name] || 0) + bal;
        }
      });

      // Общий diff (по всем юрлицам сразу) - для клика на общую сумму "Общая ДЗ".
      const seen = {};
      customers.forEach(function(c) {
        seen[c.contragent] = true;
        const prevBal = prevByName[c.contragent] || 0;
        const diff = c.balance - prevBal;
        if (Math.round(diff) !== 0) {
          // Дней в статусе должника (Влад, 2026-07-17: "долг растёт, а он и так уже должник
          // давно - это помогает принимать решения") - тот же daysOverdue, что в таблице.
          debtChanges.push({ contragent: c.contragent, manager: c.manager, yesterday: prevBal, today: c.balance, diff: diff, status: c.status, days_overdue: c.daysOverdue });
        }
      });
      // Контрагенты, которые ВЧЕРА были в списке (с балансом), а СЕГОДНЯ полностью закрыли
      // долг (выпали из customers, т.к. баланс<=0 теперь) - это тоже изменение.
      Object.keys(prevByName).forEach(function(name) {
        if (seen[name]) return;
        const prevBal = prevByName[name];
        if (prevBal > 0) debtChanges.push({ contragent: name, manager: '', yesterday: prevBal, today: 0, diff: -prevBal });
      });
      debtChanges.sort(function(a, b) { return Math.abs(b.diff) - Math.abs(a.diff); });

      // Diff ОТДЕЛЬНО ПО КАЖДОМУ ЮРЛИЦУ (Влад: "кликаю на Бульдог - вижу только Бульдог").
      DEBT_ORG_KEYS.forEach(function(orgKey) {
        const orgName = DEBT_ORG_SHORT_NAMES[orgKey];
        const prevForOrg = prevByNameOrg[orgName] || {};
        const orgChanges = [];
        const seenOrg = {};
        customers.forEach(function(c) {
          var todayOrgBal = 0;
          (c.byOrg || []).forEach(function(o) { if (o.org === orgName) todayOrgBal = o.balance; });
          if (todayOrgBal === 0 && !prevForOrg[c.contragent]) return; // не участвовал в этом юрлице
          seenOrg[c.contragent] = true;
          const prevBal = prevForOrg[c.contragent] || 0;
          const diff = todayOrgBal - prevBal;
          if (Math.round(diff) !== 0) {
            orgChanges.push({ contragent: c.contragent, manager: c.manager, yesterday: prevBal, today: todayOrgBal, diff: diff, status: c.status, days_overdue: c.daysOverdue });
          }
        });
        Object.keys(prevForOrg).forEach(function(name) {
          if (seenOrg[name]) return;
          const prevBal = prevForOrg[name];
          if (prevBal > 0) orgChanges.push({ contragent: name, manager: '', yesterday: prevBal, today: 0, diff: -prevBal });
        });
        orgChanges.sort(function(a, b) { return Math.abs(b.diff) - Math.abs(a.diff); });
        if (orgChanges.length) debtChangesByOrg[orgName] = orgChanges;
      });
    }
  }

  return {
    summary: {
      total_balance: totalBalance,
      debtor_count: customers.length,
      current_0_30: current0_30,
      overdue_30_60: overdue30,
      overdue_60_90: overdue60,
      overdue_90_plus: overdue90,
      overdue_dead: deadDebt,
      by_org: byOrg,
      old_unclosed_orders_count: oldUnclosedCount,
      old_unclosed_orders_amount: oldUnclosedAmount,
      guarantees_total: guaranteesTotal,
    },
    by_customer: customers,
    by_manager: Object.values(byManagerMap).sort(function(a, b) { return b.balance - a.balance; }),
    by_status: byStatus,
    guarantees: guarantees,
    history: history,
    debt_changes: debtChanges,
    debt_changes_by_org: debtChangesByOrg,
    debt_changes_compare_date: debtChangesCompareDate,
    debt_changes_days_back: compareDaysBack,
  };
}

// ============================================================
// ПОСТУПЛЕНИЯ — реальные деньги на расчётный счёт (тралы Ярд)
// Отдельный отчёт 1С (не путать с "Выручкой" по актам и с "ДЗ" - кто должен). Влад настроил
// рассылку 3 раза в день (6:00/12:00/18:00), см. plans/2026-08-13-receipts-report-tab.md.
// Отчёт НАКОПИТЕЛЬНЫЙ с начала месяца ("Стандартный период: 01.08.2026 - 13.08.2026") -
// каждое письмо содержит ВСЕ поступления с 1-го числа, поэтому импорт полностью
// ПЕРЕЗАПИСЫВАЕТ текущий месяц (не доливает), а не пытается мержить строки.
// ============================================================
const RECEIPTS_SHEET       = 'Поступления_данные';
const RECEIPTS_ARCHIVE_PFX = 'Поступления_';   // + YYYY-MM, например «Поступления_2026-08»
const RECEIPTS_GMAIL_QUERY = 'subject:"Рассылка Поступления на расчетный счет тралы" has:attachment newer_than:2d';
const RECEIPTS_ARTICLE_MARKER_ = 'Поступление за услуги спецтехники';

// "Стандартный период: DD.MM.YYYY - DD.MM.YYYY" -> месяц КОНЦА периода ("2026-08") - это и
// есть месяц, за который сейчас накапливается отчёт.
function receiptsExtractPeriodEndMonth_(rawData) {
  for (let r = 0; r < Math.min(rawData.length, 5); r++) {
    const rowArr = rawData[r] || [];
    for (let c = 0; c < rowArr.length; c++) {
      const s = String(rowArr[c] || '');
      const m = s.match(/\d{2}\.\d{2}\.\d{4}\s*-\s*(\d{2})\.(\d{2})\.(\d{4})/);
      if (m) return m[3] + '-' + m[2];
    }
  }
  return null;
}

// Убирает служебный "хвост" у имени контрагента - ИНН (в скобках или голым числом) и любые
// бухгалтерские пометки в скобках (напр. "(ГИ)", "(Савиток)"). ВАЖНО: эти пометки НЕ
// используются как признак менеджера (Влад, 2026-08-13: "не нужно на это ориентироваться,
// у нас ответственный - тот, кто делал крайнюю сделку") - функция нужна только чтобы
// сопоставить одного и того же клиента между "Поступлениями" и остальными выгрузками 1С,
// где таких хвостов обычно нет.
function normalizeReceiptClientName_(name) {
  let s = String(name || '');
  s = s.replace(/\d{5,}/g, ' ');     // ИНН - 5+ цифр подряд, в скобках или без
  s = s.replace(/\([^)]*\)/g, ' ');  // любые пометки в скобках, не только в конце строки
  s = s.replace(/!/g, ' ');
  return s.replace(/\s+/g, ' ').trim().toUpperCase();
}

// Карта "клиент -> менеджер последней сделки" - переиспользует уже готовую и подтверждённую
// клиентскую аналитику (см. computeClientAnalyticsFromAggregate_/getClientHistoryAggregate_/
// getClientLiveRows_ выше), тот же принцип атрибуции, что уже работает на "ДЗ" и "Клиентах".
// Специально ЛЁГКАЯ версия (без сегментов/win-back/сезонности из finishClientAnalytics_) -
// вызывается на каждом импорте "Поступлений" (несколько раз в день), тяжёлая аналитика была
// бы избыточна для того, чтобы просто узнать одно имя менеджера на клиента.
function getClientManagerMap_(ss) {
  const map = {};
  try {
    const histAgg = getClientHistoryAggregate_();
    if (histAgg) {
      Object.keys(histAgg).forEach(function(name) {
        const key = normalizeReceiptClientName_(name);
        if (key) map[key] = cleanManagerName_(histAgg[name].manager || '');
      });
      const liveRows = getClientLiveRows_(ss);
      const latestDateByKey = {};
      liveRows.forEach(function(r) {
        const key = normalizeReceiptClientName_(r.customer);
        if (!key || !r.date) return;
        // "Последняя сделка выигрывает" - живые (текущие) строки перекрывают историю, если
        // они позже, тот же принцип, что и в computeClientAnalyticsFromAggregate_.
        if (!latestDateByKey[key] || r.date >= latestDateByKey[key]) {
          latestDateByKey[key] = r.date;
          map[key] = cleanManagerName_(r.mgrSales || '');
        }
      });
    } else {
      // Фолбэк, если предпосчитанный агрегат ещё не построен - тот же принцип "последняя
      // сделка выигрывает", но по сырым строкам (дороже, см. getClientAnalyticsRows_).
      const rawRows = getClientAnalyticsRows_(ss);
      const latestDateByKey2 = {};
      rawRows.forEach(function(r) {
        const key = normalizeReceiptClientName_(r.customer);
        if (!key || !r.date) return;
        if (!latestDateByKey2[key] || r.date >= latestDateByKey2[key]) {
          latestDateByKey2[key] = r.date;
          map[key] = cleanManagerName_(r.mgrSales || '');
        }
      });
    }
  } catch (mapErr) {
    Logger.log('getClientManagerMap_: ' + mapErr);
  }
  return map;
}

// Разбирает сырую выгрузку отчёта "Поступления" - плоская таблица (без иерархии, в отличие
// от ДЗ). Заголовок ищем по тексту "Дата" в колонке A, а не по фиксированному номеру строки -
// защита от лишней/недостающей пустой строки в начале файла.
function parseReceiptsRawRows_(rawData) {
  const reportMonth = receiptsExtractPeriodEndMonth_(rawData);

  let headerRowIdx = -1;
  for (let r = 0; r < Math.min(rawData.length, 10); r++) {
    if (String((rawData[r] || [])[0] || '').trim() === 'Дата') { headerRowIdx = r; break; }
  }
  if (headerRowIdx < 0) {
    throw new Error('Поступления: не найдена строка заголовков ("Дата" в колонке A) - формат отчёта мог измениться');
  }

  const rows = [];
  let reportedTotal = null;

  for (let r = headerRowIdx + 1; r < rawData.length; r++) {
    const row = rawData[r];
    const firstCell = String(row[0] || '').trim();
    if (!firstCell) continue;
    if (firstCell === 'Итого') { reportedTotal = ordParseNum(row[9]); break; }

    // Статья движения денежных средств - защита от строк с другой статьёй, если 1С когда-
    // нибудь добавит их в этот же отчёт (в образце на 2026-08-13 статья всегда одна).
    const article = String(row[8] || '').trim();
    if (article && article.indexOf(RECEIPTS_ARTICLE_MARKER_) === -1) continue;

    const customer = String(row[4] || '').trim();
    const amount = ordParseNum(row[9]);
    if (!customer || !amount) continue;

    const doc = String(row[7] || '').trim();
    const docMatch = doc.match(/(\d{2}[А-Я]{2}-\d+)/);

    rows.push({
      date: ordFormatDate(row[0]),
      org: String(row[3] || '').trim(),
      customer: customer,
      contract: String(row[6] || '').trim(),
      docNumber: docMatch ? docMatch[1] : doc,
      amount: amount,
    });
  }

  return { rows: rows, reportMonth: reportMonth, reportedTotal: reportedTotal };
}

function receiptsExistingSheetMonth_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return null;
  const d = ordFormatDate(sheet.getRange(2, 1, 1, 1).getValue());
  return d ? d.slice(0, 7) : null;
}

const RECEIPTS_HEADERS_ = ['Дата', 'Юрлицо', 'Контрагент', 'Договор', 'Документ', 'Менеджер', 'Сумма'];

function writeReceiptsSheet_(ss, name, headers, rows) {
  let sheet = ss.getSheetByName(name);
  if (sheet) sheet.clear();
  else sheet = ss.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    sheet.getRange(2, 7, rows.length, 1).setNumberFormat('#,##0');
  }
}

function importReceiptsReport() {
  const threads = GmailApp.search(RECEIPTS_GMAIL_QUERY);
  if (!threads.length) throw new Error('Письмо "Поступления" не найдено за 2 дня');

  const msgs = [];
  for (const t of threads) for (const m of t.getMessages()) msgs.push(m);
  msgs.sort(function(a, b) { return b.getDate() - a.getDate(); });
  const latest = msgs[0];

  let att = null;
  for (const a of latest.getAttachments()) {
    if (a.getName().endsWith('.xlsx') || a.getName().endsWith('.xls')) { att = a; break; }
  }
  if (!att) throw new Error('Excel-вложение "Поступления" не найдено');

  const tmp = Drive.Files.insert(
    { title: 'tmp_receipts_' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS },
    att.copyBlob()
  );
  const rawData = SpreadsheetApp.openById(tmp.id).getSheets()[0].getDataRange().getValues();
  Drive.Files.remove(tmp.id);

  const parsed = parseReceiptsRawRows_(rawData);
  if (!parsed.rows.length) throw new Error('Поступления: после разбора не осталось ни одной строки - проверь формат файла');

  // Сверка со строкой "Итого" - минимальная защита от молчаливого съезда парсинга, если
  // формат столбцов 1С поменяется.
  const parsedTotal = parsed.rows.reduce(function(s, r) { return s + r.amount; }, 0);
  // Допуск 5 ₽ - страховка от накопленной погрешности плавающей точки на сотнях строк с
  // копеечными долями (в образце встречались суммы вида 20687.5), не признак реальной ошибки.
  if (parsed.reportedTotal != null && Math.abs(parsedTotal - parsed.reportedTotal) > 5) {
    throw new Error('Поступления: сумма строк (' + Math.round(parsedTotal) + ') не сошлась с "Итого" (' +
      Math.round(parsed.reportedTotal) + ') - прерываю импорт, формат мог измениться');
  }

  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  const managerMap = getClientManagerMap_(ss);
  parsed.rows.forEach(function(row) {
    row.manager = managerMap[normalizeReceiptClientName_(row.customer)] || 'Не определён';
  });

  // Маршрутизация по МЕСЯЦУ КАЖДОЙ СТРОКИ (не по заявленному периоду отчёта целиком) - это
  // одновременно покрывает рутинный ежедневный импорт (один месяц - текущий), позднюю
  // коррекцию прошлого месяца (один месяц - не текущий) И разовую массовую выгрузку сразу за
  // несколько месяцев (Влад, 2026-08-13: "один раз выгружу за пол года") - без этого разовая
  // выгрузка тихо схлопнула бы полгода данных в один "текущий месяц" и испортила бы KPI/график.
  const groups = {}; // 'YYYY-MM' -> строки
  parsed.rows.forEach(function(r) {
    const mk = r.date.slice(0, 7);
    if (!groups[mk]) groups[mk] = [];
    groups[mk].push(r);
  });
  const nowMonthKey = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM');
  function toSheetRows(list) {
    return list.map(function(r) { return [r.date, r.org, r.customer, r.contract, r.docNumber, r.manager, r.amount]; });
  }

  // Если живой лист сейчас держит месяц, ОТЛИЧНЫЙ от текущего, И новый файл этот месяц с
  // собой не принёс (то есть это обычный ежедневный импорт, а не коррекция/массовая выгрузка,
  // которые сами перезапишут этот месяц ниже) - последний известный живой снимок нужно
  // сохранить в архив ПЕРЕД перезаписью, иначе он пропадёт при переходе на новый месяц.
  const existingSheet = ss.getSheetByName(RECEIPTS_SHEET);
  const existingMonth = receiptsExistingSheetMonth_(existingSheet);
  if (existingMonth && existingMonth !== nowMonthKey && !groups[existingMonth]) {
    if (!ss.getSheetByName(RECEIPTS_ARCHIVE_PFX + existingMonth)) {
      const existingData = existingSheet.getDataRange().getValues();
      writeReceiptsSheet_(ss, RECEIPTS_ARCHIVE_PFX + existingMonth, existingData[0], existingData.slice(1));
      Logger.log('✅ Поступления: архив создан ' + existingMonth + ' (переход на новый месяц)');
    }
  }

  // Каждый месяц, кроме текущего, - полностью в свой архив (или коррекция уже существующего
  // архива, или новый архив из массовой выгрузки - разницы нет, всегда полная замена данными
  // из этого файла, отчёт сам по себе накопительный и авторитетный на момент отправки).
  let archivedMonths = 0;
  Object.keys(groups).sort().forEach(function(mk) {
    if (mk === nowMonthKey) return;
    writeReceiptsSheet_(ss, RECEIPTS_ARCHIVE_PFX + mk, RECEIPTS_HEADERS_, toSheetRows(groups[mk]));
    archivedMonths++;
  });

  // Текущий месяц - в живой лист, но только если файл его реально содержит (историческая
  // выгрузка может обрываться до сегодняшнего дня - тогда живой лист не трогаем вообще).
  if (groups[nowMonthKey]) {
    writeReceiptsSheet_(ss, RECEIPTS_SHEET, RECEIPTS_HEADERS_, toSheetRows(groups[nowMonthKey]));
  }

  latest.markRead();
  Logger.log('✅ Поступления импортированы: ' + parsed.rows.length + ' строк, ' + Math.round(parsedTotal) +
    ' ₽, месяцев в файле: ' + Object.keys(groups).length + ' (архивировано: ' + archivedMonths +
    (groups[nowMonthKey] ? ', + текущий месяц в живой лист' : ', текущего месяца в файле не было') + ')');
}

function receiptsReadSheetRows_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  return data.map(function(r) {
    return {
      date: ordFormatDate(r[0]),
      org: String(r[1] || '').trim(),
      customer: String(r[2] || '').trim(),
      contract: String(r[3] || '').trim(),
      docNumber: String(r[4] || '').trim(),
      manager: String(r[5] || '').trim(),
      amount: ordParseNum(r[6]),
    };
  }).filter(function(r) { return r.date && r.amount; });
}

// Выручка по месяцам - для сравнения с "Поступлениями" (2026-08-13, Влад: "сравнивал
// поступления с выручкой по дням и месяцам"). Читает уже готовый кэш История_месяцев (тот же,
// что "Глобальная статистика") - НЕ пересчитывает архивы заказов на лету на каждый запрос
// doGet(). Может не покрывать совсем ранние месяцы, если Поступления загружены глубже, чем
// копится История_месяцев - тогда revenue у месяца просто null, это честно, не выдумываем.
function receiptsMonthRevenueMap_(ss) {
  const map = {};
  try {
    const sheet = ss.getSheetByName(MONTH_SUMMARY_SHEET);
    if (sheet && sheet.getLastRow() > 1) {
      // "revenue" тут = "Выручка коммерческая" (без внутригрупповых, колонка 16, добавлена
      // 2026-08-13) - НЕ общая "Выручка" (колонка 2, та используется на "Глобальной
      // статистике" и специально включает внутренние). Влад, 2026-08-13: "внутренних не
      // должно быть, мы всё равно не получаем по ним поступления". И "Наличные" (колонка 15,
      // тоже добавлена 2026-08-13) - для старых строк, записанных до появления этих двух
      // колонок, оба поля будут undefined/0, пока не запущен backfillMonthSummaries() заново.
      const width = Math.max(sheet.getLastColumn(), MONTH_SUMMARY_HEADERS.length);
      const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
      data.forEach(function(r) {
        if (!r[0]) return;
        map[monthKeyFrom_(r[0])] = { revenue: r[15] || 0, cash: r[14] || 0 };
      });
    }
  } catch (revErr) {
    Logger.log('receiptsMonthRevenueMap_: ' + revErr);
  }

  // Донабираем более СТАРЫЕ месяцы (до CLIENT_HISTORY_CUTOFF включительно), которых нет в
  // "История_месяцев" - Влад, 2026-08-13: "мы вроде делали отдельную таблицу по той большой
  // выгрузке за предыдущие периоды и года" - это она (CLIENT_HISTORY_SHEET_ID, "Нормализованные
  // _история_заказов"/"История_клиентов_агрегат"), уже подключена к дашборду для вкладки
  // "Клиенты", просто раньше не использовалась для сравнения с "Поступлениями". НЕ пишем эти
  // месяцы в саму "История_месяцев" - там нет остальных полей (ВП/затраты/план), строка
  // выглядела бы обманчиво на "Глобальной статистике" (нули вместо "нет данных"), только для
  // сравнения на этой вкладке. Методика теперь СОГЛАСОВАНА с живой частью (2026-08-13,
  // тот же вечер): offline-выгрузка изначально исключает внутренние перевозки (см.
  // .business/clients/INDEX.md), а живая часть выше читает именно "Выручка коммерческая"
  // (тоже без внутренних) - раньше тут было расхождение методик, теперь обе половины карты
  // одинаково "без внутригрупповых".
  try {
    const agg = getClientHistoryAggregate_();
    if (agg) {
      // "c" (наличка) в дневном JSON появилась 2026-08-13 (Влад: "осталось наличку с января
      // по май найти и подгрузить, можем подтянуть из мега-базы?") - если агрегат ещё не
      // пересчитан (buildClientHistoryAggregate() не запускался заново), daily[dateStr].c
      // просто undefined -> 0, без ошибок, старое поведение сохраняется до пересчёта.
      const histByMonth = {};
      const histCashByMonth = {};
      Object.keys(agg).forEach(function(name) {
        const daily = agg[name].daily || {};
        Object.keys(daily).forEach(function(dateStr) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || dateStr > CLIENT_HISTORY_CUTOFF) return;
          const mk = dateStr.slice(0, 7);
          histByMonth[mk] = (histByMonth[mk] || 0) + (daily[dateStr].r || 0);
          histCashByMonth[mk] = (histCashByMonth[mk] || 0) + (daily[dateStr].c || 0);
        });
      });
      Object.keys(histByMonth).forEach(function(mk) {
        if (!(mk in map)) map[mk] = { revenue: histByMonth[mk], cash: histCashByMonth[mk] || 0 };
      });
    }
  } catch (histErr) {
    Logger.log('receiptsMonthRevenueMap_ (историческая часть): ' + histErr);
  }

  return map;
}

// Агрегация для дашборда - вкладка "Поступления". Читает уже готовые (посчитанные при
// импорте) строки, сама ничего заново не сопоставляет с менеджерами - быстро, без похода в
// клиентскую аналитику на каждый запрос doGet(). ordersData - уже посчитанный getOrdersData(ss)
// (передаётся вызывающим кодом из doGet(), чтобы не считать заказы дважды за один запрос) -
// источник "Выручки по дням" для текущего месяца - ordersData.summary.by_day_commercial
// (БЕЗ внутригрупповых, см. total_commercial в aggregateOrdersRows - Влад, 2026-08-13:
// "внутренних не должно быть, мы всё равно не получаем по ним поступления").
function getReceiptsData(ss, ordersData) {
  const liveSheet = ss.getSheetByName(RECEIPTS_SHEET);
  const liveRows = receiptsReadSheetRows_(liveSheet);
  if (!liveRows.length) {
    return { error: 'Нет данных "Поступления" - импорт ещё не выполнялся или письмо 1С не пришло' };
  }

  const currentMonth = liveRows.reduce(function(m, r) { return r.date > m ? r.date : m; }, liveRows[0].date).slice(0, 7);
  const maxDate = liveRows.reduce(function(m, r) { return r.date > m ? r.date : m; }, liveRows[0].date);
  const daysElapsed = parseInt(maxDate.slice(8, 10), 10) || 1;
  const todayStr = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM-dd');

  // Наличные поступления текущего месяца (из заказов - см. комментарий у "daily" ниже) -
  // прибавляются к безналу отчёта 1С, чтобы "Поступления" отражали ВСЕ реально полученные
  // деньги, а не только то, что прошло через расчётный счёт.
  const totalCashMonth = (ordersData && ordersData.summary && ordersData.summary.total_cash) || 0;
  const cashByDayForToday = (ordersData && ordersData.summary && ordersData.summary.by_day_cash) || {};
  // Живая выручка (коммерческая, без внутригрупповых) текущего месяца - для monthly-записи
  // текущего месяца, тем же принципом, что и totalCashMonth (не кэш История_месяцев, тот
  // обновляется раз за прогон runAll() и может отставать внутри дня).
  const totalRevenueMonthLive = (ordersData && ordersData.summary && ordersData.summary.total_commercial);

  const totalBankMonth = liveRows.reduce(function(s, r) { return s + r.amount; }, 0);
  const totalMonth = totalBankMonth + totalCashMonth;
  const totalToday = liveRows.filter(function(r) { return r.date === todayStr; })
    .reduce(function(s, r) { return s + r.amount; }, 0) + (cashByDayForToday[todayStr] || 0);

  const byOrgMap = {};
  liveRows.forEach(function(r) { byOrgMap[r.org] = (byOrgMap[r.org] || 0) + r.amount; });
  const byOrg = Object.keys(byOrgMap).map(function(k) {
    return { org: k, name: DEBT_ORG_SHORT_NAMES[k] || k, amount: byOrgMap[k] };
  }).sort(function(a, b) { return b.amount - a.amount; });

  const dayMap = {};
  liveRows.forEach(function(r) { dayMap[r.date] = (dayMap[r.date] || 0) + r.amount; });
  // Выручка и наличные поступления по дням - только для ТЕКУЩЕГО месяца (ordersData уже
  // посчитан вызывающим кодом, архивные месяцы намеренно не тянем на каждый запрос - см.
  // комментарий у getReceiptsData). Наличка (Влад, 2026-08-13: "поступления налички видно из
  // таблицы заказов" - отчёт 1С по р/с наличные вообще не видит) прибавляется к безналичным
  // "Поступлениям", чтобы столбец на графике показывал ВСЕ реально полученные деньги.
  const revByDay = (ordersData && ordersData.summary && ordersData.summary.by_day_commercial) || {};
  const daily = Object.keys(dayMap).sort().map(function(d) {
    const cash = cashByDayForToday[d] || 0;
    return {
      date: d,
      bank: dayMap[d],
      cash: cash,
      amount: dayMap[d] + cash, // "Поступления" на графике - безнал + нал вместе
      revenue: (d in revByDay) ? revByDay[d] : null,
    };
  });

  const mgrMap = {};
  liveRows.forEach(function(r) {
    const key = r.manager || 'Не определён';
    if (!mgrMap[key]) mgrMap[key] = { manager: key, amount: 0, count: 0 };
    mgrMap[key].amount += r.amount;
    mgrMap[key].count++;
  });
  const byManager = Object.values(mgrMap).sort(function(a, b) { return b.amount - a.amount; });

  // "Юрлицо" в таблице по клиентам (Влад, 2026-08-13: "нужно просто чтобы в таблице была
  // колонка с нашим КА куда упали деньги") - вместо отдельного графика (не понравился, убран).
  // Один клиент может платить в НЕСКОЛЬКО наших юрлиц - копим множество, на выходе строка
  // через запятую (обычно одно, но не гарантировано).
  const custMap = {};
  liveRows.forEach(function(r) {
    if (!custMap[r.customer]) custMap[r.customer] = { customer: r.customer, manager: r.manager, amount: 0, count: 0, orgsSet: {} };
    custMap[r.customer].amount += r.amount;
    custMap[r.customer].count++;
    custMap[r.customer].orgsSet[r.org] = true;
  });
  const byCustomer = Object.values(custMap).map(function(c) {
    c.orgs = Object.keys(c.orgsSet).map(function(o) { return DEBT_ORG_SHORT_NAMES[o] || o; }).sort().join(', ');
    delete c.orgsSet;
    return c;
  }).sort(function(a, b) { return b.amount - a.amount; });

  // По месяцам (архивы + текущий живой месяц) - для графика динамики по месяцам. "bank" -
  // только безналичные поступления (из отчёта 1С), "amount" - вместе с наличкой (как и в
  // daily выше), чтобы обе разбивки (по дням и по месяцам) значили одно и то же.
  const monthly = [];
  ss.getSheets().forEach(function(sh) {
    const name = sh.getSheetName();
    if (name.indexOf(RECEIPTS_ARCHIVE_PFX) !== 0) return;
    const monthKey = name.slice(RECEIPTS_ARCHIVE_PFX.length);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return;
    const rows = receiptsReadSheetRows_(sh);
    monthly.push({ month: monthKey, bank: rows.reduce(function(s, r) { return s + r.amount; }, 0), count: rows.length });
  });
  monthly.push({ month: currentMonth, bank: totalBankMonth, count: liveRows.length });
  monthly.sort(function(a, b) { return a.month < b.month ? -1 : 1; });

  // Наличка/выручка по месяцам - из кэша История_месяцев (см. receiptsMonthRevenueMap_),
  // КРОМЕ текущего месяца, где уже есть точное живое значение (кэш обновляется раз за
  // прогон runAll() и может немного отставать внутри дня).
  const monthRevMap = receiptsMonthRevenueMap_(ss);
  monthly.forEach(function(m) {
    const rc = monthRevMap[m.month];
    m.cash = (m.month === currentMonth) ? totalCashMonth : ((rc && rc.cash) || 0);
    m.amount = m.bank + m.cash;
    m.revenue = (m.month === currentMonth && totalRevenueMonthLive !== undefined)
      ? totalRevenueMonthLive
      : (rc ? rc.revenue : null);
  });

  // Сальдо с начала года (Влад, 2026-08-13: "нужно видеть общее сальдо по году выручка
  // поступления") - Поступления считаем по ВСЕМ месяцам года, что есть в "Поступлениях",
  // Выручку - только по тем месяцам года, где она известна (может быть короче) - сальдо
  // честное, но не всегда "месяц в месяц", если периоды не совпадают целиком.
  const currentYear = currentMonth.slice(0, 4);
  const ytdMonths = monthly.filter(function(m) { return m.month.slice(0, 4) === currentYear; });
  const ytdRevenueMonths = ytdMonths.filter(function(m) { return m.revenue != null; });
  const ytdReceipts = ytdMonths.reduce(function(s, m) { return s + m.amount; }, 0);
  const ytdRevenue = ytdRevenueMonths.reduce(function(s, m) { return s + m.revenue; }, 0);
  const ytd = {
    year: currentYear,
    receipts: ytdReceipts,
    receipts_months: ytdMonths.length,
    revenue: ytdRevenue,
    revenue_months: ytdRevenueMonths.length,
    balance: ytdReceipts - ytdRevenue,
  };

  // Сальдо ТОЛЬКО за текущий месяц (Влад, 2026-08-13: "в блочок сальдо по году также сальдо
  // по месяцу добавь инф.") - null, если выручка за этот месяц ещё не известна вообще
  // (не должно случиться для текущего месяца - totalRevenueMonthLive всегда живой - но
  // на всякий случай, если ordersData вдруг не пришёл).
  const monthBalance = (totalRevenueMonthLive !== undefined) ? (totalMonth - totalRevenueMonthLive) : null;

  return {
    month: currentMonth,
    summary: {
      total_month: totalMonth,
      total_bank: totalBankMonth,
      total_cash: totalCashMonth,
      total_today: totalToday,
      avg_per_day: totalMonth / daysElapsed,
      by_org: byOrg,
      ytd: ytd,
      month_balance: monthBalance,
      month_revenue: (totalRevenueMonthLive !== undefined) ? totalRevenueMonthLive : null,
    },
    daily: daily,
    by_manager: byManager,
    by_customer: byCustomer,
    monthly: monthly,
  };
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

  // Часы подогнаны под расписание 1С (шлёт отчёты каждые 3 часа с 6:00 до 21:00 -
  // Влад, 2026-07-07). +5 минут - запас на то, что письмо реально доходит до Gmail
  // не мгновенно (сам Влад оценил задержку в 1-2 минуты, берём с запасом).
  // nearMinute(5) - Apps Script не гарантирует срабатывание день-в-день строго по минуте
  // (у триггеров есть окно в несколько минут), но это ближайший к 5-й минуте вариант.
  var hours = [6, 9, 12, 15, 18, 21];
  for (var i = 0; i < hours.length; i++) {
    ScriptApp.newTrigger('runAll')
      .timeBased()
      .atHour(hours[i])
      .nearMinute(5)
      .everyDays(1)
      .inTimezone('Europe/Moscow')
      .create();
  }

  console.log('Триггеры установлены: runAll в 6:05, 9:05, 12:05, 15:05, 18:05, 21:05 по Москве');
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

// ── СЧЁТЧИК ВХОДОВ (2026-08-13, Влад: "раздаю доступы сотрудникам, хочу видеть кто сколько раз
// заходил") ──────────────────────────────────────────────────────────────────────────────────
// Одна строка на email - не полный лог каждого визита (рос бы бесконечно), а счётчик +
// первый/последний вход, этого достаточно, чтобы видеть, кто реально пользуется.
const ACCESS_LOG_SHEET = 'Логи_входов';

function ensureAccessLogSheet_(ss) {
  let sheet = ss.getSheetByName(ACCESS_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ACCESS_LOG_SHEET);
    sheet.getRange(1, 1, 1, 6).setValues([['Email', 'Имя', 'Роль', 'Первый вход', 'Последний вход', 'Заходов']]).setFontWeight('bold');
  }
  return sheet;
}

// Засчитывает один "визит" (открытие/обновление страницы, не каждый мелкий доп-запрос -
// вызывается только когда action пуст, см. doGet). Не критично для остального ответа - любая
// ошибка тут молча проглатывается в doGet, чтобы сбой записи лога не ронял саму страницу.
function logAccessVisit_(ss, email, name, role) {
  const sheet = ensureAccessLogSheet_(ss);
  const now = new Date().toISOString();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const emails = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < emails.length; i++) {
      if (String(emails[i][0] || '').trim().toLowerCase() === email) {
        const row = i + 2;
        const count = sheet.getRange(row, 6).getValue() || 0;
        sheet.getRange(row, 2, 1, 5).setValues([[name, role, sheet.getRange(row, 4).getValue(), now, count + 1]]);
        return;
      }
    }
  }
  sheet.appendRow([email, name, role, now, now, 1]);
}

// Сводка для карточки "Активность сотрудников" на Панели (только admin, см. data.access_log в
// doGet) - отсортировано по последнему входу, самые недавние первыми.
function getAccessLogSummary_(ss) {
  const sheet = ss.getSheetByName(ACCESS_LOG_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  return data.map(function(r) {
    return {
      email: String(r[0] || ''), name: String(r[1] || ''), role: String(r[2] || ''),
      first_visit: r[3] instanceof Date ? r[3].toISOString() : String(r[3] || ''),
      last_visit: r[4] instanceof Date ? r[4].toISOString() : String(r[4] || ''),
      count: Number(r[5]) || 0,
    };
  }).sort(function(a, b) { return String(b.last_visit).localeCompare(String(a.last_visit)); });
}

// Урезанный набор данных для роли "manager" - только его собственные цифры, без доступа к
// данным других людей и компании в целом. orders - уже загруженный результат getOrdersData
// (текущий месяц) ИЛИ getOrdersDataForPeriod (2026-08-11, выбор периода на личной странице -
// "текущий/прошлый месяц" - вынесено в отдельную функцию, чтобы не дублировать фильтрацию
// между getManagerView_ (текущий месяц) и getManagerViewForPeriod_ (архив) ниже). ss/period
// (2026-08-12) - опциональны, нужны только чтобы приложить ДЗ этого менеджера (см. ниже).
function buildManagerView_(orders, managerName, ss, period) {
  if (orders.error) return { error: orders.error };

  const myDetail = (orders.by_manager_detail || {})[managerName] || null;
  // by_manager уже содержит план/факт/% (joinManagerPlans_ внутри getOrdersData) -
  // отдельный поход в Менеджеры_данные больше не нужен, план и факт из одного места.
  const myManagerRow = (orders.by_manager || []).filter(function(m) { return m.name === managerName; });
  const myLogistRow  = (orders.by_logist  || []).filter(function(m) { return m.name === managerName; });

  const detailWrapped = {};
  if (myDetail) detailWrapped[managerName] = myDetail;

  const result = {
    updated: new Date().toISOString(),
    role: 'manager',
    managerName: managerName,
    managers: myManagerRow,
    orders: {
      period: orders.period,
      by_manager: myManagerRow,
      by_logist: myLogistRow,
      by_manager_detail: detailWrapped,
      // Проблемные заказы этого менеджера (2026-08-12, вкладка "Воронка документов" на личной
      // странице - тот же формат/источник, что "Обзор заказов → Проблемные заказы", просто
      // отфильтровано на одного человека, приватность - другие менеджеры не видны).
      problem_orders: (orders.problem_orders || []).filter(function(p) {
        return String(p.mgr || '').trim().split(' ')[0].toLowerCase() === managerName.trim().split(' ')[0].toLowerCase();
      }),
    },
  };

  // ДЗ, отфильтрованная на этого менеджера (2026-08-12, личная страница - вкладка
  // "Дебиторская задолженность", то же ядро computeDebtAggregates_/debtDeadAndStatus_, что
  // общая ДЗ на фронтенде). Приватность - другие менеджеры не видны, только свои должники.
  // ДЗ всегда "живая" (последний снимок 1С), не зависит от выбранного периода продаж.
  if (ss) {
    const dd = getDebtData(ss);
    if (dd && dd.by_customer) {
      const surLower = String(managerName || '').trim().split(' ')[0].toLowerCase();
      result.debt = {
        by_customer: dd.by_customer.filter(function(c) {
          return String(c.manager || '').trim().split(' ')[0].toLowerCase() === surLower;
        }),
      };
    }
  }

  return result;
}
function getManagerView_(ss, managerName) { return buildManagerView_(getOrdersData(ss), managerName, ss, null); }
function getManagerViewForPeriod_(ss, managerName, period) { return buildManagerView_(getOrdersDataForPeriod(ss, period), managerName, ss, period); }

function isVasinName_(name) {
  return (name||'').trim().split(' ')[0].toLowerCase() === 'васин';
}

// Личная страница логиста-длинномерщика (2026-08-11, Васин Максим - см.
// plans/2026-08-11-vasin-long-haul-page.md, plans/2026-08-11-vasin-perf-and-forecast.md).
// Принципиально другой набор данных, чем у "наёмных" логистов - Васин не брокер найма, у него
// 2.5% от ВП ВСЕХ длинномеров компании (собственный парк, calcVasin на фронтенде). Объединяет
// ДВА разных источника: aggregateFinHistoryForRange (прибыль по каждой машине, тот же
// источник, что вкладка "Техника") + УЖЕ ЗАГРУЖЕННЫЙ orders (воронка/сделки/несданные путёвки
// по сегменту "Длинномер" - поля long_funnel/by_driver_no_waybill_long/all_long_deals, см.
// aggregateOrdersRows) - orders передаётся снаружи, НЕ грузится здесь заново (2026-08-11,
// фикс перфоманса - раньше buildLogistView_ уже гонял getOrdersData ОДИН раз, а это же самое
// делалось ЕЩЁ РАЗ отдельным запросом action=long_haul_detail, вдвое медленнее, чем нужно).
// period - 'YYYY-MM' или falsy (текущий месяц).
function buildLongHaulBundle_(ss, orders, period) {
  var range = period ? monthKeyToRange_(period) : getCurrentMonthRange_();
  var staffData = getStaffData(ss);
  var vehicles = aggregateFinHistoryForRange(ss, staffData, range.from, range.to)
    .filter(function(v) { return v.type === 'Борт' || v.type.indexOf('Борт') === 0; }) // длинномер = тип "Борт" (тот же предикат, что getFleetStatus/isLongVehicle)
    .sort(function(a, b) { return b.profit - a.profit; });

  // ВП длинномеров ЦЕЛИКОМ ПО КОМПАНИИ - тот же источник, что уже использует calcVasin на
  // фронтенде для текущего месяца (D.summary.profit_long, только раньше он не доходил до
  // урезанной роли logist), для прошлого - тот же getGrossProfitForPeriod, что вкладки
  // Продажи/Менеджеры/Логисты/Зарплата (action=orders_period) уже используют для admin.
  var profitLong = null;
  if (!period) {
    var sd = getSummaryData(ss, orders);
    profitLong = (sd && typeof sd.profit_long === 'number') ? sd.profit_long : null;
  } else {
    var gp = getGrossProfitForPeriod(ss, period);
    profitLong = (gp && typeof gp.profit_long === 'number') ? gp.profit_long : null;
  }

  return {
    vehicles: vehicles,
    funnel: orders.long_funnel || { no_waybill:0, not_posted:0, no_realiz:0, complete:0 },
    driver_no_waybill: orders.by_driver_no_waybill_long || [],
    deals: orders.all_long_deals || [],
    summary: {
      long_orders:       (orders.summary && orders.summary.long_orders) || 0,
      long_amount:        (orders.summary && orders.summary.long_amount) || 0,
      own_long_orders:    (orders.summary && orders.summary.own_long_orders) || 0,
      own_long_amount:    (orders.summary && orders.summary.own_long_amount) || 0,
      hired_long_orders:  (orders.summary && orders.summary.hired_long_orders) || 0,
      hired_profit_long:  (orders.summary && orders.summary.hired_profit_long) || 0,
      profit_long: profitLong,
    },
  };
}

// Явный endpoint (action=long_haul_detail) - используется только admin-предпросмотром для
// ПРОШЛОГО периода (текущий месяц и вход самого Васина теперь получают long_haul бесплатно
// внутри buildLogistView_/основного admin-ответа, без второго запроса - см. ниже).
function getLongHaulDetail_(ss, period) {
  var orders = period ? getOrdersDataForPeriod(ss, period) : getOrdersData(ss);
  if (orders.error) return { error: orders.error };
  var bundle = buildLongHaulBundle_(ss, orders, period);
  bundle.period = orders.period;
  return bundle;
}

// Урезанный набор данных для роли "logist" (2026-08-10, по аналогии с buildManagerView_ выше) -
// только собственные заказы/маржа/сделки, без доступа к данным других людей и компании в целом.
// ss/period (2026-08-11) - опциональны, нужны только чтобы приложить long_haul для Васина
// (buildLongHaulBundle_ переиспользует уже загруженный orders, без повторного getOrdersData).
function buildLogistView_(orders, logistName, ss, period) {
  if (orders.error) return { error: orders.error };

  const myDetail = (orders.logist_detail || {})[logistName] || null;
  const myLogistRow = (orders.by_logist || []).filter(function(l) { return l.name === logistName; });

  const detailWrapped = {};
  if (myDetail) detailWrapped[logistName] = myDetail;

  const ordersOut = {
    period: orders.period,
    by_logist: myLogistRow,
    logist_detail: detailWrapped,
    // "Общие сделки" (2026-08-10, Влад: "он видит абсолютно всю ситуацию по направлению") -
    // осознанно расширенный доступ ТОЛЬКО по направлению найма (кто угодно с ролью logist
    // в листе "Доступ" увидит это), но НЕ вся компания - ни зарплаты остальных, ни выручка
    // менеджеров, ни что-либо за пределами наёмного парка сюда не попадает.
    by_hired_supplier: orders.by_hired_supplier || [],
    all_hired_deals:   orders.all_hired_deals || [],
  };
  if (ss && isVasinName_(logistName)) {
    ordersOut.long_haul = buildLongHaulBundle_(ss, orders, period || null);
  }

  return {
    updated: new Date().toISOString(),
    role: 'logist',
    logistName: logistName,
    orders: ordersOut,
  };
}
function getLogistView_(ss, logistName) { return buildLogistView_(getOrdersData(ss), logistName, ss, null); }
function getLogistViewForPeriod_(ss, logistName, period) { return buildLogistView_(getOrdersDataForPeriod(ss, period), logistName, ss, period); }

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
    // Счётчик входов (2026-08-13) - засчитываем только "главную" загрузку страницы (без action -
    // тот же признак, что отличает основной запрос от мелких доп-запросов вроде generate_ai_tasks/
    // manager_lost_customers ниже), иначе один визит на дашборд считался бы много раз подряд.
    if (!action) {
      try { logAccessVisit_(ss, email, access.name, access.role); } catch (logErr) { /* не критично для остального ответа */ }
    }
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
      var gp = getGrossProfitForPeriod(ss, period);
      var periodOrders = getOrdersDataForPeriod(ss, period);
      // Факт/план продаж за этот период - тем же расчётом, что и текущий месяц (Влад,
      // 2026-08-04: верхняя полоса "Выполнение плана продаж" не совпадала с карточками
      // отделов при выборе периода). Пропускаем, если period сам вернул ошибку.
      var sfp = (periodOrders && !periodOrders.error) ? computeSalesFaktPlan_(periodOrders) : null;
      return ContentService
        .createTextOutput(JSON.stringify({
          orders:  periodOrders,
          summary: {
            profit:      gp ? gp.profit : null,
            profit_tral: gp ? gp.profit_tral : null,
            profit_long: gp ? gp.profit_long : null,
            special_trals_profit: gp ? gp.special_trals_profit : null, // приказ №01/07/26, за ВЫБРАННЫЙ период - раньше не передавался, зарплата Рыщанова за прошлые периоды показывала ВП спецтралов текущего месяца
            salesFakt:   sfp ? sfp.salesFakt : null,
            salesPlan:   sfp ? sfp.salesPlan : null,
            salesFaktThruYesterday: sfp ? sfp.salesFaktThruYesterday : null,
          },
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // "Глобальная статистика" (Влад, 2026-08-04) - сводка по месяцам из История_месяцев.
    // ТОЛЬКО чтение готового кэша, без пересчёта текущего месяца на лету (Влад: "не хочу
    // чтобы страница долго грузилась... покажи данные мгновенно" - раньше здесь ещё раз
    // разбирались заказы+парк заново при КАЖДОМ открытии страницы, хотя runAll() уже
    // посчитал то же самое минуты/часы назад). Текущий месяц отстаёт максимум на один
    // прогон runAll() - приемлемая цена за мгновенную загрузку.
    if (action === 'global_stats') {
      if (access.role !== 'admin') {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Доступ запрещён' })).setMimeType(ContentService.MimeType.JSON);
      }
      var msSheet = ss.getSheetByName(MONTH_SUMMARY_SHEET);
      var msMonths = [];
      if (msSheet && msSheet.getLastRow() > 1) {
        var msData = msSheet.getRange(2, 1, msSheet.getLastRow() - 1, MONTH_SUMMARY_HEADERS.length).getValues();
        msMonths = msData.filter(function(r) { return r[0]; }).map(function(r) {
          return {
            month: monthKeyFrom_(r[0]), revenue: r[1] || 0, salesPlan: r[2] || 0,
            profit: r[3] || 0, profitTral: r[4] || 0, profitLong: r[5] || 0,
            fot: r[6] || 0, fuel: r[7] || 0, parts: r[8] || 0, fines: r[9] || 0, tolls: r[10] || 0,
            hiredProfit: r[11] || 0, hiredRevenue: r[12] || 0,
            cash: r[14] || 0, // может отсутствовать в старых строках (колонка добавлена 2026-08-13) - тогда 0
          };
        });
      }
      msMonths.sort(function(a, b) { return a.month.localeCompare(b.month); });
      return ContentService.createTextOutput(JSON.stringify({ months: msMonths })).setMimeType(ContentService.MimeType.JSON);
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

    if (action === 'debt_set_status') {
      if (access.role !== 'admin') {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Доступ запрещён' })).setMimeType(ContentService.MimeType.JSON);
      }
      try {
        setDebtStatus_(ss, e.parameter.contragent, e.parameter.status);
        return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
      } catch (debtStatusErr) {
        return ContentService.createTextOutput(JSON.stringify({ error: debtStatusErr.message })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // Ручной комментарий по контрагенту (Влад, 2026-07-15: "хочу вносить ручные комментарии
    // по контрагенту, текст может быть длинный") - карточка контрагента на вкладке ДЗ.
    if (action === 'debt_set_comment') {
      if (access.role !== 'admin') {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Доступ запрещён' })).setMimeType(ContentService.MimeType.JSON);
      }
      try {
        setDebtComment_(ss, e.parameter.contragent, e.parameter.comment);
        return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
      } catch (debtCommentErr) {
        return ContentService.createTextOutput(JSON.stringify({ error: debtCommentErr.message })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // Лиды/сделки из Битрикс24 (Авито/сайт/звонки) - см. plans/2026-07-12-bitrix24-crm-integration.md
    if (action === 'marketing') {
      if (access.role !== 'admin') {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Доступ запрещён' })).setMimeType(ContentService.MimeType.JSON);
      }
      try {
        return ContentService.createTextOutput(JSON.stringify(getBitrixMarketingData_())).setMimeType(ContentService.MimeType.JSON);
      } catch (marketingErr) {
        return ContentService.createTextOutput(JSON.stringify({ error: marketingErr.message })).setMimeType(ContentService.MimeType.JSON);
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
      var vpFromDate = new Date(vpFromP[0], vpFromP[1] - 1, vpFromP[2]);
      var vpToDate = new Date(vpToP[0], vpToP[1] - 1, vpToP[2]);
      var vpStaffData = getStaffData(ss);
      var vpVehicles = aggregateFinHistoryForRange(ss, vpStaffData, vpFromDate, vpToDate);
      return ContentService.createTextOutput(JSON.stringify({
        vehicles: vpVehicles,
        drivers: deriveDriversFromVehicles(vpVehicles),
        // Кол-во заказов по водителю ЗА ВЫБРАННЫЙ ПЕРИОД (не за текущий месяц) - раньше
        // страница "Водители" всегда брала D.orders.by_driver (текущий месяц), из-за чего
        // при выборе прошлого периода счётчик заказов был неверным/пустым (Влад, 2026-07-07).
        driverOrderCounts: getDriverOrderCounts_(ss, vpFromDate, vpToDate)
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // "Что изменилось" на более широком диапазоне, чем "со вчера" (Влад, 2026-07-19: "хочу не
    // только в разрезе одного дня в сравнении с вчера, но и более широких диапазонах - пусть
    // это будет неделя для начала"). ?days=7 - сколько дней назад искать точку сравнения (см.
    // compareDaysBack в getDebtData). Лёгкий ответ - только сам диф, не весь платёж ДЗ целиком.
    if (action === 'debt_changes_period') {
      if (access.role !== 'admin') {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Доступ запрещён' })).setMimeType(ContentService.MimeType.JSON);
      }
      var dcpDays = parseInt(e.parameter.days, 10);
      if (!dcpDays || dcpDays < 1 || dcpDays > 365) {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Некорректный период' })).setMimeType(ContentService.MimeType.JSON);
      }
      var dcpDebt = getDebtData(ss, dcpDays);
      if (!dcpDebt) {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Нет данных по ДЗ' })).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({
        debt_changes: dcpDebt.debt_changes,
        debt_changes_by_org: dcpDebt.debt_changes_by_org,
        debt_changes_compare_date: dcpDebt.debt_changes_compare_date,
        debt_changes_days_back: dcpDebt.debt_changes_days_back,
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
      var caManager = e.parameter.manager || '';
      // v7 - фильтр по менеджеру в топ-клиентах + сброс кэша (v6 мог закэшировать сломанный
      // ответ в окне между деплоем кода и пересборкой агрегата с колонкой "Менеджер").
      var caCacheKey = 'client_analytics_v7_' + (caFrom || 'all') + '_' + (caTo || 'all') + '_' + (caSegment || 'all') + '_' + (caManager || 'all');
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
        caResult = computeClientAnalyticsFromAggregate_(caHistAgg, caLiveRows, { segment: caSegment, from: caFrom, to: caTo, manager: caManager });
      } else {
        var caRows = getClientAnalyticsRows_(ss);
        if (caFrom) caRows = caRows.filter(function(r) { return r.date >= caFrom; });
        if (caTo)   caRows = caRows.filter(function(r) { return r.date <= caTo; });
        caResult = computeClientAnalytics_(caRows, { segment: caSegment, manager: caManager });
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
      var mpCacheKey = 'manager_profile_v3_' + mpName; // v3 - добавлено поле "Менеджер" в top_clients
      var mpCached = mpCache.get(mpCacheKey);
      if (mpCached) {
        return ContentService.createTextOutput(mpCached).setMimeType(ContentService.MimeType.JSON);
      }
      var mpRows = getClientAnalyticsRows_(ss);
      var mpJson = JSON.stringify(computeManagerProfile_(mpRows, mpName));
      try { if (mpJson.length < 95000) mpCache.put(mpCacheKey, mpJson, 1800); } catch (cacheErr) { /* кэш - не критично */ }
      return ContentService.createTextOutput(mpJson).setMimeType(ContentService.MimeType.JSON);
    }

    // Личная страница - выбор периода для ролей manager/logist (2026-08-11, Влад: "нужно
    // сделать ещё выбор периода: текущий месяц и прошлый месяц"). Аналог action=orders_period,
    // но урезанный под ту же логику, что и обычный вход этих ролей (только свои цифры) -
    // admin для периода на sales-вкладках по-прежнему использует action=orders_period целиком.
    if (action === 'my_page_period') {
      if (access.role !== 'manager' && access.role !== 'logist') {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Доступ запрещён' })).setMimeType(ContentService.MimeType.JSON);
      }
      var mppPeriod = e.parameter.period || '';
      if (!/^\d{4}-\d{2}$/.test(mppPeriod)) {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Некорректный период' })).setMimeType(ContentService.MimeType.JSON);
      }
      var mppResult = access.role === 'manager'
        ? getManagerViewForPeriod_(ss, access.name, mppPeriod)
        : getLogistViewForPeriod_(ss, access.name, mppPeriod);
      return ContentService.createTextOutput(JSON.stringify(mppResult)).setMimeType(ContentService.MimeType.JSON);
    }

    // Личная страница логиста-длинномерщика (2026-08-11, Васин) - доступна admin и любому
    // logist (по направлению "Длинномер" целиком, не по фамилии - тот же принцип, что "Общие
    // сделки" у Прус). period пустой = текущий месяц.
    if (action === 'long_haul_detail') {
      if (access.role !== 'admin' && access.role !== 'logist') {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Доступ запрещён' })).setMimeType(ContentService.MimeType.JSON);
      }
      var lhdPeriod = e.parameter.period || '';
      if (lhdPeriod && !/^\d{4}-\d{2}$/.test(lhdPeriod)) {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Некорректный период' })).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify(getLongHaulDetail_(ss, lhdPeriod))).setMimeType(ContentService.MimeType.JSON);
    }

    // Пропавшие клиенты менеджера за 3 месяца (2026-08-12, вкладка "Пропавшие клиенты" на
    // личной странице) - лениво, по клику на вкладку (не на каждой загрузке страницы, тяжёлая
    // операция - читает 3 архивных листа). admin может запросить любого менеджера параметром,
    // роль manager - только себя (access.name, параметр manager игнорируется).
    if (action === 'manager_lost_customers') {
      if (access.role !== 'admin' && access.role !== 'manager') {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Доступ запрещён' })).setMimeType(ContentService.MimeType.JSON);
      }
      var mlcManager = access.role === 'manager' ? access.name : (e.parameter.manager || '');
      if (!mlcManager) {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Не указан менеджер' })).setMimeType(ContentService.MimeType.JSON);
      }
      var mlcPeriod = e.parameter.period || '';
      if (mlcPeriod && !/^\d{4}-\d{2}$/.test(mlcPeriod)) {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Некорректный период' })).setMimeType(ContentService.MimeType.JSON);
      }
      var mlcMonthKey = mlcPeriod || Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM');
      var mlcCustomers = computeLostCustomersForManager_(ss, mlcMonthKey, mlcManager, !mlcPeriod);
      return ContentService.createTextOutput(JSON.stringify({ customers: mlcCustomers })).setMimeType(ContentService.MimeType.JSON);
    }

    // 5 задач на день от ИИ (2026-08-12, см. plans/2026-08-12-ai-daily-tasks-manager.md) -
    // кэш на календарный день (Europe/Moscow), см. generateManagerAiTasksCached_. Только для
    // ТЕКУЩЕГО месяца - "задачи на сегодня" не имеют смысла для закрытого периода, фронтенд
    // этот action для прошлого периода вообще не вызывает, но проверяем и тут на всякий
    // случай. Роль logist - вне охвата v1 (Влад просил именно для менеджера).
    if (action === 'generate_ai_tasks') {
      if (access.role !== 'admin' && access.role !== 'manager' && access.role !== 'logist') {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Доступ запрещён' })).setMimeType(ContentService.MimeType.JSON);
      }
      // Роль 'manager'/'logist' форсит СВОЁ имя И СВОЮ роль (игнорирует параметры от клиента,
      // тот же паттерн, что my_page_period) - admin-предпросмотр указывает и то, и другое
      // явно (2026-08-13, логист - см. plans/2026-08-13-logist-page-unify-with-manager.md).
      var gatRole = (access.role === 'manager' || access.role === 'logist') ? access.role : (e.parameter.role || 'manager');
      var gatManager = (access.role === 'manager' || access.role === 'logist') ? access.name : (e.parameter.manager || '');
      if (!gatManager) {
        return ContentService.createTextOutput(JSON.stringify({ error: 'Не указан сотрудник' })).setMimeType(ContentService.MimeType.JSON);
      }
      try {
        var gatOrders = getOrdersData(ss);
        if (gatOrders.error) throw new Error(gatOrders.error);
        var gatForce = e.parameter.force === '1';
        var gatResult = gatRole === 'logist'
          ? generateLogistAiTasksCached_(ss, gatOrders, gatManager, null, gatForce)
          : generateManagerAiTasksCached_(ss, gatOrders, gatManager, null, gatForce);
        return ContentService.createTextOutput(JSON.stringify(gatResult)).setMimeType(ContentService.MimeType.JSON);
      } catch (gatErr) {
        return ContentService.createTextOutput(JSON.stringify({ error: gatErr.message })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // Менеджер - только его собственные данные, без доступа к остальному
    if (access.role === 'manager') {
      return ContentService
        .createTextOutput(JSON.stringify(getManagerView_(ss, access.name)))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Логист (2026-08-10) - та же логика, что и manager выше, но своя урезанная выдача
    if (access.role === 'logist') {
      return ContentService
        .createTextOutput(JSON.stringify(getLogistView_(ss, access.name)))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const staffData = getStaffData(ss); // читаем Штатку один раз - ЖИВОЙ документ, всегда live
    // Карта госномер → марка из Штатки (для всех 55 машин, не только с выручкой)
    var staffMarkas = {};
    Object.values(staffData).forEach(function(v) { staffMarkas[v.gosOriginal] = v.marka; });

    const data = Object.assign(
      {
        updated: new Date().toISOString(),
        role:    'admin',
        // Живые поля - НЕ кэшируются в runAll() (см. buildHeavyMainPayload_). Штатка -
        // "живой документ" (CLAUDE.md), её правят руками вне расписания runAll() - если
        // закэшировать статус машины/ремонты на 3 часа, правки будут "зависать", это
        // регресс, а не ускорение. Штатка маленькая (~55 строк), расчёт и так мгновенный.
        fleet:       getFleetStatus(staffData),
        repairs:     getRepairsData(staffData),
        staffMarkas: staffMarkas,
        // Активность сотрудников (2026-08-13) - дешёвый листовой запрос (десяток строк).
        access_log:  getAccessLogSummary_(ss),
      },
      getMainPayloadCacheOrLive_(ss, staffData)
    );
    return ContentService
      .createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(e) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================================
// ГЛАВНЫЙ PAYLOAD ДАШБОРДА (doGet без action, admin) - precompute (2026-08-13)
// Раньше эти поля пересчитывались заново на КАЖДЫЙ визит (парсинг Заказы_данные + архив
// прошлого месяца + История_финансов + ДЗ + Поступления и т.д.) - именно это делало загрузку
// долгой. runAll() и так обновляет эти источники по расписанию (6 раз в день) - пересчитывать
// чаще смысла нет. buildHeavyMainPayload_ - чистая функция (та же, что считалась раньше
// внутри doGet()), кэш вокруг неё - отдельно. ВОССТАНОВЛЕНО 2026-08-13 (обнаружено расхождение
// с живым редактором при координации перед clasp push - см. правило синхронизации в CLAUDE.md;
// перенесено сюда с полным набором полей текущей ветки, включая "Юрлицо" в byCustomer и
// историческую наличку в receiptsMonthRevenueMap_, которых не было в живой версии на момент
// обнаружения).
// ============================================================
var MAIN_PAYLOAD_CACHE_SHEET = 'Кэш_главной_страницы';
var MAIN_PAYLOAD_CACHE_VERSION = 'v1'; // поднимать при изменении состава полей ниже
var MAIN_PAYLOAD_CACHE_CHUNK_SIZE = 45000; // с запасом от лимита ячейки Sheets (~50000)

// "Дорогие" поля главной страницы - НЕ включает Штатку-производные (fleet/repairs/
// staffMarkas/access_log) - те живые, считаются в doGet() напрямую, см. комментарий там.
function buildHeavyMainPayload_(ss, staffData) {
  var defaultRange = getCurrentMonthRange_();
  var vehiclesData = aggregateFinHistoryForRange(ss, staffData, defaultRange.from, defaultRange.to);
  var ordersData = getOrdersData(ss);
  return {
    summary:  getSummaryData(ss, ordersData),
    vehicles: vehiclesData,
    drivers:  deriveDriversFromVehicles(vehiclesData),
    history:  getHistoryData(ss),
    orders:   ordersData,
    debt:     getDebtData(ss),
    receipts: getReceiptsData(ss, ordersData),
    // Колонка "Заказов" на "Водителях" в ДЕФОЛТНОМ виде (без выбора периода) раньше падала
    // на orders.by_driver, который обрезан до топ-25 ПО ВСЕЙ КОМПАНИИ (см. по_driver ниже
    // в getOrdersData) - водитель с высокой выручкой, но малым числом дорогих рейсов, в
    // топ-25 по КОЛИЧЕСТВУ не попадал и показывал "—", хотя факт был ненулевой (Влад,
    // 2026-07-16: "по некоторым машинам по количеству заказов показывает —"). Тут - тот же
    // ПОЛНЫЙ (без обрезки) счётчик, что уже считается для action=vehicles_period.
    driverOrderCounts: getDriverOrderCounts_(ss, defaultRange.from, defaultRange.to),
    // Влад, 2026-08-10: "выпадающий список периода сначала пустой, месяцы появляются с
    // задержкой" - раньше фронт после загрузки страницы делал ВТОРОЙ отдельный запрос
    // (action=available_periods) только при первом заходе на вкладку с выбором периода, а
    // каждый запрос к doGet() платит свою цену (открытие таблицы + проверка токена через
    // Google). getAvailablePeriods(ss) сам по себе дешёвый (просто список листов, без чтения
    // ячеек) - отдаём его сразу с основным ответом, второй round-trip больше не нужен.
    periods: getAvailablePeriods(ss),
  };
}

function ensureMainPayloadCacheSheet_(ss) {
  var sheet = ss.getSheetByName(MAIN_PAYLOAD_CACHE_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(MAIN_PAYLOAD_CACHE_SHEET);
    sheet.hideSheet();
  }
  return sheet;
}

// Считает buildHeavyMainPayload_ и кладёт результат одной строкой (версия | updated |
// JSON-чанки...) - перезаписывается целиком за один setValues(), чтобы doGet() не мог
// прочитать кэш "наполовину записанным" при совпадении по времени с runAll().
function saveMainPayloadCache_(ss) {
  var staffData = getStaffData(ss);
  var payload = buildHeavyMainPayload_(ss, staffData);
  var json = JSON.stringify(payload);
  var chunks = [];
  for (var i = 0; i < json.length; i += MAIN_PAYLOAD_CACHE_CHUNK_SIZE) {
    chunks.push(json.slice(i, i + MAIN_PAYLOAD_CACHE_CHUNK_SIZE));
  }
  var sheet = ensureMainPayloadCacheSheet_(ss);
  var row = [MAIN_PAYLOAD_CACHE_VERSION, new Date().toISOString()].concat(chunks);
  // getMaxColumns может быть меньше нужного при первом запуске/после уменьшения payload -
  // расширяем лист перед записью, иначе setValues на диапазон шире листа упадёт с ошибкой.
  if (sheet.getMaxColumns() < row.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), row.length - sheet.getMaxColumns());
  }
  // Чистим старую строку целиком - если новый payload короче старого (меньше чанков),
  // хвостовые ячейки от прошлой версии не должны остаться и склеиться в JSON при чтении.
  sheet.getRange(1, 1, 1, sheet.getMaxColumns()).clearContent();
  sheet.getRange(1, 1, 1, row.length).setValues([row]);
}

// Читает кэш; null если кэша нет, версия не совпадает, или JSON.parse не удался (битые
// данные не должны ронять всю страницу - doGet() в этом случае посчитает вживую).
function readMainPayloadCache_(ss) {
  var sheet = ss.getSheetByName(MAIN_PAYLOAD_CACHE_SHEET);
  if (!sheet || sheet.getLastRow() < 1) return null;
  var row = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (row[0] !== MAIN_PAYLOAD_CACHE_VERSION) return null;
  var json = row.slice(2).join('');
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch (parseErr) {
    return null;
  }
}

// doGet() зовёт это, а не buildHeavyMainPayload_ напрямую - кэш в приоритете, живой расчёт
// только как страховка (первый запуск после деплоя, до первого runAll(); или кэш битый).
function getMainPayloadCacheOrLive_(ss, staffData) {
  var cached = readMainPayloadCache_(ss);
  if (cached) return cached;
  return buildHeavyMainPayload_(ss, staffData);
}

// Нормализация госномера: убираем пробелы + кириллица→латиница (А=A, В=B и т.д.)
function normalizeGos(gos) {
  return String(gos || '').replace(/\s/g, '').toUpperCase()
    .replace(/А/g,'A').replace(/В/g,'B').replace(/Е/g,'E')
    .replace(/К/g,'K').replace(/М/g,'M').replace(/Н/g,'H')
    .replace(/О/g,'O').replace(/Р/g,'P').replace(/С/g,'C')
    .replace(/Т/g,'T').replace(/У/g,'Y').replace(/Х/g,'X');
}

// Машины, полностью исключённые из ВСЕХ расчётов дашборда (2026-08-11, Влад: "убери из всех
// расчётов, её нет, она в аресте" - госномер "А 840 КО 797", SCANIA). Единая точка исключения -
// getStaffData ниже (состав парка - источник для статуса парка/"Техники"/"Водителей"/личной
// страницы Васина) + aggregateFinHistoryForRange (двойная защита - вдруг в истории остались
// строки без записи в Штатке, например если её ещё не убрали из листа физически).
const EXCLUDED_VEHICLE_GOS = ['A840KO797'];
function isExcludedVehicleGos_(gos) {
  return EXCLUDED_VEHICLE_GOS.indexOf(normalizeGos(gos)) >= 0;
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
    if (isExcludedVehicleGos_(gos)) continue;

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
// Автозапуск по триггеру (setupShtatkaAutoMigration, 12:00 и 19:00) вызывает эту же функцию,
// но триггеры Apps Script передают служебный объект события первым аргументом - "year ||
// новый год" не срабатывал (объект истинный), и в дату попадало "[object Object]" вместо
// числа года (Влад, 2026-07-17: увидел мусор в Штатка_история). Годится только настоящее
// число года - что угодно другое (объект, undefined, строка) откатывается на текущий год.
function migrateShtatkaGridToHistory(year) {
  year = (typeof year === 'number' && year > 2000) ? year : new Date().getFullYear();
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
    Object.keys(parkHistByMonth[mk]).forEach(function(g) { if (!isExcludedVehicleGos_(g)) allGos[g] = true; });
  });
  Object.keys(fallbackByVehicleMonth).forEach(function(g) { if (!isExcludedVehicleGos_(g)) allGos[g] = true; });
  // Штатка - источник истины по составу парка (Влад, 2026-07-19: "не все тралы показывает
  // как ремонтные, которые в штатке отмечены как ремонт" - машина, у которой за весь период
  // не было ни одной строки в 1С-истории (простояла в ремонте, ни одного заказа), раньше
  // выпадала из allGos и пропадала из таблицы целиком, хотя "Статус парка" на Панели
  // (getFleetStatus) считает её верно - читает staffData напрямую, а не через историю).
  // Госномер в истории не всегда хранится в normalizeGos()-формате (пробелы/кириллица) -
  // сверяем по нормализованному виду, иначе одна и та же машина могла бы попасть в allGos
  // дважды: раз под "сырым" ключом из истории, раз под нормализованным ключом из Штатки.
  if (staffData) {
    var coveredNormalized_ = {};
    Object.keys(allGos).forEach(function(g) { coveredNormalized_[normalizeGos(g)] = true; });
    Object.keys(staffData).forEach(function(g) { // g уже нормализован, см. getStaffData
      if (!coveredNormalized_[g]) allGos[g] = true;
    });
  }

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
    var foundHistoryRow = false;
    monthKeys.forEach(function(mk) {
      var r = null;
      if (parkHistByMonth[mk] && parkHistByMonth[mk][gos]) {
        r = parkHistByMonth[mk][gos];
      } else if (fallbackByVehicleMonth[gos] && fallbackByVehicleMonth[gos][mk]) {
        r = fallbackByVehicleMonth[gos][mk].row;
      }
      if (!r) return;
      foundHistoryRow = true;
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
      // Ни одной строки в 1С-истории за период - берём тип/статус/госномер напрямую из
      // Штатки, иначе машина попадёт в таблицу пустой строкой (или вообще не попадёт бы,
      // см. allGos выше).
      if (!foundHistoryRow) {
        if (!agg.type) agg.type = staffInfo.type;
        if (!agg.status) agg.status = staffInfo.status;
        agg.gos = staffInfo.gosOriginal || agg.gos;
      }
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
        pct: v.plan > 0 ? v.profit / v.plan : 0, driver: v.driver, status: v.status || '' };
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

// 'YYYY-MM' -> диапазон с 1-го по последнее число месяца (2026-08-11, личная страница
// Васина - "прошлый месяц" на aggregateFinHistoryForRange нужен целиком, не по сегодня).
function monthKeyToRange_(period) {
  var p = period.split('-').map(Number);
  return { from: new Date(p[0], p[1] - 1, 1), to: new Date(p[0], p[1], 0) };
}

// Факт/план продаж (по менеджерам + внутренние, без задвоения) - вынесено в отдельную
// функцию, чтобы ОДИН И ТОТ ЖЕ расчёт использовался и для текущего месяца (getSummaryData),
// и для архивного периода (action=orders_period). Раньше верхняя полоса "Выполнение плана
// продаж" на "По менеджерам" всегда читала D.summary.salesFakt/salesPlan текущего месяца,
// даже когда в выпадающем списке выбран прошлый период - карточки отделов ниже (которые
// берут план/факт из D.orders, а он подменяется на период) показывали июль, а полоса сверху -
// живой август (Влад, 2026-08-04: "почему-то показывает факт августа").
function computeSalesFaktPlan_(ordersData) {
  const byManager = (ordersData && ordersData.by_manager) || [];
  let totalPlan=0, totalFakt=0, totalFaktThruYesterday=0, totalPayment=0, totalPayNal=0;
  let mgrInternal=0, mgrInternalThruYesterday=0;
  byManager.forEach(function(m) {
    totalFakt    += m.amount || 0;
    // Числитель прогноза - только "по вчера" (Влад, 2026-07-08), см. isThruYesterday в
    // aggregateOrdersRows. salesFakt (живой факт) не трогаем - используется для отображения.
    totalFaktThruYesterday += m.amount_thru_yesterday || 0;
    totalPayment += m.payment || 0;
    totalPayNal  += m.cash || 0;
    mgrInternal  += m.internal_amount || 0;
    mgrInternalThruYesterday += m.internal_amount_thru_yesterday || 0;
  });
  // Внутренние перевозки ведут ЛОГИСТЫ (Влад, 2026-07-19), а их нет в TRAL_MANAGERS - значит
  // их заказы не попадают в by_manager и не входили в общий факт, ХОТЯ план "Внутренние"
  // (5 млн) в salesPlan прибавляется. Факт и план были в разном масштабе: Влад увидел
  // "29 912 408 из 70 000 000" вместо ожидаемых ~32.1М (14.7 Ахтамова + 15.2 Гусейнова +
  // 2.2 внутренние). Прибавляем только ТУ ЧАСТЬ внутренних, которой ещё нет в суммах
  // менеджеров - часть внутренних заказов может вестись самими менеджерами (они в TRAL_MANAGERS,
  // и тогда их внутренние уже сидят в m.amount, см. фикс 2026-07-04), такие второй раз не берём.
  const ordSummary = (ordersData && ordersData.summary) || {};
  totalFakt += Math.max(0, (ordSummary.internal_amount || 0) - mgrInternal);
  totalFaktThruYesterday += Math.max(0, (ordSummary.internal_amount_thru_yesterday || 0) - mgrInternalThruYesterday);
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
    salesPlan: totalPlan,
    salesFakt: totalFakt,
    salesFaktThruYesterday: totalFaktThruYesterday,
    salesPayment: totalPayment,
    salesPayNal: totalPayNal,
  };
}

// ordersData - уже посчитанный getOrdersData(ss) (с проставленными планами через
// joinManagerPlans_) - передаётся, чтобы не считать заказы дважды за один запрос.
// Продажи менеджеров (salesFakt/salesPlan/salesPayment) теперь считаются из таблицы
// заказов (by_manager) - один источник вместо отдельного листа Менеджеры_данные
// (см. plans/2026-07-02-manager-revenue-single-source.md - раньше давало рассинхрон
// после смены месяца).
// Приказ № 01/07/26 от 01.07.2026 "Об утверждении мотивации руководителя отдела логистики
// Тралы и длинномеры" (Гонтюрев А.А.): Рыщанову +1% от ВП, наработанной ЭТИМИ ТРЕМЯ
// конкретными тягачами (не всем парком). Действует с 01.07.2026. На бумаге приказа
// рукописная пометка "До 1.11.26" - дата истечения/пересмотра, см. RISCHANOV_ORDER_UNTIL
// ниже. Госномера нормализованы через normalizeGos(), сверены с живой Штаткой 2026-08-06.
const RISCHANOV_SPECIAL_TRALS_GOS = [
  normalizeGos('В776ЕТ797'), // Скания В 776 ЕТ 797 + файмон корыто 4 оси УУ 4720 77
  normalizeGos('М800АЕ797'), // Скания М 800 АЕ 797 + файмон корыто 4 оси УХ 5545 77
  normalizeGos('О894ХМ797'), // Скания О 894 ХМ 797 + файмон 8-осный ХУ 5875 77
];
const RISCHANOV_ORDER_UNTIL = new Date('2026-11-01T00:00:00+03:00'); // рукописная пометка на приказе - сверить с Владом ближе к сроку, не начислять без нового приказа

function getSummaryData(ss, ordersData) {
  const norm = ss.getSheetByName('Нормализованные_данные');
  if (!norm || norm.getLastRow() < 2) return {};

  // 13 колонок (не 10) - нужна колонка M (индекс 12, "Тип из Штатки") для разбивки по
  // сегментам, см. комментарий ниже.
  const data = norm.getRange(2, 1, norm.getLastRow() - 1, 13).getValues();
  let revenue=0, profit=0, fot=0, fuel=0, parts=0, fines=0, tolls=0, lossCount=0;
  // ВП своего парка по сегментам (Влад, 2026-07-17: "по длинномерам показывает ноль, всё
  // уходит на трал - проверь логику"). Баг: изначально делил по колонке C ("Тип техники" -
  // detectType(fullName), угадывает тип по строке названия машины из 1С) - ненадёжный
  // источник, детектит только явные "ПР-4"/"ТКР-4"/... коды в названии, "Борт"/"Длинномер"
  // там почти никогда не встречается, поэтому всегда попадал в "иначе = Трал".
  // Исправлено на колонку M (индекс 12, "Тип из Штатки" - staffInfo.type при построении
  // листа) - ТОТ ЖЕ авторитетный источник и то же правило ("Борт" = длинномер), что уже
  // использует "Статус парка" (getFleetStatus) и фильтр "Все тралы" - разбивка теперь
  // согласована по всему дашборду, а не третий отдельный классификатор.
  let profitTral=0, profitLong=0, revenueTral=0, revenueLong=0;
  let specialTralsProfit=0; // приказ №01/07/26 - ВП трёх конкретных тягачей Рыщанова

  for (let row of data) {
    const rev = parseFloat(row[3]) || 0;
    revenue += rev;
    fot     += parseFloat(row[4]) || 0;
    fuel    += parseFloat(row[5]) || 0;
    parts   += parseFloat(row[6]) || 0;
    fines   += parseFloat(row[7]) || 0;
    tolls   += parseFloat(row[8]) || 0;
    const p  = parseFloat(row[9]) || 0;
    profit  += p;
    if (p < 0) lossCount++;
    const staffType = String(row[12] || '');
    const isDlinnomer = staffType === 'Борт' || staffType.indexOf('Борт') === 0;
    if (isDlinnomer) { profitLong += p; revenueLong += rev; }
    else              { profitTral += p; revenueTral += rev; }
    if (RISCHANOV_SPECIAL_TRALS_GOS.indexOf(normalizeGos(row[0])) >= 0) specialTralsProfit += p;
  }

  const sfp = computeSalesFaktPlan_(ordersData);
  const rischanovOrderActive = new Date() < RISCHANOV_ORDER_UNTIL;

  return {
    revenue, profit, fot, fuel, parts, fines, tolls,
    margin: revenue > 0 ? (profit/revenue*100) : 0,
    profit_tral: profitTral, profit_long: profitLong,
    own_revenue_tral: revenueTral, own_revenue_long: revenueLong,
    special_trals_profit: rischanovOrderActive ? specialTralsProfit : 0, // приказ №01/07/26, до 01.11.2026
    special_trals_bonus_active: rischanovOrderActive,
    lossCount, vehicleCount: data.length,
    salesPlan: sfp.salesPlan,
    salesFakt: sfp.salesFakt,
    salesFaktThruYesterday: sfp.salesFaktThruYesterday,
    salesPayment: sfp.salesPayment,
    salesPayNal: sfp.salesPayNal,
    salesPct: sfp.salesPlan > 0 ? (sfp.salesFakt/sfp.salesPlan*100) : 0,
    profitPlan: 50400000, // план ВП из Штатки
    revenueComparison: getRevenueDateComparison_(ss), // "на ту же дату" - прошлый месяц/год (Влад, 2026-07-08)
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
      rows = live.getRange(2, 1, live.getLastRow() - 1, 44).getValues();
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

// Кол-во заказов по водителю за произвольный диапазон дат - для страницы "Водители" при
// выборе периода (иначе колонка "Заказов" всегда показывала текущий месяц, независимо от
// выбранного - Влад, 2026-07-07: "количество заказов за июнь не верное"). Та же логика
// источника, что и getVehicleOrdersHistory_ - текущий месяц из "Заказы_данные", прошлые -
// из архивов "Заказы_YYYY-MM". Ключ - фамилия (первое слово ФИО, нижний регистр), как и на
// фронтенде (d.driver.trim().split(' ')[0].toLowerCase()).
function getDriverOrderCounts_(ss, fromDate, toDate) {
  var from = new Date(fromDate); from.setHours(0, 0, 0, 0);
  var to = new Date(toDate); to.setHours(23, 59, 59, 999);

  var monthKeys = [];
  var cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cursor <= to) {
    monthKeys.push(cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0'));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  var currentMonthKey = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM');
  var counts = {};

  monthKeys.forEach(function(mk) {
    var rows;
    if (mk === currentMonthKey) {
      var live = ss.getSheetByName(ORDERS_NORM_SHEET);
      if (!live || live.getLastRow() < 2) return;
      rows = live.getRange(2, 1, live.getLastRow() - 1, 44).getValues();
    } else {
      var archive = ss.getSheetByName(ORDERS_ARCHIVE_PFX + mk);
      if (!archive || archive.getLastRow() < 5) return;
      rows = parseOrdersRawRows(archive.getDataRange().getValues()).rows;
    }
    rows.forEach(function(row) {
      var driver = String(row[19] || '').trim();
      if (!driver) return;
      var rawDate = row[2]; // "Начало работ"
      var dateStr = rawDate instanceof Date
        ? Utilities.formatDate(rawDate, 'Europe/Moscow', 'yyyy-MM-dd')
        : String(rawDate || '').trim();
      if (!dateStr) return;
      var d = new Date(dateStr + 'T00:00:00');
      if (isNaN(d.getTime()) || d < from || d > to) return;
      // Фамилия + имя, не только фамилия (Влад, 2026-07-10, на примере "Шленсков Сергей" и
      // "Шленсков Максим" - два разных человека с одной фамилией схлопывались в один
      // счётчик, у "Сергея" реально 2 заказа за месяц на его машине, дашборд показывал 11 -
      // это была сумма обоих Шленсковых). См. тот же приём на фронтенде, files/index.html.
      var key = driver.split(' ').slice(0, 2).join(' ').toLowerCase();
      counts[key] = (counts[key] || 0) + 1;
    });
  });

  return counts;
}

// Валовая прибыль своего парка за прошлый период (для зарплаты Рыщанова и карточки "Заказов"
// при выборе периода), с разбивкой по сегментам трал/длинномер (Влад, 2026-07-18: карточка
// "Длинномеры" на "Заказов" не обновлялась при смене периода на июнь - профит оставался от
// текущего месяца, потому что раньше функция считала только один общий итог без разбивки).
// Источник и логика - те же, что у "Парк техники" за произвольный диапазон
// (aggregateFinHistoryForRange: авторитетный архив Данные_1С_история для закрытых месяцев,
// иначе подневный фолбэк на История_финансов) - чтобы цифры сходились между "Заказов" и
// "Парк техники" за один и тот же период, а не расходились как две разные методики.
function getGrossProfitForPeriod(ss, period) {
  var parts = period.split('-').map(Number);
  if (parts.length !== 2) return null;
  var monthStart = new Date(parts[0], parts[1] - 1, 1);
  var monthEnd = new Date(parts[0], parts[1], 0); // последний день месяца
  var staffData = getStaffData(ss);
  var vehicles = aggregateFinHistoryForRange(ss, staffData, monthStart, monthEnd);
  if (!vehicles.length) return null;

  // Затраты по категориям добавлены для "Глобальной статистики" (Влад, 2026-08-04: "маржу по
  // найму, выручку, затраты") - те же поля, что уже есть в каждой vehicles-строке
  // (aggregateFinHistoryForRange), раньше просто не суммировались здесь, только ВП.
  var profit = 0, profitTral = 0, profitLong = 0, revenue = 0, fot = 0, fuel = 0, parts2 = 0, fines = 0, tolls = 0;
  var specialTralsProfit = 0; // приказ №01/07/26 - ВП трёх конкретных тягачей Рыщанова, см. RISCHANOV_SPECIAL_TRALS_GOS
  vehicles.forEach(function(v) {
    var isDlinnomer = v.type === 'Борт' || v.type.indexOf('Борт') === 0;
    profit += v.profit;
    revenue += v.revenue || 0;
    fot += v.fot || 0;
    fuel += v.fuel || 0;
    parts2 += v.parts || 0;
    fines += v.fines || 0;
    tolls += v.tolls || 0;
    if (isDlinnomer) profitLong += v.profit; else profitTral += v.profit;
    if (RISCHANOV_SPECIAL_TRALS_GOS.indexOf(normalizeGos(v.gos)) >= 0) specialTralsProfit += v.profit;
  });
  return {
    profit: profit, profit_tral: profitTral, profit_long: profitLong,
    revenue: revenue, fot: fot, fuel: fuel, parts: parts2, fines: fines, tolls: tolls,
    special_trals_profit: specialTralsProfit,
  };
}

// ============================================================
// ГЛОБАЛЬНАЯ СТАТИСТИКА — сводка по месяцам (см. plans/2026-08-04-global-stats-page.md)
// Влад, 2026-08-04: "хочу видеть эти данные по каждому выбранному месяцу и в динамике по
// году" - лист "История_месяцев" копит одну строку на месяц, чтобы график по году не
// пересчитывал архивы заказов + Данные_1С_история заново при каждом открытии страницы.
// ============================================================
const MONTH_SUMMARY_SHEET = 'История_месяцев';
const MONTH_SUMMARY_HEADERS = [
  'Месяц', 'Выручка', 'План продаж', 'ВП', 'ВП тралы', 'ВП длинномеры',
  'ФОТ', 'Топливо', 'Запчасти', 'Штрафы', 'Проходные',
  'Прибыль найма', 'Выручка найма', 'Обновлено',
  'Наличные', // добавлено 2026-08-13 (вкладка "Поступления") - СТРОГО в конец, не между
              // существующими колонками, чтобы не сдвинуть индексы у старых строк (тот же
              // приём, что и с "Сумма нашего долга" в ДЗ_данные).
  'Выручка коммерческая', // добавлено 2026-08-13 (то же самое, тем же вечером) - выручка БЕЗ
              // внутригрупповых перевозок, только для сравнения с "Поступлениями".
];

// Считает сводку за месяц - НЕ пишет в лист, чистая функция. Работает и для текущего
// (ещё не завершённого) месяца, и для архивного - getGrossProfitForPeriod уже сам решает,
// брать ли Данные_1С_история или посуточные снимки Истории_финансов.
function computeMonthSummary_(ss, monthKey) {
  // Заказы - ДВА разных источника в зависимости от месяца (Влад, 2026-08-04:
  // backfillMonthSummaries() пропустил август с "нет данных"). getOrdersDataForPeriod читает
  // ТОЛЬКО архивный лист "Заказы_YYYY-MM" - для текущего, ещё не заархивированного месяца
  // такого листа не существует, функция всегда возвращала error. getGrossProfitForPeriod
  // ниже такой проблемы не имеет - aggregateFinHistoryForRange сам умеет и в живые, и в
  // архивные данные, поэтому раньше это осталось незамеченным.
  var currentMonthKey = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM');
  var ordersData = (monthKey === currentMonthKey) ? getOrdersData(ss) : getOrdersDataForPeriod(ss, monthKey);
  if (!ordersData || ordersData.error) return null;
  var sfp = computeSalesFaktPlan_(ordersData);
  var gp = getGrossProfitForPeriod(ss, monthKey) || {};
  var os = ordersData.summary || {};
  var hiredProfit = os.hired_profit || 0;
  var hiredCost = os.total_hired_cost || 0;

  return {
    month: monthKey,
    revenue: sfp.salesFakt,
    salesPlan: sfp.salesPlan,
    profit: gp.profit || 0,
    profitTral: gp.profit_tral || 0,
    profitLong: gp.profit_long || 0,
    fot: gp.fot || 0,
    fuel: gp.fuel || 0,
    parts: gp.parts || 0,
    fines: gp.fines || 0,
    tolls: gp.tolls || 0,
    hiredProfit: hiredProfit,
    hiredRevenue: hiredCost + hiredProfit,
    cash: os.total_cash || 0, // наличные поступления за месяц (см. "Поступления")
    commercial: os.total_commercial || 0, // выручка без внутригрупповых (см. "Поступления")
  };
}

// "2026-07" в колонке А может молча превратиться в объект Date при записи/чтении - тот же
// баг, что уже ловили в Планах_менеджеров/Штатка_история (см. project_apps_script_date_
// instanceof_gotcha). Утиная типизация вместо instanceof - надёжнее (см. ordFormatDate ниже).
// Обязательно применять и на запись (сверка дублей), и на чтение (action=global_stats) -
// иначе один починенный конец наступает на тот же баг с другого.
function monthKeyFrom_(val) {
  if (!val) return '';
  var looksLikeDate = val instanceof Date ||
    (typeof val === 'object' && typeof val.getFullYear === 'function' && typeof val.getMonth === 'function');
  if (looksLikeDate) return Utilities.formatDate(val, 'Europe/Moscow', 'yyyy-MM');
  // .replace(/^'/, '') - ведущий апостроф-принудитель текста (см. saveMonthSummary_) может как
  // отсекаться самими Таблицами при записи через API, так и остаться буквальным символом -
  // поведение не проверено на 100%, поэтому разбираем оба варианта, а не полагаемся на один.
  var s = String(val).trim().replace(/^'/, '');
  var m = s.match(/^(\d{4})-(\d{2})/);
  return m ? (m[1] + '-' + m[2]) : s;
}

function ensureMonthSummarySheet_(ss) {
  var sheet = ss.getSheetByName(MONTH_SUMMARY_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(MONTH_SUMMARY_SHEET);
    sheet.getRange(1, 1, 1, MONTH_SUMMARY_HEADERS.length).setValues([MONTH_SUMMARY_HEADERS]).setFontWeight('bold');
  } else if (sheet.getLastColumn() < MONTH_SUMMARY_HEADERS.length) {
    // Догоняем заголовок колонки "Наличные" (2026-08-13) для листа, созданного ДО этого
    // изменения - тот же приём, что и с колонкой "Водитель" в saveFinancialHistory().
    sheet.getRange(1, MONTH_SUMMARY_HEADERS.length).setValue(MONTH_SUMMARY_HEADERS[MONTH_SUMMARY_HEADERS.length - 1]).setFontWeight('bold');
  }
  // Колонка "Месяц" - текстовый формат, чтобы Таблицы не конвертировали "2026-07" в дату
  // молча при следующей записи (сама конвертация УЖЕ произошла для старых строк - это не
  // чинит их задним числом, для этого см. cleanupMonthSummaries()).
  sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('@');
  return sheet;
}

// Идемпотентно - находит существующую строку месяца и перезаписывает, иначе добавляет новую
// (тот же приём, что setDebtStatus_/findOrCreateDebtStatusRow_ - без дублей при повторных
// запусках). Вызывается на каждом runAll() для ТЕКУЩЕГО месяца (держит его свежим внутри дня)
// и вручную через backfillMonthSummaries() для уже прошедших месяцев.
function saveMonthSummary_(ss, monthKey) {
  var summary = computeMonthSummary_(ss, monthKey);
  if (!summary) return false; // нет данных за месяц - не пишем пустую/нулевую строку поверх

  var sheet = ensureMonthSummarySheet_(ss);
  var lastRow = sheet.getLastRow();
  var rowIndex = -1;
  if (lastRow > 1) {
    var monthCol = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < monthCol.length; i++) {
      // monthKeyFrom_, не String() напрямую - иначе если ячейка уже стала датой, сравнение
      // никогда не совпадёт и строка задвоится при каждом runAll() (ровно так и вышло с
      // августом, Влад, 2026-08-04: "запись сразу два раза").
      if (monthKeyFrom_(monthCol[i][0]) === monthKey) { rowIndex = i + 2; break; }
    }
  }
  var row = [
    "'" + summary.month, summary.revenue, summary.salesPlan, summary.profit, summary.profitTral, summary.profitLong,
    summary.fot, summary.fuel, summary.parts, summary.fines, summary.tolls,
    summary.hiredProfit, summary.hiredRevenue, new Date(), summary.cash, summary.commercial,
  ];
  if (rowIndex > 0) sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  else sheet.appendRow(row);
  return true;
}

// Досчитывает "История_месяцев" по ВСЕМ месяцам, у которых есть архив "Заказы_YYYY-MM"
// (getAvailablePeriods), плюс текущий месяц. ВОССОЗДАНА 2026-08-13 (была удалена как
// одноразовая после первого запуска 2026-08-04, см. правило "удалять одноразовый код" в
// CLAUDE.md) - понадобилась снова: 1) досчитать новую колонку "Наличные" в уже существующих
// строках (полная перезапись строки, не только добавление колонки - saveMonthSummary_ и так
// перезаписывает всю строку целиком, если месяц уже есть); 2) подхватить более старые месяцы,
// если Влад добавит архив ЗА ПРОШЛЫЕ (например "Заказы_2026-05"), которого раньше не было.
// Месяцы без архива/без данных просто пропускаются (лог ниже), не падение.
function backfillMonthSummaries() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var periods = getAvailablePeriods(ss);
  var currentMonthKey = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM');
  var all = periods.slice();
  if (all.indexOf(currentMonthKey) < 0) all.push(currentMonthKey);
  var done = [], skipped = [];
  all.sort().forEach(function(mk) {
    try {
      if (saveMonthSummary_(ss, mk)) done.push(mk); else skipped.push(mk);
    } catch (bErr) {
      skipped.push(mk + ' (' + bErr.message + ')');
    }
  });
  Logger.log('✅ Сводки по месяцам обновлены: ' + (done.join(', ') || '(ничего)'));
  if (skipped.length) Logger.log('⚠️ Пропущены (нет данных/архива): ' + skipped.join(', '));
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

// Логисты отдела (Прус-Роскошный — двойная роль). РЕГРЕССИЯ (2026-08-07): Суркова снова
// пропала из списка - тот же баг уже чинили 2026-07-07 (см. память project-salary-rules,
// "Суркова отсутствовала в TRAL_LOGISTS" - её заказы с mgr_l="Суркова" никогда не попадали в
// logistMap, вся её маржа найма молча исчезала из qualMarginAllLogists/её собственной
// зарплаты). Похоже, откатилось при одном из прямых clasp push мимо git - см. координацию
// между сессиями в CLAUDE.md. Возвращена.
const TRAL_LOGISTS = [
  'Васин', 'Кан', 'Махура', 'Сильчев', 'Суркова',
  'Прус-Роскошный', 'Рыщанов', 'Ахтамова', 'Гусейнова'
];

// ПОСТОЯННЫЙ ИНСТРУМЕНТ (не одноразовый, не удалять) - регрессионный смоук-тест. Проверяет
// конкретные факты, которые уже ДВАЖДЫ откатывались в этом файле (порог 23% - по компании, не
// по заказу; Суркова в TRAL_LOGISTS) - оба раза стоило реальных денег (недоплата Сурковой,
// заниженная база 2% Рыщанова), оба раза обнаружено не сразу, а когда Влад заметил странные
// цифры. Похоже на риск параллельных clasp push мимо git (см. project_clasp_setup, инцидент
// 2026-07-07 и его повтор 2026-08-07). Запускать вручную, когда цифры зарплаты выглядят
// подозрительно, или просто периодически - секунды на проверку против часов на разбор задним
// числом. Список проверок можно пополнять по мере находок новых регрессий.
function verifyKnownFixes() {
  var problems = [];

  if (TRAL_LOGISTS.indexOf('Суркова') < 0) {
    problems.push('TRAL_LOGISTS не содержит "Суркова" - её маржа найма молча исчезает из зарплаты (регрессия, было 2026-07-07 и 2026-08-07)');
  }

  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var testData = getOrdersData(ss);
  if (testData && testData.summary && typeof testData.summary.hired_margin_qualifies !== 'boolean') {
    problems.push('summary.hired_margin_qualifies отсутствует/не boolean - похоже, проверка порога 23% "по компании целиком" пропала из aggregateOrdersRows (регрессия, было 2026-07-07 и 2026-08-06)');
  }

  if (problems.length === 0) {
    Logger.log('✅ Все известные фиксы на месте (' + 2 + ' проверки пройдены)');
  } else {
    Logger.log('⚠️ НАЙДЕНЫ РЕГРЕССИИ (' + problems.length + '):');
    problems.forEach(function(p) { Logger.log('  - ' + p); });
  }
  return problems;
}

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

// Выручка менеджеров продаж (TRAL_MANAGERS) за месяц, но только по число месяца <= maxDay -
// для сравнения "Панели" с прошлым месяцем на ту же календарную дату (Влад, 2026-07-08).
// rows - строки в том же формате, что принимает aggregateOrdersRows (col 2 = Начало работ,
// col 15 = Менеджер по продажам, col 30 = Сумма) - тот же источник и методика, что и живая
// выручка на Панели (salesFakt), чтобы сравнение было корректным.
function sumManagerRevenueThruDay_(rows, maxDay) {
  let total = 0;
  rows.forEach(function(row) {
    const mgr = String(row[15] || '').trim();
    if (!mgr || !ordInList(mgr, TRAL_MANAGERS)) return;
    const rawDate = row[2];
    const dateStr = rawDate instanceof Date
      ? Utilities.formatDate(rawDate, 'Europe/Moscow', 'yyyy-MM-dd')
      : String(rawDate || '').trim();
    if (!dateStr) return;
    const day = parseInt(dateStr.split('-')[2], 10) || 0;
    if (day < 1 || day > maxDay) return;
    total += ordParseNum(row[30]);
  });
  return total;
}

// Сравнение выручки "на ту же дату" - прошлый месяц и тот же месяц год назад, оба обрезаны по
// тому же числу месяца, что и сегодня (иначе неполный текущий месяц сравнивался бы с полным
// прошлым - нечестно). Прошлый месяц - из своего архива заказов (тот же источник/методика,
// что и живая выручка на Панели). Год назад - из отдельной исторической базы клиентов
// (2020-05.2026), т.к. свой архив на дашборде ведётся только с конца июня 2026 - данных за
// прошлый год там физически нет. Влад, 2026-07-08: "бери выручку из истории, не надо ничего
// подписывать" - в отличие от текущей живой выручки (только TRAL_MANAGERS), историческая база
// включает и заказы логистов - методика чуть шире, но по просьбе Влада это не помечаем в UI.
function getRevenueDateComparison_(ss) {
  const now = new Date();
  const currentDay = parseInt(Utilities.formatDate(now, 'Europe/Moscow', 'd'), 10);
  const result = { prev_month: null, prev_year: null, day: currentDay };

  try {
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthKey = Utilities.formatDate(prevMonthDate, 'Europe/Moscow', 'yyyy-MM');
    const archive = ss.getSheetByName(ORDERS_ARCHIVE_PFX + prevMonthKey);
    if (archive && archive.getLastRow() >= 5) {
      const rows = parseOrdersRawRows(archive.getDataRange().getValues()).rows;
      result.prev_month = sumManagerRevenueThruDay_(rows, currentDay);
    }
  } catch (e1) { /* архива нет или не распознан - просто не показываем строку */ }

  try {
    const lastYearDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const yKey = lastYearDate.getFullYear() + '-' + String(lastYearDate.getMonth() + 1).padStart(2, '0');
    const cache = CacheService.getScriptCache();
    const cacheKey = 'yoy_revenue_v1_' + yKey + '_' + currentDay;
    const cached = cache.get(cacheKey);
    if (cached !== null) {
      result.prev_year = parseFloat(cached);
    } else {
      const agg = getClientHistoryAggregate_();
      if (agg) {
        const monthPrefix = yKey + '-';
        let total = 0;
        Object.keys(agg).forEach(function(name) {
          const daily = agg[name].daily || {};
          Object.keys(daily).forEach(function(dateStr) {
            if (!isValidDateStr_(dateStr) || dateStr.indexOf(monthPrefix) !== 0) return;
            const day = parseInt(dateStr.split('-')[2], 10) || 0;
            if (day >= 1 && day <= currentDay) total += (daily[dateStr].r || 0);
          });
        });
        result.prev_year = total;
        try { cache.put(cacheKey, String(total), 21600); } catch (cacheErr) { /* кэш не критичен */ }
      }
    }
  } catch (e2) { /* исторический агрегат недоступен - просто не показываем строку */ }

  return result;
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
  const createdColIdx = col['Дата создания'];
  if (dateColIdx === undefined && createdColIdx === undefined) return {};

  const buckets = {};
  for (let i = headerRowIdx + 1; i < data.length; i++) {
    // "Начало работ" пусто, если заказ создан, но рейс ещё не начался - обычное дело в
    // середине месяца (Влад, 2026-07-24: "куда-то пропали все данные" - в "Заказы_сырые"
    // осталась 1 строка из десятков в письме). Раньше такая строка молча выпадала из ВСЕХ
    // месячных корзин целиком - не "не туда попадала", а исчезала насовсем. Фолбэк на
    // "Дата создания" - она у заказа есть всегда.
    let month = dateColIdx !== undefined ? ordMonthKey(data[i][dateColIdx]) : '';
    if (!month && createdColIdx !== undefined) month = ordMonthKey(data[i][createdColIdx]);
    if (!month) continue; // ни одной даты нет вообще - действительно не строка заказа
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
    // Живой месяц = РЕАЛЬНЫЙ календарный текущий месяц (Влад, 2026-07-24: "куда-то пропали
    // все данные" - самый поздний месяц В ДАННЫХ ≠ текущий календарный: один заказ без
    // "Начало работ" с "Датой создания" уже в августе (fallback добавлен в этом же фиксе)
    // попал в бакет "2026-08", тот стал "последним" по сортировке строк, и в живую таблицу
    // ушла 1 строка августа вместо 928 строк реального июля - остальное молча уехало в
    // архив). Если реальный текущий месяц почему-то отсутствует в данных вовсе (не должно
    // случиться - отчёт всегда должен покрывать сегодня) - фолбэк на старое поведение.
    const actualCurrentMonth = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM');
    const liveMonth = monthBuckets[actualCurrentMonth] ? actualCurrentMonth : monthsPresent[monthsPresent.length - 1];
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

// ── СЛИЯНИЕ ВМЕСТО ПЕРЕЗАПИСИ (2026-08-06) ────────────────────
// Найдено при разборе расхождения 40 000₽ у Савиток за июль (заказ №468973, создан 30.06 в
// 10:24, "Начало работ" 01.07) - весь импорт заказов раньше был "взял сегодняшний файл 1С,
// стёр всё, записал заново" на каждом шаге (Заказы_сырые/Заказы_данные/архивы). Если 1С хоть
// один день не включит в отчёт заказ, который мы уже видели (например, окно коррекции
// "прошлый+текущий месяц" длится только до 5-6 числа - см. комментарий в
// importOrdersReport()) - заказ исчезал НАВСЕГДА, даже если раньше был у нас сохранён.
// Теперь запись всегда СЛИВАЕТСЯ с уже сохранёнными данными по ключу "Номер заказа": известный
// id, которого нет в свежем отчёте - остаётся как был; известный id, что есть в свежем отчёте -
// обновляется свежими данными (1С может дозаполнить прибыль/путёвку задним числом); новый id -
// добавляется. См. plans/2026-08-06-orders-import-merge-not-replace.md.

// КОРЕНЬ БАГА ЗАДВОЕНИЯ АРХИВОВ (найден 2026-08-07, см. project_salary_rules): 1С экспортирует
// "Номер заказа" как ТЕКСТ с ведущими нулями ("000469109"), а Google Таблицы при записи
// (setValues) молча превращают то же значение в чистое число (469109), теряя нули - при
// следующем слиянии String(469109)="469109" НЕ РАВНО "000469109", хотя это один и тот же
// заказ. Раньше (до слияния, просто "стереть и переписать") это не имело значения - никто не
// сравнивал старый номер с новым. Канонический вид - распарсить как целое число и обратно в
// строку: схлопывает оба варианта в одно значение независимо от формата на входе. Использовать
// ВЕЗДЕ, где "Номер" сравнивается на равенство (слияние, дедупликация, бэкфилл, диагностика) -
// не только там, где нашли симптом.
function normalizeOrderId_(val) {
  const s = String(val || '').trim();
  if (!s) return '';
  const n = parseInt(s, 10);
  return isNaN(n) ? s : String(n);
}

// Слияние НОРМАЛИЗОВАННЫХ строк (44 колонки, id всегда в колонке 0) - для Заказы_данные.
function mergeNormalizedOrderRows_(existingRows, newRows) {
  const map = {};
  const order = [];
  function addRows(rows) {
    rows.forEach(function(row) {
      const id = normalizeOrderId_(row[0]);
      if (!id) return;
      if (!(id in map)) order.push(id);
      map[id] = row;
    });
  }
  addRows(existingRows || []);
  addRows(newRows || []);
  return order.map(function(id) { return map[id]; });
}

// Слияние СЫРЫХ строк 1С (raw-формат, шапка в начале, позиция колонки "Номер" ищем по
// заголовку - формат 1С может сдвигать колонки между отчётами) - для архивов Заказы_YYYY-MM.
// Если что-то пошло не так (нет колонки "Номер", лист раньше был пуст) - просто отдаём newData
// как есть (старое поведение), ничем не рискуем.
function mergeRawOrderRows_(existingData, newData) {
  if (!existingData || existingData.length < 5) return newData;
  const newHeaderIdx = findOrdersHeaderRowIndex_(newData);
  const newHeaderRow = newData[newHeaderIdx] || [];
  let idCol = -1;
  newHeaderRow.forEach(function(h, i) { if (String(h || '').trim() === 'Номер') idCol = i; });
  if (idCol < 0) return newData;

  const existingHeaderIdx = findOrdersHeaderRowIndex_(existingData);
  if (existingHeaderIdx < 0 || existingData.length <= existingHeaderIdx + 1) return newData;

  // Позиция колонки "Номер" ищется ОТДЕЛЬНО в шапке existingData - как она реально лежит в
  // уже сохранённых строках, а не как в сегодняшнем отчёте (первый найденный баг 2026-08-06:
  // 1С может сдвигать колонки между отчётами - тогда общий idCol на оба набора читал бы
  // старые строки по неверной позиции).
  const existingHeaderRow = existingData[existingHeaderIdx] || [];
  let existingIdCol = -1;
  existingHeaderRow.forEach(function(h, i) { if (String(h || '').trim() === 'Номер') existingIdCol = i; });
  if (existingIdCol < 0) return newData; // не нашли колонку в старых данных - не рискуем, просто заменяем

  const headerRows = newData.slice(0, newHeaderIdx + 1);
  const map = {};
  const order = [];
  function addRows(rows, col) {
    rows.forEach(function(row) {
      const id = normalizeOrderId_(row[col]); // см. normalizeOrderId_ - без этого "469109" (число, уже записанное нами) и "000469109" (текст из свежего отчёта 1С) считались бы разными заказами - настоящая причина задвоения 2026-08-07
      if (!id) return;
      if (!(id in map)) order.push(id);
      map[id] = row;
    });
  }
  addRows(existingData.slice(existingHeaderIdx + 1), existingIdCol);
  addRows(newData.slice(newHeaderIdx + 1), idCol);
  return headerRows.concat(order.map(function(id) { return map[id]; }));
}


// РАЗОВЫЙ ХЕЛПЕР БЭКФИЛЛА (2026-08-06): дописывает заказы №468973 (40 000₽) и №469551 (0₽,
// служебная строка) в архив Заказы_2026-07 - оба отсутствовали ВЕЗДЕ (см. diagnoseSavitokJuly/
// findMissingSavitokOrders), причина - окно коррекции 1С "прошлый+текущий месяц" длится
// только до 5-6 числа, заказ №468973 создан 30.06 (в это окно, видимо, не попал ни в один
// наш прогон), к сегодняшнему дню 1С уже не пришлёт его снова ни в одном отчёте - слияние
// (mergeRawOrderRows_, см. выше) чинит это НА БУДУЩЕЕ, но не восстанавливает задним числом
// то, что мы вообще ни разу не видели.
//
// Данные подтверждены Владом (выгрузка 1С + скриншот карточки заказа, 2026-08-06). Поля,
// для которых нет надёжного 1:1 соответствия с колонками архива (Организация, Подразделение,
// Отдел, Старший менеджер и т.п. - не используются нигде в расчётах выручки/прибыли/зарплаты)
// оставлены пустыми - не критично, и строка автоматически обновится, если 1С когда-нибудь
// снова пришлёт этот заказ (тот же mergeRawOrderRows_ подхватит свежие данные по номеру).
//
// Читает РЕАЛЬНУЮ шапку архива по именам колонок (не жёстко по индексу) - формат 1С может
// сдвигать колонки между отчётами, см. findOrdersHeaderRowIndex_. Идемпотентна - если номер
// уже есть в архиве, повторно не добавляет (безопасно перезапускать). Удалить после проверки.
// Общая часть - дописывает список заказов (каждый - объект {ИмяКолонки: значение}) в архив
// заданного месяца. Читает шапку по именам колонок (не жёстко по индексу - формат 1С может
// сдвигать колонки), идемпотентна (не дублирует уже существующие номера).
function backfillOrders_(month, orders) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const archiveName = ORDERS_ARCHIVE_PFX + month;
  const sheet = ss.getSheetByName(archiveName);
  if (!sheet) throw new Error('Нет листа ' + archiveName);

  const allData = sheet.getDataRange().getValues();
  const headerIdx = findOrdersHeaderRowIndex_(allData);
  const headerRow = allData[headerIdx];
  const colOf = {};
  headerRow.forEach(function(h, i) { var k = String(h || '').trim(); if (k) colOf[k] = i; });

  const numCol = colOf['Номер'];
  if (numCol === undefined) throw new Error('Колонка "Номер" не найдена в шапке архива');
  const existingIds = {};
  allData.slice(headerIdx + 1).forEach(function(row) { existingIds[normalizeOrderId_(row[numCol])] = true; });

  function buildRow(values) {
    const row = new Array(headerRow.length).fill('');
    Object.keys(values).forEach(function(name) {
      if (name in colOf) row[colOf[name]] = values[name];
      else Logger.log('⚠️ Колонка "' + name + '" не найдена в шапке архива - значение "' + values[name] + '" пропущено');
    });
    return row;
  }

  const toAdd = [];
  orders.forEach(function(o) {
    if (existingIds[normalizeOrderId_(o['Номер'])]) { Logger.log('Заказ №' + o['Номер'] + ' уже есть в архиве - пропущен'); return; }
    toAdd.push(buildRow(o));
  });

  if (toAdd.length === 0) { Logger.log('Все заказы уже есть - ничего не добавлено'); return; }

  sheet.getRange(sheet.getLastRow() + 1, 1, toAdd.length, headerRow.length).setValues(toAdd);
  Logger.log('✅ Добавлено строк: ' + toAdd.length + ' в ' + archiveName);
}

// РАЗОВЫЙ ХЕЛПЕР БЭКФИЛЛА (2026-08-06): дописывает заказы №468973 (40 000₽) и №469551 (0₽,
// служебная строка) в архив Заказы_2026-07 - оба отсутствовали ВЕЗДЕ (см. diagnoseSavitokJuly/
// findMissingSavitokOrders, уже удалены как отработавшие - причина расхождения найдена: окно
// коррекции 1С "прошлый+текущий месяц" длится только до 5-6 числа, заказ №468973 создан 30.06,
// к моменту разбора 1С уже не пришлёт его снова ни в одном отчёте). Данные подтверждены Владом
// (выгрузка 1С + скриншот карточки заказа, 2026-08-06). Удалить после проверки.
function backfillMissingSavitokOrders() {
  backfillOrders_('2026-07', [
    {
      'Номер': '468973',
      'Дата': '30.06.2026',
      'Начало работ': '01.07.2026',
      'Окончание работ': '01.07.2026',
      'Менеджер по продажам': 'Савиток Олеся Анатольевна 8-985-150-11-85',
      'Менеджер по снабжению': 'Махура Николай Геннадьевич +7 989 581 8582',
      'Водитель': 'Егоров Сергей Степанович',
      'Заказчик': 'ГЕОСПЕЦСТРОЙ АО',
      'Тип техники': 'Трал',
      'Оборудование техники': 'Трал габарит',
      'Данные по машине': 'КАМАЗ 5490-S5 Х981СА750',
      'Груз': 'Экскаватор Zoomlion ZE215E/ZE215E-10',
      'Путевка': 'Да',
      'Привлеченная техника': 'Нет',
      'Сумма': 40000,
      'Прибыль': 40000,
      'Договор': 'Договор № 01/01/25Т/2025 от 01.01.2025'
    },
    {
      'Номер': '469551',
      'Начало работ': '03.07.2026',
      'Окончание работ': '03.07.2026',
      'Менеджер по продажам': 'Савиток Олеся Анатольевна 8-985-150-11-85',
      'Путевка': 'Нет',
      'Привлеченная техника': 'Нет',
      'Договор': 'Договор № 10011 от 10.04.2025',
      'Вариант расчета': 'Прочее'
    }
  ]);
}

// РАЗОВЫЙ ХЕЛПЕР БЭКФИЛЛА (2026-08-06): дописывает 6 заказов на 160 000₽, отсутствующих в
// архиве Заказы_2026-06 (см. diagnoseJuneCompanyWide - 31 отсутствующий заказ, 25 из них
// нулевые служебные строки "Прочее", 6 реальных). Данные - из полной выгрузки 1С за июнь
// ("Выгрузка ИЮНЬ.xlsx", предоставлена Владом). №466285/№466286 - наёмные (Стоимость
// привлечённой техники 27000, Прибыль 7000 у каждого), №469093 - вариант расчёта "Прочее" с
// полным вознаграждением (Сумма 10000 = Вознаграждение 2 10000, реальная прибыль 0), остальные
// три - тип техники "Машина прикрытия" (сопровождение негабарита), не Трал/Длинномер - в
// сегментной разбивке тралы/длинномеры не попадут, но в выручку менеджера войдут как обычно.
// Удалить после проверки.
function backfillMissingJuneOrders() {
  backfillOrders_('2026-06', [
    {
      'Номер': '466285',
      'Менеджер по продажам': 'Гуляева Лилия Александровна',
      'Менеджер по снабжению': 'Прус-Роскошный Роман Владимирович',
      'Заказчик': 'РСПК ООО',
      'Тип техники': 'Длинномер',
      'Данные по машине': 'У 271 МЕ 799',
      'Груз': 'трубы',
      'Начало работ': '01.06.2026',
      'Окончание работ': '01.06.2026',
      'Путевка': 'Нет',
      'Привлеченная техника': 'СПЕЦ-АВТО борта',
      'Стоимость привлеченной техники': 27000,
      'Сумма': 34000,
      'Прибыль': 7000,
      'Вариант расчета': 'Безналичный'
    },
    {
      'Номер': '466286',
      'Менеджер по продажам': 'Гуляева Лилия Александровна',
      'Менеджер по снабжению': 'Прус-Роскошный Роман Владимирович',
      'Заказчик': 'РСПК ООО',
      'Тип техники': 'Длинномер',
      'Данные по машине': 'Е 676 МА 799',
      'Груз': 'трубы',
      'Начало работ': '01.06.2026',
      'Окончание работ': '01.06.2026',
      'Путевка': 'Нет',
      'Привлеченная техника': 'СПЕЦ-АВТО борта',
      'Стоимость привлеченной техники': 27000,
      'Сумма': 34000,
      'Прибыль': 7000,
      'Вариант расчета': 'Безналичный'
    },
    {
      'Номер': '466992',
      'Менеджер по продажам': 'Ахтамова Лиана 8-903-726-85-42',
      'Менеджер по снабжению': 'Кан Михаил Дмитриевич +7(926) 933-22-03',
      'Заказчик': 'КОМБИНАТ ИННОВАЦИОННЫХ ТЕХНОЛОГИЙ - МОНАРХ ООО',
      'Тип техники': 'Машина прикрытия',
      'Данные по машине': 'LADA LARGUS Р048ЕТ797',
      'Водитель': 'Толмачев Александр Васильевич',
      'Договор': 'ДОГОВОР ПЕРЕВОЗКИ № 2703/ЛА-1 от 01.03.2026',
      'Начало работ': '04.06.2026',
      'Окончание работ': '04.06.2026',
      'Путевка': 'Нет',
      'Привлеченная техника': 'Нет',
      'Сумма': 18000,
      'Прибыль': 18000,
      'Вариант расчета': 'Безналичный'
    },
    {
      'Номер': '467749',
      'Менеджер по продажам': 'Филипчук Екатерина Васильевна',
      'Менеджер по снабжению': 'Кан Михаил Дмитриевич +7(926) 933-22-03',
      'Заказчик': 'АРДЕНА БАЛТИК ЛОГИСТИКС ООО (Филипчук)',
      'Тип техники': 'Машина прикрытия',
      'Данные по машине': 'Лада Гранта О 946 МТ 797',
      'Водитель': 'Харабарь Денис',
      'Начало работ': '15.06.2026',
      'Окончание работ': '15.06.2026',
      'Путевка': 'Да',
      'Привлеченная техника': 'Нет',
      'Сумма': 39000,
      'Прибыль': 39000,
      'Вариант расчета': 'Безналичный'
    },
    {
      'Номер': '468807',
      'Менеджер по продажам': 'Ахтамова Лиана 8-903-726-85-42',
      'Менеджер по снабжению': 'Сильчев Максим Александрович 7 985 647-98-86',
      'Заказчик': 'КОМБИНАТ ИННОВАЦИОННЫХ ТЕХНОЛОГИЙ - МОНАРХ ООО',
      'Тип техники': 'Машина прикрытия',
      'Данные по машине': 'Лада Гранта О 946 МТ 797',
      'Водитель': 'Харабарь Денис',
      'Начало работ': '26.06.2026',
      'Окончание работ': '26.06.2026',
      'Путевка': 'Нет',
      'Привлеченная техника': 'Нет',
      'Сумма': 25000,
      'Прибыль': 25000,
      'Вариант расчета': 'Безналичный'
    },
    {
      'Номер': '469093',
      'Менеджер по продажам': 'Савиток Олеся Анатольевна 8-985-150-11-85',
      'Менеджер по снабжению': 'Махура Николай Геннадьевич +7 989 581 8582',
      'Заказчик': 'АРЕНДАКРАН ООО',
      'Тип техники': 'Машина прикрытия',
      'Начало работ': '30.06.2026',
      'Окончание работ': '30.06.2026',
      'Путевка': 'Нет',
      'Привлеченная техника': 'Нет',
      'Сумма': 10000,
      'Прибыль': 0,
      'Вариант расчета': 'Прочее',
      'ФИО Вознаграждения 2': 'Егоров Максим Сергеевич ИП',
      'Сумма вознаграждения 2': 10000
    }
  ]);
}


// РАЗОВЫЙ ДИАГНОСТИЧЕСКИЙ ХЕЛПЕР (2026-08-06, только читает): сверка ВСЕХ заказов отдела
// Тралы за июнь с выгрузкой 1С (974 заказа, "Выгрузка ИЮНЬ.xlsx", вся выгрузка целиком - не
// один менеджер, как в июльской сверке). REFERENCE - точная копия (номер, Сумма, фамилия
// менеджера продаж) из выгрузки. Читает архив Заказы_2026-06, сверяет по номеру заказа
// (независимо от менеджера - REFERENCE уже отфильтрована по отделу Тралы) и печатает: общую
// сумму (эталон/у нас/разница), список отсутствующих/несовпадающих заказов, и разбивку
// отсутствующей суммы по менеджеру. Удалить после разбора.
var JUNE_REFERENCE = [
  ["466285",34000,"Гуляева"],
  ["466286",34000,"Гуляева"],
  ["466579",63000,"Савиток"],
  ["466581",29000,"Савиток"],
  ["466582",33000,"Савиток"],
  ["466583",33000,"Савиток"],
  ["466584",33000,"Савиток"],
  ["466585",33000,"Савиток"],
  ["466586",30000,"Савиток"],
  ["466587",30000,"Савиток"],
  ["466591",40000,"Савиток"],
  ["466592",25000,"Савиток"],
  ["466593",25000,"Савиток"],
  ["466594",25000,"Савиток"],
  ["466595",52000,"Савиток"],
  ["466596",0,"Ахтамова"],
  ["466600",28000,"Ахтамова"],
  ["466601",28000,"Ахтамова"],
  ["466602",30423,"Ахтамова"],
  ["466603",27042,"Ахтамова"],
  ["466604",21972,"Ахтамова"],
  ["466605",32113,"Ахтамова"],
  ["466606",27042,"Ахтамова"],
  ["466607",151998,"Ахтамова"],
  ["466608",124362,"Ахтамова"],
  ["466609",48363,"Ахтамова"],
  ["466610",56772,"Ахтамова"],
  ["466611",0,"Ахтамова"],
  ["466663",70000,"Прус-Роскошный"],
  ["466685",20000,"Кан"],
  ["466686",20000,"Кан"],
  ["466689",20000,"Кан"],
  ["466690",20000,"Кан"],
  ["466693",20000,"Кан"],
  ["466696",24000,"Кан"],
  ["466697",0,"Ахтамова"],
  ["466724",68000,"Гуштюк"],
  ["466762",33000,"Котельников"],
  ["466765",33000,"Котельников"],
  ["466766",41000,"Котельников"],
  ["466763",43000,"Прус-Роскошный"],
  ["466771",66000,"Котельников"],
  ["466775",30000,"Котельников"],
  ["466776",30000,"Котельников"],
  ["466780",40000,"Сильчев"],
  ["466781",20000,"Сильчев"],
  ["466782",68000,"Сильчев"],
  ["466714",110544,"Ахтамова"],
  ["466715",23662,"Ахтамова"],
  ["466716",28732,"Ахтамова"],
  ["466717",30423,"Ахтамова"],
  ["466718",30423,"Ахтамова"],
  ["466720",100000,"Ахтамова"],
  ["466671",28000,"Савиток"],
  ["466678",52000,"Савиток"],
  ["466680",35000,"Савиток"],
  ["466681",55000,"Савиток"],
  ["466727",36000,"Цегельников"],
  ["466728",50000,"Цегельников"],
  ["466493",37500,"Прус-Роскошный"],
  ["466518",34000,"Гуляева"],
  ["466520",34000,"Гуляева"],
  ["466841",85000,"Филипчук"],
  ["467093",33000,"Савиток"],
  ["467095",66000,"Савиток"],
  ["467099",34000,"Савиток"],
  ["466843",27000,"Филипчук"],
  ["466812",28000,"Ахтамова"],
  ["466813",85000,"Ахтамова"],
  ["466816",45000,"Ахтамова"],
  ["466822",35000,"Цегельников"],
  ["466823",30000,"Цегельников"],
  ["466824",24000,"Цегельников"],
  ["466825",54000,"Цегельников"],
  ["466826",80000,"Цегельников"],
  ["466827",90000,"Цегельников"],
  ["466835",28000,"Гуляева"],
  ["466836",28000,"Гуляева"],
  ["466837",38000,"Гуляева"],
  ["466838",50000,"Прус-Роскошный"],
  ["466839",45000,"Прус-Роскошный"],
  ["466794",55000,"Савиток"],
  ["466795",30000,"Савиток"],
  ["466796",27000,"Махура"],
  ["466797",20000,"Махура"],
  ["466798",35000,"Махура"],
  ["466801",35000,"Махура"],
  ["466803",20000,"Махура"],
  ["466806",28732,"Ахтамова"],
  ["466807",28732,"Ахтамова"],
  ["466808",23662,"Ахтамова"],
  ["466809",28732,"Ахтамова"],
  ["466810",27042,"Ахтамова"],
  ["466811",28000,"Ахтамова"],
  ["466764",43000,"Прус-Роскошный"],
  ["466725",37000,"Гуштюк"],
  ["466726",40000,"Гуштюк"],
  ["466749",35000,"Гуштюк"],
  ["466751",77000,"Гуштюк"],
  ["466752",27000,"Савиток"],
  ["466754",43000,"Савиток"],
  ["466755",25000,"Савиток"],
  ["469378",0,"Гуштюк"],
  ["469377",0,"Ахтамова"],
  ["466521",34000,"Гуляева"],
  ["466522",34000,"Гуляева"],
  ["467097",33000,"Савиток"],
  ["466908",37500,"Прус-Роскошный"],
  ["466895",24000,"Цегельников"],
  ["466896",28125,"Цегельников"],
  ["466897",50000,"Цегельников"],
  ["466898",41250,"Цегельников"],
  ["466899",80000,"Цегельников"],
  ["466900",38000,"Цегельников"],
  ["466901",48000,"Цегельников"],
  ["466902",48000,"Цегельников"],
  ["466954",26000,"Кан"],
  ["466955",44000,"Кан"],
  ["466956",20000,"Кан"],
  ["466992",18000,"Ахтамова"],
  ["466829",58000,"Гуштюк"],
  ["466844",70000,"Филипчук"],
  ["466861",25000,"Савиток"],
  ["466862",28000,"Савиток"],
  ["466863",56000,"Савиток"],
  ["466864",28000,"Савиток"],
  ["466870",150000,"Шейко"],
  ["466874",90000,"Шейко"],
  ["466875",28732,"Ахтамова"],
  ["466876",28732,"Ахтамова"],
  ["466877",27042,"Ахтамова"],
  ["466878",57000,"Ахтамова"],
  ["466879",40000,"Шейко"],
  ["466880",124362,"Ахтамова"],
  ["466881",138180,"Ахтамова"],
  ["466882",40000,"Шейко"],
  ["466883",150000,"Ахтамова"],
  ["466890",28000,"Цегельников"],
  ["466891",28000,"Цегельников"],
  ["466893",75000,"Цегельников"],
  ["467100",67000,"Савиток"],
  ["467110",30000,"Савиток"],
  ["467080",37500,"Прус-Роскошный"],
  ["467088",35000,"Гуляева"],
  ["467089",28000,"Гуляева"],
  ["466894",0,"Гуляева"],
  ["466867",215000,"Цегельников"],
  ["466994",25352,"Ахтамова"],
  ["466995",25352,"Ахтамова"],
  ["466996",25352,"Ахтамова"],
  ["466997",27042,"Ахтамова"],
  ["466960",30000,"Прус-Роскошный"],
  ["466969",35000,"Шейко"],
  ["466924",37500,"Прус-Роскошный"],
  ["466929",28000,"Савиток"],
  ["466944",27000,"Савиток"],
  ["466945",35000,"Савиток"],
  ["466946",35000,"Савиток"],
  ["466947",32080,"Савиток"],
  ["466948",49580,"Савиток"],
  ["466949",53080,"Савиток"],
  ["466950",62160,"Савиток"],
  ["466951",55160,"Савиток"],
  ["466952",56000,"Савиток"],
  ["466953",28000,"Савиток"],
  ["466904",150000,"Гуштюк"],
  ["466914",44000,"Прус-Роскошный"],
  ["466916",44000,"Прус-Роскошный"],
  ["467121",66000,"Котельников"],
  ["467123",66000,"Котельников"],
  ["467117",85000,"Котельников"],
  ["467139",14000,"Гуляева"],
  ["467142",20000,"Сильчев"],
  ["467143",32000,"Сильчев"],
  ["467145",20000,"Сильчев"],
  ["467146",20000,"Сильчев"],
  ["467258",50000,"Прус-Роскошный"],
  ["466741",79000,"Гуштюк"],
  ["469380",0,"Гуштюк"],
  ["468325",20000,"Сильчев"],
  ["467098",40000,"Гуштюк"],
  ["467134",27000,"Савиток"],
  ["467126",55000,"Ахтамова"],
  ["467153",56000,"Савиток"],
  ["467154",14000,"Савиток"],
  ["467155",14000,"Савиток"],
  ["467157",55000,"Савиток"],
  ["467158",28000,"Савиток"],
  ["467160",40000,"Савиток"],
  ["467090",120000,"Прус-Роскошный"],
  ["467091",40000,"Гуляева"],
  ["467092",48500,"Гуляева"],
  ["467081",40000,"Прус-Роскошный"],
  ["467082",34375,"Цегельников"],
  ["467083",70000,"Цегельников"],
  ["467084",28000,"Цегельников"],
  ["467101",20000,"Махура"],
  ["467103",20000,"Махура"],
  ["467109",20000,"Махура"],
  ["467096",37000,"Гуштюк"],
  ["467094",20000,"Махура"],
  ["467085",90000,"Цегельников"],
  ["466923",36500,"Прус-Роскошный"],
  ["467078",44000,"Прус-Роскошный"],
  ["467079",44000,"Прус-Роскошный"],
  ["467161",70000,"Савиток"],
  ["467162",42000,"Савиток"],
  ["467087",70000,"Цегельников"],
  ["468654",27200,"Сильчев"],
  ["466575",34000,"Гуляева"],
  ["466576",34000,"Гуляева"],
  ["466665",37500,"Васин"],
  ["466767",50000,"Васин"],
  ["467163",28732,"Ахтамова"],
  ["467164",28732,"Ахтамова"],
  ["467165",124362,"Ахтамова"],
  ["467166",138180,"Ахтамова"],
  ["467167",170000,"Ахтамова"],
  ["467168",260000,"Шейко"],
  ["467127",50000,"Филипчук"],
  ["467115",64000,"Савиток"],
  ["467118",75000,"Котельников"],
  ["467179",24400,"Савиток"],
  ["467180",26000,"Савиток"],
  ["467181",26000,"Савиток"],
  ["467182",28000,"Савиток"],
  ["467183",32000,"Савиток"],
  ["467212",76666,"Гуштюк"],
  ["467213",73484,"Гуштюк"],
  ["467214",65000,"Гуштюк"],
  ["467215",71366,"Гуштюк"],
  ["467216",73484,"Гуштюк"],
  ["467228",120000,"Цегельников"],
  ["467229",60000,"Цегельников"],
  ["467230",27000,"Цегельников"],
  ["467231",28000,"Гуляева"],
  ["467232",37000,"Гуляева"],
  ["467233",120000,"Цегельников"],
  ["467253",45000,"Котельников"],
  ["467255",45000,"Котельников"],
  ["467257",75000,"Котельников"],
  ["469382",0,"Ахтамова"],
  ["469388",0,"Ахтамова"],
  ["469260",0,"Шейко"],
  ["469261",0,"Шейко"],
  ["467558",53000,"Ахтамова"],
  ["469384",0,"Прус-Роскошный"],
  ["467548",45000,"Прус-Роскошный"],
  ["467432",28732,"Ахтамова"],
  ["467433",28732,"Ахтамова"],
  ["467434",151998,"Ахтамова"],
  ["467501",261000,"Прус-Роскошный"],
  ["467502",15000,"Прус-Роскошный"],
  ["467243",60000,"Прус-Роскошный"],
  ["467249",43000,"Савиток"],
  ["467300",100000,"Котельников"],
  ["467241",150000,"Цегельников"],
  ["467305",42000,"Котельников"],
  ["467259",30000,"Савиток"],
  ["467260",30000,"Савиток"],
  ["467261",28000,"Савиток"],
  ["467271",28125,"Цегельников"],
  ["467272",95000,"Цегельников"],
  ["467273",28000,"Цегельников"],
  ["467274",55000,"Цегельников"],
  ["467275",55000,"Цегельников"],
  ["467276",32000,"Гуляева"],
  ["467277",28000,"Гуляева"],
  ["467278",28000,"Гуляева"],
  ["467279",28000,"Гуляева"],
  ["467280",40000,"Гуляева"],
  ["467281",40000,"Гуляева"],
  ["467172",28732,"Ахтамова"],
  ["467173",28732,"Ахтамова"],
  ["467174",28732,"Ахтамова"],
  ["467176",28732,"Ахтамова"],
  ["467086",38000,"Гуляева"],
  ["467297",32000,"Савиток"],
  ["467298",130000,"Котельников"],
  ["467299",28000,"Савиток"],
  ["467310",26000,"Махура"],
  ["467311",26000,"Махура"],
  ["467312",26000,"Махура"],
  ["467316",20000,"Махура"],
  ["467318",20000,"Махура"],
  ["467242",130000,"Цегельников"],
  ["467302",120000,"Котельников"],
  ["468423",124362,"Ахтамова"],
  ["467514",28000,"Гуляева"],
  ["467515",28000,"Гуляева"],
  ["467430",28732,"Ахтамова"],
  ["467431",0,"Ахтамова"],
  ["467463",46000,"Гуштюк"],
  ["467435",124362,"Ахтамова"],
  ["467436",124362,"Ахтамова"],
  ["467437",35000,"Прус-Роскошный"],
  ["467438",42000,"Котельников"],
  ["467319",25000,"Махура"],
  ["467323",35000,"Савиток"],
  ["467324",23000,"Савиток"],
  ["467325",18000,"Цегельников"],
  ["467326",25000,"Савиток"],
  ["467364",60000,"Савиток"],
  ["467369",35000,"Махура"],
  ["467413",50000,"Цегельников"],
  ["467414",50000,"Цегельников"],
  ["467415",50000,"Цегельников"],
  ["467416",50000,"Цегельников"],
  ["467417",50000,"Цегельников"],
  ["467418",50000,"Цегельников"],
  ["467419",50000,"Цегельников"],
  ["467420",50000,"Цегельников"],
  ["467421",60000,"Цегельников"],
  ["467554",28732,"Ахтамова"],
  ["467517",47000,"Гуляева"],
  ["467518",32000,"Гуляева"],
  ["467520",43000,"Гуляева"],
  ["467522",32000,"Гуляева"],
  ["467524",28000,"Гуляева"],
  ["469383",0,"Ахтамова"],
  ["467563",30000,"Филипчук"],
  ["467572",35000,"Прус-Роскошный"],
  ["467699",33000,"Савиток"],
  ["467700",41000,"Савиток"],
  ["467701",33000,"Савиток"],
  ["467593",41000,"Котельников"],
  ["467594",41000,"Котельников"],
  ["467595",41000,"Котельников"],
  ["467597",95000,"Котельников"],
  ["467981",28000,"Ахтамова"],
  ["469375",0,"Гуштюк"],
  ["467521",50000,"Цегельников"],
  ["467528",35000,"Цегельников"],
  ["467529",32000,"Гуляева"],
  ["467531",28000,"Гуляева"],
  ["467533",32000,"Гуляева"],
  ["467535",40000,"Цегельников"],
  ["467537",50000,"Цегельников"],
  ["467612",40400,"Сильчев"],
  ["467613",20000,"Сильчев"],
  ["467614",20000,"Сильчев"],
  ["467786",50000,"Савиток"],
  ["467439",35000,"Прус-Роскошный"],
  ["467476",56000,"Савиток"],
  ["467477",25000,"Савиток"],
  ["467427",32000,"Савиток"],
  ["467428",80000,"Савиток"],
  ["467429",55000,"Савиток"],
  ["467489",40000,"Савиток"],
  ["467511",34000,"Гуштюк"],
  ["467512",57000,"Ахтамова"],
  ["467513",90000,"Гуштюк"],
  ["468657",20000,"Сильчев"],
  ["467301",30000,"Савиток"],
  ["467516",32800,"Савиток"],
  ["467482",40000,"Махура"],
  ["467484",53000,"Махура"],
  ["467538",28000,"Цегельников"],
  ["467539",28000,"Цегельников"],
  ["467540",28000,"Цегельников"],
  ["467536",25000,"Савиток"],
  ["467534",25000,"Савиток"],
  ["467532",28000,"Савиток"],
  ["467526",32800,"Савиток"],
  ["467519",28000,"Ахтамова"],
  ["467523",28000,"Цегельников"],
  ["467525",28000,"Ахтамова"],
  ["467527",28000,"Ахтамова"],
  ["467541",150000,"Цегельников"],
  ["467543",35000,"Савиток"],
  ["467544",35000,"Савиток"],
  ["467545",56000,"Савиток"],
  ["469373",0,"Сильчев"],
  ["467575",35000,"Прус-Роскошный"],
  ["467547",36000,"Савиток"],
  ["467615",196000,"Сильчев"],
  ["467616",40400,"Сильчев"],
  ["467617",40400,"Сильчев"],
  ["467687",28000,"Ахтамова"],
  ["467600",130000,"Котельников"],
  ["467602",100000,"Котельников"],
  ["467604",120000,"Котельников"],
  ["467618",32000,"Сильчев"],
  ["467564",110000,"Филипчук"],
  ["467546",56000,"Савиток"],
  ["467550",199000,"Ахтамова"],
  ["467551",35000,"Савиток"],
  ["467552",35000,"Савиток"],
  ["467553",35000,"Савиток"],
  ["467556",30000,"Савиток"],
  ["467557",30000,"Савиток"],
  ["467562",27000,"Савиток"],
  ["467694",80000,"Цегельников"],
  ["467695",40000,"Цегельников"],
  ["467697",500000,"Ахтамова"],
  ["467696",40000,"Цегельников"],
  ["467698",35000,"Цегельников"],
  ["467745",174500,"Филипчук"],
  ["467746",159500,"Филипчук"],
  ["467747",159500,"Филипчук"],
  ["467441",35000,"Прус-Роскошный"],
  ["467714",28732,"Ахтамова"],
  ["467715",27042,"Ахтамова"],
  ["467716",27042,"Ахтамова"],
  ["467717",27042,"Ахтамова"],
  ["467719",27042,"Ахтамова"],
  ["467721",151998,"Ахтамова"],
  ["467731",33500,"Котельников"],
  ["467732",41000,"Котельников"],
  ["467733",60000,"Котельников"],
  ["467734",60000,"Котельников"],
  ["467742",174500,"Филипчук"],
  ["467749",39000,"Филипчук"],
  ["467750",120000,"Филипчук"],
  ["467751",40000,"Кан"],
  ["466666",70000,"Васин"],
  ["468424",193452,"Ахтамова"],
  ["468477",0,"Ахтамова"],
  ["467149",27000,"Савиток"],
  ["467763",28000,"Филипчук"],
  ["467764",28000,"Филипчук"],
  ["467765",120000,"Филипчук"],
  ["467766",35000,"Филипчук"],
  ["467767",35000,"Филипчук"],
  ["467768",35000,"Филипчук"],
  ["467769",120000,"Филипчук"],
  ["467776",55000,"Савиток"],
  ["467777",37000,"Гуляева"],
  ["467778",40000,"Гуляева"],
  ["467779",38000,"Гуляева"],
  ["467780",32000,"Гуляева"],
  ["467743",80000,"Савиток"],
  ["467744",48000,"Савиток"],
  ["468155",77000,"Кан"],
  ["468047",20000,"Прус-Роскошный"],
  ["468048",70000,"Прус-Роскошный"],
  ["468050",55000,"Шейко"],
  ["467790",85000,"Цегельников"],
  ["467791",75000,"Цегельников"],
  ["467794",50000,"Цегельников"],
  ["467827",28732,"Ахтамова"],
  ["467828",28732,"Ахтамова"],
  ["467829",28732,"Ахтамова"],
  ["467837",27042,"Ахтамова"],
  ["467838",28732,"Ахтамова"],
  ["467843",35000,"Прус-Роскошный"],
  ["467844",35000,"Прус-Роскошный"],
  ["467748",45000,"Савиток"],
  ["469391",0,"Гуштюк"],
  ["469536",20000,"Прус-Роскошный"],
  ["469390",0,"Ахтамова"],
  ["467789",42000,"Савиток"],
  ["467426",75000,"Савиток"],
  ["467866",200000,"Прус-Роскошный"],
  ["467946",135000,"Филипчук"],
  ["467949",120000,"Филипчук"],
  ["467950",100000,"Филипчук"],
  ["468006",28732,"Ахтамова"],
  ["468008",28732,"Ахтамова"],
  ["468018",25000,"Шейко"],
  ["468019",25000,"Шейко"],
  ["468026",90000,"Цегельников"],
  ["468027",40000,"Цегельников"],
  ["468028",80000,"Цегельников"],
  ["467993",53000,"Гуштюк"],
  ["467994",56000,"Гуштюк"],
  ["468037",35000,"Прус-Роскошный"],
  ["468038",22000,"Прус-Роскошный"],
  ["468290",0,"Прус-Роскошный"],
  ["467951",120000,"Филипчук"],
  ["467952",125000,"Филипчук"],
  ["467958",45000,"Котельников"],
  ["467959",48000,"Котельников"],
  ["467960",48000,"Котельников"],
  ["467961",48000,"Котельников"],
  ["467962",48000,"Котельников"],
  ["467963",48000,"Котельников"],
  ["467964",32800,"Котельников"],
  ["467965",32800,"Котельников"],
  ["467966",32800,"Котельников"],
  ["467967",32800,"Котельников"],
  ["467968",32800,"Котельников"],
  ["467969",32800,"Котельников"],
  ["467971",34000,"Гуляева"],
  ["467972",38500,"Гуляева"],
  ["467975",28000,"Гуляева"],
  ["467976",28000,"Гуляева"],
  ["467781",100000,"Гуштюк"],
  ["467782",29000,"Савиток"],
  ["469059",27200,"Сильчев"],
  ["469060",31600,"Сильчев"],
  ["468655",27200,"Сильчев"],
  ["468656",27200,"Сильчев"],
  ["468425",193452,"Ахтамова"],
  ["468658",50000,"Сильчев"],
  ["468134",20000,"Кан"],
  ["468135",20000,"Кан"],
  ["468136",20000,"Кан"],
  ["468139",20000,"Кан"],
  ["468070",80000,"Цегельников"],
  ["468071",150000,"Цегельников"],
  ["468072",185000,"Цегельников"],
  ["468073",140000,"Цегельников"],
  ["468066",67000,"Савиток"],
  ["468092",95000,"Гуштюк"],
  ["468105",28732,"Ахтамова"],
  ["468106",28732,"Ахтамова"],
  ["468107",45000,"Филипчук"],
  ["468108",28732,"Ахтамова"],
  ["468109",28732,"Ахтамова"],
  ["468110",16901,"Ахтамова"],
  ["467977",120000,"Филипчук"],
  ["467978",100000,"Филипчук"],
  ["467979",100000,"Филипчук"],
  ["467980",100000,"Филипчук"],
  ["468040",25000,"Котельников"],
  ["468041",39000,"Котельников"],
  ["468042",150000,"Котельников"],
  ["467995",28000,"Савиток"],
  ["467997",28000,"Савиток"],
  ["467998",28000,"Савиток"],
  ["467999",32000,"Савиток"],
  ["468032",150000,"Цегельников"],
  ["468054",32000,"Гуляева"],
  ["468049",38500,"Филипчук"],
  ["467992",56000,"Савиток"],
  ["468056",32000,"Гуляева"],
  ["468061",50000,"Савиток"],
  ["468063",75000,"Савиток"],
  ["468153",44000,"Прус-Роскошный"],
  ["468154",44000,"Прус-Роскошный"],
  ["469369",0,"Цегельников"],
  ["469371",0,"Цегельников"],
  ["469372",0,"Цегельников"],
  ["467530",40000,"Гуштюк"],
  ["469368",0,"Ахтамова"],
  ["468064",30000,"Савиток"],
  ["468065",30000,"Савиток"],
  ["468062",40000,"Савиток"],
  ["468057",43300,"Савиток"],
  ["468058",50000,"Савиток"],
  ["468055",32800,"Савиток"],
  ["468052",56000,"Савиток"],
  ["468053",40000,"Савиток"],
  ["468326",45000,"Филипчук"],
  ["468327",28000,"Филипчук"],
  ["468323",75000,"Савиток"],
  ["468324",31000,"Савиток"],
  ["468117",60000,"Савиток"],
  ["468067",28000,"Савиток"],
  ["468069",56000,"Савиток"],
  ["468082",28000,"Савиток"],
  ["468083",58000,"Савиток"],
  ["468084",40000,"Савиток"],
  ["468146",100000,"Прус-Роскошный"],
  ["468149",95000,"Прус-Роскошный"],
  ["468151",65000,"Гуштюк"],
  ["468152",84000,"Прус-Роскошный"],
  ["468163",70000,"Филипчук"],
  ["468203",55000,"Ахтамова"],
  ["468204",115000,"Ахтамова"],
  ["468676",20000,"Прус-Роскошный"],
  ["468426",124362,"Ахтамова"],
  ["468328",38000,"Филипчук"],
  ["468352",20000,"Прус-Роскошный"],
  ["468227",100000,"Цегельников"],
  ["468232",28000,"Цегельников"],
  ["468233",55000,"Цегельников"],
  ["468219",60000,"Цегельников"],
  ["468579",27000,"Прус-Роскошный"],
  ["468210",32000,"Гуляева"],
  ["468211",32000,"Гуляева"],
  ["468212",32000,"Гуляева"],
  ["468213",32000,"Гуляева"],
  ["468214",72000,"Гуляева"],
  ["468215",72000,"Гуляева"],
  ["468216",32000,"Гуляева"],
  ["468238",28000,"Цегельников"],
  ["468239",28000,"Цегельников"],
  ["468230",28000,"Цегельников"],
  ["468248",28000,"Савиток"],
  ["468282",35000,"Прус-Роскошный"],
  ["468283",35000,"Прус-Роскошный"],
  ["468287",131271,"Ахтамова"],
  ["467203",20000,"Прус-Роскошный"],
  ["468927",0,"Савиток"],
  ["468928",0,"Савиток"],
  ["468254",74000,"Цегельников"],
  ["468284",66000,"Прус-Роскошный"],
  ["468257",0,"Цегельников"],
  ["468249",30000,"Цегельников"],
  ["468251",200000,"Цегельников"],
  ["468244",90000,"Цегельников"],
  ["468246",28000,"Цегельников"],
  ["468247",28000,"Цегельников"],
  ["468231",47250,"Савиток"],
  ["468242",90000,"Цегельников"],
  ["468240",28000,"Савиток"],
  ["468217",72000,"Гуляева"],
  ["468218",72000,"Гуляева"],
  ["468220",56000,"Гуляева"],
  ["468221",40000,"Савиток"],
  ["468222",32000,"Гуляева"],
  ["468206",1600000,"Ахтамова"],
  ["468224",14000,"Савиток"],
  ["468225",28000,"Гуляева"],
  ["468234",35000,"Савиток"],
  ["468235",35000,"Савиток"],
  ["468236",35000,"Савиток"],
  ["468237",35000,"Савиток"],
  ["468229",45562,"Савиток"],
  ["468205",350000,"Гуштюк"],
  ["468080",46480,"Савиток"],
  ["468297",48000,"Сильчев"],
  ["468298",27000,"Сильчев"],
  ["468299",200000,"Сильчев"],
  ["468300",200000,"Сильчев"],
  ["468301",43600,"Сильчев"],
  ["468060",30000,"Савиток"],
  ["468302",0,"Сильчев"],
  ["468303",0,"Сильчев"],
  ["468316",0,"Ахтамова"],
  ["468319",20000,"Кан"],
  ["468228",53000,"Савиток"],
  ["468226",28000,"Савиток"],
  ["468207",355000,"Ахтамова"],
  ["468223",28000,"Савиток"],
  ["468241",200000,"Савиток"],
  ["468243",128000,"Савиток"],
  ["468245",140000,"Савиток"],
  ["468253",35000,"Савиток"],
  ["468250",36000,"Савиток"],
  ["468258",43875,"Савиток"],
  ["468259",25000,"Савиток"],
  ["468261",25000,"Савиток"],
  ["468285",66000,"Прус-Роскошный"],
  ["468255",35000,"Савиток"],
  ["468256",35000,"Савиток"],
  ["468926",0,"Савиток"],
  ["468959",110000,"Савиток"],
  ["468956",55000,"Савиток"],
  ["468288",28000,"Савиток"],
  ["468286",66000,"Прус-Роскошный"],
  ["468262",56000,"Савиток"],
  ["468263",95000,"Савиток"],
  ["468264",95000,"Савиток"],
  ["468265",95000,"Савиток"],
  ["468266",95000,"Савиток"],
  ["468268",300000,"Савиток"],
  ["468269",28000,"Савиток"],
  ["468270",25000,"Савиток"],
  ["468358",45000,"Филипчук"],
  ["468377",34000,"Гуляева"],
  ["468378",38000,"Гуляева"],
  ["468381",35000,"Цегельников"],
  ["468382",70000,"Цегельников"],
  ["468427",138180,"Ахтамова"],
  ["468428",6000,"Махура"],
  ["468400",31500,"Прус-Роскошный"],
  ["468403",115000,"Прус-Роскошный"],
  ["468406",35000,"Прус-Роскошный"],
  ["468413",45000,"Ахтамова"],
  ["468416",20000,"Махура"],
  ["468417",165816,"Ахтамова"],
  ["468420",0,"Ахтамова"],
  ["468421",7500,"Махура"],
  ["468679",28000,"Васин"],
  ["468317",30000,"Махура"],
  ["468292",0,"Ахтамова"],
  ["468306",35000,"Махура"],
  ["468315",35000,"Махура"],
  ["469389",0,"Ахтамова"],
  ["469248",20000,"Суркова"],
  ["468471",48000,"Гуляева"],
  ["468472",48000,"Гуляева"],
  ["468473",28000,"Цегельников"],
  ["468474",28000,"Цегельников"],
  ["468475",75000,"Цегельников"],
  ["468414",33000,"Савиток"],
  ["468401",37500,"Прус-Роскошный"],
  ["468402",35000,"Прус-Роскошный"],
  ["468487",66000,"Прус-Роскошный"],
  ["468514",80000,"Прус-Роскошный"],
  ["468519",115000,"Прус-Роскошный"],
  ["468520",56000,"Васин"],
  ["468559",49000,"Котельников"],
  ["468560",34500,"Котельников"],
  ["468561",34500,"Котельников"],
  ["468565",20000,"Суркова"],
  ["468566",50000,"Суркова"],
  ["468569",20000,"Суркова"],
  ["468571",20000,"Суркова"],
  ["468436",67000,"Филипчук"],
  ["468438",67000,"Филипчук"],
  ["468439",46000,"Филипчук"],
  ["468441",46000,"Филипчук"],
  ["468442",46000,"Филипчук"],
  ["468443",46000,"Филипчук"],
  ["468444",28000,"Филипчук"],
  ["468448",48500,"Шейко"],
  ["468449",35500,"Ахтамова"],
  ["468450",35500,"Ахтамова"],
  ["468451",35500,"Ахтамова"],
  ["468458",32000,"Ахтамова"],
  ["468459",27000,"Савиток"],
  ["468460",46480,"Савиток"],
  ["468461",85000,"Савиток"],
  ["468399",66000,"Прус-Роскошный"],
  ["468960",110000,"Савиток"],
  ["468961",110000,"Савиток"],
  ["468957",55000,"Савиток"],
  ["468705",65000,"Цегельников"],
  ["468706",50000,"Цегельников"],
  ["468707",65000,"Цегельников"],
  ["468708",65000,"Цегельников"],
  ["468462",27000,"Савиток"],
  ["468463",28000,"Савиток"],
  ["468464",28000,"Савиток"],
  ["468465",28000,"Савиток"],
  ["468466",56000,"Савиток"],
  ["468467",112000,"Савиток"],
  ["468468",28000,"Савиток"],
  ["468469",28000,"Савиток"],
  ["468470",27000,"Савиток"],
  ["468535",25000,"Савиток"],
  ["468536",25000,"Савиток"],
  ["468515",80000,"Прус-Роскошный"],
  ["468492",85000,"Филипчук"],
  ["468504",35000,"Прус-Роскошный"],
  ["468483",840000,"Цуцурин"],
  ["468484",7560000,"Цуцурин"],
  ["468485",66000,"Прус-Роскошный"],
  ["468486",47000,"Прус-Роскошный"],
  ["468580",35500,"Ахтамова"],
  ["468581",35500,"Ахтамова"],
  ["468582",35500,"Ахтамова"],
  ["468585",35500,"Ахтамова"],
  ["468586",200000,"Гуштюк"],
  ["468588",100000,"Гуштюк"],
  ["468681",36000,"Кан"],
  ["468682",24000,"Кан"],
  ["468683",20000,"Кан"],
  ["468684",20000,"Кан"],
  ["468685",20000,"Кан"],
  ["468686",20000,"Кан"],
  ["468687",20000,"Кан"],
  ["468607",151998,"Ахтамова"],
  ["468609",165816,"Ахтамова"],
  ["468610",43000,"Котельников"],
  ["468612",32000,"Котельников"],
  ["468615",51000,"Котельников"],
  ["468616",27000,"Котельников"],
  ["468619",33000,"Гуляева"],
  ["468621",37000,"Прус-Роскошный"],
  ["468622",120000,"Прус-Роскошный"],
  ["468623",80000,"Филипчук"],
  ["468624",30000,"Филипчук"],
  ["468625",48000,"Филипчук"],
  ["467442",28000,"Гуштюк"],
  ["467443",28000,"Гуштюк"],
  ["467444",28000,"Гуштюк"],
  ["468626",150000,"Ахтамова"],
  ["468627",90000,"Ахтамова"],
  ["468628",38000,"Филипчук"],
  ["468629",40000,"Ахтамова"],
  ["468630",40000,"Ахтамова"],
  ["468631",76000,"Филипчук"],
  ["468632",31000,"Филипчук"],
  ["468599",47250,"Савиток"],
  ["468693",30000,"Махура"],
  ["468699",199000,"Ахтамова"],
  ["468700",180000,"Ахтамова"],
  ["468701",35000,"Ахтамова"],
  ["468703",35000,"Прус-Роскошный"],
  ["468601",25000,"Савиток"],
  ["468602",50000,"Савиток"],
  ["468603",40500,"Савиток"],
  ["468634",340000,"Филипчук"],
  ["468635",285000,"Филипчук"],
  ["468636",275000,"Филипчук"],
  ["468637",267000,"Филипчук"],
  ["468638",270000,"Филипчук"],
  ["468867",30000,"Гуляева"],
  ["468590",56000,"Савиток"],
  ["468591",28000,"Савиток"],
  ["468593",30000,"Савиток"],
  ["468594",30000,"Савиток"],
  ["468595",31840,"Савиток"],
  ["468596",31840,"Савиток"],
  ["468597",31840,"Савиток"],
  ["468598",42000,"Савиток"],
  ["468710",135000,"Гуштюк"],
  ["468711",90000,"Цегельников"],
  ["468712",50000,"Цегельников"],
  ["468713",40000,"Цегельников"],
  ["468714",135000,"Гуштюк"],
  ["468715",55000,"Цегельников"],
  ["468716",68000,"Цегельников"],
  ["468823",30000,"Гуляева"],
  ["468717",30000,"Цегельников"],
  ["468718",30000,"Котельников"],
  ["468719",30000,"Котельников"],
  ["468720",25000,"Котельников"],
  ["468721",35000,"Котельников"],
  ["468722",25000,"Котельников"],
  ["468963",28000,"Савиток"],
  ["469078",31000,"Филипчук"],
  ["468923",0,""],
  ["468911",20000,"Кан"],
  ["468907",27200,"Сильчев"],
  ["468908",20000,"Сильчев"],
  ["468909",0,"Ахтамова"],
  ["468905",50000,"Сильчев"],
  ["468947",35000,"Прус-Роскошный"],
  ["468964",84000,"Савиток"],
  ["468962",55000,"Савиток"],
  ["468726",42000,"Савиток"],
  ["468727",28000,"Савиток"],
  ["468729",56000,"Савиток"],
  ["468731",58000,"Савиток"],
  ["468732",28000,"Савиток"],
  ["468734",28000,"Савиток"],
  ["468736",28000,"Савиток"],
  ["468740",28000,"Савиток"],
  ["468766",31000,"Филипчук"],
  ["468767",31000,"Филипчук"],
  ["468774",138180,"Ахтамова"],
  ["468775",80000,"Ахтамова"],
  ["468776",69000,"Гусейнова"],
  ["468777",0,"Гуштюк"],
  ["468780",69000,"Гусейнова"],
  ["468781",69000,"Гусейнова"],
  ["468782",69000,"Гусейнова"],
  ["468783",77000,"Гусейнова"],
  ["468784",77000,"Гусейнова"],
  ["468785",77000,"Гусейнова"],
  ["468786",77000,"Гусейнова"],
  ["468802",29000,"Прус-Роскошный"],
  ["468803",30000,"Прус-Роскошный"],
  ["468804",170000,"Филипчук"],
  ["468806",170000,"Филипчук"],
  ["468807",25000,"Ахтамова"],
  ["468824",55000,"Гуляева"],
  ["468825",30000,"Котельников"],
  ["468842",25000,"Гуштюк"],
  ["468814",65000,"Цегельников"],
  ["468815",70000,"Цегельников"],
  ["468816",28000,"Цегельников"],
  ["468817",28000,"Цегельников"],
  ["468818",28000,"Цегельников"],
  ["468819",28000,"Цегельников"],
  ["468820",28000,"Цегельников"],
  ["468958",55000,"Савиток"],
  ["466744",160000,"Гуштюк"],
  ["468639",31000,"Филипчук"],
  ["468600",80000,"Савиток"],
  ["467445",150000,"Гуштюк"],
  ["469247",20000,"Кан"],
  ["469367",0,"Гуштюк"],
  ["468869",37125,"Савиток"],
  ["468871",48937,"Савиток"],
  ["468872",50625,"Савиток"],
  ["468873",56000,"Савиток"],
  ["468860",45000,"Савиток"],
  ["468862",140000,"Савиток"],
  ["468864",35680,"Савиток"],
  ["469208",29000,"Прус-Роскошный"],
  ["469160",27000,"Котельников"],
  ["469161",15000,"Котельников"],
  ["468821",50000,"Цегельников"],
  ["468843",52000,"Шейко"],
  ["468847",90000,"Гуштюк"],
  ["468808",28000,"Ахтамова"],
  ["468809",28000,"Ахтамова"],
  ["468918",40000,"Суркова"],
  ["468919",0,"Савиток"],
  ["468921",0,"Савиток"],
  ["468922",0,"Савиток"],
  ["468910",40000,"Суркова"],
  ["468914",40000,"Суркова"],
  ["468906",180000,"Гусейнова"],
  ["468925",28000,"Суркова"],
  ["468929",28000,"Суркова"],
  ["468932",40000,"Суркова"],
  ["468845",31000,"Шейко"],
  ["468822",18000,"Цегельников"],
  ["469194",35000,"Савиток"],
  ["468894",109000,"Гусейнова"],
  ["468895",109000,"Гусейнова"],
  ["468896",109000,"Гусейнова"],
  ["468897",111000,"Гусейнова"],
  ["468874",56000,"Савиток"],
  ["468875",28000,"Савиток"],
  ["468877",28000,"Савиток"],
  ["468879",28000,"Савиток"],
  ["468880",28000,"Савиток"],
  ["468881",28000,"Савиток"],
  ["468882",56000,"Савиток"],
  ["468633",25000,"Филипчук"],
  ["469526",0,"Гусейнова"],
  ["469366",0,"Гусейнова"],
  ["469312",21000,"Суркова"],
  ["469315",34000,"Суркова"],
  ["469365",0,"Цегельников"],
  ["469568",0,""],
  ["468883",36400,"Савиток"],
  ["468884",36400,"Савиток"],
  ["468885",36400,"Савиток"],
  ["468886",36400,"Савиток"],
  ["468887",28000,"Савиток"],
  ["468888",28000,"Савиток"],
  ["468889",28000,"Савиток"],
  ["468890",28000,"Савиток"],
  ["468892",28000,"Савиток"],
  ["468848",151998,"Ахтамова"],
  ["468849",165816,"Ахтамова"],
  ["468853",28000,"Ахтамова"],
  ["468939",425000,"Цегельников"],
  ["468940",425000,"Цегельников"],
  ["468941",250000,"Цегельников"],
  ["468968",80000,"Цегельников"],
  ["468969",95000,"Цегельников"],
  ["468970",160000,"Цегельников"],
  ["468971",50000,"Цегельников"],
  ["468972",32000,"Цегельников"],
  ["468974",32000,"Цегельников"],
  ["468977",400000,"Цегельников"],
  ["468978",100000,"Цегельников"],
  ["468989",45000,"Котельников"],
  ["468990",73000,"Котельников"],
  ["468992",30000,"Котельников"],
  ["468993",30000,"Котельников"],
  ["469056",20000,"Сильчев"],
  ["468915",45000,"Савиток"],
  ["468912",28000,"Савиток"],
  ["468913",28000,"Савиток"],
  ["468948",125000,"Савиток"],
  ["468949",84000,"Савиток"],
  ["468950",15000,"Савиток"],
  ["468951",35000,"Савиток"],
  ["468952",28000,"Савиток"],
  ["468953",28000,"Савиток"],
  ["468954",76000,"Савиток"],
  ["468955",76000,"Савиток"],
  ["469070",0,"Ахтамова"],
  ["469073",0,"Ахтамова"],
  ["469076",43000,"Гусейнова"],
  ["469093",10000,"Савиток"],
  ["469110",28000,"Савиток"],
  ["469121",80000,"Гуштюк"],
  ["469134",75000,"Гуляева"],
  ["469138",30000,"Гуляева"],
  ["469139",28000,"Гуляева"],
  ["469146",28000,"Гуляева"],
  ["469147",40250,"Гуляева"],
  ["469156",42000,"Филипчук"],
  ["469157",48000,"Филипчук"],
  ["468984",29000,"Савиток"],
  ["468985",29000,"Савиток"],
  ["468986",29000,"Савиток"],
  ["468903",190000,"Гусейнова"],
  ["468904",190000,"Гусейнова"],
  ["469185",50000,"Цегельников"],
  ["469186",66000,"Цегельников"],
  ["469187",74000,"Цегельников"],
  ["468899",77000,"Гусейнова"],
  ["468900",77000,"Гусейнова"],
  ["468902",109000,"Гусейнова"],
  ["469270",0,"Ахтамова"],
  ["469271",0,"Ахтамова"],
  ["469272",0,"Ахтамова"],
  ["469273",0,"Ахтамова"],
  ["469278",0,"Гусейнова"],
  ["469220",0,"Васин"]
];

function diagnoseJuneCompanyWide() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const archive = ss.getSheetByName(ORDERS_ARCHIVE_PFX + '2026-06');
  if (!archive || archive.getLastRow() < 5) { Logger.log('Нет архива за 2026-06'); return; }
  const allData = archive.getDataRange().getValues();
  const headerIdx = findOrdersHeaderRowIndex_(allData);
  const headerRow = allData[headerIdx];
  let numCol = -1;
  headerRow.forEach(function(h, i) { if (String(h || '').trim() === 'Номер') numCol = i; });
  let sumCol = -1;
  headerRow.forEach(function(h, i) { if (String(h || '').trim() === 'Сумма') sumCol = i; });
  if (numCol < 0 || sumCol < 0) { Logger.log('Не найдены колонки Номер/Сумма в архиве'); return; }

  const ourMap = {};
  let ourTotal = 0, ourRows = 0;
  allData.slice(headerIdx + 1).forEach(function(row) {
    const id = normalizeOrderId_(row[numCol]);
    if (!id) return;
    const amount = parseFloat(row[sumCol]) || 0;
    ourMap[id] = (ourMap[id] || 0) + amount;
    ourTotal += amount;
    ourRows++;
  });

  const refMap = {}, refMgr = {};
  let refTotal = 0;
  JUNE_REFERENCE.forEach(function(r) { var rid = normalizeOrderId_(r[0]); refMap[rid] = r[1]; refMgr[rid] = r[2]; refTotal += r[1]; });

  Logger.log('Строк в архиве Заказы_2026-06: ' + ourRows + ' (всего строк листа, включая другие отделы)');
  Logger.log('Заказов в выгрузке 1С (эталон, отдел Тралы): ' + JUNE_REFERENCE.length);
  Logger.log('Сумма по выгрузке 1С (эталон): ' + refTotal);
  Logger.log('Сумма совпавших заказов у нас: считаем ниже по каждому найденному');

  const missing = [], mismatched = [];
  const missingByMgr = {};
  let foundSum = 0;
  Object.keys(refMap).forEach(function(id) {
    if (!(id in ourMap)) {
      missing.push(id + ' (' + refMap[id] + '₽, ' + refMgr[id] + ')');
      missingByMgr[refMgr[id]] = (missingByMgr[refMgr[id]] || 0) + refMap[id];
    } else {
      foundSum += ourMap[id];
      if (Math.abs(ourMap[id] - refMap[id]) > 1) {
        mismatched.push(id + ' (' + refMgr[id] + '): 1С=' + refMap[id] + ' у нас=' + ourMap[id]);
      }
    }
  });

  Logger.log('Сумма найденных совпадений у нас: ' + foundSum);
  Logger.log('ИТОГО отсутствует у нас (' + missing.length + ' заказов, ' + (refTotal - foundSum) + '₽):');
  missing.forEach(function(m) { Logger.log('  ' + m); });
  Logger.log('НЕСОВПАДЕНИЯ по сумме (' + mismatched.length + '): ' + (mismatched.join('; ') || '-'));
  Logger.log('--- Отсутствующая сумма по менеджерам ---');
  Object.keys(missingByMgr).sort(function(a,b){ return missingByMgr[b]-missingByMgr[a]; }).forEach(function(mgr) {
    Logger.log(mgr + ': ' + missingByMgr[mgr] + '₽');
  });
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
  let toWrite = data;
  if (archive && archive.getLastRow() >= 5) {
    toWrite = mergeRawOrderRows_(archive.getDataRange().getValues(), data);
  }
  if (archive) archive.clear();
  else archive = ss.insertSheet(archiveName);
  if (toWrite.length > 0) {
    archive.getRange(1, 1, toWrite.length, toWrite[0].length).setValues(toWrite);
  }
}

// ── НОРМАЛИЗАЦИЯ: Заказы_сырые → Заказы_данные ──────────────

function normalizeOrders() {
  const ss  = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const raw = ss.getSheetByName(ORDERS_RAW_SHEET);
  if (!raw || raw.getLastRow() < 5) throw new Error('Нет сырых данных заказов');

  const parsed = parseOrdersRawRows(raw.getDataRange().getValues());

  // Проверяем результат ПЕРЕД тем, как трогать лист (Влад, 2026-07-24: "куда-то пропали все
  // данные" - раньше norm.clear() шёл ДО этой проверки, поэтому битый/пустой сырой отчёт
  // (изменился формат, съехали заголовки) стирал вчерашние рабочие "Заказы_данные" и не
  // писал взамен ничего, кроме заголовков - весь "Обзор заказов"/"По менеджерам" обнулялся
  // до следующего успешного прогона). Если сегодня разобрать нечего - оставляем лист как
  // есть (вчерашние, чуть устаревшие, но живые данные) вместо того, чтобы обнулить дашборд.
  if (parsed.rows.length === 0) throw new Error('Заказы не распознаны (0 строк) - лист ' + ORDERS_NORM_SHEET + ' не тронут, остались прежние данные');

  let norm = ss.getSheetByName(ORDERS_NORM_SHEET);
  // Слияние с уже сохранёнными строками ДО очистки листа - иначе заказ, который сегодняшний
  // отчёт 1С почему-то не прислал, но который мы уже видели раньше, потерялся бы навсегда
  // (см. mergeNormalizedOrderRows_ выше и plans/2026-08-06-orders-import-merge-not-replace.md).
  const existingRows = (norm && norm.getLastRow() > 1)
    ? norm.getRange(2, 1, norm.getLastRow() - 1, parsed.headers.length).getValues()
    : [];
  const mergedRows = mergeNormalizedOrderRows_(existingRows, parsed.rows);

  if (norm) norm.clear();
  else       norm = ss.insertSheet(ORDERS_NORM_SHEET);

  norm.getRange(1, 1, 1, parsed.headers.length)
      .setValues([parsed.headers])
      .setFontWeight('bold')
      .setBackground('#1e1e26')
      .setFontColor('#888780');

  norm.getRange(2, 1, mergedRows.length, parsed.headers.length).setValues(mergedRows);
  // Числовые колонки: Сумма → Оплачено поставщику (колонки 31-40, индексы 30-39). Диапазон -
  // по mergedRows.length (не parsed.rows.length) - иначе строки, сохранённые слиянием из
  // прошлого прогона, останутся без числового формата.
  norm.getRange(2, 31, mergedRows.length, 10).setNumberFormat('#,##0');

  norm.setFrozenRows(1);
  norm.autoResizeColumns(1, 7);

  Logger.log('✅ Заказы нормализованы: ' + mergedRows.length + ' строк в ' + ORDERS_NORM_SHEET +
    ' (из них новых/обновлённых из сегодняшнего отчёта: ' + parsed.rows.length + ')');
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

  // "Вариант расчёта" добавлен В КОНЕЦ (не между существующими) - чтобы не сдвигать
  // индексы колонки C в aggregateOrdersRows() и хардкод "43" в чтении ORDERS_NORM_SHEET
  // (Влад, 2026-07-16: "строчки где вариант расчета Прочее - служебные, не коммерческие,
  // не должны участвовать в документообороте/воронке"). В сыром отчёте 1С колонка может
  // называться "Вариант расчета" или "Вариант расчёта" - пробуем оба варианта написания.
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
    'Договор', 'Отдел траллов', 'Месяц', 'Вариант расчёта'
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
      monthKey,
      str(row, 'Вариант расчета') || str(row, 'Вариант расчёта')
    ]);
  }

  return { headers: normHeaders, rows: rows };
}




// РАЗОВЫЙ ДИАГНОСТИЧЕСКИЙ ХЕЛПЕР (2026-08-06, параметризован по месяцу): проверка задвоения
// в архиве Заказы_YYYY-MM - в июле весь датасет (1133 заказа) оказался записан дважды подряд
// (2266 строк, суммы копий совпадали 1:1) - уже исправлено (dedupeJulyArchive). Причина
// первичной порчи не установлена железно (первая версия mergeRawOrderRows_ была не совсем
// верной - позиция колонки "Номер" бралась только из НОВОГО отчёта и ошибочно применялась и
// к старым строкам - исправлено), но фикс на mergeRawOrderRows_/mergeNormalizedOrderRows_
// теперь дедуплицирует по номеру при каждой записи - новых задвоений быть не должно. Эта
// функция проверяет ФАКТ на любой месяц: считает заказы по номеру, ищет дубли и "мусорные"
// номера (не похожие на настоящий номер заказа - не 4-8-значное число).
// РАЗОВЫЙ ДИАГНОСТИЧЕСКИЙ ХЕЛПЕР (2026-08-06, только читает): почему "маржа найма логистов"
// у Рыщанова (сумма hired_margin_qualified по ЛОГИСТАМ - Васин/Кан/Махура/Сильчев/
// Прус-Роскошный/Суркова) меньше, чем "Маржа" в таблице "Наёмная техника" (вся компания
// целиком, по поставщику найма, без разбора кто вёл заказ снабжением). Влад, 2026-08-06:
// "непонятно, почему расчёт идёт от 1,2 миллиона, если наёмом сделали 1.7". Группирует
// прибыль по наёмным заказам ЗА МЕСЯЦ по значению "Менеджер по снабжению" - показывает, куда
// делась разница (обычно это заказы, где снабжением занимался сам менеджер продаж/руководитель,
// а не штатный логист, либо поле вообще пустое).
function diagnoseLogistMarginGap(month) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const archive = ss.getSheetByName(ORDERS_ARCHIVE_PFX + month);
  if (!archive || archive.getLastRow() < 5) { Logger.log('Нет архива за ' + month); return; }
  const rows = parseOrdersRawRows(archive.getDataRange().getValues()).rows;

  const byMgrL = {};
  let totalHiredProfit = 0, hiredCount = 0;
  const LOGIST_LIST = ['Васин', 'Кан', 'Махура', 'Сильчев', 'Прус-Роскошный', 'Суркова'];
  rows.forEach(function(row) {
    const hiredRaw = String(row[27] || '').trim(); // индекс "hired" в нормализованном формате
    const isHired = hiredRaw !== '' && hiredRaw !== 'Нет';
    if (!isHired) return;
    hiredCount++;
    const profit = parseFloat(row[35]) || 0; // индекс "profit"
    totalHiredProfit += profit;
    const mgrL = String(row[16] || '').trim() || '(пусто)'; // индекс "mgr_l"
    byMgrL[mgrL] = (byMgrL[mgrL] || 0) + profit;
  });

  let logistSum = 0;
  Object.keys(byMgrL).forEach(function(name) {
    if (LOGIST_LIST.some(function(l) { return name.indexOf(l) >= 0; })) logistSum += byMgrL[name];
  });

  Logger.log('Наёмных заказов: ' + hiredCount + ', сумма Прибыль по всем: ' + totalHiredProfit);
  Logger.log('Из них у "штатных" логистов (' + LOGIST_LIST.join('/') + '): ' + logistSum);
  Logger.log('Разница (не у логистов - у менеджеров/руководителей/пусто): ' + (totalHiredProfit - logistSum));
  Logger.log('--- Разбивка по "Менеджер по снабжению" ---');
  Object.keys(byMgrL).sort(function(a,b){ return byMgrL[b]-byMgrL[a]; }).forEach(function(name) {
    Logger.log(name + ': ' + byMgrL[name]);
  });
}

function diagnoseLogistMarginGapJuly() { return diagnoseLogistMarginGap('2026-07'); }

// РАЗОВЫЙ ДИАГНОСТИЧЕСКИЙ ХЕЛПЕР (2026-08-07, только читает): вызывает ТУ ЖЕ САМУЮ функцию,
// что и настоящий дашборд (aggregateOrdersRows), на архиве Заказы_2026-07 - чтобы сверить
// qualMarginAllLogists (база 2% Рыщанова) напрямую, без риска расхождения между диагностикой
// и реальным расчётом (как уже было с diagnoseLogistMarginGap - там своя отдельная логика).
// Печатает: общую квалифицирующую маржу найма по компании (summary), сумму по каждому
// логисту из by_logist (после фикса TRAL_LOGISTS - Суркова снова должна быть) и их сумму,
// чтобы сравнить с company-wide.
function diagnoseLogistMarginConsistencyJuly() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const archive = ss.getSheetByName(ORDERS_ARCHIVE_PFX + '2026-07');
  if (!archive || archive.getLastRow() < 5) { Logger.log('Нет архива за 2026-07'); return; }
  const rows = parseOrdersRawRows(archive.getDataRange().getValues()).rows;
  const result = aggregateOrdersRows(rows);
  const s = result.summary;

  Logger.log('Строк в архиве: ' + rows.length);
  Logger.log('summary.hired_profit (вся маржа найма по компании): ' + s.hired_profit);
  Logger.log('summary.hired_margin_pct: ' + (s.hired_margin_pct * 100).toFixed(1) + '%');
  Logger.log('summary.hired_margin_qualifies: ' + s.hired_margin_qualifies);

  let logistSum = 0, logistSumQual = 0;
  Logger.log('--- by_logist ---');
  (result.by_logist || []).forEach(function(l) {
    logistSum += l.hired_margin_qualified + l.hired_margin_unqualified;
    logistSumQual += l.hired_margin_qualified;
    Logger.log(l.name + ': всего маржи найма=' + (l.hired_margin_qualified + l.hired_margin_unqualified) +
      ' (квалиф.=' + l.hired_margin_qualified + ', неквалиф.=' + l.hired_margin_unqualified + ')');
  });
  Logger.log('Сумма по всем логистам (всего): ' + logistSum);
  Logger.log('Сумма по всем логистам (только квалиф. - это и есть база 2% Рыщанова): ' + logistSumQual);
  Logger.log('Разница с summary.hired_profit: ' + (s.hired_profit - logistSum));
}

// РАЗОВЫЙ ДИАГНОСТИЧЕСКИЙ ХЕЛПЕР (2026-08-10, только читает): Влад спросил "откуда у Шейко
// за июль 1300 в затратах". Колонка "Затраты" в зарплате (своего парка, не найм) = own_amount
// минус own_profit, то есть сумма (amount - Прибыль) по ВСЕМ её заказам БЕЗ найма за месяц -
// три статьи затрат 1С (Вознаграждение 1/2, Спецразрешение и НДС-корректировки), выведенные
// обратным счётом (см. m.own_profit в aggregateOrdersRows). Печатает построчно каждый такой
// заказ, чтобы найти, какой именно дал разницу. Запускать вручную (Выполнить в редакторе),
// параметр - фамилия и период, чтобы использовать повторно для любого сотрудника/месяца.
function diagnoseOwnCostsForManager(managerSur, period) {
  managerSur = (managerSur || 'Шейко').trim().toLowerCase();
  period = period || '2026-07';
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const archive = ss.getSheetByName(ORDERS_ARCHIVE_PFX + period);
  if (!archive || archive.getLastRow() < 5) { Logger.log('Нет архива за ' + period); return; }
  const rows = parseOrdersRawRows(archive.getDataRange().getValues()).rows;

  let total = 0, count = 0;
  Logger.log('Заказы своего парка (БЕЗ найма) - ' + managerSur + ', ' + period + ':');
  rows.forEach(function(row) {
    // По ВХОЖДЕНИЮ фамилии, не точное равенство - в 1С "Менеджер продаж" (mgr_s) хранится
    // как полное ФИО ("Шейко Елена"), не одна фамилия (та же логика, что ordInList/TRAL_MANAGERS
    // использует в самом дашборде для сопоставления). Первый прогон (2026-08-10) с точным
    // равенством дал 0 заказов именно поэтому - не баг дашборда, баг этой диагностики.
    if (String(row[15] || '').trim().toLowerCase().indexOf(managerSur) < 0) return; // mgr_s
    const hiredRaw = String(row[27] || '').trim(); // Найм
    if (hiredRaw !== 'Нет' && hiredRaw !== '') return; // затраты своего парка - только НЕ-наёмные заказы
    const amount = parseFloat(row[30]) || 0; // Сумма
    const profit = parseFloat(row[35]) || 0; // Прибыль
    const diff = amount - profit;
    total += diff;
    count++;
    if (diff) Logger.log('Заказ №' + row[0] + ': Сумма=' + amount + ', Прибыль=' + profit + ', разница=' + diff);
  });
  Logger.log('Всего заказов своего парка: ' + count);
  Logger.log('ИТОГО разница (это и есть "Затраты" в зарплате): ' + total);
}

function diagnoseSheykoJulyOwnCosts() { return diagnoseOwnCostsForManager('Шейко', '2026-07'); }

function diagnoseArchiveDuplicates(month) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(ORDERS_ARCHIVE_PFX + month);
  if (!sheet) { Logger.log('Нет листа ' + ORDERS_ARCHIVE_PFX + month); return; }
  const allData = sheet.getDataRange().getValues();
  const headerIdx = findOrdersHeaderRowIndex_(allData);
  const headerRow = allData[headerIdx];
  let numCol = -1, sumCol = -1, custCol = -1, mgrCol = -1;
  headerRow.forEach(function(h, i) {
    var k = String(h || '').trim();
    if (k === 'Номер') numCol = i;
    if (k === 'Сумма') sumCol = i;
    if (k === 'Заказчик') custCol = i;
    if (k === 'Менеджер по продажам') mgrCol = i;
  });
  Logger.log('Колонки: Номер=' + numCol + ' Сумма=' + sumCol + ' Заказчик=' + custCol + ' Менеджер=' + mgrCol);
  if (numCol < 0) { Logger.log('Колонка "Номер" не найдена'); return; }

  const rows = allData.slice(headerIdx + 1);
  Logger.log('Всего строк данных в листе: ' + rows.length);

  const byId = {};
  let garbageCount = 0;
  const garbageSample = [];
  rows.forEach(function(row, i) {
    const id = normalizeOrderId_(row[numCol]);
    if (!id) return;
    if (!/^\d{4,8}$/.test(id)) {
      garbageCount++;
      if (garbageSample.length < 10) garbageSample.push('строка ' + (i+headerIdx+2) + ': "' + id + '" (Сумма=' + row[sumCol] + ', Заказчик=' + row[custCol] + ')');
    }
    if (!byId[id]) byId[id] = [];
    byId[id].push({ row: i+headerIdx+2, amount: parseFloat(row[sumCol])||0, customer: String(row[custCol]||''), mgr: String(row[mgrCol]||'') });
  });

  const dupIds = Object.keys(byId).filter(function(id){ return byId[id].length > 1; });
  Logger.log('Уникальных номеров заказов: ' + Object.keys(byId).length);
  Logger.log('Номеров с ДУБЛЯМИ (>1 строки на один номер): ' + dupIds.length);
  Logger.log('Строк с "мусорным" номером (не 4-8-значное число): ' + garbageCount);
  garbageSample.forEach(function(g) { Logger.log('  мусор: ' + g); });

  let dupExtraSum = 0;
  dupIds.slice(0, 20).forEach(function(id) {
    const entries = byId[id];
    const sum = entries.reduce(function(s,e){ return s+e.amount; }, 0);
    dupExtraSum += sum - entries[0].amount; // сколько лишнего сверх одной копии
    Logger.log('Дубль №' + id + ' (' + entries.length + ' раз): ' + entries.map(function(e){ return 'стр.'+e.row+'='+e.amount+'₽/'+e.mgr; }).join(' | '));
  });
  Logger.log('Итого "лишней" суммы от дублей (по первым 20 показанным): ' + dupExtraSum);

  return { totalRows: rows.length, uniqueIds: Object.keys(byId).length, dupCount: dupIds.length, garbageCount: garbageCount };
}

function diagnoseJulyArchiveDuplicates() { return diagnoseArchiveDuplicates('2026-07'); }
function diagnoseJuneArchiveDuplicates() { return diagnoseArchiveDuplicates('2026-06'); }

// РАЗОВЫЙ ХЕЛПЕР ОЧИСТКИ (2026-08-06, параметризован по месяцу): убирает дубли из архива
// Заказы_YYYY-MM, найденные diagnoseArchiveDuplicates - оставляет ПЕРВОЕ вхождение каждого
// номера заказа, остальное отбрасывает. Безопасно только когда копии идентичны (как в июле -
// суммы совпадали 1:1); если найдутся дубли с РАЗНЫМИ суммами - функция всё равно оставит
// первую версию и отбросит остальные, проверьте лог diagnoseArchiveDuplicates заранее, что
// это не тот случай. Идемпотентна - повторный запуск на уже чистом листе ничего не изменит.
// Удалить после проверки результата.
function dedupeArchive(month) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(ORDERS_ARCHIVE_PFX + month);
  if (!sheet) { Logger.log('Нет листа ' + ORDERS_ARCHIVE_PFX + month); return; }
  const allData = sheet.getDataRange().getValues();
  const headerIdx = findOrdersHeaderRowIndex_(allData);
  const headerRow = allData[headerIdx];
  let numCol = -1;
  headerRow.forEach(function(h, i) { if (String(h || '').trim() === 'Номер') numCol = i; });
  if (numCol < 0) { Logger.log('Колонка "Номер" не найдена'); return; }

  const headerRows = allData.slice(0, headerIdx + 1);
  const dataRows = allData.slice(headerIdx + 1);

  const seen = {};
  const keep = [];
  let dropped = 0;
  dataRows.forEach(function(row) {
    const id = normalizeOrderId_(row[numCol]);
    if (id && seen[id]) { dropped++; return; } // уже видели этот номер - вторая (и далее) копия отбрасывается
    if (id) seen[id] = true;
    keep.push(row);
  });

  Logger.log('Было строк: ' + dataRows.length + ', уникальных номеров: ' + Object.keys(seen).length + ', отброшено дублей: ' + dropped);

  if (dropped === 0) { Logger.log('Дублей не найдено - лист не тронут'); return { before: dataRows.length, after: keep.length, dropped: 0 }; }

  sheet.clear();
  const finalData = headerRows.concat(keep);
  sheet.getRange(1, 1, finalData.length, finalData[0].length).setValues(finalData);
  Logger.log('✅ Готово. Строк в листе теперь: ' + finalData.length + ' (было ' + allData.length + ')');
  return { before: dataRows.length, after: keep.length, dropped: dropped };
}

function dedupeJulyArchive() { return dedupeArchive('2026-07'); }
function dedupeJuneArchive() { return dedupeArchive('2026-06'); }



// ── API ДЛЯ ДАШБОРДА ─────────────────────────────────────────
// Вызывается из doGet() основного скрипта: orders: getOrdersData(ss)

function getOrdersData(ss) {
  const norm = ss.getSheetByName(ORDERS_NORM_SHEET);
  if (!norm || norm.getLastRow() < 2) return { error: 'Нет данных заказов' };

  const rows = norm.getRange(2, 1, norm.getLastRow() - 1, 44).getValues();
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

// Строки заказов за месяц в формате, который ожидает aggregateOrdersRows/computeLostCustomers_
// (C-карта: customer:9, date_s:2, internal:13, mgr_s:15, amount:30) - живой месяц (Заказы_данные)
// уже в этом формате, архивные листы ("Заказы_YYYY-MM") нужно нормализовать через
// parseOrdersRawRows (тот же приём, что getOrdersData/getOrdersDataForPeriod).
function readOrdersRowsForMonth_(ss, monthKey, isLiveMonth) {
  if (isLiveMonth) {
    var norm = ss.getSheetByName(ORDERS_NORM_SHEET);
    if (!norm || norm.getLastRow() < 2) return [];
    return norm.getRange(2, 1, norm.getLastRow() - 1, 44).getValues();
  }
  var sheet = ss.getSheetByName(ORDERS_ARCHIVE_PFX + monthKey);
  if (!sheet || sheet.getLastRow() < 5) return [];
  return parseOrdersRawRows(sheet.getDataRange().getValues()).rows;
}

// Пропавшие клиенты - ЛИЧНАЯ версия для страницы менеджера (2026-08-12, Влад: "все кто
// заказывал у нас последние три месяца и не заказывал больше двух недель, приоритет по
// объёму выручки от большего к меньшему"). В отличие от company-wide computeLostCustomers_
// выше (2 месяца, сортировка по дням, топ-40, БЕЗ фильтра по менеджеру) - тут 3 месяца
// (monthKey + 2 предыдущих), отфильтровано на ОДНОГО менеджера (по фамилии - первое слово
// mgr_s), сортировка по выручке. monthKey - месяц-якорь ('YYYY-MM'), isLiveMonth - true, если
// monthKey это текущий календарный месяц (тогда читаем живой лист, не архив).
function computeLostCustomersForManager_(ss, monthKey, managerName, isLiveMonth) {
  const custMap = {};
  const surLower = String(managerName || '').trim().split(' ')[0].toLowerCase();

  function ingest(rows) {
    rows.forEach(function(row) {
      if (String(row[13] || '').trim() === 'Да') return; // внутренние перевозки не считаем
      const mgrSur = String(row[15] || '').trim().split(' ')[0].toLowerCase();
      if (mgrSur !== surLower) return; // только заказы ЭТОГО менеджера
      const cust = String(row[9] || '').trim();
      if (!cust) return;
      const rawDate = row[2];
      const dateStr = rawDate instanceof Date
        ? Utilities.formatDate(rawDate, 'Europe/Moscow', 'yyyy-MM-dd')
        : String(rawDate || '').trim();
      if (!custMap[cust]) custMap[cust] = { name: cust, last_date: '', orders_total: 0, amount_total: 0 };
      const c = custMap[cust];
      c.orders_total++;
      c.amount_total += ordParseNum(row[30]);
      if (dateStr && dateStr > c.last_date) c.last_date = dateStr;
    });
  }

  ingest(readOrdersRowsForMonth_(ss, monthKey, isLiveMonth));
  const parts = String(monthKey || '').split('-');
  let py = parseInt(parts[0], 10), pm = parseInt(parts[1], 10);
  for (let i = 0; i < 2; i++) { // ещё 2 предыдущих месяца (+ monthKey = 3 всего)
    pm -= 1;
    if (pm < 1) { pm = 12; py -= 1; }
    const pk = py + '-' + String(pm).padStart(2, '0');
    ingest(readOrdersRowsForMonth_(ss, pk, false));
  }

  const today = new Date();
  return Object.values(custMap)
    .map(function(c) {
      const days = c.last_date ? Math.floor((today - new Date(c.last_date)) / 86400000) : null;
      return { name: c.name, last_date: c.last_date, days_since: days, orders_total: c.orders_total, amount_total: c.amount_total };
    })
    .filter(function(c) { return c.days_since !== null && c.days_since >= 15; })
    .sort(function(a, b) { return b.amount_total - a.amount_total; });
}

// ── 5 ЗАДАЧ НА ДЕНЬ ОТ ИИ (2026-08-12, личная страница менеджера) ──────────────────────────
// Влад: у Васина уже есть 5 задач на день по жёсткому алгоритму (см.
// plans/2026-08-11-vasin-per-vehicle-forecast-tasks.md) - для менеджера хочет то же самое, но
// СГЕНЕРИРОВАННОЕ ИИ (GPT-5 через kie.ai, см. plans/2026-08-12-ai-daily-tasks-manager.md) по
// его личной ситуации: план/факт/прогноз, топ заказчиков, пропавшие клиенты, дебиторка.
//
// Кэш на день - reasoning-модель не мгновенная (~5-15 сек) и не бесплатная, звать её при
// каждом открытии страницы не нужно ("раз в день" - дословно просьба Влада). Один лист
// ИИ_Задачи_Менеджеров, одна строка на менеджера на календарный день (Europe/Moscow).
const AI_TASKS_SHEET = 'ИИ_Задачи_Менеджеров';
const KIE_GPT5_URL = 'https://api.kie.ai/codex/v1/responses';

function ensureAiTasksSheet_(ss) {
  let sheet = ss.getSheetByName(AI_TASKS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(AI_TASKS_SHEET);
    sheet.getRange(1, 1, 1, 6).setValues([['Дата', 'Менеджер', 'Задачи_JSON', 'Совет_по_плану', 'Модель', 'Сгенерировано_в']]).setFontWeight('bold');
  }
  return sheet;
}

// Линейный поиск строки на сегодня для этого менеджера - тот же приём, что
// findOrCreateDebtStatusRow_ (таблица маленькая, ~1 строка/менеджер/день, скан копеечный).
function findAiTasksCacheRow_(ss, dateKey, managerName) {
  const sheet = ss.getSheetByName(AI_TASKS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    const rDate = r[0] instanceof Date ? Utilities.formatDate(r[0], 'Europe/Moscow', 'yyyy-MM-dd') : String(r[0] || '').trim();
    if (rDate === dateKey && String(r[1] || '').trim() === managerName) {
      let tasks = [];
      try { tasks = JSON.parse(r[2] || '[]'); } catch (parseErr) { tasks = []; }
      return { tasks: tasks, plan_advice: String(r[3] || ''), model: String(r[4] || ''), generated_at: String(r[5] || '') };
    }
  }
  return null;
}

// Удаляет строку кэша на сегодня для этого менеджера, если есть (2026-08-12, Влад: "мы сделали
// много изменений... по Савитку была генерация раньше, это всё осталось в кэше... нужно
// обнулить" - кнопка "Сгенерировать заново" на фронтенде дёргает action=generate_ai_tasks с
// force=1, это и есть та точка, что стирает старую строку перед новой генерацией). Идёт снизу
// вверх - на случай, если в листе случайно оказалось больше одной строки на менеджера/день.
function deleteAiTasksCacheRow_(ss, dateKey, managerName) {
  const sheet = ss.getSheetByName(AI_TASKS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    const rDate = data[i][0] instanceof Date ? Utilities.formatDate(data[i][0], 'Europe/Moscow', 'yyyy-MM-dd') : String(data[i][0] || '').trim();
    if (rDate === dateKey && String(data[i][1] || '').trim() === managerName) {
      sheet.deleteRow(i + 2);
    }
  }
}

function saveAiTasksCache_(ss, dateKey, managerName, tasks, planAdvice, model) {
  const sheet = ensureAiTasksSheet_(ss);
  const now = new Date().toISOString();
  sheet.appendRow([dateKey, managerName, JSON.stringify(tasks), planAdvice, model, now]);
  return now;
}

// Честный порт calcPaceRatio_ из фронтенда (files/index.html) - единственный расчёт, который
// реально нужно дублировать для прогноза к концу месяца (остальной контекст берём из уже
// существующих бэкенд-функций, см. план). "Живой" месяц - текущий календарный (Apps Script
// всегда считает по актуальной дате, в отличие от фронтенда, которому нужен D.updated для
// защиты от локальных часов пользователя).
function calcPaceRatioServer_(period) {
  const now = new Date();
  const liveMonthKey = Utilities.formatDate(now, 'Europe/Moscow', 'yyyy-MM');
  let dim, dayOfMonth;
  if (period && period !== liveMonthKey) {
    const p = String(period).split('-').map(Number);
    dim = (p[0] && p[1]) ? new Date(p[0], p[1], 0).getDate() : 30;
    dayOfMonth = dim;
  } else {
    dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    dayOfMonth = now.getDate();
  }
  return dayOfMonth > 0 ? (dim / dayOfMonth) : 1;
}

// Русская дата "18 июля" (год - только если НЕ текущий, чтобы не загромождать свежие даты)
// вместо машинного "2026-07-18" (2026-08-12, Влад: "вместо 07.17.2026 лучше писать 18 июля,
// так человеку понятнее" - модель, получив голый ISO-формат, один раз перепутала его на
// американский MM/DD/YYYY). Честный порт fmtDateRu()/RU_MONTHS_GENITIVE из фронтенда - даты
// форматируются ЗДЕСЬ, на бэкенде, а не оставляются модели на откуп, чтобы не рисковать вторым
// таким же перепутыванием формата.
const RU_MONTHS_GENITIVE_ = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
function fmtDateRuServer_(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) return dateStr || '';
  const parts = String(dateStr).split('-');
  const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
  if (!m || !d || m < 1 || m > 12) return dateStr;
  const currentYear = new Date().getFullYear();
  return d + ' ' + RU_MONTHS_GENITIVE_[m-1] + (y !== currentYear ? ' ' + y : '');
}

// Компактный набор фактов о менеджере для промпта ИИ - ТОЛЬКО из уже существующих бэкенд-
// функций (не дублируем computeDebtAggregates_/фронтенд-агрегаты, достаточно топ-должников и
// итоговых сумм для содержательного совета).
//
// Уточнения от 2026-08-12 (Влад, разбор первой реальной генерации - см.
// plans/2026-08-12-ai-daily-tasks-manager.md, "Уточнения"): модель писала общие/неточные
// формулировки, потому что в контексте не хватало ДЕТАЛЕЙ (конкретный номер и дата документа
// по должнику, дата последнего заказа у пропавшего клиента, примеры конкретных проблемных
// заказов) - добавлены ниже, чтобы задачи ссылались на реальные записи, а не на голые суммы.
function buildManagerAiContext_(ss, orders, managerName, period) {
  const mgrRow = (orders.by_manager || []).filter(function(m) { return m.name === managerName; })[0] || {};
  const plan = mgrRow.plan || 0, fakt = mgrRow.amount || 0;
  const paceRatio = calcPaceRatioServer_(period);
  const faktForPace = mgrRow.amount_thru_yesterday != null ? mgrRow.amount_thru_yesterday : fakt;
  const forecast = faktForPace * paceRatio;

  const myDetail = (orders.by_manager_detail || {})[managerName] || null;
  const doc = (myDetail && myDetail.doc) || {};

  // ДЗ этого менеджера - собирается ПЕРВОЙ (до топ/пропавших клиентов), потому что нужна для
  // кросс-ссылки "у этого клиента есть непогашенный долг" ниже (2026-08-12, Влад - разбор
  // рекомендации по МИК-СЕРВИС+: "очень сомнительно рекомендовать увеличивать объём с клиентом,
  // который не оплатил предыдущий - только при условии оплаты по уже сделанному объёму").
  let mine = [];
  try {
    const dd = getDebtData(ss);
    if (dd && dd.by_customer) {
      const surLower = managerName.trim().split(' ')[0].toLowerCase();
      mine = dd.by_customer.filter(function(c) { return String(c.manager || '').trim().split(' ')[0].toLowerCase() === surLower; });
    }
  } catch (debtErr) { mine = []; } // ДЗ не критична для остального контекста
  // Долг по имени контрагента (ЛЮБОЙ положительный баланс, включая мёртвый/чужой-отдел - для
  // предупреждения "не увеличивай объём, пока не оплачено" не важно, взыскиваемый ли долг,
  // важен сам факт "уже должен").
  const debtByName = {};
  mine.forEach(function(c) { if ((c.balance || 0) > 0) debtByName[c.contragent] = { balance: Math.round(c.balance), days_overdue: c.daysOverdue }; });
  function attachDebtFlag_(name, entry) {
    const d = debtByName[name];
    if (d) entry.unpaid_balance = d.balance;
    return entry;
  }

  const topCustomers = ((myDetail && myDetail.top_customers) || []).slice(0, 8)
    .map(function(c) { return attachDebtFlag_(c.name, { name: c.name, amount: Math.round(c.amount || 0), orders: c.orders || 0 }); });

  const monthKey = period || Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM');
  const isLive = !period;
  let lostCustomers = [];
  try {
    // last_date добавлено (2026-08-12, Влад: "должно быть - ты тогда-то тогда-то работал с
    // тем-то тем-то, попробуй связаться, узнать как дела" - без даты последнего заказа модель
    // не может так написать, только сухую статистику).
    lostCustomers = computeLostCustomersForManager_(ss, monthKey, managerName, isLive).slice(0, 8)
      .map(function(c) { return attachDebtFlag_(c.name, { name: c.name, last_order_date: fmtDateRuServer_(c.last_date), days_since: c.days_since, amount_total: Math.round(c.amount_total || 0) }); });
  } catch (lostErr) { lostCustomers = []; } // не критично для остального контекста

  let debtSummary = { total_balance: 0, debtor_count: mine.length, top_debtors: [] };
  debtSummary.total_balance = Math.round(mine.reduce(function(s, c) { return s + (c.balance || 0); }, 0));
  // Отбор для ИИ-задач (2026-08-12, Влад разобрал реальную генерацию - "Гермесавто, долг
  // 827 дней - бесполезная рекомендация 'нужен личный дожим'"): долги 600+ дней (мёртвая
  // корзина, DEBT_AGE_LIMIT_DAYS) в задачи не попадают вообще - там уже не работает
  // "дожим", это отдельная категория, которую менеджер не может сдвинуть звонком. Долги
  // "Долг отдела кранов/экскаваторов" - тоже не его (см. DEBT_STATUS_EXCLUDE_FROM_TOTAL,
  // тот же приём, что фронтенд уже применяет к суммам).
  const actionable = mine.filter(function(c) {
    return (c.daysOverdue || 0) < DEBT_AGE_LIMIT_DAYS && DEBT_STATUS_EXCLUDE_FROM_TOTAL.indexOf(c.status) < 0;
  });
  // unpaid_docs добавлено (2026-08-12, Влад: "по Геоспецстрою можно написать, что нужно
  // получить оплату хотя бы 500 тыс по УПД 30 июня 2026 Бульдог Реализация... 00БП-004941"
  // - без документов модель может ссылаться только на общий баланс, не на конкретный акт).
  // Топ-3 САМЫХ СТАРЫХ непокрытых документа - приоритет "внимание в первую очередь", тот
  // же принцип, что и на вкладке ДЗ (см. buildDebtDocsHtml_). status добавлен (2026-08-12) -
  // чтобы модель не рекомендовала "составить претензию" тому, у кого претензия уже стоит
  // (см. правила эскалации в промпте).
  debtSummary.top_debtors = actionable.slice(0, 6).map(function(c) {
    // Сортировка - на СЫРОЙ ISO-дате (2026-07-18), русский формат применяется ПОСЛЕДНИМ шагом
    // - иначе "18 июля"/"5 мая" сравнивались бы как текст (алфавитный порядок месяцев не
    // совпадает с хронологическим) и топ-3 "самых старых" документа выбирались бы неверно.
    const unpaidDocs = (c.unpaidDocs || [])
      .map(function(d) { return { date: d.date, org: d.org, desc: d.desc, amount_outstanding: Math.round((d.debt || 0) - (d.covered || 0)) }; })
      .filter(function(d) { return d.amount_outstanding > 0; })
      .sort(function(a, b) { return String(a.date).localeCompare(String(b.date)); })
      .slice(0, 3)
      .map(function(d) { return { date: fmtDateRuServer_(d.date), org: d.org, desc: d.desc, amount_outstanding: d.amount_outstanding }; });
    return { name: c.contragent, balance: Math.round(c.balance || 0), days_overdue: c.daysOverdue, status: c.status || '', unpaid_docs: unpaidDocs };
  });

  // Примеры проблемных заказов ЭТОГО менеджера (2026-08-12, Влад: "тут можно ссылаться на
  // конкретные заказы, как по дебиторке") - тот же источник (orders.problem_orders), что уже
  // фильтрует buildManagerView_ для вкладки "Воронка документов", отфильтрован тут же (эта
  // функция вызывается из doGet с "сырым" orders, не через buildManagerView_). Сортировка по
  // дате - старые проблемные заказы первыми (та же логика приоритета, что везде на дашборде).
  const surLowerDocs = managerName.trim().split(' ')[0].toLowerCase();
  // unpaid_balance добавлено (2026-08-12, Влад разобрал живую генерацию по ПРОЕКТ-ДЕВЕЛОПМЕНТ
  // ЦВВ: "оплата пойдёт медленнее" неуместно, если у клиента вообще нет ДЗ - "оплата либо
  // произойдёт, либо нет, нужно сопоставить с текущей дебиторкой... если долга нет, тут просто
  // документальный порядок закрытия сделки") - та же кросс-ссылка с debtByName, что уже стоит
  // на top_customers/lost_customers, чтобы модель различала два РАЗНЫХ обоснования для одной и
  // той же задачи "провести документы" в зависимости от того, есть у клиента долг или нет.
  const problemExamples = ((orders.problem_orders || [])
    .filter(function(p) { return String(p.mgr || '').trim().split(' ')[0].toLowerCase() === surLowerDocs; }))
    .sort(function(a, b) { return String(a.date||'').localeCompare(String(b.date||'')); })
    .slice(0, 5)
    .map(function(p) { return attachDebtFlag_(p.customer, { id: p.id, date: fmtDateRuServer_(p.date), customer: p.customer, amount: Math.round(p.amount || 0), status: p.status }); });

  return {
    manager: managerName,
    period: monthKey,
    plan: { plan: Math.round(plan), fact: Math.round(fakt), pct: plan > 0 ? Math.round(fakt / plan * 100) : 0,
      forecast: Math.round(forecast), forecast_pct: plan > 0 ? Math.round(forecast / plan * 100) : 0 },
    top_customers: topCustomers,
    lost_customers: lostCustomers,
    debt: debtSummary,
    documents: {
      no_waybill: (doc.no_waybill_own || 0) + (doc.no_waybill_hired || 0), // сбор путевого листа - НЕ зона менеджера, см. промпт
      not_posted: doc.waybill_not_posted || 0,   // путевой есть, документ не проведён - менеджер может ускорить
      no_realiz: doc.posted_no_realiz || 0,      // документ проведён, но нет акта/накладной/УПД - менеджер может ускорить
      complete: doc.complete || 0,
      examples: problemExamples,
    },
  };
}

function buildAiTasksPrompt_(managerName, context) {
  return 'Ты - опытный коммерческий директор транспортно-логистической компании (перевозки ' +
    'тралами и длинномерами), который каждое утро даёт менеджеру по продажам короткий и ' +
    'ТОЧНЫЙ разбор дня - как это делает живой руководитель, который помнит историю по каждому ' +
    'клиенту, а не формальный отчёт по цифрам. Ниже - реальные данные по одному менеджеру за ' +
    'текущий месяц в формате JSON.\n\n' +
    'Данные:\n' + JSON.stringify(context, null, 0) + '\n\n' +
    'ВАЖНЫЕ ФАКТЫ О ТОМ, КАК УСТРОЕНА РАБОТА (используй их, чтобы не писать ошибочных советов):\n' +
    '- documents.no_waybill (нет путевого листа) - это зона ответственности ЛОГИСТОВ, а не ' +
    'менеджера по продажам. НЕ пиши менеджеру задачу "собери путевые листы" - он на это почти ' +
    'не влияет.\n' +
    '- documents.not_posted (путевой лист есть, но документ не проведён в 1С) и ' +
    'documents.no_realiz (документ проведён, но акт/накладная/УПД ещё не оформлены) - это ' +
    'менеджер МОЖЕТ ускорить (напомнить, чтобы провели/оформили быстрее). Формулируй как ' +
    '"ускорить проведение уже готовых документов", а не "собери документы".\n' +
    '- Непроведённые/неоформленные документы НЕ "держат выручку" сами по себе (факт продаж ' +
    'уже учтён). ПРИЧИНА, почему их важно провести, ЗАВИСИТ от того, есть ли у ЭТОГО клиента ' +
    'долг (documents.examples[i].unpaid_balance) - НЕ пиши одну и ту же формулировку для всех:\n' +
    '  * Если unpaid_balance ЕСТЬ (клиент уже должен) - можно писать, что закрытие документов ' +
    'снижает риск задержки оплаты (клиент обычно платит по закрытому акту/УПД).\n' +
    '  * Если unpaid_balance НЕТ (у клиента сейчас нет долга по ДЗ) - НЕ утверждай, что "оплата ' +
    'пойдёт медленнее/быстрее" - это не подтверждено данными, звучит как выдумка. Обоснование - ' +
    'просто правильный документооборот/порядок закрытия сделки (акт должен быть оформлен и ' +
    'отправлен клиенту, это не про риск неоплаты).\n' +
    '- debt.top_debtors[].unpaid_docs - конкретные неоплаченные документы по каждому ' +
    'должнику (дата, юрлицо, номер/описание, сумма к оплате). Если они есть - ссылайся на ' +
    'САМЫЙ СТАРЫЙ документ по имени/номеру и дате, а не просто на общий баланс.\n' +
    '- ПРАВИЛА ЭСКАЛАЦИИ ПО ДЗ (строго по days_overdue и status каждого должника, без ' +
    'исключений - "личный дожим/звонок" уместен ТОЛЬКО для свежего долга, дальше это не ' +
    'работает и рекомендация станет бесполезной):\n' +
    '  * days_overdue < 60 - обычная рекомендация "созвониться/напомнить об оплате" (как ' +
    'сейчас).\n' +
    '  * days_overdue от 60 до 90 - рекомендация ДОЛЖНА быть "составить и отправить претензию" ' +
    '(не "созвониться" - на этой стадии звонок уже не рычаг). ИСКЛЮЧЕНИЕ: если status у этого ' +
    'должника уже "Претензия" (или дальше по эскалации - "Суд"/"Исполнительный лист") - НЕ ' +
    'делай для него задачу вообще, возьми следующего должника из списка.\n' +
    '  * days_overdue от 90 до 600 - рекомендация ДОЛЖНА быть "срочно подать в суд" (не ' +
    '"составить претензию" - эта стадия уже пройдена). ИСКЛЮЧЕНИЕ: если status уже ' +
    '"Суд"/"Исполнительный лист" - НЕ делай для него задачу, возьми следующего должника.\n' +
    '  * Должников с пустым/незаданным status считай на стадии "Должник" (ещё не эскалировано) ' +
    '- рекомендуй по правилу для их days_overdue как обычно.\n' +
    '  * Если ПОСЛЕ применения исключений не осталось ни одного подходящего должника для ' +
    'задачи с category="дебиторка" - не выдумывай, просто не бери эту тему сегодня и перенеси ' +
    'слот на "выручка"/"документы".\n' +
    '- lost_customers[].last_order_date - когда именно менеджер последний раз работал с этим ' +
    'клиентом. Формулируй как напоминание из истории отношений: "с [клиент] ты в последний раз ' +
    'работал(а) [дата], свяжись, узнай как дела и нужны ли перевозки" - а не сухую статистику ' +
    'потерь. Слово "возобнови работу с..." - хорошо, слово "верни клиента" - НЕ используй, ' +
    'звучит неестественно (клиент не вещь, которую "возвращают").\n' +
    '- Для активных клиентов с хорошей динамикой (top_customers) - формулируй позитивно: ' +
    '"с [клиент] хорошо идёт работа, стоит предложить увеличить объёмы" - не как претензию. НО ' +
    'если у top_customers[i].unpaid_balance есть значение (клиент нам должен) - НЕ рекомендуй ' +
    'просто нарастить объём без оговорки: сомнительно наращивать работу с клиентом, который не ' +
    'оплатил уже сделанное. Формулируй с условием - например, "сначала закрыть оплату ' +
    '[сумма], потом предлагать доп. объём" или совместить оба действия в одной задаче (собрать ' +
    'оплату И только затем предложить рост). То же самое для lost_customers[i].unpaid_balance - ' +
    'если у пропавшего клиента есть долг, в задаче на реактивацию упомяни это.\n' +
    '- documents.examples - конкретные проблемные заказы (номер, дата, клиент, сумма, статус) ' +
    'для задач по документам - ссылайся на них, а не на голые счётчики.\n' +
    '- ГРАМОТНОСТЬ И РОД: определи пол менеджера по отчеству/имени в поле "manager" - отчество ' +
    'на "-вна"/"-чна" (Анатольевна, Владимировна) или явно женское имя = ЖЕНСКИЙ род, "-вич"/' +
    '"-ич" (Анатольевич, Владимирович) = МУЖСКОЙ род. Используй ПРАВИЛЬНЫЙ род во всех глаголах ' +
    'прошедшего времени и кратких прилагательных, обращённых к менеджеру на "ты" (например, ' +
    '"ты работала"/"ты работал", "ты сделала"/"ты сделал") - не используй мужской род по ' +
    'умолчанию для женщины.\n' +
    '- ФОРМАТ ЧИСЕЛ: все суммы в рублях пиши с пробелом как разделителем тысяч, как везде на ' +
    'дашборде (например, "7 618 250", а НЕ "7618250"; "381 750", а НЕ "381750") - слитные числа ' +
    'от 4 цифр тяжело читать.\n' +
    '- ФОРМАТ ДАТ: все даты (last_order_date, unpaid_docs[].date, documents.examples[].date) ' +
    'УЖЕ отформатированы по-русски (например "18 июля") - используй их РОВНО КАК ДАНЫ в тексте ' +
    'задач, ничего не меняй и не переводи в другой формат (не пиши "18.07.2026", не пиши ' +
    '"07/18/2026", не переставляй числа местами) - в прошлый раз при попытке самому ' +
    'переформатировать дату получился нечитаемый и неверный результат.\n' +
    '- НЕ указывай в "plan_advice" конкретные суммы или проценты выполнения плана (факт/' +
    'прогноз/план из plan.*) - эти цифры УЖЕ показаны прямо на странице живым виджетом рядом с ' +
    'твоим текстом и обновляются в реальном времени в течение дня (несколько раз в день ' +
    'приходят новые заказы), а твой текст кэшируется на весь день - если повторить цифры ' +
    'словами, они разойдутся с тем, что менеджер видит на экране, и текст будет выглядеть ' +
    'ошибочным. Пиши про КОНКРЕТНЫЕ ДЕЙСТВИЯ и КОНКРЕТНЫХ КЛИЕНТОВ, которые могут дать нужный ' +
    'объём - без своей копии процента выполнения плана.\n\n' +
    'РАЗДЕЛЯЙ ДВЕ РАЗНЫЕ ЦЕЛИ - не путай их: (1) РОСТ ПРОДАЖ - новые/повторные заказы, ' +
    'допродажи активным клиентам, возврат пропавших клиентов - это то, что двигает план. ' +
    '(2) ДЕНЬГИ И ПОРЯДОК В ДОКУМЕНТАХ - сбор дебиторки, проведение документов - это ВАЖНО, но ' +
    'НЕ является "рычагом для роста продаж" (план считается по факту продаж, не по оплатам). ' +
    'В "plan_advice" пиши ТОЛЬКО про рычаги роста продаж (пункт 1) - не называй сбор долгов ' +
    'или проведение документов способом ускорить выполнение плана продаж.\n\n' +
    'Сформулируй РОВНО 5 задач на сегодня для этого менеджера. Постарайся сделать разумный ' +
    'баланс: минимум 2 задачи про рост продаж (пропавшие клиенты / допродажи активным / новые ' +
    'заказы), не больше 2 задач про дебиторку и не больше 1 про документы - но если данных по ' +
    'какой-то теме нет (например, нет пропавших клиентов), не выдумывай, просто перераспредели ' +
    'на другие темы.\n\n' +
    'Требования к ответу:\n' +
    '- Ответь СТРОГО валидным JSON без markdown-обёртки (без ```), без текста до/после.\n' +
    '- Формат: {"tasks":[{"title":"...","why":"...","category":"выручка|дебиторка|документы"},' +
    '... ровно 5 штук],"plan_advice":"..."}\n' +
    '- "title" - короткая формулировка КОНКРЕТНОГО действия (до 90 символов) - что именно ' +
    'сделать сегодня (позвонить, напомнить, предложить), а не общая тема.\n' +
    '- "why" - 1-2 фразы, ПОЧЕМУ это важно именно сегодня, со ссылкой на конкретный факт из ' +
    'данных (сумма, дата, номер документа, имя клиента) - не общие слова.\n' +
    '- "category" - одна из трёх: "выручка" (рост продаж), "дебиторка" (сбор долгов), ' +
    '"документы" (порядок в документах).\n' +
    '- "plan_advice" - 2-4 предложения, КОНКРЕТНО как реалистично выполнить план ПРОДАЖ, с ' +
    'опорой на конкретных клиентов из top_customers/lost_customers, которые реально могут дать ' +
    'этот объём - БЕЗ повторения процента/суммы выполнения плана (см. выше, эти цифры уже на ' +
    'экране и обновляются в реальном времени).\n' +
    '- Задачи должны быть РАЗНЫЕ по теме (не 5 вариаций одного и того же) и опираться ТОЛЬКО ' +
    'на переданные данные, не выдумывай факты, которых нет в JSON.\n' +
    '- Пиши по-русски, обращение на "ты", по-деловому, тоном опытного руководителя, который ' +
    'знает клиентов лично - без длинного тире (используй обычный дефис), без канцелярита и воды.';
}

// ── ИИ-ЗАДАЧИ ДЛЯ ЛОГИСТА (2026-08-13) ─────────────────────────────────────────────────────
// Влад: "логисту тоже нужно структурировать страницу как менеджеру... задачи ИИ блок" -
// доменная область другая (найм техники у поставщиков, не прямые продажи клиентам), поэтому
// контекст и промпт - отдельные функции, а не параметризация одной большой (риск запутать оба
// промпта правкой одного). Оркестратор/кэш/API-вызов/парсинг - ОБЩИЕ (generateAiTasksCached_,
// см. выше) - не копируются.
//
// В отличие от менеджера - НЕТ кросс-ссылки с ДЗ клиентов: долг контрагента в 1С привязан к
// его менеджеру по продажам, не к логисту, который брокерил конкретный рейс - ложная связь
// была бы хуже отсутствия (логист не может "давить на оплату", это не его клиент).
function buildLogistAiContext_(ss, orders, logistName, period) {
  const lRow = ((orders.by_logist || []).filter(function(l) { return l.name === logistName; })[0]) || {};
  const qualMargin = lRow.hired_margin_qualified || 0;
  const unqualMargin = lRow.hired_margin_unqualified || 0;
  const totalMargin = qualMargin + unqualMargin;
  const MARGIN_BONUS_THRESHOLD = 1000000; // тот же порог, что в calcLogist (премия 30т)
  const paceRatio = calcPaceRatioServer_(period);
  const forecastMargin = totalMargin * paceRatio;

  const detail = (orders.logist_detail || {})[logistName] || { by_supplier: [], deals: [] };
  const suppliers = (detail.by_supplier || []).slice(0, 8).map(function(s) {
    return { name: s.name, revenue: Math.round(s.revenue || 0), margin: Math.round(s.margin || 0),
      margin_pct: s.margin_pct || 0, orders: s.orders || 0,
      no_waybill: s.no_waybill || 0, not_posted: s.not_posted || 0, no_realiz: s.no_realiz || 0, complete: s.complete || 0 };
  });
  const deals = (detail.deals || []).slice(0, 8).map(function(d) {
    return { date: fmtDateRuServer_(d.date), customer: d.customer, supplier: d.supplier,
      amount: Math.round(d.amount || 0), margin: Math.round(d.margin || 0) };
  });

  return {
    logist: logistName,
    period: period || Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM'),
    margin_bonus: {
      total_margin: Math.round(totalMargin), threshold: MARGIN_BONUS_THRESHOLD,
      pct: Math.round(totalMargin / MARGIN_BONUS_THRESHOLD * 100),
      forecast_margin: Math.round(forecastMargin),
      forecast_pct: Math.round(forecastMargin / MARGIN_BONUS_THRESHOLD * 100),
    },
    own_orders: Math.max(0, (lRow.orders || 0) - (lRow.hired_orders || 0)),
    suppliers: suppliers,
    deals_examples: deals,
  };
}

function buildLogistAiTasksPrompt_(logistName, context) {
  return 'Ты - опытный руководитель отдела логистики транспортной компании (перевозки тралами ' +
    'и длинномерами), который каждое утро даёт логисту-брокеру короткий и ТОЧНЫЙ разбор дня - ' +
    'как это делает живой руководитель, который помнит историю по каждому поставщику ' +
    '(перевозчику), а не формальный отчёт по цифрам. Логист находит поставщиков (наёмные ' +
    'машины/перевозчиков) под заказы клиентов и получает % от маржи найма. Ниже - реальные ' +
    'данные по одному логисту за текущий месяц в формате JSON.\n\n' +
    'Данные:\n' + JSON.stringify(context, null, 0) + '\n\n' +
    'ВАЖНЫЕ ФАКТЫ О ТОМ, КАК УСТРОЕНА РАБОТА (используй их, чтобы не писать ошибочных советов):\n' +
    '- margin_pct поставщика >= 23% - квалифицирует маржу под бонус 8% (иначе бонус 0% с этой ' +
    'части) - поставщики с margin_pct < 23% в suppliers[] стоит отметить как кандидатов на ' +
    'пересмотр ставки или частичную замену другим поставщиком с более высокой маржой.\n' +
    '- suppliers[i].no_waybill (нет путевого листа от перевозчика) - ЭТО ЗОНА ОТВЕТСТВЕННОСТИ ' +
    'ЛОГИСТА (в отличие от менеджера по продажам, у которого это была бы чужая зона) - здесь ' +
    'логист сам работает с поставщиком, уместно рекомендовать запросить путевой лист напрямую.\n' +
    '- suppliers[i].not_posted (путевой есть, но документ не проведён) и suppliers[i].no_realiz ' +
    '(документ проведён, но акт/накладная не оформлены) - тоже в зоне влияния логиста, можно ' +
    'ускорить, напомнив поставщику или бухгалтерии.\n' +
    '- margin_bonus.threshold (1 000 000 ₽) - порог квалифицирующей маржи найма за месяц, при ' +
    'котором начисляется премия 30 000 ₽ (см. margin_bonus.total_margin - факт, ' +
    'margin_bonus.forecast_margin - прогноз к концу месяца при текущем темпе). Если факт или ' +
    'прогноз близко к порогу (пример: 70-99%) - уместна задача "добрать маржу, чтобы получить ' +
    'премию 30 000 ₽" со ссылкой на конкретную нехватку в рублях (threshold - total_margin).\n' +
    '- НЕ указывай в "plan_advice" конкретные суммы/проценты маржи-к-порогу (margin_bonus.*) - ' +
    'эти цифры УЖЕ показаны прямо на странице живым виджетом и обновляются в реальном времени ' +
    'в течение дня, а твой текст кэшируется на весь день - если повторить цифры словами, они ' +
    'разойдутся с тем, что логист видит на экране. Пиши про КОНКРЕТНЫЕ ДЕЙСТВИЯ и КОНКРЕТНЫХ ' +
    'ПОСТАВЩИКОВ/КЛИЕНТОВ - без своей копии процента до премии.\n' +
    '- ГРАМОТНОСТЬ И РОД: определи пол логиста по отчеству/имени в поле "logist" - отчество на ' +
    '"-вна"/"-чна" или явно женское имя = ЖЕНСКИЙ род, "-вич"/"-ич" = МУЖСКОЙ род. Используй ' +
    'ПРАВИЛЬНЫЙ род во всех глаголах прошедшего времени и кратких прилагательных, обращённых ' +
    'на "ты" (например, "ты сделал(а)", "ты договорился/договорилась") - не мужской род по ' +
    'умолчанию для женщины.\n' +
    '- ФОРМАТ ЧИСЕЛ: все суммы в рублях пиши с пробелом как разделителем тысяч (например, ' +
    '"7 618 250", а НЕ "7618250") - слитные числа от 4 цифр тяжело читать.\n' +
    '- ФОРМАТ ДАТ: даты (deals_examples[].date) УЖЕ отформатированы по-русски (например ' +
    '"18 июля") - используй РОВНО КАК ДАНЫ, не переформатируй и не переставляй числа местами.\n\n' +
    'Сформулируй РОВНО 5 задач на сегодня для этого логиста. Постарайся сделать разумный ' +
    'баланс: минимум 2 задачи про работу с поставщиками (низкая маржа/новые предложения/объём), ' +
    'не больше 2 задачи про документы (путевые/проведение/реализация), 1 задачу можно посвятить ' +
    'прогрессу к премии >1М, если это уместно (близко к порогу) - но если данных по какой-то ' +
    'теме нет, не выдумывай, просто перераспредели на другие темы.\n\n' +
    'Требования к ответу:\n' +
    '- Ответь СТРОГО валидным JSON без markdown-обёртки (без ```), без текста до/после.\n' +
    '- Формат: {"tasks":[{"title":"...","why":"...","category":"выручка|поставщики|документы"},' +
    '... ровно 5 штук],"plan_advice":"..."}\n' +
    '- "title" - короткая формулировка КОНКРЕТНОГО действия (до 90 символов) - что именно ' +
    'сделать сегодня (позвонить поставщику, запросить документ, предложить объём), а не общая ' +
    'тема.\n' +
    '- "why" - 1-2 фразы, ПОЧЕМУ это важно именно сегодня, со ссылкой на конкретный факт из ' +
    'данных (сумма, поставщик, % маржи, номер заказа) - не общие слова.\n' +
    '- "category" - одна из трёх: "выручка" (объём/новые сделки/прогресс к премии), ' +
    '"поставщики" (маржа/ставки/переговоры), "документы" (путевые/проведение/реализация).\n' +
    '- "plan_advice" - 2-4 предложения, КОНКРЕТНО как реалистично добрать маржу до премии ' +
    'или нарастить объём, с опорой на конкретных поставщиков/клиентов из suppliers/' +
    'deals_examples - БЕЗ повторения процента/суммы до порога (см. выше).\n' +
    '- Задачи должны быть РАЗНЫЕ по теме (не 5 вариаций одного и того же) и опираться ТОЛЬКО ' +
    'на переданные данные, не выдумывай факты, которых нет в JSON.\n' +
    '- Пиши по-русски, обращение на "ты", по-деловому, тоном опытного руководителя, который ' +
    'знает поставщиков лично - без длинного тире (используй обычный дефис), без канцелярита ' +
    'и воды.';
}

// POST https://api.kie.ai/codex/v1/responses - reasoning-модель (см. reference-память
// kie.ai - "у каждой модели свой URL/формат", этот путь для GPT-5). Ключ - только из Script
// Properties, никогда не в коде (правило репозитория).
function callKieGpt5_(promptText) {
  const key = PropertiesService.getScriptProperties().getProperty('KIE_API_KEY');
  if (!key) throw new Error('KIE_API_KEY не настроен в Script Properties - добавь вручную в редакторе Apps Script (Настройки проекта -> Свойства скрипта)');
  const payload = {
    model: 'gpt-5-4',
    stream: false,
    input: [{ role: 'user', content: [{ type: 'input_text', text: promptText }] }],
    reasoning: { effort: 'medium' },
  };
  const resp = UrlFetchApp.fetch(KIE_GPT5_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  const body = resp.getContentText();
  if (code !== 200) throw new Error('kie.ai HTTP ' + code + ': ' + body.slice(0, 400));
  let data;
  try { data = JSON.parse(body); } catch (parseErr) { throw new Error('kie.ai вернул не-JSON: ' + body.slice(0, 400)); }
  let text = '';
  (data.output || []).forEach(function(o) {
    (o.content || []).forEach(function(c) { if (c.text) text += c.text; });
  });
  if (!text) throw new Error('kie.ai вернул пустой ответ - формат мог измениться, см. raw: ' + body.slice(0, 400));
  return text;
}

// Защитный парсинг - модель иногда всё равно оборачивает ответ в ```json fences вопреки
// инструкции, снимаем их перед JSON.parse. Обрезаем/не роняем весь ответ, если задач не ровно 5
// (лучше показать 3-4 реальные задачи, чем упасть с ошибкой).
function parseAiTasksResponse_(rawText) {
  let cleaned = String(rawText || '').trim();
  if (cleaned.indexOf('```') === 0) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/```\s*$/, '').trim();
  }
  let data;
  try { data = JSON.parse(cleaned); } catch (parseErr) { throw new Error('Не удалось разобрать ответ ИИ как JSON: ' + cleaned.slice(0, 300)); }
  if (!data || !Array.isArray(data.tasks) || !data.tasks.length) throw new Error('Ответ ИИ не содержит списка задач');
  const validCategories = ['выручка', 'дебиторка', 'документы'];
  const tasks = data.tasks.slice(0, 5).map(function(t) {
    const cat = String((t && t.category) || '').trim().toLowerCase();
    return { title: String((t && t.title) || '').trim(), why: String((t && t.why) || '').trim(),
      category: validCategories.indexOf(cat) >= 0 ? cat : '' };
  }).filter(function(t) { return t.title; });
  if (!tasks.length) throw new Error('Ответ ИИ не содержит валидных задач');
  return { tasks: tasks, plan_advice: String(data.plan_advice || '').trim() };
}

// Оркестратор ОБЩИЙ для менеджера и логиста (2026-08-13, было отдельно под менеджера,
// обобщено, когда Влад попросил "тот же каркас" для логиста - не копируем кэш/API-вызов/
// парсинг под каждую роль, только contextFn/promptFn разные). Кэш на день, иначе генерация +
// сохранение. Ошибки НЕ кэшируются (можно повторить в тот же день - см. план, риск "формат
// ответа kie.ai не проверен вживую"). force=true (2026-08-12, Влад: "мы сделали много
// изменений... нужно всё обнулить, чтобы посмотреть заново по новым данным") - игнорирует
// кэш на сегодня и удаляет старую строку перед генерацией новой, вместо ручного похода в
// Google Таблицу за каждым обновлением промпта. Дёргается кнопкой "Сгенерировать заново" на
// фронтенде (см. retryAiTasks_).
function generateAiTasksCached_(ss, personName, contextFn, promptFn, force) {
  const dateKey = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM-dd');
  if (force) {
    deleteAiTasksCacheRow_(ss, dateKey, personName);
  } else {
    const cached = findAiTasksCacheRow_(ss, dateKey, personName);
    if (cached) return { tasks: cached.tasks, plan_advice: cached.plan_advice, generated_at: cached.generated_at, cached: true };
  }

  const context = contextFn();
  const prompt = promptFn(personName, context);
  const rawText = callKieGpt5_(prompt);
  const parsed = parseAiTasksResponse_(rawText);
  const generatedAt = saveAiTasksCache_(ss, dateKey, personName, parsed.tasks, parsed.plan_advice, 'gpt-5-4');
  return { tasks: parsed.tasks, plan_advice: parsed.plan_advice, generated_at: generatedAt, cached: false };
}

function generateManagerAiTasksCached_(ss, orders, managerName, period, force) {
  return generateAiTasksCached_(ss, managerName,
    function() { return buildManagerAiContext_(ss, orders, managerName, period); },
    buildAiTasksPrompt_, force);
}

function generateLogistAiTasksCached_(ss, orders, logistName, period, force) {
  return generateAiTasksCached_(ss, logistName,
    function() { return buildLogistAiContext_(ss, orders, logistName, period); },
    buildLogistAiTasksPrompt_, force);
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


// Список месяцев, по которым есть архив (для выпадающего списка на дашборде)
function getAvailablePeriods(ss) {
  // Текущий календарный месяц исключаем, даже если под его именем случайно завалялся
  // архивный лист (Влад, 2026-08-04: "2026-08" в выпадающем списке дублировал "Текущий
  // месяц" и падал с "Архив за 2026-08 пуст" - в списке архивов ему в принципе не место,
  // "Текущий месяц" уже его покрывает).
  const currentMonthKey = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM');
  const sheets = ss.getSheets();
  const periods = [];
  const re = new RegExp('^' + ORDERS_ARCHIVE_PFX + '(\\d{4}-\\d{2})$');
  sheets.forEach(function(s) {
    const m = s.getName().match(re);
    if (m && m[1] !== currentMonthKey) periods.push(m[1]);
  });
  periods.sort().reverse();
  return periods;
}

// Настройка воронки документов (Влад, 2026-07-16): "если нет путёвки, но при этом уже
// есть реализация - не считаем как нет путёвки, все предыдущие стадии пройдены". Легко
// откатить одной строкой - поставь false, если цифры после теста покажутся неправильными.
const WAYBILL_SKIP_IF_REALIZ = true;

// Служебные строки (Влад, 2026-07-16): "есть строчки системные - где-то нужно водителю
// смену закрыть для зарплаты, где-то ещё для чего-то - строчка 'прочее', она не участвует
// в коммерческой системе и в документообороте, на них нет ни путёвки, ни выручки, это
// нормально". Такие строки помечены в 1С колонкой "Вариант расчёта" = "Прочее" (в отличие
// от реальных коммерческих - "Наличный"/"Безналичный") - при включённом флаге полностью
// исключаем их из воронки документов (ни как проблему, ни как "готово"). Легко откатить -
// поставь false.
const FUNNEL_EXCLUDE_OTHER_PAYMENT_VARIANT = true;

// Наличные расчёты (Влад, 2026-07-16, после подтверждения "Прочее" - работает): "то, что за
// наличку - там не может быть реализации и не может быть проведения, поэтому можно их не
// считывать, наличие путевого листа мне тоже не интересно" - структурно у наличных заказов
// никогда не будет ни путёвки, ни проведения, ни реализации, проверять эти флаги для них
// бессмысленно. Отдельный переключатель от "Прочее" - разные причины, легче откатить
// независимо друг от друга.
const FUNNEL_EXCLUDE_CASH_PAYMENTS = true;

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
    contract:40, tral_dept:41, month:42, payment_variant:43
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

  // "Выручка по вчера" - отдельный числитель для прогноза (Влад, 2026-07-08: "живую выручку
  // показываем как есть, а прогноз считаем по вчерашнему дню"). Часть менеджеров вносит заказы
  // в тот же день (не за вчера, как остальные) - их сегодняшняя (ещё неполная) выручка иначе
  // попадает в числитель прогноза, а знаменатель (calcPaceRatio_ на фронтенде) уже считает
  // сегодняшний день незавершённым - числитель и знаменатель расходились, прогноз завышался.
  // "Факт" на дашборде везде остаётся живым (totalAmount/m.amount, без изменений).
  const yesterdayStr = (function() {
    var d = new Date();
    d.setDate(d.getDate() - 1);
    return Utilities.formatDate(d, 'Europe/Moscow', 'yyyy-MM-dd');
  })();
  // Динамика "сегодня vs вчера" по менеджеру (Влад, 2026-07-17: "то же самое по менеджерам
  // в количестве заказов - на сколько увеличилось по сравнению с предыдущим днём... по
  // нажатию показать какие именно заказы"). Отдельная история не нужна - "Дата создания"
  // (date_c) у заказа не меняется задним числом, поэтому "прибавилось со вчера" = "заказы,
  // созданные сегодня" - считается прямо из текущих живых данных, без нового листа истории.
  const todayStr = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM-dd');

  let totalOrders=0, totalAmount=0, totalAmountThruYesterday=0, totalPayment=0, totalBalance=0;
  // Выручка по дням (2026-08-13, вкладка "Поступления" - сравнение с реальными деньгами на
  // р/с по дням/месяцам). Копится ровно на том же событии, что и totalAmount ниже - гарантия,
  // что сумма по дням всегда сходится с "Общей выручкой" за период (тот же принцип "цифры
  // бьются везде", что и везде на дашборде).
  let byDay = {};
  // Наличные поступления по дням (Влад, 2026-08-13: "поступления налички это видно из
  // таблицы заказов" - отчёт 1С "Поступления на расчётный счёт" видит ТОЛЬКО безналичные
  // переводы, наличная оплата в банк не попадает и там не видна вообще). Колонка "Оплата
  // нал" (cash) - накопительная сумма наличными по заказу, тот же принцип дневной разбивки,
  // что и byDay/totalAmount выше.
  let totalCash = 0;
  let byDayCash = {};
  // "Коммерческая" выручка - БЕЗ внутригрупповых перевозок (Влад, 2026-08-13: "внутренних и
  // не должно быть, мы всё равно не получаем по ним поступления... сравнение должно быть
  // поступления / коммерческие заказы"). totalAmount/byDay выше НЕ трогаем - они используются
  // в других местах дашборда, где внутренние специально ВКЛЮЧЕНЫ в аналитику (project_business_
  // rules, "Внутренние перевозки - НЕ исключать"). Эта пара - только для сравнения с
  // "Поступлениями", где внутренние структурно не могут дать реальных денег на счёт.
  let totalCommercial = 0;
  let byDayCommercial = {};
  let totalHiredCost=0, hiredProfit=0, hiredProfitTral=0, hiredProfitLong=0;
  let internalAmount=0, internalAmountThruYesterday=0, internalOrders=0;
  // Счётчики исключённых из воронки документов строк - для сверки с "Заказов (свой парк +
  // наём)" (Влад, 2026-07-17: "всё должно сходиться по суммам, давай подобьёмся").
  let excludedOtherPayment=0, excludedCashPayment=0;
  // % проблемных заказов по сегменту (Влад, 2026-07-17: карточка "Заказов" вместо "Топ
  // грузов") - считаем только среди строк, реально попавших в воронку (не внутренние/
  // служебные/наличные), иначе процент будет несопоставим с тем, что показывает сама
  // воронка документов.
  let funnelTralTotal=0, funnelLongTotal=0, funnelTralProblem=0, funnelLongProblem=0;
  let tralOrders=0, tralAmount=0, longOrders=0, longAmount=0;
  let ownAmount=0, hiredAmountRev=0;
  let ownTralOrders=0, ownLongOrders=0, hiredTralOrders=0, hiredLongOrders=0;
  let ownLongAmount=0; // выручка ТОЛЬКО собственного парка длинномеров (2026-08-11, страница Васина - убрать наём)
  var noWaybillOwn=[0,0,0], noWaybillHired=[0,0,0], waybillNotPosted=[0,0,0], postedNoRealiz=[0,0,0], complete=[0,0,0];
  // Личная страница логиста-длинномерщика (2026-08-11, Васин) - воронка путевых листов и
  // список сделок ЦЕЛИКОМ по сегменту "Длинномер", независимо от исполнителя.
  var longFunnel = { no_waybill:0, not_posted:0, no_realiz:0, complete:0 };
  var allLongDeals = [];

  const managerMap  = {};
  const logistMap   = {};
  const customerMap = {};
  const dayMap      = {};
  const supplierMap = {};
  const allHiredDeals = []; // общекорпоративный список сделок найма (2026-08-10, "Общие сделки")
  const driverMap   = {};
  const problemOrders = [];
  const mgrDetailMap = {}; // персональная разбивка по менеджеру (для личной страницы)
  const logistDetailMap = {}; // персональная разбивка по логисту (для личной страницы, 2026-08-10)
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

  // Личная страница логиста (2026-08-10, Прус-Роскошный и остальные) - маржа по поставщикам
  // именно его сделок + воронка документов по поставщику + список сделок. Отдельная структура
  // от logistMap (та копит только суммарные цифры для зарплаты/списков) - тут нужна разбивка
  // по каждому поставщику, которую больше нигде не считаем.
  function logistDetail(name) {
    if (!logistDetailMap[name]) {
      logistDetailMap[name] = { name: name, suppliers: {}, deals: [] };
    }
    return logistDetailMap[name];
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

    // С июля 2026: 8%/8%/2%/2% от маржи найма платится только если маржа найма >=23% -
    // порог проверяется ПО КОМПАНИИ ЗА МЕСЯЦ ЦЕЛИКОМ (тот же % что и KPI "Маржа найма" на
    // дашборде = hiredProfit/hiredAmountRev), не по каждому заказу отдельно - Влад,
    // 2026-07-07, инцидент с ошибочной построчной проверкой (см. project_salary_rules).
    // Регрессия найдена 2026-08-06: построчная проверка снова оказалась в коде (видимо,
    // откатилась при параллельном clasp push мимо git). Здесь только копим сумму маржи
    // на менеджера/логиста БЕЗ деления на квалиф./неквалиф. - решение "весь месяц
    // квалифицируется или нет" принимается один раз ПОСЛЕ цикла по всем строкам
    // (см. companyMarginQualifies ниже, после цикла for).
    const isThruYesterday = dateStr !== '' && dateStr <= yesterdayStr;

    totalAmount  += amount;
    if (dateStr) byDay[dateStr] = (byDay[dateStr] || 0) + amount;
    const cashPaid = num(row, 'cash');
    totalCash += cashPaid;
    if (dateStr && cashPaid) byDayCash[dateStr] = (byDayCash[dateStr] || 0) + cashPaid;
    if (!isInt) {
      totalCommercial += amount;
      if (dateStr) byDayCommercial[dateStr] = (byDayCommercial[dateStr] || 0) + amount;
    }
    if (isThruYesterday) totalAmountThruYesterday += amount;
    totalPayment += payment;
    totalBalance += balance;
    if (isHired) {
      totalHiredCost += hiredCost; hiredProfit += profit; hiredAmountRev += amount;
      // Маржа найма по сегменту (Влад, 2026-07-17: карточка "Заказов" вместо "Топ грузов").
      if (equip === 'Длинномер') hiredProfitLong += profit; else hiredProfitTral += profit;
    } else { ownAmount += amount; }

    if (isInt) {
      internalAmount += amount; internalOrders++;
      if (isThruYesterday) internalAmountThruYesterday += amount;
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
      if (isHired) hiredLongOrders++; else { ownLongOrders++; ownLongAmount += amount; }
    }

    // ── По менеджеру продаж ──
    if (mgrSales && ordInList(mgrSales, TRAL_MANAGERS)) {
      if (!managerMap[mgrSales]) {
        managerMap[mgrSales] = { name: mgrSales, orders:0, amount:0, amount_thru_yesterday:0, payment:0, cash:0, profit:0, hired_orders:0, hired_cost:0,
          internal_orders:0, internal_amount:0, internal_amount_thru_yesterday:0, internal_payment:0,
          own_amount:0, own_profit:0, hired_margin_total:0, hired_margin_qualified:0, hired_margin_unqualified:0,
          hired_extra_costs:0,
          today_new_orders:0, today_new_amount:0, today_new_list:[] };
      }
      const m = managerMap[mgrSales];
      m.orders++;
      m.amount  += amount;
      if (isThruYesterday) m.amount_thru_yesterday += amount;
      m.payment += payment;
      m.cash    += num(row, 'cash');
      if (isHired) m.profit += profit;   // прибыль только по найму
      if (isInt) {
        m.internal_orders++; m.internal_amount += amount; m.internal_payment += payment;
        if (isThruYesterday) m.internal_amount_thru_yesterday += amount;
      }
      // Заказы, добавленные сегодня (Влад, 2026-07-17) - для стрелки динамики и drill-down.
      if (dateVal(row, 'date_c') === todayStr) {
        m.today_new_orders++;
        m.today_new_amount += amount;
        m.today_new_list.push({ id: str(row,'id'), customer: str(row,'customer'), amount: amount });
      }
      if (isHired) {
        m.hired_orders++; m.hired_cost += hiredCost; m.hired_margin_total += profit;
        // "Затраты" (Влад, 2026-08-06) - те же три статьи 1С (Вознаграждение 1/2,
        // Спецразрешение и т.п.), что и в supplierMap - выведены обратным счётом.
        m.hired_extra_costs += (amount - hiredCost - profit);
      } else {
        // own_profit = "Сумма" минус три статьи затрат 1С (Вознаграждение 1/2, Спецразрешение
        // и т.п. - НДС-корректировки при работе с поставщиками без НДС и др.), которые уже
        // нетто в поле "Прибыль" (Стоимость привлечённого тут 0 - заказ не наёмный). Влад,
        // 2026-08-06: "зарплата по своему парку считается от выручки минус эти затраты, и уже
        // умножаем на %" - own_amount оставлен для отображения (валовая выручка), own_profit -
        // база для % комиссии (см. calcMgr на фронтенде).
        m.own_amount += amount; m.own_profit += profit;
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
          own_amount:0, hired_margin_total:0, hired_margin_qualified:0, hired_margin_unqualified:0,
          hired_extra_costs:0 };
      }
      const l = logistMap[mgrLog];
      l.orders++;
      l.amount += amount;
      if (equip === 'Трал')      l.tral++;
      if (equip === 'Длинномер') l.long_++;
      if (isHired) {
        l.hired_margin_total += profit;
        l.hired_extra_costs += (amount - hiredCost - profit);
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
      if (!supplierMap[supplier]) {
        supplierMap[supplier] = { name:supplier, orders:0, revenue:0, cost:0, extra_costs:0, profit:0,
          no_waybill:0, not_posted:0, no_realiz:0, complete:0 };
      }
      supplierMap[supplier].orders++;
      supplierMap[supplier].revenue += amount;
      supplierMap[supplier].cost    += hiredCost; // "Стоимость найма" - что заплатили перевозчику
      supplierMap[supplier].profit  += profit;
      // "Затраты" (новый смысл, Влад 2026-08-06) - сумма трёх статей 1С (Вознаграждение 1/2,
      // Спецразрешение и т.п. - включая НДС-корректировки при работе с поставщиками без НДС),
      // которые в саму Заказы_данные отдельными колонками не приходят, только нетто внутри
      // "Прибыль". Выводим обратным счётом: Сумма - Стоимость найма - Прибыль = эти затраты
      // (сверено с живым заказом 1С #470632 ТД ДЗЖБИ: 50000-35000-7300=7700, совпадает с
      // "Сумма вознаграждения 2" в 1С день в день). margin (см. supplierList ниже) остаётся
      // равен "Прибыль" - именно эта сумма и есть маржа с учётом всех затрат.
      supplierMap[supplier].extra_costs += (amount - hiredCost - profit);
      if (!hw && !isInternalOrder) supplierMap[supplier].no_waybill++;

      // Общекорпоративный список сделок найма (2026-08-10, "Общие сделки" на личной странице
      // логиста - Влад: "он видит абсолютно всю ситуацию по направлению") - КАЖДАЯ наёмная
      // строка, не только у распознанных логистов из TRAL_LOGISTS.
      allHiredDeals.push({
        id: str(row,'id'), date: dateStr, customer: str(row,'customer'), supplier: supplier,
        amount: amount, cost: hiredCost, margin: profit, logist: mgrLog || '',
      });

      // Та же разбивка по поставщику, но только для СВОЕГО логиста (личная страница,
      // 2026-08-10) - не смешивается с чужими сделками, как mgrDetail выше для менеджеров.
      if (mgrLog && ordInList(mgrLog, TRAL_LOGISTS)) {
        var ld = logistDetail(mgrLog);
        if (!ld.suppliers[supplier]) {
          ld.suppliers[supplier] = { name:supplier, orders:0, revenue:0, cost:0, extra_costs:0, profit:0,
            no_waybill:0, not_posted:0, no_realiz:0, complete:0 };
        }
        var lds = ld.suppliers[supplier];
        lds.orders++;
        lds.revenue += amount;
        lds.cost    += hiredCost;
        lds.profit  += profit;
        lds.extra_costs += (amount - hiredCost - profit);
        // Тем же условием, что и глобальный supplierMap.no_waybill чуть выше (!isInternalOrder
        // тоже учитывается) - раньше эта цифра считалась отдельно в блоке "Статус документов"
        // по более узкому условию (!isInt, без !isInternalOrder), что расходилось с "Общими
        // сделками" по тому же поставщику. Один источник на обе вкладки (2026-08-10).
        if (!hw && !isInternalOrder) lds.no_waybill++;
        ld.deals.push({
          id: str(row,'id'), date: dateStr, customer: str(row,'customer'), supplier: supplier,
          amount: amount, cost: hiredCost, margin: profit,
        });
      }
    }

    // ── Сделки по длинномерам ЦЕЛИКОМ (2026-08-11, личная страница Васина) ──
    // Влад: "видеть все сделки по длинномерам, независимо от того, только он ли выполнял
    // заказ" - КАЖДАЯ строка с equip==='Длинномер', свой парк и наём вместе, независимо от
    // того, кто менеджер/логист/водитель.
    if (equip === 'Длинномер') {
      allLongDeals.push({
        id: str(row,'id'), date: dateStr, customer: str(row,'customer'),
        amount: amount, profit: profit,
        manager: mgrSales, logist: mgrLog,
        executor: isHired ? str(row,'hired') : ordCleanName(str(row,'driver')),
        is_hired: isHired,
      });
    }

    // ── Статус документов (внешние заказы, разбивка по декадам) ──
    const paymentVariant = str(row, 'payment_variant');
    const isServiceRow = (FUNNEL_EXCLUDE_OTHER_PAYMENT_VARIANT && paymentVariant === 'Прочее') ||
                         (FUNNEL_EXCLUDE_CASH_PAYMENTS && paymentVariant === 'Наличный');
    if (!isInt && !isServiceRow) {
      const dayNum2 = parseInt((dateStr||'').split('-')[2]) || 0;
      const dec = dayNum2 <= 10 ? 0 : dayNum2 <= 20 ? 1 : 2;
      const pst = yes(row, 'posted');
      const hr  = yes(row, 'realiz');
      // Если реализация уже есть - все предыдущие стадии (путёвка, проведение) считаются
      // пройденными, даже если сами флаги этого не показывают (WAYBILL_SKIP_IF_REALIZ выше).
      const skipToComplete = WAYBILL_SKIP_IF_REALIZ && hr;
      let docStatus = '', docLabel = '';
      if (skipToComplete) { complete[dec]++; }
      else if (!hw)       { if (isHired) noWaybillHired[dec]++; else noWaybillOwn[dec]++; docStatus='no_waybill'; docLabel='нет путёвки'; }
      else if (!pst) { waybillNotPosted[dec]++;  docStatus='not_posted'; docLabel='не проведён'; }
      else if (!hr)  { postedNoRealiz[dec]++;    docStatus='no_realiz';  docLabel='нет реализации'; }
      else           { complete[dec]++; }

      if (equip === 'Длинномер') { funnelLongTotal++; if (docStatus) funnelLongProblem++; }
      else                        { funnelTralTotal++; if (docStatus) funnelTralProblem++; }

      if (mgrSales && ordInList(mgrSales, TRAL_MANAGERS)) {
        var md2 = mgrDetail(mgrSales).doc;
        if (skipToComplete) { md2.complete++; mgrDetail(mgrSales).rows_complete++; }
        else if (!hw)       { if (isHired) md2.no_waybill_hired++; else md2.no_waybill_own++; }
        else if (!pst) md2.waybill_not_posted++;
        else if (!hr)  md2.posted_no_realiz++;
        else           { md2.complete++; mgrDetail(mgrSales).rows_complete++; }
      }

      // Воронка путевых листов ПО СЕГМЕНТУ "Длинномер" целиком по компании (2026-08-11,
      // личная страница Васина) - та же классификация, что общая воронка выше, без доп.
      // условий (как funnelLongTotal/funnelLongProblem чуть выше в цикле).
      if (equip === 'Длинномер') {
        if (skipToComplete) { longFunnel.complete++; }
        else if (!hw)       { longFunnel.no_waybill++; }
        else if (!pst)      { longFunnel.not_posted++; }
        else if (!hr)       { longFunnel.no_realiz++; }
        else                { longFunnel.complete++; }
      }

      // Воронка документов ПО ПОСТАВЩИКУ - общекорпоративная (2026-08-10, "Общие сделки" на
      // личной странице логиста) - та же классификация, на ГЛОБАЛЬНУЮ запись supplierMap
      // (уже создана в блоке "По поставщикам найма" для каждой наёмной строки). no_waybill
      // НЕ трогаем здесь - он уже посчитан выше (учитывает isInternalOrder, более широкое
      // условие, чем !isInt тут) - повторный счёт задвоил бы цифру.
      if (isHired) {
        var sg = supplierMap[str(row, 'hired')];
        if (sg) {
          if (skipToComplete) { sg.complete++; }
          else if (!hw)       { /* учтено в no_waybill выше */ }
          else if (!pst)      { sg.not_posted++; }
          else if (!hr)       { sg.no_realiz++; }
          else                { sg.complete++; }
        }
      }

      // Воронка документов ПО ПОСТАВЩИКУ, только для найма своего логиста (личная страница,
      // 2026-08-10) - та же классификация, что и общая воронка выше. no_waybill НЕ трогаем
      // здесь - уже посчитан в блоке "По поставщикам найма" (тем же условием, что глобальный).
      if (isHired && mgrLog && ordInList(mgrLog, TRAL_LOGISTS)) {
        var lds2 = logistDetail(mgrLog).suppliers[str(row, 'hired')];
        if (lds2) {
          if (skipToComplete) { lds2.complete++; }
          else if (!hw)       { /* учтено в no_waybill выше */ }
          else if (!pst)      { lds2.not_posted++; }
          else if (!hr)       { lds2.no_realiz++; }
          else                { lds2.complete++; }
        }
      }

      if (docStatus) {
        // Водитель (свой парк) или наёмник (наёмный парк) - Влад, 2026-07-16: "должен быть
        // указан водитель, если это свой парк, и наёмник, если это наёмный парк".
        problemOrders.push({
          id: str(row,'id'), date: dateStr,
          customer: str(row,'customer'), mgr: mgrSales,
          // "Остаток" в таблице (Влад, 2026-07-17: "хочу видеть оплату по заказам, а не то,
          // что ты считаешь") - показываем именно payment ("Оплата итого"), не balance
          // ("Сумма остаток") - это то, что реально спрашивали.
          amount: amount, payment: payment, status: docLabel, decade: dec + 1,
          is_hired: isHired,
          executor: isHired ? str(row,'hired') : ordCleanName(str(row,'driver')),
        });
      }
    } else if (!isInt && isServiceRow) {
      // !isInt здесь обязателен - иначе строка, которая одновременно и внутренняя, и
      // "Прочее"/наличная, попала бы в оба счётчика сразу (internalOrders ниже + этот),
      // и сверка "Всего заказов = воронка + исключения" перестала бы сходиться.
      // Счётчики для сверки с "Заказов (свой парк + наём)" (Влад, 2026-07-17) - внутренние
      // считаются отдельно через internalOrders (см. блок выше), тут только две наши новые
      // причины исключения из воронки.
      if (paymentVariant === 'Прочее') excludedOtherPayment++;
      else if (paymentVariant === 'Наличный') excludedCashPayment++;
    }

    // ── По водителям ──
    // Та же логика, что у поставщиков выше - внутренние перевозки не считаем в воронку
    // "нет путёвки" (Влад, 2026-07-02), заказы/выручка водителя считаются как обычно.
    const driverName = ordCleanName(str(row, 'driver'));
    if (driverName) {
      const isInternalOrder = isInt || ordInList(str(row, 'customer'), INTERNAL_CLIENTS);
      if (!driverMap[driverName]) {
        driverMap[driverName] = { name: driverName, orders: 0, amount: 0, no_waybill: 0,
          orders_long: 0, no_waybill_long: 0 }; // сегмент "Длинномер" (2026-08-11, страница Васина)
      }
      driverMap[driverName].orders++;
      driverMap[driverName].amount += amount;
      if (!hw && !isInternalOrder) driverMap[driverName].no_waybill++;
      if (equip === 'Длинномер') {
        driverMap[driverName].orders_long++;
        if (!hw && !isInternalOrder) driverMap[driverName].no_waybill_long++;
      }
    }
  }

  // Порог 23% - по компании за месяц ЦЕЛИКОМ (см. комментарий в начале цикла выше). Считаем
  // ОДИН РАЗ по итогам всех строк, затем разово раскладываем накопленный hired_margin_total
  // каждого менеджера/логиста в qualified/unqualified - весь наём месяца либо весь считается,
  // либо весь нет, единообразно для всех.
  const companyMarginPct = hiredAmountRev > 0 ? (hiredProfit / hiredAmountRev) : 0;
  const companyMarginQualifies = companyMarginPct >= 0.23;
  Object.values(managerMap).forEach(function(m) {
    if (companyMarginQualifies) { m.hired_margin_qualified = m.hired_margin_total; m.hired_margin_unqualified = 0; }
    else { m.hired_margin_qualified = 0; m.hired_margin_unqualified = m.hired_margin_total; }
  });
  Object.values(logistMap).forEach(function(l) {
    if (companyMarginQualifies) { l.hired_margin_qualified = l.hired_margin_total; l.hired_margin_unqualified = 0; }
    else { l.hired_margin_qualified = 0; l.hired_margin_unqualified = l.hired_margin_total; }
  });

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

  // Поставщики найма с маржой. Маржа = накопленное поле "Прибыль" 1С (s.profit), НЕ
  // revenue-cost - диагностика 2026-08-06 (diagnoseHiredMarginMismatch, архив июля) нашла
  // причину расхождения: в 1С у заказов найма есть ещё три статьи затрат сверх "Стоимости
  // привлечённой техники" (Вознаграждение 1, Вознаграждение 2, Спецразрешение - в т.ч.
  // НДС-корректировки при работе с поставщиками без НДС), которые в Заказы_данные отдельно
  // не приходят, только нетто внутри "Прибыль" (Влад подтвердил на живом заказе 1С #470632
  // ТД ДЗЖБИ: Сумма 50000 - Стоимость найма 35000 - Вознаграждение2 7700 = Прибыль 7300).
  // cost = "Стоимость найма" (что заплатили перевозчику), extra_costs = эти три статьи
  // (выведены обратным счётом, см. supplierMap выше). margin = profit = revenue - cost -
  // extra_costs - тот же источник, что уже кормит зарплату (hiredProfit/managerMap/logistMap).
  const supplierList = Object.values(supplierMap).map(function(s) {
    const margin = s.profit;
    return {
      name: s.name, orders: s.orders, revenue: s.revenue, cost: s.cost, extra_costs: s.extra_costs,
      margin: margin, margin_pct: s.revenue > 0 ? Math.round(margin / s.revenue * 100) : 0,
      no_waybill: s.no_waybill,
      // Полная воронка (2026-08-10, "Общие сделки" на личной странице логиста) - раньше был
      // только no_waybill, теперь та же разбивка, что и в logist_detail.by_supplier.
      not_posted: s.not_posted, no_realiz: s.no_realiz, complete: s.complete,
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

  // Личная страница логиста (2026-08-10) - маржа по поставщикам его собственных сделок +
  // воронка документов по поставщику + список сделок. margin/margin_pct считаются так же, как
  // в supplierList выше (margin = "Прибыль" из 1С, не revenue-cost) - те же цифры, что видно
  // на общей вкладке "Наёмная техника", просто отфильтрованные на одного логиста.
  const logistDetailOut = {};
  Object.keys(logistDetailMap).forEach(function(name) {
    const ld = logistDetailMap[name];
    const supList = Object.values(ld.suppliers).map(function(s) {
      return {
        name: s.name, orders: s.orders, revenue: s.revenue, cost: s.cost, extra_costs: s.extra_costs,
        margin: s.profit, margin_pct: s.revenue > 0 ? Math.round(s.profit / s.revenue * 100) : 0,
        no_waybill: s.no_waybill, not_posted: s.not_posted, no_realiz: s.no_realiz, complete: s.complete,
      };
    }).sort(function(a,b){ return b.revenue - a.revenue; });
    logistDetailOut[name] = {
      by_supplier: supList,
      deals: ld.deals.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); }).slice(0, 300),
    };
  });

  // Общекорпоративные сделки найма (2026-08-10, "Общие сделки" на личной странице логиста) -
  // те же поля, что и у личных deals выше, плюс logist (кто вёл сделку). Обрезка до 500 -
  // компания целиком, объём больше, чем у одного логиста.
  const allHiredDealsOut = allHiredDeals
    .sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); })
    .slice(0, 500);

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
      by_day:          byDay, // {'YYYY-MM-DD': сумма} - для сравнения с "Поступлениями" по дням
      total_cash:      totalCash, // наличные поступления за период (видны только в заказах, не в отчёте 1С по р/с)
      by_day_cash:     byDayCash,
      total_commercial: totalCommercial, // выручка БЕЗ внутригрупповых - для сравнения с "Поступлениями"
      by_day_commercial: byDayCommercial,
      total_amount_thru_yesterday: totalAmountThruYesterday, // числитель прогноза, см. isThruYesterday выше
      total_payment:   totalPayment,
      hired_profit:    hiredProfit,    // прибыль только по найму
      hired_margin_pct: companyMarginPct,           // = hiredProfit/hiredAmountRev, порог 23% для 8/8/2/2
      hired_margin_qualifies: companyMarginQualifies,
      total_hired_cost: totalHiredCost,
      total_balance:   totalBalance,
      internal_orders: internalOrders,
      internal_amount: internalAmount,
      internal_amount_thru_yesterday: internalAmountThruYesterday,
      tral_orders:     tralOrders,
      tral_amount:     tralAmount,
      long_orders:     longOrders,
      long_amount:     longAmount,
      own_long_amount: ownLongAmount, // выручка ТОЛЬКО собственного парка длинномеров (страница Васина - без наёма)
      own_amount:        ownAmount,        // выручка своего парка (не найм)
      hired_amount:      hiredAmountRev,   // выручка по наёмным заказам (сумма клиенту, не оплата поставщику)
      own_tral_orders:   ownTralOrders,
      own_long_orders:   ownLongOrders,
      hired_tral_orders: hiredTralOrders,
      hired_long_orders: hiredLongOrders,
      // Карточка "Заказов" вместо "Топ грузов" (Влад, 2026-07-17).
      hired_profit_tral: hiredProfitTral,
      hired_profit_long: hiredProfitLong,
      funnel_tral_total:   funnelTralTotal,
      funnel_long_total:   funnelLongTotal,
      funnel_tral_problem: funnelTralProblem,
      funnel_long_problem: funnelLongProblem,
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
      // Сверка с "Заказов (свой парк + наём)" (Влад, 2026-07-17: "давай подобьёмся, чтобы
      // было понимание, где что") - воронка считает только внешние коммерческие заказы,
      // остальное сюда не попадает по разным причинам:
      excluded_internal: internalOrders,       // внутренние перевозки (свои же компании)
      excluded_other:    excludedOtherPayment, // служебные строки ("Вариант расчёта" = Прочее)
      excluded_cash:     excludedCashPayment,  // наличные расчёты (структурно без документооборота)
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
    // Длинномеры целиком (2026-08-11, личная страница Васина) - см. getLongHaulDetail_.
    by_driver_no_waybill_long: Object.values(driverMap)
      .filter(function(d){ return d.no_waybill_long > 0; })
      .map(function(d){ return { name: d.name, orders: d.orders_long, no_waybill: d.no_waybill_long }; })
      .sort(function(a,b){ return b.no_waybill-a.no_waybill; }),
    long_funnel: longFunnel,
    all_long_deals: allLongDeals
      .sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); })
      .slice(0, 500),
    by_manager_detail: managerDetail,
    logist_detail:     logistDetailOut,
    all_hired_deals:   allHiredDealsOut,
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
    ingestLiveRows_(normSheet.getRange(2, 1, normSheet.getLastRow() - 1, 44).getValues());
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
    // 8 колонок: Заказчик|Заказов|Выручка|Прибыль|Первый_заказ|Последний_заказ|Менеджер|ПоДням
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
    const agg = {};
    data.forEach(function(r) {
      const name = String(r[0] || '').trim();
      if (!name) return;
      let daily = {};
      try { daily = JSON.parse(r[7] || '{}'); } catch (parseErr) { daily = {}; }
      agg[name] = {
        name: name,
        orders: ordParseNum(r[1]),
        revenue: ordParseNum(r[2]),
        profit: ordParseNum(r[3]),
        first_order: ordFormatDate(r[4]),
        last_order: ordFormatDate(r[5]),
        manager: String(r[6] || '').trim(),
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
        // Менеджер - Влад, 2026-07-07: "после колонки клиент нужен ответственный менеджер".
        // История хранит только ОДНОГО менеджера на клиента (привязан к его самому позднему
        // историческому заказу, см. buildClientHistoryAggregate) - не по дням, поэтому при
        // фильтре по периоду это может показать менеджера чуть неточно (не обязательно того,
        // кто вёл именно последний заказ ВНУТРИ выбранного периода) - приемлемый компромисс,
        // живые строки ниже почти всегда переопределяют на более свежего менеджера.
        byCustomer[name] = { name: name, orders: 0, revenue: 0, profit: 0, first_order: date, last_order: date, manager: h.manager || '' };
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
      byCustomer[r.customer] = { name: r.customer, orders: 0, revenue: 0, profit: 0, first_order: r.date, last_order: r.date, manager: r.mgrSales };
    }
    const c = byCustomer[r.customer];
    c.orders++; c.revenue += r.amount; c.profit += r.profit;
    if (r.date < c.first_order) c.first_order = r.date;
    if (r.date >= c.last_order) { c.last_order = r.date; c.manager = r.mgrSales; }
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
    // только отток". Фильтр по менеджеру (?manager=Цегельников) - Влад, 2026-07-07: "выпадающий
    // список по менеджерам, чтобы выбрать менеджера и посмотреть только по нему" - сравнение
    // подстрокой, т.к. c.manager хранит полное "ФИО +телефон", а параметр приходит фамилией.
    // Без фильтров - топ-100 по выручке среди всех; с любым фильтром - топ-300 среди отфильтрованных
    // (без фильтра топ-100 почти всегда - активные высокодоходные клиенты одних и тех же
    // менеджеров, у отточных/у менеджеров с мелкими клиентами редко высокая выручка для топ-100).
    top_clients: (function() {
      var filtered = customers;
      if (opts.segment) filtered = filtered.filter(function(c) { return c.segment === opts.segment; });
      if (opts.manager) filtered = filtered.filter(function(c) { return String(c.manager || '').indexOf(opts.manager) >= 0; });
      return (opts.segment || opts.manager) ? filtered.slice(0, 300) : filtered.slice(0, 100);
    })(),
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
        first_order: r.date, last_order: r.date, manager: r.mgrSales,
      };
    }
    var c = byCustomer[r.customer];
    c.orders++;
    c.revenue += r.amount;
    c.profit  += r.profit;
    if (r.date < c.first_order) c.first_order = r.date;
    if (r.date >= c.last_order) { c.last_order = r.date; c.manager = r.mgrSales; }
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
