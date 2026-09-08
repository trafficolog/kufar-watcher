import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createPrismaClient } from '../../electron/worker/prisma-client'

const integrationDescribe =
  process.env.KUFAR_POSTGRES_INTEGRATION === '1' ? describe : describe.skip

const LISTING_PREFIX = 'it-1-5-1-description-cache-'

integrationDescribe('listing description cache', () => {
  let prisma: ReturnType<typeof createPrismaClient>

  beforeAll(async () => {
    prisma = createPrismaClient()
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.listing.deleteMany({ where: { listId: { startsWith: LISTING_PREFIX } } })
  })

  it('defaults a search-created listing to active with no full description cache', async () => {
    const columns = await prisma.$queryRaw<
      Array<{ column_name: string; column_default: string | null }>
    >`
      SELECT column_name, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'Listing'
        AND column_name IN ('availability', 'descriptionLoaded')
      ORDER BY column_name
    `

    expect(columns.map(({ column_name }) => column_name)).toEqual([
      'availability',
      'descriptionLoaded',
    ])

    await prisma.listing.create({
      data: {
        listId: `${LISTING_PREFIX}defaults`,
        title: 'Defaults listing',
        priceKind: 'fixed',
        priceAmount: '10.00',
        currency: 'BYN',
        url: 'https://fixtures.invalid/defaults',
        region: 'minsk',
        accountId: 'account-defaults',
        isCompany: false,
        listTime: new Date('2026-09-09T00:00:00.000Z'),
        description: 'short body',
        raw: { fixture: 'defaults' },
      },
    })

    const [row] = await prisma.$queryRaw<
      Array<{ availability: string; descriptionLoaded: boolean }>
    >`
      SELECT "availability"::text AS availability, "descriptionLoaded"
      FROM "Listing"
      WHERE "listId" = ${`${LISTING_PREFIX}defaults`}
    `

    expect(row).toEqual({ availability: 'active', descriptionLoaded: false })
  })
})
