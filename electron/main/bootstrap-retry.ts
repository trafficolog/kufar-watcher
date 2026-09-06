import type { BootState } from '../../shared/ipc'

export interface BootstrapRetryOptions {
  getState(): BootState
  runBootstrap(): Promise<void>
}

export interface BootstrapRetryController {
  retry(): Promise<void>
}

export function createBootstrapRetryController(
  options: BootstrapRetryOptions,
): BootstrapRetryController {
  let activeRetry: Promise<void> | undefined

  return {
    retry(): Promise<void> {
      if (options.getState().phase !== 'error') return Promise.resolve()
      if (activeRetry) return activeRetry

      activeRetry = options.runBootstrap().finally(() => {
        activeRetry = undefined
      })
      return activeRetry
    },
  }
}
