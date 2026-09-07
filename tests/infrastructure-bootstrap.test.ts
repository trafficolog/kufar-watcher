import { describe, expect, it, vi } from 'vitest'
import type { BootState } from '../shared/ipc'
import { runInfrastructureBootstrap } from '../electron/main/infrastructure-bootstrap'

function createDeps() {
  const calls: string[] = []
  const states: BootState[] = []

  return {
    calls,
    states,
    deps: {
      pingDocker: vi.fn(async () => {
        calls.push('ping')
      }),
      ensureDatabaseContainer: vi.fn(async () => {
        calls.push('ensure-container')
      }),
      waitForDatabase: vi.fn(async () => {
        calls.push('wait-database')
      }),
      applyMigrations: vi.fn(async () => {
        calls.push('migrations')
      }),
      startWorker: vi.fn(() => {
        calls.push('worker')
      }),
      publishBootState: vi.fn((state: BootState) => {
        states.push(state)
      }),
    },
  }
}

describe('runInfrastructureBootstrap', () => {
  it('starts the worker only after Docker, database health, and migrations succeed', async () => {
    const { calls, states, deps } = createDeps()

    const result = await runInfrastructureBootstrap(deps)

    expect(result.phase).toBe('ready')
    expect(calls).toEqual(['ping', 'ensure-container', 'wait-database', 'migrations', 'worker'])
    expect(states.at(-1)).toEqual(result)
    expect(result.steps).toEqual([
      { id: 'docker', state: 'success', detail: 'Docker daemon is available' },
      { id: 'database', state: 'success', detail: 'PostgreSQL is healthy' },
      { id: 'migrations', state: 'success', detail: 'Database migrations applied' },
      { id: 'scheduler', state: 'success', detail: 'Worker started' },
      { id: 'telegram', state: 'skipped', detail: 'Telegram is not configured yet' },
    ])
  })

  it('reports docker-unavailable and does not continue when the daemon cannot be reached', async () => {
    const { calls, deps } = createDeps()
    deps.pingDocker.mockRejectedValueOnce(new Error('connect ENOENT /var/run/docker.sock'))

    const result = await runInfrastructureBootstrap(deps)

    expect(result.phase).toBe('error')
    expect(result.errorCode).toBe('docker-unavailable')
    expect(calls).toEqual([])
    expect(deps.ensureDatabaseContainer).not.toHaveBeenCalled()
    expect(deps.startWorker).not.toHaveBeenCalled()
  })

  it('reports database-timeout without migrations or worker startup', async () => {
    const { calls, deps } = createDeps()
    deps.waitForDatabase.mockRejectedValueOnce(new Error('health timeout'))

    const result = await runInfrastructureBootstrap(deps)

    expect(result.phase).toBe('error')
    expect(result.errorCode).toBe('database-timeout')
    expect(calls).toEqual(['ping', 'ensure-container'])
    expect(deps.applyMigrations).not.toHaveBeenCalled()
    expect(deps.startWorker).not.toHaveBeenCalled()
  })

  it('reports migration-failed and never starts the worker', async () => {
    const { calls, deps } = createDeps()
    deps.applyMigrations.mockRejectedValueOnce(new Error('migration failed'))

    const result = await runInfrastructureBootstrap(deps)

    expect(result.phase).toBe('error')
    expect(result.errorCode).toBe('migration-failed')
    expect(calls).toEqual(['ping', 'ensure-container', 'wait-database'])
    expect(deps.startWorker).not.toHaveBeenCalled()
  })
})
