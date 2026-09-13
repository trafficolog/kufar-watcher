---
id: "5.6"
phase: 5
status: todo
sync_state: drifted
last_reviewed: 2026-09-13
status_note: "Приёмка релиза 1.0.0 целиком; приёмка среза MVP-1 — в задаче 5.0.4."
roles:
  - QA
---

# Эпик 5.6 — E2E-приёмка релиза

## Цель

Сквозные сценарии в Playwright плюс ручной прогон на боевых ссылках: пять реальных мониторов, сутки работы, включая цикл сна машины и период тишины.

Это приёмка релиза `1.0.0`, а не среза MVP-1: сон и тихие часы приходят только в `0.4.0`. Приёмка самого MVP-1 — задача `5.0.4`, она проще и выполняется раньше.

Из пяти реальных мониторов финального прогона минимум один должен использовать
request-buildable Minsk `igry-i-pristavki` shape (`r~minsk`, без operation и
path filters), и минимум один — request-buildable Minsk
`kupit/kvartiru` shape на `re.kufar.by` (без path filters и search query).
Adapter kinds `electronics` и `real-estate` не расширяют этот gate на всю
электронику или всю недвижимость. Финальный gate обязан повторно подтвердить
оба shape, которые проходят полную production-цепочку `parse → route → build API
request`; успех раннего MVP-1 gate `5.0.4` не заменяет эту проверку в `1.0.0`.

## Планируемые задачи

- `5.6.1` — E2E-сценарии панели управления
- `5.6.2` — Приёмочный прогон на боевых ссылках
- `5.6.3` — Чек-лист приёмки релиза 1.0.0

> Карточки задач для этого эпика ещё не созданы: детализируются перед
> стартом фазы, чтобы учесть обратную связь от предыдущих фаз.

## Дочерние карточки (rollup)

<!-- docs:ops:begin epic-5.6-tasks -->
**Задач:** 0 (карточки ещё не созданы)
<!-- docs:ops:end epic-5.6-tasks -->

## Критерии приёмки эпика

- [ ] Все дочерние задачи в статусе `done`
- [ ] `sync_state: aligned` (код соответствует карточкам)
- [ ] Тесты по эпику зелёные (unit/integration/e2e где применимо)
- [ ] Финальный ручной прогон включает минимум один монитор на Minsk
      `r~minsk/igry-i-pristavki` shape и минимум один монитор на
      `re.kufar.by/l/minsk/kupit/kvartiru`; чек-лист `1.0.0` фиксирует успешный
      результат по обоим request-buildable shape
- [ ] Итоговая приёмка не объявляет поддержку `igry-i-pristavki` без Минска,
      electronics другого региона, rental `snyat/kvartiru`, `/elektronika`,
      домов или других semantics, которые текущий request builder не подтверждает

## Связанные документы

- Фаза: `docs/phases/5-*.md`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
- Current release request-buildable perimeter: `docs/superpowers/specs/kufar-mvp-routing-perimeter.md`
