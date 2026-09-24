// Сборка ОДНОГО самодостаточного файла демо «Найм» для ссылки коллегам (Artifact на claude.ai).
// Та же страница, что preview-hiring.html, но всё вшито внутрь (artifact не может скачать index.html):
// стили и сайдбар - из files/index.html, код страницы - files/hiring.js + hiring.css БЕЗ изменений,
// демо-данные - preview-hiring-demo.js. Только стили/разметка меню и две функции (тост, курсорный свет),
// ни одного другого скрипта index.html (никаких ключей и логики сайта в ссылку не попадает).
// Запуск: node examples/build-preview-hiring.js <куда-положить.html>
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const out = process.argv[2];
if (!out) { console.error("укажите путь выходного файла"); process.exit(1); }
const html = fs.readFileSync(path.join(root, "files/index.html"), "utf8");
// Только настоящие теги стилей - они стоят в начале строки. Слово "<style>" встречается и в комментариях,
// и в JS-строках печатных форм - простой поиск по всему файлу захватывал куски скриптов.
const styles = [...html.matchAll(/^<style[^>]*>\r?\n([\s\S]*?)^<\/style>/gm)].map((m) => m[1]).join("\n");
if (!styles || /<script|function\s+\w+\s*\(/.test(styles.replace(/\/\*[\s\S]*?\*\//g, ""))) throw new Error("стили извлечены неверно");
let sidebar = html.match(/<aside class="sidebar">[\s\S]*?<\/aside>/)[0]
  .replace(/\sonclick="[^"]*"/g, "")
  .replace(/class="sidebar-nav-item active"/g, 'class="sidebar-nav-item"')
  .replace(/class="sidebar-nav-item"([^>]*data-page="hiring")/, 'class="sidebar-nav-item active"$1')
  .replace(/<script[\s\S]*?<\/script>/g, "");
if (/<script|onclick=/i.test(sidebar)) throw new Error("в сайдбаре остался скрипт");
let header = html.match(/<div class="page-header"[\s\S]*?<\/div>\s*\n\s*<main>/)[0].replace(/\s*<main>$/, "");
header = header.replace(/<div id="period-selector-wrap"[\s\S]*?<\/div>\s*<div id="range-selector-wrap"[\s\S]*?<\/div>/, "")
  .replace(/(<div class="page-header-title" id="page-title">)[^<]*/, "$1Найм водителей").replace(/\sonclick="[^"]*"/g, "");
function fnSrc(name) {
  const i = html.indexOf("function " + name + "(");
  if (i < 0) throw new Error("нет функции " + name);
  let d = 0;
  for (let k = html.indexOf("{", i); k < html.length; k++) { if (html[k] === "{") d++; else if (html[k] === "}") { d--; if (!d) return html.slice(i, k + 1); } }
}
const lightSel = html.match(/var LIGHT_GRID_SEL_ = '[^']+';/)[0];
// Звук интерфейса (uiBlip_/uiSounds + выключатель) и победная сцена (фанфара, салют) - как в CRM.
const sndStart = html.indexOf("var uiAudioCtx = null;"), sndEnd = html.indexOf("\n};", html.indexOf("var uiSounds = {")) + 3;
if (sndStart < 0 || sndEnd < sndStart) throw new Error("не нашёл звуковой блок");
const soundBlock = html.slice(sndStart, sndEnd);
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const noClose = (s) => s.replace(/<\/script/gi, "<\\/script");
const page = `<title>Найм водителей</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@500;600&family=Golos+Text:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap">
<style>
${styles}
${read("files/hiring.css")}
/* Демо: тема тёмная, единственная (как в дашборде) - фон и цвета явно, поверх светлой заготовки просмотрщика. */
:root{color-scheme:dark;}
html,body{background:var(--bg);color:var(--text);}
</style>
${sidebar}
<div class="main-wrap">
${header}
<main><div id="page-hiring" class="page active"></div></main>
</div>
<script>
${noClose(read("examples/preview-hiring-demo.js"))}
</script>
<script>
var p2ToastEl_ = null, p2ToastTimer_ = null, cursorLightInited_ = {};
${lightSel}
${noClose(fnSrc("p2Toast"))}
${noClose(fnSrc("initCursorLight_"))}
${noClose(soundBlock)}
${noClose(fnSrc("themeVar_"))}
${noClose(fnSrc("bankWinLevel_"))}
${noClose(fnSrc("bankWinFanfare_"))}
${noClose(fnSrc("bankCelebrate5_"))}
</script>
<script>
${noClose(read("files/hiring.js"))}
</script>
<script>window.HR_DEMO.mountBar(); window.HR.open();</script>
`;
fs.writeFileSync(out, page, "utf8");
console.log("готово:", out, Math.round(Buffer.byteLength(page) / 1024), "КБ");
