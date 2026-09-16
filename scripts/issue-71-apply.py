#!/usr/bin/env python3
"""Temporary CI materialization for #71; remove from final source commit."""
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Unexpected anchor for {path}: expected 1, found {count}: {old[:100]}')
    target.write_text(text.replace(old, new), encoding='utf-8')


p = 'electron/worker/monitor-config-persistence.ts'
replace_once(p, "import { parseKufarListingUrl } from '../../shared/kufar-url'", "import { buildKufarApiUrl, parseKufarListingUrl } from '../../shared/kufar-url'")
replace_once(p, '  routeKufarQuery(query)\n\n  const created', '  routeKufarQuery(query)\n  buildKufarApiUrl(query)\n\n  const created')
replace_once(p, "  const currentQuery = parsePersistedCanonicalQuery(current.query)\n\n  const before", "  const currentQuery = parsePersistedCanonicalQuery(current.query)\n  const sourceQuery = patch.sourceUrl === undefined ? null : parseKufarListingUrl(patch.sourceUrl)\n  const nextQuery = patch.query ?? sourceQuery ?? currentQuery\n\n  if (patch.sourceUrl !== undefined || patch.query !== undefined) {\n    if (sourceQuery !== null) {\n      routeKufarQuery(sourceQuery)\n      buildKufarApiUrl(sourceQuery)\n    }\n    routeKufarQuery(nextQuery)\n    buildKufarApiUrl(nextQuery)\n    if (sourceQuery !== null && patch.query !== undefined && !canonicalQueryEquals(sourceQuery, nextQuery)) {\n      throw new MonitorSourceQueryMismatchError()\n    }\n  }\n\n  const before")
replace_once(p, 'export class PersistedCanonicalQueryError extends Error {', "export class MonitorSourceQueryMismatchError extends Error {\n  constructor() {\n    super('Monitor source URL and canonical query do not match')\n    this.name = 'MonitorSourceQueryMismatchError'\n  }\n}\n\nexport class PersistedCanonicalQueryError extends Error {")
replace_once(p, '    query: patch.query ?? currentQuery,', '    query: nextQuery,')
replace_once(p, '  if (patch.query !== undefined) data.query = canonicalQueryJson(patch.query)', '  if (patch.query !== undefined || patch.sourceUrl !== undefined) data.query = canonicalQueryJson(nextQuery)')

p = 'electron/worker/scheduled-monitor-run.ts'
replace_once(p, "import { routeKufarQuery } from '../../shared/kufar-routing'", "import { routeKufarQuery } from '../../shared/kufar-routing'\nimport { KufarUrlBuildError } from '../../shared/kufar-url'")
replace_once(p, 'function classifyRunFailure(error: unknown): RunFailureJournal {\n', "function classifyRunFailure(error: unknown): RunFailureJournal {\n  if (error instanceof KufarUrlBuildError) {\n    return {\n      error: 'Unsupported Kufar API mapping for this monitor URL',\n      errorCategory: 'policy',\n      errorCode: error.code,\n      httpStatus: null,\n    }\n  }\n\n")
replace_once(p, '        if (error instanceof DescriptionRequestBudgetExceededError) {\n          return', '        if (error instanceof KufarUrlBuildError || error instanceof DescriptionRequestBudgetExceededError) {\n          return')

p = 'tests/integration/monitor-config-persistence.test.ts'
replace_once(p, "      sourceUrl: 'https://www.kufar.by/l/cars',\n    })\n\n    const monitor", "      sourceUrl: 'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~pixel',\n    })\n\n    const monitor")
replace_once(p, "expect(monitor.sourceUrl).toBe('https://www.kufar.by/l/cars')", "expect(monitor.sourceUrl).toBe('https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~pixel')")
replace_once(p, "      query: { ...ORIGINAL_QUERY, region: 'gomel' },", "      query: { ...ORIGINAL_QUERY, category: 'igry-i-pristavki', pathFilters: [] },")
replace_once(p, "          sourceUrl: 'https://www.kufar.by/l/cars',", "          sourceUrl: 'https://www.kufar.by/l/r~minsk/igry-i-pristavki/q~pixel',")

print('Applied #71 source and existing integration fixture changes')
