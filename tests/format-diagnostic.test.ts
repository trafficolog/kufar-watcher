import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { format, resolveConfig } from 'prettier'

const files = ['tests/ipc-router.test.ts', 'tests/preload-bridge.test.ts'] as const

describe('temporary Prettier diagnostic', () => {
  for (const file of files) {
    it(file, async () => {
      const source = await readFile(file, 'utf8')
      const config = (await resolveConfig(file)) ?? {}
      const formatted = await format(source, { ...config, filepath: file })
      expect(source).toBe(formatted)
    })
  }
})
