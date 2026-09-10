---
id: "2.4.3"
phase: 2
epic: "2.4"
status: done
sync_state: aligned
last_reviewed: 2026-09-10
roles: [BACK, DB]
depends_on: ["2.4.2"]
estimated_hours: 2-3
agent: backend-senior
tags: [scheduler, journal]
status_note: "Scheduled Run создаётся до обхода и финализируется в той же строке: success/catchup/error имеют duration/counters, overlap остаётся skipped, source/internal errors журналируются без секретов. GREEN: verify #826 на 0c3e5a460dbd9b9f0205c52499631f8cb4dc089a."
---

# Задача 2.4.3 — Журнал одного обхода

> Эпик 2.4 · Фаза 2 · ✅ done · зависит от: 2.4.2 · оценка: 2-3 ч

## Цель

Каждый обход оставляет понятную запись о результате, даже если новых объявлений нет.

## Контекст

Мониторинг, который молчит, двусмысленен: либо ничего нового, либо он не работал. `Run` — основа честности продукта и будущего экрана здоровья.

## Что должно быть сделано

- В начале обхода создать `Run` со временем старта
- По завершении записать статус, длительность, число просмотренных и найденных объявлений
- Ошибки сохранять в структурированном виде: код/категория + безопасное сообщение
- Отдельно отмечать пропуск из-за overlap

## Критерии приёмки

- [x] Успешный обход без новых объявлений виден как success с matched=0
- [x] Ошибка видна как error с причиной
- [x] Overlap виден как skipped
- [x] В журнал не попадают токены и секреты

## TDD и проверка

- Lifecycle RED: `verify #809` на `e48896828b4f9c07aaf217e9d2e8a6663092ce50` — scheduled traversal входил в cycle до создания `Run`; остальные тесты оставались зелёными.
- Первый GREEN: `verify #810` на `7f60cb16fe4c7ae92d1e548924b3374c807487dc` — running `Run` создаётся до traversal, полный pipeline GREEN.
- Cold-start finalization RED: `verify #811` на `31791f32582e0c3e88a937cf49b379707617ec18` — persistence всё ещё создавала новый success row вместо финализации существующего `runId`.
- Schema/cold-start GREEN: `verify #812` на `741db60ef081a3895a2459eb6f91483eb2c8e595` — nullable journal fields, migration и same-row cold-start finalization прошли unit/static, PostgreSQL, build и smoke.
- Success propagation RED: `verify #813` на `a9c6880cb183fbc95d328209be50a0c4efb63723` — `runId/startedAt` не доходили до cold/incremental paths, incremental persistence ещё делала `create`.
- Финальный GREEN: `verify #826` на `0c3e5a460dbd9b9f0205c52499631f8cb4dc089a` — success/catchup/error финализируют одну строку, source/internal ошибки безопасно структурированы, overlap остаётся skipped; unit, docs, typecheck, lint, formatting, PostgreSQL integration, build/output и оба Electron smoke GREEN.
## Подсказки

- Общий контекст — в карточке эпика и в `docs/AGENTS.md`

## Не делать

- Не строить health-агрегации — это фаза 4
