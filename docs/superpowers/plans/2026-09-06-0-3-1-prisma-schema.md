# 0.3.1 Prisma Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Prisma 7 schema and first PostgreSQL migration for the six MVP-1 entities, then wire `prisma migrate deploy` into the existing infrastructure bootstrap so the worker still starts only after the database schema is ready.

**Architecture:** Prisma owns the relational schema and generated TypeScript model types; the renderer never imports it. The schema contains only `Monitor`, `MonitorCursor`, `Run`, `Listing`, `Match`, and `Setting`. Values whose domain vocabulary is not specified by the canonical docs remain minimally-assumptive scalar/JSON fields rather than inventing enums. The existing main-process bootstrap invokes a small migration runner after Docker/Postgres health succeeds and before the utility-process worker starts.

**Tech Stack:** Node 22, TypeScript strict, Electron, PostgreSQL 16, Prisma ORM 7.10.0, npm 11.4.2, Vitest, GitHub Actions.

**Spec:** `docs/tasks/0-3-1-prisma-schema.md`, `docs/superpowers/specs/data-model.md`, `docs/AGENTS.md`

## Global Constraints

- Keep PostgreSQL at the project-fixed major `16`; do not change the stack silently.
- Prisma schema for this slice contains exactly the six MVP-1 entities; do not add `SellerBlock`, `Favorite`, `PriceSnapshot`, `HealthEvent`, `SchemaSnapshot`, or `AdapterState`.
- `Listing.listId` is the primary key for now, explicitly as the pre-recon assumption documented by the source spec.
- `Monitor.state` is one enum with `active`, `paused`, `archived`.
- Price is `priceKind` plus nullable `priceAmount`; `PriceKind` is `fixed`, `negotiable`, `free`, `unknown`.
- `MonitorCursor` owns the watermark/runtime state; do not duplicate cursor fields on `Monitor`.
- Do not add hot-query indexes or the `(monitorId, listingId)` uniqueness constraint yet; those belong to `0.3.2`.
- TypeScript remains strict; no domain `any`; filenames stay kebab-case.
- No renderer access to Prisma and no new HTTP/Nitro layer.

---

