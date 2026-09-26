// Тесты address-point.js без сети и базы (подхватывает tests/unit.js). Главное - опасные случаи
// Влада 26.09: не уехать в другой город / другую часть Москвы.
"use strict";
const assert = require("assert");
const ap = require("./address-point.js");

let n = 0;
async function t(name, fn) { await fn(); n++; console.log("ok -", name); }
const C = (value, lat, lon, f) => Object.assign({ value, lat, lon, city: null, settlement: null, area: null, region: null, region_with_type: null }, f || {});
const fake = (list) => async () => list;

(async () => {
  await t("ссылка Яндекса ll= - точка из ссылки, порядок долгота,широта", async () => {
    const r = await ap.resolvePoint("Склад, https://yandex.ru/maps/?ll=37.617635%2C55.755814&z=17", { suggest: fake([]) });
    assert.strictEqual(r.source, "link"); assert(Math.abs(r.lat - 55.755814) < 1e-6 && Math.abs(r.lon - 37.617635) < 1e-6);
  });
  await t("whatshere[point]", async () => {
    const r = await ap.resolvePoint("https://yandex.ru/maps/?whatshere%5Bpoint%5D=37.5%2C55.4&z=16");
    assert.strictEqual(r.source, "link"); assert.strictEqual(r.lat, 55.4); assert.strictEqual(r.lon, 37.5);
  });
  await t("«широта, долгота» в тексте", async () => {
    const r = await ap.resolvePoint("въезд 3, 55.61234, 37.71234");
    assert.strictEqual(r.source, "coords"); assert.strictEqual(r.lat, 55.61234);
  });
  await t("координаты вне России (перепутаны местами) не принимаются", async () => {
    assert.strictEqual(ap.pointFromText("37.6, 155.7"), null);
    assert.strictEqual(ap.pointFromText("10.1, 20.2"), null);
  });
  await t("база: «База», «База ДМД», «ДМД»", async () => {
    for (const s of ["База", "База ДМД", "дмд"]) assert.strictEqual((await ap.resolvePoint(s)).source, "base");
  });
  await t("короткая ссылка разворачивается", async () => {
    const r = await ap.resolvePoint("https://yandex.ru/navi/-/CDbXyZ", { resolveLink: async () => "https://yandex.ru/maps/?ll=37.1%2C55.2" });
    assert.strictEqual(r.source, "short-link"); assert.strictEqual(r.lat, 55.2);
  });
  await t("несколько мест в одном поле - не угадываем", async () => {
    assert(ap.multiplePlaces("Подольских Курсантов; 8 Марта ;Бехтерева 47; Дзержинский"));
    assert(ap.multiplePlaces("Береговой проезд 2-5 - Подольских Курсантов 22б - Объекты МО-4 - Объект 8 Марта"));
    assert(!ap.multiplePlaces("Береговой проезд 2-5, Москва"));
    const r = await ap.resolvePoint("Подольских Курсантов; 8 Марта ;Бехтерева 47", { suggest: fake([C("x", 55, 37, { city: "Москва" })]) });
    assert.strictEqual(r.error, "в адресе несколько мест");
  });
  await t("Подольск в тексте - московская улица с похожим названием отклонена", async () => {
    const r = await ap.resolvePoint("Плещеевской 15, Подольск", { suggest: fake([
      C("г Москва, ул Плещеева, д 15", 55.88, 37.59, { city: "Москва", region: "Москва", region_with_type: "г Москва" }),
      C("Московская обл, г Подольск, ул Плещеевская, д 15", 55.43, 37.54, { city: "Подольск", region: "Московская", region_with_type: "Московская обл" }),
    ]) });
    assert.strictEqual(r.source, "search"); assert.strictEqual(r.lat, 55.43);
  });
  await t("Москва в тексте - город Подольск по слову улицы отклонён", async () => {
    const r = await ap.resolvePoint("г. Москва, ул. Подольская, 5", { suggest: fake([
      C("Московская обл, г Подольск, ул Московская, д 5", 55.43, 37.54, { city: "Подольск", region_with_type: "Московская обл" }),
      C("г Москва, ул Подольская, д 5", 55.70, 37.70, { city: "Москва", region: "Москва", region_with_type: "г Москва" }),
    ]) });
    assert.strictEqual(r.lat, 55.70);
  });
  await t("посёлок из текста: Ликино, Одинцовский г/о", async () => {
    const r = await ap.resolvePoint("Ликино Промышленная 1 Одинцовский г/о", { suggest: fake([
      C("г Москва, ул Промышленная, д 1", 55.6, 37.6, { city: "Москва", region_with_type: "г Москва" }),
      C("Московская обл, Одинцовский г/о, д Ликино, ул Промышленная, д 1", 55.58, 37.1, { settlement: "Ликино", area: "Одинцовский", region_with_type: "Московская обл" }),
    ]) });
    assert.strictEqual(r.lat, 55.58); assert.strictEqual(r.locality, "Ликино");
  });
  await t("«Московская обл» не совпадает с городом Москва", async () => {
    const r = await ap.resolvePoint("Московская обл, пос. Белозерский-3, зд. 4", { suggest: fake([
      C("г Москва, ул Белозерская, д 3", 55.87, 37.59, { city: "Москва", region_with_type: "г Москва" }),
    ]) });
    assert(r.error, "должна быть ошибка, а не Москва");
  });
  await t("адрес без города, найден только в Москве - Москва по умолчанию, с пометкой", async () => {
    const r = await ap.resolvePoint("ул 1й Красногвардейский проезд д 3", { suggest: fake([
      C("г Москва, 1-й Красногвардейский проезд, д 3", 55.75, 37.53, { city: "Москва", region_with_type: "г Москва" }),
    ]) });
    assert.strictEqual(r.lat, 55.75); assert(/не указан/.test(r.locality));
  });
  await t("адрес без города, вариантов нет в Москве - точки нет, причина словами", async () => {
    const r = await ap.resolvePoint("ул Ленина 10", { suggest: fake([
      C("Тульская обл, г Тула, ул Ленина, д 10", 54.19, 37.61, { city: "Тула", region: "Тульская", region_with_type: "Тульская обл" }),
      C("Московская обл, г Подольск, ул Ленина, д 10", 55.43, 37.54, { city: "Подольск", region_with_type: "Московская обл" }),
    ]) });
    assert.strictEqual(r.error, "город или посёлок из адреса не совпал с найденным");
  });
  await t("Москва падежом («в Москве») находит московский адрес", async () => {
    const r = await ap.resolvePoint("Лукойл Арена (стадион «Спартак» в Москве) стенд А-720", { suggest: fake([
      C("г Москва, Волоколамское ш, д 69", 55.81, 37.44, { city: "Москва", region_with_type: "г Москва" }),
    ]) });
    assert.strictEqual(r.lat, 55.81);
  });
  await t("живой случай 26.09: «ул Промышленная, д 37» без города НЕ уходит в пгт Промышленная (Кузбасс)", async () => {
    const r = await ap.resolvePoint("ул Промышленная, д 37", { suggest: fake([
      C("Кемеровская область - Кузбасс, пгт Промышленная, ул Вокзальная, двлд 3", 54.9, 85.6, { settlement: "Промышленная", region: "Кемеровская область - Кузбасс", region_with_type: "Кемеровская область - Кузбасс" }),
    ]) });
    assert(r.error, "должна быть ошибка, а не Кузбасс");
  });
  await t("«Промышленная улица 5, Подольск» - улица не считается посёлком, город Подольск находится", async () => {
    const r = await ap.resolvePoint("Промышленная улица 5, Подольск", { suggest: fake([
      C("Кемеровская обл, пгт Промышленная", 54.9, 85.6, { settlement: "Промышленная", region_with_type: "Кемеровская обл" }),
      C("Московская обл, г Подольск, ул Промышленная, д 5", 55.43, 37.54, { city: "Подольск", region_with_type: "Московская обл" }),
    ]) });
    assert.strictEqual(r.lat, 55.43);
  });
  await t("«г. Подольск ул. Ленина 5» - город перед «ул» остаётся городом", async () => {
    const r = await ap.resolvePoint("г. Подольск ул. Ленина 5", { suggest: fake([
      C("Московская обл, г Подольск, ул Ленина, д 5", 55.43, 37.54, { city: "Подольск", region_with_type: "Московская обл" }),
    ]) });
    assert.strictEqual(r.lat, 55.43);
  });
  await t("другой регион - только если он назван: «г. Тула, ул Ленина 1» да, без Тулы нет", async () => {
    const tula = C("г Тула, ул Ленина, д 1", 54.19, 37.61, { city: "Тула", region: "Тульская", region_with_type: "Тульская обл" });
    assert.strictEqual((await ap.resolvePoint("г. Тула, ул Ленина 1", { suggest: fake([tula]) })).lat, 54.19);
    assert((await ap.resolvePoint("ул Ленина 1", { suggest: fake([tula]) })).error);
  });
  await t("живой случай 26.09: «Московская обл, пос.Белозерский-3» НЕ уходит в Вологодскую обл", async () => {
    const r = await ap.resolvePoint("Московская обл,пос.Белозерский-3,зд.4", { suggest: fake([
      C("Вологодская обл, г Белозерск, ул 3-го Интернационала, д 4", 60.03, 37.79, { city: "Белозерск", region: "Вологодская", region_with_type: "Вологодская обл" }),
    ]) });
    assert(r.error, "должна быть ошибка, а не Вологда");
  });
  await t("одинаковые деревни далеко друг от друга - не угадываем", async () => {
    const r = await ap.resolvePoint("Тверская область, д. Поляны", { suggest: fake([
      C("Тверская обл, пгт Пено, деревня Поляны", 56.92, 32.73, { settlement: "Поляны", region: "Тверская", region_with_type: "Тверская обл" }),
      C("Тверская обл, Калининский р-н, деревня Поляны", 56.95, 35.60, { settlement: "Поляны", region: "Тверская", region_with_type: "Тверская обл" }),
    ]) });
    assert.strictEqual(r.error, "несколько мест с таким названием - уточните район");
  });
  await t("«МО» и «Смоленская область» работают как названная область", async () => {
    const smol = C("Смоленская обл, г Десногорск", 54.15, 33.28, { city: "Десногорск", region: "Смоленская", region_with_type: "Смоленская обл" });
    assert.strictEqual((await ap.resolvePoint("десногорск Смоленская область", { suggest: fake([smol]) })).lat, 54.15);
    assert((await ap.resolvePoint("МО, десногорск", { suggest: fake([smol]) })).error);
  });
  await t("Москва по умолчанию: «Хлобыстова 16к.1» - все варианты московские - берём", async () => {
    const r = await ap.resolvePoint("Хлобыстрова 16к.1", { suggest: fake([
      C("г Москва, ул Хлобыстова, д 16 к 1", 55.71, 37.83, { city: "Москва", region: "Москва", region_with_type: "г Москва" }),
      C("г Москва, ул Хлобыстова, д 16", 55.71, 37.83, { city: "Москва", region: "Москва", region_with_type: "г Москва" }),
    ]) });
    assert.strictEqual(r.lat, 55.71); assert(/не указан/.test(r.locality));
  });
  await t("Москва по умолчанию НЕ срабатывает, если такая улица есть и в другом городе", async () => {
    const r = await ap.resolvePoint("Сталеваров вл 1 б", { suggest: fake([
      C("г Москва, ул Сталеваров, влд 1б", 55.75, 37.83, { city: "Москва", street_with_type: "ул Сталеваров", region_with_type: "г Москва" }),
      C("Липецкая обл, г Липецк, ул Сталеваров, д 1", 52.6, 39.6, { city: "Липецк", street_with_type: "ул Сталеваров", region: "Липецкая", region_with_type: "Липецкая обл" }),
    ]) });
    assert(r.error);
  });
  await t("Москва по умолчанию: улица с другим названием в другом городе не мешает (Хлобыстова / Алексея Хлобыстова)", async () => {
    const r = await ap.resolvePoint("Хлобыстрова 16к.1", { suggest: fake([
      C("г Москва, ул Хлобыстова, д 16 к 1", 55.7179, 37.83, { city: "Москва", street_with_type: "ул Хлобыстова", region_with_type: "г Москва" }),
      C("г Мурманск, ул Алексея Хлобыстова, д 16 к 2", 69.01, 33.1, { city: "Мурманск", street_with_type: "ул Алексея Хлобыстова", region_with_type: "Мурманская обл" }),
    ]) });
    assert.strictEqual(r.lat, 55.7179);
  });
  await t("микрорайон города: «Химки, Кирилловка 6с» -> мкр Подрезково г Химки", async () => {
    const r = await ap.resolvePoint("Химки, Кирилловка 6с", { suggest: fake([
      C("Московская обл, г Химки, мкр Подрезково, кв-л Кирилловка, стр 6с", 55.959, 37.2, { city: "Химки", settlement: "Подрезково", settlement_with_type: "мкр Подрезково", region_with_type: "Московская обл" }),
    ]) });
    assert.strictEqual(r.lat, 55.959);
  });
  await t("город назван, а посёлок кандидата - нет: «Щёлково, ул Московская 140» не уходит во Фряново", async () => {
    const r = await ap.resolvePoint("Московская обл, г Щёлково, ул Московская, д 140", { suggest: fake([
      C("Московская обл, г Щёлково, рп Фряново, ул Московская, д 140", 56.13, 38.45, { city: "Щёлково", settlement: "Фряново", region: "Московская", region_with_type: "Московская обл" }),
      C("Московская обл, г Щёлково, ул Московская, д 140", 55.92, 38.0, { city: "Щёлково", region: "Московская", region_with_type: "Московская обл" }),
    ]) });
    assert.strictEqual(r.lat, 55.92);
  });
  await t("живой случай №472: «Дорогобуж» и «Воскресенск» - не московские улицы Дорогобужская/Воскресенская", async () => {
    const r = await ap.resolvePoint("Дорогобуж", { suggest: fake([
      C("г Москва, ул Дорогобужская", 55.73, 37.43, { city: "Москва", region_with_type: "г Москва" }),
      C("Смоленская обл, г Дорогобуж", 54.91, 33.3, { city: "Дорогобуж", region: "Смоленская", region_with_type: "Смоленская обл" }),
    ]) });
    assert.strictEqual(r.lat, 54.91);
  });
  await t("поиск недоступен - понятная ошибка, не падение", async () => {
    const r = await ap.resolvePoint("г Подольск, ул Ленина 1", { suggest: async () => { throw new Error("сеть"); } });
    assert.strictEqual(r.error, "поиск адресов недоступен");
  });
  await t("только ссылка, не развернулась - причина про ссылку", async () => {
    const r = await ap.resolvePoint("https://yandex.ru/navi/-/CDbXyZ", { resolveLink: async () => { throw new Error("x"); }, suggest: fake([]) });
    assert.strictEqual(r.error, "ссылка не открылась");
  });
  console.log("address-point: все " + n + " проверок прошли");
})().catch((e) => { console.error("ОШИБКА:", e.message); process.exit(1); });
