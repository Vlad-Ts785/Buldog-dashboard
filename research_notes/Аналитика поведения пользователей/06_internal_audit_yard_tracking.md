# Внутренний аудит: что Дашборд ЯРД уже собирает о действиях сотрудников в интерфейсе (состояние на 26.09.2026)

Режим работы: только чтение. Код - локальный worktree `nostalgic-jones-3a7d40` (ветка `claude/manager-actions-analytics-204adc`, чистая) и боевой код на VPS `/root/yard-dashboard` (HEAD `78887d8`). Данные - только агрегирующие SELECT к боевой MySQL, выполнены 26.09.2026 около 09:20 МСК. Все `created_at`/`changed_at` в базе хранятся в UTC (сервер в UTC, см. CLAUDE.md, раздел "Время"); где нужен день по Москве - в SQL стоит `+ INTERVAL 3 HOUR`. Тестовые адреса `zzz-smoketest%` исключены. Пользователи указаны только числом.

Обозначения источников:
- `files/...`, `scripts/...` - файлы локального репозитория (номер строки после двоеточия).
- `VPS:api/...`, `VPS:import/...`, `VPS:README.md` - файлы на сервере в `/root/yard-dashboard/`.
- `SQL-N` - запрос из списка в конце раздела 4 (точный текст).

## 1. Инвентаризация: какие экраны пишут какие события, сколько точек вызова, что не покрыто

### Takeaway
Журнал UI-событий `ui_events` подключён к 5 экранам из примерно 30: «Задание» (десктоп), Планировка (десктоп и мобильная), мобильные «Заявки» (`orders-m`, только размер окна) и «Динамика». Всего около 76 точек вызова в 4 файлах; 4 базовых типа событий (`viewport`, `empty_search`, `blocked_click`, `save_error`) плюс 7 типов только на «Динамике». CRM, Найм, Панель, Дебиторка, Справочники, Клиенты, Зарплаты, Калькулятор, приложение водителя и прочие страницы не шлют ни одного UI-события. Переход между страницами (`showPage`) не логируется нигде.

### Cited Findings
- Четыре клиентские реализации `logUiEvent_`, каждая со своим зашитым `page`: `order-plan-v2` - [files/order-plan-v2.js:280-282](files/order-plan-v2.js); общая очередь с параметром `page` для страниц внутри index.html - [files/index.html:33047-33060](files/index.html); `plan-m` - [files/plan-m.html:725-730](files/plan-m.html); `orders-m` - [files/orders-m.html:500-505](files/orders-m.html).
- Число строк с вызовом (без строки определения функции), подсчёт `grep -c 'logUiEvent_(\|dvLog_('`: order-plan-v2.js - 34; index.html - 34 (из них 14 - Планировка `logistics-plan`, 20 - «Динамика» через обёртку `dvLog_`, включая саму обёртку и 2 хелпера); plan-m.html - 8; orders-m.html - 1. Итого около 76 точек - [files/index.html:20837](files/index.html), подсчёт grep от 26.09.
- Файлы без единого вызова: `files/hiring.js`, `files/sprav-person-attrs.js`, `files/app.html`, `files/driver.html`, `files/logist-push-notify.js`, `files/yard-confirm.js`, `files/kp-assets.js`, `files/gos-plate.js` (grep `ui_event|logUiEvent` = 0) - [files/hiring.js](files/hiring.js).
- Модуль CRM в index.html (строки примерно 30247-32393, `CRM.showView`, аналитика `/crm/analytics`) не содержит вызовов `logUiEvent_`: все 34 вызова в index.html лежат в диапазонах 20837-21601 («Динамика») и 36458-38482 (Планировка) - [files/index.html:30446-30469](files/index.html).
- `showPage()` (переключение страниц дашборда) не содержит логирования/fetch - [files/index.html:28978](files/index.html). В index.html около 30 страниц `id="page-..."`: calculator, clients, column-head-payroll, commercial-head-debt, commercial-head-salary, counterparty, crm, debt, dept-trals, director, directory, dynamics, global-stats, gpbq, hiring, logistics-plan, main, my-page, navigation, order-plan, period, receipts, ryschanow-salary, sales, sales-log, sales-mgr, sales-salary, settings, vehicles - [files/index.html](files/index.html) (grep `id="page-`).

Карта «страница -> event_type -> target» (по коду):

| page | event_type | target (что именно) | Где в коде |
|---|---|---|---|
| order-plan-v2 | viewport | пусто, detail = `ШxВ`, раз на загрузку страницы | [files/order-plan-v2.js:1770](files/order-plan-v2.js) |
| order-plan-v2 | empty_search | `cargo` (поиск груза), `geocoder_from`/`geocoder_to` (адрес) | [files/order-plan-v2.js:5359](files/order-plan-v2.js), [:5475](files/order-plan-v2.js) |
| order-plan-v2 | blocked_click | `order_details_denied`, `contract`, `assign_vehicle`, `save`, `repeat_days`, `hired_save`, `by_vehicle`, `sts`, `person_doc`, `person_pass_text`, `soon`, `contract_reopen` | [files/order-plan-v2.js:472-515](files/order-plan-v2.js), [:1048-1074](files/order-plan-v2.js), [:1949](files/order-plan-v2.js), [:3503](files/order-plan-v2.js), [:3674](files/order-plan-v2.js), [:3868-3875](files/order-plan-v2.js), [:5615](files/order-plan-v2.js), [:5740](files/order-plan-v2.js) |
| order-plan-v2 | save_error | `orders/save`, `contract_pdf`, `contract_version`, `contract_stamp_fetch`, `contract_reopen`, `contract_pdf_reopen`, `sts_fetch`, `person_doc_fetch`, `person_pass_text_fetch` | [files/order-plan-v2.js:491-525](files/order-plan-v2.js), [:1041-1118](files/order-plan-v2.js), [:1521-1540](files/order-plan-v2.js), [:5624-5636](files/order-plan-v2.js) |
| logistics-plan | viewport | раз на загрузку | [files/index.html:38482](files/index.html) |
| logistics-plan | empty_search | `customer` (с 18.09 - по паузе 600 мс) | [files/index.html:36850-36866](files/index.html) |
| logistics-plan | blocked_click | `lp_create`, `lp_edit` (detail = текст отказа: дата, пересечение, нет менеджера, нет причины) | [files/index.html:37003-37016](files/index.html), [:37263-37291](files/index.html) |
| logistics-plan | save_error | `seg_save`, `seg_delete` | [files/index.html:36458-36465](files/index.html) |
| plan-m | viewport; blocked_click (`seg_overlap`, `offline` x5); save_error (`seg_save`) | | [files/plan-m.html:1163-1857](files/plan-m.html), [:2497](files/plan-m.html) |
| orders-m | viewport (единственное событие) | | [files/orders-m.html:2591](files/orders-m.html) |
| dynamics | viewport, empty_search (`gos`), passport_open/passport_close (время на паспорте машины в секундах + способ закрытия), fallback, load_error, refresh, period, filter, sort, dead_click (`nores`, `day_nodata`, `band`, `cal_day`/`cal_empty`), blocked_click, pm_period, pm_month | госномер техники в target | [files/index.html:20823-20842](files/index.html), [:20864-21601](files/index.html) |

