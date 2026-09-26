// Сквозная проверка площадок на ТЕСТОВОЙ копии (staging, 127.0.0.1:3101, база yard_staging). Боевую базу не трогает.
// Запуск на VPS: set -a; . /etc/yard-staging.env; set +a; node /root/stage-sites/sites-e2e.js
"use strict";
const { spawnSync } = require("child_process");
const ROOT = "/root/yard-dashboard";
const mysql = require(ROOT + "/api/node_modules/mysql2/promise");
if (process.env.MYSQL_DATABASE !== "yard_staging" || String(process.env.API_PORT) !== "3101") { console.error("не staging - стоп"); process.exit(2); }

let ok = 0, bad = 0;
function check(name, cond, extra) { if (cond) { ok++; console.log("ok   " + name); } else { bad++; console.log("FAIL " + name + (extra ? " :: " + JSON.stringify(extra).slice(0, 400) : "")); } }
function as(email, url, body) {
  const args = [ROOT + "/tests/as-user.js", email, url]; if (body) args.push(JSON.stringify(body));
  const r = spawnSync(process.execPath, args, { encoding: "utf8", env: process.env });
  const m = String(r.stderr || "").match(/HTTP (\d+)/);
  let data = null; try { data = JSON.parse(r.stdout); } catch (e) { data = r.stdout; }
  return { status: m ? Number(m[1]) : 0, data };
}
const q = (o) => Object.keys(o).map((k) => k + "=" + encodeURIComponent(o[k])).join("&");

