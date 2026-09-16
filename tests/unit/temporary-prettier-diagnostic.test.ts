import { spawnSync } from 'node:child_process'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { format, resolveConfig } from 'prettier'
import { it } from 'vitest'

it('prints the exact temporary Prettier diff for the monitor page', async () => {
  const path = 'app/pages/monitors.vue'
  const original = readFileSync(path, 'utf8')
  const formatted = await format(original, {
    ...(await resolveConfig(path)),
    filepath: path,
  })
  const destination = join(tmpdir(), `kufar-prettier-${process.pid}.vue`)
  writeFileSync(destination, formatted)
  try {
    const result = spawnSync('diff', ['-u', path, destination], { encoding: 'utf8' })
    if (result.status === 1) {
      console.log(`PRETTIER_REQUIRED_DIFF_START\n${result.stdout}\nPRETTIER_REQUIRED_DIFF_END`)
    }
  } finally {
    unlinkSync(destination)
  }
})
