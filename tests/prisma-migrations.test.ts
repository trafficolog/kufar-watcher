import { describe, expect, it, vi } from 'vitest'
import { createPrismaMigrationRunner } from '../electron/main/prisma-migrations'

const databaseUrl = 'postgresql://kufar:secret@127.0.0.1:5432/kufar?schema=public'
const prismaCliPath = '/app/node_modules/prisma/build/index.js'
const executablePath = '/app/electron'

describe('createPrismaMigrationRunner', () => {
  it('runs migrate deploy with the database URL in Electron Node mode', async () => {
    const runProcess = vi.fn(async () => ({ exitCode: 0, stderr: '' }))
    const runMigrations = createPrismaMigrationRunner({
      databaseUrl,
      prismaCliPath,
      executablePath,
      env: { PATH: '/usr/bin' },
      runProcess,
    })

    await runMigrations()

    expect(runProcess).toHaveBeenCalledWith(
      executablePath,
      [prismaCliPath, 'migrate', 'deploy'],
      expect.objectContaining({
        PATH: '/usr/bin',
        DATABASE_URL: databaseUrl,
        ELECTRON_RUN_AS_NODE: '1',
      }),
    )
  })

  it('rejects with Prisma stderr when migrate deploy exits non-zero', async () => {
    const runMigrations = createPrismaMigrationRunner({
      databaseUrl,
      prismaCliPath,
      executablePath,
      runProcess: vi.fn(async () => ({ exitCode: 1, stderr: 'P3009 failed migration' })),
    })

    await expect(runMigrations()).rejects.toThrow(
      'Prisma migrate deploy failed: P3009 failed migration',
    )
  })
})
