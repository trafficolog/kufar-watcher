---
id: "0.2"
phase: 0
status: done
sync_state: aligned
last_reviewed: 2026-09-11
status_note: "5/5 done: compose Postgres, Dockerode supervisor, infrastructure status UI, recoverable production bootstrap and existing-container configuration validation are implemented."
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

## Дочерние карточки (rollup)

<!-- docs:ops:begin epic-0.2-tasks -->
**Задач:** 5 · **done:** 5

| ID | Задача | Статус | Sync |
|----|--------|--------|------|
| `0.2.1` | [docker-compose с Postgres 16](../tasks/0-2-1-compose-postgres.md) | ✅ done | 🟢 aligned |
| `0.2.2` | [Супервизор контейнера через Dockerode](../tasks/0-2-2-dockerode-supervisor.md) | ✅ done | 🟢 aligned |
| `0.2.3` | [Экран состояния инфраструктуры](../tasks/0-2-3-infra-status-screen.md) | ✅ done | 🟢 aligned |
| `0.2.4` | [Восстановимый production bootstrap](../tasks/0-2-4-bootstrap-remediation.md) | ✅ done | 🟢 aligned |
| `0.2.5` | [Валидация конфигурации существующего Postgres-контейнера](../tasks/0-2-5-postgres-container-configuration.md) | ✅ done | 🟢 aligned |
<!-- docs:ops:end epic-0.2-tasks -->

## Критерии приёмки эпика

- [x] Все дочерние задачи в статусе `done`
- [x] `sync_state: aligned` (код соответствует карточкам)
- [x] Тесты по эпику зелёные (unit/integration/e2e где применимо)

## Связанные документы

- Фаза: `docs/phases/0-*.md`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
