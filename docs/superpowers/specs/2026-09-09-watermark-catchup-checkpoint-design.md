# Persistent Watermark Catch-up Checkpoint Design

## Problem

The incremental watermark traversal is safe at the page cap but does not make eventual progress. When `maxPages` is exhausted before the previous watermark boundary is reached, the current implementation returns already-read candidates with `possibleMiss: true` while keeping the confirmed watermark unchanged. The next cycle starts from the top again, so a sufficiently deep gap can remain permanently unreachable.

The remediation must preserve the existing core guarantee from tasks 1.4.1 and 1.4.2: the confirmed watermark must never advance beyond uncommitted matches. It must also preserve cold-start behavior from 1.4.3.

## Goals

- Make a page-capped incremental traversal converge across multiple monitor cycles instead of restarting from the top forever.
- Keep the confirmed watermark unchanged until the old boundary has actually been reached.
- Persist already-processed candidates and catch-up progress atomically.
- Continue to treat the marketplace pagination cursor as opaque data; never decode or synthesize it.
- Recover safely when a persisted marketplace cursor can no longer be resumed.
- Reject invalid `Listing.listTime` values explicitly instead of letting `NaN` flow through ordering comparisons.
- Preserve existing selection, description-loading, idempotent `Match`, and cold-start semantics.

## Non-goals

- No scheduler-level overlap prevention; that remains task 2.4.2.
- No user-facing degraded-state UI in this change. The run record and `possibleMiss` remain the observability boundary for now.
- No change to cold-start baseline semantics or notification policy.
- No interpretation of marketplace cursors and no attempt to manufacture a cursor from `listTime`.
- No keyword matcher work.

## Existing invariants to preserve

1. `MonitorCursor.boundaryTime` plus `boundaryIds` is the last fully confirmed watermark.
2. A confirmed watermark is advanced in the same database transaction as `Listing`, `Match`, and `Run` writes.
3. `Match` remains idempotent through the existing unique `(monitorId, listingId)` constraint.
4. Source/query reset deletes `MonitorCursor`; therefore any catch-up progress tied to that cursor must disappear with it.
5. Description fetch failures happen before the monitor-run commit and therefore cannot advance either the confirmed watermark or catch-up progress.

## Data model

Extend `MonitorCursor` rather than create a separate table. This keeps catch-up progress under the existing `updatedAt` revision check and under the same monitor row lock used by `commitMonitorRun`.

```prisma
model MonitorCursor {
  monitorId           Int      @id
  boundaryTime        DateTime?
  boundaryIds         Json
  lastRunAt           DateTime?
  catchupCursor       String?
  catchupBoundaryTime DateTime?
  catchupBoundaryIds  Json     @default("[]")
  catchupLastListTime DateTime?
  catchupLastListId   String?
  updatedAt           DateTime @updatedAt
  monitor             Monitor  @relation(fields: [monitorId], references: [id], onDelete: Cascade)
}
```

`catchupCursor == null` means no checkpoint exists. When `catchupCursor` is non-null, `catchupBoundaryTime` is also non-null and `catchupBoundaryIds` contains the tentative watermark that may be promoted only after the old confirmed boundary is reached.

`catchupLastListTime` and `catchupLastListId` are either both null or both non-null. They preserve ordering continuity across chunk boundaries. The migration adds SQL `CHECK` constraints for these tuple invariants.

`catchupBoundaryIds` is non-nullable JSON with an empty-array default. This avoids Prisma's database-NULL versus JSON-null ambiguity for nullable JSON fields while still allowing the checkpoint itself to be absent through `catchupCursor`.

## Runtime types

Add a shared checkpoint value:

```ts
export interface WatermarkCatchupCheckpoint {
  resumeCursor: string
  pendingWatermark: Watermark
  lastObservation: {
    listId: string
    listTime: string
  } | null
}
```

Change `WatermarkTraversalResult` into a discriminated union while retaining the existing `possibleMiss` field for compatibility:

```ts
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
```

For `kind: 'incomplete'`, `nextWatermark` remains the confirmed previous watermark. The tentative future watermark lives only inside `checkpoint.pendingWatermark`.

## Traversal algorithm

`traverseWatermark` accepts an optional checkpoint in addition to the confirmed previous watermark.

Without a checkpoint it behaves as today: start at the top with `cursor = null` and collect candidates newer than the confirmed watermark.

With a checkpoint:

- start from `checkpoint.resumeCursor`;
- initialize the running maximum and its boundary IDs from `checkpoint.pendingWatermark`;
- initialize ordering continuity from `checkpoint.lastObservation`;
- continue comparing listings against the original confirmed watermark, not against the pending watermark;
- stop only after crossing the confirmed boundary or exhausting the source;
- if the page cap is hit first, return a replacement checkpoint with the next opaque cursor, the accumulated pending watermark, and the last observed listing.

The checkpoint therefore represents unfinished work against one confirmed watermark. It is not itself a new confirmed watermark.

### Ties at the maximum

Boundary IDs at the tentative maximum are accumulated across chunks. If the maximum timestamp tie spans a page-cap boundary, the resumed chunk adds unseen IDs at the same timestamp to `pendingWatermark.boundaryIds`.

### Ties at the previous boundary

Listings at the confirmed boundary timestamp remain candidates only when their IDs are absent from the confirmed `boundaryIds`. If there were no newer timestamps at all, the pending watermark remains at the confirmed timestamp and accumulates newly observed boundary IDs across chunks. Once the tie is fully closed, that union becomes the promoted confirmed watermark.

If newer timestamps were seen, the future watermark is already newer than the old boundary and extra old-boundary IDs do not need to be retained after completion.

### Duplicate overlap between cursors

