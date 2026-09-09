export type MatchingTermPredicate = (normalizedToken: string) => boolean

export interface MatchingTermCompiler {
  compile(term: string): MatchingTermPredicate
}

export const matchingTermCompiler: MatchingTermCompiler = {
  compile() {
    return () => false
  },
}
