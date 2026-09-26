# Журнал действий ux_events - как встроить на VPS (Фаза 1А)

План: `plans/2026-09-26-smooth-work-ux-analytics.md` (репозиторий дашборда).
Черновик сверен с боевым кодом 26.09 (VPS HEAD `78887d8`, дерево чистое): `api/server.js` 12 809 строк,
`checkSession`/`isServiceProbe_` - строки ~323-346, модули `require("./lib/...")({ app, pool, ... })` в
конце файла (последний - `owner-report.js`, строка 12796), `tests/golden/golden.js` - `NOISE_TABLES`
строки 40-41, `import/watchdog.js` - `JOBS` строки 56-66. Таблицы `ux_events` на сервере нет,
`UX_TRACK`/`UX_EVENTS_KEEP_DAYS` в `.env` нет.

## Файлы

| Файл черновика | Куда на VPS |
|---|---|
| `ux-events.js` | `api/lib/ux-events.js` |
| `ux-events.test.js` | `api/lib/ux-events.test.js` (подхватит `node tests/unit.js`, а значит и `./deploy.sh`) |
| `ux-events-cleanup.js` | `import/ux-events-cleanup.js` |
| `ux-events-schema.sql` | `import/ux-events-schema.sql` |

Клиент (`files/ux-track.js` + 1 строка в `showPage` + теги `<script>` + `SHELL_FILES` в `sw.js`) -
в репозитории дашборда, едет обычным push в `main`. **Порядок: сначала сервер, потом сайт.** Если
сайт окажется раньше, клиент получит 404, будет копить события (до 500 на вкладку) и повторять с
паузой до минуты - ничего не потеряется, но лишние запросы пойдут.

## Порядок выката

### 0. Координация
```bash
ssh -i ~/.ssh/beget-yard/id_ed25519 root@159.194.201.167
cd /root/yard-dashboard && git status && git diff   # чужое незакоммиченное - сначала sync-коммит
```
Плюс `ListAgents`: никто ли сейчас не правит `server.js`.

### 1. Скопировать файлы (с машины, из папки черновика)
```bash
scp -i ~/.ssh/beget-yard/id_ed25519 ux-events.js ux-events.test.js root@159.194.201.167:/root/yard-dashboard/api/lib/
scp -i ~/.ssh/beget-yard/id_ed25519 ux-events-cleanup.js ux-events-schema.sql root@159.194.201.167:/root/yard-dashboard/import/
```
(Кириллица в комментариях - UTF-8; `scp` переносит байты как есть, проверить `file api/lib/ux-events.js`.)

### 2. Таблица (сначала можно на тестовой копии)
Тестовая копия: `staging/refresh.sh` -> `mysql --default-character-set=utf8mb4 yard_staging < import/ux-events-schema.sql`.

Бой:
```bash
mysql --default-character-set=utf8mb4 yard_dashboard < import/ux-events-schema.sql
mysql yard_dashboard -e "SHOW CREATE TABLE ux_events\G"
```
`CREATE TABLE IF NOT EXISTS` - повторный запуск безопасен.

### 3. `api/server.js` - одна строка подключения
Сразу ПОСЛЕ строки `require("./lib/owner-report.js")({ app, pool, checkServerKey, ... });` (сейчас 12796),
до блока «Готовность перед приёмом запросов»:
```js

// Журнал действий «Гладкая работа» (26.09.2026, plans/2026-09-26-smooth-work-ux-analytics.md в основном
// репозитории) - POST /api/ux/batch, таблица ux_events. Каждый клик/выбор/переход со всех экранов -
// ради поиска лишних действий. Выключатель - UX_TRACK=off в .env (+ ./deploy.sh).
require("./lib/ux-events.js")({ app, pool, checkSession, isServiceProbe: isServiceProbe_ });
```
`isServiceProbe_` - объявление функции, поднимается (hoisting), порядок в файле не важен. Маршрут
регистрируется синхронно до `app.listen` (тот внутри `ROLE_DATA_READY_.then`).

Заметка: `/api/ui_event` и его `logUiEvent_` не трогаем.

### 4. `tests/golden/golden.js` - `NOISE_TABLES`
Иначе эталоны будут краснеть на каждом клике, а `CHECKSUM TABLE` пойдёт по миллиону строк:
```js
const NOISE_TABLES = new Set(["access_log", "access_days", "ui_events", "import_runs", "plan_presence",
  "plan_orders_presence", "ai_tasks_cache", "nav_route_cache", "nav_geo_cache", "theme_prefs", "ux_events"]);
```

### 5. `import/watchdog.js` - строка в `JOBS`
```js
  "ux-events-cleanup": { name: "очистка журнала действий (ux_events старше 90 дней)", days: [0, 1, 2, 3, 4, 5, 6], at: ["03:20"], grace: 30 },
```
(время в `JOBS` - МСК; cron ниже - UTC 00:20 = 03:20 МСК; к 03:50 МСК нет удачного запуска - одна
тревога директору в MAX.)

### 6. `.env` (необязательно - по умолчанию сбор включён, срок 90 дней)
```
UX_TRACK=on
UX_EVENTS_KEEP_DAYS=90
```
Выключить сбор: `UX_TRACK=off` + `./deploy.sh` (перезапуск нужен: `.env` читается при старте). Все
открытые вкладки получат `{enabled:false}` на следующей пачке и замолчат до закрытия вкладки; выкат
сайта не нужен. Включить обратно - убрать строку/`on` + `./deploy.sh`, вкладки начнут писать со
следующего открытия.

