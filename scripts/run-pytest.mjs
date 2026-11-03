// Runs the Hermes plugin unit tests with the project-local test environment (macOS and Windows).
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const py = process.platform === 'win32' ? join(root, '.dev', 'test-venv', 'Scripts', 'python.exe') : join(root, '.dev', 'test-venv', 'bin', 'python')
process.exit(spawnSync(py, ['-m', 'pytest', '-q', 'plugins/tests'], { cwd: root, stdio: 'inherit' }).status ?? 1)
