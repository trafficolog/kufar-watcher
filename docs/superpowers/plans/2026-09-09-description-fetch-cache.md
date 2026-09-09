# Description Fetch and Persistent Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable worker-side primitive that fetches a Kufar listing's full description through the existing HTTP client, persists the completed result or confirmed unavailability, and guarantees that later requests reuse the persistent cache instead of repeating the network call.

**Architecture:** Extend `Listing` with explicit availability and a separate description-load sentinel, expose HTTP bodies on status-based failures, parse the detail contract in a focused module, centralize search-side Listing mapping so generic upserts cannot overwrite cache-owned fields, and implement a persistent `ListingDescriptionCache` with process-local in-flight coalescing. The cache remains independent of monitor cursor/Match transactions and is not wired into matching policy until task `1.5.2`.

**Tech Stack:** TypeScript 6 strict, Vitest 5, Prisma 7.10.0, PostgreSQL 16, Undici 7.29.1, Node.js 22, npm 11.4.2.

**Spec:** `docs/superpowers/specs/2026-09-09-description-fetch-cache-design.md`

## Global Constraints

- Follow TDD for every production behavior change: write the focused failing test first, verify RED for the intended reason, implement the minimum production change, then verify GREEN.
- All detail HTTP requests go through the existing `KufarHttpClient`; do not bypass its limiter, retries, timeout handling, cooldown, or raw-journal policy.
- A listing is confirmed unavailable only for HTTP `404` whose parsed body has `error.code === 'ASR0006'`.
- `descriptionLoadedAt`, not `description`, is the successful-description cache sentinel. A cached `null` description is a valid completed fetch.
- `availability = unavailable` is independently cacheable and must skip future detail network requests.
- Generic search persistence may initialize `description` from `body_short` on create, but must never overwrite `description`, `descriptionLoadedAt`, or `availability` when updating an existing Listing.
- Detail payload fields other than `result.body` are not authoritative for task `1.5.1`; never overwrite seller identity, title, price, region, URL, list time, or other search-derived fields from detail data.
- A valid description-cache write is independent of monitor cursor, Match, Run-success, Telegram, and renderer transactions. Do not hold a database transaction or row lock while awaiting Kufar.
- Coalesce concurrent requests only inside the current worker process. Cross-process/distributed locking is intentionally out of scope.
- Do not wire the cache into `runIncrementalMonitor` or implement `searchInDescription` policy in this task; that belongs to `1.5.2`.
- Do not add images, category-specific attributes, or sold-vs-removed inference.

---

### Task 1: Add explicit description-cache state to the Prisma schema

**Files:**
- Create: `tests/prisma-description-cache-schema.test.ts`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260909060000_listing_description_cache/migration.sql`

**Target schema:**

```prisma
enum ListingAvailability {
  unknown
  available
  unavailable
}

model Listing {
  // existing fields stay unchanged
  description         String?
  availability        ListingAvailability @default(unknown)
  descriptionLoadedAt DateTime?
  // existing fields stay unchanged
}
```

**Migration SQL:**

```sql
-- CreateEnum
CREATE TYPE "ListingAvailability" AS ENUM ('unknown', 'available', 'unavailable');

