---
id: "1.5"
phase: 1
status: done
sync_state: aligned
last_reviewed: 2026-09-10
status_note: "3/3 done: persistent detail cache, two-stage description policy and per-Run 10-request detail budget; verify #935 GREEN."
roles:
  - BACK
---

# Эпик 1.5 — Догрузка описания карточки

## Цель

Выдача отдаёт усечённый текст, поэтому поиск ключей в описании требует отдельного запроса к карточке. Запрос делается только когда он действительно нужен, и результат кешируется.

## Планируемые задачи

- `1.5.1` — Загрузка полного описания и кеш
- `1.5.2` — Двухступенчатая стратегия «заголовок → описание»
- `1.5.3` — Run-level budget detail requests

## Дочерние карточки (rollup)

<!-- docs:ops:begin epic-1.5-tasks -->
**Задач:** 3 · **done:** 3

| ID | Задача | Статус | Sync |
|----|--------|--------|------|
| `1.5.1` | [Загрузка полного описания и кеш](../tasks/1-5-1-description-fetch.md) | ✅ done | 🟢 aligned |
| `1.5.2` | [Политика загрузки описания](../tasks/1-5-2-two-stage-match.md) | ✅ done | 🟢 aligned |
| `1.5.3` | [Run-level budget detail requests](../tasks/1-5-3-description-run-budget.md) | ✅ done | 🟢 aligned |
<!-- docs:ops:end epic-1.5-tasks -->

## Критерии приёмки эпика

- [x] Все дочерние задачи в статусе `done`
- [x] `sync_state: aligned` (код соответствует карточкам)
- [x] Тесты по эпику зелёные (unit/integration/e2e где применимо)

## Verification

- Remediation `1.5.3` закрыта полным PR verify #935 на implementation HEAD `857bf31f399de56c68354d5fe183ca8d516f2027`.
- Эпик сохраняет worker-scoped HTTP/cache ownership: persistent cache переиспользуется между попытками, а per-Run budget ограничивает только фактические detail HTTP requests.

## Связанные документы

- Фаза: `docs/phases/1-*.md`
- Контракт площадки: `docs/superpowers/specs/kufar-api-contract.md`
