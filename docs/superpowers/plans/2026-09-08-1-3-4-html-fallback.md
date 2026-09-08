# HTML Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the verified Kufar search-page HTML embedded-state fallback for Electronics and Real Estate, preserving the existing primary JSON adapters, cursor semantics, domain normalizers, and explicit degradation policy.

**Architecture:** Primary `SourceAdapter` remains unchanged. A common request-error base lets a resilience layer classify both current primary adapters and the new HTML adapter without structural guessing. The HTML adapter builds the existing user-facing listing URL, forwards `cursor` unchanged, extracts the confirmed `__NEXT_DATA__` carrier, projects embedded `listing.pagination[]` to the existing API-normalizer shape `pagination.pages[]`, and then reuses the existing vertical normalizer. `KufarResilientSource` owns channel selection and mandatory degradation-event publication but does not mutate monitor state or persist `Run`/`HealthEvent` records.

**Tech Stack:** TypeScript 6, Node 22, Vitest 5, existing `KufarHttpClient`, existing `CanonicalQuery` / `Listing` / `SourceAdapter` contracts. No new dependencies.

**Design:** `docs/superpowers/specs/2026-09-08-1-3-4-html-fallback-design.md`

**Recon:** `docs/recon/kufar-html-fallback-2026-09-08.md`

## Locked live contract

- Search HTML carrier for both verticals: `<script id="__NEXT_DATA__" type="application/json">`.
- Search state: `props.initialState.listing`.
- Records: `props.initialState.listing.ads`.
- Embedded pagination: `props.initialState.listing.pagination` is an array, not `{ pages: [...] }`.
- HTML route forwards `cursor=<opaque token>` unchanged and page 2 returns `self=2` plus a new `next` token.
- HTML decoder must project only `{ ads, pagination: { pages: listing.pagination } }` before calling the existing normalizer.
- Live Real Estate HTML now contains legitimate `currency="EUR"` records. Their selected price is present as the matching `calculator[]` entry with `currency="EUR"` and digit-string `price`; existing USD/BYR paths remain unchanged.
- Reduced dated fixtures exist for page 1 and page 2 of both verticals under `tests/fixtures/kufar/2026-09-08-*-embedded.html`.

## Global constraints

- Primary JSON API always runs first.
- Fallback is attempted only after exhausted primary `network`, `timeout`, or `http-5xx` failures.
- Primary `429`, `http-4xx`, `unexpected-http`, or other permanent failures do not trigger fallback.
- Primary `KufarNormalizationError` is `pause-required`; fallback is forbidden.
- Fallback missing/malformed `__NEXT_DATA__`, invalid embedded paths, or vertical normalization errors are `pause-required`.
- A fallback HTTP failure is `fail-run`, preserving both primary and fallback causes.
- Fallback `429` still uses the same process-wide HTTP client/limiter and therefore its existing cooldown behavior; no bypass/retry policy is added here.
- Degraded success is returned only after `SourceDegradationSink` completes successfully; sink failure is `fail-run`.
- No DOM/card parsing, access-control bypass, separate limiter, scheduler/run lifecycle, DB persistence, `HealthEvent`, `AdapterState`, or `Monitor.state` mutation.
- CI tests remain offline.
- Every production change follows RED → exact-SHA failing Actions run → GREEN → exact-SHA successful Actions run.

---

## Task 0: Reconcile live Real Estate EUR price contract

**Files:**
- Modify: `tests/unit/kufar-realestate-normalizer.test.ts`
- Modify: `electron/worker/kufar-realestate-normalizer.ts`
- Read: `tests/fixtures/kufar/2026-09-08-realestate-search-page-1-embedded.html`
- Read: `tests/fixtures/kufar/2026-09-08-realestate-search-page-2-embedded.html`

**Production change that must make the RED test pass:** `normalizeRealEstatePrice` must accept a live `currency="EUR"` record by selecting the matching `calculator[]` entry and normalizing its digit-string minor-unit `price` to domain `currency: "EUR"`.

- [ ] Replace the obsolete test that expects EUR rejection with a fixture-derived EUR case using exact observed record values.
- [ ] Add negative cases: missing `calculator`, no matching EUR calculator entry, or non-digit EUR calculator price must fail with an exact typed path.
- [ ] Push the RED test-only commit and verify the exact SHA fails for the expected `ads[...].currency`/EUR support reason.
- [ ] Implement the minimum helper needed to locate the matching calculator entry; keep USD and BYR/BYN behavior unchanged.
- [ ] Push GREEN and require the exact SHA full `verify` workflow to pass.

---

## Task 1: Common classified request-error hierarchy

**Files:**
- Create: `electron/worker/kufar-source-request-error.ts`
- Modify: `electron/worker/kufar-electronics-adapter.ts`
- Modify: `electron/worker/kufar-realestate-adapter.ts`
- Modify: `tests/unit/kufar-electronics-adapter.test.ts`
- Modify: `tests/unit/kufar-realestate-adapter.test.ts`

