# 1.5.1 Full Description Fetch and Cache Design

Date: 2026-09-09
Task: `1.5.1`
Status: approved design

## Goal

Load the full Kufar listing description through the confirmed detail endpoint, persist it in `Listing`, avoid repeating the same detail request after the full description has been cached, and treat a confirmed removed listing as a non-fatal detail outcome.

## Scope

This design covers the shared Kufar detail flow used by both electronics and real-estate listings. Both verticals use the same confirmed endpoint:

`GET https://api.kufar.by/search-api/v2/item/{id}/rendered?lang=ru`

Out of scope for `1.5.1`:

- deciding when description search is required;
- wiring detail loading into `runIncrementalMonitor`;
- seller-filter ordering;
- keyword matching;
- notification construction;
- images;
- category-specific detail characteristics.

Those policies belong to `1.5.2` and later matcher work.

## Confirmed API Semantics

Primary project fixtures and recon establish:

- an active electronics detail returns HTTP 200 and a JSON payload containing `result.body`;
- an active real-estate detail uses the same endpoint and also contains `result.body`;
- a known removed listing returns HTTP 404 with `error.code = "ASR0006"` and message `ad not found`;
- the detail payload has no explicit active/sold/removed status field.

Therefore `gone` is recognized only from the strict combination `HTTP 404 + error.code === "ASR0006"`. Other 4xx responses, malformed 404 payloads, 5xx, rate limiting, timeouts and network failures are request/contract failures and must not be cached as removal.

## Data Model

Extend `Listing` with:

```prisma
enum ListingAvailability {
  active
  gone
}

model Listing {
  // existing fields
  availability      ListingAvailability @default(active)
  descriptionLoaded Boolean             @default(false)
}
```

Existing `description String?` remains the text storage.

The two fields intentionally separate three concepts:

- `description` may initially contain search `body_short`;
- `descriptionLoaded = true` means `description` contains the full detail `result.body`;
- `availability = gone` means the detail endpoint strictly confirmed `404 + ASR0006`.

The migration is additive. Existing rows become `active / false` without a custom data backfill.

## Search Persistence Rules

Current search normalization may populate `description` from `body_short`. Therefore `description !== null` must never be used as a full-detail cache sentinel.

For a new `Listing`, normal search persistence may create the row with its current search description and default `descriptionLoaded = false`.

For an existing `Listing`, search upsert must:

- continue updating current search-derived fields such as title, price, URL, region, seller identity, list time and raw payload;
- set `availability = active`, because the listing has reappeared in a live search response;
- not overwrite `description`;
- not overwrite `descriptionLoaded`.

This preserves a previously cached full description across later monitor traversals.

If a row previously marked `gone` reappears in search, search persistence returns it to `active`. Its `descriptionLoaded` value remains unchanged by search persistence; for the normal removed-listing path defined below, `gone` is stored with `descriptionLoaded = false`, so a reappearing listing is eligible for a fresh detail request.

## Detail Service Boundary

Implement a dedicated worker-level service, conceptually `KufarListingDescriptionService`, rather than extending `SourceAdapter` or putting domain semantics into `KufarHttpClient`.

Reasons:

- `SourceAdapter` remains focused on paginated search traversal;
- `KufarHttpClient` remains transport/retry/rate-limit infrastructure;
- the detail service owns DB cache semantics and the Kufar-specific `ASR0006` interpretation;
- the service can be reused directly by `1.5.2` without coupling it to one vertical.

The service accepts the current normalized live `Listing`, not only a `listId`. This allows it to create the row safely if detail loading is requested before the monitor transaction has persisted that search result.

## Detail Fetch Flow

The public operation is conceptually:

```ts
getOrFetchFullDescription(listing: Listing): Promise<
  | { kind: 'loaded'; description: string }
  | { kind: 'gone' }
>
```

Exact production naming may follow existing repository conventions, but the semantics are fixed.

Flow:

1. Read the global `Listing` row by `listId`.
2. If `descriptionLoaded = true`, return the cached full description without HTTP.
3. Otherwise request `/search-api/v2/item/{listId}/rendered?lang=ru` through the existing `KufarHttpClient`, inheriting its shared limiter, retry behavior and raw-response journal.
4. On valid HTTP 200 detail:
   - validate the payload;
   - persist full `result.body` into `description`;
   - set `descriptionLoaded = true`;
   - set `availability = active`;
   - return `{ kind: 'loaded', description }`.
5. On strict `404 + ASR0006`:
   - persist `availability = gone`;
   - set `descriptionLoaded = false`;
   - return `{ kind: 'gone' }`;
   - do not throw a traversal error for this outcome.
