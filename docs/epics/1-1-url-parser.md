---
id: "1.1"
phase: 1
status: done
sync_state: aligned
last_reviewed: 2026-09-11
status_note: "4/4 done: canonical URL parse/build/routing plus real-estate regionless operation disambiguation are implemented and verified."
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
- `1.1.4` — Real-estate route disambiguation

## Дочерние карточки (rollup)

<!-- docs:ops:begin epic-1.1-tasks -->
**Задач:** 4 · **done:** 4

| ID | Задача | Статус | Sync |
|----|--------|--------|------|
| `1.1.1` | [Разбор URL листинга в CanonicalQuery](../tasks/1-1-1-url-parse.md) | ✅ done | 🟢 aligned |
| `1.1.2` | [Обратная сборка CanonicalQuery в URL](../tasks/1-1-2-url-build.md) | ✅ done | 🟢 aligned |
| `1.1.3` | [Определение категории и хоста по URL](../tasks/1-1-3-category-routing.md) | ✅ done | 🟢 aligned |
| `1.1.4` | [Real-estate route disambiguation](../tasks/1-1-4-realestate-route-disambiguation.md) | ✅ done | 🟢 aligned |
<!-- docs:ops:end epic-1.1-tasks -->

## Критерии приёмки эпика

- [x] Все дочерние задачи в статусе `done`
- [x] `sync_state: aligned` (код соответствует карточкам)
- [x] Тесты по эпику зелёные (unit/integration/e2e где применимо)

## Результат — 2026-09-11

- Пользовательские listing URL разбираются в `CanonicalQuery` с сохранением неподтверждённых параметров и typed parse errors.
- `CanonicalQuery` детерминированно собирается обратно в site URL и в live-подтверждённые API request shapes без speculative mappings.
- Подтверждённые electronics / real-estate правила маршрутизируются в стабильные adapter kinds; Auto и неизвестные категории отклоняются явно.
- Regionless real-estate routes с ведущим `kupit`/`snyat` распознают operation без фиктивного region; подтверждённые region-first routes и real-estate `q~` path-filter semantics сохранены.
- TDD-история задач `1.1.1`–`1.1.4` сохранена отдельными RED→GREEN коммитами и exact-SHA CI-проверками.

## Связанные документы

- Фаза: `docs/phases/1-*.md`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
