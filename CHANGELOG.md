# Changelog

Все значимые изменения шаблона. Формат: [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/) + semver.

## [Unreleased]

### Планируется
- Тестовые прогоны на 5 нишах (стоматология, B2B SaaS, агентство, внутренний tool, медиа)
- Loom-видео 60-90 секунд в README
- Первый публичный релиз v1.0.0

## [0.3.0] - 2026-04-23

### Добавлено
- `scripts/security-audit.sh` — автоматическая проверка утечек перед публикацией
- `.github/workflows/security-audit.yml` — CI-проверка на каждый push
- `.github/hooks/pre-commit.sample` — защита пользователей шаблона от случайного коммита секретов
- `.business/execution/` — папка для еженедельного планирования с README, monthly.md, backlog.md, TEMPLATE-week.md

## [0.2.0] - 2026-04-23

### Добавлено
- 16 готовых промптов в `prompts/`:
  - `setup/` (9) — голосовой ввод, hooks, security, интервью, CLAUDE.md, plans, тест-цикл, skills с аудитом, Playwright
  - `launch/` (3) — GitHub, деплой, платежи
  - `methodology/` (4) — критика плана, «10 причин обосраться», импорт проекта, планирование недели

## [0.1.0] - 2026-04-23

### Добавлено
- Структура репо: `CLAUDE.md`, `AUTOPILOT.md`, `.business/` (7 подпапок), `plans/`, `retrospectives/`, `templates/`
- AUTOPILOT с 10 шагами онбординга, frontmatter-флагами, возобновлением после паузы, Reality Check
- CLAUDE.md с СТОП-инструкцией для автозапуска AUTOPILOT
- `.vscode/settings.json` для видимости `.business/`
- TROUBLESHOOTING.md со решениями типовых проблем
- `templates/CLAUDE.md.tmpl` для генерации под пользователя
- MIT LICENSE, README, .gitignore
