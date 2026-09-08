# Design — 1.4.2 Watermark persistence and transaction boundary

Status: approved in chat on 2026-09-08; pending written-spec review.

## Context

Task `1.4.1` now provides a pure multi-page watermark traversal over `SourceAdapter`. It returns a successful `WatermarkTraversalResult` containing deduplicated `newListings`, a monotonic `nextWatermark`, `pagesRead`, and `possibleMiss`. It deliberately does not access Prisma or persist state.

Task `1.4.2` adds the database boundary around that algorithm. Its core guarantee is that accepted matches and the watermark that makes those listings old on the next run are committed atomically. A process crash must never leave the database in a state where the watermark advanced but the corresponding `Match` rows were lost.

The repository already has Prisma models for `Monitor`, `MonitorCursor`, `Run`, `Listing`, and `Match`, including `@@unique([monitorId, listingId])`. The data-model specification also defines when a monitor cursor must be reset.

This design keeps network traversal and filtering outside the database transaction. The Prisma transaction contains only short database writes.

## Goals

- Connect the completed watermark traversal to Prisma persistence.
- Persist listings, accepted matches, the next watermark, and one minimal successful `Run` record atomically.
- Make a repeated run idempotent through existing database uniqueness, not through timing assumptions.
- Keep the future matcher replaceable without changing the transaction boundary.
- Reset the persisted watermark when the monitor source identity changes.
- Preserve the watermark for monitor edits that do not change the source identity.
- Keep marketplace pagination cursors local to one traversal and never persist them.
- Prove rollback behavior against real Postgres integration tests.

## Non-goals

- No cold-start behavior. An absent or uninitialized `MonitorCursor` is owned by `1.4.3`.
- No notifications or Telegram work.
- No real keyword/seller matcher. The current selector accepts every incremental candidate.
- No scheduler or overlap handling.
- No full `Run` lifecycle. Creating a run before network work, persisting errors, overlap skips, and degradation metadata remain owned by `2.4.3`.
- No health aggregation.
- No persistence of Kufar pagination cursors.
- No speculative repository framework or generic unit-of-work abstraction.

## Existing contracts

`1.4.1` exposes JSON-friendly watermark domain types:

```ts
interface Watermark {
  boundaryTime: string
  boundaryIds: readonly string[]
}

interface WatermarkTraversalResult {
  newListings: Listing[]
  nextWatermark: Watermark
  pagesRead: number
  possibleMiss: boolean
}
```

The persisted Prisma cursor shape is equivalent at the domain boundary:

- `MonitorCursor.boundaryTime` ↔ `Watermark.boundaryTime`
- `MonitorCursor.boundaryIds` ↔ `Watermark.boundaryIds`

`MonitorCursor.boundaryTime` is nullable in the database schema because the schema predates the runtime algorithm. For incremental traversal, both a missing cursor row and a row with `boundaryTime = null` mean that no usable watermark exists yet; both enter the `1.4.3` cold-start boundary. A non-null boundary with malformed `boundaryIds` is persisted-state corruption and must fail explicitly rather than silently becoming a cold start.

`MonitorCursor.lastRunAt` is runtime metadata and is written at successful commit time. It is not part of the watermark comparison algorithm.

`CanonicalQuery` has explicit fields (`host`, `category`, `query`, `region`, `sellerType`, `sort`, `operation`, `pathFilters`, `extraParams`) and is already the parsed source identity stored in `Monitor.query`.

## Architecture

The implementation has three narrow responsibilities.

### 1. Incremental orchestration

A worker-level orchestration function coordinates one non-cold-start monitor run:

1. Load the monitor configuration and existing `MonitorCursor`.
2. If the cursor row is absent or `boundaryTime` is null, stop with a typed `ColdStartRequired` result/error; do not interpret absence as “everything is new”. `1.4.3` will own that branch.
3. Validate persisted `boundaryIds` as an array of strings and convert the cursor into a `Watermark`.
4. Call `traverseWatermark(...)` outside any Prisma transaction.
5. Pass each returned candidate through the injected selection seam, also outside the transaction.
6. Commit the successful traversal result plus selected matches through the persistence transaction.

Source/network errors, malformed persisted cursor state, selector failures, and watermark ordering/configuration errors occur before any database commit. They do not produce a partial persistence result in `1.4.2`.

