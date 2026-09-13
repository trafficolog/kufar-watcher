---
id: "3.1"
phase: 3
status: in_progress
sync_state: drifted
last_reviewed: 2026-09-13
status_note: "3.1.1 bot bootstrap и безопасная привязка чата завершены; reconnect и outbox остаются в 3.1.2–3.1.3."
roles:
  - BACK
---

# Эпик 3.1 — Телеграм-бот и транспорт

## Цель

Бот на long-polling: статического адреса нет, вебхук невозможен. Переподключение при смене сети обязано быть незаметным.

## Планируемые задачи

- `3.1.1` — Бот на grammY и привязка чата
- `3.1.2` — Устойчивое переподключение long-polling
- `3.1.3` — Очередь исходящих с соблюдением лимитов Telegram

## Дочерние карточки (rollup)

<!-- docs:ops:begin epic-3.1-tasks -->
**Задач:** 3 · **done:** 1

| ID | Задача | Статус | Sync |
|----|--------|--------|------|
| `3.1.1` | [Бот на grammY и привязка чата](../tasks/3-1-1-bot-bootstrap.md) | ✅ done | 🟢 aligned |
| `3.1.2` | [Устойчивое переподключение long-polling](../tasks/3-1-2-reconnect.md) | ⬜ todo | 🟡 drifted |
| `3.1.3` | [Очередь исходящих с соблюдением лимитов](../tasks/3-1-3-outbox.md) | ⬜ todo | 🟡 drifted |
<!-- docs:ops:end epic-3.1-tasks -->

## Критерии приёмки эпика

- [ ] Все дочерние задачи в статусе `done`
- [ ] `sync_state: aligned` (код соответствует карточкам)
- [ ] Тесты по эпику зелёные (unit/integration/e2e где применимо)

## Связанные документы

- Фаза: `docs/phases/3-*.md`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`