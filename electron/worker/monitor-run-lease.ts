import { Client } from 'pg'

export interface MonitorRunLease {
  release(): Promise<void>
}

export type AcquireMonitorRunLease = (monitorId: number) => Promise<MonitorRunLease | null>

const MONITOR_RUN_LOCK_NAMESPACE = 0x4b554641

export function createLocalMonitorRunLeaseAcquirer(): AcquireMonitorRunLease {
  const activeMonitorIds = new Set<number>()

  return async (monitorId) => {
    if (activeMonitorIds.has(monitorId)) return null

    activeMonitorIds.add(monitorId)
    let released = false
    return {
      async release() {
        if (released) return
        released = true
        activeMonitorIds.delete(monitorId)
      },
    }
  }
}

export function createPostgresMonitorRunLeaseAcquirer(
  connectionString: string,
): AcquireMonitorRunLease {
  return async (monitorId) => {
    const client = new Client({ connectionString })

    try {
      await client.connect()
      const result = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired',
        [MONITOR_RUN_LOCK_NAMESPACE, monitorId],
      )

      if (!result.rows[0]?.acquired) {
        await client.end()
        return null
      }

      let released = false
      return {
        async release() {
          if (released) return
          released = true
          await client.end()
        },
      }
    } catch (error) {
      await client.end().catch(() => undefined)
      throw error
    }
  }
}
