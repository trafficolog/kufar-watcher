import { describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import { KufarResilientSourceError } from '../../electron/worker/kufar-resilient-source'
import { KufarSourceRequestError } from '../../electron/worker/kufar-source-request-error'
import { createScheduledMonitorRunExecutor } from '../../electron/worker/scheduled-monitor-run'
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

function createExecutor(
  runCycle: ReturnType<typeof vi.fn>,
  onPauseRequired?: (
    monitorId: number,
    stage: 'primary' | 'html-fallback' | 'degradation-event',
  ) => void,
) {
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
  const adapter = { fetchPage: vi.fn() } as unknown as SourceAdapter
  const adapters = createSourceAdapterRegistry({
    electronics: adapter,
    'real-estate': adapter,
  })

  return {
    executor: createScheduledMonitorRunExecutor({
      prisma,
      adapters,
      maxPages: 5,
      descriptionLoader: { ensureDescription: vi.fn() },
      runCycle: runCycle as never,
      onPauseRequired,
    }),
    runUpdate,
  }
}

describe('scheduled monitor retry disposition', () => {
  it.each([
    { label: 'network', code: 'network' as const, status: null },
    { label: 'timeout', code: 'timeout' as const, status: null },
    { label: '5xx', code: 'http-5xx' as const, status: 503 },
  ])('rejects a retryable $label source failure for pg-boss', async ({ code, status }) => {
    const failure = new KufarSourceRequestError('request failed', {
      ok: false,
      kind: 'temporary',
      code,
      status,
      attempts: 3,
      message: `Kufar temporary failure: ${code}`,
    })
    const runCycle = vi.fn().mockRejectedValue(failure)
    const { executor, runUpdate } = createExecutor(runCycle)

    await expect(executor(17)).rejects.toBe(failure)
    expect(runCycle).toHaveBeenCalledOnce()
    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 9001 },
        data: expect.objectContaining({
          outcome: 'error',
          errorCategory: 'source',
          errorCode: code,
          httpStatus: status,
        }),
      }),
    )
  })

  it('records a permanent source failure but completes the job without retrying it', async () => {
    const failure = new KufarSourceRequestError('request failed', {
      ok: false,
      kind: 'permanent',
      code: 'http-4xx',
      status: 403,
      attempts: 1,
      message: 'Kufar returned permanent HTTP 403',
    })
    const runCycle = vi.fn().mockRejectedValue(failure)
    const { executor, runUpdate } = createExecutor(runCycle)

    await expect(executor(17)).resolves.toEqual({ cycleKind: 'failed-no-retry' })
    expect(runCycle).toHaveBeenCalledOnce()
    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 9001 },
        data: expect.objectContaining({
          outcome: 'error',
          errorCategory: 'source',
          errorCode: 'http-4xx',
          httpStatus: 403,
        }),
      }),
    )
  })

  it('records a 429 after limiter cooldown but completes the job without pg-boss retry', async () => {
    const failure = new KufarSourceRequestError('rate limited', {
      ok: false,
      kind: 'rate-limited',
      code: 'rate-limited',
      status: 429,
      attempts: 1,
      message: 'Kufar rate limited the request',
      retryAfterMs: 60_000,
    })
    const runCycle = vi.fn().mockRejectedValue(failure)
    const { executor, runUpdate } = createExecutor(runCycle)

    await expect(executor(17)).resolves.toEqual({ cycleKind: 'failed-no-retry' })
    expect(runCycle).toHaveBeenCalledOnce()
    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 9001 },
        data: expect.objectContaining({
          outcome: 'error',
          errorCategory: 'source',
          errorCode: 'rate-limited',
          httpStatus: 429,
        }),
      }),
    )
  })

  it('signals pause-required schema drift without retrying the job', async () => {
    const failure = new KufarResilientSourceError(
      'pause-required',
      'primary',
      new Error('schema payload token=do-not-persist'),
    )
    const runCycle = vi.fn().mockRejectedValue(failure)
    const onPauseRequired = vi.fn()
    const { executor, runUpdate } = createExecutor(runCycle, onPauseRequired)

    await expect(executor(17)).resolves.toEqual({ cycleKind: 'pause-required' })
    expect(onPauseRequired).toHaveBeenCalledWith(17, 'primary')
    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 9001 },
        data: expect.objectContaining({
          outcome: 'error',
          errorCategory: 'source',
          errorCode: 'resilient-primary',
          httpStatus: null,
        }),
      }),
    )
    expect(JSON.stringify(runUpdate.mock.calls)).not.toContain('do-not-persist')
  })
})
