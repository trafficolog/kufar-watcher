import { describe, expect, it } from 'vitest'

import { monitorIntervalCron, monitorQueueName } from '../../electron/worker/monitor-scheduler'

describe('monitor scheduler contract', () => {
  it('derives a stable queue name from monitor id', () => {
    expect(monitorQueueName(42)).toBe('monitor-run:42')
  })

  it.each([
    [60, '* * * * *'],
    [120, '*/2 * * * *'],
    [300, '*/5 * * * *'],
    [600, '*/10 * * * *'],
    [900, '*/15 * * * *'],
    [3600, '0 * * * *'],
  ])('maps %i seconds to %s', (intervalSec, cron) => {
    expect(monitorIntervalCron(intervalSec)).toBe(cron)
  })

  it('rejects unsupported persisted intervals instead of rounding', () => {
    expect(() => monitorIntervalCron(180)).toThrow(/unsupported monitor interval/i)
  })
})
