import { readFile } from 'node:fs/promises'

import { describe, expect, it, vi } from 'vitest'

import type { KufarHttpClient, KufarHttpResult } from '../../electron/worker/kufar-http-client'
import { ListingDescriptionCache } from '../../electron/worker/listing-description-cache'
import type { PrismaClient } from '../../generated/prisma/client'
import type { Listing } from '../../shared/listing'

const LISTING: Listing = {
  listId: 'budget-base',
  title: 'Budget candidate',
  priceKind: 'fixed',
  priceAmount: '100.00',
  currency: 'BYN',
  url: 'https://www.kufar.by/item/budget-base',
  region: 'minsk',
  accountId: 'budget-seller',
  isCompany: false,
  listTime: '2026-09-10T19:00:00.000Z',
  description: 'short',
  raw: { source: 'test' },
}

async function detailBody(): Promise<Uint8Array> {
  return readFile(
    new URL('../fixtures/kufar/2026-09-07-electronics-negotiable-detail.json', import.meta.url),
  )
}

function success(body: Uint8Array): KufarHttpResult {
  return { ok: true, status: 200, body, headers: {}, attempts: 1 }
}

describe('listing detail request budget', () => {
  it('checks the run budget after a cache miss and before sending the eleventh HTTP request', async () => {
    const body = await detailBody()
    const findUnique = vi.fn().mockResolvedValue(null)
    const upsert = vi.fn().mockResolvedValue(undefined)
    const get = vi.fn().mockResolvedValue(success(body))
    const cache = new ListingDescriptionCache(
      { listing: { findUnique, upsert } } as unknown as PrismaClient,
      { get } as unknown as Pick<KufarHttpClient, 'get'>,
    )

    let consumed = 0
    const exhausted = Object.assign(new Error('description request budget exhausted'), {
      name: 'DescriptionRequestBudgetExceededError',
      limit: 10,
    })
    const budget = {
      consume() {
        if (consumed >= 10) throw exhausted
        consumed += 1
      },
    }
    const ensureDescription = cache.ensureDescription.bind(cache) as (
      listing: Listing,
      requestBudget: { consume(): void },
    ) => Promise<unknown>

    for (let index = 0; index < 10; index += 1) {
      await ensureDescription(
        {
          ...LISTING,
          listId: `budget-${index}`,
          url: `https://www.kufar.by/item/budget-${index}`,
        },
        budget,
      )
    }

    await expect(
      ensureDescription(
        {
          ...LISTING,
          listId: 'budget-10',
          url: 'https://www.kufar.by/item/budget-10',
        },
        budget,
      ),
    ).rejects.toBe(exhausted)

    expect(get).toHaveBeenCalledTimes(10)
    expect(consumed).toBe(10)
  })

  it.each([
    {
      label: 'available',
      cached: {
        availability: 'available',
        description: 'cached full description',
        descriptionLoadedAt: new Date('2026-09-10T18:30:00.000Z'),
      },
      expected: {
        kind: 'available',
        description: 'cached full description',
        source: 'cache',
      },
    },
    {
      label: 'unavailable',
      cached: {
        availability: 'unavailable',
        description: null,
        descriptionLoadedAt: null,
      },
      expected: { kind: 'unavailable', source: 'cache' },
    },
  ])(
    'does not spend the run budget on a persisted $label cache hit',
    async ({ cached, expected }) => {
      const consume = vi.fn(() => {
        throw new Error('cache hit must not consume the request budget')
      })
      const get = vi.fn(() => {
        throw new Error('cache hit must not perform HTTP')
      })
      const cache = new ListingDescriptionCache(
        {
          listing: {
            findUnique: vi.fn().mockResolvedValue(cached),
          },
        } as unknown as PrismaClient,
        { get } as unknown as Pick<KufarHttpClient, 'get'>,
      )

      await expect(cache.ensureDescription(LISTING, { consume })).resolves.toEqual(expected)
      expect(consume).not.toHaveBeenCalled()
      expect(get).not.toHaveBeenCalled()
    },
  )
})
