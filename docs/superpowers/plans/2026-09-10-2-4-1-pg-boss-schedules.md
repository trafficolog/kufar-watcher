# 2.4.1 pg-boss Monitor Schedules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run every active persisted monitor from a stable PostgreSQL-backed pg-boss schedule inside the utility worker, with idempotent restart/reschedule behavior and one existing monitor traversal per delivered job.

**Architecture:** Keep scheduling policy in a focused `MonitorScheduler` that depends on a narrow queue port and monitor repository. Keep marketplace/run composition outside the scheduler in `ScheduledMonitorRunExecutor`, and keep Electron worker boot/shutdown in the runtime layer. PostgreSQL remains authoritative; configuration changes commit first and reconcile the scheduler afterward.

**Tech Stack:** TypeScript 6.0.2, Node.js `>=22.12 <23`, Electron 44.2.0 utility process, Prisma 7.10.0, PostgreSQL, pg-boss 12.30.0, Vitest 5.0.0.

**Spec:** `docs/superpowers/specs/2026-09-10-2-4-1-pg-boss-schedules-design.md`

## Global Constraints

- Pin `pg-boss` to exactly `12.30.0`; do not change package version `0.2.0` in this task.
- Raise the repository Node engine floor to `>=22.12 <23` in the same dependency commit.
- Stable queue name is exactly `monitor-run/<monitorId>`.
- Supported persisted intervals are exactly `60`, `120`, `300`, `600`, `900`, `3600` seconds.
- Use 5-field cron expressions only.
- Database state is authoritative; scheduler side effects happen only after a successful monitor-config commit.
- Only `active` monitors remain scheduled/worked; `paused` and `archived` monitors are unscheduled and have their local worker removed.
- Do not implement overlap prevention, retry/backoff policy, new persisted Run semantics, adaptive intervals, renderer/IPC monitor creation, Redis, or another scheduler-state table.
- `DEFAULT_MONITOR_MAX_PAGES` is `5`; it is internal worker configuration, not user-facing configuration.
- When Electron `utilityProcess.fork()` receives a custom environment, pass `{ ...process.env, DATABASE_URL: resolvedDatabaseUrl }`; never put the database URL in argv or logs.
- Every production behavior follows RED → observed RED → minimal GREEN → observed GREEN before the next behavior.

---

### Task 1: Scheduler Domain Contract and Pure Mapping

**Files:**
- Create: `tests/unit/monitor-scheduler.test.ts`
- Create: `electron/worker/monitor-scheduler.ts`

**Interfaces:**
- Produces:

```ts
export type SchedulerMonitorState = 'active' | 'paused' | 'archived'

export interface SchedulerMonitor {
  id: number
  intervalSec: number
  state: SchedulerMonitorState
}

export interface MonitorScheduleRepository {
  list(): Promise<readonly SchedulerMonitor[]>
  find(monitorId: number): Promise<SchedulerMonitor | null>
}

export interface ScheduledJobEnvelope {
  data: unknown
}

export interface MonitorScheduleQueue {
  start(): Promise<void>
  stop(): Promise<void>
  hasQueue(name: string): Promise<boolean>
  createQueue(name: string): Promise<void>
  upsertSchedule(name: string, cron: string, data: { monitorId: number }): Promise<void>
  removeSchedule(name: string): Promise<void>
  work(name: string, handler: (job: ScheduledJobEnvelope) => Promise<void>): Promise<string>
  offWork(name: string, workerId: string): Promise<void>
}

export function monitorQueueName(monitorId: number): string
export function monitorIntervalCron(intervalSec: number): string
```

- [ ] **Step 1: Write the failing mapping tests**

