# Phase 0 Dockerode CI Remediation Design

## Goal

Close the Phase 0 audit gap by executing the existing production Dockerode PostgreSQL runtime against a real Docker daemon in CI. The remediation is coverage-first: production code changes are permitted only if the live integration test proves the current runtime is wrong.

## Scope

The test must use the same composition points as Electron main:

- `createDockerClient()` to connect to Docker via the platform socket;
- `createDockerodePostgresRuntime()` to adapt Dockerode to `DockerPostgresRuntime`;
- `ensurePostgresContainer()` and `waitForPostgresHealthy()` for lifecycle semantics.

The test uses an isolated container name, volume name, credentials, database name, and host port so it does not collide with the compose-based integration environment.

## Assertions

On a GitHub-hosted Linux runner with a real Docker daemon, the test must prove that:

1. Docker ping succeeds through `createDockerClient()`.
2. A missing `postgres:16` test container can be created through `createDockerodePostgresRuntime()`.
3. The created container starts and becomes healthy through `waitForPostgresHealthy()`.
4. `inspectContainer()` reports the configured image, volume, host, port, user, password, and database.
5. The runtime reports the container as running.
6. Test cleanup removes both the container and its dedicated named volume even if an assertion fails.

## CI integration

Add a dedicated `Dockerode runtime integration` step in `.github/workflows/verify.yml`. It runs separately from `scripts/verify-postgres-compose.sh` so a failure identifies the Dockerode boundary rather than the compose/Postgres suite.

The integration test is opt-in through `KUFAR_DOCKERODE_INTEGRATION=1`; normal `npm test` runs keep it skipped.

## Non-goals

- Do not replace the compose integration suite.
- Do not change PostgreSQL bootstrap behavior unless the live test proves a defect.
- Do not test Docker Desktop GUI behavior or Windows named-pipe access in Linux CI.
- Do not add retry/recovery UX; that is a separate audit remediation.
