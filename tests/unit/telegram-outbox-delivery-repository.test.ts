import type { PrismaClient } from '../../generated/prisma/client'
import { describe, expect, it, vi } from 'vitest'

import { createPrismaTelegramOutboxDeliveryRepository } from '../../electron/worker/telegram-outbox-delivery-repository'

function createHarness() {
  const findUnique = vi.fn()
  const updateMany = vi.fn(async () => ({ count: 1 }))
  const prisma = {
    match: {
      findUnique,
      updateMany,
    },
  } as unknown as PrismaClient

  return {
    repository: createPrismaTelegramOutboxDeliveryRepository(prisma),
    findUnique,
    updateMany,
  }
}

describe('Prisma Telegram outbox delivery repository', () => {
  it('distinguishes a deleted match from a pending notification', async () => {
    const harness = createHarness()

    harness.findUnique.mockResolvedValueOnce(null)
    await expect(harness.repository.getNotifiedAt(41)).resolves.toBeUndefined()

    harness.findUnique.mockResolvedValueOnce({ notifiedAt: null })
    await expect(harness.repository.getNotifiedAt(42)).resolves.toBeNull()

    expect(harness.findUnique).toHaveBeenNthCalledWith(1, {
      where: { id: 41 },
      select: { notifiedAt: true },
    })
    expect(harness.findUnique).toHaveBeenNthCalledWith(2, {
      where: { id: 42 },
      select: { notifiedAt: true },
    })
  })

  it('returns the persisted notification timestamp', async () => {
    const harness = createHarness()
    const notifiedAt = new Date('2026-09-13T12:00:00.000Z')
    harness.findUnique.mockResolvedValueOnce({ notifiedAt })

    await expect(harness.repository.getNotifiedAt(43)).resolves.toEqual(notifiedAt)
  })

  it('marks only an existing still-pending match as notified', async () => {
    const harness = createHarness()
    const notifiedAt = new Date('2026-09-13T12:01:00.000Z')

    await harness.repository.markNotified(44, notifiedAt)

    expect(harness.updateMany).toHaveBeenCalledWith({
      where: { id: 44, notifiedAt: null },
      data: { notifiedAt },
    })
  })
})
