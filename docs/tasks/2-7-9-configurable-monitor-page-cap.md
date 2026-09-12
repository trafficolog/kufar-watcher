---
id: "2.7.9"
phase: 2
epic: "2.7"
status: todo
sync_state: drifted
last_reviewed: 2026-09-12
roles: [BACK, QA]
depends_on: ["1.4.1"]
estimated_hours: 1-2
agent: backend-senior
tags: [audit, config, watermark, validation, p2]
---

# Задача 2.7.9 — Конфигурируемый monitorMaxPages

## Проблема

`WorkerConfig` содержит `monitorMaxPages`, но loader всегда присваивает `DEFAULT_MONITOR_MAX_PAGES = 5`. Это фактически константа, хотя page cap задуман как операционная конфигурация обхода.

## Критерии приёмки

- [ ] Default остаётся `5` при отсутствии override.
- [ ] Поддержанный config source позволяет явно задать page cap без изменения кода.
- [ ] Override валидируется как целое положительное число в разумных границах.
- [ ] Invalid override не приводит к скрытому fallback на опасное значение.
- [ ] Проверенное значение без преобразований передаётся в scheduled executor/traversal.
- [ ] Tests покрывают default, valid override и invalid values.

## Не делать

- Не вводить per-monitor page cap, пока это не требуется продуктовой спецификацией.
- Не убирать защитный upper bound.
