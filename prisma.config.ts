import { existsSync } from 'node:fs'
import { defineConfig } from 'prisma/config'

import { createPostgresDatabaseUrl } from './shared/postgres-url'

if (existsSync('.env')) process.loadEnvFile('.env')

function readPort(value: string | undefined): number {
  const port = Number(value ?? '5432')
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('POSTGRES_PORT must be an integer between 1 and 65535')
  }
  return port
}

const databaseUrl = createPostgresDatabaseUrl({
  host: '127.0.0.1',
  port: readPort(process.env.POSTGRES_PORT),
  user: process.env.POSTGRES_USER ?? 'kufar',
  password: process.env.POSTGRES_PASSWORD ?? 'change-me',
  database: process.env.POSTGRES_DB ?? 'kufar',
})

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'prisma db execute --file prisma/seed.sql',
  },
  datasource: {
    url: databaseUrl,
  },
})
