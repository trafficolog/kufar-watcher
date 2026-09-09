# Persistent Watermark Catch-up Checkpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make page-capped incremental watermark traversal converge across persisted monitor cycles while advancing the confirmed watermark only after the previous boundary is actually reached.

**Architecture:** Extend `MonitorCursor` with a temporary catch-up checkpoint that stores the opaque resume cursor, tentative future watermark, and cross-chunk ordering observation. `traverseWatermark` becomes checkpoint-aware and returns a complete/incomplete discriminated result; `runIncrementalMonitor` resumes checkpoints and falls back once to a fresh-from-top traversal on resumed failure; the existing short Prisma transaction persists candidates, matches, checkpoint/watermark state, and Run atomically.

**Tech Stack:** TypeScript 6, Vitest 5, Prisma ORM 7.10, PostgreSQL 16, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-09-watermark-catchup-checkpoint-design.md`

## Global Constraints

- The confirmed `MonitorCursor.boundaryTime + boundaryIds` never advances before all candidates/matches in the completed gap are committed.
- Marketplace cursors remain opaque strings; never decode, synthesize, or compare their internals.
- Catch-up state belongs to the existing `MonitorCursor` row and participates in its `updatedAt` stale-revision guard.
- Source/query reset continues to delete the whole `MonitorCursor`, which must also delete checkpoint state.
- Description fetching and selection remain outside the database transaction and preserve task 1.5.2 ordering.
- Cold-start baseline semantics remain unchanged except for explicit invalid `listTime` validation.
- No scheduler overlap prevention, user-facing degraded UI, Telegram, or keyword matcher work.
- RED and GREEN evidence remain separate commits/runs where practical.

---

## File Structure

- `shared/watermark.ts` — shared checkpoint and discriminated traversal result types.
- `electron/worker/watermark-traversal.ts` — pure incremental traversal, checkpoint resume, tie accumulation, ordering and timestamp validation.
- `electron/worker/cold-start-traversal.ts` — reuse the same explicit listing-time validation contract.
- `prisma/schema.prisma` — checkpoint columns on `MonitorCursor`.
- `prisma/migrations/20260909110000_watermark_catchup_checkpoint/migration.sql` — columns plus tuple/invariant CHECK constraints.
- `electron/worker/monitor-run-persistence.ts` — complete vs incomplete cursor/checkpoint writes and Run outcome.
- `electron/worker/incremental-monitor-run.ts` — parse persisted checkpoint, resume, one-shot fresh fallback, forward traversal progress to persistence.
- `tests/unit/watermark-traversal.test.ts` — multi-chunk progress, ties, ordering continuity, invalid time.
- `tests/unit/cold-start-traversal.test.ts` — invalid-time parity.
- `tests/unit/incremental-monitor-run.test.ts` and `tests/unit/incremental-description-policy.test.ts` — checkpoint orchestration without changing selection/description policy.
- `tests/integration/monitor-run-persistence.test.ts` — partial/complete checkpoint transactions and rollback.
- `tests/integration/monitor-config-persistence.test.ts` and `tests/integration/monitor-run-stale-config.test.ts` — reset/stale protection with checkpoint state.
- `scripts/verify-postgres-compose.sh` — migration count and real-Postgres checkpoint constraint verification.
- `docs/tasks/1-4-4-watermark-catchup-checkpoint.md`, `docs/epics/1-4-watermark.md`, generated docs status — remediation documentation after code is green.

---

### Task 1: Checkpoint-aware pure traversal

**Files:**
- Modify: `shared/watermark.ts`
- Modify: `electron/worker/watermark-traversal.ts`
- Modify: `electron/worker/cold-start-traversal.ts`
- Modify: `tests/unit/watermark-traversal.test.ts`
- Modify: `tests/unit/cold-start-traversal.test.ts`

**Interfaces:**
- Consumes: existing `Watermark`, `Listing`, `SourceAdapter`, `CanonicalQuery`.
- Produces:

```ts
export interface WatermarkCatchupCheckpoint {
  resumeCursor: string
  pendingWatermark: Watermark
  lastObservation: { listId: string; listTime: string } | null
}

export type WatermarkTraversalResult =
  | {
      kind: 'complete'
      newListings: Listing[]
      nextWatermark: Watermark
      pagesRead: number
      possibleMiss: false
      checkpoint: null
    }
  | {
      kind: 'incomplete'
      newListings: Listing[]
      nextWatermark: Watermark
      pagesRead: number
      possibleMiss: true
      checkpoint: WatermarkCatchupCheckpoint
    }

