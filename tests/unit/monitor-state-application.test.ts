import { describe, expect, it, vi } from 'vitest'

import type { Prisma, PrismaClient } from '../../generated/prisma/client'
import { createLocalMonitorRunLeaseAcquirer } from '../../electron/worker/monitor-run-lease'
import type { MonitorScheduler } from '../../electron/worker/monitor-scheduler'
import type { TelegramBotService } from '../../electron/worker/telegram-bot-service'
import type { WorkerSourceRuntime } from '../../electron/worker/worker-source-runtime'
import {
  createWorkerApplication,
  type WorkerApplicationDependencies,
} from '../../electron/worker/worker-application'

const persistedQuery = {
  host: 'www.kufar.by',
  category: 'igry-i-pristavki',
  query: null,
  region: 'minsk',
  sellerType: null,
  sort: 'lst.d',
  operation: null,
  pathFilters: [],
  extraParams: {},
}

interface MonitorStateApplication {
  setMonitorState(monitorId: number, state: 'active' | 'paused'): Promise<void>
}

describe('monitor state worker application', () => {
  it('persists pause before reconciling the monitor schedule', async () => {
    const events: string[] = []
    const update = vi.fn(async () => {
      events.push('transaction-update')
      return undefined
    })
    const tx = {
      monitor: {
        findUniqueOrThrow: vi.fn(async () => ({
          sourceUrl: 'https://www.kufar.by/l/r~minsk/igry-i-pristavki',
          query: persistedQuery,
          state: 'active' as const,
        })),
        update,
      },
      monitorCursor: {
        deleteMany: vi.fn(async () => undefined),
      },
    } as unknown as Prisma.TransactionClient
    const prisma = {
      $transaction: vi.fn(async (callback: (client: Prisma.TransactionClient) => Promise<void>) => {
        await callback(tx)
        events.push('transaction-commit')
      }),
      $disconnect: vi.fn(async () => undefined),
    } as unknown as PrismaClient
    const scheduler = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      syncMonitor: vi.fn(async (monitorId: number) => {
        events.push(`sync:${monitorId}`)
      }),
    } as unknown as MonitorScheduler
    const sourceRuntime = {
      createRunAdapters: vi.fn(() => ({})),
      descriptionLoader: { ensureDescription: vi.fn() },
      close: vi.fn(async () => undefined),
    } as unknown as WorkerSourceRuntime
    const telegram = {
      configure: vi.fn(async () => undefined),
      resume: vi.fn(async () => undefined),
      bindCandidate: vi.fn(async () => 'bound' as const),
      sendTestMessage: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => undefined),
      getState: vi.fn(() => 'not-configured' as const),
      getCandidate: vi.fn(() => null),
      getBoundChatId: vi.fn(() => null),
      stop: vi.fn(async () => undefined),
    } as TelegramBotService
    const outbox = {
      start: vi.fn(async () => undefined),
      enqueue: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }
    const dependencies = {
      createPrismaClient: () => prisma,
      createQueue: () => ({}),
      createRepository: () => ({}),
      createSourceRuntime: () => sourceRuntime,
      createRunExecutor: () => vi.fn(async () => ({ status: 'completed' })),
      createScheduler: () => scheduler,
      createRunRecoveryLeaseAcquirer: () => createLocalMonitorRunLeaseAcquirer(),
      createTelegramRepository: () => ({}),
      createTelegramBotFactory: () => ({}),
      createTelegramBotService: () => telegram,
      createTelegramOutboxQueue: () => outbox,
      createTelegramOutboxDeliveryRepository: () => ({}),
      createTelegramOutboxDelivery: () => vi.fn(async () => undefined),
    } as unknown as WorkerApplicationDependencies
    const app = createWorkerApplication(
      {
        databaseUrl: 'postgresql://fixture',
        rawResponseJournalDir: '/tmp/kufar-journal',
        monitorMaxPages: 5,
      },
      vi.fn(),
      dependencies,
    )
    const setMonitorState = Reflect.get(app, 'setMonitorState') as
      | MonitorStateApplication['setMonitorState']
      | undefined

    expect(setMonitorState).toBeTypeOf('function')
    await setMonitorState!(7, 'paused')

    expect(update).toHaveBeenCalledWith({ where: { id: 7 }, data: { state: 'paused' } })
    expect(events).toEqual(['transaction-update', 'transaction-commit', 'sync:7'])
  })
})
