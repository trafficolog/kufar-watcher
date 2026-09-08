import type { CanonicalQuery } from '../../shared/canonical-query'

export interface MonitorSourceIdentity {
  sourceUrl: string
  query: CanonicalQuery
  state: 'active' | 'paused' | 'archived'
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
    (before.state === 'archived' && after.state === 'active')
  )
}
