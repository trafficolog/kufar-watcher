---
id: "1.3"
phase: 1
status: done
sync_state: aligned
last_reviewed: 2026-09-10
status_note: "5/5: общий SourceAdapter, electronics, real-estate, проверенный HTML fallback и terminal pagination token готовы."
roles:
  - BACK
---

# Эпик 1.3 — Адаптеры выдачи Kufar

## Цель

Электроника и недвижимость живут на разных пользовательских маршрутах и отдают разные наборы полей. Адаптер прячет это различие за одним интерфейсом, нормализует ответ в доменную модель `Listing` и сохраняет проверенный structured HTML fallback для временной недоступности primary JSON API.

## Планируемые задачи

- `1.3.1` — Интерфейс SourceAdapter и реестр
- `1.3.2` — Адаптер «Электроника»
- `1.3.3` — Адаптер «Недвижимость»
- `1.3.4` — Фолбэк на встроенные данные HTML-страницы
- `1.3.5` — Terminal pagination token

## Дочерние карточки (rollup)

<!-- docs:ops:begin epic-1.3-tasks -->
**Задач:** 5 · **done:** 5

| ID | Задача | Статус | Sync |
|----|--------|--------|------|
| `1.3.1` | [Интерфейс SourceAdapter и реестр](../tasks/1-3-1-adapter-interface.md) | ✅ done | 🟢 aligned |
| `1.3.2` | [Адаптер «Электроника»](../tasks/1-3-2-adapter-electronics.md) | ✅ done | 🟢 aligned |
| `1.3.3` | [Адаптер «Недвижимость»](../tasks/1-3-3-adapter-realestate.md) | ✅ done | 🟢 aligned |
| `1.3.4` | [Фолбэк на встроенные данные HTML-страницы](../tasks/1-3-4-html-fallback.md) | ✅ done | 🟢 aligned |
| `1.3.5` | [Terminal pagination token](../tasks/1-3-5-terminal-pagination-token.md) | ✅ done | 🟢 aligned |
<!-- docs:ops:end epic-1.3-tasks -->

## Критерии приёмки эпика

- [x] Все дочерние задачи в статусе `done`
- [x] `sync_state: aligned` (код соответствует карточкам)
- [x] Тесты по эпику зелёные (unit/integration/e2e где применимо)

## Связанные документы

- Фаза: `docs/phases/1-*.md`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
