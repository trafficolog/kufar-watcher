---
id: "0.1"
phase: 0
status: done
sync_state: aligned
last_reviewed: 2026-09-11
status_note: "4/4 done: Electron shell, utilityProcess model, typed IPC contract and worker crash-streak reset are implemented and verified."
roles:
  - BACK
  - FRONT
  - DEVOPS
---

# Эпик 0.1 — Скелет Electron

## Цель

Трёхпроцессная оболочка: `main` держит окно и жизненный цикл, `utilityProcess` исполняет всю фоновую работу, `renderer` на Vue 3 рисует интерфейс. Между ними — один типизированный контракт.

## Планируемые задачи

- `0.1.1` — Инициализация репозитория и тулчейна
- `0.1.2` — Процессная модель main + utilityProcess
- `0.1.3` — Типизированный IPC-контракт
- `0.1.4` — Сброс серии аварий worker после ready

## Дочерние карточки (rollup)

<!-- docs:ops:begin epic-0.1-tasks -->
**Задач:** 3 · **done:** 3

| ID | Задача | Статус | Sync |
|----|--------|--------|------|
| `0.1.1` | [Инициализация репозитория и тулчейна](../tasks/0-1-1-repo-toolchain.md) | ✅ done | 🟢 aligned |
| `0.1.2` | [Процессная модель main + utilityProcess](../tasks/0-1-2-process-model.md) | ✅ done | 🟢 aligned |
| `0.1.3` | [Типизированный IPC-контракт](../tasks/0-1-3-ipc-contract.md) | ✅ done | 🟢 aligned |
<!-- docs:ops:end epic-0.1-tasks -->

## Критерии приёмки эпика

- [x] Все дочерние задачи в статусе `done`
- [x] `sync_state: aligned` (код соответствует карточкам)
- [x] Тесты по эпику зелёные (unit/integration/e2e где применимо)

## Связанные документы

- Фаза: `docs/phases/0-*.md`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
