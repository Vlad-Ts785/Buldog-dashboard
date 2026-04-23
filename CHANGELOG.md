# Changelog

Все значимые изменения шаблона. Формат: [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/) + semver.

## [Unreleased]

### Планируется
- Loom-видео 60-90 секунд в README
- Альтернативные плейсхолдеры `marketing/funnel.md` и `products/pricing.md` под воронку услуг и прайс-лист (не только e-commerce/SaaS) - в v1.1.0
- Первый публичный релиз v1.0.0

## [0.5.0] - 2026-04-23

### Исправлено (P1 - non-commercial ветка после dry run)
- AUTOPILOT шаг 8 правило 7 теперь явно описывает что делать с каждым файлом в non-commercial режиме: заглушка «не применимо для некоммерческого проекта» с пояснением причины (`economics/unit-economics.md`, `economics/revenue.md`, `economics/forecast.md`, `marketing/funnel.md`, `marketing/competitors.md`, `assets/testimonials.md`). Пометка «(не применимо для некоммерческого)» в `INDEX.md`. Структура `.business/` остаётся целой - если проект перейдёт в коммерческий, достаточно заменить заглушки содержимым.
- `marketing/content.md` добавлен в список заполняемых для non-commercial (обучающие материалы для пользователей).

## [0.4.0] - 2026-04-23

### Исправлено (P0 - безопасность данных пользователя)
- README больше не утверждает что `.business/` защищена из коробки - чётко объясняет что `.business/` tracked в шаблоне, защита включается на 10a AUTOPILOT
- AUTOPILOT шаг 10a теперь выполняет `git rm -r --cached .business/` перед первым коммитом - иначе заполненные бизнес-данные попадали в историю git несмотря на `.gitignore`
- `retrospectives/README.md` больше не ссылается на несуществующий `HELLO-test.md` - указывает на `TEMPLATE.md`

### Исправлено (P1 - логика и честность)
- Удалён дубль `.business/execution/monthly.md` (единственный источник фокуса месяца - `goals/monthly.md`, обогащён секциями «связь с кварталом» и «итог месяца»)
- README: «20+ промптов» исправлено на фактические «16»
- Убрана ссылка на личный репо автора методологии из `prompts/setup/08-skills-install.md` - Bulletproof описан как опциональный без конкретного URL
- AUTOPILOT шаг 1: удалён неиспользуемый вопрос «Ты из России?» - теперь пассивное правило «если пользователь сам упомянул - напомни про VPN»
- Плейсхолдеры `.business/economics/unit-economics.md` и `.business/products/pricing.md` больше не предлагают «переименуй файл» - логика ветвления только в AUTOPILOT
- `.business/INDEX.md` больше не врёт про «не попадает в git» - честно описывает модель tracking + защита на 10a

### Исправлено (P2 - качество документации)
- Убраны em-dash (—) из README, CONTRIBUTING, CHANGELOG, TEST-PROTOCOL, templates/README, execution/README (правило из CONTRIBUTING теперь соблюдается)
- Удалены пустые папки `templates/plans/` и `templates/retrospectives/`
- README дополнен `.github/`, `scripts/`, `CONTRIBUTING.md`, `CHANGELOG.md`, `LICENSE` в дереве структуры

### Улучшено (P3)
- AUTOPILOT шаг 3: добавлен вариант «Другое - скажи мне какой стек» для Go/Rust/Elixir/.NET/Java
- AUTOPILOT шаг 5: формулировка «4 запрета = 9 regex» чтобы пользователь не удивлялся количеству строк в settings.json
- `CLAUDE.md` таблица «Где что искать» дополнена строками про `retrospectives/` и `.business/execution/`

## [0.3.0] - 2026-04-23

### Добавлено
- `scripts/security-audit.sh` - автоматическая проверка утечек перед публикацией
- `.github/workflows/security-audit.yml` - CI-проверка на каждый push
- `.github/hooks/pre-commit.sample` - защита пользователей шаблона от случайного коммита секретов
- `.business/execution/` - папка для еженедельного планирования с README, monthly.md, backlog.md, TEMPLATE-week.md

## [0.2.0] - 2026-04-23

### Добавлено
- 16 готовых промптов в `prompts/`:
  - `setup/` (9) - голосовой ввод, hooks, security, интервью, CLAUDE.md, plans, тест-цикл, skills с аудитом, Playwright
  - `launch/` (3) - GitHub, деплой, платежи
  - `methodology/` (4) - критика плана, «10 причин обосраться», импорт проекта, планирование недели

## [0.1.0] - 2026-04-23

### Добавлено
- Структура репо: `CLAUDE.md`, `AUTOPILOT.md`, `.business/` (7 подпапок), `plans/`, `retrospectives/`, `templates/`
- AUTOPILOT с 10 шагами онбординга, frontmatter-флагами, возобновлением после паузы, Reality Check
- CLAUDE.md с СТОП-инструкцией для автозапуска AUTOPILOT
- `.vscode/settings.json` для видимости `.business/`
- TROUBLESHOOTING.md со решениями типовых проблем
- `templates/CLAUDE.md.tmpl` для генерации под пользователя
- MIT LICENSE, README, .gitignore
