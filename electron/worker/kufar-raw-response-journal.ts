import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
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

export interface FileKufarRawResponseJournalOptions {
  rootDir: string
  retention?: number
  now?: () => Date
  createId?: () => string
}

function endpointFromInput(input: string | URL): string {
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

export class FileKufarRawResponseJournal {
  private readonly rootDir: string
  private readonly now: () => Date
  private readonly createId: () => string

  constructor(options: FileKufarRawResponseJournalOptions) {
    this.rootDir = options.rootDir
    this.now = options.now ?? (() => new Date())
    this.createId = options.createId ?? randomUUID
    void (options.retention ?? DEFAULT_RETENTION)
  }

  async record(input: KufarRawResponseSnapshotInput): Promise<KufarRawResponseSnapshot> {
    const requestUrl = typeof input.requestUrl === 'string' ? input.requestUrl : input.requestUrl.href
    const endpoint = endpointFromInput(input.requestUrl)
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

    return snapshot
  }

  async list(endpointInput: string | URL): Promise<KufarRawResponseSnapshot[]> {
    const endpoint = endpointFromInput(endpointInput)
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
        return JSON.parse(raw) as KufarRawResponseSnapshot
      }),
    )
  }
}
