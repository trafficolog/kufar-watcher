import { compileMatchingTerm } from './matching-term'

export type MatchingTermPredicate = (normalizedToken: string) => boolean

export interface MatchingTermCompiler {
  compile(term: string): MatchingTermPredicate
}

export const matchingTermCompiler: MatchingTermCompiler = {
  compile(term) {
    return compileMatchingTerm(term)
  },
}
