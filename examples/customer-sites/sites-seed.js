// Наполнение «Площадок заказчика» из истории заявок (26.09.2026, фаза Б плана
// plans/2026-09-26-customer-addresses-and-price-geo.md). СЕЙЧАС - только сухой прогон: читает базу и
// пишет JSON-отчёт «что получится», в базу ничего не пишет. Та же логика потом наполнит customer_sites.
//
// Правила (Влад 26.09: «другой город / другая часть Москвы - проблема»):
//  - точка площадки - ТОЛЬКО поставленная человеком: координаты в заявке или ссылка/числа в тексте адреса;
//    поиск по тексту (DaData) для площадки не используется (правило Б1);
//  - заказчик = юрлицо из справочника, если оно есть в заявке, иначе точный текст названия;
//  - одна площадка = точки одного заказчика в пределах 200 м; разные тексты одного места склеиваются по
//    точке, не по буквам (у «ДЕКУБ» 4 написания = 2 места);
//  - адрес без точки присоединяется к площадке, если его точный текст у этой площадки уже встречался;
//    иначе - отдельная площадка «без точки» по тексту;
//  - один и тот же текст с точками дальше 3 км - не склеиваем, помечаем «точки расходятся»;
//  - «Работа по месту», «База», «ДМД» и пустые - не площадки заказчика.
// Запуск на VPS: node sites-seed.js --out /root/sites-seed.json [--names] (--names - короткие названия
// площадок обратным поиском DaData по точке; это только подсказка названия, точку не меняет).
// --write (26.09, решение Влада «создавай только постоянные площадки»): записать в customer_sites /
// customer_site_texts ТОЛЬКО постоянные площадки (2+ заявки). Отказывается, если таблица уже не пустая.
"use strict";
const path = require("path");
const fs = require("fs");
const { createRequire } = require("module");
const reqApi = createRequire("/root/yard-dashboard/api/server.js");
reqApi("dotenv").config({ path: "/root/yard-dashboard/.env", quiet: true });
const mysql = reqApi("mysql2/promise");
const ap = require("/root/yard-dashboard/api/lib/address-point.js");
const geocoder = require("/root/yard-dashboard/api/lib/geocoder.js");

const args = process.argv.slice(2);
const OUT = args[args.indexOf("--out") + 1] || "/root/sites-seed.json";
const WITH_NAMES = args.includes("--names");
const WRITE = args.includes("--write");
const MIN_USES = 2; // постоянная площадка - 2 заявки и больше
const MERGE_M = 200;      // точки ближе - одно место
const CONFLICT_KM = 3;    // один текст с точками дальше - «точки расходятся»
const SKIP_RE = /^\s*(работа\s+по\s+месту|база(\s*(дмд|домодедово))?|дмд)\.?\s*$/i;

function km(a, b) {
  const R = 6371, rad = (x) => x * Math.PI / 180;
  const dLa = rad(b.lat - a.lat), dLo = rad(b.lon - a.lon);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtD = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || "").slice(0, 10));

