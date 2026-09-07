# Design — 1.2.2 Kufar HTTP client

Date: 2026-09-07
Task: `docs/tasks/1-2-2-http-client.md`
Epic: `1.2` HTTP client and limiter

## Scope

Introduce the worker-process HTTP entrypoint used by all Kufar adapters and later detail-page fetches. The client sits on top of the global `kufarRateLimiter` from `1.2.1`, applies bounded timeouts and retries, and converts transport/status failures into a typed result instead of leaking raw exceptions.

This task does not parse listing schemas, switch to HTML fallback, persist raw response snapshots, schedule monitors, or create `HealthEvent`. `HealthEvent` intentionally arrives only in slice `0.6.0`; until then the data-model spec assigns rate-limit health information to `Run`. Because `Run` lifecycle/persistence is introduced in `2.4.3`, this client emits a structured rate-limit health signal that the run journal will persist there. It does not create a second temporary persistence mechanism.

## Dependency choice

Use explicit dependency `undici@7.29.1`.

Rationale:

- the repository engine is `node >=22 <23`;
- Undici 7 supports Node >=20.18.1, including the full supported Node 22 range used by the project;
- Undici 8 currently requires Node >=22.19.0, which is narrower than the repository engine declaration;
- `7.29.1` is the current patched 7.x release for the September 2026 cache advisory affecting earlier 7.x builds.

No retry interceptor or Undici cache interceptor is used. Retry policy remains explicit project code so `429` can never be retried accidentally.

## Production surface

Create `electron/worker/kufar-http-client.ts`.

Export only domain-facing types plus one production client:

```ts
export interface KufarHttpClient {
  get(url: string | URL): Promise<KufarHttpResult>
}

export type KufarHttpResult =
  | KufarHttpSuccess
  | KufarHttpTemporaryFailure
  | KufarHttpPermanentFailure
  | KufarHttpRateLimited

export const kufarHttpClient: KufarHttpClient
```

Do not export Undici `request`, the dispatcher, a raw transport, or a production factory that accepts an alternate limiter. Unit tests mock the imported modules rather than exposing a bypass-oriented construction API.

The client accepts only `https:` URLs whose hostname is `kufar.by` or ends with `.kufar.by`. Invalid/foreign input returns a typed permanent `invalid-request` result without entering the limiter or transport.

## Result contract

Success:

```ts
interface KufarHttpSuccess {
  ok: true
  status: number
  body: string
  attempts: number
}
```

Temporary exhausted failure:

```ts
interface KufarHttpTemporaryFailure {
  ok: false
  kind: 'temporary'
  reason: 'network' | 'timeout' | 'server'
  status: number | null
  attempts: number
  message: string
}
```

Permanent failure:

```ts
interface KufarHttpPermanentFailure {
  ok: false
  kind: 'permanent'
  reason: 'client' | 'invalid-request' | 'unexpected-status'
  status: number | null
  attempts: number
  message: string
}
```

Rate limit:

```ts
interface KufarHttpRateLimited {
  ok: false
  kind: 'rate-limited'
  status: 429
  attempts: number
  retryAfterMs: number
  message: string
  health: {
    kind: 'rate-limit'
    endpoint: string
  }
}
```

`endpoint` contains origin + pathname only, never query parameters. Error messages are stable/safe summaries and do not include raw exception dumps.

## Undici and timeout configuration

One module-private `Agent` is created for the worker process with:

- `connectTimeout = 5_000 ms`;
- `headersTimeout = 15_000 ms`;
- `bodyTimeout = 15_000 ms`.

Every attempt calls Undici `request()` with method `GET` and that dispatcher, then consumes `body.text()` before classifying the completed response. Undici documents timeout errors including `UND_ERR_CONNECT_TIMEOUT`, `UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT`, and `UND_ERR_ABORTED`; these map to `reason: 'timeout'`.

Other thrown transport failures map to `reason: 'network'` after bounded retries. Invalid URL/host is validated before transport and is never retried.

## Retry policy

Defaults:

- maximum attempts: `3` total;
- exponential backoff base: `2_000 ms`;
- after attempt 1 temporary failure: wait `2_000 ms` before queuing attempt 2;
- after attempt 2 temporary failure: wait `4_000 ms` before queuing attempt 3;
- no fourth attempt.

