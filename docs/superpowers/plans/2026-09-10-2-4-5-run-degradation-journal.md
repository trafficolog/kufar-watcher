# 2.4.5 Run-Scoped Source Degradation Journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist HTML-fallback use on the exact scheduled `Run` as sticky `degradedLevel='html-fallback'` metadata while keeping catch-up represented only by `Run.outcome='catchup'`.

**Architecture:** Keep one shared source runtime with one HTTP client, limiter, raw-response journal, vertical primary/fallback adapters, and description cache. Replace its process-global resilient adapter registry with `createRunAdapters(onDegradation)`, so the scheduled executor can bind a lightweight resilient wrapper to the concrete `runId` after creating the running journal row. Run finalization must stop overwriting `degradedLevel`, allowing a previously persisted fallback marker to survive success, catch-up, cold-start completion, or a later error.

**Tech Stack:** TypeScript 6.0.2, Vitest 5.0.0, Prisma 7.10.0/PostgreSQL, Electron 44 utility process, existing `KufarResilientSource` / source-adapter registry.

**Spec:** `docs/superpowers/specs/2026-09-10-2-4-5-run-degradation-journal-design.md`

## Global Constraints

- `Run.degradedLevel` is source-degradation metadata only; do not store `watermark-catchup` there.
- The only persisted degradation value introduced by this task is exactly `html-fallback`.
- Degradation is sticky for one Run: success, catch-up, cold-start finalization, and later error updates must not erase it.
- One Run may perform at most one degradation DB update and one application warning, even if several pages use fallback.
- A pg-boss retry is a new Run with independent degradation state.
- Keep exactly one shared HTTP client/global limiter/raw-response journal/description cache per worker source runtime.
- Do not add a Prisma migration; the existing nullable `Run.degradedLevel` column is sufficient.
- Do not implement auto-pause, health aggregation, retry-policy changes, watermark changes, or description-request budgeting.
- Preserve existing safe error-journal behavior: unknown raw exception messages must not be persisted.
- Use TDD: each behavior change starts with an observed failing test and is committed in a narrow RED/GREEN cycle.

---

## File Map

- `electron/worker/monitor-run-persistence.ts` — scheduled incremental success/catch-up finalization; must stop writing `watermark-catchup` or clearing prior degradation.
- `electron/worker/cold-start-persistence.ts` — scheduled cold-start finalization; must preserve prior degradation.
- `electron/worker/scheduled-monitor-run.ts` — owns concrete `runId`; will bind the run-scoped degradation sink, deduplicate it, preserve degradation on errors, and choose adapters from a run-scoped factory.
- `electron/worker/worker-source-runtime.ts` — owns shared HTTP/source resources and creates lightweight run-scoped resilient wrappers/registries.
- `electron/worker/worker-application.ts` — wires the run-adapter factory and application warning callback into the executor.
- `tests/integration/monitor-run-persistence.test.ts` — verifies catch-up semantics and same-row preservation against real PostgreSQL.
- `tests/unit/cold-start-persistence.test.ts` — verifies scheduled cold-start update does not clear `degradedLevel`.
- `tests/unit/scheduled-monitor-run.test.ts` — verifies exact-Run binding, one-time degradation persistence/warning, and error preservation.
- `tests/unit/worker-source-runtime.test.ts` — verifies run-scoped wrappers reuse shared HTTP resources and await the supplied typed sink.
- `tests/unit/worker-application.test.ts` — verifies production composition uses `createRunAdapters` and publishes the existing warning.
- `tests/integration/run-journal.test.ts` — end-to-end PostgreSQL assertion of final outcome plus sticky `html-fallback` on the same Run.
- `docs/tasks/2-4-5-run-degradation-journal.md` — remediation task card.
- `docs/tasks/1-3-4-html-fallback.md`, `docs/tasks/2-4-3-run-journal.md`, `docs/epics/2-4-scheduler.md` — closure notes/rollup source docs.
- generated docs under `docs/operations/status/**` and phase/roadmap rollups — update only through `npm run docs:ops:refresh`.

---

### Task 1: Correct Run persistence semantics

**Files:**
- Modify: `tests/integration/monitor-run-persistence.test.ts`
- Modify: `tests/unit/cold-start-persistence.test.ts`
- Modify: `tests/unit/scheduled-monitor-run.test.ts`
- Modify: `electron/worker/monitor-run-persistence.ts`
- Modify: `electron/worker/cold-start-persistence.ts`
- Modify: `electron/worker/scheduled-monitor-run.ts`