### 2. Persistence transaction

A dedicated persistence component accepts already collected data and performs one interactive Prisma transaction:

```ts
prisma.$transaction(async (tx) => {
  await persistListingsAndMatches(tx, input)
  await persistMonitorCursor(tx, input)
  await persistSuccessfulRun(tx, input)
})
```

These are focused database-step functions, not independent transactions. Production composes them inside one transaction. Their separation makes the dangerous boundaries directly testable with a real transaction by throwing a sentinel between steps, without adding production fault-injection hooks.

The transaction callback performs no HTTP requests, pagination, description fetching, or matching work.

Prisma 7 interactive transactions are the required mechanism because throwing from the callback rolls back the preceding writes in the same callback.

### 3. Monitor configuration writer with cursor-reset policy

Cursor reset belongs to the write path that changes a monitor’s persisted configuration, not to the next traversal as a heuristic.

A small monitor-config persistence function updates `Monitor` and, in the same database transaction, deletes `MonitorCursor` when the edit changes the source identity.

It does not implement renderer/IPC/UI behavior; later monitor CRUD code can call this persistence boundary.

## Selection seam

The seam must carry the future `Match` payload rather than a bare boolean so epic `2.2` can replace only the selector.

Logical contract:

```ts
interface MatchSelection {
  matchedTerms: readonly string[]
  matchedIn: readonly string[]
  snippet: string | null
}

interface CandidateSelector {
  select(listing: Listing): Promise<MatchSelection | null>
}
```

The `1.4.2` default selector accepts every incremental candidate and returns:

```ts
{
  matchedTerms: [],
  matchedIn: [],
  snippet: null,
}
```

Selection happens before the transaction. A selector failure therefore prevents the persistence transaction from starting and leaves the previous watermark intact.

## Listing persistence

Every listing returned in `WatermarkTraversalResult.newListings` is persisted, regardless of whether the selector accepts it. This separates “observed incremental candidate” from “matched rule”.

Each `Listing` is upserted by `listId`.

The domain-to-Prisma mapping is explicit:

- `listTime` is already source-validated but is converted to `Date` for the Prisma `DateTime` column;
- `priceAmount` remains exact decimal text and is passed to Prisma/Decimal without converting through JavaScript `number`;
- `raw` is persisted as JSON;
- nullable normalized fields remain nullable rather than being synthesized.

On create, all normalized listing fields are written and `firstSeenAt` uses the database default.

On update, normalized mutable listing fields and `raw` are refreshed, but `firstSeenAt` is never overwritten.

No second deduplication algorithm is needed in persistence: `1.4.1` already returns candidates deduplicated by first occurrence within one traversal, and `Listing.listId` is the database primary key.

## Match persistence and idempotency

For every selected candidate, persistence writes one `Match` identified by the existing unique key `(monitorId, listingId)`.

A repeated traversal of the same data must not create a second `Match`. The implementation should use the existing uniqueness directly through an idempotent Prisma write (`upsert` or an equivalent conflict-safe operation). At the expected scale of roughly five monitors, simple per-row writes are preferred over bulk machinery.

For an already existing `Match`, `notifiedAt` must not be cleared. The current task should also avoid overwriting richer future matcher metadata unnecessarily once later epics populate it. The minimal safe policy is:

- create the row when it does not exist;
- when it already exists, leave the existing row unchanged.

This makes retry behavior monotonic and avoids turning persistence idempotency into an implicit rematch/update feature.

## Watermark persistence

The transaction upserts `MonitorCursor` for the monitor using `result.nextWatermark`.

`boundaryIds` are stored as JSON using the same ordered string array returned by `1.4.1`.

`lastRunAt` is set to the successful commit timestamp supplied by the orchestration layer or captured once immediately before entering the transaction. The same timestamp is reused for the minimal successful `Run.finishedAt` where practical so one commit has one logical completion instant.

`possibleMiss=true` is not a reason to synthesize another watermark. `1.4.1` already guarantees that `nextWatermark` equals the previous watermark for an incomplete catch-up. Persistence stores exactly that returned watermark while still safely recording candidates already observed above the page cap.

## Minimal Run record in 1.4.2

