# Watermark Traversal Algorithm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the pure multi-page watermark traversal that returns listings new relative to a previous temporal boundary, preserves idempotency across equal timestamps and disappearing records, and surfaces page-cap incompleteness without advancing the watermark.

**Architecture:** Add JSON-friendly watermark domain types under `shared/`, then implement one worker-side state machine over the existing `SourceAdapter`. The state machine validates configuration before I/O, compares timestamps by parsed epoch milliseconds, deduplicates `listId` values across pages, stops at the first unique record older than the previous boundary, validates global descending time order, and computes a monotonic next watermark only after successful traversal. No Prisma, scheduler, cold-start, persistence, matcher, or notification logic is added.

**Tech Stack:** TypeScript 6.0.2, Node 22, Vitest 5.0.0, existing `CanonicalQuery`, `Listing`, and `SourceAdapter` contracts. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-08-1-4-1-watermark-algorithm-design.md`

## Global Constraints

- `previousWatermark` is mandatory; cold start remains in `1.4.3`.
- `maxPages` is caller-supplied, must be an integer `>= 1`, and is validated before any adapter call.
- `previousWatermark.boundaryTime` must parse to a finite timestamp before any adapter call.
- `Listing.listTime` ordering/equality is chronological by `Date.parse`, never lexicographic string comparison.
- Marketplace pagination cursors remain opaque and local to one traversal.
- Same-time IDs use first-appearance order; no stable source tie-breaker is assumed.
- Repeated `listId` values across pages are ignored after the first occurrence.
- The first unique record older than the previous boundary terminates traversal immediately.
- A completed next watermark never moves backward in time.
- If the new maximum instant equals the previous boundary instant, retain previous boundary IDs and append newly observed boundary IDs deterministically.
- If page cap is exhausted while `nextCursor != null` before the old boundary is fully crossed, return `possibleMiss: true` and the previous watermark unchanged.
- Adapter errors propagate unchanged; traversal does not reinterpret HTTP/fallback/schema errors.
- Ordering violations throw a typed traversal error and return no success result.
- No database, Prisma, `MonitorCursor`, `Run`, scheduler, config-file wiring, matcher, cold-start, notification, or user-facing reporting implementation.
- Every behavior change follows RED test-only commit → exact-SHA failing Actions evidence → minimum GREEN production commit → exact-SHA full GREEN evidence.

---

### Task 1: Domain types, input validation, and single-page watermark classification

**Files:**
- Create: `shared/watermark.ts`
- Create: `electron/worker/watermark-traversal.ts`
- Create: `tests/unit/watermark-traversal.test.ts`

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
  )
}

export async function traverseWatermark(
  input: TraverseWatermarkInput,
): Promise<WatermarkTraversalResult>
```

**Test helpers to create once in `tests/unit/watermark-traversal.test.ts`:**

```ts
import { describe, expect, it, vi } from 'vitest'
import type { CanonicalQuery } from '../../shared/canonical-query'
import type { Listing } from '../../shared/listing'
import type { SourceAdapter, SourcePage } from '../../shared/source-adapter'
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

function adapterFromPages(pages: readonly SourcePage[]): SourceAdapter & {
  fetchPage: ReturnType<typeof vi.fn>
} {
  let index = 0
  const fetchPage = vi.fn(async () => {
    const page = pages[index]
    if (!page) throw new Error(`Unexpected page request ${index + 1}`)
    index += 1
    return page
  })
  return { fetchPage }
}
```

- [ ] **Step 1: Write the first RED tests for validation before I/O.**

Add explicit cases:

```ts
it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
  'rejects invalid maxPages=%s before fetching',
  async (maxPages) => {
    const adapter = adapterFromPages([])
    const previousWatermark: Watermark = {
      boundaryTime: '2026-09-08T10:00:00.000Z',
      boundaryIds: ['old'],
    }

    await expect(
      traverseWatermark({ adapter, query, previousWatermark, maxPages }),
    ).rejects.toMatchObject<Partial<WatermarkTraversalConfigError>>({ field: 'maxPages' })
    expect(adapter.fetchPage).not.toHaveBeenCalled()
  },
)

it('rejects an invalid previous boundary time before fetching', async () => {
  const adapter = adapterFromPages([])
  await expect(
    traverseWatermark({
      adapter,
      query,
      previousWatermark: { boundaryTime: 'not-a-time', boundaryIds: ['old'] },
      maxPages: 3,
    }),
  ).rejects.toMatchObject({ field: 'previousWatermark.boundaryTime' })
  expect(adapter.fetchPage).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Add RED single-page classification tests.**

Cover all of these with exact expected objects:

```ts
const previousWatermark: Watermark = {
  boundaryTime: '2026-09-08T10:00:00.000Z',
  boundaryIds: ['known-a'],
}
```

1. Page `[10:00 known-a, 09:59 old]` → `newListings=[]`, `pagesRead=1`, `possibleMiss=false`, watermark unchanged.
2. Page `[10:02 n2, 10:01 n1, 10:00 known-a, 09:59 old]` → `newListings=[n2,n1]`, next boundary `10:02` with IDs `[n2]`.
3. Page `[10:02 n2, 10:02 n3, 10:01 n1]`, `nextCursor=null` → all three new, next boundary `10:02`, IDs `[n2,n3]`.
4. Empty terminal page → previous watermark unchanged.
5. Five records at `10:00`, with two known IDs in `previousWatermark.boundaryIds` and three unseen IDs → only three unseen IDs are new; next watermark stays at previous boundary time and boundary IDs equal previous IDs followed by the three newly observed IDs in encounter order.
6. First available record is `09:59` because the old boundary listing disappeared → no new listings and watermark remains at `10:00`; it must not regress to `09:59`.
7. Boundary `10:00:00Z` and listing `12:00:00+02:00` represent the same instant → classify by boundary IDs, not as newer.

- [ ] **Step 3: Commit the RED tests only.**

Commit only `tests/unit/watermark-traversal.test.ts` with message:

```text
test(1.4.1): define watermark traversal core behavior
```

The test import intentionally points at not-yet-created production modules, so the new file must fail while all pre-existing tests remain unaffected.

- [ ] **Step 4: Verify exact RED SHA in GitHub Actions.**

Expected failure: Unit tests/type resolution fail because `shared/watermark.ts` and/or `electron/worker/watermark-traversal.ts` do not exist. Record the exact commit SHA and workflow run number before writing production code.

- [ ] **Step 5: Add the minimum shared types.**

Create `shared/watermark.ts` exactly with the `Watermark` and `WatermarkTraversalResult` interfaces above. Do not add persistence or Prisma types.

- [ ] **Step 6: Add input validation and one-page traversal implementation.**

Use one helper for parsed timestamps:

```ts
function validBoundaryTime(value: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new WatermarkTraversalConfigError('previousWatermark.boundaryTime', value)
  }
  return parsed
}
```

Validate `maxPages` with `Number.isInteger(maxPages) && maxPages >= 1` before calling `adapter.fetchPage`.

For the first GREEN implementation, fetch the first page with `{ query, cursor: null }`, process unique listings in source order, compare `Date.parse(listing.listTime)` to the previous boundary epoch, collect new listings, stop on first unique older record, and build the monotonic next watermark:

```ts
if (maximumEpoch === null || maximumEpoch < previousEpoch) return previousWatermark
if (maximumEpoch === previousEpoch) {
  return {
    boundaryTime: previousWatermark.boundaryTime,
    boundaryIds: [...previousIds, ...newBoundaryIdsNotAlreadyKnown],
  }
}
return { boundaryTime: maximumOriginalTime, boundaryIds: idsAtMaximum }
```

- [ ] **Step 7: Run the focused unit test and full branch verification.**

Focused command in CI-capable checkout:

```bash
npm test -- tests/unit/watermark-traversal.test.ts
```

Then require the exact GREEN SHA full `verify` workflow to pass before Task 2.

- [ ] **Step 8: Commit the GREEN core implementation.**

```text
feat(1.4.1): add core watermark traversal
```

---

### Task 2: Multi-page cursor traversal, temporal boundary depth, and page-cap warning

**Files:**
- Modify: `tests/unit/watermark-traversal.test.ts`
- Modify: `electron/worker/watermark-traversal.ts`

**Interfaces:**
- Consumes: Task 1 `traverseWatermark` and public watermark types unchanged.
- Produces: same function, now honoring `SourcePage.nextCursor` across multiple adapter calls and the `possibleMiss` contract.

- [ ] **Step 1: Extend tests with a cursor-aware synthetic adapter assertion.**

Add a helper or direct assertions so requests must be exactly:

```ts
expect(adapter.fetchPage.mock.calls.map(([request]) => request.cursor)).toEqual([
  null,
  'opaque-page-2',
  'opaque-page-3',
])
```

The query object must be passed by identity on every request.

- [ ] **Step 2: Add the RED page-3 boundary scenario.**

Use pages:

```ts
[
  { listings: [n5_10_05, n4_10_04], nextCursor: 'opaque-page-2' },
  { listings: [n3_10_03, n2_10_02], nextCursor: 'opaque-page-3' },
  { listings: [n1_10_01, boundaryKnown_10_00, old_09_59], nextCursor: 'unused' },
]
```

Expected:
- five new listings in global source order;
- `pagesRead === 3`;
- stop during page 3 at `09:59` and never request another page;
- `possibleMiss === false`;
- next watermark at `10:05`, IDs `[n5]`.

- [ ] **Step 3: Add RED deletion and same-time-across-pages scenarios.**

1. Previous boundary ID is absent; page 2 starts with an older record → traversal stops normally, `possibleMiss=false`, and no extra page is fetched.
2. Equal-time `T` records exist at the end of page 1 and start of page 2; page 2 later contains `< T` → all unseen IDs at `T` are classified before stopping.

- [ ] **Step 4: Add RED page-cap scenarios.**

Case A:

```ts
maxPages: 2
page2.nextCursor = 'still-more'
```

and no `< T` has been seen. Expect:

```ts
{
  possibleMiss: true,
  pagesRead: 2,
  nextWatermark: previousWatermark,
}
```

while still returning candidates already observed in those two pages.

Case B: the second page is terminal (`nextCursor: null`). Expect `possibleMiss=false` and normal monotonic watermark advancement.

Case C: exactly on page 2 an older record `< T` is seen even though `nextCursor` is non-null. Expect complete traversal (`possibleMiss=false`) because the temporal boundary, not source exhaustion, proves safety.

- [ ] **Step 5: Commit the RED pagination/cap tests only.**

```text
test(1.4.1): define deep watermark traversal
```

- [ ] **Step 6: Verify exact RED SHA fails for missing deep traversal behavior.**

Expected failures must be limited to the new multi-page/cap assertions; the Task 1 core tests remain GREEN.

- [ ] **Step 7: Implement the cursor loop minimally.**

Use a loop with explicit state:

```ts
let cursor: string | null = null
let pagesRead = 0
let boundaryCrossed = false

