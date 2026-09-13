import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createPrismaClient } from '../../electron/worker/prisma-client'
import {
  TELEGRAM_BOUND_CHAT_SETTING_KEY,
  createPrismaTelegramBindingRepository,
} from '../../electron/worker/telegram-binding-repository'

const integrationDescribe =
  process.env.KUFAR_POSTGRES_INTEGRATION === '1' ? describe : describe.skip

integrationDescribe('Telegram binding repository', () => {
  let prisma: ReturnType<typeof createPrismaClient>

  beforeAll(async () => {
    prisma = createPrismaClient()
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.setting.deleteMany({ where: { key: TELEGRAM_BOUND_CHAT_SETTING_KEY } })
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.setting.deleteMany({ where: { key: TELEGRAM_BOUND_CHAT_SETTING_KEY } })
  })

  it('persists and replaces the single bound chat id', async () => {
    const repository = createPrismaTelegramBindingRepository(prisma)

    await expect(repository.getBoundChatId()).resolves.toBeNull()

    await repository.setBoundChatId('1001')
    await expect(repository.getBoundChatId()).resolves.toBe('1001')

    await repository.setBoundChatId('2002')
    await expect(repository.getBoundChatId()).resolves.toBe('2002')

    const setting = await prisma.setting.findUniqueOrThrow({
      where: { key: TELEGRAM_BOUND_CHAT_SETTING_KEY },
    })
    expect(setting.value).toBe('2002')
  })

  it('treats a malformed non-string setting as unbound', async () => {
    await prisma.setting.create({
      data: {
        key: TELEGRAM_BOUND_CHAT_SETTING_KEY,
        value: { unexpected: 'shape' },
      },
    })
    const repository = createPrismaTelegramBindingRepository(prisma)

    await expect(repository.getBoundChatId()).resolves.toBeNull()
  })
})
