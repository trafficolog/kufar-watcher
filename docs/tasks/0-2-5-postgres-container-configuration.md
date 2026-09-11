---
id: "0.2.5"
phase: 0
epic: "0.2"
status: done
sync_state: aligned
last_reviewed: 2026-09-11
roles: [BACK, FRONT, QA]
depends_on: ["0.2.4"]
estimated_hours: 2-3
agent: backend-senior
tags: [postgres, dockerode, bootstrap, remediation, tdd]
---

# Задача 0.2.5 — Валидация конфигурации существующего Postgres-контейнера

> Эпик 0.2 · Фаза 0 · ✅ done · зависит от: 0.2.4

## Цель

Закрыть review-gap в Dockerode bootstrap: приложение не должно молча запускать уже существующий контейнер `kufar-watcher-postgres`, если его фактическая конфигурация отличается от ожидаемой. Несовместимый контейнер должен остаться неизменённым, а запуск — завершиться диагностируемой ошибкой до healthcheck, миграций и worker.

## Что сделано

- Dockerode inspect нормализует image, named volume, host/port binding и `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`.
- `ensurePostgresContainer()` сравнивает существующий контейнер с ожидаемой конфигурацией до `start()`.
- При несовпадении бросается typed `PostgresContainerConfigurationError` с детерминированным массивом имён несовпавших полей.
- Значения credentials и других параметров не включаются в сообщение ошибки; наружу передаются только имена полей.
- Несовместимый контейнер не запускается, не удаляется и не пересоздаётся автоматически.
- Infrastructure bootstrap переводит typed mismatch в `BootState.errorCode = configuration-invalid`; healthcheck, миграции и worker после этого не запускаются.
- Boot UI объясняет, что параметры существующего контейнера несовместимы и контейнер оставлен без изменений.

## Критерии приёмки

- [x] Existing container валидируется по image, named volume, host, port, user, password и database до запуска.
- [x] Любой mismatch останавливает bootstrap и не вызывает `startContainer()` или `createContainer()`.
- [x] Ошибка typed и содержит только имена несовпавших полей, без secret/config values.
- [x] Bootstrap публикует `configuration-invalid` и не продолжает healthcheck, migrations или worker startup.
- [x] Boot UI даёт безопасный recovery-текст и сообщает, что существующий контейнер не изменён.
- [x] TDD RED зафиксирован отдельно для core policy, Dockerode normalization, typed error, bootstrap mapping и UI recovery.

## TDD и проверка

- RED #951 — stale existing container ошибочно доходил до запуска.
- RED #953 — Dockerode adapter не возвращал нормализованный configuration snapshot.
- RED #956 — comparator сообщал только image mismatch вместо полного набора полей.
- RED #958 — mismatch бросался обычным `Error`, а не typed configuration error.
- RED #960 — bootstrap сводил configuration mismatch к `database-timeout`.
- RED #962 — Boot UI не объяснял конфликт с существующим контейнером.
- GREEN: GitHub Actions `verify` #967 на `6f8c04fe1583dc8265520c079d9ac1327debc721` — documentation consistency, 464 unit tests, CI failure-mode self-check, typecheck, lint, formatting, PostgreSQL compose integration, build, development launch smoke и production launch smoke зелёные.

## Границы

Не входит в эту карточку:

- автоматическое удаление или пересоздание несовместимого контейнера;
- миграция данных между Docker volumes;
- изменение формата локального credentials-файла;
- изменение глобальной retry/restart политики bootstrap.
