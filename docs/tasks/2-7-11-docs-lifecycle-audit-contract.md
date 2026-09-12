---
id: "2.7.11"
phase: 2
epic: "2.7"
status: done
sync_state: aligned
last_reviewed: 2026-09-12
status_note: "Parent lifecycle policy теперь различает todo, in_progress и done/aligned; 2.4.4 и deferred risk согласованы с фактическим typed pause-required runtime без автопаузы."
roles: [QA, BACK]
depends_on: ["0.4.3", "2.4.4"]
estimated_hours: 2-3
agent: backend-senior
tags: [audit, docs-ops, lifecycle, drift, p0]
---

# Задача 2.7.11 — Lifecycle-контракт docs и точная семантика drift pause signal

## Проблема 1: parent lifecycle

`docs:ops:check` проверял только эквивалентность `done/aligned` родителя состоянию «все дети done/aligned». Он разрешал родителю оставаться `todo`, когда часть детей уже `done`/`in_progress`.

Теперь policy явная: все прямые дети `todo` → parent `todo`; смешанный прогресс → parent `in_progress`; все дети `done/aligned` → parent `done/aligned`. Для промежуточного состояния `sync_state` остаётся отдельным измерением и не форсируется в `aligned`.

## Проблема 2: карточка 2.4.4

`status_note` и `Не делать` правильно говорили, что задача реализует typed `pause-required` signal, а фактическая автопауза относится к эпику `4.3`. Но отмеченный критерий «дрейф схемы приводит к паузе монитора» был сформулирован как уже реализованная смена состояния.

Формулировка исправлена: drift даёт terminal no-retry disposition и typed `pause-required` signal; `Monitor.state` в `2.4.4` не меняется. Accepted slice risk повторного traversal до `4.3` записан в deferred requirements.

## Что сделано

- Расширена lifecycle validation для промежуточных состояний parent/children и покрыта тестами на epic и phase уровнях.
- Частично выполненные `0.3`, `2.7` и фаза `2` переведены в `in_progress/drifted` согласно общей policy.
- Переформулирован `2.4.4`: drift даёт terminal no-retry disposition и typed pause-required signal; `Monitor.state` здесь не меняется.
- Записан accepted slice risk: до `4.3` тот же drift может снова сработать на следующем schedule slot.

## Критерии приёмки

- [x] Все дети todo → parent может быть todo.
- [x] Есть начатый/завершённый ребёнок, но не все done → parent обязан отражать work-in-progress согласно документированной policy.
- [x] Все дети done/aligned → parent done/aligned.
- [x] `docs:ops:check` ловит regression для phase и epic levels.
- [x] `2.4.4` больше не утверждает фактическую автопаузу.
- [x] `deferred-requirements.md` явно фиксирует временный риск повторного drift traversal до `4.3`.

## TDD и проверка

- **RED — verify #1096** на `f87fc9b5bfdf27e3a61c68ed8cc09adb90bf4c76`: два новых partial-progress теста ожидаемо получили `check` exit code `0`; all-todo boundary и остальные 503 теста прошли.
- **Минимальная реализация** `fc6cb5ad86f2abc005b6fbee3b02901cd2989317`: общий `expectedParentStatus` и симметричная parent validation для epic→tasks и phase→epics.
- **Repository characterization — verify #1097**: усиленный checker нашёл ровно три существующих metadata mismatch — `0.3`, `2.7` и фазу `2`, без других lifecycle нарушений.
- Финальный canonical exact-tree verify фиксируется после refresh generated rollups.

## Не делать

- Не реализовывать autopause из эпика `4.3` в этой docs-ops задаче.
