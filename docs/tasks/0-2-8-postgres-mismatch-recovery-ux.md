---
id: "0.2.8"
phase: 0
epic: "0.2"
status: done
sync_state: aligned
last_reviewed: 2026-09-14
roles: [BACK, FRONT, QA]
depends_on: ["0.2.5"]
estimated_hours: 2-3
agent: backend-senior
tags: [postgres, dockerode, bootstrap, recovery, ux, remediation, tdd]
status_note: "Incompatible existing Postgres containers now produce a dedicated safe boot diagnostic; binding-only conflicts get reversible stop/rename/retry guidance, while data-sensitive conflicts block simple retry pending manual backup/inspection/migration. RED #1437; GREEN #1444."
---

# Задача 0.2.8 — Recovery UX для несовместимого Postgres-контейнера

> Эпик 0.2 · Фаза 0 · ✅ done · зависит от: 0.2.5

## Цель

Убрать тупик при обнаружении уже существующего `kufar-watcher-postgres` с несовместимой конфигурацией: пользователь должен отличать конфликт контейнера от повреждённой локальной конфигурации, видеть безопасную диагностику и получать конкретный путь восстановления без автоматического удаления данных.

## Контекст

`0.2.5` намеренно запретила автоматическое изменение несовместимого existing container и ввела `PostgresContainerConfigurationError` с детерминированным списком несовпавших полей. До этой remediation bootstrap схлопывал ошибку в общий `configuration-invalid`, renderer не получал mismatch metadata, а кнопка `Повторить` без внешнего действия воспроизводила тот же отказ.

Простое `docker rename` + retry безопасно не для каждого mismatch. Если конфликт затрагивает `image`, `volumeName`, `user`, `password` или `database`, текущий fixed volume name может привести к повторному подключению несовместимого data volume либо к запуску с новым пустым volume. Поэтому recovery различает binding-only (`host`, `port`) и data-sensitive конфликты.

## Что сделано

- Добавлен отдельный `BootErrorCode = database-container-incompatible`.
- Через `BootState.postgresContainerMismatches` наружу передаются только имена несовпавших полей: `image`, `volumeName`, `host`, `port`, `user`, `password`, `database`; actual/expected values и secrets не передаются.
- `configuration-invalid` сохранён для ошибок локальной Postgres configuration/credentials и больше не содержит Docker-container guidance.
- Для binding-only mismatch (`host`/`port`) UI предлагает обратимый path: остановить `kufar-watcher-postgres`, переименовать контейнер, оставить его остановленным и нажать `Повторить`; data volume не удаляется.
- Если mismatch включает `image`, `volumeName`, `user`, `password` или `database`, UI явно запрещает простой rename + retry до ручного backup/inspection/migration planning.
- Windows guidance ссылается на Docker Desktop/`docker` CLI; Linux guidance использует `docker` CLI и read-only inspect commands.
- Существующие действия `Повторить`, `Открыть журнал`, `Выйти` и retry controller переиспользованы без нового destructive IPC.
- Docker runtime lifecycle, persisted credentials и worker retry/restart semantics не изменены.

## Критерии приёмки

- [x] `PostgresContainerConfigurationError` отображается как отдельный typed boot failure, а не `configuration-invalid`.
- [x] `BootState` для mismatch содержит только имена несовпавших полей и не содержит expected/actual values или secrets.
- [x] Обычный `configuration-invalid` не получает Docker-specific recovery guidance.
- [x] Boot UI называет конфликтующий `kufar-watcher-postgres` и показывает человекочитаемые имена несовпавших полей.
- [x] Для binding-only mismatch UI предлагает stop + rename + retry и не удаляет container/volume.
- [x] Для data-sensitive mismatch UI запрещает простой rename + retry до ручного backup/migration/inspection.
- [x] Windows/Linux recovery text соответствует платформе и не предлагает `docker rm`, reset volume или автоматическое пересоздание данных.
- [x] Retry/worker/bootstrap semantics вне mismatch flow не изменены.
- [x] Полный canonical verify pipeline GREEN.

## TDD и проверка

- RED: `7aad9cee3f2e0f967c3c0cd97eeca74afae07eac`, verify #1437 (`34815205112`) — docs consistency GREEN; 593 passed / 5 expected failures / 50 skipped. Failures точно показали потерю mismatch payload, отсутствие binding-only Windows/Linux guidance, отсутствие data-sensitive block и смешение generic `configuration-invalid` с Docker recovery.
- GREEN behavior: `f4297f67cde8a0a78eb015eeb19155bb3ed87240`, verify #1438 — 598 tests GREEN, self-check/typecheck/lint GREEN; единственный failure был механический `format:check` в трёх изменённых файлах.
- Canonical formatting: exact Prettier output получен временным CI probe и применён без semantic changes в `5cb55c23d837f931cbb0dc9c10a034f5d86175e4`.
- GREEN full: verify #1444 (`34817356066`) на `5cb55c23d837f931cbb0dc9c10a034f5d86175e4` — dependency audit, docs consistency, 598 unit tests, CI self-check, typecheck, lint, formatting, live Dockerode, PostgreSQL compose, build/output verification и оба Electron smoke полностью GREEN.

## Не делать

- Не удалять и не пересоздавать несовместимый контейнер автоматически.
- Не удалять, не переименовывать и не мигрировать Docker volumes из приложения.
- Не менять persisted Postgres credentials автоматически ради подгонки под existing container.
- Не добавлять новый privileged/destructive IPC action.
- Не менять глобальную retry/restart policy bootstrap или worker.
