// Единое правило «текст адреса -> точка на карте» (26.09.2026, plans/2026-09-26-customer-addresses-and-
// price-geo.md в основном репозитории). До этого та же логика жила тремя копиями: форма «Задания» на
// клиенте (findAddrCoords_), оценка цены (geocodeText - ссылки выбрасывала, координаты из текста не
// читала, брала «первый московский» вариант) и навигация. Здесь - одно правило для сервера.
//
// Влад 26.09: «если машина уедет в другой город или другую часть Москвы - это проблема». Поэтому:
//  - точка из ссылки Яндекса / пары чисел / базы - как в форме (это то, что указал человек);
//  - точка ПОИСКОМ ПО ТЕКСТУ (DaData) принимается, только если населённый пункт найденного адреса
//    (посёлок, город или округ) назван в самом тексте менеджера. Нет совпадения - точки нет и
//    причина словами; «первый московский вариант» вслепую больше не берём;
//  - «Подольских Курсантов; 8 Марта; Бехтерева 47» - несколько мест в одном адресе, не угадываем;
//  - найденная поиском точка - ТОЛЬКО для оценки цены, в заявку водителю её не пишет никто (правило Б1).
"use strict";

const geocoder = require("./geocoder.js");

const BASE = { lat: 55.467403, lon: 37.778261 }; // Домодедово - та же база, что в калькуляторе/CRM/оценке
const BASE_SHORTHAND_RE = /^\s*(база(\s*(дмд|домодедово))?|дмд)\.?\s*$/i;
// Ссылка Яндекс.Карт/Навигатора и её параметры (порядок в ссылке - долгота,широта) - как в форме
const YANDEX_LINK_RE = /https?:\/\/(?:[a-z0-9-]+\.)?ya(?:ndex)?\.[a-z.]+\/(?:maps|navi)[^\s)"'<>]*/i;
const RE_LL_PT = /[?&](?:ll|pt)=([\-\d.]+)(?:%2C|,)([\-\d.]+)/i;
const RE_WHATSHERE = /whatshere(?:%5B|\[)point(?:%5D|\])=([\-\d.]+)(?:%2C|,)([\-\d.]+)/i;
const BARE_COORD_RE = /(-?\d{1,3}\.\d{2,8})\s*[,;]\s*(-?\d{1,3}\.\d{2,8})/;
const ANY_LINK_RE = /https?:\/\/\S+/g;

// Россия с запасом (Калининград ~19.6 в.д. ... Камчатка/Чукотка). Точка вне - это перепутанные
// широта/долгота или чужая ссылка, такой точке не верим.
function inRussia(lat, lon) {
  lat = Number(lat); lon = Number(lon);
  return isFinite(lat) && isFinite(lon) && lat >= 41 && lat <= 82 && lon >= 19 && lon <= 180;
}

// Точка, которую указал человек: параметры ссылки Яндекса или «широта, долгота» в тексте. Ничего не
// ищет в сети. Короткую ссылку (/-/xxxx) без координат возвращает как needsResolve.
function pointFromText(text) {
  const s = String(text || "");
  const linkM = s.match(YANDEX_LINK_RE);
  const link = linkM ? linkM[0] : "";
  if (link) {
    const m = link.match(RE_WHATSHERE) || link.match(RE_LL_PT);
    if (m && inRussia(m[2], m[1])) return { lat: Number(m[2]), lon: Number(m[1]), source: "link" };
  }
  // пару чисел ищем только ВНЕ ссылки - иначе числа из нераспознанного URL (долгота,широта) перевернутся
  const rest = link ? s.slice(0, linkM.index) + s.slice(linkM.index + link.length) : s;
  const bare = rest.match(BARE_COORD_RE);
  if (bare && inRussia(bare[1], bare[2])) return { lat: Number(bare[1]), lon: Number(bare[2]), source: "coords" };
  if (link) return { needsResolve: true, link };
  return null;
}

// Несколько мест в одном поле: «А; Б; В» или «А - Б - В» (дефис с пробелами, не «2-5» внутри номера)
function multiplePlaces(text) {
  const clean = String(text || "").replace(ANY_LINK_RE, " ");
  const bySemi = clean.split(";").map((x) => x.trim()).filter((x) => x.length >= 3);
  if (bySemi.length >= 2) return true;
  const byDash = clean.split(/\s+[-–—]\s+/).map((x) => x.trim()).filter((x) => x.length >= 3);
  return byDash.length >= 3;
}

