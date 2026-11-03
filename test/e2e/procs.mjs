// Process table helpers for the quit check (no extra dependencies): list processes, descendants of a pid, liveness.
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

/** @returns {{ pid: number, ppid: number, cmd: string }[]} */
export function processes() {
  if (process.platform === 'win32') {
    const ps = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const out = execFileSync(ps, ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,Name | ConvertTo-Json -Compress'], { encoding: 'utf8', maxBuffer: 64 << 20 })
    return JSON.parse(out).map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, cmd: p.CommandLine ?? p.Name ?? '' }))
  }
  return execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\n').filter(Boolean).map((l) => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/); return { pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] } })
}

/** All descendants of `root`, plus any process whose command line mentions one of `markers` (daemons that detach). */
export function tomoProcesses(root, markers = []) {
  const all = processes()
  const found = new Map()
  const walk = (pid) => { for (const p of all) if (p.ppid === pid && !found.has(p.pid)) { found.set(p.pid, p); walk(p.pid) } }
  walk(root)
  for (const p of all) if (p.pid !== root && markers.some((m) => m && p.cmd.includes(m))) found.set(p.pid, p)
  return [...found.values()]
}

/** Which of the recorded processes still run (same pid and command line, so a reused pid does not count). */
export function survivors(recorded) {
  const now = new Map(processes().map((p) => [p.pid, p.cmd]))
  return recorded.filter((p) => now.get(p.pid) === p.cmd)
}

export function killAll(list) {
  for (const p of list) {
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' })
      else process.kill(p.pid, 'SIGKILL')
    } catch { /* already gone */ }
  }
}

/** Short label for a report: executable name. */
export const label = (p) => (p.cmd.match(/([^\\/"]+?)(?:\.exe)?["]?(?:\s|$)/i)?.[1] ?? p.cmd).slice(0, 40)
