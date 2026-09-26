-- Журнал действий «Гладкая работа» (26.09.2026, plans/2026-09-26-smooth-work-ux-analytics.md в
-- репозитории дашборда, Фаза 1А). Каждый клик, выбор, переход и итог работы с полем со всех
-- экранов index.html, plan-m.html, orders-m.html (files/ux-track.js -> POST /api/ux/batch,
-- api/lib/ux-events.js). Цель - найти лишние действия, НЕ контроль людей: отчёты строятся по
-- экранам и шагам, без рейтингов сотрудников.
-- НЕ дублирует ui_events (там редкие смысловые сигналы трения, 13.09) - тот журнал не трогаем.
-- Набранный текст здесь не хранится никогда: для полей только длина, время, нажатия, вставка.
-- Сырьё живёт 90 дней (import/ux-events-cleanup.js, ночью через run-job.js), ~15-20 тыс. строк/день.
--
-- Все времена - UTC (правило CLAUDE.md): client_ts - время устройства из события (t, мс),
-- server_ts - время приёма. Сервер подставляет своё время, если часы устройства врут
-- больше чем на 7 дней назад / час вперёд.
--
-- Повтор пачки (клиент доставляет «хотя бы раз»: обрыв связи после записи, уход со страницы)
-- склеивается уникальным ключом uq_event (sid, seq, client_ts) + INSERT ... ON DUPLICATE KEY.
-- client_ts в ключе - на случай дубля вкладки: браузер копирует sessionStorage вместе с sid и
-- seq, у двух вкладок совпадут (sid, seq), но не время с точностью до мс.
--
-- Сравнение строк: как у ui_events/plan_orders_history (utf8mb4_0900_ai_ci). access_users,
-- user_access, hire_events - utf8mb4_unicode_ci: при JOIN по email писать
-- `ON u.email = a.email COLLATE utf8mb4_unicode_ci` или двумя запросами (как в watchdog.js).
--
-- Применить: mysql --default-character-set=utf8mb4 yard_dashboard < import/ux-events-schema.sql
CREATE TABLE IF NOT EXISTS ux_events (
  id BIGINT NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,                      -- из токена сессии, клиент не присылает
  role VARCHAR(40) DEFAULT NULL,                    -- роль на момент события (access_users/токен)
  sid CHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, -- вкладка; ascii - ключ в 4 раза уже
  seq INT NOT NULL,                                 -- сквозной номер внутри вкладки
  client_ts DATETIME(3) NOT NULL,                   -- UTC, время устройства
  server_ts DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), -- UTC, приём сервером
  page VARCHAR(60) NOT NULL,                        -- экран: id страницы index.html, plan-m, orders-m
  kind VARCHAR(16) NOT NULL,                        -- view|click|change|field|vis|js_error
  target VARCHAR(160) DEFAULT NULL,                 -- имя действия; у view - откуда пришёл; у js_error - файл:строка
  area VARCHAR(80) DEFAULT NULL,                    -- панель/шторка: ближайший предок с id
  val VARCHAR(120) DEFAULT NULL,                    -- change: value варианта (до 80); vis: hidden/visible; js_error: текст (до 120)
  ms INT DEFAULT NULL,                              -- field: мс в поле; view: мс на прошлой странице
  n1 SMALLINT DEFAULT NULL,                         -- field: нажатий клавиш
  n2 SMALLINT DEFAULT NULL,                         -- field: стираний
  len SMALLINT DEFAULT NULL,                        -- field: длина итогового значения (не само значение)
  flags TINYINT UNSIGNED NOT NULL DEFAULT 0,        -- 1 «Смотреть как», 2 служебный запрос (X-Api-Key), 4 вставка из буфера
  PRIMARY KEY (id),
  UNIQUE KEY uq_event (sid, seq, client_ts),        -- склейка повторов; заодно индекс «поток вкладки по порядку»
  KEY k_user_time (email, client_ts),
  KEY k_page (page, kind, client_ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
