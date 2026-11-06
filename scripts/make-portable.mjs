// Windows portable build (after `npm run dist:win`, which leaves release/win-unpacked):
//   release/Tomo-Portable-<version>/
//     Tomo.exe     small launcher (build-resources/portable/launcher.cs, compiled with Windows' own csc.exe)
//     App/         the app (win-unpacked) + portable.json → the app keeps its data in ../Data
//     Data/        settings, chats, the AI engine, the browser profile, the password-protected secret store
//   release/Tomo-Portable-<version>.zip
// Updating = replacing App/ (Data/ stays). Usage: node scripts/make-portable.mjs
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

if (process.platform !== 'win32') throw new Error('the portable build is made on Windows')
const root = resolve(import.meta.dirname, '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const unpacked = join(root, 'release', 'win-unpacked')
if (!existsSync(join(unpacked, 'Tomo.exe'))) throw new Error('run `npm run dist:win` first (release/win-unpacked)')
const name = `Tomo-Portable-${version}`
const out = join(root, 'release', name)
rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'Data'), { recursive: true })
cpSync(unpacked, join(out, 'App'), { recursive: true })
writeFileSync(join(out, 'App', 'portable.json'), JSON.stringify({ portable: true, data: '../Data' }, null, 2) + '\n')
writeFileSync(join(out, 'Data', 'README.txt'), 'Tomo Portable keeps all of its data in this folder. Keep it with Tomo.exe; to update, replace the App folder only.\r\n')

const csc = join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
if (!existsSync(csc)) throw new Error(`C# compiler not found: ${csc}`)
execFileSync(csc, ['/nologo', '/target:winexe', '/optimize+', `/win32icon:${join(root, 'build-resources', 'icon.ico')}`, `/out:${join(out, 'Tomo.exe')}`, join(root, 'build-resources', 'portable', 'launcher.cs')], { stdio: 'inherit' })

const zip = join(root, 'release', `${name}.zip`)
rmSync(zip, { force: true })
const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') // bsdtar: -a picks zip from the name
execFileSync(tar, ['-a', '-c', '-f', zip, '-C', join(root, 'release'), name])
console.log(`portable: ${zip}`)
