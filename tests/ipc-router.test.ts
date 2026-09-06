import { describe, expect, it, vi } from 'vitest'
import { forwardBootState, isTrustedRendererUrl } from '../electron/main/ipc-router'
import type { BootState } from '../shared/ipc'

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

  it('rejects a renderer sender outside the application origin', () => {
    expect(isTrustedRendererUrl('app://kufar/settings')).toBe(true)
    expect(isTrustedRendererUrl('app://other/settings')).toBe(false)
    expect(isTrustedRendererUrl('https://example.com/settings')).toBe(false)
    expect(
      isTrustedRendererUrl('http://127.0.0.1:3000/settings', 'http://127.0.0.1:3000'),
    ).toBe(true)
    expect(
      isTrustedRendererUrl('http://127.0.0.1:3001/settings', 'http://127.0.0.1:3000'),
    ).toBe(false)
  })
})
