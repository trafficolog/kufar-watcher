import { describe, expect, it, vi } from 'vitest'

import { registerTelegramIpcHandlers } from '../../electron/main/ipc-router'
import { createDesktopApi } from '../../electron/preload/desktop-api'
import { IPC } from '../../shared/ipc'

class FakeIpcRenderer {
  calls: Array<{ channel: string; args: unknown[] }> = []

  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    this.calls.push({ channel, args })
    if (channel === 'telegram:token:verify') return { username: 'kufar_watch_bot' }
    if (channel === 'telegram:token:save') return { state: 'protected' }
    return undefined
  }

  on(): void {}
  removeListener(): void {}
}

type FakeInvokeEvent = { senderFrame: { url: string } | null }
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

describe('Telegram setup IPC contract', () => {
  it('exposes fixed preload methods for verify and save without altering the token', async () => {
    expect(Reflect.get(IPC, 'telegramTokenVerify')).toBe('telegram:token:verify')
    expect(Reflect.get(IPC, 'telegramTokenSave')).toBe('telegram:token:save')

    const ipcRenderer = new FakeIpcRenderer()
    const api = createDesktopApi(ipcRenderer)
    const verifyToken = Reflect.get(api.telegram, 'verifyToken')
    const saveToken = Reflect.get(api.telegram, 'saveToken')
    expect(verifyToken).toBeTypeOf('function')
    expect(saveToken).toBeTypeOf('function')

    const token = 'SECRET_SENTINEL_5_0_2_IPC'
    await expect(Reflect.apply(verifyToken, api.telegram, [token])).resolves.toEqual({
      username: 'kufar_watch_bot',
    })
    await expect(Reflect.apply(saveToken, api.telegram, [token, false])).resolves.toEqual({
      state: 'protected',
    })
    expect(ipcRenderer.calls).toEqual([
      { channel: 'telegram:token:verify', args: [token] },
      { channel: 'telegram:token:save', args: [token, false] },
    ])
  })

  it('guards verify and save handlers before delegating to main services', async () => {
    const ipcMain = new FakeIpcMain()
    const verifyTelegramToken = vi.fn(async (_token: string) => ({ username: 'kufar_watch_bot' }))
    const saveTelegramToken = vi.fn(async (_token: string, _allowUnprotected: boolean) => ({
      state: 'protected' as const,
    }))
    const services = {
      getTelegramState: vi.fn(() => ({
        runtime: 'not-configured' as const,
        channel: 'disconnected' as const,
        boundChatId: null,
        candidate: null,
        secret: 'missing' as const,
      })),
      bindTelegramCandidate: vi.fn(async () => 'no-candidate' as const),
      verifyTelegramToken,
      saveTelegramToken,
    }
    const devRendererUrl = 'http://127.0.0.1:3000'

    registerTelegramIpcHandlers(ipcMain, services, devRendererUrl)

    expect(ipcMain.handlers.has('telegram:token:verify')).toBe(true)
    expect(ipcMain.handlers.has('telegram:token:save')).toBe(true)

    await expect(
      ipcMain.invoke('telegram:token:verify', 'https://example.com', 'SECRET'),
    ).rejects.toThrow('Untrusted renderer')
    await expect(
      ipcMain.invoke('telegram:token:save', 'https://example.com', 'SECRET', true),
    ).rejects.toThrow('Untrusted renderer')
    expect(verifyTelegramToken).not.toHaveBeenCalled()
    expect(saveTelegramToken).not.toHaveBeenCalled()

    await expect(
      ipcMain.invoke('telegram:token:verify', `${devRendererUrl}/settings`, 'TOKEN'),
    ).resolves.toEqual({ username: 'kufar_watch_bot' })
    await expect(
      ipcMain.invoke('telegram:token:save', `${devRendererUrl}/settings`, 'TOKEN', true),
    ).resolves.toEqual({ state: 'protected' })
    expect(verifyTelegramToken).toHaveBeenCalledWith('TOKEN')
    expect(saveTelegramToken).toHaveBeenCalledWith('TOKEN', true)
  })
})
