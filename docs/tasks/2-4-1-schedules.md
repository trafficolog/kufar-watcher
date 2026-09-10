---
id: "2.4.1"
phase: 2
epic: "2.4"
status: done
sync_state: aligned
last_reviewed: 2026-09-10
roles: [BACK]
depends_on: ["0.3.1"]
estimated_hours: 3-4
agent: backend-senior
tags: [scheduler, pgboss]
---

# Задача 2.4.1 — Регистрация расписаний pg-boss

> Эпик 2.4 · Фаза 2 · ✅ done · зависит от: 0.3.1 · оценка: 3-4 ч

## Цель

Регистрировать отдельное расписание для каждого включённого монитора.

## Контекст

Мониторов около пяти, поэтому нет смысла строить общий диспетчер. pg-boss уже умеет расписания и хранит их в той же PostgreSQL — один механизм вместо собственного таймера и отдельного состояния.

## Что сделано

- Добавлен `MonitorScheduler`: при старте он загружает мониторы из Prisma, создаёт durable queue при необходимости, регистрирует schedule и worker только для `active`-мониторов, а для `paused`, `archived` или удалённых мониторов снимает schedule и локальный worker.
- Имя queue/schedule стабильно связано с id монитора и совместимо с реальным pg-boss: `monitor-run/<id>`. Первоначальный вариант с двоеточием был отвергнут реальным integration acceptance, потому что pg-boss не допускает `:` в имени queue.
- Поддерживаемые интервалы переводятся в явные cron-выражения без округления: `60`, `120`, `300`, `600`, `900`, `3600` секунд. Изменение интервала обновляет тот же schedule identity.
- Добавлен Prisma-backed repository расписаний и executor одного scheduled monitor run; job payload валидируется и запускает обход ровно указанного монитора.
- В utility worker подключён `pg-boss@12.30.0` через отдельный queue adapter. Worker получает тот же `DATABASE_URL`, что и bootstrap, а `ready` публикуется только после успешного старта scheduler services.
- Собран worker application composition: один Prisma client, один pg-boss queue, repository, source runtime, run executor и scheduler; shutdown выполняется в порядке scheduler → HTTP/source runtime → Prisma.
- PostgreSQL acceptance создаёт пять мониторов с разными интервалами и проверяет persisted schedules, reschedule без дублей, снятие расписаний для paused/archived, idempotent restart и реальную доставку одного `{ monitorId }` через pg-boss worker.

## Критерии приёмки

- [x] После старта для каждого enabled-монитора есть schedule
- [x] Изменение интервала обновляет расписание без дублей
- [x] Отключённый монитор не запускается
- [x] Перезапуск приложения не создаёт вторых расписаний

## TDD и проверка

- Queue adapter RED: `verify #769` — отсутствовал production module; `verify #770` — после skeleton отсутствовала зависимость `pg-boss`; `verify #772` дошёл до assertion-level RED перед реализацией adapter.
- Worker composition RED/GREEN: `verify #775` зафиксировал отсутствие source-runtime, `verify #779` — отсутствие application composition, `verify #785` — старый placeholder `electron/worker/index.ts`; итоговый composition/runtime GREEN подтверждён `verify #786` на `095c8f983b8d0969695e7ec526a40271de81e03c`, включая PostgreSQL integration, build и оба `[worker] ready` smoke.
- Реальный pg-boss acceptance RED: `verify #790` на `35331f1f3b820cf1c9a4a4c6670c05bb44d54f3f` показал, что `monitor-run:<id>` недопустим для pg-boss queue (`:` запрещён библиотекой).
- Regression RED перед production fix: `verify #792` на `e2c48023d0b2496d4dd03edc071bea14683b3070` — 9 scheduler unit assertions ожидали pg-boss-safe identity `monitor-run/<id>`, production всё ещё возвращал старое имя.
- Финальный GREEN: `verify #793` на final code SHA `ec6ee5c44cf7c45979ffff299d792c584a66472d` — 419 unit tests GREEN (integration suites gated в обычном unit-stage), documentation consistency, CI failure-mode self-check, typecheck, lint, formatting, PostgreSQL compose integration с реальным scheduler acceptance, build/output verification и оба Electron smoke GREEN.

## Подсказки

- Общий контекст — в карточке эпика и в `docs/AGENTS.md`

## Не делать

- Не строить центральный tick-loop
- Не менять интервалы автоматически — эпик 4.2
- Не добавлять no-overlap, retry policy или Run-journal semantics из `2.4.2–2.4.4`
