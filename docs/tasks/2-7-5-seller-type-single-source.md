---
id: "2.7.5"
phase: 2
epic: "2.7"
status: todo
sync_state: drifted
last_reviewed: 2026-09-12
roles: [BACK, DB, QA]
depends_on: ["2.3.1"]
estimated_hours: 3-4
agent: backend-senior
tags: [audit, seller, canonical-query, prisma, invariant, p1]
---

# Задача 2.7.5 — Единый источник истины для sellerType

## Проблема

Runtime использует `Monitor.query.sellerType`, но schema одновременно хранит `Monitor.sellerType String?`. Отдельная колонка записывается через `MonitorConfigPatch.sellerType?: string | null` без canonical validation и может молча расходиться с JSON query.

## Предпочтительное направление

Сохранить один independently writable source. Перед реализацией проверить будущие consumers в data-model/UI; если отдельная колонка не нужна реальному запросу/индексу, удалить её безопасной миграцией и считать `query.sellerType` единственным источником. Если колонка остаётся, запись обязана быть транзакционно синхронизирована и валидирована тем же `SellerType` contract.

## Критерии приёмки

- [ ] Невозможно сохранить `query.sellerType='private'` и независимо `Monitor.sellerType='company'` через поддерживаемый path.
- [ ] Невалидные seller values отклоняются до commit.
- [ ] Legacy persisted `bez-posrednikov` продолжает читаться по контракту `2.3.1`.
- [ ] Миграция существующих rows не теряет эффективный seller filter.
- [ ] Cursor reset/preserve semantics зависят от эффективного CanonicalQuery, а не от второго рассинхронизированного поля.
- [ ] Data-model и будущий UI contract описывают один source of truth.

## Не делать

- Не добавлять третий seller-state.
- Не менять подтверждённую Kufar `cmp` семантику.
