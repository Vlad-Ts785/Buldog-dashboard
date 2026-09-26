# Session replay, сигналы фрустрации, тепловые карты и UX-исследования: аналитика цифрового опыта (DXA, digital experience analytics) плюс качественные методы

Дата сбора: 26.09.2026. Устаревшие данные помечены годом. Где определение получено только из поисковой выдержки (страница вернула 403 или редирект), это оговорено.

## 1. Session replay (запись сессий): как это технически устроено у FullStory, Contentsquare (Hotjar, Heap), Clarity, LogRocket, PostHog и Вебвизора, что пишется, сколько стоит по ресурсам, как маскируются данные

### Takeaway
«Запись сессии» - это не видео, а запись DOM: полный снимок страницы плюс поток изменений (MutationObserver) и событий ввода, который плеер потом «проигрывает». Открытая библиотека rrweb (MIT) - фактический отраслевой стандарт (на ней PostHog, Sentry, Datadog, New Relic, Mixpanel, Amplitude). Цена: десятки КБ JS, +100...400 мс нагрузки на главный поток и сотни КБ исходящего трафика на сессию (замер Sentry). Поля ввода маскируются по умолчанию почти везде, а обычный текст на экране (ФИО, телефоны, суммы в таблицах) - как правило, НЕТ.

