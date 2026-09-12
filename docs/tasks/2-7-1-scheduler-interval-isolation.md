---
id: "2.7.1"
phase: 2
epic: "2.7"
status: done
sync_state: aligned
last_reviewed: 2026-09-12
status_note: "Единый контракт intervalSec, startup isolation, typed write/sync validation и legacy-safe PostgreSQL CHECK реализованы; code verify #1066 GREEN."
roles: [BACK, DB, QA]
depends_on: ["2.4.1"]
estimated_hours: 2-3
agent: backend-senior
tags: [audit, scheduler, validation, postgres, p0]
---

# Задача 2.7.1 — Валидация интервала и изоляция scheduler startup

## Проблема

`monitorIntervalCron()` бросал исключение для неподдерживаемого `intervalSec`, а `MonitorScheduler.start()` последовательно вызывал `reconcile()` без изоляции. Одна повреждённая строка могла остановить инициализацию расписаний всех последующих мониторов.

## Реализация

- Поддерживаемые интервалы `60 / 120 / 300 / 600 / 900 / 3600` и cron mapping вынесены в единый `shared/monitor-interval.ts`.
- `UnsupportedMonitorIntervalError` используется scheduler и monitor config write boundary.
- `start()` изолирует ошибку одного monitor, публикует observable journal error и продолжает reconcile остальных.
- `syncMonitor()` валидирует interval до queue/schedule side effects и сохраняет явную typed failure семантику.
- `updateMonitorConfigTransaction()` отклоняет unsupported interval до чтения/записи monitor state.
- Миграция `20260912112500_monitor_interval_constraint` добавляет PostgreSQL `CHECK` как `NOT VALID`: существующие legacy rows не сканируются и не переписываются, но новые/обновляемые строки уже обязаны соблюдать контракт.
- Canonical PostgreSQL suite проверяет наличие `NOT VALID` constraint, сохранение legacy `180`, запрет нового `180`, разрешение `300` и повторное развёртывание после reset.

## Критерии приёмки

- [x] RED: один invalid monitor перед валидным доказывает, что текущий `start()` обрывается.
- [x] После GREEN валидные мониторы стартуют независимо от malformed sibling.
- [x] Application write path отклоняет unsupported `intervalSec` до сохранения.
- [x] DB-level invariant не допускает новые произвольные интервалы.
- [x] `syncMonitor()` для invalid row возвращает типизированную/явную ошибку и не меняет расписание на другое значение.
- [x] PostgreSQL integration покрывает constraint и legacy-safe migration path.

## TDD evidence

- Application RED: `verify #1058`, run `34690294883`, head `2fd8b316ccb3f47a00b7969ed7e83a55ebdf98cb` — три ожидаемых failures по startup isolation, typed sync/no-side-effect и write validation.
- DB RED: `verify #1064`, run `34690701487`, head `96155653eb6255f5ed33752920a061b3a599e6fa` — PostgreSQL integration дошёл до нового assertion и получил `pg_constraint = []`.
- Code GREEN: `verify #1066`, run `34690830954`, head `2908d963e123b38ec90a58bcac64021671a19b59` — dependency audit, docs check, unit tests, self-check, typecheck, lint, formatting, PostgreSQL integration, build и оба Electron smoke прошли.

## Не делать

- Не вводить адаптивные интервалы.
- Не менять выбранную пользователем частоту при ошибках.
