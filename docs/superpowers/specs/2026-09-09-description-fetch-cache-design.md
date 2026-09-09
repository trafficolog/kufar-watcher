# 1.5.1 — Description fetch and persistent cache design

Date: 2026-09-09
Task: `1.5.1`
Status: approved design, pending implementation plan

## Goal

Load a listing's full description through the Kufar detail endpoint only when a caller explicitly requests it, persist the result, and avoid repeat network requests for the same listing. A listing confirmed unavailable by Kufar must be cached as unavailable and must not turn the monitor run into an error.

This task provides the cache primitive only. The policy deciding which listings need full-description loading belongs to task `1.5.2`.

## Existing constraints

- Search results expose only `body_short`, which is truncated and cannot satisfy full-description matching.
- The shared detail endpoint is `https://api.kufar.by/search-api/v2/item/{id}/rendered?lang=ru`.
- A successful detail response exposes the full text in `result.body`.
- Confirmed unavailability is represented by HTTP `404` with Kufar error code `ASR0006` (`ad not found`).
- The detail payload is not authoritative for seller identity or the rest of the search-derived listing fields. In particular, task `1.5.1` must not overwrite `accountId`, price, title, region, URL, list time, or other search fields from detail data.
- Existing search persistence currently updates `Listing.description`; that would overwrite an already cached full description with `body_short` or `null`, so ownership of that field must change as part of this task.

## Data model

Add a Prisma enum:

```prisma
enum ListingAvailability {
  unknown
  available
  unavailable
}
```

Extend `Listing` with:

```prisma
availability        ListingAvailability @default(unknown)
descriptionLoadedAt DateTime?
```

`descriptionLoadedAt` is the cache sentinel. It is intentionally separate from `description` because a successfully fetched listing may legitimately have `null` or empty full text. `description != null` must never be used to decide whether a detail request has already completed.

`availability` is explicit domain state rather than an inferred timestamp. `unknown` means no authoritative detail availability result has been cached. `available` means a successful detail response was cached. `unavailable` means Kufar returned the exact confirmed-not-found condition described below.

The migration is additive. Existing rows start as `unknown` with `descriptionLoadedAt = null`.

## Cache service boundary

Introduce a worker-side persistent service whose public operation is conceptually:

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

