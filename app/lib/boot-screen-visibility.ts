import type { BootState } from '../../shared/ipc'

export interface BootScreenVisibilityOptions<THandle> {
  delayMs: number
  show(): void
  hide(): void
  schedule(run: () => void, delayMs: number): THandle
  cancel(handle: THandle): void
}

export interface BootScreenVisibilityGate {
  update(phase: BootState['phase']): void
  dispose(): void
}

export function createBootScreenVisibilityGate<THandle>(
  options: BootScreenVisibilityOptions<THandle>,
): BootScreenVisibilityGate {
  let timer: THandle | undefined
  let generation = 0

  const cancelPending = (): void => {
    generation += 1
    if (timer === undefined) return
    options.cancel(timer)
    timer = undefined
  }

  return {
    update(phase): void {
      if (phase === 'ready') {
        cancelPending()
        options.hide()
        return
      }

      if (phase === 'error') {
        cancelPending()
        options.show()
        return
      }

      if (timer !== undefined) return
      const scheduledGeneration = generation
      timer = options.schedule(() => {
        if (scheduledGeneration !== generation) return
        timer = undefined
        options.show()
      }, options.delayMs)
    },
    dispose(): void {
      cancelPending()
    },
  }
}
