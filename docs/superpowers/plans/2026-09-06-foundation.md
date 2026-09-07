# Foundation `0.1.0` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the Foundation slice: Electron/Nuxt shell, three-process boundary, typed IPC, automatically supervised local PostgreSQL 16, MVP Prisma schema/seeds, boot status UI, docs-ops and green CI.

**Architecture:** `main` owns window/lifecycle/Docker bootstrap, `utilityProcess` owns future background execution, and Nuxt renderer talks to main only through an explicit typed preload bridge. PostgreSQL is a single local Docker container and Prisma is the only DB access layer. CI is the executable acceptance gate; live Kufar traffic is never used.

**Tech Stack:** Electron 44, Nuxt 4/Vue 3/Pinia, electron-vite 5, TypeScript 6.0.2, Vitest 5, Dockerode, PostgreSQL 16, Prisma, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-06-foundation-design.md`

## Global Constraints

- Follow `docs/AGENTS.md`, `docs/ROADMAP.MD`, task cards `0.1.1`–`0.4.2`, `ui-architecture.md`, `ui-states.md`, `data-model.md`, `TESTING.md` and security docs.
- Foundation includes `0.3.1`–`0.3.3`; `0.3.4`–`0.3.6` remain deferred.
- `contextIsolation: true`, `nodeIntegration: false`, renderer sandboxed; never expose raw `ipcRenderer`.
- Nuxt remains `ssr:false`; no Nitro/internal HTTP API.
- Production renderer uses the existing standard custom scheme and SPA fallback, never `file://`.
- No native node-gyp dependencies.
- No automated test talks to kufar.by.
- Domain/cross-process code uses strict TypeScript and no `any`.
- Keep the implementation small enough for one user, one machine and roughly five monitors.

---

### Task 1: Stabilize the repository/toolchain (`0.1.1`)

**Files:**

- Modify: `package.json`
- Modify: `.github/workflows/verify.yml`
- Create: `package-lock.json`
- Modify as required by Prettier diagnostics: exact files reported by CI
- Verify: `tests/app-protocol.test.ts`

**Interfaces:**

- Produces: deterministic Node/npm dependency installation and a renderer/main build that later tasks depend on.

- [ ] **Step 1: Reproduce the current CI failure and preserve evidence.**

Run in CI:

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

Expected: each barrier is observed independently; diagnostics are uploaded when a preceding quality gate fails.

- [ ] **Step 2: Apply only upstream-confirmed compatibility fixes.**

Keep:

```json
{
  "packageManager": "npm@11.6.0",
  "devDependencies": {
    "typescript": "6.0.2",
    "vue-tsc": "3.3.11"
  }
}
```

The TypeScript pin exists because vue-tsc 3.3.x is incompatible with TypeScript 7.0.2.

- [ ] **Step 3: Commit the lockfile produced by npm 11.6.0.**

After a CI install succeeds, download the `package-lock` artifact and commit it unchanged. Switch steady-state CI install to:

```bash
npm ci
```

- [ ] **Step 4: Fix every Prettier-reported file rather than weakening the check.**

Run:

```bash
npm run format
npm run format:check
```

Expected: second command exits 0 with no changed files.

- [ ] **Step 5: Verify build and dev/prod smoke.**

Required outputs:

```text
.output/public/index.html
out/main/index.cjs
out/preload/index.cjs
```

CI launches both dev and production under Xvfb with bounded timeouts. Production must remain alive until timeout and not require a dev server.

- [ ] **Step 6: Commit.**

```bash
git add package.json package-lock.json .github/workflows/verify.yml .
git commit -m "fix(0.1.1): stabilize toolchain verification"
```

### Task 2: Import canonical planning/docs tooling (`0.4.1` prerequisite)

**Files:**

- Create/replace: `docs/**` from the supplied v3.2 archive
- Create: `src/docs-ops/cli.ts`
- Modify: `package.json`

**Interfaces:**

- Produces npm scripts `docs:ops:refresh`, `docs:ops:check`, `docs:ops:new-session`, `docs:ops:new-iteration`.

- [ ] **Step 1: Import the archive documentation verbatim.**

