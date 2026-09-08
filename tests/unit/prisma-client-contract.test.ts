import { describe, expect, it } from 'vitest'

import { createPrismaClient } from '../../electron/worker/prisma-client'

describe('createPrismaClient', () => {
  it('requires an explicit connection string or DATABASE_URL', () => {
    const previous = process.env.DATABASE_URL
    delete process.env.DATABASE_URL

    try {
      expect(() => createPrismaClient()).toThrow(/DATABASE_URL/)
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previous
    }
  })
})
