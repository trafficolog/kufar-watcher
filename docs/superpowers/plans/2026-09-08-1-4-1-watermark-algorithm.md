# Watermark Traversal Algorithm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the pure multi-page watermark traversal that returns listings new relative to a previous temporal boundary, preserves idempotency across equal timestamps and disappearing records, and surfaces page-cap incompleteness without advancing the watermark.

**Architecture:** Add JSON-friendly watermark domain types under `shared/`, then implement one worker-side state machine over the existing `SourceAdapter`. The state machine validates configuration before I/O, compares timestamps by parsed epoch milliseconds, traverses opaque cursors, stops at the temporal boundary, and computes a monotonic next watermark. A later robustness increment adds global `listId` deduplication and chronological ordering validation so the RED→GREEN history stays meaningful instead of implementing future behavior before its tests.

**Tech Stack:** TypeScript 6.0.2, Node 22, Vitest 5.0.0, existing `CanonicalQuery`, `Listing`, and `SourceAdapter` contracts. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-08-1-4-1-watermark-algorithm-design.md`

## Global Constraints

- `previousWatermark` is mandatory; cold start remains in `1.4.3`.
- `maxPages` is caller-supplied, must be an integer `>= 1`, and is validated before any adapter call.
- `previousWatermark.boundaryTime` must parse to a finite timestamp before any adapter call.
- `Listing.listTime` ordering/equality is chronological by `Date.parse`, never lexicographic string comparison.
- Marketplace pagination cursors remain opaque and local to one traversal.
- Same-time IDs use deterministic first-appearance order; no stable source tie-breaker is assumed.
- Final behavior ignores repeated `listId` values after the first occurrence within one traversal.
- The first processed record older than the previous boundary terminates traversal immediately; after the dedup increment, “processed” means first unique occurrence only.
- A completed next watermark never moves backward in time.
- If the new maximum instant equals the previous boundary instant, retain previous boundary IDs and append newly observed boundary IDs deterministically.
- If page cap is exhausted while `nextCursor != null` before the old boundary is fully crossed, return `possibleMiss: true` and the previous watermark unchanged.
- Adapter errors propagate unchanged; traversal does not reinterpret HTTP/fallback/schema errors.
- Final behavior throws a typed ordering error when a newly processed unique listing is newer than the previous processed unique listing.
- No database, Prisma, `MonitorCursor`, `Run`, scheduler, config-file wiring, matcher, cold-start, notification, or user-facing reporting implementation.
- Every behavior change follows RED test-only commit → exact-SHA failing Actions evidence → minimum GREEN production commit → exact-SHA full GREEN evidence.

---

### Task 1: Domain types, validation, and single-page temporal classification

**Files:**
- Create: `tests/unit/watermark-traversal.test.ts`
- Create after RED: `shared/watermark.ts`
- Create after RED: `electron/worker/watermark-traversal.ts`

**Interfaces:**
- Consumes: `CanonicalQuery`, `Listing`, `SourceAdapter`.
- Produces:

```ts
// shared/watermark.ts
import type { Listing } from './listing'

export interface Watermark {
  boundaryTime: string
  boundaryIds: readonly string[]
}

export interface WatermarkTraversalResult {
  newListings: Listing[]
  nextWatermark: Watermark
  pagesRead: number
  possibleMiss: boolean
}
```

```ts
// electron/worker/watermark-traversal.ts
import type { CanonicalQuery } from '../../shared/canonical-query'
import type { SourceAdapter } from '../../shared/source-adapter'
import type { Watermark, WatermarkTraversalResult } from '../../shared/watermark'

export interface TraverseWatermarkInput {
  adapter: SourceAdapter
  query: CanonicalQuery
  previousWatermark: Watermark
  maxPages: number
}

export type WatermarkTraversalConfigField = 'maxPages' | 'previousWatermark.boundaryTime'

export class WatermarkTraversalConfigError extends Error {
  constructor(
    readonly field: WatermarkTraversalConfigField,
    readonly value: unknown,
  ) {
    super(`Invalid watermark traversal input: ${field}`)
    this.name = 'WatermarkTraversalConfigError'
  }
}

