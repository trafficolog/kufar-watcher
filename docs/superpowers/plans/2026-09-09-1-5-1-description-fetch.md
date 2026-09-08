# 1.5.1 Full Description Fetch and Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable Kufar detail-description loader that caches full descriptions in `Listing`, never confuses search `body_short` with a full detail cache, and treats only confirmed `404 + ASR0006` as a non-fatal removed-listing outcome.

**Architecture:** Keep paginated search in `SourceAdapter` and transport semantics in `KufarHttpClient`. Add a dedicated detail parser, a narrow Prisma-backed description repository, and `KufarListingDescriptionService` with durable DB caching plus in-process single-flight. Search persistence preserves cached full descriptions while reactivating listings that reappear in live search.

**Tech Stack:** Node.js 22, TypeScript 6, Vitest 5, Prisma 7.10/PostgreSQL, Undici 7.29.1, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-09-1-5-1-description-fetch-design.md`

## Global Constraints

- Detail endpoint is exactly `GET https://api.kufar.by/search-api/v2/item/{id}/rendered?lang=ru`.
- `gone` is recognized only for HTTP 404 whose parsed body has `error.code === "ASR0006"`; if `error.http.code` is present it must equal 404.
- Other 4xx, malformed 404 payloads, 5xx, rate limiting, timeout, network errors, invalid JSON and contract drift are errors and must not be cached as removal.
- Search `body_short` may populate `Listing.description`; only `descriptionLoaded = true` means the value is the full detail `result.body`.
- Search persistence for an existing row must not overwrite `description` or `descriptionLoaded`.
- A listing observed again in live search is set to `availability = active`.
- Detail cache writes are independent of the monitor-run transaction.
- `SourceAdapter` is not extended for detail loading.
- `runIncrementalMonitor` is not wired to automatically fetch details in this task; call policy belongs to `1.5.2`.
- Do not add image loading or category-specific detail parsing.
- Follow TDD: every production behavior starts from a verified failing test.
- Keep commits focused and run the relevant narrow test after every RED/GREEN cycle.

---

## File Structure

- `prisma/schema.prisma` — durable availability and full-description cache state.
- `prisma/migrations/20260909013000_listing_description_cache/migration.sql` — additive PostgreSQL migration.
- `electron/worker/kufar-http-client.ts` — retain response bytes for HTTP-originated failures without changing retry classification.
- `electron/worker/kufar-listing-detail.ts` — detail success parser, strict removed-response parser, and normalization error.
- `electron/worker/monitor-run-persistence.ts` — preserve cached description fields during search upsert and reactivate live listings.
- `electron/worker/listing-description-repository.ts` — narrow Prisma cache read/write operations.
- `electron/worker/kufar-listing-description-service.ts` — cache-first orchestration, HTTP call, typed request error, and single-flight.
- `tests/unit/kufar-http-client.test.ts` — transport failure-body regression.
- `tests/unit/kufar-listing-detail.test.ts` — fixture-backed parser contract.
- `tests/unit/listing-description-repository.test.ts` — repository call-shape tests with a mocked listing delegate.
- `tests/unit/kufar-listing-description-service.test.ts` — cache, fetch, gone, failure and concurrency behavior.
- `tests/integration/listing-description-cache.test.ts` — PostgreSQL defaults, durable cache preservation and reactivation.
- `docs/tasks/1-5-1-description-fetch.md` — completion state and acceptance checkboxes after verification.

---

### Task 1: Add durable cache state to `Listing`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260909013000_listing_description_cache/migration.sql`
- Create: `tests/integration/listing-description-cache.test.ts`

**Interfaces:**
- Produces Prisma enum `ListingAvailability` with values `active | gone`.
- Produces `Listing.availability: ListingAvailability` defaulting to `active`.
- Produces `Listing.descriptionLoaded: boolean` defaulting to `false`.
- Later tasks consume the generated Prisma fields; the shared source DTO in `shared/listing.ts` is unchanged.

- [ ] **Step 1: Write the failing PostgreSQL integration test for defaults**

Create the test harness with the same `KUFAR_POSTGRES_INTEGRATION` gate used by existing integration tests and insert an ordinary listing without specifying the new fields:

