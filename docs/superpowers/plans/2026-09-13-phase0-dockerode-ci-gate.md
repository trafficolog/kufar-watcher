# Phase 0 Dockerode CI Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live CI integration gate that proves the production Dockerode PostgreSQL bootstrap path works against a real Docker daemon.

**Architecture:** Keep production code unchanged unless the live integration exposes a real defect. Add one environment-gated Vitest integration test using `createDockerClient()`, `createDockerodePostgresRuntime()`, `ensurePostgresContainer()`, and `waitForPostgresHealthy()`, then wire that single test into a dedicated step in the existing verify workflow.

**Tech Stack:** Node.js 22, TypeScript, Vitest 5, Dockerode 5.0.1, PostgreSQL 16, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-13-phase0-dockerode-ci-gate-design.md`

## Global Constraints

- Test the production Dockerode path before changing production code.
- Ordinary `npm test` must skip the live Docker integration unless `KUFAR_DOCKERODE_INTEGRATION=1`.
- Use `postgres:16`, loopback-only binding, isolated test names, and a non-default host port.
- Behavioral assertions must use the production runtime/Dockerode, not Docker CLI parsing.
- Container and named volume cleanup must run even when assertions fail.
- If the existing runtime passes, do not modify production runtime code.

---

### Task 1: Add and wire the live Dockerode integration gate

**Files:**
- Create: `tests/integration/dockerode-postgres-runtime.test.ts`
- Modify: `.github/workflows/verify.yml`
- Modify only on proven live failure: `electron/main/dockerode-postgres-adapter.ts` and/or `electron/main/docker-postgres.ts`

**Interfaces:**
- Consumes: `createDockerClient(): Docker`, `createDockerodePostgresRuntime(docker): DockerPostgresRuntime`, `ensurePostgresContainer(runtime, config): Promise<void>`, `waitForPostgresHealthy(runtime, containerName, options): Promise<void>`.
- Produces: CI coverage only; no new production API.

- [ ] **Step 1: Add the environment-gated live integration test**

Create `tests/integration/dockerode-postgres-runtime.test.ts` with this structure:

```ts
import { afterAll, describe, expect, it } from 'vitest'

import { createDockerClient } from '../../electron/main/docker-client'
import { createDockerodePostgresRuntime } from '../../electron/main/dockerode-postgres-adapter'
import {
  ensurePostgresContainer,
  waitForPostgresHealthy,
  type PostgresContainerConfig,
} from '../../electron/main/docker-postgres'

const integrationDescribe =
  process.env.KUFAR_DOCKERODE_INTEGRATION === '1' ? describe : describe.skip

const docker = createDockerClient()
const runtime = createDockerodePostgresRuntime(docker)
const suffix = process.env.GITHUB_RUN_ID ?? String(process.pid)
const containerName = `kufar-watcher-dockerode-it-${suffix}`
const volumeName = `${containerName}-data`

const config: PostgresContainerConfig = {
  image: 'postgres:16',
  containerName,
  volumeName,
  host: '127.0.0.1',
  port: 55432,
  user: 'kufar_dockerode_it',
  password: 'kufar-dockerode-it-password',
  database: 'kufar_dockerode_it',
}

function isDockerNotFound(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, 'statusCode') === 404
}

async function cleanup(): Promise<void> {
  try {
    await docker.getContainer(containerName).remove({ force: true })
  } catch (error) {
    if (!isDockerNotFound(error)) throw error
  }

  try {
    await docker.getVolume(volumeName).remove()
  } catch (error) {
    if (!isDockerNotFound(error)) throw error
  }
}

integrationDescribe('production Dockerode PostgreSQL runtime', () => {
  afterAll(async () => {
    await cleanup()
  })

  it(
    'creates, validates, reuses, and health-checks an isolated PostgreSQL container',
    async () => {
      await cleanup()
      await runtime.ping()
      await ensurePostgresContainer(runtime, config)
      await waitForPostgresHealthy(runtime, containerName, {
        timeoutMs: 60_000,
        pollIntervalMs: 1_000,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      })

      await expect(runtime.inspectHealth(containerName)).resolves.toBe('healthy')
      await expect(runtime.inspectContainer(containerName)).resolves.toEqual({
        running: true,
        image: config.image,
        volumeName: config.volumeName,
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
      })

      await ensurePostgresContainer(runtime, config)
      await expect(runtime.inspectContainer(containerName)).resolves.toMatchObject({
        running: true,
        image: config.image,
        volumeName: config.volumeName,
      })
    },
    120_000,
  )
})
```

If Dockerode's TypeScript declarations require a slightly different cleanup option shape, keep the semantics above and use the current Dockerode 5.0.1 type definitions rather than weakening cleanup.

- [ ] **Step 2: Run the new test against the real Docker daemon before changing production code**

Run in CI/runner context:

```bash
KUFAR_DOCKERODE_INTEGRATION=1 npx vitest run tests/integration/dockerode-postgres-runtime.test.ts
```

Expected for coverage-only remediation: PASS on the existing production runtime. If it fails, preserve the failing output as RED evidence and identify whether the defect is in image availability, container creation/inspection normalization, start/idempotency, or health polling before touching production code.

- [ ] **Step 3: Only if Step 2 proves a production defect, implement the smallest fix**

Change only the production function directly implicated by the RED failure. Re-run the exact command from Step 2 until it passes. Do not refactor unrelated Docker bootstrap code.

- [ ] **Step 4: Add a dedicated CI step**

In `.github/workflows/verify.yml`, after `Unit tests` and before `Postgres compose integration`, add:

```yaml
      - name: Dockerode production-path integration
        env:
          KUFAR_DOCKERODE_INTEGRATION: '1'
        run: npx vitest run tests/integration/dockerode-postgres-runtime.test.ts
```

Keep the existing compose integration unchanged so Dockerode failures and compose/database failures remain distinguishable.

- [ ] **Step 5: Verify hermetic unit behavior and repository checks**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
```

Expected: all pass; the live Dockerode suite is skipped during plain `npm test`.

- [ ] **Step 6: Verify the exact branch HEAD in GitHub Actions**

Push the branch and require the `verify` workflow for the exact HEAD SHA to complete successfully, including `Dockerode production-path integration`, `Postgres compose integration`, build, and both launch smokes.

- [ ] **Step 7: Review and commit hygiene**

Confirm the diff contains only the approved spec/plan, the new integration test, the CI wiring, and any production change that was strictly required by a witnessed RED failure. No temporary probe workflows, containers, or generated files belong in the branch.
