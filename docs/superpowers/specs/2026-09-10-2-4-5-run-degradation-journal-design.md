# 2.4.5 — Run-scoped source degradation journal design

Date: 2026-09-10
Status: approved approach, design pending final review
Owner: backend / scheduler / source runtime

## Problem

`KufarResilientSource` already emits a typed `SourceDegradationEvent` when the primary JSON API fails with an eligible temporary error and the HTML fallback succeeds. The source-layer contract in task `1.3.4` explicitly delegates persistence of that degradation to the Run journal owned by `2.4.3`.

The current production wiring loses that contract in two places:

1. `worker-source-runtime.ts` converts the typed degradation event into one generic warning message and discards the event metadata before a concrete scheduled `Run.id` is known.
2. `monitor-run-persistence.ts` uses `Run.degradedLevel` for `watermark-catchup`, although catch-up already has the distinct `Run.outcome = 'catchup'` state. Success and error finalization also overwrite `degradedLevel`, so even an earlier source-degradation write would not survive the end of the run.

The result is a silent data-model mismatch: fallback use is visible only as a transient warning, while the durable Run row cannot answer whether that traversal used degraded source data.

## Goals

- Bind every source-degradation event to the exact scheduled Run that experienced it.
- Persist `Run.degradedLevel = 'html-fallback'` when HTML fallback is used successfully at least once during that Run.
- Make degradation sticky for the lifetime of the Run: later success, catch-up completion, or a later error must not erase it.
- Keep `Run.outcome = 'catchup'` as the only representation of watermark catch-up; `degradedLevel` must no longer contain `watermark-catchup`.
- Publish one user-visible warning for the first fallback use in a Run.
- Avoid duplicate database writes and warnings when several pages in the same traversal use fallback.
- Reuse the existing shared HTTP client, raw-response journal, primary/fallback adapters, limiter, and description cache.
- Require no Prisma schema migration.

## Non-goals

- Do not implement automatic monitor pause; task/epic `4.3` owns that state transition.
- Do not add health aggregation, `HealthEvent`, `AdapterState`, streak counters, or alert policies.
- Do not change HTTP retry/cooldown behavior or pg-boss retry policy.
- Do not change watermark traversal, catch-up paging semantics, matching, or description-fetch budgets.
- Do not create a second HTTP client or limiter per Run.

## Considered approaches

### 1. Put execution callbacks into `SourcePageRequest`

Rejected. `SourcePageRequest` is a shared domain interface and currently contains only query/cursor data. Adding `runId`, callbacks, or persistence concerns would couple the source-adapter contract to scheduler execution and make every adapter consumer aware of Run lifecycle details.

### 2. Use `AsyncLocalStorage` for ambient Run context

Rejected. It avoids visible interface changes but makes the binding implicit, harder to test, and easier to break across utility-process async boundaries. The repository already favors explicit typed seams.

### 3. Create run-scoped resilient wrappers over shared source resources

Selected. `KufarResilientSource` is lightweight; the expensive/stateful resources are the HTTP client, limiter, raw-response journal, and description cache. We can keep those shared while constructing a small adapter registry for each scheduled Run with a degradation sink bound to that Run.

## Architecture

### Worker source runtime

Change `WorkerSourceRuntime` from exposing one global resilient `adapters` registry to exposing a factory:

```ts
interface WorkerSourceRuntime {
  createRunAdapters(onDegradation: SourceDegradationSink): SourceAdapterRegistry
  descriptionLoader: DescriptionLoader
  close(): Promise<void>
}
```

`createWorkerSourceRuntime()` continues to create exactly one raw-response journal, one `KufarHttpClient`, one pair of primary/fallback adapters per supported vertical, and one `ListingDescriptionCache`.

`createRunAdapters()` creates only new `KufarResilientSource` wrappers and a new registry. Those wrappers share the already-created primary/fallback adapters and therefore share the existing HTTP client and global rate limiter.

`WorkerSourceRuntimeOptions.onDegradation` is removed because degradation is no longer a process-global callback; it is run-scoped.

### Scheduled executor

`ScheduledMonitorRunExecutorOptions` receives a run-adapter factory instead of a prebuilt registry:

```ts
createRunAdapters(onDegradation: SourceDegradationSink): SourceAdapterRegistry
```

After overlap handling and after creating `Run(outcome='running')`, the executor knows both `monitorId` and `runId`. It then creates a degradation sink scoped to that Run and obtains the adapter registry for that execution.

The sink performs, in order:

1. If degradation was already recorded for this Run, return immediately.
2. Update that Run row with `degradedLevel: 'html-fallback'`.
3. Mark the local run-scoped sink as recorded.
4. Await the application-level notification callback so the existing warning remains user-visible.

The local idempotency flag prevents multiple fallback pages from creating multiple Run updates or multiple warnings.

The flag is set only after the database update succeeds. If persistence fails, the sink throws; `KufarResilientSource` already converts degradation-sink failure to `KufarResilientSourceError(action='fail-run', stage='degradation-event')`. This preserves the current fail-closed behavior: a degraded traversal is not silently accepted when its degradation cannot be journaled.

### Application notification seam

`ScheduledMonitorRunExecutorOptions` adds an optional typed callback such as:

```ts
onSourceDegradation?: (
  monitorId: number,
  event: SourceDegradationEvent,
) => void | Promise<void>
```