```ts
import { describe, expect, it } from 'vitest'
import { monitorIntervalCron, monitorQueueName } from '../../electron/worker/monitor-scheduler'

describe('monitor scheduler contract', () => {
  it('derives a stable queue name from monitor id', () => {
    expect(monitorQueueName(42)).toBe('monitor-run/42')
  })

  it.each([
    [60, '* * * * *'],
    [120, '*/2 * * * *'],
    [300, '*/5 * * * *'],
    [600, '*/10 * * * *'],
    [900, '*/15 * * * *'],
    [3600, '0 * * * *'],
  ])('maps %i seconds to %s', (intervalSec, cron) => {
    expect(monitorIntervalCron(intervalSec)).toBe(cron)
  })

  it('rejects unsupported persisted intervals instead of rounding', () => {
    expect(() => monitorIntervalCron(180)).toThrow(/unsupported monitor interval/i)
  })
})
```

- [ ] **Step 2: Commit the test-only RED and run the branch verify workflow**

Expected: RED because `electron/worker/monitor-scheduler.ts` does not exist. Record the run number/SHA as import-contract RED evidence.

- [ ] **Step 3: Add a minimal skeleton module so the RED becomes behavioral**

```ts
export function monitorQueueName(_monitorId: number): string {
  return ''
}

export function monitorIntervalCron(_intervalSec: number): string {
  return ''
}
```

Also declare the exact interfaces above without reconciliation logic.

- [ ] **Step 4: Run the targeted/branch tests and verify assertion RED**

Expected: queue-name and cron assertions fail while all pre-existing tests remain green.

- [ ] **Step 5: Implement only the stable name and exact interval map**

```ts
const MONITOR_INTERVAL_CRON = new Map<number, string>([
  [60, '* * * * *'],
  [120, '*/2 * * * *'],
  [300, '*/5 * * * *'],
  [600, '*/10 * * * *'],
  [900, '*/15 * * * *'],
  [3600, '0 * * * *'],
])

export function monitorQueueName(monitorId: number): string {
  if (!Number.isInteger(monitorId) || monitorId < 1) throw new Error('Invalid monitor id')
  return `monitor-run/${monitorId}`
}

export function monitorIntervalCron(intervalSec: number): string {
  const cron = MONITOR_INTERVAL_CRON.get(intervalSec)
  if (cron === undefined) throw new Error(`Unsupported monitor interval: ${intervalSec}`)
  return cron
}
```

- [ ] **Step 6: Run tests and verify GREEN**

Expected: mapping suite passes and no unrelated tests regress.

- [ ] **Step 7: Commit**

Commit message: `feat: define monitor schedule contract`.

---

### Task 2: Idempotent Monitor Reconciliation and Job Dispatch

**Files:**
- Modify: `tests/unit/monitor-scheduler.test.ts`
- Modify: `electron/worker/monitor-scheduler.ts`

**Interfaces:**
- Consumes: `MonitorScheduleRepository`, `MonitorScheduleQueue`, `monitorQueueName()`, `monitorIntervalCron()` from Task 1.
- Produces:

```ts
export interface MonitorSchedulerOptions {
  repository: MonitorScheduleRepository
  queue: MonitorScheduleQueue
  runMonitor(monitorId: number): Promise<unknown>
}

export class MonitorScheduler {
  constructor(options: MonitorSchedulerOptions)
  start(): Promise<void>
  syncMonitor(monitorId: number): Promise<void>
  stop(): Promise<void>
}
```

- [ ] **Step 1: Add failing tests for startup reconciliation**

Use in-memory fakes that record durable schedule state and local worker registrations. The test data must contain one active, one paused, and one archived monitor.

```ts
await scheduler.start()

expect(queue.schedules).toEqual(
  new Map([['monitor-run/1', { cron: '* * * * *', data: { monitorId: 1 } }]]),
)
expect(queue.workersFor('monitor-run/1')).toHaveLength(1)
expect(queue.schedules.has('monitor-run/2')).toBe(false)
expect(queue.schedules.has('monitor-run/3')).toBe(false)
```

- [ ] **Step 2: Verify RED**

