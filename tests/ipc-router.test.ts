import { describe, expect, it, vi } from 'vitest'
import {
  forwardBootState,
  isTrustedRendererUrl,
  markWorkerBootFailed,
  registerMonitorIpcHandlers,
  registerSystemIpcHandlers,
  registerTelegramIpcHandlers,
  routeWorkerBootEvent,
  routeWorkerTelegramEvent,
} from '../electron/main/ipc-router'
import { IPC, type BootState, type MonitorCreateInput } from '../shared/ipc'
import type { TelegramDesktopState } from '../shared/telegram'

type FakeInvokeEvent = {
  senderFrame: { url: string } | null
}

type FakeInvokeHandler = (event: FakeInvokeEvent, ...args: unknown[]) => unknown

class FakeIpcMain {
  handlers = new Map<string, FakeInvokeHandler>()

  handle(channel: string, handler: FakeInvokeHandler): void {
    this.handlers.set(channel, handler)
  }

  async invoke(channel: string, url: string, ...args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(channel)
    if (!handler) throw new Error(`Missing handler for ${channel}`)
    return handler({ senderFrame: { url } }, ...args)
  }
}

describe('typed IPC routing', () => {
  it('forwards a boot state to the renderer unchanged', () => {
    const send = vi.fn()
    const state: BootState = {
      phase: 'starting',
      steps: [{ id: 'scheduler', state: 'running', detail: 'Starting worker' }],
    }

    forwardBootState(state, send)

    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(state)
  })

  it('routes worker readiness to the renderer boot state without changing other steps', () => {
    const send = vi.fn()
    const state: BootState = {
      phase: 'starting',
      steps: [
        { id: 'docker', state: 'pending', detail: 'Not started' },
        { id: 'scheduler', state: 'running', detail: 'Starting worker' },
      ],
    }

    const nextState = routeWorkerBootEvent({ type: 'ready' }, state, send)

    expect(nextState).toEqual({
      phase: 'starting',
      steps: [
        { id: 'docker', state: 'pending', detail: 'Not started' },
        { id: 'scheduler', state: 'success', detail: 'Worker ready' },
      ],
    })
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(nextState)

    const unchanged = routeWorkerBootEvent(
      { type: 'journal', level: 'info', message: 'Worker note' },
      nextState,
      send,
    )
    expect(unchanged).toBe(nextState)
    expect(send).toHaveBeenCalledOnce()
  })

  it('surfaces a fatal worker failure to the renderer', () => {
    const send = vi.fn()
    const state: BootState = {
      phase: 'starting',
      steps: [
        { id: 'docker', state: 'pending', detail: 'Not started' },
        { id: 'scheduler', state: 'success', detail: 'Worker ready' },
      ],
    }

    const nextState = markWorkerBootFailed(state, 'Worker failed more than three times', send)

    expect(nextState).toEqual({
      phase: 'error',
      errorCode: 'worker-failed',
      steps: [
        { id: 'docker', state: 'pending', detail: 'Not started' },
        { id: 'scheduler', state: 'error', detail: 'Worker failed more than three times' },
      ],
    })
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(nextState)
  })

  it('projects Telegram runtime and candidate worker events without exposing a token', () => {
    const send = vi.fn()
    const initial: TelegramDesktopState = {
      runtime: 'waiting-for-binding',
      channel: 'connected',
      boundChatId: null,
      candidate: null,
      secret: 'protected',
    }

    const withCandidate = routeWorkerTelegramEvent(
      {
        type: 'telegram-candidate',
        candidate: {
          chatId: '1001',
          chatType: 'private',
          displayName: 'Owner',
          username: 'owner',
        },
      },
      initial,
      send,
    )
    const ready = routeWorkerTelegramEvent(
      { type: 'telegram-state', state: 'ready', boundChatId: '1001' },
      withCandidate,
      send,
    )

    expect(withCandidate.candidate?.chatId).toBe('1001')
    expect(ready).toEqual({
      runtime: 'ready',
      channel: 'connected',
      boundChatId: '1001',
      candidate: withCandidate.candidate,
      secret: 'protected',
    })
    expect(JSON.stringify(ready)).not.toContain('token')
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith(ready)
  })

  it('ignores non-Telegram worker events for Telegram desktop state', () => {
    const send = vi.fn()
    const state: TelegramDesktopState = {
      runtime: 'not-configured',
      channel: 'disconnected',
      boundChatId: null,
      candidate: null,
      secret: 'missing',
    }

    expect(routeWorkerTelegramEvent({ type: 'ready' }, state, send)).toBe(state)
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects a renderer sender outside the application origin', () => {
    const devRendererUrl = 'http://127.0.0.1:3000'
    const trustedDevUrl = `${devRendererUrl}/settings`
    const untrustedDevUrl = 'http://127.0.0.1:3001/settings'

    expect(isTrustedRendererUrl('app://kufar/settings')).toBe(true)
    expect(isTrustedRendererUrl('app://other/settings')).toBe(false)
    expect(isTrustedRendererUrl('https://example.com/settings')).toBe(false)
    expect(isTrustedRendererUrl(trustedDevUrl, devRendererUrl)).toBe(true)
    expect(isTrustedRendererUrl(untrustedDevUrl, devRendererUrl)).toBe(false)
  })

  it('rejects untrusted senders before every renderer service call', async () => {
    const ipcMain = new FakeIpcMain()
    const bootState: BootState = { phase: 'starting', steps: [] }
    const services = {
      getBootState: vi.fn(() => bootState),
      retryBoot: vi.fn(),
      openJournal: vi.fn(),
      exit: vi.fn(),
    }
    const devRendererUrl = 'http://127.0.0.1:3000'

    registerSystemIpcHandlers(ipcMain, services, devRendererUrl)

    const handlers = [
      [IPC.bootGet, services.getBootState],
      [IPC.bootRetry, services.retryBoot],
      [IPC.journalOpen, services.openJournal],
      [IPC.appExit, services.exit],
    ] as const

    for (const [channel, service] of handlers) {
      await expect(ipcMain.invoke(channel, 'https://example.com')).rejects.toThrow(
        'Untrusted renderer',
      )
      expect(service).not.toHaveBeenCalled()
    }

    await expect(ipcMain.invoke(IPC.bootGet, `${devRendererUrl}/settings`)).resolves.toEqual(
      bootState,
    )
    expect(services.getBootState).toHaveBeenCalledOnce()
  })

  it('exposes Telegram state and binding only to trusted renderer callers', async () => {
    const ipcMain = new FakeIpcMain()
    const state: TelegramDesktopState = {
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
    const services = {
      getTelegramState: vi.fn(() => state),
      bindTelegramCandidate: vi.fn(async () => 'bound' as const),
    }
    const devRendererUrl = 'http://127.0.0.1:3000'

    registerTelegramIpcHandlers(ipcMain, services, devRendererUrl)

    await expect(ipcMain.invoke(IPC.telegramStateGet, 'https://example.com')).rejects.toThrow(
      'Untrusted renderer',
    )
    await expect(ipcMain.invoke(IPC.telegramBindCandidate, 'https://example.com')).rejects.toThrow(
      'Untrusted renderer',
    )
    expect(services.getTelegramState).not.toHaveBeenCalled()
    expect(services.bindTelegramCandidate).not.toHaveBeenCalled()

    await expect(
      ipcMain.invoke(IPC.telegramStateGet, `${devRendererUrl}/settings`),
    ).resolves.toEqual(state)
    await expect(
      ipcMain.invoke(IPC.telegramBindCandidate, `${devRendererUrl}/settings`),
    ).resolves.toBe('bound')
    expect(services.bindTelegramCandidate).toHaveBeenCalledWith()
  })

  it('routes monitor creation only for trusted renderer callers', async () => {
    const ipcMain = new FakeIpcMain()
    const createMonitor = vi.fn(async (_input: MonitorCreateInput) => ({ monitorId: 17 }))
    const devRendererUrl = 'http://127.0.0.1:3000'
    const input: MonitorCreateInput = {
      name: 'PS5 Минск',
      sourceUrl: 'https://www.kufar.by/l/igry-i-pristavki/r~minsk/q~playstation',
      intervalSec: 300,
      include: ['ps5', 'playstation*'],
      exclude: ['ремонт'],
    }

    registerMonitorIpcHandlers(ipcMain, { createMonitor }, devRendererUrl)

    await expect(ipcMain.invoke(IPC.monitorCreate, 'https://example.com', input)).rejects.toThrow(
      'Untrusted renderer',
    )
    expect(createMonitor).not.toHaveBeenCalled()

    await expect(
      ipcMain.invoke(IPC.monitorCreate, `${devRendererUrl}/monitors`, input),
    ).resolves.toEqual({ monitorId: 17 })
    expect(createMonitor).toHaveBeenCalledOnce()
    expect(createMonitor).toHaveBeenCalledWith(input)
  })
})
