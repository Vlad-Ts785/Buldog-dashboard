# Паспорт + водительское удостоверение в карточке сотрудника, хаб «Справочники»

**Дата:** 2026-09-13. Влад: собрать сканы паспорта и ВУ с Google Диска для ДЕЙСТВУЮЩИХ
рассаженных водителей, аккуратно обрезать (как СТС 30.08 - из двух страниц в одну),
прикрепить к карточке в Справочниках; дополнить паспортными данными и пропиской; само меню
«Справочники» перевести на паттерн полноэкранного хаба (как «Зарплата», 11.09).
Подтверждено: полный набор паспортных полей (серия/номер/кем выдан/дата выдачи/код
подразделения), доводить автономно до финального деплоя (база на VPS + временный Apps
Script для чтения Диска + push в main).

## Что уже есть (не переизобретать)

- `sprav_people` уже хранит `license_number`/`license_expiry`/`medical_expiry`/`address`
  (прописка) - НЕ добавлять повторно, только паспортные поля.
- Паттерн «скан + карточка» уже реализован для техники (СТС, `plans/2026-08-30-sts-document-
  import.md`): `sprav_asset_documents` (метаданные в MySQL, файлы на диске VPS
  `/root/yard-dashboard/uploads/sprav_assets/`), 4 эндпоинта (`asset_document_upload`/
  `asset_documents`/`asset_document_file`/`asset_document_delete`), фронт - `asset-docs-
  section`/`assetDocsLoad_`/`assetDocsPaint_`/`assetDocUpload_`/`assetDocDelete_`
  (`files/index.html` ~4628 и ~14420-14610). Повторяю 1-в-1 для людей.
- `.mp-drawer`/`.mp-drawer-bk` - уже стандартный выезжающий справа скруглённый drawer
  (`drv-reg-drawer` и есть та самая форма сотрудника) - НЕ новый компонент.
- Хаб-паттерн уже в ГОСТе (DESIGN_SYSTEM.md разд. 4, `.hub-sec-title`/`.hub-grid`/`.hub-tile`),
  прецедент - `plans/2026-09-11-salary-fullscreen-hub.md`. Переиспользовать классы 1-в-1.
- Доступ к Диску - тот же приём, что СТС 30.08: временные keyed-действия в `doGet`
  (`scripts/full_script_final.js`) под аккаунтом `dlinnomertral@gmail.com`, удалить после
  завершения импорта (правило репо №3).

## Фазы

### Фаза 1 - схема БД + API (сервер, VPS)
- [ ] `sprav_people`: добавить `passport_series`(4)/`passport_number`(6)/
      `passport_issued_by`(varchar 300)/`passport_issued_at`(date)/
      `passport_department_code`(varchar 10).
- [ ] Новая таблица `sprav_people_documents` (id, person_id, doc_type, original_name,
      stored_name, mime_type, size_bytes, uploaded_by, uploaded_at) - без owner/lessor
      (не нужны человеку), по образцу `sprav_asset_documents`.
- [ ] `SPRAV_PEOPLE_UPLOAD_DIR_ = /root/yard-dashboard/uploads/sprav_people`.
- [ ] 4 эндпоинта в `api/server.js`: `person_document_upload` (admin), `person_documents`
      (admin+manager+logist+mechanic, чтение), `person_document_file` (то же), `person_
      document_delete` (admin) - копия asset-эндпоинтов с заменой asset_id -> person_id.
- [ ] `/api/sprav/state`/`sprav/person` (GET/POST) - добавить 5 новых паспортных полей
      (COALESCE на UPDATE, как остальные ПДн-поля).
- [ ] git commit на VPS, запись в README сервера.

### Фаза 2 - форма сотрудника (files/index.html)
- [ ] `drv-reg-drawer`: блок «Паспорт» (серия, номер / кем выдан / дата выдачи, код
      подразделения) - по аналогии с блоком ВУ, виден при роли «Водитель» (как ВУ/медсправка).
- [ ] Блок документов (сканы паспорта/ВУ) - копия `asset-docs-section`/`assetDocsLoad_` и
      т.д. под именами `personDocs*`, `doc_type` = `passport`/`license`.
- [ ] `drvRegSave_`/`drvRegOpenForm_` - прокинуть новые поля.

### Фаза 3 - хаб «Справочники»
- [ ] Текущие вкладки (Сотрудники/Юрлица/Матсредства/Сцепка/Планы продаж/Плейбук продаж)
      превратить в `.hub-tile` внутри `#sprav-hub`, клик - показывает нужную панель + «←
      Все разделы» (`.mp-ghostbtn`), как `chooseSalaryTarget_`/`showSalaryHub_`.
- [ ] `showPage()` сбрасывает раздел «Справочники» к хабу при каждом заходе через сайдбар
      (тот же приём, что `sales-salary`).

### Фаза 4 - сканы с Google Диска
- [ ] Определить список «действующих рассаженных водителей» - `sprav_people` (role=driver,
      employment_status=active) INNER JOIN `fleet_assignments` (реально стоит на машине
      сейчас) - НЕ все 513 записей справочника, НЕ уволенные, НЕ водители без техники.
- [ ] Временный `doGet` пробник в Apps Script - листинг обеих папок Диска, сопоставление
      папка/файл -> ФИО водителя (по имени папки/файла, как СТС - авто + ручная сверка).
- [ ] Обработка: рендер/обрезка лишнего поля скана, сшивка перед+зад в одно изображение/PDF
      (тот же приём, что `process_all.py` СТС - автообрезка по плотности, паддинг 20-25px).
- [ ] Извлечение данных (визуально, не OCR) - серии/номера паспорта, кем выдан, дата, код
      подразделения, номер ВУ, срок действия - параллельно через subagent'ы пачками, запись
      в базу централизованно из этой сессии.
- [ ] Заливка файлов через `person_document_upload`, данных - через `/api/sprav/person`.
- [ ] Убрать временные `doGet`-действия, чистый redeploy Apps Script.

### Фаза 5 - проверка и сдача
- [ ] Цикл после фичи (CLAUDE.md): ошибки в коде, граничные случаи, security review (ПДн
      паспортов - доступ только admin на upload/паспортные поля, как остальные ПДн).
- [ ] Чек-лист приёмки ГОСТ (DESIGN_SYSTEM.md разд. 10) для хаба и формы.
- [ ] `scripts/DEPLOY_LOG.md` + README сервера + ретроспектива.

## Открытые риски

- Доступ `dlinnomertral@gmail.com` к обеим папкам Диска - не подтверждён, проверяется
  пробником в начале Фазы 4 (если нет доступа - нужна ре-расшарка от Влада).
- Качество/ориентация сканов - неизвестны заранее, обрабатывать по образцу СТС (см. ловушку
  с поворотом на 180° в `plans/2026-08-30-sts-document-import.md`).
- Объём: сколько именно активных водителей - уточняется в начале Фазы 4 запросом к базе.