**Interfaces:**

```ts
export class KufarSourceRequestError extends Error {
  constructor(
    readonly result: Extract<KufarHttpResult, { ok: false }>,
    message: string,
  )
}
```

Existing public classes remain source-compatible:

```ts
export class KufarAdapterRequestError extends KufarSourceRequestError {}
export class KufarRealEstateAdapterRequestError extends KufarSourceRequestError {}
```

- [ ] RED: extend both existing adapter tests to assert each public error is also `instanceof KufarSourceRequestError` and still preserves `result` identity.
- [ ] Verify exact RED SHA fails because the common base does not exist yet.
- [ ] GREEN: add the common base and make both existing classes extend it without changing request/normalization behavior.
- [ ] Verify exact GREEN SHA passes the full branch workflow.

---

## Task 2: Pure embedded-state extractor and API-shape projection

**Files:**
- Create: `tests/unit/kufar-html-embedded-state.test.ts`
- Create: `electron/worker/kufar-html-embedded-state.ts`
- Read fixtures:
  - `tests/fixtures/kufar/2026-09-08-electronics-search-page-1-embedded.html`
  - `tests/fixtures/kufar/2026-09-08-electronics-search-page-2-embedded.html`
  - `tests/fixtures/kufar/2026-09-08-realestate-search-page-1-embedded.html`
  - `tests/fixtures/kufar/2026-09-08-realestate-search-page-2-embedded.html`

**Interfaces:**

```ts
export type KufarEmbeddedStateErrorCode =
  | 'missing-next-data'
  | 'invalid-next-data-json'
  | 'invalid-next-data-shape'

export class KufarEmbeddedStateError extends Error {
  readonly code: KufarEmbeddedStateErrorCode
  readonly path: string
}

export function kufarSearchPayloadFromHtml(html: Uint8Array): Uint8Array
```

Behavior:

1. locate the confirmed `__NEXT_DATA__` script without introducing a DOM parser;
2. parse its JSON;
3. require `props.initialState.listing` object;
4. require `listing.ads` array;
5. require `listing.pagination` array;
6. emit UTF-8 JSON bytes exactly shaped as `{ ads, pagination: { pages } }`.

- [ ] RED fixture tests prove all four saved fixtures project successfully.
- [ ] Pass projected Electronics bytes into `normalizeElectronicsSearchPage`; assert page-1 list id `1084343116`, page-2 list id `1084291401`, and observed next cursors.
- [ ] Pass projected Real Estate bytes into `normalizeRealEstateSearchPage`; assert page-1 list id `1075499901` and page-2 EUR list id `1083591450` with its normalized EUR price.
- [ ] RED malformed tests cover missing script, malformed JSON, missing `listing`, non-array `ads`, and non-array `pagination`.
- [ ] Verify exact RED SHA.
- [ ] GREEN with the minimum string extractor + structural guards + projection.
- [ ] Verify exact GREEN SHA and all existing normalizer regressions.

---

## Task 3: HTML fallback request adapter

**Files:**
- Create: `tests/unit/kufar-html-fallback-adapter.test.ts`
- Create: `electron/worker/kufar-html-fallback-adapter.ts`
- Read: `shared/kufar-url.ts`

**Interfaces:**

```ts
export type KufarHtmlPageNormalizer = (body: Uint8Array) => SourcePage

export class KufarHtmlFallbackRequestError extends KufarSourceRequestError {}

export class KufarHtmlFallbackAdapter implements SourceAdapter {
  constructor(
    httpClient: KufarHttpGetter,
    normalizePage: KufarHtmlPageNormalizer,
  )
}
```

`fetchPage` behavior:

1. `new URL(buildKufarListingUrl(request.query))`;
2. set `size=30`;
3. if cursor is non-null, set `cursor` unchanged;
4. call the injected existing HTTP getter once;
5. on classified failure throw `KufarHtmlFallbackRequestError` preserving `result` identity;
6. on success call `kufarSearchPayloadFromHtml(result.body)`, then the injected existing vertical normalizer.

- [ ] RED: Electronics and Real Estate URL tests use real canonical listing URLs and assert host/path/existing semantic query params.
- [ ] RED: exact opaque cursor `opaque+/=token` round-trips through `URLSearchParams.get('cursor')` unchanged.
- [ ] RED: request failure preserves the exact `KufarHttpResult` object.
- [ ] RED: saved HTML fixtures produce the expected normalized listing + next cursor when paired with the existing vertical normalizer.
- [ ] Verify exact RED SHA.
- [ ] GREEN minimal adapter implementation.
- [ ] Verify exact GREEN SHA.

---

## Task 4: Resilient channel policy and typed terminal actions

