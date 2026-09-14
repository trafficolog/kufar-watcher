import { describe, expect, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import type { MonitorCreateInput, MonitorCreateResult } from '../../shared/ipc'

interface MonitorCreateConfigSyncModule {
  createMonitorConfigAndSync?: (
    prisma: PrismaClient,
    scheduler: { syncMonitor(monitorId: number): Promise<void> },
    input: MonitorCreateInput,
  ) => Promise<MonitorCreateResult>
}

describe('createMonitorConfigAndSync', () => {
  it('persists canonical monitor config before reconciling its schedule', async () => {
    const events: string[] = []
    const createdData: unknown[] = []
    const prisma = {
      monitor: {
        create: async ({ data }: { data: unknown }) => {
          createdData.push(data)
          events.push('monitor-create')
          return { id: 17 }
        },
      },
    } as unknown as PrismaClient
    const scheduler = {
      async syncMonitor(monitorId: number) {
        events.push(`sync:${monitorId}`)
      },
    }
    const input: MonitorCreateInput = {
      name: 'PS5 Minsk',
      sourceUrl: 'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~playstation',
      intervalSec: 300,
      include: ['ps5', 'playstation*'],
      exclude: ['repair'],
    }
    const module =
      (await import('../../electron/worker/monitor-config-sync')) as MonitorCreateConfigSyncModule

    expect(module.createMonitorConfigAndSync).toBeTypeOf('function')
    await expect(module.createMonitorConfigAndSync!(prisma, scheduler, input)).resolves.toEqual({
      monitorId: 17,
    })

    expect(createdData).toEqual([
      {
        name: 'PS5 Minsk',
        sourceUrl: input.sourceUrl,
        query: {
          host: 'www.kufar.by',
          category: 'igry-i-pristavki',
          query: 'playstation',
          region: 'minsk',
          sellerType: null,
          sort: null,
          operation: null,
          pathFilters: [],
          extraParams: {},
        },
        intervalSec: 300,
        keywords: {
          include: ['ps5', 'playstation*'],
          exclude: ['repair'],
        },
      },
    ])
    expect(events).toEqual(['monitor-create', 'sync:17'])
  })
})
