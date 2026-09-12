---
id: "2.7.3"
phase: 2
epic: "2.7"
status: todo
sync_state: drifted
last_reviewed: 2026-09-12
roles: [BACK, QA]
depends_on: ["1.5.3", "2.4.4"]
estimated_hours: 1-2
agent: backend-senior
tags: [audit, scheduler, retry, budget, p0]
---

# Задача 2.7.3 — Terminal disposition при исчерпании description budget

## Проблема

`DescriptionRequestBudgetExceededError` корректно журналируется как policy error, но затем пробрасывается в pg-boss. При `retryLimit: 2` один schedule tick способен повторить полный traversal три раза и умножить как search, так и detail requests.

## Что сделать

- Считать исчерпание run-level description budget терминальным для текущего schedule tick.
- Завершать job без pg-boss retry, сохраняя уже прогретый постоянный description cache.
- Следующий обычный cron slot должен продолжать обработку с cache progress.
- Не менять retry policy network/timeout/5xx.

## Критерии приёмки

- [ ] RED доказывает, что budget error сейчас rethrow-ится как retryable job failure.
- [ ] GREEN возвращает terminal no-retry disposition для `DescriptionRequestBudgetExceededError`.
- [ ] Run хранит `errorCategory=policy`, `errorCode=description-budget-exhausted` и terminal outcome без ложного success.
- [ ] Один schedule tick не запускает повторный search traversal только из-за исчерпания detail budget.
- [ ] Persistent description cache, записанный до лимита, используется следующим run.
- [ ] Network/timeout/5xx по-прежнему получают bounded pg-boss retries.

## Не делать

- Не повышать лимит 10 как способ скрыть проблему.
- Не отключать bounded retries для transient source failures.
