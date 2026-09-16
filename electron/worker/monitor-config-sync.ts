import type { PrismaClient } from '../../generated/prisma/client'
import type { MonitorCreateInput, MonitorCreateResult } from '../../shared/ipc'
import { buildKufarApiUrl } from '../../shared/kufar-url'
import type { AcquireMonitorRunLease } from './monitor-run-lease'
import {
  createMonitorConfig,
  updateMonitorConfig,
  parsePersistedCanonicalQuery,
  type MonitorConfigPatch,
} from './monitor-config-persistence'

export class MonitorStateBusyError extends Error {
  constructor() {
    super('Monitor is running; retry after the current traversal')
    this.name = 'MonitorStateBusyError'
  }
}

export class MonitorStateTransitionError extends Error {
  constructor() {
    super('Archived monitor can only be restored to active')
    this.name = 'MonitorStateTransitionError'
  }
}

export interface MonitorSchedulerSync {
  syncMonitor(monitorId: number): Promise<void>
}

export async function createMonitorConfigAndSync(
  prisma: PrismaClient,
  scheduler: MonitorSchedulerSync,
  input: MonitorCreateInput,
): Promise<MonitorCreateResult> {
  const result = await createMonitorConfig(prisma, input)
  await scheduler.syncMonitor(result.monitorId)
  return result
}

export async function setMonitorStateAndSync(
  prisma: PrismaClient,
  scheduler: MonitorSchedulerSync,
  acquireRunLease: AcquireMonitorRunLease,
  monitorId: number,
  state: 'active' | 'paused' | 'archived',
): Promise<void> {
  const lease = await acquireRunLease(monitorId)
  if (!lease) throw new MonitorStateBusyError()

  try {
    const current = await prisma.monitor.findUniqueOrThrow({
      where: { id: monitorId },
      select: { state: true, query: true },
    })
    if (current.state === 'archived' && state !== 'archived') {
      if (state !== 'active') throw new MonitorStateTransitionError()
      // Validate legacy persisted mappings before a destructive cursor reset or schedule creation.
      buildKufarApiUrl(parsePersistedCanonicalQuery(current.query))
    }
    await updateMonitorConfigAndSync(prisma, scheduler, monitorId, { state })
  } finally {
    await lease.release()
  }
}

export async function updateMonitorConfigAndSync(
  prisma: PrismaClient,
  scheduler: MonitorSchedulerSync,
  monitorId: number,
  patch: MonitorConfigPatch,
): Promise<void> {
  await updateMonitorConfig(prisma, monitorId, patch)
  await scheduler.syncMonitor(monitorId)
}
