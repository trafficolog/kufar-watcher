import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import prettier from 'prettier'

describe('temporary prettier diagnostic', () => {
  it('prints the exact formatted URL parser', async () => {
    const current = await readFile('shared/kufar-url.ts', 'utf8')
    const formatted = await prettier.format(current, {
      parser: 'typescript',
      semi: false,
      singleQuote: true,
      trailingComma: 'all',
      printWidth: 100,
    })

    console.log('PRETTIER_OUTPUT_START')
    console.log(formatted)
    console.log('PRETTIER_OUTPUT_END')
    expect(current).toBe(formatted)
  })
})