Expected: `MonitorScheduler` is absent or has no reconciliation behavior.

- [ ] **Step 3: Implement minimal `start()` and private monitor reconciliation**

Required active flow:

```ts
const name = monitorQueueName(monitor.id)
if (!(await queue.hasQueue(name))) await queue.createQueue(name)
await queue.upsertSchedule(name, monitorIntervalCron(monitor.intervalSec), { monitorId: monitor.id })
if (!workerIds.has(name)) {
  const workerId = await queue.work(name, (job) => dispatchMonitorJob(name, monitor.id, job))
  workerIds.set(name, workerId)
}
```

Required inactive flow:

```ts
await queue.removeSchedule(name)
const workerId = workerIds.get(name)
if (workerId !== undefined) {
  await queue.offWork(name, workerId)
  workerIds.delete(name)
}
```

`start()` must call `queue.start()` before listing/reconciling monitors.

- [ ] **Step 4: Verify startup GREEN**

Expected: one durable schedule/worker for the active monitor only.

- [ ] **Step 5: Add failing idempotency/reschedule tests**

Cover all of these assertions in separate tests:

```ts
await scheduler.syncMonitor(1)
await scheduler.syncMonitor(1)
expect(queue.workersFor('monitor-run/1')).toHaveLength(1)

repository.set({ id: 1, intervalSec: 300, state: 'active' })
await scheduler.syncMonitor(1)
expect(queue.schedules.get('monitor-run/1')?.cron).toBe('*/5 * * * *')
expect(queue.scheduleNames()).toEqual(['monitor-run/1'])

repository.set({ id: 1, intervalSec: 300, state: 'paused' })
await scheduler.syncMonitor(1)
expect(queue.schedules.has('monitor-run/1')).toBe(false)
expect(queue.workersFor('monitor-run/1')).toHaveLength(0)

repository.set({ id: 1, intervalSec: 300, state: 'active' })
await scheduler.syncMonitor(1)
expect(queue.workersFor('monitor-run/1')).toHaveLength(1)
```

Also verify an already-existing durable queue is reused rather than recreated.

- [ ] **Step 6: Verify behavioral RED**

Expected: duplicate work registration, stale cron, or missing pause/reactivation behavior fails.

- [ ] **Step 7: Implement `syncMonitor()` and ephemeral worker-id tracking**

If `repository.find(id)` returns `null`, treat the missing monitor like an inactive/deleted monitor: remove the schedule and local worker for the stable queue name. Do not delete the pg-boss queue itself.

- [ ] **Step 8: Add failing job-payload tests**

Capture the registered handler and assert:

```ts
await handler({ data: { monitorId: 1 } })
expect(runs).toEqual([1])

await expect(handler({ data: { monitorId: 2 } })).rejects.toThrow(/monitor id/i)
await expect(handler({ data: null })).rejects.toThrow(/monitor id/i)
expect(runs).toEqual([1])
```

- [ ] **Step 9: Verify RED, then implement strict payload validation**

Accepted payload is exactly an object whose `monitorId` is an integer equal to the monitor id bound to that worker. Valid jobs call `runMonitor(monitorId)` once; malformed/mismatched jobs throw before the run callback.

- [ ] **Step 10: Add failing graceful-stop test**

```ts
await scheduler.start()
await scheduler.stop()
expect(queue.events.slice(-2)).toEqual([
  'offWork:monitor-run/1',
  'stop',
])
```

The exact fake representation may differ, but the test must prove local workers stop before the underlying queue client stops.

- [ ] **Step 11: Implement `stop()` and verify full scheduler suite GREEN**

- [ ] **Step 12: Commit**

Commit message: `feat: reconcile monitor schedules`.

---

### Task 3: Prisma Scheduler Repository and Post-Commit Config Synchronization

