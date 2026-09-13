import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDockerClient } from '../../electron/main/docker-client'
import { createDockerodePostgresRuntime } from '../../electron/main/dockerode-postgres-adapter'
import {
  ensurePostgresContainer,
  waitForPostgresHealthy,
  type PostgresContainerConfig,
} from '../../electron/main/docker-postgres'

const integration = process.env.KUFAR_DOCKERODE_INTEGRATION === '1' ? describe : describe.skip
const containerName = `kufar-watcher-dockerode-ci-${process.pid}`
const volumeName = `${containerName}-data`
const docker = createDockerClient()
const runtime = createDockerodePostgresRuntime(docker)

function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    typeof Reflect.get(error, 'statusCode') === 'number' &&
    Reflect.get(error, 'statusCode') === 404
  )
}

function postgresPort(): number {
  const raw = process.env.KUFAR_DOCKERODE_POSTGRES_PORT
  if (!raw) throw new Error('KUFAR_DOCKERODE_POSTGRES_PORT is required')

  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error('KUFAR_DOCKERODE_POSTGRES_PORT must be a valid TCP port')
  }
  return value
}

function config(): PostgresContainerConfig {
  return {
    image: 'postgres:16',
    containerName,
    volumeName,
    host: '127.0.0.1',
    port: postgresPort(),
    user: 'kufar_dockerode_ci',
    password: 'kufar-dockerode-ci-password',
    database: 'kufar_dockerode_ci',
  }
}

async function cleanup(): Promise<void> {
  try {
    await docker.getContainer(containerName).remove({ force: true, v: true })
  } catch (error) {
    if (!isNotFound(error)) throw error
  }

  try {
    await docker.getVolume(volumeName).remove()
  } catch (error) {
    if (!isNotFound(error)) throw error
  }
}

integration('Dockerode PostgreSQL runtime', () => {
  beforeEach(cleanup)
  afterEach(cleanup)

  it(
    'creates, starts, inspects, and health-checks PostgreSQL through the production runtime',
    async () => {
      const expected = config()

      await runtime.ping()
      await ensurePostgresContainer(runtime, expected)
      await waitForPostgresHealthy(runtime, expected.containerName, {
        timeoutMs: 60_000,
        pollIntervalMs: 1_000,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      })

      expect(await runtime.inspectHealth(expected.containerName)).toBe('healthy')
      expect(await runtime.inspectContainer(expected.containerName)).toEqual({
        running: true,
        image: expected.image,
        volumeName: expected.volumeName,
        host: expected.host,
        port: expected.port,
        user: expected.user,
        password: expected.password,
        database: expected.database,
      })
    },
    90_000,
  )
})
