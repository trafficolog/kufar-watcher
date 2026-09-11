import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPostgresDatabaseUrl } from '../../shared/postgres-url'
import type { PostgresContainerConfig } from './docker-postgres'

export interface PostgresRuntimeConfig {
  container: PostgresContainerConfig
  databaseUrl: string
}

export interface PostgresCredentials {
  user: string
  password: string
  database: string
}

const DEFAULT_POSTGRES_USER = 'kufar'
const DEFAULT_POSTGRES_DATABASE = 'kufar'
const POSTGRES_CREDENTIALS_FILE = 'postgres-credentials.json'

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = Reflect.get(error, 'code')
  return typeof code === 'string' ? code : undefined
}

function parseStoredCredentials(raw: string): PostgresCredentials {
  const value: unknown = JSON.parse(raw)
  if (typeof value !== 'object' || value === null) {
    throw new Error('Stored Postgres credentials are invalid')
  }

  const user = Reflect.get(value, 'user')
  const password = Reflect.get(value, 'password')
  const database = Reflect.get(value, 'database')
  if (
    typeof user !== 'string' ||
    user.length === 0 ||
    typeof password !== 'string' ||
    password.length === 0 ||
    typeof database !== 'string' ||
    database.length === 0
  ) {
    throw new Error('Stored Postgres credentials are invalid')
  }

  return { user, password, database }
}

function readStoredCredentials(path: string): PostgresCredentials {
  return parseStoredCredentials(readFileSync(path, 'utf8'))
}

export function loadOrCreatePostgresCredentials(
  userDataDir: string,
  generatePassword: () => string = () => randomBytes(32).toString('base64url'),
): PostgresCredentials {
  mkdirSync(userDataDir, { recursive: true })
  const path = join(userDataDir, POSTGRES_CREDENTIALS_FILE)

  try {
    return readStoredCredentials(path)
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }

  const credentials: PostgresCredentials = {
    user: DEFAULT_POSTGRES_USER,
    password: generatePassword(),
    database: DEFAULT_POSTGRES_DATABASE,
  }
  if (credentials.password.length === 0) {
    throw new Error('Generated Postgres password is empty')
  }

  try {
    writeFileSync(path, `${JSON.stringify(credentials)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    return credentials
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return readStoredCredentials(path)
    throw error
  }
}

function required(
  env: NodeJS.ProcessEnv,
  key: 'POSTGRES_USER' | 'POSTGRES_PASSWORD' | 'POSTGRES_DB',
  fallback: string | undefined,
): string {
  const value = env[key] ?? fallback
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

export function readPostgresRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
  fallback?: PostgresCredentials,
): PostgresRuntimeConfig {
  const container: PostgresContainerConfig = {
    image: 'postgres:16',
    containerName: 'kufar-watcher-postgres',
    volumeName: 'kufar-watcher-postgres-data',
    host: '127.0.0.1',
    port: readPort(env.POSTGRES_PORT),
    user: required(env, 'POSTGRES_USER', fallback?.user),
    password: required(env, 'POSTGRES_PASSWORD', fallback?.password),
    database: required(env, 'POSTGRES_DB', fallback?.database),
  }

  return {
    container,
    databaseUrl: createPostgresDatabaseUrl(container),
  }
}
