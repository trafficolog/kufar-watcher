import type { Listing } from './listing'

export interface Watermark {
  boundaryTime: string
  boundaryIds: readonly string[]
}

export interface WatermarkCatchupCheckpoint {
  resumeCursor: string
  pendingWatermark: Watermark
  lastObservation: {
    listId: string
    listTime: string
  } | null
}

export type WatermarkTraversalResult =
  | {
      kind: 'complete'
      newListings: Listing[]
      nextWatermark: Watermark
      pagesRead: number
      possibleMiss: false
      checkpoint: null
    }
  | {
      kind: 'incomplete'
      newListings: Listing[]
      nextWatermark: Watermark
      pagesRead: number
      possibleMiss: true
      checkpoint: WatermarkCatchupCheckpoint
    }
