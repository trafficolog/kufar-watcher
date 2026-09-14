---
id: "0.2.8"
phase: 0
epic: "0.2"
status: in_progress
sync_state: aligned
last_reviewed: 2026-09-14
roles: [BACK, FRONT, QA]
depends_on: ["0.2.5"]
estimated_hours: 2-3
agent: backend-senior
tags: [postgres, dockerode, bootstrap, recovery, ux, remediation, tdd]
status_note: "Bounded audit remediation: expose safe existing-container mismatch diagnostics through BootState and give the user a non-destructive recovery path that distinguishes binding-only conflicts from data-sensitive mismatches."
---

# Задача 0.2.8 — Recovery UX для несовместимого Postgres-контейнера

> Эпик 0.2 · Фаза 0 · 🔄 in_progress · зависит от: 0.2.5

## Цель

Убрать тупик при обнаружении уже существующего `kufar-watcher-postgres` с несовместимой конфигурацией: пользователь должен отличать конфликт контейнера от повреждённой локальной конфигурации, видеть безопасную диагностику и получать конкретный путь восстановления без автоматического удаления данных.

## Контекст

`0.2.5` намеренно запретила автоматическое изменение несовместимого existing container и ввела `PostgresContainerConfigurationError` с детерминированным списком несовпавших полей. Сейчас bootstrap схлопывает эту ошибку в общий `configuration-invalid`, который используется также для локальных credentials/config failures. Renderer не получает mismatch metadata, а кнопка `Повторить` без внешнего действия воспроизводит тот же отказ.

Простое `docker rename` + retry безопасно не для каждого mismatch. Если конфликт затрагивает `image`, `volumeName`, `user`, `password` или `database`, текущий fixed volume name может привести к повторному подключению несовместимого data volume либо к запуску с новым пустым volume. Поэтому recovery должен различать binding-only (`host`, `port`) и data-sensitive конфликты.

## Что должно быть сделано

- Добавить отдельный `BootErrorCode` для несовместимого existing Postgres container.
- Передавать через `BootState` только безопасный список несовпавших полей: `image`, `volumeName`, `host`, `port`, `user`, `password`, `database`; реальные значения и secrets наружу не передавать.
- Сохранять `configuration-invalid` для ошибок чтения/создания локальной Postgres configuration/credentials.
- Для binding-only mismatch (`host`/`port`) показывать обратимый path: остановить `kufar-watcher-postgres`, переименовать контейнер, оставить его остановленным и нажать `Повторить`; data volume не удаляется.
- Если mismatch включает `image`, `volumeName`, `user`, `password` или `database`, явно предупреждать, что простой rename + retry небезопасен; не предлагать продолжать до ручного backup/migration/inspection данных.
- Для Windows ориентировать пользователя на Docker Desktop/`docker` CLI, для Linux — на `docker` CLI/read-only inspect commands; не исполнять destructive команды из приложения.
- Использовать существующие действия `Повторить`, `Открыть журнал`, `Выйти` и существующий retry controller без нового destructive IPC.

## Критерии приёмки

- [ ] `PostgresContainerConfigurationError` отображается как отдельный typed boot failure, а не `configuration-invalid`.
- [ ] `BootState` для mismatch содержит только имена несовпавших полей и не содержит expected/actual values или secrets.
- [ ] Обычный `configuration-invalid` не получает Docker-specific recovery guidance.
- [ ] Boot UI называет конфликтующий `kufar-watcher-postgres` и показывает человекочитаемые имена несовпавших полей.
- [ ] Для binding-only mismatch UI предлагает stop + rename + retry и не удаляет container/volume.
- [ ] Для data-sensitive mismatch UI запрещает простой rename + retry до ручного backup/migration/inspection.
- [ ] Windows/Linux recovery text соответствует платформе и не предлагает `docker rm`, reset volume или автоматическое пересоздание данных.
- [ ] Retry/worker/bootstrap semantics вне mismatch flow не изменены.
- [ ] Полный canonical verify pipeline GREEN.

## TDD и проверка

- RED должен доказать потерю mismatch fields на bootstrap boundary, отсутствие dedicated mismatch UI, смешение generic `configuration-invalid` с Docker recovery и отсутствие разделения binding-only/data-sensitive recovery.
- GREEN ограничивается typed diagnostic propagation и presentation/recovery copy; Docker runtime lifecycle и destructive operations не расширяются.

## Не делать

- Не удалять и не пересоздавать несовместимый контейнер автоматически.
- Не удалять, не переименовывать и не мигрировать Docker volumes из приложения.
- Не менять persisted Postgres credentials автоматически ради подгонки под existing container.
- Не добавлять новый privileged/destructive IPC action.
- Не менять глобальную retry/restart policy bootstrap или worker.
