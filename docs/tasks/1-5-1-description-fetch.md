---
id: "1.5.1"
phase: 1
epic: "1.5"
status: done
sync_state: aligned
last_reviewed: 2026-09-09
roles: [BACK]
depends_on: ["1.3.2"]
estimated_hours: 3
agent: backend-senior
tags: [network, cache]
---

# Задача 1.5.1 — Загрузка полного описания и кеш

> Эпик 1.5 · Фаза 1 · ✅ done · зависит от: 1.3.2 · оценка: 3 ч

## Цель

Загрузить полный текст объявления отдельным запросом и сохранить его, чтобы не запрашивать повторно.

## Контекст

Выдача отдаёт усечённое описание, а поиск ключей по описанию — заявленная возможность. Каждое такое обращение — дополнительный запрос через лимитер, поэтому повторные загрузки одного объявления недопустимы.

## Что должно быть сделано

- Реализовать загрузку карточки объявления через клиент `1.2.2`
- Сохранять описание в `Listing`, повторно не запрашивать
- Обрабатывать удалённое объявление: помечать статус, не считать ошибкой обхода

## Критерии приёмки

- [x] Описание загружается и сохраняется
- [x] Повторный обход не выполняет второй запрос за тем же описанием
- [x] Удалённое объявление не роняет обход

## Реализация

- В `Listing` добавлены `ListingAvailability { unknown, available, unavailable }` и nullable `descriptionLoadedAt`: признак завершённой загрузки отделён от самого `description`, поэтому успешно загруженный `null` тоже считается кешированным.
- Добавлен additive Prisma migration для новых cache-полей; compose verification и reset-контракт обновлены на три завершённые миграции.
- HTTP-клиент сохраняет raw body для HTTP failure results, не меняя существующие retry, limiter, cooldown и raw-journal semantics. Это позволяет различать точный Kufar `404 + ASR0006` от остальных 4xx.
- Добавлен строгий detail parser: полный текст берётся только из `result.body`; `string | null` считается валидным результатом, malformed success payload отклоняется.
- `ListingDescriptionCache` сначала читает persistent cache, а при miss выполняет detail request через существующий `KufarHttpClient` на `/search-api/v2/item/{id}/rendered?lang=ru`.
- Успешный detail request сохраняет только cache-owned поля `description`, `descriptionLoadedAt`, `availability=available`; данные продавца, цены и другие search-owned поля из detail payload не переносятся.
- Точный `404 + ASR0006` сохраняется как `availability=unavailable` и возвращается как обычный non-error результат. Остальные HTTP/transport/parse ошибки не записывают ложное cache-состояние и остаются retryable на следующем вызове.
- Параллельные запросы одного `listId` внутри worker-процесса coalesce в один in-flight HTTP request; после failure запись удаляется из in-flight map, поэтому следующий вызов может повторить запрос.
- Search persistence сохраняет `body_short` при первом создании `Listing`, но дальнейший обычный search-upsert больше не владеет `description`, `descriptionLoadedAt` и `availability`; сохранённый полный текст не перезаписывается усечённым snippet.
- Сервис оставлен отдельным cache primitive. Решение, для каких новых объявлений вызывать его в monitor pipeline, относится к задаче `1.5.2` и не дублируется в `1.5.1`.
- Архитектурный контракт и TDD-план зафиксированы в `docs/superpowers/specs/2026-09-09-description-fetch-cache-design.md` и `docs/superpowers/plans/2026-09-09-description-fetch-cache.md`.

## Проверка

- Unit coverage: Prisma schema/migration contract, сохранение HTTP failure body, strict detail parser, точный `ASR0006`, persistent-cache semantics, `null` sentinel, unavailable cache, non-poison failures, in-flight coalescing и ownership search-upsert.
- PostgreSQL integration: 5 сценариев на реальной базе — reuse полного description между экземплярами сервиса без второго HTTP, cached `null`, persisted unavailable без второго HTTP, сохранность полного description после search-upsert и отсутствие cache poison после unrelated 404.
- GitHub Actions `verify` run `#576` на production HEAD перед обновлением статуса карточки: полностью GREEN, включая documentation consistency, unit tests, CI failure-mode self-check, typecheck, lint, formatting, Postgres compose integration, build/output verification, development smoke и production smoke.

## Подсказки

- Общий контекст — в карточке эпика и в `docs/AGENTS.md`

## Не делать

- Не загружать изображения
- Не разбирать характеристики объявления по категориям