`worker-application.ts` wires it to the existing journal event, preserving the current user-visible warning text (`Kufar source degraded to HTML fallback`). The typed source event remains available at the executor boundary for future health/reporting work, but this task does not add new `WorkerEvent` variants or health storage.

The application does not perform the Run update. Persistence remains owned by the scheduled executor, which is the component that owns the concrete `runId` lifecycle.

## Run persistence semantics

`Run.degradedLevel` becomes source-degradation metadata only.

### Scheduled success / catch-up

When `runId` is present, `persistSuccessfulRun()` updates outcome/counters/error fields but does not write `degradedLevel` at all. Therefore:

- normal success without fallback: the initial `null` remains `null`;
- catch-up without fallback: `outcome='catchup'`, `degradedLevel=null`;
- success/catch-up after fallback: `degradedLevel='html-fallback'` remains intact.

The legacy path where no `runId` is supplied still creates a completed Run and may explicitly write `degradedLevel: null`, because it has no run-scoped degradation sink.

### Scheduled cold start

When `runId` is present, cold-start finalization likewise omits `degradedLevel` so a fallback used during baseline traversal remains durable. The standalone create path remains `null`.

### Scheduled error

The executor error-finalization update must stop setting `degradedLevel: null`. A failure after an earlier fallback therefore produces, for example:

```text
outcome = error
degradedLevel = html-fallback
errorCategory = source
...
```

A failure before any fallback leaves the initial `degradedLevel` null.

### Overlap

Overlap never performs a traversal, so its completed `Run(outcome='skipped')` continues to use `degradedLevel: null`.

## Ordering and concurrency

The degradation sink is awaited by `KufarResilientSource` before the fallback page is returned to traversal. Final Run persistence happens only later, after traversal/matching (or in the executor catch path). Therefore a degradation update cannot race with normal Run finalization for the same execution.

Each scheduled execution creates its own sink closure and idempotency flag. Different monitors and pg-boss retry attempts have independent Run rows and independent degradation state.

A pg-boss retry is a new traversal and therefore a new Run. If both attempts use fallback, each Run correctly records its own `html-fallback` degradation.

## Error handling

- Failure of the primary source with no successful fallback: no degradation is recorded.
- Successful fallback + successful journal update: traversal continues and the Run is marked degraded.
- Successful fallback + failed Run degradation update: sink rejects; existing resilient-source logic fails the traversal at `degradation-event`.
- Successful degradation update + failed application warning callback: the Run remains marked `html-fallback`; the callback failure is surfaced as the existing resilient-source `degradation-event` failure and the Run later finalizes as error without erasing degradation.
- A later page/source/matching error after fallback finalizes the Run as error while preserving `html-fallback`.

Unknown raw exception messages continue to follow the safe error-journal rules introduced in `2.4.3`; this task does not change secret-handling policy.

## Testing strategy

Implementation follows TDD with separate RED/GREEN evidence for each behavior boundary.

1. **Persistence semantics**
   - RED: incremental catch-up currently writes `degradedLevel='watermark-catchup'`.
   - GREEN: catch-up uses only `outcome='catchup'` and scheduled success/catch-up updates preserve a pre-existing `html-fallback` value.
   - Cold-start scheduled finalization also preserves a pre-existing degradation value.
   - Error finalization preserves a pre-existing degradation value.

2. **Run-scoped source adapters**
   - RED: source runtime currently exposes one global registry/callback.
   - GREEN: `createRunAdapters(sink)` creates isolated resilient wrappers while reusing one shared HTTP client/journal/description cache.

3. **Executor binding and idempotency**
   - RED: successful fallback is not tied to the newly created `runId`.
   - GREEN: fallback updates that exact Run to `html-fallback` and invokes the notification callback once.
   - Multiple fallback pages in one Run perform one degradation update and one warning.

4. **End-to-end Run lifecycle**
   - Scheduled incremental success after fallback: outcome success + `html-fallback`.
   - Scheduled catch-up after fallback: outcome catchup + `html-fallback`.
   - Scheduled cold start after fallback: outcome success + `html-fallback`.
   - Fallback followed by a later error: outcome error + `html-fallback`.
   - Catch-up without fallback: outcome catchup + degradation null.

5. **Regression gates**
   - Existing `pause-required`, retry/no-retry, overlap, source fallback, PostgreSQL, build, and Electron smoke tests remain green.

At least one PostgreSQL integration assertion must read the completed Run row after a degraded traversal and verify both the final outcome and `degradedLevel` together. No sleep-based or timing-dependent acceptance test is required.

## Documentation closure

Create task `2.4.5` under epic `2.4` and update its rollup to `5/5` when implementation is complete. Update `1.3.4` and `2.4.3` notes so they no longer describe the Run binding as future work. Generated operations/status rollups must be refreshed through `docs:ops:refresh`, not edited by hand.

This remediation does not change release scope counts unless the repository's docs tooling counts newly added remediation cards; generated counts are authoritative.

## Acceptance criteria

- A scheduled Run that uses HTML fallback at least once ends with `degradedLevel='html-fallback'`.
- The value survives success, catch-up, cold-start completion, and a later error.
- Catch-up without fallback has `outcome='catchup'` and does not misuse `degradedLevel`.
- Multiple fallback pages within one Run create only one degradation persistence write and one warning.
- Different Runs remain isolated.
- No new Prisma migration is introduced.
- No duplicate HTTP client, limiter, raw-response journal, or description cache is created per Run.
- Full repository verify pipeline is green on the final feature HEAD and again on the PR-triggered HEAD before merge.
