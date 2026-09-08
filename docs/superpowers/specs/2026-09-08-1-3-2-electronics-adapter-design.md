# Design — 1.3.2 Electronics adapter

Date: 2026-09-08
Task: `1.3.2`
Status: approved in chat

## Goal

Implement the first concrete `SourceAdapter` for Kufar electronics. It must fetch search pages through the existing Kufar HTTP client, preserve cursor pagination, normalize the confirmed live response shape into the shared `Listing` contract, fail loudly on required-field drift, and be fully testable from dated fixtures without network access.

## Evidence basis

Primary contract evidence already exists from task `1.0.1` in:

- `docs/superpowers/specs/kufar-api-contract.md`
- `docs/recon/kufar-electronics-2026-09-07.md`
- `tests/fixtures/kufar/2026-09-07-electronics-search-page-1.json`
- `tests/fixtures/kufar/2026-09-07-electronics-search-page-2.json`
- `tests/fixtures/kufar/2026-09-07-electronics-negotiable.json`

A fresh manual browser probe on 2026-09-08 reconfirmed the same search endpoint and core response shape, including:

- `ads[]`
- `pagination.pages[]`
- opaque `next.token`
- `ad_id`, `list_time`, `subject`, `price_byn`, `currency`, `account_id`, `company_ad`
- region under `ad_parameters[]`
- a live `price_byn="0"` negotiable listing

The page-1 `next.token` was passed back unchanged as `cursor=<token>` and returned a non-overlapping page 2 with a new next token.

## Chosen architecture

Use a pure normalizer plus a thin network adapter.

### `electron/worker/kufar-electronics-normalizer.ts`

Responsibilities:

- decode the response body;
- parse JSON;
- validate the page shape needed by the adapter;
- normalize each ad into shared `Listing`;
- extract the opaque next cursor.

It has no network, retry, rate-limit, registry, persistence, or runtime lifecycle responsibility.

### `electron/worker/kufar-electronics-adapter.ts`

Responsibilities:

- implement `SourceAdapter`;
- receive an HTTP client dependency through constructor injection;
- call existing `buildKufarApiUrl(query)` for confirmed semantic filters;
- add transport-only pagination parameters;
- call `KufarHttpClient.get`-compatible API;
- preserve HTTP error classification in an adapter-level typed error;
- pass successful response bytes to the pure normalizer.

The adapter does not create or own a `KufarHttpClient`; therefore it does not own client shutdown or limiter lifecycle.

## Request construction

`buildKufarApiUrl(query)` remains the only semantic `CanonicalQuery -> Kufar API` mapper.

The electronics adapter adds only transport state:

- `size=30`
- `cursor=<opaque token>` when request cursor is non-null

Cursor never becomes part of `CanonicalQuery`, is never decoded, and is never synthesized by the adapter.

No special User-Agent, proxy, fingerprinting, VPN, or other bypass behavior is added.

## Required ad fields

A successful normalized ad requires:

- `ad_id`
- `list_time`
- `subject`
- `price_byn`
- `currency`
- `account_id`
- `company_ad`

Mappings:

- `ad_id` -> `Listing.listId` as a decimal string
- `list_time` -> `Listing.listTime` as the original valid ISO-like timestamp string
- `subject` -> `Listing.title`
- `account_id` -> `Listing.accountId`
- `company_ad` -> `Listing.isCompany`

`ad_link` is preferred when it is a valid Kufar HTTP(S) URL. If absent, URL falls back to `https://www.kufar.by/item/<ad_id>` because `ad_link` was not part of the required core contract established by `1.0.1`.

## Optional ad fields

- region: find `ad_parameters[]` entry with `p === "region"` and use string `vl`; otherwise `null`
- `body_short`: use when it is a string; otherwise `description: null`
- original ad object: keep in `Listing.raw`

## Price normalization

The confirmed electronics API exposes `price_byn` as a string in minor units.

Rules:

- positive decimal digits are interpreted as BYN kopecks and converted to an exact two-decimal string;
- `"18000"` -> `priceKind: "fixed"`, `priceAmount: "180.00"`, `currency: "BYN"`;
- `"500"` -> `"5.00"`;
- `"0"` -> `priceKind: "negotiable"`, `priceAmount: null`, `currency: null`;
- negative, fractional, non-digit, or otherwise malformed values are normalization errors.

The raw payload currently uses legacy `currency="BYR"`. For a positive `price_byn`, normalized currency is canonical `BYN`. Raw currency `"BYR"` and `"BYN"` are both accepted so a platform cleanup from legacy code does not by itself break the adapter.

The adapter does not infer `priceKind: "free"` in this task because live electronics evidence establishes zero price as negotiable, not free.

## Page validation and cursor extraction

Required page shape:

- top-level `ads` is an array;
- `pagination.pages` is an array.

Next cursor rule:

- find the element whose `label === "next"`;
- if absent, return `nextCursor: null`;
- if present, `token` must be a string;
- return that token unchanged.

Array index is never used as pagination semantics because page 2 includes `prev` before `self`.

## Normalization errors

Introduce:

```ts
class KufarNormalizationError extends Error {
  readonly code: 'invalid-json' | 'invalid-page' | 'missing-field' | 'invalid-field'
  readonly path: string
}
```

Examples of paths:

- `ads[0].subject`
- `ads[1].price_byn`
- `pagination.pages`

One invalid required ad fails the whole page. The adapter must not silently drop malformed records because that could hide schema drift while the monitor appears healthy.

## HTTP errors

Introduce an adapter request error that preserves the already-classified failure result from `KufarHttpClient`:

```ts
class KufarAdapterRequestError extends Error {
  readonly result: Extract<KufarHttpResult, { ok: false }>
}
```

The adapter does not duplicate or alter retry, timeout, 429 cooldown, or 5xx policy from `1.2.2`.

## Tests

### Pure fixture normalization

Use dated fixtures with no network access to prove:

- page 1 normalizes to a non-empty list;
- exact core fields normalize correctly;
- minor units convert to decimal string;
- negotiable fixture yields `priceKind: "negotiable"` and `priceAmount: null`;
- page 1 and page 2 contain non-overlapping IDs;
- next cursor is extracted by label;
- malformed payload copies produce precise `KufarNormalizationError.code/path` for missing or invalid required fields.

### Adapter tests with fake HTTP client

Prove:

- first request uses `size=30` and no cursor;
- second request appends the exact supplied opaque cursor;
- successful body is normalized;
- temporary, permanent, and rate-limited HTTP failures are preserved inside `KufarAdapterRequestError`;
- retry behavior is not retested here.

### Live evidence and dated fixtures

Store fresh 2026-09-08 page-1/page-2 raw responses under `tests/fixtures/kufar/` and update `kufar-api-contract.md` with:

- reconfirmation date;
- minor-unit interpretation;
- raw `BYR` -> domain `BYN` normalization rule;
- cursor reconfirmation.

CI tests remain offline.

## Explicit non-scope

Do not implement in `1.3.2`:

- registry/runtime composition;
- real-estate adapter;
- watermark or page-depth policy;
- HTML fallback;
- detail endpoint use;
- full description loading;
- Prisma persistence;
- seller filtering;
- schema fingerprinting;
- live-network CI tests.
