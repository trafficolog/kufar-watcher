---
id: "0.2.4"
phase: 0
epic: "0.2"
status: done
sync_state: aligned
last_reviewed: 2026-09-09
roles: [BACK, FRONT, QA]
depends_on: ["0.2.3"]
estimated_hours: 2-3
agent: backend-senior
tags: [bootstrap, postgres, electron, remediation, tdd]
---

# Задача 0.2.4 — Восстановимый production bootstrap

> Эпик 0.2 · Фаза 0 · ✅ done · зависит от: 0.2.3

## Цель

Закрыть production-gap, найденный ревью после завершения исходных карточек 0.2.1–0.2.3: упакованное приложение должно показывать окно и диагностируемое состояние даже без `.env`, а пользовательская кнопка журнала должна открывать реальный каталог диагностики.

## Что сделано

- Для packaged runtime добавлены локальные Postgres credentials первого запуска: пользователь и база `kufar`, криптографически случайный пароль, хранение в `userData/postgres-credentials.json` с режимом `0600`.
- Явные `POSTGRES_*` из окружения сохраняют приоритет, поэтому dev/CI поведение не ломается.
- Окно и system IPC создаются до чтения Postgres-конфига и запуска инфраструктурного bootstrap.
- Ошибка конфигурации переводится в `BootState.errorCode = configuration-invalid`, непредвиденный startup/unhandled rejection — в `unexpected-failure`.
- Boot UI получил отдельные сообщения для обоих новых кодов ошибок.
- `Открыть журнал` создаёт при необходимости и открывает `userData/raw-responses`; непустая ошибка `shell.openPath()` пробрасывается вызывающему коду.
- Удалён хрупкий source-string тест, который проверял конкретное написание wiring вместо поведения; путь journal покрыт поведенческими тестами.

## Критерии приёмки

- [x] Packaged runtime без `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` получает устойчивые локальные credentials и повторно использует их.
- [x] Файл credentials создаётся с restrictive permissions и не перезаписывается при следующем запуске.
- [x] Окно создаётся до конфигурации/инициализации инфраструктуры.
- [x] Ошибки конфигурации и непредвиденные startup failures видны пользователю через typed `BootState`.
- [x] Unhandled rejection проходит через тот же видимый failure path.
- [x] Кнопка журнала открывает фактический каталог raw-response journal.
- [x] Dev/CI могут продолжать задавать `POSTGRES_*` через окружение.
- [x] TDD RED зафиксирован до production-реализации.

## TDD и проверка

- RED: GitHub Actions `verify` #586 на `abca49eabd0e73a14bdfddd8bc267b6a555fdc55` — шесть новых поведенческих тестов падают по отсутствующим контрактам, существующие тесты зелёные.
- После production wiring run #592 выявил один устаревший source-string contract; поведение journal уже было зелёным. Тест заменён на существующие поведенческие проверки вместо подгонки production-кода под regex.
- GREEN: GitHub Actions `verify` #594 на `9b2d012f0df06eb8a94d653a9663dd8ea76ea6b8` — documentation consistency, unit tests, CI failure-mode self-check, typecheck, lint, formatting, PostgreSQL compose integration, build, development launch smoke и production launch smoke зелёные.

## Границы

Не входит в эту карточку:

- унификация docker-compose и Dockerode-описания контейнера;
- сброс restart budget воркера;
- parent/child consistency и freshness gate в docs-ops;
- watermark/backfill remediation.

Эти пункты разбираются отдельными review-remediation задачами, чтобы не смешивать независимые причины отказа в одном изменении.