Do not rewrite generated blocks manually. The archive is the source for planning terminology and task requirements.

- [ ] **Step 2: Restore docs-ops scripts.**

```json
{
  "scripts": {
    "docs:ops:refresh": "tsx src/docs-ops/cli.ts refresh",
    "docs:ops:check": "tsx src/docs-ops/cli.ts check",
    "docs:ops:new-session": "tsx src/docs-ops/cli.ts new-session",
    "docs:ops:new-iteration": "tsx src/docs-ops/cli.ts new-iteration"
  },
  "devDependencies": {
    "tsx": "^4"
  }
}
```

- [ ] **Step 3: Run refresh and check.**

```bash
npm run docs:ops:refresh
npm run docs:ops:check
```

Expected: generated phase/epic blocks and `docs/operations/status/**` agree with task frontmatter.

- [ ] **Step 4: Commit.**

```bash
git add docs src/docs-ops package.json package-lock.json
git commit -m "docs(0.4.1): restore canonical planning tree"
```

### Task 3: Implement worker lifecycle (`0.1.2`) with TDD

**Files:**

- Create: `shared/runtime.ts`
- Create: `electron/main/worker-supervisor.ts`
- Create: `electron/worker/index.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron.vite.config.ts`
- Create: `tests/worker-supervisor.test.ts`

**Interfaces:**

- Produces:

```ts
export type WorkerControlMessage = { type: 'shutdown' }
export type WorkerEvent =
  | { type: 'ready' }
  | { type: 'shutdown-complete' }
  | { type: 'journal'; level: 'info' | 'warning' | 'error'; message: string }

export interface WorkerProcessHandle {
  postMessage(message: WorkerControlMessage): void
  kill(): void
}
```

- [ ] **Step 1: RED — restart limit.**

```ts
it('enters fatal state after the fourth consecutive unexpected exit', () => {
  const policy = createRestartPolicy(3)
  expect(policy.recordCrash()).toBe('restart')
  expect(policy.recordCrash()).toBe('restart')
  expect(policy.recordCrash()).toBe('restart')
  expect(policy.recordCrash()).toBe('fatal')
})
```

Run:

```bash
npm test -- tests/worker-supervisor.test.ts
```

Expected: FAIL because the policy does not exist.

- [ ] **Step 2: GREEN — implement the minimal restart policy.**

```ts
export function createRestartPolicy(maxRestarts: number) {
  let crashes = 0
  return {
    recordCrash(): 'restart' | 'fatal' {
      crashes += 1
      return crashes <= maxRestarts ? 'restart' : 'fatal'
    },
    reset(): void {
      crashes = 0
    },
  }
}
```

- [ ] **Step 3: RED — graceful shutdown handshake.**

Test that `requestShutdown()` sends exactly `{ type: 'shutdown' }` and resolves only after `shutdown-complete` or the bounded shutdown timeout.

- [ ] **Step 4: GREEN — wrap Electron `utilityProcess.fork`.**

The real adapter owns Electron listeners; the policy remains pure. `main` starts the worker only when bootstrap reaches scheduler start.

- [ ] **Step 5: Add worker entrypoint.**

The worker publishes `ready`, handles `shutdown`, completes the current placeholder operation boundary, sends `shutdown-complete`, then exits cleanly. No monitoring jobs are added.

- [ ] **Step 6: Manual contract note.**

Document that closing only the window does not call worker shutdown; explicit application quit does.

- [ ] **Step 7: Commit.**

```bash
git add shared electron tests
git commit -m "feat(0.1.2): add utility process lifecycle"
```

### Task 4: Implement typed renderer/main/worker IPC (`0.1.3`) with TDD

**Files:**

- Create: `shared/ipc.ts`
- Create: `electron/main/ipc-router.ts`
- Modify: `electron/preload/index.ts`
- Modify: `electron/main/index.ts`
- Create: `app/types/kufar.d.ts`
- Create: `app/composables/use-desktop-api.ts`
- Create: `tests/ipc-router.test.ts`

**Interfaces:**

