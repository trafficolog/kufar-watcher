import { describe, expect, it, vi } from 'vitest'
import { createInfrastructureBootstrapDependencies } from '../electron/main/infrastructure-runtime'
import type {
  DockerPostgresRuntime,
  PostgresContainerConfig,
} from '../electron/main/docker-postgres'

const container: PostgresContainerConfig = {
  image: 'postgres:16',
  containerName: 'kufar-watcher-postgres',
  volumeName: 'kufar-watcher-postgres-data',
  host: '127.0.0.1',
  port: 5432,
  user: 'kufar_dev',
  password: 'secret',
  database: 'kufar_dev',
}

describe('createInfrastructureBootstrapDependencies', () => {
  it('composes Docker, health, migrations, worker, and boot-state publication', async () => {
    const runtime: DockerPostgresRuntime = {
      ping: vi.fn(async () => undefined),
      inspectContainer: vi.fn(async () => null),
      ensureImage: vi.fn(async () => undefined),
      createContainer: vi.fn(async () => undefined),
      startContainer: vi.fn(async () => undefined),
      inspectHealth: vi.fn(async () => 'healthy' as const),
    }
    const applyMigrations = vi.fn(async () => undefined)
    const startWorker = vi.fn()
    const publishBootState = vi.fn()

    const deps = createInfrastructureBootstrapDependencies({
      runtime,
      config: { container, databaseUrl: 'postgresql://example.invalid/kufar' },
      applyMigrations,
      startWorker,
      publishBootState,
      sleep: vi.fn(async () => undefined),
    })

    await deps.pingDocker()
    await deps.ensureDatabaseContainer()
    await deps.waitForDatabase()
    await deps.applyMigrations()
    deps.startWorker()
    deps.publishBootState({ phase: 'starting', steps: [] })

    expect(runtime.ping).toHaveBeenCalledOnce()
    expect(runtime.ensureImage).toHaveBeenCalledWith('postgres:16')
    expect(runtime.createContainer).toHaveBeenCalledWith(container)
    expect(runtime.startContainer).toHaveBeenCalledWith('kufar-watcher-postgres')
    expect(runtime.inspectHealth).toHaveBeenCalledWith('kufar-watcher-postgres')
    expect(applyMigrations).toHaveBeenCalledOnce()
    expect(startWorker).toHaveBeenCalledOnce()
    expect(publishBootState).toHaveBeenCalledWith({ phase: 'starting', steps: [] })
  })
})
