import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DescriptionRequestBudget,
  DescriptionRequestBudgetExceededError,
} from '../../electron/worker/description-request-budget'
import type { KufarHttpClient, KufarHttpResult } from '../../electron/worker/kufar-http-client'
import { ListingDescriptionCache } from '../../electron/worker/listing-description-cache'
import { persistListings } from '../../electron/worker/monitor-run-persistence'
import { createPrismaClient } from '../../electron/worker/prisma-client'
import { KufarSourceRequestError } from '../../electron/worker/kufar-source-request-error'
import type { Listing } from '../../shared/listing'

const integrationDescribe =
  process.env.KUFAR_POSTGRES_INTEGRATION === '1' ? describe : describe.skip

const LISTING_PREFIX = 'it-1-5-1-description-'
const LOADED_AT = new Date('2026-09-09T06:30:00.000Z')
const encoder = new TextEncoder()

function listing(suffix: string, overrides: Partial<Listing> = {}): Listing {
  const listId = `${LISTING_PREFIX}${suffix}`

  return {
    listId,
    title: `Search title ${suffix}`,
    priceKind: 'fixed',
    priceAmount: '125.00',
    currency: 'BYN',
    url: `https://fixtures.invalid/listing/${listId}`,
    region: 'minsk',
    accountId: `account-${suffix}`,
    isCompany: false,
    listTime: '2026-09-09T06:29:00.000Z',
    description: `Short search snippet ${suffix}`,
    raw: { source: 'search', suffix },
    ...overrides,
  }
}

async function fixture(name: string): Promise<Uint8Array> {
  return readFile(new URL(`../fixtures/kufar/${name}`, import.meta.url))
}

function success(body: Uint8Array): KufarHttpResult {
  return { ok: true, status: 200, body, headers: {}, attempts: 1 }
}

function httpClient(result: KufarHttpResult) {
  const get = vi.fn().mockResolvedValue(result)
  return {
    get,
    client: { get } as unknown as Pick<KufarHttpClient, 'get'>,
  }
}