-- AlterTable
ALTER TABLE "Listing"
ADD COLUMN "availability" "ListingAvailability" NOT NULL DEFAULT 'unknown',
ADD COLUMN "descriptionLoadedAt" TIMESTAMP(3);
```

- [ ] Create `tests/prisma-description-cache-schema.test.ts` following the existing source-level Prisma contract-test style. Assert that `ListingAvailability` has exactly `unknown`, `available`, and `unavailable`, that `Listing.availability` defaults to `unknown`, and that `Listing.descriptionLoadedAt` is nullable.
- [ ] Add a source-level assertion that the new migration creates the enum and adds both columns with the expected default/nullability. This catches schema/migration drift before Postgres integration.
- [ ] Run `npx vitest run tests/prisma-description-cache-schema.test.ts` and verify RED because the enum/fields/migration do not exist yet.
- [ ] Modify `prisma/schema.prisma` with the enum and fields above. Keep the change additive; do not alter unrelated models or indexes.
- [ ] Create `prisma/migrations/20260909060000_listing_description_cache/migration.sql` with the additive PostgreSQL migration above.
- [ ] Run `npm run prisma:generate` so generated types expose `ListingAvailability`, `availability`, and `descriptionLoadedAt`.
- [ ] Run `npx vitest run tests/prisma-description-cache-schema.test.ts tests/prisma-schema-constraints.test.ts` and verify GREEN.
- [ ] Run `npm run typecheck:electron` and fix only schema-generated fallout attributable to this task.
- [ ] Commit this TDD increment as `feat: add listing description cache schema`.

### Task 2: Preserve response bodies on HTTP status failures

**Files:**
- Modify: `tests/unit/kufar-http-client.test.ts`
- Modify: `electron/worker/kufar-http-client.ts`

**Required type change:**

```ts
export type KufarHttpResult =
  | {
      ok: true
      status: number
      body: Uint8Array
      headers: KufarHeaders
      attempts: number
    }
  | {
      ok: false
      kind: 'temporary' | 'permanent' | 'rate-limited'
      code: 'network' | 'timeout' | 'http-4xx' | 'http-5xx' | 'unexpected-http' | 'rate-limited'
      status: number | null
      attempts: number
      message: string
      body?: Uint8Array
      retryAfterMs?: number
    }
```

- [ ] Extend `tests/unit/kufar-http-client.test.ts` first. In the existing non-429 4xx test, provide a distinctive body and assert `result.body` is the exact `Uint8Array` returned by the transport.
- [ ] Add focused assertions for terminal 5xx and 429/status-based failures so the contract is explicit: HTTP responses preserve body; network/timeout failures still have no body.
- [ ] Run `npx vitest run tests/unit/kufar-http-client.test.ts` and verify RED because failure results currently discard the body.
- [ ] Add optional `body?: Uint8Array` to the failure branch of `KufarHttpResult`.
- [ ] Populate `body: response.body` on the 429, terminal 5xx, 4xx, and unexpected-status return branches. Do not add a body to transport/network/timeout failures because no HTTP response exists.
- [ ] Do not change retry counts, exponential delays, classification, cooldown, limiter scheduling, or raw-journal behavior.
- [ ] Run `npx vitest run tests/unit/kufar-http-client.test.ts` and verify GREEN.
- [ ] Run `npm run typecheck:electron` to catch any exhaustive-result typing regressions.
- [ ] Commit as `feat: preserve Kufar HTTP failure bodies`.

### Task 3: Parse the listing-detail contract strictly and narrowly

**Files:**
- Create: `tests/unit/kufar-listing-detail.test.ts`
- Create: `electron/worker/kufar-listing-detail.ts`
- Reuse fixtures: `tests/fixtures/kufar/2026-09-07-electronics-negotiable-detail.json`
- Reuse fixtures: `tests/fixtures/kufar/2026-09-07-electronics-detail-not-found.json`

**Target interface:**

```ts
export class KufarListingDetailParseError extends Error {}

export function parseKufarListingDescription(body: Uint8Array): string | null

export function hasKufarListingNotFoundCode(body: Uint8Array): boolean
```

**Parsing semantics:**

```ts
// Success path:
// - UTF-8 decode
// - JSON.parse
// - require object payload.result
// - require result.body to be present
// - accept only string | null
// - return only result.body

// Confirmed-unavailable predicate:
// - safely decode/parse
// - return true only when payload.error.code === 'ASR0006'
// - return false for malformed JSON or every other shape/code
```

- [ ] Write failing tests using the captured active-detail fixture to prove the full `result.body` is returned and unrelated fields are ignored.
- [ ] Add a successful synthetic `{ result: { body: null } }` case to prove `null` is valid and does not mean “not loaded”.
- [ ] Add malformed-success cases: invalid JSON, missing `result`, missing `result.body`, and non-string/non-null body. Each must throw `KufarListingDetailParseError`.
- [ ] Use the captured not-found fixture to prove `hasKufarListingNotFoundCode(...)` returns true only for `ASR0006`; add unrelated-code and malformed-body cases returning false.
- [ ] Run `npx vitest run tests/unit/kufar-listing-detail.test.ts` and verify RED because the parser module does not exist.
- [ ] Implement `electron/worker/kufar-listing-detail.ts` with small JSON/object guards. Keep it independent of Prisma and HTTP orchestration.
- [ ] Run `npx vitest run tests/unit/kufar-listing-detail.test.ts` and verify GREEN.
- [ ] Run `npm run typecheck:electron`.
- [ ] Commit as `feat: parse Kufar listing detail responses`.

### Task 4: Make Listing persistence ownership explicit

**Files:**
- Create: `tests/unit/listing-persistence-data.test.ts`
- Create: `electron/worker/listing-persistence-data.ts`
- Modify: `electron/worker/monitor-run-persistence.ts`
- Verify existing: `tests/unit/cold-start-persistence.test.ts`
- Verify existing: `tests/integration/monitor-run-persistence.test.ts`

**Target helpers:**

```ts
export function listingCreateData(listing: Listing): Prisma.ListingCreateInput {
  return {
    listId: listing.listId,
    title: listing.title,
    priceKind: listing.priceKind,
    priceAmount: listing.priceAmount,
    currency: listing.currency,
    url: listing.url,
    region: listing.region,
    accountId: listing.accountId,
    isCompany: listing.isCompany,
    listTime: new Date(listing.listTime),
    description: listing.description,
    raw: listing.raw === null ? Prisma.JsonNull : (listing.raw as Prisma.InputJsonValue),
  }
}

