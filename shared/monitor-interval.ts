const MONITOR_INTERVAL_CRON = new Map<number, string>([
  [60, '* * * * *'],
  [120, '*/2 * * * *'],
  [300, '*/5 * * * *'],
  [600, '*/10 * * * *'],
  [900, '*/15 * * * *'],
  [3600, '0 * * * *'],
])

export const SUPPORTED_MONITOR_INTERVALS = [60, 120, 300, 600, 900, 3600] as const

export type MonitorIntervalSec = (typeof SUPPORTED_MONITOR_INTERVALS)[number]

export class UnsupportedMonitorIntervalError extends Error {
  readonly intervalSec: number

  constructor(intervalSec: number) {
    super(`Unsupported monitor interval: ${intervalSec}`)
    this.name = 'UnsupportedMonitorIntervalError'
    this.intervalSec = intervalSec
  }
}

export function isSupportedMonitorInterval(intervalSec: number): intervalSec is MonitorIntervalSec {
  return MONITOR_INTERVAL_CRON.has(intervalSec)
}

export function assertSupportedMonitorInterval(
  intervalSec: number,
): asserts intervalSec is MonitorIntervalSec {
  if (!isSupportedMonitorInterval(intervalSec)) {
    throw new UnsupportedMonitorIntervalError(intervalSec)
  }
}

export function monitorIntervalCron(intervalSec: number): string {
  assertSupportedMonitorInterval(intervalSec)
  return MONITOR_INTERVAL_CRON.get(intervalSec) as string
}
