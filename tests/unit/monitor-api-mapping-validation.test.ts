import { describe, expect, it, vi } from 'vitest'
import type { Prisma, PrismaClient } from '../../generated/prisma/client'
import {
  createMonitorConfig,
  updateMonitorConfigTransaction,
} from '../../electron/worker/monitor-config-persistence'
import { KufarUrlBuildError } from '../../shared/kufar-url'

const minsk = 'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~ps5'
const unsupported = 'https://www.kufar.by/l/r~gomel/igry-i-pristavki/q~ps5'
const minskQuery = {
  host: 'www.kufar.by',
  category: 'igry-i-pristavki',
  query: 'ps5',
  region: 'minsk',
  sellerType: null,
  sort: 'lst.d',
  operation: null,
  pathFilters: [],
  extraParams: {},
}

const input = (sourceUrl: string) => ({
  name: 'MVP monitor',
  sourceUrl,
  intervalSec: 300,
  include: ['ps5'],
  exclude: [],
})

describe('monitor persistence rejects unsupported API semantics', () => {
  it('rejects an unsupported region before creating a monitor without source calls', async () => {
    const create = vi.fn().mockResolvedValue({ id: 7 })
    const prisma = { monitor: { create } } as unknown as PrismaClient
    await expect(createMonitorConfig(prisma, input(unsupported))).rejects.toMatchObject({
      code: 'unsupported-api-mapping',
    })
    expect(create).not.toHaveBeenCalled()
  })

  it.each([
    'https://www.kufar.by/l/r~minsk/igry-i-pristavki/phones',
    'https://re.kufar.by/l/minsk/snyat/kvartiru',
  ])('rejects other unsupported URL semantics before create: %s', async (url) => {
    const create = vi.fn()
    const prisma = { monitor: { create } } as unknown as PrismaClient
    await expect(createMonitorConfig(prisma, input(url))).rejects.toBeInstanceOf(KufarUrlBuildError)
    expect(create).not.toHaveBeenCalled()
  })

  it.each([minsk, 'https://re.kufar.by/l/minsk/kupit/kvartiru'])(
    'allows confirmed Minsk URL shape: %s',
    async (url) => {
      const create = vi.fn().mockResolvedValue({ id: 7 })
      const prisma = { monitor: { create } } as unknown as PrismaClient
      await expect(createMonitorConfig(prisma, input(url))).resolves.toEqual({ monitorId: 7 })
      expect(create).toHaveBeenCalledOnce()
    },
  )

  it('rejects changed source URL before updating or deleting the cursor', async () => {
    const update = vi.fn()
    const deleteMany = vi.fn()
    const tx = {
      monitor: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          sourceUrl: minsk,
          query: minskQuery,
          state: 'active',
        }),
        update,
      },
      monitorCursor: { deleteMany },
    } as unknown as Prisma.TransactionClient
    await expect(updateMonitorConfigTransaction(tx, 7, { sourceUrl: unsupported })).rejects.toMatchObject({
      code: 'unsupported-api-mapping',
    })
    expect(update).not.toHaveBeenCalled()
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it('rejects unsupported canonical-query edits before updating or resetting cursor', async () => {
    const update = vi.fn()
    const deleteMany = vi.fn()
    const tx = {
      monitor: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          sourceUrl: minsk,
          query: minskQuery,
          state: 'active',
        }),
        update,
      },
      monitorCursor: { deleteMany },
    } as unknown as Prisma.TransactionClient
    await expect(
      updateMonitorConfigTransaction(tx, 7, { query: { ...minskQuery, region: 'gomel' } }),
    ).rejects.toMatchObject({ code: 'unsupported-api-mapping' })
    expect(update).not.toHaveBeenCalled()
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it('keeps legacy unsupported monitors pausable without validating their old mapping', async () => {
    const update = vi.fn()
    const tx = {
      monitor: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          sourceUrl: unsupported,
          query: { ...minskQuery, region: 'gomel' },
          state: 'active',
        }),
        update,
      },
      monitorCursor: { deleteMany: vi.fn() },
    } as unknown as Prisma.TransactionClient
    await updateMonitorConfigTransaction(tx, 7, { state: 'paused' })
    expect(update).toHaveBeenCalledOnce()
  })
})
