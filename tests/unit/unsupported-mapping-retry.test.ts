import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../generated/prisma/client'
import { createScheduledMonitorRunExecutor } from '../../electron/worker/scheduled-monitor-run'
import { KufarUrlBuildError } from '../../shared/kufar-url'

const unsupportedQuery = {
  host: 'www.kufar.by',
  category: 'igry-i-pristavki',
  query: 'ps5',
  region: 'gomel',
  sellerType: null,
  sort: 'lst.d',
  operation: null,
  pathFilters: [],
  extraParams: {},
}

describe('legacy unsupported Kufar mapping', () => {
  it('records one policy failure and completes without rethrowing for pg-boss', async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    const prisma = {
      monitor: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          query: unsupportedQuery,
          state: 'active',
        }),
      },
      run: {
        create: vi.fn().mockResolvedValue({ id: 77 }),
        update,
      },
    } as unknown as PrismaClient
    const fetchPage = vi.fn()
    const runCycle = vi.fn().mockRejectedValue(
      new KufarUrlBuildError('unsupported-api-mapping', 'Do not persist URL or secret here'),
    )
    const executor = createScheduledMonitorRunExecutor({
      prisma,
      createRunAdapters: vi.fn(() => ({ get: () => ({ fetchPage }) }) as never),
      runCycle: runCycle as never,
      maxPages: 5,
      descriptionLoader: { ensureDescription: vi.fn() },
    })

    await expect(executor(7)).resolves.toEqual({ cycleKind: 'failed-no-retry' })
    expect(prisma.run.create).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith({
      where: { id: 77 },
      data: {
        finishedAt: expect.any(Date),
        durationMs: expect.any(Number),
        outcome: 'error',
        seen: 0,
        matched: 0,
        error: 'Unsupported Kufar API mapping for this monitor URL',
        errorCategory: 'policy',
        errorCode: 'unsupported-api-mapping',
        httpStatus: null,
      },
    })
    expect(fetchPage).not.toHaveBeenCalled()
    expect(JSON.stringify(update.mock.calls)).not.toContain('secret')
  })
})
