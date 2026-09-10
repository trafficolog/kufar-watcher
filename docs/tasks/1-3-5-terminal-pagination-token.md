---
id: "1.3.5"
phase: 1
epic: "1.3"
status: todo
sync_state: drifted
last_reviewed: 2026-09-10
roles: [BACK, QA]
depends_on: ["1.3.4"]
estimated_hours: 1-2
agent: backend-senior
tags: [kufar, pagination, normalization, remediation]
status_note: "Review remediation: support a terminal pagination entry with label=next and token=null without weakening validation for malformed non-null cursor tokens."
---

# Задача 1.3.5 — Terminal pagination token

> Эпик 1.3 · Фаза 1 · 🚧 todo · зависит от: 1.3.4 · оценка: 1-2 ч

## Цель

Исправить общий Kufar search normalizer так, чтобы подтверждённый terminal shape `label: "next", token: null` трактовался как конец пагинации (`nextCursor: null`), а не как schema drift.

## Контекст

Сейчас `nextCursor()` уже возвращает `null`, когда элемента `label == "next"` нет, но при существующем `next` требует `token` типа `string`. Из-за этого terminal response с явным `token: null` ошибочно превращается в `KufarNormalizationError`.

Общий normalizer используется electronics, real-estate и structured HTML fallback, поэтому исправление должно находиться на этой общей границе, а не дублироваться в adapters.

## Критерии приёмки

- [ ] Отсутствующий `next` по-прежнему возвращает `nextCursor: null`.
- [ ] `label: "next", token: null` возвращает `nextCursor: null`.
- [ ] Строковый `next.token` возвращается без декодирования/преобразований.
- [ ] Non-null malformed token (`number`, object, boolean и т. п.) остаётся `invalid-field` на `pagination.pages[next].token`.
- [ ] Полный verify pipeline GREEN.

## Не делать

- Не менять traversal, retry/cooldown или HTTP transport.
- Не ужесточать отдельно семантику пустой строки cursor без подтверждённого Kufar contract.
- Не смешивать с real-estate URL parsing, degradation persistence или docs parent/child remediation.
