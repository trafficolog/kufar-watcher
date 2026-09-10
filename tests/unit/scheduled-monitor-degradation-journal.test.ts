import { describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import type { SourceAdapter } from '../../shared/source-adapter'
import { createSourceAdapterRegistry } from '../../shared/source-adapter-registry'
import { parseKufarListingUrl } from '../../shared/kufar-url'
import type {
  SourceDegradationEvent,
  SourceDegradationSink,
} from '../../electron/worker/kufar-resilient-source'
import {
  createScheduledMonitorRunExecutor,
  type ScheduledMonitorRunExecutorOptions,
} from '../../electron/worker/scheduled-monitor-run'

const query = parseKufarListingUrl(
  'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5',
)
const event: SourceDegradationEvent = {
  kind: 'source-degraded',
  channel: 'html-fallback',
  primaryFailureCode: 'network',
  primaryStatus: null,
}

describe('scheduled monitor degradation journal', () => {
  it('binds one degradation write and warning to the exact running row', async () => {
    const runCreate = vi.fn().mockResolvedValue({ id: 9001 })
    const runUpdate = vi.fn().mockResolvedValue(undefined)
    const prisma = {
      run: { create: runCreate, update: runUpdate },
      monitor: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ query }),
      },
    } as unknown as PrismaClient
    const adapter = {} as SourceAdapter
    const adapters = createSourceAdapterRegistry({ electronics: adapter, 'real-estate': adapter })
    let degradationSink: SourceDegradationSink | undefined
    const createRunAdapters = vi.fn((sink: SourceDegradationSink) => {
      degradationSink = sink
      return adapters
    })
    const onSourceDegradation = vi.fn()
    const runCycle = vi.fn(async () => {
      await degradationSink?.(event)
      await degradationSink?.(event)
      return {
        cycleKind: 'cold-start' as const,
        baselineCount: 0,
        pagesRead: 1,
        nextWatermark: { boundaryTime: '2026-09-10T17:00:00.000Z', boundaryIds: [] },
      }
    })
    const options = {
      prisma,
      adapters,
      createRunAdapters,
      maxPages: 5,
      descriptionLoader: { ensureDescription: vi.fn() },
      runCycle,
      onSourceDegradation,
    } as unknown as ScheduledMonitorRunExecutorOptions
    const executor = createScheduledMonitorRunExecutor(options)

    await executor(17)

    expect(createRunAdapters).toHaveBeenCalledOnce()
    expect(runUpdate).toHaveBeenCalledTimes(1)
    expect(runUpdate).toHaveBeenCalledWith({
      where: { id: 9001 },
      data: { degradedLevel: 'html-fallback' },
    })
    expect(onSourceDegradation).toHaveBeenCalledOnce()
    expect(onSourceDegradation).toHaveBeenCalledWith(17, event)
  })
})
