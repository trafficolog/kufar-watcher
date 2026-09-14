# 2.7.12 Process-safe Run Orphan Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent startup recovery in one worker process from interrupting a live `Run` owned by another worker, while still recovering true crash-orphans after the canonical per-monitor PostgreSQL advisory lease becomes available.

**Architecture:** Extract startup `Run` recovery into a focused `monitor-run-recovery.ts` module. Recovery first selects candidate `monitorId`s, then acquires the exact same `AcquireMonitorRunLease` used by scheduled executions; only while that lease is held may it mutate remaining `running` rows to `interrupted`. `worker-application.ts` remains the orchestration boundary and constructs the recovery lease acquirer explicitly from `config.databaseUrl`; no heartbeat, TTL, schema change, global worker mutex, or pg-boss policy change is introduced.

**Tech Stack:** TypeScript 6, Node.js 22, Prisma 7/PostgreSQL, `pg` advisory locks, Vitest 5, GitHub Actions, project docs-ops tooling.

**Spec:** `docs/superpowers/specs/2026-09-14-2-7-12-process-safe-run-recovery-design.md`

## Global Constraints

- Reuse `createPostgresMonitorRunLeaseAcquirer()` and the existing `(MONITOR_RUN_LOCK_NAMESPACE, monitorId)` namespace; do not create a second lock namespace.
- Production recovery constructs its PostgreSQL lease acquirer explicitly from `config.databaseUrl`; local in-memory leases are test-only injected dependencies.
- A busy lease (`null`) is a normal live-owner signal, not a startup failure.
- DB read/update errors and lease infrastructure errors remain fail-closed: `scheduler.start()` must not run.
- Recovery must hold the lease through the terminal SQL mutation; never check the lock and release before the `UPDATE`.
- Preserve existing `interrupted` field semantics: `finishedAt`, clamped `durationMs`, `outcome='interrupted'`, `error='Worker process interrupted before Run completion'`, `errorCategory='internal'`, `errorCode='worker-interrupted'`.
- Preserve `seen`, `matched`, `httpStatus`, and `degradedLevel` exactly as the existing recovery does.
- No Prisma schema migration, no heartbeat/TTL/worker registry, no global singleton worker lock, and no pg-boss scheduling changes.
- Follow canonical docs lifecycle: task card exists before production code; run `npm run docs:ops:refresh && npm run docs:ops:check` whenever task/epic lifecycle changes.
- TDD evidence must include a real PostgreSQL RED proving that a live owner is incorrectly interrupted by the current blind startup `UPDATE` before production code changes.

---

## File Structure

- Create `docs/tasks/2-7-12-process-safe-run-orphan-recovery.md` — canonical implementation task and TDD evidence.
- Modify `docs/epics/2-7-phase2-audit-remediation.md` — add `2.7.12`, temporary `in_progress/drifted`, final `12/12 done/aligned`.
- Modify `docs/phases/2-rules-scheduler.md` — generated rollup only; phase remains `in_progress/drifted` because 2.5/2.6 are still open.
- Modify generated status files under `docs/operations/status/` via docs-ops refresh.
- Modify `docs/tasks/2-7-4-run-lifecycle-integrity.md` — historical cross-link only; do not rewrite its original scope.
- Modify `docs/tasks/2-7-6-durable-monitor-no-overlap.md` — cross-link that recovery reuses the same lease primitive.
- Modify `docs/superpowers/specs/data-model.md` — clarify that startup `interrupted` requires advisory-lease ownership proof, not merely a `running` row.
- Create `electron/worker/monitor-run-recovery.ts` — sole owner of process-safe orphan recovery algorithm and SQL mutation.
- Modify `electron/worker/worker-application.ts` — remove blind global recovery, wire the focused recovery module and production PostgreSQL lease acquirer.
- Keep `electron/worker/monitor-run-lease.ts` behavior and exports unchanged; its current exported `AcquireMonitorRunLease`, local acquirer, and PostgreSQL acquirer are sufficient.
- Modify `tests/unit/run-lifecycle-recovery.test.ts` — unit orchestration, busy lease, fail-closed and release semantics.
- Modify `tests/integration/run-lifecycle-recovery.test.ts` — real multi-context PostgreSQL characterization and recovery acceptance.
- Modify dependency fixtures in `tests/unit/worker-application.test.ts`, `tests/unit/telegram-outbox-application.test.ts`, and `tests/unit/telegram-reconnect-application.test.ts` so custom worker applications inject a local recovery lease acquirer rather than reaching a fake PostgreSQL URL.
- No change to `scripts/verify-postgres-compose.sh`: `run-lifecycle-recovery.test.ts` is already in the canonical PostgreSQL integration allowlist.

