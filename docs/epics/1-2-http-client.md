---
id: "1.2"
phase: 1
status: done
sync_state: aligned
last_reviewed: 2026-09-11
status_note: "4/4 done: global limiter, resilient HTTP client, raw-response journal and stable application-level User-Agent are implemented and verified."
roles:
  - BACK
---

# Эпик 1.2 — HTTP-клиент и лимитер

## Цель

Все исходящие запросы идут через один клиент с общим лимитером, джиттером, таймаутами и ретраями. Ни один модуль не ходит в сеть мимо него.

## Планируемые задачи

- `1.2.1` — Глобальный лимитер с джиттером
- `1.2.2` — Клиент: таймауты, ретраи, обработка ошибок
- `1.2.3` — Журнал сырых ответов для отладки дрейфа
- `1.2.4` — Stable Kufar User-Agent

## Дочерние карточки (rollup)

<!-- docs:ops:begin epic-1.2-tasks -->
**Задач:** 4 · **done:** 4

| ID | Задача | Статус | Sync |
|----|--------|--------|------|
| `1.2.1` | [Глобальный лимитер с джиттером](../tasks/1-2-1-rate-limiter.md) | ✅ done | 🟢 aligned |
| `1.2.2` | [Клиент: таймауты, ретраи, обработка ошибок](../tasks/1-2-2-http-client.md) | ✅ done | 🟢 aligned |
| `1.2.3` | [Журнал сырых ответов для отладки дрейфа](../tasks/1-2-3-raw-log.md) | ✅ done | 🟢 aligned |
| `1.2.4` | [Stable Kufar User-Agent](../tasks/1-2-4-stable-user-agent.md) | ✅ done | 🟢 aligned |
<!-- docs:ops:end epic-1.2-tasks -->

## Критерии приёмки эпика

- [x] Все дочерние задачи в статусе `done`
- [x] `sync_state: aligned` (код соответствует карточкам)
- [x] Тесты по эпику зелёные (unit/integration/e2e где применимо)

## Результат — 2026-09-11

- Все Kufar HTTP attempts проходят через единый глобальный limiter с cadence 2–5 секунд и временным cooldown для `429`.
- HTTP-клиент использует bounded retries для network/timeout/`5xx`, не ретраит permanent `4xx`/unexpected statuses и возвращает typed result вместо raw network exceptions.
- `429` возвращается отдельным `rate-limited` outcome, уважает `Retry-After`, замедляет глобальный limiter и не запускает retry/fallback.
- Успешные `2xx` bodies могут сохраняться в bounded filesystem journal: пять последних snapshots на endpoint, с exact-byte fixture export и platform-correct `userData` storage config.
- Каждый запрос через `KufarHttpClient` получает стабильный application-level `User-Agent: kufar-watcher`, если caller не передал собственный; explicit case-insensitive override сохраняется без дубликата и без browser spoofing/rotation.
- TDD-история задач `1.2.1`–`1.2.4` подтверждена exact-SHA CI-проверками; schema comparison, traversal-level retries, fallback и UI экспорта остаются в своих последующих задачах.

## Связанные документы

- Фаза: `docs/phases/1-*.md`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
