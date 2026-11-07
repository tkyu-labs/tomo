// Without a school pack ("My school is not listed") the student answers Tomo's general Hatch. All skipped: USER.md
// holds only the app language and the skipped note; nothing is made up, no identifiers exist.
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppController } from '../../src/main/app/controller'
import { devRuntime } from '../../src/main/hermes/runtime'
import { tomoPaths } from '../../src/main/paths'
import { SKIPPED_NOTE } from '../../src/shared/pack/hatch'
// @ts-expect-error plain JS test helper
import { startStubModel } from '../stub-model/server.mjs'
import { repoRoot } from '../helpers/hermes'
import { removeDir } from '../helpers/remove-dir.mjs'

const xor = (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x5a))
let stub: { url: string; close(): Promise<void> }
let dir: string
let ctl: AppController

beforeAll(async () => {
  stub = await startStubModel()
  dir = mkdtempSync(join(tmpdir(), 'tomo-general-'))
  ctl = new AppController({
    paths: tomoPaths(join(dir, 'data')),
    runtime: devRuntime(repoRoot),
    encryptor: { isAvailable: () => true, encrypt: (s) => xor(Buffer.from(s)), decrypt: (b) => xor(b).toString() },
    remotePacks: async () => join(repoRoot, 'test/fixtures/packs'), // stands in for tomo-packs main
    pluginsDir: join(repoRoot, 'plugins'),
    runtimeDir: join(repoRoot, '.dev', 'home', 'tools'),
    baseEnv: { PATH: process.env.PATH, HOME: join(dir, 'home'), TMPDIR: process.env.TMPDIR },
    emit: { chat: () => {}, request: () => {}, setupTask: () => {}, engineState: () => {} },
  })
  ctl.setPrefs({ locale: 'zh' })
  ctl.connectProvider({ id: 'custom', model: 'stub-model', baseUrl: stub.url }, 'stub-key')
  ctl.selectPack(null)
})
afterAll(async () => { await ctl?.stopEngine(); await stub?.close(); removeDir(dir) })

describe('general Hatch (no school pack)', () => {
  it('all skipped: USER.md has the app language and the skipped note only', async () => {
    expect(await ctl.finishSetup({})).toEqual({ ok: true })
    const user = readFileSync(join(dir, 'data', 'hermes', 'memories', 'USER.md'), 'utf8')
    expect(user).toBe(`Reply in Simplified Chinese unless the user writes in another language.\n§\n${SKIPPED_NOTE}\n`)
    expect(ctl.getState().pack).toBeUndefined()
  })

  it('a nickname becomes a placeholder like every name', async () => {
    expect(await ctl.finishSetup({ preferred_name: { name: 'Mei-chan' }, reply_language: 'ja', goals: { values: ['tutoring'] } })).toEqual({ ok: true })
    const user = readFileSync(join(dir, 'data', 'hermes', 'memories', 'USER.md'), 'utf8')
    expect(user).toContain('Call the user {{PREFERRED_NAME}}.')
    expect(user).toContain('Reply in Japanese unless the user writes in another language.')
    expect(user).not.toContain('Mei-chan')
    expect(user).not.toContain('skipped')
    expect(ctl.displayValues()).toEqual({ PREFERRED_NAME: 'Mei-chan' })
  })
})
