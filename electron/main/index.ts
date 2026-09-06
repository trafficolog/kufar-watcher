import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { app, BrowserWindow, ipcMain, protocol, utilityProcess } from 'electron'
import { IPC, type BootState } from '../../shared/ipc'
import workerPath from '../worker/index?modulePath'
import { APP_HOST, APP_ORIGIN, APP_SCHEME, registerRendererProtocol } from './app-protocol'
import { createBootstrapRetryController } from './bootstrap-retry'
import { createDockerClient } from './docker-client'
import { createDockerodePostgresRuntime } from './dockerode-postgres-adapter'
import { runInfrastructureBootstrap } from './infrastructure-bootstrap'
import { createInfrastructureBootstrapDependencies } from './infrastructure-runtime'
import {
  forwardBootState,
  markWorkerBootFailed,
  registerSystemIpcHandlers,
  routeWorkerBootEvent,
} from './ipc-router'
import { readPostgresRuntimeConfig } from './postgres-config'
import { createWorkerSupervisor, type WorkerSupervisor } from './worker-supervisor'

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
let workerSupervisor: WorkerSupervisor | undefined
let quitAfterWorkerShutdown = false
let bootState: BootState = {
  phase: 'starting',
  steps: [],
}

function loadDevelopmentEnvironment(): void {
  if (app.isPackaged || !existsSync('.env')) return
  process.loadEnvFile('.env')
}

function isAllowedNavigation(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (devRendererUrl) return url.origin === new URL(devRendererUrl).origin
    return url.protocol === `${APP_SCHEME}:` && url.host === APP_HOST
  } catch {
    return false
  }
}

function sendBootState(window: BrowserWindow, state: BootState): void {
  forwardBootState(state, (payload) => window.webContents.send(IPC.bootEvent, payload))
}

function broadcastBootState(state: BootState): void {
  for (const window of BrowserWindow.getAllWindows()) sendBootState(window, state)
}

function publishBootState(state: BootState): void {
  bootState = state
  broadcastBootState(state)
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
  window.webContents.on('did-finish-load', () => sendBootState(window, bootState))
  window.once('ready-to-show', () => window.show())

  void window.loadURL(devRendererUrl ?? productionOrigin)
  return window
}

app.whenReady().then(async () => {
  if (!devRendererUrl) {
    const publicRoot = resolve(__dirname, '../../.output/public')
    await registerRendererProtocol(publicRoot)
  }

  loadDevelopmentEnvironment()

  const supervisor = createWorkerSupervisor({
    spawnWorker: () =>
      utilityProcess.fork(workerPath, [], {
        serviceName: 'Kufar Monitor Worker',
      }),
    onEvent: (event) => {
      bootState = routeWorkerBootEvent(event, bootState, broadcastBootState)
      if (event.type === 'ready') console.info('[worker] ready')
      if (event.type === 'journal') {
        console.info(`[worker:${event.level}] ${event.message}`)
      }
    },
    onFatal: (message) => {
      bootState = markWorkerBootFailed(bootState, message, broadcastBootState)
      console.error(`[worker:fatal] ${message}`)
    },
  })
  workerSupervisor = supervisor

  const config = readPostgresRuntimeConfig()
  const runtime = createDockerodePostgresRuntime(createDockerClient())
  const bootstrapDependencies = createInfrastructureBootstrapDependencies({
    runtime,
    config,
    startWorker: () => supervisor.start(),
    publishBootState,
  })
  const runBootstrap = async (): Promise<void> => {
    bootState = await runInfrastructureBootstrap(bootstrapDependencies)
  }
  const retryController = createBootstrapRetryController({
    getState: () => bootState,
    runBootstrap,
  })

  registerSystemIpcHandlers(
    ipcMain,
    {
      getBootState: () => bootState,
      retryBoot: () => retryController.retry(),
      openJournal: () => {
        throw new Error('Journal is unavailable until the journal service is implemented')
      },
      exit: () => app.quit(),
    },
    devRendererUrl,
  )

  createMainWindow()
  await runBootstrap()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('before-quit', (event) => {
  if (quitAfterWorkerShutdown || !workerSupervisor) return

  event.preventDefault()
  quitAfterWorkerShutdown = true
  void workerSupervisor.shutdown().finally(() => app.quit())
})
