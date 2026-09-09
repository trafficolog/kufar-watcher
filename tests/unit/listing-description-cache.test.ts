import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

import { KufarSourceRequestError } from '../../electron/worker/kufar-source-request-error'
import { KufarListingDetailParseError } from '../../electron/worker/kufar-listing-detail'
import {
  ListingDescriptionCache,
  type ListingDescriptionResult,
} from '../../electron/worker/listing-description-cache'
import type { KufarHttpClient, KufarHttpResult } from '../../electron/worker/kufar-http-client'
import type { PrismaClient } from '../../generated/prisma/client'
import type { Listing } from '../../shared/listing'

const NOW = new Date('2026-09-09T06:00:00.000Z')
const LISTING: Listing = {
  listId: '1082715190',
  title: 'Search title',
  priceKind: 'fixed',
  priceAmount: '100.00',
  currency: 'BYN',
  url: 'https://www.kufar.by/item/1082715190',
  region: 'minsk',
  accountId: 'search-account',
  isCompany: false,
  listTime: '2026-09-09T05:59:00.000Z',
  description: 'short snippet',
  raw: { source: 'search' },
}

async function fixture(name: string): Promise<Uint8Array> {
  return readFile(new URL(`../fixtures/kufar/${name}`, import.meta.url))
}

function success(body: Uint8Array): KufarHttpResult {
  return { ok: true, status: 200, body, headers: {}, attempts: 1 }
}

function failure(
  status: number | null,
  code: Extract<KufarHttpResult, { ok: false }>['code'],
  body?: Uint8Array,
): Extract<KufarHttpResult, { ok: false }> {
  return {
    ok: false,
    kind:
      status === 429
        ? 'rate-limited'
        : status === null || status >= 500
          ? 'temporary'
          : 'permanent',
    code,
    status,
    attempts: 1,
    message: 'fixture failure',
    body,
  }
}

function makeService(
  cached: {
    availability: 'unknown' | 'available' | 'unavailable'
    description: string | null
    descriptionLoadedAt: Date | null
  } | null,
  getResult: KufarHttpResult | Promise<KufarHttpResult>,
) {
  const findUnique = vi.fn().mockResolvedValue(cached)
  const upsert = vi.fn().mockResolvedValue(undefined)
  const get = vi.fn().mockImplementation(async () => getResult)
  const prisma = { listing: { findUnique, upsert } } as unknown as PrismaClient
  const httpClient = { get } as unknown as Pick<KufarHttpClient, 'get'>
  const cache = new ListingDescriptionCache(prisma, httpClient, () => NOW)

  return { cache, findUnique, upsert, get }
}

describe('ListingDescriptionCache', () => {
  it('returns a persisted unavailable listing without HTTP', async () => {
    const service = makeService(
      { availability: 'unavailable', description: null, descriptionLoadedAt: null },
      failure(500, 'http-5xx'),
    )

    await expect(service.cache.ensureDescription(LISTING)).resolves.toEqual({
      kind: 'unavailable',
      source: 'cache',
    })
    expect(service.get).not.toHaveBeenCalled()
    expect(service.upsert).not.toHaveBeenCalled()
  })

  it('uses descriptionLoadedAt as the cache sentinel even when description is null', async () => {
    const service = makeService(
      { availability: 'available', description: null, descriptionLoadedAt: NOW },
      failure(500, 'http-5xx'),
    )

    await expect(service.cache.ensureDescription(LISTING)).resolves.toEqual({
      kind: 'available',
      description: null,
      source: 'cache',
    })
    expect(service.get).not.toHaveBeenCalled()
  })

  it('fetches the exact rendered detail URL and persists only cache-owned update fields', async () => {
    const detail = await fixture('2026-09-07-electronics-negotiable-detail.json')
    const service = makeService(null, success(detail))

    const result = await service.cache.ensureDescription(LISTING)

    expect(service.get).toHaveBeenCalledTimes(1)
    expect(service.get).toHaveBeenCalledWith(
      new URL('https://api.kufar.by/search-api/v2/item/1082715190/rendered?lang=ru'),
    )
    expect(result).toMatchObject({ kind: 'available', source: 'network' })
    expect(service.upsert).toHaveBeenCalledTimes(1)
    const update = service.upsert.mock.calls[0]?.[0]?.update
    expect(update).toEqual({
      description: expect.any(String),
      descriptionLoadedAt: NOW,
      availability: 'available',
    })
    expect(update).not.toHaveProperty('accountId')
    expect(update).not.toHaveProperty('title')
  })

  it('caches exact HTTP 404 plus ASR0006 as unavailable without throwing', async () => {
    const notFound = await fixture('2026-09-07-electronics-detail-not-found.json')
    const service = makeService(null, failure(404, 'http-4xx', notFound))

    await expect(service.cache.ensureDescription(LISTING)).resolves.toEqual({
      kind: 'unavailable',
      source: 'network',
    })
    expect(service.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { availability: 'unavailable', descriptionLoadedAt: null },
      }),
    )
  })

  it('does not poison cache for unrelated HTTP failures', async () => {
    const unrelated404 = new TextEncoder().encode(JSON.stringify({ error: { code: 'OTHER' } }))
    const service = makeService(null, failure(404, 'http-4xx', unrelated404))

    await expect(service.cache.ensureDescription(LISTING)).rejects.toBeInstanceOf(
      KufarSourceRequestError,
    )
    expect(service.upsert).not.toHaveBeenCalled()
  })

  it('does not poison cache for malformed successful detail payloads', async () => {
    const service = makeService(null, success(new TextEncoder().encode('{}')))

    await expect(service.cache.ensureDescription(LISTING)).rejects.toBeInstanceOf(
      KufarListingDetailParseError,
    )
    expect(service.upsert).not.toHaveBeenCalled()
  })

  it('coalesces concurrent requests for the same listId', async () => {
    let resolveHttp!: (value: KufarHttpResult) => void
    const pendingHttp = new Promise<KufarHttpResult>((resolve) => {
      resolveHttp = resolve
    })
    const service = makeService(null, pendingHttp)

    const first = service.cache.ensureDescription(LISTING)
    const second = service.cache.ensureDescription(LISTING)
    await vi.waitFor(() => expect(service.get).toHaveBeenCalledTimes(1))

    const detail = await fixture('2026-09-07-electronics-negotiable-detail.json')
    resolveHttp(success(detail))

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult).toEqual(secondResult)
    expect(service.get).toHaveBeenCalledTimes(1)
  })

  it('clears a failed in-flight request so a later call can retry', async () => {
    const detail = await fixture('2026-09-07-electronics-negotiable-detail.json')
    const findUnique = vi.fn().mockResolvedValue(null)
    const upsert = vi.fn().mockResolvedValue(undefined)
    const get = vi
      .fn<() => Promise<KufarHttpResult>>()
      .mockResolvedValueOnce(failure(503, 'http-5xx'))
      .mockResolvedValueOnce(success(detail))
    const prisma = { listing: { findUnique, upsert } } as unknown as PrismaClient
    const cache = new ListingDescriptionCache(
      prisma,
      { get } as unknown as Pick<KufarHttpClient, 'get'>,
      () => NOW,
    )

    await expect(cache.ensureDescription(LISTING)).rejects.toBeInstanceOf(KufarSourceRequestError)
    const result: ListingDescriptionResult = await cache.ensureDescription(LISTING)

    expect(result).toMatchObject({ kind: 'available', source: 'network' })
    expect(get).toHaveBeenCalledTimes(2)
  })
})
