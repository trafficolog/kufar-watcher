# Разведка Kufar: недвижимость — 2026-09-07

## Статус

Задача `1.0.2` начата как bounded spike и остановлена по контракту вежливости
после первого `403` от live `re.kufar.by` web-fetch. Статус задачи —
`blocked / aligned`: карточка соответствует фактическому состоянию, но acceptance
criteria ещё не закрыты.

После `403` новые запросы к Kufar в этой сессии не выполнялись. Proxy/VPN,
ротация адресов, подмена fingerprint/User-Agent и другие способы обхода не
использовались.

## Primary live evidence до stop-condition

### Пользовательские маршруты

Свежая публичная выдача 2026-09-07 подтвердила real-estate host
`re.kufar.by` и, в частности, маршруты:

- `https://re.kufar.by/l/minsk/kupit/kvartiru` — продажа квартир в Минске;
- `https://re.kufar.by/l/minsk/kupit/kvartiru/1k` — однокомнатные квартиры;
- `https://re.kufar.by/l/minsk-zavodskoj-rajon/snyat` — долгосрочная аренда в
  Заводском районе Минска;
- карточка имеет real-estate route вида
  `https://re.kufar.by/vi/.../{external_id}`.

На основной странице одновременно наблюдались UI-состояния `Купить`, `Снять`,
`Посуточно`, регион `Минск`, категория `Квартиры`, сортировка по новизне и
карточки с ценой, площадью, комнатами, этажом, адресом и кратким описанием.

### Cursor на пользовательской выдаче

Ссылка `2` на текущей странице раскрыла фактический page-2 href:

`https://re.kufar.by/l/minsk/kupit/kvartiru?cur=USD&cursor=eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MiwicGl0IjoiMjk4MTI5NzUifQ%3D%3D&size=30`

Это первично подтверждает, что пользовательский real-estate listing использует
opaque `cursor` token и передаёт `size=30`; `cur=USD` здесь является отдельным
параметром отображения валюты, а не cursor. Сам body второй страницы получить не
удалось: переход завершился cache-miss на web-fetch до получения ответа Kufar,
поэтому page-2 fixture не создавалась.

### Актуальный внешний идентификатор

Клик по первой карточке основной выдачи раскрыл текущий route:

`https://re.kufar.by/vi/minsk/kupit/kvartiru/v-novostrojke/1083107250?...`

Наблюдаемый real-estate external id: `1083107250`.

Дополнительно свежая публичная карточка аренды в индексе имеет id
`1075744810` и route `/vi/minskij-rajon/snyat/dom/1075744810`.

Эти значения находятся в том же десятизначном диапазоне, что и electronics ids
из `1.0.1`, однако совпадения конкретного id между вертикалями не наблюдалось.
Одинаковый числовой диапазон не доказывает ни глобальную уникальность, ни
коллизию namespace.

## Secondary evidence — только для сужения следующего probe

Открытый real-estate клиент с commit `7bd35843b05008b698b1d727ba8970e3f23dc161`
(2026-01-27) использует:

`https://api.kufar.by/search-api/v2/search/rendered-paginated`

и request shape для продажи квартир в Минске:

- `cat=1010`;
- `cur=USD`;
- `gtsy=country-belarus~province-minsk~locality-minsk`;
- `lang=ru`;
- `typ=sell`;
- `sort=lst.d`;
- `size=30`;
- optional rooms `rms=v.or:...`;
- optional price `prc=r:min,max`.

Несколько более старых открытых клиентов показывают тот же endpoint и базовые
параметры. Это **не raw live fixture 1.0.2** и не считается подтверждением
контракта до прямого ответа площадки.

## Что уже можно сравнить с electronics

Observed user-layer различия:

- товарная выдача живёт на `www.kufar.by/l/...`, real estate — на
  `re.kufar.by/l/...`;
- real-estate route кодирует операцию (`kupit` / `snyat`) и тип объекта
  (`kvartiru`, `dom`) в path;
- page-2 real-estate href содержит `cur=USD`, `cursor`, `size=30`;
- карточка недвижимости использует `/vi/.../{id}`, а товарная карточка —
  `/item/{id}`.

Secondary API evidence предполагает, что различия остаются в основном в
параметрах (`typ`, `gtsy`, `rms`, `prc`) при том же JSON endpoint, но это ещё
нужно подтвердить primary raw responses.

## Предварительный вывод по SourceAdapter

На текущих данных нет оснований менять задуманный общий интерфейс
`page(CanonicalQuery, cursor) -> normalized listings + nextCursor`: различия
выглядят как ответственность конкретного адаптера при построении request и
нормализации response.

Это **предварительный** вывод. Карточку `1.3.1` не меняем до сравнения raw page-1
и page-2 JSON обеих вертикалей.

## Проверка глобального `Listing.listId`

Текущая Prisma-модель использует `Listing.listId String @id`, то есть предполагает
глобальную уникальность external id между адаптерами.

На этом checkpoint:

- real-estate ids стабильным повторным raw-чтением ещё не проверены;
- concrete cross-vertical collision не наблюдалась;
- одинаковый диапазон id показывает, что нельзя считать пространства заведомо
  раздельными только по числовому виду;
- переход на составной ключ `source + externalId` пока **не обоснован primary
  evidence**, но и глобальная уникальность ещё не доказана.

Поэтому `0.3.1` и Prisma schema сейчас не меняются. Решение принимается только
после продолжения `1.0.2`.

## Stop-condition

После успешного чтения нескольких live cached/user-layer представлений попытка
открыть `https://re.kufar.by/l/minsk` через live web-fetch 2026-09-07 вернула
`403 Forbidden`.

Согласно `docs/AGENTS.md` и утверждённому spike design разведка немедленно
остановлена. Не выполнялись повторные probes, смена сети, proxy/VPN или иной
fallback для обхода ответа площадки.

Отдельно Opera Browser Connector в этой сессии умел читать список вкладок, но
операция навигации возвращала `Tabs are unchanged` даже для `www.kufar.by`.
Это browser-layer ограничение, не HTTP-ответ Kufar.

## Что осталось для закрытия 1.0.2

В следующей разрешённой live-сессии, начиная заново и по одному запросу:

1. получить raw page 1 по real-estate API;
2. взять `next` cursor только из raw response и получить raw page 2;
3. сохранить обе dated fixtures;
4. подтвердить API host/path и фактические `cat`, `typ`, location parameters;
5. сравнить response fields с electronics fixtures;
6. повторно прочитать один real-estate id и проверить стабильность;
7. проверить namespace ids достаточно сильным evidence для решения о ключе;
8. финализировать вывод по `SourceAdapter`, contract spec и acceptance checklist.
