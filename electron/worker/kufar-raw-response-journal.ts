import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const SNAPSHOT_VERSION = 1 as const
const DEFAULT_RETENTION = 5
const SNAPSHOT_FILE_PATTERN = /^\d{16}-.+\.snapshot\.json$/

export interface KufarRawResponseSnapshotInput {
  requestUrl: string | URL
  status: number
  body: Uint8Array
}

export interface KufarRawResponseSnapshot {
  version: 1
  id: string
  endpoint: string
  requestUrl: string
  status: number
  capturedAt: string
  bodyBase64: string
}

export interface KufarRawResponseJournal {
  record(input: KufarRawResponseSnapshotInput): Promise<KufarRawResponseSnapshot>
  list(endpoint: string | URL): Promise<KufarRawResponseSnapshot[]>
  exportSnapshot(endpoint: string | URL, id: string, destination: string): Promise<void>
}

export interface FileKufarRawResponseJournalOptions {
  rootDir: string
  retention?: number
  now?: () => Date
  createId?: () => string
}

export function kufarEndpointIdentity(input: string | URL): string {
  if (input instanceof URL) return `${input.host}${input.pathname}`
  if (!input.includes('://')) return input
  const url = new URL(input)
  return `${url.host}${url.pathname}`
}

function endpointDirectoryName(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex')
}

function isMissingDirectory(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    Reflect.get(error, 'code') === 'ENOENT'
  )
}

function isSnapshot(value: unknown, expectedEndpoint: string): value is KufarRawResponseSnapshot {
  if (typeof value !== 'object' || value === null) return false

  return (
    Reflect.get(value, 'version') === SNAPSHOT_VERSION &&
    typeof Reflect.get(value, 'id') === 'string' &&
    Reflect.get(value, 'id').length > 0 &&
    Reflect.get(value, 'endpoint') === expectedEndpoint &&
    typeof Reflect.get(value, 'requestUrl') === 'string' &&
    typeof Reflect.get(value, 'status') === 'number' &&
    Number.isInteger(Reflect.get(value, 'status')) &&
    typeof Reflect.get(value, 'capturedAt') === 'string' &&
    !Number.isNaN(Date.parse(Reflect.get(value, 'capturedAt'))) &&
    typeof Reflect.get(value, 'bodyBase64') === 'string'
  )
}

function parseSnapshot(
  raw: string,
  filename: string,
  expectedEndpoint: string,
): KufarRawResponseSnapshot {
  try {
    const value: unknown = JSON.parse(raw)
    if (!isSnapshot(value, expectedEndpoint)) throw new Error('invalid envelope')
    return value
  } catch {
    throw new Error(`Invalid raw response snapshot ${filename}`)
  }
}

export class FileKufarRawResponseJournal implements KufarRawResponseJournal {
  private readonly rootDir: string
  private readonly retention: number
  private readonly now: () => Date
  private readonly createId: () => string

  constructor(options: FileKufarRawResponseJournalOptions) {
    this.rootDir = options.rootDir
    this.retention = options.retention ?? DEFAULT_RETENTION
    this.now = options.now ?? (() => new Date())
    this.createId = options.createId ?? randomUUID
  }

  async record(input: KufarRawResponseSnapshotInput): Promise<KufarRawResponseSnapshot> {
    const requestUrl =
      typeof input.requestUrl === 'string' ? input.requestUrl : input.requestUrl.href
    const endpoint = kufarEndpointIdentity(input.requestUrl)
    const capturedAt = this.now()
    const id = this.createId()
    const snapshot: KufarRawResponseSnapshot = {
      version: SNAPSHOT_VERSION,
      id,
      endpoint,
      requestUrl,
      status: input.status,
      capturedAt: capturedAt.toISOString(),
      bodyBase64: Buffer.from(input.body).toString('base64'),
    }
    const endpointDir = join(this.rootDir, endpointDirectoryName(endpoint))
    const timestamp = String(capturedAt.getTime()).padStart(16, '0')
    const filename = `${timestamp}-${id}.snapshot.json`

    await mkdir(endpointDir, { recursive: true })
    await writeFile(join(endpointDir, filename), JSON.stringify(snapshot), 'utf8')
    await this.enforceRetention(endpointDir)

    return snapshot
  }

  async list(endpointInput: string | URL): Promise<KufarRawResponseSnapshot[]> {
    const endpoint = kufarEndpointIdentity(endpointInput)
    const endpointDir = join(this.rootDir, endpointDirectoryName(endpoint))
    let filenames: string[]

    try {
      filenames = (await readdir(endpointDir))
        .filter((filename) => SNAPSHOT_FILE_PATTERN.test(filename))
        .sort()
    } catch (error) {
      if (isMissingDirectory(error)) return []
      throw error
    }

    return Promise.all(
      filenames.map(async (filename) => {
        const raw = await readFile(join(endpointDir, filename), 'utf8')
        return parseSnapshot(raw, filename, endpoint)
      }),
    )
  }

  async exportSnapshot(endpoint: string | URL, id: string, destination: string): Promise<void> {
    const snapshot = (await this.list(endpoint)).find((candidate) => candidate.id === id)
    if (!snapshot) throw new Error(`Raw response snapshot ${id} was not found`)
    await writeFile(destination, Buffer.from(snapshot.bodyBase64, 'base64'))
  }

  private async enforceRetention(endpointDir: string): Promise<void> {
    const filenames = (await readdir(endpointDir))
      .filter((filename) => SNAPSHOT_FILE_PATTERN.test(filename))
      .sort()
    const excess = filenames.slice(0, Math.max(0, filenames.length - this.retention))

    await Promise.all(excess.map((filename) => unlink(join(endpointDir, filename))))
  }
}
