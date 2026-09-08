---
id: "1.4.3"
phase: 1
epic: "1.4"
status: done
sync_state: aligned
last_reviewed: 2026-09-09
roles: [BACK]
depends_on: ["1.4.2"]
estimated_hours: 2-3
agent: backend-senior
tags: [ux, core]
---

# Задача 1.4.3 — Холодный старт монитора

> Эпик 1.4 · Фаза 1 · ✅ done · зависит от: 1.4.2 · оценка: 2-3 ч

## Цель

Первый обход нового правила не должен присылать всё, что нашлось на странице.

## Контекст

Без отдельной обработки первого обхода пользователь при создании правила немедленно получает пачку из нескольких десятков уведомлений о старых объявлениях. Технически это корректно, практически — делает продукт неприятным с первой минуты.

## Что должно быть сделано

- При первом обходе записать объявления в `Listing` и установить водяной знак, не создавая `Match` к отправке
- Показать пользователю количество объявлений, принятых как исходное состояние
- Уведомления начинаются со второго обхода

## Критерии приёмки

- [x] Создание правила не приводит к уведомлениям о существующих объявлениях
- [x] Объявления первого обхода записаны в `Listing` и доступны в базе; в ленту находок они попадут, когда лента появится в срезе `0.5.0`
- [x] Второй обход присылает только действительно новое

## Реализация

- Добавлен единый `runMonitorCycle`: отсутствующий/неинициализированный курсор маршрутизируется в cold start, инициализированный — в существующий incremental path.
- Cold start читает выдачу через `SourceAdapter`, дедуплицирует объявления и ограничивает baseline страницами, необходимыми только для закрытия tie на максимальном `listTime`.
- Если `maxPages` достигнут до закрытия top-time tie при наличии следующей страницы, baseline считается неполным и не записывает `Listing`, `MonitorCursor` или успешный `Run`.
- Пустая первая страница фиксирует watermark в `startedAt` с пустым `boundaryIds`, поэтому первое будущее объявление не поглощается baseline.
- Успешный cold start атомарно записывает `Listing + MonitorCursor + Run(seen=baselineCount, matched=0)` и не создаёт `Match`.
- Перед записью под `Monitor FOR UPDATE` повторно проверяются source-reset semantics и состояние неинициализированного курсора; stale baseline отклоняется до любых baseline writes.
- `baselineCount` возвращается из cold-start результата и сохраняется в `Run.seen`, чтобы последующий UI-слой мог показать количество объявлений, принятых как исходное состояние.

## Проверка

- Unit coverage: bounded traversal, tie через границу страниц, дедупликация, empty baseline, incomplete `maxPages`, ordering guard, router и persistence preconditions.
- Postgres integration: успешный baseline создаёт `Listing/Cursor/Run` без `Match`; source edit и competing cursor initialization отклоняются без baseline writes.
- GitHub Actions `verify` run `#524` на production-коде до обновления статуса карточки: полностью GREEN, включая docs consistency, unit tests, typecheck, lint, formatting, Postgres integration, build, development smoke и production smoke.

## Подсказки

- Общий контекст — в карточке эпика и в `docs/AGENTS.md`

## Не делать

- Не давать настройку «прислать всё при первом обходе»: поведение одно