```ts
it('defaults a search-created listing to active with no full description cache', async () => {
  await prisma.listing.create({
    data: {
      listId: `${LISTING_PREFIX}defaults`,
      title: 'Defaults listing',
      priceKind: 'fixed',
      priceAmount: '10.00',
      currency: 'BYN',
      url: 'https://fixtures.invalid/defaults',
      region: 'minsk',
      accountId: 'account-defaults',
      isCompany: false,
      listTime: new Date('2026-09-09T00:00:00.000Z'),
      description: 'short body',
      raw: { fixture: 'defaults' },
    },
  })

  const row = await prisma.listing.findUniqueOrThrow({
    where: { listId: `${LISTING_PREFIX}defaults` },
  })

  expect(row.availability).toBe('active')
  expect(row.descriptionLoaded).toBe(false)
})
```

- [ ] **Step 2: Run the narrow test and verify RED**

Run:

```bash
KUFAR_POSTGRES_INTEGRATION=1 npx vitest run tests/integration/listing-description-cache.test.ts
```

Expected: FAIL before the schema/migration exists because `availability` / `descriptionLoaded` are not available in the generated Prisma model or database.

- [ ] **Step 3: Add the Prisma enum and fields**

Add:

```prisma
enum ListingAvailability {
  active
  gone
}
```

and in `model Listing`:

```prisma
availability      ListingAvailability @default(active)
descriptionLoaded Boolean             @default(false)
```

Do not add these fields to `shared/listing.ts`; that interface represents normalized source data rather than durable cache metadata.

- [ ] **Step 4: Add the additive SQL migration**

Create:

```sql
CREATE TYPE "ListingAvailability" AS ENUM ('active', 'gone');

ALTER TABLE "Listing"
ADD COLUMN "availability" "ListingAvailability" NOT NULL DEFAULT 'active',
ADD COLUMN "descriptionLoaded" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 5: Regenerate Prisma client and verify GREEN**

Run:

```bash
npm run prisma:generate
KUFAR_POSTGRES_INTEGRATION=1 npx vitest run tests/integration/listing-description-cache.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit schema, migration and default test**

```bash
git add prisma/schema.prisma prisma/migrations/20260909013000_listing_description_cache/migration.sql tests/integration/listing-description-cache.test.ts
git commit -m "feat: add listing description cache state"
```

---

### Task 2: Preserve HTTP failure response bodies

**Files:**
- Modify: `tests/unit/kufar-http-client.test.ts`
- Modify: `electron/worker/kufar-http-client.ts`

**Interfaces:**
- Existing `KufarHttpResult` remains a discriminated union on `ok`.
- HTTP-originated failure variants expose `body: Uint8Array`.
- Network and timeout variants remain body-less.
- Retry, rate-limit and error classification semantics stay unchanged.

- [ ] **Step 1: Add failing assertions for 4xx, final 5xx, 429 and unexpected HTTP**

Use distinct raw bodies and assert that each returned failure preserves the same bytes. For example:

```ts
it('preserves a permanent 4xx response body', async () => {
  const rawBody = new TextEncoder().encode('{"error":{"code":"ASR0006"}}')
  const { limiter } = createLimiter()
  const { transport } = createTransport(response({ status: 404, body: rawBody }))
  const client = new KufarHttpClient({ limiter, transport })

  const result = await client.get(TEST_URL)

  expect(result).toMatchObject({ ok: false, status: 404, code: 'http-4xx' })
  if (result.ok) throw new Error('Expected HTTP failure')
  expect('body' in result && result.body).toEqual(rawBody)
})
```

Add equivalent checks to the final-5xx, 429 and redirect/unexpected cases.

- [ ] **Step 2: Run the HTTP-client unit test and verify RED**

```bash
npx vitest run tests/unit/kufar-http-client.test.ts
```

Expected: FAIL because HTTP failure variants do not yet expose `body`.

- [ ] **Step 3: Extend only HTTP-originated failure variants**

Refactor `KufarHttpResult` so the failures returned after receiving an HTTP response carry:

```ts
body: Uint8Array
```

Populate `body: response.body` in the 429, exhausted 5xx, non-429 4xx and unexpected-status returns. Do not add a fake body to network/timeout returns.

