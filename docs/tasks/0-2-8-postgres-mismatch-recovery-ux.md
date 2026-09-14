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
status_note: "Bounded audit remediation: expose safe existing-container mismatch diagnostics through BootState and give the user a reversible manual rename-and-retry recovery path without destructive Docker operations."
---

# Задача 0.2.8 — Recovery UX для несовместимого Postgres-контейнера

> Эпик 0.2 · Фаза 0 · 🔄 in_progress · зависит от: 0.2.5

## Цель

Убрать тупик при обнаружении уже существующего `kufar-watcher-postgres` с несовместимой конфигурацией: пользователь должен отличать конфликт контейнера от повреждённой локальной конфигурации, видеть безопасную диагностику и получать конкретный обратимый путь восстановления.

## Контекст

`0.2.5` намеренно запретила автоматическое изменение несовместимого existing container и ввела `PostgresContainerConfigurationError` с детерминированным списком несовпавших полей. Сейчас bootstrap схлопывает эту ошибку в общий `configuration-invalid`, который используется также для локальных credentials/config failures. Renderer не получает mismatch metadata, а кнопка `Повторить` без внешнего действия воспроизводит тот же отказ.

Автоматическое удаление, пересоздание или повторное использование старого data volume без отдельной политики миграции небезопасно. В этой карточке recovery остаётся ручным и обратимым: пользователь переименовывает конфликтующий контейнер, сохраняя его и volumes, после чего существующий `retryBoot()` повторяет bootstrap и создаёт/поднимает ожидаемый контейнер по текущему production contract.

## Что должно быть сделано

- Добавить отдельный `BootErrorCode` для несовместимого existing Postgres container.
- Передавать через `BootState` только безопасный список несовпавших полей: `image`, `volumeName`, `host`, `port`, `user`, `password`, `database`; реальные значения и secrets наружу не передавать.
- Сохранять `configuration-invalid` для ошибок чтения/создания локальной Postgres configuration/credentials.
- Для container mismatch показывать имя `kufar-watcher-postgres`, человекочитаемый список несовпадений и конкретный обратимый recovery path: остановить при необходимости и переименовать конфликтующий контейнер, затем нажать `Повторить`.
- Для Windows ориентировать пользователя на Docker Desktop/`docker` CLI, для Linux — на `docker` CLI; не исполнять destructive команды из приложения.
- Использовать существующие действия `Повторить`, `Открыть журнал`, `Выйти` и существующий retry controller без нового destructive IPC.

## Критерии приёмки

- [ ] `PostgresContainerConfigurationError` отображается как отдельный typed boot failure, а не `configuration-invalid`.
- [ ] `BootState` для mismatch содержит только имена несовпавших полей и не содержит expected/actual values или secrets.
- [ ] Обычный `configuration-invalid` не получает Docker-specific recovery guidance.
- [ ] Boot UI называет конфликтующий `kufar-watcher-postgres`, объясняет, что существующий контейнер и volumes не удаляются, и предлагает rename + retry.
- [ ] Windows/Linux recovery text соответствует платформе и не предлагает автоматическое удаление/reset данных.
- [ ] Retry/cooldown worker/bootstrap semantics вне mismatch flow не изменены.
- [ ] Полный canonical verify pipeline GREEN.

## TDD и проверка

- RED должен доказать две текущие проблемы: потерю mismatch fields на bootstrap boundary и отсутствие mismatch-specific recovery guidance в UI.
- GREEN ограничивается typed diagnostic propagation и presentation/recovery copy; Docker runtime lifecycle и destructive operations не расширяются.

## Не делать

- Не удалять и не пересоздавать несовместимый контейнер автоматически.
- Не удалять, не переименовывать и не мигрировать Docker volumes из приложения.
- Не менять persisted Postgres credentials автоматически ради подгонки под existing container.
- Не добавлять новый privileged/destructive IPC action.
- Не менять глобальную retry/restart policy bootstrap или worker.
