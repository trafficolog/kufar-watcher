# Electronics Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first concrete Kufar electronics `SourceAdapter`, backed by the existing classified HTTP client and a fixture-tested normalizer with exact cursor and price semantics.

**Architecture:** Keep response parsing and normalization in a pure worker module, then wrap it with a thin injected-HTTP adapter. Semantic query mapping remains in `buildKufarApiUrl`; the adapter adds only transport pagination state. Live probes are stored as dated evidence, while CI tests remain fully offline.

**Tech Stack:** TypeScript 6, Node 22, Vitest 5, existing `KufarHttpClient`, existing shared `CanonicalQuery` / `Listing` / `SourceAdapter` contracts.

**Spec:** `docs/superpowers/specs/2026-09-08-1-3-2-electronics-adapter-design.md`

## Global Constraints

- Node runtime remains `>=22 <23`; do not add dependencies.
- `price_byn` positive digit strings are BYN minor units and normalize to exact two-decimal strings.
- `price_byn="0"` means `priceKind: "negotiable"`, `priceAmount: null`, `currency: null` for the confirmed electronics contract.
- Positive `price_byn` normalizes raw `currency="BYR"` or `"BYN"` to domain `currency: "BYN"`.
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
- Add `tests/fixtures/kufar/2026-09-08-electronics-search-page-1.json`: fresh page-1 evidence captured manually from the confirmed live endpoint.
- Add `tests/fixtures/kufar/2026-09-08-electronics-search-page-2.json`: fresh page-2 evidence using the exact page-1 next cursor.
- Modify `docs/superpowers/specs/kufar-api-contract.md`: record 2026-09-08 reconfirmation and domain price normalization.
- Modify `docs/tasks/1-3-2-adapter-electronics.md`: mark task done/aligned and summarize evidence after implementation passes.
- Modify `docs/epics/1-3-source-adapters.md` and generated operations status files through `npm run docs:ops:refresh`.

---

### Task 1: Fixture-Driven Electronics Normalizer

**Files:**
- Create: `tests/unit/kufar-electronics-normalizer.test.ts`
- Create: `electron/worker/kufar-electronics-normalizer.ts`
- Read: `tests/fixtures/kufar/2026-09-07-electronics-search-page-1.json`
- Read: `tests/fixtures/kufar/2026-09-07-electronics-search-page-2.json`
- Read: `tests/fixtures/kufar/2026-09-07-electronics-negotiable.json`

**Interfaces:**
- Consumes: `SourcePage` from `shared/source-adapter.ts`, `Listing` / `JsonValue` from `shared/listing.ts`.
- Produces:
  - `export type KufarNormalizationErrorCode = 'invalid-json' | 'invalid-page' | 'missing-field' | 'invalid-field'`
  - `export class KufarNormalizationError extends Error { readonly code: KufarNormalizationErrorCode; readonly path: string }`
  - `export function normalizeElectronicsSearchPage(body: Uint8Array): SourcePage`

- [ ] **Step 1: Write the RED fixture tests**

Create `tests/unit/kufar-electronics-normalizer.test.ts` with helpers that load fixture bytes through Node `readFile` and clone parsed JSON only for malformed cases. Cover these exact assertions:

```ts
const page1 = normalizeElectronicsSearchPage(await fixtureBytes('2026-09-07-electronics-search-page-1.json'))
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
expect(page1.nextCursor).toBe('eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MiwicGl0IjoiMjk4MTI4MTQifQ==')
```

Also assert:

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

For page 1 / page 2 overlap:

```ts
const firstIds = new Set(page1.listings.map(({ listId }) => listId))
const page2 = normalizeElectronicsSearchPage(await fixtureBytes('2026-09-07-electronics-search-page-2.json'))
expect(page2.listings.every(({ listId }) => !firstIds.has(listId))).toBe(true)
expect(page2.nextCursor).toBe('eyJ0IjoiYWJzIiwiZiI6dHJ1ZSwicCI6MywicGl0IjoiMjk4MTI4MTQifQ==')
```

