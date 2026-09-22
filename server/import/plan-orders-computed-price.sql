-- Светофор факт/прайс в «Задании» (Влад, 22.09.2026, план
-- plans/2026-09-22-order-price-traffic-light.md) - авторасчёт стоимости заявки той же
-- формулой, что и вкладка «Калькулятор» (computeQuoteAuto), кэшируется на самой заявке,
-- не считается на каждый показ страницы. Идемпотентно (IF NOT EXISTS через
-- information_schema, тот же приём, что и остальные миграции этой таблицы).
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='plan_orders' AND COLUMN_NAME='computed_price');
SET @sql := IF(@c=0,
  'ALTER TABLE plan_orders ADD COLUMN computed_price DECIMAL(12,2) DEFAULT NULL, ADD COLUMN computed_mode VARCHAR(10) DEFAULT NULL, ADD COLUMN computed_error VARCHAR(255) DEFAULT NULL, ADD COLUMN computed_at DATETIME DEFAULT NULL, ADD KEY idx_computed_at (computed_at)',
  'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