**Files:**
- Create: `electron/worker/monitor-schedule-repository.ts`
- Create: `electron/worker/monitor-config-sync.ts`
- Create: `tests/unit/monitor-schedule-repository.test.ts`
- Create: `tests/unit/monitor-config-sync.test.ts`
- Reuse: `electron/worker/monitor-config-persistence.ts`

**Interfaces:**
- Produces:

```ts
export function createPrismaMonitorScheduleRepository(
  prisma: PrismaClient,
): MonitorScheduleRepository

export interface MonitorSchedulerSync {
  syncMonitor(monitorId: number): Promise<void>
}

export async function updateMonitorConfigAndSync(
  prisma: PrismaClient,
  scheduler: MonitorSchedulerSync,
  monitorId: number,
  patch: MonitorConfigPatch,
): Promise<void>
```

- [ ] **Step 1: Write failing repository projection tests**

Use a typed fake Prisma shape to assert `list()` and `find(id)` return only `id`, `intervalSec`, and `state`, preserving `active | paused | archived` exactly.

- [ ] **Step 2: Verify RED, then implement the minimal Prisma adapter**

Required selects:

```ts
select: { id: true, intervalSec: true, state: true }
```

No query/keywords/cursor fields belong in this repository.

- [ ] **Step 3: Verify repository GREEN**

- [ ] **Step 4: Write failing post-commit ordering tests**

Success case:

```ts
await updateMonitorConfigAndSync(prisma, scheduler, 7, { intervalSec: 300 })
expect(events).toEqual(['transaction-commit', 'sync:7'])
```

Failure case:

```ts
await expect(
  updateMonitorConfigAndSync(failingPrisma, scheduler, 7, { state: 'paused' }),
).rejects.toThrow('commit failed')
expect(syncCalls).toEqual([])
```

- [ ] **Step 5: Verify RED, then implement the orchestration boundary**

Implementation must call existing `updateMonitorConfig()` first and `scheduler.syncMonitor()` only after it resolves. Do not add pg-boss calls inside the Prisma transaction.

- [ ] **Step 6: Run both new suites and pre-existing monitor-config suites**

Expected: all GREEN.

- [ ] **Step 7: Commit**

Commit message: `feat: sync schedules after monitor config commit`.

---

### Task 4: Scheduled Monitor Run Executor

**Files:**
- Create: `electron/worker/scheduled-monitor-run.ts`
- Create: `tests/unit/scheduled-monitor-run.test.ts`
- Reuse: `electron/worker/monitor-cycle.ts`
- Reuse: `electron/worker/monitor-config-persistence.ts`
- Reuse: `shared/kufar-routing.ts`
- Reuse: `shared/source-adapter-registry.ts`

**Interfaces:**
- Produces:

```ts
export interface ScheduledMonitorRunExecutorOptions {
  prisma: PrismaClient
  adapters: SourceAdapterRegistry
  maxPages: number
  descriptionLoader: DescriptionLoader
  runCycle?: typeof runMonitorCycle
}

export type ScheduledMonitorRunExecutor = (monitorId: number) => Promise<MonitorCycleResult>

export function createScheduledMonitorRunExecutor(
  options: ScheduledMonitorRunExecutorOptions,
): ScheduledMonitorRunExecutor
```

- [ ] **Step 1: Write the failing routing/execution test**

Fake persisted query must be a valid canonical electronics query. Register two distinct fake adapters. Inject a `runCycle` spy function that records its input and returns a valid synthetic `MonitorCycleResult`.

Required assertion shape:

```ts
await executor(17)

expect(runInputs).toEqual([
  expect.objectContaining({
    monitorId: 17,
    adapter: electronicsAdapter,
    maxPages: 5,
    descriptionLoader,
  }),
])
```

- [ ] **Step 2: Verify RED**

Expected: scheduled executor module/function absent.

- [ ] **Step 3: Implement persisted-query routing and one `runMonitorCycle()` call**

Required flow:

