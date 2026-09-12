---
id: "2.7"
phase: 2
status: in_progress
sync_state: drifted
last_reviewed: 2026-09-12
status_note: "P0 remediation в работе: 2.7.1–2.7.3 закрыты; 2.7.11 закрывает docs lifecycle/drift semantics; P1/P2/P3 остаются очередью."
roles: [BACK, DB, QA]
---

# Эпик 2.7 — Ремедиация повторного аудита фазы 2

## Цель

Закрыть подтверждённые повторным аудитом дефекты и технические риски фазы 2 отдельными bounded-задачами, не смешивая исправления разных инвариантов в один большой патч.

## Основание

Повторное ревью от 2026-09-12 было перепроверено на `main` после merge задачи `2.3.2` (`c22b916238d4ddca869fd7865a6f7ea4cb92e113`). В эпик включены только находки, для которых остаётся воспроизводимое кодовое или контрактное основание и которые можно закрыть независимо от будущего UI.

Не считаются самостоятельными bugfix-задачами этого эпика:

- смена пользовательской формы URL `cmp=0` на канонический `/bez-posrednikov` — семантическая нормализация; UI должен показывать исходный `sourceUrl`, если ссылка подписана как пользовательская;
- синтетический `re.kufar.by/l/kvartiru` — изменение parser запрещено без live recon, подтверждающего реальный маршрут;
- live scheduler sync после редактирования монитора — обязательный integration gate, но реальный mutation path появится только в UI-эпике `5.2`; находка перенесена в `5.2.4`, чтобы не блокировать фазу 2 будущей функциональностью.

## Приоритеты

- **P0:** `2.7.1`, `2.7.2`, `2.7.3`, `2.7.11`.
- **P1:** `2.7.4`, `2.7.5`, `2.7.6`.
- **P2:** `2.7.7`, `2.7.9`.
- **P3:** `2.7.8`.

## Дочерние карточки (rollup)

<!-- docs:ops:begin epic-2.7-tasks -->
**Задач:** 10 · **done:** 4

| ID | Задача | Статус | Sync |
|----|--------|--------|------|
| `2.7.1` | [Валидация интервала и изоляция scheduler startup](../tasks/2-7-1-scheduler-interval-isolation.md) | ✅ done | 🟢 aligned |
| `2.7.11` | [Lifecycle-контракт docs и точная семантика drift pause signal](../tasks/2-7-11-docs-lifecycle-audit-contract.md) | ✅ done | 🟢 aligned |
| `2.7.2` | [Контракт термов и симметричная нормализация](../tasks/2-7-2-matching-term-contract.md) | ✅ done | 🟢 aligned |
| `2.7.3` | [Terminal disposition при исчерпании description budget](../tasks/2-7-3-description-budget-terminal-disposition.md) | ✅ done | 🟢 aligned |
| `2.7.4` | [Целостность жизненного цикла Run](../tasks/2-7-4-run-lifecycle-integrity.md) | ⬜ todo | 🟡 drifted |
| `2.7.5` | [Единый источник истины для sellerType](../tasks/2-7-5-seller-type-single-source.md) | ⬜ todo | 🟡 drifted |
| `2.7.6` | [Process-independent запрет пересечения обходов](../tasks/2-7-6-durable-monitor-no-overlap.md) | ⬜ todo | 🟡 drifted |
| `2.7.7` | [Snippet только для совпадения в описании](../tasks/2-7-7-description-only-snippet.md) | ⬜ todo | 🟡 drifted |
| `2.7.8` | [Детерминированное разнесение стартов мониторов](../tasks/2-7-8-scheduler-start-stagger.md) | ⬜ todo | 🟡 drifted |
| `2.7.9` | [Конфигурируемый monitorMaxPages](../tasks/2-7-9-configurable-monitor-page-cap.md) | ⬜ todo | 🟡 drifted |
<!-- docs:ops:end epic-2.7-tasks -->

## Критерии приёмки эпика

- [ ] Все P0/P1 дефекты закрыты отдельными RED → GREEN циклами.
- [ ] P2/P3 либо реализованы, либо имеют подтверждённое решение о переносе с явным основанием.
- [ ] Не осталось двух независимо изменяемых источников seller type.
- [ ] Scheduler и Run lifecycle сохраняют инварианты при malformed data и restart.
- [ ] Matcher соответствует собственной спецификации нормализации и snippet.
- [ ] Docs lifecycle и формулировка `2.4.4` согласованы с фактическим runtime.
- [ ] Будущий editor integration gate сохранён в `5.2.4`, но не считается условием закрытия remediation-фазы 2.

## Связанные документы

- План: `docs/superpowers/plans/2026-09-12-2-7-phase2-audit-remediation.md`
- Matching spec: `docs/superpowers/specs/matching-rules.md`
- Data model: `docs/superpowers/specs/data-model.md`
- Deferred requirements: `docs/superpowers/specs/deferred-requirements.md`
