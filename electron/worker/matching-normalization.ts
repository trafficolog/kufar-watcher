const LEADING_PUNCTUATION = /^\p{P}+/u
const TRAILING_PUNCTUATION = /\p{P}+$/u

function stripEdgePunctuation(value: string): string {
  return value.replace(LEADING_PUNCTUATION, '').replace(TRAILING_PUNCTUATION, '')
}

export function normalizeMatchingText(value: string): string {
  return value.toLowerCase().replaceAll('ё', 'е').trim().replace(/\s+/gu, ' ')
}

export function tokenizeMatchingText(value: string): string[] {
  const normalized = normalizeMatchingText(value)
  if (normalized.length === 0) return []

  const tokens: string[] = []

  for (const rawToken of normalized.split(' ')) {
    const token = stripEdgePunctuation(rawToken)
    if (token.length === 0) continue

    tokens.push(token)

    if (token.includes('-')) {
      for (const part of token.split('-')) {
        if (part.length > 0) tokens.push(part)
      }
    }
  }

  return tokens
}
