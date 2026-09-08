import { readFile } from 'node:fs/promises'

import { format } from 'prettier'
import { expect, it } from 'vitest'

it('prints exact prettier output for kufar detail parser', async () => {
  const path = new URL('../electron/worker/kufar-listing-detail.ts', import.meta.url)
  const source = await readFile(path, 'utf8')
  const formatted = await format(source, { filepath: path.pathname })

  console.log('PRETTIER_OUTPUT_START\n' + formatted + 'PRETTIER_OUTPUT_END')
  expect(source).toBe(formatted)
})
