# Design — 1.4.1 Watermark traversal algorithm

Status: approved in chat and written review on 2026-09-08; implementation planning.

## Context

Task `1.4.1` defines the core notion of “new” listings. The repository already has a normalized `Listing` model and cursor-capable `SourceAdapter`, but it does not yet have a multi-page traversal layer that decides when to stop, how to handle equal timestamps, or how to surface an incomplete catch-up.

This design adds one pure orchestration component over `SourceAdapter`. It does not access Prisma, mutate `Monitor`, persist `MonitorCursor`, schedule runs, or send notifications. Those responsibilities remain in later tasks (`1.4.2`, `1.4.3`, scheduler/notification epics).

## Goals

- Traverse one or more source pages until the previous temporal boundary is fully crossed.
- Return listings that are new relative to a previous watermark.
- Handle multiple listings at exactly the boundary timestamp without depending on a stable ID tie-breaker.
- Tolerate a specific boundary listing disappearing from the marketplace.
- Deduplicate overlapping/repeated `listId` values inside a single traversal.
- Stop early once an older timestamp proves the previous boundary has been fully crossed.
- Enforce a configured page cap and make an incomplete catch-up explicit.
- Keep the marketplace pagination cursor local to one traversal.

## Non-goals

- No database access or transactions.
- No persistence of the watermark.
- No cold-start semantics. A missing watermark is owned by `1.4.3` and is not accepted by this API.
- No scheduler/config-file wiring for `maxPages`; callers pass the configured value.
- No keyword/seller matching.
- No notification or user-facing reporting implementation.
- No interpretation, decoding, or persistence of the marketplace cursor.

## Existing contracts

`SourceAdapter` already exposes:

```ts
interface SourcePageRequest {
  query: CanonicalQuery
  cursor: string | null
}

interface SourcePage {
  listings: Listing[]
  nextCursor: string | null
}

interface SourceAdapter {
  fetchPage(request: SourcePageRequest): Promise<SourcePage>
}
```

`Listing.listTime` is a source timestamp string that the current normalizer validates with `Date.parse` and then preserves verbatim. The live Kufar contract uses descending time order (`sort=lst.d`). A stable secondary order for equal timestamps is explicitly not part of the source contract.

Traversal therefore compares listing times chronologically by parsed epoch milliseconds, not by lexicographic string order. Equal instants expressed with different valid ISO offsets are the same temporal boundary. The original source string belonging to the selected maximum-time listing is preserved as `nextWatermark.boundaryTime`.

Live recon for Real Estate also showed page overlap, so repeated `listId` values across pages are a valid source behavior and must not produce duplicate candidates.

## Public domain types

The public watermark is persistence-friendly and JSON-friendly. It deliberately does not expose `Set`.