export class WatermarkListingTimeError extends Error {
  readonly observation: WatermarkOrderingObservation
}
```

- [ ] **Step 1: RED — page-cap checkpoint and resume**

Add tests proving a capped first chunk returns `kind: 'incomplete'`, unchanged `nextWatermark`, `resumeCursor` equal to the source `nextCursor`, pending maximum, and last observation. Add a second call with that checkpoint and assert the first request cursor equals the stored opaque cursor and completion promotes the accumulated pending watermark.

```ts
const first = await traverseWatermark({ adapter: firstAdapter, query, previousWatermark, maxPages: 1 })
expect(first).toMatchObject({
  kind: 'incomplete',
  nextWatermark: previousWatermark,
  possibleMiss: true,
  checkpoint: {
    resumeCursor: 'page-2',
    pendingWatermark: { boundaryTime: '2026-09-08T10:03:00.000Z', boundaryIds: ['n3'] },
  },
})
```

- [ ] **Step 2: RED — three-chunk monotonic progress and tie cases**

Add tests that record requested cursors across three invocations and expect `[null]`, `['page-2']`, `['page-3']`, plus maximum-time IDs accumulated across a chunk boundary and previous-boundary unseen IDs accumulated until completion.

- [ ] **Step 3: RED — ordering continuity and invalid listing time**

Add a resumed checkpoint whose `lastObservation` is newer than the resumed first item and assert normal progress; then use an item newer than the persisted observation and assert `WatermarkOrderingError`. Add `listTime: 'not-a-time'` cases to incremental and cold-start tests and assert `WatermarkListingTimeError` with the offending observation.

- [ ] **Step 4: Run focused RED**

Run through branch CI or local equivalent:

```bash
npx vitest run tests/unit/watermark-traversal.test.ts tests/unit/cold-start-traversal.test.ts
```

Expected: failures because checkpoint types/behavior and `WatermarkListingTimeError` do not exist.

- [ ] **Step 5: Implement minimal traversal state initialization**

`traverseWatermark` accepts `checkpoint?: WatermarkCatchupCheckpoint`. Initialize `cursor` from `checkpoint?.resumeCursor ?? null`, maximum state from `checkpoint.pendingWatermark` when present, and ordering state from `checkpoint.lastObservation` after validating its timestamp.

- [ ] **Step 6: Implement checked listing timestamps**

Create one helper that parses a listing observation and throws `WatermarkListingTimeError` when `Number.isFinite(Date.parse(listTime))` is false. Reuse the helper from cold-start traversal instead of duplicating unchecked parsing.

- [ ] **Step 7: Implement complete/incomplete results**

At a nonterminal page cap require `page.nextCursor !== null` and return `kind: 'incomplete'` with the replacement checkpoint. On boundary crossing or terminal source return `kind: 'complete'`, promote the accumulated watermark, and set `checkpoint: null`.

- [ ] **Step 8: Run focused GREEN and commit**

Run the same focused tests plus typecheck. Commit as `feat: add watermark catch-up traversal checkpoint`.

---

### Task 2: Persist checkpoint schema safely

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260909110000_watermark_catchup_checkpoint/migration.sql`
- Modify: `tests/prisma-schema-constraints.test.ts`
- Modify: `scripts/verify-postgres-compose.sh`

**Interfaces:** `MonitorCursor` gains `catchupCursor`, `catchupBoundaryTime`, `catchupBoundaryIds`, `catchupLastListTime`, `catchupLastListId`.

- [ ] **Step 1: RED schema/migration contract**

