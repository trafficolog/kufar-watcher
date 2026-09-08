# Spec — контракт площадки kufar.by

> Статус: **электроника (`1.0.1`) и недвижимость (`1.0.2`) подтверждены живой
> разведкой.** Search API, cursor pagination и обязательный core response-shape
> подтверждены dated fixtures/evidence от 2026-09-07. Electronics дополнительно
> подтверждает `/count`, договорную цену, detail availability semantics и HTML
> embedded state.

## Основной канал

Сайт работает поверх собственного JSON-API. Это первичный источник; HTML —
проверенный fallback, DOM-разбор — последний рубеж.

| Категория | Хост поисковой выдачи |
|-----------|----------------------|
| Недвижимость | `api.kufar.by` — **подтверждено live в 1.0.2**; пользовательские страницы живут на `re.kufar.by` |
| Электроника и прочие товары | `api.kufar.by` — **подтверждено live в 1.0.1** |
| Авто | `auto.kufar.by` — вне периметра проекта |

Пользовательские адреса живут на нескольких поддоменах. Официальный Help Center
на 2026-07-09 перечисляет, в частности, `kufar.by`, `re.kufar.by`,
`travel.kufar.by`, `auto.kufar.by`, `dostavka.kufar.by`, `business.kufar.by`,
`karta.kufar.by`, `media.kufar.by`, `helpcenter.kufar.by`, `safety.kufar.by`.
Нормализатор адресов обязан выдерживать поддерживаемые пользовательские hostnames,
а не предполагать единственный `www.kufar.by`.

### Search API

Для электроники `1.0.1` первично подтверждён endpoint:

`https://api.kufar.by/search-api/v2/search/rendered-paginated`

Живой probe `cat=5040&rgn=7&query=ps5&size=2&sort=lst.d&lang=ru` вернул
`ads`, `pagination` и `total=1229`. Первая и вторая страницы сохранены как:

- `tests/fixtures/kufar/2026-09-07-electronics-search-page-1.json`;
- `tests/fixtures/kufar/2026-09-07-electronics-search-page-2.json`.

Для недвижимости `1.0.2` **тот же endpoint** первично подтверждён request shape:

`cat=1010&cur=USD&gtsy=country-belarus~province-minsk~locality-minsk&lang=ru&size=1&sort=lst.d&typ=sell`

Page 1 вернул `ads`, `pagination`, `total=11637`; `next` token из него был
передан без декодирования во второй запрос как `cursor=<token>`, после чего page
2 вернул `self=2`, `prev=1`, новый `next=3` и тот же `total=11637`.

Fixtures:

- `tests/fixtures/kufar/2026-09-07-realestate-search-page-1.json`;
- `tests/fixtures/kufar/2026-09-07-realestate-search-page-2.json`.

Также первично подтверждён endpoint:

`https://api.kufar.by/search-api/v2/search/count`

Для electronics effective filters ответ был ровно `{"count":1229}` и совпал с
`search.total`. Raw fixture:
`tests/fixtures/kufar/2026-09-07-electronics-count.json`.

Старый контракт `cre-api.kufar.by` +
`/ads-search/v1/engine/v1/search/rendered-paginated` считается исторической
подсказкой, а не target реализации.

## Параметры запроса

Подтверждённый минимальный electronics contract:

| Параметр | Подтверждённое значение |
|----------|-------------------------|
| `query` | поисковая строка; `query=ps5` работает; пользовательский URL использует `q~ps5` |
| `cat` | идентификатор категории; `5040` = «Игры и приставки» в снятой фикстуре |
| `rgn` | регион; `7` = Минск; пользовательский URL использует `r~minsk` |
| `sort` | `lst.d` принят API; снятые страницы отсортированы по времени размещения убыванием |
| `size` | размер страницы; `size=2` дал две записи на странице |
| `cursor` | opaque token из `pagination.pages[]` с `label == "next"`; передаётся как `cursor=<token>` |
| `lang` | `lang=ru` принят API и входит в проверенный request shape |

Подтверждённый минимальный real-estate contract для продажи квартир в Минске:

| Параметр | Подтверждённое значение |
|----------|-------------------------|
| `cat` | `1010` = квартиры в снятой live выдаче |
| `typ` | `sell` = продажа; response также содержит `type="sell"` |
| `gtsy` | `country-belarus~province-minsk~locality-minsk` — location selector живого запроса |
| `cur` | `USD` принят API; это request/display parameter, но response `currency` не обязан совпадать с ним для каждой записи |
| `sort` | `lst.d` принят API |
| `size` | `size=1` использован в matched raw page-1/page-2 fixtures; user-layer page href использует `size=30` |
| `cursor` | та же opaque pagination-механика: `label == "next"` → `token` → следующий `cursor` |
| `lang` | `lang=ru` принят API |

Параметры `ar`, `cur`, `cnd`, `otype`/исторический `ot` не входят в минимальный
**electronics** request contract `1.0.1`. Их нельзя автоматически добавлять или
интерпретировать как обязательные там до отдельного требования. Response-side
район, condition и seller type уже доступны через `ad_parameters` /
`company_ad`.

Для real-estate `cur` подтверждён как часть рабочего request shape. Дополнительные
secondary параметры (`rms`, `prc` и т. п.) в `1.0.2` raw fixtures не проверялись
и не являются обязательным контрактом. Отдельный пробный `rnt=2` не дал
результатов и **не подтверждён** как rental contract; перебор значений не
выполнялся.

Пользовательский URL
`https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5` и raw API probe
подтверждают практическое отображение `r~minsk → rgn=7` и `q~ps5 → query=ps5`
для проверенного electronics примера. Real-estate user-layer использует path
семантику (`/minsk/kupit/kvartiru`, `/snyat`) и отдельный host `re.kufar.by`,
тогда как raw API фильтрует продажу через `typ=sell` и location через `gtsy`.

## Пагинация обязательна

Соблазн ограничиться первой страницей выдачи выглядит разумно: при минутном
интервале новых объявлений между обходами единицы. Но первая страница
переполняется всякий раз, когда обходы прерывались — перезапуск приложения,
сон машины, недоступность Docker, сбой сети, всплеск публикаций в популярной
категории. В этот момент водяной знак оказывается за пределами первой страницы,
и монитор молча теряет всё, что между ними. Внешне он при этом здоров.

Поэтому адаптер обязан уметь идти по курсору вглубь, а водяной знак — этим
пользоваться. Догоняющий обход после сна (эпик 2.5) без этого не реализуем в
принципе.

### Подтверждённый cursor shape

Electronics raw page 1 от 2026-09-07 содержит:

- `pagination.pages[]`;
- `self` с `num=1` и `token=null`;
- элемент `label == "next"`, `num=2` и opaque `token`;
- top-level `total=1229`.

Токен page 1 был передан без декодирования как `cursor=<token>` во второй
запрос. Raw page 2 вернул `prev=1`, `self=2`, новый `next=3` и тот же
`total=1229`.

Real-estate raw page 1 показывает тот же shape: `self=1`, `next=2`,
`total=11637`. Его exact `next.token`
`eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MiwicGl0IjoiMjk4MTMwMDYifQ==` был передан
как `cursor` во второй запрос. Raw page 2 вернул `prev=1`, `self=2`, `next=3` и
тот же `total=11637`.

Следовательно, общий pagination contract обеих вертикалей одинаков: найти
`pagination.pages[]` с `label == "next"`; если он есть, передать `token` без
декодирования как следующий `cursor`. Нельзя полагаться на индекс элемента в
массиве: на page 2 перед `self` появляется `prev`.

Вторичный порядок при одинаковом `list_time` не является частью контракта.
Алгоритм водяного знака `1.4.1` обязан проходить всю временную границу и
отбрасывать уже виденные идентификаторы, не предполагая стабильный tie-breaker.

## Цена бывает не числом

На живом пользовательском слое `1.0.1` и в raw API подтверждён один и тот же
актуальный товар:

- `https://www.kufar.by/item/1082715190` показывает цену `Договорная`;
- raw search response содержит `ad_id=1082715190`, `price_byn="0"`,
  `price_usd="0"`, `currency="BYR"` и нулевые calculator values;
- raw detail response и embedded `__NEXT_DATA__` той же карточки подтверждают
  ту же семантику.

Fixtures/evidence:

- `tests/fixtures/kufar/2026-09-07-electronics-negotiable.json`;
- `tests/fixtures/kufar/2026-09-07-electronics-negotiable-detail.json`;
- `tests/fixtures/kufar/2026-09-07-electronics-item-1082715190-next-data.fragment.txt`.

Для **подтверждённого electronics sample** нулевая `price_byn` означает
`Договорная`, а не бесплатный товар. `price_byn == null` в live electronics
sample не наблюдался и не входит в подтверждённый contract.

Модель обязана различать числовую и договорную цену. Переход между видами
(`150 BYN` → договорная и обратно) считается изменением цены и порождает
уведомление.

## Сопутствующие данные и endpoints

- Для seller type использовать прямой `company_ad`; отдельный historical
  `www.kufar.by/item/api/aduserinfo/{user_id}` не нужен MVP и не входит в
  контракт `1.0.1`.
- Live electronics fixtures подтверждают `images[].media_storage` и
  относительный `images[].path`; в снятых ответах `media_storage="rms"`.
  Real-estate fixtures используют тот же image shape.
- Список категорий нужен только Post-MVP для конструктора фильтров и не входит
  в сетевой контракт MVP-1.

## Что нужно от ответа выдачи

Для электроники обязательный shape подтверждён raw fixtures `1.0.1`:

| Домен | Подтверждённое поле площадки | Критичность |
|-------|-------------------------------|-------------|
| `listId` | `ad_id`; также наблюдается совпадающий `list_id` | обязательно: на нём держится дедупликация |
| `listTime` | `list_time`, ISO timestamp string | обязательно: на нём держится водяной знак |
| `title` | `subject` | обязательно |
| `price` + валюта | `price_byn` string в minor units, `price_usd` string, `currency="BYR"`; для negotiable sample `price_byn="0"` | обязательно |
| `accountId` | `account_id` string | нужно для чёрного списка |
| признак юрлица | `company_ad` boolean: live fixtures содержат и `false`, и `true` | нужно для фильтра продавца |
| регион | элемент `ad_parameters[]` с `p="region"`, `pu="rgn"`; live `v=7`, `vl="Минск"` | желательно, идёт в уведомление |
| район | элемент `ad_parameters[]` с `p="area"`, `pu="ar"` | опционально |
| краткое описание | `body_short`; в снятых electronics search fixtures поле присутствует и равно `null`; detail/embedded state содержат `body` | опционально |

Real-estate raw fixtures подтверждают **тот же core domain shape**:
`ad_id/list_id`, `list_time`, `subject`, `price_byn`, `price_usd`, `account_id`,
`company_ad`, region/area в `ad_parameters`, `body_short`, `ad_link`, `category`,
`images`, `calculator` и `type`.

Отличия real-estate response:

- `ad_parameters` существенно богаче и содержит domain-specific поля (`rooms`,
  `size`, `floor`, `house_type`, `condition`, `metro`, coordinates и др.);
- `calculator` содержит также `price_per_meter`;
- `body_short` в обеих снятых real-estate search fixtures непустой;
- `currency` отражает валюту конкретного объявления и в matched pages наблюдался
  как `USD` и `BYR`, несмотря на request `cur=USD`; нормализатор не должен
  трактовать request `cur` как гарантию response `currency`;
- company listing может содержать публичные реквизиты в `account_parameters`
  (`vat_number`, `company_address`, `contact_person`), но seller type всё равно
  определяется прямым `company_ad`.

В real-estate search и detail для одного объявления `1079260955` совпадают
`ad_id=list_id`, `list_time`, `subject`, `price_byn/price_usd` и location data.
`account_id` между search и detail в этом sample различается, поэтому detail
`account_id` нельзя использовать как доказательство неизменной seller identity;
для blacklist/normalization использовать значение из search response.

