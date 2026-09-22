// Периодическая подметка светофора факт/прайс (Влад, 22.09.2026,
// plans/2026-09-22-order-price-traffic-light.md) - на случай заявок без пересчёта
// (миграция задним числом, временный сбой геокодера/OSRM). Основной путь пересчёта -
// фоновый вызов после /api/orders/save (см. plan-orders.js), sweep - страховка, не
// основной механизм. Окно: сегодня-1 .. сегодня+3 (тот же диапазон дат, что видит
// живой «Задание»). Пропускает то, что пересчитано ПОСЛЕ последней правки заявки.
"use strict";
require("dotenv").config({ path: "/root/yard-dashboard/.env" });
const mysql = require("mysql2/promise");
const { estimateAndStoreOrderPrice } = require("../api/lib/order-price-estimate.js");

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE, connectionLimit: 2,
  });
  const [rows] = await pool.query(
    `SELECT id FROM plan_orders
     WHERE deleted_at IS NULL AND status <> 'cancelled'
       AND service_date BETWEEN DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND DATE_ADD(CURDATE(), INTERVAL 3 DAY)
       AND (computed_at IS NULL OR computed_at < updated_at)
     ORDER BY service_date, day_no`
  );
  console.log("[order-price-sweep] к пересчёту:", rows.length);
  for (const r of rows) {
    await estimateAndStoreOrderPrice(pool, r.id);
    await sleep(200); // бережём квоту DaData/OSRM
  }
  console.log("[order-price-sweep] готово:", rows.length);
  await pool.end();
}
main().catch((e) => { console.error("[order-price-sweep] FATAL:", e); process.exit(1); });
