from pathlib import Path
p = Path('electron/worker/monitor-config-persistence.ts')
s = p.read_text()
old = '  const nextQuery = patch.query ?? sourceQuery ?? currentQuery\n\n  if (patch.sourceUrl !== undefined || patch.query !== undefined) {'
new = '  const nextQuery = patch.query ?? sourceQuery ?? currentQuery\n\n  // Preserve the typed canonical-query validation error before adapter routing.\n  if (patch.query !== undefined) canonicalQueryJson(patch.query)\n\n  if (patch.sourceUrl !== undefined || patch.query !== undefined) {'
assert s.count(old) == 1, 'unexpected validation anchor'
p.write_text(s.replace(old, new))
print('Applied canonical-query validation ordering correction')
