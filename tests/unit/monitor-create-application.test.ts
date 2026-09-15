import { describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import { createLocalMonitorRunLeaseAcquirer } from '../../electron/worker/monitor-run-lease'
import type { MonitorScheduler } from '../../electron/worker/monitor-scheduler'
import type { TelegramBotService } from '../../electron/worker/telegram-bot-service'
import type { WorkerSourceRuntime } from '../../electron/worker/worker-source-runtime'
import {
  createWorkerApplication,
  type WorkerApplicationDependencies,
} from '../../electron/worker/worker-application'
import type { MonitorCreateInput, MonitorCreateResult } from '../../shared/ipc'

interface MonitorCreateApplication {
  createMonitor(input: MonitorCreateInput): Promise<MonitorCreateResult>
}

describe('monitor create worker application', () => {
  it('uses the application Prisma client and scheduler for monitor creation', async () => {
    const create = vi.fn(async () => ({ id: 17 }))
    const prisma = {
      monitor: { create },
      $disconnect: vi.fn(async () => undefined),
    } as unknown as PrismaClient
    const scheduler = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      syncMonitor: vi.fn(async () => undefined),
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
    const createMonitor = Reflect.get(app, 'createMonitor') as
      MonitorCreateApplication['createMonitor'] | undefined
    const input: MonitorCreateInput = {
      name: 'PS5 Minsk',
      sourceUrl: 'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~playstation',
      intervalSec: 300,
      include: ['ps5'],
      exclude: ['repair'],
    }

    expect(createMonitor).toBeTypeOf('function')
    await expect(createMonitor!(input)).resolves.toEqual({ monitorId: 17 })
    expect(create).toHaveBeenCalledOnce()
    expect(scheduler.syncMonitor).toHaveBeenCalledWith(17)
  })
})
