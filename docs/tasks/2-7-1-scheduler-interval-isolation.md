---
id: "2.7.1"
phase: 2
epic: "2.7"
status: todo
sync_state: drifted
last_reviewed: 2026-09-12
roles: [BACK, DB, QA]
depends_on: ["2.4.1"]
estimated_hours: 2-3
agent: backend-senior
tags: [audit, scheduler, validation, postgres, p0]
---

# Задача 2.7.1 — Валидация интервала и изоляция scheduler startup

## Проблема

`monitorIntervalCron()` бросает исключение для неподдерживаемого `intervalSec`, а `MonitorScheduler.start()` последовательно вызывает `reconcile()` без изоляции. Одна повреждённая строка может остановить инициализацию расписаний всех последующих мониторов.

## Что сделать

- Вынести единый контракт поддерживаемых интервалов и использовать его на write boundary и в scheduler.
- Не допускать новых неподдерживаемых значений в БД; выбрать безопасный DB constraint/migration с учётом legacy rows.
- В `start()` изолировать ошибку конкретного монитора: остальные валидные расписания должны быть reconciled.
- Ошибка плохого монитора должна быть наблюдаемой, но не превращаться в молчаливый fallback на другой интервал.

## Критерии приёмки

- [ ] RED: один invalid monitor перед валидным доказывает, что текущий `start()` обрывается.
- [ ] После GREEN валидные мониторы стартуют независимо от malformed sibling.
- [ ] Application write path отклоняет unsupported `intervalSec` до сохранения.
- [ ] DB-level invariant не допускает новые произвольные интервалы.
- [ ] `syncMonitor()` для invalid row возвращает типизированную/явную ошибку и не меняет расписание на другое значение.
- [ ] PostgreSQL integration покрывает constraint и legacy-safe migration path.

## Не делать

- Не вводить адаптивные интервалы.
- Не менять выбранную пользователем частоту при ошибках.
