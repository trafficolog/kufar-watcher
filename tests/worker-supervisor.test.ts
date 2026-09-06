import { describe, expect, it } from 'vitest'

describe('worker restart policy', () => {
  it('enters fatal state after the fourth consecutive unexpected exit', async () => {
    const workerModule = await import('../electron/main/worker-supervisor').catch(() => ({
      createRestartPolicy: undefined,
    }))

    expect(workerModule.createRestartPolicy).toBeTypeOf('function')

    const policy = workerModule.createRestartPolicy!(3)
    expect(policy.recordCrash()).toBe('restart')
    expect(policy.recordCrash()).toBe('restart')
    expect(policy.recordCrash()).toBe('restart')
    expect(policy.recordCrash()).toBe('fatal')
  })
})
