---
id: "2.4.5"
phase: 2
epic: "2.4"
status: done
sync_state: aligned
last_reviewed: 2026-09-10
roles: [BACK, DB]
depends_on: ["1.3.4", "2.4.3"]
estimated_hours: 3-4
agent: backend-senior
tags: [scheduler, journal, degradation, remediation]
status_note: "Remediation closed: exact scheduled Run persists source fallback degradation once per Run; verify #915 GREEN on ff5893a600d413fc3c8a0f7be418edd89b4ad319."
---

# Задача 2.4.5 — Persist source degradation per Run

> Эпик 2.4 · Фаза 2 · ✅ done · зависит от: 1.3.4, 2.4.3 · оценка: 3-4 ч

## Цель

Связать typed `source-degraded` event с конкретным scheduled `Run` и сохранять использование HTML fallback как `degradedLevel='html-fallback'`, не смешивая его с watermark catch-up.

## Критерии приёмки

- [x] HTML fallback хотя бы на одной странице делает текущий Run degraded.
- [x] Degradation сохраняется после success, catch-up, cold-start completion и последующей ошибки.
- [x] Catch-up без fallback имеет `outcome='catchup'` и `degradedLevel=null`.
- [x] Несколько fallback pages внутри одного Run дают одну DB-запись degradation и одно warning-событие.
- [x] Разные Runs имеют независимое degradation-состояние.
- [x] Не создаются новый Prisma migration, HTTP client или limiter на каждый Run.
- [x] Полный verify pipeline GREEN.

## Архитектура

Утверждённый design: `docs/superpowers/specs/2026-09-10-2-4-5-run-degradation-journal-design.md`.
Implementation plan: `docs/superpowers/plans/2026-09-10-2-4-5-run-degradation-journal.md`.

## Verification

- `verify #915` GREEN на exact implementation HEAD `ff5893a600d413fc3c8a0f7be418edd89b4ad319`.
- 449 unit tests, PostgreSQL compose acceptance, typecheck, lint, formatting, build/output verification и оба Electron smoke — GREEN.
- Regression покрывает warning callback failure и независимое degradation-состояние разных Runs; PostgreSQL acceptance подтверждает один degraded Run и один warning при повторном fallback в одном обходе.

## Не делать

- Не реализовывать auto-pause/health aggregation.
- Не менять retry/cooldown policy.
- Не менять watermark traversal или description request budget.
