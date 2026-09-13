---
id: "0.2.7"
phase: 0
epic: "0.2"
status: done
sync_state: aligned
last_reviewed: 2026-09-13
roles: [BACK, DEVOPS, QA]
depends_on: ["0.2.6"]
estimated_hours: 1-2
agent: backend-senior
tags: [docker, dockerode, postgres, ci, audit, integration]
---

# Задача 0.2.7 — Live-проверка Dockerode runtime в CI

> Эпик 0.2 · Фаза 0 · ✅ done · зависит от: 0.2.6

## Цель

Закрыть audit-gap между unit/mocked покрытием Dockerode adapter-а и фактическим production-путём приложения: регулярно исполнять `createDockerClient()` → `createDockerodePostgresRuntime()` → `ensurePostgresContainer()` → `waitForPostgresHealthy()` против настоящего Docker daemon в GitHub Actions.

## Что сделано

- Добавлен opt-in integration test `tests/integration/dockerode-postgres-runtime.test.ts`, который использует production Docker client и production Dockerode runtime без mock-ов.
- Test runtime создаёт изолированный `postgres:16` container и named volume, использует отдельный host-port `55432`, отдельные credentials/database и не пересекается с compose integration на `5432`.
- Проверяются реальный Docker ping, create/start, healthcheck и точный `inspectContainer()` contract: image, volume, host, port, user, password, database и `running: true`.
- `beforeEach`/`afterEach` cleanup принудительно удаляет test container и named volume; игнорируется только Docker `404`.
- В `verify.yml` добавлен отдельный шаг `Dockerode runtime integration` перед compose integration, чтобы сбой production Dockerode boundary был диагностически отделён от compose/Postgres suite.
- Production Docker/Postgres runtime не изменялся: live gate подтвердил существующее поведение как корректное.

## Критерии приёмки

- [x] CI подключается к настоящему Docker daemon через production `createDockerClient()`.
- [x] Production Dockerode runtime создаёт и запускает отсутствующий Postgres 16 container.
- [x] `waitForPostgresHealthy()` дожидается `healthy` на реальном container healthcheck.
- [x] `inspectContainer()` возвращает ожидаемые image/volume/host/port/credentials/database и `running: true`.
- [x] Integration fixture гарантированно очищает container и named volume.
- [x] Gate выполняется отдельно от compose integration и не требуется обычному `npm test`.
- [x] Полный repository verify остаётся GREEN после добавления gate.

## Проверка и evidence

- Первый live run #1395 доказал, что test действительно дошёл до production Dockerode path; падение через ровно 5 секунд было вызвано default Vitest timeout, а не runtime error.
- После явного per-test timeout `90_000` и канонического Prettier форматирования branch verify #1397 на `92a7f27a3ca373f4ef8ecc521ed7a819f4567a3d` прошёл documentation consistency, 592 unit tests, failure-mode self-check, typecheck, lint, formatting, live Dockerode runtime integration, compose/Postgres integration, build и оба launch smoke.
- PR verify #1398 повторно подтвердил live Dockerode gate на том же exact head SHA перед merge.

## Границы

Не входит в эту карточку:

- изменение production Dockerode/Postgres lifecycle при отсутствии доказанного runtime-дефекта;
- Windows named-pipe integration на Linux GitHub runner;
- UX восстановления при несовместимой конфигурации существующего container;
- замена compose integration suite новым Dockerode gate;
- изменение credentials persistence или Prisma datasource contract.
