// Проверка address-point.js на живых адресах (26.09, шаг Б6 плана). ТОЛЬКО ЧТЕНИЕ базы + запросы к DaData.
// Запуск на VPS из временной папки рядом с копией geocoder.js: node validate-live.js
// (1) Адреса, где точку поставил ЧЕЛОВЕК, а текст - обычный (без ссылки/чисел): ищем по тексту и меряем
//     расстояние до точки человека. Это и есть проверка «не уехать в другой город».
// (2) Адреса заявок, у которых оценка цены сейчас «не геокодирован»: сколько теперь находится и почему нет.
"use strict";
const path = require("path");
const { createRequire } = require("module");
const reqApi = createRequire("/root/yard-dashboard/api/server.js");
reqApi("dotenv").config({ path: "/root/yard-dashboard/.env", quiet: true });
const mysql = reqApi("mysql2/promise");
const ap = require(path.join(__dirname, "address-point.js"));

function km(a, b) {
  const R = 6371, rad = (x) => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const mask = (s) => String(s).replace(/https?:\/\/\S+/g, "[ссылка]").slice(0, 70);

(async () => {
  const db = await mysql.createConnection({ host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
  // (1) эталон: человек поставил точку, текст без ссылки и без чисел-координат; уникальные пары текст+точка
  const [gold] = await db.query(`
    SELECT a, lat, lon FROM (
      SELECT TRIM(load_address) a, load_lat lat, load_lon lon FROM plan_orders WHERE deleted_at IS NULL AND load_lat IS NOT NULL AND load_address <> ''
      UNION ALL
      SELECT TRIM(unload_address), unload_lat, unload_lon FROM plan_orders WHERE deleted_at IS NULL AND unload_lat IS NOT NULL AND unload_address <> ''
    ) x WHERE a NOT REGEXP 'https?://|[0-9]{2}\\\\.[0-9]{3,}' GROUP BY a, lat, lon`);
  const res1 = { total: gold.length, found: 0, errors: {}, d: [], far: [] };
  for (const g of gold) {
    const r = await ap.resolvePoint(g.a);
    if (r.error) { res1.errors[r.error] = (res1.errors[r.error] || 0) + 1; continue; }
    res1.found++;
    const d = km({ lat: Number(g.lat), lon: Number(g.lon) }, r);
    res1.d.push(d);
    if (d > 3) res1.far.push({ d: Math.round(d * 10) / 10, a: mask(g.a), found: String(r.found || r.source).slice(0, 70) });
  }
  res1.d.sort((x, y) => x - y);
  const q = (p) => res1.d.length ? Math.round(res1.d[Math.min(res1.d.length - 1, Math.floor(p * (res1.d.length - 1)))] * 10) / 10 : null;
  console.log("(1) ЭТАЛОН - точку поставил человек, текст обычный:", res1.total, "адресов");
  console.log("    найдено поиском:", res1.found, " отказ:", res1.errors);
  console.log("    расстояние до точки человека, км: медиана", q(0.5), " 90%", q(0.9), " максимум", q(1));
  console.log("    дальше 1 км:", res1.d.filter((x) => x > 1).length, " дальше 3 км:", res1.d.filter((x) => x > 3).length, " дальше 10 км:", res1.d.filter((x) => x > 10).length);
  res1.far.sort((a, b) => b.d - a.d).slice(0, 15).forEach((f) => console.log("     ", f.d, "км |", f.a, "| ->", f.found));

  // (2) белые цены из-за адреса
  const [bad] = await db.query(`
    SELECT id, 'погрузка' side, load_address a FROM plan_orders WHERE deleted_at IS NULL AND status <> 'cancelled' AND internal = 0 AND computed_error = 'адрес погрузки не геокодирован'
    UNION ALL
    SELECT id, 'выгрузка', unload_address FROM plan_orders WHERE deleted_at IS NULL AND status <> 'cancelled' AND internal = 0 AND computed_error = 'адрес выгрузки не геокодирован'`);
  const res2 = { total: bad.length, bySource: {}, errors: {}, samples: [] };
  for (const b of bad) {
    const r = await ap.resolvePoint(b.a);
    if (r.error) { res2.errors[r.error] = (res2.errors[r.error] || 0) + 1; if (res2.samples.length < 12) res2.samples.push(r.error + " | " + mask(b.a)); }
    else res2.bySource[r.source] = (res2.bySource[r.source] || 0) + 1;
  }
  console.log("\n(2) БЕЛЫЕ ЦЕНЫ из-за адреса:", res2.total);
  console.log("    теперь точка есть:", res2.bySource, " всё ещё нет:", res2.errors);
  res2.samples.forEach((s) => console.log("     ", s));
  await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
