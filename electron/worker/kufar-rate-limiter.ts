export interface RateLimiterOptions {
  minIntervalMs: number
  jitterMinMs: number
  jitterMaxMs: number
  random?: () => number
}

export const KUFAR_RATE_LIMITER_DEFAULTS = {
  minIntervalMs: 2000,
  jitterMinMs: 0,
  jitterMaxMs: 3000,
} as const

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative integer`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class RateLimiter {
  private readonly minIntervalMs: number
  private readonly jitterMinMs: number
  private readonly jitterMaxMs: number
  private readonly random: () => number
  private tail: Promise<void> = Promise.resolve()
  private lastStartedAt: number | null = null
  private cooldownUntil = 0

  constructor(options: RateLimiterOptions) {
    assertNonNegativeInteger('minIntervalMs', options.minIntervalMs)
    assertNonNegativeInteger('jitterMinMs', options.jitterMinMs)
    assertNonNegativeInteger('jitterMaxMs', options.jitterMaxMs)

    if (options.jitterMaxMs < options.jitterMinMs) {
      throw new RangeError('jitterMaxMs must be greater than or equal to jitterMinMs')
    }

    this.minIntervalMs = options.minIntervalMs
    this.jitterMinMs = options.jitterMinMs
    this.jitterMaxMs = options.jitterMaxMs
    this.random = options.random ?? Math.random
  }

  schedule<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.tail.then(() => this.run(operation))

    this.tail = run.then(
      () => undefined,
      () => undefined,
    )

    return run
  }

  imposeCooldown(delayMs: number): void {
    assertNonNegativeInteger('cooldown delay', delayMs)
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + delayMs)
  }

  private sampleDelayMs(): number {
    const randomValue = this.random()

    if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
      throw new RangeError('random source must return a finite number in [0, 1)')
    }

    const jitterRangeSize = this.jitterMaxMs - this.jitterMinMs + 1
    const jitterMs = this.jitterMinMs + Math.floor(randomValue * jitterRangeSize)

    return this.minIntervalMs + jitterMs
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    const cadenceStartAt =
      this.lastStartedAt === null ? 0 : this.lastStartedAt + this.sampleDelayMs()

    while (true) {
      const earliestStartAt = Math.max(cadenceStartAt, this.cooldownUntil)
      const remainingMs = earliestStartAt - Date.now()

      if (remainingMs <= 0) break
      await sleep(remainingMs)
    }

    this.lastStartedAt = Date.now()

    return operation()
  }
}

export const kufarRateLimiter = new RateLimiter(KUFAR_RATE_LIMITER_DEFAULTS)
