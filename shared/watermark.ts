import type { Listing } from './listing'

export interface Watermark {
  boundaryTime: string
  boundaryIds: readonly string[]
}

export interface WatermarkTraversalResult {
  newListings: Listing[]
  nextWatermark: Watermark
  pagesRead: number
  possibleMiss: boolean
}