### Cited Findings
**Техническая основа**
- rrweb работает на трёх механизмах: snapshot (DOM сериализуется в структуру с уникальными id), MutationObserver (все изменения DOM записываются, несколько загрузок страниц склеиваются в одну запись), replay (восстановление снимка и проигрывание событий). Пакеты: rrweb-snapshot, record, replay, rrweb-player. Лицензия MIT, около 20.2k звёзд. Пользователи: PostHog, Datadog, Sentry, New Relic, Mixpanel, Amplitude. В разработке «token efficient AI session replay format» - [rrweb GitHub](https://github.com/rrweb-io/rrweb)
- Записи rrweb - многословный JSON с высокой избыточностью. Для сжатия есть `@rrweb/packer` (на fflate, около 17 КБ минифицированного кода; `packFn: pack` сжимает каждое событие). При этом сама документация рекомендует сжимать сессию целиком на бэкенде - коэффициент выше - [rrweb docs: Optimize storage](https://rrweb.com/docs/recipes/optimize-storage), [rrweb docs: @rrweb/packer](https://rrweb.com/docs/packages/packer/)
- LogRocket: реплей через MutationObserver плюс клики и скролл. По умолчанию перехватывает XMLHttpRequest и fetch - пишет «request and response data ... including status codes, headers, and bodies». Также console logs, Redux actions и state, метрики производительности (CPU/память, LCP, TTFB, long tasks, CLS) - [LogRocket: Data Collected](https://docs.logrocket.com/docs/data-collected)
- Как устроен приём записей у PostHog:
  - rrweb собирает изменения в пакеты `$snapshot_items` и отправляет на эндпоинт `/s/`;
  - дальше цепочка: Rust-сервис приёма -> Kafka -> Node.js-приёмник;
  - там записи пишутся в JSON построчно, каждая сессия сжимается Snappy, буфер сбрасывается каждые 10 с или при 100 МБ;
  - блоки лежат в S3, метаданные (число кликов и нажатий, активное время, console logs, посещённые URL) - в ClickHouse;
  - плеер качает блоки прямо из S3 по byte-range, через presigned URL со сроком жизни 60 с; старые записи удаляются по TTL.

  Источник - [PostHog Handbook: Session replay architecture](https://posthog.com/handbook/engineering/session-replay/session-replay-architecture)
- Clarity позиционируется как «Session Recordings, Heatmaps, ML Insights», скрипт асинхронный. Реализацию записи (в отличие от rrweb-инструментов) не раскрывает - [Microsoft Clarity FAQ](https://learn.microsoft.com/en-us/clarity/faq)
- Вебвизор записывает действия посетителей, включая заполнение полей форм. HTML-содержимое снимается в момент визита из браузера посетителя - [Яндекс: Подключение и настройка Вебвизора](https://yandex.ru/support/metrika/webvisor-v2/settings.html), [Яндекс: Требования и ограничения Вебвизора](https://yandex.ru/support/metrica/ru/webvisor/requirements.html)
- Вебвизор НЕ записывает: `audio`/`video`, содержимое `canvas`, Shadow DOM, стили, сгенерированные во время работы (runtime), iframe с другого домена (без особой настройки). Требования к страницам: UTF-8, соответствие W3C, хеш контента в именах CSS-файлов - [Яндекс: Требования и ограничения Вебвизора](https://yandex.ru/support/metrica/ru/webvisor/requirements.html)

**Производительность, объёмы, хранение**
- Замер Sentry: 50 прогонов на Apple M1, сценарий внутри самого Sentry (открыть Errors, добавить колонки, дождаться результатов). Медианные изменения с SDK записи:

  | Метрика | Изменение |
  |---|---|
  | LCP | -70 мс |
  | CLS | около 0 |
  | FID | +0.24 мс |
  | Total Blocking Time | +415 мс |
  | Max memory | -20 МБ |
  | Отправка (upload) | +268.67 КБ |

  Второй сценарий (4 страницы настроек) дал около +100 мс TBT. Разброс большой: стандартное отклонение LCP 386-511 мс. Прочие параметры SDK:
  - бандл около 36 КБ gzip (v7.78.0+);
  - DOM сжимается gzip на клиенте в фоновом Web Worker;
  - при мутации больше 750 узлов SDK пишет предупреждение, при 10 000+ узлов запись прекращается.

  Источник - [Sentry Docs: Session Replay performance overhead](https://docs.sentry.io/product/explore/session-replay/performance-overhead/). Sentry указан пользователем rrweb в [rrweb GitHub](https://github.com/rrweb-io/rrweb).
- Clarity (FAQ обновлён 21.09.2026):
  - заявлено «no perceivable impact»;
  - без выборки (сэмплинга), бесплатно «forever», без лимитов трафика;
  - до 100 000 сессий на проект в сутки;
  - записи хранятся 30 дней, «избранные» и случайная выборка - до 9 месяцев;
  - тепловая карта - до 100 000 просмотров;
  - данные лежат в Microsoft Azure.

  Источник - [Microsoft Clarity FAQ](https://learn.microsoft.com/en-us/clarity/faq)
- Вебвизор: «Данные хранятся 15 дней, включая текущий день». Число записываемых визитов определяет алгоритм «для репрезентативности выборки» и оно меняется со временем, то есть пишутся не все визиты - [Яндекс: Требования и ограничения Вебвизора](https://yandex.ru/support/metrica/ru/webvisor/requirements.html)

**Маскировка (privacy masking)**
- PostHog:
  - `maskAllInputs` включён по умолчанию («any input element is highly likely to contain sensitive text ... we mask these by default»);
  - обычный текст по умолчанию НЕ маскируется - маски задаются через `maskTextSelector`;
  - класс `ph-no-capture` исключает элемент из записи;
  - можно писать сетевые запросы и ответы, но их заголовки и тела бывают чувствительными; часть заголовков чистится автоматически.

  Источник - [PostHog Docs: Session replay privacy](https://posthog.com/docs/session-replay/privacy)
- У Clarity три режима маскировки. Содержимое полей ввода маскируется во всех режимах, и это нельзя отключить - [Microsoft Learn: Clarity masking](https://learn.microsoft.com/da-dk/clarity/clarity-masking), [Microsoft Learn: Clarity mobile masking](https://learn.microsoft.com/en-us/clarity/mobile-sdk/clarity-sdk-masking)

  | Режим | Что маскируется |
  |---|---|
  | Strict | весь текст и изображения |
  | Balanced (по умолчанию) | «чувствительный» текст: содержимое полей ввода, числа, email |
  | Relaxed | только поля ввода |

- Вебвизор: пароли не записываются никогда; поля с конфиденциальными данными (имена, фамилии) автоматически заменяются звёздочками. Ручное управление - CSS-классами - [Яндекс: Подключение и настройка Вебвизора](https://yandex.ru/support/metrika/webvisor-v2/settings.html)

  | Класс | Действие |
  |---|---|
  | `ym-record-keys` | разрешить запись содержимого поля |
  | `ym-disable-keys` | запретить запись поля (звёздочки) |
  | `ym-hide-content` | не записывать элемент (серый блок, размытый текст) |
  | `ym-show-content` | разрешить запись внутри скрытого элемента |

- Matomo Heatmap & Session Recording: маскирует/анонимизирует персональные данные в полях форм; запись нажатий клавиш отключается для чувствительных полей - [Matomo Plugins: Heatmap & Session Recording](https://plugins.matomo.org/HeatmapSessionRecording)

**Рынок (консолидация)**
- Contentsquare купил Hotjar в 2021 году, а Heap - в 2023-м: соглашение 28.09.2023, сделка закрыта 07.12.2023 - [Contentsquare: соглашение о покупке Heap](https://contentsquare.com/press/contentsquare-signs-agreement-acquire-heap/), [Contentsquare: сделка с Heap закрыта](https://contentsquare.com/press/contentsquare-completes-acquisition-heap/), [Contentsquare vs Hotjar](https://contentsquare.com/blog/contentsquare-vs-hotjar/)
- Hotjar вливается в Contentsquare (изменения биллинга и юридические) - [Hotjar Documentation: Hotjar is merging into Contentsquare](https://help.hotjar.com/hc/en-us/articles/36819964438545-Hotjar-is-merging-into-Contentsquare-Billing-and-Legal-changes). Наблюдение при сборе 26.09.2026: страница обновлений hotjar.com отвечает 301-редиректом на contentsquare.com/hotjar.

### Inferences
- Если графики дашборда рисуются на `<canvas>`, в Вебвизоре на их месте будут пустые области: canvas не пишется.
- Запись DOM значит, что всё видимое на экране CRM (ФИО клиентов, телефоны, суммы) попадает в хранилище поставщика, если это явно не замаскировано. Маскировка полей ввода по умолчанию текст в таблицах не закрывает: у PostHog это прямо сказано, у Clarity Balanced закрывает частично (числа и email).
- Нагрузка ненулевая: +100...415 мс TBT в замере Sentry. На тяжёлом одностраничном интерфейсе с большими таблицами и частыми перерисовками риск выше - там же есть потолок мутаций (10 000 узлов), после которого запись обрывается.
- Короткие сроки хранения (Вебвизор 15 дней, Clarity 30) и сэмплинг Вебвизора плохо подходят для разбора конкретного обращения сотрудника («у меня вчера не сохранилось»): нужная сессия может не записаться или уже удалиться.

### Gaps
- Не нашёл первоисточник с типичным размером записи (МБ в минуту) для rrweb или PostHog - только общее «сжатие на порядок».
- FullStory и Contentsquare не публикуют, как устроена запись у них.
- Опцию записи canvas в rrweb (`recordCanvas`) в этом сборе не проверял по документации.

## 2. Сигналы фрустрации и трения: точные определения у FullStory, Contentsquare, Clarity, Hotjar и методики «frustration score»

### Takeaway
Базовый набор сигналов почти у всех один:
- rage click (серия быстрых кликов), dead click (клик без реакции), error click (клик перед ошибкой), thrashed cursor (хаотичная мышь);
- excessive scrolling (избыточный скролл) и quick back (быстрый возврат) - у Clarity;
- u-turn (разворот) - у Hotjar и Contentsquare;
- повторное нажатие кнопки или повторный ввод в поле, ошибки JS и API.

Числовые пороги публикует только Hotjar (5 кликов за 500 мс; u-turn - возврат за 7 с), и то их удалось увидеть лишь в поисковых выдержках. Интегральные оценки (Contentsquare Frustration score 1-100, Hotjar frustration score) - проприетарные: у Contentsquare это ML-модель, формула - коммерческая тайна.

### Cited Findings
- **FullStory** - [FullStory Help: Frustration Signals](https://help.fullstory.com/hc/en-us/articles/360020624154-Rage-Clicks-Error-Clicks-Dead-Clicks-and-Thrashed-Cursor-Frustration-Signals):
  - Rage Clicks: «clicking or tapping multiple times, rapidly, in the same area». Числового порога нет. Навигационные элементы дают ложные срабатывания, такие элементы можно «заглушить» по CSS-селектору ([FullStory: исключение элементов из Rage/Dead Clicks](https://help.fullstory.com/hc/en-us/articles/360020622734-Prevent-elements-from-being-classified-as-Rage-or-Dead-Clicks-via-Fullstory-Settings-or-via-code)).
  - Dead Clicks: «If nothing on the page changes within a few seconds of a click or tap».
  - Error Clicks: клик или тап непосредственно перед клиентской JS-ошибкой или ошибкой консоли. Без включённого Console Data Capture не работают.
  - Thrashed Cursor: только десктоп - мышь движется хаотично или кругами. Трактуется как растерянность или ожидание загрузки.
- **FullStory Ragehooks**: в браузере генерируется CustomEvent `fullstory/rageclick` с таймстемпами и ссылкой на реплей. На него можно повесить локальный сценарий в момент «ярости» - подсказку, уведомление поддержки. Документация предупреждает, что событие можно подделать - [FullStory Developer: Rage Click](https://developer.fullstory.com/browser/rage-clicks/), [FullStory Help: Ragehooks](https://help.fullstory.com/hc/en-us/articles/360052984354-Ragehooks)
- **Microsoft Clarity** (страница обновлена 12.2025) - [Microsoft Learn: Clarity semantic metrics](https://learn.microsoft.com/en-us/clarity/insights/semantic-metrics):
  - Rage clicks: несколько кликов в кластерной области в быстрой последовательности.
  - Dead clicks: клик без обратной связи «in a reasonable amount of time» - визуальное состояние не меняется, перехода нет. Причины - сломанные элементы, долгие запросы, вводящий в заблуждение интерфейс.
  - Excessive scrolling: вертикального скролла больше ожидаемого среднего.
  - Quick backs: уход на другую страницу и возврат быстрее порога, где порог - dwell time (время пребывания) этой страницы. Обещано, что порог будет подстраиваться под сайт.
  - Click errors: JS-ошибка сразу после клика, сессия автоматически помечается тегом.
  - Инсайт «Inactive pages» показывает страницы почти без взаимодействий.
- **Hotjar** - [Hotjar Blog: 8 Ways Hotjar Helps You Uncover Issues](https://www.hotjar.com/blog/uncover-issues-prioritize-fixes/), [Hotjar Docs: Use Cases for Filtering Recordings](https://help.hotjar.com/hc/en-us/articles/36820019361041-Use-Cases-for-Filtering-Recordings); определения получены из поисковых выдержек, страницы при прямом запросе вернули 403 или редирект:
  - rage click: клик по одному и тому же элементу 5 раз за 500 мс;
  - u-turn: возврат на предыдущий URL в течение 7 секунд;
  - frustration score считается для каждой записи из u-turns, rage clicks и негативного фидбека пользователя; список записей можно сортировать по нему.
- **Contentsquare**:
  - u-turn: переход в новую часть сайта и немедленный возврат (плохо подписанное меню, битая ссылка). Rage clicks: быстрые многократные клики - [Contentsquare Guide: Behavior analytics metrics](https://contentsquare.com/guides/behavior-analytics/metrics/), [Contentsquare Blog: Rage clicks](https://contentsquare.com/blog/rage-clicks-what-are-they-and-how-to-avoid-them/)
  - Frustration score (шкала 1-100): ML-алгоритм, обученный на сессиях с реальным фидбеком пользователей, дерево решений по всем видам трения. Формула - коммерческая тайна. В ленте событий реплея из трения показываются только Rage clicks, Multiple Button Interaction, Multiple Field Interaction и JS Errors - [Contentsquare Help: Frustration score](https://support.contentsquare.com/hc/en-us/articles/37271767248273-Frustration-score), [Contentsquare Blog: AI-based user frustration score](https://contentsquare.com/blog/ai-based-user-frustration-score/), [Contentsquare: Frustration Score](https://contentsquare.com/platform/capabilities/frustration-score/). Получено через поисковые выдержки: справка Contentsquare при прямом запросе вернула 403.

### Inferences
- Как сигналы индустрии соотносятся с существующим журналом `ui_events` клиента:
  - `blocked_click` (клик по неактивной кнопке) - близкий родственник dead click, только дешевле: не нужен MutationObserver, заранее известно, что элемент disabled;
  - `save_error` - аналог error click и ошибки API;
  - `empty_search` - классический сигнал поисковой аналитики (в перечнях DXA-вендоров отдельно не фигурирует).
- Чего в журнале нет, хотя это дёшево посчитать на клиенте без записи экрана - одно событие на факт:
  - rage click: N кликов в малом радиусе за короткое окно; порог Hotjar 5 за 500 мс - разумная отправная точка;
  - dead click: клик по интерактивному элементу без изменения DOM, навигации или сетевого запроса за 1-3 с (FullStory: «несколько секунд»);
  - u-turn / quick back: открыл раздел и ушёл быстрее ~7 с;
  - повторная отправка после `save_error`.
- Интегральный «frustration score» при ~20 пользователях избыточен: ML-оценки Contentsquare обучены на больших потоках. Полезнее смотреть сигналы поштучно, в разрезе «экран × человек × день».
- Ложные срабатывания надо исключать заранее по селектору, как это делает FullStory: у внутреннего инструмента к ним склонны кнопки «обновить», пагинация, степперы «+/-».

### Gaps
- FullStory и Clarity не публикуют числовые пороги rage/dead click. Пороги Hotjar подтверждены только поисковыми выдержками, а не полным текстом страницы.
- Методики «struggle score» других вендоров (Quantum Metric, Glassbox) и точные определения «form abandonment» в аналитике форм Contentsquare и Hotjar не собраны.
- «Аналитика форм» Вебвизора упоминается в его настройках, но её метрики в этом сборе не изучены.

## 3. Тепловые карты: click, scroll, move/attention, зонирование Contentsquare; полезны ли они внутреннему инструменту с малым числом пользователей

### Takeaway
Тепловые карты - агрегатный инструмент, рассчитанный на объём: Clarity строит их до 100 000 просмотров, количественные UX-выводы по NN/g требуют около 40 человек. Во внутреннем инструменте с 10-20 пользователями пиксельная карта - это сумма привычек нескольких человек, которую легко перекашивают 1-2 самых активных. Практичнее считать клики по зонам/элементам (подход зонирования Contentsquare) из собственного журнала событий.

### Cited Findings
- Clarity:
  - сводки по картам: last clicks, first clicks, rage clicks, dead clicks, scroll;
  - лимит - до 100 000 просмотров на карту;
  - показываемые данные зависят от «sample impression», из-за чего часть собранного не отображается, а картинки на карте могут отсутствовать.

  Источник - [Microsoft Clarity FAQ](https://learn.microsoft.com/en-us/clarity/faq)
- Contentsquare Zoning Analysis: страница автоматически делится на зоны по структуре `div` (кнопки, баннеры, меню, формы). Для каждой зоны считаются метрики, результат накладывается прямо на элементы вместо «точек» - [Contentsquare Help: Introduction to Zoning Analysis](https://support.contentsquare.com/hc/en-us/articles/37271709566609-Introduction-to-Zoning-Analysis), [Contentsquare Guide: Zone-based heatmaps](https://contentsquare.com/guides/heatmaps/zone-based-heatmaps/)
  - attractiveness rate, click rate, hover rate;
  - exposure rate, exposure time;
  - engagement rate, hesitation time;
  - conversion rate per hover.
- Matomo Heatmap & Session Recording: карты кликов, движения мыши (hover) и скролла, отдельно для десктопа, планшета и мобильных, метрика «above the fold» (первый экран) - [Matomo Plugins: Heatmap & Session Recording](https://plugins.matomo.org/HeatmapSessionRecording)
- Яндекс Метрика: «Вебвизор, карта скроллинга, аналитика форм» включаются одним переключателем - [Яндекс: Подключение и настройка Вебвизора](https://yandex.ru/support/metrika/webvisor-v2/settings.html)
- NN/g рекомендует около 40 участников для количественных исследований: это даёт погрешность около 15% при доверии 95%. Расчёт исходит из генеральной совокупности больше 500 человек и бинарной метрики (успех/конверсия) - [NN/g: How Many Participants for Quantitative Usability Studies](https://www.nngroup.com/articles/summary-quant-sample-sizes/), [NN/g: Why 5 Participants Are Okay in a Qualitative Study, but Not in a Quantitative One](https://www.nngroup.com/articles/5-test-users-qual-quant/)

### Inferences
- При 10-20 пользователях статистика «выборки» теряет смысл: у внутреннего инструмента наблюдается вся генеральная совокупность (сплошное наблюдение), а не выборка. Цифры по кликам точны как факт, но плохо обобщаются: один новый менеджер может перевернуть картину.
- Внутренний инструмент используют повторно и ежедневно, поэтому просмотров на человека много. Карта кликов полезна, чтобы найти неиспользуемые элементы - аналог инсайта Clarity «Inactive pages». Хуже она подходит, чтобы понять, почему что-то сложно.
- Пиксельные карты ломаются на адаптивной вёрстке и разных ширинах экрана (клиент уже логирует viewport). Счётчик кликов по `data-`атрибуту элемента устойчив к смене вёрстки и по сути повторяет зонирование Contentsquare.

### Gaps
- Не нашёл первичных исследований именно о пользе тепловых карт для внутренних или корпоративных инструментов с малым числом пользователей.

## 4. Практика UX-исследований для внутренних и корпоративных инструментов с малой аудиторией: юзабилити-тесты, контекстное исследование, SUS/SEQ/UMUX-Lite, наблюдение, микроопросы, триангуляция

### Takeaway
Для малой аудитории основной инструмент - качественные методы: 3-5 человек на роль, наблюдение в реальной работе (contextual inquiry), итерации «тест -> правка -> тест». Количественную часть дают стандартизированные короткие опросники:
- SUS - 10 вопросов, работает даже на очень малых выборках;
- SEQ - 1 вопрос после задачи;
- UMUX-Lite - 2 вопроса, коррелирует с SUS.

Лучшие практики (NN/g, GitLab, Google HEART) сходятся на триангуляции: цифры показывают «что», наблюдение и интервью объясняют «почему». GitLab прямо встраивает в опрос SUS приглашение на интервью.

### Cited Findings
- **NN/g, «5 пользователей» (статья 2000 года - устаревшая, но базовая)** - [NN/g: Why You Only Need to Test with 5 Users](https://www.nngroup.com/articles/why-you-only-need-to-test-with-5-users/):
  - модель Nielsen & Landauer: доля найденных проблем = N(1-(1-L)^n); при типичном L = 31% пять человек находят около 85% проблем;
  - вместо одного теста на 15 человек рекомендовано три теста по 5 с правками между ними;
  - исключения: количественные исследования - 20+ человек (позже NN/g перешла на 40, см. раздел 3), card sorting - 15;
  - при разных группах пользователей - 3-4 человека на группу для двух групп и по 3 на группу для трёх и более.
- **NN/g, контекстное исследование (contextual inquiry)**: вид этнографического полевого исследования - наблюдение и интервью на малой выборке в естественной рабочей среде. Особенно подходит для сложных систем, глубоких процессов и опытных пользователей. Можно проводить удалённо, если участник показывает рабочую среду по видеосвязи - [NN/g: Contextual Inquiry](https://www.nngroup.com/articles/contextual-inquiry/), [NN/g: Remote Contextual Inquiry](https://www.nngroup.com/articles/remote-contextual-inquiry/), [NN/g: Field Studies](https://www.nngroup.com/articles/field-studies/)
- **NN/g, триангуляция** (Kathryn Whitenton, 21.02.2021) - [NN/g: Triangulation](https://www.nngroup.com/articles/triangulation-better-research-results-using-multiple-ux-methods/), [NN/g: Mixed-Methods Research](https://www.nngroup.com/articles/mixed-methods-research/):
  - определение: «using multiple sources of data or multiple approaches to analyzing data, to enhance the credibility»;
  - примеры: низкое заполнение форм (количественно) -> качественное исследование проблемных полей; высокий процент ошибок в аналитике -> сверка с обращениями в поддержку;
  - больше вкладываться в триангуляцию стоит при крупных решениях, простые обратимые решения требуют минимальной проверки.
- **SUS (System Usability Scale)**, MeasuringU, статья 2011 года - [MeasuringU: Measuring Usability with the SUS](https://measuringu.com/sus/):
  - 10 утверждений, 5 вариантов ответа, итог по шкале 0-100;
  - среднее по 500 исследованиям - 68 (50-й процентиль); 74 - около 70-го процентиля (B-); выше 80.3 - «A» (верхние 10%); ниже 51 - «F» (нижние 15%);
  - работает на очень малых выборках («as few as two users») и даёт надёжные результаты, но оценка для всей совокупности при этом неточная;
  - надёжнее самодельных анкет.
- **SEQ (Single Ease Question)** - [MeasuringU: 10 Things to Know About the SEQ](https://measuringu.com/seq10/):
  - формулировка «Overall, how difficult or easy was the task to complete?», шкала из 7 пунктов, задаётся сразу после задачи;
  - историческое среднее по 400+ задачам и 10 000 пользователей - 5.3-5.6 (обновлено в мае 2019);
  - корреляция с успешностью и временем выполнения - около r = 0.5;
  - при оценке ниже 5 рекомендуется спросить «почему» - это сразу даёт диагностику.
- **UMUX-Lite** (Lewis, Utesch, Maher, CHI 2013) - [ACM DL: UMUX-LITE](https://dl.acm.org/doi/abs/10.1145/2470654.2481287), [MeasuringU: How to Estimate SUS Using the UX-Lite](https://measuringu.com/how-to-estimate-sus-with-ux-lite/), [Springer: Correspondence Between UMUX-LITE and SUS](https://link.springer.com/chapter/10.1007/978-3-319-20886-2_20):
  - два утверждения: «This system's capabilities meet my requirements» и «This system is easy to use»;
  - корреляция с SUS - 0.81, надёжность - 0.82-0.83;
  - через регрессию пересчитывается в шкалу SUS, средняя разница - около 1.1 балла.
- **GitLab** - [GitLab Handbook: System Usability Scale](https://handbook.gitlab.com/handbook/product/ux/performance-indicators/system-usability-scale/), [GitLab Handbook: SUS responder outreach](https://handbook.gitlab.com/handbook/product/ux/performance-indicators/system-usability-scale/sus-outreach/); содержание - из поисковых выдержек, сама страница handbook отдала только навигацию:
  - SUS - показатель эффективности UX-отдела, внедрён с FY20-Q1;
  - опрос рассылается пользователям SaaS и Self-Managed, 10 вопросов плюс открытый вопрос;
  - каждый квартал в опрос добавляется вопрос «готовы ли обсудить ответы с сотрудником GitLab» - так опрос выводит на интервью.
  - Отдельно у GitLab есть страница опроса удовлетворённости USAT - [GitLab Handbook: USAT](https://handbook.gitlab.com/handbook/product/ux/performance-indicators/usat); заменил ли он SUS, не проверено.
- **Google HEART** (Kerry Rodden, Hilary Hutchinson, Xin Fu, CHI 2010): метрики Happiness, Engagement, Adoption, Retention, Task success плюс процесс Goals-Signals-Metrics (цель -> сигнал -> метрика) для связи целей продукта с измерениями - [Google Research: Measuring the User Experience on a Large Scale](https://research.google/pubs/measuring-the-user-experience-on-a-large-scale-user-centered-metrics-for-web-applications/), [Kerry Rodden: The HEART framework](https://kerryrodden.com/heart/)
- **Intuit «Follow Me Home»**: основатель Скотт Кук начал практику наблюдения за клиентами у них дома в момент использования Quicken; по вторичным источникам - с 1989 года, и сейчас каждого сотрудника просят сходить на такой визит - [Intuit Blog: Design for Delight](https://www.intuit.com/blog/life-at-intuit/design-for-delight-building-deep-customer-empathy-to-solve-any-problem/), [Fast Company: Listener Runner-up: Intuit](https://www.fastcompany.com/54246/listener-runner-intuit)

### Inferences
- Для внутреннего инструмента с тремя ролями (менеджеры, логисты, механики) правило NN/g для нескольких групп даёт 3 человека на роль за раунд - то есть почти всю команду логистов. Наблюдение по сути сплошное.
- Недорогой цикл триангуляции поверх существующего `ui_events`:
  1. Сигнал (например, всплеск `save_error` у конкретного человека на конкретном экране).
  2. 10-15 минут наблюдения или разговора с этим человеком («покажи, как ты это делаешь» - контекстное исследование, «Follow Me Home» в миниатюре).
  3. Правка.
  4. Проверка, что сигнал упал.

  Это воспроизводит логику NN/g «что -> почему» и приём GitLab «опрос -> интервью».
- SEQ после ключевых задач (1 вопрос, 1-7) и UMUX-Lite раз в квартал (2 вопроса) дешевле SUS и лучше подходят для частого замера у 20 человек. SUS - для редкого базового замера, есть внешний ориентир «68».
- При 10-20 респондентах среднее SUS или UMUX-Lite неточно как оценка, но годится для динамики «до и после» у тех же людей. Открытый вопрос важнее самого балла.

### Gaps
- Рекомендации Atlassian и Microsoft по исследованиям внутренних инструментов не собраны.
- Статьи NN/g о дневниковых исследованиях (diary studies) не прочитаны.
- Первоисточников о NPS/CSAT именно для внутренних инструментов не найдено.
- Более поздние оговорки Нильсена к правилу 5 пользователей (после 2000) не извлечены.

## 5. Self-hosted и open-source варианты для небольшой компании на своём VPS (rrweb, OpenReplay, PostHog, Matomo) и российские варианты (Вебвизор) с юридическими ограничениями

### Takeaway
По ресурсам варианты сильно различаются:
- полноценные self-hosted платформы тяжёлые: PostHog - от 4 vCPU / 16 ГБ RAM, стек ClickHouse + Kafka, официально «unsupported»; OpenReplay - от 2 vCPU / 8 ГБ / 50 ГБ;
- лёгкие: голый rrweb (MIT) со своим эндпоинтом и хранилищем или платный плагин Matomo (PHP + MySQL).

С юридической стороны: с 01.07.2025 (23-ФЗ) первичный сбор персональных данных граждан РФ в иностранные базы запрещён, а Clarity хранит данные в Azure. Вебвизор держит данные в России, но отдаёт всё видимое на экране (включая CRM) третьей стороне, хранит 15 дней и пишет не все визиты.

### Cited Findings
- rrweb - библиотека под MIT, а не сервис: хранилище и бэкенд нужны свои. Сжатие рекомендуют делать на бэкенде по сессии целиком - [rrweb GitHub](https://github.com/rrweb-io/rrweb), [rrweb docs: Optimize storage](https://rrweb.com/docs/recipes/optimize-storage)
- PostHog self-hosted - [PostHog Docs: Self-host](https://posthog.com/docs/self-host):
  - минимум - «Hetzner VM with 4 vCPU, 16GB RAM, and more than 30GB storage»;
  - self-hosted «officially unsupported», вся ответственность на пользователе;
  - поддерживается только hobby-развёртывание через Docker Compose, Kubernetes больше не поддерживается;
  - стек: ClickHouse, Kafka, Zookeeper, PostgreSQL, Redis, MinIO; лицензия MIT;
  - CVE для self-hosted не публикуются, рекомендуют всегда держать последний образ.
- OpenReplay - [OpenReplay Docs: Deploy with Docker](https://docs.openreplay.com/en/deployment/deploy-docker/):
  - минимум 2 vCPU, 8 ГБ RAM, 50 ГБ диска, x86; для малой и средней нагрузки советуют t3.large или аналог;
  - развёртывание: Docker Compose (экспериментально), Kubernetes, Ubuntu, из исходников;
  - нужны Ubuntu 20.04, публичный IP и домен.
- Matomo:
  - ядро On-Premise бесплатное (GPL); Heatmap & Session Recording - премиум-плагин под InnoCraft EULA с годовой подпиской;
  - тарифы по числу пользователей: 1-4 (до 5 млн хитов в месяц), 5-15, 20, 50, безлимит; пробный период 30 дней;
  - совместимость с Matomo 5.x (есть варианты для 4.x и 6.x), сырые данные лежат в своём MySQL.

  Источник - [Matomo Plugins: Heatmap & Session Recording](https://plugins.matomo.org/HeatmapSessionRecording). Цены «€199/год за карты, €149/год за записи» - только из вторичного источника, не проверены: [opensource-analytics.com](https://opensource-analytics.com/matomo-heatmaps/)
- Microsoft Clarity: бесплатно, данные хранятся в Microsoft Azure. Для ЕЭЗ, Великобритании и Швейцарии требуется передача согласия (consent API), без согласия сессии фрагментируются - [Microsoft Clarity FAQ](https://learn.microsoft.com/en-us/clarity/faq)
- Вебвизор (Яндекс Метрика): хранение 15 дней, пишется алгоритмическая выборка визитов, HTML снимается из браузера посетителя, canvas и Shadow DOM не пишутся - [Яндекс: Требования и ограничения Вебвизора](https://yandex.ru/support/metrica/ru/webvisor/requirements.html)
- 152-ФЗ - [Лидингс: локализация ПДн с 01.07.2025](https://www.lidings.com/ru/media/legalupdates/localization_pd_update/), [law.ru: запрет хранения ПДн за границей](https://www.law.ru/article/28545-zapret-na-hranenie-personalnyh-dannyh-za-granitsey-s-1-iyulya-2025-goda), [Comply.ru: Локализация с 1 июля 2025](https://comply.ru/tpost/c43ezsout1-lokalizatsiya-i-transgranichnaya-peredac):
  - Федеральный закон от 28.02.2025 № 23-ФЗ (в силе с 01.07.2025) дал новую редакцию ч. 5 ст. 18: запрещены «запись, систематизация, накопление, хранение, уточнение...» персональных данных граждан РФ с использованием иностранных баз данных при сборе;
  - штрафы по ч. 8 ст. 13.11 КоАП - до 6 млн руб. впервые, до 18 млн руб. повторно.
- В рыночных публикациях утверждается, что с 01.07.2025 Google Analytics на российских сайтах «запрещён», а Яндекс Метрика рекомендуется, потому что её серверы в РФ. Сама формулировка публикации vc.ru - «правда или миф?», то есть вопрос дискуссионный - [vc.ru: Запрет Google Аналитики с 1 июля 2025](https://vc.ru/marketing/2036972-zapret-google-analitiki-v-rossii-s-1-iyulya-2025-goda)

### Inferences
- Полноценный self-hosted PostHog (16 ГБ RAM, ClickHouse + Kafka) заметно тяжелее типичного небольшого VPS, где уже работают API и MySQL. Для 20 пользователей это непропорционально.
- Реалистичная лестница по нарастанию тяжести:
  1. Расширить собственный журнал событий (rage/dead click и u-turn считаются на клиенте, запись экрана не нужна).
  2. rrweb по запросу: запись включается только на конкретном экране или у согласившегося человека на ограниченное время, маска `maskAllInputs` плюс блокировка таблиц с ПДн. Сжатые блобы - на диск, индекс - в MySQL, TTL 7-30 дней.
  3. Matomo HSR (PHP + MySQL).
  4. OpenReplay или PostHog - только при отдельном сервере.
- Clarity на внутренней CRM с ПДн клиентов и сотрудников на экране, по всей видимости, противоречит локализации по 23-ФЗ: данные при сборе попадают в иностранное хранилище (Azure). Нужна оценка юриста.
- Вебвизор снимает вопрос локализации, но передаёт содержимое экранов CRM (ФИО, телефоны клиентов) третьему лицу, Яндексу. Сэмплинг визитов и срок 15 дней не гарантируют запись нужной сессии. Canvas-графики не запишутся.
- Даже self-hosted запись экранов конкретных сотрудников - это обработка их персональных данных и мониторинг работы. Вероятно, нужен локальный акт и уведомление сотрудников: не проверено, см. Gaps.

### Gaps
- Не исследовано по первоисточникам:
  - требования трудового права РФ к мониторингу действий сотрудников на экране (ТК РФ, согласия, локальные акты);
  - позиция Роскомнадзора о том, являются ли записи сессий персональными данными;
  - пользовательское соглашение Яндекс Метрики о передаче ПДн через Вебвизор.
- Российские self-hosted DXA-продукты и практические статьи Хабра о своей инсталляции rrweb для внутренних систем поиском не найдены.
- Реальное потребление ресурсов OpenReplay и PostHog на нагрузке в 20 пользователей нигде не задокументировано - есть только минимальные требования.

## 6. Задокументированные кейсы, где запись сессий или сигналы фрустрации нашли конкретные проблемы во внутренних или B2B-инструментах

### Takeaway
В рамках бюджета поиска не найдено ни одного первичного, проверяемого кейса с цифрами именно для внутреннего или back-office инструмента. Опубликованные истории вендоров в основном про e-commerce и конверсию. Для внутренних систем доказательная база - это общие методические источники (NN/g, Intuit) и маркетинговые материалы вендоров.

### Cited Findings
- У FullStory есть раздел историй клиентов из SaaS, но проверяемого B2B-кейса «нашли rage/dead clicks -> исправили -> цифра» в нём не найдено - [FullStory: SaaS Customer Stories](https://www.fullstory.com/customer-story/saas/)
- У LogRocket есть представление Issues (Severe Issues, Dead Clicks, оповещения), где dead и rage clicks помечаются автоматически. Источник вторичный - обзор Userpilot - [Userpilot: Should You Use LogRocket for Session Replay?](https://userpilot.com/blog/logrocket-session-replay/)
- Sentry публикует замер нагрузки записи сессий на собственном B2B-приложении. Это кейс про нагрузку, а не про найденные UX-проблемы - [Sentry Docs: Session Replay performance overhead](https://docs.sentry.io/product/explore/session-replay/performance-overhead/)
- Intuit «Follow Me Home» - долговременная практика наблюдения за реальным использованием продукта; кейс качественного, а не количественного метода - [Intuit Blog: Design for Delight](https://www.intuit.com/blog/life-at-intuit/design-for-delight-building-deep-customer-empathy-to-solve-any-problem/)

### Inferences
- Истории успеха DXA-вендоров - маркетинг, и почти все они из e-commerce, где высокий трафик позволяет агрегатной статистике работать. Их выводы нельзя напрямую переносить на систему с 20 пользователями.
- Для внутреннего инструмента сильнее всего работает связка «точечный сигнал -> конкретный человек -> разговор или наблюдение»: пользователь известен по имени и доступен.

### Gaps
- Не найдены первичные кейсы с количественными результатами для внутренних или back-office систем (CRM, ERP, диспетчерские). Для поиска нужны отдельные запросы по кейсам Clarity (clarity.microsoft.com/case-studies), PostHog и OpenReplay; в этом сборе они не открывались.
- Российские кейсы (Хабр, vc.ru) про запись сессий во внутренних системах поиском не найдены.