Task `1.4.2` explicitly requires a `Run` write inside the transaction, while task `2.4.3` later owns the full run journal lifecycle.

Therefore this task writes only a minimal successful commit record after traversal has already completed successfully:

- `monitorId`
- `startedAt` supplied by the orchestration call
- `finishedAt` successful commit timestamp
- `outcome = "success"`
- `seen` = `result.newListings.length`
- `matched` = number of candidates accepted by the selector
- `error = null`
- `httpStatus = null`
- `degradedLevel = null`

`pagesRead` and `possibleMiss` are not added to the schema in this task. User-facing/health reporting for incomplete catch-up remains outside this persistence increment unless a later owned schema already provides a field.

In `2.4.3`, the orchestration can be evolved to create a `Run` before network work and update that row at completion/error. That later change must preserve the atomic rule that the successful result fields and watermark are finalized together with successful match persistence.

## Transaction ordering

The transaction body uses an explicit, reviewable order:

1. Upsert each candidate `Listing`.
2. Create/idempotently preserve each selected `Match`.
3. Upsert `MonitorCursor` with the returned watermark and `lastRunAt`.
4. Create the minimal successful `Run` row.
5. Return from the interactive transaction callback, allowing Prisma/Postgres to commit.

The correctness guarantee does not rely on this exact order because all four steps are in one transaction, but placing the watermark after Listing/Match writes makes the dangerous state transition visually explicit in code and easier to test/review.

If any operation throws, the callback throws and all writes in that transaction roll back.

## Failure semantics

### Failure before transaction

Examples:

- source adapter failure;
- malformed persisted cursor state;
- watermark ordering/configuration error;
- selector failure.

Result: no Listing/Match/Cursor/Run commit from this task. The previous persisted watermark remains unchanged.

### Failure during transaction

Any Prisma/database failure rolls back Listing, Match, MonitorCursor, and the minimal successful Run together.

There is no supported state where the new cursor is committed while its selected Match rows are absent.

### Process interruption after commit

Once Postgres commits successfully, the entire persistence unit is durable. Re-running the same source is safe because the watermark has advanced consistently and the Match uniqueness prevents duplicates.

## Cursor-reset policy

The reset decision is based on persisted monitor configuration before and after one edit.

Reset `MonitorCursor` when:

- `sourceUrl` changes;
- the parsed canonical `query` changes;
- monitor state changes from `archived` to `active`.

Preserve `MonitorCursor` when only these fields change:

- `name`;
- `intervalSec`;
- `keywords`;
- `searchInDescription`;
- seller filter fields, including `sellerType`, when the persisted canonical source query itself is unchanged;
- state changes that are not `archived → active`, unless another later task defines a stronger rule.

The source-identity comparison must be structural over the `CanonicalQuery` domain, not dependent on JSON object property insertion order. Scalar fields compare directly. `pathFilters` order and each `extraParams` value-array order remain meaningful because they are part of the canonical parsed representation; `extraParams` object key order itself is not meaningful and is compared by key/value content.

Monitor update and cursor deletion happen in one short Prisma transaction. A failed monitor update must not delete the cursor, and a failed cursor deletion must roll back the monitor update.

No traversal attempts to infer whether the source changed by comparing new listings with old watermark state.

## Cold-start boundary

`1.4.2` must not invent cold-start notification behavior.

If no `MonitorCursor` exists, or if its `boundaryTime` is null, incremental orchestration exits through a typed cold-start boundary before calling `traverseWatermark`, because `1.4.1` requires an existing watermark.

Task `1.4.3` will add the separate first-run flow that records baseline `Listing` rows and establishes the initial watermark without producing `Match` rows for existing listings.

The cursor-reset writer in this task intentionally deletes the cursor. That deletion therefore causes the next run to enter the `1.4.3` cold-start path once that task is implemented.

## Concurrency boundary

Task `2.4.2` later owns “no overlapping runs”. `1.4.2` does not add advisory locks, serializable retry loops, or scheduler locks preemptively.

At the current stage, correctness is defined for one persistence attempt per monitor at a time. Database uniqueness still protects duplicate `Match` rows if a retry occurs, but concurrency control is not broadened here.

## Integration test strategy

