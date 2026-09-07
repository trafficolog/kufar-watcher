import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function source(path: string): Promise<string> {
  try {
    return await readFile(new URL(path, import.meta.url), 'utf8')
  } catch {
    return ''
  }
}

describe('Prisma development seed contract', () => {
  it('registers explicit Prisma 7 seed and reset commands', async () => {
    const config = await source('../prisma.config.ts')
    const packageJson = JSON.parse(await source('../package.json')) as {
      scripts?: Record<string, string>
    }

    expect(config).toMatch(/seed:\s*['"]prisma db execute --file prisma\/seed\.sql['"]/)
    expect(packageJson.scripts?.['db:seed']).toBe('prisma db seed')
    expect(packageJson.scripts?.['db:reset']).toBe('prisma migrate reset --force && prisma db seed')
  })

  it('defines deterministic synthetic MVP fixtures without future-slice tables', async () => {
    const seed = await source('../prisma/seed.sql')

    expect(seed).toContain('seed-monitor-electronics')
    expect(seed).toContain('seed-monitor-housing')
    expect(seed).toContain('fixtures.invalid')
    expect(seed).toContain('ON CONFLICT')
    expect(seed).not.toContain('kufar.by')
    expect(seed).not.toContain('INSERT INTO "Favorite"')
    expect(seed).not.toContain('INSERT INTO "PriceSnapshot"')
  })

  it('provides a reusable clean database helper for integration suites', async () => {
    const helper = await source('../scripts/test-db.sh')

    expect(helper).toContain('docker compose down -v --remove-orphans')
    expect(helper).toContain('docker compose up -d --wait')
    expect(helper).toContain('npm run db:migrate:deploy')
    expect(helper).toContain('npm run db:seed')
  })
})
