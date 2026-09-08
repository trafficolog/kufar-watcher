# Разведка Kufar: HTML embedded-state fallback — 2026-09-08

## Статус

Recon-gate задачи `1.3.4` пройден для обеих поддерживаемых вертикалей: Electronics и Real Estate. Пользователь вручную скопировал точные `<script id="__NEXT_DATA__" type="application/json">...</script>` блоки из `view-source:` публичных search pages, потому что Opera Browser Connector в этой сессии не мог читать `view-source:` accessibility tree. Прокси, VPN, fingerprint/User-Agent spoofing, авторизация, CAPTCHA bypass и другие способы обхода ограничений не использовались.

Подтверждены page 1 и page 2, carrier, exact embedded-state path, cursor forwarding и последующая pagination. DOM/card parsing не использовался.

## Общий search-page carrier

Обе вертикали используют один подтверждённый carrier:

```html
<script id="__NEXT_DATA__" type="application/json">...</script>
```

После `JSON.parse` search state находится по одному и тому же пути:

- search container: `props.initialState.listing`;
- records: `props.initialState.listing.ads`;
- pagination: `props.initialState.listing.pagination`.

Важное отличие от primary JSON API: embedded `listing.pagination` — **массив страниц напрямую**, тогда как существующий primary normalizer принимает `pagination.pages[]`. Поэтому HTML decoder должен сделать только lossless-проекцию:

```text
embedded listing.ads        -> api-shaped ads
embedded listing.pagination -> api-shaped pagination.pages
```

Сами объявления не преобразуются до существующего vertical normalizer.

## Electronics

### Page 1

URL:

`https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5`

Наблюдалось:

- `props.initialState.router.host = "https://www.kufar.by"`;
- `props.initialState.router.asPath = "/l/r~minsk/igry-i-pristavki/q~ps5?"`;
- `ads.length = 43`;
- первый `ad_id = 1084343116`;
- последний `ad_id = 1084297167`;
- `pagination`: `self.num = 1`, `next.num = 2`;
- page-2 token: `eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MiwicGl0IjoiMjk4MTQzNjYifQ==`.

Полный manual source capture SHA-256:

`f938ad121e2d7c7a676cfca9f0635150a77b967d97db05c0388ec95ed1107f80`

Reduced repository fixture:

`tests/fixtures/kufar/2026-09-08-electronics-search-page-1-embedded.html`

### Page 2

URL использовал page-1 token **без декодирования** как обычный `cursor` query parameter:

`https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5?cursor=eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MiwicGl0IjoiMjk4MTQzNjYifQ%3D%3D&size=30`

Наблюдалось:

- `router.query.cursor` содержит тот же opaque token без преобразования;
- `router.queryForBe.cursor` содержит тот же opaque token без преобразования;
- `ads.length = 43`;
- пересечение `ad_id` с page 1: `0`;
- `self.num = 2`;
- `prev.num = 1`;
- `next.num = 3`;
- новый next token: `eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MywicGl0IjoiMjk4MTQzNzkifQ==`.

Полный manual source capture SHA-256:

`559e5343874637ddff5ab2c9872da5fa2c96fdcc771e5e2eea4f21220bc5789a`

Reduced repository fixture:

`tests/fixtures/kufar/2026-09-08-electronics-search-page-2-embedded.html`

## Real Estate

### Page 1

URL:

`https://re.kufar.by/l/minsk/kupit/kvartiru?cur=USD`

Наблюдалось:

- `props.initialState.router.host = "https://re.kufar.by"`;
- `props.initialState.router.asPath = "/l/minsk/kupit/kvartiru?cur=USD"`;
- `ads.length = 30`;
- первый `ad_id = 1075499901`;
- `pagination`: `self.num = 1`, `next.num = 2`;
- page-2 token: `eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MiwicGl0IjoiMjk4MTQzNjcifQ==`.

Полный manual source capture SHA-256:

`3a46c7cb60294e8e0fd05a6d856a7101e47de605e90df05f2e3d1ec004c8dd7a`

Reduced repository fixture:

