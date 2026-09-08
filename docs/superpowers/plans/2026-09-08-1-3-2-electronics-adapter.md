# Electronics Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first concrete Kufar electronics `SourceAdapter`, backed by the existing classified HTTP client and a fixture-tested normalizer with exact cursor and price semantics.

**Architecture:** Keep response parsing and normalization in a pure worker module, then wrap it with a thin injected-HTTP adapter. Semantic query mapping remains in `buildKufarApiUrl`; the adapter adds only transport pagination state. Live probes are stored as dated evidence, while CI tests remain fully offline.

**Tech Stack:** TypeScript 6, Node 22, Vitest 5, existing `KufarHttpClient`, existing shared `CanonicalQuery` / `Listing` / `SourceAdapter` contracts.

**Spec:** `docs/superpowers/specs/2026-09-08-1-3-2-electronics-adapter-design.md`

## Global Constraints

- Node runtime remains `>=22 <23`; do not add dependencies.
- `price_byn` positive digit strings are BYN minor units and normalize to exact two-decimal strings.
- Every confirmed electronics ad must carry raw `currency` equal to `BYR` or `BYN`; any other value is schema drift.
- `price_byn="0"` means `priceKind: "negotiable"`, `priceAmount: null`, `currency: null` for the confirmed electronics contract.
- Positive `price_byn` normalizes accepted raw `BYR|BYN` to domain `currency: "BYN"`.
- Cursor is opaque transport state: pass it unchanged as `cursor`, never decode it, and never put it into `CanonicalQuery`.
- A malformed required ad fails the whole page with a typed normalization error; do not silently skip it.
- Adapter HTTP failures preserve the existing `KufarHttpResult` classification; do not duplicate retry/rate-limit policy.
- CI tests must not call Kufar over the network.
- Do not add runtime/registry composition, real-estate parsing, HTML fallback, detail fetching, persistence, watermark logic, seller filtering, or schema fingerprinting.

---

## File Map

- Create `electron/worker/kufar-electronics-normalizer.ts`: parse bytes, validate confirmed electronics response shape, normalize `Listing[]`, extract next cursor, expose typed normalization errors.
- Create `tests/unit/kufar-electronics-normalizer.test.ts`: fixture-driven and malformed-payload normalizer tests.
- Create `electron/worker/kufar-electronics-adapter.ts`: `SourceAdapter` implementation over injected `KufarHttpClient.get`-compatible dependency.
- Create `tests/unit/kufar-electronics-adapter.test.ts`: URL/cursor/error propagation tests with fake HTTP getter.
- Add `tests/fixtures/kufar/2026-09-08-electronics-search-page-1.json` and `...page-2.json`: fresh manual evidence.
- Modify `docs/superpowers/specs/kufar-api-contract.md`, task/epic source cards, and generated docs status rollups.

---

### Task 1: Fixture-Driven Electronics Normalizer

**Files:**
- Create: `tests/unit/kufar-electronics-normalizer.test.ts`
- Create: `electron/worker/kufar-electronics-normalizer.ts`
- Read: `tests/fixtures/kufar/2026-09-07-electronics-search-page-1.json`
- Read: `tests/fixtures/kufar/2026-09-07-electronics-search-page-2.json`
- Read: `tests/fixtures/kufar/2026-09-07-electronics-negotiable.json`

**Interfaces:**
- Consumes: `SourcePage` from `shared/source-adapter.ts`; `Listing` / `JsonValue` from `shared/listing.ts`.
- Produces:
  - `KufarNormalizationErrorCode = 'invalid-json' | 'invalid-page' | 'missing-field' | 'invalid-field'`
  - `KufarNormalizationError` with exact `code` and `path`
  - `normalizeElectronicsSearchPage(body: Uint8Array): SourcePage`

- [ ] **Step 1: Write the RED fixture tests**

Create `tests/unit/kufar-electronics-normalizer.test.ts` with a fixture-byte helper using Node `readFile`. Exact happy-path assertions:

```ts
const page1 = normalizeElectronicsSearchPage(
  await fixtureBytes('2026-09-07-electronics-search-page-1.json'),
)
expect(page1.listings).toHaveLength(2)
expect(page1.listings[0]).toMatchObject({
  listId: '1084212880',
  title: '007 First Light PS5 Игра',
  priceKind: 'fixed',
  priceAmount: '180.00',
  currency: 'BYN',
  url: 'https://www.kufar.by/item/1084212880',
  region: 'Минск',
  accountId: 'O7rIEl9s3ROIilr9xxUsVlI',
  isCompany: false,
  listTime: '2026-09-07T08:08:34Z',
  description: null,
})
expect(page1.nextCursor).toBe(
  'eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MiwicGl0IjoiMjk4MTI4MTQifQ==',
)
```

