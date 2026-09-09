import type { Prisma } from '../../generated/prisma/client'
import type { WatermarkCatchUpCheckpoint } from '../../shared/watermark'

export async function persistCatchUpCheckpoint(
  tx: Prisma.TransactionClient,
  monitorId: number,
  checkpoint: WatermarkCatchUpCheckpoint | null,
): Promise<void> {
  if (checkpoint === null) {
    await tx.monitorCatchUpCheckpoint.deleteMany({ where: { monitorId } })
    return
  }

  const lastObservation = checkpoint.lastObservation
  const data = {
    resumeCursor: checkpoint.resumeCursor,
    pendingBoundaryTime: new Date(checkpoint.pendingWatermark.boundaryTime),
    pendingBoundaryIds: [...checkpoint.pendingWatermark.boundaryIds],
    pagesRead: checkpoint.pagesRead,
    lastPage: lastObservation?.page ?? null,
    lastIndex: lastObservation?.index ?? null,
    lastListId: lastObservation?.listId ?? null,
    lastListTime: lastObservation === null ? null : new Date(lastObservation.listTime),
  }

  await tx.monitorCatchUpCheckpoint.upsert({
    where: { monitorId },
    create: { monitorId, ...data },
    update: data,
  })
}