### 7. Юнит-тесты, коммит, деплой
```bash
cd /root/yard-dashboard
node api/lib/ux-events.test.js        # 10 проверок, без БД
node tests/unit.js
node import/ux-events-cleanup.js --dry  # «удалилось бы 0 строк» / «ux_events пуста»
git add api/lib/ux-events.js api/lib/ux-events.test.js api/server.js tests/golden/golden.js \
        import/watchdog.js import/ux-events-cleanup.js import/ux-events-schema.sql
git commit -m "feat(ux): журнал действий ux_events - POST /api/ux/batch, ночная очистка 90 дней (план 2026-09-26)"
./deploy.sh
```
Ожидается зелёное: новый маршрут не меняет ни одного существующего ответа. Красное = что-то не так
с подключением, а не «задумано» - `./deploy.sh --rollback`.

### 8. crontab (после удачного деплоя)
```bash
crontab -l > /root/backups/crontab-before-ux-cleanup-$(date +%F).txt
( crontab -l; echo '20 0 * * * cd /root/yard-dashboard/import && /usr/bin/node run-job.js ux-events-cleanup ux-events-cleanup.js >> /root/yard-dashboard/import/ux-cleanup-cron.log 2>&1' ) | crontab -
crontab -l | grep ux-events
```
Лог `import/ux-cleanup-cron.log` крутит существующий logrotate (`/root/yard-dashboard/import/*.log`).
Окно 00:20 UTC свободно (рядом: 01:00 бэкап, 02:40 суды, 03:10 риски).

### 9. Проверка живьём
```bash
# служебный запрос: пишется с flags=2, визит в журнал входов не засчитывается
node tests/as-user.js <свой email> /api/ux/batch '{"events":[{"k":"click","t":'$(date +%s%3N)',"seq":1,"sid":"probeprobeprobe1","page":"probe","target":"probe"}]}'
# -> {"ok":true,"enabled":true}
mysql yard_dashboard -e "SELECT id, email, role, sid, seq, client_ts, server_ts, page, kind, target, flags FROM ux_events ORDER BY id DESC LIMIT 5"
# повтор той же команды - строк не прибавилось (склейка по uq_event)
# убрать пробу - ТОЛЬКО по её sid, никаких DELETE без условия:
mysql yard_dashboard -e "DELETE FROM ux_events WHERE sid = 'probeprobeprobe1' AND flags & 2"
```
После выката сайта (второе открытие - service worker): свой клик -> строка в `ux_events` за ~5 с;
`seq` по порядку; `YardUx.stats()` в консоли браузера - цена клика; отключить сеть в DevTools,
покликать, включить - события дошли. Через сутки:
```sql
SELECT COUNT(DISTINCT email) people, COUNT(DISTINCT page) pages, COUNT(*) n FROM ux_events
 WHERE server_ts >= NOW() - INTERVAL 1 DAY AND NOT flags & 2;
SELECT kind, COUNT(*) FROM ux_events WHERE server_ts >= NOW() - INTERVAL 1 DAY GROUP BY kind;
SELECT val, target, COUNT(*) n FROM ux_events WHERE kind = 'js_error' AND server_ts >= NOW() - INTERVAL 1 DAY GROUP BY val, target ORDER BY n DESC LIMIT 20;
```
и `journalctl -u yard-api --since "1 day ago" | grep ux/batch` - пусто.

### 10. README сервера
```
## 2026-09-26 - Журнал действий ux_events («Гладкая работа», Фаза 1А) (<коммит>)
lib/ux-events.js - POST /api/ux/batch (checkSession; email/роль из сессии; до 100 событий; белый список
view/click/change/field/vis/js_error; текст полей не принимается - val только у change/vis/js_error;
служебные (X-Api-Key) - flags 2; повтор пачки склеивается uq_event (sid, seq, client_ts)). Таблица -
import/ux-events-schema.sql. Выключатель UX_TRACK=off в .env (+ ./deploy.sh) - клиенты замолкают без
выката сайта. Очистка: import/ux-events-cleanup.js через run-job.js, 00:20 UTC, сырьё 90 дней
(UX_EVENTS_KEEP_DAYS), под сторожем (JOBS). ux_events - в NOISE_TABLES эталонов. Клиент -
files/ux-track.js (index.html, plan-m.html, orders-m.html). Объём ~15-20 тыс. строк/день.
```

## Решить до/после выката (не блокирует)

- **Бэкапы.** Ночной `backup-db.js` дампит всю базу: сейчас ~7,9 МБ gzip, через 90 дней сбора
  `ux_events` (~1,5-2 млн строк) добавит, по грубой оценке, 20-40 МБ gzip к каждому дампу, а копии
  30 дней лежат ещё и на `D:\YardBackups`. Сырая аналитика - не деньги; можно дописать в mysqldump
  `--ignore-table=<db>.ux_events` (или отдельный недельный дамп). Решение за Владом.
- **Бинлог.** Ночное удаление ~15-20 тыс. строк пишется в бинлог построчно - единицы МБ в сутки, в
  пределах нормы (см. память про раздувание бинлогов).
- **Счётчик визитов.** `/api/ux/batch` проходит через `checkSession` -> `trackActivity_` (раз в
  минуту на человека). Пачка уходит только когда человек что-то делал, поэтому «последняя
  активность» станет точнее; но события, накопленные без связи, отметят активность в момент доставки.
- **Нагрузка.** ~20 вкладок × пачка раз в 5 с при активной работе = до ~4 запросов/с, один INSERT на
  запрос. Лимитов по частоте в nginx нет (проверено), `client_max_body_size 20m`. Если заметно -
  `UX_TRACK=off`.
- **JOIN по email** с `access_users`/`user_access`/`hire_events` (utf8mb4_unicode_ci) требует
  `COLLATE utf8mb4_unicode_ci` - см. шапку схемы.