**Interfaces:**
- Consumes: existing `MonitorRunPersistenceInput.runId?: number`, `ColdStartPersistenceInput.runId?: number`, existing `Run.degradedLevel: string | null`.
- Produces: scheduled finalization updates that omit `degradedLevel`; standalone create paths continue creating `degradedLevel: null`.

- [ ] **Step 1: Write RED tests for incremental catch-up semantics and preservation**

In `tests/integration/monitor-run-persistence.test.ts`, first change the existing incomplete-catch-up assertion:

```ts
expect(run.outcome).toBe('catchup')
expect(run.degradedLevel).toBeNull()
```

Then add a scheduled same-row preservation test that creates a running Run before `commitMonitorRun`:

```ts
it('preserves an existing html-fallback marker when finalizing a scheduled catch-up run', async () => {
  const running = await prisma.run.create({
    data: {
      monitorId: MONITOR_ID,
      startedAt: new Date('2026-09-08T11:01:00.000Z'),
      outcome: 'running',
      degradedLevel: 'html-fallback',
    },
  })

  const persistenceInput = input(incompleteTraversal())
  persistenceInput.runId = running.id
  await commitMonitorRun(prisma, persistenceInput)

  const run = await prisma.run.findUniqueOrThrow({ where: { id: running.id } })
  expect(run.outcome).toBe('catchup')
  expect(run.degradedLevel).toBe('html-fallback')
})
```

- [ ] **Step 2: Run the focused integration test and confirm RED**

Run:

```bash
KUFAR_POSTGRES_INTEGRATION=1 npm test -- tests/integration/monitor-run-persistence.test.ts
```

Expected: the existing catch-up assertion fails because production writes `watermark-catchup`; the scheduled preservation test fails because finalization overwrites `html-fallback`.

- [ ] **Step 3: Write RED tests for cold-start and error preservation**

In `tests/unit/cold-start-persistence.test.ts`, extend the scheduled `runId` update expectation so `data` does **not** contain `degradedLevel`:

```ts
expect(tx.run.update).toHaveBeenCalledWith({
  where: { id: 9001 },
  data: expect.not.objectContaining({ degradedLevel: expect.anything() }),
})
```

If the existing test asserts the entire object, replace only the `degradedLevel: null` part with a separate absence assertion while preserving all existing outcome/counter assertions.

In `tests/unit/scheduled-monitor-run.test.ts`, update one error test to assert that error finalization no longer contains `degradedLevel: null`:

```ts
const update = runUpdate.mock.calls.at(-1)?.[0]
expect(update?.data).not.toHaveProperty('degradedLevel')
```

- [ ] **Step 4: Run the focused unit tests and confirm RED**

Run:

```bash
npm test -- tests/unit/cold-start-persistence.test.ts tests/unit/scheduled-monitor-run.test.ts
```

Expected: failures point to the currently explicit `degradedLevel: null` writes in cold-start/error finalization.

- [ ] **Step 5: Implement the minimal persistence change**

In `electron/worker/monitor-run-persistence.ts`, change only the scheduled `runId` update path:

```ts
await tx.run.update({
  where: { id: input.runId },
  data: {
    finishedAt: input.finishedAt,
    durationMs: Math.max(0, input.finishedAt.getTime() - input.startedAt.getTime()),
    outcome: isCatchup ? 'catchup' : 'success',
    seen: input.candidates.length,
    matched: input.selected.length,
    error: null,
    errorCategory: null,
    errorCode: null,
    httpStatus: null,
  },
})
```

Keep the legacy `tx.run.create(...)` path explicit with `degradedLevel: null`.

In `electron/worker/cold-start-persistence.ts`, remove `degradedLevel: null` only from the `input.runId !== undefined` update payload. Keep the standalone create path unchanged.

In `electron/worker/scheduled-monitor-run.ts`, remove `degradedLevel: null` only from error-finalization updates. Leave overlap creation as `degradedLevel: null` because no traversal occurs.

- [ ] **Step 6: Run the focused tests and confirm GREEN**

Run:

```bash
KUFAR_POSTGRES_INTEGRATION=1 npm test -- tests/integration/monitor-run-persistence.test.ts tests/unit/cold-start-persistence.test.ts tests/unit/scheduled-monitor-run.test.ts
```

