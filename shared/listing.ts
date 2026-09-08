export type PriceKind = 'fixed' | 'negotiable' | 'free' | 'unknown'

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export interface Listing {
  listId: string
  title: string
  priceKind: PriceKind
  priceAmount: string | null
  currency: string | null
  url: string
  region: string | null
  accountId: string | null
  isCompany: boolean | null
  listTime: string
  description: string | null
  raw: JsonValue
}
