import { resolve } from 'node:path'
import { app, BrowserWindow, protocol } from 'electron'
import { APP_HOST, APP_ORIGIN, APP_SCHEME, registerRendererProtocol } from './app-protocol'

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

const devRendererUrl = process.env.KUFAR_RENDERER_URL
const productionOrigin = `${APP_ORIGIN}/`

function isAllowedNavigation(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (devRendererUrl) return url.origin === new URL(devRendererUrl).origin
    return url.protocol === `${APP_SCHEME}:` && url.host === APP_HOST
  } catch {
    return false
  }
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    show: false,
    webPreferences: {
      preload: resolve(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault()
  })
  window.once('ready-to-show', () => window.show())

  void window.loadURL(devRendererUrl ?? productionOrigin)
  return window
}

app.whenReady().then(async () => {
  if (!devRendererUrl) {
    const publicRoot = resolve(__dirname, '../../.output/public')
    await registerRendererProtocol(publicRoot)
  }

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
