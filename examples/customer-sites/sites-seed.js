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
           load_address la, load_lat lla, load_lon llo, unload_address ua, unload_lat ula, unload_lon ulo
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
      uses.push({ cust, custName: o.ent ? (entName[o.ent] || o.customer) : o.customer, internal: !!o.internal, side, text, pt, d: fmtD(o.d), orderId: o.id, mismatch });
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
      return {
        address: texts[0][0], texts: texts.map(([t, n]) => ({ t, n })), uses: s.uses.length,
        sides: s.sides, first: ds[0], last: ds[ds.length - 1],
        pt: s.pt ? { lat: +s.pt.lat.toFixed(6), lon: +s.pt.lon.toFixed(6) } : null,
        conflict: s.conflict, filledNoPt: s.filledNoPt || 0,
      };
    }).sort((a, b) => b.uses - a.uses);
    customers.push({ cust, name: list[0].custName, internal: list[0].internal, byEntity: cust.startsWith("ent:"), uses: list.length, sites });
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
  await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
