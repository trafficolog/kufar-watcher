import { IPC, type BootState, type KufarDesktopApi } from '../../shared/ipc'
import type { TelegramDesktopState } from '../../shared/telegram'

type RendererListener = (event: unknown, payload: unknown) => void

export interface IpcRendererLike {
  invoke(channel: string): Promise<unknown>
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
      async bindCandidate() {
        return (await ipcRenderer.invoke(IPC.telegramBindCandidate)) as Awaited<
          ReturnType<KufarDesktopApi['telegram']['bindCandidate']>
        >
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
  }
}