```ts
export type BootStepId = 'docker' | 'database' | 'migrations' | 'scheduler' | 'telegram'
export type BootStepState = 'pending' | 'running' | 'success' | 'skipped' | 'degraded' | 'error'

export interface BootStep {
  id: BootStepId
  state: BootStepState
  detail: string
}

export interface BootState {
  phase: 'starting' | 'ready' | 'error'
  steps: BootStep[]
  errorCode?: 'docker-unavailable' | 'database-timeout' | 'migration-failed' | 'worker-failed'
}

export interface KufarDesktopApi {
  system: {
    getBootState(): Promise<BootState>
    retryBoot(): Promise<void>
    openJournal(): Promise<void>
    exit(): Promise<void>
    onBootState(listener: (state: BootState) => void): () => void
  }
}
```

- [ ] **Step 1: RED — routing preserves typed payload.**

Test a boot event traveling worker/main routing boundary and arriving at the renderer event sink unchanged.

- [ ] **Step 2: GREEN — explicit channel map.**

Use fixed constants only:

```ts
export const IPC = {
  bootGet: 'system:boot:get',
  bootRetry: 'system:boot:retry',
  bootEvent: 'system:boot:event',
  journalOpen: 'system:journal:open',
  appExit: 'system:app:exit',
} as const
```

- [ ] **Step 3: RED — invalid renderer sender is rejected.**

Test the pure sender guard against a non-application URL.

- [ ] **Step 4: GREEN — validate every renderer-originated handler.**

Handlers reject untrusted frames before calling services.

- [ ] **Step 5: Expose only the product API through contextBridge.**

Never expose `ipcRenderer`. Event subscription returns an unsubscribe closure.

- [ ] **Step 6: Commit.**

```bash
git add shared electron app/types app/composables tests
git commit -m "feat(0.1.3): add typed desktop IPC bridge"
```

### Task 5: Define PostgreSQL 16 container contract (`0.2.1`)

**Files:**

- Create: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `.gitignore`

**Interfaces:**

- Produces environment keys `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`, `DATABASE_URL`.

- [ ] **Step 1: Write compose configuration.**

The service must use `postgres:16`, bind `${POSTGRES_PORT:-5432}` to `127.0.0.1`, mount a named volume, and use:

```yaml
healthcheck:
  test: ['CMD-SHELL', 'pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}']
  interval: 2s
  timeout: 3s
  retries: 15
```

- [ ] **Step 2: Verify no real password is committed.**

`.env.example` contains an obvious development placeholder only; `.env` stays ignored.

- [ ] **Step 3: CI/manual verification.**

CI verifies the Compose file parses when Docker is available. Manual acceptance verifies persistence across `docker compose down`/`up` and loopback-only exposure.

- [ ] **Step 4: Commit.**

```bash
git add docker-compose.yml .env.example .gitignore
git commit -m "feat(0.2.1): define local Postgres container"
```

### Task 6: Implement MVP Prisma schema and integrity (`0.3.1`, `0.3.2`) with migration tests

**Files:**

- Create: `prisma/schema.prisma`
- Create: `prisma/migrations/0001_mvp_schema/migration.sql`
- Create: `prisma/migrations/0002_integrity_indexes/migration.sql`
- Create: `shared/db.ts`
- Create: `tests/integration/schema.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces Prisma client types for `Monitor`, `MonitorCursor`, `Run`, `Listing`, `Match`, `Setting` only.

- [ ] **Step 1: RED — clean database migration test.**

The integration test resets the test schema/database, runs `prisma migrate deploy`, and asserts all six expected tables exist.

- [ ] **Step 2: GREEN — create schema and first migration.**

Model fields copy `data-model.md` literally. `Listing.listId` is the primary key. `priceKind` is an enum and `priceAmount` nullable. Cursor fields belong only to `MonitorCursor`.

- [ ] **Step 3: RED — duplicate match is rejected and monitor deletion does not orphan runtime rows.**

Create one monitor/listing/match, assert a duplicate `(monitorId, listingId)` insert rejects, then delete the monitor and assert dependent `MonitorCursor`, `Run` and `Match` rows are gone.

- [ ] **Step 4: GREEN — add integrity migration.**

Add the unique pair and required hot indexes:

```text
Match(monitorId, notifiedAt)
Listing(listTime DESC)
Run(monitorId, startedAt DESC)
```

Do not create indexes for deferred Favorite/PriceSnapshot tables.

- [ ] **Step 5: Generate client and expose it from one shared module.**

`shared/db.ts` exports the generated client constructor/type boundary; renderer never imports it.

- [ ] **Step 6: Commit.**

```bash
git add prisma shared/db.ts tests/integration package.json package-lock.json
git commit -m "feat(0.3.1): add MVP Prisma schema and integrity"
```

### Task 7: Add deterministic seeds and isolated DB helper (`0.3.3`) with TDD

**Files:**

- Create: `prisma/seed.ts`
- Create: `tests/helpers/database.ts`
- Create: `tests/integration/seed.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces `resetTestDatabase()` for integration tests and npm scripts `db:seed`, `db:reset`.