ensureDescription(listing: Listing): Promise<ListingDescriptionResult>
```

The service owns:

1. reading the persistent cache,
2. coalescing concurrent in-process requests for the same `listId`,
3. making the detail HTTP request when necessary,
4. parsing only the fields required by this task,
5. writing cache-owned fields back to `Listing`, and
6. returning a typed available/unavailable result.

It does not own matching policy, monitor watermark advancement, Match creation, Telegram/renderer notification, or monitor-run outcome persistence.

## Cache lookup rules

For a listing row with `availability = unavailable`, return `{ kind: 'unavailable', source: 'cache' }` without a network request.

For a listing row with `descriptionLoadedAt != null`, return `{ kind: 'available', description, source: 'cache' }` without a network request. This remains true when `description` is `null`.

All other states are cache misses and may perform one detail request.

If no `Listing` row exists yet, the service may create the search-derived base row as part of persisting the detail result. This write must not advance a monitor cursor or create a Match.

## In-process request coalescing

The desktop application currently has one worker process, but different monitors can encounter the same listing concurrently. A naïve `read -> fetch -> write` flow can therefore issue duplicate detail requests.

The cache service must keep a process-local in-flight map keyed by `listId`. If a request for a given `listId` is already running, later callers await the same promise instead of issuing another HTTP request.

The in-flight entry is removed in `finally` so failures are retryable. This coalescing is intentionally process-local; cross-process distributed locking is out of scope for the desktop MVP.

Database locks must not be held across the network request.

## Detail request and parsing

Build the detail URL from `listing.listId` and request it through the existing `KufarHttpClient`, preserving the existing global limiter, retry and cooldown behavior.

On HTTP success:

- require the response to have the expected `result` object,
- read only `result.body`,
- accept `body` as a string or `null` when the upstream contract represents no description,
- treat malformed response shape as an error,
- do not copy any other detail fields into the listing.

A successful parse is persisted as:

- `description = parsed full body`,
- `descriptionLoadedAt = now`,
- `availability = available`.

## HTTP failure surface

`KufarHttpClient` currently discards the response body for HTTP failures. Task `1.5.1` needs the body of a `404` to distinguish confirmed listing disappearance from unrelated client errors.

Extend the typed HTTP failure result minimally with the response body for HTTP failures. Do not change retry counts, retry classification, rate-limit handling, cooldown behavior, or successful raw-journal behavior.

The description cache recognizes a listing as unavailable only when both conditions hold:

1. HTTP status is `404`, and
2. the parsed Kufar error payload has `error.code === 'ASR0006'`.

That exact condition is persisted as:

- `availability = unavailable`,
- `descriptionLoadedAt = null`,
- no fabricated description.

The service then returns `{ kind: 'unavailable', source: 'network' }` and does not throw a monitor-run error.

Any other `404`, any other 4xx, `429`, 5xx, timeout, network failure, or malformed failure body remains an error. Those failures must not poison the cache and must remain retryable on a later invocation.

## Persistence ownership and invariants

The full-description cache becomes the only code path allowed to update cache-owned `Listing` fields after creation:

- `description`,
- `descriptionLoadedAt`,
- `availability`.

Generic search persistence may still set the initial `description` from `body_short` when creating a new row, because that is useful before detail loading. On update of an existing row, generic search persistence must not overwrite any of the three cache-owned fields.

This guarantees that a full description survives later search runs.

A detail-cache write is deliberately independent from the monitor's main cursor/Match transaction. Once the network cost has been paid and a valid cache result exists, it should survive a later matching or monitor transaction failure so the next run does not perform the same detail request again.

This independent write must never:

- advance `MonitorCursor`,
- create `Match`,
- mark a monitor run successful,
- emit notifications.

## Error behavior matrix

| Condition | Persist cache? | Result |
| --- | --- | --- |
| Existing `descriptionLoadedAt` | No network | available / cache |
| Existing `availability=unavailable` | No network | unavailable / cache |
| Detail 2xx with valid `result.body` | description + loadedAt + available | available / network |
| Detail 404 + `ASR0006` | unavailable | unavailable / network |
| Detail 404 with other/missing code | No | throw typed failure |
| Other 4xx / 429 / 5xx | No | throw typed failure |
| Timeout / network failure | No | throw typed failure |
| Malformed successful detail payload | No | throw parse/contract failure |

## Concurrency and stale writes

For the same `listId`, process-local in-flight coalescing prevents duplicate HTTP requests inside the worker.

Persistence after a network response updates only cache-owned fields. Search-derived fields supplied by the caller are used only when the row must be created; they are not blindly rewritten by the detail response.

If another successful cache write wins before this request persists, the final state must still satisfy the same cache invariants. No database transaction is held while awaiting Kufar.

## Integration with task 1.5.2

Task `1.5.2` will decide when to call `ensureDescription`:

- when `searchInDescription = false`, it will not call the service,
- when `searchInDescription = true`, it will call it for every new listing that survives the cheap pre-description filters,
- both title matching and snippet generation can then use the returned full description.

Task `1.5.1` must not pre-emptively wire that policy into `runIncrementalMonitor`.

## Testing strategy

### Unit tests

Cover at least:

- strict successful detail parsing,
- malformed success payload rejection,
- exact `404 + ASR0006` recognition,
- unrelated 404 rejection,
- first cache miss performs one network request,
- repeated call returns from persistent cache without a second request,
- successfully cached `null` description is still a cache hit,
- cached unavailable listing performs no second request,
- failed requests do not poison cache,
- concurrent calls for the same `listId` share one in-flight request,
- in-flight entry is cleared after failure so a later call can retry,
- generic search upsert does not overwrite a cached full description.

### HTTP client tests

Verify that HTTP failure results expose the response body needed by the cache service while preserving current retry/rate-limit classifications.

### Postgres integration

Using the real Prisma test database, prove that:

- a full description and `descriptionLoadedAt` persist,
- a second service instance/process-local cache miss still resolves from the database without HTTP,
- `availability=unavailable` persists and prevents repeat HTTP,
- a later generic search persistence update preserves full description/cache metadata.

### CI

Run the repository's standard verification workflow after implementation and again after task-documentation status is updated.

## Non-goals

Task `1.5.1` does not:

- fetch or persist images,
- fetch or normalize category-specific attributes,
- infer `sold` versus `removed`,
- update seller identity from detail payloads,
- choose which monitor candidates need a description,
- add cross-process/distributed request locking,
- change the existing HTTP retry or rate-limit policy.

## Acceptance mapping

Task acceptance criterion "description loads and saves" is satisfied by a successful detail request persisted with `descriptionLoadedAt` and `availability=available`.

"Repeat run makes no second request" is satisfied by persistent cache lookup plus in-process coalescing and by preventing generic search persistence from destroying the cache.

"Deleted listing does not crash the run" is satisfied only for the confirmed Kufar condition `404 + ASR0006`, which is converted to the typed `unavailable` result instead of an exception. Other failures remain errors by design.
