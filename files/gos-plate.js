/* Стандарт госномера РФ - помощник ввода (24.09.2026, plans/2026-09-24-hired-to-partners-bridge.md).
   Тягач «Н 074 КК 126», прицеп «ЕВ 3181 77». Решает СЕРВЕР (api/lib/partner-bridge.js, parsePlate) -
   hired_set и формы Справочников отказывают при неверном формате. Здесь только удобство: пробелы
   ставятся сами (и при вставке), латинские двойники становятся кириллицей, ошибка подсвечивается
   сразу. Браузер и Node - разные среды, поэтому это вторая копия правила; если разойдутся,
   пострадает подсказка, не данные.
   Мусор НЕ «спасаем» по буквам: «КАМАЗ Т2642» остаётся как написано и горит ошибкой, а не
   превращается в правдоподобный, но выдуманный «КА 2642». */
(function (w) {
  'use strict';
  var LETTERS = 'АВЕКМНОРСТУХ';
  var LAT = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', X: 'Х', Y: 'У' };
  var SHAPE = { tractor: 'LDDDLLDDD', trailer: 'LLDDDDDDD' }; // последняя цифра региона необязательна
  var GAPS = { tractor: [1, 4, 6], trailer: [2, 6] };        // перед какими знаками пробел
  var EXAMPLE = { tractor: 'Н 074 КК 126', trailer: 'ЕВ 3181 77' };
  var WHAT = { tractor: 'тягача', trailer: 'прицепа' };

  function key(raw) {
    var s = String(raw || '').toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g, ''), out = '';
    for (var i = 0; i < s.length; i++) out += LAT[s[i]] || s[i];
    return out;
  }
  function isPrefix(k, kind) {
    var sh = SHAPE[kind];
    if (k.length > sh.length) return false;
    for (var i = 0; i < k.length; i++) {
      if (sh[i] === 'L' ? LETTERS.indexOf(k[i]) < 0 : !/\d/.test(k[i])) return false;
    }
    return true;
  }
  function isComplete(k, kind) { return isPrefix(k, kind) && k.length >= SHAPE[kind].length - 1; }
  function spaced(k, kind) {
    var g = GAPS[kind], out = '';
    for (var i = 0; i < k.length; i++) out += (g.indexOf(i) >= 0 ? ' ' : '') + k[i];
    return out;
  }
  // { ok, empty, partial, formatted, error } - partial: правильное начало номера (ещё вводят)
  function parse(raw, kind) {
    var k = key(raw);
    if (!k) return { ok: true, empty: true, formatted: '' };
    if (isComplete(k, kind)) return { ok: true, empty: false, formatted: spaced(k, kind) };
    var other = kind === 'tractor' ? 'trailer' : 'tractor';
    return { ok: false, empty: false, partial: isPrefix(k, kind),
      error: 'Госномер ' + WHAT[kind] + ' не по стандарту, нужно как «' + EXAMPLE[kind] + '»' +
        (isComplete(k, other) ? ' - похоже на номер ' + WHAT[other] : '') };
  }
  function kindOf_(kindOrFn) { return typeof kindOrFn === 'function' ? kindOrFn() : kindOrFn; }
  function mark_(input, r, strict) {
    var bad = !r.ok && (strict || !r.partial);
    input.classList.toggle('gos-bad', bad);
    input.title = bad ? r.error : '';
    return bad;
  }
  // Подключить поле: пробелы на лету, проверка при уходе из поля. kind - 'tractor'/'trailer' или
  // функция (форма, где тип выбирают селектом). Повторный вызов на том же поле безвреден.
  function wire(input, kindOrFn) {
    if (!input || input.__yardPlate) return;
    input.__yardPlate = true;
    input.setAttribute('autocapitalize', 'characters');
    input.setAttribute('spellcheck', 'false');
    input.addEventListener('input', function () {
      var kind = kindOf_(kindOrFn), k = key(input.value);
      if (k && isPrefix(k, kind)) {
        var v = spaced(k, kind);
        if (v !== input.value) {
          input.value = v;
          try { input.setSelectionRange(v.length, v.length); } catch (e) {}
        }
      }
      mark_(input, parse(input.value, kind), false);
    });
    input.addEventListener('blur', function () { check(input, kindOf_(kindOrFn)); });
  }
  // Перед сохранением: приводит к стандарту и возвращает '' или текст ошибки.
  function check(input, kind) {
    if (!input) return '';
    var r = parse(input.value, kind);
    if (r.ok && !r.empty && input.value !== r.formatted) input.value = r.formatted;
    return mark_(input, r, true) ? r.error : '';
  }

  if (typeof document !== 'undefined' && !document.getElementById('gos-plate-style')) {
    var st = document.createElement('style');
    st.id = 'gos-plate-style';
    st.textContent = '.gos-bad{border-color:var(--red,#E24B4A)!important;box-shadow:inset 0 0 0 1px var(--red,#E24B4A)!important}';
    (document.head || document.documentElement).appendChild(st);
  }
  w.YardPlate = { key: key, parse: parse, wire: wire, check: check, EXAMPLE: EXAMPLE };
})(window);
