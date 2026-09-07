# Design — 1.2.2 Kufar HTTP client

Date: 2026-09-07
Task: `docs/tasks/1-2-2-http-client.md`
Epic: `1.2` HTTP client and limiter

## Scope

Introduce the first worker-process Kufar HTTP client on top of the global rate limiter from `1.2.1`. The client owns request timeout/retry/error policy and converts transport/status failures into a structured result instead of leaking raw exceptions.

Every actual HTTP attempt, including retries, must pass through the same global limiter. The client does not parse Kufar JSON schemas, switch fallback channels, persist raw response snapshots, schedule monitors, or create `HealthEvent`.

Task `2.4.3` owns `Run` creation/finalization. The data-model spec says that, before `HealthEvent` exists in slice `0.6.0`, rate-limit health information is stored on `Run`. Therefore `1.2.2` returns a run-ready `rate-limited` outcome; it does not write Prisma records itself or invent a temporary persistence layer.

## Dependency choice

Add Undici as an explicit runtime dependency.

The repository declares `node >=22 <23`. Undici's current LTS table says:

- 7.x supports Node `>=20.18.1`, including the repository's full Node 22 range;
- 8.x requires Node `>=22.19.0`, which is narrower than the repository engine declaration.

Use the current 7.x release (`7.29.1` at design time) and do not change the repository Node engine for this task. Retry behavior remains explicit project code rather than an Undici retry interceptor so project-specific `429` semantics cannot be bypassed accidentally.

## Architecture

Keep two responsibilities separate in `electron/worker/`:

1. `kufar-rate-limiter.ts` remains the single global FIFO/concurrency-one scheduling gate and receives only one new capability: a temporary global cooldown.
2. new `kufar-http-client.ts` owns transport invocation, timeout configuration, HTTP classification, bounded retries, exponential backoff, and `429` handling.

The client uses `undici.request` with an explicit `Agent` dispatcher. It does not call `setGlobalDispatcher()`, because changing process-global Undici state could affect unrelated HTTP users later.

The transport, limiter, and retry sleep are injectable for unit tests. Production defaults use the worker's shared limiter and an Undici-backed transport. This is dependency injection for testability, not a second production request path: all production Kufar requests must enter through `KufarHttpClient`.

## Rate limiter cooldown

Extend `RateLimiter` with:

```ts
imposeCooldown(delayMs: number): void
```

`delayMs` must be a finite non-negative integer. The limiter stores `cooldownUntil` and updates it as:

```ts
cooldownUntil = Math.max(cooldownUntil, Date.now() + delayMs)
```

Before each queued operation starts, the limiter waits until the later of:

- the existing previous-start plus sampled 2–5 second cadence gate;
- `cooldownUntil`.

A shorter later cooldown never shortens an already active cooldown. Once wall-clock time passes `cooldownUntil`, the normal 2–5 second cadence resumes automatically. The limiter does not mutate `Monitor.intervalSec` or any persistent schedule setting.

## Transport boundary

The policy client depends on a narrow transport interface:

```ts
interface KufarTransport {
  request(input: {
    url: URL
    method: 'GET'
    headers?: Record<string, string>
  }): Promise<{
    status: number
    headers: Record<string, string | string[]>
    body: Uint8Array
  }>

  close(): Promise<void>
}
```

Production transport uses one `Agent` for its lifetime and calls `undici.request(..., { dispatcher: agent })`.

Timeout defaults:

- `connectTimeout = 10_000 ms`;
- `headersTimeout = 15_000 ms`;
- `bodyTimeout = 30_000 ms`.

These are application operational defaults, not inferred Kufar platform limits. They remain configurable for tests.

An attempt is considered complete only after its response body has been fully consumed into `Uint8Array`. The whole attempt, including body consumption, remains inside `limiter.schedule(...)`; another Kufar attempt must not start while the current response is still being consumed.

The transport owns its Agent and exposes `close()`. Task `1.2.2` does not wire the client into `worker/runtime.ts`, because the runtime does not yet own network traversals. The first real owner of the client will create/close it when traversal lifecycle is introduced.

Only `GET` is required in this increment. Confirmed search/count/detail access is read-only, so POST/streaming support is YAGNI here.

## HTTP client API and result contract

`KufarHttpClient` exposes GET and close operations. Construction accepts injectable transport, limiter, retry sleep, and policy values; production defaults use the Undici transport and global limiter.

Structured result:

```ts
type KufarHttpResult =
  | {
      ok: true
      status: number
      body: Uint8Array
      headers: Record<string, string | string[]>
      attempts: number
    }
  | {
      ok: false
      kind: 'temporary' | 'permanent' | 'rate-limited'
      code:
        | 'network'
        | 'timeout'
        | 'http-4xx'
        | 'http-5xx'
        | 'unexpected-http'
        | 'rate-limited'
      status: number | null
      attempts: number
      message: string
      retryAfterMs?: number
    }
```

`attempts` is the number of network attempts actually made. JSON parsing and response-shape validation remain adapter responsibilities in later tasks.