Negotiable assertion:

```ts
const negotiable = normalizeElectronicsSearchPage(
  await fixtureBytes('2026-09-07-electronics-negotiable.json'),
)
expect(negotiable.listings[0]).toMatchObject({
  listId: '1082715190',
  priceKind: 'negotiable',
  priceAmount: null,
  currency: null,
})
```

Pagination and non-overlap:

```ts
const page2 = normalizeElectronicsSearchPage(
  await fixtureBytes('2026-09-07-electronics-search-page-2.json'),
)
const page1Ids = new Set(page1.listings.map(({ listId }) => listId))
expect(page2.listings.every(({ listId }) => !page1Ids.has(listId))).toBe(true)
expect(page2.nextCursor).toBe(
  'eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MywicGl0IjoiMjk4MTI4MTQifQ==',
)
```

Add an `encodeJson(value)` helper and malformed copies of page 1. Require exact failures:

- root malformed JSON -> `invalid-json`, path `$`
- root not object -> `invalid-page`, path `$`
- `ads` missing -> `missing-field`, path `ads`
- `ads` not array -> `invalid-field`, path `ads`
- `ads[0].ad_id` missing -> `missing-field`
- `ads[0].subject` empty -> `invalid-field`
- `ads[0].list_time` invalid date -> `invalid-field`
- `ads[0].price_byn="12.5"` -> `invalid-field`
- `ads[0].currency="USD"` -> `invalid-field`, regardless of price value
- `ads[0].account_id` missing -> `missing-field`
- `ads[0].company_ad="false"` -> `invalid-field`
- `pagination.pages` missing -> `missing-field`
- `pagination.pages` not array -> `invalid-field`
- `next` entry with non-string token -> `invalid-field`, path `pagination.pages[next].token`

Also test URL fallback by deleting `ad_link` and expecting `https://www.kufar.by/item/<ad_id>`.

- [ ] **Step 2: Commit RED only**

```bash
git add tests/unit/kufar-electronics-normalizer.test.ts
git commit -m "test(1.3.2): define electronics normalization contract"
```

- [ ] **Step 3: Verify RED on the exact commit**

```bash
npm test -- tests/unit/kufar-electronics-normalizer.test.ts
```

Expected: FAIL because `electron/worker/kufar-electronics-normalizer.ts` does not exist. In this remote-only workflow, confirm the branch `verify` run for that exact SHA fails on the new missing module while prior suites stay green.

- [ ] **Step 4: Implement the minimal normalizer**

Create `electron/worker/kufar-electronics-normalizer.ts` with this public shape:

```ts
import type { JsonValue, Listing } from '../../shared/listing'
import type { SourcePage } from '../../shared/source-adapter'

export type KufarNormalizationErrorCode =
  | 'invalid-json'
  | 'invalid-page'
  | 'missing-field'
  | 'invalid-field'

export class KufarNormalizationError extends Error {
  constructor(
    readonly code: KufarNormalizationErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(message)
    this.name = 'KufarNormalizationError'
  }
}

export function normalizeElectronicsSearchPage(body: Uint8Array): SourcePage {
  // parse bytes, validate page, normalize every ad, extract next token
}
```

Use string arithmetic, not `number`, for price conversion:

```ts
function bynMinorUnitsToDecimal(raw: string, path: string): string {
  if (!/^\d+$/.test(raw) || raw === '0') {
    throw new KufarNormalizationError(
      'invalid-field',
      path,
      'Expected positive BYN minor units',
    )
  }

  const padded = raw.padStart(3, '0')
  return `${padded.slice(0, -2)}.${padded.slice(-2)}`
}
```

Validate raw currency before the zero/fixed branch:

```ts
if (rawCurrency !== 'BYR' && rawCurrency !== 'BYN') {
  throw new KufarNormalizationError(
    'invalid-field',
    `${path}.currency`,
    'Expected BYR or BYN currency marker',
  )
}

if (priceByn === '0') {
  priceKind = 'negotiable'
  priceAmount = null
  currency = null
} else {
  priceKind = 'fixed'
  priceAmount = bynMinorUnitsToDecimal(priceByn, `${path}.price_byn`)
  currency = 'BYN'
}
```

Required validator semantics:

- distinguish missing property from wrong type;
- `ad_id`: non-negative safe integer number, then `String(ad_id)`;
- `subject`, `account_id`: non-empty strings;
- `company_ad`: boolean;
- `list_time`: string with finite `Date.parse` result;
- `price_byn`: digit-only string;
- `currency`: string and exactly `BYR|BYN`;
- prefer `ad_link` only when it is an HTTP(S) URL on `kufar.by` or a subdomain; if absent, use `https://www.kufar.by/item/${ad_id}`; if present but invalid/foreign, fail `invalid-field` at `ads[n].ad_link`;
- region: first `ad_parameters` record with `p === 'region'` and string `vl`, else `null`;
- description: string `body_short`, else `null`;
- raw: the original parsed ad object as JSON-safe `JsonValue`.

