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

  it('creates, validates, reuses, and health-checks an isolated PostgreSQL container', async () => {
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
  }, 120_000)
})
