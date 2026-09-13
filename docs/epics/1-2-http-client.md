---
id: "1.2"
phase: 1
status: done
sync_state: aligned
last_reviewed: 2026-09-14
status_note: "5/5 done: global limiter, resilient HTTP client, raw-response journal, stable application-level User-Agent and terminal HTTP response journaling are implemented and verified; 1.2.5 RED #1432 / GREEN #1434."
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
- `1.2.5` — Журналирование terminal HTTP responses

## Дочерние карточки (rollup)

<!-- docs:ops:begin epic-1.2-tasks -->
**Задач:** 5 · **done:** 5

| ID | Задача | Статус | Sync |
|----|--------|--------|------|
| `1.2.1` | [Глобальный лимитер с джиттером](../tasks/1-2-1-rate-limiter.md) | ✅ done | 🟢 aligned |
| `1.2.2` | [Клиент: таймауты, ретраи, обработка ошибок](../tasks/1-2-2-http-client.md) | ✅ done | 🟢 aligned |
| `1.2.3` | [Журнал сырых ответов для отладки дрейфа](../tasks/1-2-3-raw-log.md) | ✅ done | 🟢 aligned |
| `1.2.4` | [Stable Kufar User-Agent](../tasks/1-2-4-stable-user-agent.md) | ✅ done | 🟢 aligned |
| `1.2.5` | [Журналирование terminal HTTP responses](../tasks/1-2-5-terminal-http-journal.md) | ✅ done | 🟢 aligned |
<!-- docs:ops:end epic-1.2-tasks -->

## Критерии приёмки эпика

- [x] Все дочерние задачи в статусе `done`
- [x] `sync_state: aligned` (код соответствует карточкам)
- [x] Тесты по эпику зелёные (unit/integration/e2e где применимо)

## Результат — 2026-09-14

- Все Kufar HTTP attempts проходят через единый глобальный limiter с cadence 2–5 секунд и временным cooldown для `429`.
- HTTP-клиент использует bounded retries для network/timeout/`5xx`, не ретраит permanent `4xx`/unexpected statuses и возвращает typed result вместо raw network exceptions.
- `429` возвращается отдельным `rate-limited` outcome, уважает `Retry-After`, замедляет глобальный limiter и не запускает retry/fallback.
- Terminal HTTP response bodies (`2xx`, `429`, permanent `4xx`, exhausted `5xx`, unexpected status) могут сохраняться в bounded filesystem journal: пять последних snapshots на endpoint, с exact-byte fixture export и platform-correct `userData` storage config.
- Промежуточные retryable `5xx` и transport/network/timeout failures без HTTP response не создают raw snapshots.
- Каждый запрос через `KufarHttpClient` получает стабильный application-level `User-Agent: kufar-watcher`, если caller не передал собственный; explicit case-insensitive override сохраняется без дубликата и без browser spoofing/rotation.
- Journal failure остаётся non-blocking и не меняет HTTP outcome, retry count/backoff или `429` cooldown.
- TDD-история задач `1.2.1`–`1.2.5` подтверждена exact-SHA CI-проверками; `1.2.5`: RED verify #1432, GREEN verify #1434.

## Связанные документы

- Фаза: `docs/phases/1-*.md`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
