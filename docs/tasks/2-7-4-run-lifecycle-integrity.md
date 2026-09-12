---
id: "2.7.4"
phase: 2
epic: "2.7"
status: done
sync_state: aligned
last_reviewed: 2026-09-12
roles: [BACK, DB, QA]
depends_on: ["2.4.3"]
estimated_hours: 3-5
agent: backend-senior
tags: [audit, run, lifecycle, prisma, recovery, p1]
---

# Задача 2.7.4 — Целостность жизненного цикла Run

## Проблема

`Run.outcome` был свободной строкой, а процесс создавал `outcome='running'` до обхода. При аварийном завершении процесса строка могла навсегда остаться `running` с `finishedAt=null` и искажать health-метрики следующих фаз.

## Реализация

- Общий typed contract `RUN_OUTCOME` фиксирует runtime-набор `running`, `success`, `catchup`, `skipped`, `error`, `interrupted` и используется lifecycle writers вместо разрозненных строковых литералов.
- PostgreSQL constraint `Run_outcome_supported_check` отклоняет произвольные non-null значения `Run.outcome`; migration не добавляет `NOT NULL`, поэтому legacy `NULL` остаётся допустимым.
- Перед `scheduler.start()` worker выполняет узкий recovery: только строки `outcome='running' AND finishedAt IS NULL` переводятся в terminal `interrupted`.
- Recovery заполняет `finishedAt`, безопасный `durationMs`, `errorCategory=internal`, `errorCode=worker-interrupted` и диагностическое `error`; `interrupted` не имитирует `success` или `skipped`.
- Startup работает fail-closed: если recovery не завершился, scheduler не запускается. Поэтому новые runs текущей process incarnation не могут быть помечены orphan этим startup-step.
- Recovery идемпотентен: повторный запуск не изменяет уже terminal `interrupted` row.

## Критерии приёмки

- [x] БД не принимает произвольный `Run.outcome`.
- [x] Нормальный running run не помечается orphan преждевременно.
- [x] Stale running row после имитированного crash переводится в документированное terminal состояние.
- [x] Recovery идемпотентен и безопасен при повторном старте.
- [x] PostgreSQL integration покрывает orphan row и повторный recovery.
- [x] Data-model spec перечисляет фактические outcome и их смысл для health consumers.

## TDD и проверка

- **Startup RED:** commit `8bb0b57879d88e734f75d69f62c683e3155e4720`, canonical verify **#1123** (`34702986916`) — два новых startup assertion упали ровно потому, что worker ещё не выполнял recovery до scheduler.
- **Startup gate:** commit `06e0f13bf51126d50bb996a2c92c20dfe9633e4b` добавил recovery-step перед scheduler. Verify **#1124** выявил только устаревший Prisma test double; commit `43a99a39c41ab85ebad938afa124d3a95ef0c232` добавил ему `$executeRaw` без изменения production semantics.
- **PostgreSQL RED:** commit `ff4963123d17b35d103e078490efe173aa6452c7` включил lifecycle integration test в canonical PostgreSQL allowlist. Verify **#1126** (`34703354030`) прошёл unit/typecheck/lint/formatting и упал только на PostgreSQL integration: orphan оставался `running`, повторный recovery не закрывал его, а произвольный outcome принимался БД.
- **GREEN implementation:** commits `66c0d7b26372aa8058b43e91642b4f796d4e8fff` и `f878912f87197ff883343d6ae881a75d17237e33` реализовали recovery и DB constraint; `9d360becb49803ffe95ed2e4d044000ba3c02bbc` синхронизировал migration-count harness. Canonical verify **#1129** (`34703540410`) полностью GREEN, включая PostgreSQL, build и оба Electron smoke.
- **Typed contract refactor:** commit `3ddf33100f675c186bf3f00dd8490a1af3e56855` централизовал outcome vocabulary без изменения поведения. Canonical verify **#1130** (`34703857160`) полностью GREEN: unit tests, CI failure-mode self-check, typecheck, lint, formatting, PostgreSQL compose integration, build, development Electron smoke и production Electron smoke.

## Не делать

- Не удалять orphan rows.
- Не считать interrupted run успешным или skipped.