integrationDescribe('ListingDescriptionCache PostgreSQL persistence', () => {
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

  it('reuses a persisted full description across service instances without second HTTP', async () => {
    const candidate = listing('available')
    const detail = await fixture('2026-09-07-electronics-negotiable-detail.json')
    const firstHttp = httpClient(success(detail))
    const first = new ListingDescriptionCache(prisma, firstHttp.client, () => LOADED_AT)

    const firstResult = await first.ensureDescription(candidate)
    if (firstResult.kind !== 'available') throw new Error('expected available result')

    const stored = await prisma.listing.findUniqueOrThrow({ where: { listId: candidate.listId } })
    expect(stored.description).toBe(firstResult.description)
    expect(stored.descriptionLoadedAt?.toISOString()).toBe(LOADED_AT.toISOString())
    expect(stored.availability).toBe('available')
    expect(firstHttp.get).toHaveBeenCalledTimes(1)

    const secondGet = vi.fn(async () => {
      throw new Error('persistent cache should prevent HTTP')
    })
    const second = new ListingDescriptionCache(prisma, { get: secondGet } as unknown as Pick<
      KufarHttpClient,
      'get'
    >)

    await expect(second.ensureDescription(candidate)).resolves.toEqual({
      kind: 'available',
      description: firstResult.description,
      source: 'cache',
    })
    expect(secondGet).not.toHaveBeenCalled()
  })

  it('persists null as a completed description fetch and reuses it from the database', async () => {
    const candidate = listing('null-body')
    const firstHttp = httpClient(
      success(encoder.encode(JSON.stringify({ result: { body: null } }))),
    )
    const first = new ListingDescriptionCache(prisma, firstHttp.client, () => LOADED_AT)

    await expect(first.ensureDescription(candidate)).resolves.toEqual({
      kind: 'available',
      description: null,
      source: 'network',
    })

    const secondGet = vi.fn(async () => {
      throw new Error('null description is still cached')
    })
    const second = new ListingDescriptionCache(prisma, { get: secondGet } as unknown as Pick<
      KufarHttpClient,
      'get'
    >)

    await expect(second.ensureDescription(candidate)).resolves.toEqual({
      kind: 'available',
      description: null,
      source: 'cache',
    })
    expect(secondGet).not.toHaveBeenCalled()
  })

  it('persists exact 404 plus ASR0006 as unavailable and skips later HTTP', async () => {
    const candidate = listing('unavailable')
    const notFound = await fixture('2026-09-07-electronics-detail-not-found.json')
    const firstHttp = httpClient({
      ok: false,
      kind: 'permanent',
      code: 'http-4xx',
      status: 404,
      attempts: 1,
      message: 'not found',
      body: notFound,
    })
    const first = new ListingDescriptionCache(prisma, firstHttp.client, () => LOADED_AT)

    await expect(first.ensureDescription(candidate)).resolves.toEqual({
      kind: 'unavailable',
      source: 'network',
    })

    const stored = await prisma.listing.findUniqueOrThrow({ where: { listId: candidate.listId } })
    expect(stored.availability).toBe('unavailable')
    expect(stored.descriptionLoadedAt).toBeNull()

    const secondGet = vi.fn(async () => {
      throw new Error('unavailable state should prevent HTTP')
    })
    const second = new ListingDescriptionCache(prisma, { get: secondGet } as unknown as Pick<
      KufarHttpClient,
      'get'
    >)

    await expect(second.ensureDescription(candidate)).resolves.toEqual({
      kind: 'unavailable',
      source: 'cache',
    })
    expect(secondGet).not.toHaveBeenCalled()
  })

  it('preserves cached detail fields when a later search upsert refreshes ordinary fields', async () => {
    const candidate = listing('search-refresh')
    const detail = await fixture('2026-09-07-electronics-negotiable-detail.json')
    const firstHttp = httpClient(success(detail))
    const cache = new ListingDescriptionCache(prisma, firstHttp.client, () => LOADED_AT)
    const cached = await cache.ensureDescription(candidate)
    if (cached.kind !== 'available') throw new Error('expected available result')

    const refreshed = listing('search-refresh', {
      title: 'Updated search title',
      description: 'New truncated search snippet',
      raw: { source: 'search-refresh' },
    })
    await prisma.$transaction((tx) => persistListings(tx, [refreshed]))

    const stored = await prisma.listing.findUniqueOrThrow({ where: { listId: candidate.listId } })
    expect(stored.title).toBe('Updated search title')
    expect(stored.raw).toEqual({ source: 'search-refresh' })
    expect(stored.description).toBe(cached.description)
    expect(stored.descriptionLoadedAt?.toISOString()).toBe(LOADED_AT.toISOString())
    expect(stored.availability).toBe('available')
  })

  it('leaves an existing search row uncached after an unrelated 404', async () => {
    const candidate = listing('retryable-failure')
    await prisma.$transaction((tx) => persistListings(tx, [candidate]))

    const unrelated404 = encoder.encode(JSON.stringify({ error: { code: 'OTHER' } }))
    const failingHttp = httpClient({
      ok: false,
      kind: 'permanent',
      code: 'http-4xx',
      status: 404,
      attempts: 1,
      message: 'unrelated 404',
      body: unrelated404,
    })
    const cache = new ListingDescriptionCache(prisma, failingHttp.client, () => LOADED_AT)

    await expect(cache.ensureDescription(candidate)).rejects.toBeInstanceOf(KufarSourceRequestError)

    const stored = await prisma.listing.findUniqueOrThrow({ where: { listId: candidate.listId } })
    expect(stored.availability).toBe('unknown')
    expect(stored.descriptionLoadedAt).toBeNull()
    expect(stored.description).toBe(candidate.description)
  })

  it('reuses staged detail cache entries after budget exhaustion with a fresh run budget', async () => {
    const detail = await fixture('2026-09-07-electronics-negotiable-detail.json')
    const candidates = Array.from({ length: 11 }, (_, index) => listing(`budget-${index}`))
    const firstHttp = httpClient(success(detail))
    const firstCache = new ListingDescriptionCache(prisma, firstHttp.client, () => LOADED_AT)
    const firstBudget = new DescriptionRequestBudget()

    for (const candidate of candidates.slice(0, 10)) {
      await expect(firstCache.ensureDescription(candidate, firstBudget)).resolves.toMatchObject({
        kind: 'available',
        source: 'network',
      })
    }

    await expect(
      firstCache.ensureDescription(candidates[10] as Listing, firstBudget),
    ).rejects.toBeInstanceOf(DescriptionRequestBudgetExceededError)
    expect(firstHttp.get).toHaveBeenCalledTimes(10)

    const retryHttp = httpClient(success(detail))
    const retryCache = new ListingDescriptionCache(prisma, retryHttp.client, () => LOADED_AT)
    const retryBudget = new DescriptionRequestBudget()

    for (const candidate of candidates.slice(0, 10)) {
      await expect(retryCache.ensureDescription(candidate, retryBudget)).resolves.toMatchObject({
        kind: 'available',
        source: 'cache',
      })
    }
    expect(retryHttp.get).not.toHaveBeenCalled()

    await expect(
      retryCache.ensureDescription(candidates[10] as Listing, retryBudget),
    ).resolves.toMatchObject({
      kind: 'available',
      source: 'network',
    })
    expect(retryHttp.get).toHaveBeenCalledTimes(1)
  })
})