```ts
const monitor = await prisma.monitor.findUniqueOrThrow({
  where: { id: monitorId },
  select: { query: true },
})
const query = parsePersistedCanonicalQuery(monitor.query)
const adapter = adapters.get(routeKufarQuery(query))
return runCycle({ prisma, monitorId, adapter, maxPages, descriptionLoader })
```

- [ ] **Step 4: Add failing invalid page-cap test**

Constructing the executor with `maxPages = 0`, a fraction, or a non-finite value must throw before any run. This protects runtime readiness from invalid internal configuration.

- [ ] **Step 5: Implement page-cap validation and verify GREEN**

- [ ] **Step 6: Commit**

Commit message: `feat: execute scheduled monitor cycles`.

---

### Task 5: Worker Configuration, Database Environment, and Async Runtime Lifecycle

**Files:**
- Modify: `electron/worker/config.ts`
- Modify: `tests/worker-storage-config.test.ts`
- Create: `electron/main/worker-process-env.ts`
- Create: `tests/worker-process-env.test.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/worker/runtime.ts`
- Modify: `tests/worker-runtime.test.ts`

**Interfaces:**
- Produces:

```ts
export const DEFAULT_MONITOR_MAX_PAGES = 5

export interface WorkerConfig {
  rawResponseJournalDir: string
  databaseUrl: string
  monitorMaxPages: number
}

export function readWorkerConfig(
  argv: readonly string[],
  env?: NodeJS.ProcessEnv,
): WorkerConfig

export function workerProcessEnvironment(
  parentEnv: NodeJS.ProcessEnv,
  databaseUrl: string,
): NodeJS.ProcessEnv

export interface WorkerRuntimeServices {
  start(): Promise<void>
  stop(): Promise<void>
}

export async function startWorkerRuntime(
  parentPort: WorkerParentPort,
  services: WorkerRuntimeServices,
  exit: (code: number) => void,
): Promise<void>
```

- [ ] **Step 1: Write failing worker-config tests**

Extend the existing parser assertion to include `DATABASE_URL` and the default page cap:

```ts
expect(
  readWorkerConfig(['electron', 'worker.js', argument], {
    DATABASE_URL: 'postgresql://worker-db',
  }),
).toEqual({
  rawResponseJournalDir: join('/profile/Kufar Monitor', 'raw-responses'),
  databaseUrl: 'postgresql://worker-db',
  monitorMaxPages: 5,
})
```

Also assert missing `DATABASE_URL` rejects startup configuration.

- [ ] **Step 2: Verify RED, implement config extension, verify GREEN**

Do not parse `monitorMaxPages` from user environment in this task; it remains the internal constant `5`.

- [ ] **Step 3: Write failing environment-preservation test**

```ts
expect(
  workerProcessEnvironment({ PATH: '/bin', HOME: '/home/user', DATABASE_URL: 'stale' }, 'fresh'),
).toEqual({ PATH: '/bin', HOME: '/home/user', DATABASE_URL: 'fresh' })
```

Also assert an empty database URL is rejected.

- [ ] **Step 4: Verify RED, implement `workerProcessEnvironment()`, verify GREEN**

- [ ] **Step 5: Wire Electron main to pass the resolved bootstrap database URL**

The `spawnWorker` closure must use the latest successfully resolved database URL and call:

```ts
utilityProcess.fork(workerPath, [workerJournalArg], {
  serviceName: 'Kufar Monitor Worker',
  env: workerProcessEnvironment(process.env, resolvedDatabaseUrl),
})
```

Set `resolvedDatabaseUrl = config.databaseUrl` before `supervisor.start()` can run. Preserve all inherited environment variables by spreading `process.env` in the helper.

- [ ] **Step 6: Write failing async runtime readiness/shutdown tests**

Readiness test must prove no ready message before service startup resolves:

```ts
const startGate = deferred<void>()
const runtimePromise = startWorkerRuntime(parentPort, servicesWithStart(startGate.promise), exit)
expect(parentPort.messages).toEqual([])
startGate.resolve()
await runtimePromise
expect(parentPort.messages).toEqual([{ type: 'ready' }])
```

