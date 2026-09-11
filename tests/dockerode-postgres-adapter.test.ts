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
    let inspectCalls = 0
    const inspect = vi.fn(async () => {
      inspectCalls += 1
      if (inspectCalls === 1) throw notFound()
      return { State: { Running: true, Health: { Status: 'healthy' } } }
    })
    const docker = {
      ping: vi.fn(async () => 'OK'),
      getContainer: vi.fn(() => ({ inspect, start: vi.fn() })),
      getImage: vi.fn(),
      createVolume: vi.fn(),
      createContainer: vi.fn(),
    }
    const runtime = createDockerodePostgresRuntime(docker)
    const containerName = config.containerName

    await expect(runtime.inspectContainer(containerName)).resolves.toBeNull()
    await expect(runtime.inspectContainer(containerName)).resolves.toMatchObject({ running: true })
    await expect(runtime.inspectHealth(containerName)).resolves.toBe('healthy')
  })

  it('normalizes image, Postgres env, host port, and named data volume from inspect', async () => {
    const inspect = vi.fn(async () => ({
      State: { Running: false },
      Config: {
        Image: config.image,
        Env: [
          'PATH=/usr/local/bin:/usr/bin:/bin',
          `POSTGRES_USER=${config.user}`,
          `POSTGRES_PASSWORD=${config.password}`,
          `POSTGRES_DB=${config.database}`,
        ],
      },
      HostConfig: {
        PortBindings: {
          '5432/tcp': [{ HostIp: config.host, HostPort: String(config.port) }],
        },
      },
      Mounts: [
        {
          Type: 'volume',
          Name: config.volumeName,
          Destination: '/var/lib/postgresql/data',
        },
      ],
    }))
    const docker = {
      ping: vi.fn(async () => 'OK'),
      getContainer: vi.fn(() => ({ inspect, start: vi.fn() })),
      getImage: vi.fn(),
      createVolume: vi.fn(),
      createContainer: vi.fn(),
    }
    const runtime = createDockerodePostgresRuntime(docker)

    await expect(runtime.inspectContainer(config.containerName)).resolves.toEqual({
      running: false,
      image: config.image,
      volumeName: config.volumeName,
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
    })
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
      Env: ['POSTGRES_USER=kufar', 'POSTGRES_PASSWORD=generated-secret', 'POSTGRES_DB=kufar'],
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
