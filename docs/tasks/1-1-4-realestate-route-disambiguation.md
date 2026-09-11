---
id: "1.1.4"
phase: 1
epic: "1.1"
status: done
sync_state: aligned
last_reviewed: 2026-09-11
roles: [BACK, QA]
depends_on: ["1.1.1"]
estimated_hours: 1-2
agent: backend-senior
tags: [parser, real-estate, routing, remediation]
status_note: "Regionless real-estate routes now recognize leading kupit/snyat as operation without inventing a region; regional routes and q~ path-filter semantics are preserved. RED #987; implementation GREEN #988."
---

# Задача 1.1.4 — Real-estate route disambiguation

> Эпик 1.1 · Фаза 1 · ✅ done · зависит от: 1.1.1 · оценка: 1-2 ч

## Цель

Устранить неоднозначность `re.kufar.by` listing routes: ведущий сегмент `kupit`/`snyat` должен распознаваться как операция для regionless URL, а не записываться в `CanonicalQuery.region`.

## Контекст

До remediation `parseRealEstatePath()` безусловно считал первый segment после `/l/` регионом. Поэтому `https://re.kufar.by/l/kupit/kvartiru` превращался в `region='kupit'`, `operation=null`, хотя набор операций `kupit`/`snyat` уже был частью подтверждённой parser-семантики.

При этом live recon подтверждает и region-first routes вроде `minsk/kupit/kvartiru` и `minsk-zavodskoj-rajon/snyat`; их семантика должна остаться неизменной. Goods-only marker `q~` не переносится на real-estate parser и остаётся обычным path filter.

## Критерии приёмки

- [x] `re.kufar.by/l/kupit/kvartiru` разбирается как `region=null`, `operation='kupit'`, `category='kvartiru'`.
- [x] `re.kufar.by/l/snyat/kvartiru` разбирается как `region=null`, `operation='snyat'`, `category='kvartiru'`.
- [x] Подтверждённые region-first routes продолжают разбираться с region + operation без изменений.
- [x] `q~...` на `re.kufar.by` не получает goods query-семантику и остаётся в `pathFilters`.
- [x] API mapping coverage не расширяется speculative mappings.
- [x] Полный verify pipeline GREEN.

## TDD и проверка

- RED: `verify #987` на `f46b4ed2e6f9e1f6c2a961ac20814fdb3e8ace1a` — 466 passed / 1 failed / 35 skipped; единственный failure показал `region='kupit'`, `operation=null`. Characterization `q~` была GREEN.
- GREEN: `verify #988` на `13941143cd6243f0b7838f4234db60ec633a1d53` — 467 unit tests, docs consistency, CI self-check, typecheck, lint, formatting, PostgreSQL integration, build/output и оба Electron smoke прошли успешно.

## Не делать

- Не вводить taxonomy/валидацию категорий без live evidence.
- Не расширять `confirmedApiParams()` новыми API mappings.
- Не переносить goods `r~`/`q~` semantics на real-estate routes.
