---
id: "1.3"
phase: 1
status: todo
sync_state: drifted
last_reviewed: 2026-09-05
status_note: "Нормализация выдачи двух категорий."
roles:
  - BACK
---

# Эпик 1.3 — Адаптеры выдачи Kufar

## Цель

Электроника и недвижимость живут на разных хостах API и отдают разные наборы полей. Адаптер прячет это различие за одним интерфейсом и нормализует ответ в доменную модель `Listing`.

## Планируемые задачи

- `1.3.1` — Интерфейс SourceAdapter и реестр
- `1.3.2` — Адаптер «Электроника»
- `1.3.3` — Адаптер «Недвижимость»
- `1.3.4` — Фолбэк на встроенные данные HTML-страницы

## Дочерние карточки (rollup)

<!-- docs:ops:begin epic-1.3-tasks -->
**Задач:** 4 · **done:** 0

| ID | Задача | Статус | Sync |
|----|--------|--------|------|
| `1.3.1` | [Интерфейс SourceAdapter и реестр](../tasks/1-3-1-adapter-interface.md) | ⬜ todo | 🟡 drifted |
| `1.3.2` | [Адаптер «Электроника»](../tasks/1-3-2-adapter-electronics.md) | ⬜ todo | 🟡 drifted |
| `1.3.3` | [Адаптер «Недвижимость»](../tasks/1-3-3-adapter-realestate.md) | ⬜ todo | 🟡 drifted |
| `1.3.4` | [Фолбэк на встроенные данные HTML-страницы](../tasks/1-3-4-html-fallback.md) | ⬜ todo | 🟡 drifted |
<!-- docs:ops:end epic-1.3-tasks -->

## Критерии приёмки эпика

- [ ] Все дочерние задачи в статусе `done`
- [ ] `sync_state: aligned` (код соответствует карточкам)
- [ ] Тесты по эпику зелёные (unit/integration/e2e где применимо)

## Связанные документы

- Фаза: `docs/phases/1-*.md`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
