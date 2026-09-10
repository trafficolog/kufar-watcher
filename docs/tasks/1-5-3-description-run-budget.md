---
id: "1.5.3"
phase: 1
epic: "1.5"
status: done
sync_state: aligned
last_reviewed: 2026-09-10
roles: [BACK]
depends_on: ["1.5.2"]
estimated_hours: 2-3
agent: backend-senior
tags: [network, cache, budget, remediation]
status_note: "Done: incremental Run caps real listing-detail HTTP requests at 10; persistent cache hits are free and budget exhaustion is a retryable policy failure. Verify #935 GREEN."
---

# Задача 1.5.3 — Run-level budget detail requests

> Эпик 1.5 · Фаза 1 · ✅ done · зависит от: 1.5.2 · оценка: 2-3 ч

## Цель

Ограничить стоимость поиска по описанию: один incremental Run может выполнить не более 10 реальных HTTP-запросов карточек Kufar, при этом persistent cache hits не расходуют бюджет.

## Критерии приёмки

- [x] На один incremental Run допускается не более 10 фактических detail HTTP requests.
- [x] Persistent `available`/`unavailable` cache hits не расходуют budget.
- [x] Проверка budget выполняется после cache miss и до `httpClient.get`, поэтому одиннадцатый запрос физически не отправляется.
- [x] Исчерпание budget выбрасывает typed `DescriptionRequestBudgetExceededError` и не продвигает watermark/cursor.
- [x] Scheduled Run журналирует исчерпание как `errorCategory='policy'`, `errorCode='description-budget-exhausted'`; ошибка остаётся retryable существующим scheduler-механизмом.
- [x] Новый Run получает новый budget; успешно сохранённые description cache entries переиспользуются следующей попыткой.
- [x] Pre-commit запись description cache явно считается staging/cache-семантикой и не означает commit monitor traversal.
- [x] Полный verify pipeline GREEN.

## Verification

- PR verify #935 GREEN на implementation HEAD `857bf31f399de56c68354d5fe183ca8d516f2027`.
- Unit suite: 455 passed; отдельно покрыты hard cap 10, отсутствие одиннадцатого HTTP, бесплатные persistent cache hits, fresh budget между Runs и journal classification.
- PostgreSQL compose integration GREEN: 10 staged descriptions переживают budget exhaustion, следующая попытка читает их из persistent cache без HTTP и расходует свежий budget только на оставшийся cache miss.
- Documentation consistency, CI failure-mode self-check, typecheck, lint, formatting, build/output verification, development launch smoke и production launch smoke GREEN.

## Не делать

- Не менять глобальный Kufar limiter, retry/cooldown policy или watermark traversal.
- Не вводить отдельный HTTP client/cache на каждый Run.
- Не менять правило 1.5.2: при `searchInDescription=true` description по-прежнему требуется каждому кандидату после дешёвых отсевов.
