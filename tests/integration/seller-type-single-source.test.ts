import { readFile } from 'node:fs/promises'

import { Client } from 'pg'
import { describe, expect, it } from 'vitest'

const integration = process.env.KUFAR_POSTGRES_INTEGRATION === '1' ? describe : describe.skip
const FIXTURE_IDS = [975_101, 975_102, 975_103]
const MIGRATION_URL = new URL(
  '../../prisma/migrations/20260912183500_seller_type_single_source/migration.sql',
  import.meta.url,
)

const QUERY_WITH_COMPANY = {
  host: 'www.kufar.by',
  category: 'electronics',
  query: 'phone',
  region: 'minsk',
  sellerType: 'company',
  sort: 'lst.d',
  operation: null,
  pathFilters: [],
  extraParams: {},
}

const QUERY_WITHOUT_SELLER = {
  ...QUERY_WITH_COMPANY,
  sellerType: null,
}

integration('sellerType single-source migration', () => {
  it('preserves the effective canonical seller and recovers valid legacy-only filters', async () => {
    const migrationSql = await readFile(MIGRATION_URL, 'utf8')
    const client = new Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()

    try {
      await client.query('BEGIN')
      await client.query('ALTER TABLE "Monitor" ADD COLUMN IF NOT EXISTS "sellerType" TEXT')
      await client.query(
        `INSERT INTO "Monitor" ("id", "name", "sourceUrl", "query", "intervalSec", "keywords", "sellerType")
         VALUES
           (${FIXTURE_IDS[0]}, 'canonical-wins', 'https://fixtures.invalid/canonical-wins', '${JSON.stringify(QUERY_WITH_COMPANY)}'::jsonb, 60, '[]'::jsonb, 'private'),
           (${FIXTURE_IDS[1]}, 'legacy-company', 'https://fixtures.invalid/legacy-company', '${JSON.stringify(QUERY_WITHOUT_SELLER)}'::jsonb, 60, '[]'::jsonb, 'company'),
           (${FIXTURE_IDS[2]}, 'legacy-marker', 'https://fixtures.invalid/legacy-marker', '${JSON.stringify(QUERY_WITHOUT_SELLER)}'::jsonb, 60, '[]'::jsonb, 'bez-posrednikov')`,
      )

      await client.query(migrationSql)

      const rows = await client.query<{ id: number; sellerType: string | null }>(
        `SELECT "id", "query"->>'sellerType' AS "sellerType"
         FROM "Monitor"
         WHERE "id" IN (${FIXTURE_IDS.join(', ')})
         ORDER BY "id"`,
      )
      expect(rows.rows).toEqual([
        { id: FIXTURE_IDS[0], sellerType: 'company' },
        { id: FIXTURE_IDS[1], sellerType: 'company' },
        { id: FIXTURE_IDS[2], sellerType: 'private' },
      ])

      const columns = await client.query<{ count: string }>(
        `SELECT count(*) AS count
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'Monitor'
           AND column_name = 'sellerType'`,
      )
      expect(columns.rows).toEqual([{ count: '0' }])
    } finally {
      await client.query('ROLLBACK')
      await client.end()
    }
  })

  it('refuses to discard an unsupported legacy-only seller value', async () => {
    const migrationSql = await readFile(MIGRATION_URL, 'utf8')
    const client = new Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()

    try {
      await client.query('BEGIN')
      await client.query('ALTER TABLE "Monitor" ADD COLUMN IF NOT EXISTS "sellerType" TEXT')
      await client.query(
        `INSERT INTO "Monitor" ("id", "name", "sourceUrl", "query", "intervalSec", "keywords", "sellerType")
           VALUES (${FIXTURE_IDS[0]}, 'invalid-legacy', 'https://fixtures.invalid/invalid-legacy', '${JSON.stringify(QUERY_WITHOUT_SELLER)}'::jsonb, 60, '[]'::jsonb, 'broker')`,
      )

      await expect(client.query(migrationSql)).rejects.toThrow(
        /unsupported legacy Monitor\.sellerType/i,
      )
    } finally {
      await client.query('ROLLBACK')
      await client.end()
    }
  })
})
