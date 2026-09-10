# 2.4.1 — pg-boss monitor schedules design

Date: 2026-09-10
Task: `2.4.1`
Branch base: `main@27ae241ad33a9fc4c91689fd02bcfda6c2039622`

## Goal

Introduce the first long-lived scheduler service inside the utility worker so every active monitor owns an idempotent pg-boss schedule and one worker handler that runs exactly one traversal for that monitor.

The design intentionally stops at scheduling. No-overlap, retry policy, expanded run-journal behavior, adaptive intervals, and UI belong to later cards.

## Runtime compatibility

Use `pg-boss` `12.30.0`, the current verified release for this implementation. Its published runtime requirement is Node.js `22.12` or newer, so the repository engine contract must move from `>=22 <23` to `>=22.12 <23` in the same dependency change. The package version remains `0.2.0`; this task is not the release bump.

Official API references used for implementation are the upstream `timgit/pg-boss` constructor, queue, scheduling, and worker docs. Context7 does not currently index the official pg-boss package and therefore must not be used as a substitute through the unrelated `pg-bossman` wrapper.

## Source-of-truth reconciliation

The current repository card `docs/tasks/2-4-1-schedules.md` requires startup registration for enabled monitors, schedule updates on interval/state changes, a stable task name derived from monitor id, one traversal per job, no duplicate schedules after restart, and no execution for disabled monitors.

The original `kufar-monitor-docs-v3.2.zip` version is slightly stricter: it explicitly names worker pg-boss startup, create/update/delete synchronization, archive handling, and PostgreSQL-backed scheduler persistence.

Implementation will satisfy the strict superset:

- pg-boss runs inside the utility worker and uses the existing PostgreSQL database;
- startup reconciles persisted monitors into schedules;
- create/update/interval/state/archive transitions reconcile one monitor after the database commit;
- only `active` monitors remain scheduled and worked;
- task/queue names are stable functions of monitor id;
- restart/reschedule is idempotent and does not create duplicate schedules.

## Architecture

### `MonitorScheduler`

Add a focused worker-owned service in `electron/worker/monitor-scheduler.ts`.

Responsibilities:

- own the pg-boss lifecycle;
- map a monitor id to a stable queue name: `monitor-run:<id>`;
- map supported `intervalSec` values to a 5-field cron expression;
- reconcile all persisted monitors on startup;
- reconcile one persisted monitor after a successful configuration commit;
- register one pg-boss worker for each active monitor queue;
- unschedule and stop the worker for paused or archived monitors;
- stop pg-boss gracefully during worker shutdown.

It must not own matching, traversal persistence, retry/backoff policy, overlap protection, source parsing, or UI concerns.

### Dependency boundary

The scheduler receives narrow dependencies instead of reaching into unrelated globals:

- a monitor repository capable of reading scheduler-relevant fields (`id`, `intervalSec`, `state`) and listing monitors;
- a pg-boss-compatible scheduling/worker interface;
- a `runMonitor(monitorId)` callback that performs exactly one existing monitor traversal.

This keeps scheduler unit tests independent of PostgreSQL while allowing a real PostgreSQL integration test for pg-boss behavior.

### Scheduled monitor-run composition

The `runMonitor(monitorId)` callback is not a placeholder. Worker composition must provide a concrete executor, kept outside `MonitorScheduler`, which reuses the already implemented run pipeline.

A focused `ScheduledMonitorRunExecutor` performs these steps:

1. read the persisted monitor query needed to select its source adapter;
2. parse the existing persisted canonical-query contract;
3. route it through `routeKufarQuery()` and the existing `SourceAdapterRegistry`;
4. call `runMonitorCycle()` exactly once with the shared Prisma client, selected adapter, configured page cap, and the existing description loader;
5. return/propagate the run result or error unchanged to the scheduler worker handler.

Worker assembly owns the expensive/shared objects once per utility process rather than per job:

- one Prisma client;
- one `KufarHttpClient` using the existing global rate limiter and raw-response journal;
- electronics and real-estate primary adapters;
- existing HTML fallback/resilience composition for both verticals;
- one `ListingDescriptionCache`;
- one adapter registry;
- one scheduled monitor-run executor;
- one `MonitorScheduler`.

The resilient source is exposed to `runMonitorCycle()` through a thin `SourceAdapter` facade that returns the `page` from `KufarResilientSource.fetchPage()`. Its mandatory degradation sink emits the existing worker `journal` warning event in this task, so fallback is not silent. Task `2.4.3` later adds the promised persisted `Run.degradedLevel`/journal ownership without changing scheduler identity or job payload.

This task does not invent a renderer/IPC monitor service. The executor is worker-internal application composition.

### Worker lifecycle

The worker runtime becomes asynchronous:

1. build/start runtime services;
2. start pg-boss;
3. reconcile persisted monitors;
4. only then send `{ type: 'ready' }` to the Electron parent;
5. on shutdown, stop scheduler/pg-boss gracefully and close worker-owned HTTP/Prisma resources;
6. then send `{ type: 'shutdown-complete' }` and exit.

A scheduler startup failure therefore prevents a false-ready state.

The worker receives the already-resolved PostgreSQL connection string from the Electron main process through its environment. When `utilityProcess.fork()` is given a custom `env`, Electron replaces rather than augments the inherited environment, so main must pass `{ ...process.env, DATABASE_URL: resolvedDatabaseUrl }` instead of a one-key environment object. The database URL is not added to argv or logs.

## Schedule identity and idempotency

Each monitor gets a distinct pg-boss queue name:

`monitor-run:<monitorId>`

The same name is used for queue creation, schedule registration, worker registration, and unscheduling.

Current pg-boss `schedule(name, cron, data, options)` updates an existing schedule with the same identity, while `unschedule(name)` removes it. The application therefore does not maintain a second scheduler-state table.

`work(name, handler)` is process-local registration and must not be repeated on every reconciliation. `MonitorScheduler` therefore keeps only an ephemeral in-memory map of queue name to returned worker id. This map is not persisted scheduler state; it exists only to make repeated `syncMonitor()` calls idempotent inside one worker process.

On every reconcile of an active monitor:

1. call `getQueue(name)` and create the queue only when it does not exist; repeated `createQueue()` calls are not used as an idempotency mechanism;
2. register/update the schedule with payload `{ monitorId }`;
3. register the local worker only when that queue is not already present in the in-memory worker map.

On pause/archive:

1. remove the schedule;
2. if a local worker is registered, stop it with `offWork(name, { id: workerId, wait: true })` and remove it from the map.

Reactivation uses the same queue identity and registers one fresh local worker.

Repeated process startup is idempotent because pg-boss schedule identity lives in PostgreSQL, while the in-memory worker map starts empty with each process.

## Interval contract

MVP supports the product intervals already represented by the UI/prototype contract:

- 60 seconds (1 minute) → `* * * * *`
- 120 seconds (2 minutes) → `*/2 * * * *`
- 300 seconds (5 minutes) → `*/5 * * * *`
- 600 seconds (10 minutes) → `*/10 * * * *`
- 900 seconds (15 minutes) → `*/15 * * * *`
- 3600 seconds (1 hour) → `0 * * * *`

Persisted unsupported values are rejected explicitly. The scheduler does not round or silently rewrite intervals.

Five-field cron is used because current pg-boss scheduling documentation recommends the 5-placeholder form for its schedule evaluation cadence.

## Traversal page-cap configuration

Task `1.4.1` deliberately keeps `maxPages` out of the traversal algorithm and requires the caller to supply a configured cap. Neither the current repository card nor the original v3.2 archive specifies a numeric product value.

For this worker composition, use one explicit internal runtime setting:

- `DEFAULT_MONITOR_MAX_PAGES = 5` in the worker configuration layer;
- `WorkerConfig.monitorMaxPages` carries the resolved value;
- `runMonitorCycle()` receives that value on every scheduled traversal;
- tests can override it without changing traversal code.