Messages are stable/safe summaries. They do not include raw exception dumps or raw response bodies.

## Retry and classification policy

Defaults:

- maximum attempts: `3` total;
- exponential retry delay base: `500 ms`;
- after attempt 1 temporary failure: wait `500 ms`;
- after attempt 2 temporary failure: wait `1_000 ms`;
- no fourth attempt.

The retry sleep occurs before the next call to `limiter.schedule(...)`. Therefore each retry obeys both the HTTP-level backoff and the global platform cadence.

Classification:

- `2xx` -> success immediately;
- network transport error -> retry, then `temporary/network` when exhausted;
- Undici timeout codes `UND_ERR_CONNECT_TIMEOUT`, `UND_ERR_HEADERS_TIMEOUT`, and `UND_ERR_BODY_TIMEOUT` -> retry, then `temporary/timeout` when exhausted;
- other thrown Undici/transport errors, including a generic `UND_ERR_ABORTED`, -> retry as `network` because this task exposes no caller cancellation API;
- `5xx` -> retry, then `temporary/http-5xx` when exhausted;
- `429` -> never retry; impose global cooldown and return `rate-limited` immediately;
- other `4xx` -> `permanent/http-4xx`, no retry;
- all other non-`2xx` statuses, including `3xx` -> `permanent/unexpected-http`, no retry.

Automatic redirect following is not enabled for the Kufar API client. An unexpected redirect should surface as a classified result rather than silently changing the endpoint contract.

HTTP-level retries here are distinct from task `2.4.4`, which later retries a whole failed traversal/job. `1.2.2` retries only a single HTTP request attempt sequence.

## 429 policy

On `429`:

1. do not retry;
2. do not switch to fallback;
3. parse `Retry-After` when present as either integer seconds or HTTP-date;
4. if the header is missing, invalid, or resolves to a non-positive delay, use a conservative default cooldown of `60_000 ms`;
5. clamp the final cooldown to at most `900_000 ms` (15 minutes);
6. call `limiter.imposeCooldown(cooldownMs)`;
7. return `kind: 'rate-limited'`, `code: 'rate-limited'`, `status: 429`, and `retryAfterMs: cooldownMs`.

Repeated `429` responses can extend the global cooldown because the limiter keeps the later `cooldownUntil`; they cannot shorten an already active cooldown. After expiry the normal base cadence resumes automatically.

The returned `rate-limited` result is the explicit health signal required by `1.2.2`. Task `2.4.3` will map it into `Run.outcome` / `Run.error` while owning the actual run identity and persistence lifecycle.

## TDD strategy

Use Vitest fake timers and injected/stubbed dependencies. No real Kufar request is required for policy tests.

RED coverage for the limiter:

1. cooldown delays the next queued request;
2. a shorter subsequent cooldown does not reduce an active one;
3. after cooldown expires, the existing normal cadence is used again.

RED coverage for the HTTP client:

1. every network attempt, including retry attempts, passes through the limiter;
2. network failure followed by success retries and returns success;
3. timeout failure followed by success retries and returns success;
4. `5xx` followed by success retries and returns success;
5. three temporary attempts exhaust into a `temporary` result;
6. non-429 `4xx` returns `permanent` after one attempt;
7. `429` returns `rate-limited`, performs no retry, and imposes cooldown;
8. `Retry-After` seconds and HTTP-date are parsed;
9. missing/invalid `Retry-After` uses 60 seconds;
10. excessive `Retry-After` is clamped to 15 minutes;
11. `3xx` returns `unexpected-http` without retry;
12. successful response preserves raw `Uint8Array`, headers, status, and actual attempt count.

A separate Undici wrapper test is added only if the wrapper contains non-trivial behavior beyond straightforward option wiring. Otherwise policy tests plus TypeScript typecheck are sufficient; tests are not added merely for line coverage.

## Expected repository changes

Production/code scope:

- modify `electron/worker/kufar-rate-limiter.ts`;
- add `electron/worker/kufar-http-client.ts`;
- update `package.json` and `package-lock.json` for explicit Undici dependency.

Tests:

- extend `tests/unit/kufar-rate-limiter.test.ts`;
- add `tests/unit/kufar-http-client.test.ts`;
- add a focused transport test only if implementation complexity justifies it.

Documentation:

- align `docs/tasks/1-2-2-http-client.md` with implemented ownership boundaries and final evidence;
- keep the canonical platform rules in `docs/superpowers/specs/kufar-api-contract.md` unchanged unless implementation reveals a genuine contract issue.

## Out of scope

- JSON/schema validation and adapter parsing;
- raw-response journal/snapshot retention (`1.2.3`);
- HTML fallback/degradation switching (`1.3.4`);
- scheduler/job retries (`2.4.4`);
- run lifecycle persistence (`2.4.3`);
- `HealthEvent` table or early Prisma schema changes;
- wiring monitor traversals into the current worker runtime;
- adaptive persistent monitor intervals;
- proxy/IP/header rotation or any anti-block bypass;
- non-GET methods.
