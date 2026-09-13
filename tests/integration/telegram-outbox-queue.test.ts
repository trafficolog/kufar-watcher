import { afterEach, describe, expect, it } from 'vitest'
import { PgBoss } from 'pg-boss'

import {
  createPgBossTelegramOutboxQueue,
  type TelegramOutboxPayload,
} from '../../electron/worker/telegram-outbox-queue'

const integration = process.env.KUFAR_POSTGRES_INTEGRATION === '1' ? describe : describe.skip
const QUEUE_NAME = 'telegram-outbox'

function databaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for Telegram outbox integration')
  return value
}

async function deleteOutboxQueue(): Promise<void> {
  const boss = new PgBoss({ connectionString: databaseUrl(), schedule: false })
  await boss.start()
  try {
    if (await boss.getQueue(QUEUE_NAME)) {
      await boss.deleteQueue(QUEUE_NAME)
    }
  } finally {
    await boss.stop()
  }
}

async function seedPendingJob(payload: TelegramOutboxPayload): Promise<void> {
  const boss = new PgBoss({ connectionString: databaseUrl(), schedule: false })
  await boss.start()
  try {
    await boss.createQueue(QUEUE_NAME, {
      retryLimit: 5,
      retryDelay: 5,
      retryBackoff: true,
      retryDelayMax: 60,
    })
    const jobId = await boss.send(QUEUE_NAME, payload)
    expect(jobId).not.toBeNull()
  } finally {
    await boss.stop()
  }
}

async function waitForPayload(received: TelegramOutboxPayload[]): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (received.length > 0) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Timed out waiting for persisted Telegram outbox job')
}

integration('PostgreSQL pg-boss Telegram outbox', () => {
  afterEach(async () => {
    await deleteOutboxQueue()
  })

  it('delivers a pending job after the queue process is recreated', async () => {
    await deleteOutboxQueue()
    const payload = {
      matchId: 931_313,
      chatId: '1001',
      text: 'restart-survival',
    } satisfies TelegramOutboxPayload

    await seedPendingJob(payload)

    const received: TelegramOutboxPayload[] = []
    const errors: unknown[] = []
    const restartedQueue = createPgBossTelegramOutboxQueue(databaseUrl(), (error) => {
      errors.push(error)
    })

    try {
      await restartedQueue.start(async (job) => {
        received.push(job)
      })
      await waitForPayload(received)

      expect(received).toEqual([payload])
      expect(errors).toEqual([])
    } finally {
      await restartedQueue.stop()
    }
  })
})