Five pages is an engineering default, not a user-facing feature: it is the smallest conservative bound above the already required third-page acceptance case while keeping worst-case request depth bounded. The value is intentionally isolated so a later product/config decision can change it without touching the scheduler or watermark algorithm.

Invalid configured values (non-integer or `< 1`) fail worker startup before `ready`.

## Configuration synchronization

Database state remains authoritative.

`updateMonitorConfig()` keeps its Prisma transaction free of pg-boss side effects. Add a scheduler-aware application boundary that performs:

1. commit the existing monitor configuration transaction;
2. after success, call `scheduler.syncMonitor(monitorId)`.

Future monitor creation in `5.0.1` uses the same post-commit scheduler synchronization entry point. No hypothetical renderer/IPC API is introduced in this task.

If database commit fails, no scheduler mutation happens. If scheduler reconciliation fails after commit, the failure is surfaced; startup reconciliation remains the recovery mechanism on the next worker start.

The existing low-level `updateMonitorConfig()` remains usable by tests/internal persistence callers; the new orchestration boundary is the production path that needs DB + scheduler consistency.

## Job execution

The pg-boss worker validates the scheduled payload before invoking the runner. The only accepted shape is an object containing an integer `monitorId` that equals the id encoded in the queue name being worked.

A valid delivered job invokes `runMonitor(monitorId)` exactly once.

This card does not add overlap protection. If another job becomes eligible while one traversal is still running, `2.4.2` owns the policy that prevents concurrent traversals for the same monitor.

This card also does not add scheduler retry/backoff semantics. `2.4.4` owns that policy.

## Testing strategy

Follow RED → GREEN TDD for every production behavior.

Unit coverage:

- stable queue name from monitor id;
- supported interval-to-cron mappings and explicit rejection of unsupported intervals;
- startup reconciliation schedules active monitors and removes inactive ones;
- existing pg-boss queues are reused instead of recreated;
- repeated reconciliation does not duplicate local `work()` registration;
- interval changes update the existing schedule instead of introducing a second identity;
- pause/archive removes the schedule and local worker, and reactivation registers one worker again;
- malformed/mismatched job payload is rejected without a monitor traversal;
- valid job handler invokes one monitor traversal with the persisted monitor id;
- scheduled monitor-run executor selects the existing source adapter from persisted canonical query and calls `runMonitorCycle()` once with configured `maxPages` and description loader;
- invalid page-cap configuration fails before runtime readiness;
- worker runtime sends `ready` only after scheduler startup/reconciliation and sends shutdown-complete only after scheduler/resources shutdown;
- packaged/dev worker spawn preserves the inherited environment while replacing `DATABASE_URL` with the resolved bootstrap value.

PostgreSQL integration coverage:

- start real pg-boss against the existing compose PostgreSQL;
- reconcile five active monitors with different supported intervals and verify one schedule per monitor;
- change one interval and verify the existing schedule is updated without a duplicate;
- pause/archive a monitor and verify its schedule disappears;
- repeat scheduler startup/reconciliation and verify one schedule per active monitor;
- deliver a job to a test run callback and verify exactly one monitor id is dispatched.

Full repository verification remains the release gate: docs consistency, unit tests, failure-mode self-check, typecheck, lint, formatting, PostgreSQL integration, build/output verification, and both Electron smoke checks.

## Explicit non-goals

Do not implement in `2.4.1`:

- central tick loop or `setInterval` dispatcher;
- overlap/concurrency policy (`2.4.2`);
- new persisted `Run` journal semantics (`2.4.3`);
- scheduler retry/backoff/degradation policy (`2.4.4`);
- adaptive intervals (`4.2`);
- monitor creation UI or renderer IPC (`5.0.1`);
- Redis or another queue backend;
- a second scheduler-state table;
- user-facing configuration for `monitorMaxPages`.

## Completion criteria

The task is complete when the strict superset of the current repository card and the original v3.2 archive requirement is implemented, tests are GREEN, documentation is synchronized, the feature branch and fresh PR CI both pass the full verify workflow, the PR diff is reviewed, and the race-safe merge tree matches the verified feature tree.
