---
id: "3"
status: in_progress
sync_state: drifted
last_reviewed: 2026-09-13
status_note: "Фаза 3: 3.1.1 bot bootstrap и 3.1.2 reconnect завершены; 3.1.3 outbox и остальной Telegram/favorites scope остаются по release slices."
---

# Фаза 3 — Telegram и избранное

## Цель

Находки приходят в Telegram, помеченные объявления отслеживаются по цене, тихие часы соблюдаются.

## Контекст

Опирается на фазу 2, параллельна фазе 4. Точка, после которой системой уже можно пользоваться по назначению.

## Эпики фазы

<!-- docs:ops:begin phase-3-epics -->
**Эпиков:** 4 · **done:** 0 · **в работе/план:** 4

| ID | Эпик | Статус | Sync | Ист. |
|----|------|--------|------|------|
| `3.1` | [Телеграм-бот и транспорт](../epics/3-1-telegram-transport.md) | 🔄 in_progress | 🟡 drifted | 3.1.1 bot bootstrap и 3.1.2 reconnect завершены; durable outbound queue остаётся в 3.1.3. |
| `3.2` | [Форматтер и кнопки](../epics/3-2-message-format.md) | ⬜ todo | 🟡 drifted | Формат уведомления о находке. |
| `3.3` | [Тихие часы и очередь](../epics/3-3-quiet-hours.md) | ⬜ todo | 🟡 drifted | Уведомления не будят ночью и не теряются. |
| `3.4` | [Мониторинг цен избранного](../epics/3-4-price-watch.md) | ⬜ todo | 🟡 drifted | Отслеживание цены по помеченным объявлениям. |
<!-- docs:ops:end phase-3-epics -->

## Связанные документы

- Тактический план: `docs/ROADMAP.MD`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
- Правила отбора: `docs/superpowers/specs/matching-rules.md`
