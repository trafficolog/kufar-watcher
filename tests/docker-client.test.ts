import { describe, expect, it } from 'vitest'
import { dockerSocketPath } from '../electron/main/docker-client'

describe('dockerSocketPath', () => {
  it('uses Docker Desktop named pipe on Windows', () => {
    expect(dockerSocketPath('win32')).toBe('//./pipe/docker_engine')
  })

  it('uses the Docker daemon socket on Linux', () => {
    expect(dockerSocketPath('linux')).toBe('/var/run/docker.sock')
  })
})
