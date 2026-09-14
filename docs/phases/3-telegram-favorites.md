---
id: "3"
status: in_progress
sync_state: drifted
last_reviewed: 2026-09-13
status_note: "Эпик 3.1 Telegram transport завершён; 3.2 message delivery и последующие Telegram/favorites эпики остаются по release slices."
---

# Фаза 3 — Telegram и избранное

## Цель

Находки приходят в Telegram, помеченные объявления отслеживаются по цене, тихие часы соблюдаются.

## Контекст

Опирается на фазу 2, параллельна фазе 4. Точка, после которой системой уже можно пользоваться по назначению.

## Эпики фазы

<!-- docs:ops:begin phase-3-epics -->
**Эпиков:** 4 · **done:** 1 · **в работе/план:** 3

| ID | Эпик | Статус | Sync | Ист. |
|----|------|--------|------|------|
| `3.1` | [Телеграм-бот и транспорт](../epics/3-1-telegram-transport.md) | ✅ done | 🟢 aligned | 3.1.1 bot bootstrap, 3.1.2 reconnect и 3.1.3 durable outbound queue завершены. |
| `3.2` | [Форматтер и кнопки](../epics/3-2-message-format.md) | 🔄 in_progress | 🟡 drifted | Формат уведомления о находке. |
| `3.3` | [Тихие часы и очередь](../epics/3-3-quiet-hours.md) | ⬜ todo | 🟡 drifted | Уведомления не будят ночью и не теряются. |
| `3.4` | [Мониторинг цен избранного](../epics/3-4-price-watch.md) | ⬜ todo | 🟡 drifted | Отслеживание цены по помеченным объявлениям. |
<!-- docs:ops:end phase-3-epics -->

## Связанные документы

- Тактический план: `docs/ROADMAP.MD`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
- Правила отбора: `docs/superpowers/specs/matching-rules.md`