- Дизайн-намерение зафиксировано: «только смысловые моменты трения», сознательно без времени на странице и «ярости клика» по просьбе Влада не перегружать систему - [VPS:README.md:5262-5269](VPS:README.md); то же в комментарии клиента - [files/order-plan-v2.js:274-279](files/order-plan-v2.js).
- «Динамика» подключена отдельно 15.09 и пишет богаче (время на паспорте, фильтры, сортировки, «мёртвые» клики) - [scripts/DEPLOY_LOG.md:6851](scripts/DEPLOY_LOG.md), [files/index.html:20823-20842](files/index.html).

### Inferences
- Инструментированы только инструменты логистики/продаж по заявкам и технике. Экраны, где работают рекрутеры (Найм), руководители (Панель, Дебиторка, Зарплаты) и CRM (главный рабочий экран менеджеров по лидам), в журнале трения невидимы. Живые данные это подтверждают: роли `recruiter` (3 человека заходили) и `mechanic_long` (1) есть в `access_days`, но в `ui_events` от них нет ни одной строки (см. раздел 4).
- Словаря событий нет: типы и target - свободные строки, у «Динамики» свой набор (`dead_click`, `passport_open`), у остальных - базовые четыре.

### Gaps
- Не проверял отдельные мобильные `app.html`/`driver.html` на наличие иных видов телеметрии, кроме grep на `ui_event`/`logUiEvent`/`sendBeacon` - других механизмов не найдено, но полный построчный разбор не делался.
- Точный список всех экранов по ролям (матрица «Доступ и роли», `access_role_pages`) с полезностью каждого не сопоставлялся - только список `page-*` из index.html.

## 2. Техническое устройство журнала: схема, идентичность, дебаунс, сбои, хранение, кто читает

### Takeaway
Схема минимальная: `email, page, event_type, target, detail, created_at` (время сервера, UTC). Нет ни session_id, ни id события, ни времени клиента, ни версии приложения, ни роли, ни устройства (кроме размера окна). Отправка "тихая": при любой ошибке событие теряется без повтора. Срока хранения нет. На сервере нет ни одного читателя таблицы - только ручные SQL-разборы в сессиях Claude.

### Cited Findings
- DDL: `id BIGINT AUTO_INCREMENT, email VARCHAR(255) NOT NULL, page VARCHAR(60), event_type VARCHAR(30), target VARCHAR(120), detail VARCHAR(300), created_at DATETIME DEFAULT CURRENT_TIMESTAMP`, индексы `idx_page_type(page,event_type)`, `idx_created(created_at)`, `idx_email(email)` - [VPS:import/ui-events-schema.sql](VPS:import/ui-events-schema.sql); индексы подтверждены `SHOW INDEX FROM ui_events` (SQL-14).
- Эндпоинт `POST /api/ui_event`: `express.json({limit:"48kb"})` перед `checkSession`, принимает одиночное событие или `{events:[...]}` до 50 штук (`UI_EVENT_MAX_BATCH`), обрезает page до 60, event_type до 30, target до 120, detail до 300, кривую строку пропускает, пишет одним `INSERT ... VALUES ?`; email берётся из токена сессии (`req.userEmail`), не от клиента - [VPS:api/server.js:12032-12057](VPS:api/server.js).
- Токен сессии содержит только `email`, `role`, `exp` (подписанный HMAC, 48 ч); идентификатора сессии/устройства нет - [VPS:api/server.js:186-204](VPS:api/server.js).
- Клиент index.html: очередь до 120 событий (`UI_LOG_MAX_QUEUE`), отправка пачкой раз в 4 с (`UI_LOG_FLUSH_MS=4000`) по 40 штук, при уходе со страницы - `fetch keepalive` с токеном в заголовке, запасной путь `sendBeacon` с токеном в теле; при переполнении очереди «хвост молча теряется», ошибки глушатся - [files/index.html:33036-33086](files/index.html).
- Клиенты order-plan-v2, plan-m, orders-m отправляют каждое событие отдельным запросом сразу, без очереди и повтора, `.catch(function(){})` - [files/order-plan-v2.js:280-282](files/order-plan-v2.js), [files/plan-m.html:725-730](files/plan-m.html), [files/orders-m.html:500-505](files/orders-m.html).
- Дебаунс только на отдельных полях: подсказка груза - 200 мс на сетевой запрос (лог пишется на каждый пустой ответ) - [files/order-plan-v2.js:5064-5068](files/order-plan-v2.js); геокодер - таймер `geoSuggestT_` - [files/order-plan-v2.js:5449-5453](files/order-plan-v2.js); «Заказчик» в Планировке - отдельный таймер 600 мс именно для лога, добавлен 18.09 после того, как разбор показал лог на каждую клавишу - [files/index.html:36854-36866](files/index.html).
- `viewport` - «раз на страницу, не на каждый дровер» - [files/order-plan-v2.js:1770](files/order-plan-v2.js); на «Динамике» - раз на реальную загрузку (`dvViewportLogged_`) - [files/index.html:20833](files/index.html).
- Чтение таблицы на сервере: единственное упоминание `ui_events` вне INSERT - список «шумных» таблиц эталонных тестов `NOISE_TABLES` - [VPS:tests/golden/golden.js:40](VPS:tests/golden/golden.js); `grep -E "(FROM|JOIN) +ui_events"` по `api/`, `api/lib/`, `import/` - 0 совпадений.
- Срока хранения нет: `DELETE FROM` для `ui_events`, `access_log`, `access_days`, `plan_*_history`, `sprav_audit_log`, `hire_events` в коде не найдено; единственная ротация журнала - `import_runs` старше 30 дней - [VPS:import/import-log.js:54](VPS:import/import-log.js).
- Разбор данных делался вручную: 18.09 - 748 событий, найден реальный баг (`save_error: Data too long for column 'cargo_dims'`, 16 раз у одного менеджера, исправлен в тот же день) и путаница с полем причины ремонта у двух логистов -> правка UX (`lpFlashInvalid_`) и расширение покрытия «Задания» с 6 до ~25 точек - файл памяти `project_ui_events_friction_tracking.md`; 25.09 ширина окон из `viewport` использована для решения о колонке «Примечание» - [scripts/DEPLOY_LOG.md:10049](scripts/DEPLOY_LOG.md).
- Режим «Смотреть как» - чисто клиентская надстройка (`viewAsEntry`), токен остаётся токеном администратора - [files/index.html:9854-9873](files/index.html).
- Версия оболочки приложения существует только внутри service worker (`SHELL_PREFIX = 'app-shell-v-'` + хеш), в события не передаётся - [files/sw.js:36-41](files/sw.js).
- В `detail` хранится то, что человек набрал в поиске (груз, адрес, заказчик, госномер); на «Динамике» явно оговорено «не пишем суммы, ФИО водителей, связку госномер-водитель» - [files/index.html:20828-20833](files/index.html).

