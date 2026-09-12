import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Prisma } from '../../generated/prisma/client'
import { createPrismaClient } from '../../electron/worker/prisma-client'

const integration = process.env.KUFAR_POSTGRES_INTEGRATION === '1' ? describe : describe.skip

const LEGACY_MONITOR_ID = 927_101
const VALID_MONITOR_ID = 927_102
const REJECTED_MONITOR_ID = 927_103
const FIXTURE_IDS = [LEGACY_MONITOR_ID, VALID_MONITOR_ID, REJECTED_MONITOR_ID]
const CONSTRAINT_NAME = 'Monitor_intervalSec_supported_check'
const ADD_CONSTRAINT_SQL = `
  ALTER TABLE "Monitor"
  ADD CONSTRAINT "${CONSTRAINT_NAME}"
  CHECK ("intervalSec" IN (60, 120, 300, 600, 900, 3600))
  NOT VALID
`

function monitorData(id: number, intervalSec: number): Prisma.MonitorCreateInput {
  return {
    id,
    name: `interval-constraint-${id}`,
    sourceUrl: `https://fixtures.invalid/interval-constraint/${id}`,
    query: {} as Prisma.InputJsonValue,
    intervalSec,
    keywords: [],
  }
}

integration('Monitor interval database constraint', () => {
  const prisma = createPrismaClient()

  beforeAll(async () => {
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('is deployed NOT VALID, preserves a legacy unsupported row, and rejects new violations', async () => {
    const deployed = await prisma.$queryRawUnsafe<Array<{ convalidated: boolean }>>(
      `SELECT c.convalidated
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'public'
         AND t.relname = 'Monitor'
         AND c.conname = '${CONSTRAINT_NAME}'`,
    )

    expect(deployed).toEqual([{ convalidated: false }])

    await prisma.monitor.deleteMany({ where: { id: { in: FIXTURE_IDS } } })
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Monitor" DROP CONSTRAINT IF EXISTS "${CONSTRAINT_NAME}"`,
    )

    try {
      await prisma.monitor.create({ data: monitorData(LEGACY_MONITOR_ID, 180) })
      await prisma.$executeRawUnsafe(ADD_CONSTRAINT_SQL)

      const legacy = await prisma.monitor.findUniqueOrThrow({ where: { id: LEGACY_MONITOR_ID } })
      expect(legacy.intervalSec).toBe(180)

      await expect(
        prisma.monitor.create({ data: monitorData(REJECTED_MONITOR_ID, 180) }),
      ).rejects.toThrow()

      await expect(
        prisma.monitor.create({ data: monitorData(VALID_MONITOR_ID, 300) }),
      ).resolves.toMatchObject({ intervalSec: 300 })
    } finally {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "Monitor" DROP CONSTRAINT IF EXISTS "${CONSTRAINT_NAME}"`,
      )
      await prisma.monitor.deleteMany({ where: { id: { in: FIXTURE_IDS } } })
      await prisma.$executeRawUnsafe(ADD_CONSTRAINT_SQL)
    }
  })
})
