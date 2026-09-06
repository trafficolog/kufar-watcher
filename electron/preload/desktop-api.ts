import { IPC, type BootState, type KufarDesktopApi } from '../../shared/ipc'

type RendererListener = (event: unknown, state: BootState) => void

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
        const handleBootState: RendererListener = (_event, state) => listener(state)
        ipcRenderer.on(IPC.bootEvent, handleBootState)
        return () => {
          ipcRenderer.removeListener(IPC.bootEvent, handleBootState)
        }
      },
    },
  }
}
