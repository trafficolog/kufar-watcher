import type { PrismaClient } from '../../generated/prisma/client'
import type { Listing } from '../../shared/listing'
import type { KufarHttpClient } from './kufar-http-client'
import { hasKufarListingNotFoundCode, parseKufarListingDescription } from './kufar-listing-detail'
import { KufarSourceRequestError } from './kufar-source-request-error'
import { listingCreateData } from './listing-persistence-data'

export type ListingDescriptionResult =
  | {
      kind: 'available'
      description: string | null
      source: 'cache' | 'network'
    }
  | {
      kind: 'unavailable'
      source: 'cache' | 'network'
    }

export class ListingDescriptionCache {
  private readonly inFlight = new Map<string, Promise<ListingDescriptionResult>>()

  constructor(
    private readonly prisma: PrismaClient,
    private readonly httpClient: Pick<KufarHttpClient, 'get'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureDescription(listing: Listing): Promise<ListingDescriptionResult> {
    const pending = this.inFlight.get(listing.listId)
    if (pending) return pending

    const operation = this.ensureDescriptionOnce(listing)
    this.inFlight.set(listing.listId, operation)

    try {
      return await operation
    } finally {
      if (this.inFlight.get(listing.listId) === operation) {
        this.inFlight.delete(listing.listId)
      }
    }
  }

  private async ensureDescriptionOnce(listing: Listing): Promise<ListingDescriptionResult> {
    const cached = await this.prisma.listing.findUnique({
      where: { listId: listing.listId },
      select: {
        availability: true,
        description: true,
        descriptionLoadedAt: true,
      },
    })

    if (cached?.availability === 'unavailable') {
      return { kind: 'unavailable', source: 'cache' }
    }

    if (cached?.descriptionLoadedAt != null) {
      return {
        kind: 'available',
        description: cached.description,
        source: 'cache',
      }
    }

    const detailUrl = new URL(
      `https://api.kufar.by/search-api/v2/item/${encodeURIComponent(listing.listId)}/rendered?lang=ru`,
    )
    const response = await this.httpClient.get(detailUrl)

    if (!response.ok) {
      if (
        response.status === 404 &&
        response.body !== undefined &&
        hasKufarListingNotFoundCode(response.body)
      ) {
        await this.prisma.listing.upsert({
          where: { listId: listing.listId },
          create: {
            ...listingCreateData(listing),
            availability: 'unavailable',
          },
          update: {
            availability: 'unavailable',
            descriptionLoadedAt: null,
          },
        })

        return { kind: 'unavailable', source: 'network' }
      }

      throw new KufarSourceRequestError(
        `Failed to load Kufar listing detail for ${listing.listId}`,
        response,
      )
    }

    const description = parseKufarListingDescription(response.body)
    const descriptionLoadedAt = this.now()

    await this.prisma.listing.upsert({
      where: { listId: listing.listId },
      create: {
        ...listingCreateData(listing),
        description,
        descriptionLoadedAt,
        availability: 'available',
      },
      update: {
        description,
        descriptionLoadedAt,
        availability: 'available',
      },
    })

    return {
      kind: 'available',
      description,
      source: 'network',
    }
  }
}
