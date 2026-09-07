import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KUFAR_RATE_LIMITER_DEFAULTS,
  RateLimiter,
  kufarRateLimiter,
} from '../../electron/worker/kufar-rate-limiter'

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

const fixedLimiter = (random = 0): RateLimiter =>
  new RateLimiter({
    minIntervalMs: 100,
    jitterMinMs: 0,
    jitterMaxMs: 0,
    random: () => random,
  })

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
  })

  it('runs ten concurrent calls FIFO with concurrency one', async () => {
    const limiter = fixedLimiter()
    const starts: Array<{ id: number; at: number }> = []
    let inFlight = 0
    let maxInFlight = 0

    const promises = Array.from({ length: 10 }, (_, id) =>
      limiter.schedule(async () => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        starts.push({ id, at: Date.now() })
        await new Promise<void>((resolve) => setTimeout(resolve, 10))
        inFlight -= 1
        return id
      }),
    )

    await vi.runAllTimersAsync()

    await expect(Promise.all(promises)).resolves.toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(starts.map(({ id }) => id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(starts.map(({ at }) => at)).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900])
    expect(maxInFlight).toBe(1)
  })

  it.each([
    { random: 0, expectedGap: 2000 },
    { random: 0.9999999999999999, expectedGap: 5000 },
  ])(
    'maps production defaults to the inclusive cadence boundary',
    async ({ random, expectedGap }) => {
      const limiter = new RateLimiter({
        ...KUFAR_RATE_LIMITER_DEFAULTS,
        random: () => random,
      })
      const starts: number[] = []

      const first = limiter.schedule(async () => {
        starts.push(Date.now())
      })
      const second = limiter.schedule(async () => {
        starts.push(Date.now())
      })

      await vi.runAllTimersAsync()
      await Promise.all([first, second])

      expect(starts).toEqual([0, expectedGap])
    },
  )

  it('does not add another full wait after a long callback', async () => {
    const limiter = fixedLimiter()
    const starts: number[] = []
    const first = limiter.schedule(async () => {
      starts.push(Date.now())
      await new Promise<void>((resolve) => setTimeout(resolve, 250))
    })
    const second = limiter.schedule(async () => {
      starts.push(Date.now())
    })

    await vi.runAllTimersAsync()
    await Promise.all([first, second])
    expect(starts).toEqual([0, 250])
  })

  it('keeps the queue alive after an async rejection', async () => {
    const limiter = fixedLimiter()
    const failure = new Error('boom')
    const starts: number[] = []
    const first = limiter.schedule(async () => {
      starts.push(Date.now())
      throw failure
    })
    const second = limiter.schedule(async () => {
      starts.push(Date.now())
      return 'ok'
    })

    const rejected = expect(first).rejects.toBe(failure)
    await vi.runAllTimersAsync()
    await rejected
    await expect(second).resolves.toBe('ok')
    expect(starts).toEqual([0, 100])
  })

  it('keeps the queue alive after a synchronous callback throw', async () => {
    const limiter = fixedLimiter()
    const failure = new Error('sync boom')
    const first = limiter.schedule(() => {
      throw failure
    })
    const second = limiter.schedule(async () => 'ok')

    const rejected = expect(first).rejects.toBe(failure)
    await vi.runAllTimersAsync()
    await rejected
    await expect(second).resolves.toBe('ok')
  })

  it('rejects only the affected call for an invalid random value', async () => {
    const random = vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(0)
    const limiter = new RateLimiter({
      minIntervalMs: 100,
      jitterMinMs: 0,
      jitterMaxMs: 10,
      random,
    })
    const starts: number[] = []
    const first = limiter.schedule(async () => {
      starts.push(Date.now())
    })
    const invalid = limiter.schedule(async () => {
      starts.push(Date.now())
    })
    const third = limiter.schedule(async () => {
      starts.push(Date.now())
      return 'third'
    })

    await first
    const invalidExpectation = expect(invalid).rejects.toThrow(/random/i)
    await flushMicrotasks()
    await vi.runAllTimersAsync()
    await invalidExpectation
    await expect(third).resolves.toBe('third')
    expect(starts).toEqual([0, 100])
  })

  it.each([
    { minIntervalMs: -1, jitterMinMs: 0, jitterMaxMs: 0 },
    { minIntervalMs: 1.5, jitterMinMs: 0, jitterMaxMs: 0 },
    { minIntervalMs: 0, jitterMinMs: 2, jitterMaxMs: 1 },
  ])('rejects invalid configuration %#', (options) => {
    expect(() => new RateLimiter({ ...options, random: () => 0 })).toThrow()
  })

  it('holds the next start until the active global cooldown expires', async () => {
    const limiter = fixedLimiter()
    const starts: number[] = []

    await limiter.schedule(async () => starts.push(Date.now()))
    limiter.imposeCooldown(500)
    const second = limiter.schedule(async () => starts.push(Date.now()))

    await vi.runAllTimersAsync()
    await second
    expect(starts).toEqual([0, 500])
  })

  it('extends an already-waiting queued start when a cooldown is imposed', async () => {
    const limiter = fixedLimiter()
    const starts: number[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = limiter.schedule(async () => {
      starts.push(Date.now())
      await firstGate
    })
    const second = limiter.schedule(async () => starts.push(Date.now()))

    await flushMicrotasks()
    releaseFirst()
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(1)
    limiter.imposeCooldown(500)

    await vi.advanceTimersByTimeAsync(100)
    expect(starts).toEqual([0])

    await vi.advanceTimersByTimeAsync(400)
    await Promise.all([first, second])
    expect(starts).toEqual([0, 500])
  })

  it('does not shorten an already active cooldown', async () => {
    const limiter = fixedLimiter()
    const starts: number[] = []

    await limiter.schedule(async () => starts.push(Date.now()))
    limiter.imposeCooldown(500)
    await vi.advanceTimersByTimeAsync(100)
    limiter.imposeCooldown(100)
    const second = limiter.schedule(async () => starts.push(Date.now()))

    await vi.runAllTimersAsync()
    await second
    expect(starts).toEqual([0, 500])
  })

  it('returns to the normal cadence after cooldown expiry', async () => {
    const limiter = fixedLimiter()
    const starts: number[] = []

    await limiter.schedule(async () => starts.push(Date.now()))
    limiter.imposeCooldown(500)
    const second = limiter.schedule(async () => starts.push(Date.now()))
    const third = limiter.schedule(async () => starts.push(Date.now()))

    await vi.runAllTimersAsync()
    await Promise.all([second, third])
    expect(starts).toEqual([0, 500, 600])
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid cooldown %s',
    (delayMs) => {
      expect(() => fixedLimiter().imposeCooldown(delayMs)).toThrow(/cooldown/i)
    },
  )

  it('exports the production defaults and worker singleton', () => {
    expect(KUFAR_RATE_LIMITER_DEFAULTS).toEqual({
      minIntervalMs: 2000,
      jitterMinMs: 0,
      jitterMaxMs: 3000,
    })
    expect(kufarRateLimiter).toBeInstanceOf(RateLimiter)
  })

  it('reuses one singleton within the worker module graph', async () => {
    const first = await import('../../electron/worker/kufar-rate-limiter')
    const second = await import('../../electron/worker/kufar-rate-limiter')
    expect(first.kufarRateLimiter).toBe(second.kufarRateLimiter)
  })
})
