---
id: "3.1.3"
phase: 3
epic: "3.1"
status: done
sync_state: aligned
last_reviewed: 2026-09-13
roles: [BACK, DB]
depends_on: ["3.1.2"]
estimated_hours: 3-4
agent: backend-senior
tags: [telegram, queue]
---

# Задача 3.1.3 — Очередь исходящих с соблюдением лимитов

> Эпик 3.1 · Фаза 3 · ✅ done · зависит от: 3.1.2 · оценка: 3-4 ч

## Цель

Все исходящие сообщения проходят через очередь, которая соблюдает ограничения Telegram и переживает перезапуск.

## Контекст

Отправка напрямую из обхода означает потерю уведомления при любой ошибке сети и всплеск сообщений после долгой тишины. Очередь в базе решает и то, и другое, а заодно даёт естественное место для отложенной доставки в тихие часы, которая придёт в `3.3`.

## Что сделано

- Добавлена durable очередь `telegram-outbox` поверх pg-boss с PostgreSQL persistence, последовательным worker (`batchSize: 1`) и retry policy `5s` с exponential backoff до `60s`, максимум пять повторов.
- Delivery gate ограничивает попытки отправки в один чат интервалом не менее `3100ms`; отдельный unit-сценарий проверяет серию из двадцати сообщений.
- Ошибки отправки нормализуются в безопасный `TelegramSendFailure`: HTTP/сетевые, `429` и `5xx` считаются временными, остальные Telegram `4xx` — постоянными. Сырые ошибки и payload не попадают в journal.
- `Match.notifiedAt` читается и отмечается через отдельный Prisma repository. Метка записывается только после успешного `sendMessage`; уже отмеченная или удалённая находка не отправляется повторно.
- Outbox подключён к lifecycle utility worker: запускается после scheduler и останавливается до Telegram/source teardown.
- Гарантия очереди остаётся at-least-once. Точное допустимое окно дубля и end-to-end enqueue из notification pipeline остаются ответственностью `3.2.3`.

## Критерии приёмки

- [x] Двадцать сообщений подряд уходят без ошибок лимита
- [x] Перезапуск приложения не теряет неотправленные сообщения
- [x] Доставленный `Match` не отправляется повторно при обычном перезапуске очереди
- [x] Постоянная ошибка не ретраится бесконечно

## Проверка

- RED repository: новый unit-suite ожидаемо падал на отсутствии Prisma adapter для tri-state `Match.notifiedAt`; после минимальной реализации контракт стал GREEN.
- RED application wiring: новый composition-test ожидаемо показал, что outbox factory не вызывается; после lifecycle wiring тест стал GREEN.
- Verify `#1375` на `9c0b437635575e0db2a2d574df457ac72c58d5bf` полностью GREEN: 592 unit-теста, typecheck, lint, Prettier, Postgres integration, build, development smoke и production smoke.
- В реальном Postgres CI отдельно прошли `telegram-outbox-delivery-repository.test.ts` и `telegram-outbox-queue.test.ts`; второй создаёт pending pg-boss job, завершает первый queue instance и подтверждает доставку после создания нового instance.

## Подсказки

- Общий контекст — в карточке эпика и в `docs/AGENTS.md`

## Не делать

- Не реализовывать тихие часы: это эпик `3.3`, срез `0.4.0`
