import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function schemaSource(): Promise<string> {
  return readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
}

function modelBlock(schema: string, model: string): string {
  const match = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`))
  if (!match?.[1]) throw new Error(`Model ${model} not found in Prisma schema`)
  return match[1]
}

describe('Prisma schema integrity constraints', () => {
  it('prevents duplicate monitor-listing matches at the database level', async () => {
    const schema = await schemaSource()

    expect(modelBlock(schema, 'Match')).toContain('@@unique([monitorId, listingId])')
  })

  it('declares the MVP hot-query indexes with descending timestamp order where specified', async () => {
    const schema = await schemaSource()

    expect(modelBlock(schema, 'Match')).toContain('@@index([monitorId, notifiedAt])')
    expect(modelBlock(schema, 'Listing')).toContain('@@index([listTime(sort: Desc)])')
    expect(modelBlock(schema, 'Run')).toContain('@@index([monitorId, startedAt(sort: Desc)])')
  })

  it('cascades monitor deletion to monitor-owned runtime records', async () => {
    const schema = await schemaSource()
    const cascadeRelation = '@relation(fields: [monitorId], references: [id], onDelete: Cascade)'

    expect(modelBlock(schema, 'MonitorCursor')).toContain(cascadeRelation)
    expect(modelBlock(schema, 'Run')).toContain(cascadeRelation)
    expect(modelBlock(schema, 'Match')).toContain(cascadeRelation)
  })

  it('declares persistent watermark catch-up checkpoint fields on MonitorCursor', async () => {
    const schema = await schemaSource()
    const cursor = modelBlock(schema, 'MonitorCursor')

    expect(cursor).toContain('catchupCursor       String?')
    expect(cursor).toContain('catchupBoundaryTime DateTime?')
    expect(cursor).toContain('catchupBoundaryIds  Json     @default("[]")')
    expect(cursor).toContain('catchupLastListTime DateTime?')
    expect(cursor).toContain('catchupLastListId   String?')
  })
})
