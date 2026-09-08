# Design — 1.3.4 HTML embedded-state fallback

Date: 2026-09-08
Task: `1.3.4`
Status: approved in chat; written review pending

## Goal

Add a second, explicitly degraded read channel for both supported Kufar verticals — electronics and real estate. The primary JSON API remains authoritative. Only an exhausted temporary primary failure (`network`, `timeout`, `http-5xx`) may attempt the HTML embedded-state channel. Rate limiting, permanent HTTP failures, and schema drift must not be disguised by switching channels.

The fallback must normalize into the same `Listing`/`SourcePage` domain shape as the primary channel, expose that the result came from the degraded channel, and publish a typed degradation event without prematurely implementing scheduler persistence or monitor-state transitions owned by later phases.

## Evidence basis and recon gate

Existing evidence in `docs/superpowers/specs/kufar-api-contract.md` confirms:

- the primary search endpoint and cursor semantics for electronics and real estate;
- structured HTML embedded state on an electronics **detail page** via `<script id="__NEXT_DATA__" type="application/json">`;
- the detail-page path `props.initialState.adView.data.initial` for the confirmed electronics sample;
- DOM parsing is Post-MVP and is not part of this fallback.

This is not yet sufficient evidence for a **search-page** fallback. Before production implementation, recon must establish for each supported vertical:

1. the exact user-facing search URL used for the fallback request;
2. the exact embedded script/state carrier in raw HTML;
3. the exact JSON path containing search-page records;
4. the exact pagination representation;
5. whether an opaque primary/search cursor can be represented on the user-facing HTML request and yields the corresponding next page;
6. that the embedded record shape contains the fields required by the existing vertical normalizers or can be transformed losslessly into that confirmed search shape.

Required dated evidence:

- one HTML search-page fixture for electronics page 1;
- one HTML search-page fixture for electronics page 2 when cursor pagination is supported;
- one HTML search-page fixture for real estate page 1;
- one HTML search-page fixture for real estate page 2 when cursor pagination is supported;
- a contract-spec update recording the exact script id/state path and cursor behavior.

If live evidence shows that search HTML does not expose enough structured data or cannot preserve required pagination for a vertical, the task is blocked for that vertical. The implementation must not invent an undocumented JSON path, silently fall back to DOM scraping, or claim 1.3.4 complete with only the electronics detail-page evidence.

## Architectural boundary

Keep the existing primary adapter contract unchanged:

```ts
interface SourceAdapter {
  fetchPage(request: SourcePageRequest): Promise<SourcePage>
}
```

`KufarElectronicsAdapter`, `KufarRealEstateAdapter`, and `SourceAdapterRegistry` remain primary-channel components. They continue to know nothing about degradation events, monitor ids, Prisma, `Run`, health aggregation, or monitor state.

Introduce a resilience layer above `SourceAdapter`:

```ts
type SourceChannel = 'primary' | 'html-fallback'

interface SourceFetchResult {
  page: SourcePage
  channel: SourceChannel
}

interface ResilientSource {
  fetchPage(request: SourcePageRequest): Promise<SourceFetchResult>
}
```

The scheduler/runtime introduced later consumes `ResilientSource`; existing source adapters remain reusable and independently testable.

This avoids adding transport/degradation metadata to every `SourcePage` and avoids forcing the two concrete primary adapters to duplicate fallback policy.

## Components

### Primary adapters

Existing:

- `electron/worker/kufar-electronics-adapter.ts`
- `electron/worker/kufar-realestate-adapter.ts`

Their request construction and normalization behavior remains unchanged. They still:

- build the primary API URL;
- add `size=30` and opaque cursor;
- preserve `KufarHttpResult` failure classification in typed request errors;
- use the existing vertical normalizers.

### Common adapter request error

The resilience layer must be able to recognize classified transport failures without importing every vertical-specific error class or matching arbitrary objects structurally.

Introduce a common base error in a focused worker module:

```ts
class KufarSourceRequestError extends Error {
  readonly result: Extract<KufarHttpResult, { ok: false }>
}
```