Cursor extraction:

```ts
const next = pages.find((page) => isRecord(page) && page.label === 'next')
if (next === undefined) return null
if (typeof next.token !== 'string') {
  throw new KufarNormalizationError(
    'invalid-field',
    'pagination.pages[next].token',
    'Expected opaque next cursor string',
  )
}
return next.token
```

- [ ] **Step 5: Verify GREEN and commit**

```bash
npm test -- tests/unit/kufar-electronics-normalizer.test.ts
npm run typecheck:electron
npm run lint -- --no-warn-ignored electron/worker/kufar-electronics-normalizer.ts tests/unit/kufar-electronics-normalizer.test.ts
npm run format:check -- electron/worker/kufar-electronics-normalizer.ts tests/unit/kufar-electronics-normalizer.test.ts
```

Apply Prettier-only formatting if formatting is the only failure, rerun, then:

```bash
git add electron/worker/kufar-electronics-normalizer.ts
git commit -m "feat(1.3.2): normalize electronics search pages"
```

---

### Task 2: Electronics SourceAdapter over Classified HTTP Client

**Files:**
- Create: `tests/unit/kufar-electronics-adapter.test.ts`
- Create: `electron/worker/kufar-electronics-adapter.ts`
- Read: `electron/worker/kufar-http-client.ts`
- Read: `shared/kufar-url.ts`

**Interfaces:**
- Consumes `SourceAdapter`, `SourcePageRequest`, `SourcePage`, `buildKufarApiUrl`, `KufarHttpResult`, and `normalizeElectronicsSearchPage`.
- Produces:
  - `KufarHttpGetter = Pick<KufarHttpClient, 'get'>`
  - `KufarAdapterRequestError` preserving the exact failed result
  - `KufarElectronicsAdapter implements SourceAdapter`

- [ ] **Step 1: Write the RED adapter tests**

Use a fake getter that records the requested URL and returns fixture bytes. Canonical query:

```ts
const query: CanonicalQuery = {
  host: 'www.kufar.by',
  category: 'igry-i-pristavki',
  query: 'ps5',
  region: 'minsk',
  sellerType: null,
  sort: null,
  operation: null,
  pathFilters: [],
  extraParams: {},
}
```

First page must assert endpoint and params:

```ts
const result = await adapter.fetchPage({ query, cursor: null })
const requested = new URL(calls[0]!)
expect(requested.origin + requested.pathname).toBe(
  'https://api.kufar.by/search-api/v2/search/rendered-paginated',
)
expect(requested.searchParams.get('cat')).toBe('5040')
expect(requested.searchParams.get('rgn')).toBe('7')
expect(requested.searchParams.get('query')).toBe('ps5')
expect(requested.searchParams.get('sort')).toBe('lst.d')
expect(requested.searchParams.get('lang')).toBe('ru')
expect(requested.searchParams.get('size')).toBe('30')
expect(requested.searchParams.has('cursor')).toBe(false)
expect(result.listings.length).toBeGreaterThan(0)
```

Second page must prove opaque round-trip:

```ts
await adapter.fetchPage({ query, cursor: 'opaque+/=token' })
expect(new URL(calls[1]!).searchParams.get('cursor')).toBe('opaque+/=token')
```

Add table-driven failures for `temporary/network`, `permanent/http-4xx`, and `rate-limited`; require rejection with `KufarAdapterRequestError` and `.result` equal by object identity to the fake client's exact failure object.

- [ ] **Step 2: Commit and verify RED**

```bash
git add tests/unit/kufar-electronics-adapter.test.ts
git commit -m "test(1.3.2): define electronics adapter transport contract"
npm test -- tests/unit/kufar-electronics-adapter.test.ts
```

Expected: missing adapter module. Confirm the exact-SHA branch run fails for that reason only.

- [ ] **Step 3: Implement the minimal adapter**

Create `electron/worker/kufar-electronics-adapter.ts`:

```ts
import type { SourceAdapter, SourcePage, SourcePageRequest } from '../../shared/source-adapter'
import { buildKufarApiUrl } from '../../shared/kufar-url'
import type { KufarHttpClient, KufarHttpResult } from './kufar-http-client'
import { normalizeElectronicsSearchPage } from './kufar-electronics-normalizer'

export type KufarHttpGetter = Pick<KufarHttpClient, 'get'>

export class KufarAdapterRequestError extends Error {
  constructor(readonly result: Extract<KufarHttpResult, { ok: false }>) {
    super(`Kufar electronics request failed: ${result.code}`)
    this.name = 'KufarAdapterRequestError'
  }
}

export class KufarElectronicsAdapter implements SourceAdapter {
  constructor(private readonly httpClient: KufarHttpGetter) {}

  async fetchPage(request: SourcePageRequest): Promise<SourcePage> {
    const url = new URL(buildKufarApiUrl(request.query))
    url.searchParams.set('size', '30')
    if (request.cursor !== null) url.searchParams.set('cursor', request.cursor)

    const result = await this.httpClient.get(url)
    if (!result.ok) throw new KufarAdapterRequestError(result)

    return normalizeElectronicsSearchPage(result.body)
  }
}
```

