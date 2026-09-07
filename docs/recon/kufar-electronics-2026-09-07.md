# Разведка Kufar: электроника — 2026-09-07

## Статус

Задача `1.0.1` закрыта первичными live evidence. Вручную, по одному запросу,
подтверждены electronics search API, cursor-pagination, `/count`, базовые поля,
договорная цена, detail contract и structured embedded state из исходного HTML.

Никаких попыток обхода ограничений площадки не предпринималось: не использовались
прокси, VPN, ротация адресов, подмена fingerprint/User-Agent, авторизация Kufar
или сторонние CORS-прокси. Запросы выполнялись вручную, по одному. Ни `403`, ни
`429` от Kufar в успешной browser-сессии не наблюдались.

## Primary live evidence — electronics search API

### Пользовательские URL

Подтверждены актуальные публичные маршруты:

- `https://www.kufar.by/l/r~minsk/elektronika`;
- `https://www.kufar.by/l/r~minsk-zavodskoj/elektronika`;
- `https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5`;
- карточка товара: `https://www.kufar.by/item/{id}`.

Для проверенного примера пользовательские сегменты соответствуют API-фильтрам:
`r~minsk -> rgn=7`, `q~ps5 -> query=ps5`.

Официальная статья Help Center «Как проверить, что вы на Куфаре», обновлённая
2026-07-09, перечисляет допустимые пользовательские домены Kufar:
`kufar.by`, `re.kufar.by`, `travel.kufar.by`, `auto.kufar.by`,
`dostavka.kufar.by`, `business.kufar.by`, `karta.kufar.by`,
`media.kufar.by`, `helpcenter.kufar.by`, `safety.kufar.by`.
Источник: `https://helpcenter.kufar.by/knowledge_base/item/274917`.

### Search endpoint

Первично подтверждён:

`https://api.kufar.by/search-api/v2/search/rendered-paginated`

Согласованный page-1 запрос:

`?cat=5040&rgn=7&query=ps5&size=2&sort=lst.d&lang=ru`

Raw fixture:
`tests/fixtures/kufar/2026-09-07-electronics-search-page-1.json`.

Снятый ответ содержит:

- top-level `ads`, `page_type`, `pagination`, `total`;
- `total=1229`;
- `pagination.pages[]` с `self` и `next`;
- `next.token=eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MiwicGl0IjoiMjk4MTI4MTQifQ==`.

### Cursor / page 2

Token из элемента `pagination.pages[]` с `label == "next"` был передан без
декодирования как `cursor=<token>` в тот же endpoint.

Raw fixture:
`tests/fixtures/kufar/2026-09-07-electronics-search-page-2.json`.

Page 2 подтверждает механику:

- `prev.num=1`;
- `self.num=2`, `token=null`;
- `next.num=3` с новым token;
- `total=1229`.

Следовательно, нельзя брать cursor по фиксированному индексу массива: на первой
странице `next` идёт после `self`, на второй перед ним появляется `prev`.
Надёжное правило: найти `label == "next"` и взять его `token`.

### `/count`

Первично подтверждён:

`https://api.kufar.by/search-api/v2/search/count?cat=5040&rgn=7&query=ps5&lang=ru`

Raw fixture:
`tests/fixtures/kufar/2026-09-07-electronics-count.json`.

Ответ:

`{"count":1229}`

В той же live-сессии search response для согласованных effective filters имел
`total=1229`. Для проверенного запроса `/count` возвращает общее количество
результатов до page slicing и совпадает с top-level `search.total`.

### Поля electronics response

Raw fixtures первично подтверждают:

- идентификатор: `ad_id`; также присутствует совпадающий `list_id`;
- время размещения: `list_time`;
- заголовок: `subject`;
- цена: `price_byn`, `price_usd` — строки;
- валюта: `currency` (`BYR` в снятых записях);
- seller/account id: `account_id`;
- признак компании: `company_ad` boolean; наблюдались и `false`, и `true`;
- регион: `ad_parameters[]` с `p="region"`, `pu="rgn"`, `v=7`, `vl="Минск"`;
- район: `ad_parameters[]` с `p="area"`, `pu="ar"`;
- краткое описание: `body_short` присутствует, в снятых search samples равно
  `null`; `body` также присутствует и равно `null`;
- дополнительные поля: `ad_link`, `category`, `images`, `account_parameters`,
  `phone_hidden`, `remuneration_type`, `show_parameters`, `calculator`, `type`.

## Договорная цена — primary live evidence

Проверена актуальная карточка:

`https://www.kufar.by/item/1082715190`

Пользовательский слой показывает `Договорная`; товар —
`NHL 27 для PS5 и Xbox Series X/S`.

Отдельный минимальный raw search probe для той же записи сохранён как:
`tests/fixtures/kufar/2026-09-07-electronics-negotiable.json`.

В нём:

- `ad_id=1082715190`;
- `price_byn="0"`;
- `price_usd="0"`;
- `currency="BYR"`;
- значения calculator для BYN/USD/EUR/RUB также равны нулю;
- `company_ad=false`;
- регион — Минск.

Для **этого первично проверенного electronics sample** `price_byn="0"`
означает `Договорная`, а не бесплатный товар. `price_byn=null` в live sample не
наблюдался и не считается подтверждённым вариантом договорной цены.

## HTML / embedded state — primary live evidence

Для той же карточки `1082715190` в Opera был открыт:

`view-source:https://www.kufar.by/item/1082715190`

Browser Connector не умеет читать `view-source:` scheme, поэтому пользователь
вручную скопировал exact `<script id="__NEXT_DATA__" type="application/json">`
block из уже открытой нами страницы. Полный скопированный block был проверен как
валидный JSON. В репозитории сохранён минимальный **точный непрерывный фрагмент**
этого source без нормализации данных:

