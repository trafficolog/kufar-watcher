---
id: "2.7.3"
phase: 2
epic: "2.7"
status: done
sync_state: aligned
last_reviewed: 2026-09-12
roles: [BACK, QA]
depends_on: ["1.5.3", "2.4.4"]
estimated_hours: 1-2
agent: backend-senior
tags: [audit, scheduler, retry, budget, p0]
---

# Задача 2.7.3 — Terminal disposition при исчерпании description budget

## Проблема

`DescriptionRequestBudgetExceededError` корректно журналировался как policy error, но затем пробрасывался в pg-boss. При `retryLimit: 2` один schedule tick мог повторить полный traversal три раза и умножить как search, так и detail requests.

## Реализация

- `createScheduledMonitorRunExecutor()` после записи terminal `Run` возвращает существующий `{ cycleKind: 'failed-no-retry' }` для `DescriptionRequestBudgetExceededError`, поэтому текущая pg-boss job завершается без retry.
- Run остаётся ошибочным: `outcome=error`, `errorCategory=policy`, `errorCode=description-budget-exhausted`, без ложного success.
- Retry policy очереди не менялась: `network`, `timeout` и `http-5xx` по-прежнему пробрасываются из executor и используют bounded pg-boss retry.
- Лимит `DESCRIPTION_REQUEST_LIMIT_PER_RUN = 10` не менялся.
- Persistent description cache не потребовал production-изменений: успешный detail уже сохраняется до следующей попытки, а новый run сначала читает `descriptionLoadedAt` и получает cache hit до расходования нового request budget.

## Критерии приёмки

- [x] RED доказывает, что budget error сейчас rethrow-ится как retryable job failure.
- [x] GREEN возвращает terminal no-retry disposition для `DescriptionRequestBudgetExceededError`.
- [x] Run хранит `errorCategory=policy`, `errorCode=description-budget-exhausted` и terminal outcome без ложного success.
- [x] Один schedule tick не запускает повторный search traversal только из-за исчерпания detail budget.
- [x] Persistent description cache, записанный до лимита, используется следующим run.
- [x] Network/timeout/5xx по-прежнему получают bounded pg-boss retries.

## TDD и проверка

- **RED:** commit `2f8178787e6a3646bdf2622904989c18c42d77ea`, canonical verify **#1084** (`34694646451`) — новый budget test упал ровно потому, что executor отклонил promise с `DescriptionRequestBudgetExceededError`; три transient characterization case (`network`, `timeout`, `http-5xx`) прошли.
- **GREEN implementation:** commit `7d845550009e178b75e89cd9e0c11386ab2962eb` добавил только terminal no-retry branch после journal persistence. Verify **#1085** подтвердил новый regression test, но выявил старый characterization test, который всё ещё фиксировал прежнее retryable-поведение budget error.
- **Contract alignment:** commit `e94dbda05c9d78fc8ea3f951130a816e48653db0` обновил только устаревшее ожидание старого retry-disposition теста, сохранив journal assertions.
- **Persistent cache characterization:** commit `3dee0efc21fc71a8e16bee4cca4bca37b24db210` доказал двумя отдельными `ListingDescriptionCache` instances, что persisted description используется следующим run без HTTP и без `requestBudget.consume()`.
- **Code GREEN:** canonical verify **#1087** (`34694893254`) на `3dee0efc21fc71a8e16bee4cca4bca37b24db210` полностью GREEN: unit tests, CI failure-mode self-check, typecheck, lint, formatting, PostgreSQL compose integration, build, development Electron smoke и production Electron smoke.

## Не делать

- Не повышать лимит 10 как способ скрыть проблему.
- Не отключать bounded retries для transient source failures.