Preserve the current public vertical error classes for compatibility:

```ts
class KufarAdapterRequestError extends KufarSourceRequestError {}
class KufarRealEstateAdapterRequestError extends KufarSourceRequestError {}
```

The HTML fallback request error uses the same base class. Existing callers/tests that depend on the vertical class names continue to work, while the generic resilience policy can classify `KufarSourceRequestError.result` exactly.

This is a refactor of error hierarchy only; it must not change retry, status, or result identity semantics.

### HTML request adapter

Add a small HTML fallback adapter for each supported vertical, or one generic HTML transport adapter parameterized by a confirmed vertical decoder if the live evidence proves the request mechanics are identical.

Responsibilities:

- build the confirmed user-facing listing URL from `CanonicalQuery` using the existing listing-URL builder;
- add only the HTML transport pagination parameters proven by recon;
- request raw HTML through the same process-wide `KufarHttpClient`/limiter;
- extract structured embedded state;
- select the confirmed search payload from that state;
- transform only when necessary into the already-confirmed search response shape;
- call the same vertical normalizer used by the primary API.

It must not parse visible cards, CSS selectors, prices, seller labels, or other DOM presentation.

### Embedded-state extractor

Add a pure extractor with no network responsibility.

Target API after recon confirmation:

```ts
interface EmbeddedState {
  scriptId: string
  value: unknown
}

function extractKufarEmbeddedState(html: Uint8Array): EmbeddedState
```

The extractor validates the confirmed script carrier and JSON syntax. Missing script, malformed JSON, or an unexpected carrier is a typed embedded-state error, not an empty successful page.

The extractor should use exact script-boundary/state-carrier semantics from the fixtures. It must not implement a general HTML DOM parser.

### Vertical embedded-state decoders

Use small pure functions per vertical when the confirmed search JSON paths differ:

```ts
function electronicsSearchPayloadFromEmbeddedState(state: unknown): Uint8Array
function realEstateSearchPayloadFromEmbeddedState(state: unknown): Uint8Array
```

Their output is bytes representing the same search-page payload shape consumed by:

- `normalizeElectronicsSearchPage`
- `normalizeRealEstateSearchPage`

This is the key consistency boundary: primary JSON and HTML fallback converge before domain normalization, so fallback data cannot bypass required-field and meaningful-value checks.

If recon proves the embedded object is already the exact primary search payload, no copy/reshape layer is added.

### Resilient source orchestrator

Add one generic policy wrapper:

```ts
class KufarResilientSource implements ResilientSource {
  constructor(
    primary: SourceAdapter,
    fallback: SourceAdapter,
    onDegradation: SourceDegradationSink,
  )
}
```

The degradation sink is mandatory. A caller must explicitly provide the publication boundary; there is no default no-op because silent degradation is forbidden by the task contract.

The wrapper owns only channel-selection policy and degradation publication. It does not own retry logic, rate limiting, persistence, schema fingerprinting, or monitor lifecycle.

## Failure-policy matrix

Primary result/failure determines whether fallback is eligible.

| Primary outcome | Fallback? | Result |
|---|---:|---|
| success | no | `{ page, channel: 'primary' }` |
| `network` after bounded retries | yes | attempt HTML fallback |
| `timeout` after bounded retries | yes | attempt HTML fallback |
| `http-5xx` after bounded retries | yes | attempt HTML fallback |
| `rate-limited` / `429` | no | propagate rate-limit failure |
| `http-4xx` | no | propagate permanent failure |
| `unexpected-http` | no | propagate permanent failure |
| `KufarNormalizationError` from primary | no | classify as schema drift / `pause-required` |

Fallback itself is a normal HTTP request through the same global limiter. It does not receive an exception from the limiter rules merely because it is a fallback channel.

### Fallback success

When fallback normalizes successfully:

1. create a `SourceDegradationEvent` describing the primary temporary failure;
2. `await` the mandatory degradation sink;
3. only after successful publication return `{ page, channel: 'html-fallback' }`.

