-- Площадки заказчика (26.09.2026, фаза Б плана plans/2026-09-26-customer-addresses-and-price-geo.md в
-- основном репозитории). Место погрузки/выгрузки хранится ОДИН раз у заказчика - мастер-данные; заявки
-- берут с площадки точку, контакт и пометку водителю. Первое наполнение - только постоянные места (2+
-- заявки), решение Влада 26.09; разовый адрес становится площадкой, когда повторится.
-- Правила безопасности: точка площадки - только поставленная человеком (в заявке или координатами/ссылкой
-- в тексте), поиск по тексту (DaData) сюда не пишет; точку меняет только человек, с журналом.
-- Все времена - UTC (правило CLAUDE.md).
CREATE TABLE IF NOT EXISTS customer_sites (
  id INT NOT NULL AUTO_INCREMENT,
  customer_entity_id VARCHAR(64) DEFAULT NULL,      -- юрлицо заказчика (sprav_legal_entities.id), если есть
  customer_name VARCHAR(255) NOT NULL,              -- название заказчика; для заказчиков без юрлица - ключ
  name VARCHAR(120) DEFAULT NULL,                   -- короткое имя («Горки», «ЮВХ-6») - по умолчанию из текста
  address VARCHAR(500) NOT NULL,                    -- как пишут менеджеры (самое частое написание), не «чистим»
  lat DECIMAL(10,6) DEFAULT NULL,
  lon DECIMAL(10,6) DEFAULT NULL,
  point_source VARCHAR(16) DEFAULT NULL,            -- order (из заявки) | text (координаты/ссылка в тексте) | manual (Справочники)
  contact_name VARCHAR(150) DEFAULT NULL,           -- контакт на месте - из самой свежей заявки
  contact_phone VARCHAR(64) DEFAULT NULL,
  driver_note VARCHAR(300) DEFAULT NULL,            -- пометка водителю («въезд с северной стороны»)
  load_count INT NOT NULL DEFAULT 0,                -- сколько раз была погрузкой
  unload_count INT NOT NULL DEFAULT 0,              -- сколько раз была выгрузкой
  first_used DATE DEFAULT NULL,
  last_used DATE DEFAULT NULL,
  needs_check TINYINT(1) NOT NULL DEFAULT 0,        -- 1 - точка в заявке расходилась с координатами в тексте и т.п.
  check_note VARCHAR(300) DEFAULT NULL,
  created_by VARCHAR(255) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255) DEFAULT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at DATETIME DEFAULT NULL,                -- архив вместо удаления
  PRIMARY KEY (id),
  KEY k_entity (customer_entity_id),
  KEY k_customer (customer_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Все написания адреса одной площадки: по ним заявка (и подсказки) узнают площадку. У «ДЕКУБ» у Горок два
-- написания: текст с координатами и ссылка Яндекса - обе строки здесь.
CREATE TABLE IF NOT EXISTS customer_site_texts (
  id INT NOT NULL AUTO_INCREMENT,
  site_id INT NOT NULL,
  text VARCHAR(500) NOT NULL,
  uses INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY k_site (site_id),
  KEY k_text (text(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