---

### Task 1: Open the canonical `2.7.12` lifecycle before code

**Files:**
- Create: `docs/tasks/2-7-12-process-safe-run-orphan-recovery.md`
- Modify: `docs/epics/2-7-phase2-audit-remediation.md`
- Modify/generated: `docs/phases/2-rules-scheduler.md`
- Modify/generated: `docs/operations/status/current-state.md`
- Modify/generated: `docs/operations/status/drift-report.md`
- Modify/generated: `docs/operations/status/epics.md`
- Modify/generated: `docs/operations/status/phases.md`
- Modify/generated: `docs/operations/status/tasks.md`

**Interfaces:**
- Consumes: approved design in `docs/superpowers/specs/2026-09-14-2-7-12-process-safe-run-recovery-design.md`.
- Produces: canonical task ID `2.7.12`, with implementation status visible to docs-ops before any production commit.

- [ ] **Step 1: Create the task card in `in_progress` state**

Use this frontmatter and scope:

```md
---
id: "2.7.12"
phase: 2
epic: "2.7"
status: in_progress
sync_state: drifted
last_reviewed: 2026-09-14
roles: [BACK, DB, QA]
depends_on: ["2.7.4", "2.7.6"]
estimated_hours: 4-6
agent: backend-senior
tags: [audit, run, lifecycle, recovery, postgres, locking, p1]
---

# Задача 2.7.12 — Process-safe Run orphan recovery

## Проблема

Startup recovery из 2.7.4 делает blind UPDATE всех `Run(outcome='running', finishedAt=null)`. После 2.7.6 это небезопасно: другой живой worker может владеть таким Run через canonical per-monitor PostgreSQL advisory lease.

## Решение

Recovery обязан получить и удерживать тот же per-monitor lease, что scheduled executor, прежде чем считать `running` row orphan и переводить его в `interrupted`.

## Критерии приёмки

- [ ] Live Run, чей advisory lease удерживается другим PostgreSQL context, не изменяется startup recovery.
- [ ] После release/crash owner session тот же orphan восстанавливается в `interrupted`.
- [ ] Recovery удерживает canonical lease до завершения terminal UPDATE.
- [ ] Busy lease не является общей startup failure; инфраструктурная lease/DB ошибка остаётся fail-closed.
- [ ] Разные monitor IDs независимы; повторный recovery идемпотентен.
- [ ] Несколько stale `running` rows одного monitor закрываются в одном доказанном ownership window.
- [ ] PostgreSQL integration использует реальные независимые contexts и настоящий advisory lease.

## Не делать

- Не добавлять heartbeat/TTL/worker registry.
- Не вводить global worker singleton.
- Не менять Prisma schema или pg-boss policy.
```

- [ ] **Step 2: Re-open epic 2.7 without changing phase-2 top-level lifecycle**

Set `docs/epics/2-7-phase2-audit-remediation.md` frontmatter to:

```yaml
status: in_progress
sync_state: drifted
last_reviewed: 2026-09-14
status_note: "11/12 done: 2.7.12 усиливает Run startup recovery process-safe ownership proof через canonical per-monitor advisory lease."
```

Add `2.7.12` as the twelfth task and keep all existing tasks unchanged.

Do **not** change phase 2 frontmatter: it is already `in_progress/drifted` because epics 2.5 and 2.6 remain open. Only its generated epic rollup should reflect `2.7` as in progress.

