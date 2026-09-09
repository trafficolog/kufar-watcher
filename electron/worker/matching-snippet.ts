import type { ListingMatchField, ListingMatchHit } from './listing-matcher'

const NON_WHITESPACE = /\S+/gu

interface WordSpan {
  start: number
  end: number
}

export interface MatchingSnippetInput {
  text: string
  field: ListingMatchField
  hits: readonly ListingMatchHit[]
  maxLength: number
}

function getWords(text: string): WordSpan[] {
  return [...text.matchAll(NON_WHITESPACE)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }))
}

function renderSnippet(text: string, words: readonly WordSpan[], left: number, right: number): string {
  const leftWord = words[left]!
  const rightWord = words[right]!
  const prefix = left > 0 ? '… ' : ''
  const suffix = right < words.length - 1 ? ' …' : ''
  return `${prefix}${text.slice(leftWord.start, rightWord.end)}${suffix}`
}

export function extractMatchingSnippet(input: MatchingSnippetInput): string | null {
  if (input.maxLength <= 0) return null
  if (input.field === 'title' && input.text.length <= input.maxLength) return null

  const matchingHits = input.hits.filter(
    ({ field, kind }) => field === input.field && kind === 'include',
  )
  matchingHits.sort((left, right) => left.start - right.start)
  const hit = matchingHits[0]

  if (!hit) return null

  const words = getWords(input.text)
  if (words.length === 0) return null

  const anchor = words.findIndex(({ start, end }) => start < hit.end && end > hit.start)
  if (anchor === -1) return null

  let left = anchor
  let right = anchor
  if (renderSnippet(input.text, words, left, right).length > input.maxLength) return null

  while (true) {
    const candidates = [
      left > 0 ? { left: left - 1, right } : null,
      right < words.length - 1 ? { left, right: right + 1 } : null,
    ].filter((candidate): candidate is { left: number; right: number } => candidate !== null)

    const fitting = candidates.filter(
      (candidate) =>
        renderSnippet(input.text, words, candidate.left, candidate.right).length <= input.maxLength,
    )

    if (fitting.length === 0) break

    fitting.sort((first, second) => {
      const firstLeft = hit.start - words[first.left]!.start
      const firstRight = words[first.right]!.end - hit.end
      const secondLeft = hit.start - words[second.left]!.start
      const secondRight = words[second.right]!.end - hit.end
      return Math.abs(firstLeft - firstRight) - Math.abs(secondLeft - secondRight)
    })

    const next = fitting[0]!
    left = next.left
    right = next.right
  }

  if (left === 0 && right === words.length - 1) {
    return input.field === 'title'
      ? null
      : input.text.slice(words[0]!.start, words[words.length - 1]!.end)
  }

  return renderSnippet(input.text, words, left, right)
}
