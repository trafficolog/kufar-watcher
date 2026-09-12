import { describe, expect, it, vi } from 'vitest'

import { DescriptionRequestBudgetExceededError } from '../../electron/worker/description-request-budget'
import { createScheduledMonitorRunExecutor } from '../../electron/worker/scheduled-monitor-run'
import { KufarSourceRequestError } from '../../electron/worker/kufar-source-request-error'
import type { PrismaClient } from '../../generated/prisma/client'
import type { SourceAdapter } from '../../shared/source-adapter'
import { createSourceAdapterRegistry } from '../../shared/source-adapter-registry'

const persistedQuery = {
  host: 'www.kufar.by',
  category: 'igry-i-pristavki',
  query: null,
  region: null,
  sellerType: null,
  sort: 'lst.d',
  operation: null,
  pathFilters: [],
  extraParams: {},
}

function executorDependencies() {
  const runUpdate = vi.fn().mockResolvedValue(undefined)
  const prisma = {
    monitor: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ query: persistedQuery }),
    },
    run: {
      create: vi.fn().mockResolvedValue({ id: 9001 }),
      update: runUpdate,
    },
  } as unknown as PrismaClient
  const electronicsAdapter = { fetchPage: vi.fn() } as unknown as SourceAdapter
  const realEstateAdapter = { fetchPage: vi.fn() } as unknown as SourceAdapter
  const adapters = createSourceAdapterRegistry({
    electronics: electronicsAdapter,
    'real-estate': realEstateAdapter,
  })
  const createRunAdapters = vi.fn(() => adapters)
  const descriptionLoader = { ensureDescription: vi.fn() }

  return { prisma, runUpdate, createRunAdapters, descriptionLoader }
}

const transientFailures = [
  new KufarSourceRequestError('network failed', {
    ok: false,
    kind: 'temporary',
    code: 'network',
    status: null,
    attempts: 3,
    message: 'Kufar request failed due to a temporary network error',
  }),
  new KufarSourceRequestError('timeout failed', {
    ok: false,
    kind: 'temporary',
    code: 'timeout',
    status: null,
    attempts: 3,
    message: 'Kufar request timed out after bounded retries',
  }),
  new KufarSourceRequestError('http 5xx failed', {
    ok: false,
    kind: 'temporary',
    code: 'http-5xx',
    status: 503,
    attempts: 3,
    message: 'Kufar returned HTTP 503 after bounded retries',
  }),
]

describe('description budget terminal disposition', () => {
  it('treats description budget exhaustion as a terminal failed-no-retry run', async () => {
    const { prisma, runUpdate, createRunAdapters, descriptionLoader } = executorDependencies()
    const failure = new DescriptionRequestBudgetExceededError()
    const runCycle = vi.fn().mockRejectedValue(failure)
    const executor = createScheduledMonitorRunExecutor({
      prisma,
      createRunAdapters,
      maxPages: 5,
      descriptionLoader,
      runCycle: runCycle as never,
    })

    await expect(executor(17)).resolves.toEqual({ cycleKind: 'failed-no-retry' })

    expect(runCycle).toHaveBeenCalledTimes(1)
    expect(runUpdate).toHaveBeenCalledWith({
      where: { id: 9001 },
      data: {
        finishedAt: expect.any(Date),
        durationMs: expect.any(Number),
        outcome: 'error',
        seen: 0,
        matched: 0,
        error: 'Listing detail request budget exhausted',
        errorCategory: 'policy',
        errorCode: 'description-budget-exhausted',
        httpStatus: null,
      },
    })
  })

  it.each(transientFailures)(
    'keeps %s retryable by rejecting the scheduled run',
    async (failure) => {
      const { prisma, createRunAdapters, descriptionLoader } = executorDependencies()
      const runCycle = vi.fn().mockRejectedValue(failure)
      const executor = createScheduledMonitorRunExecutor({
        prisma,
        createRunAdapters,
        maxPages: 5,
        descriptionLoader,
        runCycle: runCycle as never,
      })

      await expect(executor(17)).rejects.toBe(failure)
      expect(runCycle).toHaveBeenCalledTimes(1)
    },
  )
})
