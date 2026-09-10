import type { PrismaClient } from '../../generated/prisma/client'
import {
  updateMonitorConfig,
  type MonitorConfigPatch,
} from './monitor-config-persistence'

export interface MonitorSchedulerSync {
  syncMonitor(monitorId: number): Promise<void>
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