while (pagesRead < maxPages) {
  const page = await adapter.fetchPage({ query, cursor })
  pagesRead += 1
  // process page; set boundaryCrossed when first unique epoch < previousEpoch
  if (boundaryCrossed) break
  if (page.nextCursor === null) break
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
```

Pass `page.nextCursor` unchanged. Do not decode or store it outside the invocation.

- [ ] **Step 8: Run focused tests and exact-SHA full GREEN verification.**

Require all Task 1 and Task 2 tests GREEN plus complete Actions `verify` before Task 3.

- [ ] **Step 9: Commit the GREEN multi-page implementation.**

```text
feat(1.4.1): traverse watermark across pages
```

---

### Task 3: Global ordering guard, page-overlap deduplication, and source error propagation

**Files:**
- Modify: `tests/unit/watermark-traversal.test.ts`
- Modify: `electron/worker/watermark-traversal.ts`

**Interfaces:**
- Consumes: existing traversal state machine.
- Produces these additional public diagnostics:

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
  )
}
```

- [ ] **Step 1: Add the RED duplicate-overlap tests.**

Construct page 1 with `listId='raised'` at `10:05`, page 2 repeating the same ID at `10:04`, and other unique listings around it. Expect:
- `raised` appears once in `newListings` using the first occurrence;
- later duplicate does not affect ordering validation;
- the duplicate is not duplicated in next-boundary IDs.

Also cover a raised listing whose first occurrence has a genuinely newer timestamp than the previous boundary; it is new exactly once even if its old copy appears later.

- [ ] **Step 2: Add RED ordering-violation tests inside one page.**

Example:

```ts
[listing('a', '2026-09-08T10:05:00.000Z'), listing('b', '2026-09-08T10:06:00.000Z')]
```

Expect `WatermarkOrderingError` with:

```ts
{
  previous: { page: 1, index: 0, listId: 'a', listTime: '2026-09-08T10:05:00.000Z' },
  current: { page: 1, index: 1, listId: 'b', listTime: '2026-09-08T10:06:00.000Z' },
}
```

- [ ] **Step 3: Add RED ordering-violation tests across pages.**

Page 1 ends at `10:04`; page 2 begins at `10:05`. Expect the same typed error with page/index context spanning pages.

Add an equal-instant offset spelling case (`10:00Z` followed by `12:00+02:00`) and assert no ordering error.

- [ ] **Step 4: Add RED source-error propagation test.**

Use an exact sentinel object:

```ts
const sourceError = new Error('source failed')
const adapter: SourceAdapter = {
  async fetchPage() {
    throw sourceError
  },
}
await expect(traverseWatermark({ adapter, query, previousWatermark, maxPages: 3 })).rejects.toBe(
  sourceError,
)
```

No wrapper error is allowed.

- [ ] **Step 5: Add RED re-run/idempotency test.**

Run a complete synthetic traversal once. Feed its `nextWatermark` into a fresh adapter serving the exact same ordered pages. Expect second `newListings` to be `[]`, including cases where the first traversal extended IDs at the old `T` boundary.

- [ ] **Step 6: Commit the RED robustness tests only.**

```text
test(1.4.1): define watermark ordering and dedup guards
```

- [ ] **Step 7: Verify exact RED SHA.**

Expected failures: duplicate handling and typed ordering behavior are not yet implemented; earlier traversal tests remain GREEN.

- [ ] **Step 8: Implement global deduplication and ordering observations.**

Maintain:

```ts
const seenIds = new Set<string>()
let previousObservation: { observation: WatermarkOrderingObservation; epoch: number } | null = null
```

For each listing:
1. if `seenIds.has(listId)`, ignore it completely;
2. otherwise parse its epoch, create the page/index observation;
3. if `previousObservation !== null && currentEpoch > previousObservation.epoch`, throw `WatermarkOrderingError`;
4. record the current observation;
5. classify against the previous watermark and update candidate/maximum state.

Do not treat ignored duplicates as ordering observations.

- [ ] **Step 9: Keep adapter exceptions untouched.**

Do not add `try/catch` around `fetchPage` unless needed for local cleanup; if a catch exists, rethrow the same error object with `throw error`.

- [ ] **Step 10: Run focused tests and exact-SHA full GREEN verification.**

Require the complete `tests/unit/watermark-traversal.test.ts` matrix plus the full repository workflow GREEN.

- [ ] **Step 11: Commit the GREEN robustness implementation.**

```text
feat(1.4.1): guard watermark ordering and page overlap
```

---

### Task 4: Acceptance alignment, generated docs, and final verification

**Files:**
- Modify: `docs/tasks/1-4-1-watermark-algo.md`
- Modify: `docs/epics/1-4-watermark.md` generated task rollup only as produced by docs-ops.
- Modify: `docs/phases/1-kufar-core.md` generated epic rollup only if docs-ops changes it.
- Modify: `docs/operations/status/tasks.md`
- Modify: `docs/operations/status/epics.md` only if generated output changes.
- Modify: `docs/operations/status/drift-report.md`
- Modify: `docs/operations/status/current-state.md` only if generated output changes.
- Modify: `docs/superpowers/specs/2026-09-08-1-4-1-watermark-algorithm-design.md` status line from implementation-planning to implemented after behavior is verified.

**Interfaces:**
- Consumes: exact behavioral GREEN SHA from Task 3.
- Produces: task `1.4.1` marked `done/aligned`; epic `1.4` remains incomplete because `1.4.2` and `1.4.3` are still todo.

- [ ] **Step 1: Map every task acceptance criterion to an exact passing unit test.**

Document in the task card:
- no/some/all new;
- repeated run empty;
- boundary on page 3;
- deleted boundary record without regression/warning/cap walk;
- five equal-time records processed completely;
- page-cap warning without watermark advancement;
- tests committed before production code.

- [ ] **Step 2: Update the task card only after behavioral GREEN.**

Set frontmatter:

```yaml
status: done
sync_state: aligned
last_reviewed: 2026-09-08
```

Update the visible heading/status and check all acceptance boxes. Add a verification section naming the exact final behavioral SHA and Actions run ID.

Clarify non-scope: persistence belongs to `1.4.2`; cold start belongs to `1.4.3`; user-facing warning transport remains later orchestration/UI work.

- [ ] **Step 3: Refresh generated docs with the repository docs-ops command.**

In a CI-capable checkout run:

```bash
npm run docs:ops:refresh
npm run docs:ops:check
```

Expected epic rollup after `1.4.1`: `1/3` tasks done; epic `1.4` itself must not be marked done.

When operating only through GitHub writes, reproduce exactly the files `docs:ops:refresh` would change and use `Documentation consistency` in exact-SHA Actions as the authoritative equivalence check.

- [ ] **Step 4: Mark the design status implemented.**

Use:

```text
Status: approved in chat and written review on 2026-09-08; implemented and verified.
```

- [ ] **Step 5: Commit documentation synchronization.**

```text
docs(1.4.1): close watermark algorithm task
```

- [ ] **Step 6: Run final exact-SHA verification.**

Require all of the following on the exact final branch head:
- Documentation consistency;
- all unit tests including the new watermark suite;
- CI failure-mode self-check;
- Typecheck;
- Lint;
- Formatting;
- Postgres compose integration;
- Build + build-output verification;
- Development Electron smoke;
- Production Electron smoke.

- [ ] **Step 7: Perform pre-PR review.**

Review `main...HEAD` for:
- accidental Prisma/scheduler/cold-start scope creep;
- watermark regression on deleted boundary records;
- accidental lexicographic timestamp comparison;
- cap paths that advance watermark;
- duplicate overlap producing duplicate candidates;
- ordering guard occurring after early stop instead of before it;
- cursor decoding/persistence;
- docs claiming epic `1.4` complete prematurely.

Fix any Important/Critical finding before opening the PR, using a new RED→GREEN cycle for behavioral fixes.

- [ ] **Step 8: Open PR to `main`, verify PR-triggered CI on the exact final feature SHA, review the PR patch, and merge with the normal merge method only after GREEN.**

Preserve the RED→GREEN commit history; do not squash or rebase-merge.
