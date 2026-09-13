---
id: "2.7.8"
phase: 2
epic: "2.7"
status: done
sync_state: aligned
last_reviewed: 2026-09-13
roles: [BACK, QA]
depends_on: ["2.4.1", "2.7.1"]
estimated_hours: 3-4
agent: backend-senior
tags: [audit, scheduler, jitter, rate-limit, p3]
---

# Задача 2.7.8 — Детерминированное разнесение стартов мониторов

## Проблема

Одинаковые cron expressions выравнивают мониторы по стенному времени. Несколько правил могут одновременно создать burst работы, после чего общий limiter вынужден сериализовать очередь.

## Результат измерения

- Characterization для пяти активных мониторов с `intervalSec = 60` подтверждает одинаковый cron `* * * * *` до и после restart: job-level синхронизация действительно существует и стабильна.
- Отдельный characterization запускает пять `KufarHttpClient` одновременно через production-default worker-global limiter при детерминированном минимальном jitter (`0`). Фактические внешние старты: `0`, `2000`, `4000`, `6000`, `8000` ms.
- Production policy limiter остаётся `minIntervalMs = 2000` и jitter `0..3000`, поэтому каждый следующий внешний request стартует не раньше чем через 2 секунды; existing boundary tests отдельно фиксируют диапазон до 5 секунд.
- `WorkerSourceRuntime` создаёт один shared HTTP client для primary/fallback adapters и description loader; characterization дополнительно использует несколько отдельных `KufarHttpClient` и подтверждает, что default clients всё равно делят один worker-global limiter. Это консервативнее фактической runtime-композиции.
- Следовательно, burst остаётся внутренним на уровне scheduled jobs, но не превращается в одновременный burst запросов к Kufar.

## Решение

Stable scheduler stagger **не вводится**. Он не даёт дополнительной защиты внешней нагрузке поверх уже доказанного global limiter, зато добавил бы отдельную policy для offset/restart semantics и усложнил бы cron scheduling без подтверждённой необходимости. Пользовательский `intervalSec`, средняя частота каждого монитора и restart semantics остаются неизменными.

## Критерии приёмки

- [x] Characterization фиксирует одновременные старты нескольких одинаковых расписаний.
- [x] Решение не изменяет среднюю заданную частоту каждого монитора.
- [x] Restart characterization подтверждает тот же schedule identity/cron; отдельный offset не вводился.
- [x] Пять одновременно запрошенных внешних операций не стартуют одним burst: при минимальном jitter они разнесены на 2 секунды global limiter.
- [x] Карточка закрыта measurement-only с явным доказательством достаточности существующего limiter, а не предположением.

## Проверка

- Characterization commit: `fce89e1d1d8f308aa56f2509ed19e5c0f3e64fd1`.
- Verify **#1207** (`34752159533`) полностью GREEN: documentation consistency, unit tests, failure-mode self-check, typecheck, lint, formatting, PostgreSQL integration, build/output verification и оба Electron smoke.
- Production scheduler/runtime code в рамках задачи не изменялся.

## Не делать

- Не вводить adaptive interval/backoff между schedule slots.
