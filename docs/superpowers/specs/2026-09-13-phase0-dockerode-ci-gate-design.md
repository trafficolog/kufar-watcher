# Phase 0 Dockerode CI Gate Design

## Goal

Close the Phase 0 audit gap by exercising the real production Dockerode bootstrap path against a live Docker daemon in CI, without changing production behavior unless the live integration proves a defect.

## Scope

The gate must use the same production factories and orchestration used by the Electron main process:

- `createDockerClient()` for the Docker socket connection;
- `createDockerodePostgresRuntime()` for Dockerode-to-domain adaptation;
- `ensurePostgresContainer()` for create/start/idempotency semantics;
- `waitForPostgresHealthy()` for health polling.

The test runs only when `KUFAR_DOCKERODE_INTEGRATION=1`; ordinary `npm test` remains hermetic and skips the live Docker test.

## Live test contract

The integration test creates an isolated PostgreSQL 16 container and named volume using test-only names and a host port that does not collide with the existing compose integration. It must:

1. ping the real Docker daemon through the production client;
2. ensure the PostgreSQL image/container through the production runtime;
3. wait for Docker health to become `healthy`;
4. inspect the container through the production runtime and assert the exact image, volume, loopback host, host port, user, password, database, and running state;
5. call `ensurePostgresContainer()` again and verify the existing running container remains valid, covering the idempotent path;
6. clean up the container and named volume through Dockerode in `afterAll`, tolerating Docker `404` for cleanup idempotency.

The test must not depend on Docker CLI output for its behavioral assertions. Dockerode's promise API is the source of truth for setup, inspection, and cleanup.

## CI placement

Add a dedicated `Dockerode production-path integration` step to `.github/workflows/verify.yml` after unit tests and before the existing compose-backed PostgreSQL integration. The dedicated step runs only this integration test with `KUFAR_DOCKERODE_INTEGRATION=1`, so failures identify the Dockerode layer separately from compose/database schema failures.

## Failure policy

This is coverage-first remediation. The existing runtime is tested before production code is changed. If the live gate passes, no production runtime changes are allowed. If it fails because production behavior is wrong, the failure becomes the RED proof for the smallest possible production fix, followed by the full verification suite.

## Safety and cleanup

- Use `postgres:16`, matching `readPostgresRuntimeConfig()`.
- Bind PostgreSQL only to `127.0.0.1`.
- Use test-only credentials and names; do not reuse the application's production container/volume names.
- Use a non-default host port so the later compose integration can continue using its existing port.
- Always attempt cleanup after the test, even when assertions fail.
- Do not persist database state or test credentials outside the ephemeral GitHub-hosted runner.

## Out of scope

- changing Docker Desktop detection or platform socket rules;
- changing PostgreSQL configuration defaults;
- changing compose integration tests;
- adding Docker daemon retry policy;
- refactoring the existing Dockerode adapter without a live failing test.