- [ ] **Step 4: Run the unit test and verify GREEN**

```bash
npx vitest run tests/unit/kufar-http-client.test.ts
```

Expected: PASS with existing retry/rate-limit assertions unchanged.

- [ ] **Step 5: Commit the transport regression**

```bash
git add electron/worker/kufar-http-client.ts tests/unit/kufar-http-client.test.ts
git commit -m "feat: retain kufar http failure bodies"
```

---

### Task 3: Parse full detail responses and strict removed responses

**Files:**
- Create: `electron/worker/kufar-listing-detail.ts`
- Create: `tests/unit/kufar-listing-detail.test.ts`
- Reuse fixtures: `tests/fixtures/kufar/2026-09-07-electronics-negotiable-detail.json`
- Reuse fixtures: `tests/fixtures/kufar/2026-09-07-realestate-item-1079260955-detail.json`
- Reuse fixtures: `tests/fixtures/kufar/2026-09-07-electronics-detail-not-found.json`

**Interfaces:**
- Produces `KufarDetailNormalizationError`.
- Produces `parseKufarFullDescription(body: Uint8Array, expectedListId: string): string`.
- Produces `isConfirmedKufarGone(result: Extract<KufarHttpResult, { ok: false }>): boolean`.
- Service task consumes both functions.

- [ ] **Step 1: Write fixture-backed failing parser tests**

Cover both successful verticals and preserve the full body exactly:

```ts
it('parses the full electronics description', () => {
  const body = fixture('2026-09-07-electronics-negotiable-detail.json')
  const description = parseKufarFullDescription(body, '1082715190')
  expect(description).toContain('NHL 27')
})

it('parses the full real-estate description', () => {
  const body = fixture('2026-09-07-realestate-item-1079260955-detail.json')
  const description = parseKufarFullDescription(body, '1079260955')
  expect(description).toContain('Продается двухкомнатная квартира')
})
```

Add cases for invalid JSON, missing `result`, non-string `result.body`, mismatched `ad_id`, mismatched `list_id`, strict `404 + ASR0006`, another 404 code, malformed 404 JSON, and `error.http.code` present but not 404.

- [ ] **Step 2: Run the parser test and verify RED**

```bash
npx vitest run tests/unit/kufar-listing-detail.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal parser module**

Use local record/type guards. `parseKufarFullDescription` must:

```ts
export function parseKufarFullDescription(body: Uint8Array, expectedListId: string): string
```

- decode JSON with `TextDecoder`;
- require root object and `result` object;
- require `result.body` to be a string, including allowing `''`;
- when `ad_id` or `list_id` exists, accept a safe integer or string representation only when `String(value) === expectedListId`;
- return the body unchanged.

`isConfirmedKufarGone` returns `true` only when all approved conditions hold; it returns `false` rather than throwing for malformed/non-matching failure payloads.

- [ ] **Step 4: Run the parser test and verify GREEN**

```bash
npx vitest run tests/unit/kufar-listing-detail.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit parser and tests**

```bash
git add electron/worker/kufar-listing-detail.ts tests/unit/kufar-listing-detail.test.ts
git commit -m "feat: parse kufar listing detail responses"
```

---

### Task 4: Make search persistence preserve the full-description cache

**Files:**
- Modify: `electron/worker/monitor-run-persistence.ts`
- Modify: `tests/integration/listing-description-cache.test.ts`

**Interfaces:**
- Existing `persistListings(tx, listings)` signature stays unchanged.
- Create path stores search `description` with `descriptionLoaded = false` and `availability = active`.
- Update path does not touch `description` or `descriptionLoaded`; it sets `availability = active`.

- [ ] **Step 1: Add a failing cache-preservation integration test**

Seed a row as already detail-loaded, run `persistListings` with a fresh search listing containing a different short description, then assert:

```ts
expect(row.title).toBe('Fresh search title')
expect(row.description).toBe('FULL DETAIL TEXT')
expect(row.descriptionLoaded).toBe(true)
expect(row.availability).toBe('active')
```

Also seed `availability = gone` and verify a later live search upsert returns the row to `active` without changing the full-description fields.

- [ ] **Step 2: Run the integration test and verify RED**