Shutdown test must prove `shutdown-complete` and exit occur only after `services.stop()` resolves.

- [ ] **Step 7: Verify RED, implement async runtime lifecycle, verify GREEN**

Register the parent message listener before awaiting startup so a shutdown request cannot be silently lost during startup. Serialize shutdown so it executes at most once.

- [ ] **Step 8: Commit**

Commit message: `feat: gate worker readiness on scheduler services`.

---

### Task 6: pg-boss Dependency, Real Queue Port, and Worker Application Composition

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `electron/worker/pg-boss-schedule-queue.ts`
- Create: `electron/worker/worker-source-runtime.ts`
- Create: `electron/worker/worker-application.ts`
- Modify: `electron/worker/index.ts`
- Create: `tests/unit/pg-boss-schedule-queue.test.ts`
- Create: `tests/unit/worker-source-runtime.test.ts`
- Create: `tests/unit/worker-application.test.ts`

**Interfaces:**
- Produces:

```ts
export function createPgBossScheduleQueue(
  databaseUrl: string,
  onError: (error: unknown) => void,
): MonitorScheduleQueue

export interface WorkerSourceRuntime {
  adapters: SourceAdapterRegistry
  descriptionLoader: DescriptionLoader
  close(): Promise<void>
}

export function createWorkerSourceRuntime(options: {
  prisma: PrismaClient
  rawResponseJournalDir: string
  onDegradation(message: string): void | Promise<void>
}): WorkerSourceRuntime

export interface WorkerApplication extends WorkerRuntimeServices {
  scheduler: MonitorScheduler
}

export function createWorkerApplication(
  config: WorkerConfig,
  publish: (event: WorkerEvent) => void,
): WorkerApplication
```

- [ ] **Step 1: Write a test-only RED for the real queue adapter contract**

The adapter test should instantiate through an injected/fake pg-boss-like object or factory seam and assert these mappings:

```ts
hasQueue(name)       -> boss.getQueue(name) !== null
createQueue(name)    -> boss.createQueue(name)
upsertSchedule(...)  -> boss.schedule(name, cron, data)
removeSchedule(name) -> boss.unschedule(name)
work(name, handler)  -> boss.work(name, batchHandler) and returns worker id
offWork(name, id)    -> boss.offWork(name, { id, wait: true })
```

The batch handler must reject an empty batch and otherwise forward exactly the first/default single job envelope.

- [ ] **Step 2: Commit/observe RED before adding the package**

Expected first failure may be missing `pg-boss` import. Record it separately, then add the dependency/configuration and drive the adapter to assertion RED before implementing mappings.

- [ ] **Step 3: Add the dependency and runtime floor**

`package.json` changes:

```json
"engines": {
  "node": ">=22.12 <23"
},
"dependencies": {
  "pg-boss": "12.30.0"
}
```

Generate `package-lock.json` with npm 11.4.2; do not hand-edit transitive lock entries. Keep package version `0.2.0`.

- [ ] **Step 4: Implement `createPgBossScheduleQueue()` and verify adapter GREEN**

Use `new PgBoss({ connectionString: databaseUrl })`, attach an `error` listener, call `boss.start()`/`boss.stop()` for lifecycle, `boss.getQueue()` before queue creation, `boss.schedule()` for idempotent update, and `boss.offWork(name, { id, wait: true })` for one local worker.

- [ ] **Step 5: Write failing source-runtime composition tests**

The test should prove both `electronics` and `real-estate` registry entries are present and share one injected HTTP transport/journal lifecycle. The production runtime must compose:

```ts
FileKufarRawResponseJournal
KufarHttpClient
KufarElectronicsAdapter
KufarRealestateAdapter
KufarHtmlFallbackAdapter
KufarResilientSource
ListingDescriptionCache
createSourceAdapterRegistry
```