6. On every other request or contract failure:
   - do not persist a successful-description or removed-listing cache state;
   - throw a typed detail request/normalization error.

Detail cache writes are independent of the monitor-run transaction. `Listing` is global, and a successfully loaded detail remains useful even if the monitor run later becomes stale.

## Concurrency

Use an in-process single-flight keyed by `listId` around cache misses. If two monitors in the same worker request the same uncached listing concurrently, the second caller awaits the existing Promise rather than issuing a second detail request.

The database remains the durable cache across process restarts. The single-flight only prevents duplicate in-flight network work inside one worker process.

The single-flight entry must be removed after both success and failure so a transient failure can be retried by a later call.

## HTTP Failure Body

The current `KufarHttpClient` returns status/code/message for HTTP failures but discards the response body. Strict removal detection requires the 404 JSON body.

Extend HTTP-originated failure results to retain `body: Uint8Array` for:

- 4xx;
- 5xx;
- 429;
- unexpected HTTP status.

Network and timeout failures have no response body and remain body-less.

This is a transport-level extension only. `KufarHttpClient` must not interpret `ASR0006`.

Existing retry and rate-limit behavior stays unchanged.

## Detail Parser and Error Semantics

Successful 200 parsing rules:

- root must be valid JSON object;
- `result` must be an object;
- `result.body` must be a string;
- preserve the body string as returned, without trimming or content normalization;
- if `result.ad_id` or `result.list_id` is present, it must identify the requested `listId`; a mismatch is contract drift and must not be cached.

Removed parsing rules:

- only HTTP 404 is eligible;
- response body must parse as JSON;
- `error.code` must equal `ASR0006`;
- if `error.http.code` is present, it must equal 404.

Anything else is not `gone`.

Use typed errors to distinguish at least:

- request failures from the HTTP layer;
- detail normalization/contract failures.

Both error categories leave the durable detail/removal cache unchanged.

## Persistence Behavior

Detail persistence is intentionally narrow.

On successful detail:

- if the listing row exists, update only `description`, `descriptionLoaded`, and `availability`;
- if the row does not exist, create it from the supplied normalized live `Listing`, but store the full detail description and `descriptionLoaded = true`.

On confirmed removal:

- if the row exists, update `availability = gone` and `descriptionLoaded = false`;
- if the row does not exist, create it from the supplied normalized live `Listing` with `availability = gone` and `descriptionLoaded = false`.

Search-derived mutable fields should not be rewritten by the detail service except as required when creating a missing row.

## Test Strategy

Follow TDD. Each production unit begins with a failing test and a verified red state.

### Unit coverage

Detail parser:

- electronics 200 fixture parses full body;
- real-estate 200 fixture parses full body;
- strict 404 + ASR0006 produces `gone`;
- different 404 code/shape is not `gone`;
- invalid JSON fails normalization;
- missing/non-string `result.body` fails normalization;
- mismatched detail ID fails normalization.

HTTP client regression:

- HTTP-originated failure retains response body;
- existing retry/rate-limit classifications remain unchanged.

Description service:

- `descriptionLoaded = true` is a cache hit and performs no HTTP request;
- cache miss performs one detail request and persists full text;
- strict removed detail returns `gone` without throwing;
- non-gone request failure does not cache removal or full description;
- normalization failure does not cache success;
- concurrent same-ID misses share one HTTP request;
- single-flight is cleared after failure so a later call can retry.

Persistence regression:

- later search upsert does not overwrite a cached full description;
- later search upsert does not reset `descriptionLoaded = true`;
- a listing seen again in search is set back to `availability = active`.

### PostgreSQL integration coverage

- migration/defaults produce `availability = active` and `descriptionLoaded = false` for ordinary inserted listings;
- a full detail survives a later normal monitor persistence cycle;
- strict `gone` state persists correctly;
- a reappearing `gone` listing becomes active through search persistence.

### Regression suite

Existing watermark, cold-start, incremental-monitor, typecheck, lint, formatting, build and smoke verification must remain green.

## Acceptance Mapping

Task criterion: description is loaded and saved.

- Covered by detail parser + detail service + persistence integration.

Task criterion: repeated traversal does not perform a second request for the same description.

- Covered by durable `descriptionLoaded` cache, search-upsert preservation and service cache-hit test.

Task criterion: removed listing does not break traversal.

- Covered by strict `404 + ASR0006` mapping to a typed `gone` result rather than an exception.

## Deferred Integration

`1.5.1` delivers a reusable, tested detail-loading/cache capability. It does not automatically call that capability from the incremental monitor loop.

`1.5.2` will decide which new listings require full descriptions and at what point in the cheap-filter pipeline the service is invoked.
