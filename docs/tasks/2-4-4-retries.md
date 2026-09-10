---
id: "2.4.4"
phase: 2
epic: "2.4"
status: done
sync_state: aligned
last_reviewed: 2026-09-10
roles: [BACK]
depends_on: ["2.4.3"]
estimated_hours: 2-3
agent: backend-senior
tags: [scheduler, resilience]
status_note: "Bounded pg-boss retries настроены для transient network/timeout/5xx; 429 остаётся в limiter cooldown без job retry, permanent failures завершаются без retry, schema drift публикует typed pause-required signal без реализации автопаузы. Schedule сохраняется после failed job, intervalSec не меняется после серии ошибок. GREEN: verify #854 на 1b10567bcd35a0feba4430a9ce5ec92f1bc41536."
---

# Задача 2.4.4 — Ретраи расписания и деградация при ошибках

> Эпик 2.4 · Фаза 2 · ✅ done · зависит от: 2.4.3 · оценка: 2-3 ч

## Цель

Неудачный обход не ломает расписание и не превращается в бесконечный цикл попыток.

## Контекст

Сетевые сбои на домашней машине обычны. Реакция должна быть предсказуемой: несколько попыток, затем спокойное ожидание следующего слота, а не лавина запросов и не тихая остановка расписания.

## Что должно быть сделано

- Настроить ограниченные ретраи задания с экспоненциальной задержкой
- После исчерпания попыток обход считается неуспешным, расписание продолжает работать
- Серия неуспешных обходов **не меняет** `intervalSec` монитора: заданная человеком
  частота — это цель расписания, приложение её не переписывает
- Расти может только задержка ретраев внутри одного неуспешного обхода и общая
  пауза лимитера при `429`; и то и другое возвращается к норме само
- Классификацию ошибок брать из спеки контракта: `429`, временные, дрейф

## Критерии приёмки

- [x] Единичный сбой сети приводит к успеху после ретрая
- [x] Исчерпание попыток не останавливает расписание
- [x] Десять подряд неуспешных обходов не создают десятикратной нагрузки на площадку
- [x] После десяти неуспешных обходов `Monitor.intervalSec` в базе не изменился
- [x] Дрейф схемы приводит к паузе монитора, а не к ретраям

## TDD и проверка

- Retry policy зафиксирован на pg-boss schedule: `retryLimit: 2`, `retryDelay: 10`, `retryBackoff: true`, `retryDelayMax: 60`; актуальная документация pg-boss через Context7 подтверждает переход failed handler в `retry`, затем `failed` после исчерпания лимита, при сохранении отдельного cron schedule.
- Pause-required executor RED: `verify #842` — schema drift всё ещё пробрасывался как retryable error вместо terminal disposition.
- Executor GREEN и безопасный journal: `verify #845` — drift возвращает `pause-required`, permanent failures завершаются без retry; полный pipeline GREEN.
- Live wiring RED: `verify #846` на `90452b9f7d73ecc9b30432cd4ae19884b2175957` — worker application не передавал `onPauseRequired` в scheduled executor.
- Live wiring GREEN: `verify #848` на `69ebb3ab3f9920dc8e82a6afe522ea63f0b53467` — worker публикует typed `monitor-pause-required` event.
- Supervisor RED: `verify #849` на `b3af7d13a656bc254c3118c125e3db0bd1dc65ba` — main supervisor отбрасывал новый event старым whitelist.
- Supervisor GREEN: `verify #850` на `fd439baf9b3c484eba1c48264601999768c0cb24` — typed pause-required signal проходит worker → application → supervisor; фактическая автопауза намеренно остаётся задачей эпика 4.3.
- Error disposition characterization: `verify #851` на `beef4e42631679d435fa98485dee4fd98b4c607c` — network/timeout/5xx остаются retryable для pg-boss; `429` и permanent 4xx завершают job без pg-boss retry.
- Acceptance GREEN: `verify #854` на `1b10567bcd35a0feba4430a9ce5ec92f1bc41536` — 438 unit tests, PostgreSQL integration с десятью подряд retryable failures и неизменным `Monitor.intervalSec`, сохранение schedule/worker после failed job, docs consistency, typecheck, lint, formatting, build/output и оба Electron smoke полностью GREEN.

## Подсказки

- Классификация ошибок: `docs/superpowers/specs/kufar-api-contract.md`

## Не делать

- Не реализовывать автопаузу по дрейфу целиком: здесь только вызов, сама логика в эпике `4.3`
- Не вводить адаптивные интервалы ни под каким видом: это прямо запрещено конституцией
