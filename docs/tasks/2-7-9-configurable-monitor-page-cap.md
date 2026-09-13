---
id: "2.7.9"
phase: 2
epic: "2.7"
status: done
sync_state: aligned
last_reviewed: 2026-09-13
roles: [BACK, QA]
depends_on: ["1.4.1"]
estimated_hours: 1-2
agent: backend-senior
tags: [audit, config, watermark, validation, p2]
---

# Задача 2.7.9 — Конфигурируемый monitorMaxPages

## Проблема

`WorkerConfig` содержал `monitorMaxPages`, но loader всегда присваивал `DEFAULT_MONITOR_MAX_PAGES = 5`. Это фактически оставляло page cap константой, хотя он задуман как операционная конфигурация обхода.

## Реализация

- Поддержан process-env override `KUFAR_MONITOR_MAX_PAGES`; utility worker уже наследует parent environment, поэтому отдельный IPC/argv config channel не добавлялся.
- При отсутствии override сохраняется `DEFAULT_MONITOR_MAX_PAGES = 5`.
- Явное значение принимается только как строгая decimal-digit строка и только в диапазоне `1..100`; защитный upper bound экспортирован как `MAX_MONITOR_MAX_PAGES = 100`.
- Пустое, нулевое, отрицательное, дробное, malformed, signed/whitespace значение и значение выше `100` приводят к startup error с именем `KUFAR_MONITOR_MAX_PAGES`, без silent fallback.
- `.env.example` документирует `KUFAR_MONITOR_MAX_PAGES=5`.
- `createWorkerApplication` не менялся: characterization со значением `17` подтверждает передачу `config.monitorMaxPages` в `ScheduledMonitorRunExecutorOptions.maxPages` без преобразований.

## Критерии приёмки

- [x] Default остаётся `5` при отсутствии override.
- [x] Поддержанный config source позволяет явно задать page cap без изменения кода.
- [x] Override валидируется как целое положительное число в разумных границах `1..100`.
- [x] Invalid override не приводит к скрытому fallback на опасное значение.
- [x] Проверенное значение без преобразований передаётся в scheduled executor/traversal.
- [x] Tests покрывают default, valid override, upper bound и invalid values.

## TDD и проверка

- **RED:** commit `602686f75eb1a246cfb4dbaa97e3990a4807d545`, verify **#1195** (`34750665769`) — docs checks GREEN; unit suite дала ровно два ожидаемых failure: `17` осталось default `5`, а invalid override не вызвал startup error; остальные `513` tests прошли, `44` PostgreSQL tests были skipped на unit gate.
- **GREEN:** commit `4641034293f68e2d9a9d51779e5cfcea88ca8f7f`, verify **#1198** (`34750732899`) полностью GREEN: dependency/docs checks, unit tests, failure-mode self-check, typecheck, lint, formatting, PostgreSQL integration, build/output verification и оба Electron smoke.

## Не делать

- Не вводить per-monitor page cap, пока это не требуется продуктовой спецификацией.
- Не убирать защитный upper bound.
