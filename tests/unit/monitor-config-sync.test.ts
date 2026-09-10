import { describe, expect, it } from 'vitest'

import type { Prisma, PrismaClient } from '../../generated/prisma/client'
import { updateMonitorConfigAndSync } from '../../electron/worker/monitor-config-sync'

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

function createSuccessfulPrisma(events: string[]): PrismaClient {
  const tx = {
    monitor: {
      findUniqueOrThrow: async () => ({
        sourceUrl: 'https://www.kufar.by/l/igry-i-pristavki',
        query: persistedQuery,
        state: 'active' as const,
      }),
      update: async () => {
        events.push('transaction-update')
        return undefined
      },
    },
    monitorCursor: {
      deleteMany: async () => undefined,
    },
  } as unknown as Prisma.TransactionClient

  return {
    $transaction: async (callback: (client: Prisma.TransactionClient) => Promise<unknown>) => {
      await callback(tx)
      events.push('transaction-commit')
    },
  } as unknown as PrismaClient
}

describe('updateMonitorConfigAndSync', () => {
  it('reconciles the scheduler only after the monitor config transaction commits', async () => {
    const events: string[] = []
    const prisma = createSuccessfulPrisma(events)
    const scheduler = {
      async syncMonitor(monitorId: number) {
        events.push(`sync:${monitorId}`)
      },
    }

    await updateMonitorConfigAndSync(prisma, scheduler, 7, { intervalSec: 300 })

    expect(events).toEqual(['transaction-update', 'transaction-commit', 'sync:7'])
  })

  it('does not touch the scheduler when the database transaction fails', async () => {
    const syncCalls: number[] = []
    const prisma = {
      $transaction: async () => {
        throw new Error('commit failed')
      },
    } as unknown as PrismaClient
    const scheduler = {
      async syncMonitor(monitorId: number) {
        syncCalls.push(monitorId)
      },
    }

    await expect(
      updateMonitorConfigAndSync(prisma, scheduler, 7, { state: 'paused' }),
    ).rejects.toThrow('commit failed')
    expect(syncCalls).toEqual([])
  })
})