- [ ] **Step 3: Refresh generated docs**

Run:

```bash
npm run docs:ops:refresh
npm run docs:ops:check
```

Expected: `docs:ops:check` PASS; task count increases by one and epic 2.7 is no longer counted as done while `2.7.12` is open.

- [ ] **Step 4: Commit the docs-open state**

```bash
git add docs/tasks/2-7-12-process-safe-run-orphan-recovery.md \
  docs/epics/2-7-phase2-audit-remediation.md \
  docs/phases/2-rules-scheduler.md \
  docs/operations/status/
git commit -m "docs: open process-safe run recovery task"
```

---

### Task 2: Write the real PostgreSQL RED characterization

**Files:**
- Modify: `tests/integration/run-lifecycle-recovery.test.ts`
- No production files.

**Interfaces:**
- Consumes: `createPostgresMonitorRunLeaseAcquirer(connectionString)` from `electron/worker/monitor-run-lease.ts`.
- Produces: a failing cross-process acceptance test proving the current global startup `UPDATE` can interrupt a live owned Run.

- [ ] **Step 1: Make integration config use the real test database URL**

Add a helper:

```ts
function databaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for Run recovery integration')
  return value
}
```

Build `createWorkerApplication()` integration config with `databaseUrl: databaseUrl()` so future recovery wiring is forced to use the same real PostgreSQL database as the Prisma client.

- [ ] **Step 2: Add the live-owner RED**

Import:

```ts
import { createPostgresMonitorRunLeaseAcquirer } from '../../electron/worker/monitor-run-lease'
```

Add a test with this ordering:

```ts
it('does not interrupt a running row owned by another live PostgreSQL session', async () => {
  const acquireLease = createPostgresMonitorRunLeaseAcquirer(databaseUrl())
  const ownerLease = await acquireLease(MONITOR_ID)
  expect(ownerLease).not.toBeNull()

  const liveRun = await prisma.run.create({
    data: {
      monitorId: MONITOR_ID,
      startedAt: new Date(Date.now() - 5_000),
      outcome: 'running',
    },
  })

  const scheduler = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  } as unknown as MonitorScheduler
  const app = createWorkerApplication(
    { ...config, databaseUrl: databaseUrl() },
    vi.fn(),
    dependenciesFor(prisma, scheduler),
  )

  try {
    await app.start()
    expect(await prisma.run.findUniqueOrThrow({ where: { id: liveRun.id } })).toMatchObject({
      outcome: 'running',
      finishedAt: null,
    })
    expect(scheduler.start).toHaveBeenCalledTimes(1)
  } finally {
    await ownerLease?.release()
  }
})
```

This must use a real lease held by an independent `pg.Client` session. Do not replace it with a mocked lock.

- [ ] **Step 3: Add crash/release recovery to the same behavioral seam**

After proving the row survives while the owner session exists, release the owner lease and start a second worker application. Assert the same row becomes:

```ts
expect(recovered).toMatchObject({
  outcome: 'interrupted',
  error: 'Worker process interrupted before Run completion',
  errorCategory: 'internal',
  errorCode: 'worker-interrupted',
})
expect(recovered.finishedAt).not.toBeNull()
expect(recovered.durationMs ?? -1).toBeGreaterThanOrEqual(0)
```

- [ ] **Step 4: Run the canonical PostgreSQL integration and confirm RED**

Run:

```bash
bash scripts/verify-postgres-compose.sh
```

Expected on current production code: FAIL only because the live-owned row is changed to `interrupted` by startup recovery. Existing PostgreSQL integration cases should remain green up to that assertion.

- [ ] **Step 5: Commit the RED characterization**

```bash
git add tests/integration/run-lifecycle-recovery.test.ts
git commit -m "test: characterize live run recovery ownership"
```

Push/open a draft PR if not already open and retain the exact RED workflow run ID as task evidence.

---

### Task 3: Add unit REDs for recovery orchestration and lease lifecycle

**Files:**
- Modify: `tests/unit/run-lifecycle-recovery.test.ts`
- No production files yet.

**Interfaces:**
- Future production dependency to exercise:

```ts
createRunRecoveryLeaseAcquirer(databaseUrl: string): AcquireMonitorRunLease
```

- Future recovery API:

```ts
export interface RecoverInterruptedMonitorRunsOptions {
  prisma: PrismaClient
  acquireMonitorRunLease: AcquireMonitorRunLease
}

export function recoverInterruptedMonitorRuns(
  options: RecoverInterruptedMonitorRunsOptions,
): Promise<void>
```

- [ ] **Step 1: Add a future dependency seam to the test fixture without changing production**

Prepare a typed test-local extension until production declares the field:

```ts
type RecoveryAwareDependencies = WorkerApplicationDependencies & {
  createRunRecoveryLeaseAcquirer(databaseUrl: string): AcquireMonitorRunLease
}
```

Pass the extended object to `createWorkerApplication()` through one final `as unknown as WorkerApplicationDependencies` cast. Current production ignores the extra function, which is exactly why the following assertions are RED. Remove the extension/cast in the GREEN commit once `WorkerApplicationDependencies` owns the field.

- [ ] **Step 2: RED — recovery still precedes scheduler start**

Replace the old `$executeRaw`-only sequencing assertion with an observable future flow:

```ts
expect(order).toEqual([
  'recovery:read',
  'lease:acquire',
  'recovery:update',
  'lease:release',
  'scheduler:start',
])
```

The Prisma double exposes `run.findMany()` returning one candidate and `$executeRaw` pushing `recovery:update`; the injected lease acquirer pushes `lease:acquire` and returns a lease whose `release()` pushes `lease:release`. Current production produces only the blind update/scheduler sequence, so the assertion fails for the ownership gap.

- [ ] **Step 3: RED — a busy lease is not startup failure**

Set `run.findMany()` to return `[{ monitorId: 101 }]`, inject an acquirer that returns `null`, and assert:

```ts
await expect(app.start()).resolves.toBeUndefined()
expect(prisma.$executeRaw).not.toHaveBeenCalled()
expect(scheduler.start).toHaveBeenCalledTimes(1)
```

Current production ignores the busy-lease seam and executes the blind mutation, so this is RED.

- [ ] **Step 4: RED — infrastructure failure remains fail-closed**

Cover candidate-read rejection and lease-acquisition rejection separately:

```ts
await expect(app.start()).rejects.toBe(recoveryFailure)
expect(scheduler.start).not.toHaveBeenCalled()
```

For the lease-acquisition case, `run.findMany()` succeeds and the injected acquirer rejects. Current production never calls it, so the expected lease error is not observed.

- [ ] **Step 5: RED — release always runs and primary errors are not masked**

Drive all cases through `app.start()` with one candidate:

```ts
expect(release).toHaveBeenCalledTimes(1)
```

Cases:

```text
successful mutation + successful release -> start succeeds, release once
failed mutation + successful release -> mutation error rejects, release once
failed mutation + failed release -> mutation error remains the rejection, release once
successful mutation + failed release -> release error rejects startup
```

Current production ignores the injected lease entirely, so release assertions/release-error disposition are RED without importing a not-yet-created production module.

- [ ] **Step 6: Run the unit file and confirm RED**

Run:

```bash
npx vitest run tests/unit/run-lifecycle-recovery.test.ts
```

Expected: FAIL because current startup recovery has no per-monitor lease seam/algorithm.

- [ ] **Step 7: Commit unit REDs**

```bash
git add tests/unit/run-lifecycle-recovery.test.ts
git commit -m "test: define process-safe run recovery contract"
```

---

### Task 4: Implement the focused process-safe recovery module

**Files:**
- Create: `electron/worker/monitor-run-recovery.ts`
- Modify: `electron/worker/worker-application.ts`
- Modify: `tests/unit/run-lifecycle-recovery.test.ts`
- Modify: `tests/integration/run-lifecycle-recovery.test.ts`
- Modify: `tests/unit/worker-application.test.ts`
- Modify: `tests/unit/telegram-outbox-application.test.ts`
- Modify: `tests/unit/telegram-reconnect-application.test.ts`
- Do not modify: `electron/worker/monitor-run-lease.ts`

