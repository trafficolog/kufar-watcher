---
id: "1.3.3"
phase: 1
epic: "1.3"
status: done
sync_state: aligned
last_reviewed: 2026-09-08
roles: [BACK]
depends_on: ["1.3.2"]
estimated_hours: 3-4
agent: backend-senior
tags: [adapter]
---

# Задача 1.3.3 — Адаптер «Недвижимость»

> Эпик 1.3 · Фаза 1 · ✅ done · зависит от: 1.3.2 · оценка: 3-4 ч

## Цель

Второй адаптер на хосте недвижимости, с учётом её собственного набора параметров.

## Контекст

Недвижимость — вторая целевая категория и одновременно проверка того, что интерфейс адаптера действительно абстрагирует различия, а не описывает электронику другими словами.

## Что сделано

- Использованы уже снятые в `1.0.2` live-fixtures real-estate search page 1/page 2 от 2026-09-07; повторная сетевая разведка для этой задачи не потребовалась.
- Добавлен fixture-driven `normalizeRealEstateSearchPage` поверх общего Kufar search-normalizer: core fields и opaque cursor общие с electronics, а price semantics остаются вертикально-специфичными.
- Для response `currency=USD` нормализатор использует `price_usd` и сохраняет доменную валюту `USD`; `BYR|BYN` использует `price_byn` и нормализуется в `BYN`. Request `cur=USD` не трактуется как гарантия валюты каждой записи.
- Добавлен `KufarRealEstateAdapter` поверх существующих `buildKufarApiUrl` и classified HTTP getter; transport pagination добавляет только `size=30` и opaque `cursor`.
- Специфичные характеристики недвижимости (`rooms`, `floor`, `size`, `metro` и т. п.) намеренно не проецируются в доменную модель MVP и остаются доступными в `Listing.raw`.
- Общий `SourceAdapter` не изменён: контракт `fetchPage({ query, cursor }) -> { listings, nextCursor }` оказался достаточным для второй вертикали.
- Normalizer и adapter прошли отдельные RED→GREEN TDD-циклы; electronics tests сохранены зелёными после DRY-выноса общей parsing-механики.

## Критерии приёмки

- [x] Запрос по реальной ссылке на недвижимость возвращает нормализованные объявления
- [x] Интерфейс адаптера не потребовал изменений под эту категорию; различия остались в URL mapping и real-estate price normalizer
- [x] Фикстура и тесты на месте

## Проверенные артефакты

- `tests/fixtures/kufar/2026-09-07-realestate-search-page-1.json`
- `tests/fixtures/kufar/2026-09-07-realestate-search-page-2.json`
- `tests/unit/kufar-realestate-normalizer.test.ts`
- `tests/unit/kufar-realestate-adapter.test.ts`
- `electron/worker/kufar-search-normalizer.ts`
- `electron/worker/kufar-realestate-normalizer.ts`
- `electron/worker/kufar-realestate-adapter.ts`

## Подсказки

- Общий контекст — в карточке эпика и в `docs/AGENTS.md`

## Не делать

- Не реализовывать разбор специфичных характеристик объекта: в MVP они не используются в правилах
