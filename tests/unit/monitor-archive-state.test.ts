import { describe, expect, it, vi } from 'vitest'
import type { Prisma, PrismaClient } from '../../generated/prisma/client'
import {
  MonitorStateBusyError,
  MonitorStateTransitionError,
  setMonitorStateAndSync,
} from '../../electron/worker/monitor-config-sync'
import { KufarUrlBuildError } from '../../shared/kufar-url'
import { createScheduledMonitorRunExecutor } from '../../electron/worker/scheduled-monitor-run'
import { createTelegramOutboxDelivery } from '../../electron/worker/telegram-outbox-delivery'

function persistedQuery(region: string | null = 'minsk') {
  return {
    host: 'www.kufar.by',
    category: 'igry-i-pristavki',
    query: null,
    region,
    sellerType: null,
    sort: 'lst.d',
    operation: null,
    pathFilters: [],
    extraParams: {},
  }
}

function harness(initialState: 'active' | 'paused' | 'archived', region: string | null = 'minsk') {
  const calls: string[] = []
  const row = {
    sourceUrl: 'https://www.kufar.by/l/r~minsk/igry-i-pristavki',
    query: persistedQuery(region),
    state: initialState,
  }
  const tx = {
    monitor: {
      findUniqueOrThrow: vi.fn().mockImplementation(async () => row),
      update: vi
        .fn()
        .mockImplementation(async ({ data }: { data: { state?: typeof row.state } }) => {
          row.state = data.state ?? row.state
          calls.push(`update:${row.state}`)
        }),
    },
    monitorCursor: {
      deleteMany: vi.fn().mockImplementation(async () => {
        calls.push('cursor-reset')
      }),
    },
  } as unknown as Prisma.TransactionClient
  const prisma = {
    monitor: { findUniqueOrThrow: vi.fn().mockImplementation(async () => row) },
    $transaction: vi
      .fn()
      .mockImplementation(async (callback: (tx: Prisma.TransactionClient) => Promise<void>) => {
        await callback(tx)
        calls.push('commit')
      }),
  } as unknown as PrismaClient
  const scheduler = {
    syncMonitor: vi.fn().mockImplementation(async () => {
      calls.push('reconcile')
    }),
  }
  const release = vi.fn().mockImplementation(async () => {
    calls.push('release')
  })
  const acquire = vi.fn().mockResolvedValue({ release })
  return { prisma, scheduler, acquire, calls, row, tx, release }
}

describe('reversible MVP archive state mutation', () => {
  it('archives through transaction then scheduler without deleting cursor or history', async () => {
    const h = harness('active')
    await setMonitorStateAndSync(h.prisma, h.scheduler, h.acquire, 1, 'archived')
    expect(h.row.state).toBe('archived')
    expect(h.calls).toEqual(['update:archived', 'commit', 'reconcile', 'release'])
    expect(h.tx.monitorCursor.deleteMany).not.toHaveBeenCalled()
    expect(h.acquire).toHaveBeenCalledWith(1)
  })

  it('does not mutate a monitor while another traversal owns its lease', async () => {
    const h = harness('active')
    h.acquire.mockResolvedValue(null)
    await expect(
      setMonitorStateAndSync(h.prisma, h.scheduler, h.acquire, 1, 'archived'),
    ).rejects.toBeInstanceOf(MonitorStateBusyError)
    expect(h.calls).toEqual([])
  })

  it('refuses to restore a legacy unsupported query without changing state or cursor', async () => {
    const h = harness('archived', null)
    await expect(
      setMonitorStateAndSync(h.prisma, h.scheduler, h.acquire, 1, 'active'),
    ).rejects.toBeInstanceOf(KufarUrlBuildError)
    expect(h.row.state).toBe('archived')
    expect(h.calls).toEqual(['release'])
  })

  it('restores a supported query and resets its cursor only after validation', async () => {
    const h = harness('archived')
    await setMonitorStateAndSync(h.prisma, h.scheduler, h.acquire, 1, 'active')
    expect(h.row.state).toBe('active')
    expect(h.calls).toEqual(['update:active', 'cursor-reset', 'commit', 'reconcile', 'release'])
  })

  it('does not allow archived-to-paused to bypass restore validation', async () => {
    const h = harness('archived', null)
    await expect(
      setMonitorStateAndSync(h.prisma, h.scheduler, h.acquire, 1, 'paused'),
    ).rejects.toBeInstanceOf(MonitorStateTransitionError)
    expect(h.calls).toEqual(['release'])
  })

  it('skips a queued archived monitor without constructing an adapter or fetching Kufar', async () => {
    const runUpdate = vi.fn().mockResolvedValue(undefined)
    const prisma = {
      monitor: {
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ state: 'archived', query: persistedQuery() }),
      },
      run: {
        create: vi.fn().mockResolvedValue({ id: 5 }),
        update: runUpdate,
      },
    } as unknown as PrismaClient
    const createRunAdapters = vi.fn(() => {
      throw new Error('Adapter must not be constructed')
    })
    const executor = createScheduledMonitorRunExecutor({
      prisma,
      acquireMonitorRunLease: vi
        .fn()
        .mockResolvedValue({ release: vi.fn().mockResolvedValue(undefined) }),
      createRunAdapters,
      maxPages: 5,
      descriptionLoader: { ensureDescription: vi.fn() },
      runCycle: vi.fn() as never,
    })
    await expect(executor(1)).resolves.toEqual({ cycleKind: 'skipped-inactive' })
    expect(createRunAdapters).not.toHaveBeenCalled()
    expect(prisma.run.create).not.toHaveBeenCalled()
    expect(runUpdate).not.toHaveBeenCalled()
  })

  it('does not deliver queued Telegram notifications from archived monitors', async () => {
    const repository = {
      getNotifiedAt: vi.fn().mockResolvedValue(null),
      isMonitorNotArchived: vi.fn().mockResolvedValue(false),
      markSending: vi.fn(),
      markNotified: vi.fn(),
    }
    const sendMessage = vi.fn()
    const delivery = createTelegramOutboxDelivery({ repository, sendMessage })
    await delivery({
      matchId: 11,
      chatId: '42',
      text: 'archived',
      openUrl: 'https://kufar.by/item/1',
    })
    expect(sendMessage).not.toHaveBeenCalled()
    expect(repository.markSending).not.toHaveBeenCalled()
  })

  it('rechecks archive state after Telegram throttle sleep', async () => {
    let archived = false
    const repository = {
      getNotifiedAt: vi.fn().mockResolvedValue(null),
      isMonitorNotArchived: vi.fn().mockImplementation(async () => !archived),
      markSending: vi.fn(),
      markNotified: vi.fn(),
    }
    const sendMessage = vi.fn()
    const delivery = createTelegramOutboxDelivery({
      repository,
      sendMessage,
      now: () => new Date('2026-09-16T08:00:00Z'),
      sleep: async () => {
        archived = true
      },
    })
    await delivery({ matchId: 1, chatId: '42', text: 'first', openUrl: 'https://kufar.by/item/1' })
    await delivery({ matchId: 2, chatId: '42', text: 'second', openUrl: 'https://kufar.by/item/2' })
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })
})
