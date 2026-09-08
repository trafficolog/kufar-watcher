# Разведка Kufar: HTML embedded-state fallback — 2026-09-08

## Статус

Задача `1.3.4` находится на recon-gate перед production TDD. Opera Browser Connector в этой сессии не смог читать `view-source:`, поэтому пользователь вручную скопировал точные `<script id="__NEXT_DATA__" type="application/json">...</script>` блоки из исходного HTML двух публичных search pages. Прокси, VPN, fingerprint/User-Agent spoofing, авторизация, CAPTCHA bypass и другие способы обхода ограничений не использовались.

На этом этапе подтверждён page-1 structured-state contract для Electronics и Real Estate. Page-2 evidence ещё требуется до снятия hard gate.

## Electronics — page 1

Исходная публичная страница:

`https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5`

Скопированный source block:

- carrier: `<script id="__NEXT_DATA__" type="application/json">`;
- outer JSON валиден;
- `props.initialState.router.host = "https://www.kufar.by"`;
- `props.initialState.router.asPath = "/l/r~minsk/igry-i-pristavki/q~ps5?"`;
- search state: `props.initialState.listing`;
- records: `props.initialState.listing.ads`;
- pagination: `props.initialState.listing.pagination`.

Наблюдаемая page-1 выдача:

- `ads.length = 43`;
- первый `ad_id = 1084343116`;
- последний `ad_id = 1084297167`;
- `pagination[0] = { label: "self", num: 1, token: null }`;
- `pagination[1].label = "next"`;
- `pagination[1].num = 2`;
- exact next token: `eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MiwicGl0IjoiMjk4MTQzNjYifQ==`.

Representative embedded ad contains every field currently required by the Electronics normalizer:

- `ad_id`;
- `list_time`;
- `subject`;
- `price_byn`;
- `price_usd`;
- `currency`;
- `account_id`;
- `company_ad`;
- `ad_parameters`.

The embedded `listing` state is therefore already search-response shaped for the fields used by the existing normalizer. No DOM/card extraction is needed.

Manual source-block SHA-256 for traceability:

`f938ad121e2d7c7a676cfca9f0635150a77b967d97db05c0388ec95ed1107f80`

## Real Estate — page 1

Исходная публичная страница:

`https://re.kufar.by/l/minsk/kupit/kvartiru?cur=USD`

Скопированный source block:

- carrier: `<script id="__NEXT_DATA__" type="application/json">`;
- outer JSON валиден;
- `props.initialState.router.host = "https://re.kufar.by"`;
- `props.initialState.router.asPath = "/l/minsk/kupit/kvartiru?cur=USD"`;
- search state: `props.initialState.listing`;
- records: `props.initialState.listing.ads`;
- pagination: `props.initialState.listing.pagination`.

Наблюдаемая page-1 выдача:

- `ads.length = 30`;
- первый `ad_id = 1075499901`;
- последний `ad_id = 1084339683`;
- `pagination[0] = { label: "self", num: 1, token: null }`;
- `pagination[1].label = "next"`;
- `pagination[1].num = 2`;
- exact next token: `eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MiwicGl0IjoiMjk4MTQzNjcifQ==`.

Representative embedded ad contains every field currently required by the Real Estate normalizer:

- `ad_id`;
- `list_time`;
- `subject`;
- `price_byn`;
- `price_usd`;
- `currency`;
- `account_id`;
- `company_ad`;
- `ad_parameters`.

The embedded `listing` state is therefore already search-response shaped for the fields used by the existing normalizer. No DOM/card extraction is needed.

Manual source-block SHA-256 for traceability:

`3a46c7cb60294e8e0fd05a6d856a7101e47de605e90df05f2e3d1ec004c8dd7a`

## Evidence matrix

| Vertical | Search URL | Carrier | Search payload path | Pagination path/mechanism | Page 2 proven | Required fields present | Gate |
|---|---|---|---|---|---:|---:|---|
| Electronics | `/l/r~minsk/igry-i-pristavki/q~ps5` | `__NEXT_DATA__` | `props.initialState.listing` | `props.initialState.listing.pagination`, opaque `next.token` | no | yes | pending page-2 proof |
| Real Estate | `/l/minsk/kupit/kvartiru?cur=USD` | `__NEXT_DATA__` | `props.initialState.listing` | `props.initialState.listing.pagination`, opaque `next.token` | no | yes | pending page-2 proof |

## Remaining hard gate

Before production implementation:

1. open page 2 for Electronics using the exact observed `next.token` without decoding it;
2. copy the page-2 `__NEXT_DATA__` block and verify `self.num = 2`, a non-overlapping listing id set, and a subsequent `next` token;
3. repeat independently for Real Estate;
4. only after both page-2 checks pass, lock the contract in `docs/superpowers/specs/kufar-api-contract.md` and write the production TDD plan.

If either vertical cannot honor the opaque cursor on the user-facing HTML route, 1.3.4 remains blocked for that vertical. No DOM fallback or guessed pagination mapping is allowed.
