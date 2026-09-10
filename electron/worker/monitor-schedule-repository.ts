import type { PrismaClient } from '../../generated/prisma/client'
import type { MonitorScheduleRepository } from './monitor-scheduler'

export function createPrismaMonitorScheduleRepository(
  prisma: PrismaClient,
): MonitorScheduleRepository {
  return {
    async list() {
      return prisma.monitor.findMany({
        select: { id: true, intervalSec: true, state: true },
      })
    },
    async find(monitorId) {
      return prisma.monitor.findUnique({
        where: { id: monitorId },
        select: { id: true, intervalSec: true, state: true },
      })
    },
  }
}
