import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '../../generated/prisma/client'

const connectionStrings = new WeakMap<PrismaClient, string>()

export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to create PrismaClient')
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  })
  connectionStrings.set(prisma, connectionString)
  return prisma
}

export function getPrismaClientConnectionString(prisma: PrismaClient): string | undefined {
  return connectionStrings.get(prisma)
}