### Inferences
- Время события у пачек из index.html - это время вставки на сервере, то есть до ~4 с позже реального, и все события одной пачки получают одинаковый `created_at`; порядок внутри пачки восстанавливается только по `id`. У одиночных отправок время близко к реальному, но тоже серверное.
- Роль пользователя в момент события не сохраняется: анализ по ролям возможен только соединением с текущей `user_access` (роль на момент запроса, не на момент события).
- События «нет связи» структурно не могут дойти: plan-m логирует `blocked_click/offline` именно когда сети нет, и тут же пытается отправить его по сети без буфера. В живых данных `offline` - 0 строк (раздел 4). То же касается `save_error` с detail `сеть` в order-plan-v2 - сетевые сбои систематически недосчитываются.
- В режиме «Смотреть как» действия директора в предпросмотре чужого экрана попадут в `ui_events` под email директора без пометки о предпросмотре (вывод из кода; отдельно не проверялось живым запросом).
- Индексы подходят для текущих ручных запросов (по page/type, дате, email); индекса по `(email, created_at)` для построения последовательностей (сессий) нет, но при текущем объёме (~2,7 тыс. строк, 0,8 МБ) это не существенно.

### Gaps
- Нет документа-словаря событий (event taxonomy) - описания разбросаны по комментариям, README и памяти.
- Не проверено, уведомлены ли сотрудники о журнале действий (для 152-ФЗ/трудовых отношений) - в коде и README упоминаний нет.

## 3. Другие существующие «поведенческие» данные: заходы, присутствие, аудит, история, CRM

### Takeaway
Помимо `ui_events` в базе уже есть богатые журналы действий с автором и временем: история заявок «Задания» (`plan_orders_history`, 2 739 строк, 23 автора), история Планировки (`plan_segs_history`, 3 780), аудит Справочников (`sprav_audit_log`, 1 474), события Найма (`hire_events`, 1 967), аудит доступов, версии договоров. Это готовые event log для process mining по ключевым процессам. Слабое место - CRM: история стадий сделки без автора, у сделки нет поля ответственного, отправитель исходящих сообщений заполнен лишь у ~29%. Заходы считаются одной точкой на сервере (`trackActivity_` в `checkSession`), но это «минуты с открытой вкладкой», а не активная работа.

### Cited Findings
- Счётчик заходов: `trackActivity_(email)` вызывается из `checkSession` для любого авторизованного запроса; «заход» = пауза больше 30 мин (`ACTIVITY_GAP_MIN_`); запись троттлится в памяти не чаще раза в минуту на человека (`ACTIVITY_WRITE_MS_ = 60000`); пишет `access_log` (итог на человека: visits, first/last_visit) и `access_days` (email, day=`CURDATE()`, first_seen, last_seen, hits) - [VPS:api/server.js:268-306](VPS:api/server.js), [VPS:api/server.js:337](VPS:api/server.js); описание - [VPS:README.md:4307-4333](VPS:README.md).
- Служебные запросы (токен + `X-Api-Key`) визитом не считаются с 24.09 после того, как проверочные скрипты засчитали визиты 4 сотрудникам - [VPS:api/server.js:340-346](VPS:api/server.js), [VPS:README.md:8550-8552](VPS:README.md).
- Старый канал: лист Google «Логи_входов» (`logAccessVisit_`) и перенос на сервер `syncAccessLogToServer()`; `legacy_visits` заморожен с 10.09 - [scripts/full_script_final.js:4014-4048](scripts/full_script_final.js), [scripts/full_script_final.js:11469](scripts/full_script_final.js), [VPS:api/server.js:2244-2270](VPS:api/server.js).
- Единственный UI для заходов - карточка «Активность сотрудников» на Панели (только admin): имя, роль, заходы, дни в системе, первый/последний вход - [files/index.html:14859-14883](files/index.html); данные - [VPS:api/server.js:11717-11727](VPS:api/server.js).
- Присутствие «кто сейчас на странице» (heartbeat, флаг active = было действие за последние 7-12 с): «Задание» `/orders/presence` каждые 7 с - [files/order-plan-v2.js:2161-2167](files/order-plan-v2.js); Планировка `/plan/presence` - [files/index.html:36650-36668](files/index.html), [files/plan-m.html:2344](files/plan-m.html); Найм `/hiring/presence` - [files/hiring.js:268-270](files/hiring.js). Таблицы `plan_presence`, `plan_orders_presence`, `hire_presence` хранят только последнее состояние на человека (`last_seen`, `last_active`), не историю - схемы SQL-5.
- Учёт темы: `theme_prefs` (email, theme, updated_at), UPSERT на каждую загрузку - [VPS:api/server.js:12010-12024](VPS:api/server.js), [files/index.html:33087-33096](files/index.html).
- Таблицы-журналы с автором действия (схемы - SQL-5, поиск колонок-авторов - SQL-6):
  - `plan_orders_history` (order_id, action, snapshot JSON, detail, changed_by, changed_at) - действия с заявкой: create, update, status, executor_set/remove/move, take, driver_confirm, otboy_ack, hired_set, transfer_in/out, set_manager, change_request*, delete. Читается в карточке заявки - [VPS:api/lib/plan-orders.js:1501](VPS:api/lib/plan-orders.js).
  - `plan_segs_history` (seg_id, action, snapshot JSON, overwritten_by, recorded_at) - create, overwrite, delete, cancel, undo; лента «кто что делал» в Планировке с откатом - [VPS:api/server.js:7014-7032](VPS:api/server.js), [VPS:api/server.js:7159](VPS:api/server.js), [files/index.html:37373-37474](files/index.html).
  - `sprav_audit_log` (entity_type, entity_id, action, changed_by, changed_at) - правки людей/техники/юрлиц, загрузка/удаление документов, а также `bot_view` (просмотр документа через бота, 78 строк) - SQL-8. Читателя на сервере нет (grep `FROM sprav_audit_log` = 0).
  - `hire_events` (candidate_id, action, from_stage, to_stage, reason_key, comment, actor_email, actor_name, created_at) - воронка Найма; читается в карточке кандидата и в ежедневном отчёте - [VPS:api/lib/hiring.js:277](VPS:api/lib/hiring.js), [VPS:import/hiring-daily-report.js:52](VPS:import/hiring-daily-report.js).
  - `access_audit` (changed_by, target_email, action, before_json, after_json) - правки доступов, экран директора - [VPS:api/server.js:498](VPS:api/server.js).
  - `contract_versions` (order_id, version, generated_at, generated_by, snapshot) - [VPS:api/lib/plan-orders.js:1659-1695](VPS:api/lib/plan-orders.js).
  - Меньшие: `plan_order_change_requests` (requested_by/resolved_by), `fleet_assignments_history`, `sprav_people_team_history`, `sprav_asset_department_history`, `sprav_asset_events`, `kp_log`, `calc_history` (пуста), `sb_check_history` (пуста, без автора), `trip_events` (пуста).
  - Колонки `created_by/updated_by/deleted_by/taken_by/...` есть ещё в ~40 рабочих таблицах (`plan_orders`, `plan_order_executors`, `plan_segs`, `sprav_*`, `bank_operations.assigned_by`, `manager_plans.updated_by` и др.) - это последний автор, не история - SQL-6.
