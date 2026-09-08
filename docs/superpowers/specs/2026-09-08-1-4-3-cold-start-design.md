# Design — 1.4.3 Cold-start baseline

Status: approved for implementation on 2026-09-08.

## Context

Task `1.4.2` deliberately rejects an absent or uninitialized `MonitorCursor` with `ColdStartRequiredError`. That protects the incremental watermark algorithm from interpreting an existing source history as new listings, but leaves the first-run behavior to `1.4.3`.

The first monitor cycle must establish a bounded baseline without importing the full history of Kufar. It must still close a timestamp tie at the newest edge so that the second cycle cannot reclassify a listing from the same top timestamp as new merely because it was on the next page.

The network phase stays outside database transactions. The successful baseline is committed only after the traversal is known to be complete, and the commit revalidates the monitor source identity plus the cursor initialization state under the owning `Monitor` row lock.

## Goals

- Give future scheduler code one entrypoint, `runMonitorCycle`, that routes cold-start vs incremental behavior.
- Preserve `runIncrementalMonitor` as the specialized initialized-watermark path from `1.4.2`.
- Persist every unique listing from every baseline page that was actually read.
- Create no `Match` rows and no notification work on cold start.
- Establish a watermark at the newest observed `listTime`, including every observed ID tied at that exact instant.
- Bound the first traversal and read extra pages only when needed to close a top-time tie.
- Treat a capped, still-open top-time tie as incomplete and commit nothing.
- Make an empty first page establish a watermark at cold-start start time.
- Reject stale cold-start results after a source-reset edit or competing cursor initialization before any writes.
- Return `baselineCount` from the cold-start result and persist the same count as `Run.seen` with `Run.matched = 0`.

## Non-goals

- No scheduler wiring.
- No Telegram or renderer notification work.
- No monitor UI changes.
- No historical import beyond pages required to close the newest timestamp tie.
- No user option to send the existing baseline.
- No change to the incremental watermark algorithm from `1.4.1`/`1.4.2`.

## Public orchestration boundary

A new worker-level `runMonitorCycle(input)` is the future scheduler API.

It performs a cheap cursor-state read and routes normally:

- cursor absent or `boundaryTime = null` → `runColdStartMonitor`;
- initialized cursor → existing `runIncrementalMonitor`.

The router does not catch `ColdStartRequiredError` as normal control flow. Each specialized path still validates its own preconditions because monitor configuration can change concurrently after routing.

Cold-start success returns:

```ts
interface ColdStartMonitorRunResult {
  baselineCount: number
  pagesRead: number
  nextWatermark: Watermark
}
```

`runMonitorCycle` wraps this in a discriminated result so future callers can distinguish baseline establishment from an incremental result without inferring from counts.

## Cold-start traversal

`maxPages` is mandatory and must be an integer >= 1.

The first request always goes through the configured `SourceAdapter` with `cursor: null`. No direct Kufar HTTP call is introduced.

The traversal keeps a `Set<listId>` and persists only the first occurrence of a listing across pages. All unique listings from every page that is fetched are part of the baseline candidate set, including listings below the eventual watermark timestamp on the final tie-closing page.

### Non-empty first page

Let `maxTime` be the greatest `listTime` instant on the first page.

The baseline watermark is:

```ts
{
  boundaryTime: originalListTimeAtMax,
  boundaryIds: allUniqueIdsObservedAtMaxTime,
}
```

If the first page already contains any unique listing with `listTime < maxTime`, the top-time tie is closed on that page. No additional page is read even if `nextCursor` exists.

If every unique listing on the first page is at `maxTime`, traversal continues only while the tie remains open. Each next page is fetched through the adapter, added to the unique baseline set, and scanned for an item below `maxTime`.

The first page that contains a unique listing with `listTime < maxTime` closes the tie. The whole fetched page remains part of the baseline because it was actually read. If `nextCursor` becomes null while all observed listings are still tied at `maxTime`, end-of-results also closes the tie safely.

