import type { Prisma, PrismaClient } from '../../generated/prisma/client'
import type { CanonicalQuery } from '../../shared/canonical-query'
import { assertSupportedMonitorInterval } from '../../shared/monitor-interval'

export interface MonitorSourceIdentity {
  sourceUrl: string
  query: CanonicalQuery
  state: 'active' | 'paused' | 'archived'
}

export interface MonitorConfigPatch {
  name?: string
  sourceUrl?: string
  query?: CanonicalQuery
  intervalSec?: number
  keywords?: readonly string[]
  searchInDescription?: boolean
  state?: 'active' | 'paused' | 'archived'
}

export class PersistedCanonicalQueryError extends Error {
  constructor() {
    super('Invalid persisted canonical query')
    this.name = 'PersistedCanonicalQueryError'
  }
}

function stringArrayEquals(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function extraParamsEqual(
  left: Record<string, string[]>,
  right: Record<string, string[]>,
): boolean {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()

  if (!stringArrayEquals(leftKeys, rightKeys)) return false

  return leftKeys.every((key) => stringArrayEquals(left[key] ?? [], right[key] ?? []))
}

export function canonicalQueryEquals(left: CanonicalQuery, right: CanonicalQuery): boolean {
  return (
    left.host === right.host &&
    left.category === right.category &&
    left.query === right.query &&
    left.region === right.region &&
    left.sellerType === right.sellerType &&
    left.sort === right.sort &&
    left.operation === right.operation &&
    stringArrayEquals(left.pathFilters, right.pathFilters) &&
    extraParamsEqual(left.extraParams, right.extraParams)
  )
}

export function shouldResetMonitorCursor(
  before: MonitorSourceIdentity,
  after: MonitorSourceIdentity,
): boolean {
  return (
    before.sourceUrl !== after.sourceUrl ||
    !canonicalQueryEquals(before.query, after.query) ||
    (before.state === 'archived' && after.state !== 'archived')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function parsePersistedSellerType(value: unknown): CanonicalQuery['sellerType'] {
  if (value === null) return null
  if (value === 'private' || value === 'company') return value
  if (value === 'bez-posrednikov') return 'private'
  throw new PersistedCanonicalQueryError()
}

export function parsePersistedCanonicalQuery(value: unknown): CanonicalQuery {
  if (!isRecord(value)) throw new PersistedCanonicalQueryError()

  if (
    typeof value.host !== 'string' ||
    !isNullableString(value.category) ||
    !isNullableString(value.query) ||
    !isNullableString(value.region) ||
    !isNullableString(value.sort) ||
    !isNullableString(value.operation) ||
    !isStringArray(value.pathFilters) ||
    !isRecord(value.extraParams)
  ) {
    throw new PersistedCanonicalQueryError()
  }

  const sellerType = parsePersistedSellerType(value.sellerType)
  const extraParams: Record<string, string[]> = {}
  for (const [key, values] of Object.entries(value.extraParams)) {
    if (!isStringArray(values)) throw new PersistedCanonicalQueryError()
    extraParams[key] = [...values]
  }

  return {
    host: value.host,
    category: value.category,
    query: value.query,
    region: value.region,
    sellerType,
    sort: value.sort,
    operation: value.operation,
    pathFilters: [...value.pathFilters],
    extraParams,
  }
}

function canonicalQueryJson(query: CanonicalQuery): Prisma.InputJsonValue {
  if (
    query.sellerType !== null &&
    query.sellerType !== 'private' &&
    query.sellerType !== 'company'
  ) {
    throw new PersistedCanonicalQueryError()
  }

  return {
    host: query.host,
    category: query.category,
    query: query.query,
    region: query.region,
    sellerType: query.sellerType,
    sort: query.sort,
    operation: query.operation,
    pathFilters: [...query.pathFilters],
    extraParams: Object.fromEntries(
      Object.entries(query.extraParams).map(([key, values]) => [key, [...values]]),
    ),
  }
}

export async function updateMonitorConfigTransaction(
  tx: Prisma.TransactionClient,
  monitorId: number,
  patch: MonitorConfigPatch,
): Promise<void> {
  if (patch.intervalSec !== undefined) {
    assertSupportedMonitorInterval(patch.intervalSec)
  }

  const current = await tx.monitor.findUniqueOrThrow({
    where: { id: monitorId },
    select: {
      sourceUrl: true,
      query: true,
      state: true,
    },
  })
  const currentQuery = parsePersistedCanonicalQuery(current.query)

  const before: MonitorSourceIdentity = {
    sourceUrl: current.sourceUrl,
    query: currentQuery,
    state: current.state,
  }
  const after: MonitorSourceIdentity = {
    sourceUrl: patch.sourceUrl ?? current.sourceUrl,
    query: patch.query ?? currentQuery,
    state: patch.state ?? current.state,
  }

  const data: Prisma.MonitorUpdateInput = {}
  if (patch.name !== undefined) data.name = patch.name
  if (patch.sourceUrl !== undefined) data.sourceUrl = patch.sourceUrl
  if (patch.query !== undefined) data.query = canonicalQueryJson(patch.query)
  if (patch.intervalSec !== undefined) data.intervalSec = patch.intervalSec
  if (patch.keywords !== undefined) data.keywords = [...patch.keywords]
  if (patch.searchInDescription !== undefined) data.searchInDescription = patch.searchInDescription
  if (patch.state !== undefined) data.state = patch.state

  await tx.monitor.update({
    where: { id: monitorId },
    data,
  })

  if (shouldResetMonitorCursor(before, after)) {
    await tx.monitorCursor.deleteMany({ where: { monitorId } })
  }
}

export async function updateMonitorConfig(
  prisma: PrismaClient,
  monitorId: number,
  patch: MonitorConfigPatch,
): Promise<void> {
  await prisma.$transaction((tx) => updateMonitorConfigTransaction(tx, monitorId, patch))
}
