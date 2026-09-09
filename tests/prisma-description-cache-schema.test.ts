import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function schemaSource(): Promise<string> {
  return readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
}

async function migrationSource(): Promise<string> {
  return readFile(
    new URL(
      '../prisma/migrations/20260909060000_listing_description_cache/migration.sql',
      import.meta.url,
    ),
    'utf8',
  ).catch(() => '')
}

function block(source: string, kind: 'enum' | 'model', name: string): string {
  return source.match(new RegExp(`${kind} ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? ''
}

describe('Prisma listing description cache schema', () => {
  it('declares the exact ListingAvailability states', async () => {
    const schema = await schemaSource()
    const values = block(schema, 'enum', 'ListingAvailability').split(/\s+/).filter(Boolean)

    expect(values).toEqual(['unknown', 'available', 'unavailable'])
  })

  it('stores cache state and a nullable load sentinel', async () => {
    const schema = await schemaSource()
    const listing = block(schema, 'model', 'Listing')

    expect(listing).toMatch(/availability\s+ListingAvailability\s+@default\(unknown\)/)
    expect(listing).toMatch(/descriptionLoadedAt\s+DateTime\?/)
  })

  it('keeps the migration aligned with the Prisma cache fields', async () => {
    const migration = await migrationSource()

    expect(migration).toContain(
      `CREATE TYPE "ListingAvailability" AS ENUM ('unknown', 'available', 'unavailable');`,
    )
    expect(migration).toContain(
      `ADD COLUMN "availability" "ListingAvailability" NOT NULL DEFAULT 'unknown'`,
    )
    expect(migration).toContain('ADD COLUMN "descriptionLoadedAt" TIMESTAMP(3)')
  })
})
