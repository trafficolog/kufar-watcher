import { describe, expect, it, vi } from 'vitest'
import type { BootState, KufarDesktopApi } from '../shared/ipc'
import type { BootScreenVisibilityGate } from '../app/lib/boot-screen-visibility'
import { createBootScreenSession } from '../app/lib/boot-screen-session'

function bootState(phase: BootState['phase']): BootState {
  return { phase, steps: [] }
}

describe('createBootScreenSession', () => {
  it('subscribes before reading the initial state and forwards every state to visibility', async () => {
    let listener: ((state: BootState) => void) | undefined
    let subscribed = false
    const seen: BootState[] = []
    const visibility: BootScreenVisibilityGate = {
      update: vi.fn(),
      dispose: vi.fn(),
    }
    const system: KufarDesktopApi['system'] = {
      async getBootState() {
        expect(subscribed).toBe(true)
        return bootState('starting')
      },
      retryBoot: vi.fn(async () => undefined),
      openJournal: vi.fn(async () => undefined),
      exit: vi.fn(async () => undefined),
      onBootState(nextListener) {
        subscribed = true
        listener = nextListener
        return () => {
          subscribed = false
        }
      },
    }
    const session = createBootScreenSession({
      system,
      visibility,
      onState: (state) => seen.push(state),
    })

    await session.start()
    listener?.(bootState('ready'))

    expect(seen.map((state) => state.phase)).toEqual(['starting', 'ready'])
    expect(visibility.update).toHaveBeenNthCalledWith(1, 'starting')
    expect(visibility.update).toHaveBeenNthCalledWith(2, 'ready')
  })

  it('unsubscribes and disposes the visibility gate', async () => {
    let subscribed = false
    const visibility: BootScreenVisibilityGate = {
      update: vi.fn(),
      dispose: vi.fn(),
    }
    const system: KufarDesktopApi['system'] = {
      getBootState: vi.fn(async () => bootState('ready')),
      retryBoot: vi.fn(async () => undefined),
      openJournal: vi.fn(async () => undefined),
      exit: vi.fn(async () => undefined),
      onBootState() {
        subscribed = true
        return () => {
          subscribed = false
        }
      },
    }
    const session = createBootScreenSession({ system, visibility, onState: vi.fn() })

    await session.start()
    session.dispose()

    expect(subscribed).toBe(false)
    expect(visibility.dispose).toHaveBeenCalledOnce()
  })

  it('delegates retry, journal and exit actions to the typed desktop API', async () => {
    const system: KufarDesktopApi['system'] = {
      getBootState: vi.fn(async () => bootState('error')),
      retryBoot: vi.fn(async () => undefined),
      openJournal: vi.fn(async () => undefined),
      exit: vi.fn(async () => undefined),
      onBootState: vi.fn(() => () => undefined),
    }
    const session = createBootScreenSession({
      system,
      visibility: { update: vi.fn(), dispose: vi.fn() },
      onState: vi.fn(),
    })

    await session.retry()
    await session.openJournal()
    await session.exit()

    expect(system.retryBoot).toHaveBeenCalledOnce()
    expect(system.openJournal).toHaveBeenCalledOnce()
    expect(system.exit).toHaveBeenCalledOnce()
  })
})
