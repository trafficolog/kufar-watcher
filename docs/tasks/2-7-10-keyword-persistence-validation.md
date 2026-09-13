---
id: "2.7.10"
phase: 2
epic: "2.7"
status: done
sync_state: aligned
last_reviewed: 2026-09-13
status_note: "Persistence boundary validates every keyword with the existing matcher compiler before mutation; RED verify #1414 reproduced the invalid multi-token commit gap and GREEN verify #1415 passed the full workflow."
roles: [BACK, DB, QA]
depends_on: ["2.7.2", "1.4.2"]
estimated_hours: 2-3
agent: backend-senior
tags: [audit, matcher, validation, persistence, tdd, p0]
---

# Задача 2.7.10 — Валидация keywords на persistence boundary

## Проблема

Контракт матчера после задачи `2.7.2` однозначен: один term обязан нормализоваться ровно в один token; пустые и многословные термы являются ошибкой конфигурации. Однако `updateMonitorConfigTransaction()` валидировал `intervalSec` и canonical query, но `keywords` копировал в JSON без проверки matcher contract.

Из-за этого конфигурация вроде `['phone', 'playstation 5']` могла успешно закоммититься, а ошибка возникала позже только при реальном incremental run, когда matcher пытался скомпилировать сохранённый term. Persistence boundary не должен принимать состояние, которое runtime заведомо не способен исполнить.

## Решение для текущего среза

При mutation `MonitorConfigPatch.keywords` persistence boundary прогоняет каждый входящий term через существующий `matchingTermCompiler` до чтения и мутации monitor state. Это сохраняет один источник истины для normalization/glob/single-token semantics и не вводит отдельную validation реализацию.

Текущий patch contract `keywords?: readonly string[]` остаётся без изменения. Поддержка persisted object-формы `{ include, exclude }`, которую runtime уже умеет читать, не расширяется в mutation API этой задачей и остаётся отдельным вопросом будущего editor integration.

## Критерии приёмки

- [x] RED на реальном PostgreSQL boundary доказывает, что invalid multi-token keyword сейчас коммитится вместо rejection.
- [x] `updateMonitorConfig()` отклоняет keyword term, который matcher не может скомпилировать по single-token contract.
- [x] Ошибка возникает до commit; исходные `Monitor.keywords` сохраняются.
- [x] Полный `MonitorCursor`, включая catch-up checkpoint, остаётся неизменным после rejected keyword edit.
- [x] Валидные literal/glob terms продолжают использовать существующую matcher semantics без второго normalizer/validator.
- [x] Изменение keywords по-прежнему считается non-source edit и не сбрасывает cursor.
- [x] Полный verify проходит на implementation HEAD; финальный docs HEAD дополнительно проверяется перед merge.

## TDD evidence

- RED: verify #1414, run `34772636565`, head `5db47355686217532d5f1eb5aa31199a5e2903ab` — 592 unit tests, docs consistency, typecheck, lint, formatting и live Dockerode integration прошли; real PostgreSQL `monitor-config-persistence` дал ровно один ожидаемый failure (9 passed / 1 failed): invalid `playstation 5` завершился `promise resolved "undefined" instead of rejecting`.
- GREEN: verify #1415, run `34772768027`, head `fc8a9312800026be2eae331509314c1083479163` — полный workflow GREEN: 592 unit tests, docs consistency, typecheck, lint, formatting, live Dockerode integration, PostgreSQL integration с новым regression, build/output и оба Electron smoke.

## Не делать

- Не добавлять phrase search, regex или новую matcher semantics.
- Не менять Prisma schema и не добавлять DB migration ради JSON validation.
- Не мигрировать legacy `string[]` в `{ include, exclude }` в этой задаче.
- Не расширять mutation contract будущего monitor editor.
- Не создавать второй набор правил нормализации/валидации термов.
