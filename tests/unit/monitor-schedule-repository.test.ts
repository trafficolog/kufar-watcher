import { describe, expect, it } from 'vitest'

import type { PrismaClient } from '../../generated/prisma/client'
import { createPrismaMonitorScheduleRepository } from '../../electron/worker/monitor-schedule-repository'

describe('createPrismaMonitorScheduleRepository', () => {
  it('lists only scheduler-relevant monitor fields', async () => {
    const calls: unknown[] = []
    const prisma = {
      monitor: {
        findMany: async (args: unknown) => {
          calls.push(args)
          return [
            { id: 1, intervalSec: 60, state: 'active' as const },
            { id: 2, intervalSec: 300, state: 'paused' as const },
          ]
        },
      },
    } as unknown as PrismaClient
    const repository = createPrismaMonitorScheduleRepository(prisma)

    await expect(repository.list()).resolves.toEqual([
      { id: 1, intervalSec: 60, state: 'active' },
      { id: 2, intervalSec: 300, state: 'paused' },
    ])
    expect(calls).toEqual([
      {
        select: { id: true, intervalSec: true, state: true },
      },
    ])
  })

  it('finds one monitor with the same narrow projection', async () => {
    const calls: unknown[] = []
    const prisma = {
      monitor: {
        findUnique: async (args: unknown) => {
          calls.push(args)
          return { id: 7, intervalSec: 900, state: 'archived' as const }
        },
      },
    } as unknown as PrismaClient
    const repository = createPrismaMonitorScheduleRepository(prisma)

    await expect(repository.find(7)).resolves.toEqual({
      id: 7,
      intervalSec: 900,
      state: 'archived',
    })
    expect(calls).toEqual([
      {
        where: { id: 7 },
        select: { id: true, intervalSec: true, state: true },
      },
    ])
  })

  it('returns null when the monitor does not exist', async () => {
    const prisma = {
      monitor: {
        findUnique: async () => null,
      },
    } as unknown as PrismaClient
    const repository = createPrismaMonitorScheduleRepository(prisma)

    await expect(repository.find(99)).resolves.toBeNull()
  })
})
