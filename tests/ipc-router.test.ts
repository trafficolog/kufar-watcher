import { describe, expect, it, vi } from 'vitest'
import {
  forwardBootState,
  isTrustedRendererUrl,
  markWorkerBootFailed,
  registerSystemIpcHandlers,
  routeWorkerBootEvent,
} from '../electron/main/ipc-router'
import { IPC, type BootState } from '../shared/ipc'

type FakeInvokeEvent = {
  senderFrame: { url: string } | null
}

type FakeInvokeHandler = (event: FakeInvokeEvent) => unknown

class FakeIpcMain {
  handlers = new Map<string, FakeInvokeHandler>()

  handle(channel: string, handler: FakeInvokeHandler): void {
    this.handlers.set(channel, handler)
  }

  async invoke(channel: string, url: string): Promise<unknown> {
    const handler = this.handlers.get(channel)
    if (!handler) throw new Error(`Missing handler for ${channel}`)
    return handler({ senderFrame: { url } })
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
})
