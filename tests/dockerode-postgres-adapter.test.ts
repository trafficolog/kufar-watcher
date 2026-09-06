import { describe, expect, it, vi } from 'vitest'
import { createDockerodePostgresRuntime } from '../electron/main/dockerode-postgres-adapter'
import type { PostgresContainerConfig } from '../electron/main/docker-postgres'

const config: PostgresContainerConfig = {
  image: 'postgres:16',
  containerName: 'kufar-watcher-postgres',
  volumeName: 'kufar-watcher-postgres-data',
  host: '127.0.0.1',
  port: 5432,
  user: 'kufar',
  password: 'generated-secret',
  database: 'kufar',
}

function notFound(): Error & { statusCode: number } {
  return Object.assign(new Error('not found'), { statusCode: 404 })
}

describe('createDockerodePostgresRuntime', () => {
  it('maps a missing container to null and preserves a running state', async () => {
    const inspect = vi.fn().mockRejectedValueOnce(notFound()).mockResolvedValue({
      State: { Running: true, Health: { Status: 'healthy' } },
    })
    const docker = {
      ping: vi.fn(async () => 'OK'),
      getContainer: vi.fn(() => ({ inspect, start: vi.fn() })),
      getImage: vi.fn(),
      createVolume: vi.fn(),
      createContainer: vi.fn(),
    }
    const runtime = createDockerodePostgresRuntime(docker)

    await expect(runtime.inspectContainer(config.containerName)).resolves.toBeNull()
    await expect(runtime.inspectContainer(config.containerName)).resolves.toEqual({ running: true })
    await expect(runtime.inspectHealth(config.containerName)).resolves.toBe('healthy')
  })

  it('creates a named volume and a loopback-only Postgres container', async () => {
    const docker = {
      ping: vi.fn(async () => 'OK'),
      getContainer: vi.fn(() => ({ inspect: vi.fn(), start: vi.fn() })),
      getImage: vi.fn(),
      createVolume: vi.fn(async () => undefined),
      createContainer: vi.fn(async () => undefined),
    }
    const runtime = createDockerodePostgresRuntime(docker)

    await runtime.createContainer(config)

    expect(docker.createVolume).toHaveBeenCalledWith({ Name: config.volumeName })
    expect(docker.createContainer).toHaveBeenCalledWith({
      name: config.containerName,
      Image: config.image,
      Env: [
        'POSTGRES_USER=kufar',
        'POSTGRES_PASSWORD=generated-secret',
        'POSTGRES_DB=kufar',
      ],
      ExposedPorts: { '5432/tcp': {} },
      Volumes: { '/var/lib/postgresql/data': {} },
      HostConfig: {
        Binds: ['kufar-watcher-postgres-data:/var/lib/postgresql/data:rw'],
        PortBindings: {
          '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '5432' }],
        },
      },
      Healthcheck: {
        Test: ['CMD-SHELL', 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
        Interval: 2_000_000_000,
        Timeout: 3_000_000_000,
        Retries: 15,
        StartPeriod: 5_000_000_000,
      },
    })
  })
})