Expected: PASS; catch-up uses only `outcome='catchup'`, and scheduled finalizers preserve a pre-existing degradation value by not touching the column.

- [ ] **Step 7: Commit Task 1**

```bash
git add electron/worker/monitor-run-persistence.ts electron/worker/cold-start-persistence.ts electron/worker/scheduled-monitor-run.ts tests/integration/monitor-run-persistence.test.ts tests/unit/cold-start-persistence.test.ts tests/unit/scheduled-monitor-run.test.ts
git commit -m "fix: preserve run source degradation metadata"
```

---

### Task 2: Make resilient adapters run-scoped while keeping source resources shared

**Files:**
- Modify: `tests/unit/worker-source-runtime.test.ts`
- Modify: `electron/worker/worker-source-runtime.ts`

**Interfaces:**
- Consumes: `SourceDegradationSink`, shared `KufarHttpClient`, primary/fallback `SourceAdapter`s, `SourceAdapterRegistry`.
- Produces:

```ts
export interface WorkerSourceRuntime {
  createRunAdapters(onDegradation: SourceDegradationSink): SourceAdapterRegistry
  descriptionLoader: DescriptionLoader
  close(): Promise<void>
}
```

`WorkerSourceRuntimeOptions` becomes:

```ts
export interface WorkerSourceRuntimeOptions {
  prisma: PrismaClient
  rawResponseJournalDir: string
}
```

- [ ] **Step 1: Write the RED source-runtime contract test**

Refactor the first `worker-source-runtime` test to create two run registries:

```ts
const sinkA = vi.fn()
const sinkB = vi.fn()
const adaptersA = runtime.createRunAdapters(sinkA)
const adaptersB = runtime.createRunAdapters(sinkB)

await adaptersA.get('electronics').fetchPage({ query: electronicsQuery, cursor: null })
await adaptersB.get('real-estate').fetchPage({ query: realEstateQuery, cursor: null })

expect(createJournal).toHaveBeenCalledOnce()
expect(createHttpClient).toHaveBeenCalledOnce()
expect(runtime.descriptionLoader).toBeTruthy()
```

Update the fallback test to supply the typed sink at registry creation time:

```ts
const onDegradation = vi.fn(async () => degradationGate.promise)
const adapters = runtime.createRunAdapters(onDegradation)
const pagePromise = adapters
  .get('electronics')
  .fetchPage({ query: electronicsQuery, cursor: null })
```

Assert the exact typed event already emitted by `KufarResilientSource`:

```ts
expect(onDegradation).toHaveBeenCalledWith({
  kind: 'source-degraded',
  channel: 'html-fallback',
  primaryFailureCode: 'network',
  primaryStatus: null,
})
```

- [ ] **Step 2: Run the source-runtime test and confirm RED**

Run:

```bash
npm test -- tests/unit/worker-source-runtime.test.ts
```

Expected: TypeScript/test failure because `WorkerSourceRuntime` still exposes `.adapters` and requires process-global `onDegradation` in its construction options.

- [ ] **Step 3: Implement the run-scoped adapter factory**

In `electron/worker/worker-source-runtime.ts`:

1. Import `SourceDegradationSink` from `./kufar-resilient-source`.
2. Remove `onDegradation` from `WorkerSourceRuntimeOptions`.
3. Keep `journal`, `httpClient`, primary adapters, fallback adapters, and `ListingDescriptionCache` constructed exactly once inside `createWorkerSourceRuntime()`.
4. Replace the current `resilientAdapter(..., onDegradation)` composition with a helper that accepts already-created primary/fallback adapters and a sink.
5. Return:

```ts
return {
  createRunAdapters(onDegradation) {
    return createSourceAdapterRegistry({
      electronics: resilientAdapter(electronicsPrimary, electronicsFallback, onDegradation),
      'real-estate': resilientAdapter(realEstatePrimary, realEstateFallback, onDegradation),
    })
  },
  descriptionLoader,
  close() {
    closePromise ??= httpClient.close()
    return closePromise
  },
}
```

Do not create a new `KufarHttpClient`, `FileKufarRawResponseJournal`, or `ListingDescriptionCache` inside `createRunAdapters`.

- [ ] **Step 4: Run source-runtime tests and static checks**

Run:

