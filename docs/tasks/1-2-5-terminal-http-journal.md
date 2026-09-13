---
id: "1.2.5"
phase: 1
epic: "1.2"
status: in_progress
sync_state: aligned
last_reviewed: 2026-09-14
roles: [BACK, QA]
depends_on: ["1.2.3"]
estimated_hours: 1-2
agent: backend-senior
tags: [network, debug, drift, remediation]
status_note: "RED verify #1432 confirms terminal redirect/4xx/429/final-5xx responses are returned with raw bodies but are not persisted by the existing raw-response journal."
---

# Задача 1.2.5 — Журналирование terminal HTTP responses

> Эпик 1.2 · Фаза 1 · 🔄 in_progress · зависит от: 1.2.3 · оценка: 1-2 ч

## Цель

Сохранять в существующий bounded raw-response journal тот HTTP-ответ, который становится terminal результатом `KufarHttpClient.get()`, включая non-2xx, без изменения retry/error/cooldown policy.

## Контекст

Задача 1.2.3 намеренно подключила filesystem journal только к успешным `2xx`. Позже HTTP-клиент стал возвращать raw body также для `429`, permanent `4xx`, exhausted `5xx` и unexpected HTTP statuses. Для диагностики drift эти terminal bodies должны попадать в тот же journal; transport/network failures без HTTP response по-прежнему не имеют snapshot.

## Критерии приёмки

- [ ] Terminal `2xx`, `429`, permanent `4xx`, exhausted `5xx` и unexpected HTTP response сохраняются через существующий `journal.record({ requestUrl, status, body })`.
- [ ] Retryable промежуточные `5xx` не создают snapshots; если retry восстанавливается в `2xx`, сохраняется только успешный ответ, а если retries исчерпаны — только последний `5xx`.
- [ ] Transport/network/timeout failure без HTTP response не журналируется.
- [ ] Ошибка journal остаётся non-blocking: возвращаемый HTTP outcome, attempts, retry/cooldown semantics и raw body не изменяются; наружу выходит только безопасное warning-сообщение.
- [ ] Schema/version, retention и endpoint bucketing существующего raw-response journal не меняются.
- [ ] Полный canonical verify pipeline GREEN.

## TDD и проверка

- RED: commit `79fec93718175ce5502098942ebc81124b670002`, PR #60, verify #1432 — docs consistency GREEN; 589 passed / 6 failed / 50 skipped. Все 6 failures относятся только к отсутствующему terminal journal hook.
- GREEN: будет зафиксирован отдельным implementation commit после этой canonical task card.

## Не делать

- Не журналировать промежуточные retry attempts.
- Не создавать synthetic snapshot для network/timeout failure без HTTP response.
- Не менять retry count/backoff, `429` cooldown, timeout mapping или HTTP classification.
- Не менять filesystem journal schema, retention, Prisma, IPC или UI.