### Task 1: Add Prisma 7 toolchain and configuration

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` via npm 11.4.2 only
- Create: `prisma.config.ts`
- Create: `prisma/schema.prisma`
- Create: `shared/db-types.ts`

**Interfaces:**
- Consumes: `DATABASE_URL` from development/runtime environment.
- Produces: generated client in `generated/prisma`, and shared model-type exports from `shared/db-types.ts`.

- [ ] **Step 1: Pin Prisma ORM 7.10.0 explicitly**

Add `prisma` and `@prisma/client` at `7.10.0`; do not use the moving `latest` tag because the npm `prisma` tag currently points at an 8.x release candidate while `@prisma/client` stable is 7.10.0.

- [ ] **Step 2: Configure Prisma v7**

Create `prisma.config.ts` with schema path `prisma/schema.prisma`, migrations path `prisma/migrations`, and datasource URL from `DATABASE_URL`.

- [ ] **Step 3: Define only the MVP-1 models**

Use local integer autoincrement identifiers for entities whose ID type is not specified by the canonical docs, keep `Listing.listId` as the platform string primary key, and encode only the documented enums (`MonitorState`, `PriceKind`). Use JSON/nullable scalar fields where the source docs do not define a closed vocabulary.

- [ ] **Step 4: Expose generated types through the shared layer**

`shared/db-types.ts` re-exports generated model and enum types so worker/main consumers do not duplicate domain interfaces.

- [ ] **Step 5: Verify schema generation**

Run `npx prisma validate` and `npx prisma generate`; expected: both exit 0 and generated model types compile under the existing TypeScript gate.

- [ ] **Step 6: Commit**

Commit the manifest/config/schema/type-export unit together after validation.

### Task 2: Generate and apply the first migration

**Files:**
- Create: `prisma/migrations/<timestamp>_init/migration.sql`
- Create/modify: `.github/workflows/verify.yml` integration step only as needed

**Interfaces:**
- Consumes: `prisma/schema.prisma` and the existing CI PostgreSQL 16 service/container.
- Produces: migration history deployable by `prisma migrate deploy`.

- [ ] **Step 1: Generate migration SQL from the schema**

Use Prisma 7.10.0 tooling, not hand-authored SQL: `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` into the first migration directory.

- [ ] **Step 2: Apply on a clean PostgreSQL 16 database**

Run `npx prisma migrate deploy` with CI `DATABASE_URL`; expected: exit 0 and `_prisma_migrations` contains the initial migration.

- [ ] **Step 3: Verify model shape against the canonical spec**

Check that the database contains exactly the six slice tables plus Prisma migration metadata and that the `Listing` price columns, `MonitorCursor` ownership, and monitor state enum match the source spec.

- [ ] **Step 4: Commit**

Commit generated migration and any narrowly-scoped CI verification change.

### Task 3: Wire Prisma migrations into the bootstrap with TDD

**Files:**
- Create: `tests/prisma-migrations.test.ts`
- Create: `electron/main/prisma-migrations.ts`
- Modify: `electron/main/index.ts`
- Reuse: `electron/main/infrastructure-bootstrap.ts`

**Interfaces:**
- Consumes: existing `InfrastructureBootstrapDependencies.applyMigrations(): Promise<void>`.
- Produces: `createPrismaMigrationRunner(...)`/equivalent small main-process function that executes `prisma migrate deploy` and rejects on non-zero exit.

- [ ] **Step 1: Write the failing test**

Test command construction/execution through an injected process runner: successful exit resolves; non-zero exit rejects with a clear migration error. The production module must not exist before this RED commit.

- [ ] **Step 2: Run test and verify RED**

Run the targeted Vitest file; expected failure is missing `electron/main/prisma-migrations.ts` or missing exported runner, not a syntax/configuration error.

- [ ] **Step 3: Implement the minimal migration runner**

Resolve the local Prisma CLI entry from the installed dependency, execute `migrate deploy` with inherited `DATABASE_URL`, collect stderr, and reject on non-zero exit. Do not invent retry/backoff logic; Prisma deploy locking already has its own failure semantics.

- [ ] **Step 4: Run targeted and full unit tests**

Expected: targeted migration-runner tests GREEN, then the full Vitest suite GREEN.

- [ ] **Step 5: Wire `index.ts` through the existing bootstrap**

Replace direct worker start at app-ready with the already-tested infrastructure bootstrap: Docker client/runtime → ensure PostgreSQL → wait health → Prisma migrate deploy → start worker. Preserve boot-state IPC publication and do not start the worker on migration failure.

- [ ] **Step 6: Commit**

Commit migration runner + bootstrap wiring after tests/typecheck/lint/format.

### Task 4: Full verification and task status

**Files:**
- Modify: `docs/tasks/0-3-1-prisma-schema.md`
- Refresh generated docs status through `docs:ops` only after all gates pass.

**Interfaces:** none beyond repository gates.

- [ ] **Step 1: Run full CI gates**

Required fresh evidence: `npm ci`, docs consistency, full Vitest suite, renderer/electron typecheck, ESLint, Prettier, Prisma validate/generate, clean PostgreSQL migration deploy, build, development Electron smoke, production Electron smoke.

- [ ] **Step 2: Re-read acceptance criteria**

Confirm migration applies to empty DB, schema matches all six documented entities, price uses kind+nullable amount, cursor state is separate, and generated types are reachable from shared code.

- [ ] **Step 3: Update task status only after evidence**

Set `0.3.1` to `done`/aligned only when every acceptance criterion is verified. Keep `0.2.2` in progress until its real migration hook and startup sequence are also covered by the same fresh verification.

## Self-review

- Spec coverage: all `0.3.1` acceptance criteria map to Tasks 1-4; `0.2.2` migration/start-order requirement maps to Task 3.
- Scope guard: future tables and `0.3.2` indexes/uniqueness are explicitly excluded.
- Unknown-domain guard: no undocumented seller/outcome/degradation enum values are invented.
- Platform guard: migration code stays in Electron main; renderer remains Prisma-free.
