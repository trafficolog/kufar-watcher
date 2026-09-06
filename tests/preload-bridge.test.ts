import { describe, expect, it, vi } from 'vitest'
import { createDesktopApi } from '../electron/preload/desktop-api'
import { IPC, type BootState } from '../shared/ipc'

type RendererListener = (event: unknown, state: BootState) => void

class FakeIpcRenderer {
  invoked: string[] = []
  listeners = new Map<string, Set<RendererListener>>()
  bootState: BootState = { phase: 'starting', steps: [] }

  async invoke(channel: string): Promise<unknown> {
    this.invoked.push(channel)
    if (channel === IPC.bootGet) return this.bootState
    return undefined
  }

  on(channel: string, listener: RendererListener): this {
    const listeners = this.listeners.get(channel) ?? new Set<RendererListener>()
    listeners.add(listener)
    this.listeners.set(channel, listeners)
    return this
  }

  removeListener(channel: string, listener: RendererListener): this {
    this.listeners.get(channel)?.delete(listener)
    return this
  }

  emitBootState(state: BootState): void {
    for (const listener of this.listeners.get(IPC.bootEvent) ?? []) {
      listener({ sender: 'not-exposed' }, state)
    }
  }
}

describe('preload desktop bridge', () => {
  it('exposes only explicit system methods on fixed IPC channels', async () => {
    const ipcRenderer = new FakeIpcRenderer()
    const api = createDesktopApi(ipcRenderer)

    expect(Object.keys(api)).toEqual(['system'])
    expect(Object.keys(api.system)).toEqual([
      'getBootState',
      'retryBoot',
      'openJournal',
      'exit',
      'onBootState',
    ])

    await expect(api.system.getBootState()).resolves.toEqual(ipcRenderer.bootState)
    await api.system.retryBoot()
    await api.system.openJournal()
    await api.system.exit()

    expect(ipcRenderer.invoked).toEqual([
      IPC.bootGet,
      IPC.bootRetry,
      IPC.journalOpen,
      IPC.appExit,
    ])
  })

  it('forwards boot payloads without Electron event objects and unsubscribes', () => {
    const ipcRenderer = new FakeIpcRenderer()
    const api = createDesktopApi(ipcRenderer)
    const listener = vi.fn()
    const state: BootState = {
      phase: 'starting',
      steps: [{ id: 'scheduler', state: 'success', detail: 'Worker ready' }],
    }

    const unsubscribe = api.system.onBootState(listener)
    ipcRenderer.emitBootState(state)
    unsubscribe()
    ipcRenderer.emitBootState({ phase: 'error', steps: [] })

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(state)
  })
})