```bash
npm test -- tests/unit/worker-source-runtime.test.ts
npm run typecheck:electron
```

Expected: worker-source-runtime test GREEN; typecheck may still fail in `worker-application.ts` because Task 3 has not yet updated consumers. If so, record that expected consumer break and proceed directly to Task 3 without modifying unrelated files.

- [ ] **Step 5: Commit Task 2 only if the repository compiles; otherwise fold the interface consumer update into Task 3 before committing**

Preferred commit when compilation is self-contained:

```bash
git add electron/worker/worker-source-runtime.ts tests/unit/worker-source-runtime.test.ts
git commit -m "refactor: scope resilient adapters to monitor runs"
```

If the interface change necessarily breaks `worker-application.ts`, leave the working tree uncommitted and complete Task 3 before the combined commit; do not add compatibility shims solely to manufacture a green intermediate commit.

---

### Task 3: Bind source degradation to the concrete scheduled Run and wire production composition

**Files:**
- Modify: `tests/unit/scheduled-monitor-run.test.ts`
- Modify: `tests/unit/worker-application.test.ts`
- Modify: `electron/worker/scheduled-monitor-run.ts`
- Modify: `electron/worker/worker-application.ts`
- Modify: `electron/worker/worker-source-runtime.ts` if Task 2 and Task 3 must land atomically for type consistency.

**Interfaces:**
- Consumes: `SourceDegradationEvent`, `SourceDegradationSink`, `WorkerSourceRuntime.createRunAdapters`.
- Produces in `ScheduledMonitorRunExecutorOptions`:

```ts
createRunAdapters(onDegradation: SourceDegradationSink): SourceAdapterRegistry
onSourceDegradation?: (
  monitorId: number,
  event: SourceDegradationEvent,
) => void | Promise<void>
```

The old `adapters: SourceAdapterRegistry` option is removed.

- [ ] **Step 1: Write the RED executor test for exact-Run binding and one-time persistence**

Change `executorDependencies()` in `tests/unit/scheduled-monitor-run.test.ts` so it returns a `createRunAdapters` mock instead of a static registry. Add a test in which `runCycle` invokes the supplied degradation sink twice:

```ts
it('records html fallback once on the exact running row and publishes one warning', async () => {
  const { prisma, runUpdate, adapters, descriptionLoader } = executorDependencies()
  let degradationSink: SourceDegradationSink | undefined
  const createRunAdapters = vi.fn((sink: SourceDegradationSink) => {
    degradationSink = sink
    return adapters
  })
  const onSourceDegradation = vi.fn()
  const event: SourceDegradationEvent = {
    kind: 'source-degraded',
    channel: 'html-fallback',
    primaryFailureCode: 'network',
    primaryStatus: null,
  }
  const runCycle = vi.fn(async () => {
    await degradationSink?.(event)
    await degradationSink?.(event)
    return coldStartResult
  })

  const executor = createScheduledMonitorRunExecutor({
    prisma,
    createRunAdapters,
    maxPages: 5,
    descriptionLoader,
    runCycle: runCycle as never,
    onSourceDegradation,
  })

  await executor(17)

  expect(runUpdate).toHaveBeenCalledTimes(1)
  expect(runUpdate).toHaveBeenCalledWith({
    where: { id: 9001 },
    data: { degradedLevel: 'html-fallback' },
  })
  expect(onSourceDegradation).toHaveBeenCalledOnce()
  expect(onSourceDegradation).toHaveBeenCalledWith(17, event)
})
```

Because `runCycle` is mocked, no success-finalization update occurs in this test; the one `runUpdate` call is therefore unambiguous.

- [ ] **Step 2: Run the executor test and confirm RED**

Run:

```bash
npm test -- tests/unit/scheduled-monitor-run.test.ts
```

Expected: compilation/test failure because the executor still accepts static `adapters` and has no run-scoped degradation sink or `onSourceDegradation` callback.

- [ ] **Step 3: Implement run-scoped degradation binding in the executor**

In `electron/worker/scheduled-monitor-run.ts`:

1. Import `SourceDegradationEvent` and `SourceDegradationSink`.
2. Replace `adapters` in `ScheduledMonitorRunExecutorOptions` with `createRunAdapters`.
3. Add the exact `onSourceDegradation` callback signature above.
4. After `journalRun` is created, create one closure-local flag:

