import { normalizeMatchingTermTokens } from './matching-normalization'

const REGEXP_SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/g

function escapeRegExp(value: string): string {
  return value.replace(REGEXP_SPECIAL_CHARACTERS, '\\$&')
}

export function compileMatchingTerm(term: string): (normalizedToken: string) => boolean {
  const normalizedTokens = normalizeMatchingTermTokens(term)
  const normalizedTerm = normalizedTokens[0]

  if (normalizedTokens.length !== 1 || normalizedTerm === undefined) {
    throw new Error('Matching term must normalize to exactly one token')
  }

  if (!normalizedTerm.includes('*')) {
    return (normalizedToken) => normalizedToken === normalizedTerm
  }

  const source = normalizedTerm.split('*').map(escapeRegExp).join('.*')
  const pattern = new RegExp(`^${source}$`, 'u')

  return (normalizedToken) => pattern.test(normalizedToken)
}