- CRM: `crm_deal_stage_history` = (id, deal_id, stage, entered_at) - без автора; вставки - [VPS:api/server.js:4469](VPS:api/server.js), [VPS:api/server.js:4761](VPS:api/server.js), [VPS:api/lib/avito-sync.js:205](VPS:api/lib/avito-sync.js); при склейке сделки история удаляется `DELETE FROM crm_deal_stage_history WHERE deal_id = ?` - [VPS:api/lib/avito-sync.js:644](VPS:api/lib/avito-sync.js). `crm_deals` не имеет колонки ответственного; ответственный - только у клиента (`crm_clients.responsible_extension`); `crm_messages` (direction in/out, sender_name, created_at, is_read); `crm_calls` (extension, call_state, event_at); `crm_lead_rotation` (client_key, extension, assigned_at) - схемы SQL-7.
- Метрики скорости ответа на лид в коде нет: `grep -i "response_time|first_response|reply_time|время ответа"` по `api/`, `import/` = 0; `/api/crm/analytics` считает длительность сделок и «заявки без ответственного дольше 1 дня» - [VPS:api/server.js:5748-5790](VPS:api/server.js).
- `import_runs` - журнал запусков импортов (не действия людей), ротация 30 дней - [VPS:import/import-log.js:54](VPS:import/import-log.js).

### Inferences
- Для process mining в «Задании» и Планировке уже есть полноценный event log (case id = order_id/seg_id, activity = action, timestamp, resource = changed_by). По CRM полноценного лога нет: нельзя сказать, кто перевёл сделку в стадию, а склейка сделок стирает историю.
- Скорость первого ответа на лид технически вычислима из `crm_messages` (первое входящее -> первое исходящее по `client_key`), но не различает автоответы и живых сотрудников и приписывается сотруднику лишь частично (см. раздел 4).
- `access_days.hits` - это число минут, в которые шёл хоть один авторизованный запрос, включая фоновый опрос открытых вкладок (Задание - heartbeat каждые 7 с). Средний «размах» дня около 13 ч (раздел 4) показывает, что это «вкладка открыта», а не «человек работает». Признак активности (`active` за 7-12 с) клиент уже вычисляет, но сервер хранит только последнее значение.
- День в `access_days` считается по `CURDATE()` сервера в UTC, то есть граница суток - 03:00 МСК; работа с 00:00 до 03:00 МСК попадает в предыдущий день.

### Gaps
- Не проверял, пишут ли `bank_operations`/`receipts_plan_items`/`manager_plans` отдельную историю изменений кроме полей `*_by` (по списку таблиц - отдельных history-таблиц нет).
- `max_messages` (1 110 строк, переписка бота MAX) и `crm_call_transcripts` не разбирались как поведенческие данные.

## 4. Живые агрегаты (боевая MySQL, 26.09.2026)

### Takeaway
За 13 дней (с 13.09 16:03 МСК) в `ui_events` 2 695 событий от 21 пользователя (из 27 активных учёток). 48% - `viewport`, 42% - `empty_search` (из них большая часть - продолжение набора одного запроса), настоящих сигналов трения (`blocked_click` + `save_error`) - 191 (7%). 20% всех событий - от единственного пользователя с ролью director. Счётчик заходов (`access_days`) - 264 человеко-дня, 25 человек с 10.09. Журналы бизнес-действий на порядок богаче: 2 739 + 3 780 + 1 474 + 1 967 строк с авторами.

### Cited Findings
- Всего в `ui_events` 2 697 строк, из них 2 тестовые `zzz%` (остались в таблице) - SQL-1; без них 2 695 событий, 21 пользователь, с 2026-09-13 13:03:03 UTC по 2026-09-26 06:12:58 UTC, 14 календарных дней МСК - SQL-2. (Оценка `information_schema.table_rows` = 2 484, 0,8 МБ - приблизительная.)
- По страницам (события / пользователи): order-plan-v2 1 749 / 18; logistics-plan 372 / 14; orders-m 256 / 14 (с 19.09); plan-m 219 / 7; dynamics 99 / 3 - SQL-3.
- По типам: viewport 1 299 (48,2%), empty_search 1 121 (41,6%), blocked_click 159 (5,9%), save_error 32 (1,2%), прочие типы «Динамики» 84 (3,1%: passport_open 35, passport_close 35, filter 7, period 4, fallback 1, refresh 1, dead_click 1) - SQL-4.
- По ролям (текущая роль из `user_access`): manager 1 170 событий / 8 чел.; director 551 / 1; logist 503 / 6; sales_head 380 / 2; fleet_head 53 / 1; column_head 31 / 2; logistics_head 7 / 1 - SQL-9. Доля самого активного пользователя - 551 из 2 695 = 20,4% - SQL-13.
- По дням (МСК, события / пользователи): 13.09 20/2; 14.09 141/13; 15.09 133/12; 16.09 135/11; 17.09 100/13; 18.09 219/16; 19.09 79/8; 20.09 131/12; 21.09 356/16; 22.09 350/15; 23.09 349/18; 24.09 283/18; 25.09 397/19; 26.09 (неполный) 2/2 - SQL-10. Рост с ~130/день до ~350/день после 21.09 совпадает с полным переходом на «Задание» (лист Google отключён 18.09, по памяти проекта).
- Топ-15 (page, event_type, target): order-plan-v2/empty_search/cargo 764 (12 чел.); order-plan-v2/viewport 498 (18); logistics-plan/viewport 313 (14); orders-m/viewport 256 (14); plan-m/viewport 217 (7); order-plan-v2/empty_search/geocoder_from 178 (12); order-plan-v2/empty_search/geocoder_to 157 (12); order-plan-v2/blocked_click/order_details_denied 75 (5); logistics-plan/blocked_click/lp_create 27 (5); logistics-plan/empty_search/customer 22 (2); order-plan-v2/blocked_click/contract 22 (3); order-plan-v2/save_error/orders/save 21 (4); order-plan-v2/blocked_click/assign_vehicle 17 (4); dynamics/viewport 15 (3); order-plan-v2/blocked_click/save 9 (6) - SQL-11.
- Все сигналы трения: order-plan-v2 blocked_click - order_details_denied 75, contract 22, assign_vehicle 17, save 9, repeat_days 2; order-plan-v2 save_error - orders/save 21, contract_reopen 6; logistics-plan blocked_click - lp_create 27, lp_edit 5; logistics-plan save_error - seg_save 5; plan-m blocked_click - seg_overlap 2 (событий `offline` - 0); dynamics - dead_click/band 1, fallback/vehicle_timeline 1 - SQL-12.
- Шум `empty_search`: доля событий, которые являются продолжением набора (предыдущее событие того же человека в том же поле не более 10 с назад и текущий запрос начинается с предыдущего): cargo 470 из 764 (61,5%); geocoder_from 23 из 178; geocoder_to 26 из 157; customer 16 из 22 - SQL-15. Одинаковых строк в одну секунду: 37 групп, 46 лишних строк - SQL-16.
- `viewport` на человеко-день (прокси числа загрузок страницы): order-plan-v2 3,9; logistics-plan 3,6; orders-m 4,7; plan-m 4,2; dynamics 1,5 - SQL-17. Ширина окна: order-plan-v2 - 441 из 498 загрузок от 1280 px и шире, 47 уже 768; orders-m - 215 из 256 уже 768; plan-m - 180 из 217 уже 768 - SQL-18.
- Часы (МСК): пик 10-17 ч (229-293 события в час), заметная активность ночью: 23 ч - 70, 0 ч - 39, 1 ч - 24 - SQL-19.
- «Динамика»: 35 закрытий паспорта машины, время на паспорте от 1 до 977 с, среднее 37 с - SQL-20.
- `access_log`: 28 строк (человек), живых заходов 595 + замороженных legacy 743, первый вход 2026-08-13 08:05 UTC, последний 2026-09-26 06:21 UTC, активны за 7 дней - 25 - SQL-21.
- `access_days`: 264 человеко-дня, 25 человек, 10.09-26.09, hits всего 128 134, средний размах first_seen-last_seen 797 мин - SQL-22. По дням (человек / hits): 10.09 12/3 740; 14.09 16/6 350; 18.09 18/8 207; 21.09 17/7 735; 22.09 18/10 551; 23.09 19/11 273; 24.09 20/12 252; 25.09 24/13 929 - SQL-23. По ролям (человек / человеко-дней): manager 8/103; logist 6/68; sales_head 2/34; director 1/17; column_head 2/14; mechanic_long 1/11; logistics_head 1/7; recruiter 3/7; fleet_head 1/3 - SQL-24.
- `user_access`: 27 активных учёток (manager 8, logist 6, recruiter 4, column_head 2, sales_head 2, director 1, fleet_head 1, logistics_head 1, mechanic_long 1, mechanic_tral 1) - SQL-25. В `ui_events` 21 уникальный пользователь против 25 в `access_days` с 13.09 - SQL-27. `theme_prefs`: тёмная 23, светлая 4 - SQL-26.
- Журналы действий (строк / уникальных авторов / период UTC) - SQL-8:

| Таблица | Строк | Авторов | С | По |
|---|---|---|---|---|
| plan_segs_history | 3 780 | 13 | 2026-08-30 | 2026-09-25 |
| plan_orders_history | 2 739 | 23 | 2026-09-11 | 2026-09-26 |
| hire_events | 1 967 | 5 | 2025-09-12 (импорт истории HR) | 2026-09-25 |
| sprav_audit_log | 1 474 | 17 | 2026-08-30 | 2026-09-25 |
| crm_deal_stage_history | 1 073 | нет колонки | 2026-08-21 | 2026-09-25 |
| crm_messages | 5 034 | 11 отправителей | 2025-09-24 (синк Авито) | 2026-09-25 |
| crm_calls | 1 869 | 5 добавочных | 2026-08-27 | 2026-09-25 |
| crm_deals | 397 | нет колонки | 2026-08-21 | 2026-09-25 |
| max_messages | 1 110 | 20 чатов | 2026-09-11 | 2026-09-26 |
| access_audit | 42 | 4 | 2026-09-23 | 2026-09-24 |
| contract_versions | 20 | 4 | 2026-09-22 | 2026-09-25 |
| sprav_asset_events | 17 | 2 | 2026-09-09 | 2026-09-18 |
| sprav_people_team_history | 14 | 1 | 2026-09-24 | 2026-09-24 |
| crm_lead_rotation | 12 | 4 добавочных | 2026-09-24 | 2026-09-24 |
| sprav_asset_department_history | 8 | 1 | 2026-09-24 | 2026-09-24 |
| kp_log | 4 | 1 | 2026-08-21 | 2026-09-11 |
| plan_order_change_requests | 3 | 2 | 2026-09-11 | 2026-09-22 |
| fleet_assignments_history | 2 | 1 | 2026-09-07 | 2026-09-17 |
| import_runs (системный) | 49 642 | 12 скриптов | 2026-08-27 | 2026-09-26 |

- Действия в `plan_orders_history`: update 643, status 471, create 426, executor_set 350, take 324, driver_confirm 165, executor_remove 94, otboy_ack 80, hired_set 78, delete 46, transfer_in/out по 20, set_manager 14, прочие единицы - SQL-8. `plan_segs_history`: overwrite 2 217, create 1 142, delete 363, cancel 57, undo 1. `hire_events`: import 1 245, sb 266, avito 123 (системные, без автора), create 123, move 94, edit 63, comment 28, doc 13, assign 9. `sprav_audit_log`: person/update 443, person_document/upload 269, asset_document/upload 185, person_document/delete 184, asset/update 134, person_document/bot_view 78 и далее. `crm_deal_stage_history`: new 401, lost 310, in_progress 178, quote 78, execution 45, negotiation 35, won 26.
- CRM, первый ответ на Авито (ветки с первым входящим за последние 30 дней): 225 веток, без ответа 28, ответ до 5 мин 98, 5-29 мин 22, 30-119 мин 37, 2 ч и больше 40 - SQL-28. Отправитель заполнен у 692 из 2 417 исходящих (28,6%, 11 разных имён) - SQL-29. Ответственный назначен у 380 из 1 257 клиентов CRM (30,2%) - SQL-31. Состояния звонков: Disconnected 572, Appeared 571, summary 243, recording 163, Connected 162, record/added 158 - SQL-30.
- Присутствие (только текущее состояние): plan_presence 27 строк, plan_orders_presence 19, hire_presence 4 - SQL-32.

#### Точный SQL (выполнялся на VPS через `mysql` с данными из `grep "^MYSQL_" .env`; фильтр `F` = `e.email NOT LIKE 'zzz-smoketest%'`)