Source ordering remains a correctness assumption. The cold-start traversal enforces the same non-increasing `listTime` observation rule as incremental traversal; an increase after an older observation is an ordering error rather than a reason to guess a watermark.

### Empty first page

An empty first page completes immediately with:

```ts
{
  boundaryTime: startedAt.toISOString(),
  boundaryIds: [],
}
```

`baselineCount = 0` and `pagesRead = 1`.

This means the first listing published after the rule's empty cold start is newer than the watermark on the next cycle and is not swallowed as baseline.

### Page cap

If `maxPages` is reached while every observed unique listing is still tied at `maxTime` and the last page has a non-null `nextCursor`, the baseline is incomplete.

The cold-start path throws a typed incomplete-baseline error and does **not** enter the persistence transaction. Therefore it changes none of:

- `Listing`;
- `Match`;
- `MonitorCursor`;
- success `Run`.

A later cycle can retry from a clean uninitialized state.

## Cold-start persistence transaction

Before network work, the orchestration snapshots:

- monitor source identity using the same source-reset semantics as monitor config persistence (`sourceUrl`, canonical query, and the relevant monitor state transition semantics);
- cursor initialization state:
  - `missing`, or
  - `uninitialized` with its `updatedAt` revision.

After traversal completes, one short interactive Prisma transaction performs:

1. `SELECT ... FOR UPDATE` on the owning `Monitor` row.
2. Reload and validate the current source identity.
3. Reload the current cursor and require the same uninitialized state:
   - expected missing → cursor must still be absent;
   - expected uninitialized → cursor must still have `boundaryTime = null` and the same `updatedAt` revision.
4. Upsert all baseline `Listing` rows.
5. Create/update `MonitorCursor` with the new watermark and `lastRunAt = finishedAt`.
6. Create a minimal successful `Run` with `seen = baselineCount`, `matched = 0`.
7. Commit.

No `Match` rows are created in this transaction.

The stale precondition is checked before any baseline write. If a source edit wins the monitor-row lock first, the cold-start commit observes the changed identity and aborts. If another cold start initializes the cursor first, the later commit observes a different initialization state and aborts. In both cases no baseline listing or success run from the stale result is committed.

If the cold-start transaction commits first and a source edit occurs afterward, the edit remains authoritative: the existing `1.4.2` monitor config writer resets the cursor as designed.

## Listing and Run semantics

Cold start uses the same `Listing` upsert mapping as incremental persistence. Existing `firstSeenAt` values are preserved on update.

For a successful baseline:

- `Listing`: one row per unique observed `listId` from fetched baseline pages;
- `Match`: zero new rows;
- `MonitorCursor.boundaryTime`: newest baseline time, or `startedAt` for an empty first page;
- `MonitorCursor.boundaryIds`: all observed IDs at the newest baseline time, or `[]` for empty baseline;
- `MonitorCursor.lastRunAt`: `finishedAt`;
- `Run.outcome`: `success`;
- `Run.seen`: `baselineCount`;
- `Run.matched`: `0`.

This keeps notifications strictly on the second and later initialized cycles.

## Failure semantics

Before persistence, adapter errors, invalid traversal configuration, source ordering errors, or an incomplete top-time tie produce no database writes from cold start.

During persistence, a stale source/cursor precondition or any database failure rolls back all baseline Listing/Cursor/Run writes together.

There is no supported successful state where only part of the baseline is written, where a success run exists without its cursor, or where cold start creates matches.

## Acceptance mapping

- Creating a rule does not notify existing listings: cold start never creates `Match`.
- Existing listings remain available in the database: all unique listings on fetched baseline pages are upserted.
- The second traversal emits only genuinely new items: cold start installs the newest complete top-edge watermark, including cross-page timestamp ties.
- UI can later show the accepted baseline count: the result exposes `baselineCount` and the successful `Run` records the same value in `seen`.