The resilience facade presented to `runMonitorCycle()` must satisfy `SourceAdapter` by returning `result.page`. A successful fallback must await `onDegradation('Kufar source degraded to HTML fallback')` before returning the page.

- [ ] **Step 6: Verify RED, implement source runtime, verify GREEN**

`close()` closes the shared `KufarHttpClient` once. Prisma ownership remains outside this object.

- [ ] **Step 7: Write failing worker-application lifecycle/composition tests**

Inject factories where needed so the test proves:

```ts
await app.start()
// scheduler starts/reconciles after all dependencies are constructed
await app.stop()
// scheduler stops before HTTP and Prisma resources close
```

The application must create one Prisma client from `config.databaseUrl`, one pg-boss queue port from the same URL, one scheduler repository, one source runtime, one scheduled run executor, and one `MonitorScheduler`.

- [ ] **Step 8: Verify RED, implement application composition, verify GREEN**

Publish pg-boss errors as `{ type: 'journal', level: 'error', message: ... }`. Publish HTML fallback degradation as a warning journal event. Do not add persisted degradation state here.

- [ ] **Step 9: Wire `electron/worker/index.ts`**

Required shape:

```ts
const config = readWorkerConfig(process.argv, process.env)
const application = createWorkerApplication(config, (event) => parentPort.postMessage(event))
void startWorkerRuntime(parentPort, application, (code) => {
  setImmediate(() => process.exit(code))
}).catch((error) => {
  parentPort.postMessage({ type: 'journal', level: 'error', message: formatWorkerError(error) })
  setImmediate(() => process.exit(1))
})
```

Do not send `ready` from `index.ts`; runtime sends it only after `application.start()` resolves.

- [ ] **Step 10: Run unit, typecheck, lint, and format gates**

Expected: GREEN before PostgreSQL integration work begins.

- [ ] **Step 11: Commit**

Commit message: `feat: run pg-boss scheduler in utility worker`.

---

### Task 7: PostgreSQL pg-boss Integration Acceptance

**Files:**
- Create: `tests/integration/monitor-scheduler.test.ts`
- Modify: `scripts/verify-postgres-compose.sh`

**Interfaces:**
- Consumes real `pg-boss`, `MonitorScheduler`, and Prisma-backed repository against the existing compose database.
- Produces acceptance evidence for persisted schedules, reschedule, pause/archive removal, restart idempotency, and one dispatched monitor id.

- [ ] **Step 1: Write the integration test before adding it to the compose gate**

Guard it consistently with existing integration tests:

```ts
const integration = process.env.KUFAR_POSTGRES_INTEGRATION === '1' ? describe : describe.skip
```

Create five monitor rows using supported intervals. Keep their IDs unique to the test and delete them in cleanup.

- [ ] **Step 2: Assert initial reconciliation**

After `scheduler.start()`:

```ts
const schedules = await boss.getSchedules()
const owned = schedules.filter((schedule) => schedule.name.startsWith('monitor-run/'))
expect(owned).toHaveLength(5)
```

Assert each queue name and cron matches the five seeded monitors.

- [ ] **Step 3: Assert interval update keeps one identity**

Update one monitor from `60` to `300`, call `scheduler.syncMonitor(id)`, then assert `getSchedules(name)` contains exactly one schedule with `*/5 * * * *`.

- [ ] **Step 4: Assert pause and archive remove schedules**

Persist one monitor as paused and another as archived, sync both, and assert `getSchedules(name)` is empty for each.

- [ ] **Step 5: Assert restart/reconciliation is idempotent**

Stop the first scheduler/pg-boss instance, create a fresh instance against the same database, start it, and assert exactly one schedule per remaining active monitor. The old paused/archived schedules must not reappear.

- [ ] **Step 6: Assert one delivered job dispatches one monitor id**

