import type { PrismaClient } from '../../generated/prisma/client'
import type { Listing } from '../../shared/listing'
import type { CandidatePrefilter } from './incremental-monitor-run'

export async function createSellerBlockPrefilter(
  prisma: PrismaClient,
): Promise<CandidatePrefilter> {
  const rows = await prisma.sellerBlock.findMany({
    select: { accountId: true },
  })
  const blockedAccountIds = new Set(
    rows.map(({ accountId }) => accountId).filter((accountId) => accountId.length > 0),
  )

  return {
    async accept(listing: Listing) {
      const { accountId } = listing
      return accountId === null || accountId.length === 0 || !blockedAccountIds.has(accountId)
    },
  }
}

export function composeCandidatePrefilters(
  sellerBlockPrefilter: CandidatePrefilter,
  callerPrefilter?: CandidatePrefilter,
): CandidatePrefilter {
  if (callerPrefilter === undefined) return sellerBlockPrefilter

  return {
    async accept(listing: Listing) {
      if (!(await sellerBlockPrefilter.accept(listing))) return false
      return callerPrefilter.accept(listing)
    },
  }
}
