/* Демо-данные для превью страницы «Найм» (examples/preview-hiring.html и собранная ссылка для
   коллег - examples/build-preview-hiring.js). Подменяет ответы /api/hiring/* в памяти браузера:
   боевой код files/hiring.js работает как на сайте, но ничего не уходит на сервер и после
   перезагрузки всё возвращается к исходному. Имена кандидатов условные («Кандидат 101»),
   телефоны вымышленные. Роль «смотреть как» - из #якоря ссылки (#recruiter, #column_head,
   #security), иначе директор. */
(function () {
  var ROLES = { director: 'директор / Феськов', recruiter: 'рекрутер', column_head: 'НК тралов (Дьячков)', security: 'служба безопасности' };
  var ROLE = (location.hash || '').replace('#', '');
  if (!ROLES[ROLE]) { try { ROLE = sessionStorage.getItem('pv-hiring-role') || 'director'; } catch (e) { ROLE = 'director'; } }
  if (!ROLES[ROLE]) ROLE = 'director';

  var STAGES = [["callbase","База для обзвона","recruiter",null,5,0],["new","Новый отклик","recruiter",15,10,0],["screening","Скрининг рекрутера","recruiter",1440,20,0],["column_interview","Собеседование с НК","column_head",1440,30,0],["security","Проверка СБ","security",1440,40,0],["onboarding","Тестовая смена / оформление","column_head",2880,50,0],["hired","Вышел на работу",null,null,60,1],["rejected","Отказ",null,null,70,1],["reserve","Кадровый резерв",null,null,80,1]]
    .map(function (a) { return { stage_key: a[0], title: a[1], owner_role: a[2], sla_minutes: a[3], sort_order: a[4], is_terminal: a[5], active: 1 }; });
  var REASONS = [["no_ce","Нет категории CE","company"],["no_skzi","Нет карты СКЗИ","company"],["low_exp","Мало стажа","company"],["violations","Лишения / штрафы","company"],["not_fit","Не подходит по требованиям","company"],["sb_fail","Не прошёл проверку СБ","company"],["test_fail","Не прошёл тестовую смену","company"],["already_employee","Уже работает у нас","company"],["money","Не устроили деньги","candidate"],["schedule","Не устроил график","candidate"],["far","Далеко","candidate"],["other_job","Ушёл к другим","candidate"],["no_answer","Пропал / недозвон","candidate"],["bad_number","Неверный или мёртвый номер","candidate"],["declined","Отказался (причина не названа)","candidate"],["dropped_after_agree","Отказ после согласия","candidate"]]
    .map(function (a) { return { reason_key: a[0], title: a[1], side: a[2] }; });
  var OWNER = { callbase: 'recruiter', new: 'recruiter', screening: 'recruiter', column_interview: 'column_head', security: 'security', onboarding: 'column_head' };
  var now = Date.now(), ago = function (m) { return new Date(now - m * 60000).toISOString(); };
  var seq = 0, C = [], EV = {};
  function cand(stage, o) {
    seq++;
    var p = '9' + String(160000000 + seq * 7919).slice(0, 9);
    return Object.assign({ id: seq, phone10: p, full_name: 'Кандидат ' + String(100 + seq), vehicle_type: null, license_cat: 'CE',
      experience_years: null, city: null, source: 'avito', stage_key: stage, reject_reason: null, warm: 0, urgent: 0, person_id: null,
      created_at: ago(60 * 24 * 3), stage_changed_at: ago(120), call_attempts: 0, recall_at: null, last_attempt_at: null }, o || {});
  }
  for (var i = 0; i < 14; i++) C.push(cand('callbase', { license_cat: 'E', source: 'обзвон_2026-05', warm: i < 5 ? 1 : 0, created_at: ago(60 * 24 * 120), stage_changed_at: ago(60 * 3),
    call_attempts: i % 3, last_attempt_at: i % 3 ? ago(60 * 24) : null, recall_at: i === 7 ? ago(30) : i === 8 ? new Date(now + 3 * 3600e3).toISOString() : null }));
  C.push(cand('new', { vehicle_type: 'tral', experience_years: 7, city: 'Подольск', urgent: 1, stage_changed_at: ago(40), created_at: ago(40) }));
  C.push(cand('new', { source: 'hh', stage_changed_at: ago(6), created_at: ago(6) }));
  C.push(cand('new', { vehicle_type: 'long', experience_years: 3, stage_changed_at: ago(11), created_at: ago(11) }));
  C.push(cand('screening', { vehicle_type: 'long', experience_years: 12.5, city: 'Москва', stage_changed_at: ago(3000) }));
  C.push(cand('screening', { vehicle_type: 'tral', experience_years: 5, stage_changed_at: ago(200), source: 'referral' }));
  C.push(cand('column_interview', { vehicle_type: 'tral', experience_years: 4, city: 'Коломна', stage_changed_at: ago(300) }));
  C.push(cand('column_interview', { vehicle_type: 'long', experience_years: 8, stage_changed_at: ago(900) }));
  C.push(cand('security', { vehicle_type: 'long', experience_years: 9, city: 'Тула', stage_changed_at: ago(700) }));
  C.push(cand('onboarding', { vehicle_type: 'tral', experience_years: 6, stage_changed_at: ago(1500) }));
  C.push(cand('hired', { vehicle_type: 'tral', experience_years: 6, source: 'обзвон_2026-05', person_id: 'p1', stage_changed_at: ago(60 * 24 * 5) }));
  C.push(cand('rejected', { vehicle_type: 'long', experience_years: 2, reject_reason: 'no_skzi', stage_changed_at: ago(2000) }));
  C.push(cand('rejected', { reject_reason: 'money', source: 'hh', stage_changed_at: ago(4000) }));
  C.push(cand('rejected', { license_cat: 'E', source: 'обзвон_2026-05', reject_reason: 'bad_number', stage_changed_at: ago(60 * 3) }));
  var ME = { director: 'Директор', recruiter: 'Рекрутер', column_head: 'Дьячков Павел Викторович', security: 'Служба безопасности' }[ROLE];
  function ev(id, e) { (EV[id] = EV[id] || []).unshift(Object.assign({ created_at: new Date().toISOString(), actor_name: ME }, e)); }
  C.forEach(function (c) { ev(c.id, { action: 'create', to_stage: c.stage_key, created_at: c.created_at, actor_name: c.source === 'обзвон_2026-05' ? 'импорт' : 'Рекрутер' }); });

  function canMove(c) {
    if (ROLE === 'director') return true;
    if (OWNER[c.stage_key] !== ROLE) return false;
    return ROLE !== 'column_head' || c.vehicle_type === 'tral';
  }
  function visible(c) {
    if (ROLE === 'column_head') return !c.vehicle_type || c.vehicle_type === 'tral';
    if (ROLE === 'security') return c.stage_key === 'security';
    return true;
  }
  function stats() {
    var V = C.filter(visible), by = {}, src = {}, rej = {};
    V.forEach(function (c) { by[c.stage_key] = (by[c.stage_key] || 0) + 1; });
    V.filter(function (c) { return now - new Date(c.created_at).getTime() <= 7 * 864e5; }).forEach(function (c) { src[c.source] = (src[c.source] || 0) + 1; });
    V.filter(function (c) { return c.stage_key === 'rejected'; }).forEach(function (c) { rej[c.reject_reason] = (rej[c.reject_reason] || 0) + 1; });
    return { ok: true, by_stage: Object.keys(by).map(function (k) { return { stage_key: k, n: by[k] }; }),
      new_7d_by_source: Object.keys(src).map(function (k) { return { source: k, n: src[k] }; }),
      hired_30d: V.filter(function (c) { return c.stage_key === 'hired'; }).length,
      rejected_30d: V.filter(function (c) { return c.stage_key === 'rejected'; }).length,
      rejected_30d_reasons: Object.keys(rej).map(function (k) { return { reject_reason: k, n: rej[k] }; }).sort(function (a, b) { return b.n - a.n; }) };
  }
  function detail(id) {
    var src = C.filter(function (x) { return x.id === id; })[0];
    var c = Object.assign({}, src);
    if (c.has_skzi === undefined) c.has_skzi = c.stage_key === 'new' || c.stage_key === 'callbase' ? null : 1;
    if (c.pd_consent_at === undefined) c.pd_consent_at = c.stage_key === 'callbase' ? null : ago(100);
    if (c.notes === undefined) c.notes = c.source === 'обзвон_2026-05' ? 'Звонил: рекрутер · Итог: думает' : '';
    c.can_move = canMove(c); c.can_edit = c.can_move || ROLE === 'recruiter';
    return { ok: true, candidate: c, person: null, calls: [], events: EV[id] || [],
      messages: c.source === 'avito' ? [{ channel: 'avito', direction: 'in', sender_name: 'Кандидат', text: 'Здравствуйте, вакансия ещё актуальна?', created_at: ago(70) },
                 { channel: 'avito', direction: 'out', text: 'Да, актуальна. Удобно созвониться сегодня?', created_at: ago(65) }] : [] };
  }
  function find(id) { return C.filter(function (x) { return x.id === id; })[0]; }
  function title(k) { var s = STAGES.filter(function (x) { return x.stage_key === k; })[0]; return s ? s.title : k; }

  var realFetch = window.fetch.bind(window);
  window.fetch = function (u, o) {
    u = String(u);
    if (u.indexOf('/hiring/') < 0) return realFetch(u, o);
    var d = { ok: true }, status = 200, b = o && o.body ? JSON.parse(o.body) : {}, c = b.id ? find(b.id) : null;
    if (u.indexOf('/hiring/meta') >= 0) d = { ok: true, stages: STAGES, reasons: REASONS, column_heads: { tral: 'Дьячков Павел Викторович', long: 'Барыльченко Пётр Иванович' }, me: { role_key: ROLE, manage_all: ROLE === 'director' } };
    else if (u.indexOf('/hiring/board') >= 0) d = { ok: true, candidates: C.filter(visible).map(function (x) { return Object.assign({}, x, { can_move: canMove(x) }); }) };
    else if (u.indexOf('/hiring/stats') >= 0) d = stats();
    else if (u.indexOf('/hiring/candidate?id=') >= 0) d = detail(Number(u.split('id=')[1]));
    else if (u.indexOf('/hiring/move') >= 0 && c) {
      c._prev = c.stage_key; ev(c.id, { action: 'move', from_stage: c.stage_key, to_stage: b.to, reason_key: b.reason || null, comment: b.comment || null });
      c.stage_key = b.to; c.stage_changed_at = new Date().toISOString(); c.reject_reason = b.reason || null;
      if (b.to === 'reserve') c.reserve_consent_at = c.reserve_consent_at || new Date().toISOString();
    } else if (u.indexOf('/hiring/undo') >= 0 && c) {
      if (c._prev) { ev(c.id, { action: 'undo', from_stage: c.stage_key, to_stage: c._prev, comment: 'Отмена перехода' }); c.stage_key = c._prev; c._prev = null; c.stage_changed_at = new Date().toISOString(); c.reject_reason = null; }
      else { status = 400; d = { error: 'Отменить можно только свой последний переход и только в течение 5 минут' }; }
    } else if (u.indexOf('/hiring/attempt') >= 0 && c) {
      c.call_attempts = (c.call_attempts || 0) + 1; c.last_attempt_at = new Date().toISOString(); c.recall_at = b.recall_at || null;
      ev(c.id, { action: 'attempt', comment: 'Не дозвонился, попытка ' + c.call_attempts });
      d = { ok: true, call_attempts: c.call_attempts, recall_at: c.recall_at };
    } else if (u.indexOf('/hiring/comment') >= 0 && c) {
      ev(c.id, { action: 'comment', comment: b.comment });
    } else if (u.indexOf('/hiring/candidate') >= 0) {
      if (c) {
        if (b.phone) { var p = String(b.phone).replace(/\D/g, '').slice(-10); if (C.some(function (x) { return x.phone10 === p && x !== c; })) { status = 409; d = { error: 'Кандидат с этим телефоном уже есть', id: C.filter(function (x) { return x.phone10 === p; })[0].id }; } else c.phone10 = p; }
        if (b.pd_consent) c.pd_consent_at = new Date().toISOString();
        if (b.reserve_consent) c.reserve_consent_at = new Date().toISOString();
        Object.keys(b).forEach(function (k) { if (['id', 'phone', 'pd_consent', 'reserve_consent'].indexOf(k) < 0) c[k] = b[k] === '' ? null : b[k]; });
      } else if (!b.id) {
        var p10 = String(b.phone || '').replace(/\D/g, '').slice(-10);
        if (p10.length < 10) { status = 400; d = { error: 'Укажите телефон кандидата' }; }
        else if (C.some(function (x) { return x.phone10 === p10; })) { status = 409; d = { error: 'Кандидат с этим телефоном уже есть', id: C.filter(function (x) { return x.phone10 === p10; })[0].id }; }
        else {
          var n = cand('new', { phone10: p10, full_name: b.full_name || null, vehicle_type: b.vehicle_type || null, source: b.source || 'manual', notes: b.notes || '',
            pd_consent_at: b.pd_consent ? new Date().toISOString() : null, created_at: new Date().toISOString(), stage_changed_at: new Date().toISOString(), license_cat: null });
          C.push(n); ev(n.id, { action: 'create', to_stage: 'new' }); d = { ok: true, id: n.id };
        }
      }
    }
    return new Promise(function (r) { setTimeout(function () { r(new Response(JSON.stringify(d), { status: status, headers: { 'Content-Type': 'application/json' } })); }, 120); });
  };

  // Панель демо: кто смотрит + сброс. Смена роли - перезагрузка с #якорем (данные возвращаются к исходным).
  window.HR_DEMO = {
    role: ROLE,
    mountBar: function () {
      var css = document.createElement('style');
      css.textContent = '.pv-bar{position:fixed;left:16px;bottom:calc(12px + env(safe-area-inset-bottom, 0px));z-index:1400;display:flex;align-items:center;gap:8px 10px;flex-wrap:wrap;' +
        'max-width:min(560px,calc(100vw - 32px));box-sizing:border-box;background:var(--bg4);border:1px solid var(--border-strong);border-radius:10px;padding:7px 12px;' +
        'font:400 12px/1.3 "Golos Text",system-ui,sans-serif;color:var(--muted);box-shadow:0 2px 6px rgba(0,0,0,.35),0 12px 28px rgba(0,0,0,.35)}' +
        '.pv-dot{width:6px;height:6px;border-radius:50%;background:var(--amber);flex:none}' +
        '.pv-role{display:inline-flex;align-items:center;gap:6px;color:var(--text)}' +
        '.pv-bar select,.pv-bar button{background:var(--bg3);color:var(--text);border:1px solid var(--border-strong);border-radius:6px;padding:4px 8px;font:inherit;cursor:pointer}' +
        '.pv-bar button:hover,.pv-bar select:hover{background:var(--bg2)}' +
        '.pv-bar :focus-visible{outline:2px solid var(--blue);outline-offset:1px}';
      document.head.appendChild(css);
      var bar = document.createElement('div');
      bar.className = 'pv-bar';
      bar.innerHTML = '<span class="pv-dot"></span><span>Демо «Найм водителей» · данные условные, изменения видны только вам и пропадут после перезагрузки</span>' +
        '<label class="pv-role">Смотреть как <select id="pv-role">' + Object.keys(ROLES).map(function (k) { return '<option value="' + k + '"' + (k === ROLE ? ' selected' : '') + '>' + ROLES[k] + '</option>'; }).join('') + '</select></label>' +
        '<button type="button" id="pv-reset">Начать заново</button>';
      document.body.appendChild(bar);
      document.getElementById('pv-role').addEventListener('change', function () {
        try { sessionStorage.setItem('pv-hiring-role', this.value); } catch (e) {}
        location.hash = this.value; location.reload();
      });
      document.getElementById('pv-reset').addEventListener('click', function () { location.reload(); });
    }
  };
})();
