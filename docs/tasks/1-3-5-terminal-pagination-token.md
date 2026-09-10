---
id: "1.3.5"
phase: 1
epic: "1.3"
status: done
sync_state: aligned
last_reviewed: 2026-09-10
roles: [BACK, QA]
depends_on: ["1.3.4"]
estimated_hours: 1-2
agent: backend-senior
tags: [kufar, pagination, normalization, remediation]
status_note: "Terminal pagination now treats label=next with token=null as end-of-results while preserving strict invalid-field handling for malformed non-null tokens. RED #874; implementation GREEN #877."
---

# Задача 1.3.5 — Terminal pagination token

> Эпик 1.3 · Фаза 1 · ✅ done · зависит от: 1.3.4 · оценка: 1-2 ч

## Цель

Исправить общий Kufar search normalizer так, чтобы terminal shape `label: "next", token: null` трактовался как конец пагинации (`nextCursor: null`), а не как schema drift.

## Контекст

До исправления `nextCursor()` уже возвращал `null`, когда элемента `label == "next"` не было, но при существующем `next` требовал `token` типа `string`. Из-за этого terminal response с явным `token: null` ошибочно превращался в `KufarNormalizationError`.

Общий normalizer используется electronics, real-estate и structured HTML fallback, поэтому исправление находится на этой общей границе, а не дублируется в adapters.

## Критерии приёмки

- [x] Отсутствующий `next` по-прежнему возвращает `nextCursor: null`.
- [x] `label: "next", token: null` возвращает `nextCursor: null`.
- [x] Строковый `next.token` возвращается без декодирования/преобразований.
- [x] Non-null malformed token (`number`, object, boolean и т. п.) остаётся `invalid-field` на `pagination.pages[next].token`.
- [x] Полный verify pipeline GREEN.

## TDD и проверка

- RED: `verify #874` на `f506acb079e2bc480f26bb72d29d029c7076188b` — новый terminal-null тест был единственным падающим: 445 passed / 1 failed / 32 skipped; normalizer выбрасывал `KufarNormalizationError` на `pagination.pages[next].token`.
- GREEN: `verify #877` на `a7fa4f55bc0822f93c3ecb4fc0f4507a5beb785e` — 446 unit tests, CI self-check, typecheck, lint, formatting, PostgreSQL compose integration, build/output и оба Electron smoke прошли успешно.

## Не делать

- Не менять traversal, retry/cooldown или HTTP transport.
- Не ужесточать отдельно семантику пустой строки cursor без подтверждённого Kufar contract.
- Не смешивать с real-estate URL parsing, degradation persistence или docs parent/child remediation.