```sql
-- SQL-1
SELECT SUM(email LIKE 'zzz%') zzz, SUM(email LIKE '%test%') test_like, SUM(email='') empty_email, COUNT(*) total FROM ui_events;
-- SQL-2
SELECT COUNT(*) n, COUNT(DISTINCT email) users, MIN(created_at) min_utc, MAX(created_at) max_utc,
       COUNT(DISTINCT DATE(created_at + INTERVAL 3 HOUR)) days_msk
FROM ui_events WHERE email NOT LIKE 'zzz-smoketest%';
-- SQL-3
SELECT page, COUNT(*) n, COUNT(DISTINCT email) users, MIN(created_at) first_utc, MAX(created_at) last_utc
FROM ui_events WHERE email NOT LIKE 'zzz-smoketest%' GROUP BY page ORDER BY n DESC;
-- SQL-4
SELECT page, event_type, COUNT(*) n, COUNT(DISTINCT email) users
FROM ui_events WHERE email NOT LIKE 'zzz-smoketest%' GROUP BY page, event_type ORDER BY page, n DESC;
-- SQL-5 (схемы)
SELECT table_name, GROUP_CONCAT(CONCAT(column_name,':',data_type) ORDER BY ordinal_position SEPARATOR ', ')
FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name IN ('access_log','access_days','access_audit',
 'theme_prefs','plan_presence','plan_orders_presence','hire_presence','sprav_audit_log','crm_deal_stage_history','crm_calls',
 'crm_lead_rotation','plan_segs_history','plan_orders_history','hire_events','contract_versions','sprav_people_team_history',
 'sprav_asset_department_history','fleet_assignments_history','plan_order_change_requests','kp_log','calc_history',
 'sprav_asset_events','trip_events','court_case_events','calltouch_calls','crm_call_transcripts','hire_ocr_log',
 'sb_check_history','import_runs','user_access') GROUP BY table_name ORDER BY table_name;
-- SQL-6 (колонки-авторы во всех таблицах)
SELECT table_name, GROUP_CONCAT(column_name ORDER BY column_name) FROM information_schema.columns
WHERE table_schema=DATABASE() AND column_name REGEXP '(^|_)(by|by_email|by_name|author|actor|user_email|changed_by|created_by|updated_by|edited_by|deleted_by|assigned_by|responsible|owner_email|manager_email)$|_by$|_by_email$|_by_name$'
GROUP BY table_name ORDER BY table_name;
-- SQL-7 (схемы CRM/Авито/MAX)
SELECT table_name, table_rows, GROUP_CONCAT(column_name ORDER BY ordinal_position SEPARATOR ',')
FROM information_schema.columns c JOIN information_schema.tables t USING (table_schema, table_name)
WHERE table_schema=DATABASE() AND (table_name LIKE 'crm%' OR table_name LIKE 'avito%' OR table_name LIKE 'max_%' OR table_name LIKE 'driver%')
GROUP BY table_name, table_rows ORDER BY table_name;
-- SQL-8 (журналы: размер/авторы/период + разбивки по action)
SELECT 'sprav_audit_log' t, COUNT(*) n, COUNT(DISTINCT changed_by) actors, MIN(changed_at) mn, MAX(changed_at) mx FROM sprav_audit_log
UNION ALL SELECT 'plan_orders_history', COUNT(*), COUNT(DISTINCT changed_by), MIN(changed_at), MAX(changed_at) FROM plan_orders_history
UNION ALL SELECT 'plan_segs_history', COUNT(*), COUNT(DISTINCT overwritten_by), MIN(recorded_at), MAX(recorded_at) FROM plan_segs_history
UNION ALL SELECT 'hire_events', COUNT(*), COUNT(DISTINCT actor_email), MIN(created_at), MAX(created_at) FROM hire_events
UNION ALL SELECT 'crm_deal_stage_history', COUNT(*), NULL, MIN(entered_at), MAX(entered_at) FROM crm_deal_stage_history
UNION ALL SELECT 'crm_messages', COUNT(*), COUNT(DISTINCT sender_name), MIN(created_at), MAX(created_at) FROM crm_messages
UNION ALL SELECT 'crm_calls', COUNT(*), COUNT(DISTINCT extension), MIN(event_at), MAX(event_at) FROM crm_calls
UNION ALL SELECT 'crm_deals', COUNT(*), NULL, MIN(created_at), MAX(created_at) FROM crm_deals
UNION ALL SELECT 'crm_lead_rotation', COUNT(*), COUNT(DISTINCT extension), MIN(assigned_at), MAX(assigned_at) FROM crm_lead_rotation
UNION ALL SELECT 'contract_versions', COUNT(*), COUNT(DISTINCT generated_by), MIN(generated_at), MAX(generated_at) FROM contract_versions
UNION ALL SELECT 'access_audit', COUNT(*), COUNT(DISTINCT changed_by), MIN(changed_at), MAX(changed_at) FROM access_audit
-- ... (аналогично fleet_assignments_history, plan_order_change_requests, sprav_people_team_history,
--      sprav_asset_department_history, sprav_asset_events, kp_log, calc_history, max_messages, import_runs, trip_events)
;
SELECT entity_type, action, COUNT(*) n FROM sprav_audit_log GROUP BY 1,2 ORDER BY n DESC LIMIT 20;
SELECT action, COUNT(*) n, COUNT(DISTINCT changed_by) actors FROM plan_orders_history GROUP BY 1 ORDER BY n DESC LIMIT 25;
SELECT action, COUNT(*) n, COUNT(DISTINCT overwritten_by) actors FROM plan_segs_history GROUP BY 1 ORDER BY n DESC;
SELECT action, COUNT(*) n, COUNT(DISTINCT actor_email) actors FROM hire_events GROUP BY 1 ORDER BY n DESC LIMIT 15;
SELECT channel, direction, COUNT(*) n FROM crm_messages GROUP BY 1,2 ORDER BY n DESC;
SELECT stage, COUNT(*) n FROM crm_deal_stage_history GROUP BY 1 ORDER BY n DESC;
-- SQL-9 (по ролям; COLLATE из-за разных collation у таблиц)
SELECT COALESCE(u.role_key,'(нет в user_access)') role_key, COUNT(*) n, COUNT(DISTINCT e.email) users
FROM ui_events e LEFT JOIN user_access u ON u.email COLLATE utf8mb4_0900_ai_ci = e.email
WHERE e.email NOT LIKE 'zzz-smoketest%' GROUP BY 1 ORDER BY n DESC;
-- SQL-10 (по дням МСК)
SELECT DATE(e.created_at + INTERVAL 3 HOUR) day_msk, COUNT(*) n, COUNT(DISTINCT e.email) users,
  SUM(e.event_type='viewport') viewport, SUM(e.event_type='empty_search') empty_search,
  SUM(e.event_type='blocked_click') blocked, SUM(e.event_type='save_error') save_err,
  SUM(e.event_type NOT IN ('viewport','empty_search','blocked_click','save_error')) other
FROM ui_events e WHERE e.email NOT LIKE 'zzz-smoketest%' GROUP BY 1 ORDER BY 1;
-- SQL-11 (топ-15)
SELECT e.page, e.event_type, e.target, COUNT(*) n, COUNT(DISTINCT e.email) users
FROM ui_events e WHERE e.email NOT LIKE 'zzz-smoketest%' GROUP BY 1,2,3 ORDER BY n DESC LIMIT 15;
-- SQL-12 (все сигналы трения)
SELECT e.page, e.event_type, e.target, COUNT(*) n, COUNT(DISTINCT e.email) users FROM ui_events e
WHERE e.email NOT LIKE 'zzz-smoketest%' AND e.event_type IN ('blocked_click','save_error','dead_click','load_error','fallback')
GROUP BY 1,2,3 ORDER BY 1,2,n DESC;
-- SQL-13 (концентрация)
SELECT MAX(n) top_user_events, SUM(n) total, ROUND(100*MAX(n)/SUM(n),1) top_pct
FROM (SELECT email, COUNT(*) n FROM ui_events WHERE email NOT LIKE 'zzz-smoketest%' GROUP BY email) x;
-- SQL-14
SHOW INDEX FROM ui_events;
-- SQL-15 (empty_search: продолжение набора)
WITH s AS (SELECT page, target, email, detail, created_at, LAG(detail) OVER w prev_detail, LAG(created_at) OVER w prev_at
  FROM ui_events WHERE event_type='empty_search' AND email NOT LIKE 'zzz-smoketest%'
  WINDOW w AS (PARTITION BY email, page, target ORDER BY id))
SELECT page, target, COUNT(*) n,
  SUM(prev_at IS NOT NULL AND TIMESTAMPDIFF(SECOND, prev_at, created_at) <= 10 AND LEFT(detail, CHAR_LENGTH(prev_detail)) = prev_detail) typing_continuation,
  COUNT(DISTINCT CONCAT(email,'|',detail)) distinct_user_query
FROM s GROUP BY page, target ORDER BY n DESC;
-- SQL-16 (дубли в одну секунду)
SELECT COUNT(*) dup_groups, SUM(c-1) extra_rows FROM (SELECT email, page, event_type, target, detail, created_at, COUNT(*) c
  FROM ui_events WHERE email NOT LIKE 'zzz-smoketest%' GROUP BY 1,2,3,4,5,6 HAVING c>1) x;
-- SQL-17 (viewport на человеко-день)
SELECT page, COUNT(*) viewport_events, COUNT(DISTINCT CONCAT(email,'|',DATE(created_at + INTERVAL 3 HOUR))) user_days,
  ROUND(COUNT(*)/COUNT(DISTINCT CONCAT(email,'|',DATE(created_at + INTERVAL 3 HOUR))),1) per_user_day
FROM ui_events WHERE event_type='viewport' AND email NOT LIKE 'zzz-smoketest%' GROUP BY page ORDER BY viewport_events DESC;
-- SQL-18 (ширина окна)
SELECT e.page, SUM(CAST(SUBSTRING_INDEX(e.detail,'x',1) AS UNSIGNED) < 768) mobile_lt768,
  SUM(CAST(SUBSTRING_INDEX(e.detail,'x',1) AS UNSIGNED) BETWEEN 768 AND 1279) mid,
  SUM(CAST(SUBSTRING_INDEX(e.detail,'x',1) AS UNSIGNED) >= 1280) wide
FROM ui_events e WHERE e.email NOT LIKE 'zzz-smoketest%' AND e.event_type='viewport' GROUP BY 1;
-- SQL-19 (час МСК)
SELECT HOUR(created_at + INTERVAL 3 HOUR) h_msk, COUNT(*) n FROM ui_events WHERE email NOT LIKE 'zzz-smoketest%' GROUP BY 1 ORDER BY 1;
-- SQL-20 (время на паспорте машины, «Динамика»)
SELECT COUNT(*) n, MIN(CAST(SUBSTRING_INDEX(detail, 'с', 1) AS UNSIGNED)) min_s, ROUND(AVG(CAST(SUBSTRING_INDEX(detail, 'с', 1) AS UNSIGNED))) avg_s,
  MAX(CAST(SUBSTRING_INDEX(detail, 'с', 1) AS UNSIGNED)) max_s
FROM ui_events WHERE page='dynamics' AND event_type='passport_close' AND detail REGEXP '^[0-9]+';
-- SQL-21
SELECT COUNT(*) users, SUM(visits) visits_live, SUM(legacy_visits) visits_legacy, MIN(first_visit) min_first_utc,
  MAX(last_visit) max_last_utc, SUM(last_visit >= NOW() - INTERVAL 7 DAY) active_7d
FROM access_log WHERE email NOT LIKE 'zzz-smoketest%';
-- SQL-22
SELECT COUNT(*) user_days, COUNT(DISTINCT email) users, MIN(day) min_day, MAX(day) max_day, SUM(hits) hits,
  ROUND(AVG(TIMESTAMPDIFF(MINUTE, first_seen, last_seen))) avg_span_min
FROM access_days WHERE email NOT LIKE 'zzz-smoketest%';
-- SQL-23
SELECT day, COUNT(*) users, SUM(hits) hits, ROUND(AVG(TIMESTAMPDIFF(MINUTE, first_seen, last_seen))) avg_span_min
FROM access_days WHERE email NOT LIKE 'zzz-smoketest%' AND day >= CURDATE() - INTERVAL 21 DAY GROUP BY day ORDER BY day;
-- SQL-24
SELECT COALESCE(u.role_key,'(нет)') role_key, COUNT(DISTINCT a.email) users, COUNT(*) user_days
FROM access_days a LEFT JOIN user_access u ON u.email COLLATE utf8mb4_unicode_ci = a.email COLLATE utf8mb4_unicode_ci
WHERE a.email NOT LIKE 'zzz-smoketest%' GROUP BY 1 ORDER BY user_days DESC;
-- SQL-25
SELECT role_key, SUM(active=1) active, SUM(active=0) inactive FROM user_access GROUP BY role_key ORDER BY active DESC;
-- SQL-26
SELECT theme, COUNT(*) n FROM theme_prefs GROUP BY theme;
-- SQL-27
SELECT (SELECT COUNT(DISTINCT email) FROM ui_events WHERE email NOT LIKE 'zzz-smoketest%') ui_users,
       (SELECT COUNT(DISTINCT email) FROM access_days WHERE day >= '2026-09-13' AND email NOT LIKE 'zzz-smoketest%') access_users_since_13_09;
-- SQL-28 (первый ответ в чате Авито)
WITH fi AS (SELECT client_key, MIN(created_at) first_in FROM crm_messages
            WHERE channel='avito' AND direction='in' AND created_at >= NOW() - INTERVAL 30 DAY GROUP BY client_key),
     fo AS (SELECT fi.client_key, fi.first_in, MIN(m.created_at) first_out FROM fi
            LEFT JOIN crm_messages m ON m.client_key=fi.client_key AND m.direction='out' AND m.created_at >= fi.first_in
            GROUP BY fi.client_key, fi.first_in)
SELECT COUNT(*) threads, SUM(first_out IS NULL) no_reply, SUM(TIMESTAMPDIFF(MINUTE, first_in, first_out) < 5) lt5m,
  SUM(TIMESTAMPDIFF(MINUTE, first_in, first_out) BETWEEN 5 AND 29) m5_30,
  SUM(TIMESTAMPDIFF(MINUTE, first_in, first_out) BETWEEN 30 AND 119) m30_120,
  SUM(TIMESTAMPDIFF(MINUTE, first_in, first_out) >= 120) ge2h FROM fo;
-- SQL-29
SELECT direction, COUNT(*) n, SUM(sender_name IS NOT NULL AND sender_name<>'') with_sender, COUNT(DISTINCT sender_name) distinct_senders
FROM crm_messages GROUP BY direction;
-- SQL-30
SELECT call_state, COUNT(*) n FROM crm_calls GROUP BY 1 ORDER BY n DESC LIMIT 10;
-- SQL-31
SELECT COUNT(*) clients, SUM(responsible_extension IS NOT NULL) with_resp FROM crm_clients;
-- SQL-32
SELECT 'plan_presence' t, COUNT(*) n, MAX(last_seen) mx FROM plan_presence
UNION ALL SELECT 'plan_orders_presence', COUNT(*), MAX(last_seen) FROM plan_orders_presence
UNION ALL SELECT 'hire_presence', COUNT(*), MAX(last_seen) FROM hire_presence;
```

