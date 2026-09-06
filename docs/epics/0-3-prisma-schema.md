---
id: "0.3"
phase: 0
status: todo
sync_state: drifted
last_reviewed: 2026-09-05
status_note: "Доменная модель в БД."
roles:
  - DB
  - BACK
---

# Эпик 0.3 — Prisma-схема и миграции

## Цель

Схема данных под сущности MVP-1, с индексами под горячие запросы и сидами для разработки. Остальные таблицы приходят отдельными миграциями вместе со своими срезами: задачи `0.3.4`–`0.3.6` лежат в этом эпике, но выполняются не в фундаменте.

## Планируемые задачи

- `0.3.1` — Схема Prisma по доменной модели
- `0.3.2` — Индексы и ограничения целостности
- `0.3.3` — Сиды и dev-фикстуры
- `0.3.4` — Схема среза `0.4.0`: `SellerBlock`
- `0.3.5` — Схема среза `0.5.0`: `Favorite`, `PriceSnapshot`
- `0.3.6` — Схема среза `0.6.0`: `HealthEvent`, `SchemaSnapshot`

## Дочерние карточки (rollup)

<!-- docs:ops:begin epic-0.3-tasks -->
**Задач:** 6 · **done:** 1

| ID | Задача | Статус | Sync |
|----|--------|--------|------|
| `0.3.1` | [Схема Prisma по доменной модели](../tasks/0-3-1-prisma-schema.md) | ✅ done | 🟢 aligned |
| `0.3.2` | [Индексы и ограничения целостности](../tasks/0-3-2-indexes.md) | ⬜ todo | 🟡 drifted |
| `0.3.3` | [Сиды и dev-фикстуры](../tasks/0-3-3-seeds.md) | ⬜ todo | 🟡 drifted |
| `0.3.4` | [Схема среза `0.4.0`: `SellerBlock`](../tasks/0-3-4-schema-seller-block.md) | ⬜ todo | 🟡 drifted |
| `0.3.5` | [Схема среза `0.5.0`: `Favorite`, `PriceSnapshot`](../tasks/0-3-5-schema-favorites.md) | ⬜ todo | 🟡 drifted |
| `0.3.6` | [Схема среза `0.6.0`: `HealthEvent`, `SchemaSnapshot`](../tasks/0-3-6-schema-health.md) | ⬜ todo | 🟡 drifted |
<!-- docs:ops:end epic-0.3-tasks -->

## Критерии приёмки эпика

- [ ] Все дочерние задачи в статусе `done`
- [ ] `sync_state: aligned` (код соответствует карточкам)
- [ ] Тесты по эпику зелёные (unit/integration/e2e где применимо)

## Связанные документы

- Фаза: `docs/phases/0-*.md`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
