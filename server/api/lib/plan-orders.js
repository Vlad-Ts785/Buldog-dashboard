// «План задание» v2 - заявки менеджеров/логистов на сервере (plans/2026-09-10-order-plan-v2-native.md,
// Фаза 1, 11.09.2026). Копия в репозитории дашборда: server/api/lib/plan-orders.js - живёт на VPS
// в /root/yard-dashboard/api/lib/plan-orders.js (сервер под своим git, см. CLAUDE.md).
//
// Принципы (все - решения Влада 10-11.09, подробности в плане):
//   - заявка = plan_orders, исполнители = plan_order_executors (список), свой парк -> отрезок plan_segs
//     с order_id (передняя половина уже работающей Планировки, не третья система);
//   - менеджер видит СВОИ заявки, логист/админ - все; внутренние заявки логиста менеджерам не видны;
//   - «предупреждать, не запрещать»: занятую машину ставить можно; ЗАПРЕТ только на отбой;
//   - «под данные»: замена вне заявленных - запрос-подтверждение (менеджер согласует с заказчиком);
//   - никаких списков сущностей в коде: юрлица, люди, машины, словари - из справочников.
// Все эндпоинты - checkSession + роль admin/manager/logist. Параметры - JSON-тело (express.json уже
// подключён в server.js) ИЛИ query (для простых POST по образцу остальных роутов).

"use strict";

const crypto = require("crypto");