**Interfaces:**
- Consumes:

```ts
export type AcquireMonitorRunLease = (
  monitorId: number,
) => Promise<MonitorRunLease | null>
```

- Produces:

```ts
export interface RecoverInterruptedMonitorRunsOptions {
  prisma: PrismaClient
  acquireMonitorRunLease: AcquireMonitorRunLease
}

export async function recoverInterruptedMonitorRuns(
  options: RecoverInterruptedMonitorRunsOptions,
): Promise<void>
```

and a new application dependency:

```ts
createRunRecoveryLeaseAcquirer(databaseUrl: string): AcquireMonitorRunLease
```

- [ ] **Step 1: Create `monitor-run-recovery.ts` with candidate selection**

Use typed Prisma selection rather than a global raw read:

```ts
const candidates = await options.prisma.run.findMany({
  where: {
    outcome: RUN_OUTCOME.RUNNING,
    finishedAt: null,
  },
  distinct: ['monitorId'],
  select: { monitorId: true },
})
```

Iterate candidate monitor IDs sequentially. Sequential startup recovery is intentional: expected monitor count is small, it keeps failure ordering deterministic, and it avoids creating a burst of dedicated PostgreSQL sessions at boot.

- [ ] **Step 2: Acquire the canonical lease before mutation**

For each candidate:

```ts
const lease = await options.acquireMonitorRunLease(monitorId)
if (!lease) continue
```

Do not create a second lock namespace or age-based fallback.

- [ ] **Step 3: Move the existing terminal SQL into a per-monitor mutation**

Execute while the lease is held:

```ts
const recoveredAt = new Date()
await options.prisma.$executeRaw`
  UPDATE "Run"
  SET
    "finishedAt" = ${recoveredAt}::timestamp,
    "durationMs" = LEAST(
      2147483647,
      GREATEST(
        0,
        FLOOR(EXTRACT(EPOCH FROM (${recoveredAt}::timestamp - "startedAt")) * 1000)
      )
    )::integer,
    "outcome" = ${RUN_OUTCOME.INTERRUPTED}::text,
    "error" = 'Worker process interrupted before Run completion',
    "errorCategory" = 'internal',
    "errorCode" = 'worker-interrupted'
  WHERE "monitorId" = ${monitorId}
    AND "outcome" = ${RUN_OUTCOME.RUNNING}::text
    AND "finishedAt" IS NULL
`
```

Keep every existing mutation field exactly as above; do not reset journal counters/status/degradation.

- [ ] **Step 4: Implement non-masking release error semantics**

Use a small helper for one acquired monitor lease:

```ts
let primaryError: unknown
try {
  await recoverMonitorRows(prisma, monitorId)
} catch (error) {
  primaryError = error
}

try {
  await lease.release()
} catch (releaseError) {
  if (primaryError === undefined) throw releaseError
}

if (primaryError !== undefined) throw primaryError
```

This satisfies both requirements: release always runs; release failure is fatal after a successful mutation but does not replace an earlier recovery failure.

- [ ] **Step 5: Wire production recovery explicitly from `config.databaseUrl`**

In `WorkerApplicationDependencies`, add:

```ts
createRunRecoveryLeaseAcquirer(databaseUrl: string): AcquireMonitorRunLease
```

In defaults:

```ts
createRunRecoveryLeaseAcquirer: createPostgresMonitorRunLeaseAcquirer,
```

During application construction:

```ts
const acquireRunRecoveryLease = dependencies.createRunRecoveryLeaseAcquirer(config.databaseUrl)
```

During startup:

```ts
await recoverInterruptedMonitorRuns({
  prisma,
  acquireMonitorRunLease: acquireRunRecoveryLease,
})
await scheduler.start()
```

Delete the old local `recoverInterruptedRuns()` blind global `UPDATE` from `worker-application.ts`.

- [ ] **Step 6: Update every known custom WorkerApplication dependency fixture**

Add the local acquirer import and this dependency to:

```text
tests/unit/run-lifecycle-recovery.test.ts
tests/unit/worker-application.test.ts
tests/unit/telegram-outbox-application.test.ts
tests/unit/telegram-reconnect-application.test.ts
```

Use:

```ts
createRunRecoveryLeaseAcquirer: () => createLocalMonitorRunLeaseAcquirer(),
```

For `tests/integration/run-lifecycle-recovery.test.ts`, use the real database-backed dependency:

```ts
createRunRecoveryLeaseAcquirer: (databaseUrl) =>
  createPostgresMonitorRunLeaseAcquirer(databaseUrl),
```

Prisma doubles in tests that call `app.start()` must expose:

```ts
run: {
  findMany: vi.fn(async () => []),
},
```

unless the test intentionally supplies recovery candidates.

Do not let production code infer a local fallback from a fake Prisma client.

- [ ] **Step 7: Run focused unit tests**

Run:

```bash
npx vitest run tests/unit/run-lifecycle-recovery.test.ts \
  tests/unit/worker-application.test.ts \
  tests/unit/telegram-outbox-application.test.ts \
  tests/unit/telegram-reconnect-application.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run the PostgreSQL integration**

Run:

```bash
bash scripts/verify-postgres-compose.sh
```

Expected: PASS, including live-owner preservation and orphan recovery after owner release.

- [ ] **Step 9: Run typecheck before committing**

Run:

```bash
npm run typecheck
```

Expected: PASS with the new required dependency present in every custom worker dependency fixture.

- [ ] **Step 10: Commit the GREEN implementation**

```bash
git add electron/worker/monitor-run-recovery.ts \
  electron/worker/worker-application.ts \
  tests/unit/run-lifecycle-recovery.test.ts \
  tests/integration/run-lifecycle-recovery.test.ts \
  tests/unit/worker-application.test.ts \
  tests/unit/telegram-outbox-application.test.ts \
  tests/unit/telegram-reconnect-application.test.ts
