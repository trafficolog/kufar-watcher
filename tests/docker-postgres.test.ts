import { describe, expect, it, vi } from 'vitest'
import {
  ensurePostgresContainer,
  waitForPostgresHealthy,
  type ContainerHealth,
  type DockerPostgresRuntime,
  type PostgresContainerConfig,
} from '../electron/main/docker-postgres'

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

function createRuntime(state: 'missing' | 'stopped' | 'running'): DockerPostgresRuntime {
  return {
    ping: vi.fn(async () => undefined),
    inspectContainer: vi.fn(async () => {
      if (state === 'missing') return null
      return {
        running: state === 'running',
        image: config.image,
        volumeName: config.volumeName,
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
      }
    }),
    ensureImage: vi.fn(async () => undefined),
    createContainer: vi.fn(async () => undefined),
    startContainer: vi.fn(async () => undefined),
    inspectHealth: vi.fn(async (): Promise<ContainerHealth> => 'healthy'),
  }
}

describe('ensurePostgresContainer', () => {
  it('leaves an already running project container untouched', async () => {
    const runtime = createRuntime('running')

    await ensurePostgresContainer(runtime, config)

    expect(runtime.ensureImage).not.toHaveBeenCalled()
    expect(runtime.createContainer).not.toHaveBeenCalled()
    expect(runtime.startContainer).not.toHaveBeenCalled()
  })

  it('starts an existing stopped container without creating another one', async () => {
    const runtime = createRuntime('stopped')

    await ensurePostgresContainer(runtime, config)

    expect(runtime.createContainer).not.toHaveBeenCalled()
    expect(runtime.startContainer).toHaveBeenCalledOnce()
    expect(runtime.startContainer).toHaveBeenCalledWith(config.containerName)
  })

  it('rejects an existing container whose image differs from the current configuration', async () => {
    const runtime = createRuntime('stopped')
    const staleContainer = {
      running: false,
      image: 'postgres:15',
      volumeName: config.volumeName,
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
    }
    vi.mocked(runtime.inspectContainer).mockResolvedValueOnce(staleContainer)

    await expect(ensurePostgresContainer(runtime, config)).rejects.toThrow(
      'PostgreSQL container configuration does not match: image',
    )

    expect(runtime.startContainer).not.toHaveBeenCalled()
    expect(runtime.createContainer).not.toHaveBeenCalled()
  })

  it('rejects all existing container contract mismatches without exposing values', async () => {
    const runtime = createRuntime('running')
    const expectedMismatches = [
      'image',
      'volumeName',
      'host',
      'port',
      'user',
      'password',
      'database',
    ]
    vi.mocked(runtime.inspectContainer).mockResolvedValueOnce({
      running: true,
      image: 'postgres:15',
      volumeName: 'legacy-volume',
      host: '0.0.0.0',
      port: 15432,
      user: 'legacy-user',
      password: 'legacy-secret',
      database: 'legacy-db',
    })

    let error: unknown
    try {
      await ensurePostgresContainer(runtime, config)
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).constructor.name).toBe('PostgresContainerConfigurationError')
    expect(Reflect.get(error as object, 'mismatches')).toEqual(expectedMismatches)
    expect((error as Error).message).toBe(
      `PostgreSQL container configuration does not match: ${expectedMismatches.join(', ')}`,
    )
    expect((error as Error).message).not.toContain('legacy-secret')
    expect((error as Error).message).not.toContain(config.password)
    expect(runtime.startContainer).not.toHaveBeenCalled()
    expect(runtime.createContainer).not.toHaveBeenCalled()
  })

  it('ensures the image, creates one container, and starts it when missing', async () => {
    const runtime = createRuntime('missing')

    await ensurePostgresContainer(runtime, config)

    expect(runtime.ensureImage).toHaveBeenCalledWith(config.image)
    expect(runtime.createContainer).toHaveBeenCalledOnce()
    expect(runtime.createContainer).toHaveBeenCalledWith(config)
    expect(runtime.startContainer).toHaveBeenCalledOnce()
    expect(runtime.startContainer).toHaveBeenCalledWith(config.containerName)
  })
})

describe('waitForPostgresHealthy', () => {
  it('returns after the healthcheck becomes healthy', async () => {
    const runtime = createRuntime('running')
    vi.mocked(runtime.inspectHealth)
      .mockResolvedValueOnce('starting')
      .mockResolvedValueOnce('healthy')
    const sleep = vi.fn(async () => undefined)

    await waitForPostgresHealthy(runtime, config.containerName, {
      timeoutMs: 1_000,
      pollIntervalMs: 250,
      sleep,
    })

    expect(runtime.inspectHealth).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledOnce()
  })

  it('throws after the bounded number of health polls', async () => {
    const runtime = createRuntime('running')
    vi.mocked(runtime.inspectHealth).mockResolvedValue('starting')

    await expect(
      waitForPostgresHealthy(runtime, config.containerName, {
        timeoutMs: 1_000,
        pollIntervalMs: 250,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow('PostgreSQL healthcheck timed out')

    expect(runtime.inspectHealth).toHaveBeenCalledTimes(5)
  })
})
