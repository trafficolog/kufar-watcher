---
id: "0.4.3"
phase: 0
epic: "0.4"
status: in_progress
sync_state: drifted
last_reviewed: 2026-09-11
roles: [DEVOPS, QA]
depends_on: ["0.4.2"]
estimated_hours: 3-4
agent: backend-senior
tags: [docs-ops, ci, consistency, remediation]
status_note: "Audit remediation in progress: enforce parent/child lifecycle consistency and generated docs freshness in docs:ops:check."
---

# Задача 0.4.3 — Parent lifecycle и freshness docs-ops

> Эпик 0.4 · Фаза 0 · 🔄 in_progress · зависит от: 0.4.2 · оценка: 3-4 ч

## Цель

Не позволять документации проходить CI, когда статус phase/epic противоречит завершённым дочерним карточкам или auto-generated rollup/autoblock устарел относительно canonical frontmatter.

## Критерии приёмки

- [ ] `docs:ops:check` отклоняет parent с дочерними карточками, если lifecycle parent не соответствует lifecycle children.
- [ ] `docs:ops:check` отклоняет stale phase/epic autoblocks и `docs/operations/status/*.md` без мутации рабочего дерева.
- [ ] Freshness-проверка не создаёт ежедневный drift только из-за generation date.
- [ ] Завершённые legacy epics синхронизированы с уже завершёнными дочерними карточками.
- [ ] Phase 1 закрыта только если все её epics фактически `done/aligned`; phase 0 остаётся открытой, пока `0.3.4–0.3.6` не завершены.
- [ ] Полный verify pipeline GREEN.

## Не делать

- Не менять runtime/product behavior.
- Не закрывать `0.3` или phase 0 искусственно: будущие schema-slice задачи остаются открытыми.
- Не менять MVP-1 denominator или release scope.