## Глобальный идентификатор и пригодность SourceAdapter

Обе вертикали используют один платформенный search host/path и один общий detail
endpoint, ключ которого состоит **только из `{id}`**:

`https://api.kufar.by/search-api/v2/item/{id}/rendered?lang=ru`

Electronics и real-estate search responses одновременно публикуют `ad_id` и
совпадающий `list_id`; real-estate id `1079260955` повторно прочитан через общий
detail endpoint и остался тем же. Конкретной cross-vertical collision в снятых
fixtures не наблюдалось, а единый detail lookup без vertical/source discriminator
является структурным evidence общего платформенного ID namespace.

Поэтому текущий контракт считает `ad_id` глобальным platform identifier и не
требует перехода Prisma `Listing.listId` на composite key. Это не математическое
доказательство отсутствия будущей коллизии: если площадка когда-либо вернёт один
ID для двух разных записей или detail lookup станет неоднозначным, это schema/
contract drift и отдельный migration trigger.

Интерфейс `SourceAdapter.page(CanonicalQuery, cursor) -> normalized listings +
nextCursor` достаточен для electronics и real estate. Различия (`query/rgn` vs
`typ/gtsy/cur`, richer real-estate parameters, user hosts/routes) являются
responsibility конкретного adapter request mapper и normalizer. Карточку `1.3.1`
по результатам `1.0.2` менять не требуется.

## `/count`

Для electronics query `cat=5040&rgn=7&query=ps5&lang=ru` endpoint
`/search-api/v2/search/count` 2026-09-07 вернул:

`{"count":1229}`

В согласованном probe тот же набор effective filters в
`rendered-paginated` вернул top-level `total=1229`. Для проверенного запроса
`count` означает общее количество результатов до page slicing и совпадает с
`search.total`. Адаптер не должен считать длину `ads` эквивалентом total.

`/count` отдельно для real estate в `1.0.2` не требовался и не проверялся;
real-estate pagination использует top-level `total` того же search response.

## HTML-состояние

Live `1.0.1` подтвердил два уровня HTML evidence:

1. Server-rendered DOM товарной выдачи содержит карточки, `/item/{id}` links,
   цену (включая `Договорная` и `Бесплатно`), локацию и seller-type UI.
2. Исходный HTML detail page `1082715190` содержит
   `<script id="__NEXT_DATA__" type="application/json">` со structured state.

Browser Connector не читает `view-source:` scheme, поэтому exact script block
был вручную скопирован пользователем из заранее открытой нами source page.
Полный block проверен как валидный JSON; в repo сохранён минимальный точный
непрерывный fragment:

`tests/fixtures/kufar/2026-09-07-electronics-item-1082715190-next-data.fragment.txt`.

Подтверждённые пути/значения:

- page `/item/[id]`, query `id=1082715190`;
- `props.initialState.adView.data`;
- `props.initialState.adView.data.initial`;
- UI-layer `price="Договорная"`;
- `initial.price_byn="0"`, `initial.price_usd="0"`, `currency="BYR"`;
- `initial.ad_id`, `list_id`, `list_time`, `account_id`, `company_ad`,
  `ad_parameters`, `body`, `subject`.

HTML embedded state является проверенным fallback shape. Primary path всё равно
остаётся JSON API; DOM-разбор — последний рубеж.

## Статус объявления и проверка цены

Первично подтверждён detail endpoint:

`https://api.kufar.by/search-api/v2/item/{id}/rendered?lang=ru`

Для активного electronics `1082715190` raw response содержит `price_byn="0"`,
описание и seller data, но **не содержит отдельного platform-status field**
(`status`, `active`, `sold`, `removed`). Fixture:

`tests/fixtures/kufar/2026-09-07-electronics-negotiable-detail.json`.

Для активного real-estate `1079260955` тот же endpoint возвращает `result` с
тем же `ad_id=list_id`, `list_time`, ценой и заголовком. Fixture:

`tests/fixtures/kufar/2026-09-07-realestate-item-1079260955-detail.json`.