`tests/fixtures/kufar/2026-09-07-electronics-item-1082715190-next-data.fragment.html`.

Первично подтверждён shape:

- Next page: `/item/[id]`, query `id=1082715190`;
- `props.initialState.adView.data`;
- `props.initialState.adView.data.initial`;
- UI-layer `price="Договорная"`;
- `initial.price_byn="0"`, `initial.price_usd="0"`, `currency="BYR"`;
- `initial.ad_id=1082715190`, `list_id`, `list_time`, `account_id`,
  `company_ad`, `ad_parameters`, `body`, `subject`;
- region/area доступны как в UI-layer (`region="Минск, Партизанский"`), так и
  в `initial.ad_parameters`.

Следовательно, HTML действительно содержит пригодное для машинного разбора
structured state. Это допустимый проверенный fallback shape; primary path всё
равно остаётся JSON API.

## Detail response / platform status — primary live evidence

Первично подтверждён public detail endpoint:

`https://api.kufar.by/search-api/v2/item/{id}/rendered?lang=ru`

Для активного `1082715190` ответ сохранён как:

`tests/fixtures/kufar/2026-09-07-electronics-negotiable-detail.json`.

Он содержит цену (`price_byn="0"`), описание, seller/account data и остальные
данные карточки, но не содержит отдельного platform-status поля вроде
`status`, `active`, `sold` или `removed`.

Для заведомо старого недоступного `210670642` тот же endpoint вернул:

`404` + `ASR0006` + `ad not found`.

Raw fixture:
`tests/fixtures/kufar/2026-09-07-electronics-detail-not-found.json`.

Практический контракт для эпика `3.4`:

- один detail request одновременно проверяет текущую цену и факт доступности;
- успешный detail payload означает, что карточка доступна и содержит цену;
- `404 ASR0006` означает, что карточка больше недоступна через этот endpoint;
- payload **не различает** причину недоступности (`sold` против `removed`) через
  explicit status field.

Скопированный `__NEXT_DATA__` активной карточки независимо подтверждает то же:
в `adView.data` и `adView.data.initial` есть цена и данные объявления, но нет
отдельного status-like поля.

## Secondary evidence 2026

Secondary evidence использовался только для выбора минимальных live targets;
после первичных fixtures он не подменяет подтверждённые значения.

### Январь 2026

`vmakhakhei/parser_tg_bot_flats`, состояние 2026-01-27, документирует v2 search
response `ads`, `total`, `pagination` и поля `ad_id`, `account_id`,
`price_byn`, `price_usd`, `currency`, `list_time`, `subject`, `body_short`,
`company_ad`, `ad_parameters`, `account_parameters`.

Источник:
`https://github.com/vmakhakhei/parser_tg_bot_flats/blob/7bd35843b05008b698b1d727ba8970e3f23dc161/KUFAR_API_FIELDS_DOCUMENTATION.md`.

### Апрель 2026

`5taZ/Rafuk`, commit 2026-04-07, использует
`/search-api/v2/search/rendered-paginated`, cursor и top-level `total`.

Источник:
`https://github.com/5taZ/Rafuk/blob/8cca4faa6a996059cb03f85bd5a369f4f4d69c3b/api/services/kufar_client.py`.

### Июль 2026

`TrofimGest/padel-monitor` browser-check наблюдал `__NEXT_DATA__`,
`props.initialState.listing`, `props.initialState.adView.data.initial`, cursor
и вызов `/search-api/v2/search/count` для real-estate.

Источник:
`https://github.com/TrofimGest/padel-monitor/blob/9c43f3ac8544b4a18abb4b0d2254ad766e48d2f4/browser-harness/domain-skills/kufar/commercial-rent-monitoring.md`.

### Август–сентябрь 2026

`shmelidzee/flatio`, состояние 2026-09-06, использует v2 search host/path,
выбирает cursor через `pagination.pages[]` с `label == "next"`, моделирует
основные ad fields и интерпретирует zero/null price как negotiable. Его DTO не
моделирует platform status и выводит локальный `INACTIVE` по исчезновению ID;
это не доказывало протокол само по себе, но теперь согласуется с primary live
probe `1.0.1`.

Источники:

- `https://github.com/shmelidzee/flatio/blob/680863b4a6d79faf3a4eea43d1903218224aeef9/src/main/resources/application.yml`;
- `https://github.com/shmelidzee/flatio/blob/680863b4a6d79faf3a4eea43d1903218224aeef9/src/main/java/com/flatio/integration/kufar/client/KufarApiClient.java`;
- `https://github.com/shmelidzee/flatio/blob/680863b4a6d79faf3a4eea43d1903218224aeef9/src/main/java/com/flatio/integration/kufar/dto/KufarAd.java`.

## Старый контракт

Старые `cre-api.kufar.by` / `ads-search/v1/...` URL сохраняются только как
исторические сведения. Текущий electronics search контракт первично подтверждён
на `api.kufar.by/search-api/v2/...` и именно он является source of truth для
последующих задач.

## Итог `1.0.1`

Первичным dated evidence закрыты:

- первая и вторая страницы выдачи;
- cursor mechanics;
- `/count` и совпадение с `total` для согласованного запроса;
- обязательные electronics fields;
- negotiable `price_byn="0"` sample;
- public detail endpoint и availability semantics;
- exact `__NEXT_DATA__` structured-state fragment.

Непроверенных electronics-гейтов задачи `1.0.1` не осталось. Недвижимость
проверяется отдельно в `1.0.2`; выводы между вертикалями автоматически не
переносятся.
