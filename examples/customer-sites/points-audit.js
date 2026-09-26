// Проверка точек водителя в действующих заявках (26.09.2026). ТОЛЬКО ЧТЕНИЕ.
// Живой случай: заявка на 28.09 - в тексте «Можайский округ, Координаты: 55.411280, 35.781301», а точка
// заявки - Назимиха (Щёлковский р-н), ~160 км. Причина - старая ошибка формы: выбрали подсказку, переписали
// текст, точка осталась прежней (исправлено 26.09, правило Б4). Ищем все такие расхождения:
//  (1) в тексте адреса есть координаты/ссылка человека, а точка заявки от них дальше 1 км - почти наверняка ошибка;
//  (2) текст обычный, поиск по нему (со сверкой города) даёт место дальше 10 км от точки заявки - проверить глазами.
// Запуск на VPS: node points-audit.js [--all]  (без --all - только заявки с датой подачи от сегодня)
"use strict";
const { createRequire } = require("module");
const reqApi = createRequire("/root/yard-dashboard/api/server.js");
reqApi("dotenv").config({ path: "/root/yard-dashboard/.env", quiet: true });
const mysql = reqApi("mysql2/promise");
const ap = require("/root/yard-dashboard/api/lib/address-point.js");
function km(a, b) {
  const R = 6371, rad = (x) => x * Math.PI / 180;
  const dLa = rad(b.lat - a.lat), dLo = rad(b.lon - a.lon);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
(async () => {
  const all = process.argv.includes("--all");
  const db = await mysql.createConnection({ host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
  const [rows] = await db.query(`SELECT id, day_no, service_date, customer, load_address la, load_lat lla, load_lon llo, unload_address ua, unload_lat ula, unload_lon ulo
    FROM plan_orders WHERE deleted_at IS NULL AND status <> 'cancelled' ${all ? "" : "AND service_date >= CURDATE()"} ORDER BY service_date, day_no`);
  const out = { checked: 0, textPoint: [], search: [] };
  for (const o of rows) {
    for (const side of ["load", "unload"]) {
      const text = side === "load" ? o.la : o.ua, lat = side === "load" ? o.lla : o.ula, lon = side === "load" ? o.llo : o.ulo;
      if (!text || lat == null || lon == null) continue;
      out.checked++;
      const stored = { lat: Number(lat), lon: Number(lon) };
      const tp = ap.pointFromText(text);
      const row = { id: o.id, no: o.day_no, date: o.service_date instanceof Date ? o.service_date.toISOString().slice(0, 10) : String(o.service_date).slice(0, 10), side: side === "load" ? "погрузка" : "выгрузка", text: String(text).replace(/https?:\/\/\S+/g, "[ссылка]").slice(0, 110), stored };
      if (tp && tp.lat != null) {
        const d = km(stored, tp);
        if (d > 1) out.textPoint.push(Object.assign(row, { km: Math.round(d), textPt: { lat: tp.lat, lon: tp.lon } }));
        continue;
      }
      if (tp && tp.needsResolve) continue; // короткая ссылка - без сети не сравнить, пропускаем
      const r = await ap.resolvePoint(text);
      if (r && r.lat != null) {
        const d = km(stored, r);
        if (d > 10) out.search.push(Object.assign(row, { km: Math.round(d), found: r.found }));
      }
    }
  }
  console.log(JSON.stringify(out, null, 1));
  await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
