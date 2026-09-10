import { PgBoss } from 'pg-boss'

import type { MonitorScheduleQueue } from './monitor-scheduler'

export type PgBossFactory = (connectionString: string) => PgBoss

export function createPgBossScheduleQueue(
  databaseUrl: string,
  onError: (error: unknown) => void,
  factory: PgBossFactory = (connectionString) => new PgBoss({ connectionString }),
): MonitorScheduleQueue {
  void databaseUrl
  void onError
  void factory
  throw new Error('pg-boss schedule queue is not implemented')
}
