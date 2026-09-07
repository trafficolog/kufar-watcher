import type { KufarDesktopApi } from '../../shared/ipc'

declare global {
  interface Window {
    kufar: KufarDesktopApi
  }
}

export {}