### Inferences
- Если убрать `viewport` и продолжения набора в `empty_search`, «содержательных» событий остаётся примерно 1 000 за 13 дней, из них реальных отказов/ошибок (`blocked_click` + `save_error`) - 191. Главный повторяющийся сигнал - `order_details_denied` (75 раз у 5 человек): люди регулярно кликают в чужие заявки, куда доступа нет по правилу от 17.09.
- 20% журнала - события одного пользователя с ролью director, то есть заметная часть данных - собственные проверки и просмотр директора, а не рабочие действия сотрудников; флага «служебный/тест/предпросмотр» в данных нет.
- Средний размах дня в `access_days` ~13 ч и ночные события в `ui_events` (23-01 ч МСК) согласуются с тем, что вкладки держатся открытыми сутками и часть работы идёт вечером; `access_days` не отличает присутствие от работы.
- По скорости ответа в CRM: около 44% новых веток Авито получают первый ответ быстрее 5 минут, около 18% ждут 2 часа и дольше, 12% без ответа (225 веток за 30 дней). Метрика грубая: исходящие могут включать автоответы, сотрудник указан лишь у 29% исходящих.

### Gaps
- Не удалось отделить автоответы бота/ИИ-агента от ответов людей в `crm_messages` (поле-признак не искал; `sender_name` заполнен частично) - цифры SQL-28 нельзя трактовать как скорость реакции менеджеров.
- `hits` в `access_days` зависит от поллинга конкретных страниц, точную долю фонового трафика не выделял.
- Не проверял, сколько событий потеряно на клиенте (переполнение очереди, сетевые сбои) - сервер этого не видит, данных нет.