(async () => {
  const db = await mysql.createConnection({ host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
  const [[M]] = await db.query("SELECT email FROM access_users WHERE role = 'manager' ORDER BY email LIMIT 1");
  const [[A]] = await db.query("SELECT email FROM access_users WHERE role = 'admin' LIMIT 1");
  // заказчик с юрлицом, у которого есть площадка с точкой и площадка без точки
  const [[S1]] = await db.query(`SELECT s.* FROM customer_sites s WHERE s.customer_entity_id IS NOT NULL AND s.lat IS NOT NULL
      AND EXISTS (SELECT 1 FROM customer_sites z WHERE z.customer_entity_id = s.customer_entity_id AND z.lat IS NULL)
    ORDER BY s.load_count + s.unload_count DESC LIMIT 1`);
  const [[S0]] = await db.query(`SELECT * FROM customer_sites WHERE customer_entity_id = ? AND lat IS NULL ORDER BY id LIMIT 1`, [S1.customer_entity_id]);
  const ent = S1.customer_entity_id;
  const [[tpl]] = await db.query(`SELECT * FROM plan_orders WHERE customer_entity_id = ? AND deleted_at IS NULL AND price > 0 AND cargo_weight_t > 0 ORDER BY id DESC LIMIT 1`, [ent]);
  console.log("площадки: с точкой id " + S1.id + ", без точки id " + S0.id + "; шаблон заявки id " + tpl.id);

  // 1. подсказки: площадки первыми, их адреса не дублируются в «точках заказчика»
  let r = as(M.email, "/api/orders/customer_history?" + q({ customer: tpl.customer, entity: ent }));
  const ids = (r.data.sites || []).map((s) => s.id);
  check("история заказчика: площадки есть (с точкой и без)", r.status === 200 && ids.includes(S1.id) && ids.includes(S0.id), r.data);
  const [t1] = await db.query("SELECT text FROM customer_site_texts WHERE site_id = ?", [S1.id]);
  const low = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  check("адрес площадки не повторяется в «точках заказчика»", !(r.data.addresses || []).some((a) => t1.some((t) => low(t.text) === low(a.address))));
  // 1б. напечатали название без выбора юрлица - юрлицо берётся из прошлых заявок с этим названием
  r = as(M.email, "/api/orders/customer_history?" + q({ customer: tpl.customer }));
  check("без юрлица в запросе площадки тоже находятся", (r.data.sites || []).some((s) => s.id === S1.id), r.data.sites);

  // 2. новая заявка с площадкой погрузки
  const before1 = (await db.query("SELECT load_count, last_used FROM customer_sites WHERE id = ?", [S1.id]))[0][0];
  const body = { service_date: "2026-10-06", service_time: "09:00", customer: tpl.customer, customer_entity_id: ent, equipment_type: tpl.equipment_type,
    cargo: tpl.cargo || "тест", cargo_weight_t: Number(tpl.cargo_weight_t), price: Number(tpl.price), executor_entity_id: tpl.executor_entity_id || "",
    load_address: S1.address, load_lat: Number(S1.lat), load_lon: Number(S1.lon), load_site_id: S1.id, unload_address: "Москва, тестовая выгрузка", unload_site_id: "" };
  r = as(M.email, "/api/orders/save", body);
  const oid = r.data && r.data.id;
  check("создание заявки с площадкой", r.status === 200 && oid && r.data.order.load_site_id === S1.id && r.data.order.load_site && r.data.order.load_site.name, r.data);
  const after1 = (await db.query("SELECT load_count, last_used FROM customer_sites WHERE id = ?", [S1.id]))[0][0];
  check("счётчик площадки +1", after1.load_count === before1.load_count + 1, [before1, after1]);

  // 3. адрес правят руками без площадки (как телефон) - ссылка снимается
  r = as(M.email, "/api/orders/save", { id: oid, load_address: S1.address + ", ворота 3" });
  let [[o]] = await db.query("SELECT load_site_id, load_lat FROM plan_orders WHERE id = ?", [oid]);
  check("ручная правка текста снимает площадку", r.status === 200 && o.load_site_id === null, [r.data, o]);
  const [[h]] = await db.query("SELECT detail FROM plan_orders_history WHERE order_id = ? AND action = 'update' ORDER BY id DESC LIMIT 1", [oid]);
  check("журнал заявки: «площадка погрузки» без номеров", /"load_site_id":\[\]/.test(h.detail), h.detail);
  // та же правка с сайта, где площадку выбрали заново - ссылка ставится
  r = as(M.email, "/api/orders/save", { id: oid, load_address: S1.address, load_site_id: S1.id });
  [[o]] = await db.query("SELECT load_site_id FROM plan_orders WHERE id = ?", [oid]);
  check("повторный выбор площадки ставит ссылку", o.load_site_id === S1.id, o);

  // 4. несуществующая площадка - отказ
  r = as(M.email, "/api/orders/save", { id: oid, load_site_id: 99999999 });
  check("несуществующая площадка - 400", r.status === 400, r);

  // 5. менеджер ставит точку площадке без точки; второй раз - нельзя; править площадку - нельзя
  r = as(M.email, "/api/sites/set_point", { id: S0.id, point_text: "Москва, Тверская, 1" });
  check("точка текстом адреса (поиск) - отказ", r.status === 400, r.data);
  r = as(M.email, "/api/sites/set_point", { id: S0.id, point_text: "55.701234, 37.601234" });
  check("менеджер поставил точку площадке без точки", r.status === 200 && r.data.site.lat === 55.701234 && r.data.site.point_source === "manual", r.data);
  r = as(M.email, "/api/sites/set_point", { id: S0.id, point_text: "55.8, 37.7" });
  check("менеджер НЕ меняет уже стоящую точку - 409", r.status === 409, r.data);
  r = as(M.email, "/api/sites/save", { id: S0.id, name: "взлом" });
  check("менеджер не правит площадку - 403", r.status === 403, r.status);

  // 6. admin: правка, смена точки, журнал
  r = as(A.email, "/api/sites/save", { id: S0.id, name: "Тестовая площадка", driver_note: "въезд с северной стороны", contact: "Иван 89161234567" });
  check("admin: правка названия/пометки/контакта", r.status === 200 && r.data.site.driver_note === "въезд с северной стороны" && r.data.site.contact_phone === "+7 916 123-45-67", r.data);
  r = as(A.email, "/api/sites/save", { id: S0.id, point_text: "https://yandex.ru/maps/?pt=37.61,55.71&z=17" });
  check("admin: смена точки ссылкой", r.status === 200 && r.data.site.lat === 55.71 && r.data.site.lon === 37.61, r.data);
  r = as(A.email, "/api/sites/history?id=" + S0.id);
  const acts = (r.data.history || []).map((x) => x.action);
  check("журнал площадки: точка менеджера, правка, точка admin", /^set_point,update,set_point(,create)?$/.test(acts.join(",")), acts);

  // 7. пометка водителю: в списке заявок и в задании MAX (тот же JOIN, что buildTaskText_)
  r = as(M.email, "/api/orders/save", { id: oid, unload_address: S0.address, unload_site_id: S0.id });
  r = as(M.email, "/api/orders?date=2026-10-06");
  const lo = (r.data.orders || []).find((x) => x.id === oid);
  check("список заявок: пометка площадки выгрузки", lo && lo.unload_site && lo.unload_site.driver_note === "въезд с северной стороны", lo && lo.unload_site);
  const [[bt]] = await db.query(`SELECT ls.driver_note AS load_site_note, us.driver_note AS unload_site_note FROM plan_orders o
      LEFT JOIN customer_sites ls ON ls.id = o.load_site_id LEFT JOIN customer_sites us ON us.id = o.unload_site_id WHERE o.id = ?`, [oid]);
  check("задание MAX: пометка берётся по ссылке", bt.unload_site_note === "въезд с северной стороны", bt);

  // 7б. сам текст задания MAX (buildTaskText_ ветки): пометка площадки и «Карта:» по точке площадки, когда своей
  // точки у заявки нет. Исполнитель - любой живой на копии, его заявку привязываем к площадке прямо в yard_staging.
  const [[ex]] = await db.query(`SELECT e.id, e.order_id FROM plan_order_executors e JOIN plan_orders o ON o.id = e.order_id
      WHERE e.removed_at IS NULL AND o.deleted_at IS NULL ORDER BY e.id DESC LIMIT 1`);
  await db.query("UPDATE plan_orders SET unload_site_id = ?, unload_lat = NULL, unload_lon = NULL WHERE id = ?", [S0.id, ex.order_id]);
  const bot = require(process.env.BOT_MODULE)({ app: { get() {}, post() {} }, pool: db, checkWriteKey() {}, checkServerKey() {}, checkSession() {} });
  const bt2 = await bot.buildTaskText_(ex.id);
  console.log("--- текст задания, выгрузка:\n" + bt2.text.slice(bt2.text.indexOf("ВЫГРУЗКА")));
  check("задание MAX: «Пометка:» площадки выгрузки", /ВЫГРУЗКА[\s\S]*Пометка: въезд с северной стороны/.test(bt2.text), bt2.text);
  check("задание MAX: «Карта:» по точке площадки, если у заявки своей нет", /ВЫГРУЗКА[\s\S]*Карта: https:\/\/yandex\.ru\/maps\/\?pt=37\.610*,55\.710*&/.test(bt2.text), bt2.text);

  // 8. архив: в подсказках нет, новая ссылка на неё - отказ, вернуть можно
  r = as(A.email, "/api/sites/archive", { id: S0.id, archived: 1 });
  check("admin: в архив", r.status === 200 && r.data.site.archived === true, r.data);
  r = as(M.email, "/api/sites?" + q({ entity: ent, archived: 1 }));
  check("менеджер архив не видит", !(r.data.sites || []).some((s) => s.id === S0.id), r.data);
  r = as(M.email, "/api/orders/save", { id: oid, unload_site_id: S0.id, unload_address: S0.address + " " });
  check("ссылка на площадку в архиве - 400", r.status === 400, r.data);
  r = as(A.email, "/api/sites/archive", { id: S0.id, archived: 0 });
  check("admin: из архива", r.status === 200 && r.data.site.archived === false, r.data);

  // 9. новая площадка из Справочников
  r = as(A.email, "/api/sites/save", { customer_entity_id: ent, customer_name: S1.customer_name, address: "Тестовый адрес, склад 5", point_text: "" });
  check("admin: новая площадка, имя по умолчанию из адреса", r.status === 200 && r.data.site.name === "Тестовый адрес" && r.data.site.lat === null, r.data);
  r = as(M.email, "/api/sites/save", { customer_entity_id: ent, customer_name: "x", address: "y" });
  check("менеджер не создаёт площадку - 403", r.status === 403, r.status);

  await db.end();
  console.log("\nитого: ok " + ok + ", упало " + bad);
  process.exitCode = bad ? 1 : 0;
})().catch((e) => { console.error("ОШИБКА:", e); process.exit(1); });
