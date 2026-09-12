const LEADING_PUNCTUATION = /^\p{P}+/u
const TRAILING_PUNCTUATION = /\p{P}+$/u
const NON_WHITESPACE = /\S+/gu
const GLOB_PLACEHOLDER = '\uE000'

function normalizeToken(value: string): string {
  return value.toLowerCase().replaceAll('ё', 'е')
}

function matchingTokenSource(
  rawToken: string,
  options: { preserveGlob?: boolean } = {},
): { sourceToken: string; leadingLength: number } {
  const edgeComparable = options.preserveGlob
    ? rawToken.replaceAll('*', GLOB_PLACEHOLDER)
    : rawToken
  const leadingLength = edgeComparable.match(LEADING_PUNCTUATION)?.[0].length ?? 0
  const trailingLength = edgeComparable.match(TRAILING_PUNCTUATION)?.[0].length ?? 0

  return {
    sourceToken: rawToken.slice(leadingLength, rawToken.length - trailingLength),
    leadingLength,
  }
}

export interface MatchingTokenSpan {
  value: string
  start: number
  end: number
}

export function normalizeMatchingText(value: string): string {
  return normalizeToken(value).trim().replace(/\s+/gu, ' ')
}

export function normalizeMatchingTermTokens(value: string): string[] {
  const tokens: string[] = []

  for (const match of value.matchAll(NON_WHITESPACE)) {
    const { sourceToken } = matchingTokenSource(match[0], { preserveGlob: true })
    if (sourceToken.length > 0) tokens.push(normalizeToken(sourceToken))
  }

  return tokens
}

export function tokenizeMatchingTextWithSpans(value: string): MatchingTokenSpan[] {
  const tokens: MatchingTokenSpan[] = []

  for (const match of value.matchAll(NON_WHITESPACE)) {
    const rawToken = match[0]
    const rawStart = match.index
    const { sourceToken, leadingLength } = matchingTokenSource(rawToken)

    if (sourceToken.length === 0) continue

    const start = rawStart + leadingLength
    const normalizedToken = normalizeToken(sourceToken)
    tokens.push({ value: normalizedToken, start, end: start + sourceToken.length })

    if (sourceToken.includes('-')) {
      let offset = 0

      for (const part of sourceToken.split('-')) {
        if (part.length > 0) {
          tokens.push({
            value: normalizeToken(part),
            start: start + offset,
            end: start + offset + part.length,
          })
        }

        offset += part.length + 1
      }
    }
  }

  return tokens
}

export function tokenizeMatchingText(value: string): string[] {
  return tokenizeMatchingTextWithSpans(value).map(({ value: token }) => token)
}