function norm(s) { return String(s || "").toLowerCase().replace(/ё/g, "е"); }
function words(s) { return norm(s).split(/[^a-zа-я0-9]+/).filter(Boolean); }
// Основа названия для сравнения с падежами текста: «Подольск» -> «подоль» (Подольске, Подольский),
// «Москва» -> «москв» (Москве; «Московская» НЕ совпадёт - там «москов»), «Ликино» -> «ликин».
function stem(name) {
  const n = norm(name).replace(/[^a-zа-я0-9]/g, "");
  if (n.length <= 4) return n;
  return n.slice(0, n.length <= 6 ? n.length - 1 : n.length - 2);
}
// Названо ли место в тексте: любое слово текста начинается с основы названия
function namedIn(textWords, name) {
  if (!name) return false;
  const parts = words(name).filter((w) => w.length >= 3 && !/^(г|гор|город|пос|поселок|посёлок|село|деревня|д|с|п|рп|пгт|район|р|округ|го|мкр|микрорайон|поселение|городской|муниципальный|сельское)$/.test(w));
  if (!parts.length) return false;
  return parts.every((p) => { const st = stem(p); return st.length >= 3 && textWords.some((w) => w.startsWith(st)); });
}
// Какие населённые пункты кандидата допустимы для сверки: посёлок/деревня, город, округ/район.
// Область (регион) - слишком крупно: «Московская обл» совпадала бы с любым адресом области.
function candidateLocalities(c) {
  return [c.settlement, c.city, c.area].filter(Boolean);
}

