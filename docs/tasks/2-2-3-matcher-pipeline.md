---
id: "2.2.3"
phase: 2
epic: "2.2"
status: done
sync_state: aligned
last_reviewed: 2026-09-10
roles: [BACK]
depends_on: ["2.2.2", "1.4.2"]
estimated_hours: 3-4
agent: backend-senior
tags: [matching, pipeline]
---

# Задача 2.2.3 — Подключение матчера в конвейер обхода

> Эпик 2.2 · Фаза 2 · ✅ done · зависит от: 2.2.2, 1.4.2 · оценка: 3-4 ч

## Цель

Подставить настоящий матчер в шаг отбора, оставленный заглушкой в задаче `1.4.2`.

## Контекст

Задача `1.4.2` построила транзакционную оболочку: кандидаты → шаг отбора → одна транзакция с записью `Listing`, `Match` и продвижением водяного знака. Здесь заглушка заменяется на матчер. Границы транзакции при этом не меняются — гарантия «водяной знак не продвигается без зафиксированных результатов отбора» обязана сохраниться.

## Что сделано

- Persisted `Monitor.keywords` подключён к default candidate selector через matcher из `2.2.1`; существующий injected selector остаётся явным override для тестов и специальных вызовов.
- Persisted rule валидируется до traversal: объект `{ include, exclude }` принимается строго, а legacy `string[]` интерпретируется как include-only для совместимости с уже сохранёнными конфигурациями.
- Для подошедшего объявления в `Match` передаются реальные `matchedTerms`, `matchedIn` и фрагмент из `2.2.2`; если совпадение есть в описании, snippet строится вокруг description-hit, иначе — вокруг title-hit.
- Кандидаты, не прошедшие отбор, остаются в списке `candidates` и сохраняются как `Listing`, но не порождают `Match`.
- Граница транзакции и persistence-код из `1.4.2` не менялись: matcher выполняется до существующего atomic commit, а watermark продвигается только вместе с зафиксированными результатами.
- Добавлен PostgreSQL integration-test с реальным traversal и Prisma: два новых объявления сохраняются как `Listing`, только одно создаёт `Match`, `Run` фиксирует `seen=2 / matched=1`, cursor продвигается к новой границе.

## Критерии приёмки

- [x] Объявление, не подошедшее под правило, записано в `Listing` и не порождает `Match`
- [x] Подошедшее объявление порождает `Match` с термами и фрагментом
- [x] Прерывание между отбором и фиксацией не продвигает водяной знак
- [x] Интеграционные тесты `1.4.2` остались зелёными

## TDD и проверка

- RED default pipeline: `verify #710` на `36b8e2999e740c02a3b91b1474abf5be48e1860f` — persisted include/exclude rule ожидал только подходящий candidate, но прежний `acceptAll` выбирал оба; существующие 377 тестов проходили.
- RED legacy compatibility: `verify #714` на `ec1765ec78511aeda2f6a01b93b7f42db40004a1` — `string[]` ещё не преобразовывался в include-only rule, при этом первый pipeline-сценарий оставался зелёным.
- RED strict validation: `verify #716` на `79fadf2416bde13e202216797b115fc0fb542956` — malformed persisted rule доходил до traversal вместо ранней ошибки.
- RED snippet wiring: `verify #719` на `e836204c487de321d0ba2a3b4027fdc29bdc70f2` — terms/fields уже были корректны, но `snippet` оставался `null`.
- Финальный GREEN: `verify #729` на `73ef53ca85c3ea222fedf8dbe10c03f1a4af2d9d` — 381 unit tests GREEN (27 gated tests skipped в обычном unit-stage) и полный pipeline GREEN: documentation consistency, CI failure-mode self-check, typecheck, lint, formatting, PostgreSQL integration, build/output verification и оба Electron smoke.

## Подсказки

- Общий контекст — в карточке эпика и в `docs/AGENTS.md`

## Не делать

- Не менять границы транзакции, заданные в `1.4.2`
- Не отправлять уведомления: это эпик `3.2`