export async function traverseWatermark(
  input: TraverseWatermarkInput,
): Promise<WatermarkTraversalResult>
```

**Test helpers:**

```ts
import { describe, expect, it, vi } from 'vitest'
import type { CanonicalQuery } from '../../shared/canonical-query'
import type { Listing } from '../../shared/listing'
import type { SourceAdapter, SourcePage, SourcePageRequest } from '../../shared/source-adapter'
import type { Watermark } from '../../shared/watermark'
import {
  traverseWatermark,
  WatermarkTraversalConfigError,
} from '../../electron/worker/watermark-traversal'

const query: CanonicalQuery = {
  host: 'www.kufar.by',
  category: 'igry-i-pristavki',
  query: 'ps5',
  region: 'minsk',
  sellerType: null,
  sort: 'lst.d',
  operation: null,
  pathFilters: [],
  extraParams: {},
}

function listing(listId: string, listTime: string): Listing {
  return {
    listId,
    title: `Listing ${listId}`,
    priceKind: 'fixed',
    priceAmount: '100.00',
    currency: 'BYN',
    url: `https://www.kufar.by/item/${listId}`,
    region: 'Минск',
    accountId: null,
    isCompany: false,
    listTime,
    description: null,
    raw: { ad_id: listId },
  }
}

function adapterFromPages(pages: readonly SourcePage[]) {
  let index = 0
  const fetchPage = vi.fn(async (_request: SourcePageRequest): Promise<SourcePage> => {
    const page = pages[index]
    if (page === undefined) throw new Error(`Unexpected page request ${index + 1}`)
    index += 1
    return page
  })
  return { fetchPage } satisfies SourceAdapter
}
```

- [ ] **Step 1: Write RED validation tests before production files exist.**

Use:

```ts
const previousWatermark: Watermark = {
  boundaryTime: '2026-09-08T10:00:00.000Z',
  boundaryIds: ['known-a'],
}
```

Add these exact assertions:

```ts
it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
  'rejects invalid maxPages=%s before fetching',
  async (maxPages) => {
    const adapter = adapterFromPages([])
    await expect(
      traverseWatermark({ adapter, query, previousWatermark, maxPages }),
    ).rejects.toMatchObject<Partial<WatermarkTraversalConfigError>>({ field: 'maxPages' })
    expect(adapter.fetchPage).not.toHaveBeenCalled()
  },
)

