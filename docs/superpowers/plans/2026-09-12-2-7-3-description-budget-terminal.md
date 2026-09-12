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

- [x] **Step 1: Write the failing budget-disposition test**

Created a focused harness that asserts budget exhaustion resolves `failed-no-retry` while persisting the policy/error journal.

- [x] **Step 2: Add transient-source characterization**

Covered `network`, `timeout`, and `http-5xx` with rejecting executor expectations to preserve the pg-boss retry path.

- [x] **Step 3: Verify RED**

Canonical verify **#1084** (`34694646451`) on commit `2f8178787e6a3646bdf2622904989c18c42d77ea` failed only because budget exhaustion was still rethrown; all three transient cases passed.

- [x] **Step 4: Commit RED tests**

Committed as `2f8178787e6a3646bdf2622904989c18c42d77ea` (`test: define terminal description budget disposition`).

---

### Task 2: GREEN — minimal executor disposition

**Files:**
- Modify: `electron/worker/scheduled-monitor-run.ts`
- Test: `tests/unit/description-budget-terminal-disposition.test.ts`
- Test: `tests/unit/scheduled-monitor-retry-disposition.test.ts`

**Interfaces:**
- Consumes: existing `FailedNoRetryMonitorRunResult` and journal classification.
- Produces: `DescriptionRequestBudgetExceededError` is journaled as policy/error and returns `{ cycleKind: 'failed-no-retry' }`.

- [x] **Step 1: Write the minimal production branch**

Added exactly:

```ts
if (error instanceof DescriptionRequestBudgetExceededError) {
  return { cycleKind: 'failed-no-retry' }
}
```

after journal persistence. Queue retry options and other failure branches were unchanged.

- [x] **Step 2: Verify GREEN**

The new focused regression was GREEN after commit `7d845550009e178b75e89cd9e0c11386ab2962eb`. Verify **#1085** then exposed one pre-existing characterization test whose expectation intentionally represented the old retryable budget behavior. Systematic debugging traced the failure to that stale contract; commit `e94dbda05c9d78fc8ea3f951130a816e48653db0` aligned only that expectation while preserving journal assertions. Canonical verify **#1087** later passed the complete suite.

- [x] **Step 3: Commit production change**

Committed as `7d845550009e178b75e89cd9e0c11386ab2962eb` (`fix: stop retries after description budget exhaustion`).

---

### Task 3: Persistent cache carry-over characterization

**Files:**
- Modify: `tests/unit/listing-description-cache.test.ts`
- Read: `electron/worker/listing-description-cache.ts`

**Interfaces:**
- Consumes: `ListingDescriptionCache.ensureDescription()` persistence contract.
- Produces: a two-instance test proving a description persisted by one run is a cache hit in the next run without HTTP or budget consumption.

- [x] **Step 1: Add a two-run persistent-cache test**

Added a stateful Prisma fake shared by two distinct cache instances. The first run fetches and persists the detail; the second run sees the persisted row, performs no HTTP request, and does not consume its request budget.

- [x] **Step 2: Verify the characterization is already GREEN**

Canonical verify **#1087** (`34694893254`) passed this test without any production cache changes, proving existing persistence semantics satisfy next-run cache progress.

- [x] **Step 3: Commit characterization test**

Committed as `3dee0efc21fc71a8e16bee4cca4bca37b24db210` (`test: preserve description cache progress across runs`).

---

### Task 4: Close task and verify exact tree

**Files:**
- Modify: `docs/tasks/2-7-3-description-budget-terminal-disposition.md`
- Modify generated operations/status docs only through the repository refresh command.

**Interfaces:**
- Consumes: RED and GREEN workflow evidence from Tasks 1-3.
- Produces: task status `done`, `sync_state: aligned`, refreshed rollups, and an exact-tree canonical GREEN commit suitable for PR review.

- [x] **Step 1: Update task evidence**

Marked the task `done/aligned`, checked every acceptance criterion, and recorded RED **#1084**, stale-contract diagnostic **#1085**, and code GREEN **#1087** evidence.

- [ ] **Step 2: Refresh generated docs**

Run `npm run docs:ops:refresh` using the established self-cleaning workflow pattern. Ensure no temporary workflow remains in the final tree.

- [ ] **Step 3: Run final canonical verify**

Require all unit, typecheck, lint, formatting, PostgreSQL, build, and Electron smoke steps to pass on the exact final tree.

- [ ] **Step 4: Review branch diff and open PR**

Compare against `main`, confirm only intended code/tests/docs changed, then open a PR. Do not merge without explicit user authorization.

## Evidence summary

- RED: verify **#1084**, commit `2f8178787e6a3646bdf2622904989c18c42d77ea`.
- Minimal production fix: `7d845550009e178b75e89cd9e0c11386ab2962eb`.
- Stale characterization alignment: `e94dbda05c9d78fc8ea3f951130a816e48653db0`.
- Cache carry-over characterization + code GREEN: verify **#1087**, commit `3dee0efc21fc71a8e16bee4cca4bca37b24db210`.
