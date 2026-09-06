import type { BootState } from '../../shared/ipc'
import { APP_HOST, APP_SCHEME } from './app-protocol'

export function forwardBootState(state: BootState, send: (state: BootState) => void): void {
  send(state)
}

export function isTrustedRendererUrl(rawUrl: string, devRendererUrl?: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (devRendererUrl) return url.origin === new URL(devRendererUrl).origin
    return url.protocol === `${APP_SCHEME}:` && url.host === APP_HOST
  } catch {
    return false
  }
}