Add malformed payload cases using an `encodeJson(value)` helper:

```ts
expect(() => normalizeElectronicsSearchPage(encodeJson({ pagination: { pages: [] } }))).toThrowError(
  expect.objectContaining({ code: 'missing-field', path: 'ads' }),
)
```

Clone page 1 and delete / replace each required field to prove precise failures for at least:

- `ads[0].ad_id` missing -> `missing-field`
- `ads[0].subject` empty string -> `invalid-field`
- `ads[0].list_time` invalid date -> `invalid-field`
- `ads[0].price_byn` set to `"12.5"` -> `invalid-field`
- `ads[0].currency` set to `"USD"` -> `invalid-field`
- `ads[0].account_id` missing -> `missing-field`
- `ads[0].company_ad` set to string -> `invalid-field`
- `pagination.pages` missing -> `missing-field`
- `next` item with numeric token -> `invalid-field` at `pagination.pages[next].token`
- malformed UTF-8-decoded JSON bytes -> `invalid-json` at `$`

- [ ] **Step 2: Commit RED only**

Commit only the new test file:

```bash
git add tests/unit/kufar-electronics-normalizer.test.ts
git commit -m "test(1.3.2): define electronics normalization contract"
```

- [ ] **Step 3: Verify RED on the exact commit**

Run:

```bash
npm test -- tests/unit/kufar-electronics-normalizer.test.ts
```

Expected: FAIL because `electron/worker/kufar-electronics-normalizer.ts` does not exist. On this remote-only workflow, use the branch push-triggered `verify` run as exact-SHA evidence and confirm the unit-test failure is the new missing module, not an unrelated failure.

- [ ] **Step 4: Implement the minimal normalizer**

Create `electron/worker/kufar-electronics-normalizer.ts`. Use small local validators rather than a new schema dependency.

Core public shape:

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
  // decode -> JSON.parse -> page validation -> ad normalization -> next cursor
}
```

Use this exact-price strategy to avoid JS numeric precision:

```ts
function bynMinorUnitsToDecimal(raw: string, path: string): string {
  if (!/^\d+$/.test(raw) || raw === '0') {
    throw new KufarNormalizationError('invalid-field', path, 'Expected positive BYN minor units')
  }

  const padded = raw.padStart(3, '0')
  return `${padded.slice(0, -2)}.${padded.slice(-2)}`
}
```

Price normalization must branch before calling it:

```ts
if (priceByn === '0') {
  priceKind = 'negotiable'
  priceAmount = null
  currency = null
} else {
  if (rawCurrency !== 'BYR' && rawCurrency !== 'BYN') invalidField(...)
  priceKind = 'fixed'
  priceAmount = bynMinorUnitsToDecimal(priceByn, `${path}.price_byn`)
  currency = 'BYN'
}
```

Required validator semantics:

- distinguish missing property from wrong type;
- require `ad_id` to be a non-negative safe integer number, then `String(ad_id)`;
- require non-empty `subject` and `account_id` strings;
- require `company_ad` boolean;
- require `list_time` string with finite `Date.parse` result;
- require `price_byn` string;
- require raw `currency` string and, for positive price, only `BYR` / `BYN`;
- prefer valid Kufar HTTP(S) `ad_link`, otherwise fallback to `https://www.kufar.by/item/${ad_id}`;
- `region` is `vl` from the first object in `ad_parameters` whose `p === 'region'`, only when `vl` is a string;
- `description` is `body_short` only when a string, otherwise `null`;
- `raw` is the original parsed ad object as `JsonValue`.

Next cursor semantics:

