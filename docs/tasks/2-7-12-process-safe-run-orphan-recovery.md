---
id: "2.7.12"
phase: 2
epic: "2.7"
status: done
sync_state: aligned
last_reviewed: 2026-09-14
roles: [BACK, DB, QA]
depends_on: ["2.7.4", "2.7.6"]
estimated_hours: 4-6
agent: backend-senior
tags: [audit, run, lifecycle, recovery, postgres, locking, p1]
---

# Задача 2.7.12 — Process-safe Run orphan recovery

## Проблема

Startup recovery из `2.7.4` делал blind `UPDATE` всех `Run(outcome='running', finishedAt=null)`. После `2.7.6` это было небезопасно: другой живой worker process мог владеть таким Run через canonical per-monitor PostgreSQL advisory lease, а второй worker при startup преждевременно переводил live Run в `interrupted`.

## Реализация

Recovery получает и удерживает тот же per-monitor lease, что scheduled executor, прежде чем считать `running` row orphan и переводить его в `interrupted`.

Canonical ownership proof:

1. выбрать distinct `monitorId` среди незавершённых `running` rows;
2. попытаться получить canonical per-monitor lease;
3. busy lease (`null`) трактовать как нормальный live-owner signal и не менять rows этого monitor;
4. при успешном acquisition удерживать lease через terminal `UPDATE`;
5. release выполнять после mutation; infrastructure errors сохраняют fail-closed startup.

Production recovery строит PostgreSQL lease acquirer явно из `config.databaseUrl` и переиспользует существующий `createPostgresMonitorRunLeaseAcquirer`; новый lock namespace, schema, TTL/heartbeat или worker registry не добавлялись. Local in-memory lease остаётся только injected test dependency.

## Критерии приёмки

- [x] Live Run, чей advisory lease удерживается другим PostgreSQL context, не изменяется startup recovery.
- [x] После release/crash owner session тот же orphan восстанавливается в `interrupted`.
- [x] Recovery удерживает canonical lease до завершения terminal UPDATE.
- [x] Busy lease не является общей startup failure; инфраструктурная lease/DB ошибка остаётся fail-closed.
- [x] Разные monitor IDs независимы; повторный recovery идемпотентен.
- [x] Несколько stale `running` rows одного monitor закрываются в одном доказанном ownership window.
- [x] PostgreSQL integration использует реальные независимые contexts и настоящий advisory lease.

## TDD и проверка

- **Baseline:** design/plan head `ff4237ca31d440db14fe73e84d83e2df39a9a471`, verify **#1446** — полный GREEN до implementation lifecycle и RED tests.
- **PostgreSQL RED:** head `48b11feaba88e09a71df25cce4c418560db8c182`, verify **#1452** — все предварительные gates GREEN, а PostgreSQL integration доказал gap: live lease-owned row ожидался `running/finishedAt=null`, но blind startup recovery завершил его как `interrupted`.
- **Unit RED:** commit `245947658d9e8ace8f220720ab8dd71451dc0bb1`, verify **#1453** — новые behavioral tests упали ровно на отсутствии candidate-read/lease/release sequencing, busy-lease skip и fail-closed recovery dependencies.
- **Minimal GREEN:** commit `2bce5fdd92594d2c9391bdcb4414121e651bb152`, tree `ed2c60d07d0720d56d571e67a7163c4e15424298`, verify **#1454** — полный GREEN, включая PostgreSQL compose integration, build и оба Electron smoke.
- **Concurrency hardening:** production после GREEN не менялся. Integration coverage добавила реальный PostgreSQL ownership window, независимость разных monitor IDs, multi-row recovery и concurrent recovery contexts. Verify **#1455** остановился только на test formatting; verify **#1458** выявил нестабильный observer, привязанный к presentation текста Prisma SQL. Harness был заменён на PostgreSQL lock-graph proof через `pg_blocking_pids()` без изменения production semantics.
- **Hardened GREEN:** head `f67af7954768a07853c61c35dbb48246621e06b6`, verify **#1459** — полный GREEN: dependency/docs checks, 602 unit tests, typecheck, lint, formatting, Dockerode integration, PostgreSQL compose integration с ownership-window tests, build/output verification и оба Electron smoke.
- **Docs closure GREEN:** commit `527a24479250cd6407102d7b9c9c6c8dfbd40193`, tree `a3c5acfa3c522a62ec2de6566837ae1c9e4185c8`, verify **#1465** (`34831920046`) — полный GREEN после `2.7.12 → done/aligned`, `2.7 → 12/12 done/aligned` и canonical `docs:ops:refresh`.
- Финальный review-head verify фиксируется в PR #62: его нельзя самоссылочно записать в этот файл без создания нового HEAD после соответствующего run.

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
