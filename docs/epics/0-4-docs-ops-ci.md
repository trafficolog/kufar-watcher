---
id: "0.4"
phase: 0
status: in_progress
sync_state: aligned
last_reviewed: 2026-09-11
status_note: "2 delivery tasks done; remediation 0.4.3 implementation aligned, full verify pending before closure."
roles:
  - PRODUCT
  - DEVOPS
  - QA
---

# Эпик 0.4 — docs-ops, линт и CI

## Цель

Документация не расходится с реальностью автоматически, а не усилием воли: CLI пересобирает сводки, CI не пропускает сломанный frontmatter и красные тесты.

## Планируемые задачи

- `0.4.1` — Внедрение docs-ops CLI и npm-скриптов
- `0.4.2` — CI: typecheck, lint, unit, docs:ops:check
- `0.4.3` — Parent lifecycle и freshness docs-ops

## Дочерние карточки (rollup)

<!-- docs:ops:begin epic-0.4-tasks -->
**Задач:** 3 · **done:** 2

| ID | Задача | Статус | Sync |
|----|--------|--------|------|
| `0.4.1` | [Внедрение docs-ops CLI и npm-скриптов](../tasks/0-4-1-docs-ops.md) | ✅ done | 🟢 aligned |
| `0.4.2` | [CI: typecheck, lint, unit, docs:ops:check](../tasks/0-4-2-ci.md) | ✅ done | 🟢 aligned |
| `0.4.3` | [Parent lifecycle и freshness docs-ops](../tasks/0-4-3-docs-parent-freshness.md) | 🔄 in_progress | 🟢 aligned |
<!-- docs:ops:end epic-0.4-tasks -->

## Критерии приёмки эпика

- [ ] Все дочерние задачи в статусе `done`
- [x] `sync_state: aligned` (код соответствует карточкам)
- [ ] Тесты по эпику зелёные (unit/integration/e2e где применимо)

## Связанные документы

- Фаза: `docs/phases/0-*.md`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
