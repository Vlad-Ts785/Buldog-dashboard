-- Быстрые ответы по ставкам ключевых клиентов (plans/2026-09-21-gpb-quick-price-response.md,
-- Фаза 1, 21.09.2026). Первый и пока единственный клиент - ГПБ Комплект (client='gpb'), но
-- имя таблицы/схема обобщены под других ключевых клиентов при необходимости (см. «Открытые
-- вопросы» плана - решено не усложнять сейчас логикой, но не плодить client-специфичное имя).
-- Применять: mysql ... < import/client-route-rates-schema.sql (см. README сервера).

CREATE TABLE IF NOT EXISTS client_route_rates (
  id INT NOT NULL AUTO_INCREMENT,
  client VARCHAR(60) NOT NULL,                    -- 'gpb' для ГПБ Комплект
  order_date DATE DEFAULT NULL,
  equipment_model VARCHAR(60) DEFAULT NULL,       -- код модели (ESDA45, EGR5505, ...); NULL - груз без явного кода (ЗИП и т.п.)
  vin VARCHAR(64) DEFAULT NULL,
  origin VARCHAR(255) DEFAULT NULL,
  destination VARCHAR(255) DEFAULT NULL,
  -- short = Маньчжурия<->Забайкальск/граница (растаможка, на порядок дешевле полного маршрута);
  -- full = от границы/Забайкальска до конечной точки (это НЕ вся цена клиенту - см. план, риски);
  -- full_domestic = маршрут без привязки к границе (редкий случай); other = не тарифицируемый рейс.
  leg_type ENUM('short','full','full_domestic','other') NOT NULL DEFAULT 'full',
  price DECIMAL(12,2) DEFAULT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'RUB',
  vat_note VARCHAR(120) DEFAULT NULL,             -- 'НДС 0%' / 'с НДС' / 'не указано (1С)' - НЕ смешивать в одну медиану без пометки
  source VARCHAR(20) NOT NULL DEFAULT '1c',       -- 1c | email
  n_accounting_lines INT NOT NULL DEFAULT 1,      -- сколько бухгалтерских строк 1С слито в эту запись при дедупе (см. Фаза 0)
  notes VARCHAR(500) DEFAULT NULL,
  created_by VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_client_model (client, equipment_model),
  KEY idx_client_date (client, order_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
