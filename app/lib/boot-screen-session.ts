import type { BootState, KufarDesktopApi } from '../../shared/ipc'
import type { BootScreenVisibilityGate } from './boot-screen-visibility'

export interface BootScreenSessionOptions {
  system: KufarDesktopApi['system']
  visibility: BootScreenVisibilityGate
  onState(state: BootState): void
}

export interface BootScreenSession {
  start(): Promise<void>
  retry(): Promise<void>
  openJournal(): Promise<void>
  exit(): Promise<void>
  dispose(): void
}

export function createBootScreenSession(options: BootScreenSessionOptions): BootScreenSession {
  let unsubscribe: (() => void) | undefined

  const forwardState = (state: BootState): void => {
    options.onState(state)
    options.visibility.update(state.phase)
  }

  return {
    async start(): Promise<void> {
      if (unsubscribe) return
      unsubscribe = options.system.onBootState(forwardState)
      forwardState(await options.system.getBootState())
    },
    retry(): Promise<void> {
      return options.system.retryBoot()
    },
    openJournal(): Promise<void> {
      return options.system.openJournal()
    },
    exit(): Promise<void> {
      return options.system.exit()
    },
    dispose(): void {
      unsubscribe?.()
      unsubscribe = undefined
      options.visibility.dispose()
    },
  }
}
