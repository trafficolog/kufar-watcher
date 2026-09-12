# Description Budget Terminal Disposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `DescriptionRequestBudgetExceededError` terminal for the current scheduled job without reporting a false success, while preserving persistent description-cache progress and pg-boss retries for transient source failures.

**Architecture:** Keep retry policy ownership where it already lives. `createScheduledMonitorRunExecutor()` classifies and journals the policy failure, then returns the existing `failed-no-retry` disposition instead of rethrowing it; the scheduler/pg-boss worker therefore resolves that job, while network/timeout/5xx errors continue to reject and use the existing bounded queue retry policy. `ListingDescriptionCache` remains unchanged because successful detail loads are already persisted before a later budget exhaustion can terminate the run.

**Tech Stack:** TypeScript, Vitest, Prisma, pg-boss 12.30.0, GitHub Actions canonical verify.

**Spec:** `docs/tasks/2-7-3-description-budget-terminal-disposition.md`

## Global Constraints

- Treat run-level description budget exhaustion as terminal for only the current schedule tick.
- Keep `DESCRIPTION_REQUEST_LIMIT_PER_RUN = 10` unchanged.
- Keep bounded retries for network, timeout, and HTTP 5xx source failures unchanged.
- Persist `Run.outcome = error`, `errorCategory = policy`, and `errorCode = description-budget-exhausted`; do not report success.
- Reuse the existing `failed-no-retry` disposition; do not add queue-level retry protocol or adaptive scheduling.
- Preserve persistent description-cache writes completed before budget exhaustion.

---

### Task 1: RED — terminal policy disposition and transient characterization

**Files:**
- Create: `tests/unit/description-budget-terminal-disposition.test.ts`
- Read: `electron/worker/scheduled-monitor-run.ts`

**Interfaces:**
- Consumes: `DescriptionRequestBudgetExceededError`, `KufarSourceRequestError`, `createScheduledMonitorRunExecutor()`.
- Produces: focused regression tests that require budget exhaustion to resolve as `{ cycleKind: 'failed-no-retry' }` while transient source errors still reject.

- [ ] **Step 1: Write the failing budget-disposition test**

Create a focused test harness with a minimal Prisma fake and adapter registry, then add a test equivalent to:

```ts
it('treats description budget exhaustion as a terminal failed-no-retry run', async () => {
  const { prisma, runUpdate, createRunAdapters, descriptionLoader } = executorDependencies()
  const failure = new DescriptionRequestBudgetExceededError()
  const runCycle = vi.fn().mockRejectedValue(failure)
  const executor = createScheduledMonitorRunExecutor({
    prisma,
    createRunAdapters,
    maxPages: 5,
    descriptionLoader,
    runCycle: runCycle as never,
  })

  await expect(executor(17)).resolves.toEqual({ cycleKind: 'failed-no-retry' })
  expect(runCycle).toHaveBeenCalledTimes(1)
  expect(runUpdate).toHaveBeenCalledWith({
    where: { id: 9001 },
    data: {
      finishedAt: expect.any(Date),
      durationMs: expect.any(Number),
      outcome: 'error',
      seen: 0,
      matched: 0,
      error: 'Listing detail request budget exhausted',
      errorCategory: 'policy',
      errorCode: 'description-budget-exhausted',
      httpStatus: null,
    },
  })
})
```

- [ ] **Step 2: Add transient-source characterization**

Cover `network`, `timeout`, and `http-5xx` `KufarSourceRequestError` values with `it.each`, asserting `executor(17)` rejects with the same error. This protects the existing pg-boss retry path.

- [ ] **Step 3: Verify RED**

Run canonical/unit verification for the branch. Expected failure: the new budget test rejects with `DescriptionRequestBudgetExceededError` instead of resolving `failed-no-retry`; transient characterization passes.

- [ ] **Step 4: Commit RED tests**

Commit only the test changes with a message such as `test: define terminal description budget disposition`.

---

### Task 2: GREEN — minimal executor disposition

**Files:**
- Modify: `electron/worker/scheduled-monitor-run.ts`
- Test: `tests/unit/description-budget-terminal-disposition.test.ts`

**Interfaces:**
- Consumes: existing `FailedNoRetryMonitorRunResult` and journal classification.
- Produces: `DescriptionRequestBudgetExceededError` is journaled as policy/error and returns `{ cycleKind: 'failed-no-retry' }`.

- [ ] **Step 1: Write the minimal production branch**

Immediately after journal persistence and before retryable source handling, add:

```ts
if (error instanceof DescriptionRequestBudgetExceededError) {
  return { cycleKind: 'failed-no-retry' }
}
```

Do not change queue retry options or other failure branches.

- [ ] **Step 2: Verify GREEN**

Run the targeted unit tests, then the repository's canonical verification. Expected: budget-disposition and transient characterization tests pass with no unrelated failures.

- [ ] **Step 3: Commit production change**

Commit with a message such as `fix: stop retries after description budget exhaustion`.

---

### Task 3: Persistent cache carry-over characterization

**Files:**
- Modify: `tests/unit/listing-description-cache.test.ts`
- Read: `electron/worker/listing-description-cache.ts`

**Interfaces:**
- Consumes: `ListingDescriptionCache.ensureDescription()` persistence contract.
- Produces: a two-instance test proving a description persisted by one run is a cache hit in the next run without HTTP or budget consumption.

- [ ] **Step 1: Add a two-run persistent-cache test**

Use a small stateful Prisma fake shared by two distinct `ListingDescriptionCache` instances. First instance starts with no cached row, loads a fixture over HTTP, and records the fields passed to `listing.upsert`. The fake then exposes that persisted `description`, `descriptionLoadedAt`, and `availability` through `listing.findUnique`. Second instance uses the same fake with an HTTP mock that would fail if called plus `{ consume: vi.fn() }` as request budget.

Assert the second call resolves with `source: 'cache'`, performs no HTTP request, and does not call `consume()`.

- [ ] **Step 2: Verify the characterization is already GREEN**

Run the targeted cache test. Expected: PASS without production changes, proving current persistence semantics already satisfy the next-run cache-progress acceptance criterion.

- [ ] **Step 3: Commit characterization test**

Commit with a message such as `test: preserve description cache progress across runs`.

---

### Task 4: Close task and verify exact tree

**Files:**
- Modify: `docs/tasks/2-7-3-description-budget-terminal-disposition.md`
- Modify generated operations/status docs only through the repository refresh command.

**Interfaces:**
- Consumes: RED and GREEN workflow evidence from Tasks 1-3.
- Produces: task status `done`, `sync_state: aligned`, refreshed rollups, and an exact-tree canonical GREEN commit suitable for PR review.

- [ ] **Step 1: Update task evidence**

Mark each acceptance criterion complete and record the exact RED/GREEN workflow run numbers and relevant commit SHAs.

- [ ] **Step 2: Refresh generated docs**

Run `npm run docs:ops:refresh` using the established self-cleaning workflow pattern if local execution is unavailable. Ensure no temporary workflow remains in the final tree.

- [ ] **Step 3: Run final canonical verify**

Require all unit, typecheck, lint, formatting, PostgreSQL, build, and Electron smoke steps to pass on the exact final tree.

- [ ] **Step 4: Review branch diff and open PR**

Compare against `main`, confirm only intended code/tests/docs changed, then open a PR. Do not merge without explicit user authorization.
