import { describe, expect, it } from 'vitest'
import { readPostgresRuntimeConfig } from '../electron/main/postgres-config'

describe('readPostgresRuntimeConfig', () => {
  it('builds Docker and Prisma configuration from one environment source', () => {
    const config = readPostgresRuntimeConfig({
      POSTGRES_USER: 'kufar user',
      POSTGRES_PASSWORD: 'p@ss:/word',
      POSTGRES_DB: 'kufar-db',
      POSTGRES_PORT: '55432',
    })

    expect(config.container).toEqual({
      image: 'postgres:16',
      containerName: 'kufar-watcher-postgres',
      volumeName: 'kufar-watcher-postgres-data',
      host: '127.0.0.1',
      port: 55432,
      user: 'kufar user',
      password: 'p@ss:/word',
      database: 'kufar-db',
    })
    expect(config.databaseUrl).toBe(
      'postgresql://kufar%20user:p%40ss%3A%2Fword@127.0.0.1:55432/kufar-db?schema=public',
    )
  })

  it('fails explicitly when the generated database password is unavailable', () => {
    expect(() =>
      readPostgresRuntimeConfig({
        POSTGRES_USER: 'kufar',
        POSTGRES_DB: 'kufar',
      }),
    ).toThrow('POSTGRES_PASSWORD is required')
  })

  it('rejects an invalid Postgres port', () => {
    expect(() =>
      readPostgresRuntimeConfig({
        POSTGRES_USER: 'kufar',
        POSTGRES_PASSWORD: 'secret',
        POSTGRES_DB: 'kufar',
        POSTGRES_PORT: '70000',
      }),
    ).toThrow('POSTGRES_PORT must be an integer between 1 and 65535')
  })
})
