export interface CanonicalQuery {
  host: string
  category: string | null
  query: string | null
  region: string | null
  sellerType: string | null
  sort: string | null
  operation: string | null
  pathFilters: string[]
  extraParams: Record<string, string[]>
}
