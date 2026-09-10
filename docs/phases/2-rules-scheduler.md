---
id: "2"
status: todo
sync_state: drifted
last_reviewed: 2026-09-10
status_note: "Фаза 2: 2.1 и 2.2 закрыты; scheduler продвинут до 2.4.1–2.4.2 done, эпик 2.4 остаётся открытым 2/4; далее seller filter, Run journal/retries, power/catch-up и morphology."
---

# Фаза 2 — Правила, матчинг, планировщик

## Цель

Из потока объявлений отбирается ровно то, что подходит под правило, и обходы идут по расписанию, переживая сон машины.

## Контекст

Опирается на фазу 1. Разблокирует фазы 3 и 4. Карточки задач пишутся перед стартом фазы, когда будет обратная связь от первого рабочего обхода.

## Эпики фазы

<!-- docs:ops:begin phase-2-epics -->
**Эпиков:** 6 · **done:** 3 · **в работе/план:** 3

| ID | Эпик | Статус | Sync | Ист. |
|----|------|--------|------|------|
| `2.1` | [Нормализация текста и glob-маски](../epics/2-1-morphology-globs.md) | ✅ done | 🟢 aligned | Нормализация текста и glob-маски — входит в срез MVP-1. |
| `2.2` | [Матчер ключевых слов](../epics/2-2-matcher.md) | ✅ done | 🟢 aligned | Отбор объявлений по ключевым словам. |
| `2.3` | [Фильтр продавца](../epics/2-3-seller-filter.md) | ⬜ todo | 🟡 drifted | Исключение нежелательных продавцов. |
| `2.4` | [Планировщик на pg-boss](../epics/2-4-scheduler.md) | ✅ done | 🟢 aligned | Эпик закрыт: персональные pg-boss schedules, no-overlap, Run journal и bounded retry/degradation policy реализованы; 2.4.1–2.4.4 done, финальный acceptance 2.4.4 GREEN в verify #854. |
| `2.5` | [Питание и догоняющий обход](../epics/2-5-power-catchup.md) | ⬜ todo | 🟡 drifted | Корректная работа на машине, которая уходит в сон. |
| `2.6` | [Морфология русского языка](../epics/2-6-morphology.md) | ⬜ todo | 🟡 drifted | Русский стеммер и правило выбора между маской и морфологией — срез 0.4.0. |
<!-- docs:ops:end phase-2-epics -->

## Связанные документы

- Тактический план: `docs/ROADMAP.MD`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
- Правила отбора: `docs/superpowers/specs/matching-rules.md`