Do not add `close()`, retries, limiter calls, registry registration, or runtime wiring.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npm test -- tests/unit/kufar-electronics-adapter.test.ts tests/unit/kufar-electronics-normalizer.test.ts
npm run typecheck:electron
npm run lint -- --no-warn-ignored electron/worker/kufar-electronics-adapter.ts tests/unit/kufar-electronics-adapter.test.ts
npm run format:check -- electron/worker/kufar-electronics-adapter.ts tests/unit/kufar-electronics-adapter.test.ts
```

Then:

```bash
git add electron/worker/kufar-electronics-adapter.ts
git commit -m "feat(1.3.2): add electronics source adapter"
```

---

### Task 3: Fresh Live Evidence and Documentation Alignment

**Files:**
- Add: `tests/fixtures/kufar/2026-09-08-electronics-search-page-1.json`
- Add: `tests/fixtures/kufar/2026-09-08-electronics-search-page-2.json`
- Modify: `docs/superpowers/specs/kufar-api-contract.md`
- Modify: `docs/tasks/1-3-2-adapter-electronics.md`
- Modify: `docs/epics/1-3-source-adapters.md`
- Modify through generator: `docs/operations/status/*` and any phase/task rollups emitted by `docs:ops:refresh`

**Interfaces:**
- Consumes: already-confirmed 2026-09-08 manual page-1 probe and exact next cursor used for page 2.
- Produces: dated raw evidence plus aligned task/epic status; no production API.

- [ ] **Step 1: Store fresh raw page fixtures**

Capture the exact JSON bodies from the already-confirmed manual probes:

```text
https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=5040&rgn=7&query=ps5&size=2&sort=lst.d&lang=ru
```

and the same endpoint with the page-1 exact `next.token` as `cursor=<token>`.

Save to the two 2026-09-08 fixture paths. Verify from stored JSON:

- both `ads` arrays non-empty;
- page ID sets non-overlapping;
- page 1 has string `next.token`;
- page 2 has `prev`, `self`, and a new `next` token;
- at least one page-1 ad has `price_byn="0"`.

- [ ] **Step 2: Update only evidence-backed contract statements**

Add a dated 2026-09-08 note to `kufar-api-contract.md` recording endpoint/core-shape reconfirmation, exact opaque cursor replay, non-overlapping page IDs, repeated live zero-price negotiable evidence, BYN minor-unit interpretation, and raw `BYR|BYN` -> domain `BYN` normalization for fixed prices. Do not generalize these implementation rules to real estate.

- [ ] **Step 3: Mark source docs complete and regenerate rollups**

Set task `1.3.2` frontmatter to:

```yaml
status: done
sync_state: aligned
last_reviewed: 2026-09-08
```

Check its acceptance boxes and add a result section naming the pure fixture normalizer, typed drift errors, price semantics, injected HTTP client, opaque cursor support, fresh evidence, and offline tests. Keep epic `1.3` in progress with `2/4` tasks done.

Run:

```bash
npm run docs:ops:refresh
npm run docs:ops:check
```

Expected: `check: OK` and only expected source/generated docs change.

- [ ] **Step 4: Full verification and docs/evidence commit**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run docs:ops:check
```

Then commit the fresh fixtures, contract spec, task/epic cards, and generated status files:

```bash
git add tests/fixtures/kufar/2026-09-08-electronics-search-page-1.json \
  tests/fixtures/kufar/2026-09-08-electronics-search-page-2.json \
  docs/superpowers/specs/kufar-api-contract.md \
  docs/tasks/1-3-2-adapter-electronics.md \
  docs/epics/1-3-source-adapters.md \
  docs/operations/status
git commit -m "docs(1.3.2): align electronics adapter evidence"
```

- [ ] **Step 5: Exact-SHA full verification and review**

Require the final branch `verify` workflow to pass documentation consistency, unit tests, CI self-check, typecheck, lint, formatting, Postgres compose integration, Electron Linux sandbox, build/output verification, development launch smoke, and production launch smoke.

Compare `main...feat/1.3.2-electronics-adapter` and reject unexpected runtime composition, persistence, fallback, real-estate, watermark, dependency, or unrelated changes before finishing the branch.
