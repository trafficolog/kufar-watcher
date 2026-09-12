---
id: "2.7.10"
phase: 2
epic: "2.7"
status: todo
sync_state: drifted
last_reviewed: 2026-09-12
roles: [BACK, QA]
depends_on: ["2.4.1", "5.0.1"]
estimated_hours: 2-4
agent: backend-senior
tags: [audit, scheduler, config, ipc, integration, p2]
---

# Задача 2.7.10 — Live scheduler sync в реальном config mutation path

## Контекст

`updateMonitorConfigAndSync()` существует и покрыт unit-тестом, но production mutation path для редактирования монитора ещё не подключён. Поэтому это не текущий user-visible bug, а обязательный integration gate до появления живого редактора/IPC записи.

## Что сделать

Когда появляется первый production path изменения monitor config, он должен использовать единый application service, который сохраняет конфигурацию и затем reconciles schedule без restart worker.

## Критерии приёмки

- [ ] Production mutation path не вызывает голый `updateMonitorConfig()` в обход scheduler sync.
- [ ] Изменение `intervalSec` активного монитора обновляет schedule без restart.
- [ ] `active/paused/archived` изменения добавляют/удаляют schedule и worker корректно.
- [ ] Query/sourceUrl cursor-reset transaction завершается до scheduler reconciliation.
- [ ] Если DB commit успешен, а sync не удался, ошибка наблюдаема и существует повторяемый reconcile path; конфигурация не откатывается притворно после commit.
- [ ] Integration test проходит через реальный mutation boundary, а не только helper unit-test.

## Не делать

- Не добавлять преждевременный UI только ради этой задачи.
