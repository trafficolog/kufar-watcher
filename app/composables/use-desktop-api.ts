import type { KufarDesktopApi } from '../../shared/ipc'

export function useDesktopApi(): KufarDesktopApi {
  return window.kufar
}
