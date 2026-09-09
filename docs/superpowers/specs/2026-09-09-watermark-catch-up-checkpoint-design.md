# Persistent Watermark Catch-up Checkpoint Design

## Problem

The incremental watermark traversal currently stops at `maxPages` with `possibleMiss: true`, returns candidates already read, and deliberately keeps the stable watermark unchanged. The next run starts from the top again. If the old boundary remains deeper than `maxPages`, the gap never shrinks and the monitor can remain permanently stalled after sleep, downtime, or a burst of listings.

## Decision

Use a persistent catch-up checkpoint. The stable `MonitorCursor.boundaryTime/boundaryIds` remains the last fully closed watermark. An incomplete traversal stores an opaque resume cursor plus enough state to continue the same logical traversal on the next monitor run. Partial Listing/Match writes are allowed and remain idempotent, but the stable watermark advances only when the old boundary is fully crossed or the source is exhausted.

## Traversal contract

`shared/watermark.ts` gains a discriminated traversal result and a checkpoint value:

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

export type WatermarkTraversalResult =
  | {
      status: 'complete'
      newListings: Listing[]
      nextWatermark: Watermark
      pagesRead: number
      possibleMiss: false
      checkpoint: null
    }
  | {
      status: 'incomplete'
      newListings: Listing[]
      nextWatermark: Watermark
      pagesRead: number
      possibleMiss: true
      checkpoint: WatermarkCatchUpCheckpoint
    }
```

`traverseWatermark` accepts an optional checkpoint. Without one, pagination starts at the source top. With one, the first request uses the checkpoint `resumeCursor`; source cursors remain opaque and are never decoded or treated as a watermark.

The checkpoint `pendingWatermark` is the maximum listing time observed since this catch-up session started, with all IDs observed at that exact time. It is initialized to the stable previous watermark, so empty pages are representable without nullable high-watermark state. On completion, `pendingWatermark` becomes the new stable watermark. On an incomplete chunk, `nextWatermark` remains the old stable watermark and only the checkpoint advances.

`pagesRead` inside the checkpoint is cumulative across catch-up chunks and is used to preserve ordering diagnostics across process restarts. The result `pagesRead` remains the number of pages read by the current invocation.

## Ordering and malformed timestamps

A resumed traversal seeds its ordering guard with `checkpoint.lastObservation`, so a page that becomes newer than the previous chunk is detected instead of silently accepted.

Every listing `listTime` is parsed through one finite-time guard before ordering or watermark calculations. Invalid timestamps raise a typed `WatermarkListingTimeError`; `NaN` is never allowed into comparison state. Cold-start traversal reuses the same guard.

If a resumed traversal fails because the persisted source cursor is no longer usable, it raises a typed catch-up resume error. A resumed ordering violation is also considered an invalid continuation. The orchestration layer atomically discards that checkpoint and bumps the cursor revision before rethrowing. The next scheduled run restarts safely from the unchanged stable watermark. Generic first-pass source failures and malformed listing data do not mutate watermark state.

## Persistence model

Use a separate one-to-one table rather than nullable checkpoint columns on `MonitorCursor`:

```prisma
model MonitorCursor {
  monitorId         Int                       @id
  boundaryTime      DateTime?
  boundaryIds       Json
  lastRunAt         DateTime?
  updatedAt         DateTime                  @updatedAt
  monitor           Monitor                   @relation(fields: [monitorId], references: [id], onDelete: Cascade)
  catchUpCheckpoint MonitorCatchUpCheckpoint?
}

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

The SQL migration adds a foreign key with `ON DELETE CASCADE`, `pagesRead >= 1`, and an all-null/all-present check for the four `last*` observation columns. Deleting `MonitorCursor` because `sourceUrl`, parsed query, or archived-state reset semantics changed therefore deletes the checkpoint automatically.

## Transaction boundary

The existing monitor-run transaction remains authoritative:

1. lock the monitor and validate `MonitorCursor.updatedAt`;
2. upsert Listing and Match rows for the current chunk;
3. update `MonitorCursor` — same stable watermark for incomplete chunks, completed watermark otherwise, always updating `lastRunAt` and therefore the revision;
4. upsert the checkpoint for an incomplete result, or delete it for a complete result;
5. insert the Run row.

Incomplete chunks keep `outcome: 'success'` for compatibility but set `degradedLevel: 'watermark-catch-up'`. A complete run uses `degradedLevel: null`.

Because `Match` is unique on `(monitorId, listingId)`, replaying a chunk after a process/network failure is safe. Description loading and selection may repeat for the replayed chunk, but stable state cannot skip it.

## Concurrency

Each partial commit updates `MonitorCursor`, so `updatedAt` changes. Two runs that read the same cursor revision cannot both commit. Checkpoint discard after an invalid resume also locks the monitor, validates the expected cursor revision, deletes the checkpoint, and updates `lastRunAt` so the cursor revision changes.

## New-listing correctness while catching up

New listings can appear above the traversal while the checkpoint resumes deeper pages. They are not lost: the pending watermark remains anchored at the maximum observed when the catch-up started. After the old gap closes and that pending watermark becomes stable, the next normal run starts from the top and classifies any newer listings against it.

## Scope boundaries

This remediation does not implement a scheduler, user-facing warning UI, seller filtering, keyword matching, or notification delivery. It does not change cold-start baseline semantics. It does not persist or interpret marketplace cursors outside an active incomplete catch-up checkpoint.
