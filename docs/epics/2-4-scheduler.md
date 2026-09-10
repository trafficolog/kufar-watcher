---
id: "2.4"
phase: 2
status: done
sync_state: aligned
last_reviewed: 2026-09-10
status_note: "Эпик закрыт: 2.4.1–2.4.4 delivery scope done; remediation 2.4.5 закрепляет per-Run source degradation без изменения retry/watermark policy, verify #915 GREEN."
roles:
  - BACK
  - DB
---

# Эпик 2.4 — Планировщик на pg-boss

## Цель

У каждого монитора свой интервал. Обходы не накладываются друг на друга, падение обхода не убивает расписание, история попыток пишется в журнал `Run`.

## Планируемые задачи

- `2.4.1` — Регистрация расписаний по монитору
- `2.4.2` — Защита от наложения обходов
- `2.4.3` — Журнал Run и состояния монитора
- `2.4.4` — Ретраи и деградация при сетевых ошибках
- `2.4.5` — Remediation: source fallback degradation привязана к конкретному Run

## Дочерние карточки (rollup)

<!-- docs:ops:begin epic-2.4-tasks -->
**Задач:** 5 · **done:** 5

| ID | Задача | Статус | Sync |
|----|--------|--------|------|
| `2.4.1` | [Регистрация расписаний pg-boss](../tasks/2-4-1-schedules.md) | ✅ done | 🟢 aligned |
| `2.4.2` | [Запрет пересечения обходов одного монитора](../tasks/2-4-2-no-overlap.md) | ✅ done | 🟢 aligned |
| `2.4.3` | [Журнал одного обхода](../tasks/2-4-3-run-journal.md) | ✅ done | 🟢 aligned |
| `2.4.4` | [Ретраи расписания и деградация при ошибках](../tasks/2-4-4-retries.md) | ✅ done | 🟢 aligned |
| `2.4.5` | [Persist source degradation per Run](../tasks/2-4-5-run-degradation-journal.md) | ✅ done | 🟢 aligned |
<!-- docs:ops:end epic-2.4-tasks -->

## Критерии приёмки эпика

- [x] Все дочерние задачи в статусе `done`
- [x] `sync_state: aligned` (код соответствует карточкам)
- [x] Тесты по эпику зелёные (unit/integration/e2e где применимо)

## Связанные документы

- Фаза: `docs/phases/2-*.md`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
