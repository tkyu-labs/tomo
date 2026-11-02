// Builds the relocatable Hermes runtime that ships inside Tomo (build/engine), on macOS and Windows:
//   build/engine/python      python-build-standalone CPython (relocatable) with Hermes' locked dependencies
//   build/engine/hermes-src  Hermes source at the pinned commit, without tests, docs, apps and git history
// Python environments are not relocatable, so the dependencies go into the standalone interpreter itself.
// Requires scripts/dev-hermes.sh first (Git Bash on Windows). Build on the target OS and architecture.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const pin = Object.fromEntries(readFileSync(join(root, 'scripts/hermes-pin.env'), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split('=')))
const dev = join(root, '.dev')
const src = join(dev, 'hermes-src')
const win = process.platform === 'win32'
const venvPy = win ? join(dev, 'hermes-venv', 'Scripts', 'python.exe') : join(dev, 'hermes-venv', 'bin', 'python')
if (!existsSync(venvPy)) throw new Error('run scripts/dev-hermes.sh first')
const env = { ...process.env, UV_CACHE_DIR: join(dev, 'cache', 'uv'), UV_PYTHON_INSTALL_DIR: join(dev, 'python') }

// the standalone interpreter behind the dev venv (pyvenv.cfg `home`)
const home = readFileSync(join(dev, 'hermes-venv', 'pyvenv.cfg'), 'utf8').match(/^home\s*=\s*(.+)$/m)[1].trim()
const pyRoot = realpathSync(win ? home : dirname(home))

const out = join(root, 'build', 'engine')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(pyRoot, join(out, 'python'), { recursive: true, verbatimSymlinks: true })
const py = win ? join(out, 'python', 'python.exe') : join(out, 'python', 'bin', 'python3')

const reqs = execFileSync('uv', ['export', '--frozen', '--no-dev', '--no-hashes', '--no-emit-project', '-q'], { cwd: src, env }).toString()
writeFileSync(join(out, 'requirements.txt'), reqs)
execFileSync('uv', ['pip', 'install', '-q', '--python', py, '--break-system-packages', '-r', join(out, 'requirements.txt')], { env, stdio: 'inherit' })
rmSync(join(out, 'requirements.txt'))

const skip = new Set(['.git', '.github', 'tests', 'website', 'apps', 'ui-tui', 'contributors', 'evals', 'docker', 'nix', '__pycache__', 'node_modules', 'Dockerfile'])
cpSync(src, join(out, 'hermes-src'), {
  recursive: true,
  filter: (p) => !skip.has(basename(p)) && !p.endsWith('.pyc') && !/docker-compose.*\.yml$/.test(p),
})
writeFileSync(join(out, 'VERSION'), `${pin.HERMES_TAG} ${pin.HERMES_COMMIT}\n`)
execFileSync(py, ['-c', 'import tui_gateway.entry'], { cwd: join(out, 'hermes-src'), env: { ...env, PYTHONDONTWRITEBYTECODE: '1' } })
const size = (d) => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(join(d, e.name)) : e.isSymbolicLink() ? 0 : statSync(join(d, e.name)).size), 0)
console.log(`engine: ${(size(out) / 1e6).toFixed(0)} MB in ${out}`)
