import { readFile } from 'node:fs/promises'
import { format } from 'prettier'
import { expect, it } from 'vitest'

it('prints canonical formatting for the two pending files', async () => {
  for (const path of [
    'electron/main/telegram-main-runtime.ts',
    'tests/unit/telegram-main-runtime.test.ts',
  ]) {
    const source = await readFile(path, 'utf8')
    const formatted = await format(source, { filepath: path })
    console.error(`PRETTIER:${path}:${JSON.stringify(formatted)}`)
  }

  expect('diagnostic').toBe('removed')
})
