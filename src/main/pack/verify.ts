// Release verification for school packs (Sigstore keyless signing in tomo-packs' release workflow).
// An archive is accepted only with a bundle whose signing certificate names the tomo-packs release workflow for
// that pack's tag, issued to GitHub Actions, logged in Rekor, and whose signature covers exactly these bytes.
import { readFileSync } from 'node:fs'
import { verify, type Bundle } from 'sigstore'

export const GITHUB_ACTIONS_ISSUER = 'https://token.actions.githubusercontent.com'

export interface SignerPolicy {
  /** e.g. ^https://github\.com/tkyu-labs/tomo-packs/\.github/workflows/release\.yml@refs/tags/shonan-it/v0\.1\.0$ */
  identity: string
  issuer?: string
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function packReleasePolicy(packId: string, version: string, repo = 'tkyu-labs/tomo-packs'): SignerPolicy {
  return { identity: `^${escape(`https://github.com/${repo}/.github/workflows/release.yml@refs/tags/${packId}/v${version}`)}$` }
}

export async function verifyArtifact(artifactFile: string, bundleFile: string, policy: SignerPolicy, tufCachePath: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const bundle = JSON.parse(readFileSync(bundleFile, 'utf8')) as Bundle
    await verify(bundle, readFileSync(artifactFile), {
      certificateIdentityURI: policy.identity,
      certificateIssuer: policy.issuer ?? GITHUB_ACTIONS_ISSUER,
      tufCachePath, // Sigstore's trust root cache stays in Tomo's folder
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
