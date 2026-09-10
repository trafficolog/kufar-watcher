import { describe, expect, it, vi } from 'vitest'

import {
  persistSuccessfulRun,
  type MonitorRunPersistenceInput,
} from '../../electron/worker/monitor-run-persistence'
import type { Prisma } from '../../generated/prisma/client'
import type { WatermarkTraversalResult } from '../../shared/watermark'

const STARTED_AT = new Date('2026-09-10T11:00:00.000Z')
const FINISHED_AT = new Date('2026-09-10T11:00:05.000Z')

function emptyTraversal(): WatermarkTraversalResult {
  return {
    kind: 'complete',
    newListings: [],
    nextWatermark: {
      boundaryTime: '2026-09-10T11:00:00.000Z',
      boundaryIds: ['known'],
    },
    pagesRead: 1,
    possibleMiss: false,
    checkpoint: null,
  }
}

describe('persistSuccessfulRun', () => {
  it('finalizes an existing scheduled incremental run with matched=0 and duration', async () => {
    const runCreate = vi.fn().mockResolvedValue(undefined)
    const runUpdate = vi.fn().mockResolvedValue(undefined)
    const tx = {
      run: { create: runCreate, update: runUpdate },
    } as unknown as Prisma.TransactionClient
    const input: MonitorRunPersistenceInput & { runId: number } = {
      monitorId: 17,
      runId: 9001,
      startedAt: STARTED_AT,
      finishedAt: FINISHED_AT,
      expectedCursorUpdatedAt: new Date('2026-09-10T10:59:00.000Z'),
      candidates: [],
      selected: [],
      traversal: emptyTraversal(),
    }

    await persistSuccessfulRun(tx, input)

    expect(runUpdate).toHaveBeenCalledWith({
      where: { id: 9001 },
      data: {
        finishedAt: FINISHED_AT,
        durationMs: 5_000,
        outcome: 'success',
        seen: 0,
        matched: 0,
        error: null,
        errorCategory: null,
        errorCode: null,
        httpStatus: null,
      },
    })
    expect(runUpdate.mock.calls[0]?.[0].data).not.toHaveProperty('degradedLevel')
    expect(runCreate).not.toHaveBeenCalled()
  })
})
