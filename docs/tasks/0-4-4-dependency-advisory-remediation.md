---
id: "0.4.4"
phase: 0
epic: "0.4"
status: done
sync_state: aligned
last_reviewed: 2026-09-11
roles: [DEVOPS, QA]
depends_on: ["0.4.3"]
estimated_hours: 2-3
agent: devops-sre
tags: [security, dependencies, npm, prisma, ci, remediation, tdd]
status_note: "Done: Prisma 7.10.0 retained, deepmerge-ts/mysql2 overrides resolve to remediated versions, canonical audit gate is blocking, and verify #1011 is GREEN with 0 vulnerabilities."
---

# Задача 0.4.4 — Dependency advisory remediation

> Эпик 0.4 · Фаза 0 · ✅ done · зависит от: 0.4.3 · оценка: 2-3 ч

## Цель

Закрыть high-severity advisories в dependency graph без Prisma major upgrade/downgrade и без `npm audit fix --force`, сохранив фактический Prisma/PostgreSQL runtime contract Kufar Monitor.

## Диагностика и RED

Диагностический spike PR #41 закрыт без merge. GitHub Actions `verify` #1007 зафиксировал RED: `npm audit` завершился с exit 1 и показал четыре high affected nodes (`prisma`, `@prisma/config`, `deepmerge-ts`, `mysql2`), за которыми стоят две корневые проблемы:

- `prisma@7.10.0 -> @prisma/config@7.10.0 -> deepmerge-ts@7.1.5`; remediation target — `deepmerge-ts@8.0.1`.
- `prisma@7.10.0 -> mysql2@3.15.3`; remediation target — `mysql2@3.23.1`, закрывающий high credential disclosure advisory и moderate compressed-protocol DoS.

Практическая поверхность атаки Kufar Monitor уже уже headline severity: приложение использует PostgreSQL и не устанавливает MySQL connection, а `deepmerge-ts` находится в Prisma config loading path. При этом Prisma CLI остаётся runtime dependency: Electron production bootstrap запускает `prisma migrate deploy`, поэтому перенос `prisma` в `devDependencies` не является допустимым remediation.

## Дизайн remediation

- Prisma, `@prisma/client` и `@prisma/adapter-pg` остаются на текущей линии; `prisma` и `@prisma/client` — ровно `7.10.0`.
- Root `package.json` содержит npm overrides:
  - `deepmerge-ts: 8.0.1`;
  - `mysql2: 3.23.1`.
- `package-lock.json` регенерирован npm `11.4.2`, закреплённым в `packageManager` и canonical CI.
- Canonical `.github/workflows/verify.yml` содержит blocking gate `npm audit --audit-level=high` и exact-resolution check для обоих overrides.
- Overrides удаляются, когда стабильная используемая линия Prisma 7 перестанет резолвить уязвимые версии этих transitive dependencies и canonical lifecycle останется GREEN без overrides.

## Критерии приёмки

- [x] `npm audit --audit-level=high` завершается с exit 0; high/critical count равен 0.
- [x] Dependency tree резолвит ровно `deepmerge-ts@8.0.1` и `mysql2@3.23.1`.
- [x] Prisma остаётся `7.10.0`; версии `@prisma/client` и adapter не меняются этим remediation.
- [x] `prisma generate`, migrate/seed/reset и PostgreSQL compose integration GREEN.
- [x] Все существующие unit tests GREEN: 471 passed / 35 skipped.
- [x] Typecheck, lint и formatting GREEN.
- [x] Build, development Electron smoke и production Electron smoke GREEN.
- [x] Canonical CI постоянно блокирует будущие high/critical npm audit findings.
- [x] Причина overrides и условие их удаления задокументированы в этой карточке.

## Риск и rollback rule

`deepmerge-ts` пересекает major boundary `7 -> 8`, хотя Prisma 7.10.0 пинит `7.1.5`. Override принимается только при полном GREEN Prisma/PostgreSQL lifecycle и canonical suite. При любой будущей несовместимости override откатывается; тесты, audit threshold и runtime guarantees не ослабляются ради прохождения CI.

## Границы

Не входит в задачу:

- Prisma major upgrade/downgrade;
- `npm audit fix --force`;
- изменение Prisma schema или migrations;
- перевод Prisma CLI в dev-only dependency;
- изменение runtime database provider с PostgreSQL;
- подавление/ignore high advisory вместо remediation.

## TDD и проверка

- RED: GitHub Actions `verify` #1007 — dependency audit exit 1, 4 high affected nodes.
- Lock-sync RED: `verify` #1010 на `3fbcfc059c81557de7b47bb9cfe641df064b0c47` ожидаемо остановился на `npm ci`, потому что package overrides уже были изменены, а старый lockfile всё ещё содержал `deepmerge-ts@7.1.5` и `mysql2@3.15.3`.
- npm `11.4.2` regeneration: commit `c013610e02a66afd53e0d98a5359699cc2866c0a` закрепил `deepmerge-ts@8.0.1` и `mysql2@3.23.1` в `package-lock.json` без ручного редактирования dependency metadata.
- GREEN: GitHub Actions `verify` #1011 на `03e71572c8ea9b06e5207eccc4ed102089b4af40` — `npm ci` и Prisma Client generation 7.10.0 GREEN; `npm audit --audit-level=high` → `found 0 vulnerabilities`; `npm ls deepmerge-ts@8.0.1 mysql2@3.23.1` подтвердил оба override; docs consistency, 471 unit tests, CI failure-mode self-check, typecheck, lint, formatting, PostgreSQL migrate/seed/reset + integration, build, development smoke и production smoke GREEN.
