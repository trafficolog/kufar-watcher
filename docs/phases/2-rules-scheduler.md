---
id: "2"
status: in_progress
sync_state: drifted
last_reviewed: 2026-09-12
status_note: "Фаза 2 в работе: эпики 2.1–2.4 закрыты; remediation 2.7 выполняется; power/catch-up 2.5 и morphology 2.6 остаются в очереди."
---

# Фаза 2 — Правила, матчинг, планировщик

## Цель

Из потока объявлений отбирается ровно то, что подходит под правило, и обходы идут по расписанию, переживая сон машины.

## Контекст

Опирается на фазу 1. Разблокирует фазы 3 и 4. Карточки задач пишутся перед стартом фазы, когда будет обратная связь от первого рабочего обхода.

## Эпики фазы

<!-- docs:ops:begin phase-2-epics -->
**Эпиков:** 7 · **done:** 4 · **в работе/план:** 3

| ID | Эпик | Статус | Sync | Ист. |
|----|------|--------|------|------|
| `2.1` | [Нормализация текста и glob-маски](../epics/2-1-morphology-globs.md) | ✅ done | 🟢 aligned | Нормализация текста и glob-маски — входит в срез MVP-1. |
| `2.2` | [Матчер ключевых слов](../epics/2-2-matcher.md) | ✅ done | 🟢 aligned | Отбор объявлений по ключевым словам. |
| `2.3` | [Фильтр продавца](../epics/2-3-seller-filter.md) | ✅ done | 🟢 aligned | Нативный тип продавца и персональный SellerBlock post-filter закрыты задачами 2.3.1 и 2.3.2. |
| `2.4` | [Планировщик на pg-boss](../epics/2-4-scheduler.md) | ✅ done | 🟢 aligned | Эпик закрыт: 2.4.1–2.4.4 delivery scope done; remediation 2.4.5 закрепляет per-Run source degradation без изменения retry/watermark policy, verify #915 GREEN. |
| `2.5` | [Питание и догоняющий обход](../epics/2-5-power-catchup.md) | ⬜ todo | 🟡 drifted | Корректная работа на машине, которая уходит в сон. |
| `2.6` | [Морфология русского языка](../epics/2-6-morphology.md) | ⬜ todo | 🟡 drifted | Русский стеммер и правило выбора между маской и морфологией — срез 0.4.0. |
| `2.7` | [Ремедиация повторного аудита фазы 2](../epics/2-7-phase2-audit-remediation.md) | 🔄 in_progress | 🟡 drifted | P0 remediation в работе: 2.7.1–2.7.3 закрыты; 2.7.11 закрывает docs lifecycle/drift semantics; P1/P2/P3 остаются очередью. |
<!-- docs:ops:end phase-2-epics -->

## Связанные документы

- Тактический план: `docs/ROADMAP.MD`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
- Правила отбора: `docs/superpowers/specs/matching-rules.md`