Для заведомо старого недоступного `210670642` тот же endpoint вернул
`404 ASR0006 ad not found`. Fixture:

`tests/fixtures/kufar/2026-09-07-electronics-detail-not-found.json`.

Embedded `__NEXT_DATA__` активной electronics карточки согласуется с detail API:
в `adView.data` и `adView.data.initial` есть цена, но нет status-like поля.

Контракт для эпика `3.4`:

- один detail request одновременно получает цену и проверяет доступность;
- успешный payload означает доступную карточку;
- `404 ASR0006` означает, что карточка больше недоступна через detail endpoint;
- Kufar payload не даёт отдельной причины `sold` vs `removed`, поэтому доменная
  модель не должна обещать это различие без нового источника evidence.

## Уровни деградации

1. **JSON-API** — основной путь; search подтверждён raw fixtures для electronics
   и real estate, detail — для обеих вертикалей.
2. **Встроенные данные HTML-страницы** — проверенный electronics fallback через
   `__NEXT_DATA__` / `props.initialState.adView.data.initial`.
3. **Разбор DOM** — последний рубеж, Post-MVP.

Переключение уровня — событие, о котором пользователь узнаёт: работа на втором
уровне считается деградацией и отражается на экране здоровья.

## Порядок работ

Этот документ проверяется **до** того, как по нему проектируется сетевой слой.
Recon slices `1.0.1` и `1.0.2` закрыты live evidence. Нормализатор адресов и
конкретные adapters строятся по подтверждённому контракту; непроверенные
secondary параметры не угадываются заранее.

Отдельно учесть: внешние обращения к страницам площадки могут получать отказ в
доступе в зависимости от того, как выполнен запрос. Если разведка получает
отказ, его фиксируют как наблюдаемый факт; обход ограничений вне периметра.

## Правила обращения

- Единый лимитер на весь процесс, с джиттером. Ориентир — не чаще одного
  запроса в 2–5 секунд суммарно ко всем хостам площадки.
- Обходы разных мониторов не выполняются одновременно.
- Классификация ошибок едина для всего проекта:
  - **`429`** — увеличить паузу, снизить частоту, записать событие здоровья.
    Ретраи и фолбэк запрещены: смена канала ради продолжения запросов и есть
    обход только что выставленного ограничения.
  - **сеть, таймаут, `5xx`** — ограниченные ретраи с экспоненциальной задержкой;
    после их исчерпания допустим проверенный фолбэк.
  - **дрейф схемы** — пауза монитора и алерт. Фолбэк запрещён: он подменяет
    пользователю диагноз.
- Работа анонимная, без входа в аккаунт.


## Reconfirmation 2026-09-08 — electronics adapter evidence

Задача `1.3.2` повторно проверила живой electronics search contract перед закрытием concrete adapter:

- endpoint остался `https://api.kufar.by/search-api/v2/search/rendered-paginated`; request `cat=5040&rgn=7&query=ps5&size=2&sort=lst.d&lang=ru` вернул непустые `ads`, `pagination` и `total`;
- raw page 1 сохранён как `tests/fixtures/kufar/2026-09-08-electronics-search-page-1.json`; его `next.token` был передан без декодирования как `cursor`;
- raw page 2 сохранён как `tests/fixtures/kufar/2026-09-08-electronics-search-page-2.json`; он содержит `prev/self/next`, новый `next.token`, а IDs страниц не пересекаются;
- в fresh fixed-price samples raw `currency="BYR"`, а `price_byn` остаётся digit string в minor units; concrete electronics normalizer принимает raw marker `BYR|BYN` и выдаёт domain currency `BYN`;
- отдельный fresh `size=30` probe тех же effective filters нашёл 5 объявлений с `price_byn="0"`, повторно подтверждая наличие negotiable electronics records. Семантика `price_byn="0" -> priceKind: negotiable` остаётся electronics-specific и не обобщается на real estate без отдельного evidence.

Cursor остаётся opaque transport state: concrete adapter только добавляет его в query parameter `cursor` и не включает в `CanonicalQuery`.