```bash
KUFAR_POSTGRES_INTEGRATION=1 npx vitest run tests/integration/listing-description-cache.test.ts
```

Expected: FAIL because current `listingUpdateData()` overwrites `description` and does not reactivate a gone row.

- [ ] **Step 3: Change create/update data deliberately**

In `listingCreateData()` add explicit durable defaults for clarity:

```ts
availability: 'active',
descriptionLoaded: false,
```

In `listingUpdateData()`:

- remove `description: listing.description`;
- add `availability: 'active'`;
- do not include `descriptionLoaded`.

Keep all other search-derived field updates unchanged.

- [ ] **Step 4: Run persistence integration tests and verify GREEN**

```bash
KUFAR_POSTGRES_INTEGRATION=1 npx vitest run tests/integration/listing-description-cache.test.ts tests/integration/monitor-run-persistence.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the search-persistence regression fix**

```bash
git add electron/worker/monitor-run-persistence.ts tests/integration/listing-description-cache.test.ts
git commit -m "fix: preserve cached listing descriptions"
```

---

### Task 5: Add a narrow Prisma description repository

**Files:**
- Create: `electron/worker/listing-description-repository.ts`
- Create: `tests/unit/listing-description-repository.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ListingDescriptionCache {
  availability: 'active' | 'gone'
  description: string | null
  descriptionLoaded: boolean
}

export interface ListingDescriptionRepository {
  find(listId: string): Promise<ListingDescriptionCache | null>
  saveLoaded(listing: Listing, description: string): Promise<void>
  saveGone(listing: Listing): Promise<void>
}

export class PrismaListingDescriptionRepository implements ListingDescriptionRepository {
  constructor(prisma: PrismaClient)
}
```

- `saveLoaded` updates only detail cache fields for an existing row, or creates a missing row from the supplied normalized listing with full description state.
- `saveGone` updates only removal/cache fields for an existing row, or creates a missing row from the supplied normalized listing with gone state.

- [ ] **Step 1: Write failing repository call-shape tests**

Mock only the `listing.findUnique`, `listing.upsert`/`listing.update` operations needed by the repository. Assert that existing-row detail writes never rewrite title/price/raw and that create data is derived from the supplied source listing.

Key loaded assertion:

```ts
expect(update).toEqual({
  description: 'full detail',
  descriptionLoaded: true,
  availability: 'active',
})
```

Key gone assertion:

```ts
expect(update).toEqual({
  descriptionLoaded: false,
  availability: 'gone',
})
```

The gone update must not erase `description`; it only makes that value non-authoritative by setting `descriptionLoaded = false`.

- [ ] **Step 2: Run the repository test and verify RED**

```bash
npx vitest run tests/unit/listing-description-repository.test.ts
```

Expected: FAIL because the repository module does not exist.

- [ ] **Step 3: Implement the repository**

Use `prisma.listing.findUnique` for cache reads and `prisma.listing.upsert` for writes. Factor a private create-data helper that maps the normalized `Listing` fields using the same Prisma JSON/Date conventions as `monitor-run-persistence.ts`.

`saveLoaded` create overrides:

```ts
description,
descriptionLoaded: true,
availability: 'active',
```

`saveGone` create overrides:

```ts
description: listing.description,
descriptionLoaded: false,
availability: 'gone',
```

- [ ] **Step 4: Run the repository test and verify GREEN**

```bash
npx vitest run tests/unit/listing-description-repository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit repository and unit tests**

```bash
git add electron/worker/listing-description-repository.ts tests/unit/listing-description-repository.test.ts
git commit -m "feat: add listing description repository"
```

---

### Task 6: Implement the cache-first description service and single-flight

**Files:**
- Create: `electron/worker/kufar-listing-description-service.ts`
- Create: `tests/unit/kufar-listing-description-service.test.ts`

**Interfaces:**
- Consumes `ListingDescriptionRepository`, `KufarHttpClient.get`, `parseKufarFullDescription`, and `isConfirmedKufarGone`.
- Produces:

```ts
export type ListingDescriptionResult =
  | { kind: 'loaded'; description: string }
  | { kind: 'gone' }

export class KufarDetailRequestError extends Error {
  constructor(readonly result: Extract<KufarHttpResult, { ok: false }>)
}

export class KufarListingDescriptionService {
  constructor(
    repository: ListingDescriptionRepository,
    httpClient: Pick<KufarHttpClient, 'get'>,
  )

  getOrFetchFullDescription(listing: Listing): Promise<ListingDescriptionResult>
}
```

- [ ] **Step 1: Write failing service tests for cache and successful fetch**

Cases:

```ts
it('returns a durable full-description cache hit without HTTP')
it('fetches a cache miss and saves the full description')
it('uses the exact shared detail endpoint with lang=ru')
```

For the cache hit, repository returns `descriptionLoaded: true` and a string; assert `httpClient.get` is never called.

- [ ] **Step 2: Add failing service tests for gone and failures**

Cases:

```ts
it('returns gone and persists gone for strict 404 ASR0006')
it('throws KufarDetailRequestError for another HTTP failure without saving')
it('propagates detail normalization failure without saving')
```

For strict gone, return a failure object containing the dated 404 fixture bytes and assert no exception.

- [ ] **Step 3: Add failing single-flight tests**

Use a deferred Promise from the fake HTTP client. Start two calls for the same uncached `listId`, release the deferred response, then assert:

```ts
expect(get).toHaveBeenCalledTimes(1)
expect(await first).toEqual(await second)
```

Add a second test where the first in-flight request rejects/returns a transient failure; after it settles, make another call and assert `get` is called a second time. This proves the map entry is removed in `finally` on both success and failure.

- [ ] **Step 4: Run the service test and verify RED**

```bash
npx vitest run tests/unit/kufar-listing-description-service.test.ts
```

Expected: FAIL because the service module does not exist.

- [ ] **Step 5: Implement cache-first orchestration**

The public method must single-flight the whole cache-check/fetch operation by `listId`:

```ts
getOrFetchFullDescription(listing: Listing): Promise<ListingDescriptionResult> {
  const existing = this.inFlight.get(listing.listId)
  if (existing) return existing

  const pending = this.load(listing).finally(() => {
    this.inFlight.delete(listing.listId)
  })
  this.inFlight.set(listing.listId, pending)
  return pending
}
```

Inside `load`:

1. `repository.find(listing.listId)`.
2. If `descriptionLoaded === true`, require `description !== null` and return it without HTTP.
3. Build `new URL(`https://api.kufar.by/search-api/v2/item/${encodeURIComponent(listing.listId)}/rendered`)`, then set `lang=ru`.
4. Call `httpClient.get(url)`.
5. On success parse, `saveLoaded`, return `loaded`.
6. On strict gone, `saveGone`, return `gone`.
7. Otherwise throw `KufarDetailRequestError` without saving.

Do not special-case cached `availability = gone` as a permanent cache hit: the service accepts a current live listing and the approved design allows a later detail check to observe a reappearing ID.

- [ ] **Step 6: Run parser, HTTP and service unit tests and verify GREEN**