If event publication fails, do not return a degraded success silently. Surface a resilience-level `fail-run` error with the publication failure as cause. The already-normalized page may be discarded and recovered on a later run; observability must not be silently lost.

### Fallback network/HTTP failure

If the fallback request itself cannot be obtained because of network/timeout/HTTP failure, the fetch is unsuccessful. Preserve the fallback failure and the primary failure as structured context. Do not fabricate a page and do not classify this automatically as schema drift.

A `429` received from the fallback request is still rate limiting and must impose the same global cooldown through `KufarHttpClient`.

A fallback `403`/other 4xx after a temporary primary failure is an unavailable-channel/run failure, not evidence of schema drift. Access-control bypass is out of scope.

### Fallback embedded-state or normalization failure

If HTML is fetched but the confirmed embedded carrier/path is missing, malformed, or the extracted payload fails the same vertical normalization checks, classify the result as `pause-required` because the fallback contract itself is no longer trustworthy.

Do not drop malformed records. One invalid required listing fails the whole page, matching primary-channel behavior.

## Terminal classification

Introduce a resilience-level typed error rather than mutating `Monitor` directly:

```ts
type SourceFailureAction = 'fail-run' | 'pause-required'

class KufarResilientSourceError extends Error {
  readonly action: SourceFailureAction
  readonly stage: 'primary' | 'html-fallback' | 'degradation-event'
  readonly primaryCause: unknown
  readonly fallbackCause?: unknown
}
```

Exact fields can be narrowed in the implementation plan, but callers must be able to distinguish:

- an unsuccessful traversal (`fail-run`), including both channels being unavailable or degradation-event publication failure;
- schema/embedded-state failures (`pause-required`) that require monitor pause once phase 4.3 owns that transition.

Primary rate-limit/permanent request errors can remain their existing typed request errors when no fallback was attempted; the resilience wrapper must not erase useful HTTP classification just to force every failure into one class.

The orchestrator itself never updates `Monitor.state`.

## Degradation event

Define a transport/domain-neutral event:

```ts
interface SourceDegradationEvent {
  kind: 'source-degraded'
  channel: 'html-fallback'
  primaryFailureCode: 'network' | 'timeout' | 'http-5xx'
  primaryStatus: number | null
}

type SourceDegradationSink = (
  event: SourceDegradationEvent,
) => void | Promise<void>
```

Publish exactly once and only after the fallback page has passed extraction and vertical normalization. A failed fallback is not a successful degradation event.

Do not include `monitorId`, cursor, request URL, or secrets in the source-layer event. This layer operates on source requests, while the later run/scheduler layer owns monitor identity and persistence context.

## Journal and persistence boundary

The domain model already defines `Run.degradedLevel`, but task `2.4.3` owns the lifecycle and persistence of a monitor run. `HealthEvent`/`AdapterState` are introduced later in slice `0.6.0`; creating an ad-hoc third event store now would contradict `data-model.md`.

Therefore 1.3.4 implements **reliable publication**, not DB persistence:

- source layer emits `SourceDegradationEvent` through a mandatory sink;
- task `2.4.3` will bind that sink to the run journal and persist the corresponding outcome/`degradedLevel` when it introduces run journaling;
- slice `0.6.0` can later project health/adapter-state events without changing source fallback policy.

The 1.3.4 task card must be updated to make this dependency explicit instead of claiming that source code writes directly into a journal that does not yet have an owner.

## Pause boundary

Likewise, 1.3.4 classifies `pause-required`, but does not mutate a monitor:

- primary schema drift: no fallback, `pause-required`;
- fetched HTML with missing/malformed embedded state: `pause-required`;
- extracted fallback payload that fails the existing normalizer: `pause-required`.

Epic `4.3` owns the actual `Monitor.state = paused` transition and user-facing broken-schema report. This preserves the existing phase boundary while providing all information needed by the future caller.

## Pagination

Pagination is part of the fallback contract, not an optional enhancement.

The implementation must preserve the source request's opaque `cursor` across channel selection. Exact HTML request mechanics are gated on live recon. Acceptable outcomes are:

1. recon confirms the HTML user URL accepts an opaque cursor (or another exact embedded-state token) and the corresponding next page can be fetched; implement and fixture-test it;
2. recon reveals a different structured pagination token inside HTML; document the mapping only if it can be derived without interpreting opaque internals;
3. recon shows HTML cannot provide the next page required by `SourcePageRequest.cursor`; report a contract blocker rather than silently returning page 1.

The fallback must never decode or synthesize the primary cursor.

## Tests and TDD sequence

All production behavior is fixture-driven and offline in CI. Live access is recon only.

### 1. Common request-error hierarchy

RED first, then refactor without behavior change:

- electronics request error remains the same public class and preserves result identity;
- real-estate request error remains the same public class and preserves result identity;
- both are recognized as `KufarSourceRequestError`;
- existing adapter tests remain green.

### 2. Embedded-state extractor

RED first, then implement against dated full/minimal HTML fixtures:

- extracts the exact confirmed script/state carrier;
- parses valid JSON;
- rejects missing carrier;
- rejects malformed JSON;
- rejects ambiguous/unconfirmed carrier shapes instead of guessing.

### 3. Vertical embedded-state decoder

For electronics and real estate separately:

- select the confirmed search payload path;
- preserve listing objects and pagination without lossy transformation;
- feed the resulting bytes into the existing vertical normalizer;
- prove exact representative normalized fields from the dated fixture;
- prove page-1/page-2 cursor behavior when live recon confirms it.

### 4. Fallback request adapters

With a fake HTTP getter:

- build the exact confirmed user-facing URL;
- preserve any proven HTML pagination transport state;
- reuse the existing global-client `get` contract;
- preserve fallback HTTP failures through the common request-error base.

### 5. Resilience policy matrix

With fake primary/fallback adapters:

- primary success never invokes fallback;
- network/timeout/5xx invokes fallback once;
- 429 never invokes fallback;
- 4xx/unexpected permanent failure never invokes fallback;
- primary `KufarNormalizationError` never invokes fallback and becomes `pause-required`;
- successful fallback returns `channel='html-fallback'` only after event publication;
- fallback schema/extractor normalization failure becomes `pause-required`;
- fallback transport failure preserves both primary and fallback failure context;
- fallback 403 is `fail-run`, not schema drift;
- event-sink failure is `fail-run` and does not return silent degraded success.

### 6. Event publication

Prove:

- exactly one degradation event is emitted after successful fallback normalization;
- no event is emitted on primary success;
- no successful-degradation event is emitted when fallback fails;
- event contains only the primary temporary failure classification/status and no cursor/request URL/secrets.

### Regression gates

Existing tests for:

- URL parser/builders;
- HTTP retry/429 policy;
- electronics adapter/normalizer;
- real-estate adapter/normalizer;
- raw-response journal;

must remain unchanged and green.

## Documentation changes at completion

After recon and GREEN implementation:

- update `docs/superpowers/specs/kufar-api-contract.md` with exact search HTML carrier/path/pagination evidence for both verticals;
- add dated recon notes/fixture references if that is the existing recon convention;
- update `docs/tasks/1-3-4-html-fallback.md` to distinguish publication/classification in 1.3.4 from persistence in 2.4.3 and state mutation in 4.3;
- mark 1.3.4 done/aligned only if both supported verticals satisfy the confirmed fallback contract;
- update epic 1.3 to 4/4 and generated docs rollups only after full exact-SHA verification.

## Explicit non-scope

Do not implement in 1.3.4:

- DOM/card scraping;
- bypassing `403`, anti-bot, login, CAPTCHA, proxy, fingerprinting, or other access controls;
- a second rate limiter;
- changes to HTTP retry or 429 cooldown rules;
- scheduler/run lifecycle;
- `Run` persistence;
- `HealthEvent`, `AdapterState`, or `SchemaSnapshot` persistence;
- actual `Monitor.state` mutation;
- schema fingerprinting or drift-history storage;
- detail-page fallback as a substitute for search-page fallback;
- live-network CI tests.
