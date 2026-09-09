import { readFile } from 'node:fs/promises'

import { it } from 'vitest'
import { format } from 'prettier'

it('prints exact prettier output for task files', async () => {
  const paths = [
    'electron/worker/listing-matcher.ts',
    'electron/worker/matching-snippet.ts',
    'tests/unit/matching-snippet.test.ts',
  ]
  const outputs: string[] = []

  for (const path of paths) {
    const source = await readFile(path, 'utf8')
    const formatted = await format(source, {
      parser: 'typescript',
      semi: false,
      singleQuote: true,
      trailingComma: 'all',
      printWidth: 100,
    })
    outputs.push(`===== ${path} =====\n${formatted}`)
  }

  throw new Error(`PRETTIER_OUTPUT_START\n${outputs.join('\n')}PRETTIER_OUTPUT_END`)
})