// Запросы к поиску. Поиск DaData понимает «Город Улица Дом» и теряется на разговорном тексте
// («Плещеевской 15, Подольск», «Солнечногорский р-н пос.Майдарово 18 производственная зона»)
// - проба 26.09 на живых адресах. Поэтому по порядку: текст как есть; без скобок, «метро ... рядом»,
// «производственная зона», номера трассы и км; последняя часть через запятую (обычно город) - вперёд;
// без служебных слов «пос./д./р-н/г.о./обл». Не больше 4 запросов на адрес. Любой результат всё
// равно проходит сверку населённого пункта - лишний запрос не добавляет риска уехать не туда.
const NOISE_RES = [
  /\([^)]*\)/g,
  /(?:метро|м\.)\s+[а-яё-]+(?:\s+рядом)?\.?/gi,
  /производственная\s+зона|промзона|пром\.?\s*зона/gi,
  /стенд\s+\S+/gi,
  /(?:^|[\s,.(])зона\s+[\d.]+/gi, // «зона 10.1» (не \b - с кириллицей не работает)
  /(?:^|\s|,)[рмаРМА]-?\d{1,3}(?=\s|,|$)/g, // трасса Р22, М4, А-108
  /\d+\s*-?\s*(?:й\s*)?км(?![а-яёa-z])\.?/gi, // 184км, 45-й км (не \b: с кириллицей в JS он не работает)
];
const MARKERS_RE = /(?:^|[\s,.])(?:московская\s+обл(?:асть)?|обл|область|р-н|район|г\.?\s*\/\s*о|го|городской\s+округ|пос|поселок|посёлок|п|д|дер|деревня|с|село|мкр|рп|пгт|г|гор|ул|улица|вл|зд|стр|корп|з\/у|кв-л|квартал)\.?(?=[\s,.\d]|$)/gi;
function tidy(s) { return s.replace(/[;]/g, " ").replace(/(^|\s)\.(?=[а-яёА-ЯЁ])/g, "$1").replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").replace(/^[\s,.]+|[\s,.]+$/g, "").trim(); }
function queries(text) {
  const clean = tidy(String(text || "").replace(ANY_LINK_RE, " "));
  let noNoise = clean;
  NOISE_RES.forEach((re) => { noNoise = noNoise.replace(re, " "); });
  noNoise = tidy(noNoise);
  const parts = noNoise.split(",").map((x) => x.trim()).filter(Boolean);
  const reordered = parts.length >= 2 ? tidy([parts[parts.length - 1]].concat(parts.slice(0, -1)).join(", ")) : "";
  const bare = tidy(noNoise.replace(MARKERS_RE, " ").replace(/,/g, " "));
  const q = [clean, noNoise, reordered, bare].filter((x) => x && x.length >= 3);
  return Array.from(new Set(q)).slice(0, 4);
}

// Явно названные в тексте города: «г. Подольск», «г Москва», «город Химки». Если такой есть, кандидат
// обязан быть в нём - иначе «Москва, ул. Подольская» могла бы уйти в город Подольск по слову улицы.
function explicitCities(text) {
  const out = [];
  const re = /(?:^|[\s,.(;])(?:г|гор|город)\.?\s+([а-яёa-z-]{3,})/gi;
  let m;
  while ((m = re.exec(String(text || "")))) out.push(m[1]);
  return out;
}
// Город из текста («Подольске», «Химки») совпадает с посёлком/городом/округом кандидата по основе слова
function cityMatches(x, c) {
  if (/^москв/.test(norm(x))) return inMoscowCity(c);
  const xs = stem(x);
  return candidateLocalities(c).some((l) => { const ls = stem(l); return ls.length >= 3 && (norm(x).startsWith(ls) || norm(l).startsWith(xs)); });
}
// Слова текста, которые могут быть названием НАСЕЛЁННОГО ПУНКТА: без слов-названий улиц. Живой случай
// 26.09: «ул Промышленная, д 37» (без города) совпал с пгт Промышленная в Кемеровской области - 2981 км.
// Слово рядом с «ул/улица/проезд/шоссе/...» (до или после) - это улица, для сверки места не годится.
// Маркер ПЕРЕД названием: «ул Промышленная», «ш Каширское» - улица - слово ПОСЛЕ маркера.
const STREET_PREFIX = new Set(["ул", "улица", "пер", "переулок", "проезд", "пр", "пркт", "проспект", "ш", "шоссе", "бр", "бульвар",
  "наб", "набережная", "пл", "площадь", "туп", "тупик", "аллея", "линия", "просек", "тракт", "дорога", "мкр", "микрорайон"]);
// Полное слово ПОСЛЕ названия: «Промышленная улица», «Береговой проезд» - улица - слово ПЕРЕД ним.
// Только полные слова: «Подольск ул Ленина» - «Подольск» остаётся городом.
const STREET_POSTFIX = new Set(["улица", "переулок", "проезд", "проспект", "шоссе", "бульвар", "набережная", "площадь", "тупик", "аллея", "тракт", "линия", "просек"]);
function placeWords(text) {
  const out = [];
  String(text || "").replace(ANY_LINK_RE, " ").replace(/пр-т/gi, "пркт").replace(/б-р/gi, "бр")
    .split(/[,;()]/).forEach((seg) => { // запятая рвёт связь «слово - маркер»
      const w = words(seg);
      w.forEach((x, i) => { if (!STREET_PREFIX.has(w[i - 1]) && !STREET_POSTFIX.has(w[i + 1])) out.push(x); });
    });
  return out;
}
// Названная в тексте область/край: «Московская обл», «Смоленская область», «МО». Живой случай 26.09:
// «Московская обл, пос.Белозерский-3» уходил в г Белозерск Вологодской обл по похожему слову.
function namedRegions(text) {
  const w = words(text);
  const out = [];
  w.forEach((x, i) => { if (/^(обл|область|край|республика|респ)$/.test(w[i + 1] || "") && x.length >= 4) out.push(x); });
  if (w.includes("мо") || w.some((x) => x.startsWith("подмосков"))) out.push("московская");
  return out;
}
function regionMatches(rw, c) {
  const cr = norm(c.region || c.region_with_type || "");
  if (!cr) return false;
  const a = stem(rw), b = stem(cr.split(/\s+/)[0]);
  if (a.startsWith("московск") && inMoscowCity(c)) return true; // «Московская обл» у новомосковских адресов - по привычке
  return a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a));
}
function kmBetween(a, b) {
  const R = 6371, rad = (x) => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// Москва и область - основной район работы. Точку в другом регионе берём, только если сам регион
// или его город назван в тексте (как место, не как улица).
function inHomeRegion(c) {
  const r = norm(c.region_with_type || c.region);
  return /москва|московская/.test(r);
}
function inMoscowCity(c) {
  return /^москва$/i.test(String(c.city || "").trim()) || /(^|\s)г\.?\s*москва$/i.test(norm(c.region_with_type).trim()) || norm(c.region) === "москва";
}

// Поиск точки по тексту с проверкой населённого пункта. suggest - функция поиска (подменяется в тестах).
async function geocodeChecked(text, suggest) {
  const tw = placeWords(text); // без слов-названий улиц
  const mentionsMoscow = tw.some((w) => /^москв/.test(w)) || tw.includes("мск");
  const cities = explicitCities(text);
  const regions = namedRegions(text);
  const passes = (c) => {
    // Москва названа в тексте - кандидат обязан быть в Москве (не в области с похожей улицей)
    if (mentionsMoscow && !inMoscowCity(c)) return null;
    // «г. X» в тексте - кандидат обязан быть в X
    if (cities.length && !cities.some((x) => cityMatches(x, c))) return null;
    // «Y-ская обл» в тексте - кандидат обязан быть в этой области
    if (regions.length && !regions.some((r) => regionMatches(r, c))) return null;
    // вне Москвы и области - только если регион или его город назван в тексте как место
    if (!inHomeRegion(c) && !regions.length && !namedIn(tw, c.region) && !namedIn(tw, c.city)) return null;
    // Назван должен быть САМЫЙ ТОЧНЫЙ населённый пункт кандидата: посёлок, если он есть, иначе город,
    // иначе округ. «Щёлково, ул Московская 140» не должен уйти в рп Фряново того же округа (40 км) -
    // там город Щёлково тоже «назван», но посёлок Фряново - нет.
    // Микрорайон («мкр Подрезково» в Химках, «мкр Центральный» в Домодедово) поиск кладёт в поле посёлка,
    // но это часть города - для сверки берём город.
    const settl = c.settlement && !/^(мкр|микрорайон)(?![а-яё])/i.test(String(c.settlement_with_type || "")) ? c.settlement : null;
    const most = settl || c.city || c.area;
    return most && namedIn(tw, most) ? most : null;
  };
  // Москва по умолчанию: город в тексте не назван («Хлобыстова 16 к1», «Монтажная 11с1» - так пишут
  // московские адреса), и поиск находит такой адрес ТОЛЬКО в старой Москве (все варианты - Москва, без
  // посёлков Новой Москвы). Есть такая же улица в другом городе - не угадываем.
  const nothingNamed = !cities.length && !regions.length;
  let moscowDefault = null;
  let sawAny = false;
  for (const q of queries(text)) {
    let list;
    try { list = await suggest(q, 7); } catch (e) { return { error: "поиск адресов недоступен" }; }
    const valid = (list || []).filter((c) => c.lat != null && c.lon != null && inRussia(c.lat, c.lon));
    if (valid.length) sawAny = true;
    if (nothingNamed && !moscowDefault && valid.length && inMoscowCity(valid[0]) && !valid[0].settlement) {
      // мешает только ТАКАЯ ЖЕ улица в другом городе («ул Хлобыстова» в Москве и «ул Алексея Хлобыстова»
      // в Мурманске - разные улицы, а «ул Сталеваров» в Москве и в Липецке - одна и та же)
      const st = norm(valid[0].street_with_type);
      const clash = valid.some((c) => !inMoscowCity(c) && (!st || norm(c.street_with_type) === st));
      if (!clash) moscowDefault = valid[0];
    }
    for (let i = 0; i < valid.length; i++) {
      const c = valid[i];
      const hit = passes(c);
      if (!hit) continue;
      // Одинаковые названия в разных местах («д. Поляны» в Тверской обл - их несколько): если среди
      // вариантов есть такое же название дальше 15 км - не угадываем.
      const twin = valid.slice(i + 1).find((d) => { const h = passes(d); return h && norm(h) === norm(hit) && kmBetween(c, d) > 15; });
      if (twin) return { error: "несколько мест с таким названием - уточните район" };
      return { lat: Number(c.lat), lon: Number(c.lon), source: "search", found: c.value, locality: hit };
    }
  }
  if (moscowDefault) {
    return { lat: Number(moscowDefault.lat), lon: Number(moscowDefault.lon), source: "search", found: moscowDefault.value, locality: "Москва (город в адресе не указан)" };
  }
  return { error: sawAny ? "город или посёлок из адреса не совпал с найденным" : "адрес не найден поиском" };
}

// Главная функция. opts.search === false - только то, что указал человек (ссылка, числа, база).
// Возвращает { lat, lon, source, found?, locality? } или { error }.
async function resolvePoint(text, opts) {
  opts = opts || {};
  const s = String(text || "").trim();
  if (!s) return { error: "адрес пустой" };
  if (BASE_SHORTHAND_RE.test(s)) return { lat: BASE.lat, lon: BASE.lon, source: "base" };
  const p = pointFromText(s);
  if (p && p.lat != null) return p;
  if (p && p.needsResolve) {
    try {
      const full = await (opts.resolveLink || geocoder.resolveMapLink)(p.link);
      const m = String(full).match(RE_WHATSHERE) || String(full).match(RE_LL_PT);
      if (m && inRussia(m[2], m[1])) return { lat: Number(m[2]), lon: Number(m[1]), source: "short-link" };
    } catch (e) { /* ссылка не развернулась - ниже пробуем текст рядом со ссылкой */ }
  }
  if (opts.search === false) return { error: "в адресе нет точки" };
  if (multiplePlaces(s)) return { error: "в адресе несколько мест" };
  const rest = s.replace(ANY_LINK_RE, " ").trim();
  if (rest.length < 3) return { error: p && p.needsResolve ? "ссылка не открылась" : "в адресе нет текста для поиска" };
  return geocodeChecked(rest, opts.suggest || geocoder.suggestAddress);
}

module.exports = { resolvePoint, pointFromText, multiplePlaces, geocodeChecked, queries, namedIn, words, inRussia, BASE };
