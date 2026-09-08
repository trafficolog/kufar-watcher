import { Prisma, type PrismaClient } from '../../generated/prisma/client'
import type { Listing } from '../../shared/listing'
import type { Watermark } from '../../shared/watermark'

export interface MatchSelection {
  matchedTerms: readonly string[]
  matchedIn: readonly string[]
  snippet: string | null
}

export interface SelectedListing {
  listing: Listing
  selection: MatchSelection
}

export interface MonitorRunPersistenceInput {
  monitorId: number
  startedAt: Date
  finishedAt: Date
  candidates: readonly Listing[]
  selected: readonly SelectedListing[]
  nextWatermark: Watermark
}

function listingCreateData(listing: Listing): Prisma.ListingCreateInput {
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

function listingUpdateData(listing: Listing): Prisma.ListingUpdateInput {
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
    description: listing.description,
    raw: listing.raw === null ? Prisma.JsonNull : (listing.raw as Prisma.InputJsonValue),
  }
}

export async function persistListingsAndMatches(
  tx: Prisma.TransactionClient,
  input: MonitorRunPersistenceInput,
): Promise<void> {
  for (const listing of input.candidates) {
    await tx.listing.upsert({
      where: { listId: listing.listId },
      create: listingCreateData(listing),
      update: listingUpdateData(listing),
    })
  }

  for (const item of input.selected) {
    await tx.match.upsert({
      where: {
        monitorId_listingId: {
          monitorId: input.monitorId,
          listingId: item.listing.listId,
        },
      },
      create: {
        monitorId: input.monitorId,
        listingId: item.listing.listId,
        matchedTerms: [...item.selection.matchedTerms],
        matchedIn: [...item.selection.matchedIn],
        snippet: item.selection.snippet,
      },
      update: {},
    })
  }
}

export async function persistMonitorCursor(
  tx: Prisma.TransactionClient,
  input: MonitorRunPersistenceInput,
): Promise<void> {
  const data = {
    boundaryTime: new Date(input.nextWatermark.boundaryTime),
    boundaryIds: [...input.nextWatermark.boundaryIds],
    lastRunAt: input.finishedAt,
  }

  await tx.monitorCursor.upsert({
    where: { monitorId: input.monitorId },
    create: { monitorId: input.monitorId, ...data },
    update: data,
  })
}

export async function persistSuccessfulRun(
  tx: Prisma.TransactionClient,
  input: MonitorRunPersistenceInput,
): Promise<void> {
  await tx.run.create({
    data: {
      monitorId: input.monitorId,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      outcome: 'success',
      seen: input.candidates.length,
      matched: input.selected.length,
      error: null,
      httpStatus: null,
      degradedLevel: null,
    },
  })
}

export async function persistMonitorRunTransaction(
  tx: Prisma.TransactionClient,
  input: MonitorRunPersistenceInput,
): Promise<void> {
  await persistListingsAndMatches(tx, input)
  await persistMonitorCursor(tx, input)
  await persistSuccessfulRun(tx, input)
}

export async function commitMonitorRun(
  prisma: PrismaClient,
  input: MonitorRunPersistenceInput,
): Promise<void> {
  await prisma.$transaction((tx) => persistMonitorRunTransaction(tx, input))
}
