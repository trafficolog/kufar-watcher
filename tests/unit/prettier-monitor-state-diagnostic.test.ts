import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import * as prettier from 'prettier'

describe('prettier diagnostic', () => {
  it('prints the canonical monitor state fixture format', async () => {
    const path = 'tests/unit/monitor-state-application.test.ts'
    const source = await readFile(path, 'utf8')
    const formatted = await prettier.format(source, {
      parser: 'typescript',
      semi: false,
      singleQuote: true,
      trailingComma: 'all',
      printWidth: 100,
    })

    console.log('PRETTIER_OUTPUT_START')
    console.log(formatted)
    console.log('PRETTIER_OUTPUT_END')
    expect(formatted).toBe(source)
  })
})
