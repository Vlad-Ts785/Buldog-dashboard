-- «План задание» v2 - своя система заявок вместо Google-листа (plans/2026-09-10-order-plan-v2-native.md,
-- Фаза 1, 11.09.2026). Заявка менеджера/логиста -> исполнители (свой парк = отрезок plan_segs,
-- наёмник = поля) -> лента Планировки. Ручной SQL, идемпотентный (IF NOT EXISTS / проверка колонок).
-- Применять: mysql ... < import/plan-orders-schema.sql (см. README сервера, запись 2026-09-11).

-- Заявка. Строка = ОДНА заявка (пара строк листа - костыль таблицы, не переносится).
-- Номер (day_no) - сквозной ВНУТРИ дня, как в листе: логисты и менеджеры говорят «как там по
-- четвёртой» - это главный якорь обеих ролей (Влад 10.09), уникален в паре (service_date, day_no).
CREATE TABLE IF NOT EXISTS plan_orders (
  id INT NOT NULL AUTO_INCREMENT,
  service_date DATE NOT NULL,
  day_no INT NOT NULL,
  service_time TIME DEFAULT NULL,                 -- NULL = «уточнить» (не 00:00)
  -- unconfirmed по умолчанию: заказ принят, заказчик ещё не подтвердил (Влад 10.09: три статуса
  -- менеджера, «Не закрыто» листа заменено на честное «Не подтверждено»); done ставит логист.
  status ENUM('unconfirmed','confirmed','cancelled','done') NOT NULL DEFAULT 'unconfirmed',
  -- «Под данные» - ОПЦИЯ МЕНЕДЖЕРА (пропускной режим): данные водителей переданы заказчику,
  -- замена машины только из заявленных (основная + резерв), вне списка - запрос-подтверждение.
  -- НЕ «не хватает данных» (память feedback_pod_dannye_term).
  needs_data TINYINT(1) NOT NULL DEFAULT 0,
  needs_data_sent_at DATETIME DEFAULT NULL,
  manager_email VARCHAR(255) DEFAULT NULL,        -- владелец заявки (access_users.email); у внутренних - NULL
  manager_name VARCHAR(150) DEFAULT NULL,         -- как в plan_segs.manager_name (полное имя из ростера)
  created_role VARCHAR(20) DEFAULT NULL,          -- manager | logist | admin
  internal TINYINT(1) NOT NULL DEFAULT 0,         -- внутренний заказ логиста (заказчик - своё юрлицо/База), менеджерам не показывается
  customer VARCHAR(255) DEFAULT NULL,
  customer_entity_id VARCHAR(64) DEFAULT NULL,    -- sprav_legal_entities.id, если выбран из справочника
  executor_entity_id VARCHAR(64) DEFAULT NULL,    -- «От кого»: своё юрлицо (sprav_legal_entities.is_own=1) - в договор-заявку
  customer_contact_name VARCHAR(200) DEFAULT NULL,
  customer_contact_phone VARCHAR(200) DEFAULT NULL,
  equipment_type VARCHAR(60) DEFAULT NULL,        -- значения из plan_dictionary kind='equipment'
  cargo VARCHAR(300) DEFAULT NULL,
  cargo_weight_t DECIMAL(8,2) DEFAULT NULL,
  cargo_dims VARCHAR(100) DEFAULT NULL,
  gabarit VARCHAR(20) DEFAULT NULL,               -- Габарит | Негабарит
  rework_terms VARCHAR(150) DEFAULT NULL,
  documents VARCHAR(100) DEFAULT NULL,
  note VARCHAR(1000) DEFAULT NULL,
  cash TINYINT(1) NOT NULL DEFAULT 0,
  load_address VARCHAR(500) DEFAULT NULL,
  load_lat DECIMAL(9,6) DEFAULT NULL,
  load_lon DECIMAL(9,6) DEFAULT NULL,
  load_confirmed TINYINT(1) NOT NULL DEFAULT 0,   -- 1 = адрес из подсказки/координат, 0 = «ориентир текстом»
  load_contact_name VARCHAR(200) DEFAULT NULL,
  load_contact_phone VARCHAR(200) DEFAULT NULL,
  unload_address VARCHAR(500) DEFAULT NULL,
  unload_lat DECIMAL(9,6) DEFAULT NULL,
  unload_lon DECIMAL(9,6) DEFAULT NULL,
  unload_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  unload_contact_name VARCHAR(200) DEFAULT NULL,
  unload_contact_phone VARCHAR(200) DEFAULT NULL,
  price DECIMAL(12,2) DEFAULT NULL,
  payment_status VARCHAR(50) DEFAULT NULL,
  taken_by VARCHAR(255) DEFAULT NULL,             -- «беру в работу» (email логиста) - видно всем логистам
  taken_by_name VARCHAR(150) DEFAULT NULL,
  taken_at DATETIME DEFAULT NULL,
  otboy_ack_by VARCHAR(150) DEFAULT NULL,         -- логист принял отбой (до этого строка мигает)
  otboy_ack_at DATETIME DEFAULT NULL,
  created_by VARCHAR(255) DEFAULT NULL,
  updated_by VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME DEFAULT NULL,
  deleted_by VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_day_no (service_date, day_no),
  KEY idx_date (service_date),
  KEY idx_manager (manager_email, service_date),
  KEY idx_customer (customer)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Полный снимок строки ПЕРЕД любой перезаписью/удалением + событие create - тот же приём,
-- что plan_segs_history (спас заявку «894» 30.08). Данные не теряются молча никогда.
CREATE TABLE IF NOT EXISTS plan_orders_history (
  id BIGINT NOT NULL AUTO_INCREMENT,
  order_id INT NOT NULL,
  action VARCHAR(40) NOT NULL,                    -- create | update | status | take | otboy_ack | delete | executor_* | change_request_*
  snapshot JSON DEFAULT NULL,
  detail VARCHAR(500) DEFAULT NULL,
  changed_by VARCHAR(255) DEFAULT NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_order (order_id, changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Исполнители заявки - СПИСОК (одна заявка -> N машин, свой парк и наёмка вперемешку).
-- own: seg_id -> plan_segs (отрезок на ленте Планировки); role=reserve у «под данные» отрезок
-- НЕ создаёт (машина остаётся свободной). hired: поля перевозчика прямо здесь.
CREATE TABLE IF NOT EXISTS plan_order_executors (
  id VARCHAR(64) NOT NULL,
  order_id INT NOT NULL,
  kind ENUM('own','hired') NOT NULL DEFAULT 'own',
  role ENUM('main','reserve') NOT NULL DEFAULT 'main',
  seg_id VARCHAR(64) DEFAULT NULL,
  vehicle_gos VARCHAR(32) DEFAULT NULL,
  trailer_gos VARCHAR(32) DEFAULT NULL,
  driver_person_id VARCHAR(64) DEFAULT NULL,
  driver_name VARCHAR(150) DEFAULT NULL,
  driver_phone VARCHAR(64) DEFAULT NULL,
  carrier_id VARCHAR(64) DEFAULT NULL,
  carrier_name VARCHAR(200) DEFAULT NULL,
  carrier_contact VARCHAR(200) DEFAULT NULL,
  purchase_rate DECIMAL(12,2) DEFAULT NULL,       -- закупка у наёмника (Влад 10.09: маржу видят все)
  settlement VARCHAR(30) DEFAULT NULL,            -- нал | бн | ндс | отсрочка
  carrier_status VARCHAR(20) DEFAULT NULL,        -- negotiating | confirmed | departed | loading | refused | no_show
  found_by VARCHAR(20) DEFAULT NULL,              -- logist | manager
  comment VARCHAR(500) DEFAULT NULL,
  driver_confirmed_at DATETIME DEFAULT NULL,      -- логист отметил «водитель подтвердил» -> у менеджера госномер зелёный
  driver_confirmed_by VARCHAR(150) DEFAULT NULL,
  driver_task_sent_at DATETIME DEFAULT NULL,      -- «Задание водителю» отправлено/скопировано
  driver_task_sent_by VARCHAR(150) DEFAULT NULL,
  created_by VARCHAR(255) DEFAULT NULL,
  created_by_name VARCHAR(150) DEFAULT NULL,
  updated_by VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  removed_at DATETIME DEFAULT NULL,
  removed_by VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_order (order_id, removed_at),
  KEY idx_seg (seg_id),
  KEY idx_gos (vehicle_gos, removed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Запрос на замену машины у заявки «под данные» вне заявленных (Влад 11.09: «обе стороны должны
-- между собой это согласовать»). Логист предлагает -> менеджер согласует с заказчиком -> approve/reject.
-- До ответа едет прежняя машина. Один pending-запрос на заявку (повторный заменяет).
CREATE TABLE IF NOT EXISTS plan_order_change_requests (
  id INT NOT NULL AUTO_INCREMENT,
  order_id INT NOT NULL,
  type VARCHAR(30) NOT NULL DEFAULT 'replace_vehicle',
  from_executor_id VARCHAR(64) DEFAULT NULL,
  from_gos VARCHAR(32) DEFAULT NULL,
  to_gos VARCHAR(32) DEFAULT NULL,
  to_driver_name VARCHAR(150) DEFAULT NULL,
  requested_by VARCHAR(255) DEFAULT NULL,
  requested_by_name VARCHAR(150) DEFAULT NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  resolved_by VARCHAR(255) DEFAULT NULL,
  resolved_by_name VARCHAR(150) DEFAULT NULL,
  resolved_at DATETIME DEFAULT NULL,
  comment VARCHAR(500) DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_order_status (order_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Справочник перевозчиков (переезд листа «Наемники»). Ставки/отказы - не поля, а выборка из executors.
CREATE TABLE IF NOT EXISTS plan_carriers (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(200) NOT NULL,
  inn VARCHAR(12) DEFAULT NULL,
  contacts JSON DEFAULT NULL,                     -- [{name, phone, role, whatsapp}]
  equipment JSON DEFAULT NULL,                    -- [{type, axles, capacity_t, platform_m, lowbed, region}]
  settlement VARCHAR(30) DEFAULT NULL,
  vat TINYINT(1) DEFAULT NULL,
  region VARCHAR(100) DEFAULT NULL,
  blacklisted TINYINT(1) NOT NULL DEFAULT 0,
  blacklist_reason VARCHAR(300) DEFAULT NULL,
  blacklist_at DATETIME DEFAULT NULL,
  notes VARCHAR(500) DEFAULT NULL,
  created_by VARCHAR(255) DEFAULT NULL,
  updated_by VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Договор-заявки заказчику (Влад 11.09: своя новая нумерация на сервере, хранение в
-- Справочниках отдельной вкладкой). Файлы - ВНЕ веб-корня (/root/yard-dashboard/private/contracts).
CREATE TABLE IF NOT EXISTS contracts (
  id INT NOT NULL AUTO_INCREMENT,
  contract_no VARCHAR(30) NOT NULL,
  contract_date DATE NOT NULL,
  order_id INT DEFAULT NULL,
  executor_entity_id VARCHAR(64) DEFAULT NULL,
  customer_entity_id VARCHAR(64) DEFAULT NULL,
  customer_name VARCHAR(255) DEFAULT NULL,
  amount DECIMAL(12,2) DEFAULT NULL,
  vat_rate DECIMAL(5,2) DEFAULT NULL,             -- 22.00 для всех юрлиц (Влад 11.09)
  vat_amount DECIMAL(12,2) DEFAULT NULL,
  version INT NOT NULL DEFAULT 1,
  file_docx VARCHAR(255) DEFAULT NULL,
  file_pdf VARCHAR(255) DEFAULT NULL,
  created_by VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME DEFAULT NULL,
  sent_to VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_no_version (contract_no, version),
  KEY idx_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Строгие списки заявки (бывший лист «Справочник» таблицы планировки). Правятся в Справочниках,
-- не в коде (Влад 11.09: «логика через справочники, не хардкод»). Сид - значения листа на 09.2026.
CREATE TABLE IF NOT EXISTS plan_dictionary (
  id INT NOT NULL AUTO_INCREMENT,
  kind VARCHAR(30) NOT NULL,                      -- equipment | documents | rework | payment_status | gabarit
  value VARCHAR(100) NOT NULL,
  sort INT NOT NULL DEFAULT 100,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,       -- показывать чипом (не в «ещё…»)
  active TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kind_value (kind, value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO plan_dictionary (kind, value, sort, is_primary) VALUES
 ('equipment','Трал до 20 т',10,1),('equipment','Трал 20-25 т',20,1),('equipment','Трал 25-34 т',30,1),
 ('equipment','Трал 35-44 т',40,1),('equipment','Трал 45-49 т',50,1),('equipment','Трал 50-59 т',60,1),
 ('equipment','Трал под кран',70,1),('equipment','Трал-корыто',80,1),
 ('equipment','Длинномер',90,0),('equipment','Панелевоз',100,0),('equipment','Тент',110,0),
 ('equipment','Faymonville (60+ т)',120,0),('equipment','Любая модификация',130,0),
 ('documents','Путевой лист',10,1),('documents','Путевой лист и ТТН',20,1),
 ('rework','Без переработки',10,1),('rework','Переработка по согласованию с логистом',20,1),
 ('payment_status','Не оплачено',10,1),('payment_status','Предоплата',20,1),('payment_status','Оплачено',30,1),
 ('gabarit','Габарит',10,1),('gabarit','Негабарит',20,1);

-- Связь отрезка ленты с заявкой (ничего существующего в plan_segs не меняется - контракт
-- /api/plan/segs потребляют Планировка и «Статус парка»). Идемпотентно через information_schema.
SET @has_order_id := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plan_segs' AND COLUMN_NAME = 'order_id');
SET @sql := IF(@has_order_id = 0,
  'ALTER TABLE plan_segs ADD COLUMN order_id INT DEFAULT NULL, ADD KEY idx_order_id (order_id)',
  'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

-- Печать и подпись юрлица - файлы в /root/yard-dashboard/private/stamps (вне веб-корня),
-- в справочнике - только имена файлов (Влад 11.09: реквизиты/печати - из справочника, не из кода).
SET @has_stamp := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sprav_legal_entities' AND COLUMN_NAME = 'stamp_file');
SET @sql := IF(@has_stamp = 0,
  'ALTER TABLE sprav_legal_entities ADD COLUMN stamp_file VARCHAR(120) DEFAULT NULL, ADD COLUMN signature_file VARCHAR(120) DEFAULT NULL, ADD COLUMN signer_short VARCHAR(60) DEFAULT NULL',
  'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

UPDATE sprav_legal_entities SET stamp_file='buldog_stamp.png', signature_file='buldog_signature_tsutsurin.png', signer_short='Цуцурин В. Д.'
  WHERE id='le_mtgbiyw4gzkq53' AND stamp_file IS NULL;
UPDATE sprav_legal_entities SET stamp_file='yard_imperial_stamp.png', signature_file='yard_imperial_signature_gontyurev.png', signer_short='Гонтюрев А. А.'
  WHERE id='le_mtgbmfjprq29v0' AND stamp_file IS NULL;
UPDATE sprav_legal_entities SET stamp_file='tehnopark_stamp.png', signature_file='tehnopark_signature_almashova.png', signer_short='Алмашова М. Н.'
  WHERE id='le_mtgbvjwv2hjya3' AND stamp_file IS NULL;
-- 11.09 Влад: «тип техники сделай Трал и Длинномер» - чипами только два, остальное в «ещё…»
INSERT IGNORE INTO plan_dictionary (kind, value, sort, is_primary) VALUES ('equipment','Трал',1,1);
UPDATE plan_dictionary SET is_primary = IF(value IN ('Трал','Длинномер'),1,0) WHERE kind='equipment';
UPDATE plan_dictionary SET sort=2 WHERE kind='equipment' AND value='Длинномер';
-- «От кого» - короткие имена и порядок (Влад 11.09): Бульдог, ЯРД, ТП, КМ, СО, СТ, МК, УМИАТ - поля справочника, не код
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sprav_legal_entities' AND COLUMN_NAME='short_name');
SET @sql := IF(@c=0,'ALTER TABLE sprav_legal_entities ADD COLUMN short_name VARCHAR(30) DEFAULT NULL, ADD COLUMN own_sort INT DEFAULT NULL','SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
UPDATE sprav_legal_entities SET short_name='Бульдог', own_sort=1 WHERE id='le_mtgbiyw4gzkq53';
UPDATE sprav_legal_entities SET short_name='ЯРД',     own_sort=2 WHERE id='le_mtgbmfjprq29v0';
UPDATE sprav_legal_entities SET short_name='ТП',      own_sort=3 WHERE id='le_mtgbvjwv2hjya3';
UPDATE sprav_legal_entities SET short_name='КМ',      own_sort=4 WHERE id='le_mtgd92xilswclx';
UPDATE sprav_legal_entities SET short_name='СО',      own_sort=5 WHERE id='le_mtgbtv1jwg29pn';
UPDATE sprav_legal_entities SET short_name='СТ',      own_sort=6 WHERE id='le_mtgdavb230fzxz';
UPDATE sprav_legal_entities SET short_name='МК',      own_sort=7 WHERE id='le_mtgbuqo7dyylxt';
UPDATE sprav_legal_entities SET short_name='УМИАТ',   own_sort=8 WHERE id='le_mtgbnfm50lf11i';
SELECT short_name, own_sort, name FROM sprav_legal_entities WHERE is_own=1 ORDER BY own_sort;
SELECT value,is_primary,sort FROM plan_dictionary WHERE kind='equipment' ORDER BY is_primary DESC, sort;
-- 11.09 Влад: у логистов «Кто заказывает» - те же короткие чипы своих юрлиц + БАЗА.
-- Флаг internal_customer: кто может быть ВНУТРЕННИМ заказчиком (свои юрлица + База); «От кого» остаётся is_own=1.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sprav_legal_entities' AND COLUMN_NAME='internal_customer');
SET @sql := IF(@c=0,'ALTER TABLE sprav_legal_entities ADD COLUMN internal_customer TINYINT(1) NOT NULL DEFAULT 0','SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
UPDATE sprav_legal_entities SET internal_customer=1 WHERE is_own=1 AND deleted_at IS NULL;
INSERT INTO sprav_legal_entities (id, name, full_name, short_name, own_sort, is_own, internal_customer, notes, created_by, updated_by)
SELECT 'le_internal_base', 'База', 'База (внутренний заказчик - рейсы для базы)', 'БАЗА', 9, 0, 1, 'Внутренний заказчик для заявок логистов (Влад 11.09). Если в 1С есть свой контрагент «База» - заменить на него', 'claude:2026-09-11', 'claude:2026-09-11'
WHERE NOT EXISTS (SELECT 1 FROM sprav_legal_entities WHERE id='le_internal_base');
SELECT id, short_name, own_sort, is_own, internal_customer FROM sprav_legal_entities WHERE internal_customer=1 ORDER BY own_sort;

-- 11.09 Влад: «Создать задание» из CRM - связь заявки со сделкой (карточка показывает «сделка №N →»)
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='plan_orders' AND COLUMN_NAME='crm_deal_id');
SET @sql := IF(@c=0,'ALTER TABLE plan_orders ADD COLUMN crm_deal_id INT DEFAULT NULL, ADD KEY idx_crm_deal (crm_deal_id)','SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
