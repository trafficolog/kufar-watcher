import { readFile } from 'node:fs/promises'

import { format, resolveConfig } from 'prettier'
import { expect, it } from 'vitest'

it('prints exact prettier output for the real-estate normalizer test', async () => {
  const target = new URL('./unit/kufar-realestate-normalizer.test.ts', import.meta.url)
  const source = await readFile(target, 'utf8')
  const filepath = 'tests/unit/kufar-realestate-normalizer.test.ts'
  const config = await resolveConfig(filepath)
  const formatted = await format(source, { ...config, filepath })

  console.error(`PRETTIER_DIAGNOSTIC_START\n${formatted}PRETTIER_DIAGNOSTIC_END`)
  expect(formatted.length).toBeGreaterThan(0)
})
