// Проверка помощников журнала правок (histNorm_/changedKeys_/changeDetail_) из патча plan-orders.js:
// функции вырезаются из файла текстом и исполняются отдельно (они внутри замыкания модуля).
const fs = require("fs");
const assert = require("assert");
const src = fs.readFileSync(__dirname + "/plan-orders.js", "utf8");
const a = src.indexOf("  function histNorm_(v) {");
const b = src.indexOf("  async function history(conn");
const code = src.slice(a, b);
function fmtDate(d) { return d instanceof Date ? d.toISOString().slice(0, 10) : String(d || "").slice(0, 10); }
const fns = new Function("fmtDate", code + "; return { histNorm_, changedKeys_, changeDetail_ };")(fmtDate);
const { changedKeys_, changeDetail_ } = fns;

const o = { price: "45000.00", service_time: "10:00:00", needs_data: 0, note: null, load_lat: "55.123450", cargo_weight_t: "20.00",
  customer: "ООО А", executor_entity_id: null, cash: 1, load_address: "г. Москва, ул. Длинная, д. 1" };
const same = { price: 45000, service_time: "10:00", needs_data: 0, note: null, load_lat: 55.12345, cargo_weight_t: 20,
  customer: "ООО А", executor_entity_id: null, cash: 1, load_address: "г. Москва, ул. Длинная, д. 1" };
assert.deepStrictEqual(changedKeys_(o, same, Object.keys(same)), [], "сохранение без изменений не должно давать правок");

const f = Object.assign({}, same, { price: 50000, service_time: "12:00", load_lat: 55.2, customer: "ООО Б", note: "позвонить" });
const ch = changedKeys_(o, f, Object.keys(f));
assert.deepStrictEqual(ch.sort(), ["customer", "load_lat", "note", "price", "service_time"].sort());
const d = JSON.parse(changeDetail_(o, f, ch));
assert.deepStrictEqual(d.c.price, ["45000", "50000"]);
assert.deepStrictEqual(d.c.service_time, ["10:00", "12:00"]);
assert.deepStrictEqual(d.c.load_lat, []);               // координаты - без цифр
assert.deepStrictEqual(d.c.note, ["", "позвонить"]);

// длинные значения - укладываемся в 500 знаков
const big = {}, bigO = {};
for (let i = 0; i < 12; i++) { bigO["f" + i] = "а".repeat(80); big["f" + i] = "б".repeat(80); }
const det = changeDetail_(bigO, big, Object.keys(big));
assert(det.length <= 500, "detail длиннее 500: " + det.length);
console.log("ok: histdiff", det.slice(0, 60));
