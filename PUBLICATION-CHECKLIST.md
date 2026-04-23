# Публикация шаблона на GitHub - чеклист для автора

> Этот файл - инструкция для того, кто форкает или публикует этот шаблон под своей организацией. Пользователю, открывшему через «Use this template», этот файл не нужен - но не мешает, остаётся как образец пути «как форк превратить в свой template-репо».
>
> Замени в командах ниже `[YOUR-ORG]` и `[YOUR-REPO]` на свои значения. Для оригинального релиза использовались `smyslokoding/claude-code-starter`.

## Pre-flight

Перед любыми действиями на GitHub:

- [ ] `bash scripts/security-audit.sh` - всё зелёное (0 FAIL, WARN допустим если ты ожидаешь повышенное число упоминаний бренда)
- [ ] `git log --oneline` - история чистая, нет рабочих файлов с утечками
- [ ] `git tag | grep v1.0.0` - тег v1.0.0 создан локально
- [ ] `git status` - нет несохранённых изменений
- [ ] В директории нет `.env`, `.env.local`, `.claude/settings.local.json`

Если хоть один пункт не выполнен - не публикуй, сначала закрой.

## 1. Создание репозитория

```bash
# Проверь что авторизован в gh
gh auth status

# Создай публичный репозиторий (если организации нет - создай её через web)
gh repo create [YOUR-ORG]/[YOUR-REPO] \
  --public \
  --description "Стартовый шаблон для Claude Code: клонируй, напиши фразу, через 90-120 минут у тебя настроенная среда со вторым мозгом проекта"

# Свяжи локальный репо с GitHub-репо
git remote add origin git@github.com:[YOUR-ORG]/[YOUR-REPO].git
git branch -M main
git push -u origin main
git push --tags
```

## 2. Настройки репозитория

```bash
# Включить как Template
gh repo edit [YOUR-ORG]/[YOUR-REPO] --template

# Topics (для поисковой видимости)
gh repo edit [YOUR-ORG]/[YOUR-REPO] \
  --add-topic claude-code \
  --add-topic anthropic \
  --add-topic ai-agents \
  --add-topic template \
  --add-topic second-brain \
  --add-topic ai-coding \
  --add-topic vibecoding
```

Вручную через Settings:

- [ ] General → Template repository ✅
- [ ] General → Features: Issues ON, Discussions ON, Wiki OFF
- [ ] Branches → Default branch `main`

## 3. Release

```bash
gh release create v1.0.0 \
  --title "v1.0.0 - Initial public release" \
  --notes "См. [CHANGELOG.md](./CHANGELOG.md#100---YYYY-MM-DD)"
```

Проверь:

- [ ] README рендерится корректно
- [ ] Кнопка «Use this template» появилась
- [ ] `LICENSE` определился как MIT
- [ ] Тег v1.0.0 в разделе Releases
- [ ] Actions → Security Audit зелёный на first push

## 4. Loom-видео (60-90 секунд)

Замени плейсхолдер `https://www.loom.com/` в README.md на реальную ссылку после записи.

### Сценарий

- **0-10 сек.** «Шаблон claude-code-starter. За 90-120 минут получаешь настроенный проект со вторым мозгом.»
- **10-25 сек.** На экране: «Use this template» → имя проекта → открыл в VS Code → `.business/` видна в сайдбаре.
- **25-45 сек.** Claude Code, написал «привет». AUTOPILOT запустился с первой фразы.
- **45-70 сек.** Быстрые кадры: настройка hooks, генерация CLAUDE.md из интервью, тест-цикл HELLO.md + план + ретро.
- **70-85 сек.** Результат: заполненный `.business/`, CLAUDE.md под стек, 16 промптов, первый коммит.
- **85-90 сек.** CTA: если хочешь научиться думать на 2-3 уровне - приходи в практикум.

### Требования

- Никаких утечек в кадре (`.env`, SSH keys, Slack-уведомления, чужие проекты)
- Звук чистый
- После записи - `gh release edit v1.0.0 --notes` с ссылкой на видео

## 5. Анонс в сообществе

Шаблон поста (под любой канал: Telegram, LinkedIn, Twitter):

```
Выложил открытый шаблон Claude Code Starter - можно использовать на любом проекте.

Что это: клонируешь → открываешь в VS Code → пишешь одну фразу → через 90-120 минут у тебя настроенная среда.

Что внутри:
- AUTOPILOT из 10 шагов с возобновлением после паузы
- Второй мозг проекта (.business/) из 7 блоков интервью
- 16 готовых промптов под типовые задачи
- Цикл план → реализация → ретро с первым рабочим примером
- Безопасность: 4 категории запретов + pre-commit hook + CI security audit

Ссылка: https://github.com/[YOUR-ORG]/[YOUR-REPO]
Демо 90 сек: [LOOM LINK]
```

## 6. Первые 48 часов

- **Issues** - первый issue от внешнего = P0. Ответь за 6 часов.
- **Discussions** - повторяющиеся вопросы → FAQ в TROUBLESHOOTING.md
- **Actions** - security audit CI должен оставаться зелёным

### Типовые вопросы (готовые ответы)

1. «Не запускается AUTOPILOT» → проверь что `AUTOPILOT.md` не удалён, `completed: false`, в CLAUDE.md есть СТОП-блок
2. «Не вижу `.business/` в сайдбаре» → `.vscode/settings.json` с `"**/.business": false`, Cmd+Shift+P → Reload Window
3. «Можно ли с Codex / Gemini?» → TROUBLESHOOTING → Альтернативные окружения
4. «Скил Bulletproof - где взять?» → опциональный, конкретного URL нет - пропусти или найди форк через GitHub search
5. «Коммерческое использование?» → MIT, да
6. «Перенести существующий проект?» → `prompts/methodology/import-existing-project.md`
7. «Обновления шаблона?» → вручную через CHANGELOG, npx-апдейтер в v1.1.0

## 7. Не делать

- Не пушить `--force` в main - сломает форки
- Не удалять теги после релиза
- Не обещать фичи v1.1.0 под дедлайн - Unreleased без сроков
- Не отвечать на негатив эмоционально

## 8. Если пошло не так

Критичный баг P0 в первые часы:

```bash
git checkout -b hotfix/critical
# ... правки ...
bash scripts/security-audit.sh
git add -A && git commit -m "hotfix: описание"
git push origin hotfix/critical

git checkout main && git merge hotfix/critical
git tag v1.0.1 -m "Hotfix: критическое исправление"
git push && git push --tags
```

Если в history попал реальный секрет - см. TROUBLESHOOTING → «Случайно закоммитил .env» + **ротейт все скомпрометированные ключи**.

---

Удачи с запуском. После публикации - обнови раздел 6 по реальным вопросам пользователей.
