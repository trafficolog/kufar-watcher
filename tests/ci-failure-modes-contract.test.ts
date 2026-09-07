import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function source(path: string): Promise<string> {
  try {
    return await readFile(new URL(path, import.meta.url), 'utf8')
  } catch {
    return ''
  }
}

describe('CI fail-closed verification', () => {
  it('runs a dedicated failure-mode self-check from the verify workflow', async () => {
    const workflow = await source('../.github/workflows/verify.yml')

    expect(workflow).toContain('name: CI failure-mode self-check')
    expect(workflow).toContain('bash scripts/verify-ci-failure-modes.sh')
  })

  it('proves broken frontmatter and a red Vitest both return non-zero', async () => {
    const script = await source('../scripts/verify-ci-failure-modes.sh')

    expect(script).toContain('trap cleanup EXIT')
    expect(script).toContain('npm run docs:ops:check')
    expect(script).toContain('tests/.ci-intentional-failure.test.ts')
    expect(script).toContain('npx vitest run tests/.ci-intentional-failure.test.ts')
    expect(script).toContain('test "$docs_status" -ne 0')
    expect(script).toContain('test "$test_status" -ne 0')
  })
})
