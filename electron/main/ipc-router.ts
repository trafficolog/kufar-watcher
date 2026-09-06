import { IPC, type BootState } from '../../shared/ipc'
import type { WorkerEvent } from '../../shared/runtime'
import { APP_HOST, APP_SCHEME } from './app-protocol'

export interface SystemIpcServices {
  getBootState(): BootState | Promise<BootState>
  retryBoot(): void | Promise<void>
  openJournal(): void | Promise<void>
  exit(): void | Promise<void>
}

interface IpcInvokeEventLike {
  senderFrame: { url: string } | null
}

interface IpcMainLike {
  handle(channel: string, handler: (event: IpcInvokeEventLike) => unknown): void
}

export function forwardBootState(state: BootState, send: (state: BootState) => void): void {
  send(state)
}

export function routeWorkerBootEvent(
  event: WorkerEvent,
  state: BootState,
  send: (state: BootState) => void,
): BootState {
  if (event.type !== 'ready') return state

  const nextState: BootState = {
    ...state,
    steps: state.steps.map((step) =>
      step.id === 'scheduler' ? { ...step, state: 'success', detail: 'Worker ready' } : step,
    ),
  }
  forwardBootState(nextState, send)
  return nextState
}

export function markWorkerBootFailed(
  state: BootState,
  message: string,
  send: (state: BootState) => void,
): BootState {
  const nextState: BootState = {
    ...state,
    phase: 'error',
    errorCode: 'worker-failed',
    steps: state.steps.map((step) =>
      step.id === 'scheduler' ? { ...step, state: 'error', detail: message } : step,
    ),
  }
  forwardBootState(nextState, send)
  return nextState
}

export function isTrustedRendererUrl(rawUrl: string, devRendererUrl?: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (devRendererUrl) return url.origin === new URL(devRendererUrl).origin
    return url.protocol === `${APP_SCHEME}:` && url.host === APP_HOST
  } catch {
    return false
  }
}

function assertTrustedRenderer(event: IpcInvokeEventLike, devRendererUrl?: string): void {
  const senderUrl = event.senderFrame?.url
  if (!senderUrl || !isTrustedRendererUrl(senderUrl, devRendererUrl)) {
    throw new Error('Untrusted renderer')
  }
}

export function registerSystemIpcHandlers(
  ipcMain: IpcMainLike,
  services: SystemIpcServices,
  devRendererUrl?: string,
): void {
  ipcMain.handle(IPC.bootGet, (event) => {
    assertTrustedRenderer(event, devRendererUrl)
    return services.getBootState()
  })

  ipcMain.handle(IPC.bootRetry, (event) => {
    assertTrustedRenderer(event, devRendererUrl)
    return services.retryBoot()
  })

  ipcMain.handle(IPC.journalOpen, (event) => {
    assertTrustedRenderer(event, devRendererUrl)
    return services.openJournal()
  })

  ipcMain.handle(IPC.appExit, (event) => {
    assertTrustedRenderer(event, devRendererUrl)
    return services.exit()
  })
}
