# Persistent Watermark Catch-up Checkpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make page-capped incremental traversal converge across multiple runs without advancing the stable watermark until the old boundary is fully closed.

**Architecture:** Keep `MonitorCursor` as the fully confirmed watermark and persist an optional one-to-one `MonitorCatchUpCheckpoint` containing the opaque resume cursor, pending high watermark, cumulative page count, and last ordering observation. Each partial chunk commits Listing/Match rows plus the checkpoint atomically while retaining the stable watermark; a later complete chunk clears the checkpoint and advances the stable watermark. Invalid resumed cursors/order discard only the transient checkpoint and leave the stable watermark untouched.

**Tech Stack:** TypeScript 6, Vitest 5, Prisma ORM 7.10, PostgreSQL 16, Electron worker orchestration.

**Spec:** `docs/superpowers/specs/2026-09-09-watermark-catch-up-checkpoint-design.md`

## Global Constraints

- Keep marketplace pagination cursors opaque; never decode or synthesize them.
- Never advance `MonitorCursor.boundaryTime/boundaryIds` for an incomplete catch-up chunk.
- Partial Listing/Match writes and checkpoint changes must share the existing monitor-run transaction.
- Existing unique `(monitorId, listingId)` Match semantics remain the idempotency boundary.
- Source identity reset deletes `MonitorCursor`; the catch-up checkpoint must disappear by cascade.
- `maxPages` remains configuration-driven.
- Cold-start behavior remains unchanged except for rejecting malformed `listTime` through the shared finite-time guard.
- Follow TDD: every production behavior starts with a failing test and a verified RED run.

---

### Task 1: Discriminated traversal checkpoint and timestamp guard

**Files:**
- Modify: `shared/watermark.ts`
- Modify: `electron/worker/watermark-traversal.ts`
- Modify: `electron/worker/cold-start-traversal.ts`
- Modify: `tests/unit/watermark-traversal.test.ts`
- Modify: `tests/unit/cold-start-traversal.test.ts`

**Interfaces:**
- Consumes: existing `Watermark`, `SourceAdapter.fetchPage({ query, cursor })`, `maxPages`.
- Produces: `WatermarkCatchUpCheckpoint`, discriminated `WatermarkTraversalResult`, `WatermarkListingTimeError`, `WatermarkCatchUpResumeError`, and `traverseWatermark(..., checkpoint?)`.

- [ ] **Step 1: Add failing traversal tests for page-cap checkpoint creation and resume**

Add cases equivalent to:

```ts
expect(first.status).toBe('incomplete')
expect(first.nextWatermark).toEqual(previousWatermark)
expect(first.checkpoint).toMatchObject({
  resumeCursor: 'page-3',
  pendingWatermark: {
    boundaryTime: '2026-09-09T12:10:00.000Z',
    boundaryIds: ['new-top'],
  },
  pagesRead: 2,
})

const second = await traverseWatermark({
  adapter,
  query,
  previousWatermark,
  maxPages: 2,
  checkpoint: first.checkpoint,
})
expect(second.status).toBe('complete')
expect(second.nextWatermark).toEqual(first.checkpoint.pendingWatermark)
```

Also assert that a maximum-time tie split across chunks merges all IDs into `pendingWatermark.boundaryIds`, and that the resumed adapter's first call receives exactly the persisted opaque cursor.

- [ ] **Step 2: Run focused tests and verify RED**

Run through GitHub Actions by committing only the new tests. Expected failures: missing checkpoint/result fields and missing checkpoint input support, with unrelated tests green.

- [ ] **Step 3: Add failing tests for cross-chunk ordering and malformed timestamps**

Cover:

```ts
await expect(
  traverseWatermark({ ...input, checkpoint }),
).rejects.toBeInstanceOf(WatermarkOrderingError)

await expect(traverseWatermark(inputWithInvalidListTime)).rejects.toBeInstanceOf(
  WatermarkListingTimeError,
)

await expect(traverseColdStartBaseline(coldStartWithInvalidListTime)).rejects.toBeInstanceOf(
  WatermarkListingTimeError,
)
```

For resumed source-fetch failure, expect a typed `WatermarkCatchUpResumeError` whose `cause` is the adapter error.

- [ ] **Step 4: Implement the shared types and minimal traversal state machine**

`shared/watermark.ts` should expose:

```ts
export interface WatermarkCatchUpObservation {
  page: number
  index: number
  listId: string
  listTime: string
}

export interface WatermarkCatchUpCheckpoint {
  resumeCursor: string
  pendingWatermark: Watermark
  pagesRead: number
  lastObservation: WatermarkCatchUpObservation | null
}
```

