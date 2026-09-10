---
id: "1.5.3"
phase: 1
epic: "1.5"
status: in_progress
sync_state: drifted
last_reviewed: 2026-09-10
roles: [BACK]
depends_on: ["1.5.2"]
estimated_hours: 2-3
agent: backend-senior
tags: [network, cache, budget, remediation]
status_note: "Audit remediation in progress: cap real listing-detail HTTP requests at 10 per incremental Run without charging persistent cache hits."
---

# Задача 1.5.3 — Run-level budget detail requests

> Эпик 1.5 · Фаза 1 · 🔄 in_progress · зависит от: 1.5.2 · оценка: 2-3 ч

## Цель

Ограничить стоимость поиска по описанию: один incremental Run может выполнить не более 10 реальных HTTP-запросов карточек Kufar, при этом persistent cache hits не расходуют бюджет.

## Критерии приёмки

- [ ] На один incremental Run допускается не более 10 фактических detail HTTP requests.
- [ ] Persistent `available`/`unavailable` cache hits не расходуют budget.
- [ ] Проверка budget выполняется после cache miss и до `httpClient.get`, поэтому одиннадцатый запрос физически не отправляется.
- [ ] Исчерпание budget выбрасывает typed `DescriptionRequestBudgetExceededError` и не продвигает watermark/cursor.
- [ ] Scheduled Run журналирует исчерпание как `errorCategory='policy'`, `errorCode='description-budget-exhausted'`; ошибка остаётся retryable существующим scheduler-механизмом.
- [ ] Новый Run получает новый budget; успешно сохранённые description cache entries переиспользуются следующей попыткой.
- [ ] Pre-commit запись description cache явно считается staging/cache-семантикой и не означает commit monitor traversal.
- [ ] Полный verify pipeline GREEN.

## Не делать

- Не менять глобальный Kufar limiter, retry/cooldown policy или watermark traversal.
- Не вводить отдельный HTTP client/cache на каждый Run.
- Не менять правило 1.5.2: при `searchInDescription=true` description по-прежнему требуется каждому кандидату после дешёвых отсевов.
