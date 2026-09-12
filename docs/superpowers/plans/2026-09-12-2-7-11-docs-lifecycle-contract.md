# Docs Lifecycle Contract 2.7.11 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce explicit parent lifecycle states for all-todo, partial-progress, and all-done child sets, and align drift-pause documentation with the runtime that exists today.

**Architecture:** Keep lifecycle derivation inside the zero-dependency docs-ops CLI. Derive one expected parent status from direct children and reuse the same validator for phase→epic and epic→task relationships. Documentation changes describe existing runtime semantics only; no worker, scheduler, database, or monitor-state behavior changes are part of this task.

**Tech Stack:** TypeScript, Node built-ins, Vitest, repository docs-ops CLI.

**Spec:** `docs/tasks/2-7-11-docs-lifecycle-audit-contract.md`

## Global Constraints

- All direct children `todo` → parent status must be `todo`.
- At least one child started/completed but not all children `done/aligned` → parent status must be `in_progress`.
- All direct children `done/aligned` → parent must be `done/aligned`.
- Intermediate parent `sync_state` remains independent of lifecycle status; this task does not force `aligned` while work remains.
- Do not implement monitor autopause; runtime remains typed `pause-required` signal plus terminal no-retry disposition.
- Do not change scheduler intervals, retry limits, queue semantics, database schema, or runtime worker code.

---

### Task 1: RED lifecycle tests for partial progress

**Files:**
- Modify: `tests/unit/docs-ops-check.test.ts`

**Interfaces:**
- Consumes: `tsx src/docs-ops/cli.ts check`
- Produces: regression coverage proving partial progress cannot remain `todo` at epic or phase level.

- [ ] **Step 1: Add an epic partial-progress fixture and failing test**

Create a fixture with one epic containing two tasks: one `done/aligned`, one `todo/drifted`; keep the epic `todo/drifted`. Assert `check` exits `1` and reports `lifecycle не соответствует дочерним задачам`.

- [ ] **Step 2: Add a phase partial-progress fixture and failing test**

Create a phase with one `done/aligned` epic and one `todo/drifted` epic; keep the phase `todo/drifted`. Assert `check` exits `1` and reports `lifecycle не соответствует дочерним эпикам`.

- [ ] **Step 3: Add valid boundary characterization**

Assert an all-`todo` parent remains valid as `todo`, and retain the existing all-children-`done/aligned` rejection when a parent is left `todo`.

- [ ] **Step 4: Verify RED**

Run canonical CI on the tests-only commit. Expected: only the two new partial-progress assertions fail because the current boolean `doneAligned(parent) !== kids.every(doneAligned)` check treats partial progress as valid `todo`.

- [ ] **Step 5: Commit**

Commit message: `test: require in-progress parent lifecycle`.

### Task 2: GREEN shared parent lifecycle validator

**Files:**
- Modify: `src/docs-ops/cli.ts`
- Test: `tests/unit/docs-ops-check.test.ts`

**Interfaces:**
- Produces: one shared lifecycle derivation used by phase→epic and epic→task validation.

- [ ] **Step 1: Implement expected parent status**

Add a helper equivalent to:

```ts
function expectedParentStatus(children: Doc[]): 'todo' | 'in_progress' | 'done' {
  if (children.every((child) => child.fm.status === 'todo')) return 'todo'
  if (children.every(doneAligned)) return 'done'
  return 'in_progress'
}
```

- [ ] **Step 2: Implement shared validation**

For parents with direct children, require `parent.fm.status === expectedParentStatus(children)`. When the expected status is `done`, also require `parent.fm.sync_state === 'aligned'`. Preserve the existing Russian error messages for task and epic relationships so existing diagnostics remain stable.

- [ ] **Step 3: Apply the helper symmetrically**

Replace the two boolean `doneAligned` equivalence loops with the shared rule for epics and phases.

- [ ] **Step 4: Verify GREEN at unit level and canonical CI**

Expected: new partial-progress tests pass; existing docs freshness/lifecycle tests stay GREEN. Repository-level docs consistency may now identify real parent metadata that must be aligned in Task 3.

- [ ] **Step 5: Commit**

Commit message: `fix: enforce parent progress lifecycle`.

### Task 3: Align existing parent metadata and drift-pause documentation

**Files:**
- Modify: `docs/epics/0-3-prisma-schema.md`
- Modify: `docs/epics/2-7-phase2-audit-remediation.md`
- Modify: `docs/phases/2-rules-scheduler.md`
- Modify: `docs/tasks/2-4-4-retries.md`
- Modify: `docs/superpowers/specs/deferred-requirements.md`

**Interfaces:**
- Consumes: lifecycle policy from Task 2 and existing `pause-required` runtime contract.
- Produces: repository metadata/docs that truthfully represent current implementation state.

- [ ] **Step 1: Align partial parents**

Set epic `0.3`, epic `2.7`, and phase `2` to `status: in_progress` while preserving `sync_state: drifted`. Update their `status_note` text to describe actual completed/pending slices rather than implying no work has started.

- [ ] **Step 2: Correct task 2.4.4 wording**

Replace the checked acceptance claim that schema drift "приводит к паузе монитора" with wording that it yields a terminal no-retry disposition and typed `pause-required` signal; explicitly state `Monitor.state` is not changed by task `2.4.4`.

- [ ] **Step 3: Record accepted temporary drift risk**

In `deferred-requirements.md`, add a focused note that until epic `4.3` implements actual autopause, the next schedule slot may traverse again and emit the same drift signal because the monitor remains active.

- [ ] **Step 4: Verify docs consistency**

Run `npm run docs:ops:check`. Expected: lifecycle violations are gone; generated rollups may be stale until Task 4 refreshes them.

- [ ] **Step 5: Commit**

Commit message: `docs: align lifecycle and drift pause semantics`.

### Task 4: Close 2.7.11 and refresh generated docs

**Files:**
- Modify: `docs/tasks/2-7-11-docs-lifecycle-audit-contract.md`
- Generated by `npm run docs:ops:refresh`: phase/epic autoblocks and `docs/operations/status/*.md`

**Interfaces:**
- Produces: `2.7.11` as `done/aligned` with auditable RED→GREEN evidence and fresh generated status docs.

- [ ] **Step 1: Close the task card**

Set `status: done`, `sync_state: aligned`, check every acceptance item, and document RED/GREEN/final verification run IDs and exact SHAs as evidence becomes available.

- [ ] **Step 2: Refresh generated docs**

Run `npm run docs:ops:refresh` and repository Prettier on modified docs if required. Generated rollups must show epic `2.7` as `in_progress`, phase `2` as `in_progress`, and task `2.7.11` as `done/aligned`.

- [ ] **Step 3: Run final exact-tree canonical verification**

Require dependency audit, docs consistency, unit tests, CI self-check, typecheck, lint, formatting, PostgreSQL integration, build/output verification, and development/production Electron smoke to all pass on the final tree.

- [ ] **Step 4: Review scope**

Compare the branch to `main`; only docs-ops lifecycle code/tests, the approved parent metadata/docs semantics, task closure, plan, and generated rollups may differ. No runtime worker/scheduler/database files may appear.

- [ ] **Step 5: Open PR**

Create a PR into `main` with RED/GREEN/final exact-tree evidence. Do not merge without explicit user authorization.