```ts
let degradationRecorded = false
const onDegradation: SourceDegradationSink = async (event) => {
  if (degradationRecorded) return

  await options.prisma.run.update({
    where: { id: journalRun.id },
    data: { degradedLevel: 'html-fallback' },
  })
  degradationRecorded = true
  await options.onSourceDegradation?.(monitorId, event)
}
```

5. Create the run registry once per execution:

```ts
const adapters = options.createRunAdapters(onDegradation)
```

6. Route the persisted query against that registry:

```ts
const adapter = adapters.get(routeKufarQuery(query))
```

Keep the current ordering: overlap is handled before creating a running Run; the running Run is created before adapters/cycle execution; monitor lock cleanup remains in `finally`.

- [ ] **Step 4: Add RED/GREEN coverage for degradation surviving a later error**

In `tests/unit/scheduled-monitor-run.test.ts`, add a test whose mocked cycle invokes the sink once and then throws an unexpected error. Assert two updates occur in this order:

```ts
expect(runUpdate).toHaveBeenNthCalledWith(1, {
  where: { id: 9001 },
  data: { degradedLevel: 'html-fallback' },
})
expect(runUpdate.mock.calls[1]?.[0].data).not.toHaveProperty('degradedLevel')
```

Also assert the second update still contains the existing sanitized internal error fields:

```ts
expect(runUpdate.mock.calls[1]?.[0].data).toMatchObject({
  outcome: 'error',
  error: 'Unexpected monitor run failure',
  errorCategory: 'internal',
  errorCode: 'unexpected',
})
```

- [ ] **Step 5: Rewrite worker-application composition test for the new interfaces**

In `tests/unit/worker-application.test.ts`, make the fake source runtime expose:

```ts
const createRunAdapters = vi.fn(() => adapters)
const sourceRuntime = {
  createRunAdapters,
  descriptionLoader,
  close: vi.fn(async () => undefined),
} as unknown as WorkerSourceRuntime
```

`createSourceRuntime` should now be expected to receive only:

```ts
expect.objectContaining({
  prisma,
  rawResponseJournalDir: config.rawResponseJournalDir,
})
```

Capture `ScheduledMonitorRunExecutorOptions['onSourceDegradation']` from `createRunExecutor`, invoke it with a typed degradation event, and assert the existing journal warning:

```ts
await sourceDegradation?.(17, {
  kind: 'source-degraded',
  channel: 'html-fallback',
  primaryFailureCode: 'network',
  primaryStatus: null,
})

expect(publish).toHaveBeenCalledWith({
  type: 'journal',
  level: 'warning',
  message: 'Kufar source degraded to HTML fallback',
})
```

Also assert `createRunExecutor` receives:

```ts
expect.objectContaining({
  prisma,
  createRunAdapters,
  maxPages: config.monitorMaxPages,
  descriptionLoader,
  onSourceDegradation: expect.any(Function),
  onPauseRequired: expect.any(Function),
})
```

- [ ] **Step 6: Implement worker-application wiring**

In `electron/worker/worker-application.ts`:

- remove `onDegradation` from `createSourceRuntime(...)` options;
- pass `createRunAdapters: sourceRuntime.createRunAdapters` into `createRunExecutor`;
- add:

```ts
onSourceDegradation() {
  publish({
    type: 'journal',
    level: 'warning',
    message: 'Kufar source degraded to HTML fallback',
  })
},
```

The callback may ignore event fields in this task; the executor still receives/preserves the typed event for future work.

- [ ] **Step 7: Run focused tests plus electron typecheck and confirm GREEN**

Run:

```bash
npm test -- tests/unit/worker-source-runtime.test.ts tests/unit/scheduled-monitor-run.test.ts tests/unit/worker-application.test.ts
npm run typecheck:electron
```

Expected: PASS. Confirm no test constructs a second HTTP client per Run.

- [ ] **Step 8: Commit Tasks 2–3 interface/wiring changes**

```bash
git add electron/worker/worker-source-runtime.ts electron/worker/scheduled-monitor-run.ts electron/worker/worker-application.ts tests/unit/worker-source-runtime.test.ts tests/unit/scheduled-monitor-run.test.ts tests/unit/worker-application.test.ts
git commit -m "feat: bind source degradation to scheduled runs"
```

---

### Task 4: Prove complete lifecycle behavior against PostgreSQL