Use the active scheduler queue and send one immediate job with `{ monitorId }` through the real pg-boss instance. Wait with a bounded polling helper for the test callback to receive it, then assert:

```ts
expect(dispatchedIds).toEqual([monitorId])
```

Do not test no-overlap or retry behavior here.

- [ ] **Step 7: Run the integration test and observe RED/GREEN**

The first integration run must fail for the missing/incorrect real behavior before any production fix for that failure. Apply only the minimal fix, then rerun until GREEN.

- [ ] **Step 8: Add the integration suite to `scripts/verify-postgres-compose.sh`**

Add near the other Vitest integration invocations:

```bash
KUFAR_POSTGRES_INTEGRATION=1 npx vitest run tests/integration/monitor-scheduler.test.ts
```

- [ ] **Step 9: Run the full branch verify workflow**

Required GREEN gates: documentation consistency, unit tests, CI failure-mode self-check, typecheck, lint, formatting, PostgreSQL compose integration including scheduler suite, build/output verification, development smoke, production smoke.

- [ ] **Step 10: Commit**

Commit message: `test: verify pg-boss monitor schedules`.

---

### Task 8: Documentation Closure, Review, PR CI, and Race-Safe Merge

**Files:**
- Modify: `docs/tasks/2-4-1-schedules.md`
- Modify: `docs/epics/2-4-scheduler.md`
- Modify: `docs/phases/2-rules-scheduler.md`
- Modify: `docs/ROADMAP.MD`
- Modify: `docs/releases/v0.3.0.md`
- Regenerate: `docs/operations/status/current-state.md`
- Regenerate: `docs/operations/status/drift-report.md`
- Regenerate: `docs/operations/status/epics.md`
- Regenerate: `docs/operations/status/phases.md`
- Regenerate: `docs/operations/status/tasks.md`

**Interfaces:**
- Consumes all GREEN evidence from Tasks 1–7.
- Produces final synchronized task state and merge evidence.

- [ ] **Step 1: Close the task card with exact evidence**

Set `2.4.1` to `done/aligned`, `last_reviewed: 2026-09-10`, check all acceptance criteria, and record RED/GREEN workflow run numbers and final code SHA.

- [ ] **Step 2: Update rollups**

Keep epic `2.4` open/drifted with `1/4` tasks done. Update phase-2 rollup from `2/6` to `2/6` epics done if epic status count is unchanged; update task-level narrative to show scheduler work has started. Update MVP-1 burn-down from `19/34 done, 15 todo` to exactly `20/34 done, 14 todo`.

Do not mark epic `2.4` done until `2.4.2–2.4.4` are complete.

- [ ] **Step 3: Run `docs:ops:refresh` semantics and commit generated status atomically**

Generated files must match the repository docs-ops output exactly. Package version remains `0.2.0`.

- [ ] **Step 4: Run a fresh full branch verify on the docs head**

Do not rely on an earlier code-only run.

- [ ] **Step 5: Perform direct diff review against current `main`**

Check especially that the final diff contains no temporary diagnostic workflow edits, no release version bump, no `2.4.2–2.4.4` behavior, and no database URL logging/argv exposure.

- [ ] **Step 6: Open the PR and require a fresh pull-request-triggered full verify**

PR title: `feat: schedule monitors with pg-boss`.

PR body must summarize scheduler identity, lifecycle, post-commit sync, runtime database environment, integration evidence, and explicit non-goals.

- [ ] **Step 7: Re-check mergeability and exact head immediately before merge**

Use the verified PR head SHA as `expected_head_sha`. Abort/re-evaluate if the head or base changed.

- [ ] **Step 8: Race-safe merge and verify exact `main` tree**

After merge, fetch `main` and assert the merge commit tree is identical to the final verified feature tree. Record merge SHA, tree SHA, parent SHAs, and signature status.

- [ ] **Step 9: Begin `2.4.2` only with a fresh brainstorming approval gate**

Do not implement no-overlap as cleanup inside this task.
