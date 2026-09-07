# Design — 1.2.1 Global Kufar rate limiter

Date: 2026-09-07
Task: `docs/tasks/1-2-1-rate-limiter.md`
Epic: `1.2` HTTP client and limiter

## Scope

Add the worker-process primitive that serializes every future request to Kufar and spaces request starts according to the live platform contract. This task does not implement HTTP, retries, `429` handling, raw-response logging, adapters, or scheduler behavior.

The follow-up HTTP client in `1.2.2` must use this primitive as its only scheduling path. The stronger acceptance statement that application code cannot bypass the limiter becomes fully enforceable only when that client exists; `1.2.1` establishes the singleton boundary it will consume.

## Contract

The live contract specifies one global limiter across all Kufar hosts, with an aggregate request cadence of one request every 2–5 seconds. The limiter therefore has production defaults:

- `minIntervalMs = 2000`
- jitter uniformly sampled as an integer number of milliseconds from inclusive range `[0, 3000]`
- effective delay between consecutive request starts: `2000..5000` milliseconds
- concurrency: exactly `1`
- queue ordering: FIFO

The first scheduled operation may start immediately.

## API and location

Create `electron/worker/kufar-rate-limiter.ts`.

Public production surface:

- `RateLimiter` class, exported so its behavior can be unit-tested with isolated instances.
- `kufarRateLimiter`, one module-level singleton configured with production defaults for worker code.
- `schedule<T>(operation: () => Promise<T>): Promise<T>` as the only operation API.

Configuration is constructor-based and includes `minIntervalMs`, jitter bounds, and an injectable random source. The random source defaults to `Math.random`; tests inject deterministic values instead of mocking global randomness.

All millisecond configuration values must be finite, non-negative integers. `jitterMaxMs` must be greater than or equal to `jitterMinMs`. Invalid configuration fails at construction time.

The random source must return a finite number in `[0, 1)`. A value outside that range is invalid and fails the affected scheduling call rather than silently distorting the configured cadence.

## Scheduling semantics

The limiter owns one FIFO promise chain.

For each queued operation:

1. Wait until the previous queued operation has settled, so operations never overlap.
2. Compute the next allowed start time from the previous actual start time plus one sampled effective delay.
3. If that time is still in the future, wait with `setTimeout` for the remaining duration.
4. Record the actual start time immediately before invoking the operation.
5. Resolve or reject the caller's promise with that operation's result.
6. Keep the internal queue chain alive even when an operation rejects, so later work still executes.

A delay is sampled once for each gap between two consecutive starts, not for the first operation.

If an operation itself runs longer than the sampled gap, the next operation starts immediately after it settles because both constraints are already satisfied: the previous operation has finished and the minimum start-to-start spacing has elapsed.

## Jitter semantics

Jitter is discrete at millisecond precision. For inclusive integer bounds `[jitterMinMs, jitterMaxMs]` and a random source value `r` in `[0, 1)`, calculate:

`jitterMs = jitterMinMs + floor(r * (jitterMaxMs - jitterMinMs + 1))`

This makes every integer millisecond in the configured inclusive range reachable. Production `[0, 3000]` plus the `2000 ms` base interval yields the specified 2–5 second total cadence.

Tests assert the lower boundary with `r = 0` and the upper boundary with a deterministic value immediately below `1`, without using real sleeps.

## Worker singleton boundary

`kufarRateLimiter` is instantiated once by module evaluation inside the Electron utility-process worker. All future Kufar HTTP code in `1.2.2` imports this singleton rather than constructing a production limiter per client or per monitor.

The class remains exported for tests and possible dependency injection into the HTTP client test harness. Application scheduling code should not instantiate independent production limiters.

This task does not attempt to prohibit direct use of Node/Undici networking APIs repo-wide. That enforcement belongs to `1.2.2`, when the actual HTTP client is introduced and can expose no unthrottled alternative.

## Error behavior

An operation rejection, including a synchronous throw during callback invocation, is returned unchanged to that operation's caller. It does not poison the internal FIFO chain and does not remove spacing requirements for later queued operations.

An invalid injected random value rejects the affected scheduling call and the internal queue remains usable for later calls.

The limiter does not classify network failures, retry requests, change cadence after `429`, or emit health events. Those behaviors belong to `1.2.2` and later health tasks.

## TDD plan

Use Vitest fake timers; no test waits on wall-clock time. Context7-confirmed Vitest APIs include `vi.useFakeTimers()`, async timer advancement, and `vi.setSystemTime()`.

RED tests cover:

- ten concurrent `schedule()` calls run FIFO with concurrency never exceeding one;
- consecutive starts respect the configured base interval;
- deterministic random values hit the lower and upper jitter boundaries;
- a long-running operation does not add an unnecessary second delay after the start-spacing requirement has already elapsed;
- one rejected operation rejects only its own promise and the following queued operation still runs;
- an invalid random-source value rejects only the affected call and does not poison the queue;
- production defaults produce effective gaps in the 2–5 second contract range;
- repeated imports within the worker module graph expose the same `kufarRateLimiter` singleton.

Then add the minimal production implementation required to make those tests pass, followed by the repository's full verify workflow on the exact feature HEAD.

## Out of scope

- `undici` HTTP client implementation;
- connect/response timeouts;
- retries or exponential backoff;
- special `429` cadence adaptation;
- host-specific limits;
- parallel request lanes;
- scheduler no-overlap logic;
- HTML/API fallback behavior;
- raw response journal.

## Documentation alignment

When implementation is verified, update `1.2.1` to `done/aligned` and clarify its fourth acceptance criterion: `1.2.1` provides the single worker singleton and queue boundary; `1.2.2` completes technical prevention of an unthrottled application HTTP path.