**Files:**
- Create: `tests/unit/kufar-resilient-source.test.ts`
- Create: `electron/worker/kufar-resilient-source.ts`

**Interfaces:**

```ts
export type SourceChannel = 'primary' | 'html-fallback'

export interface SourceFetchResult {
  page: SourcePage
  channel: SourceChannel
}

export interface ResilientSource {
  fetchPage(request: SourcePageRequest): Promise<SourceFetchResult>
}

export interface SourceDegradationEvent {
  kind: 'source-degraded'
  channel: 'html-fallback'
  primaryFailureCode: 'network' | 'timeout' | 'http-5xx'
  primaryStatus: number | null
}

export type SourceDegradationSink = (
  event: SourceDegradationEvent,
) => void | Promise<void>

export type SourceFailureAction = 'fail-run' | 'pause-required'

export class KufarResilientSourceError extends Error {
  readonly action: SourceFailureAction
  readonly stage: 'primary' | 'html-fallback' | 'degradation-event'
  readonly primaryCause: unknown
  readonly fallbackCause?: unknown
}
```

Policy tests, one behavior each:

- [ ] Primary success: returns `channel='primary'`, fallback untouched, no event.
- [ ] Table RED for primary `network`, `timeout`, `http-5xx`: fallback called once; on fallback success event emitted once and result is `html-fallback`.
- [ ] Primary `429`: fallback untouched, original rate-limit error propagated.
- [ ] Primary `http-4xx`/unexpected permanent failure: fallback untouched, original request error propagated.
- [ ] Primary `KufarNormalizationError`: fallback untouched; terminal error `pause-required`, stage `primary`.
- [ ] Fallback `KufarEmbeddedStateError` or `KufarNormalizationError`: terminal `pause-required`, stage `html-fallback`, preserving primary + fallback causes.
- [ ] Fallback classified request failure: terminal `fail-run`, stage `html-fallback`.
- [ ] Degradation sink rejection: no degraded success returned; terminal `fail-run`, stage `degradation-event`.
- [ ] Event contains only approved low-cardinality fields and is emitted after successful fallback normalization.
- [ ] Verify exact RED SHA.
- [ ] GREEN minimal orchestration implementation with no persistence/state mutation.
- [ ] Verify exact GREEN SHA.

---

## Task 5: Contract/task/docs alignment and final verification

**Files:**
- Modify: `docs/superpowers/specs/kufar-api-contract.md`
- Modify: `docs/superpowers/specs/2026-09-08-1-3-4-html-fallback-design.md`
- Modify: `docs/tasks/1-3-4-html-fallback.md`
- Modify: epic/status rollups generated by docs ops as required.

Required contract updates:

- search fallback is confirmed for both Electronics and Real Estate, not only Electronics detail;
- carrier/path and reduced fixture filenames;
- embedded `pagination[]` projection to primary `pagination.pages[]`;
- HTML cursor query forwarding without decoding;
- live Real Estate `EUR` price evidence and calculator lookup;
- JSON API remains primary and DOM parser remains Post-MVP.

Required task-boundary clarification:

- `1.3.4` publishes a typed degradation event and classifies `pause-required`;
- `2.4.3` owns Run journal lifecycle/persistence and will bind the degradation sink / `Run.degradedLevel`;
- `4.3` owns actual `Monitor.state=paused` mutation and user-facing pause report;
- do not claim DB journal persistence or monitor mutation in `1.3.4`.

Completion sequence:

- [ ] Run/require `npm run docs:ops:refresh && npm run docs:ops:check` through CI.
- [ ] Set task `status: done`, `sync_state: aligned`, `last_reviewed: 2026-09-08` only after all implementation tests are GREEN.
- [ ] Epic 1.3 rollup becomes 4/4 only after task completion.
- [ ] Invoke `superpowers:verification-before-completion` and inspect the exact final branch SHA workflow: unit tests, docs consistency, typecheck, lint, format, Postgres integration, build, dev/prod Electron smoke all GREEN.
- [ ] Invoke `superpowers:requesting-code-review`; review the PR patch manually if no subagent runtime exists.
- [ ] Open PR to `main`, require the pull-request-triggered full verify run on the same feature head SHA, resolve all review findings, then integrate only with explicit/previously-approved merge workflow.

## Self-review checklist

- No production TypeScript precedes its failing test commit.
- Existing public adapter error class names remain exported.
- Fallback uses the same HTTP getter/limiter and never handles 429 as a reason to switch channels.
- HTML parsing is limited to confirmed structured script extraction, not visible DOM.
- No cursor decode/synthesis exists.
- Existing normalizers remain the single domain-validation path.
- Real Estate EUR support is based on exact live evidence, not guessed `price_eur`.
- Degradation sink is mandatory and degraded success cannot be silent.
- `pause-required` is classification only; no monitor mutation is introduced.
- Persistence boundaries stay owned by later tasks.
