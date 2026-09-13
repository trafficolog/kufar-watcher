import { PgBoss } from 'pg-boss'

export interface TelegramOutboxPayload {
  matchId: number
  chatId: string
  text: string
}

export type TelegramOutboxHandler = (payload: TelegramOutboxPayload) => Promise<void>

export interface TelegramOutboxQueue {
  start(handler: TelegramOutboxHandler): Promise<void>
  enqueue(payload: TelegramOutboxPayload): Promise<void>
  stop(): Promise<void>
}

interface PgBossQueueOptions {
  retryLimit: number
  retryDelay: number
  retryBackoff: boolean
  retryDelayMax: number
}

interface PgBossOutboxJob {
  data: unknown
}

interface PgBossOutboxClient {
  on(event: 'error', listener: (error: unknown) => void): unknown
  start(): Promise<unknown>
  stop(): Promise<void>
  getQueue(name: string): Promise<unknown | null>
  createQueue(name: string, options: PgBossQueueOptions): Promise<unknown>
  send(name: string, data: object): Promise<string | null>
  work(
    name: string,
    options: { batchSize: number },
    handler: (jobs: PgBossOutboxJob[]) => Promise<void>,
  ): Promise<string>
  offWork(name: string, options: { id: string; wait: boolean }): Promise<void>
}

export type TelegramOutboxPgBossFactory = (connectionString: string) => PgBossOutboxClient

const OUTBOX_QUEUE_NAME = 'telegram-outbox'
const OUTBOX_QUEUE_OPTIONS = {
  retryLimit: 5,
  retryDelay: 5,
  retryBackoff: true,
  retryDelayMax: 60,
} as const satisfies PgBossQueueOptions

const defaultPgBossFactory: TelegramOutboxPgBossFactory = (connectionString) =>
  new PgBoss({ connectionString }) as unknown as PgBossOutboxClient

function parsePayload(value: unknown): TelegramOutboxPayload {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid Telegram outbox payload')
  }

  const matchId = Reflect.get(value, 'matchId')
  const chatId = Reflect.get(value, 'chatId')
  const text = Reflect.get(value, 'text')
  if (
    typeof matchId !== 'number' ||
    !Number.isInteger(matchId) ||
    matchId < 1 ||
    typeof chatId !== 'string' ||
    chatId.length === 0 ||
    typeof text !== 'string' ||
    text.length === 0
  ) {
    throw new Error('Invalid Telegram outbox payload')
  }

  return { matchId, chatId, text }
}

export function createPgBossTelegramOutboxQueue(
  databaseUrl: string,
  onError: (error: unknown) => void,
  factory: TelegramOutboxPgBossFactory = defaultPgBossFactory,
): TelegramOutboxQueue {
  const boss = factory(databaseUrl)
  boss.on('error', onError)
  let workerId: string | undefined

  return {
    async start(handler): Promise<void> {
      await boss.start()
      if ((await boss.getQueue(OUTBOX_QUEUE_NAME)) === null) {
        await boss.createQueue(OUTBOX_QUEUE_NAME, OUTBOX_QUEUE_OPTIONS)
      }
      workerId = await boss.work(OUTBOX_QUEUE_NAME, { batchSize: 1 }, async (jobs) => {
        const job = jobs[0]
        if (!job) throw new Error(`Empty pg-boss batch for ${OUTBOX_QUEUE_NAME}`)
        await handler(parsePayload(job.data))
      })
    },

    async enqueue(payload): Promise<void> {
      parsePayload(payload)
      await boss.send(OUTBOX_QUEUE_NAME, payload)
    },

    async stop(): Promise<void> {
      if (workerId) {
        await boss.offWork(OUTBOX_QUEUE_NAME, { id: workerId, wait: true })
        workerId = undefined
      }
      await boss.stop()
    },
  }
}
