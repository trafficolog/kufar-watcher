import { describe, expect, it, vi } from 'vitest'

type BootState = {
  phase: 'starting' | 'ready' | 'error'
  steps: Array<{
    id: 'docker' | 'database' | 'migrations' | 'scheduler' | 'telegram'
    state: 'pending' | 'running' | 'success' | 'skipped' | 'degraded' | 'error'
    detail: string
  }>
}

async function loadIpcRouter(): Promise<Record<string, unknown>> {
  return import('../electron/main/ipc-router').catch(() => ({}))
}

describe('typed IPC routing', () => {
  it('forwards a boot state to the renderer unchanged', async () => {
    const router = await loadIpcRouter()
    const forwardBootState = Reflect.get(router, 'forwardBootState') as
      | ((state: BootState, send: (state: BootState) => void) => void)
      | undefined
    const send = vi.fn()
    const state: BootState = {
      phase: 'starting',
      steps: [{ id: 'scheduler', state: 'running', detail: 'Starting worker' }],
    }

    expect(forwardBootState).toBeTypeOf('function')
    forwardBootState!(state, send)

    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(state)
  })

  it('rejects a renderer sender outside the application origin', async () => {
    const router = await loadIpcRouter()
    const isTrustedRendererUrl = Reflect.get(router, 'isTrustedRendererUrl') as
      | ((url: string, devRendererUrl?: string) => boolean)
      | undefined

    expect(isTrustedRendererUrl).toBeTypeOf('function')
    expect(isTrustedRendererUrl!('app://kufar/settings')).toBe(true)
    expect(isTrustedRendererUrl!('app://other/settings')).toBe(false)
    expect(isTrustedRendererUrl!('https://example.com/settings')).toBe(false)
    expect(isTrustedRendererUrl!('http://127.0.0.1:3000/settings', 'http://127.0.0.1:3000')).toBe(
      true,
    )
    expect(isTrustedRendererUrl!('http://127.0.0.1:3001/settings', 'http://127.0.0.1:3000')).toBe(
      false,
    )
  })
})