(async () => {
  const db = await mysql.createConnection({ host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
  const [orders] = await db.query(`
    SELECT id, customer, customer_entity_id ent, internal, service_date d,
           load_address la, load_lat lla, load_lon llo, unload_address ua, unload_lat ula, unload_lon ulo,
           load_contact_name lcn, load_contact_phone lcp, unload_contact_name ucn, unload_contact_phone ucp
      FROM plan_orders WHERE deleted_at IS NULL AND status <> 'cancelled'`);
  const [ents] = await db.query(`SELECT id, name FROM sprav_legal_entities WHERE id IN (SELECT DISTINCT customer_entity_id FROM plan_orders WHERE customer_entity_id <> '')`);
  const entName = {}; ents.forEach((e) => { entName[e.id] = e.name; });

  // 1) использования адресов: заказчик, сторона, текст, точка человека
  const uses = [];
  let skipped = 0;
  for (const o of orders) {
    const cust = o.ent ? "ent:" + o.ent : "txt:" + String(o.customer || "").trim();
    for (const side of ["load", "unload"]) {
      const text = String((side === "load" ? o.la : o.ua) || "").trim();
      if (!text || SKIP_RE.test(text)) { skipped++; continue; }
      const lat = side === "load" ? o.lla : o.ula, lon = side === "load" ? o.llo : o.ulo;
      let pt = lat != null && lon != null ? { lat: Number(lat), lon: Number(lon), src: "заявка" } : null;
      const tp = ap.pointFromText(text);
      let mismatch = null;
      if (tp && tp.lat != null) {
        // Живой случай 26.09 (заявка №9 на 28.09): в тексте координаты Можайского округа, а точка заявки -
        // Назимиха, 159 км. Точку, написанную человеком в самом тексте, считаем верной; случай - в отчёт.
        if (pt && km(pt, tp) > 1) mismatch = { orderId: o.id, km: Math.round(km(pt, tp)), stored: pt };
        if (!pt || mismatch) pt = { lat: tp.lat, lon: tp.lon, src: "текст" };
      }
      const cn = side === "load" ? o.lcn : o.ucn, cp = side === "load" ? o.lcp : o.ucp;
      uses.push({ cust, ent: o.ent || null, custText: String(o.customer || "").trim(), custName: o.ent ? (entName[o.ent] || o.customer) : o.customer, internal: !!o.internal, side, text, pt, d: fmtD(o.d), orderId: o.id, mismatch, cn: cn || null, cp: cp || null });
    }
  }

  // 2) по заказчикам: кластеры точек, конфликты текстов, адреса без точки
  const byCust = new Map();
  uses.forEach((u) => { if (!byCust.has(u.cust)) byCust.set(u.cust, []); byCust.get(u.cust).push(u); });
  const customers = [];
  for (const [cust, list] of byCust) {
    // конфликт: один текст - точки дальше 3 км
    const textPts = new Map();
    list.filter((u) => u.pt).forEach((u) => { if (!textPts.has(u.text)) textPts.set(u.text, []); textPts.get(u.text).push(u.pt); });
    const conflictTexts = new Set();
    textPts.forEach((pts, t) => { if (pts.some((p) => pts.some((q) => km(p, q) > CONFLICT_KM))) conflictTexts.add(t); });

    // кластеры по точке (жадно, от самых частых точек)
    const clusters = [];
    const withPt = list.filter((u) => u.pt);
    const freq = new Map(); withPt.forEach((u) => { const k = u.pt.lat.toFixed(4) + "," + u.pt.lon.toFixed(4); freq.set(k, (freq.get(k) || 0) + 1); });
    withPt.sort((a, b) => freq.get(b.pt.lat.toFixed(4) + "," + b.pt.lon.toFixed(4)) - freq.get(a.pt.lat.toFixed(4) + "," + a.pt.lon.toFixed(4)));
    for (const u of withPt) {
      let c = clusters.find((x) => km(x.pt, u.pt) * 1000 <= MERGE_M);
      if (!c) { c = { pt: u.pt, uses: [], texts: new Map(), sides: { load: 0, unload: 0 }, conflict: false }; clusters.push(c); }
      c.uses.push(u); c.texts.set(u.text, (c.texts.get(u.text) || 0) + 1); c.sides[u.side]++;
      if (conflictTexts.has(u.text)) c.conflict = true;
    }
    // адреса без точки: к площадке с тем же текстом (если текст не конфликтный), иначе - своя площадка
    const noPt = new Map();
    for (const u of list.filter((x) => !x.pt)) {
      const c = !conflictTexts.has(u.text) && clusters.find((x) => x.texts.has(u.text));
      if (c) { c.uses.push(u); c.texts.set(u.text, (c.texts.get(u.text) || 0) + 1); c.sides[u.side]++; c.filledNoPt = (c.filledNoPt || 0) + 1; continue; }
      const key = u.text.toLowerCase().replace(/\s+/g, " ");
      if (!noPt.has(key)) noPt.set(key, { pt: null, uses: [], texts: new Map(), sides: { load: 0, unload: 0 }, conflict: conflictTexts.has(u.text) });
      const s = noPt.get(key); s.uses.push(u); s.texts.set(u.text, (s.texts.get(u.text) || 0) + 1); s.sides[u.side]++;
    }
    const sites = clusters.concat(Array.from(noPt.values())).map((s) => {
      const texts = Array.from(s.texts.entries()).sort((a, b) => b[1] - a[1]);
      const ds = s.uses.map((u) => u.d).sort();
      // контакт на месте - из самой свежей заявки этой площадки, где он был
      const withContact = s.uses.filter((u) => u.cn || u.cp).sort((a, b) => (a.d < b.d ? 1 : -1));
      const mism = s.uses.filter((u) => u.mismatch);
      return {
        address: texts[0][0], texts: texts.map(([t, n]) => ({ t, n })), uses: s.uses.length,
        contact: withContact.length ? { name: withContact[0].cn, phone: withContact[0].cp } : null,
        pointSource: s.pt ? (s.uses.find((u) => u.pt && u.pt.src === "заявка") ? "order" : "text") : null,
        checkNote: mism.length ? "точка в заявке расходилась с координатами в тексте (" + mism.map((u) => "заявка id " + u.orderId + ", " + u.mismatch.km + " км").join("; ") + ") - взята точка из текста" : null,
        sides: s.sides, first: ds[0], last: ds[ds.length - 1],
        pt: s.pt ? { lat: +s.pt.lat.toFixed(6), lon: +s.pt.lon.toFixed(6) } : null,
        conflict: s.conflict, filledNoPt: s.filledNoPt || 0,
      };
    }).sort((a, b) => b.uses - a.uses);
    customers.push({ cust, ent: list[0].ent, custText: list[0].custText, name: list[0].custName, internal: list[0].internal, byEntity: cust.startsWith("ent:"), uses: list.length, sites });
  }
  customers.sort((a, b) => b.uses - a.uses);

  // 3) короткие названия площадок по точке (подсказка, не данные): посёлок/город + улица
  if (WITH_NAMES) {
    for (const c of customers) for (const s of c.sites) {
      if (!s.pt) continue;
      try {
        const r = await geocoder.reverseAddress(s.pt.lat, s.pt.lon);
        if (r) s.nameHint = [r.settlement_with_type || r.city_with_type || r.region_with_type, r.street_with_type].filter(Boolean).join(", ");
      } catch (e) { /* без подсказки названия */ }
    }
  }

  const allSites = customers.reduce((a, c) => a.concat(c.sites), []);
  const summary = {
    orders: orders.length, uses: uses.length, skipped,
    customers: customers.length, customersByEntity: customers.filter((c) => c.byEntity).length,
    sites: allSites.length, withPoint: allSites.filter((s) => s.pt).length, noPoint: allSites.filter((s) => !s.pt).length,
    merged: allSites.filter((s) => s.texts.length > 1).length, textsMerged: allSites.reduce((a, s) => a + (s.texts.length > 1 ? s.texts.length : 0), 0),
    conflicts: allSites.filter((s) => s.conflict).length, onceOnly: allSites.filter((s) => s.uses === 1).length,
    filledNoPt: allSites.reduce((a, s) => a + s.filledNoPt, 0),
    usesWithPointBefore: uses.filter((u) => u.pt && u.pt.src === "заявка").length,
    usesCoveredAfter: allSites.filter((s) => s.pt).reduce((a, s) => a + s.uses, 0),
    pointMismatches: uses.filter((u) => u.mismatch).map((u) => ({ orderId: u.orderId, side: u.side, km: u.mismatch.km })),
  };
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), summary, customers }, null, 1));
  console.log(JSON.stringify(summary, null, 1));

  if (WRITE) {
    // Короткое имя из текста менеджера (решение 26.09): без ссылок и хвоста «Координаты: ...», без кавычек,
    // первая часть до запятой; человек потом переименует («Горки», «ЮВХ-6»).
    const shortName = (t) => {
      let x = String(t || "").replace(/https?:\/\/\S+/g, " ").replace(/координаты\s*:?\s*-?\d{1,3}\.\d+\s*[,;]\s*-?\d{1,3}\.\d+/gi, " ")
        .replace(/-?\d{1,3}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}/g, " ").replace(/["«»]/g, "").replace(/\s+/g, " ").trim();
      // части до запятой; впереди стоящие «г Москва», «Московская обл», «МО» - не имя места, пропускаем
      const REGION_ONLY = /^(г\.?\s*)?москва$|^мо$|^московская(\s+обл(асть)?\.?)?$|^россия$/i;
      const parts = x.split(",").map((p) => p.trim()).filter(Boolean);
      while (parts.length > 1 && REGION_ONLY.test(parts[0])) parts.shift();
      if (!parts.length) return null;
      const nm = parts[0].length > 25 || parts.length === 1 ? parts[0] : parts[0] + ", " + parts[1];
      return nm.slice(0, 60);
    };
    const [[cnt]] = await db.query("SELECT COUNT(*) n FROM customer_sites");
    if (cnt.n > 0) { console.error("customer_sites уже не пустая (" + cnt.n + ") - повторное наполнение запрещено"); process.exit(2); }
    const rows = [];
    customers.forEach((c) => c.sites.filter((s) => s.uses >= MIN_USES).forEach((s) => rows.push({ c, s })));
    await db.beginTransaction();
    try {
      for (const { c, s } of rows) {
        const [ins] = await db.query(
          `INSERT INTO customer_sites (customer_entity_id, customer_name, name, address, lat, lon, point_source, contact_name, contact_phone,
             load_count, unload_count, first_used, last_used, needs_check, check_note, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [c.ent, c.name || c.custText, shortName(s.address), s.address.slice(0, 500), s.pt ? s.pt.lat : null, s.pt ? s.pt.lon : null, s.pointSource,
            s.contact ? (s.contact.name || null) : null, s.contact ? (s.contact.phone || null) : null,
            s.sides.load, s.sides.unload, s.first || null, s.last || null, s.checkNote ? 1 : 0, s.checkNote ? s.checkNote.slice(0, 300) : null,
            "Система (наполнение из заявок 26.09)"]);
        for (const t of s.texts) await db.query("INSERT INTO customer_site_texts (site_id, text, uses) VALUES (?,?,?)", [ins.insertId, t.t.slice(0, 500), t.n]);
      }
      await db.commit();
      const [[w]] = await db.query("SELECT COUNT(*) sites, SUM(lat IS NOT NULL) with_pt, SUM(needs_check) to_check, (SELECT COUNT(*) FROM customer_site_texts) texts FROM customer_sites");
      console.log("ЗАПИСАНО:", JSON.stringify(w));
    } catch (e) { await db.rollback(); throw e; }
  }
  await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
