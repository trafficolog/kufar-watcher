---
id: "1.2.5"
phase: 1
epic: "1.2"
status: done
sync_state: aligned
last_reviewed: 2026-09-14
roles: [BACK, QA]
depends_on: ["1.2.3"]
estimated_hours: 1-2
agent: backend-senior
tags: [network, debug, drift, remediation]
status_note: "Terminal 2xx/429/4xx/exhausted-5xx/unexpected HTTP responses now use the existing raw-response journal; intermediate retryable 5xx and transport failures remain unjournaled. RED #1432; GREEN #1434."
---

# Задача 1.2.5 — Журналирование terminal HTTP responses

> Эпик 1.2 · Фаза 1 · ✅ done · зависит от: 1.2.3 · оценка: 1-2 ч

## Цель

Сохранять в существующий bounded raw-response journal тот HTTP-ответ, который становится terminal результатом `KufarHttpClient.get()`, включая non-2xx, без изменения retry/error/cooldown policy.

## Контекст

Задача 1.2.3 намеренно подключила filesystem journal только к успешным `2xx`. Позже HTTP-клиент стал возвращать raw body также для `429`, permanent `4xx`, exhausted `5xx` и unexpected HTTP statuses. Для диагностики drift эти terminal bodies теперь попадают в тот же journal; transport/network failures без HTTP response по-прежнему не имеют snapshot.

## Критерии приёмки

- [x] Terminal `2xx`, `429`, permanent `4xx`, exhausted `5xx` и unexpected HTTP response сохраняются через существующий `journal.record({ requestUrl, status, body })`.
- [x] Retryable промежуточные `5xx` не создают snapshots; если retry восстанавливается в `2xx`, сохраняется только успешный ответ, а если retries исчерпаны — только последний `5xx`.
- [x] Transport/network/timeout failure без HTTP response не журналируется.
- [x] Ошибка journal остаётся non-blocking: возвращаемый HTTP outcome, attempts, retry/cooldown semantics и raw body не изменяются; наружу выходит только безопасное warning-сообщение.
- [x] Schema/version, retention и endpoint bucketing существующего raw-response journal не меняются.
- [x] Полный canonical verify pipeline GREEN.

## TDD и проверка

- RED: commit `79fec93718175ce5502098942ebc81124b670002`, PR #60, verify #1432 — docs consistency GREEN; 589 passed / 6 failed / 50 skipped. Все 6 failures относились только к отсутствующему terminal journal hook.
- Canonical task/lifecycle до production: commit `3a8ef05ccbb197c104617b2d4f148c0f57c97a65`; verify #1433 подтвердил docs consistency GREEN и сохранил ожидаемый RED на unit step.
- GREEN: commit `d17df1ec8f049e92c2b8a86c510a0e6076f596e5`, verify #1434 — полный canonical workflow GREEN: docs, unit/self-check, typecheck, lint, formatting, Dockerode, PostgreSQL compose, build/output и development/production Electron smoke.

## Реализация

- Общая non-blocking логика `journal.record` вынесена в private helper HTTP-клиента и переиспользуется всеми terminal HTTP branches.
- Retryable `5xx` остаётся перед journal call: пока доступна следующая попытка, клиент делает backoff/continue без snapshot.
- `429` сначала применяет существующий global cooldown, затем сохраняет terminal raw response; journal failure не отменяет cooldown.

## Не делать

- Не журналировать промежуточные retry attempts.
- Не создавать synthetic snapshot для network/timeout failure без HTTP response.
- Не менять retry count/backoff, `429` cooldown, timeout mapping или HTTP classification.
- Не менять filesystem journal schema, retention, Prisma, IPC или UI.
