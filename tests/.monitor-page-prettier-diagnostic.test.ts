import { readFile } from 'node:fs/promises'
import { format } from 'prettier'
import { expect, it } from 'vitest'

it('prints canonical monitor page formatting', async () => {
  const source = await readFile(new URL('../app/pages/monitors.vue', import.meta.url), 'utf8')
  const formatted = await format(source, {
    parser: 'vue',
    semi: false,
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 100,
  })

  console.log(`MONITOR_PAGE_PRETTIER_BEGIN\n${formatted}MONITOR_PAGE_PRETTIER_END`)
  expect(formatted.length).toBeGreaterThan(0)
})
