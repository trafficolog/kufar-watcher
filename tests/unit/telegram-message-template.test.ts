import { describe, expect, it } from 'vitest'

interface TelegramMessageTemplateInput {
  monitorName: string
  title: string
  priceKind: 'fixed' | 'negotiable' | 'free' | 'unknown'
  priceAmount: string | null
  currency: string | null
  region: string | null
  url: string
  snippet: string | null
}

type FormatTelegramMessage = (input: TelegramMessageTemplateInput) => string

async function loadFormatter(): Promise<FormatTelegramMessage | undefined> {
  const modulePath = '../../electron/worker/telegram-message-template'
  try {
    const module = (await import(modulePath)) as { formatTelegramMessage?: FormatTelegramMessage }
    return module.formatTelegramMessage
  } catch {
    return undefined
  }
}

function baseInput(
  overrides: Partial<TelegramMessageTemplateInput> = {},
): TelegramMessageTemplateInput {
  return {
    monitorName: 'Игровые приставки',
    title: 'Sony PlayStation 5',
    priceKind: 'fixed',
    priceAmount: '1999.00',
    currency: 'BYN',
    region: 'Минск',
    url: 'https://www.kufar.by/item/123',
    snippet: null,
    ...overrides,
  }
}

describe('Telegram message template', () => {
  it('escapes untrusted text while preserving trusted HTML structure', async () => {
    const formatTelegramMessage = await loadFormatter()
    expect(formatTelegramMessage).toBeTypeOf('function')

    const message = formatTelegramMessage?.(
      baseInput({
        monitorName: 'Монитор & <важный>',
        title: 'PS5 <Pro> & "Slim"',
        region: 'Минск & область',
        snippet: 'Описание <b>не разметка</b> & детали',
        url: 'https://www.kufar.by/item/123?a=1&b=2',
      }),
    )

    expect(message).toBe(
      [
        '<b>Монитор &amp; &lt;важный&gt;</b>',
        'PS5 &lt;Pro&gt; &amp; "Slim"',
        'Цена: 1999.00 BYN',
        'Регион: Минск &amp; область',
        'Описание: Описание &lt;b&gt;не разметка&lt;/b&gt; &amp; детали',
        'https://www.kufar.by/item/123?a=1&amp;b=2',
      ].join('\n'),
    )
  })

  it('renders negotiable price in words and omits absent optional fields', async () => {
    const formatTelegramMessage = await loadFormatter()
    expect(formatTelegramMessage).toBeTypeOf('function')

    const message = formatTelegramMessage?.(
      baseInput({
        priceKind: 'negotiable',
        priceAmount: null,
        currency: null,
        region: null,
        snippet: null,
      }),
    )

    expect(message).toBe(
      [
        '<b>Игровые приставки</b>',
        'Sony PlayStation 5',
        'Цена: Договорная',
        'https://www.kufar.by/item/123',
      ].join('\n'),
    )
  })

  it.each([
    { priceKind: 'free' as const, expected: 'Цена: Бесплатно' },
    { priceKind: 'unknown' as const, expected: 'Цена: Цена не указана' },
  ])('renders $priceKind price explicitly', async ({ priceKind, expected }) => {
    const formatTelegramMessage = await loadFormatter()
    expect(formatTelegramMessage).toBeTypeOf('function')

    const message = formatTelegramMessage?.(
      baseInput({ priceKind, priceAmount: null, currency: null }),
    )

    expect(message).toContain(expected)
  })

  it('truncates optional snippet before core listing fields', async () => {
    const formatTelegramMessage = await loadFormatter()
    expect(formatTelegramMessage).toBeTypeOf('function')

    const input = baseInput({ snippet: `Описание ${'деталь & <тег> '.repeat(600)}` })
    const message = formatTelegramMessage?.(input)

    expect(message?.length).toBeLessThanOrEqual(4096)
    expect(message).toContain('<b>Игровые приставки</b>')
    expect(message).toContain('Sony PlayStation 5')
    expect(message).toContain('https://www.kufar.by/item/123')
    expect(message).not.toMatch(/&(?!amp;|lt;|gt;)/)
  })

  it('keeps an extremely long escaped title within the Telegram limit', async () => {
    const formatTelegramMessage = await loadFormatter()
    expect(formatTelegramMessage).toBeTypeOf('function')

    const message = formatTelegramMessage?.(
      baseInput({
        title: `Очень длинный & <заголовок> ${'🎮'.repeat(5000)}`,
        snippet: null,
      }),
    )

    expect(message?.length).toBeLessThanOrEqual(4096)
    expect(message).toContain('<b>Игровые приставки</b>')
    expect(message).toContain('Цена: 1999.00 BYN')
    expect(message).toContain('https://www.kufar.by/item/123')
    expect(message).not.toMatch(/&(?!amp;|lt;|gt;)/)
  })
})
