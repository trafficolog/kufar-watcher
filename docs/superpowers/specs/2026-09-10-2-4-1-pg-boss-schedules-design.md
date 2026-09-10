# 2.4.1 — pg-boss monitor schedules design

Date: 2026-09-10
Task: `2.4.1`
Branch base: `main@27ae241ad33a9fc4c91689fd02bcfda6c2039622`

## Goal

Introduce the first long-lived scheduler service inside the utility worker so every active monitor owns an idempotent pg-boss schedule and one worker handler that runs exactly one traversal for that monitor.

The design intentionally stops at scheduling. No-overlap, retry policy, expanded run-journal behavior, adaptive intervals, and UI belong to later cards.

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

It must not own matching, traversal persistence, retry/backoff policy, overlap protection, or UI concerns.

### Dependency boundary

The scheduler receives narrow dependencies instead of reaching into unrelated globals:

- a monitor repository capable of reading scheduler-relevant fields (`id`, `intervalSec`, `state`) and listing monitors;
- a pg-boss-compatible scheduling/worker interface;
- a `runMonitor(monitorId)` callback that performs exactly one existing monitor traversal.

This keeps unit tests independent of PostgreSQL while allowing a real PostgreSQL integration test for pg-boss behavior.

### Worker lifecycle

The worker runtime will become asynchronous:

1. create/start the scheduler;
2. reconcile persisted monitors;
3. only then send `{ type: 'ready' }` to the Electron parent;
4. on shutdown, stop scheduler/pg-boss gracefully;
5. then send `{ type: 'shutdown-complete' }` and exit.

A scheduler startup failure therefore prevents a false-ready state.

## Schedule identity and idempotency

Each monitor gets a distinct pg-boss queue name:

`monitor-run:<monitorId>`

The same name is used for queue creation, schedule registration, worker registration, and unscheduling.

Current pg-boss `schedule(name, cron, data, options)` updates an existing schedule with the same identity, while `unschedule(name)` removes it. The application therefore does not maintain a second scheduler-state table.

On every reconcile of an active monitor:

1. ensure the queue exists;
2. register/update the schedule with payload `{ monitorId }`;
3. ensure one local worker handler is registered for that queue.

On pause/archive:

1. remove the schedule;
2. stop local polling for that queue.

Repeated startup/reconcile calls must converge on the same pg-boss state rather than creating duplicates.

## Interval contract

MVP supports the product intervals already represented by the UI/prototype contract:

- 1 minute → `* * * * *`
- 2 minutes → `*/2 * * * *`
- 5 minutes → `*/5 * * * *`
- 10 minutes → `*/10 * * * *`
- 15 minutes → `*/15 * * * *`
- 60 minutes → `0 * * * *`

Persisted unsupported values are rejected explicitly. The scheduler does not round or silently rewrite intervals.

Five-field cron is used because current pg-boss scheduling documentation recommends the 5-placeholder form for its schedule evaluation cadence.

## Configuration synchronization

Database state remains authoritative.

`updateMonitorConfig()` keeps its Prisma transaction free of pg-boss side effects. A scheduler-facing application boundary performs:

1. commit the monitor configuration transaction;
2. after success, call `scheduler.syncMonitor(monitorId)`.

Future monitor creation in `5.0.1` uses the same post-commit hook. No hypothetical renderer/IPC API is introduced in this task.

If database commit fails, no scheduler mutation happens. If scheduler reconciliation fails after commit, the failure is surfaced; startup reconciliation remains the recovery mechanism on the next worker start.

## Job execution

The pg-boss worker validates/reads the scheduled payload and invokes `runMonitor(monitorId)` exactly once for each delivered job.

This card does not add overlap protection. If another job becomes eligible while one traversal is still running, `2.4.2` owns the policy that prevents concurrent traversals for the same monitor.

This card also does not add scheduler retry/backoff semantics. `2.4.4` owns that policy.

## Testing strategy

Follow RED → GREEN TDD for every production behavior.

Unit coverage:

- stable queue name from monitor id;
- supported interval-to-cron mappings and explicit rejection of unsupported intervals;
- startup reconciliation schedules active monitors and removes inactive ones;
- repeated reconciliation is idempotent from the caller perspective;
- interval changes update the existing schedule instead of introducing a second identity;
- pause/archive removes the schedule and worker;
- job handler invokes one monitor traversal with the persisted monitor id;
- worker runtime sends `ready` only after scheduler startup/reconciliation and sends shutdown-complete only after scheduler shutdown.

PostgreSQL integration coverage:

- start real pg-boss against the existing compose PostgreSQL;
- reconcile multiple active monitors and verify schedules exist;
- change one interval and verify the existing schedule is updated without a duplicate;
- pause/archive a monitor and verify its schedule disappears;
- repeat scheduler startup/reconciliation and verify one schedule per active monitor;
- deliver a job to a test handler and verify exactly one monitor id is dispatched.

Full repository verification remains the release gate: docs consistency, unit tests, failure-mode self-check, typecheck, lint, formatting, PostgreSQL integration, build/output verification, and both Electron smoke checks.

## Explicit non-goals

Do not implement in `2.4.1`:

- central tick loop or `setInterval` dispatcher;
- overlap/concurrency policy (`2.4.2`);
- new `Run` journal semantics (`2.4.3`);
- retry/backoff/degradation policy (`2.4.4`);
- adaptive intervals (`4.2`);
- monitor creation UI or renderer IPC (`5.0.1`);
- Redis or another queue backend;
- a second scheduler-state table.

## Completion criteria

The task is complete when the strict superset of the current repository card and the original v3.2 archive requirement is implemented, tests are GREEN, documentation is synchronized, the feature branch and fresh PR CI both pass the full verify workflow, the PR diff is reviewed, and the race-safe merge tree matches the verified feature tree.
