import { join } from 'node:path'
import type { HermesRuntime } from './process'

/** Development runtime set up by scripts/dev-hermes.sh. */
export function devRuntime(repoRoot: string): HermesRuntime {
  const dev = join(repoRoot, '.dev')
  const python = process.platform === 'win32' ? join(dev, 'hermes-venv', 'Scripts', 'python.exe') : join(dev, 'hermes-venv', 'bin', 'python')
  return { python, root: join(dev, 'hermes-src') }
}
