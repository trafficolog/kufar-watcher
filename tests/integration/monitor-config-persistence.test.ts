import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { Prisma, PrismaClient } from '../../generated/prisma/client'
import { createPrismaClient } from '../../electron/worker/prisma-client'
import type { CanonicalQuery } from '../../shared/canonical-query'

const integrationDescribe =
  process.env.KUFAR_POSTGRES_INTEGRATION === '1' ? describe : describe.skip

const MONITOR_ID = 914_201
const ORIGINAL_URL = 'https://www.kufar.by/l/electronics?query=phone'
const ORIGINAL_QUERY: CanonicalQuery = {
  host: 'www.kufar.by',
  category: 'electronics',
  query: 'phone',
  region: 'minsk',
  sellerType: null,
  sort: 'lst.d',
  operation: null,
  pathFilters: ['phones', 'smartphones'],
  extraParams: {
    condition: ['used', 'new'],
    price: ['100', '500'],
  },
}
const BOUNDARY_TIME = new Date('2026-09-08T10:00:00.000Z')
const BOUNDARY_IDS = ['config-boundary']

type ConfigPersistenceModule = {
  updateMonitorConfig: (
    prisma: PrismaClient,
    monitorId: number,
    patch: Record<string, unknown>,
  ) => Promise<void>
  updateMonitorConfigTransaction: (
    tx: Prisma.TransactionClient,
    monitorId: number,
    patch: Record<string, unknown>,
  ) => Promise<void>
}

integrationDescribe('monitor config persistence', () => {
  let prisma: ReturnType<typeof createPrismaClient>
  let updateMonitorConfig: ConfigPersistenceModule['updateMonitorConfig']
  let updateMonitorConfigTransaction: ConfigPersistenceModule['updateMonitorConfigTransaction']

  beforeAll(async () => {
    prisma = createPrismaClient()
    await prisma.$connect()

    const persistence = (await import(
      '../../electron/worker/monitor-config-persistence'
    )) as unknown as ConfigPersistenceModule
    updateMonitorConfig = persistence.updateMonitorConfig
    updateMonitorConfigTransaction = persistence.updateMonitorConfigTransaction
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.monitor.deleteMany({ where: { id: MONITOR_ID } })
    await prisma.monitor.create({
      data: {
        id: MONITOR_ID,
        name: 'config-persistence-fixture',
        sourceUrl: ORIGINAL_URL,
        query: ORIGINAL_QUERY,
        intervalSec: 60,
        keywords: ['phone'],
        searchInDescription: false,
        sellerType: null,
        state: 'active',
      },
    })
    await prisma.monitorCursor.create({
      data: {
        monitorId: MONITOR_ID,
        boundaryTime: BOUNDARY_TIME,
        boundaryIds: BOUNDARY_IDS,
      },
    })
  })

  it('deletes cursor atomically when sourceUrl changes', async () => {
    await updateMonitorConfig(prisma, MONITOR_ID, {
      sourceUrl: 'https://www.kufar.by/l/cars',
    })

    const monitor = await prisma.monitor.findUniqueOrThrow({ where: { id: MONITOR_ID } })
    expect(monitor.sourceUrl).toBe('https://www.kufar.by/l/cars')
    expect(await prisma.monitorCursor.findUnique({ where: { monitorId: MONITOR_ID } })).toBeNull()
  })

  it('deletes cursor atomically when canonical query changes', async () => {
    await updateMonitorConfig(prisma, MONITOR_ID, {
      query: { ...ORIGINAL_QUERY, region: 'gomel' },
    })

    expect(await prisma.monitorCursor.findUnique({ where: { monitorId: MONITOR_ID } })).toBeNull()
  })

  it('preserves cursor for non-source edits', async () => {
    await updateMonitorConfig(prisma, MONITOR_ID, {
      name: 'renamed monitor',
      intervalSec: 300,
      keywords: ['phone', 'pixel'],
      searchInDescription: true,
      sellerType: 'company',
    })

    const monitor = await prisma.monitor.findUniqueOrThrow({ where: { id: MONITOR_ID } })
    expect(monitor.name).toBe('renamed monitor')
    expect(monitor.intervalSec).toBe(300)
    expect(monitor.keywords).toEqual(['phone', 'pixel'])
    expect(monitor.searchInDescription).toBe(true)
    expect(monitor.sellerType).toBe('company')

    const cursor = await prisma.monitorCursor.findUniqueOrThrow({
      where: { monitorId: MONITOR_ID },
    })
    expect(cursor.boundaryTime?.toISOString()).toBe(BOUNDARY_TIME.toISOString())
    expect(cursor.boundaryIds).toEqual(BOUNDARY_IDS)
  })

  it('deletes cursor when archived monitor becomes active', async () => {
    await prisma.monitor.update({
      where: { id: MONITOR_ID },
      data: { state: 'archived' },
    })

    await updateMonitorConfig(prisma, MONITOR_ID, { state: 'active' })

    expect(await prisma.monitorCursor.findUnique({ where: { monitorId: MONITOR_ID } })).toBeNull()
  })

  it('rolls back monitor edit and cursor deletion when transaction callback throws', async () => {
    const sentinel = new Error('rollback-monitor-config')

    await expect(
      prisma.$transaction(async (tx) => {
        await updateMonitorConfigTransaction(tx, MONITOR_ID, {
          sourceUrl: 'https://www.kufar.by/l/cars',
        })
        throw sentinel
      }),
    ).rejects.toBe(sentinel)

    const monitor = await prisma.monitor.findUniqueOrThrow({ where: { id: MONITOR_ID } })
    expect(monitor.sourceUrl).toBe(ORIGINAL_URL)
    expect(await prisma.monitorCursor.findUnique({ where: { monitorId: MONITOR_ID } })).not.toBeNull()
  })

  it('rejects malformed persisted canonical query without mutating cursor state', async () => {
    await prisma.monitor.update({
      where: { id: MONITOR_ID },
      data: { query: { host: 'www.kufar.by' } },
    })

    await expect(
      updateMonitorConfig(prisma, MONITOR_ID, { name: 'must-not-commit' }),
    ).rejects.toThrow(/canonical query/i)

    const monitor = await prisma.monitor.findUniqueOrThrow({ where: { id: MONITOR_ID } })
    expect(monitor.name).toBe('config-persistence-fixture')
    expect(await prisma.monitorCursor.findUnique({ where: { monitorId: MONITOR_ID } })).not.toBeNull()
  })
})