```bash
npx vitest run tests/unit/kufar-http-client.test.ts tests/unit/kufar-listing-detail.test.ts tests/unit/listing-description-repository.test.ts tests/unit/kufar-listing-description-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the service**

```bash
git add electron/worker/kufar-listing-description-service.ts tests/unit/kufar-listing-description-service.test.ts
git commit -m "feat: cache kufar full descriptions"
```

---

### Task 7: Prove durable behavior against PostgreSQL and monitor persistence

**Files:**
- Modify: `tests/integration/listing-description-cache.test.ts`
- Modify only if a discovered defect requires it: `electron/worker/listing-description-repository.ts`
- Modify only if a discovered defect requires it: `electron/worker/monitor-run-persistence.ts`

**Interfaces:**
- No new public API. This task verifies the previous units compose correctly with the real Prisma/PostgreSQL model.

- [ ] **Step 1: Add a failing integration test for full-detail durability**

Test sequence:

1. persist a live search listing;
2. use `PrismaListingDescriptionRepository.saveLoaded()` to store `FULL DETAIL TEXT`;
3. call normal `persistListings()` again with the same ID and a changed `body_short`;
4. query the row and assert the full text and `descriptionLoaded = true` survive.

- [ ] **Step 2: Add a failing integration test for gone and reappearance**

Test sequence:

1. persist a live listing;
2. `saveGone()`;
3. assert `availability = gone`, `descriptionLoaded = false`;
4. call normal `persistListings()` with the same live listing;
5. assert `availability = active` while `descriptionLoaded` remains false.

- [ ] **Step 3: Add an integration test for detail-before-monitor persistence**

Start with no row, call `saveLoaded()` using a normalized live `Listing`, then run normal search persistence for that listing. Assert the row exists exactly once and keeps the full detail cache. This covers the service's approved ability to fetch before the monitor transaction persists the candidate.

- [ ] **Step 4: Run integration tests and verify behavior**

```bash
KUFAR_POSTGRES_INTEGRATION=1 npx vitest run tests/integration/listing-description-cache.test.ts tests/integration/monitor-run-persistence.test.ts
```

Expected: PASS. If any test fails, fix only the production unit whose contract is violated and rerun the same narrow command.

- [ ] **Step 5: Commit integration coverage**

```bash
git add tests/integration/listing-description-cache.test.ts electron/worker/listing-description-repository.ts electron/worker/monitor-run-persistence.ts
git commit -m "test: verify durable listing description cache"
```

If neither production file changed in this task, commit only the test file.

---

### Task 8: Complete task documentation and full verification

**Files:**
- Modify: `docs/tasks/1-5-1-description-fetch.md`
- Modify generated documentation only when changed by `npm run docs:ops:refresh` and consistent with the repository docs workflow.

**Interfaces:**
- No production API changes. This task closes acceptance only after all implementation checks are green.

- [ ] **Step 1: Run the full local verification sequence before marking the task done**

```bash
npm run prisma:generate
npm test
npm run typecheck
npm run lint
npm run format:check
KUFAR_POSTGRES_INTEGRATION=1 npx vitest run tests/integration/listing-description-cache.test.ts tests/integration/monitor-run-persistence.test.ts
npm run build
npm run docs:ops:check
```

Expected: every command PASS.

- [ ] **Step 2: Mark task `1.5.1` complete only after GREEN**

Change frontmatter to:

```yaml
status: done
sync_state: aligned
last_reviewed: 2026-09-09
```

Change the task summary marker to `✅ done`, and check all three acceptance boxes:

```markdown
- [x] Описание загружается и сохраняется
- [x] Повторный обход не выполняет второй запрос за тем же описанием
- [x] Удалённое объявление не роняет обход
```

Add a concise implementation note naming the detail service, `descriptionLoaded`, strict `404 + ASR0006`, and the fact that automatic invocation remains deferred to `1.5.2`.

- [ ] **Step 3: Refresh and validate docs metadata**

```bash
npm run docs:ops:refresh
npm run docs:ops:check
```

Inspect the diff. Keep only deterministic docs-ops changes that reflect the now-completed task and its rollups; do not mix unrelated editorial rewrites into this commit.

- [ ] **Step 4: Re-run the complete verification after docs changes**

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
bash scripts/verify-postgres-compose.sh
npm run build
npm run docs:ops:check
```

Expected: PASS and equivalent to the substantive GitHub Actions `verify` gates.

- [ ] **Step 5: Commit task completion**

```bash
git add docs/tasks/1-5-1-description-fetch.md docs/
git commit -m "docs: complete description fetch task"
```

Before committing, ensure `git diff --cached --name-only` contains only intended documentation files.

- [ ] **Step 6: Push branch and verify GitHub Actions**

Push `feat/1-5-1-description-fetch`. The workflow must pass these repository gates: documentation consistency, unit tests, CI failure-mode self-check, typecheck, lint, formatting, Postgres compose integration, build, development smoke and production smoke.

- [ ] **Step 7: Request code review before PR completion**

Invoke `superpowers:requesting-code-review`, review the complete branch diff against this plan and the approved spec, address findings with focused TDD cycles, then rerun the full verification suite.

- [ ] **Step 8: Open the pull request only after review and GREEN CI**

Use a PR title such as:

```text
feat: cache full listing descriptions
```

The PR body must summarize data-model changes, strict removed-listing semantics, cache preservation, tests, and explicitly state that `1.5.2` will wire the fetch policy into the monitor flow. Do not merge without explicit user authorization.
