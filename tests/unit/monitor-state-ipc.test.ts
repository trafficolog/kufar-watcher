import { describe, expect, it, vi } from 'vitest'

import { registerMonitorIpcHandlers } from '../../electron/main/ipc-router'
import type { MonitorCreateInput } from '../../shared/ipc'

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

describe('monitor state IPC route', () => {
  it('updates monitor state only for trusted renderer callers', async () => {
    const ipcMain = new FakeIpcMain()
    const setMonitorState = vi.fn(
      async (_monitorId: number, _state: 'active' | 'paused') => undefined,
    )
    const services = {
      createMonitor: vi.fn(async (_input: MonitorCreateInput) => ({ monitorId: 17 })),
      listMonitors: vi.fn(async () => []),
      setMonitorState,
    }
    const devRendererUrl = 'http://127.0.0.1:3000'

    registerMonitorIpcHandlers(ipcMain, services, devRendererUrl)

    await expect(
      ipcMain.invoke('monitors:set-state', 'https://example.com', 7, 'paused'),
    ).rejects.toThrow('Untrusted renderer')
    expect(setMonitorState).not.toHaveBeenCalled()

    await expect(
      ipcMain.invoke('monitors:set-state', `${devRendererUrl}/monitors`, 7, 'paused'),
    ).resolves.toBeUndefined()
    expect(setMonitorState).toHaveBeenCalledOnce()
    expect(setMonitorState).toHaveBeenCalledWith(7, 'paused')
  })
})