Each actual network attempt is independently wrapped in `kufarRateLimiter.schedule(...)`. Backoff waits happen before submitting the next attempt, so retries obey both exponential backoff and the global platform cadence.

Classification:

- `2xx` -> success immediately;
- network error -> retry, then `temporary/network` when exhausted;
- Undici timeout/abort timeout code -> retry, then `temporary/timeout` when exhausted;
- `5xx` -> retry, then `temporary/server` when exhausted;
- `429` -> never retry; apply limiter cooldown and return `rate-limited` immediately;
- other `4xx` -> `permanent/client`, no retry;
- other non-2xx statuses (for example an unexpected `3xx`) -> `permanent/unexpected-status`, no retry.

The client does not follow application-level fallback channels. `1.3.4` may later choose fallback only for temporary failures, never for `rate-limited`.

## 429 cooldown

Extend `RateLimiter` with:

```ts
deferNextStart(delayMs: number): void
```

The value is a finite non-negative integer. The limiter stores a global `notBefore` timestamp using `max(currentNotBefore, Date.now() + delayMs)`. Its existing scheduling gate becomes the later of:

- normal previous-start + sampled cadence delay;
- `notBefore`.

Once wall-clock time reaches the deferred timestamp, normal 2–5 second cadence automatically resumes. This satisfies the project rule that a 429 slows the shared limiter but does not rewrite a monitor's user-configured schedule.

For HTTP `429`:

- parse `Retry-After` as integer seconds or HTTP-date when valid;
- choose `cooldownMs = max(5_000, parsedRetryAfterMs)`;
- when absent/invalid/past, use `5_000 ms`;
- call `kufarRateLimiter.deferNextStart(cooldownMs)`;
- return `kind: 'rate-limited'` with `retryAfterMs = cooldownMs`;
- perform no retry and no fallback.

The five-second floor matches the product health prototype wording `ответ 429, темп снижен до 5 с` and stays within the established courtesy model without inventing persistent adaptive scheduling.

## Health persistence boundary

The domain model explicitly says pre-`0.6.0` health events are stored in `Run`; task `2.4.3` owns creation/finalization of `Run` and specifically requires that a `429` event appears there. Therefore `1.2.2` returns the typed `health` descriptor above. `2.4.3` persists that descriptor into `Run.outcome` / `Run.error` as part of the actual run lifecycle.

This is deliberate dependency alignment, not silent loss of the health requirement: persisting a synthetic `Run` inside a low-level HTTP client would require a monitor/run identity that does not exist for every caller (for example future preview requests) and would duplicate the run-journal responsibility.

## TDD plan

Use Vitest fake timers and module mocks; no real network requests.

RED coverage:

1. rate limiter `deferNextStart()` holds the next queued start until the global cooldown and automatically returns to normal cadence;
2. success goes through `kufarRateLimiter.schedule`, consumes text, and returns status/body/attempt count;
3. a network failure followed by success retries after virtual backoff and schedules both attempts through the limiter;
4. Undici timeout error is classified as timeout and obeys the same bounded retry policy;
5. `503` retries and eventually succeeds; three `5xx` responses exhaust into `temporary/server`;
6. non-429 `4xx` returns `permanent/client` after one attempt;
7. unexpected `3xx` returns permanent without retry;
8. `429` returns a distinct signal, never retries, and calls `deferNextStart(5000)` when no valid header exists;
9. `Retry-After` seconds/date values extend the global cooldown above the five-second floor;
10. invalid/foreign URLs are rejected before limiter/transport;
11. module exports contain no raw Undici request/dispatcher/factory path.

Then implement the minimal code, update the dependency lockfile, run exact-SHA full CI, align task/docs, create a technical PR, require PR merge-result CI, and normal-merge into `main`.

## Out of scope

- JSON/schema validation and adapter parsing;
- raw-response snapshot retention (`1.2.3`);
- HTML fallback (`1.3.4`);
- monitor/run lifecycle persistence (`2.4`);
- `HealthEvent` table (`0.3.6` / slice `0.6.0`);
- adaptive monitor intervals;
- proxy/IP/header rotation or any anti-block bypass;
- non-Kufar hosts;
- non-GET methods.
