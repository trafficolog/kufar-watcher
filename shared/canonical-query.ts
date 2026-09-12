export type SellerType = 'private' | 'company'

export interface CanonicalQuery {
  host: string
  category: string | null
  query: string | null
  region: string | null
  sellerType: SellerType | null
  sort: string | null
  operation: string | null
  pathFilters: string[]
  extraParams: Record<string, string[]>
}
