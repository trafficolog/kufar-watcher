---
id: "2.4.5"
phase: 2
epic: "2.4"
status: todo
sync_state: drifted
last_reviewed: 2026-09-10
roles: [BACK, DB]
depends_on: ["1.3.4", "2.4.3"]
estimated_hours: 3-4
agent: backend-senior
tags: [scheduler, journal, degradation, remediation]
status_note: "Remediation in progress: Task 1 GREEN candidate preserves scheduled degradation metadata and removes watermark-catchup from degradedLevel."
---

# Задача 2.4.5 — Persist source degradation per Run

> Эпик 2.4 · Фаза 2 · ⬜ todo · зависит от: 1.3.4, 2.4.3 · оценка: 3-4 ч

## Цель

Связать typed `source-degraded` event с конкретным scheduled `Run` и сохранять использование HTML fallback как `degradedLevel='html-fallback'`, не смешивая его с watermark catch-up.

## Критерии приёмки

- [ ] HTML fallback хотя бы на одной странице делает текущий Run degraded.
- [ ] Degradation сохраняется после success, catch-up, cold-start completion и последующей ошибки.
- [ ] Catch-up без fallback имеет `outcome='catchup'` и `degradedLevel=null`.
- [ ] Несколько fallback pages внутри одного Run дают одну DB-запись degradation и одно warning-событие.
- [ ] Разные Runs имеют независимое degradation-состояние.
- [ ] Не создаются новый Prisma migration, HTTP client или limiter на каждый Run.
- [ ] Полный verify pipeline GREEN.

## Архитектура

Утверждённый design: `docs/superpowers/specs/2026-09-10-2-4-5-run-degradation-journal-design.md`.
Implementation plan: `docs/superpowers/plans/2026-09-10-2-4-5-run-degradation-journal.md`.

## Не делать

- Не реализовывать auto-pause/health aggregation.
- Не менять retry/cooldown policy.
- Не менять watermark traversal или description request budget.
