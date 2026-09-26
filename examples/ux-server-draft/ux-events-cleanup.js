// Ночная очистка журнала действий ux_events (26.09.2026, plans/2026-09-26-smooth-work-ux-analytics.md
// в репозитории дашборда): сырьё старше UX_EVENTS_KEEP_DAYS (по умолчанию 90) дней удаляется. Дальше
// (Фаза 3) остаются только дневные сводки. Без очистки таблица растёт на ~0,5 млн строк в месяц.
//
// Запуск - только через run-job.js (итог в import_runs, сторож watchdog.js ждёт удачный запуск):
//   cd /root/yard-dashboard/import && node run-job.js ux-events-cleanup ux-events-cleanup.js
// Проверка без удаления: node ux-events-cleanup.js --dry
//
// Как удаляем. Индекса по server_ts нет (не держим лишний индекс на 1,5-2 млн строк ради одного
// ночного запроса). Граница ищется по первичному ключу: id растёт вместе со временем записи, поэтому
// «первая строка, которую оставляем» находится коротким проходом по PK с начала таблицы - по
// старым строкам, которые всё равно удаляются. Потом DELETE ... WHERE id < граница порциями по
// CHUNK с паузой: один огромный DELETE держал бы блокировки и раздувал undo/бинлог разом.
require("dotenv").config({ path: "/root/yard-dashboard/.env", quiet: true });
const mysql = require("mysql2/promise");

const KEEP_DAYS = Math.max(7, parseInt(process.env.UX_EVENTS_KEEP_DAYS || "90", 10) || 90); // меньше недели - почти наверняка опечатка
const CHUNK = 5000;
const PAUSE_MS = 200;
const MAX_ROUNDS = 2000; // предохранитель: 10 млн строк за ночь - заведомо больше, чем бывает
const DRY = process.argv.includes("--dry");
const stamp = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const db = await mysql.createConnection({ host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
  try {
    // NOW(3) - в том же часовом поясе сессии, в котором DEFAULT CURRENT_TIMESTAMP(3) писал server_ts (UTC).
    const [[keep]] = await db.query(
      "SELECT id FROM ux_events WHERE server_ts >= NOW(3) - INTERVAL ? DAY ORDER BY id LIMIT 1", [KEEP_DAYS]);
    let bound;
    if (keep) bound = Number(keep.id);
    else {
      // свежих строк нет вовсе: всё, что есть сейчас, старше срока (новые получат id больше MAX)
      const [[mx]] = await db.query("SELECT MAX(id) AS m FROM ux_events");
      if (mx.m == null) { console.log(stamp(), "ux_events пуста - удалять нечего"); return; }
      bound = Number(mx.m) + 1;
    }
    if (DRY) {
      const [[c]] = await db.query("SELECT COUNT(*) AS n FROM ux_events WHERE id < ?", [bound]);
      console.log(stamp(), "--dry: удалилось бы", c.n, "строк старше", KEEP_DAYS, "дн. (id <", bound + ")");
      return;
    }
    let total = 0, rounds = 0;
    for (; rounds < MAX_ROUNDS; rounds++) {
      const [r] = await db.query("DELETE FROM ux_events WHERE id < ? ORDER BY id LIMIT ?", [bound, CHUNK]);
      total += r.affectedRows;
      if (r.affectedRows < CHUNK) break;
      await sleep(PAUSE_MS);
    }
    if (rounds >= MAX_ROUNDS) throw new Error("ОШИБКА: упёрлись в предохранитель " + MAX_ROUNDS + " порций, удалено " + total + " - хвост доудалит следующая ночь, проверить объём");
    console.log(stamp(), "удалено", total, "строк ux_events старше", KEEP_DAYS, "дн.");
  } finally {
    await db.end().catch(() => {});
  }
})().catch((e) => { console.error(stamp(), "ОШИБКА", e.message); process.exit(1); });