export function listingSearchUpdateData(listing: Listing): Prisma.ListingUpdateInput {
  return {
    title: listing.title,
    priceKind: listing.priceKind,
    priceAmount: listing.priceAmount,
    currency: listing.currency,
    url: listing.url,
    region: listing.region,
    accountId: listing.accountId,
    isCompany: listing.isCompany,
    listTime: new Date(listing.listTime),
    raw: listing.raw === null ? Prisma.JsonNull : (listing.raw as Prisma.InputJsonValue),
  }
}
```

- [ ] Write `tests/unit/listing-persistence-data.test.ts` first. Assert create data includes the search snippet `description`, while update data has no own `description`, `descriptionLoadedAt`, or `availability` property.
- [ ] Run `npx vitest run tests/unit/listing-persistence-data.test.ts` and verify RED because the focused mapping module does not exist.
- [ ] Move the existing create mapping from `monitor-run-persistence.ts` into `listing-persistence-data.ts` without semantic changes.
- [ ] Move/rename the search update mapping and deliberately omit all three cache-owned fields from updates.
- [ ] Modify `persistListings(...)` in `monitor-run-persistence.ts` to use `listingCreateData` and `listingSearchUpdateData`; keep Match/cursor/Run transaction behavior unchanged.
- [ ] Run `npx vitest run tests/unit/listing-persistence-data.test.ts tests/unit/cold-start-persistence.test.ts` and verify GREEN.
- [ ] Run `npm run typecheck:electron`.
- [ ] Do not add cache policy or detail networking to `monitor-run-persistence.ts`.
- [ ] Commit as `refactor: preserve description cache on search upsert`.

### Task 5: Implement the persistent description-cache service

**Files:**
- Create: `tests/unit/listing-description-cache.test.ts`
- Create: `electron/worker/listing-description-cache.ts`
- Reuse: `electron/worker/listing-persistence-data.ts`
- Reuse: `electron/worker/kufar-listing-detail.ts`
- Reuse: `electron/worker/kufar-source-request-error.ts`
- Reuse: `electron/worker/kufar-http-client.ts`

**Public result:**

```ts
export type ListingDescriptionResult =
  | {
      kind: 'available'
      description: string | null
      source: 'cache' | 'network'
    }
  | {
      kind: 'unavailable'
      source: 'cache' | 'network'
    }
```

**Service outline:**

```ts
export class ListingDescriptionCache {
  private readonly inFlight = new Map<string, Promise<ListingDescriptionResult>>()