Add a schema test expecting all five fields. Update compose verification expectation from 3 to 4 completed migrations and add SQL probes for the new columns and CHECK constraints.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/prisma-schema-constraints.test.ts
```

Expected: schema field assertions fail.

- [ ] **Step 3: Modify Prisma schema**

Use exactly:

```prisma
catchupCursor       String?
catchupBoundaryTime DateTime?
catchupBoundaryIds  Json     @default("[]")
catchupLastListTime DateTime?
catchupLastListId   String?
```

- [ ] **Step 4: Add migration SQL**

Add nullable text/timestamp columns and non-null JSONB `catchupBoundaryIds DEFAULT '[]'::jsonb`. Add CHECK constraints enforcing: `(catchupCursor IS NULL) = (catchupBoundaryTime IS NULL)` and `(catchupLastListTime IS NULL) = (catchupLastListId IS NULL)`.

- [ ] **Step 5: GREEN migration verification**

Run Prisma generation/typecheck and the existing PostgreSQL compose integration script. Confirm migration deploy/reset both report 4 migrations and constraint probes pass. Commit as `feat: persist watermark catch-up checkpoint state`.

---

### Task 3: Complete vs incomplete monitor-run persistence

**Files:**
- Modify: `electron/worker/monitor-run-persistence.ts`
- Modify: `tests/integration/monitor-run-persistence.test.ts`
- Modify: `tests/integration/monitor-run-stale-config.test.ts`

**Interfaces:** replace persistence input `nextWatermark: Watermark` with `traversal: WatermarkTraversalResult` so persistence cannot accidentally advance a confirmed watermark for an incomplete result.

```ts
export interface MonitorRunPersistenceInput {
  monitorId: number
  startedAt: Date
  finishedAt: Date
  expectedCursorUpdatedAt: Date
  candidates: readonly Listing[]
  selected: readonly SelectedListing[]
  traversal: WatermarkTraversalResult
}
```

- [ ] **Step 1: RED partial commit integration test**

Create an incomplete traversal fixture with checkpoint `resumeCursor='page-2'`. After `commitMonitorRun`, assert Listings/Match exist, confirmed `boundaryTime/boundaryIds` remain old, catch-up fields match the checkpoint, `lastRunAt` advances, and Run has `outcome='catchup'`, `degradedLevel='watermark-catchup'`.

- [ ] **Step 2: RED completion/clear and rollback tests**

After refreshing `expectedCursorUpdatedAt`, commit a complete traversal and assert pending watermark promotion plus all checkpoint nullable fields cleared and `catchupBoundaryIds=[]`. Add a transaction-owned failure after cursor write and assert both confirmed watermark and checkpoint roll back together.

- [ ] **Step 3: Implement cursor write branching**

For `kind === 'incomplete'`, update only catch-up fields and `lastRunAt`; do not write confirmed boundary fields. For `kind === 'complete'`, write `nextWatermark` and clear all checkpoint fields.

- [ ] **Step 4: Implement Run branching**

Incomplete: `outcome='catchup'`, `degradedLevel='watermark-catchup'`. Complete: existing `outcome='success'`, `degradedLevel=null`. Seen/matched counts remain chunk-local.

- [ ] **Step 5: Preserve stale revision semantics**

Adapt stale-config fixture inputs to the new traversal field and prove stale commits still write nothing.

- [ ] **Step 6: GREEN integration and commit**

Run `KUFAR_POSTGRES_INTEGRATION=1 npx vitest run tests/integration/monitor-run-persistence.test.ts tests/integration/monitor-run-stale-config.test.ts` against the compose DB. Commit as `feat: commit watermark catch-up chunks atomically`.

---

### Task 4: Incremental orchestration resume and recovery

**Files:**
- Modify: `electron/worker/incremental-monitor-run.ts`
- Modify: `tests/unit/incremental-monitor-run.test.ts`
- Modify: `tests/unit/incremental-description-policy.test.ts`

**Interfaces:** persisted cursor select gains all catch-up fields; parse them into `WatermarkCatchupCheckpoint | undefined`.

- [ ] **Step 1: RED — persisted checkpoint is forwarded**

Mock a cursor containing a checkpoint and assert the first `traverseWatermark` call receives `checkpoint` with ISO strings restored from Date values and copied JSON boundary IDs.

- [ ] **Step 2: RED — one-shot fresh fallback**

Configure `traverseWatermark` to reject once during resumed traversal and resolve on the second call. Assert calls are `(checkpoint)` then `(checkpoint omitted)`, selector/description work happens only for the successful result, and exactly one commit occurs.

- [ ] **Step 3: RED — double failure does not commit**

Reject both calls with distinct errors. Assert the second/fresh error is propagated and `commitMonitorRun` is never called.

- [ ] **Step 4: RED — incomplete selection policy unchanged**

Return `kind:'incomplete'` with candidates and assert prefilter → description loader → selector ordering remains identical to complete traversal and persistence receives those selected candidates together with the incomplete traversal result.

- [ ] **Step 5: Implement checkpoint parser**

Treat `catchupCursor === null` as no checkpoint. When non-null require non-null `catchupBoundaryTime`, a string-array `catchupBoundaryIds`, and either both or neither last-observation fields; malformed persisted data throws a clear persisted-cursor error before network work.

- [ ] **Step 6: Implement resume/fallback helper**

Attempt `traverseWatermark({... checkpoint})`. Only when a persisted checkpoint was used and that attempt rejects, call `traverseWatermark` once more without checkpoint. Never mutate the database between attempts.

- [ ] **Step 7: Pass `traversal` into persistence**

Keep `candidates: traversal.newListings` and selected-list construction unchanged. `commitMonitorRun` receives the entire traversal result.

- [ ] **Step 8: GREEN unit suite and commit**

Run the incremental orchestration and description-policy files plus typecheck. Commit as `feat: resume persistent watermark catch-up`.

---

### Task 5: Reset semantics with checkpoint state

**Files:**
- Modify: `tests/integration/monitor-config-persistence.test.ts`

**Interfaces:** no production API change; existing whole-row cursor deletion is the mechanism.

- [ ] **Step 1: Add integration fixtures with populated checkpoint**

In `beforeEach`, create ordinary cursor state by default; for reset-specific tests first update it with all catch-up fields populated.

- [ ] **Step 2: Prove source/query reset removes checkpoint**

After `updateMonitorConfig` changes `sourceUrl` or canonical query, assert `monitorCursor.findUnique(...)` is null.

- [ ] **Step 3: Prove non-source edits preserve checkpoint**

Populate checkpoint, change only name/interval/keywords/searchInDescription/sellerType, and assert all checkpoint fields remain unchanged.

- [ ] **Step 4: Run GREEN integration and commit**

Run `tests/integration/monitor-config-persistence.test.ts` under PostgreSQL integration mode. No production change should be required; if the test exposes one, fix only the reset transaction. Commit as `test: cover catch-up checkpoint reset semantics`.

---

### Task 6: Remediation task card and final verification

**Files:**
- Create: `docs/tasks/1-4-4-watermark-catchup-checkpoint.md`
- Modify: `docs/epics/1-4-watermark.md`
- Refresh generated docs under `docs/operations/status/` with repository tooling.

- [ ] **Step 1: Create task 1.4.4**

Frontmatter: `phase: 1`, `epic: "1.4"`, `status: done`, `sync_state: aligned`, `depends_on: ["1.4.2", "1.4.3"]`, roles `[BACK, DB]`, tags including `core`, `idempotency`, `tdd`, `remediation`. Record review origin, checkpoint semantics, migration, one-shot fresh fallback, invalid-time validation, and exact RED/GREEN run SHAs/numbers.

- [ ] **Step 2: Update epic planned tasks**

Add `1.4.4 — Персистентный catch-up checkpoint` to the non-generated planned-task list; let `docs:ops:refresh` regenerate the rollup rather than hand-edit generated sections.

- [ ] **Step 3: Run documentation refresh/check**

```bash
npm run docs:ops:refresh
npm run docs:ops:check
```

Commit generated docs only after they reflect task 1.4.4 and already-completed 1.4.3 correctly.

- [ ] **Step 4: Fresh full verification on final head**

Require one exact-head GitHub Actions `verify` success covering documentation consistency, unit tests, CI failure self-check, typecheck, lint, formatting, PostgreSQL compose integration, build/output verification, development launch smoke, and production launch smoke.

- [ ] **Step 5: Review scope and open PR**

Compare branch against `main`. Expected scope is only watermark/checkpoint types and traversal, Prisma cursor migration, monitor-run/incremental orchestration, associated tests/scripts, design/plan/task/epic/generated docs. Open a PR to `main`; do not merge without explicit user authorization.

---

## Self-review

- Spec coverage: traversal progress, ties, cross-chunk ordering, invalid time, persistence atomicity, resume fallback, reset semantics, new listings during catch-up, and final verification all map to Tasks 1-6.
- Placeholder scan: no TBD/TODO/future implementation placeholders are used as execution instructions.
- Type consistency: the same `WatermarkCatchupCheckpoint` and discriminated `WatermarkTraversalResult` flow from traversal through orchestration into persistence; incomplete traversal never exposes a promotable `nextWatermark` beyond the confirmed value.
- Scope: scheduler overlap prevention, UI degraded state, matcher, Telegram, and cold-start redesign remain excluded.