git commit -m "fix: make run recovery process-safe"
```

---

### Task 5: Harden concurrency acceptance around the ownership window

**Files:**
- Modify: `tests/integration/run-lifecycle-recovery.test.ts`
- No production files.

**Interfaces:**
- Consumes: `recoverInterruptedMonitorRuns()` and canonical `createPostgresMonitorRunLeaseAcquirer()`.
- Produces: acceptance evidence for TOCTOU exclusion, monitor independence, multiple stale rows and concurrent recoveries.

- [ ] **Step 1: Add deterministic PostgreSQL row-lock and activity helpers**

Import the real driver:

```ts
import { Client } from 'pg'
```

Add a polling helper that observes the real recovery `UPDATE` blocked on a row lock:

```ts
async function waitForBlockedRecoveryUpdate(inspector: Client): Promise<void> {
  const deadline = Date.now() + 5_000

  while (Date.now() < deadline) {
    const result = await inspector.query<{ blocked: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND state = 'active'
          AND wait_event_type = 'Lock'
          AND query LIKE '%UPDATE "Run"%'
      ) AS blocked
    `)
    if (result.rows[0]?.blocked) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  throw new Error('Timed out waiting for blocked Run recovery update')
}
```

Create a dedicated blocker connection:

```ts
const blocker = new Client({ connectionString: databaseUrl() })
await blocker.connect()
await blocker.query('BEGIN')
await blocker.query(
  'SELECT "id" FROM "Run" WHERE "monitorId" = $1 FOR UPDATE',
  [MONITOR_ID],
)
```

Use a separate inspector `Client` for `pg_stat_activity` polling. Always `ROLLBACK`/`end()` blocker and `end()` inspector in `finally`.

- [ ] **Step 2: Assert TOCTOU exclusion while the real mutation is blocked**

Start `recoverInterruptedMonitorRuns()` with the real PostgreSQL acquirer while the blocker transaction holds the Run row lock. Wait for `waitForBlockedRecoveryUpdate(inspector)`; at that point recovery has passed candidate selection, acquired the advisory lease, issued the real `UPDATE`, and is waiting on the row lock.

Then assert:

```ts
expect(await thirdAcquire(MONITOR_ID)).toBeNull()
```

Release the blocker transaction, await recovery, and then assert:

```ts
const leaseAfter = await thirdAcquire(MONITOR_ID)
expect(leaseAfter).not.toBeNull()
await leaseAfter?.release()
```

This proves the canonical lease remains held across the actual terminal SQL mutation, not merely around a pre-check.

- [ ] **Step 3: Assert different monitor independence during the same blocked mutation**

Create `OTHER_MONITOR_ID` and, while recovery is blocked on `MONITOR_ID`, assert:

```ts
const otherLease = await thirdAcquire(OTHER_MONITOR_ID)
expect(otherLease).not.toBeNull()
await otherLease?.release()
```

- [ ] **Step 4: Assert multiple stale rows are recovered under one ownership window**

Create two `running` rows for one monitor with no live owner lease, run `recoverInterruptedMonitorRuns()` once, and assert both become `interrupted` with non-null `finishedAt`, non-negative `durationMs`, `errorCategory='internal'`, and `errorCode='worker-interrupted'`.

- [ ] **Step 5: Assert concurrent recovery contexts serialize by the same advisory key**

Reuse the row-lock barrier:

1. start recovery A and wait until its real `UPDATE` is blocked;
2. start recovery B with an independent Prisma/lease context;
3. assert recovery B resolves while recovery A remains blocked, because B receives busy `null` for the advisory lease and performs no mutation;
4. release the blocker and await recovery A;
5. assert the candidate rows are terminal exactly once and a subsequent recovery is idempotent.

- [ ] **Step 6: Run focused PostgreSQL verification**

Run:

```bash
bash scripts/verify-postgres-compose.sh
```

Expected: PASS with no production changes after the GREEN implementation.

- [ ] **Step 7: Commit concurrency hardening tests**

```bash
git add tests/integration/run-lifecycle-recovery.test.ts
git commit -m "test: harden run recovery ownership window"
```

---

### Task 6: Align lifecycle documentation with the new ownership proof

**Files:**
- Modify: `docs/tasks/2-7-4-run-lifecycle-integrity.md`
- Modify: `docs/tasks/2-7-6-durable-monitor-no-overlap.md`
- Modify: `docs/tasks/2-7-12-process-safe-run-orphan-recovery.md`
- Modify: `docs/superpowers/specs/data-model.md`
- Modify: `docs/epics/2-7-phase2-audit-remediation.md`
- Modify/generated: `docs/phases/2-rules-scheduler.md`
- Modify/generated: `docs/operations/status/current-state.md`
- Modify/generated: `docs/operations/status/drift-report.md`
- Modify/generated: `docs/operations/status/epics.md`
- Modify/generated: `docs/operations/status/phases.md`
- Modify/generated: `docs/operations/status/tasks.md`

**Interfaces:**
- Consumes: final RED/GREEN commit SHAs and workflow run IDs.
- Produces: historically truthful docs and final `2.7.12 done/aligned`, epic `2.7 done/aligned` with `12/12 done`.

- [ ] **Step 1: Clarify data-model lifecycle wording**

Replace the too-broad `interrupted` description with:

```md
| `interrupted` | startup recovery доказал orphan: `running` row не имеет `finishedAt`, а recovery получил и удерживал canonical per-monitor advisory lease во время terminal update | неуспешная terminal; не считать `success` или `skipped` |
```

Follow it with:

```md
Наличие `running` row само по себе не доказывает orphan в multi-worker режиме. Если canonical advisory lease monitor занят другим process, startup recovery оставляет Run незавершённым. После crash/disconnect owner session lock освобождается PostgreSQL, и следующий recovery может безопасно перевести row в `interrupted` до запуска scheduler.
```

- [ ] **Step 2: Add historical cross-links instead of rewriting 2.7.4/2.7.6**

In `2.7.4`, append a note that multi-process ownership safety is strengthened by `2.7.12` and that the original startup recovery predated the durable lease introduced by `2.7.6`.

In `2.7.6`, append a note that `2.7.12` reuses its exact per-monitor advisory lease as the orphan-proof primitive; do not alter the original TDD evidence.

- [ ] **Step 3: Complete the 2.7.12 task card with evidence**

Set:

```yaml
status: done
sync_state: aligned
last_reviewed: 2026-09-14
```

Check every acceptance box and record exact:

```text
RED commit + workflow run proving live-owner false interruption
GREEN implementation commit + workflow run
concurrency-hardening commit + workflow run
final exact-head SHA + tree + workflow run
```

Do not claim Codex review evidence until it actually exists; quota exhaustion is recorded separately in the PR process, not as a successful review.

- [ ] **Step 4: Close epic 2.7 back to 12/12 done/aligned**

Set:

```yaml
status: done
sync_state: aligned
last_reviewed: 2026-09-14
status_note: "12/12 done: 2.7.12 закрыла multi-worker Run orphan recovery, переиспользуя canonical per-monitor PostgreSQL advisory lease как ownership proof."
```

Add the completed `2.7.12` row and keep earlier evidence intact.

- [ ] **Step 5: Refresh and check generated docs**

Run:

```bash
npm run docs:ops:refresh
npm run docs:ops:check
```

Expected: PASS. Phase 2 remains `in_progress/drifted` because 2.5/2.6 are still todo, but epic 2.7 returns to done/aligned.

- [ ] **Step 6: Commit final docs state**

```bash
git add docs/tasks/2-7-4-run-lifecycle-integrity.md \
  docs/tasks/2-7-6-durable-monitor-no-overlap.md \
  docs/tasks/2-7-12-process-safe-run-orphan-recovery.md \
  docs/superpowers/specs/data-model.md \
  docs/epics/2-7-phase2-audit-remediation.md \
  docs/phases/2-rules-scheduler.md \
  docs/operations/status/
git commit -m "docs: close process-safe run recovery"
```

---

### Task 7: Final exact-head verification, review, and merge

**Files:**
- No expected code changes.
- PR metadata/comments only unless review identifies a verified defect.

**Interfaces:**
- Consumes: final branch head containing tasks 1–6.
- Produces: exact-head CI evidence, review disposition, merge commit/tree equality, and `main` ref confirmation.

- [ ] **Step 1: Run the complete project checks in the execution environment**

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run docs:ops:check
bash scripts/verify-postgres-compose.sh
```

Expected: all PASS. In this GitHub-connector session, GitHub Actions remains the authoritative executable environment when no local repository/Docker daemon is available.

- [ ] **Step 2: Push exact head and record canonical GitHub Actions verify**

The workflow must pass all current gates from `.github/workflows/verify.yml`:

```text
Dependency audit
Verify advisory overrides
Documentation consistency
Unit tests
CI failure-mode self-check
Typecheck
Lint
Formatting
Dockerode runtime integration
Postgres compose integration
Build
Verify build outputs
Development launch smoke
Production launch smoke
```

Do not proceed on an older green run if the head changed afterward.

- [ ] **Step 3: Mark PR ready and request code review**

Request Codex review on the unchanged final SHA. If findings appear, use `receiving-code-review`: verify each finding against the code/spec before changing anything, fix one verified item at a time, rerun exact-head verification, reply inline and resolve the thread.

If Codex review is unavailable solely because the account quota is exhausted, do not represent that as a successful review. Preserve the quota evidence and require an explicit user decision before bypassing the review gate.

- [ ] **Step 4: Verify pre-merge invariants**

Immediately before merge confirm:

```text
PR head == exact SHA that passed final verify
all required workflow jobs == success
unresolved review threads == 0
review disposition satisfies the chosen gate
```

- [ ] **Step 5: Merge with expected-head protection**

Merge only with `expected_head_sha=<verified final SHA>`.

- [ ] **Step 6: Verify merge tree and main ref**

Fetch the merge commit and confirm:

```text
merge tree == verified branch tree
refs/heads/main == merge commit
GitHub verification signature is valid when supplied
```

Only after these checks report `2.7.12` as merged/completed.
