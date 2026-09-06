---
id: "0.4"
phase: 0
status: todo
sync_state: drifted
last_reviewed: 2026-09-05
status_note: "Инструменты консистентности документации и сборки."
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

## Дочерние карточки (rollup)

<!-- docs:ops:begin epic-0.4-tasks -->
**Задач:** 2 · **done:** 1

| ID | Задача | Статус | Sync |
|----|--------|--------|------|
| `0.4.1` | [Внедрение docs-ops CLI и npm-скриптов](../tasks/0-4-1-docs-ops.md) | ✅ done | 🟢 aligned |
| `0.4.2` | [CI: typecheck, lint, unit, docs:ops:check](../tasks/0-4-2-ci.md) | ⬜ todo | 🟡 drifted |
<!-- docs:ops:end epic-0.4-tasks -->

## Критерии приёмки эпика

- [ ] Все дочерние задачи в статусе `done`
- [ ] `sync_state: aligned` (код соответствует карточкам)
- [ ] Тесты по эпику зелёные (unit/integration/e2e где применимо)

## Связанные документы

- Фаза: `docs/phases/0-*.md`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
