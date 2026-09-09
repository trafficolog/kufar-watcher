import { readFile } from 'node:fs/promises'
import { format } from 'prettier'
import { describe, it } from 'vitest'

const FILES = [
  'electron/worker/listing-description-cache.ts',
  'tests/prisma-description-cache-schema.test.ts',
  'tests/unit/kufar-listing-detail.test.ts',
  'tests/unit/listing-description-cache.test.ts',
] as const

describe('temporary Prettier probe', () => {
  it('prints canonical formatting for new files', async () => {
    for (const file of FILES) {
      const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
      const formatted = await format(source, {
        filepath: file,
        semi: false,
        singleQuote: true,
        trailingComma: 'all',
        printWidth: 100,
      })

      console.log(`---PRETTIER:${file}---\n${formatted}---END:${file}---`)
    }
  })
})