## 5. Разрывы относительно типичной профессиональной схемы (факты, без проектов переделки)

### Takeaway
Сейчас это «журнал трения» плюс счётчик заходов, а не продуктовая аналитика: нет просмотров экранов, нет сессий, нет старта/завершения задач, нет времени выполнения, нет версии приложения, нет связи события с бизнес-объектом и результатом, нет хранения/чтения кроме ручного SQL. При этом бизнес-журналы (`plan_orders_history`, `plan_segs_history`, `hire_events`, `sprav_audit_log`) уже дают связку «кто - что - когда - с каким объектом» для process mining по заявкам, Планировке и Найму.

### Cited Findings
- Нет `session_id`/id события: схема `ui_events` - только email/page/event_type/target/detail/created_at - [VPS:import/ui-events-schema.sql](VPS:import/ui-events-schema.sql); токен несёт только email/role/exp - [VPS:api/server.js:186-204](VPS:api/server.js). «Сессия» определяется только на сервере для счётчика заходов (пауза 30 мин), в `ui_events` не пишется - [VPS:api/server.js:268-306](VPS:api/server.js).
- Нет времени клиента и очерёдности внутри пачки: `created_at DEFAULT CURRENT_TIMESTAMP` на сервере, пачки раз в 4 с - [files/index.html:33037](files/index.html), [VPS:api/server.js:12049](VPS:api/server.js).
- Нет page_view/screen_view: `showPage()` не логирует - [files/index.html:28978](files/index.html); `viewport` пишется только при загрузке 5 страниц, а не при переходах.
- Нет событий старта/завершения задачи и длительности (кроме паспорта на «Динамике»): сознательное решение «не считаем время-на-странице» - [VPS:README.md:5267-5269](VPS:README.md); единственный замер длительности - `passport_close` с секундами - [files/index.html:20839-20842](files/index.html).
- Нет версии приложения в событиях: версия оболочки живёт только в service worker - [files/sw.js:36-41](files/sw.js).
- Нет связи с бизнес-объектом: target у большинства событий - имя элемента/поля (`contract`, `save`, `cargo`), id заявки не передаётся; например, `order_details_denied` пишется с пустым detail - [files/order-plan-v2.js:1949](files/order-plan-v2.js).
- Нет роли/устройства на момент события: роль выводится только соединением с текущей `user_access` (SQL-9); из устройства есть только ширина/высота окна - [files/order-plan-v2.js:1770](files/order-plan-v2.js).
- Нет срока хранения и нет читателей/отчётов по `ui_events` на сервере (grep `FROM ui_events` = 0; ротация есть только у `import_runs`) - [VPS:import/import-log.js:54](VPS:import/import-log.js), [VPS:tests/golden/golden.js:40](VPS:tests/golden/golden.js).
- Четыре разные клиентские реализации (очередь с пачками в index.html против одиночных fetch в трёх других файлах) - [files/index.html:33047](files/index.html), [files/order-plan-v2.js:280](files/order-plan-v2.js), [files/plan-m.html:725](files/plan-m.html), [files/orders-m.html:500](files/orders-m.html).
- Тестовые и служебные данные смешаны с рабочими: 2 строки `zzz%` в `ui_events` (SQL-1); служебные запросы исключены из счётчика заходов только с 24.09 - [VPS:README.md:8550-8552](VPS:README.md).
- CRM без автора изменения стадии и с удалением истории при склейке - [VPS:api/server.js:4761](VPS:api/server.js), [VPS:api/lib/avito-sync.js:644](VPS:api/lib/avito-sync.js).
- Присутствие/активность вычисляется клиентом (действие за последние 7-12 с), но сервер хранит только последнее состояние - [files/order-plan-v2.js:2161-2166](files/order-plan-v2.js), схемы `*_presence` (SQL-5).
- `access_days` режет сутки по UTC (`CURDATE()`, сервер в UTC) - [VPS:api/server.js:299-302](VPS:api/server.js).

### Inferences
- Самый дешёвый путь к «поведенческой» аналитике по ключевым процессам - не расширять `ui_events`, а использовать уже существующие бизнес-журналы (`plan_orders_history` и др.), где есть case id, действие, автор и время; `ui_events` полезен как дополнение про трение, а не как основной источник.
- Без session_id и без page_view в `ui_events` невозможно восстановить путь пользователя (последовательность экранов), посчитать воронку по интерфейсу или время выполнения задачи; можно лишь считать частоты отказов по полям.
- Сетевые сбои систематически недосчитываются (событие о сбое отправляется той же сетью без буфера), поэтому `save_error: сеть` и `offline` в журнале почти отсутствуют не потому, что их нет.

### Gaps
- Нет данных о том, сколько событий теряется на клиенте и сколько запросов `/api/ui_event` падает (логи nginx по коду ответа не анализировались).
- Не проверялось, есть ли в `plan_orders_history.snapshot` достаточно полей для расчёта длительностей этапов заявки (JSON-снимки не разбирались).
- Юридическая сторона (уведомление сотрудников о сборе данных о действиях, 152-ФЗ) в проекте не отражена - вопрос к Владу.
