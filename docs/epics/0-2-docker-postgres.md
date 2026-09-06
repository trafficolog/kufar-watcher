---
id: "0.2"
phase: 0
status: todo
sync_state: drifted
last_reviewed: 2026-09-05
status_note: "Автоподъём БД и понятная диагностика при её отсутствии."
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

## Дочерние карточки (rollup)

<!-- docs:ops:begin epic-0.2-tasks -->
**Задач:** 3 · **done:** 3

| ID | Задача | Статус | Sync |
|----|--------|--------|------|
| `0.2.1` | [docker-compose с Postgres 16](../tasks/0-2-1-compose-postgres.md) | ✅ done | 🟢 aligned |
| `0.2.2` | [Супервизор контейнера через Dockerode](../tasks/0-2-2-dockerode-supervisor.md) | ✅ done | 🟢 aligned |
| `0.2.3` | [Экран состояния инфраструктуры](../tasks/0-2-3-infra-status-screen.md) | ✅ done | 🟢 aligned |
<!-- docs:ops:end epic-0.2-tasks -->

## Критерии приёмки эпика

- [ ] Все дочерние задачи в статусе `done`
- [ ] `sync_state: aligned` (код соответствует карточкам)
- [ ] Тесты по эпику зелёные (unit/integration/e2e где применимо)

## Связанные документы

- Фаза: `docs/phases/0-*.md`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
