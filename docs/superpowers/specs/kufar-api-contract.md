# Spec — контракт площадки kufar.by

> Статус: **электроника подтверждена живой разведкой `1.0.1`.** Search API,
> pagination, `/count`, обязательные поля, договорная цена, detail availability
> semantics и HTML embedded state подтверждены dated fixtures/evidence от
> 2026-09-07. Недвижимость проверяется отдельно в `1.0.2`; выводы между
> вертикалями автоматически не переносить.

## Основной канал

Сайт работает поверх собственного JSON-API. Это первичный источник; HTML —
проверенный fallback, DOM-разбор — последний рубеж.

| Категория | Хост поисковой выдачи |
|-----------|----------------------|
| Недвижимость | `api.kufar.by` — **требует проверки в 1.0.2**; пользовательские страницы живут на `re.kufar.by` |
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

Также первично подтверждён endpoint:

`https://api.kufar.by/search-api/v2/search/count`

Для тех же effective filters ответ был ровно `{"count":1229}` и совпал с
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

Параметры `ar`, `cur`, `cnd`, `otype`/исторический `ot` не входят в минимальный
request contract `1.0.1`. Их нельзя автоматически добавлять или интерпретировать
как обязательные до появления отдельного требования. Response-side район,
condition и seller type уже доступны через `ad_parameters` / `company_ad` и не
требуют этих request-фильтров для MVP.

`typ` относится к real-estate operation (`let` / `sell`) и рассматривается в
`1.0.2`, а не в electronics adapter.

Пользовательский URL
`https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5` и raw API probe
подтверждают практическое отображение `r~minsk → rgn=7` и `q~ps5 → query=ps5`
для проверенного примера. Задача `1.1.1` строит нормализатор по этому контракту,
не пытаясь угадывать дополнительные фильтры.

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

### Подтверждённый cursor shape для электроники

Raw page 1 от 2026-09-07 содержит:

- `pagination.pages[]`;
- `self` с `num=1` и `token=null`;
- элемент `label == "next"`, `num=2` и opaque `token`;
- top-level `total=1229`.

Токен page 1 был передан без декодирования как `cursor=<token>` во второй
запрос. Raw page 2 вернул:

- `prev`, `num=1`;
- `self`, `num=2`;
- новый `next`, `num=3`;
- тот же `total=1229`.

Следовательно, для electronics adapter контракт такой: найти элемент
`pagination.pages[]` с `label == "next"`; если он есть, передать его `token`
как следующий `cursor`. Нельзя полагаться на индекс элемента в массиве:
на page 1 `next` идёт после `self`, а на page 2 перед ними появляется `prev`.

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
- `tests/fixtures/kufar/2026-09-07-electronics-item-1082715190-next-data.fragment.html`.

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
  В MVP фотографии в уведомлениях не используются.
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
| краткое описание | `body_short`; в снятых search fixtures поле присутствует и равно `null`; detail/embedded state содержат `body` | опционально |

Дополнительно live electronics fixtures подтверждают `ad_link`, `category`,
`images`, `account_parameters`, `phone_hidden`, `remuneration_type`,
`show_parameters`, `calculator` и `type`. Не делать их обязательными без
доменного требования.

Для company records `account_parameters` может содержать публичные реквизиты и
адреса продавца. Приложение не должно зависеть от этих полей для определения
seller type, поскольку для этого уже есть прямой `company_ad`.

## `/count`

Для electronics query `cat=5040&rgn=7&query=ps5&lang=ru` endpoint
`/search-api/v2/search/count` 2026-09-07 вернул:

`{"count":1229}`

В согласованном probe тот же набор effective filters в
`rendered-paginated` вернул top-level `total=1229`. Для проверенного запроса
`count` означает общее количество результатов до page slicing и совпадает с
`search.total`. Адаптер не должен считать длину `ads` эквивалентом total.

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

`tests/fixtures/kufar/2026-09-07-electronics-item-1082715190-next-data.fragment.html`.

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

Для активного `1082715190` raw response содержит `price_byn="0"`, описание и
seller data, но **не содержит отдельного platform-status field** (`status`,
`active`, `sold`, `removed`). Fixture:

`tests/fixtures/kufar/2026-09-07-electronics-negotiable-detail.json`.

Для заведомо старого недоступного `210670642` тот же endpoint вернул
`404 ASR0006 ad not found`. Fixture:

`tests/fixtures/kufar/2026-09-07-electronics-detail-not-found.json`.

Embedded `__NEXT_DATA__` активной карточки согласуется с detail API: в
`adView.data` и `adView.data.initial` есть цена, но нет status-like поля.

Контракт для эпика `3.4`:

- один detail request одновременно получает цену и проверяет доступность;
- успешный payload означает доступную карточку;
- `404 ASR0006` означает, что карточка больше недоступна через detail endpoint;
- Kufar payload не даёт отдельной причины `sold` vs `removed`, поэтому доменная
  модель не должна обещать это различие без нового источника evidence.

## Уровни деградации

1. **JSON-API** — основной путь; для electronics search/detail подтверждён raw fixtures.
2. **Встроенные данные HTML-страницы** — проверенный fallback через
   `__NEXT_DATA__` / `props.initialState.adView.data.initial`.
3. **Разбор DOM** — последний рубеж, Post-MVP.

Переключение уровня — событие, о котором пользователь узнаёт: работа на втором
уровне считается деградацией и отражается на экране здоровья.

## Порядок работ

Этот документ проверяется **до** того, как по нему проектируется сетевой слой.
Electronics slice `1.0.1` закрыт live evidence; следующий отдельный recon slice —
недвижимость `1.0.2`. Только после соответствующей разведки пишутся
нормализатор адресов и адаптер конкретной вертикали.

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