The in-memory `seenIds` set remains chunk-local. A marketplace cursor may overlap a previously processed page, so a listing can be re-selected on resume. Correctness remains idempotent because `Listing` uses upsert, `Match` has a unique `(monitorId, listingId)` key, and description loading uses the existing persistent cache. This design intentionally avoids persisting an unbounded set of all IDs seen during catch-up.

## Invalid listing time

Add `WatermarkListingTimeError`, carrying the offending listing observation. Every `Date.parse(listTime)` result is checked with `Number.isFinite` before it participates in ordering or watermark comparisons.

Use the same validation in incremental and cold-start traversal so both paths reject malformed source timestamps consistently.

## Persistence semantics

`commitMonitorRun` receives either complete or incomplete traversal progress.

### Incomplete chunk

In one existing interactive Prisma transaction:

1. lock the monitor and verify the expected `MonitorCursor.updatedAt` revision;
2. persist candidate `Listing` rows;
3. upsert selected `Match` rows;
4. leave `boundaryTime` and `boundaryIds` unchanged;
5. replace all catch-up checkpoint fields with the new checkpoint;
6. update `lastRunAt`;
7. write a `Run` with `outcome = 'catchup'` and `degradedLevel = 'watermark-catchup'`.

The cursor row update changes `updatedAt`, so a concurrent stale chunk cannot overwrite newer catch-up progress.

### Complete chunk

In the same transaction shape:

1. persist candidates and matches;
2. promote `nextWatermark` into `boundaryTime` and `boundaryIds`;
3. clear `catchupCursor`, `catchupBoundaryTime`, `catchupLastListTime`, and `catchupLastListId` and reset `catchupBoundaryIds` to `[]`;
4. update `lastRunAt`;
5. write a normal successful `Run`.

If any persistence step fails, neither confirmed watermark nor checkpoint progress changes.

## Resume recovery policy

The current `SourceAdapter` intentionally exposes only `fetchPage()` and has no typed "cursor expired" error. Therefore recovery must not require adapter-specific cursor introspection.

When an incremental cycle starts with a persisted checkpoint:

1. attempt the resumed traversal once;
2. if the resumed attempt fails before producing a traversal result, retry the logical cycle once from the top using the same confirmed watermark and ignoring the checkpoint in memory;
3. if the fresh traversal succeeds, its normal commit atomically replaces the stale checkpoint with a new checkpoint or clears it on completion;
4. if the fresh traversal also fails, propagate the fresh failure and perform no database commit, leaving the old checkpoint available for a later retry.

This handles an expired opaque cursor without adding a new adapter API and remains safe for transient source failures. There is no pre-emptive database deletion of the checkpoint.

Ordering or invalid-time failures on a resumed path follow the same one-shot fresh restart rule. If the fresh top traversal still violates the source invariant, the error is propagated and no progress is committed.

## New listings arriving during catch-up

The checkpoint's pending watermark represents the top of the feed observed when that catch-up chain began. Newer listings that arrive while deeper chunks are being processed do not invalidate the chain. After the old confirmed boundary is finally reached and the pending watermark is promoted, the next ordinary cycle starts from the top and collects timestamps newer than the promoted watermark plus unseen IDs tied exactly at that watermark timestamp.

This guarantees eventual catch-up without requiring a frozen marketplace snapshot.

## Reset semantics

Existing config persistence deletes the whole `MonitorCursor` when source identity changes or an archived monitor is reactivated. Because checkpoint fields live on the same row, source reset automatically discards stale catch-up state and routes the next monitor cycle through the existing cold-start path.

No extra reset code is required beyond schema-aware tests proving this behavior.

## Test strategy

### Pure traversal tests

- page cap returns `kind: 'incomplete'`, unchanged confirmed `nextWatermark`, and a checkpoint containing the next opaque cursor;
- a second traversal with that checkpoint starts at the stored cursor and completes against the original confirmed watermark;
- a gap requiring three or more chunks makes monotonic progress instead of rereading page 1;
- maximum timestamp ties accumulate IDs across chunk boundaries;
- old-boundary ties are processed completely across chunk boundaries;
- ordering is validated across chunk boundaries using the persisted last observation;
- invalid `listTime` throws `WatermarkListingTimeError` in incremental and cold-start traversal;
- existing source errors on a non-resumed traversal still preserve their current identity.

### Orchestration tests

- incomplete traversal processes selector/description policy before commit exactly like a normal chunk;
- incomplete commit leaves the confirmed watermark unchanged and persists checkpoint data;
- the next run reads and resumes the checkpoint;
- completion promotes the pending watermark and clears the checkpoint;
- resumed traversal failure triggers exactly one fresh-from-top attempt;
- if the fresh attempt also fails, no commit occurs;
- stale cursor revision still rejects the whole commit.

### PostgreSQL integration tests

- partial chunk atomically persists `Listing`, `Match`, `Run`, and checkpoint while keeping the old confirmed watermark;
- a later chunk resumes and atomically promotes/clears checkpoint state;
- an injected transaction failure leaves both watermark and checkpoint unchanged;
- source/query reset deletes a cursor containing a checkpoint and the next cycle is cold start.

## Documentation

Add remediation task `1.4.4` under epic 1.4. The task records the review origin, TDD sequence, migration, catch-up semantics, and final verification run. Existing tasks 1.4.1-1.4.3 remain done; this is a follow-up gap discovered by phase review rather than a retroactive rewrite of their original acceptance criteria.

## Delivery boundary

This change is complete when a page-capped gap can be processed across multiple persisted cycles and eventually advances the confirmed watermark only after the old boundary is reached, with fresh unit, PostgreSQL integration, typecheck, lint, formatting, build, development smoke, and production smoke verification on the final branch head.
