import Docker from 'dockerode'

export function dockerSocketPath(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock'
}

export function createDockerClient(): Docker {
  return new Docker({ socketPath: dockerSocketPath() })
}
