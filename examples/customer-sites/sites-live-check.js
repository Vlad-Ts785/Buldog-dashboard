// Живая проверка площадок после выката - ТОЛЬКО чтение (GET) + один заведомо пустой POST (id=0 -> 404, записи нет).
// Запуск на VPS: node /root/stage-sites/sites-live-check.js
"use strict";
const { spawnSync } = require("child_process");
const path = require("path");
const ROOT = "/root/yard-dashboard";
require(ROOT + "/api/node_modules/dotenv").config({ path: path.join(ROOT, ".env"), quiet: true });
const mysql = require(ROOT + "/api/node_modules/mysql2/promise");
function as(email, url, body) {
  const args = [ROOT + "/tests/as-user.js", email, url]; if (body) args.push(JSON.stringify(body));
  const r = spawnSync(process.execPath, args, { encoding: "utf8", env: process.env });
  const m = String(r.stderr || "").match(/HTTP (\d+)/);
  let data = null; try { data = JSON.parse(r.stdout); } catch (e) { data = r.stdout; }
  return { status: m ? Number(m[1]) : 0, data };
}
(async () => {
  const db = await mysql.createConnection({ host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
  const [[M]] = await db.query("SELECT email FROM access_users WHERE role = 'manager' ORDER BY email LIMIT 1");
  const [[A]] = await db.query("SELECT email FROM access_users WHERE role = 'admin' LIMIT 1");
  const [[s]] = await db.query("SELECT customer_entity_id ent FROM customer_sites WHERE customer_entity_id IS NOT NULL ORDER BY load_count + unload_count DESC LIMIT 1");
  const [[c]] = await db.query("SELECT customer FROM plan_orders WHERE customer_entity_id = ? ORDER BY id DESC LIMIT 1", [s.ent]);
  await db.end();
  let r = as(M.email, "/api/orders/customer_history?customer=" + encodeURIComponent(c.customer) + "&entity=" + encodeURIComponent(s.ent));
  console.log("customer_history (менеджер):", r.status, "площадок", (r.data.sites || []).length, "с точкой", (r.data.sites || []).filter((x) => x.lat != null).length, "адресов истории", (r.data.addresses || []).length);
  r = as(A.email, "/api/sites?entity=" + encodeURIComponent(s.ent) + "&archived=1");
  console.log("/api/sites (admin):", r.status, "площадок", (r.data.sites || []).length, "can_edit", r.data.can_edit);
  r = as(M.email, "/api/sites?entity=" + encodeURIComponent(s.ent));
  console.log("/api/sites (менеджер):", r.status, "площадок", (r.data.sites || []).length, "can_edit", r.data.can_edit);
  r = as(M.email, "/api/sites/set_point", { id: 0, point_text: "55.7, 37.6" });
  console.log("set_point id=0 (ожидаем 404, без записи):", r.status);
  r = as(M.email, "/api/sites/save", { id: 1, name: "x" });
  console.log("save менеджером (ожидаем 403):", r.status);
  const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  r = as(M.email, "/api/orders?date=" + today);
  const withSite = (r.data.orders || []).filter((o) => o.load_site_id || o.unload_site_id).length;
  console.log("/api/orders сегодня:", r.status, "заявок", (r.data.orders || []).length, "с площадкой", withSite, "поле load_site_id есть:", (r.data.orders || []).length ? ("load_site_id" in r.data.orders[0]) : "нет заявок");
})().catch((e) => { console.error("ОШИБКА:", e.message); process.exit(1); });
