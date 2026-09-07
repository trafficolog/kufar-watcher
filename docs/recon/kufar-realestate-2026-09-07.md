# Разведка Kufar: недвижимость — 2026-09-07

## Статус

Задача `1.0.2` завершена как bounded spike. Первая live-сессия была остановлена
после `403 Forbidden` от `re.kufar.by` в соответствии с `docs/AGENTS.md`.
После нового явного разрешения пользователя разведка была начата как новая
сессия; Opera Browser Connector снова позволил выполнять последовательные
запросы, и raw API fixtures были сняты без `403/429`.

Proxy/VPN, ротация адресов, fingerprint/User-Agent spoofing, параллельные обходы
и другие способы обхода ограничений не использовались.

## Пользовательский слой

Свежая публичная выдача 2026-09-07 подтвердила real-estate host `re.kufar.by` и
маршруты:

- `https://re.kufar.by/l/minsk/kupit/kvartiru` — продажа квартир в Минске;
- `https://re.kufar.by/l/minsk/kupit/kvartiru/1k` — однокомнатные квартиры;
- `https://re.kufar.by/l/minsk-zavodskoj-rajon/snyat` — аренда в районе;
- карточки используют route `/vi/.../{external_id}`.

User-layer page 2 показал opaque `cursor`, `size=30` и отдельный `cur=USD`.

## Primary live API evidence

Подтверждён тот же search endpoint, что у electronics:

`https://api.kufar.by/search-api/v2/search/rendered-paginated`

Matched page-1 request:

`cat=1010&cur=USD&gtsy=country-belarus~province-minsk~locality-minsk&lang=ru&size=1&sort=lst.d&typ=sell`

Raw page 1:

- `ad_id=list_id=1079260955`;
- `total=11637`;
- `pagination.pages`: `self=1`, `next=2`;
- exact next token:
  `eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MiwicGl0IjoiMjk4MTMwMDYifQ==`.

Этот токен был передан без декодирования как `cursor=<token>` в следующий
запрос. Raw page 2 вернул:

- `ad_id=list_id=1083434940`;
- `prev=1`, `self=2`, `next=3`;
- тот же `total=11637`.

Fixtures:

- `tests/fixtures/kufar/2026-09-07-realestate-search-page-1.json`;
- `tests/fixtures/kufar/2026-09-07-realestate-search-page-2.json`.

Механика cursor совпадает с electronics: искать `pagination.pages[]` с
`label == "next"` и передавать его opaque `token` как следующий `cursor`.

## Request-параметры

Для проверенного sale/apartment/Минск slice первично подтверждены:

- `cat=1010`;
- `typ=sell`;
- `gtsy=country-belarus~province-minsk~locality-minsk`;
- `cur=USD`;
- `lang=ru`;
- `sort=lst.d`;
- `size`;
- optional `cursor`.

Пробный secondary-параметр аренды `rnt=2` вернул пустую выдачу (`total=0`) и не
считается подтверждённым rental contract. Значения не перебирались.

## Сравнение response shape с electronics

Core shape совпадает:

- `ad_id`, совпадающий `list_id`;
- `list_time`;
- `subject`;
- `price_byn`, `price_usd`, `currency`;
- `account_id`;
- `company_ad`;
- `ad_parameters` с region/area;
- `body_short`;
- `ad_link`, `category`, `images`, `calculator`, `type`.

Real-estate-specific различия:

- `ad_parameters` заметно богаче: rooms, size, floor, house type, condition,
  metro, coordinates, district/complex и другие характеристики;
- `calculator` содержит `price_per_meter`;
- `body_short` в обеих снятых search fixtures непустой;
- `currency` у page-1 записи — `USD`, у page-2 записи — `BYR`, хотя request
  содержит `cur=USD`; `cur` нельзя трактовать как гарантию response currency;
- company record может содержать публичные реквизиты (`vat_number`,
  `company_address`, `contact_person`) в `account_parameters`.

Эти дополнительные характеристики не нужны для правил MVP и не должны
протекать в общий `SourceAdapter` как обязательные поля.

## Повторное чтение и namespace идентификаторов

Подтверждён общий detail endpoint:

`https://api.kufar.by/search-api/v2/item/{id}/rendered?lang=ru`

Повторное чтение real-estate объявления `1079260955` вернуло:

- `ad_id=list_id=1079260955`;
- тот же `list_time=2026-09-07T11:21:31Z`;
- тот же `subject`;
- те же `price_byn=36903600` и `price_usd=12000000`;
- те же region/area values.

Fixture:

`tests/fixtures/kufar/2026-09-07-realestate-item-1079260955-detail.json`.

`account_id` в search и detail для этого sample различается. Поэтому стабильность
seller identity нельзя выводить из detail `account_id`; для blacklist и
normalization использовать search response.

Electronics и real estate используют один search API и один detail endpoint,
где lookup key состоит только из `{id}` и не содержит vertical/source
 discriminator. Это структурное evidence общего платформенного ID namespace.
В снятых fixtures cross-vertical collision не наблюдалось, а real-estate ID
стабилен при повторном чтении.

Следовательно, текущий `Listing.listId String @id` остаётся обоснованным; переход
на `source + externalId` не требуется. Если площадка когда-либо вернёт один ID
для двух разных записей или detail lookup станет неоднозначным, это будет
contract/schema drift и отдельный migration trigger.

## Вывод по SourceAdapter

Задуманный интерфейс

`page(CanonicalQuery, cursor) -> normalized listings + nextCursor`

достаточен для обеих вертикалей. Различия находятся в request mapping и
normalization конкретных adapters:

- electronics: `query`, `cat`, `rgn`, user host/routes `www.kufar.by`;
- real estate: `typ`, `cat`, `gtsy`, `cur`, user host/routes `re.kufar.by`.

Cursor и core normalized listing shape совпадают. Карточку `1.3.1` менять не
требуется.

## История stop-condition

В предыдущей live-сессии запрос `https://re.kufar.by/l/minsk` через web-fetch
вернул `403 Forbidden`, после чего разведка была немедленно остановлена. Новая
сессия началась только после отдельного явного указания пользователя продолжить.
Это не считалось retry/fallback на тот же stop-condition.
