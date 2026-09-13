---
id: "3.1.2"
phase: 3
epic: "3.1"
status: done
sync_state: aligned
last_reviewed: 2026-09-13
roles: [BACK]
depends_on: ["3.1.1"]
estimated_hours: 2-3
agent: backend-senior
tags: [telegram, resilience]
---

# Задача 3.1.2 — Устойчивое переподключение long-polling

> Эпик 3.1 · Фаза 3 · ✅ done · зависит от: 3.1.1 · оценка: 2-3 ч

## Цель

Смена сети, сон машины и обрыв связи не должны требовать перезапуска приложения.

## Контекст

Long-polling на домашней машине рвётся регулярно. Если переподключение не сделано явно, дефект проявится как «уведомления перестали приходить после того, как ноутбук поспал» — и обнаружится не сразу.

## Что сделано

- Long-polling переведён на `@grammyjs/runner` с последовательной обработкой обновлений и ограниченным внутренним retry.
- Поверх transport session добавлено переподключение с задержками `1s → 2s → 4s → 8s → 16s → 30s` и потолком `30s`; успешное входящее обновление сбрасывает внешний backoff.
- Lifecycle защищён generation guard-ами: stale polling session не может запустить повторное переподключение после `configure`, `resume` или `stop`.
- `powerMonitor.resume` передаёт в worker credential-free сигнал `telegram-resume`; pending backoff отменяется и polling запускается сразу.
- Состояние transport-канала `disconnected | connected | reconnecting | error` публикуется worker → main → renderer как safe DTO без bot token.
- Ошибки transport/handler журналируются фиксированными сообщениями без содержимого token или исходного исключения.

## Граница ответственности

Durable очередь исходящих, повторная отправка сообщений после offline-периода, Telegram rate-limit policy и подтверждение доставки **не входят** в `3.1.2`. Это отдельная задача `3.1.3` — pg-boss outbox. Поэтому исторический пункт этой карточки про «не терять сообщения из очереди отправки» перенесён в ownership `3.1.3`, а не отмечен выполненным без реализации outbox.

## Критерии приёмки

- [x] Разрыв сети на пять минут восстанавливается без вмешательства
- [x] После пробуждения машины polling восстанавливается немедленно, без ожидания pending backoff
- [x] Состояние канала видно снаружи воркера и не содержит credential data
- [x] Durable outbound queue явно остаётся scope задачи `3.1.3`

## Проверка

- RED: verify `#1312` — шесть новых wiring-сценариев ожидаемо падали на отсутствующих resume/channel-state контрактах, существующие 565 тестов оставались зелёными.
- GREEN implementation checkpoint: verify `#1329` на `1012d210daabbf758944c867b9accf5a3c74797a` — docs consistency, 571 unit tests, failure-mode self-check, typecheck, lint, format, Postgres integration, build, dev smoke и production smoke прошли.
- Отдельные тесты покрывают reconnect policy, terminal polling recovery, reset backoff после входящего update, stop cancellation, five-minute outage, wake/resume wiring, fail-closed worker event parsing и renderer channel-state projection.

## Подсказки

- Общий контекст — в карточке эпика и в `docs/AGENTS.md`

## Не делать

- Не реализовывать экран состояния: это `5.0.3`
- Не реализовывать durable outbox и delivery retry: это `3.1.3`
