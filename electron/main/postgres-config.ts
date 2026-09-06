import type { PostgresContainerConfig } from './docker-postgres'

export interface PostgresRuntimeConfig {
  container: PostgresContainerConfig
  databaseUrl: string
}

function required(
  env: NodeJS.ProcessEnv,
  key: 'POSTGRES_USER' | 'POSTGRES_PASSWORD' | 'POSTGRES_DB',
) {
  const value = env[key]
  if (!value) throw new Error(`${key} is required`)
  return value
}

function readPort(value: string | undefined): number {
  if (value === undefined) return 5432

  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('POSTGRES_PORT must be an integer between 1 and 65535')
  }
  return port
}

function createDatabaseUrl(config: PostgresContainerConfig): string {
  const url = new URL(`postgresql://${config.host}:${config.port}`)
  url.username = config.user
  url.password = config.password
  url.pathname = `/${config.database}`
  url.searchParams.set('schema', 'public')
  return url.toString()
}

export function readPostgresRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): PostgresRuntimeConfig {
  const container: PostgresContainerConfig = {
    image: 'postgres:16',
    containerName: 'kufar-watcher-postgres',
    volumeName: 'kufar-watcher-postgres-data',
    host: '127.0.0.1',
    port: readPort(env.POSTGRES_PORT),
    user: required(env, 'POSTGRES_USER'),
    password: required(env, 'POSTGRES_PASSWORD'),
    database: required(env, 'POSTGRES_DB'),
  }

  return {
    container,
    databaseUrl: createDatabaseUrl(container),
  }
}
