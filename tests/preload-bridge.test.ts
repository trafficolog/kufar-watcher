import { describe, expect, it, vi } from 'vitest'
import { createDesktopApi } from '../electron/preload/desktop-api'
import { IPC, type BootState, type MonitorListItem } from '../shared/ipc'
import type { TelegramDesktopState } from '../shared/telegram'

type RendererListener = (event: unknown, payload: unknown) => void

class FakeIpcRenderer {
  invoked: string[] = []
  calls: Array<{ channel: string; args: unknown[] }> = []
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
  monitorSnapshot: MonitorListItem[] = [
    {
      id: 7,
      name: 'PS5 Минск',
      intervalSec: 300,
      state: 'active',
      lastRun: null,
    },
  ]

  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    this.invoked.push(channel)
    this.calls.push({ channel, args })
    if (channel === IPC.bootGet) return this.bootState
    if (channel === IPC.telegramStateGet) return this.telegramState
    if (channel === IPC.telegramBindCandidate) return 'bound'
    if (channel === Reflect.get(IPC, 'monitorCreate')) return { monitorId: 17 }
    if (channel === Reflect.get(IPC, 'monitorList')) return this.monitorSnapshot
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

  emitMonitorChanged(monitorId: number): void {
    for (const listener of this.listeners.get(IPC.monitorChangedEvent) ?? []) {
      listener({ sender: 'not-exposed' }, monitorId)
    }
  }
}

describe('preload desktop bridge', () => {
  it('exposes only explicit system, Telegram, and monitor methods on fixed IPC channels', async () => {
    const ipcRenderer = new FakeIpcRenderer()
    const api = createDesktopApi(ipcRenderer)

    expect(Object.keys(api)).toEqual(['system', 'telegram', 'monitors'])
    expect(Object.keys(api.system)).toEqual([
      'getBootState',
      'retryBoot',
      'openJournal',
      'exit',
      'onBootState',
    ])
    expect(Object.keys(api.telegram)).toEqual([
      'getState',
      'verifyToken',
      'saveToken',
      'bindCandidate',
      'sendTestMessage',
      'onState',
    ])

    const monitors = Reflect.get(api, 'monitors') as
      | {
          create(input: unknown): Promise<{ monitorId: number }>
          list(): Promise<MonitorListItem[]>
          setState(monitorId: number, state: 'active' | 'paused'): Promise<void>
        }
      | undefined
    const monitorCreateChannel = Reflect.get(IPC, 'monitorCreate')
    const monitorListChannel = Reflect.get(IPC, 'monitorList')
    const monitorSetStateChannel = Reflect.get(IPC, 'monitorSetState')
    expect(monitors).toBeDefined()
    expect(Reflect.get(monitors ?? {}, 'create')).toBeTypeOf('function')
    expect(Reflect.get(monitors ?? {}, 'list')).toBeTypeOf('function')
    expect(Reflect.get(monitors ?? {}, 'setState')).toBeTypeOf('function')
    expect(monitorCreateChannel).toBe('monitors:create')
    expect(monitorListChannel).toBe('monitors:list')
    expect(monitorSetStateChannel).toBe('monitors:set-state')

    await expect(api.system.getBootState()).resolves.toEqual(ipcRenderer.bootState)
    await api.system.retryBoot()
    await api.system.openJournal()
    await api.system.exit()
    await expect(api.telegram.getState()).resolves.toEqual(ipcRenderer.telegramState)
    await expect(api.telegram.bindCandidate()).resolves.toBe('bound')
    await expect(api.telegram.sendTestMessage()).resolves.toBeUndefined()

    const input = {
      name: 'PS5 Минск',
      sourceUrl: 'https://www.kufar.by/l/igry-i-pristavki/r~minsk/q~playstation',
      intervalSec: 300,
      include: ['ps5', 'playstation*'],
      exclude: ['ремонт'],
    }
    await expect(monitors!.create(input)).resolves.toEqual({ monitorId: 17 })
    await expect(monitors!.list()).resolves.toEqual(ipcRenderer.monitorSnapshot)
    await expect(monitors!.setState(7, 'paused')).resolves.toBeUndefined()
    expect(ipcRenderer.calls).toContainEqual({ channel: 'monitors:create', args: [input] })
    expect(ipcRenderer.calls).toContainEqual({ channel: 'monitors:list', args: [] })
    expect(ipcRenderer.calls).toContainEqual({
      channel: 'monitors:set-state',
      args: [7, 'paused'],
    })
    expect(ipcRenderer.calls).toContainEqual({ channel: 'telegram:test-message', args: [] })

    expect(ipcRenderer.invoked).toEqual([
      IPC.bootGet,
      IPC.bootRetry,
      IPC.journalOpen,
      IPC.appExit,
      IPC.telegramStateGet,
      IPC.telegramBindCandidate,
      IPC.telegramTestMessage,
      'monitors:create',
      'monitors:list',
      'monitors:set-state',
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

  it('forwards monitor change ids without Electron event objects and unsubscribes', () => {
    const ipcRenderer = new FakeIpcRenderer()
    const api = createDesktopApi(ipcRenderer)
    const listener = vi.fn()

    expect(IPC.monitorChangedEvent).toBe('monitors:changed')
    expect(api.monitors.onChanged).toBeTypeOf('function')

    const unsubscribe = api.monitors.onChanged(listener)
    ipcRenderer.emitMonitorChanged(7)
    unsubscribe()
    ipcRenderer.emitMonitorChanged(8)

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(7)
  })
})
