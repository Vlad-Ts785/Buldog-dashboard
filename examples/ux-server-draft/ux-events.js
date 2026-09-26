// Журнал действий «Гладкая работа» (26.09.2026, Влад: «каждое нажатие, каждый щелчок, каждый
// переключатель, каждый переход» - ради поиска лишних действий, НЕ контроля людей). План -
// plans/2026-09-26-smooth-work-ux-analytics.md в репозитории дашборда, Фаза 1А.
// Регистрирует POST /api/ux/batch - приём пачек от files/ux-track.js (index.html, plan-m.html,
// orders-m.html). Таблица ux_events - import/ux-events-schema.sql. Старый журнал ui_events и его
// /api/ui_event не трогаем: там редкие смысловые сигналы, здесь - сплошной поток.
//
// Правила приёма:
//   - email и роль - только из сессии (checkSession), от клиента не берём;
//   - служебная проверка (tests/as-user.js, X-Api-Key) пишется с флагом 2 - отчёты её отсекают;
//   - белый список видов событий, обрезка длин, до 100 событий в пачке, один INSERT на пачку;
//   - val (значение) принимается только у change/vis/js_error: даже если клиент по ошибке пришлёт
//     текст поля в field/click, в базу он не попадёт (защита в глубину, текст полей не храним);
//   - повтор той же пачки (клиент шлёт «хотя бы раз») склеивает uq_event (sid, seq, client_ts);
//   - выключатель UX_TRACK=off в .env: ничего не пишем, отвечаем {ok:true, enabled:false} - клиент
//     сам замолкает до закрытия вкладки. Проверяется ДО checkSession: выключенный сбор не должен
//     нагружать ни проверку доступа, ни базу. .env читается при старте - переключение = ./deploy.sh.
const express = require("express");

const KINDS = new Set(["view", "click", "change", "field", "vis", "js_error"]);
const VAL_KINDS = { change: 80, vis: 16, js_error: 120 }; // у кого бывает val и его потолок
const MAX_BATCH = 100;
const PAST_MS = 7 * 24 * 3600 * 1000;   // события из очереди без связи могут прийти через дни
const FUTURE_MS = 3600 * 1000;           // часы устройства спешат - не больше часа
const INT_MAX = 2147483647;
const SMALL_MAX = 32767;
const FLAG_PREVIEW = 1, FLAG_SERVICE = 2, FLAG_PASTE = 4;

function str_(v, max) {
  if (v == null) return null;
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, " ").trim(); // управляющие символы - в пробел
  return s ? s.slice(0, max) : null;
}
function int_(v, min, max) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
}
// DATETIME(3) строкой в UTC - не зависит от часового пояса процесса и сессии MySQL.
function mysqlUtc_(ms) {
  return new Date(ms).toISOString().slice(0, 23).replace("T", " ");
}

// Пачка от клиента -> строки для INSERT. Чистая функция (без БД) - покрыта ux-events.test.js.
// ctx: { email, role, service, now }
function normalizeBatch(body, ctx) {
  const list = body && Array.isArray(body.events) ? body.events.slice(0, MAX_BATCH) : [];
  const now = ctx.now || Date.now();
  const rows = [];
  for (const e of list) {
    if (!e || typeof e !== "object") continue;          // кривая строка не роняет всю пачку
    const kind = String(e.k || "");
    if (!KINDS.has(kind)) continue;
    const sid = String(e.sid || "");
    if (!/^[a-z0-9]{16}$/.test(sid)) continue;
    const seq = int_(e.seq, 0, INT_MAX);
    if (seq == null) continue;
    const t = Number(e.t);
    const clientMs = Number.isFinite(t) && t >= now - PAST_MS && t <= now + FUTURE_MS ? Math.round(t) : now;
    let val = null;
    if (VAL_KINDS[kind]) {
      val = str_(e.val, VAL_KINDS[kind]);
      if (kind === "vis" && val !== "hidden" && val !== "visible") val = null;
    }
    const isField = kind === "field";
    let flags = (int_(e.flags, 0, 255) || 0) & (FLAG_PREVIEW | FLAG_PASTE); // клиент может ставить только эти
    if (!isField) flags &= ~FLAG_PASTE;
    if (ctx.service) flags |= FLAG_SERVICE;
    rows.push([
      ctx.email,
      str_(ctx.role, 40),
      sid,
      seq,
      mysqlUtc_(clientMs),
      str_(e.page, 60) || "unknown",
      kind,
      str_(e.target, 160),
      str_(e.area, 80),
      val,
      isField || kind === "view" ? int_(e.ms, 0, INT_MAX) : null,
      isField ? int_(e.n1, 0, SMALL_MAX) : null,
      isField ? int_(e.n2, 0, SMALL_MAX) : null,
      isField ? int_(e.len, 0, SMALL_MAX) : null,
      flags,
    ]);
  }
  return rows;
}

module.exports = function initUxEvents_(deps) {
  const { app, pool, checkSession, isServiceProbe } = deps;

  // Сбой записи (нет таблицы, база легла) при ~4 пачках в секунду иначе завалил бы журнал
  // сервиса одинаковыми строками - пишем первую ошибку и потом не чаще раза в минуту со счётчиком.
  let errLastAt = 0, errSkipped = 0;
  function logErr_(err) {
    const now = Date.now();
    if (now - errLastAt < 60000) { errSkipped++; return; }
    console.error("ux/batch:", err && (err.message || err), errSkipped ? "(ещё " + errSkipped + " таких же за минуту)" : "");
    errLastAt = now; errSkipped = 0;
  }

  const offSwitch_ = (req, res, next) => (process.env.UX_TRACK === "off" ? res.json({ ok: true, enabled: false }) : next());
  // Запасной путь клиента - sendBeacon с телом text/plain (простой запрос без OPTIONS). Общий
  // express.text в server.js уже положил его в req.body строкой - разбираем здесь, ДО
  // checkSession: токен в этом случае лежит в теле (session_token), не в заголовке.
  const beaconBody_ = (req, res, next) => {
    if (typeof req.body === "string") {
      try { req.body = JSON.parse(req.body); } catch (e) { req.body = {}; }
    }
    next();
  };

  // express.json ПЕРЕД checkSession - тот же осознанный приём, что у /api/ui_event: иначе токен из
  // тела (маяк) прочитать нечем. Оговорка: общий app.use(express.json()) в server.js разбирает тело
  // раньше (лимит 100 КБ), здесь парсер повторно не срабатывает - оставлен на случай, если общий уберут.
  app.post("/api/ux/batch", offSwitch_, express.json({ limit: "96kb" }), beaconBody_, checkSession, async (req, res) => {
    const rows = normalizeBatch(req.body, {
      email: req.userEmail || "",
      role: req.userRole || "",
      service: !!(isServiceProbe && isServiceProbe(req)),
      now: Date.now(),
    });
    if (!rows.length) return res.json({ ok: true, enabled: true, saved: 0 });
    try {
      await pool.query(
        "INSERT INTO ux_events (email, role, sid, seq, client_ts, page, kind, target, area, val, ms, n1, n2, len, flags) VALUES ? " +
        "ON DUPLICATE KEY UPDATE id = id", // повтор пачки - молча пропустить, не ошибка
        [rows]
      );
      res.json({ ok: true, enabled: true });
    } catch (err) {
      logErr_(err);
      res.status(500).json({ ok: false }); // без текста SQL наружу; клиент подождёт и повторит
    }
  });

  return {};
};
module.exports.normalizeBatch = normalizeBatch;
