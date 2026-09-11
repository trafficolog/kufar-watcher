import { afterEach, describe, expect, it, vi } from 'vitest'

const DATABASE_ENV_KEYS = [
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'POSTGRES_PORT',
  'DATABASE_URL',
] as const

const originalEnv = Object.fromEntries(
  DATABASE_ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof DATABASE_ENV_KEYS)[number], string | undefined>

function replaceDatabaseEnv(values: Partial<Record<(typeof DATABASE_ENV_KEYS)[number], string>>) {
  for (const key of DATABASE_ENV_KEYS) Reflect.deleteProperty(process.env, key)
  Object.assign(process.env, values)
}

async function loadPrismaDatabaseUrl(): Promise<string | undefined> {
  vi.resetModules()
  const { default: config } = await import('../prisma.config')
  return (config as { datasource?: { url?: string } }).datasource?.url
}

afterEach(() => {
  for (const key of DATABASE_ENV_KEYS) {
    const value = originalEnv[key]
    if (value === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = value
  }
  vi.resetModules()
})

describe('Prisma database configuration', () => {
  it('derives the CLI URL from POSTGRES_* even when DATABASE_URL is stale', async () => {
    replaceDatabaseEnv({
      POSTGRES_USER: 'runtime-user',
      POSTGRES_PASSWORD: 'runtime-password',
      POSTGRES_DB: 'runtime-db',
      POSTGRES_PORT: '55432',
      DATABASE_URL: 'postgresql://stale:stale@127.0.0.1:5432/stale?schema=public',
    })

    await expect(loadPrismaDatabaseUrl()).resolves.toBe(
      'postgresql://runtime-user:runtime-password@127.0.0.1:55432/runtime-db?schema=public',
    )
  })

  it('percent-encodes POSTGRES_* credentials when building the CLI URL', async () => {
    replaceDatabaseEnv({
      POSTGRES_USER: 'kufar user',
      POSTGRES_PASSWORD: 'p@ss:/word',
      POSTGRES_DB: 'kufar-db',
      POSTGRES_PORT: '55432',
    })

    await expect(loadPrismaDatabaseUrl()).resolves.toBe(
      'postgresql://kufar%20user:p%40ss%3A%2Fword@127.0.0.1:55432/kufar-db?schema=public',
    )
  })

  it('keeps the development defaults when POSTGRES_* is absent', async () => {
    replaceDatabaseEnv({})

    await expect(loadPrismaDatabaseUrl()).resolves.toBe(
      'postgresql://kufar:change-me@127.0.0.1:5432/kufar?schema=public',
    )
  })
})
