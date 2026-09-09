import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { format } from 'prettier'

describe('temporary prettier diagnostic', () => {
  it('prints the exact expected matching-normalization test format', async () => {
    const path = 'tests/unit/matching-normalization.test.ts'
    const raw = readFileSync(path, 'utf8')
    const formatted = await format(raw, {
      parser: 'typescript',
      semi: false,
      singleQuote: true,
      trailingComma: 'all',
      printWidth: 100,
    })

    console.log('--- PRETTIER EXPECTED START ---')
    console.log(formatted)
    console.log('--- PRETTIER EXPECTED END ---')
    expect(raw).toBe(formatted)
  })
})
