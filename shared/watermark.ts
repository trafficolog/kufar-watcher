import type { Listing } from './listing'

export interface Watermark {
  boundaryTime: string
  boundaryIds: readonly string[]
}

export interface WatermarkCatchUpObservation {
  page: number
  index: number
  listId: string
  listTime: string
}

export interface WatermarkCatchUpCheckpoint {
  resumeCursor: string
  pendingWatermark: Watermark
  pagesRead: number
  lastObservation: WatermarkCatchUpObservation | null
}

interface WatermarkTraversalResultBase {
  newListings: Listing[]
  nextWatermark: Watermark
  pagesRead: number
}

export type WatermarkTraversalResult =
  | (WatermarkTraversalResultBase & {
      possibleMiss: false
    })
  | (WatermarkTraversalResultBase & {
      possibleMiss: true
      checkpoint: WatermarkCatchUpCheckpoint
    })
