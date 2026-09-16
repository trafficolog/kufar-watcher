import {
  IPC,
  type BootState,
  type KufarDesktopApi,
  type MonitorCreateInput,
  type MonitorCreateResult,
  type MonitorListItem,
} from '../../shared/ipc'
import type { TelegramDesktopState } from '../../shared/telegram'

type RendererListener = (event: unknown, payload: unknown) => void

export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: RendererListener): unknown
  removeListener(channel: string, listener: RendererListener): unknown
}

export function createDesktopApi(ipcRenderer: IpcRendererLike): KufarDesktopApi {
  return {
    system: {
      async getBootState(): Promise<BootState> {
        return (await ipcRenderer.invoke(IPC.bootGet)) as BootState
      },
      async retryBoot(): Promise<void> {
        await ipcRenderer.invoke(IPC.bootRetry)
      },
      async openJournal(): Promise<void> {
        await ipcRenderer.invoke(IPC.journalOpen)
      },
      async exit(): Promise<void> {
        await ipcRenderer.invoke(IPC.appExit)
      },
      onBootState(listener): () => void {
        const handleBootState: RendererListener = (_event, state) => listener(state as BootState)
        ipcRenderer.on(IPC.bootEvent, handleBootState)
        return () => {
          ipcRenderer.removeListener(IPC.bootEvent, handleBootState)
        }
      },
    },
    telegram: {
      async getState() {
        return (await ipcRenderer.invoke(IPC.telegramStateGet)) as TelegramDesktopState
      },
      async verifyToken(token) {
        return (await ipcRenderer.invoke(IPC.telegramTokenVerify, token)) as Awaited<
          ReturnType<KufarDesktopApi['telegram']['verifyToken']>
        >
      },
      async saveToken(token, allowUnprotected) {
        return (await ipcRenderer.invoke(
          IPC.telegramTokenSave,
          token,
          allowUnprotected,
        )) as Awaited<ReturnType<KufarDesktopApi['telegram']['saveToken']>>
      },
      async bindCandidate() {
        return (await ipcRenderer.invoke(IPC.telegramBindCandidate)) as Awaited<
          ReturnType<KufarDesktopApi['telegram']['bindCandidate']>
        >
      },
      async sendTestMessage() {
        await ipcRenderer.invoke(IPC.telegramTestMessage)
      },
      onState(listener): () => void {
        const handleState: RendererListener = (_event, state) =>
          listener(state as TelegramDesktopState)
        ipcRenderer.on(IPC.telegramStateEvent, handleState)
        return () => {
          ipcRenderer.removeListener(IPC.telegramStateEvent, handleState)
        }
      },
    },
    monitors: {
      async create(input: MonitorCreateInput): Promise<MonitorCreateResult> {
        return (await ipcRenderer.invoke(IPC.monitorCreate, input)) as MonitorCreateResult
      },
      async list(archived = false): Promise<MonitorListItem[]> {
        return (await ipcRenderer.invoke(IPC.monitorList, archived)) as MonitorListItem[]
      },
      async setState(monitorId, state): Promise<void> {
        await ipcRenderer.invoke(IPC.monitorSetState, monitorId, state)
      },
      onChanged(listener): () => void {
        const handleChanged: RendererListener = (_event, monitorId) => listener(monitorId as number)
        ipcRenderer.on(IPC.monitorChangedEvent, handleChanged)
        return () => {
          ipcRenderer.removeListener(IPC.monitorChangedEvent, handleChanged)
        }
      },
    },
  }
}