Implement `WatermarkTraversalResult` as the `complete | incomplete` union from the design spec while preserving `possibleMiss` as `false | true` on the respective branches.

In `watermark-traversal.ts`, initialize `pendingWatermark` from the stable previous watermark, seed ordering state and cursor from the checkpoint when present, preserve cumulative page numbering, and on page cap return an incomplete checkpoint using `page.nextCursor`.

Introduce one helper that validates every listing timestamp before comparison:

```ts
export function parseListingTime(
  observation: WatermarkCatchUpObservation,
): number {
  const epoch = Date.parse(observation.listTime)
  if (!Number.isFinite(epoch)) throw new WatermarkListingTimeError(observation)
  return epoch
}
```

Use the same helper from cold-start traversal.

- [ ] **Step 5: Run focused traversal suites and verify GREEN**

Run `tests/unit/watermark-traversal.test.ts` and `tests/unit/cold-start-traversal.test.ts`; expected: all tests pass.

- [ ] **Step 6: Commit**

Commit message: `feat: add resumable watermark traversal checkpoint`.

---

### Task 2: Persist checkpoint as a one-to-one cursor child

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260909130000_watermark_catch_up_checkpoint/migration.sql`
- Create: `electron/worker/watermark-catch-up-persistence.ts`
- Modify: `tests/prisma-schema-constraints.test.ts`
- Modify: `tests/prisma-migrations.test.ts`
- Modify: `tests/integration/monitor-run-persistence.test.ts`

**Interfaces:**
- Consumes: `WatermarkCatchUpCheckpoint`, Prisma transaction client, `MonitorCursor.updatedAt` concurrency revision.
- Produces: `parsePersistedCatchUpCheckpoint`, `persistCatchUpCheckpoint`, and `discardCatchUpCheckpoint`.

- [ ] **Step 1: Add RED schema/migration tests**

Assert the Prisma schema contains the one-to-one relation and the SQL migration creates `MonitorCatchUpCheckpoint` with:

```sql
PRIMARY KEY ("monitorId")
FOREIGN KEY ("monitorId") REFERENCES "MonitorCursor"("monitorId") ON DELETE CASCADE
CHECK ("pagesRead" >= 1)
```

Also require an all-null/all-present check for `lastPage`, `lastIndex`, `lastListId`, `lastListTime`.

- [ ] **Step 2: Commit tests and verify RED in Actions**

Expected failures: missing model/migration/table.

- [ ] **Step 3: Implement Prisma model and SQL migration**

Add:

```prisma
model MonitorCatchUpCheckpoint {
  monitorId           Int           @id
  resumeCursor        String
  pendingBoundaryTime DateTime
  pendingBoundaryIds  Json
  pagesRead           Int
  lastPage            Int?
  lastIndex           Int?
  lastListId          String?
  lastListTime        DateTime?
  cursor              MonitorCursor @relation(fields: [monitorId], references: [monitorId], onDelete: Cascade)
}
```

and `catchUpCheckpoint MonitorCatchUpCheckpoint?` on `MonitorCursor`.

- [ ] **Step 4: Add RED persistence behavior tests**

Integration tests must prove:

```ts
// incomplete chunk
expect(cursor.boundaryTime).toEqual(oldBoundary)
expect(checkpoint.resumeCursor).toBe('page-3')
expect(run.degradedLevel).toBe('watermark-catch-up')

