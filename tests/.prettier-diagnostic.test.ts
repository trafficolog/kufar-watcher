import { readFile } from 'node:fs/promises'

import { format, resolveConfig } from 'prettier'
import { expect, it } from 'vitest'

const filepath = 'tests/unit/kufar-html-fallback-adapter.test.ts'

it('prints exact prettier output for HTML fallback adapter test', async () => {
  const source = await readFile(new URL(`../${filepath}`, import.meta.url), 'utf8')
  const config = await resolveConfig(filepath)
  const formatted = await format(source, { ...config, filepath })

  console.error(`PRETTIER_DIAGNOSTIC_START:${filepath}\n${formatted}PRETTIER_DIAGNOSTIC_END:${filepath}`)
  expect(true).toBe(true)
})
