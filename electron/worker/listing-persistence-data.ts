import { Prisma } from '../../generated/prisma/client'
import type { Listing } from '../../shared/listing'

export function listingCreateData(listing: Listing): Prisma.ListingCreateInput {
  return {
    listId: listing.listId,
    title: listing.title,
    priceKind: listing.priceKind,
    priceAmount: listing.priceAmount,
    currency: listing.currency,
    url: listing.url,
    region: listing.region,
    accountId: listing.accountId,
    isCompany: listing.isCompany,
    listTime: new Date(listing.listTime),
    description: listing.description,
    raw: listing.raw === null ? Prisma.JsonNull : (listing.raw as Prisma.InputJsonValue),
  }
}

export function listingSearchUpdateData(listing: Listing): Prisma.ListingUpdateInput {
  return {
    title: listing.title,
    priceKind: listing.priceKind,
    priceAmount: listing.priceAmount,
    currency: listing.currency,
    url: listing.url,
    region: listing.region,
    accountId: listing.accountId,
    isCompany: listing.isCompany,
    listTime: new Date(listing.listTime),
    raw: listing.raw === null ? Prisma.JsonNull : (listing.raw as Prisma.InputJsonValue),
  }
}
