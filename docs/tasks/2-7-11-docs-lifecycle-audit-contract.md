---
id: "2.7.11"
phase: 2
epic: "2.7"
status: todo
sync_state: drifted
last_reviewed: 2026-09-12
roles: [QA, BACK]
depends_on: ["0.4.3", "2.4.4"]
estimated_hours: 2-3
agent: backend-senior
tags: [audit, docs-ops, lifecycle, drift, p0]
---

# Задача 2.7.11 — Lifecycle-контракт docs и точная семантика drift pause signal

## Проблема 1: parent lifecycle

`docs:ops:check` проверяет только эквивалентность `done/aligned` родителя состоянию «все дети done/aligned». Он разрешает родителю оставаться `todo`, когда часть детей уже `done`/`in_progress`. Поэтому фаза 2 сейчас `todo/drifted` при четырёх завершённых эпиках.

## Проблема 2: карточка 2.4.4

`status_note` и `Не делать` правильно говорят, что задача реализует typed `pause-required` signal, а фактическая автопауза относится к эпику `4.3`. Но отмеченный критерий «дрейф схемы приводит к паузе монитора» сформулирован как уже реализованная смена состояния.

## Что сделать

- Расширить lifecycle validation для промежуточных состояний parent/children и покрыть тестами.
- Согласовать phase 2 status с фактическим прогрессом после введения правила.
- Переформулировать `2.4.4`: drift даёт terminal no-retry disposition и typed pause-required signal; `Monitor.state` здесь не меняется.
- Записать accepted slice risk: до `4.3` тот же drift может снова сработать на следующем schedule slot.

## Критерии приёмки

- [ ] Все дети todo → parent может быть todo.
- [ ] Есть начатый/завершённый ребёнок, но не все done → parent обязан отражать work-in-progress согласно документированной policy.
- [ ] Все дети done/aligned → parent done/aligned.
- [ ] `docs:ops:check` ловит regression для phase и epic levels.
- [ ] `2.4.4` больше не утверждает фактическую автопаузу.
- [ ] `deferred-requirements.md` явно фиксирует временный риск повторного drift traversal до `4.3`.

## Не делать

- Не реализовывать autopause из эпика `4.3` в этой docs-ops задаче.