Transaction guarantees must be tested against the real Postgres service used by CI, not only mocks.

No production-only `testHook`, fault-injection flag, or callback is added.

Production composes the same focused DB-step functions inside one interactive transaction. Integration tests open an interactive transaction and invoke those same steps in the same order, inserting a sentinel throw at a chosen boundary. Because the throw occurs before the interactive transaction callback returns, real Postgres must roll back all preceding steps.

Required integration cases:

1. **Successful commit** — Listing, Match, MonitorCursor, and Run all appear together.
2. **Repeat same result** — no second Match is created; cursor remains valid; a second successful Run may be recorded because it represents a distinct completed attempt.
3. **Rollback before persistence steps** — throwing before writes leaves all tables unchanged.
4. **Rollback after Listing/Match step** — execute `persistListingsAndMatches`, throw sentinel, then assert those writes disappeared and the old cursor remained.
5. **Rollback after Cursor step** — execute Listing/Match and Cursor steps, throw sentinel before Run/callback completion, then assert both the advanced cursor and preceding rows rolled back.
6. **Rollback after Run step but before callback return** — execute all steps, throw sentinel, then assert no part of the would-be successful commit survived.
7. **Process-equivalent retry after rollback** — re-running the same persistence input succeeds and creates the expected rows once.
8. **`possibleMiss=true`** — observed candidates may persist, but the stored watermark remains exactly the previous watermark returned by `1.4.1`.
9. **Source identity edit** — changing `sourceUrl` deletes `MonitorCursor` atomically.
10. **Canonical query edit** — structural query change deletes `MonitorCursor` atomically.
11. **Non-source edits** — interval/name/keywords/search-description/seller-only edits preserve the cursor.
12. **Unarchive** — `archived → active` deletes the cursor.
13. **Monitor edit rollback** — forced failure after the Monitor update but before callback completion preserves both old Monitor fields and its cursor.

Focused unit tests should cover persisted cursor decoding/validation, structural query comparison, and cursor-reset decision logic without Postgres where useful. Database atomicity remains an integration-test responsibility.

## Suggested implementation surface

Keep the files narrow and worker-oriented. Exact names may be adjusted to existing repository conventions during the implementation plan, but the responsibilities should remain:

- `electron/worker/monitor-run-persistence.ts` — persistence input types, focused DB-step functions, interactive transaction wrapper.
- `electron/worker/incremental-monitor-run.ts` — orchestration around existing cursor → traversal → selector → persistence.
- `electron/worker/monitor-config-persistence.ts` — monitor update plus cursor-reset policy.
- `tests/integration/monitor-run-persistence.test.ts` — real Postgres atomicity/idempotency coverage.
- focused unit tests for cursor decoding and reset-policy/query identity helpers.

Reuse `shared/watermark.ts`, `shared/listing.ts`, `shared/canonical-query.ts`, and the generated Prisma types rather than duplicating domain shapes.

## Ownership boundaries after 1.4.2

- `1.4.1`: traversal, novelty classification, deduplication, ordering guard, page-cap semantics, next watermark computation.
- `1.4.2`: non-cold-start persistence orchestration, selector seam, Listing/Match/Cursor/minimal-success-Run atomic commit, source-identity cursor reset.
- `1.4.3`: first run / cold-start baseline and suppression of initial Match rows.
- `2.2`: replace accept-all selector with real matching logic and richer Match payload.
- `2.4.2`: prevent overlapping monitor runs.
- `2.4.3`: full Run journal lifecycle, error/skip/degradation recording.
- source layer: HTTP/fallback/schema/degradation classification.
- notification layer: delivery and notified-state behavior.

## Acceptance mapping

- Repeated traversal creates no duplicate `Match` → unique `(monitorId, listingId)` plus idempotent write.
- Interruption before commit leaves watermark unchanged → interactive transaction rollback tests.
- Advanced watermark without its Match is impossible → Listing/Match/Cursor/Run share one transaction.
- `sourceUrl` change resets cursor → monitor-config transaction deletes `MonitorCursor`.
- canonical query change resets cursor → structural source-identity comparison.
- interval/name/keywords changes preserve cursor → explicit reset-policy tests.
- integration tests pass on a clean database → dedicated real-Postgres suite in existing CI integration stage.
