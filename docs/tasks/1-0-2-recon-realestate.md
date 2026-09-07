---
id: "1.0.2"
phase: 1
epic: "1.0"
status: done
sync_state: aligned
last_reviewed: 2026-09-07
roles: [BACK, QA]
depends_on: ["1.0.1"]
estimated_hours: 1-2
agent: backend-senior
tags: [recon, contract, spike]
---

# Задача 1.0.2 — Разведка выдачи по недвижимости и сверка спеки

> Эпик 1.0 · Фаза 1 · ✅ done · зависит от: 1.0.1 · оценка: 1-2 ч

## Цель

Повторить разведку для недвижимости и зафиксировать, чем её контракт отличается
от товарного.

## Контекст

Недвижимость живёт на отдельном пользовательском хосте и имеет собственный набор
параметров. Величина этих различий определяет, выдержит ли задуманный интерфейс
адаптера обе категории или его придётся менять. Узнать это дешевле сейчас, чем в
`1.3.3`.

## Что сделано

- Сняты dated raw fixtures real-estate page 1 и page 2 из одного cursor-среза
- Подтверждён search API host/path и request shape для продажи квартир в Минске
- Подтверждена та же cursor-механика, что у electronics
- Сопоставлены core fields и real-estate-specific `ad_parameters`
- Повторно прочитан один real-estate ID через общий detail endpoint
- Проверено текущее допущение о platform-global `listId`
- Зафиксирован вывод о пригодности общего `SourceAdapter`
- Canonical contract обновлён; изменений `1.3.1` не требуется

## Primary evidence — 2026-09-07

Search endpoint:

`https://api.kufar.by/search-api/v2/search/rendered-paginated`

Matched page-1 request:

`cat=1010&cur=USD&gtsy=country-belarus~province-minsk~locality-minsk&lang=ru&size=1&sort=lst.d&typ=sell`

Page 1:

- `ad_id=list_id=1079260955`
- `total=11637`
- `self=1`, `next=2`
- next token
  `eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MiwicGl0IjoiMjk4MTMwMDYifQ==`

Page 2 по exact token:

- `ad_id=list_id=1083434940`
- `prev=1`, `self=2`, `next=3`
- `total=11637`

Fixtures:

- `tests/fixtures/kufar/2026-09-07-realestate-search-page-1.json`
- `tests/fixtures/kufar/2026-09-07-realestate-search-page-2.json`
- `tests/fixtures/kufar/2026-09-07-realestate-item-1079260955-detail.json`

Журнал:
[kufar-realestate-2026-09-07.md](../recon/kufar-realestate-2026-09-07.md).

## Различия от electronics

Core normalized fields совпадают: `ad_id/list_id`, `list_time`, `subject`,
prices, seller/account field, `company_ad`, region/area, `body_short`.

Основные различия находятся в request mapping и vertical-specific metadata:

- real estate: `typ`, `cat=1010`, `gtsy`, `cur`;
- electronics: `query`, `cat`, `rgn`;
- real-estate `ad_parameters` содержит rooms/size/floor/house/metro/coordinates;
- real-estate calculator содержит `price_per_meter`;
- user-facing host/path отличаются (`re.kufar.by/vi/.../{id}` против
  `www.kufar.by/item/{id}`).

## SourceAdapter

Общий интерфейс

`page(CanonicalQuery, cursor) -> normalized listings + nextCursor`

достаточен для обеих категорий. Vertical differences остаются внутри request
mapper и normalizer конкретного адаптера. Карточку `1.3.1` менять не требуется.

## Идентификатор объявления

Real-estate ID `1079260955` повторно прочитан через общий platform detail endpoint
`/search-api/v2/item/{id}/rendered?lang=ru` и остался тем же; совпали
`ad_id=list_id`, `list_time`, title и prices.

Electronics и real estate используют один search API и один detail lookup,
ключом которого служит только `{id}` без vertical/source discriminator. Это
поддерживает текущий contract platform-global `ad_id`. В снятых fixtures
cross-vertical collision не наблюдалось.

Переход Prisma на composite `source + externalId` не требуется. Если в будущем
появится реальная коллизия или неоднозначный detail lookup, это будет отдельный
schema/contract drift trigger.

## Критерии приёмки

- [x] Фикстуры по недвижимости сохранены с датой
- [x] Различия между категориями описаны в спеке контракта
- [x] Вывод о пригодности интерфейса адаптера зафиксирован письменно
- [x] Проверены стабильность real-estate ID и единый platform ID namespace;
      cross-vertical collision в evidence не наблюдается
- [x] Условный migration gate проверен: коллизия не обнаружена, поэтому переход
      на составной ключ и правка `0.3.1` не требуются

## Не делать

- Не писать код адаптера недвижимости: это `1.3.3`
- Не разбирать характеристики объекта: в правилах MVP они не участвуют
- Не обходить `403`/`429`: остановить сессию и зафиксировать условия
