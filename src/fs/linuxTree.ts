// seedLinuxTree — populate a FileSystem with a standard FHS directory skeleton
// so the agent sees a familiar Linux layout to work in.

import type { FileSystem } from '../types/index.js'

export const DEFAULT_HOME = '/home/user'

/** Standard Filesystem Hierarchy Standard directories we create. */
export const LINUX_DIRS: string[] = [
  '/bin',
  '/sbin',
  '/etc',
  '/home',
  '/root',
  '/tmp',
  '/var',
  '/var/log',
  '/usr',
  '/usr/bin',
  '/usr/lib',
  '/usr/local',
  '/opt',
  '/mnt',
  '/proc',
  '/sys',
  '/dev',
]

const OS_RELEASE = `PRETTY_NAME="browser-claude-sdk sandbox"
NAME="bcs-linux"
ID=bcs
VERSION_ID="1.0"
HOME_URL="https://webcontainers.io"
`

/**
 * Idempotently create the Linux directory skeleton plus a few token files.
 * Safe to call repeatedly (mkdir is recursive; writes overwrite identical content).
 */
export async function seedLinuxTree(
  fs: FileSystem,
  opts: { home?: string } = {}
): Promise<void> {
  const home = opts.home ?? DEFAULT_HOME

  for (const dir of LINUX_DIRS) {
    await fs.mkdir(dir)
  }
  await fs.mkdir(home)

  await fs.writeFile('/etc/hostname', 'sandbox\n')
  await fs.writeFile('/etc/os-release', OS_RELEASE)
  await fs.writeFile(`${home}/.bashrc`, '')
}
