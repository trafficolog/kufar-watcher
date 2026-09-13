import { describe, expect, it, vi } from 'vitest'
import { createDesktopApi } from '../electron/preload/desktop-api'
import { IPC, type BootState } from '../shared/ipc'
import type { TelegramDesktopState } from '../shared/telegram'

type RendererListener = (event: unknown, payload: unknown) => void

class FakeIpcRenderer {
  invoked: string[] = []
  listeners = new Map<string, Set<RendererListener>>()
  bootState: BootState = { phase: 'starting', steps: [] }
  telegramState: TelegramDesktopState = {
    runtime: 'waiting-for-binding',
    channel: 'connected',
    boundChatId: null,
    candidate: {
      chatId: '1001',
      chatType: 'private',
      displayName: 'Owner',
    },
    secret: 'protected',
  }

  async invoke(channel: string): Promise<unknown> {
    this.invoked.push(channel)
    if (channel === IPC.bootGet) return this.bootState
    if (channel === IPC.telegramStateGet) return this.telegramState
    if (channel === IPC.telegramBindCandidate) return 'bound'
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

  emitTelegramState(state: TelegramDesktopState): void {
    for (const listener of this.listeners.get(IPC.telegramStateEvent) ?? []) {
      listener({ sender: 'not-exposed' }, state)
    }
  }
}

describe('preload desktop bridge', () => {
  it('exposes only explicit system and Telegram methods on fixed IPC channels', async () => {
    const ipcRenderer = new FakeIpcRenderer()
    const api = createDesktopApi(ipcRenderer)

    expect(Object.keys(api)).toEqual(['system', 'telegram'])
    expect(Object.keys(api.system)).toEqual([
      'getBootState',
      'retryBoot',
      'openJournal',
      'exit',
      'onBootState',
    ])
    expect(Object.keys(api.telegram)).toEqual(['getState', 'bindCandidate', 'onState'])

    await expect(api.system.getBootState()).resolves.toEqual(ipcRenderer.bootState)
    await api.system.retryBoot()
    await api.system.openJournal()
    await api.system.exit()
    await expect(api.telegram.getState()).resolves.toEqual(ipcRenderer.telegramState)
    await expect(api.telegram.bindCandidate()).resolves.toBe('bound')

    expect(ipcRenderer.invoked).toEqual([
      IPC.bootGet,
      IPC.bootRetry,
      IPC.journalOpen,
      IPC.appExit,
      IPC.telegramStateGet,
      IPC.telegramBindCandidate,
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

  it('forwards only safe Telegram desktop state and unsubscribes', () => {
    const ipcRenderer = new FakeIpcRenderer()
    const api = createDesktopApi(ipcRenderer)
    const listener = vi.fn()

    const unsubscribe = api.telegram.onState(listener)
    ipcRenderer.emitTelegramState(ipcRenderer.telegramState)
    unsubscribe()
    ipcRenderer.emitTelegramState({
      runtime: 'ready',
      channel: 'connected',
      boundChatId: '1001',
      candidate: null,
      secret: 'protected',
    })

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(ipcRenderer.telegramState)
    expect(JSON.stringify(listener.mock.calls)).not.toContain('token')
  })
})
