# Keyword Persistence Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject keyword terms that violate the existing single-token matcher contract at the monitor configuration persistence boundary, before invalid configuration can commit.

**Architecture:** Keep `matching-term.ts` as the single source of validation semantics. `monitor-config-persistence.ts` will validate every incoming `MonitorConfigPatch.keywords` entry by invoking the existing matcher compiler before constructing the Prisma update. No Prisma migration, matcher behavior change, or keyword JSON-shape migration is included.

**Tech Stack:** TypeScript 6, Vitest 5, Prisma 7, PostgreSQL 16, GitHub Actions.

**Spec:** `docs/tasks/2-7-10-keyword-persistence-validation.md`; matcher semantics remain defined by `docs/superpowers/specs/matching-rules.md` and task `2.7.2`.

## Global Constraints

- Follow TDD: production code is not changed until a real failing test has been observed.
- One term must normalize to exactly one token; empty and multi-token terms are invalid configuration.
- Glob semantics such as `playstation*` remain unchanged and valid.
- Keywords are non-source edits and must not reset `MonitorCursor`.
- Do not add phrase search, regex, Prisma migrations, keyword JSON-shape migration, or future editor IPC.
- Reuse the existing matching compiler contract rather than duplicating normalization rules.

---

### Task 1: Characterize the persistence gap

**Files:**
- Modify: `tests/integration/monitor-config-persistence.test.ts`

**Interfaces:**
- Consumes: `updateMonitorConfig(prisma, monitorId, patch)` from `electron/worker/monitor-config-persistence.ts`.
- Produces: a PostgreSQL integration regression proving invalid keyword terms cannot commit and cursor state remains unchanged.

- [ ] **Step 1: Write the failing test**

Add this case to the existing `monitor config persistence` integration suite:

```ts
it('rejects invalid keyword terms before commit without mutating cursor state', async () => {
  await expect(
    updateMonitorConfig(prisma, MONITOR_ID, {
      keywords: ['phone', 'playstation 5'],
    }),
  ).rejects.toThrow(/matching term/i)

  const monitor = await prisma.monitor.findUniqueOrThrow({ where: { id: MONITOR_ID } })
  expect(monitor.keywords).toEqual(['phone'])

  const cursor = await prisma.monitorCursor.findUniqueOrThrow({
    where: { monitorId: MONITOR_ID },
  })
  expect(cursor.boundaryTime?.toISOString()).toBe(BOUNDARY_TIME.toISOString())
  expect(cursor.boundaryIds).toEqual(BOUNDARY_IDS)
  expect(cursor.catchupCursor).toBe('page-2')
  expect(cursor.catchupBoundaryTime?.toISOString()).toBe(CATCHUP_BOUNDARY_TIME.toISOString())
  expect(cursor.catchupBoundaryIds).toEqual(CATCHUP_BOUNDARY_IDS)
  expect(cursor.catchupLastListTime?.toISOString()).toBe(CATCHUP_LAST_LIST_TIME.toISOString())
  expect(cursor.catchupLastListId).toBe(CATCHUP_LAST_LIST_ID)
})
```

- [ ] **Step 2: Push RED and verify the failure**

Run the canonical GitHub Actions `verify` workflow for the RED commit.

Expected product failure: this new PostgreSQL test reports that `updateMonitorConfig()` resolved and/or persisted `['phone', 'playstation 5']` instead of rejecting. Existing unit tests and unrelated integration checks remain green.

- [ ] **Step 3: Commit RED evidence**

Commit message:

```text
test: reject invalid persisted keyword terms
```

Record the RED commit SHA and workflow run in the task card after the expected failure is observed.

### Task 2: Validate with the existing matcher compiler

**Files:**
- Modify: `electron/worker/monitor-config-persistence.ts`
- Test: `tests/integration/monitor-config-persistence.test.ts`

**Interfaces:**
- Consumes: `matchingTermCompiler.compile(term)` from `electron/worker/matching-term-compiler.ts`.
- Produces: persistence-boundary validation for every element of `MonitorConfigPatch.keywords`.

- [ ] **Step 1: Add the minimal production validation**

Import the shared compiler:

```ts
import { matchingTermCompiler } from './matching-term-compiler'
```

Before reading/updating monitor state, validate only when a keyword patch is present:

```ts
if (patch.keywords !== undefined) {
  for (const term of patch.keywords) matchingTermCompiler.compile(term)
}
```

Do not catch/rewrite the compiler error in this slice; preserving the existing explicit `Matching term must normalize to exactly one token` failure keeps one validation contract.

- [ ] **Step 2: Verify GREEN**

Push the minimal production change and run the canonical `verify` workflow.

Expected: the new PostgreSQL integration passes; existing matcher, persistence, cursor, unit, typecheck, lint, format, build and Electron smoke checks remain green.

- [ ] **Step 3: Refactor only if necessary**

If formatting or lint requires a helper, extract only a local `validateKeywordTerms()` function in `monitor-config-persistence.ts`. Do not create a second matcher/normalizer abstraction.

### Task 3: Close documentation and review

**Files:**
- Modify: `docs/tasks/2-7-10-keyword-persistence-validation.md`
- Modify: `docs/epics/2-7-phase2-audit-remediation.md`
- Modify generated docs under `docs/operations/status/` and the Phase 2 rollup via `npm run docs:ops:refresh` semantics.

**Interfaces:**
- Consumes: RED/GREEN workflow run identifiers and exact final commit SHA.
- Produces: canonical done/aligned documentation and review-ready PR.

- [ ] **Step 1: Mark task done/aligned with evidence**

Set `status: done`, `sync_state: aligned`, and record RED and final GREEN workflow evidence.

- [ ] **Step 2: Restore epic 2.7 to done/aligned**

Update the epic status note and generated rollups to `11/11 done`.

- [ ] **Step 3: Run final verification**

Require the full canonical GitHub Actions workflow green at the exact final HEAD.

- [ ] **Step 4: Review before merge**

Compare the branch to `main`, verify only the bounded files changed, inspect review feedback, resolve any findings with another TDD cycle if behavior changes, then merge the PR only after all checks and review threads are clean.
