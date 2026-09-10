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
const coldStartResult = {
  cycleKind: 'cold-start' as const,
  baselineCount: 0,
  pagesRead: 1,
  nextWatermark: { boundaryTime: '2026-09-10T17:00:00.000Z', boundaryIds: [] },
}

function adaptersFor(adapter: SourceAdapter) {
  return createSourceAdapterRegistry({ electronics: adapter, 'real-estate': adapter })
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
    const adapters = adaptersFor(adapter)
    let degradationSink: SourceDegradationSink | undefined
    const createRunAdapters = vi.fn((sink: SourceDegradationSink) => {
      degradationSink = sink
      return adapters
    })
    const onSourceDegradation = vi.fn()
    const runCycle = vi.fn(async () => {
      await degradationSink?.(event)
      await degradationSink?.(event)
      return coldStartResult
    })
    const options = {
      prisma,
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

  it('keeps html-fallback durable when warning publication fails after the write', async () => {
    const runUpdate = vi.fn().mockResolvedValue(undefined)
    const prisma = {
      run: {
        create: vi.fn().mockResolvedValue({ id: 9001 }),
        update: runUpdate,
      },
      monitor: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ query }),
      },
    } as unknown as PrismaClient
    const adapter = {} as SourceAdapter
    let degradationSink: SourceDegradationSink | undefined
    const warningFailure = new Error('warning publication failed')
    const onSourceDegradation = vi.fn().mockRejectedValue(warningFailure)
    const executor = createScheduledMonitorRunExecutor({
      prisma,
      createRunAdapters(sink) {
        degradationSink = sink
        return adaptersFor(adapter)
      },
      maxPages: 5,
      descriptionLoader: { ensureDescription: vi.fn() },
      runCycle: vi.fn(async () => {
        await degradationSink?.(event)
        return coldStartResult
      }) as never,
      onSourceDegradation,
    })

    await expect(executor(17)).rejects.toBe(warningFailure)

    expect(runUpdate.mock.calls[0]?.[0]).toEqual({
      where: { id: 9001 },
      data: { degradedLevel: 'html-fallback' },
    })
    expect(runUpdate.mock.calls[1]?.[0]).toEqual({
      where: { id: 9001 },
      data: expect.objectContaining({ outcome: 'error' }),
    })
    expect(runUpdate.mock.calls[1]?.[0].data).not.toHaveProperty('degradedLevel')
    expect(onSourceDegradation).toHaveBeenCalledOnce()
  })

  it('keeps degradation dedupe state isolated between different runs', async () => {
    const runUpdate = vi.fn().mockResolvedValue(undefined)
    const prisma = {
      run: {
        create: vi
          .fn()
          .mockResolvedValueOnce({ id: 9001 })
          .mockResolvedValueOnce({ id: 9002 }),
        update: runUpdate,
      },
      monitor: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ query }),
      },
    } as unknown as PrismaClient
    const adapter = {} as SourceAdapter
    const sinks: SourceDegradationSink[] = []
    let cycleIndex = 0
    const createRunAdapters = vi.fn((sink: SourceDegradationSink) => {
      sinks.push(sink)
      return adaptersFor(adapter)
    })
    const onSourceDegradation = vi.fn()
    const runCycle = vi.fn(async () => {
      const sink = sinks[cycleIndex]
      cycleIndex += 1
      await sink?.(event)
      await sink?.(event)
      return coldStartResult
    })
    const executor = createScheduledMonitorRunExecutor({
      prisma,
      createRunAdapters,
      maxPages: 5,
      descriptionLoader: { ensureDescription: vi.fn() },
      runCycle: runCycle as never,
      onSourceDegradation,
    })

    await executor(17)
    await executor(18)

    expect(createRunAdapters).toHaveBeenCalledTimes(2)
    expect(runUpdate).toHaveBeenCalledTimes(2)
    expect(runUpdate.mock.calls.map(([input]) => input)).toEqual([
      { where: { id: 9001 }, data: { degradedLevel: 'html-fallback' } },
      { where: { id: 9002 }, data: { degradedLevel: 'html-fallback' } },
    ])
    expect(onSourceDegradation).toHaveBeenCalledTimes(2)
    expect(onSourceDegradation).toHaveBeenNthCalledWith(1, 17, event)
    expect(onSourceDegradation).toHaveBeenNthCalledWith(2, 18, event)
  })
})