`tests/fixtures/kufar/2026-09-08-realestate-search-page-1-embedded.html`

### Page 2

URL использовал page-1 token без декодирования:

`https://re.kufar.by/l/minsk/kupit/kvartiru?cur=USD&cursor=eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MiwicGl0IjoiMjk4MTQzNjcifQ%3D%3D&size=30`

Наблюдалось:

- `router.query.cursor` и `router.queryForBe.cursor` сохраняют exact opaque token;
- `ads.length = 30`;
- с page 1 повторяются 5 `ad_id`, а 25 `ad_id` на page 2 новые; page 2 не является повтором page 1;
- `self.num = 2`;
- `prev.num = 1`;
- `next.num = 3`;
- новый next token: `eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MywicGl0IjoiMjk4MTQzODAifQ==`.

Наличие повторяющихся listing ids не меняет cursor contract: пользовательский route реально перешёл на `self=2`, а downstream обход по существующему контракту всё равно обязан дедуплицировать listings по id/watermark semantics.

Полный manual source capture SHA-256:

`efa667321a59b9b6618ee868b8d95c11cf74550edb70963ed4d640ef2149cc96`

Reduced repository fixture:

`tests/fixtures/kufar/2026-09-08-realestate-search-page-2-embedded.html`

## Required-field validation

В page-1/page-2 embedded records обеих вертикалей присутствуют поля, используемые существующими normalizers:

- `ad_id`;
- `list_time`;
- `subject`;
- `price_byn`;
- `price_usd`;
- `currency`;
- `account_id`;
- `company_ad`;
- `ad_parameters`.

Поэтому fallback не нуждается в отдельной доменной нормализации: после структурной projection он проходит через `normalizeElectronicsSearchPage` или `normalizeRealEstateSearchPage`.

## Cursor compatibility boundary

Старые primary API fixtures от 2026-09-07 относятся к другому snapshot и имеют другие exact token values. Поэтому recon **не утверждает** побитовое равенство cursor из разных дат.

Подтверждён механизм, необходимый для `SourcePageRequest.cursor`: user-facing HTML route принимает opaque `cursor=<token>`, сохраняет его без декодирования в `router.query`/`router.queryForBe`, возвращает `self=2` и публикует новый `next.token`. Fallback adapter должен передавать входной cursor неизменённым и не интерпретировать его содержимое.

## Reduced fixtures

Полные manual source blocks занимают примерно 3.6 MB и содержат нерелевантное SSR/UI state. В репозиторий сохранены детерминированные reduced fixtures с тем же подтверждённым carrier и exact observed values для:

- `props.initialState.router`;
- одного representative `listing.ads[]` record;
- полного `listing.pagination`;
- `listing.total`.

Никакие synthetic cursor/listing values не добавлялись. SHA-256 полных captures приведены выше для traceability.

## Evidence matrix

| Vertical | Search URL | Carrier | Search payload path | Pagination path/mechanism | Page 2 proven | Required fields present | Gate |
|---|---|---|---|---|---:|---:|---|
| Electronics | `/l/r~minsk/igry-i-pristavki/q~ps5` | `__NEXT_DATA__` | `props.initialState.listing` | `listing.pagination[]`; `cursor` forwarded unchanged | yes | yes | pass |
| Real Estate | `/l/minsk/kupit/kvartiru?cur=USD` | `__NEXT_DATA__` | `props.initialState.listing` | `listing.pagination[]`; `cursor` forwarded unchanged | yes | yes | pass |

## Recon conclusion

Обе строки gate = `pass`. Production implementation может начинаться по approved design при следующих жёстких условиях:

1. primary JSON API остаётся первым каналом;
2. fallback разрешён только после exhausted `network` / `timeout` / `http-5xx` primary failure;
3. `429`, permanent HTTP и primary schema drift не переключают канал;
4. embedded state извлекается только из confirmed `__NEXT_DATA__`, без DOM/card parsing;
5. embedded `pagination[]` losslessly оборачивается в `pagination.pages[]` и затем передаётся в существующий vertical normalizer;
6. degraded success возвращается только после успешной mandatory degradation-event publication.
