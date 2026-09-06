import { describe, expect, it, vi } from 'vitest'
import type { BootState, KufarDesktopApi } from '../shared/ipc'
import { createBootScreenController } from '../app/lib/boot-screen-controller'

interface ScheduledTask {
  delayMs: number
  run(): void
  cancelled: boolean
}

function bootState(phase: BootState['phase']): BootState {
  return {
    phase,
    steps: [{ id: 'docker', state: phase === 'error' ? 'error' : 'running', detail: '' }],
    errorCode: phase === 'error' ? 'docker-unavailable' : undefined,
  }
}

function harness(initial: BootState) {
  let listener: ((state: BootState) => void) | undefined
  const tasks: ScheduledTask[] = []
  const system: KufarDesktopApi['system'] = {
    getBootState: vi.fn(async () => initial),
    retryBoot: vi.fn(async () => undefined),
    openJournal: vi.fn(async () => undefined),
    exit: vi.fn(async () => undefined),
    onBootState(next) {
      listener = next
      return () => {
        listener = undefined
      }
    },
  }

  const controller = createBootScreenController({
    system,
    platform: 'linux',
    delayMs: 150,
    schedule(run, delayMs) {
      const task: ScheduledTask = { run, delayMs, cancelled: false }
      tasks.push(task)
      return task
    },
    cancel(task) {
      task.cancelled = true
    },
  })

  return { controller, tasks, emit: (state: BootState) => listener?.(state), system }
}

describe('createBootScreenController', () => {
  it('keeps the root pending during the anti-flicker window, then shows the boot model', async () => {
    const { controller, tasks } = harness(bootState('starting'))

    expect(controller.snapshot().view).toBe('pending')
    await controller.start()

    expect(controller.snapshot().view).toBe('pending')
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.delayMs).toBe(150)

    tasks[0]?.run()

    expect(controller.snapshot().view).toBe('boot')
    expect(controller.snapshot().model?.title).toBe('Инициализация')
  })

  it('goes straight to the app for fast ready and shows fatal errors immediately', async () => {
    const ready = harness(bootState('starting'))
    await ready.controller.start()
    ready.emit(bootState('ready'))
    ready.tasks[0]?.run()

    expect(ready.controller.snapshot().view).toBe('app')
    expect(ready.tasks[0]?.cancelled).toBe(true)

    const failed = harness(bootState('error'))
    await failed.controller.start()

    expect(failed.controller.snapshot().view).toBe('boot')
    expect(failed.controller.snapshot().model?.error?.heading).toBe('Docker недоступен')
    expect(failed.controller.snapshot().model?.error?.message).toContain('служба docker')
  })

  it('delegates actions through the boot session and disposes pending work', async () => {
    const { controller, tasks, system } = harness(bootState('starting'))
    await controller.start()

    await controller.retry()
    await controller.openJournal()
    await controller.exit()
    controller.dispose()

    expect(system.retryBoot).toHaveBeenCalledOnce()
    expect(system.openJournal).toHaveBeenCalledOnce()
    expect(system.exit).toHaveBeenCalledOnce()
    expect(tasks[0]?.cancelled).toBe(true)
  })
})
