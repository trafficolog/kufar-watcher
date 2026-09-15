import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { format, resolveConfig } from 'prettier'

describe('first-run prettier diagnostic', () => {
  it('prints canonical page formatting', async () => {
    const path = 'app/pages/index.vue'
    const source = readFileSync(path, 'utf8')
    const config = (await resolveConfig(path)) ?? {}
    const formatted = await format(source, { ...config, filepath: path })

    console.log(`FIRST_RUN_FORMATTED_START\n${formatted}FIRST_RUN_FORMATTED_END`)
    expect(source).toBe(formatted)
  })
})
