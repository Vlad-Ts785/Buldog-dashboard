// Сквозная проверка Б-5 (узнавание площадки, площадка со 2-й заявки, «Сохранить как площадку») на ТЕСТОВОЙ копии.
// Запуск на VPS: set -a; . /etc/yard-staging.env; set +a; node sites-b5-e2e.js
"use strict";
const { spawnSync } = require("child_process");
const ROOT = "/root/yard-dashboard";
const mysql = require(ROOT + "/api/node_modules/mysql2/promise");
if (process.env.MYSQL_DATABASE !== "yard_staging" || String(process.env.API_PORT) !== "3101") { console.error("не staging - стоп"); process.exit(2); }

let ok = 0, bad = 0;
function check(name, cond, extra) { if (cond) { ok++; console.log("ok   " + name); } else { bad++; console.log("FAIL " + name + (extra !== undefined ? " :: " + JSON.stringify(extra).slice(0, 500) : "")); } }
function as(email, url, body) {
  const args = [ROOT + "/tests/as-user.js", email, url]; if (body) args.push(JSON.stringify(body));
  const r = spawnSync(process.execPath, args, { encoding: "utf8", env: process.env });
  const m = String(r.stderr || "").match(/HTTP (\d+)/);
  let data = null; try { data = JSON.parse(r.stdout); } catch (e) { data = r.stdout; }
  return { status: m ? Number(m[1]) : 0, data };
}
const RUN = Date.now().toString(36).slice(-5); // уникальные адреса на каждый прогон
const SH = (Date.now() % 997) * 0.004; // и точки: иначе повторный прогон честно склеит их с площадками прошлого (200 м)

