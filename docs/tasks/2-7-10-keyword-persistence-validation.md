---
id: "2.7.10"
phase: 2
epic: "2.7"
status: in_progress
sync_state: drifted
last_reviewed: 2026-09-13
status_note: "Persistence-boundary gap confirmed: MonitorConfigPatch.keywords can persist terms that the runtime matcher later rejects. RED/GREEN remediation in progress."
roles: [BACK, DB, QA]
depends_on: ["2.7.2", "1.4.2"]
estimated_hours: 2-3
agent: backend-senior
tags: [audit, matcher, validation, persistence, tdd, p0]
---

# Задача 2.7.10 — Валидация keywords на persistence boundary

## Проблема

Контракт матчера после задачи `2.7.2` однозначен: один term обязан нормализоваться ровно в один token; пустые и многословные термы являются ошибкой конфигурации. Однако `updateMonitorConfigTransaction()` сейчас валидирует `intervalSec` и canonical query, но `keywords` копирует в JSON без проверки matcher contract.

Из-за этого конфигурация вроде `['phone', 'playstation 5']` может успешно закоммититься, а ошибка возникнет позже только при реальном incremental run, когда matcher попытается скомпилировать сохранённый term. Persistence boundary не должен принимать состояние, которое runtime заведомо не способен исполнить.

## Решение для текущего среза

При mutation `MonitorConfigPatch.keywords` persistence boundary обязан прогнать каждый входящий term через существующий matcher compiler до `monitor.update()`. Это сохраняет один источник истины для normalization/glob/single-token semantics и не вводит отдельную validation реализацию.

Текущий patch contract `keywords?: readonly string[]` остаётся без изменения. Поддержка persisted object-формы `{ include, exclude }`, которую runtime уже умеет читать, не расширяется в mutation API этой задачей и остаётся отдельным вопросом будущего editor integration.

## Критерии приёмки

- [ ] RED на реальном PostgreSQL boundary доказывает, что invalid multi-token keyword сейчас коммитится вместо rejection.
- [ ] `updateMonitorConfig()` отклоняет keyword term, который matcher не может скомпилировать по single-token contract.
- [ ] Ошибка возникает до commit; исходные `Monitor.keywords` сохраняются.
- [ ] Полный `MonitorCursor`, включая catch-up checkpoint, остаётся неизменным после rejected keyword edit.
- [ ] Валидные literal/glob terms продолжают использовать существующую matcher semantics без второго normalizer/validator.
- [ ] Изменение keywords по-прежнему считается non-source edit и не сбрасывает cursor.
- [ ] Полный verify проходит на exact final HEAD.

## TDD evidence

- RED: ожидается после добавления PostgreSQL integration characterization.
- GREEN: ожидается после минимального reuse `matchingTermCompiler` на persistence boundary.

## Не делать

- Не добавлять phrase search, regex или новую matcher semantics.
- Не менять Prisma schema и не добавлять DB migration ради JSON validation.
- Не мигрировать legacy `string[]` в `{ include, exclude }` в этой задаче.
- Не расширять mutation contract будущего monitor editor.
- Не создавать второй набор правил нормализации/валидации термов.
