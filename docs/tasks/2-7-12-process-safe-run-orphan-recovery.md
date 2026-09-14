---
id: "2.7.12"
phase: 2
epic: "2.7"
status: in_progress
sync_state: drifted
last_reviewed: 2026-09-14
roles: [BACK, DB, QA]
depends_on: ["2.7.4", "2.7.6"]
estimated_hours: 4-6
agent: backend-senior
tags: [audit, run, lifecycle, recovery, postgres, locking, p1]
---

# Задача 2.7.12 — Process-safe Run orphan recovery

## Проблема

Startup recovery из `2.7.4` делает blind `UPDATE` всех `Run(outcome='running', finishedAt=null)`. После `2.7.6` это небезопасно: другой живой worker process может владеть таким Run через canonical per-monitor PostgreSQL advisory lease, а второй worker при startup преждевременно переведёт live Run в `interrupted`.

## Решение

Recovery обязан получить и удерживать тот же per-monitor lease, что scheduled executor, прежде чем считать `running` row orphan и переводить его в `interrupted`.

Canonical ownership proof:

1. выбрать distinct `monitorId` среди незавершённых `running` rows;
2. попытаться получить canonical per-monitor lease;
3. busy lease (`null`) трактовать как нормальный live-owner signal и не менять rows этого monitor;
4. при успешном acquisition удерживать lease через terminal `UPDATE`;
5. release выполнять после mutation; infrastructure errors сохраняют fail-closed startup.

Production recovery строит PostgreSQL lease acquirer явно из `config.databaseUrl`. Local in-memory lease допустим только как injected test dependency.

## Критерии приёмки

- [ ] Live Run, чей advisory lease удерживается другим PostgreSQL context, не изменяется startup recovery.
- [ ] После release/crash owner session тот же orphan восстанавливается в `interrupted`.
- [ ] Recovery удерживает canonical lease до завершения terminal UPDATE.
- [ ] Busy lease не является общей startup failure; инфраструктурная lease/DB ошибка остаётся fail-closed.
- [ ] Разные monitor IDs независимы; повторный recovery идемпотентен.
- [ ] Несколько stale `running` rows одного monitor закрываются в одном доказанном ownership window.
- [ ] PostgreSQL integration использует реальные независимые contexts и настоящий advisory lease.

## TDD и проверка

- Baseline design/plan head `ff4237ca31d440db14fe73e84d83e2df39a9a471`, verify **#1446** — полный GREEN до implementation lifecycle и RED tests.
- RED/GREEN и final exact-head evidence будут добавлены после выполнения соответствующих шагов.

## Связанные документы

- Design: `docs/superpowers/specs/2026-09-14-2-7-12-process-safe-run-recovery-design.md`
- Implementation plan: `docs/superpowers/plans/2026-09-14-2-7-12-process-safe-run-recovery.md`
- Исходный Run lifecycle: `docs/tasks/2-7-4-run-lifecycle-integrity.md`
- Canonical durable lease: `docs/tasks/2-7-6-durable-monitor-no-overlap.md`

## Не делать

- Не добавлять heartbeat, TTL, worker registry или clock-based lease.
- Не вводить global worker singleton.
- Не менять Prisma schema или pg-boss policy.
- Не создавать второй advisory-lock namespace для recovery.
- Не считать возраст `Run.startedAt` доказательством orphan.
