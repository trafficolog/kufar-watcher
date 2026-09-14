---
id: "0"
status: in_progress
sync_state: drifted
last_reviewed: 2026-09-11
status_note: "Фаза 0 частично завершена: 0.1, 0.2 и 0.4 done; 0.3 остаётся открытым из-за schema slices 0.3.4–0.3.6."
---

# Фаза 0 — Фундамент

## Цель

Приложение запускается на машине пользователя, само поднимает свою БД и имеет применённую схему данных.

## Контекст

Стартовая фаза, ни от чего не зависит. Разблокирует всё остальное: без процессной модели и БД ни один следующий эпик не имеет места, куда писать.

## Эпики фазы

<!-- docs:ops:begin phase-0-epics -->
**Эпиков:** 4 · **done:** 2 · **в работе/план:** 2

| ID | Эпик | Статус | Sync | Ист. |
|----|------|--------|------|------|
| `0.1` | [Скелет Electron](../epics/0-1-electron-shell.md) | ✅ done | 🟢 aligned | 4/4 done: Electron shell, utilityProcess model, typed IPC contract and worker crash-streak reset are implemented and verified. |
| `0.2` | [Postgres в Docker под Dockerode](../epics/0-2-docker-postgres.md) | 🔄 in_progress | 🟢 aligned | 7/8 done: compose Postgres, Dockerode supervision, recoverable bootstrap, existing-container validation, a single POSTGRES_* source-of-truth and a live CI gate are implemented; 0.2.8 adds safe recovery UX for incompatible existing containers. |
| `0.3` | [Prisma-схема и миграции](../epics/0-3-prisma-schema.md) | 🔄 in_progress | 🟡 drifted | 0.3.1–0.3.4 закрыты; schema-срезы 0.3.5 и 0.3.6 остаются запланированными для следующих релизных срезов. |
| `0.4` | [docs-ops, линт и CI](../epics/0-4-docs-ops-ci.md) | ✅ done | 🟢 aligned | 4/4 done: docs-ops CLI, canonical CI/freshness enforcement and dependency advisory remediation with blocking high/critical audit gate are implemented; verify #1011 GREEN. |
<!-- docs:ops:end phase-0-epics -->

## Связанные документы

- Тактический план: `docs/ROADMAP.MD`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
- Правила отбора: `docs/superpowers/specs/matching-rules.md`
