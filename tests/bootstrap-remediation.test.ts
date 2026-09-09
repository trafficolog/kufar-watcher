import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildBootScreenModel } from '../app/lib/boot-screen-model'
import { readPostgresRuntimeConfig } from '../electron/main/postgres-config'
import type { BootState } from '../shared/ipc'

interface PostgresCredentials {
  user: string
  password: string
  database: string
}

type LoadOrCreateCredentials = (
  userDataDir: string,
  generatePassword?: () => string,
) => PostgresCredentials

type RunVisibleBootstrap = (input: {
  createWindow(): void
  initialize(): Promise<void>
  onUnexpectedFailure(error: unknown): void
}) => Promise<void>

type InstallUnhandledRejectionHandler = (
  target: {
    on(event: 'unhandledRejection', listener: (reason: unknown) => void): void
  },
  onUnexpectedFailure: (reason: unknown) => void,
) => void

type OpenRawResponseJournal = (
  shell: { openPath(path: string): Promise<string> },
  userDataDir: string,
) => Promise<void>

const temporaryDirectories: string[] = []

function createTemporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'kufar-bootstrap-'))
  temporaryDirectories.push(path)
  return path
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const path = temporaryDirectories.pop()
    if (path) rmSync(path, { recursive: true, force: true })
  }
})

describe('packaged bootstrap remediation', () => {
  it('uses persisted credentials when packaged runtime environment omits Postgres secrets', () => {
    const config = readPostgresRuntimeConfig(
      {},
      {
        user: 'kufar',
        password: 'generated-secret',
        database: 'kufar',
      },
    )

    expect(config.container.user).toBe('kufar')
    expect(config.container.password).toBe('generated-secret')
    expect(config.container.database).toBe('kufar')
    expect(config.databaseUrl).toContain('generated-secret@127.0.0.1:5432/kufar')
  })

  it('creates a restrictive first-run Postgres credential file and reuses it', async () => {
    const module = await import('../electron/main/postgres-config')
    const exported: unknown = Reflect.get(module, 'loadOrCreatePostgresCredentials')
    expect(typeof exported).toBe('function')
    if (typeof exported !== 'function') return

    const loadOrCreate = exported as LoadOrCreateCredentials
    const userDataDir = createTemporaryDirectory()

    const first = loadOrCreate(userDataDir, () => 'first-generated-secret')
    const second = loadOrCreate(userDataDir, () => 'must-not-replace-secret')

    expect(first).toEqual({
      user: 'kufar',
      password: 'first-generated-secret',
      database: 'kufar',
    })
    expect(second).toEqual(first)
    expect(readdirSync(userDataDir)).toContain('postgres-credentials.json')
    expect(statSync(join(userDataDir, 'postgres-credentials.json')).mode & 0o777).toBe(0o600)
  })

  it('creates the window before initialization and surfaces unexpected initialization failures', async () => {
    const module = await import('../electron/main/infrastructure-bootstrap')
    const exported: unknown = Reflect.get(module, 'runVisibleBootstrap')
    expect(typeof exported).toBe('function')
    if (typeof exported !== 'function') return

    const runVisibleBootstrap = exported as RunVisibleBootstrap
    const order: string[] = []
    const failure = new Error('configuration failed')
    const onUnexpectedFailure = vi.fn()

    await runVisibleBootstrap({
      createWindow: () => order.push('window'),
      initialize: async () => {
        order.push('initialize')
        throw failure
      },
      onUnexpectedFailure,
    })

    expect(order).toEqual(['window', 'initialize'])
    expect(onUnexpectedFailure).toHaveBeenCalledOnce()
    expect(onUnexpectedFailure).toHaveBeenCalledWith(failure)
  })

  it('routes unhandled rejections into the same visible boot failure path', async () => {
    const module = await import('../electron/main/infrastructure-bootstrap')
    const exported: unknown = Reflect.get(module, 'installUnhandledRejectionHandler')
    expect(typeof exported).toBe('function')
    if (typeof exported !== 'function') return

    const installUnhandledRejectionHandler = exported as InstallUnhandledRejectionHandler
    let listener: ((reason: unknown) => void) | undefined
    const target = {
      on(_event: 'unhandledRejection', next: (reason: unknown) => void): void {
        listener = next
      },
    }
    const onUnexpectedFailure = vi.fn()

    installUnhandledRejectionHandler(target, onUnexpectedFailure)
    const failure = new Error('unhandled')
    listener?.(failure)

    expect(onUnexpectedFailure).toHaveBeenCalledOnce()
    expect(onUnexpectedFailure).toHaveBeenCalledWith(failure)
  })

  it('opens the real raw-response journal directory and propagates shell failures', async () => {
    const module = await import('../electron/main/worker-storage')
    const exported: unknown = Reflect.get(module, 'openRawResponseJournal')
    expect(typeof exported).toBe('function')
    if (typeof exported !== 'function') return

    const openRawResponseJournal = exported as OpenRawResponseJournal
    const userDataDir = createTemporaryDirectory()
    const openedPaths: string[] = []

    await openRawResponseJournal(
      {
        async openPath(path: string): Promise<string> {
          openedPaths.push(path)
          return ''
        },
      },
      userDataDir,
    )

    const expectedPath = join(userDataDir, 'raw-responses')
    expect(openedPaths).toEqual([expectedPath])
    expect(statSync(expectedPath).isDirectory()).toBe(true)

    await expect(
      openRawResponseJournal(
        {
          async openPath(): Promise<string> {
            return 'desktop shell refused the path'
          },
        },
        userDataDir,
      ),
    ).rejects.toThrow('desktop shell refused the path')
  })

  it('shows actionable errors for invalid configuration and unexpected startup failures', () => {
    const invalidConfiguration = buildBootScreenModel(
      {
        phase: 'error',
        steps: [],
        errorCode: 'configuration-invalid',
      } as unknown as BootState,
      'linux',
    )
    const unexpectedFailure = buildBootScreenModel(
      {
        phase: 'error',
        steps: [],
        errorCode: 'unexpected-failure',
      } as unknown as BootState,
      'linux',
    )

    expect(invalidConfiguration.error?.heading).toBe('Не удалось подготовить локальную базу')
    expect(unexpectedFailure.error?.heading).toBe('Непредвиденная ошибка запуска')
  })
})