module.exports = function (deps) {
  const { app, pool, checkSession, requireRole_, normalizeGosServer_, buildFleetSummary_, FLEET_EPOCH0_MS_ } = deps;
  const ROLES = ["admin", "manager", "logist"];
  const gate = [checkSession, requireRole_(...ROLES)];
  const STATUSES = ["unconfirmed", "confirmed", "cancelled", "done"];
  const DEFAULT_TRIP_HOURS = 8; // длина отрезка на ленте по умолчанию; логист тянет сам

  // ── утилиты ────────────────────────────────────────────────────────────────────────────
  function p(req, key) { // параметр из JSON-тела или query
    if (req.body && req.body[key] !== undefined) return req.body[key];
    return req.query[key];
  }
  function str(v, max) { if (v === undefined || v === null) return null; const s = String(v).trim(); return s ? s.slice(0, max) : null; }
  function num(v) { if (v === undefined || v === null || v === "") return null; const n = Number(String(v).replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : null; }
  function bool(v) { return (v === true || v === 1 || v === "1" || v === "true") ? 1 : 0; }
  function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")); }
  function normTime(s) { // "700" -> "07:00", "7:5" -> "07:05", пусто -> null
    if (!s) return null; const d = String(s).replace(/[^\d]/g, ""); if (!d) return null;
    let hh, mm; if (d.length <= 2) { hh = +d; mm = 0; } else if (d.length === 3) { hh = +d[0]; mm = +d.slice(1); } else { hh = +d.slice(0, 2); mm = +d.slice(2, 4); }
    if (!(hh >= 0 && hh < 24 && mm >= 0 && mm < 60)) return null;
    return (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm;
  }
  function hoursFromEpoch(dateStr, timeStr) { // часы от эпохи Планировки (контракт plan_segs)
    const t = timeStr || "08:00";
    return (new Date(dateStr + "T" + t + ":00+03:00").getTime() - FLEET_EPOCH0_MS_) / 3600000;
  }
  function dayWindow(dateStr) { const s = hoursFromEpoch(dateStr, "00:00"); return [s, s + 24]; }
  function code3(fullName) { // АХТ / САВ / СИЛ - как на плитках Планировки
    const sur = String(fullName || "").trim().split(/\s+/)[0] || "";
    return sur.slice(0, 3).toUpperCase();
  }
  function newId(prefix) { return prefix + crypto.randomBytes(5).toString("hex"); }
  function fail(res, code, msg) { return res.status(code).json({ error: msg }); }

  // Ростер (email -> имя/роль) из access_users; кэш 2 мин - дёргается на каждый запрос.
  let rosterCache = { at: 0, byEmail: {}, list: [] };
  async function roster() {
    if (Date.now() - rosterCache.at < 120000) return rosterCache;
    const [rows] = await pool.query(`SELECT email, name, role FROM access_users WHERE role IN ('manager','logist','admin')`);
    // телефон - из справочника людей по полному имени (access_users телефона не хранит); нужен в «Задании водителю»
    const [phones] = await pool.query(`SELECT full_name, phone FROM sprav_people WHERE deleted_at IS NULL AND phone IS NOT NULL AND phone <> ''`);
    const phoneByName = {}; phones.forEach((x) => { phoneByName[String(x.full_name).trim().toLowerCase()] = x.phone; });
    const byEmail = {}; const list = [];
    rows.forEach((r) => { const it = { email: r.email, name: r.name || r.email, role: r.role, code: code3(r.name), phone: phoneByName[String(r.name || "").trim().toLowerCase()] || null }; byEmail[r.email] = it; list.push(it); });
    rosterCache = { at: Date.now(), byEmail, list };
    return rosterCache;
  }
  async function me(req) { const r = await roster(); return r.byEmail[req.userEmail] || { email: req.userEmail, name: req.userEmail, role: req.userRole, code: code3(req.userEmail) }; }

  async function history(conn, orderId, action, snapshot, detail, by) {
    await conn.query(`INSERT INTO plan_orders_history (order_id, action, snapshot, detail, changed_by) VALUES (?,?,?,?,?)`,
      [orderId, action, snapshot ? JSON.stringify(snapshot) : null, detail ? String(detail).slice(0, 500) : null, by]);
  }
  async function loadOrder(conn, id) {
    const [rows] = await conn.query(`SELECT * FROM plan_orders WHERE id = ? AND deleted_at IS NULL`, [id]);
    return rows[0] || null;
  }
  async function loadExecutors(conn, orderIds) {
    if (!orderIds.length) return [];
    const [rows] = await conn.query(
      `SELECT * FROM plan_order_executors WHERE order_id IN (?) AND removed_at IS NULL ORDER BY FIELD(role,'main','reserve'), created_at`, [orderIds]);
    return rows;
  }
  async function loadPending(conn, orderIds) {
    if (!orderIds.length) return [];
    const [rows] = await conn.query(
      `SELECT * FROM plan_order_change_requests WHERE order_id IN (?) AND status = 'pending'`, [orderIds]);
    return rows;
  }
  function canSee(req, o) {
    if (req.userRole === "manager") return !o.internal && o.manager_email === req.userEmail;
    return true;
  }
  function fmtTime(t) { return t ? String(t).slice(0, 5) : null; }
  function fmtDate(d) { // mysql DATE -> 'YYYY-MM-DD' (драйвер может отдать Date)
    if (!d) return null; if (typeof d === "string") return d.slice(0, 10);
    const dt = new Date(d); return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
  }
  function serialize(o, execs, pend, rosterMap) {
    const out = Object.assign({}, o);
    out.service_date = fmtDate(o.service_date); out.service_time = fmtTime(o.service_time);
    out.price = o.price === null ? null : Number(o.price);
    ["created_at", "updated_at", "taken_at", "otboy_ack_at", "needs_data_sent_at"].forEach((k) => { if (out[k]) out[k] = new Date(out[k]).toISOString(); });
    const mgr = rosterMap[o.manager_email];
    out.manager_code = mgr ? mgr.code : (o.manager_name ? code3(o.manager_name) : null);
    out.taken_by_code = o.taken_by_name ? code3(o.taken_by_name) : null;
    // Влад 12.09: «почему нет заполнения в колонке Менеджер? Тот, кто создаёт заявку, тот и
    // менеджер... старший руководитель видит все заявки, эта колонка нужна, чтобы увидеть,
    // кто какие заявки создал» - раньше пусто, если manager_email не проставлен (например,
    // заявку создал логист/admin без явного выбора менеджера, а internal=0). created_by
    // (email) на plan_orders был всегда, просто не резолвился в имя/код для клиента.
    const creator = rosterMap[o.created_by];
    out.created_by_name = creator ? creator.name : null;
    out.created_by_code = creator ? creator.code : null;
    out.executors = execs.map((e) => Object.assign({}, e, {
      purchase_rate: e.purchase_rate === null ? null : Number(e.purchase_rate),
      driver_confirmed_at: e.driver_confirmed_at ? new Date(e.driver_confirmed_at).toISOString() : null,
    }));
    out.pending_request = pend || null;
    return out;
  }

  // Текущий водитель/прицеп тягача - из fleet_assignments (любой открытый slot, самый свежий),
  // имя/телефон - sprav_people. Тот же принцип, что buildFleetSummary_ (без slot=1).
  async function crewFor(conn, gos) {
    const norm = normalizeGosServer_(gos);
    let driver = null, trailer = null;
    // фильтр по тягачу - в JS через normalizeGosServer_ (формат пробелов в госномере не гарантирован)
    const [rows2] = await conn.query(
      `SELECT fa.kind, fa.resource_key, fa.tractor_gos, sp.full_name, sp.phone
         FROM fleet_assignments fa LEFT JOIN sprav_people sp ON sp.id = fa.resource_key
        WHERE fa.valid_to IS NULL ORDER BY fa.valid_from ASC`);
    rows2.forEach((r) => {
      if (normalizeGosServer_(r.tractor_gos) !== norm) return;
      if (r.kind === "driver") driver = { person_id: r.resource_key, name: r.full_name || null, phone: r.phone || null };
      if (r.kind === "trailer") trailer = r.resource_key;
    });
    return { driver, trailer };
  }

  // ── ростер / словари / юрлица ───────────────────────────────────────────────────────────
  async function dictionary() {
    const [rows] = await pool.query(`SELECT kind, value, sort, is_primary FROM plan_dictionary WHERE active = 1 ORDER BY kind, sort`);
    const d = {}; rows.forEach((r) => { (d[r.kind] = d[r.kind] || []).push({ value: r.value, primary: !!r.is_primary }); });
    return d;
  }
  async function ownEntities(internalCustomers) { // internalCustomers=true -> свои юрлица + База (чипы «Кто заказывает» у логиста)
    const [rows] = await pool.query(
      `SELECT id, name, full_name, short_name, own_sort, inn, kpp, director_name, signer_short, bank_name, bank_account, stamp_file, signature_file, is_own, internal_customer
         FROM sprav_legal_entities WHERE ${internalCustomers ? "internal_customer = 1" : "is_own = 1"} AND deleted_at IS NULL ORDER BY COALESCE(own_sort, 999), name`);
    return rows.map((r) => ({
      id: r.id, name: r.name, short: r.short_name || r.name, full_name: r.full_name || r.name, inn: r.inn, director: r.director_name, signer: r.signer_short,
      is_own: !!r.is_own, has_bank: !!(r.bank_name && r.bank_account), has_stamp: !!(r.stamp_file && r.signature_file),
    }));
  }

  // Штамп версии среза дат: max(history.id) + max(orders.updated_at) + max(executors.updated_at/removed_at).
  // Дёшево (три индексных MAX), опрашивается клиентом раз в 2 с - полная перезагрузка только при смене.
  async function versionStamp(from, to) {
    const [[h]] = await pool.query(
      `SELECT MAX(h.id) AS hid, MAX(o.updated_at) AS ou FROM plan_orders o LEFT JOIN plan_orders_history h ON h.order_id = o.id
        WHERE o.service_date BETWEEN ? AND ?`, [from, to]);
    const [[e]] = await pool.query(
      `SELECT MAX(GREATEST(e.updated_at, COALESCE(e.removed_at, e.updated_at))) AS eu
         FROM plan_order_executors e JOIN plan_orders o ON o.id = e.order_id WHERE o.service_date BETWEEN ? AND ?`, [from, to]);
    return [h.hid || 0, h.ou ? new Date(h.ou).toISOString() : "", e.eu ? new Date(e.eu).toISOString() : ""].join("|");
  }
  app.get("/api/orders/tick", ...gate, async (req, res) => {
    try {
      const date = String(req.query.date || ""); const to = String(req.query.to || date);
      if (!isDate(date) || !isDate(to)) return fail(res, 400, "date обязателен");
      res.json({ v: await versionStamp(date, to) });
    } catch (err) { console.error("orders tick:", err); fail(res, 500, String(err.message || err)); }
  });

  // ── GET /api/orders ─────────────────────────────────────────────────────────────────────
  // date=YYYY-MM-DD (+ to=YYYY-MM-DD для недели). Менеджер - свои, не внутренние; логист/админ - все.
  app.get("/api/orders", ...gate, async (req, res) => {
    try {
      const date = String(req.query.date || ""); const to = String(req.query.to || date);
      if (!isDate(date) || !isDate(to)) return fail(res, 400, "date обязателен (YYYY-MM-DD)");
      const r = await roster();
      const where = ["deleted_at IS NULL", "service_date BETWEEN ? AND ?"]; const args = [date, to];
      if (req.userRole === "manager") { where.push("manager_email = ?", "internal = 0"); args.push(req.userEmail); }
      const [rows] = await pool.query(`SELECT * FROM plan_orders WHERE ${where.join(" AND ")} ORDER BY service_date, day_no`, args);
      const ids = rows.map((o) => o.id);
      const execs = await loadExecutors(pool, ids); const pend = await loadPending(pool, ids);
      const execBy = {}; execs.forEach((e) => { (execBy[e.order_id] = execBy[e.order_id] || []).push(e); });
      const pendBy = {}; pend.forEach((q) => { pendBy[q.order_id] = q; });
      const orders = rows.map((o) => serialize(o, execBy[o.id] || [], pendBy[o.id], r.byEmail));
      // Штамп версии - по ВСЕМ источникам изменений (заявки + исполнители + история), не только по
      // plan_orders.updated_at: постановка машины тем же логистом не меняла updated_by -> MySQL не
      // трогал timestamp -> у остальных таблица не перерисовывалась (Влад 11.09: «максимально онлайн»).
      const maxUpdated = await versionStamp(date, to);
      res.json({ orders, max_updated: maxUpdated, me: await me(req), roster: r.list.map((x) => ({ name: x.name, code: x.code, role: x.role, email: x.email })) });
    } catch (err) { console.error("orders list:", err); fail(res, 500, String(err.message || err)); }
  });

  // Счётчики по дням для вкладок (вчера..+7): всего / без машины - по видимости роли.
  app.get("/api/orders/counts", ...gate, async (req, res) => {
    try {
      const from = String(req.query.from || ""), to = String(req.query.to || "");
      if (!isDate(from) || !isDate(to)) return fail(res, 400, "from/to обязательны");
      const where = ["o.deleted_at IS NULL", "o.service_date BETWEEN ? AND ?"]; const args = [from, to];
      if (req.userRole === "manager") { where.push("o.manager_email = ?", "o.internal = 0"); args.push(req.userEmail); }
      const [rows] = await pool.query(
        `SELECT o.service_date, COUNT(*) AS total,
                SUM(o.status = 'cancelled') AS cancelled,
                SUM(o.status <> 'cancelled' AND NOT EXISTS (SELECT 1 FROM plan_order_executors e WHERE e.order_id = o.id AND e.removed_at IS NULL)) AS nocar
           FROM plan_orders o WHERE ${where.join(" AND ")} GROUP BY o.service_date`, args);
      res.json({ counts: rows.map((r) => ({ date: fmtDate(r.service_date), total: Number(r.total), cancelled: Number(r.cancelled), nocar: Number(r.nocar) })) });
    } catch (err) { console.error("orders counts:", err); fail(res, 500, String(err.message || err)); }
  });

  app.get("/api/orders/meta", ...gate, async (req, res) => {
    try { res.json({ dictionary: await dictionary(), own_entities: await ownEntities(false), internal_customers: await ownEntities(true), me: await me(req) }); }
    catch (err) { console.error("orders meta:", err); fail(res, 500, String(err.message || err)); }
  });

  app.get("/api/orders/one", ...gate, async (req, res) => {
    try {
      const o = await loadOrder(pool, Number(req.query.id)); if (!o || !canSee(req, o)) return fail(res, 404, "заявка не найдена");
      const r = await roster(); const execs = await loadExecutors(pool, [o.id]); const pend = await loadPending(pool, [o.id]);
      res.json({ order: serialize(o, execs, pend[0], r.byEmail) });
    } catch (err) { console.error("orders one:", err); fail(res, 500, String(err.message || err)); }
  });

  // ── POST /api/orders/save - создать/изменить заявку ────────────────────────────────────
  // Обязательно при СОЗДАНИИ: service_date, equipment_type, customer, price. Всё остальное -
  // «уточнить». Пустой адрес НЕ блокирует сохранение (менеджер: «точку пришлют через час»).
  // Цена (Влад 12.09: «создание заявки невозможно, пока не внесут цену - и логисты в своих
  // заявках, и менеджеры») - без исключения по роли/internal, только на СОЗДАНИИ (правка уже
  // существующей заявки ценой не блокируется - историю без цены задним числом не трогаем).
  const EDITABLE = ["service_time", "needs_data", "customer", "customer_entity_id", "executor_entity_id", "customer_contact_name",
    "customer_contact_phone", "equipment_type", "cargo", "cargo_weight_t", "cargo_dims", "gabarit", "rework_terms", "documents", "note",
    "cash", "load_address", "load_lat", "load_lon", "load_confirmed", "load_contact_name", "load_contact_phone", "unload_address",
    "unload_lat", "unload_lon", "unload_confirmed", "unload_contact_name", "unload_contact_phone", "price", "payment_status", "internal", "crm_deal_id"];
  function readFields(req) {
    const f = {};
    const b = req.body || {}; const q = req.query || {};
    const get = (k) => (b[k] !== undefined ? b[k] : q[k]);
    if (get("service_date") !== undefined) f.service_date = String(get("service_date"));
    if (get("service_time") !== undefined) f.service_time = normTime(get("service_time"));
    ["customer", "customer_entity_id", "executor_entity_id", "customer_contact_name", "customer_contact_phone", "equipment_type",
      "cargo_dims", "gabarit", "rework_terms", "documents", "payment_status", "load_contact_name", "load_contact_phone",
      "unload_contact_name", "unload_contact_phone"].forEach((k) => { if (get(k) !== undefined) f[k] = str(get(k), 200); });
    if (get("customer") !== undefined) f.customer = str(get("customer"), 255);
    if (get("cargo") !== undefined) f.cargo = str(get("cargo"), 300);
    if (get("note") !== undefined) f.note = str(get("note"), 1000);
    ["load_address", "unload_address"].forEach((k) => { if (get(k) !== undefined) f[k] = str(get(k), 500); });
    ["cargo_weight_t", "load_lat", "load_lon", "unload_lat", "unload_lon", "price", "crm_deal_id"].forEach((k) => { if (get(k) !== undefined) f[k] = num(get(k)); });
    ["needs_data", "cash", "load_confirmed", "unload_confirmed", "internal"].forEach((k) => { if (get(k) !== undefined) f[k] = bool(get(k)); });
    return f;
  }
  app.post("/api/orders/save", ...gate, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const f = readFields(req); const id = Number(p(req, "id")) || 0; const who = await me(req);
      if (id) {
        const o = await loadOrder(conn, id); if (!o || !canSee(req, o)) { conn.release(); return fail(res, 404, "заявка не найдена"); }
        if (f.service_date && !isDate(f.service_date)) { conn.release(); return fail(res, 400, "service_date: YYYY-MM-DD"); }
        const keys = Object.keys(f).filter((k) => EDITABLE.indexOf(k) >= 0 || k === "service_date");
        if (!keys.length) { conn.release(); return res.json({ ok: true, id }); }
        await conn.beginTransaction();
        await history(conn, id, "update", o, keys.join(","), req.userEmail);
        let dayNoSql = "";
        const args = keys.map((k) => f[k]);
        if (f.service_date && f.service_date !== fmtDate(o.service_date)) { // перенос на другой день - новый номер в том дне
          const [[mx]] = await conn.query(`SELECT COALESCE(MAX(day_no),0)+1 AS n FROM plan_orders WHERE service_date = ? FOR UPDATE`, [f.service_date]);
          dayNoSql = ", day_no = ?"; args.push(mx.n);
        }
        args.push(req.userEmail, id);
        await conn.query(`UPDATE plan_orders SET ${keys.map((k) => k + " = ?").join(", ")}${dayNoSql}, updated_by = ? WHERE id = ?`, args);
        if (f.service_date && f.service_date !== fmtDate(o.service_date) || f.service_time !== undefined && f.service_time !== fmtTime(o.service_time)) {
          // время/дата изменились - подвинуть отрезки своего парка на ленте (логисту - уведомление «подвинут рейс»)
          const [ex] = await conn.query(`SELECT seg_id FROM plan_order_executors WHERE order_id = ? AND removed_at IS NULL AND seg_id IS NOT NULL`, [id]);
          const nd = f.service_date || fmtDate(o.service_date); const nt = f.service_time !== undefined ? f.service_time : fmtTime(o.service_time);
          for (const e of ex) await conn.query(`UPDATE plan_segs SET start_hour = ?, updated_by = ? WHERE id = ?`, [hoursFromEpoch(nd, nt), req.userEmail, e.seg_id]);
        }
        await conn.commit();
        const r = await roster(); const o2 = await loadOrder(pool, id);
        res.json({ ok: true, id, order: serialize(o2, await loadExecutors(pool, [id]), (await loadPending(pool, [id]))[0], r.byEmail) });
      } else {
        if (!isDate(f.service_date)) { conn.release(); return fail(res, 400, "service_date обязателен (YYYY-MM-DD)"); }
        if (!f.equipment_type) { conn.release(); return fail(res, 400, "тип техники обязателен"); }
        if (!f.customer) { conn.release(); return fail(res, 400, "заказчик обязателен"); }
        if (!f.price) { conn.release(); return fail(res, 400, "цена обязательна"); }
        const isMgr = req.userRole === "manager";
        const internal = isMgr ? 0 : (f.internal || 0);
        const managerEmail = isMgr ? req.userEmail : (internal ? null : (str(p(req, "manager_email"), 255) || null));
        const rMap = (await roster()).byEmail;
        const managerName = managerEmail ? (rMap[managerEmail] ? rMap[managerEmail].name : managerEmail) : null;
        await conn.beginTransaction();
        let orderId = null;
        for (let attempt = 0; attempt < 3 && !orderId; attempt++) {
          const [[mx]] = await conn.query(`SELECT COALESCE(MAX(day_no),0)+1 AS n FROM plan_orders WHERE service_date = ? FOR UPDATE`, [f.service_date]);
          try {
            const cols = ["service_date", "day_no", "status", "manager_email", "manager_name", "created_role", "internal", "created_by", "updated_by"];
            const vals = [f.service_date, mx.n, "unconfirmed", managerEmail, managerName, req.userRole, internal, req.userEmail, req.userEmail];
            EDITABLE.forEach((k) => { if (k !== "internal" && f[k] !== undefined) { cols.push(k); vals.push(f[k]); } });
            const [ins] = await conn.query(`INSERT INTO plan_orders (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, vals);
            orderId = ins.insertId;
          } catch (e) { if (e.code !== "ER_DUP_ENTRY") throw e; }
        }
        if (!orderId) throw new Error("не удалось выдать номер дня");
        await history(conn, orderId, "create", Object.assign({ id: orderId }, f), null, req.userEmail);
        await conn.commit();
        const r = await roster(); const o2 = await loadOrder(pool, orderId);
        res.json({ ok: true, id: orderId, day_no: o2.day_no, order: serialize(o2, [], null, r.byEmail) });
      }
    } catch (err) { try { await conn.rollback(); } catch (e) {} console.error("orders save:", err); fail(res, 500, String(err.message || err)); }
    finally { conn.release(); }
  });

  // ── статус / беру в работу / принял отбой / удалить ────────────────────────────────────
  async function simpleUpdate(req, res, action, fn) {
    const conn = await pool.getConnection();
    try {
      const id = Number(p(req, "id")); const o = await loadOrder(conn, id);
      if (!o || !canSee(req, o)) { return fail(res, 404, "заявка не найдена"); }
      await conn.beginTransaction();
      const detail = await fn(conn, o);
      if (detail === false) { await conn.rollback(); return; }
      await history(conn, id, action, o, detail || null, req.userEmail);
      await conn.commit();
      if (action === "delete") return res.json({ ok: true, deleted: true, id }); // строка уже мягко удалена - перечитывать нечего
      const r = await roster(); const o2 = await loadOrder(pool, id);
      res.json({ ok: true, order: serialize(o2, await loadExecutors(pool, [id]), (await loadPending(pool, [id]))[0], r.byEmail) });
    } catch (err) { try { await conn.rollback(); } catch (e) {} console.error("orders " + action + ":", err); fail(res, 500, String(err.message || err)); }
    finally { conn.release(); }
  }
  app.post("/api/orders/status", ...gate, (req, res) => simpleUpdate(req, res, "status", async (conn, o) => {
    const st = String(p(req, "status") || "");
    if (STATUSES.indexOf(st) < 0) { fail(res, 400, "неизвестный статус"); return false; }
    // отбой - сброс «принял», чтобы у логистов замигало заново; done - только логист/админ (решение 10.09)
    if (st === "done" && req.userRole === "manager") { fail(res, 403, "«Выполнено» ставит логист"); return false; }
    await conn.query(`UPDATE plan_orders SET status = ?, otboy_ack_by = IF(? = 'cancelled', NULL, otboy_ack_by), otboy_ack_at = IF(? = 'cancelled', NULL, otboy_ack_at), updated_by = ? WHERE id = ?`,
      [st, st, st, req.userEmail, o.id]);
    return o.status + " -> " + st;
  }));
  app.post("/api/orders/take", ...gate, (req, res) => simpleUpdate(req, res, "take", async (conn, o) => {
    if (req.userRole === "manager") { fail(res, 403, "«беру в работу» - действие логиста"); return false; }
    const who = await me(req);
    await conn.query(`UPDATE plan_orders SET taken_by = ?, taken_by_name = ?, taken_at = NOW(), updated_by = ? WHERE id = ?`, [req.userEmail, who.name, req.userEmail, o.id]);
    return who.name;
  }));
  app.post("/api/orders/otboy_ack", ...gate, (req, res) => simpleUpdate(req, res, "otboy_ack", async (conn, o) => {
    if (o.status !== "cancelled") { fail(res, 400, "по заявке нет отбоя"); return false; }
    const who = await me(req);
    await conn.query(`UPDATE plan_orders SET otboy_ack_by = ?, otboy_ack_at = NOW(), updated_by = ? WHERE id = ?`, [who.name, req.userEmail, o.id]);
    return who.name;
  }));
  // удалять заявку может только admin (Влад 11.09: «мне единственному право удалять строку»); менеджер/логист - отбой
  app.post("/api/orders/delete", checkSession, requireRole_("admin"), (req, res) => simpleUpdate(req, res, "delete", async (conn, o) => {
    const [ex] = await conn.query(`SELECT id, seg_id FROM plan_order_executors WHERE order_id = ? AND removed_at IS NULL`, [o.id]);
    for (const e of ex) await removeExecutorRow(conn, e, req.userEmail);
    await conn.query(`UPDATE plan_orders SET deleted_at = NOW(), deleted_by = ?, updated_by = ? WHERE id = ?`, [req.userEmail, req.userEmail, o.id]);
    return "мягкое удаление";
  }));

  // ── исполнители: свой парк ─────────────────────────────────────────────────────────────
  async function removeExecutorRow(conn, e, by) {
    if (e.seg_id) {
      const [segs] = await conn.query(`SELECT * FROM plan_segs WHERE id = ?`, [e.seg_id]);
      if (segs.length) {
        await conn.query(`INSERT INTO plan_segs_history (seg_id, action, snapshot, overwritten_by) VALUES (?, 'delete', ?, ?)`, [e.seg_id, JSON.stringify(segs[0]), by]);
        await conn.query(`DELETE FROM plan_segs WHERE id = ?`, [e.seg_id]);
      }
    }
    await conn.query(`UPDATE plan_order_executors SET removed_at = NOW(), removed_by = ? WHERE id = ?`, [by, e.id]);
  }
  async function createOwnExecutor(conn, o, gos, role, who, lengthHours) {
    const crew = await crewFor(conn, gos);
    let segId = null;
    if (role === "main") { // резерв отрезок НЕ создаёт - машина остаётся свободной для другой работы
      segId = "o" + o.id + "-" + crypto.randomBytes(4).toString("hex");
      const start = hoursFromEpoch(fmtDate(o.service_date), fmtTime(o.service_time));
      const seg = {
        id: segId, vehicle_gos: gos, kind: "trip", start_hour: start, length_hours: lengthHours || DEFAULT_TRIP_HOURS,
        manager_name: o.manager_name, logist_name: who.name, driver_person_id: crew.driver ? crew.driver.person_id : null,
        order_number: null, route_from: (o.load_address || "").slice(0, 200) || null, route_to: (o.unload_address || "").slice(0, 200) || null,
        customer: (o.customer || "").slice(0, 255) || null, trip_mode: null, needs_data: o.needs_data ? 1 : 0, reason: null, repair_reason: null,
        updated_by: who.email, created_by: who.email, order_id: o.id,
      };
      await conn.query(
        `INSERT INTO plan_segs (id, vehicle_gos, kind, start_hour, length_hours, manager_name, logist_name, driver_person_id, order_number,
           route_from, route_to, customer, trip_mode, needs_data, reason, repair_reason, updated_by, created_by, order_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [seg.id, seg.vehicle_gos, seg.kind, seg.start_hour, seg.length_hours, seg.manager_name, seg.logist_name, seg.driver_person_id, seg.order_number,
          seg.route_from, seg.route_to, seg.customer, seg.trip_mode, seg.needs_data, seg.reason, seg.repair_reason, seg.updated_by, seg.created_by, seg.order_id]);
      await conn.query(`INSERT INTO plan_segs_history (seg_id, action, snapshot, overwritten_by) VALUES (?, 'create', ?, ?)`, [segId, JSON.stringify(seg), who.email]);
    }
    const exId = newId("x");
    await conn.query(
      `INSERT INTO plan_order_executors (id, order_id, kind, role, seg_id, vehicle_gos, trailer_gos, driver_person_id, driver_name, driver_phone, created_by, created_by_name, updated_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [exId, o.id, "own", role, segId, gos, crew.trailer, crew.driver ? crew.driver.person_id : null, crew.driver ? crew.driver.name : null,
        crew.driver ? crew.driver.phone : null, who.email, who.name, who.email]);
    return { id: exId, seg_id: segId, gos, driver: crew.driver, trailer: crew.trailer };
  }
  async function respondOrder(res, id, extra) {
    const r = await roster(); const o2 = await loadOrder(pool, id);
    res.json(Object.assign({ ok: true, order: serialize(o2, await loadExecutors(pool, [id]), (await loadPending(pool, [id]))[0], r.byEmail) }, extra || {}));
  }

  // POST /api/orders/executor_set { order_id, gos, mode: replace|add, length_hours?, force? }
  //  - отбой: запрет (единственный запрет в системе);
  //  - «под данные» с заявленными: gos из списка -> смена ролей (резерв <-> основная) без вопросов;
  //    gos вне списка и mode=replace -> запрос на замену (pending), машина не меняется;
  //  - иначе replace: снять текущих own main и поставить; add: добавить (у «под данные» - как резерв).
  app.post("/api/orders/executor_set", ...gate, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      if (req.userRole === "manager") return fail(res, 403, "машину ставит логист");
      const orderId = Number(p(req, "order_id")); const gos = str(p(req, "gos"), 32); const mode = p(req, "mode") === "add" ? "add" : "replace";
      const lengthHours = num(p(req, "length_hours")) || DEFAULT_TRIP_HOURS; const force = bool(p(req, "force"));
      if (!orderId || !gos) return fail(res, 400, "order_id и gos обязательны");
      const o = await loadOrder(conn, orderId); if (!o) return fail(res, 404, "заявка не найдена");
      if (o.status === "cancelled") return fail(res, 409, "по заявке отбой - машину поставить нельзя");
      const who = await me(req);
      const execs = (await loadExecutors(conn, [orderId])).filter((e) => e.kind === "own");
      const norm = normalizeGosServer_(gos);
      const declared = execs.find((e) => normalizeGosServer_(e.vehicle_gos) === norm);
      await conn.beginTransaction();
      if (o.needs_data && execs.length && declared && mode === "replace") { // из заявленных: сделать основной
        for (const e of execs) {
          const newRole = e.id === declared.id ? "main" : "reserve";
          if (newRole === e.role) continue;
          if (newRole === "main") { // поднимаем резерв в основную - у него нет отрезка, создаём
            const created = await createOwnExecutor(conn, o, e.vehicle_gos, "main", who, lengthHours);
            await conn.query(`UPDATE plan_order_executors SET removed_at = NOW(), removed_by = ? WHERE id = ?`, [who.email, e.id]);
            await conn.query(`UPDATE plan_order_executors SET driver_confirmed_at = ?, driver_confirmed_by = ? WHERE id = ?`, [e.driver_confirmed_at, e.driver_confirmed_by, created.id]);
          } else { // основная уходит в резерв - отрезок снимаем, запись остаётся резервом
            if (e.seg_id) { const [segs] = await conn.query(`SELECT * FROM plan_segs WHERE id = ?`, [e.seg_id]);
              if (segs.length) { await conn.query(`INSERT INTO plan_segs_history (seg_id, action, snapshot, overwritten_by) VALUES (?, 'delete', ?, ?)`, [e.seg_id, JSON.stringify(segs[0]), who.email]); await conn.query(`DELETE FROM plan_segs WHERE id = ?`, [e.seg_id]); } }
            await conn.query(`UPDATE plan_order_executors SET role = 'reserve', seg_id = NULL, updated_by = ? WHERE id = ?`, [who.email, e.id]);
          }
        }
        await history(conn, orderId, "executor_role", null, "основная -> " + gos, who.email);
        await conn.commit(); return respondOrder(res, orderId, { swapped: true });
      }
      if (o.needs_data && execs.length && !declared && mode === "replace" && !force) { // вне заявленных - запрос менеджеру
        const crew = await crewFor(conn, gos); const from = execs.find((e) => e.role === "main") || execs[0];
        await conn.query(`UPDATE plan_order_change_requests SET status = 'cancelled' WHERE order_id = ? AND status = 'pending'`, [orderId]);
        const [ins] = await conn.query(
          `INSERT INTO plan_order_change_requests (order_id, type, from_executor_id, from_gos, to_gos, to_driver_name, requested_by, requested_by_name, comment)
           VALUES (?,?,?,?,?,?,?,?,?)`, [orderId, "replace_vehicle", from.id, from.vehicle_gos, gos, crew.driver ? crew.driver.name : null, who.email, who.name, str(p(req, "comment"), 500)]);
        await history(conn, orderId, "change_request", null, from.vehicle_gos + " -> " + gos + " (ждёт менеджера)", who.email);
        await conn.commit(); return respondOrder(res, orderId, { pending: true, request_id: ins.insertId });
      }
      if (mode === "replace") { for (const e of execs.filter((x) => x.role === "main")) await removeExecutorRow(conn, e, who.email); }
      const role = (mode === "add" && o.needs_data && execs.some((e) => e.role === "main")) ? "reserve" : "main";
      const created = await createOwnExecutor(conn, o, gos, role, who, lengthHours);
      if (!o.taken_by) await conn.query(`UPDATE plan_orders SET taken_by = ?, taken_by_name = ?, taken_at = NOW() WHERE id = ?`, [who.email, who.name, orderId]);
      await conn.query(`UPDATE plan_orders SET updated_by = ? WHERE id = ?`, [who.email, orderId]);
      await history(conn, orderId, "executor_set", null, gos + " · " + role + (created.driver ? " · " + created.driver.name : ""), who.email);
      await conn.commit(); return respondOrder(res, orderId, { executor: created, outside_declared: !!(o.needs_data && force) });
    } catch (err) { try { await conn.rollback(); } catch (e) {} console.error("executor_set:", err); fail(res, 500, String(err.message || err)); }
    finally { conn.release(); }
  });

  app.post("/api/orders/executor_remove", ...gate, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      if (req.userRole === "manager") return fail(res, 403, "машину снимает логист");
      const exId = str(p(req, "executor_id"), 64); const [rows] = await conn.query(`SELECT * FROM plan_order_executors WHERE id = ? AND removed_at IS NULL`, [exId]);
      if (!rows.length) return fail(res, 404, "исполнитель не найден");
      const e = rows[0]; await conn.beginTransaction();
      await removeExecutorRow(conn, e, req.userEmail);
      await conn.query(`UPDATE plan_orders SET updated_by = ? WHERE id = ?`, [req.userEmail, e.order_id]);
      await history(conn, e.order_id, "executor_remove", null, (e.vehicle_gos || e.carrier_name || "") + " снята", req.userEmail);
      await conn.commit(); return respondOrder(res, e.order_id);
    } catch (err) { try { await conn.rollback(); } catch (e) {} console.error("executor_remove:", err); fail(res, 500, String(err.message || err)); }
    finally { conn.release(); }
  });

  // «водитель подтвердил» - логист; у менеджера госномер зелёный. on=1|0
  app.post("/api/orders/executor_confirm", ...gate, async (req, res) => {
    try {
      if (req.userRole === "manager") return fail(res, 403, "отметку ставит логист");
      const exId = str(p(req, "executor_id"), 64); const on = bool(p(req, "on")); const who = await me(req);
      const [rows] = await pool.query(`SELECT * FROM plan_order_executors WHERE id = ? AND removed_at IS NULL`, [exId]);
      if (!rows.length) return fail(res, 404, "исполнитель не найден");
      await pool.query(`UPDATE plan_order_executors SET driver_confirmed_at = ?, driver_confirmed_by = ?, updated_by = ? WHERE id = ?`, [on ? new Date() : null, on ? who.name : null, who.email, exId]);
      await history(pool, rows[0].order_id, "driver_confirm", null, (rows[0].vehicle_gos || "") + (on ? " подтвердил" : " снято"), who.email);
      return respondOrder(res, rows[0].order_id);
    } catch (err) { console.error("executor_confirm:", err); fail(res, 500, String(err.message || err)); }
  });

  // «Задание водителю» отправлено/скопировано - отметка для менеджера
  app.post("/api/orders/executor_task_sent", ...gate, async (req, res) => {
    try {
      const exId = str(p(req, "executor_id"), 64); const who = await me(req);
      const [rows] = await pool.query(`SELECT order_id FROM plan_order_executors WHERE id = ? AND removed_at IS NULL`, [exId]);
      if (!rows.length) return fail(res, 404, "исполнитель не найден");
      await pool.query(`UPDATE plan_order_executors SET driver_task_sent_at = NOW(), driver_task_sent_by = ? WHERE id = ?`, [who.name, exId]);
      return respondOrder(res, rows[0].order_id);
    } catch (err) { console.error("executor_task_sent:", err); fail(res, 500, String(err.message || err)); }
  });

  // Перетащить машину на другую заявку: цель пустая - перенос, занята - обмен. Отбой - не цель.
  // Подтверждение водителя сбрасывается (задание другое). «Под данные» участвует - warn в ответе.
  app.post("/api/orders/executor_move", ...gate, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      if (req.userRole === "manager") return fail(res, 403, "машину переносит логист");
      const exId = str(p(req, "executor_id"), 64); const toId = Number(p(req, "to_order_id")); const who = await me(req);
      const [rows] = await conn.query(`SELECT * FROM plan_order_executors WHERE id = ? AND removed_at IS NULL`, [exId]);
      if (!rows.length) return fail(res, 404, "исполнитель не найден");
      const e = rows[0]; if (e.kind !== "own") return fail(res, 400, "переносить можно только свой парк");
      const src = await loadOrder(conn, e.order_id); const dst = await loadOrder(conn, toId);
      if (!src || !dst) return fail(res, 404, "заявка не найдена"); if (dst.status === "cancelled") return fail(res, 409, "на заявку с отбоем машину не ставим");
      if (src.id === dst.id) return fail(res, 400, "та же заявка");
      const dstMain = (await loadExecutors(conn, [dst.id])).filter((x) => x.kind === "own" && x.role === "main");
      await conn.beginTransaction();
      for (const d of dstMain) await removeExecutorRow(conn, d, who.email);
      await removeExecutorRow(conn, e, who.email);
      const moved = await createOwnExecutor(conn, dst, e.vehicle_gos, "main", who, null);
      let swappedBack = null;
      if (dstMain.length) swappedBack = await createOwnExecutor(conn, src, dstMain[0].vehicle_gos, "main", who, null);
      await conn.query(`UPDATE plan_orders SET updated_by = ? WHERE id IN (?, ?)`, [who.email, src.id, dst.id]);
      await history(conn, src.id, "executor_move", null, e.vehicle_gos + " -> №" + dst.day_no + (swappedBack ? " (обмен на " + dstMain[0].vehicle_gos + ")" : ""), who.email);
      await history(conn, dst.id, "executor_move", null, e.vehicle_gos + " <- №" + src.day_no, who.email);
      await conn.commit();
      const r = await roster();
      const pack = async (id) => { const o = await loadOrder(pool, id); return serialize(o, await loadExecutors(pool, [id]), (await loadPending(pool, [id]))[0], r.byEmail); };
      res.json({ ok: true, from: await pack(src.id), to: await pack(dst.id), swapped: !!swappedBack, swapped_gos: swappedBack ? dstMain[0].vehicle_gos : null, moved_gos: e.vehicle_gos, warn_needs_data: !!(src.needs_data || dst.needs_data) });
    } catch (err) { try { await conn.rollback(); } catch (e) {} console.error("executor_move:", err); fail(res, 500, String(err.message || err)); }
    finally { conn.release(); }
  });

  // Наёмник - поля прямо на исполнителе (одна запись kind=hired на заявку; повторный вызов - правка).
  // «под данные»: если у заявки УЖЕ есть наёмник и меняется КОМПАНИЯ (не техдетали вроде госномера/
  // водителя/ставки у той же компании) - тот же принцип, что у своей машины (вне заявленных -> запрос
  // менеджеру, plan_order_change_requests), не тихая правка. Влад 12.09 (живой тест): «была под
  // данные, но я смог изменить название компании-партнёра без согласования с менеджером» - этой
  // проверки не было вообще, чинится здесь.
  app.post("/api/orders/hired_set", ...gate, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      if (req.userRole === "manager") return fail(res, 403, "наёмника ставит логист");
      const orderId = Number(p(req, "order_id")); const o = await loadOrder(conn, orderId); if (!o) return fail(res, 404, "заявка не найдена");
      if (o.status === "cancelled") return fail(res, 409, "по заявке отбой");
      const who = await me(req);
      const force = bool(p(req, "force"));
      const f = {
        carrier_id: str(p(req, "carrier_id"), 64), carrier_name: str(p(req, "carrier_name"), 200), carrier_contact: str(p(req, "carrier_contact"), 200),
        vehicle_gos: str(p(req, "gos"), 32), trailer_gos: str(p(req, "trailer_gos"), 32), driver_name: str(p(req, "driver_name"), 150), driver_phone: str(p(req, "driver_phone"), 64),
        purchase_rate: num(p(req, "purchase_rate")), settlement: str(p(req, "settlement"), 30), carrier_status: str(p(req, "carrier_status"), 20) || "negotiating",
        comment: str(p(req, "comment"), 500), found_by: req.userRole === "manager" ? "manager" : "logist",
      };
      if (!f.carrier_name) return fail(res, 400, "перевозчик обязателен");
      // Влад 12.09: «отдать наёмнику невозможно без указания цены» - ставка закупки
      // обязательна, без исключения (та же логика, что цена заявки при создании).
      if (!f.purchase_rate) return fail(res, 400, "ставка закупки обязательна");
      await conn.beginTransaction();
      const [ex] = await conn.query(`SELECT id, carrier_name FROM plan_order_executors WHERE order_id = ? AND kind = 'hired' AND removed_at IS NULL`, [orderId]);
      const prevName = ex.length ? String(ex[0].carrier_name || "").trim() : "";
      const changingCarrier = prevName && prevName.toLowerCase() !== f.carrier_name.toLowerCase();
      if (o.needs_data && changingCarrier && !force) { // другая компания на «под данные» - без спроса нельзя
        await conn.query(`UPDATE plan_order_change_requests SET status = 'cancelled' WHERE order_id = ? AND status = 'pending'`, [orderId]);
        const [ins] = await conn.query(
          `INSERT INTO plan_order_change_requests (order_id, type, from_carrier_name, to_carrier_name, to_carrier_id, requested_by, requested_by_name, comment)
           VALUES (?,'replace_carrier',?,?,?,?,?,?)`, [orderId, prevName, f.carrier_name, f.carrier_id, who.email, who.name, f.comment]);
        await history(conn, orderId, "change_request", null, prevName + " -> " + f.carrier_name + " (ждёт менеджера)", who.email);
        await conn.commit(); return respondOrder(res, orderId, { pending: true, request_id: ins.insertId });
      }
      if (ex.length) {
        await conn.query(`UPDATE plan_order_executors SET carrier_id=?, carrier_name=?, carrier_contact=?, vehicle_gos=?, trailer_gos=?, driver_name=?, driver_phone=?, purchase_rate=?, settlement=?, carrier_status=?, comment=?, updated_by=? WHERE id = ?`,
          [f.carrier_id, f.carrier_name, f.carrier_contact, f.vehicle_gos, f.trailer_gos, f.driver_name, f.driver_phone, f.purchase_rate, f.settlement, f.carrier_status, f.comment, who.email, ex[0].id]);
      } else {
        await conn.query(`INSERT INTO plan_order_executors (id, order_id, kind, role, carrier_id, carrier_name, carrier_contact, vehicle_gos, trailer_gos, driver_name, driver_phone, purchase_rate, settlement, carrier_status, found_by, comment, created_by, created_by_name, updated_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [newId("h"), orderId, "hired", "main", f.carrier_id, f.carrier_name, f.carrier_contact, f.vehicle_gos, f.trailer_gos, f.driver_name, f.driver_phone, f.purchase_rate, f.settlement, f.carrier_status, f.found_by, f.comment, who.email, who.name, who.email]);
      }
      if (!o.taken_by) await conn.query(`UPDATE plan_orders SET taken_by = ?, taken_by_name = ?, taken_at = NOW() WHERE id = ?`, [who.email, who.name, orderId]);
      await conn.query(`UPDATE plan_orders SET updated_by = ? WHERE id = ?`, [who.email, orderId]);
      await history(conn, orderId, "hired_set", null, f.carrier_name + " · " + (f.carrier_status || ""), who.email);
      await conn.commit(); return respondOrder(res, orderId, { outside_declared: !!(o.needs_data && force && changingCarrier) });
    } catch (err) { try { await conn.rollback(); } catch (e) {} console.error("hired_set:", err); fail(res, 500, String(err.message || err)); }
    finally { conn.release(); }
  });

  // Менеджер (или админ) отвечает на запрос замены: approve -> замена применяется, reject -> едет прежняя.
  app.post("/api/orders/change_request_resolve", ...gate, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      const rid = Number(p(req, "id")); const action = String(p(req, "action") || "");
      if (["approve", "reject"].indexOf(action) < 0) return fail(res, 400, "action: approve|reject");
      const [rows] = await conn.query(`SELECT * FROM plan_order_change_requests WHERE id = ? AND status = 'pending'`, [rid]);
      if (!rows.length) return fail(res, 404, "запрос не найден или уже решён");
      const q = rows[0]; const o = await loadOrder(conn, q.order_id); if (!o || !canSee(req, o)) return fail(res, 404, "заявка не найдена");
      if (req.userRole === "logist" && action === "approve") return fail(res, 403, "подтверждает менеджер (согласовав с заказчиком)");
      const who = await me(req);
      await conn.beginTransaction();
      if (action === "approve") {
        if (q.type === "replace_carrier") { // наёмник - меняем компанию НА исполнителе, машину не трогаем
          const [hex] = await conn.query(`SELECT id FROM plan_order_executors WHERE order_id = ? AND kind = 'hired' AND removed_at IS NULL`, [o.id]);
          if (hex.length) await conn.query(`UPDATE plan_order_executors SET carrier_name = ?, carrier_id = ?, updated_by = ? WHERE id = ?`, [q.to_carrier_name, q.to_carrier_id, who.email, hex[0].id]);
        } else {
          const execs = (await loadExecutors(conn, [o.id])).filter((e) => e.kind === "own" && e.role === "main");
          for (const e of execs) await removeExecutorRow(conn, e, who.email);
          await createOwnExecutor(conn, o, q.to_gos, "main", who, null);
        }
        await conn.query(`UPDATE plan_orders SET needs_data_sent_at = NULL, updated_by = ? WHERE id = ?`, [who.email, o.id]); // данные на пропуск надо отправить заново
      }
      await conn.query(`UPDATE plan_order_change_requests SET status = ?, resolved_by = ?, resolved_by_name = ?, resolved_at = NOW() WHERE id = ?`,
        [action === "approve" ? "approved" : "rejected", who.email, who.name, rid]);
      await history(conn, o.id, "change_request_" + action, null,
        (q.type === "replace_carrier" ? q.from_carrier_name + " -> " + q.to_carrier_name : q.from_gos + " -> " + q.to_gos), who.email);
      await conn.commit(); return respondOrder(res, o.id);
    } catch (err) { try { await conn.rollback(); } catch (e) {} console.error("change_request_resolve:", err); fail(res, 500, String(err.message || err)); }
    finally { conn.release(); }
  });

  app.post("/api/orders/needs_data_sent", ...gate, (req, res) => simpleUpdate(req, res, "needs_data_sent", async (conn, o) => {
    await conn.query(`UPDATE plan_orders SET needs_data_sent_at = NOW(), updated_by = ? WHERE id = ?`, [req.userEmail, o.id]); return "данные отправлены заказчику";
  }));

  // ── машины: пикер и «свободные сегодня/завтра» ──────────────────────────────────────────
  // Состояние машины на день/время заявки по отрезкам ленты. Секции пикера: free / busy /
  // nodriver / repair. Занятая - доступна (предупреждаем, не запрещаем).
  async function vehiclesForDate(dateStr, timeStr) {
    const fleet = await buildFleetSummary_();
    const [ws, we] = dayWindow(dateStr); const at = timeStr ? hoursFromEpoch(dateStr, timeStr) : null;
    const [segs] = await pool.query(
      `SELECT s.vehicle_gos, s.kind, s.start_hour, s.length_hours, s.customer, s.route_from, s.route_to, s.order_id, o.day_no
         FROM plan_segs s LEFT JOIN plan_orders o ON o.id = s.order_id
        WHERE s.start_hour < ? AND s.start_hour + s.length_hours > ?`, [we, ws]);
    const byGos = {}; segs.forEach((s) => { (byGos[normalizeGosServer_(s.vehicle_gos)] = byGos[normalizeGosServer_(s.vehicle_gos)] || []).push(s); });
    const hh = (h) => { const x = ((h - ws) % 24 + 24) % 24; return String(Math.floor(x)).padStart(2, "0") + ":" + String(Math.round((x % 1) * 60)).padStart(2, "0"); };
    const list = Object.keys(fleet).map((k) => {
      const v = fleet[k]; const ss = byGos[k] || [];
      const isTral = !/борт|длинномер/i.test(v.type || "");
      let state = "free", busy = null;
      const overlap = at === null ? ss : ss.filter((s) => Number(s.start_hour) <= at + 1 && Number(s.start_hour) + Number(s.length_hours) > at - 1);
      const rep = ss.find((s) => s.kind === "repair" || s.kind === "maint"); const off = ss.find((s) => s.kind === "driveroff");
      const trip = overlap.find((s) => s.kind === "trip") || ss.find((s) => s.kind === "trip");
      if (rep) { state = "repair"; busy = rep.kind === "repair" ? "Ремонт" : "ТО"; }
      else if (!v.driver || off) { state = "nodriver"; busy = off ? "без водителя (выходной/отпуск)" : "нет водителя"; }
      else if (trip) { state = "busy"; busy = hh(Number(trip.start_hour)) + "-" + hh(Number(trip.start_hour) + Number(trip.length_hours)) + (trip.day_no ? " · №" + trip.day_no : "") + (trip.customer ? " · " + trip.customer : ""); }
      return { gos: v.gos, type: v.type, seg: isTral ? "tral" : "bort", marka: v.marka, driver: v.driver, trailer: v.trailerGos, state, busy, trips_today: ss.filter((s) => s.kind === "trip").length };
    });
    list.sort((a, b) => (a.seg === b.seg ? 0 : a.seg === "tral" ? -1 : 1) || a.gos.localeCompare(b.gos, "ru"));
    return list;
  }
  app.get("/api/orders/vehicles", ...gate, async (req, res) => {
    try {
      const date = String(req.query.date || ""); if (!isDate(date)) return fail(res, 400, "date обязателен");
      res.json({ vehicles: await vehiclesForDate(date, normTime(req.query.time)), date });
    } catch (err) { console.error("orders vehicles:", err); fail(res, 500, String(err.message || err)); }
  });
  // Свободны на день - для менеджера (тралы/борта, без панелевозов - Влад 10.09).
  app.get("/api/orders/free_vehicles", ...gate, async (req, res) => {
    try {
      const dates = String(req.query.dates || req.query.date || "").split(",").filter(isDate);
      if (!dates.length) return fail(res, 400, "dates обязателен");
      const out = {};
      for (const d of dates) {
        const vs = (await vehiclesForDate(d, null)).filter((v) => v.state === "free");
        out[d] = { total: vs.length, tral: vs.filter((v) => v.seg === "tral").length, bort: vs.filter((v) => v.seg === "bort").length,
          list: vs.map((v) => ({ gos: v.gos, type: v.type, seg: v.seg, driver: v.driver })) };
      }
      res.json({ free: out });
    } catch (err) { console.error("free_vehicles:", err); fail(res, 500, String(err.message || err)); }
  });

  // ── подсказки: заказчики, их контакты и адреса, история ────────────────────────────────
  app.get("/api/orders/customers", ...gate, async (req, res) => {
    try {
      const q = String(req.query.q || "").trim(); if (q.length < 2) return res.json({ mine: [], all: [] });
      const like = q + "%";
      const mineWhere = req.userRole === "manager" ? "AND manager_email = ?" : "";
      const args = [like]; if (req.userRole === "manager") args.push(req.userEmail);
      const [mine] = await pool.query(
        `SELECT customer, COUNT(*) AS n, MAX(customer_entity_id) AS entity_id FROM plan_orders
          WHERE deleted_at IS NULL AND service_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) AND customer LIKE ? ${mineWhere}
          GROUP BY customer ORDER BY n DESC LIMIT 8`, args);
      const [all] = await pool.query(
        `SELECT id, name, inn, is_own, risk_light FROM sprav_legal_entities WHERE deleted_at IS NULL AND name LIKE ? ORDER BY is_own DESC, name LIMIT 12`, [like]);
      res.json({ mine: mine.map((m) => ({ name: m.customer, n: Number(m.n), entity_id: m.entity_id })), all });
    } catch (err) { console.error("orders customers:", err); fail(res, 500, String(err.message || err)); }
  });
  // Подсказки для «Компания-перевозчик» у наёмника (Влад 12.09: «тоже должен быть справочник
  // юридических лиц» - раньше было голое текстовое поле). Своя история наёмок + весь справочник
  // юрлиц, как у «Заказчика» - тот же принцип, отдельный эндпоинт, т.к. «мои за 30 дней» у
  // customers - это per-менеджер выборка из plan_orders, а тут - per-перевозчик выборка из
  // plan_order_executors, разные группировки. История - Влад 12.09 (второй заход): «подсказки
  // тех поставщиков, с кем мы уже В ЭТОМ МЕСЯЦЕ работаем» - JOIN на plan_orders.service_date
  // в границах текущего календарного месяца, не всё время (was: без временн0го окна вообще).
  app.get("/api/orders/carriers", ...gate, async (req, res) => {
    try {
      const q = String(req.query.q || "").trim(); if (q.length < 2) return res.json({ history: [], all: [] });
      const like = q + "%";
      const [history] = await pool.query(
        `SELECT e.carrier_name AS carrier_name, MAX(e.carrier_id) AS carrier_id, COUNT(*) AS n
           FROM plan_order_executors e JOIN plan_orders o ON o.id = e.order_id
          WHERE e.kind = 'hired' AND e.removed_at IS NULL AND e.carrier_name LIKE ?
            AND o.service_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
            AND o.service_date < DATE_FORMAT(CURDATE() + INTERVAL 1 MONTH, '%Y-%m-01')
          GROUP BY e.carrier_name ORDER BY n DESC LIMIT 6`, [like]);
      const [all] = await pool.query(
        `SELECT id, name, inn, risk_light FROM sprav_legal_entities WHERE deleted_at IS NULL AND name LIKE ? ORDER BY name LIMIT 12`, [like]);
      res.json({ history: history.map((h) => ({ name: h.carrier_name, entity_id: h.carrier_id, n: Number(h.n) })), all });
    } catch (err) { console.error("orders carriers:", err); fail(res, 500, String(err.message || err)); }
  });
  // Контакты и точки этого заказчика по прошлым заявкам (по частоте) - до карты.
  app.get("/api/orders/customer_history", ...gate, async (req, res) => {
    try {
      const c = String(req.query.customer || "").trim(); if (!c) return res.json({ contacts: [], addresses: [] });
      const [rows] = await pool.query(
        `SELECT customer_contact_name, customer_contact_phone, load_address, load_lat, load_lon, load_contact_name, load_contact_phone,
                unload_address, unload_lat, unload_lon, unload_contact_name, unload_contact_phone, executor_entity_id, equipment_type
           FROM plan_orders WHERE deleted_at IS NULL AND customer = ? ORDER BY service_date DESC LIMIT 200`, [c]);
      const cnt = (map, key, extra) => { if (!key) return; const it = map.get(key) || Object.assign({ n: 0 }, extra); it.n++; map.set(key, it); };
      const contacts = new Map(), addrs = new Map(); let lastEntity = null, lastType = null;
      rows.forEach((r) => {
        cnt(contacts, [r.customer_contact_name, r.customer_contact_phone].filter(Boolean).join(" · "), { name: r.customer_contact_name, phone: r.customer_contact_phone, kind: "customer" });
        cnt(addrs, r.load_address, { address: r.load_address, lat: r.load_lat, lon: r.load_lon, contact_name: r.load_contact_name, contact_phone: r.load_contact_phone });
        cnt(addrs, r.unload_address, { address: r.unload_address, lat: r.unload_lat, lon: r.unload_lon, contact_name: r.unload_contact_name, contact_phone: r.unload_contact_phone });
        if (!lastEntity && r.executor_entity_id) lastEntity = r.executor_entity_id; if (!lastType && r.equipment_type) lastType = r.equipment_type;
      });
      const top = (m) => Array.from(m.values()).sort((a, b) => b.n - a.n).slice(0, 8);
      res.json({ contacts: top(contacts), addresses: top(addrs), last_executor_entity_id: lastEntity, last_equipment_type: lastType });
    } catch (err) { console.error("customer_history:", err); fail(res, 500, String(err.message || err)); }
  });
  app.get("/api/orders/history", ...gate, async (req, res) => {
    try {
      const id = Number(req.query.id); const o = await loadOrder(pool, id); if (!o || !canSee(req, o)) return fail(res, 404, "заявка не найдена");
      const r = await roster();
      const [h] = await pool.query(`SELECT action, detail, changed_by, changed_at FROM plan_orders_history WHERE order_id = ? ORDER BY changed_at DESC, id DESC LIMIT 100`, [id]);
      const [cr] = await pool.query(`SELECT * FROM plan_order_change_requests WHERE order_id = ? ORDER BY requested_at DESC`, [id]);
      res.json({ history: h.map((x) => ({ action: x.action, detail: x.detail, by: (r.byEmail[x.changed_by] || {}).name || x.changed_by, at: new Date(x.changed_at).toISOString() })), requests: cr });
    } catch (err) { console.error("orders history:", err); fail(res, 500, String(err.message || err)); }
  });
  // Обратный поиск: все заявки этой машины/водителя вперёд.
  app.get("/api/orders/by_vehicle", ...gate, async (req, res) => {
    try {
      const gos = str(req.query.gos, 32); if (!gos) return fail(res, 400, "gos обязателен");
      const [rows] = await pool.query(
        `SELECT o.id, o.service_date, o.day_no, o.service_time, o.customer, o.status, e.role, e.driver_name
           FROM plan_order_executors e JOIN plan_orders o ON o.id = e.order_id
          WHERE e.removed_at IS NULL AND o.deleted_at IS NULL AND e.vehicle_gos = ? AND o.service_date >= CURDATE() ORDER BY o.service_date, o.service_time`, [gos]);
      res.json({ orders: rows.map((x) => Object.assign(x, { service_date: fmtDate(x.service_date), service_time: fmtTime(x.service_time) })) });
    } catch (err) { console.error("by_vehicle:", err); fail(res, 500, String(err.message || err)); }
  });

  // ── «Лампочки»: кто сейчас на странице «Задание» (Влад 11.09: «у меня у единственного должны быть
  // лампочки кто работает, как в Планировке - логисты, менеджеры, старшие»). Своя таблица, тот же
  // принцип, что plan_presence: last_seen - вкладка открыта (heartbeat раз в 7 с), last_active - прямо
  // сейчас что-то делает. Список отдаём ТОЛЬКО admin.
  pool.query(`CREATE TABLE IF NOT EXISTS plan_orders_presence (
      user_email VARCHAR(200) NOT NULL PRIMARY KEY, display_name VARCHAR(150) DEFAULT NULL,
      last_seen DATETIME DEFAULT NULL, last_active DATETIME DEFAULT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    .catch((e) => console.error("plan_orders_presence create:", e.message || e));
  app.post("/api/orders/presence", ...gate, async (req, res) => {
    try {
      const who = await me(req); const active = String(p(req, "active")) === "1";
      await pool.query(
        `INSERT INTO plan_orders_presence (user_email, display_name, last_seen, last_active) VALUES (?, ?, NOW(), ${active ? "NOW()" : "NULL"})
         ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), last_seen = NOW()${active ? ", last_active = NOW()" : ""}`,
        [req.userEmail, who.name]);
      res.json({ ok: true });
    } catch (err) { console.error("orders presence post:", err); fail(res, 500, String(err.message || err)); }
  });
  app.get("/api/orders/presence", checkSession, requireRole_("admin"), async (req, res) => {
    try {
      const r = await roster();
      const [rows] = await pool.query(
        `SELECT user_email, display_name, TIMESTAMPDIFF(SECOND, last_seen, NOW()) AS seen_ago,
                TIMESTAMPDIFF(SECOND, last_active, NOW()) AS active_ago
           FROM plan_orders_presence WHERE last_seen > NOW() - INTERVAL 40 SECOND`);
      res.json({ users: rows.filter((x) => x.user_email !== req.userEmail).map((x) => {
        const u = r.byEmail[x.user_email] || {};
        return { email: x.user_email, name: u.name || x.display_name || x.user_email, code: u.code || code3(x.display_name || x.user_email),
          role: u.role || null, seen_ago: Number(x.seen_ago), active_ago: x.active_ago === null ? null : Number(x.active_ago) };
      }) });
    } catch (err) { console.error("orders presence list:", err); fail(res, 500, String(err.message || err)); }
  });

  // ── Заказчик по ИНН (Влад 11.09: «при вводе ИНН должен вылететь контрагент с возможностью сохранить
  // его в справочнике»). Сначала свой справочник, потом DaData (тот же findById/party, что у
  // /api/sprav/legal_lookup, но доступен менеджеру/логисту - им заводить заказчика прямо из заявки).
  const DADATA_KEY_ = process.env.DADATA_API_KEY;
  async function dadataParty(inn) {
    if (!DADATA_KEY_) return null;
    const resp = await fetch("https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Token " + DADATA_KEY_ },
      body: JSON.stringify({ query: inn }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error("DaData: " + (body.message || resp.status));
    const hit = (body.suggestions || [])[0]; if (!hit) return null;
    const d = hit.data || {};
    return {
      name: hit.value || null, full_name: (d.name && d.name.full_with_opf) || hit.unrestricted_value || null,
      inn: d.inn || inn, kpp: d.kpp || null, ogrn: d.ogrn || null,
      legal_address: (d.address && d.address.unrestricted_value) || null,
      director_name: (d.management && d.management.name) || null, director_post: (d.management && d.management.post) || null,
      egrul_status: (d.state && d.state.status) || null,
    };
  }
  app.get("/api/orders/inn", ...gate, async (req, res) => {
    try {
      const inn = String(req.query.inn || "").replace(/\D/g, "").slice(0, 12);
      if (inn.length !== 10 && inn.length !== 12) return fail(res, 400, "ИНН - 10 или 12 цифр");
      const [rows] = await pool.query(
        `SELECT id, name, full_name, inn, kpp, ogrn, legal_address, director_name, is_own, risk_light FROM sprav_legal_entities
          WHERE inn = ? AND deleted_at IS NULL ORDER BY is_own DESC, name LIMIT 1`, [inn]);
      if (rows.length) return res.json({ found: "sprav", entity: rows[0] });
      const d = await dadataParty(inn);
      if (!d) return res.json({ found: false, inn });
      res.json({ found: "dadata", entity: d });
    } catch (err) { console.error("orders inn:", err); fail(res, 500, String(err.message || err)); }
  });
  // Сохранить найденного по ИНН в справочник (id le_inn_<ИНН>; повторный вызов - вернёт существующего).
  app.post("/api/orders/inn_save", ...gate, async (req, res) => {
    try {
      const inn = String(p(req, "inn") || "").replace(/\D/g, "").slice(0, 12);
      if (inn.length !== 10 && inn.length !== 12) return fail(res, 400, "ИНН - 10 или 12 цифр");
      const [ex] = await pool.query(`SELECT id, name FROM sprav_legal_entities WHERE inn = ? AND deleted_at IS NULL LIMIT 1`, [inn]);
      if (ex.length) return res.json({ ok: true, id: ex[0].id, name: ex[0].name, existed: true });
      let d = { name: str(p(req, "name"), 150), full_name: str(p(req, "full_name"), 300), kpp: str(p(req, "kpp"), 9), ogrn: str(p(req, "ogrn"), 15),
        legal_address: str(p(req, "legal_address"), 500), director_name: str(p(req, "director_name"), 200), director_post: str(p(req, "director_post"), 200),
        egrul_status: str(p(req, "egrul_status"), 30) };
      if (!d.name) { const dd = await dadataParty(inn); if (!dd) return fail(res, 404, "ИНН не найден"); d = dd; }
      const id = "le_inn_" + inn;
      await pool.query(
        `INSERT INTO sprav_legal_entities (id, name, full_name, name_1c, inn, kpp, ogrn, legal_address, director_name, director_post, egrul_status, is_own, created_by, updated_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?) ON DUPLICATE KEY UPDATE updated_by = VALUES(updated_by)`,
        [id, d.name, d.full_name, d.name, inn, d.kpp, d.ogrn, d.legal_address, d.director_name, d.director_post, d.egrul_status, req.userEmail, req.userEmail]);
      await pool.query(`INSERT INTO sprav_audit_log (entity_type, entity_id, action, changed_by) VALUES ('legal_entity', ?, 'create', ?)`, [id, req.userEmail]).catch(() => {});
      res.json({ ok: true, id, name: d.name, existed: false });
    } catch (err) { console.error("orders inn_save:", err); fail(res, 500, String(err.message || err)); }
  });

  // ── Помощник ввода груза (Влад 11.09: «начинаю вводить BG - предлагает Bauer BG 40, jcb 3 - 3CX, морск -
  // морской контейнер, быт - бытовка; Д×Ш×В и вес - автоматически, но с пометкой проверить»).
  // Источники: plan_cargo_catalog (Справочники) + история заявок (что уже возили с весом/габаритами).
  // Поиск: все слова запроса должны встретиться в name|aliases (без регистра, латиница/кириллица через aliases).
  app.get("/api/orders/cargo", ...gate, async (req, res) => {
    try {
      const q = String(req.query.q || "").trim().toLowerCase();
      if (q.length < 2) return res.json({ items: [] });
      const words = q.split(/\s+/).filter(Boolean).slice(0, 4);
      const like = words.map(() => "(LOWER(name) LIKE ? OR LOWER(COALESCE(aliases,'')) LIKE ?)").join(" AND ");
      const args = []; words.forEach((w) => { args.push("%" + w + "%", "%" + w + "%"); });
      const [cat] = await pool.query(
        `SELECT name, aliases, category, length_m, width_m, height_m, weight_t, note FROM plan_cargo_catalog
          WHERE active = 1 AND ${like} ORDER BY (LOWER(name) LIKE ?) DESC, \`rank\`, LENGTH(name) LIMIT 8`, args.concat([q + "%"]));
      const [hist] = await pool.query(
        `SELECT cargo, MAX(cargo_weight_t) AS weight_t, MAX(cargo_dims) AS dims, COUNT(*) AS n FROM plan_orders
          WHERE deleted_at IS NULL AND cargo IS NOT NULL AND LOWER(cargo) LIKE ? GROUP BY cargo ORDER BY n DESC LIMIT 5`, ["%" + q + "%"]);
      const dims = (r) => (r.length_m && r.width_m && r.height_m) ? [r.length_m, r.width_m, r.height_m].map((x) => String(Number(x)).replace(".", ",")).join(" × ") : null;
      const items = cat.map((r) => ({ src: "catalog", name: r.name, category: r.category, weight_t: r.weight_t === null ? null : Number(r.weight_t),
        dims: dims(r), length_m: Number(r.length_m) || null, width_m: Number(r.width_m) || null, height_m: Number(r.height_m) || null, note: r.note }));
      hist.forEach((h) => { if (!items.some((i) => i.name.toLowerCase() === String(h.cargo).toLowerCase()))
        items.push({ src: "history", name: h.cargo, n: Number(h.n), weight_t: h.weight_t === null ? null : Number(h.weight_t), dims: h.dims || null }); });
      res.json({ items });
    } catch (err) { console.error("orders cargo:", err); fail(res, 500, String(err.message || err)); }
  });

  // ── Справочник техники отдела экскаваторов (Влад 12.09: «только в форме заявки логиста должен быть
  // справочник техники нашей... логисты заводят технику по госномеру, и она подгружается из справочника;
  // но этот справочник нигде, кроме логистов, не нужен»). СТРОГО admin+logist - НЕ manager (проверка на
  // сервере, не только скрытие на фронте). Ищет и по модели, и по госномеру (без пробелов, без регистра).
  app.get("/api/orders/fleet", checkSession, requireRole_("admin", "logist"), async (req, res) => {
    try {
      const q = String(req.query.q || "").trim().toLowerCase();
      if (q.length < 2) return res.json({ items: [] });
      const qNoSpace = q.replace(/\s+/g, "");
      const [rows] = await pool.query(
        `SELECT model, gos_number, category FROM plan_fleet_excavators
          WHERE active = 1 AND (LOWER(model) LIKE ? OR LOWER(REPLACE(gos_number, ' ', '')) LIKE ?)
          ORDER BY (LOWER(REPLACE(gos_number, ' ', '')) LIKE ?) DESC, model LIMIT 8`,
        ["%" + q + "%", "%" + qNoSpace + "%", qNoSpace + "%"]);
      res.json({ items: rows.map((r) => ({ src: "fleet", name: r.model, gos: r.gos_number, category: r.category })) });
    } catch (err) { console.error("orders fleet:", err); fail(res, 500, String(err.message || err)); }
  });

  console.log("plan-orders: эндпоинты /api/orders/* подключены");
};
