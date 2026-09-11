---
id: "0.1.4"
phase: 0
epic: "0.1"
status: done
sync_state: aligned
last_reviewed: 2026-09-11
roles: [BACK, QA]
depends_on: ["0.1.2"]
estimated_hours: 1-2
agent: backend-senior
tags: [electron, utility-process, supervisor, remediation, tdd]
---

# Задача 0.1.4 — Сброс серии аварий worker после ready

> Эпик 0.1 · Фаза 0 · ✅ done · зависит от: 0.1.2

## Цель

Закрыть review-gap в restart policy `utilityProcess`: fatal должен наступать только после более чем трёх последовательных аварий. Успешно стартовавший worker, который опубликовал `ready`, должен разрывать предыдущую серию падений и сбрасывать restart backoff.

## Что сделано

- `createWorkerSupervisor()` воспринимает валидный `WorkerEvent { type: 'ready' }` как успешную границу запуска.
- При `ready` сбрасывается счётчик последовательных аварий через существующий `restartPolicy.reset()`.
- Одновременно `restartAttempt` возвращается в `0`, поэтому следующая авария снова получает backoff `1s`, а не продолжает `2s/4s` последовательность.
- Проброс `ready` и остальных worker events наружу сохраняется без изменения IPC-контракта.
- Fatal после четырёх действительно последовательных unexpected exits сохраняется.

## Критерии приёмки

- [x] Сценарий `3 crash → ready → crash` не переводит supervisor в fatal.
- [x] После `ready` следующая авария получает restart delay `1000 ms`.
- [x] После `ready` worker снова запускается, если приложение не находится в shutdown.
- [x] Четыре последовательных аварии без промежуточного `ready` по-прежнему приводят к fatal.
- [x] Worker event contract и shutdown semantics не изменены.

## TDD и проверка

- RED #981 на `b886d2aea597ef73a370d0374afb28b66da75bf6`: 464 прежних теста зелёные, новый regression-test единственный падает, потому что после `ready` четвёртая авария ошибочно вызывает `Worker failed more than three times`.
- GREEN #982 на `f972c7f46f9e1d923c3dda989ab1522e8c3abf1d`: documentation consistency, 465 unit tests, CI failure-mode self-check, typecheck, lint, formatting, PostgreSQL compose integration, build, development launch smoke и production launch smoke зелёные.

## Границы

Не входит в эту карточку:

- изменение количества разрешённых последовательных рестартов;
- изменение IPC/WorkerEvent контракта;
- изменение worker runtime или scheduler lifecycle;
- изменение shutdown timeout или kill fallback.
