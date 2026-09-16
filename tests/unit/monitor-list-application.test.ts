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

describe('monitor list worker application', () => {
  it('returns non-archived monitors, exact source/filter settings and the latest run only', async () => {
    const sourceUrl = 'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5'
    const findMany = vi.fn(async () => [
      {
        id: 7,
        name: 'PS5 Minsk',
        sourceUrl,
        keywords: { include: ['ps5', 'playstation*'], exclude: ['ремонт'] },
        intervalSec: 300,
        state: 'active' as const,
        runs: [
          {
            startedAt: new Date('2026-09-15T10:00:00.000Z'),
            finishedAt: new Date('2026-09-15T10:00:04.000Z'),
            outcome: 'completed',
            errorCategory: null,
            errorCode: null,
          },
        ],
      },
    ])
    const prisma = {
      monitor: { findMany },
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

    expect(app.listMonitors).toBeTypeOf('function')
    await expect(app.listMonitors()).resolves.toEqual([
      {
        id: 7,
        name: 'PS5 Minsk',
        sourceUrl,
        include: ['ps5', 'playstation*'],
        exclude: ['ремонт'],
        intervalSec: 300,
        state: 'active',
        lastRun: {
          startedAt: '2026-09-15T10:00:00.000Z',
          finishedAt: '2026-09-15T10:00:04.000Z',
          outcome: 'completed',
          errorCategory: null,
          errorCode: null,
        },
      },
    ])
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { state: { not: 'archived' } },
        orderBy: { id: 'asc' },
        select: expect.objectContaining({ sourceUrl: true, keywords: true }),
      }),
    )
  })
})