  constructor(
    private readonly prisma: PrismaClient,
    private readonly httpClient: Pick<KufarHttpClient, 'get'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureDescription(listing: Listing): Promise<ListingDescriptionResult> {
    const pending = this.inFlight.get(listing.listId)
    if (pending) return pending

    const operation = this.ensureDescriptionOnce(listing)
    this.inFlight.set(listing.listId, operation)

    try {
      return await operation
    } finally {
      if (this.inFlight.get(listing.listId) === operation) {
        this.inFlight.delete(listing.listId)
      }
    }
  }
}
```

**Cache lookup:**

```ts
const cached = await this.prisma.listing.findUnique({
  where: { listId: listing.listId },
  select: {
    availability: true,
    description: true,
    descriptionLoadedAt: true,
  },
})

if (cached?.availability === 'unavailable') {
  return { kind: 'unavailable', source: 'cache' }
}

if (cached?.descriptionLoadedAt != null) {
  return {
    kind: 'available',
    description: cached.description,
    source: 'cache',
  }
}
```

**Network URL:**

```ts
const detailUrl = new URL(
  `https://api.kufar.by/search-api/v2/item/${encodeURIComponent(listing.listId)}/rendered?lang=ru`,
)
```

**Persistence rules:**

```ts
// Successful detail:
await this.prisma.listing.upsert({
  where: { listId: listing.listId },
  create: {
    ...listingCreateData(listing),
    description,
    descriptionLoadedAt: loadedAt,
    availability: 'available',
  },
  update: {
    description,
    descriptionLoadedAt: loadedAt,
    availability: 'available',
  },
})

// Exact 404 + ASR0006:
await this.prisma.listing.upsert({
  where: { listId: listing.listId },
  create: {
    ...listingCreateData(listing),
    availability: 'unavailable',
  },
  update: {
    availability: 'unavailable',
    descriptionLoadedAt: null,
  },
})
```

- [ ] Create `tests/unit/listing-description-cache.test.ts` with a small fake Prisma object (`listing.findUnique`, `listing.upsert`) cast to `PrismaClient`, a mocked `get`, and a deterministic `now`.
- [ ] First RED cases: `availability=unavailable` returns unavailable/cache with zero HTTP; non-null `descriptionLoadedAt` returns available/cache with zero HTTP even when cached `description` is `null`.
- [ ] Add first-fetch RED case: cache miss calls the exact rendered-detail URL, parses the successful body, writes only cache-owned fields on update, and returns available/network.
- [ ] Add exact-not-found RED case: failure `{ status: 404, code: 'http-4xx', body: ASR0006 fixture }` persists `availability='unavailable'`, keeps `descriptionLoadedAt=null`, returns unavailable/network, and does not throw.
- [ ] Add unrelated-404, 429, 5xx, network/timeout, and malformed-success RED cases. They must reject without calling `listing.upsert`, so the cache remains retryable.
- [ ] Add concurrency RED case using a deferred HTTP promise: two simultaneous `ensureDescription` calls for the same `listId` must share one HTTP call and both resolve from the same operation.
- [ ] Add failure-cleanup RED case: after a shared request rejects, a later call for the same `listId` performs HTTP again, proving the in-flight entry is removed in `finally`.
- [ ] Run `npx vitest run tests/unit/listing-description-cache.test.ts` and verify RED for missing service behavior.
- [ ] Implement `ListingDescriptionCache` minimally using the approved cache lookup, exact detail URL, parser helpers, and `KufarSourceRequestError` for every non-ASR HTTP failure.
- [ ] On success, parse before writing; malformed payloads must leave persistent cache state untouched.
- [ ] On exact `404 + ASR0006`, do not synthesize a full description and do not mark `descriptionLoadedAt`; `availability` alone is the unavailable cache sentinel.
- [ ] Keep the in-flight map process-local and do not wrap the network call in `prisma.$transaction`.
- [ ] Run `npx vitest run tests/unit/listing-description-cache.test.ts tests/unit/kufar-listing-detail.test.ts tests/unit/kufar-http-client.test.ts` and verify GREEN.
- [ ] Run `npm run typecheck:electron`.
- [ ] Commit as `feat: cache full listing descriptions`.

### Task 6: Prove persistence and cache ownership with PostgreSQL integration

**Files:**
- Create: `tests/integration/listing-description-cache.test.ts`
- Modify: `scripts/verify-postgres-compose.sh`
- Verify: `tests/integration/monitor-run-persistence.test.ts`

**Integration setup pattern:**

```ts
const integrationDescribe =
  process.env.KUFAR_POSTGRES_INTEGRATION === '1' ? describe : describe.skip

let prisma: ReturnType<typeof createPrismaClient>

beforeAll(async () => {
  prisma = createPrismaClient()
  await prisma.$connect()
})

afterAll(async () => {
  await prisma.$disconnect()
})
```

- [ ] Create `tests/integration/listing-description-cache.test.ts` first and add a test that a first service instance persists a network-fetched full description, `availability='available'`, and deterministic `descriptionLoadedAt`.
- [ ] In the same test, construct a second `ListingDescriptionCache` instance with an HTTP mock that would fail if called; prove it returns the persisted description from DB and performs no HTTP request.
- [ ] Add a persisted `null` description case: second service instance must still hit DB cache because `descriptionLoadedAt` is non-null.
- [ ] Add persisted unavailable case: first exact `404 + ASR0006` writes `availability='unavailable'`; a second service instance returns unavailable/cache with no network request.
- [ ] Add search-upsert preservation case: after full detail is cached, call existing `persistListings(...)` inside a Prisma transaction with a newer search listing whose `description` is a different short snippet or `null`. Assert the full cached description, `descriptionLoadedAt`, and `availability` remain unchanged while ordinary search-owned fields such as title/raw may update.
- [ ] Add a failure case proving unrelated 404/malformed response leaves the row uncached (`availability` remains `unknown`, `descriptionLoadedAt` remains null) so a later call can retry.
- [ ] Before production fixes for this task are complete, run the focused integration file with the normal test DB bootstrap and verify RED for the intended missing persistence behavior.
- [ ] Modify `scripts/verify-postgres-compose.sh` to run `KUFAR_POSTGRES_INTEGRATION=1 npx vitest run tests/integration/listing-description-cache.test.ts` alongside the existing integration files.
- [ ] Update both `migration_count` and `reset_migration_count` expectations from `2` to `3` because this task adds the third migration.
- [ ] Run `bash scripts/verify-postgres-compose.sh` and verify GREEN. This command starts a clean Postgres, applies all migrations, seeds it, runs integration tests, validates schema/constraints, tests persistence/reset, and tears down through the existing trap.
- [ ] Run `npx vitest run tests/unit/listing-description-cache.test.ts tests/unit/listing-persistence-data.test.ts` and `npm run typecheck:electron` once more after integration-driven fixes.
- [ ] Commit as `test: verify persistent description cache`.

### Task 7: Full verification, documentation alignment, and final branch evidence

**Files:**
- Modify after production verification is green: `docs/tasks/1-5-1-description-fetch.md`
- Refresh generated status files through `npm run docs:ops:refresh` if repository docs tooling changes them.

**Task-card completion content:**

- Set `status: done`.
- Set `sync_state: aligned`.
- Set `last_reviewed: 2026-09-09`.
- Check all three acceptance criteria.
- Add a concise Implementation section covering: full-detail parser, persistent `descriptionLoadedAt`/availability cache, exact `404 + ASR0006`, in-flight coalescing, independent cache write, and search-upsert preservation.
- Add a Verification section with focused unit, Postgres integration, typecheck/lint/format/build, and final GitHub Actions evidence.

- [ ] Before touching the task status, run `npm test` and verify all Vitest suites are green.
- [ ] Run `npm run typecheck` and verify renderer + Electron typechecks are green.
- [ ] Run `npm run lint` and `npm run format:check`.
- [ ] Run `bash scripts/verify-postgres-compose.sh` and verify the new migration/cache integration plus existing database contracts are green.
- [ ] Run `npm run build` and verify build completes successfully.
- [ ] Review the branch diff against the approved spec. Reject scope creep into `runIncrementalMonitor`, matching policy, scheduler, Telegram, renderer UI, images, attributes, or sold/removed classification.
- [ ] Push/commit the verified production state and require the feature-branch `verify` GitHub Actions workflow to be fully green before marking the roadmap card done.
- [ ] Update `docs/tasks/1-5-1-description-fetch.md` only after that production CI evidence exists.
- [ ] Run `npm run docs:ops:refresh && npm run docs:ops:check` and include any generated status-file changes required by the docs contract.
- [ ] Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `bash scripts/verify-postgres-compose.sh`, and `npm run build` again on the documentation-complete HEAD.
- [ ] Commit the documentation/status increment as `docs: mark 1.5.1 description cache done`.
- [ ] Require the final feature-branch GitHub Actions `verify` run to be fully green. Record its run/commit evidence in the task card if the repository convention supports it.
- [ ] Create a PR from `feat/1-5-1-description-fetch-cache` to `main` summarizing the cache primitive, migration, exact unavailable semantics, overwrite protection, and verification evidence. Do not merge without the normal human integration decision.
