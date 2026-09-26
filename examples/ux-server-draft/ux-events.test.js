// Тесты ux-events.js на подставных пачках, без БД: node ux-events.test.js
const assert = require("assert");
const U = require("./ux-events.js");
let n = 0;
function check(name, fn) { fn(); n++; console.log("ok -", name); }

const NOW = Date.UTC(2026, 8, 26, 12, 0, 0); // 26.09.2026 12:00:00 UTC
const ctx = { email: "a@b.ru", role: "logist", service: false, now: NOW };
const SID = "abcdefgh12345678";
const ev = (o) => Object.assign({ k: "click", t: NOW - 1000, seq: 1, sid: SID, page: "order-plan", target: "op2SaveOrder", area: "op2-d-body" }, o);
// колонки: email, role, sid, seq, client_ts, page, kind, target, area, val, ms, n1, n2, len, flags
const C = { email: 0, role: 1, sid: 2, seq: 3, ts: 4, page: 5, kind: 6, target: 7, area: 8, val: 9, ms: 10, n1: 11, n2: 12, len: 13, flags: 14 };

check("обычный клик -> одна строка, email/роль из сессии, время устройства в UTC с мс", () => {
  const r = U.normalizeBatch({ events: [ev({ email: "hacker@x.ru", role: "admin" })] }, ctx);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0][C.email], "a@b.ru");
  assert.strictEqual(r[0][C.role], "logist");
  assert.strictEqual(r[0][C.ts], "2026-09-26 11:59:59.000");
  assert.strictEqual(r[0][C.kind], "click");
  assert.strictEqual(r[0][C.flags], 0);
});

check("неизвестный вид, битый sid, нет seq, не объект - отброшены, остальное принято", () => {
  const r = U.normalizeBatch({ events: [ev({ k: "keylog" }), ev({ sid: "короткий" }), ev({ sid: "ABCDEFGH12345678" }), ev({ seq: "x" }), null, "str", 5, ev({ seq: 2 })] }, ctx);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0][C.seq], 2);
});

check("не массив / пустое тело -> ноль строк, без исключения", () => {
  assert.deepStrictEqual(U.normalizeBatch(null, ctx), []);
  assert.deepStrictEqual(U.normalizeBatch({}, ctx), []);
  assert.deepStrictEqual(U.normalizeBatch({ events: "x" }, ctx), []);
});

check("больше 100 событий - берём первые 100", () => {
  const list = [];
  for (let i = 1; i <= 150; i++) list.push(ev({ seq: i }));
  const r = U.normalizeBatch({ events: list }, ctx);
  assert.strictEqual(r.length, 100);
  assert.strictEqual(r[99][C.seq], 100);
});

check("время устройства вне окна [-7 дней, +1 час] -> время сервера", () => {
  const old = U.normalizeBatch({ events: [ev({ t: NOW - 8 * 24 * 3600 * 1000 })] }, ctx)[0][C.ts];
  const fut = U.normalizeBatch({ events: [ev({ t: NOW + 2 * 3600 * 1000 })] }, ctx)[0][C.ts];
  const bad = U.normalizeBatch({ events: [ev({ t: "вчера" })] }, ctx)[0][C.ts];
  const ok6 = U.normalizeBatch({ events: [ev({ t: NOW - 6 * 24 * 3600 * 1000 })] }, ctx)[0][C.ts];
  assert.strictEqual(old, "2026-09-26 12:00:00.000");
  assert.strictEqual(fut, "2026-09-26 12:00:00.000");
  assert.strictEqual(bad, "2026-09-26 12:00:00.000");
  assert.strictEqual(ok6, "2026-09-20 12:00:00.000");
});

check("текст поля не попадает в базу даже от кривого клиента: val только у change/vis/js_error", () => {
  const r = U.normalizeBatch({ events: [
    ev({ k: "field", seq: 1, val: "ООО Ромашка +7 999 123-45-67", ms: 5300, n1: 40, n2: 3, len: 28, flags: 4 }),
    ev({ k: "click", seq: 2, val: "секрет" }),
    ev({ k: "view", seq: 3, val: "x", target: "crm", ms: 60000 }),
    ev({ k: "change", seq: 4, val: "42" }),
    ev({ k: "vis", seq: 5, val: "hidden" }),
    ev({ k: "vis", seq: 6, val: "что угодно" }),
  ] }, ctx);
  assert.deepStrictEqual(r.map((x) => x[C.val]), [null, null, null, "42", "hidden", null]);
  assert.strictEqual(r[0][C.ms], 5300); assert.strictEqual(r[0][C.n1], 40); assert.strictEqual(r[0][C.n2], 3); assert.strictEqual(r[0][C.len], 28);
  assert.strictEqual(r[2][C.ms], 60000); assert.strictEqual(r[2][C.n1], null);
  assert.strictEqual(r[1][C.ms], null);
});

check("обрезка длин и управляющих символов", () => {
  const long = "x".repeat(500);
  const r = U.normalizeBatch({ events: [
    ev({ seq: 1, page: long, target: long, area: long }),
    ev({ k: "change", seq: 2, val: long }),
    ev({ k: "js_error", seq: 3, val: long, target: "index.html:28978" }),
    ev({ seq: 4, target: "a\nb\tc\u0000d" }),
  ] }, ctx);
  assert.strictEqual(r[0][C.page].length, 60); assert.strictEqual(r[0][C.target].length, 160); assert.strictEqual(r[0][C.area].length, 80);
  assert.strictEqual(r[1][C.val].length, 80);
  assert.strictEqual(r[2][C.val].length, 120);
  assert.strictEqual(r[3][C.target], "a b c d");
});

check("числа зажаты в границы колонок", () => {
  const r = U.normalizeBatch({ events: [ev({ k: "field", ms: 9e12, n1: 99999, n2: -5, len: 1e6 })] }, ctx)[0];
  assert.strictEqual(r[C.ms], 2147483647); assert.strictEqual(r[C.n1], 32767); assert.strictEqual(r[C.n2], 0); assert.strictEqual(r[C.len], 32767);
});

check("флаги: клиент ставит только 1 и 4 (4 - только у field), служебный 2 - только сервер", () => {
  const r = U.normalizeBatch({ events: [ev({ seq: 1, flags: 255 }), ev({ k: "field", seq: 2, flags: 7 })] }, ctx);
  assert.strictEqual(r[0][C.flags], 1);
  assert.strictEqual(r[1][C.flags], 5);
  const s = U.normalizeBatch({ events: [ev({ flags: 0 })] }, Object.assign({}, ctx, { service: true }));
  assert.strictEqual(s[0][C.flags], 2);
});

check("пустая страница -> unknown (колонка NOT NULL)", () => {
  assert.strictEqual(U.normalizeBatch({ events: [ev({ page: "" })] }, ctx)[0][C.page], "unknown");
});

console.log("ux-events: все", n, "проверок прошли");
