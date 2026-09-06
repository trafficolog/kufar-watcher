import { describe, expect, it } from 'vitest'
import type { BootPhase } from '../shared/ipc'
import { createBootScreenVisibilityGate } from '../app/lib/boot-screen-visibility'

interface ScheduledTask {
  delayMs: number
  run(): void
  cancelled: boolean
}

function harness() {
  let visible = false
  const tasks: ScheduledTask[] = []
  const gate = createBootScreenVisibilityGate({
    delayMs: 150,
    show: () => {
      visible = true
    },
    hide: () => {
      visible = false
    },
    schedule: (run, delayMs) => {
      const task: ScheduledTask = { run, delayMs, cancelled: false }
      tasks.push(task)
      return task
    },
    cancel: (task) => {
      task.cancelled = true
    },
  })

  return {
    gate,
    tasks,
    isVisible: () => visible,
  }
}

function update(gate: ReturnType<typeof createBootScreenVisibilityGate>, phase: BootPhase): void {
  gate.update(phase)
}

describe('createBootScreenVisibilityGate', () => {
  it('delays the startup screen so a fast launch does not flash', () => {
    const { gate, tasks, isVisible } = harness()

    update(gate, 'starting')

    expect(isVisible()).toBe(false)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.delayMs).toBe(150)
    tasks[0]?.run()
    expect(isVisible()).toBe(true)
  })

  it('cancels the delayed screen when startup becomes ready quickly', () => {
    const { gate, tasks, isVisible } = harness()

    update(gate, 'starting')
    update(gate, 'ready')
    tasks[0]?.run()

    expect(tasks[0]?.cancelled).toBe(true)
    expect(isVisible()).toBe(false)
  })

  it('shows fatal startup errors immediately', () => {
    const { gate, tasks, isVisible } = harness()

    update(gate, 'starting')
    update(gate, 'error')

    expect(tasks[0]?.cancelled).toBe(true)
    expect(isVisible()).toBe(true)
  })

  it('cancels an outstanding timer when disposed', () => {
    const { gate, tasks } = harness()

    update(gate, 'starting')
    gate.dispose()

    expect(tasks[0]?.cancelled).toBe(true)
  })
})