```ts
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

The main API is a pure orchestration function or equivalent single-purpose class with this logical contract:

```ts
traverseWatermark({
  adapter,
  query,
  previousWatermark,
  maxPages,
}): Promise<WatermarkTraversalResult>
```

`previousWatermark` is required. `maxPages` must be an integer greater than or equal to 1.

## Watermark semantics

A watermark is a pair:

- `boundaryTime = T` — the maximum listing time observed by the previous completed traversal.
- `boundaryIds` — exactly the IDs observed at temporal instant `T`, and no IDs from any other timestamp.

`T` is interpreted chronologically via `Date.parse(previousWatermark.boundaryTime)`.

Classification against the previous watermark:

- `listTime > T` chronologically → new candidate.
- `listTime == T` chronologically → new candidate only when `listId` is not already in `boundaryIds`.
- `listTime < T` chronologically → the previous temporal boundary has been fully crossed; traversal stops immediately after validating the current listing’s ordering position.

The algorithm never searches for one particular old listing ID. Therefore deleting the listing that happened to be present at the old boundary does not change traversal correctness.

## Building the next watermark

For a completed traversal, the next watermark is based on the maximum temporal instant actually observed during this traversal:

1. Let `M` be the greatest parsed epoch timestamp encountered.
2. `nextWatermark.boundaryTime` is the original `listTime` string from the first encountered listing at `M`.
3. `nextWatermark.boundaryIds` contains every unique `listId` encountered exactly at temporal instant `M`.
4. IDs are returned in deterministic first-appearance order.

If a completed traversal observes no listings, the previous watermark is returned unchanged.

`newListings` preserve source traversal order after deduplication.

## Pagination flow

1. Start with `cursor = null` and `pagesRead = 0`.
2. Fetch through the injected `SourceAdapter` only.
3. Increment `pagesRead` for each successfully received page.
4. Process the page in order, deduplicating `listId` values already seen during this traversal.
5. Stop immediately when the first unique listing whose parsed timestamp is older than `previousWatermark.boundaryTime` is encountered.
6. Otherwise:
   - if `nextCursor == null`, the source is exhausted and traversal is complete;
   - if another page is allowed, pass `nextCursor` unchanged as the next request cursor;
   - if the page cap is exhausted while `nextCursor != null`, return an incomplete result.

Marketplace cursors are never decoded, synthesized, stored in the watermark, or persisted between traversals.

## Page-cap semantics

An incomplete traversal is specifically defined as:

- exactly `maxPages` pages have been read;
- the previous boundary has not been fully crossed;
- and the current page still exposes `nextCursor != null`.

In this case:

```ts
possibleMiss = true
nextWatermark = previousWatermark
```

The watermark must not advance. Advancing it would make unread listings below the cap permanently invisible on the next run.

Candidates already observed above the cap may still be returned in `newListings`; persistence/transaction ownership in `1.4.2` decides how they are recorded together with the unchanged watermark.

If `nextCursor == null`, source exhaustion is a complete traversal even when no listing with `listTime < T` was encountered. In that case `possibleMiss = false` and the next watermark may advance normally.

## Ordering invariant

The algorithm relies on non-increasing chronological `listTime` order across the entire traversal.

For every unique processed listing, its parsed epoch timestamp must be less than or equal to the parsed epoch timestamp of the previous unique processed listing. Equal instants are valid and may appear with IDs or ISO-offset spellings in any order.

If a newer temporal instant appears after an older temporal instant, either within one page or across pages, traversal fails with a typed ordering error. It must not return candidates or advance the watermark after detecting this violation.

This check protects the early-stop rule from silently missing records when the source contract is violated.

## Duplicate listings

A `listId` may repeat on later pages because the live Real Estate search showed overlapping/promoted records.

Within one traversal:

- only the first occurrence of a `listId` participates in classification;
- later occurrences are ignored;
- duplicates do not appear twice in `newListings`;
- duplicates do not appear twice in `nextWatermark.boundaryIds`;
- an ignored duplicate does not create a new ordering observation.

The first occurrence wins because it is the source position actually encountered first in descending traversal order.

## Errors

### Invalid configuration

`maxPages < 1`, non-integer, or otherwise invalid page-cap input fails before any source request. This is a caller/configuration error, not a source degradation result.

The previous watermark boundary must also parse to a finite timestamp before any source request. Invalid persisted/domain watermark state is rejected as configuration/domain input rather than silently compared as a string.

### Source errors

Errors thrown by `SourceAdapter.fetchPage` propagate unchanged. The watermark traversal does not reclassify HTTP, schema-drift, fallback, or degradation errors; those are already owned by the source layer.

No partial success result is returned when the adapter throws.

### Ordering errors

Ordering violations are represented by a dedicated typed domain error that preserves enough context for tests/diagnostics, at minimum the previous and current observed timestamps and listing IDs/positions.

### State on errors

On every exception path, the function returns no result. The caller therefore has no new watermark to persist. `1.4.2` remains responsible for transactional persistence once a successful result exists.

## Cold-start boundary

A `null` or missing previous watermark is intentionally not accepted by this component.

`1.4.3` owns first-run behavior: record the initial state without producing notification candidates. Keeping that decision out of `1.4.1` prevents an accidental “no watermark means everything is new” behavior from entering the core traversal API.

## Re-run/idempotency property

Given a completed traversal result `R`, running the same ordered source data again with `previousWatermark = R.nextWatermark` must return an empty `newListings` list.

This property is enforced at the algorithm boundary even before database-level idempotency is added in `1.4.2`.

## Test matrix

TDD tests are written before production code and cover at least:

1. No new listings.
2. Some listings newer than the boundary.
3. All listings newer than the boundary with source exhaustion.
4. Boundary found on page 3 and all listings above it returned.
5. The specific old boundary listing has disappeared, without warning or cap exhaustion.
6. Five listings share the boundary timestamp; previously unseen IDs at `T` are new and known IDs are not.
7. Equal temporal instant `T` spans a page boundary and is processed completely.
8. Equal instants expressed with different valid ISO offsets compare as the same boundary.
9. A raised/reappeared listing with the same `listId` but a genuinely newer `listTime` appears once as new on its first occurrence.
10. Duplicate `listId` overlap across pages does not duplicate output.
11. Page cap reached with `nextCursor != null` → `possibleMiss=true`, previous watermark unchanged.
12. Page cap reached on a terminal page with `nextCursor=null` → complete result, no warning.
13. Invalid `maxPages` fails before any adapter call.
14. Invalid previous `boundaryTime` fails before any adapter call.
15. Ordering violation inside a page throws typed error.
16. Ordering violation across pages throws typed error.
17. Adapter error propagates unchanged and no success result exists.
18. Re-running the same complete traversal using its returned watermark yields no new listings.
19. Empty terminal source leaves the previous watermark unchanged.

## Suggested implementation boundary

Keep the production surface focused, for example:

- `shared/watermark.ts` — JSON-friendly domain types if shared persistence needs them immediately; otherwise colocate types with traversal until `1.4.2` needs reuse.
- `electron/worker/watermark-traversal.ts` — traversal implementation and typed ordering/config errors.
- `tests/unit/watermark-traversal.test.ts` — synthetic adapter-driven tests.

Do not add abstractions for a separate paginator or classifier yet. There is one current consumer shape, and a single state machine keeps stop conditions, page-cap behavior, deduplication, and watermark construction explicit without speculative interfaces.

## Ownership boundaries after 1.4.1

- `1.4.1`: pure multi-page traversal, classification, next-watermark computation, page-cap warning signal.
- `1.4.2`: Prisma persistence, query-change reset, filtering seam, Listing/Match writes, Run record, and atomic commit of results plus watermark.
- `1.4.3`: cold-start behavior and baseline establishment.
- source adapter/resilience layer: HTTP/fallback/schema/degradation classification.
- scheduler/user-facing layers: choose configured `maxPages` and surface `possibleMiss` to the user.
