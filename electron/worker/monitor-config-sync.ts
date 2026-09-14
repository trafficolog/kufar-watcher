import type { PrismaClient } from '../../generated/prisma/client'
import type { MonitorCreateInput, MonitorCreateResult } from '../../shared/ipc'
import {
  createMonitorConfig,
  updateMonitorConfig,
  type MonitorConfigPatch,
} from './monitor-config-persistence'

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

export async function updateMonitorConfigAndSync(
  prisma: PrismaClient,
  scheduler: MonitorSchedulerSync,
  monitorId: number,
  patch: MonitorConfigPatch,
): Promise<void> {
  await updateMonitorConfig(prisma, monitorId, patch)
  await scheduler.syncMonitor(monitorId)
}
