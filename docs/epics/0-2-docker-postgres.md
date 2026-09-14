---
id: "0.2"
phase: 0
status: done
sync_state: aligned
last_reviewed: 2026-09-14
status_note: "8/8 done: compose Postgres, Dockerode supervision, recoverable bootstrap, existing-container validation, a single POSTGRES_* source-of-truth, live Dockerode CI and safe incompatible-container recovery UX are implemented and verified."
roles:
  - BACK
  - DEVOPS
  - FRONT
---

# Эпик 0.2 — Postgres в Docker под Dockerode

## Цель

Пользователь не должен вручную поднимать контейнер. Приложение при старте проверяет Docker, поднимает БД, ждёт готовности и только потом запускает воркер; на каждом шаге показывает внятное состояние.

## Планируемые задачи

- `0.2.1` — docker-compose с Postgres 16
- `0.2.2` — Супервизор контейнера через Dockerode
- `0.2.3` — Экран состояния инфраструктуры
- `0.2.4` — Восстановимый production bootstrap
- `0.2.5` — Валидация конфигурации существующего Postgres-контейнера
- `0.2.6` — Единый источник Postgres connection config
- `0.2.7` — Live-проверка production Dockerode runtime в CI
- `0.2.8` — Recovery UX для несовместимого Postgres-контейнера

## Дочерние карточки (rollup)

<!-- docs:ops:begin epic-0.2-tasks -->
**Задач:** 8 · **done:** 8

| ID | Задача | Статус | Sync |
|----|--------|--------|------|
| `0.2.1` | [docker-compose с Postgres 16](../tasks/0-2-1-compose-postgres.md) | ✅ done | 🟢 aligned |
| `0.2.2` | [Супервизор контейнера через Dockerode](../tasks/0-2-2-dockerode-supervisor.md) | ✅ done | 🟢 aligned |
| `0.2.3` | [Экран состояния инфраструктуры](../tasks/0-2-3-infra-status-screen.md) | ✅ done | 🟢 aligned |
| `0.2.4` | [Восстановимый production bootstrap](../tasks/0-2-4-bootstrap-remediation.md) | ✅ done | 🟢 aligned |
| `0.2.5` | [Валидация конфигурации существующего Postgres-контейнера](../tasks/0-2-5-postgres-container-configuration.md) | ✅ done | 🟢 aligned |
| `0.2.6` | [Единый источник Postgres connection config](../tasks/0-2-6-postgres-connection-source.md) | ✅ done | 🟢 aligned |
| `0.2.7` | [Live-проверка Dockerode runtime в CI](../tasks/0-2-7-dockerode-ci-runtime.md) | ✅ done | 🟢 aligned |
| `0.2.8` | [Recovery UX для несовместимого Postgres-контейнера](../tasks/0-2-8-postgres-mismatch-recovery-ux.md) | ✅ done | 🟢 aligned |
<!-- docs:ops:end epic-0.2-tasks -->

## Критерии приёмки эпика

- [x] Все дочерние задачи в статусе `done`
- [x] `sync_state: aligned` (код соответствует карточкам)
- [x] Тесты по эпику зелёные (unit/integration/e2e где применимо)

## Связанные документы

- Фаза: `docs/phases/0-*.md`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
