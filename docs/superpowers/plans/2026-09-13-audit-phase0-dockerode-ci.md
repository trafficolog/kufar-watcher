# Phase 0 Dockerode CI Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the production Dockerode PostgreSQL runtime against a real Docker daemon in CI and close the Phase 0 audit coverage gap without changing production behavior unless the live test proves a defect.

**Architecture:** Add one opt-in integration test that composes `createDockerClient()`, `createDockerodePostgresRuntime()`, `ensurePostgresContainer()`, and `waitForPostgresHealthy()` against an isolated Postgres container and named volume. Add a dedicated CI step before the existing compose integration so Dockerode failures are independently diagnosable.

**Tech Stack:** Node 22, Vitest, Dockerode, Docker Engine on GitHub-hosted Ubuntu, PostgreSQL 16, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-13-audit-phase0-dockerode-ci-design.md`

## Global Constraints

- Production code must not change unless the live Dockerode integration test demonstrates a concrete defect.
- The test must use production `createDockerClient()` and `createDockerodePostgresRuntime()`.
- The test must use isolated container/volume/port/credentials and always clean them up.
- The existing compose integration suite remains unchanged except for ordering around the new independent gate.
- Normal `npm test` must not require Docker.

---

### Task 1: Real Dockerode PostgreSQL integration gate

**Files:**
- Create: `tests/integration/dockerode-postgres-runtime.test.ts`
- Modify: `.github/workflows/verify.yml`

**Interfaces:**
- Consumes: `createDockerClient(): Docker`, `createDockerodePostgresRuntime(docker): DockerPostgresRuntime`, `ensurePostgresContainer(runtime, config): Promise<void>`, `waitForPostgresHealthy(runtime, name, options): Promise<void>`.
- Produces: opt-in Vitest integration suite activated by `KUFAR_DOCKERODE_INTEGRATION=1` and a dedicated GitHub Actions verification step.

- [ ] **Step 1: Add the integration test before any production change**

Create `tests/integration/dockerode-postgres-runtime.test.ts`. Gate the suite with `KUFAR_DOCKERODE_INTEGRATION=1`. Use a unique container name such as `kufar-watcher-dockerode-ci-${process.pid}`, a matching named volume, `postgres:16`, host `127.0.0.1`, an isolated high host port supplied by `KUFAR_DOCKERODE_POSTGRES_PORT`, and dedicated test credentials. Instantiate the real Docker client and production runtime. In the test, call `runtime.ping()`, `ensurePostgresContainer(...)`, `waitForPostgresHealthy(...)`, then assert `inspectContainer()` returns the configured image, volume, host, port, user, password, database and `running: true`. In `afterEach`, force-remove the container and remove the named volume, ignoring Docker 404 responses only.

- [ ] **Step 2: Add the dedicated CI step**

Modify `.github/workflows/verify.yml` to run:

```yaml
- name: Dockerode runtime integration
  env:
    KUFAR_DOCKERODE_INTEGRATION: '1'
    KUFAR_DOCKERODE_POSTGRES_PORT: '55432'
  run: npx vitest run tests/integration/dockerode-postgres-runtime.test.ts
```

Place it before `Postgres compose integration` so the runtime boundary is independently visible.

- [ ] **Step 3: Run the feature-branch workflow and inspect the result**

Expected coverage-first outcome: the new Dockerode integration passes with no production changes. If it fails, capture the exact runtime defect and only then add a failing regression assertion plus the minimal production fix.

- [ ] **Step 4: Verify the complete branch**

Run the repository `verify` workflow on the exact branch HEAD. Require docs consistency, unit tests, typecheck, lint, formatting, Dockerode integration, compose/Postgres integration, build, and both Electron launch smokes to pass.

- [ ] **Step 5: Review and merge**

Open a PR to `main`, review the diff for cleanup reliability and accidental production changes, confirm PR CI is GREEN on the exact head, then merge using the expected head SHA.
