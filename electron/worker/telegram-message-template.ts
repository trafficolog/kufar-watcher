import type { PriceKind } from '../../shared/listing'

const TELEGRAM_MESSAGE_LIMIT = 4096
const ELLIPSIS = '…'

export interface TelegramMessageTemplateInput {
  monitorName: string
  title: string
  priceKind: PriceKind
  priceAmount: string | null
  currency: string | null
  region: string | null
  url: string
  snippet: string | null
}

interface MessageFields {
  monitorName: string
  title: string
  price: string
  region: string | null
  url: string
  snippet: string | null
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function formatPrice(input: TelegramMessageTemplateInput): string {
  switch (input.priceKind) {
    case 'negotiable':
      return 'Договорная'
    case 'free':
      return 'Бесплатно'
    case 'unknown':
      return 'Цена не указана'
    case 'fixed':
      if (input.priceAmount === null) return 'Цена не указана'
      return input.currency === null ? input.priceAmount : `${input.priceAmount} ${input.currency}`
  }
}

function renderMessage(fields: MessageFields): string {
  const lines = [
    `<b>${escapeHtml(fields.monitorName)}</b>`,
    escapeHtml(fields.title),
    `Цена: ${escapeHtml(fields.price)}`,
  ]
  if (fields.region !== null) lines.push(`Регион: ${escapeHtml(fields.region)}`)
  if (fields.snippet !== null) lines.push(`Описание: ${escapeHtml(fields.snippet)}`)
  lines.push(escapeHtml(fields.url))
  return lines.join('\n')
}

function truncateToFit(value: string, renderWithValue: (candidate: string) => string): string {
  if (renderWithValue(value).length <= TELEGRAM_MESSAGE_LIMIT) return value

  const codePoints = Array.from(value)
  let low = 0
  let high = Math.max(0, codePoints.length - 1)
  let best = ''

  while (low <= high) {
    const midpoint = Math.floor((low + high) / 2)
    const candidate = `${codePoints.slice(0, midpoint).join('')}${ELLIPSIS}`
    if (renderWithValue(candidate).length <= TELEGRAM_MESSAGE_LIMIT) {
      best = candidate
      low = midpoint + 1
    } else {
      high = midpoint - 1
    }
  }

  return best
}

export function formatTelegramMessage(input: TelegramMessageTemplateInput): string {
  const fields: MessageFields = {
    monitorName: input.monitorName,
    title: input.title,
    price: formatPrice(input),
    region: input.region,
    url: input.url,
    snippet: input.snippet,
  }

  if (renderMessage(fields).length <= TELEGRAM_MESSAGE_LIMIT) return renderMessage(fields)

  if (fields.snippet !== null) {
    const withoutSnippet = { ...fields, snippet: null }
    if (renderMessage(withoutSnippet).length <= TELEGRAM_MESSAGE_LIMIT) {
      fields.snippet = truncateToFit(fields.snippet, (snippet) =>
        renderMessage({ ...fields, snippet }),
      )
      return renderMessage(fields)
    }
    fields.snippet = null
  }

  fields.title = truncateToFit(fields.title, (title) => renderMessage({ ...fields, title }))
  if (renderMessage(fields).length <= TELEGRAM_MESSAGE_LIMIT) return renderMessage(fields)

  fields.monitorName = truncateToFit(fields.monitorName, (monitorName) =>
    renderMessage({ ...fields, monitorName }),
  )
  if (renderMessage(fields).length <= TELEGRAM_MESSAGE_LIMIT) return renderMessage(fields)

  fields.region = null
  if (renderMessage(fields).length <= TELEGRAM_MESSAGE_LIMIT) return renderMessage(fields)

  fields.url = truncateToFit(fields.url, (url) => renderMessage({ ...fields, url }))
  if (renderMessage(fields).length <= TELEGRAM_MESSAGE_LIMIT) return renderMessage(fields)

  fields.price = truncateToFit(fields.price, (price) => renderMessage({ ...fields, price }))
  return renderMessage(fields)
}