- [ ] **Step 1: RED — idempotent seed test.**

Run the seed function twice and assert exactly two synthetic monitors exist after both runs.

- [ ] **Step 2: GREEN — deterministic upserts.**

Use stable IDs/names and synthetic listing values such as `fixture-listing-001`; never embed real Kufar responses.

- [ ] **Step 3: Record the card/spec conflict.**

Do not create Favorite/PriceSnapshot rows in Foundation because those tables are explicitly deferred to `0.3.5`. Add a note to task `0.3.3` status explaining this acceptance item is blocked by its own roadmap constraints rather than smuggling deferred schema into Foundation.

- [ ] **Step 4: Add scripts.**

```json
{
  "scripts": {
    "db:seed": "tsx prisma/seed.ts",
    "db:reset": "prisma migrate reset --force --skip-seed"
  }
}
```

- [ ] **Step 5: Commit.**

```bash
git add prisma/seed.ts tests/helpers tests/integration/seed.test.ts package.json package-lock.json docs/tasks/0-3-3-seeds.md
git commit -m "feat(0.3.3): add deterministic database fixtures"
```

### Task 8: Implement Dockerode startup supervisor (`0.2.2`) with TDD

**Files:**

- Create: `electron/main/docker-client.ts`
- Create: `electron/main/database-bootstrap.ts`
- Create: `electron/main/boot-service.ts`
- Modify: `electron/main/index.ts`
- Create: `tests/database-bootstrap.test.ts`
- Modify: `package.json`

**Interfaces:**

```ts
export interface DockerRuntime {
  ping(): Promise<void>
  ensureDatabaseContainer(): Promise<'created' | 'started' | 'running'>
  waitUntilHealthy(timeoutMs: number): Promise<void>
}

export interface MigrationRunner {
  deploy(): Promise<void>
}
```

- [ ] **Step 1: RED — boot ordering.**

Test that worker start is not called before `ping → ensure container → wait healthy → migrations` all resolve.

- [ ] **Step 2: RED — daemon failure surfaces `docker-unavailable`.**

Test that a ping error returns fatal BootState with platform-neutral code rather than throwing out of the service.

- [ ] **Step 3: RED — health timeout terminates.**

Use a fake clock/runtime and assert the service returns `database-timeout`; it must not hang indefinitely.

- [ ] **Step 4: GREEN — Dockerode adapter.**

Use `DOCKER_HOST` when explicitly configured for development/tests; otherwise Windows uses `//./pipe/docker_engine` and Linux uses `/var/run/docker.sock`. Create one deterministic container and named volume only when absent.

- [ ] **Step 5: GREEN — migration runner.**

Invoke Prisma migration deployment as a child process with explicit executable/path and captured stderr. A non-zero exit becomes `migration-failed`.

- [ ] **Step 6: Publish every boot transition through the typed IPC state store.**

The state order is Docker → database → migrations → scheduler → Telegram skipped.

- [ ] **Step 7: Commit.**

```bash
git add electron/main tests package.json package-lock.json
git commit -m "feat(0.2.2): supervise local database startup"
```

### Task 9: Implement infrastructure boot overlay (`0.2.3`) with component tests where practical

**Files:**

