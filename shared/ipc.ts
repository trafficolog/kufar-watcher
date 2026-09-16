import type {
  TelegramBindResult,
  TelegramDesktopState,
  TelegramTokenSaveResult,
  TelegramTokenVerificationResult,
} from './telegram'

export type BootStepId = 'docker' | 'database' | 'migrations' | 'scheduler' | 'telegram'

export type BootStepState = 'pending' | 'running' | 'success' | 'skipped' | 'degraded' | 'error'

export interface BootStep {
  id: BootStepId
  state: BootStepState
  detail: string
}

export type PostgresContainerMismatchField =
  'image' | 'volumeName' | 'host' | 'port' | 'user' | 'password' | 'database'

export type BootErrorCode =
  | 'docker-unavailable'
  | 'database-timeout'
  | 'database-container-incompatible'
  | 'migration-failed'
  | 'worker-failed'
  | 'configuration-invalid'
  | 'unexpected-failure'

export interface BootState {
  phase: 'starting' | 'ready' | 'error'
  steps: BootStep[]
  errorCode?: BootErrorCode
  postgresContainerMismatches?: PostgresContainerMismatchField[]
}

export interface MonitorCreateInput {
  name: string
  sourceUrl: string
  intervalSec: number
  include: string[]
  exclude: string[]
}

export interface MonitorCreateResult {
  monitorId: number
}

export interface MonitorRunSummary {
  startedAt: string
  finishedAt: string | null
  outcome: string | null
  errorCategory: string | null
  errorCode: string | null
}

export interface MonitorListItem {
  id: number
  name: string
  intervalSec: number
  state: 'active' | 'paused' | 'archived'
  lastRun: MonitorRunSummary | null
}

export interface KufarDesktopApi {
  system: {
    getBootState(): Promise<BootState>
    retryBoot(): Promise<void>
    openJournal(): Promise<void>
    exit(): Promise<void>
    onBootState(listener: (state: BootState) => void): () => void
  }
  telegram: {
    getState(): Promise<TelegramDesktopState>
    verifyToken(token: string): Promise<TelegramTokenVerificationResult>
    saveToken(token: string, allowUnprotected: boolean): Promise<TelegramTokenSaveResult>
    bindCandidate(): Promise<TelegramBindResult>
    sendTestMessage(): Promise<void>
    onState(listener: (state: TelegramDesktopState) => void): () => void
  }
  monitors: {
    create(input: MonitorCreateInput): Promise<MonitorCreateResult>
    list(archived?: boolean): Promise<MonitorListItem[]>
    setState(monitorId: number, state: 'active' | 'paused' | 'archived'): Promise<void>
    onChanged(listener: (monitorId: number) => void): () => void
  }
}

export const IPC = {
  bootGet: 'system:boot:get',
  bootRetry: 'system:boot:retry',
  bootEvent: 'system:boot:event',
  journalOpen: 'system:journal:open',
  appExit: 'system:app:exit',
  telegramStateGet: 'telegram:state:get',
  telegramTokenVerify: 'telegram:token:verify',
  telegramTokenSave: 'telegram:token:save',
  telegramBindCandidate: 'telegram:candidate:bind',
  telegramTestMessage: 'telegram:test-message',
  telegramStateEvent: 'telegram:state:event',
  monitorCreate: 'monitors:create',
  monitorList: 'monitors:list',
  monitorSetState: 'monitors:set-state',
  monitorChangedEvent: 'monitors:changed',
} as const
