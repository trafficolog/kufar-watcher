import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migrationUrl = new URL(
  '../prisma/migrations/20260909130000_watermark_catch_up_checkpoint/migration.sql',
  import.meta.url,
)

describe('watermark catch-up persistence schema', () => {
  it('models the checkpoint as an optional one-to-one child of MonitorCursor', async () => {
    const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')

    expect(schema).toMatch(/catchUpCheckpoint\s+MonitorCatchUpCheckpoint\?/) 
    expect(schema).toMatch(/model MonitorCatchUpCheckpoint \{[\s\S]*monitorId\s+Int\s+@id/)
    expect(schema).toMatch(/[\s\S]*resumeCursor\s+String/)
    expect(schema).toMatch(/[\s\S]*pendingBoundaryTime\s+DateTime/)
    expect(schema).toMatch(/[\s\S]*pendingBoundaryIds\s+Json/)
    expect(schema).toMatch(/[\s\S]*pagesRead\s+Int/)
    expect(schema).toMatch(
      /cursor\s+MonitorCursor\s+@relation\(fields: \[monitorId\], references: \[monitorId\], onDelete: Cascade\)/,
    )
  })

  it('creates a cascading checkpoint table with positive cumulative page count', async () => {
    const migration = await readFile(migrationUrl, 'utf8')

    expect(migration).toMatch(/CREATE TABLE "MonitorCatchUpCheckpoint"/)
    expect(migration).toMatch(/CONSTRAINT "MonitorCatchUpCheckpoint_pkey" PRIMARY KEY \("monitorId"\)/)
    expect(migration).toMatch(/CHECK \("pagesRead" >= 1\)/)
    expect(migration).toMatch(
      /FOREIGN KEY \("monitorId"\) REFERENCES "MonitorCursor"\("monitorId"\) ON DELETE CASCADE/,
    )
  })

  it('requires persisted ordering observation columns to be all null or all present', async () => {
    const migration = await readFile(migrationUrl, 'utf8')

    expect(migration).toContain('"lastPage" IS NULL')
    expect(migration).toContain('"lastIndex" IS NULL')
    expect(migration).toContain('"lastListId" IS NULL')
    expect(migration).toContain('"lastListTime" IS NULL')
    expect(migration).toContain('"lastPage" IS NOT NULL')
    expect(migration).toContain('"lastIndex" IS NOT NULL')
    expect(migration).toContain('"lastListId" IS NOT NULL')
    expect(migration).toContain('"lastListTime" IS NOT NULL')
  })
})