**Files:**
- Modify: `tests/integration/run-journal.test.ts`
- Modify: `scripts/verify-postgres-compose.sh` only if the existing integration command does not already execute the new test; do not change it otherwise.

**Interfaces:**
- Consumes: production `createScheduledMonitorRunExecutor` with `createRunAdapters`, existing Prisma Run model.
- Produces: durable acceptance evidence that one completed Run carries both its final outcome and `degradedLevel='html-fallback'`.

- [ ] **Step 1: Update the integration executor helper for the run-adapter factory**

Replace static `adapters` construction with:

```ts
const createRunAdapters = () =>
  createSourceAdapterRegistry({
    electronics: adapter,
    'real-estate': adapter,
  })

return createScheduledMonitorRunExecutor({
  prisma,
  createRunAdapters,
  maxPages: 2,
  descriptionLoader: { ensureDescription: vi.fn() },
})
```

This preserves existing non-degraded integration cases.

- [ ] **Step 2: Write the RED degraded-success PostgreSQL test**

Add a helper that captures the sink and lets the fake adapter invoke it before returning a page:

```ts
it('keeps html-fallback degradation on the completed scheduled run', async () => {
  const adapter = {
    fetchPage: vi.fn().mockResolvedValue({ listings: [], nextCursor: null }),
  } as SourceAdapter
  let sink: SourceDegradationSink | undefined
  const executor = createScheduledMonitorRunExecutor({
    prisma,
    createRunAdapters(onDegradation) {
      sink = onDegradation
      return createSourceAdapterRegistry({
        electronics: {
          async fetchPage(request) {
            await sink?.({
              kind: 'source-degraded',
              channel: 'html-fallback',
              primaryFailureCode: 'network',
              primaryStatus: null,
            })
            return adapter.fetchPage(request)
          },
        },
        'real-estate': adapter,
      })
    },
    maxPages: 2,
    descriptionLoader: { ensureDescription: vi.fn() },
  })

  const result = await executor(MONITOR_ID)
  expect(result).toMatchObject({ cycleKind: 'cold-start' })

  const run = await prisma.run.findFirstOrThrow({ where: { monitorId: MONITOR_ID } })
  expect(run.outcome).toBe('success')
  expect(run.degradedLevel).toBe('html-fallback')
})
```

- [ ] **Step 3: Run the integration test and confirm RED before the final wiring is present; then rerun after Tasks 1–3 and confirm GREEN**

Run:

```bash
KUFAR_POSTGRES_INTEGRATION=1 npm test -- tests/integration/run-journal.test.ts
```

Expected after Tasks 1–3: PASS, with exactly one Run row for the traversal and `degradedLevel='html-fallback'` on that row.

- [ ] **Step 4: Add a catch-up-without-fallback regression assertion**

The existing persistence integration already verifies this at the transaction level. In `run-journal.test.ts`, do not duplicate a full traversal fixture unless needed. Instead ensure the full PostgreSQL suite contains both:

```text
scheduled degraded success -> outcome=success, degradedLevel=html-fallback
incremental catch-up without fallback -> outcome=catchup, degradedLevel=null
```

If both are already covered by `run-journal.test.ts` + `monitor-run-persistence.test.ts`, no additional production/test code is required.

- [ ] **Step 5: Run the complete PostgreSQL verification gate**

Run:

```bash
bash scripts/verify-postgres-compose.sh
```

Expected: all migrations, scheduler/run-journal integration tests, and PostgreSQL assertions pass. Confirm migration count is unchanged by this task.

- [ ] **Step 6: Commit PostgreSQL acceptance coverage**

```bash
git add tests/integration/run-journal.test.ts scripts/verify-postgres-compose.sh
git commit -m "test: cover durable source degradation journal"
```

If `scripts/verify-postgres-compose.sh` did not need modification, omit it from `git add`.

---

### Task 5: Documentation closure and final verification

**Files:**
- Create: `docs/tasks/2-4-5-run-degradation-journal.md`
- Modify: `docs/tasks/1-3-4-html-fallback.md`
- Modify: `docs/tasks/2-4-3-run-journal.md`
- Modify: `docs/epics/2-4-scheduler.md`
- Modify generated docs only via `npm run docs:ops:refresh`.

**Interfaces:**
- Consumes: final GREEN implementation and exact RED/GREEN workflow evidence.
- Produces: task `2.4.5` marked `done/aligned`, epic `2.4` rollup `5/5`, and corrected historical notes in `1.3.4`/`2.4.3`.

