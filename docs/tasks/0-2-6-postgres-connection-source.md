---
id: "0.2.6"
phase: 0
epic: "0.2"
status: done
sync_state: aligned
last_reviewed: 2026-09-11
roles: [BACK, DEVOPS, QA]
depends_on: ["0.2.5"]
estimated_hours: 2-3
agent: backend-senior
tags: [postgres, prisma, configuration, remediation, tdd]
---

# Задача 0.2.6 — Единый источник Postgres connection config

> Эпик 0.2 · Фаза 0 · ✅ done · зависит от: 0.2.5

## Цель

Закрыть audit-gap между runtime и Prisma CLI: пользователь не должен поддерживать одновременно `POSTGRES_*` и отдельный `DATABASE_URL`, которые могут разойтись и направить tooling и приложение в разные базы.

## Что сделано

- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` закреплены как пользовательский source-of-truth для dev/CLI/Compose.
- `prisma.config.ts` после загрузки `.env` строит datasource URL только из `POSTGRES_*` и не использует входящий `DATABASE_URL`.
- Общий pure helper `createPostgresDatabaseUrl()` формирует URL для Prisma CLI и runtime с одинаковым percent-encoding credentials и `schema=public`.
- Production runtime по-прежнему создаёт `databaseUrl` из фактической Postgres container config и передаёт его worker и migration subprocess как внутреннее производное значение.
- `.env.example` больше не предлагает пользователю отдельный `DATABASE_URL`.
- Test DB tooling выставляет `DATABASE_URL` только как derived internal value через общий helper для integration worker contracts; Prisma CLI при этом получает datasource из `POSTGRES_*`.
- При полном отсутствии `POSTGRES_*` Prisma CLI сохраняет development defaults `kufar / change-me / kufar / 5432`, чтобы `prisma generate` и postinstall не требовали локальную `.env`.

## Критерии приёмки

- [x] Конфликтующий stale `DATABASE_URL` не переопределяет `POSTGRES_*` в Prisma config.
- [x] Prisma CLI и runtime используют один URL-builder и одинаково percent-encode специальные символы credentials.
- [x] Prisma development defaults сохраняются при отсутствии `POSTGRES_*`.
- [x] `.env.example` содержит только `POSTGRES_*` как пользовательский database configuration contract.
- [x] Test DB helper не собирает connection string отдельной строковой формулой.
- [x] Worker и production migration contracts с derived internal `DATABASE_URL` не изменены.
- [x] PostgreSQL compose integration подтверждает migrate/seed/reset и integration workers на новом контракте.

## TDD и проверка

- RED #999 на `7f2d7dd5400a9a3b3379364477bad40a822704a3` — 469 passed / 2 failed / 35 skipped: stale `DATABASE_URL` побеждал `POSTGRES_*`, а без `DATABASE_URL` Prisma config игнорировал переданные `POSTGRES_*`; default characterization оставалась GREEN.
- Implementation commit `489fc3f10d0e939f3bd79f929dbcaa7178bca65f` перевёл новые contract tests в GREEN; #1000 подтвердил 471 passed и выявил только lint issue в test helper.
- #1001 подтвердил lint GREEN и выявил только deterministic Prettier mismatch в новом тесте.
- GREEN: GitHub Actions `verify` #1002 на `f2346b590e0b254fbf8e5150c03a640e294b2611` — documentation consistency, 471 unit tests, CI failure-mode self-check, typecheck, lint, formatting, PostgreSQL compose integration, build, development launch smoke и production launch smoke зелёные.
- Context7 / Prisma 7: datasource URL задаётся через `prisma.config.ts`; `.env` загружается приложением явно, поэтому отдельный пользовательский `DATABASE_URL` не является обязательным контрактом Prisma.

## Границы

Не входит в эту карточку:

- изменение Prisma schema или migrations;
- изменение Docker container lifecycle и persisted credentials file;
- изменение worker `createPrismaClient()` API;
- добавление отдельного pooled/direct datasource contract;
- изменение production bootstrap retry/error semantics.
