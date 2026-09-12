---
id: "2.7.6"
phase: 2
epic: "2.7"
status: todo
sync_state: drifted
last_reviewed: 2026-09-12
roles: [BACK, DB, QA]
depends_on: ["2.4.2", "2.7.4"]
estimated_hours: 4-6
agent: backend-senior
tags: [audit, scheduler, locking, postgres, restart, p1]
---

# Задача 2.7.6 — Process-independent запрет пересечения обходов

## Проблема

Текущий overlap guard — `Set<number>` внутри одного executor instance. Он не является межпроцессным инвариантом и не защищает от двух worker/app instances или иных restart/concurrency сценариев вне одного процесса.

## Что сделать

- Сначала characterization test должен доказать реальный gap с двумя независимыми executor/process contexts.
- Затем добавить process-independent lock/lease на monitor run boundary (PostgreSQL advisory/row lease или pg-boss primitive — выбрать после design и актуальной документации).
- Определить recovery после crash так, чтобы stale ownership не блокировал монитор навсегда.
- Сохранить понятную journal semantics для реально пропущенного overlap.

## Критерии приёмки

- [ ] RED воспроизводит конкурентный запуск одного monitor id из двух независимых contexts.
- [ ] Только один traversal получает durable ownership.
- [ ] Второй запуск не выполняет source/detail requests и получает `skipped-overlap` или эквивалентный terminal результат.
- [ ] Crash/restart не оставляет вечный lock.
- [ ] Разные monitor ids не блокируют друг друга.
- [ ] PostgreSQL integration проверяет cross-client concurrency.

## Не делать

- Не вводить глобальный mutex на все мониторы.
- Если characterization докажет достаточный process-independent invariant pg-boss, не добавлять второй lock без необходимости; зафиксировать доказательство и закрыть карточку документированным решением.