it('rejects invalid previous boundary time before fetching', async () => {
  const adapter = adapterFromPages([])
  await expect(
    traverseWatermark({
      adapter,
      query,
      previousWatermark: { boundaryTime: 'not-a-time', boundaryIds: ['known-a'] },
      maxPages: 3,
    }),
  ).rejects.toMatchObject({ field: 'previousWatermark.boundaryTime' })
  expect(adapter.fetchPage).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Add RED single-page classification tests.**

Create separate tests for these inputs and outputs:

1. `[10:00 known-a, 09:59 old]` → `newListings=[]`, `pagesRead=1`, `possibleMiss=false`, previous watermark unchanged.
2. `[10:02 n2, 10:01 n1, 10:00 known-a, 09:59 old]` → `newListings=[n2,n1]`, next boundary time `10:02`, boundary IDs `[n2]`.
3. Terminal page `[10:02 n2, 10:02 n3, 10:01 n1]` → all three new, next boundary `10:02`, IDs `[n2,n3]`.
4. Empty terminal page → previous watermark unchanged.
5. Five records at `10:00`; previous IDs contain two of them, three are unseen → exactly the three unseen listings are new; next boundary stays at the previous boundary time and IDs are previous IDs followed by the three unseen IDs in encounter order.
6. First source record is `09:59` because the old boundary listing disappeared → no new listings, no warning, watermark remains `10:00` rather than regressing.
7. Previous boundary `2026-09-08T10:00:00.000Z` and listing time `2026-09-08T12:00:00.000+02:00` are the same instant → classify by `boundaryIds`, not as newer.

- [ ] **Step 3: Commit only the RED test file.**

```text
test(1.4.1): define watermark traversal core behavior
```

Expected failure is missing `shared/watermark.ts` / `electron/worker/watermark-traversal.ts`; all pre-existing suites should remain unaffected.

- [ ] **Step 4: Verify the exact RED SHA in GitHub Actions.**

Record commit SHA and workflow run ID. Confirm the failure is caused by the intentionally missing new modules, not by unrelated regressions.

- [ ] **Step 5: Create `shared/watermark.ts` with only the two interfaces above.**

No Prisma types, persistence helpers, database conversions, or cold-start variants.

- [ ] **Step 6: Implement validation before the first adapter call.**

Use:

```ts
function parsePreviousBoundary(value: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new WatermarkTraversalConfigError('previousWatermark.boundaryTime', value)
  }
  return parsed
}

function assertMaxPages(maxPages: number): void {
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new WatermarkTraversalConfigError('maxPages', maxPages)
  }
}
```

Call both before `adapter.fetchPage`.

- [ ] **Step 7: Implement the minimum first-page classifier.**

Fetch exactly once with:

```ts
const page = await adapter.fetchPage({ query, cursor: null })
```

Maintain:

```ts
const newListings: Listing[] = []
let maximumEpoch: number | null = null
let maximumOriginalTime: string | null = null
const idsAtMaximum: string[] = []
const previousIds = new Set(previousWatermark.boundaryIds)
const newlyObservedPreviousBoundaryIds: string[] = []
```

For each listing in source order:

```ts
const epoch = Date.parse(listing.listTime)

if (maximumEpoch === null || epoch > maximumEpoch) {
  maximumEpoch = epoch
  maximumOriginalTime = listing.listTime
  idsAtMaximum.length = 0
  idsAtMaximum.push(listing.listId)
} else if (epoch === maximumEpoch && !idsAtMaximum.includes(listing.listId)) {
  idsAtMaximum.push(listing.listId)
}

if (epoch > previousEpoch) {
  newListings.push(listing)
} else if (epoch === previousEpoch) {
  if (!previousIds.has(listing.listId)) {
    newListings.push(listing)
    if (!newlyObservedPreviousBoundaryIds.includes(listing.listId)) {
      newlyObservedPreviousBoundaryIds.push(listing.listId)
    }
  }
} else {
  break
}
```

Build the completed watermark with a dedicated helper:

```ts
function completedWatermark(): Watermark {
  if (maximumEpoch === null || maximumEpoch < previousEpoch) return previousWatermark

  if (maximumEpoch === previousEpoch) {
    return {
      boundaryTime: previousWatermark.boundaryTime,
      boundaryIds: [
        ...new Set([...previousWatermark.boundaryIds, ...newlyObservedPreviousBoundaryIds]),
      ],
    }
  }

  return {
    boundaryTime: maximumOriginalTime!,
    boundaryIds: idsAtMaximum,
  }
}
```

Return `pagesRead: 1` and `possibleMiss: false` for Task 1 scenarios. Page-cap/pagination semantics are added only after their RED tests in Task 2.

- [ ] **Step 8: Commit the minimum GREEN core.**

```text
feat(1.4.1): add core watermark traversal
```

- [ ] **Step 9: Verify focused tests and full exact-SHA GREEN.**

Focused command:

```bash
npm test -- tests/unit/watermark-traversal.test.ts
```

Then require the full `verify` workflow GREEN on the same commit SHA.

---

### Task 2: Multi-page cursor traversal and page-cap semantics

**Files:**
- Modify: `tests/unit/watermark-traversal.test.ts`
- Modify after RED: `electron/worker/watermark-traversal.ts`

**Interfaces:**
- Consumes: Task 1 `traverseWatermark` contract unchanged.
- Produces: same return type, now with real `pagesRead`, cursor traversal, boundary-on-deeper-page handling, and `possibleMiss` semantics.

- [ ] **Step 1: Add RED cursor-depth tests.**

Create a page-3 boundary scenario:

```ts
const pages: SourcePage[] = [
  {
    listings: [listing('n5', '2026-09-08T10:05:00.000Z'), listing('n4', '2026-09-08T10:04:00.000Z')],
    nextCursor: 'opaque-page-2',
  },
  {
    listings: [listing('n3', '2026-09-08T10:03:00.000Z'), listing('n2', '2026-09-08T10:02:00.000Z')],
    nextCursor: 'opaque-page-3',
  },
  {
    listings: [
      listing('n1', '2026-09-08T10:01:00.000Z'),
      listing('known-a', '2026-09-08T10:00:00.000Z'),
      listing('old', '2026-09-08T09:59:00.000Z'),
    ],
    nextCursor: 'must-not-be-used',
  },
]
```

Assert five new IDs in order, `pagesRead === 3`, `possibleMiss === false`, next watermark `10:05 / ['n5']`, and cursor calls exactly `[null, 'opaque-page-2', 'opaque-page-3']`. Assert every request carries the same `query` object by identity.

- [ ] **Step 2: Add RED equal-boundary-across-pages and deleted-boundary tests.**

1. Page 1 ends with unseen `T` IDs, page 2 begins with more `T` IDs, then `< T`; all unseen `T` IDs must be returned before stop.
2. The specific old boundary ID is absent; page 2 reaches `< T`; expect normal completion without walking another page or setting `possibleMiss`.

- [ ] **Step 3: Add RED page-cap tests.**

Case A: `maxPages=2`, no record `< T`, page 2 has `nextCursor='still-more'`.
Assert:

```ts
expect(result).toMatchObject({
  pagesRead: 2,
  possibleMiss: true,
  nextWatermark: previousWatermark,
})
```

Also assert candidates from the two read pages are still returned.

Case B: `maxPages=2`, page 2 has `nextCursor=null`. Expect `possibleMiss=false` and normal monotonic watermark advancement.

Case C: page 2 reaches `< T` but also reports a non-null next cursor. Expect `possibleMiss=false` because crossing the temporal boundary is sufficient; do not request a third page.

- [ ] **Step 4: Commit only the RED pagination tests.**

```text
test(1.4.1): define deep watermark traversal
```

- [ ] **Step 5: Verify exact RED SHA.**

The new depth/cap tests must fail against the one-page implementation while Task 1 core tests remain GREEN.

- [ ] **Step 6: Replace the one-page fetch with the explicit cursor loop.**

Use this exact control flow around the existing classification state:

```ts
let cursor: string | null = null
let pagesRead = 0
let boundaryCrossed = false
let finalNextCursor: string | null = null

while (pagesRead < maxPages) {
  const page = await adapter.fetchPage({ query, cursor })
  pagesRead += 1
  finalNextCursor = page.nextCursor

  for (const current of page.listings) {
    const epoch = Date.parse(current.listTime)

    if (maximumEpoch === null || epoch > maximumEpoch) {
      maximumEpoch = epoch
      maximumOriginalTime = current.listTime
      idsAtMaximum.length = 0
      idsAtMaximum.push(current.listId)
    } else if (epoch === maximumEpoch && !idsAtMaximum.includes(current.listId)) {
      idsAtMaximum.push(current.listId)
    }

    if (epoch > previousEpoch) {
      newListings.push(current)
      continue
    }

    if (epoch === previousEpoch) {
      if (!previousIds.has(current.listId)) {
        newListings.push(current)
        if (!newlyObservedPreviousBoundaryIds.includes(current.listId)) {
          newlyObservedPreviousBoundaryIds.push(current.listId)
        }
      }
      continue
    }

    boundaryCrossed = true
    break
  }

  if (boundaryCrossed || page.nextCursor === null) break

  if (pagesRead === maxPages) {
    return {
      newListings,
      nextWatermark: previousWatermark,
      pagesRead,
      possibleMiss: true,
    }
  }

  cursor = page.nextCursor
}

return {
  newListings,
  nextWatermark: completedWatermark(),
  pagesRead,
  possibleMiss: false,
}
```

Do not decode, parse, persist, or synthesize `cursor`.

- [ ] **Step 7: Remove any unused loop state detected by TypeScript/lint.**

For example, if `finalNextCursor` is not needed by the final implementation, delete it rather than suppressing lint. No unused diagnostics are retained.

- [ ] **Step 8: Commit the GREEN multi-page implementation.**

```text
feat(1.4.1): traverse watermark across pages
```

- [ ] **Step 9: Require focused and full exact-SHA GREEN.**

Run the focused watermark test file, then the entire Actions `verify` workflow on the same SHA.

---

### Task 3: Page-overlap deduplication, chronological ordering guard, and error identity

**Files:**
- Modify: `tests/unit/watermark-traversal.test.ts`
- Modify after RED: `electron/worker/watermark-traversal.ts`

**Interfaces:**
- Consumes: Task 2 traversal state machine.
- Produces:

```ts
export interface WatermarkOrderingObservation {
  page: number
  index: number
  listId: string
  listTime: string
}

export class WatermarkOrderingError extends Error {
  constructor(
    readonly previous: WatermarkOrderingObservation,
    readonly current: WatermarkOrderingObservation,
  ) {
    super('Watermark traversal source order is not non-increasing')
    this.name = 'WatermarkOrderingError'
  }
}
```

- [ ] **Step 1: Add RED duplicate-overlap tests.**

Page 1 contains `listId='raised'` at `10:05`; page 2 repeats `raised` at `10:04` and contains other unique records. Assert the first `raised` object appears exactly once in `newListings`; the repeated ID contributes neither another candidate nor another watermark ID.

Add a raised/reappeared case where the first occurrence of an existing `listId` is genuinely newer than the previous boundary and a later old copy repeats the same ID. It must be new exactly once.

- [ ] **Step 2: Add RED ordering tests inside a page and across pages.**

Inside one page:

```ts
[
  listing('a', '2026-09-08T10:05:00.000Z'),
  listing('b', '2026-09-08T10:06:00.000Z'),
]
```

Expect `WatermarkOrderingError` with:

```ts
{
  previous: { page: 1, index: 0, listId: 'a', listTime: '2026-09-08T10:05:00.000Z' },
  current: { page: 1, index: 1, listId: 'b', listTime: '2026-09-08T10:06:00.000Z' },
}
```

Across pages: page 1 ends with `10:04`, page 2 starts with `10:05`; expect the same typed error with `previous.page === 1` and `current.page === 2`.

Also add `10:00Z` followed by `12:00+02:00` and assert no ordering error because the instants are equal.

- [ ] **Step 3: Add RED duplicate-does-not-create-order-observation test.**

Use a first occurrence of ID `dup` at `10:06`, then a unique `10:05`, then repeat `dup` with an older textual timestamp. The duplicate must be ignored entirely and must not replace the `10:05` previous unique ordering observation.

- [ ] **Step 4: Add RED adapter-error identity test.**

```ts
const sourceError = new Error('source failed')
const adapter: SourceAdapter = {
  async fetchPage() {
    throw sourceError
  },
}

await expect(
  traverseWatermark({ adapter, query, previousWatermark, maxPages: 3 }),
).rejects.toBe(sourceError)
```

- [ ] **Step 5: Add RED repeated-run idempotency test.**

Run a complete source once, then run a fresh adapter serving identical ordered pages with `previousWatermark` equal to the first result’s `nextWatermark`. Assert the second `newListings` is empty. Include a same-`T` unseen ID in the first traversal so the test proves the previous-ID union is persisted in the returned watermark.

- [ ] **Step 6: Commit only the RED robustness tests.**

```text
test(1.4.1): define watermark ordering and dedup guards
```

- [ ] **Step 7: Verify exact RED SHA.**

Confirm new duplicate/order tests fail for the expected missing robustness behavior while Task 1/2 cases remain GREEN.

- [ ] **Step 8: Add global first-occurrence deduplication.**

At function scope add:

```ts
const seenIds = new Set<string>()
```

Change each page loop to indexed iteration:

```ts
for (const [index, current] of page.listings.entries()) {
  if (seenIds.has(current.listId)) continue
  seenIds.add(current.listId)

  const epoch = Date.parse(current.listTime)
  // ordering guard is inserted here, before classification and early-stop checks
}
```

Because the `seenIds` set lives across the whole traversal, later-page overlaps are ignored before classification, watermark-ID collection, ordering observation, and boundary crossing.

- [ ] **Step 9: Add the chronological ordering guard before classification.**

Maintain:

```ts
let previousObservation:
  | { observation: WatermarkOrderingObservation; epoch: number }
  | null = null
```

For every first-seen ID:

```ts
const observation: WatermarkOrderingObservation = {
  page: pagesRead,
  index,
  listId: current.listId,
  listTime: current.listTime,
}

if (previousObservation !== null && epoch > previousObservation.epoch) {
  throw new WatermarkOrderingError(previousObservation.observation, observation)
}

previousObservation = { observation, epoch }
```

Only after this block may classification update `newListings`, maximum state, or stop at `< previousEpoch`.

- [ ] **Step 10: Preserve source errors by omission of wrappers.**

Do not wrap `adapter.fetchPage` in a new error class. If any `try/catch` becomes necessary for local structure, rethrow the exact object with `throw error`.

- [ ] **Step 11: Commit the GREEN robustness implementation.**

```text
feat(1.4.1): guard watermark ordering and page overlap
```

- [ ] **Step 12: Require focused and full exact-SHA GREEN.**

The focused file must cover every design test-matrix item; then run full repository verification on that exact commit.

---

### Task 4: Acceptance/docs alignment and integration

**Files:**
- Modify: `docs/tasks/1-4-1-watermark-algo.md`
- Modify generated rollups exactly as `npm run docs:ops:refresh` would produce:
  - `docs/epics/1-4-watermark.md`
  - `docs/phases/1-kufar-core.md` only if generated block changes
  - `docs/operations/status/tasks.md`
  - `docs/operations/status/epics.md` only if generated output changes
  - `docs/operations/status/drift-report.md`
  - `docs/operations/status/current-state.md` only if generated output changes
- Modify: `docs/superpowers/specs/2026-09-08-1-4-1-watermark-algorithm-design.md`

**Interfaces:**
- Consumes: final behavioral GREEN SHA from Task 3.
- Produces: task `1.4.1 = done/aligned`; epic `1.4` remains incomplete with `1/3` child tasks done because `1.4.2` and `1.4.3` are still todo.

- [ ] **Step 1: Map every acceptance criterion to passing tests before changing task status.**

The task card verification section must name tests for:
- no/some/all new;
- repeated run empty;
- boundary on page 3;
- deleted boundary record without watermark regression, warning, or needless cap walk;
- five equal-time boundary records processed completely;
- cap exhaustion returning `possibleMiss=true` with unchanged watermark;
- RED test commits preceding production commits.

- [ ] **Step 2: Mark only task `1.4.1` done/aligned after behavioral GREEN.**

Set:

```yaml
status: done
sync_state: aligned
last_reviewed: 2026-09-08
```

Update visible status text and all acceptance checkboxes. Explicitly preserve ownership boundaries: persistence is `1.4.2`; cold start is `1.4.3`; user-facing warning delivery is later orchestration/UI work.

- [ ] **Step 3: Synchronize generated docs.**

Preferred command in a checkout:

```bash
npm run docs:ops:refresh
npm run docs:ops:check
```

When operating through GitHub contents writes only, reproduce exactly the generator output and use the exact-SHA `Documentation consistency` Actions step as the authoritative check. Expected epic child rollup: `1/3` done; do not mark epic `1.4` done.

- [ ] **Step 4: Mark the design status implemented.**

Replace the status line with:

```text
Status: approved in chat and written review on 2026-09-08; implemented and verified.
```

- [ ] **Step 5: Commit docs synchronization.**

```text
docs(1.4.1): close watermark algorithm task
```

- [ ] **Step 6: Run final exact-SHA branch verification.**

Require all of:
- Documentation consistency;
- all unit tests including watermark traversal;
- CI failure-mode self-check;
- Typecheck;
- Lint;
- Formatting;
- Postgres compose integration;
- Build;
- Verify build outputs;
- Development launch smoke;
- Production launch smoke.

- [ ] **Step 7: Perform pre-PR code review over `main...HEAD`.**

Reject/fix before PR if review finds:
- Prisma/scheduler/cold-start scope creep;
- lexicographic timestamp comparison;
- watermark regression after deleted boundary records;
- same-`T` IDs replacing rather than unioning previous IDs;
- page-cap path advancing the watermark;
- duplicate overlaps yielding duplicate candidates;
- ordering check occurring after classification for the current unique record;
- cursor decoding/persistence;
- docs prematurely marking epic `1.4` done.

Behavioral fixes require a fresh RED→GREEN cycle.

- [ ] **Step 8: Open a PR to `main`, review its exact patch, and require PR-triggered CI GREEN on the unchanged final feature SHA.**

- [ ] **Step 9: Merge with the normal merge method only after all gates are GREEN.**

Preserve the RED→GREEN commit history; do not squash or rebase-merge. Verify the merge commit’s second parent is the final feature head and the merge tree matches the feature tree.
