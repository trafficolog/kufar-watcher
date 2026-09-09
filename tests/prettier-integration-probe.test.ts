import { readFile } from 'node:fs/promises'
import { format } from 'prettier'
import { describe, it } from 'vitest'

describe('temporary Prettier probe', () => {
  it('prints canonical integration formatting', async () => {
    const file = 'tests/integration/listing-description-cache.test.ts'
    const source = await readFile(new URL('../tests/integration/listing-description-cache.test.ts', import.meta.url), 'utf8')
    const formatted = await format(source, {
      filepath: file,
      semi: false,
      singleQuote: true,
      trailingComma: 'all',
      printWidth: 100,
    })

    console.log(`---PRETTIER:${file}---\n${formatted}---END:${file}---`)
  })
})
