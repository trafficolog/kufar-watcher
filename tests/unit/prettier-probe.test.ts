import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { format, resolveConfig } from 'prettier'

const paths = [
  'tests/unit/monitor-create-application.test.ts',
  'tests/unit/monitor-create-config-sync.test.ts',
]

describe('prettier probe', () => {
  it('prints canonical output for the new monitor create tests', async () => {
    for (const path of paths) {
      const source = await readFile(path, 'utf8')
      const config = (await resolveConfig(path)) ?? {}
      const formatted = await format(source, { ...config, filepath: path })
      console.log(`PRETTIER_OUTPUT:${path}:${Buffer.from(formatted).toString('base64')}`)
    }

    expect('probe').toBe('removed')
  })
})
