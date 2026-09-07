export type BootStepId = 'docker' | 'database' | 'migrations' | 'scheduler' | 'telegram'

export type BootStepState = 'pending' | 'running' | 'success' | 'skipped' | 'degraded' | 'error'

export interface BootStep {
  id: BootStepId
  state: BootStepState
  detail: string
}

export interface BootState {
  phase: 'starting' | 'ready' | 'error'
  steps: BootStep[]
  errorCode?: 'docker-unavailable' | 'database-timeout' | 'migration-failed' | 'worker-failed'
}

export interface KufarDesktopApi {
  system: {
    getBootState(): Promise<BootState>
    retryBoot(): Promise<void>
    openJournal(): Promise<void>
    exit(): Promise<void>
    onBootState(listener: (state: BootState) => void): () => void
  }
}

export const IPC = {
  bootGet: 'system:boot:get',
  bootRetry: 'system:boot:retry',
  bootEvent: 'system:boot:event',
  journalOpen: 'system:journal:open',
  appExit: 'system:app:exit',
} as const
