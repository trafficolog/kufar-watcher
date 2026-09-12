---
id: "2.7"
phase: 2
status: todo
sync_state: drifted
last_reviewed: 2026-09-12
status_note: "Повторный аудит фазы 2 после интеграции 2.3.2: подтверждённые remediation-задачи по scheduler, matcher, run lifecycle, sellerType и docs contracts."
roles: [BACK, DB, QA]
---

# Эпик 2.7 — Ремедиация повторного аудита фазы 2

## Цель

Закрыть подтверждённые повторным аудитом дефекты и технические риски фазы 2 отдельными bounded-задачами, не смешивая исправления разных инвариантов в один большой патч.

## Основание

Повторное ревью от 2026-09-12 было перепроверено на `main` после merge задачи `2.3.2` (`c22b916238d4ddca869fd7865a6f7ea4cb92e113`). В эпик включены только находки, для которых остаётся воспроизводимое кодовое или контрактное основание.

Не считаются самостоятельными bugfix-задачами:

- смена пользовательской формы URL `cmp=0` на канонический `/bez-posrednikov` — семантическая нормализация; UI должен показывать исходный `sourceUrl`, если ссылка подписана как пользовательская;
- синтетический `re.kufar.by/l/kvartiru` — изменение parser запрещено без live recon, подтверждающего реальный маршрут.

## Приоритеты

- **P0:** `2.7.1`, `2.7.2`, `2.7.3`, `2.7.11`.
- **P1:** `2.7.4`, `2.7.5`, `2.7.6`.
- **P2:** `2.7.7`, `2.7.9`, `2.7.10`.
- **P3:** `2.7.8`.

## Дочерние карточки (rollup)

<!-- docs:ops:begin epic-2.7-tasks -->
**Задач:** 11 · **done:** 0
<!-- docs:ops:end epic-2.7-tasks -->

## Критерии приёмки эпика

- [ ] Все P0/P1 дефекты закрыты отдельными RED → GREEN циклами.
- [ ] P2/P3 либо реализованы, либо имеют подтверждённое решение о переносе с явным основанием.
- [ ] Не осталось двух независимо изменяемых источников seller type.
- [ ] Scheduler и Run lifecycle сохраняют инварианты при malformed data и restart.
- [ ] Matcher соответствует собственной спецификации нормализации и snippet.
- [ ] Docs lifecycle и формулировка `2.4.4` согласованы с фактическим runtime.

## Связанные документы

- План: `docs/superpowers/plans/2026-09-12-2-7-phase2-audit-remediation.md`
- Matching spec: `docs/superpowers/specs/matching-rules.md`
- Data model: `docs/superpowers/specs/data-model.md`
- Deferred requirements: `docs/superpowers/specs/deferred-requirements.md`