- Create: `app/components/app/AppBootScreen.vue`
- Create: `app/stores/boot.ts`
- Modify: `app/app.vue`
- Modify: `app/assets/css/main.css`
- Create: `tests/boot-state.test.ts`

**Interfaces:**

- Consumes `KufarDesktopApi.system` and `BootState` from Task 4.

- [ ] **Step 1: RED — derive severity and platform guidance from state.**

Test pure helpers:

```ts
expect(getBootOutcome(stateWithTelegramSkipped)).toBe('ready')
expect(getDockerHelp('win32')).toContain('Docker Desktop')
expect(getDockerHelp('linux')).toContain('службу Docker')
```

- [ ] **Step 2: GREEN — boot Pinia store.**

On renderer start it loads current state once and subscribes to boot events. Retry calls `system.retryBoot()` without reloading Electron.

- [ ] **Step 3: Build `AppBootScreen.vue` from the prototype semantics.**

Render all five steps and their outcomes. Fatal state shows exactly: `Повторить`, `Открыть журнал`, `Выйти`. Missing Telegram is shown as skipped and does not block ready state.

- [ ] **Step 4: Avoid fast-success flicker.**

Keep the overlay mounted for a short minimum visible interval once it has actually been shown; do not delay application bootstrap itself.

- [ ] **Step 5: Commit.**

```bash
git add app tests/boot-state.test.ts
git commit -m "feat(0.2.3): add infrastructure boot status overlay"
```

### Task 10: Finalize docs-ops and CI (`0.4.1`, `0.4.2`)

**Files:**

- Modify: `.github/workflows/verify.yml`
- Modify: `package.json`
- Modify through docs-ops only: `docs/operations/status/**`, generated phase/epic blocks
- Modify task frontmatter for completed Foundation tasks
- Create: `tests/docs-ops-invalid-frontmatter.test.ts` if docs-ops is importable; otherwise add a dedicated CI shell negative test using a temporary copy.

**Interfaces:**

- Produces one deterministic verification workflow for every future task.

- [ ] **Step 1: Replace diagnostic install with deterministic install.**

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
    cache: npm
- run: npm install --global npm@11.6.0
- run: npm ci
```

- [ ] **Step 2: Add PostgreSQL 16 service.**

Expose only to the runner, wait on `pg_isready`, and provide `DATABASE_URL` to integration tests.

- [ ] **Step 3: Run required gates in CI.**

```bash
npm run prisma:generate
npm test
npm run test:integration
npm run typecheck
npm run lint
npm run format:check
npm run docs:ops:check
npm run build
```

- [ ] **Step 4: Prove docs-ops rejects broken frontmatter.**

Copy one task card into a temporary workspace, remove a required frontmatter delimiter/key, run docs-ops check against that temporary tree and assert non-zero status. Do not corrupt repository files in-place.

- [ ] **Step 5: Refresh generated docs and align task statuses only after acceptance evidence exists.**

Tasks eligible for `done/aligned`: `0.1.1`, `0.1.2`, `0.1.3`, `0.2.1`, `0.2.2`, `0.2.3`, `0.3.1`, `0.3.2`, `0.4.1`, `0.4.2`. Task `0.3.3` is marked according to the explicit seed conflict described in Task 7; do not falsely claim Favorite history exists before `0.3.5`.

- [ ] **Step 6: Run final verification.**

```bash
npm ci
npm run docs:ops:check
npm test
npm run test:integration
npm run typecheck
npm run lint
npm run format:check
npm run build
```

Expected: all commands exit 0 and the latest GitHub Actions run is green.

- [ ] **Step 7: Commit.**

```bash
git add .github package.json package-lock.json docs
git commit -m "ci(0.4.2): complete Foundation verification"
```

## Self-review

- Spec coverage: every Foundation task from the roadmap has an implementation/verification step; deferred `0.3.4`–`0.3.6` are intentionally excluded.
- Placeholder scan: there are no TODO/TBD implementation steps; manual-only acceptance is named explicitly instead of being silently claimed.
- Type consistency: boot/worker/IPC types are defined once in `shared/` and consumed by preload, main and renderer.
- Scope control: no monitor business logic, Kufar adapter, Telegram implementation, tray, installer, Favorite schema or health schema is introduced.
