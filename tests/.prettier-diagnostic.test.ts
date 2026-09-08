import { readFile } from 'node:fs/promises'

import { format, resolveConfig } from 'prettier'
import { expect, it } from 'vitest'

const targets = [
  'electron/worker/kufar-resilient-source.ts',
  'tests/unit/kufar-resilient-source.test.ts',
]

it('prints exact prettier output for resilient source files', async () => {
  for (const filepath of targets) {
    const source = await readFile(new URL(`../${filepath}`, import.meta.url), 'utf8')
    const config = await resolveConfig(filepath)
    const formatted = await format(source, { ...config, filepath })

    console.error(`PRETTIER_DIAGNOSTIC_START:${filepath}\n${formatted}PRETTIER_DIAGNOSTIC_END:${filepath}`)
  }

  expect(true).toBe(true)
})
