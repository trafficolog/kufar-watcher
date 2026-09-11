# 0.4.4 Dependency Advisory Remediation — Implementation Plan

> **For implementation:** follow Superpowers TDD/execution/verification rules. Configuration-only dependency remediation uses the already captured `npm audit` failure (#1007) as RED evidence; do not manufacture a runtime unit test for package-manager behavior.

**Goal:** Remove current high/critical npm audit findings caused by Prisma 7.10.0 transitive pins while preserving the existing Prisma/PostgreSQL lifecycle and making future high/critical findings a canonical CI failure.

**Architecture:** Keep the Prisma 7.10.0 runtime/tooling contract unchanged. Apply root npm overrides to the two vulnerable transitive packages, regenerate the npm 11.4.2 lockfile, and add a blocking audit gate to the existing single canonical verify workflow. Treat `deepmerge-ts` 7→8 as the compatibility risk; the full database lifecycle and Electron smoke suite is the acceptance boundary.

**Spec:** `docs/tasks/0-4-4-dependency-advisory-remediation.md`

**Base:** `main@efc38f448ba1b211928ab03341759e844aabd929`

**Branch:** `feat/0.4.4-dependency-advisory-remediation`

---

## Task 1: Open the documented remediation cycle

**Files:**
- Create: `docs/tasks/0-4-4-dependency-advisory-remediation.md`
- Create: `docs/superpowers/plans/2026-09-11-0-4-4-dependency-advisory-remediation.md`
- Modify: `docs/epics/0-4-docs-ops-ci.md`

1. Add task `0.4.4` as `in_progress`, recording RED #1007, exact remediation versions, rollback rule, acceptance commands, and override removal condition.
2. Reopen epic `0.4` as `in_progress` / `3/4 done` while its new child is active.
3. Do not claim docs freshness until `docs:ops:refresh` and `docs:ops:check` run on the changed tree.

## Task 2: Apply the minimal dependency remediation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

1. Add only these root overrides:
   - `deepmerge-ts: 8.0.1`
   - `mysql2: 3.23.1`
2. Keep Prisma/package versions otherwise unchanged.
3. Regenerate `package-lock.json` with npm `11.4.2`; do not hand-author dependency metadata.
4. Verify dependency resolution with `npm ls deepmerge-ts mysql2 prisma @prisma/client @prisma/adapter-pg`.
5. Run `npm audit --audit-level=high` and inspect `npm audit --json` severity counts. Required result: exit 0, high=0, critical=0.
6. If npm cannot resolve the override cleanly, or Prisma lifecycle later fails because of `deepmerge-ts@8`, revert the override rather than weakening verification.

## Task 3: Make the security threshold canonical

**Files:**
- Modify: `.github/workflows/verify.yml`

1. Add a named dependency-audit step after deterministic npm setup/install and before the broader suite:
   `npm audit --audit-level=high`
2. Keep the existing canonical workflow structure and all current gates; do not add a parallel weaker workflow.
3. Confirm the workflow still explicitly pins npm `11.4.2` before dependency installation.

## Task 4: Run compatibility and regression verification

**Commands / evidence:**

1. `npm ci`
2. `npm audit --audit-level=high`
3. `npm audit --json` (inspect high/critical counts)
4. `npm ls deepmerge-ts mysql2 prisma @prisma/client @prisma/adapter-pg`
5. `npm run prisma:generate`
6. `npm test` (must preserve at least the 471-test baseline)
7. `npm run typecheck`
8. `npm run lint`
9. `npm run format:check`
10. `bash scripts/verify-ci-failure-modes.sh`
11. `bash scripts/verify-postgres-compose.sh` (covers compose migrate/seed/reset and integration workers)
12. `npm run build`
13. Canonical GitHub Actions development launch smoke
14. Canonical GitHub Actions production launch smoke

A sandbox that cannot run Docker/Electron does not count as evidence for those checks; use the canonical GitHub Actions run and inspect its actual job/step result.

## Task 5: Close docs only after GREEN evidence

**Files:**
- Modify: `docs/tasks/0-4-4-dependency-advisory-remediation.md`
- Modify: `docs/epics/0-4-docs-ops-ci.md`
- Modify: generated `docs/operations/status/*.md` and parent rollups via `npm run docs:ops:refresh`

1. Record exact commit SHA/run number and observed audit/dependency versions in the task card.
2. Mark all acceptance criteria only when supported by fresh evidence.
3. Set task `0.4.4` to `done/aligned` and epic `0.4` back to `done/aligned` as `4/4 done`.
4. Run `npm run docs:ops:refresh` then `npm run docs:ops:check`.
5. Run the full canonical verify again on the final tree before creating/handing off the PR.
