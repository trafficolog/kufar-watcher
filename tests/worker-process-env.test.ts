import { describe, expect, it } from 'vitest'

import { workerProcessEnvironment } from '../electron/main/worker-process-env'

describe('workerProcessEnvironment', () => {
  it('preserves the parent environment while replacing DATABASE_URL', () => {
    expect(
      workerProcessEnvironment(
        {
          PATH: '/bin',
          HOME: '/home/user',
          DATABASE_URL: 'postgresql://stale',
        },
        'postgresql://resolved',
      ),
    ).toEqual({
      PATH: '/bin',
      HOME: '/home/user',
      DATABASE_URL: 'postgresql://resolved',
    })
  })

  it('rejects an empty resolved database URL', () => {
    expect(() => workerProcessEnvironment({ PATH: '/bin' }, '')).toThrow(/database url/i)
  })
})
