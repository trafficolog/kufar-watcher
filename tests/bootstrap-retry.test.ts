import { describe, expect, it } from 'vitest'
import type { BootState } from '../shared/ipc'
import { createBootstrapRetryController } from '../electron/main/bootstrap-retry'

function bootState(phase: BootState['phase']): BootState {
  return { phase, steps: [] }
}

describe('createBootstrapRetryController', () => {
  it('does not rerun bootstrap when the application is not in an error state', async () => {
    let state = bootState('ready')
    let runs = 0
    const controller = createBootstrapRetryController({
      getState: () => state,
      runBootstrap: async () => {
        runs += 1
        state = bootState('ready')
      },
    })

    await controller.retry()

    expect(runs).toBe(0)
  })

  it('reruns bootstrap from an error state', async () => {
    let state = bootState('error')
    let runs = 0
    const controller = createBootstrapRetryController({
      getState: () => state,
      runBootstrap: async () => {
        runs += 1
        state = bootState('ready')
      },
    })

    await controller.retry()

    expect(runs).toBe(1)
    expect(state.phase).toBe('ready')
  })

  it('coalesces concurrent retries into one bootstrap run', async () => {
    const state = bootState('error')
    let runs = 0
    let release: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const controller = createBootstrapRetryController({
      getState: () => state,
      runBootstrap: async () => {
        runs += 1
        await blocked
      },
    })

    const first = controller.retry()
    const second = controller.retry()

    expect(runs).toBe(1)
    release?.()
    await Promise.all([first, second])
    expect(runs).toBe(1)
  })
})
