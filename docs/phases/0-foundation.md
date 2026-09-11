---
id: "0"
status: in_progress
sync_state: drifted
last_reviewed: 2026-09-11
status_note: "Фаза 0 частично завершена: 0.1 и 0.2 done, 0.3 остаётся открытым из-за schema slices 0.3.4–0.3.6, 0.4 remediation aligned pending final verify."
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
| `0.1` | [Скелет Electron](../epics/0-1-electron-shell.md) | ✅ done | 🟢 aligned | 3/3 done: Electron shell, utilityProcess model and typed IPC contract are implemented and verified. |
| `0.2` | [Postgres в Docker под Dockerode](../epics/0-2-docker-postgres.md) | ✅ done | 🟢 aligned | 4/4 done: compose Postgres, Dockerode supervisor, infrastructure status UI and recoverable production bootstrap are implemented. |
| `0.3` | [Prisma-схема и миграции](../epics/0-3-prisma-schema.md) | ⬜ todo | 🟡 drifted | Доменная модель в БД. |
| `0.4` | [docs-ops, линт и CI](../epics/0-4-docs-ops-ci.md) | 🔄 in_progress | 🟢 aligned | 2 delivery tasks done; remediation 0.4.3 implementation aligned, full verify pending before closure. |
<!-- docs:ops:end phase-0-epics -->

## Связанные документы

- Тактический план: `docs/ROADMAP.MD`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
- Правила отбора: `docs/superpowers/specs/matching-rules.md`
