---
id: "5.2.4"
phase: 5
epic: "5.2"
status: todo
sync_state: drifted
last_reviewed: 2026-09-12
roles: [FRONT, BACK, QA]
depends_on: ["2.4.1"]
estimated_hours: 2-4
agent: backend-senior
tags: [audit, scheduler, config, ipc, editor, integration]
---

# Задача 5.2.4 — Live scheduler sync после редактирования монитора

## Контекст

`updateMonitorConfigAndSync()` уже существует и покрыт unit-тестом, но production mutation path для редактирования монитора ещё не подключён. Поэтому это не текущий user-visible bug фазы 2, а обязательный integration gate для будущего редактора мониторов.

## Что сделать

Первый production path изменения monitor config должен использовать единый application service, который сохраняет конфигурацию и затем reconciles schedule без restart worker.

## Критерии приёмки

- [ ] Production mutation path не вызывает голый `updateMonitorConfig()` в обход scheduler sync.
- [ ] Изменение `intervalSec` активного монитора обновляет schedule без restart.
- [ ] `active/paused/archived` изменения добавляют/удаляют schedule и worker корректно.
- [ ] Query/sourceUrl cursor-reset transaction завершается до scheduler reconciliation.
- [ ] Если DB commit успешен, а sync не удался, ошибка наблюдаема и существует повторяемый reconcile path; конфигурация не откатывается притворно после commit.
- [ ] Integration test проходит через реальный mutation boundary, а не только helper unit-test.

## Не делать

- Не добавлять отдельный второй persistence path для UI.
- Не реализовывать редактор раньше соответствующей UI-задачи только ради закрытия audit finding.
