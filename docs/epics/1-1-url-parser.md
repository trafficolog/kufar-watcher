---
id: "1.1"
phase: 1
status: todo
sync_state: drifted
last_reviewed: 2026-09-05
status_note: "Единственная точка входа пользователя — ссылка."
roles:
  - BACK
---

# Эпик 1.1 — URL-парсер и canonical query

## Цель

Ссылка вида `kufar.by/l/bez-posrednikov/q~playstation-4-pro?sort=lst.d` разбирается в структуру `CanonicalQuery` и собирается обратно — и в адрес API, и в адрес сайта для показа человеку.

## Планируемые задачи

- `1.1.1` — Разбор URL листинга в CanonicalQuery
- `1.1.2` — Обратная сборка CanonicalQuery в URL
- `1.1.3` — Определение категории и хоста по URL

## Дочерние карточки (rollup)

<!-- docs:ops:begin epic-1.1-tasks -->
**Задач:** 3 · **done:** 1

| ID | Задача | Статус | Sync |
|----|--------|--------|------|
| `1.1.1` | [Разбор URL листинга в CanonicalQuery](../tasks/1-1-1-url-parse.md) | ✅ done | 🟢 aligned |
| `1.1.2` | [Обратная сборка CanonicalQuery в URL](../tasks/1-1-2-url-build.md) | ⬜ todo | 🟡 drifted |
| `1.1.3` | [Определение категории и хоста по URL](../tasks/1-1-3-category-routing.md) | ⬜ todo | 🟡 drifted |
<!-- docs:ops:end epic-1.1-tasks -->

## Критерии приёмки эпика

- [ ] Все дочерние задачи в статусе `done`
- [ ] `sync_state: aligned` (код соответствует карточкам)
- [ ] Тесты по эпику зелёные (unit/integration/e2e где применимо)

## Связанные документы

- Фаза: `docs/phases/1-*.md`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