```ts
const next = pages.find((page) => isRecord(page) && page.label === 'next')
if (next === undefined) return null
if (typeof next.token !== 'string') invalidField('pagination.pages[next].token')
return next.token
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- tests/unit/kufar-electronics-normalizer.test.ts
npm run typecheck:electron
npm run lint -- --no-warn-ignored electron/worker/kufar-electronics-normalizer.ts tests/unit/kufar-electronics-normalizer.test.ts
npm run format:check -- electron/worker/kufar-electronics-normalizer.ts tests/unit/kufar-electronics-normalizer.test.ts
```

Expected: all pass. If formatting alone fails, apply Prettier-only formatting before the GREEN commit and rerun all four commands.

- [ ] **Step 6: Commit GREEN**

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
- Consumes:
  - `SourceAdapter`, `SourcePageRequest`, `SourcePage`
  - `buildKufarApiUrl(query: CanonicalQuery): string`
  - `KufarHttpResult`
  - `normalizeElectronicsSearchPage(body: Uint8Array): SourcePage`
- Produces:
  - `export type KufarHttpGetter = Pick<KufarHttpClient, 'get'>`
  - `export class KufarAdapterRequestError extends Error { readonly result: Extract<KufarHttpResult, { ok: false }> }`
  - `export class KufarElectronicsAdapter implements SourceAdapter`

- [ ] **Step 1: Write the RED adapter tests**

Create `tests/unit/kufar-electronics-adapter.test.ts` using a tiny fake getter that records URLs and returns fixture bytes.

Use this canonical query:

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

First-page assertion:

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

Second-page assertion must use an arbitrary opaque token, not a decoded fixture value:

```ts
await adapter.fetchPage({ query, cursor: 'opaque+/=token' })
expect(new URL(calls[1]!).searchParams.get('cursor')).toBe('opaque+/=token')
```

Add one table-driven test for all classified failures:

```ts
const failures: Extract<KufarHttpResult, { ok: false }>[] = [
  { ok: false, kind: 'temporary', code: 'network', status: null, attempts: 3, message: 'network' },
  { ok: false, kind: 'permanent', code: 'http-4xx', status: 400, attempts: 1, message: 'bad request' },
  {
    ok: false,
    kind: 'rate-limited',
    code: 'rate-limited',
    status: 429,
    attempts: 1,
    message: 'limited',
    retryAfterMs: 60_000,
  },
]
```

For each, assert `await adapter.fetchPage(...)` rejects with `KufarAdapterRequestError` whose `.result` is the exact same object by identity.

- [ ] **Step 2: Commit RED only**

```bash
git add tests/unit/kufar-electronics-adapter.test.ts
git commit -m "test(1.3.2): define electronics adapter transport contract"
```

- [ ] **Step 3: Verify RED on the exact commit**

Run:

```bash
npm test -- tests/unit/kufar-electronics-adapter.test.ts
```

Expected: FAIL because `electron/worker/kufar-electronics-adapter.ts` does not exist. Confirm the exact-SHA branch verify run fails for the same reason only.

- [ ] **Step 4: Implement the minimal adapter**

Create `electron/worker/kufar-electronics-adapter.ts`:

```ts
import type { SourceAdapter, SourcePageRequest, SourcePage } from '../../shared/source-adapter'
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

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- tests/unit/kufar-electronics-adapter.test.ts tests/unit/kufar-electronics-normalizer.test.ts
npm run typecheck:electron
npm run lint -- --no-warn-ignored electron/worker/kufar-electronics-adapter.ts tests/unit/kufar-electronics-adapter.test.ts
npm run format:check -- electron/worker/kufar-electronics-adapter.ts tests/unit/kufar-electronics-adapter.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit GREEN**

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
- Modify through generator: `docs/epics/1-3-source-adapters.md`, `docs/operations/status/*`, phase/task rollups as produced by `docs:ops:refresh`

**Interfaces:**
- Consumes: the already manually confirmed 2026-09-08 page-1 endpoint and exact next cursor used for page 2.
- Produces: dated raw evidence plus aligned task/epic status; no production API.

- [ ] **Step 1: Store the fresh raw page fixtures**

Capture the exact JSON response bodies from these already-confirmed manual probes without reformatting field values:

```text
https://api.kufar.by/search-api/v2/search/rendered-paginated?cat=5040&rgn=7&query=ps5&size=2&sort=lst.d&lang=ru
```

and the second request using the exact `next.token` returned by page 1 as `cursor=<token>`.

Save them as:

```text
tests/fixtures/kufar/2026-09-08-electronics-search-page-1.json
tests/fixtures/kufar/2026-09-08-electronics-search-page-2.json
```

Before committing, verify manually from the stored JSON that:

- both `ads` arrays are non-empty;
- the ID sets do not overlap;
- page 1 contains a `label="next"` string token;
- page 2 contains `label="prev"`, `label="self"`, and a new `label="next"` token;
- at least one 2026-09-08 page-1 ad has `price_byn="0"`.

- [ ] **Step 2: Update the contract spec with only evidence-backed statements**

In `docs/superpowers/specs/kufar-api-contract.md`, add a dated 2026-09-08 reconfirmation note stating:

- the endpoint/core field/cursor shape was rechecked live;
- page 2 was obtained by replaying page 1's exact opaque next token;
- page 1/page 2 ad IDs were non-overlapping in that probe;
- `price_byn="0"` was again observed in a live electronics result;
- implementation-level normalization interprets positive `price_byn` as BYN minor units and outputs exact decimal BYN strings;
- raw `currency="BYR"` is accepted as the platform's legacy marker and normalized to domain `BYN` for fixed prices;
- zero-price electronics remains negotiable and therefore has no numeric amount/currency in the domain `Listing`.

Do not generalize these rules to real estate in this task.

- [ ] **Step 3: Mark task source docs complete**

Update `docs/tasks/1-3-2-adapter-electronics.md`:

```yaml
status: done
sync_state: aligned
last_reviewed: 2026-09-08
```

Check all acceptance boxes and add a concise result section naming:

- pure fixture normalizer;
- typed required-field failures;
- fixed vs negotiable price normalization;
- injected classified HTTP client;
- exact opaque cursor support;
- fresh 2026-09-08 page-1/page-2 evidence;
- offline CI tests.

Update the epic source card so epic `1.3` remains in progress with `2/4` tasks done.

- [ ] **Step 4: Regenerate operations status**

Run:

```bash
npm run docs:ops:refresh
npm run docs:ops:check
```

Expected: `check: OK`; only generated status/rollup files implied by the task/epic changes should change.

- [ ] **Step 5: Run complete verification before docs commit**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run docs:ops:check
```

Expected: all pass locally where available. In the remote-only workflow, the final branch Actions run is the authoritative full-environment verification and must additionally pass Postgres compose integration, Electron Linux sandbox, build/output verification, and development/production launch smoke.

- [ ] **Step 6: Commit evidence and aligned docs**

```bash
git add tests/fixtures/kufar/2026-09-08-electronics-search-page-1.json \
  tests/fixtures/kufar/2026-09-08-electronics-search-page-2.json \
  docs/superpowers/specs/kufar-api-contract.md \
  docs/tasks/1-3-2-adapter-electronics.md \
  docs/epics/1-3-source-adapters.md \
  docs/operations/status

git commit -m "docs(1.3.2): align electronics adapter evidence"
```

- [ ] **Step 7: Exact-SHA full verification and review**

On the final committed branch SHA, require the full `verify` workflow to pass:

- Documentation consistency
- Unit tests
- CI failure-mode self-check
- Typecheck
- Lint
- Formatting
- Postgres compose integration
- Electron Linux sandbox preparation
- Build
- Build output verification
- Development launch smoke
- Production launch smoke

Then compare `main...feat/1.3.2-electronics-adapter` and perform a scope/code review. Reject any unexpected runtime composition, persistence, fallback, real-estate, watermark, or dependency changes before finishing the branch.
