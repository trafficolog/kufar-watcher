---
id: "1.4"
phase: 1
status: done
sync_state: aligned
last_reviewed: 2026-09-11
status_note: "5/5 done: watermark traversal, persistence boundary, cold start, catch-up checkpoint and narrow stale-checkpoint recovery are implemented."
roles:
  - BACK
  - DB
---

# Эпик 1.4 — Водяной знак новизны и дедупликация

## Цель

«Новое» определяется не диффом страницы, а водяным знаком: при сортировке по дате идём по выдаче вниз до временной границы предыдущего обхода. В типичном случае это одна страница, но алгоритм обязан идти вглубь по курсору — после простоя граница уходит за первую страницу, и остановка на ней означала бы молчаливый пропуск. Запись идемпотентна: повторный обход не порождает дублей.

## Планируемые задачи

- `1.4.1` — Алгоритм водяного знака
- `1.4.2` — Персистентность курсора и идемпотентная запись
- `1.4.3` — Холодный старт монитора
- `1.4.4` — Персистентный catch-up checkpoint
- `1.4.5` — Узкое восстановление catch-up checkpoint

## Дочерние карточки (rollup)

<!-- docs:ops:begin epic-1.4-tasks -->
**Задач:** 5 · **done:** 5

| ID | Задача | Статус | Sync |
|----|--------|--------|------|
| `1.4.1` | [Алгоритм водяного знака](../tasks/1-4-1-watermark-algo.md) | ✅ done | 🟢 aligned |
| `1.4.2` | [Персистентность водяного знака и граница транзакции](../tasks/1-4-2-cursor-persistence.md) | ✅ done | 🟢 aligned |
| `1.4.3` | [Холодный старт монитора](../tasks/1-4-3-cold-start.md) | ✅ done | 🟢 aligned |
| `1.4.4` | [Персистентный catch-up checkpoint водяного знака](../tasks/1-4-4-watermark-catchup-checkpoint.md) | ✅ done | 🟢 aligned |
| `1.4.5` | [Узкое восстановление catch-up checkpoint](../tasks/1-4-5-checkpoint-recovery.md) | ✅ done | 🟢 aligned |
<!-- docs:ops:end epic-1.4-tasks -->

## Критерии приёмки эпика

- [x] Все дочерние задачи в статусе `done`
- [x] `sync_state: aligned` (код соответствует карточкам)
- [x] Тесты по эпику зелёные (unit/integration/e2e где применимо)

## Связанные документы

- Фаза: `docs/phases/1-*.md`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
