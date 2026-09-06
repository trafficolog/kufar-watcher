import type { BootState, KufarDesktopApi } from '../../shared/ipc'
import {
  buildBootScreenModel,
  type BootScreenModel,
  type BootUiPlatform,
} from './boot-screen-model'
import { createBootScreenSession } from './boot-screen-session'
import { createBootScreenVisibilityGate } from './boot-screen-visibility'

export type BootRootView = 'pending' | 'boot' | 'app'

export interface BootScreenSnapshot {
  view: BootRootView
  model?: BootScreenModel
}

export interface BootScreenControllerOptions<THandle> {
  system: KufarDesktopApi['system']
  platform: BootUiPlatform
  delayMs: number
  schedule(run: () => void, delayMs: number): THandle
  cancel(handle: THandle): void
}

export interface BootScreenController {
  snapshot(): BootScreenSnapshot
  start(): Promise<void>
  retry(): Promise<void>
  openJournal(): Promise<void>
  exit(): Promise<void>
  dispose(): void
}

export function createBootScreenController<THandle>(
  options: BootScreenControllerOptions<THandle>,
): BootScreenController {
  let snapshot: BootScreenSnapshot = { view: 'pending' }

  const visibility = createBootScreenVisibilityGate({
    delayMs: options.delayMs,
    show: () => {
      snapshot = { ...snapshot, view: 'boot' }
    },
    hide: () => {
      snapshot = { ...snapshot, view: 'app' }
    },
    schedule: options.schedule,
    cancel: options.cancel,
  })

  const session = createBootScreenSession({
    system: options.system,
    visibility,
    onState(state: BootState) {
      snapshot = {
        ...snapshot,
        model: buildBootScreenModel(state, options.platform),
      }
    },
  })

  return {
    snapshot: () => snapshot,
    start: () => session.start(),
    retry: () => session.retry(),
    openJournal: () => session.openJournal(),
    exit: () => session.exit(),
    dispose: () => session.dispose(),
  }
}