(async () => {
  const db = await mysql.createConnection({ host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
  const [[M]] = await db.query("SELECT email FROM access_users WHERE role = 'manager' ORDER BY email LIMIT 1");
  const [[A]] = await db.query("SELECT email FROM access_users WHERE role = 'admin' LIMIT 1");
  const [[S1]] = await db.query(`SELECT s.* FROM customer_sites s WHERE s.customer_entity_id IS NOT NULL AND s.lat IS NOT NULL AND s.archived_at IS NULL
      AND EXISTS (SELECT 1 FROM customer_sites z WHERE z.customer_entity_id = s.customer_entity_id AND z.lat IS NULL AND z.archived_at IS NULL)
    ORDER BY s.load_count + s.unload_count DESC LIMIT 1`);
  const ent = S1.customer_entity_id;
  const [[S0]] = await db.query(`SELECT * FROM customer_sites WHERE customer_entity_id = ? AND lat IS NULL AND archived_at IS NULL ORDER BY id LIMIT 1`, [ent]);
  const [[tpl]] = await db.query(`SELECT * FROM plan_orders WHERE customer_entity_id = ? AND deleted_at IS NULL AND price > 0 AND cargo_weight_t > 0 ORDER BY id DESC LIMIT 1`, [ent]);
  const p1 = { lat: Number(S1.lat), lon: Number(S1.lon) };
  console.log("площадки: с точкой " + S1.id + ", без точки " + S0.id + "; прогон " + RUN);
  let n = 0;
  function mk(load, extra) {
    n++;
    const b = Object.assign({ service_date: "2026-10-07", service_time: "09:00", customer: tpl.customer, customer_entity_id: ent, equipment_type: tpl.equipment_type,
      cargo: "тест Б5", cargo_weight_t: Number(tpl.cargo_weight_t), price: Number(tpl.price), executor_entity_id: tpl.executor_entity_id || "",
      unload_address: "Москва, выгрузка Б5 " + RUN + "-" + n }, load, extra || {});
    return as(M.email, "/api/orders/save", b);
  }
  const siteOf = async (id) => (await db.query("SELECT * FROM customer_sites WHERE id = ?", [id]))[0][0];
  const orderOf = async (id) => (await db.query("SELECT * FROM plan_orders WHERE id = ?", [id]))[0][0];

  // 1. написание площадки без выбора в подсказке (телефон / «Повторить» / набрали руками) - привязка
  let r = mk({ load_address: S1.address });
  check("1. текст площадки без выбора - заявка привязана к площадке", r.status === 200 && r.data.order.load_site_id === S1.id, r.data && r.data.order && [r.data.order.load_site_id, r.data.error]);
  const o1 = r.data.id;
  const [[h1]] = await db.query("SELECT changed_by, detail FROM plan_orders_history WHERE order_id = ? ORDER BY id DESC LIMIT 1", [o1]);
  check("1б. журнал заявки: «Система (площадки)», площадка погрузки", h1.changed_by === "Система (площадки)" && /load_site_id/.test(h1.detail), h1);
  // 1в. регистр и пробелы не мешают
  r = mk({ load_address: "  " + S1.address.toUpperCase() + "  " });
  check("1в. другой регистр/пробелы - та же площадка", r.data.order && r.data.order.load_site_id === S1.id, r.data.order && r.data.order.load_site_id);

  // 2. своя точка заявки дальше 3 км от точки площадки - не привязываем (Б3)
  r = mk({ load_address: S1.address, load_lat: p1.lat + 0.1, load_lon: p1.lon });
  check("2. точка заявки в ~11 км - без привязки", r.status === 200 && !r.data.order.load_site_id, r.data.order && r.data.order.load_site_id);

  // 3. площадка без точки + заявка с точкой - точка площадке, журнал «точка из заявки». Площадка - своя на
  // каждый прогон (написания старых площадок копии могли задвоиться прошлыми прогонами)
  const S0addr = "Площадка без точки Б5 " + RUN;
  r = as(A.email, "/api/sites/save", { customer_entity_id: ent, customer_name: S1.customer_name, address: S0addr });
  const S0id = r.data.site && r.data.site.id;
  r = as(A.email, "/api/sites/save", { customer_entity_id: ent, customer_name: S1.customer_name, address: S0addr.toUpperCase() });
  check("3а. admin: второй площадки с тем же адресом не заводит - 409", r.status === 409, r.data);
  const pt3 = { lat: 55.612345, lon: 37.712345 };
  r = mk({ load_address: S0addr, load_lat: pt3.lat, load_lon: pt3.lon });
  const s0 = await siteOf(S0id);
  check("3. привязка к площадке без точки", r.data.order && r.data.order.load_site_id === S0id, r.data.order && r.data.order.load_site_id);
  check("3б. площадка получила точку заявки", Number(s0.lat) === pt3.lat && Number(s0.lon) === pt3.lon && s0.point_source === "order", [s0.lat, s0.lon, s0.point_source]);
  const [[sh3]] = await db.query("SELECT action, changed_by FROM customer_site_history WHERE site_id = ? ORDER BY id DESC LIMIT 1", [S0id]);
  check("3в. журнал площадки: точка из заявки", sh3.action === "set_point" && /^Система \(точка из заявки №/.test(sh3.changed_by), sh3);

  // 4. разовый адрес - площадки нет; вторая заявка с тем же написанием - площадка + привязка
  const T1 = "Склад Б5 " + RUN + ", ворота 1", P = { lat: 55.701111 + SH, lon: 37.501111 };
  r = mk({ load_address: T1, load_lat: P.lat, load_lon: P.lon });
  check("4. первая заявка с новым адресом - площадки нет", r.data.order && !r.data.order.load_site_id, r.data.order && r.data.order.load_site_id);
  const [[c4a]] = await db.query("SELECT COUNT(*) n FROM customer_site_texts WHERE text = ?", [T1]);
  r = mk({ load_address: T1, load_lat: P.lat + 0.0003, load_lon: P.lon });
  const sid4 = r.data.order && r.data.order.load_site_id;
  const s4 = sid4 ? await siteOf(sid4) : null;
  check("4б. вторая заявка - площадка создана и заявка привязана", c4a.n === 0 && sid4 && s4 && s4.created_by === "Система (площадка со 2-й заявки)", [c4a.n, sid4, s4 && s4.created_by]);
  check("4в. точка площадки - точка этой заявки, имя из адреса, счётчик 2", s4 && Math.abs(Number(s4.lat) - (P.lat + 0.0003)) < 1e-6 && s4.name === "Склад Б5 " + RUN && s4.load_count === 2, s4 && [s4.lat, s4.name, s4.load_count]);

  // 5. другое написание того же места (точка в ~50 м): вторая заявка - новое написание старой площадки, не новая
  const T2 = "склад Б5 " + RUN + " (второй въезд)";
  mk({ load_address: T2, load_lat: P.lat + 0.0004, load_lon: P.lon + 0.0004 });
  r = mk({ load_address: T2, load_lat: P.lat + 0.0004, load_lon: P.lon + 0.0004 });
  const [t5] = await db.query("SELECT text FROM customer_site_texts WHERE site_id = ?", [sid4]);
  check("5. другое написание в 50 м - та же площадка, новое написание", r.data.order && r.data.order.load_site_id === sid4 && t5.some((x) => x.text === T2), [r.data.order && r.data.order.load_site_id, t5.map((x) => x.text)]);

  // 6. точки заявок одного написания расходятся > 3 км - площадка без точки, «проверить точку»
  const T3 = "Объект Б5 " + RUN + ", участок 7";
  mk({ load_address: T3, load_lat: 55.9 + SH, load_lon: 37.9 });
  r = mk({ load_address: T3, load_lat: 55.95 + SH, load_lon: 38.1 });
  const sid6 = r.data.order && r.data.order.load_site_id; const s6 = sid6 ? await siteOf(sid6) : null;
  check("6. точки расходятся - площадка без точки и с пометкой проверить", s6 && s6.lat === null && s6.needs_check === 1, s6 && [s6.lat, s6.needs_check, s6.check_note]);

  // 7. площадка в архиве: написание не привязывается и новая не создаётся
  as(A.email, "/api/sites/archive", { id: sid6, archived: 1 });
  const [[cnt7a]] = await db.query("SELECT COUNT(*) n FROM customer_sites WHERE customer_entity_id = ?", [ent]);
  r = mk({ load_address: T3, load_lat: 55.9 + SH, load_lon: 37.9 });
  const [[cnt7b]] = await db.query("SELECT COUNT(*) n FROM customer_sites WHERE customer_entity_id = ?", [ent]);
  check("7. написание площадки в архиве - без привязки и без новой площадки", r.data.order && !r.data.order.load_site_id && cnt7a.n === cnt7b.n, [r.data.order && r.data.order.load_site_id, cnt7a.n, cnt7b.n]);

  // 8. «Сохранить как площадку» (менеджер)
  const T4 = "База клиента Б5 " + RUN + ", КПП 2", P4 = { lat: 55.801111 + SH, lon: 37.401111 };
  r = as(M.email, "/api/sites/create", { customer: tpl.customer, customer_entity_id: ent, address: T4, lat: P4.lat, lon: P4.lon, contact: "Пётр 89161112233" });
  const sid8 = r.data.site && r.data.site.id;
  check("8. менеджер сохранил новую площадку", r.status === 200 && sid8 && !r.data.existed && r.data.site.lat === P4.lat && r.data.site.contact_phone === "+7 916 111-22-33", r.data);
  r = as(M.email, "/api/sites/create", { customer: tpl.customer, customer_entity_id: ent, address: T4.toLowerCase(), lat: P4.lat, lon: P4.lon });
  check("8б. повтор - та же площадка (existed)", r.data.existed === true && r.data.site.id === sid8, r.data);
  r = as(M.email, "/api/sites/create", { customer: tpl.customer, customer_entity_id: ent, address: "Клиент Б5 " + RUN + " другой текст", lat: P4.lat + 0.0005, lon: P4.lon });
  check("8в. другой текст в ~55 м - новое написание той же площадки", r.data.existed === true && r.data.merged === true && r.data.site.id === sid8, r.data);
  r = as(M.email, "/api/sites/create", { customer: tpl.customer, customer_entity_id: ent, address: T3, lat: 55.9 + SH, lon: 37.9 });
  check("8г. написание площадки в архиве - 409", r.status === 409, r);
  r = as(M.email, "/api/sites/create", { customer: "", address: "что-то" });
  check("8д. без заказчика - 400", r.status === 400, r.status);
  r = as(M.email, "/api/sites/create", { customer: tpl.customer, customer_entity_id: ent, address: "Работа по месту" });
  check("8е. «Работа по месту» - не площадка, 400", r.status === 400, r.status);
  r = as(M.email, "/api/sites/create", { customer: tpl.customer, customer_entity_id: ent, address: "Где-то Б5 " + RUN, lat: 37.4, lon: 55.8 });
  check("8ж. перепутанные широта/долгота - 400", r.status === 400, r.data);

  // 9. правка заявки (как с телефона): поле площадки не прислали, текст сменили на написание площадки - привязка
  r = mk({ load_address: "Временный адрес Б5 " + RUN });
  const o9 = r.data.id;
  r = as(M.email, "/api/orders/save", { id: o9, load_address: S1.address });
  check("9. правка без поля площадки, текст площадки - привязка", (await orderOf(o9)).load_site_id === S1.id, (await orderOf(o9)).load_site_id);
  // 9б. с ПК пришло «площадки нет» (''), а текст - площадки: сервер всё равно узнаёт (то же место)
  r = mk({ load_address: S1.address, load_site_id: "" });
  check("9б. явное «без площадки» + текст площадки - привязка", r.data.order && r.data.order.load_site_id === S1.id, r.data.order && r.data.order.load_site_id);
  // 9в. явный выбор площадки на ПК - сервер его не перебивает
  r = mk({ load_address: S1.address, load_site_id: sid8 });
  check("9в. явно выбранная площадка остаётся", r.data.order && r.data.order.load_site_id === sid8, r.data.order && r.data.order.load_site_id);

  await db.end();
  console.log("\nитого: ok " + ok + ", упало " + bad);
  process.exitCode = bad ? 1 : 0;
})().catch((e) => { console.error("ОШИБКА:", e); process.exit(1); });