// complete chunk
expect(cursor.boundaryTime).toEqual(newBoundary)
expect(checkpoint).toBeNull()
```

Also delete the `MonitorCursor` and assert the checkpoint is removed by database cascade.

- [ ] **Step 5: Implement checkpoint mapping/persistence helpers**

`parsePersistedCatchUpCheckpoint` validates string arrays, finite dates, positive integer `pagesRead`, and all-null/all-present last-observation fields, then returns the shared checkpoint value.

`persistCatchUpCheckpoint(tx, monitorId, checkpoint)` upserts when non-null and deletes when null.

`discardCatchUpCheckpoint` must run a transaction that locks the monitor, verifies the expected cursor revision, deletes the checkpoint, and updates `MonitorCursor.lastRunAt` to bump `updatedAt` without advancing its stable boundary.

- [ ] **Step 6: Run schema + persistence tests and verify GREEN**

Run unit/schema tests plus PostgreSQL integration for monitor-run persistence.

- [ ] **Step 7: Commit**

Commit message: `feat: persist watermark catch-up checkpoint`.

---

### Task 3: Wire incremental monitor runs to resume and converge

**Files:**
- Modify: `electron/worker/incremental-monitor-run.ts`
- Modify: `electron/worker/monitor-run-persistence.ts`
- Modify: `tests/unit/incremental-monitor-run.test.ts`
- Modify: `tests/integration/monitor-run-persistence.test.ts`
- Modify: `tests/integration/monitor-run-stale-config.test.ts`

**Interfaces:**
- Consumes: persisted checkpoint relation, `traverseWatermark(... checkpoint)`, existing selector/prefilter/description loader.
- Produces: multi-run catch-up orchestration with atomic partial commits and invalid-resume reset.

- [ ] **Step 1: Add RED orchestration test for resume across two monitor runs**

First run should read from top, hit cap, persist selected candidates and checkpoint while leaving stable watermark unchanged. Second run should load the checkpoint and call the adapter first with its `resumeCursor`; once the old boundary is crossed it should clear checkpoint and advance the stable watermark.

Assert unique Matches are not duplicated even if the resumed page overlaps a listing from the previous chunk.

- [ ] **Step 2: Add RED error-path tests**

For a persisted checkpoint:

```ts
await expect(runIncrementalMonitor(...adapterRejectsResume)).rejects.toThrow(...)
expect(await prisma.monitorCatchUpCheckpoint.findUnique(...)).toBeNull()
expect(cursor.boundaryTime).toEqual(oldBoundary)
```

Repeat for a cross-chunk `WatermarkOrderingError`. Verify cursor `updatedAt` changes when the checkpoint is discarded, so a concurrent stale commit fails.

Malformed `listTime` must remain a hard typed failure and must not advance or discard stable watermark state.

- [ ] **Step 3: Commit tests and verify RED**

Expected failures: checkpoint not selected/parsed, traversal not resumed, partial persistence absent, invalid-resume reset absent.

- [ ] **Step 4: Wire checkpoint loading and traversal**

Extend the monitor cursor select to include `catchUpCheckpoint`, parse it, and pass it to `traverseWatermark`.

On `WatermarkCatchUpResumeError` or resumed `WatermarkOrderingError`, call `discardCatchUpCheckpoint` with the cursor revision read at run start and then rethrow. Do not discard for first-pass adapter failures or `WatermarkListingTimeError`.

- [ ] **Step 5: Extend the existing monitor-run transaction**

Add `checkpoint: WatermarkCatchUpCheckpoint | null` to `MonitorRunPersistenceInput`. Keep `nextWatermark` equal to the stable previous watermark on incomplete results. Persist Listing/Match rows, cursor, checkpoint, and Run atomically.

Set:

```ts
degradedLevel: input.checkpoint === null ? null : 'watermark-catch-up'
```

while retaining `outcome: 'success'` for compatibility.

- [ ] **Step 6: Run unit + PostgreSQL integration suites and verify GREEN**

Required behavioral proof: repeated capped runs make forward progress, stable watermark advances only after completion, duplicate Matches are impossible, source-reset cascade removes checkpoint, and stale concurrent commits are rejected.

- [ ] **Step 7: Commit**

Commit message: `feat: resume incremental watermark catch-up`.

---

### Task 4: Document remediation and verify whole repository

**Files:**
- Create: `docs/tasks/1-4-4-watermark-catch-up.md`
- Modify: `docs/epics/1-4-watermark.md` if required by docs-ops structure
- Modify generated docs only through the repository's documented docs-ops refresh workflow if needed.

**Interfaces:**
- Consumes: completed implementation and TDD run evidence.
- Produces: aligned task card and merge-ready PR.

- [ ] **Step 1: Create task card `1.4.4`**

Record the review-origin stall, the persistent checkpoint architecture, failure/reset semantics, transaction boundary, TDD evidence, and explicit scope exclusions. Mark acceptance criteria only after exact tests have passed.

- [ ] **Step 2: Run/fix docs-ops consistency**

Use `npm run docs:ops:check` via the branch workflow. If the checker requires rollup refresh, apply only generated changes produced by the established docs-ops flow.

- [ ] **Step 3: Run the full branch `verify` workflow on the exact final HEAD**

Required green steps: documentation consistency, unit tests, CI failure-mode self-check, typecheck, lint, formatting, PostgreSQL compose integration, Electron sandbox prep, build, output verification, development launch smoke, production launch smoke.

- [ ] **Step 4: Self-review the final diff against the design spec**

Check: stable watermark never advances on incomplete chunks; checkpoint always advances atomically with chunk writes; source reset cascades; cross-chunk ordering validated; malformed timestamps cannot enter comparisons; resumed cursor failures reset transient state only; no scheduler/matcher/UI scope leaked in.

- [ ] **Step 5: Open PR to `main` without merging**

Use a normal merge later to preserve RED→GREEN history, but merge only after explicit user authorization.