- [ ] **Step 1: Create the task card after behavior is GREEN**

Create `docs/tasks/2-4-5-run-degradation-journal.md` with frontmatter:

```yaml
---
id: "2.4.5"
phase: 2
epic: "2.4"
status: done
sync_state: aligned
last_reviewed: 2026-09-10
roles: [BACK, DB]
depends_on: ["1.3.4", "2.4.3"]
estimated_hours: 3-4
agent: backend-senior
tags: [scheduler, journal, degradation, remediation]
---
```

The body must state these completed invariants exactly:

- HTML fallback is persisted on the concrete scheduled Run as `degradedLevel='html-fallback'`.
- `watermark-catchup` is no longer stored in `degradedLevel`; catch-up is represented by `outcome='catchup'`.
- degradation survives scheduled success/catch-up/cold-start/error finalization;
- multiple fallback pages produce one persistence update and one warning per Run;
- no Prisma migration or extra per-Run HTTP client/limiter was introduced;
- include exact RED/GREEN GitHub Actions run numbers and commit SHAs collected during Tasks 1–4.

- [ ] **Step 2: Correct the delegated/future-work wording in existing completed tasks**

In `docs/tasks/1-3-4-html-fallback.md`, replace wording that says `2.4.3` *will* bind the sink with wording that says the binding is now fulfilled by `2.4.5` and persists `html-fallback` on the current Run.

In `docs/tasks/2-4-3-run-journal.md`, add a short remediation note that `2.4.5` completed the previously missing source-degradation binding and reserved `degradedLevel` for source degradation rather than catch-up.

Do not rewrite historical TDD evidence for either task.

- [ ] **Step 3: Update epic 2.4 source metadata to 5/5**

In `docs/epics/2-4-scheduler.md`, add `2.4.5` to planned/child tasks and set its source status note to `5/5` complete. Keep the epic `status: done` / `sync_state: aligned`.

- [ ] **Step 4: Refresh generated documentation and prove no drift**

Run:

```bash
npm run docs:ops:refresh
npm run docs:ops:check
git diff --check
```

Then run `npm run docs:ops:refresh` once more and verify it produces no additional diff. Generated files are authoritative; do not hand-edit their rollup sections.

- [ ] **Step 5: Run focused regression tests before the full gate**

Run:

```bash
npm test -- tests/unit/worker-source-runtime.test.ts tests/unit/scheduled-monitor-run.test.ts tests/unit/worker-application.test.ts tests/unit/cold-start-persistence.test.ts tests/integration/monitor-run-persistence.test.ts tests/integration/run-journal.test.ts
npm run typecheck
npm run lint
npm run format:check
```

Expected: PASS. PostgreSQL-only integration tests may be skipped by the plain `npm test` command; the next step supplies the real DB gate.

- [ ] **Step 6: Run the full repository verification pipeline**

Run the exact same stages as `.github/workflows/verify.yml`:

```bash
npm run docs:ops:check
npm test
npm run typecheck
npm run lint
npm run format:check
bash scripts/verify-postgres-compose.sh
npm run build
```

Then rely on the branch GitHub Actions `verify` run for the Electron development/production smoke stages that require CI sandbox preparation. Do not mark the task complete until that workflow is `success` on the exact feature HEAD.

- [ ] **Step 7: Commit documentation closure**

```bash
git add docs
git commit -m "docs: close run degradation journal remediation"
```

- [ ] **Step 8: Perform pre-PR verification/review**

Use `superpowers:verification-before-completion` and `superpowers:requesting-code-review`. Confirm:

```text
- exact feature HEAD has a full verify success
- compare main...feature shows behind_by=0
- no temporary workflow files remain
- no Prisma migration/schema diff exists
- diff is limited to run degradation persistence, source-runtime composition, tests, and docs
```

- [ ] **Step 9: Open PR and require a second full verify before merge**

Open a PR titled:

```text
fix: persist source degradation per run
```

PR body must include the design spec path, RED/GREEN evidence, PostgreSQL acceptance evidence, and explicit non-goals. Before merge, require:

```text
- PR-triggered verify = success on the exact head SHA
- PR is mergeable
- base/head SHA unchanged since verification
- no unresolved review threads or requested changes
```

Merge with `expected_head_sha` and verify the merge commit tree matches the verified feature tree.
